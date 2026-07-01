/* jshint esversion: 6 */
/* global pluginRoot, pluginUUID, registerEvents, iceStudio, appEnv, alertify,
          angular, parseConstraint, exportPCF, $ */

// ─── Node modules (NW.js embedded context) ──────────────────────────────────
var nodeChildProcess = require('child_process');
var nodeFs = require('fs');
var nodePath = require('path');

// ─── State ──────────────────────────────────────────────────────────────────
var beInited = false;
var beCurrent = null; //-- board record currently loaded in the form
var beIsNew = false; //-- true while editing an unsaved new/cloned board
var beServices = null;

// ─── i18n ─────────────────────────────────────────────────────────────────
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

// ─── Small DOM helpers (scoped to the plugin shadow root) ────────────────────
function $id(id) {
  return pluginRoot.getElementById(id);
}
function $qsa(sel) {
  return Array.prototype.slice.call(pluginRoot.querySelectorAll(sel));
}
function el(tag, attrs, text) {
  var n = document.createElement(tag);
  if (attrs) {
    Object.keys(attrs).forEach(function (k) {
      n.setAttribute(k, attrs[k]);
    });
  }
  if (text != null) {
    n.textContent = text;
  }
  return n;
}

// ─── Host services via the Angular injector ──────────────────────────────────
function services() {
  if (beServices) {
    return beServices;
  }
  var injector = angular.element(document.body).injector();
  beServices = {
    boards: injector.get('boards'),
    common: injector.get('common'),
    project: injector.get('project'),
    utils: injector.get('utils'),
  };
  return beServices;
}

// ─── Paths ───────────────────────────────────────────────────────────────────
function boardsResourceDir() {
  //-- common.APP === process.cwd() (the app/ folder); distribution boards
  //-- live in <APP>/resources/boards
  return nodePath.join(services().common.APP, 'resources', 'boards');
}

function projectDir() {
  //-- Directory of the active (saved) project; empty if not yet saved
  var p = services().project;
  if (p.path) {
    return nodePath.dirname(p.path);
  }
  return '';
}

function targetDir(board, isNew) {
  //-- Existing distribution board edited in developer mode → in place
  if (!isNew && board && board.origin === 'distribution') {
    return nodePath.join(boardsResourceDir(), board.name);
  }
  //-- New board created while developer mode is on → save into the
  //-- distribution boards folder (it is also registered in menu.json on save)
  if (isNew && devModeOn()) {
    return nodePath.join(boardsResourceDir(), board.name);
  }
  //-- Otherwise → project boards folder
  var dir = projectDir();
  if (!dir) {
    return '';
  }
  return nodePath.join(dir, 'boards', board.name);
}

//-- True when the "Developer mode" checkbox is ticked
function devModeOn() {
  var cb = $id('be-devmode');
  return !!(cb && cb.checked);
}

//-- A save targets the distribution when developer mode is on and the board
//-- is either a brand-new board or an existing distribution board.
function savesToDistribution() {
  if (!devModeOn()) {
    return false;
  }
  return beIsNew || (beCurrent && beCurrent.origin === 'distribution');
}

// ─── menu.json (distribution board registry) ─────────────────────────────────
function menuJsonPath() {
  return nodePath.join(boardsResourceDir(), 'menu.json');
}

