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
// 1a. CONTENT PLACES A WRITE, AND AN IMAGE HAS CONTENT TOO. Some regions have
//    no words in them: an image, a chart, an icon button, an SVG. R17 exists for
//    exactly those, and the rule above does not bend for them. What widens is
//    what counts as content. An image's `src` is not where the image sits; it is
//    what the image IS, so for a region with no text the engine mints a CONTENT
//    SIGNATURE out of the attributes that identify the element (D9, "The element
//    anchor: a region with no text"). The signature then goes through this same
//    file with no exception carved for it: the same widening by whole siblings,
//    the same uniqueness predicate, the same honest failure when the containing
//    block runs out. Two images sharing one `src` are ambiguous in exactly the
//    way two identical list items are ambiguous, and they fail the same way.
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
// One function asks a sixth, and only for the agent's benefit, never for a
// match: openingTagOf reads a node's live `attributes` list to serialize its
// opening tag. A node that has no such list is asked for a named set of
// attributes with the same getAttribute as everything else here, so the five
// questions still buy the whole engine on a simulated node.
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

  // Two of those tags are skipped for TEXT and reachable for a SIGNATURE. An
  // <svg> label or a <canvas> holds no prose, so its inner text must never join
  // the page's text and place a write. But a reviewer can point at one, pick
  // mode hands one over, and recorded reviews contain them. Skipping them in
  // both worlds is what produced the silent third state this amendment removes:
  // the pick appeared to work and the engine could never find the element
  // again. The signature walk treats these as candidate LEAVES: their own
  // signature is compared, and the walk does not descend into them.
  var ELEMENT_ONLY_TAGS = { svg: 1, canvas: 1 };

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

  // What the probe is made of. Two values, and no third: either the region's
  // words, or, when it has none, the signature of the element itself. It is
  // stored on the reference so resolve() a week later knows which question to
  // ask each candidate. A reference minted before this existed carries no
  // probe_kind, and reads as TEXT, which is what it was.
  var PROBE = {
    TEXT: "text",
    ELEMENT: "element"
  };

  // The attributes that say what an element IS rather than where it sits, per
  // tag. Order matters: it is the order they are written into the signature, so
  // two elements are compared field by field in the same order every time.
  var SIGNATURE_ATTRS = {
    img: ["src", "alt", "srcset"]
  };

  // For every other element with no text. `id` and `href` are here as CONTENT
  // (this element's own name, this link's own destination), not as position.
  var GENERIC_SIGNATURE_ATTRS = ["aria-label", "id", "href", "value"];

  // The tags whose inner <title> and <desc> are the element's own name rather
  // than page prose. Only svg today; the list exists so the reason is written
  // down rather than living in an `if`.
  var DESCRIBED_BY_CHILD_TAGS = { svg: 1 };

  // The reference shape. Every field is named here so the record module's
  // region.ref has a documented interior.
  //
  //   id        stable, minted once at first touch, never recomputed
  //   probe     the region's content at mint time: its normalized text, or,
  //             when it has none, its element signature. The only signal
  //             allowed to place a write
  //   probe_kind which of the two the probe is, PROBE.TEXT or PROBE.ELEMENT
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
      probe_kind: PROBE.TEXT,
      prefix: null,
      suffix: null,
      path: null,
      heading: null,
      attr: null,
      minted_at: null,
      // Which ring of context prefix/suffix were read from. Stored because
      // resolve has to read the same ring; a reference written before this
      // existed carries none and reads as 0, which is what it was.
      context_level: 0,
      // THE FINGERPRINT. Everything above describes the region by its WORDS and
      // where they sat. These describe the element itself, in the terms the page
      // author wrote, and they exist for the case the words cannot cover: the
      // agent is about to rewrite the very text the anchor is made of.
      //
      // Ken, on a comment that lost its place: "we need some way to fingerprint
      // an element. surrounding elements? a dom walk up through it's parents? a
      // combo of class names, ids, dom parents?" That is what these are.
      //
      // They never place a write. See scoreAgainst.
      fingerprint: null
    };
  }

  /**
   * What the element says it is, in the author's own terms.
   *
   * PREFER WHAT THE AUTHOR WROTE OVER WHAT THE BUILD GENERATED. A class like
   * st-door-card__pill is in somebody's template and survives every rebuild of
   * it; an nth-child position is a fact about one render and is wrong the moment
   * a sibling is inserted. So the chain here is tag plus classes, never indexes.
   *
   * `ordinal` is the one positional fact kept, and it is deliberately weak: it
   * breaks ties between siblings that are otherwise identical, and on its own it
   * says almost nothing.
   */
  function fingerprintOf(node, scope) {
    if (!isElement(node)) return null;
    var chain = [];
    var hop = parentOf(node);
    var levels = 0;
    while (isElement(hop) && levels < FINGERPRINT_DEPTH) {
      chain.push({ tag: tagOf(hop), classes: classesOf(hop) });
      if (hop === scope) break;
      hop = parentOf(hop);
      levels += 1;
    }
    return {
      tag: tagOf(node),
      element_id: attrOf(node, "id") || null,
      classes: classesOf(node),
      chain: chain,
      ordinal: ordinalOf(node)
    };
  }

  // How far up the fingerprint walks. Deep enough that a card inside a grid
  // inside a section is distinguishable from the same card elsewhere; shallow
  // enough that a wrapper added at the top of the document does not shift every
  // stored chain by one.
  var FINGERPRINT_DEPTH = 4;

  function classesOf(node) {
    var raw = attrOf(node, "class");
    if (typeof raw !== "string" || !raw) return [];
    var out = [];
    raw.split(/\s+/).forEach(function (token) {
      if (!token) return;
      // The library's own classes are never part of a page element's identity.
      if (token.indexOf("lahe-") === 0) return;
      if (out.indexOf(token) === -1) out.push(token);
    });
    return out;
  }

  /** Position among siblings carrying the same tag. 1-based, 0 when unknown. */
  function ordinalOf(node) {
    var parent = parentOf(node);
    if (!isElement(parent)) return 0;
    var kids = elementChildren(parent);
    var tag = tagOf(node);
    var seen = 0;
    for (var i = 0; i < kids.length; i += 1) {
      if (tagOf(kids[i]) !== tag) continue;
      seen += 1;
      if (kids[i] === node) return seen;
    }
    return 0;
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

  // The node's text, as the matcher compares it: whitespace-insensitive, so a
  // rewrapped paragraph still matches the probe minted before it was rewrapped.
  //
  // It reads the text through normalize.blockTextFromNode rather than off
  // textContent, for one reason: textContent runs the words on either side of a
  // <br> or a nested block together. A reviewer who splits a paragraph turns
  // "Hello world." into the textContent "Helloworld.", the probe stops matching
  // the block it was minted on, and the item reports itself lost on a page the
  // reviewer is looking straight at.
  function textOf(node) {
    if (!node) return "";
    // Skipped DESCENDANTS contribute nothing. The node itself is whatever the
    // caller handed over, and answering "" for it would turn a mint into an
    // empty-probe failure on an element a caller deliberately picked.
    return normalize.normalizeText(
      normalize.blockTextFromNode(node, {
        skip: function (candidate) {
          return candidate !== node && isSkipped(candidate);
        }
      })
    );
  }

  // A node the engine walks past entirely: no prose in it, or it is ours.
  function isSkipped(node) {
    if (!isElement(node)) return true;
    if (Object.prototype.hasOwnProperty.call(SKIP_TAGS, tagOf(node))) return true;
    if (markers && typeof markers.isToolNode === "function" && markers.isToolNode(node)) return true;
    return false;
  }

  // Skipped by the text walk, reachable by the signature walk. Never ours: the
  // library's own chrome stays invisible to both.
  function isElementOnly(node) {
    if (!isElement(node)) return false;
    if (markers && typeof markers.isToolNode === "function" && markers.isToolNode(node)) return false;
    return Object.prototype.hasOwnProperty.call(ELEMENT_ONLY_TAGS, tagOf(node));
  }

  // -------------------------------------------------------------------------
  // The content signature: what an element IS, for a region with no text
  // -------------------------------------------------------------------------

  // The node's text with nothing skipped. Used only for the parts of a
  // signature that live in a tag the prose walk refuses to read, an <svg>'s own
  // <title> being the case that matters.
  function rawTextOf(node) {
    if (!node) return "";
    return normalize.normalizeText(normalize.blockTextFromNode(node, {}));
  }

  // The first descendant with this tag, in document order. Reads through
  // skipped tags on purpose: <title> is one of them.
  function firstDescendantOfTag(node, tag) {
    var kids = elementChildren(node);
    for (var i = 0; i < kids.length; i += 1) {
      if (tagOf(kids[i]) === tag) return kids[i];
      var deeper = firstDescendantOfTag(kids[i], tag);
      if (deeper) return deeper;
    }
    return null;
  }

  function signatureAttrNamesFor(tag) {
    if (Object.prototype.hasOwnProperty.call(SIGNATURE_ATTRS, tag)) return SIGNATURE_ATTRS[tag];
    return GENERIC_SIGNATURE_ATTRS;
  }

  /**
   * The element's content signature, or "" when the element says nothing about
   * itself. An empty signature is an honest EMPTY_PROBE failure, not something
   * to paper over with position.
   *
   * The value is field-delimited, so a longer value in one field can never read
   * as a whole other element's signature: "img|src=a.png|alt=|srcset=" is not a
   * substring of "img|src=a.png|alt=Square|srcset=".
   */
  function signatureOf(node) {
    if (!isElement(node)) return "";
    var tag = tagOf(node);
    var names = signatureAttrNamesFor(tag);
    var parts = [];
    var said = false;
    var i;
    for (i = 0; i < names.length; i += 1) {
      var value = normalize.normalizeText(attrOf(node, names[i]) || "");
      if (value) said = true;
      parts.push(names[i] + "=" + value);
    }
    if (Object.prototype.hasOwnProperty.call(DESCRIBED_BY_CHILD_TAGS, tag)) {
      var described = ["title", "desc"];
      for (i = 0; i < described.length; i += 1) {
        var child = firstDescendantOfTag(node, described[i]);
        var childText = child ? rawTextOf(child) : "";
        if (childText) said = true;
        parts.push(described[i] + "=" + childText);
      }
      var inner = rawTextOf(node);
      if (inner) said = true;
      parts.push("text=" + inner);
    }
    if (!said) return "";
    return tag + "|" + parts.join("|");
  }

  /**
   * Every element under a scope that could be a region, in document order.
   *
   * The same exclusions the text walk makes: the library's own chrome is
   * invisible, and a tag that holds no reviewable prose is not entered. It
   * yields ancestors as well as leaves, because the element a comment points at
   * is often a container (a card, a pill) rather than the innermost node.
   */
  function eachElement(scope, fn) {
    if (!isElement(scope)) return;
    var kids = elementChildren(scope);
    for (var i = 0; i < kids.length; i += 1) {
      var kid = kids[i];
      if (isSkipped(kid) && !isElementOnly(kid)) continue;
      fn(kid);
      if (!isElementOnly(kid)) eachElement(kid, fn);
    }
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

  // A node is always in its own sibling list, even when it is a tag the text
  // walk skips. Every caller below finds the node's position in this list, and
  // an <svg> the reviewer picked would otherwise be missing from it, which reads
  // as "this element is nowhere" and empties its context.
  function siblingsOf(node) {
    var parent = parentOf(node);
    if (!parent) return [];
    return elementChildren(parent).filter(function (child) {
      return child === node || !isSkipped(child);
    });
  }

  // Climbs through only-children so a wrapper element is transparent. Stops at
  // the scope: the scope's own siblings are outside the page under review.
  /**
   * Every level the context could be read from, nearest first.
   *
   * A level is an ancestor (or the region itself) that HAS siblings, because a
   * level with none offers no context to widen into. Rule 4 climbs through
   * only-children to find the first such level; this returns that one and the
   * ones above it, because the first is not always enough.
   *
   * WHY THE FIRST IS NOT ALWAYS ENOUGH, and it is the case that sent a reviewer
   * to an agent to sort out by hand. A page of 73 lesson cards, each ending in
   * the same decision line: Approve / Deny / Discuss. The reviewer comments on
   * one Approve. Its level-0 context is "" before and "/ Deny / Discuss" after,
   * which is byte for byte identical on all 73 cards, so mint widened through
   * that level, ran out, and failed as not_unique_in_containing_block. The thing
   * that tells those cards apart, the filename, is one level up, inside the card
   * (Ken, 2026-08-26).
   *
   * D9 says widening runs "until it resolves to one element or the containing
   * block runs out". Stopping at the first level with siblings is narrower than
   * that, so this is the documented rule rather than a change to it. The bound
   * is what keeps it honest: a reference that had to read the whole page to be
   * unique is invalidated by any edit anywhere, so the climb stops well short of
   * the document.
   */
  var CONTEXT_LEVELS_MAX = 3;

  function contextLevelsOf(node, scope) {
    var levels = [];
    var current = node;
    while (current && current !== scope && levels.length < CONTEXT_LEVELS_MAX) {
      if (siblingsOf(current).length > 1) levels.push(current);
      var parent = parentOf(current);
      if (!parent || parent === scope) break;
      current = parent;
    }
    // A region with no sibling anywhere above it still has to answer, and its
    // own level is the honest answer: no context at all.
    if (!levels.length) levels.push(contextAnchorOf(node, scope));
    return levels;
  }

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

  /**
   * {before: [normalized sibling texts], after: [...]} around the region.
   *
   * `level` is which ring of context to read, and it is STORED ON THE REFERENCE
   * so resolve reads the same ring mint wrote. Reading a different ring than the
   * one that was stored compares two different things and is worse than no
   * context at all.
   */
  function contextTextsOf(node, scope, level) {
    var levels = contextLevelsOf(node, scope);
    var want = typeof level === "number" && level > 0 ? Math.min(level, levels.length - 1) : 0;
    var anchorNode = levels[want] || levels[0];
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
    var texts = contextTextsOf(node, scope, ref && ref.context_level);
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

  /**
   * The same walk for signatures. Two differences, both forced by what a
   * signature is:
   *
   *   - an <svg> or a <canvas> is a candidate leaf. The text walk refuses to
   *     enter one; this walk compares its signature and does not descend.
   *   - the innermost rule still holds. An ancestor's signature is built from
   *     its OWN attributes, so it almost never matches a descendant's, but when
   *     it somehow does, the inner element is the region, exactly as with text.
   */
  function findSignatureMatches(node, probe, out) {
    var matchedBelow = false;
    var kids = elementChildren(node);
    for (var i = 0; i < kids.length; i += 1) {
      var kid = kids[i];
      if (isElementOnly(kid)) {
        if (matchKind(signatureOf(kid), probe)) {
          out.push(kid);
          matchedBelow = true;
        }
        continue;
      }
      if (isSkipped(kid)) continue;
      if (findSignatureMatches(kid, probe, out)) matchedBelow = true;
    }
    if (matchedBelow) return true;
    if (!isElement(node)) return false;
    if (matchKind(signatureOf(node), probe)) {
      out.push(node);
      return true;
    }
    return false;
  }

  function probeKindOf(ref) {
    return ref && ref.probe_kind === PROBE.ELEMENT ? PROBE.ELEMENT : PROBE.TEXT;
  }

  // What this candidate says about itself, in whichever content the reference
  // was minted from. One function, so the walk, the match kind on the
  // descriptor, and mint's own check cannot drift apart.
  function contentOf(node, kind) {
    return kind === PROBE.ELEMENT ? signatureOf(node) : textOf(node);
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
    var kind = probeKindOf(ref);
    var out = [];
    if (!isElement(scope) || !probe) return out;

    var nodes = [];
    if (kind === PROBE.ELEMENT) {
      findSignatureMatches(scope, probe, nodes);
    } else {
      findMatches(scope, probe, nodes);
    }

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
        match: matchKind(contentOf(node, kind), probe),
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

    // Text first, always. A region with words in it is anchored by its words,
    // and the signature path is what happens when there are none, never a
    // second opinion about a region that has some.
    // An <svg> or a <canvas> takes the signature path even when there are
    // characters inside it. That text is not the page's prose, the text walk
    // refuses to enter it, and a probe the search can never reach is a
    // reference that fails on its first resolve. Its inner text is not thrown
    // away: the signature carries it.
    ref.probe = isElementOnly(element) ? "" : textOf(element);
    ref.probe_kind = PROBE.TEXT;
    if (!ref.probe) {
      ref.probe = signatureOf(element);
      ref.probe_kind = PROBE.ELEMENT;
    }
    // No words and nothing that says what this element is. An <img> with no
    // src, no alt and no srcset really is unidentifiable, and saying so is the
    // whole fix: the old code said it too, and then stored the failure as
    // though it were a reference.
    if (!ref.probe) return mintFailure(ref, MINT_FAILURE.EMPTY_PROBE);

    var scope = scopeOf(input.root, element);
    if (!isElement(scope)) return mintFailure(ref, MINT_FAILURE.NOT_FOUND, "no searchable root");

    ref.path = pathOf(element, scope);
    ref.heading = headingOf(element, scope);
    // Minted for every reference, used by none of the code below. It is what
    // src/layer/pointing.js reads when the words are gone and the reviewer still
    // has to be shown where their comment went. Storing it is not scoring it.
    ref.fingerprint = fingerprintOf(element, scope);

    var levelCount = contextLevelsOf(element, scope).length;
    var lastVerdict = null;

    // OUTWARD, THEN UP. Widen through this ring's whole siblings first, and only
    // when the ring is exhausted without becoming unique, read the next ring
    // out. Rings before depth, because a near neighbour is better evidence than
    // a distant one: taking the enclosing block first would store a whole card's
    // text as the context for a region whose own siblings already identified it.
    for (var level = 0; level < levelCount; level += 1) {
      var texts = contextTextsOf(element, scope, level);
      var maxDepth = Math.max(texts.before.length, texts.after.length);

      // Depth starts at one whole sibling on each side, even when the region is
      // already unique without any: a reference minted with no context can never
      // be told apart from a copy of itself pasted in later, and a page that
      // gains a duplicate is the ordinary case, not the exotic one.
      for (var depth = 1; depth <= Math.max(1, maxDepth); depth += 1) {
        var stored = storedContextAt(texts, depth);
        ref.context_level = level;
        ref.prefix = stored.prefix;
        ref.suffix = stored.suffix;
        lastVerdict = uniqueness.selectUnique(candidatesFor(ref, scope), ref);
        if (lastVerdict.bound && lastVerdict.key === element) {
          ref.ok = true;
          ref.failure = null;
          return ref;
        }
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

  // -------------------------------------------------------------------------
  // What the agent is told about the element, and what the rail calls it
  // -------------------------------------------------------------------------
  //
  // Both live here because both are read off a node with the same five
  // questions the engine already asks, and because comments.js and editing.js
  // each used to compute their own descriptor. Two copies of a rule is how the
  // rail and the Edits tab end up naming the same image differently.

  // How much page text rides along as the locating hint. This is a hint, not a
  // passage: the projection bounds it again, and a whole paragraph in a record
  // field the agent never reads as content is just weight on the wire.
  var NEAR_MAX = 160;

  // The attribute names read off a node that has no live `attributes` list.
  // The simulated DOM the unit tests run the engine over answers getAttribute
  // and nothing else, and keeping the engine to the questions it already asks
  // is what keeps jsdom out of this repo.
  var COMMON_ATTRS = [
    "id", "class", "src", "srcset", "alt", "href", "title", "value", "type",
    "name", "role", "width", "height", "aria-label", regions.AUTHOR_ATTR
  ];

  function attrPairsOf(node) {
    var pairs = [];
    var seen = {};
    var i;
    var live = node && node.attributes;
    if (live && typeof live.length === "number") {
      for (i = 0; i < live.length; i += 1) {
        var attr = live[i];
        if (!attr || typeof attr.name !== "string") continue;
        pairs.push({ name: attr.name, value: typeof attr.value === "string" ? attr.value : "" });
      }
      return pairs;
    }
    for (i = 0; i < COMMON_ATTRS.length; i += 1) {
      var name = COMMON_ATTRS[i];
      if (Object.prototype.hasOwnProperty.call(seen, name)) continue;
      seen[name] = true;
      var value = attrOf(node, name);
      if (typeof value === "string") pairs.push({ name: name, value: value });
    }
    return pairs;
  }

  /**
   * The element's OPENING TAG, as the page has it, with the library's own
   * attributes left out. Not the subtree: an agent needs to recognize the
   * element in its source, and a whole <svg> body is a wall of path data.
   */
  function openingTagOf(node) {
    if (!isElement(node)) return null;
    var out = "<" + tagOf(node);
    var pairs = attrPairsOf(node);
    for (var i = 0; i < pairs.length; i += 1) {
      if (markers && typeof markers.isToolAttrName === "function" && markers.isToolAttrName(pairs[i].name)) continue;
      out += " " + pairs[i].name + "=\"" + normalize.escapeAttrValue(pairs[i].value) + "\"";
    }
    return out + ">";
  }

  // The nearest page text around the element: the sibling after it if that one
  // has words, else the sibling before it. For an image in a figure, that is
  // its caption, which is what a person would say to point at it.
  function nearTextOf(node, scope) {
    var texts = contextTextsOf(node, scope);
    var i;
    for (i = 0; i < texts.after.length; i += 1) {
      if (texts.after[i]) return texts.after[i].slice(0, NEAR_MAX);
    }
    for (i = texts.before.length - 1; i >= 0; i -= 1) {
      if (texts.before[i]) return texts.before[i].slice(0, NEAR_MAX);
    }
    return null;
  }

  // The file's own name out of a URL, with the query and the fragment gone. The
  // reviewer said "the second one"; "logo-square-b@2x.png" is the closest thing
  // on the page to a name they would recognize.
  function fileNameOf(value) {
    if (typeof value !== "string" || !value) return null;
    var cut = value.split("#")[0].split("?")[0];
    var parts = cut.split("/");
    var last = parts[parts.length - 1] || "";
    return last ? normalize.normalizeText(last) : null;
  }

  // A NAME for this element, when it has one in its own content. Never a
  // position: that is what ordinals are for, and what collided.
  function contentNameOf(node) {
    if (!isElement(node)) return null;
    var tag = tagOf(node);
    if (tag === "img") return fileNameOf(attrOf(node, "src")) || normalize.normalizeText(attrOf(node, "alt") || "") || null;
    if (Object.prototype.hasOwnProperty.call(DESCRIBED_BY_CHILD_TAGS, tag)) {
      var titleNode = firstDescendantOfTag(node, "title");
      var title = titleNode ? rawTextOf(titleNode) : "";
      return title || null;
    }
    return null;
  }

  /**
   * The element's 1-based position among same-tag elements IN ITS HEADING'S
   * SECTION, in document order.
   *
   * Counting same-tag `previousElementSibling`s, which is what both callers
   * used to do, is only right when the elements are siblings. Three images each
   * in their own wrapper are not siblings, so all three counted as one, and the
   * reviewer's three cards all read "img 1".
   */
  function ordinalInSection(node, scope) {
    if (!isElement(node) || !isElement(scope)) return 1;
    var tag = tagOf(node);
    var heading = headingOf(node, scope);
    var found = [];
    (function collect(current) {
      var kids = elementChildren(current);
      for (var i = 0; i < kids.length; i += 1) {
        var kid = kids[i];
        var reachable = isElementOnly(kid) || !isSkipped(kid);
        if (!reachable) continue;
        if (tagOf(kid) === tag && headingOf(kid, scope) === heading) found.push(kid);
        if (!isElementOnly(kid)) collect(kid);
      }
    })(scope);
    var at = found.indexOf(node);
    return at === -1 ? 1 : at + 1;
  }

  /**
   * The descriptor regions.labelFor turns into a display label. Pure page
   * reading: the label rules themselves live in src/shared/regions.js, and this
   * never decides anything about identity.
   */
  function descriptorFor(element, root) {
    if (!isElement(element)) throw new TypeError("descriptorFor expects an element");
    var scope = scopeOf(root, element);
    return {
      authorName: attrOf(element, regions.AUTHOR_ATTR),
      id: attrOf(element, "id"),
      ariaLabel: attrOf(element, "aria-label"),
      name: contentNameOf(element),
      heading: headingOf(element, scope),
      ordinal: ordinalInSection(element, scope),
      tag: tagOf(element),
      text: textOf(element) || null
    };
  }

  /**
   * What the agent is handed about the element the reviewer pointed at: what it
   * is, not only that it was an IMG.
   *
   * Every field is page text and travels as DATA (D6, D12). `src` is the raw
   * attribute, exactly as the page author wrote it, because that is what the
   * agent will find in the source; the resolved absolute URL changes with
   * whatever origin served the page.
   */
  function subjectFor(element, root) {
    if (!isElement(element)) return null;
    var scope = scopeOf(root, element);
    return {
      tag: tagOf(element),
      src: attrOf(element, "src"),
      alt: attrOf(element, "alt"),
      html: openingTagOf(element),
      near: nearTextOf(element, scope)
    };
  }

  return {
    MINT_FAILURE: MINT_FAILURE,
    MINT_FAILURE_CODE: MINT_FAILURE_CODE,
    SKIP_TAGS: SKIP_TAGS,
    ELEMENT_ONLY_TAGS: ELEMENT_ONLY_TAGS,
    PROBE: PROBE,
    NEAR_MAX: NEAR_MAX,
    signatureOf: signatureOf,
    subjectFor: subjectFor,
    descriptorFor: descriptorFor,
    openingTagOf: openingTagOf,
    ordinalInSection: ordinalInSection,
    emptyRef: emptyRef,
    mint: mint,
    resolve: resolve,
    // Exposed for the browser spec and for anyone debugging a bind: the same
    // descriptors the predicate saw.
    candidatesFor: candidatesFor,
    contextTextsOf: contextTextsOf,
    pathOf: pathOf,
    headingOf: headingOf,
    // Read by src/layer/pointing.js, which asks the same questions of a node
    // that this file does and must not grow its own second answer to any of
    // them. Exported as readers, never as decisions: nothing here returns a
    // verdict, and the write path does not call any of it.
    AUTHOR_ATTR: regions.AUTHOR_ATTR,
    attrOf: attrOf,
    scopeOf: scopeOf,
    fingerprintOf: fingerprintOf,
    foundContextFor: foundContextFor,
    eachElement: eachElement
  };
});
