import EVENTS from './../../events.js';
import external from './../../externalModules.js';
import BaseAnnotationTool from './../base/BaseAnnotationTool.js';

// State
import {
  addToolState,
  getToolState,
} from './../../stateManagement/toolState.js';
import { state } from '../../store/index.js';

import toolColors from './../../stateManagement/toolColors.js';
import triggerEvent from '../../util/triggerEvent.js';

// Drawing
import { getNewContext, draw, drawJoinedLines } from '../../drawing/index.js';
import drawHandles from '../../drawing/drawHandles.js';
import { clipToBox } from '../../util/clip.js';

import freehandUtils from '../../util/freehand/index.js';

import { globalImageIdSpecificToolStateManager } from '../../stateManagement/imageIdSpecificStateManager.js';

const { FreehandHandleData } = freehandUtils;

/**
 * @public
 * @class FreehandRoiTool
 * @memberof Tools.Annotation
 * @classdesc Tool for drawing arbitrary polygonal regions of interest, and
 * measuring the statistics of the enclosed pixels.
 * @extends Tools.Base.BaseAnnotationTool
 */
export default class FreehandRoiTool extends BaseAnnotationTool {
  constructor(props = {}) {
    const defaultProps = {
      name: 'FreehandRoi',
      supportedInteractionTypes: ['Mouse'],
      configuration: defaultFreehandConfiguration(),
    };

    super(props, defaultProps);

    this.isMultiPartTool = true;

    this._drawing = false;
    this._modifying = false;

    // Create bound callback functions for private event loops
    this._editMouseUpCallback = this._editMouseUpCallback.bind(this);
    this._editMouseDragCallback = this._editMouseDragCallback.bind(this);
  }

  createNewMeasurement() {
    return {
      visible: true,
      active: false,
      invalidated: true,
      color: undefined,
      handles: {
        points: [],
      },
    };
  }

  pointNearTool(element, data, coords) {
    const validParameters = data && data.handles && data.handles.points;

    if (!validParameters) {
      throw new Error(
        `invalid parameters supplied to tool ${this.name}'s pointNearTool`
      );
    }

    if (!validParameters || data.visible === false) {
      return false;
    }

    const isPointNearTool = this._pointNearHandle(data, coords);

    return isPointNearTool !== undefined;
  }

  /**
   * Returns a handle of a particular tool if it is close to the mouse cursor.
   *
   * @private
   * @param {Object} data - data object associated with the tool.
   * @param {*} coords
   * @returns {number|void}
   */
  _pointNearHandle(data, coords) {
    if (data.handles === undefined || data.handles.points === undefined) {
      return;
    }

    if (data.visible === false) {
      return;
    }

    for (let i = 0; i < data.handles.points.length; i++) {
      const handleCanvas = external.cornerstone.pixelToCanvas(
        this.element,
        data.handles.points[i]
      );

      if (external.cornerstoneMath.point.distance(handleCanvas, coords) < 6) {
        return i;
      }
    }
  }

  distanceFromPoint(element, data, coords) {
    let distance = Infinity;

    for (let i = 0; i < data.handles.points.length; i++) {
      const distanceI = external.cornerstoneMath.point.distance(
        data.handles.points[i],
        coords
      );

      distance = Math.min(distance, distanceI);
    }

    // If an error caused distance not to be calculated, return -1.
    if (distance === Infinity) {
      return -1;
    }

    return distance;
  }

