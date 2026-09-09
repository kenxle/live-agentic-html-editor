// Whether an answer is worth interrupting the reviewer for, and what it says.
//
// Owner: 3A. The toast itself is drawn by the rail and asserted in the browser
// (test/browser/reply_toast.spec.js); what is asserted here is the decision
// layer, which is pure: given a reply, whether the reviewer is looking at the
// tab it lands in, whether the window can act at all, and whether this browser
// had already folded that same reply, does it toast, and what does the sentence
// read like.
//
// The rail at the bottom is a real overlay with no document, which is the shape
// 1B built for exactly this: every call is real and nothing is drawn.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const storeModule = require("../../src/layer/store.js");
const overlay = require("../../src/layer/overlay.js");
const tabDone = require("../../src/layer/tab_done.js");
const record = require("../../src/shared/record.js");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "toast-review";

function question(overrides) {
  return Object.assign({ status: "question", agent: "claude", text: "which heading did you mean?" }, overrides || {});
}

function flagged(overrides) {
  return Object.assign(
    { status: "handled", agent: "claude", text: "shortened it, and moved the number up", user_needs_to_see_reply: true },
    overrides || {}
  );
}

function routine() {
  return { status: "handled", agent: "claude" };
}

// --- the decision -------------------------------------------------------------

test("a flagged reply with words toasts, and a routine confirmation never does", () => {
  assert.equal(tabDone.shouldToastReply({ reply: flagged() }), true);
  assert.equal(tabDone.shouldToastReply({ reply: routine() }), false);
  assert.equal(
    tabDone.shouldToastReply({ reply: flagged({ text: null }) }),
    false,
    "the flag needs words behind it here for the same reason the badge does"
  );
});

test("a question and a refusal toast with or without the flag", () => {
  assert.equal(tabDone.shouldToastReply({ reply: question() }), true);
  assert.equal(tabDone.shouldToastReply({ reply: { status: "not_handled", agent: "claude" } }), true);
});

test("nothing toasts at the reviewer while they are looking at the card's own tab", () => {
  assert.equal(tabDone.shouldToastReply({ reply: question(), watching: true }), false);
  assert.equal(tabDone.shouldToastReply({ reply: flagged(), watching: true }), false);
});

test("a refused window interrupts with nothing, because it can answer nothing", () => {
  assert.equal(tabDone.shouldToastReply({ reply: question(), readOnly: true }), false);
  assert.equal(tabDone.shouldToastReply({ reply: flagged(), readOnly: true }), false);
});

test("a reply this browser already held is not news, however loud it was the first time", () => {
  assert.equal(tabDone.shouldToastReply({ reply: question(), known: true }), false);
});

// --- what it says -------------------------------------------------------------

test("the label names the status in plain words", () => {
  assert.equal(tabDone.toastLabelFor(question()), "Question");
  assert.equal(tabDone.toastLabelFor({ status: "not_handled" }), "Not handled");
  assert.equal(tabDone.toastLabelFor(flagged()), (flagged().agent || "agent") + " says");
  assert.equal(tabDone.toastLabelFor({ status: "handled", agent: "codex" }), "codex says");
  assert.equal(tabDone.toastLabelFor(null), "agent says");
});

test("the summary sentence counts replies and questions in words a person reads at a glance", () => {
  assert.equal(tabDone.waitingSentence({ total: 0, questions: 0 }), "");
  assert.equal(tabDone.waitingSentence({ total: 1, questions: 0 }), "1 reply is waiting.");
  assert.equal(tabDone.waitingSentence({ total: 1, questions: 1 }), "1 reply is waiting, and it is a question.");
  assert.equal(tabDone.waitingSentence({ total: 2, questions: 0 }), "2 replies are waiting.");
  assert.equal(tabDone.waitingSentence({ total: 2, questions: 1 }), "2 replies are waiting, 1 of them is a question.");
  assert.equal(tabDone.waitingSentence({ total: 2, questions: 2 }), "2 replies are waiting, and they are all questions.");
  assert.equal(tabDone.waitingSentence({ total: 4, questions: 2 }), "4 replies are waiting, 2 of them are questions.");
});

test("text is cut to length on a word, and says it was cut", () => {
  const long = "one two three four five six seven eight nine ten eleven twelve";
  const cut = tabDone.clip(long, 20);
  assert.ok(cut.length <= 23, "the clip holds to its bound: " + cut);
  assert.ok(cut.endsWith("..."), "a cut sentence says so: " + cut);
  assert.equal(tabDone.clip("  spaced   out  ", 40), "spaced out", "whitespace is one space, so one line stays one line");
  assert.equal(tabDone.clip(null, 10), "");
});

// --- the counts the summary is built from -------------------------------------

function itemWith(id, reply) {
  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: reply && reply.status === "handled" ? record.STATE.HANDLED : record.STATE.READY,
    note: "note for " + id,
    page_origin: "http://127.0.0.1:4321",
    page_path: "/"
  });
  item[record.FIELD.ID] = id;
  item[record.FIELD.REPLY] = Object.assign({ at: "2026-08-19T10:00:00.000Z" }, reply);
  return item;
}