//-- Infer the FPGA family group (the menu.json "type") from the board info.
//-- The host groups boards in the Select→Board menu by this family. We derive
//-- it from arch/fpga; when nothing matches we fall back to the arch (upper
//-- cased) or "MISC" so the board is still reachable from the menu.
function inferFamily(info) {
  var arch = String((info && info.arch) || '').toLowerCase();
  var fpga = String((info && info.fpga) || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  if (arch.indexOf('ecp5') !== -1 || fpga.indexOf('lfe5') !== -1) {
    return 'ECP5';
  }
  if (
    arch.indexOf('gowin') !== -1 ||
    fpga.indexOf('gw1n') !== -1 ||
    fpga.indexOf('gw2a') !== -1
  ) {
    return 'GOWIN';
  }
  //-- Xilinx 7-series (openXC7): arch "xc7" or an fpga part like "xc7a35t…".
  if (
    arch.indexOf('xc7') !== -1 ||
    arch.indexOf('xilinx') !== -1 ||
    fpga.indexOf('xc7') !== -1
  ) {
    return 'XILINX';
  }

  //-- ice40 sub-families, matched by an fpga token (e.g. ice40hx8k-…)
  var ICE40 = [
    ['hx1k', 'HX1K'],
    ['hx4k', 'HX8K'],
    ['hx8k', 'HX8K'],
    ['lp1k', 'LP1K'],
    ['lp4k', 'LP8K'],
    ['lp8k', 'LP8K'],
    ['ul1k', 'UL1K'],
    ['up3k', 'UP5K'],
    ['up5k', 'UP5K'],
    ['u4k', 'U4K'],
  ];
  for (var i = 0; i < ICE40.length; i++) {
    if (fpga.indexOf(ICE40[i][0]) !== -1) {
      return ICE40[i][1];
    }
  }

  if (arch) {
    return arch.toUpperCase();
  }
  return 'MISC';
}

//-- Canonical FPGA family order for the Select→Board menu (matches the historic
//-- menu.json ordering). Unknown families are appended alphabetically.
var MENU_FAMILY_ORDER = [
  'HX1K',
  'HX8K',
  'HX4K',
  'LP1K',
  'LP8K',
  'UL1K',
  'U4K',
  'UP5K',
  'ECP5',
  'GOWIN',
  'XILINX',
];

//-- Architectures supported by the open toolchain (icestorm/trellis/apicula and
//-- openXC7 for Xilinx 7-series). Boards on any other arch are left out of the
//-- menu.
var MENU_SUPPORTED_ARCH = {
  ice40: true,
  ecp5: true,
  gowin: true,
  xc7: true,
};

//-- Rebuild resources/boards/menu.json from scratch by scanning the boards
//-- folder, so the file no longer has to be hand-maintained. A board is listed
//-- when it: is not disabled (no leading "_"), has the three required files,
//-- runs on a supported arch, and resolves to a known FPGA family
//-- (info.group / info.type / inferred from arch+fpga). Grouped by family in the
//-- canonical order; boards sorted alphabetically within each family.
function regenerateMenu() {
  var dir = boardsResourceDir();
  var groups = {};
  var names = nodeFs.readdirSync(dir);

  for (var i = 0; i < names.length; i++) {
    var name = names[i];
    if (name.charAt(0) === '_') {
      continue; //-- disabled board
    }
    var bp = nodePath.join(dir, name);
    try {
      if (!nodeFs.statSync(bp).isDirectory()) {
        continue;
      }
      if (
        !nodeFs.existsSync(nodePath.join(bp, 'info.json')) ||
        !nodeFs.existsSync(nodePath.join(bp, 'pinout.json')) ||
        !nodeFs.existsSync(nodePath.join(bp, 'rules.json'))
      ) {
        continue;
      }
      var info = JSON.parse(
        nodeFs.readFileSync(nodePath.join(bp, 'info.json'), 'utf8')
      );
      var arch = String(info.arch || '').toLowerCase();
      if (arch && !MENU_SUPPORTED_ARCH[arch]) {
        continue; //-- unsupported toolchain (e.g. Xilinx)
      }
      var family = info.group || info.type || inferFamily(info);
      if (!family || family === 'MISC') {
        continue; //-- not enough metadata to place it in the menu
      }
      if (!groups[family]) {
        groups[family] = [];
      }
      groups[family].push(name);
    } catch (e) {
      //-- Skip a malformed board instead of aborting the whole regeneration
    }
  }

  var families = Object.keys(groups).sort(function (a, b) {
    var ia = MENU_FAMILY_ORDER.indexOf(a);
    var ib = MENU_FAMILY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) {
      return a < b ? -1 : a > b ? 1 : 0;
    }
    if (ia === -1) {
      return 1;
    }
    if (ib === -1) {
      return -1;
    }
    return ia - ib;
  });

  var menu = families.map(function (family) {
    var boards = groups[family].slice().sort(function (a, b) {
      var la = a.toLowerCase();
      var lb = b.toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
    return { type: family, boards: boards };
  });

  writeJSON(menuJsonPath(), menu);
  return menu;
}

//-- The single toolbar refresh action (the ↻ button). In developer mode it
//-- regenerates menu.json from the boards folder (the distribution list) and
//-- then reloads; otherwise it just reloads the board list.
function onReloadOrRegenerate() {
  if (devModeOn()) {
    try {
      var menu = regenerateMenu();
      var n = menu.reduce(function (acc, g) {
        return acc + g.boards.length;
      }, 0);
      reloadBoards();
      alertify.success(
        gettextCatalog
          .getString('menu.json regenerated ({n} boards)')
          .replace('{n}', n)
      );
    } catch (e) {
      alertify.error(
        gettextCatalog
          .getString('Could not regenerate menu.json: {error}')
          .replace('{error}', e.message)
      );
    }
    return;
  }
  reloadBoards();
}

// ─── Status line ─────────────────────────────────────────────────────────────
function setStatus(msg, kind) {
  var s = $id('be-status');
  if (!s) {
    return;
  }
  s.textContent = msg || '';
  s.className = 'be-status' + (kind ? ' be-' + kind : '');
}

// ─── i18n: translate the static HTML at runtime ─────────────────────────────
//-- The HTML keeps its English text as the default; here we replace it with the
//-- localized strings (literal getString calls so nggettext can extract them).
function beTxt(sel, s) {
  var e = pluginRoot.querySelector(sel);
  if (e) {
    e.textContent = s;
  }
}
function beTitle(sel, s) {
  var e = pluginRoot.querySelector(sel);
  if (e) {
    e.setAttribute('title', s);
  }
}
function bePh(sel, s) {
  var e = pluginRoot.querySelector(sel);
  if (e) {
    e.setAttribute('placeholder', s);
  }
}
//-- Set the label of a .be-field by locating it through its input id.
function beFieldLabel(inputSel, s) {
  var inp = pluginRoot.querySelector(inputSel);
  if (!inp) {
    return;
  }
  var label = inp.parentNode.querySelector('label');
  if (label) {
    label.textContent = s;
  }
}
//-- Replace only the trailing text node of an element.
function beTrailText(sel, s) {
  var e = pluginRoot.querySelector(sel);
  if (e && e.lastChild && e.lastChild.nodeType === 3) {
    e.lastChild.nodeValue = s;
  }
}

function beTranslateUI() {
  if (!pluginRoot || !pluginRoot.querySelector('#be-root')) {
    return;
  }

  //-- Toolbar
  beTxt('#be-new', gettextCatalog.getString('New'));
  beTitle('#be-new', gettextCatalog.getString('Create a new board'));
  beTxt('#be-clone', gettextCatalog.getString('Clone'));
  beTitle('#be-clone', gettextCatalog.getString('Clone the selected board'));
  beTxt('#be-save', gettextCatalog.getString('Save'));
  beTitle('#be-save', gettextCatalog.getString('Save board'));
  beTxt('#be-delete', gettextCatalog.getString('Delete'));
  beTitle(
    '#be-delete',
    gettextCatalog.getString('Delete board (project boards only)')
  );
  beTxt('#be-import-pcf', gettextCatalog.getString('Import constraints'));
  beTitle(
    '#be-import-pcf',
    gettextCatalog.getString(
      'Import a constraint file (PCF/LPF/CST/XDC) into the pinout'
    )
  );
  beTxt('#be-import-apio', gettextCatalog.getString('Import from apio'));
  beTitle(
    '#be-import-apio',
    gettextCatalog.getString('Import board metadata from apio')
  );
  //-- Developer mode checkbox: keep the <input>, set its trailing text node.
  beTrailText(
    'label.be-check',
    ' ' + gettextCatalog.getString('Developer mode')
  );
  beTitle(
    'label.be-check',
    gettextCatalog.getString('Allow editing distribution boards (developer)')
  );
  beTitle(
    '#be-reload',
    gettextCatalog.getString(
      'Reload the board list (regenerates menu.json in developer mode)'
    )
  );
  bePh('#be-filter', gettextCatalog.getString('Filter boards...'));

  //-- Tabs
  beTxt('.be-tab[data-tab="info"]', gettextCatalog.getString('Info'));
  beTxt('.be-tab[data-tab="pinout"]', gettextCatalog.getString('Pinout'));
  beTxt('.be-tab[data-tab="rules"]', gettextCatalog.getString('Rules'));
  beTxt('.be-tab[data-tab="commands"]', gettextCatalog.getString('Commands'));

  //-- Info fields
  beFieldLabel('#f-name', gettextCatalog.getString('Board id (folder name)'));
  beFieldLabel('#f-label', gettextCatalog.getString('Label'));
  beFieldLabel(
    '#f-mode',
    gettextCatalog.getString('Build mode (default per action)')
  );
  beFieldLabel('#f-apio', gettextCatalog.getString('Apio board id'));
  beFieldLabel('#f-arch', gettextCatalog.getString('Arch'));
  beFieldLabel('#f-fpga', gettextCatalog.getString('FPGA (id/part)'));
  beFieldLabel('#f-interface', gettextCatalog.getString('Interface'));
  beFieldLabel('#f-clk', gettextCatalog.getString('Sys Clk (MHz)'));
  beFieldLabel('#f-usbvid', gettextCatalog.getString('USB VID'));
  beFieldLabel('#f-usbpid', gettextCatalog.getString('USB PID'));
  beFieldLabel('#f-datasheet', gettextCatalog.getString('Datasheet URL'));
  beFieldLabel(
    '#f-group',
    gettextCatalog.getString('Menu group (project boards)')
  );
  var modeOpts = pluginRoot.querySelectorAll('#f-mode option');
  if (modeOpts[0]) {
    modeOpts[0].textContent = gettextCatalog.getString(
      'apio — actions without a command run via apio'
    );
  }
  if (modeOpts[1]) {
    modeOpts[1].textContent = gettextCatalog.getString(
      'custom — no apio fallback'
    );
  }
  beTxt(
    '.be-panel[data-panel="info"] legend',
    gettextCatalog.getString('FPGA Resources')
  );

  //-- Pinout
  beTxt('#be-pin-add', gettextCatalog.getString('+ Add pin'));
  beTxt(
    '.be-panel[data-panel="pinout"] .be-hint',
    gettextCatalog.getString(
      'name = signal label shown in the UI, value = FPGA pin, type = input/output/inout'
    )
  );
  var poTh = pluginRoot.querySelectorAll('#be-pinout thead th');
  if (poTh[0]) {
    poTh[0].textContent = gettextCatalog.getString('Name');
  }
  if (poTh[1]) {
    poTh[1].textContent = gettextCatalog.getString('Value (pin)');
  }
  if (poTh[2]) {
    poTh[2].textContent = gettextCatalog.getString('Type');
  }

  //-- Rules
  var ruleH4 = pluginRoot.querySelectorAll('.be-panel[data-panel="rules"] h4');
  if (ruleH4[0] && ruleH4[0].firstChild) {
    ruleH4[0].firstChild.nodeValue =
      '\n          ' + gettextCatalog.getString('Input rules');
  }
  if (ruleH4[1] && ruleH4[1].firstChild) {
    ruleH4[1].firstChild.nodeValue =
      '\n          ' + gettextCatalog.getString('Output rules');
  }
  beTxt('#be-rin-add', gettextCatalog.getString('+ Add'));
  beTxt('#be-rout-add', gettextCatalog.getString('+ Add'));
  var riTh = pluginRoot.querySelectorAll('#be-rules-in thead th');
  if (riTh[0]) {
    riTh[0].textContent = gettextCatalog.getString('port');
  }
  if (riTh[1]) {
    riTh[1].textContent = gettextCatalog.getString('pin');
  }
  var roTh = pluginRoot.querySelectorAll('#be-rules-out thead th');
  if (roTh[0]) {
    roTh[0].textContent = gettextCatalog.getString('pin');
  }
  if (roTh[1]) {
    roTh[1].textContent = gettextCatalog.getString('bit');
  }

  //-- Commands hints (keep the {PLACEHOLDER} code tokens and "apio" verbatim)
  var cmdHints = pluginRoot.querySelectorAll(
    '.be-panel[data-panel="commands"] > .be-hint'
  );
  if (cmdHints[0]) {
    //-- The first hint mixes text, <b>, <code>; translate each text run.
    translateCmdHint1(cmdHints[0]);
  }
  if (cmdHints[1] && cmdHints[1].firstChild) {
    cmdHints[1].firstChild.nodeValue =
      '\n          ' +
      gettextCatalog.getString('Placeholders:') +
      '\n          ';
  }

  //-- Command groups: leading word stays, translate the trailing <span>.
  var cmdTitles = pluginRoot.querySelectorAll('.be-cmd-title span');
  if (cmdTitles[0]) {
    cmdTitles[0].textContent = gettextCatalog.getString('— empty = apio build');
  }
  if (cmdTitles[1]) {
    cmdTitles[1].textContent = gettextCatalog.getString(
      '— empty = apio upload'
    );
  }
  if (cmdTitles[2]) {
    cmdTitles[2].textContent = gettextCatalog.getString('— empty = apio lint');
  }
  if (cmdTitles[3]) {
    cmdTitles[3].textContent = gettextCatalog.getString('— empty = apio clean');
  }

  //-- Modal
  beTxt('.be-modal-header', gettextCatalog.getString('Import board from apio'));
  bePh('#be-modal-filter', gettextCatalog.getString('Filter boards...'));
  beTxt('#be-modal-cancel', gettextCatalog.getString('Cancel'));
  beTxt('#be-modal-import', gettextCatalog.getString('Import'));
}

//-- The first commands hint is a paragraph of prose interleaved with <b> and
//-- <code> children. Translate each text run, keeping the markup/code tokens.
function translateCmdHint1(p) {
  //-- Text node before <b>
  if (p.childNodes[0] && p.childNodes[0].nodeType === 3) {
    p.childNodes[0].nodeValue =
      '\n          ' +
      gettextCatalog.getString('One shell command per line.') +
      '\n          ';
  }
  var b = p.querySelector('b');
  if (b) {
    b.textContent = gettextCatalog.getString(
      'Leave an action empty to use apio'
    );
  }
  //-- Text node after <b> and before <code>
  var code = p.querySelector('code');
  if (b && b.nextSibling && b.nextSibling.nodeType === 3) {
    b.nextSibling.nodeValue =
      ' ' +
      gettextCatalog.getString(
        '(mode "apio"). Mix freely (e.g. apio build + custom upload = combo). Per-OS columns override per operating system; if the three are equal it is stored as a single all-OS command. Use'
      ) +
      ' ';
  }
  //-- Text node after <code>
  if (code && code.nextSibling && code.nextSibling.nodeType === 3) {
    code.nextSibling.nodeValue =
      '\n          ' +
      gettextCatalog.getString('to run a toolchain tool through apio.') +
      '\n        ';
  }
}

// ─── Init ────────────────────────────────────────────────────────────────────
function initBoardEditor() {
  if (beInited) {
    return;
  }
  if (!pluginRoot || !$id('be-root')) {
    return;
  }
  beInited = true;

  wireToolbar();
  wireTabs();
  reloadBoards();
  newBoard();
  beTranslateUI();

  //-- Re-translate an already-open editor when the UI language changes.
  if (typeof $ !== 'undefined') {
    $(document).on('langChanged', beTranslateUI);
  }
}

function refreshBoardEditorEnv() {
  //-- Re-scan boards when the active project changes
  if (beInited) {
    reloadBoards();
  }
}

// ─── Toolbar + tabs wiring ───────────────────────────────────────────────────
function wireToolbar() {
  $id('be-new').addEventListener('click', newBoard);
  $id('be-clone').addEventListener('click', cloneBoard);
  $id('be-save').addEventListener('click', saveBoard);
  $id('be-delete').addEventListener('click', deleteBoard);
  $id('be-reload').addEventListener('click', onReloadOrRegenerate);
  $id('be-import-pcf').addEventListener('click', function () {
    $id('be-file').click();
  });
  $id('be-import-apio').addEventListener('click', importFromApio);
  $id('be-file').addEventListener('change', onPcfFileChosen);
  $id('be-modal-cancel').addEventListener('click', closeApioModal);
  $id('be-modal-import').addEventListener('click', doApioImport);
  $id('be-modal-filter').addEventListener('input', function () {
    renderApioList(this.value);
  });
  $id('be-filter').addEventListener('input', function () {
    renderList(this.value);
  });
  $id('be-devmode').addEventListener('change', function () {
    renderList($id('be-filter').value);
    applyReadOnlyState();
    updateNewBoardStatus();
  });
  $id('be-pin-add').addEventListener('click', function () {
    addPinRow({ name: '', value: '', type: 'inout' });
  });
  $id('be-rin-add').addEventListener('click', function () {
    addRuleInRow({ port: '', pin: '' });
  });
  $id('be-rout-add').addEventListener('click', function () {
    addRuleOutRow({ pin: '', bit: '' });
  });
}

function wireTabs() {
  $qsa('.be-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      var name = tab.getAttribute('data-tab');
      $qsa('.be-tab').forEach(function (t) {
        t.classList.toggle('be-tab-active', t === tab);
      });
      $qsa('.be-panel').forEach(function (p) {
        p.classList.toggle(
          'be-panel-active',
          p.getAttribute('data-panel') === name
        );
      });
    });
  });
}

