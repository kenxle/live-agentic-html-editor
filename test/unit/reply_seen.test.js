// The read mark's round trip: the rail's "1 new" mark posted as reply.seen,
// folded by the helper, and adopted by a second browser.
//
// Menu bar plan, Task 1.1. The rows this file proves:
//
//   V3  one unread rule, in record.js, that the rail and the helper both call;
//       a reply counts until a reply.seen naming its stamp is projected; a
//       routine handled reply, a tool round and a closed card never count; a
//       mark for an older reply does not clear a newer one
//   V4  a review with no reply.seen events counts every reply the rule names
//   V7  a reply.seen for an item the review does not hold, a stamp over 64
//       characters, a stamp that is not the current reply's, and a non-string
//       are each dropped and reported, and store nothing
//
// and the page's half headless: the Done tab posts one reply.seen per stamp
// when it writes its mark, and adopts a polled one into its own marks. The
// browser half (V5) is test/browser/menubar_summary.spec.js.
//
// Real log and real projection, as mark_done.test.js does.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logModule = require("../../src/service/log.js");
const stateDir = require("../../src/service/state_dir.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const projection = require("../../src/service/projection.js");
const storeModule = require("../../src/layer/store.js");
const overlay = require("../../src/layer/overlay.js");
const tabDone = require("../../src/layer/tab_done.js");

const REVIEW = "reply-seen-review";
const F = record.FIELD;

let counter = 0;
function eventId() {
  counter += 1;
  return "evt_reply_seen_" + counter;
}

function freshLog() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-reply-seen-"));
  stateDir.ensureReviewDir(dir, REVIEW);
  return { dir, log: logModule.createEventLog({ dir: dir }) };
}

function comment(overrides) {
  return record.newItem(
    Object.assign(
      {
        id: "itm_q",
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "which version is current?",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/",
        page_title: "Plan",
        page_seq: 1
      },
      overrides || {}
    )
  );
}

function postItem(log, item, type) {
  return log.append(REVIEW, [
    protocol.newEvent({
      event: type || protocol.EVENT.ITEM_READY,
      event_id: eventId(),
      review: REVIEW,
      item: item[F.ID],
      rev: item[F.REV],
      page_path: item[F.PAGE_PATH],
      page_title: item[F.PAGE_TITLE],
      page_seq: item[F.PAGE_SEQ],
      payload: { draft: record.isDraft(item), record: item }
    })
  ]);
}

function postFold(log, item, reply, ts, state) {
  return log.append(REVIEW, [
    protocol.newEvent({
      event: protocol.EVENT.REPLY_FOLDED,
      event_id: eventId(),
      review: REVIEW,
      item: item[F.ID],
      rev: item[F.REV],
      ts: ts,
      payload: { accepted: true, state: state || record.STATE.READY, file: "replies-claude.jsonl", reply: reply }
    })
  ]);
}

function postSeen(log, id, stamp) {
  return log.append(REVIEW, [
    protocol.newEvent({ event: protocol.EVENT.REPLY_SEEN, event_id: eventId(), review: REVIEW, item: id, payload: { stamp: stamp } })
  ]);
}

const QUESTION = { status: "question", agent: "claude", text: "the March or the April one?" };
const ROUTINE = { status: "handled", agent: "claude", text: null, files: [] };

function itemsOf(log, dropped) {
  return projection.itemsFrom(log.read(REVIEW), {
    onDropped: (event, reason) => {
      if (dropped) dropped.push(reason);
    }
  });
}

function itemOf(log, id, dropped) {
  return itemsOf(log, dropped).find((item) => item[F.ID] === id) || null;
}

// ---------------------------------------------------------------------------
// The one rule (V3, V4)
// ---------------------------------------------------------------------------

test("V3: the rail and the helper call one unread rule, and it lives in record.js", () => {
  assert.equal(tabDone.unseenReplyIds, record.unseenReplyIds, "the Done tab's unread ids are record.js's");
  assert.equal(tabDone.needsToSeeReply, record.needsToSeeReply, "and so is the rule for which replies need reading");
  assert.equal(protocol.EVENT.REPLY_SEEN, "reply.seen");
  assert.ok(protocol.EVENT_TYPES.indexOf("reply.seen") !== -1, "reply.seen is in the closed vocabulary");
});

