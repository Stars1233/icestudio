//-- jshint rules
/* global WIRE_WIDTH, isClickOnVertex,computeRoute, findBifurcations */

'use strict';
/*--
 * Click filter to choose between click on path , vertex or remove marker isClickOnVertex
 --*/
const originalPointerDown = joint.dia.LinkView.prototype.pointerdown;
joint.dia.LinkView.prototype.pointerdown = function (evt, x, y) {
  // Delete marker icon -> default jointjs action
  if (evt.target.closest('.marker-vertex-remove')) {
    originalPointerDown.apply(this, arguments);
    return;

    // Vertex group area but no control point neither delete icon -> default jointjs action
  }

  if (evt.target.closest('.marker-vertex-group')) {
    originalPointerDown.apply(this, arguments);
    return;

    // Vertex control point -> jointjs management
  }

  if (isClickOnVertex(this, x, y, 10)) {
    originalPointerDown.apply(this, arguments);
    return;
    // Click on path -> stop default jointjs actions and derive to our route algorithm
  }
  evt.stopPropagation();
  evt.preventDefault();
};

/*--
 * Custom wire
--*/
joint.shapes.ice.Wire = joint.dia.Link.extend({
  markup: [
    '<path class="connection" d="M 0 0 0 0"/>',
    '<path class="connection-wrap" d="M 0 0 0 0"/>',
    '<path class="marker-source" d="M 0 0 0 0"/>',
    '<path class="marker-target" d="M 0 0 0 0"/>',
    '<g class="marker-vertices"/>',
    '<g class="marker-bifurcations"/>',
    '<g class="marker-arrowheads"/>',
    '<g class="link-tools"/>',
  ].join(''),

  bifurcationMarkup: [
    '<g class="marker-bifurcation-group" transform="translate(<%= x %>, <%= y %>)">',
    '<circle class="marker-bifurcation" idx="<%= idx %>" r="<%= r %>" fill="#777"/>',
    '</g>',
  ].join(''),

  arrowheadMarkup: [
    '<g class="marker-arrowhead-group marker-arrowhead-group-<%= end %>">',
    '<circle class="marker-arrowhead" end="<%= end %>" r="8"/>',
    '</g>',
  ].join(''),

  toolMarkup: [
    '<g class="link-tool">',
    '<g class="tool-remove" event="remove">',
    '<circle r="8" />',
    '<path transform="scale(.6) translate(-16, -16)" d="M24.778,21.419 19.276,15.917 24.777,10.415 21.949,7.585 16.447,13.087 10.945,7.585 8.117,10.415 13.618,15.917 8.116,21.419 10.946,24.248 16.447,18.746 21.948,24.248z" />',
    '<title>Remove link</title>',
    '</g>',
    '</g>',
  ].join(''),

  vertexMarkup: [
    '<g class="marker-vertex-group" transform="translate(<%= x %>, <%= y %>)">',
    '<circle class="marker-vertex" idx="<%= idx %>" r="8" />',
    '<path class="marker-vertex-remove-area" idx="<%= idx %>" transform="scale(.8) translate(5, -33)" d="M16,5.333c-7.732,0-14,4.701-14,10.5c0,1.982,0.741,3.833,2.016,5.414L2,25.667l5.613-1.441c2.339,1.317,5.237,2.107,8.387,2.107c7.732,0,14-4.701,14-10.5C30,10.034,23.732,5.333,16,5.333z"/>',
    '<path class="marker-vertex-remove" idx="<%= idx %>" transform="scale(.6) translate(11.5, -39)" d="M24.778,21.419 19.276,15.917 24.777,10.415 21.949,7.585 16.447,13.087 10.945,7.585 8.117,10.415 13.618,15.917 8.116,21.419 10.946,24.248 16.447,18.746 21.948,24.248z">',
    '<title>Remove vertex</title>',
    '</path>',
    '</g>',
  ].join(''),

  defaults: joint.util.deepSupplement(
    {
      type: 'ice.Wire',
      z: 1,
      attrs: {
        '.connection': {
          'stroke-width': WIRE_WIDTH,
          'stroke': '#777',
        },
      },

      router: { name: 'ice' },
      connector: { name: 'ice' },
    },
    joint.dia.Link.prototype.defaults
  ),
});

