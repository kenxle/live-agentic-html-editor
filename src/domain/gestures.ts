/*
 * read-when: Changing a keyboard shortcut, a click rule, a hint line, or what Enter, Backspace, B, I or undo mean while writing on the page.
 */

export const GESTURE = {
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
} as const;
export type Gesture = (typeof GESTURE)[keyof typeof GESTURE];

export type Disposition =
  | { readonly passThrough: false; readonly preventDefault: true }
  | { readonly passThrough: true; readonly preventDefault: false }
  | { readonly passThrough: false; readonly preventDefault: false };
export type GestureDecision = { readonly gesture: Gesture; readonly reason: string } & Disposition;

export const SEND_KEY = { ENTER: "enter", MOD_ENTER: "mod_enter" } as const;
export type SendKey = (typeof SEND_KEY)[keyof typeof SEND_KEY];

export interface Modifiers {
  readonly metaKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly shiftKey?: boolean;
  readonly altKey?: boolean;
}

export interface ReviewState {
  readonly hasSelection?: boolean;
  readonly inOverlay?: boolean;
  readonly pickMode?: boolean;
  readonly editing?: boolean;
  readonly editState?: boolean;
  readonly inEditedBlock?: boolean;
  readonly inCommentBox?: boolean;
  readonly blockMenuOpen?: boolean;
  readonly inBlock?: boolean;
  readonly sendKey?: SendKey;
  readonly presenting?: boolean;
  readonly mayWrite?: boolean;
  readonly documentPage?: boolean;
  readonly inArmedChoice?: boolean;
}

export interface KeyDownInput extends Modifiers, ReviewState {
  readonly type: "keydown";
  readonly key?: string;
  readonly code?: string;
  readonly isComposing?: boolean;
}

export interface PointerInput extends Modifiers, ReviewState {
  readonly type: "pointerdown" | "mousedown";
  readonly button?: number | null;
  readonly onScrollbar?: boolean;
}

export interface ClickInput extends Modifiers, ReviewState {
  readonly type: "click";
}

export type GestureInput = KeyDownInput | PointerInput | ClickInput;

export interface HintRow {
  readonly gesture: Gesture;
  readonly keys: string;
  readonly when: string;
  readonly hint: string;
  readonly panelKeys?: string;
  readonly panelHint?: string;
  readonly inPanel?: false;
}

export interface HintLine {
  readonly keys: string;
  readonly hint: string;
}

interface SendKeyWords {
  readonly keys: string;
  readonly hint: string;
  readonly panelHint: string;
}

const SEND_KEY_WORDS: { readonly [Key in SendKey]: SendKeyWords } = {
  enter: {
    keys: "Enter",
    hint: "Enter when done with this comment. Shift-Enter for a new line.",
    panelHint: "Send your comment. Shift-Enter for a new line."
  },
  mod_enter: {
    keys: "Cmd-Enter",
    hint: "Cmd-Enter when done with this comment.",
    panelHint: "Send your comment. Enter for a new line."
  }
};

