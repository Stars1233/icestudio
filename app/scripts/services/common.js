//----------------------------------------------------------------------------
//-- This module defines the global data structures used in Icestudio
//-- The different Icestudio modules get this information and store it
//-- in the common module, so that it is always available to the rest
//-- of modules
//----------------------------------------------------------------------------
'use strict';

angular.module('icestudio').service(
  'common',
  function (
    //-- node Path module
    //-- More info: https://nodejs.org/docs/latest-v17.x/api/path.html
    nodePath,

    //-- Create temporary files and directories
    //-- More info: https://www.npmjs.com/package/tmp
    nodeTmp,
    nodeFs,
    _package
  ) {
    // Project version. It defines the current structure for the
    // icestudio projects (Both in memory and on the .ice files)
    this.VERSION = '1.2';

    //-- Format a resource-usage percentage (used/total*100) for the footer
    //-- FPGA resources display. Returns '-' when the values are not valid
    //-- numbers (e.g. an unparsed field on the first synthesis), avoiding the
    //-- "NaN%" a raw division would otherwise produce.
    this.pct = function (used, total) {
      var u = parseFloat(used);
      var t = parseFloat(total);
      if (!isFinite(u) || !isFinite(t) || t <= 0) {
        return '-';
      }
      return ((u / t) * 100).toFixed(1);
    };

    // Project status: Has it change from the previous build or not?
    this.hasChangesSinceBuild = false;
    // Tri-state ports: Are they present in any opened designs or blocks, and is this approved?
    //                  (User profile "allowInoutPorts" is false)
    this.allowProjectInoutPorts = false;

    // All project dependencies
    this.allDependencies = {};

    //-- Set of content-addressed dependency ids of every block in the
    //-- installed collections. Built lazily by the `collections` service
    //-- (isCollectionBlock) and invalidated (null) on a collection rescan.
    this.collectionBlockIds = null;

    // Selected board
    this.boards = []; //-- Array with the board objects. Initialized with the boards.loadBoards() function
    this.selectedBoard = null; //-- Board object. Current board used
    this.pinoutInputHTML = '';
    this.pinoutOutputHTML = '';

    // Selected collection
    this.defaultCollection = null;
    this.internalCollections = [];
    this.externalCollections = [];
    this.selectedCollection = null;

    // FPGA resources
    this.FPGAResources = {
      ffs: '-',
      luts: '-',
      pios: '-',
      plbs: '-',
      brams: '-',
    };

    // Debug mode (uncomment)
    this.DEBUGMODE = 1;

    // Command output
    this.commandOutput = '';

    // Operating system: true/false
    this.LINUX = Boolean(process.platform.indexOf('linux') > -1);
    this.WIN32 = Boolean(process.platform.indexOf('win32') > -1);
    this.DARWIN = Boolean(process.platform.indexOf('darwin') > -1);

    //----------------------------------------
    //--  Icestudio app folder
    //--     |---> resources/locale: Translation files
    //--     |---> resources/sample: Folder for testing
    //--     |---> resources/collection: Default collection
    //--     |---> resources/plugin:  Plugins

    //-- Locale DIR: Translation files
    this.LOCALE_DIR = nodePath.join('resources', 'locale');

    //-- Sample DIR: just for testing apio
    this.SAMPLE_DIR = nodePath.join('resources', 'sample');

    //-- The default collection is stored in this Folder
    this.DEFAULT_COLLECTION_DIR = nodePath.resolve(
      nodePath.join('resources', 'collection')
    );

    //-- Folder for the system plugins
    this.DEFAULT_PLUGIN_DIR = nodePath.resolve(
      nodePath.join('resources', 'plugins')
    );

    //-- Path were the executale is run
    this.APP_DIR = nodePath.dirname(process.execPath);

    //-- Icestudio APP dir
    this.APP = process.cwd();

    //----------------------------------------------------
    //-- User/system Home folder (BASE_DIR)
    //--   |---> icestudio.log : Log file (debugging)
    //--   |---> .icestudio : Icestudio folder
    //--   |---> .icestudio/collections: Installed collections
    //--   |---> .icestudio/apio : Apio packages installed in this folder
    //--   |---> .icestudio/apio-bundle: Apio bundle (executable + libs)
    //--   |---> .icestudio/profile.json
    //--
    this.ICESTUDIO_HOME =
      this.WIN32 && process.arch === 'ia32' ? 'icestudio_home' : '.icestudio';
    this.BASE_DIR = process.env.HOME || process.env.USERPROFILE;
    this.LOGFILE =
      process.env.ICESTUDIO_LOGFILE ||
      nodePath.join(this.BASE_DIR, 'icestudio.log');
    this.ICESTUDIO_DIR =
      process.env.ICESTUDIO_DIR ||
      nodePath.join(this.BASE_DIR, this.ICESTUDIO_HOME);

    this.INTERNAL_COLLECTIONS_DIR = nodePath.join(
      this.ICESTUDIO_DIR,
      'collections'
    );

    //-- OS "Documents" folder, used to propose a default location for the
    //-- user (external) collections. It adapts to each operating system.
    this.DOCUMENTS_DIR = (function (base, isLinux) {
      //-- On Linux honor the XDG user-dirs setting when it is exported
      if (isLinux && process.env.XDG_DOCUMENTS_DIR) {
        return process.env.XDG_DOCUMENTS_DIR;
      }
      let docs = nodePath.join(base, 'Documents');
      try {
        if (nodeFs.existsSync(docs)) {
          return docs;
        }
      } catch (e) {
        // Ignore and fall back below
      }
      //-- Windows/macOS always have a "Documents" folder; on a minimal Linux
      //-- it may be missing, in which case fall back to the home folder.
      return isLinux ? base : docs;
    })(this.BASE_DIR, this.LINUX);

    //-- Default folder proposed (and created) for the external collections.
    //-- The user installs and creates indexable collections inside it.
    this.DEFAULT_EXTERNAL_COLLECTIONS_DIR = nodePath.join(
      this.DOCUMENTS_DIR,
      'Icestudio',
      'collections'
    );

    this.APIO_HOME = nodePath.join(this.ICESTUDIO_DIR, 'apio');
    this.PROFILE_PATH = nodePath.join(this.ICESTUDIO_DIR, 'profile.json');

    // Apio bundle directory
    this.APIO_BUNDLE_DIR = nodePath.join(this.ICESTUDIO_DIR, 'apio-bundle');

    // Apio executable inside the bundle
    this.APIO_EXE = nodePath.join(
      this.APIO_BUNDLE_DIR,
      this.WIN32 ? 'apio.exe' : 'apio'
    );

    // Bundle file extension per platform
    this.APIO_BUNDLE_EXT = this.WIN32 ? 'zip' : 'tgz';

    // Platform identifier for bundle download URL
    this.getApioPlatformBundle = function () {
      if (this.DARWIN) {
        return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x86-64';
      } else if (this.LINUX) {
        return 'linux-x86-64';
      } else if (this.WIN32) {
        return 'windows-amd64';
      }
      return null;
    };

    this.CACHE_DIR = nodePath.join(this.ICESTUDIO_DIR, '.cache');
    this.IMAGE_CACHE_DIR = nodePath.join(this.CACHE_DIR, 'images');
    this.OLD_BUILD_DIR = nodePath.join(this.ICESTUDIO_DIR, '.build');

    //-- Get the Icestudio Version
    this.ICESTUDIO_VERSION = _package.version;

    //-- Set the apio command. It sets the APIO_HOME environment variable
    //-- (used by apio to locate its package installation) and invokes the
    //-- bundled apio executable directly.
    //--
    //-- EXAMPLE FOR Linux/macOS:
    //-- APIO_CMD = APIO_HOME="/home/obijuan/.icestudio/apio"
    //--            "/home/obijuan/.icestudio/apio-bundle/apio"
    //--
    //-- EXAMPLE FOR Windows:
    //-- APIO_CMD = set "APIO_HOME=C:\Users\Obijuan\.icestudio\apio"&
    //--            "C:\Users\Obijuan\.icestudio\apio-bundle\apio.exe"
    //--
    //-- NOTICE (Windows): the quotes MUST wrap the whole assignment
    //-- (set "VAR=value"), NOT just the value (set VAR="value"). CMD's `set`
    //-- keeps everything after '=' verbatim, so `set VAR="value"` stores the
    //-- quotes INSIDE the value: APIO_HOME would become `"C:\...\apio"` (with
    //-- quotes) and apio then fails to locate its packages dir. The
    //-- set "VAR=value" form both handles spaces in the path AND keeps the
    //-- quotes out of the value (bash strips them on Linux/macOS, hence those
    //-- platforms were unaffected).
    //-- IMPORTANT: There must be NO SPACE between the value and '&' — a trailing
    //-- space would be included in the variable value.

    if (this.WIN32) {
      //-- Apio execution command for Windows machines
      this.APIO_CMD =
        'set "APIO_HOME=' + this.APIO_HOME + '"& "' + this.APIO_EXE + '"';
    } else {
      //-- Apio execution command for Linux/macOS machines
      this.APIO_CMD =
        'APIO_HOME="' + this.APIO_HOME + '" "' + this.APIO_EXE + '"';
    }

    this.BUILD_DIR_OBJ = new nodeTmp.dirSync({
      prefix: 'icestudio-',
      unsafeCleanup: true,
    });
    this.BUILD_DIR = this.BUILD_DIR_OBJ.name;
    this.BUILD_DIR_TMP = this.BUILD_DIR_OBJ.name;

    this.PATTERN_PORT_LABEL =
      /^\s*(@*[A-Za-z_][A-Za-z_$0-9]*)?\s*(\[\s*([A-Za-z_$0-9+\-*/]+)\s*:\s*([A-Za-z_$0-9+\-*/]+)\s*\])?\s*$/;
    this.PATTERN_PARAM_LABEL = /^([A-Za-z_][A-Za-z_$0-9]*)?$/;

    //-- Check the port names. Ex. a[1:0], b
    this.PATTERN_GLOBAL_PORT_LABEL =
      /^([^\[\]]+)?(\[\s*([A-Za-z_$0-9+\-*/]+)\s*:\s*([A-Za-z_$0-9+\-*/]+)\s*\])?$/;
    this.PATTERN_GLOBAL_PARAM_LABEL = /^([^\[\]]+)?$/;

    this.setBuildDir = function (buildpath) {
      let fserror = false;
      if (!nodeFs.existsSync(buildpath)) {
        try {
          nodeFs.mkdirSync(buildpath, { recursive: true });
        } catch (e) {
          fserror = true;
        }
      }
      if (!fserror) {
        this.BUILD_DIR = buildpath;
      } else {
        this.BUILD_DIR = this.BUILD_DIR_TMP;
      }
    };

    this.showToolchain = function () {
      return (
        (this.selectedBoard && this.selectedBoard.info.interface !== 'GPIO') ||
        false
      );
    };

    this.showDrivers = function () {
      return (
        (this.selectedBoard &&
          (this.selectedBoard.info.interface === 'FTDI' ||
            this.selectedBoard.info.interface === 'Serial')) ||
        false
      );
    };

    this.isEditingSubmodule = false;

    //-- True while the block currently being viewed is a shielded collection
    //-- block (read-only). Drives the padlock visibility, independently of
    //-- isEditingSubmodule. A local block or a fork sets this to false (no
    //-- padlock).
    this.currentBlockIsCollection = false;

    let storage = new IceHD();
    if (!storage.isValidPath(this.ICESTUDIO_DIR)) {
      storage.mkDir(this.ICESTUDIO_DIR);
    }

    //-- Create the Cache dir
    //-- If it was not previously created
    storage.mkDir(this.CACHE_DIR);

    //-- Create the Image Cache dir
    //-- If it was not previously created
    storage.mkDir(this.IMAGE_CACHE_DIR);
  }
);
