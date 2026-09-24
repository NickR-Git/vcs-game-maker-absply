<template>
  <v-dialog v-model="open" width="640">
    <template v-slot:activator="{ on, attrs }">
      <v-btn
        icon
        class="emulator-flat-icon-btn"
        title="Configure joystick/keypad keyboard mapping"
        v-bind="attrs"
        v-on="on"
      >
        <v-icon :size="22" style="margin-top: -1px">mdi-keyboard-outline</v-icon>
      </v-btn>
    </template>
    <v-card>
      <v-card-title>Keyboard Mapping</v-card-title>
      <v-card-text>
        <p class="key-mapping-hint">
          Click a key, then press a new key on your keyboard. Escape cancels. A key already used
          elsewhere is cleared from its old spot when reassigned. Two input devices of the same
          type can't share one key.
        </p>
        <div class="key-mapping-columns">
          <div v-for="(portName, portIndex) in portLabels" :key="portIndex" class="key-mapping-port">
            <h3>{{ portName }}</h3>

            <h4>Joystick</h4>
            <div class="key-mapping-controls">
              <v-btn
                v-for="control in joystickControls"
                :key="'joystick-' + control"
                small
                outlined
                :color="isCapturing('joystick', portIndex, control) ? 'primary' : undefined"
                @click="startCapture('joystick', portIndex, control)"
              >
                {{ joystickControlLabels[control] }}:
                {{ isCapturing('joystick', portIndex, control) ? 'Press a key…' : labelForCode(mapping.joystick[portIndex][control]) }}
              </v-btn>
            </div>

            <h4>Keypad</h4>
            <div class="key-mapping-controls key-mapping-keypad">
              <v-btn
                v-for="control in keypadControls"
                :key="'keypad-' + control"
                small
                outlined
                :color="isCapturing('keypad', portIndex, control) ? 'primary' : undefined"
                @click="startCapture('keypad', portIndex, control)"
              >
                {{ isCapturing('keypad', portIndex, control) ? '…' : labelForCode(mapping.keypad[portIndex][control]) }}
              </v-btn>
            </div>
          </div>
        </div>
      </v-card-text>
      <v-card-actions>
        <v-btn text @click="handleReset">Reset to defaults</v-btn>
        <v-spacer></v-spacer>
        <v-btn text @click="open = false">Close</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
'use strict';

import {
  JOYSTICK_CONTROLS,
  KEYPAD_CONTROLS,
  useKeyMapping,
  setKeyBinding,
  resetKeyMapping,
} from '../hooks/key-mapping';

// Friendly labels for KeyboardEvent.code strings - only needs to cover the
// codes an actual keyboard can produce for the controls this dialog binds
// (letters/digits/numpad/arrows/space/modifiers), not every possible code.
const SPECIAL_CODE_LABELS = {
  Space: 'Space',
  ControlLeft: 'L Ctrl',
  ControlRight: 'R Ctrl',
  ShiftLeft: 'L Shift',
  ShiftRight: 'R Shift',
  AltLeft: 'L Alt',
  AltRight: 'R Alt',
  Enter: 'Enter',
  Tab: 'Tab',
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  Semicolon: ';',
  Quote: '\'',
  Comma: ',',
  Period: '.',
  Slash: '/',
  NumpadDecimal: 'Num Dec',
};

const labelForCode = (code) => {
  if (!code) return '—';
  if (SPECIAL_CODE_LABELS[code]) return SPECIAL_CODE_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  if (code.startsWith('Arrow')) return code.slice(5);
  return code;
};

