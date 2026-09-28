// The helper stops a session's page servers when nobody is looking.
//
// Spec: docs/features/20260928.05_stop_idle_servers/01_spec_stop_idle_servers.md.
//
// WHY. Every `lahe review` of a page or a Markdown file leaves a small Node
// process serving it, and that process used to run until the session closed.
// Sessions stay open for days, so an idle machine carried dozens of servers
// for pages nobody had open. The owner (2026-09-28): "if there are no browser
// windows open, then I think we're ok to close... as I'll need to go to the
// agent or the doc index to ask to get the page back". Then: stop the
// servers, keep the session open, so its agent keeps watching.
//
// THE RULE.
//
//  - "Open" is the helper's own answer: a review whose window holder is not
//    stale by its own claim window (reviews.openWindowReviews). A hidden tab on
//    the five minute beat is held for 390 seconds, so it counts for all of it.
//  - A session with no open window on any of its reviews for GRACE_MS has every
//    running page server stopped, marked IDLE_REASON on the server's record.
//  - The grace counts from the latest of: the last moment a window was open,
//    the first sweep that saw this server instance, and the server's
//    link_given_at (stamped by `lahe review` each time it prints a link). So a
//    reload (a goodbye, then a fresh claim) never stops anything, and a link
//    just handed out gets its full two minutes.
//  - Nothing else changes. The session stays open, its monitor keeps running,
//    and nothing is written to its wake feed.
//
// COMING BACK. `lahe review` starts a stopped server, old port first. So does
// any window of the session that claims or beats while its servers are idle-
// stopped (windowActivity), which covers a laptop waking from a long sleep and
// a hidden second window that was not the holder. A closed session's servers
// are never started here: a session close is final until the session reopens.
//
// ONE SESSION AT A TIME. Stops and restarts for one session run in order on a
// per-session queue, and a stop re-checks for an open window just before it
// acts, so a claim that lands mid-sweep is never undone by it.

"use strict";

var staticServers = require("./static_servers.js");
var protocol = require("../shared/protocol.js");

var GRACE_MS = 2 * 60 * 1000;
var SWEEP_MS = 30 * 1000;

/**
 * @param {{dir: string, reviews: object, agentSessions: object, log?: object,
 *          now?: function(): number, graceMs?: number}} options
 *   `reviews` is the helper's registry, `agentSessions` its session store.
 */
