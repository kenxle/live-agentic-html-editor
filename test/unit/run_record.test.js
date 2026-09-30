// The run record: its fields, validation, change text, history, take-back,
// size ceilings, and accepted proofreading fixes (free-writing plan Task 1.4).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const failures = require("../../src/shared/failures.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");

const CANARY = "zqxcanary";
const fx = () => createFixtures({ seed: "run" });

test("the ceilings are the plan's numbers", () => {
  assert.equal(record.NEW_BLOCKS_MAX, 400);
  assert.equal(record.NEW_BLOCKS_MAX_BYTES, 200000);
  assert.equal(record.RUN_HISTORY_KEEP, 3);
  assert.equal(record.RUN_RECORD_MAX_BYTES, 4194304);
  assert.deepEqual(record.PLACEMENTS, ["after_anchor", "start_of_container"]);
});

test("the four refusal codes and the three card codes are failure codes", () => {
  for (const code of ["RUN_BLOCK_REFUSED", "RUN_OVER_CEILING", "RUN_PLACEMENT_REFUSED", "RUN_TAKEBACK_CARRIES_RUN",
    "REPLAY_RUN_WRONG_TAG", "REPLAY_RUN_PLACED_ELSEWHERE", "RUN_EVENT_REFUSED", "SUGGESTION_NOT_FOUND"]) {
    assert.ok(failures.describe(code), code);
  }
  assert.equal(failures.describe("REPLAY_RUN_WRONG_TAG").message,
    "The agent placed '{first words}' as a {type}. You wrote a {type}, so Lahe sent it back.");
  assert.equal(failures.describe("REPLAY_RUN_PLACED_ELSEWHERE").message,
    "'{first words}' is already further down the page, so Lahe did not add it again.");
  assert.equal(failures.describe("RUN_EVENT_REFUSED").message,
    "The helper refused this edit, so the agent has not seen it. Your words are still on this page.");
});

test("the page check's tag note is pinned and is one of its notes", () => {
  assert.equal(record.PAGE_CHECK_TAG_NOTE,
    "Reopened by the page check: a block landed with a different tag from the one in new_blocks or anchor_tag_after. " +
    "Give it that tag in the source, or reply not_handled saying why.");
  assert.ok(record.PAGE_CHECK_NOTES.indexOf(record.PAGE_CHECK_TAG_NOTE) !== -1);
});

test("the new fields are data", () => {
  for (const f of ["new_blocks", "anchor_after_html", "anchor_tag_after", "placement", "remove_blocks"]) {
    assert.equal(record.fieldClass(f), record.CLASS_DATA, f);
  }
});

test("every run fixture passes validation", () => {
  for (const f of fx().runFixtures()) {
    assert.equal(record.validateRun(f.item), null, f.name);
    record.validateItem(f.item);
  }
});

test("every forged run fixture is refused with its code", () => {
  const forged = fx().forgedRuns();
  const codes = forged.map((f) => f.code).sort();
  assert.deepEqual(codes, ["RUN_BLOCK_REFUSED", "RUN_OVER_CEILING", "RUN_PLACEMENT_REFUSED", "RUN_TAKEBACK_CARRIES_RUN"]);
  for (const f of forged) {
    const got = record.validateRun(f.item);
    assert.ok(got, f.name + " is refused");
    assert.equal(got.code, f.code, f.name);
  }
});

test("after equals the literal string written in each fixture", () => {
  for (const f of fx().runFixtures()) assert.equal(f.item.after, f.after, f.name);
});

test("change equals the exact sentence in each fixture and never quotes the run", () => {
  for (const f of fx().runFixtures()) {
    assert.equal(f.item.change, f.change, f.name);
    assert.equal(f.item.change.indexOf(CANARY), -1, f.name + " quotes no run words");
  }
});

test("every run fixture's words hold the canary", () => {
  for (const f of fx().runFixtures()) {
    const words = JSON.stringify([f.item.after, f.item.new_blocks || null, f.item.remove_blocks || null]);
    assert.ok(words.indexOf(CANARY) !== -1, f.name);
  }
});

