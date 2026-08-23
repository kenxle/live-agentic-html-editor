// The projection: the append-only log read back into the current state of a
// review, and from there into `review.json` and into the reply state the
// library polls.
//
// Owner: 3A. Imported by: the helper (src/service/index.js hands it to the
// router as deps.projection), the `review.read` route, status, and the reply
// folder.
//
// Architecture D5 (the log is the source of truth and everything else is a
// projection of it), D6 (the agent contract is one JSON file), and D12 (page
// text is data, reviewer text is intent). The BYTES of review.json are
// src/shared/review_format.js's, frozen at CP0; this file decides WHAT goes
// into it and src/service/review_writer.js decides where it lands.
//
// Three rules live here and nowhere else.
//
//  1. THE RECORD RIDES IN THE EVENT. The library posts each item as a whole
//     record inside its event (sync.js's `record` payload), so replaying the
//     log means taking the newest record for each item. There is no field-level
//     event vocabulary to keep in step with the record shape.
//
//  2. LIFECYCLE IS PER REVISION (D5's merge rule: the browser wins on content,
//     the store wins on lifecycle, per revision). A folded reply owns the item's
//     state only for the revision it named. A record arriving at a HIGHER
//     revision is the reviewer rewording after the agent answered, so the
//     agent's answer is dropped and the item is outstanding again. A record
//     arriving at the SAME revision is the ordinary re-post of something the
//     helper already knows, and it must not resurrect `ready` over `handled`.
//
//  3. DRAFTS ARE NOT IN THE FILE (R7). A draft is the reviewer mid-sentence.
//     They are durable in the log and they are on the reviewer's rail, and they
//     do not reach an agent at all, so they are withheld from the projection
//     rather than labelled inside it. Ranked test 20 is this rule with its
//     positive control.
//
// Node-only. Not in the layer bundle.

"use strict";

var protocol = require("../shared/protocol.js");
var record = require("../shared/record.js");
var lifecycle = require("../shared/lifecycle.js");
var reviewFormat = require("../shared/review_format.js");
var reviewWriter = require("./review_writer.js");
var stateDir = require("./state_dir.js");
var fs = require("node:fs");
var replies = require("./replies.js");

var EVENT = protocol.EVENT;
var F = record.FIELD;

// ---------------------------------------------------------------------------
// The log, read back into items
// ---------------------------------------------------------------------------

function recordFromEvent(event) {
  var carried = event.record;
  if (!carried || typeof carried !== "object") return null;
  var copy = Object.assign({}, carried);
  // The event's own item id and revision are the wire's, and the record's are
  // the browser's. They agree in every ordinary case; when they do not, the
  // envelope is what the helper indexed by, so it wins.
  if (typeof event[protocol.EVENT_FIELD.ITEM] === "string") copy[F.ID] = event[protocol.EVENT_FIELD.ITEM];
  if (typeof event[protocol.EVENT_FIELD.REV] === "number") copy[F.REV] = event[protocol.EVENT_FIELD.REV];
  return copy;
}

/**
 * Every item a review currently holds, drafts included, in first-seen order.
 *
 * @param {object[]} events every event for one review, in seq order
 * @returns {object[]} records, each carrying its folded reply in `reply`
 */
