// Session-owned read-only HTTP servers for ordinary static HTML reviews.

"use strict";

var childProcess = require("node:child_process");
var crypto = require("node:crypto");
var fs = require("node:fs");
var http = require("node:http");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var scriptLine = require("../shared/script_line.js");
var markdown = require("./markdown.js");
var markdownLinks = require("./markdown_links.js");
var stateDir = require("./state_dir.js");
var tabIcon = require("./tab_icon.js");
var heal = require("./heal.js");
var logModule = require("./log.js");

var SCHEMA = 1;
var HOST = protocol.DEFAULT_HOST;
var HEALTH_PREFIX = "/.lahe-static-health/";
// Every link mount lives under this. See the request handler for why only its
// literal spelling is served.
var MOUNT_ROOT = "/.lahe-source/";

// The library, served by this server rather than copied into the reviewed
// page's own folder.
//
// WHY THIS EXISTS. `add` used to drop a copy of the built bundle beside the
// page so the script line's onerror had something relative to load when the
// helper was down. The page's folder is very often a git checkout, so `git add
// -A` committed the bundle, and a deployed copy of that site then loaded the
// review rail for every visitor. This server already answers every request for
// the page, so it is the thing that can hand the browser the library too, out
// of the clone, with nothing written into the reviewer's tree.
//
// The prefix follows HEALTH_PREFIX and the /.lahe-source/ mounts: a dotted,
// tool-named path segment no ordinary document folder has.
var LIBRARY_PREFIX = "/.lahe-library/";
var LIBRARY_PATH = LIBRARY_PREFIX + heal.BUNDLE_BASENAME;

var MIME = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitFor(check, timeoutMs) {
  var end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    var value = await check();
    if (value) return value;
    await delay(50);
  }
  return null;
}

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

function writeMeta(dir, sessionId, meta) {
  stateDir.ensureStaticServersRoot(dir, sessionId);
  stateDir.writeAtomic(stateDir.staticServerPath(dir, sessionId, meta.id), JSON.stringify(meta, null, 2) + "\n");
  return meta;
}

/**
 * Two `linked_files` tables as one. Each maps a linked file's real path to the
 * reviews whose pages linked to it, in the order they were first recorded.
 * Nothing is ever dropped: reviews are never deleted, and a table that only
 * grows is one no two writers can shrink by racing.
 */
function mergeLinkedFiles(a, b) {
  var out = {};
  [a, b].forEach(function (table) {
    if (!table || typeof table !== "object") return;
    Object.keys(table).forEach(function (file) {
      if (!Array.isArray(table[file])) return;
      var into = out[file] || (out[file] = []);
      table[file].forEach(function (review) {
        if (typeof review === "string" && protocol.isSafeId(review) && into.indexOf(review) === -1) into.push(review);
      });
    });
  });
  return out;
}

/**
 * Record that `reviewId`'s page links to each of `targets` (real paths), on the
 * static server `serverId` of this session.
 *
 * THIS IS WHAT PUTS A RAIL ON A LINKED DOCUMENT, and the only thing. A mount
 * serves the linked file's whole folder so the link works, but the rail goes
 * only on the files a reviewed page actually linked to, and it rides the
 * review of the page that linked (spec 20260922.02, requirements 2 and 5).
 * Three writers call it: `lahe review` after its own render, the helper's
 * re-render (rebuild.js), and the server when it renders a linked document
 * that itself carries a rail, which is how a chain rides the first review.
 *
 * It writes the server's own metadata file and nothing in the review store.
 * Read-merge-write, like the mounts beside it.
 *
 * @returns {boolean} whether anything new was written
 */
function recordLinks(dir, sessionId, serverId, reviewId, targets) {
  if (!protocol.isSafeId(reviewId) || !Array.isArray(targets) || !targets.length) return false;
  var file = stateDir.staticServerPath(dir, sessionId, serverId);
  var current = readJson(file);
  if (!current || current.session_id !== sessionId) return false;
  var addition = {};
  targets.forEach(function (target) {
    if (typeof target !== "string" || !path.isAbsolute(target)) return;
    addition[target] = [reviewId];
  });
  var merged = mergeLinkedFiles(current.linked_files, addition);
  if (JSON.stringify(merged) === JSON.stringify(mergeLinkedFiles(current.linked_files, {}))) return false;
  current.linked_files = merged;
  stateDir.writeAtomic(file, JSON.stringify(current, null, 2) + "\n");
  return true;
}

async function registerMount(dir, sessionId, meta, prefix, rootInput) {
  if (!/^\/\.lahe-source\/[a-f0-9]+\/$/.test(prefix)) throw new Error("invalid static source mount " + JSON.stringify(prefix));
  if (!(await isExactServer(meta))) throw new Error("refusing to update a static server whose identity is no longer live");
  // The server registers link mounts itself while rendering a linked document,
  // so the on-disk copy can hold mounts this caller's `meta` never saw. Merge
  // rather than replace, or a review command silently unmounts them.
  var onDisk = readJson(stateDir.staticServerPath(dir, sessionId, meta.id));
  var next = Object.assign({}, meta);
  next.mounts = Object.assign({}, meta.mounts || {}, onDisk && onDisk.mounts ? onDisk.mounts : {});
  if (onDisk && Array.isArray(onDisk.auto_mounts)) next.auto_mounts = onDisk.auto_mounts.slice();
  // The same for which review linked to which file: the server and the helper
  // write it while this caller holds an older copy.
  next.linked_files = mergeLinkedFiles(meta.linked_files, onDisk && onDisk.linked_files);
  next.mounts[prefix] = fs.realpathSync(path.resolve(rootInput));
  writeMeta(dir, sessionId, next);
  try { process.kill(meta.pid, "SIGHUP"); }
  catch (err) { throw new Error("could not notify the static server about its source mount: " + err.message); }
  var loaded = await waitFor(async function () {
    var health = await requestHealth(next);
    return health && Array.isArray(health.mounts) && health.mounts.indexOf(prefix) !== -1;
  }, 2000);
  if (!loaded) throw new Error("the static server did not load source mount " + prefix);
  Object.assign(meta, next);
  return meta;
}

