/* Constraint-file importers/exporters.
 * Ports the logic of app/resources/boards/generator.py (PCF, ICE40) and
 * generator2.py (LPF, ECP5) to JavaScript, producing the same pinout shape:
 *   [{ name, value, type }]  (type: input | output | inout)
 */

/* exported parseConstraint, exportPCF */

//-- Parse a PCF (Lattice ICE40) constraint file
function parsePCF(text) {
  var pins = [];
  var lines = String(text).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (line.indexOf('set_io') !== 0) {
      continue;
    }

    //-- Separate the optional trailing comment (may carry the type)
    var type = 'inout';
    var hashIdx = line.indexOf('#');
    var code = line;
    if (hashIdx !== -1) {
      var comment = line.slice(hashIdx + 1);
      code = line.slice(0, hashIdx);
      var m = comment.match(/\b(input|output|inout)\b/);
      if (m) {
        type = m[1];
      }
    }

    //-- Tokenize the code part, dropping "set_io", flags (-xxx) and no/yes
    var tokens = code
      .trim()
      .split(/\s+/)
      .slice(1) //-- drop "set_io"
      .filter(function (t) {
        return t.length && t.charAt(0) !== '-' && t !== 'no' && t !== 'yes';
      });

    if (tokens.length < 2) {
      continue;
    }

    var value = tokens[tokens.length - 1];
    var name = tokens.slice(0, tokens.length - 1).join(' ');
    pins.push({ name: name, value: value, type: type });
  }
  return sortPins(pins);
}

//-- Parse an LPF (Lattice ECP5) constraint file
function parseLPF(text) {
  var pins = [];
  var pullmodes = {};
  var lines = String(text).split(/\r?\n/);

  //-- First pass: collect PULLMODE per signal (optional)
  for (var j = 0; j < lines.length; j++) {
    var pm = lines[j].match(/IOBUF\s+PORT\s+"(.*?)".*PULLMODE\s*=\s*(\w+)/i);
    if (pm) {
      pullmodes[pm[1]] = pm[2].toUpperCase();
    }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    var m = line.match(
      /LOCATE\s+COMP\s+"(.*?)"\s+SITE\s+"(.*?)"\s*;?\s*(?:#\s*(input|output|inout))?/i
    );
    if (!m) {
      continue;
    }
    var pin = { name: m[1], value: m[2], type: m[3] || 'inout' };
    if (pullmodes[m[1]]) {
      pin.pullmode = pullmodes[m[1]];
    }
    pins.push(pin);
  }
  return sortPins(pins);
}

//-- Parse a CST (Gowin / Sipeed Tang) constraint file
//--   IO_LOC  "name"  pin;
//--   IO_PORT "name"  IO_TYPE=LVCMOS33 PULL_MODE=UP;
function parseCST(text) {
  var pins = [];
  var ports = {};
  var lines = String(text).split(/\r?\n/);

  //-- Collect optional pull modes from IO_PORT lines
  for (var j = 0; j < lines.length; j++) {
    var pm = lines[j].match(/IO_PORT\s+"(.*?)".*PULL_MODE\s*=\s*(\w+)/i);
    if (pm) {
      ports[pm[1]] = pm[2].toUpperCase();
    }
  }

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    //-- Strip line comment (// ...)
    var hashIdx = line.indexOf('//');
    var type = 'inout';
    if (hashIdx !== -1) {
      var comment = line.slice(hashIdx + 2);
      line = line.slice(0, hashIdx);
      var tm = comment.match(/\b(input|output|inout)\b/i);
      if (tm) {
        type = tm[1].toLowerCase();
      }
    }
    var m = line.match(/IO_LOC\s+"([^"]+)"\s+([^;,\s]+)/i);
    if (!m) {
      continue;
    }
    var pin = { name: m[1], value: m[2], type: type };
    if (ports[m[1]] && ports[m[1]] !== 'NONE') {
      pin.pullmode = ports[m[1]];
    }
    pins.push(pin);
  }
  return sortPins(pins);
}

//-- Sort pins reverse-alphabetically by name to avoid label substring
//-- conflicts (same heuristic as generator.py)
function sortPins(pins) {
  return pins.sort(function (a, b) {
    if (a.name < b.name) {
      return 1;
    }
    if (a.name > b.name) {
      return -1;
    }
    return 0;
  });
}

//-- Xilinx Vivado / openXC7 .xdc constraints. Pin assignments look like:
//--   set_property PACKAGE_PIN <pin> [get_ports <name>]
//--   set_property -dict { PACKAGE_PIN <pin> IOSTANDARD ... } [get_ports <name>]
//-- XDC does not carry the port direction, so it defaults to "inout" unless a
//-- trailing "# input|output|inout" comment says otherwise.
function parseXDC(text) {
  var pins = [];
  var lines = String(text).split(/\r?\n/);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var type = 'inout';
    //-- Strip line comment (# ...) and read an optional direction hint
    var hashIdx = line.indexOf('#');
    if (hashIdx !== -1) {
      var comment = line.slice(hashIdx + 1);
      line = line.slice(0, hashIdx);
      var tm = comment.match(/\b(input|output|inout)\b/i);
      if (tm) {
        type = tm[1].toLowerCase();
      }
    }
    var pm = line.match(/PACKAGE_PIN\s+(\S+)/i);
    if (!pm) {
      continue;
    }
    var gp =
      line.match(/get_ports\s+\{([^}]+)\}/i) ||
      line.match(/get_ports\s+([^\s\]]+)/i);
    if (!gp) {
      continue;
    }
    pins.push({ name: gp[1].trim(), value: pm[1], type: type });
  }
  return sortPins(pins);
}

//-- Dispatch by file extension
function parseConstraint(filename, text) {
  if (/\.lpf$/i.test(filename)) {
    return parseLPF(text);
  }
  if (/\.cst$/i.test(filename)) {
    return parseCST(text);
  }
  if (/\.xdc$/i.test(filename)) {
    return parseXDC(text);
  }
  return parsePCF(text);
}

//-- Export a pinout array back to PCF text (documentation/round-trip)
function exportPCF(pinout) {
  var out = [];
  for (var i = 0; i < pinout.length; i++) {
    var p = pinout[i];
    out.push('set_io ' + p.name + ' ' + p.value + ' # ' + (p.type || 'inout'));
  }
  return out.join('\n') + '\n';
}