function itemsFrom(events, options) {
  var opts = options || {};
  var onDropped = typeof opts.onDropped === "function" ? opts.onDropped : null;
  var byId = Object.create(null);
  var order = [];
  // id -> the revision the current reply answered. Rule 2 above reads it.
  var replyRev = Object.create(null);

  (events || []).forEach(function (event) {
    var type = event[protocol.EVENT_FIELD.EVENT];
    var id = event[protocol.EVENT_FIELD.ITEM];

    if (type === EVENT.ITEM_CREATED || type === EVENT.ITEM_CONTENT || type === EVENT.ITEM_READY) {
      var next = recordFromEvent(event);
      if (!next || !next[F.ID]) {
        // A malformed item event: the log accepted it (the type is known) but it
        // carries no usable record. Dropping it silently is asymmetric with the
        // reply path, which reports a rejected line (NEW-5). Report it so the
        // drop is on the record rather than invisible.
        if (onDropped) {
          onDropped(event, !next ? "the event carried no record object" : "the carried record has no id");
        }
        return;
      }
      var prev = byId[next[F.ID]];
      if (!prev) order.push(next[F.ID]);
      // A continuation is composed against the reply the browser last saw.
      // Another same-revision reply may have become the helper's deterministic
      // winner before this event arrived. Keep that winner in the archived
      // round rather than letting the carried browser snapshot erase it.
      if (
        prev &&
        prev[F.REPLY] &&
        next[F.REV] === prev[F.REV] + 1 &&
        Array.isArray(next[F.THREAD]) &&
        next[F.THREAD].length === record.threadOf(prev).length + 1
      ) {
        var rounds = next[F.THREAD].slice();
        var lastRound = Object.assign({}, rounds[rounds.length - 1]);
        lastRound.agent = Object.assign({}, prev[F.REPLY]);
        rounds[rounds.length - 1] = lastRound;
        next[F.THREAD] = rounds;
      }
      if (prev && prev[F.REPLY] && replyRev[next[F.ID]] === next[F.REV]) {
        // Same revision: the helper's lifecycle stands, the browser's content
        // is taken. This is D5's merge rule, on the helper's side of the wire.
        next[F.REPLY] = prev[F.REPLY];
        next[F.STATE] = prev[F.STATE];
      } else {
        next[F.REPLY] = null;
        delete replyRev[next[F.ID]];
      }
      byId[next[F.ID]] = next;
      return;
    }

    if (type === EVENT.ITEM_DELETED) {
      if (!id || !byId[id]) return;
      delete byId[id];
      delete replyRev[id];
      order = order.filter(function (each) {
        return each !== id;
      });
      return;
    }

    if (type === EVENT.ITEM_REOPENED) {
      if (!id || !byId[id]) return;
      // R38: the reviewer reopens a handled item whose fix did not land. The
      // agent's answer is superseded by the reopening, so it comes off the
      // item; the line that carried it is still in the log.
      var reopened = Object.assign({}, byId[id]);
      reopened[F.STATE] = record.STATE.READY;
      reopened[F.REPLY] = null;
      byId[id] = reopened;
      delete replyRev[id];
      return;
    }

    if (type === EVENT.REPLY_FOLDED) {
      if (!id || !byId[id] || event.accepted !== true) return;
      var item = byId[id];
      // A reply only ever owns the revision it named. Anything else was already
      // refused at fold time, and this is the second guard on the same rule.
      if (item[F.REV] !== event[protocol.EVENT_FIELD.REV]) return;
      var applied = Object.assign({}, item);
      applied[F.STATE] = event.state || item[F.STATE];
      applied[F.REPLY] = Object.assign({}, event.reply, { at: event[protocol.EVENT_FIELD.TS] || null });
      byId[id] = applied;
      replyRev[id] = item[F.REV];
    }
  });

  return order
    .filter(function (id) {
      return !!byId[id];
    })
    .map(function (id) {
      return byId[id];
    });
}

/** The items an agent may act on: everything except the reviewer's drafts. */
function actionableItems(items) {
  return (items || []).filter(function (item) {
    return !record.isDraft(item);
  });
}

/** The review's own timestamps, read off the log rather than off a clock. */
function reviewTimes(events) {
  var out = { started_at: null, ended_at: null, agent_session_id: "legacy" };
  (events || []).forEach(function (event) {
    var type = event[protocol.EVENT_FIELD.EVENT];
    var ts = event[protocol.EVENT_FIELD.TS] || null;
    if (type === EVENT.REVIEW_CREATED) {
      if (!out.started_at) out.started_at = ts;
      if (typeof event.agent_session_id === "string") out.agent_session_id = event.agent_session_id;
    }
    if (type === EVENT.REVIEW_ARCHIVED) out.ended_at = ts;
  });
  return out;
}

