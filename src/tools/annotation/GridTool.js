import EVENTS from './../../events.js';
import external from './../../externalModules.js';
import BaseAnnotationTool from './../base/BaseAnnotationTool.js';

// State
import {
  addToolState,
  clearToolState,
  getToolState,
} from './../../stateManagement/toolState.js';
import { state } from '../../store/index.js';

import toolColors from './../../stateManagement/toolColors.js';
import triggerEvent from '../../util/triggerEvent.js';

// Drawing
import { draw, drawJoinedLines, getNewContext } from '../../drawing/index.js';
import drawHandles from '../../drawing/drawHandles.js';
import { clipToBox } from '../../util/clip.js';

import freehandUtils from '../../util/freehand/index.js';

const { FreehandHandleData } = freehandUtils;

/**
 * @public
 * @class GridTool
 * @memberof Tools.Annotation
 * @classdesc Tool for drawing grid onto canvas
 * @extends Tools.Base.BaseAnnotationTool
 */
export default class GridTool extends BaseAnnotationTool {
  constructor(props = {}) {
    const defaultProps = {
      name: 'Grid',
      supportedInteractionTypes: ['Mouse'],
      configuration: defaultToolConfiguration(),
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

    const { element } = eventData;

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

        if (
          data.handles.points.length &&
          data.handles.points[0].isCommonPoint
        ) {
          // Draw primary lines
          drawJoinedLines(
            context,
            element,
            data.handles.points[0],
            data.handles.points,
            options
          );
        }

        // Draw handles
        options = {
          color,
          fill: fillColor,
          handleRadius: this.configuration.handleRadius,
        };

        const commonPoints = data.handles.points.filter(
          point => point.isCommonPoint
        );

        drawHandles(context, eventData, commonPoints, options);

        const refinementPoints = data.handles.points.filter(
          point => !point.isCommonPoint
        );

        options.handleRadius -= 2;
        drawHandles(context, eventData, refinementPoints, options);
      });

      draw(context, context => {
        const options = { color: toolColors.getToolColor() };

        let pointsIdxOnPrimaryLineWithoutRefinementPoints = 0;

        for (
          let secondaryLineIdx = 0;
          secondaryLineIdx < this.totalNoOfSecondaryLines;
          secondaryLineIdx++
        ) {
          if (
            !toolState.data[0].handles.points[secondaryLineIdx].isCommonPoint
          ) {
            continue;
          }

          const points = toolState.data
            .filter((primaryLine, primaryLineIdx) => primaryLineIdx !== 0)
            .map((line, idx) => {
              if (this.showRefinementPoints) {
                if ((idx + 1) % 4 === 0) {
                  return line.handles.points[secondaryLineIdx];
                }

                return line.handles.points[
                  pointsIdxOnPrimaryLineWithoutRefinementPoints
                ];
              }

              return line.handles.points[secondaryLineIdx];
            });

          // Draw secondary lines
          drawJoinedLines(
            context,
            element,
            toolState.data[0].handles.points[secondaryLineIdx],
            points,
            options
          );

          pointsIdxOnPrimaryLineWithoutRefinementPoints++;
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

    for (
      let lineIdx = 0;
      lineIdx < this.configuration.noOfPrimaryLines.default;
      lineIdx++
    ) {
      this.generateMainPrimaryLine(lineIdx, evt.detail.currentPoints.image);
    }

    if (this.showRefinementPoints) {
      this.generateRefinementPointsOnCurrentPrimaryLines();
      this.generateSubsidiaryPrimaryLines(
        0,
        this.configuration.noOfPrimaryLines.default - 1
      );
    }

    this.completeDrawing();
    preventPropagation(evt);
  }

  /**
   * Beginning of drawing loop, when tool is active.
   *
   * @param {Number} idx - index of data, where they should be inserted
   * @returns {void}
   */
  addNewMeasurementToState(idx = null) {
    addToolState(this.element, this.name, this.createNewMeasurement(), idx);
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
   * @param {number} currentHandle - the current handle index
   * @param {array} points - the handles - array of the grid data
   * @returns {number} - The index of the previous handle
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
      this.setOffset(config.mouseLocation.handles.start, true);
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
      state: toolState ? toolState.data : [],
    };
  }

  /**
   * Fire MEASUREMENT_REMOVED event on current element
   *
   * @returns {void}
   */
  fireRemovedEvent() {
    const eventType = EVENTS.MEASUREMENT_REMOVED;
    const eventData = {
      toolName: this.name,
      toolType: this.name, // Deprecation notice: toolType will be replaced by toolName
      element: this.element,
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

  containsPrimaryLineRefinementPoints(primaryLineIdx) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    const primaryLinePointsLength =
      toolState.data[primaryLineIdx].handles.points.length;

    for (
      let secondaryLineIdx = 0;
      secondaryLineIdx < primaryLinePointsLength;
      secondaryLineIdx++
    ) {
      const point =
        toolState.data[primaryLineIdx].handles.points[secondaryLineIdx];

      if (!point.isCommonPoint) {
        return true;
      }
    }

    return false;
  }

  getAllPrimaryLinesWithoutRefinementPoints(fromPrimaryLineIdx = null) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    const primaryLines = new Map();

    for (
      let primaryLineIdx = fromPrimaryLineIdx || 0;
      primaryLineIdx < this.totalNoOfPrimaryLines;
      primaryLineIdx++
    ) {
      if (
        fromPrimaryLineIdx !== null &&
        primaryLineIdx === fromPrimaryLineIdx
      ) {
        primaryLines.set(primaryLineIdx, toolState.data[primaryLineIdx]);
        continue;
      }
      if (!this.containsPrimaryLineRefinementPoints(primaryLineIdx)) {
        primaryLines.set(primaryLineIdx, toolState.data[primaryLineIdx]);
      }
    }

    return primaryLines;
  }

  // todo: generate primary line method - this will generate primary line only without any refinement point - done
  //       generate secondary line method - this will generate secondary line only without any refinement point - done
  //       generate refinement points in range x,y for primary line
  //       generate refinement points in range x,y for secondary line
  //       delete refinement points in range x,y for primary line
  //       delete refinement points in range x,y for secondary line
  //       merge probably last 4 methods into only 2 if it's possible

  getPreviousPrimaryLineWithCommonPoints(currentPrimaryLineIdx) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return { primaryLine: null, idx: null };
    }

