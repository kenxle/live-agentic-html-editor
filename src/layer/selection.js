// The caret and selection accessor.
//
// Owner: 0A-kernel, and FROZEN AT CP0. 2A (editing) and 2B (protection) both
// read it and neither owns it, so a change goes through the orchestrator.
//
// One accessor, because three tasks need to answer "where is the caret" and
// three implementations of that question are three different answers on the
// same page. Protection in particular has to know whether the caret is inside
// a region before anything is allowed to write there (D7), so the check has to
// be cheap and exact.
//
// WHAT IS DELIBERATELY NOT HERE: the selection snapshot and restore. That is
// protection's third layer, it carries its own counter, and it lives in
// src/layer/protect.js, which 2B owns. Putting it here would give this frozen
// file a second writer, which is the thing freezing it exists to prevent.
//
// Everything below is a read. Nothing in this file moves the caret except
// placeCaretAtStart, which the per-record undo path calls deliberately: it is
// the one time the library moves the caret on the reviewer's behalf.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.selection = factory(root.LAHE.normalize);
  } else {
    module.exports = factory(require("../shared/normalize.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize) {
  "use strict";

  // Every function reads the selection through this one call, so a document
  // that has none (a Node process, a detached document) returns honestly rather
  // than throwing halfway down a caller.
  function currentSelection() {
    if (typeof window === "undefined" || !window.getSelection) return null;
    var sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    return sel;
  }

  function currentRange() {
    var sel = currentSelection();
    return sel ? sel.getRangeAt(0) : null;
  }

  // The node the caret sits in, text node and all. Returned raw because
  // assertCaretSurvivesTyping compares the caret's text node BY IDENTITY, and
  // an accessor that helpfully returned the parent element would make that
  // assertion untestable.
  //
  // @returns {null|Node}
  function caretNode() {
    var range = currentRange();
    return range ? range.startContainer : null;
  }

  // The nearest ELEMENT the caret sits inside, or null.
  //
  // @returns {null|Element}
  function caretContainer() {
    var node = caretNode();
    if (!node) return null;
    if (node.nodeType === 1) return node;
    return node.parentElement || null;
  }

  // The caret's offset inside its own node. Layer three's assertion reads this:
  // after a restore the node is new by construction, so the offset inside the
  // node now holding those characters is the only thing left to compare.
  //
  // @returns {null|number}
  function caretOffset() {
    var range = currentRange();
    return range ? range.startOffset : null;
  }

  // True when the caret or a selection is inside el (or is el itself). This is
  // the protection check: nothing writes to a region the reviewer is in.
  //
  // @returns {boolean}
  function containsCaret(el) {
    if (!el || typeof el.contains !== "function") return false;
    var node = caretNode();
    if (!node) return false;
    return el === node || el.contains(node);
  }

  // True when there is a non-collapsed selection.
  //
  // @returns {boolean}
  function hasSelection() {
    var sel = currentSelection();
    return !!sel && !sel.isCollapsed;
  }

  // The selected text, normalized on the way out by the one normalizer. This is
  // what mints a comment's quote, which is why it must not have its own
  // whitespace rules.
  //
  // @returns {string}
  function selectedText() {
    var sel = currentSelection();
    if (!sel || sel.isCollapsed) return "";
    return normalize.normalizeText(String(sel));
  }

  // The live range, for a caller that needs to paint a highlight over it (1D)
  // or mint an anchor from it (1C). Returned as a clone so a caller cannot
  // mutate the reviewer's own selection by accident.
  //
  // @returns {null|Range}
  function selectedRange() {
    var range = currentRange();
    return range ? range.cloneRange() : null;
  }

  // The block-level element a gesture applies to: the nearest ancestor that is
  // a block the reviewer would recognize as "this paragraph". Cmd-Shift-E makes
  // exactly this element editable, and nothing else.
  //
  // @returns {null|Element}
  var BLOCK_TAGS = [
    "P", "LI", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "TD", "TH",
    "DD", "DT", "FIGCAPTION", "PRE", "DIV", "SECTION", "ARTICLE"
  ];

  function blockFor(el) {
    var node = el || caretContainer();
    while (node && node.nodeType === 1) {
      if (BLOCK_TAGS.indexOf(node.tagName) !== -1) return node;
      node = node.parentElement;
    }
    return null;
  }

  // Places the caret at the start of el. The per-record undo path calls this
  // deliberately; nothing else may.
  //
  // @returns {boolean} true when the caret landed
  function placeCaretAtStart(el) {
    if (!el || typeof document === "undefined" || !document.createRange) return false;
    var sel = typeof window !== "undefined" && window.getSelection ? window.getSelection() : null;
    if (!sel) return false;
    var range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  return {
    BLOCK_TAGS: BLOCK_TAGS,
    currentSelection: currentSelection,
    currentRange: currentRange,
    caretNode: caretNode,
    caretContainer: caretContainer,
    caretOffset: caretOffset,
    containsCaret: containsCaret,
    hasSelection: hasSelection,
    selectedText: selectedText,
    selectedRange: selectedRange,
    blockFor: blockFor,
    placeCaretAtStart: placeCaretAtStart
  };
});
