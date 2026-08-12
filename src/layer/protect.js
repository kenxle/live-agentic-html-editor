// The protection API: mark, veto, snapshot, restore, release.
//
// Owner: 2B. STUB committed by 0A-kernel: every signature is real, the state
// and the counters are real, and the DOM work is 2B's.
//
// D7's first half, and it ships with ALL THREE LAYERS or not at all. The
// archived round-two review proved restore-after alone cannot save the caret: a
// repaint destroys the text node the selection lives in before any observer
// fires, so by the time a restore runs there is nothing to restore to.
//
//   LAYER 1, cooperative skip. The block carries an attribute that morphing
//   libraries honor (Turbo's data-turbo-permanent, and the equivalent on 0C's
//   app fixture), so a cooperative framework leaves it alone.
//
//   LAYER 2, the pre-morph veto. Where the framework offers a cancelable event
//   before it replaces an element (Turbo's turbo:before-morph-element, and the
//   fixture's equivalent), the library cancels it for the protected block.
//
//   LAYER 3, snapshot and restore. The framework-free fallback for a repaint
//   that honors neither: the selection is snapshotted region-relative, and a
//   mutation observer restores it afterwards.
//
// Layers 1 and 2 are TWO DIFFERENT FRAMEWORK FEATURES. A builder can implement
// one and believe they did both, which is why they are named separately and
// tested separately.
//
// The snapshot is REGION-RELATIVE, never node-relative: a repaint destroys the
// text node, so a node reference restores nothing.
//
// Layer three gets its own assertion in the harness, not the node-identity one.
// It restores text after the repaint destroyed the node it lived in, so the
// caret is in a NEW node by construction and the node-identity assertion would
// fail for every correct implementation. What layer three's assertion checks
// instead: the text reads as expected, the caret sits at the same character
// offset inside the node now holding those characters, no characters were lost,
// and `counters.restores` incremented. That counter is real from Phase 0 so the
// assertion can be written before the layer exists.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.protect = factory(root.LAHE.markers, root.LAHE.selection);
  } else {
    module.exports = factory(require("../shared/markers.js"), require("./selection.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, selection) {
  "use strict";

  var LAYER = {
    COOPERATIVE_SKIP: "cooperative_skip",
    VETO: "veto",
    SNAPSHOT_RESTORE: "snapshot_restore"
  };
  var LAYERS = [LAYER.COOPERATIVE_SKIP, LAYER.VETO, LAYER.SNAPSHOT_RESTORE];

  // The counters the harness reads. Public and stable from Phase 0, because
  // ranked test 1 asserts them and a paused implementation would otherwise pass
  // every assertion in it.
  var counters = {
    marked: 0, // layer 1: blocks marked for cooperative skip
    vetoes: 0, // layer 2: morphs cancelled before they happened
    snapshots: 0, // layer 3: selections snapshotted
    restores: 0, // layer 3: selections restored after a repaint
    restoreFailures: 0 // layer 3 ran and could not put the caret back
  };

  function resetCounters() {
    Object.keys(counters).forEach(function (k) {
      counters[k] = 0;
    });
  }

  // Which element is protected right now, and the snapshot taken when it was.
  // One at a time: edit state is per region (D3), so a second mark releases the
  // first rather than nesting.
  var active = null;

  /**
   * LAYER 1. Marks el as the protected region: the library owns it until
   * release. 2B adds the cooperative-skip attributes here.
   *
   * @param {Element} el
   * @param {Object} options {reason}
   * @returns {Object} {element, layers, at}
   */
  function mark(el, options) {
    if (!el) throw new TypeError("protect.mark: an element is required");
    if (active && active.element !== el) release(active.element);
    counters.marked += 1;
    active = {
      element: el,
      reason: (options || {}).reason || null,
      at: Date.now(),
      snapshot: null,
      isStub: true
    };
    return active;
  }

  // True when el, or an ancestor of it, is the protected region. Replay asks
  // this before it writes anywhere.
  function isProtected(el) {
    if (!active || !el) return false;
    if (active.element === el) return true;
    return typeof active.element.contains === "function" && active.element.contains(el);
  }

  function protectedElement() {
    return active ? active.element : null;
  }

  /**
   * LAYER 2. The pre-morph veto. A framework's cancelable event handler calls
   * this with the element about to be replaced; a true return means the library
   * cancelled it.
   *
   * @param {Element} el the element the framework is about to replace
   * @param {Event} event the cancelable event, when there is one
   * @returns {boolean} true when the morph was vetoed
   */
  function veto(el, event) {
    if (!isProtected(el)) return false;
    counters.vetoes += 1;
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    return true;
  }

  /**
   * LAYER 3, first half. Snapshots the selection region-relative.
   *
   * @param {Element} regionEl
   * @returns {null|{regionRef, startOffset, endOffset, collapsed, text}}
   */
  function snapshot(regionEl) {
    var el = regionEl || protectedElement();
    if (!el) return null;
    counters.snapshots += 1;
    // STUB: 2B walks the region's text to compute a region-relative offset.
    // Returning an honest null-offset snapshot rather than a plausible fake:
    // a fake offset would restore the caret to the wrong character and look
    // like a working restore.
    var snap = {
      regionRef: null,
      startOffset: null,
      endOffset: null,
      collapsed: !selection.hasSelection(),
      text: typeof el.textContent === "string" ? el.textContent : "",
      isStub: true
    };
    if (active && active.element === el) active.snapshot = snap;
    return snap;
  }

  /**
   * LAYER 3, second half. Restores a snapshot after the repaint.
   *
   * @param {Object} snap
   * @param {Element} regionEl
   * @returns {boolean} true when the caret landed where the snapshot said
   */
  function restore(snap, regionEl) {
    void snap;
    void regionEl;
    // STUB: 2B walks to the character offset and sets the range. Counting the
    // failure rather than the success is deliberate for the stub: nothing has
    // been restored, and a counter that incremented would make layer three's
    // assertion pass against an engine that does nothing.
    counters.restoreFailures += 1;
    return false;
  }

  /**
   * Lifts protection. On release the commit runs and 2C's replay pass runs
   * immediately, so a change the page tried to make to the block while it was
   * protected surfaces through replay's neither-matches branch rather than
   * being silently swallowed. 2C owns that seam; 2B calls it.
   *
   * @param {Element} el
   * @returns {boolean} true when something was released
   */
  function release(el) {
    if (!active) return false;
    if (el && active.element !== el) return false;
    active = null;
    return true;
  }

  return {
    LAYER: LAYER,
    LAYERS: LAYERS,
    counters: counters,
    resetCounters: resetCounters,
    mark: mark,
    isProtected: isProtected,
    protectedElement: protectedElement,
    veto: veto,
    snapshot: snapshot,
    restore: restore,
    release: release,
    isStub: true
  };
});
