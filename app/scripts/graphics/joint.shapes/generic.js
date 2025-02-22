//-- jshint rules
/* global  placementCssTasks */

'use strict';

// Generic block

joint.shapes.ice.Generic = joint.shapes.ice.Model.extend({
  defaults: joint.util.deepSupplement(
    {
      type: 'ice.Generic',
      z: 10,
    },
    joint.shapes.ice.Model.prototype.defaults
  ),
});

joint.shapes.ice.GenericView = joint.shapes.ice.ModelView.extend({
  // Image comments:
  // - img: fast load, no interactive
  // - object: slow load, interactive
  // - inline SVG: fast load, interactive, but...
  //               old SVG files have no viewBox, therefore no properly resize
  //               Inkscape adds this field saving as "Optimize SVG" ("Enable viewboxing")

  template:
    '\
  <div class="generic-block">\
    <div class="generic-content">\
      <div class="img-container"><img></div>\
      <label></label>\
      <span class="tooltiptext"></span>\
    </div>\
  </div>\
  ',

  events: {
    mouseover: 'mouseovercard',
    mouseout: 'mouseoutcard',
    mouseup: 'mouseupcard',
    mousedown: 'mousedowncard',
  },

  enter: false,

  mouseovercard: function (event) {
    // Possible args: x  y
    if (event && event.which === 0) {
      // Mouse button not pressed
      this.showTooltip();
    }
  },

  mouseoutcard: function () {
    // Possible args: event x y
    this.hideTooltip();
  },

  mouseupcard: function () {}, // Possible args: event x y

  mousedowncard: function () {
    // Possible args: event x y
    this.hideTooltip();
  },

  showTooltip: function () {
    if (this.tooltip) {
      if (!this.openTimeout) {
        this.openTimeout = setTimeout(
          function () {
            this.tooltiptext.css('visibility', 'visible');
          }.bind(this),
          2000
        );
      }
    }
  },

  hideTooltip: function () {
    if (this.tooltip) {
      if (this.openTimeout) {
        clearTimeout(this.openTimeout);
        this.openTimeout = null;
      }
      this.tooltiptext.css('visibility', 'hidden');
    }
  },

  cache: { dom: {} },
  initialize: function () {
    joint.shapes.ice.ModelView.prototype.initialize.apply(this, arguments);

    this.tooltip = this.model.get('tooltip');
    this.tooltiptext = this.$box.find('.tooltiptext');
    this.tooltiptext.text(this.tooltip);

    if (this.tooltip.length > 13) {
      this.tooltiptext.addClass('tooltip-medium');
      this.tooltiptext.removeClass('tooltip-large');
    } else if (this.tooltip.length > 20) {
      this.tooltiptext.addClass('tooltip-large');
      this.tooltiptext.removeClass('tooltip-medium');
    } else {
      this.tooltiptext.removeClass('tooltip-medium');
      this.tooltiptext.removeClass('tooltip-large');
    }

    if (this.model.get('config')) {
      this.$box.find('.generic-content').addClass('config-block');
    }

    // Initialize content
    this.initializeContent();
  },

  initializeContent: function () {
    var image = this.model.get('image');
    var label = this.model.get('label');
    var ports = this.model.get('leftPorts');

    var imageSelector = this.$box.find('img');
    var labelSelector = this.$box.find('label');

    if (image) {
      imageSelector.attr('src', `file://${image}`);
      imageSelector.removeClass('hidden');
      labelSelector.addClass('hidden');
    } else {
      // Render label
      labelSelector.html(label);
      labelSelector.removeClass('hidden');
      imageSelector.addClass('hidden');
    }

    // Render clocks
    this.$box.find('.clock').remove();
    var n = ports.length;
    var gridsize = 8;
    var height = this.model.get('size').height;
    var contentSelector = this.$box.find('.generic-content');
    for (var i in ports) {
      var port = ports[i];
      if (port.clock) {
        var top =
          Math.round(((parseInt(i) + 0.5) * height) / n / gridsize) * gridsize -
          9;
        contentSelector.append(
          '\
          <div class="clock" style="top: ' +
            top +
            'px;">\
            <svg width="12" height="18"><path d="M-1 0 l10 8-10 8" fill="none" stroke="#555" stroke-width="1.2" stroke-linejoin="round"/>\
          </div>'
        );
      }
    }
    this.updateBox();
  },

  place: placementCssTasks,
  onUpdating: false,
  initialized: false,

  updateBox: function () {
    if (this.onUpdating === false) {
      this.onUpdating = true;
      let pendingTasks = [];
      let i, port;
      const bbox = this.model.getBBox();

      let data = this.model.get('data');
      const state = this.model.get('state');
      const rules = this.model.get('rules');
      // const leftPorts = this.model.get('leftPorts');
      //const rightPorts = this.model.get('rightPorts');
      const modelId = this.model.id;

      /// let width = WIRE_WIDTH * state.zoom;

      this.initialized = true;
      // const nwidth = width * 3;
      let tokId = 'port-wire-' + modelId + '-';
      let dome;
      this.cacheDome = {};
      let ckey = '--';

      // CODE IN TESTING REMOVE IN NEXT ITERATION, NOT REMOVE FOR THE MOMENT
      /*  if (typeof this.pwires === 'undefined') {
          this.pwires = this.$el[0].getElementsByClassName('port-wire');
        }

        for (i = 0; i < this.pwires.length; i++) {
          pendingTasks.push({
            e: this.pwires[i],
            property: 'stroke-width',
            value: width + 'px',
          });
        }
        for (i = 0; i < leftPorts.length; i++) {
          port = leftPorts[i];
          if (port.size > 1) {
            ckey = tokId + port.id;
            dome =
              typeof this.cacheDome[ckey] !== 'undefined'
                ? this.cacheDome[ckey]
                : document.getElementById(tokId + port.id);
            this.cacheDome[ckey] = dome;

            pendingTasks.push({
              e: dome,
              property: 'stroke-width',
              value: nwidth + 'px',
            });
          }
        }

        for (i = 0; i < rightPorts.length; i++) {
          port = rightPorts[i];
          if (port.size > 1) {
            //dome = document.getElementById(tokId + port.id);
            ckey = tokId + port.id;
            dome =
              typeof this.cacheDome[ckey] !== 'undefined'
                ? this.cacheDome[ckey]
                : document.getElementById(tokId + port.id);
            this.cacheDome[ckey] = dome;

            pendingTasks.push({
              e: dome,
              property: 'stroke-width',
              value: nwidth + 'px',
            });
          }
        }*/

      // Render rules
      var portDefault; //, paths, rects, j;

      if (data && data.ports && data.ports.in) {
        tokId = 'port-default-' + modelId + '-';
        for (i = 0; i < data.ports.in.length; i++) {
          port = data.ports.in[i];
          ckey = tokId + port.name;
          portDefault =
            typeof this.cacheDome[ckey] !== 'undefined'
              ? this.cacheDome[ckey]
              : document.getElementById(tokId + port.name);
          this.cacheDome[ckey] = dome;

          if (
            portDefault !== null &&
            rules &&
            port.default &&
            port.default.apply
          ) {
            portDefault.classList.add('port-visible');

            /* pendingTasks.push({
                e: portDefault,
                property: 'display',
                value: 'inline',
              });*/

            /* paths = domCache[tokId + port.name + 'path'];
              if (!paths) {
                paths = portDefault.querySelectorAll('path');
                domCache[tokId + port.name + 'path'] = paths;
              }

              for (j = 0; j < paths.length; j++) {
                pendingTasks.push({
                  e: paths[j],
                  property: 'stroke-width',
                  value: width + 'px',
                });
              }
              rects = domCache[tokId + port.name + 'rect'];
              if (!rects) {
                rects = portDefault.querySelectorAll('rect');
                domCache[tokId + port.name + 'rect'] = rects;
              }

              for (j = 0; j < rects.length; j++) {
                pendingTasks.push({
                  e: rects[j],
                  property: 'stroke-width',
                  value: state.zoom + 'px',
                });
              }*/
          } else {
            if (portDefault !== null) {
              portDefault.classList.remove('port-visible');
            }
            /*
              pendingTasks.push({
                e: portDefault,
                property: 'display',
                value: 'none',
              });*/
          }
        }
      }

      this.onUpdating = false;
      return this.place('.generic-content', bbox, state, pendingTasks);
    }
    return false;
  },
});