test("the waiting counts hold only the replies the reviewer has not read", () => {
  const items = [itemWith("c_1", question()), itemWith("c_2", flagged()), itemWith("c_3", routine())];
  const none = tabDone.replyWaitCounts(items, {});
  assert.deepEqual(none, { total: 2, questions: 1 }, "the routine confirmation is not waiting for anyone");

  const read = {};
  read.c_1 = tabDone.replyStamp(items[0]);
  assert.deepEqual(tabDone.replyWaitCounts(items, read), { total: 1, questions: 0 });
});

// --- the wiring, headless -----------------------------------------------------

function setup(options) {
  const opts = options || {};
  const store = storeModule.createStore({ storage: null });
  const rail = overlay.createRail({ store: store, reviewId: REVIEW });
  // The reviewer works with the rail closed. That is the whole reason the toast
  // exists, so it is the state these assertions are made in: an open rail on
  // the card's own tab is already showing them the answer.
  rail.collapse(true);
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

function foldEvent(item, reply) {
  return protocol.newEvent({
    event: protocol.EVENT.REPLY_FOLDED,
    event_id: "evt_" + item[record.FIELD.ID],
    review: REVIEW,
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    // Pinned, because the fold's own timestamp is half of which reply this is:
    // a replayed backlog carries the timestamp it carried the first time.
    ts: "2026-08-19T10:00:00.000Z",
    payload: {
      accepted: true,
      state: reply.status === "handled" ? record.STATE.HANDLED : record.STATE.NOT_HANDLED,
      file: "replies-claude.jsonl",
      reply: reply
    }
  });
}

function readyItem(id) {
  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "shorten this heading",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/"
  });
  item[record.FIELD.ID] = id;
  return item;
}

test("one folded question makes one toast, and folding it again makes none", () => {
  const { store, rail, done } = setup();
  const item = readyItem("c_ask");
  store.write(REVIEW, item);
  done.refresh();

  done.applyReplies([foldEvent(item, question())]);
  const first = rail.toastInfo();
  assert.equal(first.count, 1);
  assert.equal(first.toasts[0].label, "Question");
  assert.equal(first.toasts[0].text, "which heading did you mean?");
  assert.equal(first.toasts[0].sticky, true, "a question waits until it is pressed");

  // The reply cursor starts at zero on every load, so the same fold arrives
  // again. It is applied again and it is not news again.
  done.applyReplies([foldEvent(store.readItem(REVIEW, "c_ask"), question())]);
  assert.equal(rail.toastInfo().count, 1, "a replayed backlog does not toast twice");
});

test("a batch of answers is one toast, not four", () => {
  const { store, done, rail } = setup();
  const items = ["c_1", "c_2", "c_3"].map((id) => {
    const item = readyItem(id);
    store.write(REVIEW, item);
    return item;
  });
  done.refresh();

  done.applyReplies([
    foldEvent(items[0], question()),
    foldEvent(items[1], flagged()),
    foldEvent(items[2], flagged())
  ]);

  const info = rail.toastInfo();
  assert.equal(info.count, 1);
  assert.equal(info.toasts[0].text, "3 replies are waiting, 1 of them is a question.");
});

test("a routine confirmation lands on its card and says nothing on the page", () => {
  const { store, done, rail } = setup();
  const item = readyItem("c_quiet");
  store.write(REVIEW, item);
  done.refresh();

  done.applyReplies([foldEvent(item, routine())]);
  assert.equal(rail.toastInfo().count, 0);
  assert.equal(store.readItem(REVIEW, "c_quiet").reply.status, "handled", "it is still on the card, whole");
});

test("a refused window is told nothing, because it can do nothing about it", () => {
  const { store, done, rail } = setup({ isReadOnly: () => true });
  const item = readyItem("c_refused");
  store.write(REVIEW, item);
  done.refresh();

  done.applyReplies([foldEvent(item, question())]);
  assert.equal(rail.toastInfo().count, 0);
});

test("a load that arrives with answers already waiting says so once", () => {
  const store = storeModule.createStore({ storage: null });
  const item = readyItem("c_waiting");
  item[record.FIELD.STATE] = record.STATE.HANDLED;
  item[record.FIELD.REPLY] = Object.assign({ at: "2026-08-19T10:00:00.000Z" }, flagged());
  store.write(REVIEW, item);

  const rail = overlay.createRail({ store: store, reviewId: REVIEW });
  const done = tabDone.createDoneTab({ store: store, reviewId: REVIEW, overlay: rail, document: null });
  done.mount();

  const info = rail.toastInfo();
  assert.equal(info.count, 1);
  assert.equal(info.toasts[0].text, "1 reply is waiting.");
  assert.equal(info.toasts[0].sticky, false, "no question in it, so it does not have to be pressed");

  // Mounting again (a client-side navigation remounts the tab) does not
  // re-announce the same backlog.
  done.unmount();
  done.mount();
  assert.equal(rail.toastInfo().count, 1);
});
