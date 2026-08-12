// events.jsonl: the append-only log, and the helper's own log.
//
// Owner: 1A. Architecture D5 (durability is browser storage plus an append-only
// log) and D11 (every refusal names the check that failed).
//
// Two logs live here because they are two different promises.
//
//   events.jsonl   one JSON line per event, per review. Append-only. It is the
//                  source of truth and everything else is a projection of it.
//   helper.log     the helper talking about itself: what it started, what it
//                  refused, and WHICH CHECK failed on every refusal. This is the
//                  thing that makes "outside cannot get in" judgeable by someone
//                  reading a file instead of taking the code's word for it.
//
// Three rules the whole design rests on:
//
//   WHOLE LINES. One append call carries one complete line, terminated. An
//   interrupted write can therefore cost at most the last line, never history.
//
//   IDEMPOTENCE IS BY event_id (protocol.IDEMPOTENCE_KEY), never by (item, rev).
//   The library re-posts anything it has not seen acknowledged, so the same
//   event arrives twice as a matter of ordinary operation. Drafts share an item
//   and a rev with different content, so keying on (item, rev) would drop them.
//
//   seq IS THE HELPER'S. The client mints event_id and ts; the helper assigns
//   seq, monotonic per review, and that number is the cursor every reader uses.
//
// Node-only.

"use strict";

var fs = require("node:fs");

var protocol = require("../shared/protocol.js");
var stateDir = require("./state_dir.js");

var EVENT_ID = protocol.IDEMPOTENCE_KEY;
var SEQ = protocol.EVENT_FIELD.SEQ;

/**
 * Repair a log whose last line was cut in half by a kill -9.
 *
 * A torn final line is expected, and the promise is that history is still
 * readable. The repair truncates back to the last complete line rather than
 * appending after the wreckage, because appending would splice the next event
 * onto half of the previous one and turn one lost event into two.
 *
 * The lost half-event is not lost work: the library re-posts anything it has not
 * seen acknowledged, and the re-post is idempotent by event_id.
 *
 * @returns {number} how many bytes were dropped
 */
function repairTornTail(logPath) {
  var stat;
  try {
    stat = fs.statSync(logPath);
  } catch (err) {
    if (err.code === "ENOENT") return 0;
    throw err;
  }
  if (stat.size === 0) return 0;
  var text = fs.readFileSync(logPath, "utf8");
  if (text.charAt(text.length - 1) === "\n") return 0;
  var lastNewline = text.lastIndexOf("\n");
  var keep = lastNewline === -1 ? 0 : lastNewline + 1;
  var dropped = Buffer.byteLength(text) - Buffer.byteLength(text.slice(0, keep));
  fs.truncateSync(logPath, Buffer.byteLength(text.slice(0, keep)));
  return dropped;
}

/**
 * The event log for one state directory.
 *
 * @param {{dir: string, onHelperLog?: (line: string) => void}} options
 */
