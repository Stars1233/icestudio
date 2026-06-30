//---------------------------------------------------------------------------
//-- Profile managment
//--
//-- Methods, data and constants for managing the Icestudio profile file
//---------------------------------------------------------------------------
'use strict';

angular
  .module('icestudio')
  .service('profile', function (utils, common, _package, nodeFs) {
    //-- Information stored in the profile file
    this.data = {
      board: '', //-- Selected board
      boardRules: true, //-- Boardrules (active by default)
      allowInoutPorts: false, //-- Tri-state (inout ports) available (not included by default)
      collection: '', //-- Selected collection
      externalCollections: '', //-- Path for the external collections
      externalPlugins: '', //-- Path for the external paths
      language: '', //-- Current selected language
      uiTheme: 'light', //-- Theme
      remoteHostname: '',
      showFPGAResources: false,
      loggingEnabled: false,
      loggingFile: '',
      displayVersionInfoWindow: 'yes',
      lastVersionReview: false, //-- Base version whose notes were last reviewed
      pythonEnv: { python: '', pip: '' },
      recentProjects: [],
      apioChannel: 'stable', //-- Apio toolchain channel: 'stable' | 'ci'
      setupWizardDone: false, //-- First-run setup wizard completed or dismissed
      //-- Per-action tool preferences (Verify/Build/Upload), set from the
      //-- Tools > Preferences panel. Shape: { verify: {...}, build: {...},
      //-- upload: {...} }. Kept as a free object so new options can be added
      //-- without touching the profile schema.
      toolPreferences: {},
    };

    //-- Property added to the MACs
    if (common.DARWIN) {
      this.data['macosFTDIDrivers'] = false;
    }

    //-- Load the Profile file
    //-- The profile path is in the common.PROFILE_PATH global object
    this.load = function (callback) {
      var self = this;

      utils
        //-- Read the profile file....
        .readFile(common.PROFILE_PATH)

        //-- Store the values from the file into the common.data global object
        .then(function (data) {
          self.data = {
            board: data.board || '',
            boardRules: data.boardRules !== false,
            allowInoutPorts: data.allowInoutPorts === true,
            collection: data.collection || '',
            language: data.language || 'en',
            uiTheme: data.uiTheme || 'dark',
            externalCollections: data.externalCollections || '',
            externalPlugins: data.externalPlugins || '',
            remoteHostname: data.remoteHostname || '',
            showFPGAResources: data.showFPGAResources || false,
            displayVersionInfoWindow: data.displayVersionInfoWindow || 'yes',
            lastVersionReview: data.lastVersionReview || false,
            loggingEnabled: data.loggingEnabled || false,
            loggingFile: data.loggingFile || '',
            pythonEnv: data.pythonEnv || { python: '', pip: '' },
            recentProjects: data.recentProjects || [],
            apioChannel: data.apioChannel || 'stable',
            setupWizardDone: data.setupWizardDone === true,
            toolPreferences: data.toolPreferences || {},
          };

          if (self.data.pythonEnv.python.length > 0) {
            common.PYTHON_ENV = self.data.pythonEnv.python;
            common.PYTHON_PIP_ENV = self.data.pythonEnv.pip;
          }

          // Make variable uiTheme as global for use in "joint.shapes.js"
          global.uiTheme = self.data.uiTheme;

          //-- Custom Theme support
          //-- pHead uiTheme css sanitization
          let uiThemeEl = document.getElementById('uiTheme');
          if (uiThemeEl) {
            uiThemeEl.remove();
          }
          //-- Dark Theme:
          if (self.data.uiTheme === 'dark') {
            let cssFile =
              '<link id="uiTheme" rel="stylesheet" href="resources/uiThemes/dark/dark.css">';
            let pHead = document.getElementsByTagName('head')[0];
            pHead.innerHTML = pHead.innerHTML + cssFile;
          }
          //-- Light Theme: same as the original!
          if (self.data.uiTheme === 'light') {
            let cssFile =
              '<link id="uiTheme" rel="stylesheet" href="resources/uiThemes/light/light.css">';
            let pHead = document.getElementsByTagName('head')[0];
            pHead.innerHTML = pHead.innerHTML + cssFile;
          }
          //-- End Custom Theme support

          if (common.DARWIN) {
            self.data['macosFTDIDrivers'] = data.macosFTDIDrivers || false;
          }
          if (callback) {
            callback();
          }
          let env = common;
          env.profile = self.data;
          if (!iceStudio.isInitialized()) {
            iceStudio.init(env);
          }
          //-- Keep this window's profile in sync with changes from others.
          self.startWatching();
        })
        .catch(function (error) {
          console.warn(error);
          if (callback) {
            callback();
          }
        });
    };

    //-- Set the value of a profile property in the profile file
    //-- Keys changed in THIS window since they were last persisted. save()
    //-- writes only these, so a save here never clobbers keys another window
    //-- may have changed in the shared profile file meanwhile.
    var dirtyKeys = new Set();

    this.set = function (key, value) {
      //-- The given property name is valid...
      if (this.data.hasOwnProperty(key)) {
        //-- Store the value
        this.data[key] = value;
        dirtyKeys.add(key);

        //-- Save into the profile file;
        this.save();
      }
    };

    //-- Read a value from the profile data structure
    this.get = function (key) {
      return this.data[key];
    };

    //------------------------------------------------
    //-- Save the current data to the profile file
    //--
    this.save = function () {
      //-- if no .icestudio folder, create a new one
      if (!nodeFs.existsSync(common.ICESTUDIO_DIR)) {
        nodeFs.mkdirSync(common.ICESTUDIO_DIR);
      }
      var self = this;
      var keys = [];
      dirtyKeys.forEach(function (k) {
        keys.push(k);
      });
      //-- Atomically merge ONLY the changed keys into the on-disk profile, so a
      //-- concurrent write from another window (to other keys) is preserved.
      utils
        .updateFileAtomic(common.PROFILE_PATH, function (current) {
          var base = null;
          if (current) {
            try {
              base = JSON.parse(current);
            } catch (e) {
              base = null;
            }
          }
          if (!base || typeof base !== 'object') {
            //-- First run / unreadable file: write the full profile.
            base = self.data;
          } else {
            keys.forEach(function (k) {
              base[k] = self.data[k];
            });
          }
          return JSON.stringify(base, null, 2);
        })
        .then(function () {
          keys.forEach(function (k) {
            dirtyKeys.delete(k);
          });
          common.profile = self.data;
          iceStudio.updateEnv(common);
        })
        .catch(function (error) {
          //-- Leave the keys dirty so a later save retries them.
          alertify.error(error, 30);
        });
    };

    //-- Watch the shared profile file: when another window writes it, merge the
    //-- changed keys into THIS window's live data (skipping keys this window has
    //-- pending) so every open window stays consistent. Best-effort.
    var watching = false;
    var watchTimer = null;

    this.startWatching = function () {
      if (watching) {
        return;
      }
      var self = this;

      function reloadAndMerge() {
        var content;
        try {
          content = nodeFs.readFileSync(common.PROFILE_PATH, 'utf8');
        } catch (e) {
          return;
        }
        var parsed = null;
        try {
          parsed = JSON.parse(content);
        } catch (e) {
          parsed = null;
        }
        if (!parsed || typeof parsed !== 'object') {
          return;
        }
        var changed = false;
        Object.keys(parsed).forEach(function (k) {
          //-- Skip keys not in our schema and keys with pending local changes.
          if (!self.data.hasOwnProperty(k) || dirtyKeys.has(k)) {
            return;
          }
          if (JSON.stringify(self.data[k]) !== JSON.stringify(parsed[k])) {
            self.data[k] = parsed[k];
            changed = true;
          }
        });
        if (changed) {
          common.profile = self.data;
          if (typeof iceStudio !== 'undefined' && iceStudio.updateEnv) {
            iceStudio.updateEnv(common);
          }
          utils.rootScopeSafeApply();
        }
      }

      try {
        nodeFs.watch(common.PROFILE_PATH, function () {
          if (watchTimer) {
            clearTimeout(watchTimer);
          }
          watchTimer = setTimeout(reloadAndMerge, 150);
        });
        watching = true;
      } catch (e) {
        //-- If the watcher can't be set up, skip live cross-window sync.
      }
    };
  });
