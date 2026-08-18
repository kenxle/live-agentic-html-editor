// The record shape, the lifecycle transition table with its actor column, the
// applied-`after` history, and the merge rule.
//
// Ranked test 11 is in this file: the merge rule as a pure unit test, browser
// wins on content, store wins on lifecycle per revision, and a stale revision
// cannot retire a current one.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const lifecycle = require("../../src/shared/lifecycle.js");
const merge = require("../../src/shared/merge.js");

const PAGE = { page_origin: "http://localhost:3000", page_path: "/clients", page_title: "Clients", page_seq: 1 };

function anItem(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.EDIT,
        state: record.STATE.READY,
        before: "old wording",
        after: "new wording",
        change: "tightened the sentence"
      },
      PAGE,
      overrides || {}
    )
  );
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

test("every field architecture D4 names is present on a new item", () => {
  const item = anItem();
  const expected = [
    "id",
    "rev",
    "kind",
    "state",
    "note",
    "change",
    "before",
    "after",
    "before_html",
    "after_html",
    "after_history",
    "region",
    "context",
    "page_origin",
    "page_path",
    "page_title",
    "page_seq",
    "source_hint",
    "reply",
    "thread",
    "created_at",
    "updated_at"
  ];
  for (const field of expected) {
    assert.equal(Object.prototype.hasOwnProperty.call(item, field), true, `missing field ${field}`);
  }
});

test("legacy records read as an empty thread", () => {
  const legacy = anItem();
  delete legacy.thread;
  assert.deepEqual(record.threadOf(legacy), []);
  assert.doesNotThrow(() => record.validateItem(legacy));
});

test("follow-up archives the exact completed exchange and advances once", () => {
  const answered = anItem({
    kind: record.KIND.COMMENT,
    note: "Shorten this paragraph.",
    change: null,
    reply: {
      status: record.REPLY_STATUS.QUESTION,
      agent: "codex",
      reason: null,
      text: "Which ending should remain?",
      files: [],
      at: "2026-08-18T12:01:00.000Z"
    }
  });
  const next = record.followUp(answered, "Keep the second ending.");

  assert.equal(next.rev, answered.rev + 1);
  assert.equal(next.state, record.STATE.READY);
  assert.equal(next.note, "Keep the second ending.");
  assert.equal(next.change, null);
  assert.equal(next.reply, null);
  assert.equal(next.thread.length, 1);
  assert.equal(next.thread[0].rev, answered.rev);
  assert.equal(next.thread[0].reviewer.note, "Shorten this paragraph.");
  assert.equal(next.thread[0].agent.text, "Which ending should remain?");
  assert.equal(answered.thread.length, 0, "history is append-only without mutating the prior record");
});

test("empty follow-up is a no-op and reopen issue resubmits unchanged", () => {
  const answered = anItem({
    note: "Keep this exact request.",
    reply: { status: record.REPLY_STATUS.HANDLED, agent: "codex", text: "Done.", files: [] }
  });
  assert.equal(record.followUp(answered, "   "), answered);

  const reopened = record.reopenIssue(answered);
  assert.equal(reopened.rev, answered.rev + 1);
  assert.equal(reopened.note, answered.note);
  assert.equal(reopened.change, answered.change);
  assert.equal(reopened.reply, null);
  assert.equal(reopened.thread[0].agent.text, "Done.");
});

test("a second follow-up appends a second completed round in chronological order", () => {
  const first = anItem({
    kind: record.KIND.COMMENT,
    note: "First request",
    change: null,
    reply: { status: "question", agent: "codex", text: "First answer", files: [] }
  });
  const secondTurn = record.followUp(first, "Second request");
  secondTurn.reply = { status: "handled", agent: "codex", text: "Second answer", files: [] };
  secondTurn.state = record.STATE.HANDLED;
  const thirdTurn = record.followUp(secondTurn, "Third request");

  assert.deepEqual(thirdTurn.thread.map((round) => round.reviewer.note), ["First request", "Second request"]);
  assert.deepEqual(thirdTurn.thread.map((round) => round.agent.text), ["First answer", "Second answer"]);
  assert.equal(thirdTurn.note, "Third request");
});

