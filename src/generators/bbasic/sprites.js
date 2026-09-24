'use strict';

import {playfieldToMatrix} from '../../utils/pixels';
import {useConfigurationStorage} from '../../hooks/project';
import {fadeFlagsVarName, fadeActiveBit} from '../../blocks/background';


export const DEFAULT_SPRITES={
  animations: [
    {
      id: 1,
      name: 'Example1',
      frames: [
        {
          id: 1,
          duration: 10,
          pixels: playfieldToMatrix(
              '...XXX..\n'+
            '...XXX..\n'+
            '...XXX..\n'+
            '..X.X...\n'+
            '..XXXXX.\n'+
            '....X.X.\n'+
            '...X.X..\n'+
            '..X...X.'),
        },
        {
          id: 2,
          duration: 10,
          pixels: playfieldToMatrix(
              '...XXX..\n'+
            '...XXX..\n'+
            '...XXX..\n'+
            '....X.X.\n'+
            '..XXXXX.\n'+
            '..X.X...\n'+
            '...X.X..\n'+
            '...X.X..'),
        },
      ],
    },
  ],
};

// playerAnimationsStorage is the ONE shared pool (see
// hooks/project.js's usePlayerAnimationsStorage) - both hardware players
// (Player 0 and Player 1) read from this same storage/animation list now.
export const processPlayerAnimationsStorageDefaults = (playerAnimationsStorage) => {
  const player = playerAnimationsStorage.value;
  if (!player?.animations?.length) {
    return structuredClone(DEFAULT_SPRITES);
  }
  return player;
};

// Which animation indices each player's  dispatch chain can actually be
// sent to at runtime - read by generateAnimations (generators/bbasic.js) to
// skip compiling (and paying the ROM bytes for) an animation nothing in the
// project ever selects. Per player, either a Set of reachable indices, or
// null meaning "couldn't prove which indices are reachable here, keep every
// animation" - the conservative fallback whenever playerNanimation is set
// from anything other than a literal sprite_player_animation_select block
// (an arbitrary expression, a plain number, a Data table lookup...) or
// changed by a runtime delta (sprite_player_change on Animation) - either
// way, the actual index reached at runtime isn't known until the game
// itself runs, so nothing can safely be excluded.
//
// Index 0 is always included for both players - it's processAnimations' own
// dispatch-chain fallthrough default (see its own "if (!animationIndex)
// return ''" - no explicit check is ever emitted for it, so it's reachable
// the instant player0animation/player1animation holds anything unmatched,
// not just a literal 0), not something a project's  blocks need to
// reference by name to reach. Player 0's index 1 is always included too -
// bbasic.bb.hbs's  boot-time "player0animation = 1" runs unconditionally,
// regardless of what the project's  blocks do afterward.
export const resolveUsedPlayerAnimations = (workspace) => {
  const used = {player0: new Set([0, 1]), player1: new Set([0])};
  const unsafe = {player0: false, player1: false};
  const animationVarName = (block) => block.getFieldValue('VAR');
  workspace.getAllBlocks(false).forEach((block) => {
    if (block.type === 'sprite_player_set') {
      const varField = animationVarName(block);
      const name = varField === 'player0animation' ? 'player0' : varField === 'player1animation' ? 'player1' : null;
      if (!name) return;
      const valueBlock = block.getInputTargetBlock('VALUE');
      const index = valueBlock && valueBlock.type === 'sprite_player_animation_select' ?
        Number(valueBlock.getFieldValue('VAR')) : NaN;
      if (Number.isInteger(index)) {
        used[name].add(index);
      } else {
        unsafe[name] = true;
      }
    } else if (block.type === 'sprite_player_change') {
      const varField = animationVarName(block);
      if (varField === 'player0animation') unsafe.player0 = true;
      if (varField === 'player1animation') unsafe.player1 = true;
    }
  });
  return {
    player0: unsafe.player0 ? null : used.player0,
    player1: unsafe.player1 ? null : used.player1,
  };
};

// sprite_*_rom_noise (below) points a sprite's pointer/height straight at raw
// ROM bytes instead of a drawn graphic - the classic Yars' Revenge "neutral
// zone" trick, reading real CODE bytes, not a dedicated data table.
//
// Real bugs had to be fixed to get here, all only visible from an actual
// compile+run, not from reading the bB docs alone:
//
// 1. The very first version pointed at "commongamelogic" using
//    "pointer = commongamelogic + offset" - confirmed WRONG by a real build
//    failure ("Unknown Mnemonic 'lda commongamelogic'"), reproduced 3
//    separate times including a fresh session, so it's not flaky. Tried
//    "main" next (reached only by fallthrough/a plain "goto", confirmed
//    from the compiled output to be a direct "jmp .label", not a
//    gosub/return trampoline the way "commongamelogic" is) - identical
//    failure, "Unknown Mnemonic 'lda main'". Tried a raw hex address next
//    ("pointer = $D000 + offset", bank 1's  real RORG base per ROM size -
//    see public/bb19/includes/2600basicheader.asm) - DIFFERENT failure this
//    time ("Value in 'lda #$D000' must be <$100"): batari Basic compiles a
//    plain numeric literal here as an 8-bit IMMEDIATE load, not a 16-bit
//    address, so no bare number over 255 can work this way either. Tried a
//    small in-range constant next (confirming the "+offset" idiom's real,
//    undocumented behavior: it only ever sets the pointer's LOW byte,
//    inheriting whatever HIGH byte the last real animation-pointer
//    assignment left there that same frame) - this one compiled, but read a
//    uniform/blank memory region (a solid-color sprite, not noise) since
//    the inherited high byte wasn't pointing anywhere interesting.
//    Fixed by not using the "+offset" idiom at ALL: 2600basic.h aliases
//    player0pointerlo/player0pointerhi (and the player1 equivalents) onto
//    the exact same zero-page pair player0pointer itself is, so both bytes
//    can be set with two independent, ordinary 8-bit assignments instead -
//    no label, no 16-bit immediate, no "+" arithmetic at all. baseHigh
//    (below) is bank 1's  real RORG base address's high byte; every one
//    of those bases is page-aligned ($D000/$9000/$1000/$F000, all low byte
//    $00), so "low = 0 + offset" can never carry into the high byte - true
//    real-code noise, genuinely zero ROM cost, exactly like the original
//    Yars' Revenge trick.
// 2. This block's  line (wherever the user placed it) only ever set
//    player0pointer for a single instant - but generateAnimations() ALWAYS
//    unconditionally reassigns every player's pointer/height once per frame,
//    from inside commongamelogic, for ANY player with animation frames (even
//    a blank default one - see its own "if player0frame <> 255 ... else
//    player0: %00000000" fallback), and commongamelogic runs before every
//    single drawscreen. So the animation logic silently clobbered this
//    block's  assignment before the next frame ever got drawn, no matter
//    where the block was placed. Fixed the same way background_fade_to/text-
//    scroll.js's  scrolling already solve "something needs to keep
//    happening every frame, unconditionally, right up until drawscreen":
//    this block is now a one-shot TRIGGER (stores the requested offset/
//    height in dev vars and sets an "active" flag), and a real per-frame
//    check - generateRomNoiseChecks below - is spliced into commongamelogic
//    right AFTER generateAnimations'  output, so it runs (and wins) after
//    the animation logic but still before that frame's drawscreen.
// Bank 1's  fixed base address per ROM size - confirmed against public/
// bb19/includes/2600basicheader.asm's own "RORG" directive: $F000 with no
// bankswitching, $D000/$9000/$1000 for 8k/16k/32k+ (64k shares 32k's own
// $1000 - both hit the "if bankswitch == 32"/"if bankswitch == 64" branches,
// which RORG to the identical address). Every one of these is already
// page-aligned (low byte $00) - deliberately not arbitrary: that's what
// makes the split-byte assignment below safe with no carry/overflow handling
// needed (see its  comment).
const ROM_NOISE_BASE_HIGH_BYTE_BY_ROMSIZE = {
  '2k': 0xF0,
  '4k': 0xF0,
  '8k': 0xD0,
  '16k': 0x90,
  '32k': 0x10,
  '64k': 0x10,
};

// superchipheader.asm (used instead of 2600basicheader.asm whenever
// Superchip RAM is on) pads the FIRST 256 bytes right at that same base
// address with "repeat 256 / .byte $ff / repend" before any real code -
// confirmed directly against a real reported bug: with Superchip on, the
// noise sprite sometimes rendered as a solid block instead of noise,
// because an offset landing in that padding reads nothing but $FF
// (all bits set = solid). Skipped by bumping the base address forward one
// full page (256 bytes, i.e. +1 on the high byte - safe since every base
// above is already page-aligned) whenever Superchip is on, landing offset 0
// on real compiled content instead. 2600basicheader.asm (Superchip off) has
// no such padding, so this only applies conditionally.
const romNoiseBaseHighByteHex = (config) => {
  const high = ROM_NOISE_BASE_HIGH_BYTE_BY_ROMSIZE[config && config.romSize] ?? 0xF0;
  const paddingPages = config && config.enableSuperchip ? 1 : 0;
  return `$${(high + paddingPages).toString(16).toUpperCase()}`;
};

// One shared flags byte covers both features' "active" bits for both
// players - only ever 4 possible bits total (2 features x 2 players), same
// reasoning fadeFlagsVarName's  shared byte uses in
// blocks/background.js.
export const romNoiseFlagsVarName = () => 'romNoiseFlags';
export const romNoiseActiveBit = (name) => name === 'player1' ? 1 : 0;
export const romNoiseOffsetVarName = (name) => `${name}RomNoiseOffset`;
export const romNoiseHeightVarName = (name) => `${name}RomNoiseHeight`;
export const rainbowColorActiveBit = (name) => name === 'player1' ? 3 : 2;
export const rainbowColorOffsetVarName = (name) => `${name}RainbowColorOffset`;

// sprite_*_fire's  dev vars (see its  trigger generator and
// generateMissileFireChecks below) - one shared flags byte (same "one byte
// covers every player/missile's  active bit" convention as
// romNoiseFlagsVarName above) plus, per missile, a direction (0-7, or
// 255/anything else for "no direction") and a speed (1-7), both captured
// once at fire time so the per-frame check never has to re-evaluate the
// original ANGLE/SPEED block inputs.
// RAM shadow for CTRLPF - see reserveCtrlpfShadowDevVar's  comment for
// why ball width/priority can't safely read the real hardware register back.
export const ctrlpfShadowVarName = () => '_ctrlpf';

export const missileFireFlagsVarName = () => 'missileFireFlags';
export const missileFireActiveBit = (name) => ({missile0: 0, missile1: 1, ball: 2})[name];
export const missileFireDirVarName = (name) => `${name}FireDir`;
export const missileFireSpeedVarName = (name) => `${name}FireSpeed`;
// Only reserved for a sprite using 16-way Fire (missileFire16UsedFor) - see
// generateMissileFireChecks'  comment on why the 16-way dispatch can't
// just inline "(speedVar/2)" the way the plain half-speed math would
// suggest: bB's integer division rounds 1/2 down to 0, which would make
// every "halfway" direction's slower axis vanish entirely at speed 1,
// collapsing 16-way movement to look identical to 8-way. This holds
// speedVar/2 clamped to a minimum of 1, computed once per frame instead of
// per dispatch line.
export const missileFireHalfSpeedVarName = (name) => `${name}FireHalfSpeed`;

// sprite_*_seek_to's  dev vars (see its  trigger generator and
// generateSeekChecks below) - same shape as sprite_*_fire's  above: one
// shared flags byte (one bit per sprite name, since up to all 5 - both
// players, both missiles, and the ball - can each be seeking independently)
// plus, per sprite, the target X/Y and speed, captured once when the block
// runs so the per-frame check never has to re-evaluate the original X/Y/
// SPEED block inputs.
export const seekFlagsVarName = () => 'seekFlags';
export const seekActiveBit = (name) => {
  const bits = {player0: 0, player1: 1, missile0: 2, missile1: 3, ball: 4};
  return bits[name];
};
export const seekXVarName = (name) => `${name}SeekX`;
export const seekYVarName = (name) => `${name}SeekY`;
export const seekSpeedVarName = (name) => `${name}SeekSpeed`;

// object_seek_arrived's own "finished" bits - deliberately a SEPARATE byte
// from seekFlagsVarName's  active bits above (not packed into the same
// byte the way background.js's  fadeFlagsVarName does for its 4
// registers): seek has 5 possible names, so 5 active + 5 finished bits would
// be 10, over a single byte's 8. Same bit-per-name layout as
// seekActiveBit, reused via seekArrivedBit rather than a second parallel
// map. Only reserved at all when resolveSeekArrivedWatches (blocks/
// sprites.js) finds at least one object_seek_arrived block actually
// watching - see this file's  reserveSeekArrivedDevVars.
export const seekArrivedFlagsVarName = () => 'seekArrivedFlags';
export const seekArrivedBit = (name) => seekActiveBit(name);

// "throttle movement" (see object_seek_to/sprite_*_fire's  checkbox
// field) - an opt-in countdown that slows the per-frame movement check
// itself down to whatever "every X frames" block the trigger is placed
// inside, instead of always stepping every frame. A plain decrement-and-
// compare-to-zero countdown, not a bitwise-AND against a runtime variable
// mask (unlike event_frame_every_n's  compile-time-literal mask) - every
// existing "& mask" in this codebase's generated output is against a
// literal, never a variable, so this avoids relying on an operator
// combination with no precedent here. ...ThrottleVarName is the countdown
// itself; ...ThrottleResetVarName is what it resets to each time it hits
// zero (the resolved "every X frames" interval, or 1 - "step every frame",
// the same behavior as if throttling were off - when not actually
// wrapped/enabled).
export const seekThrottleVarName = (name) => `${name}SeekThrottle`;
export const seekThrottleResetVarName = (name) => `${name}SeekThrottleReset`;
export const missileFireThrottleVarName = (name) => `${name}FireThrottle`;
export const missileFireThrottleResetVarName = (name) => `${name}FireThrottleReset`;

