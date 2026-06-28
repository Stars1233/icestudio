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
      gettextCatalog,
      utils,
      common
    ) {
      //----------------------------------------------------------------
      //-- Module initialization
      //----------------------------------------------------------------

      console.log('---> scripts/controllers/design.js (RUN)');

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

      //-------------------------------------------------------------
      //-- FUNCTIONS
      //-------------------------------------------------------------

      // Breadcrumbs

      $scope.breadcrumbsNavigate = function (selectedItem) {
        var item;
        if (common.isEditingSubmodule) {
          alertify.warning(
            gettextCatalog.getString(
              'To navigate through the design, you need to close \"edit mode\".'
            )
          );
        } else {
          if (!$scope.isNavigating) {
            $scope.isNavigating = true;

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
        }
      };

      $scope.breadcrumbsBack = function () {
        if (!$scope.isNavigating) {
          $scope.isNavigating = true;
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
          } else {
            lockImg = $('img', btn);
            lockImgSrc = lockImg.attr('data-unlock');
            lockImg[0].src = lockImgSrc;
            tmp = common.allDependencies[block.type];
            $scope.toRestore = false;
            rw = false;
            common.isEditingSubmodule = true;
            subModuleActive = true;
          }
          setTimeout(() => {
            $rootScope.$broadcast('navigateProject', {
              update: false,
              project: tmp,
              editMode: rw,
              fromDoubleClick: false,
            });
            utils.rootScopeSafeApply();

            utils.endBlockingTask();
          }, 0);
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
        if (n === 1) {
          design = project.get('design');
          opt.disabled = false;
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

        if (typeof args.editMode !== 'undefined') {
          opt.disabled = args.editMode;
        }

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
