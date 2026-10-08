'use strict';

import Vue from 'vue';
import VueCompositionApi, {ref} from '@vue/composition-api';

Vue.use(VueCompositionApi);

// The variables of the last successful build: where each one lives in RAM, for the emulator's debug
// info. Kept in a module by itself, like rom-capacity.js, so the builder can set it without an import
// cycle. Each entry is {name, address, owner} with owner 'user', 'block' or 'system' (who asked for it).
const debugVariables = ref([]);

export const useDebugVariables = () => debugVariables;

export const setDebugVariables = (value) => {
  debugVariables.value = value;
};

// The variables a build names (see computeVariableUsage in hooks/rom.js), with the address DASM gave each
// one. A variable that shares a slot with another (see titleSharedSlots in generators/bbasic.js) is listed
// too, under the name it has.
export const collectDebugVariables = (variableUsage, symbolmap) => {
  if (!variableUsage || !symbolmap) return [];
  const found = new Map();
  const add = (name, owner) => {
    if (!name || found.has(name) || symbolmap[name] === undefined) return;
    found.set(name, {name, address: symbolmap[name], owner});
  };
  [...(variableUsage.letterAssignments || []), ...(variableUsage.superchipAssignments || [])].forEach((assignment) => {
    const owner = assignment.isUserVariable ? 'user' : 'block';
    add(assignment.name, owner);
    (assignment.sharedWith || []).forEach((name) => add(name, 'block'));
  });
  (variableUsage.systemAssignments || []).forEach((assignment) => add(assignment.name, 'system'));
  return [...found.values()];
};
