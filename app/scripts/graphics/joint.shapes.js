//-- jshint rules
/* global placementCssIOTasks, placementCssTasks */

'use strict';

var os = require('os');
var sha1 = require('sha1');
var marked = require('marked'); // jshint unused:false
var openurl = require('openurl'); // jshint unused:false
var domCache = {};
const WIRE_WIDTH = 2;
const DARWIN = Boolean(os.platform().indexOf('darwin') > -1);

if (DARWIN) {
  var aceFontSize = '12';
} else {
  var aceFontSize = '14';
}

// Model element

/* MOD  1 */

joint.shapes.ice = {};
joint.shapes.ice.Model = joint.shapes.basic.Generic.extend({
  markup:
    '<g class="rotatable">\
             <g class="scalable">\
               <rect class="body"/>\
             </g>\
             <g class="leftPorts disable-port"/>\
             <g class="rightPorts"/>\
             <g class="topPorts disable-port"/>\
             <g class="bottomPorts"/>\
           </g>',
  portMarkup:
    '<g class="port port<%= index %>">\
                 <g class="port-default" id="port-default-<%= id %>-<%= port.id %>">\
                    <path/><rect/>\
                 </g>\
                 <path class="port-wire <%= wireClass %>" id="port-wire-<%= id %>-<%= port.id %>"/>\
                 <text class="port-label"/>\
                 <circle class="port-body" r="0"/>\
               </g>',

  defaults: joint.util.deepSupplement(
    {
      type: 'ice.Model',
      size: {
        width: 1,
        height: 1,
      },
      leftPorts: [],
      rightPorts: [],
      topPorts: [],
      bottomPorts: [],
      attrs: {
        '.': {
          magnet: false,
        },
        '.port-body': {
          r: 16,
        },
        '.leftPorts .port-body': {
          pos: 'left',
          type: 'input',
          magnet: false,
        },
        '.rightPorts .port-body': {
          pos: 'right',
          type: 'output',
          magnet: true,
        },
        '.topPorts .port-body': {
          pos: 'top',
          type: 'input',
          magnet: false,
        },
        '.bottomPorts .port-body': {
          pos: 'bottom',
          type: 'output',
          magnet: true,
        },
        '.port-default rect': {
          x: '-16',
          y: '-8',
          rx: '3',
          ry: '3',
        },
        '.port-default path': {
          d: 'M 0 0 L 0 0',
        },
      },
    },
    joint.shapes.basic.Generic.prototype.defaults
  ),

  initialize: function () {
    this.updatePortsAttrs();
    this.processPorts();
    this.trigger('process:ports');
    this.on(
      'change:size change:leftPorts change:rightPorts change:topPorts change:bottomPorts',
      this.updatePortsAttrs,
      this
    );
    joint.shapes.basic.Generic.prototype.initialize.apply(this, arguments);
  },

  updatePortsAttrs: function () {
    //args:events
    if (this._portSelectors) {
      var newAttrs = _.omit(this.get('attrs'), this._portSelectors);
      this.set('attrs', newAttrs, { silent: true });
    }

    var attrs = {};
    this._portSelectors = [];

    _.each(
      ['left', 'right'],
      function (type) {
        var port = type + 'Ports';
        _.each(
          this.get(port),
          function (portName, index, ports) {
            var portAttributes = this.getPortAttrs(
              portName,
              index,
              ports.length,
              '.' + port,
              type,
              this.get('size').height
            );
            this._portSelectors = this._portSelectors.concat(
              _.keys(portAttributes)
            );

            _.extend(attrs, portAttributes);

            // console.log('PORTS',portName, index,ports,attrs,portAttributes);
          },
          this
        );
      },
      this
    );

    _.each(
      ['top', 'bottom'],
      function (type) {
        var port = type + 'Ports';
        _.each(
          this.get(port),
          function (portName, index, ports) {
            var portAttributes = this.getPortAttrs(
              portName,
              index,
              ports.length,
              '.' + port,
              type,
              this.get('size').width
            );
            this._portSelectors = this._portSelectors.concat(
              _.keys(portAttributes)
            );
            _.extend(attrs, portAttributes);
          },
          this
        );
      },
      this
    );

    this.attr(attrs, { silent: true });
  },

  getPortAttrs: function (port, index, total, selector, type, length) {
    var attrs = {};
    var gridsize = 8;
    var gridunits = length / gridsize;

    var portClass = 'port' + index;
    var portSelector = selector + '>.' + portClass;
    var portLabelSelector = portSelector + '>.port-label';
    var portWireSelector = portSelector + '>.port-wire';
    var portBodySelector = portSelector + '>.port-body';
    var portDefaultSelector = portSelector + '>.port-default';

    var portColor =
      typeof this.attributes.data.blockColor !== 'undefined'
        ? this.attributes.data.blockColor
        : 'lime';

    attrs[portSelector] = {
      ref: '.body',
    };

    attrs[portLabelSelector] = {
      text: port.label,
    };

    attrs[portWireSelector] = {};

    attrs[portBodySelector] = {
      port: {
        id: port.id,
        type: type,
        fill: portColor,
        size: port.size,
      },
    };

    attrs[portDefaultSelector] = {
      display: port.default && port.default.apply ? 'inline' : 'none',
    };

    if (type === 'leftPorts' || type === 'topPorts') {
      attrs[portSelector]['pointer-events'] = 'none';
      attrs[portWireSelector]['pointer-events'] = 'none';
    }

    var offset = port.size && port.size > 1 ? 4 : 1;
    var position = Math.round(((index + 0.5) / total) * gridunits) / gridunits;

    switch (type) {
      case 'left':
        attrs[portSelector]['ref-x'] = -16;
        attrs[portSelector]['ref-y'] = position;
        attrs[portLabelSelector]['dx'] = 0;
        attrs[portLabelSelector]['y'] = -5 - offset;
        attrs[portLabelSelector]['text-anchor'] = 'end';
        attrs[portWireSelector]['y'] = position;
        attrs[portWireSelector]['d'] = 'M 0 0 L 16 0';
        break;
      case 'right':
        attrs[portSelector]['ref-dx'] = 16;
        attrs[portSelector]['ref-y'] = position;
        attrs[portLabelSelector]['dx'] = 0;
        attrs[portLabelSelector]['y'] = -5 - offset;
        attrs[portLabelSelector]['text-anchor'] = 'start';
        attrs[portWireSelector]['y'] = position;
        attrs[portWireSelector]['d'] = 'M 0 0 L -16 0';
        break;
      case 'top':
        attrs[portSelector]['ref-y'] = -8;
        attrs[portSelector]['ref-x'] = position;
        attrs[portLabelSelector]['dx'] = -4;
        attrs[portLabelSelector]['y'] = -5 - offset;
        attrs[portLabelSelector]['text-anchor'] = 'start';
        attrs[portLabelSelector]['transform'] = 'rotate(-90)';
        attrs[portWireSelector]['x'] = position;
        attrs[portWireSelector]['d'] = 'M 0 0 L 0 8';
        break;
      case 'bottom':
        attrs[portSelector]['ref-dy'] = 8;
        attrs[portSelector]['ref-x'] = position;
        attrs[portLabelSelector]['dx'] = 4;
        attrs[portLabelSelector]['y'] = -5 - offset;
        attrs[portLabelSelector]['text-anchor'] = 'end';
        attrs[portLabelSelector]['transform'] = 'rotate(-90)';
        attrs[portWireSelector]['x'] = position;
        attrs[portWireSelector]['d'] = 'M 0 0 L 0 -8';
        break;
    }

    return attrs;
  },
});

