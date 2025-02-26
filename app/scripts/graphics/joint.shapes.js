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
                 <g class="port-default" id="port-default-<%= id %>-<%= port.id %>" data-portid="<%= port.id %>">\
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

    /*   attrs[portDefaultSelector] = {
      display: port.default && port.default.apply ? 'inline' : 'none',
    };
*/
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

  place: function (selector, bbox, state, queue) {
    const bw = Math.round(bbox.width);
    const bh = Math.round(bbox.height);
    const bx = Math.round(bbox.x * state.zoom + state.pan.x);
    const by = Math.round(bbox.y * state.zoom + state.pan.y);

    const box = this.$box[0];

    if (typeof box.dataset.osize === 'undefined') {
      // Estilos iniciales de box
      box.style.left = '0px';
      box.style.top = '0px';

      // Cachear y obtener elementos hijos
      const cacheKey = this.id + this.cid + selector;
      let gcontent = domCache[cacheKey];
      if (!gcontent) {
        gcontent = Array.from(box.querySelectorAll(selector));
        domCache[cacheKey] = gcontent;
      }

      // Estilos de gcontent
      for (let i = 0; i < gcontent.length; i++) {
        gcontent[i].style.left = '0px';
        gcontent[i].style.top = '0px';
        gcontent[i].style.height = bh + 'px';
        gcontent[i].style.width = bw + 'px';
      }

      // Estilos finales de box
      box.style.height = bh + 'px';
      box.style.width = bw + 'px';
      box.dataset.osize = `w:${bw}|h:${bh}`;
      box.style['transform-origin'] = '0 0';
    }

    box.style.transform = `translate3d(${bx}px, ${by}px, 0) scale(${state.zoom})`;
  },

  placeIO: function (data, bbox, state) {
    const virtualtopOffset = 24;
    const fpgaTopOffset = data.name || data.range || data.clock ? 0 : 24;

    let bx = Math.round(bbox.x * state.zoom + state.pan.x);
    let by = Math.round(bbox.y * state.zoom + state.pan.y);
    const bx0 = bx;
    const by0 = by;
    const bw = bbox.width;
    let bh = bbox.height;

    const box = this.nativeDom.box;

    if (typeof box.dataset.osize === 'undefined') {
      box.dataset.osize = `w:${bw}|h:${bh}`;

      Object.assign(box.style, {
        'left': '0px',
        'top': '0px',
        'width': `${bw}px`,
        'height': `${bh}px`,
        'transform-origin': '0 0',
      });

      bx = Math.round((bbox.width / 2.0) * (state.zoom - 1));
      by = Math.round(
        ((bbox.height - virtualtopOffset) / 2.0) * (state.zoom - 1) +
          (virtualtopOffset / 2.0) * state.zoom
      );
      bh = Math.round(bbox.height - virtualtopOffset);

      this.nativeDom.virtualContentSelector.forEach((el) => {
        Object.assign(el.style, {
          left: '0px',
          top: '20%',
          width: `${bw}px`,
          height: `${bh}px`,
        });
      });
    }

    bh = Math.round(bbox.height - fpgaTopOffset);

    this.nativeDom.fpgaContentSelector.forEach((el) => {
      Object.assign(el.style, {
        left: '0px',
        top: '0px',
        width: `${bw}px`,
        height: `${bh}px`,
      });
    });

    box.style.transform = `translate3d(${bx0}px, ${by0}px, 0) scale(${state.zoom})`;

    if (this.headerSelector) {
      if (data.name || data.range || data.clock) {
        this.headerSelector.removeClass('hidden');
      } else {
        this.headerSelector.addClass('hidden');
      }
    }
  },

  setupResizer: function () {
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