// ─── Board list ──────────────────────────────────────────────────────────────
function reloadBoards() {
  var dir = projectDir();
  try {
    services().boards.loadBoards(dir || undefined);
  } catch (e) {
    console.error('boardEditor: loadBoards failed', e);
  }
  renderList($id('be-filter') ? $id('be-filter').value : '');
}

function allBoards() {
  return services().common.boards || [];
}

function renderList(filter) {
  var list = $id('be-list');
  if (!list) {
    return;
  }
  list.innerHTML = '';
  var f = (filter || '').toLowerCase();
  //-- Show the boards sorted alphabetically by their label (id as fallback).
  var boards = allBoards()
    .slice()
    .sort(function (a, b) {
      var la = ((a.info && a.info.label) || a.name).toLowerCase();
      var lb = ((b.info && b.info.label) || b.name).toLowerCase();
      return la < lb ? -1 : la > lb ? 1 : 0;
    });
  boards.forEach(function (board) {
    var label = (board.info && board.info.label) || board.name;
    if (f && (label + ' ' + board.name).toLowerCase().indexOf(f) === -1) {
      return;
    }
    var row = el('div', { 'class': 'be-list-item', 'data-name': board.name });
    if (beCurrent && beCurrent.name === board.name && !beIsNew) {
      row.classList.add('be-selected');
    }
    row.appendChild(el('span', { class: 'be-list-label' }, label));
    var badge = el(
      'span',
      { class: 'be-badge be-' + board.origin },
      board.origin === 'project' ? 'project' : 'dist'
    );
    row.appendChild(badge);
    if (board.readOnly) {
      row.appendChild(
        el(
          'span',
          { class: 'be-lock', title: gettextCatalog.getString('Read-only') },
          '🔒'
        )
      );
    }
    row.addEventListener('click', function () {
      selectBoardRow(board.name);
    });
    list.appendChild(row);
  });
}

