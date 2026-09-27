'use strict';

// Waits for tools/gopher2600-wasm's window.gopher2600 API to exist - its WASM
// module is instantiated asynchronously at page load (see public/index.html),
// independent of both the compile pipeline (hooks/rom.js) and the panel
// switch UI (App.vue), either of which can run before it's ready.
// Note on error handling: if gopher2600.wasm has previously crashed (a fatal
// WASM trap), window.gopher2600 itself is still a live JS object (its
// function properties survive), but calling any of them throws "Go program
// has already exited". Callers that must not let a dead emulator instance
// break unrelated functionality (see hooks/rom.js's build pipeline) should
// wrap their own callback in try/catch; this only guards against the
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
