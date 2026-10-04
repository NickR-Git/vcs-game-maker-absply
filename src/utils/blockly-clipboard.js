// Copy and paste of Blockly blocks between browser windows (and between
// different browsers or the desktop app). The multiselect plugin already
// shares copied blocks between windows of the same browser through
// localStorage; this also puts them on the system clipboard as text, and reads
// them back from it when pasting, so they get across windows that do not share
// storage. A copy puts a "VCSGM-BLOCKS:" line on the clipboard (the same data
// the plugin keeps in localStorage); a paste first looks at the clipboard and,
// when it holds blocks newer than the ones in localStorage, moves them into
// localStorage, then lets the plugin's own paste run.
import Blockly from 'blockly';

const PREFIX = 'VCSGM-BLOCKS:';
const MULTI_KEY = 'blocklyStashMulti';
const CONNECTION_KEY = 'blocklyStashConnection';
const TIME_KEY = 'blocklyStashTime';

const readStash = () => {
  try {
    const multi = localStorage.getItem(MULTI_KEY);
    const time = Number(localStorage.getItem(TIME_KEY));
    if (!multi || !time) return null;
    return {
      multi: JSON.parse(multi),
      connection: JSON.parse(localStorage.getItem(CONNECTION_KEY) || '[]'),
      time,
    };
  } catch (e) {
    return null;
  }
};

const writeClipboard = async (stash) => {
  try {
    await navigator.clipboard.writeText(PREFIX + JSON.stringify(stash));
  } catch (e) {
    console.warn('Could not put the copied blocks on the clipboard', e);
  }
};

// Moves blocks found on the clipboard into the plugin's localStorage copy when
// they are newer than what it already holds. Returns whether anything changed.
const importFromClipboard = async () => {
  let text = '';
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    return false;
  }
  if (!text || !text.startsWith(PREFIX)) return false;
  let stash;
  try {
    stash = JSON.parse(text.slice(PREFIX.length));
  } catch (e) {
    return false;
  }
  if (!stash || !Array.isArray(stash.multi)) return false;
  const current = readStash();
  if (current && current.time >= stash.time) return false;
  localStorage.setItem(MULTI_KEY, JSON.stringify(stash.multi));
  localStorage.setItem(CONNECTION_KEY, JSON.stringify(stash.connection || []));
  // Newer than anything this window has seen, so the plugin picks it up.
  localStorage.setItem(TIME_KEY, String(Date.now()));
  return true;
};

const isTextTarget = (event) => {
  const target = event.target;
  if (!target || !target.tagName) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
};

// Starts watching Ctrl/Cmd+C, X and V; returns a function that stops.
export const installBlocklyClipboardSync = () => {
  if (typeof navigator === 'undefined' || !navigator.clipboard) return () => {};
  const onKeyDown = (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || isTextTarget(event)) return;
    const key = (event.key || '').toLowerCase();
    if (key === 'c' || key === 'x') {
      // The plugin's handler runs after this one; look at what it stored once it has.
      const before = localStorage.getItem(TIME_KEY);
      setTimeout(() => {
        const stash = readStash();
        if (stash && String(stash.time) !== before) writeClipboard(stash);
      }, 0);
      return;
    }
    if (key === 'v') {
      const workspace = Blockly.common.getMainWorkspace();
      if (!workspace) return;
      // Hold the paste until the clipboard has been checked, then let the
      // plugin's paste shortcut handle it as usual.
      event.preventDefault();
      event.stopPropagation();
      importFromClipboard().finally(() => {
        Blockly.ShortcutRegistry.registry.onKeyDown(workspace, event);
      });
    }
  };
  document.addEventListener('keydown', onKeyDown, true);
  return () => document.removeEventListener('keydown', onKeyDown, true);
};
