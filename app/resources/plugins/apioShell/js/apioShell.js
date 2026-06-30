/* jshint esversion: 6 */
/* global Terminal, pluginRoot, pluginHost, pluginUUID, registerEvents,
          iceStudio, appEnv, alertify, angular */

// ─── Node modules (available in NW.js embedded context) ─────────────────────
var nodeChildProcess = require('child_process');
var nodeFs = require('fs');
var nodePath = require('path');

// ─── State ──────────────────────────────────────────────────────────────────
var term = null;
var shellReady = false;
var currentProcess = null;
var buildDir = '';
var cwd = '';
var apioCmd = '';
var apioHome = '';
var ossCadBinDir = '';

// Input state
var inputBuffer = '';
var cursorPos = 0;
var history = [];
var historyIndex = -1;
var historyTmp = '';

// Interactive process echo state — tracks chars typed since last process output
var procEchoCount = 0;

// Confirmation mode (for rm)
var confirmCallback = null;

// ─── Whitelist of allowed oss-cad-suite binaries ────────────────────────────
var OSS_CAD_TOOLS = [
  'yosys',
  'yosys-abc',
  'yosys-config',
  'yosys-filterlib',
  'yosys-smtbmc',
  'nextpnr-ice40',
  'nextpnr-ecp5',
  'nextpnr-generic',
  'nextpnr-himbaechel',
  'nextpnr-machxo2',
  'nextpnr-nexus',
  'iceprog',
  'iceprogduino',
  'icemulti',
  'icepack',
  'icetime',
  'ecppack',
  'openFPGALoader',
  'gtkwave',
];

// ─── Built-in commands ──────────────────────────────────────────────────────
var BUILTIN_COMMANDS = [
  'cd',
  'ls',
  'pwd',
  'clear',
  '@help',
  '@compile',
  '@verify',
  '@build',
  '@upload',
  '@clean',
  'rm',
  'cat',
  'make',
];

// ─── Apio subcommands that accept the -p/--project-dir option ───────────────
// Only these commands may receive the injected project directory. Global
// flags (--version, --help) and non-project commands (examples, drivers,
// packages, docs, info, raw, api, ...) error out with "No such option: -p"
// if given one, so they must be forwarded to apio verbatim.
var APIO_PROJECT_COMMANDS = [
  'build',
  'upload',
  'clean',
  'lint',
  'format',
  'sim',
  'test',
  'report',
  'graph',
  'create',
  'boards',
  'fpgas',
];

// ─── Apio subcommands that operate on the compiled design ───────────────────
// These need a saved project and generated build files (main.v, apio.ini, ...)
// before running. Other apio commands (informational or global) are passed
// through directly, without forcing a save or a design compilation.
var APIO_DESIGN_COMMANDS = [
  'build',
  'upload',
  'lint',
  'format',
  'sim',
  'test',
  'report',
  'graph',
];

// ─── PROMPT ─────────────────────────────────────────────────────────────────
var PROMPT_COLOR = '\x1b[1;36m'; // cyan bold
var RESET_COLOR = '\x1b[0m';
var ERROR_COLOR = '\x1b[1;31m';
var DIR_COLOR = '\x1b[1;34m';
var INFO_COLOR = '\x1b[0;33m';

function getPromptText() {
  var rel = nodePath.relative(buildDir, cwd);
  var suffix = rel ? '/' + rel : '';
  return (
    PROMPT_COLOR +
    'apio' +
    RESET_COLOR +
    ':' +
    DIR_COLOR +
    '~' +
    suffix +
    RESET_COLOR +
    '$ '
  );
}

function getPromptLength() {
  var rel = nodePath.relative(buildDir, cwd);
  var suffix = rel ? '/' + rel : '';
  // "apio:~<suffix>$ " — plain text length (no ANSI)
  return ('apio:~' + suffix + '$ ').length;
}

function showPrompt() {
  inputBuffer = '';
  cursorPos = 0;
  historyIndex = -1;
  historyTmp = '';
  term.write('\r\n' + getPromptText());
}

// ─── SANDBOX path validation ────────────────────────────────────────────────
function resolveSandboxPath(p) {
  var resolved = nodePath.resolve(cwd, p);
  if (!resolved.startsWith(buildDir)) {
    return null; // outside sandbox
  }
  return resolved;
}

// ─── UPDATE BUILD DIR (called when project changes) ─────────────────────────
function updateBuildDir() {
  if (!appEnv || !shellReady || !term) {
    return;
  }
  var newBuildDir = appEnv.BUILD_DIR || appEnv.BUILD_DIR_TMP || '';
  if (newBuildDir && newBuildDir !== buildDir) {
    buildDir = newBuildDir;
    cwd = buildDir;
    apioCmd = appEnv.APIO_CMD || apioCmd;
    apioHome = appEnv.APIO_HOME || apioHome;
    ossCadBinDir = nodePath.join(apioHome, 'packages', 'oss-cad-suite', 'bin');
    term.writeln('');
    term.writeln(INFO_COLOR + '  Project changed: ' + buildDir + RESET_COLOR);
    if (!currentProcess) {
      showPrompt();
    }
  }
}