  renderToolData(evt) {
    const eventData = evt.detail;

    // If we have no toolState for this element, return immediately as there is nothing to do
    const toolState = getToolState(evt.currentTarget, this.name);

    if (!toolState) {
      return;
    }

    const { element, image } = eventData;

    // We have tool data for this element - iterate over each one and draw it
    const context = getNewContext(eventData.canvasContext.canvas);

    // Adjust spacing between points
    this.adjustSpacing(image.imageId);

    for (let i = 0; i < toolState.data.length; i++) {
      const data = toolState.data[i];

      if (data.visible === false) {
        continue;
      }

      draw(context, context => {
        let color = toolColors.getColorIfActive(data);
        let fillColor;

        if (data.active) {
          color = toolColors.getColorIfActive(data);
          fillColor = toolColors.getFillColor();
        } else {
          fillColor = toolColors.getToolColor();
        }

        let options = { color };

        if (data.handles.points.length) {
          const points = data.handles.points;

          // Draw primary lines
          drawJoinedLines(context, element, points[0], points, options);
        }

        // Draw handles
        options = {
          color,
          fill: fillColor,
          handleRadius: this.configuration.activeHandleRadius,
        };

        // Render all handles
        drawHandles(context, eventData, data.handles.points, options);
      });

      draw(context, context => {
        const options = { color: toolColors.getToolColor() };

        for (let pointIdx = 0; pointIdx < this.noOfSecondaryLines; pointIdx++) {
          const points = toolState.data
            .filter((line, idx) => idx !== 0)
            .map(line => line.handles.points[pointIdx]);

          // Draw secondary lines
          drawJoinedLines(
            context,
            element,
            toolState.data[0].handles.points[pointIdx],
            points,
            options
          );
        }
      });
    }
  }

  handleSelectedCallback(evt, toolData, handle, interactionType = 'mouse') {
    const { element } = evt.detail;
    const toolState = getToolState(element, this.name);

    const config = this.configuration;

    config.dragOrigin = {
      x: handle.x,
      y: handle.y,
    };

    // Iterating over handles of all toolData instances to find the indices of the selected handle
    for (let toolIndex = 0; toolIndex < toolState.data.length; toolIndex++) {
      const points = toolState.data[toolIndex].handles.points;

      for (let p = 0; p < points.length; p++) {
        if (points[p] === handle) {
          config.currentHandle = p;
          config.currentTool = toolIndex;
        }
      }
    }

    this._modifying = true;

    this._activateModify();

    // Interrupt eventDispatchers
    preventPropagation(evt);
  }

  addNewMeasurement(evt) {
    const toolState = getToolState(this.element, this.name);

    if (toolState && toolState.data && toolState.data.length) {
      // Do not create another grid when there is already one
      return;
    }

    this.activateDraw();

    for (let lineIdx = 0; lineIdx < this.noOfPrimaryLines; lineIdx++) {
      this.generatePrimaryLine(evt.detail.currentPoints.image);
    }

    this.completeDrawing();
    preventPropagation(evt);
  }

  /**
   * Beginning of drawing loop, when tool is active.
   *
   * @returns {void}
   */
  addNewMeasurementToState() {
    addToolState(this.element, this.name, this.createNewMeasurement());
  }

  /**
   * Adds drawing loop event listeners.
   *
   * @private
   * @returns {void}
   */
  activateDraw() {
    this._drawing = true;

    state.isMultiPartToolActive = true;

    const toolState = getToolState(this.element, this.name);

    if (toolState && toolState.data && toolState.data.length) {
      const config = this.configuration;

      config.currentTool = toolState.data.length - 1;
      this._activeDrawingToolReference = toolState.data[config.currentTool];
    }

    external.cornerstone.updateImage(this.element);
  }

  /** Ends the active drawing loop and completes the polygon.
   *
   * @public
   * @returns {null}
   */
  completeDrawing() {
    if (!this._drawing) {
      return null;
    }
    this._endDrawing();
  }

  /**
   * Ends the active drawing loop.
   *
   * @private
   * @returns {void}
   */
  _endDrawing() {
    const toolState = getToolState(this.element, this.name);
    const config = this.configuration;

    if (config.currentTool !== -1) {
      const data = toolState.data[config.currentTool];

      // They might have been already deleted
      if (data) {
        data.active = false;
        data.highlight = false;
      }
    }

    if (this._modifying) {
      this._modifying = false;
    }

    // Reset the current handle
    config.currentHandle = 0;
    config.currentTool = 0;

    if (this._drawing) {
      this._deactivateDraw();
    }

    external.cornerstone.updateImage(this.element);

    this.fireModifiedEvent();
    this.fireCompletedEvent();
  }

  /**
   * Removes drawing loop event listeners.
   *
   * @private
   * @returns {void}
   */
  _deactivateDraw() {
    this._drawing = false;
    state.isMultiPartToolActive = false;
    this._activeDrawingToolReference = null;
  }

