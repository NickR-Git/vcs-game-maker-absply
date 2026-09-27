<template>
  <div>
    <v-card flat class="editor-container" :ripple="false" @click="deselectCard">
      <v-card-title>Title (alpha 0.5)</v-card-title>
      <v-card-text>
        <p class="v-messages theme--light v-messages__message titlescreen-intro-paragraph">
          Compose a title screen from stacked image strips (drawn top to bottom) using the
          Titlescreen Kernel. 48x1 images are single-color and half-height pixels (the sharpest
          option); 48x2/96x2 images support a different color per row, at normal (roughly
          square) pixel proportions. Add a "Draw title screen" block (Actions tab) to show it -
          call it in a loop for as long as you want it up. Per the kernel's documentation, a
          page's total stacked height shouldn't exceed about 85 rows of 48x2/96x2 (double-line)
          images, or about 170 rows of 48x1 (single-line) images - each card also costs a few
          extra lines to set itself up, so stay comfortably under that limit.
        </p>

        <graphic-editor-toolbar :active-editor="effectiveFrameEditor">
          <template v-slot:before-tools>
            <editor-zoom v-model="zoom" />
            <pixel-grid-toggle v-model="showPixelGrid" />
          </template>
          <template v-slot:after-tools>
            <div class="text-center">
              <v-menu
                v-model="heightMenuVisible"
                :close-on-content-click="false"
                offset-x
              >
                <template v-slot:activator="{ on, attrs }">
                  <v-btn
                    text
                    small
                    class="unified-toolbar-height-btn"
                    title="Set height"
                    :disabled="!selectedGraphicCard"
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
                        <v-list-item-title>Set height for every frame on this card</v-list-item-title>
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
              </v-menu>
            </div>
          </template>
        </graphic-editor-toolbar>

        <v-list class="titlescreen-list">
          <v-list-item
            class="entry-list-item"
            v-for="(screen, screenIndex) in state.screens"
            v-bind:key="screen.id"
          >
            <v-list-item-content>
              <v-card
                outlined
                :ripple="false"
                class="titlescreen-screen-card"
                :class="[screenDragCardClass(screenIndex), {'titlescreen-screen-card-selected': screen.id === selectedScreenId}]"
                v-on="screenDragTargetListeners(screenIndex)"
                @click.stop="selectScreen(screen.id)"
              >
                <div
                  class="titlescreen-drag-handle"
                  title="Drag to reorder"
                  v-bind="screenDragAttrs(screenIndex)"
                  v-on="screenDragHandleListeners(screenIndex)"
                />
                <v-list-item-title class="titlescreen-header-title">
                  <v-btn
                    :title="isScreenCollapsed(screen) ? 'Expand this title screen' : 'Collapse this title screen'"
                    icon
                    small
                    absolute
                    top
                    left
                    class="titlescreen-collapse-btn"
                    @click="() => toggleScreenCollapsed(screen)"
                  >
                    <v-icon>{{ isScreenCollapsed(screen) ? 'mdi-chevron-down' : 'mdi-chevron-up' }}</v-icon>
                  </v-btn>
                  <div class="titlescreen-id-badge">ID:{{ screen.id }}</div>

                  <div class="titlescreen-screen-title-row">
                    <v-text-field
                      class="titlescreen-screen-name-field"
                      label="Page name"
                      v-model="screen.name"
                      @change="handleChildChange"
                    />

                    <color-swatch-picker
                      :value="screen.backgroundColor || 0"
                      :allow-clear="false"
                      title="Click to set this title screen page's background color"
                      @input="(byte) => handleSetBackgroundColor(screen, byte)"
                    />
                    <span class="titlescreen-bg-color-label">Background color</span>
                  </div>

                  <div v-if="state.screens.length > 1" class="titlescreen-corner-toolbar">
                    <v-menu top>
                      <template v-slot:activator="{ on, attrs }">
                        <v-btn
                          title="Delete this title screen"
                          icon
                          small
                          class="delete-icon-btn titlescreen-icon-btn-size"
                          v-bind="attrs"
                          v-on="on"
                        >
                          <v-icon>mdi-delete</v-icon>
                        </v-btn>
                      </template>

                      <v-card>
                        <v-card-title>Delete this title screen?</v-card-title>
                        <v-list>
                          <v-list-item @click="() => handleDeleteScreen(screen)">
                            <v-list-item-icon>
                              <v-icon>mdi-check</v-icon>
                            </v-list-item-icon>
                            <v-list-item-title>Yes, delete</v-list-item-title>
                          </v-list-item>
                          <v-list-item link>
                            <v-list-item-icon>
                              <v-icon>mdi-cancel</v-icon>
                            </v-list-item-icon>
                            <v-list-item-title>No, don't delete</v-list-item-title>
                          </v-list-item>
                        </v-list>
                      </v-card>
                    </v-menu>
                  </div>
                </v-list-item-title>

                <div v-if="!isScreenCollapsed(screen)" class="titlescreen-screen-body">
                  <v-list class="titlescreen-card-list">
                    <v-list-item
                      class="entry-list-item"
                      v-for="(card, index) in screen.cards"
                      v-bind:key="card.id"
                    >
                      <v-list-item-content>
                        <v-card
                          outlined
                          :ripple="false"
                          class="titlescreen-card"
                          :class="[cardDragCardClass(screen, index), {'titlescreen-card-selected': card.id === selectedCardId}]"
                          v-on="cardDragTargetListeners(screen, index)"
                          @click.stop="selectCard(card.id)"
                        >
                          <div
                            class="titlescreen-drag-handle"
                            title="Drag to reorder"
                            v-bind="cardDragAttrs(screen, index)"
                            v-on="cardDragHandleListeners(screen, index)"
                          />
                          <v-list-item-title class="titlescreen-header-title">
                            <v-btn
                              :title="isCollapsed(cardCollapseKey(screen, card)) ? 'Expand this card' : 'Collapse this card'"
                              icon
                              small
                              absolute
                              top
                              left
                              class="titlescreen-collapse-btn"
                              @click="() => toggleCollapsed(cardCollapseKey(screen, card))"
                            >
                              <v-icon>{{ isCollapsed(cardCollapseKey(screen, card)) ? 'mdi-chevron-down' : 'mdi-chevron-up' }}</v-icon>
                            </v-btn>
                            <div class="titlescreen-id-badge">ID:{{ card.id }} &middot; {{ cardTypeLabel(card) }}</div>

                            <div class="titlescreen-corner-toolbar">
                              <v-menu top>
                                <template v-slot:activator="{ on, attrs }">
                                  <v-btn
                                    title="Delete this card"
                                    icon
                                    small
                                    class="delete-icon-btn titlescreen-icon-btn-size"
                                    v-bind="attrs"
                                    v-on="on"
                                  >
                                    <v-icon>mdi-delete</v-icon>
                                  </v-btn>
                                </template>

                                <v-card>
                                  <v-card-title>Delete this card?</v-card-title>
                                  <v-list>
                                    <v-list-item @click="() => handleDeleteCard(screen, card)">
                                      <v-list-item-icon>
                                        <v-icon>mdi-check</v-icon>
                                      </v-list-item-icon>
                                      <v-list-item-title>Yes, delete</v-list-item-title>
                                    </v-list-item>
                                    <v-list-item link>
                                      <v-list-item-icon>
                                        <v-icon>mdi-cancel</v-icon>
                                      </v-list-item-icon>
                                      <v-list-item-title>No, don't delete</v-list-item-title>
                                    </v-list-item>
                                  </v-list>
                                </v-card>
                              </v-menu>
                            </div>
                          </v-list-item-title>

                          <div v-if="!isCollapsed(cardCollapseKey(screen, card))" class="titlescreen-card-body">
                            <template v-if="card.type === 'space'">
                              <v-text-field
                                label="Blank scanlines"
                                v-model.number="card.lines"
                                type="number"
                                min="1"
                                hide-details
                                @change="handleChildChange"
                              />
                            </template>

                            <template v-else-if="card.type === 'score'">
                              <p class="v-messages theme--light v-messages__message titlescreen-player-hint">
                                Shows the game's score (6 digits), using the same font currently selected
                                on the Score tab and colored via the Score category's "Score set color to"
                                block (Actions tab) - nothing to configure here. The Options tab's "Show
                                remaining CPU cycles as the score" has no effect here - it only overlays the
                                standard game kernel's score drawing, which a title screen never calls.
                              </p>
                            </template>

                            <template v-else-if="card.type === 'player'">
                              <div class="titlescreen-player-row">
                                <v-select
                                  label="Player 0 animation"
                                  :items="playerAnimationOptions()"
                                  v-model="card.player0Animation"
                                  hide-details
                                  class="titlescreen-player-select"
                                  @change="handleChildChange"
                                />
                                <playfield-color-strip
                                  class="titlescreen-player-color"
                                  :value="[card.player0Color || 0]"
                                  @input="(colors) => { card.player0Color = colors[0]; handleChildChange(); }"
                                />
                                <span class="titlescreen-player-color-label">Fallback color</span>
                              </div>
                              <div class="titlescreen-player-row">
                                <v-select
                                  label="Player 1 animation"
                                  :items="playerAnimationOptions()"
                                  v-model="card.player1Animation"
                                  hide-details
                                  class="titlescreen-player-select"
                                  @change="handleChildChange"
                                />
                                <playfield-color-strip
                                  class="titlescreen-player-color"
                                  :value="[card.player1Color || 0]"
                                  @input="(colors) => { card.player1Color = colors[0]; handleChildChange(); }"
                                />
                                <span class="titlescreen-player-color-label">Fallback color</span>
                              </div>
                              <p class="v-messages theme--light v-messages__message titlescreen-player-hint">
                                "Fallback color" is only used when the chosen animation doesn't have its own
                                per-row sprite colors (Options tab). Position with the normal "Player 0/1 set
                                X/Y" blocks, and pick a starting frame with "Set title screen player sprite
                                frame to" (Actions tab).
                              </p>
                              <div class="titlescreen-player-row">
                                <v-text-field
                                  label="Window height"
                                  title="How tall the whole player minikernel's own draw region is, in scanlines - independent of either player's own sprite height."
                                  v-model.number="card.windowHeight"
                                  type="number"
                                  min="1"
                                  hide-details
                                  class="titlescreen-player-window-field"
                                  @change="handleChildChange"
                                />
                                <v-select
                                  label="Scanlines per pixel row"
                                  title="1 = half-height pixels (sharper), 2 = roughly square pixels."
                                  :items="[{text: '1 (sharper)', value: 1}, {text: '2 (square pixels)', value: 2}]"
                                  v-model.number="card.kernelLines"
                                  hide-details
                                  class="titlescreen-player-window-field"
                                  @change="handleChildChange"
                                />
                              </div>
                            </template>

                            <template v-else>
                              <p v-if="card.frames.length > 1" class="v-messages theme--light v-messages__message titlescreen-player-hint">
                                Plays back automatically (each frame's own Duration is in real frame ticks,
                                same as a Player sprite animation) - no trigger block needed.
                              </p>
                              <div class="titlescreen-frame-list">
                                <div
                                  v-for="(frame, frameIndex) in card.frames"
                                  :key="frame.id"
                                  class="pixel-editor-parent-container"
                                >
                                  <div
                                    class="pixel-editor-container"
                                    :class="{
                                      'pixel-editor-container-active': frameHighlightState(card, frame) === 'blue',
                                      'pixel-editor-container-active-grey': frameHighlightState(card, frame) === 'grey',
                                    }"
                                    :style="{width: editorWidth(card), maxWidth: editorWidth(card)}"
                                  >
                                    <v-text-field
                                      v-if="card.frames.length > 1"
                                      label="Duration"
                                      v-model.number="frame.duration"
                                      hide-details
                                      type="number"
                                      @change="handleChildChange"
                                    />
                                    <pixel-editor
                                      :ref="pixelEditorRefKey(screen, card, frame)"
                                      :width="cardWidth(card)"
                                      :height="frame.pixels.length || 1"
                                      :aspectRatio="cardWidth(card) / (frame.pixels.length || 1)"
                                      v-model="frame.pixels"
                                      :fgColor="editorFgColor(card)"
                                      :rowColors="editorRowColors(card, frame)"
                                      :showClearButton="true"
                                      :showGrid="showPixelGrid"
                                      :name="`titlescreen-${screen.id}-${card.id}`"
                                      :hideToolbar="true"
                                      @input="() => handleFramePixelsInput(card, frame)"
                                      @resize="() => handleFramePixelsInput(card, frame)"
                                      @clear="() => handleClearCardColors(card)"
                                      @activate="(editorInstance) => setActiveFrame(editorInstance, card.id, frame.id)"
                                    >
                                      <template v-if="cardHasRowColors(card)" v-slot:sidebar>
                                        <playfield-color-strip
                                          :value="frame.rowColors"
                                          @input="(colors) => handleRowColorsInput(frame, colors)"
                                        />
                                      </template>
                                      <template v-else v-slot:sidebar>
                                        <playfield-color-strip
                                          :value="[card.color || 0]"
                                          @input="(colors) => handleSetCardColor(card, colors[0])"
                                        />
                                      </template>
                                      <template v-slot:toolbar-end>
                                        <v-btn
                                          icon
                                          small
                                          title="Copy this frame's image (and row colors, if any)"
                                          class="titlescreen-icon-btn-size"
                                          @click="() => handleCopyFrame(frame)"
                                        >
                                          <v-icon>mdi-content-copy</v-icon>
                                        </v-btn>
                                        <v-btn
                                          icon
                                          small
                                          :disabled="!copiedFrameData"
                                          title="Paste copied image (and row colors, if any) onto this frame"
                                          class="titlescreen-icon-btn-size"
                                          @click="() => handlePasteFrame(card, frame)"
                                        >
                                          <v-icon>mdi-content-paste</v-icon>
                                        </v-btn>
                                      </template>
                                      <template v-slot:badge>
                                        <div class="frame-number-badge">ID:{{ frameIndex + 1 }}</div>
                                        <div class="frame-corner-toolbar">
                                          <v-menu v-if="card.frames.length > 1" top>
                                            <template v-slot:activator="{ on, attrs }">
                                              <v-btn
                                                title="Delete this frame"
                                                icon
                                                small
                                                class="delete-icon-btn titlescreen-icon-btn-size"
                                                v-bind="attrs"
                                                v-on="on"
                                              >
                                                <v-icon>mdi-delete</v-icon>
                                              </v-btn>
                                            </template>

                                            <v-card>
                                              <v-card-title>Delete this frame?</v-card-title>
                                              <v-list>
                                                <v-list-item @click="handleDeleteFrame(card, frame)">
                                                  <v-list-item-icon>
                                                    <v-icon>mdi-check</v-icon>
                                                  </v-list-item-icon>
                                                  <v-list-item-title>Yes, delete</v-list-item-title>
                                                </v-list-item>
                                                <v-list-item link>
                                                  <v-list-item-icon>
                                                    <v-icon>mdi-cancel</v-icon>
                                                  </v-list-item-icon>
                                                  <v-list-item-title>No, don't delete</v-list-item-title>
                                                </v-list-item>
                                              </v-list>
                                            </v-card>
                                          </v-menu>
                                        </div>
                                      </template>
                                    </pixel-editor>
                                  </div>
                                </div>
                                <div class="titlescreen-add-frame-list-item">
                                  <v-btn
                                    class="titlescreen-add-frame-buttom"
                                    color="primary"
                                    title="Add animation frame"
                                    dark
                                    fab
                                    @click="handleAddFrame(card)"
                                  >
                                    <v-icon>mdi-plus</v-icon>
                                  </v-btn>
                                </div>
                              </div>

                              <v-text-field
                                class="titlescreen-scroll-window-field"
                                label="Window height (0 = no scrolling)"
                                title="How many rows show at once - leave at 0 (or at/above one frame's full height) to show the whole current frame with no scrolling. Once set smaller, use the Set title screen scroll position block (Actions tab) to scroll within whichever frame is currently showing."
                                v-model.number="card.scrollWindow"
                                type="number"
                                min="0"
                                :max="cardFrameHeight(card)"
                                hide-details
                                @change="handleChildChange"
                              />
                            </template>
                          </div>
                        </v-card>
                      </v-list-item-content>
                    </v-list-item>
                  </v-list>

                  <v-menu top>
                    <template v-slot:activator="{ on, attrs }">
                      <v-btn
                        class="add-titlescreen-card-buttom"
                        color="primary"
                        title="Add a card"
                        small
                        v-bind="attrs"
                        v-on="on"
                      >
                        <v-icon left>mdi-plus</v-icon>
                        Add graphic
                      </v-btn>
                    </template>
                    <v-card>
                      <v-list>
                        <v-list-item
                          v-for="option in addCardOptions"
                          :key="option.type"
                          :disabled="!canAddCardType(option.type)"
                          @click="() => handleAddCard(screen, option.type)"
                        >
                          <v-list-item-title>
                            {{ option.label }}
                            <span v-if="!canAddCardType(option.type)" class="titlescreen-add-limit-note">
                              (max {{ maxCopiesForType(option.type) }} reached)
                            </span>
                          </v-list-item-title>
                        </v-list-item>
                      </v-list>
                    </v-card>
                  </v-menu>
                </div>
              </v-card>
            </v-list-item-content>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>

    <v-btn
      class="add-frame-buttom"
      color="primary"
      title="Add a new title screen page"
      dark
      absolute
      right
      fab
      @click="handleAddScreen"
    >
      <v-icon>mdi-plus</v-icon>
    </v-btn>
  </div>
