// Command gopher2600-wasm embeds github.com/jetsetilly/gopher2600's emulation
// core (hardware/cartridgeloader/coprocessor - real DPC+/CDF ARM-coprocessor
// support included, no cgo anywhere in that path) as a WebAssembly module,
// exposing a small window.gopher2600 JS API: load a ROM, run it, read back
// video/audio, and drive front-panel switches + joystick input. This is the
// app's preview emulator, replacing Javatari (which has no DPC+ support at
// all).
package main

import (
	"fmt"
	"image"
	"runtime/debug"
	"syscall/js"

	"github.com/jetsetilly/gopher2600/cartridgeloader"
	"github.com/jetsetilly/gopher2600/environment"
	"github.com/jetsetilly/gopher2600/hardware"
	"github.com/jetsetilly/gopher2600/hardware/peripherals/controllers"
	"github.com/jetsetilly/gopher2600/hardware/preferences"
	"github.com/jetsetilly/gopher2600/hardware/riot/ports"
	"github.com/jetsetilly/gopher2600/hardware/riot/ports/plugging"
	"github.com/jetsetilly/gopher2600/hardware/television"
	"github.com/jetsetilly/gopher2600/hardware/television/frameinfo"
	"github.com/jetsetilly/gopher2600/hardware/television/signal"
	"github.com/jetsetilly/gopher2600/hardware/television/specification"
	"github.com/jetsetilly/gopher2600/hardware/tia/audio"
	"github.com/jetsetilly/gopher2600/hardware/tia/audio/mix"
)

// canvasRenderer implements television.PixelRenderer, converting each
// finished frame to an RGBA byte buffer cropped to the actual visible
// picture (frameinfo.Current.Crop()), ready for canvas putImageData().
type canvasRenderer struct {
	frameInfo frameinfo.Current
	sig       []signal.SignalAttributes
	prevSig   []signal.SignalAttributes
	crop      image.Rectangle
	rgba      []byte
	frameDone bool
}

func (c *canvasRenderer) NewFrame(fi frameinfo.Current) error {
	c.frameInfo = fi
	c.prevSig = c.sig
	c.frameDone = true
	return nil
}

func (c *canvasRenderer) NewScanline(_ int) error { return nil }

func (c *canvasRenderer) SetPixels(sig []signal.SignalAttributes, last int) error {
	c.sig = sig[:last]
	return nil
}

func (c *canvasRenderer) Reset()              {}
func (c *canvasRenderer) EndRendering() error { return nil }

func (c *canvasRenderer) render() bool {
	sig := c.sig
	if len(sig) <= specification.ClksScanline {
		sig = c.prevSig
	}
	if sig == nil || c.frameInfo.Spec.ID == "" {
		return false
	}

	crop := c.frameInfo.Crop()
	if crop.Dx() <= 0 || crop.Dy() <= 0 {
		return false
	}
	if crop != c.crop {
		c.crop = crop
		c.rgba = make([]byte, crop.Dx()*crop.Dy()*4)
	}

	for y := crop.Min.Y; y < crop.Max.Y; y++ {
		for x := crop.Min.X; x < crop.Max.X; x++ {
			i := y*specification.ClksScanline + x
			if i < 0 || i >= len(sig) {
				continue
			}

			var r, g, b byte
			if sig[i].VBlank || sig[i].Index == signal.NoSignal {
				col := c.frameInfo.Spec.GetColor(signal.ZeroBlack)
				r, g, b = col.R, col.G, col.B
			} else {
				col := c.frameInfo.Spec.GetColorScreen(sig, i, specification.ClksScanline)
				r, g, b = col.R, col.G, col.B
			}

			off := ((y-crop.Min.Y)*crop.Dx() + (x - crop.Min.X)) * 4
			c.rgba[off+0] = r
			c.rgba[off+1] = g
			c.rgba[off+2] = b
			c.rgba[off+3] = 255
		}
	}
	return true
}

// webAudioMixer implements television.RealtimeAudioMixer, buffering mono
// int16 samples (the same conversion the desktop sdlaudio/wavwriter mixers
// use) for the render loop to drain and hand to the browser's Web Audio API.
type webAudioMixer struct {
	freq int
	buf  []int16
}