export default {
  name: 'KeyMappingDialog',
  data() {
    return {
      open: false,
      portLabels: ['Player 1', 'Player 2'],
      joystickControls: JOYSTICK_CONTROLS,
      keypadControls: KEYPAD_CONTROLS,
      joystickControlLabels: {up: 'Up', down: 'Down', left: 'Left', right: 'Right', fire: 'Fire'},
      capturing: null, // {kind, portIndex, control}
      keydownListener: null,
    };
  },
  computed: {
    mapping() {
      return useKeyMapping().value;
    },
  },
  watch: {
    open(isOpen) {
      if (!isOpen) this.stopCapture();
    },
  },
  beforeDestroy() {
    this.stopCapture();
  },
  methods: {
    labelForCode,
    isCapturing(kind, portIndex, control) {
      return !!this.capturing && this.capturing.kind === kind &&
        this.capturing.portIndex === portIndex && this.capturing.control === control;
    },
    startCapture(kind, portIndex, control) {
      this.stopCapture();
      this.capturing = {kind, portIndex, control};
      // Capturing phase + preventDefault so the key that's being bound
      // (e.g. Space, an arrow key) doesn't also trigger its own default
      // browser behavior (scrolling, etc.) on the very keypress that binds
      // it.
      this.keydownListener = (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.code === 'Escape') {
          this.stopCapture();
          return;
        }
        setKeyBinding(kind, portIndex, control, event.code);
        this.stopCapture();
      };
      document.addEventListener('keydown', this.keydownListener, true);
    },
    stopCapture() {
      if (this.keydownListener) {
        document.removeEventListener('keydown', this.keydownListener, true);
        this.keydownListener = null;
      }
      this.capturing = null;
    },
    handleReset() {
      this.stopCapture();
      resetKeyMapping();
    },
  },
};
</script>

<style scoped>
.key-mapping-hint {
  font-size: 0.85rem;
  color: rgba(0, 0, 0, 0.6);
}

.key-mapping-columns {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
}

.key-mapping-port {
  flex: 1 1 260px;
  min-width: 260px;
}

.key-mapping-controls {
  /* One control per row (not flex-wrap) so this always renders as exactly
     5 rows (Up/Down/Left/Right/Fire), regardless of how wide any one
     port's own bound-key labels happen to render - Player 1 and Player 2
     often bind different-length key names (e.g. "ArrowUp" vs "KeyW"), and
     flex-wrap let that push a control onto a 6th row on one side but not
     the other, leaving the Keypad heading/grid below it at a different
     height between the two columns instead of lined up. */
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
  margin-bottom: 12px;
}

.key-mapping-keypad {
  /* A real Keypad Controller is 3 columns x 4 rows (1,2,3 / 4,5,6 / 7,8,9 /
     star,0,pound) - grid, not flex-wrap, so this always keeps exactly 3 per
     row regardless of how wide any individual button's own bound-key label
     happens to render (flex-wrap let a 4th narrow button ride up onto a
     row when the first 3 were narrow enough to leave room). */
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}

/* Same flat-icon, fade-in-on-hover/blue-on-press treatment as every other
   icon button in the app (e.g. Project.vue's own .project-flat-icon-btn,
   GeneratedCode.vue's own .generated-code-flat-icon-btn) - transparent
   background (no Vuetify default hover circle), icon fades from a faint
   grey to near-black on hover, and flashes the app's own blue on an actual
   click/press. */
.emulator-flat-icon-btn {
  background-color: transparent !important;
  box-shadow: none !important;
  /* Pushes this button to the far right of .emulator-toolbar-row, flush
     with the emulator window's own right edge (#gopher2600-target-container
     shares that same row's width - see App.vue's own template). Auto
     margins still absorb a flex row's free space even when the item's own
     flex-grow is 0 - which it is here, forced by App.vue's own
     ".emulator-drawer-inner .v-btn { flex: 0 0 auto !important }" (for an
     unrelated reason - see that rule's own comment - that rules out
     growing "Refresh emulator" itself to push this button over instead). */
  margin-left: auto !important;
  margin-right: 4px !important;
}

.emulator-flat-icon-btn::before {
  display: none;
}

.emulator-flat-icon-btn >>> .v-icon {
  color: rgba(0, 0, 0, 0.38) !important;
  transition: color 0.15s ease;
}

.emulator-flat-icon-btn:hover >>> .v-icon {
  color: rgba(0, 0, 0, 0.87) !important;
}

.emulator-flat-icon-btn:active >>> .v-icon {
  color: #1976d2 !important;
}
</style>
