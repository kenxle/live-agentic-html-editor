// The name registry for stable addresses.
//
// Architecture: docs/features/20261011.02_stable_addresses/02_architecture_stable_addresses.md,
// "Data / State Changes". A SITE is what one page server served before this
// feature: one root folder (mode "folder") or one notes page (mode
// "page-only"). Each site has a name, and the name is the browser origin:
// http://<name>.lahe.localhost:<pages port>/<path under the root>.
//
// ONE WRITER. Only the helper writes sites.json and sites.log, through
// createSites below. The CLI reads the CLI secret from here and nothing else.
//
// NOTHING IS MINTED ON A GET. A name is made only by bind(), which the
// helper's site.bind route calls, and that route is CLI-only (CLI secret, no
// Origin header).
//
// LOSS. sites.json is a cache of sites.log, which is append-only: every grant
// and every change to a site appends that site's whole entry. A sites.json
// that cannot be read is rebuilt from the log, never started empty, because an
// empty registry would hand an old bookmark's name to whatever folder asked
// next. When neither reads, the registry serves nothing new: it is read-only
// and bind() refuses.
//
// Node-only.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");
var markdownLinks = require("./markdown_links.js");

var JSON_FILE = "sites.json";
var LOG_FILE = "sites.log";
var SECRET_FILE = "cli-secret";
var VERSION = 1;
var MODE = { FOLDER: "folder", PAGE_ONLY: "page-only" };
var RESERVED = protocol.PAGES.RESERVED_NAMES;
var LABEL_MAX = protocol.PAGES.LABEL_MAX;
var NAME_MAX = protocol.PAGES.NAME_MAX;
var MOUNT_PREFIX = /^\/\.lahe-source\/[a-f0-9]+\/$/;

function jsonPath(dir) { return path.join(dir, JSON_FILE); }
function logPath(dir) { return path.join(dir, LOG_FILE); }
function secretPath(dir) { return path.join(dir, SECRET_FILE); }

// ---------------------------------------------------------------------------
// The name rule
// ---------------------------------------------------------------------------

/** Is this one DNS label as Lahe makes them? The rule is protocol.js's. */
var isLabel = protocol.isSiteLabel;

/**
 * One folder name as a label: lowercase, each run of other characters one
 * dash, no dash at either end, at most LABEL_MAX characters. "" when nothing
 * is left.
 */
