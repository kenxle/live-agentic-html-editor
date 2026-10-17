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
//     The one exception is the reviewer's withdrawal: a same-revision draft
//     of a committed ready or not_handled item takes it to draft, and the
//     helper keeps the agent's state and reply and restores them when the
//     wording comes back. The browser's claimed state is never taken.
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

var fs = require("node:fs");
var path = require("node:path");
var protocol = require("../shared/protocol.js");
var record = require("../shared/record.js");
var lifecycle = require("../shared/lifecycle.js");
var reviewFormat = require("../shared/review_format.js");
var pageRoutes = require("./page_routes.js");
var reviewWriter = require("./review_writer.js");
var stateDir = require("./state_dir.js");
var replies = require("./replies.js");
var handledCheck = require("./handled_check.js");

var EVENT = protocol.EVENT;
var F = record.FIELD;

// ---------------------------------------------------------------------------
// The log, read back into items
// ---------------------------------------------------------------------------

// Has this record been committed before? Its applied-after history says so;
// a draft from before its first commit has none.
function wasCommitted(item) {
  var history = item[F.AFTER_HISTORY];
  return Array.isArray(history) && history.length > 0;
}

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
    // id -> the state an answered item was in when the reviewer started
    // rewording it at the same revision (see "A REWORDING TAKES IT OFF THE
    // DESK" below). Present only while the item is withdrawn.
    withdrawnFrom: Object.create(null),
    // id -> the revision the reviewer closed it at ("Mark as done"). Present
    // only while the item stands closed at that revision.
    closedRev: Object.create(null),
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
  var withdrawnFrom = state.withdrawnFrom;
  // A fold made before closes existed (a kept fold, or a test's own value)
  // simply has none yet.
  if (!state.closedRev) state.closedRev = Object.create(null);
  var closedRev = state.closedRev;

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
      // THE FOLD CHECKS WHAT IT FOLDS (security review 8). log.append refuses
      // a run record that fails validateRun, but a line already in the log (an
      // older helper's, or one written straight into the file) never passed
      // that door. It is dropped here with the same code, and the drop is
      // reported like any other.
      // A choice record is held to the same door rule (choice buttons): a
      // hand-edited line with prose in choice.answer is dropped and reported.
      var runProblem = record.validateChoice(next) || record.validateRun(next);
      if (runProblem) {
        if (onDropped) onDropped(event, runProblem.code + ": " + runProblem.reason);
        return;
      }
      var prev = byId[next[F.ID]];
      if (!prev) state.order.push(next[F.ID]);
      // A close is the helper's to record, from item.closed, never the
      // browser's to claim: the carried record's own mark is not taken.
      var closedHere = !!prev && closedRev[next[F.ID]] === next[F.REV];
      delete next[F.CLOSED_BY];
      delete next[F.CLOSED_AT];
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
        // The unbacked handled claim is lifecycle, not content, so it travels
        // with the state rather than with the browser's record.
        next[F.HANDLED_NOT_ON_PAGE] = prev[F.HANDLED_NOT_ON_PAGE] === true;
        // A REWORDING TAKES IT OFF THE DESK. The one lifecycle move the
        // browser makes at the same revision as a reply is the reviewer's
        // withdrawal: typing into an answered item that is still in front of
        // someone (ready with a question, or not_handled) makes it a draft
        // until they commit, which bumps the revision, or type the wording
        // back, which restores the state it was withdrawn from. Without this
        // the helper kept the old state and put the half-typed words in
        // review.json on every draft post (spec 20260922.01, review finding
        // 5). A handled item is never withdrawn: its state stands as before.
        var id2 = next[F.ID];
        var from = withdrawnFrom[id2] || prev[F.STATE];
        // Only a record committed before counts: a first commit keeps revision
        // one, so a late draft from before it (no history yet) is stale
        // content, not a withdrawal.
        if (
          record.isDraft(next) &&
          (from === record.STATE.READY || from === record.STATE.NOT_HANDLED) &&
          wasCommitted(next)
        ) {
          withdrawnFrom[id2] = from;
          next[F.STATE] = record.STATE.DRAFT;
        } else {
          // Restored, or an ordinary same-revision content write. The state
          // is the helper's, never the browser's claim.
          next[F.STATE] = from;
          delete withdrawnFrom[id2];
        }
      } else {
        next[F.REPLY] = null;
        next[F.HANDLED_NOT_ON_PAGE] = false;
        delete replyRev[next[F.ID]];
        delete withdrawnFrom[next[F.ID]];
      }
      // The read mark is the helper's, from reply.seen, never the carried
      // record's. It stays while the reply it names is still the item's reply.
      delete next[F.REPLY_SEEN];
      if (prev && prev[F.REPLY_SEEN] && next[F.REPLY] && next[F.REPLY] === prev[F.REPLY]) {
        next[F.REPLY_SEEN] = prev[F.REPLY_SEEN];
      }
      if (closedHere) {
        // THE REVIEWER'S CLOSE STANDS AT ITS REVISION. A same-revision re-post
        // (a reconnect, a late draft batch) takes the browser's content and
        // leaves the item closed, with the reply it was closed over.
        next[F.STATE] = record.STATE.HANDLED;
        next[F.REPLY] = prev[F.REPLY] || null;
        next[F.HANDLED_NOT_ON_PAGE] = false;
        next[F.CLOSED_BY] = prev[F.CLOSED_BY];
        next[F.CLOSED_AT] = prev[F.CLOSED_AT];
        delete withdrawnFrom[next[F.ID]];
      } else {
        // A new revision (reworded, or reopened from Done) is new work.
        delete closedRev[next[F.ID]];
      }
      byId[next[F.ID]] = next;
      return;
    }

    if (type === EVENT.ITEM_CLOSED) {
      // MARK AS DONE. Applied only to an item that is outstanding at exactly
      // the revision the reviewer closed. A close naming an older revision is
      // refused the way a stale reply is: another window reworded it since,
      // and that rewording stays outstanding. The line stays in the log, and
      // the refusal is reported like any other dropped event.
      var target = id ? byId[id] : null;
      if (!target) {
        if (onDropped) onDropped(event, "item.closed names an item this review does not hold");
        return;
      }
      var closeRev = event[protocol.EVENT_FIELD.REV];
      if (target[F.REV] !== closeRev) {
        if (onDropped) {
          onDropped(
            event,
            "item.closed names rev " + String(closeRev) + " but the item is at rev " + String(target[F.REV])
          );
        }
        return;
      }
      if (!lifecycle.canClose(target)) {
        if (onDropped) onDropped(event, "item.closed on an item in state " + String(target[F.STATE]));
        return;
      }
      byId[id] = lifecycle.closeItem(target, ts || undefined);
      closedRev[id] = target[F.REV];
      delete withdrawnFrom[id];
      return;
    }

    if (type === EVENT.REPLY_SEEN) {
      // THE REVIEWER READ A REPLY. Recorded only when the stamp names the
      // reply the item holds now: a mark for an older reply, for an item this
      // review does not hold, or that is not a short string is dropped and
      // reported the way a stale reply is, and stores nothing. Not a lifecycle
      // move: state, revision and reply are untouched.
      var seenTarget = id ? byId[id] : null;
      var stamp = event.stamp;
      if (!seenTarget) {
        if (onDropped) onDropped(event, "reply.seen names an item this review does not hold");
        return;
      }
      if (typeof stamp !== "string" || !stamp || stamp.length > record.REPLY_STAMP_MAX) {
        if (onDropped) {
          onDropped(event, "reply.seen needs a stamp of 1 to " + record.REPLY_STAMP_MAX + " characters");
        }
        return;
      }
      var current = record.replyStamp(seenTarget);
      if (stamp !== current) {
        if (onDropped) {
          onDropped(event, "reply.seen names reply " + JSON.stringify(stamp) + " but the item's reply is " + JSON.stringify(current));
        }
        return;
      }
      var marked = Object.assign({}, seenTarget);
      marked[F.REPLY_SEEN] = stamp;
      byId[id] = marked;
      return;
    }

    if (type === EVENT.ITEM_DELETED) {
      if (!id || !byId[id]) return;
      delete byId[id];
      delete replyRev[id];
      delete withdrawnFrom[id];
      delete closedRev[id];
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
      reopened[F.HANDLED_NOT_ON_PAGE] = false;
      delete reopened[F.CLOSED_BY];
      delete reopened[F.CLOSED_AT];
      delete reopened[F.REPLY_SEEN];
      byId[id] = reopened;
      delete replyRev[id];
      delete withdrawnFrom[id];
      delete closedRev[id];
      return;
    }

    if (type === EVENT.REPLY_FOLDED) {
      if (!id || !byId[id] || event.accepted !== true) return;
      var item = byId[id];
      // A reply only ever owns the revision it named. Anything else was already
      // refused at fold time, and this is the second guard on the same rule.
      if (item[F.REV] !== event[protocol.EVENT_FIELD.REV]) return;
      // A card the reviewer closed takes no reply. The fold already refuses
      // one (lifecycle.applyReply); this is the second guard, for a line
      // written before the close was folded.
      if (closedRev[id] === item[F.REV]) return;
      var applied = Object.assign({}, item);
      applied[F.STATE] = event.state || item[F.STATE];
      applied[F.REPLY] = Object.assign({}, event.reply, { at: event[protocol.EVENT_FIELD.TS] || null });
      // A handled claim the built page does not bear out. The state above is
      // the item's own, unchanged, so this is the only thing that says the
      // agent answered and the answer did not arrive.
      applied[F.HANDLED_NOT_ON_PAGE] = event.handled_not_on_page === true;
      delete applied[F.CLOSED_BY];
      delete applied[F.CLOSED_AT];
      // A new reply is unread until a reply.seen names it.
      delete applied[F.REPLY_SEEN];
      byId[id] = applied;
      replyRev[id] = item[F.REV];
      delete withdrawnFrom[id];
      return;
    }

    // The review's own timestamps, read off the log rather than off a clock.
    if (type === EVENT.REVIEW_CREATED) {
      if (!state.times.started_at) state.times.started_at = ts;
      if (typeof event.agent_session_id === "string") state.times.agent_session_id = event.agent_session_id;
      // A `lahe write` notes review (free writing). It rides the created
      // event, so every fold of this log agrees on it.
      if (event.notes === true) state.times.notes = true;
      return;
    }

    // A legacy review adopted into a session belongs to it from here on.
    if (type === EVENT.REVIEW_ADOPTED) {
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
 * Source hints that name a gone file, as {gone path: the file now}, so
 * review.json sends the agent to the file that is there: a removed worktree's
 * main copy (spec 20261015.01 R10), or the new file a moved page pairs with
 * (spec 20261017.01 R3). `movedPathFor` is the helper's lookup, and it judges
 * "gone": a file left as a link out of its site is gone though it opens.
 * Undefined when nothing moved.
 */
function movedHintsOf(items, reviewHint, movedPathFor) {
  if (typeof movedPathFor !== "function") return undefined;
  var out = {};
  var any = false;
  var seen = {};
  function consider(hint) {
    var hinted = hint && typeof hint === "object" ? hint.path : hint;
    if (typeof hinted !== "string" || !hinted || seen[hinted]) return;
    seen[hinted] = true;
    var copy = null;
    try { copy = movedPathFor(hinted); } catch (err) { copy = null; }
    if (typeof copy === "string" && copy) {
      out[hinted] = copy;
      any = true;
    }
  }
  items.forEach(function (item) { consider(item[F.SOURCE_HINT]); });
  consider(reviewHint);
  return any ? out : undefined;
}

/**
 * The file on disk behind every linked page an item was made on, as
 * {page path: real path or null}.
 *
 * `linkedFileFor` is the helper's mount lookup (static_servers.linkedFileForPage
 * bound to one review), so the file an agent is told to edit comes from the
 * helper and never from the page (spec 20260922.02, requirement 6). With no
 * lookup every linked page maps to null, which review_format reads as unknown.
 */
function linkedFilesOf(items, linkedFileFor) {
  var out = {};
  items.forEach(function (item) {
    var pagePath = item[F.PAGE_PATH];
    if (!reviewFormat.isLinkedPage(pagePath)) return;
    if (Object.prototype.hasOwnProperty.call(out, pagePath)) return;
    var file = null;
    if (typeof linkedFileFor === "function") {
      try { file = linkedFileFor(pagePath); } catch (err) { file = null; }
    }
    out[pagePath] = typeof file === "string" && file ? file : null;
  });
  return out;
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
    notes: state.times.notes === true,
    generated_at: opts.generated_at || undefined,
    items: actionableItems(itemsOf(state)),
    source_hint: sourceHintOf(state),
    moved_hints: movedHintsOf(actionableItems(itemsOf(state)), sourceHintOf(state), opts.movedPathFor),
    linked_files: linkedFilesOf(actionableItems(itemsOf(state)), opts.linkedFileFor),
    // Stable addresses: old page-server origins group with the page's site.
    origin_aliases: opts.originAliases || undefined
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

/**
 * Is this run of events something a kept fold can be continued with?
 *
 * Only a strictly increasing run of seqs is. Anything else means the log is
 * not what the fold thinks it is: a second writer on the same directory hands
 * out a seq the fold has already passed, and a hand-written or legacy line
 * carries no seq at all. Both used to be skipped, silently, which is a
 * comment quietly missing from what an agent reads. They are treated as a
 * reason to start over instead, and starting over is the from-the-top fold,
 * which is the reference answer by definition.
 *
 * @param {object} fold a createFold() value
 * @param {object[]} events the events after it, in file order
 */
function continuesFold(fold, events) {
  var at = fold.seq;
  for (var i = 0; i < events.length; i += 1) {
    var seq = events[i][protocol.EVENT_FIELD.SEQ];
    if (typeof seq !== "number" || seq <= at) return false;
    at = seq;
  }
  return true;
}

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
  // The built page, as the answer to "did that handled change actually land".
  // It owns the re-render trigger too, so a line appended in the same breath as
  // the source edit is judged against the render that edit produces.
  var checker = opts.handledCheck || handledCheck.createHandledCheck({ dir: dir, log: log });
  var folder =
    opts.folder ||
    replies.createReplyFolder({
      dir: dir,
      log: log,
      items: function (reviewId) {
        return itemsOf(catchUp(reviewId).fold);
      },
      pageShows: function (reviewId, item) {
        return checker.pageShows(reviewId, item);
      }
    });

  // review id -> {fold, seq}. `fold` is the kept fold state and `seq` is the
  // log's high-water mark at the last write, which is the "has anything moved"
  // check. They are not the same number: `fold.seq` is the highest seq folded,
  // and `seq` is what the log said the last time this review was written.
  var watched = Object.create(null);
  var timer = null;
  var counters = { ticks: 0, folds: 0, writes: 0, skips: 0, dropped: 0 };
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
   * The helper's mount lookup for one review's linked pages: the registry's
   * site mounts and linked files (page_routes.linkedFileForPage).
   */
  function linkedLookup(reviewId) {
    return function (pagePath) {
      return pageRoutes.linkedFileForPage(dir, reviewId, pagePath);
    };
  }

  /**
   * Where a gone source hint's file is now, or null: a removed worktree's main
   * copy, else the review's own pair for a page that moved. A file that is
   * there is asked about only as a pair, which a link out of its site can be.
   */
  function movedPathOf(reviewId, file) {
    var real = null;
    try { real = fs.realpathSync.native(file); } catch (err) { real = null; }
    if (!real) {
      var copy = pageRoutes.movedCopyOf(dir, file);
      if (copy) return copy;
    }
    // A file that is there by its own spelling, with no link on the way, is
    // inside any root that holds it: not gone, and no meta is read for it.
    if (real && real === path.resolve(file)) return null;
    var meta = null;
    try { meta = JSON.parse(fs.readFileSync(stateDir.metaPath(dir, reviewId), "utf8")); } catch (err) { meta = null; }
    if (!meta || typeof meta !== "object") return null;
    return pageRoutes.movedFileOf(dir, Object.assign({}, meta, { id: reviewId }), file);
  }

  /** What a projection of this review is built with, beyond its events. */
  function projectOptions(reviewId) {
    return {
      linkedFileFor: linkedLookup(reviewId),
      originAliases: pageRoutes.aliasMap(dir),
      movedPathFor: function (file) { return movedPathOf(reviewId, file); }
    };
  }

  /** The kept fold for a review, minted the first time it is asked for. */
  function entryFor(reviewId) {
    if (!Object.prototype.hasOwnProperty.call(watched, reviewId)) {
      watched[reviewId] = { fold: createFold(), wroteAt: -1, started: false, epoch: -1, lastBytes: null };
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
      if (log.epoch(reviewId) === entry.epoch && continuesFold(entry.fold, events)) {
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

  /** The projection's bytes with the one field that changes on every build left out. */
  function comparableBytes(projected) {
    return stringify(Object.assign({}, projected, { generated_at: "" }));
  }

  function fileExists(reviewId) {
    try {
      return fs.statSync(stateDir.reviewJsonPath(dir, reviewId)).isFile();
    } catch (err) {
      return false;
    }
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

    // THE SECOND GATE IS THE BYTES. The fold moving is not the same as the
    // file changing: a draft save moves the fold and changes nothing an agent
    // reads, because drafts are withheld. Rewriting the whole file with an
    // fsync for that was the largest write cost a review had (spec
    // 20260922.01, requirement 1). So the projection is compared, without its
    // `generated_at`, against the bytes THIS process last wrote. Comparing the
    // output rather than inspecting event types means no kind of event can
    // ever be skipped by mistake. The baseline is empty when the helper starts,
    // so the first tick always writes (new contract text lands), and a file
    // someone removed is written again.
    var projected = projectFold(reviewId, entry.fold, projectOptions(reviewId));
    var comparable = comparableBytes(projected);
    if (entry.lastBytes === comparable && fileExists(reviewId)) {
      entry.wroteAt = entry.fold.seq;
      counters.skips += 1;
      return { wrote: false, seq: seq, summary: summary };
    }

    reviewWriter.writeReviewJson(projected, { dir: dir, review: reviewId });
    entry.lastBytes = comparable;
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
      projection: projectFold(reviewId, entry.fold, projectOptions(reviewId)),
      draft_count: itemsOf(entry.fold).filter(function (item) {
        return item[F.STATE] === record.STATE.DRAFT;
      }).length
    };
  }

  /** The items this review's kept fold holds now, drafts included, in first-seen order. */
  function currentItems(reviewId) {
    return itemsOf(catchUp(reviewId).fold);
  }

  /**
   * Fold one review's reply files now, once, without joining the watch list.
   *
   * The menu bar's summary counts replies on documents no page has open, and
   * nothing else folds those: the watch list is only what somebody asked
   * about. Joining it would tick the review every interval for the rest of
   * the helper's life, so a review that was not watched before is not
   * watched after. The reply folder keeps its read offsets either way.
   */
  function foldOnce(reviewId) {
    var wasWatched = Object.prototype.hasOwnProperty.call(watched, reviewId);
    var result = tickReview(reviewId);
    if (!wasWatched) delete watched[reviewId];
    return result;
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
    currentItems: currentItems,
    foldOnce: foldOnce,
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

/** The items the projector's kept fold holds for a review, or null with no projector. */
function currentItems(deps, reviewId) {
  var projector = attach(deps);
  if (!projector) return null;
  return projector.currentItems(reviewId);
}

/** Fold a review's reply files once (projector.foldOnce), or null with no projector. */
function foldOnce(deps, reviewId) {
  var projector = attach(deps);
  if (!projector) return null;
  return projector.foldOnce(reviewId);
}

module.exports = {
  currentItems: currentItems,
  foldOnce: foldOnce,
  createFold: createFold,
  foldEvents: foldEvents,
  continuesFold: continuesFold,
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
