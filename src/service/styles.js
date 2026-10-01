// Installed document styles: the store, the checks, and serving their files.
// Owner: Style switcher 1.1. See docs/features/20260930.01_style_switcher/,
// architecture "Data / State Changes" and "Security & Privacy Notes".
//
// A style is a folder a reviewer installs once per machine with `lahe style
// add`. It lands at <state dir>/styles/<id>/ and holds only:
//
//   style.css        at most 1 MB, and it must pass the stylesheet rule below
//   metadata.json    at most 64 KB: name (required), description, version,
//                    palette. Other keys are kept on disk and never read
//   fonts/*.woff2    at most 16 files of at most 2 MB each
//   DESIGN.md and licence files, copied for the reader and never served
//
// THE SECURITY BOUNDARY IS THE STYLESHEET RULE. A style is third-party CSS
// applied to a page whose script line carries the review token. CSS can read
// attribute values through selectors and report them through any fetch (a
// url(), an @import, a remote font's unicode-range), so a sheet may reach its
// own fonts and inline images and nothing else. The check is one left-to-right
// tokenizer that follows CSS Syntax Level 3 in the places that matter:
// comments, strings and url() are read in the order a browser reads them, a
// string ends at an unescaped newline and a backslash-newline continues it,
// and names are matched ignoring case. It is a tokenizer and not a scan
// because each place a scan and a browser disagree is a way past it.
//
// It runs at install AND whenever a page server serves the file, so a
// hand-edited or hand-copied folder cannot skip it. Every file is read once:
// checked not to be a symlink, opened without following one, checked as a
// regular file on that same handle, and the bytes that were checked are the
// bytes that are written or served.
//
// Nothing here is reached from the helper. The page servers answer the
// reserved `.lahe-styles` segment through answer(), and `lahe style add` and
// `lahe style list` call install() and list().
//
// Node-only.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

var stateDir = require("./state_dir.js");
var rules = require("../shared/style_rules.js");

// The reserved path segment. Any request whose path has it is answered from
// the installed styles, never from the disk under a served root.
var SEGMENT = ".lahe-styles";

// The house style, which is always there and is never installed. The id,
// colour and name rules live in src/shared/style_rules.js so the rail checks
// the same ones.
var RESERVED_ID = rules.RESERVED_ID;
var RESERVED_NAME = rules.RESERVED_NAME;

var FONT_NAME = /^[a-z0-9][a-z0-9._-]*\.woff2$/;
var LICENCE_NAME = /^(?:licen[cs]e|copying|ofl)(?:[._-][A-Za-z0-9._-]*)?$/i;
var READER_FILES = ["DESIGN.md"];
var VERSION = /^[A-Za-z0-9.+-]{1,20}$/;
// Control characters (C0, DEL, C1) and the bidirectional overrides and
// isolates. A metadata string is printed in a terminal and a name is written
// into a note to the agent, so none of these may ride in on one. Spelled as
// escapes: a literal bidi character in source reorders what a reviewer sees.
var BAD_CHARS_SOURCE = "[\\u0000-\\u001f\\u007f-\\u009f\\u202a-\\u202e\\u2066-\\u2069]";
var BAD_CHARS = new RegExp(BAD_CHARS_SOURCE);
var BAD_CHARS_ALL = new RegExp(BAD_CHARS_SOURCE, "g");

var LIMITS = {
  sheetBytes: 1024 * 1024,
  metadataBytes: 64 * 1024,
  fontBytes: 2 * 1024 * 1024,
  fontCount: 16,
  // DESIGN.md and licences are never served, but they are read into memory,
  // so they get a cap too.
  readerBytes: 1024 * 1024,
  nameChars: rules.NAME_MAX,
  descriptionChars: rules.DESCRIPTION_MAX,
  paletteColours: rules.PALETTE_MAX
};

// Functions that fetch a file named by a string. url() is checked on its own.
var FETCHING_FUNCTIONS = ["image-set", "image", "cross-fade", "src", "element"];
var DATA_TYPES = ["image/svg+xml", "image/png", "font/woff2"];

var FOLDER_HELP = [
  "A style folder holds:",
  "  style.css      at most 1 MB",
  "  metadata.json  at most 64 KB, with a \"name\" of letters, digits, spaces, hyphens,",
  "                 apostrophes and ampersands, at most 40 characters",
  "  fonts/         optional: up to 16 .woff2 files of at most 2 MB each",
  "The folder's name is the style's id. The stylesheet may reach only its own fonts,",
  "as url(\"./fonts/<file>.woff2\"), and data: images (svg, png) or woff2 fonts. It may",
  "not use @import, any other url(), image-set() and the like, or a backslash escape",
  "outside a string. Nothing in the folder may be a symlink."
].join("\n");

var O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

// Test seams, empty in the product.
//  - afterLock: the lock is held and nothing is written yet.
//  - beforeStaleTakeover: a stale lock has been read and not yet taken over.
//  - beforeFirstRename: the new folder is written; nothing is renamed yet.
//  - betweenRenames: an installed style has been renamed aside and the new one
//    not yet renamed in, the one moment a failure must put the old one back.
var hooks = { afterLock: null, beforeStaleTakeover: null, beforeFirstRename: null, betweenRenames: null };

var LOCK_STALE_MS = 60 * 1000;

// ---------------------------------------------------------------------------
// Small rules
// ---------------------------------------------------------------------------

var isStyleId = rules.isStyleId;

