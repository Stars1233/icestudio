//============================================================================
//-- iceHub — package manager UI
//-- shell, catalog + installed collections, examples, rich search,
//-- README rendering, copy examples.
//============================================================================

const IHUB_BASE = '/resources/plugins/iceHub/';

//-- ── Remote catalog source ─────────────────────────────────────────────────
//-- Where the published catalog lives. To point iceHub at another repo, branch
//-- or filename, just edit these values (or set `enabled: false` to turn remote
//-- updates off). On launch the plugin fetches the tiny `meta` (version probe)
//-- first and only downloads the full `catalog` when the remote version is
//-- higher than what it already has. Offline / 404 → it keeps the local one.
const IHUB_REMOTE = {
  enabled: true,
  owner: 'FPGAwars',
  repo: 'iceHub',
  branch: 'main',
  catalog: 'catalog.json',
  meta: 'catalog.meta.json',
};

//-- Optional node modules (available in the nwjs main window)
let ihubMarked = null;
try {
  ihubMarked = require('marked');
} catch (e) {
  ihubMarked = null;
}

//-- State
let ihubEnv = false;
let ihubCatalog = { collections: [] };
let ihubInstalled = {}; //-- name -> env collection (internal + external)
let ihubReadmePaths = {}; //-- collection name -> README.md path ('' if none)
let ihubExamples = []; //-- [{kind:'example', key, path, name, collection, description, icon}]
let ihubReadmeCache = {}; //-- readmePath -> text
let ihubCategory = 'collections';
let ihubSearch = '';
let ihubSelected = null; //-- {kind, key}
let ihubBusy = {}; //-- collection id -> true while installing/removing
let ihubLatest = {}; //-- collection id -> {version, updatable} from Refresh
let ihubLockOverride = {}; //-- id -> true/false explicit lock override (localStorage)
let ihubHubInstalled = {}; //-- id -> true (installed via the hub; from iceHub DB)

//-- Explicit lock overrides are persisted in localStorage
function ihubLoadLocks() {
  try {
    ihubLockOverride =
      JSON.parse(window.localStorage.getItem('iceHub.locked') || '{}') || {};
  } catch (e) {
    ihubLockOverride = {};
  }
}

function ihubSaveLocks() {
  try {
    window.localStorage.setItem(
      'iceHub.locked',
      JSON.stringify(ihubLockOverride)
    );
  } catch (e) {
    // ignore
  }
}

//-- Default lock: collections NOT in the catalog and NOT installed via the hub
//-- (i.e. created/cloned by the user directly in the folder) are locked by
//-- default, so iceHub never checks or overwrites them.
function ihubAutoLock(it) {
  return !it.fromCatalog && !ihubHubInstalled[it.id];
}

//-- Effective lock = the user's explicit override if set, else the default
function ihubEffectiveLocked(it) {
  if (Object.prototype.hasOwnProperty.call(ihubLockOverride, it.id)) {
    return !!ihubLockOverride[it.id];
  }
  return ihubAutoLock(it);
}

function ihubToggleLock(id) {
  let it = ihubFind('collection', id);
  if (!it) {
    return;
  }
  let target = !ihubEffectiveLocked(it);
  //-- Only keep an override when it differs from the default; otherwise revert
  //-- to the default so localStorage stays minimal.
  if (target === ihubAutoLock(it)) {
    delete ihubLockOverride[id];
  } else {
    ihubLockOverride[id] = target;
  }
  ihubSaveLocks();
  if (target) {
    delete ihubLatest[id]; //-- becoming locked: drop any pending update flag
  }
  ihubRenderList();
  ihubRenderDetail();
}

//-- Ask the iceHub DB which collections were installed via the hub
function ihubRequestHubInstalled() {
  iceStudio.bus.events.publish('localDatabase.retrieveAll', {
    database: { dbId: 'iceHub', storages: ['installed'], version: 1 },
    data: { store: 'installed' },
  });
}

function ihubOnRetrievedAll(payload) {
  if (!payload || payload.dbId !== 'iceHub' || payload.store !== 'installed') {
    return;
  }
  ihubHubInstalled = {};
  (payload.results || []).forEach(function (r) {
    if (r && r.id) {
      ihubHubInstalled[r.id] = true;
    }
  });
  ihubRenderList();
  ihubRenderDetail();
}

//-- Mark a collection as busy (disables its footer button) and refresh detail
function ihubSetBusy(id, busy) {
  if (busy) {
    ihubBusy[id] = true;
  } else {
    delete ihubBusy[id];
  }
  if (
    ihubSelected &&
    ihubSelected.kind === 'collection' &&
    ihubSelected.key === id
  ) {
    ihubRenderDetail();
  }
}

//-- Blocking overlay (shown during install / remove so the user can't launch
//-- a second operation, move to another collection, etc.)
let ihubPendingRefresh = false; //-- waiting for the post-reindex env update
let ihubOverlayTimer = false;

function ihubShowOverlay(msg) {
  let ov = iceStudio.gui.el('#ihub-overlay', pluginHost);
  if (ov) {
    ov.style.display = 'flex';
  }
  ihubUpdateOverlay(msg);
}

function ihubUpdateOverlay(msg) {
  let m = iceStudio.gui.el('#ihub-overlay-msg', pluginHost);
  if (m) {
    m.textContent = msg || gettextCatalog.getString('Working…');
  }
}

function ihubHideOverlay() {
  let ov = iceStudio.gui.el('#ihub-overlay', pluginHost);
  if (ov) {
    ov.style.display = 'none';
  }
}