    let primaryLineIdx = currentPrimaryLineIdx;
    let foundPreviousPrimaryLine = false;

    while (!foundPreviousPrimaryLine) {
      primaryLineIdx--;
      const currentPrimaryLine = toolState.data[primaryLineIdx];

      if (primaryLineIdx < 0) {
        break;
      }

      if (currentPrimaryLine.handles.points[0].isCommonPoint) {
        foundPreviousPrimaryLine = true;
        break;
      }
    }

    if (!foundPreviousPrimaryLine) {
      return { primaryLine: null, idx: null };
    }

    return { primaryLine: toolState.data[primaryLineIdx], idx: primaryLineIdx };
  }

  getNextMainPrimaryLine(currentPrimaryLineIdx) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return { primaryLine: null, idx: null };
    }

    let primaryLineIdx = currentPrimaryLineIdx;
    let foundNextPrimaryLine = false;

    while (!foundNextPrimaryLine) {
      primaryLineIdx++;
      const currentPrimaryLine = toolState.data[primaryLineIdx];

      if (!currentPrimaryLine) {
        return { primaryLine: null, idx: null };
      }

      if (currentPrimaryLine.handles.points[0].isCommonPoint) {
        foundNextPrimaryLine = true;
        break;
      }
    }

    if (!foundNextPrimaryLine) {
      return { primaryLine: null, idx: null };
    }

    return { primaryLine: toolState.data[primaryLineIdx], idx: primaryLineIdx };
  }

  getIthCommonPointOnPrimaryLine(ithCommonPoint, primaryLineIdx) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    const primaryLine = toolState.data[primaryLineIdx];

    if (!primaryLine) {
      return null;
    }

    const commonPoints = primaryLine.handles.points.filter(
      point => point.isCommonPoint
    );

    if (!commonPoints) {
      return null;
    }

    return commonPoints[ithCommonPoint];
  }

  generateSubsidiaryPrimaryLines(
    fromMainPrimaryLine,
    toMainPrimaryLine,
    createNewSubsidiaryLines = true,
    fromSecondaryLine = null
  ) {
    const noOfCalls = toMainPrimaryLine - fromMainPrimaryLine;

    let beginning = fromMainPrimaryLine;

    for (let call = 0; call < noOfCalls; call++) {
      this.generateSubsidiaryPrimaryLine(
        beginning,
        fromSecondaryLine,
        createNewSubsidiaryLines
      );
      beginning += 4;
    }
  }

  generateSubsidiaryPrimaryLine(
    fromMainPrimaryLine,
    fromSecondaryLine = null,
    createNewSubsidiaryLines = true
  ) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    const points = [];

    const primaryLineIdxsToCreate = new Set();

    for (
      let subsidiaryPrimaryLineIdx = 0;
      subsidiaryPrimaryLineIdx < 3;
      subsidiaryPrimaryLineIdx++
    ) {
      for (
        let pointIdx = fromSecondaryLine || 0;
        pointIdx < this.totalNoOfSecondaryLines;
        pointIdx++
      ) {
        if (toolState.data[fromMainPrimaryLine] === undefined) {
          console.log('undefined');
        }
        const ithCommonPointOnFromPrimaryLine =
          toolState.data[fromMainPrimaryLine].handles.points[pointIdx];

        if (ithCommonPointOnFromPrimaryLine === undefined) {
          console.log('undef');
        }

        if (!ithCommonPointOnFromPrimaryLine.isCommonPoint) {
          continue;
        }

        const { primaryLine: nextPrimaryLine } = this.getNextMainPrimaryLine(
          fromMainPrimaryLine
        );

        if (nextPrimaryLine === null) {
          continue;
        }

        const ithCommonPointOnToPrimaryLine =
          nextPrimaryLine.handles.points[pointIdx];

        if (ithCommonPointOnToPrimaryLine === undefined) {
          console.log('undef');
        }

        const xDiff =
          ithCommonPointOnToPrimaryLine.x - ithCommonPointOnFromPrimaryLine.x;

        const yDiff =
          ithCommonPointOnToPrimaryLine.y - ithCommonPointOnFromPrimaryLine.y;

        points.push({
          x:
            ithCommonPointOnFromPrimaryLine.x +
            (xDiff / 4) * (subsidiaryPrimaryLineIdx + 1),
          y:
            ithCommonPointOnFromPrimaryLine.y +
            (yDiff / 4) * (subsidiaryPrimaryLineIdx + 1),
          primaryLineIdx: fromMainPrimaryLine + subsidiaryPrimaryLineIdx + 1,
          isCommonPoint: false,
        });
      }

      primaryLineIdxsToCreate.add(fromMainPrimaryLine + 1);
      primaryLineIdxsToCreate.add(fromMainPrimaryLine + 2);
      primaryLineIdxsToCreate.add(fromMainPrimaryLine + 3);
    }

    if (createNewSubsidiaryLines) {
      for (const primaryLineIdx of primaryLineIdxsToCreate.values()) {
        this.addNewMeasurementToState(primaryLineIdx);
      }
    }

    points.forEach(point => {
      this.addPoint(point);
    });
  }

  /**
   * Generate new primary line with points respecting direction and length of previous points
   *
   * @param {number|null} [primaryLineIndex=null] - index, under which a new primary line will be added to
   * @param {{ x: number, y: number }|null} [position=null]
   * @returns {void}
   */
  generateMainPrimaryLine(primaryLineIndex = null, position = null) {
    // Add new measurement to tool's state
    this.addNewMeasurementToState(primaryLineIndex);

    const config = this.configuration;
    const toolState = getToolState(this.element, this.name);

    const points = [];

    if (toolState.data.length < 2) {
      for (
        let idx = 0;
        idx < this.configuration.noOfSecondaryLines.default;
        idx++
      ) {
        const point = {
          x: position.x + config.currentTool * this.spacing,
          y: position.y,
          primaryLineIdx: 0,
          isCommonPoint: true,
        };

        if (idx !== 0) {
          point.y += this.spacing * idx;
        }

        points.push(point);
      }
    } else {
      const {
        idx: prevPrimaryLineIdx,
      } = this.getPreviousPrimaryLineWithCommonPoints(primaryLineIndex);

      const {
        primaryLine: prevPrevPrimaryLine,
        idx: prevPrevPrimaryLineIdx,
      } = this.getPreviousPrimaryLineWithCommonPoints(prevPrimaryLineIdx);

      const noOfPoints =
        position === null
          ? this.noOfSecondaryLines
          : this.configuration.noOfSecondaryLines.default;

      for (let idx = 0; idx < noOfPoints; idx++) {
        let xDiff = this.spacing;
        let yDiff = 0;

        const ithCommonPointOnPrevPrimaryLine = this.getIthCommonPointOnPrimaryLine(
          idx,
          prevPrimaryLineIdx
        );

        if (prevPrevPrimaryLine) {
          const ithCommonPointOnPrevPrevPrimaryLine = this.getIthCommonPointOnPrimaryLine(
            idx,
            prevPrevPrimaryLineIdx
          );

          xDiff =
            ithCommonPointOnPrevPrimaryLine.x -
            ithCommonPointOnPrevPrevPrimaryLine.x;

          yDiff =
            ithCommonPointOnPrevPrimaryLine.y -
            ithCommonPointOnPrevPrevPrimaryLine.y;
        }

        points.push({
          x: ithCommonPointOnPrevPrimaryLine.x + xDiff,
          y: ithCommonPointOnPrevPrimaryLine.y + yDiff,
          primaryLineIdx: toolState.data.length - 1,
          isCommonPoint: true,
        });
      }
    }

    points.forEach(point => {
      this.addPoint(point);
    });
  }

  generateRefinementPointsOnCurrentPrimaryLines(
    options = { fromPrimaryLineIdx: 0, fromSecondaryLineIdx: 0 }
  ) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    let primaryLines = this.getAllPrimaryLinesWithoutRefinementPoints(
      options.fromPrimaryLineIdx || null
    );

    if (options.fromSecondaryLineIdx !== undefined) {
      primaryLines = new Map();
      for (
        let primaryLineIdx = 0;
        primaryLineIdx < this.noOfPrimaryLines;
        primaryLineIdx++
      ) {
        primaryLines.set(primaryLineIdx * 4, null);
      }
    }

    // Add refinement points to existing primary lines
    for (const primaryLineIdx of primaryLines.keys()) {
      const pointsToAdd = {};

      for (
        let secondaryLineIdx = options.fromSecondaryLineIdx || 0;
        secondaryLineIdx < this.noOfSecondaryLines;
        secondaryLineIdx++
      ) {
        const point = this.getIthCommonPointOnPrimaryLine(
          secondaryLineIdx,
          primaryLineIdx
        );
        const nextPoint = this.getIthCommonPointOnPrimaryLine(
          secondaryLineIdx + 1,
          primaryLineIdx
        );

        if (!nextPoint) {
          break;
        }

        if (!pointsToAdd.hasOwnProperty(secondaryLineIdx * 4 + 1)) {
          pointsToAdd[secondaryLineIdx * 4 + 1] = [];
        }

        if (!pointsToAdd.hasOwnProperty(secondaryLineIdx * 4 + 2)) {
          pointsToAdd[secondaryLineIdx * 4 + 2] = [];
        }

        if (!pointsToAdd.hasOwnProperty(secondaryLineIdx * 4 + 3)) {
          pointsToAdd[secondaryLineIdx * 4 + 3] = [];
        }

        const xDiff = (nextPoint.x - point.x) / 4;
        const yDiff = (nextPoint.y - point.y) / 4;

        const firstPoint = new FreehandHandleData(
          {
            x: point.x + xDiff,
            y: point.y + yDiff,
          },
          false
        );
        const secondPoint = new FreehandHandleData(
          {
            x: point.x + xDiff * 2,
            y: point.y + yDiff * 2,
          },
          false
        );
        const thirdPoint = new FreehandHandleData(
          {
            x: point.x + xDiff * 3,
            y: point.y + yDiff * 3,
          },
          false
        );

        point.lines = [firstPoint];
        firstPoint.lines = [secondPoint];
        secondPoint.lines = [thirdPoint];
        thirdPoint.lines = [nextPoint];

        pointsToAdd[secondaryLineIdx * 4 + 1].push(firstPoint);
        pointsToAdd[secondaryLineIdx * 4 + 2].push(secondPoint);
        pointsToAdd[secondaryLineIdx * 4 + 3].push(thirdPoint);
      }

      for (const [secondaryLineIdx, points] of Object.entries(pointsToAdd)) {
        for (const point of points) {
          toolState.data[primaryLineIdx].handles.points.splice(
            secondaryLineIdx,
            0,
            point
          );
        }
      }
    }
  }

  /**
   * Remove last primary line from grid
   *
   * @returns {void}
   */
  removeLastPrimaryLine() {
    const toolState = getToolState(this.element, this.name);

    if (this.showRefinementPoints) {
      toolState.data.pop();
      toolState.data.pop();
      toolState.data.pop();
      toolState.data.pop();
    } else {
      toolState.data.pop();
    }
  }

  /**
   * Generate new secondary line with points respecting direction and length of previous points
   *
   * @returns {void}
   */
  generateSecondaryLine() {
    // Add three new lines without common points and the last one with common points
    const toolState = getToolState(this.element, this.name);

    for (
      let primaryLineIdx = 0;
      primaryLineIdx < this.totalNoOfPrimaryLines;
      primaryLineIdx++
    ) {
      if (this.showRefinementPoints) {
        if (primaryLineIdx % 4 !== 0) {
          continue;
        }
      }
      const noOfPoints = toolState.data[primaryLineIdx].handles.points.length;

      const prevPoint =
        toolState.data[primaryLineIdx].handles.points[noOfPoints - 1];
      const prevPrevPoint =
        toolState.data[primaryLineIdx].handles.points[
          this.showRefinementPoints ? noOfPoints - 5 : noOfPoints - 2
        ];

      let xDiff = 0;
      let yDiff = this.spacing;

      if (prevPrevPoint) {
        xDiff = prevPoint.x - prevPrevPoint.x;
        yDiff = prevPoint.y - prevPrevPoint.y;
      }

      this.addPoint({
        x: prevPoint.x + xDiff,
        y: prevPoint.y + yDiff,
        primaryLineIdx,
        isCommonPoint: true,
      });
    }
  }

  /**
   * Remove last secondary line from grid
   *
   * @returns {void}
   */
  removeLastSecondaryLine() {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    let totalNoOfLoops = 1;

    if (this.showRefinementPoints) {
      totalNoOfLoops = 4;
    }

    let currentLoopIdx = 0;

    while (currentLoopIdx < totalNoOfLoops) {
      for (let idx = 0; idx < this.totalNoOfPrimaryLines; idx++) {
        toolState.data[idx].handles.points.pop();

        const noOfPoints = toolState.data[idx].handles.points.length;
        const lastPoint = toolState.data[idx].handles.points[noOfPoints - 1];

        lastPoint.lines = [];

        if (totalNoOfLoops === 4) {
          if (currentLoopIdx > 0) {
            idx += 3;
          }
        }
      }
      ++currentLoopIdx;
    }
  }

  removeAllRefinementPoints() {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    for (
      let primaryLineIdx = 0;
      primaryLineIdx < this.totalNoOfPrimaryLines;
      primaryLineIdx++
    ) {
      const commonPointsOnly = toolState.data[primaryLineIdx].handles.points
        .filter(point => point.isCommonPoint)
        .map((point, idx, points) => {
          if (points[idx + 1]) {
            point.lines = [points[idx + 1]];
          } else {
            point.lines = [];
          }

          return point;
        });

      toolState.data[primaryLineIdx].handles.points = commonPointsOnly;
    }

    let totalNoOfPrimaryLines = this.totalNoOfPrimaryLines;

    while (--totalNoOfPrimaryLines) {
      if (totalNoOfPrimaryLines < 0) {
        break;
      }
      if (!toolState.data[totalNoOfPrimaryLines].handles.points.length) {
        toolState.data.splice(totalNoOfPrimaryLines, 1);
      }
    }
  }

  /**
   * Store given point in tool's state along with line to the previous primary point
   *
   * @param {Object<{ x: number, y: number, primaryLineIdx: number, isCommonPoint: boolean }>} point - primaryLineIdx: primary line index, which given point will belong to
   * @returns {void}
   */
  addPoint(point = { x: 0, y: 0, primaryLineIdx: 0, isCommonPoint: false }) {
    const toolState = getToolState(this.element, this.name);

    const primaryLine = toolState.data[point.primaryLineIdx];

    const newHandleData = new FreehandHandleData(point, point.isCommonPoint);

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
  }

  setOffset(newLocation = { x: 0, y: 0 }, usingMouseInput = false) {
    if (isNaN(newLocation.x) || newLocation.x < 0) {
      return;
    }
    if (isNaN(newLocation.y) || newLocation.y < 0) {
      return;
    }

    const toolState = getToolState(this.element, this.name);

    const config = this.configuration;
    const currentTool = usingMouseInput ? config.currentTool : 0;
    const currentHandle = usingMouseInput ? config.currentHandle : 0;

    const points = toolState.data[currentTool].handles.points;

    const xChange = newLocation.x - points[currentHandle].x;
    const yChange = newLocation.y - points[currentHandle].y;

    for (const tool of toolState.data) {
      for (const point of tool.handles.points) {
        point.x += xChange;
        point.y += yChange;
      }
    }

    external.cornerstone.updateImage(this.element);
    this.fireCompletedEvent();
  }

  removeGrid() {
    // Clear grid state
    clearToolState(this.element, 'Grid');

    // Update spacing
    this.configuration.spacing = {
      default: 5,
    };

    // Update image
    external.cornerstone.updateImage(this.element);
    this.fireRemovedEvent();
  }

  // ===================================================================
  // Helper methods .
  // ===================================================================

  getAllPointsOnIthSecondaryLine(ithSecondaryLine) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return;
    }

    const points = [];
    let primaryLinesOffset = 1;

    if (this.showRefinementPoints && ithSecondaryLine % 4 !== 0) {
      primaryLinesOffset = 4;
    }

    let ithPrimaryLine = 0;

    while (ithPrimaryLine < this.totalNoOfPrimaryLines) {
      let secondaryLine = ithSecondaryLine;

      if (this.showRefinementPoints && ithPrimaryLine % 4 !== 0) {
        secondaryLine /= 4;
      }

      points.push(toolState.data[ithPrimaryLine].handles.points[secondaryLine]);
      ithPrimaryLine += primaryLinesOffset;
    }

    return points;
  }

  coordDiffBetweenFirstAndSecondPointOnPrimaryLine(primaryLineIdx, component) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return;
    }

    const primaryLinePoints = toolState.data[primaryLineIdx].handles.points;

    let secondPointOnMainPrimaryLine = null;

    if (this.showRefinementPoints && primaryLinePoints % 4 !== 0) {
      secondPointOnMainPrimaryLine = primaryLinePoints[1];
    } else {
      secondPointOnMainPrimaryLine = this.getIthCommonPointOnPrimaryLine(
        1,
        primaryLineIdx
      );
    }

    return (
      secondPointOnMainPrimaryLine[component] - primaryLinePoints[0][component]
    );
  }

  coordDiffBetweenFirstAndSecondMainPrimaryLine(component) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return;
    }

    const firstMainPrimaryLinePoints = toolState.data[0].handles.points;
    const { primaryLine: secondMainPrimaryLine } = this.getNextMainPrimaryLine(
      0
    );

    return (
      secondMainPrimaryLine.handles.points[0][component] -
      firstMainPrimaryLinePoints[0][component]
    );
  }

  /**
   * Adjust grid spacing for given image, if it was changed
   *
   * @param {number} newSpacing
   * @param {string} imageId
   * @returns {void}
   */
  onSpacingChange(newSpacing, imageId) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return;
    }

    this.activateDraw();

    let existingSpacing = this.spacing;

    if (this.showRefinementPoints) {
      existingSpacing *= 4;
    }

    const ddx =
      (this.coordDiffBetweenFirstAndSecondMainPrimaryLine('x') /
        existingSpacing) *
      newSpacing;
    const ddy =
      (this.coordDiffBetweenFirstAndSecondMainPrimaryLine('y') /
        existingSpacing) *
      newSpacing;

    // Adjust spacing between primary lines
    for (
      let secondaryLineIdx = 0;
      secondaryLineIdx < this.totalNoOfSecondaryLines;
      secondaryLineIdx++
    ) {
      const points = this.getAllPointsOnIthSecondaryLine(secondaryLineIdx);
      const firstPoint = toolState.data[0].handles.points[secondaryLineIdx];

      let idx = 0;

      for (const point of points) {
        point.x = firstPoint.x + ddx * idx;
        point.y = firstPoint.y + ddy * idx;

        if (this.showRefinementPoints && secondaryLineIdx % 4 !== 0) {
          idx += 4;
        } else {
          idx++;
        }
      }
    }

    if (this.showRefinementPoints) {
      existingSpacing /= 4;
    }

    // Adjust spacing between secondary lines
    for (
      let primaryLineIdx = 0;
      primaryLineIdx < this.totalNoOfPrimaryLines;
      primaryLineIdx++
    ) {
      const dx =
        (this.coordDiffBetweenFirstAndSecondPointOnPrimaryLine(
          primaryLineIdx,
          'x'
        ) /
          existingSpacing) *
        newSpacing;
      const dy =
        (this.coordDiffBetweenFirstAndSecondPointOnPrimaryLine(
          primaryLineIdx,
          'y'
        ) /
          existingSpacing) *
        newSpacing;

      console.log(dx, dy);

      const primaryLinePoints = toolState.data[primaryLineIdx].handles.points;

      primaryLinePoints.map((point, pointIdx) => {
        if (this.showRefinementPoints && primaryLineIdx % 4 !== 0) {
          // pointIdx += 4;
        }
        point.x = primaryLinePoints[0].x + dx * pointIdx;
        point.y = primaryLinePoints[0].y + dy * pointIdx;

        return point;
      });
    }

    this.configuration.spacing[imageId] = newSpacing;

    this.completeDrawing();
  }

  /**
   * Get grid's middle point coordinates
   *
   * @returns {{x: number, y: number}|null}
   */
  getGridMiddlePointCoords() {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    const upperLeft = toolState.data[0].handles.points[0];
    const bottomRight =
      toolState.data[toolState.data.length - 1].handles.points[
        toolState.data[toolState.data.length - 1].handles.points.length - 1
      ];

    return {
      x: (upperLeft.x + bottomRight.x) / 2,
      y: (upperLeft.y + bottomRight.y) / 2,
    };
  }

  // ===================================================================
  // Public Configuration API. .
  // ===================================================================

  get showRefinementPoints() {
    return this.configuration.showRefinementPoints;
  }

  set showRefinementPoints(value) {
    if (typeof value !== 'boolean') {
      throw new Error(
        'Attempting to set showRefinementPoints to a value other than a boolean.'
      );
    }

    if (this.showRefinementPoints === value) {
      return null;
    }

    // todo: delete refinement points if value is false, add points if value is true
    if (value) {
      this.generateSubsidiaryPrimaryLines(0, this.totalNoOfPrimaryLines - 1);
      this.generateRefinementPointsOnCurrentPrimaryLines();
    } else {
      this.removeAllRefinementPoints();
    }

    this.configuration.showRefinementPoints = value;

    external.cornerstone.updateImage(this.element);

    this.fireCompletedEvent();
  }

  /**
   * Get grid's moving mode
   * @returns {boolean}
   */
  get moveOneHandleOnly() {
    return this.configuration.moveOneHandleOnly;
  }

  /**
   * Set moving mode for all grids
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

    this.fireCompletedEvent();
  }

  /**
   * Get number of primary lines for current image's grid
   * @returns {number|null}
   */
  get noOfPrimaryLines() {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    const primaryLinesWithCommonPoint = toolState.data.filter(
      primaryLine => primaryLine.handles.points[0].isCommonPoint
    );

    return primaryLinesWithCommonPoint.length;
  }

  get totalNoOfPrimaryLines() {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    return toolState.data.length;
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

    if (isNaN(newNoOfPrimaryLines) || newNoOfPrimaryLines < 2) {
      return;
    }

    let existingNoOfPrimaryLines = this.noOfPrimaryLines;

    if (newNoOfPrimaryLines === existingNoOfPrimaryLines) {
      return;
    }

    this.activateDraw();

    if (newNoOfPrimaryLines > existingNoOfPrimaryLines) {
      while (existingNoOfPrimaryLines < newNoOfPrimaryLines) {
        this.generateMainPrimaryLine(this.totalNoOfPrimaryLines);

        if (this.showRefinementPoints) {
          const {
            idx: fromPrimaryLineIdx,
          } = this.getPreviousPrimaryLineWithCommonPoints(
            this.totalNoOfPrimaryLines
          );

          this.generateRefinementPointsOnCurrentPrimaryLines({
            fromPrimaryLineIdx,
          });

          this.generateSubsidiaryPrimaryLines(
            this.totalNoOfPrimaryLines - 2,
            this.totalNoOfPrimaryLines - 1
          );
        }

        existingNoOfPrimaryLines++;
      }
    } else {
      while (existingNoOfPrimaryLines > newNoOfPrimaryLines) {
        this.removeLastPrimaryLine();
        existingNoOfPrimaryLines--;
      }
    }

    this.completeDrawing();
  }

  /**
   * Get number of secondary lines for current image's grid
   * @returns {number|null}
   */
  get noOfSecondaryLines() {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    const commonPointsOnly = toolState.data[0].handles.points.filter(
      point => point.isCommonPoint
    );

    return commonPointsOnly.length;
  }

  get totalNoOfSecondaryLines() {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    return toolState.data[0].handles.points.length;
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

    if (isNaN(newNoOfSecondaryLines) || newNoOfSecondaryLines < 2) {
      return;
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

        if (this.showRefinementPoints) {
          this.generateRefinementPointsOnCurrentPrimaryLines({
            fromSecondaryLineIdx: existingNoOfSecondaryLines - 2,
          });

          // todo: other method name
          this.generateSubsidiaryPrimaryLines(
            0,
            this.noOfPrimaryLines,
            false,
            this.totalNoOfSecondaryLines - 3
          );
        }
      }
    } else {
      while (existingNoOfSecondaryLines > newNoOfSecondaryLines) {
        this.removeLastSecondaryLine();
        existingNoOfSecondaryLines--;
      }
    }

    this.completeDrawing();
  }

  /**
   * Get grid spacing of current image
   * @returns {number}
   */
  get spacing() {
    // todo: this will be not known once returned from server
    const imageId = external.cornerstone.getImage(this.element).imageId;

    const spacingForImageId = this.configuration.spacing[imageId];

    return spacingForImageId === undefined
      ? this.configuration.spacing.default
      : spacingForImageId;
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

    if (isNaN(value) || value < 1) {
      return;
    }

    const imageId = external.cornerstone.getImage(this.element).imageId;

    this.onSpacingChange(value, imageId);
  }

  /**
   * Get grid's angle
   * @returns {number|null}
   */
  get angle() {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
      return null;
    }

    const firstPrimaryLine = toolState.data[0];

    const topLeftPoint = firstPrimaryLine.handles.points[0];
    const bottomLeftPoint =
      firstPrimaryLine.handles.points[this.totalNoOfSecondaryLines - 1];

    const centerLeftPoint = {
      x: (topLeftPoint.x + bottomLeftPoint.x) / 2,
      y: (topLeftPoint.y + bottomLeftPoint.y) / 2,
    };

    const centerPoint = this.getGridMiddlePointCoords();
    const adjacentPoint = { x: centerLeftPoint.x, y: centerPoint.y };

    const centerToAdjacentLength = centerPoint.x - adjacentPoint.x;
    const adjacentToCenterLeftLength = adjacentPoint.y - centerLeftPoint.y;

    const angleTan = adjacentToCenterLeftLength / centerToAdjacentLength;

    return Math.round((Math.atan(angleTan) * 180) / Math.PI);
  }

  /**
   * Set grid's angle
   * @param {number} newAngle
   */
  set angle(newAngle) {
    if (typeof newAngle !== 'number') {
      throw new Error(
        'Attempting to set angle to a value other than a number.'
      );
    }

    if (isNaN(newAngle) || newAngle < 0 || newAngle > 90) {
      return;
    }

    const angleDiff = newAngle - this.angle;

    this.rotateGrid(angleDiff);
  }

  /**
   * Rotate grid around its center by angle
   *
   * @param {number} angle - in degrees
   * @returns {void}
   */
  rotateGrid(angle) {
    const toolState = getToolState(this.element, this.name);

    if (!toolState || !toolState.data || !toolState.data.length) {
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

function defaultToolConfiguration() {
  return {
    handleRadius: 3,
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
    moveOneHandleOnly: false,
    noOfPrimaryLines: {
      default: 10,
    },
    noOfSecondaryLines: {
      default: 10,
    },
    spacing: {
      default: 5,
    },
    showRefinementPoints: false,
  };
}

function preventPropagation(evt) {
  evt.stopImmediatePropagation();
  evt.stopPropagation();
  evt.preventDefault();
}
