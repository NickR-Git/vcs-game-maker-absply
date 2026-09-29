<template>
  <v-card outlined @click="handleMouse" @mousedown="handleActivate" :ripple="false">
    <v-card-text>
      <slot name="badge" />
      <div class="editor-with-sidebar">
        <div v-if="$slots.sidebar" class="editor-sidebar">
          <slot name="sidebar" />
        </div>
        <div class="proportion-wrapper">
          <div
            class="proportion-wrapper-stretcher"
            :style="{'padding-bottom': 100 / aspectRatio + '%'}"
          />
          <canvas
            ref="editor"
            class="editor-canvas"
            :class="{
              'editor-canvas-tool-pencil': toggledTool === 'pencil',
              'editor-canvas-tool-eraser': toggledTool === 'eraser',
              'editor-canvas-tool-fill': toggledTool === 'fill',
              'editor-canvas-tool-line': toggledTool === 'line',
              'editor-canvas-tool-shape': toggledTool === 'rectangle' || toggledTool === 'oval',
            }"
            @mousedown="handleMouse"
            @mouseenter="handleMouse"
            @mouseleave="handleMouseLeave"
            @mouseup="handleMouse"
            @mousemove="handleMouse"
          />
          <canvas
            v-if="showGrid"
            ref="gridOverlay"
            class="grid-overlay-canvas"
          />
        </div>
      </div>
    </v-card-text>
    <!-- Every real call site now drives this component's own tools (Eraser/
         Pencil/Undo/Redo/Export/Import/Set height) from a single toolbar
         shared across a whole tab (see GraphicEditorToolbar.vue) rather than
         a per-instance one - Clear is the one action still requested per
         card/frame, so it's the only thing left to render here. -->
    <v-card-actions v-if="showClearButton" class="pixel-editor-tools">
      <v-btn
        v-if="$slots.sidebar"
        icon
        small
        title="Clear this graphic's color data only (leaves the drawing itself untouched)"
        class="pixel-editor-clear-colors-btn"
        @click="$emit('clear-colors')"
      >
        <v-icon>mdi-invert-colors-off</v-icon>
      </v-btn>
      <div class="pixel-editor-hidden-toolbar-row">
        <slot name="toolbar-end" />
        <v-btn
          icon
          small
          title="Clear"
          @click="handleClear"
        >
          <v-icon>mdi-broom</v-icon>
        </v-btn>
      </div>
    </v-card-actions>
  </v-card>
</template>
<script>
import {PixelEditor, Pencil} from '@curtishughes/pixel-editor';
import {chunk, debounce} from 'lodash';
import {saveAs} from 'file-saver';

import Bucket from '../utils/bucket-tool';
import Line from '../utils/line-tool';
import Rectangle from '../utils/rectangle-tool';
import Oval from '../utils/oval-tool';
import {isMatrixEqual} from '../utils/array';
import {getDateInfix} from '../utils/date';
import {loadImageFromFile, openFileDialog} from '../utils/file';
import {createResizedCanvas} from '../utils/image';
import {usePixelTool} from '../hooks/pixel-tool';
import {resizePixelMatrixHeight} from '../utils/pixels';

