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

// ---------------------------------------------------------------------------
// Free writing (docs/features/20260928.01_free_writing, plan Task 1.5)
// ---------------------------------------------------------------------------

function chord(code, overrides) {
  return gestures.blockTypeChord(Object.assign({ code: code, key: "x" }, overrides || {}));
}

const MAC = { platform: "mac", metaKey: true };
const OTHER = { platform: "other", ctrlKey: true };

test("the block types, their menu labels and Markdown shortcuts are the plan's", () => {
  assert.deepEqual(
    gestures.BLOCK_TYPES.map((t) => [t.tag, t.label, t.markdown]),
    [
      ["p", "Paragraph", null],
      ["h2", "Heading", "## "],
      ["h3", "Subheading", "### "],
      ["h4", "Small heading", "#### "],
      ["ul", "Bulleted list", "- "],
      ["ol", "Numbered list", "1. "]
    ]
  );
  assert.equal(gestures.OTHER_BLOCK_LABEL, "Other block");
});

test("each chord maps to its tag by event.code on macOS", () => {
  assert.equal(chord("Digit0", Object.assign({ altKey: true }, MAC)), "p");
  assert.equal(chord("Digit2", Object.assign({ altKey: true }, MAC)), "h2");
  assert.equal(chord("Digit3", Object.assign({ altKey: true }, MAC)), "h3");
  assert.equal(chord("Digit4", Object.assign({ altKey: true }, MAC)), "h4");
  assert.equal(chord("Digit8", Object.assign({ shiftKey: true }, MAC)), "ul");
  assert.equal(chord("Digit7", Object.assign({ shiftKey: true }, MAC)), "ol");
});

test("each chord maps to its tag by event.code on Windows and Linux", () => {
  assert.equal(chord("Digit0", Object.assign({ shiftKey: true }, OTHER)), "p");
  assert.equal(chord("Digit2", Object.assign({ shiftKey: true }, OTHER)), "h2");
  assert.equal(chord("Digit3", Object.assign({ shiftKey: true }, OTHER)), "h3");
  assert.equal(chord("Digit4", Object.assign({ shiftKey: true }, OTHER)), "h4");
  assert.equal(chord("Digit8", Object.assign({ shiftKey: true }, OTHER)), "ul");
  assert.equal(chord("Digit7", Object.assign({ shiftKey: true }, OTHER)), "ol");
});

test("a macOS event with code Digit2 and key ™ matches", () => {
  assert.equal(chord("Digit2", Object.assign({ altKey: true, key: "™" }, MAC)), "h2");
});

test("an event with AltGraph on never matches, nor does Ctrl-Alt with a digit on Windows", () => {
  assert.equal(chord("Digit2", Object.assign({ shiftKey: true, altGraph: true }, OTHER)), null);
  assert.equal(chord("Digit2", Object.assign({ altKey: true, altGraph: true }, MAC)), null);
  assert.equal(chord("Digit2", { platform: "other", ctrlKey: true, altKey: true }), null);
  assert.equal(chord("Digit2", { platform: "other", ctrlKey: true, altKey: true, shiftKey: true }), null);
});

test("the wrong modifier on a system is not a chord", () => {
  assert.equal(chord("Digit2", { platform: "mac", ctrlKey: true, shiftKey: true }), null);
  assert.equal(chord("Digit2", { platform: "other", metaKey: true, altKey: true }), null);
  assert.equal(chord("Digit2", { platform: "mac", metaKey: true }), null, "Cmd-2 alone is the browser's tab switch");
  assert.equal(chord("Digit1", Object.assign({ shiftKey: true }, MAC)), null);
  assert.equal(chord("Digit1", Object.assign({ shiftKey: true }, OTHER)), null);
});

