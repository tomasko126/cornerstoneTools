import { registerModule } from './registerModule.js';
import { registerItem } from './registerItem.js';

/**
 * Register an item or module to cornerstoneTools.
 *
 * @param {string} type The type of the item/module.
 * @param {string} name The name of the item/module.
 * @param {Object|function} item The item/module itself.
 * @param {boolean} [overwrite=false] Whether an item/module should be
 *                                    overwritten, should it have the same name.
 */
export default function (type, name, item, overwrite = false) {
  if (!isValidInput(type, name, item)) {
    return;
  }

  if (type === 'module') {
    registerModule(name, item, overwrite);
  } else {
    registerItem(type, name, item, overwrite);
  }
}


/**
 * Returns true if the item is valid, this avoids
 * clogging up the library with invalid data.
 *
 * @param {string} type The type of the item/module.
 * @param {string} name The name of the item/module.
 * @param {Object|function} item The item/module itself.
 * @return {boolean}    Whether the input is valid.
 */
function isValidInput (type, name, item) {
  if (!type) {
    console.warn(`The type must be given in order to register.`);

    return false;
  }

  if (!name) {
    console.warn(`The ${type} must have a name in order to register.`);

    return false;
  }

  if (typeof item !== 'object' && typeof item !== 'function') {
    console.warn(`The ${item} is a ${typeof item}, it should be an Object or a function.`);
    return false;
  }

  return true;
}
