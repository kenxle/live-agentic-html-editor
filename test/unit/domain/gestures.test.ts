/*
 * read-when: Changing src/domain/gestures.ts, or when one of these tests fails.
 * not-for: What a key does on screen; see test/browser/rail_hotkey.spec.js and its neighbours.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  BLOCK_TYPES,
  BREAK,
  EDGE,
  ENTER,
  FORMAT,
  FORMAT_COMMANDS,
  GESTURE,
  HISTORY,
  OTHER_BLOCK_LABEL,
  SEND_KEY,
  TABLE,
  blockTypeChord,
  blockTypeLabel,
  breakIntentFor,
  chordLabelFor,
  edgeDeleteFor,
  enterIntentFor,
  formatIntentFor,
  gestureFor,
  hintFor,
  hintLines,
  historyIntentFor,
  isScrollbarPress,
  isSendEvent,
  isSendPress,
  markdownShortcutFor,
  normalizeSendKey,
  panelLines,
  sendKeyLabel
} from "../../../src/domain/gestures.ts";
import type {
  ChordInput,
  Gesture,
  GestureDecision,
  GestureInput,
  HintLine,
  Modifiers,
  ReviewState
} from "../../../src/domain/gestures.ts";

type KeyInput = Extract<GestureInput, { readonly type: "keydown" }>;
type ClickInput = Extract<GestureInput, { readonly type: "click" }>;
type PointerInput = Extract<GestureInput, { readonly type: "pointerdown" | "mousedown" }>;

interface Disposition {
  readonly passThrough: boolean;
  readonly preventDefault: boolean;
}

const TAKEN: Disposition = { passThrough: false, preventDefault: true };
const THE_PAGES: Disposition = { passThrough: true, preventDefault: false };
const NEITHER: Disposition = { passThrough: false, preventDefault: false };

function dispositionOf(decision: GestureDecision): Disposition {
  return { passThrough: decision.passThrough, preventDefault: decision.preventDefault };
}

function expectDecision(got: GestureDecision, gesture: Gesture, disposition: Disposition, label = ""): void {
  assert.equal(got.gesture, gesture, label);
  assert.deepEqual(dispositionOf(got), disposition, label);
  assert.ok(got.reason.length > 0, label);
}

function key(k: string, extra: Omit<KeyInput, "type" | "key"> = {}): GestureDecision {
  return gestureFor({ type: "keydown", key: k, ...extra });
}

function click(extra: Omit<ClickInput, "type"> = {}): GestureDecision {
  return gestureFor({ type: "click", ...extra });
}

function pointerDown(extra: Omit<PointerInput, "type"> = {}, type: PointerInput["type"] = "pointerdown"): GestureDecision {
  return gestureFor({ type, ...extra });
}

const STATES: ReadonlyArray<{ readonly name: string; readonly state: ReviewState }> = [
  { name: "on the page", state: {} },
  { name: "with a selection", state: { hasSelection: true } },
  { name: "while a comment box is focused", state: { inCommentBox: true } },
  { name: "while a block is being edited", state: { editing: true } },
  { name: "while element-pick mode is open", state: { pickMode: true } }
];

test("the gesture vocabulary is exactly these fourteen names and values", () => {
  assert.deepEqual(
    { ...GESTURE },
    {
      COMMENT_ON_SELECTION: "comment_on_selection",
      ENTER_ELEMENT_PICK: "enter_element_pick",
      PICK_ELEMENT: "pick_element",
      EDIT_BLOCK: "edit_block",
      ENTER_EDIT_STATE: "enter_edit_state",
      CLOSE_MENU: "close_menu",
      MARK_READY: "mark_ready",
      COMMIT_EDIT: "commit_edit",
      CANCEL: "cancel",
      TOGGLE_PRESENT: "toggle_present",
      TOGGLE_RAIL: "toggle_rail",
      PAGE_DEFAULT: "page_default",
      PRESS_CHOICE: "press_choice",
      NONE: "none"
    }
  );
});

test("every decision is taken, the page's, or neither (only for a click inside the overlay), and gives a reason", () => {
  const keys = ["a", "Enter", "Escape", "c", "C", "e", "x", "1", "!"];
  const modifiers: readonly Modifiers[] = [
    {},
    { metaKey: true },
    { ctrlKey: true, shiftKey: true },
    { metaKey: true, shiftKey: true },
    { shiftKey: true },
    { altKey: true }
  ];
  const states: readonly ReviewState[] = [
    {},
    { inOverlay: true },
    { pickMode: true },
    { editing: true },
    { editing: true, inEditedBlock: true },
    { editState: true },
    { inCommentBox: true },
    { hasSelection: true },
    { blockMenuOpen: true, editing: true },
    { inArmedChoice: true, documentPage: true, mayWrite: true },
    { presenting: true }
  ];
  const inputs: GestureInput[] = [];
  for (const state of states) {
    for (const modifier of modifiers) {
      for (const k of keys) inputs.push({ type: "keydown", key: k, ...modifier, ...state });
      inputs.push({ type: "click", ...modifier, ...state });
      inputs.push({ type: "pointerdown", ...modifier, ...state });
      inputs.push({ type: "mousedown", button: 2, ...modifier, ...state });
      inputs.push({ type: "pointerdown", onScrollbar: true, ...modifier, ...state });
    }
  }
  const allowed = [TAKEN, THE_PAGES, NEITHER];
  for (const input of inputs) {
    const got = gestureFor(input);
    const shape = dispositionOf(got);
    assert.ok(allowed.some((one) => one.passThrough === shape.passThrough && one.preventDefault === shape.preventDefault));
    assert.ok(got.reason.length > 0);
    if (shape.passThrough === NEITHER.passThrough && shape.preventDefault === NEITHER.preventDefault) {
      assert.equal(input.type, "click");
      assert.equal(input.inOverlay, true);
    }
  }
});

test("Cmd-Shift-X is the show/hide chord, in both directions and in every state", () => {
  for (const one of STATES) {
    expectDecision(key("x", { metaKey: true, shiftKey: true, ...one.state }), GESTURE.TOGGLE_PRESENT, TAKEN, one.name);
  }
  expectDecision(key("X", { ctrlKey: true, shiftKey: true }), GESTURE.TOGGLE_PRESENT, TAKEN, "Ctrl and a capital X");
  expectDecision(key("x", { metaKey: true, shiftKey: true, code: "KeyX" }), GESTURE.TOGGLE_PRESENT, TAKEN, "with its code");
});

test("X alone, Shift-X and Cmd-X are the page's", () => {
  expectDecision(key("x"), GESTURE.NONE, THE_PAGES);
  expectDecision(key("x", { shiftKey: true }), GESTURE.NONE, THE_PAGES);
  expectDecision(key("x", { metaKey: true }), GESTURE.NONE, THE_PAGES);
});

test("the chord takes nothing away from the gestures that were already there", () => {
  const table: ReadonlyArray<readonly [string, Omit<KeyInput, "type" | "key">, Gesture]> = [
    ["c", { metaKey: true, shiftKey: true, hasSelection: true }, GESTURE.COMMENT_ON_SELECTION],
    ["c", { metaKey: true, shiftKey: true }, GESTURE.ENTER_ELEMENT_PICK],
    ["e", { metaKey: true, shiftKey: true }, GESTURE.EDIT_BLOCK],
    ["Enter", { metaKey: true, inCommentBox: true }, GESTURE.MARK_READY],
    ["Escape", { pickMode: true }, GESTURE.CANCEL],
    ["x", {}, GESTURE.NONE],
    ["x", { shiftKey: true }, GESTURE.NONE],
    ["x", { metaKey: true }, GESTURE.NONE]
  ];
  for (const [k, extra, expected] of table) {
    assert.equal(key(k, extra).gesture, expected, k);
  }
});

test("Cmd-Shift-1 toggles the rail, whichever way the layout reports the key", () => {
  const shapes: ReadonlyArray<{ readonly name: string; readonly event: Omit<KeyInput, "type"> }> = [
    { name: 'key "1"', event: { key: "1" } },
    { name: 'key "!"', event: { key: "!" } },
    { name: 'code "Digit1"', event: { key: "Dead", code: "Digit1" } }
  ];
  const mods: readonly Modifiers[] = [{ metaKey: true }, { ctrlKey: true }];
  for (const shape of shapes) {
    for (const mod of mods) {
      const got = gestureFor({ type: "keydown", shiftKey: true, ...shape.event, ...mod });
      expectDecision(got, GESTURE.TOGGLE_RAIL, TAKEN, shape.name);
    }
  }
});

test("the rail chord holds in every state, including inside the rail's own fields", () => {
  for (const one of STATES) {
    expectDecision(key("1", { metaKey: true, shiftKey: true, ...one.state }), GESTURE.TOGGLE_RAIL, TAKEN, one.name);
  }
});

test("the near misses of the rail chord are the page's: no Shift, no modifier, and the wrong digit", () => {
  const misses: ReadonlyArray<{ readonly name: string; readonly event: Omit<KeyInput, "type"> }> = [
    { name: "Cmd-1, which is the browser's first tab", event: { key: "1", metaKey: true } },
    { name: "Shift-1, which is typing an exclamation mark", event: { key: "!", shiftKey: true } },
    { name: "a bare 1", event: { key: "1" } },
    { name: "Cmd-Shift-2", event: { key: "2", metaKey: true, shiftKey: true } },
    { name: "Cmd-Shift-2 by code", event: { key: "@", code: "Digit2", metaKey: true, shiftKey: true } }
  ];
  for (const miss of misses) {
    expectDecision(gestureFor({ type: "keydown", ...miss.event }), GESTURE.NONE, THE_PAGES, miss.name);
  }
});

test("the present chord is untouched by the rail chord", () => {
  expectDecision(key("x", { code: "KeyX", metaKey: true, shiftKey: true }), GESTURE.TOGGLE_PRESENT, TAKEN);
});

test("both chords are decided before every other keydown rule, so they hold inside comment boxes and while editing", () => {
  const states: readonly ReviewState[] = [
    { inCommentBox: true, editing: true, blockMenuOpen: true },
    { pickMode: true, editState: true },
    { inArmedChoice: true, documentPage: true, mayWrite: true, presenting: true }
  ];
  for (const state of states) {
    expectDecision(key("x", { metaKey: true, shiftKey: true, ...state }), GESTURE.TOGGLE_PRESENT, TAKEN);
    expectDecision(key("1", { metaKey: true, shiftKey: true, ...state }), GESTURE.TOGGLE_RAIL, TAKEN);
  }
});

test("Esc closes only the block-type menu when it is open, even with an edit open", () => {
  expectDecision(key("Escape", { editing: true, blockMenuOpen: true }), GESTURE.CLOSE_MENU, TAKEN);
  expectDecision(key("Escape", { blockMenuOpen: true }), GESTURE.CLOSE_MENU, TAKEN);
});

test("otherwise Esc commits any open session and leaves edit state", () => {
  expectDecision(key("Escape", { editing: true }), GESTURE.COMMIT_EDIT, TAKEN);
  expectDecision(key("Escape", { editState: true, editing: false }), GESTURE.COMMIT_EDIT, TAKEN);
  expectDecision(key("Escape", { editing: true, pickMode: true }), GESTURE.COMMIT_EDIT, TAKEN);
});

test("Esc cancels a pick or a comment box, and is otherwise the page's", () => {
  expectDecision(key("Escape", { pickMode: true }), GESTURE.CANCEL, TAKEN);
  expectDecision(key("Escape", { inCommentBox: true }), GESTURE.CANCEL, TAKEN);
  expectDecision(key("Escape", {}), GESTURE.NONE, THE_PAGES);
  assert.notEqual(key("Escape", { editing: false }).gesture, GESTURE.COMMIT_EDIT);
});

test("Cmd-Enter marks a comment ready, and only inside a comment box", () => {
  expectDecision(key("Enter", { metaKey: true, inCommentBox: true }), GESTURE.MARK_READY, TAKEN);
  expectDecision(key("Enter", { metaKey: true, inCommentBox: false }), GESTURE.NONE, THE_PAGES, "the page's own Cmd-Enter still works");
  expectDecision(key("Enter", { metaKey: true }), GESTURE.NONE, THE_PAGES);
});

test("Enter sends a comment by default, and Shift-Enter and Alt-Enter are a new line", () => {
  expectDecision(key("Enter", { inCommentBox: true }), GESTURE.MARK_READY, TAKEN);
  expectDecision(key("Enter", { inCommentBox: true, sendKey: SEND_KEY.ENTER }), GESTURE.MARK_READY, TAKEN);
  expectDecision(key("Enter", { inCommentBox: true, shiftKey: true }), GESTURE.NONE, THE_PAGES, "Shift-Enter types its new line");
  expectDecision(key("Enter", { inCommentBox: true, altKey: true }), GESTURE.NONE, THE_PAGES);
});

test("with the Cmd-Enter setting, a bare Enter is a new line and Cmd-Enter sends", () => {
  const mod = SEND_KEY.MOD_ENTER;
  expectDecision(key("Enter", { inCommentBox: true, sendKey: mod }), GESTURE.NONE, THE_PAGES);
  expectDecision(key("Enter", { inCommentBox: true, sendKey: mod, metaKey: true }), GESTURE.MARK_READY, TAKEN);
  expectDecision(key("Enter", { inCommentBox: true, sendKey: mod, ctrlKey: true }), GESTURE.MARK_READY, TAKEN);
});

test("Cmd-Enter still sends with the Enter setting, so old habits keep working", () => {
  expectDecision(key("Enter", { inCommentBox: true, metaKey: true }), GESTURE.MARK_READY, TAKEN);
});

test("an Enter that finishes an input-method composition never sends", () => {
  expectDecision(key("Enter", { inCommentBox: true, isComposing: true }), GESTURE.NONE, THE_PAGES);
  expectDecision(key("Enter", { inCommentBox: true, isComposing: true, metaKey: true }), GESTURE.NONE, THE_PAGES);
});

test("Cmd-Enter while a block is edited commits it, under either spelling of the modifier", () => {
  expectDecision(key("Enter", { editing: true, metaKey: true }), GESTURE.COMMIT_EDIT, TAKEN);
  expectDecision(key("Enter", { editing: true, ctrlKey: true }), GESTURE.COMMIT_EDIT, TAKEN);
});

test("a bare Enter outside a comment box is the page's, even while a block is edited", () => {
  expectDecision(key("Enter", {}), GESTURE.NONE, THE_PAGES);
  expectDecision(key("Enter", { editing: true }), GESTURE.NONE, THE_PAGES, "Enter in an edit is a paragraph");
  expectDecision(key("Enter", { sendKey: SEND_KEY.MOD_ENTER }), GESTURE.NONE, THE_PAGES);
});

test("Cmd-Shift-C with a selection comments on the passage, and without one picks an element", () => {
  expectDecision(key("c", { metaKey: true, shiftKey: true, hasSelection: true }), GESTURE.COMMENT_ON_SELECTION, TAKEN);
  expectDecision(key("c", { metaKey: true, shiftKey: true, hasSelection: false }), GESTURE.ENTER_ELEMENT_PICK, TAKEN);
  expectDecision(key("c", { metaKey: true, shiftKey: true }), GESTURE.ENTER_ELEMENT_PICK, TAKEN);
});

test("Ctrl is the same modifier as Cmd, and the letter case does not matter", () => {
  expectDecision(key("C", { ctrlKey: true, shiftKey: true, hasSelection: true }), GESTURE.COMMENT_ON_SELECTION, TAKEN);
  expectDecision(key("C", { metaKey: true, shiftKey: true }), GESTURE.ENTER_ELEMENT_PICK, TAKEN);
});

test("Cmd-C without Shift is not a gesture, so the page keeps it", () => {
  expectDecision(key("c", { metaKey: true, shiftKey: false, hasSelection: true }), GESTURE.NONE, THE_PAGES);
});

test("Cmd-Shift-E edits the block under the cursor, and with the cursor in no block opens edit state", () => {
  expectDecision(key("e", { metaKey: true, shiftKey: true }), GESTURE.EDIT_BLOCK, TAKEN);
  expectDecision(key("e", { metaKey: true, shiftKey: true, inBlock: true }), GESTURE.EDIT_BLOCK, TAKEN);
  expectDecision(key("E", { ctrlKey: true, shiftKey: true, inBlock: false }), GESTURE.ENTER_EDIT_STATE, TAKEN);
  expectDecision(key("e", { metaKey: true, shiftKey: true, code: "KeyE" }), GESTURE.EDIT_BLOCK, TAKEN);
});

test("any other keydown, ordinary typing included, is the page's", () => {
  expectDecision(key("a"), GESTURE.NONE, THE_PAGES);
  expectDecision(key("a", { editing: true }), GESTURE.NONE, THE_PAGES);
  expectDecision(key("a", { inCommentBox: true }), GESTURE.NONE, THE_PAGES);
  expectDecision(key("ArrowDown", { pickMode: true }), GESTURE.NONE, THE_PAGES);
});

test("the pointer going down outside the edited block commits it, rail included, and the page still gets it", () => {
  expectDecision(pointerDown({ editing: true, inEditedBlock: false }), GESTURE.COMMIT_EDIT, THE_PAGES);
  expectDecision(pointerDown({ editing: true, inEditedBlock: false }, "mousedown"), GESTURE.COMMIT_EDIT, THE_PAGES);
  expectDecision(pointerDown({ editing: true, inEditedBlock: false, inOverlay: true }), GESTURE.COMMIT_EDIT, THE_PAGES, "the rail");
});

test("a pointer going down inside the edited block, or with no edit open, is the page's", () => {
  expectDecision(pointerDown({ editing: true, inEditedBlock: true }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(pointerDown({ editing: false }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(pointerDown({}), GESTURE.PAGE_DEFAULT, THE_PAGES);
});

test("a scrollbar drag and a secondary button are not the reviewer leaving the block", () => {
  expectDecision(pointerDown({ editing: true, inEditedBlock: false, onScrollbar: true }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(pointerDown({ editing: true, inEditedBlock: false, button: 2 }), GESTURE.PAGE_DEFAULT, THE_PAGES, "right-click");
  expectDecision(pointerDown({ editing: true, inEditedBlock: false, button: 1 }, "mousedown"), GESTURE.PAGE_DEFAULT, THE_PAGES, "middle");
});

test("a primary press on content is still leaving, whether the button is stated, null, or missing", () => {
  expectDecision(pointerDown({ editing: true, inEditedBlock: false, button: 0 }), GESTURE.COMMIT_EDIT, THE_PAGES);
  expectDecision(pointerDown({ editing: true, inEditedBlock: false, button: null }), GESTURE.COMMIT_EDIT, THE_PAGES);
  expectDecision(pointerDown({ editing: true, inEditedBlock: false }), GESTURE.COMMIT_EDIT, THE_PAGES);
});

test("browse is the page untouched: an ordinary click is the page's, and so is an Alt-click", () => {
  expectDecision(click(), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(click({ altKey: true }), GESTURE.PAGE_DEFAULT, THE_PAGES);
});

test("a click while element-pick mode is open comments on that element", () => {
  expectDecision(click({ pickMode: true }), GESTURE.PICK_ELEMENT, TAKEN);
});

test("a click outside an open edit commits it AND still reaches the page", () => {
  expectDecision(click({ editing: true, inEditedBlock: false }), GESTURE.COMMIT_EDIT, THE_PAGES);
});

test("a click inside the block being edited is not a commit", () => {
  expectDecision(click({ editing: true, inEditedBlock: true }), GESTURE.PAGE_DEFAULT, THE_PAGES);
});

test("a click inside the library's own overlay is the overlay's, whatever else is true", () => {
  expectDecision(click({ inOverlay: true, pickMode: true }), GESTURE.NONE, NEITHER);
  expectDecision(click({ inOverlay: true, editing: true, inEditedBlock: false }), GESTURE.NONE, NEITHER);
  expectDecision(click({ inOverlay: true, inArmedChoice: true, documentPage: true, mayWrite: true }), GESTURE.NONE, NEITHER);
});

const PRESS: Omit<ClickInput, "type"> = { inArmedChoice: true, documentPage: true, mayWrite: true };

test("a click on an armed button on a document page, in browse, is a press, and it prevents the default", () => {
  expectDecision(click(PRESS), GESTURE.PRESS_CHOICE, TAKEN);
});

test("pick mode, an open edit, edit state, a read-only window and present mode each refuse the press", () => {
  expectDecision(click({ ...PRESS, pickMode: true }), GESTURE.PICK_ELEMENT, TAKEN);
  expectDecision(click({ ...PRESS, editing: true, inEditedBlock: false }), GESTURE.COMMIT_EDIT, THE_PAGES);
  expectDecision(click({ ...PRESS, editing: true, inEditedBlock: true }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(click({ ...PRESS, editState: true }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(click({ ...PRESS, mayWrite: false }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(click({ ...PRESS, presenting: true }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(click({ ...PRESS, inOverlay: true }), GESTURE.NONE, NEITHER);
});

test("a missing mayWrite is not a press, and neither is anything but a true on the other two opt-ins", () => {
  expectDecision(click({ inArmedChoice: true, documentPage: true }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(click({ inArmedChoice: true, mayWrite: true }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(click({ documentPage: true, mayWrite: true }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(click({ ...PRESS, documentPage: false }), GESTURE.PAGE_DEFAULT, THE_PAGES);
  expectDecision(click({ ...PRESS, inArmedChoice: false }), GESTURE.PAGE_DEFAULT, THE_PAGES);
});

test("a keydown or a pointer going down on an armed button is never a press", () => {
  assert.notEqual(key("Enter", PRESS).gesture, GESTURE.PRESS_CHOICE);
  assert.notEqual(pointerDown(PRESS).gesture, GESTURE.PRESS_CHOICE);
  assert.notEqual(pointerDown(PRESS, "mousedown").gesture, GESTURE.PRESS_CHOICE);
});

test("the send key is one of two settings, and anything else is the Enter setting", () => {
  assert.deepEqual({ ...SEND_KEY }, { ENTER: "enter", MOD_ENTER: "mod_enter" });
  assert.equal(normalizeSendKey("mod_enter"), "mod_enter");
  assert.equal(normalizeSendKey("enter"), "enter");
  assert.equal(normalizeSendKey(undefined), "enter");
  assert.equal(normalizeSendKey("nonsense"), "enter");
  assert.equal(normalizeSendKey(1), "enter");
  assert.equal(sendKeyLabel("mod_enter"), "Cmd-Enter");
  assert.equal(sendKeyLabel("enter"), "Enter");
  assert.equal(sendKeyLabel(), "Enter");
});

test("a send press is Enter that is not finishing a composition, with the modifier the setting asks for", () => {
  assert.equal(isSendPress({ key: "Enter" }), true);
  assert.equal(isSendPress({ key: "Enter", shiftKey: true }), false);
  assert.equal(isSendPress({ key: "Enter", altKey: true }), false);
  assert.equal(isSendPress({ key: "Enter", isComposing: true }), false);
  assert.equal(isSendPress({ key: "Enter", isComposing: true, metaKey: true }), false);
  assert.equal(isSendPress({ key: "a" }), false);
  assert.equal(isSendPress({ key: "a", metaKey: true }), false);
  assert.equal(isSendPress({ key: "Enter", sendKey: "mod_enter" }), false);
  assert.equal(isSendPress({ key: "Enter", sendKey: "mod_enter", metaKey: true }), true);
  assert.equal(isSendPress({ key: "Enter", sendKey: "mod_enter", ctrlKey: true }), true);
  assert.equal(isSendPress({ key: "Enter", metaKey: true }), true);
  assert.equal(isSendPress({ key: "Enter", metaKey: true, shiftKey: true }), true);
});

test("a send event reads a real keydown, including Safari's input-method code", () => {
  assert.equal(isSendEvent({ key: "Enter" }), true);
  assert.equal(isSendEvent({ key: "Enter", keyCode: 229 }), false);
  assert.equal(isSendEvent({ key: "Enter", isComposing: true }), false);
  assert.equal(isSendEvent({ key: "Enter", isComposing: false }), true);
  assert.equal(isSendEvent({ key: "Enter", shiftKey: true }), false);
  assert.equal(isSendEvent({ key: "Enter" }, "mod_enter"), false);
  assert.equal(isSendEvent({ key: "Enter", ctrlKey: true }, "mod_enter"), true);
});

const HINTS_ENTER: readonly HintLine[] = [
  { keys: "Cmd-Shift-C", hint: "Select text and press Cmd-Shift-C to comment on it." },
  { keys: "Cmd-Shift-C", hint: "Press Cmd-Shift-C with nothing selected, then click any element to comment on the whole thing." },
  { keys: "click", hint: "Click the outlined element to comment on it. Esc cancels." },
  { keys: "Cmd-Shift-E", hint: "Press Cmd-Shift-E to edit the block you are in. Just that block." },
  { keys: "Cmd-Shift-E", hint: "Click + Write here to add text. Esc to finish." },
  { keys: "Enter", hint: "Enter when done with this comment. Shift-Enter for a new line." },
  { keys: "Cmd-Enter, Esc, or a click outside", hint: "Cmd-Enter, Esc, or click outside to finish the edit and give the page back." },
  { keys: "Esc", hint: "Esc closes the comment box or cancels picking. Your draft is kept." },
  { keys: "Cmd-Shift-X", hint: "Press Cmd-Shift-X to hide the review while you present, and again to bring it back." },
  { keys: "Cmd-Shift-1", hint: "Press Cmd-Shift-1 to open or close the review panel." },
  { keys: "everything else", hint: "Everything else is the page. Links, buttons, and forms work exactly as they do without this." }
];

const PANEL_ENTER: readonly HintLine[] = [
  { keys: "Cmd-Shift-C", hint: "Select text and press Cmd-Shift-C to comment on it." },
  {
    keys: "Cmd-Shift-C (no selection)",
    hint: "As you hover over elements, they will be outlined. Click an element to comment on the element. Useful for images and other hard to highlight elements."
  },
  { keys: "Cmd-Shift-E", hint: "Select text and press Cmd-Shift-E to edit it by hand." },
  { keys: "Cmd-Shift-E (no selection)", hint: "As you hover, editable areas will be outlined. Click an area to hand edit it. Esc to finish." },
  { keys: "Enter", hint: "Send your comment. Shift-Enter for a new line." },
  { keys: "Cmd-Enter or Esc", hint: "Finish your edit." },
  { keys: "Esc", hint: "Esc closes the comment box or cancels picking. Half-written drafts are kept in the chat bar." },
  { keys: "Cmd-Shift-X", hint: "Presentation mode. Toggle hiding the chat bar and the pill." },
  { keys: "Cmd-Shift-1", hint: "Toggle the chat bar." },
  { keys: "page hotkeys", hint: "Other page hotkeys should work as normal." }
];

function withLine(lines: readonly HintLine[], at: number, line: HintLine): readonly HintLine[] {
  return lines.map((one, index) => (index === at ? line : one));
}

test("the rail's hint lines are these eleven, in this order, and every gesture is taught with its exact keystroke", () => {
  assert.deepEqual(hintLines("enter"), HINTS_ENTER);
  assert.deepEqual(hintLines(), HINTS_ENTER);
  assert.equal(TABLE.length, 11);
  assert.equal(hintLines().length, TABLE.length);
  for (const row of TABLE) {
    assert.ok(row.keys.length > 0);
    assert.ok((hintFor(row.gesture) ?? "").length > 0);
  }
});

test("under the Cmd-Enter setting only the send line changes", () => {
  assert.deepEqual(
    hintLines("mod_enter"),
    withLine(HINTS_ENTER, 5, { keys: "Cmd-Enter", hint: "Cmd-Enter when done with this comment." })
  );
});

test("the Keyboard shortcuts panel has these ten lines, and picking the outlined element is not one of them", () => {
  assert.deepEqual(panelLines("enter"), PANEL_ENTER);
  assert.deepEqual(panelLines(), PANEL_ENTER);
  assert.equal(panelLines().length, 10);
});

test("under the Cmd-Enter setting only the panel's send line changes", () => {
  assert.deepEqual(
    panelLines("mod_enter"),
    withLine(PANEL_ENTER, 4, { keys: "Cmd-Enter", hint: "Send your comment. Enter for a new line." })
  );
});

test("a page with no choices shows the same rail hints as before: no line is about choices, and a press has no row", () => {
  assert.equal(hintLines().some((line) => /choice/i.test(line.hint)), false);
  assert.equal(panelLines().some((line) => /choice/i.test(line.hint)), false);
  assert.equal(TABLE.some((row) => row.gesture === GESTURE.PRESS_CHOICE), false);
  assert.equal(hintFor(GESTURE.PRESS_CHOICE), null);
});

test("the present chord and the rail chord are taught on the rail with their exact keystrokes", () => {
  const present = hintLines().find((one) => one.keys === "Cmd-Shift-X");
  assert.match(present?.hint ?? "", /hide the review/i);
  assert.match(present?.hint ?? "", /again to bring it back/i);
  const rail = hintLines().find((one) => one.keys === "Cmd-Shift-1");
  assert.match(rail?.hint ?? "", /Cmd-Shift-1/);
  assert.equal(hintFor(GESTURE.TOGGLE_RAIL), rail?.hint);
  assert.equal(hintFor(GESTURE.TOGGLE_PRESENT), present?.hint);
});

test("the hint for a gesture is the hint of its row, under the given setting, and null for a gesture with no row", () => {
  TABLE.forEach((row, index) => {
    assert.equal(hintFor(row.gesture), hintLines()[index]?.hint, row.gesture);
    assert.equal(hintFor(row.gesture, "mod_enter"), hintLines("mod_enter")[index]?.hint, row.gesture);
  });
  assert.equal(hintFor(GESTURE.PRESS_CHOICE), null);
  assert.equal(hintFor(GESTURE.CLOSE_MENU), null);
  assert.equal(hintFor(GESTURE.NONE), null);
});

test("the on-card hint is Ken's copy, word for word, and follows the send key", () => {
  assert.equal(hintFor(GESTURE.MARK_READY), "Enter when done with this comment. Shift-Enter for a new line.");
  assert.equal(hintFor(GESTURE.MARK_READY, "mod_enter"), "Cmd-Enter when done with this comment.");
  assert.equal(hintFor(GESTURE.ENTER_EDIT_STATE), "Click + Write here to add text. Esc to finish.");
});

test("the hint for edit state with no block open is pinned, and its row names when it applies", () => {
  const row = TABLE.find((one) => one.gesture === GESTURE.ENTER_EDIT_STATE);
  assert.equal(row?.keys, "Cmd-Shift-E");
  assert.equal(row?.when, "the cursor is in no block");
});

test("Enter is a paragraph break and Shift-Enter is a line break, in every engine", () => {
  assert.equal(breakIntentFor({ inputType: "insertParagraph" }), BREAK.PARAGRAPH);
  assert.equal(breakIntentFor({ inputType: "insertLineBreak" }), BREAK.LINE);
  assert.equal(breakIntentFor({ inputType: "insertParagraph", shiftKey: true }), BREAK.LINE, "WebKit calls Shift-Enter insertParagraph");
  assert.equal(breakIntentFor({ inputType: "insertLineBreak", shiftKey: true }), BREAK.LINE);
  assert.deepEqual({ ...BREAK }, { PARAGRAPH: "paragraph", LINE: "line" });
});

test("nothing but a break is intercepted: ordinary typing stays the engine's", () => {
  assert.equal(breakIntentFor({ inputType: "insertText" }), null);
  assert.equal(breakIntentFor({ inputType: "deleteContentBackward" }), null);
  assert.equal(breakIntentFor({ inputType: "insertFromPaste" }), null);
  assert.equal(breakIntentFor({ inputType: "insertCompositionText" }), null);
  assert.equal(breakIntentFor({}), null);
});

test("the formatting commands are closed to bold and italic, and the button's direction follows what the reviewer sees", () => {
  assert.deepEqual([...FORMAT_COMMANDS], ["bold", "italic"]);
  assert.deepEqual({ ...FORMAT }, { APPLY: "apply", REMOVE: "remove" });
  assert.equal(formatIntentFor({ command: "bold", active: false }), FORMAT.APPLY);
  assert.equal(formatIntentFor({ command: "bold" }), FORMAT.APPLY);
  assert.equal(formatIntentFor({ command: "bold", active: true }), FORMAT.REMOVE);
  assert.equal(formatIntentFor({ command: "italic", active: true }), FORMAT.REMOVE);
  assert.equal(formatIntentFor({ command: "italic", active: false }), FORMAT.APPLY);
  assert.equal(formatIntentFor({ command: "underline", active: true }), null);
  assert.equal(formatIntentFor({}), null);
});

test("the block types are these six rows, in this order, with their labels, chords and Markdown shortcuts", () => {
  assert.deepEqual(BLOCK_TYPES.map((row) => ({ ...row, chords: { ...row.chords }, shortcuts: [...row.shortcuts] })), [
    { tag: "p", label: "Paragraph", code: "Digit0", chords: { mac: "Cmd-Option-0", other: "Ctrl-Shift-0" }, shortcuts: [] },
    { tag: "h2", label: "Heading", code: "Digit2", chords: { mac: "Cmd-Option-2", other: "Ctrl-Shift-2" }, shortcuts: ["## ", "# "] },
    { tag: "h3", label: "Subheading", code: "Digit3", chords: { mac: "Cmd-Option-3", other: "Ctrl-Shift-3" }, shortcuts: ["### "] },
    { tag: "h4", label: "Small heading", code: "Digit4", chords: { mac: "Cmd-Option-4", other: "Ctrl-Shift-4" }, shortcuts: ["#### "] },
    { tag: "ul", label: "Bulleted list", code: "Digit8", chords: { mac: "Cmd-Shift-8", other: "Ctrl-Shift-8" }, shortcuts: ["- ", "* "] },
    { tag: "ol", label: "Numbered list", code: "Digit7", chords: { mac: "Cmd-Shift-7", other: "Ctrl-Shift-7" }, shortcuts: ["1. "] }
  ]);
  assert.equal(OTHER_BLOCK_LABEL, "Other block");
});

test("a block type's label is its row's, and null for any other tag", () => {
  assert.equal(blockTypeLabel("h2"), "Heading");
  assert.equal(blockTypeLabel("p"), "Paragraph");
  assert.equal(blockTypeLabel("ol"), "Numbered list");
  assert.equal(blockTypeLabel("blockquote"), null);
  assert.equal(blockTypeLabel("h1"), null);
});

function chord(code: string, extra: Omit<ChordInput, "code">): string | null {
  return blockTypeChord({ code, key: "x", ...extra });
}

const MAC: Omit<ChordInput, "code"> = { platform: "mac", metaKey: true };
const OTHER: Omit<ChordInput, "code"> = { platform: "other", ctrlKey: true };

test("each chord maps to its tag by event.code on macOS", () => {
  assert.equal(chord("Digit0", { ...MAC, altKey: true }), "p");
  assert.equal(chord("Digit2", { ...MAC, altKey: true }), "h2");
  assert.equal(chord("Digit3", { ...MAC, altKey: true }), "h3");
  assert.equal(chord("Digit4", { ...MAC, altKey: true }), "h4");
  assert.equal(chord("Digit8", { ...MAC, shiftKey: true }), "ul");
  assert.equal(chord("Digit7", { ...MAC, shiftKey: true }), "ol");
});

test("each chord maps to its tag by event.code on Windows and Linux", () => {
  assert.equal(chord("Digit0", { ...OTHER, shiftKey: true }), "p");
  assert.equal(chord("Digit2", { ...OTHER, shiftKey: true }), "h2");
  assert.equal(chord("Digit3", { ...OTHER, shiftKey: true }), "h3");
  assert.equal(chord("Digit4", { ...OTHER, shiftKey: true }), "h4");
  assert.equal(chord("Digit8", { ...OTHER, shiftKey: true }), "ul");
  assert.equal(chord("Digit7", { ...OTHER, shiftKey: true }), "ol");
});

test("the character a key types never matters: Option-2 types a trademark sign on a US Mac and still matches", () => {
  assert.equal(chord("Digit2", { ...MAC, altKey: true, key: "™" }), "h2");
});

test("an event with AltGraph on never matches, nor does Ctrl-Alt with a digit", () => {
  assert.equal(chord("Digit2", { ...OTHER, shiftKey: true, altGraph: true }), null);
  assert.equal(chord("Digit2", { ...MAC, altKey: true, altGraph: true }), null);
  assert.equal(chord("Digit2", { platform: "other", ctrlKey: true, altKey: true }), null);
  assert.equal(chord("Digit2", { platform: "other", ctrlKey: true, altKey: true, shiftKey: true }), null);
});

test("the other system's modifier is not a chord, and neither is a bare Cmd-2", () => {
  assert.equal(chord("Digit2", { platform: "mac", ctrlKey: true, shiftKey: true }), null);
  assert.equal(chord("Digit2", { platform: "other", metaKey: true, altKey: true }), null);
  assert.equal(chord("Digit2", { platform: "mac", metaKey: true }), null);
  assert.equal(chord("Digit1", { ...MAC, shiftKey: true }), null);
  assert.equal(chord("Digit1", { ...OTHER, shiftKey: true }), null);
});

test("no chord collides with Cmd-Shift-E, C, X, 1 or the macOS screenshot keys", () => {
  const macChords = BLOCK_TYPES.map((row) => row.chords.mac);
  for (const taken of ["Cmd-Shift-E", "Cmd-Shift-C", "Cmd-Shift-X", "Cmd-Shift-1", "Cmd-Shift-3", "Cmd-Shift-4", "Cmd-Shift-5"]) {
    assert.equal(macChords.includes(taken), false, taken);
  }
  for (const code of ["KeyE", "KeyC", "KeyX", "Digit1", "Digit3", "Digit4", "Digit5"]) {
    assert.equal(chord(code, { ...MAC, shiftKey: true }), null, "Cmd-Shift " + code);
  }
  expectDecision(key("e", { metaKey: true, shiftKey: true, code: "KeyE" }), GESTURE.EDIT_BLOCK, TAKEN);
});

test("each menu row names its chord for the reviewer's system, and a tag with no row has none", () => {
  assert.equal(chordLabelFor("h2", "mac"), "Cmd-Option-2");
  assert.equal(chordLabelFor("h2", "other"), "Ctrl-Shift-2");
  assert.equal(chordLabelFor("ul", "mac"), "Cmd-Shift-8");
  assert.equal(chordLabelFor("ol", "other"), "Ctrl-Shift-7");
  assert.equal(chordLabelFor("blockquote", "mac"), null);
});

test("a Markdown shortcut at the start of a block names its type", () => {
  assert.equal(markdownShortcutFor("# "), "h2");
  assert.equal(markdownShortcutFor("## "), "h2");
  assert.equal(markdownShortcutFor("### "), "h3");
  assert.equal(markdownShortcutFor("#### "), "h4");
  assert.equal(markdownShortcutFor("- "), "ul");
  assert.equal(markdownShortcutFor("* "), "ul");
  assert.equal(markdownShortcutFor("1. "), "ol");
});

test("only once the space is typed, only at the start of a block, and only the six rows' own shortcuts", () => {
  assert.equal(markdownShortcutFor("#"), null);
  assert.equal(markdownShortcutFor("##### "), null);
  assert.equal(markdownShortcutFor("a # "), null);
  assert.equal(markdownShortcutFor("2. "), null);
  assert.equal(markdownShortcutFor(""), null);
});

test("a no-break space counts as a space, because a contenteditable often types one", () => {
  assert.equal(markdownShortcutFor("##\u00a0"), "h2");
  assert.equal(markdownShortcutFor("-\u00a0"), "ul");
  assert.equal(markdownShortcutFor("1.\u00a0"), "ol");
});

test("every Markdown shortcut a row lists answers with that row's tag", () => {
  for (const row of BLOCK_TYPES) {
    for (const shortcut of row.shortcuts) assert.equal(markdownShortcutFor(shortcut), row.tag, shortcut);
  }
});

test("Enter at the end of a block makes a sibling; Enter mid-block splits", () => {
  assert.equal(enterIntentFor({ atEnd: true }), ENTER.SIBLING);
  assert.equal(enterIntentFor({ atEnd: false }), ENTER.SPLIT);
  assert.equal(enterIntentFor({}), ENTER.SPLIT);
});

test("Shift-Enter stays a line break, in a list too", () => {
  assert.equal(enterIntentFor({ atEnd: true, shiftKey: true }), ENTER.LINE);
  assert.equal(enterIntentFor({ inListItem: true, shiftKey: true }), ENTER.LINE);
  assert.equal(enterIntentFor({ runAllowed: false, shiftKey: true }), ENTER.LINE);
});

test("Enter in an empty last item ends the list; elsewhere in a list it adds an item", () => {
  assert.equal(enterIntentFor({ inListItem: true, itemEmpty: true, lastItem: true }), ENTER.END_LIST);
  assert.equal(enterIntentFor({ inListItem: true, itemEmpty: false, lastItem: true, atEnd: true }), ENTER.NEW_ITEM);
  assert.equal(enterIntentFor({ inListItem: true, itemEmpty: true, lastItem: false }), ENTER.NEW_ITEM);
});

test("Enter where a run cannot go keeps today's break rule", () => {
  assert.equal(enterIntentFor({ atEnd: true, runAllowed: false }), ENTER.BREAK_RULE);
  assert.equal(enterIntentFor({ inListItem: true, runAllowed: false }), ENTER.BREAK_RULE);
  assert.equal(enterIntentFor({ atEnd: true, runAllowed: true }), ENTER.SIBLING);
});

test("the Enter intents are these six values", () => {
  assert.deepEqual(
    { ...ENTER },
    {
      SIBLING: "sibling",
      SPLIT: "split",
      NEW_ITEM: "new_item",
      END_LIST: "end_list",
      LINE: "line",
      BREAK_RULE: "break_rule"
    }
  );
});

test("Backspace at a block start merges into the block before, inside the session", () => {
  assert.equal(edgeDeleteFor({ key: "Backspace", collapsed: true, atBlockStart: true, firstBlock: false }), EDGE.MERGE_PREVIOUS);
  assert.equal(edgeDeleteFor({ key: "Backspace", collapsed: true, atBlockStart: true }), EDGE.MERGE_PREVIOUS);
  assert.equal(edgeDeleteFor({ key: "Backspace", collapsed: true, atBlockStart: false }), null, "mid-block is ordinary typing");
});

test("Delete at a block end merges the next block in", () => {
  assert.equal(edgeDeleteFor({ key: "Delete", collapsed: true, atBlockEnd: true, lastBlock: false }), EDGE.MERGE_NEXT);
  assert.equal(edgeDeleteFor({ key: "Delete", collapsed: true, atBlockEnd: false }), null);
});

test("Backspace or Delete at the session's own edge is refused, so no page block outside it changes", () => {
  assert.equal(edgeDeleteFor({ key: "Backspace", collapsed: true, atBlockStart: true, firstBlock: true }), EDGE.REFUSE);
  assert.equal(edgeDeleteFor({ key: "Delete", collapsed: true, atBlockEnd: true, lastBlock: true }), EDGE.REFUSE);
});

test("a selection across blocks is deleted by the layer, with either key, and one inside a block is the engine's", () => {
  assert.equal(edgeDeleteFor({ key: "Backspace", collapsed: false, spansBlocks: true }), EDGE.DELETE_SELECTION);
  assert.equal(edgeDeleteFor({ key: "Delete", collapsed: false, spansBlocks: true }), EDGE.DELETE_SELECTION);
  assert.equal(edgeDeleteFor({ key: "Delete", collapsed: false, spansBlocks: false }), null);
  assert.equal(edgeDeleteFor({ key: "Backspace", collapsed: false }), null);
});

test("a key other than Backspace or Delete is never an edge delete", () => {
  assert.equal(edgeDeleteFor({ key: "a", collapsed: true, atBlockStart: true }), null);
  assert.equal(edgeDeleteFor({ collapsed: true, atBlockStart: true }), null);
  assert.deepEqual(
    { ...EDGE },
    { MERGE_PREVIOUS: "merge_previous", MERGE_NEXT: "merge_next", DELETE_SELECTION: "delete_selection", REFUSE: "refuse" }
  );
});

test("Cmd-Z and Shift-Cmd-Z walk the session's own history", () => {
  assert.equal(historyIntentFor({ code: "KeyZ", key: "z", metaKey: true, editing: true }), HISTORY.UNDO);
  assert.equal(historyIntentFor({ code: "KeyZ", key: "z", metaKey: true, shiftKey: true, editing: true }), HISTORY.REDO);
  assert.equal(historyIntentFor({ code: "KeyZ", key: "z", ctrlKey: true, editing: true }), HISTORY.UNDO);
  assert.equal(historyIntentFor({ key: "z", metaKey: true, editing: true }), HISTORY.UNDO, "by key alone");
  assert.equal(historyIntentFor({ code: "KeyY", key: "y", ctrlKey: true, editing: true, platform: "other" }), HISTORY.REDO);
  assert.equal(historyIntentFor({ inputType: "historyUndo", editing: true }), HISTORY.UNDO);
  assert.equal(historyIntentFor({ inputType: "historyRedo", editing: true }), HISTORY.REDO);
  assert.deepEqual({ ...HISTORY }, { UNDO: "undo", REDO: "redo" });
});

test("outside a session, and without the modifier, undo is not the session's", () => {
  assert.equal(historyIntentFor({ code: "KeyZ", key: "z", metaKey: true, editing: false }), null);
  assert.equal(historyIntentFor({ code: "KeyZ", key: "z", metaKey: true }), null);
  assert.equal(historyIntentFor({ inputType: "historyUndo" }), null);
  assert.equal(historyIntentFor({ code: "KeyZ", key: "z", editing: true }), null);
  assert.equal(historyIntentFor({ code: "KeyZ", key: "z", metaKey: true, altKey: true, editing: true }), null);
  assert.equal(historyIntentFor({ code: "KeyY", key: "y", ctrlKey: true, editing: true, platform: "mac" }), null);
  assert.equal(historyIntentFor({ code: "KeyY", key: "y", metaKey: true, editing: true, platform: "other" }), null);
  assert.equal(historyIntentFor({ code: "KeyA", key: "a", metaKey: true, editing: true }), null);
});

test("the scrollbar geometry: past the content box and inside the border box", () => {
  const inner = { contentWidth: 185, contentHeight: 100, boxWidth: 200, boxHeight: 100 };
  assert.equal(isScrollbarPress({ x: 192, y: 40, ...inner }), true, "in the gutter");
  assert.equal(isScrollbarPress({ x: 184, y: 40, ...inner }), false, "one pixel of content");
  assert.equal(isScrollbarPress({ x: 260, y: 40, ...inner }), false, "past the box entirely");

  const horizontal = { contentWidth: 200, contentHeight: 85, boxWidth: 200, boxHeight: 100 };
  assert.equal(isScrollbarPress({ x: 40, y: 92, ...horizontal }), true);
  assert.equal(isScrollbarPress({ x: 40, y: 40, ...horizontal }), false);

  const root = { contentWidth: 1265, contentHeight: 800, boxWidth: 1280, boxHeight: 800 };
  assert.equal(isScrollbarPress({ x: 1272, y: 300, ...root }), true);
  assert.equal(isScrollbarPress({ x: 600, y: 300, ...root }), false);
});

test("a box with no gutter is an overlay scrollbar, which takes no space and receives no press", () => {
  const overlay = { contentWidth: 200, contentHeight: 100, boxWidth: 200, boxHeight: 100 };
  assert.equal(isScrollbarPress({ x: 199, y: 99, ...overlay }), false);
});

test("the old path loads the same functions, in an ordinary object old code can write to", () => {
  const load = createRequire(import.meta.url);
  const old: unknown = load("../../../src/shared/gestures.js");
  assert.ok(typeof old === "object" && old !== null && "gestureFor" in old);
  assert.equal(old.gestureFor, gestureFor);
  assert.equal(Reflect.get(old, "TABLE"), TABLE);
  const replacement = (): null => null;
  Reflect.set(old, "hintFor", replacement);
  assert.equal(Reflect.get(old, "hintFor"), replacement);
  Reflect.set(old, "hintFor", hintFor);
});
