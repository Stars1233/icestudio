//== JSHINT rules / START
/* global callFuncByObjectProperty */
//== JSHINT rules / END

'use strict';

joint.routers.ice = (function (g, _, joint) {
  var config = {
    // size of the step to find a route
    step: 8,

    // use of the perpendicular linkView option to connect center of element with first vertex
    perpendicular: true,

    // should be source or target not to be consider as an obstacle
    //-- Exclude the connected blocks themselves: a wire must never route
    //-- around the very blocks it connects. With them as obstacles, two ports
    //-- placed close together (e.g. a label next to a block) force the router
    //-- to detour around their padding boxes, producing a small loop.
    excludeEnds: ['source', 'target'],

    // should be any element with a certain type not to be consider as an obstacle
    excludeTypes: ['ice.Info'],

    // if number of route finding loops exceed the maximum, stops searching and returns
    // fallback route
    maximumLoops: 280, //2000

    // possible starting directions from an element
    startDirections: ['right', 'bottom'],

    // possible ending directions to an element
    endDirections: ['left', 'top'],

    // specify directions above
    directionMap: {
      right: { x: 1, y: 0 },
      bottom: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      top: { x: 0, y: -1 },
    },

    // maximum change of the direction
    maxAllowedDirectionChange: 90,

    // padding applied on the element bounding boxes
    paddingBox: function () {
      var step = 15;

      return {
        x: -step,
        y: -step,
        width: 2 * step,
        height: 2 * step,
      };
    },

    // an array of directions to find next points on the route
    directions: function () {
      var step = this.step;

      return [
        { offsetX: step, offsetY: 0, cost: step },
        { offsetX: 0, offsetY: step, cost: step },
        { offsetX: -step, offsetY: 0, cost: step },
        { offsetX: 0, offsetY: -step, cost: step },
      ];
    },

    // a penalty received for direction change
    penalties: function () {
      return {
        0: 0,
        45: this.step / 2,
        90: this.step / 2,
      };
    },

    fallbackRoute: _.constant(null),

    // if a function is provided, it's used to route the link while dragging an end
    // i.e. function(from, to, opts) { return []; }
    draggingRoute: null,
  };

  // Map of obstacles
  // Helper structure to identify whether a point lies in an obstacle.
  function ObstacleMap(opt, paper) {
    this.map = {};
    this.options = opt;
    this.paper = paper;
    // tells how to divide the paper when creating the elements map
    this.mapGridSize = 100;
  }

  ObstacleMap.prototype.build = function (graph, link) {
    var opt = this.options;
    var excludedEnds = opt.excludeEnds
      .map(function (end) {
        return link.get(end);
      })
      .map(function (linkEnd) {
        return linkEnd ? graph.getCell(linkEnd.id) : null;
      })
      .filter(function (cell) {
        return cell !== null;
      });

    var excludedAncestors = [];

    var source = graph.getCell(link.get('source').id);
    if (source) {
      excludedAncestors = excludedAncestors.concat(
        source.getAncestors().map(function (ancestor) {
          return ancestor.id;
        })
      );
    }

    var target = graph.getCell(link.get('target').id);
    if (target) {
      excludedAncestors = excludedAncestors.concat(
        target.getAncestors().map(function (ancestor) {
          return ancestor.id;
        })
      );
    }

    excludedAncestors = Array.from(new Set(excludedAncestors));

    // builds a map of all elements for quicker obstacle queries (i.e. is a point contained
    // in any obstacle?) (a simplified grid search)
    // The paper is divided to smaller cells, where each of them holds an information which
    // elements belong to it. When we query whether a point is in an obstacle we don't need
    // to go through all obstacles, we check only those in a particular cell.
    var mapGridSize = this.mapGridSize;

    var elements = graph.getElements();

    var filteredElements = elements.filter(function (element) {
      var isExcludedEnd = excludedEnds.includes(element);

      var isExcludedType = opt.excludeTypes.includes(element.get('type'));

      var isExcludedAncestor = excludedAncestors.includes(element.id);

      return !isExcludedEnd && !isExcludedType && !isExcludedAncestor;
    });

    var blockRectangles = filteredElements.map(function (element) {
      return element.getBBox();
    });

    var x, y, origin, corner;

    blockRectangles.forEach(function (bbox) {
      bbox.moveAndExpand(opt.paddingBox);
      origin = bbox.origin().snapToGrid(mapGridSize);
      corner = bbox.corner().snapToGrid(mapGridSize);

      for (x = origin.x; x <= corner.x; x += mapGridSize) {
        for (y = origin.y; y <= corner.y; y += mapGridSize) {
          var gridKey = x + '@' + y;

          if (!this.map[gridKey]) {
            this.map[gridKey] = [];
          }

          this.map[gridKey].push(bbox);
        }
      }
    }, this);

    return this;
  };

  ObstacleMap.prototype.isPointAccessible = function (point) {
    const mapKey = point.clone().snapToGrid(this.mapGridSize).toString();
    const obstacles = this.map[mapKey];

    if (!obstacles) {
      return true;
    }

    for (let i = 0; i < obstacles.length; i++) {
      if (obstacles[i].containsPoint(point)) {
        return false;
      }
    }
    return true;
  };

  // Sorted Set
  // Set of items sorted by given value.
  function SortedSet() {
    this.items = [];
    this.hash = {};
    this.values = {};
    this.OPEN = 1;
    this.CLOSE = 2;
  }

  SortedSet.prototype.add = function (item, value) {
    const items = this.items;
    const hash = this.hash;
    const values = this.values;

    if (hash[item]) {
      const currentIndex = items.indexOf(item);
      if (currentIndex !== -1) {
        items.splice(currentIndex, 1);
      }
    } else {
      hash[item] = this.OPEN;
    }

    values[item] = value;

    let left = 0;
    let right = items.length;
    const itemValue = Number.isNaN(value) ? Infinity : value;

    while (left < right) {
      /* jshint bitwise: false */
      const mid = (left + right) >>> 1; // Fast Division
      /* jshint bitwise: true */
      const midValue = values[items[mid]];

      if (Number.isNaN(midValue)) {
        right = mid;
      } else if (midValue < itemValue) {
        left = mid + 1;
      } else {
        right = mid;
      }
    }

    items.splice(left, 0, item);
  };

  SortedSet.prototype.remove = function (item) {
    this.hash[item] = this.CLOSE;
  };

  SortedSet.prototype.isOpen = function (item) {
    return this.hash[item] === this.OPEN;
  };

  SortedSet.prototype.isClose = function (item) {
    return this.hash[item] === this.CLOSE;
  };

  SortedSet.prototype.isEmpty = function () {
    return this.items.length === 0;
  };

  SortedSet.prototype.pop = function () {
    var item = this.items.shift();
    this.remove(item);
    return item;
  };

  function normalizePoint(point) {
    return g.point(
      point.x === 0 ? 0 : Math.abs(point.x) / point.x,
      point.y === 0 ? 0 : Math.abs(point.y) / point.y
    );
  }

  // reconstructs a route by concatenating points with their parents
  function reconstructRoute(parents, point, startCenter, endCenter) {
    var route = [];
    var prevDiff = normalizePoint(endCenter.difference(point));
    var current = point;
    var parent;

    while ((parent = parents[current])) {
      var diff = normalizePoint(current.difference(parent));

      if (!diff.equals(prevDiff)) {
        route.unshift(current);
        prevDiff = diff;
      }

      current = parent;
    }

    var startDiff = normalizePoint(g.point(current).difference(startCenter));
    if (!startDiff.equals(prevDiff)) {
      route.unshift(current);
    }

    return route;
  }

  function getRectPoints(bbox, directionList, opt) {
    const step = opt.step;
    const centerX = bbox.x + bbox.width / 2;
    const centerY = bbox.y + bbox.height / 2;
    const halfWidth = bbox.width / 2;
    const halfHeight = bbox.height / 2;
    const directionMap = opt.directionMap;
    const points = [];

    for (let i = 0; i < directionList.length; i++) {
      const dirKey = directionList[i];
      const direction = directionMap[dirKey];
      if (!direction) {
        continue;
      }
      let x = centerX + direction.x * halfWidth;
      let y = centerY + direction.y * halfHeight;

      if (
        x >= bbox.x &&
        x <= bbox.x + bbox.width &&
        y >= bbox.y &&
        y <= bbox.y + bbox.height
      ) {
        x += direction.x * step;
        y += direction.y * step;
      }

      x = Math.round(x / step) * step;
      y = Math.round(y / step) * step;

      points.push(g.point(x, y));
    }

    return points;
  }

  // returns a direction index from start point to end point
  function getDirectionAngle(start, end, dirLen) {
    var q = 360 / dirLen;
    return Math.floor(g.normalizeAngle(start.theta(end) + q / 2) / q) * q;
  }

  function getDirectionChange(angle1, angle2) {
    var dirChange = Math.abs(angle1 - angle2);
    return dirChange > 180 ? 360 - dirChange : dirChange;
  }

  // heurestic method to determine the distance between two points
  function estimateCost(from, endPoints) {
    var min = Infinity;

    for (var i = 0, len = endPoints.length; i < len; i++) {
      var cost = from.manhattanDistance(endPoints[i]);
      if (cost < min) {
        min = cost;
      }
    }

    return min;
  }

  function findRoute(start, end, map, opt) {
    const step = opt.step;
    let startPoints, endPoints;
    let startCenter, endCenter;

    if (start instanceof g.rect) {
      startPoints = getRectPoints(start, opt.startDirections, opt);
      startCenter = start.center().snapToGrid(step);
    } else {
      startCenter = start.clone().snapToGrid(step);
      startPoints = [startCenter];
    }

    if (end instanceof g.rect) {
      endPoints = getRectPoints(end, opt.endDirections, opt);
      endCenter = end.center().snapToGrid(step);
    } else {
      endCenter = end.clone().snapToGrid(step);
      endPoints = [endCenter];
    }

    const accessibleStartPoints = [];
    for (let i = 0; i < startPoints.length; i++) {
      if (map.isPointAccessible(startPoints[i])) {
        accessibleStartPoints.push(startPoints[i]);
      }
    }
    startPoints = accessibleStartPoints;

    const accessibleEndPoints = [];
    for (let i = 0; i < endPoints.length; i++) {
      if (map.isPointAccessible(endPoints[i])) {
        accessibleEndPoints.push(endPoints[i]);
      }
    }
    endPoints = accessibleEndPoints;

    if (startPoints.length > 0 && endPoints.length > 0) {
      const openSet = new SortedSet();
      const parents = {};
      const costs = {};
      const dirs = opt.directions;
      const dirLen = dirs.length;
      const penalties = opt.penalties;
      let loopsRemain = opt.maximumLoops;

      const endPointsKeys = new Array(endPoints.length);
      for (let i = 0; i < endPoints.length; i++) {
        endPointsKeys[i] = endPoints[i].toString();
      }

      for (let i = 0; i < startPoints.length; i++) {
        const point = startPoints[i];
        const key = point.toString();
        openSet.add(key, estimateCost(point, endPoints));
        costs[key] = 0;
      }

      let currentDirAngle;
      let previousDirAngle;

      while (!openSet.isEmpty() && loopsRemain > 0) {
        const currentKey = openSet.pop();
        const currentPoint = g.point(currentKey);
        const currentDist = costs[currentKey];
        previousDirAngle = currentDirAngle;
        /* jshint eqeqeq: false */
        currentDirAngle = parents[currentKey]
          ? getDirectionAngle(parents[currentKey], currentPoint, dirLen)
          : opt.previousDirAngle != null
            ? opt.previousDirAngle
            : getDirectionAngle(startCenter, currentPoint, dirLen);
        /* jshint eqeqeq: true */

        if (endPointsKeys.indexOf(currentKey) >= 0) {
          const dirChange = getDirectionChange(
            currentDirAngle,
            getDirectionAngle(currentPoint, endCenter, dirLen)
          );
          if (currentPoint.equals(endCenter) || dirChange < 180) {
            opt.previousDirAngle = currentDirAngle;
            return reconstructRoute(
              parents,
              currentPoint,
              startCenter,
              endCenter
            );
          }
        }

        for (let i = 0; i < dirLen; i++) {
          const dir = dirs[i];
          const dirChange = getDirectionChange(currentDirAngle, dir.angle);

          if (previousDirAngle && dirChange > opt.maxAllowedDirectionChange) {
            continue;
          }

          const neighborPoint = currentPoint
            .clone()
            .offset(dir.offsetX, dir.offsetY);
          const neighborKey = neighborPoint.toString();

          if (
            openSet.isClose(neighborKey) ||
            !map.isPointAccessible(neighborPoint)
          ) {
            continue;
          }

          const penalty =
            penalties[dirChange] !== undefined
              ? penalties[dirChange]
              : Infinity;
          const costFromStart = currentDist + dir.cost + penalty;

          if (
            !openSet.isOpen(neighborKey) ||
            costFromStart < costs[neighborKey]
          ) {
            parents[neighborKey] = currentPoint;
            costs[neighborKey] = costFromStart;
            openSet.add(
              neighborKey,
              costFromStart + estimateCost(neighborPoint, endPoints)
            );
          }
        }

        loopsRemain--;
      }
    }

    return opt.fallbackRoute(startCenter, endCenter, opt);
  }

  // resolve some of the options
  function resolveOptions(opt) {
    opt.directions = callFuncByObjectProperty(opt, 'directions');
    opt.penalties = callFuncByObjectProperty(opt, 'penalties');
    opt.paddingBox = callFuncByObjectProperty(opt, 'paddingBox');

    for (var i = 0, no = opt.directions.length; i < no; i++) {
      var point1 = g.point(0, 0);
      var point2 = g.point(
        opt.directions[i].offsetX,
        opt.directions[i].offsetY
      );

      opt.directions[i].angle = g.normalizeAngle(point1.theta(point2));
    }
  }

  // initiation of the route finding
  function router(vertices, opt) {
    resolveOptions(opt);

    // jshint -W040

    // enable/disable linkView perpendicular option
    this.options.perpendicular = !!opt.perpendicular;

    // Force source/target BBoxes to be points

    this.sourceBBox.x += this.sourceBBox.width / 2;
    this.sourceBBox.y += this.sourceBBox.height / 2;
    this.sourceBBox.width = 0;
    this.sourceBBox.height = 0;

    this.targetBBox.x += this.targetBBox.width / 2;
    this.targetBBox.y += this.targetBBox.height / 2;
    this.targetBBox.width = 0;
    this.targetBBox.height = 0;

    // Coincident / near-coincident endpoints (e.g. a label dropped almost on
    // top of a port). With no vertices to route through, the A* pathfinder
    // wanders a couple of steps in the start/end directions and returns a tiny
    // square loop. Connect such endpoints directly instead.
    if (
      vertices.length === 0 &&
      Math.abs(this.sourceBBox.x - this.targetBBox.x) <= 2 * opt.step &&
      Math.abs(this.sourceBBox.y - this.targetBBox.y) <= 2 * opt.step
    ) {
      return [];
    }

    // expand boxes by specific padding
    var sourceBBox = g.rect(this.sourceBBox);
    var targetBBox = g.rect(this.targetBBox);

    // pathfinding
    var map = new ObstacleMap(opt, this.paper).build(
      this.paper.model,
      this.model
    );
    var oldVertices = _.map(vertices, g.point);
    var newVertices = [];
    var tailPoint = sourceBBox.center().snapToGrid(opt.step);

    var from;
    var to;

    // find a route by concating all partial routes (routes need to go through the vertices)
    // startElement -> vertex[1] -> ... -> vertex[n] -> endElement
    for (var i = 0, len = oldVertices.length; i <= len; i++) {
      var partialRoute = null;

      from = to || sourceBBox;
      to = oldVertices[i];

      if (!to) {
        to = targetBBox;

        // 'to' is not a vertex. If the target is a point (i.e. it's not an element), we
        // might use dragging route instead of main routing method if that is enabled.
        var endingAtPoint =
          !this.model.get('source').id || !this.model.get('target').id;

        if (endingAtPoint && _.isFunction(opt.draggingRoute)) {
          // Make sure we passing points only (not rects).
          var dragFrom = from instanceof g.rect ? from.center() : from;
          partialRoute = opt.draggingRoute(dragFrom, to.origin(), opt);
        }
      }

      // if partial route has not been calculated yet use the main routing method to find one
      partialRoute = partialRoute || findRoute(from, to, map, opt);

      if (partialRoute === null) {
        // The partial route could not be found.
        // use orthogonal (do not avoid elements) route instead.
        if (!_.isFunction(joint.routers.orthogonal)) {
          throw new Error('Manhattan requires the orthogonal router.');
        }
        return joint.routers.orthogonal(vertices, opt, this);
      }

      var leadPoint = _.first(partialRoute);

      if (leadPoint && leadPoint.equals(tailPoint)) {
        // remove the first point if the previous partial route had the same point as last
        partialRoute.shift();
      }

      tailPoint = _.last(partialRoute) || tailPoint;

      Array.prototype.push.apply(newVertices, partialRoute);
    }

    return newVertices;
  }

  // public function
  return function (vertices, opt, linkView) {
    if (linkView.sourceMagnet) {
      opt.startDirections = [linkView.sourceMagnet.attributes.pos.value];
    }

    if (linkView.targetMagnet) {
      opt.endDirections = [linkView.targetMagnet.attributes.pos.value];
    }

    return router.call(linkView, vertices, _.extend({}, config, opt));
  };
})(g, _, joint);
