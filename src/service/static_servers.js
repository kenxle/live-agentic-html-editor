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
  ".webp": "image/webp"
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
 * The review that recorded `filePath` (or one of `filePaths`) as a target, or
 * null. Newest review wins on the rare path collision, matching
 * add.js's reviewMatchingPath.
 *
 * @param {string} dir the state directory
 * @param {string[]} filePaths candidate absolute paths for the same request
 *   (the resolved path and, when it differs, its realpath)
 * @returns {{review: string, token: string}|null}
 */
function findReviewForTarget(dir, filePaths) {
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
  var best = null;
  entries.forEach(function (entry) {
    if (!entry.isDirectory() || !protocol.isSafeId(entry.name)) return;
    var meta = readJson(stateDir.metaPath(dir, entry.name));
    if (!meta || typeof meta.token !== "string") return;
    var targets = Array.isArray(meta.target_paths) ? meta.target_paths.slice() : [];
    if (typeof meta.target_path === "string" && meta.target_path && targets.indexOf(meta.target_path) === -1) {
      targets.push(meta.target_path);
    }
    var matches = filePaths.some(function (candidate) { return targets.indexOf(candidate) !== -1; });
    if (!matches) return;
    var at = typeof meta.created_at === "string" ? meta.created_at : "";
    if (!best || at > best.at) best = { review: entry.name, token: meta.token, at: at };
  });
  return best ? { review: best.review, token: best.token } : null;
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

function runServer(file, sessionId, id, instance, rootInput, dir, logicalRootInput) {
  var root = fs.realpathSync(rootInput);
  var logicalRoot = typeof logicalRootInput === "string" && logicalRootInput ? logicalRootInput : root;
  var prior = readJson(file);
  var mounts = prior && prior.root === root && prior.mounts && typeof prior.mounts === "object" ? prior.mounts : {};
  var autoMounts = prior && prior.root === root && Array.isArray(prior.auto_mounts) ? prior.auto_mounts.slice() : [];
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

  // A Markdown file inside a mount is answered with the SAME deterministic
  // rendering the review artifact uses: read-only, enrolled in no review, no
  // library script line and no token. Links out of it are translated the same
  // way, so a chain of documents keeps working.
  function renderMarkdown(candidate, req, res) {
    var registry = markdownLinks.createRegistry({ mounts: mounts, consumed: autoMounts });
    var html;
    try { html = markdown.render(candidate, { readOnlyNote: true, links: registry }); }
    catch (err) { return send(res, 500, "could not render " + path.basename(candidate) + "\n"); }
    persistAutoMounts(registry.added);
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

  var startedAt = new Date().toISOString();
  var server = http.createServer(function (req, res) {
    var pathname;
    try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); }
    catch (err) { return send(res, 400, "bad request\n"); }
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
    Object.keys(mounts).some(function (prefix) {
      if (pathname.indexOf(prefix) !== 0) return false;
      servingRoot = mounts[prefix];
      relative = pathname.slice(prefix.length);
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
      if (!stat.isFile()) return send(res, 404, "not found\n");
    } catch (err) {
      // A rendered document may pull the Mermaid runtime beside itself, and the
      // source directory has no copy of it. The packaged one is the same bytes.
      if (path.basename(candidate) === markdown.MERMAID_ASSET) candidate = markdown.MERMAID_SOURCE;
      else return send(res, 404, "not found\n");
      try { stat = fs.statSync(candidate); } catch (missing) { return send(res, 404, "not found\n"); }
    }
    if (markdown.isMarkdown(candidate)) return renderMarkdown(candidate, req, res);
    if (heal.isStaticPage(candidate)) {
      var filePaths = [candidate];
      if (real && real !== candidate) filePaths.push(real);
      // Only for the unmounted root: a review's target_path was recorded
      // against the pre-realpath root (see start()'s logicalRoot comment), and
      // a mount's directory has no such second identity to fall back to.
      if (servingRoot === root && logicalRoot !== root) {
        var logicalCandidate = path.resolve(logicalRoot, path.relative(servingRoot, candidate));
        if (filePaths.indexOf(logicalCandidate) === -1) filePaths.push(logicalCandidate);
      }
      var match = findReviewForTarget(dir, filePaths);
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
      mounts: mounts
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