/**
 * The most recent source hint `add --source` (or `review`'s own Markdown
 * --source) recorded for this review, or null.
 *
 * `page.visited` is the one event in the closed vocabulary that carries page
 * facts (docs/CONTRACTS.md), and it carries `source_hint` as a plain path
 * string. It rides the log reliably (add.js's own write, and the held-review
 * write in routes.js both append it), but nothing folded it into review.json:
 * every item read `source_hint: {known: false, ...}` even on a review where
 * `--source` had been recorded, and the contract text told the agent not to
 * trust the file it was reading about (Ken, 2026-08-18). This is review-wide,
 * not per page: `page.visited` carries no origin of its own, and one review is
 * almost always one document, so last-write-wins is the same rule
 * `reviews.recordPaths` already uses for the same field on disk.
 *
 * @param {object[]} events every event for one review, in seq order
 * @returns {{known: true, path: string}|null}
 */
function reviewSourceHint(events) {
  var path = null;
  (events || []).forEach(function (event) {
    if (
      event[protocol.EVENT_FIELD.EVENT] === EVENT.PAGE_VISITED &&
      typeof event.source_hint === "string" &&
      event.source_hint
    ) {
      path = event.source_hint;
    }
  });
  return path ? { known: true, path: path } : null;
}

/**
 * The whole `review.json` body for one review.
 *
 * The route adds `seq`; nothing else is added anywhere, so what an agent reads
 * off disk and what the library reads over the wire are the same object.
 *
 * @param {string} reviewId
 * @param {object[]} events every event for that review, in seq order
 * @returns {object} the projection, contract field and all
 */
function project(reviewId, events, options) {
  var opts = options || {};
  var times = reviewTimes(events);
  return reviewFormat.projectReview({
    id: reviewId,
    started_at: times.started_at,
    ended_at: times.ended_at,
    agent_session_id: times.agent_session_id,
    generated_at: opts.generated_at || undefined,
    items: actionableItems(itemsFrom(events, { onDropped: opts.onDropped })),
    source_hint: reviewSourceHint(events)
  });
}

/** The projection as the bytes that go on disk. */
function stringify(projection) {
  return reviewFormat.stringifyReview(projection);
}

// ---------------------------------------------------------------------------
// Writing it out
// ---------------------------------------------------------------------------

/**
 * Regenerate `review.json` from the log, atomically.
 *
 * Called on every fold and on every change to what an agent may act on, which
 * is the whole of "the file is regenerated from the log": there is no
 * incremental edit path to get out of step with.
 *
 * @param {{dir: string, log: object, review: string}} args
 * @returns {{path: string, seq: number, items: number}}
 */
function regenerate(args) {
  var a = args || {};
  if (!a.dir || !a.log || !a.review) throw new Error("projection.regenerate: dir, log and review are all required");
  var events = a.log.read(a.review);
  var projected = project(a.review, events, { onDropped: a.onDropped });
  var written = reviewWriter.writeReviewJson(projected, { dir: a.dir, review: a.review });
  return { path: written, seq: a.log.currentSeq(a.review), items: countItems(projected) };
}

function countItems(projected) {
  return (projected.pages || []).reduce(function (n, page) {
    return n + page.items.length;
  }, 0);
}

// ---------------------------------------------------------------------------
// Keeping it fresh
// ---------------------------------------------------------------------------
//
// One timer per helper, not per review: it is the safety net for inactive
// reviews and direct file readers. Active page polls, status reads, and browser
// event appends call tickReview directly, so ordinary interaction does not pay
// for scanning every accumulated review folder several times a second.

