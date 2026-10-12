// Mark as done: the reviewer closes an outstanding card themselves.
//
// Ken, 2026-10-12: "you should always be able to move a card to done when i
// request it, or i should be able to click the "ready" or "unhandled" and
// change it to done ... it's annoying to have leftover comments i can't get
// rid of". The card that prompted it was a hand edit the page check held open
// with handled_not_on_page, which neither the reviewer nor the agent could
// retire.
//
// What these tests pin, half by half:
//
//   lifecycle   the reviewer may close ready and not_handled, at the current
//               revision; nothing else; and no agent reply moves a closed item
//   merge       a close survives a reload and beats the store's older answer
//               at the same revision; a store ahead of it wins
//   projection  item.closed is an explicit act at one revision: applied when
//               current, dropped when stale, never claimed by a carried record
//   folding     a reply after the close is refused, and the page check never
//               runs for it
//
// Real log, real reply files, real folder, as reply_folding.test.js does.

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
const lifecycle = require("../../src/shared/lifecycle.js");
const merge = require("../../src/shared/merge.js");
const replies = require("../../src/service/replies.js");
const projection = require("../../src/service/projection.js");
const reviewFormat = require("../../src/shared/review_format.js");
const tabDone = require("../../src/layer/tab_done.js");

const REVIEW = "mark-done-review";
const F = record.FIELD;

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-mark-done-"));
}

let counter = 0;
function eventId() {
  counter += 1;
  return "evt_mark_done_" + counter;
}

