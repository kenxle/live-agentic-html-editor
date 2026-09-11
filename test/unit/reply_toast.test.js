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
//
// A real overlay with no document, which is the shape 1B built for exactly
// this: every rail call is real and nothing is drawn. Timers do not run in it,
// so the two things a clock would have done (a toast timing out, a neglect
// sweep firing) are called the way the clock calls them.

/** A fresh page: new storage, and none of the page's memory of what it said. */
function freshPage() {
  tabDone.forgetPageLife();
  return storeModule.createStore({ storage: null });
}

function setup(options) {
  const opts = options || {};
  const store = opts.store || freshPage();
  const rail = overlay.createRail({ store: store, reviewId: REVIEW });
  // The reviewer works with the rail closed. That is the whole reason the toast
  // exists, so it is the state these assertions are made in: an open rail on
  // the card's own tab is already showing them the answer.
  rail.collapse(opts.collapsed === false ? false : true);
  if (opts.tab) rail.selectTab(opts.tab);
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

/** A client-side navigation: same page, same rail, a new Done tab. */
function remount(parts) {
  parts.done.unmount();
  const done = tabDone.createDoneTab({
    store: parts.store,
    reviewId: REVIEW,
    overlay: parts.rail,
    document: null
  });
  done.mount();
  return done;
}

/** A reload: the same storage read by a new page, which remembers nothing. */
function reboot(store) {
  tabDone.forgetPageLife();
  const rail = overlay.createRail({ store: store, reviewId: REVIEW });
  rail.collapse(true);
  const done = tabDone.createDoneTab({ store: store, reviewId: REVIEW, overlay: rail, document: null });
  done.mount();
  return { rail, done };
}

// One pinned fold time, because the stamp (which reply this is) is built from
// it: a replayed backlog has to carry the timestamp it carried the first time.
const FOLD_AT = "2026-09-10T10:00:00.000Z";

function foldEvent(item, reply) {
  return protocol.newEvent({
    event: protocol.EVENT.REPLY_FOLDED,
    event_id: "evt_" + item[record.FIELD.ID],
    review: REVIEW,
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    // Pinned, because the fold's own timestamp is half of which reply this is:
    // a replayed backlog carries the timestamp it carried the first time. It is
    // also how old the reply is, which decides message-or-count on a boot.
    ts: reply.at || FOLD_AT,
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

/** Write the items, paint, and hand back the fold events for them. */
function pending(parts, ids) {
  return ids.map((id) => {
    const item = readyItem(id);
    parts.store.write(REVIEW, item);
    return item;
  });
}

function toastTexts(rail) {
  return rail.toastInfo().toasts.map((toast) => toast.text);
}

// --- rule 1: the message, never a count ---------------------------------------

test("one folded question makes one toast with its words, and folding it again makes none", () => {
  const parts = setup();
  const [item] = pending(parts, ["c_ask"]);
  parts.done.refresh();

  parts.done.applyReplies([foldEvent(item, question())]);
  const first = parts.rail.toastInfo();
  assert.equal(first.count, 1);
  assert.equal(first.toasts[0].label, "Question");
  assert.equal(first.toasts[0].text, "which heading did you mean?");
  assert.equal(first.toasts[0].sticky, true, "a question waits until it is pressed");

  // The reply cursor starts at zero on every load, so the same fold arrives
  // again. It is applied again and it is not news again.
  parts.done.applyReplies([foldEvent(parts.store.readItem(REVIEW, "c_ask"), question())]);
  assert.equal(parts.rail.toastInfo().count, 1, "a replayed backlog does not toast twice");
});

test("a batch of answers is a toast each, with the words, and never a count", () => {
  const parts = setup();
  const items = pending(parts, ["c_1", "c_2", "c_3"]);
  parts.done.refresh();

  parts.done.applyReplies([
    foldEvent(items[0], question()),
    foldEvent(items[1], flagged({ text: "shortened the second one" })),
    foldEvent(items[2], flagged({ text: "shortened the third one" }))
  ]);

  const info = parts.rail.toastInfo();
  assert.equal(info.count, 3, "three answers, three messages");
  assert.deepEqual(
    toastTexts(parts.rail).slice().sort(),
    ["shortened the second one", "shortened the third one", "which heading did you mean?"],
    "and every one of them carries what the agent actually said"
  );
  info.toasts.forEach((toast) => {
    assert.ok(!/replies are waiting/.test(toast.text), "no counts: " + toast.text);
  });
});

test("a routine confirmation lands on its card and says nothing on the page", () => {
  const parts = setup();
  const [item] = pending(parts, ["c_quiet"]);
  parts.done.refresh();

  parts.done.applyReplies([foldEvent(item, routine())]);
  assert.equal(parts.rail.toastInfo().count, 0);
  assert.equal(parts.store.readItem(REVIEW, "c_quiet").reply.status, "handled", "it is still on the card, whole");
});

test("a refused window is told nothing, because it can do nothing about it", () => {
  const parts = setup({ isReadOnly: () => true });
  const [item] = pending(parts, ["c_refused"]);
  parts.done.refresh();

  parts.done.applyReplies([foldEvent(item, question())]);
  assert.equal(parts.rail.toastInfo().count, 0);
});

// --- rule 2: the X means read -------------------------------------------------

test("dismissing a toast marks that reply read, and a reload says nothing about it", () => {
  const parts = setup();
  const [item] = pending(parts, ["c_dismissed"]);
  parts.done.refresh();
  parts.done.applyReplies([foldEvent(item, flagged())]);

  const toastId = parts.rail.toastInfo().toasts[0].id;
  parts.rail.dismissToast(toastId, "user");

  assert.deepEqual(parts.done.unseenIds(), [], "the reviewer read it and put it away");
  assert.deepEqual(parts.done.neglectedIds(), [], "so it is not neglect either");
  assert.equal(reboot(parts.store).rail.toastInfo().count, 0, "and the reload has nothing to say");
});

test("timing out is not dismissing: nobody decided anything, so it stays unread", () => {
  const parts = setup();
  const [item] = pending(parts, ["c_ignored"]);
  parts.done.refresh();
  parts.done.applyReplies([foldEvent(item, flagged())]);

  const toastId = parts.rail.toastInfo().toasts[0].id;
  parts.rail.dismissToast(toastId, "timeout");

  assert.deepEqual(parts.done.unseenIds(), ["c_ignored"], "still waiting to be read");
  assert.deepEqual(parts.done.neglectedIds(), ["c_ignored"], "and now on the neglect clock");
});

// --- rule 3: a count is for neglect only --------------------------------------

test("a neglected answer comes back as itself, with its words, and does not time out", () => {
  const parts = setup();
  const [item] = pending(parts, ["c_a"]);
  parts.done.refresh();

  parts.done.applyReplies([foldEvent(item, flagged({ text: "did the first one" }))]);
  parts.rail.dismissToast(parts.rail.toastInfo().toasts[0].id, "timeout");
  parts.done.sweepNeglected();

  const info = parts.rail.toastInfo();
  assert.equal(info.count, 1);
  assert.equal(
    info.toasts[0].text,
    "did the first one",
    "Ken: if it is going to sit there, why would it not just be the message"
  );
  assert.equal(info.toasts[0].sticky, true, "and it stays until he does something about it");
});

test("two neglected answers are two messages, because they both fit", () => {
  const parts = setup();
  const items = pending(parts, ["c_a", "c_b"]);
  parts.done.refresh();

  parts.done.applyReplies([
    foldEvent(items[0], flagged({ text: "did the first one" })),
    foldEvent(items[1], flagged({ text: "did the second one" }))
  ]);
  parts.rail.toastInfo().toasts.forEach((toast) => parts.rail.dismissToast(toast.id, "timeout"));
  parts.done.sweepNeglected();

  assert.deepEqual(
    toastTexts(parts.rail).slice().sort(),
    ["did the first one", "did the second one"],
    "no count, because the words fit"
  );
});

test("more neglect than the stack can hold is the one case that becomes a count", () => {
  const parts = setup();
  const ids = ["c_1", "c_2", "c_3", "c_4"];
  const items = pending(parts, ids);
  parts.done.refresh();

  parts.done.applyReplies(items.map((item, index) => foldEvent(item, flagged({ text: "answer " + index }))));
  parts.rail.toastInfo().toasts.forEach((toast) => parts.rail.dismissToast(toast.id, "timeout"));
  parts.done.sweepNeglected();

  const info = parts.rail.toastInfo();
  assert.equal(info.count, 1, "one count, not four messages the stack cannot show");
  assert.equal(info.toasts[0].text, "4 replies are waiting.");
  assert.equal(info.toasts[0].sticky, true, "a reminder about neglect does not get to be neglected");
});

test("a count never talks about a reply whose own toast is still on screen", () => {
  const parts = setup();
  const items = pending(parts, ["c_1", "c_2", "c_3", "c_4", "c_still_up"]);
  parts.done.refresh();
  parts.done.applyReplies(items.map((item, index) => foldEvent(item, flagged({ text: "answer " + index }))));

  // Four time out. The fifth is still standing, so the reviewer can read it
  // where it is and a count has no business naming it.
  const stillUp = parts.rail.toastInfo().toasts.find((toast) => toast.text === "answer 4");
  parts.rail.toastInfo().toasts.forEach((toast) => {
    if (toast.id !== stillUp.id) parts.rail.dismissToast(toast.id, "timeout");
  });
  parts.done.sweepNeglected();

  const counts = parts.rail.toastInfo().toasts.filter((toast) => /waiting/.test(toast.text));
  assert.equal(counts.length, 1);
  assert.equal(counts[0].text, "4 replies are waiting.", "only the four that are not on screen are counted");
});

// --- rules 4 and 5: a reload, and a remount -----------------------------------

test("a reload toasts a recent unread answer as itself, with its words", () => {
  const store = freshPage();
  const item = readyItem("c_recent");
  item[record.FIELD.STATE] = record.STATE.HANDLED;
  item[record.FIELD.REPLY] = Object.assign({ at: new Date().toISOString() }, flagged({ text: "just did this" }));
  store.write(REVIEW, item);

  const back = reboot(store);
  const info = back.rail.toastInfo();
  assert.equal(info.count, 1);
  assert.equal(info.toasts[0].text, "just did this", "recent means he has not had the words yet");
});

test("a reload shows an answer older than the neglect window as itself, sticky", () => {
  const store = freshPage();
  const item = readyItem("c_old");
  item[record.FIELD.STATE] = record.STATE.HANDLED;
  item[record.FIELD.REPLY] = Object.assign({ at: "2026-08-19T10:00:00.000Z" }, flagged({ text: "did this yesterday" }));
  store.write(REVIEW, item);

  const back = reboot(store);
  const info = back.rail.toastInfo();
  assert.equal(info.count, 1);
  assert.equal(info.toasts[0].text, "did this yesterday", "one message fits, so he gets the message");
  assert.equal(info.toasts[0].sticky, true, "it has already been waiting; it does not get to slip past again");
});

test("a reload with more stale answers than the stack can hold gives one count", () => {
  const store = freshPage();
  ["c_o1", "c_o2", "c_o3", "c_o4"].forEach((id, index) => {
    const item = readyItem(id);
    item[record.FIELD.STATE] = record.STATE.HANDLED;
    item[record.FIELD.REPLY] = Object.assign(
      { at: "2026-08-19T10:00:00.000Z" },
      flagged({ text: "old answer " + index })
    );
    store.write(REVIEW, item);
  });

  const info = reboot(store).rail.toastInfo();
  assert.equal(info.count, 1);
  assert.equal(info.toasts[0].text, "4 replies are waiting.");
});

test("a remount says nothing this page has already said", () => {
  const parts = setup();
  const [item] = pending(parts, ["c_remount"]);
  parts.done.refresh();
  parts.done.applyReplies([foldEvent(item, flagged({ text: "carried it over" }))]);
  assert.equal(parts.rail.toastInfo().count, 1);

  // A hash navigation. This is what used to stack a fresh count every time,
  // because the summary key was built from the id set and the set had moved.
  parts.done = remount(parts);
  parts.done = remount(parts);
  parts.done = remount(parts);

  const info = parts.rail.toastInfo();
  assert.equal(info.count, 1, "three navigations, still one message");
  assert.equal(info.toasts[0].text, "carried it over");
});

// --- read is read, and it has to reach storage --------------------------------
//
// Ken, on an SPA that reloads every few minutes: "this page keeps toasting me
// telling me there are responses waiting and it appears I've already read them
// all." Suppressing the toast is only half of "seen"; the mark has to be
// durable, or the next load finds the same replies unread.

test("a reply read as it lands is marked seen, so the next load says nothing", () => {
  const parts = setup({ collapsed: false, tab: "done" });
  const [item] = pending(parts, ["c_watched"]);
  parts.done.refresh();
  parts.done.applyReplies([foldEvent(item, flagged())]);

  assert.equal(parts.rail.toastInfo().count, 0, "it landed in front of them, so it did not toast");
  assert.deepEqual(parts.done.unseenIds(), [], "and it is not sitting unread either");
  assert.equal(reboot(parts.store).rail.toastInfo().count, 0, "so the next load has nothing to announce");
});

test("opening the rail on the tab it was already on marks that tab's replies read", () => {
  const parts = setup({ tab: "done" });
  const [item] = pending(parts, ["c_expanded"]);
  parts.done.refresh();
  parts.done.applyReplies([foldEvent(item, flagged())]);
  assert.equal(parts.rail.toastInfo().count, 1, "the rail was closed, so it toasted");
  assert.deepEqual(parts.done.unseenIds(), ["c_expanded"]);

  // The reviewer expands the rail with the pill. No tab is SELECTED, because it
  // is the tab the rail was already on. That used to write no mark at all.
  parts.rail.collapse(false);
  assert.deepEqual(parts.done.unseenIds(), [], "opening it onto the card is reading the card");
  assert.equal(reboot(parts.store).rail.toastInfo().count, 0, "so the reload says nothing");
});

test("a refused window has the rail opened for it, and that is not the reviewer reading", () => {
  const parts = setup({ tab: "done", isReadOnly: () => true });
  const [item] = pending(parts, ["c_refused_open"]);
  parts.done.refresh();
  parts.done.applyReplies([foldEvent(item, flagged())]);
  assert.deepEqual(parts.done.unseenIds(), ["c_refused_open"]);

  // showRefusal forces the rail open so its remedy is visible. That is the tool
  // talking, not the reviewer reading.
  parts.rail.collapse(false);
  assert.deepEqual(parts.done.unseenIds(), ["c_refused_open"], "still unread, because nobody read it");
});

test("an agent answering the same revision twice: the older line replayed later is not news", () => {
  // rde58be04d90e, 2026-09-10: two flagged lines for one item fifteen seconds
  // apart. Every load replays both in order, and the older one differed from
  // the stamp the browser held, so it toasted an answer Ken had read half an
  // hour before, on every reload.
  const parts = setup();
  const item = readyItem("itm_twice");
  parts.store.write(REVIEW, item);
  const early = flagged({ at: "2026-08-19T10:00:00.000Z", text: "first answer" });
  const late = flagged({ at: "2026-08-19T10:00:15.000Z", text: "second answer" });
  parts.done.applyReplies([foldEvent(item, early), foldEvent(item, late)]);
  const held = parts.store.readItem(REVIEW, "itm_twice")[record.FIELD.REPLY];
  assert.equal(held.at, late.at, "the later line is the one the record keeps");
  // The reviewer reads it, then the page reloads and the helper replays both.
  parts.done.markRepliesSeen();
  const before = parts.rail.toastInfo().count;
  const results = parts.done.applyReplies([foldEvent(item, early), foldEvent(item, late)]);
  assert.equal(results[0].kind, "superseded", "the older line is recognized as superseded");
  assert.equal(results[0].toast, false);
  assert.equal(parts.store.readItem(REVIEW, "itm_twice")[record.FIELD.REPLY].at, late.at, "and it does not roll the record back");
  assert.equal(parts.rail.toastInfo().count, before, "nothing toasts for an answer already read");
  assert.deepEqual(parts.done.unseenIds(), [], "and nothing is left unread");
});
