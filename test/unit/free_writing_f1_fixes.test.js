// Free writing, fix round F1 (editing): the parts of the fixes that are pure
// functions, so they are held by a unit test. The browser half is
// test/browser/f1_editing_fixes.spec.js.
//
// docs/features/20260928.01_free_writing/reviews_impl/FIX_ROUND.md, group F1.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const lifecycle = require("../../src/shared/lifecycle.js");
const editing = require("../../src/layer/editing.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures().runFixtures();

function runItem() {
  return JSON.parse(JSON.stringify(fixtures.find((f) => f.name === "worked example").item));
}

// ---- design call 5, adversary A1: undo after the agent acted ---------------

test("undo takes back a ready item the agent already replied to (a question, a proofread)", () => {
  const item = runItem();
  assert.equal(item.state, "ready");
  assert.equal(lifecycle.undoTakesBack(item), false, "no reply yet: nothing landed, undo may drop it");

  const asked = Object.assign({}, item, { reply: { status: "question", text: "Proofread these?", at: "2026-09-29T00:00:00.000Z" } });
  assert.equal(lifecycle.undoTakesBack(asked), true, "the agent placed the words and asked");

  // After "Use the fixes": ready again at rev + 1, the question in the thread.
  const fixed = Object.assign({}, item, {
    rev: 2,
    reply: null,
    thread: [{ rev: 1, reviewer: { note: null }, agent: { status: "question", text: "Proofread?" } }]
  });
  assert.equal(lifecycle.undoTakesBack(fixed), true, "rev 1 is already in the source");

  // The reviewer rewording it after the question: a draft, still placed.
  assert.equal(lifecycle.undoTakesBack(Object.assign({}, fixed, { state: "draft" })), true);
});

test("undo on a handled item takes back; a not_handled one drops, as before", () => {
  const item = runItem();
  assert.equal(lifecycle.undoTakesBack(Object.assign({}, item, { state: "handled" })), true);
  const refused = Object.assign({}, item, { state: "not_handled", reply: { status: "not_handled", reason: "no" } });
  assert.equal(lifecycle.undoTakesBack(refused), false, "an agent that said not_handled changed nothing");
  assert.equal(lifecycle.undoTakesBack(null), false);
});

// ---- code_lead 6: the bar's size estimate ----------------------------------

function bigFields(words, blocks) {
  const list = [];
  for (let i = 0; i < blocks; i += 1) {
    list.push({ tag: "p", html: ("word" + i + " ").repeat(words).trim() + " <strong>b</strong> \"q\" &amp;" });
  }
  const built = record.buildRunAfter("What changed", list);
  return {
    anchor_after_html: "What changed",
    anchor_tag_after: null,
    new_blocks: list,
    placement: "after_anchor",
    after: built.after,
    after_html: built.after_html
  };
}

function committedBytes(item, fields) {
  const changes = Object.assign({ kind: "edit", state: "ready" }, fields);
  changes.change = record.runChangeText(Object.assign({}, item, fields));
  return record.recordBytes(record.bumpRev(item, changes));
}

test("the run record estimate is never below what the commit writes, at rev 13", () => {
  let item = runItem();
  // Twelve sittings, each carrying a long run.
  for (let rev = 2; rev <= 12; rev += 1) {
    const f = bigFields(60, 40 + rev);
    const changes = Object.assign({ kind: "edit", state: "ready" }, f);
    changes.change = record.runChangeText(Object.assign({}, item, f));
    item = record.bumpRev(item, changes);
  }
  const fields = bigFields(60, 60);
  const real = committedBytes(item, fields);
  const estimate = editing.runRecordBytes(item, fields, true);
  assert.ok(estimate >= real, "estimate " + estimate + " under the real " + real);

  // The old formula (the record apart from the run, plus twice the run, plus
  // 48 a block) was under the real size: that gap is the finding.
  const base = record.recordBytes(Object.assign({}, item, { new_blocks: [], after_html: "", after: "" }));
  const old = base + record.blocksBytes(fields.new_blocks) * 2 + fields.new_blocks.length * 48;
  assert.ok(old < real, "the old estimate " + old + " was already enough; the test proves nothing");
});

test("between measurements, RUN_BYTES_FACTOR covers each byte typed", () => {
  const item = runItem();
  const fields = bigFields(40, 30);
  const measured = editing.runRecordBytes(item, fields, false);
  // Type 500 more characters into the last block, quotes and ampersands included.
  const more = JSON.parse(JSON.stringify(fields));
  const extra = " \"x\" &amp; y".repeat(50);
  more.new_blocks[more.new_blocks.length - 1].html += extra;
  const built = record.buildRunAfter("What changed", more.new_blocks);
  more.after = built.after;
  more.after_html = built.after_html;
  const typed = Buffer.byteLength(extra, "utf8");
  const real = editing.runRecordBytes(item, more, false);
  assert.ok(measured + typed * editing.RUN_BYTES_FACTOR >= real, "projected " + (measured + typed * editing.RUN_BYTES_FACTOR) + " under " + real);
});
