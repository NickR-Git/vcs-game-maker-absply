'use strict';

import {useConfigurationStorage} from '../../hooks/project';
import {effectiveBackgroundRows, backgroundFadeTimerVarName, backgroundFadePaceVarName,
  backgroundFadeTargetVarName, fadeFlagsVarName, FADE_STEPS,
  backgroundFadeFinishedBit, fadeActiveBit, backgroundFadeWatchKey,
  backgroundGetPixelXVarName, backgroundGetPixelYVarName,
  collisionPixelColumnVarName, collisionPixelRowVarName,
  backgroundScrollRowVarName, backgroundScrollRowMaxVarName, backgroundScrollSubRowVarName,
  backgroundScrollEdgeFlagsVarName, BACKGROUND_SCROLL_EDGE_BITS, backgroundScrollStartVarName,
  BACKGROUND_SCROLL_PATCH_SUBROUTINE_NAME} from '../../blocks/background';
import {pfRowDivisorFor} from '../../utils/playfield-coords';
import {ctrlpfShadowVarName, spriteScrollFlagsVarName, spriteScrollActiveBit,
  missileBounceStageVarName,
  DIRECTION16_STEPS, backgroundRainbowActiveBit, backgroundRainbowOffsetVarName,
  backgroundColorTableLoVarName, backgroundColorTableHiVarName,
  romNoiseFlagsVarName} from './sprites';

// FADE_STEPS (4) is fixed rather than user-choosable - see its  comment
// in blocks/background.js. floor(14 / 4) = 3, rounded down to the nearest
// even number and floored at 2 (see the old per-instance version of this
// same computation for the general formula) - always comes out to 2, the
// finest brightness step this hardware can do, so it's just a literal here
// rather than restating the general formula for a single fixed input.
const FADE_INCREMENT = 2;

// Walks up from a block through plain parent connections (not just statement
// nesting - background_get_pixel can sit inside an "if" condition socket, a
// value input) looking for an enclosing function_define. Module-scope (not
// inside the default export closure below) so generators/bbasic.js's
// early pre-scan can use it too, ahead of reserveDevVar handing out letters.
// Shared with generators/bbasic/collision.js's grid-snap revert (see
// its comment) - module-scope and exported so both files agree on the
// exact same sprite<->playfield-pixel X offset rather than each guessing
// their.
export const spriteXOffset = (width) => (width === 'SINGLE' ? 17 : 16);

const isInsideFunctionDefine = (block) => {
  let ancestor = block.getParent();
  while (ancestor) {
    if (ancestor.type === 'function_define') return true;
    ancestor = ancestor.getParent();
  }
  return false;
};

// Whether a background_get_pixel block's  X or Y argument is a bare,
// always-space-free value once generated - an unplugged socket falls back
// to the literal '0', and a bare math_number/variables_get block's
// generated code is always a single token - everything else (arithmetic,
// another getter block, etc.) is conservatively treated as possibly
// producing a whitespace-containing expression, matching this block's
// generator's real isSimple check (background_get_pixel below) without
// running actual codegen this early (see reserveDevVar's "known before
// any generator runs" pre-scan timing constraint) - erring toward "still
// reserve it" for anything this can't positively classify as simple, never
// the other way around.
const argumentIsSimple = (block, inputName) => {
  const target = block.getInputTargetBlock(inputName);
  return !target || target.type === 'math_number' || target.type === 'variables_get';
};

// Whether background_get_pixel's  X/Y scratch dev vars
// (backgroundGetPixelXVarName/YVarName) are genuinely needed for this
// specific block instance - both the "inside a function" nesting AND at
// least one non-simple argument have to hold, matching exactly what the
// generator itself falls back to these vars for (see its  useDevVars/
// isSimple checks) rather than the coarser "inside a function at all" check
// generators/bbasic.js's  pre-scan used to make do with.
export const backgroundGetPixelDevVarsNeeded = (block) =>
  isInsideFunctionDefine(block) && (!argumentIsSimple(block, 'X') || !argumentIsSimple(block, 'Y'));

// Per-register label tag for generateBackgroundFadeChecks below - has to be
// distinct per register (unlike a shared "bg" for everything) now that
// scorecolor/TextColor share this same check-generating function alongside
// COLUBK/COLUPF, or two registers'  labels would collide into the exact
// same names and only the first would ever compile correctly.
const FADE_LABEL_TAG_BY_VAR = {
  COLUBK: 'bg', COLUPF: 'pf', scorecolor: 'score', TextColor: 'text',
  player0realcolor: 'p0', player1realcolor: 'p1',
};

// Shared by every "Background [Set/Clear/Flip] line from X/Y to X/Y" block
// (background_draw_line) - a runtime implementation of Bresenham's line
// algorithm, needed because (unlike background_change_hv_line's
// straight horizontal/vertical runs, which are always axis-aligned and so
// can compile straight to a single pfhline/pfvline macro call) an arbitrary
// line's  endpoints can be variables, not fixed numbers known at compile
// time - there's no way to know in advance how many pixels it needs, or
// which ones, without actually running the algorithm.
//
// One subroutine PER OPERATION ACTUALLY USED (Set/Clear/Flip - see
// BACKGROUND_LINE_SUBROUTINE_NAMES below), not one shared routine with a
// runtime dispatch - a project using only "Set" line blocks (the common
// case) gets exactly one copy, no dispatch branching, and no separate
// "which operation" variable to track at all; only a project that mixes
// Set/Clear/Flip line blocks pays for more than one copy of this routine.
// Still only ONE copy PER operation regardless of how many line blocks use
// it (see registerKeypadPollSubroutine's  identical "one shared copy,
// called via gosub" reasoning in generators/bbasic/input.js).
//
// The "err" term is tracked with a fixed +128 bias throughout (comparing
// against 128 instead of 0) rather than as a true signed value - this
// codebase's "dim"'d variables are plain unsigned bytes, and while
// ADD/SUBTRACT wrap correctly for negative values via ordinary two's-
// complement arithmetic, an UNSIGNED ">"/"<" comparison on a wrapped
// negative value reads it as a huge positive number instead, which would
// send the algorithm the wrong way at exactly the values where a plain sign
// check matters most. Biasing keeps every comparison safely within 0-255
// with no wraparound, as long as neither operand's  true magnitude ever
// approaches ~127 - true for every coordinate range this app's
// playfield editor (32 pixels wide, well under 127 tall even with Superchip
// RAM's  largest pfres) can ever produce.
//
// 7 dedicated dev vars: the current point (x1,y1), target point (x2,y2),
// distances (dx,dy), and the error accumulator - down from an earlier design
// that also had a loop counter and a runtime operation selector (9 vars).
// The loop counter turned out to be redundant: since x1 (low branch) or y1
// (high branch) already walks toward the target by exactly 1 every
// iteration, checking "have I just plotted the target point?" right after
// each plot is an equally valid stop condition, using state this routine
// already has to track anyway - see the "goto"-based loop below instead of
// the earlier "for/next" one. The operation selector is gone because the
// operation is now baked into which subroutine gets called (see above)
// instead of being read at runtime.
//
// An even earlier version tried to save vars a different way - keeping
// x1/y1/x2/y2/dx/dy in the shared temp1-temp6 scratch registers instead
// (the same ones background_change_pixel/background_change_hv_line use) -
// that was wrong, and a real reported bug (a couple of pixels drawn, then
// nothing, instead of a continuous line): pfpixel's implementation
// (public/bb19/includes/pf_drawing.asm's  setuppointers) uses temp1 AND
// temp2 as ITS internal scratch while computing the byte/row address -
// "stx temp2" / "sta temp1" - clobbering whatever this routine had stored
// there the instant the FIRST pfpixel call happened. background_change_pixel
// gets away with temp1/temp2 only because it uses them for one single,
// immediate call and never reads them again - safe for a one-shot hand-off,
// not for state that has to survive across a whole loop of repeated pfpixel
// calls. temp1/temp2 are still used here, but only as that same kind of
// momentary hand-off, immediately before each individual plot - x1/y1
// themselves live in their  dedicated vars.
export const BACKGROUND_LINE_SUBROUTINE_NAMES = {
  on: '_bgDrawLineOn', off: '_bgDrawLineOff', flip: '_bgDrawLineFlip',
};
// operations: a Set/array of which of 'on'/'off'/'flip' to actually build a
// subroutine for (see backgroundLineOperationsUsed's  pre-scan in
// generators/bbasic.js) - an operation nothing ever uses gets no subroutine
// at all, not even an unused/dead one.
export const registerBackgroundLineSubroutine = (Blockly, names, operations) => {
  const {x1, y1, x2, y2, dx, dy, err} = names;
  // Every label DEFINITION needs an "@ " prefix (goto/gosub REFERENCES to it
  // stay bare) - Blockly.BBasic.normalizeIndents (run on every generated
  // subroutine body, and on the whole program's  top-level code too -
  // see finish()'s  call) blindly indents every line, which breaks a
  // plain label's  required column-0 placement; "@ " is stripped back
  // out afterward, restoring it. Same convention controls_if's "@
  // ${bodyLabel}" already uses for its  goto targets (see logic.js) -
  // this isn't specific to raw "asm...end" blocks the way it might look
  // from titlescreen.js's  comments, it's universal to every label
  // Blockly.BBasic ever generates. Confirmed as a real, reproduced build
  // failure without it ("Unknown keyword: _lineDrawLow" - the indented
  // label was read as an attempted statement/command instead).
  operations.forEach((operation) => {
    // Every internal label is tagged with the operation (e.g. "_lineDrawLowOn"
    // vs "_lineDrawLowOff") - these are real, global assembly labels once
    // compiled, not scoped to this one subroutine, so a project using more
    // than one operation (e.g. both "Set" and "Clear" line blocks) would
    // otherwise get a duplicate-label build error the moment a second one of
    // these subroutines was registered with the exact same internal label
    // names as the first.
    const tag = operation.charAt(0).toUpperCase() + operation.slice(1);
    const plot = [
      `temp1 = ${x1}`,
      `temp2 = ${y1}`,
      `pfpixel temp1 temp2 ${operation}`,
    ].join('\n');

    Blockly.BBasic.subroutines[BACKGROUND_LINE_SUBROUTINE_NAMES[operation]] = [
      `if ${x2} >= ${x1} then ${dx} = ${x2} - ${x1} else ${dx} = ${x1} - ${x2}`,
      `if ${y2} >= ${y1} then ${dy} = ${y2} - ${y1} else ${dy} = ${y1} - ${y2}`,
      `if ${dx} < ${dy} then goto _lineDrawHigh${tag}`,
      '',
      `@ _lineDrawLow${tag}`,
      `${err} = 128 + ${dy} + ${dy} - ${dx}`,
      `@ _lineLowLoop${tag}`,
      plot,
      `if ${x1} = ${x2} then return`,
      `if ${err} <= 128 then goto _lineSkipYLow${tag}`,
      `if ${y1} < ${y2} then ${y1} = ${y1} + 1 else ${y1} = ${y1} - 1`,
      `${err} = ${err} - ${dx} - ${dx}`,
      `@ _lineSkipYLow${tag}`,
      `${err} = ${err} + ${dy} + ${dy}`,
      `if ${x1} < ${x2} then ${x1} = ${x1} + 1 else ${x1} = ${x1} - 1`,
      `goto _lineLowLoop${tag}`,
      '',
      `@ _lineDrawHigh${tag}`,
      `${err} = 128 + ${dx} + ${dx} - ${dy}`,
      `@ _lineHighLoop${tag}`,
      plot,
      `if ${y1} = ${y2} then return`,
      `if ${err} <= 128 then goto _lineSkipXHigh${tag}`,
      `if ${x1} < ${x2} then ${x1} = ${x1} + 1 else ${x1} = ${x1} - 1`,
      `${err} = ${err} - ${dy} - ${dy}`,
      `@ _lineSkipXHigh${tag}`,
      `${err} = ${err} + ${dx} + ${dx}`,
      `if ${y1} < ${y2} then ${y1} = ${y1} + 1 else ${y1} = ${y1} - 1`,
      `goto _lineHighLoop${tag}`,
    ].join('\n');
  });
};