test("V3: a question counts until a reply.seen naming its stamp is projected, and then it does not", () => {
  const { log } = freshLog();
  const item = comment();
  postItem(log, item);
  postFold(log, item, QUESTION, "2026-10-20T15:40:00.000Z");
  assert.deepEqual(record.unseenReplyIds(itemsOf(log)), ["itm_q"], "unread on arrival");

  postSeen(log, "itm_q", record.replyStamp(itemOf(log, "itm_q")));
  const read = itemOf(log, "itm_q");
  assert.equal(read[F.REPLY_SEEN], record.replyStamp(read));
  assert.deepEqual(record.unseenReplyIds([read]), [], "read once the mark is folded");
  assert.equal(read[F.STATE], record.STATE.READY, "not a lifecycle move: the question is still open");
  assert.equal(read[F.REV], item[F.REV]);
  assert.deepEqual(read[F.REPLY], itemOf(log, "itm_q")[F.REPLY], "and the reply is untouched");
});

test("V3: a routine handled reply, a tool round and a card the reviewer closed never count", () => {
  const at = "2026-10-20T15:40:00.000Z";
  const routine = Object.assign(comment({ id: "itm_routine", state: record.STATE.HANDLED }), { reply: Object.assign({ at: at }, ROUTINE) });
  const flaggedNoWords = Object.assign(comment({ id: "itm_flag" }), {
    reply: Object.assign({ at: at, user_needs_to_see_reply: true }, ROUTINE)
  });
  const tool = Object.assign(comment({ id: "itm_tool" }), { reply: { status: "not_handled", agent: "claude", reason: "no source", at: at } });
  record.stampPageCheckReopen(tool, null, at, record.TOOL_ROUND.PAGE_CHECK_STAMP);
  const closed = Object.assign(comment({ id: "itm_closed", state: record.STATE.HANDLED }), {
    reply: Object.assign({ at: at }, QUESTION),
    closed_by: record.CLOSED_BY_REVIEWER
  });
  assert.ok(record.toolRoundOf(tool), "the fixture really is a tool round");
  assert.deepEqual(record.unseenReplyIds([routine, flaggedNoWords, tool, closed]), []);
});

test("V3: a mark for an older reply does not clear a newer one", () => {
  const { log } = freshLog();
  const item = comment();
  postItem(log, item);
  postFold(log, item, QUESTION, "2026-10-20T15:40:00.000Z");
  const oldStamp = record.replyStamp(itemOf(log, "itm_q"));
  postSeen(log, "itm_q", oldStamp);
  postFold(log, item, { status: "question", agent: "claude", text: "and the footnote?" }, "2026-10-20T15:45:00.000Z");
  const now = itemOf(log, "itm_q");
  assert.notEqual(record.replyStamp(now), oldStamp);
  assert.deepEqual(record.unseenReplyIds([now]), ["itm_q"], "the second question is unread");
  assert.deepEqual(record.unseenReplyIds([now], { itm_q: oldStamp }), ["itm_q"], "a browser's old mark does not clear it either");
});

test("V4: a review with no reply.seen events counts every reply the rule names", () => {
  const { log } = freshLog();
  const asked = comment({ id: "itm_a" });
  const refused = comment({ id: "itm_b" });
  const flagged = comment({ id: "itm_c" });
  const routine = comment({ id: "itm_d" });
  [asked, refused, flagged, routine].forEach((it) => postItem(log, it));
  postFold(log, asked, QUESTION, "2026-10-20T15:40:00.000Z");
  postFold(log, refused, { status: "not_handled", agent: "claude", reason: "no such file" }, "2026-10-20T15:40:01.000Z", record.STATE.NOT_HANDLED);
  postFold(log, flagged, { status: "handled", agent: "claude", text: "done, on the other slide", user_needs_to_see_reply: true }, "2026-10-20T15:40:02.000Z", record.STATE.HANDLED);
  postFold(log, routine, ROUTINE, "2026-10-20T15:40:03.000Z", record.STATE.HANDLED);
  assert.deepEqual(record.unseenReplyIds(itemsOf(log)), ["itm_a", "itm_b", "itm_c"], "an old page posts nothing, so the count holds");
});

