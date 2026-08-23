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

// ---------------------------------------------------------------------------
// What an undo leaves behind
// ---------------------------------------------------------------------------
//
// The bug all of this comes from: undo removed the record from browser storage
// and told nobody. review.json still listed it as ready work, so the agent
// applied an edit the reviewer had taken back.
//
// Undo itself always runs, on every state. What changes is what it leaves: a
// record nothing landed for is dropped from both stores, and a HANDLED one is
// kept while the undo mints the work of taking the change back out of the
// source. The page half (revert the region, put the caret in it) is a browser
// test; what is here is what needs no page.

const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");
const protocol = require("../../src/shared/protocol.js");
const lifecycle = require("../../src/shared/lifecycle.js");

const REVIEW = "review-undo";

function handEdit(state) {
  return record.newItem({
    kind: record.KIND.EDIT,
    state: state,
    before: "Warm up for ten minutes.",
    after: "Warm up for fifteen minutes.",
    page_origin: "http://127.0.0.1:4000",
    page_path: "/plan"
  });
}

function undoHarness() {
  const store = storeModule.createStore();
  const sync = syncModule.createSync({
    review: REVIEW,
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: null
  });
  const surface = editing.createEditing({ document: null, reviewId: REVIEW, store: store, sync: sync });
  return { store, sync, surface };
}

function deletes(store) {
  return store.pendingEvents(REVIEW).filter((event) => event.event === protocol.EVENT.ITEM_DELETED);
}

test("which states an undo drops the record for, and the one it does not", () => {
  // lifecycle.canDelete, called for the first time by production code, and read
  // as a BRANCH rather than as a refusal: undo runs either way.
  const R = lifecycle.ACTOR.REVIEWER;
  assert.equal(lifecycle.canDelete(record.STATE.DRAFT, R), true, "nothing landed, so nothing is left behind");
  assert.equal(lifecycle.canDelete(record.STATE.READY, R), true);
  assert.equal(lifecycle.canDelete(record.STATE.NOT_HANDLED, R), true, "the agent said it did not do it");
  // The one no. The source carries the change, so the undo mints the work of
  // removing it instead of dropping the record that says it is there.
  assert.equal(lifecycle.canDelete(record.STATE.HANDLED, R), false);
});

test("undoing the same handled edit twice does not ask for the change to be removed twice", (t) => {
  const { store, sync, surface } = undoHarness();
  t.after(() => sync.stop());

  const item = handEdit(record.STATE.HANDLED);
  store.write(REVIEW, item);
  sync.recordItem(item);
  // The take-back the first undo made. The record it names is still there, so
  // the row is still pressable, and a second press must not queue a second ask.
  store.write(REVIEW, record.revertOf(item));

  const got = surface.undo(item.id);
  assert.equal(got.reverted, false);
  assert.equal(got.reason, editing.UNDO_ALREADY_TAKEN_BACK);
  assert.equal(got.revert, null);
  assert.ok(store.readItem(REVIEW, item.id), "and the handled record is still the record that a fix landed");
  assert.equal(deletes(store).length, 0, "a handled record is never deleted from the helper");
});

test("a record the reviewer takes back is taken back from the helper too", (t) => {
  const { store, sync, surface } = undoHarness();
  t.after(() => sync.stop());

  // retire() is undo's own seam, minus the write to the page: both drop the
  // record, and both go through the one removal path. The page half of undo
  // needs a real region, so it is asserted in the browser
  // (test/browser/undo_reaches_helper.spec.js), and so is the take-back a
  // handled edit mints.
  const item = handEdit(record.STATE.READY);
  store.write(REVIEW, item);
  sync.recordItem(item);

  const got = surface.retire(item.id);
  assert.equal(got.retired, true);
  assert.equal(store.readItem(REVIEW, item.id), null, "the browser dropped it");

  const posted = deletes(store);
  assert.equal(posted.length, 1, "and the helper is told, or review.json keeps offering the agent work nobody wants");
  assert.equal(posted[0].item, item.id);
  assert.equal(posted[0].rev, item.rev);
});

test("a draft taken back before its first flush posts nothing at all", (t) => {
  const { store, sync, surface } = undoHarness();
  t.after(() => sync.stop());

  // Never handed to sync, so the helper has never heard of it and a delete
  // naming it would be a line about nothing. The log stays honest either way.
  const item = handEdit(record.STATE.DRAFT);
  store.write(REVIEW, item);

  assert.equal(surface.retire(item.id).retired, true);
  assert.equal(store.pendingEvents(REVIEW).length, 0);
});

// ---------------------------------------------------------------------------
// What Enter means, and what it writes
// ---------------------------------------------------------------------------
//
// The layer decides both, because the engines do not agree. Measured on
// 2026-08-23 with the same keystroke in the same bare `<p contenteditable>`:
// Enter writes a nested block in Chromium and WebKit and a <br> in Firefox, and
// Shift-Enter writes a <br> in Chromium and Firefox and a nested block in
// WebKit. Read back through the normalizer, that is the reviewer's "new
// paragraph" reaching the agent as a line break in one browser and their "new
// line" reaching it as a paragraph break in another.
//
// The browser half is test/browser/paragraph_break.spec.js, which drives the
// real keystroke in all three engines. What is here is the decision.