  /**
   * Adds modify loop event listeners.
   *
   * @private
   * @returns {void}
   */
  _activateModify() {
    state.isToolLocked = true;

    this.element.addEventListener(EVENTS.MOUSE_UP, this._editMouseUpCallback);
    this.element.addEventListener(
      EVENTS.MOUSE_DRAG,
      this._editMouseDragCallback
    );

    external.cornerstone.updateImage(this.element);
  }

  /**
   * Removes modify loop event listeners.
   *
   * @private
   * @returns {void}
   */
  _deactivateModify() {
    state.isToolLocked = false;

    this.element.removeEventListener(
      EVENTS.MOUSE_UP,
      this._editMouseUpCallback
    );
    this.element.removeEventListener(
      EVENTS.MOUSE_DRAG,
      this._editMouseDragCallback
    );

    external.cornerstone.updateImage(this.element);
  }

  /**
   * Gets the current mouse location and stores it in the configuration object.
   *
   * @private
   * @param {Object} eventData The data associated with the event.
   * @returns {undefined}
   */
  _getMouseLocation(eventData) {
    const { currentPoints, image } = eventData;
    // Set the mouseLocation handle
    const config = this.configuration;

    config.mouseLocation.handles.start.x = currentPoints.image.x;
    config.mouseLocation.handles.start.y = currentPoints.image.y;
    clipToBox(config.mouseLocation.handles.start, image);
  }

  /**
   * Returns the previous handle to the current one.
   * @param {Number} currentHandle - the current handle index
   * @param {Array} points - the handles Array of the freehand data
   * @returns {Number} - The index of the previos handle
   */
  _getPrevHandleIndex(currentHandle, points) {
    if (currentHandle === 0) {
      return points.length - 1;
    }

    return currentHandle - 1;
  }

  /**
   * Event handler for MOUSE_UP during handle drag event loop.
   *
   * @private
   * @returns {undefined}
   */
  _editMouseUpCallback() {
    this._deactivateModify();
    this._endDrawing();
  }

  /**
   * Event handler for MOUSE_DRAG during handle drag event loop.
   *
   * @event
   * @param {Object} evt - The event.
   * @returns {undefined}
   */
  _editMouseDragCallback(evt) {
    const eventData = evt.detail;
    const { buttons } = eventData;

    if (!this.options.mouseButtonMask.includes(buttons)) {
      return;
    }

    const toolState = getToolState(this.element, this.name);

    const config = this.configuration;
    const data = toolState.data[config.currentTool];
    const currentHandle = config.currentHandle;
    const points = data.handles.points;
    let handleIndex = -1;

    // Set the mouseLocation handle
    this._getMouseLocation(eventData);

    data.active = true;
    data.highlight = true;

    if (this.moveOneHandleOnly) {
      points[currentHandle].x = config.mouseLocation.handles.start.x;
      points[currentHandle].y = config.mouseLocation.handles.start.y;

      handleIndex = this._getPrevHandleIndex(currentHandle, points);

      if (currentHandle > 0) {
        const lastLineIndex = points[handleIndex].lines.length - 1;
        const lastLine = points[handleIndex].lines[lastLineIndex];

        lastLine.x = config.mouseLocation.handles.start.x;
        lastLine.y = config.mouseLocation.handles.start.y;
      }
    } else {
      const xChange =
        config.mouseLocation.handles.start.x - points[currentHandle].x;
      const yChange =
        config.mouseLocation.handles.start.y - points[currentHandle].y;

      for (const tool of toolState.data) {
        for (const point of tool.handles.points) {
          point.x += xChange;
          point.y += yChange;
        }
      }
    }

    // Update the image
    external.cornerstone.updateImage(this.element);
  }

  passiveCallback() {
    this._closeToolIfDrawing();
  }

  enabledCallback() {
    this._closeToolIfDrawing();
  }

  disabledCallback() {
    this._closeToolIfDrawing();
  }

  _closeToolIfDrawing() {
    if (this._drawing) {
      this._endDrawing();
    }
  }

  /**
   * New image event handler.
   *
   * @public
   * @returns {null|void}
   */
  newImageCallback() {
    const config = this.configuration;

    if (!(this._drawing && this._activeDrawingToolReference)) {
      return null;
    }

    // Actively drawing but scrolled to different image.
    const data = this._activeDrawingToolReference;

    data.active = false;
    data.highlight = false;

    // Reset the current handle
    config.currentHandle = 0;
    config.currentTool = -1;

    this._deactivateDraw();

    external.cornerstone.updateImage(this.element);
  }