// ─── FIT ADDON (official xterm-addon-fit) ───────────────────────────────────
var fitAddon = null;

// ─── NOTIFICATION (green border when command finishes while minimized) ───────
function notifyIfMinimized() {
  var winEl = document.getElementById(pluginUUID);
  if (winEl && winEl.classList.contains('ics-wm-window--minimized')) {
    winEl.classList.add('ics-wm-window--notify');
  }
}

// ─── INIT ───────────────────────────────────────────────────────────────────
function initShell() {
  if (shellReady || !appEnv) {
    return;
  }
  shellReady = true;

  buildDir = appEnv.BUILD_DIR || appEnv.BUILD_DIR_TMP || '';
  cwd = buildDir;
  apioCmd = appEnv.APIO_CMD || '';
  apioHome = appEnv.APIO_HOME || '';
  ossCadBinDir = nodePath.join(apioHome, 'packages', 'oss-cad-suite', 'bin');

  var container = pluginRoot.getElementById('terminal');
  if (!container) {
    return;
  }

  term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontSize: 13,
    fontFamily:
      "'Fira Code', 'Cascadia Code', 'JetBrains Mono', Menlo, Monaco, 'Courier New', monospace",
    theme: {
      background: '#1a1a2e',
      foreground: '#e0e0e0',
      cursor: '#00d4ff',
      selectionBackground: 'rgba(0, 212, 255, 0.3)',
      black: '#1a1a2e',
      red: '#ff6b6b',
      green: '#51cf66',
      yellow: '#ffd43b',
      blue: '#74c0fc',
      magenta: '#da77f2',
      cyan: '#66d9e8',
      white: '#e0e0e0',
      brightBlack: '#555',
      brightRed: '#ff8787',
      brightGreen: '#69db7c',
      brightYellow: '#ffe066',
      brightBlue: '#91d5ff',
      brightMagenta: '#e599f7',
      brightCyan: '#99e9f2',
      brightWhite: '#ffffff',
    },
    allowTransparency: false,
    scrollback: 5000,
    convertEol: true,
  });

  // Use the official FitAddon for proper terminal sizing
  fitAddon = new FitAddon();
  term.loadAddon(fitAddon);

  term.open(container);
  fitAddon.fit();
  term.focus();

  // ─── Auto-resize terminal when container resizes ────────────────────
  var resizeRAF = null;
  var resizeObserver = new ResizeObserver(function () {
    if (resizeRAF) {
      cancelAnimationFrame(resizeRAF);
    }
    resizeRAF = requestAnimationFrame(function () {
      if (fitAddon) {
        fitAddon.fit();
      }
    });
  });
  resizeObserver.observe(container);

  // ─── Clipboard support ─────────────────────────────────────────────
  // Copy on selection (like Linux terminals)
  term.onSelectionChange(function () {
    var sel = term.getSelection();
    if (sel) {
      try {
        var clipboard = nw.Clipboard.get();
        clipboard.set(sel, 'text');
      } catch (e) {
        // Fallback to navigator.clipboard
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(sel);
        }
      }
    }
  });

  // Paste with Ctrl+Shift+V (Ctrl+V is handled by xterm if enabled)
  container.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') {
      e.preventDefault();
      try {
        var clipboard = nw.Clipboard.get();
        var text = clipboard.get('text');
        if (text && term) {
          if (currentProcess) {
            try {
              currentProcess.stdin.write(text);
            } catch (err) {
              /* ignore */
            }
          } else {
            // Insert paste into input buffer
            for (var pi = 0; pi < text.length; pi++) {
              var pc = text[pi];
              if (pc === '\n' || pc === '\r') {
                continue; // skip newlines in paste
              }
              inputBuffer =
                inputBuffer.slice(0, cursorPos) +
                pc +
                inputBuffer.slice(cursorPos);
              cursorPos++;
            }
            redrawInput();
          }
        }
      } catch (err) {
        /* ignore clipboard errors */
      }
    }
  });

  // Welcome message
  term.writeln(
    INFO_COLOR +
      '  Apio Shell v1.0 — Type "@help" for shell commands' +
      RESET_COLOR
  );
  term.write(getPromptText());

  // ─── Input handling ─────────────────────────────────────────────────
  term.onData(function (data) {
    // If waiting for confirmation (rm)
    if (confirmCallback) {
      handleConfirmation(data);
      return;
    }

    // If a process is running, forward input to it with local echo
    if (currentProcess) {
      if (data === '\x03') {
        // Ctrl+C — kill process
        try {
          currentProcess.kill('SIGINT');
        } catch (e) {
          /* ignore */
        }
        currentProcess = null;
        term.write('^C');
        showPrompt();
      } else if (data === '\x04') {
        // Ctrl+D — send EOF
        try {
          currentProcess.stdin.end();
        } catch (e) {
          /* ignore */
        }
      } else {
        // Local echo: display typed characters since piped processes don't echo
        for (var ci = 0; ci < data.length; ci++) {
          var cc = data.charCodeAt(ci);
          if (data[ci] === '\r' || data[ci] === '\n') {
            term.write('\r\n');
            procEchoCount = 0;
          } else if (data[ci] === '\x7f' || cc === 8) {
            // Backspace — only erase if we have echoed characters to erase
            if (procEchoCount > 0) {
              term.write('\b \b');
              procEchoCount--;
            }
          } else if (data[ci] === '\x1b') {
            // Skip escape sequences (arrows etc.) — don't echo them
            break;
          } else if (cc >= 32) {
            term.write(data[ci]);
            procEchoCount++;
          }
        }
        // Forward raw input to stdin of running process
        try {
          if (currentProcess.stdin.writable) {
            currentProcess.stdin.write(data);
          }
        } catch (e) {
          /* ignore closed stdin */
        }
      }
      return;
    }

    // Normal input mode — no process running
    handleInput(data);
  });
}