// sprite_inertia_accelerate/sprite_inertia_decelerate's  dev vars (see
// their  trigger generators and generateInertiaChecks below) - same
// "one shared flags byte, one bit per sprite name" convention as
// seekFlagsVarName above, just TWO such bytes (accel-active and decel-
// active can't share one byte - 5 names each means 10 bits, over a single
// byte's 8, same reasoning seekArrivedFlagsVarName's  comment gives for
// why IT isn't packed into seekFlagsVarName either).
//
// velocityX/Y are the one genuinely new kind of state this codebase's
// movement blocks have needed: every existing one (Seek's target X/Y,
// Fire's angle/speed) stores direction+magnitude, always unsigned - never
// a persisted signed delta. Inertia's  velocity has to be signed (an
// object accelerating opposite to its current motion needs to slow down
// and reverse, which a direction+magnitude model can't do without real
// vector math) - stored as an ordinary byte holding a two's-complement
// signed value (0-127 = 0..+127, 128-255 = -128..-1, the standard 6502
// convention). Plain bB addition (name x = name x + velocityX) works
// correctly on this with NO special handling (6502 ADC is identical for
// signed and unsigned) - only the max-speed clamp and the decelerate-
// toward-zero step need to treat it as signed, which bB's  unsigned-only
// "if" comparisons can't safely do (see generateInertiaChecks'  comment
// on the hand-asm clamp this requires).
export const inertiaAccelFlagsVarName = () => 'inertiaAccelFlags';
export const inertiaDecelFlagsVarName = () => 'inertiaDecelFlags';
// Same bit-per-name layout as seekActiveBit's  map - a separate function
// (not a direct reuse) since these are two entirely separate flag bytes,
// not a shared one, even though the layout happens to match.
export const inertiaActiveBit = (name) => {
  const bits = {player0: 0, player1: 1, missile0: 2, missile1: 3, ball: 4};
  return bits[name];
};
export const inertiaVelocityXVarName = (name) => `${name}VelocityX`;
export const inertiaVelocityYVarName = (name) => `${name}VelocityY`;
// Only reserved for a sprite with an actual "Accelerate" block targeting
// it (see inertiaAccelUsedFor's  pre-scan in bbasic.js) - a sprite only
// ever decelerated (never accelerated) has nothing for these to hold: with
// nothing ever pushing velocity away from 0 in the first place, decelerate
// alone can never move it.
export const inertiaAccelRateVarName = (name) => `${name}AccelRate`;
export const inertiaMaxSpeedVarName = (name) => `${name}MaxSpeed`;
// Persists which of the 8 directions is currently being accelerated toward
// while the accel-active bit stays set (same reason missileFireDirVarName
// persists across frames rather than being re-read from the trigger block
// every check) - same 0-7 clockwise-from-Up scale generateMissileFireChecks'
// own 8-way dispatch already uses, reused directly rather than inventing a
// second angle convention.
export const inertiaAccelDirVarName = (name) => `${name}AccelDir`;
// Only reserved for a sprite using 16-way Accelerate (inertiaAccel16UsedFor) -
// same reasoning and same fix as missileFireHalfSpeedVarName above: holds
// rateVar/2 clamped to a minimum of 1, computed once per frame, instead of
// inlining "(rateVar/2)" which rounds down to 0 at rate 1 and collapses
// 16-way to look like 8-way.
export const inertiaAccelHalfRateVarName = (name) => `${name}AccelHalfRate`;
// Only reserved for a sprite with an actual "Decelerate" block targeting it
// (see inertiaDecelUsedFor's  pre-scan in bbasic.js).
export const inertiaDecelRateVarName = (name) => `${name}DecelRate`;

// "Fine" mode's fixed-point state (see inertiaFineUsedFor's  pre-scan in
// bbasic.js, and generateInertiaChecks/buildFineDecelerateAsm/
// buildFinePositionStepAsm further down) - only reserved for a sprite in
// that set. velocityXVar/YVar (above) stay the signed WHOLE-pixel half of
// a 16-bit two's complement pair once Fine is on for a name; these are the
// unsigned (0-255) fractional halves, one per axis for velocity and one per
// axis for position, matching the classic high-byte/low-byte sub-pixel
// technique real hardware of this era actually used (confirmed directly
// against the real Asteroids arcade disassembly - computerarcheology.com's
// Code.html: velocity added into a low position byte, carry propagated via
// ADC into the high byte every frame).
export const inertiaVelocityFracXVarName = (name) => `${name}VelocityFracX`;
export const inertiaVelocityFracYVarName = (name) => `${name}VelocityFracY`;
export const inertiaPosFracXVarName = (name) => `${name}PosFracX`;
export const inertiaPosFracYVarName = (name) => `${name}PosFracY`;

// sprite_*_bounce's  Combat-style state (see its  generator further
// down for the stage sequence this backs, matched against the real 1977
// Combat disassembly's  missile-bounce routine at $F4A6-$F4CD in
// atariage.com's "Definitive Combat Disassembly") - stageVar tracks how many
// consecutive stuck frames have been seen so far (0 = not currently stuck,
// 1-3 = that many consecutive stuck frames, capped at 3 - Combat's own
// MxPFcount keeps counting past 3 forever, but every value >= 3 behaves
// identically here, so this caps instead of growing unbounded), origDirVar
// freezes the heading the FIRST stuck frame started from (stage 3's "corner,
// give up" reflection always reflects THIS, never whatever an earlier stage
// left behind), and frameVar is the framecounter value the last time this
// object's Bounce block ran, the only way to tell "still the same collision,
// one frame later" apart from "a brand new collision" with no dedicated
// event to hook a reset into (see generateMissileFireChecks'  comment on
// why).
export const missileBounceStageVarName = (name) => `${name}BounceStage`;
export const missileBounceOrigDirVarName = (name) => `${name}BounceOrigDir`;
export const missileBounceFrameVarName = (name) => `${name}BounceFrame`;
// object_bounce's  velocity-reflection snapshot (see its  generator's
// comment) - the same role as missileBounceOrigDirVarName above, just for
// Inertia's velocity vector instead of Fire's angle. Only reserved for a
// sprite with BOTH object_bounce AND Inertia used on it (a sprite using
// only Fire+Bounce, unchanged from before, never touches these).
export const missileBounceOrigVelocityXVarName = (name) => `${name}BounceOrigVelocityX`;
export const missileBounceOrigVelocityYVarName = (name) => `${name}BounceOrigVelocityY`;
// Only reserved for a sprite with Bounce, Inertia, AND Fine mode all three
// on it - the fractional half of the velocity snapshot above, needed
// alongside it so a Fine-mode sprite's bounce reflects the whole 16-bit
// fixed-point value (see object_bounce's comment on why negating just
// the whole-pixel byte isn't enough once there's a fractional byte too,
// and why the fraction has to be genuinely snapshotted, not reset to 0 -
// it's what lets a bounced object keep moving slower than 1px/frame
// instead of snapping back to whole-pixel speed on every bounce).
export const missileBounceOrigVelocityFracXVarName = (name) => `${name}BounceOrigVelocityFracX`;
export const missileBounceOrigVelocityFracYVarName = (name) => `${name}BounceOrigVelocityFracY`;

// Compile-time lookup, not a runtime one: walks up from the trigger block
// through its  enclosing STATEMENT blocks (getSurroundParent, not the
// getParent()-loop background.js's  isInsideFunctionDefine uses - that
// one also has to follow value-input connections since it's checking a
// block that sits in an "if" condition socket, this one only ever needs
// statement nesting, since a trigger block is always a plain statement)
// looking for an event_frame_every_n ancestor. Its own MASK field's VALUE
// is interval-1 (see FRAME_OPTIONS in blocks/event.js) - "+ 1" recovers the
// real interval.
const resolveEnclosingFrameInterval = (block) => {
  let ancestor = block.getSurroundParent();
  while (ancestor) {
    if (ancestor.type === 'event_frame_every_n') {
      return Number(ancestor.getFieldValue('MASK')) + 1;
    }
    ancestor = ancestor.getSurroundParent();
  }
  return null;
};

// "Rainbow colors" (its  block, sprite_*_rainbow_colors) is a REAL,
// existing batari Basic kernel feature (see std_kernel.asm's own "ifnconst
// playercolors"/"ifnconst player1colors" checks - it reads (player0color),y
// / (player1color),y every scanline, the SAME Y the graphic pointer itself
// uses, into COLUP0/COLUP1), not something built from scratch here - just
// never wired up by this app before. 2600basic.h confirms player0color/
// player1color are each 2-byte zero-page pointers like player0pointer, but
// WITHOUT the same lo/hi-split alias names that let the graphic pointer be
// set safely (see generateRomNoiseChecks'  comment on why "pointer = X +
// offset" can't be used) - EXCEPT they happen to double up on other named
// registers at the exact same physical addresses, which the header's own
// comments confirm is deliberate, not coincidental ("currentpaddle = $90 ;
// replaces missile 0 (and can't be used with playercolor)"): player0color's
// low byte IS player0color itself, and its high byte is "paddle";
// player1color's low byte is player1color itself, and its high byte is
// "missile1y". Reusing those exact names lets the color pointer be set the
// same safe, plain-8-bit-assignment way as the graphic pointer, with no new
// mechanism needed. Deliberately independent of sprite_*_rom_noise (its own
// offset/dev var, its  active bit) - this reads real ROM bytes into the
// COLOR channel regardless of whatever the player's  GRAPHIC pointer is
// currently showing, a normal animation frame or ROM noise.
export const ROM_NOISE_COLOR_REGISTERS = {
  player0: {low: 'player0color', high: 'paddle', kernelOption: 'playercolors'},
  player1: {low: 'player1color', high: 'missile1y', kernelOption: 'player1colors'},
};

// Actually allocates a RAM slot (letter or varN) for each dev var name this
// feature needs, and gets each one a real "dim name = ..." declaration -
// merely resolving a name through nameDB_.getName (what every generator
// function here does via resolveVar) only assigns it a SYMBOL, it does not
// reserve storage or emit a dim for it. Confirmed as a real build failure
// (DASM: "Unknown Mnemonic 'sta _player0RomNoiseOffset'" - an undeclared
// symbol) from an earlier version of this that only ever called
// nameDB_.getName from inside the trigger/check generators, the same way
// reserveTextScrollDevVars already has to for the Text Minikernel's own
// scroll state (see its  call site in bbasic.js's init(), which this
// mirrors) - called with a pre-scanned Set of which player names actually
// use rom_noise anywhere in the project (bbasic.js's init() has to know this
// BEFORE user variable letters are handed out, well before either
// generator would otherwise run).
export const reserveRomNoiseDevVars = (reserveDevVar, usedFor) => {
  if (!usedFor || !usedFor.size) return;
  reserveDevVar(romNoiseFlagsVarName(), undefined, 'shared active-bit byte (ROM noise + rainbow colors)');
  usedFor.forEach((name) => {
    reserveDevVar(romNoiseOffsetVarName(name), undefined, 'this player\'s ROM noise: pointer offset');
    reserveDevVar(romNoiseHeightVarName(name), undefined, 'this player\'s ROM noise: sprite height');
  });
};

// Same reasoning as reserveRomNoiseDevVars above, for sprite_*_rainbow_
// colors'  offset dev var - deliberately separate from ROM noise's own,
// since either block can be used without the other. Shares the SAME flags
// byte (romNoiseFlagsVarName) rather than a byte of its own - see that
// function's own "one shared flags byte" comment.
export const reserveRainbowColorDevVars = (reserveDevVar, usedFor) => {
  if (!usedFor || !usedFor.size) return;
  reserveDevVar(romNoiseFlagsVarName(), undefined, 'shared active-bit byte (ROM noise + rainbow colors)');
  usedFor.forEach((name) =>
    reserveDevVar(rainbowColorOffsetVarName(name), undefined, 'this player\'s rainbow-color cycle offset'));
};

// Same reasoning as reserveRomNoiseDevVars above, for sprite_*_fire - called
// with a pre-scanned Set of which missile names actually have a Fire block
// used anywhere in the project (bbasic.js's  init() has to know this
// before user variable letters are handed out, well before this feature's
// own generator would otherwise run).
// throttleVar/throttleResetVar route through reserveDevVarRW (the
// Superchip r/w pool - see its  big comment in generators/bbasic.js)
// instead of the ordinary lettered pool - a plain decrement-then-if-
// comparison countdown is exactly the "safe" usage shape that pool's own
// restrictions allow (never a loop counter, goto/gosub target, or fixed-
// point/16-bit math - confirmed by reading every call site below by hand
// before making this change). Falls back to the ordinary lettered pool
// automatically whenever Superchip is off, pfres is too high, or the r/w
// pool is already full, so this is free real-var savings on Superchip
// builds with no fallback risk.
export const reserveMissileFireDevVars = (reserveDevVar, reserveDevVarRW, usedFor, used16) => {
  if (!usedFor || !usedFor.size) return;
  reserveDevVar(missileFireFlagsVarName(), undefined, 'shared active-bit byte for fired missiles');
  usedFor.forEach((name) => {
    reserveDevVar(missileFireDirVarName(name), undefined, 'this missile\'s fired direction (0-7, or 255 for none)');
    reserveDevVar(missileFireSpeedVarName(name), undefined, 'this missile\'s fired speed (pixels/frame)');
    reserveDevVarRW(missileFireThrottleVarName(name), 'this missile\'s "throttle movement" countdown');
    reserveDevVarRW(missileFireThrottleResetVarName(name),
        'this missile\'s "throttle movement" countdown reset value');
    if (used16 && used16.has(name)) {
      reserveDevVar(missileFireHalfSpeedVarName(name), undefined,
          'this missile\'s fired speed / 2, clamped to a minimum of 1, for 16-way\'s halfway directions');
    }
  });
};

// Same reasoning as reserveMissileFireDevVars above, for sprite_*_bounce's
// Combat-style state (see missileBounceStageVarName's comment) - called
// with a pre-scanned Set of which missile/ball names actually have a
// Bounce block used anywhere in the project. Deliberately separate from
// reserveMissileFireDevVars/missileFireUsedFor: dirVar itself is needed
// whenever EITHER Fire or Bounce is used (Bounce reads/writes it even
// without a matching Fire block), but this extra state is only ever touched
// by Bounce's generator, so a project using Fire without Bounce shouldn't
// pay for unused dev vars per missile - same reasoning extended to
// origDirVar below, which previously reserved unconditionally for every
// Bounce-using sprite even though object_bounce's generator only
// reads/writes it when hasFire is true.
//
// Routed through reserveDevVarRW (the Superchip r/w pool, see its comment
// in bbasic.js's init()) instead of the ordinary lettered pool - every one
// of these five vars' actual usage in object_bounce below is a plain
// comparison, a plain assignment, or a read used as an arithmetic operand
// assigned to a different variable (e.g. "dirVar = origDirVar + half"),
// the same safe shape background_collision_pixel's col2/row2 already use
// successfully (generators/bbasic/background.js's "col2.write =
// col2.read - 1") - none are a loop counter, goto/gosub target, or
// fixed-point/16-bit math. Falls back to the ordinary pool automatically
// whenever Superchip is off (reserveDevVarRW's fallback), so this is
// free real-var savings on Superchip builds with no fallback risk.
export const reserveMissileBounceDevVars = (reserveDevVarRW, usedFor, inertiaUsedFor, fireUsedFor, fineUsedFor) => {
  if (!usedFor || !usedFor.size) return;
  const inertiaSet = inertiaUsedFor || new Set();
  const fireSet = fireUsedFor || new Set();
  const fineSet = fineUsedFor || new Set();
  usedFor.forEach((name) => {
    reserveDevVarRW(missileBounceStageVarName(name),
        'this sprite\'s Combat-style bounce: consecutive stuck frames so far (0-3)');
    reserveDevVarRW(missileBounceFrameVarName(name),
        'this sprite\'s Combat-style bounce: framecounter value at the last bounce');
    if (fireSet.has(name)) {
      reserveDevVarRW(missileBounceOrigDirVarName(name),
          'this sprite\'s Combat-style bounce: heading when the current collision started');
    }
    if (inertiaSet.has(name)) {
      reserveDevVarRW(missileBounceOrigVelocityXVarName(name),
          'this sprite\'s Combat-style bounce: velocity X when the current collision started');
      reserveDevVarRW(missileBounceOrigVelocityYVarName(name),
          'this sprite\'s Combat-style bounce: velocity Y when the current collision started');
      // Fine mode's fractional half of the same snapshot - see
      // missileBounceOrigVelocityFracXVarName's comment. Only reserved
      // when the sprite is ALSO Fine-mode (a sprite using non-Fine Inertia
      // with Bounce has nothing fractional to snapshot).
      if (fineSet.has(name)) {
        reserveDevVarRW(missileBounceOrigVelocityFracXVarName(name),
            'this sprite\'s Combat-style bounce: Fine-mode velocity X fraction when the current collision started');
        reserveDevVarRW(missileBounceOrigVelocityFracYVarName(name),
            'this sprite\'s Combat-style bounce: Fine-mode velocity Y fraction when the current collision started');
      }
    }
  });
};

