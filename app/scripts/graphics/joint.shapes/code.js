// jshint ignore:start

/* --global sha1, WIRE_WIDTH, aceFontSize */

'use strict';

// Code block

joint.shapes.ice.Code = joint.shapes.ice.Model.extend({
  defaults: joint.util.deepSupplement(
    {
      type: 'ice.Code',
      z: 10,
      size: {
        width: 384,
        height: 256,
      },
    },
    joint.shapes.ice.Model.prototype.defaults
  ),
});

joint.shapes.ice.CodeView = joint.shapes.ice.ModelView.extend({
  initialize: function () {
    _.bindAll(this, 'updateBox');
    joint.dia.ElementView.prototype.initialize.apply(this, arguments);

    let modelId = this.model.get('id');
    var id = sha1(modelId).toString().substring(0, 6);
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
        `
      <div class="code-block">
        <div class="js-codeblock-io-edit" data-blkId="${modelId}"><i class="fas fa-edit"></i></div>
        <div class="code-content"></div>
        <div class="code-editor" id="${editorLabel}"></div>
        <script>
          var ${editorLabel} = ace.edit("${editorLabel}");

          ${editorLabel}.setTheme("ace/theme/${editorTheme}");
          ${editorLabel}.setHighlightActiveLine(false);
          ${editorLabel}.setHighlightGutterLine(false);
          ${editorLabel}.setAutoScrollEditorIntoView(true);
          ${editorLabel}.renderer.setShowGutter(true);
          ${editorLabel}.renderer.$cursorLayer.element.style.opacity = 0;
         ${editorLabel}.session.setMode("ace/mode/verilog");
        </script>
        <div class="resizer"/></div>
      </div>
      `
      )()
    );

    this.editorSelector = this.$box.find('.code-editor');
    this.contentSelector = this.$box.find('.code-content');
    this.nativeDom = {
      box: this.$box[0],
      editorSelector: this.$box[0].querySelectorAll('.code-editor'),
      contentSelector: this.$box[0].querySelectorAll('.code-content'),
    };

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
    //  this.editor.commands.removeCommand('undo');
    //  this.editor.commands.removeCommand('redo');
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
          // Set data.code
          self.model.attributes.data.code = self.editor.session.getValue();
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

  applyValue: function (opt) {
    this.updating = true;

    var data = this.model.get('data');

    opt = opt || {};

    if (opt.ini) {
      this.editor.session.setValue(data.code);
    } else {
      // Set data.code
      this.model.attributes.data.code = this.editor.session.getValue();
    }
    setTimeout(
      function (self) {
        self.updating = false;
      },
      10,
      this
    );
  },

  apply: function (opt) {
    this.applyValue(opt);
    if (this.editor) {
      this.editor.resize();
    }
  },

  setAnnotation: function (codeError) {
    this.editor.gotoLine(codeError.line);
    var annotations = this.editor.session.getAnnotations();
    annotations.push({
      row: codeError.line - 1,
      column: 0,
      text: codeError.msg,
      type: codeError.type,
    });
    this.editor.session.setAnnotations(annotations);

    var self = this;
    var state = this.model.get('state');
    var annotationSize = Math.round(15 * state.zoom) + 'px';
    setTimeout(function () {
      self.$box
        .find('.ace_error')
        .css('background-size', annotationSize + ' ' + annotationSize);
      self.$box
        .find('.ace_warning')
        .css('background-size', annotationSize + ' ' + annotationSize);
      self.$box
        .find('.ace_info')
        .css('background-size', annotationSize + ' ' + annotationSize);
    }, 0);
  },

  clearAnnotations: function () {
    this.editor.session.clearAnnotations();
  },

  update: function () {
    this.renderPorts();
    this.editor.setReadOnly(this.model.get('disabled'));
    joint.dia.ElementView.prototype.update.apply(this, arguments);
  },

  updateBox: function () {
    var pendingTasks = [];
    var bbox = this.model.getBBox();
    var data = this.model.get('data');
    var state = this.model.get('state');
    var rules = this.model.get('rules');
    var leftPorts = this.model.get('leftPorts');
    var rightPorts = this.model.get('rightPorts');
    var modelId = this.model.id;
    var editorUpdated = false;

    if (this.editor && this.prevZoom !== state.zoom) {
      editorUpdated = true;
      this.prevZoom = state.zoom;
      var editorStyles = {
        'margin': 7 * state.zoom + 'px',
        'border-radius': 5 * state.zoom + 'px',
        'border-width': state.zoom + 0.5 + 'px',
      };
      this.applyStyles(this.nativeDom.editorSelector, editorStyles);

      var annotationSize = Math.round(15 * state.zoom) + 'px';
      var annotationTypes = ['.ace_error', '.ace_warning', '.ace_info'];
      annotationTypes.forEach((type) => {
        this.applyStyles(this.$box[0].querySelectorAll(type), {
          'background-size': annotationSize + ' ' + annotationSize,
        });
      });

      this.applyStyles(this.$box[0].querySelectorAll('.ace_text-layer'), {
        padding: '0px ' + Math.round(4 * state.zoom) + 'px',
      });

      var editIcon = this.$box.find('.js-codeblock-io-edit');
      if (editIcon.length) {
        editIcon.css({
          'transform': `scale(${state.zoom})`,
          'transform-origin': 'top right',
          'top': '0px',
          'right': '0px',
        });
      }
    }
    /* Maintain comment, code in testing 
 *
 *
 *
    var wireWidth = WIRE_WIDTH * state.zoom;
    this.applyStyles(this.$el[0].getElementsByClassName('port-wire'), {
      'stroke-width': wireWidth + 'px',
    });

    var busWidth = wireWidth * 3;
    var tokId = 'port-wire-' + modelId + '-';
    [...leftPorts, ...rightPorts].forEach((port) => {
      var dome = document.getElementById(tokId + port.id);
      if (dome) {
        this.applyStyles([dome], { 'stroke-width': busWidth + 'px' });
      }
    });
*/
    if (data?.ports?.in) {
      var portTokId = 'port-default-' + modelId + '-';
      data.ports.in.forEach((port) => {
        var portDefault = document.getElementById(portTokId + port.name);
        if (portDefault) {
          if (rules && port.default?.apply) {
            portDefault.classList.add('port-visible');
          } else {
            portDefault.classList.remove('port-visible');
          }
        }
      });
    }

    var contentTransform = {
      left: Math.round((bbox.width / 2.0) * (state.zoom - 1)) + 'px',
      top: Math.round((bbox.height / 2.0) * (state.zoom - 1)) + 'px',
      width: Math.round(bbox.width) + 'px',
      height: Math.round(bbox.height) + 'px',
      transform: 'scale(' + state.zoom + ')',
    };
    this.applyStyles(this.nativeDom.contentSelector, contentTransform);

    var boxTransform = {
      left: Math.round(bbox.x * state.zoom + state.pan.x) + 'px',
      top: Math.round(bbox.y * state.zoom + state.pan.y) + 'px',
      width: Math.round(bbox.width * state.zoom) + 'px',
      height: Math.round(bbox.height * state.zoom) + 'px',
    };
    this.applyStyles([this.nativeDom.box], boxTransform);

    if (this.editor && editorUpdated) {
      this.editor.setFontSize(Math.round(aceFontSize * state.zoom));
      this.editor.renderer.$cursorLayer.$padding = Math.round(4 * state.zoom);
    }

    this.editor?.resize();
    return pendingTasks;
  },

  /**
   * Temporal method to apply CSS rules in block, been removed in next interaction
   */
  applyStyles: function (elements, styles) {
    if (!elements) {
      return;
    }

    if (!Array.isArray(elements) && !(elements instanceof NodeList)) {
      elements = [elements];
    }

    elements.forEach((element) => {
      if (element && element.style) {
        Object.keys(styles).forEach((prop) => {
          element.style[prop] = styles[prop];
        });
      }
    });
  },
});

// jshint ignore:end