//-- Safety net: if the env update never arrives, drop the overlay anyway
function ihubScheduleOverlayTimeout() {
  if (ihubOverlayTimer) {
    clearTimeout(ihubOverlayTimer);
  }
  ihubOverlayTimer = setTimeout(function () {
    ihubOverlayTimer = false;
    if (ihubPendingRefresh) {
      ihubPendingRefresh = false;
      ihubHideOverlay();
    }
  }, 30000);
}

//----------------------------------------------------------------------------
//-- Helpers
//----------------------------------------------------------------------------
function ihubEscape(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
  });
}

function ihubArg(o) {
  return JSON.stringify(o).replace(/'/g, '&#39;');
}

function ihubNotify(msg) {
  if (typeof alertify !== 'undefined' && alertify.message) {
    alertify.message(msg);
  } else {
    console.log('[iceHub] ' + msg);
  }
}

function ihubColLabel(col) {
  return col && col.name ? col.name : gettextCatalog.getString('Default');
}

//-- A package.json author/contributor can be a string or an object {name,...}
function ihubOneAuthor(a) {
  if (typeof a === 'string') {
    return a;
  }
  if (a && a.name) {
    return a.name;
  }
  return '';
}

function ihubAuthorStr(pkg) {
  if (!pkg) {
    return '';
  }
  if (pkg.author) {
    return ihubOneAuthor(pkg.author);
  }
  if (Array.isArray(pkg.authors)) {
    return pkg.authors.map(ihubOneAuthor).filter(Boolean).join(', ');
  }
  if (pkg.authors) {
    return ihubOneAuthor(pkg.authors);
  }
  return '';
}

//-- A package.json repository can be a string or an object {url,...}
function ihubRepoUrl(pkg) {
  if (!pkg) {
    return '';
  }
  let r = pkg.repository;
  if (typeof r === 'string') {
    return r;
  }
  if (r && r.url) {
    return r.url;
  }
  return '';
}

//----------------------------------------------------------------------------
//-- Environment
//----------------------------------------------------------------------------
function ihubSetEnv(env) {
  if (!env || typeof env.VERSION === 'undefined') {
    return;
  }
  ihubEnv = env;
  ihubRequestHubInstalled(); //-- refresh which collections came from the hub
  ihubBuildInstalled();
  ihubBuildExamples();
  ihubLoadReadmes();
  ihubRenderList();
  //-- Refresh the selected item's detail so an just-installed/removed
  //-- collection shows the right buttons and README.
  ihubRenderDetail();

  //-- A reindex from install/remove just completed (env refreshed): drop the
  //-- blocking overlay.
  if (ihubPendingRefresh) {
    ihubPendingRefresh = false;
    if (ihubOverlayTimer) {
      clearTimeout(ihubOverlayTimer);
      ihubOverlayTimer = false;
    }
    ihubHideOverlay();
  }
}

//-- Find a collection's root README (IceCollection's content.readme is
//-- unreliable due to a basename bug, so we look on disk directly).
function ihubReadmePath(envCol) {
  if (!envCol || !envCol.path) {
    return '';
  }
  try {
    let path = require('path');
    let fs = require('fs');
    let cands = ['README.md', 'readme.md', 'Readme.md', 'README.MD'];
    for (let i = 0; i < cands.length; i++) {
      let p = path.join(envCol.path, cands[i]);
      if (fs.existsSync(p)) {
        return p;
      }
    }
  } catch (e) {
    // ignore
  }
  return '';
}

//-- Index installed collections (the ones present on disk: internal + external)
function ihubBuildInstalled() {
  ihubInstalled = {};
  ihubReadmePaths = {};
  if (!ihubEnv) {
    return;
  }
  let sets = []
    .concat(ihubEnv.internalCollections || [])
    .concat(ihubEnv.externalCollections || []);
  sets.forEach(function (c) {
    if (c && c.name) {
      ihubInstalled[c.name] = c;
      ihubReadmePaths[c.name] = ihubReadmePath(c);
    }
  });
}

function ihubIsInstalled(id) {
  return Object.prototype.hasOwnProperty.call(ihubInstalled, id);
}

//-- Read README.md of installed collections into a cache (for rich search and
//-- the detail panel), then re-render.
function ihubLoadReadmes() {
  let fsp;
  try {
    fsp = require('fs').promises;
  } catch (e) {
    return;
  }
  let paths = [];
  Object.keys(ihubReadmePaths).forEach(function (n) {
    let r = ihubReadmePaths[n];
    if (r && !ihubReadmeCache[r]) {
      paths.push(r);
    }
  });
  if (paths.length === 0) {
    return;
  }
  Promise.all(
    paths.map(function (p) {
      return fsp
        .readFile(p, 'utf8')
        .then(function (t) {
          ihubReadmeCache[p] = t;
        })
        .catch(function () {});
    })
  ).then(function () {
    if (ihubCategory === 'collections') {
      ihubRenderList();
    }
    //-- The selected collection's README may have just loaded
    ihubRenderDetail();
  });
}

//----------------------------------------------------------------------------
//-- Examples: gather every .ice from the examples trees, then read each .ice
//-- project package (name / description / icon) asynchronously.
//----------------------------------------------------------------------------
function ihubCollectIce(node, collectionName, out, category) {
  if (!node) {
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) {
      ihubCollectIce(node[i], collectionName, out, category);
    }
    return;
  }
  if (node.children) {
    //-- A folder: its name is the example's category/theme (e.g. "1. Basic").
    //-- Nested folders are accumulated ("1. Basic / Sub").
    let sub = node.name
      ? category
        ? category + ' / ' + node.name
        : node.name
      : category;
    ihubCollectIce(node.children, collectionName, out, sub);
  } else if (node.path && /\.ice$/i.test(node.path)) {
    out.push({
      kind: 'example',
      key: node.path,
      path: node.path,
      name: node.name,
      collection: collectionName,
      category: category || '',
      description: '',
      icon: '',
    });
  }
}