export default {
  props: {
    value: {type: Array, default: null},
    width: {type: Number, default: 32},
    height: {type: Number, default: 12},
    aspectRatio: {type: Number, default: 4.0 / 3},
    fgColor: {type: String, default: 'white'},
    bgColor: {type: String, default: 'black'},
    // Optional per-row CSS colors for "on" pixels (one entry per row). When
    // provided, each row's set pixels are drawn in its  color instead of
    // fgColor, so the playfield preview reflects the batari Basic pfcolors.
    rowColors: {type: Array, default: null},
    name: {type: String, default: 'image'},
    allowChangingHeight: {type: Boolean, default: true},
    // Shows a one-click "Clear" button next to the Eraser/Pencil tools -
    // opt-in (default off) since most PixelEditor uses (sprite frames, the
    // score font, ...) already have their  way to start a frame over
    // (switching frames, importing an image), and a stray "wipe everything"
    // button isn't worth the risk of a misclick there. Backgrounds are the
    // one place a whole-grid clear is actually useful on its own.
    showClearButton: {type: Boolean, default: false},
    // Draws a thin grid line around every cell, on a separate overlay
    // canvas layered on top of the real drawing canvas (see mounted()'s own
    // ResizeObserver) - a pure visual aid, never part of the pixel data
    // itself.
    showGrid: {type: Boolean, default: false},
    // Labels each cell with its  column index (0-based, matching the X
    // argument every "Background: pixel at X/Y" block already uses) at the
    // cell's center - opt-in separately from showGrid since it's only
    // useful on the wide, many-columned Background canvas; a narrow sprite
    // frame has no room to render it legibly and no matching "X" concept
    // worth calling out cell by cell.
    showCellIds: {type: Boolean, default: false},
  },
  data() {
    return {
      pencil: new Pencil(this.fgColor),
      eraser: new Pencil(this.bgColor),
      fill: new Bucket(this.fgColor),
      line: new Line(this.fgColor),
      rectangle: new Rectangle(this.fgColor),
      oval: new Oval(this.fgColor),
    };
  },
  computed: {
    // 'pencil' or 'eraser' - which tool is currently active, shared across
    // every PixelEditor.vue instance (see hooks/pixel-tool.js's comment
    // for why this moved out of per-instance data()). Read externally by
    // GraphicEditorToolbar.vue's activeTool computed to highlight the
    // right one on the shared toolbar, and set externally via setTool()
    // below - this instance no longer renders its Eraser/Pencil buttons
    // at all (see setTool's comment).
    toggledTool: {
      get() {
        return usePixelTool().value;
      },
      set(value) {
        usePixelTool().value = value;
      },
    },
  },
  mounted() {
    this.initEditor(this.value.length, this.value);

    // TODO: Just for testing
    window.isMatrixEqual = isMatrixEqual;

    if (this.showGrid) this.setupGridOverlay();
  },
  beforeDestroy() {
    this.teardownGridOverlay();
  },
  watch: {
    // Keeps THIS instance's underlying editor.tool object (a real
    // Pencil, colored with this instance's fgColor/bgColor - see
    // data()) in sync with the shared toggledTool (hooks/pixel-tool.js) at
    // all times, not just at construction - without this, an already-
    // mounted-but-not-currently-focused instance (e.g. a different card's
    // frame) kept whatever tool object it was built or last explicitly
    // setTool()'d with, so clicking Eraser on frame A then clicking INTO
    // frame B still drew with frame B's stale Pencil until Eraser was
    // clicked again there too - exactly the bug being fixed here.
    toggledTool(toolName) {
      if (this.editor) this.editor.tool = this.toolFor(toolName);
    },
    // Recolor the existing pixels when the row colors change (e.g. the user
    // picks a new color in the strip) without disturbing the drawn shape.
    // logToHistory: false - same reasoning as handleMouse's own recolor
    // call below: this re-expresses the CURRENT pixel matrix with new
    // display colors, not a new edit, so it shouldn't consume an undo step.
    // Left true (the default) here, TitleScreenEditor.vue was a real
    // reported case where this fired mid-drag - its own @input handler
    // calls ensureRowColors() on every stroke (unlike Background/Player,
    // which only do that on frame-add/resize), and editorRowColors()
    // allocates a fresh array every render, so a fresh `rowColors` prop
    // reference here is more likely there than elsewhere - each fresh
    // reference re-pushed a history entry Rectangle/Line/Oval's own
    // undo()-then-redraw preview didn't expect, leaving old preview
    // positions never actually erased (a "trail").
    rowColors() {
      if (this.editor) {
        this.setPixels(this.getPixels(), false);
      }
    },
    // The overlay canvas only exists in the DOM while showGrid is true (see
    // the template's  v-if) - the ResizeObserver has to be (re)attached
    // to whichever real element currently exists, not created once up
    // front.
    showGrid(value) {
      if (value) {
        this.$nextTick(() => this.setupGridOverlay());
      } else {
        this.teardownGridOverlay();
      }
    },
    // Extra coverage alongside initEditor's  redraw call (see its
    // comment) for the one case that changes row count WITHOUT going
    // through initEditor synchronously in the same tick: the Background
    // tab's  resolution setting (Superchip pfres), which passes a new
    // "height" prop value the moment it changes, slightly ahead of
    // reflowBackgroundsToHeight's  pixel-matrix update reaching this
    // component's "value" prop and triggering initEditor from there.
    height() {
      this.$nextTick(() => this.drawGridOverlay());
    },
    showCellIds() {
      this.drawGridOverlay();
    },
    // Picks up a row-count change this component DIDN'T itself just emit -
    // needed for "Set height" resizing every frame on a card together (see
    // e.g. PlayerEditor.vue's own handleUnifiedSetHeight): every OTHER
    // frame's own PixelEditor instance never sees that resize happen
    // locally (only the ONE frame applyHeight was actually called on does),
    // it only sees its "value" prop change out from under it once
    // PlayerEditor.vue applies the resize to its frame.pixels - and the
    // underlying PixelEditor library has no
    // built-in way to change its  row count after construction (see
    // initEditor's  comment), so without this, every other frame would
    // keep silently rendering at its OLD height/content until manually
    // reopened.
    //
    // A same-LENGTH "value" change also needs picking up - e.g. Copy/Paste
    // Frame (PlayerEditor.vue's  handlePasteFrame) pastes another
    // frame's pixels straight into this one's "value" prop with no local
    // draw stroke involved at all - confirmed as a real reported bug: when
    // the pasted frame happened to be the same height as this one, the
    // canvas kept showing its OLD content until manually reopened, even
    // though "value" (and the row-color sidebar, a separate component bound
    // directly to frame.rowColors) had already updated. Guarded on an
    // actual PIXEL mismatch against what's currently drawn (not just any
    // "value" change) so an ordinary same-height pixel edit doesn't
    // redundantly redraw itself on every stroke - that echo already matches
    // what's on screen, since it's this same instance's  just-emitted
    // change coming back through its  prop.
    value(newValue) {
      if (!this.editor || !newValue) return;
      if (newValue.length !== this.editor.height) {
        this.initEditor(newValue.length, newValue);
      } else if (!isMatrixEqual(newValue, this.getPixels())) {
        this.setPixels(newValue);
      }
    },
  },
  methods: {
    // The overlay canvas is sized to its  CSS-rendered pixel dimensions
    // (not the drawing canvas's  tiny intrinsic width/height, one unit
    // per cell - see PixelEditor's  constructor) so grid lines and cell
    // labels stay crisp and legible at any zoom level, rather than being
    // stretched/blurred the same "pixelated" way the actual artwork is.
    // That means it has to be redrawn whenever its  rendered SIZE
    // changes - zooming, resizing the window, or the sidebar/toolbar
    // reflowing - which a plain mounted()-once draw can't catch on its own.
    setupGridOverlay() {
      this.teardownGridOverlay();
      const canvas = this.$refs.gridOverlay;
      if (!canvas) return;
      this.gridResizeObserver = new ResizeObserver(() => this.drawGridOverlay());
      this.gridResizeObserver.observe(canvas);
      this.drawGridOverlay();
    },

    teardownGridOverlay() {
      if (this.gridResizeObserver) {
        this.gridResizeObserver.disconnect();
        this.gridResizeObserver = null;
      }
    },

    drawGridOverlay() {
      const canvas = this.$refs.gridOverlay;
      if (!canvas) return;
      // devicePixelRatio-aware, same reasoning as any crisp-canvas-text
      // setup - drawing at the CSS size alone leaves grid lines/text soft
      // on a high-DPI display.
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = canvas.clientWidth;
      const cssHeight = canvas.clientHeight;
      if (!cssWidth || !cssHeight) return;
      canvas.width = Math.round(cssWidth * dpr);
      canvas.height = Math.round(cssHeight * dpr);

      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);

      const cols = this.width;
      const rows = this.editor ? this.editor.height : this.height;
      const cellWidth = cssWidth / cols;
      const cellHeight = cssHeight / rows;

      ctx.strokeStyle = 'rgba(170, 170, 170, 0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let col = 0; col <= cols; col++) {
        // +0.5 lands the 1px line exactly on a device pixel instead of
        // straddling two (and rendering as a blurry 2px band) - the
        // standard canvas crisp-line trick.
        const x = Math.round(col * cellWidth) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssHeight);
      }
      for (let row = 0; row <= rows; row++) {
        const y = Math.round(row * cellHeight) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(cssWidth, y);
      }
      ctx.stroke();

      if (!this.showCellIds) return;
      // "X,Y" - matches the two arguments every "Background: pixel at X/Y"
      // block already uses, so a cell's  coordinates can be read
      // straight off the grid while wiring one up. Skipped entirely once
      // cells are too small to hold a legible label, rather than drawing
      // illegible overlapping text - a wider budget than a single number
      // would need, since "X,Y" is always at least 3 characters.
      const fontSize = Math.min(cellHeight * 0.6, cellWidth * 0.35, 12);
      if (fontSize < 5) return;
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // A label over an "on" pixel needs a darker color than the default
      // gray to stay readable against a bright fill color (e.g. this
      // editor's  default orange) - built once as a lookup rather than
      // searching this.editor.pixels per cell. editor.pixels holds EVERY
      // cell, on or off (setPixels above always writes a real color either
      // way - this.onColorForRow(y) when on, this.bgColor when off - see
      // its  comment), so "on" means the color differs from bgColor, the
      // same test pixelMatrix() above already uses - not just presence in
      // the list.
      const filledCells = new Set(
          this.editor.pixels.filter((px) => px.color !== this.bgColor).map((px) => `${px.x},${px.y}`));
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          ctx.fillStyle = filledCells.has(`${col},${row}`) ?
            'rgba(0, 0, 0, 0.85)' : 'rgba(140, 140, 140, 0.85)';
          ctx.fillText(`${col},${row}`, (col + 0.5) * cellWidth, (row + 0.5) * cellHeight);
        }
      }
    },

    // The underlying @curtishughes/pixel-editor library only listens for
    // "mouseup" on the canvas ITSELF (see its  constructor) - it has no
    // "mouseleave" handling at all. Dragging the pointer off the canvas
    // while a button is still held (a real, easy-to-do gesture, e.g.
    // drawing right up to an edge) and releasing OUTSIDE it means the
    // canvas's own "mouseup" never fires, so the library's  tool (see
    // its handlePointerDown/handlePointerUp) is left thinking the button
    // is still down - re-entering the canvas afterward, with the button
    // genuinely up, then immediately resumes drawing on the very next
    // "mousemove", with no mousedown of its own. Confirmed as a real,
    // reproducible bug across every card that uses this component (Player
    // Sprite, Background, Score digits - anywhere PixelEditor.vue is used).
    // Forcing a synthetic "mouseup" the instant the pointer leaves the
    // canvas - passing the real mouseleave event through, since
    // PixelEditor's  mouseup(e) reads e.clientX/clientY the exact same
    // way a real mouseup event would - releases the tool's  state
    // immediately, regardless of whether the button is later released
    // inside or outside the canvas. Not debounced (unlike handleMouse
    // below, which still runs right after to resync Vue's  reactive
    // pixel state) - the release itself needs to happen synchronously, or
    // a mousemove landing before the debounce fires would still draw.
    handleMouseLeave(event) {
      if (this.editor) this.editor.mouseup(event);
      this.handleMouse();
    },

    // Reports that this frame was just interacted with, so a caller driving
    // a single toolbar shared across many PixelEditor instances (see
    // GraphicEditorToolbar.vue) knows which one to act on next. Passes
    // itself (not just an id) so the caller can call straight into
    // setTool/undo/redo/applyHeight/handle*Image/handleClear below without
    // needing its own parallel map of ids to component instances.
    handleActivate() {
      this.$emit('activate', this);
    },

    // 'pencil'/'eraser'/'fill' -> the real tool object driving the
    // underlying PixelEditor library (see its own Tool interface) -
    // shared by setTool, the toggledTool watcher above, and initEditor's
    // initialTool below so all three stay in sync with a single mapping.
    toolFor(toolName) {
      if (toolName === 'eraser') return this.eraser;
      if (toolName === 'fill') return this.fill;
      if (toolName === 'line') return this.line;
      if (toolName === 'rectangle') return this.rectangle;
      if (toolName === 'oval') return this.oval;
      return this.pencil;
    },

    setTool(toolName) {
      this.toggledTool = toolName;
      this.editor.tool = this.toolFor(toolName);
    },

    undo() {
      this.editor.undo();
    },

    redo() {
      this.editor.redo();
    },

    handleMouse: debounce(function() {
      // eslint-disable-next-line no-invalid-this
      const pixels = this.getPixels();
      // eslint-disable-next-line no-invalid-this
      if (!isMatrixEqual(this.value, pixels)) {
        // eslint-disable-next-line no-invalid-this
        this.$emit('input', pixels);
        // Pixels are drawn in the pencil's fixed color; recolor them so newly
        // drawn cells adopt their row color instead of staying the draw color.
        // logToHistory: false - this recolor pass doesn't represent a new
        // edit (see setPixels' own comment); left true here, it silently
        // pushed an extra history entry on every single stroke, which
        // undo()-then-redraw preview tools (Rectangle/Line/Oval) rely on
        // undo() popping exactly the ONE entry their own last move pushed -
        // the extra entry meant their undo() popped this no-op recolor
        // instead, leaving the previous preview position's pixels never
        // actually erased - confirmed as the real cause of a reported
        // "drawing a rectangle leaves a trail behind" bug on any canvas
        // with row colors (e.g. Background).
        // eslint-disable-next-line no-invalid-this
        if (this.rowColors) {
          // eslint-disable-next-line no-invalid-this
          this.setPixels(pixels, false);
        }
      }
    }, 10),

    // The color used for an "on" pixel on the given row.
    onColorForRow(y) {
      return (this.rowColors && this.rowColors[y]) || this.fgColor;
    },

    handleExportImage() {
      // Adapted from https://stackoverflow.com/a/28305948/679240

      const canvas = document.createElement('canvas');
      canvas.width = this.editor.width;
      canvas.height = this.editor.height;

      const ctx = canvas.getContext('2d');

      this.editor.pixels.forEach((px) => {
        ctx.fillStyle = px.color;
        ctx.fillRect(px.x, px.y, 1, 1);
      });

      canvas.toBlob((blob) => {
        saveAs(blob, `${this.name}-${getDateInfix()}.png`);
      });
    },

    handleImportImage() {
      openFileDialog('image/*')
          .then(loadImageFromFile)
          .then((img) => {
            // Where height can be changed (sprite frames, not backgrounds or
            // the score font, which have a fixed row count - see
            // allowChangingHeight), match the imported image's  height
            // instead of squeezing it into whatever height this frame
            // already happened to be, same range as the "Set height" slider.
            const targetHeight = this.allowChangingHeight ?
              Math.min(64, Math.max(1, Math.round(img.height))) : this.editor.height;
            const canvas = createResizedCanvas(img, this.editor.width, targetHeight);

            // Adapted from https://stackoverflow.com/a/667074/679240
            // Get the CanvasPixelArray from the given coordinates and dimensions.
            const imageData = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
            const imgPixels = imageData.data;

            // Loop over each pixel
            const pixelValues = [];
            for (let i = 0, n = imgPixels.length; i < n; i += 4) {
              const r = imgPixels[i]; // red
              const g = imgPixels[i + 1]; // green
              const b = imgPixels[i + 2]; // blue
              // i+3 is alpha (the fourth element)

              pixelValues.push((r + g + b) / 3);
            }

            const pixels = chunk(pixelValues.map((v) => v > 32 ? 1 : 0), canvas.width);
            if (targetHeight !== this.editor.height) {
              this.initEditor(targetHeight, pixels);
            } else {
              this.setPixels(pixels);
            }
            this.$emit('input', pixels);
          });
    },

    // The underlying PixelEditor library is sized once at construction and
    // doesn't support changing its row count afterwards, so changing height
    // means building a fresh instance in place - rather than the full page
    // reload this used to do, which (via main.js's "start empty" reset on
    // every launch) was wiping the entire project, not just this frame.
    //
    // Carries the OLD editor's  History instance into the new one
    // (PixelEditor's  constructor takes it as an optional 4th arg,
    // defaulting to a fresh one when omitted) - confirmed as a real reported
    // bug otherwise: every resize used to build a brand new PixelEditor with
    // a brand new, empty History, silently discarding every undo entry from
    // before the resize, on top of the resize itself never being undoable
    // either. History's  undoStack/redoStack are plain {next, prev}
    // pixel-coordinate deltas with no canvas-size bounds checking
    // (PixelCollection.set() is a sparse {x+y*width: color} map, and
    // getPixels() here already skips any y past the current row count), so
    // replaying an old delta against a differently-sized editor is safe -
    // it just won't restore rows beyond whatever height is CURRENT at undo
    // time, same as any other pixel data that's currently out of view.
    initEditor(rowCount, pixelMatrix) {
      const canvas = this.$refs.editor;
      const history = this.editor ? this.editor.history : undefined;
      // Starts already matching the shared toggledTool (see
      // hooks/pixel-tool.js) instead of hardcoding Pencil - without this, a
      // freshly built/resized editor's underlying tool object silently
      // stayed Pencil even while Eraser showed selected on the shared
      // toolbar, until setTool() was called again to actually apply it.
      const initialTool = this.toolFor(this.toggledTool);
      this.editor = new PixelEditor(canvas, this.width, rowCount, initialTool, history);
      this.setPixels(pixelMatrix);
      this.handleMouse();
      // Row count (this.editor.height) is what the grid overlay actually
      // draws against, not the "height" PROP (only ever a construction-time
      // default - see this method's  callers) - a height change from
      // here (Set Height, cross-frame resize, importing a differently-sized
      // image) wouldn't otherwise be caught by that prop's  watcher.
      if (this.showGrid) this.$nextTick(() => this.drawGridOverlay());
    },

    // The actual resize - called externally by whichever tab-level "Set
    // height" menu is currently driving this instance (see
    // GraphicEditorToolbar.vue), since this component no longer has a
    // height-menu popup of its own to call it internally.
    applyHeight(newHeight, scaleContents) {
      const pixels = this.getPixels();
      if (newHeight != this.value.length) {
        const resized = resizePixelMatrixHeight(pixels, newHeight, this.editor.width, scaleContents);

        this.$emit('input', resized);
        this.initEditor(newHeight, resized);
      }
    },

    createEmptyPixelMatrix() {
      return new Array(this.height).fill(0).map(() => new Array(this.width).fill(0));
    },

    getPixels() {
      const pixelMatrix = this.createEmptyPixelMatrix();
      this.editor.pixels.forEach((px) => {
        if (px.y >= pixelMatrix.length) return;
        // An "on" pixel is any that isn't the background color. Comparing
        // against fgColor would misread per-row colored pixels as empty.
        pixelMatrix[px.y][px.x] = px.color !== this.bgColor ? 1 : 0;
      });
      return pixelMatrix;
    },
    // logToHistory: false for handleMouse's own post-stroke recolor pass
    // below - that call re-expresses the SAME pixel matrix a tool's own
    // set() just drew, only swapping which CSS color string represents
    // "on" per row, so it isn't really a separate user edit and shouldn't
    // consume its own undo step. Left true (an extra history entry) for
    // every other caller, which is the existing, unchanged behavior.
    setPixels(pixelMatrix, logToHistory = true) {
      pixelMatrix = pixelMatrix || this.createEmptyPixelMatrix();
      const editorPixels = [];
      pixelMatrix.forEach((line, y) => line.forEach((bit, x) => {
        editorPixels.push({x, y, color: bit ? this.onColorForRow(y) : this.bgColor});
      }));
      this.editor.set(editorPixels, logToHistory);
    },

    handleClear() {
      this.setPixels(null);
      this.$emit('input', this.getPixels());
      // Separate from 'input' (an ordinary pixel edit) - lets a caller reset
      // this graphic's  color fields (row colors, a single fixed color,
      // whatever it has) alongside the pixels specifically on a real Clear
      // click, without every plain drawing stroke also wiping colors.
      this.$emit('clear');
    },
  },
};
</script>
<style scoped>
/* The root v-card has a @click handler (for canvas mouse events - see
   handleMouse), which Vuetify treats as "interactive" and paints its own
   grey hover/focus overlay over on mouseover/click, the same way it does
   for the toolbar's own buttons (see .pixel-editor-tools >>> .v-btn::before
   below) - except here it covers the WHOLE card (graphic and toolbar
   alike), reading as a stray, unexplained grey tint rather than a real
   button state, since this card isn't actually a single clickable control.
   ripple="false" (already set in the template) only suppresses the ripple
   animation, not this separate overlay. */
