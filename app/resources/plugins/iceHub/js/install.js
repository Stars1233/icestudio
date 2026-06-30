//============================================================================
//-- iceHub — install / remove pipeline
//-- Download (https, follows redirects) → extract (zip) → locate collection
//-- root → copy into the user's external collections folder → record in the
//-- iceHub IndexedDB → trigger collectionService.reindex.
//-- tgz support and GitHub update detection
//============================================================================

//-- Localization. install.js and iceHub.js share one IIFE scope (install.js is
//-- injected first), so this helper is declared once here and is visible in
//-- iceHub.js too. Fallback to identity so the plugin still works if the
//-- service is unavailable. Named `gettextCatalog` so `grunt gettext` finds the
//-- gettextCatalog.getString() calls below.
var gettextCatalog = (function () {
  try {
    var injector = angular.element(document.body).injector();
    return injector.get('gettextCatalog');
  } catch (e) {
    return null;
  }
})() || {
  getString: function (s) {
    return s;
  },
};

//-- The external collections directory chosen by the user
function ihubExternalDir() {
  let path = require('path');
  let fs = require('fs');
  try {
    if (
      ihubEnv &&
      ihubEnv.PROFILE_PATH &&
      fs.existsSync(ihubEnv.PROFILE_PATH)
    ) {
      let prof = JSON.parse(fs.readFileSync(ihubEnv.PROFILE_PATH, 'utf8'));
      if (prof && prof.externalCollections) {
        return prof.externalCollections;
      }
    }
  } catch (e) {
    // ignore and fall back
  }
  let ext = (ihubEnv && ihubEnv.externalCollections) || [];
  if (ext.length && ext[0].path) {
    return path.dirname(ext[0].path);
  }
  return (ihubEnv && ihubEnv.DEFAULT_EXTERNAL_COLLECTIONS_DIR) || '';
}

//-- Glob (only '*') match for picking a release asset by name
function ihubGlobMatch(name, glob) {
  let re = new RegExp(
    '^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    'i'
  );
  return re.test(name);
}

function ihubMatchAsset(assets, glob) {
  for (let i = 0; i < (assets || []).length; i++) {
    if (ihubGlobMatch(assets[i].name, glob)) {
      return assets[i];
    }
  }
  return null;
}

//-- HTTP GET helpers (follow redirects). JSON for the GitHub API, file for the
//-- archive download.
function ihubHttpRequest(url, onResponse, reject, redirects) {
  redirects = redirects || 0;
  if (redirects > 6) {
    reject(new Error(gettextCatalog.getString('Too many redirects')));
    return;
  }
  let U;
  try {
    U = new URL(url);
  } catch (e) {
    reject(e);
    return;
  }
  let mod = U.protocol === 'https:' ? require('https') : require('http');
  let opts = {
    hostname: U.hostname,
    path: U.pathname + U.search,
    headers: {
      'User-Agent': 'icestudio-iceHub',
      'Accept': 'application/vnd.github+json',
    },
  };
  mod
    .get(opts, function (res) {
      if (
        res.statusCode >= 300 &&
        res.statusCode < 400 &&
        res.headers.location
      ) {
        res.resume();
        ihubHttpRequest(
          res.headers.location,
          onResponse,
          reject,
          redirects + 1
        );
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error('HTTP ' + res.statusCode + ' for ' + url));
        return;
      }
      onResponse(res);
    })
    .on('error', reject);
}

function ihubFetchJson(url) {
  return new Promise(function (resolve, reject) {
    ihubHttpRequest(
      url,
      function (res) {
        let data = '';
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
      },
      reject
    );
  });
}

function ihubDownloadFile(url, dest) {
  return new Promise(function (resolve, reject) {
    ihubHttpRequest(
      url,
      function (res) {
        let fs = require('fs');
        let out = fs.createWriteStream(dest);
        res.pipe(out);
        out.on('finish', function () {
          out.close(function () {
            resolve(dest);
          });
        });
        out.on('error', reject);
      },
      reject
    );
  });
}

