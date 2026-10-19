// Pandoc, when the machine has it, renders Markdown for review.
//
// WHY PANDOC. The feature-forge and research-report builds turn Markdown into
// HTML with pandoc, and their docs lean on pandoc syntax: fenced divs
// (`::: callout-req`), nested fences, the `{.class}` attribute form. marked
// cannot read those, so a doc that renders as panels in the build printed its
// fences as text in LAHE. Rendering with the same tool means the two never
// disagree about syntax (docs/features/20261017.02_pandoc_render).
//
// A SYSTEM DEPENDENCY, NOT AN NPM ONE. Ken overrode the zero-dependency rule
// for pandoc on 2026-10-17, and only in this shape: nothing is installed, and a
// machine without pandoc still renders every page with the vendored marked.
// This module answers one question per render, "did pandoc produce HTML?", and
// markdown.js falls back when the answer is no.
//
// THE CALL. One process per distinct Markdown text: an argument array, no
// shell, the Markdown on stdin, a timeout and an output cap, and --sandbox so
// pandoc reads nothing but its own filter. The binary is resolved to an
// absolute path once per process and its version checked against a floor.

"use strict";

var crypto = require("node:crypto");
var childProcess = require("node:child_process");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var FILTER = path.join(__dirname, "lahe_render.lua");
// gfm plus fenced divs, as the feature-forge build reads it, minus the
// extensions that would change the words on the page from what marked shows:
// heading ids (they move the layer's anchors), YAML metadata (a later --- block
// would vanish; the real frontmatter is already stripped), and dollar math
// ($HOME/$PATH would turn italic). Emoji, alerts and footnotes stay, as in the
// builds. Naming an extension a pandoc does not know is a hard error, so the
// names are checked against --list-extensions when pandoc is first found.
var EXTENSIONS_ON = ["fenced_divs"];
var EXTENSIONS_OFF = ["gfm_auto_identifiers", "yaml_metadata_block", "tex_math_dollars", "tex_math_gfm"];
var FROM = "gfm" + EXTENSIONS_ON.map(function (e) { return "+" + e; }).join("") +
  EXTENSIONS_OFF.map(function (e) { return "-" + e; }).join("");
var MIN_MAJOR = 3;
// A missing pandoc is looked for again after this long, so installing it does
// not need a helper restart. A found one is kept for the life of the process.
var RECHECK_MS = 60000;
// The helper inherits PATH from whichever agent shell started it, which may
// not include Homebrew's folder.
var EXTRA_DIRS = ["/opt/homebrew/bin", "/usr/local/bin"];
// spawnSync blocks the helper's event loop, so a slow document stalls every
// session it serves. Five seconds is far past any real document (a 750-line
// report renders in well under one), and a timeout is remembered: the same
// text goes straight to marked next time instead of stalling again.
var TIMEOUT_MS = 5000;
var VERSION_TIMEOUT_MS = 5000;
// Node's default spawnSync buffer is 1 MB, which a long report's HTML can pass.
var MAX_OUTPUT = 32 * 1024 * 1024;
var MAX_INPUT = 8 * 1024 * 1024;
var CACHE_MAX = 64;

// --sandbox limits what pandoc's readers and writers open; it does not limit
// Lua. A data directory's init.lua runs on every call, so pandoc is pointed at
// a data directory that does not exist (a test keeps it that way), and the
// filter itself never touches io, os, pandoc.pipe or the mediabag (a test
// greps for them).
var NO_DATA_DIR = path.join(__dirname, "pandoc-data-dir-deliberately-absent");

// Stamped by the filter on every link it wrote. Raw HTML can carry a
// data-lahe-link attribute too, so markdown.js only trusts this value, which
// no document can know in advance. Fixed for the life of the process, so the
// output cache stays valid.
var NONCE = crypto.randomBytes(16).toString("hex");

// LAHE_MARKDOWN_ENGINE=marked forces the fallback. The unit suite sets it so
// its expected strings do not depend on whether the machine has pandoc, and a
// user can set it to get the old renderer back. LAHE_PANDOC names the binary
// outright when it is not on PATH, or is "none" to act as if pandoc were not
// installed; it is the user's own environment. Both are read on every call
// (LAHE_PANDOC whenever pandoc is looked for).
function forcedMarked() {
  return String(process.env.LAHE_MARKDOWN_ENGINE || "").toLowerCase() === "marked";
}

var located = null;   // { path, version } or { path: null, reason, at }
var cache = new Map();