export const TABLE: readonly HintRow[] = [
  {
    gesture: GESTURE.COMMENT_ON_SELECTION,
    keys: "Cmd-Shift-C",
    when: "text selected",
    hint: "Select text and press Cmd-Shift-C to comment on it."
  },
  {
    gesture: GESTURE.ENTER_ELEMENT_PICK,
    keys: "Cmd-Shift-C",
    when: "nothing selected",
    hint: "Press Cmd-Shift-C with nothing selected, then click any element to comment on the whole thing.",
    panelKeys: "Cmd-Shift-C (no selection)",
    panelHint:
      "As you hover over elements, they will be outlined. Click an element to comment on the element. Useful for images and other hard to highlight elements."
  },
  {
    gesture: GESTURE.PICK_ELEMENT,
    keys: "click",
    when: "element-pick mode is open",
    hint: "Click the outlined element to comment on it. Esc cancels.",
    inPanel: false
  },
  {
    gesture: GESTURE.EDIT_BLOCK,
    keys: "Cmd-Shift-E",
    when: "the cursor or a selection is in a block",
    hint: "Press Cmd-Shift-E to edit the block you are in. Just that block.",
    panelHint: "Select text and press Cmd-Shift-E to edit it by hand."
  },
  {
    gesture: GESTURE.ENTER_EDIT_STATE,
    keys: "Cmd-Shift-E",
    when: "the cursor is in no block",
    hint: "Click + Write here to add text. Esc to finish.",
    panelKeys: "Cmd-Shift-E (no selection)",
    panelHint: "As you hover, editable areas will be outlined. Click an area to hand edit it. Esc to finish."
  },
  {
    gesture: GESTURE.MARK_READY,
    keys: SEND_KEY_WORDS.enter.keys,
    when: "a comment box is focused",
    hint: SEND_KEY_WORDS.enter.hint,
    panelHint: SEND_KEY_WORDS.enter.panelHint
  },
  {
    gesture: GESTURE.COMMIT_EDIT,
    keys: "Cmd-Enter, Esc, or a click outside",
    when: "a block is in edit state",
    hint: "Cmd-Enter, Esc, or click outside to finish the edit and give the page back.",
    panelKeys: "Cmd-Enter or Esc",
    panelHint: "Finish your edit."
  },
  {
    gesture: GESTURE.CANCEL,
    keys: "Esc",
    when: "element-pick mode is open, or a comment box is focused",
    hint: "Esc closes the comment box or cancels picking. Your draft is kept.",
    panelHint: "Esc closes the comment box or cancels picking. Half-written drafts are kept in the chat bar."
  },
  {
    gesture: GESTURE.TOGGLE_PRESENT,
    keys: "Cmd-Shift-X",
    when: "always, including while the tool is hidden",
    hint: "Press Cmd-Shift-X to hide the review while you present, and again to bring it back.",
    panelHint: "Presentation mode. Toggle hiding the chat bar and the pill."
  },
  {
    gesture: GESTURE.TOGGLE_RAIL,
    keys: "Cmd-Shift-1",
    when: "always, except while the review is hidden for presenting",
    hint: "Press Cmd-Shift-1 to open or close the review panel.",
    panelHint: "Toggle the chat bar."
  },
  {
    gesture: GESTURE.PAGE_DEFAULT,
    keys: "everything else",
    when: "always",
    hint: "Everything else is the page. Links, buttons, and forms work exactly as they do without this.",
    panelKeys: "page hotkeys",
    panelHint: "Other page hotkeys should work as normal."
  }
];

export function normalizeSendKey(value: unknown): SendKey {
  return value === SEND_KEY.MOD_ENTER ? SEND_KEY.MOD_ENTER : SEND_KEY.ENTER;
}

export function sendKeyLabel(sendKey?: SendKey): string {
  return SEND_KEY_WORDS[normalizeSendKey(sendKey)].keys;
}

function isPrimaryModifier(modifiers: Modifiers): boolean {
  return modifiers.metaKey === true || modifiers.ctrlKey === true;
}

function isKey(key: string | undefined, letter: string): boolean {
  return key !== undefined && key.toLowerCase() === letter;
}

function isDigitOne(event: { readonly code?: string; readonly key?: string }): boolean {
  return event.code === "Digit1" || event.key === "1" || event.key === "!";
}

interface SendFacts {
  readonly key: string | undefined;
  readonly composing: boolean;
  readonly primary: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  readonly sendKey: unknown;
}

function isSend(facts: SendFacts): boolean {
  if (facts.key !== "Enter" || facts.composing) return false;
  if (facts.primary) return true;
  if (normalizeSendKey(facts.sendKey) !== SEND_KEY.ENTER) return false;
  return !facts.shift && !facts.alt;
}

export interface SendPressInput extends Modifiers {
  readonly key?: string;
  readonly isComposing?: boolean;
  readonly sendKey?: SendKey;
}

