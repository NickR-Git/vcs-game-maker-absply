<template>
  <v-card>
    <v-card-title>Score font</v-card-title>
    <v-card-text>
      <v-select
        v-model="selectedFont"
        :items="scoreFontOptions"
        label="Score font"
      />
      <p>
        Draw the ten score digits below. They are used when the score font is
        set to <strong>Custom</strong>.
      </p>
      <div class="digit-list">
        <div class="digit" v-for="(digit, index) in state.digits" :key="index">
          <div class="digit-label">{{ index }}</div>
          <div class="digit-editor">
            <pixel-editor
              :width="8"
              :height="8"
              :aspectRatio="160/192"
              v-model="state.digits[index]"
              fgColor="#f2691e"
              :name="'score-font-digit-' + index"
              :allowChangingHeight="false"
              @input="handleChange"
            />
          </div>
        </div>
      </div>
      <v-btn class="reset-button" color="secondary" @click="handleReset">
        <v-icon>mdi-restore</v-icon>
        <div>Reset to default digits</div>
      </v-btn>
    </v-card-text>
  </v-card>
</template>
<script>
import {computed, defineComponent} from '@vue/composition-api';

import PixelEditor from '../components/PixelEditor.vue';
import {useConfigurationStorage, useScoreFontStorage} from '../hooks/project';
import {SCORE_FONT_NAMES} from '../generators/score-fonts';
import {
  CUSTOM_SCORE_FONT,
  DEFAULT_SCORE_FONT,
  fontToDigits,
  processScoreFontDefaults,
} from '../utils/score-font';

const SCORE_FONT_OPTIONS = [
  {text: 'Default', value: ''},
  ...SCORE_FONT_NAMES.map((name) => ({text: name, value: name})),
  {text: 'Custom (drawn below)', value: CUSTOM_SCORE_FONT},
];

export default defineComponent({
  components: {PixelEditor},
  setup() {
    const scoreFontStorage = useScoreFontStorage();
    const configurationStorage = useConfigurationStorage();

    // Only this one option is owned here, so it is merged into the stored
    // configuration rather than replacing it.
    const selectedFont = computed({
      get() {
        try {
          return (configurationStorage.value || {}).scoreFont || '';
        } catch (e) {
          console.error('Error loading configuration from local storage', e);
          return '';
        }
      },

      set(value) {
        configurationStorage.value = {
          ...(configurationStorage.value || {}),
          scoreFont: value,
        };
      },
    });

    const state = computed({
      get() {
        try {
          return processScoreFontDefaults(scoreFontStorage);
        } catch (e) {
          console.error('Error loading the score font from local storage', e);
          return {digits: fontToDigits(DEFAULT_SCORE_FONT)};
        }
      },

      set(newState) {
        scoreFontStorage.value = newState;
      },
    });

    // The pixel editor mutates its matrix in place, so the whole object is
    // reassigned to push it back into storage.
    const handleChange = () => {
      state.value = state.value;
    };

    const handleReset = () => {
      state.value = {digits: fontToDigits(DEFAULT_SCORE_FONT)};
    };

    return {
      state,
      handleChange,
      handleReset,
      selectedFont,
      scoreFontOptions: SCORE_FONT_OPTIONS,
    };
  },
});
</script>
<style scoped>
.digit-list {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.digit {
  width: 120px;
}

.digit-label {
  font-weight: bold;
  text-align: center;
}

.digit-editor {
  position: relative;
}

.reset-button {
  margin-top: 24px;
}
</style>
