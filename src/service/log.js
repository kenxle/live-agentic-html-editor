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

// Read the tail in chunks rather than the file whole: an events log grows for
// the life of a review, it reaches tens of megabytes, and a reader that has
// already seen the first ten thousand lines only ever wants the last few.
var READ_CHUNK_BYTES = 64 * 1024;
var NEWLINE = 0x0a;

// THE TAIL BUFFER. The reader keeps the last few events it scanned, so a caller
// whose cursor is a little behind the file (the library's reply poll, which
// carries the seq the PAGE last saw, one or two events back) is answered from
// memory. Without it the poll took the whole-file branch on every single event:
// the helper ticks the projector first, which moves the scan cursor past the
// new event, and the page's older cursor then had nowhere to be answered from.
//
// Bounded twice, by count and by bytes, and the byte bound is the one that
// matters: a single event carrying a page probe can be tens of kilobytes, so a
// count-only bound would quietly hold tens of megabytes per review. The lines'
// own byte lengths are known at scan time, so the accounting is exact rather
// than estimated.
var TAIL_BUFFER_EVENTS = 256;
var TAIL_BUFFER_BYTES = 1024 * 1024;

// Two 256-byte windows are remembered to tell "appended to" from "rewritten":
// the file's head, and the bytes ending at the cursor. Enough to cover a whole
// line each in practice, and cheap enough to re-read on every tail read.
var WINDOW_BYTES = 256;

// helper.log is one line per call, and it is the file AC8 ("outside cannot get
// in") is judged from. Any attacker-controlled value that reaches it (a review
// id, a request path, an origin header) could otherwise carry a newline and
// forge a whole line, including a forged refusal (finding 8, confirmed live).
// Every line goes through this chokepoint, which is more robust than escaping at
// each call site: it also covers callers in files this task does not own
// (protocol.js's refusal builder, reviews.js), where the raw value is
// interpolated before it ever reaches here.
var HELPER_LOG_MAX = 4000;

