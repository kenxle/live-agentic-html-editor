/*
 * read-when: Changing src/contract/run-limits.ts, or a free-writing ceiling or a reply's proofreading bound, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { parseReplyLine, SUGGESTIONS_MAX, SUGGESTION_TEXT_MAX } from "../../../src/contract/replies.ts";
import { NEW_BLOCKS_MAX, NEW_BLOCKS_MAX_BYTES, RUN_HISTORY_KEEP, RUN_RECORD_MAX_BYTES } from "../../../src/contract/run-limits.ts";

test("the ceilings are the free-writing plan's numbers", () => {
  assert.equal(NEW_BLOCKS_MAX, 400);
  assert.equal(NEW_BLOCKS_MAX_BYTES, 200000);
  assert.equal(RUN_RECORD_MAX_BYTES, 4194304);
  assert.equal(RUN_HISTORY_KEEP, 3);
});

test("the reply's proofreading caps are the run's ceilings, read from one place", () => {
  assert.equal(SUGGESTIONS_MAX, NEW_BLOCKS_MAX);
  assert.equal(SUGGESTION_TEXT_MAX, NEW_BLOCKS_MAX_BYTES);
});

test("a reply line is refused one fix past the block ceiling and accepted at it", () => {
  const fix = { block: 0, from: "a", to: "b" };
  const line = (count: number): string =>
    JSON.stringify({
      item: "itm_1",
      rev: 2,
      agent: "claude",
      status: "question",
      text: "Which?",
      proofread: true,
      suggestions: Array.from({ length: count }, () => fix)
    });
  assert.equal(parseReplyLine(line(NEW_BLOCKS_MAX)).ok, true);
  assert.equal(parseReplyLine(line(NEW_BLOCKS_MAX + 1)).ok, false);
});