export function isSendPress(input: SendPressInput): boolean {
  return isSend({
    key: input.key,
    composing: input.isComposing === true,
    primary: isPrimaryModifier(input),
    shift: input.shiftKey === true,
    alt: input.altKey === true,
    sendKey: input.sendKey
  });
}

export interface KeyEventLike extends Modifiers {
  readonly key?: string;
  readonly isComposing?: boolean;
  readonly keyCode?: number;
}

const IME_KEY_CODE = 229;

export function isSendEvent(event: KeyEventLike, sendKey?: SendKey): boolean {
  return isSend({
    key: event.key,
    composing: event.isComposing === true || event.keyCode === IME_KEY_CODE,
    primary: isPrimaryModifier(event),
    shift: event.shiftKey === true,
    alt: event.altKey === true,
    sendKey
  });
}

function taken(gesture: Gesture, reason: string): GestureDecision {
  return { gesture, passThrough: false, preventDefault: true, reason };
}

function handedToPage(gesture: Gesture, reason: string): GestureDecision {
  return { gesture, passThrough: true, preventDefault: false, reason };
}

function neither(gesture: Gesture, reason: string): GestureDecision {
  return { gesture, passThrough: false, preventDefault: false, reason };
}

function keydownDecision(e: KeyDownInput): GestureDecision {
  const chord = isPrimaryModifier(e) && e.shiftKey === true;
  if (chord && isKey(e.key, "x")) {
    return taken(GESTURE.TOGGLE_PRESENT, "Cmd-Shift-X hides the review for presenting, and shows it again");
  }
  if (chord && isDigitOne(e)) {
    return taken(GESTURE.TOGGLE_RAIL, "Cmd-Shift-1 opens the review panel, or closes it");
  }
  if (e.key === "Escape") {
    if (e.blockMenuOpen === true) {
      return taken(GESTURE.CLOSE_MENU, "Esc closes the block-type menu and leaves the edit open");
    }
    if (e.editing === true || e.editState === true) {
      return taken(GESTURE.COMMIT_EDIT, "Esc commits the open edit and gives the block back to the page");
    }
    if (e.pickMode === true || e.inCommentBox === true) {
      return taken(GESTURE.CANCEL, "Esc closes the box or cancels picking; the draft is kept either way");
    }
    return handedToPage(GESTURE.NONE, "nothing of the library's is open, so Esc is the page's");
  }
  if (e.key === "Enter" && e.inCommentBox === true) {
    if (isSendPress(e)) {
      return taken(GESTURE.MARK_READY, sendKeyLabel(e.sendKey) + " marks this comment ready for the agent");
    }
    return handedToPage(GESTURE.NONE, "a new line in the comment box, or an input method finishing a character");
  }
  if (e.key === "Enter" && isPrimaryModifier(e)) {
    if (e.editing === true) {
      return taken(GESTURE.COMMIT_EDIT, "Cmd-Enter commits the open edit and gives the block back to the page");
    }
    return handedToPage(GESTURE.NONE, "Cmd-Enter outside a comment box is the page's");
  }
  if (chord && isKey(e.key, "c")) {
    if (e.hasSelection === true) {
      return taken(GESTURE.COMMENT_ON_SELECTION, "Cmd-Shift-C with a selection comments on that passage");
    }
    return taken(GESTURE.ENTER_ELEMENT_PICK, "Cmd-Shift-C with nothing selected picks an element");
  }
  if (chord && isKey(e.key, "e")) {
    if (e.inBlock === false) {
      return taken(GESTURE.ENTER_EDIT_STATE, "Cmd-Shift-E with the cursor in no block opens edit state with no block open");
    }
    return taken(GESTURE.EDIT_BLOCK, "Cmd-Shift-E edits the block under the cursor, and nothing else");
  }
  return handedToPage(GESTURE.NONE, "not a library gesture; the page and the edited block keep it");
}