function ihubBuildExamples() {
  ihubExamples = [];
  if (!ihubEnv) {
    return;
  }
  let sources = [];
  if (ihubEnv.defaultCollection) {
    sources.push(ihubEnv.defaultCollection);
  }
  (ihubEnv.internalCollections || []).forEach(function (c) {
    sources.push(c);
  });
  (ihubEnv.externalCollections || []).forEach(function (c) {
    sources.push(c);
  });

  sources.forEach(function (col) {
    let ex = col && col.content ? col.content.examples : null;
    ihubCollectIce(ex, ihubColLabel(col), ihubExamples);
  });

  ihubReadExamplePackages();
}

function ihubReadExamplePackages() {
  let fsp;
  try {
    fsp = require('fs').promises;
  } catch (e) {
    return;
  }
  Promise.all(
    ihubExamples.map(function (ex) {
      return fsp
        .readFile(ex.path, 'utf8')
        .then(function (txt) {
          try {
            let proj = JSON.parse(txt);
            let pkg = proj && proj.package ? proj.package : {};
            if (pkg.name) {
              ex.name = pkg.name;
            }
            ex.description = pkg.description || '';
            ex.icon = pkg.image || '';
          } catch (e) {
            // Ignore malformed .ice
          }
        })
        .catch(function () {});
    })
  ).then(function () {
    if (ihubCategory === 'examples') {
      ihubRenderList();
    }
  });
}

//----------------------------------------------------------------------------
//-- Catalog
//----------------------------------------------------------------------------
//-- Raw GitHub URL for a file in the configured remote repo.
function ihubRemoteUrl(file) {
  return (
    'https://raw.githubusercontent.com/' +
    IHUB_REMOTE.owner +
    '/' +
    IHUB_REMOTE.repo +
    '/' +
    IHUB_REMOTE.branch +
    '/' +
    file
  );
}

//-- Content revision of a catalog (the only field used to decide "newer").
function ihubCatalogVersion(cat) {
  return cat && typeof cat.version === 'number' ? cat.version : 0;
}

//-- Bundled catalog shipped on disk (the immutable baseline).
function ihubReadDiskCatalog() {
  try {
    let fs = require('fs');
    let txt = fs.readFileSync(
      'resources/plugins/iceHub/data/catalog.json',
      'utf8'
    );
    return JSON.parse(txt) || { collections: [] };
  } catch (e) {
    console.warn('[iceHub] cannot read catalog.json', e);
    return { collections: [] };
  }
}

//-- Last catalog downloaded from the remote, cached in localStorage (lost when
//-- the user wipes their profile, by design).
function ihubReadCachedCatalog() {
  try {
    let raw = window.localStorage.getItem('iceHub.remoteCatalog');
    if (!raw) {
      return null;
    }
    let c = JSON.parse(raw);
    return c && Array.isArray(c.collections) ? c : null;
  } catch (e) {
    return null;
  }
}

//-- Load the catalog: serve the best one we already have (cached remote vs
//-- bundled disk) instantly + offline, then check the remote for a newer one.
//-- iceHub's own logic (merge with installed, etc.) is untouched.
function ihubLoadCatalog() {
  let disk = ihubReadDiskCatalog();
  let cached = ihubReadCachedCatalog();
  let best =
    cached && ihubCatalogVersion(cached) >= ihubCatalogVersion(disk)
      ? cached
      : disk;
  ihubCatalog = best;
  ihubCheckRemoteCatalog(ihubCatalogVersion(best));
}

//-- Probe the remote `meta` (tiny); only when its version beats what we have do
//-- we download the full catalog, cache it and re-render. Any failure (offline,
//-- 404, bad JSON) is swallowed and the local catalog stays in place.
function ihubCheckRemoteCatalog(currentVersion) {
  if (!IHUB_REMOTE.enabled) {
    return;
  }
  ihubFetchJson(ihubRemoteUrl(IHUB_REMOTE.meta))
    .then(function (meta) {
      let rv = meta && typeof meta.version === 'number' ? meta.version : 0;
      if (rv <= currentVersion) {
        return null; //-- already up to date
      }
      return ihubFetchJson(ihubRemoteUrl(IHUB_REMOTE.catalog)).then(
        function (cat) {
          if (!cat || !Array.isArray(cat.collections)) {
            return;
          }
          if (ihubCatalogVersion(cat) < rv) {
            return; //-- catalog/meta out of sync, skip this round
          }
          ihubCatalog = cat;
          try {
            window.localStorage.setItem(
              'iceHub.remoteCatalog',
              JSON.stringify(cat)
            );
          } catch (e) {
            // ignore quota / serialization issues
          }
          ihubRenderList();
          console.info(
            '[iceHub] catalog updated from remote (v' +
              ihubCatalogVersion(cat) +
              ', ' +
              cat.collections.length +
              ' collections)'
          );
        }
      );
    })
    .catch(function (e) {
      console.warn('[iceHub] remote catalog check skipped:', e && e.message);
    });
}

