// The caret and selection accessor.
//
// Owner: Task 2A-i (text and records). STUB: the signatures are real and
// committed so the rail (1B-i), replay (2B), and click interception (2D) can
// call them today; the bodies are 2A-i's to fill in.
//
// One accessor, because three tasks need to answer "where is the caret" and
// three implementations of that question is three different answers on the same
// page. Replay in particular has to know whether the caret is inside a region
// before it does anything (architecture D3), and after D3's protected-region
// decision that check is a container test rather than an offset restore, so it
// has to be cheap and exact.
//
// The stub returns "no selection" honestly rather than a plausible fake,
// because a fake caret position would make replay believe a region is safe to
// rewrite.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;

  var NOT_IMPLEMENTED = "not implemented yet: Task 2A-i owns src/layer/selection.js";

  // A region-relative snapshot. Region-relative rather than node-relative on
  // purpose: a repaint destroys the text node, so a node reference restores
  // nothing. See the Round 2 review's failing walk.
  //
  // @returns {null|{regionRef, startOffset, endOffset, collapsed, text}}
  function snapshot(regionEl) {
    void regionEl;
    return null;
  }

  // Restores a snapshot taken by snapshot(). Returns true when the caret landed
  // where the snapshot said. Under D3 this is a fallback, not the mechanism:
  // the region being edited is protected, so nothing repaints under the caret
  // in the first place.
  //
  // @returns {boolean}
  function restore(snap, regionEl) {
    void snap;
    void regionEl;
    return false;
  }

  // The element the caret currently sits inside, or null. Replay's Law 2 check
  // is "is this region, or an ancestor of it, the caret holder".
  //
  // @returns {null|Element}
  function caretContainer() {
    return null;
  }

  // True when the caret or a selection is inside el (or el itself).
  //
  // @returns {boolean}
  function containsCaret(el) {
    void el;
    return false;
  }

  // True when there is a non-collapsed selection.
  //
  // @returns {boolean}
  function hasSelection() {
    return false;
  }

  // The selected text, normalized on the way out by the one normalizer. Used to
  // mint a comment's quote.
  //
  // @returns {string}
  function selectedText() {
    return "";
  }

  // Places the caret at the start of el. Law 3's undo path calls this
  // deliberately, which is the one time the layer moves the caret on the
  // reviewer's behalf.
  function placeCaretAtStart(el) {
    void el;
    return false;
  }

  var api = {
    NOT_IMPLEMENTED: NOT_IMPLEMENTED,
    snapshot: snapshot,
    restore: restore,
    caretContainer: caretContainer,
    containsCaret: containsCaret,
    hasSelection: hasSelection,
    selectedText: selectedText,
    placeCaretAtStart: placeCaretAtStart,
    isStub: true
  };

  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.selection = api;
  } else {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
