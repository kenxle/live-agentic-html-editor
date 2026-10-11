// The Library's actions: what catalog.list, open, star and request do once the
// check block has passed them, and the sweep of the Library's own idle sessions.
//
// Owner: LAHE Library 2.1. Architecture: docs/features/20260922.02_lahe_library/
// 02_architecture_lahe_library.md, "Key Flows" (Star, Launch), "Helper
// lifetime (R10a)" and "The log line"; stable addresses, "The Library", for Open.
//
// WIRING, NOT NEW RULES. Every rule here already has one home, and this module
// only joins them:
//
//   the list, and what a review is            catalog_reader (1.1)
//   a review's site, its address, binding it  catalog_sites (stable addresses 4.1)
//   stars and names                           catalog_store (1.1)
//   the request queue and the attached agent  catalog_requests (1.4)
//   is a monitor live                         agent_sessions.livenessFrom
//
// OPEN BINDS A SITE AND SERVES NOTHING NEW. The helper serves every page, so
// Open restarts nothing and reopens no session: it names the document's site in
// the registry if it has none, stamps the review as re-served unless a newer
// review in another open session holds the page's rail, and returns the
// address. Nothing in the request body names a file, a root or a URL; extra
// fields are never read. A root is named only when something a page cannot write
// has already served it (catalog_sites.js, vouched()). A review nothing vouches
// for is the agent's to re-serve.
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
var catalogRequests = require("./catalog_requests.js");
var catalogSites = require("./catalog_sites.js");

var C = protocol.CATALOG;
var DAY_MS = 24 * 60 * 60 * 1000;
var ACTION = catalogRequests.ACTION;

// Why no agent was asked, on an Open that still opened.
var NOT_ASKED = { NO_AGENT: "no_agent", QUEUE_FULL: "queue_full", REQUEST_PENDING: "request_pending" };

function iso(ms) {
  return new Date(ms).toISOString();
}

// Row kinds a new agent cannot be launched on: no session to take over.
var NO_LAUNCH_KINDS = ["legacy", "worktree"];

function fail(code, detail) {
  return { status: protocol.statusFor(code), error: { code: code, detail: detail === undefined ? null : detail } };
}

function badRequest(detail) {
  return { status: 400, error: { code: "PROTO_BAD_REQUEST", detail: detail } };
}

/**
 * @param {{dir: string, reader: object, queue: object, store: object,
 *          sessions: object, log: function(string, number), pages?: object,
 *          pidAlive?: function, uid?: number|null, statFile?: function}} options
 *   `reader` is catalog_reader.createReader, wired to `queue`. `pages` is
 *   catalog_sites.createCatalogSites, over the helper's registry (the default
 *   is a read-only one, which cannot name a site). `log(line,
 *   nowMs)` writes one helper log line stamped at `nowMs`. `uid` is the user a
 *   file Open binds a site over must belong to (the current one by default;
 *   tests pass another to prove the refusal, since chown needs root).
 *   `statFile` is fs.statSync unless a test passes one that reports a chosen
 *   owner per path.
 */
