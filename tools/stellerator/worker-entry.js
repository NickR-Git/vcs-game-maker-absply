'use strict';

// The preview emulator's 6502.ts backend. 6502.ts (https://github.com/6502ts/6502.ts, MIT) is
// the TypeScript Atari 2600 emulator behind Stellerator; this worker runs its machine model and
// speaks the same messages as public/js/gopher2600-worker.js, so the page (public/index.html)
// drives either one the same way:
//
//   in:  {type: 'tick', timestamp}          one per display refresh; runs the frames that are due
//        {type: 'call', name, args}         loadRom, powerOn, setColorMode ... (see CALLS below)
//        {type: 'key', code, down}          a keyboard press or release, mapped by setKeyMapping
//        {type: 'setting', name, value}     cpuAccuracy (restarts the ROM); adaptiveFrameSkip is ignored
//   out: {type: 'ready'}, {type: 'tickDone'}, {type: 'blank', width, height},
//        {type: 'frame', width, height, pixels}      RGBA, 160 pixels wide
//        {type: 'audio', frequency, samples}         mono float32 in -1..1
//
// There is no keypad controller in 6502.ts, so the page switches to gopher2600 for a ROM that
// uses one (see public/index.html).
//
// Build: `npm run build:stellerator` (tools/stellerator/build.js).

const Board = require('6502.ts/lib/machine/stella/Board').default;
const Config = require('6502.ts/lib/machine/stella/Config').default;
const CartridgeFactory = require('6502.ts/lib/machine/stella/cartridge/CartridgeFactory').default;
const ArrayBufferSurface = require('6502.ts/lib/video/surface/ArrayBufferSurface').default;
const AudioOutputBuffer = require('6502.ts/lib/tools/AudioOutputBuffer').default;
const CpuFactory = require('6502.ts/lib/machine/cpu/Factory').default;
const palettes = require('6502.ts/lib/machine/stella/tia/palette');

const FRAME_WIDTH = 160;
const MAX_FRAME_HEIGHT = 320;
const IDLE_WIDTH = 160;
const IDLE_HEIGHT = 212;

// A refresh this early still counts as due (ordinary timing jitter on a 60 Hz display must not
// skip or double a frame), and after a stall only this many frames are run to catch up.
const TOLERANCE = 3;
const MAX_FRAMES_PER_TICK = 2;
const STALL_MS = 100;
// How many TIA color clocks one slice of emulation runs before the frame count is checked.
const SLICE_CLOCKS = 228 * 2;
const MAX_SLICES_PER_FRAME = 400;

const state = {
  board: null,
  rom: null,
  tvSpec: 'NTSC',
  // PAL60: NTSC timing with the PAL colors (a PAL console's color signal at 60 Hz).
  pal60: false,
  poweredOn: true,
  loading: false,
  pendingTicks: [],
  cpuAccuracy: 'cycle',
  framePeriod: 1000 / 60,
  accumulator: 0,
  lastTimestamp: null,
  frames: 0,
  lastSurface: null,
  audioChunks: [],
  // The two high-pass filter values that take the DC offset out of the unipolar PCM output.
  hpIn: 0,
  hpOut: 0,
  keyMapping: [],
  // The front panel, kept here so a new board (power cycle, new ROM) gets the same switches.
  colorMode: true,
  difficultyPro: {left: true, right: true},
};

const post = (message, transfer) => self.postMessage(message, transfer || []);

const blank = () => post({type: 'blank', width: IDLE_WIDTH, height: IDLE_HEIGHT});

const applyPanel = () => {
  if (!state.board) return;
  const panel = state.board.getControlPanel();
  // The switches read as "pressed" when true: the color switch is B&W and a difficulty switch
  // is B (amateur) when set.
  panel.getColorSwitch().toggle(!state.colorMode);
  panel.getDifficultySwitchP0().toggle(!state.difficultyPro.left);
  panel.getDifficultySwitchP1().toggle(!state.difficultyPro.right);
};

