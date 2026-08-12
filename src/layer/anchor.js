// The anchor engine: mint a region reference, resolve it in a changed document.
//
// Owner: Task 1C. STUB: the signatures are real and committed. mint returns a
// reference with every field the record expects; resolve returns a UNIQUE MATCH
// on the single-candidate case so downstream tasks can run end to end, and
// otherwise defers to the shared uniqueness predicate.
//
// The swap 1C makes is one line inside resolve(): replace stubCandidates() with
// the real DOM candidate search. Everything else, including the whole decision
// about whether to write, already lives in src/shared/uniqueness.js and does
// not move.
//
// This is new work, not a port. The built-doc comment module's locate() is four
// exact substring probes over the concatenated text, with no whitespace
// tolerance and no occurrence disambiguation, so a short prefix binds to the
// first hit. R16 is not met by it.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.anchor = factory(root.LAHE.normalize, root.LAHE.uniqueness, root.LAHE.regions);
  } else {
    module.exports = factory(
      require("../shared/normalize.js"),
      require("../shared/uniqueness.js"),
      require("../shared/regions.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize, uniqueness, regions) {
  "use strict";

  // How much text is kept on either side of a region as its disambiguating
  // context. Long enough that two identical paragraphs in different places are
  // told apart, short enough that an ordinary edit nearby does not invalidate
  // it. 1C may move this number; it may not move it per call site.
  var CONTEXT_CHARS = 120;

  // The reference shape. Every field is named here so the record module's
  // region.ref has a documented interior even while resolve is a stub.
  //
  //   id        stable, minted once at first touch, never recomputed
  //   probe     the region's normalized text at mint time. The only signal
  //             allowed to place a write
  //   prefix    up to CONTEXT_CHARS of normalized text before the region
  //   suffix    up to CONTEXT_CHARS of normalized text after the region
  //   path      a structural path (tag chain plus ordinals). CORROBORATION
  //             ONLY, per D3 Law 1. It never places a write
  //   heading   the nearest preceding heading's normalized text, corroboration
  //   attr      the author-supplied data-review-region value, when present
  //   minted_at iso timestamp
  //
  // Identity is this reference. It is never the display label; see
  // src/shared/regions.js.
  function emptyRef() {
    return {
      id: null,
      probe: null,
      prefix: null,
      suffix: null,
      path: null,
      heading: null,
      attr: null,
      minted_at: null
    };
  }

  /**
   * Mints a durable reference from a live element or range.
   *
   * @param {Object} input {element, range, root}
   * @returns {Object} a reference, shape above
   */
  function mint(input) {
    var el = input && input.element ? input.element : null;
    var text = el && typeof el.textContent === "string" ? el.textContent : "";
    var ref = emptyRef();
    ref.id = "ref_" + Math.random().toString(16).slice(2, 14);
    ref.probe = normalize.normalizeText(text);
    ref.prefix = null;
    ref.suffix = null;
    ref.path = null;
    ref.heading = null;
    ref.attr = el && typeof el.getAttribute === "function" ? el.getAttribute(regions.AUTHOR_ATTR) : null;
    ref.minted_at = new Date().toISOString();
    return ref;
  }

  // THE ONE LINE 1C REPLACES.
  //
  // The real version walks `root` and returns one candidate descriptor per
  // plausible region, in document order, with match, prefix, suffix, structure,
  // and heading filled in. The stub returns exactly one exact candidate, so a
  // downstream caller gets a unique bind and can be built against a working
  // resolve.
  function stubCandidates(ref, root) {
    void root;
    return [
      {
        key: ref && ref.id ? ref.id : "stub",
        match: uniqueness.MATCH.EXACT,
        prefix: ref ? ref.prefix : null,
        suffix: ref ? ref.suffix : null,
        structure: false,
        heading: false
      }
    ];
  }

  /**
   * Re-resolves a reference against the current document.
   *
   * Identity is minted once and RE-RESOLVED ON EVERY REPAINT. Anything stored
   * on the node itself, an attribute or a WeakMap key, does not survive a
   * morph, so "the reference travels with the region" is false across a repaint
   * and a builder who believes it implements the wrong thing.
   *
   * The decision about whether the result may be written is not made here. It
   * is made by src/shared/uniqueness.js, which is the same decision replay
   * makes, which is the point.
   *
   * @param {Object} ref a reference from mint()
   * @param {Node} root the subtree to search
   * @returns {Object} the uniqueness result, plus `element` when bound
   */
  function resolve(ref, root) {
    var candidates = stubCandidates(ref, root);
    var verdict = uniqueness.selectUnique(candidates, ref || {});
    verdict.element = null; // 1C sets this from the winning candidate's node
    return verdict;
  }

  return {
    CONTEXT_CHARS: CONTEXT_CHARS,
    emptyRef: emptyRef,
    mint: mint,
    resolve: resolve,
    isStub: true
  };
});
