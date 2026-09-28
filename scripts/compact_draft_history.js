#!/usr/bin/env node
// A one-time repair: take the superseded draft snapshots out of events.jsonl.
//
// Before the draft write-cost fix (docs/features/20260922.01_draft_write_cost),
// the browser posted the whole record on about every keystroke, so a review's
// log holds long runs of `item.content` events marked `draft: true`, each one
// replaced by the next. That is bloat the tool caused, not history anybody
// wrote, and it is most of the bytes on disk. This script drops those events
// and keeps everything else byte for byte, in order.
//
// THE RULE. An event is dropped only when all of these hold:
//
//   1. it is `item.content` with `draft: true`, and it carries a usable record
//   2. the NEXT event in the log for the same item is also `item.content`,
//      with a usable record (the one that replaces it)
//   3. folding that next event gives the same item, the same reply revision,
//      and the same place in the item order whether or not the draft came
//      first. This is checked with the repo's own fold (projection.js
//      foldEvents), on the item's slice of the fold state.
//   4. if the item has no state yet when the draft arrives (its first sighting,
//      or the first after a delete), no other item's record event sits between
//      the draft and its replacement, since dropping the draft would move the
//      item's first-seen position past that other item.
//
// Rules 2 to 4 narrow "a later item.content for the same item exists" to the
// cases where nothing can read the dropped draft. Why each exists is written
// down in docs/features/20260928.02_compact_draft_history/NOTES.md.
//
// THE PROOF, PER REVIEW, BEFORE ANY SWAP. Both logs are parsed with the
// helper's own line parser and folded from the top with the repo's own
// projection code. The review is left alone unless all of these match:
//
//   - the whole fold state: every item (drafts included), the item order, the
//     reply revisions, the review's times, the source hint, the high seq
//   - the review.json bytes, with `generated_at` pinned (IGNORED_FIELDS)
//   - the list of malformed item events the fold reports
//
// THE WRITE. The compacted log goes to a temp file in the same folder and is
// fsynced. The original is gzipped to `events.jsonl.pre-compact.gz` beside it,
// fsynced, and read back to confirm it restores the exact bytes. Then the temp
// file is renamed over `events.jsonl`. review.json, meta.json and reply files
// are never opened for writing.
//
// NEVER RACE THE HELPER. The helper keeps no per-review lock a script could
// take, so the script refuses to run at all while the helper or any static
// server is running (service.json and the static server records, with a live
// pid). As a second guard, the log is stat'ed again right before the rename;
// if it changed since it was read, that review is left alone.
//
// Dry run by default. `--apply` does the writes.
//
//   node scripts/compact_draft_history.js [--apply] [--review <id>]
//                                         [--state-dir <path>] [--json]
//
// Node core modules only, like the rest of the tool.

"use strict";

var fs = require("node:fs");
var path = require("node:path");
var zlib = require("node:zlib");

var protocol = require("../src/shared/protocol.js");
var projection = require("../src/service/projection.js");
var stateDir = require("../src/service/state_dir.js");

var EVENT = protocol.EVENT;
var EF = protocol.EVENT_FIELD;
var NEWLINE = 0x0a;

// Fields of the projection that are made fresh on every projection rather
// than read off the log. They are pinned to one value on both sides before
// the bytes are compared. `linked_files` is not here: the proof passes no
// static-server lookup to either side, so both sides get the same map, built
// from the items' page paths, which ARE compared.
var IGNORED_FIELDS = ["generated_at"];
var PINNED_GENERATED_AT = "1970-01-01T00:00:00.000Z";

var BACKUP_SUFFIX = ".pre-compact.gz";

// ---------------------------------------------------------------------------
// Reading a log the way the helper does
// ---------------------------------------------------------------------------

/**
 * Split a log into lines, keeping each line's exact bytes.
 *
 * `event` is the parsed event for a complete, readable line, and null for an
 * empty line, an unreadable line, or a torn final line with no newline. The
 * helper's reader (log.js scanAll) skips exactly those, with the same parser.
 */
function splitLines(buffer) {
  var lines = [];
  var from = 0;
  while (from < buffer.length) {
    var at = buffer.indexOf(NEWLINE, from);
    var terminated = at !== -1;
    var end = terminated ? at + 1 : buffer.length;
    var event = null;
    if (terminated && at > from) {
      var parsed = protocol.parseEventLine(buffer.toString("utf8", from, at));
      if (parsed.ok) event = parsed.event;
    }
    lines.push({ start: from, end: end, event: event });
    from = end;
  }
  return lines;
}