</template>
<script>
import {computed, defineComponent, getCurrentInstance, ref} from '@vue/composition-api';
import {max} from 'lodash';

import {colorByteToCss} from '../utils/palette';
import {resizePixelMatrixHeight} from '../utils/pixels';

import ColorSwatchPicker from '../components/ColorSwatchPicker.vue';
import EditorZoom from '../components/EditorZoom.vue';
import GraphicEditorToolbar from '../components/GraphicEditorToolbar.vue';
import PixelEditor from '../components/PixelEditor.vue';
import PixelGridToggle from '../components/PixelGridToggle.vue';
import PlayfieldColorStrip from '../components/PlayfieldColorStrip.vue';
import {useCollapsedIds} from '../hooks/collapse';
import {useDragReorder} from '../hooks/drag-reorder';
import {useTitleScreenStorage, usePixelGridOverlayStorage,
  usePlayerAnimationsStorage} from '../hooks/project';
import {useEditorZoom} from '../hooks/zoom';
import {DEFAULT_ROW_COLOR} from '../blocks/background';
import {TITLE_SCREEN_KERNEL_TYPES, MAX_KERNEL_COPIES_PER_TYPE, MAX_PLAYER_CARDS, MAX_SCORE_CARDS,
  blankTitleScreenPixels, processTitleScreenStorageDefaults, cardFrameHeight} from '../blocks/titlescreen';