function createIdleServers(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createIdleServers: dir is required");
  if (!opts.reviews) throw new Error("createIdleServers: reviews is required");
  if (!opts.agentSessions) throw new Error("createIdleServers: agentSessions is required");
  var dir = opts.dir;
  var reviews = opts.reviews;
  var agentSessions = opts.agentSessions;
  var log = opts.log || null;
  var clock = typeof opts.now === "function" ? opts.now : Date.now;
  var graceMs = typeof opts.graceMs === "number" && opts.graceMs >= 0 ? opts.graceMs : GRACE_MS;

  // session id -> the last clock reading at which a window was open.
  var lastOpen = Object.create(null);
  // server instance -> the clock reading of the first sweep that saw it.
  var firstSeen = Object.create(null);
  // session id -> the tail of its queue of stops and restarts.
  var queues = Object.create(null);
  var timer = null;

  function say(line) {
    if (log && typeof log.helperLog === "function") log.helperLog(line);
  }

  function sessionOf(reviewId) {
    var review = reviews.get(reviewId);
    var owner = review && typeof review.agent_session_id === "string" ? review.agent_session_id : null;
    if (!owner || owner === "legacy" || !protocol.isSafeId(owner)) return null;
    return owner;
  }

  function sessionsWithOpenWindow() {
    var open = Object.create(null);
    reviews.openWindowReviews().forEach(function (reviewId) {
      var owner = sessionOf(reviewId);
      if (owner) open[owner] = true;
    });
    return open;
  }

  function isOpenSession(sessionId) {
    var session = agentSessions.read(sessionId);
    return !!session && !session.synthetic && !session.closed_at;
  }

  function serversOf(sessionId) {
    try { return staticServers.list(dir, sessionId); } catch (err) { return []; }
  }

  function enqueue(sessionId, task) {
    var previous = queues[sessionId] || Promise.resolve();
    var next = previous.then(task).catch(function (err) {
      say("agent session " + sessionId + ": idle page server step failed: " + (err && err.message ? err.message : String(err)));
    });
    queues[sessionId] = next;
    next.then(function () {
      if (queues[sessionId] === next) delete queues[sessionId];
    });
    return next;
  }

  /** When this session's grace started, given the servers still running. */
  function graceStart(sessionId, running, at) {
    // No window seen yet: the first sweep that saw each server starts it.
    var since = typeof lastOpen[sessionId] === "number" ? lastOpen[sessionId] : -Infinity;
    running.forEach(function (meta) {
      var key = meta.id + ":" + meta.instance;
      if (typeof firstSeen[key] !== "number") firstSeen[key] = at;
      if (firstSeen[key] > since) since = firstSeen[key];
      var given = typeof meta.link_given_at === "string" ? Date.parse(meta.link_given_at) : NaN;
      if (!Number.isNaN(given) && given > since) since = given;
    });
    return since;
  }

  function stopIdle(sessionId) {
    return enqueue(sessionId, async function () {
      // Checked again here, at the last moment: a claim may have landed since
      // the sweep decided.
      if (!isOpenSession(sessionId)) return 0;
      if (sessionsWithOpenWindow()[sessionId]) return 0;
      var at = clock();
      var running = serversOf(sessionId).filter(function (meta) { return !meta.stopped_at; });
      if (!running.length) return 0;
      if (at - graceStart(sessionId, running, at) < graceMs) return 0;
      var stopped = 0;
      for (var i = 0; i < running.length; i += 1) {
        if (await staticServers.stopOne(dir, sessionId, running[i], staticServers.IDLE_REASON)) stopped += 1;
      }
      if (stopped) {
        say(
          "agent session " + sessionId + ": stopped " + stopped + " page server" + (stopped === 1 ? "" : "s") +
            ", no browser window open on its pages for " + Math.round(graceMs / 1000) +
            " seconds. The session stays open; lahe review brings a page back"
        );
      }
      return stopped;
    });
  }

  /**
   * Start again every server of this session that the sweep stopped, old port
   * first. Nothing for a closed session, and nothing for a server stopped by a
   * session close.
   */
  function restartIdle(sessionId) {
    return enqueue(sessionId, async function () {
      if (!isOpenSession(sessionId)) return 0;
      var idle = serversOf(sessionId).filter(function (meta) {
        return meta.stopped_at && meta.stop_reason === staticServers.IDLE_REASON;
      });
      var started = 0;
      for (var i = 0; i < idle.length; i += 1) {
        var meta = idle[i];
        var result = await staticServers.start({
          dir: dir,
          sessionId: sessionId,
          root: meta.root,
          logicalRoot: typeof meta.logical_root === "string" ? meta.logical_root : null,
          preferredPort: meta.port
        });
        if (result.started) started += 1;
        if (result.meta.port !== meta.port) {
          say(
            "agent session " + sessionId + ": page server " + meta.id + " came back on port " + result.meta.port +
              ", not " + meta.port + ", which was taken. Run lahe review again for a working link"
          );
        }
      }
      if (started) {
        say("agent session " + sessionId + ": a window came back, so " + started + " page server" + (started === 1 ? "" : "s") + " started again");
      }
      return started;
    });
  }

  /**
   * A window of `reviewId` claimed, beat or said goodbye. Its session was open
   * at this instant, which is where a goodbye's grace starts. A claim or beat
   * for a session whose servers the sweep stopped brings them back.
   *
   * @returns {Promise|null} the restart, when one was queued
   */
  function windowActivity(reviewId) {
    var owner = sessionOf(reviewId);
    if (!owner) return null;
    lastOpen[owner] = clock();
    var idle = serversOf(owner).some(function (meta) {
      return meta.stopped_at && meta.stop_reason === staticServers.IDLE_REASON;
    });
    if (!idle) return null;
    // A goodbye leaves no holder, and it is not a reason to start anything.
    if (reviews.openWindowReviews().indexOf(reviewId) === -1) return null;
    return restartIdle(owner);
  }

  /** One pass over every open session with a running page server. */
  async function sweep() {
    var at = clock();
    var open = sessionsWithOpenWindow();
    var list;
    try { list = agentSessions.openSessions(); } catch (err) { return 0; }
    var pending = [];
    list.forEach(function (session) {
      var id = session.id;
      var running = serversOf(id).filter(function (meta) { return !meta.stopped_at; });
      if (!running.length) return;
      if (open[id]) {
        lastOpen[id] = at;
        graceStart(id, running, at);
        return;
      }
      if (at - graceStart(id, running, at) >= graceMs) pending.push(stopIdle(id));
    });
    var counts = await Promise.all(pending);
    return counts.reduce(function (sum, n) { return sum + (n || 0); }, 0);
  }

  /** Every queued stop and restart, finished. For tests and shutdown. */
  async function settled() {
    var tails = Object.keys(queues).map(function (id) { return queues[id]; });
    await Promise.all(tails);
    if (Object.keys(queues).length) return settled();
    return undefined;
  }

  function start(intervalMs) {
    if (timer) return timer;
    var every = typeof intervalMs === "number" && intervalMs > 0 ? intervalMs : SWEEP_MS;
    var running = false;
    timer = setInterval(function () {
      if (running) return;
      running = true;
      sweep().catch(function (err) {
        say("idle page server sweep failed: " + (err && err.message ? err.message : String(err)));
      }).then(function () { running = false; });
    }, every);
    // Never what keeps the helper alive.
    if (typeof timer.unref === "function") timer.unref();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return {
    sweep: sweep,
    windowActivity: windowActivity,
    settled: settled,
    start: start,
    stop: stop
  };
}

module.exports = {
  GRACE_MS: GRACE_MS,
  SWEEP_MS: SWEEP_MS,
  createIdleServers: createIdleServers
};
