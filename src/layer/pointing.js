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
    // TWO PLACES, NOT ONE. Ken: "before and after ref.paths is still good for
    // some of the use cases." Keeping only the fresher one is lossy, and undo is
    // the case that shows it: a region minted at s2, moved to s4 by an edit,
    // refreshed to s4, and then put back at s2 when the reviewer takes the edit
    // away. The fresh path now matches nothing and the minted one is exactly
    // right. Both count, and the fresher is worth more because it is the more
    // recent evidence, not because it is more true.
    PATH: 20,
    PATH_MINTED: 12,
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
  function scoreAgainst(ref, node, scope, knownPath, knownPrint) {
    var reference = ref || {};
    var found = anchor.fingerprintOf(node, scope) || {};
    // TWO REMEMBERED SELVES, and a candidate matching EITHER is evidence.
    //
    // Ken: "what if the whole fingerprint is rerun before and after?" An edit can
    // change what an element IS, not only where it sits: the agent rewords the
    // passage and wraps it in a new div with a new class, and a fingerprint from
    // before that describes something that no longer exists. Re-taking it after
    // each edit is how the later look has anything current to compare with.
    //
    // The minted one is kept rather than replaced, for the same reason both paths
    // are kept: an undo puts back the thing that was there on the day the comment
    // was made. Whichever self this candidate resembles more is the score.
    var print = reference.fingerprint || {};
    var alt = knownPrint || null;
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
    var wantId = print.element_id || (alt && alt.element_id);
    if (wantId && (wantId === found.element_id || (alt && alt.element_id === found.element_id))) {
      add(WEIGHT.ELEMENT_ID, "id");
    }
    var classFit = Math.max(
      overlap(print.classes, found.classes),
      alt ? overlap(alt.classes, found.classes) : 0
    );
    var chainFit = Math.max(
      chainAgreement(print.chain, found.chain),
      alt ? chainAgreement(alt.chain, found.chain) : 0
    );
    add(Math.round(WEIGHT.CLASSES * classFit), "classes");
    add(Math.round(WEIGHT.CHAIN * chainFit), "parents");
    var herePath = knownPath || reference.path ? anchor.pathOf(node, scope) : null;
    if (knownPath && knownPath === herePath) position += WEIGHT.PATH;
    if (reference.path && reference.path !== knownPath && reference.path === herePath) {
      position += WEIGHT.PATH_MINTED;
    }
    var context = anchor.foundContextFor(node, scope, reference);
    if (contextAgrees(reference.prefix, context.prefix)) add(WEIGHT.PREFIX, "text before");
    if (contextAgrees(reference.suffix, context.suffix)) add(WEIGHT.SUFFIX, "text after");
    if (reference.heading && reference.heading === anchor.headingOf(node, scope)) {
      add(WEIGHT.HEADING, "under the same heading");
    }
    if ((print.tag && print.tag === found.tag) || (alt && alt.tag === found.tag)) {
      add(WEIGHT.TAG, "same kind of element");
    }
    if ((print.ordinal && print.ordinal === found.ordinal) || (alt && alt.ordinal === found.ordinal)) {
      position += WEIGHT.ORDINAL;
    }

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
  /**
   * @param {Object} ref the stored reference
   * @param {Node} root the document to look in
   * @param {{knownPath?: string}} [options] `knownPath` is where this region was
   *   the last time anything actually FOUND it, which is not where it was minted.
   *
   *   WHY THAT MATTERS, and it is the queued-edits problem rather than a detail.
   *   Four comments are made against one page. The agent applies the first edit,
   *   which deletes a block; everything below it shifts up. The remaining three
   *   references still bind, because they bind on their own words. But their
   *   stored PATHS are now wrong, and nothing has said so. Apply a second edit
   *   that rewords one of them and its text is gone too, so the only thing left
   *   is a path from before a deletion that moved it.
   *
   *   Ken: "before the edit it was d1>d3>s2 and after the edit it was d1>d3>s4".
   *   Refreshing it while the text still matches is how the second fact gets
   *   known, and it has to happen on every successful bind rather than when
   *   something has already gone wrong, because by then there is nothing left to
   *   ask. It is the same shape as his answer about undo: commit constantly.
   */
  function bestGuess(ref, root, options) {
    var reference = ref || {};
    var known = (options && options.known) || null;
    var knownPath = (options && options.knownPath) || (known && known.path) || null;
    var knownPrint = known ? known.fingerprint : null;
    if (!reference.fingerprint && !reference.path && !knownPath && !knownPrint && !reference.attr) {
      return { element: null };
    }
    var scope = anchor.scopeOf(root, null);
    if (!scope) return { element: null };

    var scored = [];
    anchor.eachElement(scope, function (node) {
      var got = scoreAgainst(reference, node, scope, knownPath, knownPrint);
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
      // IDENTITY COULD NOT SEPARATE THEM, so ask where they are. Ken: "ref.path
      // should be used to get to the right region, and then from there we should
      // look more deeply to ensure we're working on the right thing." This is the
      // other half of that: looking deeply has been done, it came back tied
      // because the candidates really are alike, and the stored path is the only
      // fact left.
      //
      // A path match is used here and nowhere else in the scoring, and the
      // difference matters. It is not a number added to a total, it is one
      // question with a yes or no answer: is exactly one of the tied candidates
      // standing where this region stood. Two of them cannot both be.
      //
      // IT IS ALLOWED TO BE WRONG, and it is marked so the rail can say so. If
      // the page reordered, the element now standing in that slot is a different
      // one, and this points at it. Ken again, on that trade: "for the moment
      // when the edit needs to be made, it does work ... but anything that's
      // reordered or deleted, then after that this thing no longer works." True.
      // The alternative is pointing at nothing, which is what the reviewer has
      // been getting, and a mark in the wrong place can be seen and dismissed
      // where an absent one cannot. Nothing here places a write either way.
      var tied = scored.filter(function (candidate) {
        return top.score - candidate.score < MARGIN;
      });
      var onPath = tied.filter(function (candidate) {
        // Either remembered place qualifies. An ordinal match alone does not:
        // that is a fact about one render and it is worth 5.
        if (candidate.position < WEIGHT.PATH_MINTED) return false;
        // THE REGION WAS DELETED AND EVERYTHING SHIFTED UP, which looks exactly
        // like the region still being here until you read what is standing in
        // its place. If that is the text we remembered as this region's
        // NEIGHBOUR, then the neighbour has moved into the slot and the region
        // itself is gone. Pointing at it would tell the reviewer their comment
        // is on a paragraph that no longer exists, which is worse than pointing
        // at nothing, because nothing is visibly nothing.
        var here = textish(candidate.node && candidate.node.textContent);
        if (!here) return true;
        return here !== textish(reference.prefix) && here !== textish(reference.suffix);
      });
      if (onPath.length === 1) {
        return {
          element: onPath[0].node,
          score: onPath[0].score,
          runnerUp: next.score,
          reasons: onPath[0].reasons.concat(["and it is the one still standing in that place"]),
          via: "position"
        };
      }
      return { element: null, score: top.score, runnerUp: next.score };
    }

    return {
      element: top.node,
      score: top.score,
      runnerUp: next ? next.score : 0,
      reasons: top.reasons,
      via: "identity"
    };
  }

  /**
   * The gap a removed region left behind, so the reviewer can be shown WHERE.
   *
   * Ken, on trying to identify something that has been deleted: "you only need
   * to identify it before you've removed it. After you've removed it, you don't
   * need to identify it ... trying to identify a removed element, you can't even
   * do that with an ID." Exactly so, and that is why bestGuess refuses here: no
   * fingerprint, no path and no injected marker can find a node that is not in
   * the document. The question has no answer.
   *
   * A different question does have one. "The better UX would be to show where it
   * was deleted, but that would be tagged to something else, not the removed
   * element." The something else is already stored: the reference kept the text
   * of its neighbours when it was minted, and a neighbour that survived the
   * deletion is findable by exactly the machinery the region itself used.
   *
   * So this answers "your passage was here", never "here is your passage". It
   * places no write, and the rail has to say the region is gone rather than
   * letting a mark on the neighbour imply it is still there.
   *
   * @returns {{element, side}|null} the surviving neighbour and which side of
   *   the gap it sat on, or null when both neighbours went too.
   */
  function whereItWas(ref, root) {
    var reference = ref || {};
    var sides = [
      { side: "after", text: reference.suffix },
      { side: "before", text: reference.prefix }
    ];
    for (var i = 0; i < sides.length; i += 1) {
      var text = textish(sides[i].text);
      if (!text) continue;
      // The real engine, not a second opinion about what a match is: innermost
      // element wins, and two candidates are no answer.
      var verdict = anchor.resolve(
        { probe: text, probe_kind: "text", prefix: "", suffix: "", context_level: 0 },
        root
      );
      if (verdict && verdict.element) return { element: verdict.element, side: sides[i].side };
    }
    return null;
  }

  /**
   * The three answers a card can honestly give about where its region went.
   *
   * Today there is one message for all of them: "could not be safely matched to
   * this version of the page", which is where this whole argument started. It is
   * true and it is useless, because it does not separate a passage the agent
   * REWORDED from one the agent DELETED, and those want different things from
   * the reviewer.
   *
   * Ken, arriving at it through the reference's path: "before the edit it was
   * d1>d3>s2 and after the edit it was d1>d3>s4", and then "or d1>d3>s2 to
   * d1>d3>deleted". The second one is the interesting half. A path that ends in
   * a tombstone is not a failure to look, it is a finding.
   *
   * The evidence for that finding is already here. A region is REMOVED, rather
   * than merely unfound, when its neighbours are still on the page and the place
   * it used to sit is now occupied by one of them. That is the same shift-up
   * that bestGuess refuses to point at, read as information instead of as a
   * hazard.
   *
   * @returns {{state: "found"|"removed"|"unknown", element?, via?, gap?}}
   */
  function verdictFor(ref, root, options) {
    var guess = bestGuess(ref, root, options);
    if (guess.element) return { state: "found", element: guess.element, via: guess.via };

    var gap = whereItWas(ref, root);
    if (gap) return { state: "removed", gap: gap };

    // The neighbours went too, or nothing here resembles any of it. Either way
    // there is nothing to say beyond that, and saying more would be inventing.
    return { state: "unknown" };
  }

  return {
    WEIGHT: WEIGHT,
    whereItWas: whereItWas,
    verdictFor: verdictFor,
    /**
     * Where this region is NOW, to be kept until the next successful bind.
     *
     * Called after the strict engine binds, which is the only moment the answer
     * is known to be right. Returns null when nothing bound, so a caller cannot
     * accidentally record a guess as a fact.
     */
    placeOf: function (element, root) {
      if (!element) return null;
      var scope = anchor.scopeOf(root, null);
      return scope ? anchor.pathOf(element, scope) : null;
    },

    /**
     * Everything worth remembering about where and what this region is NOW.
     *
     * Taken after a successful bind, which is the only moment it is known to be
     * right, and taken again after every edit that lands while the region can
     * still be found. A region whose words an edit destroys keeps the snapshot
     * from just before that edit, which is the most recent true thing about it.
     */
    snapshot: function (element, root) {
      if (!element) return null;
      var scope = anchor.scopeOf(root, null);
      if (!scope) return null;
      return { path: anchor.pathOf(element, scope), fingerprint: anchor.fingerprintOf(element, scope) };
    },
    FLOOR: FLOOR,
    MARGIN: MARGIN,
    scoreAgainst: scoreAgainst,
    bestGuess: bestGuess
  };
});