.v-card::before {
  display: none;
}

.editor-canvas {
  image-rendering: optimizeSpeed;             /* Older versions of FF          */
  image-rendering: -moz-crisp-edges;          /* FF 6.0+                       */
  image-rendering: -webkit-optimize-contrast; /* Safari                        */
  image-rendering: -o-crisp-edges;            /* OS X & Windows Opera (12.02+) */
  image-rendering: pixelated;                 /* Awesome future-browsers       */
  -ms-interpolation-mode: nearest-neighbor;   /* IE                            */

  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  height: 100%;

  border: 1px solid;
}

/* Swaps the plain arrow cursor for a small pencil/eraser glyph while
   hovering the canvas, matching whichever tool is actually active
   (toggledTool - see setTool) - a plain crosshair (Vuetify's own default
   hover cursor here otherwise) gave no visual confirmation of WHICH tool a
   click would use, easy to lose track of once the toolbar itself moved out
   of this component (see hideToolbar) onto a shared row elsewhere on the
   page. White fill + black outline (not the app's own plain grey/black MDI
   icon color) so the glyph stays visible over both the mostly-black canvas
   backgrounds these editors usually have and any bright artwork drawn on
   them. The hotspot (the two numbers after the url()) is the pencil's own
   drawing tip / the eraser's own bottom-left corner, so the cursor visually
   points at the exact cell a click would affect, not just floats nearby -
   "crosshair" is the fallback for browsers that don't support custom cursor
   images at all. */
