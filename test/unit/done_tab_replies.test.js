// What a folded reply does to the reviewer's own records, headless.
//
// Owner: 3A. The DOM half of the Done tab (the rows, the question treatment,
// the chip) is a browser test, because a rail asserted in a fake DOM proves
// nothing about what the reviewer sees. What is asserted here is the decision
// layer: which replies are applied, which are refused, and what the store holds
// afterwards.
//
// The rail here is a real overlay with no document, which is the shape 1B built
// for exactly this: every card call is real and draws nothing.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const storeModule = require("../../src/layer/store.js");
const overlay = require("../../src/layer/overlay.js");
const tabDone = require("../../src/layer/tab_done.js");
const record = require("../../src/shared/record.js");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "done-tab-review";

function setup(options) {
  const opts = options || {};
  const store = storeModule.createStore({ storage: null });
  const rail = overlay.createRail({ store: store, reviewId: REVIEW });
  const done = tabDone.createDoneTab({
    store: store,
    reviewId: REVIEW,
    overlay: rail,
    document: null,
    isReadOnly: opts.isReadOnly
  });
  done.mount();
  return { store, rail, done };
}

function readyItem(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "shorten this heading",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/"
      },
      overrides || {}
    )
  );
}

function foldEvent(item, fields) {
  return protocol.newEvent(
    Object.assign(
      {
        event: protocol.EVENT.REPLY_FOLDED,
        event_id: record.randomId("evt"),
        review: REVIEW,
        item: item[record.FIELD.ID],
        rev: item[record.FIELD.REV],
        payload: {
          accepted: true,
          state: record.STATE.HANDLED,
          file: "replies-claude.jsonl",
          reply: { status: "handled", agent: "claude", reason: null, text: null, files: [] }
        }
      },
      fields || {}
    )
  );
}

test("a handled reply retires the item in this browser's own storage", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);

  const applied = done.applyReplies([foldEvent(item)]);
  assert.equal(applied[0].kind, "folded");

  const stored = store.readItem(REVIEW, item.id);
  assert.equal(stored.state, record.STATE.HANDLED);
  assert.equal(stored.reply.agent, "claude");
  assert.equal(rail.getCard(item.id).state, record.STATE.HANDLED);
  assert.equal(rail.getCard(item.id).pane, overlay.TAB.DONE, "and it moved to the Done tab");
});

test("a reply the helper refused leaves the item outstanding and says so on the card", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);

  const refused = foldEvent(item, {
    payload: {
      accepted: false,
      state: record.STATE.READY,
      refusal: "reply names rev 1 but the item is at rev 2",
      file: "replies-claude.jsonl",
      reply: { status: "handled", agent: "claude" }
    }
  });

  const applied = done.applyReplies([refused]);
  assert.equal(applied[0].kind, "refused");
  assert.equal(store.readItem(REVIEW, item.id).state, record.STATE.READY);
  assert.equal(store.readItem(REVIEW, item.id).reply, null);
  assert.match(rail.getCard(item.id).notice, /claude answered an older version/);
});

test("a reply that named the revision this browser has already moved past is refused here too", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem({ kind: record.KIND.EDIT, before: "a", after: "b" }));
  rail.upsertCard(item);

  // The reviewer rewords with the helper down: rev 2 lives in this browser and
  // nowhere else. The fold that comes back on reconnect named rev 1, and it
  // looked current to the helper at the moment it folded.
  const reworded = store.writeRevision(REVIEW, item, { after: "b, and say when" });
  assert.equal(reworded.rev, 2);

  const applied = done.applyReplies([foldEvent(item, { payload: { accepted: true, state: record.STATE.HANDLED, file: "replies.jsonl", reply: { status: "handled", agent: "claude" } } })]);
  assert.equal(applied[0].kind, "refused");
  assert.equal(store.readItem(REVIEW, item.id).state, record.STATE.READY, "the rewording stays outstanding");
  assert.equal(store.readItem(REVIEW, item.id).rev, 2);
});

