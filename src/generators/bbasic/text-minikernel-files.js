'use strict';

// The Text Minikernel's  text12a.asm/text12b.asm, and the extended
// score_graphics.asm bundled with it (adds the fontstyle-based font
// selection text12a.asm reads to shrink the score row so text fits
// underneath it - the stock score_graphics.asm doesn't have this, and it's
// also offered on its  as the "Squish" score font option - see
// utils/score-font.js/SQUISH_SCORE_FONT - independent of whether the Text
// Minikernel itself is in use). Fetched once and cached; hooks/rom.js places
// these as siblings of the compiled source throughout the whole compile
// pipeline (see compileBatariBasicToAsm in hooks/bb-compiler.js), the same
// relationship they'd have as real files next to a .bas file on disk -
// confirmed against the real local toolchain to be exactly what "inline
// text12a.asm"/"inline text12b.asm" need.
const fetchText = (path) => fetch(path).then((r) => r.text());

let scoreGraphicsPromise = null;
export const getExtendedScoreGraphics = () => {
  if (!scoreGraphicsPromise) {
    scoreGraphicsPromise = fetchText('bb19/text-minikernel/score_graphics_extended.asm');
  }
  return scoreGraphicsPromise;
};

// The pristine, unmodified text12b.asm - fetched once and cached, same
// reasoning as getExtendedScoreGraphics above. Exposed separately (not just
// folded into getTextMinikernelSiblingFiles below) so utils/text-font.js can
// fetch this same content by itself: once to parse the built-in glyph
// shapes for a fresh Text Font Editor (getDefaultTextFont), and again to
// build a byte-for-byte override splicing the user's  edited glyphs in
// (buildTextFontOverride) - both need the real pristine bytes as their
// starting point, the same way score font's  buildScoreFontOverride
// starts from getPristineScoreGraphics (utils/score-font.js).
let pristineText12bPromise = null;
export const getPristineText12b = () => {
  if (!pristineText12bPromise) {
    pristineText12bPromise = fetchText('bb19/text-minikernel/text12b.asm');
  }
  return pristineText12bPromise;
};

let filesPromise = null;
export const getTextMinikernelSiblingFiles = () => {
  if (!filesPromise) {
    filesPromise = Promise.all([
      fetchText('bb19/text-minikernel/text12a.asm'),
      getPristineText12b(),
      getExtendedScoreGraphics(),
    ]).then(([text12a, text12b, scoreGraphics]) => ({
      'text12a.asm': text12a,
      'text12b.asm': text12b,
      'score_graphics.asm': scoreGraphics,
    }));
  }
  return filesPromise;
};

// DPC+: the Text Minikernel uses a single dedicated file, and the kernel needs a hook that calls it after the score
// (the project's copy of DPCplus_kernel.asm takes the place of the stock one, see the Text Minikernel's user's
// guide). The stock kernel the app ships gets the hook added to it, so it keeps everything newer than the
// customized kernel the minikernel's zip comes with.
const DPC_PLUS_TEXT_HOOK = [
  '    ifconst textbank',
  '        ;; disable fast fetch',
  '        lda #255',
  '        sta FASTFETCH',
  '        lda #>(textkernel-1)',
  '        pha',
  '        lda #<(textkernel-1)',
  '        pha',
  '        pha ; *** save A (the text kernel does not use it)',
  '        pha ; *** save X (nor this)',
  '        ldx #textbank',
  '        jmp BS_jsr',
  'posttextkernel',
  '        ;; enable fast fetch',
  '        lda #0',
  '        sta.w FASTFETCH',
  '    endif',
  '',
];
const withDpcPlusTextHook = (kernel) => {
  const lines = kernel.split('\n');
  const at = lines.findIndex((line) => /^\s*bpl scoreloop/.test(line));
  if (at < 0) throw new Error('The DPC+ kernel has no score loop to add the Text Minikernel to');
  lines.splice(at + 1, 0, ...DPC_PLUS_TEXT_HOOK);
  // A project that hides the score under the text still goes through the score code (the text kernel is called
  // from inside it), but with its digits drawn in black. Not lda #0: with fast fetch on, an immediate load of a
  // value that is a data fetcher's address reads that fetcher instead, so a luminance 0 color other than $00 it is.
  const colorAt = lines.findIndex((line, index) => index > lines.findIndex((l) => /^scoreloop/.test(l)) &&
    /^\s*lda #<DF6DATA/i.test(line));
  if (colorAt < 0) throw new Error('The DPC+ kernel has no score color to hide the score with');
  lines.splice(colorAt, 1, '    ifconst dpchidescore', '     lda #$20', '    else', lines[colorAt], '    endif');
  return lines.join('\n');
};

// The text is drawn after the kernel's score, in time the frame has no room for, so the main screen is made
// shorter by what it takes: 14 lines for the one row, 12 more for the wrapped second row and 6 for the scroll
// cursor's extra scanlines.
const DPC_PLUS_KERNEL_LINES = 178;
const DPC_PLUS_TEXT_ROW_LINES = 14;
const DPC_PLUS_TEXT_ROW2_LINES = 12;
const DPC_PLUS_TEXT_CURSOR_LINES = 6;
// The kernel ends its picture by checking the timer it started, and only some starting values end it right (192, 178
// and 173 were measured to work, 194 and 168 do not; the stock 211 works too), so the screen height is the tallest
// of those that is not taller than wanted.
const DPC_PLUS_WORKING_KERNEL_TIMERS = [211, 192, 178, 173];
const dpcPlusTextKernelTimer = (withRow2, withCursor) => {
  const wanted = DPC_PLUS_KERNEL_LINES - DPC_PLUS_TEXT_ROW_LINES - (withRow2 ? DPC_PLUS_TEXT_ROW2_LINES : 0) -
    (withCursor ? DPC_PLUS_TEXT_CURSOR_LINES : 0);
  const value = Math.floor(wanted * 76 / 64);
  return DPC_PLUS_WORKING_KERNEL_TIMERS.find((timer) => timer <= value) || DPC_PLUS_WORKING_KERNEL_TIMERS.slice(-1)[0];
};
// How many lines tall the main screen is with the text on.
export const dpcPlusTextScreenLines = (withRow2, withCursor) =>
  dpcPlusTextKernelTimer(withRow2, withCursor) * 64 / 76;

const withDpcPlusTextScreenHeight = (header, withRow2, withCursor) => {
  const patched = header.replace(/KERNEL_LINES = 178\*76\/64/, `KERNEL_LINES = ${dpcPlusTextKernelTimer(withRow2, withCursor)}`);
  if (patched === header) throw new Error('The DPC+ header has no screen height to shorten for the Text Minikernel');
  return patched;
};

const dpcPlusFilesPromises = {};
export const getDpcPlusTextMinikernelSiblingFiles = (withRow2 = false, withCursor = false) => {
  const key = `${withRow2 ? 'row2' : 'row1'}${withCursor ? 'cursor' : ''}`;
  if (!dpcPlusFilesPromises[key]) {
    dpcPlusFilesPromises[key] = Promise.all([
      fetchText('bb19/text-minikernel/text12DPCplus.asm'),
      fetchText('bb19/includes/DPCplus_kernel.asm'),
      fetchText('bb19/includes/DPCplusbB.h'),
    ]).then(([text, kernel, header]) => ({
      'text12DPCplus.asm': text,
      'DPCplus_kernel.asm': withDpcPlusTextHook(kernel),
      'DPCplusbB.h': withDpcPlusTextScreenHeight(header, withRow2, withCursor),
    }));
  }
  return dpcPlusFilesPromises[key];
};