function selectBoardRow(name) {
  var board = allBoards().filter(function (b) {
    return b.name === name;
  })[0];
  if (!board) {
    return;
  }
  beCurrent = board;
  beIsNew = false;
  loadForm(board);
  renderList($id('be-filter').value);
}

// ─── Form load / collect ─────────────────────────────────────────────────────
function loadForm(board) {
  var info = board.info || {};
  $id('f-name').value = board.name || '';
  $id('f-label').value = info.label || '';
  $id('f-mode').value = board.mode === 'custom' ? 'custom' : 'apio';
  $id('f-apio').value =
    board.apioBoard || (info.apio && info.apio.board) || board.name || '';
  $id('f-arch').value = info.arch || '';
  $id('f-fpga').value = info.fpga || '';
  $id('f-interface').value = info.interface || '';
  $id('f-clk').value = info.SysClkMhz != null ? info.SysClkMhz : '';
  $id('f-datasheet').value = info.datasheet || '';
  $id('f-group').value = info.group || info.type || '';

  var usb = info.usb || {};
  $id('f-usbvid').value = usb.vid || '';
  $id('f-usbpid').value = usb.pid || '';

  var res = info.FPGAResources || {};
  $id('f-ffs').value = res.ffs != null ? res.ffs : '';
  $id('f-luts').value = res.luts != null ? res.luts : '';
  $id('f-pios').value = res.pios != null ? res.pios : '';
  $id('f-plbs').value = res.plbs != null ? res.plbs : '';
  $id('f-brams').value = res.brams != null ? res.brams : '';

  //-- Pinout
  $id('be-pinout').querySelector('tbody').innerHTML = '';
  (board.pinout || []).forEach(addPinRow);

  //-- Rules
  $id('be-rules-in').querySelector('tbody').innerHTML = '';
  $id('be-rules-out').querySelector('tbody').innerHTML = '';
  var rules = board.rules || {};
  (rules.input || []).forEach(addRuleInRow);
  (rules.output || []).forEach(addRuleOutRow);

  //-- Commands (per action, per OS)
  loadCommands(info.commands || {});

  applyReadOnlyState();
  setStatus(
    board.origin === 'distribution'
      ? gettextCatalog.getString(
          'Distribution board (read-only unless developer mode)'
        )
      : gettextCatalog.getString('Project board'),
    board.origin === 'distribution' ? 'warn' : 'ok'
  );
}

