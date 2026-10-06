'use strict';

import * as Blockly from 'blockly/core';

import {TITLE_ICON} from './icon';
import {useTitleScreenStorage} from '../hooks/project';

const TITLESCREEN_COLOR = 'rgb(233, 30, 99)';

// One entry per bitmap kernel type the Titlescreen Kernel (public/bb19/
// titlescreen/) supports in this app - see generators/bbasic/titlescreen.js
// for how these map to the kernel's  draw_bmp_TYPE_N routines. width is
// the fixed pixel width every card of this type draws at (not adjustable
// per card - it's a property of which minikernel variant is used, same as
// a player sprite's  fixed 8-pixel width). blockCount (width/8) is how
// many separate 8-pixel-wide column strips the kernel's  byte format
// splits the image into - see eventsToTitleScreenBlocks in the generator.
// doubleLine marks the "x2" kernels (48x2/96x2), which draw each pixel row
// across 2 scanlines (square-ish pixels, and support a color PER ROW) vs.
// the "x1" kernels (48x1), which draw 1 scanline per row (half-height
// pixels, single fixed color for the whole image). A single screen can
// freely mix any of these types across its  stacked cards (each card
// picks its  type independently) - the kernel's  examples do exactly
// this (see ex1-basic_color.bas's  titlescreenlayout: a 96x2, two 48x1s,
// a space, gameselect, and score, all stacked in one screen).
export const TITLE_SCREEN_KERNEL_TYPES = {
  '48x1': {width: 48, blockCount: 6, doubleLine: false, hasRowColors: false},
  '48x2': {width: 48, blockCount: 6, doubleLine: true, hasRowColors: true},
  '96x2': {width: 96, blockCount: 12, doubleLine: true, hasRowColors: true},
};

// The kernel ships exactly 8 pre-built copies of each bitmap type (see
// public/bb19/titlescreen/*_kernel.asm, numbered 1-8) - a 9th card of the
// same type has no kernel variant left to use. This pool is shared across
// EVERY title screen in the project (see generators/bbasic/titlescreen.js's
// resolveAllTitleScreens) - a physical kernel copy belongs to exactly
// one card project-wide, not one card per screen. Enforced when adding a
// card (see TitleScreenEditor.vue's  handleAddCard).
export const MAX_KERNEL_COPIES_PER_TYPE = 8;

// The "player" minikernel (draws up to 2 real Player 0/1 hardware sprites
// within a title screen) is a project-wide singleton, not a numbered pool
// like the bitmap types above - see generators/bbasic/titlescreen.js's
// assignKernelSlots/buildPlayerDataAsm for why (there's only ever one
// draw_player_display routine and one set of bmp_player0/bmp_player1 data
// project-wide). Enforced the same way as MAX_KERNEL_COPIES_PER_TYPE, in
// TitleScreenEditor.vue's  canAddCardType.
export const MAX_PLAYER_CARDS = 1;

// Same project-wide singleton reasoning as MAX_PLAYER_CARDS above, for the
// "score" minikernel (draws the real bB "score" variable) - only one real
// score display exists regardless of how many cards ask for it.
export const MAX_SCORE_CARDS = 1;

// A blank starting image for a freshly added bitmap card. A single row (an
// earlier default) rendered as a barely-visible sliver, unlike every other
// tab's "add" default (PlayerEditor.vue's handleAddFrame starts frames
// at a full 8x8 grid, BackgroundEditor.vue's handleAddBackground starts at
// the project's  full row count) - 20 rows gives a usable starting canvas
// at any of the kernel's supported widths, well within the ~192-scanline
// budget documented in the kernel's  docs, and is still just a starting
// point the "Set height" tool can resize freely.
const DEFAULT_TITLE_SCREEN_CARD_HEIGHT = 20;
export const blankTitleScreenPixels = (width) =>
  Array.from({length: DEFAULT_TITLE_SCREEN_CARD_HEIGHT}, () => new Array(width).fill(0));

