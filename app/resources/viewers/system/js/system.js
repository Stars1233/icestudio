//----------------------------------------------------------------------------
//-- System information viewer.
//--
//-- Reads the paths/version passed on the URL by menu.js (showSystemInfo),
//-- anonymizes user-specific home paths (so a shared report never leaks the
//-- username), renders a readable monospaced report and offers a floating
//-- "copy" button that puts the same anonymized text on the clipboard.
//----------------------------------------------------------------------------
(function () {
  'use strict';

  function getURLParameter(name) {
    return (
      decodeURIComponent(
        (new RegExp('[?|&]' + name + '=([^&;]+?)(&|#|;|$)').exec(
          location.search
        ) || [null, ''])[1].replace(/\+/g, '%20')
      ) || ''
    );
  }

  //-- The launcher appends a trailing "---" marker to each value: strip it.
  function clean(v) {
    return String(v || '')
      .replace(/-{3,}\s*$/, '')
      .trim();
  }

  //-- Replace user-specific home paths with <user>. Covers Linux (/home/x),
  //-- macOS (/Users/x) and Windows (C:\Users\x), plus this machine's actual
  //-- home dir (most reliable, masks non-standard home locations too).
  function anonymize(s) {
    if (!s) {
      return s;
    }
    var out = String(s);
    try {
      var home = require('os').homedir();
      if (home) {
        var masked = home.replace(/[^/\\]+$/, '<user>');
        out = out.split(home).join(masked);
      }
    } catch (e) {
      /* no node access: rely on the generic patterns below */
    }
    return out
      .replace(/(\/home\/)[^/\\]+/g, '$1<user>')
      .replace(/(\/Users\/)[^/\\]+/g, '$1<user>')
      .replace(/([A-Za-z]:[\\/]+Users[\\/]+)[^\\/]+/g, '$1<user>')
      .replace(/(\\Users\\)[^\\/]+/g, '$1<user>');
  }

  function val(name) {
    return anonymize(clean(getURLParameter(name)));
  }

  function procVersion(key) {
    try {
      return (
        (typeof process !== 'undefined' &&
          process.versions &&
          process.versions[key]) ||
        ''
      );
    } catch (e) {
      return '';
    }
  }

  function username() {
    try {
      var u = require('os').userInfo().username;
      if (u) {
        return u;
      }
    } catch (e) {
      /* ignore */
    }
    try {
      var h = require('os').homedir();
      if (h) {
        return h
          .replace(/[\\/]+$/, '')
          .split(/[\\/]/)
          .pop();
      }
    } catch (e) {
      /* ignore */
    }
    return '';
  }

  //-- Quick diagnostics that often explain toolchain/build issues in reports
  //-- (spaces or non-ASCII chars in the user name or paths break some tools).
  //-- Computed from the RAW values so they stay accurate; only booleans are
  //-- shown, so nothing sensitive leaks. Row = [label, text, 'ok'|'warn'].
  function buildChecks(rawValues, apioCmd) {
    var user = username();
    var paths = rawValues.filter(Boolean);
    var hasUserSpaces = /\s/.test(user);
    var hasPathSpaces = paths.some(function (p) {
      return /\s/.test(p);
    });
    var hasNonAscii =
      /[^\x20-\x7e]/.test(user) ||
      paths.some(function (p) {
        return /[^\x20-\x7e]/.test(p);
      });
    var apioOk = !!(apioCmd && apioCmd.length);
    return [
      [
        'Username has spaces',
        hasUserSpaces ? 'Yes' : 'No',
        hasUserSpaces ? 'warn' : 'ok',
      ],
      [
        'Paths have spaces',
        hasPathSpaces ? 'Yes' : 'No',
        hasPathSpaces ? 'warn' : 'ok',
      ],
      [
        'Non-ASCII in user/paths',
        hasNonAscii ? 'Yes' : 'No',
        hasNonAscii ? 'warn' : 'ok',
      ],
      ['Apio command set', apioOk ? 'Yes' : 'No', apioOk ? 'ok' : 'warn'],
    ];
  }

  function buildSections() {
    var platform = '';
    var arch = '';
    try {
      platform = process.platform;
      arch = process.arch;
    } catch (e) {
      /* ignore */
    }

    var pathFields = [
      ['BASE_DIR', 'base_dir'],
      ['ICESTUDIO_DIR', 'icestudio_dir'],
      ['PROFILE_PATH', 'profile_path'],
      ['APIO_HOME_DIR', 'apio_home_dir'],
      ['APIO_BUNDLE_DIR', 'apio_bundle_dir'],
      ['APIO_CMD', 'apio_cmd'],
      ['APP', 'app'],
      ['APP_DIR', 'app_dir'],
    ];
    var rawValues = pathFields.map(function (f) {
      return clean(getURLParameter(f[1]));
    });
    var pathRows = pathFields.map(function (f) {
      return [f[0], val(f[1])];
    });

    return [
      {
        title: 'Icestudio',
        rows: [['Version', clean(getURLParameter('version'))]],
      },
      {
        title: 'System',
        rows: [
          ['Platform', platform],
          ['Architecture', arch],
          ['Node', procVersion('node')],
          ['Chromium', procVersion('chromium')],
          ['NW.js', procVersion('nw')],
        ],
      },
      { title: 'Paths', rows: pathRows },
      {
        title: 'Checks',
        rows: buildChecks(rawValues, clean(getURLParameter('apio_cmd'))),
      },
    ];
  }

  function esc(s) {
    return String(s || '').replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }

  function renderReport(sections) {
    var root = document.getElementById('si-report');
    if (!root) {
      return;
    }
    var html = '';
    sections.forEach(function (sec) {
      html +=
        '<section class="si-group"><h2 class="si-group-title">' +
        esc(sec.title) +
        '</h2>';
      sec.rows.forEach(function (r) {
        var v = r[1] && String(r[1]).length ? r[1] : '—';
        var valHtml = esc(v);
        if (r[2]) {
          valHtml =
            '<span class="si-status si-' +
            r[2] +
            '">' +
            (r[2] === 'warn' ? '⚠ ' : '✓ ') +
            esc(v) +
            '</span>';
        }
        html +=
          '<div class="si-row"><span class="si-key">' +
          esc(r[0]) +
          '</span><span class="si-val">' +
          valHtml +
          '</span></div>';
      });
      html += '</section>';
    });
    root.innerHTML = html;
  }

  function reportText(sections) {
    var lines = [];
    sections.forEach(function (sec) {
      lines.push('[' + sec.title + ']');
      sec.rows.forEach(function (r) {
        var v = r[1] && String(r[1]).length ? r[1] : '-';
        lines.push('  ' + r[0] + ': ' + v);
      });
      lines.push('');
    });
    return lines.join('\n').replace(/\n+$/, '') + '\n';
  }

  function copyText(text) {
    //-- Prefer the nwjs clipboard; fall back to a hidden textarea.
    try {
      if (typeof nw !== 'undefined' && nw.Clipboard) {
        nw.Clipboard.get().set(text, 'text');
        return true;
      }
    } catch (e) {
      /* fall through */
    }
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) {
      return false;
    }
  }

  function wireCopy(sections) {
    var btn = document.getElementById('si-copy');
    var label = document.getElementById('si-copy-label');
    if (!btn) {
      return;
    }
    btn.addEventListener('click', function () {
      var ok = copyText(reportText(sections));
      if (label) {
        var prev = label.getAttribute('data-default') || label.textContent;
        label.setAttribute('data-default', prev);
        label.textContent = ok ? 'Copied!' : 'Error';
        btn.classList.add('copied');
        setTimeout(function () {
          label.textContent = prev;
          btn.classList.remove('copied');
        }, 1400);
      }
    });
  }

  window.onload = function () {
    var sections = buildSections();
    renderReport(sections);
    wireCopy(sections);
  };
})();