function eventsOf(lines) {
  var out = [];
  lines.forEach(function (line) {
    if (line.event) out.push(line.event);
  });
  return out;
}

function isRecordEvent(event) {
  var type = event[EF.EVENT];
  return type === EVENT.ITEM_CREATED || type === EVENT.ITEM_CONTENT || type === EVENT.ITEM_READY;
}

/**
 * The item an event touches, the way the fold decides it: a record event by
 * its envelope item id, else its record's id (projection.js recordFromEvent);
 * every other event by its envelope item id. Null for a malformed record
 * event, which the fold drops without reading any state.
 */
function itemOf(event) {
  if (isRecordEvent(event)) {
    var carried = event.record;
    if (!carried || typeof carried !== "object") return null;
    var id = typeof event[EF.ITEM] === "string" ? event[EF.ITEM] : carried.id;
    return id ? id : null;
  }
  return typeof event[EF.ITEM] === "string" && event[EF.ITEM] ? event[EF.ITEM] : null;
}

// ---------------------------------------------------------------------------
// Deciding what to drop
// ---------------------------------------------------------------------------

/** Structural equality, key order ignored, with a fast path for shared refs. */
function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  var ka = Object.keys(a);
  var kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (var j = 0; j < ka.length; j += 1) {
    if (!Object.prototype.hasOwnProperty.call(b, ka[j])) return false;
    if (!deepEqual(a[ka[j]], b[ka[j]])) return false;
  }
  return true;
}

/**
 * One item's slice of a fold, as a fold of its own.
 *
 * The fold's item branch reads exactly three things about the item it is
 * folding: its current record, the revision its current reply answered, and
 * whether it is already in the order. Nothing about any other item. So a fold
 * holding only this item's slice folds the item's events exactly as the whole
 * fold would. Records are never mutated by the fold (it replaces them), so the
 * slice can share them.
 */
function sliceOf(state, id) {
  var slice = projection.createFold();
  if (state.byId[id]) {
    slice.byId[id] = state.byId[id];
    slice.order.push(id);
  }
  if (Object.prototype.hasOwnProperty.call(state.replyRev, id)) slice.replyRev[id] = state.replyRev[id];
  return slice;
}

function sameSlice(a, b, id) {
  var aHas = Object.prototype.hasOwnProperty.call(a.replyRev, id);
  var bHas = Object.prototype.hasOwnProperty.call(b.replyRev, id);
  if (aHas !== bHas) return false;
  if (aHas && a.replyRev[id] !== b.replyRev[id]) return false;
  if ((a.order.indexOf(id) !== -1) !== (b.order.indexOf(id) !== -1)) return false;
  return deepEqual(a.byId[id], b.byId[id]);
}

/**
 * Which lines to drop, and why the rest of the drafts were kept.
 *
 * One forward pass. `kept` is the fold of every line NOT dropped, so each
 * decision is made against the state the compacted log will really have at
 * that point. By induction the compacted fold matches the original after every
 * kept event: a drop is only allowed when the item's next event folds to the
 * same state with or without it, and nothing between the two touches the item.
 *
 * @param {object[]} lines from splitLines
 * @returns {{drops: Set<number>, narrowed: object, drafts: number}}
 */
function planDrops(lines) {
  // For every line, the index of the next line that touches the same item.
  var nextTouch = new Array(lines.length).fill(-1);
  var lastSeen = Object.create(null);
  var touches = new Array(lines.length).fill(null);
  for (var i = lines.length - 1; i >= 0; i -= 1) {
    var ev = lines[i].event;
    if (!ev) continue;
    var id = itemOf(ev);
    if (!id) continue;
    touches[i] = id;
    nextTouch[i] = Object.prototype.hasOwnProperty.call(lastSeen, id) ? lastSeen[id] : -1;
    lastSeen[id] = i;
  }

  var drops = new Set();
  var narrowed = { next_not_content: 0, fold_differs: 0, order_would_move: 0 };
  var lastDrafts = 0;
  var drafts = 0;
  var kept = projection.createFold();

  for (var k = 0; k < lines.length; k += 1) {
    var event = lines[k].event;
    if (!event) continue;
    if (
      event[EF.EVENT] === EVENT.ITEM_CONTENT &&
      event.draft === true &&
      touches[k] !== null
    ) {
      drafts += 1;
      var decision = decide(lines, k, touches, nextTouch, kept);
      if (decision === "drop") {
        drops.add(k);
        continue;
      }
      if (decision === "last") lastDrafts += 1;
      else narrowed[decision] += 1;
    }
    projection.foldEvents(kept, [event]);
  }
  return { drops: drops, narrowed: narrowed, drafts: drafts, last_drafts: lastDrafts };
}

