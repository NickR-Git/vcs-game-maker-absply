<template>
  <v-dialog v-model="open" width="400">
    <template v-slot:activator="{ on, attrs }">
      <v-btn
        :title="activatorTitle"
        icon
        small
        :class="['delete-icon-btn', iconBtnClass]"
        v-bind="attrs"
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
  </v-dialog>
</template>
<script>
// Shared by every tab's own "Delete this X?" confirm popup (Backgrounds,
// Sprites, Title screens, Sound, Music, Data, Text) - previously each tab
// duplicated its own near-identical v-menu block. A real v-dialog (not a
// v-menu) so it darkens the rest of the app the same way KeyMappingDialog.vue
// already does, rather than floating over an otherwise-interactive page.
export default {
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