function labelFor(folder) {
  var label = String(folder || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (label.length > LABEL_MAX) label = label.slice(0, LABEL_MAX).replace(/-+$/, "");
  return label;
}

function homeOf(options) {
  var home = options && options.home ? options.home : markdownLinks.homeRoot();
  try { return fs.realpathSync.native(home); } catch (err) { return path.resolve(home); }
}

/**
 * Every label the root's folders give, outermost first, stopping below the
 * home folder. A notes page is named for the folder it sits in.
 */
function folderLabels(root, options) {
  var folder = options && options.mode === MODE.PAGE_ONLY ? path.dirname(root) : root;
  var home = homeOf(options);
  var parts;
  if (folder === home) parts = [];
  else if (folder.indexOf(home + path.sep) === 0) parts = path.relative(home, folder).split(path.sep);
  else parts = folder.split(path.sep);
  return parts.map(labelFor).filter(function (label) { return label.length > 0; });
}

function join(labels) {
  var list = labels.slice();
  while (list.length > 1 && list.join(".").length > NAME_MAX) list.shift();
  return list.join(".");
}

/**
 * The names a root may take, in the order it tries them: the folder and its
 * two parents, then one more parent. Numbered names come after these and are
 * made by the caller.
 */
function candidates(root, options) {
  var labels = folderLabels(root, options);
  if (!labels.length) return ["doc"];
  var out = [join(labels.slice(-3))];
  if (labels.length > 3) {
    var four = join(labels.slice(-4));
    if (four !== out[0]) out.push(four);
  }
  return out;
}

/** The name a root gets when nothing else holds it. */
function nameFor(root, options) {
  return candidates(root, options)[0];
}

// ---------------------------------------------------------------------------
// What a root may be
// ---------------------------------------------------------------------------

/**
 * Why `root` cannot be a site, or null when it can. `root` must already be a
 * real path. Refused: the filesystem root, the state folder and anything in
 * it, a folder site that is not a folder, a notes site that is not a file.
 */
function rootProblem(root, mode, dir) {
  if (typeof root !== "string" || !path.isAbsolute(root)) return "the root must be an absolute path";
  if (path.parse(root).root === root) return "the filesystem root is never served";
  var state;
  try { state = fs.realpathSync.native(dir); } catch (err) { state = path.resolve(dir); }
  if (root === state || root.indexOf(state + path.sep) === 0) return "the state folder is never served";
  var stat;
  try { stat = fs.statSync(root); } catch (err) { return "the root is not there: " + root; }
  if (mode === MODE.FOLDER && !stat.isDirectory()) return "a folder site's root is not a folder: " + root;
  if (mode === MODE.PAGE_ONLY && !stat.isFile()) return "a notes site's root is not a file: " + root;
  if (mode !== MODE.FOLDER && mode !== MODE.PAGE_ONLY) return "unknown site mode " + JSON.stringify(mode);
  return null;
}

// ---------------------------------------------------------------------------
// Worktrees
// ---------------------------------------------------------------------------

/**
 * Does git's own back-link agree? A worktree's admin folder in the main
 * checkout holds a `gitdir` file naming the worktree's `.git` file. The `.git`
 * file is folder content anyone can write, so without this check a folder
 * could name any path as its "main checkout" and the read-only fallback would
 * serve files from it.
 */
function linksBack(adminDir, gitFile) {
  var text;
  try { text = fs.readFileSync(path.join(adminDir, "gitdir"), "utf8").trim(); } catch (err) { return false; }
  if (!text) return false;
  var named = path.resolve(adminDir, text);
  var a;
  var b;
  try { a = fs.realpathSync.native(named); b = fs.realpathSync.native(gitFile); } catch (err) { return false; }
  return a === b;
}

/**
 * The worktree a root sits in and that worktree's main checkout, read from the
 * worktree's `.git` file while it still exists, and only when the main
 * checkout's back-link names the same `.git` file (linksBack). A plain
 * checkout (a `.git` folder) or no checkout at all records nothing.
 *
 * The main checkout is saved as its REAL path, and the worktree's admin folder
 * (`<main>/.git/worktrees/<name>`) with it: a review follows its document out
 * of a removed worktree only while the main checkout's real path still matches
 * what was saved, and "removed" is judged by that admin folder
 * (page_routes.js, the move; spec 20261015.01 R1 and R2).
 */
function worktreeOf(root) {
  var none = { main_checkout: null, worktree_root: null, worktree_admin: null };
  var current = path.resolve(root);
  for (;;) {
    var gitPath = path.join(current, ".git");
    var stat = null;
    try { stat = fs.statSync(gitPath); } catch (err) { stat = null; }
    if (stat) {
      if (!stat.isFile()) return none;
      var text = "";
      try { text = fs.readFileSync(gitPath, "utf8"); } catch (err) { text = ""; }
      var gitdir = /^gitdir:\s*(.+?)\s*$/m.exec(text);
      var adminDir = gitdir ? path.resolve(current, gitdir[1]) : null;
      var main = adminDir ? /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+[\\/]?$/.exec(adminDir) : null;
      if (!main || !linksBack(adminDir, gitPath)) return none;
      var realMain = null;
      try { realMain = fs.realpathSync.native(main[1]); } catch (err) { realMain = null; }
      if (!realMain) return none;
      return { main_checkout: realMain, worktree_root: current, worktree_admin: adminDir };
    }
    var parent = path.dirname(current);
    if (parent === current) return none;
    current = parent;
  }
}

// ---------------------------------------------------------------------------
// The CLI secret
// ---------------------------------------------------------------------------

/** The helper makes the secret once per state folder. Owner-only. */
function ensureCliSecret(dir) {
  var file = secretPath(dir);
  var existing = readCliSecret(dir);
  if (existing) return existing;
  var secret = crypto.randomBytes(32).toString("hex");
  stateDir.ensureDir(dir);
  stateDir.writeAtomic(file, secret + "\n");
  return secret;
}

/** The secret, for the CLI to send on site.bind, or null. */
function readCliSecret(dir) {
  try {
    var value = fs.readFileSync(secretPath(dir), "utf8").trim();
    return /^[a-f0-9]{64}$/.test(value) ? value : null;
  } catch (err) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// The registry
// ---------------------------------------------------------------------------

function cleanMounts(mounts) {
  var out = {};
  if (!mounts || typeof mounts !== "object") return out;
  Object.keys(mounts).forEach(function (prefix) {
    var dirPath = mounts[prefix];
    if (!MOUNT_PREFIX.test(prefix) || typeof dirPath !== "string" || !path.isAbsolute(dirPath)) return;
    // Never a folder outside home, by real path (markdownLinks.mountableDir).
    if (!markdownLinks.mountableDir(dirPath)) return;
    out[prefix] = dirPath;
  });
  return out;
}

function cleanLinked(table) {
  var out = {};
  if (!table || typeof table !== "object") return out;
  Object.keys(table).forEach(function (file) {
    if (!path.isAbsolute(file) || !Array.isArray(table[file])) return;
    var ids = table[file].filter(function (id) { return protocol.isSafeId(id); });
    if (ids.length) out[file] = ids.filter(function (id, i) { return ids.indexOf(id) === i; });
  });
  return out;
}

function isEntry(value) {
  return !!value && typeof value === "object" && typeof value.root === "string" &&
    (value.mode === MODE.FOLDER || value.mode === MODE.PAGE_ONLY);
}

/**
 * @param {{dir: string, home?: string, now?: function(): number, log?: function(string), reader?: boolean}} options
 *   `reader` is for the CLI (`lahe status`): it reads the registry and never
 *   writes it, not even the rebuild from the log. Only the helper writes.
 */
function createSites(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createSites: dir is required");
  var dir = opts.dir;
  var now = typeof opts.now === "function" ? opts.now : function () { return Date.now(); };
  var say = typeof opts.log === "function" ? opts.log : function () {};
  var table = {};
  var reader = opts.reader === true;
  var readOnly = reader;
  var loaded = false;

  function readLog() {
    var text;
    try { text = fs.readFileSync(logPath(dir), "utf8"); } catch (err) { return null; }
    var out = {};
    var good = 0;
    text.split("\n").forEach(function (line) {
      if (!line.trim()) return;
      var parsed;
      try { parsed = JSON.parse(line); } catch (err) { return; }
      if (!parsed || typeof parsed.name !== "string" || !isEntry(parsed.site)) return;
      out[parsed.name] = parsed.site;
      good += 1;
    });
    return good > 0 || !text.trim() ? out : null;
  }

  function load() {
    loaded = true;
    readOnly = reader;
    var raw = null;
    var missing = false;
    try { raw = fs.readFileSync(jsonPath(dir), "utf8"); }
    catch (err) { missing = err.code === "ENOENT"; }
    if (raw !== null) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.version === VERSION && parsed.sites && typeof parsed.sites === "object") {
          table = {};
          Object.keys(parsed.sites).forEach(function (name) {
            if (isEntry(parsed.sites[name])) table[name] = parsed.sites[name];
          });
          replayLog();
          return api;
        }
      } catch (err) {
        // Fall through to the log.
      }
    }
    var fromLog = readLog();
    if (fromLog) {
      table = fromLog;
      if (Object.keys(table).length && !reader) {
        say("sites: rebuilt " + JSON_FILE + " from " + LOG_FILE + " (" + Object.keys(table).length + " names)");
        writeJson();
      }
      return api;
    }
    table = {};
    // Nothing on disk at all is a fresh state folder, and names may be made.
    if (missing && !fs.existsSync(logPath(dir))) return api;
    readOnly = true;
    say("sites: neither " + JSON_FILE + " nor " + LOG_FILE + " can be read; no new name will be made until one can");
    return api;
  }

  /**
   * Every change is appended to sites.log first and written to sites.json
   * second, so a crash between the two leaves the log ahead. Each log line
   * holds the whole entry, so its last line for a name is that name's newest
   * state: anything the log has that sites.json lacks is taken from the log.
   */
  function replayLog() {
    var fromLog = readLog();
    if (!fromLog) return;
    var caught = Object.keys(fromLog).filter(function (name) {
      return JSON.stringify(table[name]) !== JSON.stringify(fromLog[name]);
    });
    if (!caught.length) return;
    caught.forEach(function (name) { table[name] = fromLog[name]; });
    if (reader) return;
    say("sites: " + caught.length + " name(s) were in " + LOG_FILE + " but not yet in " + JSON_FILE + "; " + JSON_FILE + " is written again");
    writeJson();
  }

  function ensureLoaded() {
    if (!loaded) load();
  }

  function writeJson() {
    stateDir.ensureDir(dir);
    stateDir.writeAtomic(jsonPath(dir), JSON.stringify({ version: VERSION, sites: table }, null, 2) + "\n");
  }

  function record(event, name) {
    stateDir.ensureDir(dir);
    var line = JSON.stringify({ at: new Date(now()).toISOString(), event: event, name: name, site: table[name] });
    stateDir.appendLine(logPath(dir), line + "\n");
    writeJson();
  }

  function get(name) {
    ensureLoaded();
    return Object.prototype.hasOwnProperty.call(table, name) ? table[name] : null;
  }

  function byRoot(root, mode) {
    ensureLoaded();
    var names = Object.keys(table);
    for (var i = 0; i < names.length; i += 1) {
      var entry = table[names[i]];
      if (entry.root === root && entry.mode === mode) return { name: names[i], site: entry };
    }
    return null;
  }

  function taken(name) {
    return RESERVED.indexOf(name) !== -1 || Object.prototype.hasOwnProperty.call(table, name);
  }

  function freshName(root, mode) {
    var tried = candidates(root, { home: opts.home, mode: mode });
    for (var i = 0; i < tried.length; i += 1) {
      if (!taken(tried[i])) return tried[i];
    }
    var base = tried[tried.length - 1];
    for (var n = 2; ; n += 1) {
      var suffix = "-" + n;
      var labels = base.split(".");
      var last = labels.pop();
      last = last.slice(0, LABEL_MAX - suffix.length).replace(/-+$/, "") + suffix;
      labels.push(last);
      var numbered = join(labels);
      if (!taken(numbered)) return numbered;
    }
  }

  /**
   * Find or make the site for `root`, and fold in its mounts. Throws when the
   * registry is read-only or the root is refused.
   *
   * @param {{root: string, mode: string, entry?: string, mounts?: object}} spec
   * @returns {{name: string, site: object, created: boolean}}
   */
  function bind(spec) {
    ensureLoaded();
    var s = spec || {};
    var problem = rootProblem(s.root, s.mode, dir);
    if (problem) throw new Error(problem);
    // SAME FILE, SAME ADDRESS. A file reviewed on its own (`containing`) goes
    // into the deepest folder site that already holds it, at its path there,
    // so a file under a reviewed folder never gets a second address. The site
    // keeps its own entry page; the file's path comes back as `entry`.
    if (s.containing === true && s.mode === MODE.FOLDER && typeof s.entry === "string" && s.entry) {
      var outer = deepestFolderSite(path.join(s.root, s.entry));
      if (outer && outer.site.root !== s.root) {
        var outerMounts = Object.assign({}, outer.site.mounts || {}, cleanMounts(s.mounts));
        if (JSON.stringify(outerMounts) !== JSON.stringify(outer.site.mounts || {}) && !readOnly) {
          outer.site.mounts = outerMounts;
          record("update", outer.name);
        }
        var relative = path.relative(outer.site.root, path.join(s.root, s.entry)).split(path.sep).join("/");
        return { name: outer.name, site: outer.site, created: false, entry: relative };
      }
    }
    var found = byRoot(s.root, s.mode);
    if (!found && readOnly) {
      throw new Error("the site registry cannot be read, so no new name is made; see " + jsonPath(dir));
    }
    if (found) {
      var mounts = Object.assign({}, found.site.mounts || {}, cleanMounts(s.mounts));
      var changed = JSON.stringify(mounts) !== JSON.stringify(found.site.mounts || {}) ||
        (typeof s.entry === "string" && s.entry !== found.site.entry);
      if (changed && !readOnly) {
        found.site.mounts = mounts;
        if (typeof s.entry === "string") found.site.entry = s.entry;
        record("update", found.name);
      }
      return { name: found.name, site: found.site, created: false };
    }
    var name = freshName(s.root, s.mode);
    var where = worktreeOf(s.root);
    table[name] = {
      root: s.root,
      entry: typeof s.entry === "string" ? s.entry : "",
      mode: s.mode,
      mounts: cleanMounts(s.mounts),
      linked_files: {},
      main_checkout: where.main_checkout,
      worktree_root: where.worktree_root,
      worktree_admin: where.worktree_admin,
      created_at: new Date(now()).toISOString()
    };
    record("grant", name);
    say("sites: new name " + name + " for " + s.root + " (" + s.mode + ")");
    return { name: name, site: table[name], created: true };
  }

  /** The folder site with the longest root that holds `file`, or null. */
  function deepestFolderSite(file) {
    var best = null;
    Object.keys(table).forEach(function (name) {
      var entry = table[name];
      if (entry.mode !== MODE.FOLDER) return;
      if (file.indexOf(entry.root + path.sep) !== 0) return;
      if (!best || entry.root.length > best.site.root.length) best = { name: name, site: entry };
    });
    return best;
  }

  /** Add mounts to an existing site. Returns whether anything was written. */
  function addMounts(name, mounts) {
    var entry = get(name);
    if (!entry || readOnly) return false;
    var next = Object.assign({}, entry.mounts || {}, cleanMounts(mounts));
    if (JSON.stringify(next) === JSON.stringify(entry.mounts || {})) return false;
    entry.mounts = next;
    record("update", name);
    return true;
  }

  /** Record that `reviewId`'s page links to each of `files` (real paths). */
  function addLinked(name, reviewId, files) {
    var entry = get(name);
    if (!entry || readOnly || !protocol.isSafeId(reviewId) || !Array.isArray(files)) return false;
    var table2 = cleanLinked(entry.linked_files);
    var changed = false;
    files.forEach(function (file) {
      if (typeof file !== "string" || !path.isAbsolute(file)) return;
      var ids = table2[file] || (table2[file] = []);
      if (ids.indexOf(reviewId) === -1) { ids.push(reviewId); changed = true; }
    });
    if (!changed) return false;
    entry.linked_files = table2;
    record("update", name);
    return true;
  }

  function list() {
    ensureLoaded();
    return Object.keys(table).map(function (name) { return { name: name, site: table[name] }; });
  }

  var api = {
    load: load,
    readOnly: function () { ensureLoaded(); return readOnly; },
    get: get,
    byRoot: byRoot,
    deepestFolderSite: deepestFolderSite,
    bind: bind,
    addMounts: addMounts,
    addLinked: addLinked,
    list: list
  };
  return api;
}

module.exports = {
  MODE: MODE,
  RESERVED: RESERVED,
  jsonPath: jsonPath,
  logPath: logPath,
  secretPath: secretPath,
  isLabel: isLabel,
  labelFor: labelFor,
  candidates: candidates,
  nameFor: nameFor,
  rootProblem: rootProblem,
  cleanMounts: cleanMounts,
  worktreeOf: worktreeOf,
  ensureCliSecret: ensureCliSecret,
  readCliSecret: readCliSecret,
  createSites: createSites
};
