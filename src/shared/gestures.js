// The gesture table.
//
// Owner: Task 0a (shared kernel). Imported by: the rail (1B-i), click
// interception and the editing toggle (2D), the edit recorder (2A-i).
//
// One table, because the gestures collide with each other in ways that only
// show up when two builders each implement half of it: a plain click has to
// place the caret AND not submit the form (R37), Alt-click has to comment on an
// element AND not place the caret (R15), Cmd-click has to follow a link AND not
// comment (R38), and a Cmd-click on a link that sits inside a commentable block
// is all three at once.
//
// The function is pure over a plain descriptor rather than over a DOM event, so
// the whole table is unit-testable with no browser and 2D's browser tests check
// the wiring rather than the rules.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;

  var GESTURE = {
    PLACE_CARET: "place_caret",
    COMMENT_ON_ELEMENT: "comment_on_element",
    COMMENT_ON_SELECTION: "comment_on_selection",
    FOLLOW_LINK: "follow_link",
    PAGE_DEFAULT: "page_default",
    EXTEND_SELECTION: "extend_selection",
    TOGGLE_EDITING: "toggle_editing",
    SEND: "send",
    DISMISS: "dismiss",
    NONE: "none"
  };

  // The table, as data, so it can be rendered into the hover hint and the
  // README from one source.
  //
  // passThrough: the page's own handler runs (a link navigates, a button fires,
  //              a form submits).
  // preventDefault: the layer calls preventDefault on the event.
  var TABLE = [
    {
      gesture: GESTURE.PLACE_CARET,
      when: "plain click, editing on",
      hint: "Click to put the cursor in the text and start typing.",
      passThrough: false,
      preventDefault: true,
      requirement: "R22, R37"
    },
    {
      gesture: GESTURE.COMMENT_ON_ELEMENT,
      when: "Alt-click any element, editing on or off",
      hint: "Alt-click an image, a chart, or a card to comment on the whole thing.",
      passThrough: false,
      preventDefault: true,
      requirement: "R15"
    },
    {
      gesture: GESTURE.COMMENT_ON_SELECTION,
      when: "text selected, then the comment key or the rail button",
      hint: "Select a passage and press the comment key to write a note about it.",
      passThrough: false,
      preventDefault: true,
      requirement: "R14"
    },
    {
      gesture: GESTURE.FOLLOW_LINK,
      when: "Cmd-click (Ctrl-click on Linux) a link, editing on",
      hint: "Hold Cmd and click a link to follow it without leaving the review.",
      passThrough: true,
      preventDefault: false,
      requirement: "R38"
    },
    {
      gesture: GESTURE.PAGE_DEFAULT,
      when: "any click while editing is toggled off",
      hint: "Editing is off. The page works normally. Alt-click still comments.",
      passThrough: true,
      preventDefault: false,
      requirement: "R38"
    },
    {
      gesture: GESTURE.EXTEND_SELECTION,
      when: "Shift-click, editing on",
      hint: "Shift-click to extend the selection, the way it works anywhere else.",
      passThrough: false,
      preventDefault: false,
      requirement: "R23"
    },
    {
      gesture: GESTURE.TOGGLE_EDITING,
      when: "the rail's editing toggle, or the toggle key",
      hint: "Turn editing off to use the app for real. Your feedback is untouched.",
      passThrough: false,
      preventDefault: true,
      requirement: "R38"
    },
    {
      gesture: GESTURE.SEND,
      when: "the Send button, or Cmd-Enter",
      hint: "Send everything outstanding. Works with no agent running.",
      passThrough: false,
      preventDefault: true,
      requirement: "R4, R5"
    },
    {
      gesture: GESTURE.DISMISS,
      when: "Escape",
      hint: "Escape closes the open compose box; a second Escape collapses the rail.",
      passThrough: false,
      preventDefault: true,
      requirement: "R18"
    }
  ];

  // Escape's two meanings, in order. Stated as data so 1B-i and 2D cannot
  // disagree about which comes first.
  var ESCAPE_ORDER = ["close_open_compose", "collapse_rail"];

  /**
   * The whole decision, in one place.
   *
   * @param {Object} input
   *   type          "click" | "keydown"
   *   altKey        boolean
   *   metaKey       boolean
   *   ctrlKey       boolean
   *   shiftKey      boolean
   *   key           for keydown: the KeyboardEvent.key value
   *   editingEnabled  false while the editing toggle is off
   *   onLink        true when the click landed on or inside an anchor with an href
   *   hasSelection  true when a non-collapsed selection exists
   *   inOverlay     true when the event happened inside the tool's own overlay
   * @returns {Object} {gesture, passThrough, preventDefault, reason}
   */
  function gestureFor(input) {
    var e = input || {};
    var mod = e.metaKey === true || e.ctrlKey === true;

    // The tool's own UI is not the reviewed page. Nothing here applies inside
    // it, and saying so first stops every rule below from needing the caveat.
    if (e.inOverlay === true) {
      return decide(GESTURE.NONE, false, false, "inside the tool's own overlay; the rail handles its own events");
    }

    if (e.type === "keydown") {
      if (e.key === "Escape") {
        return decide(GESTURE.DISMISS, false, true, "Escape closes the compose box, then collapses the rail");
      }
      if (e.key === "Enter" && mod) {
        return decide(GESTURE.SEND, false, true, "Cmd-Enter sends");
      }
      return decide(GESTURE.NONE, true, false, "not a layer gesture; the page and the editable surface keep it");
    }

    if (e.type !== "click") {
      return decide(GESTURE.NONE, true, false, "not a click or a keydown");
    }

    // Alt-click comments, in both editing states. D13 says commenting stays
    // available while the editing toggle is off, and this is the gesture that
    // delivers that.
    if (e.altKey === true) {
      return decide(GESTURE.COMMENT_ON_ELEMENT, false, true, "Alt-click comments on the whole element");
    }

    if (e.editingEnabled === false) {
      return decide(GESTURE.PAGE_DEFAULT, true, false, "editing is toggled off, so the page behaves normally");
    }

    // Cmd-click over a link inside a commentable block: the link wins, and
    // nothing is commented. Both gestures are plausible here and one of them
    // has to be written down; the reviewer's intent when they hold Cmd on a
    // link is to go there, and commenting has Alt-click, which is unambiguous.
    if (mod === true && e.onLink === true) {
      return decide(GESTURE.FOLLOW_LINK, true, false, "Cmd-click on a link follows it; Alt-click is how you comment on it");
    }

    if (mod === true) {
      return decide(GESTURE.PLACE_CARET, false, true, "Cmd-click away from a link has nothing to follow, so it places the caret");
    }

    if (e.shiftKey === true) {
      return decide(GESTURE.EXTEND_SELECTION, false, false, "Shift-click extends the selection natively");
    }

    return decide(GESTURE.PLACE_CARET, false, true, "a plain click places the cursor and never fires the page's behavior");
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

  var api = {
    GESTURE: GESTURE,
    TABLE: TABLE,
    ESCAPE_ORDER: ESCAPE_ORDER,
    gestureFor: gestureFor,
    hintFor: hintFor
  };

  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.gestures = api;
  } else {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