func (m *webAudioMixer) SetSpec(spec specification.Spec) {
	m.freq = int(spec.HorizontalScanRate) * audio.SamplesPerScanline
}

func (m *webAudioMixer) SetAudio(sig []signal.AudioSignalAttributes) error {
	for _, s := range sig {
		m.buf = append(m.buf, mix.Mono(s.AudioChannel0, s.AudioChannel1))
	}
	return nil
}

func (m *webAudioMixer) EndMixing() error { return nil }
func (m *webAudioMixer) Reset()           { m.buf = m.buf[:0] }

func (m *webAudioMixer) drain() []int16 {
	out := m.buf
	m.buf = nil
	return out
}

// console owns one running (or powered-off) VCS instance and everything the
// JS API needs to drive it. powerOn recreates the VCS from scratch (real
// cold-boot semantics), so it - not a constructor - is where setup lives.
type console struct {
	tv       *television.Television
	prefs    *preferences.Preferences
	vcs      *hardware.VCS
	renderer *canvasRenderer
	mixer    *webAudioMixer

	lastRom     []byte
	poweredOn   bool
	romAttached bool
	jamReported bool

	canvas    js.Value
	ctx       js.Value
	jsBuf     js.Value
	imageData js.Value
	jsBufSize int

	renderFrame js.Func
}

// defaultCropWidth/Height are the standard NTSC visible-picture dimensions
// (before overscan), used only until the first real frame renders and sets
// the canvas's true size from frameinfo.Current.Crop(). Without this, the
// canvas sits at the browser's default <canvas> size (300x150) - neither the
// right resolution nor the right aspect ratio - for the entire span between
// page load and the first ROM's first rendered frame.
const (
	defaultCropWidth  = 160
	defaultCropHeight = 192
)

func newConsole(canvas js.Value) *console {
	c := &console{canvas: canvas}
	c.ctx = canvas.Call("getContext", "2d")

	canvas.Set("width", defaultCropWidth)
	canvas.Set("height", defaultCropHeight)
	style := canvas.Get("style")
	style.Set("width", fmt.Sprintf("%dpx", defaultCropWidth*2)) // see onAnimationFrame's own comment on the 2x stretch
	style.Set("height", fmt.Sprintf("%dpx", defaultCropHeight))
	c.ctx.Set("fillStyle", "#000")
	c.ctx.Call("fillRect", 0, 0, defaultCropWidth, defaultCropHeight)

	c.renderFrame = js.FuncOf(c.onAnimationFrame)
	return c
}

