'use strict';

// The project's TV standard (Options tab) - what the compiled ROM's
// "set tv" line says and what the preview emulator is created with.
export const TV_STANDARD_OPTIONS = [
  {text: 'NTSC', value: 'ntsc'},
  {text: 'PAL', value: 'pal'},
  {text: 'PAL60', value: 'pal60'},
];

const KNOWN = TV_STANDARD_OPTIONS.map((option) => option.value);

// Falls back to NTSC for a project saved before this option existed (or any
// unrecognized value).
export const tvStandardFor = (config) => {
  const value = config && config.tvStandard;
  return KNOWN.includes(value) ? value : 'ntsc';
};

// batari Basic's "set tv" argument (lowercase).
export const bbTvSetting = (config) => tvStandardFor(config);

// gopher2600's television spec name (uppercase).
export const emulatorTvSpec = (config) => tvStandardFor(config).toUpperCase();
