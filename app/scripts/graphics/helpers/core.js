'use strict';
/* jshint unused:false */
function callFuncByObjectProperty(object, property, defaultValue) {
  var value = object[property];
  if (typeof value === 'function') {
    return value.call(object);
  }
  return value !== undefined ? value : defaultValue;
}
