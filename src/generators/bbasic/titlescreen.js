'use strict';

import {TITLE_SCREEN_KERNEL_TYPES, MAX_KERNEL_COPIES_PER_TYPE,
  processTitleScreenStorageDefaults, isCardAnimated, cardFrameHeight,
  titleCardFrameCounterVarName, titleCardScrollOffsetVarName,
  titleCardIndexVarName} from '../../blocks/titlescreen';
import {useTitleScreenStorage, usePlayerAnimationsStorage,
  useConfigurationStorage} from '../../hooks/project';
import {processPlayerAnimationsStorageDefaults} from './sprites';
import {resolveScoreDigitBytes} from '../../utils/score-font';
import {tvColorByte} from '../../utils/palette';

// Packs one pixel row (an array of 0/1 values, PixelEditor.vue's
// format) into one byte per 8-pixel-wide column block, left pixel = high
// bit - matches the sample data shipped in the kernel's *_image.asm
// files (e.g. "BYTE %11101110" reading left-to-right as drawn).
const packRowToBytes = (row, blockCount) => {
  const bytes = [];
  for (let b = 0; b < blockCount; b++) {
    let byte = 0;
    for (let bit = 0; bit < 8; bit++) {
      if (row[b * 8 + bit]) byte |= (1 << (7 - bit));
    }
    bytes.push(byte);
  }
  return bytes;
};

const toBinaryByte = (n) => `%${(n & 0xff).toString(2).padStart(8, '0')}`;
const toHexByte = (n) => `$${(n & 0xff).toString(16).padStart(2, '0')}`;
// A color byte (the editors' NTSC palette) as it goes into the ROM - see tvColorByte.
const toColorHexByte = (n) => toHexByte(tvColorByte(n & 0xff));