test("a question leaves the item ready, carries the agent's name, and is not markup", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);

  done.applyReplies([
    foldEvent(item, {
      payload: {
        accepted: true,
        state: record.STATE.READY,
        file: "replies-claude.jsonl",
        reply: { status: "question", agent: "claude", text: "<b>which</b> heading do you mean?" }
      }
    })
  ]);

  const stored = store.readItem(REVIEW, item.id);
  assert.equal(stored.state, record.STATE.READY, "a question is not a state change");
  assert.equal(stored.reply.status, "question");
  assert.equal(stored.reply.text, "<b>which</b> heading do you mean?", "carried whole, as text");
  // The question does not also ride the rail's quiet agent-message carrier:
  // one card, one place the question is said, and that place is the loud one.
  assert.equal(rail.getCard(item.id).agentMessage, null);
});

test("an agent with no name in its reply is called agent", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  done.applyReplies([
    foldEvent(item, {
      payload: { accepted: true, state: record.STATE.NOT_HANDLED, file: "replies.jsonl", reply: { status: "not_handled", reason: "no such file" } }
    })
  ]);
  assert.equal(rail.getCard(item.id).agentMessage.agent, "agent");
  assert.equal(store.readItem(REVIEW, item.id).state, record.STATE.NOT_HANDLED);
});

test("a malformed line becomes a dismissible chip naming the file and the line", () => {
  const { rail, done } = setup();
  done.applyReplies([
    protocol.newEvent({
      event: protocol.EVENT.REPLY_REJECTED,
      event_id: "evt_rejected_1",
      review: REVIEW,
      payload: { file: "replies-claude.jsonl", line: 7, reason: "not JSON: Unexpected token n" }
    })
  ]);

  const chips = rail.failures.list();
  assert.equal(chips.length, 1);
  assert.equal(chips[0].code, "REPLY_LINE_MALFORMED");
  assert.match(chips[0].detail, /replies-claude\.jsonl line 7/);

  rail.failures.dismiss("REPLY_LINE_MALFORMED");
  done.applyReplies([
    protocol.newEvent({
      event: protocol.EVENT.REPLY_REJECTED,
      event_id: "evt_rejected_2",
      review: REVIEW,
      payload: { file: "replies-claude.jsonl", line: 8, reason: "not JSON" }
    })
  ]);
  assert.equal(rail.failures.count(), 0, "dismissed stays dismissed");
});

test("reopening a handled issue archives its answer and queues ordinary ready work", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  done.applyReplies([foldEvent(item)]);
  assert.equal(store.readItem(REVIEW, item.id).state, record.STATE.HANDLED);

  const queuedBefore = store.pendingEvents(REVIEW).length;
  const reopened = done.reopen(item.id);

  assert.equal(reopened.state, record.STATE.READY);
  assert.equal(reopened.reply, null, "the answer the reviewer reopened past comes off the item");
  assert.equal(reopened.thread.length, 1, "the answer remains in completed history");
  assert.equal(reopened.thread[0].reviewer.note, item.note);
  assert.equal(reopened.thread[0].agent.status, "handled");
  assert.equal(store.readItem(REVIEW, item.id).state, record.STATE.READY);
  assert.equal(rail.getCard(item.id).pane, overlay.TAB.ACTIVE, "and it is back in the Active tab");

  const queued = store.pendingEvents(REVIEW);
  assert.equal(queued.length, queuedBefore + 1);
  assert.equal(queued[queued.length - 1].event, protocol.EVENT.ITEM_READY, "the new revision uses ordinary ready work");
  assert.equal(queued[queued.length - 1].item, item.id);
});

test("follow-up archives an answer, bumps once, and empty submission is a no-op", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  done.applyReplies([foldEvent(item, { payload: { accepted: true, state: record.STATE.NOT_HANDLED, reply: { status: "not_handled", agent: "codex", reason: "Need a source", files: [] } } })]);

  const beforeEvents = store.pendingEvents(REVIEW).length;
  const answered = store.readItem(REVIEW, item.id);
  assert.deepEqual(done.followUp(item.id, "   "), answered);
  assert.equal(store.pendingEvents(REVIEW).length, beforeEvents);

  const next = done.followUp(item.id, "Use docs/source.md.");
  assert.equal(next.rev, item.rev + 1);
  assert.equal(next.state, record.STATE.READY);
  assert.equal(next.note, "Use docs/source.md.");
  assert.equal(next.change, null);
  assert.equal(next.reply, null);
  assert.equal(next.thread[0].agent.reason, "Need a source");
  assert.equal(store.pendingEvents(REVIEW).at(-1).event, protocol.EVENT.ITEM_READY);

  const stale = done.applyReplies([foldEvent(item)]);
  assert.equal(stale[0].kind, "refused");
  assert.equal(store.readItem(REVIEW, item.id).state, record.STATE.READY);
});

