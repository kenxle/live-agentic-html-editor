// The edit recorder, and the tool-added-node marker in use.
//
// Owner: Task 2A-i. STUB: real signatures, no DOM.
//
// ---------------------------------------------------------------------------
// The formatting mechanism decision (plan Task 0a: "two builders will otherwise
// guess differently")
// ---------------------------------------------------------------------------
//
// DECIDED: document.execCommand, with normalization on capture.
//
// Reasoning, given Chromium only for v1:
//
//  - execCommand is deprecated and still implemented, and Chromium's
//    implementation handles the selection cases that are the actual work:
//    a selection that starts inside a <strong> and ends outside it, a partial
//    selection across an inline boundary, list creation across three
//    paragraphs, unlinking part of a link. Manual range surgery for R24 (bold,
//    italic, links, bulleted and numbered lists) is a week of edge cases, and
//    the ones it gets wrong are silent.
//  - Its known defect is dirty markup: <b> where you wanted <strong>, nested
//    spans, and inline styles. Every one of those is something cleanMarkup
//    already normalizes, because it has to normalize the page author's markup
//    anyway. So the cost of the dirty output is a function that already exists.
//  - The one setting that matters: call
//        document.execCommand("styleWithCSS", false, false)
//    once at boot, so Chromium emits tags rather than style attributes. R35
//    forbids the tool writing a style attribute onto a reviewed element, and
//    styleWithCSS true would do exactly that on every bold.
//
// Escape hatch, stated so it is a decision rather than a drift: if one gesture
// produces markup cleanMarkup cannot canonicalize, that GESTURE gets manual
// range surgery and the exception is recorded in the progress doc. The default
// stays execCommand. What is not allowed is a second builder quietly
// implementing the same gesture the other way.
//
// ---------------------------------------------------------------------------
// The rest of this file's contract
// ---------------------------------------------------------------------------
//
//  - The `after` snapshot is taken on compositionend, not on every input event,
//    so a send during IME composition cannot ship half-composed text as the
//    reviewer's exact wording (D4).
//  - spellcheck, autocorrect, and autocapitalize are off on the editable
//    surface, so the platform cannot quietly rewrite a word and have it
//    recorded as the reviewer's intent.
//  - `before` is captured on FIRST TOUCH and never again, however many times
//    the reviewer retypes (R28).
//  - No layer markup ever reaches a payload (R33): every capture goes through
//    cleanMarkup.
//  - A gesture that crosses regions decomposes into one record per region tied
//    by a group id, applied atomically (D3).
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.editing = factory(root.LAHE.normalize, root.LAHE.record, root.LAHE.markers, root.LAHE.epoch);
  } else {
    module.exports = factory(
      require("../shared/normalize.js"),
      require("../shared/record.js"),
      require("../shared/markers.js"),
      require("../shared/epoch.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize, record, markers, epoch) {
  "use strict";

  var FORMATTING_MECHANISM = "execCommand";

  // The commands R24 allows, and nothing else. An enum rather than a
  // pass-through string, so a builder cannot reach a command this tool never
  // decided to support.
  var COMMANDS = {
    bold: "bold",
    italic: "italic",
    createLink: "createLink",
    unlink: "unlink",
    insertUnorderedList: "insertUnorderedList",
    insertOrderedList: "insertOrderedList"
  };

  // Run once at boot, before any formatting command.
  var BOOT_COMMANDS = [
    { command: "styleWithCSS", value: false, why: "emit tags, never style attributes. R35" },
    { command: "defaultParagraphSeparator", value: "p", why: "Enter makes a paragraph, not a div" }
  ];

  // Set on the editable surface. D4: the platform must not be able to rewrite a
  // word and have it recorded as the reviewer's intent.
  var EDITABLE_ATTRS = {
    contenteditable: "true",
    spellcheck: "false",
    autocorrect: "off",
    autocapitalize: "off",
    // Chromium honors this on contenteditable and it removes the format bar
    // that would otherwise appear over the reviewed page.
    "data-gramm": "false"
  };

  // Captures a region's plain text and cleaned markup, through the one
  // normalizer and the one markup cleaner. Every capture in the layer goes
  // through here; a direct textContent read in a record path is a bug.
  //
  // STUB: returns nulls. 2A-i reads from the element.
  function capture(regionEl) {
    void regionEl;
    return { text: null, html: null, isStub: true };
  }

  // Records the first touch of a region. `before` is captured once, here, and
  // never recaptured (R28).
  function touch(regionEl, context) {
    void regionEl;
    void context;
    return { isStub: true };
  }

  // Commits the edit on blur. D3: this is the seam where protection drops and
  // the region rejoins the page.
  function commit(regionEl) {
    void regionEl;
    return { item: null, isStub: true };
  }

  // Applies a formatting command inside a write epoch. The epoch wrapper is not
  // optional: execCommand mutates the DOM, and an unwrapped mutation schedules a
  // replay pass that then sees its own change.
  function format(command, value) {
    if (!Object.prototype.hasOwnProperty.call(COMMANDS, command)) {
      throw new Error("editing.format: " + String(command) + " is not one of the commands R24 allows");
    }
    return epoch.write("editing.format:" + command, function () {
      return { command: command, value: value === undefined ? null : value, applied: false, isStub: true };
    });
  }

  // Per-item undo, as a RECORD operation (D4). Reverts the record and lets
  // replay redraw. Native browser undo inside a protected region works normally
  // and is a convenience on top; it is not the mechanism, because once replay
  // has rewritten a region the browser's undo stack for it is gone.
  function undo(itemId) {
    void itemId;
    return { reverted: false, isStub: true };
  }

  // A gesture crossing regions mints one record per touched region, tied by a
  // group id, applied atomically. One record holding merged text means replay
  // rewrites the first region and leaves the second standing, the page shows
  // the content twice, and the agent is told to duplicate it in source.
  function decomposeCrossRegion(regionEls) {
    var group = record.randomId("grp");
    return (regionEls || []).map(function () {
      return { group: group, isStub: true };
    });
  }

  return {
    FORMATTING_MECHANISM: FORMATTING_MECHANISM,
    COMMANDS: COMMANDS,
    BOOT_COMMANDS: BOOT_COMMANDS,
    EDITABLE_ATTRS: EDITABLE_ATTRS,
    TOOL_ATTR: markers.TOOL_ATTR,
    capture: capture,
    touch: touch,
    commit: commit,
    format: format,
    undo: undo,
    decomposeCrossRegion: decomposeCrossRegion,
    normalize: normalize,
    isStub: true
  };
});