// ─── INPUT HANDLING ─────────────────────────────────────────────────────────
function handleInput(data) {
  var i;

  for (i = 0; i < data.length; i++) {
    var ch = data[i];
    var code = data.charCodeAt(i);

    // ESC sequences (arrows, etc.)
    if (ch === '\x1b' && data[i + 1] === '[') {
      var seq = data[i + 2];
      if (seq === 'A') {
        // Up arrow
        navigateHistory(-1);
        i += 2;
        continue;
      } else if (seq === 'B') {
        // Down arrow
        navigateHistory(1);
        i += 2;
        continue;
      } else if (seq === 'C') {
        // Right arrow
        if (cursorPos < inputBuffer.length) {
          cursorPos++;
          term.write('\x1b[C');
        }
        i += 2;
        continue;
      } else if (seq === 'D') {
        // Left arrow
        if (cursorPos > 0) {
          cursorPos--;
          term.write('\x1b[D');
        }
        i += 2;
        continue;
      } else if (seq === '3' && data[i + 3] === '~') {
        // Delete key
        if (cursorPos < inputBuffer.length) {
          inputBuffer =
            inputBuffer.slice(0, cursorPos) + inputBuffer.slice(cursorPos + 1);
          redrawInput();
        }
        i += 3;
        continue;
      } else if (seq === 'H') {
        // Home
        while (cursorPos > 0) {
          cursorPos--;
          term.write('\x1b[D');
        }
        i += 2;
        continue;
      } else if (seq === 'F') {
        // End
        while (cursorPos < inputBuffer.length) {
          cursorPos++;
          term.write('\x1b[C');
        }
        i += 2;
        continue;
      }
      // Skip unknown sequences
      i += 2;
      continue;
    }

    // Enter
    if (ch === '\r' || ch === '\n') {
      term.write('\r\n');
      var line = inputBuffer.trim();
      if (line) {
        history.push(line);
        if (history.length > 100) {
          history.shift();
        }
        inputBuffer = '';
        cursorPos = 0;
        executeCommand(line);
      } else {
        term.write(getPromptText());
        inputBuffer = '';
        cursorPos = 0;
      }
      historyIndex = -1;
      historyTmp = '';
      return; // executeCommand will show prompt when done
    }

    // Ctrl+C — cancel current input
    if (code === 3) {
      inputBuffer = '';
      cursorPos = 0;
      term.write('^C');
      showPrompt();
      return;
    }

    // Ctrl+L — clear screen
    if (code === 12) {
      term.clear();
      term.write(getPromptText() + inputBuffer);
      // Reposition cursor
      var back = inputBuffer.length - cursorPos;
      for (var b = 0; b < back; b++) {
        term.write('\x1b[D');
      }
      return;
    }

    // Backspace
    if (ch === '\x7f' || code === 8) {
      if (cursorPos > 0) {
        inputBuffer =
          inputBuffer.slice(0, cursorPos - 1) + inputBuffer.slice(cursorPos);
        cursorPos--;
        redrawInput();
      }
      continue;
    }

    // Tab — basic autocomplete
    if (ch === '\t') {
      autoComplete();
      continue;
    }

    // Regular printable character
    if (code >= 32) {
      inputBuffer =
        inputBuffer.slice(0, cursorPos) + ch + inputBuffer.slice(cursorPos);
      cursorPos++;
      redrawInput();
    }
  }
}

