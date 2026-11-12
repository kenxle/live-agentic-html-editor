/*
 * read-when: Changing src/domain/proofread.ts, or the reviewer's "Use the fixes" changes the wrong words, loses formatting, or is refused, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Item } from "../../../src/contract/record.ts";
import { USE_FIXES_CHANGE, applySuggestions } from "../../../src/domain/proofread.ts";
import { validateRun } from "../../../src/domain/run-check.ts";
import { buildRunAfter } from "../../../src/domain/run-record.ts";
import { callUntyped } from "../contract/support/untyped.ts";
import { anItem } from "./support/items.ts";
import { runItem, worked } from "./support/runs.ts";

function fixed(result: Item | { readonly code: string; readonly reason: string }): Item {
  if ("code" in result) throw new Error("expected the fixes to apply: " + result.reason);
  return result;
}

function refused(result: Item | { readonly code: string; readonly reason: string }): string {
  if (!("code" in result)) throw new Error("expected the fixes to be refused");
  assert.equal(result.code, "SUGGESTION_NOT_FOUND");
  return result.reason;
}

function split(): Item {
  return runItem({
    before: "First half zqxcanary. Second half zqxcanary.",
    before_html: "First half zqxcanary. Second half zqxcanary.",
    anchor_after_html: "First half zqxcanary.",
    new_blocks: [
      { tag: "p", html: "Second half zqxcanary.", from_anchor: true },
      { tag: "p", html: "Typed after the split zqxcanary" }
    ]
  });
}

test("the change text of the fixes revision says what to do in the source, with the number of fixes", () => {
  assert.equal(
    USE_FIXES_CHANGE,
    "The reviewer took your proofreading fixes, {n} in all. In the source, replace each fix's from words with its to words in the block you already placed, in place, so it matches new_blocks; do not add any block again. The fixes are listed as block, from and to under suggestions in the thread's last agent turn."
  );
  const run = worked();
  const next = fixed(applySuggestions(run, [{ block: 1, from: "place", to: "spot" }, { block: 0, from: "cost me", to: "cost us" }]));
  assert.equal(next.change, USE_FIXES_CHANGE.replace("{n}", "2"));
  assert.notEqual(next.change, run.change);
  assert.ok(/replace/i.test(next.change) && /in place/i.test(next.change), next.change);
});

test("the fixes change the words, keep a block's bold, bump the revision and pass the helper's check", () => {
  const run = worked();
  const got = fixed(applySuggestions(run, [{ block: 1, from: "place", to: "spot" }, { block: 1, from: "every time", to: "each time" }]));
  assert.equal(got.rev, run.rev + 1);
  assert.equal(got.new_blocks?.[1]?.html, "I lost my spot <strong>each</strong> time zqxcanary");
  assert.equal(got.new_blocks[0]?.html, run.new_blocks?.[0]?.html);
  assert.ok(got.after?.includes("I lost my spot each time zqxcanary"));
  assert.ok(got.after_html?.includes("<p>I lost my spot <strong>each</strong> time zqxcanary</p>"));
  assert.equal(got.after_history[got.after_history.length - 1]?.rev, got.rev);
  assert.equal(validateRun(got), null);
  const rebuilt = buildRunAfter(got.anchor_after_html, got.new_blocks);
  assert.equal(got.after_html, rebuilt.after_html);
  assert.equal(got.after, rebuilt.after);
});

test("the record passed in, and its blocks, are not changed", () => {
  const run = worked();
  const before = JSON.stringify(run);
  fixed(applySuggestions(run, [{ block: 1, from: "place", to: "spot" }]));
  assert.equal(JSON.stringify(run), before);
});

test("a fix quoting the words as text shows them applies", () => {
  const run = runItem({ new_blocks: [{ tag: "p", html: "Tom &amp; Jerry &lt;3 cats" }] });
  const got = fixed(applySuggestions(run, [{ block: 0, from: "Tom & Jerry <3", to: "Tom and Jerry <3" }]));
  assert.equal(got.new_blocks?.[0]?.html, "Tom and Jerry &lt;3 cats");
});

test("a fix to a from_anchor block, which holds the page's own words, is refused, and a fix to the typed block is not", () => {
  const reason = refused(applySuggestions(split(), [{ block: 0, from: "Second half", to: "Latter half" }]));
  assert.equal(reason, "suggestion 0: block 0 is marked from_anchor, the page's own words");
  const ok = fixed(applySuggestions(split(), [{ block: 1, from: "Typed", to: "Written" }]));
  assert.equal(ok.new_blocks?.[1]?.html, "Written after the split zqxcanary");
});

test("a from found twice or not at all, or in no block, is refused, naming the suggestion and the block", () => {
  const run = worked();
  assert.equal(refused(applySuggestions(run, [{ block: 1, from: "nowhere to be seen", to: "x" }])), "suggestion 0: from is not in block 1 exactly once");
  assert.equal(refused(applySuggestions(run, [{ block: 2, from: "l", to: "x" }])), "suggestion 0: from is not in block 2 exactly once");
  assert.equal(
    refused(applySuggestions(run, [{ block: 1, from: "place", to: "spot" }, { block: 9, from: "place", to: "x" }])),
    "suggestion 1 does not name a block and a from"
  );
});

test("a suggestion that is not well formed is refused at its index", () => {
  const run = worked();
  const bad = (suggestion: unknown, index = 0): string => refused(applySuggestions(run, [...Array.from({ length: index }, () => ({ block: 1, from: "place", to: "place" })), suggestion]));
  assert.equal(bad(null), "suggestion 0 does not name a block and a from");
  assert.equal(bad("x"), "suggestion 0 does not name a block and a from");
  assert.equal(bad({ block: 1, from: "", to: "x" }), "suggestion 0 does not name a block and a from");
  assert.equal(bad({ block: 1, from: "place", to: 5 }), "suggestion 0 does not name a block and a from");
  assert.equal(bad({ block: "x", from: "place", to: "x" }), "suggestion 0 does not name a block and a from");
  assert.equal(bad({ from: "place", to: "x" }), "suggestion 0 does not name a block and a from");
  assert.equal(bad({ block: 1, from: "place", to: 5 }, 2), "suggestion 2 does not name a block and a from");
});

test("a fix that leaves a block empty or unsafe is refused", () => {
  const run = runItem({ new_blocks: [{ tag: "p", html: "just words" }] });
  assert.equal(refused(applySuggestions(run, [{ block: 0, from: "just words", to: "" }])), "suggestion 0 leaves block 0 empty or unsafe");
  assert.equal(refused(applySuggestions(run, [{ block: 0, from: "just words", to: "   " }])), "suggestion 0 leaves block 0 empty or unsafe");
});

test("a record that is not a run record, and a missing list, are handled", () => {
  assert.equal(refused(applySuggestions(anItem(), [{ block: 0, from: "a", to: "b" }])), "not a run record");
  assert.deepEqual(callUntyped(applySuggestions, null, []), { code: "SUGGESTION_NOT_FOUND", reason: "not a run record" });
  const run = worked();
  const none = fixed(applySuggestions(run, null));
  assert.equal(none.rev, run.rev + 1);
  assert.equal(none.change, USE_FIXES_CHANGE.replace("{n}", "0"));
  assert.deepEqual(none.new_blocks, run.new_blocks);
  assert.equal(fixed(applySuggestions(run, undefined)).rev, run.rev + 1);
  assert.equal(fixed(applySuggestions(run, [])).rev, run.rev + 1);
});

test("a fix changes the words inside the text and leaves every tag where it was", () => {
  const run = runItem({ new_blocks: [{ tag: "p", html: "I lost my place <strong>every</strong> time and <em>again</em>" }] });
  const reword = (from: string, to: string): string | undefined => fixed(applySuggestions(run, [{ block: 0, from, to }])).new_blocks?.[0]?.html;
  assert.equal(reword("every time", "each time"), "I lost my place <strong>each</strong> time and <em>again</em>", "the bold stays on the words it still covers");
  assert.equal(reword("place", "spot"), "I lost my spot <strong>every</strong> time and <em>again</em>", "a bold next to the fix survives");
  assert.equal(reword("lost", "lost not"), "I lost not my place <strong>every</strong> time and <em>again</em>", "only the part that differs is replaced");
});

test("a fix that only inserts goes into the text piece that holds the point", () => {
  const run = runItem({ new_blocks: [{ tag: "p", html: "one <strong>two</strong> three" }] });
  const got = fixed(applySuggestions(run, [{ block: 0, from: "two three", to: "two big three" }]));
  assert.equal(got.new_blocks?.[0]?.html, "one <strong>two</strong> big three");
});

test("the text is read with its entities resolved and written back with &, < and > escaped", () => {
  const run = runItem({ new_blocks: [{ tag: "p", html: "a &amp; b &lt; c" }] });
  const got = fixed(applySuggestions(run, [{ block: 0, from: "b < c", to: "b > c" }]));
  assert.equal(got.new_blocks?.[0]?.html, "a &amp; b &gt; c");
});

test("each fix is applied to the block as the earlier fixes left it", () => {
  const run = runItem({ new_blocks: [{ tag: "p", html: "one two" }] });
  const got = fixed(applySuggestions(run, [{ block: 0, from: "one", to: "two" }, { block: 0, from: "two two", to: "three" }]));
  assert.equal(got.new_blocks?.[0]?.html, "three");
});

test("a list block's fix keeps its items", () => {
  const run = runItem({ new_blocks: [{ tag: "ul", html: "<li>scrolling</li><li>re-asking</li>" }] });
  const got = fixed(applySuggestions(run, [{ block: 0, from: "re-asking", to: "asking again" }]));
  assert.equal(got.new_blocks?.[0]?.html, "<li>scrolling</li><li>asking again</li>");
});
