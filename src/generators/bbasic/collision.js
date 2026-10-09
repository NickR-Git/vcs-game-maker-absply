'use strict';

// Names of the hidden bytes each player's collision-check block backs up its
// pre-move position into (see bbasic.js's pre-scan, which pushes these
// into defvars only for whichever player actually uses the block, and this
// file's generator, which reads the position back out of them the
// following frame). Shared as functions (not inline template literals) so
// both places agree on the exact same name.
export const collisionMoveOldXVar = (playerNum) => `collisionOldX${playerNum}`;
export const collisionMoveOldYVar = (playerNum) => `collisionOldY${playerNum}`;
// A collisionMoveOldSizeVar (snapshotting/reverting player{N}size alongside
// X/Y) used to exist here - removed after confirming it never actually
// worked: player{N}size (NUSIZ) is a value the user's animation/size-
// changing blocks re-derive from player{N}animation/player{N}frame every
// frame, which this block never touched, so whatever code ran after it (or
// the very same animation logic that widened the sprite in the first place)
// just overwrote the "reverted" size again before drawscreen ever ran - the
// snapshot/restore had no lasting effect. There was never a way to make a
// SIZE revert stick given how NUSIZ is actually (re)computed, so that angle
// was dropped entirely rather than chased further.
//
// A reactive, software pfread()-based axis-aware version of this block (only
// reverting whichever of X/Y actually still overlapped the playfield, so a
// diagonal move into a wall could slide along it) was also tried here and
// fully reverted, after it caused two separate real bugs on an actual
// project: a ROM lockup (an out-of-range playfield row index from the box
// math, since fixed but apparently not the only issue) and, afterward, a
// hard crash on contact that persisted even after that fix. A further
// predictive, per-direction "move if clear" version (checking before moving
// instead of reverting after, closely modeled on a working reference
// example) was also tried and reverted - it moved correctly, but caused a
// screen roll on any joystick input, still unresolved. Given this exact
// class of collision code has now broken in more than one way across
// several attempts (see the even earlier predictive, run-every-frame
// version's screen-roll failure, previously reverted too - git history
// on this file has the full account), this block is back to the simple,
// originally-shipped behavior below: revert X and Y together,
// unconditionally, on any collision - it stops a diagonal move dead at a
// wall instead of sliding along it, but it's the one version of this that's
// actually held up.

// The DPC+ kernel's hardware collision only knows Player 0, Player 1 (which stands for all the virtual sprites,
// Player 1 to 9, together), the missiles, the ball and the playfield. Collisions with Players 2 to 9 are the hardware
// check against Player 1 narrowed down by comparing bounding boxes, the way the batari Basic DPC+ collision example
// does. Two virtual sprites never collide in hardware at all, so for those it is the boxes alone.
const boundingBox = (name) => {
  if (/^player\d$/.test(name)) return {x: `${name}x`, y: `${name}y`, width: 8, height: `${name}height`};
  if (name === 'ball') return {x: 'ballx', y: 'bally', width: 2, height: 'ballheight'};
  return {x: `${name}x`, y: `${name}y`, width: 2, height: `${name}height`};
};
const boxesOverlap = (a, b) => {
  const first = boundingBox(a);
  const second = boundingBox(b);
  return `(${first.y} + ${first.height}) >= ${second.y} && ${first.y} <= (${second.y} + ${second.height}) && ` +
    `(${first.x} + ${first.width}) >= ${second.x} && ${first.x} <= (${second.x} + ${second.width})`;
};
const isExtraPlayer = (name) => /^player[2-9]$/.test(name);

export default (Blockly) => {
  Blockly.BBasic[`collision_get`] = function(block) {
    const var0 = Blockly.BBasic.nameDB_.getName(block.getFieldValue('VAR0'),
        Blockly.VARIABLE_CATEGORY_NAME);
    const var1 = Blockly.BBasic.nameDB_.getName(block.getFieldValue('VAR1'),
        Blockly.VARIABLE_CATEGORY_NAME);

    if (var0 !== var1 && (isExtraPlayer(var0) || isExtraPlayer(var1))) {
      const [extra, other] = isExtraPlayer(var0) ? [var0, var1] : [var1, var0];
      if (other === 'playfield') return [`collision(playfield, player1)`, Blockly.BBasic.ORDER_ATOMIC];
      const boxes = boxesOverlap(extra, other);
      // Another virtual sprite has no hardware collision with these, only the boxes can tell.
      const code = /^player[1-9]$/.test(other) ? boxes : `collision(${other}, player1) && ${boxes}`;
      return [code, Blockly.BBasic.ORDER_LOGICAL_AND];
    }
    const code = var0 === var1 ? 'true' :
      `collision(${var0}, ${var1})`;

    return [code, Blockly.BBasic.ORDER_ATOMIC];
  };

  // One-frame-delayed hardware-collision "backtrack" check - no movement of
  // its, and no extra drawscreen: bBasic's kernel already clears the
  // TIA collision latches every frame as part of "drawscreen" (its version of
  // CXCLR), and its "collision()" builtin already wraps reading them
  // (CXP0FB/CXP1FB) - so checking collision() at the START of a frame, BEFORE
  // this frame's movement blocks run, reads the result of LAST frame's
  // movement and undoes it if it collided. Place this ahead of whatever
  // joystick/movement blocks already move the player (e.g. from the Sprites
  // category) in the same event - it only backs up and restores position, it
  // never moves the player itself.
  //
  // This checks X and Y together (both revert if either axis collided), not
  // separately - CXP0FB/CXP1FB is a single combined bit with no way to tell
  // which axis caused an overlap directly from hardware, and every software
  // attempt at doing that separately has broken in a real, different way
  // each time it's been tried (see this file's top-of-file comment for
  // the account) - stops dead at a wall instead of sliding along it, but
  // it's the one version of this that's actually held up.
  Blockly.BBasic['collision_check_position'] = function(block) {
    const playerNum = block.getFieldValue('PLAYER');
    const player = `player${playerNum}`;
    // collisionMoveOldXVar/YVar now route through reserveDevVarRW
    // (generators/bbasic.js's init()) - a plain lookup here, already
    // reserved during init(), same "already reserved by the time any
    // generator runs" timing as every other reserveDevVarRW consumer (see
    // its comment there).
    const oldXPair = Blockly.BBasic.superchipRwPairs[collisionMoveOldXVar(playerNum)];
    const oldYPair = Blockly.BBasic.superchipRwPairs[collisionMoveOldYVar(playerNum)];
    const blockNumber = Blockly.BBasic.blockNumbers.next(`collision_check_position_${playerNum}`);
    const revertLabel = `_collision_check_${playerNum}_${blockNumber}_revert`;
    const doneLabel = `_collision_check_${playerNum}_${blockNumber}_done`;
    return [
      // Players 2 to 9 have no hardware collision: the Player 1 flag stands for all the virtual sprites.
      `if collision(${isExtraPlayer(player) ? 'player1' : player}, playfield) then goto ${revertLabel}`,
      `goto ${doneLabel}`,
      `@ ${revertLabel}`,
      `${player}x = ${oldXPair.read}`,
      `${player}y = ${oldYPair.read}`,
      `@ ${doneLabel}`,
      `${oldXPair.write} = ${player}x`,
      `${oldYPair.write} = ${player}y`,
    ].join('\n') + '\n';
  };
};