// Same reasoning as reserveMissileFireDevVars above, for sprite_*_seek_to -
// called with a pre-scanned Set of which sprite names actually have a Seek
// block used anywhere in the project.
// throttleVar/throttleResetVar route through reserveDevVarRW - same
// reasoning as reserveMissileFireDevVars'  identical change above.
export const reserveSeekDevVars = (reserveDevVar, reserveDevVarRW, usedFor) => {
  if (!usedFor || !usedFor.size) return;
  reserveDevVar(seekFlagsVarName(), undefined, 'shared active-bit byte for seeking sprites');
  usedFor.forEach((name) => {
    reserveDevVar(seekXVarName(name), undefined, 'this sprite\'s seek target X');
    reserveDevVar(seekYVarName(name), undefined, 'this sprite\'s seek target Y');
    reserveDevVar(seekSpeedVarName(name), undefined, 'this sprite\'s seek speed (pixels/frame/axis)');
    reserveDevVarRW(seekThrottleVarName(name), 'this sprite\'s "throttle movement" countdown');
    reserveDevVarRW(seekThrottleResetVarName(name),
        'this sprite\'s "throttle movement" countdown reset value');
  });
};

// One shared byte, reserved only when at least one object_seek_arrived
// block actually watches something (see resolveSeekArrivedWatches in
// blocks/sprites.js and seekArrivedFlagsVarName's  comment above) -
// called with that same pre-scanned Set, same "known before user variable
// letters are handed out" timing as reserveSeekDevVars above.
export const reserveSeekArrivedDevVars = (reserveDevVar, watches) => {
  if (!watches || !watches.size) return;
  reserveDevVar(seekArrivedFlagsVarName(), undefined, 'shared "seek arrived" finished-bit byte');
};

// velocityX/Y are reserved for every sprite in usedFor (either Accelerate or
// Decelerate targets it) - accelRate/maxSpeed/accelDir only for names in
// accelUsedFor (a sprite only ever Decelerated has nothing to hold, see
// inertiaAccelRateVarName's  comment), decelRate only for names in
// decelUsedFor. The two flag bytes are reserved whenever their  Set is
// non-empty, regardless of usedFor (mirrors reserveSeekArrivedDevVars'
// own "only when actually watched" gate).
export const reserveInertiaDevVars = (reserveDevVar, usedFor, accelUsedFor, decelUsedFor, accel16UsedFor, fineUsedFor) => {
  const fineSet = fineUsedFor || new Set();
  if (usedFor && usedFor.size) {
    usedFor.forEach((name) => {
      reserveDevVar(inertiaVelocityXVarName(name), undefined, 'this sprite\'s inertia velocity X (signed)');
      reserveDevVar(inertiaVelocityYVarName(name), undefined, 'this sprite\'s inertia velocity Y (signed)');
      if (fineSet.has(name)) {
        reserveDevVar(inertiaVelocityFracXVarName(name), undefined,
            'this sprite\'s Fine-mode inertia: velocity X fractional byte (0-255, low half of a 16-bit signed pair with velocity X)');
        reserveDevVar(inertiaVelocityFracYVarName(name), undefined,
            'this sprite\'s Fine-mode inertia: velocity Y fractional byte (0-255, low half of a 16-bit signed pair with velocity Y)');
        reserveDevVar(inertiaPosFracXVarName(name), undefined,
            'this sprite\'s Fine-mode inertia: X position sub-pixel accumulator (0-255)');
        reserveDevVar(inertiaPosFracYVarName(name), undefined,
            'this sprite\'s Fine-mode inertia: Y position sub-pixel accumulator (0-255)');
      }
    });
  }
  if (accelUsedFor && accelUsedFor.size) {
    reserveDevVar(inertiaAccelFlagsVarName(), undefined, 'shared active-bit byte for accelerating sprites');
    accelUsedFor.forEach((name) => {
      reserveDevVar(inertiaAccelRateVarName(name), undefined, 'this sprite\'s inertia acceleration rate');
      reserveDevVar(inertiaMaxSpeedVarName(name), undefined, 'this sprite\'s inertia max speed (per axis)');
      reserveDevVar(inertiaAccelDirVarName(name), undefined, 'this sprite\'s inertia acceleration direction (0-7)');
      if (accel16UsedFor && accel16UsedFor.has(name)) {
        reserveDevVar(inertiaAccelHalfRateVarName(name), undefined,
            'this sprite\'s inertia acceleration rate / 2, clamped to a minimum of 1, for 16-way\'s halfway directions');
      }
    });
  }
  if (decelUsedFor && decelUsedFor.size) {
    reserveDevVar(inertiaDecelFlagsVarName(), undefined, 'shared active-bit byte for decelerating sprites');
    decelUsedFor.forEach((name) => {
      reserveDevVar(inertiaDecelRateVarName(name), undefined, 'this sprite\'s inertia deceleration rate');
    });
  }
};

// Ball width and playfield priority both need to read-modify-write CTRLPF -
// clear just their  bits, keep everything else. That's unsafe done
// directly against the real hardware register: CTRLPF's write address ($0A)
// is ALIASED on real 2600 hardware with INPT2 (paddle port 2) in read mode -
// TIA only decodes 6 address bits and distinguishes write-only vs read-only
// registers sharing an address purely by the CPU's R/W line, not by the
// address itself (confirmed directly against vcs.h: CTRLPF and INPT2 are
// both "ds 1" at the same offset, in TIA_REGISTERS_WRITE and
// TIA_REGISTERS_READ respectively). So "CTRLPF & 207" doesn't read back
// whatever was last written to CTRLPF at all - it reads live paddle-port
// input (open bus/garbage if nothing's plugged in), and OR/ANDing that into
// a "preserve the other bits" write can set or clear ANY bit, including bit
// 1 (score mode) - confirmed as the actual root cause of a real reported bug
// ("ball width flips half the playfield to player1's color"), after ruling
// out compiler operator-precedence (splitting the multiply into its own
// statement first didn't fix it either, since the read-back itself was
// always the problem, however the expression was shaped).
// This dev var is CTRLPF's  RAM shadow: ball width/priority read-modify-
// write THIS instead (an ordinary RAM byte, safe to read back), then flush
// it to the real CTRLPF right after - CTRLPF isn't touched anywhere else in
// the generated kernel (unlike NUSIZ0/COLUP0/etc, it's never clobbered by
// the score routine), so a flush immediately after each write is enough;
// no once-per-frame restore in commongamelogic is needed.
export const reserveCtrlpfShadowDevVar = (reserveDevVar, used) => {
  if (!used) return;
  reserveDevVar(ctrlpfShadowVarName(), undefined,
      'RAM shadow of CTRLPF - the real register can\'t be safely read back (aliases INPT2)');
};

// Setup-section one-off (see bbasic.bb.hbs's  generatedCtrlpfShadowSetup
// splice, right alongside generatedKeypadSetup) - matches startup.asm's own
// real CTRLPF initial value (reflect bit only) so the shadow and the
// hardware register agree from the very first ball width/priority write,
// rather than the shadow starting at 0 (bB's normal all-vars-start-at-zero
// default) and silently dropping reflect the first time either block runs.
export const generateCtrlpfShadowSetup = (Blockly) => {
  if (!Blockly.BBasic.ctrlpfShadowUsed) return '';
  const shadowVar = Blockly.BBasic.nameDB_.getName(ctrlpfShadowVarName(), Blockly.Names.DEVELOPER_VARIABLE_TYPE);
  return ` ${shadowVar} = 1`;
};

// Spliced into commongamelogic right after generatedAnimations (see this
// file's  top-of-block comment for why the ordering matters) - one check
// per player that actually has a rom_noise block anywhere in the project,
// each only touching that one player's  pointer/height. Follows the same
// literal-whitespace convention generateBackgroundFadeChecks/
// generateTextScrollAdvance already rely on for this same splice style
// (bypasses normalizeIndents() - one leading space per statement line, bare
// zero-indent labels).
export const generateRomNoiseChecks = (Blockly) => {
  const used = Blockly.BBasic.romNoiseUsedFor;
  if (!used || !used.size) return '';
  const resolveVar = (canonicalName) =>
    Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
  const flagsVar = resolveVar(romNoiseFlagsVarName());
  const configurationStorage = useConfigurationStorage();
  const config = (configurationStorage && configurationStorage.value) || {};
  const baseHigh = romNoiseBaseHighByteHex(config);
  const lines = [];
  ['player0', 'player1'].forEach((name) => {
    if (!used.has(name)) return;
    const doneLabel = `_romnoise_${name}_done`;
    const offsetVar = resolveVar(romNoiseOffsetVarName(name));
    const heightVar = resolveVar(romNoiseHeightVarName(name));
    lines.push(
        // "flagsVar{bit} = 0" (an equality comparison against the bit-index
        // syntax) isn't valid here - confirmed by a real compile failure
        // ("Unknown keyword: 0"); the bit-index syntax only works as a
        // direct boolean condition, negated with "!" (see backgroundFadeTo's
        // own "if !${activeBit} then goto ..." in generators/bbasic/
        // background.js, the proven working precedent this mirrors).
        ` if !${flagsVar}{${romNoiseActiveBit(name)}} then goto ${doneLabel}`,
        // Sets player0pointer's  hi/lo bytes DIRECTLY (2600basic.h
        // aliases player0pointerlo/player0pointerhi onto the exact same
        // zero-page pair player0pointer itself uses) instead of the
        // "pointer = X + offset" idiom every earlier attempt here used -
        // confirmed by exhaustive testing that idiom only ever works for a
        // "data" table's  label (see this file's  top-of-block
        // comment for the full history: two different code labels and a
        // raw hex address all failed, one other combination compiled but
        // read the wrong memory entirely). Two plain 8-bit assignments sidestep
        // that whole idiom: baseHigh is a compile-time constant (no label,
        // no 16-bit immediate), and offsetVar becomes the low byte
        // directly with NO overflow risk, because every ROM_NOISE_BASE_
        // HIGH_BYTE_BY_ROMSIZE entry is page-aligned (low byte $00) - so
        // "low = 0 + offset" can never carry into the high byte, meaning
        // this reads real code starting from the very base of bank 1's own
        // mapped ROM, offset by 0-255 bytes into it - genuine Yars'
        // Revenge-style "read whatever code is there", zero ROM cost.
        ` ${name}pointerlo = ${offsetVar}`,
        ` ${name}pointerhi = ${baseHigh}`,
        ` ${name}height = ${heightVar}`,
        `${doneLabel}`,
    );
  });
  return lines.join('\n') + '\n';
};

// Whether kernel_options needs "playercolors" - see the real, confirmed
// language rule (from an actual working example program, not guesswork):
// "playercolors cannot be set by itself; player1colors must also be set."
// "player1colors" alone (player1-only multicolor) is fine on its own - only
// "playercolors" (needed whenever player0 wants it) has this extra
// requirement. So both real kernel_options AND both player0color:/
// player1color: graphic-literal declarations below are needed together
// whenever player0 is in use, even if player1 itself never asked for
// rainbow colors.
export const rainbowColorNeedsPlayerColors = (usedFor) => !!(usedFor && usedFor.has('player0'));
export const rainbowColorNeedsPlayer1Colors = (usedFor) => !!(usedFor && usedFor.size);

// Real batari Basic graphic-literal declarations (player0color:/
// player1color:, confirmed syntax from a real working example program) -
// NOT a runtime assignment. This has to exist for kernel_options
// "playercolors"/"player1colors" to compile at all (confirmed by a real
// build failure otherwise), the same way a normal "player0: ... end" sprite
// frame has to exist for the standard graphic pointer mechanism to work.
// The actual byte VALUES here are throwaway placeholders - never read
// during normal gameplay, since generateRainbowColorChecks below
// immediately overrides player0color/player1color's  pointer bytes at
// runtime, every frame, before this default table could ever matter. Only
// its declaration needs to exist, once, matching the exact same "player0: /
// %00000000 / end" raw literal syntax generateAnimations already uses for
// its  blank-default frame (2-space content indent, "end" at column 0 -
// this bypasses normalizeIndents() the same way, spliced into the same
// commongamelogic region right alongside generatedAnimations, so it needs
// the same literal formatting, not the one-space-per-statement convention
// the per-frame checks below it use).
export const generateRainbowColorGraphics = (Blockly) => {
  const used = Blockly.BBasic.rainbowColorUsedFor;
  if (!used || !used.size) return '';
  const lines = [];
  if (rainbowColorNeedsPlayerColors(used)) {
    lines.push('  player0color:', '  $0E', 'end');
  }
  if (rainbowColorNeedsPlayer1Colors(used)) {
    lines.push('  player1color:', '  $0E', 'end');
  }
  return lines.join('\n') + '\n';
};

// Same splice point/whitespace convention as generateRomNoiseChecks above,
// but entirely independent of it - see sprite_*_rainbow_colors'  block
// comment for why this is a separate block/check rather than folded into
// the noise one.
export const generateRainbowColorChecks = (Blockly) => {
  const used = Blockly.BBasic.rainbowColorUsedFor;
  if (!used || !used.size) return '';
  const resolveVar = (canonicalName) =>
    Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
  const flagsVar = resolveVar(romNoiseFlagsVarName());
  const configurationStorage = useConfigurationStorage();
  const config = (configurationStorage && configurationStorage.value) || {};
  const baseHigh = romNoiseBaseHighByteHex(config);
  const lines = [];
  ['player0', 'player1'].forEach((name) => {
    if (!used.has(name)) return;
    const doneLabel = `_rainbowcolor_${name}_done`;
    const offsetVar = resolveVar(rainbowColorOffsetVarName(name));
    const registers = ROM_NOISE_COLOR_REGISTERS[name];
    lines.push(
        ` if !${flagsVar}{${rainbowColorActiveBit(name)}} then goto ${doneLabel}`,
        ` ${registers.low} = ${offsetVar}`,
        ` ${registers.high} = ${baseHigh}`,
        `${doneLabel}`,
    );
  });
  return lines.join('\n') + '\n';
};

