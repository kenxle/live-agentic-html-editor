// The anchor engine: mint a region reference, resolve it in a changed document.
//
// Owner: 1C. Implements architecture D9 (anchors match by uniqueness, not
// confidence). The signatures are 0A-kernel's and they did not move; what moved
// is the inside of the candidate search, which is now a real DOM walk.
//
// The whole decision about whether a result may be written lives in
// src/shared/uniqueness.js and is not repeated here. This file's only job is to
// produce honest candidate DESCRIPTORS and hand them to that predicate. A
// reader who finds a scalar in here should treat it as a bug: the dangerous
// anchoring errors are not low-confidence, they are high-confidence ambiguous,
// which is why the predicate has no tunable number in it.
//
// Four rules this file implements, in the order they matter.
//
// 1. TEXT PLACES A WRITE. NOTHING ELSE DOES. A candidate exists because the
//    normalized text of the region was found at it. The structural path, the
//    nearest heading, and the author's data-review-region attribute ride along
//    as corroboration and never create a placement. The one exception the plan
//    names: when the text is gone entirely and the author's attribute still
//    points somewhere, a STRUCTURE candidate is emitted so the reviewer is told
//    "it used to be here" instead of "no idea". The predicate refuses to write
//    to it, which is the point.
//
// 2. THE INNERMOST ELEMENT HOLDING THE TEXT IS THE CANDIDATE. Every ancestor of
//    a match also contains the text. They are the same text seen from further
//    out, not rival regions, so an element with a matching descendant is not a
//    candidate. This is what makes a wrapper element added around a region a
//    non-event: the wrapper and the region both hold the text, the region wins,
//    and no scoring was involved.
//
// 3. WIDENING HAS A UNIT AND A STOPPING RULE. The unit is a whole sibling
//    element. Mint starts with one sibling on each side, and while the region is
//    not yet unique it takes one more sibling on each side, outward, until the
//    containing block is exhausted. Then it stops and FAILS HONESTLY rather than
//    widening to the document. A reference that had to read the whole page to be
//    unique is a reference that any edit anywhere invalidates.
//
// 4. THE CONTEXT ANCHOR CLIMBS THROUGH ONLY-CHILDREN. A region that is the only
//    element in its parent has no siblings to widen into, so the context is read
//    from the nearest ancestor that does have siblings. Without this, wrapping a
//    region in a div empties its context, the stored context stops matching, and
//    a duplicate elsewhere on the page can win the elimination round. That is
//    the one forbidden outcome: resolving to a DIFFERENT node.
//
// This is new work, not a port. The built-doc comment module's locate() is four
// exact substring probes over the concatenated text, with no whitespace
// tolerance and no occurrence disambiguation, so a short prefix binds to the
// first hit.
//
// The engine asks a node exactly five questions: its tag name, its text, an
// attribute, its element children, and its parent. That is deliberate, and it is
// what lets the unit tests run the whole engine over a simulated DOM with no
// browser and no jsdom, while test/browser/anchor_engine.spec.js runs the same
// bar against Chromium on the real fixture pages.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.anchor = factory(root.LAHE.normalize, root.LAHE.uniqueness, root.LAHE.regions, root.LAHE.markers);
  } else {
    module.exports = factory(
      require("../shared/normalize.js"),
      require("../shared/uniqueness.js"),
      require("../shared/regions.js"),
      require("../shared/markers.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (normalize, uniqueness, regions, markers) {
  "use strict";

  // Elements that carry no reviewable prose. Their text would otherwise join
  // the page's text and produce matches inside a script body.
  var SKIP_TAGS = {
    script: 1, style: 1, template: 1, noscript: 1, head: 1, link: 1,
    meta: 1, title: 1, iframe: 1, object: 1, embed: 1, svg: 1, canvas: 1
  };

  // Why mint refuses. Named, because "mint returned null" tells the reviewer
  // nothing and the card has to say something true.
  var MINT_FAILURE = {
    NO_ELEMENT: "no_element",
    EMPTY_PROBE: "empty_probe",
    NOT_FOUND: "not_found_in_root",
    NOT_UNIQUE_IN_BLOCK: "not_unique_in_containing_block"
  };

  var MINT_FAILURE_CODE = {
    no_element: "ANCHOR_NO_TEXT_MATCH",
    empty_probe: "ANCHOR_NO_TEXT_MATCH",
    not_found_in_root: "ANCHOR_NO_TEXT_MATCH",
    not_unique_in_containing_block: "ANCHOR_AMBIGUOUS"
  };

  var HEADING_TAGS = { h1: 1, h2: 1, h3: 1, h4: 1, h5: 1, h6: 1 };

  // The reference shape. Every field is named here so the record module's
  // region.ref has a documented interior.
  //
  //   id        stable, minted once at first touch, never recomputed
  //   probe     the region's normalized text at mint time. The only signal
  //             allowed to place a write
  //   prefix    the normalized text of the whole sibling elements before the
  //             region, nearest last, at the widening depth that made it unique
  //   suffix    the same after the region, nearest first
  //   path      a structural path (tag chain plus ordinals). CORROBORATION
  //             ONLY, per D9: tie-breakers corroborate, they never overrule. A
  //             position-only match after the content moved is exactly the
  //             wrong-element bug the rule exists to prevent
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

  // -------------------------------------------------------------------------
  // The five questions, and nothing else
  // -------------------------------------------------------------------------

  function isElement(node) {
    return !!node && typeof node.tagName === "string";
  }

  function tagOf(node) {
    return isElement(node) ? node.tagName.toLowerCase() : "";
  }

  function elementChildren(node) {
    var kids = node && node.children ? node.children : null;
    var out = [];
    if (!kids) return out;
    for (var i = 0; i < kids.length; i += 1) {
      if (isElement(kids[i])) out.push(kids[i]);
    }
    return out;
  }

  function parentOf(node) {
    if (!node) return null;
    var parent = node.parentElement || null;
    if (!parent && node.parentNode && isElement(node.parentNode)) parent = node.parentNode;
    return parent;
  }

  function attrOf(node, name) {
    if (!node || typeof node.getAttribute !== "function") return null;
    var value = node.getAttribute(name);
    return typeof value === "string" ? value : null;
  }

  function textOf(node) {
    var text = node && typeof node.textContent === "string" ? node.textContent : "";
    return normalize.normalizeText(text);
  }

  // A node the engine walks past entirely: no prose in it, or it is ours.
  function isSkipped(node) {
    if (!isElement(node)) return true;
    if (Object.prototype.hasOwnProperty.call(SKIP_TAGS, tagOf(node))) return true;
    if (markers && typeof markers.isToolNode === "function" && markers.isToolNode(node)) return true;
    return false;
  }

  // The subtree to search. Accepts an element, a document, or nothing.
  function scopeOf(root, element) {
    if (isElement(root)) return root;
    if (root && isElement(root.body)) return root.body;
    if (root && root.documentElement && isElement(root.documentElement)) return root.documentElement;
    if (element && element.ownerDocument && isElement(element.ownerDocument.body)) {
      return element.ownerDocument.body;
    }
    // Last resort: climb to the top of whatever tree the element is in.
    var node = element;
    var top = null;
    while (isElement(node)) {
      top = node;
      node = parentOf(node);
    }
    return top;
  }

  // -------------------------------------------------------------------------
  // Context: whole siblings, read from the nearest ancestor that has any
  // -------------------------------------------------------------------------

  function siblingsOf(node) {
    var parent = parentOf(node);
    if (!parent) return [];
    return elementChildren(parent).filter(function (child) {
      return !isSkipped(child);
    });
  }

  // Climbs through only-children so a wrapper element is transparent. Stops at
  // the scope: the scope's own siblings are outside the page under review.
  function contextAnchorOf(node, scope) {
    var current = node;
    while (current && current !== scope) {
      var siblings = siblingsOf(current);
      if (siblings.length > 1) return current;
      var parent = parentOf(current);
      if (!parent || parent === scope) return current;
      current = parent;
    }
    return current || node;
  }

  /** {before: [normalized sibling texts], after: [...]} around the region. */
  function contextTextsOf(node, scope) {
    var anchorNode = contextAnchorOf(node, scope);
    var siblings = siblingsOf(anchorNode);
    var at = siblings.indexOf(anchorNode);
    if (at === -1) return { before: [], after: [] };
    return {
      before: siblings.slice(0, at).map(textOf),
      after: siblings.slice(at + 1).map(textOf)
    };
  }

  function joinContext(parts) {
    return normalize.normalizeText(parts.join(" "));
  }

  // The stored context at widening depth `depth`: whole siblings, nearest to
  // the region last on the prefix side and first on the suffix side.
  function storedContextAt(texts, depth) {
    var before = texts.before.slice(Math.max(0, texts.before.length - depth));
    var after = texts.after.slice(0, depth);
    return { prefix: joinContext(before), suffix: joinContext(after) };
  }

  // A candidate's context, cut to the same reach the stored context has.
  //
  // The comparison itself is uniqueness.contextMatches, which is normalized and
  // containment-tolerant in both directions, so a shorter found context (a
  // neighbour was deleted) still matches. Cutting the found context to the
  // stored context's length is what keeps the comparison ADJACENT: without it,
  // a candidate at the foot of the page would match any stored prefix, because
  // everything on the page precedes it.
  function foundContextFor(node, scope, ref) {
    var texts = contextTextsOf(node, scope);
    var storedPrefix = typeof ref.prefix === "string" ? ref.prefix : "";
    var storedSuffix = typeof ref.suffix === "string" ? ref.suffix : "";
    var before = joinContext(texts.before);
    var after = joinContext(texts.after);
    return {
      prefix: storedPrefix ? before.slice(Math.max(0, before.length - storedPrefix.length)) : before,
      suffix: storedSuffix ? after.slice(0, storedSuffix.length) : after
    };
  }

  // -------------------------------------------------------------------------
  // Corroboration: the structural path and the nearest heading
  // -------------------------------------------------------------------------

  function pathOf(node, scope) {
    var parts = [];
    var current = node;
    while (isElement(current) && current !== scope) {
      var parent = parentOf(current);
      if (!parent) break;
      var same = elementChildren(parent).filter(function (child) {
        return tagOf(child) === tagOf(current);
      });
      parts.unshift(tagOf(current) + ":" + (same.indexOf(current) + 1));
      current = parent;
    }
    return (isElement(scope) ? tagOf(scope) : "") + ">" + parts.join(">");
  }

  function headingOf(node, scope) {
    var current = node;
    while (isElement(current) && current !== scope) {
      var siblings = siblingsOf(current);
      for (var i = siblings.indexOf(current) - 1; i >= 0; i -= 1) {
        if (Object.prototype.hasOwnProperty.call(HEADING_TAGS, tagOf(siblings[i]))) {
          return textOf(siblings[i]);
        }
      }
      current = parentOf(current);
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // The candidate search: the innermost elements whose text holds the probe
  // -------------------------------------------------------------------------

  function matchKind(candidateText, probe) {
    if (!candidateText || !probe) return null;
    if (candidateText === probe) return uniqueness.MATCH.EXACT;
    // One direction only, deliberately: the candidate must CONTAIN the region's
    // text. The other direction (a fragment of the region's text found on its
    // own) turns every stray word into a rival and suppresses the real match's
    // ancestors for no reason.
    if (candidateText.indexOf(probe) !== -1) return uniqueness.MATCH.CONTAINS;
    return null;
  }

  /**
   * Pushes the innermost matching elements into `out`, in document order.
   * Returns true when this subtree produced a match, which is how an ancestor
   * learns it is not the innermost one.
   */
  function findMatches(node, probe, out) {
    var matchedBelow = false;
    var kids = elementChildren(node);
    for (var i = 0; i < kids.length; i += 1) {
      if (isSkipped(kids[i])) continue;
      if (findMatches(kids[i], probe, out)) matchedBelow = true;
    }
    if (matchedBelow) return true;
    if (!isElement(node)) return false;
    if (matchKind(textOf(node), probe)) {
      out.push(node);
      return true;
    }
    return false;
  }

  /** Elements the page author named with the same region attribute. */
  function findByAuthorAttr(node, value, out) {
    var kids = elementChildren(node);
    for (var i = 0; i < kids.length; i += 1) {
      if (isSkipped(kids[i])) continue;
      if (attrOf(kids[i], regions.AUTHOR_ATTR) === value) out.push(kids[i]);
      findByAuthorAttr(kids[i], value, out);
    }
    return out;
  }

  /**
   * The candidate descriptors selectUnique judges. The node itself is the key,
   * so a bind hands the caller the element with no lookup table in between.
   */
  function candidatesFor(ref, scope) {
    var probe = typeof ref.probe === "string" ? normalize.normalizeText(ref.probe) : "";
    var out = [];
    if (!isElement(scope) || !probe) return out;

    var nodes = [];
    findMatches(scope, probe, nodes);

    if (!nodes.length) {
      // The text is gone. If the author named the region, say where it used to
      // be. STRUCTURE is never eligible to place a write; this exists so the
      // card can say "structure only" instead of "no match".
      if (typeof ref.attr === "string" && ref.attr) {
        findByAuthorAttr(scope, ref.attr, []).forEach(function (node) {
          out.push({
            key: node,
            match: uniqueness.MATCH.STRUCTURE,
            prefix: null,
            suffix: null,
            structure: true,
            heading: false
          });
        });
      }
      return out;
    }

    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      var context = foundContextFor(node, scope, ref);
      out.push({
        key: node,
        match: matchKind(textOf(node), probe),
        prefix: context.prefix,
        suffix: context.suffix,
        structure: typeof ref.path === "string" && ref.path === pathOf(node, scope),
        heading: typeof ref.heading === "string" && ref.heading !== null && ref.heading === headingOf(node, scope)
      });
    }
    return out;
  }

  // -------------------------------------------------------------------------
  // mint
  // -------------------------------------------------------------------------

  function mintFailure(ref, reason, detail) {
    ref.ok = false;
    ref.failure = {
      reason: reason,
      failureCode: MINT_FAILURE_CODE[reason] || "ANCHOR_NO_TEXT_MATCH",
      detail: detail || null
    };
    return ref;
  }

  /**
   * Mints a durable reference from a live element.
   *
   * Widening: one whole sibling on each side to start, then two, then three,
   * outward, until the region resolves to itself and nothing else. The stopping
   * rule is the containing block. Exhausting it without becoming unique is a
   * FAILURE, reported as one, not a reference that will bind to the wrong node
   * later.
   *
   * @param {Object} input {element, root}
   * @returns {Object} a reference, shape above, carrying `ok` and, when it
   *   failed, `failure` {reason, failureCode, detail}
   */
  function mint(input) {
    var element = input && input.element ? input.element : null;
    var ref = emptyRef();
    ref.id = "ref_" + Math.random().toString(16).slice(2, 14);
    ref.minted_at = new Date().toISOString();
    ref.attr = attrOf(element, regions.AUTHOR_ATTR);
    ref.ok = false;
    ref.failure = null;

    if (!element) return mintFailure(ref, MINT_FAILURE.NO_ELEMENT);

    var text = typeof element.textContent === "string" ? element.textContent : "";
    ref.probe = normalize.normalizeText(text);
    if (!ref.probe) return mintFailure(ref, MINT_FAILURE.EMPTY_PROBE);

    var scope = scopeOf(input.root, element);
    if (!isElement(scope)) return mintFailure(ref, MINT_FAILURE.NOT_FOUND, "no searchable root");

    ref.path = pathOf(element, scope);
    ref.heading = headingOf(element, scope);

    var texts = contextTextsOf(element, scope);
    var maxDepth = Math.max(texts.before.length, texts.after.length);
    var lastVerdict = null;

    // Depth starts at one whole sibling on each side, even when the region is
    // already unique without any: a reference minted with no context can never
    // be told apart from a copy of itself pasted in later, and a page that
    // gains a duplicate is the ordinary case, not the exotic one.
    for (var depth = 1; depth <= Math.max(1, maxDepth); depth += 1) {
      var stored = storedContextAt(texts, depth);
      ref.prefix = stored.prefix;
      ref.suffix = stored.suffix;
      lastVerdict = uniqueness.selectUnique(candidatesFor(ref, scope), ref);
      if (lastVerdict.bound && lastVerdict.key === element) {
        ref.ok = true;
        ref.failure = null;
        return ref;
      }
    }

    return mintFailure(
      ref,
      lastVerdict && lastVerdict.considered > 1 ? MINT_FAILURE.NOT_UNIQUE_IN_BLOCK : MINT_FAILURE.NOT_FOUND,
      lastVerdict ? lastVerdict.reason : null
    );
  }

  // -------------------------------------------------------------------------
  // resolve
  // -------------------------------------------------------------------------

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
   * @returns {Object} the uniqueness verdict, plus `element`: the bound node or
   *   null. A null element with a failureCode is an honest failure, and it is a
   *   perfectly good answer.
   */
  function resolve(ref, root) {
    var reference = ref || {};
    var scope = scopeOf(root, null);
    var verdict = uniqueness.selectUnique(candidatesFor(reference, scope), reference);
    verdict.element = verdict.bound ? verdict.key : null;
    return verdict;
  }

  return {
    MINT_FAILURE: MINT_FAILURE,
    MINT_FAILURE_CODE: MINT_FAILURE_CODE,
    SKIP_TAGS: SKIP_TAGS,
    emptyRef: emptyRef,
    mint: mint,
    resolve: resolve,
    // Exposed for the browser spec and for anyone debugging a bind: the same
    // descriptors the predicate saw.
    candidatesFor: candidatesFor,
    contextTextsOf: contextTextsOf,
    pathOf: pathOf,
    headingOf: headingOf
  };
});
