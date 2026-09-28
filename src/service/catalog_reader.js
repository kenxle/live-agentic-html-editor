// The catalog reader: the Library's list, built from files already on disk.
//
// Owner: LAHE Library 1.1 (docs/features/20260922.02_lahe_library, architecture
// "The list response" and "Failure Modes"). It reads, it never writes: no
// review.json is regenerated here, no log is repaired, nothing is created.
//
// WHERE EACH FIELD COMES FROM
//
//   meta.json         the review's session, target, source and creation time
//   review.json       title, pages, counts, ended_at
//   events.jsonl      its modified time (a review's `last`; when the log ends
//                     in origin events, the newest other event's time, from
//                     the tail only), unless the
//                     log is newer than review.json and small enough to fold
//                     here (REPROJECT_MAX_BYTES), in which case the one review
//                     is projected in memory with the helper's own projection
//   session.json      the session's name
//   monitor.json      who is watching, through agent_sessions.livenessFrom,
//   activity.json     with the recent-command stamp the request queue counts
//   ss_*.json         whether Open can restart a server for the review, and
//                     (with a probe) whether one is serving it right now
//   catalog.json      stars, through catalog_store
//
// Two inputs come from the request queue (Library 1.4) and are passed in, so
// this module never reads catalog-attach.json or catalog-requests.jsonl itself.
// They are always the queue's own (queueInputs below): `attachment(now)` is
// readAttached, with its own `watching`, and `requestFor(reviewId, now)` the
// latest request on a review, with `by_name` already filled. The helper also
// passes `requestsAt(now)`, the same answers from one read of the queue, so a
// list reads catalog-requests.jsonl once rather than once per row.
//
// ONE CORRUPT FILE DEGRADES ONE ROW. Every read is caught and turned into
// `unreadable: true` on the row it belongs to; the rest of the list returns.
//
// NEVER IN THE LIST: comment text (the reader takes only titles, paths and
// counts from a projection), review tokens, and absolute paths (a folder is
// shown as `path_hint`, with the home directory written as ~).
//
// Node-only.

"use strict";

var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var record = require("../shared/record.js");
var stateDir = require("./state_dir.js");
var agentSessions = require("./agent_sessions.js");
var staticServers = require("./static_servers.js");
var projection = require("./projection.js");
var catalogStore = require("./catalog_store.js");

var CATALOG = protocol.CATALOG;
var FOLD_CUTOFF_MS = Date.parse(CATALOG.FOLD_CUTOFF);
var LEGACY = agentSessions.LEGACY_ID;
var HEARTBEAT = protocol.MONITOR.HEARTBEAT_FIELD;

// What counts as "a page" for folding and for a worktree candidate: the
// extensions `lahe add` serves as a static page, plus the Markdown sources
// `lahe review` renders.
var PAGE_EXTENSIONS = [".html", ".htm", ".md", ".markdown"];
var SINGLE_PAGE_EXTENSIONS = [".html", ".htm"];

