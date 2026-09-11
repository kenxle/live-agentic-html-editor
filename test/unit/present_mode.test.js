// Present mode, without a browser: the chord, and the choice being remembered.
//
// The on-screen half (the surface going display:none, the washes emptying, the
// gestures disarmed) is test/browser/present_mode.spec.js. What is checked here
// is the two pieces that are pure: the gesture table's new row, and the
// preference round trip through the store and the rail.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const gestures = require("../../src/shared/gestures.js");
const overlay = require("../../src/layer/overlay.js");
const storeModule = require("../../src/layer/store.js");

function memoryBacking() {
  const values = Object.create(null);
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
    setItem: (key, value) => {
      values[key] = String(value);
    },
    removeItem: (key) => {
      delete values[key];
    },
    key: (index) => Object.keys(values)[index] ?? null,
    get length() {
      return Object.keys(values).length;
    }
  };
}

test("Cmd-Shift-X is the show/hide chord, in both directions and in any state", () => {
  const both = [
    { name: "on the page", state: {} },
    { name: "with a selection", state: { hasSelection: true } },
    { name: "while a comment box is focused", state: { inCommentBox: true } },
    { name: "while a block is being edited", state: { editing: true } },
    { name: "while element-pick mode is open", state: { pickMode: true } }
  ];
  both.forEach((shape) => {
    const got = gestures.gestureFor(
      Object.assign({ type: "keydown", key: "x", metaKey: true, shiftKey: true }, shape.state)
    );
    assert.equal(got.gesture, gestures.GESTURE.TOGGLE_PRESENT, shape.name);
    assert.equal(got.preventDefault, true);
    assert.equal(got.passThrough, false);
  });
  // Ctrl is the same chord off macOS, and the letter's case is the layout's.
  assert.equal(
    gestures.gestureFor({ type: "keydown", key: "X", ctrlKey: true, shiftKey: true }).gesture,
    gestures.GESTURE.TOGGLE_PRESENT
  );
});

test("the chord takes nothing away from the gestures that were already there", () => {
  const table = [
    [{ key: "c", metaKey: true, shiftKey: true, hasSelection: true }, gestures.GESTURE.COMMENT_ON_SELECTION],
    [{ key: "c", metaKey: true, shiftKey: true }, gestures.GESTURE.ENTER_ELEMENT_PICK],
    [{ key: "e", metaKey: true, shiftKey: true }, gestures.GESTURE.EDIT_BLOCK],
    [{ key: "Enter", metaKey: true, inCommentBox: true }, gestures.GESTURE.MARK_READY],
    [{ key: "Escape", pickMode: true }, gestures.GESTURE.CANCEL],
    // X without the modifiers is typing, and stays the page's.
    [{ key: "x" }, gestures.GESTURE.NONE],
    [{ key: "x", shiftKey: true }, gestures.GESTURE.NONE],
    [{ key: "x", metaKey: true }, gestures.GESTURE.NONE]
  ];
  table.forEach(([shape, expected]) => {
    assert.equal(gestures.gestureFor(Object.assign({ type: "keydown" }, shape)).gesture, expected, shape.key);
  });
});

test("the chord is taught on the rail, like every other gesture", () => {
  const line = gestures.hintLines().filter((one) => one.keys === "Cmd-Shift-X")[0];
  assert.ok(line, "it has a hint line");
  assert.match(line.hint, /hide the review/i);
  assert.match(line.hint, /again to bring it back/i);
  assert.equal(gestures.hintLines().length, gestures.TABLE.length);
});

test("the reviewer's choice to present is remembered per review", () => {
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });

  const rail = overlay.createRail({ document: null, store: store, reviewId: "review-a" });
  assert.equal(rail.isPresenting(), false, "a review starts with the library on screen");

  rail.setPresenting(true);
  assert.equal(store.readUiPreferences("review-a").present, true);
  assert.equal(
    overlay.createRail({ document: null, store: store, reviewId: "review-a" }).isPresenting(),
    true,
    "a reload mid-talk stays hidden"
  );
  assert.equal(
    overlay.createRail({ document: null, store: store, reviewId: "review-b" }).isPresenting(),
    false,
    "another review keeps the default"
  );

  rail.setPresenting(false);
  assert.equal(
    overlay.createRail({ document: null, store: store, reviewId: "review-a" }).isPresenting(),
    false,
    "and coming back out is remembered too"
  );
});

test("hiding the library does not forget the rail's other preferences", () => {
  // The bucket is written whole, so the risk is real: hiding the library once
  // and finding the rail back at its default width is the bug this pins.
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });
  store.writeUiPreferences("review-a", { collapsed: true, width: 520 });

  const rail = overlay.createRail({ document: null, store: store, reviewId: "review-a" });
  rail.setPresenting(true);

  const kept = store.readUiPreferences("review-a");
  assert.equal(kept.present, true);
  assert.equal(kept.collapsed, true);
  assert.equal(kept.width, 520);
  // The pill's corner is not in this: a headless rail reads it when it MOUNTS,
  // so there is none to carry here. test/browser/present_mode.spec.js is where
  // a real rail with a real pill goes into present mode and comes back.
});

test("a page can ask to start hidden, and the chord is what comes after", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  // What boot passes when the script tag carries data-lahe-start="hidden".
  const rail = overlay.createRail({ document: null, store: store, reviewId: "review-a", present: true });
  assert.equal(rail.isPresenting(), true);

  const seen = [];
  rail.onPresent((presenting) => seen.push(presenting));
  assert.equal(rail.setPresenting(), false, "no argument toggles, which is what the chord does");
  assert.equal(rail.setPresenting(), true);
  assert.deepEqual(seen, [false, true], "and whoever arms the gestures is told both times");
});
