import * as Blockly from 'blockly/core';

// Matches a decimal integer (optionally negative) or a hexadecimal value
// written as $1F or 0x1F.
const NUMBER_PATTERN = /^\s*(-?\d+|\$[0-9a-fA-F]+|0[xX][0-9a-fA-F]+)\s*$/;

const validateNumber = (text) => (NUMBER_PATTERN.test(text) ? text.trim() : null);

// Override the built-in "number" block so it accepts hexadecimal values
// ($1F or 0x1F) in addition to its existing decimal behaviour. A validated
// text field is used instead of the numeric field so hex characters can be
// typed; decimal entry keeps working exactly as before.
Blockly.Blocks['math_number'] = {
  init: function() {
    this.jsonInit({
      'message0': '%1',
      'args0': [
        {
          'type': 'field_input',
          'name': 'NUM',
          'text': '0',
        },
      ],
      'output': 'Number',
      'colour': '%{BKY_MATH_HUE}',
      'tooltip': 'A number. Enter a decimal value, or a hexadecimal value like $1F.',
      'helpUrl': '',
    });
    this.getField('NUM').setValidator(validateNumber);
  },
};
