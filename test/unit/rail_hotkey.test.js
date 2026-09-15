// Cmd-Shift-1, the chord that opens and closes the review panel.
//
// What is checked here is the pure half: the gesture table recognizes the press
// however the layout reports it, and refuses the near misses. What the press
// DOES on screen (the panel going away, the pill appearing, where the keyboard
// lands, the preference surviving a reload) is test/browser/rail_hotkey.spec.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const gestures = require("../../src/shared/gestures.js");

function press(extra) {
  return gestures.gestureFor(Object.assign({ type: "keydown" }, extra || {}));
}

test("Cmd-Shift-1 toggles the rail, whichever way the layout reports the key", () => {
  // Three presses of the same physical key. KeyboardEvent.key is "1" without
  // Shift, "!" with Shift on a US layout, and something else again elsewhere;
  // event.code is the physical key in every case.
  const shapes = [
    { name: 'key "1"', event: { key: "1" } },
    { name: 'key "!"', event: { key: "!" } },
    { name: 'code "Digit1"', event: { key: "Dead", code: "Digit1" } }
  ];
  for (const shape of shapes) {
    for (const mod of [{ metaKey: true }, { ctrlKey: true }]) {
      const g = press(Object.assign({ shiftKey: true }, shape.event, mod));
      assert.equal(g.gesture, gestures.GESTURE.TOGGLE_RAIL, shape.name);
      assert.equal(g.passThrough, false, shape.name);
      assert.equal(g.preventDefault, true, shape.name);
    }
  }
});

test("the chord holds in every state, including inside the rail's own fields", () => {
  const states = [
    { name: "on the page", state: {} },
    { name: "with a selection", state: { hasSelection: true } },
    { name: "while a comment box is focused", state: { inCommentBox: true } },
    { name: "while a block is being edited", state: { editing: true } },
    { name: "while element-pick mode is open", state: { pickMode: true } }
  ];
  for (const one of states) {
    const g = press(Object.assign({ key: "1", metaKey: true, shiftKey: true }, one.state));
    assert.equal(g.gesture, gestures.GESTURE.TOGGLE_RAIL, one.name);
  }
});

test("the near misses are the page's: no Shift, no modifier, and the wrong digit", () => {
  const misses = [
    { name: "Cmd-1, which is the browser's first tab", event: { key: "1", metaKey: true } },
    { name: "Shift-1, which is typing an exclamation mark", event: { key: "!", shiftKey: true } },
    { name: "a bare 1", event: { key: "1" } },
    { name: "Cmd-Shift-2", event: { key: "2", metaKey: true, shiftKey: true } },
    { name: "Cmd-Shift-2 by code", event: { key: "@", code: "Digit2", metaKey: true, shiftKey: true } }
  ];
  for (const miss of misses) {
    const g = press(miss.event);
    assert.notEqual(g.gesture, gestures.GESTURE.TOGGLE_RAIL, miss.name);
    assert.equal(g.gesture, gestures.GESTURE.NONE, miss.name);
    assert.equal(g.passThrough, true, miss.name);
    assert.equal(g.preventDefault, false, miss.name);
  }
});

test("the present chord is untouched by the new one", () => {
  const g = press({ key: "x", code: "KeyX", metaKey: true, shiftKey: true });
  assert.equal(g.gesture, gestures.GESTURE.TOGGLE_PRESENT);
});

test("the rail chord is taught on the rail, with its exact keystroke", () => {
  const line = gestures.hintLines().filter((one) => one.keys === "Cmd-Shift-1")[0];
  assert.ok(line, "Cmd-Shift-1 has a hint line");
  assert.match(line.hint, /Cmd-Shift-1/);
  assert.equal(gestures.hintFor(gestures.GESTURE.TOGGLE_RAIL), line.hint);
  assert.equal(gestures.hintLines().length, gestures.TABLE.length);
});
