'use strict';

var subModuleActive = false;

angular
  .module('icestudio')
  .controller(
    'DesignCtrl',
    function (
      $rootScope,
      $scope,
      project,
      profile,
      graph,
      boards,
      gettextCatalog,
      utils,
      common,
      collections
    ) {
      //----------------------------------------------------------------
      //-- Module initialization
      //----------------------------------------------------------------

      $scope.graph = graph;
      $scope.common = common;
      $scope.profile = profile;
      $scope.information = {};
      $scope.topModule = true;
      $scope.isNavigating = false;
      $scope.backup = {};
      $scope.toRestore = false;

      //-- Create the PAPER. It is the place were the circuits are drawn
      //-- It is associated to html element 'paper', located in the
      //--  design.html file
      let htmlElement = $('.paper');
      graph.createPaper(htmlElement);

      //----------------------------------------------------------------
      //-- Board selector (footer board button → modal)
      //----------------------------------------------------------------
      //-- The board is chosen from a modal opened by the footer board
      //-- button. The actual board change is delegated to MenuCtrl (which
      //-- owns selectBoard + the "I/O will be lost" confirm + cleanProject)
      //-- via a $rootScope event, so there is a single source of truth.

      //-- Canonical FPGA family order for the family dropdown; any other
      //-- family found in common.boards is appended in first-seen order.
      var BOARD_FAMILY_ORDER = [
        'HX1K',
        'HX8K',
        'LP1K',
        'LP8K',
        'UL1K',
        'U4K',
        'UP5K',
        'ECP5',
        'GOWIN',
      ];

      $scope.boardModal = {
        open: false,
        filter: '',
        family: 'all',
        selected: null,
      };

      //-- Open the selector, preselecting the current board
      $scope.openBoardSelect = function () {
        //-- Re-scan boards so the list is always current — e.g. a board just
        //-- created in the boardEditor, or added on disk out-of-band. The
        //-- boardEditor already refreshes the host on save; this makes the
        //-- modal robust on its own. projectDir resolution mirrors project.js
        //-- so project-local boards (<projectDir>/boards) are included too.
        try {
          var projectDir =
            project.dirname ||
            (project.filepath ? utils.dirname(project.filepath) : '') ||
            (project.path ? utils.dirname(project.path) : '');
          boards.loadBoards(projectDir || undefined);
        } catch (e) {
          console.warn('openBoardSelect: loadBoards failed', e);
        }
        $scope.boardModal.filter = '';
        $scope.boardModal.family = 'all';
        $scope.boardModal.selected = common.selectedBoard || null;
        $scope.boardModal.open = true;
      };

      //-- Cancel: keep the current board, just close
      $scope.cancelBoardSelect = function () {
        $scope.boardModal.open = false;
      };

      //-- Pick a row (does not apply the change yet)
      $scope.boardModalPick = function (board) {
        $scope.boardModal.selected = board;
      };

      //-- Accept: close and delegate the board change to MenuCtrl
      $scope.confirmBoardSelect = function () {
        var board = $scope.boardModal.selected;
        $scope.boardModal.open = false;
        if (board) {
          $rootScope.$broadcast('icestudio:selectBoard', board);
        }
      };

      //-- Distinct FPGA families present in common.boards, canonical first.
      //-- Memoized on the common.boards reference (replaced on loadBoards).
      var familiesCache = { src: null, list: [] };
      $scope.boardFamilies = function () {
        if (familiesCache.src === common.boards) {
          return familiesCache.list;
        }
        var seen = {};
        var extra = [];
        (common.boards || []).forEach(function (board) {
          var type = board.type || 'MISC';
          if (!seen[type]) {
            seen[type] = true;
            if (BOARD_FAMILY_ORDER.indexOf(type) === -1) {
              extra.push(type);
            }
          }
        });
        var list = BOARD_FAMILY_ORDER.filter(function (type) {
          return seen[type];
        }).concat(extra);
        familiesCache.src = common.boards;
        familiesCache.list = list;
        return list;
      };

      //-- Boards filtered by the text filter and the family dropdown.
      //-- Memoized on (boards, filter, family) so ng-repeat gets a stable
      //-- reference within a digest (no infinite $digest).
      var listCache = { src: null, filter: null, family: null, list: [] };
      $scope.boardModalList = function () {
        var bm = $scope.boardModal;
        if (
          listCache.src === common.boards &&
          listCache.filter === bm.filter &&
          listCache.family === bm.family
        ) {
          return listCache.list;
        }
        var text = (bm.filter || '').toLowerCase();
        var family = bm.family || 'all';
        var list = (common.boards || []).filter(function (board) {
          if (family !== 'all' && (board.type || 'MISC') !== family) {
            return false;
          }
          if (!text) {
            return true;
          }
          var label = (board.info && board.info.label) || board.name || '';
          return (label + ' ' + board.name).toLowerCase().indexOf(text) !== -1;
        });
        listCache.src = common.boards;
        listCache.filter = bm.filter;
        listCache.family = bm.family;
        listCache.list = list;
        return list;
      };

      //-------------------------------------------------------------
      //-- FUNCTIONS
      //-------------------------------------------------------------

      // Breadcrumbs

      $scope.breadcrumbsNavigate = function (selectedItem) {
        var item;
        if (!$scope.isNavigating) {
          $scope.isNavigating = true;
          //-- Continuous editing: jumping to another navigation level no longer
          //-- requires closing an "edit mode". Persist the current editable
          //-- sub-design first so its edits are not lost.
          if (common.isEditingSubmodule) {
            serializeCurrentSubdesign();
          }
          do {
            graph.breadcrumbs.pop();
            common.submoduleHeap.pop();
            item = graph.breadcrumbs.slice(-1)[0];
          } while (selectedItem !== item);
          if (common.submoduleHeap.length > 0) {
            const last = common.submoduleHeap.length - 1;
            common.submoduleId = common.submoduleHeap[last].id;
            common.submoduleUID = common.submoduleHeap[last].uid;
            iceStudio.bus.events.publish('Navigation::ReadOnly');
          } else {
            iceStudio.bus.events.publish('Navigation::ReadWrite');
          }

          loadSelectedGraph();
        }
      };

      $scope.breadcrumbsBack = function () {
        if (!$scope.isNavigating) {
          $scope.isNavigating = true;
          //-- Persist edits made to an editable sub-design before leaving it
          //-- (replaces the old "lock the padlock to save" step).
          if (common.isEditingSubmodule) {
            serializeCurrentSubdesign();
          }
          graph.breadcrumbs.pop();
          common.submoduleHeap.pop();
          if (common.submoduleHeap.length > 0) {
            const last = common.submoduleHeap.length - 1;
            common.submoduleId = common.submoduleHeap[last].id;
            common.submoduleUID = common.submoduleHeap[last].uid;
            iceStudio.bus.events.publish('Navigation::ReadOnly');
          } else {
            iceStudio.bus.events.publish('Navigation::ReadWrite');
          }
          loadSelectedGraph();
        }
      };

      function isSortable(cell, sortType) {
        const type = cell.get('type');
        return (
          (sortType === 'xy' &&
            (type === 'ice.Constant' || type === 'ice.Memory')) ||
          (sortType === 'y' && (type === 'ice.Input' || type === 'ice.Output'))
        );
      }

      function getSortValue(cell, sortType) {
        if (sortType === 'xy') {
          return cell.get('position').x;
        } else if (sortType === 'y') {
          return cell.get('position').y;
        }
        return 0; // Si no es sortable por ninguna de las condiciones, retornamos un valor neutral
      }

      //----------------------------------------------------------------------
      //-- Fork-on-edit for collection blocks
      //----------------------------------------------------------------------
      //-- 3-option dialog shown when the user unlocks (edits) a block that
      //-- belongs to an installed collection. The chosen handler is stored in
      //-- pendingForkChoice and invoked with the button index by the callback.
      var pendingForkChoice = null;
      alertify.dialog('forkBlockDialog', function factory() {
        return {
          main: function (message) {
            this.setContent(message);
          },
          setup: function () {
            return {
              buttons: [
                {
                  text: gettextCatalog.getString('Only this block'),
                  className: 'ajs-ok',
                },
                {
                  text: gettextCatalog.getString('All in the design'),
                  className: 'ajs-ok',
                },
                {
                  text: gettextCatalog.getString('Cancel'),
                  className: 'ajs-cancel',
                  key: 27,
                },
              ],
              focus: { element: 0 },
              options: {
                movable: false,
                maximizable: false,
                closable: false,
                resizable: false,
              },
            };
          },
          callback: function (closeEvent) {
            var fn = pendingForkChoice;
            pendingForkChoice = null;
            if (fn) {
              fn(closeEvent.index);
            }
          },
        };
      });

      //-- Reload the current breadcrumb view in read-only (rw=true) or
      //-- editable (rw=false) mode. Shared tail of editModeToggle.
      function navigateReload(tmpProject, rw) {
        setTimeout(function () {
          $rootScope.$broadcast('navigateProject', {
            update: false,
            project: tmpProject,
            editMode: rw,
            fromDoubleClick: false,
          });
          utils.rootScopeSafeApply();
          utils.endBlockingTask();
        }, 0);
      }

      //-- Remap, in a graph's blocks, the cell with the given id to a new type.
      function remapChildCell(graphDesign, cellUid, newType) {
        var blks =
          (graphDesign &&
            graphDesign.design &&
            graphDesign.design.graph &&
            graphDesign.design.graph.blocks) ||
          [];
        for (var k = 0; k < blks.length; k++) {
          if (blks[k].id === cellUid) {
            blks[k].type = newType;
          }
        }
      }

      //-- Fork a collection block so it can be edited without modifying the
      //-- canonical collection block. The block is always cloned (version bump
      //-- -> new content-addressed id); the difference is how far the change
      //-- reaches:
      //--   scope 'one' (Make Independent): clone the WHOLE navigation path up
      //--     to the root so ONLY this instance changes (like SolidWorks
      //--     "Make Independent" / Fusion "Break Link"). Other instances of the
      //--     containing blocks keep the original definition.
      //--   scope 'all': remap every reference of the block to the clone across
      //--     the root design and every dependency, so all instances change.
      //-- Container blocks on the path are local (ensured by the padlock guard),
      //-- so no collection block is ever mutated.
      function forkCollectionBlock(block, scope) {
        var heap = common.submoduleHeap || [];
        var depth = heap.length;
        if (depth === 0) {
          return false;
        }
        var seq = new Date().getTime();

        //-- Clone a dependency to a fresh content-addressed id.
        function cloneDep(srcId) {
          var clone = utils.clone(common.allDependencies[srcId]);
          clone.package = clone.package || {};
          var base = String(clone.package.version || '').replace(
            /(.*)(-c\d*)/,
            '$1'
          );
          clone.package.version = base + '-c' + seq++;
          var id = utils.dependencyID(clone);
          common.allDependencies[id] = clone;
          return id;
        }

        var editedOldId = block.type;
        var editedNewId = cloneDep(editedOldId);

        if (scope === 'all') {
          //-- Change the block everywhere: remap every reference of the edited
          //-- block to its clone, across all dependency graphs and the root.
          var depId, blks, j;
          for (depId in common.allDependencies) {
            blks =
              common.allDependencies[depId].design &&
              common.allDependencies[depId].design.graph &&
              common.allDependencies[depId].design.graph.blocks;
            if (blks) {
              for (j = 0; j < blks.length; j++) {
                if (blks[j].type === editedOldId) {
                  blks[j].type = editedNewId;
                }
              }
            }
          }
          var allRoot = project.get().design.graph.blocks || [];
          for (j = 0; j < allRoot.length; j++) {
            if (allRoot[j].type === editedOldId) {
              allRoot[j].type = editedNewId;
            }
          }
        } else {
          //-- Make Independent: clone the whole navigation path. Walk up from
          //-- the edited block to the root, cloning each ancestor with its
          //-- child reference (the cell on the path) remapped to the clone
          //-- below it.
          var childId = editedNewId;
          for (var i = depth - 1; i >= 1; i--) {
            var pclone = utils.clone(common.allDependencies[heap[i - 1].id]);
            pclone.package = pclone.package || {};
            var pbase = String(pclone.package.version || '').replace(
              /(.*)(-c\d*)/,
              '$1'
            );
            pclone.package.version = pbase + '-c' + seq++;
            remapChildCell(pclone, heap[i].uid, childId);
            var parentNewId = utils.dependencyID(pclone);
            common.allDependencies[parentNewId] = pclone;
            heap[i - 1].id = parentNewId;
            childId = parentNewId;
          }
          //-- Remap the specific instance cell at the root to the top clone.
          var rootBlocks = project.get().design.graph.blocks || [];
          for (var r = 0; r < rootBlocks.length; r++) {
            if (rootBlocks[r].id === heap[0].uid) {
              rootBlocks[r].type = childId;
            }
          }
        }

        //-- Rewire navigation (breadcrumbs + heap) to the cloned chain.
        heap[depth - 1].id = editedNewId;
        for (var b = 0; b < heap.length; b++) {
          if (graph.breadcrumbs[b + 1]) {
            graph.breadcrumbs[b + 1].type = heap[b].id;
          }
        }
        block.type = editedNewId;
        common.submoduleId = editedNewId;
        project.changed = true;
        return common.allDependencies[editedNewId];
      }

      //-- Set the read-only / padlock / edit flags for a view of the given
      //-- block at the given navigation depth, and return whether the view is
      //-- read-only (opt.disabled). Single source of truth shared by
      //-- navigateProject (navigating in) and loadSelectedGraph (navigating
      //-- back). Editing works at any depth.
      //--   root (depth 0)              -> editable, no padlock
      //--   collection block (any depth) -> read-only, padlock (fork to edit)
      //--   local block / fork (any depth) -> editable, no padlock
      function applyViewFlags(blockType, depth) {
        var isColl = depth > 0 && collections.isCollectionBlock(blockType);
        var disabled = isColl;
        common.currentBlockIsCollection = isColl;
        common.isEditingSubmodule = depth > 0 && !disabled;
        subModuleActive = depth > 0;
        return disabled;
      }

      //-- Persist the current sub-design (the block being viewed) back into its
      //-- dependency in common.allDependencies, so edits survive navigating
      //-- away. Replaces the old "lock the padlock to save" step: now driven by
      //-- navigation (breadcrumbsBack). Mirrors the I/O ordering sort.
      function serializeCurrentSubdesign() {
        var block = graph.breadcrumbs[graph.breadcrumbs.length - 1];
        if (!block || !block.type || !common.allDependencies[block.type]) {
          return;
        }
        var cells = $scope.graph.getCells();
        cells.sort(function (a, b) {
          var isSortableAxy = isSortable(a, 'xy');
          var isSortableBy = isSortable(b, 'y');
          var isSortableA = isSortableAxy || isSortable(a, 'y');
          var isSortableB = isSortable(b, 'xy') || isSortableBy;
          if (!isSortableA && !isSortableB) {
            return 0;
          }
          if (isSortableA !== isSortableB) {
            return isSortableA ? -1 : 1;
          }
          if (isSortableAxy && isSortableBy) {
            return -1;
          } else if (isSortableBy && isSortableAxy) {
            return 1;
          } else if (isSortableAxy) {
            return getSortValue(a, 'xy') - getSortValue(b, 'xy');
          } else {
            return getSortValue(a, 'y') - getSortValue(b, 'y');
          }
        });
        $scope.graph.setCells(cells);
        var graphData = $scope.graph.toJSON();
        var p = utils.cellsToProject(graphData.cells);
        var tmp = utils.clone(common.allDependencies[block.type]);
        tmp.design.graph = p.design.graph;
        common.allDependencies[block.type] = tmp;
        project.changed = true;
      }

      $scope.editModeToggle = function ($event) {
        var btn = $event.currentTarget;
        if (!$scope.isNavigating) {
          utils.beginBlockingTask();
          var block = graph.breadcrumbs[graph.breadcrumbs.length - 1];
          var tmp = false;
          var rw = true;
          var lockImg = false;
          var lockImgSrc = false;
          if (common.isEditingSubmodule) {
            lockImg = $('img', btn);
            lockImgSrc = lockImg.attr('data-lock');
            lockImg[0].src = lockImgSrc;
            common.isEditingSubmodule = false;
            subModuleActive = false;
            var cells = $scope.graph.getCells();

            cells.sort((a, b) => {
              const isSortableAxy = isSortable(a, 'xy');
              const isSortableBy = isSortable(b, 'y');
              const isSortableA = isSortableAxy || isSortable(a, 'y');
              const isSortableB = isSortable(b, 'xy') || isSortableBy;

              if (!isSortableA && !isSortableB) {
                return 0; // Ninguno es sortable
              }

              if (isSortableA !== isSortableB) {
                // Si uno es sortable y el otro no, el sortable va primero
                // Aquí puedes decidir el orden de precedencia entre xy y y
                return isSortableA ? -1 : 1;
              }

              // Ambos son sortables, ahora comparamos basados en sus tipos y coordenadas
              if (isSortableAxy && isSortableBy) {
                // Si uno es de xy y el otro de y, priorizamos xy
                return -1;
              } else if (isSortableBy && isSortableAxy) {
                return 1;
              } else if (isSortableAxy) {
                return getSortValue(a, 'xy') - getSortValue(b, 'xy');
              } else {
                return getSortValue(a, 'y') - getSortValue(b, 'y');
              }
            });

            /*
         function isSortableConstMem(cell) {
  const type = cell.get('type');
  return type === 'ice.Constant' || type === 'ice.Memory';
}

cells.sort((a, b) => {
  const isSortableA = isSortableConstMem(a);
  const isSortableB = isSortableConstMem(b);

  if (isSortableA !== isSortableB) {
    return isSortableA ? -1 : 1;
  } else if (isSortableA) {
    return a.get('position').x - b.get('position').x;
  }
  return 0;
});

function isSortable(cell) {
  const type = cell.get('type');
  return type === 'ice.Input' || type === 'ice.Output';
}

cells.sort((a, b) => {
  const isSortableA = isSortable(a);
  const isSortableB = isSortable(b);

  if (isSortableA !== isSortableB) {
    return isSortableA ? -1 : 1;
  } else if (isSortableA) {
    return a.get('position').y - b.get('position').y;
  }
  return 0;
});
        */

            // Sort Constant/Memory cells by x-coordinate
            /* OPT1-- cells = _.sortBy(cells, function (cell) {
              if (
                cell.get('type') === 'ice.Constant' ||
                cell.get('type') === 'ice.Memory'
              ) {
                return cell.get('position').x;
              }
            });*/

            // Sort I/O cells by y-coordinate
            /*   OPT1-- cells = _.sortBy(cells, function (cell) {
              if (
              cell.get('type') === 'ice.Input' ||
              cell.get('type') === 'ice.Output'
              ) {
                return cell.get('position').y;
              }
            });*/

            $scope.graph.setCells(cells);

            var graphData = $scope.graph.toJSON();
            var p = utils.cellsToProject(graphData.cells);
            tmp = utils.clone(common.allDependencies[block.type]);
            tmp.design.graph = p.design.graph;
            var hId = block.type;
            common.allDependencies[hId] = tmp;

            /* ---------------------------------------- */
            /* Avoid automatically back on toggle edit  */
            //$scope.toRestore = hId;
            //common.forceBack = true;
            /* ---------------------------------------- */

            common.forceBack = false;
            navigateReload(tmp, rw);
          } else {
            //-- Entering edit mode
            if (collections.isCollectionBlock(block.type)) {
              //-- Forking remaps the PARENT design's instances. If the parent
              //-- is itself a shielded collection block we must not mutate it,
              //-- so require forking from the top down. The root is always a
              //-- valid (editable) parent.
              var fdepth = common.submoduleHeap
                ? common.submoduleHeap.length
                : 0;
              if (
                fdepth > 1 &&
                collections.isCollectionBlock(
                  common.submoduleHeap[fdepth - 2].id
                )
              ) {
                utils.endBlockingTask();
                alertify.warning(
                  gettextCatalog.getString(
                    'Fork the containing block first to be able to edit this ' +
                      'one.'
                  )
                );
                return;
              }
              //-- Collection block: fork it first so the canonical collection
              //-- block is never modified. Ask whether to fork only this
              //-- instance or all instances of this block in the design.
              utils.endBlockingTask();
              var blockName = block.name || '';
              pendingForkChoice = function (index) {
                //-- 0 = only this block, 1 = all in the design, 2 = cancel
                if (index !== 0 && index !== 1) {
                  return;
                }
                utils.beginBlockingTask();
                var clone = forkCollectionBlock(
                  block,
                  index === 0 ? 'one' : 'all'
                );
                $scope.toRestore = false;
                //-- isEditingSubmodule / subModuleActive / padlock are set by
                //-- the navigateProject handler from the (now local) clone.
                navigateReload(clone, false);
              };
              alertify.forkBlockDialog(
                utils.bold(blockName) +
                  '<br>' +
                  gettextCatalog.getString(
                    'This block belongs to a collection. Editing it will ' +
                      'create a local copy so the collection block is not ' +
                      'modified.'
                  ) +
                  '<br>' +
                  gettextCatalog.getString(
                    'Edit only this block, or all blocks of this type in ' +
                      'the design?'
                  )
              );
              return;
            }
            lockImg = $('img', btn);
            lockImgSrc = lockImg.attr('data-unlock');
            lockImg[0].src = lockImgSrc;
            tmp = common.allDependencies[block.type];
            $scope.toRestore = false;
            rw = false;
            common.isEditingSubmodule = true;
            subModuleActive = true;
            navigateReload(tmp, rw);
          }
        }
      };

      function loadSelectedGraph() {
        utils.beginBlockingTask();
        setTimeout(function () {
          _decoupledLoadSelectedGraph();
        }, 0);
      }

      function _decoupledLoadSelectedGraph() {
        var n = graph.breadcrumbs.length;
        var opt = { disabled: true };
        var design = false;
        var i = 0;
        //-- Read-only / padlock / edit flags for the level being loaded
        //-- (same rules as navigating in). n breadcrumbs == depth n-1.
        opt.disabled = applyViewFlags(
          n > 1 ? graph.breadcrumbs[n - 1].type : false,
          n - 1
        );
        if (n === 1) {
          design = project.get('design');
          if (
            $scope.toRestore !== false &&
            common.submoduleId !== false &&
            design.graph.blocks.length > 0
          ) {
            for (i = 0; i < design.graph.blocks.length; i++) {
              if (common.submoduleUID === design.graph.blocks[i].id) {
                design.graph.blocks[i].type = $scope.toRestore;
              }
            }

            $scope.toRestore = false;
          }

          graph.resetView();
          graph.loadDesign(design, opt, function () {
            $scope.isNavigating = false;
            utils.endBlockingTask();
          });
          $scope.topModule = true;
        } else {
          var type = graph.breadcrumbs[n - 1].type;
          var dependency = common.allDependencies[type];
          design = dependency.design;
          if (
            $scope.toRestore !== false &&
            common.submoduleId !== false &&
            design.graph.blocks.length > 0
          ) {
            for (i = 0; i < design.graph.blocks.length; i++) {
              if (common.submoduleUID === design.graph.blocks[i].id) {
                common.allDependencies[type].design.graph.blocks[i].type =
                  $scope.toRestore;
              }
            }
            $scope.toRestore = false;
          }
          graph.fitContent();
          graph.resetView();
          graph.loadDesign(dependency.design, opt, function () {
            $scope.isNavigating = false;
            utils.endBlockingTask();
          });
          $scope.information = dependency.package;
        }
      }

      $rootScope.$on('navigateProject', function (event, args) {
        //-- Going deeper from an editable view (double-click): persist the
        //-- current level first so intermediate edits are not lost on the way
        //-- down. breadcrumbs[last] / the live graph still belong to the level
        //-- we are leaving at this point.
        if (args.fromDoubleClick && common.isEditingSubmodule) {
          serializeCurrentSubdesign();
        }
        var opt = { disabled: true };
        if (typeof common.submoduleHeap === 'undefined') {
          common.submoduleHeap = [];
        }
        let heap = { id: false, uid: false };
        if (typeof args.submodule !== 'undefined') {
          common.submoduleId = args.submodule;
          heap.id = args.submodule;
        }
        if (typeof args.submoduleId !== 'undefined') {
          common.submoduleUID = args.submoduleId;

          heap.uid = args.submoduleId;
        }

        if (heap.id !== false || heap.uid !== false) {
          common.submoduleHeap.push(heap);
        }

        //-- Read-only / padlock / edit flags from collection membership and
        //-- depth. Root is editable; at depth 1 a shielded collection block is
        //-- read-only (padlock) while local blocks/forks are editable (no
        //-- padlock); deeper levels are read-only view (edit comes later).
        opt.disabled = applyViewFlags(
          common.submoduleId,
          common.submoduleHeap.length
        );

        //  utils.beginBlockingTask();
        if (args.update) {
          graph.resetView();
          project.update({ deps: false }, function () {
            graph.loadDesign(args.project.design, opt, function () {
              //  utils.endBlockingTask();
            });
          });
        } else {
          graph.resetView();

          graph.loadDesign(args.project.design, opt, function () {});
        }
        $scope.topModule = false;
        $scope.information = args.project.package;
        if (
          typeof common.forceBack !== 'undefined' &&
          common.forceBack === true
        ) {
          common.forceBack = false;
          $scope.breadcrumbsBack();
        }

        if (common.isEditingSubmodule || common.submoduleHeap.length === 0) {
          iceStudio.bus.events.publish('Navigation::ReadWrite');
        } else {
          iceStudio.bus.events.publish('Navigation::ReadOnly');
        }

        let flowInfo = { fromDoubleClick: args.fromDoubleClick ?? false };
        $rootScope.$broadcast('navigateProjectEnded', flowInfo);
      });

      $rootScope.$on('breadcrumbsBack', function (/*event*/) {
        $scope.breadcrumbsBack();
        utils.rootScopeSafeApply();
      });

      $rootScope.$on('editModeToggle', function (event) {
        $scope.editModeToggle(event);
        utils.rootScopeSafeApply();
        //utils.endBlockingTask();
      });
    }
  );