import {processPlayerAnimationsStorageDefaults} from '../generators/bbasic/sprites';

// Same "module-scope ref, not per-instance state" reasoning as
// PlayerEditor.vue's own copiedFrameData - a copied frame survives
// navigating away from this tab and back (this component is destroyed/
// recreated on navigation - see hooks/collapse.js's own comment on that
// lifecycle).
const copiedFrameData = ref(null);

export default defineComponent({
  name: 'TitleScreenEditor',
  components: {ColorSwatchPicker, EditorZoom, GraphicEditorToolbar, PixelEditor, PixelGridToggle, PlayfieldColorStrip},
  setup() {
    const instance = getCurrentInstance();
    const titleScreenStorage = useTitleScreenStorage();
    const zoom = useEditorZoom('titlescreen');
    const showPixelGrid = usePixelGridOverlayStorage();

    const state = computed({
      get() {
        return processTitleScreenStorageDefaults(titleScreenStorage);
      },
      set(newState) {
        titleScreenStorage.value = newState;
      },
    });

    const handleChildChange = () => {
      state.value = state.value;
    };

    const getMaxId = (entries) => max(entries.map(({id}) => id)) || 0;

    const handleAddScreen = () => {
      const maxId = getMaxId(state.value.screens);
      const newScreen = {id: maxId + 1, name: `Title Screen ${maxId + 1}`, backgroundColor: 0, cards: []};
      state.value.screens.push(newScreen);
      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    const handleDeleteScreen = (screen) => {
      if (state.value.screens.length <= 1) return;
      state.value.screens = state.value.screens.filter(({id}) => id !== screen.id);
      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    const cardWidth = (card) => (TITLE_SCREEN_KERNEL_TYPES[card.type] || {width: 48}).width;
    // Matches BackgroundEditor.vue's  per-column pixel scale reasoning
    // (a fixed on-screen size per source pixel) - without this, the pixel
    // editor's canvas (see PixelEditor.vue's  aspectRatio/proportion-
    // wrapper trick) stretches to fill whatever width its flex parent
    // happens to have, rendering way oversized/undersized instead of at a
    // consistent, legible scale.
    const TITLESCREEN_PIXEL_SCALE = 14;
    const editorWidth = (card) => `${Math.round(cardWidth(card) * TITLESCREEN_PIXEL_SCALE * zoom.value)}px`;
    const cardHasRowColors = (card) => !!(TITLE_SCREEN_KERNEL_TYPES[card.type] || {}).hasRowColors;
    const cardTypeLabel = (card) => {
      if (card.type === 'space') return 'Space';
      if (card.type === 'player') return 'Player sprites';
      if (card.type === 'score') return 'Score';
      return card.type;
    };

    // Same reasoning as BackgroundEditor.vue's  editorRowColors - without
    // this, PixelEditor.vue's  canvas always draws "on" pixels in the
    // single fgColor regardless of a card's  row colors, which only ever
    // showed up in the sidebar strip, never the actual drawing preview
    // (confirmed as a real, reported bug). A pure black row ($00) is nudged
    // to near-black so the editor still counts those pixels as "on" rather
    // than reading them as the black background.
    const editorRowColors = (card, frame) => {
      if (!cardHasRowColors(card) || !frame.rowColors) return null;
      return frame.rowColors.map((byte) => {
        const css = colorByteToCss(byte);
        return css === '#000000' ? '#010101' : css;
      });
    };

    // A 48x1 card (no row colors) has its  single fixed color
    // (card.color) instead - PixelEditor.vue only ever falls back to its
    // own fgColor prop when rowColors is null (see its own "(this.rowColors
    // && this.rowColors[y]) || this.fgColor"), which this used to hardcode
    // to plain white regardless of card.color - a real reported bug (48x1
    // cards never previewed their  picked color, always drawing white).
    // Irrelevant for a row-color card (editorRowColors above always wins
    // there), but still needs SOME value - white matches the old hardcoded
    // default for that case. Same black-nudge as editorRowColors above, for
    // the same reason.
    const editorFgColor = (card) => {
      if (cardHasRowColors(card)) return '#ffffff';
      const css = colorByteToCss(card.color || 0);
      return css === '#000000' ? '#010101' : css;
    };

    const addCardOptions = [
      {type: '48x1', label: '48x1 image (single color, half-height pixels)'},
      {type: '48x2', label: '48x2 image (per-row color, square pixels)'},
      {type: '96x2', label: '96x2 image (per-row color, wider, more ROM)'},
      {type: 'player', label: 'Player sprites (existing Player 0/1 animations)'},
      {type: 'score', label: 'Score (the game\'s own score)'},
      {type: 'space', label: 'Space (blank gap)'},
    ];

    // The kernel ships exactly MAX_KERNEL_COPIES_PER_TYPE pre-built copies of
    // each bitmap type (see public/bb19/titlescreen/*_kernel.asm) - "space"
    // has no such limit, it's just a plain WSYNC loop. That pool is shared
    // across EVERY title screen page in the project (see
    // generators/bbasic/titlescreen.js's  assignKernelSlots), not one
    // pool per page, so this counts cards on every page, not just the one
    // currently being edited. "player"/"score" have their own, much smaller
    // limits (MAX_PLAYER_CARDS/MAX_SCORE_CARDS - see their  comments in
    // blocks/titlescreen.js) since there's only ever one of each minikernel
    // project-wide, not a numbered pool of 8.
    const countOfType = (type) => state.value.screens
        .reduce((total, screen) => total + screen.cards.filter((card) => card.type === type).length, 0);
    const maxCopiesForType = (type) => type === 'player' ? MAX_PLAYER_CARDS :
      type === 'score' ? MAX_SCORE_CARDS : MAX_KERNEL_COPIES_PER_TYPE;
    const canAddCardType = (type) => type === 'space' || countOfType(type) < maxCopiesForType(type);
    const maxCopies = MAX_KERNEL_COPIES_PER_TYPE;

    const handleAddCard = (screen, type) => {
      if (!canAddCardType(type)) return;
      const maxId = getMaxId(screen.cards);
      const newCard = (() => {
        if (type === 'space') return {id: maxId + 1, type, lines: 10};
        if (type === 'score') return {id: maxId + 1, type};
        if (type === 'player') {
          return {
            id: maxId + 1, type,
            windowHeight: 50, kernelLines: 1,
            player0Animation: '', player1Animation: '',
            player0Color: 0x0e, player1Color: 0x0e,
          };
        }
        const pixels = blankTitleScreenPixels(TITLE_SCREEN_KERNEL_TYPES[type].width);
        return {
          id: maxId + 1,
          type,
          color: 0x0f,
          frames: [{
            id: 1,
            duration: 10,
            pixels,
            rowColors: TITLE_SCREEN_KERNEL_TYPES[type].hasRowColors ?
              pixels.map(() => DEFAULT_ROW_COLOR) : undefined,
          }],
        };
      })();
      screen.cards.push(newCard);
      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    // Animation dropdown options for a "player" card's  Player 0/1
    // fields - both dropdowns share the same pool of animations now (see
    // hooks/project.js's usePlayerAnimationsStorage), same "index into the
    // pool, storage read fresh every call" convention as blocks/sprites.js's
    // own buildAnimationOptions (see its  comment), so a renamed/added
    // animation shows up here without a reload. An empty option lets a card
    // draw just one of the two players, falling back to a single blank row
    // for the other (see resolvePlayerSlotFrames in generators/bbasic/
    // titlescreen.js).
    const playerAnimationOptions = () => {
      const player = processPlayerAnimationsStorageDefaults(usePlayerAnimationsStorage());
      return [
        {text: 'None', value: ''},
        ...player.animations.map((animation, index) =>
          ({text: animation.name || `Unnamed ${index + 1}`, value: `${index}`})),
      ];
    };

    const handleDeleteCard = (screen, card) => {
      screen.cards = screen.cards.filter(({id}) => id !== card.id);
      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    const handleSetBackgroundColor = (screen, color) => {
      screen.backgroundColor = color;
      handleChildChange();
    };

    const handleSetCardColor = (card, color) => {
      card.color = color;
      handleChildChange();
    };

    // Clearing a card's  graphic (PixelEditor.vue's own "clear" event,
    // separate from an ordinary pixel edit) resets its  color field(s)
    // back to the same default handleAddCard itself starts a new card at,
    // rather than leaving old picks behind on an otherwise blank card.
    // rowColors is per-FRAME now (see cardFrameHeight's own comment in
    // blocks/titlescreen.js), so this resets every one of the card's own
    // frames, not just the one whose "clear" button was actually clicked -
    // matches "clear" resetting the WHOLE card's look, not just one frame's
    // pixels, which is already what it does for the pixel data itself
    // (PixelEditor.vue's own "clear" event only ever touches its own
    // v-model, i.e. just that one frame's pixels - this only covers color).
    const handleClearCardColors = (card) => {
      if (cardHasRowColors(card)) {
        card.frames.forEach((frame) => {
          frame.rowColors = (frame.rowColors || []).map(() => DEFAULT_ROW_COLOR);
        });
      } else {
        card.color = 0x0f;
      }
      handleChildChange();
    };

    // Keeps a frame's own rowColors in sync with its  current height
    // whenever the pixel editor's  height changes (drawing taller/
    // shorter, resizing, importing a differently-sized image) - same
    // pad-or-truncate-without-clobbering-existing-picks reasoning as
    // PlayerEditor.vue's  ensureRowColors.
    const ensureRowColors = (card, frame) => {
      if (!cardHasRowColors(card)) return;
      const rows = frame.pixels.length || 1;
      const existing = frame.rowColors || [];
      if (existing.length === rows) return;
      const next = existing.slice(0, rows);
      while (next.length < rows) next.push(DEFAULT_ROW_COLOR);
      frame.rowColors = next;
    };

    const handleFramePixelsInput = (card, frame) => {
      ensureRowColors(card, frame);
      handleChildChange();
    };

    const handleRowColorsInput = (frame, colors) => {
      frame.rowColors = colors;
      handleChildChange();
    };

    // Same shape as PlayerEditor.vue's own handleAddFrame - prefills the new
    // frame with the previous frame's graphic (a copy, so editing it doesn't
    // change the frame it came from), falling back to a blank card-width
    // grid when this is the card's very first extra frame.
    const handleAddFrame = (card) => {
      const frames = card.frames;
      const maxId = getMaxId(frames);
      const previousFrame = frames[frames.length - 1];
      const pixels = previousFrame ?
        structuredClone(previousFrame.pixels) :
        blankTitleScreenPixels(cardWidth(card));
      const newFrame = {
        id: maxId + 1,
        duration: 10,
        pixels,
        ...(previousFrame && previousFrame.rowColors ?
          {rowColors: structuredClone(previousFrame.rowColors)} : {}),
      };
      card.frames.push(newFrame);
      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    const handleDeleteFrame = (card, frame) => {
      card.frames = card.frames.filter(({id}) => id !== frame.id);
      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    // "Standard" copy/paste - a frame's whole image, plus its row colors too
    // (unconditionally, unlike PlayerEditor.vue's own version, which gates
    // that on a project-wide toggle - there's no equivalent toggle here,
    // hasRowColors is just a fixed property of the card's own type).
    const handleCopyFrame = (frame) => {
      copiedFrameData.value = {
        pixels: structuredClone(frame.pixels),
        ...(frame.rowColors ? {rowColors: structuredClone(frame.rowColors)} : {}),
      };
    };
    const handlePasteFrame = (card, frame) => {
      if (!copiedFrameData.value) return;
      frame.pixels = structuredClone(copiedFrameData.value.pixels);
      if (cardHasRowColors(card) && copiedFrameData.value.rowColors) {
        frame.rowColors = structuredClone(copiedFrameData.value.rowColors);
      }
      handleChildChange();
      instance.proxy.$forceUpdate();
    };

    const {isCollapsed: isScreenCollapsed, toggleCollapsed: toggleScreenCollapsed, collapseAll: collapseAllScreens} =
      useCollapsedIds('titlescreen-screens', true);
    collapseAllScreens();

    // Card collapse state is shared across every screen (one storage
    // namespace, same as every other tab), but a card's  id is only
    // unique WITHIN its screen (see handleAddCard's  getMaxId, scoped
    // per screen) - so two different screens' cards can share the same raw
    // id. cardCollapseKey combines both into one id useCollapsedIds can
    // safely key on without those colliding.
    const {isCollapsed: isCollapsedRaw, toggleCollapsed: toggleCollapsedRaw, collapseAll: collapseAllCards} =
      useCollapsedIds('titlescreen-cards', true);
    collapseAllCards();
    const cardCollapseKey = (screen, card) => ({id: `${screen.id}-${card.id}`});
    const isCollapsed = (key) => isCollapsedRaw(key);
    const toggleCollapsed = (key) => toggleCollapsedRaw(key);

    const {dragAttrs: screenDragAttrs, dragCardClass: screenDragCardClass,
      dragHandleListeners: screenDragHandleListeners, dragTargetListeners: screenDragTargetListeners} = useDragReorder(
        () => state.value.screens,
        (items) => {
          state.value.screens = items;
          handleChildChange();
        },
    );

    // One useDragReorder instance PER SCREEN (each screen's  card list
    // reorders independently) - useDragReorder is a plain factory (see
    // hooks/drag-reorder.js), not a Vue lifecycle hook, so it's safe to call
    // more than once/lazily like this. Cached by screen id so every card in
    // the same screen shares one instance (its  draggedIndex/
    // dragOverIndex refs), rather than creating a fresh, disconnected one
    // per card.
    const cardDragReordersByScreen = new Map();
    const cardDragReorderFor = (screen) => {
      if (!cardDragReordersByScreen.has(screen.id)) {
        cardDragReordersByScreen.set(screen.id, useDragReorder(
            () => screen.cards,
            (items) => {
              screen.cards = items;
              handleChildChange();
            },
        ));
      }
      return cardDragReordersByScreen.get(screen.id);
    };
    const cardDragAttrs = (screen, index) => cardDragReorderFor(screen).dragAttrs(index);
    const cardDragCardClass = (screen, index) => cardDragReorderFor(screen).dragCardClass(index);
    const cardDragHandleListeners = (screen, index) => cardDragReorderFor(screen).dragHandleListeners(index);
    const cardDragTargetListeners = (screen, index) => cardDragReorderFor(screen).dragTargetListeners(index);

    // Purely a visual "which card am I looking at" marker, plain local
    // component state - same reasoning/shape as every other tab's own
    // selectCard/deselectCard (see e.g. MusicEditor.vue's  comment).
    // Screens get their  separate selection (a page and a graphic card
    // are never the same thing to have "selected" at once).
    const selectedCardId = ref(null);
    const selectCard = (id) => {
      selectedCardId.value = id;
    };
    const selectedScreenId = ref(null);
    const selectScreen = (id) => {
      selectedScreenId.value = id;
    };
    const deselectCard = () => {
      selectedCardId.value = null;
      selectedScreenId.value = null;
    };

    // The graphic card the shared "Set height" tool acts on - keyed off
    // selectedCardId (the card the user is actually looking at, same
    // reasoning as PlayerEditor.vue's own selectedAnimation/BackgroundEditor
    // .vue's own selectedBackground), not activeFrameEditor (the last
    // editor clicked INTO to draw/undo/etc.). Card ids are only unique
    // WITHIN their own screen (see cardCollapseKey's own comment above), so
    // this searches every screen the same way the existing "is this card
    // selected" highlight already does (:class="titlescreen-card-selected"
    // above) - same pre-existing id-collision caveat, not something new
    // this introduces. null (and the tool disabled) for a non-bitmap card
    // (player/score/space), which has no frames to resize at all.
    const selectedGraphicCard = computed(() => {
      for (const screen of state.value.screens) {
        const card = screen.cards.find((c) => c.id === selectedCardId.value);
        if (card) return card.frames ? card : null;
      }
      return null;
    });

    // Tracks whichever frame's own PixelEditor instance was last clicked
    // into (see its "activate" event, emitted from PixelEditor.vue's
    // handleActivate) - the single toolbar above (Eraser/Pencil/Undo/Redo/
    // Export/Import) acts on THIS frame, since every card's own
    // per-instance toolbar is now hidden (hideToolbar on the pixel-editor
    // above) in favor of this one shared row. Same mechanism as
    // PlayerEditor.vue's own activeFrameEditor/setActiveFrame.
    // activeCardId is what effectiveFrameEditor below compares against
    // selectedGraphicCard to decide whether this explicit click still
    // "wins" over the selected card's own fallback editor - same
    // id-collision caveat as selectedGraphicCard's own search above.
    // activeFrameId (frame ids are only unique WITHIN their own card, same
    // reasoning as PlayerEditor.vue's own activeFrameId) is what
    // isFrameActive below compares against to draw the "you're editing this
    // one" outline - same feature as PlayerEditor.vue's own frame outline,
    // since a Title Screen graphic card can hold more than one frame
    // (animation) too.
    const activeFrameEditor = ref(null);
    const activeCardId = ref(null);
    const activeFrameId = ref(null);
    const setActiveFrame = (editorInstance, cardId, frameId) => {
      activeFrameEditor.value = editorInstance;
      activeCardId.value = cardId;
      activeFrameId.value = frameId;
    };
    const isFrameActive = (card, frame) =>
      activeCardId.value === card.id && activeFrameId.value === frame.id;

    // Same "blue while the frame's own card is actually selected, grey once
    // deselected but still what the toolbar acts on" reasoning as
    // PlayerEditor.vue's own frameHighlightState.
    const frameHighlightState = (card, frame) => {
      if (!isFrameActive(card, frame)) return null;
      return selectedGraphicCard.value && selectedGraphicCard.value.id === card.id ? 'blue' : 'grey';
    };

    // Unique per screen+card+frame (card ids are only unique WITHIN their
    // own screen, and frame ids only unique within their own card) - used as
    // this frame's own PixelEditor.vue $ref name (see the template) so
    // effectiveFrameEditor below can resolve straight to its component
    // instance.
    const pixelEditorRefKey = (screen, card, frame) => `pixelEditor_${screen.id}_${card.id}_${frame.id}`;

    // Which screen a given (already-resolved) graphic card actually belongs
    // to - selectedGraphicCard above only returns the card itself, but
    // pixelEditorRefKey needs the screen too. Reference equality (not an id
    // compare) since card is the exact object selectedGraphicCard found
    // inside state.value.screens, not a copy.
    const findScreenForCard = (card) => state.value.screens.find((screen) => screen.cards.includes(card));

    // What the shared toolbar (Eraser/Pencil/Undo/Redo/Export/Import) above
    // actually acts on - the explicitly-clicked-into frame (activeFrameEditor)
    // when it still belongs to the currently SELECTED graphic card, otherwise
    // the selected card's own first frame, resolved via its $ref. Without
    // this fallback, the tools stayed disabled (and no frame was targeted at
    // all) until a graphic was clicked directly - reported as unexpected,
    // since selecting a card (clicking its title/anywhere else in it)
    // already conveys "I'm working on this one" the same way every other
    // per-card tool in this app already treats it. Same reasoning/shape as
    // PlayerEditor.vue's own effectiveFrameEditor.
    const effectiveFrameEditor = computed(() => {
      if (activeFrameEditor.value && selectedGraphicCard.value && activeCardId.value === selectedGraphicCard.value.id) {
        return activeFrameEditor.value;
      }
      if (selectedGraphicCard.value && selectedGraphicCard.value.frames.length) {
        const screen = findScreenForCard(selectedGraphicCard.value);
        if (!screen) return null;
        const firstFrame = selectedGraphicCard.value.frames[0];
        const refs = instance.proxy.$refs[pixelEditorRefKey(screen, selectedGraphicCard.value, firstFrame)];
        return Array.isArray(refs) ? refs[0] || null : refs || null;
      }
      return null;
    });

    // Same fields as PixelEditor.vue's own height-menu state, now living
    // here instead, since the menu itself moved to this shared toolbar -
    // always resizes every frame on the selected card together, same as
    // PlayerEditor.vue's own handleUnifiedSetHeight.
    const heightMenuVisible = ref(false);
    const heightMenuValue = ref(0);
    const heightMenuScaleContents = ref(false);
    const openHeightMenu = () => {
      if (!selectedGraphicCard.value) return;
      heightMenuValue.value = selectedGraphicCard.value.frames[0].pixels.length;
      heightMenuScaleContents.value = false;
    };
    const handleUnifiedSetHeight = () => {
      const card = selectedGraphicCard.value;
      if (!card) return;
      heightMenuValue.value = Math.max(1, Math.min(64, heightMenuValue.value || 0));
      card.frames.forEach((frame) => {
        frame.pixels = resizePixelMatrixHeight(frame.pixels, heightMenuValue.value, cardWidth(card), heightMenuScaleContents.value);
      });
      handleChildChange();
      instance.proxy.$forceUpdate();
      heightMenuVisible.value = false;
    };

    return {
      state, handleChildChange,
      handleAddScreen, handleDeleteScreen,
      isScreenCollapsed, toggleScreenCollapsed,
      screenDragAttrs, screenDragCardClass, screenDragHandleListeners, screenDragTargetListeners,
      cardWidth, editorWidth, cardHasRowColors, editorRowColors, editorFgColor, cardTypeLabel,
      addCardOptions, canAddCardType, maxCopies, maxCopiesForType, playerAnimationOptions,
      handleAddCard, handleDeleteCard,
      handleSetBackgroundColor, handleSetCardColor, handleClearCardColors,
      handleFramePixelsInput, handleRowColorsInput, cardFrameHeight,
      handleAddFrame, handleDeleteFrame,
      handleCopyFrame, handlePasteFrame, copiedFrameData,
      isCollapsed, toggleCollapsed, cardCollapseKey,
      cardDragAttrs, cardDragCardClass, cardDragHandleListeners, cardDragTargetListeners,
      showPixelGrid, zoom,
      selectedCardId, selectCard,
      selectedScreenId, selectScreen,
      deselectCard,
      selectedGraphicCard, activeFrameEditor, setActiveFrame, isFrameActive, frameHighlightState,
      effectiveFrameEditor, pixelEditorRefKey,
      heightMenuVisible, heightMenuValue, heightMenuScaleContents, openHeightMenu, handleUnifiedSetHeight,
    };
  },
});
</script>
<style scoped>
.titlescreen-intro-paragraph {
  margin-bottom: 16px;
}

/* The "Set height" button passed into GraphicEditorToolbar.vue's own
   "after-tools" slot - see PlayerEditor.vue's identical rule for why this
   stays here rather than moving into that shared component. */
.unified-toolbar-height-btn {
  width: auto;
  min-width: 0;
  padding: 0 2px;
  font-size: 0.75rem;
  color: rgba(0, 0, 0, 0.55);
}

.unified-toolbar-height-btn >>> .v-icon {
  font-size: 16px;
  margin-top: -1px;
}

.unified-toolbar-scale-checkbox {
  margin-top: -30px;
  padding-left: 16px;
}

.titlescreen-list {
  /* Tighter than the 16px this used to be - see PlayerEditor.vue's
     identical .animation-list rule for why: the toolbar row directly above
     already has its own top/bottom padding, so the old value on top of
     that read as too much combined space before the first screen card. */
  margin-top: 4px;
}

/* hooks/drag-reorder.js's  CSS_CLASS_DRAGGING/CSS_CLASS_DRAG_OVER -
   applying those classes alone does nothing without the actual visual
   rule for them, which this tab never had (confirmed as a real bug: the
   classes WERE being toggled correctly, just invisible). Same top-border
   convention MusicEditor.vue's own identical rule uses (a single vertical
   list, not a multi-column grid needing Text/Background's own left/right
   variant). Shared by both the screen list and the nested card list. */
.drag-reorder-dragging {
  opacity: 0.4;
}

.drag-reorder-over {
  border-top: 3px solid var(--v-primary-base, #1976d2) !important;
}

/* v-list-item's  default 0 16px padding stacks on top of v-card-text's,
   pushing every card in further on the right than the left - same fix as
   BackgroundEditor.vue's own identical rule (see its own comment). */
.entry-list-item {
  padding: 0;
}

/* Same fix as DataEditor.vue's  identical rule: without this,
   .v-list-item__content's default overflow: hidden clips a selected card's
   own 2px outline on its left/right edges (min-width: 0 has to come with
   it - overflow: visible alone silently undoes this flex item's default
   0 min-width, letting it refuse to shrink below its own widest content). */
.entry-list-item >>> .v-list-item__content {
  padding: 0;
  overflow: visible;
  min-width: 0;
}

/* width: 100% - same fix as BackgroundEditor.vue's/PlayerEditor.vue's own
   identical .background-card/.animation-card rule: without it, this card
   (nested inside v-list-item-content, not the list item itself) shrinks to
   its own content's natural width instead of filling its row, so a
   collapsed card (just the title row) rendered visibly narrower than an
   expanded one (whose pixel editor forces a wider width). */
/* margin-bottom: 8px matches BackgroundEditor.vue's own .background-list
   grid gap (its own between-card spacing) - not that same 12px this card
   uses for its own internal padding, which is a separate value there too. */
.titlescreen-screen-card,
.titlescreen-card {
  position: relative;
  width: 100%;
  padding: 12px;
  margin-bottom: 8px;
}

/* Only .titlescreen-card needs this: when collapsed, its  body (which
   normally supplies margin-top: 34px to clear the absolutely positioned
   collapse button/ID badge/corner toolbar - see .titlescreen-card-body's
   own comment) isn't rendered at all, so without this the card's own box
   shrank shorter than that positioned content needed, and the toolbar/
   badge visually spilled out past its bottom edge. .titlescreen-screen-card
   never has this problem (its own title row stays visible even collapsed),
   so it doesn't get this rule - it was making that card too tall. */
.titlescreen-card {
  min-height: 44px;
}

/* A top strip, not a left one - matches BackgroundEditor.vue's own
   .background-drag-handle exactly (see its own comment): covers the same
   header band the collapse/ID/delete controls occupy, sitting behind them
   in paint order (they're later in the DOM, so they stay clickable) but in
   front of everything else, so dragging elsewhere in the card still
   selects text/drags the pixel editor instead of starting a reorder. */
/* v-list-item-title is a plain, non-positioned block - unlike its own
   absolutely-positioned collapse-btn/badge/corner-toolbar children (which
   already paint above .titlescreen-drag-handle on their own, position:
   absolute vs. static), its own EMPTY space still captures pointer events
   across its whole box (a transparent element still blocks clicks to
   whatever's behind it, regardless of background) - confirmed as a real
   bug: dragging never started anywhere except exactly on top of a button.
   pointer-events: none here lets a click/drag in that empty space fall
   through to the drag handle underneath; re-enabling it on every direct
   child keeps those controls (and the title row's own input/swatch)
   clickable as normal. */
.titlescreen-header-title {
  pointer-events: none;
}

.titlescreen-header-title > * {
  pointer-events: auto;
}

.titlescreen-drag-handle {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  cursor: grab;
}

/* Matches every other tab's  collapse button placement exactly (see
   BackgroundEditor.vue's own .background-collapse-btn/PlayerEditor.vue's
   own .animation-collapse-btn) - absolutely positioned in the card's
   top-left corner, not flowed in normal layout. */
.titlescreen-collapse-btn {
  top: 2px !important;
  left: 4px !important;
  box-shadow: none !important;
}

/* Same placement as PlayerEditor.vue's own .animation-name-field - a
   graphic card has no name field of its own (nothing follows here), but a
   Title Screen page does, plus its own background color swatch alongside
   it on the same row. margin-top clears the absolutely positioned collapse
   button/ID badge above (see .titlescreen-id-badge/.titlescreen-collapse-
   btn) - the corner toolbar's own absolute top-right position never
   collides with it horizontally, same as every other tab's own identical
   layout. */
.titlescreen-screen-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
}

.titlescreen-screen-name-field {
  max-width: 220px;
}

/* PixelEditor.vue's own outlined v-card is now the visible "frame" around
   each individual animation frame - same as PlayerEditor.vue's own
   Sprites-tab frames (which never stripped this border to begin with; see
   that file for the closest reference). Previously stripped here (matching
   Background's single-graphic cards, which have no per-frame concept at
   all), but that's exactly why the border/outline highlight/delete button
   all read as detached from the actual graphic once a card could hold more
   than one frame - confirmed as a real reported bug ("the frame is wrong",
   "delete button also in the wrong place") once compared side by side with
   the Sprites tab. */

/* Marks which frame the shared toolbar above (Eraser/Pencil/Undo/Redo/
   Export/Import/Set height) currently acts on - same border-color + outline
   treatment as every other tab's own "-selected" card highlight (App.vue's
   shared .titlescreen-card-selected/etc. rule), and the same blue/grey
   split as PlayerEditor.vue's own identical rules (see frameHighlightState's
   own comment). */
.pixel-editor-container-active >>> .v-card {
  border-color: var(--v-primary-base, #1976d2) !important;
  outline: 2px solid var(--v-primary-base, #1976d2) !important;
}

.pixel-editor-container-active-grey >>> .v-card {
  border-color: rgba(0, 0, 0, 0.24) !important;
  outline: 2px solid rgba(0, 0, 0, 0.24) !important;
}

/* Same styling as PlayerEditor.vue's own identical .frame-number-badge -
   was missing here entirely (this class name is shared with that file, but
   had no matching rule of its own in THIS file), so it fell back to plain
   unstyled text instead of reading as a small "ID: N" label. */
.frame-number-badge {
  text-align: left;
  font-size: 0.75rem;
  font-family: monospace;
  opacity: 0.75;
  margin-top: -8px;
}

/* Same reasoning/placement as PlayerEditor.vue's own identical
   .frame-corner-toolbar - also missing here entirely, so Delete (and Copy/
   Paste, before those moved to the toolbar-end slot) rendered inline after
   the ID badge instead of floating in the frame's own top-right corner. */
.frame-corner-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
}

/* Same placement/style as every other tab's own "ID: N" badge (see
   BackgroundEditor.vue's own .background-id-badge). */
.titlescreen-id-badge {
  position: absolute;
  top: 8px;
  left: 32px;
  font-size: 0.75em;
  font-family: monospace;
  opacity: 0.6;
}

/* Matches the Text tab's own .text-bkcolor-label size (TextEditor.vue) -
   this page's background color now uses the same ColorSwatchPicker dot the
   Text/Score tabs use for their own single background color, instead of
   PlayfieldColorStrip's own multi-row strip (which is meant for per-ROW
   colors, not a single project/page-wide one - a real reported style
   mismatch). */
.titlescreen-bg-color-label {
  font-size: 1rem;
}

/* The wrapper itself is positioned (not the button inside via Vuetify's
   own "absolute" prop) - same as BackgroundEditor.vue's own
   .background-corner-toolbar/PlayerEditor.vue's own .animation-corner-
   toolbar. Positioning the button directly instead (an earlier version of
   this) put it outside the v-menu activator's own wrapper element instead
   of the card - confirmed as a real bug (the button rendered detached from
   the card entirely) - this wrapper avoids that since IT establishes the
   position, not something nested inside the menu's own markup. */
.titlescreen-corner-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
  gap: 4px;
}

/* No drop shadow on floating (absolute-positioned) buttons - collapse,
   delete, add - matching BackgroundEditor.vue's own identical rule. */
.v-btn--absolute {
  box-shadow: none !important;
}

.titlescreen-icon-btn-size {
  min-width: 0;
  height: 26px !important;
  width: 26px !important;
  margin: 0;
}

/* Same fix as PlayerEditor.vue's identical rule - without it, a disabled
   Paste button read as clickable, no different from the enabled Copy
   button next to it. */
.titlescreen-icon-btn-size.v-btn--disabled {
  opacity: 0.35;
}

/* Same reasoning/values as PlayerEditor.vue's identical rules - without an
   explicit icon font-size, mdi-delete rendered at Vuetify's own default
   (larger than this 26px button was actually sized for), overlapping the
   graphic/ID badge next to it instead of sitting cleanly inside its own
   corner. mdi-delete specifically needs a couple extra pixels over the
   other icons here (copy/paste, etc.) to read as the same visual size -
   its own glyph has more built-in padding around the trash-can shape at
   the same font-size. */
.titlescreen-icon-btn-size >>> .v-icon {
  font-size: 19px !important;
}

.delete-icon-btn.titlescreen-icon-btn-size >>> .v-icon {
  font-size: 21px !important;
}

/* Comes right after .titlescreen-screen-title-row, which already clears
   the absolutely positioned collapse button/ID badge above it (see its own
   comment) - only needs a little breathing room of its own, not a second
   clearance margin. */
.titlescreen-screen-body {
  margin-top: 8px;
}

/* Unlike a Title Screen page, a graphic card has no name field (or any
   other normal-flow content) between its header and body to clear the
   absolutely positioned collapse button/ID badge/corner toolbar above -
   this margin does that job directly instead (34px clears the corner
   toolbar's own delete button, the taller of the two). */
/* overflow-x: auto - unlike BackgroundEditor.vue/PlayerEditor.vue (whose
   own CSS grid track width is set to match editorWidth exactly - see their
   own comments), this card stays a fixed width: 100% regardless of a
   graphic's own type/zoom. A 96-wide card (double a 48-wide one) at zoom
   above ~50% can make .pixel-editor-container's own fixed pixel width
   (set inline via editorWidth) exceed THIS element's own box - since this
   is the narrower, width-constrained ancestor (not .pixel-editor-container
   itself, whose box is always exactly as wide as its own content and so
   never clips anything on its own), this is the right place for the
   scrollbar to actually appear. Without it, that overflow spilled out past
   the card's (and its own screen card's, and eventually the whole page's)
   right edge instead of staying contained, a real reported bug. overflow-y
   is explicitly hidden rather than left as the default visible: CSS forces
   one axis's "visible" to compute as "auto" whenever the other axis isn't
   also visible, so leaving this "visible" produced an unwanted vertical
   scrollbar too (confirmed as a real bug) - hidden avoids that forced
   conversion, and is safe since nothing in here is ever taller than its
   own content. */
.titlescreen-card-body {
  margin-top: 34px;
  overflow-x: auto;
  overflow-y: hidden;
}

.titlescreen-card-list {
  padding-top: 0;
  padding-bottom: 0;
}

.titlescreen-player-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.titlescreen-player-select,
.titlescreen-player-window-field {
  max-width: 260px;
}

.titlescreen-player-color {
  display: inline-flex;
  vertical-align: middle;
  height: 22px !important;
}

.titlescreen-player-color-label {
  font-size: 14px;
}

.titlescreen-player-hint {
  margin-bottom: 8px;
}

.add-titlescreen-card-buttom {
  margin-top: 8px;
}

/* Same layout as PlayerEditor.vue's own animation frame list - each frame
   sits inline-block, side by side, rather than stacking as block-level divs
   would by default, so the "add frame" button below lands to the RIGHT of
   the last frame instead of wrapping underneath it. */
/* Matches PlayerEditor.vue's own per-frame spacing exactly (there, this same
   16px gap comes from v-list-item's own default right padding, since each
   Sprites frame is a real v-list-item - this one's a plain div, so the same
   value is set directly as margin instead). */
.pixel-editor-parent-container {
  display: inline-block;
  vertical-align: middle;
  margin-right: 16px;
}

/* Same reasoning/placement as PlayerEditor.vue's own .add-frame-list-item -
   sits inline after the last frame, vertically centered against the frame
   cards' height via vertical-align (rather than the list item's own default
   flex centering, which only centers within its own row). */
.titlescreen-add-frame-list-item {
  display: inline-block;
  vertical-align: middle;
  width: auto;
  margin-top: 16px;
  margin-left: 12px;
}

/* Same circular sizing as PlayerEditor.vue's own .add-frame-buttom - a
   distinct class (not shared with this file's own "Add a card" FAB button
   below, .add-frame-buttom) since that one also carries an absolute-
   positioned "bottom: 8px" rule meant for its own corner placement, not
   relevant here. */
.titlescreen-add-frame-buttom {
  width: 36px;
  height: 36px;
}

/* Same class name/positioning as BackgroundEditor.vue's  identical
   "Add background" button - a floating primary-colored FAB in the bottom-
   right corner, absolutely positioned relative to the outer wrapping div
   (a sibling of .editor-container, not inside its v-card-text). */
.add-frame-buttom {
  bottom: 8px;
}

/* Matches BackgroundEditor.vue's  identical .editor-container rule -
   without this, the card just flows in normal page scroll (this tab never
   had its own override, unlike Background's), and .add-frame-buttom above
   (a sibling outside this card, not inside its own scroll region) ends up
   anchored to some ancestor that scrolls the page along with it instead of
   staying pinned in place - a real reported bug ("the add button should not
   scroll"). Making THIS card itself the scrolling region (position:
   absolute + overflow: auto, pinned to the full height of its own slot)
   is what lets the button sit outside it and stay fixed regardless of how
   far the card's own content scrolls. */
.editor-container {
  position: absolute;
  overflow: auto;
  top: 0;
  bottom: 0;
  width: 100%;
}

.titlescreen-add-limit-note {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.5);
}

.titlescreen-scroll-window-field {
  max-width: 260px;
  margin-top: 8px;
}
</style>