function pointerDecision(e: PointerInput): GestureDecision {
  if (e.editing !== true || e.inEditedBlock === true) {
    return handedToPage(GESTURE.PAGE_DEFAULT, "a pointer going down with no edit open is the page's");
  }
  if (e.onScrollbar === true) {
    return handedToPage(GESTURE.PAGE_DEFAULT, "the press was on a scrollbar, which is scrolling rather than leaving the block");
  }
  if (e.button !== undefined && e.button !== null && e.button !== 0) {
    return handedToPage(GESTURE.PAGE_DEFAULT, "only a primary-button press is the reviewer leaving the block");
  }
  return handedToPage(GESTURE.COMMIT_EDIT, "the pointer went down outside the edited block, so the edit commits");
}

function choiceRefusal(e: ClickInput): string | null {
  if (e.inArmedChoice !== true) return "not a button in an armed choice group";
  if (e.documentPage !== true) return "a choice group arms only on a page the helper serves as a document";
  if (e.pickMode === true) return "element-pick mode is open, so the click picks";
  if (e.editing === true || e.editState === true) return "an edit is open, so the page is not in browse";
  if (e.presenting === true) return "the review is hidden for presenting";
  if (e.mayWrite !== true) return "this window is read-only for the review";
  return null;
}

function clickDecision(e: ClickInput): GestureDecision {
  if (e.inOverlay === true) {
    return neither(GESTURE.NONE, "inside the library's own overlay; the rail handles its own events");
  }
  if (e.pickMode === true) {
    return taken(GESTURE.PICK_ELEMENT, "element-pick mode is open, so this click comments on the element");
  }
  if (e.editing === true && e.inEditedBlock !== true) {
    return handedToPage(GESTURE.COMMIT_EDIT, "a click outside the edited block commits it, and the page still gets the click");
  }
  const refusal = choiceRefusal(e);
  if (refusal === null) {
    return taken(GESTURE.PRESS_CHOICE, "a click on an armed choice group's button is the reviewer's answer");
  }
  if (e.inArmedChoice === true) return handedToPage(GESTURE.PAGE_DEFAULT, refusal);
  return handedToPage(GESTURE.PAGE_DEFAULT, "browse is the page untouched");
}

export function gestureFor(input: GestureInput): GestureDecision {
  switch (input.type) {
    case "keydown":
      return keydownDecision(input);
    case "pointerdown":
    case "mousedown":
      return pointerDecision(input);
    case "click":
      return clickDecision(input);
  }
}

function rowFor(row: HintRow, sendKey: SendKey | undefined): HintRow {
  if (row.gesture !== GESTURE.MARK_READY) return row;
  const words = SEND_KEY_WORDS[normalizeSendKey(sendKey)];
  return { ...row, keys: words.keys, hint: words.hint, panelHint: words.panelHint };
}

export function hintFor(gesture: Gesture, sendKey?: SendKey): string | null {
  const row = TABLE.find((one) => one.gesture === gesture);
  return row === undefined ? null : rowFor(row, sendKey).hint;
}

export function hintLines(sendKey?: SendKey): readonly HintLine[] {
  return TABLE.map((row) => {
    const got = rowFor(row, sendKey);
    return { keys: got.keys, hint: got.hint };
  });
}

export function panelLines(sendKey?: SendKey): readonly HintLine[] {
  return TABLE.filter((row) => row.inPanel !== false).map((row) => {
    const got = rowFor(row, sendKey);
    return { keys: got.panelKeys ?? got.keys, hint: got.panelHint ?? got.hint };
  });
}

export interface ScrollbarGeometry {
  readonly x: number;
  readonly y: number;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly boxWidth: number;
  readonly boxHeight: number;
}

export function isScrollbarPress(geometry: ScrollbarGeometry): boolean {
  const inWidthGutter =
    geometry.contentWidth > 0 && geometry.x >= geometry.contentWidth && geometry.x <= geometry.boxWidth;
  const inHeightGutter =
    geometry.contentHeight > 0 && geometry.y >= geometry.contentHeight && geometry.y <= geometry.boxHeight;
  return inWidthGutter || inHeightGutter;
}

export const BREAK = { PARAGRAPH: "paragraph", LINE: "line" } as const;
export type BreakIntent = (typeof BREAK)[keyof typeof BREAK];

