//== JSHINT RULES / START
/* jshint unused:false */
//== JSHINT RULES / END

/*----------------------------------------------------------------------------
 * This file contains helper graphics functions for joint.js library
 * ---------------------------------------------------------------------------*/

'use strict';
/*-- 
 * Existent vertex click detection with selectable margin 
 * Future refactor: helper jointjs 
 --*/
function isClickOnVertex(linkView, x, y, margin = 5) {
  const linkModel = linkView.model;
  const vertices = linkModel.get('vertices') || [];
  return vertices.some(
    (v) => Math.abs(v.x - x) < margin && Math.abs(v.y - y) < margin
  );
}