// A quote, a backslash or a control character in a candidate path: never
// offered. The path is page-derived, and an agent hands it on.
// eslint-disable-next-line no-control-regex
var UNSAFE_PATH_CHARS = /['"`\\\u0000-\u001f\u007f-\u009f]/;

// <repo>/.claude/worktrees/<name>/<rest>
var WORKTREE = /^(.*)\/\.claude\/worktrees\/[^/]+(?:\/(.*))?$/;

function toMs(now) {
  if (typeof now === "number") return now;
  if (typeof now === "string") return Date.parse(now);
  return Date.now();
}

function iso(ms) {
  return new Date(ms).toISOString();
}

function statOrNull(file) {
  try {
    return fs.statSync(file);
  } catch (err) {
    return null;
  }
}

function exists(file) {
  return typeof file === "string" && !!file && statOrNull(file) !== null;
}

function hasHiddenSegment(rel) {
  return rel.split(/[\\/]/).some(function (segment) {
    return segment.length > 0 && segment.charAt(0) === ".";
  });
}

/**
 * @param {{dir: string, home?: string, readFile?: function, pidAlive?: function,
 *          probe?: function, attachment?: function, requestFor?: function,
 *          requestsAt?: function}} options
 *   `readFile` defaults to fs.readFileSync; tests pass a counting one.
 *   `probe(meta)` resolves true when the recorded server is really that server;
 *   it defaults to static_servers.isExactServer.
 */
function createReader(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("catalog_reader.createReader: dir is required");
  var dir = opts.dir;
  var home = typeof opts.home === "string" && opts.home ? path.resolve(opts.home) : os.homedir();
  var readFile = typeof opts.readFile === "function" ? opts.readFile : fs.readFileSync;
  var pidAlive = typeof opts.pidAlive === "function" ? opts.pidAlive : agentSessions.pidAlive;
  var probe = typeof opts.probe === "function" ? opts.probe : staticServers.isExactServer;
  var attachment = typeof opts.attachment === "function" ? opts.attachment : function () { return null; };
  var requestFor = typeof opts.requestFor === "function" ? opts.requestFor : function () { return null; };
  // `requestsAt(now)` returns a `(reviewId) => request` lookup built from one
  // read of the queue. When given, list uses it once per call instead of
  // calling requestFor once per row.
  var requestsAt = typeof opts.requestsAt === "function" ? opts.requestsAt : null;
  var store = catalogStore.createCatalogStore({ dir: dir, readFile: readFile });

  // ---------------------------------------------------------------------------
  // Reading files, cached per file on modified time plus size
  // ---------------------------------------------------------------------------

  var fileCache = Object.create(null);

  /**
   * @returns {{state: "missing"} | {state: "bad"} | {state: "ok", value: *, stat: fs.Stats}}
   */
  function cached(file, parse) {
    var stat = statOrNull(file);
    if (!stat) {
      delete fileCache[file];
      return { state: "missing" };
    }
    var key = stat.mtimeMs + ":" + stat.size;
    var hit = fileCache[file];
    if (hit && hit.key === key) return hit.result;
    var result;
    try {
      result = { state: "ok", value: parse(readFile(file, "utf8")), stat: stat };
    } catch (err) {
      result = { state: "bad", stat: stat };
    }
    fileCache[file] = { key: key, result: result };
    return result;
  }

  function cachedJson(file) {
    return cached(file, function (text) {
      var value = JSON.parse(text);
      if (!value || typeof value !== "object") throw new Error("not an object");
      return value;
    });
  }

  // ---------------------------------------------------------------------------
  // A review's `last`, when its log ends in origin events
  // ---------------------------------------------------------------------------

  // Open's origin swap (fix round CR5) appends origin.registered and
  // origin.removed to every review the restarted server serves, so the log's
  // modified time would call a review nobody touched "worked on just now".
  // When the log ENDS in origin events, `last` is the time of the newest event
  // that is not one. Only the tail is read, so a large log stays unread.
  var ORIGIN_EVENTS = [protocol.EVENT.ORIGIN_REGISTERED, protocol.EVENT.ORIGIN_REMOVED];
  var TAIL_BYTES = 64 * 1024;
  var tailCache = Object.create(null);

  /** The newest non-origin event's time, or null to keep the modified time. */
  function lastPastOriginEvents(file, stat) {
    var key = stat.mtimeMs + ":" + stat.size;
    var hit = tailCache[file];
    if (hit && hit.key === key) return hit.value;
    var value = null;
    try {
      var length = Math.min(stat.size, TAIL_BYTES);
      var buf = Buffer.alloc(length);
      var fd = fs.openSync(file, "r");
      try {
        fs.readSync(fd, buf, 0, length, stat.size - length);
      } finally {
        fs.closeSync(fd);
      }
      var lines = buf.toString("utf8").split("\n");
      // A partial first line of a cut tail is never trusted.
      if (length < stat.size) lines.shift();
      var sawOrigin = false;
      for (var i = lines.length - 1; i >= 0; i -= 1) {
        if (!lines[i].trim()) continue;
        var event;
        try {
          event = JSON.parse(lines[i]);
        } catch (err) {
          continue;
        }
        if (!event || typeof event !== "object") continue;
        if (ORIGIN_EVENTS.indexOf(event.event) !== -1) {
          sawOrigin = true;
          continue;
        }
        if (sawOrigin) {
          var ts = typeof event.ts === "string" ? Date.parse(event.ts) : NaN;
          if (!Number.isNaN(ts)) value = ts;
        }
        break;
      }
    } catch (err) {
      value = null;
    }
    tailCache[file] = { key: key, value: value };
    return value;
  }

  // ---------------------------------------------------------------------------
  // Sessions, heartbeats and servers
  // ---------------------------------------------------------------------------

  function readSession(sessionId) {
    if (sessionId === LEGACY) return { state: "ok", value: { id: LEGACY, synthetic: true } };
    if (!protocol.isSafeId(sessionId)) return { state: "bad" };
    var got;
    try {
      got = cachedJson(stateDir.agentSessionPath(dir, sessionId));
    } catch (err) {
      return { state: "bad" };
    }
    if (got.state === "ok" && (got.value.schema !== agentSessions.SCHEMA || got.value.id !== sessionId)) {
      return { state: "bad" };
    }
    return got;
  }

  function nameOf(sessionId) {
    var s = readSession(sessionId);
    return s.state === "ok" ? agentSessions.cleanName(s.value.name) : null;
  }

  /** Was the session's name read off a page's title? Then no hand-off carries it. */
  function nameFromPage(sessionId) {
    var s = readSession(sessionId);
    return s.state === "ok" && !!agentSessions.cleanName(s.value.name) && s.value.name_source === agentSessions.NAME_SOURCE_PAGE;
  }

  /**
   * Is an agent listening on this session? Read only through livenessFrom,
   * with the same inputs the request queue uses (fix round CL2): a fresh
   * heartbeat on this handoff rev whose pid is alive, OR a lahe command in the
   * last few minutes. The second matters because `lahe monitor` exits when it
   * wakes on work, so a heartbeat alone reads "nobody" exactly while the agent
   * is working a batch. `beat` is the heartbeat record, stale or not, for its
   * `primary`.
   */
  function monitorLive(sessionId, nowMs) {
    if (sessionId === LEGACY || !protocol.isSafeId(sessionId)) return { live: false, beat: null };
    var beat = null;
    var activity = null;
    try {
      var got = cachedJson(stateDir.monitorPath(dir, sessionId));
      beat = got.state === "ok" ? got.value : null;
    } catch (err) {
      beat = null;
    }
    try {
      var act = cachedJson(stateDir.activityPath(dir, sessionId));
      activity = act.state === "ok" ? act.value : null;
    } catch (err) {
      activity = null;
    }
    if (!beat && !activity) return { live: false, beat: null };
    var s = readSession(sessionId);
    var liveness = agentSessions.livenessFrom({
      session: s.state === "ok" ? s.value : null,
      monitor: beat,
      activity: activity,
      listening: null,
      nowMs: nowMs,
      pidAlive: pidAlive
    });
    return { live: liveness[protocol.AGENT_LIVENESS.FIELD.LISTENING] === true, beat: beat };
  }

  function watchingOf(sessionId, nowMs) {
    var m = monitorLive(sessionId, nowMs);
    var primary = m.beat ? m.beat[HEARTBEAT.PRIMARY] : null;
    var who = typeof primary === "string" && protocol.isSafeId(primary) ? primary : sessionId;
    if (m.live) return { session: who, name: nameOf(who) };
    // WATCHED THROUGH ANOTHER SESSION'S MONITOR (story walk). An agent that
    // took this session over watches it from its own multi-session monitor,
    // and that monitor exits to work a batch. Right after the agent answers,
    // this session's heartbeat is stale, but the agent named as `primary` is
    // listening on its own session: it is still the one watching. Only for a
    // heartbeat on this session's current handoff rev, so a takeover since
    // does not count.
    if (who === sessionId || !m.beat) return null;
    var own = readSession(sessionId);
    var rev = own.state === "ok" ? agentSessions.handoffRev(own.value) : 0;
    if (m.beat[HEARTBEAT.HANDOFF_REV] !== rev) return null;
    return monitorLive(who, nowMs).live ? { session: who, name: nameOf(who) } : null;
  }

  /**
   * A session's server records, read one by one so a corrupt record degrades
   * the rows it might have served rather than the whole session. The shape
   * check is static_servers.list's.
   */
  function serversOf(sessionId) {
    var out = { records: [], bad: false };
    if (sessionId === LEGACY || !protocol.isSafeId(sessionId)) return out;
    var root;
    try {
      root = stateDir.staticServersRoot(dir, sessionId);
    } catch (err) {
      out.bad = true;
      return out;
    }
    var names;
    try {
      names = fs.readdirSync(root);
    } catch (err) {
      return out;
    }
    names
      .filter(function (name) { return /^ss_[A-Za-z0-9_-]+\.json$/.test(name); })
      .sort()
      .forEach(function (name) {
        var got = cachedJson(path.join(root, name));
        var meta = got.state === "ok" ? got.value : null;
        if (
          !meta || meta.schema !== staticServers.SCHEMA || meta.session_id !== sessionId ||
          !protocol.isSafeId(meta.id) || typeof meta.root !== "string"
        ) {
          out.bad = true;
          return;
        }
        out.records.push(meta);
      });
    return out;
  }

  /** The record that would serve this file: a running one first, then the newest. */
  function coveringRecord(records, file) {
    var best = null;
    records.forEach(function (meta) {
      var urlPath = staticServers.coveragePath(meta, file);
      if (urlPath === null) return;
      var candidate = { meta: meta, urlPath: urlPath };
      if (!best) best = candidate;
      else if (!!best.meta.stopped_at !== !!meta.stopped_at) {
        if (!meta.stopped_at) best = candidate;
      } else if (String(meta.started_at || "") > String(best.meta.started_at || "")) {
        best = candidate;
      }
    });
    return best;
  }

  /**
   * The URL path Open lands on for a FOLDER review (story walk). The coverage
   * rule gives a folder its server root, `/`, and a folder of pages with no
   * index.html answers that with "not found". So: the page the review's
   * comments are on, when it is a page in that folder, else the entry page
   * `lahe review <folder>` opens (static_servers.folderEntryPage). A single
   * page's path is returned as it is.
   */
  function openPathOf(info, covering) {
    if (!covering || !info.servedPath) return covering ? covering.urlPath : null;
    var stat = statOrNull(info.servedPath);
    if (!stat || !stat.isDirectory()) return covering.urlPath;
    var folder = info.servedPath;
    var pages = info.summary && Array.isArray(info.summary.pages) ? info.summary.pages : [];
    for (var i = 0; i < pages.length; i += 1) {
      var file = pageFileIn(folder, pages[i] && pages[i].path);
      var onServer = file ? staticServers.coveragePath(covering.meta, file) : null;
      if (onServer) return onServer;
    }
    var entry = staticServers.folderEntryPage(folder);
    var entryPath = entry ? staticServers.coveragePath(covering.meta, path.join(folder, entry)) : null;
    return entryPath || covering.urlPath;
  }

  /**
   * A page's recorded URL path as a file in `folder`, or null. The path is
   * page-derived, so it must be plain: rooted, no dot or hidden segment, no
   * backslash or control character, and an existing .html or .htm file under
   * the folder by real path.
   */
  function pageFileIn(folder, urlPath) {
    if (typeof urlPath !== "string" || urlPath.charAt(0) !== "/" || /[\\\u0000-\u001f\u007f]/.test(urlPath)) return null;
    var segments = [];
    var raw = urlPath.split("?")[0].split("#")[0].split("/").filter(function (seg) { return seg.length > 0; });
    for (var i = 0; i < raw.length; i += 1) {
      var seg;
      try {
        seg = decodeURIComponent(raw[i]);
      } catch (err) {
        return null;
      }
      if (!seg || seg.charAt(0) === "." || /[\/\\\u0000-\u001f\u007f]/.test(seg)) return null;
      segments.push(seg);
    }
    if (!segments.length) return null;
    if (SINGLE_PAGE_EXTENSIONS.indexOf(path.extname(segments[segments.length - 1]).toLowerCase()) === -1) return null;
    var file = path.join.apply(path, [folder].concat(segments));
    try {
      var realFolder = fs.realpathSync(folder);
      var realFile = fs.realpathSync(file);
      if (realFile.indexOf(realFolder + path.sep) !== 0) return null;
      if (!fs.statSync(realFile).isFile()) return null;
    } catch (err) {
      return null;
    }
    return file;
  }

  // ---------------------------------------------------------------------------
  // Projects and the worktree candidate
  // ---------------------------------------------------------------------------

  function repoNameAt(dirPath) {
    var marker = path.join(dirPath, ".git");
    var stat;
    try {
      stat = fs.lstatSync(marker);
    } catch (err) {
      return null;
    }
    if (stat.isDirectory()) return path.basename(dirPath);
    if (stat.isFile()) {
      // A worktree's .git file: "gitdir: <repo>/.git/worktrees/<name>".
      try {
        var text = String(readFile(marker, "utf8"));
        var m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
        if (m) {
          var owned = /^(.*)[\\/]\.git[\\/]worktrees[\\/][^\\/]+$/.exec(m[1]);
          if (owned) return path.basename(owned[1]);
        }
      } catch (err) {
        // fall through to the folder's own name
      }
      return path.basename(dirPath);
    }
    return null;
  }

  /** The git project a document belongs to, or null. A worktree's is its owner's. */
  function projectOf(docPath) {
    if (typeof docPath !== "string" || !docPath) return null;
    var wt = WORKTREE.exec(docPath);
    if (wt && repoNameAt(wt[1])) return repoNameAt(wt[1]);
    var current = docPath;
    while (!exists(current)) {
      var up = path.dirname(current);
      if (up === current) return null;
      current = up;
    }
    var stat = statOrNull(current);
    if (stat && !stat.isDirectory()) current = path.dirname(current);
    for (;;) {
      var name = repoNameAt(current);
      if (name) return name;
      var parent = path.dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  }

  /**
   * The main repository's copy of a document whose worktree copy is gone, or
   * null. Every check must pass: under the repository by real path, no hidden
   * segment, owned by the current user, a page by its REAL path's extension (a
   * symlink `x.md` to a `.json` is not a page), and no quote or control
   * character anywhere in it (the path is page-derived and an agent serves it).
   * The real path is what is returned.
   */
  function worktreeCandidate(docPath) {
    if (typeof docPath !== "string" || !docPath || exists(docPath)) return null;
    var wt = WORKTREE.exec(docPath);
    if (!wt || !wt[2]) return null;
    var repo = wt[1];
    var rest = wt[2];
    if (hasHiddenSegment(rest)) return null;
    var candidate = path.join(repo, rest);
    if (UNSAFE_PATH_CHARS.test(candidate)) return null;
    var realRepo;
    var realCandidate;
    try {
      realRepo = fs.realpathSync(repo);
      realCandidate = fs.realpathSync(candidate);
    } catch (err) {
      return null;
    }
    if (realCandidate.indexOf(realRepo + path.sep) !== 0) return null;
    if (hasHiddenSegment(path.relative(realRepo, realCandidate))) return null;
    if (UNSAFE_PATH_CHARS.test(realCandidate)) return null;
    if (PAGE_EXTENSIONS.indexOf(path.extname(realCandidate).toLowerCase()) === -1) return null;
    var stat = statOrNull(realCandidate);
    if (!stat || !stat.isFile()) return null;
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) return null;
    return realCandidate;
  }

  function pathHint(folderPath) {
    if (typeof folderPath !== "string" || !folderPath) return null;
    if (folderPath === home) return "~";
    if (folderPath.indexOf(home + path.sep) === 0) return "~" + folderPath.slice(home.length);
    return folderPath;
  }

  // ---------------------------------------------------------------------------
  // One review
  // ---------------------------------------------------------------------------

  function parseEvents(text) {
    var events = [];
    String(text).split("\n").forEach(function (line) {
      if (!line.trim()) return;
      try {
        var event = JSON.parse(line);
        if (event && typeof event === "object") events.push(event);
      } catch (err) {
        // A torn last line, or a stray one: skipped, as the helper's reader does.
      }
    });
    return events;
  }

  /** What a projection says about a review, and nothing else (no comment text). */
  function summaryOf(projected) {
    var title = null;
    var pages = [];
    var waiting = 0;
    var total = 0;
    (projected.pages || []).forEach(function (page) {
      if (!title && typeof page.title === "string" && page.title.trim()) title = page.title.trim();
      if (!pages.some(function (p) { return p.path === page.path; })) {
        pages.push({ title: typeof page.title === "string" && page.title ? page.title : null, path: page.path });
      }
      (page.items || []).forEach(function (item) {
        total += 1;
        if (record.isUnansweredReady(item)) waiting += 1;
      });
    });
    var review = projected.review || {};
    return {
      title: title,
      pages: pages,
      waiting: waiting,
      total: total,
      ended: !!review.ended_at,
      agent_session_id: typeof review.agent_session_id === "string" ? review.agent_session_id : null
    };
  }

  function readReview(reviewId) {
    var info = { id: reviewId, unreadable: false };

    var meta = null;
    try {
      var gotMeta = cachedJson(stateDir.metaPath(dir, reviewId));
      if (gotMeta.state === "ok") meta = gotMeta.value;
      else info.unreadable = true;
    } catch (err) {
      info.unreadable = true;
    }

    var eventsFile = stateDir.eventsPath(dir, reviewId);
    var reviewFile = stateDir.reviewJsonPath(dir, reviewId);
    var eventsStat = statOrNull(eventsFile);
    var rj = cached(reviewFile, function (text) {
      var value = JSON.parse(text);
      if (!value || typeof value !== "object" || !Array.isArray(value.pages)) throw new Error("not a review.json");
      return summaryOf(value);
    });
    if (rj.state === "bad") info.unreadable = true;

    var createdMs = meta && typeof meta.created_at === "string" ? Date.parse(meta.created_at) : NaN;
    info.createdMs = Number.isNaN(createdMs) ? null : createdMs;
    info.lastMs = eventsStat ? eventsStat.mtimeMs : info.createdMs !== null ? info.createdMs : 0;
    if (eventsStat) {
      var pastOrigins = lastPastOriginEvents(eventsFile, eventsStat);
      if (pastOrigins !== null) info.lastMs = pastOrigins;
    }

    var summary = null;
    var countsAsOf = null;
    var logIsNewer = eventsStat && (rj.state !== "ok" || eventsStat.mtimeMs > rj.stat.mtimeMs);
    if (logIsNewer && eventsStat.size <= CATALOG.REPROJECT_MAX_BYTES) {
      var projected = cached(eventsFile, function (text) {
        return summaryOf(projection.project(reviewId, parseEvents(text)));
      });
      if (projected.state === "ok") {
        summary = projected.value;
        countsAsOf = info.lastMs;
      }
    }
    if (!summary && rj.state === "ok") {
      summary = rj.value;
      countsAsOf = logIsNewer ? rj.stat.mtimeMs : info.lastMs;
    }
    info.summary = summary || { title: null, pages: [], waiting: 0, total: 0, ended: false, agent_session_id: null };
    info.countsAsOfMs = summary ? countsAsOf : null;

    var sessionId = meta
      ? typeof meta.agent_session_id === "string" && meta.agent_session_id ? meta.agent_session_id : LEGACY
      : info.summary.agent_session_id || LEGACY;
    info.sessionId = protocol.isSafeId(sessionId) ? sessionId : LEGACY;

    info.servedPath = meta && typeof meta.target_path === "string" && meta.target_path ? meta.target_path : null;
    var source = meta && typeof meta.source_path === "string" && meta.source_path ? meta.source_path : null;
    info.docPath = source || info.servedPath;
    info.origins = meta && Array.isArray(meta.origins)
      ? meta.origins.filter(function (o) { return typeof o === "string" && /^https?:\/\//.test(o); })
      : [];
    return info;
  }

  /**
   * The review's dev server origin, or null. A registered http origin no static
   * server record of this session serves (by port), on a target LAHE would not
   * serve itself: a folder or a non-page file, or no target at all. A page file
   * with no covering record is a static review whose record was lost.
   */
  function devServerOrigin(info, servers) {
    if (info.servedPath) {
      var stat = statOrNull(info.servedPath);
      if (stat && stat.isFile() && PAGE_EXTENSIONS.indexOf(path.extname(info.servedPath).toLowerCase()) !== -1) return null;
    }
    var staticPorts = (servers.records || []).map(function (meta) { return String(meta.port); });
    for (var i = 0; i < info.origins.length; i += 1) {
      var port;
      try {
        var url = new URL(info.origins[i]);
        port = url.port || (url.protocol === "https:" ? "443" : "80");
      } catch (err) {
        continue;
      }
      if (staticPorts.indexOf(port) === -1) return info.origins[i];
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Every row
  // ---------------------------------------------------------------------------

  function reviewIds() {
    var root = stateDir.reviewsRoot(dir);
    var entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      return [];
    }
    return entries
      .filter(function (entry) { return entry.isDirectory() && protocol.isSafeId(entry.name); })
      .map(function (entry) { return entry.name; })
      .sort();
  }

  function placeRow(info, sessionState, servers) {
    var docOnDisk = exists(info.docPath);
    var covering = info.servedPath && info.sessionId !== LEGACY ? coveringRecord(servers.records, info.servedPath) : null;
    if (covering) covering = { meta: covering.meta, urlPath: openPathOf(info, covering) };
    var kind;
    var openable;
    var candidate = null;
    var devOrigin = null;
    var recordLost = false;
    // dev-server only on a registered origin no static record serves. A
    // review with no covering record and no such origin is a static review
    // whose record was lost: static, and unreadable. `lahe add` script-line
    // reviews have no session.
    if (info.sessionId === LEGACY) kind = "legacy";
    else if (covering) kind = "static";
    else if ((devOrigin = devServerOrigin(info, servers))) kind = "dev-server";
    else {
      kind = "static";
      recordLost = true;
    }

    if (!info.docPath) {
      // No path on record: a dev server named only by its origin, or a review
      // whose meta.json cannot be read, which has nothing left to open.
      openable = info.unreadable ? "missing" : "via-agent";
    } else if (docOnDisk) {
      openable = covering ? "yes" : "via-agent";
    } else {
      candidate = worktreeCandidate(info.docPath);
      if (candidate) {
        kind = "worktree";
        openable = "via-agent";
      } else {
        openable = "missing";
      }
    }

    var unreadable = info.unreadable || sessionState === "bad" || (servers.bad && !covering) || recordLost;
    return {
      info: info,
      kind: kind,
      origin: kind === "dev-server" ? devOrigin : null,
      openable: openable,
      candidate: candidate,
      covering: covering,
      unreadable: unreadable
    };
  }

  function foldable(placed) {
    var info = placed.info;
    if (info.unreadable || info.createdMs === null || info.createdMs >= FOLD_CUTOFF_MS) return false;
    if (!info.docPath) return false;
    if (SINGLE_PAGE_EXTENSIONS.indexOf(path.extname(info.docPath).toLowerCase()) === -1) return false;
    var stat = statOrNull(info.docPath);
    return !stat || stat.isFile();
  }

  function newestFirst(a, b) {
    if (a.info.lastMs !== b.info.lastMs) return b.info.lastMs - a.info.lastMs;
    if ((a.info.createdMs || 0) !== (b.info.createdMs || 0)) return (b.info.createdMs || 0) - (a.info.createdMs || 0);
    return a.info.id < b.info.id ? 1 : -1;
  }

  /** Group placed reviews into rows: old per-page reviews fold by folder. */
  function foldSession(placedList) {
    var groups = Object.create(null);
    var rows = [];
    placedList.forEach(function (placed) {
      if (!foldable(placed)) {
        rows.push({ parts: [placed] });
        return;
      }
      var key = path.dirname(placed.info.docPath);
      (groups[key] = groups[key] || []).push(placed);
    });
    Object.keys(groups).forEach(function (key) {
      var parts = groups[key];
      if (parts.length < 2) rows.push({ parts: parts });
      else rows.push({ parts: parts.slice().sort(newestFirst), folder: key });
    });
    rows.forEach(function (row) {
      row.parts.sort(newestFirst);
      row.lead = row.parts[0];
    });
    return rows;
  }

  function scan(nowMs) {
    var starsRead = store.read();
    var stars = starsRead.ok ? starsRead.data.stars : {};
    var sessionCache = Object.create(null);
    function sessionContext(sessionId) {
      if (!sessionCache[sessionId]) {
        sessionCache[sessionId] = {
          state: readSession(sessionId).state,
          servers: serversOf(sessionId)
        };
      }
      return sessionCache[sessionId];
    }

    var bySession = Object.create(null);
    reviewIds().forEach(function (reviewId) {
      var info = readReview(reviewId);
      var ctx = sessionContext(info.sessionId);
      (bySession[info.sessionId] = bySession[info.sessionId] || []).push(placeRow(info, ctx.state, ctx.servers));
    });

    var sessions = Object.keys(bySession).map(function (sessionId) {
      return {
        id: sessionId,
        state: sessionContext(sessionId).state,
        rows: foldSession(bySession[sessionId])
      };
    });

    // Titles and display names, across the whole list.
    var allRows = [];
    sessions.forEach(function (s) {
      s.rows.forEach(function (row) {
        var lead = row.lead.info;
        row.title = row.folder ? path.basename(row.folder) : lead.summary.title;
        row.file = row.folder ? null : lead.docPath ? path.basename(lead.docPath) : null;
        var folderPath = row.folder || (lead.docPath ? path.dirname(lead.docPath) : null);
        row.folderName = folderPath ? path.basename(folderPath) : null;
        row.pathHint = pathHint(folderPath);
        allRows.push(row);
      });
    });
    var titleCount = Object.create(null);
    allRows.forEach(function (row) {
      if (row.title) titleCount[row.title] = (titleCount[row.title] || 0) + 1;
    });
    allRows.forEach(function (row) {
      if (row.title && titleCount[row.title] === 1) row.displayName = row.title;
      else if (row.file) row.displayName = (row.folderName ? row.folderName + " / " : "") + row.file;
      else row.displayName = row.title || row.folderName || row.lead.info.id;
      row.starred = row.parts.some(function (p) { return Object.prototype.hasOwnProperty.call(stars, p.info.id); });
    });

    return { sessions: sessions, notice: starsRead.ok ? null : starsRead.code, nowMs: nowMs };
  }

  // ---------------------------------------------------------------------------
  // Probes
  // ---------------------------------------------------------------------------

  var probeCache = Object.create(null);

  function probeOnce(meta, nowMs) {
    var key = meta.id + "|" + meta.instance + "|" + meta.port + "|" + meta.pid + "|" + meta.started_at;
    var hit = probeCache[key];
    if (hit && nowMs - hit.at < CATALOG.POLL_MS) return hit.answer;
    var answer = Promise.resolve()
      .then(function () { return probe(meta); })
      .then(function (ok) { return ok === true; }, function () { return false; });
    probeCache[key] = { at: nowMs, answer: answer };
    return answer;
  }

  // ---------------------------------------------------------------------------
  // The response
  // ---------------------------------------------------------------------------

  function requestOf(reviewId, nowMs, lookup) {
    var r = lookup(reviewId);
    if (!r || typeof r !== "object") return null;
    var answered = typeof r.answered_at === "string" && r.answered_at ? r.answered_at : null;
    if ((r.state === "done" || r.state === "refused") && answered) {
      if (nowMs - Date.parse(answered) >= CATALOG.ANSWER_SHOWN_MS) return null;
    }
    // The queue's requestsAt (Library 1.4) has already named the agent
    // (`by_name`, its name or its id).
    return {
      id: r.id,
      action: r.action,
      at: r.at,
      state: r.state,
      by_name: typeof r.by_name === "string" && r.by_name ? r.by_name : null,
      text: typeof r.text === "string" ? r.text : null,
      answered_at: answered,
      // Why an expired request expired (attach_changed, monitor_dead,
      // timeout), so the page can say which; null in every other state.
      reason: r.state === "expired" && typeof r.reason === "string" ? r.reason : null
    };
  }

  function attachedOf(nowMs) {
    var a = attachment(nowMs);
    if (!a || typeof a.session !== "string" || !protocol.isSafeId(a.session) || a.session === LEGACY) return null;
    // The queue's readAttached (Library 1.4) answers null for an attach with no
    // session behind it, and `watching` with the same liveness rule it uses to
    // hand out and expire requests. Taking its answer keeps the header and
    // Open from disagreeing.
    return { session: a.session, name: nameOf(a.session), watching: a.watching === true };
  }

  function rowOut(row, nowMs, servedUrl, lookup) {
    var lead = row.lead;
    var info = lead.info;
    var waiting = 0;
    var total = 0;
    // Counts are as of the row's `last` unless a part's are stale; then the
    // oldest stale part's time, so the page says so.
    var asOf = info.countsAsOfMs;
    var stalest = null;
    var pages = [];
    row.parts.forEach(function (p) {
      waiting += p.info.summary.waiting;
      total += p.info.summary.total;
      var partAsOf = p.info.countsAsOfMs;
      if (partAsOf !== null && partAsOf < p.info.lastMs && (stalest === null || partAsOf < stalest)) stalest = partAsOf;
      p.info.summary.pages.forEach(function (page) {
        if (!pages.some(function (q) { return q.path === page.path; })) pages.push(page);
      });
    });
    if (stalest !== null) asOf = stalest;
    return {
      id: info.id,
      title: row.title,
      display_name: row.displayName,
      file: row.file,
      folder: row.folderName,
      path_hint: row.pathHint,
      project: projectOf(row.folder || info.docPath),
      last: iso(info.lastMs),
      waiting: waiting,
      total: total,
      counts_as_of: asOf === null ? null : iso(asOf),
      ended: info.summary.ended,
      served_url: servedUrl || null,
      openable: lead.openable,
      kind: lead.kind,
      starred: row.starred,
      unreadable: row.parts.some(function (p) { return p.unreadable; }),
      request: requestOf(info.id, nowMs, lookup),
      pages: pages,
      folded_from: row.parts.slice(1).map(function (p) { return p.info.id; }).sort()
    };
  }

  /**
   * The catalog.list response.
   *
   * @param {number|string} now
   * @returns {Promise<object>}
   */
  async function list(now) {
    var nowMs = toMs(now);
    var scanned = scan(nowMs);

    var jobs = [];
    scanned.sessions.forEach(function (s) {
      s.rows.forEach(function (row) {
        var cover = row.lead.covering;
        row.served = null;
        if (row.lead.openable !== "yes" || !cover || cover.meta.stopped_at) return;
        jobs.push(probeOnce(cover.meta, nowMs).then(function (ok) {
          if (ok) row.served = "http://" + protocol.DEFAULT_HOST + ":" + cover.meta.port + cover.urlPath;
        }));
      });
    });
    await Promise.all(jobs);

    // The request queue is read once per list, not once per row.
    var lookup = requestsAt
      ? requestsAt(nowMs)
      : function (reviewId) { return requestFor(reviewId, nowMs); };
    var sessions = scanned.sessions.map(function (s) {
      var reviews = s.rows
        .map(function (row) { return rowOut(row, nowMs, row.served, lookup); })
        .sort(function (a, b) { return a.last < b.last ? 1 : a.last > b.last ? -1 : a.id < b.id ? 1 : -1; });
      var projects = [];
      reviews.forEach(function (r) {
        if (r.project && projects.indexOf(r.project) === -1) projects.push(r.project);
      });
      return {
        id: s.id,
        name: s.state === "ok" ? nameOf(s.id) : null,
        name_from_page: s.state === "ok" && nameFromPage(s.id),
        projects: projects.sort(),
        watching: watchingOf(s.id, nowMs),
        last: reviews.length ? reviews[0].last : null,
        reviews: reviews
      };
    });
    sessions.sort(function (a, b) {
      if (a.last !== b.last) return a.last < b.last ? 1 : -1;
      return a.id < b.id ? -1 : 1;
    });

    return {
      attached: attachedOf(nowMs),
      notice: scanned.notice,
      sessions: sessions
    };
  }

  /**
   * One review, for the drain and for `lahe session name --from-review`.
   *
   * @param {string} reviewId
   * @param {number|string} [now]
   * @returns {{review: string, session: string, display_name: string, title: string|null,
   *            path: string|null, kind: string, openable: string, candidate: string|null,
   *            server: string|null, url_path: string|null, served_path: string|null,
   *            watching: object|null, last: string, fold: string[]}|null}
   *   `display_name` is the name of the row the review shows on (a folded
   *   review's is its folder's). `path` is the document's own path on disk.
   *   `candidate` is the checked main-repository copy for a gone worktree.
   *   For Open (Library 2.1): `server` is the id of the recorded server that
   *   covers the review's served file, `server_root` that record's root, and
   *   `url_path` that file's path on it (all null when none does); `served_path` is the file itself, `watching`
   *   the session's watcher as the list shows it, and `last` the review's own
   *   newest event time. `fold` is every review on the same row, this one
   *   included (just this one for a row that is not a fold), so Star can act
   *   on the whole row the way the list reads it.
   */
  function describeReview(reviewId, now) {
    if (!protocol.isSafeId(reviewId)) return null;
    var nowMs = toMs(now);
    var scanned = scan(nowMs);
    for (var i = 0; i < scanned.sessions.length; i += 1) {
      var s = scanned.sessions[i];
      for (var j = 0; j < s.rows.length; j += 1) {
        var row = s.rows[j];
        for (var k = 0; k < row.parts.length; k += 1) {
          var part = row.parts[k];
          if (part.info.id !== reviewId) continue;
          return {
            review: reviewId,
            session: s.id,
            display_name: row.displayName,
            title: part.info.summary.title,
            path: part.info.docPath,
            kind: part.kind,
            openable: part.openable,
            candidate: part.candidate,
            origin: part.origin,
            server: part.covering ? part.covering.meta.id : null,
            server_root: part.covering && typeof part.covering.meta.root === "string" ? part.covering.meta.root : null,
            url_path: part.covering ? part.covering.urlPath : null,
            served_path: part.info.servedPath,
            watching: watchingOf(s.id, nowMs),
            last: iso(part.info.lastMs),
            fold: row.parts.map(function (p) { return p.info.id; }).sort()
          };
        }
      }
    }
    return null;
  }

  return {
    list: list,
    describeReview: describeReview
  };
}

/**
 * The reader's two inputs from the request queue (Library 1.4), spelled once so
 * the helper and the tests wire them the same way.
 *
 * @param {object} queue a catalog_requests.createQueue
 */
function queueInputs(queue) {
  return {
    attachment: queue.readAttached,
    requestFor: queue.requestFor,
    requestsAt: queue.requestsAt
  };
}

module.exports = {
  createReader: createReader,
  queueInputs: queueInputs
};