// Spliced into commongamelogic right after generateRomNoiseChecks/
// generateRainbowColorChecks (same region, same reasoning: nothing else
// there touches missile position) - one check per missile that actually has
// a Fire block used anywhere in the project. Two independent 8-way dispatch
// chains (X, then Y) rather than one combined per-direction chain, because
// bB's "if X then A" only conditions the single statement immediately after
// "then" (a real, previously-confirmed bug class in this codebase - see
// controls_repeat_ext's  label comment above) - a single "if dir=1 then
// x=x-speed : y=y-speed"-style line would silently only ever run the first
// statement. No multiplication anywhere: every direction's  step is
// always exactly -speed/0/+speed, so applying speed is a plain add/subtract.
// Per-direction (x, y) step multipliers for the "16 directions" mode - see
// sprite_*_fire's tooltip in blocks/sprites.js. There's no trig here: the 8
// halfway points inserted between the original compass points each move at
// full speed on their dominant axis and HALF speed (integer division,
// rounds down) on the other, the same coarse lookup-table approximation
// classic 2600 games used instead of real sine/cosine (see this app's
// research into how Combat's shells ricochet). Index matches ANGLE's 0-15,
// clockwise from Up, same convention as the 8-way scale just with a step
// inserted between each original point.
const DIRECTION16_STEPS = [
  [0, -1], [1, -2], [1, -1], [2, -1],
  [1, 0], [2, 1], [1, 1], [1, 2],
  [0, 1], [-1, 2], [-1, 1], [-2, 1],
  [-1, 0], [-2, -1], [-1, -1], [-1, -2],
];

export const generateMissileFireChecks = (Blockly) => {
  const used = Blockly.BBasic.missileFireUsedFor;
  if (!used || !used.size) return '';
  const used16 = Blockly.BBasic.missileFire16UsedFor;
  const resolveVar = (canonicalName) =>
    Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
  const resolveRW = (canonicalName) => Blockly.BBasic.superchipRwPairs[canonicalName];
  const flagsVar = resolveVar(missileFireFlagsVarName());
  const lines = [];
  ['missile0', 'missile1', 'ball'].forEach((name) => {
    if (!used.has(name)) return;
    const doneLabel = `_missilefire_${name}_done`;
    const dirVar = resolveVar(missileFireDirVarName(name));
    const speedVar = resolveVar(missileFireSpeedVarName(name));
    const activeBit = missileFireActiveBit(name);
    const throttlePair = resolveRW(missileFireThrottleVarName(name));
    const throttleResetPair = resolveRW(missileFireThrottleResetVarName(name));
    const is16 = used16 && used16.has(name);
    const halfSpeedVar = is16 ? resolveVar(missileFireHalfSpeedVarName(name)) : null;
    // Every "if dirVar = N then ..." line only ever conditions the ONE
    // statement right after "then" (see this function's long-standing
    // comment further down) - a step whose (x, y) pair has BOTH a nonzero x
    // and y (every 16-way entry except the 4 pure compass points) needs two
    // separate lines, one per axis, both guarded by the same dirVar check,
    // rather than one combined statement. Half-speed steps use halfSpeedVar
    // (speedVar/2, clamped to a minimum of 1 below) instead of inlining
    // "(speedVar/2)" - bB's integer division rounds 1/2 down to 0, which at
    // speed 1 would make every halfway direction's slower axis vanish,
    // making 16-way look identical to 8-way (see missileFireHalfSpeedVarName's
    // own comment).
    const dispatch = is16 ?
      DIRECTION16_STEPS.flatMap(([xStep, yStep], dir) => [
        ...(xStep ? [` if ${dirVar} = ${dir} then ${name}x = ${name}x ${xStep > 0 ? '+' : '-'} ` +
          `${Math.abs(xStep) === 1 ? speedVar : halfSpeedVar}`] : []),
        ...(yStep ? [` if ${dirVar} = ${dir} then ${name}y = ${name}y ${yStep > 0 ? '+' : '-'} ` +
          `${Math.abs(yStep) === 1 ? speedVar : halfSpeedVar}`] : []),
      ]) :
      [
        // X dispatch: Up-Right/Right/Down-Right (1,2,3) step +speed,
        // Down-Left/Left/Up-Left (5,6,7) step -speed, Up/Down (0,4) untouched.
        ` if ${dirVar} = 1 then ${name}x = ${name}x + ${speedVar}`,
        ` if ${dirVar} = 2 then ${name}x = ${name}x + ${speedVar}`,
        ` if ${dirVar} = 3 then ${name}x = ${name}x + ${speedVar}`,
        ` if ${dirVar} = 5 then ${name}x = ${name}x - ${speedVar}`,
        ` if ${dirVar} = 6 then ${name}x = ${name}x - ${speedVar}`,
        ` if ${dirVar} = 7 then ${name}x = ${name}x - ${speedVar}`,
        // Y dispatch: Down-Right/Down/Down-Left (3,4,5) step +speed,
        // Up-Left/Up/Up-Right (7,0,1) step -speed, Left/Right (6,2) untouched.
        ` if ${dirVar} = 3 then ${name}y = ${name}y + ${speedVar}`,
        ` if ${dirVar} = 4 then ${name}y = ${name}y + ${speedVar}`,
        ` if ${dirVar} = 5 then ${name}y = ${name}y + ${speedVar}`,
        ` if ${dirVar} = 7 then ${name}y = ${name}y - ${speedVar}`,
        ` if ${dirVar} = 0 then ${name}y = ${name}y - ${speedVar}`,
        ` if ${dirVar} = 1 then ${name}y = ${name}y - ${speedVar}`,
      ];
    const throttleContinueLabel = `_missilefire_${name}_throttlecontinue`;
    lines.push(
        ` if !${flagsVar}{${activeBit}} then goto ${doneLabel}`,
        // Was "throttlePair.write = throttlePair.read - 1" followed by a
        // separately bB-compiled "if throttlePair.read then goto doneLabel" -
        // that second line re-loaded the very same byte from RAM purely to
        // re-derive the zero flag the subtraction just above already left
        // set (STA doesn't touch flags, nothing else runs in between). Raw
        // asm instead, branching straight off that flag - read/write pool
        // addresses differ physically (see reserveDevVarRW's  comment),
        // so this still can't be a single in-place "dec", just the same
        // lda/sec/sbc/sta bB itself already compiles to, with the reload
        // removed. doneLabel is a bB-generated label defined OUTSIDE this
        // asm block, so the jump to it needs the same dot-prefixed local
        // name DASM itself expects (see generators/bbasic/music.js's own
        // extensive comment on this) - throttleContinueLabel is purely
        // local to this block, so it doesn't need one.
        ' asm',
        '       lda ' + throttlePair.read,
        '       sec',
        '       sbc #1',
        '       sta ' + throttlePair.write,
        '       beq ' + throttleContinueLabel,
        '       jmp .' + doneLabel,
        throttleContinueLabel,
        'end',
        ` ${throttlePair.write} = ${throttleResetPair.read}`,
        ...(is16 ? [
          ` ${halfSpeedVar} = ${speedVar} / 2`,
          ` if ${halfSpeedVar} = 0 then ${halfSpeedVar} = 1`,
        ] : []),
        ...dispatch,
        // Off-screen (standard NTSC playfield bounds) stops the movement -
        // clears the active bit so this missile's  dispatch above is
        // skipped every frame from here on - WITHOUT touching its own
        // Height (confirmed with the user: it should stop, not change
        // size/visibility on its own - that stays entirely up to whatever
        // "Missile: set Height" blocks the user has elsewhere). x/y are
        // unsigned bytes (see math.js's own "Player coordinates ... are
        // unsigned bytes" comment) - stepping past 0 wraps around to a large
        // positive value rather than going negative, so there's no separate
        // "< 0" case to check: an out-of-range value from EITHER direction
        // always lands as "> 159"/"> 191" here.
        ` if ${name}x > 159 || ${name}y > 191 then ${flagsVar}{${activeBit}} = 0`,
        `${doneLabel}`,
    );
  });
  return lines.join('\n') + '\n';
};

// Spliced into commongamelogic right alongside generateMissileFireChecks
// (same region, same reasoning: nothing else there touches this sprite's
// position) - one check per sprite name that actually has a Seek block used
// anywhere in the project. Per axis: step toward the target by up to speed
// pixels, landing exactly on it rather than overshooting. The remaining
// distance is always computed via subtraction in whichever direction the
// branch just taken already guarantees is safe (the larger value minus the
// smaller), THEN clamped to speed - never the other way around - so this
// stays correct however large speed or the remaining distance is, with no
// unsigned-byte-underflow risk (the exact class of bug the playfield-
// collision work ran into repeatedly - worth being deliberate about here
// even though this arithmetic is much simpler). temp1 is safe scratch here:
// only clobbered by drawscreen, which can't run mid-statement (see
// score.js's  comment on the same convention), and nothing in this block
// calls pfread() to worry about clobbering it early.
export const generateSeekChecks = (Blockly) => {
  const used = Blockly.BBasic.seekUsedFor;
  if (!used || !used.size) return '';
  const resolveVar = (canonicalName) =>
    Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
  const flagsVar = resolveVar(seekFlagsVarName());
  const arrivedWatches = Blockly.BBasic.seekArrivedWatches || new Set();
  const lines = [];
  ['player0', 'player1', 'missile0', 'missile1', 'ball'].forEach((name) => {
    if (!used.has(name)) return;
    const blockNumber = Blockly.BBasic.blockNumbers.next(`seek_${name}`);
    const doneLabel = `_seek_${name}_${blockNumber}_done`;
    const arrivedLabel = `_seek_${name}_${blockNumber}_arrived`;
    const targetXVar = resolveVar(seekXVarName(name));
    const targetYVar = resolveVar(seekYVarName(name));
    const speedVar = resolveVar(seekSpeedVarName(name));
    const activeBit = seekActiveBit(name);
    const isArrivedWatched = arrivedWatches.has(name);
    const arrivedFlagBit = isArrivedWatched ?
      `${resolveVar(seekArrivedFlagsVarName())}{${seekArrivedBit(name)}}` : null;
    const throttlePair = Blockly.BBasic.superchipRwPairs[seekThrottleVarName(name)];
    const throttleResetPair = Blockly.BBasic.superchipRwPairs[seekThrottleResetVarName(name)];

    const buildAxisSteps = (axis, targetVar) => {
      const axisDoneLabel = `_seek_${name}_${blockNumber}_${axis}done`;
      const rightLabel = `_seek_${name}_${blockNumber}_${axis}right`;
      const coord = `${name}${axis}`;
      return [
        ` if ${coord} = ${targetVar} then goto ${axisDoneLabel}`,
        ` if ${targetVar} > ${coord} then goto ${rightLabel}`,
        ` temp1 = ${coord} - ${targetVar}`,
        ` if temp1 > ${speedVar} then temp1 = ${speedVar}`,
        ` ${coord} = ${coord} - temp1`,
        ` goto ${axisDoneLabel}`,
        `${rightLabel}`,
        ` temp1 = ${targetVar} - ${coord}`,
        ` if temp1 > ${speedVar} then temp1 = ${speedVar}`,
        ` ${coord} = ${coord} + temp1`,
        `${axisDoneLabel}`,
      ];
    };

    lines.push(
        ` if !${flagsVar}{${activeBit}} then goto ${doneLabel}`,
        ` ${throttlePair.write} = ${throttlePair.read} - 1`,
        ` if ${throttlePair.read} then goto ${doneLabel}`,
        ` ${throttlePair.write} = ${throttleResetPair.read}`,
        ...buildAxisSteps('x', targetXVar),
        ...buildAxisSteps('y', targetYVar),
        ` if ${name}x = ${targetXVar} && ${name}y = ${targetYVar} then goto ${arrivedLabel}`,
        ` goto ${doneLabel}`,
        `${arrivedLabel}`,
        ` ${flagsVar}{${activeBit}} = 0`,
        ...(isArrivedWatched ? [` ${arrivedFlagBit} = 1`] : []),
        `${doneLabel}`,
    );
  });
  return lines.join('\n') + '\n';
};

// Clamps velocityVar (a two's-complement signed byte) to +/-maxSpeedVar
// (an ordinary unsigned magnitude, realistically well under 128) - bB's own
// "if" comparisons are unsigned-only (see inertiaVelocityXVarName's own
// comment), so this branches on the sign bit first (BPL/BMI, a single cheap
// check) and does a plain UNSIGNED compare within whichever half of the
// byte range applies from there - valid specifically because both operands
// stay within 0-127 (positive branch) or 128-255 (negative branch) after
// that split, where unsigned and signed comparison agree. negMaxVar is
// computed fresh each call (0 - maxSpeedVar) rather than kept as its own
// dev var - two extra instructions, cheaper than a whole extra byte of
// state kept in sync with every "set max speed" write.
const buildSignedClampAsm = (velocityVar, maxSpeedVar, uid) => {
  const posLabel = `_inertiaclamp${uid}_pos`;
  const doneLabel = `_inertiaclamp${uid}_done`;
  return [
    '       lda ' + velocityVar,
    '       bpl ' + posLabel,
    '       lda #0',
    '       sec',
    '       sbc ' + maxSpeedVar,
    '       sta temp7',
    '       lda ' + velocityVar,
    '       cmp temp7',
    '       bcs ' + doneLabel,
    '       lda temp7',
    '       jmp ' + doneLabel,
    posLabel,
    '       cmp ' + maxSpeedVar,
    '       bcc ' + doneLabel,
    '       lda ' + maxSpeedVar,
    doneLabel,
    '       sta ' + velocityVar,
  ];
};

// Steps velocityVar one decelRateVar closer to 0, clamping AT (not past)
// zero - the classic "friction overshoot" bug this guards against directly:
// subtracting decelRateVar from a small positive velocity (or adding it to
// a small negative one) can otherwise cross zero and start moving the
// OPPOSITE direction, which real friction never does. Same sign-bit-first
// split as buildSignedClampAsm above; the positive branch's "cmp
// decelRateVar / bcc" is a plain unsigned compare, valid for the same
// reason (both operands 0-127 here).
const buildDecelerateAsm = (velocityVar, decelRateVar, uid) => {
  const negLabel = `_inertiadecel${uid}_neg`;
  const zeroLabel = `_inertiadecel${uid}_zero`;
  const doneLabel = `_inertiadecel${uid}_done`;
  return [
    '       lda ' + velocityVar,
    '       bmi ' + negLabel,
    '       cmp ' + decelRateVar,
    '       bcc ' + zeroLabel,
    '       sec',
    '       sbc ' + decelRateVar,
    '       jmp ' + doneLabel,
    negLabel,
    '       clc',
    '       adc ' + decelRateVar,
    '       bmi ' + doneLabel,
    zeroLabel,
    '       lda #0',
    doneLabel,
    '       sta ' + velocityVar,
  ];
};

// "Fine" mode's fixed-point helpers (see inertiaFineUsedFor's pre-scan in
// bbasic.js, and inertiaVelocityFracXVarName's comment in this file) - a
// [intVar:fracVar] pair, intVar the signed high byte, fracVar the unsigned
// (0-255) low byte, is a standard 16-bit two's complement number
// representing intVar + fracVar/256 for every value including negative ones
// (confirmed by hand: -1.25 in this scheme is intVar=$FE (-2), fracVar=$C0
// (192) = -2 + 192/256 = -1.25) - so plain ADC/SBC chains below work
// correctly for both signs with no branching needed, unlike
// buildSignedClampAsm/buildDecelerateAsm above (which both need a sign-bit
// branch because THEIR single-byte values can't carry/borrow into anything
// wider). Matches the real technique this era's hardware used for sub-pixel
// movement (confirmed directly against the Asteroids arcade disassembly at
// computerarcheology.com/Arcade/Asteroids/Code.html: velocity added into a
// low position byte, carry propagated via ADC into the high byte).

