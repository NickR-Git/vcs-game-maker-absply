'use strict';

import Vue from 'vue';
import VueCompositionApi, {ref} from '@vue/composition-api';

import bBasic from 'batari-basic';

import {applyScoreFont} from '../utils/score-font';
import {showError} from '../utils/build-error';
import {useGeneratedBasic} from './generated';
import {useConfigurationStorage, useErrorStorage} from './project';

Vue.use(VueCompositionApi);

// Compiling is slow and a faulty program can hang the whole app, so it no
// longer happens on every edit: the editor only flags the ROM as stale, and the
// emulator is refreshed on demand.
const romOutdated = ref(true);

export const useRomOutdated = () => romOutdated;

export const markRomOutdated = () => {
  romOutdated.value = true;
};

/**
 * Compiles the current generated bBasic and loads it into the emulator.
 * @return {boolean} Whether the ROM was built.
 */
export const buildRom = () => {
  const errorStorage = useErrorStorage();
  const code = useGeneratedBasic().value;

  if (!code) {
    errorStorage.value = 'There is no generated code to build yet.';
    return false;
  }

  try {
    errorStorage.value = '';
    // The compiler has no font support of its own, so point its score
    // digits at the selected font before building.
    applyScoreFont(useConfigurationStorage().value?.scoreFont);
    const compiledResult = bBasic(code);
    Javatari.fileLoader.loadFromContent('main.bin', compiledResult.output);

    // TODO: Implement this without a global variable
    Javatari.compiledResult = compiledResult;
    romOutdated.value = false;
    return true;
  } catch (e) {
    showError(errorStorage, 'Error while compiling bBasic code', code, e);
    return false;
  }
};