// screen_shake's  countdown (see generateShakeScreenChecks below for the
// per-frame use of it) - only reserved when a screen_shake block is
// actually on the canvas (screenShakeUsed, same early-pre-scan pattern as
// every other feature's "*Used"/"*UsedFor" dev var reservation).
export const shakeScreenFramesVarName = () => 'shakeScreenFrames';

// Unlike every other feature in this file, this ALSO has to reserve the
// literal bareword "shakescreen" itself, not just a private canonical dev
// var - std_kernel.asm reads/gates on that exact symbol directly ("ifconst
// shakescreen"/"bit shakescreen" - see generateShakeScreenChecks'
// comment), and nothing in 2600basic.h ever pre-declares it the way
// player0frame/newbackground/etc. are (confirmed by grepping the bundled
// bB compiler's  includes - this feature is genuinely undocumented,
// bB itself expects the USER's  program to dim it). Emitting "dim
// shakescreen = <letter>" both reserves the real RAM byte the kernel reads
// every frame AND satisfies "ifconst shakescreen" by itself, the same way
// "rand16" (see its  reserveDevVar call site in generators/bbasic.js)
// already relies on a plain, never-colliding literal name passing through
// nameDB_.getName() completely unchanged - no separate "const shakescreen
// = 1" needed (or wanted: that would declare it as a compile-time constant
// instead of a RAM variable, breaking the runtime "bit shakescreen" read).
export const reserveShakeScreenDevVar = (reserveDevVar, used) => {
  if (!used) return;
  reserveDevVar('shakescreen', undefined,
      'literal name the standard kernel checks for/reads every frame to drive screen shake');
  reserveDevVar(shakeScreenFramesVarName(), undefined, 'frames remaining in the current screen shake');
};

// Spliced into commongamelogic (see bbasic.bb.hbs) once, unconditionally -
// unlike every per-object check elsewhere in this codebase (Fire/Bounce/
// Seek), there's only ever one screen, so no per-name loop or label-
// uniquing is needed here.
//
// Drives the standard kernel's  undocumented "shakescreen" hook (see
// std_kernel.asm's "ifconst shakescreen"/"doshakescreen" - confirmed by
// reading that file directly, since this feature was never actually
// documented anywhere in the bB community): every frame, the kernel checks
// bit 7 of the runtime "shakescreen" variable - clear (0-127) inserts one
// extra scanline wait at a fixed point in the frame, shifting that whole
// frame's picture down by one scanline; set (128-255) draws normally. Held
// at a constant value, that's just a static one-line offset, not a
// vibration - screen_shake's  block is a self-contained "for N frames"
// effect (confirmed with the user), so this alternates shakescreen between
// 0 and 128 every other frame (using bit 0 of the countdown itself, READ
// BEFORE decrementing it, as the parity signal, rather than a second dev
// var) for as long as framesVar is still counting down, and settles back
// to 128 (off) the instant it hits zero so the picture doesn't stay
// shifted after the effect ends. Reading the parity before the decrement
// (rather than after) matters at the boundary: a 1-frame shake has to
// actually show one shaken frame, not silently do nothing because its only
// countdown value (1, odd) got consumed by the decrement before ever being
// tested.
export const generateShakeScreenChecks = (Blockly) => {
  if (!Blockly.BBasic.screenShakeUsed) return '';
  const resolveVar = (canonicalName) =>
    Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
  const framesVar = resolveVar(shakeScreenFramesVarName());
  const shakeVar = resolveVar('shakescreen');
  return [
    ` if ${framesVar} = 0 then goto _shakescreen_off`,
    ` if ${framesVar}{0} then goto _shakescreen_on`,
    ` ${shakeVar} = 128`,
    ` goto _shakescreen_decrement`,
    `_shakescreen_on`,
    ` ${shakeVar} = 0`,
    `_shakescreen_decrement`,
    ` ${framesVar} = ${framesVar} - 1`,
    ` goto _shakescreen_done`,
    `_shakescreen_off`,
    ` ${shakeVar} = 128`,
    `_shakescreen_done`,
  ].join('\n') + '\n';
};