.editor-canvas-tool-pencil {
  cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path fill='white' stroke='black' stroke-width='1' d='M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z'/></svg>") 3 21, crosshair;
}

.editor-canvas-tool-eraser {
  cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path fill='white' stroke='black' stroke-width='1' d='M16.24,3.56L21.19,8.5C21.97,9.29 21.97,10.55 21.19,11.34L12,20.53C10.44,22.09 7.91,22.09 6.34,20.53L2.81,17C2.03,16.21 2.03,14.95 2.81,14.16L13.75,3.56C14.54,2.78 15.8,2.78 16.24,3.56M4.22,15.58L7.76,19.11C8.54,19.9 9.8,19.9 10.59,19.11L14.54,15.16L9.42,10.04L4.22,15.58Z'/></svg>") 4 16, crosshair;
}

/* Hotspot at the bucket's spout (matching the pencil/eraser cursors' own
   "point at the exact cell a click would affect" reasoning above). */
.editor-canvas-tool-fill {
  cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path fill='white' stroke='black' stroke-width='1' d='M19,11.5C19,11.5 17,13.67 17,15A2,2 0 0,0 19,17A2,2 0 0,0 21,15C21,13.67 19,11.5 19,11.5M5.21,10L10,5.21L14.79,10M16.56,8.94L7.62,0L6.21,1.41L8.59,3.79L3.44,8.94C2.85,9.5 2.85,10.47 3.44,11.06L8.94,16.56C9.23,16.85 9.62,17 10,17C10.38,17 10.77,16.85 11.06,16.56L16.56,11.06C17.15,10.47 17.15,9.5 16.56,8.94Z'/></svg>") 4 20, crosshair;
}