test("a split with no typing has no Added sentence", () => {
  const split = fx().runFixtures().find((f) => f.name === "split tail, no typing");
  assert.ok(split);
  assert.equal(split.item.change.indexOf("Added"), -1);
});

test("the worked example's after_html is the anchor then each block as its own element", () => {
  const worked = fx().runFixtures().find((f) => f.name === "worked example");
  assert.equal(
    worked.item.after_html,
    "What changed<h2>What the chat window cost me zqxcanary</h2><p>I lost my place <strong>every</strong> time zqxcanary</p>" +
      "<ul><li>scrolling</li><li>re-asking zqxcanary</li></ul>"
  );
});

test("over the block count ceiling is refused", () => {
  const f = fx();
  const blocks = [];
  for (let i = 0; i < record.NEW_BLOCKS_MAX + 1; i += 1) blocks.push({ tag: "p", html: "b" + i });
  assert.equal(record.validateRun(f.runItem({ new_blocks: blocks })).code, "RUN_OVER_CEILING");
  assert.equal(record.validateRun(f.runItem({ new_blocks: blocks.slice(0, record.NEW_BLOCKS_MAX) })), null);
});

test("a run of three-byte characters under the block count and over the byte count is refused", () => {
  const f = fx();
  // 3 bytes each in UTF-8, so the byte ceiling is crossed by far fewer characters.
  const chars = Math.floor(record.NEW_BLOCKS_MAX_BYTES / 3) + 10;
  const html = "中".repeat(chars);
  assert.ok(html.length < record.NEW_BLOCKS_MAX_BYTES, "under the ceiling in characters");
  const item = f.runItem({ new_blocks: [{ tag: "p", html: html }] });
  assert.equal(record.validateRun(item).code, "RUN_OVER_CEILING");
});

test("a run record over RUN_RECORD_MAX_BYTES is refused even under both block ceilings", () => {
  const f = fx();
  const item = f.runItem();
  const big = "x".repeat(1024 * 1024);
  item.after_history = [0, 1, 2, 3, 4].map((i) => ({ rev: i + 1, after: big, after_html: null, at: f.FIXED_AT }));
  assert.ok(record.recordBytes(item) > record.RUN_RECORD_MAX_BYTES);
  assert.equal(record.validateRun(item).code, "RUN_OVER_CEILING");
});

test("recordBytes counts UTF-8 bytes of the record as JSON", () => {
  const item = { a: "中" };
  assert.equal(record.recordBytes(item), Buffer.byteLength(JSON.stringify(item), "utf8"));
});

test("a record with no run fields is not judged by validateRun", () => {
  assert.equal(record.validateRun(fx().edit()), null);
});

test("a take-back of a handled run lists the blocks in remove_blocks and has no new_blocks", () => {
  const f = fx();
  const worked = f.runFixtures().find((x) => x.name === "worked example").item;
  worked.state = record.STATE.HANDLED;
  const back = record.revertOf(worked);
  assert.equal(back.new_blocks, undefined);
  assert.deepEqual(back.remove_blocks, worked.new_blocks);
  assert.equal(back.reverts, worked.id);
  assert.equal(back.change, record.REVERT_EDIT + " " + record.RUN_TAKEBACK_LINE.replace("{type}", "paragraph"));
  assert.equal(record.validateRun(back), null);
});

test("the take-back fixture carries remove_blocks and never new_blocks", () => {
  const back = fx().runFixtures().find((x) => x.name === "take-back");
  assert.ok(Array.isArray(back.item.remove_blocks) && back.item.remove_blocks.length);
  assert.equal(back.item.new_blocks, undefined);
});

test("the anchor view of a run record carries anchor_after_html as its after_html", () => {
  const worked = fx().runFixtures().find((x) => x.name === "worked example").item;
  const view = record.anchorView(worked);
  assert.equal(view.after_html, "What changed");
  assert.equal(view.after, "What changed");
  assert.notEqual(view, worked);
  assert.equal(worked.after_html.indexOf("<h2>") !== -1, true, "the record itself is untouched");
  const plain = fx().edit();
  assert.equal(record.anchorView(plain), plain, "an ordinary record is its own anchor view");
});