function redrawInput() {
  // Move to start of input, clear line from cursor, rewrite
  var promptLen = getPromptLength();
  term.write('\r' + getPromptText() + inputBuffer + '\x1b[K');
  // Move cursor to correct position
  var back = inputBuffer.length - cursorPos;
  for (var i = 0; i < back; i++) {
    term.write('\x1b[D');
  }
}

function navigateHistory(dir) {
  if (history.length === 0) {
    return;
  }

  if (historyIndex === -1) {
    historyTmp = inputBuffer;
  }

  var newIndex = historyIndex + dir;

  if (dir === -1) {
    // Up
    if (historyIndex === -1) {
      newIndex = history.length - 1;
    } else if (newIndex < 0) {
      return;
    }
  } else {
    // Down
    if (newIndex >= history.length) {
      // Back to current input
      historyIndex = -1;
      inputBuffer = historyTmp;
      cursorPos = inputBuffer.length;
      redrawInput();
      return;
    }
  }

  historyIndex = newIndex;
  inputBuffer = history[historyIndex];
  cursorPos = inputBuffer.length;
  redrawInput();
}

// ─── AUTOCOMPLETE ───────────────────────────────────────────────────────────
function autoComplete() {
  var lineUpToCursor = inputBuffer.slice(0, cursorPos);
  var allParts = parseCommandLine(lineUpToCursor);
  var isFirstToken = allParts.length <= 1 && lineUpToCursor.match(/^\S*$/);

  var tokenInfo = extractLastToken(lineUpToCursor);
  var rawToken = tokenInfo.raw; // as typed, with escapes
  var parsedToken = tokenInfo.parsed; // unescaped, for FS lookup

  var candidates = [];
  var displayNames = []; // for showing multiple matches

  if (isFirstToken) {
    // Complete command names (built-ins + oss-cad tools)
    var allCmds = BUILTIN_COMMANDS.concat(OSS_CAD_TOOLS);
    candidates = allCmds.filter(function (c) {
      return c.startsWith(parsedToken);
    });
    displayNames = candidates;
  } else {
    // Complete file/directory names
    try {
      var dir = cwd;
      var prefix = parsedToken;
      var slashIdx = parsedToken.lastIndexOf('/');
      if (slashIdx >= 0) {
        var subdir = parsedToken.slice(0, slashIdx + 1);
        dir = resolveSandboxPath(subdir) || cwd;
        prefix = parsedToken.slice(slashIdx + 1);
      }
      var entries = nodeFs.readdirSync(dir);
      entries
        .filter(function (e) {
          return e.startsWith(prefix);
        })
        .forEach(function (e) {
          var full = nodePath.join(dir, e);
          var isDir = false;
          try {
            isDir = nodeFs.statSync(full).isDirectory();
          } catch (err) {
            /* ignore */
          }
          // Build the escaped candidate for insertion
          var basePath =
            slashIdx >= 0 ? parsedToken.slice(0, slashIdx + 1) : '';
          var escaped = shellEscape(basePath) + shellEscape(e);
          if (isDir) {
            escaped += '/';
          }
          candidates.push(escaped);
          displayNames.push(isDir ? e + '/' : e);
        });
    } catch (err) {
      // ignore
    }
  }

  if (candidates.length === 0) {
    return;
  }

  if (candidates.length === 1) {
    var completion = candidates[0].slice(rawToken.length);
    // Add space after commands and files (not directories)
    if (!candidates[0].endsWith('/')) {
      completion += ' ';
    }
    inputBuffer =
      inputBuffer.slice(0, cursorPos) +
      completion +
      inputBuffer.slice(cursorPos);
    cursorPos += completion.length;
    redrawInput();
  } else {
    // Show candidates
    term.write('\r\n');
    term.writeln(displayNames.join('  '));
    term.write(getPromptText() + inputBuffer);
    var back = inputBuffer.length - cursorPos;
    for (var i = 0; i < back; i++) {
      term.write('\x1b[D');
    }
  }
}

// ─── CONFIRMATION PROMPT ────────────────────────────────────────────────────
function askConfirmation(message, callback) {
  confirmCallback = callback;
  term.write(INFO_COLOR + message + ' [y/N] ' + RESET_COLOR);
}

function handleConfirmation(data) {
  var cb = confirmCallback;
  confirmCallback = null;
  var ch = data.trim().toLowerCase();
  term.write(ch + '\r\n');
  cb(ch === 'y');
}

// ─── SAVE-BEFORE-ACTION CHECK ───────────────────────────────────────────────
function isProjectUnsaved() {
  return (
    appEnv && appEnv.BUILD_DIR_TMP && appEnv.BUILD_DIR === appEnv.BUILD_DIR_TMP
  );
}

