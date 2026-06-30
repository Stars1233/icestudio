'use strict';

//---------------------------------------------------------------------------

//-- Boards
//---------------------------------------------------------------------------
//-- CONFIGURATION FILES
//---------------------------------------------------------------------------
//-- The Boards are described by three .json files, located in the folder
//-- resources/boards/boardname
//--    * pinout.json:  Pin numbers, names and type (input, output, inout)
//--    * info.json: Board information: resources, board name, interface...
//--    * rules.json: Automatic connection of unused pins
//--
//-- In addition there are two more OPTIONAL files:
//--    * pinout.pcf (optional): Board constraints. This is just for
//--      documentation purposes (the actual constraint file is automatically
//--      generated on the fly when the circuit is being sinthesized)
//--    * pinout.svg (optional): Drawing of all the pins
//----------------------------------------------------------------------------
//-- DATA STRUCTURES
//----------------------------------------------------------------------------
//-- ICESTUDIO converts the .json files into objects. You can access to all
//-- the boars from the following GLOBAL OBJECT:
//--
//--  common.boards
//--     * name:  Board name. Ex. alhmabra_ii
//--     * info:  Resources
//--     * pinout: Pin names, number and type
//--     * rules:  If the pin is automatically connected if not used
//--     * type:   FPGA familty and type
//--     * mode:   "apio" (default) | "integrated" | "project"
//--     * apioBoard: Identifier passed to apio.ini (defaults to name)
//--     * origin: "distribution" | "project"
//--     * readOnly: true for distribution boards (editor cannot modify them)
//--
//-- In addition to the distribution boards (resources/boards, listed in
//-- menu.json), boards can be defined inside the ACTIVE PROJECT, in the
//-- folder "<projectDir>/boards/<boardname>". Those are auto-discovered
//-- (no menu.json) and merged into common.boards, overriding distribution
//-- boards with the same name. Call loadBoards(projectDir) to include them.

//---------------------------------------------------------------
//-- MENU menu.json
//-- This file contains the names of all the available boards
//-- Only the boards located in that file are READ and inserted
//-- into the common.boards GLOBAL object
//---------------------------------------------------------------

