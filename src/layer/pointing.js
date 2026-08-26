// Where a comment POINTS when its words are gone.
//
// This module exists because of one sentence in anchor.js, which is still true
// and is not being softened here:
//
//   "A reader who finds a scalar in here should treat it as a bug: the
//    dangerous anchoring errors are not low-confidence, they are
//    high-confidence ambiguous."
//
// That is about WRITES, and it is right about writes. uniqueness.js records the
// case that killed the earlier scored draft: two visually identical list items
// that swapped places match exactly, have symmetric context, and score high on
// any plausible scalar, so replay writes each record into the other's node. No
// score survives that, so replay does not get one. Nothing in this file is
// reachable from replay, and nothing in this file may ever place a write.
//
// A COMMENT IS NOT A WRITE. It paints a highlight and it scrolls the page. When
// it is wrong the reviewer sees a mark in the wrong place and moves on; nothing
// is overwritten and nothing is lost. That asymmetry is the whole justification
// for this file: the cost of a wrong answer is different, so the bar for an
// answer is different.
//
// What it is for, in the reviewer's words (Ken, 2026-08-26, after a comment lost
// its place on a page whose text had been rewritten):
//
//   "we need some way to fingerprint an element. surrounding elements? a dom
//    walk up through it's parents? a combo of class names, ids, dom parents?
//    like how do we make a good fingerprint for something, especially something
//    we might be about to change."
//
// The last clause is the design. If an agent is about to rewrite a passage, the
// passage's words are the worst possible identifier for it. What survives an
// edit is what the author wrote AROUND it: the element's own class, the classes
// of its parents, its position among things that look like it. anchor.js mints
// all of that into ref.fingerprint and never reads it back. This is where it is
// read.
//
// THE MARGIN IS THE POINT, not the weights. The weights below order candidates;
// they are not probabilities and tuning them is not how this is made correct.
// What makes it honest is that a winner has to beat the runner-up by a clear
// margin. Two candidates that score 71 and 70 are the swapped-list-items case
// wearing a number, and this returns nothing for them, exactly as the strict
// predicate would.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.pointing = factory(root.LAHE.anchor, root.LAHE.normalize);
  } else {
    module.exports = factory(require("./anchor.js"), require("../shared/normalize.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (anchor, normalize) {
  "use strict";

  // What each signal is worth when it agrees. Ordering hints, not probabilities.
  //
  // The two at the top are decisive on their own because they are IDENTITY the
  // author wrote down: a data-review-region is a name someone chose for this
  // region, and an id is supposed to be unique in the document. Everything below
  // them is circumstantial and has to be corroborated by something else to
  // clear the floor.
  var WEIGHT = {
    AUTHOR_ATTR: 100,
    ELEMENT_ID: 90,
    // Classes are the strongest circumstantial signal in a real codebase,
    // because a class like st-door-card__pill lives in somebody's template and
    // survives every rebuild of it.
    CLASSES: 40,
    // The walk up through the parents Ken asked about. Scored by how many
    // levels still agree, so a wrapper inserted at the top costs one level
    // rather than the whole chain.
    CHAIN: 30,
    PREFIX: 15,
    SUFFIX: 15,
    HEADING: 10,
    // A tag match is true of hundreds of elements. It is here so that a span and
    // a div are not interchangeable, and it is too small to decide anything.
    TAG: 5,
    // POSITION IS NOT IDENTITY, and these two are kept out of the score for a
    // reason that cost this file a rewrite. Given two identical rows that SWAPPED
    // PLACES, position is not merely weak evidence, it is evidence pointing
    // confidently at the wrong one: the row now standing where the original stood
    // is the other row. Scored together with everything else, that produced a
    // clear winner and it was the wrong element, which is the exact outcome
    // uniqueness.js refuses. So they order candidates that are otherwise equally
    // good, and they can never promote one past the margin.
    PATH: 20,
    ORDINAL: 5
  };

  // A winner must clear FLOOR and beat the runner-up by MARGIN, both measured on
  // IDENTITY alone. The floor is set above what the circumstantial signals reach
  // without agreeing on something the author wrote: a chain match plus a heading
  // is 40, and a candidate that shares no name with the original should not be
  // pointed at.
  var FLOOR = 55;
  var MARGIN = 20;

  function textish(value) {
    return typeof value === "string" && value ? normalize.normalizeText(value) : "";
  }

  /** The same one-sided containment the strict predicate uses for context. */
  function contextAgrees(stored, found) {
    var a = textish(stored);
    var b = textish(found);
    if (!a || !b) return false;
    return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
  }

  function overlap(storedList, foundList) {
    var stored = Array.isArray(storedList) ? storedList : [];
    var found = Array.isArray(foundList) ? foundList : [];
    if (!stored.length || !found.length) return 0;
    var shared = 0;
    for (var i = 0; i < stored.length; i += 1) {
      if (found.indexOf(stored[i]) !== -1) shared += 1;
    }
    // Jaccard: sharing one class out of one beats sharing one out of nine.
    var union = stored.length + found.length - shared;
    return union > 0 ? shared / union : 0;
  }

  function chainAgreement(storedChain, foundChain) {
    var stored = Array.isArray(storedChain) ? storedChain : [];
    var found = Array.isArray(foundChain) ? foundChain : [];
    if (!stored.length || !found.length) return 0;
    var depth = Math.min(stored.length, found.length);
    var score = 0;
    for (var i = 0; i < depth; i += 1) {
      var a = stored[i] || {};
      var b = found[i] || {};
      if (a.tag !== b.tag) continue;
      // A level agrees on its tag, and more so when it agrees on its classes.
      score += 0.5 + 0.5 * overlap(a.classes, b.classes);
    }
    return score / stored.length;
  }

  /**
   * How much this node looks like the element the reference was minted from.
   *
   * Every signal is optional. A reference minted before fingerprints existed
   * carries none of them and scores on context and path alone, which is the
   * honest amount of evidence it has.
   */
  function scoreAgainst(ref, node, scope) {
    var reference = ref || {};
    var print = reference.fingerprint || {};
    var found = anchor.fingerprintOf(node, scope) || {};
    var score = 0;
    var position = 0;
    var reasons = [];

    function add(points, why) {
      if (points <= 0) return;
      score += points;
      reasons.push(why);
    }

    var attr = textish(reference.attr);
    if (attr && attr === textish(anchor.attrOf(node, anchor.AUTHOR_ATTR))) {
      add(WEIGHT.AUTHOR_ATTR, "author region name");
    }
    if (print.element_id && print.element_id === found.element_id) {
      add(WEIGHT.ELEMENT_ID, "id");
    }
    add(Math.round(WEIGHT.CLASSES * overlap(print.classes, found.classes)), "classes");
    add(Math.round(WEIGHT.CHAIN * chainAgreement(print.chain, found.chain)), "parents");
    if (reference.path && reference.path === anchor.pathOf(node, scope)) {
      position += WEIGHT.PATH;
    }
    var context = anchor.foundContextFor(node, scope, reference);
    if (contextAgrees(reference.prefix, context.prefix)) add(WEIGHT.PREFIX, "text before");
    if (contextAgrees(reference.suffix, context.suffix)) add(WEIGHT.SUFFIX, "text after");
    if (reference.heading && reference.heading === anchor.headingOf(node, scope)) {
      add(WEIGHT.HEADING, "under the same heading");
    }
    if (print.tag && print.tag === found.tag) add(WEIGHT.TAG, "same kind of element");
    if (print.ordinal && print.ordinal === found.ordinal) position += WEIGHT.ORDINAL;

    return { score: score, position: position, reasons: reasons };
  }

  /**
   * Where this comment should point, when its words no longer find anything.
   *
   * Returns {element, score, runnerUp, reasons} on a confident single winner,
   * and {element: null} otherwise. "Otherwise" includes the case that matters:
   * two candidates within MARGIN of each other. A near-tie is not a weak answer
   * to be reported with a caveat, it is the shape of the error this whole design
   * refuses, so it produces no answer at all.
   */
  function bestGuess(ref, root) {
    var reference = ref || {};
    if (!reference.fingerprint && !reference.path && !reference.attr) return { element: null };
    var scope = anchor.scopeOf(root, null);
    if (!scope) return { element: null };

    var scored = [];
    anchor.eachElement(scope, function (node) {
      var got = scoreAgainst(reference, node, scope);
      if (got.score <= 0) return;
      scored.push({ node: node, score: got.score, position: got.position, reasons: got.reasons });
    });
    if (!scored.length) return { element: null };

    // Identity first. Position only orders candidates identity could not
    // separate, and the margin below is measured on identity, so ordering by it
    // can never be what makes a winner.
    scored.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      return b.position - a.position;
    });
    var top = scored[0];
    var next = scored.length > 1 ? scored[1] : null;
    if (top.score < FLOOR) return { element: null, score: top.score, runnerUp: next ? next.score : 0 };
    if (next && top.score - next.score < MARGIN) {
      return { element: null, score: top.score, runnerUp: next.score };
    }
    return {
      element: top.node,
      score: top.score,
      runnerUp: next ? next.score : 0,
      reasons: top.reasons
    };
  }

  return {
    WEIGHT: WEIGHT,
    FLOOR: FLOOR,
    MARGIN: MARGIN,
    scoreAgainst: scoreAgainst,
    bestGuess: bestGuess
  };
});