function requireSavedProject(callback) {
  if (!isProjectUnsaved()) {
    callback();
    return;
  }
  term.writeln(
    ERROR_COLOR +
      'Project must be saved before running this command.' +
      RESET_COLOR
  );
  try {
    var injector = angular.element(document.body).injector();
    var common = injector.get('common');
    var menuEl = document.querySelector('[ng-controller="MenuCtrl"]');
    var menuScope = angular.element(menuEl).scope();

    // Lower the plugin window z-index so alertify dialog is clickable
    var pluginWindow = document.getElementById(pluginUUID);
    var origZIndex = '';
    if (pluginWindow) {
      origZIndex = pluginWindow.style.zIndex;
      pluginWindow.style.zIndex = '1';
    }
    function restoreWindow() {
      if (pluginWindow) {
        pluginWindow.style.zIndex = origZIndex;
      }
    }

    setTimeout(function () {
      menuScope.saveProject(function () {
        restoreWindow();
        buildDir = common.BUILD_DIR;
        cwd = buildDir;
        term.writeln(INFO_COLOR + 'Project saved.' + RESET_COLOR);
        callback();
      });
    }, 150);
  } catch (err) {
    term.writeln(ERROR_COLOR + 'Error: ' + err.message + RESET_COLOR);
    showPrompt();
  }
}

// ─── COMMAND DISPATCH ───────────────────────────────────────────────────────
function executeCommand(line) {
  var parts = parseCommandLine(line);

  // Allow an optional leading "apio" token. The shell already wraps apio, but
  // users habitually type it (e.g. "apio --version"); strip it so it isn't
  // duplicated into "apio apio --version".
  if (parts.length > 0 && parts[0].toLowerCase() === 'apio') {
    parts = parts.slice(1);
    if (parts.length === 0) {
      // Bare "apio" → show apio's top-level help.
      spawnProcess(apioCmd, ['--help'], cwd);
      return;
    }
  }

  var cmd = parts[0].toLowerCase();
  var args = parts.slice(1);

  // Shell built-in commands
  if (cmd === '@help') {
    cmdHelp();
  } else if (cmd === '@compile') {
    requireSavedProject(function () {
      cmdCompile();
    });
  } else if (cmd === '@verify') {
    cmdNativeAction('verify');
  } else if (cmd === '@build') {
    cmdNativeAction('build');
  } else if (cmd === '@upload') {
    cmdNativeAction('upload');
  } else if (cmd === '@clean') {
    requireSavedProject(function () {
      cmdClean();
    });
  } else if (cmd === 'clear') {
    term.clear();
    term.write(getPromptText());
    inputBuffer = '';
    cursorPos = 0;
  } else if (cmd === 'pwd') {
    cmdPwd();
  } else if (cmd === 'ls') {
    cmdLs(args);
  } else if (cmd === 'cd') {
    cmdCd(args);
  } else if (cmd === 'rm') {
    cmdRm(args);
  } else if (cmd === 'cat') {
    cmdCat(args);
  } else if (cmd === 'make') {
    requireSavedProject(function () {
      spawnProcess('make', args, cwd);
    });
  } else if (OSS_CAD_TOOLS.indexOf(cmd) >= 0) {
    // OSS-CAD suite tools — run binary directly
    requireSavedProject(function () {
      ensureBuildFiles(function () {
        var toolPath = nodePath.join(ossCadBinDir, cmd);
        spawnProcess(toolPath, args, cwd);
      });
    });
  } else if (APIO_DESIGN_COMMANDS.indexOf(cmd) >= 0) {
    // Design commands operate on the compiled circuit: ensure the project is
    // saved and the build files exist before handing off to apio.
    requireSavedProject(function () {
      ensureBuildFiles(function () {
        runApioCommand(cmd, args);
      });
    });
  } else {
    // Any other apio command (global flags, examples, drivers, docs, ...) is
    // forwarded directly so its parameters and arguments pass through intact.
    runApioCommand(cmd, args);
  }
}

function parseCommandLine(line) {
  // Shell-like parser: handles quotes and backslash-escaped characters
  var parts = [];
  var current = '';
  var inQuote = false;
  var quoteChar = '';

  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      } else {
        current += ch;
      }
    } else if (ch === '\\' && i + 1 < line.length) {
      // Backslash escapes the next character
      current += line[i + 1];
      i++;
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += ch;
    }
  }
  if (current) {
    parts.push(current);
  }
  return parts;
}

// Extract the raw (escaped) last token from the input for autocomplete
function extractLastToken(line) {
  var token = '';
  var inQuote = false;
  var quoteChar = '';
  var tokenStart = 0;

  for (var i = 0; i < line.length; i++) {
    var ch = line[i];
    if (inQuote) {
      if (ch === quoteChar) {
        inQuote = false;
      }
    } else if (ch === '\\' && i + 1 < line.length) {
      i++; // skip escaped char
    } else if (ch === '"' || ch === "'") {
      inQuote = true;
      quoteChar = ch;
    } else if (ch === ' ' || ch === '\t') {
      tokenStart = i + 1;
    }
  }
  return {
    raw: line.slice(tokenStart),
    parsed: parseCommandLine(line.slice(tokenStart))[0] || '',
    start: tokenStart,
  };
}

