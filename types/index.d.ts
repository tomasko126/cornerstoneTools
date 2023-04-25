import primaryLine = GridToolOptions.primaryLine;
import compactPrimaryLine = GridToolOptions.compactPrimaryLine;
import getStateAndConfigOutput = GridToolOptions.getStateAndConfigOutput;

/**
 * Object holding references to other libraries required to be used with cornerstoneTools.
 */
interface ExternalInterface { cornerstone: object | null; cornerstoneMath: object | null; Hammer: object | null }
export const external: ExternalInterface;

/**
 * Adds a cornerstoneTools tool to an enabled element.
 */
export function addToolForElement(element: HTMLElement, ApiTool: object, props?: object): void;

/**
 * Returns the tool instance attached to the element.
 */
export function getToolForElement(element: HTMLElement, name: string): GridTool|object;

/**
 * Sets a tool's state, with the provided toolName and element, to 'active' state.
 * Active tools are rendered, respond to user input, and can create new data.
 */
export function setToolActiveForElement(element: HTMLElement, toolName: string, toolOptions: object): void;

/**
 * Sets a tool's state, with the provided toolName and element, to 'passive'.
 * Passive tools are rendered and respond to user input, but do not create new measurements or annotations.
 */
export function setToolPassiveForElement(element: HTMLElement, toolName: string): void;

/**
 * Sets a tool's state, with the provided toolName and element, to 'enabled' state.
 * Enabled tools are rendered, but do not respond to user input.
 */
export function setToolEnabledForElement(element: HTMLElement, toolName: string, options?: object|number): void;

/**
 * Sets a tool's state, with the provided toolName and element, to 'disabled'.
 * Disabled tools are not rendered, and do not respond to user input
 */
export function setToolDisabledForElement(element: HTMLElement, toolName: string): void;

/**
 * Removes all tools from all enabled elements with the provided name.
 */
export function removeTool(toolName: string): void;

/**
 * Initializes a cornerstoneTools library.
 * This method must be called before using the library.
 */
export function init(param: { showSVGCursors?: boolean; mouseEnabled?: boolean, touchEnabled?: boolean, globalToolSyncEnabled?: boolean }): void;

/**
 * A Stack specific tool state management strategy.
 * Adding it to an element means that tool data (from specified toolNames) is shared between all imageIds in a given stack.
 */
export function addStackStateManager(element: HTMLElement, toolNames: string[]): void;

/**
 * Adds tool state to the toolStateManager,
 * this is done by tools as well as modules that restore saved state.
 */
export function addToolState(element: HTMLElement, toolName: string, measurementData: object): void;

/**
 * Starts playing a clip or adjusts the frame rate of an already playing clip.
 * A negative framesPerSecond will play the clip in reverse.
 * The element must be a stack of images.
 */
export function playClip(element: HTMLElement, framesPerSecond: number, options: { fromIdx: number, toIdx: number, loop: boolean }): void;

/**
 * Stops an already playing clip.
 */
export function stopClip(element: HTMLElement): void;

export namespace GridToolOptions {
  interface GridToolConfig {
    currentHandle: number,
    currentTool: number,
    handleRadius: number,
    highlighting: {
      primaryLineIdxInLoop: number,
      secondaryLineIdx: undefined|number,
    },
    moveOneHandleOnly: boolean,
    noOfPrimaryLines: {
      default: number,
    },
    noOfSecondaryLines: {
      default: number,
    },
    spacing: {
      default: number,
    },
    showRefinementPoints: {
      global: boolean,
    },
  }

  interface getStateAndConfigOutput {
    config: GridToolConfig,
    state: primaryLine[],
  }

  interface primaryLine {
    active: boolean;
    color: string|undefined;
    handles: {
      points: gridPoint[],
    },
    invalidated: boolean;
    uuid: string;
    visible: boolean;
  }

  interface compactGridPoint {
    x: number;
    y: number;
    isCommonPoint: boolean;
  }

