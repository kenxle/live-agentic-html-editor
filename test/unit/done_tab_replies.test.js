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

/** A routine confirmation: handled, and the agent did not flag it. */
function plainReply() {
  return { status: "handled", agent: "claude", at: "2026-08-19T10:00:00.000Z" };
}

/** The same reply, flagged as something the reviewer should read. */
function flaggedReply() {
  return Object.assign(plainReply(), { user_needs_to_see_reply: true });
}

/** A fold whose reply the agent flagged, which is what the badge counts. */
function flaggedFoldEvent(item, extra) {
  return foldEvent(item, {
    payload: Object.assign(
      {
        accepted: true,
        state: record.STATE.HANDLED,
        file: "replies-claude.jsonl",
        reply: { status: "handled", agent: "claude", files: [], user_needs_to_see_reply: true }
      },
      extra || {}
    )
  });
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

// --- unseen replies -----------------------------------------------------------
//
// An agent's reply used to move the item to Done and say nothing at all. The
// rule under the badge is here; what the reviewer sees is a browser test.

test("unseenReplyIds counts an item whose flagged reply the reviewer has no mark for", () => {
  const item = readyItem({ id: "itm_a" });
  item.reply = flaggedReply();

  assert.deepEqual(tabDone.unseenReplyIds([item], {}), ["itm_a"]);
  assert.deepEqual(
    tabDone.unseenReplyIds([item], tabDone.seenMarksFor([item])),
    [],
    "and stops counting it once the reviewer has looked"
  );
});

test("unseenReplyIds ignores an item with no reply at all", () => {
  assert.deepEqual(tabDone.unseenReplyIds([readyItem({ id: "itm_b" })], {}), []);
});

test("a handled reply the agent did not flag is not something the reviewer has to read", () => {
  const item = readyItem({ id: "itm_routine" });
  item.reply = plainReply();
  assert.equal(tabDone.needsToSeeReply(item.reply), false);
  assert.deepEqual(
    tabDone.unseenReplyIds([item], {}),
    [],
    "carried this change into the source is not news"
  );
});

test("a question and a refusal count without the flag; the flag only decides a handled reply", () => {
  const asking = readyItem({ id: "itm_q" });
  asking.reply = { status: "question", agent: "claude", text: "which heading?", at: "2026-08-19T10:00:00.000Z" };
  const refused = readyItem({ id: "itm_n" });
  refused.reply = { status: "not_handled", agent: "claude", reason: "no such file", at: "2026-08-19T10:00:00.000Z" };

  assert.equal(tabDone.needsToSeeReply(asking.reply), true, "a question needs an answer");
  assert.equal(tabDone.needsToSeeReply(refused.reply), true, "a refusal needs its reason read");
  assert.deepEqual(tabDone.unseenReplyIds([asking, refused], {}), ["itm_q", "itm_n"]);

  // And the flag is the only thing that separates two handled replies.
  assert.equal(tabDone.needsToSeeReply(plainReply()), false);
  assert.equal(tabDone.needsToSeeReply(flaggedReply()), true);
});

test("only the literal boolean true is a flag", () => {
  ["true", 1, {}, null, undefined].forEach((value) => {
    assert.equal(
      tabDone.needsToSeeReply(Object.assign(plainReply(), { user_needs_to_see_reply: value })),
      false,
      "a " + JSON.stringify(value) + " flag is not a flag"
    );
  });
});

test("a SECOND reply on the same item reads as unseen again", () => {
  const item = readyItem({ id: "itm_c" });
  item.reply = flaggedReply();
  const marks = tabDone.seenMarksFor([item]);
  assert.deepEqual(tabDone.unseenReplyIds([item], marks), []);

  // The reviewer reopened and the agent answered again: a later reply, on a
  // later revision. A boolean mark would have swallowed this one.
  const answered = Object.assign({}, item, {
    rev: item.rev + 1,
    reply: Object.assign(flaggedReply(), { at: "2026-08-19T11:30:00.000Z" })
  });
  assert.deepEqual(tabDone.unseenReplyIds([answered], marks), ["itm_c"]);
});

test("seenMarksFor drops an item that no longer carries a reply, so the bucket cannot grow forever", () => {
  const answered = readyItem({ id: "itm_d" });
  answered.reply = plainReply();
  const marks = tabDone.seenMarksFor([answered, readyItem({ id: "itm_e" })]);
  assert.deepEqual(Object.keys(marks), ["itm_d"]);
});

test("a flagged fold while the reviewer is on another tab leaves an unseen reply, and the Done tab carries the count", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  assert.equal(rail.currentTab(), overlay.TAB.ACTIVE, "the reviewer is writing, not reading");

  done.applyReplies([flaggedFoldEvent(item)]);
  assert.deepEqual(done.unseenIds(), [item.id]);
  assert.equal(rail.tabNewCount(overlay.TAB.DONE), 1);

  // Opening the tab IS the reading, and the mark is durable.
  rail.selectTab(overlay.TAB.DONE);
  assert.deepEqual(done.unseenIds(), []);
  assert.equal(rail.tabNewCount(overlay.TAB.DONE), 0);
  assert.equal(store.readSeenReplies(REVIEW)[item.id], tabDone.replyStamp(store.readItem(REVIEW, item.id)));
});