async function start(options) {
  var dir = options.dir;
  var sessionId = options.sessionId;
  // `add`/`review` record a review's target_path with a plain path.resolve, never
  // a realpath (src/cli/commands/add.js). This server's OWN root is realpathed,
  // deliberately, so the symlink-escape check below has one real directory to
  // compare against. On a machine where the OS temp directory is itself a
  // symlink (macOS: /var/... -> /private/var/...), those two disagree, so the
  // pre-realpath root travels alongside it, for matching a request's file back
  // to a review's recorded target path (see logicalCandidate in runServer).
  // restartAll passes the ORIGINAL logicalRoot back in (read off this server's
  // own meta.json), because `meta.root` it also reads is already realpathed and
  // resolving it again is a no-op: without this a restart would quietly lose
  // the pre-realpath identity and, on a symlinked temp dir, injection with it.
  var logicalRoot = options.logicalRoot ? path.resolve(options.logicalRoot) : path.resolve(options.root);
  var root = fs.realpathSync(path.resolve(options.root));
  var id = serverId(root);
  var file = stateDir.staticServerPath(dir, sessionId, id);
  var existing = readJson(file);
  if (fs.existsSync(file) && !existing) throw new Error("static server metadata is corrupt: " + file);
  if (existing && existing.root === root && await isExactServer(existing)) {
    return { meta: existing, started: false };
  }

  stateDir.ensureStaticServersRoot(dir, sessionId);
  var instance = crypto.randomBytes(16).toString("hex");
  var child = childProcess.spawn(
    process.execPath,
    [__filename, "--serve", file, sessionId, id, instance, root, dir, logicalRoot],
    { detached: true, stdio: "ignore" }
  );
  child.unref();

  var meta = await waitFor(async function () {
    var candidate = readJson(file);
    if (!candidate || candidate.instance !== instance) return null;
    return await isExactServer(candidate) ? candidate : null;
  }, 10000);
  if (!meta) throw new Error("the static review server did not start within 10 seconds");
  return { meta: meta, started: true };
}

async function stopOne(dir, sessionId, meta) {
  if (!meta || meta.stopped_at) return false;
  var exact = await isExactServer(meta);
  if (!exact) {
    meta.stopped_at = new Date().toISOString();
    meta.stop_reason = "already down";
    writeMeta(dir, sessionId, meta);
    return false;
  }
  try { process.kill(meta.pid, "SIGTERM"); }
  catch (err) { if (err.code !== "ESRCH") throw err; }
  var stopped = await waitFor(async function () { return !(await isExactServer(meta)); }, 10000);
  if (!stopped) throw new Error("static review server " + meta.id + " did not stop within 10 seconds");
  meta.stopped_at = new Date().toISOString();
  meta.stop_reason = "session closed";
  writeMeta(dir, sessionId, meta);
  return true;
}

async function stopAll(dir, sessionId) {
  var stopped = 0;
  var entries = list(dir, sessionId);
  for (var i = 0; i < entries.length; i += 1) {
    if (await stopOne(dir, sessionId, entries[i])) stopped += 1;
  }
  return stopped;
}

async function restartAll(dir, sessionId) {
  var entries = list(dir, sessionId).map(function (meta) {
    return { root: meta.root, logicalRoot: typeof meta.logical_root === "string" ? meta.logical_root : null };
  });
  var started = 0;
  for (var i = 0; i < entries.length; i += 1) {
    var result = await start({ dir: dir, sessionId: sessionId, root: entries[i].root, logicalRoot: entries[i].logicalRoot });
    if (result.started) started += 1;
  }
  return started;
}

/**
 * Does `candidate`, relative to `base`, cross a dotfile segment?
 *
 * Used only for mount requests (see isMount in runServer): the mount rule in
 * markdown_links.js already refuses a hidden LOCATION when a link is
 * translated, and this is the matching check at serve time, so a hidden file
 * or folder already inside a mounted directory (e.g. `.env`, `.git/config`)
 * is refused too, whether it was requested by its own name or reached
 * through a normally-named symlink (call this once for the requested path
 * and once for its realpath).
 *
 * @param {string} base the mount's own root (never itself dot-prefixed: the
 *   mount prefix regex only matches a hex id)
 * @param {string} candidate an absolute path under `base`
 * @returns {boolean}
 */
function hasHiddenSegment(base, candidate) {
  if (candidate === base) return false;
  return path.relative(base, candidate).split(path.sep).some(function (segment) {
    return segment.length > 0 && segment.charAt(0) === ".";
  });
}

function send(res, status, body, type) {
  res.writeHead(status, {
    "cache-control": "no-store",
    "content-type": type || "text/plain; charset=utf-8",
    "x-content-type-options": "nosniff"
  });
  res.end(body);
}

// ---------------------------------------------------------------------------
// Serve-time injection.
//
// WHY THIS EXISTS. The script line is normally healed by heal.js, but that only
// runs when a live page polls the helper (reviews.targetMtime, called from
// replies.poll). If the reviewer's tab is closed, or they hard-reload in the
// window between an agent overwriting the file and the next poll, the freshly
// loaded page has no library at all: nothing is polling, so nothing repairs it.
// This server sees every request for the page before the browser does, so it
// can put the tag in the RESPONSE without ever touching the file on disk.
//
// For a served review this is now the ONLY path, not a second one. `lahe
// review` writes no tag into the page and copies no bundle beside it, and the
// healer stands down for any file this server is serving (heal.js rule 5),
// because a review id and a per-review token written into a folder that is
// usually a git checkout get committed by an ordinary `git add -A`. The on-disk
// line and the sibling copy remain exactly as they were for the cases with no
// server to inject for them: a plain `lahe add`, and any file:// review.
//
// Matching a request to a review reads the same recorded target paths
// reviews.recordPaths writes to meta.json (src/service/reviews.js), read
// straight off disk: this server is a separate process from the helper that
// holds reviews in memory, so disk is the only thing they share.

