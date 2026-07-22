'use strict';

export default (Blockly) => {
  Blockly.BBasic['bit_get'] = function(block) {
    const varName = Blockly.BBasic.nameDB_.getName(
        block.getFieldValue('VAR').trim() || 'temp1', Blockly.VARIABLE_CATEGORY_NAME);
    const bit = block.getFieldValue('BIT');
    const code = `${varName}{${bit}}`;
    return [code, Blockly.BBasic.ORDER_ATOMIC];
  };

  Blockly.BBasic['bit_set'] = function(block) {
    const varName = Blockly.BBasic.nameDB_.getName(
        block.getFieldValue('VAR').trim() || 'temp1', Blockly.VARIABLE_CATEGORY_NAME);
    const bit = block.getFieldValue('BIT');
    const argument0 = Blockly.BBasic.valueToCode(block, 'VALUE',
        Blockly.BBasic.ORDER_ASSIGNMENT) || 'true';
    return `if ${argument0} then ${varName}{${bit}} = 1 else ${varName}{${bit}} = 0\n`;
  };
};