  getToolsStateAndConfig() {
    const toolState = getToolState(this.element, this.name);

    return {
      config: this.configuration,
      state: toolState.data,
    };
  }

  /**
   * Fire MEASUREMENT_MODIFIED event on provided element
   *
   * @returns {void}
   */
  fireModifiedEvent() {
    const eventType = EVENTS.MEASUREMENT_MODIFIED;
    const eventData = {
      toolName: this.name,
      toolType: this.name, // Deprecation notice: toolType will be replaced by toolName
      element: this.element,
      measurementData: this.getToolsStateAndConfig(),
    };

    triggerEvent(this.element, eventType, eventData);
  }

  /**
   * Fire MEASUREMENT_COMPLETED event on current element
   *
   * @returns {void}
   */
  fireCompletedEvent() {
    const eventType = EVENTS.MEASUREMENT_COMPLETED;
    const eventData = {
      toolName: this.name,
      toolType: this.name, // Deprecation notice: toolType will be replaced by toolName
      element: this.element,
      measurementData: this.getToolsStateAndConfig(),
    };

    triggerEvent(this.element, eventType, eventData);
  }

  /**
   * Generate new primary line with points respecting direction and length of previous points
   *
   * @param {{ x: number, y: number }|null} [position=null]
   * @returns {void}
   */
  generatePrimaryLine(position = null) {
    // Add new measurement to tool's state
    this.addNewMeasurementToState();

    const config = this.configuration;
    const toolState = getToolState(this.element, this.name);

    let points = [];

    if (toolState.data.length > 1) {
      const prevPrimaryLine = toolState.data[toolState.data.length - 2];
      const prevPrevPrimaryLine = toolState.data[toolState.data.length - 3];

      for (let idx = 0; idx < this.noOfSecondaryLines; idx++) {
        let xDiff, yDiff;

        if (prevPrevPrimaryLine) {
          xDiff =
            prevPrimaryLine.handles.points[idx].x -
            prevPrevPrimaryLine.handles.points[idx].x;

          yDiff =
            prevPrimaryLine.handles.points[idx].y -
            prevPrevPrimaryLine.handles.points[idx].y;
        } else {
          xDiff = this.spacing;
          yDiff = 0;
        }

        const x = prevPrimaryLine.handles.points[idx].x + xDiff;
        const y = prevPrimaryLine.handles.points[idx].y + yDiff;

        points.push({ x, y, primaryLineIdx: toolState.data.length - 1 });
      }
    } else {
      // We are generating first primary line
      const x = position.x + config.currentTool * this.spacing;

      points = Array.from({ length: this.noOfSecondaryLines }, () =>
        Object({ x, y: position.y, primaryLineIdx: 0 })
      ).map((point, idx, arr) => {
        if (idx === 0) {
          return point;
        }

        point.y = arr[idx - 1].y + this.spacing;

        return point;
      });
    }

    points.forEach(point => {
      this.addPoint(point, point.primaryLineIdx);
    });
  }

  /**
   * Remove last primary line from grid
   *
   * @returns {void}
   */
  removeLastPrimaryLine() {
    const toolState = getToolState(this.element, this.name);

    toolState.data.pop();
  }

  /**
   * Generate new secondary line with points respecting direction and length of previous points
   *
   * @returns {void}
   */
  generateSecondaryLine() {
    const toolState = getToolState(this.element, this.name);

    for (let idx = 0; idx < this.noOfPrimaryLines; idx++) {
      const noOfPoints = toolState.data[idx].handles.points.length;

      const prevPoint = toolState.data[idx].handles.points[noOfPoints - 1];
      const prevPrevPoint = toolState.data[idx].handles.points[noOfPoints - 2];

      let xDiff, yDiff;

      if (prevPrevPoint) {
        xDiff = prevPoint.x - prevPrevPoint.x;
        yDiff = prevPoint.y - prevPrevPoint.y;
      } else {
        xDiff = 0;
        yDiff = this.spacing;
      }

      const x = prevPoint.x + xDiff;
      const y = prevPoint.y + yDiff;

      this.addPoint({ x, y }, idx);
    }
  }

