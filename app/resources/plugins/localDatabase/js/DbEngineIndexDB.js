class DbEngineIndexDB {
  constructor(config) {
    this.config = typeof config === 'undefined' ? {} : config;
    this.databases = {};
  }

  isReady(dbId) {
    return (
      typeof this.databases[dbId] !== 'undefined' &&
      typeof this.databases[dbId].db !== 'undefined' &&
      typeof this.databases[dbId].db.transaction !== 'undefined'
    );
  }

  openDatabase(schema, onOpen) {
    let _this = this;

    if (!this.isReady(schema.dbId)) {
      this.databases[schema.dbId] = { db: false, version: schema.version };
      this.databases[schema.dbId].openRequest = indexedDB.open(
        schema.dbId,
        schema.version
      );

      this.databases[schema.dbId].openRequest.onupgradeneeded = function (e) {
        var db = e.target.result;
        for (let i = 0; i < schema.storages.length; i++) {
          if (!db.objectStoreNames.contains(schema.storages[i])) {
            let storage = db.createObjectStore(schema.storages[i], {
              keyPath: 'id',
            });
            storage.createIndex('id', 'id', { unique: true });
          }
        }
      };

      this.databases[schema.dbId].openRequest.onsuccess = function (e) {
        _this.databases[schema.dbId].db = e.target.result;
        if (typeof onOpen !== 'undefined') {
          onOpen();
        }
      };
    } else {
      if (typeof onOpen !== 'undefined') {
        onOpen();
      }
    }
  }

  retrieve(item) {
    if (this.isReady(item.database.dbId)) {
      let transaction = this.databases[item.database.dbId].db.transaction(
        [item.data.store],
        'readwrite'
      );

      transaction.onerror = function (event) {
        console.log(
          'There has been an error with retrieving your data: ' +
            transaction.error
        );
      };

      transaction.oncomplete = function (event) {};
      let store = transaction.objectStore(item.data.store);

      var request = store.get(item.data.id);
      request.onerror = function (event) {
        // Handle errors!
      };
      request.onsuccess = function (event) {
        //-- When the key does not exist, IndexedDB returns undefined. Echo
        //-- back a minimal descriptor carrying the requested id so that
        //-- subscribers can still react to a "not found" result instead of
        //-- waiting forever for a record that will never arrive.
        let result = request.result;
        if (typeof result === 'undefined') {
          result = {
            id: item.data.id,
            store: item.data.store,
            notFound: true,
          };
        }
        iceStudio.bus.events.publish('localDatabase.retrieved', result);
      };
    }
  }

  delete(item) {
    if (this.isReady(item.database.dbId)) {
      let transaction = this.databases[item.database.dbId].db.transaction(
        [item.data.store],
        'readwrite'
      );

      transaction.onerror = function (event) {
        console.log(
          'There has been an error deleting your data: ' + transaction.error
        );
      };

      let store = transaction.objectStore(item.data.store);
      let request = store.delete(item.data.id);

      request.onsuccess = function (e) {
        iceStudio.bus.events.publish('localDatabase.deleted', item);
      };
    }
  }

  retrieveAll(item) {
    if (this.isReady(item.database.dbId)) {
      let transaction = this.databases[item.database.dbId].db.transaction(
        [item.data.store],
        'readonly'
      );

      transaction.onerror = function (event) {
        console.log(
          'There has been an error reading the store: ' + transaction.error
        );
      };

      let store = transaction.objectStore(item.data.store);
      let request = store.getAll();

      request.onerror = function (event) {
        // Handle errors!
      };
      request.onsuccess = function (event) {
        iceStudio.bus.events.publish('localDatabase.retrievedAll', {
          dbId: item.database.dbId,
          store: item.data.store,
          results: request.result || [],
        });
      };
    }
  }

  clear(item) {
    if (this.isReady(item.database.dbId)) {
      let transaction = this.databases[item.database.dbId].db.transaction(
        [item.data.store],
        'readwrite'
      );

      transaction.onerror = function (event) {
        console.log(
          'There has been an error clearing the store: ' + transaction.error
        );
      };

      let store = transaction.objectStore(item.data.store);
      let request = store.clear();

      request.onsuccess = function (e) {
        iceStudio.bus.events.publish('localDatabase.cleared', item);
      };
    }
  }

  store(item) {
    if (this.isReady(item.database.dbId)) {
      let transaction = this.databases[item.database.dbId].db.transaction(
        [item.data.store],
        'readwrite'
      );

      transaction.onerror = function (event) {
        console.log(
          'There has been an error with retrieving your data: ' +
            transaction.error
        );
      };

      transaction.oncomplete = function (event) {};
      let store = transaction.objectStore(item.data.store);

      let request = store.put(item.data);

      request.onerror = function (event) {
        if (request.error.name == 'ConstraintError') {
          event.preventDefault(); // don't abort the transaction
        } else {
          // unexpected error, can't handle it
          // the transaction will abort
        }
      };

      request.onsuccess = function (e) {
        iceStudio.bus.events.publish('localDatabase.stored', item);
      };
    }
  }
}