// A bitmap card's frame list - {id, duration, pixels, rowColors} per
// frame, same shape as a Player sprite's animation.frames (see
// DEFAULT_SPRITES in generators/bbasic/sprites.js) so the Title tab's
// editor UI can reuse that exact same frame-list pattern (TitleScreenEditor.vue
// mirrors PlayerEditor.vue's add/delete/copy/paste/set-height frame
// controls). duration is in real frame ticks, same unit a sprite animation's
// frame.duration already uses - more than one frame plays back
// automatically (see generateTitleScreenAnimationChecks in generators/
// bbasic/titlescreen.js), no trigger block needed. card.color (48x1 cards
// only - see TITLE_SCREEN_KERNEL_TYPES' hasRowColors) stays a per-CARD
// field, not per-frame - the 48x1 kernel's per-copy asm only ever reads
// one fixed color byte, not an indexed table the way hasRowColors types do,
// so every frame of an animated 48x1 card always shows in the same color.
export const cardFrameHeight = (card) =>
  (card.frames && card.frames[0] && card.frames[0].pixels && card.frames[0].pixels.length) || 1;

// More than one frame means this card plays back automatically (see
// generateTitleScreenAnimationChecks' comment in generators/bbasic/
// titlescreen.js) - read by both the editor (to gate frame-count-dependent
// UI) and the generator's pre-scan (bbasic.js's init(), to know which
// cards need a duration-counter dev var reserved at all).
export const isCardAnimated = (card) => !!(card.frames && card.frames.length > 1);

// Dev var names for an animated card's runtime state (see
// generateTitleScreenAnimationChecks' comment in generators/bbasic/
// titlescreen.js) - keyed by "screenId:cardId" (ref), NOT by resolved
// kernel slot key, since slot assignment doesn't happen until
// registerTitleScreenSubroutine runs, well after these have to be reserved
// (bbasic.js's init(), same "reserve before any generator needs to resolve
// it" timing every other dev var pre-scan in this codebase already follows).
// titleCardFrameCounterVarName is reserved for EVERY animated card
// (drives its automatic playback); titleCardScrollOffsetVarName only for
// ones ALSO targeted by a "Set title screen scroll position" block.
const sanitizeCardRef = (ref) => ref.replace(':', '_');
export const titleCardFrameCounterVarName = (ref) => `titleCardFrame_${sanitizeCardRef(ref)}`;
export const titleCardScrollOffsetVarName = (ref) => `titleCardScroll_${sanitizeCardRef(ref)}`;
// bmp_${key}_index (generators/bbasic/titlescreen.js's  buildCardDataAsm) is
// an alias for THIS dev var's resolved address, not a raw asm byte -
// declared via reserveDevVar (like the two above) so it actually lands in
// real RIOT RAM. A raw ".byte 0" in the card's image-data block sits in
// ROM instead (that whole block is emitted inside an "asm...@end" subroutine,
// which assembles wherever the current bank's code lives), so a runtime
// write to it is a dead store - the index byte never actually changes even
// though every compiled instruction looks correct at every level (confirmed
// by direct ROM byte inspection: the write executes, the stored value just
// never updates). Needed by any card the kernel reads this byte for at all -
// animated (cycles frames) OR merely scrolling (windowHeight < height, see
// buildCardDataAsm) with just one frame.
export const titleCardIndexVarName = (ref) => `titleCardIndex_${sanitizeCardRef(ref)}`;
// One byte per scrolling card watched by a "When title screen scroll reaches"
// block: bit 0 = the top was just reached, bit 1 = the bottom was. Set by
// "Scroll title screen graphic" when it stops at an edge, cleared by the watch.
export const titleCardScrollEdgeFlagsVarName = (ref) => `titleCardScrollEdge_${sanitizeCardRef(ref)}`;
export const TITLE_SCROLL_EDGE_BITS = {top: 0, bottom: 1};

// The Title tab's help text ("~85 rows of 48x2/96x2, ~170 rows of
// 48x1") is a PER-PAGE, on-screen draw-time budget - how many TV scanlines
// the kernel takes to draw ONE page - not a ROM storage limit (see
// generators/bbasic/titlescreen.js's estimateTitleScreenGraphicsBytes for
// that one). Only ONE frame of an animated card ever draws per actual video
// frame, so unlike ROM storage, a card's OTHER frames don't count here -
// this uses cardFrameHeight (one frame's height) only, never multiplied by
// frame count. Screens are also NOT summed together here - only one page's
// routine runs per actual frame rendered, so a page over budget is a
// problem even if every OTHER page is small, and a page under budget is
// fine even if every OTHER page combined is huge.
export const TITLE_SCREEN_PAGE_ROW_BUDGET = 85;

