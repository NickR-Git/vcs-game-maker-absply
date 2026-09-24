# Changes from stock batari Basic 1.9

This directory is vendored from the real bB 1.9 distribution (see the top
comment in `src/hooks/bb-compiler.js`). Everything here should match stock
bB byte-for-byte *except* the changes tracked below - keeping this list
accurate is what lets any of them be proposed back upstream later without
having to re-diff the whole tree by hand.

Nothing is currently tracked here - every file in this directory matches
stock bB 1.9.

## Note: `includes-manifest.json` must be regenerated after any edit here

`public/bb19/includes-manifest.json` (one level up from this directory) is
a flat `{"includes/<file>": content}` snapshot that every WASI compile
stage (`preprocess`/`2600basic`/`postprocess`/`dasm.wasm`, see
`src/hooks/bb-compiler.js`) actually reads instead of the live files in
this directory. It does not regenerate itself - it was generated once, in
commit f64a033, and any edit made directly to a file under
`public/bb19/includes/` since then has had no effect on a real build until
the manifest is regenerated to match. To regenerate it, write out every
file directly under this directory (excluding the `custom/` subdirectory
and this file) as `{"includes/<filename>": "<utf8 content>"}`, sorted by
filename, minified (no indentation, matching the existing format).