//-- Path to a collection's root icon.svg, as a file:// URL, if it exists.
function ihubCollectionIconFile(envCol) {
  if (!envCol || !envCol.path) {
    return '';
  }
  try {
    let path = require('path');
    let fs = require('fs');
    let p = path.join(envCol.path, 'icon.svg');
    if (fs.existsSync(p)) {
      return 'file://' + p;
    }
  } catch (e) {
    // ignore
  }
  return '';
}

//----------------------------------------------------------------------------
//-- Build the Collections list = catalog ∪ installed (merged by id/name)
//----------------------------------------------------------------------------
//-- UI language (2-letter) used to localize catalog descriptions.
function ihubLang() {
  try {
    return String(
      angular
        .element(document.body)
        .injector()
        .get('profile')
        .get('language') || 'en'
    ).slice(0, 2);
  } catch (e) {
    return 'en';
  }
}

//-- Localize a catalog field to the UI language (iceTutorial i18n model):
//-- item.i18n[lang][field] when present, else the base field (Spanish).
function ihubLocalized(item, field) {
  let lang = ihubLang();
  if (item && item.i18n && item.i18n[lang] && item.i18n[lang][field]) {
    return item.i18n[lang][field];
  }
  return (item && item[field]) || '';
}

//-- Join the base field and every i18n translation of it, for the search index.
function ihubAllText(item, field) {
  if (!item) {
    return '';
  }
  let parts = [item[field]];
  if (item.i18n) {
    Object.keys(item.i18n).forEach(function (lang) {
      if (item.i18n[lang] && item.i18n[lang][field]) {
        parts.push(item.i18n[lang][field]);
      }
    });
  }
  return parts.filter(Boolean).join(' ');
}

function ihubCollectionItems() {
  let byId = {};
  let order = [];

  (ihubCatalog.collections || []).forEach(function (c) {
    byId[c.id] = {
      kind: 'collection',
      key: c.id,
      id: c.id,
      name: c.name || c.id,
      description: ihubLocalized(c, 'description'),
      descAll: ihubAllText(c, 'description'),
      tags: c.tags || [],
      icon: c.icon || '',
      iconFile: '',
      author: c.author || '',
      homepage: c.homepage || '',
      source: c.source || null,
      fromCatalog: true,
      installed: false,
      envCol: null,
      updatable: false,
    };
    order.push(c.id);
  });

  Object.keys(ihubInstalled).forEach(function (name) {
    let envCol = ihubInstalled[name];
    let pkg = (envCol.content && envCol.content.package) || {};
    if (byId[name]) {
      byId[name].installed = true;
      byId[name].envCol = envCol;
      if (!byId[name].description && pkg.description) {
        byId[name].description = pkg.description;
      }
      byId[name].iconFile =
        byId[name].iconFile || ihubCollectionIconFile(envCol);
    } else {
      byId[name] = {
        kind: 'collection',
        key: name,
        id: name,
        name: name,
        description: pkg.description || '',
        icon: '',
        iconFile: ihubCollectionIconFile(envCol),
        author: ihubAuthorStr(pkg),
        homepage: ihubRepoUrl(pkg),
        source: null,
        fromCatalog: false,
        installed: true,
        envCol: envCol,
        updatable: false,
      };
      order.push(name);
    }
  });

  return order.map(function (id) {
    let it = byId[id];
    if (ihubLatest[it.id]) {
      it.updatable = !!ihubLatest[it.id].updatable;
      it.latestVersion = ihubLatest[it.id].version;
    }
    it.locked = ihubEffectiveLocked(it);
    if (it.locked) {
      it.updatable = false; //-- locked collections are never updated
    }
    return it;
  });
}

function ihubCurrentItems() {
  return ihubCategory === 'collections' ? ihubCollectionItems() : ihubExamples;
}

//-- Searchable text: rich index (description + README + keywords for
//-- collections; description + collection name as a tag for examples).
function ihubHaystack(it) {
  if (it.kind === 'collection') {
    let parts = [it.name, it.description];
    if (it.descAll) {
      parts.push(it.descAll);
    }
    if (it.tags && it.tags.length) {
      parts.push(it.tags.join(' '));
    }
    let pkg = it.envCol && it.envCol.content ? it.envCol.content.package : null;
    if (pkg && pkg.keywords) {
      parts.push([].concat(pkg.keywords).join(' '));
    }
    let rp = ihubReadmePaths[it.id];
    if (rp && ihubReadmeCache[rp]) {
      parts.push(ihubReadmeCache[rp]);
    }
    return parts.join(' ').toLowerCase();
  }
  return [it.name, it.description, it.collection, it.category]
    .join(' ')
    .toLowerCase();
}

//----------------------------------------------------------------------------
//-- Rendering
//----------------------------------------------------------------------------
function ihubIconHtml(it) {
  if (it.kind === 'collection') {
    let src;
    if (it.iconFile) {
      src = it.iconFile;
    } else if (it.icon && it.icon.indexOf('http') === 0) {
      src = it.icon;
    } else if (it.icon) {
      src = IHUB_BASE + it.icon;
    } else {
      src = IHUB_BASE + 'icons/collection.svg';
    }
    return '<img src="' + ihubEscape(src) + '" alt="">';
  }
  if (it.icon && it.icon.indexOf('<svg') !== -1) {
    return it.icon;
  }
  if (it.icon && it.icon.indexOf('data:') === 0) {
    return '<img src="' + ihubEscape(it.icon) + '" alt="">';
  }
  return '<img src="' + IHUB_BASE + 'icons/example.svg" alt="">';
}