func (c *console) onAnimationFrame(this js.Value, args []js.Value) (result any) {
	defer func() {
		if r := recover(); r != nil {
			js.Global().Get("console").Call("error", fmt.Sprintf("PANIC in render loop: %v\n%s", r, debug.Stack()))
			result = nil
		}
	}()

	if !c.poweredOn || c.vcs == nil || !c.romAttached {
		js.Global().Call("requestAnimationFrame", c.renderFrame)
		return nil
	}

	if c.vcs.CPU.Jammed {
		// A jammed CPU (a real, correctly-emulated 6507 "JAM"/illegal-opcode
		// hardware halt - see instructions.JAM) never recovers on its own;
		// without this check, Step() keeps "succeeding" every call without
		// ever advancing, silently spinning at the same PC forever while the
		// TIA/RIOT keep ticking on their own clock and still produce real
		// frame-complete signals - so the loop below would never surface an
		// error, just render whatever was on screen at the moment of the
		// jam, forever. Matches the real desktop frontend's own Jammed check
		// in hardware/run.go ("emulation will run forever if we don't check
		// for this"). Reported once, not every frame.
		if !c.jamReported {
			c.jamReported = true
			js.Global().Get("console").Call("error", fmt.Sprintf(
				"gopher2600-wasm: CPU jammed (illegal opcode) at PC=$%04x %s - the compiled ROM's own code "+
					"is corrupted at this address, most likely a bad jump/bank-switch target landing in "+
					"data instead of code. This is a real hardware halt condition, not an emulator bug.",
				c.vcs.CPU.PC.Address(), c.vcs.Mem.Cart.MappedBanks()))
		}
		js.Global().Call("requestAnimationFrame", c.renderFrame)
		return nil
	}

	c.renderer.frameDone = false
	steps := 0
	for !c.renderer.frameDone && steps < 200_000 {
		if err := c.vcs.Step(nil); err != nil {
			js.Global().Get("console").Call("error", "step error: "+err.Error())
			break
		}
		if c.vcs.CPU.Jammed {
			break
		}
		steps++
	}

	if c.renderer.render() {
		if c.jsBufSize != len(c.renderer.rgba) {
			c.canvas.Set("width", c.renderer.crop.Dx())
			c.canvas.Set("height", c.renderer.crop.Dy())
			// TIA color clocks aren't square pixels - a real 2600's visible
			// picture is displayed roughly twice as wide as its raw
			// clock-count would suggest, the standard "double-wide" stretch
			// every 2600 emulator applies to land on the correct ~4:3 TV
			// aspect. App.vue's updateEmulatorScale scales this canvas
			// uniformly (offsetWidth/offsetHeight, not the pixel buffer
			// size), so setting the CSS box here is what makes that scaling
			// preserve the right aspect instead of the raw (too-narrow)
			// buffer shape.
			style := c.canvas.Get("style")
			style.Set("width", fmt.Sprintf("%dpx", c.renderer.crop.Dx()*2))
			style.Set("height", fmt.Sprintf("%dpx", c.renderer.crop.Dy()))
			c.jsBuf = js.Global().Get("Uint8ClampedArray").New(len(c.renderer.rgba))
			c.imageData = js.Global().Get("ImageData").New(c.jsBuf, c.renderer.crop.Dx(), c.renderer.crop.Dy())
			c.jsBufSize = len(c.renderer.rgba)
		}
		js.CopyBytesToJS(c.jsBuf, c.renderer.rgba)
		c.ctx.Call("putImageData", c.imageData, 0, 0)
	}

	if samples := c.mixer.drain(); len(samples) > 0 && c.mixer.freq > 0 {
		jsSamples := js.Global().Get("Float32Array").New(len(samples))
		for i, s := range samples {
			jsSamples.SetIndex(i, float64(s)/32768.0)
		}
		js.Global().Call("playGopher2600AudioChunk", c.mixer.freq, jsSamples)
	}

	js.Global().Call("requestAnimationFrame", c.renderFrame)
	return nil
}

// powerOn performs a real cold boot: a fresh VCS, fresh TV, fresh
// preferences, matching real hardware powering up in an indeterminate/reset
// state rather than merely resuming whatever was running before. If a ROM
// was previously loaded it's re-attached (mirrors "cartridge stays inserted
// across a power cycle").
func (c *console) powerOn() error {
	tv, err := television.NewTelevision("AUTO")
	if err != nil {
		return err
	}
	prefs, err := preferences.NewPreferences()
	if err != nil {
		return err
	}
	vcs, err := hardware.NewVCS(environment.MainEmulation, tv, nil, prefs)
	if err != nil {
		return err
	}

	renderer := &canvasRenderer{}
	tv.AddPixelRenderer(renderer)
	mixer := &webAudioMixer{}
	tv.SetRealTimeAudioMixer(mixer)

	c.tv = tv
	c.prefs = prefs
	c.vcs = vcs
	c.renderer = renderer
	c.mixer = mixer
	c.poweredOn = true

	if c.lastRom != nil {
		if err := c.attachRom(c.lastRom); err != nil {
			return err
		}
	}

	return nil
}

func (c *console) powerOff() {
	c.poweredOn = false
	c.vcs = nil
	c.romAttached = false
	c.jsBufSize = 0
	if !c.ctx.IsUndefined() {
		// Fill black, not clearRect (which leaves the canvas transparent,
		// showing whatever's behind it rather than a dark "no signal"
		// screen matching a real powered-off console).
		w := c.canvas.Get("width")
		h := c.canvas.Get("height")
		c.ctx.Set("fillStyle", "#000")
		c.ctx.Call("fillRect", 0, 0, w, h)
	}
}

func (c *console) attachRom(romData []byte) error {
	c.lastRom = romData
	if c.vcs == nil {
		return nil
	}
	loader, err := cartridgeloader.NewLoaderFromData("rom", romData, "AUTO", "AUTO", nil, c.tv)
	if err != nil {
		return err
	}
	if err := c.vcs.AttachCartridge(loader, nil); err != nil {
		return err
	}
	c.romAttached = true
	c.jamReported = false
	return nil
}