function createProjector(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createProjector: dir is required");
  if (!opts.log) throw new Error("createProjector: log is required");
  var dir = opts.dir;
  var log = opts.log;
  var intervalMs = typeof opts.intervalMs === "number" ? opts.intervalMs : protocol.REPLY_POLL.INTERVAL_MS;
  var folder = opts.folder || replies.createReplyFolder({ dir: dir, log: log });

  var watched = Object.create(null); // review id -> the seq at the last write
  var timer = null;
  var counters = { ticks: 0, folds: 0, writes: 0, dropped: 0 };
  // event_id of every malformed item event already reported, so a drop is logged
  // once rather than on every regenerate that re-reads the same log (NEW-5).
  var droppedSeen = Object.create(null);

  function reportDropped(reviewId, event, reason) {
    var key = event && event[protocol.EVENT_FIELD.EVENT_ID];
    if (key && droppedSeen[key]) return;
    if (key) droppedSeen[key] = true;
    counters.dropped += 1;
    log.helperLog(
      "review " +
        reviewId +
        ": dropped a malformed item event " +
        JSON.stringify(key || "(no event_id)") +
        ": " +
        reason
    );
  }

  /**
   * Every review on disk, so a review created after the helper started (which
   * is every review `add` mints) is watched without anybody remembering to
   * register it. Cheap: one readdir of a directory holding one entry per
   * review, on the same tick that reads the reply files anyway.
   */
  function discoverReviews() {
    var root = stateDir.reviewsRoot(dir);
    var entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT") return [];
      throw err;
    }
    return entries
      .filter(function (entry) {
        return entry.isDirectory() && protocol.isSafeId(entry.name);
      })
      .map(function (entry) {
        return entry.name;
      });
  }

  /** Start watching a review, and write its file once so it exists at all. */
  function watch(reviewId) {
    if (Object.prototype.hasOwnProperty.call(watched, reviewId)) return watched[reviewId];
    watched[reviewId] = -1;
    tickReview(reviewId);
    return watched[reviewId];
  }

  function tickReview(reviewId) {
    var summary = folder.fold(reviewId);
    if (summary.accepted.length || summary.rejected.length || summary.refused.length) counters.folds += 1;
    var seq = log.currentSeq(reviewId);
    if (watched[reviewId] === seq) return { wrote: false, seq: seq };
    regenerate({
      dir: dir,
      log: log,
      review: reviewId,
      onDropped: function (event, reason) {
        reportDropped(reviewId, event, reason);
      }
    });
    watched[reviewId] = seq;
    counters.writes += 1;
    return { wrote: true, seq: seq, summary: summary };
  }

  function tick() {
    counters.ticks += 1;
    discoverReviews().forEach(function (reviewId) {
      if (!Object.prototype.hasOwnProperty.call(watched, reviewId)) watched[reviewId] = -1;
    });
    return Object.keys(watched).map(function (reviewId) {
      return tickReview(reviewId);
    });
  }

  function start(reviewIds) {
    (reviewIds || []).forEach(watch);
    if (timer) return timer;
    timer = setInterval(tick, intervalMs);
    if (timer && typeof timer.unref === "function") timer.unref();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    return true;
  }

  return {
    watch: watch,
    tick: tick,
    tickReview: tickReview,
    start: start,
    stop: stop,
    counters: counters,
    watching: function () {
      return Object.keys(watched);
    }
  };
}

// The helper hands this module to the router as deps.projection, and the
// `review.read` route calls project(). The route is a read of the same
// projection the file holds, so a page that reconnects and an agent that opens
// the file are looking at one thing.
//
// A helper that has answered a read for a review is also watching it: the page
// asks on load and on every reconnect, so this is what starts the reply loop in
// an ordinary session. `serve` may also call startWatching() with every review
// it knows, which is one line in a file 1A owns; see the builder notes.
var sharedProjector = null;

function attach(deps) {
  if (!deps || !deps.log) return null;
  if (!sharedProjector) sharedProjector = createProjector({ dir: deps.log.dir, log: deps.log });
  return sharedProjector;
}

function startWatching(deps, reviewIds) {
  var projector = attach(deps);
  if (!projector) return null;
  projector.start(reviewIds || []);
  return projector;
}

function tickReview(deps, reviewId) {
  var projector = attach(deps);
  if (!projector) return null;
  return projector.tickReview(reviewId);
}

module.exports = {
  itemsFrom: itemsFrom,
  actionableItems: actionableItems,
  reviewTimes: reviewTimes,
  reviewSourceHint: reviewSourceHint,
  project: project,
  stringify: stringify,
  regenerate: regenerate,
  createProjector: createProjector,
  attach: attach,
  startWatching: startWatching,
  tickReview: tickReview
};