test("historical exchanges are presented by timestamp with stable legacy ties", () => {
  const item = anItem({
    thread: [
      { rev: 3, reviewer: { note: "third", at: null }, agent: { status: "handled", at: null } },
      { rev: 2, reviewer: { note: "second", at: "2026-08-18T12:02:00.000Z" }, agent: { status: "handled", at: "2026-08-18T12:03:00.000Z" } },
      { rev: 1, reviewer: { note: "first", at: "2026-08-18T12:00:00.000Z" }, agent: { status: "handled", at: "2026-08-18T12:01:00.000Z" } },
      { rev: 4, reviewer: { note: "fourth legacy", at: null }, agent: { status: "handled", at: null } }
    ]
  });

  assert.deepEqual(record.chronologicalThread(item).map((round) => round.reviewer.note), [
    "first",
    "second",
    "third",
    "fourth legacy"
  ]);
  assert.deepEqual(item.thread.map((round) => round.reviewer.note), [
    "third",
    "second",
    "first",
    "fourth legacy"
  ], "presentation sorting does not mutate durable history");
});

test("the dead send model's fields are gone", () => {
  const item = anItem();
  for (const field of ["moved", "resized", "delivered", "ack", "verification", "feedback"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(item, field), false, `${field} should be gone`);
  }
  assert.equal(record.KINDS.includes("moved"), false);
  assert.equal(record.KINDS.includes("resized"), false);
});

test("the kinds are exactly D4's closed list", () => {
  assert.deepEqual(record.KINDS.slice().sort(), ["comment", "delete", "edit", "format_only", "note"]);
});

test("the region reference carries its lost-anchor state as a named field (R20)", () => {
  const item = anItem();
  assert.deepEqual(Object.keys(item.region).sort(), ["accepted_page_texts", "label", "lost", "ref"]);
});

// The accepted page states: what "Keep mine" remembers so the reviewer's
// decision outlives the next repaint. See record.js.
test("an accepted page state is remembered, add-only, deduped and bounded", () => {
  const item = anItem();
  assert.deepEqual(record.acceptedPageTexts(item), [], "a new record has accepted nothing");

  record.acceptPageText(item, "the page said this");
  record.acceptPageText(item, "the page said this");
  assert.deepEqual(item.region.accepted_page_texts, ["the page said this"], "the same state is not doubled");

  record.acceptPageText(item, "and then it said this");
  assert.deepEqual(item.region.accepted_page_texts, ["the page said this", "and then it said this"]);

  // The bound. A page whose source genuinely churns would otherwise hand the
  // record a new state on every pass, forever.
  for (let i = 0; i < record.ACCEPTED_PAGE_TEXTS_MAX + 5; i += 1) {
    record.acceptPageText(item, "churn " + i);
  }
  assert.equal(item.region.accepted_page_texts.length, record.ACCEPTED_PAGE_TEXTS_MAX);
  assert.equal(
    item.region.accepted_page_texts[record.ACCEPTED_PAGE_TEXTS_MAX - 1],
    "churn " + (record.ACCEPTED_PAGE_TEXTS_MAX + 4),
    "the newest states are the ones kept"
  );

  // The diff base is never touched by any of this (R29).
  assert.equal(item.before, anItem().before);
});

test("ids are unique and minted in the browser", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) seen.add(record.randomId("itm"));
  assert.equal(seen.size, 500);
});

test("newItem refuses an unknown kind and a missing page", () => {
  assert.throws(() => record.newItem(Object.assign({ kind: "nonsense" }, PAGE)), /kind must be one of/);
  assert.throws(() => record.newItem({ kind: record.KIND.NOTE, page_path: "/x" }), /page_origin/);
  assert.throws(() => record.newItem({ kind: record.KIND.NOTE, page_origin: "http://x" }), /page_path/);
});

test("a record starts as a draft unless it is told otherwise (R7)", () => {
  const drafted = record.newItem(Object.assign({ kind: record.KIND.COMMENT }, PAGE));
  assert.equal(drafted.state, record.STATE.DRAFT);
  assert.equal(record.isDraft(drafted), true);
  // A draft comment with nothing typed yet is still valid and still durable.
  record.validateItem(drafted);
});

