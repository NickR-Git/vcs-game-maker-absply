'use strict';

import {useShiftKey} from '../hooks/shift-key';

// Same Shift-to-square constraint as rectangle-tool.js - equalizes the
// bounding box's width/height (preserving drag direction) so the oval
// becomes a circle instead of whatever aspect ratio the drag happened to be.
const squareEndpoint = (x0, y0, x1, y1) => {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const size = Math.max(Math.abs(dx), Math.abs(dy));
  const sx = dx < 0 ? -1 : 1;
  const sy = dy < 0 ? -1 : 1;
  return {x: x0 + sx * size, y: y0 + sy * size};
};

// Traces the ellipse inscribed in [xStart,yStart]-[xEnd,yEnd] by sampling
// angles around its center and rounding each to the nearest pixel cell,
// deduplicating via a Map keyed on that cell - rather than a classic
// midpoint-ellipse algorithm (which assumes an integer radius pair and
// gets awkward at the tiny, often even-width/height bounding boxes a pixel
// art canvas actually produces). Step count scales with size so adjacent
// samples never skip a pixel and leave a gap in the outline, while staying
// cheap at the small sizes these editors actually draw at.
const ellipseOutline = (xStart, yStart, xEnd, yEnd, color) => {
  const width = xEnd - xStart + 1;
  const height = yEnd - yStart + 1;
  const cx = xStart + (width - 1) / 2;
  const cy = yStart + (height - 1) / 2;
  const rx = width / 2;
  const ry = height / 2;
  const steps = Math.max(64, Math.ceil((rx + ry) * 4));

  const pixels = new Map();
  for (let i = 0; i < steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(angle) * rx);
    const y = Math.round(cy + Math.sin(angle) * ry);
    pixels.set(`${x},${y}`, {x, y, color});
  }
  return [...pixels.values()];
};

/**
 * An oval/circle-outline tool matching @curtishughes/pixel-editor's Tool
 * interface (handlePointerDown/handlePointerMove/handlePointerUp - see its
 * Pencil.js). The library has no ellipse tool at all, so this is built
 * from scratch, following the same drag-a-bounding-box shape as its
 * Rectangle tool (and this app's rectangle-tool.js) - the corner
 * dragged from is one corner of the ellipse's bounding box, the corner
 * dragged to is the opposite one.
 */
export default class Oval {
  /** @param {string} color */
  constructor(color) {
    this.color = color;
    this.startPosition = {x: -1, y: -1};
    this.dragging = false;
  }

  /** @return {void} */
  handlePointerUp() {
    this.dragging = false;
  }

  /**
   * @param {{x: number, y: number}} position
   * @param {Object} editor
   * @return {void}
   */
  handlePointerDown(position, editor) {
    this.dragging = true;
    this.startPosition = position;
    editor.set([{x: position.x, y: position.y, color: this.color}]);
  }

  /**
   * @param {{x: number, y: number}} position
   * @param {Object} editor
   * @return {void}
   */
  handlePointerMove(position, editor) {
    if (!this.dragging) return;
    const endPosition = useShiftKey().value ?
      squareEndpoint(this.startPosition.x, this.startPosition.y, position.x, position.y) : position;
    const xStart = Math.min(this.startPosition.x, endPosition.x);
    const yStart = Math.min(this.startPosition.y, endPosition.y);
    const xEnd = Math.max(this.startPosition.x, endPosition.x);
    const yEnd = Math.max(this.startPosition.y, endPosition.y);

    editor.undo();
    editor.set(ellipseOutline(xStart, yStart, xEnd, yEnd, this.color));
  }
}
