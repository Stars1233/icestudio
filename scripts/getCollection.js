#!/usr/bin/env node
'use strict';

//----------------------------------------------------------------------------
//-- Download and install the default collection from the LATEST GitHub release
//-- of FPGAwars/collection-default.
//--
//-- Replaces the previous version-pinned approach (grunt wget of
//-- .../archive/v<pkg.collection>.zip), which hardcoded a version in
//-- app/package.json and failed because grunt-wget did not follow GitHub's 302
//-- redirect.
//--
//-- It does NOT use api.github.com (rate-limited to 60/h per IP and unreliable
//-- on some build networks). Instead it relies on two stable, non-API GitHub
//-- web endpoints:
//--   1. https://github.com/<repo>/releases/latest  -> 302 to .../releases/tag/<tag>
//--   2. https://github.com/<repo>/archive/refs/tags/<tag>.tar.gz  (source archive)
//--
//-- Runs on the build hosts (macOS and Linux) using curl + tar.
//----------------------------------------------------------------------------

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = 'FPGAwars/collection-default';
const DEST = path.resolve(__dirname, '..', 'app', 'resources', 'collection');
const UA = 'icestudio-build';

//-- Resolve the latest release tag via the web redirect (no GitHub API).
function latestTag() {
  const eff = execFileSync('curl', [
    '-sL',
    '-o',
    '/dev/null',
    '-w',
    '%{url_effective}',
    '-A',
    UA,
    'https://github.com/' + REPO + '/releases/latest',
  ])
    .toString('utf8')
    .trim();
  const m = eff.match(/\/releases\/tag\/(.+)$/);
  if (!m) {
    throw new Error(
      'Could not resolve the latest release tag (got: ' + eff + ')'
    );
  }
  return decodeURIComponent(m[1]);
}

//-- Locate the collection root inside the extracted archive: a folder with a
//-- package.json and a blocks/ (or examples/) subfolder. GitHub source
//-- archives wrap everything in a single "<owner>-<repo>-<sha>" folder.
function findCollectionRoot(dir) {
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
  for (const name of fs.readdirSync(dir)) {
    const sub = path.join(dir, name);
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

(function main() {
  const tag = latestTag();
  console.log('[getCollection] Latest release of ' + REPO + ': ' + tag);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icecol-'));
  const archive = path.join(tmp, 'collection.tar.gz');
  const url =
    'https://github.com/' +
    REPO +
    '/archive/refs/tags/' +
    encodeURIComponent(tag) +
    '.tar.gz';
  console.log('[getCollection] Downloading ' + url);
  execFileSync('curl', ['-sL', '--fail', '-A', UA, '-o', archive, url], {
    stdio: 'inherit',
  });

  const ex = path.join(tmp, 'extract');
  fs.mkdirSync(ex);
  execFileSync('tar', ['-xzf', archive, '-C', ex]);

  const root = findCollectionRoot(ex);
  if (!root) {
    throw new Error('Could not locate the collection root in the archive');
  }

  //-- Replace app/resources/collection with the downloaded collection
  fs.rmSync(DEST, { recursive: true, force: true });
  fs.mkdirSync(DEST, { recursive: true });
  fs.cpSync(root, DEST, { recursive: true });
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log('[getCollection] Installed ' + REPO + '@' + tag + ' -> ' + DEST);
})();
