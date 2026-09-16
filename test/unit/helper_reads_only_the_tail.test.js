// Nothing reads the whole event log twice.
//
// Owner: 3A. The brief is
// docs/features/20260916.03_helper_lazy_projection/01_spec_lazy_projection.md.
// Making the projector fold incrementally only helps if the callers around it
// stop doing from the top what it just stopped doing: `review.read` folded the
// whole log twice on every page load and every `lahe status`, the reply poll
// folded it again to count outstanding work, and the reply folder folded it
// once per accepted reply line.
//
// HOW THESE TESTS BITE. After the first fold has happened, `log.read` is
// replaced with a function that throws. Any code path that still wants the
// whole log fails loudly instead of being slow quietly. The projector holds the
// same log OBJECT the test does, and the call is a property lookup, so the
// replacement reaches it.
//
// The bar is not "it answered". It is "it answered with what a full read would
// have produced", so each test compares against a projection built the
// from-the-top way over the same directory.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const stateDir = require("../../src/service/state_dir.js");
const routes = require("../../src/service/routes.js");
const projectionModule = require("../../src/service/projection.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");

let counter = 0;
function eventId() {
  counter += 1;
  return "evt_tail_" + counter;
}

/**
 * One state directory, one log, one review.
 *
 * A directory per test on purpose: the projector is shared per state directory,
 * so two tests sharing one would share folds and prove less than they look like
 * they prove.
 */
function fixture(reviewId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-tail-"));
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  reviews.create({ id: reviewId, origins: ["null"], agent_session_id: "s_tail" });
  const deps = { log: log, reviews: reviews, projection: projectionModule };
  return { dir, log, reviews, deps, review: reviewId };
}

function itemOf(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "the reviewer's own words",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/p.html",
        page_title: "Page",
        page_seq: 1
      },
      overrides || {}
    )
  );
}

function post(f, item, type) {
  f.log.append(f.review, [
    protocol.newEvent({
      event: type || (record.isDraft(item) ? protocol.EVENT.ITEM_CREATED : protocol.EVENT.ITEM_READY),
      event_id: eventId(),
      review: f.review,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: record.isDraft(item), record: item }
    })
  ]);
  return item;
}

/** Break the from-the-top path, so anything still using it says so. */
function forbidWholeReads(f) {
  const reads = [];
  f.log.read = function (reviewId) {
    reads.push(reviewId);
    throw new Error("log.read: the whole log must not be read again");
  };
  return reads;
}

/** What a from-the-top fold says right now, read through a separate log. */
function fromTheTop(f) {
  const fresh = logModule.createEventLog({ dir: f.dir });
  return projectionModule.project(f.review, fresh.read(f.review), { generated_at: "pinned" });
}

function pagesOf(projected) {
  return JSON.stringify(projected.pages);
}

// ---------------------------------------------------------------------------
// review.read
// ---------------------------------------------------------------------------

test("review.read answers off the kept fold, and says exactly what a full read would", () => {
  const f = fixture("rtail0000000001");
  post(f, itemOf({ id: "itm_first", note: "the first comment" }));
  post(f, itemOf({ id: "itm_draft1", state: record.STATE.DRAFT, note: "half a thought" }));

  const read = routes.handlerFor("review.read");
  const warm = read({ review: f.review, query: {} }, f.deps);
  assert.equal(warm.status, 200);
  assert.equal(warm.body.draft_count, 1);

  // Everything after this point has to come off the fold.
  const reads = forbidWholeReads(f);

  post(f, itemOf({ id: "itm_second", note: "the second comment" }));
  post(f, itemOf({ id: "itm_draft2", state: record.STATE.DRAFT, note: "still typing" }));

  const answer = read({ review: f.review, query: {} }, f.deps);
  assert.deepEqual(reads, [], "nothing asked for the whole log");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.draft_count, 2, "the draft count comes off the same fold, not a second pass");
  assert.equal(pagesOf(answer.body), pagesOf(fromTheTop(f)), "and the items are what folding from the top gives");

  const notes = [];
  (answer.body.pages || []).forEach((page) => page.items.forEach((item) => notes.push(item.note)));
  assert.deepEqual(notes, ["the first comment", "the second comment"]);
  assert.equal(JSON.stringify(answer.body).indexOf("half a thought"), -1, "and drafts are still withheld (R7)");
});

test("review.read still answers when there is no projector to ask", () => {
  // The fallback is the from-the-top read, which is the right answer and the
  // expensive one. A caller handing in a partial projection module gets it.
  const f = fixture("rtail0000000002");
  post(f, itemOf({ id: "itm_only", note: "one comment" }));

  const partial = {
    project: projectionModule.project,
    itemsFrom: projectionModule.itemsFrom
  };
  const answer = routes.handlerFor("review.read")(
    { review: f.review, query: {} },
    { log: f.log, reviews: f.reviews, projection: partial }
  );
  assert.equal(answer.status, 200);
  assert.equal(pagesOf(answer.body), pagesOf(fromTheTop(f)));
});

// ---------------------------------------------------------------------------
// The reply poll's outstanding-work count
// ---------------------------------------------------------------------------