//-- Resolve a catalog source into a concrete download (F2: zip only)
function ihubResolveSource(source) {
  if (!source) {
    return Promise.reject(
      new Error(gettextCatalog.getString('No source defined'))
    );
  }
  if (source.type === 'zip' || source.type === 'tgz') {
    return Promise.resolve({
      url: source.url,
      version: source.version || '',
      format: source.type,
    });
  }
  if (source.type === 'file') {
    return Promise.resolve({
      localPath: source.path,
      version: source.version || '',
      format: source.format || 'zip',
    });
  }
  if (source.type === 'github-release') {
    return ihubFetchJson(
      'https://api.github.com/repos/' + source.repo + '/releases/latest'
    ).then(function (rel) {
      let version = rel.tag_name || '';
      //-- Prefer a .zip asset matching the glob; otherwise the source zipball
      let zipAsset = ihubMatchAsset(rel.assets, '*.zip');
      if (zipAsset && zipAsset.browser_download_url) {
        return {
          url: zipAsset.browser_download_url,
          version: version,
          format: 'zip',
        };
      }
      if (rel.zipball_url) {
        return { url: rel.zipball_url, version: version, format: 'zip' };
      }
      throw new Error(
        gettextCatalog.getString('No downloadable zip in the latest release')
      );
    });
  }
  return Promise.reject(
    new Error(
      gettextCatalog.getString('Unknown source type: {{type}}', {
        type: source.type,
      })
    )
  );
}

function ihubExtractZip(file, destDir) {
  let AdmZip = require('adm-zip');
  let zip = new AdmZip(file);
  zip.extractAllTo(destDir, true);
}

function ihubExtractTgz(file, destDir) {
  let tar = require('tar');
  tar.x({ file: file, cwd: destDir, sync: true });
}

function ihubExtractArchive(file, destDir, format) {
  if (format === 'tgz') {
    ihubExtractTgz(file, destDir);
  } else {
    ihubExtractZip(file, destDir);
  }
}

//-- Copy a located collection root into dest, replacing it if present
function ihubCopyRoot(root, dest) {
  let fs = require('fs');
  let fse;
  try {
    fse = require('fs-extra');
  } catch (e) {
    fse = fs;
  }
  if (fs.existsSync(dest)) {
    if (fse.removeSync) {
      fse.removeSync(dest);
    } else {
      fs.rmSync(dest, { recursive: true, force: true });
    }
  }
  if (fse.copySync) {
    fse.copySync(root, dest);
  } else {
    fse.cpSync(root, dest, { recursive: true });
  }
}

//-- Find the collection root inside an extracted archive: a folder with a
//-- package.json and a blocks/ or examples/ subfolder (handles the single
//-- wrapper folder of GitHub source zipballs).
function ihubFindCollectionRoot(dir) {
  let fs = require('fs');
  let path = require('path');
  function isCol(d) {
    return (
      fs.existsSync(path.join(d, 'package.json')) &&
      (fs.existsSync(path.join(d, 'blocks')) ||
        fs.existsSync(path.join(d, 'examples')))
    );
  }
  if (isCol(dir)) {
    return dir;
  }
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (e) {
    return null;
  }
  for (let i = 0; i < entries.length; i++) {
    let sub = path.join(dir, entries[i]);
    try {
      if (fs.statSync(sub).isDirectory() && isCol(sub)) {
        return sub;
      }
    } catch (e) {
      // ignore
    }
  }
  return null;
}

//-- IndexedDB iceHub (reuse the localDatabase engine over the bus)
function ihubDbStoreInstalled(rec) {
  rec.store = 'installed';
  iceStudio.bus.events.publish('localDatabase.store', {
    database: { dbId: 'iceHub', storages: ['installed'], version: 1 },
    data: rec,
  });
}

function ihubDbDeleteInstalled(id) {
  iceStudio.bus.events.publish('localDatabase.delete', {
    database: { dbId: 'iceHub', storages: ['installed'], version: 1 },
    data: { id: id, store: 'installed' },
  });
}

