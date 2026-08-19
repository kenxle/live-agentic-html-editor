// Comment boxes, element-pick mode, and the untethered note.
//
// Owner: 1D. Implements architecture D3 (the gesture vocabulary, browse is the
// page untouched) for the comment half, and leans on D8 (highlights that do not
// change the page) for everything it paints.
//
// ---------------------------------------------------------------------------
// What a reviewer does, and what happens
// ---------------------------------------------------------------------------
//
//   Cmd-Shift-C with text selected     a box opens already focused on that
//                                      passage, and the passage is painted
//   Cmd-Shift-C with nothing selected  element-pick mode: hovering outlines the
//                                      element under the pointer, clicking one
//                                      comments on the whole thing, Esc cancels
//   a box at the foot of the thread    a note tied to nothing (R18)
//   Cmd-Enter                          marks the comment ready. Nothing that is
//                                      not ready is actionable (R7)
//   Esc                                closes the box, KEEPING the draft
//   typing in a card's own note        THE rewording gesture. There is no
//                                      button: the words on the card are the
//                                      input, and editing a ready comment drops
//                                      it back to draft (green wash to amber)
//                                      until the reviewer commits it again
//   rewording a ready comment          bumps its revision ONCE, when the
//                                      rewording commits, never per keystroke
//                                      (R21)
//   deleting                           the reviewer's own act, and the only
//                                      thing that ever removes an item
//
// ---------------------------------------------------------------------------
// Four rules this file must not lose
// ---------------------------------------------------------------------------
//
//  1. THE BOX IS NEVER RE-CREATED WHILE IT HOLDS FOCUS. Opening a box for an id
//     that already has one returns the same node. A rail that rebuilds its
//     cards on every repaint is the single largest revert mechanism in the tool
//     being replaced.
//  2. NOTHING THE LIBRARY ADDS EVER REACHES A RECORD. Every node here is marked
//     as the library's, and every node here lives inside the closed shadow
//     surface, so the normalizer strips it and the page's CSS cannot reach it.
//  3. EVERY KEYSTROKE IS DURABLE, SYNCHRONOUSLY. Not on a timer, not on blur.
//  4. NOTHING IS WRITTEN TO THE REVIEWED PAGE. No outline on a hovered element,
//     no wrapper around a highlighted range, no class on a commented block. The
//     pick outline is a rectangle drawn in the library's own shadow root over
//     the element's bounding box, which is why ranked test 18 can assert that
//     every block's rectangle is unchanged.
//
// The gesture decisions are NOT made here. They come from the one pure table in
// src/shared/gestures.js, so the rail's hint lines and this file's behavior
// cannot drift apart.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.comments = factory(
      root.LAHE.markers,
      root.LAHE.normalize,
      root.LAHE.record,
      root.LAHE.regions,
      root.LAHE.store,
      root.LAHE.gestures,
      root.LAHE.anchor,
      root.LAHE.highlight,
      root.LAHE.listeners
    );
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/normalize.js"),
      require("../shared/record.js"),
      require("../shared/regions.js"),
      require("./store.js"),
      require("../shared/gestures.js"),
      require("./anchor.js"),
      require("./highlight.js"),
      require("./listeners.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  markers,
  normalize,
  record,
  regions,
  storeModule,
  gestures,
  anchor,
  highlightModule,
  listeners
) {
  "use strict";

  var BOX_CLASS = "lahe-comment-box";
  var INPUT_CLASS = "lahe-comment-input";
  var OUTLINE_CLASS = "lahe-pick-outline";
  var PILL_CLASS = "lahe-sel-pill";
  var PILL_BTN_CLASS = "lahe-sel-act";
  var PILL_TIP_CLASS = "lahe-sel-tip";
  // The registry group, from the one place both this file and inject.js read it.
  // The remount clears exactly the groups it re-registers, so this name has to be
  // a constant rather than a literal in two files.
  var LISTENER_GROUP = listeners.GROUP.COMMENTS;

  // Ken's copy, exactly. One spelling, used on every card.
  var HINT_READY = "Cmd-Enter when done with this comment";

  // ---------------------------------------------------------------------------
  // Editing the words in place
  // ---------------------------------------------------------------------------
  //
  // Ken, on the Reword button: "do we really need a button for 'reword'? before
  // we could just edit a comment and the color would go from green to yellow and
  // that was how we knew."
  //
  // So a card's note is the input. The gesture is the oldest one there is: click
  // the words and type. What it starts is exactly the rewording session the
  // button used to start, so there is ONE set of rules for a rewording (R21):
  // keystrokes are content, the commit is the revision.
  //
  // The node is a contenteditable one and NOT a textarea, deliberately:
  //
  //   the rail's law is that a card holding focus is never re-created, and a
  //   node swapped for a control on click is that same revert by another name.
  //   The note the reviewer reads and the note they type in are ONE node, which
  //   is created once with the row and never replaced.
  //
  //   a textarea would also need its own height driven from its scrollHeight on
  //   every keystroke to keep flowing like prose, and a card whose height is
  //   computed in two places is a card that jumps.
  //
  // plaintext-only where the engine has it, so a paste cannot put markup inside
  // the reviewer's sentence. The value is FEATURE-DETECTED rather than assumed:
  // an engine that does not know it maps the attribute to plain "true", which is
  // still editable, and the read below flattens whatever it produces anyway.
  var EDITABLE_PLAIN = "plaintext-only";
  var EDITABLE_ANY = "true";

  function editableValue(doc) {
    if (!doc || typeof doc.createElement !== "function") return EDITABLE_ANY;
    try {
      var probe = doc.createElement("div");
      probe.setAttribute("contenteditable", EDITABLE_PLAIN);
      return probe.contentEditable === EDITABLE_PLAIN ? EDITABLE_PLAIN : EDITABLE_ANY;
    } catch (err) {
      return EDITABLE_ANY;
    }
  }

  /**
   * The plain text of an editable node, with its line breaks kept.
   *
   * textContent alone would run two typed lines together, because a browser
   * makes a line break out of a <br> or a wrapper element rather than out of a
   * newline character. innerText would be right and is not usable here: it
   * returns the rendered text, and these nodes live in a closed shadow root
   * inside a rail that may be collapsed, where it falls back to textContent
   * anyway.
   */
  function plainTextOf(node) {
    if (!node) return "";
    var out = "";
    var children = node.childNodes || [];
    for (var i = 0; i < children.length; i += 1) {
      var child = children[i];
      if (child.nodeType === 3) {
        out += child.nodeValue;
      } else if (child.nodeType === 1) {
        var tag = String(child.tagName || "").toUpperCase();
        if (tag === "BR") {
          out += "\n";
        } else {
          // A block the engine wrapped a new line in. The first one continues
          // the line above it; every later one starts its own.
          if (out && !/\n$/.test(out)) out += "\n";
          out += plainTextOf(child);
        }
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // The selection popover
  // ---------------------------------------------------------------------------
  //
  // Ken, after using the tool for real: "when i highlight things, i no longer get
  // the button popup with the comment button. that was actually nice." The
  // hotkeys are unchanged and remain the fast path. This is the affordance ON TOP
  // of them, and it teaches the keystroke while it is used: hovering a button
  // shows the keycap for the gesture that button runs.
  //
  // It obeys D3 (browse is the page untouched) by intercepting nothing. It reads
  // selectionchange, which every page fires anyway, and draws a pill in the
  // library's own closed surface at the selection's own rectangle. The page's
  // DOM, layout and events are exactly what they were, which is why the
  // page-identical law still holds with the library booted and nothing selected.
  //
  // The one event it does take is a mousedown on its own buttons, and it takes it
  // to PREVENT the default: without that, pressing the button collapses the
  // selection before the gesture that needs the selection can run.
  //
  // It is bound in the comments listener group, so a window that goes read-only
  // loses the pill with the rest of the gestures. An affordance offering to do
  // something the window cannot do is worse than no affordance.

  // How long after the last selectionchange the pill appears. A drag fires the
  // event on every mouse move, and a pill that chased the cursor through a drag
  // would be the loudest thing on the page.
  var POPOVER_DELAY_MS = 150;
  var POPOVER_GAP = 8;

  // The keycaps, per platform, matching the family gestures.js actually accepts
  // (isPrimaryModifier: Cmd on macOS, Ctrl everywhere else). One place, so the
  // tooltip cannot promise a key the table does not take.
  function isMacPlatform() {
    var nav = typeof navigator !== "undefined" ? navigator : null;
    if (!nav) return false;
    var uaData = nav.userAgentData;
    var name = (uaData && uaData.platform) || nav.platform || nav.userAgent || "";
    return /mac/i.test(String(name));
  }

  var IS_MAC = isMacPlatform();
  var PRIMARY_CAP = IS_MAC ? "⌘" : "Ctrl";
  var SHIFT_CAP = IS_MAC ? "⇧" : "Shift";
  var POPOVER_KEYS = {
    comment: [PRIMARY_CAP, SHIFT_CAP, "C"],
    edit: [PRIMARY_CAP, SHIFT_CAP, "E"]
  };

  // The two offers, in the order a reviewer wants them: commenting is the common
  // act, editing is the deliberate one.
  var POPOVER_ACTIONS = [
    { action: "comment", label: "Comment", keys: POPOVER_KEYS.comment, aria: "Comment on this selection" },
    { action: "edit", label: "Edit", keys: POPOVER_KEYS.edit, aria: "Edit the block holding this selection" }
  ];

  // The pill's look. The rail's register, restated in hex because the rail's CSS
  // variables live in the RAIL's shadow root and this stylesheet goes into the
  // surface root. The keycap rule is the rail's keycap rule, value for value, so
  // the two read as one product.
  var PILL_STYLE = [
    "." + PILL_CLASS + " {",
    "  position: fixed;",
    "  display: none;",
    "  align-items: center;",
    "  gap: 2px;",
    "  padding: 3px;",
    "  border-radius: 999px;",
    "  border: 1px solid rgba(17, 17, 17, 0.12);",
    "  background: #ffffff;",
    "  box-shadow: 0 6px 20px rgba(17, 17, 17, 0.16), 0 1px 2px rgba(17, 17, 17, 0.08);",
    "  font: 12.5px/1 ui-sans-serif, system-ui, -apple-system, sans-serif;",
    "  color: #15171c;",
    "  pointer-events: auto;",
    "  z-index: 3;",
    "}",
    "." + PILL_CLASS + "[data-lahe-shown='true'] { display: flex; }",
    "." + PILL_BTN_CLASS + " {",
    "  border: 0;",
    "  background: transparent;",
    "  border-radius: 999px;",
    "  padding: 6px 12px;",
    "  font: inherit;",
    "  font-weight: 550;",
    "  color: inherit;",
    "  cursor: pointer;",
    "  white-space: nowrap;",
    "}",
    "." + PILL_BTN_CLASS + ":hover { background: rgba(60, 86, 165, 0.10); color: #2c3f7d; }",
    "." + PILL_BTN_CLASS + ":focus-visible { outline: 2px solid #3c56a5; outline-offset: -1px; }",
    ".lahe-sel-sep { width: 1px; height: 15px; background: rgba(17, 17, 17, 0.12); flex: none; }",
    // The tooltip. Never over the passage: it goes on the far side of the pill
    // from the selection, which is what the placement attribute decides.
    "." + PILL_TIP_CLASS + " {",
    "  position: absolute;",
    "  display: none;",
    "  align-items: center;",
    "  gap: 3px;",
    "  padding: 5px 7px;",
    "  border-radius: 8px;",
    "  border: 1px solid rgba(17, 17, 17, 0.12);",
    "  background: #ffffff;",
    "  box-shadow: 0 4px 14px rgba(17, 17, 17, 0.14);",
    "  transform: translateX(-50%);",
    "  white-space: nowrap;",
    "  pointer-events: none;",
    "}",
    "." + PILL_TIP_CLASS + "[data-lahe-shown='true'] { display: flex; }",
    "." + PILL_CLASS + "[data-lahe-placement='above'] ." + PILL_TIP_CLASS + " { bottom: calc(100% + 6px); }",
    "." + PILL_CLASS + "[data-lahe-placement='below'] ." + PILL_TIP_CLASS + " { top: calc(100% + 6px); }",
    // The rail's keycap, value for value.
    ".lahe-sel-cap {",
    "  font-family: inherit;",
    "  font-size: 11px;",
    "  font-weight: 600;",
    "  color: #15171c;",
    "  background: #eef0f4;",
    "  border: 1px solid #e2e5eb;",
    "  border-bottom-width: 2px;",
    "  border-radius: 5px;",
    "  padding: 1px 5px;",
    "  letter-spacing: 0.01em;",
    "}",
    ":host([data-lahe-scheme='dark']) ." + PILL_CLASS + " { background: #1c2028; color: #e9ebf0;",
    "  border-color: rgba(255,255,255,0.16);",
    "  box-shadow: 0 1px 2px rgba(0,0,0,.4), 0 16px 40px rgba(0,0,0,.45); }",
    ":host([data-lahe-scheme='dark']) ." + PILL_BTN_CLASS + ":hover { background: rgba(147, 167, 234, 0.18);",
    "  color: #b7c4f2; }",
    ":host([data-lahe-scheme='dark']) .lahe-sel-sep { background: rgba(255,255,255,0.16); }",
    ":host([data-lahe-scheme='dark']) ." + PILL_TIP_CLASS + " { background: #1c2028;",
    "  border-color: rgba(255,255,255,0.16); }",
    ":host([data-lahe-scheme='dark']) .lahe-sel-cap { background: #0f1216; border-color: #2c313b;",
    "  color: #e9ebf0; }"
  ].join("\n");

  // The box's own look. Quiet: a card the reviewer can ignore while they read,
  // and unmistakably not part of the page. It lives in the shadow root, so
  // nothing here can leak into the page and the page cannot restyle it.
  var BOX_STYLE = [
    ":host, * { box-sizing: border-box; }",
    "." + BOX_CLASS + " {",
    "  position: fixed;",
    "  width: 288px;",
    "  max-width: calc(100vw - 32px);",
    "  pointer-events: auto;",
    "  display: flex;",
    "  flex-direction: column;",
    "  gap: 8px;",
    "  padding: 12px;",
    "  border-radius: 10px;",
    "  border: 1px solid rgba(17, 17, 17, 0.12);",
    "  background: #ffffff;",
    "  box-shadow: 0 8px 28px rgba(17, 17, 17, 0.16), 0 1px 2px rgba(17, 17, 17, 0.08);",
    "  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;",
    "  color: #111111;",
    "}",
    "." + BOX_CLASS + "[data-lahe-placement='inline'] {",
    "  position: static;",
    "  width: auto;",
    "  box-shadow: none;",
    "  border-color: rgba(17, 17, 17, 0.16);",
    "}",
    // The drag strip. The rail's dotted idiom, quiet enough to read as texture
    // until the reviewer wants to move the box.
    ".lahe-comment-grip {",
    "  height: 10px;",
    "  margin: -4px -4px 0 -4px;",
    "  border-radius: 6px;",
    "  cursor: grab;",
    "  touch-action: none;",
    "  user-select: none;",
    "  -webkit-user-select: none;",
    "  background-image: radial-gradient(rgba(17,17,17,0.28) 1px, transparent 1px);",
    "  background-size: 5px 5px;",
    "  background-position: center;",
    "  background-repeat: repeat-x;",
    "}",
    "." + BOX_CLASS + "[data-lahe-placement='inline'] .lahe-comment-grip { display: none; }",
    "." + BOX_CLASS + "[data-lahe-dragging='true'] { user-select: none; -webkit-user-select: none; }",
    "." + BOX_CLASS + "[data-lahe-dragging='true'] .lahe-comment-grip { cursor: grabbing; }",
    // The two controls, in the rail's own card-action register: small, outlined,
    // under the reviewer's sentence and never competing with it.
    ".lahe-comment-acts {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  gap: 8px;",
    "}",
    ".lahe-comment-act {",
    "  font: inherit;",
    "  font-size: 11.5px;",
    "  font-weight: 550;",
    "  color: rgba(17, 17, 17, 0.62);",
    "  border: 1px solid rgba(17, 17, 17, 0.12);",
    "  border-radius: 7px;",
    "  padding: 3px 9px;",
    "  background: #ffffff;",
    "  cursor: pointer;",
    "}",
    ".lahe-comment-act:hover { color: #111111; background: rgba(17, 17, 17, 0.04); }",
    ".lahe-comment-act:focus-visible { outline: 2px solid rgba(60, 86, 165, 0.9); outline-offset: 1px; }",
    ".lahe-comment-act[disabled] { opacity: 0.45; cursor: default; }",
    ".lahe-comment-act--quiet { border-color: transparent; background: none; padding: 3px 5px; }",
    ".lahe-comment-act--quiet:hover { background: rgba(17, 17, 17, 0.04);",
    "  border-color: rgba(17, 17, 17, 0.08); }",
    ".lahe-comment-quote {",
    "  margin: 0;",
    "  padding-left: 8px;",
    // The accent, not the amber. Amber means "this needs you" everywhere else in
    // the product, and a quote of the passage being commented on needs nobody.
    "  border-left: 2px solid rgba(60, 86, 165, 0.75);",
    "  color: rgba(17, 17, 17, 0.62);",
    "  font-size: 12px;",
    "  max-height: 3.2em;",
    "  overflow: hidden;",
    "}",
    "." + INPUT_CLASS + " {",
    "  width: 100%;",
    "  min-height: 66px;",
    // No native grabber. It is the one place the box looked like a form control
    // dropped on the page instead of a surface, and the box already grows.
    "  resize: none;",
    "  border: 1px solid rgba(17, 17, 17, 0.16);",
    "  border-radius: 6px;",
    "  padding: 7px 8px;",
    "  font: inherit;",
    "  color: inherit;",
    "  background: #ffffff;",
    "}",
    "." + INPUT_CLASS + ":focus-visible, ." + INPUT_CLASS + ":focus {",
    "  outline: 2px solid rgba(60, 86, 165, 0.9);",
    "  outline-offset: 1px;",
    "  border-color: transparent;",
    "}",
    ".lahe-comment-foot {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  gap: 8px;",
    "  color: rgba(17, 17, 17, 0.5);",
    "  font-size: 11px;",
    "}",
    ".lahe-comment-state[data-state='ready'] { color: rgba(17, 17, 17, 0.72); }",
    // Pick mode is the reviewer choosing something, not the tool warning them,
    // so the outline is the one accent rather than a saturated orange. It was
    // the loudest colour moment anywhere in the product and it meant "normal".
    "." + OUTLINE_CLASS + " {",
    "  position: fixed;",
    "  pointer-events: none;",
    "  border-radius: 4px;",
    "  outline: 2px solid rgba(60, 86, 165, 0.95);",
    "  outline-offset: 2px;",
    "  background: rgba(60, 86, 165, 0.10);",
    "  z-index: 1;",
    "  display: none;",
    "}",
    // The PAGE picks the scheme, not the OS: a black comment card floating on a
    // white page is the loudest possible way to be a polite overlay.
    // highlight.js samples the page's background and stamps the surface host.
    ":host([data-lahe-scheme='dark']) ." + BOX_CLASS + " { background: #1b1b1d; color: #f2f2f2; border-color: rgba(255,255,255,0.16); }",
    ":host([data-lahe-scheme='dark']) ." + INPUT_CLASS + " { background: #111113; color: inherit; border-color: rgba(255,255,255,0.18); }",
    ":host([data-lahe-scheme='dark']) ." + OUTLINE_CLASS + " { outline-color: rgba(147, 167, 234, 0.95);",
    "  background: rgba(147, 167, 234, 0.12); }",
    ":host([data-lahe-scheme='dark']) .lahe-comment-quote { color: rgba(242,242,242,0.66);",
    "  border-left-color: rgba(147, 167, 234, 0.8); }",
    ":host([data-lahe-scheme='dark']) .lahe-comment-foot { color: rgba(242,242,242,0.55); }",
    ":host([data-lahe-scheme='dark']) .lahe-comment-grip {",
    "  background-image: radial-gradient(rgba(255,255,255,0.3) 1px, transparent 1px); }",
    ":host([data-lahe-scheme='dark']) .lahe-comment-act { color: rgba(242,242,242,0.66);",
    "  background: #1b1b1d; border-color: rgba(255,255,255,0.16); }",
    ":host([data-lahe-scheme='dark']) .lahe-comment-act:hover { color: #f2f2f2;",
    "  background: rgba(255,255,255,0.06); }",
    ":host([data-lahe-scheme='dark']) .lahe-comment-act--quiet { border-color: transparent; background: none; }",
    PILL_STYLE
  ].join("\n");

  // ---------------------------------------------------------------------------
  // How big the box is, and where its corner sits
  // ---------------------------------------------------------------------------
  //
  // The box grows with what the reviewer writes. Ken reviews with the rail
  // collapsed, so this small floating card is the whole interface, and a
  // three-line input that scrolls internally after the third line is the whole
  // interface being too small.
  //
  // The growth is driven from the textarea's own scrollHeight rather than from
  // CSS field-sizing, which only Chromium has: this layer supports current
  // Chrome, Edge, Safari and Firefox.
  //
  // The math is pure and lives out here, so it is unit-testable with no browser
  // and so the drag path and the growth path cannot disagree about where the
  // corner is allowed to be.

  // The box's starting width, and the one positionAt measures against.
  var BOX_WIDTH = 288;
  // The textarea's floor: today's size, so a fresh box looks exactly as it did.
  var INPUT_MIN_HEIGHT = 66;
  // The box's ceiling, as a share of the viewport. Past it the textarea scrolls.
  var BOX_MAX_VIEWPORT_SHARE = 0.4;
  // Width grows a step per wrapped line, up to the smaller of 1.5x the starting
  // width and this. 288 * 1.5 = 432, so 432 is the cap in practice.
  var BOX_WIDTH_CAP = 480;
  var BOX_WIDTH_STEP = 24;
  // How close to the viewport edge the box may sit.
  var BOX_EDGE = 16;

  function clamp(value, low, high) {
    if (high < low) return low;
    if (value < low) return low;
    if (value > high) return high;
    return value;
  }

  /**
   * The box's size and corner for the content it is holding right now.
   *
   * @param {Object} m
   *   contentHeight  the textarea's scrollHeight with its height released
   *   lineHeight     one line of the textarea, in pixels
   *   chromeHeight   everything of the box that is not the textarea
   *   baseWidth      the width a fresh box opens at
   *   top, left      the corner the box is anchored (or was dragged) to
   *   viewportWidth, viewportHeight
   * @returns {{width: number, inputHeight: number, boxHeight: number,
   *            top: number, left: number, capped: boolean}}
   */
  function growthFor(m) {
    var g = m || {};
    var vw = g.viewportWidth > 0 ? g.viewportWidth : 1024;
    var vh = g.viewportHeight > 0 ? g.viewportHeight : 768;
    var lineHeight = g.lineHeight > 0 ? g.lineHeight : 20;
    var chrome = g.chromeHeight > 0 ? g.chromeHeight : 0;
    var baseWidth = g.baseWidth > 0 ? g.baseWidth : BOX_WIDTH;
    // The textarea's resting height: what it measures with nothing typed in it.
    // The constant is the floor, but the real number is whatever the page's own
    // font makes of three rows, and the box must not read its own resting size
    // as growth and open one step too wide.
    var restHeight = Math.max(INPUT_MIN_HEIGHT, g.restHeight > 0 ? g.restHeight : INPUT_MIN_HEIGHT);

    // Height. The cap is on the whole box, so the textarea gets what is left of
    // it once the quote and the footer have taken theirs.
    var boxCap = Math.round(vh * BOX_MAX_VIEWPORT_SHARE);
    var inputCap = Math.max(restHeight, boxCap - chrome);
    var wanted = g.contentHeight > 0 ? Math.ceil(g.contentHeight) : restHeight;
    var inputHeight = clamp(wanted, restHeight, inputCap);
    var capped = wanted > inputCap;

    // Width. The box stays exactly the size it opened at until the reviewer has
    // written past the input it opened with, then widens a step per line beyond
    // it. Measured from the content rather than from the applied height, so the
    // three lines a fresh box already shows do not count as growth.
    var lines = 1 + Math.max(0, Math.ceil((wanted - restHeight) / lineHeight));
    var widthCap = Math.min(Math.round(baseWidth * 1.5), BOX_WIDTH_CAP);
    var roomy = Math.max(baseWidth, vw - BOX_EDGE * 2);
    var width = clamp(baseWidth + BOX_WIDTH_STEP * (lines - 1), baseWidth, Math.min(widthCap, roomy));

    // The corner. Growth goes down and to the right from where the box is, so
    // the words already on screen do not move under the caret. It only moves
    // when growing that way would put the box off screen, and then it moves by
    // exactly as much as it has to.
    var boxHeight = inputHeight + chrome;
    var left = typeof g.left === "number" ? g.left : BOX_EDGE;
    var top = typeof g.top === "number" ? g.top : BOX_EDGE;
    left = clamp(left, BOX_EDGE, Math.max(BOX_EDGE, vw - BOX_EDGE - width));
    top = clamp(top, BOX_EDGE, Math.max(BOX_EDGE, vh - BOX_EDGE - boxHeight));

    return {
      width: width,
      inputHeight: inputHeight,
      boxHeight: boxHeight,
      top: top,
      left: left,
      capped: capped
    };
  }

  /**
   * Where a dragged box lands: the pointer's own offset into it, kept whole on
   * screen. Same clamp as growth, so a dragged box and a grown one obey one
   * rule about the edges.
   */
  function dragTo(m) {
    var g = m || {};
    var vw = g.viewportWidth > 0 ? g.viewportWidth : 1024;
    var vh = g.viewportHeight > 0 ? g.viewportHeight : 768;
    return {
      left: clamp(g.left || 0, BOX_EDGE, Math.max(BOX_EDGE, vw - BOX_EDGE - (g.width || 0))),
      top: clamp(g.top || 0, BOX_EDGE, Math.max(BOX_EDGE, vh - BOX_EDGE - (g.height || 0)))
    };
  }

  function createComments(options) {
    var opts = options || {};
    var store = opts.store || storeModule.shared;
    var reviewId = opts.reviewId || null;
    var hasDoc = Object.prototype.hasOwnProperty.call(opts, "document");
    var doc = hasDoc ? opts.document : typeof document !== "undefined" ? document : null;
    var win = opts.window || (typeof window !== "undefined" ? window : null);
    // The shared instance when this is the real document, because the library
    // has ONE surface host on a page and a second instance would create a
    // second one. A caller working on some other document (a test, a frame)
    // gets its own.
    var isRealDocument = doc && typeof document !== "undefined" && doc === document;
    var highlights =
      opts.highlights ||
      (isRealDocument ? highlightModule.shared : doc ? highlightModule.createHighlights({ document: doc }) : null);
    var defaultPage = opts.page || null;

    // id -> handle
    var open = Object.create(null);
    var listenerHandles = [];
    var listenersState = [];
    var pick = { active: false, element: null };
    // How much room the rail is assumed to take on the right. The rail's real
    // width is 1B's; this is only a clamp for box placement, so being generous
    // costs nothing.
    var RAIL_ALLOWANCE = 340;
    var outlineNode = null;
    var surfaceRoot = null;
    // The selection popover. `pill` holds the nodes; the rest is what it is
    // showing right now, so selectionPopover() can answer without measuring
    // anything the caller cannot see.
    var pill = null;
    var pillTimer = null;
    var pillShown = false;
    var pillPlacement = "above";
    var pillTipFor = null;
    // The cards' own note nodes, by item id, and whether this window may type in
    // them. A window that loses the review goes read-only by unbinding this
    // group (index.js), and an editable node left editable there would be an
    // offer to write into a review this window no longer holds.
    var noteEditors = Object.create(null);
    var gesturesBound = false;
    var EDITABLE = editableValue(doc);

    function requireReview() {
      if (!reviewId) throw new Error("comments: a reviewId is required before a comment can be stored");
      return reviewId;
    }

    function setReview(id) {
      reviewId = id;
      return reviewId;
    }

    function setPage(page) {
      defaultPage = page;
      return defaultPage;
    }

    function onChange(fn) {
      listenersState.push(fn);
      return function () {
        listenersState = listenersState.filter(function (f) {
          return f !== fn;
        });
      };
    }

    // The node each item was CREATED on, while this session holds it. Emitted
    // as the listener's third argument so boot can hand it to replay as the
    // item's first binding: an element-picked comment (a chart, an image) has
    // no unique text for the anchor to re-find, and without this seed the
    // settle recheck marked it lost while it sat on screen (AC1's Copy/Export
    // divergence, 2026-08-18). comments loads BEFORE replay in the manifest,
    // so the bridge lives in index.js rather than here.
    var createdOn = Object.create(null);

    function emit(item, event) {
      var el = createdOn[item && item[record.FIELD.ID]] || null;
      for (var i = 0; i < listenersState.length; i += 1) listenersState[i](item, event || "changed", el);
    }

    // The one write path. Synchronous to storage before anything else happens.
    function persist(item, event) {
      store.write(requireReview(), item);
      emit(item, event);
      return item;
    }

    // ------------------------------------------------------------------------
    // The shadow surface
    // ------------------------------------------------------------------------

    function surface() {
      if (!doc || !highlights) return null;
      // Memoized, but only while the host it belongs to is still in the page. A
      // rebuilt surface leaves this pointing into a detached closed root, which
      // looks like the library working (boxes are created, records are written)
      // while nothing the reviewer types is on screen.
      var cachedHost = surfaceRoot ? surfaceRoot.host || surfaceRoot : null;
      if (surfaceRoot && cachedHost && cachedHost.isConnected) return surfaceRoot;
      surfaceRoot = null;
      var got = highlights.surface();
      surfaceRoot = got.root || got.host;
      highlights.addSurfaceStyle("comments", BOX_STYLE);
      return surfaceRoot;
    }

    // A box the rail hosts lives in the RAIL's root, not in the surface root
    // the styles above went into, and a shadow root's styles stop at its own
    // boundary. So the box carries its stylesheet to whichever root it lands
    // in, once per root.
    var styledRoots = [];
    function ensureBoxStyleIn(host) {
      if (!doc || !host || typeof host.getRootNode !== "function") return null;
      var rootNode = host.getRootNode();
      if (!rootNode || rootNode === doc) return null;
      if (styledRoots.indexOf(rootNode) !== -1) return null;
      styledRoots.push(rootNode);
      var style = doc.createElement("style");
      style.textContent = BOX_STYLE;
      rootNode.appendChild(style);
      return style;
    }

    // ------------------------------------------------------------------------
    // Opening a box
    // ------------------------------------------------------------------------

    /**
     * Opens a comment box and mints its record.
     *
     * @param {Object} input
     *   page       {origin, path, title, seq, source_hint} from record.pageFrom
     *   quote      the passage the reviewer selected, or null for a note
     *   kind       record.KIND.COMMENT (default) or record.KIND.NOTE
     *   region     the anchor reference, when one has been minted
     *   range      a live Range to paint and to position the box against
     *   element    the element the comment is about, for an element pick
     *   host       a node inside the surface to append the box to
     *   placement  "anchored" (default) or "inline" (in the rail's thread)
     * @returns {Object} a handle: {id, item, node, input, focus, type,
     *                              markReady, close, remove}
     */
    function openBox(input) {
      var src = input || {};
      var page = src.page || defaultPage || {};
      var kind = src.kind || record.KIND.COMMENT;
      var context = record.emptyContext();
      if (src.quote) context.quote = src.quote;
      if (src.element && src.element.tagName) context.element = src.element.tagName;
      if (src.heading) context.heading = src.heading;

      var item = record.newItem({
        kind: kind,
        state: record.STATE.DRAFT,
        note: "",
        page_origin: page.origin,
        page_path: page.path,
        page_title: page.title,
        page_seq: page.seq,
        source_hint: page.source_hint,
        region: src.region || record.emptyRegion(),
        context: context
      });

      if (src.element && src.element.nodeType === 1) {
        createdOn[item[record.FIELD.ID]] = src.element;
      } else if (src.range) {
        var creationNode = src.range.commonAncestorContainer;
        if (creationNode && creationNode.nodeType !== 1) creationNode = creationNode.parentElement;
        if (creationNode) createdOn[item[record.FIELD.ID]] = creationNode;
      }

      // A draft exists the moment the box does. An empty box the reviewer
      // abandons is a draft they can come back to, which costs nothing; a box
      // whose first keystroke is the first durable thing can lose that
      // keystroke.
      //
      // The ONE exception, and it is not a weakening of that rule: the note box
      // standing open at the foot of the thread all session. It is not a box
      // the reviewer opened, so minting a record for it would put an empty note
      // in the rail, in review.json, and in the agent's queue on every page
      // load. It mints on its first keystroke instead, still synchronously, and
      // still before anything else happens.
      if (!src.deferred) persist(item, "opened");

      // A box is open, so the offer to open one is stale.
      hidePopover();

      var handle = buildHandle(item, src);
      open[item[record.FIELD.ID]] = handle;

      if (src.range && highlights) {
        highlights.paint(item[record.FIELD.ID], src.range, highlightModule.NAME.ACTIVE);
      }
      return handle;
    }

    // Opens a box for an item that already exists: the reword path. Mints
    // nothing, and returns the SAME node when one is already open.
    //
    // `host` and `placement` are how a tab file rewords INSIDE the rail's own
    // card rather than in a box floating over the page. That is what makes the
    // card really hold what the reviewer is typing into, which is the guard
    // that stops a focused card being removed or re-parented.
    function reopen(id, options) {
      var where = options || {};
      if (open[id]) return open[id];
      var item = store.readItem(requireReview(), id);
      if (!item) throw new Error("comments.reopen: no item " + String(id) + " in review " + requireReview());
      var handle = buildHandle(item, {
        quote: item[record.FIELD.CONTEXT] ? item[record.FIELD.CONTEXT].quote : null,
        range: highlights ? highlights.rangeFor(id) : null,
        host: where.host || null,
        placement: where.host ? where.placement || "inline" : "anchored"
      });
      open[id] = handle;
      return handle;
    }

    function buildHandle(item, src) {
      var id = item[record.FIELD.ID];
      var node = null;
      var inputEl = null;
      var stateEl = null;
      var gripEl = null;
      var sendEl = null;
      var deleteEl = null;
      // Where the reviewer PUT the box, once they have moved it. Null until
      // then, and never persisted: a fresh box anchors to its passage the way
      // it always has, on this page load and on the next one.
      var dragPos = null;
      var dragFrom = null;
      var restHeight = null;
      // A session the reviewer started by typing in the card's own words: the
      // note node IS the input, so no box is built and none is torn down.
      var inNote = (src && src.inputNode) || null;
      var placement = inNote ? "in-note" : src && src.placement === "inline" ? "inline" : "anchored";
      // What the session put on the note node, so close() takes it all off again
      // and the node goes back to being the words on the card.
      var sessionOff = [];

      if (inNote) {
        node = inNote;
        inputEl = inNote;
        sessionOff.push(listenOn(inNote, "input", onInput));
        sessionOff.push(listenOn(inNote, "keydown", onKeydown));
        // Clicking away ends the session the way closing the box does: the words
        // are committed at one revision. The STATE is left where the reviewer
        // left it, so a comment they walked away from mid-sentence is still
        // amber when they come back, and still off the agent's desk.
        sessionOff.push(listenOn(inNote, "focusout", onFocusOut));
      } else if (doc) {
        var host = (src && src.host) || surface();
        ensureBoxStyleIn(host);
        node = doc.createElement("div");
        node.className = BOX_CLASS;
        // Marked as the library's own chrome, so nothing here can reach a
        // record's markup (R23).
        markers.markChrome(node);
        node.setAttribute("data-lahe-item", id);
        node.setAttribute("data-lahe-placement", placement);

        // The drag strip, first, so the reviewer grabs the box by its top edge
        // the way they grab any window. Hidden on an inline box: a box inside
        // the rail's own thread has nowhere to be dragged to.
        gripEl = doc.createElement("div");
        gripEl.className = "lahe-comment-grip";
        gripEl.setAttribute("data-lahe-grip", "");
        gripEl.setAttribute("aria-hidden", "true");
        gripEl.setAttribute("title", "Drag to move this box");
        markers.markChrome(gripEl);
        node.appendChild(gripEl);

        var quote = item[record.FIELD.CONTEXT] ? item[record.FIELD.CONTEXT].quote : null;
        if (quote) {
          var quoteEl = doc.createElement("p");
          quoteEl.className = "lahe-comment-quote";
          quoteEl.textContent = quote;
          node.appendChild(quoteEl);
        }

        inputEl = doc.createElement("textarea");
        inputEl.className = INPUT_CLASS;
        inputEl.setAttribute("spellcheck", "false");
        inputEl.setAttribute("rows", "3");
        inputEl.setAttribute(
          "placeholder",
          item[record.FIELD.KIND] === record.KIND.NOTE ? "Not tied to any passage" : "What should change here?"
        );
        inputEl.value = item[record.FIELD.NOTE] || "";
        node.appendChild(inputEl);

        var foot = doc.createElement("div");
        foot.className = "lahe-comment-foot";
        var hint = doc.createElement("span");
        hint.className = "lahe-comment-hint";
        hint.textContent = HINT_READY;
        stateEl = doc.createElement("span");
        stateEl.className = "lahe-comment-state";
        stateEl.setAttribute("data-state", item[record.FIELD.STATE]);
        stateEl.textContent = item[record.FIELD.STATE] === record.STATE.READY ? "Ready" : "Draft";
        foot.appendChild(hint);
        foot.appendChild(stateEl);
        node.appendChild(foot);

        // The two controls. Neither is a second way of doing anything: Send runs
        // the very function Cmd-Enter runs, and Delete runs the very remove path
        // the rail's own Delete runs.
        var acts = doc.createElement("div");
        acts.className = "lahe-comment-acts";
        deleteEl = actionButton("Delete", "lahe-comment-act lahe-comment-act--quiet", "delete", discardDraft);
        sendEl = actionButton("Send", "lahe-comment-act", "send", commitFromControl);
        acts.appendChild(deleteEl);
        acts.appendChild(sendEl);
        node.appendChild(acts);

        inputEl.addEventListener("input", onInput);
        inputEl.addEventListener("keydown", onKeydown);
        bindGrip();

        if (host) host.appendChild(node);
        if (placement === "anchored") positionAt(node, src && src.range ? src.range : null);
        paintSendable();
        grow();
      }

      /**
       * One small control on the box, wired so pressing it never takes the
       * caret out of the textarea.
       *
       * The mousedown preventDefault is the whole of that: without it the press
       * blurs the input, and on a box that closes on focusout (a rewording in a
       * card's own note) the session ends before the click ever arrives.
       */
      function actionButton(label, className, act, run) {
        var button = doc.createElement("button");
        button.type = "button";
        button.className = className;
        button.setAttribute("data-lahe-act", act);
        button.textContent = label;
        markers.markChrome(button);
        button.addEventListener("mousedown", function (event) {
          event.preventDefault();
        });
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          run();
        });
        return button;
      }

      // The note this box last COMMITTED. A rewording is measured against it, so
      // typing a word and taking it back again is not a revision.
      var committedNote = String(item[record.FIELD.NOTE] || "");
      // Has this item ever been committed at all? A draft has not: it starts at
      // rev 1 and reaches the agent when it is marked ready, so nothing it does
      // before that is a revision. Read ONCE, at the start of the session,
      // because the session itself drops a ready item to draft while the
      // reviewer is mid-sentence and that transient draft is not a new record.
      var committed = !record.isDraft(item);
      // ...and was it on the agent's desk? That is the state the reviewer takes
      // it back from when they start typing in it.
      var wasReady = record.isReady(item);

      // The words in the session's input, whichever kind of node that is.
      function readInput() {
        if (!inputEl) return "";
        return inNote ? plainTextOf(inputEl) : String(inputEl.value || "");
      }

      function writeInput(text) {
        if (!inputEl) return;
        if (inNote) {
          // Only when it really differs: writing textContent under the
          // reviewer's own caret would put the caret back at the start.
          if (plainTextOf(inputEl) !== text) inputEl.textContent = text;
          return;
        }
        if (inputEl.value !== text) inputEl.value = text;
      }

      function onInput() {
        type(readInput());
      }

      /**
       * Fit the box to what is in it: the textarea's height follows its own
       * content, and the box widens once the text has passed one line.
       *
       * Both numbers come from growthFor, which caps the height at 40% of the
       * viewport (the textarea scrolls past that) and the width at the smaller
       * of 1.5x the starting width and 480px. Everything it needs is measured
       * here; the decisions are all out there, where a unit test can reach them.
       */
      function grow() {
        if (!node || !inputEl || inNote || !win || !node.isConnected) return null;
        var measure = inputEl.style.height;
        // Released first, so the scrollHeight read is the content's own height
        // rather than the height this function set last time. Without it the
        // box could grow and never shrink.
        inputEl.style.height = "auto";
        var content = inputEl.scrollHeight;
        var boxRect = node.getBoundingClientRect();
        var inputRect = inputEl.getBoundingClientRect();
        var chrome = Math.max(0, boxRect.height - inputRect.height);
        inputEl.style.height = measure;

        var lineHeight = 20;
        if (win.getComputedStyle) {
          var parsed = parseFloat(win.getComputedStyle(inputEl).lineHeight);
          if (parsed > 0) lineHeight = parsed;
        }

        // Measured once, from the box as it opened. It is the datum for "has
        // this grown at all", so it has to be taken before anything is typed.
        if (restHeight === null) restHeight = content;

        var size = growthFor({
          restHeight: restHeight,
          contentHeight: content,
          lineHeight: lineHeight,
          chromeHeight: chrome,
          baseWidth: BOX_WIDTH,
          top: dragPos ? dragPos.top : boxRect.top,
          left: dragPos ? dragPos.left : boxRect.left,
          viewportWidth: win.innerWidth,
          viewportHeight: win.innerHeight
        });

        inputEl.style.height = size.inputHeight + "px";
        inputEl.style.overflowY = size.capped ? "auto" : "hidden";
        if (placement !== "anchored") return size;
        node.style.width = size.width + "px";
        node.style.top = Math.round(size.top) + "px";
        node.style.left = Math.round(size.left) + "px";
        // A box that has been moved keeps the corner growth left it at, so the
        // next keystroke does not walk it back toward its passage.
        if (dragPos) dragPos = { top: size.top, left: size.left };
        return size;
      }

      // ----------------------------------------------------------------------
      // Moving the box
      // ----------------------------------------------------------------------
      //
      // Ken reviews with the rail collapsed, so this box is the interface, and
      // an interface that lands on the paragraph being discussed has to be
      // movable. It is a pointer drag on the top strip and nothing else: no
      // keyboard gesture is added, and none is taken away.

      function bindGrip() {
        if (!gripEl) return null;
        gripEl.addEventListener("pointerdown", onGripDown);
        gripEl.addEventListener("pointermove", onGripMove);
        gripEl.addEventListener("pointerup", onGripUp);
        gripEl.addEventListener("pointercancel", onGripUp);
        return gripEl;
      }

      function onGripDown(event) {
        if (placement !== "anchored" || !node || !win) return;
        if (typeof event.button === "number" && event.button !== 0) return;
        // THE DEFAULT IS THE PROBLEM, NOT THE EVENT. A press on the box's own
        // chrome selects text and moves focus; preventing it is what keeps the
        // caret and the draft exactly where they were through the drag.
        event.preventDefault();
        var rect = node.getBoundingClientRect();
        dragFrom = {
          dx: event.clientX - rect.left,
          dy: event.clientY - rect.top,
          width: rect.width,
          height: rect.height
        };
        node.setAttribute("data-lahe-dragging", "true");
        if (typeof gripEl.setPointerCapture === "function" && event.pointerId !== undefined) {
          try {
            gripEl.setPointerCapture(event.pointerId);
          } catch (err) {
            // A pointer the engine will not let us capture still drags: the
            // move events keep arriving on this node while the button is down.
            dragFrom.captured = false;
          }
        }
      }

      function onGripMove(event) {
        if (!dragFrom || !node || !win) return;
        event.preventDefault();
        var placed = dragTo({
          left: event.clientX - dragFrom.dx,
          top: event.clientY - dragFrom.dy,
          width: dragFrom.width,
          height: dragFrom.height,
          viewportWidth: win.innerWidth,
          viewportHeight: win.innerHeight
        });
        dragPos = placed;
        node.style.top = Math.round(placed.top) + "px";
        node.style.left = Math.round(placed.left) + "px";
      }

      function onGripUp(event) {
        if (!dragFrom) return;
        dragFrom = null;
        if (node) node.removeAttribute("data-lahe-dragging");
        if (gripEl && typeof gripEl.releasePointerCapture === "function" && event.pointerId !== undefined) {
          try {
            gripEl.releasePointerCapture(event.pointerId);
          } catch (err) {
            // Already released with the pointer itself. Nothing to undo.
          }
        }
      }

      // ----------------------------------------------------------------------
      // The two buttons
      // ----------------------------------------------------------------------

      /** Send: the Cmd-Enter path, called by the key and by the button alike. */
      function commitFromControl() {
        var next = markReady();
        // A box has done its job and goes. A session in a card's own note stays
        // where it is with the reviewer still in it.
        if (!inNote) close();
        return next;
      }

      /**
       * Delete: the draft goes, with no dialog. Drafts are cheap, and a
       * confirm() would block the reviewed page.
       *
       * It is the module's own remove path, so browser storage, the highlight,
       * the rail's row and the helper's log all hear about it exactly once. A
       * note box that has never been typed in has no record to remove, so it
       * simply closes.
       */
      function discardDraft() {
        var existing = store.readItem(requireReview(), id);
        if (existing) return remove(id);
        writeInput("");
        close();
        return false;
      }

      /**
       * Send is offered only when there is something to send. The keyboard path
       * is untouched: Cmd-Enter does what it has always done.
       */
      function paintSendable() {
        if (!sendEl) return null;
        sendEl.disabled = !readInput().trim();
        return sendEl;
      }

      function onFocusOut() {
        close();
      }

      function onKeydown(event) {
        var got = gestures.gestureFor({
          type: "keydown",
          key: event.key,
          metaKey: event.metaKey,
          ctrlKey: event.ctrlKey,
          shiftKey: event.shiftKey,
          inCommentBox: true
        });
        if (got.gesture === gestures.GESTURE.MARK_READY) {
          if (got.preventDefault) event.preventDefault();
          // The very function the Send button calls. The card's own note stays
          // where it is with the reviewer still in it: they are looking at the
          // words they just committed, and typing on is the next rewording.
          commitFromControl();
        } else if (got.gesture === gestures.GESTURE.CANCEL) {
          if (got.preventDefault) event.preventDefault();
          // Esc cancels the thing that is open. Picking is more recent than
          // the box, so it goes first; a second Esc closes the box, with the
          // draft kept.
          if (pick.active) exitPickMode();
          else if (inNote) leaveNote();
          else close();
        } else if (got.gesture === gestures.GESTURE.ENTER_ELEMENT_PICK) {
          // Starting the next comment without leaving the box first. The
          // document-level handler cannot see this one: the event retargets
          // to the library's own host, and everything of the library's is
          // skipped there by design.
          if (got.preventDefault) event.preventDefault();
          if (inNote) leaveNote();
          enterPickMode();
        }
      }

      /**
       * Esc in a card's note: the reviewer saying they are done with it.
       *
       * It COMMITS, never discards (closing a box has always kept the words).
       * An item that was on the agent's desk when the session started goes back
       * onto it, because leaving it silently amber would take a comment off the
       * agent's queue as a side effect of pressing Esc. A draft stays a draft:
       * nothing here ever readies a comment the reviewer never readied.
       */
      function leaveNote() {
        if (wasReady) markReady();
        close();
        if (inputEl && typeof inputEl.blur === "function") inputEl.blur();
        return handleItem();
      }

      // Every keystroke. Synchronous, before anything else.
      function type(text) {
        var current = handleItem();
        // NEITHER A DRAFT NOR A REWORDING IN PROGRESS BUMPS rev.
        //
        // A draft does not, because drafts flow to the helper and the log
        // legitimately holds many events at one revision (idempotence is by
        // event id, never by item and rev).
        //
        // A rewording in progress does not, for the same reason plus a sharper
        // one. rev is what an agent's reply names, and a reply naming an older
        // rev is refused as stale (R21). Bumping per keystroke made every reply
        // stale the moment the reviewer touched the box, so the protection
        // became reply-blocking noise: one sentence reworded took rev 1 to 29 on
        // the 2026-08-14 walk. The keystrokes are still durable at once; they are
        // CONTENT. The revision moves once, at the commit, in flushReword.
        var next = Object.assign({}, current);
        next[record.FIELD.NOTE] = String(text);
        next[record.FIELD.UPDATED_AT] = record.nowIso();
        // EDITING A READY COMMENT TAKES IT BACK OFF THE AGENT'S DESK.
        //
        // This is the whole of Ken's "the color would go from green to yellow
        // and that was how we knew": a comment being rewritten is not something
        // an agent should act on, and draft is already the state that is not in
        // review.json (R7). The wash follows the state through the rail's own
        // setCardState, so the colour cannot drift from what the file says.
        //
        // Typing the words back exactly as they were puts it back: nothing about
        // what the agent would read has changed, so nothing has been withdrawn.
        if (wasReady) {
          next[record.FIELD.STATE] =
            String(text) === committedNote ? record.STATE.READY : record.STATE.DRAFT;
        }
        store.write(requireReview(), next);
        writeInput(next[record.FIELD.NOTE]);
        // The box fits itself to the words on every keystroke, whether the
        // keystroke came from a keyboard or from a caller driving this handle.
        paintSendable();
        grow();
        paintState(next);
        emit(next, "typed");
        return next;
      }

      /**
       * The end of a rewording session: ONE bump, carrying the committed words.
       *
       * Called by both ways a session ends, Cmd-Enter and closing the box, and
       * it is idempotent between them: whichever gets there first moves the
       * revision, and the second sees nothing left to commit.
       *
       * A draft has nothing to bump; it starts at rev 1 and reaches the agent
       * when it is marked ready. That is read from the state the session
       * STARTED in, not from the state right now: a comment the reviewer is
       * rewriting is a draft this second, and reading it here would mean a
       * rewording never moved the revision at all.
       */
      function flushReword() {
        var current = handleItem();
        var note = String(current[record.FIELD.NOTE] || "");
        if (!committed) {
          committedNote = note;
          return current;
        }
        if (note === committedNote) return current;
        // bumpRev carries the record as it stands, so the applied-after history
        // records the committed version and not the keystrokes on the way to it
        // (it appends only when the compared after moved).
        var next = record.bumpRev(current, {});
        committedNote = String(next[record.FIELD.NOTE] || "");
        store.write(requireReview(), next);
        paintState(next);
        emit(next, "reworded");
        return next;
      }

      function markReady() {
        var current = flushReword();
        var next = Object.assign({}, current);
        next[record.FIELD.STATE] = record.STATE.READY;
        next[record.FIELD.UPDATED_AT] = record.nowIso();
        record.validateItem(next);
        store.write(requireReview(), next);
        committedNote = String(next[record.FIELD.NOTE] || "");
        // The item is on the agent's desk now, so the next keystroke in this
        // same session is a new rewording and takes it back off again.
        committed = true;
        wasReady = true;
        paintState(next);
        emit(next, "ready");
        return next;
      }

      function paintState(next) {
        if (!stateEl) return;
        stateEl.setAttribute("data-state", next[record.FIELD.STATE]);
        stateEl.textContent = next[record.FIELD.STATE] === record.STATE.READY ? "Ready" : "Draft";
      }

      /**
       * Take the box down WITHOUT committing anything.
       *
       * The one caller is remove(): the record is about to be deleted, and
       * close()'s ordinary reword flush would write the deleted words straight
       * back into storage, which is a draft that resurrects itself.
       */
      function discard() {
        sessionOff.forEach(function (off) {
          off();
        });
        sessionOff = [];
        if (!inNote && node && node.parentNode) node.parentNode.removeChild(node);
        delete open[id];
        if (highlights) highlights.setActive(id, false);
        return true;
      }

      function close() {
        // Closing ends a rewording session as surely as Cmd-Enter does, so the
        // words the reviewer leaves behind are committed at one revision here
        // too. Without this, a reword ended with Esc would change what the
        // agent reads while the number the agent checks against stayed put.
        flushReword();
        // The draft is kept. Closing a box is not discarding work; only the
        // reviewer's own delete removes an item.
        //
        // A session in a card's own note takes its listeners off and LEAVES THE
        // NODE: those words are the card, and removing them would be the rail
        // rebuilding a row, which is the one thing it must never do.
        sessionOff.forEach(function (off) {
          off();
        });
        sessionOff = [];
        if (!inNote && node && node.parentNode) node.parentNode.removeChild(node);
        delete open[id];
        if (highlights) highlights.setActive(id, false);
        emit(handleItem(), "closed");
        return handleItem();
      }

      function focus() {
        if (inputEl && typeof inputEl.focus === "function") inputEl.focus();
        // A note focused rather than clicked is a reviewer who means to add to
        // the sentence, so the caret goes to the end of it rather than to the
        // start, where an empty selection in an editable node otherwise lands.
        if (inNote) caretToEnd(inputEl);
        return inputEl;
      }

      function handleItem() {
        return store.readItem(requireReview(), id) || item;
      }

      return {
        id: id,
        get item() {
          return handleItem();
        },
        node: node,
        input: inputEl,
        grip: gripEl,
        send: sendEl,
        placement: placement,
        focus: focus,
        type: type,
        markReady: markReady,
        // What the box measures to right now, for a caller that cannot reach
        // into the closed root: the specs' way in.
        size: function () {
          if (!node || !node.isConnected) return null;
          var rect = node.getBoundingClientRect();
          var grip = gripEl ? gripEl.getBoundingClientRect() : null;
          var field = inputEl && inputEl.getBoundingClientRect ? inputEl.getBoundingClientRect() : null;
          return {
            width: rect.width,
            height: rect.height,
            top: rect.top,
            left: rect.left,
            dragged: !!dragPos,
            sendDisabled: sendEl ? !!sendEl.disabled : null,
            input: field ? { width: field.width, height: field.height } : null,
            grip: grip ? { x: grip.x, y: grip.y, width: grip.width, height: grip.height } : null
          };
        },
        grow: grow,
        commit: commitFromControl,
        discardDraft: discardDraft,
        discard: discard,
        // Ending a rewording session without closing the box. Cmd-Enter and
        // close both go through it; this is the same seam for a caller that has
        // neither.
        commitReword: flushReword,
        close: close
      };
    }

    // Places an anchored box, kept inside the viewport and clear of the rail.
    // Fixed positioning, inside the shadow root: the page's own layout never
    // learns this happened.
    //
    // THE GUTTER FIRST, THEN BELOW. A box under the passage covers the paragraph
    // after it, so the reviewer is writing about the page with the page hidden.
    // Most reviewed pages are a content column with empty space between it and
    // the rail; when that space is wide enough the box goes there, beside its
    // passage, and nothing is covered. Below is the fallback for a page whose
    // content runs the full width.
    // BOX_WIDTH is the module's, shared with the growth math: placement and
    // growth have to agree about how wide a fresh box is.
    var GUTTER_GAP = 14;
    // Roughly the box's own height, for the "is there room below" question. The
    // box is measured when it is on screen; before that this is the estimate.
    var BOX_HEIGHT_ESTIMATE = 180;

    function positionAt(node, range) {
      if (!node || !win) return node;
      var vw = win.innerWidth || 1024;
      var vh = win.innerHeight || 768;
      var rect = range && typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
      var rightLimit = Math.max(16, vw - BOX_WIDTH - 16 - RAIL_ALLOWANCE);
      var top;
      var left;

      // The gutter starts at the edge of the CONTENT COLUMN, not at the end of
      // the selected run. A short selection (a heading, a few words) ends in the
      // middle of the column, and a box placed there covers the text beside it,
      // which is the thing being fixed rather than a smaller version of it.
      var columnRight = columnEdge(range, rect);
      if (columnRight !== null && columnRight + GUTTER_GAP <= rightLimit) {
        left = columnRight + GUTTER_GAP;
        top = rect.top;
      } else {
        top = rect ? rect.bottom + 10 : 24;
        left = rect ? rect.left : 24;
      }

      if (left > rightLimit) left = rightLimit;
      if (left < 16) left = 16;
      if (top > vh - BOX_HEIGHT_ESTIMATE) top = Math.max(16, (rect ? rect.top : vh) - BOX_HEIGHT_ESTIMATE);
      if (top < 16) top = 16;

      top = nudgeOffEditBar(node, top, left);
      node.style.top = Math.round(top) + "px";
      node.style.left = Math.round(left) + "px";
      return node;
    }

    /** The right edge of the block the passage sits in, in viewport pixels. */
    function columnEdge(range, rect) {
      if (!rect) return null;
      var node = range && range.commonAncestorContainer;
      var element = node && node.nodeType === 1 ? node : node && node.parentElement;
      if (!element || typeof element.getBoundingClientRect !== "function") return rect.right;
      var block = element.getBoundingClientRect();
      return Math.max(rect.right, block.right);
    }

    /**
     * Move the box below a live edit bar it would land on top of.
     *
     * Two floating chromes stacking on each other is the one collision the
     * reviewer reads as the tool being broken. The bar is 2A's and lives in the
     * same surface root; this asks the DOM where it is rather than asking the
     * editing surface, so nothing new is wired between the two files for a
     * placement nudge.
     */
    function nudgeOffEditBar(node, top, left) {
      var root = surfaceRoot;
      if (!root || typeof root.querySelector !== "function") return top;
      var bar = root.querySelector(".lahe-edit-bar");
      if (!bar || !bar.getBoundingClientRect) return top;
      if (bar.style && bar.style.display === "none") return top;
      var b = bar.getBoundingClientRect();
      if (!b.width || !b.height) return top;
      var overlapsX = left < b.right && b.left < left + BOX_WIDTH;
      var overlapsY = top < b.bottom && b.top < top + BOX_HEIGHT_ESTIMATE;
      if (!overlapsX || !overlapsY) return top;
      return b.bottom + 10;
    }

    // ------------------------------------------------------------------------
    // The three ways a comment starts
    // ------------------------------------------------------------------------

    // Cmd-Shift-C with a selection. The box opens already focused on that
    // passage (R16).
    function commentOnSelection(input) {
      var src = input || {};
      var selection = src.selection || (win && win.getSelection ? win.getSelection() : null);
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
      var range = selection.getRangeAt(0).cloneRange();
      var quote = String(selection.toString()).trim();
      if (!quote) return null;
      var element = blockOf(range.commonAncestorContainer);
      var handle = openBox({
        page: src.page,
        quote: quote,
        range: range,
        element: null,
        region: regionFor(element, range),
        heading: headingTextFor(element)
      });
      // The reviewer's selection has done its job; leaving it painted under the
      // highlight reads as two overlapping colors.
      if (selection.removeAllRanges) selection.removeAllRanges();
      handle.focus();
      return handle;
    }

    // Cmd-Shift-C with nothing selected. Hovering outlines, clicking comments,
    // Esc cancels (R17).
    function enterPickMode() {
      if (!doc) return pickState();
      hidePopover();
      pick.active = true;
      pick.element = null;
      showOutline(null);
      return pickState();
    }

    function exitPickMode() {
      pick.active = false;
      pick.element = null;
      showOutline(null);
      return pickState();
    }

    function pickState() {
      return {
        active: pick.active,
        outlining: pick.element ? pick.element.id || pick.element.tagName : null,
        element: pick.element
      };
    }

    // Comments on a whole element: the element's own contents are the passage.
    function commentOnElement(element, input) {
      var src = input || {};
      if (!element) return null;
      var range = doc.createRange();
      range.selectNodeContents(element);
      var handle = openBox({
        page: src.page,
        quote: String(element.textContent || "").trim(),
        range: range,
        element: element,
        region: regionFor(element, range),
        heading: headingTextFor(element)
      });
      handle.focus();
      return handle;
    }

    // A note tied to nothing (R18). No range, so nothing is painted and nothing
    // is anchored: the region stays empty and honest.
    function openNote(input) {
      var src = input || {};
      var handle = openBox({
        page: src.page,
        kind: record.KIND.NOTE,
        host: src.host,
        placement: src.host ? "inline" : "anchored",
        deferred: src.deferred !== false
      });
      if (src.focus !== false) handle.focus();
      return handle;
    }

    // ------------------------------------------------------------------------
    // Anchoring and labels
    // ------------------------------------------------------------------------

    function blockOf(node) {
      var el = node;
      while (el && el.nodeType !== 1) el = el.parentNode;
      return el && el.nodeType === 1 ? el : null;
    }

    function headingTextFor(element) {
      if (!element) return null;
      var el = element.previousElementSibling;
      while (el) {
        if (/^H[1-6]$/.test(el.tagName)) return normalize.normalizeText(el.textContent || "");
        el = el.previousElementSibling;
      }
      var parent = element.parentElement;
      return parent && parent !== doc.body ? headingTextFor(parent) : null;
    }

    // Mints the durable reference through 1C's engine and pins a display label
    // once. The label is display only; identity is the reference.
    function regionFor(element, range) {
      var region = record.emptyRegion();
      if (!element) return region;
      region.ref = anchor.mint({ element: element, range: range, root: doc });
      try {
        regions.pinLabel(region, descriptorFor(element));
      } catch (err) {
        // A label is a display convenience. A region with a reference and no
        // label is still a usable record, so this is the one place a failure is
        // recorded rather than thrown.
        region.label = null;
      }
      return region;
    }

    function descriptorFor(element) {
      var tag = String(element.tagName || "").toLowerCase();
      var ordinal = 1;
      var sibling = element.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === element.tagName) ordinal += 1;
        sibling = sibling.previousElementSibling;
      }
      return {
        authorName: element.getAttribute ? element.getAttribute(regions.AUTHOR_ATTR) : null,
        id: element.id || null,
        ariaLabel: element.getAttribute ? element.getAttribute("aria-label") : null,
        heading: headingTextFor(element),
        ordinal: ordinal,
        tag: tag,
        text: element.textContent || null
      };
    }

    // ------------------------------------------------------------------------
    // The pick-mode outline: drawn over the page, never on it
    // ------------------------------------------------------------------------

    function ensureOutline() {
      var host = surface();
      if (!host) return null;
      if (outlineNode && outlineNode.parentNode) return outlineNode;
      outlineNode = doc.createElement("div");
      outlineNode.className = OUTLINE_CLASS;
      markers.markChrome(outlineNode);
      host.appendChild(outlineNode);
      return outlineNode;
    }

    function showOutline(element) {
      var el = ensureOutline();
      if (!el) return null;
      if (!element) {
        el.style.display = "none";
        return el;
      }
      var r = element.getBoundingClientRect();
      el.style.display = "block";
      el.style.top = r.top + "px";
      el.style.left = r.left + "px";
      el.style.width = r.width + "px";
      el.style.height = r.height + "px";
      return el;
    }

    // ------------------------------------------------------------------------
    // The selection popover: the pill the reviewer gets for free
    // ------------------------------------------------------------------------

    function ensurePill() {
      if (!doc) return null;
      if (pill && pill.node && pill.node.isConnected) return pill;
      var host = surface();
      if (!host) return null;

      var node = doc.createElement("div");
      node.className = PILL_CLASS;
      node.setAttribute("role", "toolbar");
      node.setAttribute("aria-label", "What to do with this selection");
      node.setAttribute("data-lahe-placement", "above");
      markers.markChrome(node);

      var tip = doc.createElement("span");
      tip.className = PILL_TIP_CLASS;
      markers.markChrome(tip);

      var buttons = [];
      POPOVER_ACTIONS.forEach(function (spec, index) {
        if (index > 0) {
          var sep = doc.createElement("span");
          sep.className = "lahe-sel-sep";
          markers.markChrome(sep);
          node.appendChild(sep);
        }
        var button = doc.createElement("button");
        button.type = "button";
        button.className = PILL_BTN_CLASS;
        button.setAttribute("data-lahe-action", spec.action);
        // The keystroke is on the button for a screen reader too, not only in
        // the hover tooltip a keyboard user never sees.
        button.setAttribute("aria-label", spec.aria + " (" + spec.keys.join("") + ")");
        button.textContent = spec.label;
        markers.markChrome(button);

        // THE ONE EVENT THIS TAKES, AND WHY. A mousedown on a button collapses
        // the selection, and both gestures below need the selection that is
        // still on screen. preventDefault here is what makes the button work at
        // all; without it the reviewer clicks Comment and comments on nothing.
        button.addEventListener("mousedown", function (event) {
          event.preventDefault();
          event.stopPropagation();
        });
        button.addEventListener("click", function (event) {
          event.preventDefault();
          event.stopPropagation();
          runPopoverAction(spec.action);
        });
        button.addEventListener("mouseenter", function () {
          showTip(spec);
        });
        button.addEventListener("mouseleave", function () {
          hideTip();
        });
        button.addEventListener("focus", function () {
          showTip(spec);
        });
        button.addEventListener("blur", function () {
          hideTip();
        });

        node.appendChild(button);
        buttons.push({ spec: spec, node: button });
      });

      node.appendChild(tip);
      host.appendChild(node);
      pill = { node: node, tip: tip, buttons: buttons };
      return pill;
    }

    function showTip(spec) {
      if (!pill || !pillShown) return null;
      pillTipFor = spec.action;
      pill.tip.textContent = "";
      spec.keys.forEach(function (key) {
        var cap = doc.createElement("kbd");
        cap.className = "lahe-sel-cap";
        cap.textContent = key;
        pill.tip.appendChild(cap);
      });
      // Centred on the button it belongs to, in the pill's own coordinates.
      var button = pill.buttons.filter(function (b) {
        return b.spec.action === spec.action;
      })[0];
      if (button) {
        var pillRect = pill.node.getBoundingClientRect();
        var btnRect = button.node.getBoundingClientRect();
        pill.tip.style.left = Math.round(btnRect.left + btnRect.width / 2 - pillRect.left) + "px";
      }
      pill.tip.setAttribute("data-lahe-shown", "true");
      return pill.tip;
    }

    function hideTip() {
      pillTipFor = null;
      if (pill && pill.tip) pill.tip.setAttribute("data-lahe-shown", "false");
      return null;
    }

    /**
     * The pill's two buttons, each running the gesture it names.
     *
     * Comment is this file's own selection path, the one Cmd-Shift-C takes.
     * Edit belongs to the editing surface, and this file does not hold a
     * reference to it, so the button presses the KEY: a real Cmd-Shift-E keydown
     * on the document, decided by the same pure table and handled by the same
     * one handler. There is no second way into edit state to keep in step.
     */
    function runPopoverAction(action) {
      if (action === "comment") {
        hidePopover();
        return commentOnSelection({});
      }
      if (action === "edit") {
        var sent = pressEditGesture();
        hidePopover();
        return sent;
      }
      return null;
    }

    function pressEditGesture() {
      if (!doc || !win || typeof win.KeyboardEvent !== "function") return false;
      var event = new win.KeyboardEvent("keydown", {
        key: "e",
        code: "KeyE",
        metaKey: IS_MAC,
        ctrlKey: !IS_MAC,
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        composed: true
      });
      doc.dispatchEvent(event);
      return true;
    }

    // Everything that must NOT get a pill, in one place, so the read-only,
    // editing and library-surface cases cannot drift apart.
    function selectionWorthOffering() {
      if (!doc || !win || !win.getSelection) return null;
      if (pick.active) return null;
      if (focusedBox()) return null;
      var selection = win.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
      if (!String(selection.toString()).trim()) return null;
      var range = selection.getRangeAt(0);
      var node = range.commonAncestorContainer;
      var element = node && node.nodeType === 1 ? node : node && node.parentElement;
      if (!element) return null;
      // The library's own UI is not the reviewed page.
      if (markers.isInsideOverlay(element)) return null;
      // A block in edit state already has the reviewer inside it; offering to
      // start editing what they are editing is noise.
      if (typeof element.closest === "function" && element.closest("[contenteditable='true']")) return null;
      return range;
    }

    function evaluatePopover() {
      pillTimer = null;
      var range = selectionWorthOffering();
      if (!range) return hidePopover();
      return showPopover(range);
    }

    function schedulePopover() {
      if (!win) return null;
      if (pillTimer) win.clearTimeout(pillTimer);
      // A selection that is gone goes NOW. Waiting out the debounce would leave
      // the pill sitting over a page the reviewer has already moved on from.
      if (!selectionWorthOffering()) return hidePopover();
      pillTimer = win.setTimeout(evaluatePopover, POPOVER_DELAY_MS);
      return pillTimer;
    }

    function showPopover(range) {
      var made = ensurePill();
      if (!made) return null;
      made.node.setAttribute("data-lahe-shown", "true");
      pillShown = true;
      hideTip();
      positionPill(range);
      return made.node;
    }

    function hidePopover() {
      if (win && pillTimer) {
        win.clearTimeout(pillTimer);
        pillTimer = null;
      }
      pillShown = false;
      hideTip();
      if (pill && pill.node) pill.node.setAttribute("data-lahe-shown", "false");
      return null;
    }

    /**
     * Places the pill at the END of the selection, above it when there is room
     * and below it when there is not.
     *
     * The end rather than the middle, because that is where the reviewer's
     * pointer finished; above rather than below, because below is where the next
     * line of the page is and the pill would sit on the words they are about to
     * read.
     */
    function positionPill(range) {
      if (!pill || !win) return null;
      var rects = typeof range.getClientRects === "function" ? range.getClientRects() : null;
      var end = rects && rects.length ? rects[rects.length - 1] : range.getBoundingClientRect();
      var size = pill.node.getBoundingClientRect();
      var vw = win.innerWidth || 1024;
      var vh = win.innerHeight || 768;

      var placement = "above";
      var top = end.top - size.height - POPOVER_GAP;
      if (top < POPOVER_GAP) {
        placement = "below";
        top = end.bottom + POPOVER_GAP;
      }
      if (top > vh - size.height - POPOVER_GAP) top = Math.max(POPOVER_GAP, vh - size.height - POPOVER_GAP);

      var left = end.right - size.width / 2;
      // Clear of the rail, the same allowance the comment box uses, so the pill
      // is never drawn underneath it.
      var railLimit = vw - RAIL_ALLOWANCE - size.width - POPOVER_GAP;
      var rightLimit = railLimit > POPOVER_GAP ? railLimit : vw - size.width - POPOVER_GAP;
      if (left > rightLimit) left = rightLimit;
      if (left < POPOVER_GAP) left = POPOVER_GAP;

      pillPlacement = placement;
      pill.node.setAttribute("data-lahe-placement", placement);
      pill.node.style.top = Math.round(top) + "px";
      pill.node.style.left = Math.round(left) + "px";
      return pill.node;
    }

    /**
     * What the pill is showing, for a caller that cannot reach into the closed
     * root: the specs' way in, and the same geometry a real mouse click uses.
     */
    function selectionPopover() {
      var node = pill && pill.node ? pill.node : null;
      var visible = !!(pillShown && node && node.isConnected);
      var rect = visible ? node.getBoundingClientRect() : { x: 0, y: 0, width: 0, height: 0 };
      var tipRect = visible && pillTipFor ? pill.tip.getBoundingClientRect() : null;
      return {
        visible: visible,
        placement: pillPlacement,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        buttons: !visible
          ? []
          : pill.buttons.map(function (b) {
              var r = b.node.getBoundingClientRect();
              return {
                action: b.spec.action,
                label: b.spec.label,
                keys: b.spec.keys.slice(),
                rect: { x: r.x, y: r.y, width: r.width, height: r.height }
              };
            }),
        tooltip: {
          visible: !!(visible && pillTipFor),
          for: visible ? pillTipFor : null,
          keys: visible && pillTipFor ? keysFor(pillTipFor) : null,
          text: tipRect ? String(pill.tip.textContent) : null
        }
      };
    }

    function keysFor(action) {
      var spec = POPOVER_ACTIONS.filter(function (s) {
        return s.action === action;
      })[0];
      return spec ? spec.keys.slice() : null;
    }

    // ------------------------------------------------------------------------
    // The card's own words as the input
    // ------------------------------------------------------------------------
    //
    // A tab file draws the note; this file decides what happens when a reviewer
    // types in it, because a rewording is a rewording wherever it is entered.
    // The tab hands its note node over once, when it builds the row, and never
    // again: the node is created with the row and outlives every session in it.

    function listenOn(node, type, fn) {
      node.addEventListener(type, fn);
      return function () {
        node.removeEventListener(type, fn);
      };
    }

    /** Put the caret after the last character of an editable node. */
    function caretToEnd(node) {
      if (!doc || !win || !node || typeof win.getSelection !== "function") return null;
      try {
        var range = doc.createRange();
        range.selectNodeContents(node);
        range.collapse(false);
        var selection = win.getSelection();
        if (!selection) return null;
        selection.removeAllRanges();
        selection.addRange(range);
        return range;
      } catch (err) {
        // A selection API that will not take a range inside a closed root is a
        // caret in the wrong place, not a broken rewording.
        return null;
      }
    }

    function setNoteEditable(entry, editable) {
      if (!entry || !entry.node) return null;
      entry.node.setAttribute("contenteditable", editable ? EDITABLE : "false");
      return entry.node;
    }

    /**
     * Make a card's note the reviewer's way into rewording that item.
     *
     * @param {string} id      the item the note belongs to
     * @param {Element} node   the node holding the reviewer's own words
     * @returns {object|null}  the registration, or null with no document
     */
    function attachNoteEditor(id, node) {
      if (!doc || !node) return null;
      detachNoteEditor(id);
      var entry = { node: node, off: [] };
      node.setAttribute("data-lahe-note-editor", "");
      node.setAttribute("role", "textbox");
      node.setAttribute("aria-multiline", "true");
      node.setAttribute("aria-label", "Your comment. " + HINT_READY + ".");
      node.setAttribute("spellcheck", "false");
      entry.off.push(
        listenOn(node, "focus", function () {
          var current = store.readItem(requireReview(), id);
          // Once an agent has answered, these words are an immutable completed
          // turn. Continuation happens in the blank follow-up composer.
          if (current && current[record.FIELD.REPLY]) return;
          editInPlace(id, node);
        })
      );
      noteEditors[id] = entry;
      // A window that has not bound its gestures is a window that may not write
      // to this review, so the words are readable and nothing more.
      setNoteEditable(entry, gesturesBound);
      return entry;
    }

    function setNoteEditorEnabled(id, enabled) {
      var entry = noteEditors[id];
      if (!entry) return null;
      return setNoteEditable(entry, !!enabled && gesturesBound);
    }

    function detachNoteEditor(id) {
      var entry = noteEditors[id];
      if (!entry) return false;
      if (open[id] && open[id].placement === "in-note") open[id].close();
      entry.off.forEach(function (off) {
        off();
      });
      delete noteEditors[id];
      return true;
    }

    function eachNoteEditor(fn) {
      Object.keys(noteEditors).forEach(function (id) {
        fn(noteEditors[id], id);
      });
    }

    /**
     * Start (or return) the rewording session living in a card's own note.
     *
     * The same session the box runs: type() writes every keystroke at once, the
     * commit moves the revision once (R21). Returning the open one is the box's
     * law restated for the note: a session is never re-created under a caret.
     */
    function editInPlace(id, node) {
      var target = node || (noteEditors[id] ? noteEditors[id].node : null);
      if (!target || !gesturesBound) return null;
      if (open[id]) return open[id];
      var item = store.readItem(requireReview(), id);
      if (!item) throw new Error("comments.editInPlace: no item " + String(id) + " in review " + requireReview());
      // The reviewer is in the rail now, so an offer about a page selection is
      // stale.
      hidePopover();
      var handle = buildHandle(item, { inputNode: target });
      open[id] = handle;
      return handle;
    }

    /** Is this window offering the note as an input right now? */
    function noteEditor(id) {
      var entry = noteEditors[id];
      if (!entry) return null;
      return {
        id: id,
        node: entry.node,
        editable: entry.node.getAttribute("contenteditable") !== "false",
        editing: !!(open[id] && open[id].placement === "in-note")
      };
    }

    // ------------------------------------------------------------------------
    // The reviewer's own edits to their own comments
    // ------------------------------------------------------------------------

    function remove(id) {
      // The box goes FIRST, and it goes without committing. close() ends a
      // rewording session by writing the words back, so closing after the
      // delete put the record straight back into storage and the draft came
      // back on the next reload.
      var doomed = store.readItem(requireReview(), id);
      if (open[id]) open[id].discard();
      var removed = store.remove(requireReview(), id);
      if (highlights) highlights.clear(id);
      // The whole record, not just its id: the helper's log needs the revision
      // and the page the deleted item belonged to, and the rail reads the id
      // off it either way.
      if (removed) emit(doomed || { id: id }, "removed");
      return removed;
    }

    // ------------------------------------------------------------------------
    // A handled item's paint (R37 / AC3)
    // ------------------------------------------------------------------------
    //
    // A HANDLED ITEM LOSES ITS HIGHLIGHT. It is finished, the reviewer is not
    // being asked to look at that passage again, and a page that keeps every
    // answered passage painted accumulates marks all session until the reviewer
    // cannot see which ones are still open. It is the paint that goes, never the
    // record: the item is kept, it is in Done, and it is reopenable (R38).
    //
    // The two calls are a pair and both are here, because the paint is this
    // file's. tab_done.js says WHEN; this file knows HOW.

    /** Drop one item's paint. The record and its box are untouched. */
    function unpaint(id) {
      if (!highlights) return false;
      return highlights.clear(id);
    }

    /**
     * Paint one item again, resolving its anchor against the page as it is now.
     *
     * The live Range died with the paint, and the page has moved on anyway
     * (usually because the agent's change is what retired the item), so the
     * range is rebuilt from the record's own reference rather than remembered.
     * An anchor that no longer binds is an honest miss: nothing is painted and
     * the caller is told so, which is the same answer replay gives.
     *
     * @returns {boolean} true when the item is painted now
     */
    function repaint(id) {
      if (!highlights || !doc) return false;
      var item = store.readItem(requireReview(), id);
      if (!item) return false;
      var region = item[record.FIELD.REGION];
      var ref = region && region.ref;
      if (!ref) return false;
      var verdict = anchor.resolve(ref, doc);
      if (!verdict || !verdict.element) return false;
      var range = doc.createRange();
      range.selectNodeContents(verdict.element);
      highlights.paint(id, range, highlightModule.NAME.COMMENT);
      return true;
    }

    function items() {
      return store.read(requireReview());
    }

    // Outstanding work, newest first: what the Active tab shows.
    //
    // The reverse comes first, and it is not decoration. Two comments made in
    // the same millisecond carry the same created_at, and a sort alone would
    // then fall back to storage order, which is oldest first: the exact
    // opposite of what the rail promises. Reversing first, then sorting with a
    // stable sort, makes the tie break the right way.
    function outstanding() {
      var list = items().filter(function (item) {
        return item[record.FIELD.STATE] !== record.STATE.HANDLED;
      });
      list.reverse();
      return list.sort(function (a, b) {
        var at = a[record.FIELD.UPDATED_AT] || a[record.FIELD.CREATED_AT] || "";
        var bt = b[record.FIELD.UPDATED_AT] || b[record.FIELD.CREATED_AT] || "";
        return String(bt).localeCompare(String(at));
      });
    }

    function openBoxes() {
      return Object.keys(open).map(function (id) {
        return open[id];
      });
    }

    function closeAll() {
      openBoxes().forEach(function (handle) {
        handle.close();
      });
    }

    // Reopening an id that is already open returns the SAME node.
    function boxFor(id) {
      return open[id] || null;
    }

    function focusedBox() {
      return openBoxes().filter(function (handle) {
        return handle.node && handle.input && isFocused(handle.input);
      })[0] || null;
    }

    /**
     * The boxes that make a page reload unsafe: focused, or holding typed
     * text. NOT every open box: the rail's page-note box is on screen the
     * whole session, so counting mere openness held R36's auto-reload off
     * forever on every page (found live 2026-08-18: reloadChecks 90,
     * reloadsFired 0, openBoxes 1, with nobody typing anything). An empty,
     * unfocused box is furniture, not work in progress.
     */
    function busyBoxes() {
      return openBoxes().filter(function (handle) {
        if (!handle.node || !handle.input) return false;
        if (isFocused(handle.input)) return true;
        var text =
          typeof handle.input.value === "string" ? handle.input.value : handle.input.textContent || "";
        return text.trim().length > 0;
      });
    }

    function isFocused(el) {
      var rootNode = el.getRootNode ? el.getRootNode() : doc;
      return rootNode && rootNode.activeElement === el;
    }

    // ------------------------------------------------------------------------
    // Wiring the gestures
    // ------------------------------------------------------------------------
    //
    // Every decision comes from the pure table. This function's only job is to
    // describe the world to it and then do what it says.

    function bind(input) {
      var src = input || {};
      var target = src.document || doc;
      if (!target) return { bound: false, reason: "no document" };
      if (src.page) setPage(src.page);
      unbind();

      listenerHandles.push(listeners.on(target, "keydown", onKeydown, true, LISTENER_GROUP));
      listenerHandles.push(listeners.on(target, "mousemove", onMouseMove, true, LISTENER_GROUP));
      listenerHandles.push(listeners.on(target, "click", onClick, true, LISTENER_GROUP));
      // The selection popover rides in this group deliberately: a read-only
      // window unbinds the group, and the pill has to go with the gestures it
      // offers. A remount re-registers the group, and the pill comes back with
      // the reviewer's next selection, which is the whole of its state.
      listenerHandles.push(listeners.on(target, "selectionchange", onSelectionChange, false, LISTENER_GROUP));
      if (win) {
        // Scrolling moves the passage out from under the pill. Hiding is honest
        // and cheap; a pill that chases the page during a scroll is neither.
        listenerHandles.push(listeners.on(win, "scroll", onScroll, true, LISTENER_GROUP));
      }
      // RE-DERIVED FROM STATE, NOT LEFT TO THE NEXT EVENT. A remount unbinds and
      // rebinds this group, and the reviewer's selection survives that: on the
      // app fixture's morphing page the pill appeared, the next morph took it
      // away, and it never came back, because selectionchange had already
      // happened and was not going to happen again. The selection IS the state;
      // bind re-reads it.
      schedulePopover();
      // The cards' notes are gestures too. A window that may comment may type in
      // the words it already wrote; a window that may not, may not.
      gesturesBound = true;
      eachNoteEditor(function (entry) {
        setNoteEditable(entry, true);
      });
      return { bound: true, listeners: listenerHandles.length };
    }

    function unbind() {
      listenerHandles.forEach(function (handle) {
        handle.off();
      });
      listenerHandles = [];
      hidePopover();
      gesturesBound = false;
      // Read-only, so the words stay readable and stop being an input. Without
      // this the refused window still offered a caret in every comment on
      // screen, and the review it would have written into is another window's.
      eachNoteEditor(function (entry) {
        setNoteEditable(entry, false);
      });
    }

    function describe(event) {
      var selection = win && win.getSelection ? win.getSelection() : null;
      return {
        type: event.type,
        key: event.key,
        metaKey: event.metaKey === true,
        ctrlKey: event.ctrlKey === true,
        shiftKey: event.shiftKey === true,
        hasSelection: !!(selection && selection.rangeCount > 0 && !selection.isCollapsed),
        inOverlay: markers.isInsideOverlay(event.target),
        pickMode: pick.active === true,
        inCommentBox: !!focusedBox()
      };
    }

    function onSelectionChange() {
      schedulePopover();
    }

    function onScroll() {
      hidePopover();
    }

    function onKeydown(event) {
      // The library's own UI handles its own keys; the box's handler already
      // ran by the time this sees it.
      if (markers.isInsideOverlay(event.target)) return;
      // Esc dismisses the pill and keeps the selection. It is not a CANCEL in
      // the table's sense (nothing of the library's is open), so it is decided
      // here and the key still reaches the page.
      if (event.key === "Escape") hidePopover();
      var got = gestures.gestureFor(describe(event));
      if (got.gesture === gestures.GESTURE.COMMENT_ON_SELECTION) {
        if (got.preventDefault) event.preventDefault();
        commentOnSelection({});
      } else if (got.gesture === gestures.GESTURE.ENTER_ELEMENT_PICK) {
        if (got.preventDefault) event.preventDefault();
        enterPickMode();
      } else if (got.gesture === gestures.GESTURE.CANCEL) {
        if (got.preventDefault) event.preventDefault();
        if (pick.active) exitPickMode();
      }
    }

    function onMouseMove(event) {
      if (!pick.active) return;
      var el = blockOf(event.target);
      if (!el || markers.isInsideOverlay(el)) return;
      if (el === doc.documentElement || el === doc.body) {
        pick.element = null;
        showOutline(null);
        return;
      }
      pick.element = el;
      showOutline(el);
    }

    function onClick(event) {
      if (markers.isInsideOverlay(event.target)) return;
      var got = gestures.gestureFor(describe(event));
      if (got.gesture !== gestures.GESTURE.PICK_ELEMENT) return;
      // The ONE time the library takes a click on the page, entered
      // deliberately by a keystroke one moment earlier.
      if (got.preventDefault) event.preventDefault();
      event.stopPropagation();
      var element = pick.element || blockOf(event.target);
      exitPickMode();
      if (element) commentOnElement(element, {});
    }

    function teardown() {
      unbind();
      closeAll();
      Object.keys(noteEditors).forEach(detachNoteEditor);
      if (highlights) highlights.teardown();
      surfaceRoot = null;
      outlineNode = null;
      pill = null;
    }

    return {
      BOX_CLASS: BOX_CLASS,
      INPUT_CLASS: INPUT_CLASS,
      OUTLINE_CLASS: OUTLINE_CLASS,
      PILL_CLASS: PILL_CLASS,
      POPOVER_KEYS: POPOVER_KEYS,
      HINT_READY: HINT_READY,
      setReview: setReview,
      setPage: setPage,
      onChange: onChange,
      openBox: openBox,
      openNote: openNote,
      reopen: reopen,
      attachNoteEditor: attachNoteEditor,
      detachNoteEditor: detachNoteEditor,
      setNoteEditorEnabled: setNoteEditorEnabled,
      editInPlace: editInPlace,
      noteEditor: noteEditor,
      remove: remove,
      unpaint: unpaint,
      repaint: repaint,
      items: items,
      outstanding: outstanding,
      boxFor: boxFor,
      openBoxes: openBoxes,
      busyBoxes: busyBoxes,
      closeAll: closeAll,
      focusedBox: focusedBox,
      commentOnSelection: commentOnSelection,
      commentOnElement: commentOnElement,
      enterPickMode: enterPickMode,
      exitPickMode: exitPickMode,
      pickMode: pickState,
      selectionPopover: selectionPopover,
      hideSelectionPopover: hidePopover,
      highlights: highlights,
      bind: bind,
      unbind: unbind,
      teardown: teardown
    };
  }

  return {
    BOX_CLASS: BOX_CLASS,
    INPUT_CLASS: INPUT_CLASS,
    OUTLINE_CLASS: OUTLINE_CLASS,
    PILL_CLASS: PILL_CLASS,
    PILL_BTN_CLASS: PILL_BTN_CLASS,
    PILL_TIP_CLASS: PILL_TIP_CLASS,
    POPOVER_KEYS: POPOVER_KEYS,
    POPOVER_ACTIONS: POPOVER_ACTIONS,
    POPOVER_DELAY_MS: POPOVER_DELAY_MS,
    HINT_READY: HINT_READY,
    BOX_STYLE: BOX_STYLE,
    BOX_WIDTH: BOX_WIDTH,
    BOX_WIDTH_CAP: BOX_WIDTH_CAP,
    BOX_MAX_VIEWPORT_SHARE: BOX_MAX_VIEWPORT_SHARE,
    INPUT_MIN_HEIGHT: INPUT_MIN_HEIGHT,
    BOX_EDGE: BOX_EDGE,
    growthFor: growthFor,
    dragTo: dragTo,
    createComments: createComments
  };
});