function createEventLog(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createEventLog: dir is required");
  var dir = opts.dir;

  // Per review: the highest seq handed out, and every event_id already on disk.
  var loaded = Object.create(null);

  function helperLog(line) {
    var stamped = new Date().toISOString() + " " + line + "\n";
    stateDir.ensureDir(dir);
    stateDir.appendLine(stateDir.helperLogPath(dir), stamped);
    if (typeof opts.onHelperLog === "function") opts.onHelperLog(stamped);
    return stamped;
  }

  function load(reviewId) {
    if (loaded[reviewId]) return loaded[reviewId];
    stateDir.ensureReviewDir(dir, reviewId);
    var logPath = stateDir.eventsPath(dir, reviewId);
    var dropped = repairTornTail(logPath);
    if (dropped > 0) {
      helperLog(
        "repaired a torn final line in review " +
          reviewId +
          "'s log: dropped " +
          dropped +
          " bytes. The client re-posts anything unacknowledged, idempotent by " +
          EVENT_ID
      );
    }
    var state = { seq: 0, seen: Object.create(null), path: logPath };
    if (fs.existsSync(logPath)) {
      fs.readFileSync(logPath, "utf8")
        .split("\n")
        .forEach(function (line) {
          if (!line) return;
          var parsed = protocol.parseEventLine(line);
          if (!parsed.ok) {
            // A line the helper itself cannot read is history it must not
            // silently renumber over. It is reported and the file is left alone.
            helperLog("review " + reviewId + " has an unreadable log line: " + parsed.reason);
            return;
          }
          state.seen[parsed.event[EVENT_ID]] = true;
          if (typeof parsed.event[SEQ] === "number" && parsed.event[SEQ] > state.seq) {
            state.seq = parsed.event[SEQ];
          }
        });
    }
    loaded[reviewId] = state;
    return state;
  }

  /**
   * Append events for one review.
   *
   * @returns {{accepted: string[], duplicates: string[], rejected: object[], seq: number}}
   *   `accepted` is what went to disk, `duplicates` is what was already there
   *   (which is a success, not an error: the client asked twice), and `seq` is
   *   the review's highest sequence number afterwards.
   */
  function append(reviewId, events) {
    var state = load(reviewId);
    var list = Array.isArray(events) ? events : [events];
    var accepted = [];
    var duplicates = [];
    var rejected = [];

    list.forEach(function (event) {
      if (!event || typeof event !== "object") {
        rejected.push({ reason: "an event must be a JSON object" });
        return;
      }
      var eventId = event[EVENT_ID];
      if (typeof eventId !== "string" || !eventId) {
        rejected.push({ reason: "missing " + EVENT_ID + ", which is the idempotence key" });
        return;
      }
      if (protocol.EVENT_TYPES.indexOf(event[protocol.EVENT_FIELD.EVENT]) === -1) {
        rejected.push({
          event_id: eventId,
          reason: "unknown event type " + JSON.stringify(event[protocol.EVENT_FIELD.EVENT])
        });
        return;
      }
      if (state.seen[eventId]) {
        duplicates.push(eventId);
        return;
      }

      var stored = Object.assign({}, event);
      stored[protocol.EVENT_FIELD.REVIEW] = reviewId;
      state.seq += 1;
      stored[SEQ] = state.seq;

      // ONE APPEND, ONE WHOLE LINE. The line is built in full before anything
      // touches the file, so the only thing a crash can interrupt is a single
      // write of a single complete line.
      stateDir.appendLine(state.path, protocol.encodeEventLine(stored));
      state.seen[eventId] = true;
      accepted.push(eventId);
    });

    return { accepted: accepted, duplicates: duplicates, rejected: rejected, seq: state.seq };
  }

  /** Every event on disk for one review, in order. */
  function read(reviewId) {
    load(reviewId);
    var logPath = stateDir.eventsPath(dir, reviewId);
    if (!fs.existsSync(logPath)) return [];
    var out = [];
    fs.readFileSync(logPath, "utf8")
      .split("\n")
      .forEach(function (line) {
        if (!line) return;
        var parsed = protocol.parseEventLine(line);
        if (parsed.ok) out.push(parsed.event);
      });
    return out;
  }

  /** Events after a cursor. The cursor is a seq, never a timestamp. */
  function since(reviewId, cursor) {
    var from = typeof cursor === "number" ? cursor : 0;
    return read(reviewId).filter(function (event) {
      return typeof event[SEQ] === "number" && event[SEQ] > from;
    });
  }

  /** The review's current high-water mark. */
  function currentSeq(reviewId) {
    return load(reviewId).seq;
  }

  return {
    dir: dir,
    append: append,
    read: read,
    since: since,
    currentSeq: currentSeq,
    helperLog: helperLog
  };
}

module.exports = {
  createEventLog: createEventLog,
  repairTornTail: repairTornTail
};
