'use strict';

import Vue from 'vue';
import VueCompositionApi, {ref} from '@vue/composition-api';

Vue.use(VueCompositionApi);

// Whether the emulator's ROM is behind the current project. Kept in its own
// module, free of other project imports, so the storage layer can flag the ROM
// stale without creating an import cycle with the builder.
const romOutdated = ref(true);

export const useRomOutdated = () => romOutdated;

export const markRomOutdated = () => {
  romOutdated.value = true;
};

// Whether a ROM has EVER been successfully compiled this page load - unlike
// romOutdated (which flips back to true the moment the project changes
// again), this stays true once set: the "Save ROM" button (App.vue) reads
// this to disable itself only until the first successful build, since a
// previously-compiled ROM (see compiledRomBytes below) is still valid and
// downloadable even after the project's edits make it stale, right up
// until a real page reload clears it (see handleRefreshEmulator's comment
// on why that's the one thing that actually loses it).
const hasCompiledRom = ref(false);

export const useHasCompiledRom = () => hasCompiledRom;

// The last successfully assembled ROM (an assembleBatariBasic() result:
// {output: Uint8Array, ...}) - used by "Save ROM"/"Test in Stella" in
// App.vue. Kept here rather than as a global on the emulator object, unlike
// the Javatari-era `Javatari.compiledResult` stash this replaces.
const compiledRomBytes = ref(null);

export const useCompiledRomBytes = () => compiledRomBytes;

export const setCompiledRomBytes = (result) => {
  compiledRomBytes.value = result;
};

export const markRomUpToDate = () => {
  romOutdated.value = false;
  hasCompiledRom.value = true;
};

// sessionStorage key backing recordLoadedRomForRecovery below - deliberately
// sessionStorage, not localStorage: this is a cache of compiled BYTES tied to
// this tab's current session, not project data, and clearing it on an actual
// tab close (rather than it lingering indefinitely) is the right lifetime for
// that.
const LAST_LOADED_ROM_KEY = 'vcsgm-last-loaded-rom';

// What the emulator canvas is CURRENTLY showing, independent of whether that
// came from a real "Update ROM" build or a one-off Title Screen preview build
// (hooks/rom.js's buildRomInner vs buildTitleScreenPreviewRom) - unlike
// compiledRomBytes above, which is deliberately real-build-only (Save
// ROM/Test in Stella must never offer a synthetic preview program). Restored
// from sessionStorage immediately below at module load, so it already has
// the right value before either the 'gopher2600-ready' listener (hooks/
// emulator.js) or a real page reload's first render can run.
const lastLoadedRomBytes = ref(null);

export const useLastLoadedRomBytes = () => lastLoadedRomBytes;

// Call right after ANY successful gopher2600.loadRom(...) - both call sites
// in hooks/rom.js. Persists to sessionStorage so a real page reload (see
// App.vue's handleRefreshEmulator - the only thing that actually clears
// module state like this ref) still has something to hand the emulator once
// gopher2600.wasm finishes reinitializing, instead of coming back up blank
// until the user manually rebuilds.
export const recordLoadedRomForRecovery = (output) => {
  lastLoadedRomBytes.value = output;
  try {
    let binary = '';
    for (let i = 0; i < output.length; i++) binary += String.fromCharCode(output[i]);
    sessionStorage.setItem(LAST_LOADED_ROM_KEY, btoa(binary));
  } catch (e) {
    // sessionStorage can throw (private browsing quota, etc.) - losing the
    // reload-recovery convenience isn't worth failing the build over.
  }
};

(() => {
  try {
    const stored = sessionStorage.getItem(LAST_LOADED_ROM_KEY);
    if (!stored) return;
    const binary = atob(stored);
    const output = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) output[i] = binary.charCodeAt(i);
    lastLoadedRomBytes.value = output;
  } catch (e) {
    // Corrupt/unreadable entry - fall through with nothing to restore.
  }
})();