// Escape spaces in a filename for shell display
function shellEscape(name) {
  return name.replace(/ /g, '\\ ');
}

// ─── BUILT-IN COMMANDS ──────────────────────────────────────────────────────
function cmdHelp() {
  var lines = [
    '',
    INFO_COLOR + '  Icestudio commands:' + RESET_COLOR,
    '    @help             Show this help',
    '    @compile          Regenerate design files from Icestudio',
    '    @verify           Run Icestudio verify (native GUI)',
    '    @build            Run Icestudio build (native GUI)',
    '    @upload           Run Icestudio upload (native GUI)',
    '    @clean            Remove generated files (apio.ini, main.v, ...)',
    '',
    INFO_COLOR + '  Shell commands:' + RESET_COLOR,
    '    clear             Clear terminal',
    '    ls [dir]          List directory contents',
    '    cd <dir>          Change directory (sandbox)',
    '    pwd               Print working directory',
    '    cat <file>        Display file contents',
    '    rm [-rf] <path>   Remove file or directory',
    '    make              Run make in current directory',
    '',
    INFO_COLOR + '  OSS-CAD tools' + RESET_COLOR + ' (direct execution):',
    '    yosys, nextpnr-ice40, nextpnr-ecp5, iceprog,',
    '    icemulti, icepack, icetime, ecppack,',
    '    openFPGALoader, gtkwave, ...',
    '',
    INFO_COLOR + '  Apio:' + RESET_COLOR,
    '    Any other command is passed directly to apio.',
    '    Type "help" to see apio commands.',
    '    Examples: lint, build, upload, report, graph, sim ...',
    '',
    '  Shortcuts: Ctrl+C cancel, Ctrl+L clear, Tab autocomplete',
    '  Clipboard: Select to copy, Ctrl+Shift+V paste',
    '  Navigation: Up/Down history, Left/Right cursor, Home/End',
    '',
  ];
  term.writeln(lines.join('\r\n'));
  showPrompt();
}

function cmdCompile() {
  term.writeln(INFO_COLOR + 'Compiling design from Icestudio...' + RESET_COLOR);
  compileDesign(function () {
    term.writeln(INFO_COLOR + 'Design files updated.' + RESET_COLOR);
    showPrompt();
  });
}

function cmdNativeAction(action) {
  var menuEl = document.querySelector('[ng-controller="MenuCtrl"]');
  if (!menuEl) {
    term.writeln(ERROR_COLOR + 'Cannot access Icestudio menu' + RESET_COLOR);
    showPrompt();
    return;
  }
  var menuScope = angular.element(menuEl).scope();

  // Lower plugin window z-index so save/alertify dialogs are clickable
  var winEl = document.getElementById(pluginUUID);
  var origZ = winEl ? winEl.style.zIndex : '';
  if (winEl) {
    winEl.style.zIndex = '1';
  }

  term.writeln(
    INFO_COLOR + '  Launching Icestudio ' + action + '...' + RESET_COLOR
  );

  if (action === 'verify') {
    menuScope.verifyCode();
  } else if (action === 'build') {
    menuScope.buildCode();
  } else if (action === 'upload') {
    menuScope.uploadCode();
  }

  // Restore z-index after delay (let dialogs appear first)
  setTimeout(function () {
    if (winEl) {
      winEl.style.zIndex = origZ;
    }
  }, 1000);
  showPrompt();
}

function cmdClean() {
  var removed = [];
  ['apio.ini', 'main.v', 'main.pcf', 'main.lpf'].forEach(function (f) {
    var fp = nodePath.join(buildDir, f);
    if (nodeFs.existsSync(fp)) {
      nodeFs.unlinkSync(fp);
      removed.push(f);
    }
  });
  var buildOut = nodePath.join(buildDir, '_build');
  if (nodeFs.existsSync(buildOut)) {
    deleteFolderRecursive(buildOut);
    removed.push('_build/');
  }
  if (removed.length > 0) {
    term.writeln(INFO_COLOR + '  Cleaned: ' + removed.join(', ') + RESET_COLOR);
  } else {
    term.writeln(INFO_COLOR + '  Nothing to clean.' + RESET_COLOR);
  }
  showPrompt();
}

function cmdPwd() {
  term.writeln(cwd);
  showPrompt();
}