function addPinRow(pin) {
  var tbody = $id('be-pinout').querySelector('tbody');
  var tr = el('tr');
  tr.appendChild(cellInput('pin-name', pin.name));
  tr.appendChild(cellInput('pin-value', pin.value));
  tr.appendChild(cellTypeSelect(pin.type));
  tr.appendChild(removeCell(tr));
  tbody.appendChild(tr);
}

function addRuleInRow(rule) {
  var tbody = $id('be-rules-in').querySelector('tbody');
  var tr = el('tr');
  tr.appendChild(cellInput('rin-port', rule.port));
  tr.appendChild(cellInput('rin-pin', rule.pin));
  tr.appendChild(removeCell(tr));
  tbody.appendChild(tr);
}

function addRuleOutRow(rule) {
  var tbody = $id('be-rules-out').querySelector('tbody');
  var tr = el('tr');
  tr.appendChild(cellInput('rout-pin', rule.pin));
  tr.appendChild(cellInput('rout-bit', rule.bit));
  tr.appendChild(removeCell(tr));
  tbody.appendChild(tr);
}

function cellInput(cls, value) {
  var td = el('td');
  var inp = el('input', { type: 'text', class: cls });
  inp.value = value != null ? value : '';
  td.appendChild(inp);
  return td;
}

function cellTypeSelect(value) {
  var td = el('td');
  var sel = el('select', { class: 'pin-type' });
  ['input', 'output', 'inout'].forEach(function (t) {
    var o = el('option', { value: t }, t);
    if (t === value) {
      o.setAttribute('selected', 'selected');
    }
    sel.appendChild(o);
  });
  td.appendChild(sel);
  return td;
}

function removeCell(tr) {
  var td = el('td');
  var btn = el('button', { class: 'be-btn be-small be-danger' }, '✕');
  btn.addEventListener('click', function () {
    tr.parentNode.removeChild(tr);
  });
  td.appendChild(btn);
  return td;
}

function collectForm() {
  var name = ($id('f-name').value || '').trim();
  var mode = $id('f-mode').value;

  var info = {
    label: $id('f-label').value.trim(),
    mode: mode,
  };
  var clk = $id('f-clk').value;
  if (clk !== '') {
    info.SysClkMhz = Number(clk);
  }
  if ($id('f-arch').value.trim()) {
    info.arch = $id('f-arch').value.trim();
  }
  if ($id('f-fpga').value.trim()) {
    info.fpga = $id('f-fpga').value.trim();
  }
  if ($id('f-interface').value.trim()) {
    info.interface = $id('f-interface').value.trim();
  }
  if ($id('f-datasheet').value.trim()) {
    info.datasheet = $id('f-datasheet').value.trim();
  }
  if ($id('f-group').value.trim()) {
    info.group = $id('f-group').value.trim();
  }
  if ($id('f-apio').value.trim()) {
    info.apio = { board: $id('f-apio').value.trim() };
  }
  var vid = $id('f-usbvid').value.trim();
  var pid = $id('f-usbpid').value.trim();
  if (vid || pid) {
    info.usb = {};
    if (vid) {
      info.usb.vid = vid;
    }
    if (pid) {
      info.usb.pid = pid;
    }
  }

  var res = {};
  [
    ['ffs', 'f-ffs'],
    ['luts', 'f-luts'],
    ['pios', 'f-pios'],
    ['plbs', 'f-plbs'],
    ['brams', 'f-brams'],
  ].forEach(function (pair) {
    var v = $id(pair[1]).value;
    if (v !== '') {
      res[pair[0]] = Number(v);
    }
  });
  if (Object.keys(res).length) {
    info.FPGAResources = res;
  }

  //-- Commands can be defined in any mode (combos). Empty actions are omitted
  //-- and fall back to apio (when mode === "apio").
  var commands = collectCommands();
  if (Object.keys(commands).length) {
    info.commands = commands;
  }

  var pinout = [];
  $qsa('#be-pinout tbody tr').forEach(function (tr) {
    var n = tr.querySelector('.pin-name').value.trim();
    if (!n) {
      return;
    }
    pinout.push({
      name: n,
      value: tr.querySelector('.pin-value').value.trim(),
      type: tr.querySelector('.pin-type').value,
    });
  });

  var rules = { input: [], output: [] };
  $qsa('#be-rules-in tbody tr').forEach(function (tr) {
    var port = tr.querySelector('.rin-port').value.trim();
    if (port) {
      rules.input.push({
        port: port,
        pin: tr.querySelector('.rin-pin').value.trim(),
      });
    }
  });
  $qsa('#be-rules-out tbody tr').forEach(function (tr) {
    var pin = tr.querySelector('.rout-pin').value.trim();
    if (pin) {
      rules.output.push({
        pin: pin,
        bit: tr.querySelector('.rout-bit').value.trim(),
      });
    }
  });

  return { name: name, info: info, pinout: pinout, rules: rules };
}

