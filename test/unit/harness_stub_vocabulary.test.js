// The stub's vocabulary is pinned to the kernel's.
//
// test/fixtures/assets/harness-stub.js deliberately does not require or bundle
// the real modules: the fixture server's root is test/fixtures, the built
// bundle is dist/lahe-layer.js, and builders are forbidden from rebuilding
// dist/, so a harness that loaded the bundle would make every browser self-test
// depend on an artifact no builder may refresh.
//
// The cost of that choice is that the stub holds copies of the kernel's names,
// and a copy drifts. This test is the guard: it reads the names out of the stub
// source and compares them against the real modules. When 0A-kernel renames a
// state, a kind, a protection counter, or a gesture, this fails in the unit
// suite with the two spellings side by side, rather than in a browser test three
// phases later with a symptom that looks like a broken assertion.
//
// It reads the source as text rather than executing it, because the stub is a
// browser IIFE that touches window and document on load.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const record = require("../../src/shared/record.js");
const gestures = require("../../src/shared/gestures.js");
const protect = require("../../src/layer/protect.js");

const STUB_PATH = path.join(__dirname, "..", "fixtures", "assets", "harness-stub.js");
const source = fs.readFileSync(STUB_PATH, "utf8");

// Pull `NAME: "value"` pairs out of one `const NAME = { ... };` block.
function constBlock(name) {
  const start = source.indexOf("const " + name + " = {");
  assert.notEqual(start, -1, "the stub should declare a " + name + " block");
  const end = source.indexOf("};", start);
  const block = source.slice(start, end);
  const out = {};
  const pattern = /(\w+):\s*"([^"]+)"/g;
  let match = pattern.exec(block);
  while (match) {
    out[match[1]] = match[2];
    match = pattern.exec(block);
  }
  return out;
}

test("the stub's KIND values are the record module's", () => {
  const stubKind = constBlock("KIND");
  Object.keys(stubKind).forEach((key) => {
    assert.equal(
      stubKind[key],
      record.KIND[key],
      "stub KIND." + key + " is " + stubKind[key] + ", the kernel says " + record.KIND[key]
    );
  });
  assert.deepEqual(
    Object.keys(stubKind).sort(),
    Object.keys(record.KIND).sort(),
    "the stub should carry every kind the kernel defines, and no others"
  );
});

test("the stub's STATE values are the record module's four", () => {
  const stubState = constBlock("STATE");
  Object.keys(stubState).forEach((key) => {
    assert.equal(stubState[key], record.STATE[key], "stub STATE." + key + " has drifted");
  });
  assert.deepEqual(Object.keys(stubState).sort(), Object.keys(record.STATE).sort());
  assert.equal(Object.keys(stubState).length, 4, "exactly four states; question and reopened are not states");
});

test("the stub's LAYER values are protect.js's three", () => {
  const stubLayer = constBlock("LAYER");
  Object.keys(stubLayer).forEach((key) => {
    assert.equal(stubLayer[key], protect.LAYER[key], "stub LAYER." + key + " has drifted");
  });
  assert.deepEqual(Object.keys(stubLayer).sort(), Object.keys(protect.LAYER).sort());
});

test("every gesture the stub names is a gesture the table defines", () => {
  const stubGesture = constBlock("GESTURE");
  const known = Object.keys(gestures.GESTURE);
  Object.keys(stubGesture).forEach((key) => {
    assert.ok(known.indexOf(key) !== -1, "the gesture table has no " + key);
    assert.equal(
      stubGesture[key],
      gestures.GESTURE[key],
      "stub GESTURE." + key + " is " + stubGesture[key] + ", the table says " + gestures.GESTURE[key]
    );
  });
  // The stub implements a subset on purpose: it is not the gesture surface.
  // These four are the vocabulary the plan names for it.
  ["EDIT_BLOCK", "COMMIT_EDIT", "MARK_READY", "CANCEL"].forEach((key) => {
    assert.ok(Object.prototype.hasOwnProperty.call(stubGesture, key), "the stub should name " + key);
  });
});

test("the stub publishes protection's counters under protect.js's names", () => {
  // The harness reads window.__lahe.counters.restores in
  // assertCaretRestoredAcrossRepaints. If 2B publishes a different name than the
  // stub, the assertion silently scores zero restores and every layer-three test
  // fails for a reason that looks like broken code.
  Object.keys(protect.counters).forEach((name) => {
    assert.match(
      source,
      new RegExp("counters\\." + name + "\\s*="),
      "the stub should initialize counters." + name + ", which src/layer/protect.js publishes"
    );
  });
});

test("the stub's record fields are field names the kernel spells", () => {
  // Every field the stub writes onto an item, checked against FIELD. A stub that
  // invents `afterHtml` next to the kernel's `after_html` is the exact drift
  // this suite exists to catch, and it is invisible in a browser test.
  const known = Object.keys(record.FIELD).map((key) => record.FIELD[key]);
  const start = source.indexOf("const item = {");
  assert.notEqual(start, -1, "the stub should build its item in one literal");
  const block = source.slice(start, source.indexOf("};", start));
  const pattern = /^\s{6}(\w+):/gm;
  const fields = [];
  let match = pattern.exec(block);
  while (match) {
    fields.push(match[1]);
    match = pattern.exec(block);
  }
  assert.ok(fields.length >= 15, "expected the whole record shape, found " + fields.length + " fields");
  fields.forEach((field) => {
    assert.ok(known.indexOf(field) !== -1, "the record module has no field named '" + field + "'");
  });
  // And the ones replay and the merge rule cannot work without.
  ["id", "rev", "kind", "state", "before", "after", "after_history", "page_origin", "page_path"].forEach(
    (field) => {
      assert.ok(fields.indexOf(field) !== -1, "the stub's item is missing " + field);
    }
  );
});