/* Hotspot at the line's drawing end (the endpoint that tracks the pointer
   while dragging), same reasoning as the other tool cursors above. */
.editor-canvas-tool-line {
  cursor: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24' viewBox='0 0 24 24'><path fill='white' stroke='black' stroke-width='1' d='M19.5,3.09L20.91,4.5L4.5,20.91L3.09,19.5L19.5,3.09Z'/></svg>") 20 4, crosshair;
}

/* Rectangle/Oval both drag out a bounding box from a corner rather than
   tracking a single drawing tip the way Pencil/Line do, so a plain
   crosshair (no custom glyph/hotspot) already communicates the gesture
   correctly on its own. */
.editor-canvas-tool-shape {
  cursor: crosshair;
}

/* Layered directly on top of .editor-canvas (same inset/height) - drawn at
   its own CSS-rendered resolution rather than the tiny one-unit-per-cell
   intrinsic size .editor-canvas uses (see drawGridOverlay's own comment),
   so no border of its own (would double up with .editor-canvas's) and no
   pointer-events (drawing/erasing has to keep reaching the real canvas
   underneath, not get intercepted by this purely visual layer). */
.grid-overlay-canvas {
  position: absolute;
  top: 0;
  left: 0;
  bottom: 0;
  right: 0;
  height: 100%;
  width: 100%;
  pointer-events: none;
}