export const titleScreenPageWeightedRows = (screen) =>
  (screen.cards || []).reduce((total, card) => {
    const typeInfo = TITLE_SCREEN_KERNEL_TYPES[card.type];
    if (!typeInfo) return total;
    return total + cardFrameHeight(card) * (typeInfo.doubleLine ? 1 : 0.5);
  }, 0);

// Whether any single page's stacked height actually exceeds the draw-time
// budget above - read by hooks/rom.js's titleScreenOverflowHint so it only
// mentions the "~85/170 rows" guidance when it's genuinely relevant, rather
// than always pairing it with the (unrelated) ROM storage overflow this
// project may hit for a totally different reason - a project can legitimately
// need far more than "85 rows" of stored graphics data (many frames, many
// pages) while every individual page still draws well within budget.
export const titleScreenAnyPageOverRowBudget = (storage) => {
  const {screens} = processTitleScreenStorageDefaults(storage);
  return screens.some((screen) => titleScreenPageWeightedRows(screen) > TITLE_SCREEN_PAGE_ROW_BUDGET);
};

// Every animated card, across every screen, as "screenId:cardId" refs - see
// titleCardFrameCounterVarName's comment for why this is resolved by
// ref rather than waiting for kernel slot assignment.
export const resolveAnimatedTitleScreenCardRefs = () => {
  const {screens} = processTitleScreenStorageDefaults(useTitleScreenStorage());
  const refs = [];
  screens.forEach((screen) => {
    (screen.cards || []).forEach((card) => {
      if (isCardAnimated(card)) refs.push(`${screen.id}:${card.id}`);
    });
  });
  return refs;
};

// Every card needing a bmp_KEY_index at all - animated (cycles frames) OR
// merely scrolling with just one frame (windowHeight < height) - see
// titleCardIndexVarName's comment for why this has to be a real dev var
// reserved by ref, same timing as the two resolvers/vars above.
export const resolveTitleScreenCardsNeedingIndexRefs = () => {
  const {screens} = processTitleScreenStorageDefaults(useTitleScreenStorage());
  const refs = [];
  screens.forEach((screen) => {
    (screen.cards || []).forEach((card) => {
      const frameHeight = (card.frames && card.frames[0] &&
        card.frames[0].pixels && card.frames[0].pixels.length) || 1;
      const scrollWindow = Number(card.scrollWindow) || 0;
      const needsIndex = isCardAnimated(card) || (scrollWindow > 0 && scrollWindow < frameHeight);
      if (needsIndex) refs.push(`${screen.id}:${card.id}`);
    });
  });
  return refs;
};

// Migrates a pre-animation card (flat pixels/rowColors/color fields
// directly on the card) into the one-frame array shape above - only bitmap
// types (48x1/48x2/96x2) ever had those fields; "space"/"player"/"score"
// cards pass through untouched. Idempotent (a card that already has
// `frames` is returned as-is), so this is safe to run on every load, not
// just once.
const migrateCardFrames = (card) => {
  if (Array.isArray(card.frames) || !TITLE_SCREEN_KERNEL_TYPES[card.type]) return card;
  const {pixels, rowColors, ...rest} = card;
  return {
    ...rest,
    frames: [{
      id: 1,
      duration: 10,
      pixels: pixels || blankTitleScreenPixels(TITLE_SCREEN_KERNEL_TYPES[card.type].width),
      ...(rowColors ? {rowColors} : {}),
    }],
  };
};

// One title-screen "page" - its  ordered card list and its
// background color, selectable independently by name from a "Draw title
// screen" block's  dropdown (see generateTitleScreenOptions below and
// the block definition's SCREEN field). id is stable across renames/
// reordering (assigned once, at creation - see TitleScreenEditor.vue's
// getMaxId pattern), which is what "Draw title screen" blocks actually
// store, not the display name.
export const defaultTitleScreenScreen = (id) => ({
  id,
  name: `Title Screen ${id}`,
  backgroundColor: 0,
  cards: [],
});

export const DEFAULT_TITLE_SCREEN_STORAGE = {
  screens: [defaultTitleScreenScreen(1)],
};

