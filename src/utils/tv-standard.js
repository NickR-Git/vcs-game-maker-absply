'use strict';

// The project's TV standard (Options tab) - what the compiled ROM's
// "set tv" line says, what the preview emulator is created with, and which
// color palette / audio clock the editors use.
//
// PAL60 is a PAL console's color signal at NTSC's 60 Hz / 262-line timing, so
// every frame-based value (durations, tempo, frames per second) is identical
// to NTSC - only the color palette and the TIA audio clock differ.
export const TV_STANDARD_OPTIONS = [
  {text: 'NTSC', value: 'ntsc'},
  {text: 'PAL60', value: 'pal60'},
];

const KNOWN = TV_STANDARD_OPTIONS.map((option) => option.value);

// Falls back to NTSC for a project saved before this option existed (or any
// unrecognized value, e.g. one from an option that has since been removed).
export const tvStandardFor = (config) => {
  const value = config && config.tvStandard;
  return KNOWN.includes(value) ? value : 'ntsc';
};

// batari Basic's "set tv" argument (lowercase).
export const bbTvSetting = (config) => tvStandardFor(config);

// gopher2600's television spec name (uppercase).
export const emulatorTvSpec = (config) => tvStandardFor(config).toUpperCase();

// The TIA's audio clock is derived from the horizontal scan rate, so it runs
// at (PAL horizontal rate / NTSC horizontal rate) of the NTSC value on a PAL
// console - 15625 / 15734.26, about 0.7% lower (roughly 12 cents flat).
const PAL60_AUDIO_CLOCK_SCALE = 15625 / 15734.26;

export const tvAudioClockScale = (config) =>
  (tvStandardFor(config) === 'pal60' ? PAL60_AUDIO_CLOCK_SCALE : 1);
