// The parts of the edit surface that are decisions rather than DOM.
//
// Everything that needs a caret, a repaint, or a real keystroke is a browser
// test (test/browser/editing_*.spec.js), because those are the mechanisms under
// test and there is no honest way to check them without a browser. What is here
// is the small pure core three callers would otherwise each re-decide: what
// counts as a change, which commands exist, and what a capture keeps.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const editing = require("../../src/layer/editing.js");
const record = require("../../src/shared/record.js");
const gestures = require("../../src/shared/gestures.js");

// capture() reads exactly two properties, so a plain object stands in for an
// element here without pretending to be one.
function block(text, html) {
  return { textContent: text, innerHTML: html === undefined ? text : html };
}

// What a real session compares: two captures, not two raw elements.
function captured(text, html) {
  return editing.capture(block(text, html));
}

test("capture keeps the reviewer's words, and reads the block the way it renders", () => {
  const got = editing.capture(block("Warm up  for ten minutes.", 'Warm up  for <span data-lahe="wrap">ten</span> minutes.'));
  // The words are untouched. The double space is not a word: the page renders
  // it as one space, so the record says what the reviewer is looking at.
  assert.equal(got.text, "Warm up for ten minutes.");
  // The one direction that is required: nothing the library added reaches a
  // record (R23, R33). The wrapper goes, its contents stay.
  assert.equal(got.html.includes("data-lahe"), false);
  assert.equal(got.html.includes("ten"), true);
});

test("capture keeps a break the reviewer typed, in every shape Chrome writes it", () => {
  // Enter in the middle of a paragraph, as Chromium actually writes it into a
  // contenteditable block: a nested <p> and an &nbsp;. textContent reads this
  // as "Hello world.", identical to the text before the break, which is how the
  // whole edit used to be thrown away as a no-op.
  const split = editing.capture(block("Hello world.", "Hello<p>&nbsp;world.</p>"));
  assert.equal(split.text, "Hello\n\nworld.", "a paragraph break is a blank line");

  // Shift-Enter, which writes a <br>.
  const line = editing.capture(block("Hello world.", "Hello<br>&nbsp;world."));
  assert.equal(line.text, "Hello\nworld.", "a line break is one newline");

  // Enter at the end, then typing: two paragraphs.
  const two = editing.capture(block("Hello world.Second para.", "Hello world.<p>Second para.</p>"));
  assert.equal(two.text, "Hello world.\n\nSecond para.");
});

test("a typed break is a change; a rewrapped line is not", () => {
  // The crux. Both halves have to hold at once, or the tool either drops the
  // reviewer's break or reports a change every time a source is reformatted.
  const plain = captured("Hello world.", "<p>Hello world.</p>");
  const rewrapped = captured("Hello\n   world.", "<p>Hello\n   world.</p>");
  const broken = captured("Hello world.", "<p>Hello<p>&nbsp;world.</p></p>");

  assert.equal(editing.kindFor(plain, rewrapped).changed, false, "reformatting the source is not an edit");
  const verdict = editing.kindFor(plain, broken);
  assert.equal(verdict.changed, true, "the break the reviewer typed is an edit");
  assert.equal(verdict.kind, record.KIND.EDIT);
  // And the change line says so in words, rather than quoting an invisible
  // character at the reviewer.
  assert.equal(record.editChangeText(verdict.kind, plain.text, broken.text), record.BREAK_ADDED_PARAGRAPH);
});

test("capture of nothing is nulls, not empty strings", () => {
  assert.deepEqual(editing.capture(null), { text: null, html: null });
});

test("a change in text is an edit", () => {
  const got = editing.kindFor(
    captured("Runners come back too fast."),
    captured("Runners come back too fast, mostly.")
  );
  assert.equal(got.changed, true);
  assert.equal(got.kind, record.KIND.EDIT);
});

