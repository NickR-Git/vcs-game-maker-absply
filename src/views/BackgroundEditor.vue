<template>
  <div>
    <v-card class="editor-container" :ripple="false" @click="deselectCard">
      <v-card-title>Backgrounds</v-card-title>
      <v-card-text class="tab-intro-section">
        <p class="v-messages theme--light v-messages__message background-intro-paragraph">
          Draw full-screen playfield backgrounds here, then set one as the active background
          with a "Background" block (Actions tab). Each pixel is either on or off; if "Enable
          per-row playfield colors (pfcolors)" is turned on (Options tab), each row can have
          its color instead of one fixed color for the whole background.
        </p>

        <graphic-editor-toolbar class="tight-under-intro" :active-editor="effectiveEditor" @height-hotkey="handleSetHeightHotkey">
          <template v-slot:before-tools>
            <editor-zoom v-model="zoom" />
            <pixel-grid-toggle v-model="showPixelGrid" />
            <pixel-grid-toggle
              v-model="showPixelGridLabels"
              :icon="null"
              label="XY"
              title-on="Hide pixel coordinates (Shift+')"
              title-off="Show pixel coordinates (Shift+')"
              :disabled="!showPixelGrid"
              disabled-title="Turn on the pixel grid to show coordinates"
            />
          </template>
          <template v-slot:after-tools>
            <div class="text-center">
              <v-dialog
                v-model="heightMenuVisible"
                width="480"
              >
                <template v-slot:activator="{ on, attrs }">
                  <v-btn
                    text
                    small
                    class="unified-toolbar-height-btn"
                    title="Set height (H)"
                    :disabled="!selectedBackground"
                    v-bind="attrs"
                    v-on="on"
                    @click="openHeightMenu"
                  >
                    <v-icon>mdi-human-male-height-variant</v-icon>
                  </v-btn>
                </template>

                <v-card>
                  <v-list>
                    <v-list-item>
                      <v-list-item-content>
                        <v-list-item-title>Set height for the selected background</v-list-item-title>
                      </v-list-item-content>
                    </v-list-item>
                  </v-list>

                  <v-divider></v-divider>

                  <v-list>
                    <v-list-item>
                      <v-list-item-action>

                        <v-slider
                          v-model="heightMenuValue"
                          :min="1"
                          :max="64"
                          label="Height"
                          class="align-center"
                          style="width: 400px"
                        >
                          <template v-slot:append>
                            <v-text-field
                              v-model="heightMenuValue"
                              class="mt-0 pt-0"
                              type="number"
                              style="width: 60px"
                            ></v-text-field>
                          </template>
                        </v-slider>

                      </v-list-item-action>
                    </v-list-item>
                  </v-list>

                  <div class="unified-toolbar-scale-checkbox">
                    <v-checkbox
                      v-model="heightMenuScaleContents"
                      label="Scale existing contents (nearest neighbor)"
                      hide-details
                      dense
                    />
                  </div>

                  <v-card-actions>
                    <v-spacer></v-spacer>

                    <v-btn
                      text
                      @click="heightMenuVisible = false"
                    >
                      Cancel
                    </v-btn>
                    <v-btn
                      color="primary"
                      text
                      @click="handleUnifiedSetHeight()"
                    >
                      Set height
                    </v-btn>
                  </v-card-actions>
                </v-card>
              </v-dialog>
            </div>
          </template>
          <template v-if="pfColorsEnabled" v-slot:below-tools>
            <quick-color-palette v-model="selectedQuickColor" :active-editor="effectiveEditor" />
          </template>
        </graphic-editor-toolbar>
        <v-list
          class="background-list"
          :style="{gridTemplateColumns: `repeat(auto-fill, calc(${editorWidth} + 24px))`}"
        >
          <v-list-item
            class="entry-list-item"
            v-for="(background, index) in state.backgrounds"
            v-bind:key="background.id"
          >
            <v-list-item-content>
              <v-card
                outlined
                :ripple="false"
                class="background-card"
                :class="[dragCardClass(index), {'background-card-selected': background.id === selectedCardId}]"
                v-on="dragTargetListeners(index)"
                @click.stop="selectCard(background.id)"
              >
                <div
                  class="background-drag-handle"
                  title="Drag to reorder"
                  v-bind="dragAttrs(index)"
                  v-on="dragHandleListeners(index)"
                />
                <v-list-item-title>
                  <v-btn
                    :title="isCollapsed(background) ? 'Expand this background' : 'Collapse this background'"
                    icon
                    small
                    absolute
                    top
                    left
                    class="background-collapse-btn"
                    @click="() => toggleCollapsed(background)"
                  >
                    <v-icon>{{ isCollapsed(background) ? 'mdi-chevron-down' : 'mdi-chevron-up' }}</v-icon>
                  </v-btn>
                  <div class="background-id-badge">ID:{{ background.id }}</div>
                  <v-text-field
                    class="background-name-field"
                    label="Background name"
                    v-model="background.name"
                    @change="handleChildChange"
                  />

                  <div class="background-corner-toolbar">
                    <v-btn
                      v-if="pfColorsEnabled"
                      icon
                      small
                      title="Copy this background's row colors only"
                      class="player-icon-btn-size copy-paste-color-btn"
                      @click="() => handleCopyBackgroundRowColors(background)"
                    >
                      <v-icon>mdi-content-copy</v-icon>
                      <span class="copy-paste-color-badge">C</span>
                    </v-btn>
                    <v-btn
                      v-if="pfColorsEnabled"
                      icon
                      small
                      :disabled="!copiedBackgroundRowColors"
                      title="Paste copied row colors only onto this background"
                      class="player-icon-btn-size copy-paste-color-btn"
                      @click="() => handlePasteBackgroundRowColors(background)"
                    >
                      <v-icon>mdi-content-paste</v-icon>
                      <span class="copy-paste-color-badge">C</span>
                    </v-btn>
                    <confirm-delete-menu
                      v-if="state.backgrounds.length > 1"
                      title="Delete this background?"
                      activator-title="Delete this background"
                      icon-btn-class="player-icon-btn-size"
                      @confirm="handleDeleteBackground(background)"
                    />
                  </div>
                </v-list-item-title>
                <v-list-item-subtitle v-if="!isCollapsed(background)">
                  <!-- aspectRatio is (32 * PF_COLUMN_WIDTH_PX) / (background.pixels.length *
                       pfRowDivisorFor(config)) - real screen width (32 columns *
                       PF_COLUMN_WIDTH_PX = 128px (the playfield is 128 of the screen's 160
                       pixels wide), always, regardless of pfres/Superchip - see
                       that constant's comment in utils/playfield-coords.js) over THIS
                       background's real total height (its row count * that row
                       count's real scanline height - pfRowDivisorFor's comment explains
                       why that per-row height isn't a flat constant either). Deliberately NOT
                       a flat ratio (an earlier fix used a fixed 96-scanline total, assuming
                       every background's row count always exactly matches pfres) - that
                       broke the one case a background's row count DOESN'T match pfres: a
                       background the user explicitly resized taller via "Set height"
                       (background.customHeight - see reflowBackgroundsToHeight's comment
                       in blocks/background.js, which deliberately leaves such a background's
                       row count alone on every pfres change) genuinely has MORE real scanlines
                       than a fixed 96 assumes, so it needs its actual row count factored
                       back in - confirmed as a real reported bug ("aspect ratio is not
                       updating when background graphic is taller than pfres value"). An
                       ordinary (non-custom-height) background's row count already tracks
                       pfres automatically, so this still lands on the exact same ratio that
                       background would have gotten from a pfres-only calculation - this isn't
                       a regression back to the ORIGINAL row-count-dependent bug (dividing by
                       row count while using a FIXED per-row height, which is what actually
                       broke for other pfres values before - see git history), since
                       pfRowDivisorFor itself already accounts for pfres correctly. -->
                  <div class="pixel-editor-container" :style="{width: editorWidth, maxWidth: editorWidth}">
                    <pixel-editor
                      :ref="pixelEditorRefKey(background)"
                      :width="32"
                      :height="background.pixels.length"
                      :aspectRatio="backgroundAspectRatio(background)"
                      name="background"
                      :value="background.pixels"
                      fgColor="orange"
                      :rowColors="editorRowColors(background)"
                      :allowChangingHeight="true"
                      :showClearButton="true"
                      :showGrid="showPixelGrid"
                      :showCellIds="showPixelGrid && showPixelGridLabels"
                      :hideToolbar="true"
                      @input="(pixels) => handleBackgroundPixelsInput(background, pixels)"
                      @clear="() => handleClearRowColors(background)"
                      @clear-colors="() => handleClearRowColors(background)"
                      @activate="(editorInstance) => setActiveEditor(editorInstance, background.id)"
                    >
                      <template v-if="pfColorsEnabled" v-slot:sidebar>
                        <playfield-color-strip
                          :value="background.rowColors"
                          :quickColors="quickColorPalette"
                          :activeQuickColor="selectedQuickColor"
                          @input="(colors) => handleRowColorsInput(background, colors)"
                        />
                      </template>
                      <template v-slot:toolbar-end>
                        <v-btn
                          icon
                          small
                          title="Copy this background's image (and row colors, if any)"
                          class="player-icon-btn-size"
                          @click="() => handleCopyBackground(background)"
                        >
                          <v-icon>mdi-content-copy</v-icon>
                        </v-btn>
                        <v-btn
                          icon
                          small
                          :disabled="!copiedBackgroundData"
                          title="Paste copied image (and row colors, if any) onto this background"
                          class="player-icon-btn-size"
                          @click="() => handlePasteBackground(background)"
                        >
                          <v-icon>mdi-content-paste</v-icon>
                        </v-btn>
                      </template>
                    </pixel-editor>
                  </div>
                </v-list-item-subtitle>
              </v-card>
            </v-list-item-content>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>

    <v-btn
      class="add-frame-buttom"
      color="primary"
      title="Add background"
      dark
      absolute
      right
      fab
      @click="handleAddBackground"
    >
      <v-icon>mdi-plus</v-icon>
    </v-btn>
  </div>
</template>
<script>
import {computed, defineComponent, getCurrentInstance, ref} from '@vue/composition-api';
import {max} from 'lodash';

import {useCollapsedIds} from '../hooks/collapse';
import {CSS_CLASS_DRAGGING} from '../hooks/drag-reorder';
import ConfirmDeleteMenu from '../components/ConfirmDeleteMenu.vue';
import EditorZoom from '../components/EditorZoom.vue';
import GraphicEditorToolbar from '../components/GraphicEditorToolbar.vue';
import PixelEditor from '../components/PixelEditor.vue';
import PixelGridToggle from '../components/PixelGridToggle.vue';
import PlayfieldColorStrip from '../components/PlayfieldColorStrip.vue';
import QuickColorPalette from '../components/QuickColorPalette.vue';
import {useBackgroundsStorage, useColorPaletteStorage, useConfigurationStorage,
  usePixelGridOverlayStorage, usePixelGridLabelsStorage} from '../hooks/project';
import {useEditorZoom} from '../hooks/zoom';
import {colorByteToCss} from '../utils/palette';
import {PF_COLUMN_WIDTH_PX, pfRowDivisorFor} from '../utils/playfield-coords';
import {resizePixelMatrixHeight} from '../utils/pixels';
import {DEFAULT_BACKGROUNDS, DEFAULT_ROW_COLOR, clearRowColors, effectiveBackgroundRows,
  processBackgroundStorageDefaults} from '../blocks/background';

// Width of one background editor at 100% zoom.
const EDITOR_BASE_WIDTH = 480;

// A blank canvas (every pixel off), sized to whatever the current playfield
// resolution is - not a fixed row count, since Superchip's pfres setting can
// make that row count anything from 11 to 32. Used for new backgrounds
// instead of pre-drawing anything (a rectangular border was tried first and
// reverted: a brand new background starting with existing pixels already
// set meant clearing them by hand was the normal first step before drawing
// anything new, every time - matches how a new player animation frame
// starts blank too, see PlayerEditor.vue's  handleAddAnimation).
const buildDefaultBackgroundPixels = (rows, cols = 32) =>
  new Array(rows).fill(0).map(() => new Array(cols).fill(0));

// Same "module-scope, not a ref inside setup()" reasoning as
// PlayerEditor.vue's  copiedFrameRowColors/copiedFrameData - keeps the
// clipboard alive across navigating away from and back to this tab (Vue
// Router destroys and recreates this component each time).
const copiedBackgroundRowColors = ref(null);
const copiedBackgroundData = ref(null);

export default defineComponent({
  components: {ConfirmDeleteMenu, EditorZoom, GraphicEditorToolbar, PixelEditor, PixelGridToggle, PlayfieldColorStrip, QuickColorPalette},
  setup() {
    const instance = getCurrentInstance();
    const backgroundsStorage = useBackgroundsStorage();
    const configurationStorage = useConfigurationStorage();
    const zoom = useEditorZoom('background');
    const editorWidth = computed(() => `${Math.round(EDITOR_BASE_WIDTH * zoom.value)}px`);
    // See the template's comment on where this background pixel editor's
    // aspectRatio comes from - real playfield width (always 128px) over THIS
    // background's real total height (its row count, not
    // necessarily pfres's - see customHeight - times that row count's real
    // scanline height).
    const backgroundAspectRatio = (background) =>
      (32 * PF_COLUMN_WIDTH_PX) / (background.pixels.length * pfRowDivisorFor(configurationStorage.value));
    // Shared with PlayerEditor.vue's  Player 0/1 tabs (see
    // PixelGridToggle.vue's  comment).
    const showPixelGrid = usePixelGridOverlayStorage();
    // Background-tab-only (see usePixelGridLabelsStorage's  comment) -
    // controls the grid overlay's "X,Y" cell labels independently of the
    // grid lines themselves (showPixelGrid above).
    const showPixelGridLabels = usePixelGridLabelsStorage();

    // Same "armed color for direct-painting" reasoning as PlayerEditor.vue's
    // selectedQuickColor - v-model'd to the QuickColorPalette instance
    // above, passed into PlayfieldColorStrip's  activeQuickColor prop
    // below. Read-only access to the palette DATA itself
    // (quickColorPalette) - QuickColorPalette owns writing to that shared
    // storage; this just needs the list to pass into PlayfieldColorStrip's
    // quickColors prop.
    const selectedQuickColor = ref(null);
    const colorPaletteStorage = useColorPaletteStorage();
    const quickColorPalette = computed(() => colorPaletteStorage.value || []);

    // The playfield's row count is a single setting for the whole ROM (see
    // the Options tab's Superchip/pfres controls), not something each
    // background can override individually.
    const backgroundRows = computed(() =>
      effectiveBackgroundRows(configurationStorage && configurationStorage.value));

    // Per-row playfield colors (batari Basic pfcolors) are an all-or-nothing,
    // project-wide setting (see the Options tab) - once it's on, every
    // background needs its  color list, since the compiled kernel always
    // draws every background's playfield from that color table.
    const pfColorsEnabled = computed(() =>
      (configurationStorage && configurationStorage.value && configurationStorage.value.enablePfColors) ?? false);

    // Fills in a missing/mismatched-length row color list so every background
    // has one whenever per-row colors are enabled, without clobbering colors
    // the user already picked. Left alone (not deleted) while the option is
    // off, so re-enabling it doesn't lose prior work.
    const ensureRowColors = (background, rows) => {
      if (!pfColorsEnabled.value) return;
      const existing = background.rowColors || [];
      if (existing.length === rows) return;
      const next = existing.slice(0, rows);
      while (next.length < rows) next.push(DEFAULT_ROW_COLOR);
      background.rowColors = next;
    };

    // Purely a visual "which card am I looking at" marker - same
    // selectCard/selectedCardId/deselectCard pattern as MusicEditor.vue's
    // song cards and the other tabs'  entry cards (see
    // MusicEditor.vue's  comment for the full reasoning): plain local
    // component state, not persisted, not wired into anything else.
    const selectedCardId = ref(null);
    const selectCard = (id) => {
      selectedCardId.value = id;
    };
    const deselectCard = () => {
      selectedCardId.value = null;
    };

    // Tracks whichever background's PixelEditor instance was last
    // clicked into (see its "activate" event, emitted from PixelEditor.vue's
    // handleActivate) - the single toolbar above (Eraser/Pencil/Undo/Redo/
    // Export/Import) acts on THIS editor, since every card's
    // per-instance toolbar is now hidden (hideToolbar on the pixel-editor
    // below) in favor of this one shared row. Same mechanism as
    // PlayerEditor.vue's activeFrameEditor/setActiveFrame.
    // activeBackgroundId is what effectiveEditor below compares against
    // selectedBackground to decide whether this explicit click still
    // "wins" over the selected card's fallback editor.
    const activeEditor = ref(null);
    const activeBackgroundId = ref(null);
    const setActiveEditor = (editorInstance, backgroundId) => {
      activeEditor.value = editorInstance;
      activeBackgroundId.value = backgroundId;
    };

    // Unique per background - used as its PixelEditor.vue $ref name (see
    // the template) so effectiveEditor (declared further below, once
    // selectedBackground itself exists) can resolve straight to its
    // component instance.
    const pixelEditorRefKey = (background) => `pixelEditor_${background.id}`;

    const state = computed({
      get() {
        try {
          const data = processBackgroundStorageDefaults(backgroundsStorage);
          data.backgrounds.forEach((background) => ensureRowColors(background, background.pixels.length));
          return data;
        } catch (e) {
          console.error('Error loading backgrounds from local storage', e);
          return DEFAULT_BACKGROUNDS;
        }
      },

      set(newState) {
        backgroundsStorage.value = newState;
      },
    });

    const handleChildChange = () => {
      state.value = state.value;
    };

    // The card the shared "Set height" tool acts on - null (and the tool
    // disabled) until a card is selected. Same reasoning as PlayerEditor.
    // vue's selectedAnimation: keyed off selectedCardId (the card the
    // user is actually looking at), not activeEditor (the last editor
    // clicked INTO to draw/undo/etc.), so it can't stay pointed at a stale
    // background from a different card that was merely drawn on earlier.
    const selectedBackground = computed(
        () => state.value.backgrounds.find((background) => background.id === selectedCardId.value) || null);

    // What the shared toolbar (Eraser/Pencil/Undo/Redo/Export/Import) above
    // actually acts on - the explicitly-clicked-into editor (activeEditor)
    // when it still belongs to the currently SELECTED background, otherwise
    // the selected background's editor, resolved via its $ref. Without
    // this fallback, the tools stayed disabled (and no editor was targeted
    // at all) until a graphic was clicked directly - reported as unexpected,
    // since selecting a card (clicking its title/name field/anywhere else in
    // it) already conveys "I'm working on this one" the same way every other
    // per-card tool in this app already treats it. Same reasoning/shape as
    // PlayerEditor.vue's effectiveFrameEditor. Declared here (not
    // alongside activeEditor above) purely for readability - it reads
    // selectedBackground, so it makes more sense sitting next to it.
    const effectiveEditor = computed(() => {
      if (activeEditor.value && selectedBackground.value && activeBackgroundId.value === selectedBackground.value.id) {
        return activeEditor.value;
      }
      if (selectedBackground.value) {
        const refs = instance.proxy.$refs[pixelEditorRefKey(selectedBackground.value)];
        return Array.isArray(refs) ? refs[0] || null : refs || null;
      }
      return null;
    });

    // Same fields as PixelEditor.vue's height-menu state, now living
    // here instead, since the menu itself moved to this shared toolbar.
    const heightMenuVisible = ref(false);
    const heightMenuValue = ref(0);
    const heightMenuScaleContents = ref(false);
    const openHeightMenu = () => {
      if (!selectedBackground.value) return;
      heightMenuValue.value = selectedBackground.value.pixels.length;
      heightMenuScaleContents.value = false;
    };
    // The "H" hotkey - see PlayerEditor.vue's handleSetHeightHotkey for
    // why this can't just call openHeightMenu alone.
    const handleSetHeightHotkey = () => {
      if (!selectedBackground.value) return;
      openHeightMenu();
      heightMenuVisible.value = true;
    };
    const handleUnifiedSetHeight = () => {
      const background = selectedBackground.value;
      if (!background) return;
      heightMenuValue.value = Math.max(1, Math.min(64, heightMenuValue.value || 0));
      if (heightMenuValue.value !== background.pixels.length) {
        // Same customHeight flag handleBackgroundPixelsInput/
        // handlePasteBackground set on any other resize - opts this
        // background out of reflowBackgroundsToHeight's automatic
        // pfres-driven row count, so a later Superchip pfres change doesn't
        // silently undo this resize.
        background.customHeight = true;
        background.pixels = resizePixelMatrixHeight(
            background.pixels, heightMenuValue.value, 32, heightMenuScaleContents.value);
      }
      handleChildChange();
      instance.proxy.$forceUpdate();
      heightMenuVisible.value = false;
    };

    // Handles the pixel editor's "input" event for a background's
    // pixel grid - a plain pixel edit (drawing/erasing) never changes the
    // row count, but the pixel editor's "Set height" tool (enabled here via
    // allowChangingHeight) emits a resized array instead. Marking
    // customHeight the moment a resize is detected is what lets
    // reflowBackgroundsToHeight (blocks/background.js) leave this
    // background alone from then on, even if pfres later changes -
    // otherwise a pfres change would silently truncate/pad rows the user
    // added on purpose (e.g. for a future vertical scroll block to pan
    // through).
    const handleBackgroundPixelsInput = (background, pixels) => {
      if (pixels.length !== background.pixels.length) background.customHeight = true;
      background.pixels = pixels;
      handleChildChange();
    };

    // Every card starts collapsed on every visit to this tab (see
    // collapseAll's  comment in hooks/collapse.js), not just ones never
    // expanded before.
    const {isCollapsed, toggleCollapsed, collapseAll} = useCollapsedIds('background', true);
    collapseAll();

    // Card reordering - NOT built on hooks/drag-reorder.js's
    // useDragReorder (used as-is by SoundFXEditor.vue/MusicEditor.vue's
    // single-column card lists), since that hook's  top-border
    // drag-over convention only makes sense for a strictly vertical stack.
    // .background-list is a CSS grid (see its  comment - two or more
    // cards can sit side by side on a wide enough window), where the
    // meaningful drop-target edge is left/right (which card this lands
    // before/after in reading order), not top/bottom - same reasoning as
    // TextEditor.vue's  identical replacement.
    const draggedIndex = ref(null);
    // {index, side} - side is 'before' or 'after', which HALF of card
    // `index` the pointer is currently over.
    const dragOverEntry = ref(null);
    const isEntryDragging = (index) => draggedIndex.value === index;
    const isEntryDragOver = (index) =>
      !!dragOverEntry.value && dragOverEntry.value.index === index && !isEntryDragging(index);
    const entryDragOverSide = (index) => (isEntryDragOver(index) ? dragOverEntry.value.side : null);
    const dragCardClass = (index) => ({
      [CSS_CLASS_DRAGGING]: isEntryDragging(index),
      'background-card-drag-over-before': entryDragOverSide(index) === 'before',
      'background-card-drag-over-after': entryDragOverSide(index) === 'after',
    });
    const dragOverSideFor = (event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return (event.clientX - rect.left) < rect.width / 2 ? 'before' : 'after';
    };
    const dragAttrs = () => ({draggable: true});
    const dragHandleListeners = (index) => ({
      dragstart: (event) => {
        draggedIndex.value = index;
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', String(index));
      },
      dragend: () => {
        draggedIndex.value = null;
        dragOverEntry.value = null;
      },
    });
    const dragTargetListeners = (index) => ({
      dragover: (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        const side = dragOverSideFor(event);
        const current = dragOverEntry.value;
        if (!current || current.index !== index || current.side !== side) {
          dragOverEntry.value = {index, side};
        }
      },
      dragleave: (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        if (isEntryDragOver(index) || isEntryDragging(index)) dragOverEntry.value = null;
      },
      drop: (event) => {
        event.preventDefault();
        const from = draggedIndex.value;
        draggedIndex.value = null;
        dragOverEntry.value = null;
        if (from == null || from === index) return;
        const side = dragOverSideFor(event);
        let insertAt = side === 'after' ? index + 1 : index;
        if (from < insertAt) insertAt--;
        if (insertAt === from) return;
        const items = state.value.backgrounds.slice();
        const [moved] = items.splice(from, 1);
        items.splice(insertAt, 0, moved);
        state.value.backgrounds = items;
        handleChildChange();
      },
    });

    const handleRowColorsInput = (background, colors) => {
      background.rowColors = colors;
      handleChildChange();
      // The editors hold their  display state, so persisting isn't enough to
      // repaint the preview — force a re-render so the pixel editor receives the
      // updated row colors and recolors its canvas.
      instance.proxy.$forceUpdate();
    };

    // Clearing a graphic (PixelEditor.vue's "clear" event, separate from
    // an ordinary pixel edit) resets its row colors back to the same default
    // every row starts at, rather than leaving old per-row picks behind on
    // an otherwise blank graphic.
    const handleClearRowColors = (background) => {
      if (!pfColorsEnabled.value || !background.rowColors) return;
      background.rowColors = clearRowColors(background.rowColors);
      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    // CSS colors passed to the pixel editor so it can tint each row. Returns
    // null when per-row colors are off (uniform fgColor). A pure black row
    // ($00) is nudged to near-black so the editor still counts those pixels
    // as "on" rather than reading them as the black background.
    const editorRowColors = (background) => {
      if (!pfColorsEnabled.value || !background.rowColors) {
        return null;
      }
      return background.rowColors.map((byte) => {
        const css = colorByteToCss(byte);
        return css === '#000000' ? '#010101' : css;
      });
    };

    // Same "colors-only" pair as PlayerEditor.vue's
    // handleCopyRowColors/handlePasteRowColors, applied to a background's
    // rowColors instead of a frame's.
    const handleCopyBackgroundRowColors = (background) => {
      copiedBackgroundRowColors.value = structuredClone(background.rowColors || []);
    };
    const handlePasteBackgroundRowColors = (background) => {
      if (!copiedBackgroundRowColors.value) return;
      handleRowColorsInput(background, structuredClone(copiedBackgroundRowColors.value));
    };

    // Same "whole image, pixels + row colors together" pair as
    // PlayerEditor.vue's  handleCopyFrame/handlePasteFrame.
    const handleCopyBackground = (background) => {
      copiedBackgroundData.value = {
        pixels: structuredClone(background.pixels),
        ...(pfColorsEnabled.value && background.rowColors ?
          {rowColors: structuredClone(background.rowColors)} : {}),
      };
    };
    const handlePasteBackground = (background) => {
      if (!copiedBackgroundData.value) return;
      // Same reasoning as handleBackgroundPixelsInput's customHeight
      // check - pasting a taller/shorter image is just as much a resize as
      // dragging the pixel editor's "Set height" slider.
      if (copiedBackgroundData.value.pixels.length !== background.pixels.length) {
        background.customHeight = true;
      }
      background.pixels = structuredClone(copiedBackgroundData.value.pixels);
      if (pfColorsEnabled.value && copiedBackgroundData.value.rowColors) {
        background.rowColors = structuredClone(copiedBackgroundData.value.rowColors);
      }
      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    const handleAddBackground = () => {
      const backgrounds = state.value.backgrounds;
      const maxId = max(backgrounds.map((o) => o.id)) || 0;
      const newBackground = {
        id: maxId + 1,
        name: 'Background',
        pixels: buildDefaultBackgroundPixels(backgroundRows.value),
      };

      state.value.backgrounds.push(newBackground);

      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    const handleDeleteBackground = (background) => {
      state.value.backgrounds = state.value.backgrounds.filter(({id}) => id != background.id);
      console.info('Deleted ', background);
      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    return {selectedCardId, selectCard, deselectCard, backgroundAspectRatio,
      state, handleChildChange, handleBackgroundPixelsInput, handleAddBackground, handleDeleteBackground,
      selectedQuickColor, quickColorPalette,
      handleRowColorsInput, handleClearRowColors, editorRowColors, isCollapsed, toggleCollapsed,
      zoom, showPixelGrid, showPixelGridLabels, editorWidth, backgroundRows, pfColorsEnabled,
      dragAttrs, dragCardClass, dragHandleListeners, dragTargetListeners,
      copiedBackgroundRowColors, handleCopyBackgroundRowColors, handlePasteBackgroundRowColors,
      copiedBackgroundData, handleCopyBackground, handlePasteBackground,
      activeEditor, setActiveEditor, selectedBackground,
      effectiveEditor, pixelEditorRefKey,
      heightMenuVisible, heightMenuValue, heightMenuScaleContents, openHeightMenu, handleUnifiedSetHeight,
      handleSetHeightHotkey};
  },
});
</script>
<style scoped>
/* max-width is set inline from the zoom factor. */

/* Vuetify sets overflow: hidden on list-item content/subtitle (for text
   ellipsis), which clips the pixel editor card's shadow on the flush left and
   bottom edges. Let it show. */
.editor-container >>> .v-list-item__content,
.editor-container >>> .v-list-item__subtitle {
  overflow: visible;
}

.editor-container {
  position: absolute;
  overflow: auto;
  top: 0;
  bottom: 0;
  width: 100%;
}

/* v-list-item's  default 0 16px padding stacks on top of v-card-text's,
   pushing the graphic card in further than the Score tab's, which sits
   directly in a v-card-text with no list-item wrapper. Zeroing both sides
   (not just left, as this used to) keeps the card's right edge from sitting
   16px further in than its left edge. */
/* padding-top/bottom zeroed too (not just left/right) - Vuetify's
   default vertical list-item padding was adding extra space between grid
   ROWS on top of .background-list's 8px row gap, without adding
   anything similar between columns (that's handled entirely by the grid's
   column-gap), so rows visibly had more space than columns despite the
   grid's gap being uniform. Zeroing this leaves the grid's gap as the
   only source of spacing in either direction, matching row/column spacing
   exactly. */
.entry-list-item {
  padding: 0;
}

/* v-list-item__content (a Vuetify-owned element between .entry-list-item
   and .background-card, not directly reachable without a deep selector)
   carries its default 12px top/bottom padding - on top of the grid's
   row gap AND .background-card's 12px padding, this was adding a
   third, easy-to-miss source of extra space above/below each card. */
/* overflow: visible added alongside the padding reset (see MusicEditor.vue's
   identical fix) - stops this element's default "overflow: hidden" from
   clipping a selected card's 2px outline - min-width: 0 has to come
   with it (same comment there for the full explanation): overflow: visible
   silently undoes a flex item's default 0 min-width, letting it refuse
   to shrink below its widest content instead of the tab's width. */
.entry-list-item >>> .v-list-item__content {
  padding: 0;
  overflow: visible;
  min-width: 0;
}

/* Same grid layout as TextEditor.vue's .text-list - lets more than one
   background card fit per row on a wide enough window/zoom level instead of
   each always spanning a full row, at the user's request. Unlike
   .text-list's static minmax(280px, 1fr), the column size here is bound
   inline (see the template) to a literal editorWidth - not minmax(editorWidth,
   1fr) - since a background card's width is exactly the graphic's width,
   with nothing that benefits from stretching wider: 1fr would have grown
   the single column (and so the card) to fill the entire remaining row
   whenever only one fit, making it far wider than the graphic actually
   needs. A literal, fixed track size means each column is always exactly
   editorWidth, however many fit, with any leftover row space simply left
   empty instead of stretched into a card.

   "+ 24px" accounts for .background-card's 12px padding on each side
   (below) - editorWidth alone is only the pixel editor's inner width,
   so a column sized to exactly that was 24px too narrow for the card
   actually wrapping it, and the card's real (wider) box overflowed into
   its neighbor's column instead of fitting in its. */
/* margin-top restores the gap above the FIRST row that used to come from
   v-list-item__content's 12px top padding (see .entry-list-item's
   comment on zeroing that) - zeroing it fixed the (unwanted) extra space
   BETWEEN rows, but also removed the (wanted) space between the editor-zoom
   control above and the first row, which this puts back without
   reintroducing any inter-row gap (a margin on the grid container itself
   only affects space before its first row, not the row gap between items). */
.background-list {
  display: grid;
  gap: 8px;
  align-items: start;
  /* Tighter than the 12px this used to be (matching the old margin-top
     comment further up, before the sticky toolbar row existed) - see
     PlayerEditor.vue's identical .animation-list rule for why: the toolbar
     row directly above already has its top/bottom padding, so the old
     value on top of that read as too much combined space before the first
     card. */
  margin-top: 4px;
}

/* Same rounded, thin-bordered look as the Sound/Data/Text/Music tabs'
   per-item cards (e.g. SoundFXEditor's .soundfx-card) - this one wraps
   directly around the existing v-list-item-title/subtitle content (rather
   than switching to a v-card-text section like those tabs use) so the
   change is just the border, not a layout rework; padding here replaces the
   internal spacing a v-card-text would otherwise have provided. */
/* width: 100% - without it, the card (nested inside v-list-item-content,
   not itself the grid item .background-list sizes) shrinks to fit its
   content's natural width instead of filling the grid column .background-
   list already fixed to editorWidth + 24px (see its comment). A
   collapsed card's content (just the title row) is narrower than that
   fixed column, so it rendered visibly narrower than an expanded card
   (whose pixel editor forces the full editorWidth) instead of both being
   the same width the grid already allocated for them. */
.background-card {
  position: relative;
  width: 100%;
  padding: 12px;
}

/* PixelEditor.vue always wraps itself in its  outlined v-card with
   card-text padding - useful standalone (e.g. each Player tab animation
   frame, where it's the only border that card has), but redundant once
   .background-card above already frames the WHOLE background entry the
   same way, showing as a visible second "inner" border-plus-padding around
   just the graphic/tools. Stripped here, scoped to this nested instance
   only, rather than changing PixelEditor.vue itself (which would remove
   the Player tabs' only border). */
.pixel-editor-container >>> .v-card {
  border: none !important;
  box-shadow: none !important;
}

/* PixelEditor.vue's left/right v-card-text/v-card-actions padding
   (see its comment) is meant for standalone use - redundant here since
   .background-card above already pads the WHOLE background entry the same
   way (12px), doubling up (12+16=28px) into a visibly wider left/right
   gutter around just the graphic/tools, and a taller bottom gutter, than
   every other tab has. Zeroed back out, scoped to this nested instance
   only, so .background-card's 12px is the only gutter left. */
.pixel-editor-container >>> .v-card__text {
  padding-left: 0 !important;
  padding-right: 0 !important;
}

.pixel-editor-container >>> .v-card__actions {
  padding-left: 0 !important;
  padding-right: 0 !important;
  padding-bottom: 0 !important;
}

/* Only this top strip is draggable (see hooks/drag-reorder.js's
   comment on why) - covers the same header band the collapse/ID/delete
   controls already occupy. Sits behind them (they're later in DOM order,
   so they paint on top and stay clickable) but in front of everything
   else, so a click-and-drag gesture anywhere else in the card still selects
   text/drags the pixel editor instead of starting a reorder drag. */
.background-drag-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  cursor: grab;
}

.drag-reorder-dragging {
  opacity: 0.4;
}

/* Which side of THIS card a dragged one would land on (see
   entryDragOverSide/dragOverSideFor) - left/right, not hooks/
   drag-reorder.js's top-border convention, since .background-list is a
   CSS grid that can put more than one card on the same row (see its
   comment) - left/right is what actually reflects reading-order position
   within it. */
.background-card-drag-over-before {
  border-left: 3px solid var(--v-primary-base, #1976d2) !important;
}

.background-card-drag-over-after {
  border-right: 3px solid var(--v-primary-base, #1976d2) !important;
}

/* Sits in v-list-item-title, which (unlike the pixel editor's  toolbar)
   is always rendered regardless of collapse state, so the toolbar stays
   visible on a collapsed card instead of disappearing along with the pixel
   editor. Same "one flex row of whichever buttons are actually present"
   reasoning as PlayerEditor.vue's .frame-corner-toolbar - the color
   copy/paste pair is only shown while per-row playfield colors is on. */
.background-corner-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
}

/* Same reasoning as PlayerEditor.vue's  identical rule - lets the
   color-only badge (position: absolute) anchor to the button itself. */
.copy-paste-color-btn {
  position: relative;
}

.copy-paste-color-badge {
  position: absolute;
  bottom: 3px;
  right: -2px;
  font-size: 8px;
  font-weight: bold;
  line-height: 1;
  padding: 0 1px;
  border-radius: 2px;
  background: white;
  color: rgba(0, 0, 0, 0.7);
  pointer-events: none;
}

/* .player-icon-btn-size's size/disabled-opacity/icon-font-size rules,
   and .delete-icon-btn.player-icon-btn-size's mdi-delete size bump -
   see App.vue's shared, unscoped copy (moved there once confirmed
   byte-identical to PlayerEditor.vue's copy of this exact class name -
   scoped CSS can't share a rule across components even under the same
   class name, so each tab using it still has to apply it here). */

/* The "Set height" button passed into GraphicEditorToolbar.vue's
   "after-tools" slot - see PlayerEditor.vue's identical rule for why this
   stays here rather than moving into that shared component. */
/* !important on width/min-width - see PlayerEditor.vue's identical rule for
   why (Vuetify's ".v-btn.v-size--small" default otherwise wins). */
.unified-toolbar-height-btn {
  width: auto !important;
  min-width: 0 !important;
  margin-left: -6px !important;
  padding: 0 2px;
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.55);
  background-color: transparent !important;
  box-shadow: none !important;
}

/* Same rest/hover/press treatment as every icon in GraphicEditorToolbar.vue
   itself (its .get-tools >>> .v-btn rules) - this button previously
   fell back to Vuetify's default "text" button hover (a grey background
   overlay, not the flat color-only fade the rest of the toolbar uses),
   reading as a different, out-of-place control sitting right next to them. */
.unified-toolbar-height-btn::before {
  display: none;
}

.unified-toolbar-height-btn:not(.v-btn--disabled):hover {
  color: rgba(0, 0, 0, 0.87) !important;
}

.unified-toolbar-height-btn:not(.v-btn--disabled):active {
  transform: scale(0.92);
}

.unified-toolbar-height-btn >>> .v-icon {
  font-size: 16px;
  transition: color 0.15s ease;
  margin-top: -1px;
}

.unified-toolbar-scale-checkbox {
  margin-top: -30px;
  padding-left: 16px;
}

/* Absolutely positioned (matching Text/SoundFX/Data/Music's  collapse
   button placement exactly) rather than flowed in a flex row alongside the
   ID badge - the row wrapper this used to sit in is gone; .background-
   name-field's margin-top (below) makes room for both this and the
   badge to sit above it instead. */
.background-collapse-btn {
  top: 2px !important;
  left: 4px !important;
  box-shadow: none !important;
}

/* Same placement/style as every other tab's "ID: N" badge (see
   MusicEditor.vue's .music-id-badge). */
.background-id-badge {
  position: absolute;
  top: 8px;
  left: 32px;
  font-size: 0.75rem;
  font-family: monospace;
  opacity: 0.6;
}

/* Same reasoning as TextEditor.vue's .text-name-field - reserves room below
   the now-absolutely-positioned collapse button/ID badge instead of them
   overlapping this field, now that neither sits in a normal-flow row above
   it anymore. Matches .soundfx-name-field's margin-top (SoundFXEditor.vue)
   for consistent badge-to-name spacing across every tab.
   margin-bottom: -12px - same fix, same measured ~12px excess, as
   PlayerEditor.vue's .animation-name-field (see its comment) - this field
   isn't hide-details either, so Vuetify reserves a hint/error strip
   below it, taller than DataEditor.vue's equivalent card ends up by the
   same amount. */
.background-name-field {
  margin-top: 20px;
  margin-bottom: -12px;
}

.add-frame-buttom {
  bottom: 8px;
}

/* No drop shadow on floating (absolute-positioned) buttons - delete, add, etc. */
.v-btn--absolute {
  box-shadow: none !important;
}
</style>
