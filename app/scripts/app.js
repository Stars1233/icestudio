//---------------------------------------------------------------------------
//-- ICESTUDIO Main entry point
//---------------------------------------------------------------------------
//-- External packages used:
//--
//--  * Alertify: https://www.npmjs.com/package/alertifyjs
//--     Developing pretty browser dialogs and notifications
//---------------------------------------------------------------------------
'use strict';

//-- Global Icestudio
//-- This is the core system with services, api and communications.
//-- Group inside different object for efficiency model by V8 engine.
//-- The global variable should be declared as "var" and not "let"
//-- because it is accessible from popups windows
/* jshint -W098 */
var iceStudio = new Icestudio();

//-- Global CONSOLE. Used for Debugging
//-- The log file by default is "icestudio.log", located in the
//-- user home folder
var iceConsole = new IceLogger();
var iceStudioReady = false;

angular.module('icestudio', ['ui.bootstrap', 'ngRoute', 'gettext']).run(
  function (
    profile, //-- Icestudio profile file management
    project,
    common,
    tools,
    utils,
    boards,
    collections,

    //-- Angular-gettext package
    //-- More info:
    //-- https://angular-gettext.rocketeer.be/dev-guide/api/angular-gettext/
    gettextCatalog
  ) {
    /* jshint +W098 */
    console.log('->DEBUG: app.js');

    /* If in package.json appears development:{mode:true}*/
    /* activate development tools */
    tools.ifDevelopmentMode();

    //-- Configure ALERTIFY. Default values
    alertify.defaults.movable = false;
    alertify.defaults.closable = false;
    alertify.defaults.transition = 'fade';
    alertify.defaults.notifier.delay = 3;

    //-- Configure ALERTIFY default labels for the buttons
    let labels = {
      ok: gettextCatalog.getString('OK'),
      cancel: gettextCatalog.getString('Cancel'),
    };
    alertify.set('alert', 'labels', labels);
    alertify.set('prompt', 'labels', labels);
    alertify.set('confirm', 'labels', labels);

    //-- Links configuration:
    //-- All the html elements belonging to the given class
    //-- will be open in an external browser
    $(document).delegate(
      '.action-open-url-external-browser', //-- Selector
      'click',

      //-- Callback (when the link is clicked)
      function (e) {
        e.preventDefault();
        utils.openUrlExternalBrowser($(this).prop('href'));
        return false;
      }
    );

    //-- Load the boards info from their .json files and
    //-- create the GLOBAL Object common.boards
    //-- Read more information about it in the file app/scripts/services/boards.js
    boards.loadBoards(); //-- Init common.boards

    //-----------------------------------
    //-- Load the profile file
    //--
    utils.loadProfile(profile, function () {
      //-- Configure the iceConsole according to the profile values
      if (
        typeof profile.data.loggingEnabled !== 'undefined' &&
        profile.data.loggingEnabled === true
      ) {
        if (
          typeof profile.data.loggingFile !== 'undefined' &&
          profile.data.loggingFile !== ''
        ) {
          // const hd = new IceHD();
          const separator =
            common.DARWIN === false && common.LINUX === false ? '\\' : '/';
          const posBasename =
            profile.data.loggingFile.lastIndexOf(separator) + 1;
          const dirLFile = profile.data.loggingFile.substring(0, posBasename);
          const basename = profile.data.loggingFile.substring(posBasename);
          iceConsole.setPath(dirLFile, basename);
        } else {
          iceConsole.setPath(common.BASE_DIR);
        }

        iceConsole.enable();
      }

      //-- DEBUG: In the development version (wip) the log is ALWAYS active
      //-- The log file is icestudio.log (located in the BASE_DIR folder)
      iceConsole.setPath(common.BASE_DIR);
      iceConsole.enable();

      //-- Show information in the log file (if enabled)
      const now = new Date();
      iceConsole.log('\n\n\n');
      iceConsole.log(
        `=======================================================================================`
      );
      iceConsole.log(` Icestudio session ${now.toString()}`);
      iceConsole.log(` Version: ${common.ICESTUDIO_VERSION}`);
      iceConsole.log(
        `=======================================================================================`
      );
      iceConsole.log('Node information:');
      iceConsole.log(`  * Node version: ${process.version}`);
      iceConsole.log(`  * lts: ${process.release.lts}`);
      iceConsole.log(`  * SourceURL: ${process.release.sourceUrl}`);

      iceConsole.log('');
      iceConsole.log(`NW information: `);
      iceConsole.log(`  * NW version: ${process.versions['nw']}`);
      iceConsole.log(`  * NW-flavor: ${process.versions['nw-flavor']}`);
      iceConsole.log(`  * Chromium: ${process.versions['chromium']}`);

      iceConsole.log('');
      iceConsole.log('System information:');
      iceConsole.log(`  * Architecture: ${process.arch}`);
      iceConsole.log(`  * Platform: ${process.platform}`);

      iceConsole.log('');
      iceConsole.log('Profile file: ' + common.PROFILE_PATH);
      iceConsole.log(`\n- PROFILE:\n`);
      iceConsole.log(profile);

      iceConsole.log(`\n- PATHs\n`);
      iceConsole.log('common.BASE_DIR: Icestudio base dir: ' + common.BASE_DIR);
      iceConsole.log(
        'common.ICESTUDIO_DIR: Icestudio folder: ' + common.ICESTUDIO_DIR
      );
      iceConsole.log(
        'common.PROFILE_PATH: Profile path: ' + common.PROFILE_PATH
      );
      iceConsole.log(
        'common.INTERNAL_COLLECTIONS_DIR: Internal collections: ' +
          common.INTERNAL_COLLECTIONS_DIR
      );
      iceConsole.log('common.APIO_HOME: APIO folder: ' + common.APIO_HOME);
      iceConsole.log(
        'common.APIO_BUNDLE_DIR: Apio bundle: ' + common.APIO_BUNDLE_DIR
      );
      iceConsole.log('common.APIO_CMD: APIO command: ' + common.APIO_CMD);
      iceConsole.log('Common.APP: Icestudio APP folder: ' + common.APP);
      iceConsole.log(
        'common.APP_DIR: Icestudio execution folder: ' + common.APP_DIR
      );
      iceConsole.log('\n\n');

      collections.loadAllCollections();

      utils.loadLanguage(profile, function () {
        //-- If a board was already selected in a previous session, activate
        //-- it. On first run we no longer pop up the old board-selection
        //-- dialog: the Setup Wizard (setupWizard plugin) guides the user
        //-- through board selection, toolchain install and a test upload.
        if (profile.get('board') !== '') {
          profile.set('board', boards.selectBoard(profile.get('board')).name);
        } else {
          //-- First run / no board configured yet: still select a default board
          //-- so common.selectedBoard is NEVER null. A .ice opened on first run
          //-- (e.g. double-clicking a file passes it via nw.App.argv ->
          //-- project.open) loads before the Setup Wizard lets the user pick a
          //-- board, and project.load() dereferences common.selectedBoard.name
          //-- (project.js) — which threw and left the loading spinner hung.
          //-- Do NOT persist it to the profile: the wizard still owns board
          //-- selection and the profile stays "unconfigured".
          boards.selectBoard('');
        }

        //-- Check the toolchain silently. No notifications: neither the
        //-- executeCommand error toast (2nd arg) nor the "Toolchain not
        //-- installed, click here to install" warning (3rd arg). The wizard
        //-- handles installation; the Tools menu remains for manual install.
        //-- The check spawns apio via child_process (slow/variable on Windows);
        //-- record when it finishes so the Setup Wizard is not launched — and
        //-- the language change it can trigger is not run — until the
        //-- background init has settled (avoids the first-run spinner race).
        var toolchainChecked = false;
        tools.checkToolchain(
          () => {
            toolchainChecked = true;
          },
          false, //-- No executeCommand error toast
          false //-- No "toolchain not installed" warning
        );

        $('html').attr('lang', profile.get('language'));
        collections.sort();
        profile.set(
          'collection',
          collections.selectCollection(profile.get('collection'))
        );
        project.updateTitle(gettextCatalog.getString('Untitled'));

        //-- First-run / missing configuration: auto-launch the Setup Wizard
        //-- once. Plugins load asynchronously, so poll until the plugin is
        //-- registered, then launch it. The wizard marks setupWizardDone on
        //-- open, so it never auto-reappears (it can be relaunched from
        //-- Tools -> Wizard).
        if (!profile.get('setupWizardDone')) {
          var wizTries = 0;
          var wizPoll = setInterval(function () {
            wizTries++;
            var pm =
              typeof iceStudio !== 'undefined' ? iceStudio.pluginManager : null;
            var pluginReady = !!(pm && pm.plugins && pm.plugins['setupWizard']);
            //-- Wait until the background init has settled too: boards load
            //-- synchronously, but collections and the apio toolchain probe may
            //-- still be in flight. Launching the wizard before that lets the
            //-- user reach the language step and trigger a project reload
            //-- against half-initialized state — the first-run spinner hang
            //-- reported on slow Windows machines.
            var initReady =
              toolchainChecked &&
              typeof common.internalCollections !== 'undefined';
            //-- ~20s safety: if the apio subprocess is unusually slow, launch
            //-- anyway rather than block the user forever.
            var initTimedOut = wizTries > 40;

            if (pluginReady && (initReady || initTimedOut)) {
              clearInterval(wizPoll);
              iceStudio.bus.events.publish(
                'pluginManager.launch',
                'setupWizard'
              );
            } else if (wizTries > 60) {
              //-- ~30s hard cap: give up silently (plugin never registered)
              clearInterval(wizPoll);
            }
          }, 500);
        }
      });
    });

    console.log('->DEBUG: app.js: END');
  }
);

function iceSleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function initAfterLoad() {
  await iceSleepMs(1000); //-- this custom 1s wait smooth the loading screen

  angular.element(document).ready(function () {
    const observer = new MutationObserver(() => {
      requestAnimationFrame(() => {
        $('#main-icestudio-load-wrapper').addClass('fade-loaded');
        setTimeout(function () {
          $('#main-icestudio-load-wrapper').addClass('loaded');
        }, 500);
        iceStudioReady = true;

        observer.disconnect(); // Detener el observador después de ocultar el splash
      });
    });

    observer.observe(document.body, { childList: true, subtree: true });
  });
}

//-- Remove loaders when app is fully loaded
initAfterLoad();