/* Vuetify's default v-card-text padding leaves a wide gap between the canvas
   and the toolbar below it; tighten it to a consistent 8px. */
.v-card >>> .v-card__text {
  padding-bottom: 8px;
}

/* v-card-actions' own default left/right padding (8px) doesn't match
   v-card-text's above (16px) - left as-is, the two rows' left edges land at
   different x positions, throwing off the toolbar row/clear-colors button's
   centering under the canvas/sidebar above them (confirmed as a real
   reported bug, visible once a caller has a color sidebar). Matched to
   v-card-text's left/right here (bottom bumped to the same 8px for a
   consistent gutter all around) so every tab using this component gets the
   same alignment without each caller redeclaring it - a caller nesting this
   inside its own already-padded card (e.g. BackgroundEditor.vue's
   .background-card) can zero this left/right padding back out locally to
   avoid doubling up. */
.pixel-editor-tools {
  padding: 0 16px 8px 16px;
}

/* Lays the optional color sidebar beside the canvas. align-items: stretch makes
   the sidebar exactly as tall as the canvas, so its rows line up 1:1. */
.editor-with-sidebar {
  display: flex;
  align-items: stretch;
}

.editor-sidebar {
  flex: 0 0 auto;
  display: flex;
}

.proportion-wrapper {
  position: relative;
  flex: 1 1 auto;
  min-width: 0;
}
.proportion-wrapper-stretcher {
  width: 100%;
}

