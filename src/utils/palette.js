'use strict';

// The NTSC Atari 2600 palette: one hex string per color index (0..127).
//
// The stored/emitted color BYTE is (index << 1). The 2600 ignores the low bit
// of a color register, so valid bytes are the even numbers 0..254, and a byte
// maps back to a palette entry with (byte >> 1). Keeping the byte (rather than
// the index) is convenient because that is exactly what batari Basic expects in
// a `pfcolors:` table and what the color picker block already emits.
import {useConfigurationStorage} from '../hooks/project';
import {tvStandardFor} from './tv-standard';

export const NTSC_COLORS = [
  '000000', '131313', '373737', '5f5f5f', '7a7a7a', 'a1a1a1', 'c5c5c5', 'ededed',
  '0d0000', '342100', '594502', '806c04', '9b8706', 'c2af0b', 'e7d32b', 'fffa50',
  '300000', '570500', '7b2a01', 'a15103', 'bc6c09', 'e4942d', 'fcb852', 'fee078',
  '450000', '6c0000', '901003', 'b6392b', 'd15445', 'f87c6c', 'fca090', 'fdc8b8',
  '490002', '6f0029', '93004e', 'ba2875', 'd54390', 'fa6bb7', 'fb90dc', 'fcb8ff',
  '3a0049', '620070', '850094', 'ab22bb', 'c63ed6', 'ee65fd', 'fb89ff', 'fcb2ff',
  '1c017d', '4301a4', '6602c8', '8e29f0', 'a844fe', 'cf6bfe', 'f38fff', 'fcb7ff',
  '000196', '1a02bc', '3f13e0', '673afe', '8253fe', 'a97bfe', 'cd9fff', 'f5c7ff',
  '00018d', '0006b3', '1529d8', '3f51fe', '5a6bfe', '8192fe', 'a6b6ff', 'cedeff',
  '00103A', '001f8c', '0642b0', '226ad7', '3c85f2', '62acff', '87d0ff', 'aef8ff',
  '010f25', '05364c', '0e5a70', '1b8298', '2f9db3', '52c4da', '75e8fe', '99ffff',
  '022000', '0a4702', '146b26', '1f934e', '30ae69', '52d590', '73f9b4', '95ffdb',
  '032700', '0c4e02', '167203', '269a0c', '3ab523', '5ddc4a', '80ff6e', 'a2ff95',
  '032200', '0b4a01', '176e03', '379506', '4fb009', '75d81a', '99fc3a', 'bdff5f',
  '011300', '0d3a01', '2f5f02', '568605', '70a108', '98c80c', 'bced23', 'e2ff47',
  '090000', '302400', '554802', '7c6f04', '978a06', 'bfb20b', 'e3d628', 'fffd4d',
];

// The PAL palette gopher2600 displays (what a PAL60 ROM shows for the same color
// bytes), generated from its colour generator with the PAL defaults - see
// tools/gopher2600-wasm/palgen. PAL has no distinct hue 1 (it repeats the greys)
// and a different hue order, so the same byte is a different color than NTSC.
export const PAL_COLORS = [
  '050505', '1c1c1c', '3a3a3a', '5f5f5f', '898989', 'b8b8b8', 'e7e7e7', 'fffeff',
  '050505', '1c1c1c', '3a3a3a', '5f5f5f', '898989', 'b8b8b8', 'e7e7e7', 'fffeff',
  '211305', '472a05', '745205', 'a77e05', 'd4aa1e', 'ffda3f', 'ffff61', 'ffff76',
  '052905', '055105', '217e05', '46ae08', '6cde23', '98ff45', 'c5ff68', 'd8ff85',
  '3a0505', '661505', '953805', 'c35d1f', 'f68740', 'ffb367', 'ffe590', 'fff0b5',
  '052c05', '055505', '0d7e0d', '29ac29', '4ddc4d', '74ff74', 'a2ffa2', 'bcffbc',
  '45050b', '720712', '9f232f', 'ce4555', 'ff6b7d', 'ff98aa', 'ffc7de', 'ffe6f2',
  '052316', '054c2b', '067944', '22a46b', '43d497', '69ffc7', '94fffb', 'acfffe',
  '36052a', '700550', '9b1b77', 'cc3aa4', 'fe61d4', 'ff8aff', 'ffbdff', 'ffdcff',
  '051e33', '053b62', '0b638d', '268dbc', '49baee', '70eeff', '9dffff', 'aeffff',
  '2f0561', '58058f', '8019bc', 'ac38ee', 'de5eff', 'ff88ff', 'ffbaff', 'ffe1ff',
  '05186a', '05249a', '1846c9', '376cfe', '5d97ff', '89c9ff', 'baffff', 'cdffff',
  '120584', '3405b9', '581fe8', '8140ff', 'af67ff', 'd493ff', 'f6c5ff', 'ffedff',
  '05058a', '1310b9', '322dea', '5751ff', '7e79ff', 'afa9ff', 'e5deff', 'fef6ff',
  '050505', '1c1c1c', '3a3a3a', '5f5f5f', '898989', 'b8b8b8', 'e7e7e7', 'fffeff',
  '050505', '1c1c1c', '3a3a3a', '5f5f5f', '898989', 'b8b8b8', 'e7e7e7', 'fffeff',
];

// The palette for the project's current TV standard (Options tab). Read from
// the stored configuration on every call, so anything rendering through it
// updates reactively when the standard changes.
export const activePalette = () =>
  (tvStandardFor(useConfigurationStorage().value) === 'pal60' ? PAL_COLORS : NTSC_COLORS);

// Number of columns the palette is laid out in (matches the color picker block).
export const PALETTE_COLUMNS = 8;

// A color byte -> "#rrggbb" for display in the DOM.
export const colorByteToCss = (byte) =>
  `#${activePalette()[(byte >> 1) & 0x7f]}`;

// A color byte -> batari Basic literal, e.g. 14 -> "$0E".
export const colorByteToBBasic = (byte) =>
  '$' + (byte & 0xfe).toString(16).toUpperCase().padStart(2, '0');
