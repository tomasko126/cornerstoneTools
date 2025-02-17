import external from '../externalModules.js';

/**
 * Implements an imageId specific tool state management strategy.  This means that
 * Measurements data is tied to a specific imageId and only visible for enabled elements
 * That are displaying that imageId.
 * @public
 * @constructor newImageIdSpecificToolStateManager
 * @memberof StateManagement
 *
 * @returns {Object} An imageIdSpecificToolStateManager instance.
 */
function newImageIdSpecificToolStateManager() {
  let toolState = {};

  // Here we add tool state, this is done by tools as well
  // As modules that restore saved state

  function saveImageIdToolState(imageId) {
    return toolState[imageId];
  }

  function restoreImageIdToolState(imageId, imageIdToolState) {
    toolState[imageId] = imageIdToolState;
  }

  function saveToolState() {
    return toolState;
  }

  function restoreToolState(savedToolState) {
    toolState = savedToolState;
  }

  // Here we add tool state, this is done by tools as well
  // As modules that restore saved state
  function addElementToolState(element, toolName, data, idx = null) {
    const enabledElement = external.cornerstone.getEnabledElement(element);

    // If we don't have an image for this element exit early
    if (!enabledElement.image) {
      return;
    }
    addImageIdToolState(enabledElement.image.imageId, toolName, data, idx);
  }

  function addImageIdToolState(imageId, toolName, data, idx = null) {
    // If we don't have any tool state for this imageId, add an empty object
    if (toolState.hasOwnProperty(imageId) === false) {
      toolState[imageId] = {};
    }

    const imageIdToolState = toolState[imageId];

    // If we don't have tool state for this tool name, add an empty object
    if (imageIdToolState.hasOwnProperty(toolName) === false) {
      imageIdToolState[toolName] = {
        data: [],
      };
    }

    const toolData = imageIdToolState[toolName];

    // Finally, add this new tool to the state
    if (idx === null) {
      toolData.data.push(data);
    } else {
      toolData.data.splice(idx, 0, data);
    }
  }

  function getElementToolState(element, toolName) {
    const enabledElement = external.cornerstone.getEnabledElement(element);

    // If the element does not have an image return undefined.
    if (!enabledElement.image) {
      return;
    }

    return getImageIdToolState(enabledElement.image.imageId, toolName);
  }

  // Here you can get state - used by tools as well as modules
  // That save state persistently
  function getImageIdToolState(imageId, toolName) {
    // If we don't have any tool state for this imageId, return undefined
    if (toolState.hasOwnProperty(imageId) === false) {
      return;
    }

    const imageIdToolState = toolState[imageId];

    // If we don't have tool state for this tool name, return undefined
    if (imageIdToolState.hasOwnProperty(toolName) === false) {
      return;
    }

    return imageIdToolState[toolName];
  }

  // Replaces the given tool's state using the provided element's imageId
  function setElementToolState(element, toolName, data) {
    const enabledElement = external.cornerstone.getEnabledElement(element);

    if (!enabledElement.image) {
      return;
    }
    setImageIdToolState(enabledElement.image.imageId, toolName, data);
  }

  // Replaces the imageId's tool state for a given tool
  function setImageIdToolState(imageId, toolName, data) {
    const imageIdToolState = toolState[imageId];

    // Set the toolState
    imageIdToolState[toolName] = data;
  }

  // Clears all tool data from this toolStateManager.
  function clearElementToolState(element) {
    const enabledElement = external.cornerstone.getEnabledElement(element);

    if (!enabledElement.image) {
      return;
    }
    clearImageIdToolState(enabledElement.image.imageId);
  }

  function clearImageIdToolState(imageId) {
    if (toolState.hasOwnProperty(imageId) === false) {
      return;
    }

    delete toolState[imageId];
  }

  return {
    get: getElementToolState,
    add: addElementToolState,
    set: setElementToolState,
    clear: clearElementToolState,
    getImageIdToolState,
    addImageIdToolState,
    setImageIdToolState,
    clearImageIdToolState,
    saveImageIdToolState,
    restoreImageIdToolState,
    saveToolState,
    restoreToolState,
    toolState,
  };
}

// A global imageIdSpecificToolStateManager - the most common case is to share state between all
// Visible enabled images
const globalImageIdSpecificToolStateManager = newImageIdSpecificToolStateManager();

export {
  newImageIdSpecificToolStateManager,
  globalImageIdSpecificToolStateManager,
};
