/*
 * read-when: Changing src/domain/reply-unread.ts, or the "1 new" tag, the menu bar's "waiting on you" or a toast counts a reply it should not, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CLOSED_BY_REVIEWER, FIELD, REPLY_STAMP_MAX, STATE, TOOL_ROUND } from "../../../src/contract/record.ts";
import type { Item } from "../../../src/contract/record.ts";
import { stampPageCheckReopen } from "../../../src/domain/page-check.ts";
import { hasWords, isUnreadReply, needsToSeeReply, replyStamp, unseenReplyIds } from "../../../src/domain/reply-unread.ts";
import { callUntyped, label } from "../contract/support/untyped.ts";
import { anItem, folded } from "./support/items.ts";

const AT = "2026-08-18T12:00:00.000Z";

function questioned(overrides: Partial<Item> = {}): Item {
  return { ...anItem({ id: "itm_q", rev: 2, reply: folded({ status: "question", text: "Which?", at: AT }) }), ...overrides };
}

test("a reply's stamp is its time, an at sign and the revision it answered", () => {
  assert.equal(replyStamp({ rev: 2, reply: folded({ at: "T" }) }), "T@2");
  assert.equal(replyStamp({ rev: 2, reply: folded({ at: null }) }), "@2");
  assert.equal(replyStamp({ rev: 7, reply: folded({ at: AT }) }), AT + "@7");
});

test("a record with no reply or no record has no stamp, and a record with no revision reads it as empty", () => {
  assert.equal(replyStamp({ rev: 2, reply: null }), null);
  assert.equal(replyStamp(null), null);
  assert.equal(replyStamp(undefined), null);
  assert.equal(callUntyped(replyStamp, { reply: folded({ at: "T" }) }), "T@");
});

test("words are a string with a character that is not a space", () => {
  assert.equal(hasWords("a"), true);
  assert.equal(hasWords("  x  "), true);
  for (const value of ["", "   ", "\n\t", null, undefined, 3, {}]) assert.equal(hasWords(value), false, label(value));
});

test("a question and a refusal always need to be seen, flag or no flag, words or none", () => {
  assert.equal(needsToSeeReply(folded({ status: "question", text: null })), true);
  assert.equal(needsToSeeReply(folded({ status: "question", text: "Which?" })), true);
  assert.equal(needsToSeeReply(folded({ status: "not_handled", reason: null, text: null })), true);
  assert.equal(needsToSeeReply(folded({ status: "not_handled", reason: "can't" })), true);
});

test("a handled reply needs to be seen only when the agent flagged it, exactly, and there are words to read", () => {
  assert.equal(needsToSeeReply(folded({ user_needs_to_see_reply: true, text: "I did it differently." })), true);
  assert.equal(needsToSeeReply(folded({ user_needs_to_see_reply: true, text: null, reason: "because" })), true);
  assert.equal(needsToSeeReply(folded({ user_needs_to_see_reply: true, text: "  ", reason: null })), false, "a flag with no words behind it");
  assert.equal(needsToSeeReply(folded({ text: "Done." })), false, "a routine handled reply");
  assert.equal(needsToSeeReply(folded({ user_needs_to_see_reply: false, text: "Done." })), false);
  assert.equal(needsToSeeReply(null), false);
  assert.equal(needsToSeeReply(undefined), false);
  assert.equal(callUntyped(needsToSeeReply, { ...folded({ text: "Done." }), user_needs_to_see_reply: "true" }), false, "only the boolean true counts");
});

test("a question the reviewer has not read is unread, and a mark or reply_seen naming its stamp clears it", () => {
  const item = questioned();
  assert.equal(isUnreadReply(item), true);
  assert.equal(isUnreadReply(item, AT + "@2"), false, "a mark naming this reply");
  assert.equal(isUnreadReply({ ...item, reply_seen: AT + "@2" }), false, "the helper's reply_seen naming this reply");
  assert.equal(isUnreadReply(item, "other"), true);
});

test("a mark or reply_seen for an older reply does not clear a newer one", () => {
  const item = questioned({ rev: 3 });
  assert.equal(isUnreadReply(item, AT + "@2"), true, "the mark names an older stamp");
  assert.equal(isUnreadReply({ ...item, reply_seen: AT + "@2" }), true);
});

test("no reply, a tool round, a card the reviewer closed and a routine reply are never unread", () => {
  assert.equal(isUnreadReply(anItem({ reply: null })), false);
  assert.equal(isUnreadReply(null), false);
  assert.equal(isUnreadReply(undefined), false);
  assert.equal(isUnreadReply(questioned({ state: STATE.HANDLED, closed_by: CLOSED_BY_REVIEWER })), false, "closing a card is acting on it");
  assert.equal(isUnreadReply({ ...anItem({ reply: folded({ text: "Done." }) }) }), false, "a routine handled reply");
  const round = questioned();
  stampPageCheckReopen(round, "T@1", AT, TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(isUnreadReply(round), false, "an answer to a tool round is routine");
});

test("the ids of the items with an unread reply come back in item order, each reading its own mark", () => {
  const a = questioned({ id: "a" });
  const b = questioned({ id: "b" });
  const c = questioned({ id: "c" });
  const stamp = AT + "@2";
  assert.deepEqual(unseenReplyIds([a, b, c], {}), ["a", "b", "c"]);
  assert.deepEqual(unseenReplyIds([a, b, c], { b: stamp }), ["a", "c"]);
  assert.deepEqual(unseenReplyIds([a, b, c], { b: "older@1", c: stamp }), ["a", "b"]);
});

test("a mark is read only as the item's own property, so an inherited name is no mark", () => {
  const constructor = questioned({ id: "constructor" });
  const toString = questioned({ id: "toString" });
  assert.deepEqual(unseenReplyIds([constructor, toString], {}), ["constructor", "toString"]);
  assert.deepEqual(unseenReplyIds([constructor], { constructor: AT + "@2" }), []);
});

test("missing items give an empty list, and missing or non-object marks count as none", () => {
  assert.deepEqual(unseenReplyIds(null), []);
  assert.deepEqual(unseenReplyIds(undefined, {}), []);
  assert.deepEqual(unseenReplyIds([], {}), []);
  const item = questioned();
  assert.deepEqual(unseenReplyIds([item], null), [item.id]);
  assert.deepEqual(unseenReplyIds([item]), [item.id]);
  assert.deepEqual(callUntyped(unseenReplyIds, [item], "marks"), [item.id]);
});

test("the stamp bound is the longest stamp a reply.seen event may carry, and a real stamp is far under it", () => {
  assert.equal(REPLY_STAMP_MAX, 64);
  const real = replyStamp(questioned());
  assert.ok(real !== null && real.length < REPLY_STAMP_MAX, String(real));
  assert.equal(FIELD.REPLY_SEEN, "reply_seen");
});