function createCatalogActions(options) {
  var opts = options || {};
  ["dir", "reader", "queue", "store", "sessions", "log"].forEach(function (key) {
    if (!opts[key]) throw new Error("catalog_actions.createCatalogActions: " + key + " is required");
  });
  var dir = opts.dir;
  var reader = opts.reader;
  var queue = opts.queue;
  var store = opts.store;
  var sessions = opts.sessions;
  var log = opts.log;
  var pidAlive = typeof opts.pidAlive === "function" ? opts.pidAlive : agentSessions.pidAlive;
  var uid = typeof opts.uid === "number" ? opts.uid : typeof process.getuid === "function" ? process.getuid() : null;
  var statFile = typeof opts.statFile === "function" ? opts.statFile : fs.statSync;
  var siteTools = opts.pages || catalogSites.readOnly(dir);

  // -------------------------------------------------------------------------
  // Shared steps
  // -------------------------------------------------------------------------

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
   * Is every file Open would bind a site over on disk and
   * owned by the current user? The site serves everything under its root, so
   * the root is checked with the document.
   */
  function siteOwnedByUser(described) {
    var files = [described.path, described.served_path, described.site.root, described.site.file].filter(function (file, i, all) {
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

  /** Is this agent session open? A session the store cannot read is not. */
  function sessionOpen(sessionId) {
    try {
      var record = sessions.read(sessionId);
      return !!record && !record.closed_at;
    } catch (err) {
      return false;
    }
  }

  /**
   * The hand-over half of an Open that opened: queue a pick-up for the
   * attached agent when the reviewer asked for one, and say why none was
   * asked when none was.
   */
  function handOver(d, handoff, agent, nowMs) {
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
    return { requestId: requestId, notAsked: notAsked };
  }

  /**
   * catalog.open for a row the helper can serve itself (stable addresses).
   * Nothing is restarted and no session is reopened: Open names the
   * document's site if it has none, and returns the address.
   *
   * THE RAIL. Stamping the review as re-served is what makes it the one that
   * answers on its page, so it moves the rail. Open therefore does not stamp
   * when another open session's review already holds the page: it goes to the
   * address and says who holds it. A holder in a closed session, or in this
   * row's own session, is not a reason to keep a reviewer from the review
   * they chose.
   */
  async function openSite(d, handoff, confirmed, nowMs) {
    if (!d.site.worktree && !siteOwnedByUser(d)) return fail("PROTO_NOT_OPENABLE", "not owned by the current user, or not on disk");
    // The confirm step comes before anything is named or stamped.
    var agent = handoff ? liveAgent(nowMs) : null;
    if (handoff && agent && watchedByAnother(d, agent) && !confirmed) return fail("PROTO_CONFIRM_NEEDED");

    var url = d.site.address;
    var heldBy = null;
    if (!d.site.worktree) {
      var bound;
      try {
        bound = siteTools.bindPlan(d.site);
      } catch (err) {
        log("Library Open of review " + d.review + " could not name its site: " + err.message, nowMs);
        return fail("PROTO_NOT_OPENABLE", "the document could not be given an address: " + err.message);
      }
      url = siteTools.addressOf(bound.name, d.site.url_path);
      var holder = siteTools.railHolder(bound.site, d.site.file);
      if (holder && holder !== d.review) {
        var other = reader.describeReview(holder, nowMs);
        if (other && other.session !== d.session && sessionOpen(other.session)) {
          heldBy = { review: holder, name: other.display_name || holder };
        }
      }
      if (!heldBy) siteTools.stamp(d.review, nowMs);
    }
    if (!url) return fail("PROTO_NOT_OPENABLE", "the helper is not serving pages");

    var handed = handOver(d, handoff, agent, nowMs);
    logAction(protocol.CATALOG_LOG.ACTION.OPEN, d, nowMs);
    return {
      status: 200,
      body: { url: url, request_id: handed.requestId, not_asked: handed.notAsked, held_by: heldBy }
    };
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
   * @returns {Promise<object>} body {url, request_id, not_asked, held_by}; `url`
   *   is null for a via-agent row, whose Open is the pick-up itself.
   */
  async function open(body, nowMs) {
    var found = describe(body, nowMs);
    if (found.outcome) return found.outcome;
    var d = found.described;
    var handoff = body.handoff === true;
    var confirmed = body.confirmed === true;

    if (d.openable === "missing") return fail("PROTO_NOT_OPENABLE", "missing");

    if (d.openable !== "yes" || !d.site) {
      // Nothing vouches for serving it. Only an agent can re-serve it, and only
      // when the reviewer asked for the hand-over.
      if (!handoff) return fail("PROTO_NOT_OPENABLE", "via-agent: nothing the helper served vouches for this review's document");
      var viaAgent = liveAgent(nowMs);
      if (!viaAgent) return fail("PROTO_NO_AGENT");
      if (watchedByAnother(d, viaAgent) && !confirmed) return fail("PROTO_CONFIRM_NEEDED");
      var queuedVia = enqueue(ACTION.PICKUP, d, viaAgent, nowMs);
      if (!queuedVia.ok) return fail(queuedVia.code, queuedVia.detail);
      logAction(protocol.CATALOG_LOG.ACTION.OPEN, d, nowMs);
      return { status: 200, body: { url: null, request_id: queuedVia.request.id, not_asked: null, held_by: null } };
    }

    return openSite(d, handoff, confirmed, nowMs);
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
   * catalog.rename, body {review, name}. The reviewer's own name, for the
   * Library's rows only. Every review in a fold takes it, as a star does.
   */
  async function rename(body, nowMs) {
    var hasSession = body && body.session !== undefined;
    var hasReview = body && body.review !== undefined;
    if (hasSession && hasReview) return badRequest("rename one thing: a review or a session");
    if (hasSession) return renameSession(body);
    var found = describe(body, nowMs);
    if (found.outcome) return found.outcome;
    if (typeof body.name !== "string") return badRequest("name must be a string; an empty one clears it");
    var d = found.described;
    var ids = Array.isArray(d.fold) && d.fold.length ? d.fold : [d.review];
    var kept = null;
    for (var i = 0; i < ids.length; i += 1) {
      var written = store.setName(ids[i], body.name);
      if (!written.ok) return fail(written.code || "PROTO_CATALOG_UNREADABLE");
      kept = written.name;
    }
    return { status: 200, body: { review: d.review, name: kept } };
  }

  /** catalog.rename with {session, name}: the reviewer's own name for a session card. */
  function renameSession(body) {
    var id = body.session;
    if (!protocol.isSafeId(id) || id === "legacy") return badRequest("session must be an agent session id");
    if (typeof body.name !== "string") return badRequest("name must be a string; an empty one clears it");
    var known = null;
    try {
      known = sessions.read(id);
    } catch (err) {
      known = null;
    }
    if (!known) return fail("PROTO_NOT_OPENABLE", "unknown session");
    var written = store.setSessionName(id, body.name);
    if (!written.ok) return fail(written.code || "PROTO_CATALOG_UNREADABLE");
    return { status: 200, body: { session: id, name: written.name } };
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
    // A launched agent's first prompt takes the document's session over. A
    // legacy review has no session, and a worktree row's session serves a
    // folder that is gone, so a launch there would send a new agent hunting
    // for a session nobody pointed at (adversary fixes). Pick this up serves
    // those rows instead.
    if (action === ACTION.LAUNCH && NO_LAUNCH_KINDS.indexOf(d.kind) !== -1) return fail("PROTO_NO_LAUNCH", d.kind);
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
  // The Library's own idle sessions
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
   * Close each session bare `lahe library` started (session.json `created_by`)
   * once it owns no reviews and its agent has been quiet for
   * LIBRARY_SESSION_IDLE_MS: no live monitor heartbeat, and no lahe command
   * since that long ago (quiet counts from the later of the session's start
   * and its last command). Left alone: a session that owns a review, and one
   * taken over since (its handoff_rev moved past 0).
   *
   * @returns {Promise<{closed: string[], kept: string[]}>}
   */
  async function sweepLibrarySessions(nowMs) {
    var out = { closed: [], kept: [] };
    var all;
    try {
      all = sessions.list();
    } catch (err) {
      return out;
    }
    for (var i = 0; i < all.length; i += 1) {
      var session = all[i];
      if (!session || session.closed_at || session.created_by !== C.CREATED_BY_LIBRARY) continue;
      var sessionId = session.id;
      if (agentSessions.handoffRev(session) > 0 || reviewsOf(sessionId).length > 0) continue;
      if (monitorLive(sessionId, session, nowMs)) {
        out.kept.push(sessionId);
        continue;
      }
      var quietSince = Date.parse(session.created_at);
      if (Number.isNaN(quietSince)) quietSince = 0;
      var activity = null;
      try {
        activity = sessions.readActivity(sessionId);
      } catch (err) {
        activity = null;
      }
      var lastCommand = activity ? Date.parse(activity[protocol.MONITOR.ACTIVITY_FIELD.AT]) : NaN;
      if (!Number.isNaN(lastCommand)) quietSince = Math.max(quietSince, lastCommand);
      if (nowMs - quietSince < C.LIBRARY_SESSION_IDLE_MS) {
        out.kept.push(sessionId);
        continue;
      }
      try {
        sessions.close(sessionId);
      } catch (err) {
        log("Library sweep could not close idle Library session " + sessionId + ": " + err.message, nowMs);
        out.kept.push(sessionId);
        continue;
      }
      log("Library sweep closed session " + sessionId + ": started by lahe library, no reviews, quiet", nowMs);
      out.closed.push(sessionId);
    }
    return out;
  }

  return {
    list: list,
    open: open,
    star: star,
    rename: rename,
    request: request,
    sweepLibrarySessions: sweepLibrarySessions
  };
}

module.exports = {
  NOT_ASKED: NOT_ASKED,
  createCatalogActions: createCatalogActions
};
