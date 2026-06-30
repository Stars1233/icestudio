//---------------------------------------------------------------------------
//-- iceTutorial plugin (embedded-windowed)
//--
//-- Movable/resizable window with two tabs:
//--   * Forum : a <webview> pointing to the FPGA-Wars Google Group.
//--   * Vídeos: a searchable grid of videos read from data/catalog.json.
//--             Clicking a thumbnail plays the video fullscreen (within the
//--             plugin window) with a close (X) button.
//--
//-- The plugin runs inside a shadow DOM: `pluginRoot` (the shadow root,
//-- injected by the plugin manager) is used for every element lookup.
//---------------------------------------------------------------------------

/* global pluginRoot, angular, iceStudio */

var iceTutorial = (function () {
  'use strict';

  var FORUM_URL =
    'https://groups.google.com/g/fpga-wars-explorando-el-lado-libre';
  var CATALOG_REL = 'resources/plugins/iceTutorial/data/catalog.json';

  //-- Remote catalog source (GitHub raw). Edit to point at another repo/branch/
  //-- file, or set enabled:false to turn remote updates off. See itRemoteUrl().
  var IT_REMOTE = {
    enabled: true,
    owner: 'FPGAwars',
    repo: 'iceTutorialCatalog',
    branch: 'main',
    catalog: 'catalog.json',
    meta: 'catalog.meta.json',
  };

  var videos = [];
  var references = [];
  //-- When set, the videos grid is showing a playlist's contents (level 2).
  var viewPlaylist = null;

  //-- The plugin script runs in the main window context, so reuse the app's
  //-- gettextCatalog for i18n (auto-follows the UI language). Falls back to the
  //-- identity function if the injector is unavailable.
  var gettextCatalog = (function () {
    try {
      return angular.element(document.body).injector().get('gettextCatalog');
    } catch (e) {
      return null;
    }
  })() || {
    getString: function (s) {
      return s;
    },
  };

  //-- Current UI language (2-letter), to pick the localized title/description.
  var appLang = (function () {
    try {
      var l = angular
        .element(document.body)
        .injector()
        .get('profile')
        .get('language');
      return String(l || 'en').slice(0, 2);
    } catch (e) {
      return 'en';
    }
  })();

  //-- item[field] in the UI language (item.i18n[lang][field]) or the base.
  function localized(item, field) {
    if (item.i18n && item.i18n[appLang] && item.i18n[appLang][field]) {
      return item.i18n[appLang][field];
    }
    return item[field] || '';
  }

  //-- Scoped lookups inside the plugin shadow DOM.
  function q(sel) {
    return pluginRoot.querySelector(sel);
  }
  function qa(sel) {
    return pluginRoot.querySelectorAll(sel);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  //-- Accent/case-insensitive normalization for the search.
  function normalize(s) {
    return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  }

  //-- Open a URL in the user's external browser (nwjs Shell), with fallbacks.
  function openExternal(url) {
    try {
      nw.Shell.openExternal(url);
      return;
    } catch (e1) {
      /* try next */
    }
    try {
      require('nw.gui').Shell.openExternal(url);
      return;
    } catch (e2) {
      /* try next */
    }
    window.open(url, '_blank');
  }

  //-- Open a folder in the OS file manager (cross-platform, via nwjs Shell).
  function openFolder(target) {
    try {
      nw.Shell.showItemInFolder(target);
      return;
    } catch (e1) {
      /* try next */
    }
    try {
      require('nw.gui').Shell.showItemInFolder(target);
      return;
    } catch (e2) {
      /* try next */
    }
    try {
      openExternal('file://' + require('path').dirname(target));
    } catch (e3) {
      /* give up */
    }
  }

  //-----------------------------------------------------------------------
  //-- Bottom status bar (download progress + result).
  //-----------------------------------------------------------------------
  var statusTimer = null;

  function statusHide() {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    var s = q('#it-status');
    if (s) {
      s.classList.add('hidden');
    }
  }

  function statusStart(label) {
    if (statusTimer) {
      clearTimeout(statusTimer);
      statusTimer = null;
    }
    var s = q('#it-status');
    if (!s) {
      return;
    }
    s.classList.remove('hidden');
    var prog = q('#it-status-progress');
    if (prog) {
      prog.classList.add('indeterminate');
    }
    var fill = q('#it-status-progress-fill');
    if (fill) {
      fill.style.width = '';
    }
    var t = q('#it-status-text');
    if (t) {
      t.textContent = label;
    }
    var a = q('#it-status-action');
    if (a) {
      a.classList.add('hidden');
    }
    var c = q('#it-status-close');
    if (c) {
      c.classList.add('hidden');
    }
  }

  function statusProgress(received, total) {
    if (!total || total <= 0) {
      return;
    }
    var prog = q('#it-status-progress');
    if (prog) {
      prog.classList.remove('indeterminate');
    }
    var fill = q('#it-status-progress-fill');
    if (fill) {
      fill.style.width = Math.min(100, (received / total) * 100) + '%';
    }
  }

  function statusDone(text, actionLabel, actionFn) {
    var prog = q('#it-status-progress');
    if (prog) {
      prog.classList.remove('indeterminate');
    }
    var fill = q('#it-status-progress-fill');
    if (fill) {
      fill.style.width = '100%';
    }
    var t = q('#it-status-text');
    if (t) {
      t.textContent = text;
    }
    var a = q('#it-status-action');
    if (a) {
      a.textContent = actionLabel;
      a.classList.remove('hidden');
      a.onclick = function (e) {
        e.preventDefault();
        actionFn();
      };
    }
    var c = q('#it-status-close');
    if (c) {
      c.classList.remove('hidden');
    }
    statusTimer = setTimeout(statusHide, 12000);
  }

  //-- Download a file in-app (no external browser): fetch it with node and save
  //-- it to the OS "Downloads" folder, showing progress in the status bar and
  //-- an "open folder" link when done. Falls back to the system browser on any
  //-- error (e.g. an attachment that needs the Google session).
  function downloadInApp(url, cookie) {
    function fallbackBrowser() {
      statusHide();
      openExternal(url);
    }
    statusStart(gettextCatalog.getString('Downloading…'));
    try {
      var nodeUrl = require('url');
      var fs = require('fs');
      var path = require('path');
      var os = require('os');
      var dir = path.join(os.homedir(), 'Downloads');

      var get = function (target, redirects) {
        var u = new nodeUrl.URL(target);
        var mod = u.protocol === 'https:' ? require('https') : require('http');
        //-- Carry the forum webview's session so session-bound attachments
        //-- (Google Groups uses a ?vt= token tied to your cookies) work.
        var headers = { 'User-Agent': 'Mozilla/5.0' };
        if (cookie) {
          headers.Cookie = cookie;
        }
        var req = mod.get(target, { headers: headers }, function (res) {
          if (
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location &&
            redirects < 6
          ) {
            res.resume();
            get(
              new nodeUrl.URL(res.headers.location, target).href,
              redirects + 1
            );
            return;
          }
          if (res.statusCode !== 200) {
            //-- e.g. login required: let the browser (with the session) do it.
            console.warn('iceTutorial: download HTTP ' + res.statusCode);
            res.resume();
            fallbackBrowser();
            return;
          }
          var cd = res.headers['content-disposition'] || '';
          var m = cd.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i);
          var name = m
            ? decodeURIComponent(m[1].replace(/['"]/g, ''))
            : path.basename(u.pathname) || 'download';
          var dest = path.join(dir, name);
          var total = parseInt(res.headers['content-length'], 10) || 0;
          var received = 0;
          res.on('data', function (chunk) {
            received += chunk.length;
            statusProgress(received, total);
          });
          var file = fs.createWriteStream(dest);
          res.pipe(file);
          file.on('finish', function () {
            file.close();
            statusDone(
              gettextCatalog.getString('Downloaded') + ': ' + name,
              gettextCatalog.getString('Open folder'),
              function () {
                openFolder(dest);
              }
            );
          });
          file.on('error', fallbackBrowser);
        });
        req.on('error', function (err) {
          console.warn('iceTutorial: download error', err && err.message);
          fallbackBrowser();
        });
        //-- Don't hang forever on the "Downloading…" state.
        req.setTimeout(20000, function () {
          req.destroy(new Error('timeout'));
        });
      };
      get(url, 0);
    } catch (e) {
      fallbackBrowser();
    }
  }

  //-----------------------------------------------------------------------
  //-- Tabs
  //-----------------------------------------------------------------------
  function initTabs() {
    var tabs = qa('.it-tab');
    Array.prototype.forEach.call(tabs, function (btn) {
      btn.addEventListener('click', function () {
        var name = btn.getAttribute('data-tab');
        Array.prototype.forEach.call(tabs, function (b) {
          b.classList.toggle('is-active', b === btn);
        });
        Array.prototype.forEach.call(qa('.it-panel'), function (p) {
          p.classList.toggle(
            'is-active',
            p.getAttribute('data-panel') === name
          );
        });
      });
    });
  }

  //-----------------------------------------------------------------------
  //-- Forum
  //-----------------------------------------------------------------------
  function initForum() {
    var frame = q('#it-forum-frame');
    if (frame) {
      //-- Attachments / file downloads: the webview can't download them, so we
      //-- fetch them ourselves and cancel the in-webview navigation. We capture
      //-- each request's Cookie so the download carries the forum session
      //-- (Google Groups attachments use a ?vt= token tied to your cookies).
      var reqCookies = {};
      try {
        frame.request.onBeforeSendHeaders.addListener(
          function (details) {
            var ck = '';
            (details.requestHeaders || []).forEach(function (h) {
              if (h.name.toLowerCase() === 'cookie') {
                ck = h.value || '';
              }
            });
            if (ck) {
              reqCookies[details.requestId] = ck;
            }
          },
          { urls: ['*://*/*'] },
          ['requestHeaders', 'extraHeaders']
        );
      } catch (eCookies) {
        //-- Cookie capture unavailable: session-bound downloads fall back to
        //-- the system browser.
      }
      try {
        frame.request.onHeadersReceived.addListener(
          function (details) {
            var cookie = reqCookies[details.requestId];
            delete reqCookies[details.requestId];
            var cd = '';
            (details.responseHeaders || []).forEach(function (h) {
              if (h.name.toLowerCase() === 'content-disposition') {
                cd = h.value || '';
              }
            });
            //-- Only top-level navigations are real downloads. Google Groups'
            //-- internal XHR (batchexecute) also carry an "attachment"
            //-- disposition (anti-XSSI); those must NOT be intercepted.
            if (details.type === 'main_frame' && /attachment/i.test(cd)) {
              downloadInApp(details.url, cookie);
              return { cancel: true };
            }
          },
          { urls: ['*://*/*'] },
          ['blocking', 'responseHeaders']
        );
      } catch (e) {
        console.warn('iceTutorial: forum download handler unavailable', e);
      }
      frame.setAttribute('src', FORUM_URL);
    }
    var open = q('#it-forum-open');
    if (open) {
      open.setAttribute('href', FORUM_URL);
      open.addEventListener('click', function (e) {
        e.preventDefault();
        openExternal(FORUM_URL);
      });
    }

    //-- Webview navigation controls. canGoBack/canGoForward may not exist until
    //-- the webview is attached, so guard every call.
    var back = q('#it-forum-back');
    var fwd = q('#it-forum-fwd');
    var reload = q('#it-forum-reload');

    function navState() {
      if (back) {
        back.disabled = !(frame && frame.canGoBack && frame.canGoBack());
      }
      if (fwd) {
        fwd.disabled = !(frame && frame.canGoForward && frame.canGoForward());
      }
    }

    if (back) {
      back.addEventListener('click', function () {
        if (frame && frame.canGoBack && frame.canGoBack()) {
          frame.back();
        }
      });
    }
    if (fwd) {
      fwd.addEventListener('click', function () {
        if (frame && frame.canGoForward && frame.canGoForward()) {
          frame.forward();
        }
      });
    }
    if (reload) {
      reload.addEventListener('click', function () {
        if (frame && frame.reload) {
          frame.reload();
        }
      });
    }
    if (frame && frame.addEventListener) {
      frame.addEventListener('loadcommit', navState);
      frame.addEventListener('loadstop', navState);
      //-- Links that try to open a new window: keep forum/login navigations in
      //-- the webview, but open YouTube / external pages in the system browser.
      frame.addEventListener('newwindow', function (e) {
        if (e.preventDefault) {
          e.preventDefault();
        }
        var url = e.targetUrl || '';
        if (!url) {
          return;
        }
        if (/(groups|accounts)\.google\.com/.test(url)) {
          frame.setAttribute('src', url);
        } else {
          openExternal(url);
        }
      });
    }
    navState();
  }

  //-----------------------------------------------------------------------
  //-- Videos
  //-----------------------------------------------------------------------
  function youtubeId(url) {
    var m = String(url).match(
      /(?:youtu\.be\/|[?&]v=|\/embed\/|\/shorts\/)([A-Za-z0-9_-]{11})/
    );
    return m ? m[1] : null;
  }

  function thumbFor(v) {
    if (v.thumbnail) {
      return v.thumbnail;
    }
    var id = null;
    if (v.type === 'youtube') {
      id = youtubeId(v.url);
    } else if (v.type === 'playlist' && v.videos && v.videos[0]) {
      //-- A playlist uses its first video's thumbnail.
      id = youtubeId(v.videos[0].url || '') || v.videos[0].id;
    }
    if (id) {
      return 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg';
    }
    return '';
  }

  //-- Token search: match only if EVERY whitespace-separated term is found
  //-- (AND), so multiple concepts ("led basic") narrow the search instead of
  //-- requiring the literal phrase. `hay` and `query` are already normalized.
  function matchQuery(hay, query) {
    return query
      .split(/\s+/)
      .filter(Boolean)
      .every(function (tok) {
        return hay.indexOf(tok) !== -1;
      });
  }

  //-- Searchable haystack: original fields + every i18n mirror, so the user
  //-- can search in any provided language.
  function searchText(v) {
    var parts = [v.title, v.description, (v.tags || []).join(' ')];
    if (v.i18n) {
      Object.keys(v.i18n).forEach(function (lang) {
        var t = v.i18n[lang] || {};
        parts.push(t.title, t.description, (t.tags || []).join(' '));
      });
    }
    return normalize(parts.join(' '));
  }

  function renderGrid(filter) {
    var grid = q('#it-grid');
    var empty = q('#it-empty');
    var back = q('#it-videos-back');
    if (!grid) {
      return;
    }
    //-- Level 2 shows the selected playlist's videos; level 1 the catalog.
    var items = viewPlaylist ? viewPlaylist.videos || [] : videos;
    if (back) {
      back.classList.toggle('hidden', !viewPlaylist);
      var bt = q('#it-videos-back-title');
      if (bt && viewPlaylist) {
        bt.textContent =
          localized(viewPlaylist, 'title') || viewPlaylist.title || '';
      }
    }
    grid.innerHTML = '';
    //-- Newest first: sort by upload date (YYYY-MM-DD, desc); for a playlist
    //-- the date is its most recent video. `order` is a stable fallback.
    var ordered = items.slice().sort(function (a, b) {
      var d = (b.date || '').localeCompare(a.date || '');
      return d !== 0 ? d : (a.order || 0) - (b.order || 0);
    });
    var query = normalize(filter || '').trim();
    var shown = 0;
    ordered.forEach(function (v) {
      if (query && !matchQuery(searchText(v), query)) {
        return;
      }
      shown++;
      var isPlaylist = v.type === 'playlist';
      var card = document.createElement('div');
      card.className = 'it-card' + (isPlaylist ? ' it-card--playlist' : '');
      var lang = v.language
        ? '<span class="it-card-lang">' + escapeHtml(v.language) + '</span>'
        : '';
      //-- A folder icon marks a playlist as a collection of videos.
      var folder =
        '<svg class="it-folder-ico" viewBox="0 0 24 24" fill="currentColor" ' +
        'aria-hidden="true"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1' +
        '.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>';
      var badge = isPlaylist
        ? '<span class="it-card-badge">' +
          folder +
          (v.videos || []).length +
          '</span>'
        : '';
      card.innerHTML =
        '<div class="it-card-thumb">' +
        '<img loading="lazy" src="' +
        escapeHtml(thumbFor(v)) +
        '" alt="" />' +
        badge +
        '<span class="it-card-play">' +
        (isPlaylist ? folder : '&#9654;') +
        '</span></div>' +
        '<div class="it-card-title">' +
        escapeHtml(localized(v, 'title') || v.title || '') +
        lang +
        '</div>';
      card.addEventListener('click', function () {
        if (isPlaylist) {
          openPlaylist(v);
        } else {
          playVideo(v);
        }
      });
      grid.appendChild(card);
    });
    if (empty) {
      empty.classList.toggle('hidden', shown !== 0);
    }
  }

  //-- Drill into a playlist (level 2) and back to the catalog (level 1).
  function openPlaylist(p) {
    viewPlaylist = p;
    var s = q('#it-search');
    if (s) {
      s.value = '';
    }
    renderGrid('');
    var scroll = q('.it-videos-scroll');
    if (scroll) {
      scroll.scrollTop = 0;
    }
  }

  function closePlaylist() {
    viewPlaylist = null;
    var s = q('#it-search');
    if (s) {
      s.value = '';
    }
    renderGrid('');
  }

  //-- A tiny localhost HTTP server so the embedded player has a REAL http
  //-- origin. YouTube refuses to serve its /embed/ player when the embedding
  //-- frame's origin is chrome-extension:// or data: (null) — "Error 153". From
  //-- http://127.0.0.1 the embed plays normally. Started lazily, kept for the
  //-- session.
  var playerOrigin = '';
  var playerServer = null;

  function ensurePlayerServer(cb) {
    if (playerOrigin) {
      cb(playerOrigin);
      return;
    }
    try {
      var http = require('http');
      playerServer = http.createServer(function (req, res) {
        var m = String(req.url).match(/[?&]id=([A-Za-z0-9_-]{11})/);
        var vid = m ? m[1] : '';
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<!doctype html><meta charset="utf-8">' +
            '<style>html,body{margin:0;height:100%;background:#000;' +
            'overflow:hidden}iframe{position:absolute;inset:0;width:100%;' +
            'height:100%;border:0}</style>' +
            (vid
              ? '<iframe src="https://www.youtube.com/embed/' +
                vid +
                '?autoplay=1&rel=0&modestbranding=1&fs=0&iv_load_policy=3" ' +
                'allow="accelerometer; autoplay; ' +
                'clipboard-write; encrypted-media; gyroscope; ' +
                'picture-in-picture; web-share" allowfullscreen></iframe>'
              : '')
        );
      });
      playerServer.listen(0, '127.0.0.1', function () {
        playerOrigin = 'http://127.0.0.1:' + playerServer.address().port;
        cb(playerOrigin);
      });
    } catch (e) {
      console.warn('iceTutorial: player server failed', e);
      cb('');
    }
  }

  function playVideo(v) {
    var player = q('#it-player');
    var frame = q('#it-player-frame');
    if (!player || !frame) {
      return;
    }
    var id = v.type === 'youtube' ? youtubeId(v.url) : null;
    if (!id) {
      //-- Unknown origin: fall back to the external browser.
      openExternal(v.url);
      return;
    }
    player.classList.remove('hidden');
    ensurePlayerServer(function (origin) {
      if (!origin) {
        openExternal(v.url);
        return;
      }
      frame.innerHTML =
        '<webview id="it-player-webview" allowfullscreen></webview>';
      var wv = q('#it-player-webview');
      if (wv) {
        wv.setAttribute('src', origin + '/?id=' + id);
        if (wv.addEventListener) {
          wv.addEventListener('newwindow', function (e) {
            if (e.preventDefault) {
              e.preventDefault();
            }
            if (e.targetUrl) {
              openExternal(e.targetUrl);
            }
          });
        }
      }
    });
  }

  function closePlayer() {
    var player = q('#it-player');
    var frame = q('#it-player-frame');
    if (frame) {
      frame.innerHTML = ''; //-- stop playback
    }
    if (player) {
      player.classList.add('hidden');
    }
  }

  function showCatalogError() {
    var grid = q('#it-grid');
    if (grid) {
      grid.innerHTML =
        '<div class="it-error">' +
        escapeHtml(
          gettextCatalog.getString('Could not load the video catalog.')
        ) +
        '</div>';
    }
  }

  //-----------------------------------------------------------------------
  //-- Video store: IndexedDB (via the localDatabase service) is the runtime
  //-- source of truth. catalog.json only seeds the first load and drives
  //-- version-based updates (add/remove/upsert). The bus API is async
  //-- (publish request → receive a *.retrieved* / *.stored* response).
  //-----------------------------------------------------------------------
  var DB = { dbId: 'iceTutorial', storages: ['videos', 'meta'], version: 1 };

  function dbStore(store, rec) {
    rec.store = store;
    iceStudio.bus.events.publish('localDatabase.store', {
      database: DB,
      data: rec,
    });
  }
  function dbDelete(store, id) {
    iceStudio.bus.events.publish('localDatabase.delete', {
      database: DB,
      data: { id: id, store: store },
    });
  }
  function dbRetrieveAll(store) {
    iceStudio.bus.events.publish('localDatabase.retrieveAll', {
      database: DB,
      data: { store: store },
    });
  }

  //-- Read the bundled catalog from disk (the script runs in the main window
  //-- context, so require('fs') + a cwd-relative path resolve correctly).
  function readCatalog() {
    try {
      var fs = require('fs');
      var path = require('path');
      return JSON.parse(fs.readFileSync(path.resolve(CATALOG_REL), 'utf8'));
    } catch (e) {
      console.warn('iceTutorial: catalog read failed', e);
      return null;
    }
  }

  //-- ── Remote catalog ─────────────────────────────────────────────────────
  //-- Same idea as on disk, fetched from GitHub. Edit IT_REMOTE to point at
  //-- another repo/branch/file (or set enabled:false). On load the plugin
  //-- probes the tiny `meta`; only if its version beats the one already stored
  //-- does it download the full catalog and feed it through the same reconcile.
  //-- Offline / 404 → it keeps whatever it already has.
  function itRemoteUrl(file) {
    return (
      'https://raw.githubusercontent.com/' +
      IT_REMOTE.owner +
      '/' +
      IT_REMOTE.repo +
      '/' +
      IT_REMOTE.branch +
      '/' +
      file
    );
  }

  //-- Minimal JSON GET over node http(s), following redirects (avoids CORS).
  function itFetchJson(url) {
    return new Promise(function (resolve, reject) {
      function get(u, redirects) {
        var lib =
          u.indexOf('https:') === 0 ? require('https') : require('http');
        lib
          .get(
            u,
            { headers: { 'User-Agent': 'icestudio-iceTutorial' } },
            function (res) {
              if (
                res.statusCode >= 300 &&
                res.statusCode < 400 &&
                res.headers.location &&
                redirects < 6
              ) {
                res.resume();
                get(new URL(res.headers.location, u).href, redirects + 1);
                return;
              }
              if (res.statusCode !== 200) {
                res.resume();
                reject(new Error('HTTP ' + res.statusCode));
                return;
              }
              var data = '';
              res.on('data', function (c) {
                data += c;
              });
              res.on('end', function () {
                try {
                  resolve(JSON.parse(data));
                } catch (e) {
                  reject(e);
                }
              });
            }
          )
          .on('error', reject);
      }
      try {
        get(url, 0);
      } catch (e) {
        reject(e);
      }
    });
  }

  //-- Apply a (remote) catalog into the IndexedDB store + the references list,
  //-- like the disk reconcile's seed branch, then re-render.
  function itApplyRemoteCatalog(cat, newVersion) {
    if (!cat || !Array.isArray(cat.videos)) {
      return;
    }
    var cv = cat.videos;
    var ids = {};
    cv.forEach(function (v) {
      if (v && v.id) {
        ids[v.id] = true;
        dbStore('videos', JSON.parse(JSON.stringify(v)));
      }
    });
    (videos || []).forEach(function (v) {
      if (v && v.id && !ids[v.id]) {
        dbDelete('videos', v.id);
      }
    });
    dbStore('meta', {
      id: 'catalog',
      version: newVersion,
      updatedAt: cat.updatedAt || '',
    });
    videos = cv;
    if (Array.isArray(cat.references)) {
      references = cat.references;
      renderReferences('');
    }
    renderGrid('');
    console.info(
      'iceTutorial: catalog updated from remote (v' +
        newVersion +
        ', ' +
        cv.length +
        ' videos)'
    );
  }

  //-- Probe the remote meta; if newer than `currentVersion`, download + apply.
  function itCheckRemoteCatalog(currentVersion) {
    if (!IT_REMOTE.enabled) {
      return;
    }
    itFetchJson(itRemoteUrl(IT_REMOTE.meta))
      .then(function (meta) {
        var rv = meta && typeof meta.version === 'number' ? meta.version : 0;
        if (rv <= currentVersion) {
          return null;
        }
        return itFetchJson(itRemoteUrl(IT_REMOTE.catalog)).then(function (cat) {
          if (cat && typeof cat.version === 'number' && cat.version >= rv) {
            itApplyRemoteCatalog(cat, cat.version);
          }
        });
      })
      .catch(function (e) {
        console.warn(
          'iceTutorial: remote catalog check skipped:',
          e && e.message
        );
      });
  }

  //-- Load the videos: read the catalog, read the stored videos + catalog
  //-- version from IndexedDB, and reconcile (seed on first run, or sync when
  //-- the catalog version is newer). Everything renders from the store.
  function loadVideos() {
    var catalog = readCatalog();
    var pending = {
      videos: null,
      metaVersion: null,
      gotVideos: false,
      gotMeta: false,
      done: false,
    };

    function finish(version) {
      pending.done = true;
      renderGrid('');
      //-- Local catalog is in place; now check the remote for a newer one
      //-- (async; offline/404 → no-op, the local catalog stays).
      itCheckRemoteCatalog(version || 0);
    }

    function reconcile() {
      if (pending.done) {
        return;
      }
      var stored = pending.videos || [];
      var storedVersion = pending.metaVersion || 0;
      var catVersion =
        catalog && typeof catalog.version === 'number' ? catalog.version : 0;
      var firstRun = stored.length === 0;

      if (catalog && (firstRun || catVersion > storedVersion)) {
        //-- Seed / update the store to match the catalog.
        var catVideos = catalog.videos || [];
        var catIds = {};
        catVideos.forEach(function (v) {
          if (v && v.id) {
            catIds[v.id] = true;
            dbStore('videos', JSON.parse(JSON.stringify(v)));
          }
        });
        stored.forEach(function (v) {
          if (v && v.id && !catIds[v.id]) {
            dbDelete('videos', v.id);
          }
        });
        dbStore('meta', {
          id: 'catalog',
          version: catVersion,
          updatedAt: catalog.updatedAt || '',
        });
        videos = catVideos;
        console.info(
          'iceTutorial: catalog synced to IndexedDB (v' +
            catVersion +
            ', ' +
            catVideos.length +
            ' videos)'
        );
      } else {
        //-- Up to date: serve straight from the store.
        videos = stored;
        console.info(
          'iceTutorial: ' +
            stored.length +
            ' videos from IndexedDB (v' +
            storedVersion +
            ')'
        );
      }
      finish(
        catalog && (firstRun || catVersion > storedVersion)
          ? catVersion
          : storedVersion
      );
    }

    function onRetrievedAll(payload) {
      if (!payload || payload.dbId !== DB.dbId || pending.done) {
        return;
      }
      if (payload.store === 'videos') {
        pending.videos = payload.results || [];
        pending.gotVideos = true;
      } else if (payload.store === 'meta') {
        var rec = (payload.results || [])[0];
        pending.metaVersion =
          rec && typeof rec.version === 'number' ? rec.version : 0;
        pending.gotMeta = true;
      }
      if (pending.gotVideos && pending.gotMeta) {
        reconcile();
      }
    }

    iceStudio.bus.events.subscribe(
      'localDatabase.retrievedAll',
      onRetrievedAll
    );
    dbRetrieveAll('videos');
    dbRetrieveAll('meta');

    //-- Resilience: if the localDatabase service never answers, fall back to
    //-- the catalog so the grid still works.
    setTimeout(function () {
      if (!pending.done) {
        videos = (catalog && catalog.videos) || [];
        if (!videos.length) {
          showCatalogError();
        }
        finish(
          catalog && typeof catalog.version === 'number' ? catalog.version : 0
        );
        console.warn('iceTutorial: localDatabase timeout — using catalog');
      }
    }, 1500);
  }

  function initVideos() {
    var search = q('#it-search');
    if (search) {
      search.addEventListener('input', function () {
        renderGrid(search.value);
      });
    }
    var back = q('#it-player-back');
    if (back) {
      back.addEventListener('click', closePlayer);
    }
    var plBack = q('#it-videos-back-btn');
    if (plBack) {
      plBack.addEventListener('click', closePlaylist);
    }
    var statusClose = q('#it-status-close');
    if (statusClose) {
      statusClose.addEventListener('click', statusHide);
    }
    loadVideos();
  }

  //-- Translate the static UI strings (the "Forum" tab keeps its literal name).
  function translateUI() {
    function setText(sel, str) {
      var e = q(sel);
      if (e) {
        e.textContent = str;
      }
    }
    function setAttr(sel, attr, str) {
      var e = q(sel);
      if (e) {
        e.setAttribute(attr, str);
      }
    }
    setText('.it-tab[data-tab="videos"]', gettextCatalog.getString('Videos'));
    setText(
      '.it-forum-label',
      gettextCatalog.getString('Community · FPGA-Wars: exploring the free side')
    );
    setText(
      '#it-forum-open',
      gettextCatalog.getString('Open in browser') + ' ↗'
    );
    setAttr(
      '#it-search',
      'placeholder',
      gettextCatalog.getString('Search videos by title, description or tags…')
    );
    setText(
      '.it-note',
      '⚠ ' +
        gettextCatalog.getString(
          'Some videos may be outdated or refer to old Icestudio versions, but the concepts still apply.'
        )
    );
    setText(
      '#it-empty',
      gettextCatalog.getString('No videos match your search.')
    );
    setAttr('#it-forum-back', 'title', gettextCatalog.getString('Back'));
    setAttr('#it-forum-fwd', 'title', gettextCatalog.getString('Forward'));
    setAttr('#it-forum-reload', 'title', gettextCatalog.getString('Refresh'));
    setText('#it-player-back', '← ' + gettextCatalog.getString('Go back'));
    setText('#it-videos-back-btn', '← ' + gettextCatalog.getString('Go back'));
    setAttr('#it-status-close', 'title', gettextCatalog.getString('Close'));
    setText(
      '.it-tab[data-tab="references"]',
      gettextCatalog.getString('Resources')
    );
    setAttr(
      '#it-ref-search',
      'placeholder',
      gettextCatalog.getString('Search resources by title or description…')
    );
    setText(
      '#it-ref-empty',
      gettextCatalog.getString('No resources match your search.')
    );
  }

  //-----------------------------------------------------------------------
  //-- References (links read straight from the catalog)
  //-----------------------------------------------------------------------
  function refSearchText(r) {
    var parts = [r.title, r.description];
    //-- Tags are bilingual (EN + ES together) so the search matches in any
    //-- language and on common/jargon terms.
    if (r.tags && r.tags.length) {
      parts.push(r.tags.join(' '));
    }
    if (r.i18n) {
      Object.keys(r.i18n).forEach(function (lang) {
        var t = r.i18n[lang] || {};
        parts.push(t.title, t.description);
      });
    }
    return normalize(parts.join(' '));
  }

  function renderReferences(filter) {
    var list = q('#it-ref-list');
    var empty = q('#it-ref-empty');
    if (!list) {
      return;
    }
    list.innerHTML = '';
    var query = normalize(filter || '').trim();
    var shown = 0;
    references.forEach(function (r) {
      if (query && !matchQuery(refSearchText(r), query)) {
        return;
      }
      shown++;
      var card = document.createElement('div');
      card.className = 'it-ref';
      var authorHtml = r.author
        ? '<div class="it-ref-author"><span class="it-ref-author-label">' +
          escapeHtml(gettextCatalog.getString('Author')) +
          ':</span> ' +
          escapeHtml(r.author) +
          '</div>'
        : '';
      card.innerHTML =
        '<div class="it-ref-title">' +
        escapeHtml(localized(r, 'title')) +
        '</div>' +
        '<div class="it-ref-desc">' +
        escapeHtml(localized(r, 'description')) +
        '</div>' +
        authorHtml +
        '<div class="it-ref-foot">' +
        '<a class="it-ref-url" href="#">' +
        escapeHtml(r.url || '') +
        '</a>' +
        '<button class="it-ref-go" type="button">' +
        escapeHtml(gettextCatalog.getString('Go')) +
        '</button>' +
        '</div>';
      var go = function (e) {
        if (e) {
          e.preventDefault();
        }
        openExternal(r.url);
      };
      var urlEl = card.querySelector('.it-ref-url');
      if (urlEl) {
        urlEl.addEventListener('click', go);
      }
      var goBtn = card.querySelector('.it-ref-go');
      if (goBtn) {
        goBtn.addEventListener('click', go);
      }
      list.appendChild(card);
    });
    if (empty) {
      empty.classList.toggle('hidden', shown !== 0);
    }
  }

  function initReferences() {
    var catalog = readCatalog();
    references = (catalog && catalog.references) || [];
    var search = q('#it-ref-search');
    if (search) {
      search.addEventListener('input', function () {
        renderReferences(search.value);
      });
    }
    renderReferences('');
  }

  function init() {
    if (typeof pluginRoot === 'undefined' || !pluginRoot) {
      return;
    }
    translateUI();
    initTabs();
    initForum();
    initVideos();
    initReferences();
  }

  return { init: init };
})();

//-- Embedded-windowed plugins run their script body directly inside the
//-- manager's wrapper (which defines `pluginRoot` and has already injected the
//-- shadow DOM content); it does NOT call onIcestudioPluginLoaded. So we
//-- initialize immediately here.
iceTutorial.init();
