# gopher2600-wasm

Builds the app's preview emulator: [github.com/jetsetilly/gopher2600](https://github.com/jetsetilly/gopher2600)'s
emulation core (real DPC+/CDF ARM-coprocessor support included, zero cgo)
compiled to WebAssembly. The output is vendored build output, not built as
part of `npm run build` - same convention as `public/bb19`'s WASM binaries.

## Why `vendor/` instead of a normal module dependency

gopher2600's repository is ~1.3GB (it bundles large test-fixture ROMs/assets
unrelated to the emulation core itself), which exceeds the Go module proxy's
zip size limit (`create zip: module source tree too large`). `go get` /
`go build` against it directly does not work. Instead, this directory vendors
*only the Go source actually imported* (`vendor/`, ~3MB) via a temporary
local `replace` directive during vendoring - see the comment on that
directive in `go.mod` for why it's safe to leave the (non-portable, points at
a throwaway local clone) path in place afterward: `-mod=vendor` builds never
read from it, they only check it matches `vendor/modules.txt` for
consistency.

## Rebuilding (e.g. to pick up a gopher2600 update)

```bash
# 1. Get a full local clone (shallow is fine, still ~1.3GB) and point the
#    replace directive in go.mod at it:
git clone --depth 1 https://github.com/jetsetilly/gopher2600.git /tmp/gopher2600-src
# edit go.mod's replace line to point at that path

go mod tidy
go mod vendor
# revert the replace line's path back to a placeholder if desired - it's
# never dereferenced by normal -mod=vendor builds, see go.mod's comment

# 2. Build the WASM artifact and copy the matching JS glue:
GOOS=js GOARCH=wasm go build -mod=vendor -ldflags="-s -w" \
  -o ../../public/js/gopher2600.wasm .
cp "$(go env GOROOT)/lib/wasm/wasm_exec.js" ../../public/js/wasm_exec.js
```

Requires a Go toolchain (this was built with Go 1.27) - only for whoever
rebuilds this artifact, not for the app's normal `npm install`/`npm run build`.
