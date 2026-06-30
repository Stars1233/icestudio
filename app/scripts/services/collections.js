'use strict';

angular
  .module('icestudio')
  .service(
    'collections',
    function (common, profile, gettextCatalog, $exceptionHandler, utils) {
      let iceColl = new IceCollection({
        location: {
          default: common.DEFAULT_COLLECTION_DIR,
          internal: common.INTERNAL_COLLECTIONS_DIR,
          external: profile.get('externalCollections'),
        },
      });

      let self = this;

      //----------------------------------------------------------------------
      //-- Reindex requested from the Collection Manager plugin.
      //-- Rescan all the collections from disk and resend the environment to
      //-- the plugins, which triggers a forced (full) reindex in the worker.
      //----------------------------------------------------------------------
      iceStudio.bus.events.subscribe('collectionService.rescan', function () {
        try {
          self.loadAllCollections();
          self.sort();
          if (
            typeof ICEpm !== 'undefined' &&
            ICEpm &&
            typeof ICEpm.setEnvironment === 'function'
          ) {
            ICEpm.setEnvironment(common);
          } else {
            //-- Fallback: publish the env update directly on the bus
            iceStudio.bus.events.publish('pluginManager.updateEnv', common);
          }
        } catch (e) {
          $exceptionHandler(e);
        }
      });

      /*
      const DEFAULT = '';
      const MAX_LEVEL_SEARCH = 20;
      */

      this.loadAllCollections = function () {
        this.loadDefaultCollection();
        this.loadInternalCollections();
        this.loadExternalCollections();
        //-- Collections changed: drop the cached block-id index so it is
        //-- rebuilt lazily from the fresh trees on the next membership check.
        common.collectionBlockIds = null;
      };

      //----------------------------------------------------------------------
      //-- Collection block-id index
      //--
      //-- Build (lazily) a Set with the canonical, content-addressed id of
      //-- every block .ice file present in the installed collections, so we
      //-- can answer "does this dependency id belong to an installed
      //-- collection?" in O(1). Ids are computed with utils.blockId, the same
      //-- recipe project.addBlock uses, so they match a design's dependency
      //-- keys for the same (unmodified) block.
      //----------------------------------------------------------------------
      function eachCollectionBlockPath(callback) {
        var cols = [common.defaultCollection]
          .concat(common.internalCollections || [])
          .concat(common.externalCollections || []);
        cols.forEach(function (col) {
          if (col && col.content && col.content.blocks) {
            walk(col.content.blocks);
          }
        });
        function walk(nodes) {
          (nodes || []).forEach(function (node) {
            if (node.isDir || (node.children && node.children.length)) {
              walk(node.children);
            } else if (
              typeof node.name === 'string' &&
              /\.ice$/i.test(node.name)
            ) {
              callback(node.path);
            }
          });
        }
      }

      this.buildBlockIdIndex = function () {
        var ids = new Set();
        try {
          eachCollectionBlockPath(function (path) {
            var fileIds = utils.collectionIdsFromFile(path);
            for (var i = 0; i < fileIds.length; i++) {
              ids.add(fileIds[i]);
            }
          });
        } catch (e) {
          $exceptionHandler(e);
        }
        common.collectionBlockIds = ids;
        return ids;
      };

      //-- True when the given dependency id belongs to an installed
      //-- collection block (builds the index on first use).
      this.isCollectionBlock = function (id) {
        if (!id) {
          return false;
        }
        if (!(common.collectionBlockIds instanceof Set)) {
          this.buildBlockIdIndex();
        }
        return common.collectionBlockIds.has(id);
      };

      this.loadDefaultCollection = function () {
        common.defaultCollection = iceColl.getDefault();
      };

      this.loadInternalCollections = function () {
        var internalCollections = iceColl.find(common.INTERNAL_COLLECTIONS_DIR);
        common.internalCollections = loadCollections(internalCollections);
      };

      this.loadExternalCollections = function () {
        try {
          var externalCollectionsPath = profile.get('externalCollections');
          if (externalCollectionsPath !== common.INTERNAL_COLLECTIONS_DIR) {
            var externalCollections = iceColl.find(externalCollectionsPath);
            common.externalCollections = loadCollections(externalCollections);
          }
        } catch (e) {
          $exceptionHandler(e);
        }
      };

      function loadCollections(paths) {
        return iceColl.getAll(paths);
      }

      /*
      function getCollection(name, path, children) {
        return iceColl.get(name, path, children);
      }
      */

      this.selectCollection = function (path) {
        var selectedCollection = null;
        var collections = common.internalCollections.concat(
          common.externalCollections
        );
        for (var i in collections) {
          if (collections[i].path === path) {
            selectedCollection = collections[i];
            break;
          }
        }
        if (selectedCollection === null) {
          // Collection not found: select default collection
          selectedCollection = common.defaultCollection;
        }
        common.selectedCollection = selectedCollection;
        return selectedCollection.path;
      };

      this.sort = function () {
        sortCollections([common.defaultCollection]);
        sortCollections(common.internalCollections);
        sortCollections(common.externalCollection);
      };

      function sortCollections(collections) {
        for (var i in collections) {
          var collection = collections[i];
          //-- Defensive: skip null/empty slots (e.g. defaultCollection not
          //-- loaded yet) instead of dereferencing collection.content.
          if (collection && collection.content) {
            sortContent(collection.content.blocks);
            sortContent(collection.content.examples);
          }
        }
      }

      function sortContent(items) {
        if (items) {
          items.sort(byNameAlphaNum);
          for (var i in items) {
            sortContent(items[i].children);
          }
        }
      }

      function byNameAlphaNum(a, b) {
        a = gettextCatalog.getString(a.name);
        b = gettextCatalog.getString(b.name);
        return alphaNumSort(a, b);
      }

      // Thanks: Gideon, https://ux.stackexchange.com/a/134765
      function alphaNumSort(a, b) {
        var regex = /[^\d]+|\d+/g;

        // Split each name into alphabetical and numeric parts
        var ar = a.match(regex);
        var br = b.match(regex);
        var localeCompare;

        // For each part in the two split names, perform the following comparison:
        for (let ia in ar) {
          for (let ib in br) {
            var ari = ar[ia];
            if (ari === undefined) {
              ari = '';
            }
            var bri = br[ib];
            if (bri === undefined) {
              bri = '';
            }

            // If both parts are strictly numeric, compare them as numbers
            if (!isNaN(ari) && !isNaN(bri)) {
              localeCompare = ari.localeCompare(
                bri,
                {},
                {
                  numeric: true,
                }
              );
            } else {
              localeCompare = ari.localeCompare(
                bri,
                {},
                {
                  ignorePunctuation: true,
                  sensitivity: 'base',
                }
              );
            }
            if (localeCompare !== 0) {
              // If you run out of parts, the name with the fewest parts comes first
              return localeCompare;
            }

            // If they're the same, move on to the next part
          }
        }
        return localeCompare;
      }
    }
  );
