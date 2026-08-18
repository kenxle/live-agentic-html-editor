// The per-session wake feed: the push channel a host can get with `tail -f`.
//
// Owner: 1A.
//
// WHY IT EXISTS. Every host we support can wake an agent on a line arriving in
// a file it is tailing, and none of them charges model tokens while the file is
// quiet. The old reliable loop was exactly that shape and it broke for one
// mechanical reason: review.json is written atomically (write beside, rename),
// so a `tail -f` on it follows a deleted inode and reports nothing forever
// without an error. This file is designed for the tail instead.
//
// THE THREE RULES, and each one is load-bearing:
//
//  1. APPEND ONLY. Never rewritten, never rotated, never truncated. The moment
//     the file is replaced, every armed tail goes deaf silently.
//  2. CREATED EMPTY AT SESSION CREATION. A host arms its tail before there is
//     any work; `tail -f` on a path that does not exist yet is a race, and a
//     lost race here is a session that never wakes.
//  3. POINTERS, NOT PAYLOADS. A line names the item and the drain command. It
//     carries no note, no change, and no page text. Reviewer intent reaches an
//     agent through review.json only, which is where D12's trust classes and
//     the fencing live. A wake line carrying reviewer text would be a second
//     instruction channel with none of that.
//
// DEDUPE IS BY (review, item, rev). One ready transition is one line. A burst of
// typing appends nothing because drafts are not ready transitions, and a replay
// of the same event appends nothing because the event log rejects the duplicate
// before this module is ever called. The (review, item, rev) key is the belt:
// a re-ready after rework carries a new rev, so it legitimately appends again.
//
// Node-only. Not in the layer bundle.

"use strict";

var fs = require("node:fs");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");

/**
 * @param {{dir: string, now?: function}} options
 */
function createWakeFeed(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("wake_feed.createWakeFeed: dir is required");
  var dir = opts.dir;
  var now = typeof opts.now === "function" ? opts.now : function () { return new Date().toISOString(); };

  // One set per session, loaded from the file the first time this process is
  // asked about that session. Two helpers on one state directory is already
  // outside the design (one helper per machine, D11), so an in-process set plus
  // the file it was seeded from is enough.
  var seen = Object.create(null);

  function pathFor(sessionId) {
    return stateDir.wakeLogPath(dir, sessionId);
  }

  function keyOf(review, item, rev) {
    return String(review) + " " + String(item) + " " + String(rev);
  }

  /**
   * Create the feed, empty, so a tail can be armed before any work exists.
   * Idempotent: an existing feed is left exactly as it is.
   */
  function ensure(sessionId) {
    stateDir.ensureAgentSessionDir(dir, sessionId);
    var file = pathFor(sessionId);
    if (!fs.existsSync(file)) {
      // wx, not appendFile: two callers racing to create it must not both
      // succeed at emptying it.
      try {
        fs.closeSync(fs.openSync(file, "wx", stateDir.FILE_MODE));
      } catch (err) {
        if (err.code !== "EEXIST") throw err;
      }
    }
    return file;
  }

  /** Every line in the feed, parsed. Skips anything unparseable rather than throwing. */
  function read(sessionId) {
    var file = pathFor(sessionId);
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter(function (line) { return line.trim(); })
      .map(function (line) {
        try {
          return JSON.parse(line);
        } catch (err) {
          return null;
        }
      })
      .filter(function (parsed) { return parsed && typeof parsed === "object"; });
  }

  function seenFor(sessionId) {
    if (!seen[sessionId]) {
      var set = Object.create(null);
      read(sessionId).forEach(function (line) {
        if (line[protocol.WAKE.FIELD.KIND] !== protocol.WAKE.KIND.WORK) return;
        set[keyOf(line[protocol.WAKE.FIELD.REVIEW], line[protocol.WAKE.FIELD.ITEM], line[protocol.WAKE.FIELD.REV])] = true;
      });
      seen[sessionId] = set;
    }
    return seen[sessionId];
  }

  function write(sessionId, line) {
    ensure(sessionId);
    stateDir.appendLine(pathFor(sessionId), JSON.stringify(line) + "\n");
    return line;
  }

  /**
   * One ready transition, for a session that owns the review.
   *
   * @returns {object|null} the line appended, or null when this (review, item,
   *   rev) already has one.
   */
  function appendWork(spec) {
    var s = spec || {};
    if (!s.session || !s.review || !s.item) {
      throw new Error("wake_feed.appendWork: session, review and item are all required");
    }
    var key = keyOf(s.review, s.item, s.rev);
    var set = seenFor(s.session);
    if (set[key]) return null;
    var line = {};
    line[protocol.WAKE.FIELD.AT] = now();
    line[protocol.WAKE.FIELD.KIND] = protocol.WAKE.KIND.WORK;
    line[protocol.WAKE.FIELD.REVIEW] = s.review;
    line[protocol.WAKE.FIELD.ITEM] = s.item;
    line[protocol.WAKE.FIELD.REV] = typeof s.rev === "number" ? s.rev : null;
    line[protocol.WAKE.FIELD.DRAIN] = protocol.drainCommand(s.session);
    write(s.session, line);
    set[key] = true;
    return line;
  }

  /**
   * A session-lifecycle line: takeover or closed.
   *
   * These carry no review, item or rev: they are about the session itself. A
   * tail sees them and knows the answer is "stop", not "drain".
   */
  function appendSessionEvent(sessionId, kind) {
    if (kind !== protocol.WAKE.KIND.TAKEOVER && kind !== protocol.WAKE.KIND.CLOSED) {
      throw new Error("wake_feed.appendSessionEvent: kind must be takeover or closed, got " + String(kind));
    }
    var line = {};
    line[protocol.WAKE.FIELD.AT] = now();
    line[protocol.WAKE.FIELD.KIND] = kind;
    line[protocol.WAKE.FIELD.DRAIN] = protocol.drainCommand(sessionId);
    return write(sessionId, line);
  }

  return {
    path: pathFor,
    ensure: ensure,
    read: read,
    appendWork: appendWork,
    appendSessionEvent: appendSessionEvent
  };
}

module.exports = { createWakeFeed: createWakeFeed };
