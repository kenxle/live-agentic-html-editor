// The Library's request queue: catalog-requests.jsonl, and the attach record
// that says which agent the queue hands requests to.
//
// Owner: LAHE Library, Task 1.4. Architecture: docs/features/
// 20260922.02_lahe_library/02_architecture_lahe_library.md, "Files" and "The
// drain section".
//
// WHY A HELPER-ONLY QUEUE. "Pick this up" and "Launch a new agent" are
// requests from the Library page to the attached agent. They are not review
// items: review.json writes only known item fields, and any page holding a
// review token could forge one. So they live in their own append-only file,
// written only by the helper (append, and recorded expiry) and by `lahe
// library answer` (the answer). The drain shows them as their own section.
//
// THREE LINE SHAPES, one file, the file is the single record:
//
//   {id, at, action, review, session, for}          a request (ids only)
//   {id, answered_at, by, status, text}              the answer, first wins
//   {id, expired_at, reason}                         the expiry, first wins
//
// A REQUEST HOLDS IDS ONLY. No text from a page ever reaches this file: append
// copies the six documented keys and drops everything else it was handed.
//
// EXPIRY IS WORKED OUT ON EVERY READ, FROM `now`. A pending request expires:
//
//   attach_changed  the attach record names a different session than `for`.
//                   Re-attaching the same session is not a change.
//   monitor_dead    the `for` session is not listening, read through the one
//                   liveness function in agent_sessions.js (a live monitor
//                   heartbeat, or a lahe command in the last few minutes).
//   timeout         REQUEST_EXPIRY_MS have passed with no answer.
//
// A queue made with `writeExpired: true` (the helper's) appends the expired line
// the first time it sees one, so the file stays the single record. The CLI's
// queue computes the same answer and writes nothing, because the file has only
// two writers and the CLI's one write is the answer.
//
// Node-only.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");
var agentSessions = require("./agent_sessions.js");
var logModule = require("./log.js");

var C = protocol.CATALOG;

var ACTION = { PICKUP: "pickup", LAUNCH: "launch" };
var ACTIONS = [ACTION.PICKUP, ACTION.LAUNCH];
var ANSWER_STATUS = { DONE: "done", REFUSED: "refused" };
var ANSWER_STATUSES = [ANSWER_STATUS.DONE, ANSWER_STATUS.REFUSED];
var EXPIRY_REASON = { ATTACH_CHANGED: "attach_changed", MONITOR_DEAD: "monitor_dead", TIMEOUT: "timeout" };
// The states the Library row draws (architecture, "The list response").
var STATE = { WAITING: "waiting", DONE: "done", REFUSED: "refused", EXPIRED: "expired" };
// The documented key set of a request line, in the order it is written.
var REQUEST_KEYS = ["id", "at", "action", "review", "session", "for"];
var ATTACH_SCHEMA = 1;

function iso(nowMs) {
  return new Date(nowMs).toISOString();
}

function mintId() {
  return "cq_" + crypto.randomBytes(8).toString("hex");
}

/**
 * Write the attach record: the session the Library hands requests to.
 *
 * Only the CLI calls this (`lahe library --session`). Written whole and renamed,
 * so the later of two attaches wins and a reader never sees half of one.
 */
function writeAttach(dir, sessionId, nowMs) {
  if (!protocol.isSafeId(sessionId)) throw new Error("invalid agent session id " + JSON.stringify(sessionId));
  stateDir.ensureDir(dir);
  var record = { schema: ATTACH_SCHEMA, session: sessionId, at: iso(nowMs) };
  stateDir.writeAtomic(stateDir.catalogAttachPath(dir), JSON.stringify(record) + "\n");
  return record;
}

/** The attach record off disk, or null when there is none or it is unreadable. */
function readAttachRecord(dir) {
  var file = stateDir.catalogAttachPath(dir);
  var parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null;
  }
  if (!parsed || parsed.schema !== ATTACH_SCHEMA || !protocol.isSafeId(parsed.session)) return null;
  return parsed;
}

/**
 * @param {{dir: string, writeExpired?: boolean, pidAlive?: function,
 *          log?: function(string), readFile?: function}} options
 *   `pidAlive` is the liveness function's own seam, so a test can say which
 *   monitor pids are running. `log` gets one line per skipped torn line; the
 *   default is the helper log.
 */
