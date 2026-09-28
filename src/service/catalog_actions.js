// The Library's actions: what catalog.list, open, star and request do once the
// check block has passed them, and the reopened-session sweep.
//
// Owner: LAHE Library 2.1. Architecture: docs/features/20260922.02_lahe_library/
// 02_architecture_lahe_library.md, "Key Flows" (Open, Star, Launch), "Helper
// lifetime (R10a)" and "The log line".
//
// WIRING, NOT NEW RULES. Every rule here already has one home, and this module
// only joins them:
//
//   the list, and what a review is            catalog_reader (1.1)
//   stars and the reopened map                catalog_store (1.1)
//   the request queue and the attached agent  catalog_requests (1.4)
//   restarting one server, closing quietly    static_servers.createCatalogOps (1.3)
//   is a monitor live                         agent_sessions.livenessFrom
//
// OPEN SERVES NOTHING NEW. It restarts the recorded server that already covers
// the review's recorded file (describeReview's `server`), and builds the URL
// from that server's own origin and the path the coverage rule gave. Nothing
// in the request body names a file, a root or a URL; extra fields are never
// read. A review no recorded server covers is the agent's to re-serve.
//
// EVERY CLOCK IS `now`. Each function takes the time as an argument, and the
// helper passes its own clock, so tests drive expiry, the sweep and the log
// line's age without sleeping.
//
// Only the four actions write a line that starts with `catalog`; every other
// line this module logs starts with "Library", so the count script never
// mistakes one for an Open.
//
// Each function returns a handler outcome: {status, body}, or {error: {code,
// detail}} with the status protocol.statusFor gives that code.
//
// Node-only.

"use strict";

var fs = require("node:fs");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");
var agentSessions = require("./agent_sessions.js");
var reviewsModule = require("./reviews.js");
var catalogRequests = require("./catalog_requests.js");

var C = protocol.CATALOG;
var DAY_MS = 24 * 60 * 60 * 1000;
var ACTION = catalogRequests.ACTION;

// Why no agent was asked, on an Open that still opened.
var NOT_ASKED = { NO_AGENT: "no_agent", QUEUE_FULL: "queue_full", REQUEST_PENDING: "request_pending" };

function iso(ms) {
  return new Date(ms).toISOString();
}

function fail(code, detail) {
  return { status: protocol.statusFor(code), error: { code: code, detail: detail === undefined ? null : detail } };
}

function badRequest(detail) {
  return { status: 400, error: { code: "PROTO_BAD_REQUEST", detail: detail } };
}

/**
 * @param {{dir: string, reader: object, queue: object, store: object, ops: object,
 *          sessions: object, log: function(string, number), pidAlive?: function,
 *          uid?: number|null}} options
 *   `reader` is catalog_reader.createReader, wired to `queue`. `ops` is
 *   static_servers.createCatalogOps. `log(line, nowMs)` writes one helper log
 *   line stamped at `nowMs`. `uid` is the user a recorded file must belong to
 *   (the current one by default; tests pass another to prove the refusal,
 *   since chown needs root). `statFile` is fs.statSync unless a test passes
 *   one that reports a chosen owner per path.
 */
