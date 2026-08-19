// Reply files: finding them, reading them by byte offset, and folding what
// they say into the log.
//
// Owner: 3A. Architecture D6 (the agent contract is one JSON file, and replies
// are one appended line). The line schema, the per-status required fields, the
// filename pattern, the poll interval, the offset rule and the torn-line rule
// are all protocol.js's and are never restated here.
//
// The whole agent-facing API of this tool is: append one JSON line to a file.
// That means this reader is the thing standing between a stray keystroke in an
// agent's shell and the reviewer's session, so five rules are enforced rather
// than hoped for.
//
//  1. THE HELPER IS THE SINGLE READER. Agents append; nothing but this file
//     reads. Per-agent files exist because one file with several uncoordinated
//     writers is not atomic.
//
//  2. A BAD LINE IS SKIPPED, NEVER FATAL. A helper that exits on one agent's
//     typo takes the reviewer's session with it, which is worse than the
//     failure it reports. The line is skipped, a reply.rejected event names the
//     file, the line number and the reason, and the rail shows a dismissible
//     chip.
//
//  3. A TORN FINAL LINE IS HELD. An agent appending while this reader reads is
//     ordinary. A line with no trailing newline is not parsed at all; the
//     offset stops in front of it and it folds once, whole, on a later pass.
//
//  4. FOLDING IS IDEMPOTENT. The event id for a folded line is derived from the
//     file and the line's bytes, so re-reading a file (which is what happens
//     when an agent rewrites one instead of appending to it) appends nothing
//     the log already holds. Idempotence is by event_id, as everywhere else.
//
//  5. CONFLICTS RESOLVE BY REVISION FIRST, THEN LATEST WINS, WITH BOTH LINES
//     KEPT. Two agents answering one item is not an error; picking silently is.
//     Every line that parsed is folded into the log in arrival order, and
//     arrival order inside one pass is by filename so two machines fold the
//     same two files the same way. The projection then reads the last accepted
//     line for the item's current revision, which is the winner.
//
// A reply naming a STALE revision is refused: the reviewer reworded after the
// agent read the item, so the rewording stays outstanding and the refusal is
// recorded (accepted: false) rather than dropped, so the card can say why.
//
// Node-only. Not in the layer bundle.

"use strict";

var fs = require("node:fs");
var crypto = require("node:crypto");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var record = require("../shared/record.js");
var lifecycle = require("../shared/lifecycle.js");
var stateDir = require("./state_dir.js");

// Read in chunks rather than whole files: a reply file grows for the life of a
// review, and only the tail is new.
var READ_CHUNK_BYTES = 64 * 1024;

/**
 * Every reply file in one review's directory, in a deterministic order.
 *
 * The agent segment of replies-<agent>.jsonl is a PATH COMPONENT, so it goes
 * through protocol.js's pattern and safe-id filter before anything is joined to
 * a path. A reply-shaped name that fails the filter is ignored AND reported: a
 * silently skipped file is an agent whose answers never arrive with nobody able
 * to say why.
 *
 * @returns {{files: object[], ignored: object[]}}
 */
