// The uniqueness predicate: architecture D3, Law 1.
//
// Owner: Task 0a (shared kernel). Imported by: the anchor engine (1C) and
// replay (2B). Neither may implement its own version of this decision.
//
// "A write needs a unique candidate, not a high score." An earlier draft had
// the anchor engine return a confidence and replay threshold it. That is a
// fiction that gets tuned into meaninglessness, and it fails on the case that
// matters: two visually identical list items that swapped places match exactly,
// have symmetric context, and score high on any plausible scalar, so replay
// binds each record confidently to the other's node. The dangerous errors are
// not low-confidence, they are high-confidence ambiguous.
//
// So this is a predicate with no tunable number in it:
//
//   1. Candidates found only by structure are not eligible. Structure and
//      heading position corroborate a candidate; they never place a write.
//   2. Zero eligible candidates: no bind. The record keeps its text and the
//      card says it cannot be placed here.
//   3. Exactly one eligible candidate: bind.
//   4. More than one: keep only the candidates whose prefix AND suffix context
//      match the record's. If exactly one survives, bind. Anything else,
//      including a tie of two perfect matches, fails closed.
//
// Corroboration (structure path, heading) is recorded on the result and never
// changes the verdict. A caller that finds itself reading `corroboration` to
// decide whether to write has reintroduced the score.
//
// The engine that produces candidates is 1C's job. This module takes candidate
// DESCRIPTORS, which makes the whole decision unit-testable with no DOM and
// gives 1C a fixture corpus it is judged against (test/fixtures/
// uniqueness_corpus.js).
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.uniqueness = factory(root.LAHE.normalize);
  } else {
    module.exports = factory(require("./normalize.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize) {
  "use strict";

  // How a candidate was found. Only TEXT and TEXT_NORMALIZED are eligible to
  // place a write.
  var MATCH = {
    // The candidate's normalized text equals the probe exactly.
    EXACT: "exact",
    // The candidate's normalized text contains the probe, or vice versa. Still
    // a text match, so still eligible: this is the rewrapped and reformatted
    // case that R16 requires to bind.
    CONTAINS: "contains",
    // Found by the structural path or by an author-supplied region attribute
    // only. Corroborating evidence, never a placement.
    STRUCTURE: "structure"
  };

  var REASON = {
    UNIQUE: "unique",
    CONTEXT_ELIMINATED_RIVALS: "context_eliminated_rivals",
    NO_TEXT_MATCH: "no_text_match",
    AMBIGUOUS: "ambiguous",
    STRUCTURE_ONLY: "structure_only"
  };

  // Maps a non-binding reason to the failure code the card shows. Keeping the
  // mapping here means the anchor engine and replay cannot disagree about what
  // the reviewer is told.
  var REASON_FAILURE_CODE = {
    no_text_match: "ANCHOR_NO_TEXT_MATCH",
    ambiguous: "ANCHOR_AMBIGUOUS",
    structure_only: "ANCHOR_STRUCTURE_ONLY"
  };

  function isEligible(candidate) {
    return candidate.match === MATCH.EXACT || candidate.match === MATCH.CONTAINS;
  }

  // Context comparison is normalized and one-sided-tolerant: a repaint can
  // legitimately shorten the text on either side of a region (a sibling was
  // removed) without the region itself moving. So a stored context matches when
  // one of the two normalized strings contains the other. An empty stored
  // context (the region was first or last on the page) matches anything, which
  // is why an empty context can never be the thing that eliminates a rival.
  function contextMatches(stored, found) {
    if (stored === null || stored === undefined || stored === "") return true;
    if (found === null || found === undefined || found === "") return false;
    var a = normalize.normalizeText(String(stored));
    var b = normalize.normalizeText(String(found));
    if (!a) return true;
    if (!b) return false;
    return a === b || a.indexOf(b) !== -1 || b.indexOf(a) !== -1;
  }

  /**
   * @param {Array<Object>} candidates each:
   *   {
   *     key:      anything the caller uses to identify the candidate (a node,
   *               an index, an id). Returned untouched on a bind.
   *     match:    one of MATCH
   *     prefix:   the text immediately before the candidate, or null
   *     suffix:   the text immediately after the candidate, or null
   *     structure: true when the structural path also pointed here
   *     heading:   true when the candidate sits under the record's heading
   *   }
   * @param {Object} reference the record's stored region reference:
   *   { prefix, suffix }
   * @returns {Object}
   *   {
   *     bound:   boolean
   *     key:     the winning candidate's key, or null
   *     reason:  one of REASON
   *     failureCode: a failures.js code when not bound, else null
   *     considered: how many candidates were eligible
   *     survivors:  how many survived context elimination
   *     corroboration: {structure, heading} for the winner, diagnostic only
   *   }
   */
  function selectUnique(candidates, reference) {
    if (!Array.isArray(candidates)) {
      throw new TypeError("selectUnique expects an array of candidates");
    }
    var ref = reference || {};

    var eligible = candidates.filter(isEligible);

    if (!eligible.length) {
      var sawStructure = candidates.length > 0;
      var reason = sawStructure ? REASON.STRUCTURE_ONLY : REASON.NO_TEXT_MATCH;
      return result(false, null, reason, 0, 0, null);
    }

    if (eligible.length === 1) {
      return result(true, eligible[0].key, REASON.UNIQUE, 1, 1, eligible[0]);
    }

    var survivors = eligible.filter(function (c) {
      return contextMatches(ref.prefix, c.prefix) && contextMatches(ref.suffix, c.suffix);
    });

    if (survivors.length === 1) {
      return result(
        true,
        survivors[0].key,
        REASON.CONTEXT_ELIMINATED_RIVALS,
        eligible.length,
        1,
        survivors[0]
      );
    }

    // Zero survivors and two survivors are the same verdict: fail closed. A
    // "best" survivor is exactly the scalar this predicate exists to refuse.
    return result(false, null, REASON.AMBIGUOUS, eligible.length, survivors.length, null);
  }

  function result(bound, key, reason, considered, survivors, winner) {
    return {
      bound: bound,
      key: bound ? key : null,
      reason: reason,
      failureCode: bound ? null : REASON_FAILURE_CODE[reason] || "ANCHOR_NO_TEXT_MATCH",
      considered: considered,
      survivors: survivors,
      corroboration: winner
        ? { structure: winner.structure === true, heading: winner.heading === true }
        : { structure: false, heading: false }
    };
  }

  // ---------------------------------------------------------------------------
  // A reference candidate builder
  // ---------------------------------------------------------------------------
  //
  // Pure, over a document expressed as an ordered array of block texts. It is
  // what makes the fixture corpus runnable in Phase 0, before any DOM code
  // exists. Task 1C produces the same descriptors from real nodes and feeds
  // them to the same selectUnique, so the corpus judges both.
  function buildCandidates(blocks, reference) {
    if (!Array.isArray(blocks)) throw new TypeError("buildCandidates expects an array of block texts");
    var ref = reference || {};
    if (typeof ref.probe !== "string") throw new TypeError("buildCandidates: reference.probe must be a string");
    var probe = normalize.normalizeText(ref.probe);
    var out = [];
    for (var i = 0; i < blocks.length; i += 1) {
      var text = normalize.normalizeText(blocks[i]);
      var match = null;
      if (text === probe) {
        match = MATCH.EXACT;
      } else if (probe && text && (text.indexOf(probe) !== -1 || probe.indexOf(text) !== -1)) {
        match = MATCH.CONTAINS;
      }
      // The structural path CORROBORATES a text match. It never produces a
      // candidate on its own here, because a document where every miss also
      // emits a structure-only candidate would report structure_only as the
      // reason for every miss, which tells the reviewer nothing. Task 1C's real
      // engine does emit a structure-only candidate in the one case that
      // deserves it: an author-supplied region attribute matched and the text
      // did not. selectUnique refuses that candidate either way.
      var structural = typeof ref.path === "number" && ref.path === i;
      if (!match) continue;
      out.push({
        key: i,
        match: match,
        prefix: i > 0 ? blocks[i - 1] : null,
        suffix: i < blocks.length - 1 ? blocks[i + 1] : null,
        structure: structural,
        heading: ref.heading === undefined || ref.heading === null ? false : true
      });
    }
    return out;
  }

  function resolveInBlocks(blocks, reference) {
    return selectUnique(buildCandidates(blocks, reference), reference);
  }

  return {
    MATCH: MATCH,
    REASON: REASON,
    REASON_FAILURE_CODE: REASON_FAILURE_CODE,
    contextMatches: contextMatches,
    selectUnique: selectUnique,
    buildCandidates: buildCandidates,
    resolveInBlocks: resolveInBlocks
  };
});
