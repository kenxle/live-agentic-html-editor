// Highlights that do not change the page, and the library's one contact
// surface with the page's own document.
//
// Owner: 1D. Implements architecture D8 (highlights that do not change the
// page), which grounds R14 (the library does not change how the page looks) and
// part of R15 (it keeps working while the page changes underneath).
//
// ---------------------------------------------------------------------------
// The rule: NO WRAPPER ELEMENTS, EVER
// ---------------------------------------------------------------------------
//
// A comment highlight paints through the CSS Custom Highlight API, which colors
// a Range without putting anything in the DOM. The alternative, wrapping the
// range in a span, fails twice over: it mutates the DOM the page's own
// framework is diffing, and the wrapper leaks into any markup a record carries.
// So there is no code path here that creates an element inside reviewed
// content, and ranked test 18 scores it from the outside: every block's
// bounding rectangle and the page's scrollHeight are identical with and without
// the library.
//
// This is the one capability with a browser floor. Current Chrome, Edge,
// Safari, and Firefox all have the API; anything older fails loud here rather
// than silently leaving comments unpainted.
//
// ---------------------------------------------------------------------------
// D8's ONE named exception, and it lives in this file
// ---------------------------------------------------------------------------
//
// ::highlight() rules only work from a stylesheet in the page's own document; a
// shadow root cannot provide them. So the library adds exactly one page-level
// stylesheet, containing only its own namespaced highlight rules, marked as the
// library's, and removed on teardown. That is the only page-level stylesheet
// the library ever adds, and ranked test 18 asserts the count rather than
// asserting zero.
//
// The highlight names are namespaced (`lahe-`) so a page using the API itself
// cannot collide with ours, and ours cannot quietly overwrite theirs.
//
// The library's UI (boxes, rail, pick-mode outline) does NOT go here in the
// page's document: it goes inside one closed shadow root, which this file also
// owns because it is the same question. One host element, created once, marked
// as the library's, holding everything the library draws. The page's CSS cannot
// reach into it and its CSS cannot reach the page.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.highlight = factory(root.LAHE.markers);
  } else {
    module.exports = factory(require("../shared/markers.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers) {
  "use strict";

  // The namespace. Every name the library registers starts with this, so a page
  // that uses the Custom Highlight API for its own purposes is untouched.
  var PREFIX = "lahe-";

  var NAME = {
    // A passage a comment is attached to.
    COMMENT: PREFIX + "comment",
    // The one whose box is open. Quieter than a selection, louder than the rest.
    ACTIVE: PREFIX + "comment-active"
  };
  var NAMES = [NAME.COMMENT, NAME.ACTIVE];

  // The marked page-level stylesheet. Both attributes matter: `data-lahe` is
  // the one spelling of "this node is ours" that the normalizer strips, and
  // `data-lahe-highlight` is what ranked test 18 identifies the ONE allowed
  // page-level addition by.
  var STYLE_ID = "lahe-highlight-styles";
  var STYLE_ATTR = "data-lahe-highlight";

  // The shadow host. Fixed and zero-weight in layout terms: a fixed element is
  // out of flow, so it cannot move a block or change scrollHeight, and pointer
  // events pass through it except where the library actually draws something.
  var SURFACE_ID = "lahe-surface-root";

  // Highlight colors, as light a touch as a highlight can be and still read.
  // Written with color-mix-free plain rgba so a page-level stylesheet cannot
  // depend on anything the host page defines.
  var STYLE_TEXT = [
    "::highlight(" + NAME.COMMENT + ") {",
    "  background-color: rgba(255, 202, 84, 0.34);",
    "  color: inherit;",
    "}",
    "::highlight(" + NAME.ACTIVE + ") {",
    "  background-color: rgba(255, 178, 26, 0.46);",
    "  color: inherit;",
    "}"
  ].join("\n");

  function createHighlights(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);

    // id -> {name, range}. One entry per item, so clearing one item's paint is
    // a lookup rather than a re-scan.
    var painted = Object.create(null);
    var styleNode = null;
    var surfaceHost = null;
    var surfaceRoot = null;
    var surfaceStyles = Object.create(null);

    function global() {
      return typeof window !== "undefined" ? window : null;
    }

    // The API, or an honest answer about why not. Checked as a function rather
    // than remembered as a flag so a test can ask.
    function supported() {
      var g = global();
      if (!g || !doc) return false;
      return !!(g.CSS && g.CSS.highlights && typeof g.Highlight === "function");
    }

    function requireSupport() {
      if (!supported()) {
        throw new Error(
          "highlight: this browser has no CSS Custom Highlight API (CSS.highlights and Highlight). " +
            "Comment highlights need it, and wrapping the range in an element instead is exactly what D8 forbids. " +
            "Current Chrome, Edge, Safari, and Firefox all have it."
        );
      }
    }

    // ------------------------------------------------------------------------
    // D8's named exception: one page-level stylesheet
    // ------------------------------------------------------------------------

    function ensureStylesheet() {
      if (!doc) return null;
      if (styleNode && styleNode.parentNode) return styleNode;
      var existing = doc.getElementById(STYLE_ID);
      if (existing) {
        styleNode = existing;
        return styleNode;
      }
      var el = doc.createElement("style");
      el.id = STYLE_ID;
      el.setAttribute(STYLE_ATTR, "");
      markers.markChrome(el);
      el.textContent = STYLE_TEXT;
      (doc.head || doc.documentElement).appendChild(el);
      styleNode = el;
      return styleNode;
    }

    function removeStylesheet() {
      if (styleNode && styleNode.parentNode) styleNode.parentNode.removeChild(styleNode);
      styleNode = null;
    }

    // ------------------------------------------------------------------------
    // Painting
    // ------------------------------------------------------------------------

    function registryFor(name) {
      var g = global();
      var current = g.CSS.highlights.get(name);
      if (!current) {
        current = new g.Highlight();
        g.CSS.highlights.set(name, current);
      }
      return current;
    }

    // Rebuilds one name's Highlight from the ranges we still hold. Rebuilding
    // rather than deleting is deliberate: a Highlight whose last range is
    // removed stays registered and empty, so `CSS.highlights` keeps a stable
    // set of names and a test can tell "nothing painted" from "never ran".
    function rebuild(name) {
      var g = global();
      var highlight = registryFor(name);
      highlight.clear();
      Object.keys(painted).forEach(function (id) {
        if (painted[id].name === name && painted[id].range) highlight.add(painted[id].range);
      });
      g.CSS.highlights.set(name, highlight);
      return highlight;
    }

    /**
     * Paints one item's range. Nothing enters the DOM.
     *
     * @param {string} id    the record's id
     * @param {Range} range  a live Range over reviewed content
     * @param {string} [name] one of NAMES; defaults to the comment paint
     */
    function paint(id, range, name) {
      requireSupport();
      if (!id) throw new TypeError("highlight.paint: an item id is required");
      if (!range || typeof range.cloneRange !== "function") {
        throw new TypeError("highlight.paint: a live Range is required");
      }
      var which = NAMES.indexOf(name) === -1 ? NAME.COMMENT : name;
      ensureStylesheet();
      var previous = painted[id];
      painted[id] = { name: which, range: range };
      if (previous && previous.name !== which) rebuild(previous.name);
      rebuild(which);
      return painted[id];
    }

    // Moves one item between the two paints (open box versus the rest) without
    // touching its range.
    function setActive(id, isActive) {
      var entry = painted[id];
      if (!entry) return null;
      return paint(id, entry.range, isActive ? NAME.ACTIVE : NAME.COMMENT);
    }

    function clear(id) {
      var entry = painted[id];
      if (!entry) return false;
      delete painted[id];
      if (supported()) rebuild(entry.name);
      return true;
    }

    function clearAll() {
      Object.keys(painted).forEach(function (id) {
        delete painted[id];
      });
      if (supported()) NAMES.forEach(rebuild);
    }

    function rangeFor(id) {
      return painted[id] ? painted[id].range : null;
    }

    function paintedIds() {
      return Object.keys(painted);
    }

    // ------------------------------------------------------------------------
    // The library's one shadow surface
    // ------------------------------------------------------------------------
    //
    // Closed, so the page's own scripts cannot reach in and the library's DOM
    // cannot be styled by the page. The root is kept in this closure because a
    // closed root is not readable from the element, which is the point.

    function surface() {
      if (!doc) return { host: null, root: null };
      if (surfaceRoot && surfaceHost && surfaceHost.parentNode) {
        return { host: surfaceHost, root: surfaceRoot };
      }
      var host = doc.createElement("div");
      host.id = SURFACE_ID;
      markers.markChrome(host);
      // Inline, not from a stylesheet: the page-level stylesheet budget is one
      // and it is spent on the highlight rules. A style attribute on the
      // library's own host is not a page-level addition and never reaches a
      // record, because the whole node is chrome.
      host.setAttribute(
        "style",
        [
          "position:fixed",
          "inset:0",
          "pointer-events:none",
          "z-index:2147483000",
          "border:0",
          "margin:0",
          "padding:0",
          "background:transparent"
        ].join(";")
      );
      var root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : null;
      (doc.body || doc.documentElement).appendChild(host);
      surfaceHost = host;
      surfaceRoot = root;
      return { host: surfaceHost, root: surfaceRoot };
    }

    // Adds a stylesheet INSIDE the shadow root, once per key. Every caller's
    // styles land here rather than in the page, which is what keeps the
    // page-level count at one.
    function addSurfaceStyle(key, cssText) {
      var s = surface();
      if (!s.root) return null;
      if (surfaceStyles[key]) return surfaceStyles[key];
      var el = doc.createElement("style");
      el.textContent = cssText;
      s.root.appendChild(el);
      surfaceStyles[key] = el;
      return el;
    }

    function teardown() {
      clearAll();
      removeStylesheet();
      if (surfaceHost && surfaceHost.parentNode) surfaceHost.parentNode.removeChild(surfaceHost);
      surfaceHost = null;
      surfaceRoot = null;
      surfaceStyles = Object.create(null);
    }

    return {
      NAME: NAME,
      NAMES: NAMES,
      STYLE_ID: STYLE_ID,
      STYLE_ATTR: STYLE_ATTR,
      SURFACE_ID: SURFACE_ID,
      supported: supported,
      ensureStylesheet: ensureStylesheet,
      paint: paint,
      setActive: setActive,
      clear: clear,
      clearAll: clearAll,
      rangeFor: rangeFor,
      paintedIds: paintedIds,
      surface: surface,
      addSurfaceStyle: addSurfaceStyle,
      teardown: teardown
    };
  }

  var shared = createHighlights();

  return {
    PREFIX: PREFIX,
    NAME: NAME,
    NAMES: NAMES,
    STYLE_ID: STYLE_ID,
    STYLE_ATTR: STYLE_ATTR,
    SURFACE_ID: SURFACE_ID,
    STYLE_TEXT: STYLE_TEXT,
    createHighlights: createHighlights,
    shared: shared
  };
});
