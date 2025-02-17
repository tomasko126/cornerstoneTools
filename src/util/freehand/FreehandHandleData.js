/**
 * @public
 * @name FreehandHandleData
 * @classdesc Creates a single handle for the freehand tool.
 *
 * @property {number} x The x position.
 * @property {number} y The y position.
 * @property {boolean} highlight Whether the handle should be rendered as the highlighted color.
 * @property {boolean} active Whether the handle is active.
 * @property {Object} lines An array of lines associated with the handle.
 */
export default class FreehandHandleData {
  /**
   * Constructs a single handle for the freehand tool
   *
   * @param {Object} position - The position of the handle.
   * @param {boolean} isCommonPoint - whether the point is main 'common' or 'refinement' one dedicated for grid refinement
   * @param {boolean} highlight - whether the handle should be rendered as the highlighted color.
   * @param {boolean} active - whether the handle is active.
   */
  constructor(
    position,
    isCommonPoint = false,
    highlight = true,
    active = true
  ) {
    this.x = position.x;
    this.y = position.y;
    this.isCommonPoint = isCommonPoint;
    this.highlight = highlight;
    this.active = active;
    this.lines = [];
  }
}
