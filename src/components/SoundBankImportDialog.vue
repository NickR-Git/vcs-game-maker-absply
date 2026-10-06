<template>
  <v-dialog :value="value" width="480" @input="(open) => $emit('input', open)">
    <v-card>
      <v-card-title>Import Sound Bank</v-card-title>
      <v-card-text>
        <p class="v-messages theme--light v-messages__message">
          Choose which sounds to import. A name that matches an existing sound effect
          replaces its parameters; anything else is added as a new card.
        </p>
        <v-btn small @click="selectAll(true)">Select all</v-btn>
        <v-btn small class="ml-2" @click="selectAll(false)">Select none</v-btn>
        <v-checkbox
          v-for="(entry, index) in entries"
          :key="index"
          v-model="entry.selected"
          :label="entry.isExisting ? `${entry.name} (replaces existing)` : entry.name"
          hide-details
          dense
        />
      </v-card-text>
      <v-card-actions>
        <v-btn small @click="$emit('input', false)">Cancel</v-btn>
        <v-spacer></v-spacer>
        <v-btn
          color="primary"
          text
          :disabled="!entries.some((entry) => entry.selected)"
          @click="$emit('confirm')"
        >
          Import selected
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script>
import {defineComponent} from '@vue/composition-api';

// The "Import Sound Bank" popup, shared by the Sound tab (a file opened from
// disk) and the Project tab's Sound Banks screen (a file from GitHub). The
// parent owns the entries (see buildSoundBankImportEntries in
// utils/sound-bank.js) and does the import when "confirm" is emitted.
export default defineComponent({
  props: {
    value: {type: Boolean, default: false},
    entries: {type: Array, default: () => []},
  },
  setup(props) {
    const selectAll = (selected) => {
      props.entries.forEach((entry) => {
        entry.selected = selected;
      });
    };
    return {selectAll};
  },
});
</script>
