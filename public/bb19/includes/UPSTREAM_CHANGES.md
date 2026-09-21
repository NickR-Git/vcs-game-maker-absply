# Changes from stock batari Basic 1.9

This directory is vendored from the real bB 1.9 distribution (see the top
comment in `src/hooks/bb-compiler.js`). Everything here should match stock
bB byte-for-byte *except* the changes tracked below - keeping this list
accurate is what lets any of them be proposed back upstream later without
having to re-diff the whole tree by hand.

## `std_kernel.asm`: `ball_blank_lines` kernel option

**What no_blank_lines actually does:** the real bB manual is explicit:
`no_blank_lines` is "No gaps in PF blocks. Cost: loss of missile0." It is
**not** about giving missile0 finer per-scanline resolution as a sprite (an
earlier version of this writeup assumed that, and was wrong). The gap fix
and the missile0 cost are two separate consequences of the same `ifconst
no_blank_lines` symbol:

- **The gap fix** comes from which row-transition code path gets used.
  `altkernel2` (only assembled when `no_blank_lines` is set) recomputes the
  row height with no extra padding. `altkernel` (the default path) has an
  equivalent recompute gated behind an explicit `sleep 10` first - a real
  timing difference between the two paths, likely the actual source of the
  documented gap.
- **Losing missile0** is a separate effect of the same symbol also gating
  the per-scanline dispatch (missile0's height/`ENAM0` math there, vs.
  paddle-read/pfcolors/generic `sleep 12` filler when `no_blank_lines` is
  set) - bundled by the original kernel authors under one flag, not because
  either effect requires the other.

**First attempt (reverted) and why:** an earlier version of this feature
tried to fully duplicate no_blank_lines' gap-fixing mechanism
(`altkernel2ball`, a copy of `altkernel2`, plus a duplicated fast
`lastkernelline` tail variant) under a separate `ball_blank_lines` symbol,
so it wouldn't have to pull in no_blank_lines' missile0 cost. **This did
not actually eliminate the gaps when tested against a real build** - thin
lines still appeared between every playfield row, same as with blank lines
shown normally. The hand-duplicated path was never fully verified to
reproduce the real mechanism correctly, and re-deriving 6502 cycle-exact
kernel logic by static reading alone had already produced multiple wrong
theories earlier in this feature's development - not something to keep
guessing at blindly. Reverted in favor of the current, much smaller and
safer design below.

**What `ball_blank_lines` does now:** reuses the REAL, proven
`no_blank_lines` mechanism as-is (emitted as a genuine `set kernel_options
no_blank_lines`, going through 2600basic.wasm's full, tested handling - not
a hand-rolled substitute) for the gap fix, and only changes ONE thing:
which object gets the per-scanline filler slot stock `no_blank_lines`
otherwise gives to nothing (a plain `sleep 12`/paddle-read/pfcolors filler,
with missile0 simply not drawn there at all). `ball_blank_lines` adds one
more alternative to that existing filler chain, giving the ball (`ENABL`)
that slot instead of leaving it idle - so missile0 stays available as a
normal (coarse, once-per-row) object, unlike stock `no_blank_lines` alone.

Useful specifically on a project with `pfcolors` off and a single solid
playfield color: the ball always draws in `COLUPF` (it has no color
register of its own), so its fill pixels already match a solid playfield
with no extra color-register juggling - a missile drawn for the same
purpose would show in its parent player's color instead.

`ball_blank_lines` itself is **not** a real `kernel_options` value -
2600basic.wasm validates `set kernel_options` against an embedded
combination table and rejects anything not on it outright ("Options unknown
or invalid", confirmed by a real failed build) - so it's defined as a plain
`const ball_blank_lines = 1` line instead, the same mechanism
`pfres`/`pfrowheight` already use for their std_kernel.asm-only `ifconst`
symbols that also aren't real `kernel_options` entries. It's always emitted
ALONGSIDE a real `no_blank_lines` on the `kernel_options` line (see the
comment in `generators/bbasic.js`) - `no_blank_lines` itself still does all
the real work of eliminating the gaps; `ball_blank_lines` only redirects
the one filler slot.

**Where:** `std_kernel.asm`, inside the stock `ifconst no_blank_lines`
branch's filler-selection chain (the readpaddle/pfcolors/kernelmacro/
`sleep 12` decision) - search for `ball_blank_lines`. A single `ifconst
ball_blank_lines ... else <stock filler chain, byte-for-byte unchanged>
endif` wraps that one slot; every other line in the file, including
`altkernel2` and both `lastkernelline` variants, is untouched. With
`ball_blank_lines` undefined (the default for every existing project),
compiled output is byte-identical to stock.

**Cycle accounting:** reuses `lda ballheight / dcp bally / sbc temp4 / sta
ENABL` verbatim from this same file's `lastkernelline` tail section -
already proven-correct stock code, not new math (`temp4` holds
`ballheight+2`, set once near the top of the kernel and untouched until the
tail section, the ball-side equivalent of `stack1`/`missile0height+2`).
That costs 14 cycles versus this slot's stock "no other filler" `sleep12`
cost of 12 - made up by jumping to `continuekernel2` instead of
`continuekernel` on the way back (skipping `continuekernel`'s `sleep 2`),
the same technique the readpaddle sub-case just above it already uses for
the same reason.

**Status: needs a real rebuild/retest.** The gap-elimination itself is now
just stock `no_blank_lines`, unmodified and already proven - the only new
code is the filler-slot swap, verified by hand against the stock kernel's
already-cycle-matched branches, but not yet re-confirmed against a real
build since this revision. If the ball's fill pixels don't show up (or
missile0 doesn't behave as a normal object) with `ball_blank_lines` on,
that filler-slot swap is the first place to look.

**Wiring:** `src/generators/bbasic.js` (`generateConfiguration`,
`ballBlankLinesConfigurationCode`) and `src/views/Configuration.vue` (the
"Fill blank lines with the ball instead of missile0" switch, directly under
"Show blank lines"). Only emitted with `pfcolors` off. Works automatically
with no Ball blocks needed for the gap fix itself (that part is pure stock
`no_blank_lines`) - a Ball block is only needed if you also want the ball
visibly doing something with that per-scanline slot.

**Not yet done:** `std_kernel_vertical_reflect.asm` (the other kernel
variant this project vendors) doesn't have an equivalent `ball_blank_lines`
branch - `multisprite_kernel.asm`/`DPCplus_kernel.asm`/`PXE_kernel.asm`
aren't touched either, since this project doesn't route project builds
through them today.

**Upstream:** intended to be proposed to the batari Basic project itself at
some point - keep this writeup in sync with the actual code if the
implementation changes before that happens.
