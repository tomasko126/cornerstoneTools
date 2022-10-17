import EVENTS from './../../events.js';
import external from './../../externalModules.js';
import BaseAnnotationTool from './../base/BaseAnnotationTool.js';

// State
import {
  addToolState,
  getToolState,
} from './../../stateManagement/toolState.js';
import toolColors from './../../stateManagement/toolColors.js';
import { state } from '../../store/index.js';
import triggerEvent from '../../util/triggerEvent.js';

// Manipulators
import { moveHandleNearImagePoint } from '../../util/findAndMoveHelpers.js';

// Drawing
import { getNewContext, draw, drawJoinedLines } from '../../drawing/index.js';
import drawHandles from '../../drawing/drawHandles.js';
import { clipToBox } from '../../util/clip.js';
import { hideToolCursor, setToolCursor } from '../../store/setToolCursor.js';
import { freehandRoiCursor } from '../cursors/index.js';
import freehandUtils from '../../util/freehand/index.js';

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
      svgCursor: freehandRoiCursor,
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
      active: true,
      invalidated: true,
      color: undefined,
      handles: {
        points: [],
      },
    };
  }

  /**
   *
   *
   * @param {*} element element
   * @param {*} data data
   * @param {*} coords coords
   * @returns {Boolean}
   */
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

    if (isPointNearTool !== undefined) {
      return true;
    }

    return false;
  }

  /**
   * @param {*} element
   * @param {*} data
   * @param {*} coords
   * @returns {number} the distance in px from the provided coordinates to the
   * closest rendered portion of the annotation. -1 if the distance cannot be
   * calculated.
   */
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

  /**
   *
   *
   * @param {*} evt
   * @returns {undefined}
   */
  renderToolData(evt) {
    const eventData = evt.detail;

    // If we have no toolState for this element, return immediately as there is nothing to do
    const toolState = getToolState(evt.currentTarget, this.name);

    if (!toolState) {
      return;
    }

    const { element } = eventData;
    const config = this.configuration;

    // We have tool data for this element - iterate over each one and draw it
    const context = getNewContext(eventData.canvasContext.canvas);

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

          drawJoinedLines(context, element, points[0], points, options);

          if (!data.polyBoundingBox) {
            drawJoinedLines(
              context,
              element,
              points[points.length - 1],
              [config.mouseLocation.handles.start],
              options
            );
          }
        }

        // Draw handles
        options = {
          color,
          fill: fillColor,
        };

        if (config.alwaysShowHandles || (data.active && data.polyBoundingBox)) {
          // Render all handles
          options.handleRadius = config.activeHandleRadius;

          if (this.configuration.drawHandles) {
            drawHandles(context, eventData, data.handles.points, options);
          }
        }

        if (data.canComplete) {
          // Draw large handle at the origin if can complete drawing
          options.handleRadius = config.completeHandleRadius;
          const handle = data.handles.points[0];

          if (this.configuration.drawHandles) {
            drawHandles(context, eventData, [handle], options);
          }
        }

        if (data.active && !data.polyBoundingBox) {
          // Draw handle at origin and at mouse if actively drawing
          options.handleRadius = config.activeHandleRadius;

          if (this.configuration.drawHandles) {
            drawHandles(
              context,
              eventData,
              config.mouseLocation.handles,
              options
            );
          }

          const firstHandle = data.handles.points[0];

          if (this.configuration.drawHandles) {
            drawHandles(context, eventData, [firstHandle], options);
          }
        }
      });

      draw(context, context => {
        for (
          let pointIdx = 0;
          pointIdx < config.noOfSecondaryLines;
          pointIdx++
        ) {
          const color = toolColors.getColorIfActive(data);
          const options = { color };

          const points = toolState.data
            .filter((line, idx) => idx !== 0)
            .map(line => line.handles.points[pointIdx]);

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

  addNewMeasurement(evt) {
    const toolState = getToolState(this.element, this.name);

    if (toolState && toolState.data && toolState.data.length) {
      // Do not create another grid when there is already one
      return;
    }

    const config = this.configuration;

    for (let lineIdx = 0; lineIdx < config.noOfPrimaryLines; lineIdx++) {
      this.startDrawing();
      this.generatePrimaryLines();
      this.completeDrawing();
    }

    preventPropagation(evt);
  }

  handleSelectedCallback(evt, toolData, handle, interactionType = 'mouse') {
    const { element } = evt.detail;
    const toolState = getToolState(element, this.name);

    if (handle.hasBoundingBox) {
      // Use default move handler.
      moveHandleNearImagePoint(evt, this, toolData, handle, interactionType);

      return;
    }

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

    // Interupt eventDispatchers
    preventPropagation(evt);
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
    const toolState = getToolState(this.element, this.name);
    const config = this.configuration;
    const data = toolState.data[config.currentTool];

    if (data.handles.points.length >= 2) {
      const lastHandlePlaced = config.currentHandle;

      data.polyBoundingBox = {};
      this._endDrawing(lastHandlePlaced);
    }
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

    if (!config.moveOneHandleOnly) {
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
    } else {
      points[currentHandle].x = config.mouseLocation.handles.start.x;
      points[currentHandle].y = config.mouseLocation.handles.start.y;

      handleIndex = this._getPrevHandleIndex(currentHandle, points);

      if (currentHandle >= 0) {
        const lastLineIndex = points[handleIndex].lines.length - 1;
        const lastLine = points[handleIndex].lines[lastLineIndex];

        lastLine.x = config.mouseLocation.handles.start.x;
        lastLine.y = config.mouseLocation.handles.start.y;
      }
    }

    // Update the image
    external.cornerstone.updateImage(this.element);
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

    external.cornerstone.updateImage(this.element);
  }

  /**
   * Beginning of drawing loop when tool is active
   *
   * @returns {undefined}
   */
  startDrawing() {
    const measurementData = this.createNewMeasurement();
    const config = this.configuration;

    this._activateDraw();

    addToolState(this.element, this.name, measurementData);

    const toolState = getToolState(this.element, this.name);

    config.currentTool = toolState.data.length - 1;

    this._activeDrawingToolReference = toolState.data[config.currentTool];
  }

  /**
   * Ends the active drawing loop and completes the polygon.
   *
   * @private
   * @param {Object} handleNearby - the handle nearest to the mouse cursor.
   * @returns {undefined}
   */
  _endDrawing(handleNearby = undefined) {
    const toolState = getToolState(this.element, this.name);
    const config = this.configuration;
    const data = toolState.data[config.currentTool];

    data.active = false;
    data.highlight = false;

    // Connect the end handle to the origin handle todo
    if (handleNearby !== undefined) {
      const points = data.handles.points;

      points[config.currentHandle - 1].lines.push(points[0]);
    }

    if (this._modifying) {
      this._modifying = false;
      data.invalidated = true;
    }

    // Reset the current handle
    config.currentHandle = 0;
    config.currentTool = -1;
    data.canComplete = false;

    if (this._drawing) {
      this._deactivateDraw();
    }

    external.cornerstone.updateImage(this.element);

    this.fireModifiedEvent(data);
    this.fireCompletedEvent(data);
  }

  /**
   * Returns a handle of a particular tool if it is close to the mouse cursor
   *
   * @private
   * @param {Object} data      Data object associated with the tool.
   * @param {*} coords
   * @returns {Number|Object|Boolean}
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

  /**
   * Gets the current mouse location and stores it in the configuration object.
   *
   * @private
   * @param {Object} eventData The data assoicated with the event.
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
   * Adds drawing loop event listeners.
   *
   * @private
   * @returns {undefined}
   */
  _activateDraw() {
    this._drawing = true;

    state.isMultiPartToolActive = true;
    hideToolCursor(this.element);

    external.cornerstone.updateImage(this.element);
  }

  /**
   * Removes drawing loop event listeners.
   *
   * @private
   * @returns {undefined}
   */
  _deactivateDraw() {
    this._drawing = false;
    state.isMultiPartToolActive = false;
    this._activeDrawingToolReference = null;
    setToolCursor(this.element, this.svgCursor);

    external.cornerstone.updateImage(this.element);
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
   * @returns {undefined}
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
      // Actively drawing but changed mode.
      const config = this.configuration;
      const lastHandlePlaced = config.currentHandle;

      this._endDrawing(lastHandlePlaced);
      external.cornerstone.updateImage(this.element);
    }
  }

  /**
   * Fire MEASUREMENT_MODIFIED event on provided element
   * @param {any} measurementData the measurment data
   * @returns {void}
   */
  fireModifiedEvent(measurementData) {
    const eventType = EVENTS.MEASUREMENT_MODIFIED;
    const eventData = {
      toolName: this.name,
      toolType: this.name, // Deprecation notice: toolType will be replaced by toolName
      element: this.element,
      measurementData,
    };

    triggerEvent(this.element, eventType, eventData);
  }

  fireCompletedEvent(measurementData) {
    const eventType = EVENTS.MEASUREMENT_COMPLETED;
    const eventData = {
      toolName: this.name,
      toolType: this.name, // Deprecation notice: toolType will be replaced by toolName
      element: this.element,
      measurementData,
    };

    triggerEvent(this.element, eventType, eventData);
  }

  generatePrimaryLines() {
    const config = this.configuration;
    const x = config.currentTool * config.spacing;
    const spacing = config.spacing;

    const points = Array.from({ length: config.noOfSecondaryLines }, () =>
      Object({ x, y: 0 })
    ).map((point, idx, arr) => {
      if (idx === 0) {
        return point;
      }

      point.y = arr[idx - 1].y + spacing;

      return point;
    });

    for (const point of points) {
      this.addPoint(point);
    }
  }

  addPoint(point = { x: 0, y: 0 }) {
    const toolState = getToolState(this.element, this.name);

    // Get the toolState from the last-drawn polygon
    const config = this.configuration;
    const data = toolState.data[config.currentTool];

    const newHandleData = new FreehandHandleData(point);

    // If this is not the first handle
    if (data.handles.points.length) {
      // Add the line from the current handle to the new handle
      data.handles.points[config.currentHandle - 1].lines.push(point);
    }

    // Add the new handle
    data.handles.points.push(newHandleData);

    // Increment the current handle value
    config.currentHandle += 1;

    // Force onImageRendered to fire
    external.cornerstone.updateImage(this.element);
    this.fireModifiedEvent(data);
  }

  // ===================================================================
  // Public Configuration API. .
  // ===================================================================

  get activeHandleRadius() {
    return this.configuration.activeHandleRadius;
  }

  set activeHandleRadius(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set freehand activeHandleRadius to a value other than a number.'
      );
    }

    this.configuration.activeHandleRadius = value;
    external.cornerstone.updateImage(this.element);
  }

  get alwaysShowHandles() {
    return this.configuration.alwaysShowHandles;
  }

  set alwaysShowHandles(value) {
    if (typeof value !== 'boolean') {
      throw new Error(
        'Attempting to set freehand alwaysShowHandles to a value other than a boolean.'
      );
    }

    this.configuration.alwaysShowHandles = value;
    external.cornerstone.updateImage(this.element);
  }

  get moveOneHandleOnly() {
    return this.configuration.moveOneHandleOnly;
  }

  set moveOneHandleOnly(value) {
    if (typeof value !== 'boolean') {
      throw new Error(
        'Attempting to set moveOneHandleOnly to a value other than a boolean.'
      );
    }

    this.configuration.moveOneHandleOnly = value;
    external.cornerstone.updateImage(this.element);
  }

  get noOfPrimaryLines() {
    return this.configuration.noOfPrimaryLines;
  }

  set noOfPrimaryLines(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set noOfPrimaryLines to a value other than a number.'
      );
    }

    // todo: update grid and redraw image
    this.configuration.noOfPrimaryLines = value;
  }

  get noOfSecondaryLines() {
    return this.configuration.noOfSecondaryLines;
  }

  set noOfSecondaryLines(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set noOfSecondaryLines to a value other than a number.'
      );
    }

    // todo: update grid and redraw image
    this.configuration.noOfSecondaryLines = value;
  }

  get spacing() {
    return this.configuration.spacing;
  }

  set spacing(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set spacing to a value other than a number.'
      );
    }

    this.configuration.spacing = value;
    external.cornerstone.updateImage(this.element);
  }

  /**
   * New image event handler.
   *
   * @public
   * @returns {null}
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
    data.canComplete = false;

    this._deactivateDraw();

    external.cornerstone.updateImage(this.element);
  }
}

function defaultFreehandConfiguration() {
  return {
    activeHandleRadius: 2,
    alwaysShowHandles: true,
    currentHandle: 0,
    currentTool: -1,
    drawHandles: true,
    mouseLocation: {
      handles: {
        start: {
          highlight: true,
          active: true,
        },
      },
    },
    moveOneHandleOnly: true,
    noOfPrimaryLines: 10,
    noOfSecondaryLines: 10,
    spacing: 8,
  };
}

function preventPropagation(evt) {
  evt.stopImmediatePropagation();
  evt.stopPropagation();
  evt.preventDefault();
}