function linesToArray(text) {
  return String(text)
    .split(/\r?\n/)
    .map(function (s) {
      return s.trim();
    })
    .filter(function (s) {
      return s.length;
    });
}

// ─── Per-action / per-OS command editors ─────────────────────────────────────
var BE_ACTIONS = ['build', 'upload', 'verify', 'clean'];
var BE_OS = ['linux', 'darwin', 'windows'];

function cmdTa(action, os) {
  return $id('cmd-' + action + '-' + os);
}

//-- Populate the per-OS textareas from an info.commands object. A command
//-- spec can be a plain array (all OS) or an object keyed by OS.
function loadCommands(commands) {
  BE_ACTIONS.forEach(function (action) {
    var spec = commands[action];
    BE_OS.forEach(function (os) {
      var arr = [];
      if (Array.isArray(spec)) {
        arr = spec; //-- all-OS: show in every column
      } else if (spec && typeof spec === 'object') {
        arr = spec[os] || [];
      }
      cmdTa(action, os).value = (arr || []).join('\n');
    });
  });
}

//-- Build an info.commands object from the per-OS textareas. Empty actions
//-- are omitted (→ apio fallback). If the three OS are identical it is stored
//-- as a single all-OS array; otherwise as an object with the non-empty OS.
function collectCommands() {
  var out = {};
  BE_ACTIONS.forEach(function (action) {
    var perOs = {};
    var any = false;
    BE_OS.forEach(function (os) {
      var arr = linesToArray(cmdTa(action, os).value);
      if (arr.length) {
        perOs[os] = arr;
        any = true;
      }
    });
    if (!any) {
      return;
    }
    var l = JSON.stringify(perOs.linux || []);
    var d = JSON.stringify(perOs.darwin || []);
    var w = JSON.stringify(perOs.windows || []);
    if (perOs.linux && perOs.darwin && perOs.windows && l === d && d === w) {
      out[action] = perOs.linux; //-- identical across OS → all-OS array
    } else {
      out[action] = perOs;
    }
  });
  return out;
}

// ─── Read-only handling ──────────────────────────────────────────────────────
function isEditable() {
  if (beIsNew) {
    return true;
  }
  if (!beCurrent) {
    return true;
  }
  if (beCurrent.origin === 'project') {
    return true;
  }
  //-- distribution board: editable only in developer mode
  return $id('be-devmode').checked;
}

function applyReadOnlyState() {
  var editable = isEditable();
  $qsa('#be-editor input, #be-editor select, #be-editor textarea').forEach(
    function (n) {
      n.disabled = !editable;
    }
  );
  //-- The board id of an existing board is never editable (it is the folder)
  if (!beIsNew) {
    $id('f-name').disabled = true;
  }
  $id('be-save').disabled = !editable;
  $id('be-delete').disabled = !(
    beCurrent &&
    beCurrent.origin === 'project' &&
    !beIsNew
  );
}

// ─── Actions ─────────────────────────────────────────────────────────────────
function newBoard() {
  beIsNew = true;
  beCurrent = {
    name: '',
    origin: 'project',
    mode: 'apio',
    info: { label: '', mode: 'apio', group: 'PROJECT' },
    pinout: [],
    rules: { input: [], output: [] },
  };
  loadForm(beCurrent);
  $id('f-name').disabled = false;
  updateNewBoardStatus();
  renderList($id('be-filter').value);
}

//-- Status hint for a new (unsaved) board: in developer mode it will be saved
//-- as a distribution board and added to the Select→Board menu; otherwise it
//-- goes into the active project's boards folder.
function updateNewBoardStatus() {
  if (!beIsNew) {
    return;
  }
  if (devModeOn()) {
    setStatus(
      gettextCatalog.getString(
        'New board — developer mode: will be saved as a DISTRIBUTION board and added to the boards menu'
      ),
      'warn'
    );
  } else {
    setStatus(
      gettextCatalog.getString(
        'New board (will be saved into the project boards folder)'
      ),
      'ok'
    );
  }
}

function cloneBoard() {
  var src = collectForm();
  beIsNew = true;
  beCurrent = { name: '', origin: 'project', mode: src.info.mode };
  src.name = '';
  src.info.label = (src.info.label || '') + ' (copy)';
  //-- reuse the collected data by re-rendering from a synthetic board
  loadForm({
    name: '',
    origin: 'project',
    mode: src.info.mode,
    apioBoard: $id('f-apio').value,
    info: src.info,
    pinout: src.pinout,
    rules: src.rules,
  });
  $id('f-name').disabled = false;
  $id('f-name').focus();
  setStatus(
    gettextCatalog.getString('Cloned — set a new board id and Save'),
    'ok'
  );
}

function validBoardName(name) {
  return /^[A-Za-z0-9._-]+$/.test(name);
}

function saveBoard() {
  if (!isEditable()) {
    alertify.error(
      gettextCatalog.getString(
        'This board is read-only. Enable developer mode or clone it.'
      )
    );
    return;
  }
  var data = collectForm();
  if (!data.name) {
    alertify.error(gettextCatalog.getString('Board id is required'));
    return;
  }
  if (!validBoardName(data.name)) {
    alertify.error(
      gettextCatalog.getString('Invalid board id (use letters, numbers, . _ -)')
    );
    return;
  }
  if (!data.pinout.length) {
    alertify.error(gettextCatalog.getString('The pinout cannot be empty'));
    return;
  }

  //-- A new board in developer mode becomes a distribution board; otherwise a
  //-- new board needs a saved project to host the project boards folder.
  var toDistribution = savesToDistribution();
  var dir = targetDir({ name: data.name, origin: beCurrent.origin }, beIsNew);
  if (!dir) {
    alertify.error(
      gettextCatalog.getString(
        'Save the project first to create project boards'
      )
    );
    return;
  }

  //-- Prevent accidental overwrite of a different existing board on "new"
  if (beIsNew && nodeFs.existsSync(dir)) {
    alertify.error(
      gettextCatalog
        .getString('A board with id "{id}" already exists')
        .replace('{id}', data.name)
    );
    return;
  }

  try {
    nodeFs.mkdirSync(dir, { recursive: true });
    writeJSON(nodePath.join(dir, 'info.json'), data.info);
    writeJSON(nodePath.join(dir, 'pinout.json'), data.pinout);
    writeJSON(nodePath.join(dir, 'rules.json'), data.rules);

    //-- Saving a distribution board (new or edited in developer mode): rebuild
    //-- menu.json from the boards folder so the board appears and any family
    //-- (group/arch) change is reflected. If the board does not resolve to a
    //-- supported family it is left out of the menu — warn so the author sets
    //-- Arch / FPGA family (Group).
    if (toDistribution) {
      var menu = regenerateMenu();
      var listed = menu.some(function (g) {
        return g.boards.indexOf(data.name) !== -1;
      });
      if (!listed) {
        alertify.warning(
          gettextCatalog.getString(
            'Board saved but not shown in the menu: set a supported Arch and FPGA family (Group).'
          )
        );
      }
    }
  } catch (e) {
    alertify.error(
      gettextCatalog
        .getString('Save failed: {error}')
        .replace('{error}', e.message)
    );
    return;
  }

  alertify.success(
    (toDistribution
      ? gettextCatalog.getString('Board "{id}" saved (distribution)')
      : gettextCatalog.getString('Board "{id}" saved')
    ).replace('{id}', data.name)
  );
  beIsNew = false;
  refreshHost(data.name);
}

