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

function computeRoute(wire) {
  const route = [
    wire.sourcePoint,
    ...wire.route,
    {
      x: wire.targetPoint.x + 9,
      y: wire.targetPoint.y,
    },
  ];
  return route;
}

function findBifurcations(
  point,
  vB,
  markersNode,
  bifurcationPoints,
  markupTemplate
) {
  for (let j = 0; j < vB.length - 1; j++) {
    if (evalIntersection(point, [vB[j], vB[j + 1]])) {
      const pointKey = `${point.x},${point.y}`;
      if (!bifurcationPoints.has(pointKey)) {
        bifurcationPoints.add(pointKey);
        const mt = markupTemplate(point).replace('r=""', 'r="1.5"');
        V(markersNode).append(V(mt));
      }
      break; // Intersection founded, go out
    }
  }
}

function evalIntersection(point, segment) {
  const [p0, p1] = segment;
  if (p0.x === p1.x) {
    // Vertical
    return (
      point.x === p0.x &&
      point.y > Math.min(p0.y, p1.y) &&
      point.y < Math.max(p0.y, p1.y)
    );
  }
  // Horizontal
  return (
    point.y === p0.y &&
    point.x > Math.min(p0.x, p1.x) &&
    point.x < Math.max(p0.x, p1.x)
  );
}
