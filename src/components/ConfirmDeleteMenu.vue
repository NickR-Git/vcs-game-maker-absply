<template>
  <v-menu v-model="open" top>
    <template v-slot:activator="{ on, attrs }">
      <v-btn
        :title="activatorTitle"
        icon
        small
        :class="['delete-icon-btn', iconBtnClass]"
        v-bind="{...attrs, ...$attrs}"
        v-on="on"
      >
        <v-icon>mdi-delete</v-icon>
      </v-btn>
    </template>

    <v-card>
      <v-card-title>{{ title }}</v-card-title>
      <v-list>
        <v-list-item @click="handleConfirm">
          <v-list-item-icon>
            <v-icon>mdi-check</v-icon>
          </v-list-item-icon>
          <v-list-item-title>Yes, delete</v-list-item-title>
        </v-list-item>
        <v-list-item @click="open = false">
          <v-list-item-icon>
            <v-icon>mdi-cancel</v-icon>
          </v-list-item-icon>
          <v-list-item-title>No, don't delete</v-list-item-title>
        </v-list-item>
      </v-list>
    </v-card>
  </v-menu>
</template>
<script>
// Shared by every tab's own "Delete this X?" confirm popup (Backgrounds,
// Sprites, Title screens, Sound, Music, Data, Text) - previously each tab
// duplicated a near-identical inline v-menu block. A real v-menu
// (not a v-dialog, tried first) - a real reported requirement ("the popup
// should still appear near where the delete button is, like the old
// version"): v-dialog always centres itself in the viewport regardless of
// its activator's position, losing the anchored-right-next-to-the-button
// placement every inline version already had.
export default {
  // Any attribute a caller passes that isn't one of the declared props below
  // (e.g. TextEditor.vue's "absolute top right" positioning props on its
  // activator button) lands in $attrs instead - false here stops Vue from
  // also dumping those onto this component's root element (the v-dialog,
  // where an "absolute"/"top"/"right" prop would mean something entirely
  // different, or nothing at all), so they can be forwarded deliberately
  // (see the activator v-btn's "v-bind" below) to the one element they're
  // actually meant for instead.
  inheritAttrs: false,
  props: {
    // The confirmation question, e.g. "Delete this frame?".
    title: {type: String, required: true},
    // Tooltip on the trash-can activator button, e.g. "Delete this frame".
    activatorTitle: {type: String, required: true},
    // Extra class(es) for the activator button, matching whatever per-tab
    // icon-size class its other corner buttons already use (e.g.
    // "titlescreen-icon-btn-size").
    iconBtnClass: {type: String, default: ''},
  },
  data() {
    return {
      open: false,
    };
  },
  methods: {
    handleConfirm() {
      this.open = false;
      this.$emit('confirm');
    },
  },
};
</script>