function executable(file) {
  try {
    var stat = fs.statSync(file);
    if (!stat.isFile()) return false;
    if (process.platform === "win32") return true;
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch (err) {
    return false;
  }
}

/** The absolute path of the first `pandoc` on PATH or in EXTRA_DIRS, or null. */
function onPath() {
  var names = process.platform === "win32" ? ["pandoc.exe"] : ["pandoc"];
  var dirs = String(process.env.PATH || "").split(path.delimiter).concat(process.platform === "win32" ? [] : EXTRA_DIRS);
  for (var i = 0; i < dirs.length; i += 1) {
    // An empty entry or a relative one would resolve against whatever the
    // helper's working directory happens to be; only absolute folders count.
    if (!dirs[i] || !path.isAbsolute(dirs[i])) continue;
    for (var j = 0; j < names.length; j += 1) {
      var candidate = path.join(dirs[i], names[j]);
      if (executable(candidate)) return candidate;
    }
  }
  return null;
}

function parseVersion(text) {
  var match = /^pandoc(?:\.exe)?\s+(\d+)\.(\d+)(?:\.(\d+))?/m.exec(String(text || ""));
  return match ? { major: Number(match[1]), minor: Number(match[2]), text: match[0].replace(/^pandoc(?:\.exe)?\s+/, "") } : null;
}

function probe(file, args) {
  return childProcess.spawnSync(file, args, {
    encoding: "utf8", shell: false, cwd: os.tmpdir(), env: childEnv(),
    timeout: VERSION_TIMEOUT_MS, killSignal: "SIGKILL", windowsHide: true, maxBuffer: 1024 * 1024
  });
}

/** True when every extension FROM names is one this pandoc knows for gfm. */
function knowsExtensions(file) {
  var listed = probe(file, ["--list-extensions=gfm"]);
  if (listed.status !== 0) return false;
  var known = {};
  String(listed.stdout).split(/\r?\n/).forEach(function (line) {
    var name = line.trim().replace(/^[+-]/, "");
    if (name) known[name] = true;
  });
  return EXTENSIONS_ON.concat(EXTENSIONS_OFF).every(function (name) { return known[name] === true; });
}

/**
 * Where pandoc is and which version. A found pandoc is kept for the process;
 * a missing or unusable one is looked for again after RECHECK_MS.
 *
 * @returns {{path: string|null, version?: string, reason?: string, detail?: string}}
 */
function locate() {
  if (located && (located.path || Date.now() - located.at < RECHECK_MS)) return located;
  var configured = process.env.LAHE_PANDOC;
  var now = Date.now();
  // LAHE_PANDOC=none behaves as a machine with no pandoc, notice and all. It
  // is how the tests reach the missing-pandoc path on a machine that has it.
  if (configured === "none") {
    located = { path: null, reason: "missing", at: now };
    return located;
  }
  var file = configured && path.isAbsolute(configured) && executable(configured) ? configured : onPath();
  if (!file) {
    located = { path: null, reason: "missing", at: now };
    return located;
  }
  var answer = probe(file, ["--version"]);
  var version = answer.status === 0 ? parseVersion(answer.stdout) : null;
  if (!version) {
    located = { path: null, reason: "unreadable", detail: file, at: now };
  } else if (version.major < MIN_MAJOR || !knowsExtensions(file)) {
    located = { path: null, reason: "too-old", version: version.text, detail: file, at: now };
  } else {
    located = { path: file, version: version.text, at: now };
  }
  return located;
}

/**
 * The helper-log sentence for a render pandoc did not do, or null when there
 * is nothing to say. The reader sees the rail's own fixed line instead
 * (src/layer/overlay.js), never this text.
 */
function noteFor(reason, detail) {
  if (reason === "forced" || !reason) return null;
  if (reason === "missing") return "pandoc is not installed, so Markdown fenced divs (::: blocks) render as plain text. Install pandoc 3 or newer (pandoc.org) to draw them.";
  if (reason === "too-old") return "pandoc " + (detail || "") + " is older than 3.0 or lacks a gfm extension Lahe names, so Markdown fenced divs render as plain text. Install pandoc 3 or newer.";
  if (reason === "unreadable") return "pandoc at " + (detail || "?") + " did not answer --version, so Markdown fenced divs render as plain text.";
  return "pandoc could not render a page (" + (detail || reason) + "), so it was drawn with marked and its ::: blocks show as plain text.";
}

var filterHash = null;
function hashOf(markdown, version) {
  if (filterHash === null) {
    try { filterHash = crypto.createHash("sha256").update(fs.readFileSync(FILTER)).digest("hex"); }
    catch (err) { filterHash = "unreadable"; }
  }
  return crypto.createHash("sha256").update(String(version)).update("\u0000").update(filterHash)
    .update("\u0000").update(markdown).digest("hex");
}

// Only pandoc's raw output is kept, or its failure. Link classification and
// URL rewriting depend on the render's folder and registry, so markdown.js
// runs them on every render, cached or not.
function remember(key, outcome) {
  cache.set(key, outcome);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
}

// pandoc gets only what it needs. LUA_PATH, LUA_CPATH and XDG_DATA_HOME would
// change what the filter's require and the data directory load.
function childEnv() {
  var env = { HOME: os.homedir(), LANG: "C.UTF-8" };
  ["SYSTEMROOT", "SystemRoot", "TEMP", "TMP", "TMPDIR"].forEach(function (name) {
    if (process.env[name]) env[name] = process.env[name];
  });
  return env;
}

/**
 * Markdown to HTML through pandoc and LAHE's filter.
 *
 * @param {string} markdown the body, frontmatter already removed. Text only:
 *   pandoc is never handed a path, so a notes review's no-follow read is the
 *   only read.
 * @param {{ignoreEnv?: boolean, timeoutMs?: number}} [options] timeoutMs is
 *   for tests; the helper always uses TIMEOUT_MS.
 * @returns {{html: string|null, reason: string|null, note: string|null}}
 *   html null means render with marked; note is the sentence to say once.
 */
function render(markdown, options) {
  // ignoreEnv: a caller that asked for pandoc by name (renderPage's engine
  // option) gets it even when the environment forces marked.
  if (forcedMarked() && !(options && options.ignoreEnv)) return { html: null, reason: "forced", note: null };
  var where = locate();
  if (!where.path) return { html: null, reason: where.reason, note: noteFor(where.reason, where.version || where.detail) };
  var text = String(markdown);
  var key = hashOf(text, where.version);
  if (cache.has(key)) {
    var hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  var outcome = run(where.path, text, (options && options.timeoutMs) || TIMEOUT_MS);
  if (outcome.reason === "gone") {
    // pandoc was found once and has been uninstalled since. Forget it, so the
    // next render looks again and the notice says "not installed", not
    // "could not render".
    located = { path: null, reason: "missing", at: Date.now() };
    cache.clear();
    return { html: null, reason: "missing", note: noteFor("missing") };
  }
  remember(key, outcome);
  return outcome;
}

function failed(detail) {
  // A failure or a timeout is cached like a success, so a document that
  // stalls pandoc stalls the helper once, then renders with marked.
  return { html: null, reason: "failed", note: noteFor("failed", detail) };
}

function run(file, text, timeoutMs) {
  if (Buffer.byteLength(text, "utf8") > MAX_INPUT) return failed("larger than " + (MAX_INPUT / 1024 / 1024) + " MB");
  var result = childProcess.spawnSync(file, [
    "--from", FROM,
    "--to", "html5",
    "--wrap=preserve",
    "--sandbox",
    "--data-dir", NO_DATA_DIR,
    "--metadata", "lahe-nonce=" + NONCE,
    "--lua-filter", FILTER
  ], {
    input: text,
    encoding: "utf8",
    shell: false,
    cwd: os.tmpdir(),
    env: childEnv(),
    timeout: timeoutMs,
    killSignal: "SIGKILL",
    maxBuffer: MAX_OUTPUT,
    windowsHide: true
  });
  if (result.error) {
    if (result.error.code === "ENOENT") return { html: null, reason: "gone", note: null };
    var code = result.error.code === "ETIMEDOUT" ? "timed out after " + (timeoutMs / 1000) + "s" : String(result.error.code || result.error.message);
    return failed(code);
  }
  if (result.status !== 0) {
    var first = String(result.stderr || "").split(/\r?\n/).filter(Boolean)[0] || "exit " + (result.status === null ? result.signal : result.status);
    return failed(first.slice(0, 200));
  }
  return { html: result.stdout, reason: null, note: null };
}

/**
 * What a cached page depends on: which pandoc renders, or none. The page
 * server's render cache keys on it, so a page cached while pandoc was missing
 * renders again once pandoc is found.
 */
function engineKey() {
  if (forcedMarked()) return "marked:forced";
  var where = locate();
  return where.path ? "pandoc:" + where.path + ":" + where.version : "marked:" + where.reason;
}

/** For tests: forget the located binary, the cache and the filter hash. */
function reset() {
  located = null;
  filterHash = null;
  cache.clear();
}

module.exports = {
  NONCE: NONCE,
  NO_DATA_DIR: NO_DATA_DIR,
  FILTER: FILTER,
  FROM: FROM,
  EXTRA_DIRS: EXTRA_DIRS,
  MIN_MAJOR: MIN_MAJOR,
  TIMEOUT_MS: TIMEOUT_MS,
  parseVersion: parseVersion,
  locate: locate,
  engineKey: engineKey,
  noteFor: noteFor,
  render: render,
  reset: reset
};