function deleteBoard() {
  if (!beCurrent || beCurrent.origin !== 'project' || beIsNew) {
    return;
  }
  var name = beCurrent.name;
  alertify.confirm(
    gettextCatalog
      .getString('Delete project board "{id}"? This removes its folder.')
      .replace('{id}', name),
    function () {
      var dir = nodePath.join(projectDir(), 'boards', name);
      try {
        rmrf(dir);
      } catch (e) {
        alertify.error(
          gettextCatalog
            .getString('Delete failed: {error}')
            .replace('{error}', e.message)
        );
        return;
      }
      alertify.success(
        gettextCatalog.getString('Board "{id}" deleted').replace('{id}', name)
      );
      refreshHost(null);
      newBoard();
    },
    function () {}
  );
}

function writeJSON(file, obj) {
  nodeFs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function rmrf(dir) {
  //-- Node >= 14: rmSync recursive
  if (nodeFs.rmSync) {
    nodeFs.rmSync(dir, { recursive: true, force: true });
  } else {
    nodeFs.rmdirSync(dir, { recursive: true });
  }
}

//-- Reload host boards and keep the host UI in sync
function refreshHost(selectName) {
  var svc = services();
  try {
    svc.boards.loadBoards(projectDir() || undefined);
    if (selectName && svc.common.selectedBoard) {
      //-- If the edited board is the one currently selected in the host,
      //-- re-select it so the pinout dropdowns refresh
      if (svc.common.selectedBoard.name === selectName) {
        svc.boards.selectBoard(selectName);
      }
    }
    svc.utils.rootScopeSafeApply();
  } catch (e) {
    console.error('boardEditor: refreshHost failed', e);
  }
  reloadBoards();
  if (selectName) {
    selectBoardRow(selectName);
  }
}

// ─── PCF import ──────────────────────────────────────────────────────────────
function onPcfFileChosen(ev) {
  var file = ev.target.files && ev.target.files[0];
  ev.target.value = '';
  if (!file) {
    return;
  }
  try {
    var text = nodeFs.readFileSync(file.path, 'utf8');
    var pins = parseConstraint(file.name, text);
    var tbody = $id('be-pinout').querySelector('tbody');
    tbody.innerHTML = '';
    pins.forEach(addPinRow);
    setStatus(
      gettextCatalog
        .getString('Imported {n} pins from {file}')
        .replace('{n}', pins.length)
        .replace('{file}', file.name),
      'ok'
    );
    //-- jump to the pinout tab
    $qsa('.be-tab').forEach(function (t) {
      if (t.getAttribute('data-tab') === 'pinout') {
        t.click();
      }
    });
  } catch (e) {
    alertify.error(
      gettextCatalog
        .getString('Import failed: {error}')
        .replace('{error}', e.message)
    );
  }
}

// ─── Apio import ─────────────────────────────────────────────────────────────
var beApioBoards = []; //-- cached parsed apio boards
var beApioSelected = null; //-- currently selected board in the modal

//-- Apio home directory (contains the packages folder)
function apioHomeDir() {
  var home = (services().common && services().common.APIO_HOME) || '';
  if (!home && appEnv && appEnv.APIO_HOME) {
    home = appEnv.APIO_HOME;
  }
  return home;
}

//-- Directory holding apio's machine-readable definitions
function apioDefsDir() {
  return nodePath.join(apioHomeDir(), 'packages', 'definitions');
}

//-- Find a constraint file in apio's example project for a board and parse
//-- it into a pinout. Apio examples (examples/<board-id>/<example>/) ship a
//-- .pcf (ice40), .lpf (ecp5) or .cst (gowin) file. These are usually the
//-- minimal pins used by the example (e.g. clk + led), not the full board
//-- pinout, but provide a useful starting point. Returns { pins, file } or
//-- null.
function findApioExampleConstraint(boardId) {
  var base = nodePath.join(apioHomeDir(), 'packages', 'examples', boardId);
  var subdirs;
  try {
    subdirs = nodeFs.readdirSync(base);
  } catch (e) {
    return null;
  }
  var best = null;
  subdirs.forEach(function (sub) {
    var subPath = nodePath.join(base, sub);
    var files;
    try {
      if (!nodeFs.statSync(subPath).isDirectory()) {
        return;
      }
      files = nodeFs.readdirSync(subPath);
    } catch (e) {
      return;
    }
    files.forEach(function (f) {
      if (!/\.(pcf|lpf|cst)$/i.test(f)) {
        return;
      }
      try {
        var text = nodeFs.readFileSync(nodePath.join(subPath, f), 'utf8');
        var pins = parseConstraint(f, text);
        //-- Keep the constraint file that yields the most pins
        if (pins.length && (!best || pins.length > best.pins.length)) {
          best = { pins: pins, file: sub + '/' + f };
        }
      } catch (e) {
        //-- ignore unreadable file
      }
    });
  });
  return best;
}

//-- Strip JSONC comments (string-aware) and trailing commas, then JSON.parse
function parseJsonc(text) {
  var out = '';
  var i = 0;
  var inStr = false;
  var quote = '';
  var esc = false;
  while (i < text.length) {
    var c = text[i];
    var n = text[i + 1];
    if (inStr) {
      out += c;
      if (esc) {
        esc = false;
      } else if (c === '\\') {
        esc = true;
      } else if (c === quote) {
        inStr = false;
      }
      i++;
      continue;
    }
    if (c === '"') {
      inStr = true;
      quote = c;
      out += c;
      i++;
      continue;
    }
    if (c === '/' && n === '/') {
      while (i < text.length && text[i] !== '\n') {
        i++;
      }
      continue;
    }
    if (c === '/' && n === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++;
      }
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  return JSON.parse(out);
}

//-- Load apio boards from boards.jsonc + fpgas.jsonc (arch resolution)
function loadApioBoards() {
  var dir = apioDefsDir();
  var boards = parseJsonc(
    nodeFs.readFileSync(nodePath.join(dir, 'boards.jsonc'), 'utf8')
  );
  var fpgas = {};
  try {
    fpgas = parseJsonc(
      nodeFs.readFileSync(nodePath.join(dir, 'fpgas.jsonc'), 'utf8')
    );
  } catch (e) {
    fpgas = {};
  }
  return Object.keys(boards).map(function (id) {
    var b = boards[id];
    var fpga = fpgas[b['fpga-id']] || {};
    var usb = b.usb || {};
    return {
      id: id,
      label: b.description || b['legacy-name'] || id,
      fpgaId: b['fpga-id'] || '',
      arch: fpga.arch || '',
      programmer: (b.programmer && b.programmer.id) || '',
      usbVid: usb.vid || '',
      usbPid: usb.pid || '',
    };
  });
}

function importFromApio() {
  try {
    beApioBoards = loadApioBoards();
  } catch (e) {
    alertify.error(
      gettextCatalog
        .getString('Could not read apio board definitions: {error}')
        .replace('{error}', e.message)
    );
    return;
  }
  if (!beApioBoards.length) {
    alertify.error(gettextCatalog.getString('No apio boards found'));
    return;
  }
  beApioBoards.sort(function (a, b) {
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  openApioModal();
}

function openApioModal() {
  beApioSelected = null;
  $id('be-modal-import').disabled = true;
  $id('be-modal-filter').value = '';
  renderApioList('');
  $id('be-modal').style.display = 'flex';
  $id('be-modal-filter').focus();
}

function closeApioModal() {
  $id('be-modal').style.display = 'none';
}

function renderApioList(filter) {
  var list = $id('be-modal-list');
  list.innerHTML = '';
  var f = (filter || '').toLowerCase();
  var shown = 0;
  //-- Flat searchable list: show the apio boards sorted alphabetically by id.
  var boards = beApioBoards.slice().sort(function (a, b) {
    return String(a.id).localeCompare(String(b.id));
  });
  boards.forEach(function (b) {
    if (f && (b.id + ' ' + b.label).toLowerCase().indexOf(f) === -1) {
      return;
    }
    shown++;
    var row = el('div', { 'class': 'be-modal-item', 'data-id': b.id });
    if (beApioSelected && beApioSelected.id === b.id) {
      row.classList.add('be-selected');
    }
    row.appendChild(el('span', { class: 'be-mi-id' }, b.id));
    row.appendChild(el('span', { class: 'be-mi-desc' }, b.label));
    if (b.arch) {
      row.appendChild(el('span', { class: 'be-mi-arch' }, b.arch));
    }
    row.addEventListener('click', function () {
      beApioSelected = b;
      $id('be-modal-import').disabled = false;
      renderApioList($id('be-modal-filter').value);
    });
    row.addEventListener('dblclick', function () {
      beApioSelected = b;
      doApioImport();
    });
    list.appendChild(row);
  });
  $id('be-modal-count').textContent = gettextCatalog
    .getString('{shown} / {total} boards')
    .replace('{shown}', shown)
    .replace('{total}', beApioBoards.length);
}

function doApioImport() {
  if (!beApioSelected) {
    return;
  }
  var b = beApioSelected;

  //-- Start from a fresh new (editable) board, then prefill from apio.
  newBoard();
  $id('f-name').value = b.id;
  $id('f-label').value = b.label;
  $id('f-apio').value = b.id;
  $id('f-mode').value = 'apio';
  if (b.arch) {
    $id('f-arch').value = b.arch;
  }
  if (b.fpgaId) {
    $id('f-fpga').value = b.fpgaId;
  }
  if (b.usbVid) {
    $id('f-usbvid').value = b.usbVid;
  }
  if (b.usbPid) {
    $id('f-usbpid').value = b.usbPid;
  }

  //-- Apio has no full pinout DB, but its example projects ship a constraint
  //-- file (.pcf/.lpf/.cst). Use it as a starting pinout if available.
  var constraint = findApioExampleConstraint(b.id);
  if (constraint && constraint.pins.length) {
    var tbody = $id('be-pinout').querySelector('tbody');
    tbody.innerHTML = '';
    constraint.pins.forEach(addPinRow);
  }

  closeApioModal();
  if (constraint && constraint.pins.length) {
    setStatus(
      gettextCatalog
        .getString(
          'Imported "{id}" with {n} pins from apio example ({file}) — may be partial, review and Save'
        )
        .replace('{id}', b.id)
        .replace('{n}', constraint.pins.length)
        .replace('{file}', constraint.file),
      'ok'
    );
  } else {
    setStatus(
      gettextCatalog
        .getString(
          'Imported "{id}" from apio (no example pinout found) — add the pinout and Save'
        )
        .replace('{id}', b.id),
      'warn'
    );
  }
}

// ─── Boot ────────────────────────────────────────────────────────────────────
//-- Subscribe to environment updates (appEnv is only needed by the apio import)
registerEvents();

//-- The UI is driven by the Angular injector, not by appEnv, so initialize it
//-- right away instead of waiting for the (request-based) env event.
initBoardEditor();

//-- Request the plugin environment so appEnv gets populated for "Import from
//-- apio". The plugin manager replies by publishing 'pluginManager.env'.
iceStudio.bus.events.publish('pluginManager.getEnvironment');