export interface BreakInput {
  readonly inputType?: string;
  readonly shiftKey?: boolean;
}

export function breakIntentFor(input: BreakInput): BreakIntent | null {
  if (input.inputType === "insertLineBreak") return BREAK.LINE;
  if (input.inputType === "insertParagraph") return input.shiftKey === true ? BREAK.LINE : BREAK.PARAGRAPH;
  return null;
}

export const FORMAT = { APPLY: "apply", REMOVE: "remove" } as const;
export type FormatIntent = (typeof FORMAT)[keyof typeof FORMAT];

export const FORMAT_COMMANDS = ["bold", "italic"] as const;
export type FormatCommand = (typeof FORMAT_COMMANDS)[number];

export interface FormatInput {
  readonly command?: string;
  readonly active?: boolean;
}

export function formatIntentFor(input: FormatInput): FormatIntent | null {
  if (!FORMAT_COMMANDS.some((command) => command === input.command)) return null;
  return input.active === true ? FORMAT.REMOVE : FORMAT.APPLY;
}

export type Platform = "mac" | "other";

export interface BlockTypeRow {
  readonly tag: string;
  readonly label: string;
  readonly code: string;
  readonly chords: { readonly mac: string; readonly other: string };
  readonly shortcuts: readonly string[];
}

export const BLOCK_TYPES = [
  {
    tag: "p",
    label: "Paragraph",
    code: "Digit0",
    chords: { mac: "Cmd-Option-0", other: "Ctrl-Shift-0" },
    shortcuts: []
  },
  {
    tag: "h2",
    label: "Heading",
    code: "Digit2",
    chords: { mac: "Cmd-Option-2", other: "Ctrl-Shift-2" },
    shortcuts: ["## ", "# "]
  },
  {
    tag: "h3",
    label: "Subheading",
    code: "Digit3",
    chords: { mac: "Cmd-Option-3", other: "Ctrl-Shift-3" },
    shortcuts: ["### "]
  },
  {
    tag: "h4",
    label: "Small heading",
    code: "Digit4",
    chords: { mac: "Cmd-Option-4", other: "Ctrl-Shift-4" },
    shortcuts: ["#### "]
  },
  {
    tag: "ul",
    label: "Bulleted list",
    code: "Digit8",
    chords: { mac: "Cmd-Shift-8", other: "Ctrl-Shift-8" },
    shortcuts: ["- ", "* "]
  },
  {
    tag: "ol",
    label: "Numbered list",
    code: "Digit7",
    chords: { mac: "Cmd-Shift-7", other: "Ctrl-Shift-7" },
    shortcuts: ["1. "]
  }
] as const;
export type BlockTag = (typeof BLOCK_TYPES)[number]["tag"];

export const OTHER_BLOCK_LABEL = "Other block";

const BLOCK_ROWS: readonly BlockTypeRow[] = BLOCK_TYPES;

export function blockTypeLabel(tag: string): string | null {
  return BLOCK_ROWS.find((row) => row.tag === tag)?.label ?? null;
}

export function chordLabelFor(tag: string, platform: Platform): string | null {
  const row = BLOCK_ROWS.find((one) => one.tag === tag);
  if (row === undefined) return null;
  return platform === "mac" ? row.chords.mac : row.chords.other;
}

export interface ChordInput extends Modifiers {
  readonly code?: string;
  readonly key?: string;
  readonly altGraph?: boolean;
  readonly platform?: Platform;
}

function isListTag(tag: BlockTag): boolean {
  return tag === "ul" || tag === "ol";
}

export function blockTypeChord(input: ChordInput): BlockTag | null {
  if (input.altGraph === true) return null;
  const mac = input.platform === "mac";
  for (const row of BLOCK_TYPES) {
    if (input.code !== row.code) continue;
    if (mac) {
      if (input.metaKey !== true || input.ctrlKey === true) return null;
      if (isListTag(row.tag)) return input.shiftKey === true && input.altKey !== true ? row.tag : null;
      return input.altKey === true && input.shiftKey !== true ? row.tag : null;
    }
    if (input.ctrlKey !== true || input.metaKey === true || input.altKey === true) return null;
    return input.shiftKey === true ? row.tag : null;
  }
  return null;
}

