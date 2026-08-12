// THROWAWAY STUB CONSUMER: 1C (anchor engine)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 1C (anchor engine), which is
// the single reason that task exists. It calls every kernel signature 1C (anchor engine)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 1C (anchor engine)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 1C (anchor engine) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const anchor = require("../../src/layer/anchor.js");
const uniqueness = require("../../src/shared/uniqueness.js");
const regions = require("../../src/shared/regions.js");
const normalize = require("../../src/shared/normalize.js");

test("1C can mint a reference with every field the record expects", () => {
  const ref = anchor.emptyRef();
  assert.deepEqual(Object.keys(ref).sort(), ["attr", "heading", "id", "minted_at", "path", "prefix", "probe", "suffix"]);
  const minted = anchor.mint({ element: { textContent: "  The trainer   writes the plan. " } });
  assert.equal(minted.probe, "The trainer writes the plan.", "minted through the one normalizer");
  assert.equal(typeof minted.id, "string");
});

test("1C resolves through the shared uniqueness predicate, not a threshold of its own", () => {
  const ref = anchor.mint({ element: { textContent: "a paragraph" } });
  const verdict = anchor.resolve(ref, null);
  assert.equal(typeof verdict.bound, "boolean");
  assert.equal(Object.prototype.hasOwnProperty.call(verdict, "element"), true);
  assert.equal(typeof uniqueness.selectUnique, "function");
});

test("1C uses the one normalizer for whitespace-tolerant matching", () => {
  assert.equal(normalize.textEquals("a  b", " a b "), true);
  assert.equal(normalize.normalizeText("a\u00A0b"), "a b");
});

test("1C pins a label once and compares identity by reference, never by label", () => {
  const region = { ref: { id: "ref_1" }, label: null, lost: null };
  regions.pinLabel(region, { authorName: null, id: null, ariaLabel: null, heading: "Intro", ordinal: 1, tag: "p", text: "x" });
  const first = region.label;
  regions.pinLabel(region, { authorName: null, id: null, ariaLabel: null, heading: "Moved", ordinal: 9, tag: "p", text: "x" });
  assert.equal(region.label, first);
  assert.equal(regions.sameRegion({ id: "ref_1" }, { id: "ref_2" }), false);
  assert.equal(typeof regions.lostState("ANCHOR_NOT_FOUND", "no candidate").code, "string");
});
