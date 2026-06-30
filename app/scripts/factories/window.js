'use strict';

//---------------------------------------------------------------------------
//-- Add the objects 'gui' and 'windows' to the Icestudio Module
//--   for accesing the graphical user interface and the windows
//--
//-- Add the object '_package' for accesing to the properties defined in
//--   the app/package.json file
//---------------------------------------------------------------------------

angular
  .module('icestudio')

  //-- For the GUI, the NWjs package is used
  .factory('gui', function () {
    let gui = require('nw.gui');
    return gui;
  })

  //-- Windows are implemented through the nw.gui.Window object
  .factory('window', function () {
    let gui = require('nw.gui');
    return gui.Window;
  })

  //-- Acces to the package.json file
  //-- The special atribute .version is created. It uses the
  //--  package.json version property and the timestamp located
  //--  in the buildinfo.json file
  .factory('_package', function () {
    //-- Access to the package.json file
    const _package = require('./package.json');

    //-- Access to the timestamp
    const _buildinfo = require('./buildinfo.json');

    //-- Build the final version (version + timestamp) on a COPY. Mutating the
    //-- require()'d object would corrupt it: Node's module cache is shared
    //-- across every window in the process, so each newly opened window would
    //-- append the timestamp again ("0.13.4w" -> "0.13.4w<ts>" ->
    //-- "0.13.4w<ts><ts>"...). The copy keeps the cached object untouched.
    return Object.assign({}, _package, {
      version: `${_package.version}${_buildinfo.ts}`,
    });
  });