const destroyBoard = () => {
  if (state.board) state.board.suspend();
  state.board = null;
  state.lastSurface = null;
  state.audioChunks = [];
  state.hpIn = state.hpOut = 0;
};

const createBoard = async () => {
  destroyBoard();
  if (!state.rom || !state.poweredOn) return;
  const pal = state.tvSpec === 'PAL';
  const config = Config.create({
    tvMode: pal ? 1 : 0, // Config.TvMode.pal and .ntsc (a const enum, gone at run time)
    enableAudio: true,
    pcmAudio: true,
    emulatePaddles: false,
    randomSeed: (Math.random() * 0x7fffffff) | 0,
    cpuType: state.cpuAccuracy === 'instruction' ? CpuFactory.Type.batchedAccess : CpuFactory.Type.stateMachine,
  });
  const cartridge = await new CartridgeFactory().createCartridge(state.rom);
  const board = new Board(config, cartridge);
  board.getVideoOutput().setSurfaceFactory(() =>
    ArrayBufferSurface.createFromArrayBuffer(FRAME_WIDTH, MAX_FRAME_HEIGHT,
        new ArrayBuffer(FRAME_WIDTH * MAX_FRAME_HEIGHT * 4)));
  board.getVideoOutput().newFrame.addHandler((surface) => {
    state.frames++;
    state.lastSurface = surface;
  });
  const pcm = board.getPCMChannel();
  pcm.setFrameBufferFactory(() => new AudioOutputBuffer(new Float32Array(pcm.getFrameSize()), pcm.getSampleRate()));
  pcm.newFrame.addHandler((buffer) => {
    state.audioChunks.push({rate: buffer.getSampleRate(), content: buffer.getContent().slice(0, buffer.getLength())});
  });
  // The TIA picks its palette from the TV mode, which also sets the timing; PAL60 wants the PAL
  // palette at NTSC timing, so it is swapped in (the field is private to 6502.ts).
  if (state.pal60 && board._tia) board._tia._palette = palettes.PAL;
  board.setAudioEnabled(true);
  board.reset();
  state.board = board;
  state.frames = 0;
  state.accumulator = 0;
  state.lastTimestamp = null;
  state.framePeriod = pal ? 20 : 1000 / 60;
  applyPanel();
};

const postFrame = () => {
  const surface = state.lastSurface;
  if (!surface || !state.board) return;
  const height = Math.min(state.board.getVideoOutput().getHeight(), MAX_FRAME_HEIGHT);
  const pixels = new Uint32Array(FRAME_WIDTH * height);
  pixels.set(surface.getBuffer().subarray(0, pixels.length));
  post({type: 'frame', width: FRAME_WIDTH, height, pixels: pixels.buffer}, [pixels.buffer]);
};

// The PCM output is unipolar (0..1); a one-pole high-pass filter centers it so the speaker is
// not pushed by a constant level and the start and end of a sound do not click.
const postAudio = () => {
  const chunks = state.audioChunks;
  state.audioChunks = [];
  if (!chunks.length) return;
  let length = 0;
  chunks.forEach((chunk) => (length += chunk.content.length));
  const samples = new Float32Array(length);
  let index = 0;
  let hpIn = state.hpIn;
  let hpOut = state.hpOut;
  chunks.forEach((chunk) => {
    for (let i = 0; i < chunk.content.length; i++) {
      const input = chunk.content[i];
      hpOut = input - hpIn + 0.995 * hpOut;
      hpIn = input;
      samples[index++] = hpOut;
    }
  });
  state.hpIn = hpIn;
  state.hpOut = hpOut;
  post({type: 'audio', frequency: chunks[0].rate, samples: samples.buffer}, [samples.buffer]);
};

// Emulates until the board has produced one more frame.
const stepFrame = () => {
  const board = state.board;
  const target = state.frames + 1;
  for (let i = 0; state.frames < target && i < MAX_SLICES_PER_FRAME; i++) board.tick(SLICE_CLOCKS);
};