function decide(lines, k, touches, nextTouch, kept) {
  var id = touches[k];
  var draft = lines[k].event;

  // Is any later item.content for this item at all? If not, this is the
  // item's last draft snapshot, which the rule itself keeps.
  var n = nextTouch[k];
  var laterContent = false;
  for (var scan = n; scan !== -1; scan = nextTouch[scan]) {
    if (lines[scan].event[EF.EVENT] === EVENT.ITEM_CONTENT) {
      laterContent = true;
      break;
    }
  }
  if (!laterContent) return "last";

  var next = lines[n].event;
  if (next[EF.EVENT] !== EVENT.ITEM_CONTENT) return "next_not_content";

  var withDraft = projection.foldEvents(sliceOf(kept, id), [draft, next]);
  var without = projection.foldEvents(sliceOf(kept, id), [next]);
  if (!sameSlice(withDraft, without, id)) return "fold_differs";

  if (!kept.byId[id]) {
    for (var j = k + 1; j < n; j += 1) {
      var between = lines[j].event;
      if (between && isRecordEvent(between) && touches[j] !== null && touches[j] !== id) {
        return "order_would_move";
      }
    }
  }
  return "drop";
}

/** The compacted bytes: every line not dropped, exactly as it was. */
function assemble(buffer, lines, drops) {
  var parts = [];
  lines.forEach(function (line, i) {
    if (!drops.has(i)) parts.push(buffer.subarray(line.start, line.end));
  });
  return Buffer.concat(parts);
}

/**
 * Plan and assemble one log. Pure: reads nothing and writes nothing.
 *
 * @param {Buffer} buffer the whole events.jsonl
 * @param {string} reviewId
 * @param {function} [planner] replaces planDrops, for tests only
 */
function compactBuffer(buffer, reviewId, planner) {
  var lines = splitLines(buffer);
  var plan = (planner || planDrops)(lines, reviewId);
  var narrowed = Object.assign({ next_not_content: 0, fold_differs: 0, order_would_move: 0 }, plan.narrowed || {});
  return {
    compacted: assemble(buffer, lines, plan.drops),
    dropped: plan.drops.size,
    narrowed: narrowed,
    drafts: plan.drafts || 0,
    last_drafts: plan.last_drafts || 0
  };
}

// ---------------------------------------------------------------------------
// The proof
// ---------------------------------------------------------------------------

function foldAll(events) {
  var reported = [];
  var state = projection.foldEvents(projection.createFold(), events, {
    onDropped: function (event) {
      reported.push(event[EF.EVENT_ID] || null);
    }
  });
  return { state: state, reported: reported };
}

function projectedBytes(reviewId, state) {
  var projected = projection.projectFold(reviewId, state, { generated_at: PINNED_GENERATED_AT });
  IGNORED_FIELDS.forEach(function (field) {
    if (Object.prototype.hasOwnProperty.call(projected, field)) projected[field] = PINNED_GENERATED_AT;
  });
  return projection.stringify(projected);
}

/**
 * Fold both logs from the top and compare everything the log feeds.
 *
 * @returns {{same: boolean, reason: string|null}}
 */
function proveSame(originalBuffer, compactedBuffer, reviewId) {
  var a = foldAll(eventsOf(splitLines(originalBuffer)));
  var b = foldAll(eventsOf(splitLines(compactedBuffer)));
  var checks = [
    ["the items, drafts included", a.state.byId, b.state.byId],
    ["the item order", a.state.order, b.state.order],
    ["the reply revisions", a.state.replyRev, b.state.replyRev],
    ["the review's times", a.state.times, b.state.times],
    ["the source hint", a.state.sourcePath, b.state.sourcePath],
    ["the high seq", a.state.seq, b.state.seq],
    ["the malformed events the fold reports", a.reported, b.reported]
  ];
  for (var i = 0; i < checks.length; i += 1) {
    if (!deepEqual(checks[i][1], checks[i][2])) {
      return { same: false, reason: "the folds differ in " + checks[i][0] };
    }
  }
  if (projectedBytes(reviewId, a.state) !== projectedBytes(reviewId, b.state)) {
    return { same: false, reason: "the review.json bytes differ" };
  }
  return { same: true, reason: null };
}