test("Enter is a paragraph break and Shift-Enter is a line break, in every engine", () => {
  assert.equal(gestures.breakIntentFor({ inputType: "insertParagraph" }), gestures.BREAK.PARAGRAPH);
  assert.equal(gestures.breakIntentFor({ inputType: "insertLineBreak" }), gestures.BREAK.LINE);

  // THE WEBKIT QUIRK. WebKit reports Shift-Enter as `insertParagraph`, the same
  // value it reports for a bare Enter, so inputType alone cannot tell the two
  // gestures apart. The Shift state of the keydown that produced it can.
  assert.equal(
    gestures.breakIntentFor({ inputType: "insertParagraph", shiftKey: true }),
    gestures.BREAK.LINE,
    "Shift-Enter is a line break even when the engine calls it insertParagraph"
  );
  // Shift on the other spelling changes nothing: it already says line break.
  assert.equal(gestures.breakIntentFor({ inputType: "insertLineBreak", shiftKey: true }), gestures.BREAK.LINE);
});

test("nothing but a break is intercepted: ordinary typing stays the engine's", () => {
  assert.equal(gestures.breakIntentFor({ inputType: "insertText" }), null);
  assert.equal(gestures.breakIntentFor({ inputType: "deleteContentBackward" }), null);
  assert.equal(gestures.breakIntentFor({ inputType: "insertFromPaste" }), null);
  assert.equal(gestures.breakIntentFor({ inputType: "insertCompositionText" }), null);
  assert.equal(gestures.breakIntentFor({}), null);
  assert.equal(gestures.breakIntentFor(null), null);
});

test("the markup each break writes reads back through the normalizer as that break", () => {
  const normalize = require("../../src/shared/normalize.js");
  const HEAD = "Runners come back too fast after a layoff. ";
  const TAIL = "Most of them know it while they are doing it.";

  // A paragraph break is a real block boundary, so the blank line comes off the
  // STRUCTURE rather than off a newline count.
  const para = editing.breakMarkup(gestures.BREAK.PARAGRAPH, HEAD, TAIL);
  assert.equal(editing.breakShapeFor(gestures.BREAK.PARAGRAPH).tag, "p");
  assert.equal(normalize.blockText(para), HEAD.trim() + "\n\n" + TAIL);

  const line = editing.breakMarkup(gestures.BREAK.LINE, HEAD, TAIL);
  assert.equal(editing.breakShapeFor(gestures.BREAK.LINE).tag, "br");
  assert.equal(normalize.blockText(line), HEAD.trim() + "\n" + TAIL);

  // Through the path a record actually takes: cleanMarkup first, because that
  // is what capture() runs before it reads the text.
  assert.equal(normalize.blockText(normalize.cleanMarkup(para)), HEAD.trim() + "\n\n" + TAIL);
  assert.equal(normalize.blockText(normalize.cleanMarkup(line)), HEAD.trim() + "\n" + TAIL);

  assert.equal(editing.breakShapeFor("something else"), null);
});

test("each break is a change, and the change line names the one the reviewer typed", () => {
  const HEAD = "Runners come back too fast after a layoff. ";
  const TAIL = "Most of them know it while they are doing it.";
  const before = captured(HEAD + TAIL, "<p>" + HEAD + TAIL + "</p>");

  const para = captured(HEAD + TAIL, "<p>" + editing.breakMarkup(gestures.BREAK.PARAGRAPH, HEAD, TAIL) + "</p>");
  const paraVerdict = editing.kindFor(before, para);
  assert.equal(paraVerdict.changed, true);
  assert.equal(
    record.editChangeText(paraVerdict.kind, before.text, para.text),
    record.BREAK_ADDED_PARAGRAPH
  );

  const line = captured(HEAD + TAIL, "<p>" + editing.breakMarkup(gestures.BREAK.LINE, HEAD, TAIL) + "</p>");
  const lineVerdict = editing.kindFor(before, line);
  assert.equal(lineVerdict.changed, true);
  assert.equal(record.editChangeText(lineVerdict.kind, before.text, line.text), record.BREAK_ADDED_LINE);
});

test("a break with nothing after it is not a change to the document", () => {
  // Enter at the end of a block. The empty tail carries a <br> so the reviewer
  // has a line to be on, and the padding <br> a line break leaves at the end of
  // a block is the same story. Neither is a second paragraph, so neither is an
  // edit: recording one would put a row in the rail and a line in the agent's
  // queue for a change that does not exist.
  const WORDS = "Runners come back too fast after a layoff.";
  const before = captured(WORDS, "<p>" + WORDS + "</p>");
  const trailingPara = captured(WORDS, "<p>" + WORDS + "<p><br></p></p>");
  const trailingLine = captured(WORDS, "<p>" + WORDS + "<br><br></p>");

  assert.equal(editing.kindFor(before, trailingPara).changed, false);
  assert.equal(editing.kindFor(before, trailingLine).changed, false);
});
