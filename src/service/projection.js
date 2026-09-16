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
// THE FOLD IS RESUMABLE. Everything the projection needs is a forward pass that
// keeps a fixed amount of state: the items by id, their order, the revision each
// reply answered, the review's own times, and the last source hint. That state
// is a value here (createFold, foldEvents, projectFold) rather than three
// closures inside three functions, which is what lets the projector fold a
// review's first thousand events today and its next ten tomorrow without
// re-reading the first thousand. There is ONE folding implementation: itemsFrom,
// reviewTimes, reviewSourceHint and project all run it, so the incremental path
// and the from-the-top path cannot drift apart.
//
// Node-only. Not in the layer bundle.

"use strict";

var protocol = require("../shared/protocol.js");
var record = require("../shared/record.js");
var lifecycle = require("../shared/lifecycle.js");
var reviewFormat = require("../shared/review_format.js");
var reviewWriter = require("./review_writer.js");
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
 * A fold in progress: everything one review's projection needs, and nothing
 * that grows with the log.
 *
 * The events themselves are NOT kept. A helper watching forty reviews holds
 * forty of these, so what is in here is the answer so far (a few dozen item
 * records) rather than the question (tens of thousands of events).
 *
 * `seq` is how far the fold has consumed: the highest seq it has seen. The
 * projector uses it as the cursor it asks the log for more from.
 */
function createFold() {
  return {
    byId: Object.create(null),
    order: [],
    // id -> the revision the current reply answered. Rule 2 above reads it.
    replyRev: Object.create(null),
    times: { started_at: null, ended_at: null, agent_session_id: "legacy" },
    sourcePath: null,
    seq: 0
  };
}

/**
 * Fold more events into a fold, in seq order, and return it.
 *
 * Folding [a, b] then [c] must leave exactly what folding [a, b, c] leaves.
 * That is not a comment, it is test/unit/projection_incremental.test.js, run
 * over five real logs at every chunk boundary.
 *
 * @param {object} state a createFold() value, mutated in place
 * @param {object[]} events the next events for one review, in seq order
 * @param {{onDropped?: function}} [options]
 * @returns {object} the same state
 */
