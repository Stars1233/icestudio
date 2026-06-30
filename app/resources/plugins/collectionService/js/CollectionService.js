class CollectionService {
  constructor() {
    this.indexQ = [];
    this.indexing = false;
    this.id = -1;
    this.collections = false;
    this.temp = false;

    //-- Incremental indexing state
    this.sigs = {}; //-- Signatures (mtime:size) loaded from the last index
    this.newSigs = {}; //-- Signatures computed in the current pass
    this.pendingCollArray = false; //-- Collections waiting to be walked
    this.lastCollArray = false; //-- Last collections received (for reindex)
    this.bootstrapDone = false; //-- Has the saved snapshot been loaded?
    this.bootstrapTimer = false; //-- Safety net timer
    this.force = false; //-- Forced (full) reindex requested?
    this.reindexPending = false; //-- A reindex was requested from the UI
    this.reindexForce = false; //-- Forced (full) vs incremental reindex
    this.clearPending = false; //-- Wipe the DB before the next forced reindex

    //-- Progress counters
    this.indexTotal = 0; //-- Blocks to index in the current pass
    this.indexDone = 0; //-- Blocks already processed in the current pass
  }

  init() {
    iceStudio.bus.events.subscribe(
      'block.loadedFromFile',
      'blockContentLoaded',
      this,
      this.id
    );
    iceStudio.bus.events.subscribe(
      'localDatabase.stored',
      'blockIndexedOK',
      this,
      this.id
    );
    iceStudio.bus.events.subscribe(
      'collectionService.isIndexing',
      'isIndexing',
      this,
      this.id
    );
    iceStudio.bus.events.subscribe(
      'localDatabase.retrieved',
      'treePreload',
      this,
      this.id
    );
    iceStudio.bus.events.subscribe(
      'collectionService.getCollections',
      'publishCollections',
      this,
      this.id
    );
    iceStudio.bus.events.subscribe(
      'collectionService.reindex',
      'onReindex',
      this,
      this.id
    );
  }

  setId(id) {
    this.id = id;
  }

  blockInQueue(blkid) {
    let qlength = this.indexQ.length - 1;
    while (qlength > -1) {
      if (this.indexQ[qlength].blockId === blkid) {
        return true;
      }
      qlength--;
    }
    return false;
  }

  //-------------------------------------------------------------------------
  //-- Bootstrap handler. The saved snapshot (tree + per-block signatures)
  //-- is retrieved before deciding what needs to be reindexed. This event
  //-- is shared, so we only react to our own 'vtree-resume' record.
  //-------------------------------------------------------------------------
  treePreload(result) {
    if (!result || result.id !== 'vtree-resume') {
      return;
    }
    if (this.bootstrapDone) {
      return;
    }
    this.bootstrapDone = true;
    if (this.bootstrapTimer) {
      clearTimeout(this.bootstrapTimer);
      this.bootstrapTimer = false;
    }

    this.sigs = result.sigs || {};
    if (typeof result.tree !== 'undefined' && result.tree) {
      this.temp = result.tree;
    }

    this.buildAndQueue();
  }

  getCollections() {
    if (this.indexing === false) {
      return this.collections;
    }
    return this.temp;
  }

  publishCollections() {
    if (this.indexing === false) {
      iceStudio.bus.events.publish(
        'collectionService.collections',
        this.collections
      );
    } else {
      iceStudio.bus.events.publish('collectionService.collections', this.temp);
    }
  }

  blockContentLoaded(args) {
    if (this.blockInQueue(args.blockId)) {
      args.obj.path = args.path;
      this.indexBlock(args.blockId, args.obj);
    }
  }

  preloadVtree() {}

  isBlockValidForIndex(obj) {
    return (
      typeof obj !== 'undefined' &&
      obj !== false &&
      obj !== false &&
      typeof obj.package !== 'undefined' &&
      typeof obj.package.description !== 'undefined' &&
      typeof obj.package.name !== 'undefined' &&
      typeof obj.package.image !== 'undefined' &&
      obj.package.description !== null && // null
      obj.package.name !== null && // null
      obj.package.image !== null && // null
      // PERMISSIVE WITH EMPTY FIELDS like ""
      obj.package.description.length >= 0 && // empty
      obj.package.name.length >= 0 && // empty
      obj.package.image.length >= 0 // empty
    );
  }

  indexBlock(id, obj) {
    if (this.isBlockValidForIndex(obj)) {
      let item = {
        id: id,
        description: obj.package.description,
        name: obj.package.name,
        icon: obj.package.image,
        path: obj.path,
        store: 'blockAssets',
      };

      let transaction = {
        database: {
          dbId: 'Collections',
          storages: ['blockAssets'],
          version: 1,
        },
        data: item,
      };

      iceStudio.bus.events.publish('localDatabase.store', transaction);
    } else {
      this.indexNext();
    }
  }

  blockIndexedOK(item) {
    if (
      item.database.dbId === 'Collections' &&
      item.data.store === 'blockAssets' &&
      this.blockInQueue(item.data.id)
    ) {
      this.indexNext();
    }
  }

  indexNext() {
    if (this.indexing) {
      this.indexQ.splice(0, 1);
      this.indexDone++;
      if (this.indexQ.length > 0) {
        this.publishStatus();
        this.indexDB(true);
      } else {
        this.indexing = false;
        this.finalizeIndex();
      }
    }
  }

  isIndexing() {
    this.publishStatus();
    return this.indexing;
  }

  //-------------------------------------------------------------------------
  //-- Publish the current indexing status, including progress and the path
  //-- of the block being processed, so the UI can show what is happening.
  //-------------------------------------------------------------------------
  publishStatus() {
    let current = '';
    if (this.indexing && this.indexQ.length > 0) {
      current = this.indexQ[0].path || '';
    }
    iceStudio.bus.events.publish('collectionService.indexStatus', {
      indexing: this.indexing,
      queue: this.indexQ.length,
      total: this.indexTotal || 0,
      done: this.indexDone || 0,
      current: current,
    });
  }

  indexDB(force) {
    force = force || false;
    if ((this.indexing === false && this.indexQ.length > 0) || force) {
      this.indexing = true;
      iceStudio.bus.events.publish(
        'collectionService.block.loadFromFile',
        this.indexQ[0]
      );
    }
  }

  queueIndexDB(params) {
    params.dispatch = false;
    this.indexQ.push(params);
    this.indexDB();
  }

  buildTreeBlocks(child, rootPath) {
    if (typeof child.children !== 'undefined') {
      let node = {
        name: child.name,
        isFolder: true,
        isLeaf: false,
        hasSubFolders: false,
        items: [],
        opened: false,
        id: this.nodeHash(`${child.path}`),
      };

      let ext = '';
      let posExtension = false;
      for (let i = 0; i < child.children.length; i++) {
        posExtension = child.children[i].path.lastIndexOf('.');

        ext = child.children[i].path.substring(posExtension);

        // Only read .ice files and folders. The extension check is
        // case-insensitive: collections may ship blocks with an uppercase
        // .ICE extension, which must not be silently dropped from the tree.
        if (ext.toLowerCase() == '.ice' || child.children[i].isDir) {
          node.items.push(this.buildTreeBlocks(child.children[i], rootPath));
          let last = node.items[node.items.length - 1];
          if (last.isFolder === false) {
            //-- A block leaf: record its signature and only (re)index it
            //-- when it is new or has changed since the last pass.
            this.newSigs[last.id] = last.sig;
            if (this.force || !last.sig || this.sigs[last.id] !== last.sig) {
              this.queueIndexDB({
                id: this.id,
                blockId: last.id,
                path: last.path,
              });
            }
          }
        }
      } //-- for child.children.length

      if (this.hasSubFolders(node)) node.hasSubFolders = true;

      return node;
    } else {
      return {
        id: this.nodeHash(child.path),
        path: child.path,
        name: child.name,
        isLeaf: true,
        isFolder: false,
        //-- Lightweight change signature carried from the disk scan
        sig: (child.mtimeMs || 0) + ':' + (child.size || 0),
      };
    }
  }

  hasSubFolders(tree) {
    if (typeof tree.items !== 'undefined') {
      for (let i = 0; i < tree.items.length; i++) {
        if (tree.items[i].isFolder === true) {
          return true;
        }
      }
    }
    return false;
  }

  buildTreeFromCollection(node) {
    let tree = [];

    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        tree.push(this.buildTreeFromCollection(node[i]));
      }
      return tree;
    } else {
      if (typeof node.content !== 'undefined') {
        let root = {
          items: [],
          isFolder: true,
          name: node.name,
          path: node.path,
          id: this.nodeHash(node.path),
          opened: false,
          isLeaf: false,
          hasSubFolders: false,
        };

        for (let i = 0; i < node.content.blocks.length; i++) {
          root.items.push(
            this.buildTreeBlocks(node.content.blocks[i], node.path)
          );
        }
        if (root.items.length > 0) root.hasSubFolders = true;
        return root;
      }
    }
  }

  //-------------------------------------------------------------------------
  //-- Entry point: turn an array of collections into a tree and (re)index
  //-- the blocks that changed. When 'force' is true the saved signatures
  //-- are ignored and every block is reindexed from scratch.
  //-------------------------------------------------------------------------
  collectionsToTree(collArray, force) {
    force = force || false;
    this.force = force;
    this.lastCollArray = collArray;
    this.bootstrapDone = false;

    collArray.sort(function compare(a, b) {
      if (a.name.toLowerCase() < b.name.toLowerCase()) {
        return -1;
      }
      if (a.name.toLowerCase() > b.name.toLowerCase()) {
        return 1;
      }
      return 0;
    });
    this.pendingCollArray = collArray;

    iceStudio.bus.events.publish('collectionService.indexingStart');

    if (force) {
      //-- Forced reindex: rebuild every block (see buildTreeBlocks). We keep
      //-- the in-memory signatures from the previous pass on purpose, so that
      //-- finalizeIndex can still prune blocks that disappeared from disk.
      this.temp = false;
      this.indexQ = [];
      this.bootstrapDone = true;
      if (this.clearPending) {
        //-- The collections directory changed: wipe the whole store so no
        //-- stale blocks from the previous location survive, and start clean.
        this.clearPending = false;
        this.sigs = {};
        this.clearDatabase();
      }
      this.buildAndQueue();
      return;
    }

    //-- Incremental: retrieve the saved snapshot (tree + signatures) and
    //-- decide what to reindex once it arrives (see treePreload).
    let item = { id: 'vtree-resume', store: 'blockAssets' };
    let transaction = {
      database: {
        dbId: 'Collections',
        storages: ['blockAssets'],
        version: 1,
      },
      data: item,
    };
    iceStudio.bus.events.publish('localDatabase.retrieve', transaction);

    //-- Safety net: if the snapshot never comes back (e.g. lost event),
    //-- index from scratch instead of stalling.
    let _this = this;
    this.bootstrapTimer = setTimeout(function () {
      if (!_this.bootstrapDone) {
        _this.bootstrapDone = true;
        _this.sigs = {};
        _this.buildAndQueue();
      }
    }, 3000);
  }

  //-------------------------------------------------------------------------
  //-- Walk the pending collections, queueing only the blocks that need
  //-- (re)indexing. If nothing changed, finalize immediately.
  //-------------------------------------------------------------------------
  buildAndQueue() {
    this.newSigs = {};
    this.indexDone = 0;
    this.collections = this.buildTreeFromCollection(this.pendingCollArray);
    this.indexTotal = this.indexQ.length;
    this.publishStatus();

    if (this.indexQ.length === 0) {
      //-- Everything was up to date: no work to do
      this.indexing = false;
      this.finalizeIndex();
    }
    //-- else: queueIndexDB() already started the pipeline
  }

  //-------------------------------------------------------------------------
  //-- Persist the fresh tree + signatures, prune blocks that disappeared
  //-- from disk, and notify the UI that indexing has ended.
  //-------------------------------------------------------------------------
  finalizeIndex() {
    //-- Prune blocks present in the previous pass but gone from disk
    for (let oldId in this.sigs) {
      if (!Object.prototype.hasOwnProperty.call(this.newSigs, oldId)) {
        this.deleteBlock(oldId);
      }
    }

    //-- Store the fresh snapshot (tree for instant preload + signatures)
    let item = {
      id: 'vtree-resume',
      store: 'blockAssets',
      tree: this.collections,
      sigs: this.newSigs,
    };
    let transaction = {
      database: {
        dbId: 'Collections',
        storages: ['blockAssets'],
        version: 1,
      },
      data: item,
    };
    iceStudio.bus.events.publish('localDatabase.store', transaction);

    this.sigs = this.newSigs;
    this.temp = this.collections;

    iceStudio.bus.events.publish('collectionService.indexingEnd');
    this.publishStatus();
    iceStudio.bus.events.publish(
      'collectionService.collections',
      this.collections
    );
  }

  deleteBlock(id) {
    let transaction = {
      database: {
        dbId: 'Collections',
        storages: ['blockAssets'],
        version: 1,
      },
      data: { id: id, store: 'blockAssets' },
    };
    iceStudio.bus.events.publish('localDatabase.delete', transaction);
  }

  //-------------------------------------------------------------------------
  //-- A reindex was requested from the UI. Ask the host app to rescan the
  //-- collections from disk and resend the environment; the forced rebuild
  //-- happens when the fresh environment arrives (see the worker).
  //-------------------------------------------------------------------------
  onReindex(args) {
    if (this.indexing) {
      return;
    }
    this.reindexPending = true;
    //-- Incremental when requested (only changed/new blocks, using the stored
    //-- signatures); otherwise a full rebuild (e.g. the Reindex button).
    this.reindexForce = !(args && args.incremental);
    //-- When the collections directory changed, also wipe the DB first
    if (args && args.clear) {
      this.clearPending = true;
    }
    iceStudio.bus.events.publish('collectionService.rescan');
  }

  clearDatabase() {
    let transaction = {
      database: {
        dbId: 'Collections',
        storages: ['blockAssets'],
        version: 1,
      },
      data: { store: 'blockAssets' },
    };
    iceStudio.bus.events.publish('localDatabase.clear', transaction);
  }

  nodeHash(text) {
    return sha256.hex(text);
  }
}
