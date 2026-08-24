// End review: what the reviewer is told, what the helper is told, and the order
// the two happen in.
//
// D10 says a review starts when the add step mints it and ends when the
// reviewer chooses End review on the rail. The route and the archive event have
// existed since 0A-wire; nothing ever called them. What this file guards is the
// three things that had to be true before anything could:
//
//   1. the confirm says what is unfinished, at every boundary, including the
//      one where nothing is,
//   2. `outstanding_kept` counts OUTSTANDING WORK, not lines in the event log,
//   3. the outbox is drained BEFORE the archive posts, or the reviewer's last
//      keystrokes are archived out from under them.
//
// The third one is the reason this file exists. It is a pure ordering fact, so
// it is decided here with a stub fetch rather than in a browser: the browser
// lane asserts the same order in real bytes on disk.
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
const projection = require("../../src/service/projection.js");
const routes = require("../../src/service/routes.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const overlay = require("../../src/layer/overlay.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");

// ---------------------------------------------------------------------------
// The confirm's one sentence
// ---------------------------------------------------------------------------

function itemOf(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "the reviewer's own words",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/",
        page_title: "Coach",
        page_seq: 1
      },
      overrides || {}
    )
  );
}

test("nothing pending is said plainly, and never with a zero in it", () => {
  const counts = overlay.endReviewCounts([
    itemOf({ state: record.STATE.HANDLED, reply: { status: "handled", agent: "claude", at: "2026-08-24T00:00:00.000Z" } }),
    itemOf({ state: record.STATE.READY, reply: { status: "handled", agent: "claude", at: "2026-08-24T00:00:00.000Z" } })
  ]);
  assert.deepEqual(counts, { unanswered: 0, drafts: 0 });
  const said = overlay.unfinishedSentence(counts);
  assert.equal(said, overlay.END_REVIEW.NOTHING_PENDING);
  assert.equal(/\b0\b/.test(said), false, "a count of nothing is a sentence, not a zero");
});

test("unanswered items are counted and named, singular and plural", () => {
  const four = [itemOf(), itemOf(), itemOf(), itemOf()];
  assert.deepEqual(overlay.endReviewCounts(four), { unanswered: 4, drafts: 0 });
  assert.equal(overlay.unfinishedSentence({ unanswered: 4, drafts: 0 }), "4 items are still waiting on an agent.");
  assert.equal(overlay.unfinishedSentence({ unanswered: 1, drafts: 0 }), "1 item is still waiting on an agent.");
});

test("drafts are counted separately, and the sentence says why they matter", () => {
  const items = [itemOf({ state: record.STATE.DRAFT, note: "half a" }), itemOf({ state: record.STATE.DRAFT, note: "thought" })];
  assert.deepEqual(overlay.endReviewCounts(items), { unanswered: 0, drafts: 2 });
  const said = overlay.unfinishedSentence({ unanswered: 0, drafts: 2 });
  assert.equal(said, "2 drafts have not been marked ready, so no agent has seen them.");
  assert.equal(said.indexOf("no agent has seen") !== -1, true, "a draft is invisible, and that is the fact worth saying");
  assert.equal(
    overlay.unfinishedSentence({ unanswered: 0, drafts: 1 }),
    "1 draft has not been marked ready, so no agent has seen it."
  );
});

test("both at once are one sentence, and neither number goes missing", () => {
  const items = [itemOf(), itemOf(), itemOf(), itemOf(), itemOf({ state: record.STATE.DRAFT }), itemOf({ state: record.STATE.DRAFT })];
  const counts = overlay.endReviewCounts(items);
  assert.deepEqual(counts, { unanswered: 4, drafts: 2 });
  assert.equal(
    overlay.unfinishedSentence(counts),
    "4 items are still waiting on an agent, and 2 drafts have not been marked ready, so no agent has seen them."
  );
});

test("an answered item is not outstanding, and a handled one is not either", () => {
  const answered = itemOf({ reply: { status: "question", text: "which one?", at: "2026-08-24T00:00:00.000Z" } });
  const handled = itemOf({ state: record.STATE.HANDLED });
  const open = itemOf();
  assert.deepEqual(overlay.endReviewCounts([answered, handled, open]), { unanswered: 1, drafts: 0 });
});

