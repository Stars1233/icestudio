importScripts(
  '/resources/libs/Icestudio/Services/WafleEventBus.js',
  '/resources/libs/Icestudio/Plugin/Api/Worker/BindingWafleEventBus.js',
  '/resources/libs/Icestudio/Plugin/Api/IcestudioPlugin.js',
  'js/DbEngineIndexDB.js'
);

let db = false;

db = new DbEngineIndexDB();
let queue = [];
let queueQuery = [];
let queueDelete = [];
let queueClear = [];
let retryingStorage = false;
let retryingRetrieve = false;
let retryingDelete = false;
let retryingClear = false;

function setEnvironment(data) {}

function onClear(item) {
  if (!db.isReady(item.database.dbId)) {
    queueClear.push(item);
    if (!retryingClear) {
      retryingClear = true;
      db.openDatabase(item.database, retryClear);
    }
  } else {
    db.clear(item);
    retryClear();
  }
}

function retryClear() {
  retryingClear = false;
  if (queueClear.length > 0) {
    let item = queueClear[0];
    queueClear.splice(0, 1);
    onClear(item);
  }
}

function onDelete(item) {
  if (!db.isReady(item.database.dbId)) {
    queueDelete.push(item);
    if (!retryingDelete) {
      retryingDelete = true;
      db.openDatabase(item.database, retryDelete);
    }
  } else {
    db.delete(item);
    retryDelete();
  }
}

function retryDelete() {
  retryingDelete = false;
  if (queueDelete.length > 0) {
    let item = queueDelete[0];
    queueDelete.splice(0, 1);
    onDelete(item);
  }
}
function onRetrieve(item) {
  if (!db.isReady(item.database.dbId)) {
    queueQuery.push(item);
    if (!retryingRetrieve) {
      retryingRetrieve = true;
      db.openDatabase(item.database, retryRetrieve);
    }
  } else {
    db.retrieve(item);
    retryRetrieve();
  }
}

function onStore(item) {
  if (!db.isReady(item.database.dbId)) {
    queue.push(item);
    if (!retryingStorage) {
      retryingStorage = true;
      db.openDatabase(item.database, retryStore);
    }
  } else {
    db.store(item);
    retryStore();
  }
}
function retryStore() {
  retryingStorage = false;
  if (queue.length > 0) {
    let item = queue[0];
    queue.splice(0, 1);
    onStore(item);
  }
}
function retryRetrieve() {
  retryingRetrieve = false;
  if (queueQuery.length > 0) {
    let item = queueQuery[0];
    queueQuery.splice(0, 1);
    onRetrieve(item);
  }
}
let queueQueryAll = [];
let retryingRetrieveAll = false;

function onRetrieveAll(item) {
  if (!db.isReady(item.database.dbId)) {
    queueQueryAll.push(item);
    if (!retryingRetrieveAll) {
      retryingRetrieveAll = true;
      db.openDatabase(item.database, retryRetrieveAll);
    }
  } else {
    db.retrieveAll(item);
    retryRetrieveAll();
  }
}

function retryRetrieveAll() {
  retryingRetrieveAll = false;
  if (queueQueryAll.length > 0) {
    let item = queueQueryAll[0];
    queueQueryAll.splice(0, 1);
    onRetrieveAll(item);
  }
}

iceStudio.bus.events.subscribe('localDatabase.store', onStore);
iceStudio.bus.events.subscribe('localDatabase.retrieve', onRetrieve);
iceStudio.bus.events.subscribe('localDatabase.retrieveAll', onRetrieveAll);
iceStudio.bus.events.subscribe('localDatabase.delete', onDelete);
iceStudio.bus.events.subscribe('localDatabase.clear', onClear);
iceStudio.bus.events.subscribe('pluginManager.env', setEnvironment);
iceStudio.bus.events.subscribe('pluginManager.updateEnv', setEnvironment);