/**
 * The folder a review of `target` is served out of: the folder itself for a
 * folder review, the page's own folder for a single page. Null when the target
 * is not on disk any more.
 *
 * This is the same choice `lahe review` makes when it starts the server (see
 * servedKind in src/cli/commands/review.js), which is the point: it is how a
 * review recorded on disk is matched back to the server that serves it.
 */
function servedFrom(target) {
  if (typeof target !== "string" || !target) return null;
  try {
    if (fs.statSync(target).isDirectory()) return target;
  } catch (err) {
    return null;
  }
  return path.dirname(target);
}

/**
 * Is this review's own served folder the folder this server is rooted at?
 *
 * THE RAIL FOLLOWS THE REVIEWER. Ken, 2026-09-16: "if you can navigate to a
 * page from where you currently are, and you currently have the lahe editor, it
 * should follow you across anything you click on." A single-page review serves
 * that page's whole folder, so every page in it is somewhere the reviewer can
 * get to by clicking a link or typing a name, and arriving there without a rail
 * is arriving somewhere they cannot say anything. So a one-page review answers
 * for its siblings too, exactly as a folder review answers for its pages.
 *
 * The reviewer who does not want that says so with `--only`, which is checked
 * by the caller: a folder nobody chose (Downloads, a Desktop) is a real case,
 * and it gets a flag rather than a narrower default.
 *
 * WHAT IS STILL EXCLUDED is a review whose own server root is somewhere else.
 * `lahe review site/` and `lahe review site/sub/` are two documents that happen
 * to be nested, each with its own server rooted at its own folder, and neither
 * reaches up into the other. Without that, the newer and narrower review takes
 * over every page of the outer one.
 */
function backsServer(target, roots) {
  var from = servedFrom(target);
  return !!from && roots.indexOf(from) !== -1;
}

/** Newer wins; the id breaks a tie, so two reviews minted in one millisecond
 * still pick the same way on every request. */
function newer(candidate, best) {
  if (!best) return true;
  if (candidate.at !== best.at) return candidate.at > best.at;
  return candidate.review > best.review;
}

/**
 * The review a page this server is about to serve belongs to, or null.
 *
 * TWO WAYS TO LAND ON ONE, in order.
 *
 *  1. THE RECORDED TARGET. A review that named this exact file (the same
 *     target paths reviews.recordPaths writes to meta.json). Newest wins on the
 *     rare path collision, matching add.js's reviewMatchingPath.
 *  2. THE REVIEW THIS SERVER IS SERVING FOR. Everything our own server hands
 *     out of a reviewed folder gets the rail: pages the reviewer reaches by a
 *     link, pages written after the review was opened, and the siblings of a
 *     single reviewed page. The rail follows the reviewer wherever they can
 *     navigate to. See backsServer above for what that means exactly, and
 *     docs/ongoing/STATIC_SITE_FOLDER.md for why. A review opened with `--only`
 *     opts out and answers for its recorded pages alone.
 *
 * NOTHING IS WRITTEN. No enrollment, no meta.json update, no log line for the
 * ordinary case. The server stays a reader of the review store; the item's own
 * event carries the page path, which is all the rail and review.json need to
 * group by page.
 *
 * A REVIEW OF ANOTHER AGENT SESSION NEVER ANSWERS, recorded target or not.
 * Sessions do not see each other's work, two of them can hold a server on the
 * same folder at once, and the thing being handed over is a live token.
 * Mounted folders are not searched either, because a document reached by a link
 * off a rendered Markdown page is served read-only on purpose.
 *
 * Read straight off disk: this server is a separate process from the helper that
 * holds reviews in memory, so disk is the only thing they share.
 *
 * @param {string} dir the state directory
 * @param {{filePaths: string[], sessionId: string, roots: string[]}} options
 *   `filePaths` are candidate absolute paths for the same request (the resolved
 *   path and, when it differs, its realpath). `roots` are this server's own
 *   root directories.
 * @returns {{review: string, token: string, displaced: string|null}|null}
 *   `displaced` names the folder review this page's own review won over, for
 *   the one log line that case is worth.
 */
function findReviewForRequest(dir, options) {
  var opts = options || {};
  var filePaths = opts.filePaths || [];
  var roots = (opts.roots || []).filter(function (base) { return typeof base === "string" && !!base; });
  var root;
  try {
    root = stateDir.reviewsRoot(dir);
  } catch (err) {
    return null;
  }
  if (!fs.existsSync(root)) return null;
  var entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    return null;
  }
  var recorded = null;
  var backing = null;
  entries.forEach(function (entry) {
    if (!entry.isDirectory() || !protocol.isSafeId(entry.name)) return;
    var meta = readJson(stateDir.metaPath(dir, entry.name));
    if (!meta || typeof meta.token !== "string") return;
    if (meta.agent_session_id !== opts.sessionId) return;
    var targets = Array.isArray(meta.target_paths) ? meta.target_paths.slice() : [];
    if (typeof meta.target_path === "string" && meta.target_path && targets.indexOf(meta.target_path) === -1) {
      targets.push(meta.target_path);
    }
    var candidate = {
      review: entry.name,
      token: meta.token,
      at: typeof meta.created_at === "string" ? meta.created_at : ""
    };
    if (filePaths.some(function (file) { return targets.indexOf(file) !== -1; })) {
      if (newer(candidate, recorded)) recorded = candidate;
      return;
    }
    // `--only` (meta.only_recorded_pages) is the reviewer saying this review is
    // about the page they named and nothing else around it. An isolated review
    // is never borrowed for a page it did not record.
    if (meta.only_recorded_pages === true) return;
    var servesThisFolder = targets.some(function (target) { return backsServer(target, roots); });
    if (servesThisFolder && newer(candidate, backing)) backing = candidate;
  });
  var best = recorded || backing;
  if (!best) return null;
  return {
    review: best.review,
    token: best.token,
    displaced: recorded && backing ? backing.review : null
  };
}