function ihubCardHtml(it) {
  let selected =
    ihubSelected &&
    ihubSelected.kind === it.kind &&
    ihubSelected.key === it.key;
  return (
    '<div class="ihub-card' +
    (it.installed ? ' is-installed' : '') +
    (selected ? ' is-selected' : '') +
    '" data-kind="' +
    ihubEscape(it.kind) +
    '" data-key="' +
    ihubEscape(it.key) +
    '" data-guievt="click" data-handler="this.select" data-args=\'' +
    ihubArg({ kind: it.kind, key: it.key }) +
    "'>" +
    '<div class="ihub-card--icon">' +
    ihubIconHtml(it) +
    '</div>' +
    '<div class="ihub-card--name">' +
    ihubEscape(it.name) +
    '</div>' +
    (it.installed ? '<span class="ihub-card--check">✓</span>' : '') +
    (it.locked
      ? '<span class="ihub-card--lock" title="' +
        ihubEscape(gettextCatalog.getString('Locked')) +
        '">🔒</span>'
      : it.updatable
        ? '<span class="ihub-card--badge">' +
          ihubEscape(gettextCatalog.getString('update')) +
          '</span>'
        : '') +
    '</div>'
  );
}

function ihubRenderList() {
  let list = iceStudio.gui.el('#ihub-list', pluginHost);
  if (!list) {
    return;
  }

  let cats = iceStudio.gui.el('.ihub-cat', pluginHost);
  for (let i = 0; i < cats.length; i++) {
    if (cats[i].getAttribute('data-cat') === ihubCategory) {
      cats[i].classList.add('active');
    } else {
      cats[i].classList.remove('active');
    }
  }

  let note = iceStudio.gui.el('#ihub-search-note', pluginHost);
  if (note) {
    note.textContent =
      '⚠ ' +
      gettextCatalog.getString(
        'You can search by topic, functionality, a collection name, your FPGA board name…'
      ) +
      ' ' +
      gettextCatalog.getString(
        'The example database is based on your installed collections.'
      );
    note.classList.toggle('is-visible', ihubCategory === 'examples');
  }

  let items = ihubCurrentItems();

  let q = ihubSearch.trim().toLowerCase();
  if (q) {
    //-- Match only if EVERY term is found (AND), so multiple concepts
    //-- ("icek ulx") narrow the search instead of requiring the literal phrase.
    let tokens = q.split(/\s+/).filter(Boolean);
    items = items.filter(function (it) {
      let hay = ihubHaystack(it);
      return tokens.every(function (tok) {
        return hay.indexOf(tok) !== -1;
      });
    });
  }

  if (items.length === 0) {
    list.innerHTML =
      '<div class="ihub-empty">' +
      ihubEscape(gettextCatalog.getString('No items')) +
      '</div>';
  } else {
    list.innerHTML = items.map(ihubCardHtml).join('');
  }

  iceStudio.gui.activateEventsFromId('#ihub-list', pluginHost, ihubEvents);
}

function ihubFind(kind, key) {
  if (kind === 'collection') {
    let items = ihubCollectionItems();
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === key) {
        return items[i];
      }
    }
    return null;
  }
  for (let i = 0; i < ihubExamples.length; i++) {
    if (ihubExamples[i].path === key) {
      return ihubExamples[i];
    }
  }
  return null;
}

//-- README (or description) rendered for the detail panel
function ihubDetailBody(it) {
  let rp = ihubReadmePaths[it.id];
  if (it.installed && rp && ihubReadmeCache[rp] && ihubMarked) {
    try {
      return (
        '<div class="ihub-md">' + ihubMarked(ihubReadmeCache[rp]) + '</div>'
      );
    } catch (e) {
      // fall through to description
    }
  }
  return (
    '<div class="ihub-detail--desc">' +
    ihubEscape(it.description || '') +
    '</div>'
  );
}