test("no chord collides with Cmd-Shift-E, C, X, 1, or the macOS screenshot keys", () => {
  const macChords = gestures.BLOCK_TYPES.map((t) => t.chords.mac);
  for (const taken of ["Cmd-Shift-E", "Cmd-Shift-C", "Cmd-Shift-X", "Cmd-Shift-1", "Cmd-Shift-3", "Cmd-Shift-4", "Cmd-Shift-5"]) {
    assert.equal(macChords.includes(taken), false, taken);
  }
  for (const code of ["KeyE", "KeyC", "KeyX", "Digit1", "Digit3", "Digit4", "Digit5"]) {
    assert.equal(chord(code, Object.assign({ shiftKey: true }, MAC)), null, "Cmd-Shift " + code);
  }
  // And the library's own gestures still win their chords.
  assert.equal(key("e", { metaKey: true, shiftKey: true, code: "KeyE" }).gesture, gestures.GESTURE.EDIT_BLOCK);
});

test("each menu row names its chord for the reviewer's system", () => {
  const h2 = gestures.BLOCK_TYPES.find((t) => t.tag === "h2");
  assert.equal(h2.chords.mac, "Cmd-Option-2");
  assert.equal(h2.chords.other, "Ctrl-Shift-2");
  assert.equal(gestures.chordLabelFor("ul", "mac"), "Cmd-Shift-8");
  assert.equal(gestures.chordLabelFor("ol", "other"), "Ctrl-Shift-7");
});

test("a Markdown shortcut at the start of a block names its type", () => {
  // Markdown's own levels (flow walk, design problem 5): "## " is h2, as it
  // is in the source. "# " makes h2 too, because the body has no h1: the
  // page title is the h1.
  assert.equal(gestures.markdownShortcutFor("# "), "h2");
  assert.equal(gestures.markdownShortcutFor("## "), "h2");
  assert.equal(gestures.markdownShortcutFor("### "), "h3");
  assert.equal(gestures.markdownShortcutFor("#### "), "h4");
  assert.equal(gestures.markdownShortcutFor("- "), "ul");
  assert.equal(gestures.markdownShortcutFor("* "), "ul");
  assert.equal(gestures.markdownShortcutFor("1. "), "ol");
  assert.equal(gestures.markdownShortcutFor("#"), null, "only once the space is typed");
  assert.equal(gestures.markdownShortcutFor("##### "), null, "headings stop at h4");
  assert.equal(gestures.markdownShortcutFor("a # "), null, "only at the start of a block");
  assert.equal(gestures.markdownShortcutFor("2. "), null);
});

test("Enter at the end of a block makes a sibling; Enter mid-block splits", () => {
  assert.equal(gestures.enterIntentFor({ atEnd: true }), gestures.ENTER.SIBLING);
  assert.equal(gestures.enterIntentFor({ atEnd: false }), gestures.ENTER.SPLIT);
});

test("Shift-Enter stays a line break", () => {
  assert.equal(gestures.enterIntentFor({ atEnd: true, shiftKey: true }), gestures.ENTER.LINE);
  assert.equal(gestures.enterIntentFor({ inListItem: true, shiftKey: true }), gestures.ENTER.LINE);
});

test("Enter in an empty last item ends the list; elsewhere in a list it adds an item", () => {
  assert.equal(gestures.enterIntentFor({ inListItem: true, itemEmpty: true, lastItem: true }), gestures.ENTER.END_LIST);
  assert.equal(gestures.enterIntentFor({ inListItem: true, itemEmpty: false, lastItem: true, atEnd: true }), gestures.ENTER.NEW_ITEM);
  assert.equal(gestures.enterIntentFor({ inListItem: true, itemEmpty: true, lastItem: false }), gestures.ENTER.NEW_ITEM);
});

test("Enter where a run cannot go keeps today's break rule", () => {
  assert.equal(gestures.enterIntentFor({ atEnd: true, runAllowed: false }), gestures.ENTER.BREAK_RULE);
});

test("Backspace at a block start merges into the block before, inside the session", () => {
  assert.equal(gestures.edgeDeleteFor({ key: "Backspace", collapsed: true, atBlockStart: true, firstBlock: false }), gestures.EDGE.MERGE_PREVIOUS);
  assert.equal(gestures.edgeDeleteFor({ key: "Backspace", collapsed: true, atBlockStart: false }), null, "mid-block is ordinary typing");
});