function createCatalogActions(options) {
  var opts = options || {};
  ["dir", "reader", "queue", "store", "ops", "sessions", "log"].forEach(function (key) {
    if (!opts[key]) throw new Error("catalog_actions.createCatalogActions: " + key + " is required");
  });
  var dir = opts.dir;
  var reader = opts.reader;
  var queue = opts.queue;
  var store = opts.store;
  var ops = opts.ops;
  var sessions = opts.sessions;
  var log = opts.log;
  var pidAlive = typeof opts.pidAlive === "function" ? opts.pidAlive : agentSessions.pidAlive;
  var uid = typeof opts.uid === "number" ? opts.uid : typeof process.getuid === "function" ? process.getuid() : null;
  var statFile = typeof opts.statFile === "function" ? opts.statFile : fs.statSync;

  // -------------------------------------------------------------------------
  // Shared steps
  // -------------------------------------------------------------------------

  // ONE OPEN AT A TIME PER SERVER RECORD (fix round CR1). Two Opens on a
  // closed session would each see the record stopped and each spawn a server:
  // one is orphaned, and the second origin swap drops the first tab's origin.
  // So the restart step runs in a chain per "<session> <server>", and the
  // second Open finds the first one's server already up. `openingSessions`
  // counts the Opens in flight per session, so the sweep never closes a
  // session an Open is part way through bringing back.
  var openChains = Object.create(null);
  var openingSessions = Object.create(null);

  function oneAtATime(sessionId, serverId, fn) {
    var key = sessionId + " " + serverId;
    var prior = openChains[key] || Promise.resolve();
    openingSessions[sessionId] = (openingSessions[sessionId] || 0) + 1;
    var run = prior.then(fn);
    var tail = run.then(function () {}, function () {});
    openChains[key] = tail;
    return run.finally(function () {
      if (openChains[key] === tail) delete openChains[key];
      openingSessions[sessionId] -= 1;
      if (openingSessions[sessionId] <= 0) delete openingSessions[sessionId];
    });
  }

  /** One `catalog` line, in the format protocol.js spells. */
  function logAction(action, described, nowMs) {
    var lastMs = described && described.last ? Date.parse(described.last) : NaN;
    var age = Number.isNaN(lastMs) ? 0 : Math.max(0, Math.floor((nowMs - lastMs) / DAY_MS));
    log(protocol.catalogLogLine(action, described.review, age), nowMs);
  }

  function describe(body, nowMs) {
    var review = body && body.review;
    if (!protocol.isSafeId(review)) return { outcome: badRequest("review must be a review id") };
    var described = reader.describeReview(review, nowMs);
    if (!described) return { outcome: fail("PROTO_NOT_OPENABLE", "unknown review") };
    return { described: described };
  }

  /** The attached agent, when it is live; null otherwise. */
  function liveAgent(nowMs) {
    var attached = queue.readAttached(nowMs);
    return attached && attached.watching === true ? attached : null;
  }

  /**
   * Another agent is watching the document's session (R12b): the hand-over
   * would move it and stop that agent, so it needs the reviewer's say-so.
   */
  function watchedByAnother(described, agent) {
    return !!(described.watching && agent && described.watching.session !== agent.session);
  }

  /**
   * Does the attached agent already have this document (story walk)? It owns
   * the document's session, or it is the one watching it. A pick-up would ask
   * it for what it already has, so Open just opens.
   */
  function alreadyTheirs(described, agent) {
    if (!agent) return false;
    if (described.session === agent.session) return true;
    return !!(described.watching && described.watching.session === agent.session);
  }

  /** Queue a request, turning the queue's refusal into a protocol code. */
  function enqueue(action, described, agent, nowMs) {
    var appended = queue.append(
      { action: action, review: described.review, session: described.session, for: agent.session },
      nowMs
    );
    if (appended.ok) return { ok: true, request: appended.request };
    if (appended.code === "PROTO_REQUEST_PENDING" || appended.code === "PROTO_QUEUE_FULL") {
      return { ok: false, code: appended.code };
    }
    return { ok: false, code: "PROTO_BAD_REQUEST", detail: appended.message || "the request could not be queued" };
  }

  /**
   * Is every recorded file of this review, and the root of the server record
   * Open would restart, on disk and owned by the current user? The restarted
   * server serves everything under that root, so the root is checked too. A
   * record with no root, or a file that is not on disk, is not openable: there
   * is nothing to check it against.
   */
  function ownedByUser(described) {
    if (typeof described.server_root !== "string" || !described.server_root) return false;
    var files = [described.served_path, described.path, described.server_root].filter(function (file, i, all) {
      return typeof file === "string" && file && all.indexOf(file) === i;
    });
    return files.every(function (file) {
      var stat;
      try {
        stat = statFile(file);
      } catch (err) {
        return false;
      }
      return uid === null || stat.uid === uid;
    });
  }

  // -------------------------------------------------------------------------
  // The routes
  // -------------------------------------------------------------------------

  /** catalog.list: the reader's list, already joined with the queue. */
  async function list(nowMs) {
    var body = await reader.list(nowMs);
    // The state directory when it is not the default one, else null, so the
    // Library's hand-off message can name it in the takeover command.
    body.state_dir = stateDir.flagFor(dir);
    return { status: 200, body: body };
  }

  /**
   * catalog.open, body {review, handoff, confirmed}.
   *
   * @returns {Promise<object>} body {url, request_id, not_asked}; `url` is null
   *   for a via-agent row, whose Open is the pick-up itself.
   */
  async function open(body, nowMs) {
    var found = describe(body, nowMs);
    if (found.outcome) return found.outcome;
    var d = found.described;
    var handoff = body.handoff === true;
    var confirmed = body.confirmed === true;

    if (d.openable === "missing") return fail("PROTO_NOT_OPENABLE", "missing");

    if (d.openable !== "yes" || !d.server || !d.url_path) {
      // No recorded server covers it. Only an agent can re-serve it, and only
      // when the reviewer asked for the hand-over.
      if (!handoff) return fail("PROTO_NOT_OPENABLE", "via-agent: no recorded server serves this review");
      var viaAgent = liveAgent(nowMs);
      if (!viaAgent) return fail("PROTO_NO_AGENT");
      if (watchedByAnother(d, viaAgent) && !confirmed) return fail("PROTO_CONFIRM_NEEDED");
      var queuedVia = enqueue(ACTION.PICKUP, d, viaAgent, nowMs);
      if (!queuedVia.ok) return fail(queuedVia.code, queuedVia.detail);
      logAction(protocol.CATALOG_LOG.ACTION.OPEN, d, nowMs);
      return { status: 200, body: { url: null, request_id: queuedVia.request.id, not_asked: null } };
    }

    if (!ownedByUser(d)) return fail("PROTO_NOT_OPENABLE", "not owned by the current user, or not on disk");

    // The confirm step comes before anything starts: a refused hand-over must
    // not have restarted a server behind the reviewer's back.
    var agent = handoff ? liveAgent(nowMs) : null;
    if (handoff && agent && watchedByAnother(d, agent) && !confirmed) return fail("PROTO_CONFIRM_NEEDED");

    var restart = await oneAtATime(d.session, d.server, async function () {
      var before = sessions.read(d.session);
      var wasClosed = !!(before && before.closed_at);
      if (wasClosed) {
        // The Library is about to reopen it, so the sweep may close it again
        // once it goes quiet. A session that was already open is somebody
        // else's. RECORDED FIRST: a reopen the sweep cannot see is a session
        // left open for good, so a catalog.json that cannot take the record
        // refuses the Open before anything is reopened or started.
        var saved = store.setReopened(d.session, { at: iso(nowMs), handoff_rev: agentSessions.handoffRev(before) });
        if (!saved.ok) {
          log("Library Open of review " + d.review + " refused: session " + d.session +
            " is closed and its reopen could not be recorded: " + saved.code, nowMs);
          return { ok: false, outcome: fail(saved.code || "PROTO_CATALOG_UNREADABLE") };
        }
      }
      var restarted;
      try {
        // Starts the server before it reopens the session, so a failed start
        // leaves the session closed.
        restarted = await ops.reopenForCatalog(d.session, d.server, d.review);
      } catch (err) {
        if (wasClosed) store.clearReopened(d.session);
        log("Library Open of review " + d.review + " could not restart its server: " + err.message, nowMs);
        return { ok: false, outcome: fail("PROTO_NOT_OPENABLE", "the recorded server could not be restarted") };
      }
      return { ok: true, value: restarted };
    });
    if (!restart.ok) return restart.outcome;
    var reopened = restart.value;

    var requestId = null;
    var notAsked = null;
    if (handoff) {
      if (!agent) {
        notAsked = NOT_ASKED.NO_AGENT;
      } else if (!alreadyTheirs(d, agent)) {
        var queued = enqueue(ACTION.PICKUP, d, agent, nowMs);
        if (queued.ok) requestId = queued.request.id;
        else if (queued.code === "PROTO_QUEUE_FULL") notAsked = NOT_ASKED.QUEUE_FULL;
        else if (queued.code === "PROTO_REQUEST_PENDING") notAsked = NOT_ASKED.REQUEST_PENDING;
        else notAsked = NOT_ASKED.NO_AGENT;
      }
      // else the attached agent already owns or watches it: nothing to ask.
    }
    logAction(protocol.CATALOG_LOG.ACTION.OPEN, d, nowMs);
    return { status: 200, body: { url: reopened.origin + d.url_path, request_id: requestId, not_asked: notAsked } };
  }

  /** catalog.star, body {review, starred}. */
  async function star(body, nowMs) {
    var found = describe(body, nowMs);
    if (found.outcome) return found.outcome;
    if (typeof body.starred !== "boolean") return badRequest("starred must be true or false");
    var d = found.described;
    // EVERY REVIEW IN THE FOLD (fix round CR2). The list shows a folded row as
    // starred when any part is, so a star or unstar on the lead alone would
    // stick the moment another part became the lead.
    var ids = Array.isArray(d.fold) && d.fold.length ? d.fold : [d.review];
    for (var i = 0; i < ids.length; i += 1) {
      var written = store.setStar(ids[i], body.starred, iso(nowMs));
      if (!written.ok) return fail(written.code || "PROTO_CATALOG_UNREADABLE");
    }
    logAction(body.starred ? protocol.CATALOG_LOG.ACTION.STAR : protocol.CATALOG_LOG.ACTION.UNSTAR, d, nowMs);
    return { status: 200, body: { review: d.review, starred: body.starred } };
  }

  /**
   * catalog.request, body {review, action, confirmed}. Ids only: nothing else
   * in the body is read, so nothing else can reach the queue.
   */
  async function request(body, nowMs) {
    var found = describe(body, nowMs);
    if (found.outcome) return found.outcome;
    var action = body.action;
    if (catalogRequests.ACTIONS.indexOf(action) === -1) {
      return badRequest("action must be one of " + catalogRequests.ACTIONS.join(", "));
    }
    var d = found.described;
    // A missing review has nothing an agent could open, so it is refused here
    // exactly as Open refuses it.
    if (d.openable === "missing") return fail("PROTO_NOT_OPENABLE", "missing");
    var agent = liveAgent(nowMs);
    if (!agent) return fail("PROTO_NO_AGENT");
    // A pick-up of a served document the attached agent already has asks for
    // nothing. A via-agent row still needs re-serving, so it is still asked.
    if (action === ACTION.PICKUP && d.openable === "yes" && alreadyTheirs(d, agent)) {
      return { status: 200, body: { request_id: null } };
    }
    if (watchedByAnother(d, agent) && body.confirmed !== true) return fail("PROTO_CONFIRM_NEEDED");
    var queued = enqueue(action, d, agent, nowMs);
    if (!queued.ok) return fail(queued.code, queued.detail);
    logAction(action === ACTION.LAUNCH ? protocol.CATALOG_LOG.ACTION.LAUNCH : protocol.CATALOG_LOG.ACTION.PICKUP, d, nowMs);
    return { status: 200, body: { request_id: queued.request.id } };
  }

  // -------------------------------------------------------------------------
  // The reopened-session sweep
  // -------------------------------------------------------------------------

  /** The reviews a session owns, read off their meta.json files. */
  function reviewsOf(sessionId) {
    var root;
    try {
      root = stateDir.reviewsRoot(dir);
    } catch (err) {
      return [];
    }
    var names;
    try {
      names = fs.readdirSync(root);
    } catch (err) {
      return [];
    }
    return names.filter(function (reviewId) {
      if (!protocol.isSafeId(reviewId)) return false;
      try {
        var meta = JSON.parse(fs.readFileSync(stateDir.metaPath(dir, reviewId), "utf8"));
        return meta && meta.agent_session_id === sessionId;
      } catch (err) {
        return false;
      }
    });
  }

  function monitorLive(sessionId, session, nowMs) {
    var liveness = agentSessions.livenessFrom({
      session: session,
      monitor: sessions.readMonitor(sessionId),
      activity: null,
      nowMs: nowMs,
      pidAlive: pidAlive
    });
    return liveness[protocol.AGENT_LIVENESS.FIELD.LISTENING] === true;
  }

  /**
   * Close each Library-reopened session once it has been quiet for
   * REOPENED_AUTOCLOSE_MS: nothing since the reopen, and no window of any of
   * its reviews held in that time. Left alone:
   *
   *   - a session reopened with `lahe session reopen` (it is not in the map)
   *   - a session taken over since (its handoff_rev moved past the recorded
   *     one); its entry is dropped, since it is an agent's now
   *   - a session whose monitor is live, or that an Open is bringing back
   *
   * A closed session's entry is cleared, whoever closed it.
   *
   * @returns {Promise<{closed: string[], kept: string[], cleared: string[]}>}
   */
  async function sweepReopened(nowMs) {
    var out = { closed: [], kept: [], cleared: [] };
    var read = store.read();
    if (!read.ok) return out;
    var holders = reviewsModule.readLiveHolders(dir, C.REOPENED_AUTOCLOSE_MS, nowMs);
    var ids = Object.keys(read.data.reopened);
    for (var i = 0; i < ids.length; i += 1) {
      var sessionId = ids[i];
      var entry = read.data.reopened[sessionId] || {};
      var session = null;
      try {
        session = sessions.read(sessionId);
      } catch (err) {
        session = null;
      }
      if (!session || session.closed_at) {
        store.clearReopened(sessionId);
        out.cleared.push(sessionId);
        continue;
      }
      if (agentSessions.handoffRev(session) > (Number.isInteger(entry.handoff_rev) ? entry.handoff_rev : 0)) {
        store.clearReopened(sessionId);
        out.cleared.push(sessionId);
        continue;
      }
      if (openingSessions[sessionId] || monitorLive(sessionId, session, nowMs)) {
        // An Open part way through bringing it back is activity too.
        out.kept.push(sessionId);
        continue;
      }
      var reopenedAt = Date.parse(entry.at);
      var quietSince = Number.isNaN(reopenedAt) ? 0 : reopenedAt;
      var owned = reviewsOf(sessionId);
      holders.forEach(function (holder) {
        if (owned.indexOf(holder.review) !== -1) quietSince = Math.max(quietSince, nowMs - holder.quiet_ms);
      });
      if (nowMs - quietSince < C.REOPENED_AUTOCLOSE_MS) {
        out.kept.push(sessionId);
        continue;
      }
      try {
        await ops.closeQuiet(sessionId);
      } catch (err) {
        log("Library sweep could not close reopened session " + sessionId + ": " + err.message, nowMs);
        out.kept.push(sessionId);
        continue;
      }
      store.clearReopened(sessionId);
      log("Library sweep closed session " + sessionId + ", quiet since the Library reopened it", nowMs);
      out.closed.push(sessionId);
    }
    return out;
  }

  return {
    list: list,
    open: open,
    star: star,
    request: request,
    sweepReopened: sweepReopened
  };
}

module.exports = {
  NOT_ASKED: NOT_ASKED,
  createCatalogActions: createCatalogActions
};
