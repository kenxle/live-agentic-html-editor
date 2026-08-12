// Region label rules and the gesture table.
//
// The regions half is unchanged. The gestures half follows D3's vocabulary.

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
// Gestures (D3)
// ---------------------------------------------------------------------------

function key(k, overrides) {
  return gestures.gestureFor(Object.assign({ type: "keydown", key: k }, overrides || {}));
}

function click(overrides) {
  return gestures.gestureFor(Object.assign({ type: "click" }, overrides || {}));
}

test("browse is the page untouched: an ordinary click is the page's (R13)", () => {
  const g = click({});
  assert.equal(g.gesture, gestures.GESTURE.PAGE_DEFAULT);
  assert.equal(g.passThrough, true);
  assert.equal(g.preventDefault, false);
});

test("the dead gestures are gone: no Alt-click, no place-caret, no editing toggle", () => {
  const names = Object.keys(gestures.GESTURE).map((k) => gestures.GESTURE[k]);
  for (const dead of ["place_caret", "comment_on_element", "follow_link", "toggle_editing", "send", "extend_selection"]) {
    assert.equal(names.includes(dead), false, `${dead} is dead under D3`);
  }
  // Alt-click in particular does nothing now: it was undiscoverable.
  assert.equal(click({ altKey: true }).gesture, gestures.GESTURE.PAGE_DEFAULT);
});

test("Cmd-Shift-C with a selection comments on the passage", () => {
  const g = key("c", { metaKey: true, shiftKey: true, hasSelection: true });
  assert.equal(g.gesture, gestures.GESTURE.COMMENT_ON_SELECTION);
  assert.equal(g.preventDefault, true);
});

test("Cmd-Shift-C with nothing selected enters element-pick mode (R17)", () => {
  assert.equal(
    key("c", { metaKey: true, shiftKey: true, hasSelection: false }).gesture,
    gestures.GESTURE.ENTER_ELEMENT_PICK
  );
});

test("Ctrl is the same modifier as Cmd, and the letter case does not matter", () => {
  assert.equal(key("C", { ctrlKey: true, shiftKey: true, hasSelection: true }).gesture, gestures.GESTURE.COMMENT_ON_SELECTION);
});

test("Cmd-Shift-C without Shift is not a gesture, so the page keeps Cmd-C", () => {
  const g = key("c", { metaKey: true, shiftKey: false, hasSelection: true });
  assert.equal(g.gesture, gestures.GESTURE.NONE);
  assert.equal(g.passThrough, true);
});

test("Cmd-Shift-E edits the block under the cursor", () => {
  assert.equal(key("e", { metaKey: true, shiftKey: true }).gesture, gestures.GESTURE.EDIT_BLOCK);
});

test("Cmd-Enter marks a comment ready, and only inside a comment box (R7)", () => {
  assert.equal(key("Enter", { metaKey: true, inCommentBox: true }).gesture, gestures.GESTURE.MARK_READY);
  const outside = key("Enter", { metaKey: true, inCommentBox: false });
  assert.equal(outside.gesture, gestures.GESTURE.NONE);
  assert.equal(outside.passThrough, true, "the page's own Cmd-Enter still works");
});

test("Esc commits an open edit, cancels a pick, and is otherwise the page's", () => {
  assert.equal(key("Escape", { editing: true }).gesture, gestures.GESTURE.COMMIT_EDIT);
  assert.equal(key("Escape", { pickMode: true }).gesture, gestures.GESTURE.CANCEL);
  assert.equal(key("Escape", { inCommentBox: true }).gesture, gestures.GESTURE.CANCEL);
  const idle = key("Escape", {});
  assert.equal(idle.gesture, gestures.GESTURE.NONE);
  assert.equal(idle.passThrough, true);
});

test("a click while element-pick mode is open comments on that element", () => {
  const g = click({ pickMode: true });
  assert.equal(g.gesture, gestures.GESTURE.PICK_ELEMENT);
  assert.equal(g.passThrough, false);
});

test("a click outside an open edit commits it AND still reaches the page", () => {
  // R1 names navigation, so clicking a link with an edit open cannot be a
  // losing move: the edit commits and the link is followed.
  const g = click({ editing: true, inEditedBlock: false });
  assert.equal(g.gesture, gestures.GESTURE.COMMIT_EDIT);
  assert.equal(g.passThrough, true);
  assert.equal(g.preventDefault, false);
});

test("a click inside the block being edited is not a commit", () => {
  assert.equal(click({ editing: true, inEditedBlock: true }).gesture, gestures.GESTURE.PAGE_DEFAULT);
});

test("the library's own overlay is never subject to the page's gesture rules", () => {
  assert.equal(click({ inOverlay: true, pickMode: true }).gesture, gestures.GESTURE.NONE);
});

test("ordinary typing is never a library gesture, so the page keeps every key", () => {
  const g = key("a", {});
  assert.equal(g.gesture, gestures.GESTURE.NONE);
  assert.equal(g.passThrough, true);
  assert.equal(g.preventDefault, false);
});

test("every gesture has a hint line with its exact keystroke, because AC6 scores that", () => {
  const lines = gestures.hintLines();
  assert.equal(lines.length, gestures.TABLE.length);
  for (const row of gestures.TABLE) {
    assert.equal(typeof gestures.hintFor(row.gesture), "string");
    assert.equal(gestures.hintFor(row.gesture).length > 0, true);
    assert.equal(typeof row.keys, "string");
    assert.equal(row.keys.length > 0, true);
  }
});

test("the on-card hint is Ken's copy, word for word", () => {
  assert.equal(gestures.hintFor(gestures.GESTURE.MARK_READY), "Cmd-Enter when done with this comment.");
});