  /**
   * Remove last secondary line from grid
   *
   * @returns {void}
   */
  removeLastSecondaryLine() {
    const toolState = getToolState(this.element, this.name);

    for (let idx = 0; idx < this.noOfPrimaryLines; idx++) {
      toolState.data[idx].handles.points.pop();

      const noOfPoints = toolState.data[idx].handles.points.length;
      const lastPoint = toolState.data[idx].handles.points[noOfPoints - 1];

      lastPoint.lines = [];
    }
  }

  /**
   * Store given point in tool's state along with line to the previous primary point
   *
   * @param {Object<{ x: number, y: number}>} point
   * @param {number} primaryLineIdx - primary line index, which given point will belong to
   * @returns {void}
   */
  addPoint(point = { x: 0, y: 0 }, primaryLineIdx) {
    const toolState = getToolState(this.element, this.name);

    const primaryLine = toolState.data[primaryLineIdx];

    const newHandleData = new FreehandHandleData(point);

    // If this is not the first handle
    if (primaryLine.handles.points.length) {
      // Add the line from the current handle to the new handle
      primaryLine.handles.points[
        primaryLine.handles.points.length - 1
      ].lines.push(point);
    }

    // Add the new handle
    primaryLine.handles.points.push(newHandleData);

    // Force onImageRendered to fire
    external.cornerstone.updateImage(this.element);
    this.fireModifiedEvent();
  }

  // ===================================================================
  // Helper methods .
  // ===================================================================

  /**
   * Check, if grid spacing needs to be adjusted
   *
   * @param {string} imageId
   * @returns {void}
   */
  adjustSpacing(imageId) {
    if (!this.configuration.spacing.hasOwnProperty(imageId)) {
      this.configuration.spacing[imageId] = this.spacing;
    }
    if (this.spacing === this.configuration.spacing[imageId]) {
      return;
    }
    this.onSpacingChange(this.spacing, imageId);
  }

  /**
   * Adjust grid spacing for given image, if it was changed
   *
   * @param {number} newSpacing
   * @param {string} imageId
   * @returns {void}
   */
  onSpacingChange(newSpacing, imageId) {
    const existingSpacing = this.configuration.spacing[imageId];
    const spacingChange = newSpacing - existingSpacing;

    const toolState = getToolState(this.element, this.name);

    this.activateDraw();

    for (
      let primaryLineIdx = 0;
      primaryLineIdx < toolState.data.length;
      primaryLineIdx++
    ) {
      let primaryLinePoints = toolState.data[primaryLineIdx].handles.points;

      primaryLinePoints = primaryLinePoints.map((point, pointIdx) => {
        point.x += primaryLineIdx * spacingChange;
        if (pointIdx !== 0) {
          point.y += pointIdx * spacingChange;
        }

        return point;
      });
    }

    this.completeDrawing();

    this.configuration.spacing.global = newSpacing;
    this.configuration.spacing[imageId] = newSpacing;
  }

  /**
   * Get grid's middle point coordinates
   *
   * @returns {{x: number, y: number}|null}
   */
  getGridMiddlePointCoords() {
    const toolState = getToolState(this.element, this.name);

    if (!toolState.data.length) {
      return null;
    }

    const upperLeft = toolState.data[0].handles.points[0];
    const bottomRight =
      toolState.data[toolState.data.length - 1].handles.points[
        toolState.data[toolState.data.length - 1].handles.points.length - 1
      ];

    const x = (upperLeft.x + bottomRight.x) / 2;
    const y = (upperLeft.y + bottomRight.y) / 2;

    return { x, y };
  }

  // ===================================================================
  // Public Configuration API. .
  // ===================================================================

  /**
   * Get grid's moving mode
   * @returns {boolean}
   */
  get moveOneHandleOnly() {
    return this.configuration.moveOneHandleOnly;
  }

  /**
   * Set moving mode for grid
   * @param {boolean} value - if true, moves with selected point, otherwise moves with whole grid
   */
  set moveOneHandleOnly(value) {
    if (typeof value !== 'boolean') {
      throw new Error(
        'Attempting to set moveOneHandleOnly to a value other than a boolean.'
      );
    }

    this.configuration.moveOneHandleOnly = value;
    external.cornerstone.updateImage(this.element);
  }

