// Edit state: one block at a time, entered deliberately, committed once.
//
// Owner: 2A. Implements architecture D3 (edit is entered deliberately, per
// region; browse is the page untouched) and D4 (the edit record).
//
// ---------------------------------------------------------------------------
// What a reviewer does, and what happens
// ---------------------------------------------------------------------------
//
//   Cmd-Shift-E           the block under the caret becomes editable, that one
//                         block and nothing else, visibly framed
//   typing                every keystroke is durable, synchronously
//   Esc, or the pointer   the edit commits, protection lifts, and the block
//   going down outside    rejoins the page. Outside means outside: the rest of
//   the block            the page, AND the library's own rail, AND the window
//                         losing focus altogether. An edit left in `draft`
//                         reaches no agent at all, so every way of leaving the
//                         block has to end the same way.
//   navigating away       the open edit commits on the way out, and the event
//                         is durable in browser storage whether or not the
//                         keepalive post makes it (R1: navigation cannot be a
//                         losing move)
//   Bold / Italic         the two formatting commands R24 allows, each of them
//                         going both ways. A formatting-only change is still a
//                         change (R31), including taking a format OFF
//   Delete block          its own record kind, which reads as a deletion rather
//                         than as an empty edit (R27)
//   undo                  reverts THAT record's region to its `before` and
//                         retires the record, in the browser AND in the
//                         helper's copy, touching no other record (R28). On a
//                         HANDLED edit the record is kept and the undo mints
//                         the work of taking the change back out of the source
//
// ---------------------------------------------------------------------------
// Five rules this file must not lose
// ---------------------------------------------------------------------------
//
//  1. `before` IS PINNED AT FIRST TOUCH and never recaptured, however many
//     times the reviewer retypes (R29). If it drifts to the last committed
//     wording, replay's branch two never matches the source again and the agent
//     gets a diff that is a no-op against the file, silently, while everything
//     on screen looks right.
//
//  2. A COMMIT IS THE REVIEWER LEAVING THE REGION. Esc, a click outside,
//     navigation. It is never the framework yanking the node out from under
//     them: a repaint that destroys the focused block must not commit anything
//     (that is 2B's protection domain), and a draft stays a draft.
//
//  3. EXACTLY ONE COMMIT PER SESSION. Clearing edit state removes
//     contenteditable, which fires blur. A blur handler that commits would
//     commit a second time and bump the revision, and one edit would reach the
//     agent as a rewording that never happened. So the session is cleared
//     BEFORE the DOM is touched, and there is no blur handler at all: the
//     gesture table's `when` column says COMMIT_EDIT applies only while a block
//     is in edit state.
//
//  4. `after` IS NEVER TRUNCATED AND NEVER CLEANED UP (R3). The text stored is
//     the block's own text, exactly as typed. Normalization is a COMPARISON
//     rule and happens at compare time, in replay, never on the way into a
//     record. The markup is the one exception, and only in one direction: it
//     goes through cleanMarkup so nothing the library added can reach a record
//     (R23, R33).
//
//  5. NOTHING THE LIBRARY DRAWS IS WRITTEN TO THE PAGE. The frame is a
//     rectangle in the library's own closed shadow root, over the block's
//     bounding box. The only things this file puts on a reviewed element are
//     the editing attributes below, and they come off at commit.
//
// A revision is a COMMITTED wording, not a keystroke. Typing inside a session
// writes the record every time and leaves `rev` where it is; the commit bumps
// it exactly once. The other reading (bump per keystroke) turns one edit into
// forty revisions and makes every agent reply stale on arrival.
//
// ---------------------------------------------------------------------------
// The formatting mechanism decision (kept from the file this reworks)
// ---------------------------------------------------------------------------
//
// DECIDED: document.execCommand, with normalization on capture.
//
//  - execCommand is deprecated and still implemented in every target engine,
//    and it handles the selection cases that are the actual work: a selection
//    that starts inside a <strong> and ends outside it, a partial selection
//    across an inline boundary. Manual range surgery is a week of edge cases,
//    and the ones it gets wrong are silent.
//  - Its known defect is dirty markup: <b> where you wanted <strong>, nested
//    spans, inline styles. cleanMarkup already normalizes every one of those,
//    because it has to normalize the page author's markup anyway.
//  - The one setting that matters: document.execCommand("styleWithCSS", false,
//    false) once per document, so tags are emitted rather than style
//    attributes. R35 forbids the tool writing a style attribute onto a reviewed
//    element, and styleWithCSS true would do exactly that on every bold.
//
// AMENDED 2026-08-23, and the amendment is the same one Enter got. The layer
// now says WHICH WAY the button is going before the engine touches anything
// (gestures.formatIntentFor), and writes the reset itself. styleWithCSS off is
// not enough on its own: it decides how bold is APPLIED, and there is no tag
// for the other direction, so taking bold off words a page stylesheet made bold
// got a style attribute out of all three engines anyway. The record could keep
// none of it and the change was thrown away in silence (Ken, 2026-08-23). What
// the engine is still trusted with is the tag surgery it was chosen for; what
// it no longer decides is what the gesture meant. See FORMAT_SHAPE.
//
// What changed from the file this reworks: its Chromium-only reasoning (the
// tool ships on three engines now) and its entry gesture. Click-to-edit is
// dead. It fought the page for every click, which is the inversion this design
// exists to remove.
//
// Composition events are deferred to composition end, so a post during IME
// composition cannot ship half-composed text as the reviewer's exact wording.
// IME itself is a MANUAL CHECK on the acceptance walk (4A): composition is not
// reliably drivable from Playwright, and a test that drove it would be
// asserting the harness rather than the browser.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.editing = factory(
      root.LAHE.markers,
      root.LAHE.normalize,
      root.LAHE.record,
      root.LAHE.lifecycle,
      root.LAHE.regions,
      root.LAHE.epoch,
      root.LAHE.gestures,
      root.LAHE.selection,
      root.LAHE.store,
      root.LAHE.anchor,
      root.LAHE.highlight,
      root.LAHE.listeners,
      root.LAHE.protect,
      // comments.js loads before this file (manifest order), and its heading
      // walk is the one an edit's context.heading uses too, so the two record
      // kinds cannot disagree about which heading a block sits under.
      root.LAHE.comments,
      root.LAHE.failures,
      root.LAHE.blocks,
      // replay.js loads AFTER this file (it depends on everything), so it is
      // resolved when a pass is scheduled rather than when this module loads.
      function () {
        return root.LAHE.replay;
      }
    );
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/normalize.js"),
      require("../shared/record.js"),
      require("../shared/lifecycle.js"),
      require("../shared/regions.js"),
      require("../shared/epoch.js"),
      require("../shared/gestures.js"),
      require("./selection.js"),
      require("./store.js"),
      require("./anchor.js"),
      require("./highlight.js"),
      require("./listeners.js"),
      require("./protect.js"),
      require("./comments.js"),
      require("../shared/failures.js"),
      require("./blocks.js"),
      function () {
        return require("./replay.js");
      }
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  markers,
  normalize,
  record,
  lifecycle,
  regions,
  epoch,
  gestures,
  selection,
  storeModule,
  anchor,
  highlightModule,
  listeners,
  protect,
  commentsModule,
  failuresModule,
  blocks,
  replayRef
) {
  "use strict";

  var FORMATTING_MECHANISM = "execCommand";

  var FRAME_CLASS = "lahe-edit-frame";
  var BAR_CLASS = "lahe-edit-bar";
  // The registry group, from the one place both this file and inject.js read it.
  var LISTENER_GROUP = listeners.GROUP.EDITING;

  // The commands R24 allows for v1, closed to bold and italic (the
  // architecture's list). An enum rather than a pass-through string, so a
  // builder cannot reach a command this tool never decided to support.
  var COMMANDS = {
    bold: "bold",
    italic: "italic"
  };

  // Run once per document, before any formatting command.
  var BOOT_COMMANDS = [
    { command: "styleWithCSS", value: false, why: "emit tags, never style attributes. R35" },
    { command: "defaultParagraphSeparator", value: "p", why: "Enter makes a paragraph, not a div" }
  ];

  // Set on the block in edit state. The platform must not be able to rewrite a
  // word and have it recorded as the reviewer's intent (D4).
  var EDITABLE_ATTRS = {
    contenteditable: "true",
    spellcheck: "false",
    autocorrect: "off",
    autocapitalize: "off",
    // Honored by Chromium on contenteditable, and it removes the third-party
    // format bar that would otherwise appear over the reviewed page.
    "data-gramm": "false"
  };

  // Ken's copy, one spelling, used on the frame.
  var LABEL_EDITING = "Editing";
  var HINT_FINISH = "Cmd-Enter or Esc to finish";

  // ---------------------------------------------------------------------------
  // Free writing (docs/features/20260928.01_free_writing): the pinned words and
  // the numbers the plan sets for this file.
  // ---------------------------------------------------------------------------

  // Which kind of session is open. RUN is free writing: an anchor plus the
  // blocks written after it. LEGACY is today's single-block session, kept for
  // a record from before free writing and for a block that cannot hold a run
  // (a table cell, a caption).
  var MODE = { RUN: "run", LEGACY: "legacy" };

  var HINT_EDIT_STATE = "Click + Write here to add text. Esc to finish.";
  var INSERT_LINE_LABEL = "+ Write here";
  var PLACEHOLDER = "Start writing";
  var CEILING_WARN = "This edit is getting long. Press Esc to send it. Once the agent places it, you can keep writing.";
  var CEILING_FULL = "This edit is full. Press Esc to send it. Once the agent places it, you can keep writing.";
  var ANNOUNCE = {
    AFTER: "Writing after: {words}",
    START_OF_PAGE: "Writing at the start of the page",
    COMMIT: "Sent to the agent"
  };
  // How many of the anchor's words the screen reader line quotes.
  var FIRST_WORDS = 6;
  // The warning shows at this share of any of the three ceilings.
  var CEILING_WARN_RATIO = 0.9;
  // Session undo steps kept, changed blocks only.
  var SESSION_HISTORY_MAX = 100;
  // The pause that ends a typing burst, which is one undo step.
  var TYPING_BURST_IDLE_MS = 1000;

  // Counters the draft-cost script and the specs read. blocksCaptured counts
  // run blocks rebuilt through cleanBlock, so a spec can prove a keystroke
  // rebuilds only the caret's block.
  var counters = { blocksCaptured: 0, refused: 0 };

  // The frame's look. Quiet on purpose: the reviewer is reading their own
  // sentence, not the tool. One accent, the rail's, used for the outline and
  // the bar; a wash light enough to leave the page's own text the loudest thing
  // inside it. It lives in the closed shadow root, so nothing here can leak
  // into the page and the page cannot restyle it.
  var FRAME_STYLE = [
    ":host, * { box-sizing: border-box; }",
    "." + FRAME_CLASS + " {",
    "  position: fixed;",
    "  pointer-events: none;",
    "  border-radius: 7px;",
    "  border: 1.5px solid #3c56a5;",
    "  box-shadow: 0 0 0 4px rgba(60, 86, 165, 0.10), 0 6px 20px rgba(17, 17, 17, 0.10);",
    "  background: rgba(60, 86, 165, 0.045);",
    "  transition: opacity 120ms ease;",
    "  z-index: 1;",
    "}",
    "." + BAR_CLASS + " {",
    "  position: fixed;",
    "  pointer-events: auto;",
    "  display: flex;",
    "  align-items: center;",
    "  gap: 8px;",
    "  padding: 5px 8px;",
    "  border-radius: 7px;",
    "  border: 1px solid rgba(17, 17, 17, 0.10);",
    "  background: #ffffff;",
    "  box-shadow: 0 6px 20px rgba(17, 17, 17, 0.14), 0 1px 2px rgba(17, 17, 17, 0.08);",
    "  font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, sans-serif;",
    "  color: #111111;",
    "  z-index: 2;",
    "}",
    ".lahe-edit-bar__label {",
    "  font-size: 10.5px;",
    "  letter-spacing: 0.08em;",
    "  text-transform: uppercase;",
    "  color: #2c3f7d;",
    "  white-space: nowrap;",
    "}",
    ".lahe-edit-bar__sep { width: 1px; height: 16px; background: rgba(17, 17, 17, 0.12); }",
    ".lahe-edit-bar__btn {",
    "  border: 1px solid transparent;",
    "  background: transparent;",
    "  border-radius: 5px;",
    "  padding: 3px 7px;",
    "  font: inherit;",
    "  color: inherit;",
    "  cursor: pointer;",
    "}",
    ".lahe-edit-bar__btn:hover { background: rgba(60, 86, 165, 0.09); }",
    ".lahe-edit-bar__btn:focus-visible { outline: 2px solid #3c56a5; outline-offset: 1px; }",
    ".lahe-edit-bar__btn[data-lahe-command='bold'] { font-weight: 700; }",
    ".lahe-edit-bar__btn[data-lahe-command='italic'] { font-style: italic; }",
    ".lahe-edit-bar__hint { color: rgba(17, 17, 17, 0.5); white-space: nowrap; }",
    // The PAGE picks the scheme, not the OS: highlight.js samples the reviewed
    // page's own background and stamps it on the surface host. A dark-mode OS
    // over a light page used to turn this bar into a black card floating on a
    // white document.
    ":host([data-lahe-scheme='dark']) ." + FRAME_CLASS + " { border-color: #93a7ea; background: rgba(147, 167, 234, 0.10);",
    "    box-shadow: 0 0 0 4px rgba(147, 167, 234, 0.14), 0 6px 20px rgba(0, 0, 0, 0.4); }",
    ":host([data-lahe-scheme='dark']) ." + BAR_CLASS + " { background: #1b1b1d; color: #f2f2f2; border-color: rgba(255,255,255,0.16); }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__label { color: #b7c4f2; }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__hint { color: rgba(242,242,242,0.55); }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__sep { background: rgba(255,255,255,0.16); }",
    // Free writing. The block-type menu is the rail's "More actions" menu in
    // the bar's own register; the line and the placeholder use the frame's
    // accent and its 120ms opacity transition, and nothing else moves.
    ".lahe-edit-bar__typewrap { position: relative; display: inline-flex; }",
    ".lahe-edit-bar__type { border-color: rgba(17, 17, 17, 0.14); min-width: 92px; text-align: left; }",
    ".lahe-edit-bar__type::after { content: ''; display: inline-block; margin-left: 6px; vertical-align: 2px;",
    "  border-left: 3.5px solid transparent; border-right: 3.5px solid transparent; border-top: 4px solid currentColor; opacity: 0.6; }",
    ".lahe-edit-bar__type[aria-expanded='true'] { background: rgba(60, 86, 165, 0.09); border-color: #3c56a5; }",
    ".lahe-edit-bar__type:disabled { cursor: default; color: rgba(17, 17, 17, 0.45); }",
    ".lahe-edit-bar__type:disabled::after { display: none; }",
    ".lahe-edit-bar__btn:disabled { cursor: default; opacity: 0.45; }",
    ".lahe-edit-bar__btn:disabled:hover { background: transparent; }",
    ".lahe-edit-bar__menu { position: absolute; top: calc(100% + 7px); left: 0; min-width: 236px; z-index: 3;",
    "  display: flex; flex-direction: column; gap: 1px; padding: 5px; background: #ffffff;",
    "  border: 1px solid rgba(17, 17, 17, 0.10); border-radius: 7px;",
    "  box-shadow: 0 6px 20px rgba(17, 17, 17, 0.14), 0 1px 2px rgba(17, 17, 17, 0.08); }",
    ".lahe-edit-bar__menu[hidden] { display: none; }",
    ".lahe-edit-bar__menu--up { top: auto; bottom: calc(100% + 7px); }",
    ".lahe-edit-bar__row { display: grid; grid-template-columns: 1fr auto 2.2em; gap: 10px; align-items: baseline;",
    "  width: 100%; text-align: left; white-space: nowrap; font: inherit; font-size: 12.5px; color: inherit;",
    "  padding: 6px 9px; border: 0; border-radius: 5px; background: transparent; cursor: pointer; }",
    ".lahe-edit-bar__row:hover, .lahe-edit-bar__row:focus-visible { background: rgba(60, 86, 165, 0.09); outline: none; }",
    ".lahe-edit-bar__row[aria-checked='true'] .lahe-edit-bar__rowname { font-weight: 600; color: #2c3f7d; }",
    ".lahe-edit-bar__row[aria-disabled='true'] { cursor: default; color: rgba(17, 17, 17, 0.38); background: transparent; }",
    ".lahe-edit-bar__rowkey, .lahe-edit-bar__rowmd { font: 11px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace; color: rgba(17, 17, 17, 0.5); }",
    ".lahe-edit-bar__hint[data-lahe-notice='true'] { color: #2c3f7d; white-space: normal; max-width: 420px; }",
    ".lahe-insert-line { position: fixed; height: 20px; pointer-events: auto; cursor: text; opacity: 0;",
    "  transition: opacity 120ms ease; z-index: 1; }",
    ".lahe-insert-line[data-lahe-show='true'] { opacity: 1; }",
    ".lahe-insert-line:not([data-lahe-show='true']) { pointer-events: none; }",
    ".lahe-insert-line__rule { position: absolute; left: 0; right: 0; top: 9px; border-top: 1.5px solid #3c56a5; }",
    ".lahe-insert-line__label { position: absolute; left: 0; top: 1px; padding: 0 7px 0 0; background: #ffffff;",
    "  font: 600 11px/18px ui-sans-serif, system-ui, -apple-system, sans-serif; color: #3c56a5; }",
    ".lahe-edit-placeholder { position: fixed; pointer-events: none; color: rgba(17, 17, 17, 0.38); display: none;",
    "  white-space: nowrap; overflow: hidden; }",
    ".lahe-edit-live { position: fixed; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0);",
    "  clip-path: inset(50%); white-space: nowrap; }",
    "@media (prefers-reduced-motion: reduce) { ." + FRAME_CLASS + ", .lahe-insert-line { transition: none; } }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__type { border-color: rgba(255,255,255,0.18); }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__type[aria-expanded='true'] { background: rgba(147, 167, 234, 0.14); border-color: #93a7ea; }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__type:disabled { color: rgba(242,242,242,0.45); }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__menu { background: #1b1b1d; border-color: rgba(255,255,255,0.16);",
    "  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4); }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__row:hover, :host([data-lahe-scheme='dark']) .lahe-edit-bar__row:focus-visible { background: rgba(147, 167, 234, 0.14); }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__row[aria-checked='true'] .lahe-edit-bar__rowname { color: #b7c4f2; }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__row[aria-disabled='true'] { color: rgba(242,242,242,0.38); }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__rowkey, :host([data-lahe-scheme='dark']) .lahe-edit-bar__rowmd { color: rgba(242,242,242,0.5); }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__hint[data-lahe-notice='true'] { color: #b7c4f2; }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-bar__btn:hover, :host([data-lahe-scheme='dark']) .lahe-edit-bar__btn:focus-visible { outline-color: #93a7ea; }",
    ":host([data-lahe-scheme='dark']) .lahe-insert-line__rule { border-top-color: #93a7ea; }",
    ":host([data-lahe-scheme='dark']) .lahe-insert-line__label { background: #1b1b1d; color: #93a7ea; }",
    ":host([data-lahe-scheme='dark']) .lahe-edit-placeholder { color: rgba(242,242,242,0.4); }"
  ].join("\n");

  // ---------------------------------------------------------------------------
  // The break the reviewer typed
  // ---------------------------------------------------------------------------
  //
  // gestures.breakIntentFor says WHICH break Enter meant. This says what that
  // break is spelled as in the block, and it is the whole reason the three
  // engines now record the same thing: the layer cancels the engine's own
  // insertion and writes this shape instead.
  //
  // The vocabulary is the normalizer's, not a new one (D9's one normalizer):
  //
  //   paragraph  a real block boundary, so blockTextFromNode reads a blank
  //              line off the STRUCTURE rather than off a newline count. <p>
  //              because BOOT_COMMANDS already decided that Enter makes a
  //              paragraph and not a div.
  //   line       a <br>, which is the one tag the normalizer reads as a single
  //              newline.
  //
  // Both shapes were measured byte-for-byte identical in Chromium, Firefox and
  // WebKit on 2026-08-23, typed into and left alone, which is what the engines
  // themselves are not.
  var BREAK_SHAPE = {};
  BREAK_SHAPE[gestures.BREAK.PARAGRAPH] = { tag: "p", text: normalize.PARAGRAPH_BREAK };
  BREAK_SHAPE[gestures.BREAK.LINE] = { tag: "br", text: normalize.LINE_BREAK };

  /**
   * The markup shape one break writes, or null when the intent is not a break.
   *
   * @param {string} intent a gestures.BREAK value
   * @returns {({tag: string, text: string}|null)}
   */
  function breakShapeFor(intent) {
    return Object.prototype.hasOwnProperty.call(BREAK_SHAPE, intent) ? BREAK_SHAPE[intent] : null;
  }

  // ---------------------------------------------------------------------------
  // The formatting the reviewer asked for
  // ---------------------------------------------------------------------------
  //
  // gestures.formatIntentFor says WHICH WAY the B or I button is going. This
  // says what that is spelled as, and it is the same move the break shapes
  // above make: the vocabulary is the normalizer's, so the record reads back
  // through the one comparison that decides whether anything changed.
  //
  //   apply   <strong> or <em>, which is what execCommand emits anyway once
  //           styleWithCSS is off, so the engine still does the hard part
  //           (splitting a selection that starts inside a tag and ends outside)
  //   remove  <not-bold> or <not-italic> when the words would still look bold
  //           or italic after the tags come off, because the page's own
  //           stylesheet says so. HTML has no tag for that and every engine
  //           reaches for a style attribute, which is the one thing R35 forbids
  //           the tool putting on a reviewed element. The reset tags are the
  //           normalizer's answer; see the mint note in normalize.js.
  //
  // A removal that has a tag to take off needs no marker at all: taking the
  // <strong> away IS the change, and the structural comparison sees it.
  var FORMAT_SHAPE = { bold: {}, italic: {} };
  FORMAT_SHAPE.bold[gestures.FORMAT.APPLY] = "strong";
  FORMAT_SHAPE.bold[gestures.FORMAT.REMOVE] = normalize.RESET_TAGS.bold;
  FORMAT_SHAPE.italic[gestures.FORMAT.APPLY] = "em";
  FORMAT_SHAPE.italic[gestures.FORMAT.REMOVE] = normalize.RESET_TAGS.italic;

  /**
   * The tag one formatting gesture writes, or null when the pair is not one
   * this tool has.
   *
   * @param {string} command one of COMMANDS
   * @param {string} intent a gestures.FORMAT value
   * @returns {(string|null)}
   */
  function formatShapeFor(command, intent) {
    var shape = Object.prototype.hasOwnProperty.call(FORMAT_SHAPE, command) ? FORMAT_SHAPE[command] : null;
    if (!shape) return null;
    return Object.prototype.hasOwnProperty.call(shape, intent) ? shape[intent] : null;
  }

  /**
   * The markup a break leaves behind, spelled once so the unit test reads the
   * same shape the DOM insertion below builds. Splitting `head` from `tail`
   * with this intent has to read back through the normalizer as
   * head + shape.text + tail, and that round trip is the actual contract: it is
   * what puts the blank line in the record the agent reads.
   *
   * @param {string} intent a gestures.BREAK value
   * @param {string} head the words before the caret
   * @param {string} tail the words after it
   * @returns {string}
   */
  function breakMarkup(intent, head, tail) {
    var shape = breakShapeFor(intent);
    var before = String(head === undefined || head === null ? "" : head);
    var after = String(tail === undefined || tail === null ? "" : tail);
    if (!shape) return before + after;
    if (shape.tag === "br") return before + "<br>" + after;
    return before + "<" + shape.tag + ">" + after + "</" + shape.tag + ">";
  }

  // ---------------------------------------------------------------------------
  // Capture
  // ---------------------------------------------------------------------------

  /**
   * A region's text and markup, as a record carries them.
   *
   * The text is the block's own words, exactly as it READS: the breaks the
   * reviewer typed are in it, and the whitespace the source happens to carry
   * because someone wrapped a line is not. Nothing else about the wording is
   * touched. R3's named failure is helpfulness that changes a reviewer's words,
   * and neither half of this does that.
   *
   * textContent is deliberately NOT the text here, and this is the bug Ken
   * reported on 2026-08-20. Press Enter in the middle of a paragraph and Chrome
   * writes "Hello<p>&nbsp;world.</p>" into the block. textContent reads that as
   * "Hello world.", character for character what the block said before, so the
   * commit compares equal to its own before, the edit is dropped as a no-op,
   * and the break the reviewer is looking at is gone at the next rebuild.
   * normalize.blockText reads the break off the markup instead, so the record
   * says "Hello\n\nworld." and the agent can see there are two paragraphs.
   *
   * The markup goes through cleanMarkup, which is the one direction that is
   * required rather than forbidden: it is what stops anything the library added
   * from reaching a record (R23, R33).
   *
   * @param {Element} regionEl
   * @returns {{text: (string|null), html: (string|null)}}
   */
  function capture(regionEl) {
    if (!regionEl) return { text: null, html: null };
    var html = typeof regionEl.innerHTML === "string" ? normalize.cleanMarkup(regionEl.innerHTML) : null;
    var text =
      html !== null
        ? normalize.blockText(html)
        : typeof regionEl.textContent === "string"
          ? normalize.blockTextFromNode(regionEl)
          : null;
    return { text: text, html: html };
  }

  /**
   * What kind of change this is, decided in one place because three callers
   * would otherwise each decide it.
   *
   * A formatting-only change is still a change (R31), and it is its own kind
   * because it compares on STRUCTURE: its `after` text is identical to its
   * `before` by construction, so a text comparison would make it a silent
   * no-op.
   *
   * @returns {{changed: boolean, kind: (string|null)}}
   */
  function kindFor(before, after) {
    var textSame = normalize.equalsInMode(normalize.MODE.TEXT, String(before.text || ""), String(after.text || ""));
    var structureSame = normalize.equalsInMode(
      normalize.MODE.STRUCTURE,
      String(before.html || ""),
      String(after.html || "")
    );
    if (textSame && structureSame) return { changed: false, kind: null };
    if (textSame) return { changed: true, kind: record.KIND.FORMAT_ONLY };
    return { changed: true, kind: record.KIND.EDIT };
  }

  // ---------------------------------------------------------------------------
  // What an undo means, and the one thing it depends on (R28, R38)
  // ---------------------------------------------------------------------------
  //
  // Undo is the reviewer acting on their own review. It always runs: the tool
  // trusts them to make the edit, so it does not ask permission to unmake it.
  // What changes with the record's state is what the undo LEAVES BEHIND, and
  // lifecycle.canDelete is the one rule that decides which:
  //
  //   draft, ready, not_handled   nothing landed in the source, so the record
  //                               is dropped, here and in the helper's copy.
  //                               There is nothing to ask anyone for.
  //   handled                     the agent already changed the source. The
  //                               record is KEPT (R38: it is the record that a
  //                               fix landed) and the undo mints work:
  //                               record.revertOf, a ready edit pointing the
  //                               other way, which asks for the change to come
  //                               back out of the file. Without it the next
  //                               rebuild puts the change back on the page and
  //                               the reviewer's undo silently expires.
  //
  // This is the whole reason canDelete exists and this is its one production
  // caller. Read as a refusal it would take a capability off the reviewer;
  // read as a branch it says what the undo has to do to be honest.
  var UNDO_ALREADY_TAKEN_BACK =
    "You already took this change back. The agent has been asked to remove it from the source.";

  // ---------------------------------------------------------------------------
  // The surface
  // ---------------------------------------------------------------------------

  function createEditing(options) {
    var opts = options || {};
    var store = opts.store || storeModule.shared;
    var reviewId = opts.reviewId || null;
    var hasDoc = Object.prototype.hasOwnProperty.call(opts, "document");
    var doc = hasDoc ? opts.document : typeof document !== "undefined" ? document : null;
    var win = opts.window || (typeof window !== "undefined" ? window : null);
    var sync = opts.sync || null;
    var isRealDocument = doc && typeof document !== "undefined" && doc === document;
    var highlights =
      opts.highlights ||
      (isRealDocument ? highlightModule.shared : doc ? highlightModule.createHighlights({ document: doc }) : null);
    var defaultPage = opts.page || null;
    // Where a failure this surface cannot act on goes. Boot hands it the rail's
    // failure list (src/layer/index.js); a caller that builds a surface by hand
    // gets nothing, and persist below works either way.
    var onFailure = typeof opts.onFailure === "function" ? opts.onFailure : null;

    // The one open session, or null. Edit state is per region and there is one
    // of it: a second Cmd-Shift-E commits the first.
    var session = null;
    var listenerHandles = [];
    var changeListeners = [];
    var booted = false;
    var frameNode = null;
    var barNode = null;
    var frameRaf = null;
    // Which record belongs to which live element, for the session this page has
    // been open. The anchor is the durable answer and is asked second; this is
    // the cheap one, and it is correct until a repaint, which the anchor covers.
    var itemForElement = [];
    // What a deleted block was, and where, so undoing a delete puts it back
    // where it came from rather than at the end of its parent.
    var deleted = Object.create(null);

    function requireReview() {
      if (!reviewId) throw new Error("editing: a reviewId is required before an edit can be stored");
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
      changeListeners.push(fn);
      return function () {
        changeListeners = changeListeners.filter(function (f) {
          return f !== fn;
        });
      };
    }

    function emit(item, event) {
      for (var i = 0; i < changeListeners.length; i += 1) changeListeners[i](item, event);
    }

    /**
     * The one REMOVAL path, and the mirror of persist().
     *
     * The reviewer took their own record back. The browser dropped it, so the
     * helper's copy goes too: an item left in review.json after the browser
     * dropped it is work the agent would do that nobody is asking for. That is
     * the same rule the comment surface's delete already follows
     * (src/layer/index.js, comments.onChange on "removed"), reached here by the
     * sync this surface was handed rather than by a second delete path.
     *
     * sync posts nothing for an item it never sent (a draft undone before its
     * first flush), so the log stays honest either way.
     */
    function unpersist(item) {
      if (sync && typeof sync.deleteItem === "function") return sync.deleteItem(item);
      return null;
    }

    /**
     * A durable write on the typing path.
     *
     * Storage is full is the ONE failure that does not come back out of here.
     * captureTyping runs on every keystroke, so before this the reviewer's block
     * stopped taking keystrokes the moment the outbox filled browser storage,
     * with nothing on screen to say why (the 2026-09-16 memory audit, finding
     * 1). The reviewer keeps typing, the words stay in the block and in the
     * record, and the rail says what could not be saved. Every other error is
     * still loud. See failures.js tolerateStorageQuota.
     *
     * @returns {null|Object} the failure, when there was one
     */
    function durably(run) {
      return failuresModule.tolerateStorageQuota(run, onFailure);
    }

    // The one write path. Storage first, synchronously, then everyone else.
    function persist(item, event, immediate, postOptions) {
      var refused = durably(function () {
        store.write(requireReview(), item);
      });
      durably(function () {
        emit(item, event);
      });
      // THE POST ONLY EVER FOLLOWS A WRITE THAT LANDED.
      //
      // Posting a record the disk does not have is worse than not posting at
      // all. The helper takes it, acknowledges it, and sync stamps that item
      // acknowledged at that revision; on the next load merge.js's
      // SAME_REV_ACKED rule lets the store win at equal revision, so the STALE
      // record still on disk beats the newer one the reviewer typed. Nothing is
      // lost by waiting: the next keystroke that does land carries the newest
      // wording, and the surface has been holding it all along.
      if (!refused && sync && typeof sync.recordItem === "function") {
        // The queue is a write into the same storage, so it is guarded too.
        durably(function () {
          var post = Object.assign({}, postOptions || {});
          if (immediate) post.immediate = immediate;
          sync.recordItem(item, Object.keys(post).length ? post : undefined);
        });
      }
      return item;
    }

    // ------------------------------------------------------------------------
    // Free writing: the run session
    // ------------------------------------------------------------------------
    //
    // docs/features/20260928.01_free_writing, architecture "The editing host".
    // A run session edits an ANCHOR block plus a RUN of new sibling blocks
    // written after it. The host (blocks.hostFor) is the element made
    // editable; a beforeinput guard refuses every edit outside the anchor and
    // the run, and the layer writes every edit that crosses a block edge
    // itself, so all three engines produce the same structure.
    //
    // Words:
    //   block  the anchor, or one run element (p, h2, h3, h4, ul, ol)
    //   unit   one line the caret can be on: a block, or one li of a list block

    var LIST_TAGS = { ul: 1, ol: 1 };
    var TYPE_LABELS = {};
    gestures.BLOCK_TYPES.forEach(function (t) {
      TYPE_LABELS[t.tag] = t.label;
    });

    function tagOf(el) {
      return el && typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
    }

    function isRun() {
      return !!session && session.mode === MODE.RUN;
    }

    // The anchor, unless it is a container (main or body on an empty page),
    // then every run block, in document order.
    function sessionBlocks() {
      if (!isRun()) return session ? [session.block] : [];
      var out = session.container ? [] : [session.anchor];
      session.run.forEach(function (r) {
        out.push(r.el);
      });
      return out;
    }

    function unitsOf(block) {
      if (LIST_TAGS[tagOf(block)]) {
        var items = [];
        for (var c = block.firstElementChild; c; c = c.nextElementSibling) if (tagOf(c) === "li") items.push(c);
        return items.length ? items : [block];
      }
      return [block];
    }

    function sessionUnits() {
      var out = [];
      sessionBlocks().forEach(function (b) {
        out.push.apply(out, unitsOf(b));
      });
      return out;
    }

    function contains(el, node) {
      return !!el && !!node && (el === node || (typeof el.contains === "function" && el.contains(node)));
    }

    function inSession(node) {
      if (!session || !node) return false;
      var list = sessionBlocks();
      for (var i = 0; i < list.length; i += 1) if (contains(list[i], node)) return true;
      return false;
    }

    function blockOf(node) {
      var list = sessionBlocks();
      for (var i = 0; i < list.length; i += 1) if (contains(list[i], node)) return list[i];
      return null;
    }

    function unitOf(node) {
      var units = sessionUnits();
      for (var i = 0; i < units.length; i += 1) if (contains(units[i], node)) return units[i];
      return null;
    }

    function runEntryOf(el) {
      for (var i = 0; i < session.run.length; i += 1) if (session.run[i].el === el) return session.run[i];
      return null;
    }

    function isFromAnchor(block) {
      if (!block) return false;
      if (block === session.anchor) return true;
      var entry = runEntryOf(block);
      return !!entry && entry.fromAnchor;
    }

    function liveRange() {
      if (!win || typeof win.getSelection !== "function") return null;
      var sel = win.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      return sel.getRangeAt(0);
    }

    function setCaret(node, offset) {
      if (!win || !doc) return null;
      var r = doc.createRange();
      r.setStart(node, offset);
      r.collapse(true);
      var sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return r;
    }

    function textNodes(el) {
      var out = [];
      if (!el) return out;
      var walker = doc.createTreeWalker(el, 4, null);
      for (var n = walker.nextNode(); n; n = walker.nextNode()) out.push(n);
      return out;
    }

    // A caret as {block index, unit index, character offset}: the measurement
    // that survives any node the layer rebuilds.
    function caretSpot(node, offset) {
      var unit = unitOf(node);
      if (!unit) return null;
      var units = sessionUnits();
      var r = doc.createRange();
      r.selectNodeContents(unit);
      try {
        r.setEnd(node, offset);
      } catch (err) {
        return { unit: units.indexOf(unit), offset: 0 };
      }
      return { unit: units.indexOf(unit), offset: r.toString().length };
    }

    function saveCaret() {
      var range = liveRange();
      if (!range) return null;
      var start = caretSpot(range.startContainer, range.startOffset);
      var end = caretSpot(range.endContainer, range.endOffset);
      return start ? { start: start, end: end || start } : null;
    }

    function pointAt(spot) {
      var units = sessionUnits();
      var unit = units[Math.max(0, Math.min(units.length - 1, spot.unit))];
      if (!unit) return null;
      var nodes = textNodes(unit);
      var left = spot.offset;
      for (var i = 0; i < nodes.length; i += 1) {
        var len = nodes[i].nodeValue.length;
        if (left <= len) return { node: nodes[i], offset: left };
        left -= len;
      }
      if (nodes.length) return { node: nodes[nodes.length - 1], offset: nodes[nodes.length - 1].nodeValue.length };
      return { node: unit, offset: 0 };
    }

    function restoreCaret(saved) {
      if (!saved || !win) return false;
      var a = pointAt(saved.start);
      var b = pointAt(saved.end);
      if (!a) return false;
      var r = doc.createRange();
      r.setStart(a.node, a.offset);
      if (b) {
        try {
          r.setEnd(b.node, b.offset);
        } catch (err) {
          r.collapse(true);
        }
      }
      var sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    }

    // An element with nothing in it is not a line the caret can be on, so
    // every empty block or item gets the placeholder break the engines use.
    // It normalizes away.
    function ensureLine(el) {
      if (!hasAnyContent(el)) el.appendChild(doc.createElement("br"));
      return el;
    }

    function isEmptyUnit(el) {
      return String(el.textContent || "").replace(/[\s ​]/g, "") === "";
    }

    // Is there any word after (or before) the caret inside this unit?
    function atUnitEnd(range, unit) {
      var r = doc.createRange();
      r.setStart(range.endContainer, range.endOffset);
      r.setEnd(unit, unit.childNodes.length);
      return r.toString() === "";
    }

    function atUnitStart(range, unit) {
      var r = doc.createRange();
      r.setStart(unit, 0);
      r.setEnd(range.startContainer, range.startOffset);
      return r.toString() === "";
    }

    // Where a new run block after `block` goes. After the anchor it is the one
    // insert-point rule (blocks.insertPointAfter climbs out of a sheet-head);
    // after a run block it is right after that block.
    function insertAfterBlock(block, el, fromAnchor) {
      var point;
      var index;
      if (block === session.anchor) {
        point = session.container ? blocks.startPointIn(session.anchor) : blocks.insertPointAfter(session.anchor);
        index = 0;
      } else {
        point = { parent: block.parentNode, before: block.nextSibling };
        var entry = runEntryOf(block);
        index = session.run.indexOf(entry) + 1;
      }
      point.parent.insertBefore(el, point.before);
      session.run.splice(index, 0, { el: el, fromAnchor: !!fromAnchor, html: null, dirty: true });
      return el;
    }

    function removeRunBlock(el) {
      var entry = runEntryOf(el);
      if (entry) session.run.splice(session.run.indexOf(entry), 1);
      if (el.parentNode) el.parentNode.removeChild(el);
    }

    function markAllDirty() {
      session.run.forEach(function (r) {
        r.dirty = true;
      });
      session.anchorDirty = true;
    }

    function markDirtyAt(node) {
      var block = blockOf(node);
      if (!block) return;
      if (block === session.anchor) session.anchorDirty = true;
      var entry = runEntryOf(block);
      if (entry) entry.dirty = true;
    }

    // One structural change: written inside a write epoch, then everything that
    // reads the blocks catches up at once (protection, the record, the frame).
    function structural(label, fn) {
      var result = epoch.write("editing.run:" + label, fn);
      afterStructural();
      return result;
    }

    function afterStructural() {
      markAllDirty();
      if (protect && typeof protect.snapshot === "function") protect.snapshot();
      captureTyping();
      refreshBar();
    }

    // ---- capture ------------------------------------------------------------

    function escapeText(text) {
      return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    var INLINE_KEEP = { strong: "strong", b: "strong", em: "em", i: "em" };
    INLINE_KEEP[normalize.NOT_BOLD_TAG] = normalize.NOT_BOLD_TAG;
    INLINE_KEEP[normalize.NOT_ITALIC_TAG] = normalize.NOT_ITALIC_TAG;

    // The markup a run block's words carry, spelled only with what cleanBlock
    // keeps: text, strong, em, br and the reset tags, and li in a list. Any
    // other element (a link in a split tail) gives up its tag and keeps its
    // words. cleanBlock then has the last word.
    function inlineMarkup(node) {
      var out = "";
      for (var child = node.firstChild; child; child = child.nextSibling) {
        if (child.nodeType === 3 || child.nodeType === 4) {
          out += escapeText(child.nodeValue);
          continue;
        }
        if (child.nodeType !== 1 || markers.isInsideOverlay(child)) continue;
        var tag = tagOf(child);
        if (tag === "br") out += "<br>";
        else if (tag === "li") out += "<li>" + inlineMarkup(child) + "</li>";
        else if (Object.prototype.hasOwnProperty.call(INLINE_KEEP, tag)) {
          out += "<" + INLINE_KEEP[tag] + ">" + inlineMarkup(child) + "</" + INLINE_KEEP[tag] + ">";
        } else if (tag !== "script" && tag !== "style" && tag !== "template") out += inlineMarkup(child);
      }
      return out;
    }

    /**
     * One run block as the record stores it: exactly what cleanBlock returns,
     * or null when the block has no words (an empty new paragraph, a list of
     * empty items), which never reaches the record.
     */
    function runBlockHtml(el) {
      var cleaned = normalize.cleanBlock(tagOf(el), inlineMarkup(el));
      return typeof cleaned.html === "string" ? cleaned.html : null;
    }

    function anchorMarkup() {
      if (session.container) return "";
      if (session.anchorDirty || typeof session.anchorHtml !== "string") {
        session.anchorHtml = normalize.cleanMarkup(session.anchor.innerHTML);
        session.anchorDirty = false;
      }
      return session.anchorHtml;
    }

    // Capture rebuilds only the blocks marked dirty: on a keystroke that is the
    // caret's block, and only a structural change marks them all.
    function captureRunFields() {
      var list = [];
      session.run.forEach(function (r) {
        if (r.dirty || r.html === undefined) {
          r.html = runBlockHtml(r.el);
          r.dirty = false;
          counters.blocksCaptured += 1;
        }
        if (r.html === null) return;
        var b = { tag: tagOf(r.el), html: r.html };
        if (r.fromAnchor) b.from_anchor = true;
        list.push(b);
      });
      var anchorHtml = anchorMarkup();
      var tag = session.container ? null : tagOf(session.anchor);
      var tagAfter = !session.container && tag !== session.anchorTag ? tag : null;
      var built = record.buildRunAfter(anchorHtml, list);
      return {
        anchor_after_html: anchorHtml,
        anchor_tag_after: tagAfter,
        new_blocks: list,
        placement: session.placement,
        after: built.after,
        after_html: built.after_html
      };
    }

    // Does this sitting take the run record's shape? Once a record has it, it
    // keeps it. Otherwise a new block, a tag change, a list anchor or a
    // container anchor gives it; a plain reword of one block stays today's
    // record, byte for byte.
    function runShaped(fields) {
      return (
        session.runShaped ||
        session.container ||
        fields.new_blocks.length > 0 ||
        !!fields.anchor_tag_after ||
        !!LIST_TAGS[session.anchorTag]
      );
    }

    function runVerdict(fields, beforeArg) {
      var before = beforeArg || session.before || { text: "", html: "" };
      var anchorText = normalize.blockText(fields.anchor_after_html || "");
      var textSame = normalize.equalsInMode(normalize.MODE.TEXT, String(before.text || ""), anchorText);
      var structureSame = normalize.equalsInMode(
        normalize.MODE.STRUCTURE,
        String(before.html || ""),
        String(fields.anchor_after_html || "")
      );
      var changed = fields.new_blocks.length > 0 || !!fields.anchor_tag_after || !textSame || !structureSame;
      if (!changed) return { changed: false, kind: null };
      var edit = fields.new_blocks.length > 0 || !textSame;
      return { changed: true, kind: edit ? record.KIND.EDIT : record.KIND.FORMAT_ONLY };
    }

    // Is the sitting, as it stands, different from where it opened? Used on
    // reopen, where "changed" means changed since this sitting began.
    function runKey(fields) {
      return JSON.stringify([fields.anchor_after_html, fields.anchor_tag_after, fields.new_blocks]);
    }

    function applyRunFields(target, fields, verdict) {
      target[record.FIELD.AFTER] = fields.after;
      target[record.FIELD.AFTER_HTML] = fields.after_html;
      target[record.FIELD.ANCHOR_AFTER_HTML] = fields.anchor_after_html;
      target[record.FIELD.ANCHOR_TAG_AFTER] = fields.anchor_tag_after;
      target[record.FIELD.NEW_BLOCKS] = fields.new_blocks;
      target[record.FIELD.PLACEMENT] = fields.placement;
      if (verdict && verdict.kind) target[record.FIELD.KIND] = verdict.kind;
      return target;
    }

    // ---- the ceiling ---------------------------------------------------------

    function ceilingState(fields) {
      var count = fields.new_blocks.length;
      var bytes = record.blocksBytes(fields.new_blocks);
      // The record apart from the run is measured once, when the session
      // opens; the run rides in it twice (new_blocks and after_html).
      var estimate = session.baseBytes + bytes * 2 + count * 48;
      var ratio = Math.max(
        count / record.NEW_BLOCKS_MAX,
        bytes / record.NEW_BLOCKS_MAX_BYTES,
        estimate / record.RUN_RECORD_MAX_BYTES
      );
      return { count: count, bytes: bytes, estimate: estimate, ratio: ratio };
    }

    // Would this much more (blocks, bytes) take the run over a ceiling?
    function overCeiling(moreBlocks, moreBytes) {
      var c = session.ceiling || { count: 0, bytes: 0, estimate: session.baseBytes };
      return (
        c.count + moreBlocks > record.NEW_BLOCKS_MAX ||
        c.bytes + moreBytes > record.NEW_BLOCKS_MAX_BYTES ||
        c.estimate + moreBytes * 2 + moreBlocks * 48 > record.RUN_RECORD_MAX_BYTES
      );
    }

    function refuseAtCeiling() {
      session.ceilingRefused = true;
      refreshBar();
    }

    function utf8Length(text) {
      var s = String(text || "");
      if (typeof TextEncoder === "function") return new TextEncoder().encode(s).length;
      return s.length;
    }

    // ---- the live region -----------------------------------------------------

    var liveNode = null;
    var announced = [];

    function announce(text) {
      announced.push(text);
      if (announced.length > 50) announced.shift();
      var host = surface();
      if (!host) return text;
      if (!liveNode) {
        liveNode = doc.createElement("div");
        liveNode.className = "lahe-edit-live";
        liveNode.setAttribute("role", "status");
        liveNode.setAttribute("aria-live", "polite");
        markers.markChrome(liveNode);
        host.appendChild(liveNode);
      }
      // Cleared first, so saying the same line twice is still heard twice.
      liveNode.textContent = "";
      liveNode.textContent = text;
      return text;
    }

    function firstWords(text) {
      var words = normalize.normalizeText(String(text || "")).split(" ").filter(Boolean);
      return words.slice(0, FIRST_WORDS).join(" ");
    }

    // ---- opening --------------------------------------------------------------

    /**
     * The block a gesture on `el` anchors a sitting on: the whole list for a
     * list item, otherwise the block itself.
     */
    function anchorBlockFor(el) {
      var node = el;
      while (node && node.nodeType === 1) {
        if (LIST_TAGS[tagOf(node)]) return node;
        if (tagOf(node) === "li") {
          node = node.parentElement;
          continue;
        }
        break;
      }
      return el;
    }

    // A record from before free writing: no run fields, and markup that
    // nests blocks inside the edited element. Reopening it keeps today's
    // single-element session and break rule.
    function isOldShape(item) {
      if (!item || record.hasRunFields(item)) return false;
      return /<(p|div|h[1-6]|ul|ol|li|blockquote|pre)[\s>]/i.test(String(item[record.FIELD.AFTER_HTML] || ""));
    }

    // The outstanding run record one of whose run blocks is `el`, with its
    // resolved anchor and the run's elements.
    function runRecordHolding(el) {
      if (!reviewId) return null;
      var items = store.read(reviewId);
      for (var i = 0; i < items.length; i += 1) {
        var item = items[i];
        if (!record.isRunRecord(item) || item[record.FIELD.STATE] === record.STATE.HANDLED) continue;
        var anchorEl = elementFor(item);
        if (!anchorEl) continue;
        var found = blocks.runElementsFor(item, doc, anchorEl);
        for (var b = 0; b < found.blocks.length; b += 1) {
          var els = found.blocks[b].elements;
          for (var k = 0; k < els.length; k += 1) {
            if (contains(els[k], el)) return { item: item, anchor: anchorEl, found: found };
          }
        }
      }
      return null;
    }

    // The run a reopened record already has on the page, as session entries.
    function runEntriesFor(item, anchorEl, found) {
      var got = found || blocks.runElementsFor(item, doc, anchorEl);
      var list = item[record.FIELD.NEW_BLOCKS] || [];
      var out = [];
      got.blocks.forEach(function (b) {
        b.elements.forEach(function (el) {
          if (out.some(function (e) { return e.el === el; })) return;
          out.push({ el: el, fromAnchor: !!(list[b.index] && list[b.index].from_anchor), html: null, dirty: true });
        });
      });
      return out;
    }

    function isContainerTag(el) {
      return blocks.isContainerAnchor(el);
    }

    /**
     * Opens a run session.
     *
     * @param {Element} anchorEl the anchor (a container for an empty page)
     * @param {Object} opts {existing, run, placement, caretEl}
     */
    function openRun(anchorEl, opts) {
      var o = opts || {};
      var existing = o.existing || null;
      var placement = o.placement || (isContainerTag(anchorEl) ? record.PLACEMENT.START_OF_CONTAINER : record.PLACEMENT.AFTER_ANCHOR);
      var container = placement === record.PLACEMENT.START_OF_CONTAINER;
      var saved = liveRange() ? liveRange().cloneRange() : null;
      bootCommands();

      var before;
      var item;
      if (existing) {
        item = existing;
        before = { text: item[record.FIELD.BEFORE], html: item[record.FIELD.BEFORE_HTML] };
      } else {
        before = container ? { text: "", html: "" } : capture(anchorEl);
        var editRegion = regionFor(anchorEl);
        item = record.newItem({
          kind: record.KIND.EDIT,
          state: record.STATE.DRAFT,
          before: before.text,
          before_html: before.html,
          page_origin: pageField("origin"),
          page_path: pageField("path"),
          page_title: pageField("title"),
          page_seq: pageField("seq"),
          source_hint: pageField("source_hint"),
          region: editRegion,
          context: contextFor(anchorEl, editRegion)
        });
        persist(item, "opened");
      }

      var ref = item[record.FIELD.REGION] && item[record.FIELD.REGION].ref;
      var mintedTag = ref && ref.fingerprint && ref.fingerprint.tag ? String(ref.fingerprint.tag).toLowerCase() : tagOf(anchorEl);
      var host = blocks.hostFor(anchorEl, placement);

      session = {
        mode: MODE.RUN,
        block: anchorEl,
        anchor: anchorEl,
        anchorTag: container ? tagOf(anchorEl) : mintedTag,
        container: container,
        placement: placement,
        host: host,
        run: o.run || [],
        itemId: item[record.FIELD.ID],
        before: before,
        composing: false,
        lastKey: null,
        wasNew: !existing,
        wasCommitted: !!existing && isCommittedEdit(existing),
        withdrawFrom: existing && withdrawable(existing) ? existing[record.FIELD.STATE] : null,
        runShaped: !!existing && record.hasRunFields(existing),
        anchorDirty: true,
        anchorHtml: undefined,
        openedKey: null,
        opened: existing
          ? { text: existing[record.FIELD.AFTER], html: existing[record.FIELD.AFTER_HTML] }
          : before,
        baseBytes: record.recordBytes(Object.assign({}, item, { new_blocks: [], after_html: "", after: "" })),
        ceiling: null,
        ceilingRefused: false,
        history: { undo: [], redo: [], burst: null },
        hostAttrs: {},
        startedAt: Date.now()
      };
      session.openedKey = runKey(captureRunFields());
      session.openedAnchorHtml = anchorMarkup();
      session.ceiling = ceilingState(captureRunFields());

      applyHostAttrs(host);
      protect.mark(anchorEl, {
        reason: "edit",
        item: item[record.FIELD.ID],
        blocks: function () {
          return sessionBlocks();
        },
        host: function () {
          return session ? session.host : null;
        },
        // A repaint that rebuilt the anchor without an attribute protection
        // can find it by: the anchor engine finds it by its words.
        refind: function () {
          var own = session ? store.readItem(requireReview(), session.itemId) : null;
          return own ? elementFor(own) : null;
        },
        container: container,
        placement: placement
      });
      rememberSession();
      bindBlock(host);
      drawFrame(anchorEl);
      if (typeof host.focus === "function") {
        try {
          host.focus({ preventScroll: true });
        } catch (err) {
          host.focus();
        }
      }
      if (o.caretEl) setCaret(o.caretEl, 0);
      else if (saved && inSession(saved.startContainer)) {
        var sel = win.getSelection();
        sel.removeAllRanges();
        sel.addRange(saved);
      } else if (!container) {
        var last = textNodes(anchorEl).pop();
        if (last) setCaret(last, last.nodeValue.length);
        else setCaret(anchorEl, 0);
      }
      if (protect && typeof protect.snapshot === "function") protect.snapshot();
      announce(
        container ? ANNOUNCE.START_OF_PAGE : ANNOUNCE.AFTER.replace("{words}", firstWords(anchorEl.textContent))
      );
      refreshBar();
      return sessionInfo();
    }

    function rememberSession() {
      if (!session) return;
      remember(session.anchor, session.itemId);
      session.run.forEach(function (r) {
        rememberAlso(r.el, session.itemId);
      });
    }

    function applyHostAttrs(host) {
      epoch.write("editing.enter", function () {
        var all = Object.assign({}, EDITABLE_ATTRS);
        all[markers.EDIT_HOST_ATTR] = "true";
        Object.keys(all).forEach(function (name) {
          if (!Object.prototype.hasOwnProperty.call(session.hostAttrs, name)) {
            session.hostAttrs[name] = host.hasAttribute(name) ? host.getAttribute(name) : null;
          }
          host.setAttribute(name, all[name]);
        });
      });
    }

    function clearHostAttrs(open) {
      var host = open.host;
      if (!host) return;
      epoch.write("editing.leave", function () {
        Object.keys(open.hostAttrs).forEach(function (name) {
          var was = open.hostAttrs[name];
          if (was === null) host.removeAttribute(name);
          else host.setAttribute(name, was);
        });
      });
    }

    // ---- Enter -------------------------------------------------------------------

    function newParagraph() {
      return ensureLine(doc.createElement("p"));
    }

    function extractTail(range, unit, tag) {
      var tail = doc.createElement(tag);
      var rest = doc.createRange();
      rest.setStart(range.endContainer, range.endOffset);
      rest.setEnd(unit, unit.childNodes.length);
      tail.appendChild(rest.extractContents());
      // The space at a split point goes with the split, as in every editor:
      // the head does not end in one and the tail does not start with one.
      trimEdgeSpace(unit, false);
      trimEdgeSpace(tail, true);
      ensureLine(tail);
      ensureLine(unit);
      return tail;
    }

    function trimEdgeSpace(el, leading) {
      var nodes = textNodes(el);
      if (!nodes.length) return;
      var n = leading ? nodes[0] : nodes[nodes.length - 1];
      n.nodeValue = leading ? n.nodeValue.replace(/^[ \u00a0]+/, "") : n.nodeValue.replace(/[ \u00a0]+$/, "");
    }

    /**
     * Enter inside a run session, decided by gestures.enterIntentFor.
     *
     * @returns {boolean} true when the layer wrote the change
     */
    function runEnter(shiftKey) {
      var range = liveRange();
      if (!range) return false;
      var unit = unitOf(range.startContainer);
      if (!unit || unit !== unitOf(range.endContainer)) {
        if (!deleteSpan()) return false;
        range = liveRange();
        unit = unitOf(range.startContainer);
        if (!unit) return false;
      }
      var block = blockOf(unit);
      var inItem = tagOf(unit) === "li";
      var intent = gestures.enterIntentFor({
        shiftKey: shiftKey,
        atEnd: atUnitEnd(range, unit),
        inListItem: inItem,
        itemEmpty: inItem && isEmptyUnit(unit),
        lastItem: inItem && !unit.nextElementSibling,
        runAllowed: true
      });
      var grows = intent === gestures.ENTER.SIBLING || intent === gestures.ENTER.SPLIT || intent === gestures.ENTER.END_LIST;
      if (grows && overCeiling(1, 0)) {
        refuseAtCeiling();
        return true;
      }
      pushHistory();
      if (intent === gestures.ENTER.LINE) {
        epoch.write("editing.run:line", function () {
          range.deleteContents();
          var caret = writeLineBreak(range, unit);
          win.getSelection().removeAllRanges();
          win.getSelection().addRange(caret);
        });
        markDirtyAt(unit);
        afterStructural();
        return true;
      }
      structural("enter", function () {
        range.deleteContents();
        if (intent === gestures.ENTER.NEW_ITEM) {
          var li = extractTail(range, unit, "li");
          unit.parentNode.insertBefore(li, unit.nextSibling);
          setCaret(li, 0);
        } else if (intent === gestures.ENTER.END_LIST) {
          var list = unit.parentNode;
          list.removeChild(unit);
          var p = newParagraph();
          if (!list.firstElementChild && list !== session.anchor) {
            list.parentNode.replaceChild(p, list);
            var entry = runEntryOf(list);
            entry.el = p;
            entry.fromAnchor = false;
          } else {
            insertAfterBlock(list, p, false);
          }
          setCaret(p, 0);
        } else if (intent === gestures.ENTER.SIBLING) {
          var sib = newParagraph();
          insertAfterBlock(block, sib, false);
          setCaret(sib, 0);
        } else {
          var tail = extractTail(range, unit, tagOf(unit));
          insertAfterBlock(block, tail, isFromAnchor(block));
          setCaret(tail, 0);
        }
      });
      return true;
    }

    // ---- deletes across a block edge ----------------------------------------------

    // Merge unit `b` into the end of unit `a`, and remove `b` (and its block,
    // when that leaves the block with nothing).
    function mergeUnits(a, b) {
      var at = textNodes(a).pop();
      var spot = at ? { node: at, offset: at.nodeValue.length } : null;
      // A trailing placeholder break in `a` goes: the words after it are real.
      var lastEl = a.lastChild;
      while (lastEl && lastEl.nodeType === 3 && lastEl.nodeValue === "") lastEl = lastEl.previousSibling;
      if (lastEl && tagOf(lastEl) === "br") a.removeChild(lastEl);
      var firstMoved = null;
      while (b.firstChild) {
        var child = b.firstChild;
        if (!firstMoved) firstMoved = child;
        if (tagOf(child) === "br" && !child.nextSibling) {
          b.removeChild(child);
          continue;
        }
        a.appendChild(child);
      }
      var bBlock = blockOf(b) || b;
      if (bBlock === b) removeRunBlock(b);
      else {
        b.parentNode.removeChild(b);
        if (!bBlock.firstElementChild && bBlock !== session.anchor) removeRunBlock(bBlock);
      }
      ensureLine(a);
      if (spot && spot.node.parentNode) setCaret(spot.node, spot.offset);
      else setCaret(a, 0);
    }

    // Delete a selection that spans units, keeping the head of the first and
    // the tail of the last as one unit. Every unit in between goes.
    function deleteSpan() {
      var range = liveRange();
      if (!range || range.collapsed) return false;
      var first = unitOf(range.startContainer);
      var last = unitOf(range.endContainer);
      if (!first || !last) return false;
      if (first === last) {
        epoch.write("editing.run:delete", function () {
          range.deleteContents();
          ensureLine(first);
        });
        markDirtyAt(first);
        return true;
      }
      var units = sessionUnits();
      var from = units.indexOf(first);
      var to = units.indexOf(last);
      epoch.write("editing.run:delete_span", function () {
        var head = doc.createRange();
        head.setStart(range.startContainer, range.startOffset);
        head.setEnd(first, first.childNodes.length);
        head.deleteContents();
        var tail = doc.createRange();
        tail.setStart(last, 0);
        tail.setEnd(range.endContainer, range.endOffset);
        tail.deleteContents();
        for (var i = from + 1; i < to; i += 1) {
          var u = units[i];
          var ub = blockOf(u);
          if (ub === u) removeRunBlock(u);
          else {
            u.parentNode.removeChild(u);
            if (!ub.firstElementChild && ub !== session.anchor) removeRunBlock(ub);
          }
        }
        mergeUnits(first, last);
      });
      afterStructural();
      return true;
    }

    function runEdgeDelete(key) {
      var range = liveRange();
      if (!range) return null;
      var unit = unitOf(range.startContainer);
      if (!unit) return null;
      var units = sessionUnits();
      var index = units.indexOf(unit);
      var spans = !range.collapsed && unitOf(range.endContainer) !== unit;
      var intent = gestures.edgeDeleteFor({
        key: key,
        collapsed: range.collapsed,
        spansBlocks: spans,
        atBlockStart: range.collapsed && atUnitStart(range, unit),
        atBlockEnd: range.collapsed && atUnitEnd(range, unit),
        firstBlock: index === 0,
        lastBlock: index === units.length - 1
      });
      if (!intent) return null;
      if (intent === gestures.EDGE.REFUSE) return intent;
      pushHistory();
      if (intent === gestures.EDGE.DELETE_SELECTION) {
        deleteSpan();
        return intent;
      }
      structural("merge", function () {
        if (intent === gestures.EDGE.MERGE_PREVIOUS) mergeUnits(units[index - 1], unit);
        else mergeUnits(unit, units[index + 1]);
      });
      return intent;
    }

    // ---- plain text in: typing over a span, paste, drop -------------------------

    function insertTextAtCaret(text) {
      var range = liveRange();
      if (!range) return false;
      var node = doc.createTextNode(text);
      range.deleteContents();
      range.insertNode(node);
      // A placeholder break right after the new words is no longer needed.
      var next = node.nextSibling;
      if (next && tagOf(next) === "br" && !next.nextSibling && text) next.parentNode.removeChild(next);
      setCaret(node, node.nodeValue.length);
      markDirtyAt(node);
      return true;
    }

    /**
     * Plain text into the session at the caret: a blank line starts a new
     * paragraph, a single newline is a line break. Rich paste waits on board
     * row LAHE-rich-paste.
     */
    function insertPlain(text) {
      var paragraphs = String(text || "").replace(/\r\n?/g, "\n").split(/\n[ \t]*\n+/);
      pushHistory();
      if (liveRange() && !liveRange().collapsed) deleteSpan();
      for (var i = 0; i < paragraphs.length; i += 1) {
        if (i > 0) {
          if (overCeiling(1, 0)) {
            refuseAtCeiling();
            break;
          }
          runEnterRaw();
        }
        var lines = paragraphs[i].split("\n");
        for (var l = 0; l < lines.length; l += 1) {
          if (l > 0) {
            var r = liveRange();
            epoch.write("editing.run:paste_line", function () {
              var caret = writeLineBreak(r, unitOf(r.startContainer));
              win.getSelection().removeAllRanges();
              win.getSelection().addRange(caret);
            });
          }
          if (!lines[l]) continue;
          if (overCeiling(0, utf8Length(lines[l]))) {
            refuseAtCeiling();
            i = paragraphs.length;
            break;
          }
          epoch.write("editing.run:paste", insertTextAtCaret.bind(null, lines[l]));
          session.ceiling = ceilingState(captureRunFields());
        }
      }
      afterStructural();
      return true;
    }

    // Enter as paste uses it: no history step of its own, no ceiling check.
    function runEnterRaw() {
      var range = liveRange();
      var unit = unitOf(range.startContainer);
      var block = blockOf(unit);
      epoch.write("editing.run:paste_break", function () {
        if (tagOf(unit) === "li") {
          var li = extractTail(range, unit, "li");
          unit.parentNode.insertBefore(li, unit.nextSibling);
          setCaret(li, 0);
          return;
        }
        if (atUnitEnd(range, unit)) {
          var p = newParagraph();
          insertAfterBlock(block, p, false);
          setCaret(p, 0);
          return;
        }
        var tail = extractTail(range, unit, tagOf(unit));
        insertAfterBlock(block, tail, isFromAnchor(block));
        setCaret(tail, 0);
      });
      markDirtyAt(unit);
      session.ceiling = ceilingState(captureRunFields());
    }

    // ---- block types -------------------------------------------------------------

    /**
     * What the menu, the hotkeys and the shortcuts may do for the caret's unit.
     *
     * @returns {{label: string, other: boolean, enabled: Object}}
     */
    function typeState() {
      var enabled = {};
      gestures.BLOCK_TYPES.forEach(function (t) {
        enabled[t.tag] = false;
      });
      if (!isRun()) return { label: gestures.OTHER_BLOCK_LABEL, other: true, enabled: enabled, tag: null };
      var range = liveRange();
      var unit = range ? unitOf(range.startContainer) : null;
      if (!unit && session.caretUnit && session.caretUnit.isConnected) unit = session.caretUnit;
      if (!unit) return { label: gestures.OTHER_BLOCK_LABEL, other: true, enabled: enabled, tag: null };
      var block = blockOf(unit);
      var tag = tagOf(block);
      if (!Object.prototype.hasOwnProperty.call(TYPE_LABELS, tag)) {
        return { label: gestures.OTHER_BLOCK_LABEL, other: true, enabled: enabled, tag: tag };
      }
      if (LIST_TAGS[tag]) {
        enabled.ul = true;
        enabled.ol = true;
        enabled.p = tagOf(unit) === "li" && !unit.nextElementSibling;
      } else {
        Object.keys(enabled).forEach(function (k) {
          enabled[k] = true;
        });
      }
      return { label: TYPE_LABELS[tag], other: false, enabled: enabled, tag: tag };
    }

    function replaceBlock(oldEl, nextEl) {
      if (oldEl === session.anchor) {
        session.anchor = nextEl;
        session.block = nextEl;
        if (protect && typeof protect.rebindTo === "function") protect.rebindTo(nextEl);
        remember(nextEl, session.itemId);
      } else {
        var entry = runEntryOf(oldEl);
        if (entry) entry.el = nextEl;
        rememberAlso(nextEl, session.itemId);
      }
      return nextEl;
    }

    /**
     * The one function every block type goes through. The menu, the hotkeys
     * and the Markdown shortcuts each call typeActions[tag], which lands here.
     *
     * @returns {boolean} true when the block changed
     */
    function applyType(tag) {
      var state = typeState();
      if (state.other || !state.enabled[tag]) return false;
      var range = liveRange();
      var unit = range ? unitOf(range.startContainer) : session.caretUnit;
      if (!unit) return false;
      var block = blockOf(unit);
      var current = tagOf(block);
      if (current === tag && !(tag === "p" && tagOf(unit) === "li")) return false;
      var caret = saveCaret();
      pushHistory();
      var caretBlockIndex = sessionBlocks().indexOf(block);
      var moved = null;
      structural("type:" + tag, function () {
        if (LIST_TAGS[current] && LIST_TAGS[tag]) {
          replaceBlock(block, blocks.swapTag(block, tag));
        } else if (LIST_TAGS[current] && tag === "p") {
          var items = unitsOf(block);
          if (items.length === 1) {
            var p = replaceBlock(block, blocks.swapTag(block, "p"));
            var only = p.firstElementChild;
            while (only.firstChild) p.insertBefore(only.firstChild, only);
            p.removeChild(only);
            ensureLine(p);
          } else {
            var para = doc.createElement("p");
            while (unit.firstChild) para.appendChild(unit.firstChild);
            ensureLine(para);
            block.removeChild(unit);
            insertAfterBlock(block, para, isFromAnchor(block));
            moved = para;
          }
        } else if (LIST_TAGS[tag]) {
          var list = replaceBlock(block, blocks.swapTag(block, tag));
          var li = doc.createElement("li");
          while (list.firstChild) li.appendChild(list.firstChild);
          ensureLine(li);
          list.appendChild(li);
        } else {
          replaceBlock(block, blocks.swapTag(block, tag));
        }
      });
      if (moved) setCaret(moved, 0);
      else if (caret) {
        void caretBlockIndex;
        restoreCaret(caret);
      }
      if (protect && typeof protect.snapshot === "function") protect.snapshot();
      announce(TYPE_LABELS[tag]);
      refreshBar();
      return true;
    }

    var typeActions = {};
    gestures.BLOCK_TYPES.forEach(function (t) {
      typeActions[t.tag] = function () {
        return applyType(t.tag);
      };
    });

    // "# " and the rest, typed at the start of a block. Its own history step,
    // so Cmd-Z gives back the typed characters (brief R6).
    function maybeShortcut() {
      var range = liveRange();
      if (!range || !range.collapsed) return false;
      var unit = unitOf(range.startContainer);
      if (!unit || tagOf(unit) === "li") return false;
      var head = doc.createRange();
      head.setStart(unit, 0);
      head.setEnd(range.startContainer, range.startOffset);
      var tag = gestures.markdownShortcutFor(head.toString().replace(/ /g, " "));
      if (!tag || !typeState().enabled[tag]) return false;
      closeBurst();
      pushHistory(true);
      epoch.write("editing.run:shortcut", function () {
        head.deleteContents();
        ensureLine(unit);
      });
      setCaret(unit.firstChild && unit.firstChild.nodeType === 3 ? unit.firstChild : unit, 0);
      markDirtyAt(unit);
      var changed = applyTypeNoHistory(tag);
      return changed;
    }

    function applyTypeNoHistory(tag) {
      var saved = session.history.suspend;
      session.history.suspend = true;
      try {
        return applyType(tag);
      } finally {
        session.history.suspend = saved;
      }
    }

    // ---- session history (Task 2.4) --------------------------------------------

    function stateNow() {
      return {
        anchorTag: session.container ? null : tagOf(session.anchor),
        anchorHtml: session.container ? null : session.anchor.innerHTML,
        run: session.run.map(function (r) {
          return { tag: tagOf(r.el), html: r.el.innerHTML, fromAnchor: r.fromAnchor };
        }),
        caret: saveCaret()
      };
    }

    function pushHistory(force) {
      if (!isRun() || session.history.suspend) return;
      var h = session.history;
      if (h.burst && !force) closeBurst();
      h.undo.push(stateNow());
      while (h.undo.length > SESSION_HISTORY_MAX) h.undo.shift();
      h.redo = [];
    }

    // A typing burst is one step: its state before the first keystroke goes on
    // the stack, and a pause of TYPING_BURST_IDLE_MS ends it.
    function noteTyping() {
      if (!isRun() || session.history.suspend) return;
      var h = session.history;
      if (!h.burst) {
        h.undo.push(stateNow());
        while (h.undo.length > SESSION_HISTORY_MAX) h.undo.shift();
        h.redo = [];
        h.burst = { timer: null };
      }
      if (h.burst.timer && win) win.clearTimeout(h.burst.timer);
      if (win) {
        h.burst.timer = win.setTimeout(function () {
          if (session && session.history === h) closeBurst();
        }, TYPING_BURST_IDLE_MS);
      }
    }

    function closeBurstOf(open) {
      if (open && open.history && open.history.burst && open.history.burst.timer && win) win.clearTimeout(open.history.burst.timer);
    }

    function closeBurst() {
      if (!session) return;
      var h = session.history;
      if (h.burst && h.burst.timer && win) win.clearTimeout(h.burst.timer);
      h.burst = null;
    }

    function applyState(state) {
      epoch.write("editing.run:history", function () {
        if (!session.container) {
          if (tagOf(session.anchor) !== state.anchorTag) replaceBlock(session.anchor, blocks.swapTag(session.anchor, state.anchorTag));
          session.anchor.innerHTML = state.anchorHtml;
        }
        session.run.slice().forEach(function (r) {
          removeRunBlock(r.el);
        });
        var prev = session.anchor;
        state.run.forEach(function (b) {
          var el = doc.createElement(b.tag);
          el.innerHTML = b.html;
          insertAfterBlock(prev, el, b.fromAnchor);
          rememberAlso(el, session.itemId);
          prev = el;
        });
      });
      restoreCaret(state.caret);
      afterStructural();
    }

    function historyStep(intent) {
      if (!isRun()) return false;
      closeBurst();
      var h = session.history;
      var from = intent === gestures.HISTORY.UNDO ? h.undo : h.redo;
      var to = intent === gestures.HISTORY.UNDO ? h.redo : h.undo;
      if (!from.length) return false;
      var target = from.pop();
      to.push(stateNow());
      applyState(target);
      return true;
    }

    // ---- the guard --------------------------------------------------------------

    function rangeInSession(range) {
      if (!range) return false;
      return inSession(range.startContainer) && inSession(range.endContainer);
    }

    function targetRange(event) {
      if (typeof event.getTargetRanges === "function") {
        var ranges = event.getTargetRanges();
        if (ranges && ranges.length) return ranges[0];
      }
      return liveRange();
    }

    var ALLOWED_FORMATS = { formatBold: 1, formatItalic: 1 };

    /**
     * Every edit in the host comes through here first. Anything outside the
     * anchor and the run is refused; anything that crosses a block edge is
     * cancelled and written by the layer.
     */
    function onRunBeforeInput(event) {
      if (!isRun() || markers.isInsideOverlay(event.target)) return;
      var type = String(event.inputType || "");
      if (session.composing || type === "insertCompositionText") return;
      var refuse = function () {
        if (typeof event.preventDefault === "function") event.preventDefault();
        counters.refused += 1;
      };
      var sel = liveRange();
      if (!rangeInSession(sel) || !rangeInSession(targetRange(event))) {
        // A Backspace at the anchor's start reaches into the page block before
        // it; that is the refused edge, not a guard hit worth more than that.
        refuse();
        return;
      }
      if (type === "historyUndo" || type === "historyRedo") {
        refuse();
        historyStep(type === "historyUndo" ? gestures.HISTORY.UNDO : gestures.HISTORY.REDO);
        return;
      }
      if (type === "insertParagraph" || type === "insertLineBreak") {
        refuse();
        var shift =
          type === "insertLineBreak" ||
          !!(session.lastKey && session.lastKey.key === "Enter" && session.lastKey.shiftKey);
        runEnter(shift);
        return;
      }
      if (/^delete/.test(type)) {
        var key = /Forward$/.test(type) ? "Delete" : "Backspace";
        var spans = sel && !sel.collapsed && unitOf(sel.startContainer) !== unitOf(sel.endContainer);
        if (spans) {
          refuse();
          pushHistory();
          deleteSpan();
          return;
        }
        if (type === "deleteContentBackward" || type === "deleteContentForward") {
          var edge = runEdgeDelete(key);
          if (edge) refuse();
          else noteTyping();
        } else noteTyping();
        return;
      }
      if (type === "insertFromPaste" || type === "insertFromDrop" || type === "insertFromPasteAsQuotation" || type === "insertFromYank") {
        refuse();
        var data = event.dataTransfer && typeof event.dataTransfer.getData === "function" ? event.dataTransfer.getData("text/plain") : null;
        if (data === null || data === undefined) data = typeof event.data === "string" ? event.data : "";
        if (data && !session.pasteHandled) insertPlain(data);
        session.pasteHandled = false;
        return;
      }
      if (/^format/.test(type)) {
        if (!ALLOWED_FORMATS[type]) refuse();
        return;
      }
      if (type === "insertText" || type === "insertReplacementText") {
        var text = typeof event.data === "string" ? event.data : "";
        if (text && overCeiling(0, utf8Length(text))) {
          refuse();
          refuseAtCeiling();
          return;
        }
        if (sel && !sel.collapsed && unitOf(sel.startContainer) !== unitOf(sel.endContainer)) {
          refuse();
          pushHistory();
          deleteSpan();
          if (text) {
            epoch.write("editing.run:type_over", insertTextAtCaret.bind(null, text));
            afterStructural();
          }
          return;
        }
        noteTyping();
        return;
      }
      // Anything else an engine may send (insertOrderedList, insertHorizontalRule,
      // and the rest): not a gesture this tool has, so it does nothing.
      if (/^insert/.test(type) && type !== "insertText") refuse();
    }

    function onRunPaste(event) {
      if (!isRun() || markers.isInsideOverlay(event.target)) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (!rangeInSession(liveRange())) return;
      var cd = event.clipboardData;
      var text = cd && typeof cd.getData === "function" ? cd.getData("text/plain") : "";
      session.pasteHandled = true;
      if (text) insertPlain(text);
      if (win) {
        win.setTimeout(function () {
          if (session) session.pasteHandled = false;
        }, 0);
      }
    }

    function onRunDrop(event) {
      if (!isRun() || markers.isInsideOverlay(event.target)) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      var dt = event.dataTransfer;
      var text = dt && typeof dt.getData === "function" ? dt.getData("text/plain") : "";
      var point = null;
      if (typeof doc.caretRangeFromPoint === "function") point = doc.caretRangeFromPoint(event.clientX, event.clientY);
      else if (typeof doc.caretPositionFromPoint === "function") {
        var pos = doc.caretPositionFromPoint(event.clientX, event.clientY);
        if (pos) {
          point = doc.createRange();
          point.setStart(pos.offsetNode, pos.offset);
        }
      }
      if (!point || !inSession(point.startContainer) || !text) return;
      setCaret(point.startContainer, point.startOffset);
      session.pasteHandled = true;
      insertPlain(text);
      if (win) {
        win.setTimeout(function () {
          if (session) session.pasteHandled = false;
        }, 0);
      }
    }

    // A cut that reaches outside the session copies nothing and deletes
    // nothing; one inside it is deleted by the guard like any spanning delete.
    function onRunCut(event) {
      if (!isRun() || markers.isInsideOverlay(event.target)) return;
      if (!rangeInSession(liveRange()) && typeof event.preventDefault === "function") event.preventDefault();
    }

    // A composition cannot be cancelled. One that starts outside the session
    // has the block it lands in put back when it ends.
    function onRunCompositionStart(event) {
      if (!isRun()) return;
      var range = liveRange();
      if (range && !inSession(range.startContainer)) {
        var el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
        var block = selection.blockFor(el) || el;
        session.stray = { el: block, html: block.innerHTML };
        return;
      }
      session.composing = true;
    }

    function onRunCompositionEnd() {
      if (!isRun()) return;
      if (session.stray) {
        var stray = session.stray;
        session.stray = null;
        epoch.write("editing.run:stray_composition", function () {
          stray.el.innerHTML = stray.html;
        });
        commit({ reason: "composition outside" });
        return;
      }
      session.composing = false;
      markDirtyAt(liveRange() ? liveRange().startContainer : null);
      if (protect && typeof protect.snapshot === "function") protect.snapshot();
      captureTyping();
    }

    function onRunInput(event) {
      if (!isRun() || session.composing) return;
      var type = String((event && event.inputType) || "");
      var range = liveRange();
      if (range) markDirtyAt(range.startContainer);
      if (type === "insertText" && event.data === " " && maybeShortcut()) return;
      captureTyping();
      refreshBar();
    }

    // Cmd-A inside a session selects the session, not the host.
    function selectSession() {
      var units = sessionUnits();
      if (!units.length) return false;
      var r = doc.createRange();
      r.setStart(units[0], 0);
      var last = units[units.length - 1];
      r.setEnd(last, last.childNodes.length);
      var sel = win.getSelection();
      sel.removeAllRanges();
      sel.addRange(r);
      return true;
    }

    function platform() {
      var nav = win && win.navigator ? win.navigator : null;
      var p = nav ? String(nav.platform || nav.userAgent || "") : "";
      return /Mac|iPhone|iPad/.test(p) ? "mac" : "other";
    }

    /**
     * The run session's own keys, asked before the gesture table. True when
     * the key was the session's.
     */
    function onRunKeydown(event) {
      if (!isRun()) return false;
      var mod = event.metaKey === true || event.ctrlKey === true;
      var chord = gestures.blockTypeChord({
        code: event.code,
        key: event.key,
        metaKey: event.metaKey === true,
        ctrlKey: event.ctrlKey === true,
        altKey: event.altKey === true,
        shiftKey: event.shiftKey === true,
        altGraph: typeof event.getModifierState === "function" && event.getModifierState("AltGraph") === true,
        platform: platform()
      });
      if (chord) {
        event.preventDefault();
        typeActions[chord]();
        return true;
      }
      var history = gestures.historyIntentFor({
        code: event.code,
        key: event.key,
        metaKey: event.metaKey === true,
        ctrlKey: event.ctrlKey === true,
        shiftKey: event.shiftKey === true,
        altKey: event.altKey === true,
        editing: true,
        platform: platform()
      });
      if (history) {
        event.preventDefault();
        historyStep(history);
        return true;
      }
      if (mod && !event.shiftKey && !event.altKey && (event.code === "KeyA" || String(event.key).toLowerCase() === "a")) {
        event.preventDefault();
        selectSession();
        return true;
      }
      if (event.key === "Tab" && !event.shiftKey && !mod) {
        event.preventDefault();
        focusMenuButton();
        return true;
      }
      return false;
    }

    // An arrow key that takes the caret out of the session ends it.
    function onRunKeyup(event) {
      if (!isRun()) return;
      if (!/^(Arrow|Page|Home|End)/.test(String(event.key || ""))) return;
      var range = liveRange();
      if (!range) return;
      var sel = win.getSelection();
      var focus = sel && sel.focusNode ? sel.focusNode : range.endContainer;
      if (!inSession(focus)) commit({ reason: "arrow out" });
      else refreshBar();
    }

    function onRunSelectionChange() {
      if (!isRun()) return;
      var range = liveRange();
      if (range) {
        var unit = unitOf(range.startContainer);
        if (unit) session.caretUnit = unit;
      }
      if (win && !session.barRaf && win.requestAnimationFrame) {
        session.barRaf = win.requestAnimationFrame(function () {
          if (session) session.barRaf = null;
          refreshBar();
        });
      }
    }

    // ------------------------------------------------------------------------
    // Entering edit state
    // ------------------------------------------------------------------------

    function bootCommands() {
      if (booted || !doc || typeof doc.execCommand !== "function") return false;
      booted = true;
      // The library's one page-level stylesheet says what <not-bold> means, and
      // it is otherwise only installed the first time a comment is painted. A
      // reviewer who un-bolds something before commenting on anything would
      // then get a record and no visible change, so it is asked for here, where
      // the first formatting command in this document goes through.
      if (highlights && typeof highlights.ensureStylesheet === "function") {
        try {
          highlights.ensureStylesheet();
        } catch (err) {
          // An engine without the Highlight API fails loud on paint, not here:
          // a missing rule costs the reset its rendering and nothing else.
          void err;
        }
      }
      BOOT_COMMANDS.forEach(function (row) {
        try {
          doc.execCommand(row.command, false, row.value);
        } catch (err) {
          // Not every engine implements every boot command, and none of them
          // is load-bearing on its own: styleWithCSS is a preference about the
          // markup execCommand emits, and cleanMarkup canonicalizes the output
          // either way.
          void err;
        }
      });
      return true;
    }

    /**
     * Cmd-Shift-E. Makes the block under the caret editable, that one block and
     * nothing else.
     *
     * @returns {null|Object} the session
     */
    function editBlockAtCaret() {
      var block = selection.blockFor(null);
      if (!block && selection.selectedRange()) {
        var range = selection.selectedRange();
        block = selection.blockFor(
          range.commonAncestorContainer.nodeType === 1
            ? range.commonAncestorContainer
            : range.commonAncestorContainer.parentElement
        );
      }
      return editBlock(block);
    }

    /**
     * Puts one block into edit state.
     *
     * @param {Element} block
     * @returns {null|Object} {itemId, block, before, kind}
     */
    function editBlock(block, options) {
      if (!block || markers.isInsideOverlay(block)) return null;
      if (session && (session.block === block || (isRun() && inSession(block)))) return sessionInfo();
      if (session) commit({ reason: "another block" });
      leaveEditState();

      var existing = itemFor(block) || itemFor(anchorBlockFor(block));
      var existingEl = existing ? elementFor(existing) : null;
      // A record from before free writing, or one anchored on a single list
      // item, keeps today's session and break rule.
      if (existing && (isOldShape(existing) || tagOf(existingEl) === "li")) return openLegacy(block, existing);
      if (existing && record.hasRunFields(existing) && existingEl) {
        return openRun(existingEl, {
          existing: existing,
          run: runEntriesFor(existing, existingEl),
          placement: existing[record.FIELD.PLACEMENT] || undefined,
          caretEl: (options || {}).caretEl
        });
      }
      if (!existing) {
        var holding = runRecordHolding(block);
        if (holding) {
          return openRun(holding.anchor, {
            existing: holding.item,
            run: runEntriesFor(holding.item, holding.anchor, holding.found),
            placement: holding.item[record.FIELD.PLACEMENT] || undefined,
            caretEl: (options || {}).caretEl
          });
        }
      }
      var anchorEl = existingEl || anchorBlockFor(block);
      if (!blocks.canHoldRun(anchorEl)) return openLegacy(block, existing);
      return openRun(anchorEl, { existing: existing, caretEl: (options || {}).caretEl });
    }

    /** Today's single-block session. */
    function openLegacy(block, existing) {
      bootCommands();
      var before;
      var item;

      if (existing) {
        // RE-ENTRY. `before` comes off the record, never off the page: the
        // page now says the reviewer's last committed wording, and capturing
        // it here is exactly the drift R29 forbids.
        item = existing;
        before = { text: item[record.FIELD.BEFORE], html: item[record.FIELD.BEFORE_HTML] };
      } else {
        before = capture(block);
        var editRegion = regionFor(block);
        item = record.newItem({
          kind: record.KIND.EDIT,
          state: record.STATE.DRAFT,
          before: before.text,
          before_html: before.html,
          page_origin: pageField("origin"),
          page_path: pageField("path"),
          page_title: pageField("title"),
          page_seq: pageField("seq"),
          source_hint: pageField("source_hint"),
          region: editRegion,
          context: contextFor(block, editRegion)
        });
        // The draft exists the moment edit state does, so the first keystroke
        // is not the first durable thing. It is removed again if the reviewer
        // leaves without changing anything.
        persist(item, "opened");
        remember(block, item[record.FIELD.ID]);
      }

      session = {
        mode: MODE.LEGACY,
        block: block,
        itemId: item[record.FIELD.ID],
        before: before,
        composing: false,
        // The last key seen while this block was open. onBeforeInput reads it
        // because an input event carries no modifier state and WebKit reports
        // Shift-Enter with the same inputType as a bare Enter.
        lastKey: null,
        wasNew: !existing,
        // REOPENING A COMMITTED EDIT (spec 20260922.01, requirement 6). The
        // wording as it stood when the block opened is what "changed" is
        // measured against while it is open, and whether the edit was ever
        // committed is what decides the revision at commit. Both are read HERE,
        // once: the record is a draft while the reviewer rewrites it, so its
        // state later says nothing about whether this is a first commit.
        wasCommitted: !!existing && isCommittedEdit(existing),
        // The state a rewording is withdrawn FROM, and restored TO when the
        // wording matches again: ready, or not_handled (the agent said no and
        // the reviewer is rewording it). Null for any other state, which
        // typing leaves alone.
        withdrawFrom: existing && withdrawable(existing) ? existing[record.FIELD.STATE] : null,
        opened: existing
          ? { text: existing[record.FIELD.AFTER], html: existing[record.FIELD.AFTER_HTML] }
          : before,
        startedAt: Date.now()
      };

      applyEditableAttrs(block);
      announce(ANNOUNCE.AFTER.replace("{words}", firstWords(block.textContent)));
      // The record goes on the mark. Protection is then able to answer "which
      // record is the reviewer in" for replay, instead of replay inferring it
      // from the node it last bound that record to (2C's CP2-mid ask).
      protect.mark(block, { reason: "edit", item: item[record.FIELD.ID] });
      bindBlock(block);
      drawFrame(block);
      if (typeof block.focus === "function") block.focus();
      return sessionInfo();
    }

    function pageField(name) {
      var page = defaultPage || {};
      return page[name] === undefined ? null : page[name];
    }

    function applyEditableAttrs(block) {
      epoch.write("editing.enter", function () {
        Object.keys(EDITABLE_ATTRS).forEach(function (name) {
          block.setAttribute(name, EDITABLE_ATTRS[name]);
        });
      });
    }

    function clearEditableAttrs(block) {
      epoch.write("editing.leave", function () {
        Object.keys(EDITABLE_ATTRS).forEach(function (name) {
          block.removeAttribute(name);
        });
      });
    }

    /**
     * The open block came back as a NEW element and the session has to move
     * onto it. This is the seam 2B's protection asked for: layer three restores
     * the reviewer's words into a node the repaint built, and everything this
     * file holds about the block (the input listener, the editing attributes,
     * the element-to-record memory) is attached to the node that was destroyed.
     * Without this the text on screen is right and the next keystroke goes
     * nowhere: nothing records it, and the reviewer only finds out later.
     *
     * It is NOT a commit and not a re-entry. `before` is untouched, the record
     * is untouched, and edit state stays exactly as open as it was.
     *
     * @param {Element} el the element the block came back as
     * @returns {boolean} true when the session moved
     */
    function rebind(el) {
      if (!session || !el) return false;
      if (isRun()) return rebindRun(el);
      if (session.block === el) return false; // same node, same listeners
      session.block = el;
      applyEditableAttrs(el);
      bindBlock(el);
      remember(el, session.itemId);
      positionFrame();
      return true;
    }

    /**
     * Protection rebuilt the run after a repaint: the session moves onto the
     * blocks it built, and the host (which the repaint may have replaced) is
     * made editable again.
     */
    function rebindRun(el) {
      var built = protect && typeof protect.protectedBlocks === "function" ? protect.protectedBlocks() : null;
      if (!built) {
        if (el !== session.anchor && !session.container) {
          session.anchor = el;
          session.block = el;
        }
      } else {
        session.anchor = built.anchor;
        session.block = built.anchor;
        var old = session.run;
        session.run = built.run.map(function (b, i) {
          return { el: b, fromAnchor: !!(old[i] && old[i].fromAnchor), html: null, dirty: true };
        });
      }
      var host = blocks.hostFor(session.anchor, session.placement);
      if (host !== session.host || !host.hasAttribute(markers.EDIT_HOST_ATTR)) {
        session.host = host;
        session.hostAttrs = {};
        applyHostAttrs(host);
        bindBlock(host);
      }
      markAllDirty();
      rememberSession();
      positionFrame();
      return true;
    }

    function sessionInfo() {
      if (!session) {
        return { open: false, itemId: null, blockId: null, before: null, editState: !!editState, mode: null };
      }
      var info = {
        open: true,
        mode: session.mode,
        itemId: session.itemId,
        blockId: session.block.id || null,
        before: session.before ? session.before.text : null,
        editState: false
      };
      if (isRun()) {
        var t = typeState();
        info.anchorTag = session.container ? null : tagOf(session.anchor);
        info.placement = session.placement;
        info.runTags = session.run.map(function (r) {
          return tagOf(r.el);
        });
        info.menuLabel = t.label;
        info.menuDisabled = t.other;
        info.enabledTypes = t.enabled;
        info.ceilingRatio = session.ceiling ? session.ceiling.ratio : 0;
        info.historyDepth = session.history.undo.length;
        info.redoDepth = session.history.redo.length;
      }
      return info;
    }

    // ------------------------------------------------------------------------
    // Typing
    // ------------------------------------------------------------------------

    var blockHandles = [];

    function bindBlock(block) {
      unbindBlock();
      if (isRun()) {
        blockHandles.push(listeners.on(block, "beforeinput", onRunBeforeInput, false, LISTENER_GROUP));
        blockHandles.push(listeners.on(block, "input", onRunInput, false, LISTENER_GROUP));
        blockHandles.push(listeners.on(block, "paste", onRunPaste, false, LISTENER_GROUP));
        blockHandles.push(listeners.on(block, "drop", onRunDrop, false, LISTENER_GROUP));
        blockHandles.push(listeners.on(block, "cut", onRunCut, false, LISTENER_GROUP));
        blockHandles.push(listeners.on(block, "compositionstart", onRunCompositionStart, false, LISTENER_GROUP));
        blockHandles.push(listeners.on(block, "compositionend", onRunCompositionEnd, false, LISTENER_GROUP));
        return;
      }
      // beforeinput comes FIRST because it is the only one of these that can
      // still say no. The break the reviewer typed is written by this file, not
      // by the engine: see onBeforeInput.
      blockHandles.push(listeners.on(block, "beforeinput", onBeforeInput, false, LISTENER_GROUP));
      blockHandles.push(listeners.on(block, "input", onInput, false, LISTENER_GROUP));
      blockHandles.push(listeners.on(block, "compositionstart", onCompositionStart, false, LISTENER_GROUP));
      blockHandles.push(listeners.on(block, "compositionend", onCompositionEnd, false, LISTENER_GROUP));
      // Deliberately NO blur handler. A commit is the reviewer leaving the
      // region, not the framework yanking the node: see rule 2 at the top.
    }

    function unbindBlock() {
      blockHandles.forEach(function (handle) {
        handle.off();
      });
      blockHandles = [];
    }

    function onCompositionStart() {
      if (session) session.composing = true;
    }

    function onCompositionEnd() {
      if (!session) return;
      session.composing = false;
      captureTyping();
    }

    function onInput() {
      // During IME composition the block holds half-composed text. Recording it
      // would ship it as the reviewer's exact wording, so the capture waits for
      // compositionend, which is one event away.
      if (!session || session.composing) return;
      captureTyping();
    }

    /**
     * Enter, before the engine gets it.
     *
     * THE BUG THIS EXISTS FOR. A reviewer put a paragraph into edit state, put
     * the caret mid-sentence and pressed Enter meaning "new paragraph". The
     * record said line break. Not always: only in Firefox. A <p> cannot legally
     * contain a <p>, so every engine improvises, and they improvise differently
     * (the measurements are in gestures.breakIntentFor). Left alone, which
     * break reached the agent depended on which browser the reviewer opened.
     *
     * The normalizer is not the place to paper over this. A nested block really
     * is a paragraph break and a <br> really is a line break, and the contract,
     * AGENTS.md and the Markdown writing rules all lean on that holding. What
     * was missing was upstream: the layer never said what Enter meant, so each
     * engine decided. It says so here.
     *
     * Nothing else is intercepted. Every other inputType is the engine's, the
     * way typing has always been.
     */
    function onBeforeInput(event) {
      // Mid-composition the IME owns the block, and Enter there is the IME
      // accepting a candidate rather than the reviewer asking for a break.
      if (!session || session.composing) return;
      var intent = gestures.breakIntentFor({
        inputType: event.inputType,
        // WebKit calls Shift-Enter `insertParagraph` too, so the input event
        // cannot tell the two apart on its own. The Enter keydown that produced
        // it can, and onKeydown parked it on the session one event ago.
        shiftKey: !!(session.lastKey && session.lastKey.key === "Enter" && session.lastKey.shiftKey)
      });
      if (!intent) return;
      if (typeof event.preventDefault === "function") event.preventDefault();
      if (!insertBreak(intent)) return;
      // TWO THINGS THE ENGINE'S OWN `input` EVENT WOULD HAVE DONE, AND CANNOT
      // NOW: cancelling beforeinput cancels the input event with it.
      //
      //  1. Protection's layer three snapshots the block on every input and
      //     keyup, which is what keeps its mutation observer from reading the
      //     reviewer's own typing as a repaint and restoring it away. Without
      //     this line the break goes in, the observer fires one microtask
      //     later, and layer three writes the unbroken paragraph back over it.
      //     Synchronously, and before the capture, for that ordering.
      //  2. The record is written on every keystroke (R1: every keystroke is
      //     durable). Without this the break is on the page and in no record.
      if (protect && typeof protect.snapshot === "function") protect.snapshot(session.block);
      captureTyping();
    }

    /**
     * Writes one break into the open block and leaves the caret after it.
     *
     * @param {string} intent a gestures.BREAK value
     * @returns {boolean} true when the block changed
     */
    function insertBreak(intent) {
      var shape = breakShapeFor(intent);
      if (!shape || !session || !win || !doc) return false;
      if (typeof win.getSelection !== "function" || typeof doc.createRange !== "function") return false;
      var sel = win.getSelection();
      if (!sel || sel.rangeCount === 0) return false;
      var range = sel.getRangeAt(0);
      var block = session.block;
      var inside = range.commonAncestorContainer;
      if (inside !== block && !(typeof block.contains === "function" && block.contains(inside))) return false;

      range.deleteContents();
      var caret = shape.tag === "br" ? writeLineBreak(range, block) : writeParagraphBreak(range, block, shape.tag);
      if (!caret) return false;
      sel.removeAllRanges();
      sel.addRange(caret);
      return true;
    }

    /**
     * A line break: one <br>, plus the padding <br> the engines all insist on.
     *
     * A <br> that ends a block has no line of its own to sit on, so every
     * engine writes a second one behind it and eats that second one again on
     * the next character typed. Doing the same thing here is what makes the
     * reviewer's new line visible at all, and it costs nothing in the record:
     * a trailing break normalizes away.
     */
    function writeLineBreak(range, block) {
      var br = doc.createElement("br");
      range.insertNode(br);
      if (atEndOfBlock(br, block)) {
        br.parentNode.insertBefore(doc.createElement("br"), br.nextSibling);
      }
      var caret = doc.createRange();
      caret.setStartAfter(br);
      caret.collapse(true);
      return caret;
    }

    /**
     * A paragraph break: the words from the caret to the end of the block the
     * caret is in move into a new block of their own.
     *
     * The block the caret is in, not the region: a second Enter inside a
     * paragraph this file already split has to split THAT paragraph, or every
     * break nests one level deeper than the last.
     *
     * An empty side gets a <br> for the same reason writeLineBreak does: an
     * empty block is not a line the caret can be on. It normalizes away too, so
     * an Enter with nothing typed after it is still not a change to the
     * document.
     */
    function writeParagraphBreak(range, block, tag) {
      var container = nearestBlockIn(range.startContainer, block);
      var tail = doc.createElement(tag);
      var rest = doc.createRange();
      rest.setStart(range.startContainer, range.startOffset);
      rest.setEnd(container, container.childNodes.length);
      tail.appendChild(rest.extractContents());
      if (!hasAnyContent(tail)) tail.appendChild(doc.createElement("br"));
      if (!hasAnyContent(container)) container.appendChild(doc.createElement("br"));
      if (container === block) block.appendChild(tail);
      else container.parentNode.insertBefore(tail, container.nextSibling);
      var caret = doc.createRange();
      caret.setStart(tail, 0);
      caret.collapse(true);
      return caret;
    }

    // The nearest block-level element the node sits in, stopping at the region.
    // The tag vocabulary is the normalizer's, because the normalizer is what
    // reads the result back as a paragraph break (D9's one normalizer).
    function nearestBlockIn(node, region) {
      var el = node && node.nodeType === 1 ? node : node ? node.parentNode : null;
      while (el && el !== region) {
        var tag = typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
        if (Object.prototype.hasOwnProperty.call(normalize.BLOCK_TAGS, tag)) return el;
        el = el.parentNode;
      }
      return region;
    }

    // Is there anything after this node, anywhere up to the region's edge?
    // An empty text node is not anything: inserting into the middle of a text
    // node splits it and leaves one behind.
    function atEndOfBlock(node, block) {
      var walk = node;
      while (walk && walk !== block) {
        for (var sib = walk.nextSibling; sib; sib = sib.nextSibling) {
          if (isContentNode(sib)) return false;
        }
        walk = walk.parentNode;
      }
      return true;
    }

    function hasAnyContent(el) {
      for (var child = el.firstChild; child; child = child.nextSibling) {
        if (isContentNode(child)) return true;
      }
      return false;
    }

    function isContentNode(node) {
      if (!node) return false;
      if (node.nodeType === 3 || node.nodeType === 4) return String(node.nodeValue || "") !== "";
      return node.nodeType === 1;
    }

    // Every keystroke, synchronously, before anything else. The revision does
    // NOT move here: a revision is a committed wording.
    //
    // TYPING INTO A READY EDIT TAKES IT BACK OFF THE AGENT'S DESK, the way a
    // comment being reworded does (comments.js type()). The first keystroke that
    // changes the wording makes it a draft, which is not in review.json (R7);
    // typing it back to the committed wording makes it ready again. Before this
    // the record stayed ready, so every keystroke posted item.ready and the
    // agent could read half-typed text as an instruction. A handled edit is
    // never reopened here (itemFor skips it).
    //
    // A NOT_HANDLED EDIT IS REWORDED THE SAME WAY. It used to keep its state,
    // so every pause posted it within the debounce and the helper rewrote
    // review.json with the half-typed words each time (code review finding 5,
    // spec 20260922.01). Now it withdraws to draft on the first changing
    // keystroke, obeys the draft floor after that, and goes back to
    // not_handled, same revision, reply kept, when the wording matches again.
    function captureTyping() {
      if (!session) return null;
      if (isRun()) return captureRunTyping();
      var after = capture(session.block);
      var item = store.readItem(requireReview(), session.itemId);
      if (!item) return null;
      // Read BEFORE this keystroke's state is decided: this is the one
      // keystroke that can be the withdrawal, and the record after the
      // assignment below always reads draft or ready, never which it just
      // came from.
      var wasOutstandingBeforeThisKeystroke = withdrawable(item);
      var next = Object.assign({}, item);
      next[record.FIELD.AFTER] = after.text;
      next[record.FIELD.AFTER_HTML] = after.html;
      next[record.FIELD.UPDATED_AT] = record.nowIso();
      if (session.withdrawFrom) {
        next[record.FIELD.STATE] = kindFor(session.opened, after).changed ? record.STATE.DRAFT : session.withdrawFrom;
      }
      // An item this page did not just create is content on a record the helper
      // already holds, whatever state it is in (sync.js eventTypeFor).
      var postOptions = session.wasNew ? null : { existing: true };
      if (wasOutstandingBeforeThisKeystroke && next[record.FIELD.STATE] === record.STATE.DRAFT) {
        // This is the keystroke that just took the edit off ready (or off
        // not_handled). Tell sync so it posts at once instead of waiting
        // behind a floor left by an earlier draft (review finding, spec
        // 20260922.01 requirement 6): the agent should stop seeing the old
        // wording the moment the reviewer starts changing it.
        postOptions = Object.assign({}, postOptions || {}, { withdrawnFromReady: true });
      }
      persist(next, "typed", null, postOptions);
      positionFrame();
      return next;
    }

    // The run session's keystroke: the whole sitting into the record, every
    // time, with only the dirty blocks rebuilt (see captureRunFields).
    function captureRunTyping() {
      var fields = captureRunFields();
      session.ceiling = ceilingState(fields);
      var item = store.readItem(requireReview(), session.itemId);
      if (!item) return null;
      var wasOutstandingBeforeThisKeystroke = withdrawable(item);
      var next = Object.assign({}, item);
      if (runShaped(fields)) {
        applyRunFields(next, fields, null);
      } else {
        var plain = capture(session.anchor);
        next[record.FIELD.AFTER] = plain.text;
        next[record.FIELD.AFTER_HTML] = plain.html;
      }
      next[record.FIELD.UPDATED_AT] = record.nowIso();
      if (session.withdrawFrom) {
        next[record.FIELD.STATE] = runKey(fields) !== session.openedKey ? record.STATE.DRAFT : session.withdrawFrom;
      }
      var postOptions = session.wasNew ? null : { existing: true };
      if (wasOutstandingBeforeThisKeystroke && next[record.FIELD.STATE] === record.STATE.DRAFT) {
        postOptions = Object.assign({}, postOptions || {}, { withdrawnFromReady: true });
      }
      persist(next, "typed", null, postOptions);
      positionFrame();
      return next;
    }

    // The states a rewording takes an edit out of: the ones in front of
    // someone. Handled is not here: a handled edit is never reopened by typing.
    function withdrawable(item) {
      var state = item[record.FIELD.STATE];
      return state === record.STATE.READY || state === record.STATE.NOT_HANDLED;
    }

    // Was this edit ever committed? Not "is it a draft right now": a committed
    // edit the reviewer is rewriting is a draft until they commit again, and
    // its history is what still says it was committed before.
    function isCommittedEdit(item) {
      if (!record.isDraft(item)) return true;
      var history = item[record.FIELD.AFTER_HISTORY];
      return Array.isArray(history) && history.length > 0;
    }

    /**
     * A committed edit left withdrawn by a page that died mid-rewording.
     *
     * Typing into a committed edit makes it a draft until the reviewer commits,
     * and leaving the page commits it (commitOnUnload, navigation). A crash or
     * a killed tab does neither, so the record stays a draft: off the page,
     * because replay applies only outstanding records, and out of review.json,
     * because drafts are withheld. The words are all in browser storage (R1),
     * so the page that next holds the review commits them, exactly as leaving
     * would have: a new revision, ready, carrying what the reviewer typed.
     *
     * Boot calls this once the window holds the review, so a read-only window
     * never writes. The edit open in this page right now is left alone.
     *
     * @returns {Object[]} the records it committed
     */
    function recoverWithdrawn() {
      if (!reviewId) return [];
      var out = [];
      store.read(requireReview()).forEach(function (item) {
        var kind = item[record.FIELD.KIND];
        if (kind !== record.KIND.EDIT && kind !== record.KIND.FORMAT_ONLY) return;
        if (!record.isDraft(item) || !isCommittedEdit(item)) return;
        if (session && session.itemId === item[record.FIELD.ID]) return;
        var before = { text: item[record.FIELD.BEFORE], html: item[record.FIELD.BEFORE_HTML] };
        var after = { text: item[record.FIELD.AFTER], html: item[record.FIELD.AFTER_HTML] };
        var verdict = kindFor(before, after);
        var committed = record.bumpRev(item, {
          kind: verdict.changed ? verdict.kind : kind,
          change: verdict.changed
            ? record.editChangeText(verdict.kind, before.text, after.text, before.html, after.html)
            : item[record.FIELD.CHANGE],
          after: after.text,
          after_html: after.html,
          state: record.STATE.READY
        });
        record.validateItem(committed);
        persist(committed, "committed", "ready");
        out.push(committed);
      });
      return out;
    }

    // ------------------------------------------------------------------------
    // Committing
    // ------------------------------------------------------------------------

    /**
     * Commits the open edit. Idempotent by construction: the session is cleared
     * before anything else happens, so a second call, a blur fired by removing
     * contenteditable, or a stray Escape does nothing.
     *
     * @param {{reason?: string}} [options]
     * @returns {null|Object} the committed record, or null when nothing was open
     */
    function commit(options) {
      if (!session) return null;
      if (isRun()) return commitRun(options);
      var open = session;
      // FIRST. Removing contenteditable below fires blur, and anything that
      // reads edit state from here on must see it closed.
      session = null;
      var reason = (options || {}).reason || "commit";
      // On the unload path the event is QUEUED and nothing else: the transport
      // at unload is the keepalive post, and onUnload makes it one line below.
      // Asking for an immediate flush here instead would schedule an ordinary
      // fetch that races the document's teardown, which is the one transport
      // protocol.js says not to rely on, and it would hide the body cap by
      // sometimes beating it.
      var immediate = reason === "navigation" ? null : "ready";

      var block = open.block;
      var after = capture(block);

      unbindBlock();
      clearEditableAttrs(block);
      hideFrame();

      // WHY PROTECTION LIFTS LAST, and not here.
      //
      // protect.release runs the commit pass, synchronously and immediately.
      // Releasing before the record is written means that pass reads a DRAFT,
      // and a draft is not outstanding, so replay skips the one record the pass
      // exists for: the reviewer's commit is not compared against the page at
      // all, and a change the page made to the block underneath them is
      // swallowed exactly as if the seam were not wired. Found at CP2-mid, with
      // real records; every earlier test drove protection and replay directly
      // and could not see it. So: write the record, THEN lift protection.
      var item = store.readItem(requireReview(), open.itemId);
      if (!item) {
        protect.release(block);
        return null;
      }

      var verdict = kindFor(open.before, after);
      // A committed edit reopened and left with its wording as it was when it
      // opened is not a rewording: nothing to commit, and the revision stays.
      // This used to bump the revision on every reopen, typed into or not.
      if (!open.wasNew && !kindFor(open.opened, after).changed) {
        protect.release(block);
        return null;
      }
      if (!verdict.changed && open.wasCommitted) {
        // Reworded back to the page's own original words. That is not an edit
        // against the page, and it has always been left as captured rather
        // than committed; the one thing new is that the typing withdrew it, so
        // it goes back to the state it opened in (ready, or not_handled with
        // the agent's reason still on it) rather than stranding a draft
        // nobody will see.
        if (open.withdrawFrom && record.isDraft(item)) {
          var restored = Object.assign({}, item);
          restored[record.FIELD.STATE] = open.withdrawFrom;
          restored[record.FIELD.UPDATED_AT] = record.nowIso();
          persist(restored, "typed", null, { existing: true });
        }
        protect.release(block);
        return null;
      }
      if (!verdict.changed) {
        // The reviewer opened a block, read it, and left. That is not an edit.
        // A draft record for it is a row in the rail and a line in the agent's
        // queue for a change that does not exist.
        if (open.wasNew) {
          store.remove(requireReview(), open.itemId);
          forget(open.itemId);
          emit(item, "discarded");
        }
        protect.release(block);
        return null;
      }

      // The reviewer's change, stated for the intent channel (D12). An edit
      // carries no typed note, so without this its only intent field is empty
      // and the agent is left reading the data-class `after`/`before`. `before`
      // is pinned at first touch, so this states the change against the page's
      // original wording, whichever session committed it.
      // The markup goes in beside the text: bold and italic the reviewer changed
      // live only in the two html fields, and a change sentence built from the
      // text alone tells the agent nothing about them (2026-09-11, the edit
      // whose italics and bold were applied as plain words and replied handled).
      var changeText = record.editChangeText(
        verdict.kind,
        open.before ? open.before.text : null,
        after.text,
        open.before ? open.before.html : null,
        after.html
      );

      var committed;
      // WHETHER IT WAS EVER COMMITTED, read when the block opened, never whether
      // the record is a draft now: a committed edit being rewritten is a draft
      // until this line, and reading its state here would commit the rewording
      // at the old revision, where a reply to the old wording would still land.
      if (!open.wasCommitted) {
        // First commit. The revision stays at one; the history gets its first
        // entry, which is what replay's branch three reads.
        committed = Object.assign({}, item);
        committed[record.FIELD.KIND] = verdict.kind;
        committed[record.FIELD.STATE] = record.STATE.READY;
        committed[record.FIELD.CHANGE] = changeText;
        committed[record.FIELD.AFTER] = after.text;
        committed[record.FIELD.AFTER_HTML] = after.html;
        committed[record.FIELD.UPDATED_AT] = record.nowIso();
        committed[record.FIELD.AFTER_HISTORY] = appendHistory(item, committed);
        record.validateItem(committed);
        persist(committed, "committed", immediate);
      } else {
        // A rewording of something already committed. The revision moves
        // exactly once, here, which is what makes a stale reply naming the old
        // revision refusable (R21).
        committed = record.bumpRev(item, {
          kind: verdict.kind,
          change: changeText,
          after: after.text,
          after_html: after.html,
          state: record.STATE.READY
        });
        record.validateItem(committed);
        persist(committed, "committed", immediate);
      }

      remember(block, committed[record.FIELD.ID]);
      // Protection lifts on the committed record, and lifting it runs the
      // commit pass: a change the page tried to make to this block while it was
      // protected surfaces through replay's neither-matches branch rather than
      // being silently swallowed. 2B calls it, 2C owns that seam, and it is the
      // only pass this commit schedules.
      protect.release(block);
      return committed;
    }

    /**
     * Commits a run session. The same rules as commit() above, over the
     * whole sitting: the anchor's change, its new tag, and the run.
     */
    function commitRun(options) {
      var open = session;
      var reason = (options || {}).reason || "commit";
      var immediate = reason === "navigation" ? null : "ready";
      var fields = captureRunFields();
      var shaped = runShaped(fields);
      var changedSinceOpen = runKey(fields) !== open.openedKey;
      closeBurst();
      session = null;
      if (open.barRaf && win && win.cancelAnimationFrame) win.cancelAnimationFrame(open.barRaf);

      unbindBlock();
      // Nothing the layer added stays on the page without words: an empty new
      // block, and an empty item in a list, go at commit exactly as they never
      // reached the record.
      epoch.write("editing.run:tidy", function () {
        open.run.forEach(function (r) {
          if (!r.el.parentNode) return;
          if (LIST_TAGS[tagOf(r.el)]) {
            unitsOf(r.el).forEach(function (li) {
              if (tagOf(li) === "li" && isEmptyUnit(li)) li.parentNode.removeChild(li);
            });
          }
          if (r.html === null || isEmptyUnit(r.el)) r.el.parentNode.removeChild(r.el);
        });
      });
      clearHostAttrs(open);
      hideFrame();
      hidePlaceholder();

      var item = store.readItem(requireReview(), open.itemId);
      if (!item) {
        protect.release(open.anchor);
        return null;
      }
      var verdict;
      var plain = null;
      if (shaped) verdict = runVerdictFor(fields, open.before);
      else {
        plain = capture(open.anchor);
        verdict = kindFor(open.before, plain);
      }
      if (!open.wasNew && !changedSinceOpen) {
        protect.release(open.anchor);
        return null;
      }
      if (!verdict.changed && open.wasCommitted) {
        if (open.withdrawFrom && record.isDraft(item)) {
          var restored = Object.assign({}, item);
          restored[record.FIELD.STATE] = open.withdrawFrom;
          restored[record.FIELD.UPDATED_AT] = record.nowIso();
          persist(restored, "typed", null, { existing: true });
        }
        protect.release(open.anchor);
        return null;
      }
      if (!verdict.changed) {
        if (open.wasNew) {
          store.remove(requireReview(), open.itemId);
          forget(open.itemId);
          emit(item, "discarded");
        }
        protect.release(open.anchor);
        return null;
      }

      var changes;
      if (shaped) {
        var candidate = applyRunFields(Object.assign({}, item), fields, verdict);
        changes = {
          kind: verdict.kind,
          change: record.runChangeText(candidate),
          after: fields.after,
          after_html: fields.after_html,
          anchor_after_html: fields.anchor_after_html,
          anchor_tag_after: fields.anchor_tag_after,
          new_blocks: fields.new_blocks,
          placement: fields.placement,
          state: record.STATE.READY
        };
      } else {
        changes = {
          kind: verdict.kind,
          change: record.editChangeText(verdict.kind, open.before.text, plain.text, open.before.html, plain.html),
          after: plain.text,
          after_html: plain.html,
          state: record.STATE.READY
        };
      }
      var committed;
      if (!open.wasCommitted) {
        committed = Object.assign({}, item, changes);
        committed[record.FIELD.UPDATED_AT] = record.nowIso();
        committed[record.FIELD.AFTER_HISTORY] = appendHistory(item, committed);
      } else {
        committed = record.bumpRev(item, changes);
      }
      record.validateItem(committed);
      persist(committed, "committed", immediate);
      remember(open.anchor, committed[record.FIELD.ID]);
      open.run.forEach(function (r) {
        if (r.el.parentNode) rememberAlso(r.el, committed[record.FIELD.ID]);
      });
      announce(ANNOUNCE.COMMIT);
      protect.release(open.anchor);
      return committed;
    }

    function runVerdictFor(fields, before) {
      return runVerdict(fields, before || { text: "", html: "" });
    }

    function appendHistory(item, committed) {
      var history = (item[record.FIELD.AFTER_HISTORY] || []).slice();
      var last = history.length ? history[history.length - 1] : null;
      var value = committed[record.FIELD.AFTER];
      if (typeof value === "string" && (!last || last.after !== value)) {
        history.push(
          record.historyEntry(
            committed[record.FIELD.REV],
            value,
            committed[record.FIELD.AFTER_HTML],
            committed[record.FIELD.UPDATED_AT],
            committed
          )
        );
      }
      return history;
    }

    // ------------------------------------------------------------------------
    // Deleting a block (R27)
    // ------------------------------------------------------------------------

    /**
     * Deletes a block as its own record kind, so it reads as a deletion rather
     * than as an edit to nothing.
     *
     * @param {Element} block
     * @returns {null|Object} the record
     */
    function deleteBlock(block) {
      if (!block && isRun()) {
        // In a run session, Delete block takes the caret's run block out of
        // the run. On the anchor it is today's delete, and only while the run
        // is empty: a deleted anchor has nowhere for the run to go.
        var range = liveRange();
        var unit = range ? unitOf(range.startContainer) : session.caretUnit;
        var target = unit ? blockOf(unit) : null;
        if (target && target !== session.anchor) {
          pushHistory();
          var prev = sessionBlocks()[sessionBlocks().indexOf(target) - 1];
          structural("delete_block", function () {
            removeRunBlock(target);
          });
          var last = prev ? textNodes(prev).pop() : null;
          if (last) setCaret(last, last.nodeValue.length);
          else if (prev) setCaret(prev, 0);
          return null;
        }
        if (session.run.length || session.container) return null;
        var anchorEl = session.anchor;
        var openRunSession = session;
        session = null;
        closeBurstOf(openRunSession);
        unbindBlock();
        clearHostAttrs(openRunSession);
        protect.release(anchorEl);
        hideFrame();
        var own = store.readItem(requireReview(), openRunSession.itemId);
        if (openRunSession.wasNew && own && record.isDraft(own)) {
          store.remove(requireReview(), openRunSession.itemId);
          forget(openRunSession.itemId);
        }
        return deleteBlock(anchorEl);
      }
      var el = block || (session ? session.block : null);
      if (!el || !el.parentNode) return null;

      var existing = itemFor(el);
      var before = existing
        ? { text: existing[record.FIELD.BEFORE], html: existing[record.FIELD.BEFORE_HTML] }
        : capture(el);

      if (session && session.block === el) {
        // Leaving edit state without committing an edit record: the deletion IS
        // the record.
        var open = session;
        session = null;
        unbindBlock();
        clearEditableAttrs(el);
        protect.release(el);
        hideFrame();
        if (open.wasNew && existing && record.isDraft(existing)) {
          store.remove(requireReview(), open.itemId);
          forget(open.itemId);
          existing = null;
        }
      }

      // A deletion is a change with no typed note, so it carries the same
      // stated intent field an edit does (D12).
      var deleteChange = record.editChangeText(record.KIND.DELETE, before.text, null);

      var item;
      if (existing) {
        item = record.bumpRev(existing, {
          kind: record.KIND.DELETE,
          change: deleteChange,
          after: null,
          after_html: null,
          state: record.STATE.READY
        });
      } else {
        var deleteRegion = regionFor(el);
        item = record.newItem({
          kind: record.KIND.DELETE,
          state: record.STATE.READY,
          change: deleteChange,
          before: before.text,
          before_html: before.html,
          page_origin: pageField("origin"),
          page_path: pageField("path"),
          page_title: pageField("title"),
          page_seq: pageField("seq"),
          source_hint: pageField("source_hint"),
          region: deleteRegion,
          context: contextFor(el, deleteRegion)
        });
      }

      // Where it was, so undo puts it back where it came from. The node itself
      // is kept as well as its markup: re-inserting the same node is the only
      // version that survives a page whose CSS keys off element identity.
      deleted[item[record.FIELD.ID]] = {
        node: el,
        parent: el.parentNode,
        next: el.nextSibling,
        html: before.html,
        tag: el.tagName
      };

      epoch.write("editing.delete", function () {
        el.parentNode.removeChild(el);
      });

      record.validateItem(item);
      persist(item, "deleted", "ready");
      scheduleReplay("commit");
      return item;
    }

    // ------------------------------------------------------------------------
    // Formatting (R24, R31)
    // ------------------------------------------------------------------------

    /**
     * Applies one formatting command inside a write epoch. The wrapper is not
     * optional: execCommand mutates the DOM, and an unwrapped mutation
     * schedules a replay pass that then sees its own change.
     *
     * THE BUG THIS WAS REWORKED FOR. A reviewer selected a phrase that is bold
     * through the page's own stylesheet and pressed B. Every engine wrote
     * <span style="font-weight: normal">, cleanMarkup dropped the style
     * attribute on the way into the record, the leftover bare span is not a
     * structural difference, and the commit compared equal to its own before.
     * The page changed under the reviewer's cursor and no row appeared in the
     * rail (Ken, 2026-08-23). Widening the comparison to keep the style
     * attribute is not available: replay would then write one back onto the
     * reviewer's page, which is what R35 exists to prevent.
     *
     * So the layer says which way the button is going and writes the markup
     * itself, exactly as it now does for Enter. What the engine is still
     * trusted with is the tag surgery it was chosen for: splitting a selection
     * that starts inside a <strong> and ends outside it.
     *
     * @param {string} command one of COMMANDS
     * @returns {Object} {command, applied, intent}
     */
    function format(command, value) {
      if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
        throw new Error("editing.format: " + String(command) + " is not one of the commands R24 allows");
      }
      if (!doc || typeof doc.execCommand !== "function") {
        return { command: command, applied: false, reason: "no execCommand in this environment" };
      }
      bootCommands();
      // Read BEFORE anything moves: after the command has run, "is it bold" is
      // a question about the result rather than about what the reviewer meant.
      var intent = gestures.formatIntentFor({ command: command, active: commandActive(command) });
      var applied = epoch.write("editing.format:" + command, function () {
        if (intent === gestures.FORMAT.REMOVE) return removeFormat(command, value);
        return applyFormat(command, value);
      });
      // A formatting change is a change, so it is captured the same way a
      // keystroke is: the record's markup moves, its text does not, and the
      // commit reads that as kind format_only.
      if (isRun()) {
        markAllDirty();
        if (protect && typeof protect.snapshot === "function") protect.snapshot();
      }
      captureTyping();
      return { command: command, applied: applied === true, intent: intent };
    }

    /**
     * Does the selection already carry this format?
     *
     * queryCommandState answers off the COMPUTED style, so it says yes for text
     * that is bold through a <strong> and for text that is bold through a rule
     * in the page's stylesheet. That is the right question: the reviewer is
     * looking at the words, not at the markup. Measured true in all three
     * engines for both, on 2026-08-23.
     */
    // The block a formatting command acts in: the open block, or in a run
    // session the unit the caret is in.
    function formatScope() {
      if (!session) return null;
      if (!isRun()) return session.block;
      var range = liveRange();
      return (range && unitOf(range.startContainer)) || session.caretUnit || session.anchor;
    }

    function commandActive(command) {
      if (!doc || typeof doc.queryCommandState !== "function") return false;
      try {
        return doc.queryCommandState(command) === true;
      } catch (err) {
        // Some engines throw rather than answer when there is no selection to
        // ask about. No selection is not "already formatted".
        return false;
      }
    }

    /**
     * Bold, on words that are not bold yet.
     *
     * A reset the reviewer put there earlier is them having said these words
     * are NOT bold. Asking for bold again is them taking that back, and taking
     * it back is the whole change: the words go straight back to inheriting
     * whatever the page says, and the markup returns to what it was before the
     * un-bold. So bold, un-bold, bold leaves no record, which is right, because
     * nothing about the document is different.
     *
     * Only when there is no marker to take back does the engine get the job.
     * It is still the right tool for it: a selection that starts inside a
     * <strong> and ends outside it is the case this file kept execCommand for.
     *
     * @returns {boolean} true when the block changed
     */
    function applyFormat(command, value) {
      if (unwrapResets(command)) return true;
      return doc.execCommand(command, false, value === undefined ? null : value) === true;
    }

    /**
     * Removes every reset marker for this command that the selection touches.
     *
     * @returns {boolean} true when one was there
     */
    function unwrapResets(command) {
      var tag = formatShapeFor(command, gestures.FORMAT.REMOVE);
      var block = formatScope();
      if (!tag || !block || typeof block.querySelectorAll !== "function") return false;
      var range = selectionRange(block);
      if (!range) return false;
      var found = block.querySelectorAll(tag);
      var changed = false;
      for (var i = found.length - 1; i >= 0; i -= 1) {
        if (!coversContents(range, found[i])) continue;
        if (unwrap(found[i])) changed = true;
      }
      return changed;
    }

    /**
     * Does the selection cover ALL of this element's words?
     *
     * All of them, deliberately. Taking the marker out is taking back a
     * statement about the whole run, so it is only the right answer when the
     * reviewer selected the whole run. A selection of half a marked phrase
     * falls through to the engine instead, which nests the emphasis inside the
     * marker, and that reads correctly both ways: the marked run is still not
     * bold, and the half inside it now is.
     */
    function coversContents(range, el) {
      if (typeof range.compareBoundaryPoints !== "function") return false;
      var contents = doc.createRange();
      contents.selectNodeContents(el);
      // Down to the same kind of boundary a selection has, which is a position
      // inside a text node. selectNodeContents leaves the boundary on the
      // element, and "before the first child" sorts BEFORE "at character 0 of
      // that child", so an untouched comparison reports a selection of exactly
      // these words as not covering them.
      var first = edgeNode(el, "firstChild");
      var last = edgeNode(el, "lastChild");
      if (first) contents.setStart(first, 0);
      if (last) contents.setEnd(last, endOffsetOf(last));
      try {
        return (
          range.compareBoundaryPoints(range.START_TO_START, contents) <= 0 &&
          range.compareBoundaryPoints(range.END_TO_END, contents) >= 0
        );
      } catch (err) {
        // Two ranges in different documents cannot be compared. Neither can be
        // this one and a marker in the block the session is open on.
        return false;
      }
    }

    // The deepest first or last descendant, so a boundary can be put where a
    // selection would put one.
    function edgeNode(el, which) {
      var node = el;
      while (node && node[which]) node = node[which];
      return node === el ? null : node;
    }

    function endOffsetOf(node) {
      if (node.nodeType === 3 || node.nodeType === 4) return String(node.nodeValue || "").length;
      return node.childNodes ? node.childNodes.length : 0;
    }

    // The reviewer's selection, when it is inside the block. Null otherwise:
    // a command with nothing selected has nothing to act on.
    function selectionRange(block) {
      if (!win || typeof win.getSelection !== "function") return null;
      var sel = win.getSelection();
      if (!sel || sel.rangeCount === 0) return null;
      var range = sel.getRangeAt(0);
      var inside = range.commonAncestorContainer;
      if (inside !== block && !(typeof block.contains === "function" && block.contains(inside))) return null;
      return range;
    }

    /**
     * Bold, on words that already look bold. Whatever the engine reached for,
     * the page and the record get this tool's one spelling.
     *
     * Two things have to be true when this returns, and the engines leave
     * neither of them true on their own:
     *
     *  1. No style attribute is on the reviewed element (R35). Chromium,
     *     Firefox and WebKit all write one here, because HTML has no tag that
     *     means "not bold".
     *  2. Something in the markup SAYS the words are not bold, or the commit
     *     compares equal to its own before and the reviewer's change is thrown
     *     away. Firefox writes nothing at all when it is italic that has to
     *     come off text a stylesheet made italic, so the marker is the only
     *     thing that records that gesture at all.
     *
     * @returns {boolean} true when the block changed
     */
    function removeFormat(command, value) {
      // Whose style attribute is whose. A page author may already have written
      // one of these on their own markup, and this tool does not rewrite markup
      // nobody touched; taking the list first is what tells the engine's new
      // ones from theirs, exactly rather than by guessing.
      var authors = resetStyled(command);
      var ran = doc.execCommand(command, false, value === undefined ? null : value) === true;
      var converted = convertResets(command, authors);
      if (converted) return true;
      // Nothing to convert: either the engine took a tag off (a real change the
      // structural comparison can already see) or it did nothing. Either way,
      // if the words STILL look bold, the page's stylesheet is what is doing it
      // and only the marker can say otherwise.
      if (!commandActive(command)) return ran;
      return wrapSelection(command) || ran;
    }

    /**
     * The engine's <span style="font-weight: normal"> becomes <not-bold>.
     *
     * The declaration is read off the element and then removed, so the page
     * never keeps a style attribute this tool's command caused. A span that
     * said nothing else is replaced outright; one that carries a class of the
     * page author's own keeps its tag inside the marker, because nothing here
     * is allowed to throw away the page's markup.
     *
     * @returns {number} how many elements were converted
     */
    function convertResets(command, skip) {
      var tag = formatShapeFor(command, gestures.FORMAT.REMOVE);
      var block = formatScope();
      if (!tag) return 0;
      var styled = resetStyled(command);
      var property = command === COMMANDS.bold ? "font-weight" : "font-style";
      var converted = 0;
      var last = null;
      for (var i = 0; i < styled.length; i += 1) {
        var el = styled[i];
        if (skip && skip.indexOf(el) !== -1) continue;
        el.style.removeProperty(property);
        if (!String(el.getAttribute("style") || "").trim()) el.removeAttribute("style");
        var marker = doc.createElement(tag);
        el.parentNode.insertBefore(marker, el);
        if (el.tagName.toLowerCase() === "span" && el.attributes.length === 0) {
          while (el.firstChild) marker.appendChild(el.firstChild);
          el.parentNode.removeChild(el);
        } else {
          marker.appendChild(el);
        }
        converted += 1;
        last = marker;
      }
      // Moving nodes leaves the selection where the engine put it in some
      // engines and collapses it in others. The words the reviewer just changed
      // are what they expect to still be selected.
      if (last) selectContents(last);
      return converted;
    }

    // Every element in the block whose own style attribute says this format is
    // off, in document order.
    function resetStyled(command) {
      var block = formatScope();
      if (!block || typeof block.querySelectorAll !== "function") return [];
      var styled = block.querySelectorAll("[style]");
      var out = [];
      for (var i = 0; i < styled.length; i += 1) {
        if (declaresReset(styled[i], command)) out.push(styled[i]);
      }
      return out;
    }

    // Does this element's own style attribute say the format is off?
    function declaresReset(el, command) {
      if (!el || !el.style) return false;
      if (command === COMMANDS.bold) return normalize.isNotBoldWeight(el.style.fontWeight);
      return normalize.isNotItalicStyle(el.style.fontStyle);
    }

    /**
     * Wraps the selection in the reset tag. The last resort, and the only thing
     * that records the gesture when the engine declined to do anything.
     *
     * extractContents rather than surroundContents: a selection that starts
     * inside an <em> and ends outside it is not surroundable, and it is exactly
     * the selection execCommand was kept for. It is the same technique the
     * paragraph break above uses.
     *
     * @returns {boolean} true when the block changed
     */
    function wrapSelection(command) {
      var tag = formatShapeFor(command, gestures.FORMAT.REMOVE);
      var block = formatScope();
      if (!tag || !block || !doc) return false;
      var range = selectionRange(block);
      if (!range || range.collapsed) return false;
      // Already marked, by a conversion a moment ago or by an earlier gesture.
      // A second marker around the first would change nothing and read as
      // noise in the markup the agent is handed.
      if (closestTag(range.commonAncestorContainer, tag, block)) return false;
      var marker = doc.createElement(tag);
      marker.appendChild(range.extractContents());
      range.insertNode(marker);
      selectContents(marker);
      return true;
    }

    // The nearest ancestor with this tag name, stopping at the region's edge.
    function closestTag(node, tag, block) {
      var el = node && node.nodeType === 1 ? node : node ? node.parentNode : null;
      while (el) {
        if (typeof el.tagName === "string" && el.tagName.toLowerCase() === tag) return el;
        if (el === block) return null;
        el = el.parentNode;
      }
      return null;
    }

    // The element's children take its place. Returns false when there was
    // nothing to unwrap.
    function unwrap(el) {
      if (!el || !el.parentNode) return false;
      var parent = el.parentNode;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
      if (typeof parent.normalize === "function") parent.normalize();
      return true;
    }

    function selectContents(el) {
      if (!win || !doc || typeof win.getSelection !== "function") return false;
      var sel = win.getSelection();
      if (!sel) return false;
      var range = doc.createRange();
      range.selectNodeContents(el);
      sel.removeAllRanges();
      sel.addRange(range);
      return true;
    }

    // ------------------------------------------------------------------------
    // Per-record undo (R28)
    // ------------------------------------------------------------------------

    /**
     * Reverts ONE record's region to its `before` and retires the record.
     * Touches nothing else: not the page outside that region, and not any other
     * record.
     *
     * @param {string} itemId
     * @returns {{reverted: boolean, kind: (string|null), reason: (string|null)}}
     */
    function undo(itemId) {
      var item = store.readItem(requireReview(), itemId);
      if (!item) return { reverted: false, kind: null, reason: "no record " + String(itemId) };

      // Dropping the record is only right when nothing landed in the source.
      // Asked BEFORE the page moves, so a refusal never leaves the reviewer
      // looking at a page that disagrees with every store in the system.
      var drops = lifecycle.canDelete(item[record.FIELD.STATE], lifecycle.ACTOR.REVIEWER);
      if (!drops && record.takenBackIds(store.read(requireReview()))[itemId]) {
        // Undone once already. A second revert record would ask the agent to
        // remove a change that is already on its way out of the file.
        return { reverted: false, kind: item[record.FIELD.KIND], reason: UNDO_ALREADY_TAKEN_BACK, revert: null };
      }

      if (session && session.itemId === itemId) {
        // Undoing the record the reviewer is inside. Edit state goes first, and
        // it goes without committing: the undo is the decision.
        dropSession();
      }

      var kind = item[record.FIELD.KIND];
      var restored;

      if (kind === record.KIND.DELETE) {
        restored = restoreDeleted(item);
      } else {
        restored = restoreRegion(item);
      }
      if (!restored.element) {
        // Fail loud rather than retiring a record whose region was never put
        // back: a silent success here means the reviewer's page and the agent's
        // instructions disagree and nothing says so.
        return { reverted: false, kind: kind, reason: restored.reason };
      }

      if (!drops) {
        // The handled record stays: it is the record that a fix landed, and it
        // is the only place the applied wording is written down. What the undo
        // adds is the work of taking that wording back out of the source.
        var region = regionFor(restored.element);
        var revert = record.revertOf(item, { region: region, context: contextFor(restored.element, region) });
        forget(itemId);
        delete deleted[itemId];
        // The block's live record is the revert now: a reviewer who edits this
        // block again is rewording the take-back, not reopening the history.
        remember(restored.element, revert[record.FIELD.ID]);
        // "ready" flushes immediately, the same as a committed edit: the agent
        // is being asked to change a file, and a debounce would sit on it.
        persist(revert, "reverted", "ready");
        selection.placeCaretAtStart(restored.element);
        scheduleReplay("undo");
        return { reverted: true, kind: kind, reason: null, revert: revert[record.FIELD.ID] };
      }

      store.remove(requireReview(), itemId);
      unpersist(item);
      forget(itemId);
      delete deleted[itemId];
      selection.placeCaretAtStart(restored.element);
      emit(item, "undone");
      scheduleReplay("undo");
      return { reverted: true, kind: kind, reason: null, revert: null };
    }

    /**
     * Drop ONE record and leave the page exactly as it is.
     *
     * The seam undo ends with, minus the write. It exists for one caller: the
     * conflict card's "take the page's", where the reviewer is accepting what
     * the page already says. Reverting to `before` there would be wrong twice
     * over, because `before` is neither version in the collision.
     *
     * @param {string} itemId
     * @returns {{retired: boolean, kind: (string|null), reason: (string|null)}}
     */
    function retire(itemId) {
      var item = store.readItem(requireReview(), itemId);
      if (!item) return { retired: false, kind: null, reason: "no record " + String(itemId) };

      if (session && session.itemId === itemId) {
        // Retiring the record the reviewer is inside. Edit state goes first, and
        // it goes without committing: retiring is the decision.
        dropSession();
      }

      store.remove(requireReview(), itemId);
      unpersist(item);
      forget(itemId);
      delete deleted[itemId];
      emit(item, "undone");
      scheduleReplay("undo");
      return { retired: true, kind: item[record.FIELD.KIND], reason: null };
    }

    // Close the open session without committing: an undo or a retire is the
    // decision.
    function dropSession() {
      if (!session) return null;
      var open = session;
      session = null;
      closeBurstOf(open);
      unbindBlock();
      if (open.mode === MODE.RUN) clearHostAttrs(open);
      else clearEditableAttrs(open.block);
      protect.release(open.block);
      hideFrame();
      hidePlaceholder();
      return open;
    }

    /**
     * Undo of a committed run record, on the page: the run's elements come
     * out (found with blocks.runElementsFor, before the anchor moves, since
     * the run is found from the anchor's insert point), and the anchor gets
     * its old tag and its before back. The record never stored the old tag as
     * a field, so it is read off the region's fingerprint, which was minted
     * before the sitting changed anything.
     */
    function restoreRun(item) {
      var el = elementFor(item);
      if (!el) return { element: null, reason: "the anchor this record points at is not on the page" };
      var found = record.isRunRecord(item) ? blocks.runElementsFor(item, doc, el) : { blocks: [] };
      var container = item[record.FIELD.PLACEMENT] === record.PLACEMENT.START_OF_CONTAINER;
      var ref = item[record.FIELD.REGION] && item[record.FIELD.REGION].ref;
      var oldTag = ref && ref.fingerprint && ref.fingerprint.tag ? String(ref.fingerprint.tag).toLowerCase() : tagOf(el);
      var beforeHtml = item[record.FIELD.BEFORE_HTML];
      epoch.write("editing.undo_run", function () {
        found.blocks.forEach(function (b) {
          b.elements.forEach(function (node) {
            if (node !== el && node.parentNode) node.parentNode.removeChild(node);
          });
        });
        if (container) return;
        if (tagOf(el) !== oldTag) {
          var swapped = blocks.swapTag(el, oldTag);
          if (swapped) el = swapped;
        }
        var built = typeof beforeHtml === "string" ? blocks.writeBlock(oldTag, beforeHtml, doc) : null;
        if (built) {
          while (el.firstChild) el.removeChild(el.firstChild);
          while (built.firstChild) el.appendChild(built.firstChild);
        } else if (typeof beforeHtml === "string") el.innerHTML = beforeHtml;
        else el.textContent = String(item[record.FIELD.BEFORE] || "");
      });
      return { element: el, reason: null };
    }

    function restoreRegion(item) {
      if (record.hasRunFields(item)) return restoreRun(item);
      var el = elementFor(item);
      if (!el) return { element: null, reason: "the region this record points at is not on the page" };
      var beforeHtml = item[record.FIELD.BEFORE_HTML];
      var beforeText = item[record.FIELD.BEFORE];
      epoch.write("editing.undo", function () {
        if (typeof beforeHtml === "string") el.innerHTML = beforeHtml;
        else el.textContent = String(beforeText || "");
      });
      return { element: el, reason: null };
    }

    function restoreDeleted(item) {
      var where = deleted[item[record.FIELD.ID]];
      if (!where) return { element: null, reason: "nothing is remembered about where this block was" };
      if (!where.parent || !where.parent.isConnected) {
        return { element: null, reason: "the container this block lived in is gone from the page" };
      }
      var node = where.node;
      if (!node) {
        node = doc.createElement(where.tag || "p");
        node.innerHTML = String(where.html || "");
      }
      epoch.write("editing.undo_delete", function () {
        if (where.next && where.next.parentNode === where.parent) where.parent.insertBefore(node, where.next);
        else where.parent.appendChild(node);
      });
      return { element: node, reason: null };
    }

    // ------------------------------------------------------------------------
    // Which record belongs to which block
    // ------------------------------------------------------------------------

    function remember(el, id) {
      forget(id);
      itemForElement.push({ el: el, id: id });
    }

    // One more element for a record that already has one: a run block.
    function rememberAlso(el, id) {
      itemForElement = itemForElement.filter(function (row) {
        return row.el !== el;
      });
      itemForElement.push({ el: el, id: id });
    }

    // Drops this record's row, and any row whose block is out of the document.
    //
    // The retire paths (undo, commit, retire) already call this, so a record
    // that leaves the review leaves the list with it. What the list used to keep
    // was the OTHER shape: a block a repaint replaced, still named by a record
    // that is still outstanding. Nothing can match a detached node again
    // (itemFor is asked about a block on the page), and holding one holds its
    // whole old document tree, so it goes on the next pass through here
    // (the 2026-09-16 memory audit). `!== false` because a fake block in a unit
    // test has no isConnected at all, and absent is not detached.
    function forget(id) {
      itemForElement = itemForElement.filter(function (row) {
        if (row.id === id) return false;
        return !!row.el && row.el.isConnected !== false;
      });
    }

    /**
     * The outstanding record for this block, if it has one. The live map is
     * asked first because it is exact and free; the anchor is asked second
     * because it is the durable answer and survives a repaint.
     */
    function itemFor(el) {
      if (!el || !reviewId) return null;
      var i;
      for (i = 0; i < itemForElement.length; i += 1) {
        if (itemForElement[i].el === el) {
          var got = store.readItem(reviewId, itemForElement[i].id);
          if (got && got[record.FIELD.STATE] !== record.STATE.HANDLED) return got;
        }
      }
      var items = store.read(reviewId);
      for (i = 0; i < items.length; i += 1) {
        var item = items[i];
        if (!isEditKind(item)) continue;
        if (item[record.FIELD.STATE] === record.STATE.HANDLED) continue;
        if (elementFor(item) === el) return item;
      }
      // A run block belongs to the record whose run it is (plan Task 2.1:
      // itemFor maps any run block back through blocks.runElementsFor).
      var holding = runRecordHolding(el);
      return holding ? holding.item : null;
    }

    function isEditKind(item) {
      var kind = item[record.FIELD.KIND];
      return kind === record.KIND.EDIT || kind === record.KIND.FORMAT_ONLY || kind === record.KIND.DELETE;
    }

    function elementFor(item) {
      var region = item[record.FIELD.REGION];
      if (!region || !region.ref || !doc) return null;
      var verdict = anchor.resolve(region.ref, doc, {
        placement: item[record.FIELD.PLACEMENT] || null,
        tagAfter: item[record.FIELD.ANCHOR_TAG_AFTER] || null
      });
      return verdict && verdict.bound ? verdict.element : null;
    }

    function regionFor(element) {
      var region = record.emptyRegion();
      if (!element) return region;
      var range = null;
      if (doc && doc.createRange) {
        range = doc.createRange();
        range.selectNodeContents(element);
      }
      region.ref = anchor.mint({ element: element, range: range, root: doc });
      // A mint that failed is stamped lost here, at the moment it fails. Stored
      // without the stamp, the item read as healthy while its anchor pointed at
      // nothing, which is what made the original bug silent.
      region.lost = regions.lostFromMint(region.ref);
      try {
        regions.pinLabel(region, anchor.descriptorFor(element, doc));
      } catch (err) {
        // A label is a display convenience. A region with a reference and no
        // label is still a usable record.
        region.label = null;
      }
      return region;
    }

    // ONE WALK FOR BOTH RECORD KINDS. comments.js owns the heading walk (it
    // looks inside earlier siblings, not only at them, since 2026-09-11); an
    // edit's context.heading comes from the same function so a comment and a
    // hand edit on one block can never name different headings.
    function headingTextFor(element) {
      if (!element) return null;
      if (commentsModule && typeof commentsModule.headingTextFor === "function") {
        return commentsModule.headingTextFor(element, doc);
      }
      var el = element.previousElementSibling;
      while (el) {
        if (/^H[1-6]$/.test(el.tagName)) return normalize.normalizeText(el.textContent || "");
        el = el.previousElementSibling;
      }
      var parent = element.parentElement;
      return parent && doc && parent !== doc.body ? headingTextFor(parent) : null;
    }

    function contextFor(element, region) {
      var context = record.emptyContext();
      if (!element) return context;
      context.element = element.tagName;
      context.heading = headingTextFor(element);
      // The anchor's own context ring, carried into the two fields the
      // projection has always had room for and nobody ever filled.
      var ref = region && region.ref;
      if (ref) {
        if (typeof ref.prefix === "string") context.prefix = ref.prefix;
        if (typeof ref.suffix === "string") context.suffix = ref.suffix;
      }
      context.subject = anchor.subjectFor(element, doc);
      return context;
    }

    // ------------------------------------------------------------------------
    // The frame: drawn over the page, never on it
    // ------------------------------------------------------------------------

    function surface() {
      if (!doc || !highlights) return null;
      var got = highlights.surface();
      highlights.addSurfaceStyle("editing", FRAME_STYLE);
      return got.root || got.host;
    }

    // ------------------------------------------------------------------------
    // Free writing: edit state with no block open, "+ Write here", and the
    // placeholder (plan Task 2.3)
    // ------------------------------------------------------------------------

    var editState = false;
    var lineNode = null;
    var lineTarget = null;
    var lineRaf = null;
    var linePoint = null;
    var placeholderNode = null;
    var emptyPageChecked = false;

    /**
     * Cmd-Shift-E with the caret in no block: the same edit state with nothing
     * selected. The bar shows near the top with its hint; the lines show on
     * hover; a click on a block opens that block; Esc, or the rail, leaves.
     */
    function enterEditState() {
      if (session) commit({ reason: "edit state" });
      editState = true;
      drawFrame(null);
      positionStateBar();
      refreshBar();
      return sessionInfo();
    }

    function leaveEditState() {
      if (!editState) return false;
      editState = false;
      if (!session) {
        if (barNode) barNode.style.display = "none";
        if (frameRaf && win && win.cancelAnimationFrame) {
          win.cancelAnimationFrame(frameRaf);
          frameRaf = null;
        }
        hideLine();
      }
      return true;
    }

    function positionStateBar() {
      if (!barNode || !win) return;
      var main = doc.querySelector("main") || doc.body;
      var r = main.getBoundingClientRect();
      var left = Math.round(Math.max(8, r.left));
      barNode.style.top = "12px";
      barNode.style.bottom = "auto";
      barNode.style.left = left + "px";
      fitBar(left);
    }

    function isEditOpen() {
      return !!session || editState;
    }

    function lineStyleHost() {
      var host = surface();
      if (!host) return null;
      if (!lineNode) {
        lineNode = doc.createElement("div");
        lineNode.className = "lahe-insert-line";
        lineNode.setAttribute("role", "button");
        lineNode.setAttribute("aria-label", INSERT_LINE_LABEL);
        markers.markChrome(lineNode);
        var rule = doc.createElement("span");
        rule.className = "lahe-insert-line__rule";
        var text = doc.createElement("span");
        text.className = "lahe-insert-line__label";
        text.textContent = INSERT_LINE_LABEL;
        lineNode.appendChild(rule);
        lineNode.appendChild(text);
        lineNode.addEventListener("mousedown", function (event) {
          event.preventDefault();
        });
        lineNode.addEventListener("click", function (event) {
          event.preventDefault();
          if (lineTarget) openAfter(lineTarget);
        });
        host.appendChild(lineNode);
      }
      return lineNode;
    }

    function hideLine() {
      lineTarget = null;
      if (lineNode) lineNode.removeAttribute("data-lahe-show");
    }

    // The gap under the pointer: between two blocks, or below the last one.
    // Returns the block above it and where to draw the line.
    function gapAt(x, y) {
      var leaves = blocks.leafWalk(doc.body).filter(function (el) {
        return !markers.isInsideOverlay(el) && el.getClientRects().length > 0;
      });
      if (!leaves.length) return null;
      var slack = 6;
      for (var i = 0; i < leaves.length; i += 1) {
        var a = leaves[i].getBoundingClientRect();
        var next = leaves[i + 1] ? leaves[i + 1].getBoundingClientRect() : null;
        var inColumn = x >= a.left - 40 && x <= a.right + 40;
        if (!inColumn) continue;
        if (next && next.top >= a.bottom - 1) {
          if (y >= a.bottom - slack && y <= next.top + slack) {
            return { block: leaves[i], y: (a.bottom + next.top) / 2, left: Math.min(a.left, next.left), right: Math.max(a.right, next.right) };
          }
        } else if (!next && y >= a.bottom - slack && y <= a.bottom + 64) {
          return { block: leaves[i], y: a.bottom + 12, left: a.left, right: a.right };
        }
      }
      return null;
    }

    function onLineMove(event) {
      if (!isEditOpen() || !win) return;
      if (markers.isInsideOverlay(event.target)) return;
      linePoint = { x: event.clientX, y: event.clientY };
      if (lineRaf) return;
      var run = function () {
        lineRaf = null;
        placeLine();
      };
      lineRaf = win.requestAnimationFrame ? win.requestAnimationFrame(run) : (run(), null);
    }

    function placeLine() {
      if (!isEditOpen() || !linePoint) return hideLine();
      var gap = gapAt(linePoint.x, linePoint.y);
      if (!gap) return hideLine();
      var node = lineStyleHost();
      if (!node) return;
      var limit = (win.innerWidth || 1024) - railAllowance() - 8;
      var right = Math.min(gap.right, limit);
      lineTarget = gap.block;
      node.style.top = Math.round(gap.y - 10) + "px";
      node.style.left = Math.round(gap.left) + "px";
      node.style.width = Math.max(40, Math.round(right - gap.left)) + "px";
      node.setAttribute("data-lahe-show", "true");
    }

    function lineInfo() {
      if (!lineNode || lineNode.getAttribute("data-lahe-show") !== "true") return null;
      var r = lineNode.getBoundingClientRect();
      return {
        rect: { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 },
        label: lineNode.textContent,
        opacity: win.getComputedStyle(lineNode).opacity,
        transition: win.getComputedStyle(lineNode).transitionDuration,
        after: lineTarget ? normalize.normalizeText(lineTarget.textContent || "").slice(0, 80) : null
      };
    }

    /**
     * "+ Write here": commits any open session and opens a new one anchored
     * on the block above, with an empty first paragraph.
     */
    function openAfter(block) {
      hideLine();
      if (session) commit({ reason: "write here" });
      leaveEditState();
      if (!block || !block.isConnected) return null;
      var info = editBlock(block);
      if (!info || !isRun()) return info;
      var holder = inSession(block) ? blockOf(block) : session.anchor;
      pushHistory();
      var p = newParagraph();
      structural("write_here", function () {
        insertAfterBlock(holder, p, false);
        setCaret(p, 0);
      });
      setCaret(p, 0);
      refreshBar();
      return sessionInfo();
    }

    // The placeholder is drawn in the layer's own root over the empty block,
    // never in the page, and it goes on the first keystroke.
    function updatePlaceholder(unit) {
      var show = !!session && isRun() && !!unit && unit !== session.anchor && blockOf(unit) !== session.anchor && isEmptyUnit(unit);
      if (!show) return hidePlaceholder();
      var host = surface();
      if (!host) return;
      if (!placeholderNode) {
        placeholderNode = doc.createElement("div");
        placeholderNode.className = "lahe-edit-placeholder";
        placeholderNode.setAttribute("aria-hidden", "true");
        placeholderNode.textContent = PLACEHOLDER;
        markers.markChrome(placeholderNode);
        host.appendChild(placeholderNode);
      }
      var r = unit.getBoundingClientRect();
      var cs = win.getComputedStyle(unit);
      placeholderNode.style.top = r.top + "px";
      placeholderNode.style.left = r.left + (parseFloat(cs.paddingLeft) || 0) + "px";
      placeholderNode.style.height = r.height + "px";
      placeholderNode.style.fontSize = cs.fontSize;
      placeholderNode.style.lineHeight = cs.lineHeight;
      placeholderNode.style.fontFamily = cs.fontFamily;
      placeholderNode.style.display = "block";
    }

    function hidePlaceholder() {
      if (placeholderNode) placeholderNode.style.display = "none";
    }

    function placeholderInfo() {
      if (!placeholderNode || placeholderNode.style.display === "none") return null;
      var r = placeholderNode.getBoundingClientRect();
      return { text: placeholderNode.textContent, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
    }

    // An empty page opens ready to type (PQ1): a session in an empty
    // paragraph at the start of the page's one main (or body), after any
    // leading chrome such as the marked file-name title.
    function hasContent() {
      return blocks.leafWalk(doc.body).some(function (el) {
        return !markers.isInsideOverlay(el);
      });
    }

    function containerOfPage() {
      var mains = doc.getElementsByTagName("main");
      return mains.length === 1 ? mains[0] : doc.body;
    }

    function openEmptyPage() {
      if (!doc || !doc.body || !reviewId || session || hasContent()) return null;
      var outstanding = store.read(reviewId).some(function (item) {
        return item[record.FIELD.PLACEMENT] === record.PLACEMENT.START_OF_CONTAINER && record.isOutstanding(item);
      });
      if (outstanding) return null;
      return openAtStart(containerOfPage());
    }

    function openAtStart(container) {
      openRun(container, { placement: record.PLACEMENT.START_OF_CONTAINER });
      var p = newParagraph();
      structural("start_of_page", function () {
        insertAfterBlock(container, p, false);
      });
      setCaret(p, 0);
      refreshBar();
      return sessionInfo();
    }

    function scheduleEmptyPage() {
      if (emptyPageChecked || !win) return;
      emptyPageChecked = true;
      win.setTimeout(openEmptyPage, 0);
    }

    function drawFrame(block) {
      var host = surface();
      if (!host) return null;
      if (!frameNode) {
        frameNode = doc.createElement("div");
        frameNode.className = FRAME_CLASS;
        markers.markChrome(frameNode);
        host.appendChild(frameNode);
      }
      if (!barNode) {
        barNode = buildBar();
        host.appendChild(barNode);
      }
      frameNode.style.display = block ? "block" : "none";
      barNode.style.display = "flex";
      barNode.setAttribute("data-lahe-edit-state", block ? "block" : "none");
      refreshBar();
      positionFrame();
      watchFrame();
      return frameNode;
    }

    var barParts = null;
    var menuOpen = false;
    var menuSavedRange = null;

    function buildBar() {
      var bar = doc.createElement("div");
      bar.className = BAR_CLASS;
      markers.markChrome(bar);
      barParts = {};

      var label = doc.createElement("span");
      label.className = "lahe-edit-bar__label";
      label.textContent = LABEL_EDITING;
      bar.appendChild(label);

      var firstSep = separator();
      bar.appendChild(firstSep);

      // The block-type menu, before B and I (wireframe direction A). Built from
      // the rail's "More actions" menu: role=menu, aria-haspopup,
      // aria-expanded, arrow keys, and focus returned on close.
      var wrap = doc.createElement("span");
      wrap.className = "lahe-edit-bar__typewrap";
      var typeBtn = doc.createElement("button");
      typeBtn.type = "button";
      typeBtn.className = "lahe-edit-bar__btn lahe-edit-bar__type";
      typeBtn.setAttribute("data-lahe-command", "block-type");
      typeBtn.setAttribute("aria-haspopup", "menu");
      typeBtn.setAttribute("aria-expanded", "false");
      typeBtn.textContent = "Paragraph";
      var menu = doc.createElement("div");
      menu.className = "lahe-edit-bar__menu";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Block type");
      menu.hidden = true;
      var rows = gestures.BLOCK_TYPES.map(function (t) {
        var row = doc.createElement("button");
        row.type = "button";
        row.className = "lahe-edit-bar__row";
        row.setAttribute("role", "menuitem");
        row.setAttribute("data-lahe-type", t.tag);
        row.tabIndex = -1;
        var name = doc.createElement("span");
        name.className = "lahe-edit-bar__rowname";
        name.textContent = t.label;
        var chord = doc.createElement("span");
        chord.className = "lahe-edit-bar__rowkey";
        chord.textContent = gestures.chordLabelFor(t.tag, platform());
        var md = doc.createElement("span");
        md.className = "lahe-edit-bar__rowmd";
        md.textContent = t.markdown ? t.markdown.trim() : "";
        row.appendChild(name);
        row.appendChild(chord);
        row.appendChild(md);
        row.addEventListener("click", function () {
          if (row.getAttribute("aria-disabled") === "true") return;
          closeMenu(true);
          typeActions[t.tag]();
        });
        menu.appendChild(row);
        return row;
      });
      typeBtn.addEventListener("click", function () {
        if (menuOpen) closeMenu(true);
        else openMenu(0);
      });
      typeBtn.addEventListener("keydown", function (event) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openMenu(event.key === "ArrowUp" ? rows.length - 1 : 0);
        } else if (event.key === "Escape" || (event.key === "Tab" && event.shiftKey)) {
          event.preventDefault();
          returnFocusToCaret();
        }
      });
      menu.addEventListener("keydown", onMenuKey);
      wrap.appendChild(typeBtn);
      wrap.appendChild(menu);
      bar.appendChild(wrap);
      var typeSep = separator();
      bar.appendChild(typeSep);

      var formatButtons = [];
      Object.keys(COMMANDS).forEach(function (command) {
        var button = doc.createElement("button");
        button.type = "button";
        button.className = "lahe-edit-bar__btn";
        button.setAttribute("data-lahe-command", command);
        button.textContent = command === "bold" ? "B" : "I";
        button.setAttribute("aria-label", command === "bold" ? "Bold" : "Italic");
        button.addEventListener("click", function () {
          format(command);
        });
        bar.appendChild(button);
        formatButtons.push(button);
      });

      var remove = doc.createElement("button");
      remove.type = "button";
      remove.className = "lahe-edit-bar__btn";
      remove.setAttribute("data-lahe-command", "delete");
      remove.textContent = "Delete block";
      remove.addEventListener("click", function () {
        deleteBlock(null);
      });
      bar.appendChild(remove);

      var lastSep = separator();
      bar.appendChild(lastSep);

      var hint = doc.createElement("span");
      hint.className = "lahe-edit-bar__hint";
      hint.textContent = HINT_FINISH;
      bar.appendChild(hint);

      // Pressing a button must not take focus out of the block: the caret is
      // what execCommand applies to, and a bar that stole it would format
      // nothing and look broken.
      bar.addEventListener("mousedown", function (event) {
        event.preventDefault();
      });
      barParts = {
        typeWrap: wrap,
        typeBtn: typeBtn,
        typeSep: typeSep,
        menu: menu,
        rows: rows,
        formatButtons: formatButtons,
        remove: remove,
        hint: hint,
        firstSep: firstSep,
        lastSep: lastSep
      };
      return bar;
    }

    function separator() {
      var sep = doc.createElement("span");
      sep.className = "lahe-edit-bar__sep";
      return sep;
    }

    function show(el, on) {
      if (el) el.style.display = on ? "" : "none";
    }

    /** Brings the bar's words and controls in line with the session. */
    function refreshBar() {
      if (!barNode || !barParts) return;
      var run = isRun();
      var noBlock = !!editState && !session;
      show(barParts.typeWrap, run);
      show(barParts.typeSep, run);
      barParts.formatButtons.forEach(function (b) {
        show(b, !noBlock);
      });
      show(barParts.remove, !noBlock);
      show(barParts.firstSep, !noBlock);
      barNode.setAttribute("data-lahe-edit-state", noBlock ? "none" : "block");
      var hintText = noBlock ? HINT_EDIT_STATE : HINT_FINISH;
      var notice = false;
      if (run) {
        var t = typeState();
        barParts.typeBtn.textContent = t.label;
        barParts.typeBtn.disabled = t.other;
        barParts.typeBtn.setAttribute("aria-disabled", t.other ? "true" : "false");
        barParts.rows.forEach(function (row) {
          var tag = row.getAttribute("data-lahe-type");
          var on = !!t.enabled[tag];
          row.setAttribute("aria-disabled", on ? "false" : "true");
          row.setAttribute("aria-checked", tag === t.tag ? "true" : "false");
        });
        var ratio = session.ceiling ? session.ceiling.ratio : 0;
        if (session.ceilingRefused || ratio >= 1) {
          hintText = CEILING_FULL;
          notice = true;
        } else if (ratio >= CEILING_WARN_RATIO) {
          hintText = CEILING_WARN;
          notice = true;
        }
        var range = liveRange();
        var unit = range ? unitOf(range.startContainer) : null;
        var inAnchor = unit && blockOf(unit) === session.anchor;
        barParts.remove.disabled = !!inAnchor && session.run.length > 0;
        updatePlaceholder(unit);
      }
      if (barParts.hint.textContent !== hintText) barParts.hint.textContent = hintText;
      barParts.hint.setAttribute("data-lahe-notice", notice ? "true" : "false");
      barParts.hint.setAttribute("role", notice ? "status" : "presentation");
    }

    function openMenu(index) {
      if (!barParts || menuOpen || barParts.typeBtn.disabled) return false;
      var range = liveRange();
      if (range && inSession(range.startContainer)) menuSavedRange = range.cloneRange();
      menuOpen = true;
      barParts.menu.hidden = false;
      barParts.typeBtn.setAttribute("aria-expanded", "true");
      // Opens upward when there is no room below the bar.
      barParts.menu.classList.remove("lahe-edit-bar__menu--up");
      var bar = barNode.getBoundingClientRect();
      var menuHeight = barParts.menu.getBoundingClientRect().height;
      if (win && bar.bottom + menuHeight + 8 > (win.innerHeight || 768)) barParts.menu.classList.add("lahe-edit-bar__menu--up");
      focusRow(index || 0);
      return true;
    }

    function focusRow(index) {
      var rows = barParts.rows;
      var n = rows.length;
      var next = ((index % n) + n) % n;
      rows[next].focus();
      return next;
    }

    function closeMenu(returnFocus) {
      if (!menuOpen) return false;
      menuOpen = false;
      barParts.menu.hidden = true;
      barParts.typeBtn.setAttribute("aria-expanded", "false");
      if (returnFocus) returnFocusToCaret();
      return true;
    }

    // Focus back where the reviewer was typing: the host, with the caret the
    // menu opened on.
    function returnFocusToCaret() {
      if (!session || !isRun()) return false;
      var host = session.host;
      if (host && typeof host.focus === "function") {
        try {
          host.focus({ preventScroll: true });
        } catch (err) {
          host.focus();
        }
      }
      if (menuSavedRange && inSession(menuSavedRange.startContainer)) {
        var sel = win.getSelection();
        sel.removeAllRanges();
        sel.addRange(menuSavedRange);
      }
      return true;
    }

    function focusMenuButton() {
      if (!barParts || barParts.typeBtn.disabled) return false;
      var range = liveRange();
      if (range && inSession(range.startContainer)) menuSavedRange = range.cloneRange();
      barParts.typeBtn.focus();
      return true;
    }

    function onMenuKey(event) {
      var root = barParts.menu.getRootNode();
      var index = barParts.rows.indexOf(root.activeElement);
      var got = gestures.gestureFor({ type: "keydown", key: event.key, blockMenuOpen: true, editing: true });
      if (got.gesture === gestures.GESTURE.CLOSE_MENU) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        focusRow(index + 1);
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        focusRow(index - 1);
      } else if (event.key === "Home") {
        event.preventDefault();
        focusRow(0);
      } else if (event.key === "End") {
        event.preventDefault();
        focusRow(barParts.rows.length - 1);
      } else if (event.key === "Tab") {
        closeMenu(false);
      }
    }

    // The blocks the frame wraps: every block the sitting created or changed,
    // plus the caret's block. An untouched anchor stays outside it.
    function framedElements() {
      if (!session) return [];
      if (!isRun()) return [session.block];
      var out = [];
      var anchorChanged =
        !session.container &&
        (tagOf(session.anchor) !== session.anchorTag || anchorMarkup() !== session.openedAnchorHtml);
      if (anchorChanged) out.push(session.anchor);
      session.run.forEach(function (r) {
        out.push(r.el);
      });
      var range = liveRange();
      var unit = range ? unitOf(range.startContainer) : null;
      var caretBlock = unit ? blockOf(unit) : null;
      if (!caretBlock && !out.length && !session.container) caretBlock = session.anchor;
      if (caretBlock && out.indexOf(caretBlock) === -1) out.push(caretBlock);
      return out;
    }

    function unionRect(list) {
      var box = null;
      list.forEach(function (el) {
        if (!el || typeof el.getBoundingClientRect !== "function") return;
        var r = el.getBoundingClientRect();
        if (!box) box = { top: r.top, left: r.left, right: r.right, bottom: r.bottom };
        else {
          box.top = Math.min(box.top, r.top);
          box.left = Math.min(box.left, r.left);
          box.right = Math.max(box.right, r.right);
          box.bottom = Math.max(box.bottom, r.bottom);
        }
      });
      return box;
    }

    function positionFrame() {
      if (!barNode || !win) return null;
      if (!session) {
        if (editState) positionStateBar();
        return frameNode;
      }
      if (!frameNode) return null;
      var rect = unionRect(framedElements()) || session.block.getBoundingClientRect();
      var pad = 6;
      frameNode.style.top = rect.top - pad + "px";
      frameNode.style.left = rect.left - pad + "px";
      frameNode.style.width = rect.right - rect.left + pad * 2 + "px";
      frameNode.style.height = rect.bottom - rect.top + pad * 2 + "px";

      // The bar sits above the frame, pinned by its BOTTOM edge, so its own
      // height never enters the calculation. Measuring the height instead
      // reads zero on the first frame in some engines, which puts the bar in
      // one place and then moves it a frame later: the reviewer sees it jump,
      // and anything aiming at a button can miss it.
      var viewport = win.innerHeight || 768;
      var roomAbove = rect.top - pad - 8;
      var left = Math.round(Math.max(8, rect.left - pad));
      barNode.style.left = left + "px";
      if (roomAbove >= 44) {
        barNode.style.bottom = Math.round(viewport - roomAbove) + "px";
        barNode.style.top = "auto";
      } else {
        barNode.style.top = Math.round(Math.min(rect.bottom + pad + 8, viewport - 44)) + "px";
        barNode.style.bottom = "auto";
      }
      fitBar(left);
      return frameNode;
    }

    // On a narrow window the bar drops its hint first.
    function fitBar(left) {
      if (!barParts || !win) return;
      var room = (win.innerWidth || 1024) - left - 8 - railAllowance();
      barParts.hint.style.display = "";
      barParts.lastSep.style.display = "";
      if (barNode.getBoundingClientRect().width > room && barParts.hint.getAttribute("data-lahe-notice") !== "true") {
        barParts.hint.style.display = "none";
        barParts.lastSep.style.display = "none";
      }
    }

    function railAllowance() {
      if (!doc || !win || typeof win.getComputedStyle !== "function") return 0;
      var host = doc.getElementById(highlightModule.SURFACE_ID);
      if (!host) return 0;
      var px = parseFloat(win.getComputedStyle(host).getPropertyValue(highlightModule.RAIL_ALLOWANCE_PROP));
      return isFinite(px) && px > 0 ? px : 0;
    }

    function watchFrame() {
      if (frameRaf || !win) return;
      var tick = function () {
        if (!session && !editState) {
          frameRaf = null;
          return;
        }
        positionFrame();
        frameRaf = win.requestAnimationFrame ? win.requestAnimationFrame(tick) : null;
      };
      frameRaf = win.requestAnimationFrame ? win.requestAnimationFrame(tick) : null;
    }

    function hideFrame() {
      if (menuOpen) closeMenu(false);
      if (frameNode) frameNode.style.display = "none";
      if (barNode && !editState) barNode.style.display = "none";
      if (frameRaf && win && win.cancelAnimationFrame && !editState) {
        win.cancelAnimationFrame(frameRaf);
        frameRaf = null;
      }
      return true;
    }

    function frameRect() {
      if (!frameNode || frameNode.style.display === "none") return null;
      var r = frameNode.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }

    function frameLabel() {
      if (!barNode || barNode.style.display === "none") return null;
      return barNode.textContent;
    }

    // What the bar shows, for a spec: a closed root cannot be queried.
    function barInfo() {
      if (!barNode || barNode.style.display === "none" || !barParts) return null;
      var r = barNode.getBoundingClientRect();
      var root = barNode.getRootNode();
      var active = root && root.activeElement ? root.activeElement : null;
      return {
        rect: { x: r.x, y: r.y, width: r.width, height: r.height },
        label: barNode.querySelector(".lahe-edit-bar__label").textContent,
        hint: barParts.hint.style.display === "none" ? null : barParts.hint.textContent,
        notice: barParts.hint.getAttribute("data-lahe-notice") === "true",
        typeVisible: barParts.typeWrap.style.display !== "none",
        typeLabel: barParts.typeBtn.textContent,
        typeDisabled: barParts.typeBtn.disabled,
        formatVisible: barParts.formatButtons[0].style.display !== "none",
        deleteVisible: barParts.remove.style.display !== "none",
        menuOpen: menuOpen,
        menuUp: barParts.menu.classList.contains("lahe-edit-bar__menu--up"),
        menuRect: menuOpen ? rectOf(barParts.menu) : null,
        typeRect: rectOf(barParts.typeBtn),
        focused: active === barParts.typeBtn ? "type" : barParts.rows.indexOf(active) !== -1 ? "row:" + barParts.rows[barParts.rows.indexOf(active)].getAttribute("data-lahe-type") : null,
        rows: barParts.rows.map(function (row) {
          return {
            tag: row.getAttribute("data-lahe-type"),
            label: row.querySelector(".lahe-edit-bar__rowname").textContent,
            chord: row.querySelector(".lahe-edit-bar__rowkey").textContent,
            markdown: row.querySelector(".lahe-edit-bar__rowmd").textContent,
            disabled: row.getAttribute("aria-disabled") === "true",
            rect: menuOpen ? rectOf(row) : null
          };
        })
      };
    }

    function rectOf(el) {
      var r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    }

    function buttonNode(name) {
      if (!barNode) return null;
      return barNode.querySelector('[data-lahe-command="' + String(name) + '"]');
    }

    // ------------------------------------------------------------------------
    // Replay
    // ------------------------------------------------------------------------

    function scheduleReplay(reason) {
      var replay = typeof replayRef === "function" ? replayRef() : replayRef;
      if (!replay || typeof replay.schedule !== "function") return false;
      // After the write epoch closes, which is a microtask away: a pass
      // scheduled while the epoch is open is swallowed by design.
      var run = function () {
        replay.schedule(reason);
      };
      if (typeof queueMicrotask === "function") queueMicrotask(run);
      else Promise.resolve().then(run);
      return true;
    }

    // ------------------------------------------------------------------------
    // Wiring the gestures
    // ------------------------------------------------------------------------
    //
    // Every decision comes from the pure table in shared/gestures.js. This
    // function's only job is to describe the world to it and then do what it
    // says.

    function bind(input) {
      var src = input || {};
      var target = src.document || doc;
      if (!target) return { bound: false, reason: "no document" };
      if (src.page) setPage(src.page);
      unbind();

      listenerHandles.push(listeners.on(target, "keydown", onKeydown, true, LISTENER_GROUP));
      listenerHandles.push(listeners.on(target, "click", onClick, true, LISTENER_GROUP));
      // Pointerdown, in capture, so a click that lands on the rail (or on
      // anything that stops the click from propagating) still commits the open
      // edit. mousedown as well, because a synthetic click in a test and an
      // engine without pointer events both still produce one; commit() is
      // idempotent, so the pair costs nothing.
      listenerHandles.push(listeners.on(target, "pointerdown", onPointerDown, true, LISTENER_GROUP));
      listenerHandles.push(listeners.on(target, "mousedown", onPointerDown, true, LISTENER_GROUP));
      // Free writing: an arrow out of the session ends it, the caret's block
      // drives the menu, and the pointer over a gap shows "+ Write here".
      listenerHandles.push(listeners.on(target, "keyup", onRunKeyup, true, LISTENER_GROUP));
      listenerHandles.push(listeners.on(target, "selectionchange", onRunSelectionChange, true, LISTENER_GROUP));
      listenerHandles.push(listeners.on(target, "mousemove", onLineMove, true, LISTENER_GROUP));

      if (win) {
        // The window losing focus is the reviewer leaving too.
        listenerHandles.push(listeners.on(win, "blur", onWindowBlur, false, LISTENER_GROUP));
      }

      if (win) {
        // Navigation cannot be a losing move (R1). Both events are bound
        // because engines disagree about which one fires on which navigation,
        // and commit() is idempotent so the second one is free.
        listenerHandles.push(listeners.on(win, "pagehide", onUnload, false, LISTENER_GROUP));
        listenerHandles.push(listeners.on(win, "beforeunload", onUnload, false, LISTENER_GROUP));
      }
      // A remount de-registers this whole group before it calls back in here,
      // and the open block's own input handlers are in that group. Without this
      // line the reviewer's block is still contenteditable and still on screen
      // after a morph, and every keystroke into it is recorded nowhere.
      if (session && session.block) bindBlock(isRun() ? session.host : session.block);
      scheduleEmptyPage();
      return { bound: true, listeners: listenerHandles.length };
    }

    function unbind() {
      listenerHandles.forEach(function (handle) {
        handle.off();
      });
      listenerHandles = [];
    }

    /**
     * Did this press land on a scrollbar rather than on content?
     *
     * A scrollbar drag fires pointerdown and no click, so the commit-outside
     * rule read the reviewer scrolling as the reviewer leaving and stripped
     * contenteditable out from under their pointer (review, 2026-08-17).
     *
     * This function only MEASURES. gestures.isScrollbarPress decides, so the
     * rule is unit-testable with no browser, the way every other gesture rule
     * is. Two measurements, because a page has two kinds of scrollbar: the
     * root's, which sits outside the document element with the viewport as its
     * outer edge, and an element's own, which sits in the gutter between its
     * content box and its border box.
     *
     * @param {Object} event a pointerdown or mousedown
     * @returns {boolean}
     */
    function pressedOnScrollbar(event) {
      var node = event.target;
      if (!node || node.nodeType !== 1) return false;
      if (typeof event.clientX !== "number" || typeof event.clientY !== "number") return false;

      var docEl = doc && doc.documentElement ? doc.documentElement : null;
      if (docEl && win && (node === docEl || node === doc.body)) {
        var onRootBar = gestures.isScrollbarPress({
          x: event.clientX,
          y: event.clientY,
          contentWidth: docEl.clientWidth,
          contentHeight: docEl.clientHeight,
          boxWidth: win.innerWidth || docEl.clientWidth,
          boxHeight: win.innerHeight || docEl.clientHeight
        });
        if (onRootBar) return true;
      }

      if (typeof node.getBoundingClientRect !== "function") return false;
      var rect = node.getBoundingClientRect();
      return gestures.isScrollbarPress({
        x: event.clientX - rect.left - (node.clientLeft || 0),
        y: event.clientY - rect.top - (node.clientTop || 0),
        contentWidth: node.clientWidth,
        contentHeight: node.clientHeight,
        boxWidth: rect.width,
        boxHeight: rect.height
      });
    }

    function describe(event) {
      return {
        type: event.type,
        // Which mouse button, and whether the press was on a scrollbar. Both
        // exist for the commit-outside rule: only a primary press on content is
        // the reviewer leaving the block.
        button: typeof event.button === "number" ? event.button : undefined,
        onScrollbar:
          event.type === "pointerdown" || event.type === "mousedown" ? pressedOnScrollbar(event) : false,
        key: event.key,
        metaKey: event.metaKey === true,
        ctrlKey: event.ctrlKey === true,
        shiftKey: event.shiftKey === true,
        hasSelection: selection.hasSelection(),
        inOverlay: markers.isInsideOverlay(event.target),
        pickMode: false,
        editing: !!session,
        editState: !!editState && !session,
        blockMenuOpen: menuOpen,
        inBlock: event.type === "keydown" && !session ? caretInBlock() : undefined,
        inEditedBlock:
          !!session &&
          !!event.target &&
          (isRun() ? inSession(event.target) : session.block === event.target || session.block.contains(event.target))
      };
    }

    // Is the caret in a block Cmd-Shift-E can open? No caret, or a caret
    // sitting straight in body or main, is "in no block".
    function caretInBlock() {
      var el = selection.caretContainer();
      if (!el || markers.isInsideOverlay(el)) return false;
      return !!selection.blockFor(el);
    }

    function onKeydown(event) {
      if (markers.isInsideOverlay(event.target)) return;
      // Parked for onBeforeInput, which fires next and cannot see the modifiers
      // that produced it. Every key, not only Enter, so a stale Shift from an
      // earlier press cannot turn a later paragraph break into a line break.
      if (session) session.lastKey = { key: event.key, shiftKey: event.shiftKey === true };
      if (isRun() && onRunKeydown(event)) return;
      var got = gestures.gestureFor(describe(event));
      if (got.gesture === gestures.GESTURE.EDIT_BLOCK) {
        if (got.preventDefault) event.preventDefault();
        leaveEditState();
        editBlockAtCaret();
      } else if (got.gesture === gestures.GESTURE.ENTER_EDIT_STATE) {
        if (got.preventDefault) event.preventDefault();
        enterEditState();
      } else if (got.gesture === gestures.GESTURE.COMMIT_EDIT) {
        if (got.preventDefault) event.preventDefault();
        if (session) commit({ reason: event.key === "Escape" ? "escape" : "primary enter" });
        else leaveEditState();
      } else if (got.gesture === gestures.GESTURE.CLOSE_MENU) {
        if (got.preventDefault) event.preventDefault();
        closeMenu(true);
      }
    }

    /**
     * The pointer went down somewhere. If an edit is open and this is outside
     * it, that is the reviewer leaving the block, so it commits.
     *
     * DELIBERATELY NOT SKIPPED FOR THE OVERLAY. onClick below returns early on
     * anything inside the library's own rail, and a click on the rail retargets
     * to the overlay host, so an edit the reviewer finished by clicking the rail
     * stayed in `draft` forever. Status never offers drafts to an agent, so no
     * agent ever saw it and the reviewer had no way to tell (Ken's session,
     * 2026-08-16). Nothing is prevented and nothing is stopped here: the rail
     * and the page both still get their event.
     *
     * This is not the blur hazard rule 3 warns about. That hazard is the ELEMENT
     * blur that firing when contenteditable comes off would commit a second
     * time; commit() clears the session before it touches the DOM, so a second
     * call is a no-op, and this handler never runs while no session is open.
     */
    function onPointerDown(event) {
      if (!session) {
        // Edit state with no block open: a press on the rail leaves it. The
        // bar and the "+ Write here" line are the edit state's own.
        if (editState && markers.isInsideOverlay(event.target) && !onOwnFrame(event)) leaveEditState();
        return;
      }
      // THE ONE EXEMPTION: the edit frame's own bar (Bold, Italic, Delete
      // block). Those buttons act ON the open edit, so a pointer landing on one
      // is the reviewer still editing, not leaving. The bar lives in the
      // library's closed shadow root, so the event's target as the document
      // sees it is the overlay host and is no help; composedPath is what can
      // tell the frame's bar from the rest of the rail.
      if (onOwnFrame(event)) return;
      var got = gestures.gestureFor(describe(event));
      if (got.gesture !== gestures.GESTURE.COMMIT_EDIT) return;
      commit({ reason: "pointer outside" });
    }

    /**
     * The whole window lost focus: another window, another tab, the desktop.
     *
     * The reviewer has left the block by any reading, and leaving an edit open
     * across a tab switch is how one comes back to a page whose edit never
     * reached the agent. Guarded to the window's own blur: element blur does not
     * bubble, but a stray retarget must not be read as the reviewer leaving.
     */
    /**
     * Did this pointer land on the frame's own bar, which belongs to this edit?
     *
     * BY GEOMETRY, not by node identity. The bar lives in the library's CLOSED
     * shadow root, and a closed root is exactly what composedPath refuses to
     * reveal to a listener outside it, so from the document the target is the
     * overlay host and nothing distinguishes the bar from the rail. The bar's
     * rectangle does.
     */
    function onOwnFrame(event) {
      if (typeof event.clientX !== "number") return false;
      var inside = function (node) {
        if (!node || node.style.display === "none" || node.hidden) return false;
        var r = node.getBoundingClientRect();
        if (!r || (r.width === 0 && r.height === 0)) return false;
        return event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom;
      };
      if (lineNode && lineNode.getAttribute("data-lahe-show") === "true" && inside(lineNode)) return true;
      if (menuOpen && barParts && inside(barParts.menu)) return true;
      if (!barNode) return false;
      var rect = barNode.getBoundingClientRect();
      if (!rect || (rect.width === 0 && rect.height === 0)) return false;
      return (
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom
      );
    }

    function onWindowBlur(event) {
      if (!session) return;
      if (event && event.target && win && event.target !== win && event.target !== doc) return;
      commit({ reason: "window blur" });
    }

    function onClick(event) {
      if (markers.isInsideOverlay(event.target)) return;
      if (editState && !session) {
        // Edit state with no block open: a click on a block opens it.
        var clicked = selection.blockFor(event.target);
        if (clicked) {
          leaveEditState();
          editBlock(clicked);
        }
        return;
      }
      var got = gestures.gestureFor(describe(event));
      if (got.gesture !== gestures.GESTURE.COMMIT_EDIT) return;
      // The click still reaches the page. Browse is native, so clicking a link
      // while an edit is open both commits the edit and follows the link.
      commit({ reason: "click outside" });
    }

    function onUnload() {
      var committed = commit({ reason: "navigation" });
      // The record and its event are already durable in browser storage by the
      // time this line runs. The post is an attempt, not the guarantee: a body
      // over the keepalive cap, or an engine that drops the request, costs
      // latency and never the edit, because the next page load re-posts
      // anything the helper never acknowledged.
      if (sync && typeof sync.commitOnUnload === "function") sync.commitOnUnload();
      return committed;
    }

    function teardown() {
      unbind();
      unbindBlock();
      editState = false;
      if (session) {
        var open = session;
        session = null;
        closeBurstOf(open);
        if (open.mode === MODE.RUN) clearHostAttrs(open);
        else clearEditableAttrs(open.block);
        protect.release(open.block);
      }
      hideFrame();
      hideLine();
      hidePlaceholder();
      [frameNode, barNode, lineNode, placeholderNode, liveNode].forEach(function (node) {
        if (node && node.parentNode) node.parentNode.removeChild(node);
      });
      frameNode = null;
      barNode = null;
      barParts = null;
      lineNode = null;
      placeholderNode = null;
      liveNode = null;
      menuOpen = false;
      return true;
    }

    return {
      FRAME_CLASS: FRAME_CLASS,
      BAR_CLASS: BAR_CLASS,
      LABEL_EDITING: LABEL_EDITING,
      HINT_FINISH: HINT_FINISH,
      EDITABLE_ATTRS: EDITABLE_ATTRS,
      COMMANDS: COMMANDS,
      setReview: setReview,
      setPage: setPage,
      onChange: onChange,
      bind: bind,
      unbind: unbind,
      rebind: rebind,
      teardown: teardown,
      editBlock: editBlock,
      editBlockAtCaret: editBlockAtCaret,
      commit: commit,
      deleteBlock: deleteBlock,
      format: format,
      undo: undo,
      retire: retire,
      recoverWithdrawn: recoverWithdrawn,
      capture: capture,
      itemFor: itemFor,
      elementFor: elementFor,
      isEditing: function () {
        return !!session;
      },
      state: sessionInfo,
      frameRect: frameRect,
      frameLabel: frameLabel,
      buttonNode: buttonNode,
      barInfo: barInfo,
      // The anchor (unless it is a container) and the run, in order.
      sessionElements: function () {
        return session ? sessionBlocks() : [];
      },
      lineInfo: lineInfo,
      placeholderInfo: placeholderInfo,
      announcements: function () {
        return announced.slice();
      },
      liveText: function () {
        return liveNode ? liveNode.textContent : null;
      },
      enterEditState: enterEditState,
      leaveEditState: leaveEditState,
      isInEditState: function () {
        return !!editState && !session;
      },
      openAfter: openAfter,
      openEmptyPage: openEmptyPage,
      openMenu: function () {
        return openMenu(0);
      },
      closeMenu: closeMenu,
      setBlockType: function (tag) {
        return typeActions[tag] ? typeActions[tag]() : false;
      },
      typeActions: typeActions,
      historyStep: historyStep,
      counters: counters,
      items: function () {
        return store.read(requireReview());
      }
    };
  }

  return {
    FORMATTING_MECHANISM: FORMATTING_MECHANISM,
    FRAME_CLASS: FRAME_CLASS,
    BAR_CLASS: BAR_CLASS,
    FRAME_STYLE: FRAME_STYLE,
    COMMANDS: COMMANDS,
    BOOT_COMMANDS: BOOT_COMMANDS,
    EDITABLE_ATTRS: EDITABLE_ATTRS,
    LABEL_EDITING: LABEL_EDITING,
    HINT_FINISH: HINT_FINISH,
    MODE: MODE,
    HINT_EDIT_STATE: HINT_EDIT_STATE,
    INSERT_LINE_LABEL: INSERT_LINE_LABEL,
    PLACEHOLDER: PLACEHOLDER,
    CEILING_WARN: CEILING_WARN,
    CEILING_FULL: CEILING_FULL,
    CEILING_WARN_RATIO: CEILING_WARN_RATIO,
    ANNOUNCE: ANNOUNCE,
    FIRST_WORDS: FIRST_WORDS,
    SESSION_HISTORY_MAX: SESSION_HISTORY_MAX,
    TYPING_BURST_IDLE_MS: TYPING_BURST_IDLE_MS,
    counters: counters,
    TOOL_ATTR: markers.TOOL_ATTR,
    BREAK_SHAPE: BREAK_SHAPE,
    breakShapeFor: breakShapeFor,
    breakMarkup: breakMarkup,
    FORMAT_SHAPE: FORMAT_SHAPE,
    formatShapeFor: formatShapeFor,
    capture: capture,
    kindFor: kindFor,
    UNDO_ALREADY_TAKEN_BACK: UNDO_ALREADY_TAKEN_BACK,
    createEditing: createEditing
  };
});