// [intVar:fracVar] += [0:amountVar] - amountVar is a plain 0-255 magnitude
// (Fine mode's "rate" - always sub-1, no whole-pixel part), so only the low
// byte needs an explicit add; the high byte just needs the carry folded in.
const build16BitAddAsm = (intVar, fracVar, amountVar) => [
  '       lda ' + fracVar,
  '       clc',
  '       adc ' + amountVar,
  '       sta ' + fracVar,
  '       lda ' + intVar,
  '       adc #0',
  '       sta ' + intVar,
];

// Mirror of build16BitAddAsm above for the opposite direction.
const build16BitSubAsm = (intVar, fracVar, amountVar) => [
  '       lda ' + fracVar,
  '       sec',
  '       sbc ' + amountVar,
  '       sta ' + fracVar,
  '       lda ' + intVar,
  '       sbc #0',
  '       sta ' + intVar,
];

// Standard 16-bit two's complement negation (invert every bit, add 1, with
// the +1's carry propagating from the low byte into the high byte) - used
// by object_bounce's Fine-mode reflection below. Only valid for a plain,
// single-symbol var (same physical address for read and write) - NOT safe
// to call directly against an RW-pool {read, write} pair's symbols,
// since a carry chain needs to read-then-write the SAME address each step;
// object_bounce's Fine-mode branch below always copies an RW-pool
// snapshot into an ordinary var first, then negates the ordinary var in
// place, rather than ever negating an RW-pool pair directly.
const build16BitNegateAsm = (intVar, fracVar) => [
  '       lda ' + fracVar,
  '       eor #$FF',
  '       clc',
  '       adc #1',
  '       sta ' + fracVar,
  '       lda ' + intVar,
  '       eor #$FF',
  '       adc #0',
  '       sta ' + intVar,
];

// 16-bit widened version of buildDecelerateAsm above, same "clamp AT zero,
// never overshoot past it" guarantee, just done across the fixed-point
// pair instead of a single byte. amountVar is applied unconditionally
// first (compute-then-correct, rather than comparing magnitudes up front -
// simpler to get right across two bytes), then checked for having crossed
// zero: the positive branch only overshoots if the OLD value was already
// below 1.0 (intVar was 0) and amountVar pushed it negative; the negative
// branch only overshoots if the old value was already above -1.0 (intVar
// was -1) and amountVar pushed it to positive OR to exactly zero with a
// nonzero fracVar remainder (landing at a small positive value is just as
// much a direction reversal as landing at a large one, so it's clamped
// too - the same "friction never overshoots" guarantee buildDecelerateAsm
// itself makes, just checked across two bytes instead of one).
const buildFineDecelerateAsm = (intVar, fracVar, amountVar, uid) => {
  const negLabel = `_inertiafinedecel${uid}_neg`;
  const clampLabel = `_inertiafinedecel${uid}_clamp`;
  const doneLabel = `_inertiafinedecel${uid}_done`;
  return [
    '       lda ' + intVar,
    '       bmi ' + negLabel,
    '       lda ' + fracVar,
    '       sec',
    '       sbc ' + amountVar,
    '       sta ' + fracVar,
    '       lda ' + intVar,
    '       sbc #0',
    '       sta ' + intVar,
    '       bpl ' + doneLabel,
    '       jmp ' + clampLabel,
    negLabel,
    '       lda ' + fracVar,
    '       clc',
    '       adc ' + amountVar,
    '       sta ' + fracVar,
    '       lda ' + intVar,
    '       adc #0',
    '       sta ' + intVar,
    '       bmi ' + doneLabel,
    '       bne ' + clampLabel,
    '       lda ' + fracVar,
    '       beq ' + doneLabel,
    clampLabel,
    '       lda #0',
    '       sta ' + intVar,
    '       sta ' + fracVar,
    doneLabel,
  ];
};

// Fine mode's position integration - replaces the plain bB
// "${name}x = ${name}x + velocityXVar" line for a Fine-using sprite:
// accumulates velocity's fractional byte into a dedicated position
// sub-pixel accumulator (posFracVar), then adds velocity's signed whole-
// pixel byte PLUS whatever carried out of that accumulation into the real
// on-screen position - the exact Asteroids technique cited above, just
// with the "velocity" role played by intVar/fracVar instead of a plain
// per-frame delta.
const buildFinePositionStepAsm = (posVar, intVar, fracVar, posFracVar) => [
  '       lda ' + posFracVar,
  '       clc',
  '       adc ' + fracVar,
  '       sta ' + posFracVar,
  '       lda ' + posVar,
  '       adc ' + intVar,
  '       sta ' + posVar,
];

// Spliced into commongamelogic right alongside generateSeekChecks/
// generateMissileFireChecks (same region, same "nothing else touches this
// sprite's position there" reasoning) - one block per sprite name that
// actually has Accelerate and/or Decelerate used anywhere in the project.
// Accelerate's  direction dispatch (which axis/sign accelRateVar adds
// to) is plain bB if/goto, the exact same 12-line 8-way shape
// generateMissileFireChecks'  dispatch already uses (just adding into
// velocityX/Y instead of stepping name x/y directly) - only the max-speed
// clamp and the decelerate-toward-zero step need hand asm (see
// buildSignedClampAsm/buildDecelerateAsm's  comments on why). Position
// integration itself is a single plain bB add per axis, unconditional,
// after both accel/decel have had their turn - works correctly on the
// two's-complement byte with no special handling at all.
export const generateInertiaChecks = (Blockly) => {
  const usedFor = Blockly.BBasic.inertiaUsedFor;
  if (!usedFor || !usedFor.size) return '';
  const accelUsedFor = Blockly.BBasic.inertiaAccelUsedFor || new Set();
  const accel16UsedFor = Blockly.BBasic.inertiaAccel16UsedFor || new Set();
  const decelUsedFor = Blockly.BBasic.inertiaDecelUsedFor || new Set();
  const fineUsedFor = Blockly.BBasic.inertiaFineUsedFor || new Set();
  const resolveVar = (canonicalName) =>
    Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
  const accelFlagsVar = accelUsedFor.size ? resolveVar(inertiaAccelFlagsVarName()) : null;
  const decelFlagsVar = decelUsedFor.size ? resolveVar(inertiaDecelFlagsVarName()) : null;
  const lines = [];
  ['player0', 'player1', 'missile0', 'missile1', 'ball'].forEach((name) => {
    if (!usedFor.has(name)) return;
    const velocityXVar = resolveVar(inertiaVelocityXVarName(name));
    const velocityYVar = resolveVar(inertiaVelocityYVarName(name));
    const activeBit = inertiaActiveBit(name);
    const uid = Blockly.BBasic.blockNumbers.next(`inertia_${name}`);
    const isFine = fineUsedFor.has(name);
    const velocityFracXVar = isFine ? resolveVar(inertiaVelocityFracXVarName(name)) : null;
    const velocityFracYVar = isFine ? resolveVar(inertiaVelocityFracYVarName(name)) : null;

    if (accelUsedFor.has(name)) {
      const dirVar = resolveVar(inertiaAccelDirVarName(name));
      const rateVar = resolveVar(inertiaAccelRateVarName(name));
      const maxSpeedVar = resolveVar(inertiaMaxSpeedVarName(name));
      const skipLabel = `_inertiaaccel_${name}_skip`;
      // Fine mode only supports 8-way (see sprite_inertia_accelerate's
      // tooltip in blocks/sprites.js - "can't be combined with 16
      // directions") - 16-way's DIRECTIONS16 checkbox is simply
      // ignored here if Fine is also on, rather than adding a second,
      // fixed-point-aware half-rate concept on top of everything else.
      const is16 = !isFine && accel16UsedFor.has(name);
      const halfRateVar = is16 ? resolveVar(inertiaAccelHalfRateVarName(name)) : null;
      // Same 8-way/16-way dispatch generateMissileFireChecks'  Fire
      // dispatch uses (see its  comments, including DIRECTION16_STEPS'
      // own "no trig, dominant axis full rate / other axis half rate"
      // approximation, and missileFireHalfSpeedVarName's  comment on why
      // the half-rate step needs a clamped-to-minimum-1 var instead of
      // inlining "(rateVar/2)") - just adding into velocityX/Y here instead
      // of stepping name x/y directly. Fine mode wraps each conditional
      // add/subtract in its goto/label pair so the fixed-point asm
      // (build16BitAddAsm/build16BitSubAsm) can run as the "then" action -
      // a plain bB "if X then Y" only allows one statement for Y, and an
      // asm block isn't one, unlike the non-Fine path's plain add/subtract
      // line.
      // Bare labels (no "@" prefix) - this function's output is
      // spliced directly into commongamelogic's body (see this file's
      // generateInertiaChecks call site in bbasic.js), never passed through
      // Blockly.BBasic.normalizeIndents() the way a normal per-block
      // generator's output automatically is - the SAME reason skipLabel
      // below (in the existing, non-Fine code) has always been a bare
      // label rather than "@"-prefixed. An earlier version of this used
      // "@"-prefixed labels here (copying the convention from block
      // generators that DO go through normalizeIndents, like
      // background_scroll) and it reached preprocess.wasm as a literal,
      // unrecognized "@" character - confirmed directly against a real
      // failed build.
      //
      // One shared asm block per axis-direction (add vs subtract), not one
      // per compass direction - the three directions that add to a given
      // axis (e.g. 1/2/3 for X) all run the exact same build16BitAddAsm
      // body, so branching all three "if dirVar = N" checks at the SAME
      // doLabel instead of giving each a separate copy cuts this dispatch's
      // spliced-into-commongamelogic size by roughly 3x per axis. This is
      // the fix for a real reported build failure ("Unknown Mnemonic 'sta
      // TextColor'", only when Fine is on): confirmed via this codebase's
      // existing relocation-system comments (generators/bbasic.js's
      // banksBeforeGapFill/everyDeclaredBank and hooks/rom.js's isOverflow
      // Error) that this exact "Unknown Mnemonic" cascade, after the
      // auto-relocation retry loop exhausts its attempts, is this
      // toolchain's known fingerprint for bank 1 genuinely not fitting -
      // and this dispatch (like generateSeekChecks/generateMissileFire
      // Checks alongside it) is spliced directly into commongamelogic,
      // never wrapped as a relocatable unit, so the auto-relocation system
      // can never move it out of bank 1 no matter how large it gets.
      const buildFineAxisDispatch = (addDirs, subDirs, velVar, fracVar, suffix) => {
        const addLabel = `_inertiafineaccel_${uid}_${suffix}add`;
        const subLabel = `_inertiafineaccel_${uid}_${suffix}sub`;
        const skipLabel = `_inertiafineaccel_${uid}_${suffix}skip`;
        return [
          ...addDirs.map((dir) => ` if ${dirVar} = ${dir} then goto ${addLabel}`),
          ...subDirs.map((dir) => ` if ${dirVar} = ${dir} then goto ${subLabel}`),
          ` goto ${skipLabel}`,
          addLabel,
          ' asm',
          ...build16BitAddAsm(velVar, fracVar, rateVar),
          'end',
          ` goto ${skipLabel}`,
          subLabel,
          ' asm',
          ...build16BitSubAsm(velVar, fracVar, rateVar),
          'end',
          skipLabel,
        ];
      };
      const dispatch = isFine ?
        [
          ...buildFineAxisDispatch([1, 2, 3], [5, 6, 7], velocityXVar, velocityFracXVar, 'x'),
          ...buildFineAxisDispatch([3, 4, 5], [7, 0, 1], velocityYVar, velocityFracYVar, 'y'),
        ] :
        is16 ?
        DIRECTION16_STEPS.flatMap(([xStep, yStep], dir) => [
          ...(xStep ? [` if ${dirVar} = ${dir} then ${velocityXVar} = ${velocityXVar} ${xStep > 0 ? '+' : '-'} ` +
            `${Math.abs(xStep) === 1 ? rateVar : halfRateVar}`] : []),
          ...(yStep ? [` if ${dirVar} = ${dir} then ${velocityYVar} = ${velocityYVar} ${yStep > 0 ? '+' : '-'} ` +
            `${Math.abs(yStep) === 1 ? rateVar : halfRateVar}`] : []),
        ]) :
        [
          ` if ${dirVar} = 1 then ${velocityXVar} = ${velocityXVar} + ${rateVar}`,
          ` if ${dirVar} = 2 then ${velocityXVar} = ${velocityXVar} + ${rateVar}`,
          ` if ${dirVar} = 3 then ${velocityXVar} = ${velocityXVar} + ${rateVar}`,
          ` if ${dirVar} = 5 then ${velocityXVar} = ${velocityXVar} - ${rateVar}`,
          ` if ${dirVar} = 6 then ${velocityXVar} = ${velocityXVar} - ${rateVar}`,
          ` if ${dirVar} = 7 then ${velocityXVar} = ${velocityXVar} - ${rateVar}`,
          ` if ${dirVar} = 3 then ${velocityYVar} = ${velocityYVar} + ${rateVar}`,
          ` if ${dirVar} = 4 then ${velocityYVar} = ${velocityYVar} + ${rateVar}`,
          ` if ${dirVar} = 5 then ${velocityYVar} = ${velocityYVar} + ${rateVar}`,
          ` if ${dirVar} = 7 then ${velocityYVar} = ${velocityYVar} - ${rateVar}`,
          ` if ${dirVar} = 0 then ${velocityYVar} = ${velocityYVar} - ${rateVar}`,
          ` if ${dirVar} = 1 then ${velocityYVar} = ${velocityYVar} - ${rateVar}`,
        ];
      lines.push(
          ` if !${accelFlagsVar}{${activeBit}} then goto ${skipLabel}`,
          ...(is16 ? [
            ` ${halfRateVar} = ${rateVar} / 2`,
            ` if ${halfRateVar} = 0 then ${halfRateVar} = 1`,
          ] : []),
          ...dispatch,
          ' asm',
          ...buildSignedClampAsm(velocityXVar, maxSpeedVar, `${uid}x`),
          ...buildSignedClampAsm(velocityYVar, maxSpeedVar, `${uid}y`),
          'end',
          skipLabel,
      );
    }

    if (decelUsedFor.has(name)) {
      const rateVar = resolveVar(inertiaDecelRateVarName(name));
      const skipLabel = `_inertiadecel_${name}_skip`;
      // Auto-stop: once decelerate has clamped velocity all the way to
      // exactly 0 on both axes (buildDecelerateAsm/buildFineDecelerateAsm
      // both clamp AT zero, never past it - see their comments), there's
      // nothing left to decelerate, so this clears the active bit itself
      // instead of leaving Decelerate running (and re-checking already-zero
      // velocity) every frame forever until a "Stop" block runs. Reuses
      // skipLabel as the "still moving, leave it on" bail-out target - if
      // ANY of these checks finds a nonzero byte, it jumps straight past the
      // "clear the flag" line below to the same fallthrough point a
      // still-decelerating frame already reaches. Fine mode also has to
      // check both fractional bytes (a whole-pixel byte of 0 with leftover
      // sub-pixel velocity is still moving), not just the whole-pixel ones.
      const autoStopChecks = [velocityXVar, velocityYVar,
        ...(isFine ? [velocityFracXVar, velocityFracYVar] : [])]
          .map((v) => ` if ${v} <> 0 then goto ${skipLabel}`);
      lines.push(
          ` if !${decelFlagsVar}{${activeBit}} then goto ${skipLabel}`,
          ' asm',
          ...(isFine ? [
            ...buildFineDecelerateAsm(velocityXVar, velocityFracXVar, rateVar, `${uid}x`),
            ...buildFineDecelerateAsm(velocityYVar, velocityFracYVar, rateVar, `${uid}y`),
          ] : [
            ...buildDecelerateAsm(velocityXVar, rateVar, `${uid}x`),
            ...buildDecelerateAsm(velocityYVar, rateVar, `${uid}y`),
          ]),
          'end',
          ...autoStopChecks,
          ` ${decelFlagsVar}{${activeBit}} = 0`,
          skipLabel,
      );
    }

    if (isFine) {
      const posFracXVar = resolveVar(inertiaPosFracXVarName(name));
      const posFracYVar = resolveVar(inertiaPosFracYVarName(name));
      lines.push(
          ' asm',
          ...buildFinePositionStepAsm(`${name}x`, velocityXVar, velocityFracXVar, posFracXVar),
          ...buildFinePositionStepAsm(`${name}y`, velocityYVar, velocityFracYVar, posFracYVar),
          'end',
      );
    } else {
      lines.push(
          ` ${name}x = ${name}x + ${velocityXVar}`,
          ` ${name}y = ${name}y + ${velocityYVar}`,
      );
    }
  });
  return lines.join('\n') + '\n';
};