angular
  .module('icestudio')
  .service('boards', function (utils, common, nodeFs, nodePath) {
    //-- Default board
    const DEFAULT = 'alhambra-ii';

    //-----------------------------------------------------------------
    //-- Read all the boards FILES and store all the information
    //-- in the GLOBAL OBJECT: common.boards
    //-----------------------------------------------------------------
    //-- Only the boards located in the menu.json FILE are READ
    //-----------------------------------------------------------------
    this.loadBoards = function (projectDir) {
      //-- Scan the boards distributed with Icestudio (resources/boards),
      //-- driven by menu.json (unchanged discovery)
      let dist = scanDistributionBoards();

      //-- Scan the boards defined inside the active project (<projectDir>/boards),
      //-- auto-discovered (no menu.json needed). Optional.
      let proj = projectDir ? scanProjectBoards(projectDir) : [];

      //-- Merge: project boards override distribution boards with the same name
      common.boards = mergeBoards(dist, proj);
    };

    //-----------------------------------------------------------------
    //-- Read the three mandatory JSON files of a board directory and
    //-- build the board record. Returns null if the directory is not a
    //-- valid board (missing files).
    //--
    //--  boardPath: absolute/relative path to the board directory
    //--  boardname: board identifier (directory name)
    //--  type:      FPGA family group (for the board menu UI)
    //--  origin:    'distribution' | 'project'
    //-----------------------------------------------------------------
    function readBoardDir(boardPath, boardname, type, origin) {
      //-- Every board should have at least their three MANDATORY files:
      //-- info.json, pinout.json and rules.json
      if (
        !(
          nodeFs.statSync(boardPath).isDirectory() &&
          nodeFs.statSync(nodePath.join(boardPath, 'info.json')).isFile() &&
          nodeFs.statSync(nodePath.join(boardPath, 'pinout.json')).isFile() &&
          nodeFs.statSync(nodePath.join(boardPath, 'rules.json')).isFile()
        )
      ) {
        return null;
      }

      //-- Board files ok. READ them!!
      let info = readJSONFile(boardPath, 'info.json');
      let pinout = readJSONFile(boardPath, 'pinout.json');
      let rules = readJSONFile(boardPath, 'rules.json');

      //-- Board build strategy (default for actions without explicit
      //-- commands): "apio" (apio runs the action) or "custom" (no apio
      //-- fallback; only the board's own commands run). Absent ⇒ "apio".
      //-- Back-compat aliases: legacy "integrated" ⇒ custom, "project" ⇒ apio
      //-- (project was a location, now tracked by 'origin').
      let mode = info.mode || 'apio';
      if (mode === 'integrated') {
        mode = 'custom';
      } else if (mode === 'project') {
        mode = 'apio';
      }

      //-- Apio board identifier. Absent ⇒ the directory name (current behavior).
      let apioBoard = (info.apio && info.apio.board) || boardname;

      //-- Fill the boards structure with all the information
      //-- obtained from the files
      return {
        name: boardname,
        info: info, //-- Board resources
        pinout: pinout, //-- Board pins
        rules: rules, //-- Board rules
        type: type, //-- FPGA family type
        mode: mode, //-- apio | integrated | project
        apioBoard: apioBoard, //-- identifier passed to apio.ini
        origin: origin, //-- distribution | project
        readOnly: origin === 'distribution', //-- distribution boards are read-only
      };
    }

    //-----------------------------------------------------------------
    //-- Scan the boards distributed with Icestudio. Only the boards
    //-- listed in menu.json are READ (unchanged behavior).
    //-----------------------------------------------------------------
    function scanDistributionBoards() {
      let boards = [];

      //-- Construct the Boards path: "resources/boards"
      let path = nodePath.join('resources', 'boards');

      //-- Read the board menu json file and convert into an object
      let menu = nodeFs.readFileSync(nodePath.join(path, 'menu.json'));
      menu = JSON.parse(menu);

      //-- The menu is divided in big sections: The FPGA family:
      //-- ICE40HX8k, ICE40HX4k, ICE40LPHX, UP5K, ECP5...
      menu.forEach((FPGAfamily) => {
        //-- Access to all the boards from the current family
        FPGAfamily.boards.forEach(function (boardname) {
          //-- The data from every board is located in the
          //-- folder "resources/boards/<boardname>"
          let boardPath = nodePath.join(path, boardname);

          //------------------------------------------------------------------
          //-- TODO: It can be improved: It is better to distinguis between
          //--  different errors, instead only one. If anyone
          //--  introduces a bad board, it is difficult to find where is
          //--  the error....
          //------------------------------------------------------------------
          try {
            let board = readBoardDir(
              boardPath,
              boardname,
              FPGAfamily.type,
              'distribution'
            );
            if (board) {
              boards.push(board);
            }

            //-- There was an error reading the board files
          } catch (error) {
            console.error('Board not well configured', error.message);
          }
        });
      });

      return boards;
    }

    //-----------------------------------------------------------------
    //-- Scan the boards defined inside the active project directory:
    //-- <projectDir>/boards/<boardname>. These are AUTO-DISCOVERED:
    //-- there is no menu.json, every subfolder with the three mandatory
    //-- files is loaded. The FPGA family group is taken from
    //-- info.group/info.type, defaulting to "PROJECT".
    //-----------------------------------------------------------------
    function scanProjectBoards(projectDir) {
      let boards = [];

      //-- The project boards live in "<projectDir>/boards"
      let path = nodePath.join(projectDir, 'boards');

      //-- No boards folder in the project: nothing to scan
      try {
        if (!nodeFs.statSync(path).isDirectory()) {
          return boards;
        }
      } catch (error) {
        return boards;
      }

      //-- Every subdirectory is a candidate board
      let entries = [];
      try {
        entries = nodeFs.readdirSync(path);
      } catch (error) {
        return boards;
      }

      entries.forEach(function (boardname) {
        let boardPath = nodePath.join(path, boardname);
        try {
          //-- Read the info first (if present) to find the menu group
          let info = readJSONFile(boardPath, 'info.json');
          let type = info.group || info.type || 'PROJECT';

          let board = readBoardDir(boardPath, boardname, type, 'project');
          if (board) {
            //-- A project board is just a board whose definition lives in the
            //-- project ('origin' === 'project'); its build strategy is the
            //-- normal mode (apio by default).
            boards.push(board);
          }
        } catch (error) {
          console.error('Project board not well configured', error.message);
        }
      });

      return boards;
    }

    //-----------------------------------------------------------------
    //-- Merge distribution and project boards. Project boards OVERRIDE
    //-- distribution boards with the same name (keeps the bare-name
    //-- contract used by project.design.board).
    //-----------------------------------------------------------------
    function mergeBoards(dist, proj) {
      let byName = {};
      let order = [];

      function add(board) {
        if (!(board.name in byName)) {
          order.push(board.name);
        }
        byName[board.name] = board;
      }

      dist.forEach(add);
      proj.forEach(add);

      return order.map(function (name) {
        return byName[name];
      });
    }

    //---- PENDING: DOCUMENTATION!!!!!!

    function readJSONFile(filepath, filename) {
      var ret = {};
      try {
        var data = nodeFs.readFileSync(nodePath.join(filepath, filename));
        ret = JSON.parse(data);
      } catch (err) {}
      return ret;
    }

    this.selectBoard = function (name) {
      name = name || DEFAULT;
      var i;
      var selectedBoard = null;
      for (i in common.boards) {
        if (common.boards[i].name === name) {
          selectedBoard = common.boards[i];
          break;
        }
      }
      if (selectedBoard === null) {
        // Board not found: select default board
        for (i in common.boards) {
          if (common.boards[i].name === DEFAULT) {
            selectedBoard = common.boards[i];
            break;
          }
        }
      }
      common.selectedBoard = selectedBoard;
      common.pinoutInputHTML = generateHTMLOptions(
        common.selectedBoard.pinout,
        'input'
      );
      common.pinoutOutputHTML = generateHTMLOptions(
        common.selectedBoard.pinout,
        'output'
      );
      utils.rootScopeSafeApply();
      return common.selectedBoard;
    };

    this.boardLabel = function (name) {
      for (var i in common.boards) {
        if (common.boards[i].name === name) {
          return common.boards[i].info.label;
        }
      }
      return name;
    };

    function generateHTMLOptions(pinout, type) {
      var code = '<option></option>';
      for (var i in pinout) {
        if (pinout[i].type === type || pinout[i].type === 'inout') {
          code +=
            '<option value="' +
            pinout[i].value +
            '">' +
            pinout[i].name +
            '</option>';
        }
      }
      return code;
    }
  });
