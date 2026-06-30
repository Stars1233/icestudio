//---------------------------------------------------------------------------
//-- Drivers service
//--
//-- Driver management is now delegated entirely to apio:
//--   tools.js -> "apio drivers install|uninstall <ftdi|serial>"
//--
//-- Modern apio bundles its own libusb/libftdi and handles the platform
//-- specifics (Zadig on Windows, udev rules on Linux, device access on macOS).
//-- On macOS it even reports "No driver installation is required on this
//-- platform". The previous per-OS mechanism in this file (Homebrew installs,
//-- Linux udev rules, and the macOS FTDI kext unload/reload via sudo-prompt)
//-- is obsolete and has been removed. It also crashed on current Node, since
//-- sudo-prompt relies on the removed util.isObject().
//---------------------------------------------------------------------------
'use strict';

angular.module('icestudio').service('drivers', function () {
  //-- Called by the upload flow (tools.js) before and after an upload.
  //-- The old macOS kext unload/reload is no longer needed: apio claims the
  //-- USB device (libusb) during upload, so these are now no-ops.
  this.preUpload = function (callback) {
    if (callback) {
      callback();
    }
  };

  this.postUpload = function () {};
});