test("a fold that lands while the reviewer is already on Done is read on arrival", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  rail.selectTab(overlay.TAB.DONE);

  done.applyReplies([flaggedFoldEvent(item)]);
  assert.deepEqual(done.unseenIds(), [], "it arrived in front of them, so there is nothing to flag");
  assert.equal(rail.tabNewCount(overlay.TAB.DONE), 0);
});

test("an unflagged handled reply never badges, and is marked seen the moment it folds", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  assert.equal(rail.currentTab(), overlay.TAB.ACTIVE, "the reviewer is not looking at Done");

  done.applyReplies([foldEvent(item)]);

  const stored = store.readItem(REVIEW, item.id);
  assert.equal(stored.state, record.STATE.HANDLED, "it still retires the item");
  assert.equal(stored.reply.user_needs_to_see_reply, false);
  assert.deepEqual(done.unseenIds(), [], "and it does not interrupt");
  assert.equal(rail.tabNewCount(overlay.TAB.DONE), 0);
  assert.equal(
    store.readSeenReplies(REVIEW)[item.id],
    tabDone.replyStamp(stored),
    "it is recorded as read on arrival, so it can never surface as unread later"
  );
});

test("a question badges the Done tab with no flag on the line", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);

  done.applyReplies([
    foldEvent(item, {
      payload: {
        accepted: true,
        state: record.STATE.READY,
        file: "replies-claude.jsonl",
        reply: { status: "question", agent: "claude", text: "which heading do you mean?" }
      }
    })
  ]);

  assert.deepEqual(done.unseenIds(), [item.id]);
  assert.equal(rail.tabNewCount(overlay.TAB.DONE), 1);
});

test("a refusal badges the Done tab with no flag on the line", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);

  done.applyReplies([
    foldEvent(item, {
      payload: {
        accepted: true,
        state: record.STATE.NOT_HANDLED,
        file: "replies-claude.jsonl",
        reply: { status: "not_handled", agent: "claude", reason: "no such file" }
      }
    })
  ]);

  assert.deepEqual(done.unseenIds(), [item.id]);
  assert.equal(rail.tabNewCount(overlay.TAB.DONE), 1);
});

test("an unseen reply survives a reload: a fresh Done tab over the same storage still counts it", () => {
  const store = storeModule.createStore({ storage: null });
  const first = overlay.createRail({ store: store, reviewId: REVIEW });
  const firstDone = tabDone.createDoneTab({ store: store, reviewId: REVIEW, overlay: first, document: null });
  firstDone.mount();
  const item = store.write(REVIEW, readyItem());
  first.upsertCard(item);
  firstDone.applyReplies([flaggedFoldEvent(item)]);
  assert.deepEqual(firstDone.unseenIds(), [item.id]);

  // The reviewer reloads without ever opening Done. Same storage, new rail.
  const second = overlay.createRail({ store: store, reviewId: REVIEW });
  const secondDone = tabDone.createDoneTab({ store: store, reviewId: REVIEW, overlay: second, document: null });
  second.upsertCard(store.readItem(REVIEW, item.id));
  secondDone.mount();
  assert.deepEqual(secondDone.unseenIds(), [item.id], "unread stays unread across a reload");
  assert.equal(second.tabNewCount(overlay.TAB.DONE), 1);
});

// ---------------------------------------------------------------------------
// The collapsed pill's jewel
// ---------------------------------------------------------------------------
//
// The badge lives on the Done tab, and the tab strip is not on screen while the
// rail is collapsed to its pill: that is where the reviewer actually works. The
// jewel puts the SAME number on the pill. These assert it is the same number,
// not a second tally; whether it is painted is a browser test (rail_pill_jewel).

test("the pill jewel carries the Done tab badge's own number", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  assert.equal(rail.pillNewCount(), 0, "nothing has been answered yet");

  done.applyReplies([flaggedFoldEvent(item)]);
  assert.equal(rail.tabNewCount(overlay.TAB.DONE), 1);
  assert.equal(rail.pillNewCount(), 1, "one number, two places it shows");

  // Reading the replies clears both, because the jewel is a view of the badge.
  rail.selectTab(overlay.TAB.DONE);
  assert.equal(rail.tabNewCount(overlay.TAB.DONE), 0);
  assert.equal(rail.pillNewCount(), 0);
});

test("an unflagged handled reply leaves the pill jewel at zero, so nothing is drawn", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);

  done.applyReplies([foldEvent(item)]);

  assert.equal(rail.tabNewCount(overlay.TAB.DONE), 0);
  assert.equal(rail.pillNewCount(), 0, "zero is no jewel, not a jewel reading 0");
});

test("the jewel's count is the same collapsed or expanded: it is state, not a paint", () => {
  const { store, rail, done } = setup();
  const item = store.write(REVIEW, readyItem());
  rail.upsertCard(item);
  done.applyReplies([flaggedFoldEvent(item)]);

  rail.collapse(true);
  assert.equal(rail.isCollapsed(), true);
  assert.equal(rail.pillNewCount(), 1);

  rail.collapse(false);
  assert.equal(rail.isCollapsed(), false);
  assert.equal(rail.pillNewCount(), 1, "still waiting to be read; only opening Done answers it");

  rail.selectTab(overlay.TAB.DONE);
  assert.equal(rail.pillNewCount(), 0);
});