// A freshly loaded/imported project may not have a titleScreen key at all
// yet (added after this feature existed) - same "structuredClone the
// default shape" fallback every other tab's *StorageDefaults function
// already uses (see e.g. blocks/music.js's processSongsStorageDefaults).
// Also migrates the ORIGINAL single-screen shape ({backgroundColor, cards})
// from before multiple screens existed into a one-screen "screens" list,
// so an existing project's already-built title screen isn't silently
// dropped the first time this loads under the new format.
export const processTitleScreenStorageDefaults = (storage) => {
  const data = storage.value;
  if (!data || (!Array.isArray(data.screens) && !Array.isArray(data.cards))) {
    const fresh = structuredClone(DEFAULT_TITLE_SCREEN_STORAGE);
    storage.value = fresh;
    return fresh;
  }
  if (!Array.isArray(data.screens)) {
    const migrated = {
      screens: [{
        id: 1,
        name: 'Title Screen 1',
        backgroundColor: data.backgroundColor || 0,
        cards: (data.cards || []).map(migrateCardFrames),
      }],
    };
    storage.value = migrated;
    return migrated;
  }
  if (!data.screens.length) {
    data.screens.push(defaultTitleScreenScreen(1));
  }
  data.screens.forEach((screen) => {
    screen.cards = (screen.cards || []).map(migrateCardFrames);
  });
  return data;
};

// Every screen's  id/name, for the "Draw title screen" block's
// dropdown field - re-read from storage every time the dropdown opens
// (rather than cached), the same "computed over localStorage isn't
// reactive" reasoning as background.js's  buildBackgroundOptions, so a
// renamed/added/deleted screen shows up without reloading the page. Values
// are the screen's stable id (as a string, matching Blockly's
// string-only field convention), not its display name, so a rename doesn't
// silently retarget every "Draw title screen" block that already pointed
// at it.
const buildTitleScreenOptions = () => {
  try {
    const {screens} = processTitleScreenStorageDefaults(useTitleScreenStorage());
    if (!screens.length) return [['No title screens', '']];
    return screens.map(({id, name}) => [name || `Title Screen ${id}`, `${id}`]);
  } catch (e) {
    console.error('Failed to list title screen options', e);
    return [['Error', '1']];
  }
};

// Programmatic block definition (not defineBlocksWithJsonArray) - a JSON
// definition can only take a fixed list of dropdown options, but this one
// needs to rebuild its list from storage every time it's opened (see
// buildTitleScreenOptions above), the same reason background_select/
// background_set_select in blocks/background.js use a real FieldDropdown
// instead.
Blockly.Blocks['titlescreen_draw'] = {
  init: function() {
    this.appendDummyInput()
        .appendField(`${TITLE_ICON} Draw title screen`)
        .appendField(new Blockly.FieldDropdown(buildTitleScreenOptions), 'SCREEN');
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TITLESCREEN_COLOR);
    this.setTooltip('Draws the chosen Title Screen tab page to the TV. Call this ' +
      'repeatedly (e.g. every frame of "Title screen update") for as long as you want it shown.');
  },
};

// Every card, across every screen, whose "Window height (scrolling)"
// field is set smaller than one frame's height - only those actually get a
// runtime scroll-offset byte at all (see buildCardDataAsm's
// "ifconst"-gated declaration), so a card that isn't scrolling has nothing
// for this block to target. Compared against cardFrameHeight (one frame),
// not the card's full stacked height - a card with multiple frames still
// scrolls WITHIN whichever frame is currently showing (see
// generateTitleScreenAnimationChecks' comment in generators/bbasic/
// titlescreen.js), not through its stacked frames, which already advance on
// theirs. Value is "screenId:cardId" (a card's id is only unique
// within its screen - see handleAddCard's getMaxId), parsed back apart
// by the generator (see generators/bbasic/titlescreen.js's
// titlescreen_scroll_set).
const buildScrollableCardOptions = () => {
  try {
    const {screens} = processTitleScreenStorageDefaults(useTitleScreenStorage());
    const options = [];
    screens.forEach((screen) => {
      (screen.cards || []).forEach((card) => {
        const height = cardFrameHeight(card);
        const scrollWindow = Number(card.scrollWindow) || 0;
        if (!(scrollWindow > 0 && scrollWindow < height)) return;
        const screenLabel = screen.name || `Title Screen ${screen.id}`;
        options.push([`${screenLabel} → ${card.type} (ID:${card.id})`, `${screen.id}:${card.id}`]);
      });
    });
    if (!options.length) return [['No scrolling graphics configured', '']];
    return options;
  } catch (e) {
    console.error('Failed to list scrollable title screen graphics', e);
    return [['Error', '']];
  }
};