const NO_BREAK_SPACE = " ";

function hasShortcut(shortcuts: readonly string[], text: string): boolean {
  return shortcuts.includes(text);
}

export function markdownShortcutFor(textBeforeCaret: string): BlockTag | null {
  const text = textBeforeCaret.replaceAll(NO_BREAK_SPACE, " ");
  for (const row of BLOCK_TYPES) {
    if (hasShortcut(row.shortcuts, text)) return row.tag;
  }
  return null;
}

export const ENTER = {
  SIBLING: "sibling",
  SPLIT: "split",
  NEW_ITEM: "new_item",
  END_LIST: "end_list",
  LINE: "line",
  BREAK_RULE: "break_rule"
} as const;
export type EnterIntent = (typeof ENTER)[keyof typeof ENTER];

export interface EnterInput {
  readonly shiftKey?: boolean;
  readonly atEnd?: boolean;
  readonly inListItem?: boolean;
  readonly itemEmpty?: boolean;
  readonly lastItem?: boolean;
  readonly runAllowed?: boolean;
}

export function enterIntentFor(input: EnterInput): EnterIntent {
  if (input.shiftKey === true) return ENTER.LINE;
  if (input.runAllowed === false) return ENTER.BREAK_RULE;
  if (input.inListItem === true) {
    return input.itemEmpty === true && input.lastItem === true ? ENTER.END_LIST : ENTER.NEW_ITEM;
  }
  return input.atEnd === true ? ENTER.SIBLING : ENTER.SPLIT;
}

export const EDGE = {
  MERGE_PREVIOUS: "merge_previous",
  MERGE_NEXT: "merge_next",
  DELETE_SELECTION: "delete_selection",
  REFUSE: "refuse"
} as const;
export type EdgeIntent = (typeof EDGE)[keyof typeof EDGE];

export interface EdgeInput {
  readonly key?: string;
  readonly collapsed?: boolean;
  readonly spansBlocks?: boolean;
  readonly atBlockStart?: boolean;
  readonly atBlockEnd?: boolean;
  readonly firstBlock?: boolean;
  readonly lastBlock?: boolean;
}

export function edgeDeleteFor(input: EdgeInput): EdgeIntent | null {
  if (input.key !== "Backspace" && input.key !== "Delete") return null;
  if (input.collapsed === false) return input.spansBlocks === true ? EDGE.DELETE_SELECTION : null;
  if (input.key === "Backspace") {
    if (input.atBlockStart !== true) return null;
    return input.firstBlock === true ? EDGE.REFUSE : EDGE.MERGE_PREVIOUS;
  }
  if (input.atBlockEnd !== true) return null;
  return input.lastBlock === true ? EDGE.REFUSE : EDGE.MERGE_NEXT;
}

export const HISTORY = { UNDO: "undo", REDO: "redo" } as const;
export type HistoryIntent = (typeof HISTORY)[keyof typeof HISTORY];

export interface HistoryInput extends Modifiers {
  readonly code?: string;
  readonly key?: string;
  readonly inputType?: string;
  readonly editing?: boolean;
  readonly platform?: Platform;
}

export function historyIntentFor(input: HistoryInput): HistoryIntent | null {
  if (input.editing !== true) return null;
  if (input.inputType === "historyUndo") return HISTORY.UNDO;
  if (input.inputType === "historyRedo") return HISTORY.REDO;
  if (!isPrimaryModifier(input) || input.altKey === true) return null;
  if (input.code === "KeyZ" || isKey(input.key, "z")) return input.shiftKey === true ? HISTORY.REDO : HISTORY.UNDO;
  if (input.platform !== "mac" && input.ctrlKey === true && (input.code === "KeyY" || isKey(input.key, "y"))) {
    return HISTORY.REDO;
  }
  return null;
}