joint.shapes.ice.WireView = joint.dia.LinkView.extend({
  options: {
    shortLinkLength: 64,
    longLinkLength: 160,
    linkToolsOffset: 40,
  },

  initialize: function () {
    joint.dia.LinkView.prototype.initialize.apply(this, arguments);
    // requestAnimationFrame(() => {
    setTimeout(() => {
      var size = this.model.get('size');

      if (!size) {
        // New wire
        var i,
          port,
          portName = this.model.get('source').port;
        var rightPorts = this.sourceView.model.get('rightPorts');
        // Initialize wire properties
        for (i in rightPorts) {
          port = rightPorts[i];
          if (portName === port.id) {
            size = port.size;
            // For wire size connection validation
            this.model.attributes.size = size;
            break;
          }
        }
      }
      this.setWireClass(size);

      // Hide clk yellow block if is connected on load
      let target = this.model.get('target');
      let isClk = document.getElementById(
        `port-default-${target.id}-${target.port}`
      );
      if (isClk) {
        isClk.classList.add('wire-connected');
      }
    }, 0);
    setTimeout(() => {
      this.updateBifurcations();
    }, 50);
  },

  apply: function () {
    // No operation required
  },

  render: function () {
    joint.dia.LinkView.prototype.render.apply(this, arguments);
    return this;
  },

  remove: function () {
    // Hide clk yellow block if is connected on load
    let target = this.model.get('target');
    let isClk = document.getElementById(
      `port-default-${target.id}-${target.port}`
    );
    if (isClk) {
      isClk.classList.remove('wire-connected');
    }

    joint.dia.LinkView.prototype.remove.apply(this, arguments);
    this.updateBifurcations();
    return this;
  },

  update: function () {
    joint.dia.LinkView.prototype.update.apply(this, arguments);
    this.updateBifurcations();
    return this;
  },

  updateToolsPosition: function () {
    if (!this._V.linkTools) {
      return this;
    }

    var scale = '';
    var offset = this.options.linkToolsOffset;
    var connectionLength = this.getConnectionLength();

    if (!_.isNaN(connectionLength)) {
      // If the link is too short, make the tools half the size and the offset twice as low.
      if (connectionLength < this.options.shortLinkLength) {
        scale = 'scale(.5)';
        offset /= 2;
      }

      var toolPosition = this.getPointAtLength(connectionLength - offset);
      this._toolCache.attr(
        'transform',
        'translate(' + toolPosition.x + ', ' + toolPosition.y + ') ' + scale
      );
    }

    return this;
  },

  /* Changed the way of updating wire, very most optimized by css calc
   * instead constant dom update, but for the moment , recomend not delete
   * the old function to have near if something go bad
   */

  setWireClass: function (size) {
    var connection = this.$('.connection');
    connection.removeClass('wire-bus wire-single');

    if (size > 1) {
      connection.addClass('wire-bus');
    } else {
      connection.addClass('wire-single');
    }
  },

  updateWireProperties: function () {
    return;
  },

  updateConnection: function (opt) {
    opt = opt || {};
    var route = (this.route = this.findRoute(
      this.model.get('vertices') || [],
      opt
    ));

    this._findConnectionPoints(route);
    var pathData = this.getPathData(route);
    this._V.connection.attr('d', pathData.full);
    if (this._V.connectionWrap) {
      this._V.connectionWrap.attr('d', pathData.wrap);
    }

    this._translateAndAutoOrientArrows(
      this._V.markerSource,
      this._V.markerTarget
    );
  },

  updateBifurcations: function () {
    if (this._V.markerBifurcations) {
      const self = this;
      const currentWire = this.model;
      const allWires = this.paper.model.getLinks();
      const markupTemplate = joint.util.template(
        this.model.get('bifurcationMarkup') || this.model.bifurcationMarkup
      );

      //const wireViewCache = new Map();
      const bifurcationPoints = new Set();

      const portWires = allWires
        .filter((wire) => {
          const wireSource = wire.get('source');
          const cwireSource = currentWire.get('source');
          return (
            wireSource.id === cwireSource.id &&
            wireSource.port === cwireSource.port
          );
        })
        .map((wire) => {
          const wireView = self.paper.findViewByModel(wire);
          const markersNode = wireView._V.markerBifurcations.node;
          $(markersNode).empty();
          return {
            id: wire.get('id'),
            view: wireView,
            markersNode,
          };
        });

      const wireRoutes = new Map();
      portWires.forEach(({ view, id }) => {
        wireRoutes.set(id, computeRoute(view));
      });

      portWires.forEach((wireA, indexA) => {
        const vA = wireRoutes.get(wireA.id);
        if (vA.length <= 2) {
          return; // If no corners, go out
        }
        for (let i = 1; i < vA.length - 1; i++) {
          if (vA[i - 1].x !== vA[i + 1].x && vA[i - 1].y !== vA[i + 1].y) {
            // Es esquina
            const point = vA[i];
            portWires.forEach((wireB, indexB) => {
              if (indexA === indexB) {
                return;
              }
              const vB = wireRoutes.get(wireB.id);
              findBifurcations(
                point,
                vB,
                wireA.markersNode,
                bifurcationPoints,
                markupTemplate
              );
            });
          }
        }
      });
    }

    return this;
  },
});
