//-- jshint rules
/* global sha1, aceFontSize, openurl,marked */

'use strict';

// Info block

joint.shapes.ice.Info = joint.shapes.ice.Model.extend({
  defaults: joint.util.deepSupplement(
    {
      type: 'ice.Info',
      z: 12,
      size: {
        width: 400,
        height: 256,
      },
    },
    joint.shapes.ice.Model.prototype.defaults
  ),
});

joint.shapes.ice.InfoView = joint.shapes.ice.ModelView.extend({
  initialize: function () {
    _.bindAll(this, 'updateBox');
    joint.dia.ElementView.prototype.initialize.apply(this, arguments);

    var id = sha1(this.model.get('id')).toString().substring(0, 6);
    var editorLabel = 'editor' + id;
    var readonly = this.model.get('data').readonly;

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
      <div class="info-block">\
        <div class="info-render markdown-body' +
          (readonly ? '' : ' hidden') +
          '"></div>\
        <div class="info-content' +
          (readonly ? ' hidden' : '') +
          '"></div>\
        <div class="info-editor' +
          (readonly ? ' hidden' : '') +
          '" id="' +
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
          '.setShowPrintMargin(false);\
          ' +
          editorLabel +
          '.setAutoScrollEditorIntoView(true);\
          ' +
          editorLabel +
          '.renderer.setShowGutter(false);\
          ' +
          editorLabel +
          '.renderer.$cursorLayer.element.style.opacity = 0;\
          ' +
          editorLabel +
          '.session.setMode("ace/mode/markdown");\
        </script>\
        <div class="resizer"/></div>\
      </div>\
      '
      )()
    );

    this.renderSelector = this.$box.find('.info-render');
    this.editorSelector = this.$box.find('.info-editor');
    this.contentSelector = this.$box.find('.info-content');

    this.model.on('change', this.updateBox, this);
    this.model.on('remove', this.removeBox, this);

    // Prevent paper from handling pointerdown.
    this.editorSelector.on('mousedown click', function (event) {
      event.stopPropagation();
    });

    this.updateBox();

    this.updating = false;
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
          // Set data.code
          self.model.attributes.data.info = self.editor.session.getValue();
        }, undoGroupingInterval);
        // Reset counter
        self.counter = Date.now();
      }
    });
    this.editor.on('focus', function () {
      self.updateScrollStatus(true);
      $(document).trigger('disableSelected');
      self.editor.setHighlightActiveLine(true);
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
      this.editor.session.setValue(data.info);
    } else {
      // Set data.info
      this.model.attributes.data.info = this.editor.session.getValue();
    }
    setTimeout(
      function (self) {
        self.updating = false;
      },
      10,
      this
    );
  },

  applyReadonly: function () {
    var readonly = this.model.get('data').readonly;
    if (readonly) {
      this.$box.addClass('info-block-readonly');
      this.renderSelector.removeClass('hidden');
      this.editorSelector.addClass('hidden');
      this.contentSelector.addClass('hidden');
      this.disableResizer();
      // Clear selection
      var selection = this.editor.session.selection;
      if (selection) {
        selection.clearSelection();
      }
      this.applyText();
    } else {
      this.$box.removeClass('info-block-readonly');
      this.renderSelector.addClass('hidden');
      this.editorSelector.removeClass('hidden');
      this.contentSelector.removeClass('hidden');
      this.enableResizer();
    }
  },

  applyText: function () {
    var data = this.model.get('data');
    var markdown = data.text || data.info || '';

    // Replace emojis
    /*markdown = markdown.replace(/(:.*:)/g, function (match) {
      return emoji.emojify(match, null, function (code, name) {
        var source =
          "https://github.global.ssl.fastly.net/images/icons/emoji/" +
          name +
          ".png";
        return (
          ' <object data="' +
          source +
          '" type="image/png" width="20" height="20">' +
          code +
          "</object>"
        );
      });
    });*/

    // Apply Marked to convert from Markdown to HTML
    this.renderSelector.html(marked(markdown));

    // Render task list
    this.renderSelector.find('li').each(function (index, element) {
      replaceCheckboxItem(element);
    });

    function replaceCheckboxItem(element) {
      listIterator(element);
      var child = $(element).children().first()[0];
      if (child && child.localName === 'p') {
        listIterator(child);
      }
    }

    function listIterator(element) {
      var $el = $(element);
      var label = $el.clone().children().remove('il, ul').end().html();
      var detached = $el.children('il, ul');

      if (/^\[\s\]/.test(label)) {
        $el.html(renderItemCheckbox(label, '')).append(detached);
      } else if (/^\[x\]/.test(label)) {
        $el.html(renderItemCheckbox(label, 'checked')).append(detached);
      }
    }

    function renderItemCheckbox(label, checked) {
      label = label.substring(3);
      return '<input type="checkbox" ' + checked + '/>' + label;
    }

    this.renderSelector.find('a').each(function (index, element) {
      element.onclick = function (event) {
        event.preventDefault();
        openurl.open(element.href);
      };
    });
  },

  apply: function (opt) {
    this.applyValue(opt);
    this.applyReadonly();
    this.updateBox(true);
    if (this.editor) {
      this.editor.resize();
    }
  },

  render: function () {
    joint.dia.ElementView.prototype.render.apply(this, arguments);
    this.paper.$el.append(this.$box);
    this.updateBox(true);
    return this;
  },

  update: function () {
    this.editor.setReadOnly(this.model.get('disabled'));
    joint.dia.ElementView.prototype.update.apply(this, arguments);
  },

  updateBox: function () {
    var bbox = this.model.getBBox();
    var state = this.model.get('state');
    var data = this.model.get('data');

    let temporalBypass = true;
    if (!temporalBypass) {
      return;
    }

    var pendingTasks = [];

    if (data.readonly) {
      pendingTasks.push(
        {
          e: this.renderSelector[0],
          property: 'left',
          value: Math.round((bbox.width / 2.0) * (state.zoom - 1)) + 'px',
        },
        {
          e: this.renderSelector[0],
          property: 'top',
          value: Math.round((bbox.height / 2.0) * (state.zoom - 1)) + 'px',
        },
        {
          e: this.renderSelector[0],
          property: 'width',
          value: Math.round(bbox.width) + 'px',
        },
        {
          e: this.renderSelector[0],
          property: 'height',
          value: Math.round(bbox.height) + 'px',
        },
        {
          e: this.renderSelector[0],
          property: 'transform',
          value: 'scale(' + state.zoom + ')',
        },
        {
          e: this.renderSelector[0],
          property: 'font-size',
          value: aceFontSize + 'px',
        }
      );
    } else if (this.editor) {
      pendingTasks.push(
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

      this.editor.setFontSize(Math.round(aceFontSize * state.zoom));
      this.editor.renderer.$cursorLayer.$padding = Math.round(4 * state.zoom);
      this.editor.resize();
    }

    pendingTasks.push(
      {
        e: this.contentSelector[0],
        property: 'left',
        value: Math.round((bbox.width / 2.0) * (state.zoom - 1)) + 'px',
      },
      {
        e: this.contentSelector[0],
        property: 'top',
        value: Math.round((bbox.height / 2.0) * (state.zoom - 1)) + 'px',
      },
      {
        e: this.contentSelector[0],
        property: 'width',
        value: Math.round(bbox.width) + 'px',
      },
      {
        e: this.contentSelector[0],
        property: 'height',
        value: Math.round(bbox.height) + 'px',
      },
      {
        e: this.contentSelector[0],
        property: 'transform',
        value: 'scale(' + state.zoom + ')',
      }
    );

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

  removeBox: function (/*event*/) {
    delete this.model.attributes.data.delta;
    this.$box.remove();
  },
});
