// Capture Terminal before addon-fit may overwrite module.exports.
// In NW.js module may or may not exist; xterm UMD falls back to self.
var Terminal = (typeof module !== 'undefined' && module.exports && module.exports.Terminal) || self.Terminal;
