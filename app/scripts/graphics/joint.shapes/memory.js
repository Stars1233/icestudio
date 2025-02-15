//-- jshint rules
/* jshint ignore: start */

/* --global sha1, aceFontSize, WIRE_WIDTH */

'use strict';

// Memory block

joint.shapes.ice.Memory = joint.shapes.ice.Model.extend({
  defaults: joint.util.deepSupplement(
    {
      type: 'ice.Memory',
      size: {
        width: 96,
        height: 104,
      },
    },
    joint.shapes.ice.Model.prototype.defaults
  ),
});

joint.shapes.ice.MemoryView = joint.shapes.ice.ModelView.extend({
  initialize: function () {
    _.bindAll(this, 'updateBox');
    joint.dia.ElementView.prototype.initialize.apply(this, arguments);

    var id = sha1(this.model.get('id')).toString().substring(0, 6);
    var editorLabel = 'editor' + id;

    // Select "ace-editor" theme depending on "uiTheme" profile variable
    var editorTheme;
    if (global.uiTheme === 'dark') {
      // DARK -> theme monokai
      editorTheme = 'monokai';
    } else {
      editorTheme = 'chrome'; // DEFAULT or LIGHT -> theme chrome
    }

    this.$box = $(
      joint.util.template(
        '\
      <div class="memory-block">\
        <div class="memory-content">\
          <div class="header">\
            <label></label>\
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 9.78"><path d="M2.22 4.44h3.56V3.11q0-.73-.52-1.26-.52-.52-1.26-.52t-1.26.52q-.52.52-.52 1.26v1.33zM8 5.11v4q0 .28-.2.47-.19.2-.47.2H.67q-.28 0-.48-.2Q0 9.38 0 9.11v-4q0-.28.2-.47.19-.2.47-.2h.22V3.11q0-1.28.92-2.2Q2.72 0 4 0q1.28 0 2.2.92.91.91.91 2.2v1.32h.22q.28 0 .48.2.19.2.19.47z"/></svg>\
          </div>\
        </div>\
        <div class="memory-editor" id="' +
          editorLabel +
          '"></div>\
        <script>\
          var ' +
          editorLabel +
          ' = ace.edit("' +
          editorLabel +
          '");\
          ' +
          editorLabel +
          '.setTheme("ace/theme/' +
          editorTheme +
          '");\
          ' +
          editorLabel +
          '.setHighlightActiveLine(false);\
          ' +
          editorLabel +
          '.setHighlightGutterLine(false);\
          ' +
          editorLabel +
          '.setOption("firstLineNumber", 0);\
          ' +
          editorLabel +
          '.setAutoScrollEditorIntoView(true);\
          ' +
          editorLabel +
          '.renderer.setShowGutter(true);\
          ' +
          editorLabel +
          '.renderer.$cursorLayer.element.style.opacity = 0;\
          ' +
          editorLabel +
          '.session.setMode("ace/mode/verilog");\
        </script>\
        <div class="resizer"/></div>\
      </div>\
      '
      )()
    );

    this.editorSelector = this.$box.find('.memory-editor');
    this.contentSelector = this.$box.find('.memory-content');
    this.headerSelector = this.$box.find('.header');

    this.model.on('change', this.updateBox, this);
    this.model.on('remove', this.removeBox, this);

    this.listenTo(this.model, 'process:ports', this.update);
    joint.dia.ElementView.prototype.initialize.apply(this, arguments);

    // Prevent paper from handling pointerdown.
    this.editorSelector.on('mousedown click', function (event) {
      event.stopPropagation();
    });

    this.updateBox();

    this.updating = false;
    this.prevZoom = 0;
    this.deltas = [];
    this.counter = 0;
    this.timer = null;
    var undoGroupingInterval = 200;

    var self = this;
    this.editor = ace.edit(this.editorSelector[0]);
    this.updateScrollStatus(false);
    this.editor.$blockScrolling = Infinity;
    this.editor.commands.removeCommand('touppercase');
    this.editor.session.on('change', function (delta) {
      if (!self.updating) {
        // Check consecutive-change interval
        if (Date.now() - self.counter < undoGroupingInterval) {
          clearTimeout(self.timer);
        }
        // Update deltas
        self.deltas = self.deltas.concat([delta]);
        // Launch timer
        self.timer = setTimeout(function () {
          var deltas = JSON.parse(JSON.stringify(self.deltas));
          // Set deltas
          self.model.set('deltas', deltas);
          // Reset deltas
          self.deltas = [];
          // Set data.list
          self.model.attributes.data.list = self.editor.session.getValue();
        }, undoGroupingInterval);
        // Reset counter
        self.counter = Date.now();
      }
    });
    this.editor.on('focus', function () {
      self.updateScrollStatus(true);
      $(document).trigger('disableSelected');
      self.editor.setHighlightActiveLine(true);
      self.editor.setHighlightGutterLine(true);
      // Show cursor
      self.editor.renderer.$cursorLayer.element.style.opacity = 1;
    });
    this.editor.on('blur', function () {
      self.updateScrollStatus(false);
      var selection = self.editor.session.selection;
      if (selection) {
        selection.clearSelection();
      }
      self.editor.setHighlightActiveLine(false);
      self.editor.setHighlightGutterLine(false);
      // Hide cursor
      self.editor.renderer.$cursorLayer.element.style.opacity = 0;
    });
    this.editor.on('paste', function (e) {
      if (e.text.startsWith('{"icestudio":')) {
        // Prevent paste blocks
        e.text = '';
      }
    });
    this.editor.on('mousewheel', function (event) {
      // Stop mousewheel event propagation when target is active
      if (
        document.activeElement.parentNode.id === self.editorSelector.attr('id')
      ) {
        // Enable only scroll
        event.stopPropagation();
      } else {
        // Enable only zoom
        event.preventDefault();
      }
    });

    this.setupResizer();

    // Apply data
    this.apply({ ini: true });
  },

  apply: function (opt) {
    this.applyName();
    this.applyLocal();
    this.applyValue(opt);
    this.applyFormat();
    if (this.editor) {
      this.editor.resize();
    }
  },

  applyName: function () {
    var name = this.model.get('data').name;
    this.$box.find('label').text(name);
  },

  applyLocal: function () {
    if (this.model.get('data').local) {
      this.$box.find('svg').removeClass('hidden');
    } else {
      this.$box.find('svg').addClass('hidden');
    }
  },

  applyValue: function (opt) {
    this.updating = true;
    var data = this.model.get('data');

    opt = opt || {};

    if (opt.ini) {
      this.editor.session.setValue(data.list);
    } else {
      // Set data.list
      this.model.attributes.data.list = this.editor.session.getValue();
    }
    setTimeout(
      function (self) {
        self.updating = false;
      },
      10,
      this
    );
  },

  applyFormat: function () {
    this.updating = true;

    var self = this;
    var data = this.model.get('data');
    var radix = data.format || 16; // Handle bad data that could happen in a previous .ice file
    this.editor.session.gutterRenderer = {
      getWidth: function (session, lastLineNumber, config) {
        return lastLineNumber.toString().length * config.characterWidth;
      },
      getText: function (session, row) {
        var text = row.toString(radix).toUpperCase();
        var config = self.editor.renderer.layerConfig;
        var size = config.lastRow.toString(radix).length;
        while (text.length < size) {
          text = '0' + text;
        }
        return (radix === 16 ? '0x' : '') + text;
      },
    };
    // this.editor.renderer.setShowGutter(false);
    this.editor.renderer.setShowGutter(true);

    this.updating = false;
  },

  update: function () {
    this.renderPorts();
    this.editor.setReadOnly(this.model.get('disabled'));
    joint.dia.ElementView.prototype.update.apply(this, arguments);
  },

  updateBox: function () {
    var bbox = this.model.getBBox();
    var data = this.model.get('data');
    var state = this.model.get('state');

    var pendingTasks = [];
    var editorUpdated = false;

    if (this.editor) {
      if (this.prevZoom !== state.zoom) {
        this.prevZoom = state.zoom;
        editorUpdated = true;

        pendingTasks.push(
          {
            e: this.editorSelector[0],
            property: 'top',
            value: 24 * state.zoom + 'px',
          },
          {
            e: this.editorSelector[0],
            property: 'margin',
            value: 7 * state.zoom + 'px',
          },
          {
            e: this.editorSelector[0],
            property: 'border-radius',
            value: 5 * state.zoom + 'px',
          },
          {
            e: this.editorSelector[0],
            property: 'border-width',
            value: state.zoom + 0.5 + 'px',
          }
        );

        var textLayers = this.$box[0].querySelectorAll('.ace_text-layer');
        for (var i = 0; i < textLayers.length; i++) {
          pendingTasks.push({
            e: textLayers[i],
            property: 'padding',
            value: '0px ' + Math.round(4 * state.zoom) + 'px',
          });
        }
      }

      if (editorUpdated) {
        this.editor.setFontSize(Math.round(aceFontSize * state.zoom));
        this.editor.renderer.$cursorLayer.$padding = Math.round(4 * state.zoom);
      }

      this.editor.resize();
    }

    /*var wireWidth = WIRE_WIDTH * state.zoom;
    var wires = this.$el[0].getElementsByClassName('port-wire');
    for (var j = 0; j < wires.length; j++) {
      pendingTasks.push({
        e: wires[j],
        property: 'stroke-width',
        value: wireWidth + 'px',
      });
    }
*/
    var topOffset = data.name || data.local ? 0 : 24;
    pendingTasks.push(
      {
        e: this.contentSelector[0],
        property: 'left',
        value: Math.round((bbox.width / 2.0) * (state.zoom - 1)) + 'px',
      },
      {
        e: this.contentSelector[0],
        property: 'top',
        value:
          Math.round(
            ((bbox.height + topOffset) / 2.0) * (state.zoom - 1) + topOffset
          ) + 'px',
      },
      {
        e: this.contentSelector[0],
        property: 'width',
        value: Math.round(bbox.width) + 'px',
      },
      {
        e: this.contentSelector[0],
        property: 'height',
        value: Math.round(bbox.height - topOffset) + 'px',
      },
      {
        e: this.contentSelector[0],
        property: 'transform',
        value: 'scale(' + state.zoom + ')',
      }
    );

    if (data.name || data.local) {
      this.headerSelector.removeClass('hidden');
    } else {
      this.headerSelector.addClass('hidden');
    }

    pendingTasks.push(
      {
        e: this.$box[0],
        property: 'left',
        value: bbox.x * state.zoom + state.pan.x + 'px',
      },
      {
        e: this.$box[0],
        property: 'top',
        value: bbox.y * state.zoom + state.pan.y + 'px',
      },
      {
        e: this.$box[0],
        property: 'width',
        value: bbox.width * state.zoom + 'px',
      },
      {
        e: this.$box[0],
        property: 'height',
        value: bbox.height * state.zoom + 'px',
      }
    );

    requestAnimationFrame(() => {
      for (let task of pendingTasks) {
        if (task.e) {
          task.e.style[task.property] = task.value;
        }
      }
    });
  },
});

/* jshint ignore: end */