test("history entries carry the run fields", () => {
  const withHistory = fx().runFixtures().find((x) => x.name === "with an earlier run in history").item;
  const first = withHistory.after_history[0];
  assert.ok(Array.isArray(first.new_blocks) && first.new_blocks.length === 1);
  assert.equal(first.placement, "after_anchor");
});

test("history entries older than RUN_HISTORY_KEEP drop new_blocks and after_html and keep after", () => {
  const f = fx();
  let item = f.runItem();
  for (let i = 0; i < 5; i += 1) {
    const blocks = item.new_blocks.concat([{ tag: "p", html: "More words " + i }]);
    const built = record.buildRunAfter(item.anchor_after_html, blocks);
    item = record.bumpRev(item, { new_blocks: blocks, after_html: built.after_html, after: built.after });
  }
  const h = item.after_history;
  assert.equal(h.length, 6);
  const keep = record.RUN_HISTORY_KEEP;
  h.slice(0, h.length - keep).forEach((e) => {
    assert.equal(e.new_blocks, undefined, "rev " + e.rev);
    assert.equal(e.after_html, null, "rev " + e.rev);
    assert.equal(typeof e.after, "string");
  });
  h.slice(h.length - keep).forEach((e) => {
    assert.ok(Array.isArray(e.new_blocks), "rev " + e.rev);
    assert.equal(typeof e.after_html, "string");
  });
});

test("an ordinary record keeps today's history", () => {
  let item = fx().edit();
  for (let i = 0; i < 5; i += 1) item = record.bumpRev(item, { after: "Wording " + i, after_html: "Wording " + i });
  item.after_history.forEach((e) => assert.equal(typeof e.after_html, "string"));
});

test("applySuggestions changes the words, keeps a block's bold, and bumps the revision", () => {
  const worked = fx().runFixtures().find((x) => x.name === "worked example").item;
  const got = record.applySuggestions(worked, [{ block: 1, from: "place", to: "spot" }, { block: 1, from: "every time", to: "each time" }]);
  assert.equal(got.code, undefined);
  assert.equal(got.rev, worked.rev + 1);
  assert.equal(got.new_blocks[1].html, "I lost my spot <strong>each</strong> time zqxcanary");
  assert.equal(got.new_blocks[0].html, worked.new_blocks[0].html);
  assert.ok(got.after.indexOf("I lost my spot each time zqxcanary") !== -1);
  assert.ok(got.after_html.indexOf("<p>I lost my spot <strong>each</strong> time zqxcanary</p>") !== -1);
  assert.equal(got.after_history[got.after_history.length - 1].rev, got.rev);
});

test("applySuggestions refuses a from found twice or not at all", () => {
  const worked = fx().runFixtures().find((x) => x.name === "worked example").item;
  assert.equal(record.applySuggestions(worked, [{ block: 1, from: "nowhere to be seen", to: "x" }]).code, "SUGGESTION_NOT_FOUND");
  assert.equal(record.applySuggestions(worked, [{ block: 2, from: "l", to: "x" }]).code, "SUGGESTION_NOT_FOUND");
  assert.equal(record.applySuggestions(worked, [{ block: 9, from: "place", to: "x" }]).code, "SUGGESTION_NOT_FOUND");
});

test("the proofread question fixture carries suggestions on a question reply", () => {
  const q = fx().proofreadQuestion();
  assert.equal(q.reply.status, "question");
  assert.equal(q.reply.proofread, true);
  assert.ok(q.reply.suggestions.length > 0);
});

test("the old-shape fixture has nested blocks in after_html and no new_blocks", () => {
  const old = fx().oldShapeNested();
  assert.equal(old.new_blocks, undefined);
  assert.equal(record.isRunRecord(old), false);
  assert.ok(old.after_html.indexOf("<p>") !== -1);
});

test("the note fixture carries the page check's tag note", () => {
  const withNote = fx().runWithTagNote();
  assert.ok(withNote.note.indexOf(record.PAGE_CHECK_TAG_NOTE) !== -1);
  assert.equal(record.isRunRecord(withNote), true);
});
