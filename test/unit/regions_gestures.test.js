// read-when: Changing region label rules (src/shared/regions.js), or when its tests fail.

// Region label rules. The gesture cases that used to share this file are in
// test/unit/domain/gestures.test.ts.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const regions = require("../../src/shared/regions.js");

// ---------------------------------------------------------------------------
// Region labels
// ---------------------------------------------------------------------------

const base = {
  authorName: null,
  id: null,
  ariaLabel: null,
  heading: null,
  ordinal: 1,
  tag: "p",
  text: "some text"
};

test("the author-supplied attribute wins the label", () => {
  const got = regions.labelFor(Object.assign({}, base, { authorName: "Pricing blurb", id: "x" }));
  assert.equal(got.label, "Pricing blurb");
  assert.equal(got.source, "author_attribute");
});

test("the fallback chain runs id, then aria-label, then heading, then tag", () => {
  assert.equal(regions.labelFor(Object.assign({}, base, { id: "intro" })).source, "id");
  assert.equal(regions.labelFor(Object.assign({}, base, { ariaLabel: "Main copy" })).source, "aria_label");
  assert.equal(
    regions.labelFor(Object.assign({}, base, { heading: "Introduction", ordinal: 2 })).source,
    "heading_ordinal"
  );
  assert.equal(regions.labelFor(base).source, "tag_ordinal");
});

test("a label is pinned at first touch and never recomputed", () => {
  const region = { ref: { id: "ref_1" }, label: null, lost: null };
  regions.pinLabel(region, Object.assign({}, base, { heading: "Introduction", ordinal: 1 }));
  const first = region.label;
  // The page repaints, the heading changes, someone inserts a sibling.
  regions.pinLabel(region, Object.assign({}, base, { heading: "Something Else", ordinal: 7 }));
  assert.equal(region.label, first, "the reviewer learned this name; it does not move");
});

test("two regions under one heading get the same label and are still two records", () => {
  // The named shipped bug in the tool being replaced. R29 exists because of it.
  const a = regions.labelFor(Object.assign({}, base, { heading: "Introduction", ordinal: 2 }));
  const b = regions.labelFor(Object.assign({}, base, { heading: "Introduction", ordinal: 2 }));
  assert.equal(a.label, b.label, "labels may collide");
  assert.equal(regions.sameRegion({ id: "ref_1" }, { id: "ref_2" }), false, "references may not");
  assert.equal(regions.LABELS_MAY_COLLIDE, true);
  assert.equal(regions.IDENTITY_IS_THE_REFERENCE_NOT_THE_LABEL, true);
});

test("two unresolved regions are never the same region", () => {
  assert.equal(regions.sameRegion(null, null), false);
  assert.equal(regions.sameRegion({ id: "a" }, null), false);
});

test("a label is bounded so the rail cannot be blown out by a long paragraph", () => {
  const long = "x".repeat(500);
  const got = regions.labelFor(Object.assign({}, base, { authorName: long }));
  assert.equal(got.label.length <= regions.LABEL_MAX, true);
});

test("a descriptor that produces no label at all fails loud", () => {
  assert.throws(
    () => regions.labelFor({ authorName: null, id: null, ariaLabel: null, heading: null, tag: null, text: null }),
    /no label source/
  );
});
