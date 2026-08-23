// The gesture table.
//
// Owner: 0A-kernel. Imported by: the rail's hint lines (1B), the comment
// surface (1D), the edit surface (2A), and living-in-the-page (2D).
//
// D3's vocabulary, and D3's rule that makes it small: BROWSE IS THE PAGE
// UNTOUCHED. No intercepted clicks, no contentEditable, no captured keys beyond
// the library's own shortcuts. Links navigate, buttons act, forms submit, and
// the app's own JavaScript sees every event it would see without the library.
// That is R13 (the page keeps working), which outranks editing convenience.
//
// So this table is almost entirely keystrokes, and the click rules that remain
// are two: a click inside the library's own overlay is the overlay's, and a
// click while element-pick mode is open picks that element. Everything else is
// the page's, and the function says so by returning passThrough.
//
// Dead, and deliberately so: Alt-click (undiscoverable), plain-click-places-
// caret (it fought the page for every click, which is the inversion this
// design exists to make), Cmd-click-follows-link (browse is native, so a plain
// click already follows it), and the editing toggle (edit state is per region
// now, entered with Cmd-Shift-E).
//
// The function is pure over a plain descriptor rather than over a DOM event, so
// the whole table is unit-testable with no browser and 1D's and 2A's browser
// tests check the wiring rather than the rules.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;

  var GESTURE = {
    COMMENT_ON_SELECTION: "comment_on_selection",
    ENTER_ELEMENT_PICK: "enter_element_pick",
    PICK_ELEMENT: "pick_element",
    EDIT_BLOCK: "edit_block",
    MARK_READY: "mark_ready",
    COMMIT_EDIT: "commit_edit",
    CANCEL: "cancel",
    PAGE_DEFAULT: "page_default",
    NONE: "none"
  };

  // The table, as data, so the rail's hint lines and the README render from one
  // source. Every gesture appears as a hint line on the rail, which is what
  // lets a new user work the tool out from the page itself (R43).
  //
  // passThrough: the page's own handler runs (a link navigates, a button fires,
  //              a form submits).
  // preventDefault: the library calls preventDefault on the event.
  var TABLE = [
    {
      gesture: GESTURE.COMMENT_ON_SELECTION,
      keys: "Cmd-Shift-C",
      when: "text selected",
      hint: "Select text and press Cmd-Shift-C to comment on it.",
      passThrough: false,
      preventDefault: true,
      requirement: "R16"
    },
    {
      gesture: GESTURE.ENTER_ELEMENT_PICK,
      keys: "Cmd-Shift-C",
      when: "nothing selected",
      hint: "Press Cmd-Shift-C with nothing selected, then click any element to comment on the whole thing.",
      passThrough: false,
      preventDefault: true,
      requirement: "R17"
    },
    {
      gesture: GESTURE.PICK_ELEMENT,
      keys: "click",
      when: "element-pick mode is open",
      hint: "Click the outlined element to comment on it. Esc cancels.",
      passThrough: false,
      preventDefault: true,
      requirement: "R17"
    },
    {
      gesture: GESTURE.EDIT_BLOCK,
      keys: "Cmd-Shift-E",
      when: "the cursor or a selection is in a block",
      hint: "Press Cmd-Shift-E to edit the block you are in. Just that block.",
      passThrough: false,
      preventDefault: true,
      requirement: "R24"
    },
    {
      gesture: GESTURE.MARK_READY,
      keys: "Cmd-Enter",
      when: "a comment box is focused",
      hint: "Cmd-Enter when done with this comment.",
      passThrough: false,
      preventDefault: true,
      requirement: "R7"
    },
    {
      gesture: GESTURE.COMMIT_EDIT,
      keys: "Cmd-Enter, Esc, or a click outside",
      when: "a block is in edit state",
      hint: "Cmd-Enter, Esc, or click outside to finish the edit and give the page back.",
      passThrough: false,
      preventDefault: true,
      requirement: "R24"
    },
    {
      gesture: GESTURE.CANCEL,
      keys: "Esc",
      when: "element-pick mode is open, or a comment box is focused",
      hint: "Esc closes the comment box or cancels picking. Your draft is kept.",
      passThrough: false,
      preventDefault: true,
      requirement: "R1"
    },
    {
      gesture: GESTURE.PAGE_DEFAULT,
      keys: "everything else",
      when: "always",
      hint: "Everything else is the page. Links, buttons, and forms work exactly as they do without this.",
      passThrough: true,
      preventDefault: false,
      requirement: "R13"
    }
  ];

  // The library's own modifier family, in one place, so the hint lines and the
  // matcher cannot disagree. Cmd on macOS, Ctrl elsewhere: one rule.
  function isPrimaryModifier(e) {
    return e.metaKey === true || e.ctrlKey === true;
  }

  /**
   * The whole decision, in one place.
   *
   * @param {Object} input
   *   type          "click" | "keydown"
   *   metaKey       boolean
   *   ctrlKey       boolean
   *   shiftKey      boolean
   *   key           for keydown: the KeyboardEvent.key value
   *   hasSelection  true when a non-collapsed selection exists
   *   inOverlay     true when the event happened inside the library's overlay
   *   pickMode      true when element-pick mode is open
   *   editing       true when a block is currently in edit state
   *   inCommentBox  true when the focus is in a comment box
   *   inEditedBlock true when the event landed inside the block being edited
   * @returns {Object} {gesture, passThrough, preventDefault, reason}
   */
  function gestureFor(input) {
    var e = input || {};
    var mod = isPrimaryModifier(e);

    // The library's own UI is not the reviewed page. Saying so first stops
    // every rule below from needing the caveat.
    if (e.inOverlay === true && e.type === "click") {
      return decide(GESTURE.NONE, false, false, "inside the library's own overlay; the rail handles its own events");
    }

    if (e.type === "keydown") {
      if (e.key === "Escape") {
        if (e.editing === true) {
          return decide(GESTURE.COMMIT_EDIT, false, true, "Esc commits the open edit and gives the block back to the page");
        }
        if (e.pickMode === true || e.inCommentBox === true) {
          return decide(GESTURE.CANCEL, false, true, "Esc closes the box or cancels picking; the draft is kept either way");
        }
        return decide(GESTURE.NONE, true, false, "nothing of the library's is open, so Esc is the page's");
      }
      if (e.key === "Enter" && mod) {
        if (e.inCommentBox === true) {
          return decide(GESTURE.MARK_READY, false, true, "Cmd-Enter marks this comment ready for the agent (R7)");
        }
        if (e.editing === true) {
          return decide(GESTURE.COMMIT_EDIT, false, true, "Cmd-Enter commits the open edit and gives the block back to the page");
        }
        return decide(GESTURE.NONE, true, false, "Cmd-Enter outside a comment box is the page's");
      }
      if (mod && e.shiftKey === true && isKey(e.key, "c")) {
        if (e.hasSelection === true) {
          return decide(GESTURE.COMMENT_ON_SELECTION, false, true, "Cmd-Shift-C with a selection comments on that passage");
        }
        return decide(GESTURE.ENTER_ELEMENT_PICK, false, true, "Cmd-Shift-C with nothing selected picks an element (R17)");
      }
      if (mod && e.shiftKey === true && isKey(e.key, "e")) {
        return decide(GESTURE.EDIT_BLOCK, false, true, "Cmd-Shift-E edits the block under the cursor, and nothing else");
      }
      return decide(GESTURE.NONE, true, false, "not a library gesture; the page and the edited block keep it");
    }

    // THE POINTER GOING DOWN ANYWHERE OUTSIDE THE EDITED BLOCK COMMITS IT,
    // INCLUDING INSIDE THE LIBRARY'S OWN RAIL. The click rule below cannot do
    // this job on its own: a click on the rail retargets to the overlay host,
    // hits the overlay rule above, and the edit was left sitting in `draft`
    // forever. Status never offers drafts to an agent, so the reviewer watched
    // an edit they considered finished reach no agent at all (Ken's
    // session, 2026-08-16). Pointerdown is the honest moment the reviewer left
    // the block, it fires before focus moves, and the event still passes
    // through untouched so the rail and the page both get their click.
    //
    // TWO PRESSES THIS RULE MUST NOT READ AS LEAVING THE BLOCK:
    //
    //  1. A SCROLLBAR DRAG. Dragging the root or an inner scrollbar fires
    //     pointerdown on the element with no click after it, so the reviewer
    //     scrolling to see the rest of their edit had contenteditable stripped
    //     out from under their pointer mid-drag. `onScrollbar` is the caller's
    //     answer: the press landed past the target's content box.
    //  2. A SECONDARY BUTTON. Right-click opens a context menu; the reviewer is
    //     still on the page and still editing. Only button 0 is leaving.
    //
    // Both were regressions of the widening from click to pointerdown (review,
    // 2026-08-17). Window blur is the other way of leaving and is unaffected.
    if (e.type === "pointerdown" || e.type === "mousedown") {
      if (e.editing === true && e.inEditedBlock !== true) {
        if (e.onScrollbar === true) {
          return decide(GESTURE.PAGE_DEFAULT, true, false, "the press was on a scrollbar, which is scrolling rather than leaving the block");
        }
        // Undefined means a caller that cannot tell, and every keyboard-driven
        // and synthetic press in that shape is a primary one.
        if (e.button !== undefined && e.button !== null && e.button !== 0) {
          return decide(GESTURE.PAGE_DEFAULT, true, false, "only a primary-button press is the reviewer leaving the block");
        }
        return decide(GESTURE.COMMIT_EDIT, true, false, "the pointer went down outside the edited block, so the edit commits");
      }
      return decide(GESTURE.PAGE_DEFAULT, true, false, "a pointer going down with no edit open is the page's");
    }

    if (e.type !== "click") {
      return decide(GESTURE.NONE, true, false, "not a click or a keydown");
    }

    // Element-pick mode is the ONE time the library takes a click on the page.
    // It is entered deliberately, by a keystroke, and Esc cancels it.
    if (e.pickMode === true) {
      return decide(GESTURE.PICK_ELEMENT, false, true, "element-pick mode is open, so this click comments on the element");
    }

    // A click outside the block being edited commits the edit. The click still
    // reaches the page: browse is native, so clicking a link while an edit is
    // open both commits the edit and follows the link (R1 names navigation).
    if (e.editing === true && e.inEditedBlock !== true) {
      return decide(GESTURE.COMMIT_EDIT, true, false, "a click outside the edited block commits it, and the page still gets the click");
    }

    return decide(GESTURE.PAGE_DEFAULT, true, false, "browse is the page untouched (D3, R13)");
  }

  /**
   * Did a press land on a scrollbar rather than on content?
   *
   * The geometry, not the DOM: the caller measures, this decides, so the rule is
   * unit-testable with no browser the way every other rule in this file is. One
   * shape covers both scrollbars a page has. An element's `clientWidth` stops at
   * its content box while its border box includes the scrollbar gutter, and the
   * root's scrollbar sits outside the document element with the viewport as the
   * outer edge; either way the press is past the content and inside the box.
   *
   * @param {{x: number, y: number, contentWidth: number, contentHeight: number,
   *          boxWidth: number, boxHeight: number}} geometry
   *   `x` and `y` are the press relative to the content box's top-left corner.
   * @returns {boolean}
   */
  function isScrollbarPress(geometry) {
    var g = geometry || {};
    if (typeof g.x !== "number" || typeof g.y !== "number") return false;
    if (g.contentWidth > 0 && g.x >= g.contentWidth && g.x <= g.boxWidth) return true;
    if (g.contentHeight > 0 && g.y >= g.contentHeight && g.y <= g.boxHeight) return true;
    return false;
  }

  // ---------------------------------------------------------------------------
  // What Enter means inside a block that is in edit state
  // ---------------------------------------------------------------------------
  //
  // Enter is NOT a library shortcut, which is why it has no row in the table
  // above and no hint on the rail: it is typing. But the record has to say
  // which break the reviewer typed, and left to itself no two engines agree.
  // Measured on 2026-08-23, the same keystroke in the same bare
  // `<p contenteditable>`:
  //
  //   Enter        Chromium and WebKit write a nested block, Firefox writes a
  //                <br>. Read back through the normalizer that is a paragraph
  //                break in two engines and a line break in the third, so a
  //                Firefox reviewer's "new paragraph" reached the agent as a
  //                line break.
  //   Shift-Enter  Chromium and Firefox write a <br>. WebKit writes a nested
  //                block, so a WebKit reviewer's "new line" reached the agent
  //                as a paragraph break.
  //
  // So the layer says what the key meant instead of asking the engine. It reads
  // the intent here, cancels the engine's own insertion, and writes the break
  // itself (src/layer/editing.js).
  //
  // ONE ENGINE QUIRK THIS FUNCTION EXISTS TO ABSORB: `inputType` alone is not
  // enough. WebKit reports Shift-Enter as `insertParagraph`, the same value it
  // reports for a bare Enter, so the two gestures are indistinguishable from
  // the input event. The Shift state of the Enter keydown that produced it is
  // the tie-breaker, and it is the caller's to supply because a beforeinput
  // event does not carry one.
  var BREAK = {
    PARAGRAPH: "paragraph",
    LINE: "line"
  };

  /**
   * Which break an input event is asking for, or null when it is not a break.
   *
   * Pure over a plain descriptor, like everything else in this file, so the
   * rule is unit-testable with no browser.
   *
   * @param {Object} input
   *   inputType  the InputEvent.inputType value
   *   shiftKey   true when the Enter keydown that produced it held Shift
   * @returns {(string|null)} a BREAK value, or null
   */
  function breakIntentFor(input) {
    var e = input || {};
    if (e.inputType === "insertLineBreak") return BREAK.LINE;
    if (e.inputType === "insertParagraph") {
      return e.shiftKey === true ? BREAK.LINE : BREAK.PARAGRAPH;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // What pressing B or I means
  // ---------------------------------------------------------------------------
  //
  // The same shape as the break above, for the same reason. A formatting button
  // is one button doing two opposite things, and which one it is doing is
  // decided by what the reviewer is looking at, never by the engine:
  //
  //   the words are not bold yet   the reviewer is asking for bold
  //   the words already look bold  the reviewer is asking for it to come off,
  //                                and it does not matter whether they look
  //                                bold because of a <strong> or because of a
  //                                rule in the page's stylesheet
  //
  // That second row is the whole reason this exists. Left to the engine, taking
  // bold off text a stylesheet made bold produced a style attribute the tool
  // cannot keep, and taking italic off text a stylesheet made italic produced
  // nothing at all in Firefox. Measured in all three engines on 2026-08-23:
  //
  //   Chromium, WebKit  <span style="font-weight: normal">, both formats
  //   Firefox           the same for bold, and for italic no change whatever:
  //                     the click did not happen
  //
  // The layer reads the intent here and then writes the markup itself, so all
  // three record the same thing (src/layer/editing.js, FORMAT_SHAPE).
  var FORMAT = {
    APPLY: "apply",
    REMOVE: "remove"
  };

  // The closed list R24 allows for v1. Named here because this file is where
  // the tool says what a gesture means, and a command outside the list is not a
  // gesture this tool has.
  var FORMAT_COMMANDS = ["bold", "italic"];

  /**
   * Which way a formatting command is meant to go, or null when the command is
   * not one of the two this tool has.
   *
   * Pure over a plain descriptor, like everything else in this file, so the
   * rule is unit-testable with no browser.
   *
   * @param {Object} input
   *   command  "bold" or "italic"
   *   active   true when the selected words already carry that format, however
   *            they came to carry it
   * @returns {(string|null)} a FORMAT value, or null
   */
  function formatIntentFor(input) {
    var e = input || {};
    if (FORMAT_COMMANDS.indexOf(e.command) === -1) return null;
    return e.active === true ? FORMAT.REMOVE : FORMAT.APPLY;
  }

  // KeyboardEvent.key is lowercase unless Shift is held, and it is the layout's
  // character. Comparing case-insensitively is what makes Cmd-Shift-C work.
  function isKey(key, letter) {
    return typeof key === "string" && key.toLowerCase() === letter;
  }

  function decide(gesture, passThrough, preventDefault, reason) {
    return {
      gesture: gesture,
      passThrough: passThrough,
      preventDefault: preventDefault,
      reason: reason
    };
  }

  function hintFor(gesture) {
    for (var i = 0; i < TABLE.length; i += 1) {
      if (TABLE[i].gesture === gesture) return TABLE[i].hint;
    }
    return null;
  }

  // Every row, as the rail renders it: the keystroke and the sentence. AC6
  // scores that every gesture appears on the rail with its exact keystroke,
  // without opening a menu.
  function hintLines() {
    return TABLE.map(function (row) {
      return { keys: row.keys, hint: row.hint };
    });
  }

  var api = {
    GESTURE: GESTURE,
    BREAK: BREAK,
    FORMAT: FORMAT,
    FORMAT_COMMANDS: FORMAT_COMMANDS,
    TABLE: TABLE,
    gestureFor: gestureFor,
    breakIntentFor: breakIntentFor,
    formatIntentFor: formatIntentFor,
    isScrollbarPress: isScrollbarPress,
    hintFor: hintFor,
    hintLines: hintLines,
    isPrimaryModifier: isPrimaryModifier
  };

  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.gestures = api;
  } else {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
