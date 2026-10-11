// The records of the per-session page servers stable addresses retired.
//
// Before stable addresses (docs/features/20261011.02_stable_addresses), every
// reviewed folder had its own page server: a detached process per folder per
// agent session, on a random port, with a record under
// <state>/agent-sessions/<session>/static-servers/ss_<id>.json. The helper now
// serves every page itself, so nothing here starts a process any more.
//
// What is left reads those records, because three things still need them:
//
//  - every helper start stops a page-server process an old record still names,
//    once its health probe proves it is that process (stopLeftovers);
//  - a page's old origins (http://127.0.0.1:<port>) are read from them, so a
//    review's old comments group with its new address (page_routes.aliasesFor);
//  - the Library reads what an old review was served from (coveragePath,
//    folderEntryPage), and `add` and `lahe review` pick a folder's open page.
//
// Node-only.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var http = require("node:http");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");

var SCHEMA = 1;
var HOST = protocol.DEFAULT_HOST;
var HEALTH_PREFIX = "/.lahe-static-health/";

// Why an old record says its server stopped. The first two are what page
// servers wrote; RETIRED_REASON is what stopLeftovers writes.
var IDLE_REASON = "no window open";
var CLOSED_REASON = "session closed";
var RETIRED_REASON = "page servers are retired: the helper serves this page";

// The Library's error stages, still named by catalog_actions.js.
var REOPEN_STAGE = { START: "start", AFTER_START: "after_start" };

function serverId(root) {
  return "ss_" + crypto.createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);
}

function healthPath(meta) {
  return HEALTH_PREFIX + meta.id + "/" + meta.instance;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { return null; }
}

function requestHealth(meta) {
  return new Promise(function (resolve) {
    var req = http.get({ host: HOST, port: meta.port, path: healthPath(meta), timeout: 500 }, function (res) {
      var chunks = [];
      res.on("data", function (chunk) { chunks.push(chunk); });
      res.on("end", function () {
        if (res.statusCode !== 200) return resolve(null);
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch (err) { resolve(null); }
      });
    });
    req.on("timeout", function () { req.destroy(); });
    req.on("error", function () { resolve(null); });
  });
}

async function isExactServer(meta) {
  if (!meta || typeof meta.port !== "number" || typeof meta.instance !== "string") return false;
  var health = await requestHealth(meta);
  return !!(
    health &&
    health.id === meta.id &&
    health.instance === meta.instance &&
    health.started_at === meta.started_at &&
    health.pid === meta.pid
  );
}

function list(dir, sessionId) {
  var root = stateDir.staticServersRoot(dir, sessionId);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root)
    .filter(function (name) { return /^ss_[A-Za-z0-9_-]+\.json$/.test(name); })
    .map(function (name) {
      var meta = readJson(path.join(root, name));
      if (
        !meta || meta.schema !== SCHEMA || meta.session_id !== sessionId ||
        !protocol.isSafeId(meta.id) || typeof meta.root !== "string"
      ) {
        throw new Error("static server metadata is corrupt: " + path.join(root, name));
      }
      return meta;
    });
}

/**
 * Every page-server record in the state folder, as [{file, meta}], skipping
 * any that do not parse. Read-only.
 */
function allRecords(dir) {
  var out = [];
  var sessionsRoot;
  try { sessionsRoot = stateDir.agentSessionsRoot(dir); } catch (err) { return out; }
  var sessions;
  try { sessions = fs.readdirSync(sessionsRoot); } catch (err) { return out; }
  sessions.forEach(function (session) {
    if (!protocol.isSafeId(session)) return;
    var folder;
    try { folder = stateDir.staticServersRoot(dir, session); } catch (err) { return; }
    var names;
    try { names = fs.readdirSync(folder); } catch (err) { return; }
    names.forEach(function (name) {
      if (!/^ss_[A-Za-z0-9_-]+\.json$/.test(name)) return;
      var file = path.join(folder, name);
      var meta = readJson(file);
      if (meta && meta.schema === SCHEMA && typeof meta.root === "string") out.push({ file: file, meta: meta });
    });
  });
  return out;
}

function stillRunning(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return false; }
}

/**
 * Stop every page-server process an old record still names, and mark each
 * record stopped. A process is signalled ONLY when its own health probe
 * answers with the record's id, instance, start time and pid: a pid the
 * system has since given to another program is never touched, and its record
 * is just marked stopped.
 *
 * @param {string} dir the state folder
 * @param {{probe?: function(object): Promise<boolean>, waitMs?: number}} [options]
 * @returns {Promise<number>} how many processes were stopped
 */