/* Flat icon buttons: no grey box, no elevation, and a hit area only a little
   larger than the icon itself. */
.pixel-editor-tools >>> .v-btn {
  background-color: transparent !important;
  box-shadow: none !important;
  border: none !important;
  min-width: 0;
  height: 26px;
  width: 26px;
  margin: 0;
}

/* Vuetify paints its  grey hover/focus overlay here, which is the box we
   are removing; the states below replace it. */
.pixel-editor-tools >>> .v-btn::before {
  display: none;
}

/* Vuetify makes button icons inherit the button colour at a higher
   specificity, so these need to be forced. */
.pixel-editor-tools >>> .v-btn .v-icon {
  font-size: 19px;
  color: var(--editor-icon-rest-color, rgba(0, 0, 0, 0.38)) !important;
  transition: color 0.15s ease, transform 0.08s ease;
}

.pixel-editor-tools >>> .v-btn:hover .v-icon {
  color: rgba(0, 0, 0, 0.87) !important;
}

.pixel-editor-tools >>> .v-btn:active .v-icon {
  transform: scale(0.82);
}

/* Sits under the color sidebar, not the canvas. Width matched to
   PlayfieldColorStrip.vue's own 22px strip (not the generic 26px icon-
   button width above) so the icon centers under the swatches themselves;
   margin-right reproduces the strip's own 4px gap to the canvas, so the
   toolbar row beside it still starts exactly where the canvas does. */
.pixel-editor-clear-colors-btn {
  flex: 0 0 22px;
  width: 22px !important;
  margin-right: 4px !important;
}

/* The Clear button - centered as one group with the "toolbar-end" slot's
   own Copy/Paste (when a caller supplies them) under the graphic. */
.pixel-editor-hidden-toolbar-row {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1 1 auto;
  min-width: 0;
}
</style>