/** The id a folder name makes, or null: lowercased, spaces and underscores to hyphens. */
function idFromFolderName(name) {
  var id = String(name || "").toLowerCase().replace(/[ _]/g, "-");
  return isStyleId(id) ? id : null;
}

/** A value safe to print: no control or bidi characters, at most 80 characters. */
function clean(value) {
  var text = String(value).replace(BAD_CHARS_ALL, "?");
  return text.length > 80 ? text.slice(0, 77) + "..." : text;
}

function refuse(reason) {
  return { ok: false, reason: reason };
}

function sizeWords(bytes) {
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)) + " MB";
  return (bytes / 1024) + " KB";
}

// ---------------------------------------------------------------------------
// The stylesheet rule
// ---------------------------------------------------------------------------

// CSS Syntax 3, 3.3: CR LF, CR and FF are one newline, and NUL is U+FFFD.
function preprocess(text) {
  return String(text).replace(/\r\n|\r|\f/g, "\n").replace(/\u0000/g, "�");
}

function isWhitespace(c) {
  return c === " " || c === "\t" || c === "\n";
}

// Name code points, plus digits and hyphen. A backslash is never one here,
// because a backslash outside a string refuses the sheet.
function isIdentChar(c) {
  if (c === undefined) return false;
  var code = c.charCodeAt(0);
  return (code >= 0x61 && code <= 0x7a) || (code >= 0x41 && code <= 0x5a) ||
    (code >= 0x30 && code <= 0x39) || c === "-" || c === "_" || code >= 0x80;
}

function isNonPrintable(c) {
  var code = c.charCodeAt(0);
  return code <= 0x08 || code === 0x0b || (code >= 0x0e && code <= 0x1f) || code === 0x7f;
}

function readIdent(css, start) {
  var j = start;
  while (j < css.length && isIdentChar(css[j])) j += 1;
  return { name: css.slice(start, j).toLowerCase(), end: j };
}

// A vendor prefix does not change what a function does: -webkit-image-set()
// fetches the way image-set() does.
function baseName(name) {
  var match = /^-[a-z0-9]+-(.+)$/.exec(name);
  return match ? match[1] : name;
}

/**
 * One string token, from its opening quote (CSS Syntax 3, 4.3.5). A newline
 * that is not escaped ends it as a bad string, and the newline is NOT
 * consumed: a browser reads what follows as CSS, so this does too. A
 * backslash-newline continues the string. The end of the input ends it.
 */
function readString(css, start) {
  var quote = css[start];
  var j = start + 1;
  while (j < css.length) {
    var c = css[j];
    if (c === quote) return { end: j + 1, value: css.slice(start + 1, j), bad: false };
    if (c === "\n") return { end: j, value: css.slice(start + 1, j), bad: true };
    if (c === "\\") { j += 2; continue; }
    j += 1;
  }
  return { end: css.length, value: css.slice(start + 1), bad: false };
}

/**
 * The argument of url(, from just after the parenthesis (CSS Syntax 3, 4.3.4
 * and 4.3.6). A quoted argument must be followed by nothing but `)`; an
 * unquoted one may not hold a quote, a parenthesis, a space before its end, a
 * backslash or a non-printable character. Anything a browser would read as a
 * bad url is refused rather than guessed at.
 */
function readUrl(css, start) {
  var j = start;
  while (j < css.length && isWhitespace(css[j])) j += 1;
  if (css[j] === "\"" || css[j] === "'") {
    var str = readString(css, j);
    if (str.bad) return refuse("it has a url() whose string is broken by a newline");
    var k = str.end;
    while (k < css.length && isWhitespace(css[k])) k += 1;
    if (css[k] !== ")") return refuse("it has url(" + clean(str.value) + ") with something after its string");
    return { ok: true, value: str.value, end: k + 1 };
  }
  var m = j;
  while (m < css.length) {
    var c = css[m];
    if (c === ")") return { ok: true, value: css.slice(j, m), end: m + 1 };
    if (isWhitespace(c)) {
      var after = m;
      while (after < css.length && isWhitespace(css[after])) after += 1;
      if (after >= css.length || css[after] === ")") return { ok: true, value: css.slice(j, m), end: after + 1 };
      return refuse("it has a url(" + clean(css.slice(j, m)) + " ...) with a space inside it");
    }
    if (c === "\\") return refuse("it has a url() holding a backslash escape; write the path plainly");
    if (c === "\"" || c === "'" || c === "(" || isNonPrintable(c)) {
      return refuse("it has a url(" + clean(css.slice(j, m + 1)) + " ...) that a browser would read as broken");
    }
    m += 1;
  }
  return { ok: true, value: css.slice(j), end: css.length };
}