test("Delete at a block end merges the next block in", () => {
  assert.equal(gestures.edgeDeleteFor({ key: "Delete", collapsed: true, atBlockEnd: true, lastBlock: false }), gestures.EDGE.MERGE_NEXT);
});

test("Backspace or Delete at the session's own edge is refused, so no page block outside it changes", () => {
  assert.equal(gestures.edgeDeleteFor({ key: "Backspace", collapsed: true, atBlockStart: true, firstBlock: true }), gestures.EDGE.REFUSE);
  assert.equal(gestures.edgeDeleteFor({ key: "Delete", collapsed: true, atBlockEnd: true, lastBlock: true }), gestures.EDGE.REFUSE);
});

test("a selection across blocks is deleted by the layer, with either key", () => {
  assert.equal(gestures.edgeDeleteFor({ key: "Backspace", collapsed: false, spansBlocks: true }), gestures.EDGE.DELETE_SELECTION);
  assert.equal(gestures.edgeDeleteFor({ key: "Delete", collapsed: false, spansBlocks: true }), gestures.EDGE.DELETE_SELECTION);
  assert.equal(gestures.edgeDeleteFor({ key: "Delete", collapsed: false, spansBlocks: false }), null);
});

test("Cmd-Z and Shift-Cmd-Z walk the session's own history", () => {
  assert.equal(gestures.historyIntentFor({ code: "KeyZ", key: "z", metaKey: true, editing: true }), gestures.HISTORY.UNDO);
  assert.equal(gestures.historyIntentFor({ code: "KeyZ", key: "z", metaKey: true, shiftKey: true, editing: true }), gestures.HISTORY.REDO);
  assert.equal(gestures.historyIntentFor({ code: "KeyZ", key: "z", ctrlKey: true, editing: true }), gestures.HISTORY.UNDO);
  assert.equal(gestures.historyIntentFor({ code: "KeyY", key: "y", ctrlKey: true, editing: true, platform: "other" }), gestures.HISTORY.REDO);
  assert.equal(gestures.historyIntentFor({ inputType: "historyUndo", editing: true }), gestures.HISTORY.UNDO);
  assert.equal(gestures.historyIntentFor({ inputType: "historyRedo", editing: true }), gestures.HISTORY.REDO);
  assert.equal(gestures.historyIntentFor({ code: "KeyZ", key: "z", metaKey: true, editing: false }), null, "outside a session it is not the session's");
});

test("Cmd-Shift-E with the caret in no block enters edit state with no block open", () => {
  const g = key("e", { metaKey: true, shiftKey: true, inBlock: false });
  assert.equal(g.gesture, gestures.GESTURE.ENTER_EDIT_STATE);
  assert.equal(g.preventDefault, true);
  assert.equal(key("e", { metaKey: true, shiftKey: true, inBlock: true }).gesture, gestures.GESTURE.EDIT_BLOCK);
});

test("Esc with the block menu open closes only the menu", () => {
  const g = key("Escape", { editing: true, blockMenuOpen: true });
  assert.equal(g.gesture, gestures.GESTURE.CLOSE_MENU);
  assert.equal(g.preventDefault, true);
});

test("otherwise Esc commits any open session and leaves edit state", () => {
  assert.equal(key("Escape", { editing: true }).gesture, gestures.GESTURE.COMMIT_EDIT);
  assert.equal(key("Escape", { editState: true, editing: false }).gesture, gestures.GESTURE.COMMIT_EDIT);
});

test("the hint for edit state with no block open is the pinned text", () => {
  assert.equal(gestures.hintFor(gestures.GESTURE.ENTER_EDIT_STATE), "Click + Write here to add text. Esc to finish.");
  const row = gestures.TABLE.find((r) => r.gesture === gestures.GESTURE.ENTER_EDIT_STATE);
  assert.equal(row.keys, "Cmd-Shift-E");
  assert.equal(row.when, "the cursor is in no block");
});