// ---------------------------------------------------------------------------
// The projection's bounds (V7)
// ---------------------------------------------------------------------------

test("V7: a reply.seen for an unknown item, an over-long stamp, another reply's stamp or a non-string is dropped and reported", () => {
  const { dir, log } = freshLog();
  const item = comment();
  postItem(log, item);
  postFold(log, item, QUESTION, "2026-10-20T15:40:00.000Z");
  const before = itemOf(log, "itm_q");
  const stamp = record.replyStamp(before);

  // The helper refuses a malformed one at the door: it never reaches the log.
  const longStamp = postSeen(log, "itm_q", "x".repeat(record.REPLY_STAMP_MAX + 1));
  const numberStamp = postSeen(log, "itm_q", 12345);
  const nullStamp = postSeen(log, "itm_q", null);
  [longStamp, numberStamp, nullStamp].forEach((result) => {
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /stamp of 1 to 64 characters/);
  });
  // A well-formed one naming the wrong item or reply is folded and dropped.
  postSeen(log, "itm_nobody", stamp);
  postSeen(log, "itm_q", "2026-10-20T15:39:00.000Z@1");
  // A malformed line already on disk (an older helper's, or written by hand)
  // is dropped by the fold too.
  const stray = protocol.newEvent({ event: protocol.EVENT.REPLY_SEEN, event_id: eventId(), review: REVIEW, item: "itm_q", seq: 999, payload: { stamp: "x".repeat(100) } });
  stateDir.appendLine(stateDir.eventsPath(dir, REVIEW), protocol.encodeEventLine(stray));

  const dropped = [];
  const after = itemOf(logModule.createEventLog({ dir: dir }), "itm_q", dropped);
  assert.equal(dropped.length, 3, "each one is reported: " + JSON.stringify(dropped));
  assert.match(dropped[0], /does not hold/);
  assert.match(dropped[1], /but the item's reply is/);
  assert.match(dropped[2], /stamp of 1 to 64 characters/);
  assert.equal(after[F.REPLY_SEEN], undefined, "and nothing is stored");
  assert.deepEqual(after, before);
  assert.equal(record.REPLY_STAMP_MAX, 64);
});

test("the browser's carried record cannot claim a read mark, and a new revision drops the helper's", () => {
  const { log } = freshLog();
  const item = comment();
  postItem(log, item);
  postFold(log, item, QUESTION, "2026-10-20T15:40:00.000Z");
  const stamp = record.replyStamp(itemOf(log, "itm_q"));

  // A same-revision re-post claiming the mark: not taken.
  postItem(log, Object.assign({}, item, { reply_seen: stamp }), protocol.EVENT.ITEM_CONTENT);
  assert.equal(itemOf(log, "itm_q")[F.REPLY_SEEN], undefined);

  // The real mark stands through a same-revision re-post.
  postSeen(log, "itm_q", stamp);
  postItem(log, item, protocol.EVENT.ITEM_CONTENT);
  assert.equal(itemOf(log, "itm_q")[F.REPLY_SEEN], stamp);

  // The reviewer answers: a new revision, no reply, no mark.
  postItem(log, Object.assign({}, item, { rev: item[F.REV] + 1, note: "the April one" }));
  assert.equal(itemOf(log, "itm_q")[F.REPLY_SEEN], undefined);
});

test("a reviewer reading a reply is not work on the document: the Library's last skips it", () => {
  assert.ok(protocol.CATALOG.NOT_WORK_EVENTS.indexOf(protocol.EVENT.REPLY_SEEN) !== -1);
});

// ---------------------------------------------------------------------------
// The page's half, headless
// ---------------------------------------------------------------------------

