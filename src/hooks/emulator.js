'use strict';

import {useCompiledRomBytes} from './rom-status';

// public/index.html's own loadGopher2600Wasm() fires this every time a
// window.gopher2600 instance becomes ready - both the real first page load
// (nothing to restore yet, useCompiledRomBytes().value is still null then)
// and every automatic reinstantiation after a fatal WASM trap (see that
// function's own comment on why a crash can't be recovered from inside the
// dead instance itself). A fresh instance boots with no ROM attached, so
// without this, "Reset"/every other panel switch stayed visibly dead after
// a crash even though the auto-recovery had already silently replaced
// window.gopher2600 with a working instance underneath - confirmed
// directly as a real reported symptom ("hitting reset doesn't fix the
// issue"). BlocklyBB.keypad0Used/keypad1Used (see hooks/rom.js's own
// loadRom call) aren't re-applied here - they're a property of the
// CURRENT workspace's compiled code, not of the ROM bytes themselves, and
// re-deriving them here would need the whole compile pipeline re-run; the
// keypad mode a fresh instance boots with (off) matches a real console
// being power-cycled anyway, and the next real "Update ROM" click
// reapplies it correctly regardless.
window.addEventListener('gopher2600-ready', () => {
  const compiledRomBytes = useCompiledRomBytes();
  if (!compiledRomBytes.value) return;
  withGopher2600((gopher2600) => gopher2600.loadRom(compiledRomBytes.value.output));
});

// Waits for tools/gopher2600-wasm's window.gopher2600 API to exist - its WASM
// module is instantiated asynchronously at page load (see public/index.html),
// independent of both the compile pipeline (hooks/rom.js) and the panel
// switch UI (App.vue), either of which can run before it's ready.
// Note on error handling: if gopher2600.wasm has previously crashed (a fatal
// WASM trap), window.gopher2600 itself is still a live JS object (its
// function properties survive), but calling any of them throws "Go program
// has already exited". Callers that must not let a dead emulator instance
// break unrelated functionality (see hooks/rom.js's build pipeline) should
// wrap their callback in try/catch; this only guards against the
// callback never running at all (window.gopher2600 not existing yet).
export const withGopher2600 = (callback, retriesLeft = 40) => {
  if (window.gopher2600) {
    callback(window.gopher2600);
    return;
  }
  if (retriesLeft <= 0) return;
  window.setTimeout(() => withGopher2600(callback, retriesLeft - 1), 250);
};

// For callers (front-panel switch UI) where a dead emulator instance should
// just be a silent no-op rather than an uncaught exception out of a Vue
// event handler - the ROM itself is unaffected either way, there's simply
// nothing left running to send the switch state to until the user reloads.
export const safeWithGopher2600 = (callback) => {
  withGopher2600((gopher2600) => {
    try {
      callback(gopher2600);
    } catch (err) {
      console.error('gopher2600-wasm: call failed (the emulator instance may have crashed - try ' +
        '"Refresh emulator"):', err);
    }
  });
};