// Percent-decoding a data: URL's payload the way a browser does: each %XX is
// one byte, and every other character is its UTF-8 bytes.
function percentDecodeBytes(payload) {
  var bytes = [];
  for (var i = 0; i < payload.length; i += 1) {
    var c = payload[i];
    if (c === "%" && /^[0-9A-Fa-f]{2}$/.test(payload.slice(i + 1, i + 3))) {
      bytes.push(parseInt(payload.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      var encoded = Buffer.from(c, "utf8");
      for (var b = 0; b < encoded.length; b += 1) bytes.push(encoded[b]);
    }
  }
  return Buffer.from(bytes);
}

// Words a decoded data: SVG may not hold, and why. An SVG used behind mask,
// filter or clip-path loads as a document of its own, so anything that names
// another file, or a way to spell one this check cannot read, is refused.
var SVG_REFUSALS = [
  [/href/, "href, which can load another file"],
  [/url\(/, "url(, which can load another file"],
  [/@import/, "@import, which can load another file"],
  [/&/, "an & entity, which can spell a fetch this check cannot read"],
  [/\\/, "a backslash, which can spell a fetch this check cannot read"],
  [/\bsrc\s*=/, "src=, which can load another file"],
  [/<foreignobject/, "foreignObject, which can hold HTML"],
  [/<style/, "a style element, which is CSS this check does not read"],
  [/image-set/, "image-set, which can load another file"],
  [/\bimage\s*\(/, "image(, which can load another file"],
  [/\bsrc\s*\(/, "src(, which can load another file"],
  [/<\?xml[^>]*encoding\s*=\s*["']?(?!utf-8["'\s?])/, "an XML encoding other than UTF-8"]
];

/**
 * A data: URL is allowed only as an SVG, a PNG or a woff2 font, read the way
 * a browser's URL parser reads it: tab, CR and LF are dropped from the whole
 * value, the payload is percent-decoded, and only then base64-decoded, and
 * only when the header ends in ;base64. A decoded SVG must be UTF-8 text with
 * no NUL and none of SVG_REFUSALS.
 */
function checkDataUrl(value) {
  var comma = value.indexOf(",");
  if (comma === -1) return refuse("it has a data: url with no comma");
  var headerText = value.slice(5, comma).toLowerCase();
  var header = headerText.split(";");
  var type = header[0].trim();
  if (DATA_TYPES.indexOf(type) === -1) {
    return refuse("it has a data: url of type " + clean(type || "none") +
      "; only data:image/svg+xml, data:image/png and data:font/woff2 are allowed");
  }
  var base64 = /;[ ]*base64[ ]*$/.test(headerText);
  for (var i = 1; i < header.length; i += 1) {
    var param = header[i].trim();
    if (param === "base64" && i === header.length - 1) continue;
    if (!/^charset=[a-z0-9._-]+$/.test(param)) return refuse("it has a data: url with the parameter " + clean(param));
  }
  if (type !== "image/svg+xml") return { ok: true };
  var bytes = percentDecodeBytes(value.slice(comma + 1));
  if (base64) bytes = Buffer.from(bytes.toString("latin1"), "base64");
  var problem = encodingProblem(bytes, "its data: SVG");
  if (problem) return refuse(problem);
  var text = UTF8.decode(bytes).toLowerCase();
  for (var r = 0; r < SVG_REFUSALS.length; r += 1) {
    if (SVG_REFUSALS[r][0].test(text)) return refuse("its data: SVG holds " + SVG_REFUSALS[r][1]);
  }
  return { ok: true };
}

function checkUrlValue(rawValue, fonts) {
  // A browser's URL parser drops tab, CR and LF anywhere in a URL and trims
  // leading and trailing C0 controls and spaces, so the check reads it the
  // same way.
  var value = rawValue.replace(/[\t\r\n]/g, "").replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, "");
  if (value.indexOf("\\") !== -1) return refuse("it has a url() holding a backslash escape; write the path plainly");
  var font = /^(?:\.\/)?fonts\/([^/]*)$/.exec(value);
  if (font) {
    var name = font[1];
    if (!/\.woff2$/.test(name)) return refuse("it names fonts/" + clean(name) + ", which is not a .woff2 font");
    if (!FONT_NAME.test(name)) return refuse("it names fonts/" + clean(name) + ", which is not a font name Lahe takes");
    if (fonts.indexOf(name) === -1) return refuse("it names fonts/" + clean(name) + ", which the folder lacks");
    return { ok: true };
  }
  if (/^data:/i.test(value)) return checkDataUrl(value);
  return refuse("it has url(" + clean(value) + "), which reaches outside the style; a style may use only " +
    "url(\"./fonts/<file>.woff2\") and data: images");
}

/**
 * The stylesheet rule. `options.fonts` is the list of woff2 file names the
 * style's fonts folder holds.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function checkStylesheet(text, options) {
  var fonts = (options && Array.isArray(options.fonts)) ? options.fonts : [];
  var css = preprocess(text);
  var i = 0;
  while (i < css.length) {
    var c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      var close = css.indexOf("*/", i + 2);
      i = close === -1 ? css.length : close + 2;
      continue;
    }
    if (c === "\"" || c === "'") {
      i = readString(css, i).end;
      continue;
    }
    if (c === "\\") {
      return refuse("it has a backslash escape outside a string, which can spell url( or @import in a way a check misses");
    }
    if (c === "@") {
      var at = readIdent(css, i + 1);
      if (baseName(at.name) === "import") return refuse("it uses @import, which loads another stylesheet");
      if (at.name === "charset") {
        var k = at.end;
        while (k < css.length && isWhitespace(css[k])) k += 1;
        var named = css[k] === "\"" || css[k] === "'" ? readString(css, k) : null;
        if (!named || named.bad || named.value.toLowerCase() !== "utf-8") {
          return refuse("it has an @charset other than \"utf-8\"; a style must be UTF-8");
        }
      }
      i = Math.max(at.end, i + 1);
      continue;
    }
    if (isIdentChar(c)) {
      var word = readIdent(css, i);
      if (css[word.end] === "(") {
        var fn = baseName(word.name);
        if (fn === "url") {
          var url = readUrl(css, word.end + 1);
          if (!url.ok) return url;
          var verdict = checkUrlValue(url.value, fonts);
          if (!verdict.ok) return verdict;
          i = url.end;
          continue;
        }
        if (FETCHING_FUNCTIONS.indexOf(fn) !== -1) {
          return refuse("it uses " + fn + "(), which can fetch a file by name and is not allowed in a style");
        }
      }
      i = word.end;
      continue;
    }
    i += 1;
  }
  return { ok: true };
}

// THE BYTES COME FIRST. The tokenizer reads text as UTF-8. A browser reads a
// stylesheet with a UTF-16 byte-order mark as UTF-16 whatever the server or
// the sheet says, and an @charset can name another encoding for a file opened
// from disk. Either way the checked text is not the text the browser runs. So
// the one check install and serve both call refuses every byte shape a
// browser could decode as anything but the UTF-8 that was checked.
var UTF8 = new TextDecoder("utf-8", { fatal: true });

/** A reason the bytes could be read as anything but plain UTF-8, or null. */
function encodingProblem(bytes, label) {
  if (bytes.length >= 2 && ((bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xff && bytes[1] === 0xfe))) {
    return label + " starts with a UTF-16 byte-order mark; a style must be UTF-8";
  }
  if (bytes.indexOf(0) !== -1) return label + " holds a NUL byte; a style must be UTF-8 text";
  try {
    UTF8.decode(bytes);
  } catch (err) {
    return label + " is not valid UTF-8";
  }
  return null;
}

/**
 * The stylesheet rule on the file's bytes, which is what install and serve
 * both run. A UTF-8 byte-order mark is allowed (a browser reads it as UTF-8)
 * and dropped before the tokenizer.
 *
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
function checkStylesheetBytes(bytes, options) {
  var buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  var problem = encodingProblem(buffer, "the sheet");
  if (problem) return refuse(problem);
  return checkStylesheet(UTF8.decode(buffer), options);
}

// ---------------------------------------------------------------------------
// The metadata rule
// ---------------------------------------------------------------------------

/** The dotted path of the first string anywhere in `value` holding a bad character. */
function badStringPath(value, where) {
  if (typeof value === "string") return BAD_CHARS.test(value) ? where : null;
  if (value && typeof value === "object") {
    var keys = Object.keys(value);
    for (var i = 0; i < keys.length; i += 1) {
      if (BAD_CHARS.test(keys[i])) return where + "." + clean(keys[i]);
      var found = badStringPath(value[keys[i]], where + "." + keys[i]);
      if (found) return found;
    }
  }
  return null;
}

/**
 * The metadata rule. Returns only the fields Lahe uses, checked.
 *
 * @returns {{ok: true, metadata: {name: string, description: string, version: string, palette: string[]}}
 *   | {ok: false, reason: string}}
 */
function checkMetadata(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return refuse("metadata.json must hold a JSON object");
  var bad = badStringPath(value, "metadata");
  if (bad) return refuse("metadata.json has a control character or a bidi override in " + bad);
  var name = value.name;
  if (!rules.isStyleName(name)) {
    return refuse("metadata.json needs a name of letters, digits, spaces, hyphens, apostrophes and ampersands, " +
      "at most " + LIMITS.nameChars + " characters");
  }
  var description = "";
  if (value.description !== undefined && value.description !== null) {
    if (typeof value.description !== "string" || value.description.length > LIMITS.descriptionChars) {
      return refuse("metadata.json's description must be text of at most " + LIMITS.descriptionChars + " characters");
    }
    description = value.description;
  }
  var version = "";
  if (value.version !== undefined && value.version !== null) {
    if (typeof value.version !== "string" || !VERSION.test(value.version)) {
      return refuse("metadata.json's version must be at most 20 letters, digits, dots, plus signs and hyphens");
    }
    version = value.version;
  }
  var palette = [];
  if (value.palette !== undefined && value.palette !== null) {
    if (!Array.isArray(value.palette)) return refuse("metadata.json's palette must be a list of {\"value\": \"#hex\"}");
    for (var i = 0; i < value.palette.length; i += 1) {
      var entry = value.palette[i];
      if (!entry || typeof entry !== "object" || !rules.isHexColour(entry.value)) {
        return refuse("metadata.json's palette entry " + (i + 1) + " is not {\"value\": \"#hex\"} with 3, 4, 6 or 8 hex digits");
      }
      if (palette.length < LIMITS.paletteColours) palette.push(entry.value);
    }
  }
  return { ok: true, metadata: { name: name, description: description, version: version, palette: palette } };
}

// ---------------------------------------------------------------------------
// Reading files once
// ---------------------------------------------------------------------------

function lstatOrNull(target) {
  try {
    return fs.lstatSync(target);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return null;
    throw err;
  }
}

/**
 * Read one file once: not a symlink, opened without following one, a regular
 * file on that same handle, within its size cap. With `served`, also one link
 * only and inside `realRoot`, since a served file must be the one the store
 * holds and nothing a hard link or a swapped folder points elsewhere.
 *
 * @returns {{ok: true, bytes: Buffer, stat: fs.Stats} | {ok: false, reason: string, missing?: boolean}}
 */
function readOnce(file, maxBytes, label, options) {
  var opts = options || {};
  var lst;
  try { lst = lstatOrNull(file); } catch (err) { return refuse(label + " cannot be read (" + err.code + ")"); }
  if (!lst) return { ok: false, missing: true, reason: label + " is missing" };
  if (lst.isSymbolicLink()) return refuse(label + " is a symlink; a style's files are read from real files only");
  if (!lst.isFile()) return refuse(label + " is not a regular file");
  var fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | O_NOFOLLOW);
  } catch (err) {
    if (err.code === "ELOOP") return refuse(label + " is a symlink; a style's files are read from real files only");
    if (err.code === "ENOENT") return { ok: false, missing: true, reason: label + " is missing" };
    return refuse(label + " cannot be read (" + err.code + ")");
  }
  try {
    var stat = fs.fstatSync(fd);
    if (!stat.isFile()) return refuse(label + " is not a regular file");
    if (opts.served && stat.nlink > 1) return refuse(label + " has more than one hard link");
    if (stat.size > maxBytes) {
      return refuse(label + " is too large: " + stat.size + " bytes, and the limit is " + sizeWords(maxBytes));
    }
    if (opts.realRoot) {
      var real;
      try { real = fs.realpathSync(file); } catch (err) { return refuse(label + " cannot be resolved"); }
      if (real.indexOf(opts.realRoot + path.sep) !== 0) return refuse(label + " resolves outside the styles folder");
    }
    if (opts.cached && opts.cached.size === stat.size && opts.cached.mtimeMs === stat.mtimeMs &&
        opts.cached.ctimeMs === stat.ctimeMs && opts.cached.ino === stat.ino && opts.cached.dev === stat.dev) {
      return { ok: true, bytes: opts.cached.bytes, stat: stat, fromCache: true };
    }
    var bytes = fs.readFileSync(fd);
    if (bytes.length > maxBytes) {
      return refuse(label + " is too large: " + bytes.length + " bytes, and the limit is " + sizeWords(maxBytes));
    }
    return { ok: true, bytes: bytes, stat: stat };
  } finally {
    fs.closeSync(fd);
  }
}

/** A folder that is really a folder, or a reason. `missing` when it is not there. */
function checkFolder(folder, label) {
  var lst;
  try { lst = lstatOrNull(folder); } catch (err) { return refuse(label + " cannot be read (" + err.code + ")"); }
  if (!lst) return { ok: false, missing: true, reason: label + " is missing" };
  if (lst.isSymbolicLink()) return refuse(label + " is a symlink; a style is read from real folders only");
  if (!lst.isDirectory()) return refuse(label + " is not a folder");
  return { ok: true };
}

function sortedNames(folder) {
  return fs.readdirSync(folder).sort();
}

// ---------------------------------------------------------------------------
// Reading a style folder to install it
// ---------------------------------------------------------------------------

/**
 * Read and check a style folder the reviewer downloaded. Nothing is written.
 * Files that are not part of a style (a specimen page, screenshots, build
 * scripts, dotfiles) are left behind rather than refused: a real style folder
 * carries them.
 *
 * @returns {{ok: true, id: string, metadata: object, files: {rel: string, bytes: Buffer}[]}
 *   | {ok: false, reason: string}}
 */
function readStyleFolder(folder) {
  var abs = path.resolve(String(folder || ""));
  var base = path.basename(abs);
  var here = checkFolder(abs, abs);
  if (!here.ok) return here.missing ? refuse("there is no folder at " + clean(abs)) : here;

  var id = idFromFolderName(base);
  if (!id) {
    return refuse("the folder name " + clean(base) + " does not make a style id: use letters, digits, hyphens, " +
      "spaces or underscores, at most 40 characters, starting with a letter or digit. Rename the folder");
  }
  if (id === RESERVED_ID) {
    return refuse("\"international\" is the " + RESERVED_NAME + ", Lahe's own house style, and cannot be installed. Rename the folder");
  }

  var sheet = readOnce(path.join(abs, "style.css"), LIMITS.sheetBytes, "style.css");
  if (!sheet.ok) return sheet.missing ? refuse("the folder has no style.css") : sheet;
  var metaFile = readOnce(path.join(abs, "metadata.json"), LIMITS.metadataBytes, "metadata.json");
  if (!metaFile.ok) return metaFile.missing ? refuse("the folder has no metadata.json; it needs one with at least a name") : metaFile;
  var parsed;
  try { parsed = JSON.parse(metaFile.bytes.toString("utf8")); } catch (err) { return refuse("metadata.json is not valid JSON"); }
  var meta = checkMetadata(parsed);
  if (!meta.ok) return meta;

  var files = [{ rel: "style.css", bytes: sheet.bytes }, { rel: "metadata.json", bytes: metaFile.bytes }];
  var fonts = [];
  var fontsDir = path.join(abs, "fonts");
  var fontsHere = checkFolder(fontsDir, "fonts");
  if (!fontsHere.ok && !fontsHere.missing) return fontsHere;
  if (fontsHere.ok) {
    var names = sortedNames(fontsDir);
    for (var i = 0; i < names.length; i += 1) {
      var name = names[i];
      if (name.charAt(0) === ".") continue;
      var rel = "fonts/" + name;
      // A .woff2 is a font whatever its name says, so ofl-sans.woff2 counts.
      if (!/\.woff2$/i.test(name) && LICENCE_NAME.test(name)) {
        var licence = readOnce(path.join(fontsDir, name), LIMITS.readerBytes, rel);
        if (!licence.ok) return licence;
        files.push({ rel: rel, bytes: licence.bytes });
        continue;
      }
      if (!/\.woff2$/i.test(name)) return refuse(clean(rel) + " is not a .woff2 font; a style's fonts are .woff2 files only");
      if (!FONT_NAME.test(name)) {
        return refuse(clean(rel) + " is not a font name Lahe takes: lowercase letters, digits, dots, hyphens and underscores, ending .woff2");
      }
      fonts.push(name);
    }
    if (fonts.length > LIMITS.fontCount) {
      return refuse("fonts/ holds " + fonts.length + " fonts, and a style may have at most " + LIMITS.fontCount);
    }
    for (var f = 0; f < fonts.length; f += 1) {
      var font = readOnce(path.join(fontsDir, fonts[f]), LIMITS.fontBytes, "fonts/" + fonts[f]);
      if (!font.ok) return font;
      files.push({ rel: "fonts/" + fonts[f], bytes: font.bytes });
    }
  }

  var verdict = checkStylesheetBytes(sheet.bytes, { fonts: fonts });
  if (!verdict.ok) return refuse("style.css is refused: " + verdict.reason);

  var top = sortedNames(abs);
  for (var t = 0; t < top.length; t += 1) {
    var entry = top[t];
    if (READER_FILES.indexOf(entry) === -1 && !LICENCE_NAME.test(entry)) continue;
    var reader = readOnce(path.join(abs, entry), LIMITS.readerBytes, entry);
    if (!reader.ok) {
      if (reader.missing) continue;
      if (LICENCE_NAME.test(entry) && /not a regular file/.test(reader.reason)) continue;
      return reader;
    }
    files.push({ rel: entry, bytes: reader.bytes });
  }

  return { ok: true, id: id, metadata: meta.metadata, files: files };
}

// ---------------------------------------------------------------------------
// Installing
// ---------------------------------------------------------------------------

function lockPath(dir, id) {
  return path.join(stateDir.stylesRoot(dir), "." + id + ".lock");
}

function readOrNull(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (err) { return null; }
}

function errorWords(err) {
  if (err && typeof err === "object") return String(err.code || err.message || "unknown error");
  return String(err);
}

/**
 * Take the per-id install lock. Returns the nonce written into it, or null
 * when another add holds it. Throws only on a file system error.
 *
 * A lock older than a minute belongs to an add that died and is taken over,
 * but only if it still holds what was read: it is renamed aside (atomic),
 * and if what was renamed is not what was read, a live add took the lock in
 * between, so it is put back and this add stands down.
 */
function takeLock(lock) {
  var nonce = crypto.randomBytes(16).toString("hex");
  for (var attempt = 0; attempt < 2; attempt += 1) {
    try {
      var fd = fs.openSync(lock, "wx", stateDir.FILE_MODE);
      try { fs.writeSync(fd, nonce + "\n"); } finally { fs.closeSync(fd); }
      return nonce;
    } catch (err) {
      if (!err || err.code !== "EEXIST") throw err;
    }
    var seen = readOrNull(lock);
    var age;
    try { age = Date.now() - fs.lstatSync(lock).mtimeMs; } catch (gone) { continue; }
    if (age <= LOCK_STALE_MS || seen === null) return null;
    if (typeof hooks.beforeStaleTakeover === "function") hooks.beforeStaleTakeover();
    var aside = lock + ".stale-" + nonce;
    try { fs.renameSync(lock, aside); } catch (gone) { continue; }
    if (readOrNull(aside) !== seen) {
      try { fs.linkSync(aside, lock); } catch (taken) { /* a newer lock is already there */ }
      try { fs.unlinkSync(aside); } catch (gone) { /* already gone */ }
      return null;
    }
    try { fs.unlinkSync(aside); } catch (gone) { /* already gone */ }
  }
  return null;
}

/** Release the lock only if it is still ours. */
function releaseLock(lock, nonce) {
  if (readOrNull(lock) !== nonce + "\n") return;
  try { fs.unlinkSync(lock); } catch (err) { /* already gone */ }
}

function writeStyleFiles(folder, files) {
  stateDir.ensureDir(folder);
  files.forEach(function (file) {
    var target = path.join(folder, file.rel);
    stateDir.ensureDir(path.dirname(target));
    fs.writeFileSync(target, file.bytes, { mode: stateDir.FILE_MODE, flag: "wx" });
  });
}

function removeQuietly(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch (err) { /* reported by the caller's answer */ }
}

/**
 * Install a style folder into the state directory. Reads and checks every
 * file once, writes those same bytes into a new folder beside the target,
 * then swaps it in: an installed style is renamed aside, the new one renamed
 * in, and the old one removed. A failure between the two renames puts the old
 * one back. Every failure is an answer with a reason, never a thrown error,
 * and no .new- or .old- folder is left behind.
 *
 * @returns {{ok: true, id: string, name: string, replaced: boolean, folder: string}
 *   | {ok: false, reason: string}}
 */
function install(dir, folder) {
  var read = readStyleFolder(folder);
  if (!read.ok) return read;
  var id = read.id;
  var root;
  var lock;
  var nonce;
  try {
    root = stateDir.ensureStylesRoot(dir);
    lock = lockPath(dir, id);
    nonce = takeLock(lock);
  } catch (err) {
    return refuse("could not take the install lock for " + id + " (" + errorWords(err) + ")");
  }
  if (!nonce) return refuse("another lahe style add of " + id + " is running; try again when it finishes");
  var stamp = process.pid + "-" + nonce.slice(0, 8);
  var fresh = path.join(root, "." + id + ".new-" + stamp);
  var aside = path.join(root, "." + id + ".old-" + stamp);
  var target = path.join(root, id);
  var movedAside = false;
  try {
    if (typeof hooks.afterLock === "function") hooks.afterLock();
    writeStyleFiles(fresh, read.files);
    if (typeof hooks.beforeFirstRename === "function") hooks.beforeFirstRename();
    var existing = lstatOrNull(target);
    if (existing) {
      fs.renameSync(target, aside);
      movedAside = true;
      if (typeof hooks.betweenRenames === "function") hooks.betweenRenames();
    }
    fs.renameSync(fresh, target);
    if (movedAside) {
      movedAside = false;
      removeQuietly(aside);
    }
    return { ok: true, id: id, name: read.metadata.name, replaced: !!existing, folder: target };
  } catch (err) {
    var kept = "";
    if (movedAside) {
      try {
        fs.renameSync(aside, target);
        kept = "; the earlier install is kept";
      } catch (restoreErr) {
        kept = "; the earlier install could not be put back (" + errorWords(restoreErr) + "), so reinstall it";
        removeQuietly(aside);
      }
    }
    removeQuietly(fresh);
    return refuse("could not install " + id + " (" + errorWords(err) + ")" + kept);
  } finally {
    releaseLock(lock, nonce);
  }
}

// ---------------------------------------------------------------------------
// The installed styles, as a page server reads them
// ---------------------------------------------------------------------------

// Checked bytes per file, keyed on its path and valid while its size,
// modification time, change time, inode and device are unchanged. The change
// time is there because a rewrite can keep the size and put the modification
// time back; it cannot put the change time back. A stylesheet's entry also
// records the font list it was checked against.
var cache = new Map();

function readCached(file, maxBytes, label, realRoot, check, extraKey) {
  var prior = cache.get(file);
  var usable = prior && prior.extraKey === extraKey ? prior : null;
  var read = readOnce(file, maxBytes, label, { served: true, realRoot: realRoot, cached: usable });
  if (!read.ok) {
    cache.delete(file);
    return read;
  }
  if (read.fromCache) return usable.result;
  var result = check ? check(read.bytes) : { ok: true };
  result = result.ok ? Object.assign({}, result, { bytes: read.bytes }) : result;
  cache.set(file, {
    size: read.stat.size, mtimeMs: read.stat.mtimeMs, ctimeMs: read.stat.ctimeMs, ino: read.stat.ino, dev: read.stat.dev,
    bytes: read.bytes, extraKey: extraKey, result: result
  });
  return result;
}

function realStylesRoot(dir) {
  var root = stateDir.stylesRoot(dir);
  var here = checkFolder(root, "the styles folder");
  if (!here.ok) return here;
  return { ok: true, root: root, real: fs.realpathSync(root) };
}

/**
 * One installed style, checked the way a page server needs it: every level a
 * real folder or a regular file, one link, inside the styles folder, the
 * metadata and the stylesheet passing their rules.
 *
 * @returns {{ok: true, id, metadata, sheet: Buffer, fonts: string[], folder}
 *   | {ok: false, reason, missing?: boolean}}
 */
function inspect(dir, id) {
  if (!isStyleId(id) || id === RESERVED_ID) return { ok: false, missing: true, reason: "not a style id" };
  var root;
  try { root = realStylesRoot(dir); } catch (err) { return refuse("the styles folder cannot be read"); }
  if (!root.ok) return root.missing ? { ok: false, missing: true, reason: "no styles are installed" } : root;
  var folder = path.join(root.root, id);
  var here = checkFolder(folder, "the style folder");
  if (!here.ok) return here.missing ? { ok: false, missing: true, reason: id + " is not installed" } : here;

  var fonts = [];
  var fontsDir = path.join(folder, "fonts");
  var fontsHere = checkFolder(fontsDir, "fonts");
  if (!fontsHere.ok && !fontsHere.missing) return fontsHere;
  if (fontsHere.ok) {
    fonts = sortedNames(fontsDir).filter(function (name) { return FONT_NAME.test(name); });
    if (fonts.length > LIMITS.fontCount) {
      return refuse("fonts/ holds " + fonts.length + " fonts, and a style may have at most " + LIMITS.fontCount);
    }
  }

  var meta = readCached(path.join(folder, "metadata.json"), LIMITS.metadataBytes, "metadata.json", root.real, function (bytes) {
    var parsed;
    try { parsed = JSON.parse(bytes.toString("utf8")); } catch (err) { return refuse("metadata.json is not valid JSON"); }
    return checkMetadata(parsed);
  }, "");
  if (!meta.ok) return meta.missing ? refuse("the folder has no metadata.json") : meta;

  var sheet = readCached(path.join(folder, "style.css"), LIMITS.sheetBytes, "style.css", root.real, function (bytes) {
    var verdict = checkStylesheetBytes(bytes, { fonts: fonts });
    return verdict.ok ? verdict : refuse("style.css is refused: " + verdict.reason);
  }, fonts.join("/"));
  if (!sheet.ok) return sheet.missing ? refuse("the folder has no style.css") : sheet;

  return { ok: true, id: id, metadata: meta.metadata, sheet: sheet.bytes, fonts: fonts, folder: folder, realRoot: root.real };
}

/** One installed font's checked bytes, for a style that passes. */
function readFont(info, name) {
  if (info.fonts.indexOf(name) === -1) return { ok: false, missing: true, reason: "no such font" };
  var font = readCached(path.join(info.folder, "fonts", name), LIMITS.fontBytes, "fonts/" + name, info.realRoot, null, "");
  return font;
}

/**
 * Every folder under the styles folder whose name is a style id, checked, and
 * sorted by name. A refused folder is listed with its reason.
 *
 * @returns {{id: string, ok: boolean, metadata?: object, reason?: string}[]}
 */
function list(dir) {
  var root;
  try { root = stateDir.stylesRoot(dir); } catch (err) { return []; }
  var names;
  try { names = fs.readdirSync(root); } catch (err) { return []; }
  var out = names
    .filter(function (name) { return isStyleId(name) && name !== RESERVED_ID; })
    .map(function (id) {
      var info = inspect(dir, id);
      if (info.ok) return { id: id, ok: true, metadata: info.metadata };
      return { id: id, ok: false, reason: info.reason };
    })
    .filter(function (entry) { return entry.ok || !/is not installed$/.test(entry.reason); });
  out.sort(function (a, b) {
    var an = a.ok ? a.metadata.name.toLowerCase() : a.id;
    var bn = b.ok ? b.metadata.name.toLowerCase() : b.id;
    if (an !== bn) return an < bn ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  return out;
}

function indexFrom(listed) {
  return {
    styles: listed.filter(function (entry) { return entry.ok; }).map(function (entry) {
      return {
        id: entry.id,
        name: entry.metadata.name,
        description: entry.metadata.description,
        palette: entry.metadata.palette.slice()
      };
    })
  };
}

/** The installed list a page fetches: only styles that pass, and only the fields it shows. */
function index(dir) {
  return indexFrom(list(dir));
}

// ---------------------------------------------------------------------------
// Serving
// ---------------------------------------------------------------------------

/**
 * The path segments after the LAST `.lahe-styles` segment of a decoded URL
 * path, or null when it has none.
 */
function reservedRest(pathname) {
  var segments = String(pathname || "").split("/");
  var at = segments.lastIndexOf(SEGMENT);
  return at === -1 ? null : segments.slice(at + 1);
}

var NOT_FOUND = { status: 404 };

/**
 * Answer one request under the reserved segment. `rest` is what reservedRest
 * returned. Exactly three shapes are answered; anything else is a 404, and a
 * style that fails a rule is a 404 that names itself in `refused`.
 *
 * @returns {{status: number, type?: string, body?: Buffer, refused?: {id: string, reason: string}[]}}
 */
function answer(dir, rest) {
  var parts = Array.isArray(rest) ? rest : [];
  if (parts.length === 1 && parts[0] === "index.json") {
    var listed = list(dir);
    return {
      status: 200,
      type: "application/json; charset=utf-8",
      body: Buffer.from(JSON.stringify(indexFrom(listed)), "utf8"),
      refused: listed.filter(function (entry) { return !entry.ok; }).map(function (entry) { return { id: entry.id, reason: clean(entry.reason) }; })
    };
  }
  var id = parts[0];
  var isSheet = parts.length === 2 && parts[1] === "style.css";
  var isFont = parts.length === 3 && parts[1] === "fonts" && FONT_NAME.test(parts[2] || "");
  if (!isStyleId(id) || id === RESERVED_ID || (!isSheet && !isFont)) return NOT_FOUND;
  var info = inspect(dir, id);
  if (!info.ok) return info.missing ? NOT_FOUND : { status: 404, refused: [{ id: id, reason: clean(info.reason) }] };
  if (isSheet) return { status: 200, type: "text/css; charset=utf-8", body: info.sheet };
  var font = readFont(info, parts[2]);
  if (!font.ok) return font.missing ? NOT_FOUND : { status: 404, refused: [{ id: id, reason: clean(font.reason) }] };
  return { status: 200, type: "font/woff2", body: font.bytes };
}

// ---------------------------------------------------------------------------
// Beside a written artifact
// ---------------------------------------------------------------------------

/** The one line a document carries for a style. */
function hrefFor(id) {
  return "./" + SEGMENT + "/" + id + "/style.css";
}

function linkTag(id) {
  return "<link rel=\"stylesheet\" href=\"" + hrefFor(id) + "\">";
}

function ensurePlainDir(target) {
  stateDir.assertNotSymlink(target);
  return stateDir.ensureDir(target);
}

/**
 * Copy an installed style's checked stylesheet and fonts to
 * `<targetDir>/.lahe-styles/<id>/`, so a written artifact opened from disk
 * still shows the style. A page server never serves this copy; it answers the
 * reserved segment from the installed styles. A style that is not installed,
 * or fails a rule, is copied as nothing.
 *
 * @returns {{copied: boolean, reason?: string}}
 */
function copyBeside(dir, id, targetDir) {
  var info = inspect(dir, id);
  if (!info.ok) return { copied: false, reason: info.reason };
  var reserved = ensurePlainDir(path.join(targetDir, SEGMENT));
  var folder = ensurePlainDir(path.join(reserved, id));
  stateDir.writeAtomic(path.join(folder, "style.css"), info.sheet);
  if (info.fonts.length) {
    var fontsDir = ensurePlainDir(path.join(folder, "fonts"));
    info.fonts.forEach(function (name) {
      var font = readFont(info, name);
      if (font.ok) stateDir.writeAtomic(path.join(fontsDir, name), font.bytes);
    });
  }
  return { copied: true };
}

module.exports = {
  SEGMENT: SEGMENT,
  RESERVED_ID: RESERVED_ID,
  RESERVED_NAME: RESERVED_NAME,
  ID_PATTERN: rules.ID_PATTERN,
  LIMITS: LIMITS,
  FOLDER_HELP: FOLDER_HELP,
  isStyleId: isStyleId,
  idFromFolderName: idFromFolderName,
  clean: clean,
  checkStylesheet: checkStylesheet,
  checkMetadata: checkMetadata,
  readStyleFolder: readStyleFolder,
  install: install,
  list: list,
  index: index,
  inspect: inspect,
  reservedRest: reservedRest,
  answer: answer,
  hrefFor: hrefFor,
  linkTag: linkTag,
  copyBeside: copyBeside,
  checkStylesheetBytes: checkStylesheetBytes,
  _hooks: hooks,
  _lockPath: lockPath
};