func portFromString(s string) plugging.PortID {
	if s == "right" {
		return plugging.PortRight
	}
	return plugging.PortLeft
}

func (c *console) setKeypadMode(port plugging.PortID, enabled bool) error {
	if c.vcs == nil {
		return nil
	}
	if enabled {
		return c.vcs.RIOT.Ports.Plug(port, controllers.NewKeypad)
	}
	return c.vcs.RIOT.Ports.Plug(port, controllers.NewStick)
}

func (c *console) input(port plugging.PortID, ev ports.Event, data ports.EventData) {
	if c.vcs == nil {
		return
	}
	_, _ = c.vcs.Input.HandleInputEvent(ports.InputEvent{Port: port, Ev: ev, D: data})
}

// keyToEvent maps a JS KeyboardEvent.code to a VCS joystick/panel event.
// Player 1 (left port) uses arrow keys + Space; player 2 (right port) uses
// WASD + left-Ctrl, matching the two-simultaneous-player keyboard mapping
// the previous Javatari-based preview offered by default.
func keyToEvent(code string) (port plugging.PortID, ev ports.Event, data ports.EventData, ok bool) {
	switch code {
	case "ArrowUp":
		return plugging.PortLeft, ports.Up, ports.DataStickSet, true
	case "ArrowDown":
		return plugging.PortLeft, ports.Down, ports.DataStickSet, true
	case "ArrowLeft":
		return plugging.PortLeft, ports.Left, ports.DataStickSet, true
	case "ArrowRight":
		return plugging.PortLeft, ports.Right, ports.DataStickSet, true
	case "Space":
		return plugging.PortLeft, ports.Fire, true, true
	case "KeyW":
		return plugging.PortRight, ports.Up, ports.DataStickSet, true
	case "KeyS":
		return plugging.PortRight, ports.Down, ports.DataStickSet, true
	case "KeyA":
		return plugging.PortRight, ports.Left, ports.DataStickSet, true
	case "KeyD":
		return plugging.PortRight, ports.Right, ports.DataStickSet, true
	case "ControlLeft":
		return plugging.PortRight, ports.Fire, true, true
	}
	return "", "", nil, false
}

func keyUpToEvent(code string) (port plugging.PortID, ev ports.Event, data ports.EventData, ok bool) {
	switch code {
	case "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight":
		return plugging.PortLeft, ports.Centre, nil, true
	case "Space":
		return plugging.PortLeft, ports.Fire, false, true
	case "KeyW", "KeyS", "KeyA", "KeyD":
		return plugging.PortRight, ports.Centre, nil, true
	case "ControlLeft":
		return plugging.PortRight, ports.Fire, false, true
	}
	return "", "", nil, false
}

// safeFunc wraps a JS-invoked Go callback with panic recovery. Without this,
// an unrecovered panic in ANY js.FuncOf callback (keyboard events, the
// exposed API) fatally terminates the entire WASM instance - unlike
// onAnimationFrame's own recover(), which only protects the render loop
// itself, every other callback registered below had none at all until this.
// A dead instance's JS object reference survives (window.gopher2600 is still
// truthy), but every subsequent call into it throws "Go program has already
// exited" - which, left unguarded on the JS caller's side, previously broke
// unrelated ROM builds for the rest of the page's lifetime (see
// hooks/rom.js's own try/catch around gopher2600 calls for the other half of
// this fix).
func safeFunc(name string, fn func(this js.Value, args []js.Value) any) js.Func {
	return js.FuncOf(func(this js.Value, args []js.Value) (result any) {
		defer func() {
			if r := recover(); r != nil {
				js.Global().Get("console").Call("error",
					fmt.Sprintf("PANIC in gopher2600-wasm %s: %v\n%s", name, r, debug.Stack()))
				result = nil
			}
		}()
		return fn(this, args)
	})
}