test("the door says the same sentence on hover and to a screen reader", () => {
  assert.equal(typeof overlay.END_REVIEW.LABEL, "string");
  assert.equal(overlay.END_REVIEW.LABEL, "End this review and perform cleanup");
});

// ---------------------------------------------------------------------------
// outstanding_kept: what is still open, not how big the log is
// ---------------------------------------------------------------------------

let counter = 0;
function eventId() {
  counter += 1;
  return "evt_end_" + counter;
}

function fixture(reviewId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-end-"));
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  reviews.create({ id: reviewId, origins: ["null"] });
  return { dir, log, reviews, deps: { log: log, reviews: reviews, projection: projection } };
}

function post(f, reviewId, item, type) {
  f.log.append(reviewId, [
    protocol.newEvent({
      event: type || (record.isDraft(item) ? protocol.EVENT.ITEM_CREATED : protocol.EVENT.ITEM_READY),
      event_id: eventId(),
      review: reviewId,
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

function end(f, reviewId) {
  return routes.handlerFor("review.end")({ review: reviewId, query: {}, body: { review: reviewId } }, f.deps);
}

test("outstanding_kept counts ready items, not lines in the event log", () => {
  const REVIEW = "end-count-review";
  const f = fixture(REVIEW);

  // Two ready items, typed rather than dictated: every keystroke is an
  // item.content event, so the log is an order of magnitude longer than the
  // work. That gap is the whole bug: this used to report the log's length.
  const first = itemOf({ note: "say which number this is" });
  const second = itemOf({ note: "the heading is doing two jobs" });
  [first, second].forEach((item) => {
    post(f, REVIEW, Object.assign({}, item, { state: record.STATE.DRAFT }), protocol.EVENT.ITEM_CREATED);
    for (let keystroke = 0; keystroke < 20; keystroke += 1) {
      post(f, REVIEW, Object.assign({}, item, { state: record.STATE.DRAFT }), protocol.EVENT.ITEM_CONTENT);
    }
    post(f, REVIEW, item, protocol.EVENT.ITEM_READY);
  });
  assert.equal(f.log.read(REVIEW).length > 40, true, "the log really is much longer than the work");

  const result = end(f, REVIEW);
  assert.equal(result.status, 200);
  assert.equal(result.body.outstanding_kept, 2, "two items were kept, not forty-something events");
  assert.equal(typeof result.body.ended_at, "string");
});

test("a draft is not outstanding work, and neither is a handled item", () => {
  const REVIEW = "end-states-review";
  const f = fixture(REVIEW);
  post(f, REVIEW, itemOf({ note: "open" }), protocol.EVENT.ITEM_READY);
  post(f, REVIEW, itemOf({ state: record.STATE.DRAFT, note: "still typing" }), protocol.EVENT.ITEM_CREATED);
  const handled = post(f, REVIEW, itemOf({ note: "already fixed" }), protocol.EVENT.ITEM_READY);
  f.log.append(REVIEW, [
    protocol.newEvent({
      event: protocol.EVENT.REPLY_FOLDED,
      event_id: eventId(),
      review: REVIEW,
      item: handled[record.FIELD.ID],
      rev: handled[record.FIELD.REV],
      payload: {
        // The projector folds only an ACCEPTED reply, and only onto the rev it
        // named. Both are the fold's own rules; this line is what an accepted
        // one looks like on the log.
        accepted: true,
        state: record.STATE.HANDLED,
        reply: { status: "handled", agent: "claude" }
      }
    })
  ]);

  assert.equal(end(f, REVIEW).body.outstanding_kept, 1, "one ready item, and only it");
});

test("ending appends review.archived, and the projection reads ended_at off it", () => {
  const REVIEW = "end-archived-review";
  const f = fixture(REVIEW);
  post(f, REVIEW, itemOf({ note: "one" }), protocol.EVENT.ITEM_READY);

  const before = projection.project(REVIEW, f.log.read(REVIEW));
  assert.equal(before.review.ended_at, null, "a live review has no end");

  const result = end(f, REVIEW);
  const archived = f.log.read(REVIEW).filter((event) => event.event === protocol.EVENT.REVIEW_ARCHIVED);
  assert.equal(archived.length, 1, "exactly one archive event");

  const after = projection.project(REVIEW, f.log.read(REVIEW));
  assert.equal(after.review.ended_at, result.body.ended_at, "review.json says when it ended");
  // Nothing is truncated: the outstanding item is still in the file, which is
  // what "archived, never truncated" means.
  assert.equal(after.pages[0].items.length, 1);
});

// ---------------------------------------------------------------------------
// The order: the reviewer's last keystrokes go out BEFORE the archive
// ---------------------------------------------------------------------------

/** A sync client over a stub fetch that records the order of what it is asked. */
function client(options) {
  const o = options || {};
  const calls = [];
  const store = storeModule.createStore();
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: function (url, config) {
      const body = config && config.body ? JSON.parse(config.body) : null;
      calls.push({ url: String(url), body: body, headers: config ? config.headers : null });
      if (o.refuse) return Promise.reject(new Error("Failed to fetch"));
      const answer = String(url).indexOf("/end") !== -1
        ? { ended_at: "2026-08-24T12:00:00.000Z", outstanding_kept: 3 }
        : { accepted: (body && body.events ? body.events : []).map((event) => event.event_id), seq: calls.length };
      return Promise.resolve({
        ok: true,
        status: 200,
        json: function () {
          return Promise.resolve(answer);
        }
      });
    }
  });
  return { store, sync, calls };
}

function draft(note) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.DRAFT,
    note: note,
    page_origin: "http://127.0.0.1:4000",
    page_path: "/roster"
  });
}