function pageSetup() {
  const store = storeModule.createStore({ storage: null });
  const rail = overlay.createRail({ store: store, reviewId: REVIEW });
  const posted = [];
  const fakeSync = {
    markReplySeen: (item) => {
      posted.push({ item: item[F.ID], stamp: record.replyStamp(item) });
      return { ok: true };
    }
  };
  const done = tabDone.createDoneTab({ store: store, reviewId: REVIEW, overlay: rail, document: null, sync: () => fakeSync });
  done.mount();
  return { store, rail, done, posted };
}

function foldEvent(item, reply, state, ts) {
  return protocol.newEvent({
    event: protocol.EVENT.REPLY_FOLDED,
    event_id: record.randomId("evt"),
    review: REVIEW,
    item: item[F.ID],
    rev: item[F.REV],
    ts: ts || "2026-10-20T15:40:00.000Z",
    payload: { accepted: true, state: state || record.STATE.READY, file: "replies-claude.jsonl", reply: reply }
  });
}

function seenEvent(id, stamp) {
  return protocol.newEvent({ event: protocol.EVENT.REPLY_SEEN, event_id: record.randomId("evt"), review: REVIEW, item: id, payload: { stamp: stamp } });
}

test("opening the card's tab posts one reply.seen per stamp, not one per paint", () => {
  const { store, rail, done, posted } = pageSetup();
  const item = store.write(REVIEW, comment());
  rail.upsertCard(item);
  rail.selectTab(overlay.TAB.DONE);
  done.applyReplies([foldEvent(item, QUESTION)]);
  assert.deepEqual(done.unseenIds(), ["itm_q"], "the question lands out of sight, on Active");
  assert.deepEqual(posted, [], "nothing is read yet");

  rail.selectTab(overlay.TAB.ACTIVE);
  const stamp = record.replyStamp(store.readItem(REVIEW, "itm_q"));
  assert.deepEqual(posted, [{ item: "itm_q", stamp: stamp }]);

  // Paints, refreshes and another visit say nothing new.
  done.refresh();
  rail.selectTab(overlay.TAB.DONE);
  rail.selectTab(overlay.TAB.ACTIVE);
  done.refresh();
  assert.equal(posted.length, 1, "one post for the stamp");
});

test("a routine reply is stamped read as it folds and never posted", () => {
  const { store, rail, done, posted } = pageSetup();
  const item = store.write(REVIEW, comment());
  rail.upsertCard(item);
  done.applyReplies([foldEvent(item, ROUTINE, record.STATE.HANDLED)]);
  rail.selectTab(overlay.TAB.DONE);
  assert.deepEqual(posted, [], "it was never unread, so there is nothing to tell the helper");
});

test("a polled reply.seen for the current reply is adopted into this browser's marks, with nothing posted back", () => {
  const { store, rail, done, posted } = pageSetup();
  const item = store.write(REVIEW, comment());
  rail.upsertCard(item);
  rail.selectTab(overlay.TAB.DONE);
  done.applyReplies([foldEvent(item, QUESTION)]);
  assert.deepEqual(done.unseenIds(), ["itm_q"]);
  assert.equal(rail.tabNewCount(overlay.TAB.ACTIVE), 1);

  const stamp = record.replyStamp(store.readItem(REVIEW, "itm_q"));
  done.applyReplies([seenEvent("itm_q", "2026-10-20T15:00:00.000Z@1")]);
  assert.deepEqual(done.unseenIds(), ["itm_q"], "a mark for another reply is ignored");

  done.applyReplies([seenEvent("itm_q", stamp)]);
  assert.deepEqual(done.unseenIds(), [], "read in another browser, read here");
  assert.equal(rail.tabNewCount(overlay.TAB.ACTIVE), 0, "and the tab's count clears with it");
  assert.equal(store.readSeenReplies(REVIEW).itm_q, stamp, "the mark is durable");
  rail.selectTab(overlay.TAB.ACTIVE);
  assert.deepEqual(posted, [], "an adopted mark is never posted back");
});

// ---------------------------------------------------------------------------
// Fix round (code and security review of the integrated diff)
// ---------------------------------------------------------------------------