function cmdLs(args) {
  var target = cwd;
  if (
    args.length > 0 &&
    args[0] !== '-l' &&
    args[0] !== '-a' &&
    args[0] !== '-la'
  ) {
    target = resolveSandboxPath(args[args.length - 1]);
    if (!target) {
      term.writeln(
        ERROR_COLOR + 'Access denied: outside sandbox' + RESET_COLOR
      );
      showPrompt();
      return;
    }
  }

  var showAll =
    args.indexOf('-a') >= 0 ||
    args.indexOf('-la') >= 0 ||
    args.indexOf('-al') >= 0;

  try {
    var entries = nodeFs.readdirSync(target);
    if (!showAll) {
      entries = entries.filter(function (e) {
        return e[0] !== '.';
      });
    }

    entries.sort();
    var output = [];
    entries.forEach(function (entry) {
      var fullPath = nodePath.join(target, entry);
      var isDir = false;
      try {
        isDir = nodeFs.statSync(fullPath).isDirectory();
      } catch (err) {
        /* */
      }
      if (isDir) {
        output.push(DIR_COLOR + entry + '/' + RESET_COLOR);
      } else {
        output.push(entry);
      }
    });

    if (output.length === 0) {
      term.writeln(INFO_COLOR + '(empty)' + RESET_COLOR);
    } else {
      // Column layout
      var maxLen = 0;
      entries.forEach(function (e) {
        if (e.length + 1 > maxLen) {
          maxLen = e.length + 1;
        }
      });
      var cols = Math.max(1, Math.floor(term.cols / (maxLen + 2)));
      for (var i = 0; i < output.length; i += cols) {
        var row = '';
        for (var j = 0; j < cols && i + j < output.length; j++) {
          var plain = entries[i + j] || '';
          var padLen =
            maxLen +
            2 -
            (plain.length +
              (nodeFs
                .statSync(nodePath.join(target, entries[i + j]))
                .isDirectory()
                ? 1
                : 0));
          row += output[i + j] + ' '.repeat(Math.max(1, padLen));
        }
        term.writeln(row.trimRight());
      }
    }
  } catch (err) {
    term.writeln(ERROR_COLOR + err.message + RESET_COLOR);
  }
  showPrompt();
}

function cmdCd(args) {
  if (args.length === 0 || args[0] === '~' || args[0] === '/') {
    cwd = buildDir;
    showPrompt();
    return;
  }

  var target = resolveSandboxPath(args[0]);
  if (!target) {
    term.writeln(
      ERROR_COLOR +
        'Access denied: cannot navigate outside sandbox' +
        RESET_COLOR
    );
    showPrompt();
    return;
  }

  try {
    var stat = nodeFs.statSync(target);
    if (!stat.isDirectory()) {
      term.writeln(ERROR_COLOR + 'Not a directory: ' + args[0] + RESET_COLOR);
    } else {
      cwd = target;
    }
  } catch (err) {
    term.writeln(ERROR_COLOR + 'No such directory: ' + args[0] + RESET_COLOR);
  }
  showPrompt();
}

function cmdCat(args) {
  if (args.length === 0) {
    term.writeln(ERROR_COLOR + 'Usage: cat <file>' + RESET_COLOR);
    showPrompt();
    return;
  }
  var target = resolveSandboxPath(args[0]);
  if (!target) {
    term.writeln(ERROR_COLOR + 'Access denied: outside sandbox' + RESET_COLOR);
    showPrompt();
    return;
  }
  try {
    var content = nodeFs.readFileSync(target, 'utf8');
    term.write(content);
  } catch (err) {
    term.writeln(ERROR_COLOR + err.message + RESET_COLOR);
  }
  showPrompt();
}

function cmdRm(args) {
  var force = false;
  var recursive = false;
  var paths = [];

  args.forEach(function (arg) {
    if (arg === '-f') {
      force = true;
    } else if (arg === '-r') {
      recursive = true;
    } else if (arg === '-rf' || arg === '-fr') {
      force = true;
      recursive = true;
    } else {
      paths.push(arg);
    }
  });

  if (paths.length === 0) {
    term.writeln(ERROR_COLOR + 'Usage: rm [-rf] <path>' + RESET_COLOR);
    showPrompt();
    return;
  }

  function doRemove() {
    paths.forEach(function (p) {
      var target = resolveSandboxPath(p);
      if (!target) {
        term.writeln(
          ERROR_COLOR + 'Access denied: outside sandbox' + RESET_COLOR
        );
        return;
      }
      try {
        var stat = nodeFs.statSync(target);
        if (stat.isDirectory()) {
          if (!recursive) {
            term.writeln(
              ERROR_COLOR + 'Is a directory (use -r): ' + p + RESET_COLOR
            );
            return;
          }
          deleteFolderRecursive(target);
        } else {
          nodeFs.unlinkSync(target);
        }
        term.writeln('Removed: ' + p);
      } catch (err) {
        term.writeln(ERROR_COLOR + err.message + RESET_COLOR);
      }
    });
    showPrompt();
  }

  if (force) {
    doRemove();
  } else {
    askConfirmation('Delete ' + paths.join(', ') + '?', function (yes) {
      if (yes) {
        doRemove();
      } else {
        term.writeln('Cancelled.');
        showPrompt();
      }
    });
  }
}