test("a change in markup alone is a change, and it is its own kind (R31)", () => {
  const before = captured("Warm up for ten minutes.", "Warm up for ten minutes.");
  const after = captured("Warm up for ten minutes.", "Warm up for <strong>ten</strong> minutes.");
  const got = editing.kindFor(before, after);
  assert.equal(got.changed, true, "a formatting-only change is still a change");
  assert.equal(got.kind, record.KIND.FORMAT_ONLY);
  // And the kind is what makes replay compare it on structure: comparing its
  // text would make the whole record a silent no-op, because its `after` text
  // is identical to its `before` by construction.
  const item = record.newItem({
    kind: got.kind,
    page_origin: "http://127.0.0.1",
    page_path: "/x",
    before: before.text,
    after: after.text,
    before_html: before.html,
    after_html: after.html
  });
  assert.equal(record.comparisonFields(item).after, record.FIELD.AFTER_HTML);
});

test("re-indented markup with the same words is not a change at all", () => {
  // A page that reformats its own HTML must not look like the reviewer edited
  // it. This is the assertion that stops every repaint minting a record.
  const got = editing.kindFor(
    captured("Warm up for ten minutes.", "Warm up for ten minutes."),
    captured("Warm up   for ten\n  minutes.", "Warm up   for ten\n  minutes.")
  );
  assert.equal(got.changed, false);
  assert.equal(got.kind, null);
});

test("the formatting commands are closed to the two R24 allows for v1", () => {
  assert.deepEqual(Object.keys(editing.COMMANDS).sort(), ["bold", "italic"]);
  const surface = editing.createEditing({ document: null, reviewId: "r1" });
  assert.throws(
    () => surface.format("insertHorizontalRule"),
    /not one of the commands R24 allows/,
    "a command this tool never decided to support is refused, not passed through"
  );
});

test("styleWithCSS is off at boot, because R35 forbids writing a style attribute", () => {
  const boot = editing.BOOT_COMMANDS.filter((row) => row.command === "styleWithCSS");
  assert.equal(boot.length, 1);
  assert.equal(boot[0].value, false);
});

test("the editable surface has the platform's rewriting turned off", () => {
  const attrs = editing.EDITABLE_ATTRS;
  assert.equal(attrs.contenteditable, "true");
  assert.equal(attrs.spellcheck, "false");
  assert.equal(attrs.autocorrect, "off");
  assert.equal(attrs.autocapitalize, "off");
});

test("entry and exit come from the one gesture table, not from this file", () => {
  assert.equal(
    gestures.gestureFor({ type: "keydown", key: "e", metaKey: true, shiftKey: true }).gesture,
    gestures.GESTURE.EDIT_BLOCK
  );
  // The `when` column is the whole defence against the blur double-commit:
  // COMMIT_EDIT applies only while a block is in edit state.
  assert.equal(
    gestures.gestureFor({ type: "keydown", key: "Escape", editing: true }).gesture,
    gestures.GESTURE.COMMIT_EDIT
  );
  assert.equal(
    gestures.gestureFor({ type: "keydown", key: "Enter", editing: true, metaKey: true }).gesture,
    gestures.GESTURE.COMMIT_EDIT
  );
  assert.equal(
    gestures.gestureFor({ type: "keydown", key: "Enter", editing: true, ctrlKey: true }).gesture,
    gestures.GESTURE.COMMIT_EDIT
  );
  assert.notEqual(
    gestures.gestureFor({ type: "keydown", key: "Escape", editing: false }).gesture,
    gestures.GESTURE.COMMIT_EDIT
  );
  const outside = gestures.gestureFor({ type: "click", editing: true, inEditedBlock: false });
  assert.equal(outside.gesture, gestures.GESTURE.COMMIT_EDIT);
  assert.equal(outside.passThrough, true, "the page still gets the click, so navigation is not a losing move");
});

test("committing nothing, with nothing open, does nothing", () => {
  const surface = editing.createEditing({ document: null, reviewId: "r1" });
  assert.equal(surface.isEditing(), false);
  assert.equal(surface.commit({ reason: "escape" }), null);
  assert.equal(surface.state().open, false);
});

test("undoing a record that does not exist says so rather than reporting success", () => {
  const storeModule = require("../../src/layer/store.js");
  const surface = editing.createEditing({
    document: null,
    reviewId: "r1",
    store: storeModule.createStore()
  });
  const got = surface.undo("itm_nope");
  assert.equal(got.reverted, false);
  assert.match(got.reason, /no record/);
});
