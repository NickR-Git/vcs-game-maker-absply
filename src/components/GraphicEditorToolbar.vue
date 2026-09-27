<template>
  <!-- @click.stop - every tab that uses this toolbar also has an outer
       "click anywhere to deselect the current card" handler (see e.g.
       PlayerEditor.vue's own @click="deselectCard" on its root v-card).
       This toolbar sits OUTSIDE any card (directly in that same v-card-text),
       so without stopping it here, clicking any tool in it - confirmed
       directly with Pencil - bubbled up and deselected the very card those
       tools are supposed to be acting on. -->
  <div
    class="graphic-editor-toolbar"
    :class="{'graphic-editor-toolbar-scrolled': isScrolled}"
    :style="bleedStyle"
    @click.stop
  >
    <slot name="before-tools" />
    <v-divider class="get-outer-divider" vertical />
    <div class="get-tools">
      <v-btn-toggle :value="activeTool" borderless>
        <v-btn
          icon
          small
          title="Eraser"
          value="eraser"
          :disabled="!activeEditor"
          @click="setTool('eraser')"
        >
          <v-icon>mdi-eraser</v-icon>
        </v-btn>
        <v-btn
          icon
          small
          title="Pencil"
          value="pencil"
          :disabled="!activeEditor"
          @click="setTool('pencil')"
        >
          <v-icon>mdi-pencil</v-icon>
        </v-btn>
      </v-btn-toggle>
      <v-divider class="get-inner-divider" vertical />
      <v-btn icon small title="Undo" :disabled="!activeEditor" @click="() => activeEditor.undo()">
        <v-icon>mdi-undo</v-icon>
      </v-btn>
      <v-btn icon small title="Redo" :disabled="!activeEditor" @click="() => activeEditor.redo()">
        <v-icon>mdi-redo</v-icon>
      </v-btn>
      <v-divider class="get-inner-divider" vertical />
      <v-btn icon small title="Export to image" :disabled="!activeEditor" @click="() => activeEditor.handleExportImage()">
        <v-icon>mdi-export</v-icon>
      </v-btn>
      <v-btn icon small title="Import from image" :disabled="!activeEditor" @click="() => activeEditor.handleImportImage()">
        <v-icon>mdi-import</v-icon>
      </v-btn>
    </div>
    <template v-if="$slots['after-tools']">
      <v-divider class="get-inner-divider" vertical />
      <slot name="after-tools" />
    </template>
  </div>
</template>
<script>
// The single toolbar shared across every tab with a graphic editor
// (PlayerEditor/BackgroundEditor/TitleScreenEditor/ScoreFontEditor/
// TextFontEditor) - previously duplicated near-verbatim in all five (same
// markup, same CSS, same activeEditor/toggledTool/handleSetTool plumbing,
// same sticky/scroll-divider/bleed trick), which made every layout tweak a
// five-file find-and-replace. Now a single component: each tab supplies
// its own zoom control/grid toggles via the "before-tools" slot (these
// differ per tab - e.g. only BackgroundEditor.vue has the "XY" pixel-
// coordinate toggle) and its own "Set height" menu (if any) via
// "after-tools" (its target card/animation differs per tab, so that
// computation stays local to each one) - everything else (the actual
// Eraser/Pencil/Undo/Redo/Export/Import icons, and the sticky-header
// behavior around them) lives here once.
export default {
  props: {
    // The PixelEditor.vue instance the toolbar currently acts on - null
    // (every button disabled, no tool highlighted) until a caller resolves
    // one, however it chooses to (an explicit frame click, a $ref fallback
    // to the selected card's own first frame, etc. - see each tab's own
    // "effectiveFrameEditor"-style computed for that logic, which stays
    // local to each tab since "which card is selected" means something
    // different in each one).
    activeEditor: {type: Object, default: null},
    // How many pixels of ancestor padding this toolbar needs to bleed
    // through (via a negative margin) to reach its real scrolling
    // ancestor's true edge, so its own scrolled-state divider spans the
    // full pane width instead of stopping at the nearest padded ancestor.
    // 16 covers one padding level (this toolbar sitting directly in a
    // tab's own v-card-text - PlayerEditor/BackgroundEditor/
    // TitleScreenEditor/ScoreFontEditor); TextFontEditor.vue passes 32,
    // since its own toolbar sits inside a SECOND nested v-card-text (the
    // "Text Minikernel Font" sub-card) on top of that.
    bleed: {type: Number, default: 16},
  },
  data() {
    return {
      isScrolled: false,
    };
  },
  computed: {
    // Reads the active editor's OWN reactive toggledTool directly (see
    // PixelEditor.vue's own comment on why that's a separate string, not
    // literally "editor.tool") - Vue tracks this cross-component property
    // access the same as any other reactive read, so this recomputes
    // correctly the instant setTool() below mutates it, with no local
    // ref/watcher of this component's own needed to keep them in sync.
    activeTool() {
      return this.activeEditor ? this.activeEditor.toggledTool : null;
    },
    bleedStyle() {
      return {
        marginLeft: `-${this.bleed}px`,
        marginRight: `-${this.bleed}px`,
        paddingLeft: `${this.bleed}px`,
        paddingRight: `${this.bleed}px`,
      };
    },
  },
  mounted() {
    // closest() (not querySelector, which only searches DESCENDANTS) since
    // .editor-container is sometimes this component's own direct ancestor
    // (PlayerEditor/BackgroundEditor/TitleScreenEditor/ScoreFontEditor) and
    // sometimes further up past an extra nested card (TextFontEditor) -
    // one call handles both without the caller needing to say which case
    // it is.
    this.scrollContainer = this.$el.closest('.editor-container');
    if (this.scrollContainer) this.scrollContainer.addEventListener('scroll', this.handleScroll);
  },
  beforeDestroy() {
    if (this.scrollContainer) this.scrollContainer.removeEventListener('scroll', this.handleScroll);
  },
  methods: {
    handleScroll(event) {
      this.isScrolled = event.target.scrollTop > 0;
    },
    setTool(tool) {
      if (this.activeEditor) this.activeEditor.setTool(tool);
    },
  },
};
</script>
<style scoped>
/* Sticks to the top of the tab's own scrolling ancestor (.editor-container
   - see mounted()'s own comment) as everything below it scrolls past, same
   position: sticky pattern every consuming tab used to implement by hand.
   background so scrolled-under content doesn't show through while pinned. */
.graphic-editor-toolbar {
  display: flex;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 2;
  background-color: #fff;
  padding-top: 4px;
  padding-bottom: 4px;
  transition: padding 0.15s ease;
}

/* Marks where the pinned bar ends and the (actually scrolling) content
   begins underneath it, once there's actually something scrolled under it
   to separate from - matches every tab's own darkened outlined-card border
   color (App.vue's shared rule), not Vuetify's fainter default divider.
   Taller once actually pinned, for a bit more visual weight/breathing room
   than the flush, unscrolled-at-the-top state needs. */
.graphic-editor-toolbar-scrolled {
  border-bottom: 1px solid rgba(0, 0, 0, 0.24);
  padding-top: 10px;
  padding-bottom: 10px;
}

/* Separates the caller's own "before-tools" controls (zoom, pixel grid
   toggles) from the standard tool icons - a wider gap than the inner
   dividers below since it's splitting two unrelated groups, not sub-groups
   within one. */
.get-outer-divider {
  margin: 0 8px;
}

.get-tools {
  display: flex;
  align-items: center;
}

.get-tools >>> .v-btn {
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  min-width: 0;
  height: 26px;
  width: 26px;
  margin: 0;
}

.get-inner-divider {
  margin: 0 2px;
}

.get-tools >>> .v-btn::before {
  display: none;
}

.get-tools >>> .v-btn .v-icon {
  font-size: 19px;
  color: var(--editor-icon-rest-color, rgba(0, 0, 0, 0.38)) !important;
  transition: color 0.15s ease, transform 0.08s ease;
}

.get-tools >>> .v-btn:not(.v-btn--disabled):hover .v-icon {
  color: rgba(0, 0, 0, 0.87) !important;
}

.get-tools >>> .v-btn:not(.v-btn--disabled):active .v-icon {
  transform: scale(0.82);
}

.get-tools >>> .v-btn.v-btn--active .v-icon {
  color: #1976d2 !important;
}

.get-tools >>> .v-btn-toggle {
  background-color: transparent !important;
}
</style>