// ---------------------------------------------------------------------------
// The write
// ---------------------------------------------------------------------------

function writeSynced(target, bytes) {
  var fd = fs.openSync(target, "wx", stateDir.FILE_MODE);
  try {
    var at = 0;
    while (at < bytes.length) at += fs.writeSync(fd, bytes, at, bytes.length - at);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDir(dir) {
  var fd;
  try {
    fd = fs.openSync(dir, "r");
    fs.fsyncSync(fd);
  } catch (err) {
    // Some platforms cannot fsync a directory; the rename is still atomic.
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function sameFile(a, b) {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino;
}

function removeQuietly(target) {
  try { fs.unlinkSync(target); } catch (err) { /* already gone */ }
}

/**
 * Compact one review. Dry run unless `apply`.
 *
 * @param {{dir: string, review: string, apply?: boolean, planner?: function}} args
 * @returns {object} the report line for this review
 */
function compactReview(args) {
  var reviewId = args.review;
  var report = {
    review: reviewId,
    bytes_before: 0,
    bytes_after: 0,
    dropped: 0,
    drafts: 0,
    last_drafts: 0,
    narrowed: { next_not_content: 0, fold_differs: 0, order_would_move: 0 },
    check: "not run",
    applied: false,
    reason: null
  };
  var eventsPath;
  try {
    eventsPath = stateDir.eventsPath(args.dir, reviewId);
  } catch (err) {
    report.reason = err.message;
    return report;
  }
  if (!fs.existsSync(eventsPath)) {
    report.reason = "no events.jsonl";
    return report;
  }

  var statBefore = fs.statSync(eventsPath);
  var original = fs.readFileSync(eventsPath);
  report.bytes_before = original.length;
  report.bytes_after = original.length;

  var result = compactBuffer(original, reviewId, args.planner);
  report.drafts = result.drafts;
  report.last_drafts = result.last_drafts;
  report.narrowed = result.narrowed;
  if (result.dropped === 0) {
    report.check = "nothing to drop";
    return report;
  }

  var proof = proveSame(original, result.compacted, reviewId);
  report.check = proof.same ? "passed" : "failed";
  if (!proof.same) {
    report.reason = proof.reason + "; this review is left alone";
    return report;
  }
  report.dropped = result.dropped;
  report.bytes_after = result.compacted.length;
  if (!args.apply) return report;

  var backupPath = eventsPath + BACKUP_SUFFIX;
  if (fs.existsSync(backupPath)) {
    report.reason = path.basename(backupPath) + " already exists from an earlier run, and it is the true original; this review is left alone";
    return report;
  }

  var stamp = process.pid + "." + Date.now();
  var tempLog = eventsPath + ".compact." + stamp + ".tmp";
  var tempBackup = backupPath + "." + stamp + ".tmp";
  var backupWritten = false;
  try {
    writeSynced(tempBackup, zlib.gzipSync(original, { level: 9 }));
    if (!zlib.gunzipSync(fs.readFileSync(tempBackup)).equals(original)) {
      throw new Error("the gzipped original did not read back to the same bytes");
    }
    stateDir.assertNotSymlink(backupPath);
    fs.renameSync(tempBackup, backupPath);
    backupWritten = true;

    writeSynced(tempLog, result.compacted);

    // The second guard against a writer that started after the refusal check.
    stateDir.assertNotSymlink(eventsPath);
    if (!sameFile(statBefore, fs.statSync(eventsPath))) {
      throw new Error("events.jsonl changed while it was being compacted (something appended to it)");
    }
    fs.renameSync(tempLog, eventsPath);
    fsyncDir(path.dirname(eventsPath));

    if (!fs.readFileSync(eventsPath).equals(result.compacted)) {
      // The swap happened and the bytes are not what was proven. Say so loudly:
      // the gz beside it restores the original.
      report.applied = true;
      report.reason = "the log read back differently after the swap; restore it from " + path.basename(backupPath);
      return report;
    }
    report.applied = true;
    return report;
  } catch (err) {
    removeQuietly(tempLog);
    removeQuietly(tempBackup);
    if (backupWritten) removeQuietly(backupPath);
    fsyncDir(path.dirname(eventsPath));
    report.reason = err.message + "; this review is left alone";
    return report;
  }
}

// ---------------------------------------------------------------------------
// Never race the helper
// ---------------------------------------------------------------------------

function isAlive(pid) {
  if (typeof pid !== "number" || !(pid > 0)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { return null; }
}

/**
 * Everything running that could append to a review log: the helper (its
 * service.json names a live pid) and any static server (an unstopped record
 * naming a live pid). A pid that answers is treated as running even when it
 * might be a reused pid, because the cost of a wrong "running" is a refusal
 * and the cost of a wrong "stopped" is a lost event.
 */
function runningProcesses(dir) {
  var found = [];
  var ready = readJson(stateDir.readyPath(dir));
  if (ready && isAlive(ready.pid)) {
    found.push({
      what: "the lahe helper",
      pid: ready.pid,
      detail: typeof ready.port === "number" ? "port " + ready.port : null,
      stop: "`lahe session close <session-id>` for each open agent session (the last close also stops the helper), or `kill " + ready.pid + "`"
    });
  }
  var sessionsRoot = stateDir.agentSessionsRoot(dir);
  var sessions = [];
  try { sessions = fs.readdirSync(sessionsRoot); } catch (err) { sessions = []; }
  sessions.sort().forEach(function (session) {
    var root = path.join(sessionsRoot, session, stateDir.STATIC_SERVERS_DIR);
    var files = [];
    try { files = fs.readdirSync(root); } catch (err) { files = []; }
    files.sort().forEach(function (name) {
      if (!/^ss_[A-Za-z0-9_-]+\.json$/.test(name)) return;
      var meta = readJson(path.join(root, name));
      if (!meta || meta.stopped_at || !isAlive(meta.pid)) return;
      found.push({
        what: "a lahe static server",
        pid: meta.pid,
        detail: "session " + session + (typeof meta.port === "number" ? ", port " + meta.port : ""),
        stop: "`lahe session close " + session + "`, or `kill " + meta.pid + "`"
      });
    });
  });
  return found;
}

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  var out = { apply: false, review: null, stateDir: null, json: false, help: false };
  for (var i = 0; i < argv.length; i += 1) {
    var arg = argv[i];
    if (arg === "--apply") out.apply = true;
    else if (arg === "--json") out.json = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg === "--review" || arg === "--state-dir") {
      var value = argv[i + 1];
      if (typeof value !== "string" || !value || value.indexOf("--") === 0) {
        throw new Error(arg + " needs a value");
      }
      if (arg === "--review") out.review = value;
      else out.stateDir = value;
      i += 1;
    } else {
      throw new Error("unknown argument " + JSON.stringify(arg));
    }
  }
  return out;
}

var USAGE =
  "Usage: node scripts/compact_draft_history.js [--apply] [--review <id>] [--state-dir <path>] [--json]\n" +
  "Drops superseded draft snapshots from each review's events.jsonl. Dry run unless --apply.\n";

function reviewIds(dir) {
  var root = stateDir.reviewsRoot(dir);
  var names;
  try { names = fs.readdirSync(root, { withFileTypes: true }); } catch (err) { return []; }
  return names
    .filter(function (entry) {
      return entry.isDirectory() && protocol.isSafeId(entry.name);
    })
    .map(function (entry) {
      return entry.name;
    })
    .sort();
}

function mb(bytes) {
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

function totalsOf(reports) {
  var totals = {
    reviews: reports.length,
    with_drops: 0,
    bytes_before: 0,
    bytes_after: 0,
    dropped: 0,
    drafts: 0,
    last_drafts: 0,
    narrowed: { next_not_content: 0, fold_differs: 0, order_would_move: 0 },
    check_passed: 0,
    check_failed: 0,
    nothing_to_drop: 0,
    applied: 0,
    left_alone: 0
  };
  reports.forEach(function (r) {
    totals.bytes_before += r.bytes_before;
    totals.bytes_after += r.bytes_after;
    totals.dropped += r.dropped;
    totals.drafts += r.drafts;
    totals.last_drafts += r.last_drafts;
    Object.keys(totals.narrowed).forEach(function (k) {
      totals.narrowed[k] += r.narrowed[k] || 0;
    });
    if (r.dropped > 0) totals.with_drops += 1;
    if (r.check === "passed") totals.check_passed += 1;
    if (r.check === "failed") totals.check_failed += 1;
    if (r.check === "nothing to drop") totals.nothing_to_drop += 1;
    if (r.applied) totals.applied += 1;
    if (r.reason) totals.left_alone += 1;
  });
  return totals;
}

/**
 * @param {string[]} argv
 * @param {{stdout?: {write: function}, stderr?: {write: function}}} [io]
 * @returns {number} exit code: 0 done, 1 usage, 2 refused (something running),
 *   3 done but at least one review was left alone
 */
function main(argv, io) {
  var stdout = (io && io.stdout) || process.stdout;
  var stderr = (io && io.stderr) || process.stderr;
  var args;
  try {
    args = parseArgs(argv || []);
  } catch (err) {
    stderr.write(err.message + "\n" + USAGE);
    return 1;
  }
  if (args.help) {
    stdout.write(USAGE);
    return 0;
  }

  var dir;
  try {
    dir = stateDir.stateDir({ dir: args.stateDir || undefined });
  } catch (err) {
    stderr.write(err.message + "\n");
    return 1;
  }

  var running = runningProcesses(dir);
  if (running.length) {
    var lines = ["Refusing to run: something that appends to review logs is running in " + dir + "."];
    running.forEach(function (p) {
      lines.push("  " + p.what + " (pid " + p.pid + (p.detail ? ", " + p.detail : "") + "). Stop it with " + p.stop + ".");
    });
    lines.push("A compaction racing an append could lose that event. Stop them, then run this again.");
    lines.push("If a pid above is not a lahe process (a record can outlive a crash), check it with `ps -p <pid>`.");
    stderr.write(lines.join("\n") + "\n");
    return 2;
  }

  var ids;
  if (args.review) {
    if (!protocol.isSafeId(args.review)) {
      stderr.write("not a review id: " + JSON.stringify(args.review) + "\n");
      return 1;
    }
    ids = [args.review];
  } else {
    ids = reviewIds(dir);
  }

  var header = args.apply
    ? "Applying: compacting review logs in " + dir
    : "Dry run: nothing is written. Add --apply to compact. State directory: " + dir;
  if (!args.json) stdout.write(header + "\n");

  var reports = [];
  ids.forEach(function (id) {
    var r = compactReview({ dir: dir, review: id, apply: args.apply });
    reports.push(r);
    if (args.json) return;
    stdout.write(
      [
        r.review,
        "bytes before: " + r.bytes_before,
        "bytes after: " + r.bytes_after,
        "events dropped: " + r.dropped,
        "check: " + r.check,
        args.apply ? (r.applied ? "applied" : "not applied") : null,
        r.reason ? "(" + r.reason + ")" : null
      ]
        .filter(Boolean)
        .join("  ") + "\n"
    );
  });

  var totals = totalsOf(reports);
  if (args.json) {
    stdout.write(JSON.stringify({ dir: dir, apply: args.apply, ignored_fields: IGNORED_FIELDS, totals: totals, reviews: reports }, null, 2) + "\n");
  } else {
    stdout.write(
      [
        "",
        "Total over " + totals.reviews + " reviews (" + totals.with_drops + " with drafts to drop):",
        "  bytes before: " + totals.bytes_before + " (" + mb(totals.bytes_before) + ")",
        "  bytes after: " + totals.bytes_after + " (" + mb(totals.bytes_after) + ")",
        "  events dropped: " + totals.dropped + " of " + totals.drafts + " draft item.content events",
        "  kept as the item's last draft: " + totals.last_drafts,
        "  kept by the narrowing: next event is not item.content " + totals.narrowed.next_not_content +
          ", fold would differ " + totals.narrowed.fold_differs +
          ", item order would move " + totals.narrowed.order_would_move,
        "  projection check: passed " + totals.check_passed + ", failed " + totals.check_failed +
          ", nothing to drop " + totals.nothing_to_drop,
        args.apply ? "  applied: " + totals.applied : null,
        "  left alone with a reason: " + totals.left_alone,
        "  ignored when comparing projections: " + IGNORED_FIELDS.join(", ")
      ]
        .filter(function (line) {
          return line !== null;
        })
        .join("\n") + "\n"
    );
  }
  return totals.left_alone > 0 ? 3 : 0;
}

module.exports = {
  IGNORED_FIELDS: IGNORED_FIELDS,
  splitLines: splitLines,
  planDrops: planDrops,
  compactBuffer: compactBuffer,
  proveSame: proveSame,
  compactReview: compactReview,
  runningProcesses: runningProcesses,
  main: main
};

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}
