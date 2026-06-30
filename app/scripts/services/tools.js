'use strict';

angular
  .module('icestudio')
  .service(
    'tools',
    function (
      project,
      compiler,
      profile,
      collections,
      drivers,
      graph,
      utils,
      forms,
      common,
      gettextCatalog,
      nodeGettext,
      nodeFs,
      nodeFse,
      nodePath,
      nodeChildProcess,
      nodeSSHexec,
      nodeRSync,
      nodeAdmZip,
      _package,
      $rootScope,
      gui,
      outputConsole
    ) {
      //-- Flag that indicates if there is an apio command already running
      var taskRunning = false;

      var resources = [];
      var startAlert = null;
      var infoAlert = null;
      var resultAlert = null;
      var toolchainAlert = null;

      //-- tools.toolchain Global Object
      //-- tools.toolchain.apio -> Apio version
      //-- tools.toolchain.installed -> Boolean.
      //--    True if the toolchains is installed
      //-- tools.toolchain.disable -> Boolean.
      //--    True if the toolchain is disabled
      var toolchain = {
        apio: '-',
        installed: false,
        disabled: false,
        channel: 'stable', //-- Apio toolchain channel: 'stable' | 'ci'
      };
      this.toolchain = toolchain;
      toolchain.channel = profile.get('apioChannel') || 'stable';

      iceStudio.bus.events.subscribe(
        'toolchain.upload.resolve',
        toolchainRunResolve
      );
      // Remove old build directory on start
      //-- TODO: Check if it can be removed, as now another
      //-- build dir is used
      nodeFse.removeSync(common.OLD_BUILD_DIR);

      //-- Execute the apio verify command. It checks the syntax of the current
      //-- circuit
      this.verifyCode = function (startMessage, endMessage) {
        return apioRun(['lint'], startMessage, endMessage);
      };

      //-- Execute the apio build command. It builds the current circuit
      this.buildCode = function (startMessage, endMessage) {
        return apioRun(['build'], startMessage, endMessage);
      };

      //-- Execute the apio upload command. It uploads the bitstream to the
      //-- current board
      this.uploadCode = function (startMessage, endMessage) {
        return apioRun(['upload'], startMessage, endMessage);
      };

      //-- Generate all design files (verilog, pcf/lpf, list, apio.ini)
      //-- without running any apio command. Used by apioShell plugin.
      this.compileDesign = function () {
        return new Promise(function (resolve, reject) {
          try {
            apioIntegrityCheck();
            writeApioIni();
            generateCode(['build'])
              .then(function (output) {
                return syncResources(output.code, output.internalResources);
              })
              .then(function () {
                resolve();
              })
              .catch(reject);
          } catch (err) {
            reject(err);
          }
        });
      };

      function toolchainRunResolve(data) {
        common.commandOutput = data.commandOutput;
        $(document).trigger('commandOutputChanged', [common.commandOutput]);
        if (data.endMessage) {
          resultAlert = alertify.success(
            gettextCatalog.getString(data.endMessage)
          );
        }
        utils.endBlockingTask();
        restoreTask();
      }
      //----------------------------------------------------------------------------

      function apioIntegrityCheck() {
        let test = true;
        const hd = new IceHD();
        if (!nodeFs.existsSync(common.BUILD_DIR)) {
          nodeFs.mkdirSync(common.BUILD_DIR, { recursive: true });
        }
        if (!nodeFs.existsSync(hd.joinPath(common.BUILD_DIR, 'apio.ini'))) {
          test = false;
        }
        return test;
      } //--Apio Integrity check

      //-- Execute an apio command: build, verify, upload
      function apioRun(commands, startMessage, endMessage) {
        return new Promise(function (resolve, reject) {
          //-- Ensure the build dir exists.
          apioIntegrityCheck();
          //-- (Re)write apio.ini for apio-mode boards so it always reflects the
          //-- current board and Tools > Preferences (e.g. verilator-extra-
          //-- options). writeApioIni only touches the file when its content
          //-- changed, so apio's build cache is preserved. "custom" boards
          //-- never fall back to apio, so they don't need it.
          if (!common.selectedBoard || common.selectedBoard.mode !== 'custom') {
            writeApioIni();
          }

          if (taskRunning) {
            reject(new Error('Another task is already running'));
            return;
          }
          //-- Flag that there is a command running
          taskRunning = true;

          //-- Variable for storing the verilog source code of
          //-- the current circuit
          let sourceCode = '';

          //-- The command can only be executed if there is no other
          //-- command already running

          if (infoAlert) {
            infoAlert.dismiss(false);
          }

          if (resultAlert) {
            resultAlert.dismiss(false);
          }

          graph
            .resetCodeErrors()
            .then(function () {
              return checkToolchainInstalled();
            })
            .then(function () {
              utils.beginBlockingTask();
              if (startMessage) {
                startAlert = alertify.message(startMessage, 99999);
              }

              return generateCode(commands);
            })
            .then(function (output) {
              sourceCode = output.code;

              return syncResources(output.code, output.internalResources);
            })
            .then(function () {
              var hostname = profile.get('remoteHostname');
              var command = commands[0];
              if (command === 'build') {
                //-- Always capture the FPGA resource report (--verbose-pnr) so
                //-- the last synthesis result is available whenever the
                //-- resources panel is shown, regardless of whether it was on
                //-- during the build.
                commands = commands.concat('--verbose-pnr');
              }
              var board = common.selectedBoard;
              var actionKey = command === 'lint' ? 'verify' : command;

              //-- Per-action override: if the board defines its own command(s)
              //-- for this action (optionally per-OS), run those instead of
              //-- apio. This enables combos (e.g. apio build + custom upload)
              //-- and "apio raw" invocations.
              var custom = resolveActionCommands(board, actionKey);
              if (custom && custom.length) {
                return executeCustom(command, custom);
              }

              //-- No explicit command for this action. In "custom" mode there
              //-- is no apio fallback, so it is a no-op.
              if (board && board.mode === 'custom') {
                return noopCustom(actionKey);
              }

              //-- apio fallback. For project boards, apio supports project-level
              //-- definitions (boards.jsonc/fpgas.jsonc/programmers.jsonc): copy
              //-- them into the build dir so apio can find them.
              if (board && board.origin === 'project') {
                copyProjectBoardConfigs();
              }

              if (hostname) {
                return executeRemote(commands, hostname);
              } else {
                return executeLocal(commands);
              }
            })
            .then(function (result) {
              return processResult(result, sourceCode);
            })
            .then(function () {
              // Success: green toast only; details stay in the output console.
              if (endMessage) {
                resultAlert = alertify.success(
                  gettextCatalog.getString(endMessage)
                );
              }
              outputConsole.endCommand(false);
              utils.endBlockingTask();
              restoreTask();
              resolve();
            })
            .catch(function (e) {
              //-- Toolchain not installed: the Yes/No install prompt was
              //-- already shown by checkToolchainInstalled() and apio was never
              //-- launched (no spinner started). Just release the lock.
              if (e && e.message === 'TOOLCHAIN_NOT_INSTALLED') {
                utils.endBlockingTask();
                restoreTask();
                return;
              }
              // Error: red toast only (no error content). The full output is in
              // the output console, which opens automatically on failure.
              if (resultAlert) {
                resultAlert.dismiss(false);
              }
              resultAlert = alertify.error(
                gettextCatalog.getString('Command failed'),
                5
              );
              outputConsole.endCommand(true);
              utils.endBlockingTask();
              restoreTask();
            });
        });
      }
      //----------------------------------------------------------------------------

      function restoreTask() {
        setTimeout(function () {
          // Wait 1s before run a task again
          if (startAlert) {
            startAlert.dismiss(false);
          }
          taskRunning = false;
        }, 1000);
      }

      //------------------------------------------------------------------------
      //-- Is the apio toolchain installed? PURELY a physical on-disk check: no
      //-- apio command is run and no command output is parsed. Two things must
      //-- be present on disk:
      //--   * the apio CLI executable  -> common.APIO_EXE (in the apio-bundle)
      //--   * the toolchain packages   -> APIO_HOME/packages (downloaded, non-empty)
      //-- If either is missing the toolchain is not usable. This is the single
      //-- source of truth for "is the toolchain installed?" used by
      //-- verify/build/upload.
      function isToolchainInstalled() {
        try {
          //-- apio CLI executable present on disk?
          if (!nodeFs.existsSync(common.APIO_EXE)) {
            return false;
          }
          //-- toolchain packages downloaded on disk?
          var pkgDir = nodePath.join(common.APIO_HOME, 'packages');
          return (
            nodeFs.existsSync(pkgDir) && nodeFs.readdirSync(pkgDir).length > 0
          );
        } catch (e) {
          return false;
        }
      }
      this.isToolchainInstalled = isToolchainInstalled;

      //------------------------------------------------------------------------
      //-- Gate for verify/build/upload: if the toolchain is not installed
      //-- (physical disk check above), ask the user whether to install it
      //-- (Yes/No) and abort BEFORE launching apio — so apio is never run, there
      //-- is no "Command failed" toast nor shell output, and the loading spinner
      //-- can never hang on a missing/failed apio process.
      function checkToolchainInstalled() {
        return new Promise(function (resolve, reject) {
          if (isToolchainInstalled()) {
            resolve();
          } else {
            toolchainNotInstalledConfirm();
            reject(new Error('TOOLCHAIN_NOT_INSTALLED'));
          }
        });
      }
      //-----------------------------------------------------------------------

      function generateCode(cmd) {
        return new Promise(function (resolve) {
          project.snapshot();
          project.update();
          var opt = {
            datetime: false,
            boardRules: profile.get('boardRules'),
          };
          if (opt.boardRules) {
            opt.initPorts = compiler.getInitPorts(project.get());
            opt.initPins = compiler.getInitPins(project.get());
          }

          // Verilog file
          var verilogFile = compiler.generate('verilog', project.get(), opt)[0];
          nodeFs.writeFileSync(
            nodePath.join(common.BUILD_DIR, verilogFile.name),
            verilogFile.content,
            'utf8'
          );

          if (cmd.indexOf('lint') > -1) {
            //only verification
            console.log('ONLY VERIFY');
          } else {
            //-- Select the constraint format from the board architecture:
            //--   ecp5  -> LPF, gowin -> CST, otherwise (ice40...) -> PCF
            var archName = common.selectedBoard.info.arch;
            var constraintType =
              archName === 'ecp5'
                ? 'lpf'
                : archName === 'gowin'
                  ? 'cst'
                  : 'pcf';
            var constraintFile = compiler.generate(
              constraintType,
              project.get(),
              opt
            )[0];
            nodeFs.writeFileSync(
              nodePath.join(common.BUILD_DIR, constraintFile.name),
              constraintFile.content,
              'utf8'
            );
          }

          // List files
          var listFiles = compiler.generate('list', project.get());
          for (var i in listFiles) {
            var listFile = listFiles[i];

            nodeFs.writeFileSync(
              nodePath.join(common.BUILD_DIR, listFile.name),
              listFile.content,
              'utf8'
            );
          }
          project.restoreSnapshot();
          resolve({
            code: verilogFile.content,
            internalResources: listFiles.map(function (res) {
              return res.name;
            }),
          });
        });
      }

      function syncResources(code, internalResources) {
        return new Promise(function (resolve, reject) {
          // Remove resources
          removeFiles(resources);
          resources = [];
          // Find included files
          resources = resources.concat(findIncludedFiles(code));
          // Find list files
          resources = resources.concat(findInlineFiles(code));
          // Sync resources
          resources = _.uniq(resources);
          // Remove internal files
          resources = _.difference(resources, internalResources);
          syncFiles(resources, reject);
          resolve();
        });
      }

      function removeFiles(files) {
        _.each(files, function (file) {
          var filepath = nodePath.join(common.BUILD_DIR, file);
          nodeFse.removeSync(filepath);
        });
      }

      function findIncludedFiles(code) {
        return findFiles(
          /[\n|\s]\/\/\s*@include\s+([^\s]*\.(v|vh|list))(\n|\s)/g,
          code
        );
      }

      function findInlineFiles(code) {
        return findFiles(/[\n|\s][^\/]?\"(.*\.list?)\"/g, code);
      }

      // TODO: duplicated: utils findIncludedFiles
      function findFiles(pattern, code) {
        var match;
        var files = [];
        while ((match = pattern.exec(code))) {
          files.push(match[1]);
        }
        return files;
      }

      function syncFiles(files, reject) {
        _.each(files, function (file) {
          var destPath = nodePath.join(common.BUILD_DIR, file);
          var origPath = nodePath.join(utils.dirname(project.filepath), file);

          // Copy file
          var copySuccess = utils.copySync(origPath, destPath);
          if (!copySuccess) {
            resultAlert = alertify.error(
              gettextCatalog.getString('File {{file}} does not exist', {
                file: file,
              }),
              30
            );
            reject();
          }
        });
      }

      this.checkToolchain = checkToolchain;

      //----------------------------------------------------------------------------------
      //-- Check if Apio is available. The Apio version is read and stored in the
      //-- toolchain.apio global object
      //-- It is also checked if the version is correct (with the version given in the
      //-- package.json package)
      function checkToolchain(
        callback,
        notifyerror = true,
        notifyMissing = true
      ) {
        //-- Keep the channel indicator in sync with the profile
        toolchain.channel = profile.get('apioChannel') || 'stable';
        //-- Comand to Execute: apio --version
        //-- It returns the apio version
        //-- Ej:
        //-- $ apio --version
        //-- apio, version 0.7.dev1
        //-- common.APIO_CMD contains the command for executing APIO
        utils.executeCommand(
          [common.APIO_CMD, '--version'],
          (error, output) => {
            //-- Toolchain not installed (or error executing it)
            if (error) {
              //-- No apio version (blank)
              toolchain.apio = '';

              //-- Flag apio is not installed
              toolchain.installed = false;

              // Show an error notification (unless suppressed, e.g. at startup
              // where the Setup Wizard handles the missing toolchain)
              if (notifyMissing) {
                toolchainNotInstalledAlert(
                  gettextCatalog.getString('Toolchain not installed')
                );
              }

              //-- Execute the callback, if any
              if (callback) {
                callback();
              }
            }

            //-- Toolchain installed
            else {
              //-- Convert the object received to a string
              let msg = '' + output;

              //-- Get the version number
              var match = msg.match(/apio[\s,].*?v?(\d+\.\d+\.\d+)/i);
              if (match) {
                toolchain.apio = match[1];
              }

              iceStudio.toolchain.apio = toolchain.apio;

              //-- If version was extracted, apio is installed
              toolchain.installed = !!match;

              iceStudio.toolchain.installed = toolchain.installed;

              if (toolchain.installed) {
                if (callback) {
                  callback();
                }
              } else {
                iceConsole.log('Toolchain version could not be determined');

                if (notifyMissing) {
                  toolchainNotInstalledAlert(
                    gettextCatalog.getString('Toolchain not installed')
                  );
                }
              }
            }
          },
          notifyerror
        );
      }
      //----------------------------------------------------------------------------------

      function toolchainNotInstalledAlert(message) {
        if (resultAlert) {
          resultAlert.dismiss(false);
        }
        resultAlert = alertify.warning(
          message +
            '.<br>' +
            gettextCatalog.getString('Click here to install it'),
          99999
        );
        resultAlert.callback = function (isClicked) {
          if (isClicked) {
            // Install the new toolchain
            $rootScope.$broadcast('installToolchain');
          }
        };
      }

      //-- Ask the user whether to install the missing toolchain (Yes/No modal).
      //-- On "Yes" it launches the EXISTING install pipeline (same as the Tools
      //-- menu / Setup Wizard) via the 'installToolchain' broadcast. Strings are
      //-- internationalized like the rest of the UI.
      function toolchainNotInstalledConfirm() {
        //-- resultAlert is a notification (alertify.error/warning/...), which
        //-- DOES have dismiss(). Do NOT touch toolchainAlert here: that var
        //-- holds an alertify DIALOG (install progress), and dialogs have no
        //-- dismiss() — calling it threw a TypeError that turned the rejection
        //-- into a bogus "Command failed" with no prompt.
        if (resultAlert) {
          resultAlert.dismiss(false);
        }
        //-- alertify confirm labels are global: set them to Yes/No for this
        //-- dialog and restore OK/Cancel afterwards so other confirms keep
        //-- their default labels.
        var restoreLabels = function () {
          alertify.set('confirm', 'labels', {
            ok: gettextCatalog.getString('OK'),
            cancel: gettextCatalog.getString('Cancel'),
          });
        };
        alertify.set('confirm', 'labels', {
          ok: gettextCatalog.getString('Yes'),
          cancel: gettextCatalog.getString('No'),
        });
        alertify.confirm(
          gettextCatalog.getString('Toolchain not installed') +
            '.<br>' +
            gettextCatalog.getString('Do you want to install it?'),
          function () {
            //-- Yes: install the toolchain (existing install process). Defer it
            //-- so THIS confirm dialog finishes closing first: alertify reuses a
            //-- single confirm dialog, so opening the channel dialog
            //-- (showApioChannel -> alertify.confirm) synchronously from here
            //-- clashes with the closing one and it never appears.
            restoreLabels();
            setTimeout(function () {
              $rootScope.$broadcast('installToolchain');
            }, 300);
          },
          function () {
            //-- No: keep the current state, do nothing
            restoreLabels();
          }
        );
      }

      //-- TODO: Think about removing this function in future versions....
      function executeRemote(commands, hostname) {
        return new Promise(function (resolve) {
          startAlert.setContent(
            gettextCatalog.getString('Synchronize remote files ...')
          );
          nodeRSync(
            {
              src: common.BUILD_DIR + '/',
              dest: hostname + ':.build/',
              ssh: true,
              recursive: true,
              delete: true,
              include: ['*.v', '*.pcf', '*.lpf', '*.cst', '*.list'],
              exclude: [
                '.sconsign.dblite',
                '*.out',
                '*.blif',
                '*.asc',
                '*.bin',
                '*.config',
                '*.json',
              ],
            },
            function (error, stdout, stderr /*, cmd*/) {
              if (!error) {
                startAlert.setContent(
                  gettextCatalog.getString('Execute remote {{label}} ...', {
                    label: '',
                  })
                );
                nodeSSHexec(
                  ['apio']
                    .concat(commands)
                    .concat(['--project-dir', '.build'])
                    .join(' '),
                  hostname,
                  function (error, stdout, stderr) {
                    resolve({
                      error: error,
                      stdout: stdout,
                      stderr: stderr,
                    });
                  }
                );
              } else {
                resolve({
                  error: error,
                  stdout: stdout,
                  stderr: stderr,
                });
              }
            }
          );
        });
      }

      function shellEscape(arrayArgs) {
        return arrayArgs.map(function (c) {
          if (c.indexOf('(') >= 0) {
            c = `"${c}"`;
          }
          return c;
        });
      }

      /* jshint ignore:start */
      async function executeLocalSync(commands) {
        try {
          await executeLocal(commands);
        } catch (error) {
          console.log('Execute command fails', commands);
        }
      }
      /* jshint ignore:end */
      function executeLocal(commands) {
        return new Promise(function (resolve) {
          if (commands[0] === 'upload') {
            // Upload command requires drivers setup (Mac OS)
            drivers.preUpload(function () {
              _executeLocal();
            });
          } else {
            // Other !upload commands
            _executeLocal();
          }

          function _executeLocal() {
            var apio = utils.getApioExecutable();

            commands = shellEscape(commands);

            var command = [apio]
              .concat(commands)
              .concat(['-p', utils.coverPath(common.BUILD_DIR)])
              .join(' ');
            if (
              typeof common.DEBUGMODE !== 'undefined' &&
              common.DEBUGMODE === 1
            ) {
              const fs = require('fs');
              fs.appendFileSync(
                common.LOGFILE,
                'tools._executeLocal>' + command + '\n'
              );
            }
            //-- Stream the toolchain output live to the output console. Use
            //-- spawn (not exec) so stdout/stderr arrive in real time. The
            //-- console is cleared and the command echoed at the start.
            outputConsole.startCommand(command);

            var stdout = '';
            var stderr = '';
            var done = false;

            function finish(error) {
              if (done) {
                return;
              }
              done = true;
              if (commands[0] === 'upload') {
                // Upload command requires to restore the drivers (Mac OS)
                drivers.postUpload();
              }
              common.commandOutput = command + '\n\n' + stdout + stderr;
              $(document).trigger('commandOutputChanged', [
                common.commandOutput,
              ]);
              resolve({ error: error, stdout: stdout, stderr: stderr });
            }

            var child = nodeChildProcess.spawn(command, { shell: true });
            child.stdout.on('data', function (data) {
              var chunk = data.toString();
              stdout += chunk;
              outputConsole.write(chunk);
            });
            child.stderr.on('data', function (data) {
              var chunk = data.toString();
              stderr += chunk;
              outputConsole.write(chunk);
            });
            child.on('error', function (err) {
              finish(err);
            });
            child.on('close', function (code) {
              finish(
                code === 0
                  ? null
                  : Object.assign(
                      new Error('Process exited with code ' + code),
                      {
                        code: code,
                      }
                    )
              );
            });
          }
        });
      }

      //----------------------------------------------------------------------
      //-- apio.ini helpers
      //----------------------------------------------------------------------

      //-- Build the apio.ini content for the selected board, using the apio
      //-- board identifier (defaults to the board name for back-compat)
      function buildApioIni() {
        var board = common.selectedBoard;
        var apioBoard =
          (board && board.apioBoard) || (board && board.name) || '';
        var ini =
          '[env:default]\nboard = ' + apioBoard + '\ntop-module = main\n';

        //-- Extra Verilator options from the user's Tools > Preferences (Verify
        //-- tab). apio.ini exposes "verilator-extra-options" (board-agnostic),
        //-- so this customizes Verify for any board in a clean way.
        var verilatorExtra = getVerilatorExtraOptions();
        if (verilatorExtra.length) {
          ini += 'verilator-extra-options = ' + verilatorExtra.join(' ') + '\n';
        }
        return ini;
      }

      //-- Verilator waiver file written next to apio.ini. It uses FILE-SCOPED
      //-- lint_off rules so the relaxed checks only apply where the offending
      //-- code is generated/vendored, WITHOUT masking the same rule in the
      //-- user's own Verilog:
      //--   ASSIGNIN (main.v)      : a module 'input' wired to the inout
      //--                            PACKAGE_PIN of an SB_IO primitive (the IO /
      //--                            pull-up blocks). Valid for synthesis (yosys
      //--                            handles SB_IO correctly); the user cannot
      //--                            edit the generated connection.
      //--   COMBDLY  (cells_sim.v) : non-blocking '<=' in a combinational block
      //--                            inside the vendor SB_IO simulation model.
      //-- Extensible: add a "lint_off -rule <X> -file <Y>" line per new case.
      var VERILATOR_WAIVERS_FILE = 'icestudio_waivers.vlt';
      var VERILATOR_WAIVERS_CONTENT =
        '`verilator_config\n' +
        'lint_off -rule ASSIGNIN -file "*main.v"\n' +
        'lint_off -rule COMBDLY -file "*cells_sim.v"\n';

      //-- Write the Verilator waiver file into the build directory, but only
      //-- when the user enabled the "Relax I/O primitive checks" toggle (so
      //-- when it is off the ASSIGNIN/COMBDLY errors surface and the output
      //-- console can hint at the option). Rewrites only when it changed, to
      //-- preserve apio's build cache. Referenced from verilator-extra-options.
      function writeVerilatorWaivers() {
        var verify = (profile.get('toolPreferences') || {}).verify || {};
        if (!verify.relaxIoPrimitives) {
          return;
        }
        var hd = new IceHD();
        var p = hd.joinPath(common.BUILD_DIR, VERILATOR_WAIVERS_FILE);
        var current = null;
        try {
          current = nodeFs.readFileSync(p, 'utf8');
        } catch (e) {
          current = null;
        }
        if (current !== VERILATOR_WAIVERS_CONTENT) {
          nodeFs.writeFileSync(p, VERILATOR_WAIVERS_CONTENT, 'utf8');
        }
      }

      //-- Collect the extra Verilator options for Verify. Both relaxations are
      //-- user toggles (Tools > Preferences > Verify):
      //--   relaxIoPrimitives -> the file-scoped ASSIGNIN/COMBDLY waiver file
      //--   relaxRealToInt    -> -Wno-REALCVT
      function getVerilatorExtraOptions() {
        var opts = [];
        var verify = (profile.get('toolPreferences') || {}).verify || {};
        if (verify.relaxIoPrimitives) {
          //-- File-scoped waiver: ASSIGNIN (the generated SB_IO IO connection)
          //-- and COMBDLY (the vendor SB_IO model). Scoped so the same checks
          //-- still apply to the user's own Verilog.
          opts.push(VERILATOR_WAIVERS_FILE);
        }
        if (verify.relaxRealToInt) {
          //-- Silence Verilator's REALCVT warning (implicit real->integer
          //-- conversion), benign for blocks that compute a count as real
          //-- (e.g. $ceil) and truncate it to an integer output.
          opts.push('-Wno-REALCVT');
        }
        return opts;
      }

      //-- Write apio.ini into the build directory.
      //-- Rewrites only when the content actually changes, so apio's build
      //-- cache (which depends on the apio.ini mtime) is preserved when the
      //-- board and Tools preferences are unchanged.
      function writeApioIni() {
        //-- The waiver file is referenced from verilator-extra-options, so it
        //-- must exist alongside apio.ini before Verify runs.
        writeVerilatorWaivers();
        var hd = new IceHD();
        var iniPath = hd.joinPath(common.BUILD_DIR, 'apio.ini');
        var content = buildApioIni();
        var current = null;
        try {
          current = nodeFs.readFileSync(iniPath, 'utf8');
        } catch (e) {
          current = null;
        }
        if (current !== content) {
          nodeFs.writeFileSync(iniPath, content, 'utf8');
        }
      }

      //-- For "project" boards, copy the apio custom-board definition files
      //-- (boards.jsonc / fpgas.jsonc / programmers.jsonc) from the project
      //-- directory into the build directory, where apio (run with
      //-- -p BUILD_DIR) can find them.
      function copyProjectBoardConfigs() {
        var dir =
          project.dirname ||
          (project.filepath ? utils.dirname(project.filepath) : '');
        if (!dir) {
          return;
        }
        var files = ['boards.jsonc', 'fpgas.jsonc', 'programmers.jsonc'];
        files.forEach(function (f) {
          var src = nodePath.join(dir, f);
          try {
            if (nodeFs.statSync(src).isFile()) {
              nodeFse.copySync(src, nodePath.join(common.BUILD_DIR, f));
            }
          } catch (e) {
            //-- File not present in the project: ignore
          }
        });
      }

      //----------------------------------------------------------------------
      //-- Custom commands: per-action, per-OS command lines declared in the
      //-- board definition (info.commands). They may invoke "apio raw",
      //-- a custom flasher, or any toolchain command. Empty action ⇒ apio.
      //----------------------------------------------------------------------

      //-- Resolve the command list for an action, picking the current OS
      //-- variant. A spec can be a plain array (all OS) or an object keyed
      //-- by linux/darwin/windows (+ optional "default"). Returns null when
      //-- there is no command for this action.
      function resolveActionCommands(board, actionKey) {
        if (!board || !board.info || !board.info.commands) {
          return null;
        }
        return resolveOSCommands(board.info.commands[actionKey]);
      }

      function resolveOSCommands(spec) {
        if (!spec) {
          return null;
        }
        if (Array.isArray(spec)) {
          return spec.slice();
        }
        if (typeof spec === 'object') {
          var osKey = common.LINUX
            ? 'linux'
            : common.DARWIN
              ? 'darwin'
              : common.WIN32
                ? 'windows'
                : 'default';
          var arr = spec[osKey] || spec['default'] || null;
          return arr ? arr.slice() : null;
        }
        return null;
      }

      //-- Best-effort serial port detection for custom flashers ({SERIAL_PORT})
      function detectSerialPort() {
        try {
          if (common.WIN32) {
            return '';
          }
          var entries = nodeFs.readdirSync('/dev');
          var patterns = common.DARWIN
            ? [
                /^cu\.usbserial/,
                /^cu\.usbmodem/,
                /^cu\.wchusbserial/,
                /^cu\.SLAB/,
              ]
            : [/^ttyUSB/, /^ttyACM/];
          for (var p = 0; p < patterns.length; p++) {
            for (var i = 0; i < entries.length; i++) {
              if (patterns[p].test(entries[i])) {
                return '/dev/' + entries[i];
              }
            }
          }
        } catch (e) {
          //-- ignore
        }
        return '';
      }

      //-- Build the placeholder substitution context for custom commands
      function buildPlaceholderContext() {
        var board = common.selectedBoard;
        var arch = (board.info && board.info.arch) || '';
        var constraintName =
          arch === 'ecp5'
            ? 'main.lpf'
            : arch === 'gowin'
              ? 'main.cst'
              : 'main.pcf';
        var usb = (board.info && board.info.usb) || {};
        var projectDir =
          project.dirname ||
          (project.filepath ? utils.dirname(project.filepath) : '');
        return {
          BUILD_DIR: common.BUILD_DIR,
          TOP: 'main',
          CONSTRAINT_FILE: nodePath.join(common.BUILD_DIR, constraintName),
          BITSTREAM: nodePath.join(common.BUILD_DIR, 'hardware.bin'),
          VERILOG: nodePath.join(common.BUILD_DIR, 'main.v'),
          ARCH: arch,
          APIO: utils.getApioExecutable(),
          APIO_HOME: common.APIO_HOME || '',
          PROJECT_DIR: projectDir,
          BOARD: board.apioBoard || board.name,
          FPGA: (board.info && board.info.fpga) || '',
          USB_VID: usb.vid || '',
          USB_PID: usb.pid || '',
          SERIAL_PORT: detectSerialPort(),
        };
      }

      //-- Replace {PLACEHOLDER} tokens in a command string
      function substitute(cmd, ctx) {
        return cmd.replace(/\{(\w+)\}/g, function (match, key) {
          return Object.prototype.hasOwnProperty.call(ctx, key)
            ? ctx[key]
            : match;
        });
      }

      //-- Run a list of shell commands sequentially in the build dir,
      //-- accumulating output. Stops at the first non-zero exit.
      function runSequential(cmds, accOutput, done) {
        if (!cmds.length) {
          done({ error: null, output: accOutput });
          return;
        }
        var cmd = cmds[0];
        var rest = cmds.slice(1);
        accOutput += '$ ' + cmd + '\n';
        if (typeof common.DEBUGMODE !== 'undefined' && common.DEBUGMODE === 1) {
          require('fs').appendFileSync(
            common.LOGFILE,
            'tools.runSequential>' + cmd + '\n'
          );
        }
        nodeChildProcess.exec(
          cmd,
          {
            cwd: common.BUILD_DIR,
            maxBuffer: 5000 * 1024,
          },
          function (error, stdout, stderr) {
            accOutput += (stdout || '') + (stderr || '');
            if (error) {
              done({ error: error, output: accOutput });
            } else {
              runSequential(rest, accOutput, done);
            }
          }
        );
      }

      //-- No custom command for this action and no apio fallback ("custom"
      //-- mode): resolve as a no-op success with an informative message.
      function noopCustom(actionKey) {
        return new Promise(function (resolve) {
          common.commandOutput =
            '[custom] No "' +
            actionKey +
            '" command defined for board ' +
            (common.selectedBoard && common.selectedBoard.name) +
            '\n';
          $(document).trigger('commandOutputChanged', [common.commandOutput]);
          resolve({ error: null, stdout: common.commandOutput, stderr: '' });
        });
      }

      //-- Run a resolved list of custom command lines for an action,
      //-- substituting placeholders. Marks the result as custom so that
      //-- processResult shows the output generically (not apio matching).
      function executeCustom(action, resolvedCommands) {
        return new Promise(function (resolve) {
          var ctx = buildPlaceholderContext();
          var resolved = resolvedCommands.map(function (c) {
            return substitute(c, ctx);
          });

          function start() {
            runSequential(resolved, '', function (result) {
              if (action === 'upload') {
                //-- Upload command requires to restore the drivers (Mac OS)
                drivers.postUpload();
              }
              common.commandOutput = result.output;
              $(document).trigger('commandOutputChanged', [
                common.commandOutput,
              ]);
              resolve({
                error: result.error,
                stdout: result.output,
                stderr: result.error ? result.output : '',
                custom: true,
              });
            });
          }

          if (action === 'upload') {
            //-- Upload command requires drivers setup (Mac OS)
            drivers.preUpload(function () {
              start();
            });
          } else {
            start();
          }
        });
      }

      function processResult(result, code) {
        //-- Error/warning details now stream to the output console, so the
        //-- toasts that used to dump that content here are silenced: shadow
        //-- alertify within this function with no-op error/warning (returning a
        //-- dummy with dismiss() so existing resultAlert handling stays safe).
        //-- The single red/green result toast is shown by apioRun.
        var alertify = (function () {
          var dummy = {
            dismiss: function () {},
          };
          return {
            error: function () {
              return dummy;
            },
            warning: function () {
              return dummy;
            },
          };
        })();
        result = result || {};
        let _error = result.error;
        let stdout = result.stdout;
        let stderr = result.stderr;
        console.log('***PROCESS***', _error, stdout, stderr);

        return new Promise(function (resolve, reject) {
          var archName = common.selectedBoard.info.arch;
          if (_error || stderr) {
            // -- Process errors
            reject();
            if (result.custom) {
              // -- Custom command output comes from the board's own tools, not
              // -- apio, so show it generically instead of matching apio
              // -- error strings.
              var customOut = (stdout || '') + (stderr || '');
              resultAlert = alertify.error(
                customOut || gettextCatalog.getString('Error'),
                30
              );
            } else if (stdout) {
              var boardName = common.selectedBoard.name;
              var boardLabel = common.selectedBoard.info.label;
              // - Apio errors
              if (
                stdout.indexOf(
                  'Error: board ' + boardName + ' not connected'
                ) !== -1 ||
                stdout.indexOf('USBError') !== -1 ||
                stdout.indexOf('Activate bootloader') !== -1
              ) {
                var errorMessage = gettextCatalog.getString(
                  'Board {{name}} not connected',
                  {
                    name: utils.bold(boardLabel),
                  }
                );
                if (stdout.indexOf('Activate bootloader') !== -1) {
                  if (common.selectedBoard.name.startsWith('TinyFPGA-B')) {
                    // TinyFPGA bootloader notification
                    errorMessage +=
                      '<br>(' +
                      gettextCatalog.getString('Bootloader not active') +
                      ')';
                  }
                }
                resultAlert = alertify.error(errorMessage, 30);
              } else if (
                stdout.indexOf(
                  'Error: board ' + boardName + ' not available'
                ) !== -1
              ) {
                resultAlert = alertify.error(
                  gettextCatalog.getString('Board {{name}} not available', {
                    name: utils.bold(boardLabel),
                  }),
                  30
                );
                setupDriversAlert();
              } else if (stdout.indexOf('Error: unknown board') !== -1) {
                resultAlert = alertify.error(
                  gettextCatalog.getString('Unknown board'),
                  30
                );
              } else if (stdout.indexOf('[upload] Error') !== -1) {
                switch (common.selectedBoard.name) {
                  // TinyFPGA-B2 programmer errors
                  case 'TinyFPGA-B2':
                  case 'TinyFPGA-BX':
                    console.log('UPLOAD OUT', stdout);
                    var match = stdout.match(/Bootloader\snot\sactive/g);
                    if (match && match.length === 3) {
                      resultAlert = alertify.error(
                        gettextCatalog.getString('Bootloader not active'),
                        30
                      );
                    } else if (
                      stdout.indexOf('Device or resource busy') !== -1
                    ) {
                      resultAlert = alertify.error(
                        gettextCatalog.getString(
                          'Board {{name}} not available',
                          {
                            name: utils.bold(boardLabel),
                          }
                        ),
                        30
                      );
                      setupDriversAlert();
                    } else if (
                      stdout.indexOf(
                        'device disconnected or multiple access on port'
                      ) !== -1
                    ) {
                      resultAlert = alertify.error(
                        gettextCatalog.getString(
                          'Board {{name}} disconnected',
                          {
                            name: utils.bold(boardLabel),
                          }
                        ),
                        30
                      );
                    } else {
                      resultAlert = alertify.error(stdout, 30);
                    }
                    break;
                  default:
                    resultAlert = alertify.error(stdout, 30);
                }
              }
              // Yosys error (Mac OS)
              else if (
                stdout.indexOf('Library not loaded:') !== -1 &&
                stdout.indexOf('libffi') !== -1
              ) {
                resultAlert = alertify.error(
                  gettextCatalog.getString('Configuration not completed'),
                  30
                );
                setupDriversAlert();
              }
              // - Arachne-pnr errors
              else if (
                stdout.indexOf('set_io: too few arguments') !== -1 ||
                stdout.indexOf('fatal error: unknown pin') !== -1
              ) {
                resultAlert = alertify.error(
                  gettextCatalog.getString('FPGA I/O ports not defined'),
                  30
                );
              } else if (
                stdout.indexOf('fatal error: duplicate pin constraints') !== -1
              ) {
                resultAlert = alertify.error(
                  gettextCatalog.getString('Duplicate FPGA I/O ports'),
                  30
                );
              } else {
                var re,
                  matchError,
                  codeErrors = [];

                // Verilator
                //
                //-----------------------------------
                // - Verilator errors & warnings
                // %Error: main.v:#:#: syntax error, ...
                // %(Error|Warning)...: main.v:#:#: ...

                re = /%Error:\s+(\w+\.v):(\d+):(\d+):\s*(syntax error,.*)$/gm;

                while ((matchError = re.exec(stdout))) {
                  codeErrors.push({
                    line: parseInt(matchError[2]),
                    msg: matchError[4].trim(),
                    type: 'error',
                  });
                }

                re =
                  /%(Error|Warning)(-[A-Z0-9]+)?: main\.v:(\d+):(\d+): (.*?)[\r\n]/g;
                while ((matchError = re.exec(stdout))) {
                  codeErrors.push({
                    line: parseInt(matchError[3]),
                    msg: matchError[5].trim(),
                    type: matchError[1].toLowerCase(), // Convert 'Error' or 'Warning' to lowercase for type
                  });
                }
                console.log('ERRORS', codeErrors);

                // - Yosys errors
                // ERROR: ... main.v:#...
                // Warning: ... main.v:#...
                re = /(ERROR|Warning):\s(.*?)\smain\.v:([0-9]+)(.*?)[\r|\n]/g;
                var msg = '';
                var line = -1;
                var type = false;
                var preContent = false;
                var postContent = false;

                while ((matchError = re.exec(stdout))) {
                  msg = '';
                  line = parseInt(matchError[3]);
                  type = matchError[1].toLowerCase();
                  preContent = matchError[2];
                  postContent = matchError[4];
                  // Process error
                  if (preContent === 'Parser error in line') {
                    postContent = postContent.substring(2); // remove :\s
                    if (postContent.startsWith('syntax error')) {
                      postContent = 'Syntax error';
                    }
                    msg = postContent;
                  } else if (preContent.endsWith(' in line ')) {
                    msg =
                      preContent.replace(/\sin\sline\s$/, ' ') + postContent;
                  } else {
                    preContent = preContent.replace(/\sat\s$/, '');
                    preContent = preContent.replace(/\sin\s$/, '');
                    msg = preContent;
                  }
                  codeErrors.push({
                    line: line,
                    msg: msg,
                    type: type,
                  });
                }

                // - Yosys syntax errors
                // - main.v:31: ERROR: #...
                re = /\smain\.v:([0-9]+):\s(.*?)(ERROR):\s(.*?)[\r|\n]/g;
                while ((matchError = re.exec(stdout))) {
                  msg = '';
                  line = parseInt(matchError[1]);
                  type = matchError[3].toLowerCase();
                  preContent = matchError[4];

                  // If the error is about an unexpected token, the error is not
                  // deterministic, therefore we indicate that "the error
                  //is around this line ..."
                  if (preContent.indexOf('unexpected TOK_') >= 0) {
                    msg = 'Syntax error arround this line';
                  } else {
                    msg = preContent;
                  }
                  codeErrors.push({
                    line: line,
                    msg: msg,
                    type: type,
                  });
                }

                // Extract modules map from code
                var modules = mapCodeModules(code);
                var hasErrors = false;
                var hasWarnings = false;
                for (var i in codeErrors) {
                  var codeError = normalizeCodeError(codeErrors[i], modules);
                  if (codeError) {
                    // Launch codeError event
                    $(document).trigger('codeError', [codeError]);
                    hasErrors = hasErrors || codeError.type === 'error';
                    hasWarnings = hasWarnings || codeError.type === 'warning';
                  }
                }

                if (hasErrors) {
                  resultAlert = alertify.error(
                    gettextCatalog.getString('Errors detected in the design'),
                    5
                  );
                } else {
                  if (hasWarnings) {
                    resultAlert = alertify.warning(
                      gettextCatalog.getString(
                        'Warnings detected in the design'
                      ),
                      5
                    );
                  }

                  // var stdoutWarning = stdout.split('\n').filter(function (line) {
                  //   line = line.toLowerCase();
                  //   return (line.indexOf('warning: ') !== -1);
                  // });
                  var stdoutError = stdout.split('\n').filter(function (line) {
                    line = line.toLowerCase();
                    return (
                      line.indexOf('error: ') !== -1 ||
                      line.indexOf('not installed') !== -1 ||
                      line.indexOf('already declared') !== -1
                    );
                  });
                  // stdoutWarning.forEach(function (warning) {
                  //   alertify.warning(warning, 20);
                  // });
                  if (stdoutError.length > 0) {
                    // Show first error
                    var error = 'There are errors in the Design...';
                    // hardware.blif:#: fatal error: ...
                    re = /hardware\.blif:([0-9]+):\sfatal\serror:\s(.*)/g;

                    // ERROR: Cell xxx cannot be bound to ..... since it is already bound
                    var re2 =
                      /ERROR:\s(.*)\scannot\sbe\sbound\sto\s(.*)since\sit\sis\salready\sbound/g;

                    // ERROR: package does not have a pin named 'NULL' (on line 3)
                    var re3 =
                      /ERROR:\spackage\sdoes\snot\shave\sa\spin\snamed\s'NULL/g;

                    if ((matchError = re.exec(stdoutError[0]))) {
                      error = matchError[2];
                    } else if ((matchError = re2.exec(stdoutError[0]))) {
                      error = 'Duplicated pins';
                    } else if ((matchError = re3.exec(stdoutError[0]))) {
                      error = 'Pin not assigned (NULL)';
                    } else {
                      error += '\n' + stdoutError[0];
                    }
                    resultAlert = alertify.error(error, 30);
                  } else {
                    resultAlert = alertify.error(stdout, 30);
                  }
                }
              }
            } else if (stderr) {
              // Remote hostname errors
              if (
                stderr.indexOf('Could not resolve hostname') !== -1 ||
                stderr.indexOf('Connection refused') !== -1
              ) {
                resultAlert = alertify.error(
                  gettextCatalog.getString('Wrong remote hostname {{name}}', {
                    name: profile.get('remoteHostname'),
                  }),
                  30
                );
              } else if (stderr.indexOf('No route to host') !== -1) {
                resultAlert = alertify.error(
                  gettextCatalog.getString(
                    'Remote host {{name}} not connected',
                    {
                      name: profile.get('remoteHostname'),
                    }
                  ),
                  30
                );
              } else {
                resultAlert = alertify.error(stderr, 30);
              }
            }
          } else {
            //-- Process output
            resolve();
            if (stdout) {
              // Show used resources in the FPGA
              if (typeof common.FPGAResources.nextpnr === 'undefined') {
                common.FPGAResources.nextpnr = {
                  Field0: { name: '-', used: '-', total: '-', percentage: '-' },
                  Field1: { name: '-', used: '-', total: '-', percentage: '-' },
                  Field2: { name: '-', used: '-', total: '-', percentage: '-' },
                  Field3: { name: '-', used: '-', total: '-', percentage: '-' },

                  Field10: {
                    name: '-',
                    used: '-',
                    total: '-',
                    percentage: '-',
                  },
                  Field11: {
                    name: '-',
                    used: '-',
                    total: '-',
                    percentage: '-',
                  },
                  Field12: {
                    name: '-',
                    used: '-',
                    total: '-',
                    percentage: '-',
                  },
                  Field13: {
                    name: '-',
                    used: '-',
                    total: '-',
                    percentage: '-',
                  },
                  BUILDT: { value: '-' },
                  MF: { value: 0 },
                };
              }

              if ('ecp5' === archName) {
                // ecp5 resources
                common.FPGAResources.nextpnr.Field0 = findValueNPNR(
                  /(LUT4)s:\s{1,}(\d+)\/(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field0
                );
                common.FPGAResources.nextpnr.Field1 = findValueNPNR(
                  /_(SLICE):\s{1,}(\d+)\/(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field1
                );
                common.FPGAResources.nextpnr.Field2 = findValueNPNR(
                  /Total D(FF)s:\s{1,}(\d+)\/(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field2
                );
                common.FPGAResources.nextpnr.Field3 = findValueNPNR(
                  /(DP16KD):\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field3
                );
                common.FPGAResources.nextpnr.Field10 = findValueNPNR(
                  /TRELLIS_(IO):\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field10
                );
                common.FPGAResources.nextpnr.Field11 = findValueNPNR(
                  /(MULT18X18)D:\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field11
                );
                common.FPGAResources.nextpnr.Field12 = findValueNPNR(
                  /EHX(PLL)L:\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field12
                );
                common.FPGAResources.nextpnr.Field13 = findValueNPNR(
                  /DDR(DLL):\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field13
                );
              } else {
                // ice40 resources
                common.FPGAResources.nextpnr.Field0 = findValueNPNR(
                  /_(LC):\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field0
                );
                common.FPGAResources.nextpnr.Field1 = findValueNPNR(
                  /_(RAM):\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field1
                );
                common.FPGAResources.nextpnr.Field2 = findValueNPNR(
                  /SB_(IO):\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field2
                );
                common.FPGAResources.nextpnr.Field3 = findValueNPNR(
                  /SB_(GB):\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field3
                );
                common.FPGAResources.nextpnr.Field10 = findValueNPNR(
                  /_(PLL):\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field10
                );
                common.FPGAResources.nextpnr.Field11 = findValueNPNR(
                  /_(WARMBOOT):\s{1,}(\d+)\/\s{1,}(\d+)\s{1,}(\d+)%/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field11
                );
                common.FPGAResources.nextpnr.Field12 = findValueNPNR(
                  /(-)(-)(-)(-)/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field12
                );
                common.FPGAResources.nextpnr.Field13 = findValueNPNR(
                  /(-)(-)(-)(-)/g,
                  stdout,
                  common.FPGAResources.nextpnr.Field13
                );
              }

              common.FPGAResources.nextpnr.MF = findMaxFreq(
                /Max frequency for clock '[\w\W]+': ([\d\.]+) MHz/g,
                stdout,
                common.FPGAResources.nextpnr.MF
              );

              common.FPGAResources.nextpnr.BUILDT = findTime(
                /==(?:=)+..SUCCESS. Took ([\d\.]+) ([secmin]{3})/g,
                stdout,
                common.FPGAResources.nextpnr.MF.BUILDT
              );

              utils.rootScopeSafeApply();
            }
          }
        });
      }

      function findValueNPNR(pattern, output, previousValue) {
        var match = pattern.exec(output);
        return match && match[1] && match[2] && match[3] && match[4]
          ? {
              name: match[1],
              used: match[2],
              total: match[3],
              percentage: match[4],
            }
          : previousValue;
      }

      function findMaxFreq(pattern, output, previousValue) {
        var match = pattern.exec(output);
        return match && match[1]
          ? {
              value: match[1],
            }
          : previousValue;
      }

      function findTime(pattern, output, previousValue) {
        var match = pattern.exec(output);
        return match && match[1] && match[2]
          ? {
              value: match[1],
              unit: match[2],
            }
          : previousValue;
      }

      /*    function findValue(pattern, output, previousValue) {
          var match = pattern.exec(output);
          return (match && match[1]) ? match[1] : previousValue;
        }
        */
      function mapCodeModules(code) {
        var codelines = code.split('\n');
        var match,
          module = {
            params: [],
          },
          modules = [];
        // Find begin/end lines of the modules
        for (var i in codelines) {
          var codeline = codelines[i];
          // Get the module name
          if (!module.name) {
            match = /^module\s(.*?)[\s|;]/.exec(codeline);
            if (match) {
              module.name = match[1];
              continue;
            }
          }
          // Get the module parameters
          if (!module.begin) {
            match = /^\sparameter\s(.*?)\s/.exec(codeline);
            if (match) {
              module.params.push({
                name: match[1],
                line: parseInt(i) + 1,
              });
              continue;
            }
          }
          // Get the begin of the module code
          if (!module.begin) {
            match = /;$/.exec(codeline);
            if (match) {
              module.begin = parseInt(i) + 1;
              continue;
            }
          }
          // Get the end of the module code
          if (!module.end) {
            match = /^endmodule$/.exec(codeline);
            if (match) {
              module.end = parseInt(i) + 1;
              modules.push(module);
              module = {
                params: [],
              };
            }
          }
        }
        return modules;
      }

      function normalizeCodeError(codeError, modules) {
        var newCodeError;
        // Find the module with the error
        for (var i in modules) {
          var module = modules[i];
          if (codeError.line <= module.end) {
            newCodeError = {
              type: codeError.type,
              msg: codeError.msg,
            };
            // Find constant blocks in Yosys error:
            //  The error comes from the generated code
            //  but the origin is the constant block value
            var re = /Failed\sto\sdetect\swidth\sfor\sparameter\s\\(.*?)\sat/g;
            var matchConstant = re.exec(newCodeError.msg);

            if (codeError.line > module.begin && !matchConstant) {
              if (module.name.startsWith('main_')) {
                // Code block
                newCodeError.blockId = module.name.split('_')[1];
                newCodeError.blockType = 'code';
                newCodeError.line =
                  codeError.line -
                  module.begin -
                  (codeError.line === module.end ? 1 : 0);
              } else {
                // Generic block

                newCodeError.blockId = module.name.split('_')[0];
                newCodeError.blockType = 'generic';
              }
              break;
            } else {
              if (module.name === 'main') {
                // Constant block
                for (var j in module.params) {
                  var param = module.params[j];
                  if (
                    codeError.line === param.line ||
                    (matchConstant && param.name === matchConstant[1])
                  ) {
                    newCodeError.blockId = param.name;
                    newCodeError.blockType = 'constant';
                    break;
                  }
                }
              } else {
                // Generic block
                newCodeError.blockId = module.name;
                newCodeError.blockType = 'generic';
              }
              break;
            }
          }
        }
        return newCodeError;
      }

      //-----------------------------------------------------------------------
      // Toolchain methods
      //-----------------------------------------------------------------------

      $rootScope.$on(
        'installToolchain',
        function (/*event*/) {
          this.installToolchain();
        }.bind(this)
      );

      //----------------------------------------------------------------
      //----------------------------------------------------------------
      //-- Apio channel helpers
      //----------------------------------------------------------------
      //-- Current channel from the profile ('stable' | 'ci')
      function getApioChannel() {
        return profile.get('apioChannel') || 'stable';
      }

      //-- Build date (YYYYMMDD) of this platform's bundle asset in a release
      function getApioBundleDate(release) {
        if (!release || !release.assets) {
          return '';
        }
        var platform = common.getApioPlatformBundle();
        var ext = common.APIO_BUNDLE_EXT;
        var pattern = 'apio-cli-' + platform + '-';
        for (var i = 0; i < release.assets.length; i++) {
          var name = release.assets[i].name;
          if (
            name.indexOf(pattern) === 0 &&
            name.indexOf('-bundle.' + ext) !== -1
          ) {
            var m = name.substring(pattern.length).match(/^(\d{6,8})/);
            return m ? m[1] : '';
          }
        }
        return '';
      }

      //-- Semver inside a tag ('v1.5.0' → '1.5.0'); '' when the tag is a date
      function getApioTagVersion(tag) {
        var m = String(tag || '').match(/(\d+\.\d+\.\d+)/);
        return m ? m[1] : '';
      }

      //-- Normalize a date to digits only (2026-06-19 → 20260619) for comparison
      function normApioDate(d) {
        return String(d || '').replace(/\D/g, '');
      }

      //-- Display label for a release: 'YYYY-MM-DD' plus the version in
      //-- parentheses when the tag carries one (e.g. '2026-06-19 (1.5.0)')
      function formatApioReleaseLabel(release) {
        var date = getApioBundleDate(release);
        var dateFmt = /^\d{8}$/.test(date)
          ? date.slice(0, 4) + '-' + date.slice(4, 6) + '-' + date.slice(6, 8)
          : date;
        var ver = getApioTagVersion(release ? release['tag_name'] : '');
        return dateFmt + (ver ? ' (' + ver + ')' : '');
      }

      //-- Channel selector dialog. If onSave is provided it runs after the
      //-- channel is saved (used to chain the first installation).
      function showApioChannel(onSave) {
        var current = getApioChannel();
        var content =
          '<div class="apio-channel-form">' +
          '<p>' +
          gettextCatalog.getString(
            'Choose the Apio toolchain channel to install/update from:'
          ) +
          '</p>' +
          '<ul style="margin:0 0 12px 18px;padding:0;">' +
          '<li><b>Stable</b>: ' +
          gettextCatalog.getString('the latest stable release (recommended).') +
          '</li>' +
          '<li><b>CI</b>: ' +
          gettextCatalog.getString(
            'the latest nightly build (newest features, may be unstable).'
          ) +
          '</li>' +
          '</ul>' +
          '<p><label>' +
          gettextCatalog.getString('Channel') +
          ': <select id="apio-channel-select" class="ajs-input" style="width:auto;">' +
          '<option value="stable"' +
          (current === 'stable' ? ' selected' : '') +
          '>Stable</option>' +
          '<option value="ci"' +
          (current === 'ci' ? ' selected' : '') +
          '>CI</option>' +
          '</select></label></p>' +
          '</div>';

        alertify.confirm(
          gettextCatalog.getString('Apio channel'),
          content,
          function () {
            var sel = document.getElementById('apio-channel-select');
            var value = sel && sel.value === 'ci' ? 'ci' : 'stable';
            profile.set('apioChannel', value);
            toolchain.channel = value;
            utils.rootScopeSafeApply();
            if (typeof onSave === 'function') {
              onSave();
            } else {
              alertify.success(
                gettextCatalog.getString('Apio channel set to {{ch}}', {
                  ch: value === 'ci' ? 'CI' : 'Stable',
                })
              );
            }
          },
          function () {}
        );
      }
      this.showApioChannel = showApioChannel;

      //-- MENU ENTRY: Tools/Toolchain/Install
      //----------------------------------------------------------------
      //-- Install the toolchain. First let the user pick the channel
      //-- (Stable / CI); on Save it downloads and installs that channel.
      //--
      this.installToolchain = function () {
        iceConsole.log('------> MENU ENTRY POINT: Install Toolchain');
        if (resultAlert) {
          resultAlert.dismiss(false);
        }

        showApioChannel(function () {
          //-- Remove the toolchain for starting a fresh installation
          utils.removeToolchain();

          //-- Install the toolchain (downloads the selected channel's bundle)
          installOnlineToolchain();
        });
      };

      //--------------------------------------------------------------
      //-- Install the toolchain for the Setup Wizard.
      //-- The channel was already chosen in the wizard, so this skips the
      //-- channel dialog and reports completion through onFinish(err) (err is
      //-- falsy on success). Reuses the same install pipeline as the menu.
      this.installToolchainWizard = function (channel, onFinish) {
        if (resultAlert) {
          resultAlert.dismiss(false);
        }
        //-- Persist the chosen channel
        profile.set('apioChannel', channel === 'ci' ? 'ci' : 'stable');
        toolchain.channel = profile.get('apioChannel');
        //-- Fresh install
        utils.removeToolchain();
        installOnlineToolchain(onFinish);
      };

      //--------------------------------------------------------------
      //-- Update the toolchain
      //--
      this.updateToolchain = function () {
        iceConsole.log('------------------------------------------');
        iceConsole.log('------> MENU ENTRY POINT: Update Toolchain');
        iceConsole.log('------------------------------------------');
        if (resultAlert) {
          resultAlert.dismiss(false);
        }

        // Check installed version silently (no alerts), then compare with the
        // latest release of the SELECTED CHANNEL.
        installationStatus();

        var channel = getApioChannel();
        var chLabel = channel === 'ci' ? 'CI' : 'Stable';

        // Get installed version by running apio --version silently
        // Output example: "Apio CLI version 1.3.0 (darwin-arm64-pyinst-2026-02-25)"
        utils.executeCommand(
          [common.APIO_CMD, '--version'],
          function (error, output) {
            var installedVersion = '';
            var installedDate = '';
            if (!error && output) {
              var msg = '' + output;
              var vMatch = msg.match(/apio[\s,].*?v?(\d+\.\d+\.\d+)/i);
              if (vMatch) {
                installedVersion = vMatch[1];
              }
              // Extract build date from parenthetical, e.g. "pyinst-2026-02-25"
              var dMatch = msg.match(/(\d{4}-\d{2}-\d{2})\s*\)?\s*$/m);
              if (dMatch) {
                installedDate = dMatch[1];
              }
            }

            // Query GitHub for the latest release of the selected channel
            utils.getLatestGithubRelease(
              'FPGAwars',
              'apio',
              function (ghError, release) {
                restoreStatus();

                if (ghError) {
                  alertify.error(
                    gettextCatalog.getString('Error checking for updates') +
                      ': ' +
                      ghError
                  );
                  return;
                }

                //-- Compare by the bundle BUILD DATE (robust across channels:
                //-- the stable tag is a semver while CI tags are dates).
                var remoteDate = getApioBundleDate(release);
                var remoteLabel = formatApioReleaseLabel(release);
                iceConsole.log(
                  'Update check [' +
                    channel +
                    ']: installed=' +
                    installedVersion +
                    ' (' +
                    installedDate +
                    '), remote=' +
                    remoteLabel
                );

                //-- Same build already installed → up to date, do not reinstall
                if (
                  installedDate &&
                  normApioDate(installedDate) === normApioDate(remoteDate)
                ) {
                  alertify.success(
                    gettextCatalog.getString(
                      'Toolchain is up to date ({{ch}}: {{version}})',
                      { ch: chLabel, version: utils.bold(remoteLabel) }
                    )
                  );
                  return;
                }

                //-- A different build for this channel: install it (note this
                //-- can be a downgrade, e.g. when switching from CI to Stable).
                var msg2;
                if (installedVersion) {
                  var installedLabel =
                    installedDate +
                    (installedVersion ? ' (' + installedVersion + ')' : '');
                  msg2 = gettextCatalog.getString(
                    '{{ch}} channel: {{from}} → {{to}}. Install it now?',
                    {
                      ch: chLabel,
                      from: utils.bold(installedLabel),
                      to: utils.bold(remoteLabel),
                    }
                  );
                } else {
                  msg2 = gettextCatalog.getString(
                    'Install the toolchain ({{ch}}: {{version}}). Continue?',
                    { ch: chLabel, version: utils.bold(remoteLabel) }
                  );
                }

                alertify.confirm(msg2, function () {
                  installOnlineToolchain();
                });
              },
              channel
            );
          },
          false // no error notifications
        );
      };

      //---------------------------------------------------------
      //-- Remove the Toolchain
      //--
      this.removeToolchain = function () {
        if (resultAlert) {
          resultAlert.dismiss(false);
        }
        alertify.confirm(
          gettextCatalog.getString(
            'The toolchain will be removed. Do you want to continue?'
          ),
          function () {
            //-- Start the spinner
            installationStatus();

            setTimeout(function () {
              //-- Remove the toolchain
              utils.removeToolchain();

              //-- Init the related flags
              toolchain.apio = '';
              toolchain.installed = false;

              //-- Wait for it to finish, with a success notification
              alertify.success(
                gettextCatalog.getString('Toolchain removed'),
                2, //-- Notification removed after 2 seconds

                function () {
                  //-- Stop the spinner
                  restoreStatus();
                  iceConsole.log('===> Toolchains removed');
                }
              );
            }, 100);
          }
        );
      };

      $rootScope.$on(
        'enableDrivers',
        function (/*event*/) {
          this.enableDrivers();
        }.bind(this)
      );

      //--------------------------------------------
      //-- Install / uninstall the FPGA board drivers via apio.
      //-- Modern apio manages the platform-specific driver setup (Zadig on
      //-- Windows, udev rules on Linux, libusb/FTDI on macOS), so this replaces
      //-- the legacy drivers.enable()/disable() mechanism (sudo-prompt + manual
      //-- per-OS handling), which is obsolete and crashes on current Node
      //-- (sudo-prompt uses the removed util.isObject).
      function apioDrivers(action) {
        //-- It only works if the toolchain has been installed
        checkToolchain(function () {
          if (!toolchain.installed) {
            return;
          }
          //-- Pick the driver type from the selected board's interface
          //-- (default to FTDI, the most common for Icestudio boards).
          var iface =
            common.selectedBoard &&
            common.selectedBoard.info &&
            common.selectedBoard.info.interface === 'Serial'
              ? 'serial'
              : 'ftdi';

          //-- On Linux apio installs the udev rules with `sudo`, which needs an
          //-- interactive terminal to read the password. Icestudio's GUI has no
          //-- controlling terminal, so run the command inside a terminal
          //-- emulator where sudo can prompt. (Windows elevates via Zadig/UAC
          //-- and macOS needs no driver install, so those run spawned.)
          if (common.LINUX) {
            apioDriversLinuxTerminal(action, iface);
            return;
          }

          alertify.message(
            gettextCatalog.getString(
              (action === 'uninstall' ? 'Uninstalling' : 'Installing') +
                ' ' +
                iface +
                ' drivers...'
            )
          );
          utils.executeCommand(
            [common.APIO_CMD, 'drivers', action, iface],
            function (error) {
              if (error) {
                alertify.error(
                  gettextCatalog.getString('Driver operation failed')
                );
              } else {
                alertify.success(
                  gettextCatalog.getString(
                    action === 'uninstall'
                      ? 'Drivers uninstalled'
                      : 'Drivers installed'
                  )
                );
              }
            },
            false
          );
        });
      }

      //-- Run "apio drivers <action> <iface>" inside a Linux terminal emulator
      //-- so apio's `sudo` step can prompt for the password (the GUI has no
      //-- TTY). Falls back to showing the command if no terminal is found.
      function apioDriversLinuxTerminal(action, iface) {
        var fs = require('fs');
        var os = require('os');
        var nodepath = require('path');
        var cp = nodeChildProcess;
        var manual = 'apio drivers ' + action + ' ' + iface;

        //-- Script the terminal runs: the apio command + a pause so the window
        //-- stays open for the output and the sudo prompt.
        var script =
          '#!/usr/bin/env bash\n' +
          'echo "Icestudio: ' +
          manual +
          '"\n' +
          'echo "(you may be asked for your sudo password)"\n' +
          'echo\n' +
          common.APIO_CMD +
          ' drivers ' +
          action +
          ' ' +
          iface +
          '\n' +
          'status=$?\n' +
          'echo\n' +
          'if [ "$status" = "0" ]; then echo "Done."; else echo "Failed (exit $status)."; fi\n' +
          'echo "Press ENTER to close this window..."\n' +
          'read _\n';

        var scriptPath = nodepath.join(
          os.tmpdir(),
          'icestudio-apio-drivers.sh'
        );
        try {
          fs.writeFileSync(scriptPath, script, { mode: 0o755 });
        } catch (e) {
          alertify.error(
            gettextCatalog.getString('Could not prepare the drivers command')
          );
          return;
        }

        //-- Terminal emulators and their invocation (first available wins)
        var candidates = [
          ['x-terminal-emulator', ['-e', 'bash', scriptPath]],
          ['gnome-terminal', ['--', 'bash', scriptPath]],
          ['konsole', ['-e', 'bash', scriptPath]],
          ['mate-terminal', ['--', 'bash', scriptPath]],
          ['tilix', ['-e', 'bash', scriptPath]],
          ['xfce4-terminal', ['-x', 'bash', scriptPath]],
          ['xterm', ['-e', 'bash', scriptPath]],
        ];

        function available(cmd) {
          try {
            cp.execSync('command -v ' + cmd, { stdio: 'ignore' });
            return true;
          } catch (e) {
            return false;
          }
        }

        var term = null;
        for (var i = 0; i < candidates.length; i++) {
          if (available(candidates[i][0])) {
            term = candidates[i];
            break;
          }
        }

        if (!term) {
          alertify.warning(
            gettextCatalog.getString(
              'No terminal emulator found. Open a terminal and run:'
            ) +
              '<br><code>' +
              manual +
              '</code>',
            0
          );
          return;
        }

        try {
          var child = cp.spawn(term[0], term[1], {
            detached: true,
            stdio: 'ignore',
          });
          child.unref();
          alertify.message(
            gettextCatalog.getString('Running ' + manual + ' in a terminal...')
          );
        } catch (e) {
          alertify.warning(
            gettextCatalog.getString('Open a terminal and run:') +
              '<br><code>' +
              manual +
              '</code>',
            0
          );
        }
      }

      //-- Enable the drivers (install them via apio)
      this.enableDrivers = function () {
        apioDrivers('install');
      };

      //-- Disable the drivers (uninstall them via apio)
      this.disableDrivers = function () {
        apioDrivers('uninstall');
      };

      //---------------------------------------------------------
      //-- Install the toolchain (downloads the apio bundle)
      //--
      function installOnlineToolchain(onFinish) {
        //-- Waiting state: Spinner on
        installationStatus();

        //-- Progress bar with collapsible console output
        const content = [
          '<div>',
          '  <p id="progress-message">' +
            gettextCatalog.getString('Starting installation...') +
            '  </p>',
          '  <br>',
          '  <div class="progress">',
          '    <div id="progress-bar" class="progress-bar progress-bar-info progress-bar-striped active" role="progressbar"',
          '      aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" style="width:0%">',
          '    </div>',
          '  </div>',
          '  <div id="console-toggle" style="cursor:pointer;user-select:none;color:#888;font-size:12px;margin-top:8px;display:flex;align-items:center;justify-content:space-between;">',
          '    <span><span id="console-arrow">&#9654;</span> Output</span>',
          '    <button id="console-copy-btn" title="Copy to clipboard"',
          '      style="background:#444;color:#ccc;border:1px solid #666;border-radius:3px;padding:2px 8px;font-size:11px;cursor:pointer;">',
          '      Copy',
          '    </button>',
          '  </div>',
          '  <div id="console-wrapper" style="display:none;margin-top:4px;">',
          '    <pre id="console-output"',
          '      style="background:#1e1e1e;color:#d4d4d4;font-family:Menlo,Consolas,Courier New,monospace;font-size:11px;padding:6px 8px;max-height:240px;overflow:auto;border-radius:4px;border:1px solid #333;margin:0;white-space:pre;"></pre>',
          '  </div>',
          '</div>',
        ].join('\n');

        toolchainAlert = alertify.alert(content, function () {
          setTimeout(function () {
            initProgress();
            // Restore OK button
            $(toolchainAlert.__internal.buttons[0].element).removeClass(
              'hidden'
            );
          }, 200);
        });

        // Hide OK button
        $(toolchainAlert.__internal.buttons[0].element).addClass('hidden');

        //-- Setup console toggle. Use .off('click') first: installOnlineToolchain
        //-- runs on every install and alertify reuses the dialog, so without it
        //-- the handler would stack and a single click would toggle several
        //-- times (the panel would expand and immediately collapse again).
        $('#console-toggle')
          .off('click')
          .on('click', function () {
            var wrapper = $('#console-wrapper');
            var arrow = $('#console-arrow');
            if (wrapper.is(':visible')) {
              wrapper.slideUp(150);
              arrow.html('&#9654;');
            } else {
              wrapper.slideDown(150);
              arrow.html('&#9660;');
            }
          });

        //-- Setup copy button (same anti-stacking guard)
        $('#console-copy-btn')
          .off('click')
          .on('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            var el = document.getElementById('console-output');
            var text = el ? el.textContent : '';
            if (!text || text.trim() === '') {
              return;
            }
            try {
              var clipboard = nw.Clipboard.get();
              clipboard.set(text, 'text');
            } catch (err) {
              // Fallback: copy via hidden textarea
              var ta = document.createElement('textarea');
              ta.value = text;
              ta.style.position = 'fixed';
              ta.style.left = '-9999px';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
            }
            var btn = $(this);
            btn.text('Copied!');
            setTimeout(function () {
              btn.text('Copy');
            }, 1500);
          });

        //-- Listen for command output events
        $(document).on('commandOutputChanged.install', function (e, data) {
          appendToConsole(data);
        });

        //-- Toolchain not yet installed
        toolchain.installed = false;

        updateProgress(gettextCatalog.getString('Starting installation...'), 0);

        // Steps for installing the toolchain
        // These functions are called one by one, sequentially
        // When one function is done, the next one is called
        async.series(
          [
            //-- Internet connection is needed: check it
            checkInternetConnection,

            //-- Download the apio bundle
            downloadApioBundle,

            repairPermissions,
            //-- Install apio packages
            apioInstallPackages,
            repairPermissions,
            //-- Install drivers (Windows only)
            apioInstallDrivers,
            repairPermissions,
            //-- Finish installation!
            installationCompleted,
          ],
          function (err) {
            installationError(err);
            //-- Notify the caller (e.g. the Setup Wizard) of completion.
            if (typeof onFinish === 'function') {
              onFinish(err);
            }
          }
        );
      }

      //---------------------------------------------------------------
      //-- Check if there is internet connection
      //--
      function checkInternetConnection(callback) {
        iceConsole.log('**** STEP: Check internet connection');

        //-- Update the progress bar
        updateProgress(
          gettextCatalog.getString('Check Internet connection...'),
          0
        );

        //-- Check the connection
        utils.isOnline(callback, function () {
          //-- This code is executed if the internet connection
          //-- has not been detected

          //-- Close the window
          closeToolchainAlert();

          //-- Stop the spinner
          restoreStatus();

          //-- Show a notification
          var msg = gettextCatalog.getString('Internet connection required');
          appendToConsole('\n[ERROR] ' + msg + '\n');
          resultAlert = alertify.error(msg, 30);
          callback(true);
        });
      }

      //---------------------------------------------------------------
      //-- Download the apio bundle and extract it
      //--
      function downloadApioBundle(callback) {
        iceConsole.log('**** STEP: Download Apio bundle');
        var platform = common.getApioPlatformBundle();
        if (!platform) {
          callback('Unsupported platform');
          return;
        }
        var ext = common.APIO_BUNDLE_EXT;
        // Pattern to match the bundle asset for this platform
        var bundlePattern = 'apio-cli-' + platform + '-';

        updateProgress(
          gettextCatalog.getString('Finding latest Apio release...'),
          15
        );

        // Query GitHub API for the latest release
        utils.getLatestGithubRelease(
          'FPGAwars',
          'apio',
          function (error, release) {
            if (error) {
              appendToConsole(
                '[ERROR] Failed to get latest release: ' + error + '\n'
              );
              callback(error);
              return;
            }

            appendToConsole('Latest release: ' + release['tag_name'] + '\n');

            // Find the bundle asset matching our platform
            var asset = null;
            for (var i = 0; i < release.assets.length; i++) {
              var name = release.assets[i].name;
              if (
                name.indexOf(bundlePattern) === 0 &&
                name.indexOf('-bundle.' + ext) !== -1
              ) {
                asset = release.assets[i];
                break;
              }
            }

            if (!asset) {
              var msg = 'No bundle found for platform: ' + platform;
              appendToConsole('[ERROR] ' + msg + '\n');
              callback(msg);
              return;
            }

            appendToConsole('Downloading: ' + asset.name + '\n');
            updateProgress(
              gettextCatalog.getString('Downloading Apio bundle...'),
              20
            );
            utils.downloadAndExtractBundle(
              asset['browser_download_url'],
              common.APIO_BUNDLE_DIR,
              callback
            );
          },
          getApioChannel()
        );
      }

      //------------------------------------------
      //-- Repair OS permissions
      //--
      function repairPermissions(callback) {
        iceConsole.log('**** STEP: Repair OS Permissions');

        //-- Perform repair OS permissions
        utils.repairPermissions(callback);
      }

      //-------------------------------------------
      //-- Install apio packages
      //--
      function apioInstallPackages(callback) {
        iceConsole.log('**** STEP: APIO packages install');
        updateProgress(gettextCatalog.getString('Installing packages...'), 50);
        utils.apioInstall('', callback);
      }

      //---------------------------------------------
      //-- Install the Drivers (Windows only)
      //--
      function apioInstallDrivers(callback) {
        if (common.WIN32) {
          iceConsole.log('**** STEP: APIO install drivers');
          updateProgress(gettextCatalog.getString('Installing drivers...'), 80);
          utils.executeCommand(
            [common.APIO_CMD, 'drivers', 'install', 'ftdi'],
            null,
            true,
            callback
          );
        } else {
          callback();
        }
      }

      //---------------------------------------------
      //-- Handle installation errors
      //--
      function installationError(err) {
        if (err) {
          iceConsole.log('**** INSTALLATION ERROR: ' + err);
          appendToConsole(
            '\n[ERROR] Toolchain installation failed: ' + err + '\n'
          );
          // Don't close the alert so user can see the console output
          restoreStatus();
          // Show OK button so user can dismiss after reading the log
          if (toolchainAlert && toolchainAlert.__internal) {
            $(toolchainAlert.__internal.buttons[0].element).removeClass(
              'hidden'
            );
          }
          updateProgress(gettextCatalog.getString('Installation failed'), 0);
          $('#progress-bar')
            .removeClass('progress-bar-info progress-bar-striped active')
            .addClass('progress-bar-danger')
            .css('width', '100%')
            .text('Error');
          // Auto-expand the console on error
          var wrapper = $('#console-wrapper');
          if (!wrapper.is(':visible')) {
            wrapper.slideDown(150);
            $('#console-arrow').html('&#9660;');
          }
        }
      }

      //---------------------------------------------------
      //--
      function installationCompleted(callback) {
        iceConsole.log('**** FINAL STEP: Checking the installed APIO');

        //------- Create the CACHE folders
        //------- They were removed before installing the toolchain
        //------- It is necesarry to create them again in order to display
        //------- the blocks correctly
        let storage = new IceHD();

        //-- Cache and Image cache dir
        storage.mkDir(common.CACHE_DIR);
        storage.mkDir(common.IMAGE_CACHE_DIR);

        //-- Check that the toolchain has been installed
        checkToolchain(function () {
          //-- It is installed!
          if (toolchain.installed) {
            //-- Close the notification window
            closeToolchainAlert();

            //-- Update the progress bar
            updateProgress(
              gettextCatalog.getString('Installation completed'),
              100
            );

            iceConsole.log(
              '****************** INSTALLATION COMPLETED! **************'
            );
            iceConsole.log('\n\n');

            //-- Notification: Installed!
            alertify.success(gettextCatalog.getString('Toolchain installed'));
            //-- NOTE: the old "setup the drivers" prompt was removed. Modern
            //-- apio installs the drivers during the toolchain installation
            //-- (apio drivers install ftdi) and the legacy drivers.enable()
            //-- path (sudo-prompt) crashes on current Node. Drivers can still
            //-- be (re)installed from Tools -> Toolchain -> Drivers (via apio).
          }

          restoreStatus();
          callback();
        });
      }

      function setupDriversAlert() {
        if (common.showDrivers()) {
          var message = gettextCatalog.getString(
            'Click here to <b>setup the drivers</b>'
          );
          if (!infoAlert) {
            setTimeout(function () {
              infoAlert = alertify.message(message, 30);
              infoAlert.callback = function (isClicked) {
                infoAlert = null;
                if (isClicked) {
                  if (resultAlert) {
                    resultAlert.dismiss(false);
                  }
                  $rootScope.$broadcast('enableDrivers');
                }
              };
            }, 1000);
          }
        }
      }

      function appendToConsole(text) {
        var el = document.getElementById('console-output');
        if (!el) {
          return;
        }

        // Strip ANSI escape codes (CSI sequences including ?, extended colors)
        var clean = text.replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '');
        // Strip control chars except \n and \r
        clean = clean.replace(/[\x00-\x09\x0b\x0c\x0e-\x1f]/g, '');

        // Split into segments by \n and \r to simulate terminal behavior
        // \r = overwrite current line, \n = new line
        var content = el.textContent;
        var lines = content.length > 0 ? content.split('\n') : [''];

        for (var i = 0; i < clean.length; i++) {
          var ch = clean[i];
          if (ch === '\n') {
            lines.push('');
          } else if (ch === '\r') {
            // Carriage return: clear current line (will be overwritten)
            lines[lines.length - 1] = '';
          } else {
            lines[lines.length - 1] += ch;
          }
        }

        el.textContent = lines.join('\n');
        el.scrollTop = el.scrollHeight;
      }

      function updateProgress(message, value) {
        $('#progress-message').text(message);
        appendToConsole('>> ' + message + '\n');
        var bar = $('#progress-bar');
        if (value === 100) {
          bar.removeClass('progress-bar-striped active');
        }
        bar.text(value + '%');
        bar.attr('aria-valuenow', value);
        bar.css('width', value + '%');
      }

      function initProgress() {
        $('#progress-bar')
          .addClass(
            'notransition progress-bar-info progress-bar-striped active'
          )
          .removeClass('progress-bar-danger')
          .text('0%')
          .attr('aria-valuenow', 0)
          .css('width', '0%')
          .removeClass('notransition');
        //-- Clear console output
        var el = document.getElementById('console-output');
        if (el) {
          el.textContent = '';
        }
      }

      function closeToolchainAlert() {
        $(document).off('commandOutputChanged.install');
        toolchainAlert.callback();
        toolchainAlert.close();
      }

      //-- The interface is changed to the waiting state
      //-- The spinner is activated
      function installationStatus() {
        // Disable user events
        utils.disableKeyEvents();
        utils.disableClickEvents();

        //-- Spiner on!
        $('body').addClass('waiting');
      }

      //-- The interface is changed to the normal state
      //-- The spinner is stoped
      function restoreStatus() {
        // Enable user events
        utils.enableKeyEvents();
        utils.enableClickEvents();

        //-- Spinner off!
        $('body').removeClass('waiting');
      }

      // Collections management

      this.addCollections = function (filepaths) {
        // Load zip file
        async.eachSeries(filepaths, function (filepath, nextzip) {
          var zipData = nodeAdmZip(filepath);
          var _collections = getCollections(zipData);

          async.eachSeries(
            _collections,
            function (collection, next) {
              setTimeout(function () {
                if (
                  collection.package &&
                  (collection.blocks || collection.examples)
                ) {
                  alertify.prompt(
                    gettextCatalog.getString('Edit the collection name'),
                    collection.origName,
                    function (evt, name) {
                      if (!name) {
                        return false;
                      }
                      collection.name = name;

                      var destPath = nodePath.join(
                        common.INTERNAL_COLLECTIONS_DIR,
                        name
                      );
                      console.log('EE:', destPath);
                      if (nodeFs.existsSync(destPath)) {
                        alertify.confirm(
                          gettextCatalog.getString(
                            'The collection {{name}} already exists.',
                            {
                              name: utils.bold(name),
                            }
                          ) +
                            '<br>' +
                            gettextCatalog.getString(
                              'Do you want to replace it?'
                            ),
                          function () {
                            utils.deleteFolderRecursive(destPath);
                            installCollection(collection, zipData);
                            alertify.success(
                              gettextCatalog.getString(
                                'Collection {{name}} replaced',
                                {
                                  name: utils.bold(name),
                                }
                              )
                            );
                            console.log('NEXT COLLECTION');
                            next(name);
                          },
                          function () {
                            alertify.warning(
                              gettextCatalog.getString(
                                'Collection {{name}} not replaced',
                                {
                                  name: utils.bold(name),
                                }
                              )
                            );
                            next(name);
                          }
                        );
                      } else {
                        installCollection(collection, zipData);
                        alertify.success(
                          gettextCatalog.getString(
                            'Collection {{name}} added',
                            {
                              name: utils.bold(name),
                            }
                          )
                        );
                        next(name);
                      }
                    }
                  );
                } else {
                  alertify.warning(
                    gettextCatalog.getString('Invalid collection {{name}}', {
                      name: utils.bold(collection.name),
                    })
                  );
                }
              }, 0);
            },
            function (name) {
              collections.loadInternalCollections();
              // If the selected collection is replaced, load it again
              if (common.selectedCollection.name === name) {
                collections.selectCollection(name);
              }
              utils.rootScopeSafeApply();
              nextzip();
            }
          );
        });
      };

      function getCollections(zipData) {
        var data = '';
        var _collections = {};
        var zipEntries = zipData.getEntries();

        // Validate collections
        zipEntries.forEach(function (zipEntry) {
          data = zipEntry.entryName.match(/^([^\/]+)\/$/);
          if (data) {
            _collections[data[1]] = {
              origName: data[1],
              blocks: [],
              examples: [],
              locale: [],
              package: '',
            };
          }

          addCollectionItem('blocks', 'ice', _collections, zipEntry);
          addCollectionItem('blocks', 'v', _collections, zipEntry);
          addCollectionItem('blocks', 'vh', _collections, zipEntry);
          addCollectionItem('blocks', 'list', _collections, zipEntry);
          addCollectionItem('examples', 'ice', _collections, zipEntry);
          addCollectionItem('examples', 'v', _collections, zipEntry);
          addCollectionItem('examples', 'vh', _collections, zipEntry);
          addCollectionItem('examples', 'list', _collections, zipEntry);
          addCollectionItem('locale', 'po', _collections, zipEntry);

          data = zipEntry.entryName.match(/^([^\/]+)\/package\.json$/);
          if (data) {
            _collections[data[1]].package = zipEntry.entryName;
          }
          data = zipEntry.entryName.match(/^([^\/]+)\/README\.md$/);
          if (data) {
            _collections[data[1]].readme = zipEntry.entryName;
          }
        });

        return _collections;
      }

      function addCollectionItem(key, ext, collections, zipEntry) {
        var data = zipEntry.entryName.match(
          RegExp('^([^/]+)/' + key + '/.*.' + ext + '$')
        );
        if (data) {
          collections[data[1]][key].push(zipEntry.entryName);
        }
      }

      function installCollection(collection, zip) {
        var i,
          dest = '';
        var pattern = RegExp('^' + collection.origName);
        for (i in collection.blocks) {
          dest = collection.blocks[i].replace(pattern, collection.name);
          safeExtract(collection.blocks[i], dest, zip);
        }
        for (i in collection.examples) {
          dest = collection.examples[i].replace(pattern, collection.name);
          safeExtract(collection.examples[i], dest, zip);
        }
        for (i in collection.locale) {
          dest = collection.locale[i].replace(pattern, collection.name);
          safeExtract(collection.locale[i], dest, zip);
          // Generate locale JSON files
          var compiler = new nodeGettext.Compiler({
            format: 'json',
          });
          var sourcePath = nodePath.join(common.INTERNAL_COLLECTIONS_DIR, dest);
          var targetPath = nodePath.join(
            common.INTERNAL_COLLECTIONS_DIR,
            dest.replace(/\.po$/, '.json')
          );
          var content = nodeFs.readFileSync(sourcePath).toString();
          var json = compiler.convertPo([content]);
          nodeFs.writeFileSync(targetPath, json);
          // Add strings to gettext
          gettextCatalog.loadRemote('file://' + targetPath);
        }
        if (collection.package) {
          dest = collection.package.replace(pattern, collection.name);
          safeExtract(collection.package, dest, zip);
        }
        if (collection.readme) {
          dest = collection.readme.replace(pattern, collection.name);
          safeExtract(collection.readme, dest, zip);
        }
      }

      function safeExtract(entry, dest, zip) {
        try {
          var newPath = nodePath.join(common.INTERNAL_COLLECTIONS_DIR, dest);
          zip.extractEntryTo(
            entry,
            utils.dirname(newPath),
            /*maintainEntryPath*/ false
          );
        } catch (e) {}
      }

      this.removeCollection = function (collection) {
        utils.deleteFolderRecursive(collection.path);
        collections.loadInternalCollections();
        alertify.success(
          gettextCatalog.getString('Collection {{name}} removed', {
            name: utils.bold(collection.name),
          })
        );
      };

      this.removeAllCollections = function () {
        utils.removeCollections();
        collections.loadInternalCollections();
        alertify.success(gettextCatalog.getString('All collections removed'));
      };
      this.checkForNewVersion = function () {
        if (typeof _package.updatecheck !== 'undefined') {
          $.getJSON(
            _package.updatecheck + '?_tsi=' + new Date().getTime(),
            function (result) {
              var hasNewVersion = false;
              if (result !== false) {
                if (
                  typeof result.version !== 'undefined' &&
                  _package.version < result.version
                ) {
                  hasNewVersion = 'stable';
                }
                if (
                  typeof result.nightly !== 'undefined' &&
                  _package.version < result.nightly
                ) {
                  hasNewVersion = 'nightly';
                }
                if (hasNewVersion !== false) {
                  var msg = '';
                  if (hasNewVersion === 'stable') {
                    msg =
                      '<div class="new-version-notifier-box"><div class="new-version-notifier-box--icon"><img src="resources/images/confetti.svg"></div>\
                <div class="new-version-notifier-box--text">' +
                      gettextCatalog.getString(
                        'There is a new stable version available'
                      ) +
                      '<br><a class="action-open-url-external-browser" href="https://icestudio.io" target="_blank">' +
                      gettextCatalog.getString('Click here to install it') +
                      '</a></div></div>';
                  } else {
                    msg =
                      '<div class="new-version-notifier-box"><div class="new-version-notifier-box--icon"><img src="resources/images/confetti.svg"></div>\
                <div class="new-version-notifier-box--text">' +
                      gettextCatalog.getString(
                        'There is a new nightly version available'
                      ) +
                      '<br><a class="action-open-url-external-browser" href="https://icestudio.io" target="_blank">' +
                      gettextCatalog.getString('Click here to install it') +
                      '</a></div></div>';
                  }
                  alertify.notify(msg, 'notify', 30);
                }
              }
            }
          );
        }
      };
      this.ifDevelopmentMode = function () {
        if (
          typeof _package.development !== 'undefined' &&
          typeof _package.development.mode !== 'undefined' &&
          _package.development.mode === true
        ) {
          utils.openDevToolsUI();
        }
      };

      this.initializePluginManager = function (callbackOnRun) {
        if (typeof ICEpm !== 'undefined') {
          ICEpm.setEnvironment(common);
          ICEpm.setPluginDir(common.DEFAULT_PLUGIN_DIR, function () {
            let plist = ICEpm.getAll();
            let uri = ICEpm.getBaseUri();
            let t = $('.icm-icon-list');
            t.empty();
            let html = '';
            for (let prop in plist) {
              if (
                typeof plist[prop].manifest.type === 'undefined' ||
                plist[prop].manifest.type === 'app'
              ) {
                html +=
                  '<a href="#" data-action="icm-plugin-run" data-plugin="' +
                  prop +
                  '"><img class="icm-plugin-icon" src="' +
                  uri +
                  '/' +
                  prop +
                  '/' +
                  plist[prop].manifest.icon +
                  '"><span>' +
                  plist[prop].manifest.name +
                  '</span></a>';
              }
            }
            t.append(html);

            $('[data-action="icm-plugin-run"]').off();
            $('[data-action="icm-plugin-run"]').on('click', function (e) {
              e.preventDefault();
              let ptarget = $(this).data('plugin');
              if (typeof callbackOnRun !== 'undefined') {
                callbackOnRun();
              }
              ICEpm.run(ptarget);
              return false;
            });
          });
        }
      };

      function generateSnapshotName(extension) {
        // Obtener la fecha actual
        const now = new Date();

        // Formatear fecha y hora
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0'); // Mes empieza en 0
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        // Crear el nombre del archivo
        return `icestudio_${year}-${month}-${day}_${hours}.${minutes}.${seconds}.${extension}`;
      }

      this.takeSnapshotPNG = function () {
        // Current NWJS Window
        const win = gui.Window.get();

        setTimeout(function () {
          win.capturePage(
            (base64Data) => {
              try {
                const imageBuffer = Buffer.from(base64Data, 'base64');

                // Image saved to Destkop as OSX style
                const fileName = generateSnapshotName('png');
                const userHome = process.env.HOME || process.env.USERPROFILE;
                const savePath = nodePath.join(userHome, 'Desktop', fileName);
                nodeFs.writeFileSync(savePath, imageBuffer);
                alertify.success(
                  gettextCatalog.getString('Snapshot saved: {{name}}', {
                    name: savePath,
                  }),
                  30
                );
              } catch (err) {
                console.error('Error taking snapshot', err);
              }
            },
            { format: 'png', datatype: 'raw' }
          );
        }, 500);
      };

      let isRecording = false;
      let mediaRecorder = false;
      let stream = false;
      this.takeSnapshotVideo = async function () {
        if (!isRecording) {
          isRecording = true;
          try {
            let videoChunks = [];

            const displayMediaOptions = {
              video: {
                cursor: 'always',
              },
              audio: false,
            };

            stream =
              await navigator.mediaDevices.getDisplayMedia(displayMediaOptions);

            mediaRecorder = new MediaRecorder(stream, {
              mimeType: 'video/webm;codecs=vp9',
            });

            mediaRecorder.ondataavailable = (event) => {
              if (event.data.size > 0) {
                videoChunks.push(event.data);
              }
            };

            mediaRecorder.onstop = async () => {
              const blob = new Blob(videoChunks, { type: 'video/webm' });
              const arrayBuffer = await blob.arrayBuffer();

              const fileName = generateSnapshotName('webm');
              const userHome = process.env.HOME || process.env.USERPROFILE;
              const savePath = nodePath.join(userHome, 'Desktop', fileName);
              nodeFs.writeFileSync(savePath, Buffer.from(arrayBuffer));

              alertify.success(
                gettextCatalog.getString('Video saved: {{name}}', {
                  name: savePath,
                }),
                30
              );
            };

            setTimeout(function () {
              mediaRecorder.start();
            }, 750);

            const wrapper = document.getElementById('main-icestudio-wrapper');
            wrapper.classList.add('icestudio-taking-snapshot-video');
          } catch (error) {
            console.error('MediaRecorder::ERROR', error);

            isRecording = false;
            alertify.error(
              gettextCatalog.getString(
                'Screen recording error. Review your permissions.'
              ),
              10
            );
          }
        } else {
          const wrapper = document.getElementById('main-icestudio-wrapper');
          mediaRecorder.stop();
          stream.getTracks().forEach((track) => track.stop());
          wrapper.classList.remove('icestudio-taking-snapshot-video');
          isRecording = false;
        }
      };

      this.selectBoardPrompt = function (callback) {
        // Disable user events
        utils.disableKeyEvents();

        // Hide Cancel button
        $('.ajs-cancel').addClass('hidden');

        //-- Create the form
        let form = new forms.FormSelectBoard();

        //-- Display the form
        form.display((evt) => {
          //-- Process the information in the form
          form.process(evt);

          //-- Read the selected board
          let selectedBoard = form.values[0];

          if (selectedBoard) {
            evt.cancel = false;

            //-- Execute the callback
            if (callback) {
              callback(selectedBoard);
            }

            // Enable user events
            utils.enableKeyEvents();
          }
        });
      };
    }
  );
