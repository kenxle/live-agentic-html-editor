// The DOM block rules, in one copy.
//
// Owner: free-writing kernel (docs/features/20260928.01_free_writing, plan
// Task 1.3). Imported by: editing (2A), replay and the page check (2B), undo
// and protection. Loads right after selection.js, before anchor.js, so a
// caller that needs a record's anchor resolves it itself and passes it in.
//
// Every function here is the live-DOM twin of a string rule in
// src/shared/normalize.js, and the two must agree:
//
//   leafWalk        normalize.leafBlocks, over live elements
//   runElementsFor  normalize.matchRun, over the leaves after the insert point
//   runClashFor     normalize.runClash, over the same leaves
//   writeBlock      normalize.cleanBlock, then built from constants
//
// Nothing here writes a string from a record into the page as markup. A block
// is built element by element from the allowlist's constants and text nodes.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.blocks = factory(root.LAHE.markers, root.LAHE.normalize);
  } else {
    module.exports = factory(require("../shared/markers.js"), require("../shared/normalize.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, normalize) {
  "use strict";

  var WRITABLE = normalize.WRITABLE_BLOCK_TAGS;
  var BLOCK_TAGS = normalize.BLOCK_TAGS;
  var LIST_TAGS = { ul: 1, ol: 1 };

  // A host that cannot hold flow content, so a run is never offered there and
  // Enter keeps today's break rule.
  var NO_RUN_TAGS = { td: 1, th: 1, dt: 1, dd: 1, figcaption: 1 };
  var NO_RUN_HOSTS = { tr: 1, tbody: 1, thead: 1, tfoot: 1, table: 1, dl: 1, ul: 1, ol: 1 };

  // The only elements a block is built from. Each value is the constant the
  // element is created with; nothing from a record ever names an element.
  var INLINE_BUILD = { strong: "strong", em: "em", br: "br", li: "li" };
  INLINE_BUILD[normalize.NOT_BOLD_TAG] = normalize.NOT_BOLD_TAG;
  INLINE_BUILD[normalize.NOT_ITALIC_TAG] = normalize.NOT_ITALIC_TAG;

  function hasOwn(map, key) {
    return Object.prototype.hasOwnProperty.call(map, key);
  }

  function tagOf(el) {
    return el && typeof el.tagName === "string" ? el.tagName.toLowerCase() : "";
  }

  function isElement(node) {
    return !!node && node.nodeType === 1;
  }

  // Not page content: script and the other dropped subtrees, the document
  // head, the library's own chrome, and the overlay root.
  function isNotContent(el) {
    var tag = tagOf(el);
    if (hasOwn(normalize.DROP_SUBTREE_TAGS, tag) || tag === "head") return true;
    if (markers.roleOf(el) === markers.ROLE_CHROME) return true;
    return el.id === markers.OVERLAY_ROOT_ID;
  }

  function isSkipped(el) {
    return isNotContent(el) || markers.isFileTitle(el);
  }

  function hasBlockInside(el) {
    for (var child = el.firstElementChild; child; child = child.nextElementSibling) {
      if (isNotContent(child)) continue;
      if (hasOwn(BLOCK_TAGS, tagOf(child)) || hasBlockInside(child)) return true;
    }
    return false;
  }

  function isLeaf(el) {
    var tag = tagOf(el);
    if (!hasOwn(BLOCK_TAGS, tag)) return false;
    return hasOwn(LIST_TAGS, tag) || !hasBlockInside(el);
  }

  function wordsOf(el) {
    return normalize.blockWords(normalize.cleanMarkup(el.innerHTML));
  }

  function rangeAt(point) {
    var doc = point.parent.ownerDocument;
    var r = doc.createRange();
    var idx = point.before ? Array.prototype.indexOf.call(point.parent.childNodes, point.before) : point.parent.childNodes.length;
    r.setStart(point.parent, idx < 0 ? point.parent.childNodes.length : idx);
    r.collapse(true);
    return r;
  }

  /**
   * The leaf blocks under `root` in document order, the same rule as
   * normalize.leafBlocks. With `fromPoint` ({parent, before}), only the leaves
   * that start after that point.
   *
   * @param {Element} rootEl
   * @param {{parent: Node, before: Node|null}} [fromPoint]
   * @returns {Element[]}
   */
  function leafWalk(rootEl, fromPoint) {
    var out = [];
    if (!rootEl) return out;
    (function walk(el) {
      for (var child = el.firstElementChild; child; child = child.nextElementSibling) {
        if (isSkipped(child)) continue;
        if (isLeaf(child)) {
          if (wordsOf(child)) out.push(child);
          continue;
        }
        walk(child);
      }
    })(rootEl);
    if (!fromPoint || !fromPoint.parent) return out;
    var range = rangeAt(fromPoint);
    return out.filter(function (el) {
      return range.comparePoint(el, 0) === 1;
    });
  }

  function isWhitespaceText(node) {
    return node.nodeType === 3 && !/\S/.test(node.data);
  }

  // A sibling that is chrome, not content: inline, with no block inside it (the
  // "Section N" label beside an h2 in a sheet-head).
  function isInlineChrome(node) {
    if (node.nodeType === 8 || isWhitespaceText(node)) return "neutral";
    if (!isElement(node)) return "no";
    if (isNotContent(node)) return "chrome";
    if (hasOwn(BLOCK_TAGS, tagOf(node)) || hasBlockInside(node)) return "no";
    return "chrome";
  }

  // The parent holds only `el` plus at least one piece of inline chrome.
  function parentIsChromeWrapper(el) {
    var parent = el.parentNode;
    if (!isElement(parent)) return false;
    var tag = tagOf(parent);
    if (tag === "body" || tag === "main" || tag === "html") return false;
    var chrome = 0;
    for (var node = parent.firstChild; node; node = node.nextSibling) {
      if (node === el) continue;
      var kind = isInlineChrome(node);
      if (kind === "no") return false;
      if (kind === "chrome") chrome += 1;
    }
    return chrome > 0;
  }

  /**
   * Where a new block after `anchor` goes: right after it, or, when the anchor
   * sits in a wrapper that holds only it and inline chrome (a sheet-head), after
   * that wrapper.
   *
   * @returns {{parent: Node, before: Node|null}}
   */
  function insertPointAfter(anchor) {
    var el = anchor;
    while (parentIsChromeWrapper(el)) el = el.parentNode;
    return { parent: el.parentNode, before: el.nextSibling };
  }

  // Leading chrome at a container's start: the marked title, or a wrapper whose
  // only content is the marked title (the hero of an empty notes page).
  function isLeadingChrome(node) {
    if (node.nodeType === 8 || isWhitespaceText(node)) return true;
    if (!isElement(node)) return false;
    if (isNotContent(node) || markers.isFileTitle(node)) return true;
    if (!hasOwn(BLOCK_TAGS, tagOf(node))) return false;
    var sawTitle = false;
    for (var child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 8 || isWhitespaceText(child)) continue;
      if (!isElement(child)) return false;
      if (markers.isFileTitle(child)) {
        sawTitle = true;
        continue;
      }
      if (isNotContent(child)) continue;
      if (wordsOf(child)) return false;
    }
    return sawTitle;
  }

  /**
   * The start of a container, after any leading chrome.
   *
   * @returns {{parent: Node, before: Node|null}}
   */
  function startPointIn(container) {
    var node = container.firstChild;
    while (node && isLeadingChrome(node)) node = node.nextSibling;
    return { parent: container, before: node || null };
  }

  function isContainerAnchor(anchor) {
    var tag = tagOf(anchor);
    return tag === "main" || tag === "body";
  }

  /**
   * The editing host: the parent of the element insertPointAfter climbed to,
   * or the container itself for a container anchor.
   */
  function hostFor(anchor, placement) {
    if (placement === "start_of_container" || isContainerAnchor(anchor)) return anchor;
    return insertPointAfter(anchor).parent;
  }

  /** False when the host cannot hold flow content (a table cell, a caption). */
  function canHoldRun(anchor, placement) {
    if (!isElement(anchor)) return false;
    if (hasOwn(NO_RUN_TAGS, tagOf(anchor))) return false;
    var host = hostFor(anchor, placement);
    if (!isElement(host)) return false;
    var tag = tagOf(host);
    return !hasOwn(NO_RUN_TAGS, tag) && !hasOwn(NO_RUN_HOSTS, tag);
  }

  /**
   * The one way to find a record's run on the live page.
   *
   * The walk starts at the anchor's insert point (or the container's start for
   * start_of_container) and the shared matcher decides each block. A take-back
   * matches its remove_blocks.
   *
   * @param {Object} rec the record: new_blocks or remove_blocks, and placement
   * @param {Document} doc
   * @param {Element} anchor the resolved anchor (the container, for a container anchor)
   * @returns {{start: {parent: Node, before: Node|null}, blocks: Array<{index: number, status: string, elements: Element[]}>}}
   */
  function runWalk(rec, doc, anchor) {
    var r = rec || {};
    var list = Array.isArray(r.remove_blocks) && r.remove_blocks.length ? r.remove_blocks : Array.isArray(r.new_blocks) ? r.new_blocks : [];
    var start = r.placement === "start_of_container" ? startPointIn(anchor) : insertPointAfter(anchor);
    var scope = (doc && doc.body) || anchor.ownerDocument.body;
    var leaves = leafWalk(scope, start);
    var described = leaves.map(function (el) {
      return { tag: tagOf(el), html: normalize.cleanMarkup(el.innerHTML), words: wordsOf(el) };
    });
    return { list: list, start: start, leaves: leaves, described: described };
  }

  function runElementsFor(rec, doc, anchor) {
    var walk = runWalk(rec, doc, anchor);
    var start = walk.start;
    var leaves = walk.leaves;
    var matched = normalize.matchRun(walk.list, walk.described);
    return {
      start: start,
      blocks: matched.map(function (m) {
        return {
          index: m.index,
          status: m.status,
          elements: m.leaves.map(function (i) {
            return leaves[i];
          })
        };
      })
    };
  }

  /**
   * The live twin of normalize.runClash: the leaf after the insert point that
   * holds a run block's words plus words the reviewer never typed. A take-back
   * never clashes (it only removes blocks found one to one).
   *
   * @returns {{index: number, blocks: number, element: Element}|null}
   */
  function runClashFor(rec, doc, anchor) {
    if (rec && Array.isArray(rec.remove_blocks) && rec.remove_blocks.length) return null;
    var walk = runWalk(rec, doc, anchor);
    var clash = normalize.runClash(walk.list, walk.described);
    if (!clash) return null;
    return { index: clash.index, blocks: clash.blocks, element: walk.leaves[clash.leaf] };
  }

  function writableTag(tag) {
    var lower = typeof tag === "string" ? tag.toLowerCase() : "";
    var at = WRITABLE.indexOf(lower);
    return at === -1 ? null : WRITABLE[at];
  }

  function decodeText(text) {
    return text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  }

  /**
   * A new block element, from a tag and cleaned-or-not html. The html goes
   * through normalize.cleanBlock first; the element is then built from the
   * allowlist's constants and text nodes. Null when cleanBlock refuses.
   */
  function writeBlock(tag, html, doc) {
    var name = writableTag(tag);
    if (!name) return null;
    var cleaned = normalize.cleanBlock(name, html);
    if (typeof cleaned.html !== "string") return null;
    var d = doc || (typeof document !== "undefined" ? document : null);
    var el = d.createElement(name);
    var stack = [el];
    var parts = cleaned.html.split(/(<\/?[a-z-]+>)/);
    for (var i = 0; i < parts.length; i += 1) {
      var part = parts[i];
      if (!part) continue;
      var m = /^<(\/?)([a-z-]+)>$/.exec(part);
      if (!m) {
        stack[stack.length - 1].appendChild(d.createTextNode(decodeText(part)));
        continue;
      }
      if (!hasOwn(INLINE_BUILD, m[2])) return null;
      if (m[1]) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      var child = d.createElement(INLINE_BUILD[m[2]]);
      stack[stack.length - 1].appendChild(child);
      if (m[2] !== "br") stack.push(child);
    }
    return el;
  }

  /**
   * Change an element's tag in place. The tag must be one of the six writable
   * ones. Every attribute (the data-lahe-id stamp included) and every child
   * moves to the new element, which takes the old one's place. Null, and
   * nothing changed, when the tag is refused.
   */
  function swapTag(el, tag) {
    var name = writableTag(tag);
    if (!name || !isElement(el) || !el.parentNode) return null;
    if (tagOf(el) === name) return el;
    var next = el.ownerDocument.createElement(name);
    for (var i = 0; i < el.attributes.length; i += 1) {
      next.setAttribute(el.attributes[i].name, el.attributes[i].value);
    }
    while (el.firstChild) next.appendChild(el.firstChild);
    el.parentNode.replaceChild(next, el);
    return next;
  }

  return {
    NO_RUN_TAGS: NO_RUN_TAGS,
    leafWalk: leafWalk,
    isLeaf: isLeaf,
    insertPointAfter: insertPointAfter,
    startPointIn: startPointIn,
    hostFor: hostFor,
    canHoldRun: canHoldRun,
    isContainerAnchor: isContainerAnchor,
    runElementsFor: runElementsFor,
    runClashFor: runClashFor,
    writeBlock: writeBlock,
    swapTag: swapTag
  };
});