joint.shapes.ice.ModelView = joint.dia.ElementView.extend({
  template: '',

  initialize: function () {
    _.bindAll(this, 'updateBox');
    joint.dia.ElementView.prototype.initialize.apply(this, arguments);

    this.$box = $(joint.util.template(this.template)());

    this.model.on('change', this.updateBox, this);
    this.model.on('remove', this.removeBox, this);

    this.updateBox();

    this.listenTo(this.model, 'process:ports', this.update);
  },

  setupResizer: function () {
    // Resizer
    if (!this.model.get('disabled')) {
      this.resizing = false;
      this.resizer = this.$box.find('.resizer');
      this.resizer.css('cursor', 'se-resize');
      this.resizer.on('mousedown', { self: this }, this.startResizing);
      $(document).on('mousemove', { self: this }, this.performResizing);
      $(document).on('mouseup', { self: this }, this.stopResizing);
    }
  },

  enableResizer: function () {
    if (!this.model.get('disabled')) {
      this.resizerDisabled = false;
      this.resizer.css('cursor', 'se-resize');
    }
  },

  disableResizer: function () {
    if (!this.model.get('disabled')) {
      this.resizerDisabled = true;
      this.resizer.css('cursor', 'move');
    }
  },

  apply: function () {},

  startResizing: function (event) {
    var self = event.data.self;

    if (self.resizerDisabled) {
      return;
    }
    self.model.graph.trigger('batch:start');

    self.resizing = true;
    self._clientX = event.clientX;
    self._clientY = event.clientY;
  },

  performResizing: function (event) {
    var self = event.data.self;

    if (!self.resizing || self.resizerDisabled) {
      return;
    }

    var type = self.model.get('type');
    var size = self.model.get('size');
    var state = self.model.get('state');
    var gridstep = 8;
    var minSize = { width: 64, height: 32 };
    if (type === 'ice.Code' || type === 'ice.Memory') {
      minSize = { width: 96, height: 64 };
    }

    var clientCoords = snapToGrid({ x: event.clientX, y: event.clientY });
    var oldClientCoords = snapToGrid({ x: self._clientX, y: self._clientY });

    var dx = clientCoords.x - oldClientCoords.x;
    var dy = clientCoords.y - oldClientCoords.y;

    var width = Math.max(size.width + dx, minSize.width);
    var height = Math.max(size.height + dy, minSize.height);

    if (width > minSize.width) {
      self._clientX = event.clientX;
    }

    if (height > minSize.height) {
      self._clientY = event.clientY;
    }

    self.model.resize(width, height);

    function snapToGrid(coords) {
      return {
        x: Math.round(coords.x / state.zoom / gridstep) * gridstep,
        y: Math.round(coords.y / state.zoom / gridstep) * gridstep,
      };
    }
  },

  stopResizing: function (event) {
    var self = event.data.self;

    if (!self.resizing || self.resizerDisabled) {
      return;
    }

    self.resizing = false;
    self.model.graph.trigger('batch:stop');
  },

  render: function () {
    joint.dia.ElementView.prototype.render.apply(this, arguments);
    this.paper.$el.append(this.$box);
    this.updateBox();
    return this;
  },

  renderPorts: function () {
    var $leftPorts = this.$('.leftPorts').empty();
    var $rightPorts = this.$('.rightPorts').empty();
    var $topPorts = this.$('.topPorts').empty();
    var $bottomPorts = this.$('.bottomPorts').empty();
    var portTemplate = _.template(this.model.portMarkup);
    var modelId = this.model.id;
    //var wireClass = (this.model.size > 1)? 'wire-bus' : '';
    //console.log('WIRE',this.model, wireClass, this.model.size);

    var wireClass = '';
    _.each(
      _.filter(this.model.ports, function (p) {
        return p.type === 'left';
      }),
      function (port, index) {
        wireClass = port.size > 1 ? 'wire-bus' : 'wire-single';
        $leftPorts.append(
          V(
            portTemplate({
              id: modelId,
              index: index,
              port: port,
              wireClass: wireClass,
            })
          ).node
        );
      }
    );
    _.each(
      _.filter(this.model.ports, function (p) {
        return p.type === 'right';
      }),
      function (port, index) {
        wireClass = port.size > 1 ? 'wire-bus' : 'wire-single';
        $rightPorts.append(
          V(
            portTemplate({
              id: modelId,
              index: index,
              port: port,
              wireClass: wireClass,
            })
          ).node
        );
      }
    );
    _.each(
      _.filter(this.model.ports, function (p) {
        return p.type === 'top';
      }),
      function (port, index) {
        $topPorts.append(
          V(
            portTemplate({
              id: modelId,
              index: index,
              port: port,
              wireClass: 'wire-single',
            })
          ).node
        );
      }
    );
    _.each(
      _.filter(this.model.ports, function (p) {
        return p.type === 'bottom';
      }),
      function (port, index) {
        $bottomPorts.append(
          V(
            portTemplate({
              id: modelId,
              index: index,
              port: port,
              wireClass: 'wire-single',
            })
          ).node
        );
      }
    );
  },

  update: function () {
    this.renderPorts();
    joint.dia.ElementView.prototype.update.apply(this, arguments);
  },

  updateBox: function () {},

  removeBox: function () {
    //event variable arg
    this.$box.remove();
  },

  updateScrollStatus: function (status) {
    if (this.editor) {
      this.editor.renderer.scrollBarV.element.style.visibility = status
        ? ''
        : 'hidden';
      this.editor.renderer.scrollBarH.element.style.visibility = status
        ? ''
        : 'hidden';
      this.editor.renderer.scroller.style.right = 0;
      this.editor.renderer.scroller.style.bottom = 0;
    }
  },
});

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
      const leftPorts = this.model.get('leftPorts');
      const rightPorts = this.model.get('rightPorts');
      const modelId = this.model.id;

      let width = WIRE_WIDTH * state.zoom;

      this.initialized = true;
      const nwidth = width * 3;
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
      var portDefault, paths, rects, j;

      if (data && data.ports && data.ports.in) {
        tokId = 'port-default-' + modelId + '-';
        for (i = 0; i < data.ports.in.length; i++) {
          port = data.ports.in[i];
          //portDefault = document.getElementById(tokId + port.name);
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
