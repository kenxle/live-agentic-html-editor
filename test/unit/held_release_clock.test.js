/*
read-when: The rail's "nothing has come back" clock starts at the wrong moment for a held or delayed comment, or you are changing when the helper stamps an event as received.
*/
"use strict";

// Board row LAHE-held-release-waiting-clock. Ken held his comments through 45
// minutes of work, released them all, and the "Nothing has come back" alert
// came up at once: the waiting clock ran from when each comment was committed
// in the browser, not from when the helper first had it to hand to an agent.
//
// The fix is helper-side. The log stamps every accepted event with the
// helper's own clock (received_at), the fold keeps it on the item, review.json
// carries `waiting_since` (the later of the reviewer's change and that
// stamp), and the rail's clock counts from there.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const reviewFormat = require("../../src/shared/review_format.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const projectionModule = require("../../src/service/projection.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const routes = require("../../src/service/routes.js");

const COMMITTED = "2026-10-15T14:00:00.000Z";
const RELEASED_MS = Date.parse("2026-10-15T14:45:00.000Z");
const RELEASED = new Date(RELEASED_MS).toISOString();

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-held-clock-"));
}

function aComment(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "held through the afternoon",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/p.html",
        page_title: "Page",
        page_seq: 1,
        created_at: COMMITTED,
        updated_at: COMMITTED
      },
      overrides || {}
    )
  );
}

function readyEvent(item, eventId, extra) {
  return Object.assign(
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: eventId,
      review: "r_held",
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item }
    }),
    extra || {}
  );
}

test("the log stamps each accepted event with the helper's clock, over anything the client sent", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir, now: () => RELEASED_MS });
  const item = aComment();
  const forged = {};
  forged[protocol.EVENT_FIELD.RECEIVED_AT] = "1999-01-01T00:00:00.000Z";
  log.append("r_held", [readyEvent(item, "ev_stamped", forged)]);

  const stored = log.read("r_held")[0];
  assert.equal(stored[protocol.EVENT_FIELD.RECEIVED_AT], RELEASED, "the helper's clock, not the page's");
  assert.equal(stored[protocol.EVENT_FIELD.TS] !== undefined, true, "the client's ts is kept beside it");
});

test("the fold keeps the stamp on the item and ignores one carried inside the record", () => {
  const item = aComment();
  const carried = Object.assign({}, item);
  carried[record.FIELD.RECEIVED_AT] = "1999-01-01T00:00:00.000Z";
  const stamped = {};
  stamped[protocol.EVENT_FIELD.RECEIVED_AT] = RELEASED;
  const event = readyEvent(carried, "ev_fold", stamped);

  const projected = projectionModule.project("r_held", [event]).pages[0].items[0];
  assert.equal(projected.reviewer_last_changed_at, COMMITTED, "the reviewer's change is still the reviewer's");
  assert.equal(projected.waiting_since, RELEASED, "an agent could first have seen it when the helper took it in");
});

test("a line from an older helper carries no stamp, and the clock falls back to the reviewer's time", () => {
  const item = aComment();
  const projected = projectionModule.project("r_held", [readyEvent(item, "ev_old")]).pages[0].items[0];
  assert.equal(projected.waiting_since, COMMITTED);
});

test("an event that arrived as it was made leaves waiting_since equal to the reviewer's change", () => {
  const item = aComment();
  const early = {};
  early[protocol.EVENT_FIELD.RECEIVED_AT] = "2026-10-15T13:59:59.000Z";
  const projected = projectionModule.project("r_held", [readyEvent(item, "ev_prompt", early)]).pages[0].items[0];
  assert.equal(projected.waiting_since, COMMITTED, "the later of the two, so a slow browser clock never moves it earlier");
});

test("a same-revision repost that changes no words keeps the first stamp, so the clock never gets quieter", () => {
  // Replay reposts an item at its revision when a lost stamp is found again,
  // and an edit reposts with `existing: true`. Neither is the reviewer doing
  // anything, and neither may move the waiting clock forward (review finding 1).
  const item = aComment();
  const first = {};
  first[protocol.EVENT_FIELD.RECEIVED_AT] = RELEASED;
  const later = {};
  later[protocol.EVENT_FIELD.RECEIVED_AT] = "2026-10-15T16:00:00.000Z";
  const repost = Object.assign(
    protocol.newEvent({
      event: protocol.EVENT.ITEM_CONTENT,
      event_id: "ev_repost",
      review: "r_held",
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item, existing: true }
    }),
    later
  );
  const projected = projectionModule.project("r_held", [readyEvent(item, "ev_first", first), repost]).pages[0].items[0];
  assert.equal(projected.waiting_since, RELEASED, "the repost did not restart the wait");

  // A new revision is new work, and takes the new stamp.
  const reworded = aComment({ id: item[record.FIELD.ID], rev: 2, note: "reworded" });
  const rewordEvent = readyEvent(reworded, "ev_rev2", later);
  const again = projectionModule.project("r_held", [readyEvent(item, "ev_first_b", first), rewordEvent]).pages[0].items[0];
  assert.equal(again.waiting_since, "2026-10-15T16:00:00.000Z");
});

test("waiting_since is a data field, never an instruction", () => {
  assert.equal(record.fieldClass("received_at"), record.CLASS_DATA);
  assert.equal(reviewFormat.DATA_FIELDS.includes("waiting_since"), false, "it is not page text either; it sits with the other times");
});

test("replies.poll counts a held comment's wait from its release, not from its commit", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir, now: () => RELEASED_MS });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const store = agentSessions.createStore({ dir: dir, watchers: { isListening: () => false } });
  store.create({ id: "s_held" });
  reviews.create({ id: "r_held", agent_session_id: "s_held" });

  // Three comments committed at 14:00 and held in the browser; Hold released at
  // 14:45, when all three reach the helper in one post.
  const items = [aComment({ note: "one" }), aComment({ note: "two" }), aComment({ note: "three" })];
  log.append(
    "r_held",
    items.map((item, i) => readyEvent(item, "ev_release_" + i))
  );

  const deps = { log: log, reviews: reviews, agentSessions: store, projection: projectionModule };
  const poll = routes.handlerFor("replies.poll");
  const liveness = poll({ review: "r_held", query: { since: 0 } }, deps).body.agent_liveness;

  assert.equal(liveness.unanswered, 3);
  assert.equal(
    liveness.oldest_unanswered_at,
    RELEASED,
    "the rail's clock starts when an agent could first have seen the work, 45 minutes after the commit"
  );
});