const syncModule = require("../../src/layer/sync.js");

test("Hold holds agent work, not read marks: a held review posts its reply.seen and keeps the rest queued", async (t) => {
  const store = storeModule.createStore();
  store.setHeld(REVIEW, true);
  const posted = [];
  const sync = syncModule.createSync({
    review: REVIEW,
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: async (_url, config) => {
      const sent = JSON.parse(config.body);
      posted.push(sent.events.map((e) => e.event));
      return { ok: true, status: 200, json: async () => ({ accepted: sent.events.map((e) => e.event_id), seq: 1 }) };
    }
  });
  t.after(() => sync.stop());

  sync.recordItem(comment({ id: "itm_other" }), { immediate: "ready" });
  const answered = Object.assign(comment(), { reply: Object.assign({ at: "2026-10-20T15:40:00.000Z" }, QUESTION) });
  assert.ok(sync.markReplySeen(answered), "the mark is queued");
  await sync.flush();

  assert.deepEqual(posted, [["reply.seen"]], "exactly the read mark went out");
  const left = store.pendingEvents(REVIEW);
  assert.deepEqual(left.map((e) => [e.event, e.item]), [["item.ready", "itm_other"]], "the held comment stays queued");
});

test("reply.seen carries only its item and stamp: no page fields, no rev", () => {
  const store = storeModule.createStore();
  const sync = syncModule.createSync({ review: REVIEW, token: "t", helperOrigin: "http://127.0.0.1:7817", store: store, document: null, window: null, fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  const answered = Object.assign(comment(), { reply: Object.assign({ at: "2026-10-20T15:40:00.000Z" }, QUESTION) });
  const event = sync.markReplySeen(answered);
  sync.stop();
  assert.equal(event.stamp, record.replyStamp(answered));
  ["rev", "page_path", "page_title", "page_seq", "source_hint"].forEach((key) => assert.equal(event[key], null, key));
});

test("review.json does not carry reply_seen, and records.read's items still do", () => {
  const { log } = freshLog();
  const item = comment();
  postItem(log, item);
  postFold(log, item, QUESTION, "2026-10-20T15:40:00.000Z");
  postSeen(log, "itm_q", record.replyStamp(itemOf(log, "itm_q")));
  const projected = projection.project(REVIEW, log.read(REVIEW));
  const items = projected.pages.reduce((all, page) => all.concat(page.items), []);
  assert.equal(items.length, 1);
  items.forEach((it) => assert.equal(Object.prototype.hasOwnProperty.call(it, "reply_seen"), false, "no reply_seen in review.json"));
  // records.read answers with the projection's own records (routes.js).
  assert.equal(itemOf(log, "itm_q").reply_seen, record.replyStamp(itemOf(log, "itm_q")));
});

test("log.append refuses a bad reply.seen: it lands in rejected and never on disk", () => {
  const { log } = freshLog();
  const seen = (fields, payload) =>
    protocol.newEvent(Object.assign({ event: protocol.EVENT.REPLY_SEEN, event_id: eventId(), review: REVIEW, item: "itm_q" }, fields, { payload: payload }));
  const longStamp = seen({}, { stamp: "x".repeat(1000) });
  const extraKey = seen({}, { stamp: "2026-10-20T15:40:00.000Z@1", note: "page text" });
  const pageFields = seen({ page_title: "A page" }, { stamp: "2026-10-20T15:40:00.000Z@1" });
  const noItem = seen({ item: null }, { stamp: "2026-10-20T15:40:00.000Z@1" });
  const good = seen({}, { stamp: "2026-10-20T15:40:00.000Z@1" });
  const result = log.append(REVIEW, [longStamp, extraKey, pageFields, noItem, good]);
  assert.deepEqual(result.rejected.map((r) => r.event_id), [longStamp.event_id, extraKey.event_id, pageFields.event_id, noItem.event_id]);
  assert.deepEqual(result.accepted, [good.event_id]);
  const onDisk = log.read(REVIEW).map((e) => e.event_id);
  assert.deepEqual(onDisk, [good.event_id], "only the good mark is on disk");
});