async function stopLeftovers(dir, options) {
  var opts = options || {};
  var probe = typeof opts.probe === "function" ? opts.probe : isExactServer;
  var waitMs = typeof opts.waitMs === "number" ? opts.waitMs : 5000;
  var stopped = 0;
  var records = allRecords(dir).filter(function (entry) { return !entry.meta.stopped_at; });
  for (var i = 0; i < records.length; i += 1) {
    var meta = records[i].meta;
    if (typeof meta.pid === "number" && await probe(meta)) {
      try { process.kill(meta.pid, "SIGTERM"); } catch (err) { /* already gone */ }
      var deadline = Date.now() + waitMs;
      while (stillRunning(meta.pid) && Date.now() < deadline) {
        await new Promise(function (resolve) { setTimeout(resolve, 25); });
      }
      stopped += 1;
    }
    var current = readJson(records[i].file);
    if (!current || current.stopped_at) continue;
    current.stopped_at = new Date().toISOString();
    current.stop_reason = RETIRED_REASON;
    try { stateDir.writeAtomic(records[i].file, JSON.stringify(current, null, 2) + "\n"); }
    catch (err) { /* the next start tries again */ }
  }
  return stopped;
}

// The pages `lahe review <folder>` serves and opens, spelled here so the CLI
// and the helper's Open agree (src/cli/commands/add.js uses these).
var PAGE_EXTENSIONS = [".html", ".htm"];

/**
 * The `.html` and `.htm` files directly in a directory, in name order.
 *
 * The folder's OWN pages, not a recursive walk. The served root and the open
 * link have to agree, and `lahe review <folder>` roots its server at the folder
 * itself: a lone page three directories down would be served at a URL nobody
 * would guess, and a project checkout that happens to hold a built HTML file
 * somewhere would stop being the app-in-dev row it has always been.
 *
 * @param {string} dirPath
 * @returns {string[]} file names, byte order, so two runs pick the same page
 */
function folderPages(dirPath) {
  var entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return [];
  }
  return entries
    .filter(function (entry) {
      return entry.isFile() && PAGE_EXTENSIONS.indexOf(path.extname(entry.name).toLowerCase()) !== -1;
    })
    .map(function (entry) { return entry.name; })
    .sort();
}

/**
 * The page `lahe review <folder>` prints as the open link: `index.html` when the
 * folder has one, then `index.htm`, else the first page in name order. Null when
 * the folder holds no pages at all.
 *
 * @param {string} dirPath
 * @returns {string|null}
 */
function folderEntryPage(dirPath) {
  var pages = folderPages(dirPath);
  if (pages.length === 0) return null;
  if (pages.indexOf("index.html") !== -1) return "index.html";
  if (pages.indexOf("index.htm") !== -1) return "index.htm";
  return pages[0];
}

/**
 * Which files a server's root and mounts cover, and the URL path each has there.
 *
 * ONE RULE, ONE PLACE. servesPath asks this plus "is that server running right
 * now". The Library's reader asks this alone: Open restarts a stopped server,
 * so a stopped record still makes its review openable, and a second copy of
 * the containment half is how the two would drift apart.
 *
 * A file is covered when it (or its real path) is the server's root, its
 * logical root (the pre-realpath spelling `lahe review` recorded), or a mount,
 * or sits under one. Roots come first, then mounts in their recorded order.
 *
 * @param {object} meta an ss_*.json record
 * @param {string} filePath an absolute path
 * @returns {string|null} the URL path the file has on that server, or null
 */
function coveragePath(meta, filePath) {
  if (!meta || typeof meta !== "object" || typeof filePath !== "string" || !filePath) return null;
  var target = path.resolve(filePath);
  var candidates = [target];
  try {
    var real = fs.realpathSync(target);
    if (real !== target) candidates.push(real);
  } catch (err) {
    // the plain path still answers
  }
  var bases = [];
  if (typeof meta.root === "string" && meta.root) bases.push({ base: meta.root, prefix: "/" });
  if (typeof meta.logical_root === "string" && meta.logical_root) bases.push({ base: meta.logical_root, prefix: "/" });
  if (meta.mounts && typeof meta.mounts === "object") {
    Object.keys(meta.mounts).forEach(function (prefix) {
      if (typeof meta.mounts[prefix] === "string" && meta.mounts[prefix]) {
        bases.push({ base: meta.mounts[prefix], prefix: prefix });
      }
    });
  }
  for (var i = 0; i < bases.length; i += 1) {
    for (var j = 0; j < candidates.length; j += 1) {
      var base = bases[i].base;
      var candidate = candidates[j];
      if (candidate === base || candidate.indexOf(base + path.sep) === 0) {
        return bases[i].prefix + path.relative(base, candidate)
          .split(path.sep)
          .filter(function (segment) { return segment.length > 0; })
          .map(encodeURIComponent)
          .join("/");
      }
    }
  }
  return null;
}

module.exports = {
  SCHEMA: SCHEMA,
  IDLE_REASON: IDLE_REASON,
  CLOSED_REASON: CLOSED_REASON,
  RETIRED_REASON: RETIRED_REASON,
  REOPEN_STAGE: REOPEN_STAGE,
  serverId: serverId,
  isExactServer: isExactServer,
  list: list,
  allRecords: allRecords,
  stopLeftovers: stopLeftovers,
  coveragePath: coveragePath,
  folderPages: folderPages,
  folderEntryPage: folderEntryPage
};
