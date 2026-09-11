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
// stylesheet, marked as the library's, and removed on teardown. That is the
// only page-level stylesheet the library ever adds, and ranked test 18 asserts
// the count rather than asserting zero.
//
// It holds the namespaced highlight rules and, since 2026-08-23, two more:
// what <not-bold> and <not-italic> mean. They are here for the same reason the
// highlight rules are, which is that a page-level rule is the only place they
// can work from, and they are safe here for a reason of their own: they can
// only ever match an element the library itself put on the page at the
// reviewer's request. The reasoning is beside them, at STYLE_TEXT.
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
// Print: the whole shadow surface (the rail, the boxes, the pick outline, the
// tab panes, all of it) is one host, so hiding it for print is one `:host`
// rule scoped to `@media print`, added inside the shadow root when the surface
// is built. The wash the highlight rules above paint is scoped the other way,
// to `@media not print`, for the same reason: a printed page is the document
// changing hands, not the document plus what a reviewer marked up on it.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.highlight = factory(root.LAHE.markers, root.LAHE.normalize);
  } else {
    module.exports = factory(require("../shared/markers.js"), require("../shared/normalize.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, normalize) {
  "use strict";

  // The namespace. Every name the library registers starts with this, so a page
  // that uses the Custom Highlight API for its own purposes is untouched.
  var PREFIX = "lahe-";

  var NAME = {
    // A passage a comment is attached to.
    COMMENT: PREFIX + "comment",
    // The one whose box is open. Quieter than a selection, louder than the rest.
    ACTIVE: PREFIX + "comment-active",
    // "Here it is": the passage a card was just clicked to find. It lasts about
    // a second and a half and then it is gone, so it never becomes a third
    // permanent state a reviewer has to learn.
    EMPHASIS: PREFIX + "emphasis",
    // "This is what just changed." Painted on a block whose words are new or
    // different after the agent's rebuild, and gone a couple of seconds later.
    // The two names after it are the same mark, fading: see CHANGED_STEPS.
    CHANGED: PREFIX + "changed",
    CHANGED_FADING: PREFIX + "changed-fading",
    CHANGED_FAINT: PREFIX + "changed-faint"
  };
  var NAMES = [
    NAME.COMMENT,
    NAME.ACTIVE,
    NAME.EMPHASIS,
    NAME.CHANGED,
    NAME.CHANGED_FADING,
    NAME.CHANGED_FAINT
  ];

  // How long the "here it is" wash stays up. Long enough to find with the eye
  // after a smooth scroll, short enough that it cannot be mistaken for state.
  var EMPHASIS_MS = 1500;

  // How long a changed block stays lit. Long enough to find with the eye on a
  // page that just replaced itself, short enough that it is gone before the
  // reviewer starts reading and cannot be mistaken for a state of the record.
  var CHANGED_MS = 2500;

  // The fade, as steps rather than as a transition.
  //
  // A ::highlight() rule is not an element and engines do not animate one
  // reliably, so the mark is moved between three rules of decreasing strength
  // and then removed. Three steps read as a fade at this duration; more would be
  // more timers for something nobody is watching closely.
  //
  // Each entry is {at: fraction of the hold, name}. Under
  // prefers-reduced-motion the steps are skipped: the mark holds at full
  // strength for the same time and then goes, so the information is identical
  // and nothing moves.
  var CHANGED_STEPS = [
    { at: 0.55, name: NAME.CHANGED_FADING },
    { at: 0.8, name: NAME.CHANGED_FAINT }
  ];

  // Changed marks live under their own key prefix, so a block's change paint
  // and a record's comment paint are separate entries and clearing one never
  // disturbs the other. No record id can collide with it.
  var CHANGED_PREFIX = "__lahe_changed__:";

  // The one reserved key in the painted map. An item's own paint is keyed by its
  // record id, so the emphasis rides on a key no record can have: emphasizing a
  // passage must not disturb the comment highlight already on it.
  var EMPHASIS_KEY = "__lahe_emphasis__";

  // The marked page-level stylesheet. Both attributes matter: `data-lahe` is
  // the one spelling of "this node is ours" that the normalizer strips, and
  // `data-lahe-highlight` is what ranked test 18 identifies the ONE allowed
  // page-level addition by.
  var STYLE_ID = "lahe-highlight-styles";
  var STYLE_ATTR = "data-lahe-highlight";

  // The shadow host. Fixed and zero-weight in layout terms: a fixed element is
  // out of flow, so it cannot move a block or change scrollHeight, and pointer
  // events pass through it except where the library actually draws something.
  //
  // The id is markers.OVERLAY_ROOT_ID, not a second spelling of the same idea.
  // There is ONE host on the page and this module owns it: the rail mounts
  // inside this root rather than creating a host of its own, which is also the
  // one host 2D's remount contract re-creates.
  var SURFACE_ID = markers.OVERLAY_ROOT_ID;

  // Hides the whole surface for print. Lives inside the surface's own closed
  // root and reads :host, which from in there means "the element this shadow
  // root belongs to": the one div at SURFACE_ID, so the rail, the comment
  // boxes, the pick-mode outline and everything else the library ever draws
  // goes with it, without naming any of them.
  var PRINT_HOST_STYLE_TEXT = ["@media print {", "  :host { display: none !important; }", "}"].join("\n");

  // Highlight colors, as light a touch as a highlight can be and still read.
  // Written with color-mix-free plain rgba so a page-level stylesheet cannot
  // depend on anything the host page defines.
  //
  // THE PAGE-SIDE MARKS ARE THE ACCENT, NOT THE AMBER. The rail spends amber on
  // one thing only, "this needs you", and a commented passage does not need
  // anyone: it is a selection the reviewer made. An amber wash on the page and
  // an amber pill in the rail inches away are two languages for one colour, and
  // the reviewer has to learn which is which. So the wash is the same indigo the
  // rail's accent is, and it reads as ours rather than as a warning.
  // Wrapped in one `@media not print` condition rather than left bare: a
  // printed page is the document changing hands, and a reviewer's wash over
  // someone else's sentence does not belong in what gets handed over. Printing
  // the page is also the moment the wash would be least useful even to the
  // reviewer, since nothing on paper is clickable back to the comment it marks.
  // Wrapping is deliberate over deleting the rules outright: under screen media
  // the three rules are unchanged, and this is still the one page-level
  // stylesheet holding only namespaced highlight rules (D8), just scoped to
  // when they should paint.
  var STYLE_TEXT = [
    "@media not print {",
    "::highlight(" + NAME.COMMENT + ") {",
    "  background-color: rgba(60, 86, 165, 0.15);",
    "  color: inherit;",
    "}",
    "::highlight(" + NAME.ACTIVE + ") {",
    "  background-color: rgba(60, 86, 165, 0.26);",
    "  color: inherit;",
    "}",
    // The same accent again, at its strongest, and NOTHING that moves: no
    // animation, no outline, no border. A wash cannot shift the page's layout,
    // which is D8's whole point, and a flashing page is not an answer to "where
    // is this comment".
    "::highlight(" + NAME.EMPHASIS + ") {",
    "  background-color: rgba(60, 86, 165, 0.38);",
    "  color: inherit;",
    "}",
    // THE CHANGED MARK IS THE ONE YELLOW, and it is yellow on purpose. The
    // indigo above is the reviewer's own language: I selected this, I commented
    // here. A change is not theirs, it is the agent answering them, and it has
    // to be legible as something else at a glance. A highlighter yellow is what
    // a person reaches for when they mark what moved, it cannot be confused
    // with the indigo wash an inch away, and it still reads as a mark over text
    // rather than as an alarm.
    //
    // Translucent, like the rest: the words underneath are the point, and a
    // wash never changes a single measurement on the page (D8).
    "::highlight(" + NAME.CHANGED + ") {",
    "  background-color: rgba(250, 204, 21, 0.55);",
    "  color: inherit;",
    "}",
    "::highlight(" + NAME.CHANGED_FADING + ") {",
    "  background-color: rgba(250, 204, 21, 0.32);",
    "  color: inherit;",
    "}",
    "::highlight(" + NAME.CHANGED_FAINT + ") {",
    "  background-color: rgba(250, 204, 21, 0.14);",
    "  color: inherit;",
    "}",
    "}",
    // D8's exception, second half, added 2026-08-23.
    //
    // These two rules are the only thing in this file that is not a highlight,
    // and they are here because they are the same question: a page-level rule
    // is the only place they can work from. HTML has no element that means "not
    // bold", so a reviewer taking bold off a phrase that a page stylesheet made
    // bold has nothing to say it with. The layer writes <not-bold> (see the
    // mint note in normalize.js) and these rules are what make it true on the
    // page. Without them the reviewer presses B, a record appears in the rail,
    // and the words in front of them do not change.
    //
    // D8's guarantee is intact: the page still renders exactly as it does
    // without the library, because these can only match an element the library
    // itself put there at the reviewer's request. They go with the sheet on
    // teardown, like everything else here.
    normalize.NOT_BOLD_TAG + " { font-weight: normal; }",
    normalize.NOT_ITALIC_TAG + " { font-style: normal; }"
  ].join("\n");

  // ---------------------------------------------------------------------------
  // Which scheme the library draws in
  // ---------------------------------------------------------------------------
  //
  // THE PAGE DECIDES, NOT THE OS. The system preference is the right signal for
  // an application that owns its window and the wrong one for a tool sitting
  // over someone else's page: with the OS in dark and the reviewed page in light
  // (the common case, because most apps ship no dark stylesheet), every surface
  // the library draws becomes a black slab on a white page, which is the loudest
  // possible way to be a polite overlay.
  //
  // So the page's own effective background is sampled and the scheme matched to
  // it. The system preference is the tiebreak, used only when the page says
  // nothing readable, which is what a transparent body over a transparent root
  // amounts to.
  var SCHEME_ATTR = "data-lahe-scheme";

  // How wide a berth everything else has to give the rail, in CSS pixels,
  // published on the ONE page-level host as a custom property.
  //
  // The rail is resizable, so its width is no longer a number another file can
  // hardcode. The rail writes this whenever its width changes (overlay.js) and
  // the other surfaces read it back (comments.js: the anchored box and the
  // selection pill). It lives HERE because the host it is written on is this
  // file's, and because a property name spelled twice is a property name that
  // will eventually be spelled two ways.
  //
  // It is the rail's width PLUS the gap it keeps from the viewport edge, so a
  // reader can treat it as "distance from the right edge that is spoken for".
  var RAIL_ALLOWANCE_PROP = "--lahe-rail-allowance";

  /** rgb()/rgba() as {r,g,b,a}, or null for anything else (including keywords). */
  function parseColor(value) {
    if (!value || typeof value !== "string") return null;
    var m = value.replace(/\s+/g, "").match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/i);
    if (!m) return null;
    return {
      r: Number(m[1]),
      g: Number(m[2]),
      b: Number(m[3]),
      a: m[4] === undefined ? 1 : Number(m[4])
    };
  }

  /** Perceived lightness, 0 (black) to 1 (white). The sRGB luma weights. */
  function luminance(color) {
    return (0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b) / 255;
  }

  function systemScheme(win) {
    if (win && typeof win.matchMedia === "function") {
      try {
        if (win.matchMedia("(prefers-color-scheme: dark)").matches) return "dark";
      } catch (e) {
        // A window with no media-query support says nothing, which is light.
      }
    }
    return "light";
  }

  /**
   * The scheme the library should draw in on THIS page.
   *
   * @returns {"light"|"dark"}
   */
  function schemeForPage(doc, win) {
    if (!doc || typeof win === "undefined" || !win || typeof win.getComputedStyle !== "function") {
      return systemScheme(win);
    }
    var candidates = [doc.body, doc.documentElement];
    for (var i = 0; i < candidates.length; i += 1) {
      if (!candidates[i]) continue;
      var color = parseColor(win.getComputedStyle(candidates[i]).backgroundColor);
      // A fully transparent background is the page declining to answer, so the
      // next candidate is asked and the system preference is the last word.
      if (!color || color.a < 0.5) continue;
      return luminance(color) < 0.5 ? "dark" : "light";
    }
    return systemScheme(win);
  }

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

    // ------------------------------------------------------------------------
    // "Here it is": the short-lived emphasis
    // ------------------------------------------------------------------------
    //
    // Clicking a card scrolls the page to where the card points and washes the
    // passage for a moment. It is a paint and nothing else: no wrapper, no
    // style on the page's own nodes, no layout touched.

    var emphasisTimer = null;

    /**
     * Wash one range, briefly.
     *
     * @param {Range} range a live Range over reviewed content
     * @param {number} [ms] how long to hold it; EMPHASIS_MS by default
     * @returns {Range|null} the range now emphasized, or null when there is none
     */
    function emphasize(range, ms) {
      if (!range || typeof range.cloneRange !== "function") return null;
      if (!supported()) return null;
      // A second click replaces the first rather than stacking two washes and
      // two timers, so the last thing clicked is the thing lit.
      clearEmphasis();
      paint(EMPHASIS_KEY, range, NAME.EMPHASIS);
      var g = global();
      var hold = typeof ms === "number" && ms > 0 ? ms : EMPHASIS_MS;
      if (g && typeof g.setTimeout === "function") {
        emphasisTimer = g.setTimeout(function () {
          emphasisTimer = null;
          clearEmphasis();
        }, hold);
      }
      return range;
    }

    function clearEmphasis() {
      var g = global();
      if (emphasisTimer && g && typeof g.clearTimeout === "function") g.clearTimeout(emphasisTimer);
      emphasisTimer = null;
      return clear(EMPHASIS_KEY);
    }

    /** The range wearing the emphasis right now, or null. For tests and probes. */
    function emphasisRange() {
      return rangeFor(EMPHASIS_KEY);
    }

    function paintedIds() {
      return Object.keys(painted);
    }

    // ------------------------------------------------------------------------
    // "This is what just changed": the attention mark
    // ------------------------------------------------------------------------
    //
    // The agent edits the source, the page rebuilds, LAHE reloads it, and the
    // reviewer is looking at a page that is different in a way they asked for
    // and cannot see. This is what puts their eye on it: a highlighter mark over
    // the words that are new or different, which fades out and is gone.
    //
    // Same rules as every other paint here. Nothing enters the DOM, nothing is
    // styled on the page's own nodes, and the mark is removed on a timer whether
    // or not anything else happens.

    // key -> the timers still owed to it.
    var changedTimers = Object.create(null);

    function changedKeyFor(key) {
      return CHANGED_PREFIX + String(key);
    }

    function reducedMotion() {
      var g = opts.window || global();
      try {
        if (!g || typeof g.matchMedia !== "function") return false;
        return !!g.matchMedia("(prefers-reduced-motion: reduce)").matches;
      } catch (error) {
        return false;
      }
    }

    /**
     * Mark one range as changed, and let it fade.
     *
     * @param {string} key   anything unique for this block; its own text does
     *                       nicely, since two identical blocks are one mark
     * @param {Range} range  a live Range over the changed words
     * @param {number} [ms]  how long to hold it; CHANGED_MS by default
     * @returns {boolean} true when the mark went on
     */
    function markChanged(key, range, ms) {
      if (!key) return false;
      if (!range || typeof range.cloneRange !== "function") return false;
      if (!supported()) return false;
      var id = changedKeyFor(key);
      clearChanged(key);
      paint(id, range, NAME.CHANGED);
      var hold = typeof ms === "number" && ms > 0 ? ms : CHANGED_MS;
      var g = global();
      if (!g || typeof g.setTimeout !== "function") return true;
      var timers = [];
      if (!reducedMotion()) {
        CHANGED_STEPS.forEach(function (step) {
          timers.push(
            g.setTimeout(function () {
              if (painted[id]) paint(id, painted[id].range, step.name);
            }, Math.round(hold * step.at))
          );
        });
      }
      timers.push(
        g.setTimeout(function () {
          clearChanged(key);
        }, hold)
      );
      changedTimers[id] = timers;
      return true;
    }

    function clearChanged(key) {
      var id = changedKeyFor(key);
      var g = global();
      var timers = changedTimers[id];
      if (timers && g && typeof g.clearTimeout === "function") timers.forEach(g.clearTimeout.bind(g));
      delete changedTimers[id];
      return clear(id);
    }

    function clearAllChanged() {
      Object.keys(changedTimers).forEach(function (id) {
        clearChanged(id.slice(CHANGED_PREFIX.length));
      });
      // A mark whose timers are already spent but whose paint is still up.
      Object.keys(painted).forEach(function (id) {
        if (id.indexOf(CHANGED_PREFIX) === 0) clear(id);
      });
      return true;
    }

    /** The keys wearing a changed mark right now. For tests and probes. */
    function changedKeys() {
      return Object.keys(painted)
        .filter(function (id) {
          return id.indexOf(CHANGED_PREFIX) === 0;
        })
        .map(function (id) {
          return id.slice(CHANGED_PREFIX.length);
        });
    }

    // ------------------------------------------------------------------------
    // The library's one shadow surface
    // ------------------------------------------------------------------------
    //
    // Closed, so the page's own scripts cannot reach in and the library's DOM
    // cannot be styled by the page. The root is kept in this closure because a
    // closed root is not readable from the element, which is the point.

    /**
     * True for the things a person types into: the fields the fence is for.
     *
     * @param {any} node the event's real target, inside the closed root
     * @returns {boolean}
     */
    function isTypingTarget(node) {
      if (!node || node.nodeType !== 1) return false;
      var tag = node.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return node.isContentEditable === true;
    }

    /**
     * Keys typed into the library's own text fields stay in the library.
     *
     * A keyboard-driven page decides "is someone typing" by reading
     * document.activeElement and asking whether it is an input, a textarea, or
     * contenteditable. reveal.js is the one that caught this, and any deck or
     * app with document-level hotkeys does the same thing. Every field the
     * library draws lives inside this CLOSED shadow root, and the browser
     * retargets focus across a shadow boundary: from the page's side the active
     * element is the plain host div, which is not editable. So the page decides
     * nobody is typing and handles the key, and a space bar pressed mid-sentence
     * in a comment box advances the slide.
     *
     * The fence sits on the root rather than in each box because the root is the
     * boundary the page can see across: every text field the library grows from
     * here on is covered without anyone remembering to cover it, and there is
     * one place to read when this behavior is in question.
     *
     * Bubbling phase, so the field's own handlers at the target have already
     * run: Cmd-Enter still commits a comment and Escape still closes a box.
     * Never preventDefault, because typing must still type.
     *
     * The library's own document-level handlers are unaffected. comments.js and
     * editing.js both register their keydown in the CAPTURE phase
     * (listeners.on(target, "keydown", fn, true, ...)), so they run on the way
     * down, before this listener ever sees the event.
     *
     * Keys aimed at non-text chrome pass through untouched: a reviewer who
     * clicked a rail button and then pressed an arrow key still expects the page
     * to move.
     *
     * Hand edits are out of scope by construction. They happen in the page's own
     * DOM, where a contenteditable block is exactly what the page already checks
     * for.
     *
     * @param {ShadowRoot} root the library's one closed shadow root
     * @returns {void}
     */
    function fenceTypingKeys(root) {
      var stop = function (event) {
        var path = typeof event.composedPath === "function" ? event.composedPath() : null;
        var target = (path && path[0]) || event.target;
        if (isTypingTarget(target)) event.stopPropagation();
      };
      root.addEventListener("keydown", stop);
      root.addEventListener("keyup", stop);
      root.addEventListener("keypress", stop);
    }

    function surface() {
      if (!doc) return { host: null, root: null };
      if (surfaceRoot && surfaceHost && surfaceHost.isConnected) {
        return { host: surfaceHost, root: surfaceRoot };
      }
      // The cached host is gone from the document, so a new one is about to be
      // built. Every style node in surfaceStyles belongs to the OLD closed root:
      // kept, they make addSurfaceStyle a no-op that returns a detached node, and
      // the comment boxes come back unstyled with nothing to see in the DOM.
      surfaceStyles = Object.create(null);
      // ONE HOST, and it fails loud rather than quietly becoming two. A second
      // host means two closed roots, two rails, and a remount that re-creates
      // one of them; none of that is diagnosable from the outside, because a
      // closed root cannot be read back off the element.
      var already = doc.getElementById(SURFACE_ID);
      if (already) {
        throw new Error(
          "highlight.surface: the page already holds " +
            SURFACE_ID +
            ", so this would be the second one. Everything the library draws goes in the ONE surface: " +
            "pass the same highlights instance around (highlight.shared), or call teardown() first."
        );
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
      // Print: everything the library draws is a descendant of this one host,
      // so hiding it for print is one rule against :host, from inside its own
      // closed root rather than as a second page-level stylesheet (D8 allows
      // exactly one, spent on the highlight rules). !important beats nothing:
      // the host's own inline style (above) never sets `display`, so there is
      // no inline value for this rule to lose to.
      if (root) {
        var printStyle = doc.createElement("style");
        printStyle.textContent = PRINT_HOST_STYLE_TEXT;
        root.appendChild(printStyle);
        fenceTypingKeys(root);
      }
      // Stamped on the host, so every stylesheet inside the closed root selects
      // its dark rules with :host([data-lahe-scheme='dark']) instead of a media
      // query. The page decides; see schemeForPage.
      refreshScheme();
      return { host: surfaceHost, root: surfaceRoot };
    }

    /**
     * Re-read the page's background and re-stamp the surface.
     *
     * Called when the surface is built and again on every remount, because the
     * page that comes back from a navigation or a morph is not required to have
     * the background the page that left it had.
     *
     * @returns {"light"|"dark"} the scheme now in force
     */
    function refreshScheme() {
      var next = pageScheme();
      if (surfaceHost) surfaceHost.setAttribute(SCHEME_ATTR, next);
      return next;
    }

    function pageScheme() {
      return schemeForPage(doc, opts.window || (typeof window !== "undefined" ? window : null));
    }

    // Adds a stylesheet INSIDE the shadow root, once per key. Every caller's
    // styles land here rather than in the page, which is what keeps the
    // page-level count at one.
    function addSurfaceStyle(key, cssText) {
      var s = surface();
      if (!s.root) return null;
      // Connectedness, not a cache hit. A remembered element whose root was torn
      // down and rebuilt is not in any tree, and returning it would leave the
      // caller's rules with nothing behind them.
      var known = surfaceStyles[key];
      var knownRoot = known && typeof known.getRootNode === "function" ? known.getRootNode() : s.root;
      if (known && known.isConnected !== false && knownRoot === s.root) return known;
      var el = doc.createElement("style");
      el.textContent = cssText;
      s.root.appendChild(el);
      surfaceStyles[key] = el;
      return el;
    }

    function teardown() {
      clearAllChanged();
      clearEmphasis();
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
      emphasize: emphasize,
      clearEmphasis: clearEmphasis,
      emphasisRange: emphasisRange,
      markChanged: markChanged,
      clearChanged: clearChanged,
      clearAllChanged: clearAllChanged,
      changedKeys: changedKeys,
      surface: surface,
      addSurfaceStyle: addSurfaceStyle,
      pageScheme: pageScheme,
      refreshScheme: refreshScheme,
      SCHEME_ATTR: SCHEME_ATTR,
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
    SCHEME_ATTR: SCHEME_ATTR,
    RAIL_ALLOWANCE_PROP: RAIL_ALLOWANCE_PROP,
    STYLE_TEXT: STYLE_TEXT,
    PRINT_HOST_STYLE_TEXT: PRINT_HOST_STYLE_TEXT,
    EMPHASIS_MS: EMPHASIS_MS,
    EMPHASIS_KEY: EMPHASIS_KEY,
    CHANGED_MS: CHANGED_MS,
    CHANGED_STEPS: CHANGED_STEPS,
    CHANGED_PREFIX: CHANGED_PREFIX,
    schemeForPage: schemeForPage,
    createHighlights: createHighlights,
    shared: shared
  };
});