function postItem(log, item, type) {
  return log.append(REVIEW, [
    protocol.newEvent({
      event: type,
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

function postClose(log, id, rev) {
  return log.append(REVIEW, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_CLOSED,
      event_id: eventId(),
      review: REVIEW,
      item: id,
      rev: rev,
      ts: "2026-10-12T12:00:00.000Z"
    })
  ]);
}

function comment(overrides) {
  return record.newItem(
    Object.assign(
      {
        id: "itm_comment",
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "tighten this paragraph",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/",
        page_title: "Plan",
        page_seq: 1
      },
      overrides || {}
    )
  );
}

function handEdit(overrides) {
  return record.newItem(
    Object.assign(
      {
        id: "itm_edit",
        kind: record.KIND.EDIT,
        state: record.STATE.READY,
        before: "Nine clients checked in this week.",
        after: "Nine clients checked in on Monday.",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/",
        page_title: "Plan",
        page_seq: 1
      },
      overrides || {}
    )
  );
}

function writeReplies(dir, lines) {
  fs.appendFileSync(
    stateDir.replyFilePath(dir, REVIEW, "replies-claude.jsonl"),
    lines.map((l) => JSON.stringify(l) + "\n").join(""),
    { mode: 0o600 }
  );
}

function setup(options) {
  const dir = freshDir();
  const log = logModule.createEventLog({ dir: dir });
  stateDir.ensureReviewDir(dir, REVIEW);
  const folder = replies.createReplyFolder(Object.assign({ dir: dir, log: log }, options || {}));
  return { dir, log, folder };
}

function itemOf(log, id) {
  return projection.itemsFrom(log.read(REVIEW)).find((item) => item.id === id) || null;
}

function projectedItem(log, id) {
  const out = projection.project(REVIEW, log.read(REVIEW));
  for (const page of out.pages) {
    const got = page.items.find((item) => item.id === id);
    if (got) return got;
  }
  return null;
}

// ---------------------------------------------------------------------------
// lifecycle
// ---------------------------------------------------------------------------

test("the reviewer may move ready and not_handled to handled, and the table says so", () => {
  const R = lifecycle.ACTOR.REVIEWER;
  assert.ok(lifecycle.canTransition(record.STATE.READY, record.STATE.HANDLED, R));
  assert.ok(lifecycle.canTransition(record.STATE.NOT_HANDLED, record.STATE.HANDLED, R));
  assert.match(lifecycle.findTransition(record.STATE.READY, record.STATE.HANDLED, R).why, /MARK AS DONE/);
  // The agent's own arrow is unchanged and still distinct.
  assert.ok(lifecycle.canTransition(record.STATE.READY, record.STATE.HANDLED, lifecycle.ACTOR.AGENT));
  assert.ok(!lifecycle.canTransition(record.STATE.NOT_HANDLED, record.STATE.HANDLED, lifecycle.ACTOR.AGENT));
  assert.ok(!lifecycle.canTransition(record.STATE.DRAFT, record.STATE.HANDLED, R), "a draft is never closed");
});

test("closeItem keeps the revision and the reply, names the reviewer, and clears a held claim", () => {
  const held = Object.assign(handEdit(), {
    reply: { status: "handled", agent: "claude", text: "done", at: "2026-10-12T10:00:00.000Z" },
    handled_not_on_page: true
  });
  assert.ok(lifecycle.canClose(held));
  const closed = lifecycle.closeItem(held, "2026-10-12T12:00:00.000Z");
  assert.equal(closed.state, record.STATE.HANDLED);
  assert.equal(closed.rev, held.rev);
  assert.equal(closed.closed_by, "reviewer");
  assert.equal(closed.closed_at, "2026-10-12T12:00:00.000Z");
  assert.equal(closed.handled_not_on_page, false);
  assert.deepEqual(closed.reply, held.reply, "the agent's last answer stays as history");
  assert.equal(held.state, record.STATE.READY, "the input is untouched");
  assert.ok(record.isClosedByReviewer(closed));
  assert.ok(!record.isOutstanding(closed));
  assert.ok(!record.isReplayable(closed), "the page shows the file");
  assert.ok(!record.isUnansweredReady(closed), "off the drain");
});

test("closing a draft or a handled item throws", () => {
  assert.equal(lifecycle.canClose(comment({ state: record.STATE.DRAFT })), false);
  assert.throws(() => lifecycle.closeItem(comment({ state: record.STATE.DRAFT })), /illegal lifecycle transition/);
  const done = Object.assign(comment(), { state: record.STATE.HANDLED });
  assert.equal(lifecycle.canClose(done), false);
  assert.throws(() => lifecycle.closeItem(done), /illegal lifecycle transition/);
});

test("no reply moves a closed item, whatever it says", () => {
  const closed = lifecycle.closeItem(comment());
  for (const status of ["handled", "not_handled", "question"]) {
    const got = lifecycle.applyReply(closed, { rev: closed.rev, status: status, agent: "claude" });
    assert.equal(got.accepted, false, status + " is refused");
    assert.equal(got.state, record.STATE.HANDLED);
    assert.match(got.refusal, /marked this item done/);
  }
});

test("a new revision drops the close mark", () => {
  const closed = lifecycle.closeItem(comment());
  const reopened = Object.assign(record.bumpRev(closed, { note: "one more thing" }), { state: record.STATE.READY });
  assert.equal(reopened.state, record.STATE.READY);
  assert.equal(reopened.closed_by, undefined);
  assert.equal(reopened.closed_at, undefined);
});

// ---------------------------------------------------------------------------
// merge
// ---------------------------------------------------------------------------

test("merge: a close at the same revision beats the store's older not_handled", () => {
  const answered = Object.assign(comment(), {
    state: record.STATE.NOT_HANDLED,
    reply: { status: "not_handled", agent: "claude", reason: "unclear", at: "2026-10-12T10:00:00.000Z" }
  });
  const browser = Object.assign(lifecycle.closeItem(answered), { acknowledged: true });
  const got = merge.mergeItem(browser, answered);
  assert.equal(got.item.state, record.STATE.HANDLED);
  assert.equal(got.item.closed_by, "reviewer");
  assert.deepEqual(got.item.reply, answered.reply);
});

test("merge: a close survives a reload when both sides hold it", () => {
  const closed = lifecycle.closeItem(comment());
  const got = merge.mergeItem(Object.assign({}, closed, { acknowledged: true }), closed);
  assert.ok(record.isClosedByReviewer(got.item));
});

test("merge: a store ahead of the close wins, because the close named an older wording", () => {
  const closed = lifecycle.closeItem(comment());
  const reworded = record.bumpRev(comment(), { note: "actually, cut it" });
  const got = merge.mergeItem(closed, reworded);
  assert.equal(got.reason, merge.REASON.STORE_NEWER_REV);
  assert.equal(got.item.state, record.STATE.READY);
  assert.ok(!record.isClosedByReviewer(got.item));
});

// ---------------------------------------------------------------------------
// projection
// ---------------------------------------------------------------------------

test("projection: item.closed at the current revision moves a not_handled comment to handled", () => {
  const { dir, log, folder } = setup();
  const item = comment();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  writeReplies(dir, [{ item: item.id, rev: 1, status: "not_handled", agent: "claude", reason: "unclear" }]);
  folder.fold(REVIEW);
  assert.equal(itemOf(log, item.id).state, record.STATE.NOT_HANDLED);

  postClose(log, item.id, 1);
  const after = itemOf(log, item.id);
  assert.equal(after.state, record.STATE.HANDLED);
  assert.equal(after.closed_by, "reviewer");
  assert.equal(after.reply.status, "not_handled", "the agent's answer is kept as history");

  const shown = projectedItem(log, item.id);
  assert.equal(shown.state, "handled");
  assert.equal(shown.closed_by_reviewer, true);
  assert.equal(record.isUnansweredReady(after), false, "the drain stops listing it");
});

test("projection: a held hand edit closes, and handled_not_on_page clears", () => {
  const pageShows = () => false;
  const { dir, log, folder } = setup({ pageShows: pageShows });
  const item = handEdit();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  writeReplies(dir, [{ item: item.id, rev: 1, status: "handled", agent: "claude", text: "used other words" }]);
  folder.fold(REVIEW);
  const held = itemOf(log, item.id);
  assert.equal(held.state, record.STATE.READY);
  assert.equal(held.handled_not_on_page, true);
  assert.equal(record.isUnansweredReady(held), true, "held: still on the drain");

  postClose(log, item.id, 1);
  const closed = itemOf(log, item.id);
  assert.equal(closed.state, record.STATE.HANDLED);
  assert.equal(closed.handled_not_on_page, false);
  assert.equal(record.isUnansweredReady(closed), false);
  assert.equal(projectedItem(log, item.id).handled_not_on_page, false);
});

test("projection: a close naming an older revision is dropped and reported", () => {
  const { log } = setup();
  const item = comment();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  postItem(log, record.bumpRev(item, { note: "reworded" }), protocol.EVENT.ITEM_READY);
  postClose(log, item.id, 1);
  const dropped = [];
  const items = projection.itemsFrom(log.read(REVIEW), {
    onDropped: (event, reason) => dropped.push(reason)
  });
  assert.equal(items[0].state, record.STATE.READY, "the rewording stays outstanding");
  assert.equal(items[0].closed_by, undefined);
  assert.equal(dropped.length, 1);
  assert.match(dropped[0], /rev 1 but the item is at rev 2/);
});

test("projection: a carried record cannot claim a close", () => {
  const { log } = setup();
  const item = comment();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  const claimed = Object.assign({}, item, { closed_by: "reviewer", closed_at: "2026-10-12T12:00:00.000Z" });
  postItem(log, claimed, protocol.EVENT.ITEM_CONTENT);
  const got = itemOf(log, item.id);
  assert.equal(got.closed_by, undefined);
  assert.equal(projectedItem(log, item.id).closed_by_reviewer, false);
});

test("projection: a same-revision re-post after the close keeps it closed; a reword reopens it", () => {
  const { log } = setup();
  const item = comment();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  postClose(log, item.id, 1);
  // A reconnect re-posts the record at the same revision, claiming ready.
  postItem(log, item, protocol.EVENT.ITEM_CONTENT);
  assert.ok(record.isClosedByReviewer(itemOf(log, item.id)));
  // The reviewer follows up from Done: a new revision, new work.
  const next = Object.assign(record.bumpRev(lifecycle.closeItem(item), { note: "one more thing" }), {
    state: record.STATE.READY
  });
  postItem(log, next, protocol.EVENT.ITEM_READY);
  const reopened = itemOf(log, item.id);
  assert.equal(reopened.state, record.STATE.READY);
  assert.equal(reopened.rev, 2);
  assert.equal(reopened.closed_by, undefined);
});

test("projection: a close is the same fold whether read whole or in pieces", () => {
  const { dir, log, folder } = setup();
  const item = comment();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  writeReplies(dir, [{ item: item.id, rev: 1, status: "not_handled", agent: "claude", reason: "no" }]);
  folder.fold(REVIEW);
  postClose(log, item.id, 1);
  const events = log.read(REVIEW);
  const whole = projection.itemsFrom(events);
  for (let cut = 0; cut <= events.length; cut += 1) {
    const state = projection.createFold();
    projection.foldEvents(state, events.slice(0, cut));
    projection.foldEvents(state, events.slice(cut));
    assert.deepEqual(projection.itemsOf(state), whole, "cut at " + cut);
  }
});

// ---------------------------------------------------------------------------
// reply folding after a close
// ---------------------------------------------------------------------------

test("folding: a handled reply after the close is refused, and the page check never runs", () => {
  let checks = 0;
  const pageShows = () => {
    checks += 1;
    return false;
  };
  const { dir, log, folder } = setup({ pageShows: pageShows });
  const item = handEdit();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  writeReplies(dir, [{ item: item.id, rev: 1, status: "not_handled", agent: "claude", reason: "no" }]);
  folder.fold(REVIEW);
  postClose(log, item.id, 1);

  writeReplies(dir, [{ item: item.id, rev: 1, status: "handled", agent: "claude", text: "did it after all" }]);
  const summary = folder.fold(REVIEW);
  assert.equal(summary.accepted.length, 0);
  assert.equal(summary.refused.length, 1);
  assert.match(summary.refused[0].refusal, /marked this item done/);
  assert.equal(checks, 0, "the page check never runs on a closed item");

  const after = itemOf(log, item.id);
  assert.ok(record.isClosedByReviewer(after), "the close stands");
  assert.equal(after.reply.status, "not_handled", "the refused line is not the item's reply");
});

test("folding: a question after the close is refused too", () => {
  const { dir, log, folder } = setup();
  const item = comment();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  postClose(log, item.id, 1);
  writeReplies(dir, [{ item: item.id, rev: 1, status: "question", agent: "claude", text: "which paragraph?" }]);
  const summary = folder.fold(REVIEW);
  assert.equal(summary.refused.length, 1);
  assert.ok(record.isClosedByReviewer(itemOf(log, item.id)));
});

test("folding: an accepted fold written before the close was folded cannot reopen it", () => {
  const { log } = setup();
  const item = comment();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  postClose(log, item.id, 1);
  log.append(REVIEW, [
    protocol.newEvent({
      event: protocol.EVENT.REPLY_FOLDED,
      event_id: eventId(),
      review: REVIEW,
      item: item.id,
      rev: 1,
      payload: { accepted: true, state: "not_handled", reply: { status: "not_handled", agent: "claude" } }
    })
  ]);
  assert.ok(record.isClosedByReviewer(itemOf(log, item.id)));
});

// ---------------------------------------------------------------------------
// the rail's reading rule
// ---------------------------------------------------------------------------

test("a closed card never counts as an unread reply", () => {
  const answered = Object.assign(comment(), {
    state: record.STATE.NOT_HANDLED,
    reply: { status: "not_handled", agent: "claude", reason: "unclear", at: "2026-10-12T10:00:00.000Z" }
  });
  assert.deepEqual(tabDone.unseenReplyIds([answered], {}), [answered.id], "unread before the close");
  const closed = lifecycle.closeItem(answered);
  assert.deepEqual(tabDone.unseenReplyIds([closed], {}), [], "read once closed");
});

test("the contract tells an agent a closed item takes no reply", () => {
  assert.ok(reviewFormat.CONTRACT.some((line) => /closed_by_reviewer: true/.test(line) && /refused/.test(line)));
});