export default (Blockly) => {
  // A compile-time constant, not runtime state - the playfield's vertical
  // resolution is a single fixed ROM-wide setting (see effectiveBackgroundRows'
  // comment in blocks/background.js: pfres itself when Superchip RAM is
  // on, else the standard kernel's fixed 11-row default), so this can just
  // splice in the literal number directly rather than needing a hidden
  // per-frame variable the way the Distance blocks do.
  Blockly.BBasic[`background_get_resolution`] = function(block) {
    const configurationStorage = useConfigurationStorage();
    const config = (configurationStorage && configurationStorage.value) || {};
    const rows = effectiveBackgroundRows(config);
    return [`${rows}`, Blockly.BBasic.ORDER_ATOMIC];
  };


  // Playfield-pixel <-> sprite coordinate conversions, from real batari
  // Basic's  documented formulas, cross-checked directly against a real
  // working example program (a Superchip pfres=32 project using "z =
  // (player0y - 14) / 3" to track its player's playfield row):
  // - The playfield only uses its 32 CENTER pixels of the 40 across the
  //   160-color-clock-wide screen (4 blank on each side), each 4 color
  //   clocks wide - so X always scales by a flat 4, regardless of
  //   pfres/Superchip (confirmed by the reference documentation directly;
  //   the example program doesn't touch X at all).
  // - X also has a fixed offset to the first usable playfield pixel's
  //   leftmost color clock: 17 for a single-wide sprite, 16 for a
  //   double/quad-wide one (their  left edges start 1 color clock
  //   earlier at 2x/4x pixel width) - see the WIDTH dropdown.
  // - Y scales by pfRowDivisorFor(config) - 8 for the standard (non-
  //   Superchip) kernel's  implicit pfres=12 (96/12, matching the docs'
  //   "8 scanlines tall" and player0y's documented 1-88 range: 11
  //   VISIBLE rows * 8 = 88), and floor(96/pfres) once Superchip's  pfres
  //   is active - floor(96/32) = 3 for the pfres=32 Superchip example above,
  //   an exact match for that program's  divisor. See pfRowDivisorFor's
  //   comment in utils/playfield-coords.js for why this can't just
  //   divide by effectiveBackgroundRows(config) directly (that's the
  //   VISIBLE row count, 11 by default - one less than the kernel's
  //   true pfres=12 - only Superchip's  pfres has no such gap). The +1
  //   offset (player Y is measured from a sprite's  BOTTOM row, whose
  //   first usable value is 1, not 0) is independent of pfres and applies
  //   either way - the example's "14" isn't that offset, just its
  //   unrelated arbitrary starting position for that demo.
  // Y's divisor is a real per-project value, not always a power of 2, so
  // (unlike X's fixed /4, always a shift) it needs usesDivMul/div_mul.asm -
  // set unconditionally on both blocks for simplicity, same as
  // emitColorFadeTrigger above does even for its  power-of-2 case.
  Blockly.BBasic[`background_pixel_to_sprite`] = function(block) {
    const axis = block.getFieldValue('AXIS');
    if (axis === 'Y') {
      const y = Blockly.BBasic.valueToCode(block, 'COORD', Blockly.BBasic.ORDER_MULTIPLICATION) || '0';
      const configurationStorage = useConfigurationStorage();
      const config = (configurationStorage && configurationStorage.value) || {};
      Blockly.BBasic.usesDivMul = true;
      return [`${pfRowDivisorFor(config)} * ${y} + 1`, Blockly.BBasic.ORDER_ADDITION];
    }
    const x = Blockly.BBasic.valueToCode(block, 'COORD', Blockly.BBasic.ORDER_MULTIPLICATION) || '0';
    const xOffset = spriteXOffset(block.getFieldValue('WIDTH'));
    return [`4 * ${x} + ${xOffset}`, Blockly.BBasic.ORDER_ADDITION];
  };

  Blockly.BBasic[`background_sprite_to_pixel`] = function(block) {
    const axis = block.getFieldValue('AXIS');
    if (axis === 'Y') {
      const y = Blockly.BBasic.valueToCode(block, 'COORD', Blockly.BBasic.ORDER_SUBTRACTION) || '0';
      const configurationStorage = useConfigurationStorage();
      const config = (configurationStorage && configurationStorage.value) || {};
      Blockly.BBasic.usesDivMul = true;
      return [`(${y} - 1) / ${pfRowDivisorFor(config)}`, Blockly.BBasic.ORDER_DIVISION];
    }
    const x = Blockly.BBasic.valueToCode(block, 'COORD', Blockly.BBasic.ORDER_SUBTRACTION) || '0';
    const xOffset = spriteXOffset(block.getFieldValue('WIDTH'));
    return [`(${x} - ${xOffset}) / 4`, Blockly.BBasic.ORDER_DIVISION];
  };

  // background_collision_pixel's  per-sprite X/Y system vars, plus each
  // one's "is this sprite currently stretched to double/quad width" runtime
  // test - see blocks/background.js's  comment on this block for why
  // width has to be auto-detected rather than asked for. Player 0/Missile 0
  // and Player 1/Missile 1 each share ONE real bB variable
  // (player0size/player1size - confirmed readable, see generators/bbasic/
  // sprites.js's  sprite_player_size generator, which reads it as a
  // source operand) covering both that player's  stretch (bits 0/2, mask
  // $05) and that missile's  width (bits 4-5, mask $30 - see sprites.js's
  // sprite_..._set generator, which writes missile width into THIS same
  // var, never a separate one). Ball width lives in the SAME bit positions
  // ($30) of sprites.js's  CTRLPF RAM shadow instead of the real
  // (unsafe-to-read-back) CTRLPF register - see ctrlpfShadowVarName's
  // comment there. Not a static map - ball's  entry needs nameDB_ to
  // resolve the shadow var's real letter, so this has to be a function.
  const spriteCollisionCoords = (sprite) => {
    if (sprite === 'ball') {
      const shadowVar = Blockly.BBasic.nameDB_.getName(
          ctrlpfShadowVarName(), Blockly.Names.DEVELOPER_VARIABLE_TYPE);
      return {x: 'ballx', y: 'bally', stretched: `${shadowVar} & $30 <> 0`};
    }
    const byName = {
      player0: {x: 'player0x', y: 'player0y', stretched: 'player0size & $05 = $05'},
      player1: {x: 'player1x', y: 'player1y', stretched: 'player1size & $05 = $05'},
      missile0: {x: 'missile0x', y: 'missile0y', stretched: 'player0size & $30 <> 0'},
      missile1: {x: 'missile1x', y: 'missile1y', stretched: 'player1size & $30 <> 0'},
    };
    return byName[sprite];
  };

  // Given a sprite that just registered a hardware Playfield collision,
  // works out which exact playfield column/row it's touching - see this
  // block's  tooltip in blocks/background.js, and the top-of-file safety
  // reasoning in generators/bbasic/collision.js (this exact "software
  // pfread()-based pixel-precise collision" territory has caused real bugs
  // here before: a ROM lockup from an out-of-range playfield index, and a
  // separate hard crash on contact). Every value handed to pfread() below is
  // first clamped into its valid range (0-31 for column, 0-maxRow for row) -
  // bB bytes are unsigned, so a division that would otherwise go negative
  // just wraps to a large positive value instead, which these clamps catch
  // exactly the same way as a genuinely too-large one.
  //
  // A single division doesn't always land exactly on the pixel that was
  // actually touched (see ChipOff's  account, quoted directly to the
  // user, of why it re-checks with pfread and nudges by one column) - this
  // generalizes that to both axes with a small, bounded (at most 4 pfread
  // calls, no loops) escalating check: exact cell, then nudged column alone,
  // then nudged row alone, then - only if neither single-axis nudge found a
  // lit pixel - the diagonal (both nudged) combination, trusted without a
  // further re-check (matching ChipOff's "trust the final nudge, don't
  // re-verify" behavior for its  last fallback step). "Moving right"/
  // "moving down" pick which way each axis nudges - see blocks/background.js's
  // comment on why direction is a plain user-supplied input here, not
  // auto-tracked previous-frame position.
  Blockly.BBasic['background_collision_pixel'] = function(block) {
    const sprite = block.getFieldValue('SPRITE');
    const coords = spriteCollisionCoords(sprite);
    const movingRight = Blockly.BBasic.valueToCode(block, 'MOVING_RIGHT', Blockly.BBasic.ORDER_LOGICAL_AND) || '0';
    const movingDown = Blockly.BBasic.valueToCode(block, 'MOVING_DOWN', Blockly.BBasic.ORDER_LOGICAL_AND) || '0';
    const configurationStorage = useConfigurationStorage();
    const config = (configurationStorage && configurationStorage.value) || {};
    const maxRow = effectiveBackgroundRows(config) - 1;
    const rowDivisor = pfRowDivisorFor(config);
    Blockly.BBasic.usesDivMul = true;

    const col = Blockly.BBasic.superchipRwPairs[collisionPixelColumnVarName()];
    const row = Blockly.BBasic.superchipRwPairs[collisionPixelRowVarName()];
    // Scratch for the neighbor checks: temp3/temp4 survive pfread (which only
    // overwrites temp1/temp2), so no variables are needed for them.
    const col2 = {read: 'temp3', write: 'temp3'};
    const row2 = {read: 'temp4', write: 'temp4'};

    const id = Blockly.BBasic.blockNumbers.next('collisionPixel');
    const useCol2Label = `_collision_pixel_${id}_usecol2`;
    const useRow2Label = `_collision_pixel_${id}_userow2`;
    const colRightLabel = `_collision_pixel_${id}_colright`;
    const afterColLabel = `_collision_pixel_${id}_aftercol`;
    const rowDownLabel = `_collision_pixel_${id}_rowdown`;
    const afterRowLabel = `_collision_pixel_${id}_afterrow`;
    const doneLabel = `_collision_pixel_${id}_done`;

    return [
      // Exact column/row, clamped before anything ever reads them.
      `${col.write} = (${coords.x} - 17) / 4`,
      `if ${coords.stretched} then ${col.write} = (${coords.x} - 16) / 4`,
      `if ${col.read} > 31 then ${col.write} = 31`,
      `${row.write} = (${coords.y} - 1) / ${rowDivisor}`,
      `if ${row.read} > ${maxRow} then ${row.write} = ${maxRow}`,
      // Exact cell.
      `if pfread(${col.read}, ${row.read}) then goto ${doneLabel}`,
      // Nudged column alone.
      `${col2.write} = ${col.read}`,
      `if ${movingRight} then goto ${colRightLabel}`,
      `if ${col2.read} > 0 then ${col2.write} = ${col2.read} - 1`,
      `goto ${afterColLabel}`,
      `@ ${colRightLabel}`,
      `if ${col2.read} < 31 then ${col2.write} = ${col2.read} + 1`,
      `@ ${afterColLabel}`,
      `if pfread(${col2.read}, ${row.read}) then goto ${useCol2Label}`,
      // Nudged row alone.
      `${row2.write} = ${row.read}`,
      `if ${movingDown} then goto ${rowDownLabel}`,
      `if ${row2.read} > 0 then ${row2.write} = ${row2.read} - 1`,
      `goto ${afterRowLabel}`,
      `@ ${rowDownLabel}`,
      `if ${row2.read} < ${maxRow} then ${row2.write} = ${row2.read} + 1`,
      `@ ${afterRowLabel}`,
      `if pfread(${col.read}, ${row2.read}) then goto ${useRow2Label}`,
      // Neither single-axis nudge found it - diagonal fallback, trusted
      // without a further re-check.
      `${col.write} = ${col2.read}`,
      `${row.write} = ${row2.read}`,
      `goto ${doneLabel}`,
      `@ ${useCol2Label}`,
      `${col.write} = ${col2.read}`,
      `goto ${doneLabel}`,
      `@ ${useRow2Label}`,
      `${row.write} = ${row2.read}`,
      `@ ${doneLabel}`,
    ].join('\n') + '\n';
  };

  // The direction version of the block above. The direction (0-7 clockwise
  // from Up, anything else for none) is held in the nudged-row scratch var
  // while it is classified. Only the axes the direction actually moves along
  // are nudged: a straight horizontal or vertical direction takes the
  // neighboring cell ahead of the sprite, and a diagonal runs the same
  // escalating check as the two-input block (column, then row, then both).
  Blockly.BBasic['background_collision_pixel_direction'] = function(block) {
    const sprite = block.getFieldValue('SPRITE');
    const coords = spriteCollisionCoords(sprite);
    const direction = Blockly.BBasic.valueToCode(block, 'DIRECTION', Blockly.BBasic.ORDER_NONE) || '255';
    const configurationStorage = useConfigurationStorage();
    const config = (configurationStorage && configurationStorage.value) || {};
    const maxRow = effectiveBackgroundRows(config) - 1;
    const rowDivisor = pfRowDivisorFor(config);
    Blockly.BBasic.usesDivMul = true;

    const col = Blockly.BBasic.superchipRwPairs[collisionPixelColumnVarName()];
    const row = Blockly.BBasic.superchipRwPairs[collisionPixelRowVarName()];
    // Scratch for the neighbor checks: temp3/temp4 survive pfread (which only
    // overwrites temp1/temp2), so no variables are needed for them.
    const col2 = {read: 'temp3', write: 'temp3'};
    const row2 = {read: 'temp4', write: 'temp4'};

    const id = Blockly.BBasic.blockNumbers.next('collisionPixel');
    const label = (name) => `_collision_pixel_${id}_${name}`;
    const gotoIf = (dirs, target) => dirs.map((d) => `if ${row2.read} = ${d} then goto ${label(target)}`);

    // Bounce turns a fired object around the moment it hits, so a Fire angle
    // read after it points away from what was hit. For that case, use the
    // heading from before the bounce while the bounce is still settling.
    const dirBlock = block.getInputTargetBlock('DIRECTION');
    const bounceLines = [];
    // A Fire angle from a Fire block set to 16 directions counts 0-15, not 0-7.
    let is16 = false;
    if (dirBlock && dirBlock.type === 'sprite_fire_angle_get') {
      const field = dirBlock.getFieldValue('MISSILE');
      const fired = field === 'ball' ? 'ball' : `missile${field === '1' ? '1' : '0'}`;
      is16 = (Blockly.BBasic.missileFire16UsedFor || new Set()).has(fired);
      const pairs = Blockly.BBasic.superchipRwPairs;
      const stage = pairs[missileBounceStageVarName(fired)];
      if (stage) {
        bounceLines.push(
            `temp5 = ${stage.read} & 48`,
            `if temp5 = 0 then goto ${label('nobounce')}`,
            `${row2.write} = ${stage.read} & 15`,
            `@ ${label('nobounce')}`);
      }
    }

    // 16-direction diagonals as [rightFlag + downFlag, directions].
    const diag16Groups = {};
    DIRECTION16_STEPS.forEach(([xStep, yStep], dir) => {
      if (!xStep || !yStep) return;
      const key = `${xStep > 0 ? 1 : 0}${yStep > 0 ? 1 : 0}`;
      (diag16Groups[key] = diag16Groups[key] || []).push(dir);
    });
    const diag16 = is16 ? Object.entries(diag16Groups) : [];

    return [
      // The direction, kept in the row scratch var until it is classified.
      `${row2.write} = ${direction}`,
      ...bounceLines,
      // Exact column/row, clamped before anything ever reads them.
      `${col.write} = (${coords.x} - 17) / 4`,
      `if ${coords.stretched} then ${col.write} = (${coords.x} - 16) / 4`,
      `if ${col.read} > 31 then ${col.write} = 31`,
      `${row.write} = (${coords.y} - 1) / ${rowDivisor}`,
      `if ${row.read} > ${maxRow} then ${row.write} = ${maxRow}`,
      // Exact cell.
      `if pfread(${col.read}, ${row.read}) then goto ${label('done')}`,
      // Classify the direction: straight, diagonal, or none (exact cell only).
      ...(is16 ? [
        ...gotoIf([4], 'right'),
        ...gotoIf([12], 'left'),
        ...gotoIf([0], 'up'),
        ...gotoIf([8], 'down'),
        // Every other direction, grouped by which way it leans on each axis.
        ...diag16.flatMap(([key, dirs]) => gotoIf(dirs, `d16_${key}`)),
      ] : [
        ...gotoIf([2], 'right'),
        ...gotoIf([6], 'left'),
        ...gotoIf([0], 'up'),
        ...gotoIf([4], 'down'),
        ...gotoIf([1, 3, 5, 7], 'diagonal'),
      ]),
      `goto ${label('done')}`,
      // Straight directions: the neighboring cell ahead of the sprite.
      `@ ${label('right')}`,
      `if ${col.read} < 31 then ${col.write} = ${col.read} + 1`,
      `goto ${label('done')}`,
      `@ ${label('left')}`,
      `if ${col.read} > 0 then ${col.write} = ${col.read} - 1`,
      `goto ${label('done')}`,
      `@ ${label('up')}`,
      `if ${row.read} > 0 then ${row.write} = ${row.read} - 1`,
      `goto ${label('done')}`,
      `@ ${label('down')}`,
      `if ${row.read} < ${maxRow} then ${row.write} = ${row.read} + 1`,
      `goto ${label('done')}`,
      // Diagonals: the right flag goes in the column scratch var and the down
      // flag in the row scratch var (replacing the direction), then the same
      // column / row / both escalation as the two-input block.
      ...diag16.flatMap(([key]) => [
        `@ ${label(`d16_${key}`)}`,
        `${col2.write} = ${key[0]}`,
        `${row2.write} = ${key[1]}`,
        `goto ${label('flagsdone')}`,
      ]).slice(0, is16 ? undefined : 0),
      `@ ${label('diagonal')}`,
      `${col2.write} = 0`,
      `if ${row2.read} = 1 then ${col2.write} = 1`,
      `if ${row2.read} = 3 then ${col2.write} = 1`,
      `if ${row2.read} = 3 then goto ${label('setdown')}`,
      `if ${row2.read} = 5 then goto ${label('setdown')}`,
      `${row2.write} = 0`,
      `goto ${label('flagsdone')}`,
      `@ ${label('setdown')}`,
      `${row2.write} = 1`,
      `@ ${label('flagsdone')}`,
      // Nudged column alone.
      `if ${col2.read} then goto ${label('colright')}`,
      `${col2.write} = ${col.read}`,
      `if ${col2.read} > 0 then ${col2.write} = ${col2.read} - 1`,
      `goto ${label('aftercol')}`,
      `@ ${label('colright')}`,
      `${col2.write} = ${col.read}`,
      `if ${col2.read} < 31 then ${col2.write} = ${col2.read} + 1`,
      `@ ${label('aftercol')}`,
      `if pfread(${col2.read}, ${row.read}) then goto ${label('usecol2')}`,
      // Nudged row alone.
      `if ${row2.read} then goto ${label('rowdown')}`,
      `${row2.write} = ${row.read}`,
      `if ${row2.read} > 0 then ${row2.write} = ${row2.read} - 1`,
      `goto ${label('afterrow')}`,
      `@ ${label('rowdown')}`,
      `${row2.write} = ${row.read}`,
      `if ${row2.read} < ${maxRow} then ${row2.write} = ${row2.read} + 1`,
      `@ ${label('afterrow')}`,
      `if pfread(${col.read}, ${row2.read}) then goto ${label('userow2')}`,
      // Neither single-axis nudge found it: the diagonal cell, trusted.
      `${col.write} = ${col2.read}`,
      `${row.write} = ${row2.read}`,
      `goto ${label('done')}`,
      `@ ${label('usecol2')}`,
      `${col.write} = ${col2.read}`,
      `goto ${label('done')}`,
      `@ ${label('userow2')}`,
      `${row.write} = ${row2.read}`,
      `@ ${label('done')}`,
    ].join('\n') + '\n';
  };

  Blockly.BBasic['background_rainbow_colors'] = function(block) {
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const offsetVar = resolveVar(backgroundRainbowOffsetVarName());
    const flagsVar = resolveVar(romNoiseFlagsVarName());
    const offset = Blockly.BBasic.valueToCode(block, 'OFFSET', Blockly.BBasic.ORDER_ASSIGNMENT) ||
      'framecounter';
    return `${offsetVar} = ${offset}\n${flagsVar}{${backgroundRainbowActiveBit}} = 1\n`;
  };

  Blockly.BBasic['background_rainbow_colors_stop'] = function(block) {
    const flagsVar = Blockly.BBasic.nameDB_.getName(romNoiseFlagsVarName(), Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const resolve = (name) => Blockly.BBasic.nameDB_.getName(name, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    // Also points the kernel back at the loaded background's row colors.
    return `${flagsVar}{${backgroundRainbowActiveBit}} = 0\n` +
      `pfcolortable = ${resolve(backgroundColorTableLoVarName())}\n` +
      `aux2 = ${resolve(backgroundColorTableHiVarName())}\n` +
      // The top row's color is the first entry of that table: read it back.
      'asm\nldy #0\nlda (pfcolortable),y\nsta playfieldrealcolor\n@end\n';
  };

  Blockly.BBasic['background_collision_pixel_column'] = function(block) {
    const pair = Blockly.BBasic.superchipRwPairs[collisionPixelColumnVarName()];
    return [pair.read, Blockly.BBasic.ORDER_ATOMIC];
  };

  Blockly.BBasic['background_collision_pixel_row'] = function(block) {
    const pair = Blockly.BBasic.superchipRwPairs[collisionPixelRowVarName()];
    return [pair.read, Blockly.BBasic.ORDER_ATOMIC];
  };

  Blockly.BBasic[`background_select`] = function(block) {
    const code = block.getFieldValue('VAR') || 0;
    return [code, Blockly.BBasic.ORDER_ATOMIC];
  };

  Blockly.BBasic[`background_set`] = function(block) {
    // Score setter.
    const argument0 = Blockly.BBasic.valueToCode(block, 'VALUE',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    return 'newbackground = ' + argument0 + '\n';
  };

  Blockly.BBasic[`background_set_select`] = function(block) {
    // Score setter.
    const argument0 = block.getFieldValue('VAR') || 0;
    return 'newbackground = ' + argument0 + '\n';
  };

  Blockly.BBasic[`background_set_color`] = function(block) {
    // Background/playfield color setter.
    const argument0 = Blockly.BBasic.valueToCode(block, 'VALUE',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const rawVar = block.getFieldValue('VAR');
    // COLUPF and COLUBK are both overwritten every frame by the score/text
    // drawing routines (the standard kernel's score digits, the playfield
    // score bars if enabled, and the Text Minikernel's "sta COLUBK"),
    // so both are tracked and restored each frame from a shadow variable,
    // just like COLUP0/COLUP1 are.
    const targetVar = rawVar === 'COLUPF' ? 'playfieldrealcolor' :
      rawVar === 'COLUBK' ? 'backgroundrealcolor' : rawVar;
    const varName = Blockly.BBasic.nameDB_.getName(
        targetVar, Blockly.VARIABLE_CATEGORY_NAME);
    return varName + ' = ' + argument0 + '\n';
  };

  Blockly.BBasic[`background_get_color`] = function(block) {
    // Same COLUPF/COLUBK -> playfieldrealcolor/backgroundrealcolor mapping
    // as background_set_color's  setter above - reads the live shadow
    // variable both blocks share, not the hardware register directly
    // (which the score/text drawing routines overwrite every frame - see
    // that setter's  comment).
    const rawVar = block.getFieldValue('VAR');
    const targetVar = rawVar === 'COLUPF' ? 'playfieldrealcolor' :
      rawVar === 'COLUBK' ? 'backgroundrealcolor' : rawVar;
    const varName = Blockly.BBasic.nameDB_.getName(
        targetVar, Blockly.VARIABLE_CATEGORY_NAME);
    return [varName, Blockly.BBasic.ORDER_ATOMIC];
  };

  const resolveVar = (canonicalName) =>
    Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);

  // The real color variable a fade register's rawVar actually writes to -
  // shared by emitColorFadeTrigger and generateBackgroundFadeChecks'
  // checksForVar below, which used to duplicate this same resolution.
  // COLUBK/COLUPF need a separate shadow variable (see background_set_color's
  // comment above) since the score/text drawing routines overwrite the
  // real register every frame - scorecolor/TextColor have no such override,
  // so the real variable doubles as its  shadow. player0realcolor/
  // player1realcolor have no separate shadow alias either (nothing renames
  // them the way COLUBK/COLUPF rename to backgroundrealcolor/
  // playfieldrealcolor), but - unlike scorecolor/TextColor - they're still
  // app-internal dev vars needing nameDB_ resolution (sprite_${name}_get/set
  // already resolve this same VAR through nameDB_/VARIABLE_CATEGORY_NAME -
  // see generators/bbasic/sprites.js), so they're grouped with COLUBK/COLUPF
  // here, not scorecolor/TextColor.
  const resolveFadeColorVar = (rawVar) => {
    const needsNameDbResolution = rawVar === 'COLUPF' || rawVar === 'COLUBK' ||
      rawVar === 'player0realcolor' || rawVar === 'player1realcolor';
    const targetShadowVar = rawVar === 'COLUPF' ? 'playfieldrealcolor' :
      rawVar === 'COLUBK' ? 'backgroundrealcolor' : rawVar;
    // scorecolor/TextColor are real batari Basic identifiers already
    // (score.js's  score_color_get/set and text-minikernel.js's
    // TextColor blocks both reference them as plain literals, never through
    // nameDB_) - only COLUBK/COLUPF's shadow vars and player0realcolor/
    // player1realcolor are app-internal dev vars that actually need letter
    // resolution.
    return needsNameDbResolution ?
      Blockly.BBasic.nameDB_.getName(targetShadowVar, Blockly.VARIABLE_CATEGORY_NAME) : targetShadowVar;
  };

  // Fires a fade trigger once - stores the target color and this fade's
  // pace (this fade's total requested duration, divided across FADE_STEPS
  // installments - "over roughly this many frames" is the OVERALL fade
  // time, not a per-step delay), then sets the "active" bit
  // (generateBackgroundFadeChecks below reads that bit every frame from
  // then on and does the actual stepping; see backgroundFadeTimerVarName's
  // comment in blocks/background.js for why this is a one-shot trigger
  // rather than a "call every frame yourself" block).
  //
  // The actual RESET (timer/pace/active all snapping back to a fresh fade)
  // is skipped only when this exact request is already fully accounted for -
  // either a fade toward this target is actively in progress right now
  // (activeBit), or the real color already sits at the target (nothing left
  // to do) - rather than unconditional, because a "Fade to color" block
  // placed in a per-frame event (title_update, say) calls this every single
  // frame for the SAME target color: unconditionally re-priming the timer
  // every time that happens meant the per-frame step
  // (generateBackgroundFadeChecks, which runs earlier in commongamelogic, so
  // its  progress got immediately overwritten right after) could never
  // actually count down to 0 - a real reported bug ("fade finished never
  // seems to trigger"; the fade itself never finishes, since it's
  // perpetually reset before it can), same class of bug (and same fix) as
  // buildTextScrollSetupLines' "same message, don't re-reset" guard in
  // text-scroll.js.
  //
  // Checking only targetVar (not the real color too, as this now does) was
  // confirmed as a real, separate reported bug: a "Fade to color" placed in
  // a one-shot event (Title screen start) that re-runs every time that
  // screen is re-entered, preceded by its "Set color" block resetting
  // the real color back to its starting value each time - targetVar still
  // held the PREVIOUS visit's already-reached target, so the guard kept
  // treating the fresh request as a no-op repeat and never restarted the
  // fade, even though the real color had genuinely just been reset away
  // from it. Comparing the real color too fixes this without needing to
  // know which kind of event the block was placed in: once a fade truly
  // settles (or was never running), the real color equals the target, so a
  // later request for that SAME target only re-arms when something has
  // since moved the real color away from it again.
  //
  // color is captured into temp1 exactly once, before either comparison,
  // rather than embedded directly into each "if" and the assignment - it
  // can be an arbitrary expression (not necessarily side-effect-free, e.g.
  // a Random block), and evaluating it more than once could disagree with
  // itself between the guard checks and the actual reset (same reasoning
  // random_between_set's "rand" capture uses in generators/bbasic/
  // random.js).
  //
  // Shared by background_fade_to below and score.js's  score_fade_to /
  // text-minikernel.js's  text_minikernel_fade_to - the trigger body is
  // identical regardless of which register it targets, only rawVar (and so
  // which dev vars/bit/color variable it resolves to) differs.
  Blockly.BBasic.emitColorFadeTrigger = function(rawVar, color, frames) {
    const colorVar = resolveFadeColorVar(rawVar);
    const timerVar = resolveVar(backgroundFadeTimerVarName(rawVar));
    const paceVar = resolveVar(backgroundFadePaceVarName(rawVar));
    const targetVar = resolveVar(backgroundFadeTargetVarName(rawVar));
    const activeBit = `${resolveVar(fadeFlagsVarName(rawVar))}{${fadeActiveBit(rawVar)}}`;
    // frames/FADE_STEPS is still a genuine runtime division (frames isn't
    // known at compile time) - needs the shared div8 routine UNLESS the
    // divisor is a compile-time constant power of 2, in which case the
    // real compiler optimizes it into a plain shift instead (see
    // generateDivMul's  comment in generators/bbasic.js) - which is
    // exactly why FADE_STEPS is fixed at 4 rather than a user choice (see
    // its  comment in blocks/background.js): a shift never needs
    // div_mul.asm's  same-bank "jsr", so this division stays safe no
    // matter which bank this trigger's  code ends up in, unlike a
    // non-power-of-2 divisor would if this block ever landed in a
    // relocated event.
    Blockly.BBasic.usesDivMul = true;

    const blockNumber = Blockly.BBasic.blockNumbers.next();
    const resetLabel = `_bgfade_${blockNumber}_reset`;
    const paceReadyLabel = `_bgfade_${blockNumber}_paceready`;
    const skipLabel = `_bgfade_${blockNumber}_skip`;

    // Guards frames < FADE_STEPS the same way the old inline version did:
    // the division alone would floor to 0, which would otherwise underflow
    // the very next decrement (in the per-frame check) into a huge wrapped
    // byte instead of counting down from 0 the way a signed timer would.
    return [
      `temp1 = ${color}`,
      `if ${targetVar} <> temp1 then goto ${resetLabel}`,
      `if ${activeBit} then goto ${skipLabel}`,
      `if ${colorVar} = temp1 then goto ${skipLabel}`,
      `@ ${resetLabel}`,
      `${targetVar} = temp1`,
      `${paceVar} = (${frames}) / ${FADE_STEPS}`,
      `if ${paceVar} <> 0 then goto ${paceReadyLabel}`,
      ` ${paceVar} = 1`,
      `@ ${paceReadyLabel}`,
      `${timerVar} = ${paceVar}`,
      `${activeBit} = 1`,
      `@ ${skipLabel}`,
    ].join('\n') + '\n';
  };

  Blockly.BBasic[`background_fade_to`] = function(block) {
    const rawVar = block.getFieldValue('VAR');
    const color = Blockly.BBasic.valueToCode(block, 'VALUE', Blockly.BBasic.ORDER_NONE) || '0';
    const frames = Blockly.BBasic.valueToCode(block, 'FRAMES', Blockly.BBasic.ORDER_NONE) || '1';
    return Blockly.BBasic.emitColorFadeTrigger(rawVar, color, frames);
  };

  // Spliced into commongamelogic (see bbasic.bb.hbs), right after the
  // Sound FX fade checks and before the Music tab's  per-frame checks -
  // same reasoning as generateEnvelopeChecks in generators/bbasic/
  // soundfx.js: this runs unconditionally every single frame regardless of
  // where the user's  background_fade_to trigger sits in their code, so
  // a fade keeps advancing even after a triggering "if" condition (e.g.
  // "if joystick fire") goes false again on the very next frame.
  //
  // One check per register actually used by ANY background_fade_to block
  // in the project (backgroundFadeVarsUsed, resolved once up front in
  // generators/bbasic.js - see that file's  comment) - a project that
  // only ever fades COLUBK never pays for a COLUPF check at all.
  //
  // temp1/temp2 are the compiler's  shared scratch registers, safe to
  // hold a value in across several statements here for the same reason as
  // score.js's  buildDigitPokeLines comment: only ever clobbered by
  // drawscreen, which can't run in the middle of this function's
  // generated lines.
  //
  // Hue stays on whatever it already was for the ENTIRE ramp, only
  // snapping to the target's hue on the exact step that lands brightness
  // on the target (or immediately, if brightness already matched the
  // target from the start - nothing to ramp at all). This was a deliberate
  // choice, not an oversight: the other order (snap hue to the target
  // immediately, ramp brightness afterward) was tried first and confirmed
  // to look worse in practice - many hues on this hardware render as
  // washed-out/grey at anything below full brightness, so ramping the
  // TARGET hue through low-to-mid brightness looked like the fade was
  // "turning greyscale" for most of its  duration before finally
  // becoming the right color at the end. Ramping the STARTING hue instead
  // means the color shown throughout is always a real, saturated color
  // (just not yet the target one) until the final step swaps it in.
  //
  // Direction (up or down) is decided FRESH on every step by comparing the
  // color's  CURRENT brightness against the target's, so one active
  // fade naturally reverses if retriggered toward a new target on the
  // other side of the current brightness - no separate "fade up"/"fade
  // down" state to keep in sync with reality.
  // Hand-written 6502 replacement for the bB if/goto chain checksForVar
  // below used to build for every fadeable register - COLUBK/COLUPF
  // (background/playfield) AND scorecolor/TextColor (score/text) all route
  // through this now. Not a mechanical translation: every
  // "(x & $0E)" the bB version recomputes from memory on each of its many
  // uses is instead loaded/masked ONCE into the accumulator and kept there
  // (or cached into temp2/temp3) across the branches that need it, and
  // 6502's  carry flag from CMP directly answers ">="/"<" without a
  // separate bB-style comparison-then-branch pair for each - real cycle
  // savings, not just fewer bB statements. temp2/temp3 are safe scratch
  // here for the same reason the bB version already relies on temp2 being
  // safe (see this whole function's  top comment): this runs directly in
  // commongamelogic, never inside a user Function body, so there's no
  // argument-passing collision risk (see function_param_get's  comment
  // in generators/bbasic/function.js for where THAT risk actually applies).
  //
  // Register discipline other branches below can rely on (confirmed
  // directly against 6502 semantics, not a guess): CMP/BCC/BCS/BEQ/BNE never
  // modify the accumulator, so falling through a branch that wasn't taken
  // leaves A holding whatever the immediately preceding CMP compared -
  // exploited below to skip a handful of redundant reloads.
  //
  // Every label is a plain global DASM symbol (no leading dot, matching
  // this file's  existing "_bgfadechk_<tag>_*" convention) - safe here
  // specifically BECAUSE this whole check is spliced into commongamelogic,
  // which is fixed, always-bank-1 content, never relocated the way
  // generators/bbasic/music.js's  relocatable musicEngine unit can be
  // (see that file's  comment on the real, confirmed "DASM Origin
  // Reverse-indexed" build failure a raw asm block hit ONLY once relocated
  // to a non-bank-1 position - this check's  fixed position sidesteps
  // that class of bug entirely, not just avoids repeating the mistake).
  const buildFadeCheckAsm = ({colorVar, targetVar, timerVar, paceVar, flagsVar, activeBit, finishedBit, tag, isWatched}) => {
    const activeMask = 1 << activeBit;
    const finishedMask = isWatched ? (1 << finishedBit) : 0;
    const done = `_bgfadeasm_${tag}_done`;
    const skip = `_bgfadeasm_${tag}_skip`;
    const checkDir = `_bgfadeasm_${tag}_checkdir`;
    const up = `_bgfadeasm_${tag}_up`;
    const upAfter = `_bgfadeasm_${tag}_upafter`;
    const downSub = `_bgfadeasm_${tag}_downsub`;
    const downClamp = `_bgfadeasm_${tag}_downclamp`;
    const downAfter = `_bgfadeasm_${tag}_downafter`;
    const reprime = `_bgfadeasm_${tag}_reprime`;
    const already = `_bgfadeasm_${tag}_already`;
    // 6502 relative branches (BEQ/BNE/BCC/BCS/...) only reach +/-127 bytes -
    // this whole state machine is bigger than that, so a plain "beq skip"/
    // "beq already" etc. can land "Branch out of range" once assembled,
    // confirmed directly as a real build failure (both bg and pf's
    // "beq skip" - the one spanning the ENTIRE block - measured 147 bytes,
    // 20 over the limit). JMP has no such range limit, so any branch whose
    // target ISN'T a handful of instructions away goes through here instead:
    // the ordinary short-range branch on the INVERTED condition jumps past a
    // single "jmp target" when NOT taken, so the net effect is identical to
    // a plain branch, just 1-2 cycles costlier on each path - a small,
    // fixed price for not having to hand-verify every branch's  distance
    // stays under 128 bytes as this function's  body inevitably grows or
    // shrinks with future changes.
    let farBranchCounter = 0;
    const farBeq = (target) => {
      const near = `_bgfadeasm_${tag}_n${farBranchCounter++}`;
      return [`       bne ${near}`, `       jmp ${target}`, near];
    };
    const farBne = (target) => {
      const near = `_bgfadeasm_${tag}_n${farBranchCounter++}`;
      return [`       beq ${near}`, `       jmp ${target}`, near];
    };
    const farBcc = (target) => {
      const near = `_bgfadeasm_${tag}_n${farBranchCounter++}`;
      return [`       bcs ${near}`, `       jmp ${target}`, near];
    };

    // "Landed exactly on target" is reached from both the up and down
    // branches, and does the exact same thing either way (see the bB
    // version's  comment on why hue switches to the TARGET's here,
    // unlike reprime, which keeps the CURRENT hue) - one shared copy of it,
    // not duplicated per direction.
    const landedLines = [
      '       lda ' + targetVar,
      '       and #$F0',
      '       ora temp2',
      '       sta ' + colorVar,
      '       lda ' + flagsVar,
      '       and #' + (255 - activeMask),
      '       sta ' + flagsVar,
      // "sta" never touches A - still holds the masked value from the line
      // just above, so isWatched's "ora finishedMask" can build on it
      // directly instead of a redundant "lda flagsVar" reload.
      ...(isWatched ? [
        '       ora #' + finishedMask,
        '       sta ' + flagsVar,
      ] : []),
      '       jmp ' + done,
    ];

    return [
      ' asm',
      // Same "sta never touches A" reuse as landedLines/already below -
      // isWatched's  clear leaves A already holding flagsVar (post-mask),
      // so the activeMask test right after builds on it directly instead of
      // a redundant reload. finishedMask/activeMask are disjoint bits, so
      // "(flags & ~finishedMask) & activeMask" is exactly "flags &
      // activeMask" either way.
      ...(isWatched ? [
        '       lda ' + flagsVar,
        '       and #' + (255 - finishedMask),
        '       sta ' + flagsVar,
        '       and #' + activeMask,
      ] : [
        '       lda ' + flagsVar,
        '       and #' + activeMask,
      ]),
      ...farBeq(skip),
      '       lda ' + targetVar,
      '       and #$0E',
      '       sta temp3',
      '       lda ' + colorVar,
      '       and #$0E',
      '       sta temp2',
      '       cmp temp3',
      ...farBeq(already),
      '       lda ' + timerVar,
      '       beq ' + checkDir,
      '       dec ' + timerVar,
      '       jmp ' + done,
      checkDir,
      '       lda temp2',
      '       cmp temp3',
      ...farBcc(up),
      // DOWN - A already holds temp2 (current brightness) here, straight
      // from the "cmp temp3" just above (CMP never touches A) - see this
      // function's "Register discipline" comment.
      '       cmp #' + FADE_INCREMENT,
      '       bcs ' + downSub,
      '       lda #0',
      '       jmp ' + downClamp,
      downSub,
      '       sec',
      '       sbc #' + FADE_INCREMENT,
      downClamp,
      '       cmp temp3',
      '       bcs ' + downAfter,
      '       lda temp3',
      downAfter,
      '       sta temp2',
      '       cmp temp3',
      ...farBne(reprime),
      ...landedLines,
      up,
      // A already holds temp2 (current brightness) here too, straight from
      // the "cmp temp3"/"bcc up" branch above.
      '       clc',
      '       adc #' + FADE_INCREMENT,
      '       cmp temp3',
      '       beq ' + upAfter,
      '       bcc ' + upAfter,
      '       lda temp3',
      upAfter,
      '       sta temp2',
      '       cmp temp3',
      ...farBne(reprime),
      ...landedLines,
      reprime,
      // Keeps the CURRENT hue (colorVar's  high nibble), only the
      // brightness nibble changes this step - see the bB version's
      // comment on why this differs from the "landed" case above.
      '       lda ' + colorVar,
      '       and #$F0',
      '       ora temp2',
      '       sta ' + colorVar,
      '       lda ' + paceVar,
      '       sta ' + timerVar,
      '       jmp ' + done,
      already,
      '       lda ' + targetVar,
      '       and #$F0',
      '       ora temp2',
      '       sta ' + colorVar,
      '       lda ' + flagsVar,
      '       and #' + (255 - activeMask),
      '       sta ' + flagsVar,
      // Same "sta never touches A" reuse as landedLines above.
      ...(isWatched ? [
        '       ora #' + finishedMask,
        '       sta ' + flagsVar,
      ] : []),
      done,
      skip,
      'end',
    ].join('\n');
  };

  Blockly.BBasic.generateBackgroundFadeChecks = function() {
    const fadeVarsUsed = this.backgroundFadeVarsUsed || new Set();
    if (!fadeVarsUsed.size) return '';
    const watches = this.backgroundFadeFinishedWatches || new Set();

    const checksForVar = (rawVar) => {
      const colorVarName = resolveFadeColorVar(rawVar);
      const timerVar = resolveVar(backgroundFadeTimerVarName(rawVar));
      const paceVar = resolveVar(backgroundFadePaceVarName(rawVar));
      const targetVar = resolveVar(backgroundFadeTargetVarName(rawVar));
      const tag = FADE_LABEL_TAG_BY_VAR[rawVar] || rawVar;

      // Every register (background/playfield, score/text, AND player) routes
      // through a hand-written asm version instead (see buildFadeCheckAsm's
      // comment) - real cycle savings over the bB if/goto chain this
      // used to be. buildFadeCheckAsm itself doesn't care whether
      // colorVarName came from a resolved dev var (COLUBK/COLUPF/player0/
      // player1's  shadow vars) or a bare literal identifier (scorecolor/
      // TextColor) - either way it's already just a plain string by the time
      // it gets here.
      return buildFadeCheckAsm({
        colorVar: colorVarName,
        targetVar,
        timerVar,
        paceVar,
        flagsVar: resolveVar(fadeFlagsVarName(rawVar)),
        activeBit: fadeActiveBit(rawVar),
        finishedBit: backgroundFadeFinishedBit(rawVar),
        tag,
        isWatched: watches.has(backgroundFadeWatchKey(rawVar)),
      });
    };

    return [...fadeVarsUsed].map(checksForVar).flat().join('\n');
  };

  // One-time Setup-section initialization (see bbasic.bb.hbs's
  // generatedBackgroundFadeSetup splice, right alongside
  // generatedCtrlpfShadowSetup/generatedKeypadSetup) - every fade's
  // targetVar (see emitColorFadeTrigger's "if targetVar = requested
  // color then skip the reset" guard) needs to start at a value NO real
  // requested color can ever equal, or that guard's very first real trigger
  // could spuriously match on whatever targetVar happens to already hold.
  // Confirmed as a real, reported bug: zeroed RAM (this codebase's  dev
  // vars have no other default) leaves targetVar starting at plain 0, and 0
  // is itself a perfectly ordinary, plausible requested color (pure black -
  // hue 0, luminance 0) - a project's very first "fade to black" call would
  // see targetVar(0) already "equal" to the requested color(0) and skip the
  // reset entirely, never actually starting the fade. 255 is guaranteed
  // safe: every real color byte a "Color" picker can ever produce is even
  // (the 2600 ignores a color register's  low bit - see
  // utils/palette.js's "byte is (index << 1)" comment), so an odd
  // sentinel can never collide with a genuine request.
  Blockly.BBasic.generateBackgroundFadeSetup = function() {
    const fadeVarsUsed = this.backgroundFadeVarsUsed || new Set();
    if (!fadeVarsUsed.size) return '';
    return [...fadeVarsUsed]
        .map((rawVar) => ` ${resolveVar(backgroundFadeTargetVarName(rawVar))} = 255`)
        .join('\n');
  };

  // Shared by background_fade_finished below and score.js's
  // score_fade_finished / text-minikernel.js's
  // text_minikernel_fade_finished - the check-and-clear body is identical
  // regardless of which register it targets, only rawVar (and so which dev
  // vars/bit it resolves to) differs. Mirrors emitColorFadeTrigger's
  // "shared trigger body, per-register rawVar" split above.
  Blockly.BBasic.emitFadeFinishedWatch = function(block, rawVar) {
    const code = Blockly.BBasic.statementToCode(block, 'DO').trim();
    const watches = Blockly.BBasic.backgroundFadeFinishedWatches || new Set();
    // No matching fade block was ever found to have set this watch's
    // flag in the first place (see resolveBackgroundFadeFinishedWatches -
    // this can only happen if the watch itself vanished between the
    // pre-scan and here, which shouldn't occur in practice, but matches
    // this codebase's "silently no-op on a dangling reference" -
    // resolveMusicEventFlags is the shipped instance of the exact same
    // handling).
    if (!watches.has(backgroundFadeWatchKey(rawVar))) return '';
    const flagBit = `${resolveVar(fadeFlagsVarName(rawVar))}{${backgroundFadeFinishedBit(rawVar)}}`;
    const blockNumber = Blockly.BBasic.blockNumbers.next();
    const labelEnd = `_bgfadefin_${blockNumber}_end`;
    return '\n' +
    [
      `if !${flagBit} then goto ${labelEnd}`,
      `${flagBit} = 0`,
      code,
      `@ ${labelEnd}`,
    ].join('\n') +
    '\n';
  };

  Blockly.BBasic[`background_fade_finished`] = function(block) {
    return Blockly.BBasic.emitFadeFinishedWatch(block, block.getFieldValue('VAR'));
  };

  // Plain boolean read of the active bit - unlike background_fade_finished
  // above, this doesn't check watches.has(...) first: hasBackgroundFadeActiveChecks
  // (see blocks/background.js) already guarantees the shared flags byte is
  // reserved whenever any background_fade_active block exists, regardless
  // of whether that register has a matching background_fade_to block, so
  // the bit is always safe to read here even if it will only ever hold 0.
  Blockly.BBasic[`background_fade_active`] = function(block) {
    const rawVar = block.getFieldValue('VAR');
    const activeBit = `${resolveVar(fadeFlagsVarName(rawVar))}{${fadeActiveBit(rawVar)}}`;
    return [activeBit, Blockly.BBasic.ORDER_ATOMIC];
  };

  Blockly.BBasic[`background_get_pixel`] = function(block) {
    // Block for getting a playfield pixel
    const argumentX = Blockly.BBasic.valueToCode(block, 'X',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const argumentY = Blockly.BBasic.valueToCode(block, 'Y',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '0';

    // pfread()'s  arguments can't contain an operator - bB's parser
    // expects a bare variable or literal there, not an expression.
    // Confirmed directly: plugging a Math block (e.g. "xCycle - 1") into X
    // or Y generated "pfread(xCycle - 1, ...)" and failed to compile with
    // "Unknown keyword: -". A non-trivial expression is computed into a
    // scratch var first instead, on its  line ahead of wherever this
    // value actually gets used. There's no way for a plain value-block
    // generator to inject setup statements before the line that consumes
    // its return value, so those lines are encoded as a newline-joined
    // preamble in front of the real "pfread(...)" expression here - this
    // block's  tooltip already documents it as if-only, and controls_if
    // (see its  comment) is what actually splits this back out and
    // hoists the preamble onto its  line(s) before the "if". A bare
    // identifier or number literal never contains whitespace in this
    // codebase's  generated code, so testing for it is a safe, cheap
    // way to tell a simple value apart from a compound expression without
    // needing to parse it.
    //
    // temp1/temp2 (bB's  free scratch registers, obliterated by the
    // kernel and reused this way throughout this codebase) are the
    // ordinary, zero-cost choice here - EXCEPT when this block sits inside
    // a function_define's  body, where temp1-temp6 are ALSO bB's fixed
    // argument-passing convention (see generators/bbasic/function.js's
    // comment): overwriting temp1/temp2 there could silently clobber that
    // function's  live parameter(s) out from under it. Confirmed
    // directly as a real bug (a project's  custom function calling this
    // went from "won't compile" to "resets the console the moment it
    // runs" from exactly that). Only THAT case falls back to
    // backgroundGetPixelXVarName/backgroundGetPixelYVarName's
    // dedicated dev vars instead - reserved (see reserveMusicDevVars's
    // sibling in bbasic.js) only for a project that actually has this
    // block nested inside a function at all, so the common case (used
    // directly in a plain "if", not inside a function) costs nothing extra.
    const useDevVars = isInsideFunctionDefine(block);
    const isSimple = (code) => !/\s/.test(code);
    const preamble = [];
    let readX = argumentX;
    let readY = argumentY;
    // backgroundGetPixelXVarName/YVarName now route through reserveDevVarRW
    // (generators/bbasic.js's  init()) when useDevVars is true - .write
    // for the capture line just below, .read for the actual pfread(...)
    // call further down.
    if (!isSimple(argumentX)) {
      if (useDevVars) {
        const pair = Blockly.BBasic.superchipRwPairs[backgroundGetPixelXVarName()];
        preamble.push(`${pair.write} = ${argumentX}`);
        readX = pair.read;
      } else {
        readX = 'temp1';
        preamble.push(`${readX} = ${argumentX}`);
      }
    }
    if (!isSimple(argumentY)) {
      if (useDevVars) {
        const pair = Blockly.BBasic.superchipRwPairs[backgroundGetPixelYVarName()];
        preamble.push(`${pair.write} = ${argumentY}`);
        readY = pair.read;
      } else {
        readY = 'temp2';
        preamble.push(`${readY} = ${argumentY}`);
      }
    }

    const code = `pfread(${readX}, ${readY})`;
    return [preamble.length ? `${preamble.join('\n')}\n${code}` : code, Blockly.BBasic.ORDER_ATOMIC];
  };

  Blockly.BBasic[`background_change_pixel`] = function(block) {
    // Block for setting a playfield pixel
    const operation = block.getFieldValue('OPERATION');
    const argumentX = Blockly.BBasic.valueToCode(block, 'X',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const argumentY = Blockly.BBasic.valueToCode(block, 'Y',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '0';

    // "pfpixel X Y OPERATION" is a whitespace-separated positional macro,
    // not a real function call - a multi-token argument (e.g. a Random
    // block's "(rand / 8) + 1", which has spaces in it) gets split into
    // several garbage tokens instead of read as one expression, confirmed
    // directly as a real build failure ("Syntax Error ''" from a
    // malformed "LDA #(" with nothing after it). Assigning to temp1/temp2
    // first and passing THOSE (always a single plain token) sidesteps the
    // whitespace-splitting entirely, regardless of how complex the
    // plugged-in X/Y expression is.
    return `temp1 = ${argumentX}\n` +
      `temp2 = ${argumentY}\n` +
      `pfpixel temp1 temp2 ${operation}\n`;
  };

  Blockly.BBasic[`background_change_hv_line`] = function(block) {
    // Block for drawing an horizontal/vertical line
    const direction = block.getFieldValue('DIRECTION');
    const operation = block.getFieldValue('OPERATION');
    const argumentLineLength = Blockly.BBasic.valueToCode(block, 'LENGTH',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '2';
    const argumentX = Blockly.BBasic.valueToCode(block, 'X',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const argumentY = Blockly.BBasic.valueToCode(block, 'Y',
        Blockly.BBasic.ORDER_ASSIGNMENT) || '0';

    // Same "pfhline/pfvline X Y LENGTH OPERATION" whitespace-splitting risk
    // as background_change_pixel above, for both X and Y (temp2/temp3 -
    // temp1 is already used for the length calculation just below, so X/Y
    // need their  separate scratch vars rather than reusing it).
    return `temp2 = ${argumentX}\n` +
      `temp3 = ${argumentY}\n` +
      `temp1 = ${argumentLineLength} + ${direction == 'pfhline' ? 'temp2' : 'temp3'} - 1\n` +
      `${direction} temp2 temp3 temp1 ${operation}\n`;
  };

  Blockly.BBasic[`background_draw_line`] = function(block) {
    // Block for drawing an arbitrary (diagonal) line between two points -
    // see registerBackgroundLineSubroutine's  comment for the runtime
    // Bresenham's-line-algorithm this gosubs into, and for why X1/Y1/X2/Y2
    // need their  dedicated vars rather than temp1-temp4 (pfpixel's
    // implementation clobbers temp1/temp2 internally). OPERATION picks
    // which of the (up to 3) pre-built subroutines to gosub directly - a
    // compile-time choice fixed per block instance, not a runtime value.
    const operation = block.getFieldValue('OPERATION');
    const argumentX1 = Blockly.BBasic.valueToCode(block, 'X1', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const argumentY1 = Blockly.BBasic.valueToCode(block, 'Y1', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const argumentX2 = Blockly.BBasic.valueToCode(block, 'X2', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const argumentY2 = Blockly.BBasic.valueToCode(block, 'Y2', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const names = Blockly.BBasic.backgroundLineVarNames;
    const subroutineName = BACKGROUND_LINE_SUBROUTINE_NAMES[operation];
    const suffix = Blockly.BBasic.bankJumpSuffix(
        Blockly.BBasic.getCurrentBank(), Blockly.BBasic.getSubroutineBank(subroutineName));
    return `${names.x1} = ${argumentX1}\n` +
      `${names.y1} = ${argumentY1}\n` +
      `${names.x2} = ${argumentX2}\n` +
      `${names.y2} = ${argumentY2}\n` +
      `gosub ${subroutineName}${suffix}\n`;
  };

  Blockly.BBasic[`background_clear`] = function(block) {
    // Block for clearing every playfield pixel
    return `pfclear\n`;
  };

  // Up/Down/Up (2x)/Down (2x) update backgroundScrollRow (see
  // backgroundScrollRowVarName's comment in blocks/background.js)
  // whenever ANY background_scroll/background_scroll_position block OR any
  // sprite_scroll_with_playfield_set/_get block is used anywhere in the
  // project (backgroundScrollUsed, set by bbasic.js's pre-scan) - not
  // just when THIS block's STOPATEDGE is checked - so a getter, or a
  // DIFFERENT scroll block that does check STOPATEDGE, always sees an
  // accurate position regardless of which specific block last moved it.
  // Left/Right never touch it (no edge concept - see this block's
  // tooltip) - so a sprite flagged to follow scroll only ever moves along
  // with Up/Down/Up (2x)/Down (2x), never Left/Right.
  const BACKGROUND_SCROLL_ROW_DELTA = {up: -1, down: 1, upup: -2, downdown: 2};

  Blockly.BBasic[`background_scroll`] = function(block) {
    const direction = block.getFieldValue('DIRECTION');
    const delta = BACKGROUND_SCROLL_ROW_DELTA[direction];
    if (!Blockly.BBasic.backgroundScrollTracking || delta == null) {
      return `pfscroll ${direction}\n`;
    }

    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const rowVar = resolveVar(backgroundScrollRowVarName());
    const maxVar = resolveVar(backgroundScrollRowMaxVarName());
    const stopAtEdge = block.getFieldValue('STOPATEDGE') === 'TRUE';
    const uid = Blockly.BBasic.blockNumbers.next('bgscroll');
    const doneLabel = `_bgscroll_${uid}_done`;
    const configurationStorage = useConfigurationStorage();
    const config = (configurationStorage && configurationStorage.value) || {};
    const rowHeight = pfRowDivisorFor(config);
    // rowVar tracks the live window's top row index into the full
    // background, in the natural sense its name suggests - "down"/"down
    // (2x)" increase it (reveal more of the background below), "up"/"up
    // (2x)" decrease it (reveal more above), bounded at 0 and maxVar
    // (pixels.length-visibleRows).
    const lines = [];
    const overflowUsed = (Blockly.BBasic.backgroundScrollOverflowBackgrounds || []).length > 0;
    const spriteScrollUsedFor = Blockly.BBasic.spriteScrollUsedFor || new Set();
    const nudgeSprites = () => {
      if (!spriteScrollUsedFor.size) return;
      const flagsVar = resolveVar(spriteScrollFlagsVarName());
      spriteScrollUsedFor.forEach((name) => {
        const bit = spriteScrollActiveBit(name);
        lines.push(` if ${flagsVar}{${bit}} then ${name}y = ${name}y ${delta < 0 ? '-' : '+'} 1`);
      });
    };

    // Sets the "reached top/bottom" flag when a row-step lands on that edge
    // - only for an edge some "When background scroll reaches" block watches.
    // condition is the bB test (an "if" body, without the "if"/"then").
    const edgeWatches = Blockly.BBasic.backgroundScrollEdgeWatches || new Set();
    const edgeFlag = (edge) =>
      `${resolveVar(backgroundScrollEdgeFlagsVarName())}{${BACKGROUND_SCROLL_EDGE_BITS[edge]}}`;
    const setEdgeFlag = (edge, condition) => {
      if (edgeWatches.has(edge)) lines.push(` if ${condition} then ${edgeFlag(edge)} = 1`);
    };

    if (!overflowUsed) {
      // No background in the project is taller than the visible window -
      // stock pfscroll's rotate-in-place is already correct and simplest.
      if (stopAtEdge) {
        lines.push(delta < 0 ?
          ` if ${rowVar} <= 0 then goto ${doneLabel}` :
          ` if ${rowVar} >= ${maxVar} then goto ${doneLabel}`);
      }
      lines.push(` pfscroll ${direction}`);
      // Real pfscroll moves by ONE SCANLINE per call, not one logical
      // playfield row (confirmed directly against pf_scrolling.asm - it
      // only actually rotates a row once the kernel's internal
      // "playfieldpos" accumulator reaches the configured row height,
      // rowHeight above) - subRowVar is this block's parallel accumulator
      // (not a read of that internal kernel counter, which resets
      // ambiguously on both "just completed a row" and "the very first call
      // ever" alike, making it unsafe to read back directly - see
      // backgroundScrollSubRowVarName's comment in blocks/background.js) so
      // rowVar only advances once a row has genuinely completed, not on
      // every single scanline step. A real reported bug otherwise ("stop at
      // edge" triggering ~rowHeight times too early, since rowVar used to
      // advance a full step on every raw call).
      const subRowVar = resolveVar(backgroundScrollSubRowVarName());
      lines.push(` ${subRowVar} = ${subRowVar} + ${Math.abs(delta)}`);
      lines.push(` if ${subRowVar} < ${rowHeight} then goto ${doneLabel}`);
      lines.push(` ${subRowVar} = ${subRowVar} - ${rowHeight}`);
      lines.push(` ${rowVar} = ${rowVar} ${delta < 0 ? '-' : '+'} 1`);
      if (delta > 0) setEdgeFlag('bottom', `${rowVar} >= ${maxVar}`);
      else setEdgeFlag('top', `${rowVar} = 0`);
      // Nudges every sprite currently flagged (a RUNTIME bit, checked here
      // every call, not a compile-time decision - see sprite_scroll_with_
      // playfield_set's generator in generators/bbasic/sprites.js) to
      // follow this same row move, one "if flag then nudge" line per NAME
      // that has a "set/is scrolling with playfield" block anywhere in the
      // project. Only runs once a row has actually completed (see above),
      // matching rowVar's cadence - a flagged sprite tracks real rows
      // scrolled, not raw scanline steps.
      nudgeSprites();
    } else {
      // Some background in the project IS taller than the visible window.
      // Real pfscroll still rotates the live window (cheap, and it keeps the
      // kernel's fine scroll position), and only the ONE row it leaves stale
      // is then overwritten from the background's table - see
      // backgroundScrollPacking's comment in blocks/background.js. The row
      // variable is packed (low bits = top row, high bits = which background
      // is showing), the patch inputs live in scratch temp3/temp5, and the
      // furthest scroll row is fetched from ROM by the shared subroutine
      // (temp5 = 254 -> temp6) whenever it's needed, so nothing else is
      // reserved. temp4 is scratch for the unpacked row.
      //
      // Which pfscroll direction advances the background is fixed by the
      // hardware (traced through pf_scrolling.asm): pfscroll "up" rotates
      // every row toward slot 0, leaving the BOTTOM slot stale and needing
      // the window's top row to INCREASE; "down" is the mirror image. This
      // block's "Down" (delta > 0) is the direction that moves further into
      // the background, so it issues pfscroll "up" (and "downdown" -> "upup"),
      // keeping the on-screen motion each direction label already had.
      const mechDirection = {up: 'down', down: 'up', upup: 'downdown', downdown: 'upup'}[direction];
      const step = Math.abs(delta);
      const visibleRows = effectiveBackgroundRows(config);
      const forward = delta > 0;
      const {rowMask, indexMask} = Blockly.BBasic.backgroundScrollPacking;
      const gosubPatch = ` gosub ${BACKGROUND_SCROLL_PATCH_SUBROUTINE_NAME}${Blockly.BBasic.bankJumpSuffix(
          Blockly.BBasic.getCurrentBank(), Blockly.BBasic.getSubroutineBank(BACKGROUND_SCROLL_PATCH_SUBROUTINE_NAME))}`;
      // temp6 = the active background's furthest scroll row (row count minus
      // visible rows); leaves temp3/temp4 alone.
      const loadMax = () => {
        lines.push(' temp5 = 254');
        lines.push(gosubPatch);
      };
      // Stop-at-edge blocks only the call that would complete a row-step
      // past the limit (pfscroll's wrap threshold: forward wraps once
      // playfieldpos is <= step, backward once it is > rowHeight - step), so
      // fine scrolling still runs right up to the last position and the
      // picture settles cleanly on the edge instead of stopping mid-row.
      // The cheap playfieldpos test goes first, so every call that can't
      // wrap skips the row/maximum work (forward: a whole gosub for the
      // maximum) and only the wrapping call pays for it. Going forward that
      // call leaves the maximum in temp6 for the bottom-row math below
      // (nothing in between touches temp6, pfscroll included).
      const edgeCheckedLabel = `_bgscroll_${uid}_edgeok`;
      if (stopAtEdge) {
        if (forward) {
          lines.push(` if playfieldpos > ${step} then goto ${edgeCheckedLabel}`);
          loadMax();
          lines.push(` temp4 = ${rowVar} & ${rowMask}`);
          lines.push(` if temp4 >= temp6 then goto ${doneLabel}`);
        } else {
          lines.push(` if playfieldpos <= ${rowHeight - step} then goto ${edgeCheckedLabel}`);
          lines.push(` temp4 = ${rowVar} & ${rowMask}`);
          lines.push(` if temp4 <= 0 then goto ${doneLabel}`);
        }
        lines.push(`@ ${edgeCheckedLabel}`);
      }
      lines.push(` pfscroll ${mechDirection}`);
      // A row-step completed exactly when pfscroll wrapped playfieldpos:
      // forward it resets to rowHeight (a non-wrapping step always leaves it
      // lower), backward it resets to 1 (a non-wrapping step always leaves it
      // higher).
      lines.push(forward ?
        ` if playfieldpos <> ${rowHeight} then goto ${doneLabel}` :
        ` if playfieldpos <> 1 then goto ${doneLabel}`);
      // Row update. The row sits in the packed byte's low bits, so a plain
      // +1/-1 is safe only while it can't carry into/borrow from the index
      // bits: with stop-at-edge the row stays within 0..max; without it the
      // position wraps around the whole background (row count = max +
      // visibleRows) through temp4 first, never reaching a row value that
      // doesn't fit its bits.
      if (forward) {
        if (stopAtEdge) {
          lines.push(` ${rowVar} = ${rowVar} + 1`);
        } else {
          // Leaves temp6 = the row count (max + visible rows), reused below.
          loadMax();
          lines.push(` temp4 = ${rowVar} & ${rowMask}`);
          lines.push(' temp4 = temp4 + 1');
          lines.push(` temp6 = temp6 + ${visibleRows}`);
          lines.push(` if temp4 >= temp6 then ${rowVar} = ${rowVar} & ${indexMask} else ${rowVar} = ${rowVar} + 1`);
        }
      } else if (stopAtEdge) {
        lines.push(` ${rowVar} = ${rowVar} - 1`);
      } else {
        lines.push(` temp4 = ${rowVar} & ${rowMask}`);
        loadMax();
        lines.push(` temp6 = temp6 + ${visibleRows - 1}`);
        lines.push(` if temp4 > 0 then ${rowVar} = ${rowVar} - 1 else ${rowVar} = ${rowVar} | temp6`);
      }
      // Edge flags, from the row just stored. temp6 still holds what the row
      // update left: the maximum (stop-at-edge) or the row count (without it).
      if (forward && edgeWatches.has('bottom')) {
        lines.push(` temp4 = ${rowVar} & ${rowMask}`);
        if (!stopAtEdge) lines.push(` temp4 = temp4 + ${visibleRows}`);
        setEdgeFlag('bottom', 'temp4 = temp6');
      } else if (!forward && edgeWatches.has('top')) {
        lines.push(` temp4 = ${rowVar} & ${rowMask}`);
        setEdgeFlag('top', 'temp4 = 0');
      }
      nudgeSprites();
      if (forward) {
        // The newly-visible BOTTOM row: top row + visibleRows - 1, wrapped
        // around the background's row count.
        // temp6 already holds what the row update above left: the row count
        // (no stop-at-edge) or the maximum (stop-at-edge), so no second gosub.
        lines.push(` temp3 = ${rowVar} & ${rowMask}`);
        lines.push(` temp3 = temp3 + ${visibleRows - 1}`);
        if (stopAtEdge) lines.push(` temp6 = temp6 + ${visibleRows}`);
        lines.push(' if temp3 >= temp6 then temp3 = temp3 - temp6');
        lines.push(` temp5 = ${visibleRows - 1}`);
      } else {
        // The newly-visible TOP row is simply the new top row.
        lines.push(` temp3 = ${rowVar} & ${rowMask}`);
        lines.push(' temp5 = 0');
      }
      lines.push(gosubPatch);
    }
    // "@ label" (not a bare label), same reasoning as collision_check_
    // position/object_bounce's labels elsewhere in this codebase - this
    // whole block can end up nested inside an "if...then" body (e.g. an
    // "every X frames" wrapper), where a bare label comes out indented and
    // bB only recognizes a label at column 0 unless it's "@"-prefixed.
    lines.push(`@ ${doneLabel}`);
    return lines.join('\n') + '\n';
  };

  // Runs its blocks once when background_scroll lands on the chosen edge (see
  // setEdgeFlag in background_scroll above) - the same flag-then-clear shape
  // as emitFadeFinishedWatch.
  Blockly.BBasic[`background_scroll_edge_reached`] = function(block) {
    const edge = block.getFieldValue('EDGE');
    const code = Blockly.BBasic.statementToCode(block, 'DO').trim();
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const watches = Blockly.BBasic.backgroundScrollEdgeWatches || new Set();
    if (!watches.has(edge)) return '';
    const flag = `${resolveVar(backgroundScrollEdgeFlagsVarName())}{${BACKGROUND_SCROLL_EDGE_BITS[edge]}}`;
    const labelEnd = `_bgscrolledge_${Blockly.BBasic.blockNumbers.next()}_end`;
    return '\n' + [
      `if !${flag} then goto ${labelEnd}`,
      `${flag} = 0`,
      code,
      `@ ${labelEnd}`,
    ].join('\n') + '\n';
  };

  // Jumps the scroll to a chosen row. The row (+1, 0 = none) is parked in the
  // pending-start variable, which the full-load mode of bgscrollpatch consumes
  // - so a background switch still pending this frame (the load happens at
  // the start of the next frame, from "newbackground") picks it up instead of
  // resetting to the top. With no switch pending the load runs right here.
  // Does nothing without a background taller than the window, where there is
  // no position to set.
  Blockly.BBasic[`background_scroll_set_row`] = function(block) {
    if (!Blockly.BBasic.backgroundScrollStartUsed) return '';
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const row = Blockly.BBasic.valueToCode(block, 'ROW', Blockly.BBasic.ORDER_ADDITION) || '0';
    const configurationStorage = useConfigurationStorage();
    const config = (configurationStorage && configurationStorage.value) || {};
    const doneLabel = `_bgscroll_${Blockly.BBasic.blockNumbers.next('bgscroll')}_setrow_done`;
    const gosubPatch = ` gosub ${BACKGROUND_SCROLL_PATCH_SUBROUTINE_NAME}${Blockly.BBasic.bankJumpSuffix(
        Blockly.BBasic.getCurrentBank(), Blockly.BBasic.getSubroutineBank(BACKGROUND_SCROLL_PATCH_SUBROUTINE_NAME))}`;
    return [
      ` ${resolveVar(backgroundScrollStartVarName())} = ${row} + 1`,
      ' if newbackground <> 0 then goto ' + doneLabel,
      ` playfieldpos = ${pfRowDivisorFor(config)}`,
      ' temp5 = 255',
      gosubPatch,
      `@ ${doneLabel}`,
    ].join('\n') + '\n';
  };

  Blockly.BBasic[`background_scroll_position`] = function(block) {
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const rowVar = resolveVar(backgroundScrollRowVarName());
    // In overflow mode the variable also carries the active background's
    // index in its high bits - see backgroundScrollPacking.
    const packing = Blockly.BBasic.backgroundScrollPacking;
    return [packing && packing.packed ? `(${rowVar} & ${packing.rowMask})` : rowVar,
      Blockly.BBasic.ORDER_ATOMIC];
  };

  Blockly.BBasic[`draw_screen`] = function(block) {
    // Draw screen.
    return 'COLUP1 = player1color\n' +
      'COLUP0 = player0color\n' +
      'drawscreen\n';
  };

  // (Re)starts the countdown generateShakeScreenChecks counts down every
  // frame - just the countdown, same "trigger sets state, a separate
  // generate*Checks does the per-frame work" split as every other
  // multi-frame effect in this codebase. screenShakeUsed's  pre-scan in
  // bbasic.js's init() guarantees framesVar already exists here.
  Blockly.BBasic[`screen_shake`] = function(block) {
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const framesVar = resolveVar(shakeScreenFramesVarName());
    const frames = Blockly.BBasic.valueToCode(block, 'FRAMES', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    return `${framesVar} = ${frames}\n`;
  };
};

