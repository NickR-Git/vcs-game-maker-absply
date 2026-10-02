import * as Blockly from 'blockly/core';
import '@blockly/field-grid-dropdown';

import {COLOR_ICON} from './icon';
import {activePalette} from '../utils/palette';

// 28x28 (up from an original 16x16) - see App.vue's  global .blocklyMenuItem
// padding override, which shrinks each grid cell's  frame to match: a
// swatch this size fills its bordered cell edge to edge instead of floating
// as a small square inside a much bigger padded frame.
const SWATCH_SIZE = 28;

const colorToDataURL = (color) => {
  const canvas = window.document.createElement('canvas');
  canvas.width = SWATCH_SIZE;
  canvas.height = SWATCH_SIZE;

  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  return canvas.toDataURL();
};

// The swatch-grid options for the project's current TV standard (see
// activePalette in utils/palette.js) - the dropdown takes this as a function so
// it is rebuilt each time the menu opens, not once at load. Each palette's
// swatch images are only drawn once.
const optionsByPalette = new Map();
export const colorOptions = () => {
  const palette = activePalette();
  if (!optionsByPalette.has(palette)) {
    optionsByPalette.set(palette, palette.map((color, idx) => ([
      {
        src: colorToDataURL(`#${color}`),
        width: SWATCH_SIZE,
        height: SWATCH_SIZE,
      },
      `${idx << 1}`,
    ])));
  }
  return optionsByPalette.get(palette);
};

Blockly.defineBlocksWithJsonArray([
  {
    'type': 'color_get',
    'message0': `${COLOR_ICON} Color %1`,
    'args0': [
      {
        'type': 'field_grid_dropdown',
        'name': 'COLOR',
        'columns': 8,
        'options': colorOptions,
      },
    ],
    'output': 'Number',
    'icon': COLOR_ICON,
    'colour': 'purple',
    'tooltip': 'Select a color to use.',
  },
]);