test("a ready comment must carry the reviewer's words, a draft need not", () => {
  const empty = record.newItem(Object.assign({ kind: record.KIND.COMMENT }, PAGE));
  record.validateItem(empty);
  empty.state = record.STATE.READY;
  assert.throws(() => record.validateItem(empty), /must carry the reviewer's note/);
});

test("validateItem reports every problem at once rather than the first", () => {
  const broken = anItem();
  broken.rev = 0;
  broken.state = "nonsense";
  assert.throws(
    () => record.validateItem(broken),
    (err) => /rev must be/.test(err.message) && /state must be/.test(err.message)
  );
});

// ---------------------------------------------------------------------------
// The page fields (grouping review.json by page)
// ---------------------------------------------------------------------------

test("the group key is origin plus pathname, so two dev servers do not collapse", () => {
  const a = anItem({ page_origin: "http://localhost:3000", page_path: "/dashboard" });
  const b = anItem({ page_origin: "http://localhost:4000", page_path: "/dashboard" });
  assert.notEqual(record.pageKey(a), record.pageKey(b));
  assert.equal(record.pageKey(a), record.pageKey(anItem({ page_path: "/dashboard" })));
});

test("pageFrom collapses the query string and the fragment away", () => {
  const page = record.pageFrom({
    origin: "http://localhost:3000",
    pathname: "/dashboard",
    href: "http://localhost:3000/dashboard?tab=2#top",
    title: "Dashboard"
  });
  assert.equal(page.path, "/dashboard");
  assert.equal(page.origin, "http://localhost:3000");
  assert.equal(page.title, "Dashboard");
});

test("a file review carries the file's name and its folder as its page path", () => {
  const page = record.pageFrom({ origin: "null", pathname: "/Users/x/docs/brief.html", href: "file:///Users/x/docs/brief.html" });
  assert.equal(page.origin, record.FILE_ORIGIN);
  // The folder rides along because two index.html files in two folders are two
  // pages; the rest of the reviewer's disk does not.
  assert.equal(page.path, "docs/brief.html");
});

test("the first-visit order rides on the record, because the projection groups by it", () => {
  const item = anItem({ page_seq: 3, source_hint: "app/views/clients/index.html.erb" });
  assert.equal(item.page_seq, 3);
  assert.equal(item.source_hint, "app/views/clients/index.html.erb");
});

// ---------------------------------------------------------------------------
// The applied-`after` history (replay's branch three)
// ---------------------------------------------------------------------------

test("bumpRev increments rev, which is what stops a stale reply swallowing a rewording", () => {
  const first = anItem();
  const second = record.bumpRev(first, { after: "reworded" });
  assert.equal(second.rev, first.rev + 1);
  assert.equal(second.after, "reworded");
  assert.equal(second.id, first.id);
});

test("a record keeps every after it has had, in order", () => {
  const v1 = anItem({ after: "first wording" });
  const v2 = record.bumpRev(v1, { after: "second wording" });
  const v3 = record.bumpRev(v2, { after: "third wording" });
  assert.deepEqual(
    v3.after_history.map((h) => h.after),
    ["first wording", "second wording", "third wording"]
  );
  assert.deepEqual(
    v3.after_history.map((h) => h.rev),
    [1, 2, 3]
  );
});

test("priorAfters is what branch three compares against: not the current after, not the before", () => {
  // Two rewordings, so the earlier `after` is neither the current `after` nor
  // the `before`. A single-rewording fixture hides this bug entirely.
  const v1 = anItem({ before: "the original", after: "first wording" });
  const v3 = record.bumpRev(record.bumpRev(v1, { after: "second wording" }), { after: "third wording" });
  const priors = record.priorAfters(v3);
  assert.deepEqual(priors, ["first wording", "second wording"]);
  assert.equal(priors.includes(v3.after), false);
  assert.equal(priors.includes(v3.before), false);
});

test("a rewording that lands on the same text does not grow the history", () => {
  const v1 = anItem({ after: "same" });
  const v2 = record.bumpRev(v1, { after: "same" });
  assert.equal(v2.after_history.length, 1);
});

// ---------------------------------------------------------------------------
// D12: the field classification, flipped
// ---------------------------------------------------------------------------

test("the intent channel is exactly note and change; page text is data (D12)", () => {
  assert.deepEqual(record.INTENT_FIELDS, ["note", "change"]);
  assert.equal(record.fieldClass("note"), record.CLASS_INSTRUCTION);
  assert.equal(record.fieldClass("change"), record.CLASS_INSTRUCTION);
  // The flip. A region's full after is mostly the page's own words, so a
  // document someone else sent could otherwise ride a hidden instruction into
  // the intent channel on the back of the reviewer's edit.
  assert.equal(record.fieldClass("after"), record.CLASS_DATA);
  assert.equal(record.fieldClass("after_html"), record.CLASS_DATA);
  assert.equal(record.fieldClass("before"), record.CLASS_DATA);
  assert.equal(record.fieldClass("context.quote"), record.CLASS_DATA);
  // An agent's own words are not the reviewer's intent either.
  assert.equal(record.fieldClass("reply.text"), record.CLASS_DATA);
  // An unknown field defaults to data, which is the safe direction.
  assert.equal(record.fieldClass("something_new"), record.CLASS_DATA);
});

// ---------------------------------------------------------------------------
// Comparison mode
// ---------------------------------------------------------------------------

test("a format-only record compares on structure and everything else on text", () => {
  assert.equal(record.comparisonMode(anItem({ kind: record.KIND.FORMAT_ONLY })), "structure");
  assert.equal(record.comparisonMode(anItem({ kind: record.KIND.EDIT })), "text");
});

// ---------------------------------------------------------------------------
// The lifecycle: four states, and the actor column
// ---------------------------------------------------------------------------

test("there are exactly four states, and question and reopened are not among them", () => {
  assert.deepEqual(record.STATES.slice().sort(), ["draft", "handled", "not_handled", "ready"]);
  assert.equal(record.STATES.includes("question"), false, "question is a reply status");
  assert.equal(record.STATES.includes("reopened"), false, "reopened is a transition");
  assert.deepEqual(record.REPLY_STATUSES.slice().sort(), ["handled", "not_handled", "question"]);
});

test("the agent may only move a READY item, and never a draft", () => {
  const A = lifecycle.ACTOR.AGENT;
  const S = record.STATE;
  assert.equal(lifecycle.canTransition(S.READY, S.HANDLED, A), true);
  assert.equal(lifecycle.canTransition(S.READY, S.NOT_HANDLED, A), true);
  // The forged burn-down with a friendly face.
  assert.equal(lifecycle.canTransition(S.DRAFT, S.HANDLED, A), false);
  assert.equal(lifecycle.canTransition(S.DRAFT, S.READY, A), false);
  assert.equal(lifecycle.canTransition(S.NOT_HANDLED, S.HANDLED, A), false);
  assert.equal(lifecycle.canTransition(S.HANDLED, S.READY, A), false, "only the reviewer reopens");
});

test("the helper makes no lifecycle transition on its own initiative", () => {
  for (const t of lifecycle.TRANSITIONS) {
    assert.notEqual(t.actor, lifecycle.ACTOR.HELPER);
  }
});

test("reopening is a transition from handled back to ready, and it is the reviewer's (R38)", () => {
  const R = lifecycle.ACTOR.REVIEWER;
  const S = record.STATE;
  assert.equal(lifecycle.canTransition(S.HANDLED, S.READY, R), true);
  assert.equal(lifecycle.canTransition(S.NOT_HANDLED, S.READY, R), true);
});

test("a handled item cannot be deleted, because it is the record that a fix landed", () => {
  const R = lifecycle.ACTOR.REVIEWER;
  assert.equal(lifecycle.canDelete(record.STATE.DRAFT, R), true);
  assert.equal(lifecycle.canDelete(record.STATE.READY, R), true);
  assert.equal(lifecycle.canDelete(record.STATE.HANDLED, R), false);
  assert.equal(lifecycle.canDelete(record.STATE.READY, lifecycle.ACTOR.AGENT), false);
});

test("an illegal transition throws rather than being ignored", () => {
  assert.throws(
    () => lifecycle.assertTransition(record.STATE.HANDLED, record.STATE.NOT_HANDLED, lifecycle.ACTOR.AGENT),
    /illegal lifecycle transition/
  );
});

test("only ready items are actionable, so a draft never reaches an agent (R7)", () => {
  assert.deepEqual(lifecycle.ACTIONABLE_STATES, [record.STATE.READY]);
});

// ---------------------------------------------------------------------------
// The revision rule, and question as a reply status
// ---------------------------------------------------------------------------

test("a reply applies only for the revision it names (R9, R21)", () => {
  const item = anItem();
  assert.equal(lifecycle.replyApplies(item, 1), true);
  const reworded = record.bumpRev(item, { after: "reworded after the agent read it" });
  assert.equal(lifecycle.replyApplies(reworded, 1), false, "the older rev must not win");
  assert.equal(lifecycle.replyApplies(reworded, 2), true);
});

test("a reply naming an old revision is refused and the item stays outstanding", () => {
  const reworded = record.bumpRev(anItem(), { after: "reworded" });
  const got = lifecycle.applyReply(reworded, { rev: 1, status: "handled", agent: "claude" });
  assert.equal(got.accepted, false);
  assert.equal(got.state, record.STATE.READY, "the rewording stays outstanding");
  assert.match(got.refusal, /rev 1 but the item is at rev 2/);
});

test("a question leaves the item ready, because the work is still outstanding", () => {
  const item = anItem();
  const got = lifecycle.applyReply(item, { rev: 1, status: "question", text: "which of the two headings?" });
  assert.equal(got.accepted, true);
  assert.equal(got.state, record.STATE.READY);
});

test("a handled reply naming the current rev retires the item; not_handled keeps it visible", () => {
  const item = anItem();
  assert.equal(lifecycle.applyReply(item, { rev: 1, status: "handled" }).state, record.STATE.HANDLED);
  assert.equal(lifecycle.applyReply(item, { rev: 1, status: "not_handled", reason: "no such file" }).state, record.STATE.NOT_HANDLED);
});

test("a reply cannot move a draft, whatever revision it names", () => {
  const draft = record.newItem(Object.assign({ kind: record.KIND.COMMENT, note: "half a thought" }, PAGE));
  const got = lifecycle.applyReply(draft, { rev: 1, status: "handled" });
  assert.equal(got.accepted, false);
  assert.equal(got.state, record.STATE.DRAFT);
  assert.match(got.refusal, /only a ready item is actionable/);
});

// ---------------------------------------------------------------------------
// The merge rule (ranked test 11)
// ---------------------------------------------------------------------------

test("the browser wins on content for anything the helper has not acknowledged", () => {
  const stored = anItem({ id: "itm_1", note: "what the helper has", after: "helper's copy" });
  const inBrowser = Object.assign({}, stored, { note: "what the reviewer just typed", after: "browser's copy" });
  const got = merge.mergeItem(inBrowser, stored);
  assert.equal(got.item.note, "what the reviewer just typed");
  assert.equal(got.item.after, "browser's copy");
  assert.equal(got.reason, merge.REASON.SAME_REV_UNACKED);
});

test("the store wins on lifecycle at the same revision", () => {
  const stored = anItem({ id: "itm_1", state: record.STATE.HANDLED });
  const inBrowser = Object.assign({}, stored, { state: record.STATE.READY, note: "local words" });
  const got = merge.mergeItem(inBrowser, stored);
  assert.equal(got.item.state, record.STATE.HANDLED, "lifecycle is the store's");
  assert.equal(got.item.note, "local words", "content is still the browser's");
});

test("a stale revision cannot retire a current one: the reword-offline case", () => {
  // rev 1 was marked handled while the helper was up. The helper went down,
  // the reviewer reworded to rev 2, and the page reloaded.
  const storedRev1Handled = anItem({ id: "itm_1", state: record.STATE.HANDLED, after: "the agent's version" });
  const browserRev2 = record.bumpRev(
    anItem({ id: "itm_1", state: record.STATE.READY, after: "the agent's version" }),
    { after: "the reviewer's rewording" }
  );

  const got = merge.mergeItem(browserRev2, storedRev1Handled);

  assert.equal(got.item.rev, 2);
  assert.equal(got.item.state, record.STATE.READY, "the rewording is NOT swallowed by a handled naming rev 1");
  assert.equal(got.item.after, "the reviewer's rewording");
  assert.equal(got.reason, merge.REASON.BROWSER_NEWER_REV);
});

test("an acknowledged browser copy does not overwrite the store's content", () => {
  const stored = anItem({ id: "itm_1", state: record.STATE.HANDLED, note: "the words the helper stored" });
  const acked = Object.assign({}, stored, { note: "a stale local copy", acknowledged: true });
  const got = merge.mergeItem(acked, stored);
  assert.equal(got.item.note, "the words the helper stored");
  assert.equal(got.reason, merge.REASON.SAME_REV_ACKED);
});

test("a store revision ahead of the browser wins outright", () => {
  const inBrowser = anItem({ id: "itm_1" });
  const stored = record.bumpRev(inBrowser, { after: "another window moved it on" });
  const got = merge.mergeItem(inBrowser, stored);
  assert.equal(got.item.rev, 2);
  assert.equal(got.reason, merge.REASON.STORE_NEWER_REV);
});

test("an item only one side has survives the merge", () => {
  const only = anItem({ id: "itm_only" });
  assert.equal(merge.mergeItem(only, null).reason, merge.REASON.ONLY_BROWSER);
  assert.equal(merge.mergeItem(null, only).reason, merge.REASON.ONLY_STORE);
  assert.throws(() => merge.mergeItem(null, null), /at least one side/);
});

test("merging two lists keeps the browser's order, so the rail does not reshuffle", () => {
  const a = anItem({ id: "itm_a" });
  const b = anItem({ id: "itm_b" });
  const c = anItem({ id: "itm_c" });
  const got = merge.mergeLists([a, b], [b, c]);
  assert.deepEqual(got.items.map((i) => i.id), ["itm_a", "itm_b", "itm_c"]);
  assert.equal(got.reasons.itm_a, merge.REASON.ONLY_BROWSER);
  assert.equal(got.reasons.itm_c, merge.REASON.ONLY_STORE);
});

test("merging two different items is a loud error, never a silent pick", () => {
  assert.throws(() => merge.mergeItem(anItem({ id: "itm_a" }), anItem({ id: "itm_b" })), /two different items/);
});