function discover(dir, reviewId) {
  var reviewPath = stateDir.reviewDir(dir, reviewId);
  var entries = [];
  try {
    entries = fs.readdirSync(reviewPath, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return { files: [], ignored: [] };
    throw err;
  }

  var files = [];
  var ignored = [];
  entries.forEach(function (entry) {
    if (!entry.isFile()) return;
    var name = entry.name;
    // Not a reply file at all (review.json, meta.json, events.jsonl, an
    // agent's own notes). Not reported: it was never claiming to be one.
    if (name.indexOf("replies") !== 0 || name.lastIndexOf(".jsonl") !== name.length - 6) return;

    var parsed = protocol.agentFromFilename(name);
    if (!parsed.ok || (parsed.agent !== null && !protocol.isSafeId(parsed.agent))) {
      ignored.push({ file: name, reason: parsed.reason || "the agent segment is not a safe path component" });
      return;
    }
    var full;
    try {
      full = stateDir.replyFilePath(dir, reviewId, name);
    } catch (err) {
      ignored.push({ file: name, reason: err.message });
      return;
    }
    files.push({ file: name, agent: parsed.agent, path: full });
  });

  files.sort(function (a, b) {
    return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
  });
  return { files: files, ignored: ignored };
}

/** Read a file from an offset, returning whole lines and the offset to keep. */
function readFrom(filePath, offset) {
  var stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    if (err.code === "ENOENT") return { lines: [], offset: 0, refolded: false, gone: true };
    throw err;
  }
  var next = protocol.nextReadOffset(offset, stat.size);
  if (stat.size === next.offset) return { lines: [], offset: next.offset, refolded: next.refold, gone: false };

  var fd = fs.openSync(filePath, "r");
  var chunks = [];
  var read = next.offset;
  try {
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

  var text = Buffer.concat(chunks).toString("utf8");
  var split = protocol.splitCompleteLines(text);
  // The remainder is the torn final line, held in front of the offset until it
  // is finished. Measured in BYTES, because the offset is a byte offset and a
  // multi-byte character would otherwise shift it.
  var heldBytes = Buffer.byteLength(split.remainder, "utf8");
  return {
    lines: split.lines,
    offset: read - heldBytes,
    refolded: next.refold,
    held: split.remainder.length > 0,
    gone: false
  };
}

/**
 * The event id for one folded line.
 *
 * Derived from the review, the file and the line's own bytes, which is what
 * makes a re-fold (an agent that rewrote its file, or a helper restart) append
 * nothing new. The same line twice IS the same fold, and saying so once is the
 * honest answer.
 */
function foldEventId(reviewId, file, line) {
  var hash = crypto.createHash("sha256").update(reviewId + "\u001f" + file + "\u001f" + line, "utf8").digest("hex");
  return "rply_" + hash.slice(0, 24);
}

function rejectEventId(reviewId, file, lineNumber, line) {
  var hash = crypto
    .createHash("sha256")
    .update(reviewId + "\u001f" + file + "\u001f" + lineNumber + "\u001f" + line, "utf8")
    .digest("hex");
  return "rjct_" + hash.slice(0, 24);
}

/**
 * The reply folder for one state directory.
 *
 * @param {{dir: string, log: object, items?: function}} options
 *   `items` is how the folder learns what an item looks like right now. It
 *   defaults to reading the log through the projection, and is injectable so a
 *   test can fold against records it built by hand.
 */
function createReplyFolder(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createReplyFolder: dir is required");
  if (!opts.log) throw new Error("createReplyFolder: log is required");
  var dir = opts.dir;
  var log = opts.log;
  // Required lazily: the projection reads folded replies back out of the log,
  // so requiring it at load time would be a cycle.
  var readItems =
    opts.items ||
    function (reviewId) {
      return require("./projection.js").itemsFrom(log.read(reviewId));
    };

  // review id -> {filename -> byte offset}. In memory: on a helper restart
  // every file is re-read from zero and folding is idempotent, which is the
  // cheapest correct answer and one fewer file to keep in step with the log.
  var offsets = Object.create(null);

  function offsetsFor(reviewId) {
    if (!offsets[reviewId]) offsets[reviewId] = Object.create(null);
    return offsets[reviewId];
  }

  function appendEvent(reviewId, fields) {
    return log.append(reviewId, [protocol.newEvent(Object.assign({ review: reviewId }, fields))]);
  }

  function reject(reviewId, file, lineNumber, line, reason) {
    appendEvent(reviewId, {
      event: protocol.EVENT.REPLY_REJECTED,
      event_id: rejectEventId(reviewId, file, lineNumber, line),
      payload: { file: file, line: lineNumber, reason: reason, code: "REPLY_LINE_MALFORMED" }
    });
    log.helperLog(
      "review " + reviewId + ": skipped a malformed reply line, " + file + " line " + lineNumber + ": " + reason
    );
    return { file: file, line: lineNumber, reason: reason };
  }

  /**
   * Fold every new line in every reply file of one review.
   *
   * @returns {{accepted: object[], refused: object[], rejected: object[],
   *            ignoredFiles: object[], refolded: boolean, files: number}}
   */
  function fold(reviewId) {
    stateDir.assertSafeReviewId(reviewId);
    var found = discover(dir, reviewId);
    var seen = offsetsFor(reviewId);
    var accepted = [];
    var refused = [];
    var rejected = [];
    var refolded = false;

    found.ignored.forEach(function (entry) {
      if (seen["!ignored:" + entry.file]) return;
      seen["!ignored:" + entry.file] = true;
      log.helperLog(
        "review " + reviewId + ": ignoring reply file " + JSON.stringify(entry.file) + " (" + entry.reason + ")"
      );
    });

    found.files.forEach(function (entry) {
      var startOffset = seen[entry.file] || 0;
      var read = readFrom(entry.path, startOffset);
      if (read.refolded) refolded = true;
      if (read.refolded) seen["!line:" + entry.file] = 0;
      var lineNumber = read.refolded ? 0 : seen["!line:" + entry.file] || 0;

      read.lines.forEach(function (line) {
        lineNumber += 1;
        if (!line.trim()) return; // a blank line is not a reply and not a mistake
        var parsed = protocol.parseReplyLine(line, { filenameAgent: entry.agent });
        if (!parsed.ok) {
          rejected.push(reject(reviewId, entry.file, lineNumber, line, parsed.reason));
          return;
        }
        var outcome = foldOne(reviewId, entry.file, line, parsed.reply);
        if (outcome.accepted) accepted.push(outcome);
        else refused.push(outcome);
      });

      seen[entry.file] = read.offset;
      seen["!line:" + entry.file] = lineNumber;
    });

    return {
      accepted: accepted,
      refused: refused,
      rejected: rejected,
      ignoredFiles: found.ignored,
      refolded: refolded,
      files: found.files.length
    };
  }

  /**
   * One parsed line against the item it names.
   *
   * lifecycle.applyReply is the ONE decision about what a reply does to an
   * item, so this function asks it and records the answer; it never reasons
   * about states itself.
   */
  function foldOne(reviewId, file, line, reply) {
    var items = readItems(reviewId);
    var item = null;
    for (var i = 0; i < items.length; i += 1) {
      if (items[i][record.FIELD.ID] === reply[protocol.REPLY_FIELD.ITEM]) {
        item = items[i];
        break;
      }
    }

    if (!item) {
      var missing = {
        accepted: false,
        item: reply[protocol.REPLY_FIELD.ITEM],
        file: file,
        reply: reply,
        refusal: "no item " + JSON.stringify(reply[protocol.REPLY_FIELD.ITEM]) + " in this review"
      };
      writeFold(reviewId, file, line, reply, missing);
      return missing;
    }

    // THE CONFLICT RULE, second half. When another agent already answered this
    // exact revision, the item is no longer `ready` and lifecycle would refuse
    // the second answer for a reason that is not the real one: the two lines are
    // rivals, not a sequence. So the rival is judged against the state the item
    // was in before the first answer, which is `ready`, and latest wins. A reply
    // naming any OTHER revision still goes through the ordinary path and is
    // still refused as stale.
    var against = item;
    if (item[record.FIELD.REPLY] && item[record.FIELD.REV] === reply[protocol.REPLY_FIELD.REV]) {
      against = Object.assign({}, item);
      against[record.FIELD.STATE] = record.STATE.READY;
    }

    var decision = lifecycle.applyReply(against, {
      rev: reply[protocol.REPLY_FIELD.REV],
      status: reply[protocol.REPLY_FIELD.STATUS],
      agent: reply[protocol.REPLY_FIELD.AGENT],
      reason: reply[protocol.REPLY_FIELD.REASON],
      text: reply[protocol.REPLY_FIELD.TEXT],
      files: reply[protocol.REPLY_FIELD.FILES]
    });

    var outcome = {
      accepted: decision.accepted,
      item: item[record.FIELD.ID],
      rev: reply[protocol.REPLY_FIELD.REV],
      state: decision.state,
      file: file,
      reply: reply,
      refusal: decision.refusal
    };
    writeFold(reviewId, file, line, reply, outcome);
    return outcome;
  }

  /**
   * Both outcomes go in the log, accepted or not.
   *
   * Both, because the reviewer has to be able to see that an agent answered and
   * was refused: an item that silently stays outstanding while an agent
   * believes it is done is the exact stall this tool exists to remove. Agent
   * text is carried as data (D12) and is never rendered as markup anywhere.
   */
    function writeFold(reviewId, file, line, reply, outcome) {
    appendEvent(reviewId, {
      event: protocol.EVENT.REPLY_FOLDED,
      event_id: foldEventId(reviewId, file, line),
      item: reply[protocol.REPLY_FIELD.ITEM],
      rev: reply[protocol.REPLY_FIELD.REV],
      payload: {
        accepted: outcome.accepted === true,
        state: outcome.state || null,
        refusal: outcome.refusal || null,
        file: file,
        reply: {
          status: reply[protocol.REPLY_FIELD.STATUS],
          agent: reply[protocol.REPLY_FIELD.AGENT],
          reason: reply[protocol.REPLY_FIELD.REASON],
          text: reply[protocol.REPLY_FIELD.TEXT],
          files: reply[protocol.REPLY_FIELD.FILES],
          // The agent's own judgment about whether this answer is worth
          // interrupting the reviewer for. Carried through the fold because the
          // badge in the rail is the only thing that reads it, and the rail
          // only ever sees what the helper folded.
          user_needs_to_see_reply: reply[protocol.REPLY_FIELD.NEEDS_SEE] === true
        }
      }
    });
  }

  return {
    fold: fold,
    discover: function (reviewId) {
      return discover(dir, reviewId);
    },
    offsets: function (reviewId) {
      return Object.assign({}, offsetsFor(reviewId));
    }
  };
}

module.exports = {
  READ_CHUNK_BYTES: READ_CHUNK_BYTES,
  discover: discover,
  readFrom: readFrom,
  foldEventId: foldEventId,
  createReplyFolder: createReplyFolder
};