test("a read-only window cannot continue or reopen an answered item", () => {
  let readOnly = false;
  const { store, rail, done } = setup({ isReadOnly: () => readOnly });
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  done.applyReplies([foldEvent(item)]);
  store.writeFollowupDraft(REVIEW, item.id, "keep this private draft");
  const before = store.readItem(REVIEW, item.id);
  const events = store.pendingEvents(REVIEW).length;

  readOnly = true;
  assert.deepEqual(done.followUp(item.id, "must not send"), before);
  assert.deepEqual(done.reopen(item.id), before);
  assert.deepEqual(store.readItem(REVIEW, item.id), before);
  assert.equal(store.readFollowupDraft(REVIEW, item.id), "keep this private draft");
  assert.equal(store.pendingEvents(REVIEW).length, events);
});

test("an outbox failure leaves the answered record and follow-up draft untouched", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  done.applyReplies([foldEvent(item)]);
  store.writeFollowupDraft(REVIEW, item.id, "durable draft");
  const answered = store.readItem(REVIEW, item.id);
  const queueEvent = store.queueEvent;
  store.queueEvent = () => {
    throw new Error("outbox full");
  };

  assert.throws(() => done.followUp(item.id, "durable draft"), /outbox full/);
  assert.deepEqual(store.readItem(REVIEW, item.id), answered);
  assert.equal(store.readFollowupDraft(REVIEW, item.id), "durable draft");
  store.queueEvent = queueEvent;
});

test("a record-write failure still leaves a recoverable full-record event queued", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  done.applyReplies([foldEvent(item)]);
  store.writeFollowupDraft(REVIEW, item.id, "queued even if the record write fails");
  const write = store.write;
  store.write = () => {
    throw new Error("record full");
  };

  assert.throws(() => done.followUp(item.id, "queued even if the record write fails"), /record full/);
  const queued = store.pendingEvents(REVIEW).at(-1);
  assert.equal(queued.event, protocol.EVENT.ITEM_READY);
  assert.equal(queued.record.rev, item.rev + 1);
  assert.equal(queued.record.note, "queued even if the record write fails");
  assert.equal(store.readFollowupDraft(REVIEW, item.id), "queued even if the record write fails");
  store.write = write;
});

test("a reply for an item this browser does not hold changes nothing", () => {
  const { store, done } = setup();
  const stranger = readyItem({ id: "itm_elsewhere" });
  const applied = done.applyReplies([foldEvent(stranger)]);
  assert.deepEqual(applied, []);
  assert.equal(store.read(REVIEW).length, 0);
});

test("NEW-1: reopening bumps the rev, so a stale same-rev fold cannot re-bury the reopened item", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);

  // The agent handles rev 1.
  done.applyReplies([foldEvent(item)]);
  assert.equal(store.readItem(REVIEW, item.id).state, record.STATE.HANDLED);

  // The reviewer reopens it. Reopen must move the rev on, the way a reword does,
  // so a reply that named the old rev can no longer apply to it.
  const reopened = done.reopen(item.id);
  assert.equal(reopened.state, record.STATE.READY);
  assert.ok(reopened.rev > item.rev, "reopen bumps the rev");

  // A duplicate or delayed fold, still naming the OLD rev, arrives. It must be
  // refused rather than sending the just-reopened item back to Done.
  const applied = done.applyReplies([foldEvent(item)]);
  assert.equal(applied[0].kind, "refused", "the stale fold is refused, not applied");
  assert.equal(
    store.readItem(REVIEW, item.id).state,
    record.STATE.READY,
    "the reopen survives the stale fold"
  );
});
