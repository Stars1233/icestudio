# Apio Shell Plugin — Developer Documentation

## Overview

The Apio Shell plugin provides an embedded terminal inside Icestudio for interacting with [Apio](https://github.com/FPGAwars/apio) (the FPGA toolchain CLI) and Icestudio's own build pipeline. It runs inside an NW.js window using **xterm.js v5.3.0** for terminal emulation and Node.js `child_process` for spawning system commands.

Key capabilities:
- Full terminal emulator with history, autocomplete, and color output
- Direct access to all apio commands (lint, build, upload, sim, report, graph, etc.)
- `@` prefixed commands for Icestudio native actions (@verify, @build, @upload, @compile, @clean)
- Shell utilities: ls, cat, rm, cd, pwd, clear, make
- OSS-CAD-Suite tool access: yosys, iceprog, nextpnr-ice40, etc.
- Sandboxed navigation within the project build directory
- File path autocomplete with backslash-escape support for spaces

---

## Architecture

### Runtime Environment

Icestudio runs on **NW.js 0.109.0** (Chromium 146 + Node.js). Plugins execute inside the main application window but are isolated via **Shadow DOM**. This means:

- Plugin HTML/CSS lives inside a shadow root — styles don't leak in or out
- Plugin JavaScript runs in the same Node.js context as the host app
- The plugin can access `require('fs')`, `require('child_process')`, etc.
- Angular services from Icestudio are accessible via `angular.element().injector()`

### Plugin Loading

The Icestudio plugin system (`WaflePluginExtEmbeddedWindowed`) loads plugins as follows:

1. Reads `manifest.json` for configuration (scripts, styles, dimensions)
2. Creates a window via `WafleWindowManager` with drag/resize/minimize support
3. Attaches a Shadow DOM root to the window body
4. Loads CSS files (`host.css` into the document, `style.css` + theme CSS into shadow DOM)
5. Concatenates all JS files from `manifest.json` scripts into a single IIFE via `setNodeScript()`
6. Executes the IIFE, passing `shadowRoot` and `pluginUUID` as parameters

**Important**: Because `setNodeScript()` wraps everything in a function, the `module` and `exports` globals are NOT available. This is why xterm.js and its addons need UMD loader shims (see [Vendor Libraries](#vendor-libraries)).

### Shadow DOM Isolation

```
Document (host)
 └─ .ics-wm-window (managed by WafleWindowManager)
     └─ .ics-wm-window--body
         └─ #shadow-root
             ├─ <link> xterm.css
             ├─ <link> style.css
             ├─ <link> dark.css or light.css
             ├─ <div id="terminal-container">
             │    └─ xterm.js renders here
             └─ (scripts execute in this context)
```

CSS in `style.css` targets elements inside the shadow DOM. CSS in `host.css` targets the host document (e.g., overflow rules on the window body).

---

## File Structure

```
apioShell/
├── apioShell.html          # Shadow DOM template (terminal container div)
├── icon.png                # Plugin icon for the window manager
├── manifest.json           # Plugin configuration
├── README.md               # This file
├── css/
│   ├── style.css           # Shadow DOM styles (terminal layout, scrollbar)
│   ├── host.css            # Host document styles (window body overflow)
│   ├── dark/dark.css       # Dark theme colors (default)
│   └── light/light.css     # Light theme colors
├── js/
│   ├── events.js           # Event bus subscriptions (env, updateEnv)
│   └── apioShell.js        # Main plugin logic (~1270 lines)
└── vendor/xterm/
    ├── css/xterm.css        # xterm.js stylesheet
    └── lib/
        ├── xterm.js          # xterm.js v5.3.0 (terminal emulator)
        ├── xterm-loader.js   # UMD capture shim for xterm.js
        ├── xterm-addon-fit.js # FitAddon v0.8.0 (auto-resize)
        └── fit-loader.js     # UMD capture shim for FitAddon
```

### manifest.json

```json
{
  "name": "Apio shell",
  "version": "0.5",
  "type": "embeddedWindowed",
  "icon": "icon.png",
  "window": {
    "top": 250, "left": 250,
    "width": 720, "height": 480,
    "resizable": true, "minimizable": true
  },
  "scripts": [
    "vendor/xterm/lib/xterm.js",
    "vendor/xterm/lib/xterm-loader.js",
    "vendor/xterm/lib/xterm-addon-fit.js",
    "vendor/xterm/lib/fit-loader.js",
    "js/events.js",
    "js/apioShell.js"
  ],
  "hostCss": ["css/host.css"],
  "css": ["css/style.css", "vendor/xterm/css/xterm.css"],
  "cssDark": ["css/dark/dark.css"],
  "cssLight": ["css/light/light.css"],
  "html": "apioShell.html"
}
```

**Script load order matters.** xterm.js must load before its loader shim, which must load before FitAddon, which must load before its loader shim, which must load before the main plugin code.

---

## Vendor Libraries

### UMD Loader Shims

xterm.js and FitAddon are UMD modules that check for `module.exports`. In NW.js `<script>` context, `module` exists but is wrong. The loader shims solve this:

**xterm-loader.js** — Captures the Terminal class after xterm.js defines it:
```javascript
(function () {
  if (typeof module !== 'undefined' && module.exports && module.exports.Terminal) {
    window._xtermModule = module.exports;
  }
})();
```

**fit-loader.js** — Captures the FitAddon class:
```javascript
(function () {
  if (typeof module !== 'undefined' && module.exports && module.exports.FitAddon) {
    window._fitAddonModule = module.exports;
  }
})();
```

In `apioShell.js`, the captured modules are consumed:
```javascript
var Terminal = (window._xtermModule || {}).Terminal;
var FitAddon = (window._fitAddonModule || {}).FitAddon;
```

### Adding New xterm Addons

1. Place the addon `.js` file in `vendor/xterm/lib/`
2. Create a loader shim (copy `fit-loader.js` pattern, change the export name)
3. Add both files to `manifest.json` scripts array (addon first, then loader)
4. Access the captured module via `window._yourAddonModule` in `apioShell.js`

---

## Core Module: apioShell.js

### Initialization Flow

1. **Module capture**: Get `Terminal` and `FitAddon` from window globals
2. **Node.js requires**: `fs`, `path`, `child_process`, `os`
3. **Icestudio service injection**: Get `common` and `tools` via Angular injector
4. **Build directory setup**: `buildDir = common.BUILD_DIR` (project-specific temp directory)
5. **Terminal creation**: `new Terminal({...})` with dark theme, opened into shadow DOM container
6. **FitAddon attachment**: Auto-sizes terminal to container dimensions
7. **ResizeObserver**: Watches container size changes, debounced with `requestAnimationFrame`
8. **Event listeners**: Keyboard input (`term.onData`), shell prompt display
9. **Initial message**: Version banner and `@help` hint

### Key Variables

| Variable | Description |
|----------|-------------|
| `term` | xterm.js Terminal instance |
| `fitAddon` | FitAddon instance for auto-resize |
| `buildDir` | Absolute path to project build directory |
| `currentDir` | Current working directory (starts as `buildDir`) |
| `inputBuffer` | Current command line input string |
| `cursorPos` | Cursor position within `inputBuffer` |
| `commandHistory` | Array of past commands |
| `historyIndex` | Current position in history navigation |
| `runningProcess` | Currently executing `child_process` or null |
| `shadowRoot` | Reference to the plugin's shadow DOM root |
| `pluginUUID` | Unique ID of the plugin window element |

### Color Constants

```javascript
var PROMPT_COLOR = '\x1b[1;32m';   // Bold green
var PATH_COLOR   = '\x1b[1;34m';   // Bold blue
var ERROR_COLOR  = '\x1b[1;31m';   // Bold red
var INFO_COLOR   = '\x1b[1;33m';   // Bold yellow
var CMD_COLOR    = '\x1b[1;36m';   // Bold cyan
var RESET_COLOR  = '\x1b[0m';
```

---

## Command Dispatch System

When the user presses Enter, `executeCommand(rawInput)` is called. The dispatch logic follows this priority:

### 1. Controlled Commands (13 total)

These are handled directly by the plugin:

| Command | Handler | Description |
|---------|---------|-------------|
| `@help` | `cmdHelp()` | Show help text |
| `@compile` | `cmdCompile()` | Regenerate main.v, constraints, .list files |
| `@verify` | `cmdNativeAction('verify')` | Call Icestudio verify (GUI feedback) |
| `@build` | `cmdNativeAction('build')` | Call Icestudio build (GUI feedback) |
| `@upload` | `cmdNativeAction('upload')` | Call Icestudio upload (GUI feedback) |
| `@clean` | `cmdClean()` | Remove generated files |
| `clear` | — | Clear terminal screen |
| `cd` | `cmdCd(args)` | Change directory (sandboxed) |
| `pwd` | — | Print working directory |
| `ls` | `cmdLs(args)` | List files with color coding |
| `cat` | `cmdCat(args)` | Display file contents |
| `rm` | `cmdRm(args)` | Remove files (with confirmation for multiple) |
| `make` | spawns `make` | Run make in current directory |

### 2. OSS-CAD-Suite Tools

If the command matches one of these tool names, it's spawned directly:

```javascript
var OSS_CAD_TOOLS = [
  'yosys', 'nextpnr-ice40', 'nextpnr-ecp5', 'icepack', 'iceprog',
  'icetime', 'icepll', 'icemulti', 'icebram',
  'arachne-pnr', 'netlistsvg', 'iverilog', 'vvp',
];
```

### 3. Apio Fallback

**Everything else** is passed to apio as a parameter: `apio <command> [args]`. This means any current or future apio command works automatically without plugin changes:

```
lint          → apio lint
build         → apio build
upload        → apio upload
report        → apio report
graph         → apio graph
sim           → apio sim
test          → apio test
system --info → apio system --info
```

### Command Parsing

`parseCommandLine(input)` splits input respecting:
- Single quotes: `'hello world'` → `hello world`
- Double quotes: `"hello world"` → `hello world`
- Backslash escapes: `hello\ world` → `hello world`
- Mixed: `"it's a test"` → `it's a test`

---

## Icestudio Integration

### Accessing Angular Services

```javascript
var injector = angular.element(document.body).injector();
var common = injector.get('common');   // Project paths, board info, constants
var tools = injector.get('tools');     // Compile, verify, build, upload functions
```

### Calling Menu Functions (Native Actions)

`cmdNativeAction()` accesses the MenuCtrl scope to invoke GUI actions:

```javascript
function cmdNativeAction(action) {
  var menuEl = document.querySelector('[ng-controller="MenuCtrl"]');
  var menuScope = angular.element(menuEl).scope();

  // Lower plugin z-index so alertify dialogs are clickable
  var winEl = document.getElementById(pluginUUID);
  if (winEl) { winEl.style.zIndex = '1'; }

  if (action === 'verify') { menuScope.verifyCode(); }
  else if (action === 'build') { menuScope.buildCode(); }
  else if (action === 'upload') { menuScope.uploadCode(); }

  // Restore z-index after dialogs appear
  setTimeout(function () {
    if (winEl) { winEl.style.zIndex = origZ; }
  }, 1000);
}
```

**z-index management**: The plugin window has a high z-index. Native actions trigger alertify dialogs that need to be on top. The function temporarily lowers the window z-index and restores it after 1 second.

### Compile Design

`cmdCompile()` calls `tools.compileDesign()` which:
- Writes `main.v` (Verilog from the visual design)
- Writes `main.pcf` or `main.lpf` (pin constraints for the selected board)
- Writes `*.list` files (memory initialization from memory blocks)
- Copies any `@include` Verilog files from the project
- Creates `apio.ini` if missing (via `apioIntegrityCheck()`)
- **Never deletes** user files (testbenches, custom .v, Makefiles)

### Project Requirements

Several commands require a saved project before execution. The `requireSavedProject(callback)` wrapper checks if `buildDir` is valid and shows an error if not:

```javascript
function requireSavedProject(callback) {
  if (!buildDir || buildDir === '.' || buildDir === '') {
    term.writeln(ERROR_COLOR + '  Project must be saved first.' + RESET_COLOR);
    showPrompt();
    return;
  }
  callback();
}
```

---

## Event Bus

### events.js

The plugin subscribes to Icestudio's plugin event system:

```javascript
pluginManager.subscribe('pluginManager.env', function (data) {
  // Receives environment variables (APIO path, Python path, etc.)
  // Stores them for use in child_process.spawn env
});

pluginManager.subscribe('pluginManager.updateEnv', function (data) {
  // Called when environment changes (e.g., board change)
  // Updates buildDir and resets currentDir
});
```

### Environment Variables

The `env` event provides PATH entries for apio's toolchain, Python, and OSS-CAD-Suite. These are merged into `process.env` when spawning child processes so that `apio`, `yosys`, `iceprog`, etc. are found.

---

## Process Spawning

### runCommand(executable, args)

Spawns a child process with:
- `cwd`: current working directory
- `env`: merged host + plugin environment
- `shell`: true (for command resolution)

Output handling:
- `stdout` → written to terminal with ANSI colors preserved
- `stderr` → written to terminal in red
- `close` → shows exit code, sets `runningProcess = null`, calls `notifyIfMinimized()`

### runApioCommand(command, args)

Wraps `runCommand` to call `apio <command> [args]`. The apio executable path comes from the environment variables provided by the event bus.

### Ctrl+C Handling

When `runningProcess` is active and the user presses Ctrl+C (`\x03`):
```javascript
if (runningProcess) {
  runningProcess.kill('SIGINT');
}
```

---

## Terminal Features

### Input Handling

- **Left/Right arrows**: Move cursor within input line
- **Up/Down arrows**: Navigate command history
- **Tab**: Trigger autocomplete
- **Backspace/Delete**: Edit input
- **Home/End**: Jump to start/end of line
- **Ctrl+C**: Kill running process or clear current input
- **Ctrl+L**: Clear screen
- **Enter**: Execute command

### Autocomplete

`autoComplete()` handles:

1. **Command completion**: If input has no spaces, matches against `BUILTIN_COMMANDS` + `OSS_CAD_TOOLS`
2. **File/directory completion**: If input has spaces, completes the last token as a file path
3. **Ambiguous matches**: Shows all possibilities, then redisplays the prompt with the longest common prefix
4. **Space escaping**: Filenames with spaces are escaped with backslashes (`my\ file.v`)

### Command History

- Stored in `commandHistory` array (in-memory, not persisted)
- Navigated with Up/Down arrow keys
- Duplicate consecutive commands are not stored

---

## Sandbox Security

### Path Validation

`isPathAllowed(targetPath)` ensures all file operations stay within the build directory:

```javascript
function isPathAllowed(p) {
  var resolved = nodePath.resolve(currentDir, p);
  return resolved.startsWith(buildDir);
}
```

This prevents:
- `cd ../../etc` — navigation outside build directory
- `cat /etc/passwd` — reading files outside sandbox
- `rm -rf /` — destructive operations outside sandbox

### cd Restrictions

- `cd` with no args returns to `buildDir`
- `cd ..` at the build directory root is blocked
- Absolute paths outside `buildDir` are rejected
- Symlinks are resolved before validation

---

## Window Management

### Minimize/Restore

When minimized:
- Window is scaled down to a **92x69 pixel thumbnail** using CSS `transform: scale()`
- The transform preserves the full content as a miniature preview (not just a clipped corner)
- Positioned at bottom-left of the screen (`bottom: 48px; left: 10px`)
- All interactive elements (`pointer-events: none`) are disabled except the window itself
- Single click anywhere on the thumbnail restores the window

When restored:
- Original dimensions, position, and transform are restored from `win.originalStyles`
- The `ics-wm-window--minimized` class is removed
- The `ics-wm-window--notify` class is also removed (clears green border)

### Notification on Process Complete

`notifyIfMinimized()` checks if the window is minimized when a process ends. If so, it adds the `ics-wm-window--notify` CSS class which shows a green border on the thumbnail. This border persists until the window is restored.

---

## CSS Theming

### Dark Theme (default)

`css/dark/dark.css` — xterm terminal colors for dark backgrounds.

### Light Theme

`css/light/light.css` — xterm terminal colors for light backgrounds.

Theme CSS is loaded based on Icestudio's current theme setting. The `cssDark` and `cssLight` arrays in `manifest.json` control which files are injected.

### Host Styles

`css/host.css` applies to the host document (outside shadow DOM):
- Sets `overflow: hidden` on `.ics-wm-window--body` to prevent the window body from scrolling
- The terminal itself handles its own scrolling via xterm.js

---

## How to Add New Commands

### Adding a New @ Command

1. **Define the command handler** in `apioShell.js`:

```javascript
function cmdMyCommand() {
  term.writeln(INFO_COLOR + '  Doing something...' + RESET_COLOR);
  // ... your logic ...
  showPrompt();
}
```

2. **Add dispatch** in `executeCommand()`, in the `@` command section:

```javascript
} else if (cmd === '@mycommand') {
    requireSavedProject(function () {
      cmdMyCommand();
    });
}
```

3. **Register for autocomplete** in the `BUILTIN_COMMANDS` array:

```javascript
var BUILTIN_COMMANDS = [
  'cd', 'ls', 'pwd', 'clear',
  '@help', '@compile', '@verify', '@build', '@upload', '@clean', '@mycommand',
  'rm', 'cat', 'make',
];
```

4. **Add help text** in `cmdHelp()`.

### Adding a New Shell Command

For commands that run an external program (like `make`):

1. Add dispatch in `executeCommand()`:

```javascript
} else if (cmd === 'mytool') {
    requireSavedProject(function () {
      runCommand('mytool', args.slice(1));
    });
}
```

2. Add to `BUILTIN_COMMANDS` for autocomplete.

### Adding a New Icestudio Native Action

To call any function on the MenuCtrl scope:

```javascript
var menuScope = angular.element(
  document.querySelector('[ng-controller="MenuCtrl"]')
).scope();
menuScope.yourFunction();
```

Or to access any Angular service:

```javascript
var injector = angular.element(document.body).injector();
var myService = injector.get('serviceName');
myService.doSomething();
```

---

## @clean — Generated File Cleanup

`@clean` (and the menu's "Clean project") removes only files generated by the build pipeline:

| File/Dir | Source | Safe to delete |
|----------|--------|----------------|
| `apio.ini` | `apioIntegrityCheck()` | Yes — regenerated on next compile |
| `main.v` | `generateCode()` | Yes — regenerated on next compile |
| `main.pcf` | `generateCode()` | Yes — regenerated on next compile |
| `main.lpf` | `generateCode()` | Yes — regenerated on next compile |
| `_build/` | apio build output | Yes — intermediate/output files |

**Preserved** (never deleted by @clean):
- User testbench files (`*_tb.v`, `*_tb.gtkw`)
- Custom Verilog files
- Makefiles
- `.list` files (may be user-created; generated ones are overwritten on compile)
- Any other user files

The menu "Clean project" also triggers automatically when the user changes the FPGA board, since the old build artifacts are incompatible with the new board.

---

## Build Pipeline Interaction

Understanding how the build pipeline works is critical for safe plugin development:

```
@compile (or verify/build/upload)
  └─ tools.compileDesign()
       ├─ apioIntegrityCheck()     → creates apio.ini IF missing
       ├─ generateCode()           → overwrites main.v, main.pcf/lpf
       ├─ generates *.list         → from memory blocks (overwrites)
       └─ syncResources()          → copies @include .v files

apio verify / apio build / apio upload
  └─ reads main.v, main.pcf/lpf, apio.ini
  └─ outputs to _build/ directory
```

**Key guarantee**: The build pipeline NEVER deletes files. It only creates or overwrites specific known files. User files in the build directory are always safe.

---

## Debugging Tips

### Console Access

Since the plugin runs in NW.js, you can open DevTools (`F12` or via NW.js menu) and inspect:
- Shadow DOM elements in the Elements panel
- Console output from the plugin
- Network requests (none expected)

### Common Issues

1. **Terminal not rendering**: Check that xterm.js loaded correctly. Look for errors about `Terminal` being undefined. Verify the UMD loader shims are in the correct order in `manifest.json`.

2. **Commands not found**: Check that the apio environment was received via the event bus. Log `process.env.PATH` to verify toolchain paths are present.

3. **Autocomplete not working**: Ensure `BUILTIN_COMMANDS` array includes your new command. For file completion, verify `currentDir` points to a valid directory.

4. **z-index conflicts**: Native actions temporarily lower the plugin window z-index. If dialogs appear behind the terminal, increase the timeout in `cmdNativeAction()`.

5. **Sandbox errors**: All paths are validated against `buildDir`. If a command fails with a path error, check that the target is within the build directory.

### JSHint

Run `npm run jshint` to check for JavaScript errors. The plugin code follows ES5 conventions (no arrow functions, no `let`/`const`, no template literals) for compatibility.