function deleteFolderRecursive(dirPath) {
  if (nodeFs.existsSync(dirPath)) {
    nodeFs.readdirSync(dirPath).forEach(function (file) {
      var curPath = nodePath.join(dirPath, file);
      if (nodeFs.lstatSync(curPath).isDirectory()) {
        deleteFolderRecursive(curPath);
      } else {
        nodeFs.unlinkSync(curPath);
      }
    });
    nodeFs.rmdirSync(dirPath);
  }
}

// ─── BUILD FILE GENERATION ───────────────────────────────────────────────────
function compileDesign(callback) {
  // Call tools.compileDesign() which generates all files
  // (verilog + pcf/lpf + list + apio.ini) without running apio
  try {
    var injector = angular.element(document.body).injector();
    var tools = injector.get('tools');
    if (tools && typeof tools.compileDesign === 'function') {
      tools
        .compileDesign()
        .then(function () {
          callback();
        })
        .catch(function (err) {
          var msg = err && err.message ? err.message : 'Unknown error';
          term.writeln(
            ERROR_COLOR + 'Error generating files: ' + msg + RESET_COLOR
          );
          showPrompt();
        });
      return;
    }
  } catch (err) {
    term.writeln(ERROR_COLOR + 'Error: ' + err.message + RESET_COLOR);
  }
  term.writeln(
    ERROR_COLOR + 'No design loaded. Cannot generate build files.' + RESET_COLOR
  );
  showPrompt();
}

function ensureBuildFiles(callback) {
  var mainV = nodePath.join(buildDir, 'main.v');
  if (nodeFs.existsSync(mainV)) {
    callback();
    return;
  }
  term.writeln(INFO_COLOR + 'Generating design files...' + RESET_COLOR);
  compileDesign(function () {
    term.writeln(INFO_COLOR + 'Design files generated.' + RESET_COLOR);
    callback();
  });
}

// ─── APIO COMMAND EXECUTION ─────────────────────────────────────────────────
function runApioCommand(subcmd, args) {
  // Build the full command: APIO_CMD <subcmd> [args]
  var fullArgs = [subcmd].concat(args);

  // Inject the project directory only for subcommands that accept it, and only
  // when the user hasn't already provided one. Passing -p to a command that
  // doesn't support it (e.g. --version, examples, drivers) makes apio fail
  // with "Error: No such option: -p".
  var hasProjectDir =
    args.indexOf('-p') >= 0 || args.indexOf('--project-dir') >= 0;
  if (APIO_PROJECT_COMMANDS.indexOf(subcmd) >= 0 && !hasProjectDir) {
    fullArgs = fullArgs.concat(['-p', '"' + cwd + '"']);
  }

  spawnProcess(apioCmd, fullArgs, cwd);
}

// ─── PROCESS SPAWNING ───────────────────────────────────────────────────────
function spawnProcess(cmd, args, workDir) {
  var spawnEnv = Object.assign({}, process.env, {
    APIO_HOME: apioHome,
    FORCE_COLOR: '1',
    TERM: 'xterm-256color',
    COLUMNS: String(term.cols),
    LINES: String(term.rows),
    PYTHONUNBUFFERED: '1',
  });

  var fullCommand =
    cmd +
    ' ' +
    args
      .map(function (a) {
        // Re-quote args that contain spaces and aren't already quoted
        if (a.indexOf(' ') >= 0 && a[0] !== '"' && a[0] !== "'") {
          return '"' + a + '"';
        }
        return a;
      })
      .join(' ');

  try {
    var proc = nodeChildProcess.spawn(fullCommand, [], {
      shell: true,
      cwd: workDir,
      env: spawnEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    currentProcess = proc;
    procEchoCount = 0;

    proc.stdout.on('data', function (data) {
      procEchoCount = 0;
      term.write(data.toString());
    });

    proc.stderr.on('data', function (data) {
      procEchoCount = 0;
      term.write(data.toString());
    });

    proc.on('close', function (code) {
      currentProcess = null;
      if (code !== 0 && code !== null) {
        term.write(ERROR_COLOR + '\r\n[exit ' + code + ']' + RESET_COLOR);
      }
      notifyIfMinimized();
      showPrompt();
    });

    proc.on('error', function (err) {
      currentProcess = null;
      term.writeln(ERROR_COLOR + 'Error: ' + err.message + RESET_COLOR);
      showPrompt();
    });
  } catch (err) {
    term.writeln(
      ERROR_COLOR + 'Failed to execute: ' + err.message + RESET_COLOR
    );
    showPrompt();
  }
}

// ─── BOOTSTRAP ──────────────────────────────────────────────────────────────
registerEvents();
iceStudio.bus.events.publish('pluginManager.getEnvironment');