function ihubRenderDetail() {
  let content = iceStudio.gui.el('#ihub-detail-content', pluginHost);
  let footer = iceStudio.gui.el('#ihub-detail-footer', pluginHost);
  if (!content || !footer) {
    return;
  }

  if (!ihubSelected) {
    content.innerHTML =
      '<div class="ihub-detail--placeholder">' +
      ihubEscape(gettextCatalog.getString('Select an item')) +
      '</div>';
    footer.innerHTML = '';
    return;
  }

  let it = ihubFind(ihubSelected.kind, ihubSelected.key);
  if (!it) {
    content.innerHTML = '';
    footer.innerHTML = '';
    return;
  }

  if (it.kind === 'collection') {
    let meta = ihubEscape(it.author || '');
    if (it.homepage) {
      meta += (meta ? ' · ' : '') + ihubEscape(it.homepage);
    }
    let ver = ihubInstalledVersion(it);
    let verLine = '';
    if (it.installed && ver) {
      verLine =
        '<div class="ihub-detail--ver">v' +
        ihubEscape(ver) +
        (it.updatable && it.latestVersion
          ? ' <span class="ihub-update">' +
            gettextCatalog.getString('→ {{version}} available', {
              version: ihubEscape(it.latestVersion),
            }) +
            '</span>'
          : '') +
        '</div>';
    }
    content.innerHTML =
      '<div class="ihub-detail--title">' +
      ihubEscape(it.name) +
      (it.installed ? ' <span class="ihub-card--check">✓</span>' : '') +
      (it.locked
        ? ' <span class="ihub-detail--lock" title="' +
          ihubEscape(gettextCatalog.getString('Locked')) +
          '">🔒</span>'
        : '') +
      '</div>' +
      '<div class="ihub-detail--meta">' +
      meta +
      '</div>' +
      verLine +
      ihubDetailBody(it);

    if (ihubBusy[it.id]) {
      footer.innerHTML =
        '<button class="ihub-btn" disabled>' +
        ihubEscape(gettextCatalog.getString('Working…')) +
        '</button>';
    } else {
      let buttons = [];
      if (it.installed) {
        if (it.updatable) {
          buttons.push(
            '<button class="ihub-btn ihub-btn--primary" data-guievt="click" data-handler="this.update" data-args=\'' +
              ihubArg({ id: it.id }) +
              "'>" +
              ihubEscape(gettextCatalog.getString('Update')) +
              '</button>'
          );
        }
        if (it.locked) {
          //-- Locked collections cannot be removed: unlock first
          buttons.push(
            '<button class="ihub-btn" disabled title="' +
              ihubEscape(
                gettextCatalog.getString('Locked — unlock to remove')
              ) +
              '">' +
              ihubEscape(gettextCatalog.getString('Remove')) +
              '</button>'
          );
        } else {
          buttons.push(
            '<button class="ihub-btn" data-guievt="click" data-handler="this.remove" data-args=\'' +
              ihubArg({ id: it.id }) +
              "'>" +
              ihubEscape(gettextCatalog.getString('Remove')) +
              '</button>'
          );
        }
        let hasExamples =
          it.envCol &&
          it.envCol.content &&
          it.envCol.content.examples &&
          it.envCol.content.examples.length > 0;
        if (hasExamples) {
          buttons.push(
            '<button class="ihub-btn" data-guievt="click" data-handler="this.copyExamples" data-args=\'' +
              ihubArg({ id: it.id }) +
              "'>" +
              ihubEscape(gettextCatalog.getString('Copy examples')) +
              '</button>'
          );
        }
        buttons.push(
          '<button class="ihub-btn" data-guievt="click" data-handler="this.lock" data-args=\'' +
            ihubArg({ id: it.id }) +
            "'>" +
            ihubEscape(
              it.locked
                ? gettextCatalog.getString('Unlock')
                : gettextCatalog.getString('Lock')
            ) +
            '</button>'
        );
      } else {
        buttons.push(
          '<button class="ihub-btn ihub-btn--primary" data-guievt="click" data-handler="this.install" data-args=\'' +
            ihubArg({ id: it.id }) +
            "'>" +
            ihubEscape(gettextCatalog.getString('Install')) +
            '</button>'
        );
      }
      footer.innerHTML = buttons.join('');
    }
  } else {
    content.innerHTML =
      '<div class="ihub-detail--title">' +
      ihubEscape(it.name) +
      '</div>' +
      '<div class="ihub-detail--meta">' +
      ihubEscape(it.collection || '') +
      (it.category
        ? ' <span class="ihub-detail--cat">' +
          ihubEscape(it.category) +
          '</span>'
        : '') +
      '</div>' +
      '<div class="ihub-detail--desc">' +
      ihubEscape(it.description || '') +
      '</div>';
    footer.innerHTML =
      '<button class="ihub-btn ihub-btn--primary" data-guievt="click" data-handler="this.openExample" data-args=\'' +
      ihubArg({ path: it.path }) +
      "'>" +
      ihubEscape(gettextCatalog.getString('Open')) +
      '</button>';
  }

  iceStudio.gui.activateEventsFromId(
    '#ihub-detail-footer',
    pluginHost,
    ihubEvents
  );
}

function ihubMarkSelectedCard() {
  let cards = iceStudio.gui.el('.ihub-card', pluginHost);
  for (let i = 0; i < cards.length; i++) {
    let sel =
      ihubSelected &&
      cards[i].getAttribute('data-kind') === ihubSelected.kind &&
      cards[i].getAttribute('data-key') === ihubSelected.key;
    if (sel) {
      cards[i].classList.add('is-selected');
    } else {
      cards[i].classList.remove('is-selected');
    }
  }
}

//----------------------------------------------------------------------------
//-- Actions
//----------------------------------------------------------------------------
//-- Copy a collection's examples folder to a user-selected directory.
function ihubCopyExamples(id) {
  let envCol = ihubInstalled[id];
  if (!envCol || !envCol.path) {
    return;
  }
  let path = require('path');
  let fs = require('fs');
  let fse;
  try {
    fse = require('fs-extra');
  } catch (e) {
    fse = fs;
  }
  let src = path.join(envCol.path, 'examples');
  if (!fs.existsSync(src)) {
    ihubNotify(
      gettextCatalog.getString('This collection has no examples folder.')
    );
    return;
  }
  let chooser = $('#input-choose-save-dir');
  chooser.off('change').on('change', function () {
    let dir = $(this).val();
    $(this).val('');
    if (!dir) {
      return;
    }
    try {
      let dest = path.join(dir, envCol.name + '-examples');
      if (fse.copySync) {
        fse.copySync(src, dest);
      } else {
        fse.cpSync(src, dest, { recursive: true });
      }
      ihubNotify(
        gettextCatalog.getString('Examples copied to {{dest}}', { dest: dest })
      );
    } catch (e) {
      ihubNotify(
        gettextCatalog.getString('Copy failed: {{error}}', { error: e.message })
      );
    }
  });
  chooser.trigger('click');
}