/** The helper's own origin, read fresh off service.json so a custom `--port` is honored. */
function currentHelperOrigin(dir) {
  var ready = readJson(stateDir.readyPath(dir));
  var port = ready && typeof ready.port === "number" ? ready.port : protocol.DEFAULT_PORT;
  return "http://" + protocol.DEFAULT_HOST + ":" + port;
}

/**
 * `html`, with `match`'s script tag put back if it is missing, or `null` when
 * nothing needs to change (the tag is already this review's, or a DIFFERENT
 * review's tag is present and is left alone on purpose, exactly as heal.js
 * does).
 *
 * @param {string} dir the state directory
 * @param {{review: string, token: string}} match the review this file targets
 * @param {string} target the path named in the log line for the foreign-tag case
 * @param {string} html the file's current bytes
 * @returns {string|null}
 */
function injectForMatch(dir, match, target, html) {
  var carried = scriptLine.reviewAlreadyInFile(html);
  if (carried === match.review) return null;
  if (carried) {
    try {
      logModule.createEventLog({ dir: dir }).helperLog(
        "review " + match.review + ": not injecting at serve time into " + target +
          ", it carries review " + carried + " now, so it was re-attached somewhere else on purpose"
      );
    } catch (err) {
      // Diagnostic only; a page that cannot log must still be served.
    }
    return null;
  }
  var helperOrigin = currentHelperOrigin(dir);
  // THE LIBRARY COMES FROM THIS SERVER, and the helper is the fallback.
  //
  // That is the reverse of what `add` writes into a file, on purpose. `add`'s
  // line has to resolve from wherever a page opened from disk sits, so it names
  // the helper absolutely and falls back to a sibling copy. This line is only
  // ever produced by this server, so a root-absolute path resolves back here
  // whatever host name the reviewer typed, and here is the process that just
  // answered the request: it cannot be down. The helper is a separate process
  // and often is down, which is exactly why it is the fallback and not the src.
  //
  // Nothing relative to the page is named, so no copy of the bundle has to be
  // written into the reviewer's folder for this line to work.
  var tag = protocol.scriptTag({
    src: LIBRARY_PATH,
    review: match.review,
    token: match.token,
    helper: helperOrigin,
    fallback: helperOrigin + protocol.route("library.get").path
  });
  return scriptLine.placeScriptLine(html, tag).html;
}

/**
 * Is one of this session's static servers serving `filePath` right now?
 *
 * The helper asks this before healing a stripped script line back INTO a file:
 * when the answer is yes the tag is already going into every response, so
 * writing it to disk would put a review token into the reviewer's own working
 * tree for nothing (src/service/heal.js).
 *
 * Sync and cheap on purpose: this runs behind the reply poll, once a second per
 * reviewed page. `lahe status` asks a stronger version of the same question in
 * servedVia (src/cli/commands/status.js), with a real health probe over HTTP,
 * because it runs once and a human is reading the answer. Here a live pid and
 * an unstopped lease are enough.
 *
 * @param {string} dir the state directory
 * @param {string} sessionId the agent session the review belongs to
 * @param {string} filePath an absolute path to the reviewed file
 * @returns {boolean} false for anything unreadable, so a doubtful answer heals
 *   rather than leaving a page without its rail
 */
