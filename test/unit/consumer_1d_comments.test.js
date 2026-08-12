// THROWAWAY STUB CONSUMER: 1D (comments and gestures)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 1D (comments and gestures), which is
// the single reason that task exists. It calls every kernel signature 1D (comments and gestures)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 1D (comments and gestures)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 1D (comments and gestures) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const gestures = require("../../src/shared/gestures.js");
const commentsModule = require("../../src/layer/comments.js");
const storeModule = require("../../src/layer/store.js");

const PAGE = { origin: "http://localhost:3000", path: "/clients", title: "Clients", seq: 1, source_hint: null };

test("1D can open a comment box that stores a draft on every keystroke", () => {
  const store = storeModule.createStore();
  const comments = commentsModule.createComments({ store: store, reviewId: "rev_1", document: null });
  const box = comments.openBox({ page: PAGE, quote: "The trainer writes the plan." });

  assert.equal(box.item.state, record.STATE.DRAFT);
  assert.equal(box.item.context.quote, "The trainer writes the plan.");

  box.type("this says the opp");
  assert.equal(store.readItem("rev_1", box.id).note, "this says the opp");
  box.type("this says the opposite");
  assert.equal(store.readItem("rev_1", box.id).note, "this says the opposite");
  assert.equal(store.readItem("rev_1", box.id).rev, 1, "a draft does not bump rev");
});

test("1D can mark a comment ready, and rewording after that bumps the revision", () => {
  const store = storeModule.createStore();
  const comments = commentsModule.createComments({ store: store, reviewId: "rev_1", document: null });
  const box = comments.openBox({ page: PAGE, quote: "q" });
  box.type("say this instead");
  box.markReady();
  assert.equal(store.readItem("rev_1", box.id).state, record.STATE.READY);
  box.type("no, say this instead");
  assert.equal(store.readItem("rev_1", box.id).rev, 2);
});

test("1D can make an untethered note and an element comment as their own kinds", () => {
  const store = storeModule.createStore();
  const comments = commentsModule.createComments({ store: store, reviewId: "rev_1", document: null });
  const note = comments.openBox({ page: PAGE, kind: record.KIND.NOTE });
  assert.equal(note.item.kind, record.KIND.NOTE);
  assert.equal(note.item.context.quote, null);
  assert.equal(typeof comments.enterPickMode().active, "boolean");
});

test("1D's gestures are the ones D3 names, and each has a hint line", () => {
  const sel = gestures.gestureFor({ type: "keydown", key: "c", metaKey: true, shiftKey: true, hasSelection: true });
  assert.equal(sel.gesture, gestures.GESTURE.COMMENT_ON_SELECTION);
  const pick = gestures.gestureFor({ type: "keydown", key: "c", metaKey: true, shiftKey: true, hasSelection: false });
  assert.equal(pick.gesture, gestures.GESTURE.ENTER_ELEMENT_PICK);
  const ready = gestures.gestureFor({ type: "keydown", key: "Enter", metaKey: true, inCommentBox: true });
  assert.equal(ready.gesture, gestures.GESTURE.MARK_READY);
  assert.equal(gestures.hintFor(ready.gesture), "Cmd-Enter when done with this comment.");
  assert.equal(gestures.hintLines().length, gestures.TABLE.length);
});

test("a comment box closes with the draft kept, never discarded", () => {
  const store = storeModule.createStore();
  const comments = commentsModule.createComments({ store: store, reviewId: "rev_1", document: null });
  const box = comments.openBox({ page: PAGE, quote: "q" });
  box.type("half a thought");
  box.close();
  assert.equal(store.readItem("rev_1", box.id).note, "half a thought");
});
