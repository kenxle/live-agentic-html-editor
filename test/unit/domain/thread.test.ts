/*
 * read-when: Changing src/domain/thread.ts, follow-up, reopen, or how an answered turn becomes history, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { KIND, STATE, TOOL_ROUND } from "../../../src/contract/record.ts";
import type { Item, ThreadRound } from "../../../src/contract/record.ts";
import { bumpRev } from "../../../src/domain/item-revisions.ts";
import { stampPageCheckReopen } from "../../../src/domain/page-check.ts";
import { applySuggestions } from "../../../src/domain/proofread.ts";
import {
  chronologicalThread,
  completedRound,
  continueOnto,
  continueThread,
  followUp,
  reopenIssue,
  retainReplies,
  threadOf
} from "../../../src/domain/thread.ts";
import { callUntyped } from "../contract/support/untyped.ts";
import { AT, anItem, archived, folded } from "./support/items.ts";

function round(rev: number, note: string, reviewerAt: string | null, agentAt: string | null): ThreadRound {
  return { rev, reviewer: { note, change: null, at: reviewerAt }, agent: archived({ at: agentAt }) };
}

function proofreadQuestion(): Item {
  return anItem({
    kind: KIND.EDIT,
    before: "Anchor",
    after: "Anchor\n\nI lost my place every time",
    before_html: "Anchor",
    after_html: "Anchor<p>I lost my place every time</p>",
    anchor_after_html: "Anchor",
    new_blocks: [{ tag: "p", html: "I lost my place every time" }],
    placement: "after_anchor",
    change: "Added 1 block after this paragraph: p. Its words are in new_blocks.",
    reply: folded({
      status: "question",
      text: "Two fixes",
      proofread: true,
      suggestions: [{ block: 0, from: "place", to: "spot" }]
    })
  });
}

test("a legacy record with no thread reads as an empty thread", () => {
  const legacy: Record<string, unknown> = { ...anItem() };
  delete legacy["thread"];
  assert.deepEqual(threadOf(legacy), []);
  assert.deepEqual(threadOf(null), []);
  assert.deepEqual(threadOf(undefined), []);
  assert.deepEqual(callUntyped(threadOf, { thread: "x" }), []);
  assert.deepEqual(chronologicalThread(legacy), []);
});

test("a record's thread is its own array of rounds", () => {
  const rounds = [round(1, "first", AT, AT)];
  const item = anItem({ thread: rounds });
  assert.deepEqual(threadOf(item), rounds);
});

test("historical exchanges are presented by timestamp, with stable ties for the ones with no time", () => {
  const item = anItem({
    thread: [
      round(3, "third", null, null),
      round(2, "second", "2026-08-18T12:02:00.000Z", "2026-08-18T12:03:00.000Z"),
      round(1, "first", "2026-08-18T12:00:00.000Z", "2026-08-18T12:01:00.000Z"),
      round(4, "fourth legacy", null, null)
    ]
  });
  assert.deepEqual(chronologicalThread(item).map((r) => r.reviewer.note), ["first", "second", "third", "fourth legacy"]);
  assert.deepEqual(item.thread.map((r) => r.reviewer.note), ["third", "second", "first", "fourth legacy"], "the stored array is not reordered");
});

test("a round is timed by its reviewer's time, else its agent's, and equal times keep their stored order", () => {
  const item = anItem({
    thread: [
      round(2, "b equal", "2026-08-18T12:00:00.000Z", null),
      round(1, "a equal", "2026-08-18T12:00:00.000Z", null),
      round(3, "agent timed", null, "2026-08-18T11:00:00.000Z"),
      round(4, "unreadable", "not a time", null)
    ]
  });
  assert.deepEqual(chronologicalThread(item).map((r) => r.reviewer.note), ["agent timed", "b equal", "a equal", "unreadable"]);
});

test("the rounds the reader gets are a new array of the same round objects", () => {
  const item = anItem({ thread: [round(1, "x", AT, AT)] });
  const out = chronologicalThread(item);
  assert.notEqual(out, item.thread);
  assert.equal(out[0], item.thread[0]);
});

test("a round cannot be archived until the agent has replied", () => {
  assert.throws(() => completedRound(anItem()), {
    message: "completedRound: an item needs an agent reply before it can be archived"
  });
});

test("an archived round is the revision, the reviewer's note, change and time, and the agent's reply in its archived shape", () => {
  const item = anItem({
    rev: 2,
    note: "Shorten this.",
    change: null,
    updated_at: "2026-08-18T12:05:00.000Z",
    reply: folded({ status: "question", agent: "codex", reason: null, text: "Which ending?", files: ["a.md"], at: "2026-08-18T12:06:00.000Z", user_needs_to_see_reply: true })
  });
  const got = completedRound(item);
  assert.deepEqual(got, {
    rev: 2,
    reviewer: { note: "Shorten this.", change: null, at: "2026-08-18T12:05:00.000Z" },
    agent: { status: "question", agent: "codex", reason: null, text: "Which ending?", files: ["a.md"], at: "2026-08-18T12:06:00.000Z" }
  });
  assert.equal("tool" in got, false);
  assert.equal("user_needs_to_see_reply" in got.agent, false, "the archived reply never carries the flag");
  assert.notEqual(got.agent.files, item.reply?.files);
});

test("an archived reply turns each falsy value into null and a missing file list into an empty one", () => {
  const sparse = callUntyped(completedRound, { ...anItem({ created_at: AT }), reply: { status: "handled", text: "" } });
  assert.deepEqual(sparse, {
    rev: 1,
    reviewer: { note: null, change: "tightened the sentence", at: AT },
    agent: { status: "handled", agent: null, reason: null, text: null, files: [], at: null }
  });
});

test("an archived proofread turn keeps its fixes, so review.json can carry them", () => {
  const question = proofreadQuestion();
  const got = completedRound(question);
  assert.equal(got.agent.proofread, true);
  assert.deepEqual(got.agent.suggestions, [{ block: 0, from: "place", to: "spot" }]);
  const plain = anItem({ reply: folded({ status: "question", text: "Which one?", at: null }) });
  const second = completedRound(plain);
  assert.equal("proofread" in second.agent, false);
  assert.equal("suggestions" in second.agent, false);
});

test("an archived reply carries its earlier answers, each archived the same way", () => {
  const item = anItem({ reply: { ...folded({ text: "second answer" }), previous: [archived({ text: "first answer", at: "2026-08-18T11:00:00.000Z" })] } });
  const got = completedRound(item);
  assert.deepEqual(got.agent.previous, [archived({ text: "first answer", at: "2026-08-18T11:00:00.000Z" })]);
});

test("a tool round is archived marked, and only a tool round is", () => {
  const item = anItem({ rev: 3, reply: folded() });
  stampPageCheckReopen(item, "T@2", AT, TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(completedRound(item).tool, "page_check_stamp");
  const plain = anItem({ rev: 3, reply: folded() });
  stampPageCheckReopen(plain, "T@2", AT, null);
  assert.equal("tool" in completedRound(plain), false);
});

test("with no reply on the record, retaining returns the incoming reply as a new object", () => {
  const incoming = folded({ text: "first" });
  const got = retainReplies(anItem(), incoming);
  assert.deepEqual(got, incoming);
  assert.notEqual(got, incoming);
});

test("an incoming reply equal to the record's own, once archived, leaves the record's reply as it is", () => {
  const prior = folded({ text: "same", user_needs_to_see_reply: true });
  const item = anItem({ reply: prior });
  const got = retainReplies(item, folded({ text: "same" }));
  assert.equal(got, prior);
});

test("a different incoming reply keeps the record's earlier answer under previous, oldest first", () => {
  const first = folded({ text: "first", at: "2026-08-18T11:00:00.000Z" });
  const item = anItem({ reply: first });
  const second = retainReplies(item, folded({ text: "second", at: "2026-08-18T11:05:00.000Z" }));
  assert.deepEqual(second.previous, [archived({ text: "first", at: "2026-08-18T11:00:00.000Z" })]);
  assert.equal(second.text, "second");
  const third = retainReplies({ reply: second }, folded({ text: "third", at: "2026-08-18T11:10:00.000Z" }));
  assert.deepEqual(third.previous?.map((reply) => reply.text), ["first", "second"]);
  assert.equal("previous" in (second.previous[0] ?? {}), false);
});

test("continuing a thread is one revision on, with the answered turn archived and the new turn's words in place", () => {
  const answered = anItem({ kind: KIND.COMMENT, note: "Shorten this paragraph.", change: null, reply: folded({ status: "question", text: "Which ending should remain?" }) });
  const next = continueThread(answered, { note: "Keep the second ending.", change: "kept" });
  assert.equal(next.rev, answered.rev + 1);
  assert.equal(next.state, STATE.READY);
  assert.equal(next.note, "Keep the second ending.");
  assert.equal(next.change, "kept");
  assert.equal(next.reply, null);
  assert.equal(next.thread.length, 1);
  assert.equal(next.thread[0]?.rev, answered.rev);
  assert.equal(next.thread[0].reviewer.note, "Shorten this paragraph.");
  assert.equal(next.thread[0].agent.text, "Which ending should remain?");
  assert.equal(answered.thread.length, 0, "history is append-only without changing the prior record");
  assert.equal(answered.reply?.text, "Which ending should remain?");
  const bare = continueThread(answered);
  assert.deepEqual([bare.note, bare.change], [null, null]);
});

test("the thread a continuation carries is in time order, with the answered turn last", () => {
  const item = anItem({ rev: 5, reply: folded(), thread: [round(2, "later", "2026-08-18T12:02:00.000Z", null), round(1, "earlier", "2026-08-18T12:00:00.000Z", null)] });
  const next = continueThread(item, { note: "n" });
  assert.deepEqual(next.thread.map((r) => r.rev), [1, 2, 5]);
});

test("a second follow-up appends a second completed round, in order", () => {
  const first = anItem({ kind: KIND.COMMENT, note: "First request", change: null, reply: folded({ status: "question", text: "First answer" }) });
  const secondTurn = followUp(first, "Second request");
  const answeredAgain = { ...secondTurn, reply: folded({ text: "Second answer" }), state: STATE.HANDLED };
  const thirdTurn = followUp(answeredAgain, "Third request");
  assert.deepEqual(thirdTurn.thread.map((r) => r.reviewer.note), ["First request", "Second request"]);
  assert.deepEqual(thirdTurn.thread.map((r) => r.agent.text), ["First answer", "Second answer"]);
  assert.equal(thirdTurn.note, "Third request");
});

test("an empty follow-up changes nothing, and a reopen resubmits the same words", () => {
  const answered = anItem({ note: "Keep this exact request.", reply: folded({ text: "Done." }) });
  assert.equal(followUp(answered, "   "), answered);
  assert.equal(followUp(answered, ""), answered);
  const reopened = reopenIssue(answered);
  assert.equal(reopened.rev, answered.rev + 1);
  assert.equal(reopened.note, answered.note);
  assert.equal(reopened.change, answered.change);
  assert.equal(reopened.reply, null);
  assert.equal(reopened.thread[0]?.agent.text, "Done.");
  assert.equal(reopened.state, STATE.READY);
});

test("a follow-up carries the change sentence, so every revision still says what the edit was", () => {
  const answered = anItem({
    change: 'Changed "old wording" to "new wording". Made "new" italic.',
    reply: folded({ agent: "claude", text: "Applied." })
  });
  const next = followUp(answered, "i think you lost my bolding and italics. did they not come through?");
  assert.equal(next.change, answered.change);
  assert.equal(next.note, "i think you lost my bolding and italics. did they not come through?");
});

test("continuing onto a revision that already carries new words archives the answered turn there", () => {
  const question = proofreadQuestion();
  const fixed = applySuggestions(question, question.reply?.suggestions ?? []);
  assert.ok(!("code" in fixed), "the fixes apply");
  const next = continueOnto(question, fixed, { note: "Use the fixes you listed. Change nothing else." });
  assert.equal(next.rev, question.rev + 1, "exactly one revision past the item");
  assert.equal(next.state, STATE.READY);
  assert.equal(next.reply, null);
  assert.equal(next.note, "Use the fixes you listed. Change nothing else.");
  assert.deepEqual(next.new_blocks, fixed.new_blocks);
  assert.equal(next.change, fixed.change, "the fixes revision keeps its own change text");
  const last = next.thread[next.thread.length - 1];
  assert.equal(last?.rev, question.rev);
  assert.equal(last.agent.proofread, true);
});

test("continuing onto a base with no change of its own carries the item's change, or the turn's", () => {
  const question = proofreadQuestion();
  const base = { ...bumpRev(question, { note: "x" }), change: null };
  assert.equal(continueOnto(question, base, { note: "n" }).change, question.change);
  assert.equal(continueOnto(question, { ...base }, { note: "n", change: "the turn's" }).change, "the turn's");
  assert.deepEqual([continueOnto(question, base).note], [null]);
});

test("continuing onto the item itself is continuing the thread, with the change carried", () => {
  const question = proofreadQuestion();
  const a = continueOnto(question, question, { note: "Keep mine as written. No changes." });
  const b = continueThread(question, { note: "Keep mine as written. No changes.", change: question.change });
  assert.equal(a.rev, b.rev);
  assert.deepEqual(a.thread, b.thread);
  assert.equal(a.change, question.change, "the change sentence is carried");
  assert.equal(continueOnto(question, question, { note: "n", change: "turn change" }).change, "turn change");
});
