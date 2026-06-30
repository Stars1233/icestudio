'use strict';

angular
  .module('icestudio')
  .service(
    'utils',
    function (
      $rootScope,
      gettextCatalog,
      common,
      blocks,
      _package,
      nodeFs,
      nodeFse,
      nodePath,
      nodeChildProcess,
      nodeExtract,
      nodeSha1,
      nodeCP,
      nodeGetOS,
      nodeLangInfo,
      SVGO,
      fastCopy,
      shelljs,
      sparkMD5,
      fsLock
    ) {
      this.extractZip = function (source, destination, callback) {
        nodeExtract(
          source,
          {
            dir: destination,
          },
          function (error) {
            if (error) {
              callback(true);
            } else {
              callback();
            }
          }
        );
      };

      function disableEvent(event) {
        // Allow clicks inside the installer console panel
        if (
          event.target.closest &&
          event.target.closest('#console-wrapper, #console-toggle')
        ) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
      }

      this.enableClickEvents = function () {
        document.removeEventListener('click', disableEvent, true);
      };

      this.disableClickEvents = function () {
        document.addEventListener('click', disableEvent, true);
      };

      this.enableKeyEvents = function () {
        document.removeEventListener('keyup', disableEvent, true);
        document.removeEventListener('keydown', disableEvent, true);
        document.removeEventListener('keypress', disableEvent, true);
      };

      this.disableKeyEvents = function () {
        document.addEventListener('keyup', disableEvent, true);
        document.addEventListener('keydown', disableEvent, true);
        document.addEventListener('keypress', disableEvent, true);
      };

      //--------------------------------------------------------------
      //-- Execute the given system command
      //-- INPUTS:
      //--   -command: array of string containing the commands to
      //--    execute along with the arguments
      //--   -callback: Function called when the command executed is done
      //--   -notifyerror: Show a GUI notification if there is an error
      //--   -callbackAsync: Automatic callback if async.serial calls it
      //-------------------------------------------------------------------
      this.executeCommand = function (
        command,
        callback,
        notifyerror = true,
        callbackAsync = undefined
      ) {
        //-- Construct a string with the full command
        let cmd = command.join(' ');
        let _this = this;

        //-- Show the command in the DEBUG log
        iceConsole.log(`>>>> utils.executeCommand => ${cmd}\n`);

        //-- Array for storing the arguments
        let args = [];

        //-- Get the arguments, if any
        if (command.length > 0) {
          args = command.slice(1);
        }

        //-- Execute the command in background!!
        //-- Set env vars to force rich/Python to show progress in non-TTY
        let spawnEnv = Object.assign({}, process.env, {
          PYTHONUNBUFFERED: '1',
          FORCE_COLOR: '1',
          TERM: process.env.TERM || 'xterm',
          COLUMNS: '80',
        });

        let proccess = nodeChildProcess.spawn(command[0], args, {
          shell: true,
          env: spawnEnv,
        });

        //-- String with the latest output to pass to the callback function
        let output = '';

        //-- When there are outputs available from the command...
        proccess.stdout.on('data', function (data) {
          //-- Show the output in the log
          iceConsole.log(`>>(OUTPUT): ${data}\n`);

          var chunk = data.toString();
          common.commandOutput = command.join(' ') + '\n\n' + chunk;
          $(document).trigger('commandOutputChanged', [chunk]);

          //-- Accumulate the output string
          //-- to pass to the callback function
          output += data.toString();
        });

        //-- If there are errors ...
        proccess.stderr.on('data', function (data) {
          //-- Show them in the log file
          iceConsole.log(`>>(ERROR): ${data}\n`);

          var chunk = data.toString();
          common.commandOutput = command.join(' ') + '\n\n' + chunk;
          $(document).trigger('commandOutputChanged', [chunk]);
        });

        proccess.on('close', function (code) {
          iceConsole.log(`>>>> executeCommand: process closed, code=${code}`);

          if (code !== 0 && code !== null) {
            _this.enableKeyEvents();
            _this.enableClickEvents();

            iceConsole.log('----!!!! ERROR !!!! -----');
            iceConsole.log('CMD: ' + command);

            //-- Error executing the command
            //-- Show the error notification
            if (notifyerror) {
              var errMsg = 'Error executing command ' + command;
              alertify.error(errMsg, 30);
              $(document).trigger('commandOutputChanged', [
                '\n[ERROR] ' + errMsg + '\n',
              ]);
            }

            //-- Comand finished with errors. Call the callback function
            if (typeof callback !== 'undefined' && callback !== null) {
              callback(true, output);
            }
            if (typeof callbackAsync !== 'undefined') {
              callbackAsync();
            }
          } else {
            //-- Command finished with NO errors. Call the callback function
            if (typeof callback !== 'undefined' && callback !== null) {
              callback(false, output);
            }
            if (typeof callbackAsync !== 'undefined') {
              callbackAsync();
            }
          }
        });
      };

      //-----------------------------------------------------------------
      //-- Check if there is internet connection
      //--
      this.isOnline = function (callback, error) {
        if (navigator.onLine) {
          callback();
        } else {
          error();
          callback(true);
        }
      };

      //-----------------------------------------------------
      //-- Get the latest release info from a GitHub repo.
      //-- Calls callback(error, releaseObject).
      //--
      //-- Get a GitHub release. channel 'stable' (default) → /releases/latest
      //-- (latest non-prerelease); channel 'ci' → the most recent published
      //-- release from /releases (includes prereleases / nightly builds).
      this.getLatestGithubRelease = function (owner, repo, callback, channel) {
        var https = require('https');
        var ci = channel === 'ci';
        var apiPath = ci
          ? '/repos/' + owner + '/' + repo + '/releases?per_page=10'
          : '/repos/' + owner + '/' + repo + '/releases/latest';
        var options = {
          hostname: 'api.github.com',
          path: apiPath,
          headers: {
            'User-Agent': 'Icestudio',
            'Accept': 'application/vnd.github.v3+json',
          },
        };

        https
          .get(options, function (response) {
            var body = '';
            response.on('data', function (chunk) {
              body += chunk;
            });
            response.on('end', function () {
              if (response.statusCode !== 200) {
                callback(
                  'GitHub API error (HTTP ' + response.statusCode + '): ' + body
                );
                return;
              }
              try {
                var parsed = JSON.parse(body);
                if (ci) {
                  //-- releases list (newest first): take the latest published
                  if (Array.isArray(parsed) && parsed.length > 0) {
                    callback(null, parsed[0]);
                  } else {
                    callback('No CI releases found');
                  }
                } else {
                  callback(null, parsed);
                }
              } catch (e) {
                callback('Failed to parse GitHub response: ' + e.message);
              }
            });
          })
          .on('error', function (err) {
            callback('GitHub API request failed: ' + err.message);
          });
      };

      //-----------------------------------------------------
      //-- Download a file from a URL to a local path.
      //-- Handles GitHub redirects (301/302).
      //--
      this.downloadFile = function (url, destPath, callback) {
        var https = require('https');

        var doRequest = function (currentUrl) {
          https
            .get(
              currentUrl,
              { headers: { 'User-Agent': 'Icestudio' } },
              function (response) {
                // Handle redirects (GitHub releases redirect to CDN)
                if (
                  response.statusCode === 301 ||
                  response.statusCode === 302
                ) {
                  doRequest(response.headers.location);
                  return;
                }
                if (response.statusCode !== 200) {
                  callback(
                    'Download failed with status: ' + response.statusCode
                  );
                  return;
                }
                var file = nodeFs.createWriteStream(destPath);
                response.pipe(file);
                file.on('finish', function () {
                  file.close(function () {
                    callback();
                  });
                });
                file.on('error', function (err) {
                  nodeFs.unlink(destPath, function () {});
                  callback(err.message);
                });
              }
            )
            .on('error', function (err) {
              nodeFs.unlink(destPath, function () {});
              callback(err.message);
            });
        };

        doRequest(url);
      };

      //-----------------------------------------------------
      //-- Download and extract the apio bundle.
      //--
      this.downloadAndExtractBundle = function (url, destDir, callback) {
        var self = this;
        // Ensure cache dir exists
        if (!nodeFs.existsSync(common.CACHE_DIR)) {
          nodeFs.mkdirSync(common.CACHE_DIR, { recursive: true });
        }
        // Ensure destination dir exists
        if (!nodeFs.existsSync(destDir)) {
          nodeFs.mkdirSync(destDir, { recursive: true });
        }

        var ext = common.APIO_BUNDLE_EXT;
        var tempFile = nodePath.join(common.CACHE_DIR, 'apio-bundle.' + ext);

        self.downloadFile(url, tempFile, function (error) {
          if (error) {
            callback(error);
            return;
          }

          if (ext === 'zip') {
            //-- The Windows apio bundle zip uses backslash ("\") path
            //-- separators and wraps everything in a single top-level folder
            //-- ("apio\..."). extract-zip (yauzl) rejects backslash filenames
            //-- ("invalid characters in fileName") and silently produces an
            //-- EMPTY bundle. Extract manually with adm-zip instead: normalize
            //-- the separators and strip the wrapper folder (equivalent to the
            //-- tar --strip-components=1 used for the tgz on macOS/Linux).
            try {
              var AdmZip = require('adm-zip');
              var zip = new AdmZip(tempFile);
              zip.getEntries().forEach(function (entry) {
                if (entry.isDirectory) {
                  return;
                }
                var name = entry.entryName
                  .replace(/\\/g, '/') //-- normalize backslash separators
                  .replace(/^[^/]+\//, ''); //-- strip top-level wrapper folder
                if (!name) {
                  return;
                }
                var outPath = nodePath.join(destDir, name);
                nodeFs.mkdirSync(nodePath.dirname(outPath), {
                  recursive: true,
                });
                nodeFs.writeFileSync(outPath, entry.getData());
              });
              try {
                nodeFs.unlinkSync(tempFile);
              } catch (e) {}
              callback();
            } catch (zipError) {
              try {
                nodeFs.unlinkSync(tempFile);
              } catch (e) {}
              callback(
                zipError && zipError.message
                  ? zipError.message
                  : String(zipError)
              );
            }
          } else {
            // macOS: clear xattr on tgz BEFORE extracting (per apio docs)
            // This prevents quarantine/provenance on all extracted files
            var xattrCmd = common.DARWIN
              ? 'xattr -c "' + tempFile + '" && '
              : '';
            // --strip-components=1 removes the top-level directory from the archive
            var command =
              xattrCmd +
              'tar xzf "' +
              tempFile +
              '" -C "' +
              destDir +
              '" --strip-components=1';
            nodeChildProcess.exec(command, function (execError) {
              // Clean up temp file
              try {
                nodeFs.unlinkSync(tempFile);
              } catch (e) {}
              if (execError) {
                callback(execError.message);
                return;
              }
              // Set executable permission
              try {
                nodeFs.chmodSync(common.APIO_EXE, '755');
              } catch (e) {}
              callback();
            });
          }
        });
      };

      //-----------------------------------------------------
      //-- Repair OS permissions.
      //--
      //
      this.repairPermissions = function (callback) {
        if (iceStudio.env.DARWIN === true) {
          // Clear extended attributes on both the apio bundle dir and the
          // packages dir (quarantine, provenance). Without this, macOS
          // Gatekeeper blocks binaries like yosys, nextpnr, realpath, etc.
          nodeChildProcess.exec(
            'xattr -cr "' +
              common.APIO_BUNDLE_DIR +
              '" "' +
              common.APIO_HOME +
              '"',
            function () {
              // Ignore errors (files may not have xattr)
              if (typeof callback !== 'undefined' && callback !== null) {
                callback();
              }
            }
          );
        } else {
          if (typeof callback !== 'undefined' && callback !== null) {
            callback();
          }
        }
      };

      //------------------------------------------------------------------
      //-- Install an Apio package
      //-- apio packages install [pkg]
      //--
      this.apioInstall = function (pkg, callback) {
        var params = [common.APIO_CMD, 'packages', 'install', '--verbose'];
        if (pkg) {
          params.push(pkg);
        }
        this.executeCommand(params, null, true, callback);
      };

      //-- The toolchains are NOT disabled by default
      this.toolchainDisabled = false;

      //------------------------------------------------------------------------
      //-- Get the command that should be used for executing the apio toolchain
      //-- This command includes the full path to apio executable, as well as
      //-- the setting of the APIO_HOME_DIR environment variable
      this.getApioExecutable = function () {
        //-- Check if the ICESTUDIO_APIO env variable is set with the apio
        //-- toolchain to use or if it has been set on the package.json file
        let candidateApio = process.env.ICESTUDIO_APIO
          ? process.env.ICESTUDIO_APIO
          : _package.apio.external;

        //-- There is an alternative apio toolchain ready
        if (nodeFs.existsSync(candidateApio)) {
          if (!this.toolchainDisabled) {
            // Show message only on start
            alertify.message(
              gettextCatalog.getString('Using external Apio: {{name}}', {
                name: candidateApio,
              }),
              5
            );
          }
          this.toolchainDisabled = true;
          return coverPath(candidateApio);
        }

        //-- There are no external apio toolchain. Use the one installed
        //-- by icestudio
        this.toolchainDisabled = false;

        //-- The apio command to execute is located in the
        //-- common.APIO_CMD global object
        return common.APIO_CMD;
      };

      //-----------------------------------------------------------------------
      //-- Remove the toolchains and related folders
      //--
      this.removeToolchain = function () {
        //-- Remove the apio bundle directory
        this.deleteFolderRecursive(common.APIO_BUNDLE_DIR);

        //-- Remove APIO home dir (stores apio packages)
        this.deleteFolderRecursive(common.APIO_HOME);

        //-- Remove the cache dir (temporal)
        this.deleteFolderRecursive(common.CACHE_DIR);
      };

      this.removeCollections = function () {
        this.deleteFolderRecursive(common.INTERNAL_COLLECTIONS_DIR);
      };

      this.deleteFolderRecursive = function (path) {
        if (nodeFs.existsSync(path)) {
          nodeFs.readdirSync(path).forEach(
            function (file /*, index*/) {
              var curPath = nodePath.join(path, file);
              if (nodeFs.lstatSync(curPath).isDirectory()) {
                // recursive
                this.deleteFolderRecursive(curPath);
              } else {
                // delete file
                nodeFs.unlinkSync(curPath);
              }
            }.bind(this)
          );
          nodeFs.rmdirSync(path);
        }
      };

      this.sep = nodePath.sep;

      this.basename = basename;

      function basename(filepath) {
        let b = nodePath.basename(filepath);
        return b.substr(0, b.lastIndexOf('.'));
      }

      this.dirname = function (filepath) {
        return nodePath.dirname(filepath);
      };

      this.filepath2buildpath = function (filepath) {
        let b = nodePath.basename(filepath);
        let localdir = filepath.substr(0, filepath.lastIndexOf(b));
        let dirname = b.substr(0, b.lastIndexOf('.'));
        let path = nodePath.join(localdir, 'ice-build');
        // If we want to remove spaces
        // return nodePath.join(path,dirname).replace(/ /g, '_');
        return nodePath.join(path, dirname);
      };

      //----------------------------------------------------
      //-- Read the profile file
      //--
      this.readFile = function (filepath) {
        return new Promise(function (resolve, reject) {
          if (nodeFs.existsSync(common.PROFILE_PATH)) {
            nodeFs.readFile(filepath, 'utf8', function (err, content) {
              if (err) {
                reject(err.toString());
              } else {
                var data = false;
                data = isJSON(content);

                if (data) {
                  resolve(data);
                } else {
                  reject();
                }
              }
            });
          } else {
            resolve({});
          }
        });
      };

      this.saveFile = async function (filepath, data) {
        return new Promise(async function (resolve, reject) {
          try {
            // Verify if file exists
            if (!nodeFs.existsSync(filepath)) {
              // If not exists we need to create empty file to block it until write it
              nodeFs.writeFileSync(filepath, '');
            }
            // Try to get the file ownership
            const release = await fsLock.lock(filepath, { retries: 10 }); // Retry 10 times if is locked

            var content = data;
            if (typeof data !== 'string') {
              content = JSON.stringify(data, null, 2);
            }

            nodeFs.writeFile(filepath, content, async function (err) {
              if (err) {
                await release();
                reject(err.toString());
              } else {
                await release();
                resolve();
              }
            });
          } catch (error) {
            reject('Error while locking the file: ' + error.toString());
          }
        });
      };

      //-- Atomically read-modify-write a file under the same lock as saveFile.
      //-- `transform(currentContent | null)` returns the new content string.
      //-- Used for per-key profile merges so concurrent writers (other windows)
      //-- don't clobber each other's keys.
      this.updateFileAtomic = async function (filepath, transform) {
        return new Promise(async function (resolve, reject) {
          try {
            if (!nodeFs.existsSync(filepath)) {
              nodeFs.writeFileSync(filepath, '');
            }
            const release = await fsLock.lock(filepath, { retries: 10 });
            try {
              var current = nodeFs.readFileSync(filepath, 'utf8');
              if (current === '') {
                current = null;
              }
              nodeFs.writeFileSync(filepath, transform(current));
              await release();
              resolve();
            } catch (inner) {
              await release();
              reject(inner.toString());
            }
          } catch (error) {
            reject('Error while locking the file: ' + error.toString());
          }
        });
      };

      function isJSON(content) {
        try {
          return JSON.parse(content);
        } catch (e) {
          return false;
        }
      }

      this.setLocale = function (locale, callback) {
        // Update current locale format
        locale = splitLocale(locale);
        // Load supported languages
        var supported = getSupportedLanguages();
        // Set the best matching language
        var bestLang = bestLocale(locale, supported);
        gettextCatalog.setCurrentLanguage(bestLang);
        // Application strings
        gettextCatalog.loadRemote(
          nodePath.join(common.LOCALE_DIR, bestLang, bestLang + '.json')
        );
        // Collections strings
        var collections = [common.defaultCollection]
          .concat(common.internalCollections)
          .concat(common.externalCollections);
        for (var c in collections) {
          var collection = collections[c];
          //-- Defensive: a collection slot may be null/incomplete very early at
          //-- startup (e.g. defaultCollection not loaded yet). Skip it instead
          //-- of dereferencing collection.path and throwing on the language path.
          if (!collection || !collection.path) {
            continue;
          }
          var filepath = nodePath.join(
            collection.path,
            'locale',
            bestLang,
            bestLang + '.json'
          );
          if (nodeFs.existsSync(filepath)) {
            gettextCatalog.loadRemote('file://' + filepath);
          }
        }
        if (callback) {
          setTimeout(function () {
            callback();
          }, 50);
        }
        // Return the best language
        return bestLang;
      };

      function splitLocale(locale) {
        var ret = {};
        var list = locale.split('_');
        if (list.length > 0) {
          ret.lang = list[0];
        }
        if (list.length > 1) {
          ret.country = list[1];
        }
        return ret;
      }

      function getSupportedLanguages() {
        var supported = [];
        nodeFs
          .readdirSync(common.LOCALE_DIR)
          .forEach(function (element /*, index*/) {
            var curPath = nodePath.join(common.LOCALE_DIR, element);
            if (nodeFs.lstatSync(curPath).isDirectory()) {
              supported.push(splitLocale(element));
            }
          });
        return supported;
      }

      function bestLocale(locale, supported) {
        var i;
        // 1. Try complete match
        if (locale.country) {
          for (i = 0; i < supported.length; i++) {
            if (
              locale.lang === supported[i].lang &&
              locale.country === supported[i].country
            ) {
              return supported[i].lang + '_' + supported[i].country;
            }
          }
        }
        // 2. Try lang match
        for (i = 0; i < supported.length; i++) {
          if (locale.lang === supported[i].lang) {
            return (
              supported[i].lang +
              (supported[i].country ? '_' + supported[i].country : '')
            );
          }
        }
        // 3. Return default lang
        return 'en';
      }

      this.projectinfoprompt = function (values, callback) {
        var i;
        var content = [];
        var messages = [
          gettextCatalog.getString('Name'),
          gettextCatalog.getString('Version'),
          gettextCatalog.getString('Description'),
          gettextCatalog.getString('Author'),
        ];
        var n = messages.length;
        var image = values[4];
        var blankImage =
          'data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=';
        content.push('<div>');
        for (i in messages) {
          content.push('  <p>' + messages[i] + '</p>');
          content.push(
            '  <input class="ajs-input" id="input' +
              i +
              '" type="text" value="' +
              values[i] +
              '">'
          );
        }
        content.push('  <p>' + gettextCatalog.getString('Image') + '</p>');
        content.push(
          '  <input id="input-open-svg" type="file" accept=".svg" class="hidden">'
        );
        content.push('  <div>');
        if (image) {
          let embeded = '<div id="preview-svg-wrapper">';
          /*  if (image.startsWith('%3Csvg')) {
            embeded += decodeURI(image);
          }
          else if (image.startsWith('<svg')) {
            embeded+= image;
          }*/
          let virtualBlock = new IceBlock({
            cacheDirImg: common.IMAGE_CACHE_DIR,
          });

          let tmpImage = '';
          let tmpImageSrc = '';
          let hash = '';
          if (image.startsWith('%3Csvg')) {
            tmpImage = decodeURI(image);
          } else if (image.startsWith('<svg')) {
            tmpImage = image;
          }
          if (tmpImage.length > 0) {
            hash = sparkMD5.hash(tmpImage);
            tmpImageSrc = virtualBlock.svgFile(hash, tmpImage);
            embeded = `${embeded}<img src="file://${tmpImageSrc}"/>`;
          }

          embeded += '</div">';

          content.push(embeded);
        } else {
          content.push(
            '  <div id="preview-svg-wrapper"><img id="preview-svg" class="ajs-input" src="' +
              blankImage +
              '" height="68" style="pointer-events:none"></div>'
          );
        }
        content.push('  </div>');
        content.push('  <div>');
        content.push(
          '    <label for="input-open-svg" class="btn">' +
            gettextCatalog.getString('Open SVG') +
            '</label>'
        );
        content.push(
          '    <label id="save-svg" class="btn">' +
            gettextCatalog.getString('Save SVG') +
            '</label>'
        );
        content.push(
          '    <label id="reset-svg" class="btn">' +
            gettextCatalog.getString('Reset SVG') +
            '</label>'
        );
        content.push('  </div>');
        content.push('</div>');
        // Restore values
        for (i = 0; i < n; i++) {
          $('#input' + i).val(values[i]);
        }

        var prevOnshow = alertify.confirm().get('onshow') || function () {};

        alertify.confirm().set('onshow', function () {
          prevOnshow();
          registerOpen();
          registerSave();
          registerReset();
        });

        function registerOpen() {
          // Open SVG
          var chooserOpen = $('#input-open-svg');
          chooserOpen.unbind('change');
          chooserOpen.change(function (/*evt*/) {
            var filepath = $(this).val();

            nodeFs.readFile(filepath, 'utf8', function (err, data) {
              if (err) {
                throw err;
              }
              optimizeSVG(data, function (result) {
                image = encodeURI(result.data);
                registerSave();

                $('#preview-svg-wrapper').html(result.data);
              });
            });
            $(this).val('');
          });
        }

        function optimizeSVG(data, callback) {
          SVGO.optimize(data, callback);
        }

        function registerSave() {
          // Save SVG
          var label = $('#save-svg');
          if (image) {
            label.removeClass('disabled');
            label.off('click').on('click', function () {
              if (!image) {
                return;
              }
              window
                .showSaveFilePicker({
                  suggestedName: 'image.svg',
                  types: [
                    {
                      description: 'SVG files',
                      accept: { 'image/svg+xml': ['.svg'] },
                    },
                  ],
                })
                .then(function (handle) {
                  return handle
                    .createWritable()
                    .then(function (writable) {
                      return writable.close();
                    })
                    .then(function () {
                      return handle.getFile();
                    })
                    .then(function (file) {
                      var filepath = file.path;
                      if (filepath) {
                        if (!filepath.endsWith('.svg')) {
                          filepath += '.svg';
                        }
                        nodeFs.writeFile(
                          filepath,
                          decodeURI(image),
                          function (err) {
                            if (err) {
                              throw err;
                            }
                          }
                        );
                      }
                    });
                })
                .catch(function (err) {
                  if (err.name !== 'AbortError') {
                    console.error('Save SVG error:', err);
                  }
                });
            });
          } else {
            label.addClass('disabled');
            label.off('click');
          }
        }

        function registerReset() {
          // Reset SVG
          var reset = $('#reset-svg');
          reset.click(function (/*evt*/) {
            image = '';
            registerSave();
            $('#preview-svg-wrapper').empty();
          });
        }

        alertify
          .confirm(content.join('\n'))
          .set('onok', function (evt) {
            var values = [];
            for (var i = 0; i < n; i++) {
              values.push($('#input' + i).val());
            }
            values.push(image);
            if (callback) {
              callback(evt, values);
            }
            // Restore onshow
            alertify.confirm().set('onshow', prevOnshow);
          })
          .set('oncancel', function (/*evt*/) {
            // Restore onshow
            alertify.confirm().set('onshow', prevOnshow);
          });
      };

      this.copySync = function (orig, dest) {
        var ret = true;
        try {
          if (nodeFs.existsSync(orig)) {
            nodeFse.copySync(orig, dest);
          } else {
            // Error: file does not exist
            ret = false;
          }
        } catch (e) {
          alertify.error(
            gettextCatalog.getString('Error: {{error}}', {
              error: e.toString(),
            }),
            30
          );
          ret = false;
        }
        return ret;
      };

      this.findIncludedFiles = function (code) {
        var ret = [];
        var patterns = [
          /[\n|\s]\/\/\s*@include\s+([^\s]*\.(v|vh))(\n|\s)/g,
          /[\n|\s][^\/]?\"(.*\.list?)\"/g,
        ];
        for (var p in patterns) {
          var match;
          while ((match = patterns[p].exec(code))) {
            var file = match[1].replace(/ /g, '');
            if (ret.indexOf(file) === -1) {
              ret.push(file);
            }
          }
        }
        return ret;
      };

      //-----------------------------------------------------------------------
      //-- Return a text in bold HTML
      //-- Input:
      //--    * text: String to convert to Bold
      //-- Returns:
      //--    * The HTML text in bold
      //-----------------------------------------------------------------------
      this.bold = function (text) {
        return `<b>${text}</b>`;
      };

      //-----------------------------------------------------------------------
      //-- Open the Dialog for choosing a file
      //--
      //-- INPUTS:
      //--   * inputID (String): Html selector of the file chooser input
      //--
      //--   * callback(filepath): It is called when the user has pressed the
      //--        ok button. The chosen file is passed as a parameter
      //-----------------------------------------------------------------------
      this.openDialog = function (inputID, callback) {
        //-- Get the file chooser element (from the DOM)
        let chooser = $(inputID);

        //-- Remove any previously event attached
        chooser.unbind('change');

        //-- Attach a new callback function
        chooser.change(function () {
          //-- It is executed when the user has selected the file
          //-- Read the filepath entered by the user
          let filepath = $(this).val();

          //-- Execute the callback (if it was given)
          if (callback) {
            callback(filepath);
          }

          //-- Remove the current select filename from the chooser
          $(this).val('');
        });

        //-- Activate the File chooser! (The element is shown, it waits for
        //-- the user to enter the file, and the callback is executed)
        chooser.trigger('click');
      };

      this.saveDialog = function (suggestedName, ext, callback) {
        var _this = this;
        var selectedDir = '';
        var html =
          '<div class="form-group">' +
          '<label>' +
          gettextCatalog.getString('Design name') +
          ':</label>' +
          '<input type="text" id="save-dialog-name" class="ajs-input" value="' +
          suggestedName +
          '" style="width:100%;margin-top:4px;" />' +
          '</div>' +
          '<div class="form-group">' +
          '<label>' +
          gettextCatalog.getString('Location') +
          ':</label>' +
          '<div style="display:flex;gap:8px;align-items:center;margin-top:4px;">' +
          '<input type="text" id="save-dialog-dir" class="ajs-input" readonly ' +
          'style="flex:1;cursor:pointer;background:#f5f5f5;" ' +
          'placeholder="' +
          gettextCatalog.getString('Click to select folder...') +
          '" />' +
          '</div>' +
          '</div>';

        alertify.confirm(
          gettextCatalog.getString('Save As'),
          html,
          function () {
            var nameInput = document.getElementById('save-dialog-name');
            var dirInput = document.getElementById('save-dialog-dir');
            var name = nameInput ? nameInput.value.trim() : '';
            var dir = dirInput ? dirInput.value.trim() : '';
            if (!name || !dir) {
              alertify.warning(
                gettextCatalog.getString(
                  'Please enter a name and select a folder'
                )
              );
              return false;
            }
            if (!name.endsWith(ext)) {
              name += ext;
            }
            var filepath = nodePath.join(dir, name);
            if (nodeFs.existsSync(filepath)) {
              setTimeout(function () {
                alertify.confirm(
                  gettextCatalog.getString('File already exists'),
                  gettextCatalog.getString(
                    '"{{name}}" already exists. Do you want to replace it?',
                    { name: name }
                  ),
                  function () {
                    if (callback) {
                      callback(filepath);
                    }
                  },
                  function () {
                    // User cancelled overwrite
                  }
                );
              }, 300);
            } else if (callback) {
              callback(filepath);
            }
          },
          function () {
            // cancelled
          }
        );

        // Set up directory picker via click on the dir input
        setTimeout(function () {
          var dirInput = document.getElementById('save-dialog-dir');
          if (dirInput) {
            dirInput.addEventListener('click', function () {
              _this.directoryDialog(
                '#input-choose-save-dir',
                function (dirpath) {
                  dirInput.value = dirpath;
                  selectedDir = dirpath;
                }
              );
            });
          }
          // Focus the name input and select its text
          var nameInput = document.getElementById('save-dialog-name');
          if (nameInput) {
            nameInput.focus();
            nameInput.select();
          }
        }, 100);
      };

      this.directoryDialog = function (inputID, callback) {
        var chooser = $(inputID);
        chooser.unbind('change');
        chooser.change(function () {
          var dirpath = $(this).val();
          if (callback) {
            callback(dirpath);
          }
          $(this).val('');
        });
        chooser.trigger('click');
      };

      this.updateWindowTitle = function (title) {
        document.title = title;
      };

      this.rootScopeSafeApply = function () {
        if (!$rootScope.$$phase) {
          $rootScope.$apply();
        }
      };

      this.parsePortLabel = function (data, pattern) {
        // e.g.: name[x:y]
        var match,
          ret = {};
        var maxSize = 95;
        pattern = pattern || common.PATTERN_PORT_LABEL;
        match = pattern.exec(data);
        if (match && match[0] === match.input) {
          ret.name = match[1] ? match[1] : '';
          ret.rangestr = match[2];
          if (match[2]) {
            if (match[3] > maxSize || match[4] > maxSize) {
              alertify.warning(
                gettextCatalog.getString('Maximum bus size: 96 bits'),
                5
              );
              return null;
            } else {
              if (match[3] > match[4]) {
                ret.range = _.range(match[3], parseInt(match[4]) - 1, -1);
              } else {
                ret.range = _.range(match[3], parseInt(match[4]) + 1, +1);
              }
            }
          }
          return ret;
        }
        return null;
      };

      this.parseParamLabel = function (data, pattern) {
        // e.g.: name
        var match,
          ret = {};
        pattern = pattern || common.PATTERN_PARAM_LABEL;
        match = pattern.exec(data);
        if (match && match[0] === match.input) {
          ret.name = match[1] ? match[1] : '';
          return ret;
        }
        return null;
      };

      //-----------------------------------------------------------------------
      //-- clone. Return a deep copy of the given input object data
      //--  * data: Input object to copy
      //--  * Returns: A copy of the input object
      //-----------------------------------------------------------------------
      this.clone = function (data) {
        //-- Implementation using the fast-copy npm package:
        //-- More info: https://www.npmjs.com/package/fast-copy
        return fastCopy(data);

        //-- Alternative implementation:
        // Very slow in comparison but more stable for all types
        // of objects, if fails, rollback to JSON method or try strict
        // on fast-copy module
        //return JSON.parse(JSON.stringify(data));
      };

      this.dependencyID = function (dependency) {
        if (dependency.package && dependency.design) {
          return nodeSha1(
            JSON.stringify(dependency.package) +
              JSON.stringify(dependency.design)
          );
        }
      };

      //-----------------------------------------------------------------------
      //-- Compute the canonical, content-addressed dependency id of a block.
      //-- Mirrors the recipe project.addBlock uses to assign a block's id
      //-- (pruneBlock + dependencyID), so an id produced here matches the
      //-- dependency key a design carries for that same block. Used to check
      //-- whether a block belongs to an installed collection.
      //-- NOTE: 'generic-*' blocks get a timestamp otid at add time, so their
      //-- id is intentionally non-deterministic (they are treated as local).
      //-----------------------------------------------------------------------
      this.blockId = function (block) {
        block = this.clone(block);
        if (!block || !block.package || !block.design || !block.design.graph) {
          return false;
        }
        delete block.version;
        delete block.design.board;
        var bs = block.design.graph.blocks || [];
        for (var i = 0; i < bs.length; i++) {
          var t = bs[i].type;
          if (
            t === 'basic.input' ||
            t === 'basic.output' ||
            t === 'basic.inputLabel' ||
            t === 'basic.outputLabel'
          ) {
            if (bs[i].data.size === undefined) {
              var pins = bs[i].data.pins;
              bs[i].data.size =
                pins && pins.length > 1 ? pins.length : undefined;
            }
            delete bs[i].data.pins;
            delete bs[i].data.virtual;
          }
        }
        return this.dependencyID(block);
      };

      //-- Read a block .ice file from disk and return its canonical block id
      //-- (or false on any error / invalid content).
      this.blockIdFromFile = function (filepath) {
        try {
          var data = JSON.parse(nodeFs.readFileSync(filepath, 'utf8'));
          return this.blockId(data);
        } catch (e) {
          return false;
        }
      };

      //-- All collection ids contributed by a block .ice file: the block's own
      //-- canonical id PLUS every embedded sub-dependency id. The embedded
      //-- sub-blocks are collection content too, so editing one (at any depth)
      //-- must fork rather than mutate the collection's block.
      this.collectionIdsFromFile = function (filepath) {
        var ids = [];
        try {
          var data = JSON.parse(nodeFs.readFileSync(filepath, 'utf8'));
          var top = this.blockId(data);
          if (top) {
            ids.push(top);
          }
          if (data.dependencies) {
            for (var k in data.dependencies) {
              ids.push(k);
            }
          }
        } catch (e) {
          // ignore unreadable / invalid block files
        }
        return ids;
      };

      //-----------------------------------------------------------------------
      //-- Create a new ICESTUDIO window
      //--
      //--  INPUTS:
      //--    * filepath: (optional) Icestudio file to open in the new window
      //-----------------------------------------------------------------------
      this.newWindow = function (filepath) {
        //-- If there are parameters to pass or not
        //-- No parameters by default
        let hasParams = false;

        //-- URL with no parameters
        let url = 'index.html';

        //-- Create the arguments
        //-- The filepath was given: pass it as an argument
        if (filepath) {
          //-- There are params in the URL
          hasParams = true;

          //-- Create the object params
          //-- Currently it only contains one element, but in the future
          //-- it can be increased
          let params = {
            filepath: filepath,
          };

          //-- Convert the params to json
          let jsonParams = JSON.stringify(params);

          //-- Encode the params into Base64 format
          let paramsBase64 = Buffer.from(jsonParams).toString('base64');

          //-- Create the URL query with the icestudio_argv param
          let icestudioArgv = '?icestudio_argv=' + paramsBase64;

          //-- Create the final URL, with parameters
          url += icestudioArgv;
        }

        //-- Get the Window configuration from the package.json
        let window = this.clone(_package.window);

        //-- Set some needed properties:
        window['new_instance'] = true;
        window['show'] = true;

        //-- The URL has this syntax:
        //
        //-- index.html?icestudio_argv=encoded_value
        //--
        //-- Where encoded value is something like:
        //--     eyJmaWxlcGF0aCI6Ii9ob21lL29iaWp1YW4vRGV2ZW...

        //-----------------------------------------------------------
        //-- Open the new window
        //-- More information:
        //-- https://nwjs.readthedocs.io/en/latest/References/Window/
        //--   #windowopenurl-options-callback
        //-----------------------------------------------------------
        //nw.Window.open(url, window);
        nw.Window.open(url);
      };

      //-- Place the path inside quotes. It is important for managing filepaths
      //-- that contains spaces in their names
      this.coverPath = coverPath;

      function coverPath(filepath) {
        return '"' + filepath + '"';
      }

      this.mergeDependencies = function (type, block) {
        if (type in common.allDependencies) {
          return; // If the block is already in dependencies
        }
        // Merge the block's dependencies
        var deps = block.dependencies;
        for (var depType in deps) {
          if (!(depType in common.allDependencies)) {
            common.allDependencies[depType] = deps[depType];
          }
        }
        // Add the block as a dependency
        delete block.dependencies;
        common.allDependencies[type] = block;
      };

      this.copyToClipboard = function (selection, graph) {
        var cells = selectionToCells(selection, graph);
        var clipboard = {
          icestudio: this.cellsToProject(cells, graph),
        };

        // Send the clipboard object the global clipboard as a string
        nodeCP.copy(JSON.stringify(clipboard), function () {
          // Success
        });
      };

      this.pasteFromClipboard = function (profile, callback) {
        var _this = this;
        nodeCP.paste(function (err, text) {
          if (err) {
            if (common.LINUX) {
              // xclip installation message
              var cmd = '';
              var message = gettextCatalog.getString('{{app}} is required.', {
                app: '<b>xclip</b>',
              });
              nodeGetOS(function (e, os) {
                if (!e) {
                  if (
                    os.dist.indexOf('Debian') !== -1 ||
                    os.dist.indexOf('Ubuntu Linux') !== -1 ||
                    os.dist.indexOf('Linux Mint') !== -1
                  ) {
                    cmd = 'sudo apt-get install xclip';
                  } else if (os.dist.indexOf('Fedora')) {
                    cmd = 'sudo dnf install xclip';
                  } else if (
                    os.dist.indexOf('RHEL') !== -1 ||
                    os.dist.indexOf('RHAS') !== -1 ||
                    os.dist.indexOf('Centos') !== -1 ||
                    os.dist.indexOf('Red Hat Linux') !== -1
                  ) {
                    cmd = 'sudo yum install xclip';
                  } else if (os.dist.indexOf('Arch Linux') !== -1) {
                    cmd = 'sudo pacman install xclip';
                  }
                  if (cmd) {
                    message +=
                      ' ' +
                      gettextCatalog.getString('Please run: {{cmd}}', {
                        cmd: '<br><b><code>' + cmd + '</code></b>',
                      });
                  }
                }
                alertify.warning(message, 30);
              });
            }
          } else {
            // Parse the global clipboard
            var clipboard = JSON.parse(text);
            if (callback && clipboard && clipboard.icestudio) {
              const block = clipboard.icestudio;
              if (block.version === common.VERSION) {
                _this.approveProjectBlock(profile, block).then((result) => {
                  if (result === 'cancel') {
                    return;
                  }
                  callback(block);
                });
              } else {
                alertify.error(
                  gettextCatalog.getString(
                    'Cannot paste from a different project format ({{version}})',
                    { version: block.version }
                  ),
                  5
                );
              }
            }
          }
        });
      };

      this.duplicateSelected = function (selection, graph, callback) {
        let cells = selectionToCells(selection, graph);
        let content = this.cellsToProject(cells, graph);
        if (callback && content) {
          callback(content);
        }
      };

      function selectionToCells(selection, graph) {
        var cells = [];
        var blocksMap = {};
        selection.each(function (block) {
          // Add block
          cells.push(block.attributes);
          // Map blocks
          blocksMap[block.id] = block;
          // Add connected wires
          var processedWires = {};
          var connectedWires = graph.getConnectedLinks(block);
          _.each(connectedWires, function (wire) {
            if (processedWires[wire.id]) {
              return;
            }

            var source = blocksMap[wire.get('source').id];
            var target = blocksMap[wire.get('target').id];

            if (source && target) {
              cells.push(wire.attributes);
              processedWires[wire.id] = true;
            }
          });
        });
        return cells;
      }

      this.cellsToProject = function (cells, opt) {
        // Convert a list of cells into the following sections of a project:
        // - design.graph
        // - dependencies

        var _blocks = [];
        var wires = [];
        var p = {
          version: common.VERSION,
          design: {},
          dependencies: {},
        };

        opt = opt || {};

        for (var c = 0; c < cells.length; c++) {
          var cell = cells[c];

          if (
            cell.type === 'ice.Generic' ||
            cell.type === 'ice.Input' ||
            cell.type === 'ice.Output' ||
            cell.type === 'ice.Code' ||
            cell.type === 'ice.Info' ||
            cell.type === 'ice.Constant' ||
            cell.type === 'ice.Memory'
          ) {
            var block = {};
            block.id = cell.id;
            block.type = cell.blockType;
            block.data = cell.data;
            block.position = cell.position;
            if (
              cell.type === 'ice.Generic' ||
              cell.type === 'ice.Code' ||
              cell.type === 'ice.Info' ||
              cell.type === 'ice.Memory'
            ) {
              block.size = cell.size;
            }
            _blocks.push(block);
          } else if (cell.type === 'ice.Wire') {
            var wire = {};
            wire.source = {
              block: cell.source.id,
              port: cell.source.port,
            };
            wire.target = {
              block: cell.target.id,
              port: cell.target.port,
            };
            wire.vertices = cell.vertices;
            wire.size = cell.size > 1 ? cell.size : undefined;
            wires.push(wire);
          }
        }

        p.design.board = common.selectedBoard.name;
        p.design.graph = {
          blocks: _blocks,
          wires: wires,
        };

        // Update dependencies
        if (opt.deps !== false) {
          var types = this.findSubDependencies(p, common.allDependencies);
          for (var t in types) {
            p.dependencies[types[t]] = common.allDependencies[types[t]];
          }
        }

        return p;
      };

      this.findSubDependencies = function (dependency) {
        var subDependencies = [];
        if (dependency) {
          for (var i in dependency.design.graph.blocks) {
            var type = dependency.design.graph.blocks[i].type;
            if (type.indexOf('basic.') === -1) {
              subDependencies.push(type);
              var newSubDependencies = this.findSubDependencies(
                common.allDependencies[type]
              );
              subDependencies = subDependencies.concat(newSubDependencies);
            }
          }
          return _.unique(subDependencies);
        }
        return subDependencies;
      };

      // Check for Advanced block being opened or imported: If it has tri-state, and user does not have
      // Advanced profile setting for tri-state, user needs to approve or cancel
      //
      // Return 'cancel' or return 'ok' or a variant of 'ok'
      this.approveProjectBlock = function (profile, block, isLoad) {
        if (profile.get('allowInoutPorts') || common.allowProjectInoutPorts) {
          return Promise.resolve('ok');
        }

        const hasInoutPorts = checkIsAnyInout(block);
        if (!hasInoutPorts) {
          return Promise.resolve('ok');
        }

        // user can approve by either updating profile 'allowInoutPorts' or setting
        // flag common.allowProjectInoutPorts
        const prompt =
          (isLoad
            ? gettextCatalog.getString(
                'You are loading a design that uses \"tri-state\".'
              )
            : gettextCatalog.getString(
                'You are importing a block that uses \"tri-state\".'
              )) +
          ' ' +
          gettextCatalog.getString(
            'Tri-state (aka high-Z, bidirectional, or inout) ports are not recommended in standard designs.<br /><br />You will be asked to update your Preferences (Advanced user setting) or you can just open this design on a preview basis.<br /><br />Continue?'
          );
        return new Promise((resolve) => {
          alertify.confirm(
            prompt,
            () => {
              resolve('ok');
            },
            () => {
              resolve('cancel');
            }
          );
        }).then((result) => {
          if (result === 'cancel') {
            return result;
          }

          return new Promise((resolve) => {
            alertify.set('confirm', 'defaultFocus', 'cancel');
            alertify
              .confirm(
                gettextCatalog.getString(
                  'Click \"Yes\" to allow tri-state and update Preferences:<br />&nbsp;&nbsp;&nbsp;<b>Advanced features → Allow tri-state connections</b><br /><br />Click \"This time\" to view tri-state for this design only.'
                ),
                () => {
                  profile.set('allowInoutPorts', true);
                  alertify.warning(
                    gettextCatalog.getString(
                      'Changed Preferences: Allow tri-state connections'
                    )
                  );
                  resolve('ok_advanced');
                },
                () => {
                  common.allowProjectInoutPorts = true;
                  alertify.warning(
                    gettextCatalog.getString('Viewing tri-state')
                  );
                  resolve('ok_this_time');
                }
              )
              .set('labels', {
                ok: gettextCatalog.getString('Yes'),
                cancel: gettextCatalog.getString('This time'),
              });
          }).then((result) => {
            alertify.set('confirm', 'defaultFocus', 'ok');
            alertify.set('confirm', 'labels', {
              ok: gettextCatalog.getString('OK'),
              cancel: gettextCatalog.getString('Cancel'),
            });
            return result;
          });
        });
      };

      function checkIsAnyInout(project) {
        if (_checkIsAnyInout(project)) {
          return true;
        }
        for (var d in project.dependencies) {
          if (_checkIsAnyInout(project.dependencies[d])) {
            return true;
          }
        }

        function _checkIsAnyInout(_project) {
          for (var i in _project.design.graph.blocks) {
            var block = _project.design.graph.blocks[i];
            switch (block.type) {
              case blocks.BASIC_INPUT:
              case blocks.BASIC_OUTPUT:
                if (block.data.inout) {
                  return true;
                }
                break;
              case blocks.BASIC_CODE:
                if (
                  block.data.ports.inoutLeft &&
                  block.data.ports.inoutLeft.length
                ) {
                  return true;
                }
                if (
                  block.data.ports.inoutRight &&
                  block.data.ports.inoutRight.length
                ) {
                  return true;
                }
                break;
              default:
                // Generic block
                break;
            }
          }
          return false;
        }
        return false;
      }

      this.hasInputRule = function (port, apply) {
        apply = apply === undefined ? true : apply;
        var _default;
        var rules = common.selectedBoard.rules;
        if (rules) {
          var allInitPorts = rules.input;
          if (allInitPorts) {
            for (var i in allInitPorts) {
              if (port === allInitPorts[i].port) {
                _default = allInitPorts[i];
                _default.apply = apply;
                break;
              }
            }
          }
        }
        return _.clone(_default);
      };

      this.hasLeftButton = function (evt) {
        return evt.which === 1;
      };

      this.hasMiddleButton = function (evt) {
        return evt.which === 2;
      };

      this.hasRightButton = function (evt) {
        return evt.which === 3;
      };

      this.hasButtonPressed = function (evt) {
        return evt.which !== 0;
      };

      this.hasShift = function (evt) {
        return evt.shiftKey;
      };

      this.hasCtrl = function (evt) {
        return evt.ctrlKey;
      };

      //------------------------------------------------------
      //-- Load the profile file
      this.loadProfile = function (profile, callback) {
        profile.load(function () {
          if (callback) {
            callback();
          }
        });
      };

      this.loadLanguage = function (profile, callback) {
        var lang = profile.get('language');
        if (lang) {
          this.setLocale(lang, callback);
        } else {
          // If lang is empty, use the system language
          nodeLangInfo(
            function (err, sysLang) {
              if (!err) {
                profile.set('language', this.setLocale(sysLang, callback));
              }
            }.bind(this)
          );
        }
      };

      this.normalizeVerilogName = function (str) {
        // 1. Standardize and remove accents
        str = str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        // 2. Replace Spanish ñ by n
        str = str.replace(/ñ/g, 'n').replace(/Ñ/g, 'N'); // Reemplazar 'ñ' y 'Ñ' por 'n' y 'N'

        // 3. Replace spaces by _
        str = str.replace(/[\s-]/g, '_');

        // 4. Remove non valid characters (others than letters, numbers and _)
        str = str.replace(/[^a-zA-Z0-9_]/g, '');

        // 5. if string start by numbers, add a _
        if (/^\d/.test(str)) {
          str = '_' + str;
        }

        return str;
      };

      this.digestId = function (id) {
        if (id.indexOf('-') !== -1) {
          id = nodeSha1(id).toString();
        }
        return 'v' + id.substring(0, 6);
      };

      this.beginBlockingTask = async function () {
        angular.element('#menu').addClass('is-disabled');
        //document.body.classList.add('waiting');
        document.getElementById('spin-blocking-task').classList.add('waiting');
        await new Promise(requestAnimationFrame);
      };

      this.endBlockingTask = function () {
        $('body').trigger('Graph::updateWires');
        $('.code-editor.ace_editor').each(function () {
          const editor = ace.edit(this);
          setTimeout(() => {
            editor.resize();
          }, 300);
        });

        // setTimeout(function(){
        angular.element('#menu').removeClass('is-disabled');

        document
          .getElementById('spin-blocking-task')
          .classList.remove('waiting');
        //  $('body').removeClass('waiting');
        // },1000);
      };

      this.isFunction = function (functionToCheck) {
        return (
          functionToCheck &&
          {}.toString.call(functionToCheck) === '[object Function]'
        );
      };

      this.openDevToolsUI = function () {
        nw.Window.get().showDevTools();
      };

      //-----------------------------------------------------------
      //-- Open a given url in an external browser
      //--
      //--  INPUTS:
      //--   * url (String): The URL to show
      //-----------------------------------------------------------
      this.openUrlExternalBrowser = function (url) {
        nw.Shell.openExternal(url);
      };

      // RENDERFORM "color-dropdown" functions
      // show/hide dropdown list
      $(document).on('mousedown', '.lb-dropdown-title', function () {
        if ($('.lb-dropdown-menu').hasClass('show')) {
          closeDropdown();
        } else {
          openDropdown();
        }
      });
      $(document).on('mouseleave', '.lb-dropdown-menu', function () {
        closeDropdown();
      });
      $(document).on('mouseenter', '.ajs-button', function () {
        closeDropdown();
      });
      // get selected option
      $(document).on('mousedown', '.lb-dropdown-option', function () {
        let selected = this;
        $('.lb-dropdown-title').html(
          '<span class="lb-selected-color color-' +
            selected.dataset.color +
            '" data-color="' +
            selected.dataset.color +
            '"></span>' +
            selected.dataset.name +
            '<span class="lb-dropdown-icon"></span>'
        );
        closeDropdown();
      });

      function openDropdown() {
        $('.lb-dropdown-menu').addClass('show');
      }
      function closeDropdown() {
        $('.lb-dropdown-menu').removeClass('show');
      }

      this.renderForm = function (specs, callback) {
        var content = [];
        content.push('<div>');
        for (var i in specs) {
          var spec = specs[i];
          switch (spec.type) {
            case 'text':
              content.push(
                '\
              <p>' +
                  spec.title +
                  '</p>\
              <input class="ajs-input" type="text" id="form' +
                  i +
                  '" autocomplete="off"/>\
              '
              );
              break;
            case 'checkbox':
              content.push(
                '\
                <div class="checkbox">\
                <label><input type="checkbox" ' +
                  (spec.value ? 'checked' : '') +
                  ' id="form' +
                  i +
                  '"/>' +
                  spec.label +
                  '</label>\
                </div>\
                '
              );
              break;
            case 'combobox':
              var options = spec.options
                .map(function (option) {
                  var selected = spec.value === option.value ? ' selected' : '';
                  return (
                    '<option value="' +
                    option.value +
                    '"' +
                    selected +
                    '>' +
                    option.label +
                    '</option>'
                  );
                })
                .join('');
              content.push(
                '\
              <div class="form-group">\
              <label style="font-weight:normal">' +
                  spec.label +
                  '</label>\
              <select class="form-control" id="form' +
                  i +
                  '">\
              ' +
                  options +
                  '\
              </select>\
              </div>\
              '
              );
              break;
            case 'color-dropdown':
              content.push(
                '\
                <div class="form-group">\
                <label style ="font-weight:normal">' +
                  spec.label +
                  '</label>\
                <div class="lb-color--dropdown">\
                <div class="lb-dropdown-title"><span class="lb-selected-color color-fuchsia" data-color="fuchsia" data-name="Fuchsia"></span>Fuchsia<span class="lb-dropdown-icon"></span></div>\
                <div class="lb-dropdown-menu">\
                <div class="lb-dropdown-option" data-color="indianred" data-name="IndianRed"><span class="lb-option-color color-indianred"></span>IndianRed</div>\
                <div class="lb-dropdown-option" data-color="red" data-name="Red"><span class="lb-option-color color-red"></span>Red</div>\
                <div class="lb-dropdown-option" data-color="deeppink" data-name="DeepPink"><span class="lb-option-color color-deeppink"></span>DeepPink</div>\
                <div class="lb-dropdown-option" data-color="mediumvioletred"data-name="MediumVioletRed"><span class="lb-option-color color-mediumvioletred"></span>MediumVioletRed</div>\
                <div class="lb-dropdown-option" data-color="coral"data-name="Coral"><span class="lb-option-color color-coral"></span>Coral</div>\
                <div class="lb-dropdown-option" data-color="orangered"data-name="OrangeRed"><span class="lb-option-color color-orangered"></span>OrangeRed</div>\
                <div class="lb-dropdown-option" data-color="darkorange"data-name="DarkOrange"><span class="lb-option-color color-darkorange"></span>DarkOrange</div>\
                <div class="lb-dropdown-option" data-color="gold"data-name="Gold"><span class="lb-option-color color-gold"></span>Gold</div>\
                <div class="lb-dropdown-option" data-color="yellow"data-name="Yellow"><span class="lb-option-color color-yellow"></span>Yellow</div>\
                <div class="lb-dropdown-option" data-color="fuchsia"data-name="Fuchsia"><span class="lb-option-color color-fuchsia"></span>Fuchsia</div>\
                <div class="lb-dropdown-option" data-color="slateblue"data-name="SlateBlue"><span class="lb-option-color color-slateblue"></span>SlateBlue</div>\
                <div class="lb-dropdown-option" data-color="greenyellow"data-name="GreenYellow"><span class="lb-option-color color-greenyellow"></span>GreenYellow</div>\
                <div class="lb-dropdown-option" data-color="springgreen"data-name="SpringGreen"><span class="lb-option-color color-springgreen"></span>SpringGreen</div>\
                <div class="lb-dropdown-option" data-color="darkgreen"data-name="DarkGreen"><span class="lb-option-color color-darkgreen"></span>DarkGreen</div>\
                <div class="lb-dropdown-option" data-color="olivedrab"data-name="OliveDrab"><span class="lb-option-color color-olivedrab"></span>OliveDrab</div>\
                <div class="lb-dropdown-option" data-color="lightseagreen"data-name="LightSeaGreen"><span class="lb-option-color color-lightseagreen"></span>LightSeaGreen</div>\
                <div class="lb-dropdown-option" data-color="turquoise"data-name="Turquoise"><span class="lb-option-color color-turquoise"></span>Turquoise</div>\
                <div class="lb-dropdown-option" data-color="steelblue"data-name="SteelBlue"><span class="lb-option-color color-steelblue"></span>SteelBlue</div>\
                <div class="lb-dropdown-option" data-color="deepskyblue"data-name="DeepSkyBlue"><span class="lb-option-color color-deepskyblue"></span>DeepSkyBlue</div>\
                <div class="lb-dropdown-option" data-color="royalblue"data-name="RoyalBlue"><span class="lb-option-color color-royalblue"></span>RoyalBlue</div>\
                <div class="lb-dropdown-option" data-color="navy"data-name="Navy"><span class="lb-option-color color-navy"></span>Navy</div>\
                <div class="lb-dropdown-option" data-color="lightgray"data-name="LightGray"><span class="lb-option-color color-lightgray"></span>LightGray</div>\
                </div>\
                </div>\
                </div>\
                '
              );
              break;
          }
        }
        content.push('</div>');

        alertify
          .confirm(content.join('\n'))
          .set('onok', function (evt) {
            var values = [];
            if (callback) {
              for (var i in specs) {
                var spec = specs[i];
                switch (spec.type) {
                  case 'text':
                  case 'combobox':
                    values.push($('#form' + i).val());
                    break;
                  case 'checkbox':
                    values.push($('#form' + i).prop('checked'));
                    break;
                  case 'color-dropdown':
                    values.push($('.lb-selected-color').data('color'));
                    break;
                }
              }
              callback(evt, values);
            }
          })
          .set('oncancel', function (/*evt*/) {});

        // Restore input values
        setTimeout(function () {
          $('#form0').select();
          for (var i in specs) {
            var spec = specs[i];
            switch (spec.type) {
              case 'text':
              case 'combobox':
                $('#form' + i).val(spec.value);
                break;
              case 'checkbox':
                $('#form' + i).prop('checked', spec.value);
                break;
              case 'color-dropdown':
                $('.lb-dropdown-title').html(
                  '<span class="lb-selected-color color-fuchsia" data-color="fuchsia"></span>Fuchsia<span class="lb-dropdown-icon"></span>'
                );
                break;
            }
          }
        }, 50);
      };

      function processModule(moduleCode, headerComments, moduleHeaderComments) {
        const inputRegex =
          /\binput\s+(wire\s+|signed\s+|wire signed\s+)?(\[[^\]]+\]\s+)?([\w\s,]+)(?=\s*[,;])/gm;
        const inputANSIRegex =
          /\binput\s+(wire\s+|signed\s+|wire signed\s+)?(\[[^\]]+\]\s+)?([\w\s,]+?)(?=,?\s*\boutput\b|,?\s*\binput\b|$)/gm;
        const outputRegex =
          /\boutput\s+(reg\s+|wire\s+|signed\s+|wire signed\s+|reg signed\s+)?(\[[^\]]+\]\s+)?([\w\s,]+)(?=\s*[,;])/gm;
        const outputANSIRegex =
          /\boutput\s+(reg\s+|wire\s+|signed\s+|wire signed\s+|reg signed\s+)?(\[[^\]]+\]\s+)?([\w\s,]+?)(?=,?\s*\binput\b|,?\s*\s*$)/gm;

        const inoutRegex =
          /\binout\s+(wire\s+|signed\s+|wire signed\s+)?(\[[^\]]+\]\s+)?([\w\s,]+)(?=\s*[,;])/gm;
        const inoutANSIRegex =
          /\binout\s+(reg\s+|wire\s+|signed\s+|wire signed\s+|reg signed\s+)?(\[[^\]]+\]\s+)?([\w\s,]+?)(?=,?\s*\binput\b|,?\s*\boutput\b|,?\s*\binout\b|,?\s*$)/gm;
        const paramRegex = /parameter\s+(\w+)(?:\s*=\s*([^,;]+))?;?/g;
        const headerParamRegex = /#\(\s*parameter\s+(\w+)\s*=\s*([^,;]+)\s*\)/g;

        const metaBlock = {
          moduleName: '',
          inputs: '',
          outputs: '',
          inouts: '',
          parameters: '',
          moduleBody: '',
          headerComments: headerComments,
        };

        const moduleRegex =
          /module\s+(\w+)\s*(#\([\s\S]*?\))?\s*\(([\s\S]*?)\)\s*;\s*([\s\S]*?)\s*endmodule/;
        const moduleMatch = moduleCode.match(moduleRegex);

        if (moduleMatch) {
          metaBlock.moduleName = moduleMatch[1];
          let moduleBody = moduleMatch[4]?.trim() || '';

          const headerParamBlock = moduleMatch[2] || '';
          const headerParameters = [
            ...headerParamBlock.matchAll(headerParamRegex),
          ].map((match) => ({
            name: match[1].trim(),
            value: match[2]?.trim() || null,
          }));

          const bodyParameters = [...moduleBody.matchAll(paramRegex)].map(
            (match) => ({
              name: match[1].trim(),
              value: match[2]?.trim() || null,
            })
          );

          // Remove extracted parameter definitions from body
          moduleBody = moduleBody.replace(paramRegex, '').trim();

          const allParameters = [...headerParameters, ...bodyParameters];
          if (allParameters.length > 0) {
            metaBlock.parameters = allParameters
              .map((param) => param.name)
              .join(', ');
          }

          // For future use:
          //const ioNames = ( moduleMatch[3] )? moduleMatch[3].split(",").map((name) => name.trim()) : [];

          // ANSI Verilog IO Definitios
          const ansiInputs = extractIO(inputANSIRegex, moduleMatch[3]);
          const ansiOutputs = extractIO(outputANSIRegex, moduleMatch[3]);
          const ansiInouts = extractIO(inoutANSIRegex, moduleMatch[3]);

          // Verilog 1995 IO definitions
          const bodyInputs = processSignals(inputRegex, moduleBody);
          const bodyOutputs = processSignals(outputRegex, moduleBody);
          const bodyInouts = processSignals(inoutRegex, moduleBody);

          const inputs = [...ansiInputs, ...bodyInputs].filter(
            (signal) =>
              !ansiOutputs.includes(signal) && !ansiInouts.includes(signal)
          );
          const outputs = [...ansiOutputs, ...bodyOutputs].filter(
            (signal) =>
              !ansiInputs.includes(signal) && !ansiInouts.includes(signal)
          );
          const inouts = [...ansiInouts, ...bodyInouts].filter(
            (signal) =>
              !ansiInputs.includes(signal) && !ansiOutputs.includes(signal)
          );

          if (inputs.length > 0) {
            metaBlock.inputs = inputs.join(', ');
          }
          if (outputs.length > 0) {
            metaBlock.outputs = outputs.join(', ');
          }
          if (inouts.length > 0) {
            metaBlock.inouts = inouts.join(', ');
          }

          // Remove IO definitions from module body, including adjacent comments
          const allIORegex = /^\s*\b(input|output|inout)\b[^\n]*$/gm;

          moduleBody = moduleBody.replace(allIORegex, '').trim();

          let fullModuleBody = headerComments;
          if (moduleHeaderComments) {
            fullModuleBody += '\n\n' + moduleHeaderComments;
          }
          fullModuleBody += '\n\n' + moduleBody;
          metaBlock.moduleBody = fullModuleBody;
        }

        return metaBlock;
      }

      function removeComments(code) {
        return code.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '');
      }
      //-- Verilog 1995 IO definition from module body
      function processSignals(regex, block) {
        block = removeComments(block);
        return [...block.matchAll(regex)].flatMap((match) => {
          const range = match[2]?.trim() || '';
          const names = match[3]
            .split(/,\s*/)
            .map((name) => name.trim())
            .flatMap((name) =>
              name.includes('\n') ? name.split(/\s+/).filter((n) => n) : [name]
            );
          return names.map((name) => (range ? `${name}${range}` : name)); // swap name and range for Icestudio conventions
        });
      }

      //-- ANSI Verilog IO definition extractor from module header
      function extractIO(regex, header) {
        if (!header) {
          return [];
        }
        header = removeComments(header);
        const matches = [...header.matchAll(regex)];
        return matches
          .map((match) => {
            const range = match[2]?.trim() || '';
            const names = match[3].split(/,\s*/).map((name) => name.trim());
            return names.map((name) => {
              if (range) {
                return `${name}${range}`.trim(); // swap name and range for Icestudio conventions
              } else {
                return name.trim();
              }
            });
          })
          .flat()
          .map((name) => {
            // Remove keywords input/output/inout
            return name.replace(/\b(input|output|inout)\b/g, '').trim();
          });
      }

      this.parseVerilog = async function (code) {
        const headerCommentsRegex =
          /^(\/\/.*$|\/\*[\s\S]*?\*\/)(?:\r?\n(\/\/.*$|\/\*[\s\S]*?\*\/))*/gm;
        const moduleRegex =
          /module\s+(\w+)\s*(#\([\s\S]*?\))?\s*\(([\s\S]*?)\)\s*;\s*([\s\S]*?)\s*endmodule/gm;

        const metaBlock = {
          moduleName: '',
          inputs: '',
          outputs: '',
          inouts: '',
          parameters: '',
          moduleBody: '',
          headerComments: '',
        };

        const allHeaderMatches = code.matchAll(headerCommentsRegex);
        const headerCommentsMatch = allHeaderMatches.next().value;

        if (headerCommentsMatch) {
          metaBlock.headerComments = headerCommentsMatch[0].trim();
          code = code.replace(headerCommentsMatch[0], '').trim();
        }

        let moduleMatches;
        const modules = [];
        while ((moduleMatches = moduleRegex.exec(code)) !== null) {
          const moduleName = moduleMatches[1];

          const startOfModule = moduleMatches.index;
          const endOfModule =
            code.indexOf('endmodule', startOfModule) + 'endmodule'.length;
          const moduleContent = code.substring(startOfModule, endOfModule);

          const preModuleContent = code.substring(0, startOfModule).trim();
          const moduleHeaderCommentsRegex =
            /((?:\/\/.*(?:\r?\n|$))+|\/\*[\s\S]*?\*\/)\s*$/gm;
          const moduleHeaderCommentsMatch = [
            ...preModuleContent.matchAll(moduleHeaderCommentsRegex),
          ];
          const moduleHeaderComments =
            moduleHeaderCommentsMatch.length > 0
              ? moduleHeaderCommentsMatch[
                  moduleHeaderCommentsMatch.length - 1
                ][0].trim()
              : '';

          modules.push({
            name: moduleName,
            headerComments: moduleHeaderComments,
            content: moduleContent,
          });
        }

        if (modules.length > 1) {
          const selectedModule = await showModuleSelectionModal(modules);
          const headerComments = metaBlock.headerComments; //+ "\n\n" + selectedModule.headerComments;

          const parsedModule = processModule(
            selectedModule.content,
            headerComments,
            selectedModule.headerComments
          );

          return parsedModule;
        } else if (modules.length === 1) {
          const selectedModule = modules[0];

          const headerComments = metaBlock.headerComments;
          const parsedModule = processModule(
            selectedModule.content,
            headerComments,
            selectedModule.headerComments
          );

          return parsedModule;
        }

        return metaBlock;
      };

      async function showModuleSelectionModal(modules) {
        return new Promise((resolve) => {
          const modalDiv = document.createElement('div');
          modalDiv.className = 'modal';

          const modalContent = document.createElement('div');
          modalContent.className = 'modal-content';

          const title = document.createElement('h4');
          title.innerText = 'Select a Module to Import';
          modalContent.appendChild(title);

          const moduleList = document.createElement('ul');

          modules.forEach((module, index) => {
            const listItem = document.createElement('li');

            listItem.innerText = module.name;

            listItem.addEventListener('click', function () {
              resolve(modules[index]);
              document.body.removeChild(modalDiv);
            });

            moduleList.appendChild(listItem);
          });

          modalContent.appendChild(moduleList);
          modalDiv.appendChild(modalContent);
          document.body.appendChild(modalDiv);
        });
      }
    }
  );
