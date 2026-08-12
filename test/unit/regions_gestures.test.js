// Region label rules and the gesture table.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const regions = require("../../src/shared/regions.js");
const gestures = require("../../src/shared/gestures.js");

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

// ---------------------------------------------------------------------------
// Gestures
// ---------------------------------------------------------------------------

function click(overrides) {
  return gestures.gestureFor(Object.assign({ type: "click", editingEnabled: true }, overrides || {}));
}

test("a plain click places the cursor and never fires the page's behavior (R37)", () => {
  const g = click({});
  assert.equal(g.gesture, gestures.GESTURE.PLACE_CARET);
  assert.equal(g.passThrough, false);
  assert.equal(g.preventDefault, true);
});

test("a plain click on a link still does not navigate", () => {
  const g = click({ onLink: true });
  assert.equal(g.gesture, gestures.GESTURE.PLACE_CARET);
  assert.equal(g.passThrough, false);
});

test("Alt-click comments on the element and never opens on a plain click (R15)", () => {
  assert.equal(click({ altKey: true }).gesture, gestures.GESTURE.COMMENT_ON_ELEMENT);
  assert.notEqual(click({}).gesture, gestures.GESTURE.COMMENT_ON_ELEMENT);
});

test("Alt-click still comments while the editing toggle is off", () => {
  const g = click({ altKey: true, editingEnabled: false });
  assert.equal(g.gesture, gestures.GESTURE.COMMENT_ON_ELEMENT);
});

test("Cmd-click over a link inside a commentable block follows the link and comments on nothing", () => {
  const g = click({ metaKey: true, onLink: true });
  assert.equal(g.gesture, gestures.GESTURE.FOLLOW_LINK);
  assert.equal(g.passThrough, true);
  assert.equal(g.preventDefault, false);
});

test("Ctrl-click is the same gesture as Cmd-click", () => {
  assert.equal(click({ ctrlKey: true, onLink: true }).gesture, gestures.GESTURE.FOLLOW_LINK);
});

test("Cmd-click away from a link has nothing to follow, so it places the caret", () => {
  assert.equal(click({ metaKey: true, onLink: false }).gesture, gestures.GESTURE.PLACE_CARET);
});

test("the editing toggle gives back an ordinary page (R38)", () => {
  const g = click({ editingEnabled: false });
  assert.equal(g.gesture, gestures.GESTURE.PAGE_DEFAULT);
  assert.equal(g.passThrough, true);
  assert.equal(g.preventDefault, false);
});

test("the tool's own overlay is never subject to the page's gesture rules", () => {
  assert.equal(click({ inOverlay: true, altKey: true }).gesture, gestures.GESTURE.NONE);
});

test("Escape dismisses, and its two meanings are ordered", () => {
  const g = gestures.gestureFor({ type: "keydown", key: "Escape" });
  assert.equal(g.gesture, gestures.GESTURE.DISMISS);
  assert.deepEqual(gestures.ESCAPE_ORDER, ["close_open_compose", "collapse_rail"]);
});

test("Cmd-Enter sends", () => {
  assert.equal(gestures.gestureFor({ type: "keydown", key: "Enter", metaKey: true }).gesture, gestures.GESTURE.SEND);
});

test("an ordinary keystroke is not a layer gesture, so typing works", () => {
  const g = gestures.gestureFor({ type: "keydown", key: "a" });
  assert.equal(g.gesture, gestures.GESTURE.NONE);
  assert.equal(g.passThrough, true);
  assert.equal(g.preventDefault, false);
});

test("every gesture in the table has a hover hint, because both escapes are taught on screen", () => {
  for (const row of gestures.TABLE) {
    assert.equal(typeof gestures.hintFor(row.gesture), "string");
    assert.equal(gestures.hintFor(row.gesture).length > 0, true);
  }
});