test("the last keystroke reaches the helper before the archive does", async (t) => {
  const { store, sync, calls } = client();
  t.after(() => sync.stop());

  // Typed and not yet flushed: this is the ordinary state of the outbox at the
  // moment a reviewer reaches for the door, because the post to the helper is
  // debounced at 750ms of typing idle (protocol.FLUSH).
  sync.recordItem(draft("the last thing they typed"));
  assert.equal(store.pendingEvents("review-1").length, 1, "still queued when End review is pressed");

  const result = await sync.endReview();
  assert.equal(result.ok, true);
  assert.equal(result.endedAt, "2026-08-24T12:00:00.000Z");
  assert.equal(result.outstandingKept, 3, "the helper's count is passed through, not recomputed");
  assert.equal(result.unsent, 0, "nothing was left behind");

  const paths = calls.map((call) => call.url.replace("http://127.0.0.1:7817", ""));
  const events = paths.indexOf(protocol.route("events.append").path);
  const ended = paths.indexOf(protocol.route("review.end").path);
  assert.equal(events !== -1, true, "the queued keystroke was posted");
  assert.equal(ended !== -1, true, "and then the review was ended");
  assert.equal(events < ended, true, "in that order: an archive over unsent typing loses the last thing written");
  assert.equal(store.pendingEvents("review-1").length, 0, "the outbox is empty");
});

test("the end post carries the review token and the custom header the wire requires", async (t) => {
  const { sync, calls } = client();
  t.after(() => sync.stop());
  await sync.endReview();

  const post = calls.filter((call) => call.url.indexOf(protocol.route("review.end").path) !== -1)[0];
  assert.equal(post.body.review, "review-1", "the body names the review");
  assert.equal(post.headers[protocol.HEADER.TOKEN], "t");
  assert.equal(post.headers[protocol.HEADER.CLIENT], protocol.CLIENT_LAYER);
  assert.equal(post.headers[protocol.HEADER.CONTENT_TYPE], protocol.JSON_CONTENT_TYPE, "the route is mutating");
});

test("a helper that cannot be reached is reported, not swallowed", async (t) => {
  const { sync } = client({ refuse: true });
  t.after(() => sync.stop());
  sync.recordItem(draft("typed while the helper was down"));

  const result = await sync.endReview();
  assert.equal(result.ok, false, "the review was not ended");
  assert.equal(typeof result.reason, "string");
  assert.equal(result.reason.length > 0, true, "and the reviewer is told why");
});
