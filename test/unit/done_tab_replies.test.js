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

function setup() {
  const store = storeModule.createStore({ storage: null });
  const rail = overlay.createRail({ store: store, reviewId: REVIEW });
  const done = tabDone.createDoneTab({
    store: store,
    reviewId: REVIEW,
    overlay: rail,
    document: null
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

test("reopening a handled item puts it back in front of the agent and queues the event", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  done.applyReplies([foldEvent(item)]);
  assert.equal(store.readItem(REVIEW, item.id).state, record.STATE.HANDLED);

  const queuedBefore = store.pendingEvents(REVIEW).length;
  const reopened = done.reopen(item.id);

  assert.equal(reopened.state, record.STATE.READY);
  assert.equal(reopened.reply, null, "the answer the reviewer reopened past comes off the item");
  assert.equal(store.readItem(REVIEW, item.id).state, record.STATE.READY);
  assert.equal(rail.getCard(item.id).pane, overlay.TAB.ACTIVE, "and it is back in the Active tab");

  const queued = store.pendingEvents(REVIEW);
  assert.equal(queued.length, queuedBefore + 1);
  assert.equal(queued[queued.length - 1].event, protocol.EVENT.ITEM_REOPENED, "reopening is its own event, not a re-post");
  assert.equal(queued[queued.length - 1].item, item.id);
});

test("a reply for an item this browser does not hold changes nothing", () => {
  const { store, done } = setup();
  const stranger = readyItem({ id: "itm_elsewhere" });
  const applied = done.applyReplies([foldEvent(stranger)]);
  assert.deepEqual(applied, []);
  assert.equal(store.read(REVIEW).length, 0);
});
