import EVENTS from './../../events.js';
import external from './../../externalModules.js';
import BaseAnnotationTool from './../base/BaseAnnotationTool.js';

// State
import {
  addToolState,
  getToolState,
} from './../../stateManagement/toolState.js';
import toolStyle from './../../stateManagement/toolStyle.js';
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
import { getLogger } from '../../util/logger.js';
import { getModule } from '../../store/index';

const logger = getLogger('tools:annotation:FreehandRoiTool');

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

  createNewMeasurement(eventData) {
    const goodEventData =
      eventData && eventData.currentPoints && eventData.currentPoints.image;

    if (!goodEventData) {
      logger.error(
        `required eventData not supplied to tool ${this.name}'s createNewMeasurement`
      );

      return;
    }

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

    const isPointNearTool = this._pointNearHandle(element, data, coords);

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

    const { image, element } = eventData;
    const config = this.configuration;
    const seriesModule = external.cornerstone.metaData.get(
      'generalSeriesModule',
      image.imageId
    );
    const modality = seriesModule ? seriesModule.modality : null;

    // We have tool data for this element - iterate over each one and draw it
    const context = getNewContext(eventData.canvasContext.canvas);
    const lineWidth = toolStyle.getToolWidth();
    const { renderDashed } = config;
    const lineDash = getModule('globalConfiguration').configuration.lineDash;

    for (let i = 0; i < toolState.data.length; i++) {
      const data = toolState.data[i];

      if (data.visible === false) {
        continue;
      }

      draw(context, context => {
        let color = toolColors.getColorIfActive(data);
        let fillColor;

        if (data.active) {
          if (data.handles.invalidHandlePlacement) {
            color = config.invalidColor;
            fillColor = config.invalidColor;
          } else {
            color = toolColors.getColorIfActive(data);
            fillColor = toolColors.getFillColor();
          }
        } else {
          fillColor = toolColors.getToolColor();
        }

        let options = { color };

        if (renderDashed) {
          options.lineDash = lineDash;
        }

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
        for (let pointIdx = 0; pointIdx < 5; pointIdx++) {
          // todo: make max number dynamic
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
    const eventData = evt.detail;
    const toolState = getToolState(eventData.element, this.name);

    if (toolState && toolState.data && toolState.data.length) {
      // Do not create another grid when there is already one
      return;
    }

    const NO_OF_PRIMARY_LINES = 10; // todo: make this dynamic

    for (let lineIdx = 0; lineIdx < NO_OF_PRIMARY_LINES; lineIdx++) {
      this.startDrawing(evt);
      this.addPrimaryLines(eventData.element);
      this.completeDrawing(eventData.element);
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

    this._activateModify(element);

    // Interupt eventDispatchers
    preventPropagation(evt);
  }

  /** Ends the active drawing loop and completes the polygon.
   *
   * @public
   * @param {Object} element - The element on which the roi is being drawn.
   * @returns {null}
   */
  completeDrawing(element) {
    if (!this._drawing) {
      return;
    }
    const toolState = getToolState(element, this.name);
    const config = this.configuration;
    const data = toolState.data[config.currentTool];

    if (data.handles.points.length >= 2) {
      const lastHandlePlaced = config.currentHandle;

      data.polyBoundingBox = {};
      this._endDrawing(element, lastHandlePlaced);
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
    const { element, buttons } = eventData;

    if (!this.options.mouseButtonMask.includes(buttons)) {
      return;
    }

    const toolState = getToolState(element, this.name);

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
    external.cornerstone.updateImage(element);
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
   * @param {Object} evt - The event.
   * @returns {undefined}
   */
  _editMouseUpCallback(evt) {
    const eventData = evt.detail;
    const { element } = eventData;

    this._deactivateModify(element);
    this._endDrawing(element);

    external.cornerstone.updateImage(element);
  }

  /**
   * Beginning of drawing loop when tool is active
   *
   * @param {Object} evt - The event.
   * @returns {undefined}
   */
  startDrawing(evt) {
    const eventData = evt.detail;
    const measurementData = this.createNewMeasurement(eventData);
    const { element } = eventData;
    const config = this.configuration;

    this._activateDraw(element);

    addToolState(element, this.name, measurementData);

    const toolState = getToolState(element, this.name);

    config.currentTool = toolState.data.length - 1;

    this._activeDrawingToolReference = toolState.data[config.currentTool];
  }

  /**
   * Ends the active drawing loop and completes the polygon.
   *
   * @private
   * @param {Object} element - The element on which the roi is being drawn.
   * @param {Object} handleNearby - the handle nearest to the mouse cursor.
   * @returns {undefined}
   */
  _endDrawing(element, handleNearby) {
    const toolState = getToolState(element, this.name);
    const config = this.configuration;
    const data = toolState.data[config.currentTool];

    data.active = false;
    data.highlight = false;
    data.handles.invalidHandlePlacement = false;

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
      this._deactivateDraw(element);
    }

    external.cornerstone.updateImage(element);

    this.fireModifiedEvent(element, data);
    this.fireCompletedEvent(element, data);
  }

  /**
   * Returns a handle of a particular tool if it is close to the mouse cursor
   *
   * @private
   * @param {Object} element - The element on which the roi is being drawn.
   * @param {Object} data      Data object associated with the tool.
   * @param {*} coords
   * @returns {Number|Object|Boolean}
   */
  _pointNearHandle(element, data, coords) {
    if (data.handles === undefined || data.handles.points === undefined) {
      return;
    }

    if (data.visible === false) {
      return;
    }

    for (let i = 0; i < data.handles.points.length; i++) {
      const handleCanvas = external.cornerstone.pixelToCanvas(
        element,
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
   * @param {Object} element - The viewport element to add event listeners to.
   * @modifies {element}
   * @returns {undefined}
   */
  _activateDraw(element) {
    this._drawing = true;

    state.isMultiPartToolActive = true;
    hideToolCursor(this.element);

    external.cornerstone.updateImage(element);
  }

  /**
   * Removes drawing loop event listeners.
   *
   * @private
   * @param {Object} element - The viewport element to add event listeners to.
   * @modifies {element}
   * @returns {undefined}
   */
  _deactivateDraw(element) {
    this._drawing = false;
    state.isMultiPartToolActive = false;
    this._activeDrawingToolReference = null;
    setToolCursor(this.element, this.svgCursor);

    external.cornerstone.updateImage(element);
  }

  /**
   * Adds modify loop event listeners.
   *
   * @private
   * @param {Object} element - The viewport element to add event listeners to.
   * @modifies {element}
   * @returns {void}
   */
  _activateModify(element) {
    state.isToolLocked = true;

    element.addEventListener(EVENTS.MOUSE_UP, this._editMouseUpCallback);
    element.addEventListener(EVENTS.MOUSE_DRAG, this._editMouseDragCallback);

    external.cornerstone.updateImage(element);
  }

  /**
   * Removes modify loop event listeners.
   *
   * @private
   * @param {Object} element - The viewport element to add event listeners to.
   * @modifies {element}
   * @returns {undefined}
   */
  _deactivateModify(element) {
    state.isToolLocked = false;

    element.removeEventListener(EVENTS.MOUSE_UP, this._editMouseUpCallback);
    element.removeEventListener(EVENTS.MOUSE_DRAG, this._editMouseDragCallback);

    external.cornerstone.updateImage(element);
  }

  passiveCallback(element) {
    this._closeToolIfDrawing(element);
  }

  enabledCallback(element) {
    this._closeToolIfDrawing(element);
  }

  disabledCallback(element) {
    this._closeToolIfDrawing(element);
  }

  _closeToolIfDrawing(element) {
    if (this._drawing) {
      // Actively drawing but changed mode.
      const config = this.configuration;
      const lastHandlePlaced = config.currentHandle;

      this._endDrawing(element, lastHandlePlaced);
      external.cornerstone.updateImage(element);
    }
  }

  /**
   * Fire MEASUREMENT_MODIFIED event on provided element
   * @param {any} element which freehand data has been modified
   * @param {any} measurementData the measurment data
   * @returns {void}
   */
  fireModifiedEvent(element, measurementData) {
    const eventType = EVENTS.MEASUREMENT_MODIFIED;
    const eventData = {
      toolName: this.name,
      toolType: this.name, // Deprecation notice: toolType will be replaced by toolName
      element,
      measurementData,
    };

    triggerEvent(element, eventType, eventData);
  }

  fireCompletedEvent(element, measurementData) {
    const eventType = EVENTS.MEASUREMENT_COMPLETED;
    const eventData = {
      toolName: this.name,
      toolType: this.name, // Deprecation notice: toolType will be replaced by toolName
      element,
      measurementData,
    };

    triggerEvent(element, eventType, eventData);
  }

  addPrimaryLines(element) {
    const config = this.configuration;
    const x = config.currentTool * 5;

    for (const point of [
      { x, y: 0 },
      { x, y: 5 },
      { x, y: 10 },
      { x, y: 15 },
      { x, y: 20 },
    ]) {
      this.addPoint(element, point);
    }
  }

  addPoint(element, point = { x: 0, y: 0 }) {
    const toolState = getToolState(element, this.name);

    // Get the toolState from the last-drawn polygon
    const config = this.configuration;
    const data = toolState.data[config.currentTool];

    if (data.handles.invalidHandlePlacement) {
      return;
    }

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
    external.cornerstone.updateImage(element);
    this.fireModifiedEvent(element, data);
  }

  // ===================================================================
  // Public Configuration API. .
  // ===================================================================

  get spacing() {
    return this.configuration.spacing;
  }

  set spacing(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set freehand spacing to a value other than a number.'
      );
    }

    this.configuration.spacing = value;
    external.cornerstone.updateImage(this.element);
  }

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

  get completeHandleRadius() {
    return this.configuration.completeHandleRadius;
  }

  set completeHandleRadius(value) {
    if (typeof value !== 'number') {
      throw new Error(
        'Attempting to set freehand completeHandleRadius to a value other than a number.'
      );
    }

    this.configuration.completeHandleRadius = value;
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

  get invalidColor() {
    return this.configuration.invalidColor;
  }

  set invalidColor(value) {
    /*
      It'd be easy to check if the color was e.g. a valid rgba color. However
      it'd be difficult to check if the color was a named CSS color without
      bloating the library, so we don't. If the canvas can't intepret the color
      it'll show up grey.
    */

    this.configuration.invalidColor = value;
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
  }

  /**
   * New image event handler.
   *
   * @public
   * @param  {Object} evt The event.
   * @returns {null}
   */
  newImageCallback(evt) {
    const config = this.configuration;

    if (!(this._drawing && this._activeDrawingToolReference)) {
      return;
    }

    // Actively drawing but scrolled to different image.
    const element = evt.detail.element;
    const data = this._activeDrawingToolReference;

    data.active = false;
    data.highlight = false;
    data.handles.invalidHandlePlacement = false;

    // Reset the current handle
    config.currentHandle = 0;
    config.currentTool = -1;
    data.canComplete = false;

    this._deactivateDraw(element);

    external.cornerstone.updateImage(element);
  }

  mouseMoveCallback(evt) {}
}

function defaultFreehandConfiguration() {
  return {
    mouseLocation: {
      handles: {
        start: {
          highlight: true,
          active: true,
        },
      },
    },
    spacing: 1,
    activeHandleRadius: 3,
    completeHandleRadius: 6,
    alwaysShowHandles: true,
    invalidColor: 'crimson',
    currentHandle: 0,
    currentTool: -1,
    drawHandles: true,
    renderDashed: false,
    moveOneHandleOnly: true,
  };
}

function preventPropagation(evt) {
  evt.stopImmediatePropagation();
  evt.stopPropagation();
  evt.preventDefault();
}