  interface compactPrimaryLine {
    points: compactGridPoint[];
    uuid: string;
  }

  interface linePoint {
    /**
     * Find out, if this point is a common or a refinement point
     */
    isCommonPoint: boolean;
    /**
     * Primary line idx, on which this point is defined on
     */
    primaryLineIdx: number;
    /**
     * X coordinate
     */
    x: number;
    /**
     * Y coordinate
     */
    y: number;
  }

  interface gridPoint {
    active: boolean;
    highlight: boolean;
    /**
     * Find out, if this point is a common or a refinement point
     */
    isCommonPoint: boolean;

    /**
     * Array of points - between this point and every point in this array, a line will be drawn
     */
    lines: linePoint[],

    /**
     * X coordinate
     */
    x: number;
    /**
     * Y coordinate
     */
    y: number;
  }
}


declare class GridTool {

  /**
   * Clear all states for all images
   */
  clearAllStates(): void;

  /**
   * Retrieve tool's config along with its state
   */
  getStateAndConfig(): getStateAndConfigOutput;

  /**
   * Find out, if we have grid placed on every image id
   */
  hasGridForImageIds(imageIds: string[]): boolean;

  /**
   * Retrieve grid's angle.
   * If not defined, returns null.
   */
  get angle(): number | null;

  /**
   * Set grid's angle.
   */
  set angle(angle: number);

  /**
   * Retrieve grid's number of primary lines.
   * If not defined, returns null.
   */
  get noOfPrimaryLines(): number | null;

  /**
   * Set grid's number of primary lines.
   */
  set noOfPrimaryLines(lines: number);

  /**
   * Retrieve grid's number of secondary lines.
   * If not defined, returns null.
   */
  get noOfSecondaryLines(): number | null;

  /**
   * Set grid's number of secondary lines.
   */
  set noOfSecondaryLines(lines: number);

  /**
   * Retrieve grid's spacing.
   * If not defined, returns null.
   */
  get spacing(): number | null;

  /**
   * Set grid's spacing
   */
  set spacing(spacing: number);

  /**
   * Set grid's offset.
   */
  setOffset(newLocation: { x: number | null, y: number | null }, usingMouseInput: boolean): void;

  /**
   * Tell grid, whether to show its refinement points or not.
   */
  set showRefinementPoints(value: boolean);

  /**
   * Tell grid, whether to move with one handle or with whole grid at once
   */
  set moveOneHandleOnly(value: boolean);

  /**
   * Retrieve primary lines for a given image id
   */
  getStateForImageId(imageId: string, compact: boolean): compactPrimaryLine[] | null;

  /**
   * Set given primary lines as grid's state for given image ids
   */
  setStateForImageIds(primaryLines: primaryLine[], imageIds: string[], hasRefinementPoints?: boolean): void;

  /**
   * Remove grid from current shown image
   */
  removeGrid(): void;
}

declare class PanTool {}

declare class StackScrollMouseWheelTool {}

/**
 * Used cornerstone tools in the app
 */
export type ToolName = 'Grid' | 'Pan' | 'StackScrollMouseWheel';

/**
 * Full names of cornerstone tool in the app
 */
export type FullToolName = 'GridTool' | 'PanTool' | 'StackScrollMouseWheelTool';

declare namespace cornerstoneTools {
  export { addToolForElement };
  export { getToolForElement };
  export { setToolActiveForElement };
  export { setToolPassiveForElement };
  export { setToolEnabledForElement };
  export { setToolDisabledForElement };
  export { removeTool };
  export { init };
  export { addStackStateManager };
  export { addToolState };
  export { playClip };
  export { stopClip };
  export { external };
  export { GridTool };
  export { PanTool };
  export { StackScrollMouseWheelTool };
  export { ToolName };
  export { FullToolName };
}

export default cornerstoneTools;

export as namespace cornerstoneTools;

