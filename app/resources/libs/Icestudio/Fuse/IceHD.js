'use strict';

class IceHD {
  constructor() {
    this.fs = require('fs');
    this.path = require('path');
  }

  init() {
    this.fs = require('fs');
    this.path = require('path');
  }

  isValidPath(path) {
    return this.fs.existsSync(path);
  }

  isDir(path) {
    return this.fs.lstatSync(path).isDirectory();
  }

  isFile(path) {
    let stats = false;

    try {
      stats = this.fs.lstatSync(path).isFile();
    } catch (e) {
      // TODO: Handle error
      if (e.code == 'ENOENT') {
      } else {
      }
    }

    return stats;
  }

  isSymbolicLink(path) {
    return this.fs.lstatSync(path).isSymbolicLink();
  }

  joinPath(folder, name) {
    return this.path.join(folder, name);
  }

  basename(filepath) {
    let b = this.path.basename(filepath);
    let basen = b;
    if (this.isFile(filepath)) {
      // Is file
      basen = b.indexOf('.') < 0 ? b : b.substr(0, b.lastIndexOf('.'));
    }
    return basen;
  }

  readDir(folder) {
    let content = [];
    if (
      this.isValidPath(folder) &&
      (this.isDir(folder) || this.isSymbolicLink(folder))
    ) {
      content = this.fs.readdirSync(folder);
    }
    return content;
  }

  mkDir(folder) {
    //-- Check if the .icestudio folder exist
    if (!this.fs.existsSync(folder)) {
      //-- Create the .icestudio folder
      this.fs.mkdirSync(folder);
    }
  }

  getFilesRecursive(folder, level) {
    let _this = this;
    let fileTree = [];
    //-- Case-insensitive: collections may ship files with an uppercase
    //-- extension (e.g. a block saved as ".ICE"); otherwise they get silently
    //-- dropped from the disk scan and never reach the collection tree.
    const validator = /.*\.(ice|json|md)$/i;

    try {
      let content = this.fs.readdirSync(folder);
      level--;

      content.forEach(function (name) {
        let path = _this.joinPath(folder, name);
        if (_this.isValidPath(path) && _this.isDir(path)) {
          fileTree.push({
            name: name,
            path: path,
            isDir: true,
            children: level >= 0 ? _this.getFilesRecursive(path, level) : [],
          });
        } else if (validator.test(name) && name.indexOf('._') !== 0) {
          //-- Capture a lightweight signature (mtime + size) so consumers
          //-- (e.g. the collection indexer) can detect changes without
          //-- having to read the whole file. It travels with the env tree.
          let mtimeMs = 0;
          let size = 0;
          try {
            let st = _this.fs.statSync(path);
            mtimeMs = st.mtimeMs;
            size = st.size;
          } catch (e) {
            // Broken symlink or race: leave signature as 0 (forces reindex)
          }
          fileTree.push({
            name: _this.basename(name),
            isDir: false,
            path: path,
            mtimeMs: mtimeMs,
            size: size,
          });
        }
      });
    } catch (e) {
      console.warn(e);
    }

    return fileTree;
  }

  readFile(path, callback, callbackErr) {
    if (this.isValidPath(path)) {
      let content = this.fs.readFileSync(path).toString();
      callback(path, content);
    } else {
      if (typeof callbackErr !== 'undefined') callbackErr(path);
    }
  }

  writeFile(path, content, callback) {
    try {
      this.fs.writeFileSync(path, content);

      if (typeof callback !== 'undefined') callback(path, content);
    } catch (err) {
      console.error(err);
    }
  }

  coverPath(filepath) {
    return '"' + filepath + '"';
  }

  shellEscape(arrayArgs) {
    return arrayArgs.map(function (c) {
      if (c.indexOf('(') >= 0) {
        c = `"${c}"`;
      }
      return c;
    });
  }
}
