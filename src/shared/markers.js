// Markers: the attribute and class names that identify DOM the tool added.
//
// Owner: Task 0a (shared kernel). Imported by: normalize (cleanMarkup strips
// these), overlay, editing, replay, inject.
//
// R33 says nothing the tool adds to the page can end up in the reviewer's
// feedback. That is only enforceable if there is exactly one spelling of "this
// node is ours", so it is spelled here and nowhere else.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root) {
  "use strict";

  var browser = typeof window !== "undefined" && !!window.document;

  // The one attribute that says a node belongs to the tool. Its value is the
  // node's role, which decides what cleanMarkup does with it.
  var TOOL_ATTR = "data-lahe";

  // Roles.
  //   chrome: tool furniture (a chip, a handle, a rail). Dropped with its
  //           subtree on capture, because none of it is the reviewer's content.
  //   wrap:   a wrapper the tool put around reviewed content (a highlight
  //           span). Unwrapped on capture: the tag goes, the children stay.
  var ROLE_CHROME = "chrome";
  var ROLE_WRAP = "wrap";

  // Every attribute starting with this prefix is stripped on capture.
  var TOOL_ATTR_PREFIX = "data-lahe";

  // Every class token starting with this prefix is stripped on capture.
  var TOOL_CLASS_PREFIX = "lahe-";

  // The overlay root's id. One per page (Task 2C asserts exactly one after
  // 100 morphs).
  var OVERLAY_ROOT_ID = "lahe-overlay-root";

  // Set on a region while the reviewer is editing it (architecture D3). Turbo
  // reads data-turbo-permanent natively; the tool's own attribute is what the
  // veto handler and replay check, because data-turbo-permanent alone does not
  // say who put it there.
  var PROTECTED_ATTR = "data-lahe-protected";
  var TURBO_PERMANENT_ATTR = "data-turbo-permanent";

  // Author-supplied region name. NOT a tool attribute: a page author may put
  // it on their own markup to give a region a stable label. It is never
  // written by the tool and never stripped on capture.
  var AUTHOR_REGION_ATTR = "data-review-region";

  function isToolAttrName(name) {
    if (typeof name !== "string") return false;
    return name.toLowerCase().indexOf(TOOL_ATTR_PREFIX) === 0;
  }

  function isToolClassToken(token) {
    if (typeof token !== "string") return false;
    return token.indexOf(TOOL_CLASS_PREFIX) === 0;
  }

  function roleOf(el) {
    if (!el || typeof el.getAttribute !== "function") return null;
    var v = el.getAttribute(TOOL_ATTR);
    return v === ROLE_CHROME || v === ROLE_WRAP ? v : null;
  }

  function isToolNode(el) {
    return roleOf(el) !== null;
  }

  // True when el is the overlay root or lives inside it. Anything under the
  // overlay root is tool DOM by construction, marker or not.
  function isInsideOverlay(el) {
    var node = el;
    while (node && node.nodeType === 1) {
      if (node.id === OVERLAY_ROOT_ID || isToolNode(node)) return true;
      node = node.parentNode;
    }
    return false;
  }

  function markChrome(el) {
    if (el && typeof el.setAttribute === "function") el.setAttribute(TOOL_ATTR, ROLE_CHROME);
    return el;
  }

  function markWrap(el) {
    if (el && typeof el.setAttribute === "function") el.setAttribute(TOOL_ATTR, ROLE_WRAP);
    return el;
  }

  var api = {
    TOOL_ATTR: TOOL_ATTR,
    TOOL_ATTR_PREFIX: TOOL_ATTR_PREFIX,
    TOOL_CLASS_PREFIX: TOOL_CLASS_PREFIX,
    ROLE_CHROME: ROLE_CHROME,
    ROLE_WRAP: ROLE_WRAP,
    OVERLAY_ROOT_ID: OVERLAY_ROOT_ID,
    PROTECTED_ATTR: PROTECTED_ATTR,
    TURBO_PERMANENT_ATTR: TURBO_PERMANENT_ATTR,
    AUTHOR_REGION_ATTR: AUTHOR_REGION_ATTR,
    isToolAttrName: isToolAttrName,
    isToolClassToken: isToolClassToken,
    roleOf: roleOf,
    isToolNode: isToolNode,
    isInsideOverlay: isInsideOverlay,
    markChrome: markChrome,
    markWrap: markWrap
  };

  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.markers = api;
  } else {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