  /**
   * Get number of primary lines for current image's grid
   * @returns {number}
   */
  get noOfPrimaryLines() {
    return this.configuration.noOfPrimaryLines.global;
  }

  /**
   * Set number of primary lines for current image's grid
   * @param {number} newNoOfPrimaryLines
   */
  set noOfPrimaryLines(newNoOfPrimaryLines) {
    if (typeof newNoOfPrimaryLines !== 'number') {
      throw new Error(
        'Attempting to set noOfPrimaryLines to a value other than a number.'
      );
    }

    let existingNoOfPrimaryLines = this.noOfPrimaryLines;

    if (newNoOfPrimaryLines === existingNoOfPrimaryLines) {
      return;
    }

    this.activateDraw();

    if (newNoOfPrimaryLines > existingNoOfPrimaryLines) {
      while (existingNoOfPrimaryLines < newNoOfPrimaryLines) {
        this.generatePrimaryLine();
        existingNoOfPrimaryLines++;
      }
    } else {
      while (existingNoOfPrimaryLines > newNoOfPrimaryLines) {
        this.removeLastPrimaryLine();
        existingNoOfPrimaryLines--;
      }
    }

    this.completeDrawing();

    this.configuration.noOfPrimaryLines.global = newNoOfPrimaryLines;
  }

  /**
   * Get number of secondary lines for current image's grid
   * @returns {number}
   */
  get noOfSecondaryLines() {
    return this.configuration.noOfSecondaryLines.global;
  }

  /**
   * Set number of secondary lines for current image's grid
   * @param {number} newNoOfSecondaryLines
   */
  set noOfSecondaryLines(newNoOfSecondaryLines) {
    if (typeof newNoOfSecondaryLines !== 'number') {
      throw new Error(
        'Attempting to set noOfSecondaryLines to a value other than a number.'
      );
    }

    let existingNoOfSecondaryLines = this.noOfSecondaryLines;

    if (newNoOfSecondaryLines === existingNoOfSecondaryLines) {
      return;
    }

    this.activateDraw();

    if (newNoOfSecondaryLines > existingNoOfSecondaryLines) {
      while (existingNoOfSecondaryLines < newNoOfSecondaryLines) {
        this.generateSecondaryLine();
        existingNoOfSecondaryLines++;
      }
    } else {
      while (existingNoOfSecondaryLines > newNoOfSecondaryLines) {
        this.removeLastSecondaryLine();
        existingNoOfSecondaryLines--;
      }
    }

    this.completeDrawing();
    this.configuration.noOfSecondaryLines.global = newNoOfSecondaryLines;
  }

  /**
   * Get grid spacing of current image
   * @returns {number}
   */
  get spacing() {
    return this.configuration.spacing.global;
  }

  /**
   * Set grid's spacing for current image
   * @param {number} value
   */
  set spacing(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set spacing to a value other than a number.'
      );
    }

    const imageId = external.cornerstone.getImage(this.element).imageId;

    this.onSpacingChange(value, imageId);
  }

  /**
   * Rotate grid around its center by angle
   *
   * @param {number} angle - in degrees
   * @returns {void}
   */
  rotateGrid(angle) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState.data.length) {
      return;
    }

    const middle = this.getGridMiddlePointCoords();

    this.activateDraw();

    for (const primaryLine of toolState.data) {
      for (const point of primaryLine.handles.points) {
        const c = Math.cos((angle * Math.PI) / 180);
        const s = Math.sin((angle * Math.PI) / 180);

        const x = point.x - middle.x;
        const y = point.y - middle.y;

        point.x = x * c - y * s + middle.x;
        point.y = x * s + y * c + middle.y;
      }
    }

    this.completeDrawing();
  }
}

function defaultFreehandConfiguration() {
  return {
    activeHandleRadius: 2,
    currentHandle: 0,
    currentTool: -1,
    mouseLocation: {
      handles: {
        start: {
          highlight: false,
          active: false,
        },
      },
    },
    moveOneHandleOnly: true,
    noOfPrimaryLines: {
      global: 10,
    },
    noOfSecondaryLines: {
      global: 10,
    },
    spacing: {
      global: 5,
    },
  };
}

function preventPropagation(evt) {
  evt.stopImmediatePropagation();
  evt.stopPropagation();
  evt.preventDefault();
}