// One card's  image data block, in the exact format the Titlescreen
// Kernel's *_image.asm files use (see public/bb19/titlescreen/ - this
// mirrors 48x1_N_image.asm/48x2_N_image.asm/96x2_N_image.asm exactly,
// generated instead of hand-edited), extended to stack every one of the
// card's animation frames (see cardFrameHeight/isCardAnimated's
// comment in blocks/titlescreen.js) into one tall image, frame 0's rows
// first - the exact same "flatten every frame into one tall table, height
// rows apart per frame" approach buildPlayerDataAsm below already uses for
// the "player" minikernel's animation frames, just applied to a real
// bitmap card's pixel/row-color data instead of GRP0/GRP1 bytes. window
// defaults to one frame's height (the whole current frame shown, no
// scrolling) unless the card has its scrollWindow set smaller - see
// card.scrollWindow's  comment in blocks/titlescreen.js for the runtime
// scroll-offset byte this also declares in that case (bmp_${key}_index,
// read directly by the kernel's per-copy asm via "ifconst").
const buildCardDataAsm = (card, key, typeInfo, ref, Blockly) => {
  const {blockCount, doubleLine, hasRowColors} = typeInfo;
  const frames = card.frames && card.frames.length ? card.frames :
    [{pixels: [new Array(typeInfo.width).fill(0)]}];
  const frameHeight = (frames[0].pixels && frames[0].pixels.length) || 1;
  // Every frame is padded/truncated to the FIRST frame's  height (same
  // "frames must be a uniform height" convention buildPlayerDataAsm/
  // resolvePlayerSlotFrames below already enforce) - the editor's
  // "Resize all frames" tool is the only way frames ever change height, so
  // this only ever actually trims/pads a hand-edited/imported project file
  // that skipped that tool. Computed per-frame (not flattened yet) so the
  // dedup pass right below can compare frames by exactly what would be
  // written to ROM.
  const paddedFrames = frames.map((frame) => {
    const framePixels = frame.pixels || [];
    const pixelRows = Array.from({length: frameHeight}, (_, i) => framePixels[i] || new Array(typeInfo.width).fill(0));
    const frameColors = frame.rowColors || [];
    const colorRows = hasRowColors ?
      Array.from({length: frameHeight}, (_, i) => frameColors[i] ?? 0) : null;
    return {pixelRows, colorRows};
  });
  // Animation frames are frequently repeated (a held pose, a blank/off
  // frame reused between "on" frames, a bounce that revisits an earlier
  // frame) - an identical frame (same pixels, and same row colors for
  // types that have them) is written to ROM only once; every logical
  // frame number that repeats it is pointed at that same physical copy
  // instead via frameOffsets below (see generateTitleScreenAnimationChecks'
  // use of it), rather than storing the exact same bytes again for
  // each repeat. Purely a ROM-size optimization - the kernel has no idea
  // some frame numbers alias to the same physical rows, it just draws
  // whichever bmp_${key}_index it's handed.
  const uniqueFrames = [];
  const frameOffsets = paddedFrames.map((frame) => {
    const contentKey = JSON.stringify(frame.pixelRows) + '|' + JSON.stringify(frame.colorRows);
    let physicalSlot = uniqueFrames.findIndex((existing) => existing.contentKey === contentKey);
    if (physicalSlot === -1) {
      physicalSlot = uniqueFrames.length;
      uniqueFrames.push({...frame, contentKey});
    }
    return physicalSlot * frameHeight;
  });
  const rows = uniqueFrames.flatMap((frame) => frame.pixelRows);
  const height = rows.length;
  const scrollWindow = Number(card.scrollWindow) || 0;
  const windowHeight = (scrollWindow > 0 && scrollWindow < frameHeight) ? scrollWindow : frameHeight;
  // The kernel reads each column-block's  bytes bottom-to-top (same
  // reasoning as the row-colors list just below) - without reversing here
  // too, the image drew upside down: pixel rows and row colors both come
  // from the SAME top-to-bottom UI data, so both need the identical
  // reversal to stay correctly paired AND right-side up.
  const blockRows = Array.from({length: blockCount}, () => []);
  [...rows].reverse().forEach((row) => {
    packRowToBytes(row, blockCount).forEach((byte, b) => blockRows[b].push(byte));
  });

  const lines = [
    `bmp_${key}_window = ${windowHeight}`,
    `bmp_${key}_height = ${height}`,
  ];

  // bmp_${key}_index has to be a real, writable RAM byte - only declared
  // when this card actually needs one: either it's scrolling (window
  // smaller than one frame) or it's animated (more than one frame, always
  // needing an index to switch between them - see
  // generateTitleScreenAnimationChecks below) - matching the per-copy
  // kernel file's "ifconst bmp_TYPE_N_index" check, which skips the
  // extra subtraction entirely when a card never needs one at all.
  // An earlier version declared this as a raw ".byte 0" right here in the
  // card's image-data block - which put it in ROM (this whole block
  // assembles inside the "asm...@end" subroutine wrapper, wherever the
  // current bank's code lives), so every runtime write to it was a dead
  // store: the compiled instructions all looked correct (confirmed by
  // direct ROM byte inspection) but the stored value could never actually
  // change, and the card never visibly animated/scrolled. Aliasing it to a
  // real dev var's resolved RAM address (reserved via
  // titleCardIndexVarName - see its comment in blocks/titlescreen.js)
  // fixes that while keeping the exact symbol name the per-copy kernel
  // files already reference directly.
  // Was "windowHeight < height" - equivalent before frame dedup above
  // existed (height was always frameCount * frameHeight then, so more than
  // one frame always meant height > frameHeight >= windowHeight), but no
  // longer: a card with several logical frames that all happen to be
  // pixel-identical now dedups down to a single physical frame, making
  // height === frameHeight - the indirect check would then wrongly skip
  // aliasing bmp_${key}_index to a real dev var for a card
  // generateTitleScreenAnimationChecks still writes to every frame,
  // reintroducing the exact dead-store bug this alias exists to prevent
  // (see the comment above). Checking frames.length directly instead
  // keeps this correct regardless of how many of those frames end up
  // sharing physical storage.
  if (windowHeight < frameHeight || frames.length > 1) {
    const indexVar = Blockly.BBasic.nameDB_.getName(
        titleCardIndexVarName(ref), Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    lines.push(`bmp_${key}_index = ${indexVar}`);
  }

  if (hasRowColors) {
    // The color list is read bottom-to-top by the kernel (see e.g.
    // 48x2_1_image.asm's "in reverse order" comment) - reversed here
    // so the UI's  top-to-bottom row color list doesn't need to think
    // about that. Stacked the same frame-0-first order as the pixel rows
    // above, one frame's rowColors (padded/truncated to frameHeight,
    // same as pixels) right after the previous frame's.
    // Already padded/truncated and deduplicated - see uniqueFrames above.
    const rowColors = uniqueFrames.flatMap((frame) => frame.colorRows);
    lines.push(
        `   if >. != >[.+(bmp_${key}_height)]`,
        '      align 256',
        '   endif',
        ' BYTE 0 ; leave this here!',
        '',
        `bmp_${key}_colors`,
        ...[...rowColors].reverse().map((color) => `\tBYTE ${toColorHexByte(color)}`),
    );
  }

  if (!doubleLine) {
    // 48x1 only - a single fixed color for the whole card (every frame,
    // not per-frame - see cardFrameHeight's comment in
    // blocks/titlescreen.js for why), no per-row list.
    lines.push(
        `bmp_${key}_color`,
        `\t.byte ${toColorHexByte(card.color || 0)}`,
    );
  }

  // Only the 48-wide kernels support a playfield background box behind the
  // image (see the kernel doc's  Example 5) - 96x2 has no PF1/PF2/
  // background fields at all.
  if (typeInfo.width === 48) {
    lines.push(
        `bmp_${key}_PF1`,
        `\tBYTE ${toBinaryByte(card.pf1 || 0)}`,
        `bmp_${key}_PF2`,
        `\tBYTE ${toBinaryByte(card.pf2 || 0)}`,
        `bmp_${key}_background`,
        `\tBYTE ${toColorHexByte(card.background || 0)}`,
    );
  }

  for (let b = 0; b < blockCount; b++) {
    lines.push(
        `   if >. != >[.+bmp_${key}_height]`,
        '\talign 256',
        '   endif',
        `bmp_${key}_${String(b).padStart(2, '0')}`,
        ...blockRows[b].map((byte) => `\tBYTE ${toBinaryByte(byte)}`),
        '',
    );
  }

  return {code: lines.join('\n'), frameHeight, frameCount: frames.length,
    frameDurations: frames.map((f) => f.duration || 1), frameOffsets};
};

// Resolves a "player" card's  player0Animation/player1Animation field
// (an index into the shared animation pool, same convention as
// sprite_player_animation_select's  dropdown - see blocks/sprites.js's
// buildAnimationOptions) into the actual frame data the kernel's
// player_kernel.asm needs. An unresolved/empty slot falls back to a single
// blank (all-zero) row - GRP0/GRP1 draw nothing for a zero byte regardless
// of position or color, so a slot nobody configured is always safe to leave
// wherever the game happens to have last positioned that player.
const resolvePlayerSlotFrames = (animationIndex) => {
  const blank = {height: 1, frames: [[new Array(8).fill(0)]], hasRowColors: false};
  if (animationIndex === undefined || animationIndex === null || animationIndex === '') return blank;
  const player = processPlayerAnimationsStorageDefaults(usePlayerAnimationsStorage());
  const animation = player.animations[Number(animationIndex)];
  if (!animation || !animation.frames || !animation.frames.length) return blank;
  // The kernel indexes frames as one flat array, a fixed number of rows
  // apart (see the kernel doc's "setting the index to 0, 10, 20..."
  // example) - that only works if every frame is the SAME height, so every
  // frame here is padded/truncated to the FIRST frame's  height rather
  // than keeping its (an animation with mismatched frame heights, e.g.
  // "Resizing a frame's height" applied to only one frame, loses whatever
  // extra/short rows don't fit that first frame's shape).
  const height = (animation.frames[0].pixels && animation.frames[0].pixels.length) || 1;
  const hasRowColors = !!(animation.frames[0].rowColors && animation.frames[0].rowColors.length);
  const frames = animation.frames.map((frame) => {
    const rows = [];
    for (let i = 0; i < height; i++) {
      rows.push({
        pixels: (frame.pixels && frame.pixels[i]) || new Array(8).fill(0),
        color: hasRowColors ? ((frame.rowColors && frame.rowColors[i]) || 0) : undefined,
      });
    }
    return rows;
  });
  return {height, frames, hasRowColors};
};

// The "player" minikernel's  data block - see public/bb19/titlescreen/
// player_kernel.asm and the kernel doc's "Example 5" for the format
// this mirrors (bmp_player_window/bmp_player_kernellines/bmp_playerN_height/
// bmp_playerN/bmp_color_playerN). Confirmed (not just inferred) that each
// frame's  rows need reversing, same as the bitmap kernels'
// buildCardDataAsm: player0y counts DOWN once per scanline, and draw_players
// indexes bmp_playerN by that same decreasing value ("ldy player0y; lda
// (player0pointer),y"), so the LAST-stored row of a frame draws at the TOP
// of the sprite and the FIRST-stored row draws at the bottom - storing rows
// bottom-to-top is what makes the sprite render top-to-bottom on screen.
// Only each frame's rows reverse, not the frame order itself - frame
// selection (bmp_playerN_index) just offsets to a different frame's
// height-row block, which independently follows this same bottom-to-top
// convention.
const buildPlayerDataAsm = (card) => {
  const windowHeight = Math.max(1, Math.round(Number(card.windowHeight) || 50));
  const kernelLines = Number(card.kernelLines) === 2 ? 2 : 1;
  const lines = [
    `bmp_player_window = ${windowHeight}`,
    `bmp_player_kernellines = ${kernelLines}`,
  ];
  // Read back by the "Set title screen player sprite frame" block's
  // generator (see titlescreen_player_frame_set below) - it needs each
  // player's  per-frame height (baked in at compile time here) to turn a
  // friendly, 0-based frame number into the raw byte offset bmp_playerN_
  // index actually expects.
  const heights = {};

  [0, 1].forEach((playerIndex) => {
    const animationIndex = playerIndex === 0 ? card.player0Animation : card.player1Animation;
    const rawFallbackColor = playerIndex === 0 ? card.player0Color : card.player1Color;
    const fallbackColor = rawFallbackColor != null ? rawFallbackColor : 0x0e;
    const {height, frames, hasRowColors} = resolvePlayerSlotFrames(animationIndex);
    heights[playerIndex] = height;
    lines.push(`bmp_player${playerIndex}_height = ${height}`, `bmp_player${playerIndex}`);
    frames.forEach((rows) => {
      [...rows].reverse().forEach((row) => lines.push(`\tBYTE ${toBinaryByte(packRowToBytes(row.pixels, 1)[0])}`));
    });
    lines.push('', `bmp_color_player${playerIndex}`);
    frames.forEach((rows) => {
      [...rows].reverse().forEach((row) =>
        lines.push(`\tBYTE ${toColorHexByte(hasRowColors ? row.color : fallbackColor)}`));
    });
    lines.push('');
  });

  return {code: lines.join('\n'), heights};
};

// The "score" minikernel's  digit table (miniscoretable, read directly
// by score_kernel.asm's  draw_score_display - see public/bb19/
// titlescreen/score_kernel.asm) - the same 10 digit shapes the Score tab's
// currently-selected font uses (resolveScoreDigitBytes, same source
// buildScoreFontOverride/hooks/rom.js draws from for the STANDARD score
// kernel), not always the stock Default font. Squish/Squish Custom get
// padded back out to a full 8 rows per digit there too - this minikernel's
// drawing routine always draws a fixed height, it has no equivalent of
// the standard kernel's "fontstyle = SQUISH" row-shrinking trick, so a
// Squish font just renders at normal (non-shrunk) height here. Unlike the
// player minikernel, this card has no editable fields: the
// digits it draws (the real "score" bB variable) and their color (the real
// "scorecolor" variable) are exactly the same ones the Score category's
// existing blocks already read/write.
const buildScoreDataAsm = () => {
  const config = useConfigurationStorage().value || {};
  const lines = ['miniscoretable'];
  resolveScoreDigitBytes(config.scoreFont).forEach((byte) => lines.push(`\t.byte ${byte}`));
  return lines.join('\n');
};

// A rough lower bound on the ROM BYTES every title screen's graphics DATA
// needs, across every screen combined (registerTitleScreenSubroutine
// compiles every screen's cards into the ONE shared _titlescreen_system
// subroutine/bank, so this is a project-wide total, not per-screen) - NOT
// the same thing as the Title tab's "~85/170 rows" help text, which is
// a completely different, per-PAGE budget: how many TV scanlines the kernel
// takes to DRAW one page (a 48x2/96x2 row draws 2 scanlines, a 48x1 row
// draws 1, both capping out around 170 scanlines total - confirmed
// directly, 85*2 = 170*1), unaffected by how many frames an animated card
// has (only the CURRENTLY selected frame's rows ever get drawn) or how many
// OTHER pages exist (only one page's routine runs per actual frame
// rendered). This instead estimates ROM STORAGE: every animation frame is a
// separate, permanently-baked-in byte table (the kernel just changes which
// one it points at), so unlike the draw-time budget, MORE frames or MORE
// pages both genuinely add up here even though nothing about what's ever
// visible at once changes. Deliberately a LOWER bound, not a byte-exact
// prediction - it counts each card/frame's pixel and row-color bytes
// (matching buildCardDataAsm/buildPlayerDataAsm/buildScoreDataAsm's real
// output exactly), but skips the 256-byte alignment padding a card's
// row-color table can need and the driver/kernel code itself (title_
// playfield/vblank/overscan boilerplate plus each used minikernel type's
// draw routine) - both real, but not knowable ahead of an actual compile,
// and both small next to what many animation frames add up to.
export const estimateTitleScreenGraphicsBytes = (storage) => {
  const {screens} = processTitleScreenStorageDefaults(storage);
  let bytes = 0;
  let countedPlayerCard = false;
  let countedScoreCard = false;
  screens.forEach((screen) => {
    (screen.cards || []).forEach((card) => {
      const typeInfo = TITLE_SCREEN_KERNEL_TYPES[card.type];
      if (typeInfo) {
        const height = cardFrameHeight(card) * ((card.frames && card.frames.length) || 1);
        bytes += height * typeInfo.blockCount;
        bytes += typeInfo.hasRowColors ? height : 1;
        return;
      }
      if (card.type === 'player' && !countedPlayerCard) {
        countedPlayerCard = true;
        [0, 1].forEach((playerIndex) => {
          const animationIndex = playerIndex === 0 ? card.player0Animation : card.player1Animation;
          const {height, frames} = resolvePlayerSlotFrames(animationIndex);
          bytes += frames.length * height * 2;
        });
        return;
      }
      if (card.type === 'score' && !countedScoreCard) {
        countedScoreCard = true;
        const config = useConfigurationStorage().value || {};
        bytes += resolveScoreDigitBytes(config.scoreFont).length;
      }
    });
  });
  return bytes;
};

// Assigns every card, across EVERY screen, a physical kernel copy slot
// (type_N, e.g. "48x1_3") - the kernel ships exactly 8 pre-built copies of
// each bitmap type project-wide (see MAX_KERNEL_COPIES_PER_TYPE's
// comment in blocks/titlescreen.js), a shared pool every screen draws from,
// not one pool per screen. Slots are assigned in screen order, then card
// order within each screen, independently per type - reordering
// screens/cards can change which slot a card resolves to, which is fine
// since every reference to it (layout line, data block, #ifconst guard) is
// regenerated together every compile, never stored.
const assignKernelSlots = (screens, Blockly) => {
  const slotByType = {};
  const usedKernelKeys = new Set();
  const dataBlocks = [];
  // One entry per screen: {id, backgroundColor, layoutMacroName, layoutLines}.
  const screenPlans = [];
  // The "player" minikernel is a project-wide singleton (see
  // buildPlayerDataAsm's  comment/layoutmacros.asm's "draw_player" -
  // there's only ever one draw_player_display routine and one set of
  // bmp_player0/bmp_player1 data, not a numbered pool like the bitmap
  // types) - true once the first "player" card is found, in screen order
  // then card order, matching MAX_KERNEL_COPIES_PER_TYPE's  overflow
  // convention below (any additional "player" card is silently ignored, not
  // an error - the UI's  canAddCardType already refuses to add a second
  // one).
  let hasPlayerCard = false;
  let playerHeights = null;
  // Same project-wide singleton reasoning as hasPlayerCard above, for the
  // "score" minikernel (draw_score_display, layoutmacros.asm's
  // "draw_score" macro) - only one real "score" bB variable/display exists
  // regardless of how many cards might ask for it.
  let hasScoreCard = false;

  // Maps "screenId:cardId" (a card's  id is only unique within its
  // screen, not project-wide - see handleAddCard's  getMaxId) to its
  // resolved "type_slot" kernel key, e.g. "48x2_1" - read back by the "Set
  // title screen scroll position" block's  generator, which only knows
  // the screen+card the user picked from its  dropdown, not which
  // physical kernel copy that resolved to this build.
  const cardSlotsByRef = {};
  // Same "screenId:cardId" keying as cardSlotsByRef above, but only for
  // cards with more than one animation frame - read by
  // generateTitleScreenAnimationChecks below (via registerTitleScreenSubroutine)
  // to build each animated card's per-frame duration-counter/index-write
  // code, and by the "Set title screen scroll position" block's
  // generator, to know whether it needs to write to that card's dedicated
  // scroll-offset var (see reserveTitleScreenAnimationDevVars in
  // generators/bbasic.js) instead of straight to bmp_${key}_index.
  const cardAnimationByRef = {};

  screens.forEach((screen) => {
    const layoutLines = [];
    (screen.cards || []).forEach((card) => {
      if (card.type === 'space') {
        const spaceLines = Math.max(1, Math.round(Number(card.lines) || 1));
        layoutLines.push(` draw_space ${spaceLines}`);
        return;
      }
      if (card.type === 'player') {
        if (hasPlayerCard) return;
        hasPlayerCard = true;
        layoutLines.push(' draw_player');
        const {code, heights} = buildPlayerDataAsm(card);
        dataBlocks.push(code);
        playerHeights = heights;
        cardSlotsByRef[`${screen.id}:${card.id}`] = 'player';
        return;
      }
      if (card.type === 'score') {
        if (hasScoreCard) return;
        hasScoreCard = true;
        layoutLines.push(' draw_score');
        dataBlocks.push(buildScoreDataAsm());
        cardSlotsByRef[`${screen.id}:${card.id}`] = 'score';
        return;
      }
      const typeInfo = TITLE_SCREEN_KERNEL_TYPES[card.type];
      if (!typeInfo) return;
      const slot = (slotByType[card.type] || 0) + 1;
      slotByType[card.type] = slot;
      // Silently dropped (not an error) - the UI's  handleAddCard already
      // refuses to add a card once the shared pool for that type is full,
      // this only guards against a hand-edited/imported project file
      // exceeding it.
      if (slot > MAX_KERNEL_COPIES_PER_TYPE) return;
      const key = `${card.type}_${slot}`;
      usedKernelKeys.add(key);
      layoutLines.push(` draw_${key}`);
      const ref = `${screen.id}:${card.id}`;
      const {code, frameHeight, frameCount, frameDurations, frameOffsets} =
        buildCardDataAsm(card, key, typeInfo, ref, Blockly);
      dataBlocks.push(code);
      cardSlotsByRef[ref] = key;
      if (isCardAnimated(card)) {
        cardAnimationByRef[ref] = {key, frameHeight, frameCount, frameDurations, frameOffsets};
      }
    });

    screenPlans.push({
      id: screen.id,
      backgroundColor: Number(screen.backgroundColor) || 0,
      layoutMacroName: `titlescreenlayout_${screen.id}`,
      layoutLines,
    });
  });

  return {usedKernelKeys, dataBlocks, screenPlans, cardSlotsByRef, cardAnimationByRef,
    hasPlayerCard, playerHeights, hasScoreCard};
};

// Every internal label the driver body below defines gets an "@" prefix -
// required so Blockly.BBasic.normalizeIndents (applied to every
// Blockly.BBasic.subroutines entry via generateSubroutineBody) doesn't
// wreck the column-0-for-labels-vs-indented-for-mnemonics distinction DASM
// requires inside a raw "asm ... end" block - see generators/bbasic/
// input.js's buildKeypadPollAsm for the same trick, confirmed there
// directly against a real build ("Unknown Mnemonic" failures without it).
// Only the CLOSING "end" needs it too (not the opening "asm") - matching
// that same file's  established convention.
//
// Structure mirrors the original single-screen Titlescreen Kernel driver
// almost exactly (see the version history of this file/public/bb19/
// titlescreen/titlescreen_kernel.asm) - the only real difference is the
// runtime dispatch chain in the middle (choosing which screen's
// titlescreenlayout_N macro and background color to use, based on
// selectedIdVarName, set by the "Draw title screen" block generator below
// right before its "gosub"), so every screen can share ONE compiled
// copy of the vsync/vblank/overscan boilerplate and this ROM's one shared
// set of physical kernel copies instead of needing its  duplicate of
// each (which would either waste ROM repeating identical boilerplate per
// screen, or need every internal label renamed per screen and still fight
// the SAME per-copy kernel files - 48x1_X_kernel.asm's  position48 calls
// via plain same-bank "jsr" - being reachable from multiple different
// banks, which they can't be without their  bank-switch trampolines).
const buildDriverAsm = (selectedIdVarName, screenPlans, usedKernelKeys, hasPlayerCard, hasScoreCard) => {
  const lines = ['asm'];

  lines.push(
      '@title_eat_overscan',
      '\t;bB runs in overscan. Wait for the overscan to run out...',
      '\tclc',
      '\tlda INTIM',
      '\tbmi title_eat_overscan',
      '\tjmp title_do_vertical_sync',
      '',
      '@title_do_vertical_sync',
      '\tlda #2',
      '\tsta WSYNC ;one line with VSYNC',
      '\tsta VSYNC ;enable VSYNC',
      '\tsta WSYNC ;one line with VSYNC',
      '\tsta WSYNC ;one line with VSYNC',
      '\tlda #0',
      '\tsta WSYNC ;one line with VSYNC',
      '\tsta VSYNC ;turn off VSYNC',
      '',
      '\tifnconst vblank_time',
      '\tlda #42+128',
      '\telse',
      '\tlda #vblank_time+128',
      '\tendif',
      '\tsta TIM64T',
      '',
      '@titleframe = missile0x',
      '\tinc titleframe ; increment the frame counter',
      '',
      '\t#ifconst .title_vblank',
      '\tjsr .title_vblank',
      '\t#endif',
      '',
      '@title_vblank_loop',
      '\tlda INTIM',
      '\tbmi title_vblank_loop',
      '\tlda #0',
      '\tsta WSYNC',
      '\tsta VBLANK',
      '\tsta ENAM0',
      '\tsta ENABL',
      '',
      '@title_playfield',
      '\tlda #230',
      '\tsta TIM64T',
      '',
      '\tlda #1',
      '\tsta CTRLPF',
      '\tclc',
      '',
      '\tlda #0',
      '\tsta REFP0',
      '\tsta REFP1',
      '\tsta WSYNC',
  );

  // The one piece that varies per screen at RUNTIME (everything else here
  // is a fixed, compile-time-shared routine): which titlescreenlayout_N
  // macro to invoke and which background color to load, chosen by
  // comparing selectedIdVarName (set by the "Draw title screen" block,
  // right before its  gosub) against every screen this build actually
  // knows about. Falls through to the next screen's  check on a
  // mismatch; the LAST screen skips its  check and always matches, so a
  // stale/out-of-range id (shouldn't happen - the block's  dropdown can
  // only ever hold real screen ids) still draws something instead of
  // silently skipping the whole kernel.
  screenPlans.forEach((plan, index) => {
    const isLast = index === screenPlans.length - 1;
    if (!isLast) {
      lines.push(
          `\tlda ${selectedIdVarName}`,
          `\tcmp #${plan.id}`,
          `\tbne titlescreen_skip_${plan.id}`,
      );
    }
    lines.push(
        `\tlda #${toColorHexByte(plan.backgroundColor)}`,
        '\tsta titlescreencolor',
        '\tsta COLUBK',
        `\t${plan.layoutMacroName}`,
        '\tjmp title_playfield_done',
    );
    if (!isLast) lines.push(`@titlescreen_skip_${plan.id}`);
  });

  lines.push(
      '',
      '@title_playfield_done',
      '\tjmp PFWAIT ; kernel is done. Finish off the screen',
      '',
      '\tinclude "position48.asm"',
  );

  usedKernelKeys.forEach((key) => {
    lines.push(
        `\t#ifconst mk_${key}_on`,
        `\tinclude "${key}_kernel.asm"`,
        `\t#endif ;mk_${key}_on`,
        '',
    );
  });
  lines.push(
      '\t#ifconst mk_48x1_X_on',
      '\tinclude "48x1_X_kernel.asm"',
      '\t#endif ;mk_48x1_X_on',
      '',
      '\t#ifconst mk_48x2_X_on',
      '\tinclude "48x2_X_kernel.asm"',
      '\t#endif ;mk_48x2_X_on',
      '',
  );

  // Known directly from the JS-side card scan (hasPlayerCard), so this can
  // just be included/omitted outright rather than needing its #ifconst
  // mk_player_on guard the way the numbered bitmap kernels do (their
  // "used at all" state isn't known until layoutmacros.asm's  draw_TYPE_N
  // macro runs during assembly).
  if (hasPlayerCard) {
    lines.push('\tinclude "player_kernel.asm"', '');
  }
  if (hasScoreCard) {
    lines.push('\tinclude "score_kernel.asm"', '');
  }

  lines.push(
      '@PFWAIT',
      '\tlda INTIM',
      '\tbne PFWAIT',
      '\tsta WSYNC',
      '',
      '@OVERSCAN',
      '\tifnconst overscan_time',
      '\tlda #34+128',
      '\telse',
      '\tlda #overscan_time+128-5',
      '\tendif',
      '\tsta TIM64T',
      '',
      '\t;fix height variables we borrowed, so DPC doesn\'t crash on drawscreen...',
      '\tifconst player9height',
      '\tldy #8',
      '\tlda #0',
      '\tsta player0height',
      '@.playerheightfixloop',
      '\tsta player1height,y',
      '\tifconst _NUSIZ1',
      '\tsta _NUSIZ1,y',
      '\tendif',
      '\tdey',
      '\tbpl .playerheightfixloop',
      '\tendif',
      '',
      // Actually wait out the overscan timer set just above - without this,
      // the "overscan period" TIM64T was configured for never really
      // happens; whatever RETURN falls into (commongamelogic, then the next
      // loop iteration's  vsync) starts immediately, however many/few
      // cycles that happens to take, instead of a real fixed ~30-scanline
      // gap. Confirmed as a real bug (a visible stray scanline at the very
      // top of the title screen) - present in the original bundled kernel
      // file too (public/bb19/titlescreen/titlescreen_kernel.asm), not
      // something this rewrite introduced.
      '@OVERSCAN_WAIT',
      '\tlda INTIM',
      '\tbpl OVERSCAN_WAIT',
      '',
      '\tlda #%11000010',
      '\tsta WSYNC',
      '\tsta VBLANK',
      '\tRETURN',
      '',
      // A real, writable RAM byte (not baked as a compile-time constant) -
      // every per-copy kernel file (48x1_N_kernel.asm/48x2_N_kernel.asm)
      // reads this directly for its  COLUPF/PF1/PF2 defaults, not just
      // the COLUBK line above, so it has to exist as a real shared symbol
      // regardless of which screen is currently selected - confirmed as a
      // real build failure ("Unknown Mnemonic 'lda titlescreencolor'")
      // once this byte was removed under the assumption only this
      // driver's  COLUBK line needed it. Forward/backward references
      // both resolve fine within one DASM assembly pass, so this can sit
      // anywhere in the body - here, right before the per-card image data.
      '@titlescreencolor',
      '\t.byte 0',
      '',
      '\tinclude "titlescreen_data.asm"',
      '@end',
  );

  return lines.join('\n');
};

// Per-frame code for every animated card (more than one frame - see
// isCardAnimated's comment in blocks/titlescreen.js), spliced into
// commongamelogic (see generators/bbasic.bb.hbs's
// generatedTitleScreenAnimationChecks placement, right alongside the
// background-fade/seek/etc. checks) so playback advances every real frame
// regardless of where the project's "Draw title screen" block happens
// to sit - background_fade_to hit a real bug from NOT doing this (stalling
// when triggered from inside an "if", since a trigger's code only
// re-runs while that condition holds - see emitColorFadeTrigger's
// comment in generators/bbasic/background.js), so this follows that same
// "always-run check, not tied to the trigger's placement" shape from
// the start instead of risking the same class of bug.
//
// Each card's counter (titleCardFrameCounterVarName) ticks up once per
// real frame and wraps at the animation's total duration (sum of every
// frame's duration), exactly like a Player sprite's player0frame
// (see processAnimation's stateMachine/frameLimit in generators/
// bbasic.js) - reusing that same proven cumulative-duration-threshold
// approach, just landing on a plain NUMBER (temp1, this card's resolved
// frame index) instead of jumping into inline per-frame graphic code the
// way sprites need to (a title card's graphic data is already a plain
// data table, nothing to jump into). temp1 is safe as scratch here the same
// way it already is everywhere else in this codebase (see e.g.
// sprite_player_set's width-conversion branch in this same file's
// sibling generators/bbasic/sprites.js) - written and consumed within this
// one uninterrupted block, never left live across a drawscreen call.
//
// The final index write optionally adds this card's scroll-offset var
// (only for cards actually targeted by a "Set title screen scroll position"
// block - see titleScreenScrollTargetRefs' comment at its bbasic.js
// call site) - bmp_${key}_index already means "row offset from the top of
// the FULL stacked image" (see buildCardDataAsm's comment), and frame
// index * frameHeight already lands exactly on that frame's first row
// in that same stacked table, so adding a small scroll offset on top slides
// the visible window WITHIN whichever frame is currently showing, without
// the two ever needing to know about each other beyond this one shared sum.
const generateTitleScreenAnimationChecks = (Blockly, cardAnimationByRef) => {
  const refs = Object.keys(cardAnimationByRef);
  if (!refs.length) return '';
  const scrollTargetRefs = Blockly.BBasic.titleScreenScrollTargetRefs || new Set();
  const resolveVar = (canonicalName) =>
    Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
  return refs.map((ref) => {
    // frameOffsets[N] (see buildCardDataAsm) is frame N's ALREADY-computed
    // physical byte offset - a plain multiply of frameHeight before frame
    // dedup existed, but now possibly shared with an earlier, identical
    // frame's offset - so each branch below writes it directly instead of
    // writing a frame NUMBER (temp1) and multiplying by frameHeight
    // afterward, which would only ever reach a frame's offset, never a
    // duplicate's shared one.
    const {key, frameDurations, frameOffsets} = cardAnimationByRef[ref];
    const counterVar = resolveVar(titleCardFrameCounterVarName(ref));
    const totalDuration = frameDurations.reduce((sum, duration) => sum + duration, 0) || frameDurations.length;
    const scrollTerm = scrollTargetRefs.has(ref) ? ` + ${resolveVar(titleCardScrollOffsetVarName(ref))}` : '';
    const lines = [
      ` ${counterVar} = ${counterVar} + 1`,
      ` if ${counterVar} >= ${totalDuration} then ${counterVar} = 0`,
      ` bmp_${key}_index = ${frameOffsets[0]}${scrollTerm}`,
    ];
    let cumulative = 0;
    frameDurations.forEach((duration, frameIndex) => {
      cumulative += duration;
      if (frameIndex === frameDurations.length - 1) return;
      lines.push(` if ${counterVar} >= ${cumulative} then bmp_${key}_index = ${frameOffsets[frameIndex + 1]}${scrollTerm}`);
    });
    return lines.join('\n');
  }).join('\n\n') + '\n';
};

export const TITLE_SCREEN_SUBROUTINE_NAME = '_titlescreen_system';

// Called from bbasic.js's  init(), right after reserveDevVar hands out
// selectedIdVarName - same timing/reasoning as generators/bbasic/input.js's
// registerKeypadPollSubroutine (see its  comment): this has to run
// before anything downstream reads Blockly.BBasic.subroutines back out, and
// the resolved var name it needs is already available at that point.
// Compiles EVERY screen currently in storage (not just ones some "Draw
// title screen" block happens to reference right now) - same "always
// compile every entry, not just referenced ones" convention Backgrounds/
// Player animations already use.
export const registerTitleScreenSubroutine = (Blockly, {selectedIdVarName}) => {
  const titleScreen = processTitleScreenStorageDefaults(useTitleScreenStorage());
  const {usedKernelKeys, dataBlocks, screenPlans, cardSlotsByRef, cardAnimationByRef,
    hasPlayerCard, playerHeights, hasScoreCard} = assignKernelSlots(titleScreen.screens, Blockly);

  Blockly.BBasic.titleScreenUsedKernelKeys = usedKernelKeys;
  // Read back by the "Set title screen scroll position" block's
  // generator (see titlescreen_scroll_set below) - it only knows the
  // screen+card the user picked, not which physical kernel copy that
  // resolved to this build.
  Blockly.BBasic.titleScreenCardSlots = cardSlotsByRef;
  // Read back by "Set title screen player sprite frame" (see
  // titlescreen_player_frame_set below) - null when no "player" card exists
  // anywhere in the project, matching titleScreenCardSlots' "nothing to
  // reference yet" shape.
  Blockly.BBasic.titleScreenPlayerHeights = playerHeights;
  // Builds every animated card's per-frame duration-counter/index-write
  // code (see generateTitleScreenAnimationChecks' comment just below) -
  // has to happen here, not in a separate function called later from
  // bbasic.js's finish(), since cardAnimationByRef (frame heights/durations,
  // resolved kernel slot keys) only exists in this function's scope.
  // titleScreenScrollTargetRefs was already computed and stashed by
  // bbasic.js's pre-scan, BEFORE this function runs (same "reserve/scan
  // before any generator needs to resolve it" timing as every dev var
  // pre-scan in this codebase) - see reserveDevVar's call site there for
  // titleCardFrameCounterVarName/titleCardScrollOffsetVarName.
  Blockly.BBasic.titleScreenAnimationChecks = generateTitleScreenAnimationChecks(Blockly, cardAnimationByRef);
  // Read back by "Set title screen scroll position" (see titlescreen_scroll_set
  // below) - an animated card's index is owned by the per-frame check just
  // built above (frame base + scroll offset, recombined every frame), so
  // that block has to write to this card's scroll-offset var instead of
  // straight to bmp_${key}_index for one of these, or the two would fight
  // over the same byte every frame.
  Blockly.BBasic.titleScreenCardAnimations = cardAnimationByRef;
  const asmFiles = {'titlescreen_data.asm': dataBlocks.join('\n\n')};
  screenPlans.forEach((plan) => {
    asmFiles[`titlescreen_layout_${plan.id}.asm`] =
      ` MAC ${plan.layoutMacroName}\n${plan.layoutLines.join('\n')}\n ENDM\n`;
  });
  Blockly.BBasic.titleScreenAsmFiles = asmFiles;

  Blockly.BBasic.subroutines[TITLE_SCREEN_SUBROUTINE_NAME] =
    ' asm\n' +
    ' include "layoutmacros.asm"\n' +
    ' include "dpcfix.asm"\n' +
    screenPlans.map((plan) => ` include "titlescreen_layout_${plan.id}.asm"\n`).join('') +
    '@end\n' +
    buildDriverAsm(selectedIdVarName, screenPlans, usedKernelKeys, hasPlayerCard, hasScoreCard);
};

export default (Blockly) => {
  Blockly.BBasic['titlescreen_draw'] = function(block) {
    const screenId = block.getFieldValue('SCREEN');
    const selectedIdVarName = Blockly.BBasic.titleScreenSelectedIdVarName;
    // Only unset if no "Draw title screen" block exists anywhere on the
    // workspace at all (see bbasic.js's  titleScreenDrawUsed pre-scan) -
    // can't happen for a block that's actually being generated right now,
    // but guards against a stray leftover reference during, e.g., a
    // mid-refactor state.
    if (!selectedIdVarName || !screenId) return 'rem No title screen selected\n';
    const suffix = Blockly.BBasic.bankJumpSuffix(
        Blockly.BBasic.getCurrentBank(), Blockly.BBasic.getSubroutineBank(TITLE_SCREEN_SUBROUTINE_NAME));
    return `${selectedIdVarName} = ${screenId}\n gosub ${TITLE_SCREEN_SUBROUTINE_NAME}${suffix}\n`;
  };

  Blockly.BBasic['titlescreen_scroll_set'] = function(block) {
    const ref = block.getFieldValue('CARD');
    const key = Blockly.BBasic.titleScreenCardSlots && Blockly.BBasic.titleScreenCardSlots[ref];
    // Falls back to a no-op rem, same as titlescreen_draw's "no
    // selection" guard above - a project with no scrolling graphics
    // configured yet (or one whose scrolling was since turned back off)
    // shouldn't fail the whole build over a dropdown with nothing valid in
    // it.
    if (!key) return 'rem No scrolling title screen graphic selected\n';
    const value = Blockly.BBasic.valueToCode(block, 'VALUE', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    // An animated card's bmp_${key}_index is owned by the per-frame
    // animation check (generateTitleScreenAnimationChecks) - it recomputes
    // "frame base + scroll offset" every frame, so this has to write to the
    // scroll-offset var that check reads instead of straight to
    // bmp_${key}_index, or the two would silently overwrite each other
    // every frame (same class of bug two independent writers of the same
    // register always risk - see collision.js's comment on a similar
    // fight elsewhere in this codebase).
    const cardAnimation = Blockly.BBasic.titleScreenCardAnimations && Blockly.BBasic.titleScreenCardAnimations[ref];
    if (cardAnimation) {
      const scrollVar = Blockly.BBasic.nameDB_.getName(
          titleCardScrollOffsetVarName(ref), Blockly.Names.DEVELOPER_VARIABLE_TYPE);
      return `${scrollVar} = ${value}\n`;
    }
    // bmp_${key}_index is an alias for a real dev var's resolved address
    // (see buildCardDataAsm's comment) - referenced directly by that
    // alias name, no separate "dim" needed at THIS call site since
    // buildCardDataAsm's pre-scan already reserved it.
    return `bmp_${key}_index = ${value}\n`;
  };

  Blockly.BBasic['titlescreen_player_frame_set'] = function(block) {
    const playerIndex = block.getFieldValue('PLAYER');
    const heights = Blockly.BBasic.titleScreenPlayerHeights;
    const height = heights && heights[playerIndex];
    // No "player" card configured anywhere in the project yet - same no-op
    // rem fallback as titlescreen_scroll_set's "nothing to reference"
    // guard above.
    if (!height) return 'rem No title screen player sprite configured\n';
    const value = Blockly.BBasic.valueToCode(block, 'VALUE', Blockly.BBasic.ORDER_MULTIPLICATION) || '0';
    // bmp_playerN_index is a raw byte offset into the flattened frame array
    // (see resolvePlayerSlotFrames'  comment), height rows apart per
    // frame - height is known here at compile time (baked into the title
    // screen's  data block above), so the multiply happens in the
    // generated source itself (a variable times a compile-time constant),
    // not at runtime in JS, letting VALUE be any expression (a literal,
    // variable, or computed frame number).
    return `bmp_player${playerIndex}_index = ${value} * ${height}\n`;
  };
};