function servesPath(dir, sessionId, filePath) {
  if (typeof dir !== "string" || typeof sessionId !== "string" || typeof filePath !== "string") return false;
  var entries;
  try { entries = list(dir, sessionId); } catch (err) { return false; }
  var target = path.resolve(filePath);
  var realTarget = target;
  try { realTarget = fs.realpathSync(target); } catch (err) { /* the plain path still answers */ }
  return entries.some(function (meta) {
    if (meta.stopped_at) return false;
    if (typeof meta.pid !== "number") return false;
    try { process.kill(meta.pid, 0); } catch (err) { return false; }
    var roots = [meta.root, meta.logical_root];
    if (meta.mounts && typeof meta.mounts === "object") {
      Object.keys(meta.mounts).forEach(function (prefix) { roots.push(meta.mounts[prefix]); });
    }
    return roots.some(function (base) {
      if (typeof base !== "string" || !base) return false;
      return [target, realTarget].some(function (candidate) {
        return candidate === base || candidate.indexOf(base + path.sep) === 0;
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Linked documents: pages under a /.lahe-source/ mount.
//
// Spec: docs/features/20260922.02_linked_docs_rail/01_spec_linked_docs_rail.md.
// A reviewed Markdown page links to a document in another folder, and the
// server mounts that folder so the link works. The reviewer who follows the
// link keeps the rail, by reuse and never by creating anything:
//
//  1. THE DOCUMENT'S OWN REVIEW, by redirect. A document with a review of its
//     own in this agent session is sent to the page that review already
//     serves. Its token is never carried over to this URL: the rail groups
//     items by page path, the earlier comments were made on the review's own
//     page, and carrying the token here would need a new origin written onto
//     that review.
//  2. THE LINKING PAGE'S REVIEW. Otherwise a file some reviewed page linked to
//     (linked_files, see recordLinks) carries the rail of the newest review
//     that linked to it. An `--only` review keeps its links read-only.
//  3. NOTHING. Any other file under a mount is served as it always was.
//
// Every fact is read off disk, never off the request: the page that linked is
// never taken from a Referer header or anything else the browser sends.

function realOrNull(target) {
  try { return fs.realpathSync(target); } catch (err) { return null; }
}

function withinDir(candidate, base) {
  return candidate === base || candidate.indexOf(base + path.sep) === 0;
}

/** This agent session's reviews, straight off disk: [{id, meta}]. */
function sessionReviews(dir, sessionId) {
  var root;
  try { root = stateDir.reviewsRoot(dir); } catch (err) { return []; }
  var entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (err) { return []; }
  var out = [];
  entries.forEach(function (entry) {
    if (!entry.isDirectory() || !protocol.isSafeId(entry.name)) return;
    var meta = readJson(stateDir.metaPath(dir, entry.name));
    if (!meta || typeof meta.token !== "string" || meta.agent_session_id !== sessionId) return;
    out.push({ id: entry.name, meta: meta });
  });
  return out;
}

function targetsOf(meta) {
  var targets = Array.isArray(meta.target_paths) ? meta.target_paths.slice() : [];
  if (typeof meta.target_path === "string" && meta.target_path && targets.indexOf(meta.target_path) === -1) {
    targets.push(meta.target_path);
  }
  return targets;
}

function createdAt(meta) {
  return typeof meta.created_at === "string" ? meta.created_at : "";
}

/**
 * A live static server of this session serving `page`, as the absolute URL of
 * that page on it, or null. "Live" is the cheap check servesPath uses: an
 * unstopped lease and a pid that answers.
 */
function liveUrlFor(dir, sessionId, page) {
  var realPage = realOrNull(page);
  if (!realPage) return null;
  var entries;
  try { entries = list(dir, sessionId); } catch (err) { return null; }
  var url = null;
  entries.some(function (meta) {
    if (meta.stopped_at || typeof meta.pid !== "number" || typeof meta.port !== "number") return false;
    try { process.kill(meta.pid, 0); } catch (err) { return false; }
    var base = realOrNull(meta.root);
    if (!base || !withinDir(realPage, base) || realPage === base) return false;
    var relative = path.relative(base, realPage).split(path.sep).map(encodeURIComponent).join("/");
    url = "http://" + (meta.host || HOST) + ":" + meta.port + "/" + relative;
    return true;
  });
  return url;
}

/**
 * Requirement 1: the page of this document's own review in this session, or
 * null. A Markdown document matches a review's source_path and is sent to the
 * rendered page that review serves; an HTML document matches a recorded target.
 * Newest review wins. Null when that review's server is not running, so the
 * caller falls through to the linking page's review.
 */
function ownReviewUrl(dir, sessionId, realFile) {
  var isMd = markdown.isMarkdown(realFile);
  var best = null;
  sessionReviews(dir, sessionId).forEach(function (entry) {
    var page = null;
    if (isMd) {
      if (typeof entry.meta.source_path === "string" && realOrNull(entry.meta.source_path) === realFile &&
          typeof entry.meta.target_path === "string") {
        page = entry.meta.target_path;
      }
    } else if (targetsOf(entry.meta).some(function (target) { return realOrNull(target) === realFile; })) {
      page = realFile;
    }
    if (!page) return;
    if (best && createdAt(entry.meta) <= createdAt(best.meta)) return;
    best = { meta: entry.meta, page: page };
  });
  return best ? liveUrlFor(dir, sessionId, best.page) : null;
}

/**
 * Requirement 2: the review a linked file rides, from this server's own
 * linked_files table.
 *
 * @returns {{review: string, token: string}|{readOnly: true}|{missing: true}|null}
 *   null when no reviewed page linked to this file at all; readOnly when every
 *   review that did is `--only`; missing when none of them is in this session,
 *   which should not happen, since reviews are never deleted.
 */
function linkingReview(dir, sessionId, serverFile, realFile) {
  var meta = readJson(serverFile);
  var table = meta && meta.linked_files && typeof meta.linked_files === "object" ? meta.linked_files : null;
  var registrants = table && Array.isArray(table[realFile]) ? table[realFile] : [];
  if (!registrants.length) return null;
  var known = sessionReviews(dir, sessionId).filter(function (entry) {
    return registrants.indexOf(entry.id) !== -1;
  });
  if (!known.length) return { missing: true };
  var open = known.filter(function (entry) { return entry.meta.only_recorded_pages !== true; });
  if (!open.length) return { readOnly: true };
  var best = null;
  open.forEach(function (entry) {
    var candidate = { review: entry.id, token: entry.meta.token, at: createdAt(entry.meta) };
    if (newer(candidate, best)) best = candidate;
  });
  return { review: best.review, token: best.token };
}

/**
 * The real file a linked page's browser path names, for an item made on it, or
 * null (requirements 6 and 7).
 *
 * THE HELPER WORKS THIS OUT; THE PAGE NEVER SUPPLIES IT. The page path is
 * mapped through this session's static server mount tables, read off disk the
 * same way the server reads them. The result must sit inside the mount's folder
 * by real path, cross no hidden segment, be a file, and be one this very review
 * put its rail on (linked_files). Anything else names no file.
 *
 * @param {string} dir the state directory
 * @param {string} sessionId the review's own agent session
 * @param {string} reviewId
 * @param {string} pagePath the page's location.pathname, as the item carries it
 * @returns {string|null}
 */
function linkedFileForPage(dir, sessionId, reviewId, pagePath) {
  if (typeof dir !== "string" || typeof sessionId !== "string" || typeof pagePath !== "string") return null;
  if (!protocol.isSafeId(reviewId)) return null;
  // ONE SPELLING. The server refuses a mount prefix that arrives encoded
  // (/%2Elahe-source/...), so a page path that is not literally under the
  // prefix is not a linked page this server handed out.
  if (pagePath.indexOf(MOUNT_ROOT) !== 0) return null;
  var decoded;
  try { decoded = decodeURIComponent(pagePath); } catch (err) { return null; }
  var match = decoded.match(/^(\/\.lahe-source\/[a-f0-9]+\/)(.+)$/);
  if (!match) return null;
  var reviewMeta = readJson(stateDir.metaPath(dir, reviewId));
  if (!reviewMeta || reviewMeta.agent_session_id !== sessionId) return null;
  var entries;
  try { entries = list(dir, sessionId); } catch (err) { return null; }
  var found = null;
  entries.some(function (meta) {
    if (!meta.mounts || typeof meta.mounts[match[1]] !== "string") return false;
    var base = realOrNull(meta.mounts[match[1]]);
    if (!base) return false;
    var candidate = path.resolve(base, match[2]);
    if (!withinDir(candidate, base) || candidate === base) return false;
    var real = realOrNull(candidate);
    if (!real || !withinDir(real, base)) return false;
    if (hasHiddenSegment(base, candidate) || hasHiddenSegment(base, real)) return false;
    try { if (!fs.statSync(real).isFile()) return false; } catch (err) { return false; }
    // Only a page. A linked script or data file is served as bytes, carries
    // no rail, and is never named as the file to edit.
    if (!markdownLinks.isPage(real)) return false;
    var table = meta.linked_files && typeof meta.linked_files === "object" ? meta.linked_files : {};
    if (!Array.isArray(table[real]) || table[real].indexOf(reviewId) === -1) return false;
    found = real;
    return true;
  });
  return found;
}

/** `html` with a visible note placed just inside <body>, or at the top. */
function placeNote(html, note) {
  var text = String(html);
  var body = text.match(/<body\b[^>]*>/i);
  if (!body) return note + text;
  var at = body.index + body[0].length;
  return text.slice(0, at) + note + text.slice(at);
}


function runServer(file, sessionId, id, instance, rootInput, dir, logicalRootInput) {
  var root = fs.realpathSync(rootInput);
  var logicalRoot = typeof logicalRootInput === "string" && logicalRootInput ? logicalRootInput : root;
  var prior = readJson(file);
  var mounts = prior && prior.root === root && prior.mounts && typeof prior.mounts === "object" ? prior.mounts : {};
  var autoMounts = prior && prior.root === root && Array.isArray(prior.auto_mounts) ? prior.auto_mounts.slice() : [];
  var priorLinks = prior && prior.root === root ? mergeLinkedFiles(prior.linked_files, {}) : {};
  function reloadMounts() {
    var current = readJson(file);
    if (!current || current.root !== root || !current.mounts || typeof current.mounts !== "object") return;
    mounts = Object.assign({}, current.mounts, mounts);
    if (Array.isArray(current.auto_mounts)) {
      current.auto_mounts.forEach(function (prefix) {
        if (autoMounts.indexOf(prefix) === -1) autoMounts.push(prefix);
      });
    }
  }

  // Mounts this server registered for itself while rendering a linked document.
  // They are written back to the same metadata file the CLI reads, so a restart
  // or a later registerMount keeps them.
  function persistAutoMounts(added) {
    if (!added.length) return;
    added.forEach(function (entry) {
      mounts[entry.prefix] = entry.dir;
      if (autoMounts.indexOf(entry.prefix) === -1) autoMounts.push(entry.prefix);
    });
    var current = readJson(file);
    if (!current) return;
    current.mounts = Object.assign({}, current.mounts || {}, mounts);
    current.auto_mounts = autoMounts.slice();
    try { stateDir.writeAtomic(file, JSON.stringify(current, null, 2) + "\n"); }
    catch (err) { /* the render still answers; the mount is re-derived next start */ }
  }

  // A Markdown file is answered with the SAME deterministic rendering the
  // review artifact uses, and links out of it are translated the same way, so
  // a chain of documents keeps working.
  //
  // Three shapes, chosen by the caller (see serveLinked):
  //  - `match`: a linked document riding the linking page's review. No
  //    read-only note, the review's script line in the response, and the links
  //    this render translated are recorded against that same review, which is
  //    how a chain (hub to B to C) rides the hub's review.
  //  - `missing`: a linked document whose linking review is not in this
  //    session. Read-only, with a note that says so and names the command.
  //  - neither: read-only, enrolled in no review, no script line, no token.
  function renderMarkdown(candidate, req, res, options) {
    var opts = options || {};
    var registry = markdownLinks.createRegistry({ mounts: mounts, consumed: autoMounts });
    var renderOptions = { readOnlyNote: true, links: registry };
    if (opts.match) renderOptions.note = "";
    else if (opts.missing) renderOptions.note = markdown.missingReviewNote(opts.realFile || candidate, sessionId);
    var html;
    try { html = markdown.render(candidate, renderOptions); }
    catch (err) { return send(res, 500, "could not render " + path.basename(candidate) + "\n"); }
    persistAutoMounts(registry.added);
    if (opts.match) {
      try { recordLinks(dir, sessionId, id, opts.match.review, registry.linked); }
      catch (err) { /* the page still answers; its links ride no review until the next render */ }
      var injected = injectForMatch(dir, opts.match, candidate, html);
      if (injected !== null) html = injected;
    }
    var body = Buffer.from(html, "utf8");
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-length": body.length,
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff"
    });
    if (req.method === "HEAD") return res.end();
    res.end(body);
  }

  function sendHtml(req, res, html) {
    var body = Buffer.from(html, "utf8");
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-length": body.length,
      "content-type": "text/html; charset=utf-8",
      "x-content-type-options": "nosniff"
    });
    if (req.method === "HEAD") return res.end();
    res.end(body);
  }

  // A page under a mount: a document some reviewed page linked to, or a file
  // beside one. See "Linked documents" above for the three outcomes. Returns
  // false when the plain read-only answer below should be sent instead.
  var saidMissing = Object.create(null);
  function serveLinked(candidate, realFile, req, res) {
    var own = ownReviewUrl(dir, sessionId, realFile);
    if (own) {
      res.writeHead(302, { "cache-control": "no-store", location: own, "x-content-type-options": "nosniff" });
      res.end();
      return true;
    }
    var linking = linkingReview(dir, sessionId, file, realFile);
    if (linking && linking.missing && !saidMissing[realFile]) {
      saidMissing[realFile] = true;
      say("static server " + id + ": " + realFile + " was linked from a reviewed page whose review is not in this session; served read-only, nothing created");
    }
    var isMd = markdown.isMarkdown(candidate);
    if (isMd) {
      if (linking && linking.review) renderMarkdown(candidate, req, res, { match: linking });
      else if (linking && linking.missing) renderMarkdown(candidate, req, res, { missing: true, realFile: realFile });
      else renderMarkdown(candidate, req, res);
      return true;
    }
    if (!linking || linking.readOnly) return false;
    var html;
    try { html = fs.readFileSync(candidate, "utf8"); } catch (err) { return false; }
    if (linking.missing) {
      sendHtml(req, res, placeNote(html, markdown.missingReviewNote(realFile, sessionId)));
      return true;
    }
    var injected = injectForMatch(dir, linking, candidate, html);
    sendHtml(req, res, tabIcon.ensure(injected !== null ? injected : html));
    return true;
  }
  // The built bundle, streamed straight out of the clone. Read-only like
  // everything else here, and unauthenticated like the helper's own
  // library.get: these are public bytes with no review data and no token in
  // them.
  function sendLibrary(req, res) {
    var stat;
    try { stat = fs.statSync(heal.BUNDLE); }
    catch (err) { return send(res, 404, "the built library is not in this clone\n"); }
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-length": stat.size,
      "content-type": MIME[".js"],
      "x-content-type-options": "nosniff"
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(heal.BUNDLE).on("error", function () { res.destroy(); }).pipe(res);
  }

  // The document stylesheet is three vendored files joined into one, so there
  // is no single file on disk to stream. It is built once and cached by
  // markdown.js, so this is a string lookup rather than three reads per hit.
  function sendDocStyle(req, res) {
    var css;
    try { css = markdown.styleSheet(); }
    catch (err) { return send(res, 404, "the document stylesheet is not in this clone\n"); }
    var body = Buffer.from(css, "utf8");
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-length": body.length,
      "content-type": MIME[".css"],
      "x-content-type-options": "nosniff"
    });
    if (req.method === "HEAD") return res.end();
    res.end(body);
  }

  function say(line) {
    try {
      logModule.createEventLog({ dir: dir }).helperLog(line);
    } catch (err) {
      // Diagnostic only; a page that cannot log must still be served.
    }
  }

  // Said once per server, not once per request. A page served plain means the
  // reviewer has no rail and no way to say anything, and the only place that
  // fact can be seen from is the log; a line per request would bury it.
  //
  // ONLY FOR THE SERVER'S OWN ROOT. A page under a mount is a linked document,
  // read-only and on no review by design, so reporting it here would be untrue
  // and would spend the once-only latch before the real case ever arrived.
  var saidNoReview = false;
  function noReviewBacksThisServer() {
    if (saidNoReview) return;
    saidNoReview = true;
    say("static server " + id + ": no review backs " + root + ", so its pages are served plain, with no rail");
  }

  // Two reviews over one folder: this page was recorded on its own, so it keeps
  // its own review while the folder review takes every other page. Legal and
  // deliberate, and worth one line per page, because the way an agent finds out
  // otherwise is wondering why a reply landed on the wrong card.
  var saidOwnReview = Object.create(null);
  function keepsItsOwnReview(pagePath, match) {
    if (saidOwnReview[pagePath]) return;
    saidOwnReview[pagePath] = true;
    say(
      "static server " + id + ": " + pagePath + " keeps its own review " + match.review +
        "; folder review " + match.displaced + " covers the rest of " + root
    );
  }

  var startedAt = new Date().toISOString();
  var server = http.createServer(function (req, res) {
    var pathname;
    var rawPathname;
    try {
      rawPathname = new URL(req.url, "http://localhost").pathname;
      pathname = decodeURIComponent(rawPathname);
    }
    catch (err) { return send(res, 400, "bad request\n"); }
    // ONE SPELLING FOR A MOUNT. A request whose decoded path lands under a
    // mount but whose raw path does not literally start with it
    // (/%2Elahe-source/...) is refused. The browser reports that raw spelling
    // as the page's path, and every helper-side check looks for the literal
    // prefix, so serving it would put a rail on a page the helper cannot map.
    if (pathname.indexOf(MOUNT_ROOT) === 0 && rawPathname.indexOf(MOUNT_ROOT) !== 0) {
      return send(res, 404, "not found\n");
    }
    if (pathname === HEALTH_PREFIX + id + "/" + instance) {
      return send(res, 200, JSON.stringify({
        id: id,
        instance: instance,
        started_at: startedAt,
        pid: process.pid,
        mounts: Object.keys(mounts)
      }), "application/json; charset=utf-8");
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed\n");
    // The reserved library route, answered before anything under the served
    // root is looked at, so a folder that happens to be named for it cannot
    // shadow the one file every injected page depends on.
    if (pathname === LIBRARY_PATH) return sendLibrary(req, res);
    var servingRoot = root;
    var relative = pathname.replace(/^\/+/, "");
    var isMount = false;
    Object.keys(mounts).some(function (prefix) {
      if (pathname.indexOf(prefix) !== 0) return false;
      servingRoot = mounts[prefix];
      relative = pathname.slice(prefix.length);
      isMount = true;
      return true;
    });
    var candidate = path.resolve(servingRoot, relative || "index.html");
    if (candidate !== servingRoot && candidate.indexOf(servingRoot + path.sep) !== 0) return send(res, 403, "forbidden\n");
    var stat;
    try {
      stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        candidate = path.join(candidate, "index.html");
        stat = fs.statSync(candidate);
      }
      var real = fs.realpathSync(candidate);
      if (real !== servingRoot && real.indexOf(servingRoot + path.sep) !== 0) return send(res, 403, "forbidden\n");
      // A MOUNT REFUSES ANYTHING HIDDEN. markdown_links.js already refuses a
      // hidden LOCATION when a link is translated into a mount in the first
      // place, but this handler used to serve any path under an already-
      // mounted folder, hidden or not. Checked on both the path as requested
      // (candidate) and its realpath (real), so a normally-named symlink that
      // resolves to a hidden file or folder is refused the same as the literal
      // path would be. The mount's OWN root is never itself dot-prefixed (the
      // prefix regex above only matches a hex id), so this never fires for the
      // mount root itself, only for a segment under it.
      //
      // The server's OWN root (isMount false) is intentionally unchanged: see
      // the fallback for .lahe-doc-style.css, .lahe-fonts/, and the Mermaid
      // runtime below, which resolve to a packaged copy for a mount request
      // too, never to a real file on disk, so they are unaffected by this.
      if (isMount && (hasHiddenSegment(servingRoot, candidate) || hasHiddenSegment(servingRoot, real))) {
        return send(res, 404, "not found\n");
      }
      if (!stat.isFile()) return send(res, 404, "not found\n");
    } catch (err) {
      // Three files a page may ask for beside itself that the served directory
      // has no copy of. All three are packaged, and the packaged ones are the
      // same bytes, so the basename is enough to resolve them from anywhere.
      var missingName = path.basename(candidate);
      // A rendered document may pull the Mermaid runtime beside itself.
      if (missingName === markdown.MERMAID_ASSET) candidate = markdown.MERMAID_SOURCE;
      // A page an agent wrote for review links the document stylesheet. It is
      // three vendored files concatenated, so it is built rather than read.
      else if (missingName === markdown.DOC_STYLE_ASSET) return sendDocStyle(req, res);
      // The faces that stylesheet names.
      else if (path.basename(path.dirname(candidate)) === markdown.FONT_ASSET_DIR &&
               markdown.FONT_ASSETS.indexOf(missingName) !== -1) {
        candidate = path.join(markdown.FONT_SOURCE_DIR, missingName);
      }
      else return send(res, 404, "not found\n");
      try { stat = fs.statSync(candidate); } catch (missing) { return send(res, 404, "not found\n"); }
    }
    if (isMount && (markdown.isMarkdown(candidate) || heal.isStaticPage(candidate)) && real) {
      if (serveLinked(candidate, real, req, res)) return;
    } else if (markdown.isMarkdown(candidate)) {
      return renderMarkdown(candidate, req, res);
    } else if (heal.isStaticPage(candidate)) {
      var filePaths = [candidate];
      if (real && real !== candidate) filePaths.push(real);
      // Only for the unmounted root: a review's target_path was recorded
      // against the pre-realpath root (see start()'s logicalRoot comment), and
      // a mount's directory has no such second identity to fall back to.
      if (servingRoot === root && logicalRoot !== root) {
        var logicalCandidate = path.resolve(logicalRoot, path.relative(servingRoot, candidate));
        if (filePaths.indexOf(logicalCandidate) === -1) filePaths.push(logicalCandidate);
      }
      var ownRoot = servingRoot === root;
      var match = findReviewForRequest(dir, {
        filePaths: filePaths,
        sessionId: sessionId,
        // The server's OWN root only. A page under a mount never reaches
        // here: serveLinked above decides it from linked_files.
        roots: ownRoot ? [root, logicalRoot] : []
      });
      if (!match && ownRoot) noReviewBacksThisServer();
      if (match && match.displaced) keepsItsOwnReview(candidate, match);
      if (match) {
        var html;
        try { html = fs.readFileSync(candidate, "utf8"); } catch (err) { html = null; }
        if (html !== null) {
          var injected = injectForMatch(dir, match, candidate, html);
          // The tab icon rides along with the script line, and for the same
          // reason: the response is the only place LAHE may change a reviewed
          // page. Writing a link tag into the reviewer's own file would put it
          // in their working tree, and an ordinary `git add -A` would commit
          // it. A page that already names an icon is left exactly as it is.
          var outHtml = tabIcon.ensure(injected !== null ? injected : html);
          var body = Buffer.from(outHtml, "utf8");
          res.writeHead(200, {
            "cache-control": "no-store",
            "content-length": body.length,
            "content-type": "text/html; charset=utf-8",
            "x-content-type-options": "nosniff"
          });
          if (req.method === "HEAD") return res.end();
          return res.end(body);
        }
      }
    }
    res.writeHead(200, {
      "cache-control": "no-store",
      "content-length": stat.size,
      "content-type": MIME[path.extname(candidate).toLowerCase()] || "application/octet-stream",
      "x-content-type-options": "nosniff"
    });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(candidate).on("error", function () { res.destroy(); }).pipe(res);
  });
  server.listen(0, HOST, function () {
    var meta = {
      schema: SCHEMA,
      id: id,
      session_id: sessionId,
      instance: instance,
      root: root,
      logical_root: logicalRoot,
      host: HOST,
      port: server.address().port,
      pid: process.pid,
      started_at: startedAt,
      stopped_at: null,
      mounts: mounts,
      // Which review linked to which file outlives a restart, or every linked
      // document would lose its rail until each hub was rendered again.
      linked_files: mergeLinkedFiles(priorLinks, (readJson(file) || {}).linked_files)
    };
    stateDir.writeAtomic(file, JSON.stringify(meta, null, 2) + "\n");
  });
  function stop() { server.close(function () { process.exit(0); }); }
  process.on("SIGHUP", reloadMounts);
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (require.main === module) {
  if (process.argv[2] !== "--serve" || process.argv.length < 10) process.exit(2);
  runServer(
    process.argv[3],
    process.argv[4],
    process.argv[5],
    process.argv[6],
    process.argv[7],
    process.argv[8],
    process.argv[9]
  );
}

module.exports = {
  SCHEMA: SCHEMA,
  LIBRARY_PATH: LIBRARY_PATH,
  servesPath: servesPath,
  recordLinks: recordLinks,
  linkedFileForPage: linkedFileForPage,
  serverId: serverId,
  isExactServer: isExactServer,
  list: list,
  start: start,
  registerMount: registerMount,
  stopOne: stopOne,
  stopAll: stopAll,
  restartAll: restartAll,
  runServer: runServer
};