export default (Blockly) => {
  const createGeneratorForSprite = (name) => {
    Blockly.BBasic[`sprite_${name}_get`] = function(block) {
      // Variable getter.
      const code = Blockly.BBasic.nameDB_.getName(block.getFieldValue('VAR'),
          Blockly.VARIABLE_CATEGORY_NAME);
      return [code, Blockly.BBasic.ORDER_ATOMIC];
    };

    Blockly.BBasic[`sprite_${name}_set`] = function(block) {
      // Variable setter.
      const argument0 = Blockly.BBasic.valueToCode(block, 'VALUE',
          Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
      const varName = Blockly.BBasic.nameDB_.getName(
          block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);
      if (varName === 'ballwidth') {
        // Ball width packs into CTRLPF's  bits 4-5 - masked in against
        // CTRLPF's CURRENT value (207 = 0b11001111, clearing only bits 4-5)
        // rather than overwriting the whole byte, which used to also
        // hardcode bit 0 (playfield reflect) permanently on and reset bit 2
        // (playfield priority - see sprite_priority_set's own `CTRLPF{2} =`
        // bit-safe write just below) back to 0 every time ball width was
        // set - a real bug (reported as "changing sprite priority flips the
        // right half of the playfield," since whichever of the two blocks
        // ran later silently undid the other's  bit).
        //
        // Reads/writes the CTRLPF RAM shadow (see reserveCtrlpfShadowDevVar's
        // own comment for why the real hardware register can't be safely
        // read back), flushing it to the real CTRLPF right after. temp1
        // holds the multiply as its  statement rather than inline (not
        // the actual root cause of the playfield-flip bug, but still cheap
        // insurance against batari Basic's  documented history of
        // compound-expression bugs, e.g. RAND_OPTIONS ruling out division
        // combined with multiplication in one expression) - safe here, only
        // clobbered by drawscreen, which can't run mid-statement (see
        // score.js's  comment on the same convention).
        const shadowVar = Blockly.BBasic.nameDB_.getName(ctrlpfShadowVarName(),
            Blockly.Names.DEVELOPER_VARIABLE_TYPE);
        return `temp1 = (${argument0}) * 16\n` +
            `${shadowVar} = (${shadowVar} & 207) + temp1\n` +
            `CTRLPF = ${shadowVar}\n`;
      } else if (varName.endsWith('width')) {
        // Missile width packs into NUSIZ's  bits 4-5 as a 2-bit code
        // (0-3), not the pixel width itself - unlike ballwidth's  CTRLPF
        // branch just above (which exposes that raw 0-3 code directly),
        // this block takes the actual pixel width (1/2/4/8, the only values
        // real hardware supports) and converts it here, since typing the
        // real width a project actually wants is more intuitive than
        // remembering the code that produces it. Captured into temp1 first
        // (argument0 might be an arbitrary expression, not just a bare
        // literal) and compared against each of the 4 valid widths in turn -
        // temp2 starts at 0 (matching width 1, the code's  natural
        // "nothing set" value) and only needs updating for the other three;
        // any other width the project might pass in (not 1/2/4/8) falls
        // back to that same 0/1-pixel code rather than producing an
        // invalid NUSIZ pattern.
        const sizeVarName = varName.replace('width', 'size').replace('missile', 'player');
        return `temp1 = ${argument0}\n` +
            `temp2 = 0\n` +
            `if temp1 = 2 then temp2 = 1\n` +
            `if temp1 = 4 then temp2 = 2\n` +
            `if temp1 = 8 then temp2 = 3\n` +
            `temp2 = temp2 * 16\n` +
            `${sizeVarName} = (${sizeVarName} & $0F) + temp2\n`;
      } else if (varName.endsWith('visibility')) {
        const blockNumber = Blockly.BBasic.blockNumbers.next();
        const baseLabel = `_visibility_${blockNumber}`;

        const frameVarName = varName.replace('visibility', 'frame');
        return [
          `if ${argument0} then goto ${baseLabel}_visible else ${frameVarName} = 255 : goto ${baseLabel}_end`,
          `@ ${baseLabel}_visible`,
          `if ${frameVarName} = 255 then ${frameVarName} = 0`,
          `@ ${baseLabel}_end`,
        ].join('\n') + '\n\n';
      } else if (varName.endsWith('size_3_')) {
        const bitVarName = varName.replace('__', '').replace('_3_', '{3}');
        return `if ${argument0} then ${bitVarName} = 1 else ${bitVarName} = 0\n`;
      }
      return varName + ' = ' + argument0 + '\n';
    };

    Blockly.BBasic[`sprite_${name}_change`] = function(block) {
    // Add value do a variable.
      const argument0 = Blockly.BBasic.valueToCode(block, 'DELTA',
          Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
      const varName = Blockly.BBasic.nameDB_.getName(
          block.getFieldValue('VAR'), Blockly.VARIABLE_CATEGORY_NAME);
      const isNegativeConstant = /^\s*-\s*\d+\s*$/.test(argument0);
      const operator = isNegativeConstant ? '' : '+';
      return `${varName} = ${varName} ${operator} ${argument0}\n`;
    };
  };

  // Player 0/1 now share these six combined block types (sprite_player_size,
  // etc. - see PLAYER_OPTIONS' own comment in blocks/sprites.js), so this is
  // called once, not once per name (unlike createGeneratorForSprite/
  // createGeneratorForFireBall below, still per-name for Missile 0/1/Ball) -
  // each generator resolves which player THIS block instance is set to via
  // resolvePlayerName, reading the PLAYER field at generation time instead
  // of a closed-over name.
  const createGeneratorForPlayer = () => {
    const resolvePlayerName = (block) => `player${block.getFieldValue('PLAYER') === '1' ? '1' : '0'}`;

    // The dropdown already holds the animation's position in the list, which is
    // what the generated animation dispatch compares against - player-
    // independent (the shared animation pool), so no resolvePlayerName call
    // needed here at all.
    Blockly.BBasic['sprite_player_animation_select'] = function(block) {
      const index = block.getFieldValue('VAR') || '0';
      return [index, Blockly.BBasic.ORDER_ATOMIC];
    };

    Blockly.BBasic['sprite_player_size'] = function(block) {
      const name = resolvePlayerName(block);
      const size = block.getFieldValue('SIZE') || '0';
      const varName = name + 'size';
      return `${varName} = ${varName} & $F8\n` +
        `${varName} = ${varName} | ${size}\n`;
    };

    // Bit 6 of the size variable pauses the animation: the frame counter is
    // frozen while it is set. It is unused by NUSIZ, so it rides along
    // harmlessly when the size variable is loaded into the register.
    Blockly.BBasic['sprite_player_animation_playback'] = function(block) {
      const name = resolvePlayerName(block);
      const paused = block.getFieldValue('STATE') === 'pause';
      return `${name}size{6} = ${paused ? 1 : 0}\n`;
    };

    // player0pointer/player1pointer and player0height/player1height are
    // real batari Basic kernel symbols (confirmed directly against
    // public/bb19/includes/2600basic.h and std_kernel.asm) - plain,
    // already-defined zero-page RAM the standard kernel reads every
    // scanline as "lda (player0pointer),y" (y counting down from
    // player0height), the exact same mechanism the compiler's own
    // "player0: ... end" graphic-literal syntax sets up automatically
    // behind the scenes for every normal animation frame (see
    // generateAnimations in generators/bbasic.js). Every OTHER player
    // graphic in this app goes through that literal-bitmap path.
    //
    // This is only the TRIGGER - see this file's  top-of-block comment
    // (bug #2) for why the actual player0pointer/player0height writes live
    // in generateRomNoiseChecks instead, spliced into commongamelogic AFTER
    // generateAnimations'  per-frame reassignment. Stores into dev vars
    // (not a direct assignment) because the per-frame check has no block
    // context of its  to re-evaluate OFFSET/HEIGHT's expressions from -
    // same reasoning background_fade_to's  trigger stores its target/pace
    // into dev vars for generateBackgroundFadeChecks to read later.
    //
    // romNoiseUsedFor itself is populated by a pre-scan in bbasic.js's
    // init() (see reserveRomNoiseDevVars'  comment for why it has to be
    // known before this generator ever runs), not mutated here.
    Blockly.BBasic['sprite_player_rom_noise'] = function(block) {
      const name = resolvePlayerName(block);
      const resolveVar = (canonicalName) =>
        Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
      const offsetVar = resolveVar(romNoiseOffsetVarName(name));
      const heightVar = resolveVar(romNoiseHeightVarName(name));
      const flagsVar = resolveVar(romNoiseFlagsVarName());
      // Defaults to framecounter (already ticking every frame regardless
      // of anything else in the project) rather than a plain "0" fallback
      // - the whole point of this block is a shimmering, ever-changing
      // pattern with no setup required, and a fixed offset would instead
      // show the exact same static bytes forever until the user thought
      // to wire up their  changing value.
      const offset = Blockly.BBasic.valueToCode(block, 'OFFSET', Blockly.BBasic.ORDER_ASSIGNMENT) ||
        'framecounter';
      const height = Blockly.BBasic.valueToCode(block, 'HEIGHT', Blockly.BBasic.ORDER_ASSIGNMENT) || '8';
      return `${offsetVar} = ${offset}\n` +
        `${heightVar} = ${height}\n` +
        `${flagsVar}{${romNoiseActiveBit(name)}} = 1\n`;
    };

    // Clears the active flag sprite_${name}_rom_noise's  trigger sets -
    // see that block's  tooltip/comment for why this is needed at all:
    // generateRomNoiseChecks' per-frame override runs AFTER the animation
    // logic every frame and only ever gets turned ON by the trigger above,
    // never off, so without this there was no way back to a normal
    // animation frame once ROM noise had been used even once.
    // romNoiseUsedFor's  pre-scan in bbasic.js's init() treats this
    // block the same as the trigger above (either one on a player is
    // enough to reserve that player's dev vars), so the flag var is always
    // guaranteed to exist here.
    Blockly.BBasic['sprite_player_rom_noise_stop'] = function(block) {
      const name = resolvePlayerName(block);
      const resolveVar = (canonicalName) =>
        Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
      const flagsVar = resolveVar(romNoiseFlagsVarName());
      return `${flagsVar}{${romNoiseActiveBit(name)}} = 0\n`;
    };

    // Trigger for sprite_player_rainbow_colors - see this file's own
    // ROM_NOISE_COLOR_REGISTERS comment for the real kernel mechanism this
    // uses, and generateRainbowColorChecks for the per-frame write this
    // only primes (same trigger+check split as sprite_player_rom_noise's
    // own trigger, and for the same reason: this line alone would only ever
    // take effect for a single instant, not stick).
    Blockly.BBasic['sprite_player_rainbow_colors'] = function(block) {
      const name = resolvePlayerName(block);
      const resolveVar = (canonicalName) =>
        Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
      const offsetVar = resolveVar(rainbowColorOffsetVarName(name));
      const flagsVar = resolveVar(romNoiseFlagsVarName());
      const offset = Blockly.BBasic.valueToCode(block, 'OFFSET', Blockly.BBasic.ORDER_ASSIGNMENT) ||
        'framecounter';
      return `${offsetVar} = ${offset}\n` +
        `${flagsVar}{${rainbowColorActiveBit(name)}} = 1\n`;
    };

    // Clears the active flag sprite_player_rainbow_colors'  trigger
    // sets - see that block's  tooltip/comment for what this can and
    // can't undo. rainbowColorUsedFor's  pre-scan in bbasic.js's init()
    // treats this block the same as the trigger above, so the flag var is
    // always guaranteed to exist here.
    Blockly.BBasic['sprite_player_rainbow_colors_stop'] = function(block) {
      const name = resolvePlayerName(block);
      const resolveVar = (canonicalName) =>
        Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
      const flagsVar = resolveVar(romNoiseFlagsVarName());
      return `${flagsVar}{${rainbowColorActiveBit(name)}} = 0\n`;
    };
  };

  // Missile 0/1 now share this one combined block type (sprite_missile_size
  // - see MISSILE_OPTIONS' own comment in blocks/sprites.js, same "one
  // combined type with a dropdown field" treatment Player 0/1 already got),
  // so this is called once, not once per name - Ball has no equivalent
  // block at all (its  width is set through sprite_ball_set's own
  // "Width" option instead, see buildMissileOptions/writeOnlyOptions), so
  // there's no third name to worry about here the way createGeneratorFor
  // FireBall below has to.
  const createGeneratorForMissileSize = () => {
    Blockly.BBasic['sprite_missile_size'] = function(block) {
      const name = `missile${block.getFieldValue('MISSILE') === '1' ? '1' : '0'}`;
      const size = block.getFieldValue('SIZE') || 0;
      const varName = name.replace('missile', 'player') + 'size';
      return `${varName} = ${varName} & $0F\n` +
        `${varName} = ${varName} | ${size}\n`;
    };
  };

  // sprite_*_fire's trigger, plus sprite_*_bounce - shared by missile0/
  // missile1/ball (nothing here is missile-specific: ballx/bally are plain
  // bB vars exactly like missile0x/missile0y, and missileFireActiveBit/
  // missileFireDirVarName/missileFireSpeedVarName already cover 'ball' too).
  // registrationName is the block-type suffix to register under
  // (sprite_${registrationName}_fire/_bounce) - 'ball' for Ball's own
  // still-separate-from-Missile-0/1 blocks, 'missile' for the combined
  // Missile 0/1 type (see MISSILE_OPTIONS' own comment in blocks/
  // sprites.js). resolveName(block) resolves the REAL object name
  // ('missile0'/'missile1'/'ball') this particular block instance means,
  // read fresh every time a generator runs rather than closed over once -
  // Ball's  generator context passes a fixed () => 'ball' (nothing to
  // resolve, it never had a twin), Missile's reads the MISSILE dropdown
  // field.
  const createGeneratorForFireBall = (registrationName, resolveName) => {
    // TRIGGER only - see sprite_${name}_rom_noise's  top-of-block comment
    // for why a one-shot assignment here can't be the whole story:
    // generateMissileFireChecks (spliced into commongamelogic) does the
    // actual per-frame movement, reading these dev vars back every frame
    // until the missile goes off-screen. <angleExpr> is evaluated into
    // ${name}dir EXACTLY ONCE (not re-inlined below) since it can itself be
    // a real expression (e.g. the joystick 8-way direction getter's own
    // table lookup), not just a bare variable - see this block's own
    // tooltip. Always re-launches, even if a previous shot from this same
    // missile is still in flight (no "already active" guard) - confirmed
    // with the user: this block is meant to be placed behind its  rate
    // limiter (e.g. an "every X frames" block) rather than fire every
    // single frame it's reached, so every time it DOES run, it should
    // actually fire, resetting position to whatever X/Y it's given right
    // then (a moving X/Y, like a player's  position, naturally "resets
    // to current" this way with no special-casing needed). If the evaluated
    // angle is 255 ("no clear direction" - the joystick 8-way direction
    // getter's  value when the joystick is centered), falls back to the
    // block's own "default" dropdown (any of the 8 directions, user-picked -
    // see MISSILE_FIRE_DEFAULT_ANGLE_OPTIONS in blocks/sprites.js) rather
    // than skipping the launch - an idle joystick should still fire the
    // missile, not silently do nothing, and the direction that happens in
    // should be up to the user, not a single hardcoded choice.
    // missileFireUsedFor's  pre-scan in bbasic.js's init() treats this
    // block type as "in use" (same reasoning as romNoiseUsedFor), so every
    // dev var referenced here is always guaranteed to already exist.
    Blockly.BBasic[`sprite_${registrationName}_fire`] = function(block) {
      const name = resolveName(block);
      const resolveVar = (canonicalName) =>
        Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
      const dirVar = resolveVar(missileFireDirVarName(name));
      const speedVar = resolveVar(missileFireSpeedVarName(name));
      const flagsVar = resolveVar(missileFireFlagsVarName());
      const x = Blockly.BBasic.valueToCode(block, 'X', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
      const y = Blockly.BBasic.valueToCode(block, 'Y', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
      const angle = Blockly.BBasic.valueToCode(block, 'ANGLE', Blockly.BBasic.ORDER_ASSIGNMENT) || '255';
      // "default" only ever offers the 8 original compass points (see
      // MISSILE_FIRE_DEFAULT_ANGLE_OPTIONS in blocks/sprites.js) regardless
      // of "16 directions" - doubled here to land on the matching index of
      // the finer 0-15 scale (0=Up stays 0, 2=Right becomes 8, ...) so the
      // fallback always points the same real direction either way.
      const is16 = block.getFieldValue('DIRECTIONS16') === 'TRUE';
      const defaultAngle = (parseInt(block.getFieldValue('DEFAULT_ANGLE'), 10) || 0) * (is16 ? 2 : 1);
      const speed = block.getFieldValue('SPEED') || '1';
      const activeBit = missileFireActiveBit(name);
      // "throttle movement" - see this block's  tooltip and
      // resolveEnclosingFrameInterval's  comment. Write-only here
      // (see reserveMissileFireDevVars'  comment on why these two route
      // through the Superchip r/w pool), so only .write is ever needed.
      const throttlePair = Blockly.BBasic.superchipRwPairs[missileFireThrottleVarName(name)];
      const throttleResetPair = Blockly.BBasic.superchipRwPairs[missileFireThrottleResetVarName(name)];
      const interval = block.getFieldValue('THROTTLE') === 'TRUE' ?
        (resolveEnclosingFrameInterval(block) || 1) : 1;
      return `${dirVar} = ${angle}\n` +
        `if ${dirVar} = 255 then ${dirVar} = ${defaultAngle}\n` +
        `${name}x = ${x}\n` +
        `${name}y = ${y}\n` +
        `${speedVar} = ${speed}\n` +
        `${throttleResetPair.write} = ${interval}\n` +
        // Was "= 1", forcing the very FIRST step to fire after just 1
        // frame regardless of interval, before falling into the correct
        // every-${interval}-frames cadence from the second step onward -
        // seeded from the same interval instead, so the first step waits
        // the full interval too, same as every step after it.
        `${throttlePair.write} = ${interval}\n` +
        `${flagsVar}{${activeBit}} = 1\n`;
    };
  };

  // 'player'/'missile' register the combined sprite_player_get/set/change
  // and sprite_missile_get/set/change types (see PLAYER_OPTIONS'/
  // MISSILE_OPTIONS' own comments in blocks/sprites.js) -
  // createGeneratorForSprite's  get/set/change bodies only ever read
  // VAR's already-real-variable-name value, never `name` itself, so this
  // needs no changes beyond two extra names to register under.
  ['player', 'missile', 'ball'].forEach(createGeneratorForSprite);
  createGeneratorForPlayer();
  createGeneratorForMissileSize();
  // Ball keeps its  separate block type (never had a twin to combine
  // with - see createGeneratorForFireBall's  comment); Missile 0/1
  // share the combined 'missile' type, resolving which one a given block
  // instance means from its  MISSILE field.
  createGeneratorForFireBall('ball', () => 'ball');
  createGeneratorForFireBall('missile',
      (block) => `missile${block.getFieldValue('MISSILE') === '1' ? '1' : '0'}`);

  // Just captures the target/speed and sets the active bit for whichever
  // object OBJECT picks - the actual per-frame movement happens in
  // generateSeekChecks (spliced into commongamelogic), same "trigger block
  // sets dev vars + flag bit, a separate generate*Checks() does the
  // per-frame work" pattern sprite_${name}_fire's  trigger generator
  // already uses above. Unlike Fire (one block type per missile), this is a
  // single block for all 5 sprite names, with OBJECT as a dropdown - "name"
  // is read from that field instead of being fixed per block type, but
  // otherwise every dev var this reads/writes still comes from the exact
  // same per-name functions (seekXVarName/seekYVarName/seekSpeedVarName/
  // seekActiveBit) generateSeekChecks itself uses. seekUsedFor's own
  // pre-scan in bbasic.js's init() reads this same OBJECT field to know
  // which names are "in use" (same reasoning as missileFireUsedFor), so
  // every dev var referenced here is always guaranteed to already exist.
  Blockly.BBasic['object_seek_to'] = function(block) {
    const name = block.getFieldValue('OBJECT');
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const targetXVar = resolveVar(seekXVarName(name));
    const targetYVar = resolveVar(seekYVarName(name));
    const speedVar = resolveVar(seekSpeedVarName(name));
    const flagsVar = resolveVar(seekFlagsVarName());
    const x = Blockly.BBasic.valueToCode(block, 'X', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const y = Blockly.BBasic.valueToCode(block, 'Y', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const speed = Blockly.BBasic.valueToCode(block, 'SPEED', Blockly.BBasic.ORDER_ASSIGNMENT) || '1';
    const activeBit = seekActiveBit(name);
    // "throttle movement" - see this block's  tooltip and
    // resolveEnclosingFrameInterval's  comment. Write-only here (see
    // reserveSeekDevVars'  comment on why these two route through the
    // Superchip r/w pool), so only .write is ever needed.
    const throttlePair = Blockly.BBasic.superchipRwPairs[seekThrottleVarName(name)];
    const throttleResetPair = Blockly.BBasic.superchipRwPairs[seekThrottleResetVarName(name)];
    const interval = block.getFieldValue('THROTTLE') === 'TRUE' ?
      (resolveEnclosingFrameInterval(block) || 1) : 1;
    // Clears this object's own "arrived" bit (object_seek_arrived, if
    // watched) every time a new target is set - without this, the bit would
    // stay stuck true from a previous arrival even after re-triggering
    // toward a brand-new target that hasn't been reached yet.
    // seekArrivedWatches'  pre-scan (bbasic.js's init()) guarantees the
    // flags byte only actually exists when at least one object_seek_arrived
    // block is watching, so this only reads/writes it when that's the case.
    const arrivedWatches = Blockly.BBasic.seekArrivedWatches || new Set();
    const clearArrived = arrivedWatches.has(name) ?
      `${resolveVar(seekArrivedFlagsVarName())}{${seekArrivedBit(name)}} = 0\n` : '';
    return `${targetXVar} = ${x}\n` +
      `${targetYVar} = ${y}\n` +
      `${speedVar} = ${speed}\n` +
      `${throttleResetPair.write} = ${interval}\n` +
      // Same fix as sprite_*_fire's  trigger above - was "= 1", making
      // the first step happen after just 1 frame instead of the full
      // interval.
      `${throttlePair.write} = ${interval}\n` +
      `${flagsVar}{${activeBit}} = 1\n` +
      clearArrived;
  };

  // object_seek_arrived's  generator - a plain, always-current boolean
  // read of the arrived bit (same shape as background_fade_active's own
  // generator), NOT a watch-and-clear: this plugs into an "if" condition
  // socket as a value (per explicit request - "if (object) arrives at its
  // seek target do..."), so it can be read any number of times (or not at
  // all, if optimized away) without a read itself having a side effect.
  // generateSeekChecks sets this bit the moment this object's  Seek
  // reaches its target; object_seek_to's  generator above clears it again
  // the next time that object is given a new target.
  Blockly.BBasic['object_seek_arrived'] = function(block) {
    const name = block.getFieldValue('OBJECT');
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const flagBit = `${resolveVar(seekArrivedFlagsVarName())}{${seekArrivedBit(name)}}`;
    return [flagBit, Blockly.BBasic.ORDER_ATOMIC];
  };

  // Captures direction/rate/max speed and sets the accel-active bit for
  // whichever object OBJECT picks - the actual per-frame velocity update
  // happens in generateInertiaChecks (spliced into commongamelogic), same
  // "trigger block sets dev vars + flag bit" shape as object_seek_to above.
  // Direction is a plain 0-7 number input (not a fixed dropdown), same as
  // sprite_*_fire's  ANGLE - lets it be wired directly from a "Joystick
  // direction (8-way)" block for continuous joystick-driven thrust, not
  // just a literal.
  // ACTION dropdown (Start/Stop) - same shape as sprite_inertia_decelerate
  // below (was two separate block types before the combination - see the
  // block definition's comment). Stop clears the accel-active bit only -
  // velocity is left exactly where it is (holds at its current value
  // unless Decelerate is also on for this object), matching this feature's
  // "engine off, still coasting" framing rather than an instant stop -
  // DIRECTION/RATE/MAXSPEED are only meaningful (and only read) on Start,
  // same "don't disturb state Stop has no reason to touch" reasoning
  // sprite_inertia_decelerate's generator already uses.
  Blockly.BBasic['sprite_inertia_accelerate'] = function(block) {
    const name = block.getFieldValue('OBJECT');
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const flagsVar = resolveVar(inertiaAccelFlagsVarName());
    const activeBit = inertiaActiveBit(name);
    if (block.getFieldValue('ACTION') === 'stop') return `${flagsVar}{${activeBit}} = 0\n`;
    const dirVar = resolveVar(inertiaAccelDirVarName(name));
    const rateVar = resolveVar(inertiaAccelRateVarName(name));
    const maxSpeedVar = resolveVar(inertiaMaxSpeedVarName(name));
    const direction = Blockly.BBasic.valueToCode(block, 'DIRECTION', Blockly.BBasic.ORDER_ASSIGNMENT) || '0';
    const rate = Blockly.BBasic.valueToCode(block, 'RATE', Blockly.BBasic.ORDER_ASSIGNMENT) || '1';
    const maxSpeed = Blockly.BBasic.valueToCode(block, 'MAXSPEED', Blockly.BBasic.ORDER_ASSIGNMENT) || '127';
    return `${dirVar} = ${direction}\n` +
      `${rateVar} = ${rate}\n` +
      `${maxSpeedVar} = ${maxSpeed}\n` +
      `${flagsVar}{${activeBit}} = 1\n`;
  };

  // ACTION dropdown (Start/Stop) - same shape as
  // text_minikernel_scroll_control's  single-block-multiple-actions
  // convention. RATE is only meaningful (and only read) on Start - Stop
  // just clears the bit, leaving whatever rate was last set untouched for
  // the next Start (same "don't disturb state Stop has no reason to
  // touch" reasoning collision_check_position/scroll_control already use
  // elsewhere in this codebase).
  Blockly.BBasic['sprite_inertia_decelerate'] = function(block) {
    const name = block.getFieldValue('OBJECT');
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const flagsVar = resolveVar(inertiaDecelFlagsVarName());
    const activeBit = inertiaActiveBit(name);
    const action = block.getFieldValue('ACTION');
    if (action === 'stop') return `${flagsVar}{${activeBit}} = 0\n`;
    const rateVar = resolveVar(inertiaDecelRateVarName(name));
    const rate = Blockly.BBasic.valueToCode(block, 'RATE', Blockly.BBasic.ORDER_ASSIGNMENT) || '1';
    return `${rateVar} = ${rate}\n` +
      `${flagsVar}{${activeBit}} = 1\n`;
  };

  // Reflects whichever movement system(s) the chosen object actually uses
  // off of whatever it just collided with - Fire's  fired direction
  // (missile0/1/ball only) AND/OR Inertia's  velocity (any of the 5
  // names), sharing ONE stage/frame progression between them (see
  // missileBounceStageVarName's  comment - "how many consecutive stuck
  // frames" isn't specific to either representation). Neither true (an
  // object using neither Fire nor Inertia) still emits the frame/stage
  // bookkeeping but reflects nothing - harmless no-op, same as this
  // block's  tooltip documents.
  //
  // Matches the real 1977 Combat cartridge's  missile-bounce routine
  // (COLMPF/COLMPFX/Rev180/Bump180 in atariage.com's "Definitive Combat
  // Disassembly", $F4A6-$F4CD) stage-for-stage, not just "3 guesses then
  // give up" in spirit - Stella genuinely has no idea which wall/edge was
  // actually hit, so it can't compute a correct reflection on the first
  // try, and neither can this:
  //
  //   Stage 1 (dirVar/frameVar just went from "not stuck" to "stuck this
  //   frame", stageVar 0 -> 1): mirror the CURRENT heading across a
  //   vertical wall (dirVar = N - dirVar), the routine's  first guess.
  //   Combat then nudges the result off any exact compass point (N/E/S/W)
  //   by one step - a mirror of a purely-vertical heading (dirVar 0 or
  //   N/2) is a no-op (0 and N/2 are their  negation on this scale),
  //   which would make this stage look like nothing happened; the original
  //   game avoids that dead-looking case (and any other exact-axis result)
  //   by always nudging 22.5 degrees off it. dirVar is on a 0 to (N-1)
  //   clockwise-from-Up scale, N=8 or N=16 depending on
  //   missileFire16UsedFor - "exact compass point" is a multiple of N/4 on
  //   that scale.
  //
  //   Stage 2 (still stuck one frame later, stageVar 1 -> 2): add 180
  //   degrees (N/2) to WHATEVER stage 1 just left in dirVar (not a fresh
  //   mirror of the original heading) - Combat's  Rev180/Bump180 reads
  //   DIRECTN directly, already holding stage 1's result. Composing "mirror
  //   vertical" with "+180" is algebraically a horizontal-wall mirror of
  //   the original, so this still reads as "try the other wall orientation
  //   next" - it's just computed as a delta from stage 1, matching Combat
  //   exactly (and inheriting stage 1's off-axis nudge for free).
  //
  //   Stage 3 (still stuck a SECOND frame later, stageVar 2 -> 3): do
  //   nothing at all - Combat's  MxPFcount=$02 case, a deliberate grace
  //   frame giving the object one more chance to clear the wall pixel on
  //   its current (stage 2) heading before giving up.
  //
  //   Stage 4+ (still stuck a THIRD frame later, stageVar 3 and up): give
  //   up guessing and reverse the ORIGINAL pre-collision heading outright
  //   (dirVar = origDirVar + N/2), assuming a corner - and keep reapplying
  //   that same reversed heading every frame for as long as the collision
  //   keeps being reported, exactly like Combat's own "or higher" case.
  //
  // velocityX/Y need no angle math at all - two's-complement negation is
  // just "0 - x" (6502 SBC produces the identical bit pattern whether the
  // byte is read as signed or unsigned, not a special case) - so this
  // mirrors the same 4-stage timing (vertical mirror / +180 from stage 1's
  // result / grace frame / corner-reverses-the-original) using plain X/Y
  // negation instead of dirVar arithmetic. There's no equivalent to
  // Combat's off-axis nudge for a raw velocity component (an angle scale
  // has a natural "smallest step" to nudge by; a signed pixel/frame value
  // doesn't), so a sprite using ONLY Inertia (no Fire) can still see a
  // stage-1 mirror that looks like a no-op if the axis being flipped was
  // already 0 - stage 2 (the other axis) still fires normally the frame
  // after, same fallback Combat itself effectively relies on.
  //
  // "Still stuck" vs. "a brand new collision" is told apart by frameVar
  // (the framecounter value at the last Bounce call) - any gap other than
  // exactly 1 frame resets stageVar back to 0. reserveMissileBounceDevVars
  // (bbasic.js's  init()) guarantees stageVar/frameVar/origDirVar (if
  // hasFire)/origVelocityX/Y (if hasInertia) already exist here.
  Blockly.BBasic['object_bounce'] = function(block) {
    const name = block.getFieldValue('OBJECT');
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const hasFire = (Blockly.BBasic.missileFireUsedFor || new Set()).has(name);
    const hasInertia = (Blockly.BBasic.inertiaUsedFor || new Set()).has(name);
    // stageVar/frameVar (and, when used, origDirVar/origVelocityX/Y below)
    // are routed through the Superchip r/w pool now - see
    // reserveMissileBounceDevVars' comment. {read, write} pair either way
    // (that pool's fallback returns the same symbol for both when
    // Superchip is off), so every access below has to pick whichever side
    // matches its position, same as any other reserveDevVarRW consumer.
    const stagePair = Blockly.BBasic.superchipRwPairs[missileBounceStageVarName(name)];
    const framePair = Blockly.BBasic.superchipRwPairs[missileBounceFrameVarName(name)];
    const blockNumber = Blockly.BBasic.blockNumbers.next(`bounce_${name}`);
    const stage1Label = `_bounce_${name}_${blockNumber}_s1`;
    const stage2Label = `_bounce_${name}_${blockNumber}_s2`;
    const stage3Label = `_bounce_${name}_${blockNumber}_s3`;
    const stage4Label = `_bounce_${name}_${blockNumber}_s4`;
    const doneLabel = `_bounce_${name}_${blockNumber}_done`;

    const fireLines = {stage1: [], stage2: [], stage4: []};
    if (hasFire) {
      const dirVar = resolveVar(missileFireDirVarName(name));
      const origDirPair = Blockly.BBasic.superchipRwPairs[missileBounceOrigDirVarName(name)];
      const steps = (Blockly.BBasic.missileFire16UsedFor || new Set()).has(name) ? 16 : 8;
      const half = steps / 2;
      // "Exact compass point" (N/E/S/W) is a multiple of steps/4 on this
      // 0..steps-1 scale - equivalently, its low log2(steps/4) bits are all
      // 0. Tested bit-by-bit (var{n} && var{n} ...) instead of a single
      // masked comparison (var & mask = 0) since this codebase has no
      // existing precedent for bitwise "&" mixed with a comparison inside
      // one bB expression, and bit-index reads are already this codebase's
      // established way to test individual bits (see e.g. background.js's
      // fade-flag checks).
      const quarterBits = Math.log2(steps / 4);
      const offAxisTest = Array.from({length: quarterBits}, (_, i) => `!${dirVar}{${i}}`).join(' && ');
      fireLines.stage1 = [
        ` ${origDirPair.write} = ${dirVar}`,
        ` ${dirVar} = ${steps} - ${dirVar}`,
        ` if ${dirVar} = ${steps} then ${dirVar} = 0`,
        // Nudge off any exact compass point (N/E/S/W), matching Combat's
        // "AND #$03 / BNE / INC" jigger.
        ` if ${offAxisTest} then ${dirVar} = ${dirVar} + 1`,
      ];
      fireLines.stage2 = [
        ` ${dirVar} = ${dirVar} + ${half}`,
        ` if ${dirVar} >= ${steps} then ${dirVar} = ${dirVar} - ${steps}`,
      ];
      fireLines.stage4 = [
        ` ${dirVar} = ${origDirPair.read} + ${half}`,
        ` if ${dirVar} >= ${steps} then ${dirVar} = ${dirVar} - ${steps}`,
      ];
    }

    const inertiaLines = {stage1: [], stage2: [], stage4: []};
    if (hasInertia) {
      const velocityXVar = resolveVar(inertiaVelocityXVarName(name));
      const velocityYVar = resolveVar(inertiaVelocityYVarName(name));
      const origVelocityXPair = Blockly.BBasic.superchipRwPairs[missileBounceOrigVelocityXVarName(name)];
      const origVelocityYPair = Blockly.BBasic.superchipRwPairs[missileBounceOrigVelocityYVarName(name)];
      const isFine = (Blockly.BBasic.inertiaFineUsedFor || new Set()).has(name);
      if (!isFine) {
        inertiaLines.stage1 = [
          ` ${origVelocityXPair.write} = ${velocityXVar}`,
          ` ${origVelocityYPair.write} = ${velocityYVar}`,
          ` ${velocityXVar} = 0 - ${velocityXVar}`,
        ];
        inertiaLines.stage2 = [
          ` ${velocityXVar} = ${origVelocityXPair.read}`,
          ` ${velocityYVar} = 0 - ${origVelocityYPair.read}`,
        ];
        inertiaLines.stage4 = [
          ` ${velocityXVar} = 0 - ${origVelocityXPair.read}`,
          ` ${velocityYVar} = 0 - ${origVelocityYPair.read}`,
        ];
      } else {
        // Fine mode: velocity is a 16-bit [velocityXVar:velocityFracXVar]
        // fixed-point pair (see inertiaVelocityFracXVarName's comment) -
        // negating just the whole-pixel byte would leave the fractional
        // byte pointing the wrong way (e.g. -1.75 negated that way gives
        // +2.25, not +1.75), so this always negates the FULL pair via
        // build16BitNegateAsm. RW-pool vars (origVelocityXPair etc) can't
        // take part in a carry chain directly (different physical read/
        // write addresses - see build16BitNegateAsm's comment), so a
        // restore always copies the snapshot into the ordinary velocity
        // vars first, then negates those in place, rather than negating
        // straight out of the snapshot. The fractional snapshot
        // (origVelocityFracXPair etc) is genuinely required, not just a
        // nice-to-have: it's what lets a bounced object keep moving
        // slower than 1px/frame instead of snapping back up to
        // whole-pixel speed on every bounce.
        const velocityFracXVar = resolveVar(inertiaVelocityFracXVarName(name));
        const velocityFracYVar = resolveVar(inertiaVelocityFracYVarName(name));
        const origVelocityFracXPair = Blockly.BBasic.superchipRwPairs[missileBounceOrigVelocityFracXVarName(name)];
        const origVelocityFracYPair = Blockly.BBasic.superchipRwPairs[missileBounceOrigVelocityFracYVarName(name)];
        // "@end" (not a bare "end") to close each asm block here - this
        // whole generator (unlike generateInertiaChecks/build16BitNegateAsm's
        // other callers) is a normal per-block generator, so its return
        // value passes through Blockly.BBasic.normalizeIndents(), which
        // replaces EVERY line's leading whitespace with one fixed indent
        // string, not just adds to it - collapsing "asm"/"end"'s deliberate
        // 1-space-vs-0-space difference into two IDENTICALLY-indented lines.
        // 2600basic's asm-block parser needs "end" strictly less
        // indented than "asm" to recognize it as the close, so an
        // equally-indented "end" gets swallowed as if it were still raw
        // asm content - and everything bB-generated after it, for the rest
        // of the file, keeps being emitted as literal, untranslated text
        // instead of real bBasic, cascading into exactly this shape of
        // failure. "@end" survives normalizeIndents' OWN special-case
        // handling (stripped straight to column 0, same as "@label"
        // definitions), matching the same fix already used for this exact
        // reason in generateRunOnceEdgeReset. Confirmed directly as the
        // real cause of a reported build failure ("Unknown Mnemonic 'sta
        // TextColor'" plus a long cascade, only when Fine mode is on):
        // reproduced via a standalone compile of the user's exact project,
        // and confirmed fixed by this exact change.
        inertiaLines.stage1 = [
          ` ${origVelocityXPair.write} = ${velocityXVar}`,
          ` ${origVelocityFracXPair.write} = ${velocityFracXVar}`,
          ` ${origVelocityYPair.write} = ${velocityYVar}`,
          ` ${origVelocityFracYPair.write} = ${velocityFracYVar}`,
          ' asm',
          ...build16BitNegateAsm(velocityXVar, velocityFracXVar),
          '@end',
        ];
        inertiaLines.stage2 = [
          ` ${velocityXVar} = ${origVelocityXPair.read}`,
          ` ${velocityFracXVar} = ${origVelocityFracXPair.read}`,
          ` ${velocityYVar} = ${origVelocityYPair.read}`,
          ` ${velocityFracYVar} = ${origVelocityFracYPair.read}`,
          ' asm',
          ...build16BitNegateAsm(velocityYVar, velocityFracYVar),
          '@end',
        ];
        inertiaLines.stage4 = [
          ` ${velocityXVar} = ${origVelocityXPair.read}`,
          ` ${velocityFracXVar} = ${origVelocityFracXPair.read}`,
          ` ${velocityYVar} = ${origVelocityYPair.read}`,
          ` ${velocityFracYVar} = ${origVelocityFracYPair.read}`,
          ' asm',
          ...build16BitNegateAsm(velocityXVar, velocityFracXVar),
          ...build16BitNegateAsm(velocityYVar, velocityFracYVar),
          '@end',
        ];
      }
    }

    return [
      // "Still the same collision, one frame later" check - frameVar is
      // advanced to what it'd need to equal for a genuine one-frame gap
      // FIRST, compared, THEN overwritten with the real framecounter value
      // for next time - byte-wrapping (0/255 rollover) falls out of this
      // correctly for free, no special case needed.
      ` ${framePair.write} = ${framePair.read} + 1`,
      ` if ${framePair.read} <> framecounter then ${stagePair.write} = 0`,
      ` ${framePair.write} = framecounter`,
      ` if ${stagePair.read} = 0 then goto ${stage1Label}`,
      ` if ${stagePair.read} = 1 then goto ${stage2Label}`,
      ` if ${stagePair.read} = 2 then goto ${stage3Label}`,
      ` goto ${stage4Label}`,
      `@ ${stage1Label}`,
      ...fireLines.stage1,
      ...inertiaLines.stage1,
      ` ${stagePair.write} = 1`,
      ` goto ${doneLabel}`,
      `@ ${stage2Label}`,
      ...fireLines.stage2,
      ...inertiaLines.stage2,
      ` ${stagePair.write} = 2`,
      ` goto ${doneLabel}`,
      // Combat's deliberate "do nothing" grace frame (MxPFcount=$02) -
      // gives the object one more frame to clear the wall on stage 2's
      // heading before stage 4 gives up on it.
      `@ ${stage3Label}`,
      ` ${stagePair.write} = 3`,
      ` goto ${doneLabel}`,
      `@ ${stage4Label}`,
      ...fireLines.stage4,
      ...inertiaLines.stage4,
      ` ${stagePair.write} = 3`,
      `@ ${doneLabel}`,
    ].join('\n') + '\n';
  };

  // Bit 2 of CTRLPF. Set through the bit-index syntax on the CTRLPF RAM
  // shadow (see reserveCtrlpfShadowDevVar's  comment - real CTRLPF can't
  // be safely read back), not a full assignment, so it doesn't clobber the
  // other bits sprite_ball_set already packs into the shadow (reflection,
  // ball width) - then flushed to the real CTRLPF right after.
  Blockly.BBasic['sprite_priority_set'] = function(block) {
    const value = block.getFieldValue('VALUE');
    const shadowVar = Blockly.BBasic.nameDB_.getName(ctrlpfShadowVarName(),
        Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    return `${shadowVar}{2} = ${value}\n` +
        `CTRLPF = ${shadowVar}\n`;
  };

  // Player 0/1's color fade trigger - same shared mechanism as Background's
  // own "Fade color to" (see emitColorFadeTrigger in generators/bbasic/
  // background.js), just targeting player0realcolor/player1realcolor
  // (whichever the VAR dropdown picked) instead of COLUBK/COLUPF. This is
  // set up by background.js's  init(), which always runs before this file's
  // (see the registration order in generators/bbasic.js), so
  // Blockly.BBasic.emitColorFadeTrigger already exists by the time this runs.
  Blockly.BBasic['sprite_player_fade_to'] = function(block) {
    const rawVar = block.getFieldValue('VAR');
    const color = Blockly.BBasic.valueToCode(block, 'VALUE', Blockly.BBasic.ORDER_NONE) || '0';
    const frames = Blockly.BBasic.valueToCode(block, 'FRAMES', Blockly.BBasic.ORDER_NONE) || '1';
    return Blockly.BBasic.emitColorFadeTrigger(rawVar, color, frames);
  };

  // Player 0/1's  fade-finished watch - same shared mechanism as
  // Background's own "When ... color has finished fading" (see
  // emitFadeFinishedWatch in generators/bbasic/background.js).
  Blockly.BBasic['sprite_player_fade_finished'] = function(block) {
    return Blockly.BBasic.emitFadeFinishedWatch(block, block.getFieldValue('VAR'));
  };

  // Plain boolean read of the active bit - same shape as background_fade_
  // active's  generator (see generators/bbasic/background.js).
  Blockly.BBasic['sprite_player_fade_active'] = function(block) {
    const rawVar = block.getFieldValue('VAR');
    const resolveVar = (canonicalName) =>
      Blockly.BBasic.nameDB_.getName(canonicalName, Blockly.Names.DEVELOPER_VARIABLE_TYPE);
    const activeBit = `${resolveVar(fadeFlagsVarName(rawVar))}{${fadeActiveBit(rawVar)}}`;
    return [activeBit, Blockly.BBasic.ORDER_ATOMIC];
  };
};