function createQueue(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("catalog_requests.createQueue: dir is required");
  var dir = opts.dir;
  var writeExpired = opts.writeExpired === true;
  var pidAlive = typeof opts.pidAlive === "function" ? opts.pidAlive : agentSessions.pidAlive;
  var store = agentSessions.createStore({ dir: dir });
  var log = typeof opts.log === "function" ? opts.log : defaultLog;
  // Tests pass a counting readFile, as the reader's tests do.
  var readFile = typeof opts.readFile === "function" ? opts.readFile : fs.readFileSync;

  function defaultLog(line) {
    try {
      logModule.createEventLog({ dir: dir }).helperLog(line);
    } catch (err) {
      // A log line that cannot be written must not take the queue down with it.
    }
  }

  // -------------------------------------------------------------------------
  // Reading the file
  // -------------------------------------------------------------------------

  // Each bad line is logged once per queue, not on every read: the page polls
  // every POLL_MS and the monitor every few seconds, and the same torn line
  // would otherwise fill the helper log.
  var loggedBad = Object.create(null);

  /** Every whole line, parsed. A line that is not JSON is skipped and logged once. */
  function readLines() {
    var file = stateDir.catalogRequestsPath(dir);
    var text;
    try {
      stateDir.assertNotSymlink(file);
      text = readFile(file, "utf8");
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    var out = [];
    text.split("\n").forEach(function (line, index, all) {
      if (!line.trim()) return;
      try {
        var parsed = JSON.parse(line);
        if (parsed && typeof parsed === "object" && typeof parsed.id === "string") out.push(parsed);
        else throw new Error("not a queue line");
      } catch (err) {
        // The last piece of the split is a whole line only when the file ends
        // in a newline, and then it is empty and skipped above. So a bad last
        // piece is a torn tail, and any other bad line is a complete one.
        var torn = index === all.length - 1;
        var key = (torn ? "torn " : index + " ") + line;
        if (loggedBad[key]) return;
        loggedBad[key] = true;
        log(
          "catalog-requests.jsonl: skipped " + (torn ? "a torn last line" : "an unreadable line " + (index + 1)) +
            " (" + line.length + " characters); the rest of the queue still reads"
        );
      }
    });
    return out;
  }

  /** Append one line, starting a fresh line if the file ends in a torn one. */
  function appendLine(record) {
    var file = stateDir.catalogRequestsPath(dir);
    stateDir.ensureDir(dir);
    var prefix = "";
    try {
      var size = fs.statSync(file).size;
      if (size > 0) {
        var fd = fs.openSync(file, "r");
        try {
          var last = Buffer.alloc(1);
          fs.readSync(fd, last, 0, 1, size - 1);
          if (last.toString("utf8") !== "\n") prefix = "\n";
        } finally {
          fs.closeSync(fd);
        }
      }
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
    }
    stateDir.appendLine(file, prefix + JSON.stringify(record) + "\n");
  }

  /**
   * Fold the file into one record per request, in file order.
   *
   * @returns {Array<{request: object, answer: object|null, expired: object|null}>}
   */
  function fold() {
    var byId = Object.create(null);
    var order = [];
    readLines().forEach(function (line) {
      if (typeof line.action === "string" && typeof line.at === "string") {
        if (byId[line.id]) return;
        byId[line.id] = { request: line, answer: null, expired: null };
        order.push(line.id);
        return;
      }
      var entry = byId[line.id];
      if (!entry) return;
      if (typeof line.answered_at === "string" && !entry.answer && !entry.expired) entry.answer = line;
      else if (typeof line.expired_at === "string" && !entry.expired && !entry.answer) entry.expired = line;
    });
    return order.map(function (id) { return byId[id]; });
  }

  // -------------------------------------------------------------------------
  // Liveness and expiry
  // -------------------------------------------------------------------------

  function readSession(id) {
    try {
      return store.read(id);
    } catch (err) {
      return null;
    }
  }

  /**
   * Is this session listening? Through the one liveness function: a live
   * monitor heartbeat for its current handoff rev, or a lahe command in the
   * last few minutes. The wake-feed probe is passed as "no" because it spawns a
   * subprocess, and a queue read must stay a file read.
   */
  function listening(sessionId, nowMs) {
    var session = readSession(sessionId);
    if (!session || session.closed_at) return false;
    var live = agentSessions.livenessFrom({
      session: session,
      monitor: store.readMonitor(sessionId),
      activity: store.readActivity(sessionId),
      listening: false,
      nowMs: nowMs,
      pidAlive: pidAlive
    });
    return live[protocol.AGENT_LIVENESS.FIELD.LISTENING] === true;
  }

  /** Why a pending request has expired at `nowMs`, or null when it has not. */
  function expiryReason(request, nowMs, attach) {
    if (!attach || attach.session !== request.for) return EXPIRY_REASON.ATTACH_CHANGED;
    if (!listening(request.for, nowMs)) return EXPIRY_REASON.MONITOR_DEAD;
    var at = Date.parse(request.at);
    if (Number.isNaN(at) || nowMs - at >= C.REQUEST_EXPIRY_MS) return EXPIRY_REASON.TIMEOUT;
    return null;
  }

  /**
   * Every request with its state at `nowMs`. Records the expired line once when
   * this queue is the helper's.
   */
  function resolve(nowMs) {
    var attach = readAttachRecord(dir);
    return fold().map(function (entry) {
      var out = { request: entry.request, answer: entry.answer, expired: entry.expired, state: STATE.WAITING };
      if (entry.answer) {
        out.state = entry.answer.status === ANSWER_STATUS.REFUSED ? STATE.REFUSED : STATE.DONE;
        return out;
      }
      if (entry.expired) {
        out.state = STATE.EXPIRED;
        return out;
      }
      var reason = expiryReason(entry.request, nowMs, attach);
      if (reason) {
        out.state = STATE.EXPIRED;
        out.expired = { id: entry.request.id, expired_at: iso(nowMs), reason: reason };
        if (writeExpired) appendLine(out.expired);
      }
      return out;
    });
  }

  // -------------------------------------------------------------------------
  // The public operations
  // -------------------------------------------------------------------------

  /** Pending requests at `nowMs`, oldest first. */
  function pending(nowMs) {
    return resolve(nowMs)
      .filter(function (entry) { return entry.state === STATE.WAITING; })
      .map(function (entry) { return entry.request; });
  }

  /** Pending requests whose `for` is this session. */
  function pendingFor(sessionId, nowMs) {
    return pending(nowMs).filter(function (request) { return request.for === sessionId; });
  }

  /**
   * Queue a request. Ids only: the six documented keys are copied and anything
   * else the caller passed is dropped.
   *
   * @returns {{ok: true, request: object} | {ok: false, code: string, message?: string}}
   */
  function append(input, nowMs) {
    var spec = input || {};
    if (ACTIONS.indexOf(spec.action) === -1) {
      return { ok: false, code: "BAD_REQUEST", message: "action must be one of " + ACTIONS.join(", ") };
    }
    var ids = ["review", "session", "for"];
    for (var i = 0; i < ids.length; i += 1) {
      if (!protocol.isSafeId(spec[ids[i]])) {
        return { ok: false, code: "BAD_REQUEST", message: ids[i] + " must be a safe id" };
      }
    }
    var open = pending(nowMs);
    if (open.some(function (request) { return request.review === spec.review; })) {
      return { ok: false, code: "PROTO_REQUEST_PENDING" };
    }
    if (open.length >= C.QUEUE_CAP) return { ok: false, code: "PROTO_QUEUE_FULL" };
    var request = {};
    var values = { id: mintId(), at: iso(nowMs), action: spec.action, review: spec.review, session: spec.session, for: spec.for };
    REQUEST_KEYS.forEach(function (key) { request[key] = values[key]; });
    appendLine(request);
    return { ok: true, request: request };
  }

  /**
   * Answer a request, once. `by` must be the request's `for`.
   *
   * @returns {{ok: true, answer: object} | {ok: false, reason: string, first?: object, request?: object}}
   *   reason is one of unknown, not_for, expired, answered, too_long, bad_status
   */
  function answer(input, nowMs) {
    var spec = input || {};
    if (ANSWER_STATUSES.indexOf(spec.status) === -1) return { ok: false, reason: "bad_status" };
    var text = typeof spec.text === "string" ? spec.text : "";
    if (Array.from(text).length > C.ANSWER_TEXT_MAX) return { ok: false, reason: "too_long" };
    var found = null;
    resolve(nowMs).forEach(function (entry) {
      if (entry.request.id === spec.id) found = entry;
    });
    if (!found) return { ok: false, reason: "unknown" };
    if (found.request.for !== spec.by) return { ok: false, reason: "not_for", request: found.request };
    if (found.answer) return { ok: false, reason: "answered", first: found.answer, request: found.request };
    if (found.state === STATE.EXPIRED) return { ok: false, reason: "expired", expired: found.expired, request: found.request };
    var line = { id: found.request.id, answered_at: iso(nowMs), by: spec.by, status: spec.status, text: text };
    appendLine(line);
    return { ok: true, answer: line, request: found.request };
  }

  /** A session's display name for the Library row: its name, or its id. */
  function nameOf(sessionId) {
    var session = readSession(sessionId);
    return (session && agentSessions.cleanName(session.name)) || sessionId;
  }

  /**
   * The latest request on a review, as the Library row draws it, or null.
   *
   * An answer (or an expiry) stays until the next request on the review, or
   * for ANSWER_SHOWN_MS after it happened.
   */
  function requestFor(reviewId, nowMs) {
    return requestsAt(nowMs)(reviewId);
  }

  /**
   * Every review's latest request at `nowMs`, from one read of the file.
   * Returns a lookup, `(reviewId) => request or null`, with requestFor's answer
   * for each review. The Library's list calls this once per poll rather than
   * requestFor once per row, which re-read the whole file for every row.
   */
  function requestsAt(nowMs) {
    var latest = Object.create(null);
    resolve(nowMs).forEach(function (entry) {
      latest[entry.request.review] = entry;
    });
    return function (reviewId) {
      var entry = Object.prototype.hasOwnProperty.call(latest, reviewId) ? latest[reviewId] : null;
      return entry ? rowRequest(entry, nowMs) : null;
    };
  }

  function rowRequest(latest, nowMs) {
    var out = {
      id: latest.request.id,
      action: latest.request.action,
      at: latest.request.at,
      state: latest.state,
      by_name: nameOf(latest.request.for),
      text: null,
      answered_at: null
    };
    var endedAt = null;
    if (latest.answer) {
      out.text = latest.answer.text;
      out.answered_at = latest.answer.answered_at;
      out.by_name = nameOf(latest.answer.by);
      endedAt = latest.answer.answered_at;
    } else if (latest.expired) {
      out.reason = latest.expired.reason;
      endedAt = latest.expired.expired_at;
    }
    if (endedAt) {
      var then = Date.parse(endedAt);
      if (!Number.isNaN(then) && nowMs - then >= C.ANSWER_SHOWN_MS) return null;
    }
    return out;
  }

  /**
   * The attached agent, as the Library header draws it, or null for none.
   * An attach with no session on disk behind it reads as no agent.
   */
  function readAttached(nowMs) {
    var attach = readAttachRecord(dir);
    if (!attach) return null;
    var session = readSession(attach.session);
    if (!session || session.synthetic) return null;
    return {
      session: attach.session,
      name: agentSessions.cleanName(session.name),
      at: attach.at,
      watching: listening(attach.session, nowMs),
      // A closed session is no agent at all, not one that stopped watching:
      // the Library's header says "No agent attached" for it.
      closed: !!session.closed_at
    };
  }

  return {
    append: append,
    answer: answer,
    pending: pending,
    pendingFor: pendingFor,
    requestFor: requestFor,
    requestsAt: requestsAt,
    readAttached: readAttached
  };
}

module.exports = {
  ACTION: ACTION,
  ACTIONS: ACTIONS,
  ANSWER_STATUS: ANSWER_STATUS,
  ANSWER_STATUSES: ANSWER_STATUSES,
  EXPIRY_REASON: EXPIRY_REASON,
  STATE: STATE,
  REQUEST_KEYS: REQUEST_KEYS,
  writeAttach: writeAttach,
  readAttachRecord: readAttachRecord,
  createQueue: createQueue
};