//-- The "Add" dialog: install a collection from a local file or a URL
function ihubShowAddDialog() {
  let html =
    '<div class="ihub-add">' +
    '<p>' +
    gettextCatalog.getString(
      'Add a collection from a local file <b>or</b> a URL (use one of the ' +
        'two):'
    ) +
    '</p>' +
    '<div class="ihub-add-row">' +
    '<span class="ihub-add-lbl">' +
    ihubEscape(gettextCatalog.getString('File (.tgz / .zip)')) +
    '</span>' +
    '<input type="text" id="ihub-add-file" class="ajs-input ihub-add-input" readonly placeholder="' +
    ihubEscape(gettextCatalog.getString('No file selected')) +
    '">' +
    '<button type="button" id="ihub-add-browse" class="ajs-button ihub-add-browse">' +
    ihubEscape(gettextCatalog.getString('Browse…')) +
    '</button>' +
    '</div>' +
    '<div class="ihub-add-or">' +
    ihubEscape(gettextCatalog.getString('— or —')) +
    '</div>' +
    '<div class="ihub-add-row">' +
    '<span class="ihub-add-lbl">' +
    ihubEscape(gettextCatalog.getString('URL (.tgz / .zip / GitHub)')) +
    '</span>' +
    '<input type="text" id="ihub-add-url" class="ajs-input ihub-add-input" placeholder="' +
    ihubEscape(
      gettextCatalog.getString(
        'https://github.com/owner/repo   or   https://….tgz'
      )
    ) +
    '">' +
    '</div>' +
    '<input type="file" id="ihub-add-picker" accept=".tgz,.zip,.tar.gz" style="display:none">' +
    '</div>';

  alertify.confirm(
    gettextCatalog.getString('Add collection'),
    html,
    function () {
      let f = document.getElementById('ihub-add-file');
      let u = document.getElementById('ihub-add-url');
      let file = f ? f.value : '';
      let url = u ? u.value : '';
      if (!file && !url) {
        ihubNotify(gettextCatalog.getString('Provide a file or a URL.'));
        return;
      }
      ihubAddCollection({ file: file || null, url: url || null });
    },
    function () {}
  );

  //-- Wire the file picker + mutual exclusivity (elements are in the document)
  let picker = document.getElementById('ihub-add-picker');
  let fileInput = document.getElementById('ihub-add-file');
  let urlInput = document.getElementById('ihub-add-url');
  let browse = document.getElementById('ihub-add-browse');
  if (browse && picker) {
    browse.onclick = function () {
      picker.value = '';
      picker.click();
    };
    picker.onchange = function () {
      if (picker.files && picker.files[0]) {
        fileInput.value = picker.files[0].path;
        if (urlInput) {
          urlInput.value = '';
        }
      }
    };
  }
  if (urlInput) {
    urlInput.oninput = function () {
      if (urlInput.value && fileInput) {
        fileInput.value = '';
      }
    };
  }
}

//-- Open a project file in a new Icestudio window (same mechanism as
//-- utils.newWindow: index.html?icestudio_argv=<base64 {filepath}>)
function ihubOpenInNewWindow(filepath) {
  try {
    let params = JSON.stringify({ filepath: filepath });
    let b64 = Buffer.from(params).toString('base64');
    nw.Window.open('index.html?icestudio_argv=' + b64);
  } catch (e) {
    ihubNotify(
      gettextCatalog.getString('Could not open a new window: {{error}}', {
        error: e.message,
      })
    );
  }
}

//-- "Don't show again" preference for the open-example info dialog
function ihubSkipOpenExampleInfo() {
  try {
    return window.localStorage.getItem('iceHub.skipOpenExampleInfo') === '1';
  } catch (e) {
    return false;
  }
}
function ihubSetSkipOpenExampleInfo(v) {
  try {
    window.localStorage.setItem('iceHub.skipOpenExampleInfo', v ? '1' : '0');
  } catch (e) {
    // ignore
  }
}

//-- Open an example. First explain (unless silenced) that a copy will be saved
//-- to a folder of the user's choice so it can be edited; then pick the folder,
//-- copy and open in a new window. The original example is never modified.
function ihubOpenExample(srcPath) {
  if (!srcPath) {
    return;
  }
  if (ihubSkipOpenExampleInfo()) {
    ihubPickFolderAndOpenExample(srcPath);
    return;
  }
  let html =
    '<div class="ihub-info">' +
    '<p>' +
    gettextCatalog.getString(
      'To edit this example you must choose a folder where a copy will be ' +
        'saved. The copy opens in a new Icestudio window so the original ' +
        'example is never modified.'
    ) +
    '</p>' +
    '<label class="ihub-info-check">' +
    '<input type="checkbox" id="ihub-openinfo-skip"> ' +
    ihubEscape(gettextCatalog.getString('Don’t show this again')) +
    '</label>' +
    '</div>';
  alertify.confirm(
    gettextCatalog.getString('Open example'),
    html,
    function () {
      let chk = document.getElementById('ihub-openinfo-skip');
      if (chk && chk.checked) {
        ihubSetSkipOpenExampleInfo(true);
      }
      ihubPickFolderAndOpenExample(srcPath);
    },
    function () {}
  );
}

