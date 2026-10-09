/**
 * @license
 * Copyright 2012 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Generating JavaScript for variable blocks.
 * @author fraser@google.com (Neil Fraser)
 */
'use strict';

/*
goog.provide('Blockly.BBasic.variables');

goog.require('Blockly.BBasic');
*/


import {useConfigurationStorage} from '../../hooks/project';

export default (Blockly) => {
  Blockly.BBasic['variables_get'] = function(block) {
  // Variable getter.
    const code = Blockly.BBasic.nameDB_.getName(block.getFieldValue('VAR'),
        Blockly.VARIABLE_CATEGORY_NAME);
    return [code, Blockly.BBasic.ORDER_ATOMIC];
  };

  Blockly.BBasic['variables_set'] = function(block) {
  // Variable setter.
    const argument0 = Blockly.BBasic.valueToCode(block, 'VALUE',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const varName = Blockly.BBasic.nameDB_.getName(
        block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);
    return varName + ' = ' + argument0 + '\n';
  };

  // DPC+'s variable stack (see blocks/stack.js). The other kernels have no push/pull.
  const stackStatement = (command) => function(block) {
    const varName = Blockly.BBasic.nameDB_.getName(block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);
    const config = (useConfigurationStorage() && useConfigurationStorage().value) || {};
    if (config.kernel !== 'dpcplus') {
      return ` rem ${command} ${varName}: the variable stack needs the DPC+ kernel\n`;
    }
    return ` ${command} ${varName}\n`;
  };
  Blockly.BBasic['variables_push'] = stackStatement('push');
  Blockly.BBasic['variables_pull'] = stackStatement('pull');
  Blockly.BBasic['variables_stack_position'] = function(block) {
    const config = (useConfigurationStorage() && useConfigurationStorage().value) || {};
    const position = Math.min(255, Math.max(0, Math.round(Number(block.getFieldValue('POSITION')) || 0)));
    if (config.kernel !== 'dpcplus') {
      return ` rem stack ${position}: the variable stack needs the DPC+ kernel\n`;
    }
    return ` stack ${position}\n`;
  };

  Blockly.BBasic['math_change'] = function(block) {
    // Variable increment.
    const argument0 = Blockly.BBasic.valueToCode(block, 'DELTA',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const varName = Blockly.BBasic.nameDB_.getName(
        block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);
    return varName + ' = ' + varName + ' + ' + argument0 + '\n';
  };
};
