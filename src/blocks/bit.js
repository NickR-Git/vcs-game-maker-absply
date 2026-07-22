import * as Blockly from 'blockly/core';

import {BIT_ICON} from './icon';

const BIT_OPTIONS = [...Array(8).keys()].map((n) => [`${n}`, `${n}`]);

Blockly.defineBlocksWithJsonArray([
  // Block for reading a single bit of a variable.
  {
    'type': 'bit_get',
    'message0': `${BIT_ICON} bit %1 of %2`,
    'args0': [
      {
        'type': 'field_dropdown',
        'name': 'BIT',
        'options': BIT_OPTIONS,
      },
      {
        'type': 'field_input',
        'name': 'VAR',
        'text': 'player0size',
      },
    ],
    'output': 'Boolean',
    'colour': 'purple',
    'tooltip': 'Checks if a single bit of a variable is set (1) or clear (0).',
  },
  // Block for setting a single bit of a variable.
  {
    'type': 'bit_set',
    'message0': `${BIT_ICON} set bit %1 of %2 to %3`,
    'args0': [
      {
        'type': 'field_dropdown',
        'name': 'BIT',
        'options': BIT_OPTIONS,
      },
      {
        'type': 'field_input',
        'name': 'VAR',
        'text': 'player0size',
      },
      {
        'type': 'input_value',
        'name': 'VALUE',
        'check': 'Boolean',
      },
    ],
    'previousStatement': null,
    'nextStatement': null,
    'colour': 'purple',
    'tooltip': 'Sets a single bit of a variable to true (1) or false (0).',
  },
]);