//-- Ask for a folder, copy the .ice there and open the copy in a new window
function ihubPickFolderAndOpenExample(srcPath) {
  let path = require('path');
  let fs = require('fs');
  let fse;
  try {
    fse = require('fs-extra');
  } catch (e) {
    fse = fs;
  }
  let chooser = $('#input-choose-save-dir');
  chooser.off('change').on('change', function () {
    let dir = $(this).val();
    $(this).val('');
    if (!dir) {
      return;
    }
    try {
      let dest = path.join(dir, path.basename(srcPath));
      if (fse.copySync) {
        fse.copySync(srcPath, dest);
      } else {
        fs.copyFileSync(srcPath, dest);
      }
      ihubOpenInNewWindow(dest);
      ihubNotify(
        gettextCatalog.getString(
          'Example saved to {{dest}} and opened in a new window.',
          { dest: dest }
        )
      );
    } catch (e) {
      ihubNotify(
        gettextCatalog.getString('Open example failed: {{error}}', {
          error: e.message,
        })
      );
    }
  });
  chooser.trigger('click');
}

//----------------------------------------------------------------------------
//-- Events
//----------------------------------------------------------------------------
function ihubEvents(eventType, handler, args) {
  if (eventType !== 'click') {
    return;
  }
  switch (handler) {
    case 'this.cat':
      ihubCategory =
        args && args.cat === 'examples' ? 'examples' : 'collections';
      ihubSelected = null;
      ihubRenderList();
      ihubRenderDetail();
      break;
    case 'this.select':
      ihubSelected = { kind: args.kind, key: args.key };
      ihubMarkSelectedCard();
      ihubRenderDetail();
      break;
    case 'this.copyExamples':
      ihubCopyExamples(args.id);
      break;
    case 'this.lock':
      ihubToggleLock(args.id);
      break;
    case 'this.refresh':
      ihubRefresh();
      break;
    case 'this.updateAll':
      ihubUpdateAll();
      break;
    case 'this.installAll':
      ihubInstallAll();
      break;
    case 'this.add':
      ihubShowAddDialog();
      break;
    case 'this.install':
      ihubInstall(ihubFind('collection', args.id));
      break;
    case 'this.update':
      ihubInstall(ihubFind('collection', args.id));
      break;
    case 'this.remove':
      ihubRemove(ihubFind('collection', args.id));
      break;
    case 'this.openExample':
      ihubOpenExample(args.path);
      break;
  }
}

function ihubRegisterEvents() {
  iceStudio.bus.events.subscribe(
    'pluginManager.env',
    ihubSetEnv,
    false,
    pluginUUID
  );
  iceStudio.bus.events.subscribe(
    'pluginManager.updateEnv',
    ihubSetEnv,
    false,
    pluginUUID
  );
  iceStudio.bus.events.subscribe(
    'localDatabase.retrievedAll',
    ihubOnRetrievedAll,
    false,
    pluginUUID
  );
}

//----------------------------------------------------------------------------
//-- Localize the static iceHub.html strings (the markup is not Angular-compiled
//-- so its text can't use `| translate`; we override it here via getString).
//----------------------------------------------------------------------------
function ihubLocalizeStatic() {
  if (!pluginRoot) {
    return;
  }
  function setText(sel, text) {
    let el = pluginRoot.querySelector(sel);
    if (el) {
      el.textContent = text;
    }
  }
  function setAttr(sel, attr, value) {
    let el = pluginRoot.querySelector(sel);
    if (el) {
      el.setAttribute(attr, value);
    }
  }
  setAttr(
    '#ihub-search-input',
    'placeholder',
    gettextCatalog.getString('Search…')
  );
  setText(
    '.ihub-cat[data-cat="collections"]',
    gettextCatalog.getString('Collections')
  );
  setText(
    '.ihub-cat[data-cat="examples"]',
    gettextCatalog.getString('Examples')
  );
  setText('#ihub-refresh', gettextCatalog.getString('Refresh'));
  setAttr(
    '#ihub-refresh',
    'title',
    gettextCatalog.getString('Check for new versions')
  );
  setText('#ihub-updateall', gettextCatalog.getString('Update all'));
  setAttr(
    '#ihub-updateall',
    'title',
    gettextCatalog.getString('Update all updatable collections')
  );
  setText('#ihub-installall', gettextCatalog.getString('Install all'));
  setAttr(
    '#ihub-installall',
    'title',
    gettextCatalog.getString('Install all available collections')
  );
  setText('#ihub-add', gettextCatalog.getString('Add'));
  setAttr(
    '#ihub-add',
    'title',
    gettextCatalog.getString('Add a collection from a file or URL')
  );
  setText(
    '.ihub-detail--placeholder',
    gettextCatalog.getString('Select an item')
  );
  setText('#ihub-overlay-msg', gettextCatalog.getString('Working…'));
}

//----------------------------------------------------------------------------
//-- Bootstrap
//----------------------------------------------------------------------------
ihubLoadCatalog();
ihubLoadLocks();
ihubRegisterEvents();

//-- Bind the static toolbar (categories + actions). Cards and footer are bound
//-- on each render so listeners never stack on persistent elements.
iceStudio.gui.activateEventsFromId('#ihub-root', pluginHost, ihubEvents);

//-- Localize the static markup of iceHub.html
ihubLocalizeStatic();

//-- Bind the search input
let ihubSearchInput = iceStudio.gui.el('#ihub-search-input', pluginHost);
if (ihubSearchInput) {
  ihubSearchInput.addEventListener('input', function () {
    ihubSearch = this.value;
    //-- Searching clears the current selection + detail panel, so it never
    //-- keeps showing stale info for an item the filter may hide.
    if (ihubSelected) {
      ihubSelected = null;
      ihubRenderDetail();
    }
    ihubRenderList();
  });
}

ihubRenderList();
ihubRequestHubInstalled();

iceStudio.bus.events.publish('pluginManager.getEnvironment');
