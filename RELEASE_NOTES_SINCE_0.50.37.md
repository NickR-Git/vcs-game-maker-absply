# VCS Game Maker: everything since 0.50.37

This covers versions 0.50.38 through 0.51.21, grouped by area. The per-version
detail is in `CHANGES_SINCE_0.50.37.txt`.

## Emulator and TV standard

- The preview emulator is now gopher2600 compiled to WebAssembly (replacing
  Javatari), with real DPC+/CDF coprocessor support.
- Keyboard and keypad input is a configurable mapping with a click-to-capture
  dialog; it is saved and applies right away.
- New TV standard option (NTSC or PAL60) at the top of the ROM options. PAL60
  keeps NTSC's 60 Hz timing, swaps every build-time color for the closest PAL
  color, and makes the Sound and Music previews use the PAL audio clock.
- New camera button saves the emulator screen as a PNG.
- Creating or importing a project clears the emulator.
- The blank screen (no ROM running) has the same proportions as a running game.
- A once-a-second safety check restores the emulator canvas if it goes missing.
- The last loaded ROM survives a page refresh.

## Blocks and code generation

- **Sprites:** Inertia (accelerate/decelerate) blocks, a unified bounce block,
  16-direction Fire, and blocks that make sprites follow playfield scrolling.
  Player 0/1 and Missile 0/1 are now single dropdown-driven blocks (existing
  projects migrate automatically).
- **Animations:** "Player set animation to" blocks, a "current animation ID"
  getter, a "finished" watch block, and a loop checkbox on every way of setting
  an animation. Both players now start on the first animation.
- **Backgrounds:** tall backgrounds scroll through their full height with a
  shorter routine; new "Set background scroll to row" and "When background
  scroll reaches the Top/Bottom" blocks; scroll directions are limited under
  Superchip RAM.
- **Generator savings:** fewer redundant loads in the Music, Sound effect,
  Background fade and Sprite throttle code; several build failures fixed.
- **Fixes:** blocks failing to load or drag after opening a project, Blockly
  undo wiping all blocks, copy/paste errors, blocks undersized after an undo,
  and the grid snap toggle.

## Graphic editors (Sprites, Background, Title, Score, Text)

- One shared graphic editor toolbar across all tabs.
- New tools: Fill, Line, Rectangle, Oval, rectangle/circle/polygon selection,
  Move, and Flip, with hotkeys (B/E/G/L/R/O/V/M/C/P, Shift+H/V).
- Delete clears a selection; a stroke dragged off the canvas is cancelled.
- Import from Aseprite on the Sprites and Title tabs.
- Quick colors and frame import on the Title tab, and a per-card Test preview.
- On the Sprites tab, export/import/Aseprite icons sit left of undo/redo.
- Fixes for pixel aspect ratios, stray preview pixels and disabled-button looks.

## Music and Sound

- Music is a single-song editor with a dedicated toolbar, a collapsible Pattern
  Editor (open or closed for the whole tab), and piano roll tools: Move, Draw,
  Erase, Select.
- Song bank export/import on the Music tab, and dedicated file extensions:
  `.vcsbnk` for sounds and `.vcsmus` for music (old `.json` files still import).
- The DIM controls moved into the Sound and Music toolbars.
- Hotkeys: Shift+E/I for export/import, Space and Shift+Space for playback.
- Fixed the Music tab freezing and crashing the browser during playback (a
  piano roll render went from 300+ ms and ~170 MB to ~45 ms and a few MB), shared
  one audio context, and cleaned up audio nodes. Fixed a click at the start of
  each note.
- Sound bank import now has a checkbox picker.

## Data tab

- Notes are per value (with a table-wide note when no cell is selected).
- Each cell has a mode menu with Decimal, Binary, Hex, Color swatch, Title
  screen, Sprite animation, Background, Sound effect, Song and Text string.
- Toolbar with undo/redo, export/import CSV, duplicate/copy/paste and a Columns
  switch.

## Project tab

- New Example Projects view: a grid of cards (screenshot, title, version,
  "by" developer) with a details popup and an Open example button. Examples are
  downloaded from the GitHub repo's `examples` folder once per page load,
  stored in the browser, and removed locally when removed from the repo.
- Saved projects include a screenshot of the emulator.
- A pinned toolbar matching the graphic editor toolbar, with a Project Settings
  button, and the tab remembers which view you were on.
- Fixed `.vcsgm` files dropping Title screen pages and graphics.

## Options, themes and layout

- **Options:** TV standard, "Fill blank lines with missile0" replacing "Show
  blank lines", and tighter spacing between fields.
- **Themes:** new Dark Mode, and Soft Colors renamed Subdued Palette (it also
  covers popups).
- **Popups and toolbars:** shared delete-confirmation menu; popups use a plain
  border instead of a shadow; toolbars on every tab sit the same distance under
  the intro text; toggle switches match the Options tab's style.
- **Other tabs:** the Generated tab toolbar matches the graphic editor toolbar.
  The About tab has a Supported Kernels/Minikernels section and Official and
  Experimental links, which open in the system browser in the desktop app.
- Build errors for exceeding the ROM size name the configured size.
- The Create New Project popup is one color with Subdued Palette or Dark Mode on.
