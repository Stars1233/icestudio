//---------------------------------------------------------------------------
//-- Output console
//--
//-- Bottom-docked, terminal-style panel that shows the real-time output of the
//-- toolchain commands (Verify / Build / Upload). It replaces the old
//-- "Command output" window. The panel is cleared at the start of every
//-- command, streams output live while open, and auto-opens when a command
//-- fails. A small, extensible engine scans the output for known patterns and
//-- appends a hint (optionally with a link, e.g. to open Preferences).
//---------------------------------------------------------------------------
'use strict';

angular.module('icestudio').service('outputConsole', function (gettextCatalog) {
  var self = this;

  //-- Pending partial line, kept between streamed chunks so highlighting is
  //-- done line by line.
  var lineBuffer = '';

  //-- Whole text of the current command (used by the hint engine at the end).
  var commandText = '';

  var wired = false;

  //-----------------------------------------------------------------------
  //-- Hint engine: patterns to look for in the output + the note to append.
  //-- `action` (optional) renders a link that publishes a bus event so the
  //-- main app can react (e.g. open the Preferences panel on the right tab).
  //-----------------------------------------------------------------------
  //-- Read a Verify preference flag from the profile (false on any error).
  function verifyPref(name) {
    try {
      var profile = angular.element(document.body).injector().get('profile');
      var verify = (profile.get('toolPreferences') || {}).verify || {};
      return !!verify[name];
    } catch (e) {
      return false;
    }
  }

  function hints() {
    return [
      {
        //-- Match the actual Verilator REALCVT warning/error, NOT the
        //-- "-Wno-REALCVT" flag echoed in the command line (which is always
        //-- present once the option is enabled, causing a false positive).
        test: /%(Warning|Error)-REALCVT|Implicit conversion of real to integer/i,
        //-- Only suggest enabling the option when it is NOT already enabled:
        //-- if it is on, the warning is already silenced and the hint is moot.
        when: function () {
          return !verifyPref('relaxRealToInt');
        },
        message: gettextCatalog.getString(
          'This warning disappears if you enable "Relax the real-to-integer conversion check" under Tools → Preferences → Verify.'
        ),
        linkText: gettextCatalog.getString('Open Preferences'),
        event: 'preferences.open',
        payload: { tab: 'verify' },
      },
      {
        //-- ASSIGNIN (a module input wired to the SB_IO inout PACKAGE_PIN) and
        //-- COMBDLY (the vendor SB_IO model) are tripped by the FPGA I/O
        //-- primitives. Match the real Verilator messages, not the echoed flag.
        test: /%(Warning|Error)-(ASSIGNIN|COMBDLY)|Assigning to input\/const variable/i,
        //-- Only hint when the relaxation is not already enabled.
        when: function () {
          return !verifyPref('relaxIoPrimitives');
        },
        message: gettextCatalog.getString(
          'This error comes from the FPGA I/O primitives. It disappears if you enable "Relax the FPGA I/O primitive checks" under Tools → Preferences → Verify.'
        ),
        linkText: gettextCatalog.getString('Open Preferences'),
        event: 'preferences.open',
        payload: { tab: 'verify' },
      },
    ];
  }

  function el(id) {
    return document.getElementById(id);
  }

  function panel() {
    return el('output-console');
  }

  function bodyEl() {
    return el('output-console-body');
  }

  //-- Bind the header buttons the first time the panel is available.
  function wire() {
    if (wired) {
      return;
    }
    var max = el('output-console-maximize');
    var clear = el('output-console-clear');
    var close = el('output-console-close');
    if (!max || !clear || !close) {
      return;
    }
    max.addEventListener('click', function () {
      var p = panel();
      if (!p) {
        return;
      }
      var maximized = p.classList.toggle('maximized');
      max.innerHTML = maximized ? '&#x25BC;' : '&#x25B2;';
      max.setAttribute(
        'title',
        maximized
          ? gettextCatalog.getString('Restore')
          : gettextCatalog.getString('Maximize')
      );
      scrollToBottom();
    });
    clear.addEventListener('click', function () {
      self.clear();
    });
    close.addEventListener('click', function () {
      self.close();
    });
    wired = true;
  }

  function scrollToBottom() {
    var b = bodyEl();
    if (b) {
      b.scrollTop = b.scrollHeight;
    }
  }

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  //-- Remove ANSI escape sequences (apio usually emits none when piped, but
  //-- strip them just in case so they don't show as garbage).
  function stripAnsi(text) {
    /* eslint-disable no-control-regex */
    return text.replace(/\[[0-9;]*m/g, '');
    /* eslint-enable no-control-regex */
  }

  //-- Wrap a whole line in a terminal-like color class based on its content.
  function colorize(rawLine) {
    var line = escapeHtml(stripAnsi(rawLine));
    var cls = null;
    if (/\[ERROR\]|%Error|scons:.*Error|: error:|^Error\b/i.test(rawLine)) {
      cls = 'oc-red oc-bold';
    } else if (/\[SUCCESS\]/i.test(rawLine)) {
      cls = 'oc-green oc-bold';
    } else if (/%Warning|: warning:|\bwarning\b/i.test(rawLine)) {
      cls = 'oc-yellow';
    }
    return cls ? '<span class="' + cls + '">' + line + '</span>' : line;
  }

  function appendHtml(html) {
    var b = bodyEl();
    if (!b) {
      return;
    }
    b.insertAdjacentHTML('beforeend', html);
    scrollToBottom();
  }

  //-----------------------------------------------------------------------
  //-- Public API
  //-----------------------------------------------------------------------

  this.isOpen = function () {
    var p = panel();
    return !!p && !p.classList.contains('hidden');
  };

  //-- Reflect the last command result on the toolbox console button icon:
  //-- 'error' (red), 'success' (green) or 'idle' (shell). Clicking the button
  //-- (toggle) clears it back to 'idle'. The auto-open on error does not.
  function setConsoleIcon(state) {
    var i = el('shortcut-console-icon');
    if (!i) {
      return;
    }
    var cls = 'icon--console';
    if (state === 'error') {
      cls = 'icon--console--error';
    } else if (state === 'success') {
      cls = 'icon--console--success';
    }
    i.className = cls;
  }

  //-- Anchor the console just above the footer and, when visible, the FPGA
  //-- resources bar, so none of them overlap.
  this.refreshOffset = function () {
    var p = panel();
    if (!p) {
      return;
    }
    var footer =
      document.querySelector('.footer.ice-bar') ||
      document.querySelector('.footer');
    var fH = footer ? footer.offsetHeight : 47;
    //-- The bar is position:fixed (offsetParent is null even when visible), so
    //-- detect its visibility via the ng-hide class that ng-show toggles.
    var bar = el('fpga-resources-bar');
    var barVisible = bar && !bar.classList.contains('ng-hide');
    var barH = barVisible ? bar.offsetHeight : 0;
    p.style.bottom = fH + barH + 'px';
  };

  this.open = function () {
    var p = panel();
    if (p) {
      wire();
      p.classList.remove('hidden');
      this.refreshOffset();
      scrollToBottom();
    }
  };

  this.close = function () {
    var p = panel();
    if (p) {
      p.classList.add('hidden');
    }
  };

  this.toggle = function () {
    //-- User interaction with the button acknowledges the result → shell icon.
    setConsoleIcon('idle');
    if (this.isOpen()) {
      this.close();
    } else {
      this.open();
    }
  };

  this.clear = function () {
    var b = bodyEl();
    if (b) {
      b.innerHTML = '';
    }
    lineBuffer = '';
    commandText = '';
  };

  //-- Begin a new command: clear the console and echo the command line.
  this.startCommand = function (commandLine) {
    this.clear();
    if (commandLine) {
      commandText += commandLine + '\n';
      appendHtml(
        '<span class="oc-gray">$ ' +
          escapeHtml(stripAnsi(commandLine)) +
          '</span>\n\n'
      );
    }
  };

  //-- Stream a chunk of output. Highlight complete lines; keep the partial
  //-- trailing line buffered until the next chunk.
  this.write = function (text) {
    if (!text) {
      return;
    }
    commandText += text;
    lineBuffer += text;
    var lines = lineBuffer.split('\n');
    lineBuffer = lines.pop();
    if (lines.length) {
      var html = lines
        .map(function (l) {
          return colorize(l);
        })
        .join('\n');
      appendHtml(html + '\n');
    }
  };

  //-- End the current command: flush the buffer, run the hint engine, and
  //-- open the panel if the command failed and it was closed.
  this.endCommand = function (failed) {
    if (lineBuffer.length) {
      appendHtml(colorize(lineBuffer) + '\n');
      lineBuffer = '';
    }
    appendHints();
    //-- Badge the toolbox console button with the result (red/green). It stays
    //-- until the user clicks the button (toggle clears it).
    setConsoleIcon(failed ? 'error' : 'success');
    if (failed && !this.isOpen()) {
      var b = bodyEl();
      if (b && b.textContent.trim()) {
        this.open();
      }
    }
  };

  function appendHints() {
    hints().forEach(function (hint) {
      if (!hint.test.test(commandText)) {
        return;
      }
      //-- Optional guard: skip the hint when it would not help (e.g. the
      //-- suggested option is already enabled).
      if (typeof hint.when === 'function' && !hint.when()) {
        return;
      }
      var link = '';
      if (hint.event) {
        link =
          ' <a data-oc-event="' +
          hint.event +
          '" data-oc-payload="' +
          escapeHtml(JSON.stringify(hint.payload || {})) +
          '">' +
          escapeHtml(hint.linkText || '') +
          '</a>';
      }
      appendHtml(
        '<span class="oc-hint">→ ' + escapeHtml(hint.message) + link + '</span>'
      );
    });
    bindHintLinks();
  }

  //-- Wire hint links to publish their bus event (e.g. open Preferences).
  function bindHintLinks() {
    var b = bodyEl();
    if (!b) {
      return;
    }
    var links = b.querySelectorAll('a[data-oc-event]:not([data-oc-bound])');
    Array.prototype.forEach.call(links, function (a) {
      a.setAttribute('data-oc-bound', '1');
      a.addEventListener('click', function (e) {
        e.preventDefault();
        var name = a.getAttribute('data-oc-event');
        var payload = {};
        try {
          payload = JSON.parse(a.getAttribute('data-oc-payload') || '{}');
        } catch (err) {
          payload = {};
        }
        if (
          typeof iceStudio !== 'undefined' &&
          iceStudio.bus &&
          iceStudio.bus.events
        ) {
          iceStudio.bus.events.publish(name, payload);
        }
      });
    });
  }
});