test("the reply poll counts outstanding work off the kept fold", () => {
  const f = fixture("rtail0000000003");
  const agentSessions = require("../../src/service/agent_sessions.js").createStore({ dir: f.dir });
  agentSessions.create({ id: "s_tail" });
  f.deps.agentSessions = agentSessions;

  post(f, itemOf({ id: "itm_work1", note: "one thing" }));
  const poll = routes.handlerFor("replies.poll");
  assert.equal(poll({ review: f.review, query: { since: 0 } }, f.deps).body.agent_liveness.unanswered, 1);

  const reads = forbidWholeReads(f);
  post(f, itemOf({ id: "itm_work2", note: "a second thing" }));
  post(f, itemOf({ id: "itm_work3", note: "a third thing" }));

  const answer = poll({ review: f.review, query: { since: 0 } }, f.deps);
  assert.deepEqual(reads, [], "nothing asked for the whole log");
  assert.equal(answer.body.agent_liveness.unanswered, 3);
});

// ---------------------------------------------------------------------------
// The reply folder
// ---------------------------------------------------------------------------

test("the reply folder finds the item in the kept fold, not in a fresh read of the log", () => {
  const f = fixture("rtail0000000004");
  const item = post(f, itemOf({ id: "itm_reply", note: "shorten the heading" }));
  projectionModule.startWatching(f.deps, [f.review]);

  const reads = forbidWholeReads(f);
  fs.writeFileSync(
    stateDir.replyFilePath(f.dir, f.review, "replies-claude.jsonl"),
    JSON.stringify({ item: item.id, rev: 1, status: "handled", agent: "claude" }) + "\n",
    { mode: 0o600 }
  );
  const ticked = projectionModule.tickReview(f.deps, f.review);

  assert.deepEqual(reads, [], "nothing asked for the whole log");
  assert.equal(ticked.wrote, true);
  assert.equal(ticked.summary.accepted.length, 1);

  const parsed = JSON.parse(fs.readFileSync(stateDir.reviewJsonPath(f.dir, f.review), "utf8"));
  const items = [];
  (parsed.pages || []).forEach((page) => page.items.forEach((each) => items.push(each)));
  assert.equal(items[0].state, "handled");
  assert.equal(items[0].reply.agent, "claude");
});

test("a reply is judged against the revision the item is at NOW, not at the last tick", () => {
  // The ordering this protects: the folder's kept fold is caught up BEFORE the
  // reply file is read. Without that, a reviewer who reworded since the last
  // tick would have the rewording swallowed by an answer to the old revision,
  // which is the exact case D5's per-revision rule exists to prevent.
  const f = fixture("rtail0000000005");
  const item = post(f, itemOf({ id: "itm_reworded", note: "shorten the heading" }));
  projectionModule.startWatching(f.deps, [f.review]);

  // The reviewer rewords. Nothing ticks, so the last fold still says rev 1.
  const reworded = Object.assign({}, item);
  reworded[record.FIELD.REV] = 2;
  reworded[record.FIELD.NOTE] = "shorten the heading, and drop the subtitle";
  post(f, reworded);

  const reads = forbidWholeReads(f);
  fs.writeFileSync(
    stateDir.replyFilePath(f.dir, f.review, "replies-claude.jsonl"),
    JSON.stringify({ item: item.id, rev: 1, status: "handled", agent: "claude" }) + "\n",
    { mode: 0o600 }
  );
  const ticked = projectionModule.tickReview(f.deps, f.review);

  assert.deepEqual(reads, [], "nothing asked for the whole log");
  assert.equal(ticked.summary.accepted.length, 0, "the stale answer is not accepted");
  assert.equal(ticked.summary.refused.length, 1);
  assert.match(ticked.summary.refused[0].refusal, /rev/, "and the refusal names the revision");

  const parsed = JSON.parse(fs.readFileSync(stateDir.reviewJsonPath(f.dir, f.review), "utf8"));
  const items = [];
  (parsed.pages || []).forEach((page) => page.items.forEach((each) => items.push(each)));
  assert.equal(items[0].state, "ready", "the rewording is still outstanding");
  assert.equal(items[0].rev, 2);
});

// ---------------------------------------------------------------------------
// One projector per state directory
// ---------------------------------------------------------------------------

test("two state directories do not share one projector's folds", () => {
  // Before the routes took their answer from the projector this was invisible:
  // a single cached projector was only ever nudged, never read. Now a second
  // directory getting the first one's folds is an empty review where there
  // should be items.
  const one = fixture("rtail0000000006");
  const two = fixture("rtail0000000007");
  post(one, itemOf({ id: "itm_in_one", note: "belongs to the first directory" }));
  post(two, itemOf({ id: "itm_in_two", note: "belongs to the second directory" }));

  const read = routes.handlerFor("review.read");
  const first = read({ review: one.review, query: {} }, one.deps);
  const second = read({ review: two.review, query: {} }, two.deps);

  assert.equal(first.body.pages[0].items[0].note, "belongs to the first directory");
  assert.equal(second.body.pages[0].items[0].note, "belongs to the second directory");
});