const runTick = (timestamp) => {
  if (!state.board) return;
  let elapsed = state.lastTimestamp === null ? state.framePeriod : timestamp - state.lastTimestamp;
  state.lastTimestamp = timestamp;
  if (elapsed > STALL_MS || elapsed < 0) elapsed = state.framePeriod;
  state.accumulator += elapsed;
  let ran = 0;
  while (state.accumulator >= state.framePeriod - TOLERANCE && ran < MAX_FRAMES_PER_TICK) {
    state.accumulator -= state.framePeriod;
    stepFrame();
    ran++;
  }
  if (state.accumulator > state.framePeriod) state.accumulator = state.framePeriod;
  if (ran) {
    postFrame();
    postAudio();
  }
};

const portFrom = (name) => (name === 'right' ? 1 : 0);

const joystickFor = (port) => (port === 1 ? state.board.getJoystick1() : state.board.getJoystick0());

const handleKey = (code, down) => {
  if (!state.board) return;
  const binding = state.keyMapping.find((entry) => entry.code === code && entry.kind !== 'keypad');
  if (!binding) return;
  const joystick = joystickFor(portFrom(binding.port));
  switch (binding.control) {
    case 'up': joystick.getUp().toggle(down); break;
    case 'down': joystick.getDown().toggle(down); break;
    case 'left': joystick.getLeft().toggle(down); break;
    case 'right': joystick.getRight().toggle(down); break;
    case 'fire': joystick.getFire().toggle(down); break;
  }
};

const panelSwitch = (pick, down) => {
  if (state.board) pick(state.board.getControlPanel()).toggle(down);
};

const CALLS = {
  loadRom: async (bytes, spec) => {
    state.rom = new Uint8Array(bytes);
    state.tvSpec = spec === 'PAL' ? 'PAL' : 'NTSC';
    state.pal60 = spec === 'PAL60';
    await createBoard();
  },
  powerOn: async () => {
    state.poweredOn = true;
    await createBoard();
  },
  powerOff: () => {
    state.poweredOn = false;
    destroyBoard();
    blank();
  },
  clearRom: () => {
    state.rom = null;
    destroyBoard();
    blank();
  },
  pressReset: () => panelSwitch((panel) => panel.getResetButton(), true),
  releaseReset: () => panelSwitch((panel) => panel.getResetButton(), false),
  pressSelect: () => panelSwitch((panel) => panel.getSelectSwitch(), true),
  releaseSelect: () => panelSwitch((panel) => panel.getSelectSwitch(), false),
  setColorMode: (color) => {
    state.colorMode = !!color;
    applyPanel();
  },
  setDifficulty: (port, pro) => {
    state.difficultyPro[port === 'right' ? 'right' : 'left'] = !!pro;
    applyPanel();
  },
  // Keypads are not emulated; the page does not send a keypad ROM here.
  setKeypadMode: () => {},
  setKeyMapping: (mapping) => {
    state.keyMapping = Array.isArray(mapping) ? mapping : [];
  },
};

// Messages are handled one at a time: loading a ROM is asynchronous, and a tick or a key that
// arrives meanwhile waits for it.
let queue = Promise.resolve();
const handle = async (message) => {
  switch (message.type) {
    case 'tick':
      runTick(message.timestamp);
      post({type: 'tickDone'});
      break;
    case 'call': {
      const fn = CALLS[message.name];
      if (typeof fn !== 'function') break;
      const args = message.args.map((arg) => (arg instanceof ArrayBuffer ? new Uint8Array(arg) : arg));
      await fn(...args);
      break;
    }
    case 'key':
      handleKey(message.code, message.down);
      break;
    case 'setting':
      if (message.name === 'cpuAccuracy' && message.value !== state.cpuAccuracy) {
        state.cpuAccuracy = message.value === 'instruction' ? 'instruction' : 'cycle';
        if (state.rom) await createBoard();
      }
      break;
  }
};

self.onmessage = (event) => {
  queue = queue.then(() => handle(event.data)).catch((error) => {
    console.error('6502.ts worker:', error);
    post({type: 'crashed', message: String((error && error.message) || error)});
  });
};

blank();
post({type: 'ready'});