function sanitizeLogLine(line) {
  // Escape C0 and C1 control characters (newline, carriage return, NUL, and the
  // rest), so no value can end the line early or start a new one. The forged
  // text is not hidden, only neutralized onto the one line it belongs to.
  var text = String(line).replace(/[\u0000-\u001F\u007F-\u009F]/g, function (ch) {
    return "\\x" + ("0" + ch.charCodeAt(0).toString(16)).slice(-2);
  });
  if (text.length > HELPER_LOG_MAX) text = text.slice(0, HELPER_LOG_MAX) + " [log line truncated]";
  return text;
}

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
    var stamped = new Date().toISOString() + " " + sanitizeLogLine(line) + "\n";
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
    // `scannedBytes` and `scannedSeq` are the tail cursor: bytes [0, scannedBytes)
    // are whole lines this reader has already parsed, and scannedSeq is the
    // highest seq among them. `epoch` counts the times the reader found the file
    // was not a continuation of what it had scanned and started over, which is
    // what tells a caller holding folded state to throw that state away.
    var state = {
      seq: 0,
      seen: Object.create(null),
      path: logPath,
      scannedBytes: 0,
      scannedSeq: 0,
      head: null,
      brink: null,
      ino: null,
      mtimeMs: null,
      tail: [],
      tailBytes: 0,
      epoch: 0
    };
    loaded[reviewId] = state;
    scanAll(reviewId, state, { report: true });
    return state;
  }

  /** Forget the cursor, and say so, so folded state downstream is thrown away. */
  function resetScan(state) {
    state.epoch += 1;
    state.scannedBytes = 0;
    state.scannedSeq = 0;
    state.head = null;
    state.brink = null;
    state.ino = null;
    state.mtimeMs = null;
    state.tail = [];
    state.tailBytes = 0;
  }

  /** The last WINDOW_BYTES of a buffer, copied. */
  function windowEndingAt(buffer, end) {
    return Buffer.from(buffer.slice(Math.max(0, end - WINDOW_BYTES), end));
  }

  /** Remember an event in the bounded tail buffer. */
  function remember(state, event, bytes) {
    if (typeof event[SEQ] !== "number") return;
    state.tail.push({ seq: event[SEQ], event: event, bytes: bytes });
    state.tailBytes += bytes;
    while (state.tail.length > TAIL_BUFFER_EVENTS || (state.tail.length > 1 && state.tailBytes > TAIL_BUFFER_BYTES)) {
      state.tailBytes -= state.tail.shift().bytes;
    }
  }

  /**
   * Read the whole file, refresh the cursor, and return every event.
   *
   * This is the from-the-top path, and it is also how the cursor is
   * established: after it, a tail read has somewhere to start.
   */
  function scanAll(reviewId, state, options) {
    var opts = options || {};
    var buffer;
    var stat = null;
    try {
      stat = fs.statSync(state.path);
      buffer = fs.readFileSync(state.path);
    } catch (err) {
      if (err.code !== "ENOENT") throw err;
      state.scannedBytes = 0;
      state.scannedSeq = 0;
      state.head = null;
      state.brink = null;
      state.ino = null;
      state.mtimeMs = null;
      state.tail = [];
      state.tailBytes = 0;
      return [];
    }

    // The cursor comes off the BUFFER, not off a decoded string. Decoding and
    // re-encoding to measure it turns an invalid byte on disk into a different
    // byte count, and the cursor then points into the middle of a line.
    var lastNewline = buffer.lastIndexOf(NEWLINE);
    var complete = lastNewline === -1 ? 0 : lastNewline + 1;
    state.scannedBytes = complete;
    state.scannedSeq = 0;
    state.ino = stat ? stat.ino : null;
    state.mtimeMs = stat ? stat.mtimeMs : null;
    state.head = complete > 0 ? windowEndingAt(buffer, Math.min(WINDOW_BYTES, complete)) : null;
    state.brink = complete > 0 ? windowEndingAt(buffer, complete) : null;
    state.tail = [];
    state.tailBytes = 0;

    var out = [];
    var from = 0;
    while (from < complete) {
      var at = buffer.indexOf(NEWLINE, from);
      if (at === -1 || at >= complete) break;
      var bytes = at - from;
      if (bytes > 0) {
        var parsed = protocol.parseEventLine(buffer.toString("utf8", from, at));
        if (!parsed.ok) {
          // A line the helper itself cannot read is history it must not
          // silently renumber over. It is reported ONCE, on the first load, and
          // the file is left alone.
          if (opts.report) {
            helperLog("review " + reviewId + " has an unreadable log line: " + parsed.reason);
          }
        } else {
          out.push(parsed.event);
          state.seen[parsed.event[EVENT_ID]] = true;
          if (typeof parsed.event[SEQ] === "number") {
            if (parsed.event[SEQ] > state.seq) state.seq = parsed.event[SEQ];
            if (parsed.event[SEQ] > state.scannedSeq) state.scannedSeq = parsed.event[SEQ];
          }
          remember(state, parsed.event, bytes + 1);
        }
      }
      from = at + 1;
    }
    return out;
  }

  /**
   * The whole lines appended since this reader last looked, and nothing before
   * them.
   *
   * @returns {object[]|null} the parsed events, or null when the file is not a
   *   continuation of what was scanned, which means the cursor is meaningless
   *   and the file has to be read whole.
   *
   * FOUR WAYS A FILE STOPS BEING A CONTINUATION, and all four are checked,
   * because "it got bigger" is not the same as "it grew". A log that was
   * rewritten to the same length or longer passes a size check and then the
   * cursor lands in the middle of a line, and every line the rewrite added
   * before that point is skipped in silence. That matters now and it matters
   * more later: compacting old logs (fix 4 on the memory audit) rewrites a log
   * in place under a running helper, and this is what makes that safe.
   *
   *   it SHRANK, so the cursor is past the end
   *   its INODE changed, so it was replaced rather than appended to
   *   its MTIME moved while its SIZE did not, so it changed without growing,
   *     and an append always grows
   *   its HEAD changed, so its first line is not the first line any more
   *   the 256 bytes ENDING AT THE CURSOR changed, which is where a rewrite that
   *     kept the length shows up, and where the byte before the cursor being a
   *     newline is checked as a side effect
   *
   * What that set does NOT catch is an edit in the middle of a file that keeps
   * the length, moves nothing in either window, and appends at the same time.
   * Catching that means hashing every scanned byte and re-reading the file to
   * compare, which is the cost this whole change exists to avoid. Nothing in
   * this tool writes that way: the log is appended to a whole line at a time,
   * and compaction rewrites it end to end.
   *
   * And one more, about the lines rather than the file: the tail has to be a
   * STRICTLY INCREASING run of seqs. A second reader-writer on the same
   * directory keeps its own idea of the high-water mark and hands out a seq
   * this one has already passed; a hand-written or legacy line carries no seq
   * at all. Either way the tail cannot be filtered by "after the cursor"
   * without losing a line, so it is not a tail, and the file is read whole.
   */
  function readTailInto(state) {
    var stat;
    try {
      stat = fs.statSync(state.path);
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    if (stat.size < state.scannedBytes) return null;
    if (state.ino !== null && stat.ino !== state.ino) return null;
    if (
      state.mtimeMs !== null &&
      stat.size === state.scannedBytes &&
      stat.mtimeMs !== state.mtimeMs
    ) {
      return null;
    }
    if (stat.size === state.scannedBytes && state.scannedBytes === 0) return [];

    var startedAt = state.scannedBytes;
    var fd = fs.openSync(state.path, "r");
    var chunks = [];
    var read = state.scannedBytes;
    try {
      if (state.scannedBytes > 0) {
        if (state.head) {
          var head = Buffer.alloc(state.head.length);
          if (fs.readSync(fd, head, 0, state.head.length, 0) !== state.head.length) return null;
          if (Buffer.compare(head, state.head) !== 0) return null;
        }
        if (state.brink) {
          var brink = Buffer.alloc(state.brink.length);
          var at = state.scannedBytes - state.brink.length;
          if (fs.readSync(fd, brink, 0, state.brink.length, at) !== state.brink.length) return null;
          if (Buffer.compare(brink, state.brink) !== 0) return null;
        }
      }
      if (stat.size === state.scannedBytes) return [];
      for (;;) {
        var buffer = Buffer.alloc(READ_CHUNK_BYTES);
        var got = fs.readSync(fd, buffer, 0, READ_CHUNK_BYTES, read);
        if (got <= 0) break;
        chunks.push(buffer.slice(0, got));
        read += got;
      }
    } finally {
      fs.closeSync(fd);
    }

    // Whole buffer, whole lines: a chunk boundary landing inside a multi-byte
    // character never produces two broken halves, because nothing is decoded
    // until the bytes are joined and split on newlines.
    var tail = Buffer.concat(chunks);
    var lastNewline = tail.lastIndexOf(NEWLINE);
    var complete = lastNewline === -1 ? 0 : lastNewline + 1;
    var out = [];
    var pending = [];
    var highest = state.scannedSeq;
    var from = 0;
    while (from < complete) {
      var at = tail.indexOf(NEWLINE, from);
      if (at === -1 || at >= complete) break;
      if (at - from > 0) {
        var parsed = protocol.parseEventLine(tail.toString("utf8", from, at));
        // Skipped rather than reported, which is exactly what the from-the-top
        // read does with an unreadable line; load() says it out loud, once.
        if (parsed.ok) {
          var seq = parsed.event[SEQ];
          if (typeof seq !== "number" || seq <= highest) return null;
          highest = seq;
          out.push(parsed.event);
          pending.push({ event: parsed.event, bytes: at - from + 1 });
        }
      }
      from = at + 1;
    }
    // Nothing is committed to the cursor or the buffer until the whole tail has
    // proved itself, so a bad line halfway through leaves the reader exactly
    // where it was rather than half-advanced.
    state.scannedSeq = highest;
    pending.forEach(function (entry) {
      remember(state, entry.event, entry.bytes);
    });
    // Anything past the last newline is a torn final line, held in front of the
    // cursor until it is finished, so it is parsed once and whole.
    state.scannedBytes += complete;
    if (complete > 0) {
      // The head is remembered the first time there is one to remember.
      // Nothing has to be re-read for it: a null head means the cursor was at
      // zero, so the bytes just read ARE the head.
      if (state.head === null && startedAt === 0) {
        state.head = windowEndingAt(tail, Math.min(WINDOW_BYTES, complete));
      }
      // The window ending at the new cursor spans the old one when the tail was
      // shorter than the window, so it is built from both rather than re-read.
      state.brink = windowEndingAt(
        state.brink ? Buffer.concat([state.brink, tail.slice(0, complete)]) : tail.slice(0, complete),
        state.brink ? state.brink.length + complete : complete
      );
      state.ino = stat.ino;
      state.mtimeMs = stat.mtimeMs;
    }
    return out;
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
    return scanAll(reviewId, load(reviewId));
  }

  function after(from) {
    return function (event) {
      return typeof event[SEQ] === "number" && event[SEQ] > from;
    };
  }

  /**
   * Events after a cursor. The cursor is a seq, never a timestamp.
   *
   * Three ways this gets answered, cheapest first.
   *
   *   FROM THE TAIL BUFFER, when the buffer reaches back far enough to hold
   *     every event after the cursor. This is the library's reply poll, whose
   *     cursor is the seq the PAGE last saw and so is usually an event or two
   *     behind the reader's own.
   *   FROM THE FILE'S TAIL, when the cursor is at or past everything scanned:
   *     only the bytes after the scan point are read. This is the projector.
   *   FROM THE TOP, when the cursor is older than the buffer reaches, or the
   *     file turned out not to be a continuation of what was scanned.
   */
  function since(reviewId, cursor) {
    var from = typeof cursor === "number" ? cursor : 0;
    var state = load(reviewId);

    // Catch the scan up to the end of the file first, whatever the cursor is:
    // the answer may be in bytes nobody has read yet.
    var tail = readTailInto(state);
    if (tail === null) {
      resetScan(state);
      return scanAll(reviewId, state).filter(after(from));
    }

    // The buffer holds a contiguous run ending at the newest event, so it holds
    // everything after `from` exactly when it starts at or before from + 1.
    if (state.tail.length && state.tail[0].seq <= from + 1) {
      return state.tail
        .filter(function (entry) {
          return entry.seq > from;
        })
        .map(function (entry) {
          return entry.event;
        });
    }
    if (from >= state.scannedSeq) return [];
    return scanAll(reviewId, state).filter(after(from));
  }

  /**
   * How many times this reader has had to start over on a review.
   *
   * It moves when the log turned out to have been rewritten, replaced or
   * truncated rather than appended to. A caller holding state folded from this
   * log compares it with the number it last saw and throws that state away when
   * it differs; there is no way to patch a fold across a rewrite.
   */
  function epoch(reviewId) {
    return load(reviewId).epoch;
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
    epoch: epoch,
    currentSeq: currentSeq,
    helperLog: helperLog
  };
}

module.exports = {
  createEventLog: createEventLog,
  repairTornTail: repairTornTail
};
