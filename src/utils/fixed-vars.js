// The four bytes the standard kernel always leaves free (var44-var47), which the Text Minikernel and the sound
// envelopes keep their fixed-name variables in. DPC+ has no such block, so there they sit in the memory of the
// virtual sprites the app never uses (see DPCPLUS_FREED_SPRITE_RAM in generators/bbasic.js): TextDataPtr takes two
// bytes in a row, so the last two are neighbours.
export const DPCPLUS_FIXED_VARIABLE_SLOTS = ['player9x', 'player9y', 'NUSIZ8', 'NUSIZ9'];

export const fixedFreeVariable = (config, number) =>
  (config && config.kernel === 'dpcplus') ? DPCPLUS_FIXED_VARIABLE_SLOTS[number - 44] : `var${number}`;