function foldEvents(state, events, options) {
  var opts = options || {};
  var onDropped = typeof opts.onDropped === "function" ? opts.onDropped : null;
  var byId = state.byId;
  var replyRev = state.replyRev;

  (events || []).forEach(function (event) {
    var seq = event[protocol.EVENT_FIELD.SEQ];
    if (typeof seq === "number" && seq > state.seq) state.seq = seq;

    var type = event[protocol.EVENT_FIELD.EVENT];
    var id = event[protocol.EVENT_FIELD.ITEM];
    var ts = event[protocol.EVENT_FIELD.TS] || null;

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
      if (!prev) state.order.push(next[F.ID]);
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
      state.order = state.order.filter(function (each) {
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
      return;
    }

    // The review's own timestamps, read off the log rather than off a clock.
    if (type === EVENT.REVIEW_CREATED) {
      if (!state.times.started_at) state.times.started_at = ts;
      if (typeof event.agent_session_id === "string") state.times.agent_session_id = event.agent_session_id;
      return;
    }

    if (type === EVENT.REVIEW_ARCHIVED) {
      state.times.ended_at = ts;
      return;
    }

    // The source hint, last one wins. See reviewSourceHint below for why it is
    // review-wide rather than per page.
    if (type === EVENT.PAGE_VISITED && typeof event.source_hint === "string" && event.source_hint) {
      state.sourcePath = event.source_hint;
    }
  });

  return state;
}

/** The items a fold currently holds, drafts included, in first-seen order. */
function itemsOf(state) {
  return state.order
    .filter(function (id) {
      return !!state.byId[id];
    })
    .map(function (id) {
      return state.byId[id];
    });
}

/**
 * Every item a review currently holds, drafts included, in first-seen order.
 *
 * The from-the-top path: one fold, every event, no state kept afterwards.
 *
 * @param {object[]} events every event for one review, in seq order
 * @returns {object[]} records, each carrying its folded reply in `reply`
 */
function itemsFrom(events, options) {
  return itemsOf(foldEvents(createFold(), events, options));
}

/** The items an agent may act on: everything except the reviewer's drafts. */
function actionableItems(items) {
  return (items || []).filter(function (item) {
    return !record.isDraft(item);
  });
}

/** The review's own timestamps, read off the log rather than off a clock. */
function reviewTimes(events) {
  return Object.assign({}, foldEvents(createFold(), events).times);
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
  return sourceHintOf(foldEvents(createFold(), events));
}

function sourceHintOf(state) {
  return state.sourcePath ? { known: true, path: state.sourcePath } : null;
}

/**
 * The whole `review.json` body for a fold, wherever that fold got to.
 *
 * The route adds `seq`; nothing else is added anywhere, so what an agent reads
 * off disk and what the library reads over the wire are the same object.
 *
 * @param {string} reviewId
 * @param {object} state a fold, from createFold() plus foldEvents()
 * @returns {object} the projection, contract field and all
 */
function projectFold(reviewId, state, options) {
  var opts = options || {};
  return reviewFormat.projectReview({
    id: reviewId,
    started_at: state.times.started_at,
    ended_at: state.times.ended_at,
    agent_session_id: state.times.agent_session_id,
    generated_at: opts.generated_at || undefined,
    items: actionableItems(itemsOf(state)),
    source_hint: sourceHintOf(state)
  });
}

/**
 * The whole `review.json` body for one review, folded from the top.
 *
 * @param {string} reviewId
 * @param {object[]} events every event for that review, in seq order
 * @returns {object} the projection, contract field and all
 */
function project(reviewId, events, options) {
  var opts = options || {};
  var state = foldEvents(createFold(), events, { onDropped: opts.onDropped });
  return projectFold(reviewId, state, opts);
}

/** The projection as the bytes that go on disk. */
function stringify(projection) {
  return reviewFormat.stringifyReview(projection);
}

// ---------------------------------------------------------------------------
// Writing it out
// ---------------------------------------------------------------------------

/**
 * Regenerate `review.json` from the log, from the top, atomically.
 *
 * The projector does not call this any more: it keeps a fold per watched review
 * and writes from that instead, so an 84 MB log is not parsed from byte zero
 * every time one comment changes. This stays as the from-the-top path for a
 * caller holding no fold state, and as the thing the equivalence tests compare
 * the incremental fold against.
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
//
// NOTHING IS WATCHED UNTIL SOMEBODY ASKS. The projector used to read every
// review directory on disk on every tick, including the first one, which on a
// machine with 400 accumulated reviews meant 654 MB of logs parsed before the
// helper answered a single request: every restart looked like a hang and every
// page said "helper not available" for minutes. A review joins the watch list
// the first time something asks about it (a page poll, an agent's `lahe status`
// through review.read, a browser event append), which the routes already do. A
// review nobody has asked about since the helper started is left exactly as its
// last rebuild wrote it.
//
// AND A REBUILD READS ONLY WHAT IS NEW. Each watched review keeps its fold (see
// createFold above) and the seq it has folded to. A tick that finds the log has
// moved asks log.since for the events after that cursor and folds those into
// the kept state. The first rebuild after startup still reads the whole log
// once; after that, never.

function createProjector(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createProjector: dir is required");
  if (!opts.log) throw new Error("createProjector: log is required");
  var dir = opts.dir;
  var log = opts.log;
  var intervalMs = typeof opts.intervalMs === "number" ? opts.intervalMs : protocol.REPLY_POLL.INTERVAL_MS;
  // The folder asks what an item looks like right now once per reply line it
  // accepts, and its own default answer is to fold the whole log again for each
  // one. It gets the kept fold instead, caught up first so the answer is exactly
  // as current as a fresh read would have been: the line before this one may
  // have appended a reply.folded event, and a stale fold would judge this line
  // against the wrong revision.
  var folder =
    opts.folder ||
    replies.createReplyFolder({
      dir: dir,
      log: log,
      items: function (reviewId) {
        return itemsOf(catchUp(reviewId).fold);
      }
    });

  // review id -> {fold, seq}. `fold` is the kept fold state and `seq` is the
  // log's high-water mark at the last write, which is the "has anything moved"
  // check. They are not the same number: `fold.seq` is the highest seq folded,
  // and `seq` is what the log said the last time this review was written.
  var watched = Object.create(null);
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

  /** The kept fold for a review, minted the first time it is asked for. */
  function entryFor(reviewId) {
    if (!Object.prototype.hasOwnProperty.call(watched, reviewId)) {
      watched[reviewId] = { fold: createFold(), wroteAt: -1, started: false, epoch: -1 };
    }
    return watched[reviewId];
  }

  /**
   * Start watching a review, and write its file once so it exists at all.
   *
   * `wroteAt` of -1 is "this review has never been written", which is not the
   * same as "this review is not being watched": answering a read mints the
   * entry without writing anything. Watching one in that state still has to
   * write the file, or the file an agent opens never appears.
   */
  function watch(reviewId) {
    var entry = entryFor(reviewId);
    if (entry.wroteAt !== -1) return entry.wroteAt;
    tickReview(reviewId);
    return entry.wroteAt;
  }

  /**
   * Is this run of events something the kept fold can be continued with?
   *
   * Only a strictly increasing run of seqs is. Anything else means the log is
   * not what the fold thinks it is: a second writer on the same directory hands
   * out a seq the fold has already passed, and a hand-written or legacy line
   * carries no seq at all. Both used to be skipped, silently, which is a
   * comment quietly missing from what an agent reads. They are treated as a
   * reason to start over instead, and starting over is the from-the-top fold,
   * which is the reference answer by definition.
   */
  function continues(fold, events) {
    var at = fold.seq;
    for (var i = 0; i < events.length; i += 1) {
      var seq = events[i][protocol.EVENT_FIELD.SEQ];
      if (typeof seq !== "number" || seq <= at) return false;
      at = seq;
    }
    return true;
  }

  /**
   * Fold everything that has landed since this review's fold last looked.
   *
   * The first pass reads the log whole, the way regenerate does, and so does
   * any pass where the tail cannot be trusted to continue the fold: the log was
   * rewritten under the helper (log.epoch moved), or the events it handed back
   * are not a strictly increasing run. Otherwise the cursor is the fold's own
   * high-water mark and only the tail is read.
   */
  function catchUp(reviewId) {
    var entry = entryFor(reviewId);
    var dropped = function (event, reason) {
      reportDropped(reviewId, event, reason);
    };

    if (entry.started && log.epoch(reviewId) === entry.epoch) {
      var events = log.since(reviewId, entry.fold.seq);
      if (log.epoch(reviewId) === entry.epoch && continues(entry.fold, events)) {
        foldEvents(entry.fold, events, { onDropped: dropped });
        return entry;
      }
    }

    // Start over. The fold is REPLACED rather than added to: folding the whole
    // log on top of a fold that already holds half of it would double the
    // order list and keep items a rewrite removed.
    entry.fold = createFold();
    entry.wroteAt = -1;
    var all = log.read(reviewId);
    entry.epoch = log.epoch(reviewId);
    entry.started = true;
    foldEvents(entry.fold, all, { onDropped: dropped });
    return entry;
  }

  function tickReview(reviewId) {
    var entry = entryFor(reviewId);
    // Before the reply fold, so a reply is judged against the item as it stands
    // right now rather than as it stood at the last tick. A reviewer who
    // reworded in between is the whole reason the revision rule exists.
    catchUp(reviewId);
    var summary = folder.fold(reviewId);
    if (summary.accepted.length || summary.rejected.length || summary.refused.length) counters.folds += 1;
    // And again after it, because folding a reply appends reply.folded events
    // that the summary has to carry.
    catchUp(reviewId);

    // THE GATE IS THE FOLD'S OWN SEQ, not the log's high-water mark.
    // log.currentSeq only moves on appends THIS process made, so an event
    // written by anything else was folded into memory and then never reached
    // disk: review.json sat there stale while the helper knew better. The fold
    // has seen whatever is on the file, so it is the honest answer to "has
    // anything changed".
    var seq = log.currentSeq(reviewId);
    if (entry.wroteAt === entry.fold.seq) return { wrote: false, seq: seq };

    reviewWriter.writeReviewJson(projectFold(reviewId, entry.fold), { dir: dir, review: reviewId });
    entry.wroteAt = entry.fold.seq;
    counters.writes += 1;
    return { wrote: true, seq: seq, summary: summary };
  }

  /**
   * This review's summary and draft count, off the kept fold.
   *
   * The `review.read` route used to answer with its own full read of the log
   * and its own fold, twice: once for the summary and once to count drafts.
   * That made every page load and every `lahe status` on a big review pay the
   * cost the projector had just stopped paying. The fold is brought up to date
   * here rather than assumed current, so this is correct whether or not the
   * caller ticked first.
   *
   * @returns {{projection: object, draft_count: number}}
   */
  function currentProjection(reviewId) {
    var entry = catchUp(reviewId);
    return {
      projection: projectFold(reviewId, entry.fold),
      draft_count: itemsOf(entry.fold).filter(function (item) {
        return item[F.STATE] === record.STATE.DRAFT;
      }).length
    };
  }

  function tick() {
    counters.ticks += 1;
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
    currentProjection: currentProjection,
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
// an ordinary session. `serve` calls startWatching() with no ids at all, which
// starts the timer and watches nothing, because startup rebuilds nothing.
//
// An agent that appends a reply to a review no page is polling is covered by
// the same door: `lahe reply` writes the line, and `lahe status` reads that
// review through review.read, which calls startWatching for it and then ticks
// it. That is the only thing the old directory walk was carrying.
// ONE PROJECTOR PER STATE DIRECTORY, not one per process. A helper serves one
// directory, so in the product these are the same thing; they stopped being the
// same thing the moment the routes started taking their ANSWER from the
// projector instead of only nudging it. A single cached projector hands the
// second directory the first one's folds, which is an empty review where there
// should be items. The key is the directory because that is what a projector is
// about.
var projectors = Object.create(null);

function attach(deps) {
  if (!deps || !deps.log || !deps.log.dir) return null;
  if (!projectors[deps.log.dir]) {
    projectors[deps.log.dir] = createProjector({ dir: deps.log.dir, log: deps.log });
  }
  return projectors[deps.log.dir];
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

/**
 * The route's door to the kept fold: this review's summary and draft count
 * without reading the log from the top.
 *
 * Null when there is no projector to ask, which is the signal for the caller to
 * fall back to the from-the-top read rather than to answer with nothing.
 */
function currentProjection(deps, reviewId) {
  var projector = attach(deps);
  if (!projector) return null;
  return projector.currentProjection(reviewId);
}

module.exports = {
  createFold: createFold,
  foldEvents: foldEvents,
  itemsOf: itemsOf,
  projectFold: projectFold,
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
  tickReview: tickReview,
  currentProjection: currentProjection
};
