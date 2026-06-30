var appEnv = null;

function setupEnvironment(env) {
  appEnv = env;
  if (typeof initShell === 'function' && appEnv) {
    initShell();
  }
  // Update build dir dynamically when project changes
  if (typeof updateBuildDir === 'function' && appEnv) {
    updateBuildDir();
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