Blockly.Blocks['titlescreen_scroll_set'] = {
  init: function() {
    this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField(`${TITLE_ICON} Set title screen scroll position of`)
        .appendField(new Blockly.FieldDropdown(buildScrollableCardOptions), 'CARD')
        .appendField('to');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TITLESCREEN_COLOR);
    this.setTooltip('Scrolls a Title Screen graphic that has its "Window height" set ' +
      'smaller than one frame\'s height - 0 shows the very top/first rows, increasing it scrolls ' +
      'further down/through the frame. If the graphic has more than one animation frame, they ' +
      'keep playing back automatically by themselves schedule while this scrolls within whichever ' +
      'frame is currently showing. Only graphics with scrolling enabled (Title Screen tab) appear ' +
      'in the dropdown.');
  },
};

Blockly.Blocks['titlescreen_scroll_by'] = {
  init: function() {
    this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField(`${TITLE_ICON} Scroll title screen graphic`)
        .appendField(new Blockly.FieldDropdown(buildScrollableCardOptions), 'CARD')
        .appendField(new Blockly.FieldDropdown([['Up', 'up'], ['Down', 'down']]), 'DIRECTION')
        .appendField('by');
    this.appendDummyInput()
        .appendField('stop at edge')
        .appendField(new Blockly.FieldCheckbox('TRUE'), 'STOP');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TITLESCREEN_COLOR);
    this.setTooltip('Moves a scrolling Title Screen graphic up or down by the given number of rows from ' +
      'its current position (use "Set title screen scroll position" to start anywhere). With "stop at ' +
      'edge" on, scrolling halts when the top of the graphic reaches the top of its window, or the ' +
      'bottom of the graphic reaches the bottom of its window. With more than one animation frame, ' +
      'the edge is that of the frame currently showing.');
  },
};

Blockly.Blocks['titlescreen_scroll_edge_reached'] = {
  init: function() {
    this.appendDummyInput()
        .appendField(`${TITLE_ICON} When title screen scroll of`)
        .appendField(new Blockly.FieldDropdown(buildScrollableCardOptions), 'CARD')
        .appendField('reaches the')
        .appendField(new Blockly.FieldDropdown([['Top', 'top'], ['Bottom', 'bottom']]), 'EDGE');
    this.appendStatementInput('DO');
    this.setPreviousStatement(true);
    this.setNextStatement(true);
    this.setColour(TITLESCREEN_COLOR);
    this.setTooltip('Runs the connected blocks once, each time a "Scroll title screen graphic" block with ' +
      '"stop at edge" on lands on the top or bottom edge of that graphic. Setting the position directly ' +
      'does not count.');
  },
};

// Frame number is a plain 0-based index into the chosen Player 0/1
// animation, same numbering PlayerNFrame/the animation frame list itself
// already use - the generator (titlescreen.js's  titlescreen_player_
// frame_set) converts that into the raw byte offset bmp_playerN_index
// actually expects, using that animation's  per-frame height (baked in
// at compile time), so this block never needs to know that detail. Not
// gated behind "does a player card exist" the way buildScrollableCardOptions
// gates its  dropdown - there's only ever one Player 0 and one Player 1
// slot project-wide (see MAX_PLAYER_CARDS), so a plain fixed dropdown is
// enough; the generator itself falls back to a no-op rem if no "player"
// card has actually been added on the Title tab yet.
Blockly.Blocks['titlescreen_player_frame_set'] = {
  init: function() {
    this.appendValueInput('VALUE')
        .setCheck('Number')
        .appendField(`${TITLE_ICON} Set title screen player`)
        .appendField(new Blockly.FieldDropdown([['0', '0'], ['1', '1']]), 'PLAYER')
        .appendField('sprite frame to');
    this.setInputsInline(true);
    this.setPreviousStatement(true, null);
    this.setNextStatement(true, null);
    this.setColour(TITLESCREEN_COLOR);
    this.setTooltip('Changes which frame of the chosen Player 0/1 animation the Title tab\'s ' +
      'player sprite minikernel shows (0 = the first frame). Position it with the normal ' +
      '"Player 0/1 set X/Y" blocks - the title screen sprite is the same hardware sprite, just ' +
      'drawn by the title screen kernel instead of the normal game kernel while a title screen ' +
      'is being shown.');
  },
};
