/* global iceStudio, pluginUUID, initBoardEditor, refreshBoardEditorEnv */

var appEnv = null;

function setupEnvironment(env) {
  appEnv = env;
  if (typeof initBoardEditor === 'function') {
    initBoardEditor();
  }
  if (typeof refreshBoardEditorEnv === 'function') {
    refreshBoardEditorEnv();
  }
}

function registerEvents() {
  iceStudio.bus.events.subscribe(
    'pluginManager.env',
    setupEnvironment,
    false,
    pluginUUID
  );
  iceStudio.bus.events.subscribe(
    'pluginManager.updateEnv',
    setupEnvironment,
    false,
    pluginUUID
  );
}