//----------------------------------------------------------------------------
//-- Install
//----------------------------------------------------------------------------
//-- Core install (download → extract → locate → copy → record). Resolves once
//-- the files are in place. Does NOT reindex (the caller triggers it, once).
//-- A locked collection is never overwritten.
function ihubInstallCore(item, onPhase) {
  onPhase = onPhase || function () {};
  if (item.locked) {
    return Promise.reject(
      new Error(
        gettextCatalog.getString('{{name}} is locked.', { name: item.name })
      )
    );
  }
  let fs = require('fs');
  let path = require('path');
  let os = require('os');

  let extDir = ihubExternalDir();
  if (!extDir) {
    return Promise.reject(
      new Error(
        gettextCatalog.getString(
          'No external collections folder is configured.'
        )
      )
    );
  }

  let stamp = Date.now();
  let tmpBase = path.join(os.tmpdir(), 'icehub-' + item.id + '-' + stamp);
  let tmpFile = tmpBase + '.zip';
  let tmpDir = tmpBase + '-x';
  let dest = path.join(extDir, item.id);

  function cleanup() {
    try {
      fs.rmSync(tmpFile, { force: true });
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  }

  onPhase(gettextCatalog.getString('Resolving {{name}}…', { name: item.name }));
  return ihubResolveSource(item.source)
    .then(function (src) {
      onPhase(
        gettextCatalog.getString('Downloading {{name}}…', { name: item.name })
      );
      return ihubDownloadFile(src.url, tmpFile).then(function () {
        return src;
      });
    })
    .then(function (src) {
      onPhase(
        gettextCatalog.getString('Extracting {{name}}…', { name: item.name })
      );
      fs.mkdirSync(tmpDir, { recursive: true });
      ihubExtractZip(tmpFile, tmpDir);

      let root = ihubFindCollectionRoot(tmpDir);
      if (!root) {
        throw new Error(
          gettextCatalog.getString('No valid collection found in the archive')
        );
      }

      let fse;
      try {
        fse = require('fs-extra');
      } catch (e) {
        fse = fs;
      }
      if (fs.existsSync(dest)) {
        if (fse.removeSync) {
          fse.removeSync(dest);
        } else {
          fs.rmSync(dest, { recursive: true, force: true });
        }
      }
      if (fse.copySync) {
        fse.copySync(root, dest);
      } else {
        fse.cpSync(root, dest, { recursive: true });
      }

      ihubDbStoreInstalled({
        id: item.id,
        name: item.name,
        version: src.version,
        source: item.source,
        installedAt: stamp,
      });

      cleanup();
    })
    .catch(function (e) {
      cleanup();
      throw e;
    });
}

//-- Run the install (blocking overlay + reindex)
function ihubInstallRun(item) {
  ihubShowOverlay(
    gettextCatalog.getString('Resolving {{name}}…', { name: item.name })
  );
  ihubInstallCore(item, function (phase) {
    ihubUpdateOverlay(phase);
  })
    .then(function () {
      delete ihubLatest[item.id]; //-- no longer flagged as updatable
      ihubUpdateOverlay(gettextCatalog.getString('Reindexing…'));
      ihubPendingRefresh = true;
      ihubScheduleOverlayTimeout();
      iceStudio.bus.events.publish('collectionService.reindex', {
        incremental: true,
      });
    })
    .catch(function (e) {
      ihubHideOverlay();
      ihubNotify(
        gettextCatalog.getString('Install failed: {{error}}', {
          error: e.message,
        })
      );
    });
}

//-- Install / update a single collection. Updating (already installed) replaces
//-- the folder with the release, so we confirm first (with a stronger warning
//-- when the collection is a git working copy).
function ihubInstall(item) {
  if (!item) {
    return;
  }
  if (!item.installed) {
    ihubInstallRun(item);
    return;
  }
  let warnGit = '';
  try {
    let p = require('path');
    let fs = require('fs');
    let envPath = item.envCol && item.envCol.path;
    if (envPath && fs.existsSync(p.join(envPath, '.git'))) {
      warnGit = gettextCatalog.getString(
        '<br><br><b>This collection is a git working copy</b>: its local ' +
          'repository (.git) and any local changes will be lost.'
      );
    }
  } catch (e) {
    // ignore
  }
  alertify.confirm(
    gettextCatalog.getString('Update collection'),
    gettextCatalog.getString(
      'Updating <b>{{name}}</b> will replace its folder with the downloaded ' +
        'release.',
      { name: ihubEscape(item.name) }
    ) + warnGit,
    function () {
      ihubInstallRun(item);
    },
    function () {}
  );
}

//-- Batch install/update: sequential core installs, then a single reindex
function ihubBatchInstall(items, label) {
  if (!items || items.length === 0) {
    return;
  }
  ihubShowOverlay(label);
  let total = items.length;
  let i = 0;
  let failed = [];

  function next() {
    if (i >= total) {
      if (failed.length) {
        ihubNotify(
          gettextCatalog.getString('Could not process: {{names}}', {
            names: failed.join(', '),
          })
        );
      }
      ihubUpdateOverlay(gettextCatalog.getString('Reindexing…'));
      ihubPendingRefresh = true;
      ihubScheduleOverlayTimeout();
      iceStudio.bus.events.publish('collectionService.reindex', {
        incremental: true,
      });
      return;
    }
    let it = items[i];
    ihubInstallCore(it, function (phase) {
      ihubUpdateOverlay(
        gettextCatalog.getString('({{index}}/{{total}}) {{phase}}', {
          index: i + 1,
          total: total,
          phase: phase,
        })
      );
    })
      .then(function () {
        delete ihubLatest[it.id];
        i++;
        next();
      })
      .catch(function (e) {
        failed.push(it.name);
        i++;
        next();
      });
  }
  next();
}

function ihubInstallAll() {
  let items = ihubCollectionItems().filter(function (it) {
    return !it.installed && it.source;
  });
  if (items.length === 0) {
    ihubNotify(
      gettextCatalog.getString('All catalog collections are already installed.')
    );
    return;
  }
  ihubBatchInstall(items, gettextCatalog.getString('Installing collections…'));
}

//============================================================================
//-- Updates (F3): GitHub release version checking
//============================================================================
function ihubGithubLatestVersion(repo) {
  return ihubFetchJson(
    'https://api.github.com/repos/' + repo + '/releases/latest'
  ).then(function (rel) {
    return rel.tag_name || '';
  });
}

//-- The github-release source to use for update checks. ONLY collections that
//-- are in catalog.json are update-checked; collections NOT in the catalog are
//-- never updated (they only appear, can be removed, or re-added via "Add").
function ihubUpdateSource(it) {
  if (it.source && it.source.type === 'github-release' && it.source.repo) {
    return it.source;
  }
  return null;
}

//-- Installed version = the collection's package.json version
function ihubInstalledVersion(it) {
  let pkg = it.envCol && it.envCol.content ? it.envCol.content.package : null;
  return pkg && pkg.version ? String(pkg.version) : '';
}

function ihubNormVer(v) {
  return String(v || '')
    .replace(/^[^0-9]*/, '')
    .split(/[.+\-_]/)
    .map(function (x) {
      return parseInt(x, 10) || 0;
    });
}

//-- Is version a strictly newer than b?
function ihubVersionGt(a, b) {
  let A = ihubNormVer(a);
  let B = ihubNormVer(b);
  let n = Math.max(A.length, B.length);
  for (let i = 0; i < n; i++) {
    let x = A[i] || 0;
    let y = B[i] || 0;
    if (x > y) {
      return true;
    }
    if (x < y) {
      return false;
    }
  }
  return false;
}

//-- Check installed collections for newer GitHub releases (Refresh button)
function ihubRefresh() {
  let items = ihubCollectionItems().filter(function (it) {
    return (
      it.installed &&
      !it.locked &&
      ihubUpdateSource(it) &&
      ihubInstalledVersion(it)
    );
  });
  if (items.length === 0) {
    ihubNotify(
      gettextCatalog.getString('No catalog collections to check for updates.')
    );
    return;
  }
  ihubShowOverlay(gettextCatalog.getString('Checking for updates…'));
  let total = items.length;
  let i = 0;
  let updates = 0;
  let rateLimited = false;

  function next() {
    if (i >= total) {
      ihubHideOverlay();
      ihubRenderList();
      ihubRenderDetail();
      if (rateLimited) {
        ihubNotify(
          gettextCatalog.getString(
            'GitHub rate limit reached. Try again later.'
          )
        );
      } else {
        ihubNotify(
          updates > 0
            ? gettextCatalog.getString('{{count}} update(s) available.', {
                count: updates,
              })
            : gettextCatalog.getString('All collections are up to date.')
        );
      }
      return;
    }
    let it = items[i];
    ihubUpdateOverlay(
      gettextCatalog.getString('Checking ({{index}}/{{total}}) {{name}}…', {
        index: i + 1,
        total: total,
        name: it.name,
      })
    );
    let src = ihubUpdateSource(it);
    ihubGithubLatestVersion(src.repo)
      .then(function (latest) {
        let installed = ihubInstalledVersion(it);
        let up = latest && ihubVersionGt(latest, installed);
        ihubLatest[it.id] = { version: latest, updatable: !!up };
        if (up) {
          updates++;
        }
      })
      .catch(function (e) {
        if (/\b403\b/.test(e.message)) {
          rateLimited = true;
        }
      })
      .then(function () {
        i++;
        next();
      });
  }
  next();
}

//-- Update every installed collection that has a newer release (one reindex)
function ihubUpdateAll() {
  let items = ihubCollectionItems().filter(function (it) {
    return it.installed && it.updatable;
  });
  if (items.length === 0) {
    ihubNotify(
      gettextCatalog.getString('No updates available. Run Refresh first.')
    );
    return;
  }
  alertify.confirm(
    gettextCatalog.getString('Update all'),
    gettextCatalog.getString(
      'Update {{count}} collection(s)? Each folder will be replaced with the ' +
        'downloaded release (git working copies will lose their .git and ' +
        'local changes).',
      { count: items.length }
    ),
    function () {
      ihubBatchInstall(
        items,
        gettextCatalog.getString('Updating collections…')
      );
    },
    function () {}
  );
}

//----------------------------------------------------------------------------
//-- Remove
//----------------------------------------------------------------------------
function ihubRemove(item) {
  if (!item) {
    return;
  }
  if (item.locked) {
    ihubNotify(
      gettextCatalog.getString(
        '{{name}} is locked. Unlock it first to remove.',
        { name: item.name }
      )
    );
    return;
  }
  let envCol = ihubInstalled[item.id];
  if (!envCol || !envCol.path) {
    ihubNotify(gettextCatalog.getString('Collection is not installed.'));
    return;
  }
  alertify.confirm(
    gettextCatalog.getString('Remove collection'),
    gettextCatalog.getString('Remove <b>{{name}}</b> and all its files?', {
      name: ihubEscape(item.name),
    }),
    function () {
      try {
        ihubShowOverlay(
          gettextCatalog.getString('Removing {{name}}…', { name: item.name })
        );
        let fs = require('fs');
        let fse;
        try {
          fse = require('fs-extra');
        } catch (e) {
          fse = fs;
        }
        if (fse.removeSync) {
          fse.removeSync(envCol.path);
        } else {
          fs.rmSync(envCol.path, { recursive: true, force: true });
        }
        ihubDbDeleteInstalled(item.id);
        ihubUpdateOverlay(gettextCatalog.getString('Reindexing…'));
        ihubPendingRefresh = true;
        ihubScheduleOverlayTimeout();
        iceStudio.bus.events.publish('collectionService.reindex', {
          incremental: true,
        });
      } catch (e) {
        ihubHideOverlay();
        ihubNotify(
          gettextCatalog.getString('Remove failed: {{error}}', {
            error: e.message,
          })
        );
      }
    },
    function () {}
  );
}

//============================================================================
//-- Add (F4): install a collection from a local file or a URL
//============================================================================
//-- Build a source descriptor from the dialog inputs (file OR url)
function ihubBuildAddSource(opts) {
  if (opts.file) {
    let fmt = /\.tgz$|\.tar\.gz$/i.test(opts.file)
      ? 'tgz'
      : /\.zip$/i.test(opts.file)
        ? 'zip'
        : null;
    if (!fmt) {
      return null;
    }
    return { type: 'file', path: opts.file, format: fmt };
  }
  if (opts.url) {
    let url = opts.url.trim();
    if (/\.tgz$|\.tar\.gz$/i.test(url)) {
      return { type: 'tgz', url: url };
    }
    if (/\.zip$/i.test(url)) {
      return { type: 'zip', url: url };
    }
    //-- a GitHub repo / releases URL → latest release
    let gh = url.match(/github\.com\/([^/]+)\/([^/#?]+)/i);
    if (gh) {
      let repo = gh[1] + '/' + gh[2].replace(/\.git$/i, '');
      return { type: 'github-release', repo: repo };
    }
    return null;
  }
  return null;
}

//-- Derive a collection id from the extracted collection's package.json name
function ihubDeriveId(root) {
  let fs = require('fs');
  let path = require('path');
  try {
    let pkg = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    );
    if (pkg.name) {
      return String(pkg.name)
        .trim()
        .replace(/[\\/:*?"<>|]+/g, '-');
    }
  } catch (e) {
    // ignore
  }
  //-- fall back to the folder name (strip github zipball sha suffix)
  return path.basename(root).replace(/-[0-9a-f]{7,}$/i, '');
}

//-- If a collection matching id already exists (case-insensitive), return its
//-- exact existing id; otherwise null.
function ihubExistingCollection(id) {
  let lower = String(id).toLowerCase();
  let names = Object.keys(ihubInstalled);
  for (let i = 0; i < names.length; i++) {
    if (names[i].toLowerCase() === lower) {
      return names[i];
    }
  }
  let cols = ihubCatalog.collections || [];
  for (let i = 0; i < cols.length; i++) {
    if (String(cols[i].id).toLowerCase() === lower) {
      return cols[i].id;
    }
  }
  return null;
}

function ihubAddCollection(opts) {
  let source = ihubBuildAddSource(opts);
  if (!source) {
    ihubNotify(
      gettextCatalog.getString(
        'Provide a .tgz/.zip file, or a .tgz/.zip/GitHub URL.'
      )
    );
    return;
  }

  let fs = require('fs');
  let path = require('path');
  let os = require('os');
  let stamp = Date.now();
  let tmpBase = path.join(os.tmpdir(), 'icehub-add-' + stamp);
  let tmpFile = null;
  let tmpDir = tmpBase + '-x';
  function cleanup() {
    try {
      if (tmpFile) {
        fs.rmSync(tmpFile, { force: true });
      }
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (e) {
      // ignore
    }
  }

  ihubShowOverlay(gettextCatalog.getString('Resolving…'));
  ihubResolveSource(source)
    .then(function (resolved) {
      let format = resolved.format;
      fs.mkdirSync(tmpDir, { recursive: true });
      if (resolved.localPath) {
        ihubUpdateOverlay(gettextCatalog.getString('Extracting…'));
        ihubExtractArchive(resolved.localPath, tmpDir, format);
        return resolved.version;
      }
      ihubUpdateOverlay(gettextCatalog.getString('Downloading…'));
      tmpFile = tmpBase + (format === 'tgz' ? '.tgz' : '.zip');
      return ihubDownloadFile(resolved.url, tmpFile).then(function () {
        ihubUpdateOverlay(gettextCatalog.getString('Extracting…'));
        ihubExtractArchive(tmpFile, tmpDir, format);
        return resolved.version;
      });
    })
    .then(function (version) {
      let root = ihubFindCollectionRoot(tmpDir);
      if (!root) {
        throw new Error(
          gettextCatalog.getString('No valid collection found in the archive')
        );
      }
      let derivedId = ihubDeriveId(root);
      let existingId = ihubExistingCollection(derivedId);
      let id = existingId || derivedId;

      //-- Refuse to overwrite a locked collection
      let existingItem = existingId ? ihubFind('collection', existingId) : null;
      if (existingItem && existingItem.locked) {
        cleanup();
        ihubHideOverlay();
        ihubNotify(
          gettextCatalog.getString(
            '{{name}} is locked. Unlock it first to overwrite.',
            { name: id }
          )
        );
        return;
      }

      let extDir = ihubExternalDir();
      if (!extDir) {
        cleanup();
        ihubHideOverlay();
        ihubNotify(
          gettextCatalog.getString(
            'No external collections folder is configured.'
          )
        );
        return;
      }
      let dest = path.join(extDir, id);

      function doInstall() {
        ihubShowOverlay(
          gettextCatalog.getString('Installing {{name}}…', { name: id })
        );
        ihubCopyRoot(root, dest);
        ihubDbStoreInstalled({
          id: id,
          name: id,
          version: version,
          source: source,
          installedAt: stamp,
        });
        cleanup();
        ihubUpdateOverlay(gettextCatalog.getString('Reindexing…'));
        ihubPendingRefresh = true;
        ihubScheduleOverlayTimeout();
        iceStudio.bus.events.publish('collectionService.reindex', {
          incremental: true,
        });
      }

      //-- Confirm before overwriting an existing collection
      if (fs.existsSync(dest)) {
        ihubHideOverlay();
        alertify.confirm(
          gettextCatalog.getString('Collection exists'),
          gettextCatalog.getString(
            'Collection <b>{{name}}</b> already exists. Overwrite it with the ' +
              'added one?',
            { name: ihubEscape(id) }
          ),
          function () {
            doInstall();
          },
          function () {
            cleanup();
          }
        );
      } else {
        doInstall();
      }
    })
    .catch(function (e) {
      cleanup();
      ihubHideOverlay();
      ihubNotify(
        gettextCatalog.getString('Add failed: {{error}}', { error: e.message })
      );
    });
}
