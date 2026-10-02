// palgen prints the PAL palette gopher2600 displays (one "rrggbb" per color
// index 0..127), for src/utils/palette.js's PAL_COLORS - run natively, not as
// WASM: go run -mod=vendor ./palgen
package main

import (
	"fmt"

	"github.com/jetsetilly/gopher2600/hardware/television/colourgen"
	"github.com/jetsetilly/gopher2600/hardware/television/signal"
)

func main() {
	cg, err := colourgen.NewColourGen()
	if err != nil {
		panic(err)
	}
	cg.SetDefaults(false, "PAL")
	for i := 0; i < 128; i++ {
		c := cg.GeneratePAL(signal.ColorSignal(i<<1), signal.ColorSignal(0), false)
		fmt.Printf("%02x%02x%02x\n", c.R, c.G, c.B)
	}
}
