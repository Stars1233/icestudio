'use strict';

joint.connectors.ice = function (sourcePoint, targetPoint, vertices) {
  var points = [];
  points.push({ x: sourcePoint.x, y: sourcePoint.y });
  _.each(vertices, function (vertex) {
    points.push({ x: vertex.x, y: vertex.y });
  });
  points.push({ x: targetPoint.x, y: targetPoint.y });

  var step = 8;
  var n = points.length;

  var sq = { x: points[0].x - points[1].x, y: points[0].y - points[1].y };
  var tq = {
    x: points[n - 1].x - points[n - 2].x,
    y: points[n - 1].y - points[n - 2].y,
  };

  var sx = Math.sign(sq.x) * step;
  var sy = Math.sign(sq.y) * step;

  var tx = tq.y === 0 ? Math.sign(tq.x) * step : 0;
  var ty = tq.x === 0 ? Math.sign(tq.y) * step : 0;

  //-- Build an orthogonal (manhattan) path from a point sequence. The A*
  //-- router snaps to an 8px grid while ports may sit off-grid, which would
  //-- otherwise leave a small diagonal segment at the port connection. When a
  //-- segment is diagonal, insert a corner along the dominant axis so every
  //-- segment stays axis-aligned. Segments between A* vertices are already
  //-- axis-aligned, so no corner is added there.
  function orthoPath(seq) {
    var d = ['M', seq[0].x, seq[0].y];
    var prev = seq[0];
    for (var i = 1; i < seq.length; i++) {
      var cur = seq[i];
      if (prev.x !== cur.x && prev.y !== cur.y) {
        if (Math.abs(cur.x - prev.x) >= Math.abs(cur.y - prev.y)) {
          d.push(cur.x, prev.y);
        } else {
          d.push(prev.x, cur.y);
        }
      }
      d.push(cur.x, cur.y);
      prev = cur;
    }
    return d.join(' ');
  }

  var fullSeq = [{ x: sourcePoint.x, y: sourcePoint.y }];
  var wrapSeq = [{ x: sourcePoint.x - sx, y: sourcePoint.y - sy }];
  _.each(vertices, function (vertex) {
    fullSeq.push({ x: vertex.x, y: vertex.y });
    wrapSeq.push({ x: vertex.x, y: vertex.y });
  });
  fullSeq.push({ x: targetPoint.x, y: targetPoint.y });
  wrapSeq.push({ x: targetPoint.x - tx, y: targetPoint.y - ty });

  return {
    full: orthoPath(fullSeq),
    wrap: orthoPath(wrapSeq),
  };
};