func main() {
	canvas := js.Global().Get("document").Call("getElementById", "gopher2600-screen")
	if canvas.IsUndefined() || canvas.IsNull() {
		js.Global().Get("console").Call("error", "gopher2600-wasm: #gopher2600-screen canvas not found")
		return
	}

	c := newConsole(canvas)
	if err := c.powerOn(); err != nil {
		js.Global().Get("console").Call("error", "gopher2600-wasm: power-on failed: "+err.Error())
		return
	}
	// Started exactly once, here - onAnimationFrame re-schedules itself every
	// frame for the lifetime of the page (as a no-op while powered off), so
	// powerOn()/powerOff() only ever flip c.poweredOn rather than touching
	// scheduling. Calling requestAnimationFrame again from powerOn() (as an
	// earlier version of this did) stacks up an extra concurrent loop every
	// time the user powers back on, racing multiple onAnimationFrame calls
	// against the same VCS each frame and corrupting emulation state.
	js.Global().Call("requestAnimationFrame", c.renderFrame)

	js.Global().Get("document").Call("addEventListener", "keydown", safeFunc("keydown", func(this js.Value, args []js.Value) any {
		code := args[0].Get("code").String()
		if port, ev, data, ok := keyToEvent(code); ok {
			args[0].Call("preventDefault")
			c.input(port, ev, data)
		}
		return nil
	}))
	js.Global().Get("document").Call("addEventListener", "keyup", safeFunc("keyup", func(this js.Value, args []js.Value) any {
		code := args[0].Get("code").String()
		if port, ev, data, ok := keyUpToEvent(code); ok {
			args[0].Call("preventDefault")
			c.input(port, ev, data)
		}
		return nil
	}))

	api := js.Global().Get("Object").New()

	api.Set("loadRom", safeFunc("loadRom", func(this js.Value, args []js.Value) any {
		jsBytes := args[0]
		romData := make([]byte, jsBytes.Get("length").Int())
		js.CopyBytesToGo(romData, jsBytes)
		if err := c.attachRom(romData); err != nil {
			js.Global().Get("console").Call("error", "gopher2600-wasm: loadRom failed: "+err.Error())
		}
		return nil
	}))

	api.Set("powerOn", safeFunc("powerOn", func(this js.Value, args []js.Value) any {
		if err := c.powerOn(); err != nil {
			js.Global().Get("console").Call("error", "gopher2600-wasm: powerOn failed: "+err.Error())
		}
		return nil
	}))

	api.Set("powerOff", safeFunc("powerOff", func(this js.Value, args []js.Value) any {
		c.powerOff()
		return nil
	}))

	api.Set("pressReset", safeFunc("pressReset", func(this js.Value, args []js.Value) any {
		c.input(plugging.PortPanel, ports.PanelReset, true)
		return nil
	}))
	api.Set("releaseReset", safeFunc("releaseReset", func(this js.Value, args []js.Value) any {
		c.input(plugging.PortPanel, ports.PanelReset, false)
		return nil
	}))
	api.Set("pressSelect", safeFunc("pressSelect", func(this js.Value, args []js.Value) any {
		c.input(plugging.PortPanel, ports.PanelSelect, true)
		return nil
	}))
	api.Set("releaseSelect", safeFunc("releaseSelect", func(this js.Value, args []js.Value) any {
		c.input(plugging.PortPanel, ports.PanelSelect, false)
		return nil
	}))

	api.Set("setColorMode", safeFunc("setColorMode", func(this js.Value, args []js.Value) any {
		c.input(plugging.PortPanel, ports.PanelSetColor, args[0].Bool())
		return nil
	}))
	api.Set("setDifficulty", safeFunc("setDifficulty", func(this js.Value, args []js.Value) any {
		pro := args[1].Bool()
		if args[0].String() == "right" {
			c.input(plugging.PortPanel, ports.PanelSetPlayer1Pro, pro)
		} else {
			c.input(plugging.PortPanel, ports.PanelSetPlayer0Pro, pro)
		}
		return nil
	}))

	api.Set("setKeypadMode", safeFunc("setKeypadMode", func(this js.Value, args []js.Value) any {
		port := portFromString(args[0].String())
		if err := c.setKeypadMode(port, args[1].Bool()); err != nil {
			js.Global().Get("console").Call("error", "gopher2600-wasm: setKeypadMode failed: "+err.Error())
		}
		return nil
	}))

	js.Global().Set("gopher2600", api)
	js.Global().Get("console").Call("log", "gopher2600-wasm ready")

	select {} // keep the wasm program alive
}
