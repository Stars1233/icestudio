'use strict';

class IceBlock {
  constructor(opts) {
    this.constants = {};
    this.config = opts || {};
    this.fs = new IceHD();
    this.content = false;
  }

  loadFromFile(path, onLoadOK, onLoadERROR) {
    let _this = this;
    this.content = this.fs.readFile(
      path,
      function (filepath, content) {
        _this.content = content;
        onLoadOK(_this.get());
      },
      onLoadERROR
    );
  }

  svgFile(hash, svg) {
    let path = this.fs.joinPath(this.config.cacheDirImg, `${hash}.svg`);
    if (!this.fs.isValidPath(path)) {
      this.fs.writeFile(path, svg);
    }

    return path;
  }

  busLoadFromFile(args) {
    //-- Always publish 'block.loadedFromFile' (even on a read/parse error, with
    //-- obj=false) so the indexer can skip an invalid file and keep going. A
    //-- single malformed .ice (or a macOS ._ AppleDouble file) must never stall
    //-- the whole indexing pipeline.
    this.fs.readFile(
      args.path,
      function (path, content) {
        try {
          args.obj = JSON.parse(content);
        } catch (e) {
          args.obj = false;
        }
        iceStudio.bus.events.publish('block.loadedFromFile', args);
      },
      function (path) {
        args.obj = false;
        iceStudio.bus.events.publish('block.loadedFromFile', args);
      }
    );
  }

  get() {
    return this.content;
  }
}
