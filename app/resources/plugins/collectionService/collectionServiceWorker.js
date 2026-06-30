importScripts(
  '/resources/libs/vendor/SHA-256/SHA-256.js',
  '/resources/libs/Icestudio/Services/WafleEventBus.js',
  '/resources/libs/Icestudio/Plugin/Api/Worker/BindingWafleEventBus.js',
  '/resources/libs/Icestudio/Plugin/Api/IcestudioPlugin.js',
  'js/CollectionService.js'
);

let pConfig = { env: false };
let pluginUUID = -1;
let colService = false;

//-- Build the ordered list of collection roots from the environment
function buildDirCols() {
  let tmp = pConfig.env.defaultCollection;
  tmp.name = 'Default collection';

  let dirCols = [tmp];
  if (
    pConfig.env.externalCollections &&
    pConfig.env.externalCollections.length > 0
  ) {
    dirCols = dirCols.concat(pConfig.env.externalCollections);
  }
  if (
    pConfig.env.internalCollections &&
    pConfig.env.internalCollections.length > 0
  ) {
    dirCols = dirCols.concat(pConfig.env.internalCollections);
  }
  return dirCols;
}

function setupEnvironment(env) {
  if (typeof env === 'undefined' || typeof env.VERSION === 'undefined') {
    setTimeout(function () {
      iceStudio.bus.events.publish('pluginManager.getEnvironment');
    }, 2000);
    return;
  }

  pConfig.env = env;

  if (colService === false) {
    //-- First time: create the service and run an incremental index
    colService = new CollectionService();
    colService.setId(pluginUUID);
    colService.init();
    colService.collectionsToTree(buildDirCols(), false);
  } else if (colService.reindexPending) {
    //-- A reindex was requested from the UI. The host app has just rescanned
    //-- the collections from disk and resent the environment. Rebuild either
    //-- incrementally (only changed/new blocks) or fully, as requested.
    colService.reindexPending = false;
    colService.collectionsToTree(buildDirCols(), colService.reindexForce);
  }
  //-- else: a regular environment update we don't need to act on
}

function registerEvents() {
  iceStudio.bus.events.subscribe('pluginManager.env', setupEnvironment);
  iceStudio.bus.events.subscribe('pluginManager.updateEnv', setupEnvironment);
}

function onPluginGetUUID(data) {
  pluginUUID = data.uuid;
  registerEvents();
  iceStudio.bus.events.publish('pluginManager.getEnvironment');
}
