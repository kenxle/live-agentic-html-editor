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
  // THE OLD PORT FIRST. A restart that comes back on the port it had keeps
  // every origin a review already registered for it, and an old tab's URL works
  // again. When the port is taken the server falls back to a random one (see
  // runServer), and the caller that cares registers the new origin.
  var preferredPort = validPort(options.preferredPort) ? options.preferredPort : 0;
  var child = childProcess.spawn(
    process.execPath,
    [__filename, "--serve", file, sessionId, id, instance, root, dir, logicalRoot, String(preferredPort)],
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

function validPort(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536;
}

/** The start() options that bring a recorded server back as it was. */
function restartSpec(dir, sessionId, meta) {
  return {
    dir: dir,
    sessionId: sessionId,
    root: meta.root,
    logicalRoot: typeof meta.logical_root === "string" ? meta.logical_root : null,
    preferredPort: meta.port
  };
}

async function restartAll(dir, sessionId) {
  var entries = list(dir, sessionId);
  var started = 0;
  for (var i = 0; i < entries.length; i += 1) {
    var result = await start(restartSpec(dir, sessionId, entries[i]));
    if (result.started) started += 1;
  }
  return started;
}

/**
 * The two loopback origins a static server on `port` is reached by.
 * `lahe review` registers exactly these (127.0.0.1, plus the localhost twin
 * add.js adds), so they are the only ones a restart swaps.
 */
function loopbackOrigins(port) {
  return ["http://" + HOST + ":" + port, "http://localhost:" + port];
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
 * The reviews of `sessionId` that `meta`'s server serves, read off disk: a
 * review with a recorded target (a page or a folder) that coveragePath covers
 * on that server, mounts included. ONE COVERAGE RULE (fix round CL3): the
 * reader decides a review is openable through this same rule, so the reviews
 * whose origins a restart swaps are exactly the ones Open can land on.
 * `alsoReview`, the review Open asked for, is always in the answer when it
 * belongs to the session.
 */
function reviewsServedBy(dir, sessionId, meta, alsoReview) {
  var root;
  try { root = stateDir.reviewsRoot(dir); } catch (err) { return []; }
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(function (entry) { return entry.isDirectory() && protocol.isSafeId(entry.name); })
    .map(function (entry) { return entry.name; })
    .filter(function (reviewId) {
      var recorded = readJson(stateDir.metaPath(dir, reviewId));
      if (!recorded || recorded.agent_session_id !== sessionId) return false;
      if (reviewId === alsoReview) return true;
      var targets = Array.isArray(recorded.target_paths) ? recorded.target_paths.slice() : [];
      if (typeof recorded.target_path === "string") targets.push(recorded.target_path);
      return targets.some(function (target) { return coveragePath(meta, target) !== null; });
    })
    .sort();
}

/**
 * The helper's side of the Library's Open and of its reopened-session sweep.
 *
 * The CLI's own `lahe session reopen` and `close` keep working as they did;
 * these are the same acts run from inside the helper, which holds the review
 * registry in memory and so is the one process that can swap a review's
 * origins without a restart.
 *
 * @param {{dir: string, reviews: object, sessions?: object}} options
 *   `reviews` is the helper's registry (reviews.js), `sessions` an
 *   agent_sessions store (one over `dir` when left out).
 */
function createCatalogOps(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createCatalogOps: dir is required");
  if (!opts.reviews) throw new Error("createCatalogOps: reviews is required");
  var dir = opts.dir;
  var reviews = opts.reviews;
  var sessions = opts.sessions || require("./agent_sessions.js").createStore({ dir: dir });

  /**
   * Bring back `sessionId`'s one recorded server `serverId` (old port first),
   * then reopen the session if it is closed, register that server's origins on every review
   * it serves (by coveragePath, mounts included, plus `reviewId`, the review
   * Open asked for), and remove the loopback origins of its EARLIER ports from those
   * same reviews. Nothing else is removed: not a dev server's origin, not a
   * non-loopback one, not a port another server of this session is on now.
   *
   * A server that is already up is not restarted; the origin pass still runs
   * and is a no-op when everything is already in place.
   *
   * @returns {Promise<{server: object, started: boolean, origin: string,
   *   reviews: string[], registered: string[], removed: string[]}>}
   */
  async function reopenForCatalog(sessionId, serverId, reviewId) {
    var session = sessions.read(sessionId);
    if (!session || session.synthetic) throw new Error("unknown agent session " + JSON.stringify(sessionId));
    var record = list(dir, sessionId).filter(function (meta) { return meta.id === serverId; })[0];
    if (!record) {
      throw new Error("agent session " + sessionId + " has no recorded static server " + JSON.stringify(String(serverId)));
    }
    // The server first, the session second. A restart that fails (a root that
    // is gone, a server that never answers) then leaves a closed session
    // closed, with nothing reopened for the sweep to have to find.
    var result = await start(restartSpec(dir, sessionId, record));
    if (session.closed_at) sessions.reopen(sessionId);
    var server = result.meta;

    var current = loopbackOrigins(server.port);
    // A port another server of this session is on right now keeps its origins,
    // even if this server once had it.
    var othersNow = list(dir, sessionId)
      .filter(function (meta) { return meta.id !== server.id && !meta.stopped_at; })
      .map(function (meta) { return meta.port; });
    var stale = [];
    (Array.isArray(server.ports) ? server.ports : []).forEach(function (port) {
      if (port === server.port || othersNow.indexOf(port) !== -1) return;
      loopbackOrigins(port).forEach(function (origin) { stale.push(origin); });
    });

    var served = reviewsServedBy(dir, sessionId, server, reviewId);
    var registered = [];
    var removed = [];
    served.forEach(function (reviewId) {
      var review = reviews.get(reviewId) || (typeof reviews.ensureKnown === "function" ? reviews.ensureKnown(reviewId) : null);
      if (!review) return;
      current.forEach(function (origin) {
        if (review.origins.indexOf(origin) === -1) registered.push(origin);
        reviews.registerOrigin(reviewId, origin);
      });
      stale.forEach(function (origin) {
        if (review.origins.indexOf(origin) === -1) return;
        reviews.removeOrigin(reviewId, origin);
        removed.push(origin);
      });
    });
    return {
      server: server,
      started: result.started,
      origin: current[0],
      reviews: served,
      registered: registered,
      removed: removed
    };
  }

  /**
   * Close a session from inside the helper: stop its static servers and mark
   * it closed. Unlike `lahe session close`, it prints nothing and never stops
   * the helper, which is the process running it.
   *
   * @returns {Promise<{stopped: number}>}
   */
  async function closeQuiet(sessionId) {
    var stopped = await stopAll(dir, sessionId);
    sessions.close(sessionId);
    return { stopped: stopped };
  }

  return { reopenForCatalog: reopenForCatalog, closeQuiet: closeQuiet };
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
  return entries.some(function (meta) {
    if (meta.stopped_at) return false;
    if (typeof meta.pid !== "number") return false;
    try { process.kill(meta.pid, 0); } catch (err) { return false; }
    return coveragePath(meta, filePath) !== null;
  });
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

/**
 * Does this Host header name this server, at its own port?
 *
 * THE DNS-REBINDING GUARD. A page on a name the attacker controls can be
 * re-pointed at 127.0.0.1 and then read whatever this server answers, and a
 * served page carries its review's token. The browser still sends the
 * attacker's name as the Host, so only `127.0.0.1:<port>` and
 * `localhost:<port>` are answered. A missing Host is refused too: a browser
 * always sends one. The helper has the same rule (D11, protocol.hostAllowed);
 * this one is narrower because it pins the port as well.
 */
function hostIsOwn(hostHeader, port) {
  if (typeof hostHeader !== "string" || !hostHeader || !port) return false;
  var value = hostHeader.toLowerCase();
  return value === HOST + ":" + port || value === "localhost:" + port;
}

function runServer(file, sessionId, id, instance, rootInput, dir, logicalRootInput, preferredPortInput) {
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
    // Before anything else, on every path: pages, the reserved library route,
    // the health probe, and a 404 alike.
    var address = server.address();
    if (!hostIsOwn(req.headers.host, address && address.port)) return send(res, 400, "bad host\n");
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
      var ownRoot = servingRoot === root;
      var match = findReviewForRequest(dir, {
        filePaths: filePaths,
        sessionId: sessionId,
        // The server's OWN root only. A mounted folder holds documents a
        // rendered Markdown page links to, and those are served read-only by
        // design, so nothing there is put on a review.
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
  // THE PORT HISTORY. Every port this record has listened on, oldest first,
  // so a restart knows which loopback origins came from this server and may be
  // removed (createCatalogOps). A record written before the history existed
  // seeds it with the one port it names.
  var ports = [];
  if (prior && prior.root === root) {
    if (Array.isArray(prior.ports)) ports = prior.ports.filter(validPort);
    else if (validPort(prior.port)) ports = [prior.port];
  }
  var preferredPort = Number(preferredPortInput);
  if (!validPort(preferredPort)) preferredPort = 0;
  function listen(port) {
    server.listen(port, HOST, onListening);
  }
  server.once("error", function (err) {
    // The old port is taken (or refused): fall back to any free one. Any other
    // failure, or a failure on port 0, ends the process, and start() reports
    // that the server did not come up.
    if (preferredPort && (err.code === "EADDRINUSE" || err.code === "EACCES")) {
      preferredPort = 0;
      return listen(0);
    }
    throw err;
  });
  listen(preferredPort);
  function onListening() {
    var port = server.address().port;
    if (ports.indexOf(port) === -1) ports.push(port);
    var meta = {
      schema: SCHEMA,
      id: id,
      session_id: sessionId,
      instance: instance,
      root: root,
      logical_root: logicalRoot,
      host: HOST,
      port: port,
      ports: ports.slice(),
      pid: process.pid,
      started_at: startedAt,
      stopped_at: null,
      mounts: mounts
    };
    stateDir.writeAtomic(file, JSON.stringify(meta, null, 2) + "\n");
  }
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
    process.argv[9],
    process.argv[10]
  );
}

module.exports = {
  SCHEMA: SCHEMA,
  LIBRARY_PATH: LIBRARY_PATH,
  servesPath: servesPath,
  coveragePath: coveragePath,
  serverId: serverId,
  isExactServer: isExactServer,
  list: list,
  start: start,
  registerMount: registerMount,
  stopOne: stopOne,
  stopAll: stopAll,
  restartAll: restartAll,
  createCatalogOps: createCatalogOps,
  folderPages: folderPages,
  folderEntryPage: folderEntryPage,
  hostIsOwn: hostIsOwn,
  runServer: runServer
};
