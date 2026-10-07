// The zoom viewer: a magnifier button on graphs and large images, and the
// full-screen view it opens to zoom and pan.
//
// Owner: zoom viewer (docs/features/20261007.01_zoom_viewer). Booted by
// index.js, which hands it the three gates it must respect (editing, pick mode,
// presenting) as one function, so this file knows nothing about any of them.
//
// WHY IT EXISTS. The document style shrinks every Mermaid diagram to the page
// width, so a wide flowchart's labels end up too small to read, and a large
// image is shrunk the same way. Nothing in the layer let the reviewer enlarge
// one and look around it.
//
// The rules:
//
//   THE BUTTON, NOT THE CLICK   A click on a picture belongs to the page: on an
//                               app page an image is often a link or a button,
//                               and in pick mode a click on a picture starts a
//                               comment. So the viewer opens only from a small
//                               button drawn over the picture's top right corner
//                               while the pointer (or focus) is on it.
//   WHAT EARNS ONE              Every outermost <svg> at least SVG_MIN_SIDE on
//                               its shorter side, or shown smaller than its own
//                               size, or drawn by Mermaid; every <img> shown
//                               smaller than its natural size or at least
//                               IMG_MIN_LONG on its longer side. Nothing under
//                               MIN_SIDE, nothing hidden, nothing of ours. A
//                               nested svg answers for its outermost one.
//   NOTHING ON THE PAGE         The button and the viewer live in this file's own
//                               closed shadow root inside the library's one
//                               surface (highlight.js). The page's DOM is only
//                               read: an SVG is shown as a deep CLONE, and the
//                               clone lives in this closed root, where its ids
//                               (Mermaid styles by id) cannot collide with the
//                               original's. The viewer never writes a style
//                               onto the page to stop it scrolling either: it
//                               swallows the wheel, touch and keys that would.
//   SHARP AT ANY ZOOM           The view is laid out at its zoomed size rather
//                               than scaled with a CSS transform, so the browser
//                               redraws the vector at every step instead of
//                               stretching a bitmap of it.
//   OUT OF THE WAY              No button while a block is being edited, while
//                               pick mode is on, or while presenting.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.zoom = factory(root.LAHE.markers, root.LAHE.listeners, root.LAHE.highlight);
  } else {
    module.exports = factory(require("../shared/markers.js"), require("./listeners.js"), require("./highlight.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, listeners, highlightModule) {
  "use strict";

  // ---------------------------------------------------------------------------
  // The numbers
  // ---------------------------------------------------------------------------

  // Which things earn a button. "About" in the spec; these are the abouts.
  var SVG_MIN_SIDE = 120;
  var IMG_MIN_LONG = 300;
  var MIN_SIDE = 40;

  // The view. MARGIN is the gap fit leaves around the picture; the scale range
  // is 10% to 2000%, wide enough for a poster and a thumbnail alike.
  var MARGIN = 48;
  var MIN_SCALE = 0.1;
  var MAX_SCALE = 20;
  // One press of plus or minus, and one arrow-key step, in CSS pixels.
  var KEY_ZOOM = 1.25;
  var PAN_STEP = 48;
  // How far a press may wander and still be a click. A drag that ends on the
  // dimmed area is a pan, never a close.
  var DRAG_SLOP = 4;
  // How strongly the wheel zooms. A trackpad pinch arrives as a wheel event
  // with ctrlKey set and small deltas, so it gets a steeper rate.
  var WHEEL_RATE = 0.002;
  var PINCH_RATE = 0.01;
  var LINE_PX = 16;

  // The button: its size, its inset from the picture's corner, and how long it
  // waits after the pointer leaves both the picture and the button before it
  // fades. The wait is what lets the pointer travel from the picture onto the
  // button without it going away underneath.
  var BUTTON_SIZE = 30;
  var BUTTON_INSET = 8;
  var HIDE_DELAY_MS = 250;

  var WORDS = {
    OPEN: "Zoom: open a full-screen view",
    DIALOG: "Zoomed view",
    TOOLBAR: "Zoom controls",
    ZOOM_IN: "Zoom in",
    ZOOM_OUT: "Zoom out",
    FIT: "Fit to window",
    ACTUAL: "Actual size",
    CLOSE: "Close (Esc)"
  };

  // A magnifier with a plus in it. Drawn rather than vendored, like the rail's
  // chevron: a circle and three strokes do not need a provenance note.
  var MAGNIFIER_ICON =
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
    'stroke-linecap="round" aria-hidden="true" focusable="false">' +
    '<circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.5 15.5L20.5 20.5M10.5 7.75v5.5M7.75 10.5h5.5"/>' +
    "</svg>";

  // The rail's own tokens (overlay.js, the :host block of its CSS), the subset
  // this file draws with, and the same dark set under the same switch: the
  // PAGE's scheme, stamped on the host by highlight.js's pageScheme(), never the
  // OS's. Copied by value because the rail's tokens live inside the rail's own
  // closed root and cannot be inherited from there. --dim is this file's own.
  var CSS = [
    // Fixed, and one above the rail's own host (overlay.js, z-index
    // 2147483000), so the open view covers the rail and its pill instead of
    // being drawn under them. pointer-events stays off on the host itself; the
    // button and the open view turn it back on.
    ":host{all:initial;position:fixed;inset:0;z-index:2147483001;pointer-events:none;",
    "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;",
    "--ink:#15171c;--ink-soft:#565e6d;--paper:#fff;--surface:#f6f7f9;--line:#e2e5eb;--accent:#3c56a5;",
    "--shadow:0 1px 2px rgba(18,20,26,.06),0 14px 34px rgba(18,20,26,.13);--dim:rgba(18,20,26,.74)}",
    ":host([data-lahe-scheme='dark']){",
    "--ink:#e9ebf0;--ink-soft:#a8b0be;--paper:#1c2028;--surface:#14171c;--line:#2c313b;--accent:#93a7ea;",
    "--shadow:0 1px 2px rgba(0,0,0,.4),0 16px 40px rgba(0,0,0,.45);--dim:rgba(0,0,0,.8)}",
    "*{box-sizing:border-box;margin:0;padding:0}",
    "button{font:inherit;color:inherit;background:none;border:0;cursor:pointer}",
    ":focus-visible{outline:2px solid var(--accent);outline-offset:2px}",

    // --- the button -----------------------------------------------------------
    // visibility rides the opacity transition, so a faded button can be neither
    // clicked nor tabbed to, and comes back without a flash.
    ".zbtn{position:fixed;top:0;left:0;width:" + BUTTON_SIZE + "px;height:" + BUTTON_SIZE + "px;",
    "display:flex;align-items:center;justify-content:center;border-radius:8px;",
    "background:var(--paper);color:var(--ink-soft);border:1px solid var(--line);box-shadow:var(--shadow);",
    "pointer-events:auto;opacity:0;visibility:hidden;transition:opacity .15s,visibility 0s linear .15s}",
    ".zbtn[data-shown='true']{opacity:1;visibility:visible;transition:opacity .15s}",
    ".zbtn:hover{color:var(--ink);background:var(--surface)}",

    // --- the viewer -----------------------------------------------------------
    ".zv{position:fixed;inset:0;pointer-events:auto;background:var(--dim);overflow:hidden;",
    "cursor:grab;touch-action:none;-webkit-user-select:none;user-select:none;outline:none}",
    ".zv[hidden]{display:none}",
    ".zv[data-dragging='true']{cursor:grabbing}",
    ".zv__content{position:absolute;left:0;top:0;box-shadow:0 10px 40px rgba(0,0,0,.35)}",
    ".zv__content>svg,.zv__content>img{display:block;width:100%;height:100%;max-width:none;max-height:none}",
    ".zv__bar{position:absolute;top:16px;right:16px;display:flex;align-items:center;gap:2px;padding:4px;",
    "background:var(--paper);color:var(--ink);border:1px solid var(--line);border-radius:10px;",
    "box-shadow:var(--shadow);font-size:12.5px;cursor:default}",
    ".zv__btn{min-width:30px;height:28px;padding:0 8px;border-radius:7px;color:var(--ink-soft);",
    "font-size:13px;font-weight:550;display:flex;align-items:center;justify-content:center}",
    ".zv__btn:hover{background:var(--surface);color:var(--ink)}",
    ".zv__pct{min-width:52px;text-align:center;font-variant-numeric:tabular-nums;color:var(--ink)}",
    ".zv__sep{width:1px;height:18px;background:var(--line);margin:0 4px}"
  ].join("");

  // ---------------------------------------------------------------------------
  // The pure rules
  // ---------------------------------------------------------------------------

  function clampScale(s) {
    if (!(s > MIN_SCALE)) return MIN_SCALE;
    if (s > MAX_SCALE) return MAX_SCALE;
    return s;
  }

  /**
   * Does an outermost svg earn a button?
   *
   * The spec's shorter-side floor alone would skip the very thing the feature is
   * for: a wide left-to-right flowchart shrunk to the page width is often under
   * 120 pixels tall. "Every graph drawn as SVG (all Mermaid included)" is the
   * decided rule, so a shrunk svg, or one Mermaid drew, qualifies above MIN_SIDE.
   * The shrunk half also needs IMG_MIN_LONG on its longer side, the image rule's
   * floor: a 64px logo drawn from a 512x512 viewBox is shrunk, and is an icon.
   *
   * @param {{width:number,height:number}} shown   its rect on screen
   * @param {{width:number,height:number}|null} own its own size (viewBox), if known
   * @param {boolean} mermaid
   */
  function svgQualifies(shown, own, mermaid) {
    if (!shown || shown.width < MIN_SIDE || shown.height < MIN_SIDE) return false;
    if (Math.min(shown.width, shown.height) >= SVG_MIN_SIDE) return true;
    if (mermaid) return true;
    if (Math.max(shown.width, shown.height) < IMG_MIN_LONG) return false;
    return !!own && (shown.width < own.width - 1 || shown.height < own.height - 1);
  }

  /**
   * Does an image earn a button? Shown smaller than its natural size, or large
   * on screen. An image with no natural size has not loaded and gets none.
   */
  function imgQualifies(shown, natural) {
    if (!shown || !natural || !(natural.width > 0) || !(natural.height > 0)) return false;
    if (shown.width < MIN_SIDE || shown.height < MIN_SIDE) return false;
    if (shown.width < natural.width - 1 || shown.height < natural.height - 1) return true;
    return Math.max(shown.width, shown.height) >= IMG_MIN_LONG;
  }

  /** The view that fits w by h into the window with a margin, centred. */
  function fitView(vw, vh, w, h, margin) {
    var m = margin === undefined ? MARGIN : margin;
    var scale = clampScale(Math.min((vw - 2 * m) / w, (vh - 2 * m) / h));
    return { scale: scale, x: (vw - w * scale) / 2, y: (vh - h * scale) / 2 };
  }

  /** The view at a new scale, with the content point under (px, py) kept still. */
  function zoomAbout(view, nextScale, px, py) {
    var scale = clampScale(nextScale);
    var ratio = scale / view.scale;
    return { scale: scale, x: px - (px - view.x) * ratio, y: py - (py - view.y) * ratio };
  }

  /** How much one wheel event zooms by. deltaMode 1 is lines, 2 is pages. */
  function wheelFactor(deltaY, deltaMode, ctrlKey, pageHeight) {
    var dy = deltaY;
    if (deltaMode === 1) dy *= LINE_PX;
    else if (deltaMode === 2) dy *= pageHeight || 800;
    return Math.exp(-dy * (ctrlKey ? PINCH_RATE : WHEEL_RATE));
  }

  function percentLabel(scale) {
    return Math.round(scale * 100) + "%";
  }

  // ---------------------------------------------------------------------------
  // Reading the page (never writing it)
  // ---------------------------------------------------------------------------

  function tagOf(node) {
    return node && node.nodeType === 1 ? String(node.tagName || "").toLowerCase() : "";
  }

  /** The outermost svg a node sits in (itself included), or null. */
  function outermostSvg(node) {
    var found = null;
    var current = node;
    while (current && current.nodeType === 1) {
      if (tagOf(current) === "svg") found = current;
      current = current.parentElement;
    }
    return found;
  }

  // A width or height attribute in CSS pixels: unitless or "px". Percent, em
  // and the rest depend on the page, so they say nothing about the svg's size.
  function pxAttr(svg, name) {
    var raw = svg.getAttribute(name);
    var m = raw === null || raw === undefined ? null : String(raw).trim().match(/^(\d+(?:\.\d+)?|\.\d+)(px)?$/i);
    return m ? Number(m[1]) : 0;
  }

  /**
   * An svg's own size, which is what "actual size" shows: its width and height
   * attributes when both are in px, else its viewBox. The attributes come first
   * because the viewBox is in user units, not pixels: viewBox="0 0 24 24" with
   * width="600" is a 600px drawing. `viewBox` says whether it has one to scale
   * against.
   */
  function svgOwnSize(svg) {
    var vb = null;
    try {
      var base = svg.viewBox && svg.viewBox.baseVal;
      if (base && base.width > 0 && base.height > 0) vb = base;
    } catch (e) {
      // An svg without the DOM interface answers from its attributes.
    }
    var w = pxAttr(svg, "width");
    var h = pxAttr(svg, "height");
    if (w > 0 && h > 0) return { width: w, height: h, viewBox: !!vb };
    if (vb) return { width: vb.width, height: vb.height, viewBox: true };
    return null;
  }

  /**
   * Take everything that could act out of a copied svg: href and xlink:href
   * (on <a>, and on <use> and <image>, where a page link is not wanted either)
   * and every on* handler attribute. The copy is for looking at. A Mermaid
   * `click` node is an <a href> or an onclick, and in the viewer it would
   * navigate the reviewed page away or run the page's script.
   */
  function inertCopy(root) {
    var nodes = [root];
    var all = root.querySelectorAll ? root.querySelectorAll("*") : [];
    for (var i = 0; i < all.length; i += 1) nodes.push(all[i]);
    nodes.forEach(function (node) {
      var names = [];
      for (var j = 0; j < node.attributes.length; j += 1) names.push(node.attributes[j].name);
      names.forEach(function (name) {
        var lower = name.toLowerCase();
        if (lower === "href" || lower === "xlink:href" || lower.indexOf("on") === 0) node.removeAttribute(name);
      });
    });
    return root;
  }

  function isMermaid(svg) {
    if (svg.hasAttribute("aria-roledescription")) return true;
    return typeof svg.closest === "function" && !!svg.closest(".mermaid");
  }

  function isShown(el, win) {
    if (!el.getClientRects || el.getClientRects().length === 0) return false;
    var cs = win && win.getComputedStyle ? win.getComputedStyle(el) : null;
    if (cs && (cs.visibility === "hidden" || cs.visibility === "collapse" || Number(cs.opacity) === 0)) return false;
    return true;
  }

  /** The picture behind the original, so a transparent graph is drawn on what it was drawn on. */
  function backdropOf(el, win) {
    var node = el;
    while (node && node.nodeType === 1) {
      var bg = win.getComputedStyle(node).backgroundColor;
      var m = String(bg).replace(/\s+/g, "").match(/^rgba?\((\d+),(\d+),(\d+)(?:,([\d.]+))?\)$/i);
      if (m && (m[4] === undefined || Number(m[4]) >= 0.5)) return bg;
      node = node.parentElement;
    }
    return "#ffffff";
  }

  // ---------------------------------------------------------------------------
  // The surface
  // ---------------------------------------------------------------------------

  /**
   * @param {object} opts
   * @param {Document} [opts.document]
   * @param {Window}   [opts.window]
   * @param {object}   [opts.highlights]  the library's one surface (highlight.shared)
   * @param {function} [opts.blocked]     true while editing, picking or presenting
   * @param {object}   [opts.listeners]   the listener registry
   */
  function createZoom(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (doc && doc.defaultView) || (typeof window !== "undefined" ? window : null);
    var highlights = opts.highlights || highlightModule.shared;
    var registry = opts.listeners || listeners.shared;
    var blockedBy = typeof opts.blocked === "function" ? opts.blocked : function () { return false; };

    var dom = null; // { host, shadow, button, viewer, content, pct, controls }
    var handles = [];
    var bound = false;

    // The button's state: the picture it is on, and why it is up.
    var target = null;
    var shown = false;
    var overButton = false;
    var hideTimer = null;
    // The page element whose focus put the button up (a link around an image),
    // so Tab from there goes to the button and Shift-Tab comes back.
    var focusOrigin = null;

    // The viewer's state.
    var openOn = null; // { el, kind, width, height }
    var view = { scale: 1, x: 0, y: 0 };
    var press = null;
    var gestureBase = 1;
    var returnFocus = null;

    function blocked() {
      if (typeof highlights.isHidden === "function" && highlights.isHidden()) return true;
      try {
        return blockedBy() === true;
      } catch (err) {
        return false;
      }
    }

    function el(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    // Built on first need, and again whenever the surface it hung in was thrown
    // away (a remount rebuilds the library's host from the rail down).
    function ensureDom() {
      if (dom && dom.host.isConnected) return dom;
      if (dom) {
        // The old root went with the old surface, and an open view with it.
        openOn = null;
        shown = false;
      }
      dom = null;
      if (!doc || !doc.body) return null;
      var surface = highlights.surface();
      var surfaceRoot = surface.root || surface.host;
      if (!surfaceRoot) return null;

      var host = doc.createElement("div");
      markers.markChrome(host);
      host.setAttribute(highlightModule.SCHEME_ATTR, highlights.pageScheme());
      // CLOSED, like the rail's: the page cannot reach in, and the svg copy's
      // ids are scoped to this root alone.
      var shadow = host.attachShadow({ mode: "closed" });
      highlightModule.fenceTypingKeys(shadow);
      var style = doc.createElement("style");
      style.textContent = CSS;
      shadow.appendChild(style);

      var button = el("button", "zbtn");
      button.type = "button";
      button.setAttribute("aria-label", WORDS.OPEN);
      button.title = WORDS.OPEN;
      button.innerHTML = MAGNIFIER_ICON;
      shadow.appendChild(button);

      var viewer = el("div", "zv");
      viewer.hidden = true;
      viewer.tabIndex = -1;
      viewer.setAttribute("role", "dialog");
      viewer.setAttribute("aria-modal", "true");
      viewer.setAttribute("aria-label", WORDS.DIALOG);
      var content = el("div", "zv__content");
      viewer.appendChild(content);
      var bar = el("div", "zv__bar");
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", WORDS.TOOLBAR);
      var controls = {};
      function control(name, label, text) {
        var b = el("button", "zv__btn", text);
        b.type = "button";
        b.setAttribute("aria-label", label);
        b.title = label;
        controls[name] = b;
        return b;
      }
      var pct = el("span", "zv__pct", "100%");
      pct.setAttribute("aria-live", "polite");
      bar.appendChild(control("out", WORDS.ZOOM_OUT, "−"));
      bar.appendChild(pct);
      bar.appendChild(control("in", WORDS.ZOOM_IN, "+"));
      bar.appendChild(el("span", "zv__sep"));
      bar.appendChild(control("fit", WORDS.FIT, "Fit"));
      bar.appendChild(control("actual", WORDS.ACTUAL, "100%"));
      bar.appendChild(el("span", "zv__sep"));
      bar.appendChild(control("close", WORDS.CLOSE, "×"));
      viewer.appendChild(bar);
      shadow.appendChild(viewer);
      surfaceRoot.appendChild(host);

      dom = { host: host, shadow: shadow, button: button, viewer: viewer, content: content, bar: bar, pct: pct, controls: controls };
      wireButton();
      wireViewer();
      return dom;
    }

    // -------------------------------------------------------------------------
    // Which picture is under the pointer
    // -------------------------------------------------------------------------

    /** The picture a page node stands for, or null when it earns no button. */
    function targetFor(node) {
      if (!node || node.nodeType !== 1 || markers.isInsideOverlay(node)) return null;
      var tag = tagOf(node);
      var candidate = tag === "img" ? node : outermostSvg(node);
      if (!candidate || !isShown(candidate, win)) return null;
      var r = candidate.getBoundingClientRect();
      if (tagOf(candidate) === "img") {
        if (!candidate.complete) return null;
        return imgQualifies(r, { width: candidate.naturalWidth, height: candidate.naturalHeight }) ? candidate : null;
      }
      return svgQualifies(r, svgOwnSize(candidate), isMermaid(candidate)) ? candidate : null;
    }

    /** For a focused element that is not itself a picture: the one picture inside it. */
    function targetInside(node) {
      if (!node || node.nodeType !== 1 || typeof node.querySelectorAll !== "function") return null;
      var found = null;
      var list = node.querySelectorAll("img, svg");
      for (var i = 0; i < list.length; i += 1) {
        var t = targetFor(list[i]);
        if (t && t !== found) {
          if (found) return null; // more than one: the focus is not on a picture
          found = t;
        }
      }
      return found;
    }

    // -------------------------------------------------------------------------
    // The button
    // -------------------------------------------------------------------------

    function placeButton() {
      if (!dom || !target) return;
      var r = target.getBoundingClientRect();
      var vw = win.innerWidth;
      var vh = win.innerHeight;
      var left = Math.min(r.right, vw) - BUTTON_INSET - BUTTON_SIZE;
      var top = Math.max(r.top, 0) + BUTTON_INSET;
      // Kept on the picture while any of it is on screen.
      top = Math.min(top, Math.min(r.bottom, vh) - BUTTON_SIZE - BUTTON_INSET);
      left = Math.max(left, Math.max(r.left, 0) + BUTTON_INSET);
      dom.button.style.transform = "translate(" + Math.round(left) + "px," + Math.round(top) + "px)";
    }

    function cancelHide() {
      if (hideTimer !== null) {
        win.clearTimeout(hideTimer);
        hideTimer = null;
      }
    }

    function showFor(next, origin) {
      if (openOn || blocked()) return;
      if (!ensureDom()) return;
      cancelHide();
      if (next !== target || !shown) {
        dom.host.setAttribute(highlightModule.SCHEME_ATTR, highlights.pageScheme());
      }
      target = next;
      focusOrigin = origin || null;
      placeButton();
      dom.button.setAttribute("data-shown", "true");
      shown = true;
    }

    function hideNow() {
      cancelHide();
      if (dom && dom.shadow.activeElement === dom.button) dom.button.blur();
      if (dom) dom.button.removeAttribute("data-shown");
      shown = false;
      target = null;
      focusOrigin = null;
      overButton = false;
    }

    function scheduleHide() {
      if (!shown || hideTimer !== null) return;
      hideTimer = win.setTimeout(function () {
        hideTimer = null;
        if (overButton || (dom && dom.shadow.activeElement === dom.button)) return;
        hideNow();
      }, HIDE_DELAY_MS);
    }

    function wireButton() {
      var b = dom.button;
      b.addEventListener("pointerenter", function () {
        overButton = true;
        cancelHide();
      });
      b.addEventListener("pointerleave", function () {
        overButton = false;
        scheduleHide();
      });
      b.addEventListener("click", function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (target) open(target);
      });
      b.addEventListener("keydown", function (event) {
        if (event.key !== "Tab" || !focusOrigin || !focusOrigin.isConnected) return;
        // Back to where the button came from. Forward Tab is left to the
        // browser after the hop, so it carries on from the page element.
        if (event.shiftKey) event.preventDefault();
        focusOrigin.focus();
      });
      b.addEventListener("blur", function () {
        if (!overButton) scheduleHide();
      });
    }

    // The page-side listeners. Read-only: each one looks at what the pointer or
    // focus is on and draws (or puts away) the button in this file's own root.
    // The last page node the pointer was over and what it resolved to. Moving
    // within one node is most moves, and asking again would measure the picture
    // and read its computed style on every one. A scroll forgets it, because a
    // scroll changes what is under a still pointer.
    var lastNode = null;
    var lastTarget = null;
    // How many pointer moves this file has looked at. A spec that expects NO
    // button reads it to know the move it made was seen, rather than waiting.
    var movesSeen = 0;

    function onPointerMove(event) {
      movesSeen += 1;
      if (openOn) return;
      if (blocked()) {
        if (shown) hideNow();
        return;
      }
      if (event.target !== lastNode) {
        lastNode = event.target;
        lastTarget = targetFor(lastNode);
      }
      var next = lastTarget;
      if (next) {
        if (next !== target || !shown) showFor(next, null);
        else cancelHide();
        return;
      }
      if (overButton) {
        cancelHide();
        return;
      }
      scheduleHide();
    }

    function onPointerOut(event) {
      // The pointer left the window.
      if (!event.relatedTarget) {
        overButton = false;
        scheduleHide();
      }
    }

    function onFocusIn(event) {
      if (openOn || blocked()) return;
      var node = event.target;
      if (markers.isInsideOverlay(node)) return;
      var next = targetFor(node) || targetInside(node);
      if (next) showFor(next, node);
      else if (shown && !overButton) scheduleHide();
    }

    function onKeyDown(event) {
      // Tab from the page element that put the button up goes to the button.
      if (event.key !== "Tab" || event.shiftKey || !shown || !focusOrigin || openOn) return;
      if (doc.activeElement !== focusOrigin || !dom) return;
      event.preventDefault();
      dom.button.focus();
    }

    function onScrollOrResize() {
      lastNode = null;
      if (shown && !openOn) placeButton();
    }

    // -------------------------------------------------------------------------
    // The viewer
    // -------------------------------------------------------------------------

    function viewport() {
      return { width: win.innerWidth, height: win.innerHeight };
    }

    function paint() {
      if (!dom || !openOn) return;
      var c = dom.content.style;
      c.left = view.x + "px";
      c.top = view.y + "px";
      c.width = openOn.width * view.scale + "px";
      c.height = openOn.height * view.scale + "px";
      dom.pct.textContent = percentLabel(view.scale);
    }

    function fit() {
      var vp = viewport();
      view = fitView(vp.width, vp.height, openOn.width, openOn.height, MARGIN);
      paint();
    }

    function actualSize() {
      // 100% is centred on the picture's own middle, like fit.
      var vp = viewport();
      view = { scale: 1, x: (vp.width - openOn.width) / 2, y: (vp.height - openOn.height) / 2 };
      paint();
    }

    function zoomBy(factor, px, py) {
      var vp = viewport();
      var x = px === undefined ? vp.width / 2 : px;
      var y = py === undefined ? vp.height / 2 : py;
      view = zoomAbout(view, view.scale * factor, x, y);
      paint();
    }

    function panBy(dx, dy) {
      view = { scale: view.scale, x: view.x + dx, y: view.y + dy };
      paint();
    }

    /** The copy the viewer shows. Never the page's own node. */
    function copyOf(source) {
      if (tagOf(source) === "img") {
        var img = doc.createElement("img");
        img.src = source.currentSrc || source.src;
        img.alt = source.alt || "";
        img.draggable = false;
        return { node: img, kind: "img", width: source.naturalWidth, height: source.naturalHeight };
      }
      var own = svgOwnSize(source);
      var r = source.getBoundingClientRect();
      var width = own ? own.width : r.width;
      var height = own ? own.height : r.height;
      var clone = inertCopy(source.cloneNode(true));
      // Scaled by its box, so it needs a viewBox to scale against.
      if (!own || !own.viewBox) clone.setAttribute("viewBox", "0 0 " + width + " " + height);
      clone.setAttribute("width", "100%");
      clone.setAttribute("height", "100%");
      clone.style.maxWidth = "none";
      clone.style.maxHeight = "none";
      // What the svg inherited on the page (currentColor, the font its text is
      // set in) does not cross into this root, so it is carried over by value.
      var cs = win.getComputedStyle(source);
      clone.style.color = cs.color;
      clone.style.fontFamily = cs.fontFamily;
      return { node: clone, kind: "svg", width: width, height: height };
    }

    function open(source) {
      if (!source || openOn || blocked() || !ensureDom()) return false;
      var copy = copyOf(source);
      if (!(copy.width > 0) || !(copy.height > 0)) return false;
      returnFocus = dom.shadow.activeElement === dom.button ? { button: true, target: source, origin: focusOrigin } : { node: doc.activeElement };
      hideNow();
      dom.host.setAttribute(highlightModule.SCHEME_ATTR, highlights.pageScheme());
      dom.content.textContent = "";
      dom.content.style.background = backdropOf(source, win);
      dom.content.appendChild(copy.node);
      openOn = { el: source, kind: copy.kind, width: copy.width, height: copy.height, node: copy.node };
      dom.viewer.hidden = false;
      fit();
      dom.viewer.focus();
      return true;
    }

    function close() {
      if (!openOn) return false;
      openOn = null;
      press = null;
      if (dom) {
        dom.viewer.hidden = true;
        dom.viewer.removeAttribute("data-dragging");
        dom.content.textContent = "";
      }
      var back = returnFocus;
      returnFocus = null;
      if (back && back.button && back.target && back.target.isConnected && !blocked()) {
        showFor(back.target, back.origin);
        if (dom) dom.button.focus();
      } else if (back && back.node && back.node !== doc.body && typeof back.node.focus === "function" && back.node.isConnected) {
        back.node.focus();
      }
      return true;
    }

    function insideRect(node, x, y) {
      var r = node.getBoundingClientRect();
      return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    }

    function onBackdrop(x, y) {
      return !insideRect(dom.content, x, y) && !insideRect(dom.bar, x, y);
    }

    function wireViewer() {
      var v = dom.viewer;
      var c = dom.controls;
      c["in"].addEventListener("click", function () {
        zoomBy(KEY_ZOOM);
      });
      c.out.addEventListener("click", function () {
        zoomBy(1 / KEY_ZOOM);
      });
      c.fit.addEventListener("click", fit);
      c.actual.addEventListener("click", actualSize);
      c.close.addEventListener("click", close);

      // passive:false, because the page under the viewer must not scroll.
      v.addEventListener(
        "wheel",
        function (event) {
          event.preventDefault();
          event.stopPropagation();
          if (!openOn) return;
          zoomBy(wheelFactor(event.deltaY, event.deltaMode, event.ctrlKey, win.innerHeight), event.clientX, event.clientY);
        },
        { passive: false }
      );
      // Safari's trackpad pinch is a gesture event rather than a ctrl-wheel.
      v.addEventListener("gesturestart", function (event) {
        event.preventDefault();
        gestureBase = view.scale;
      });
      v.addEventListener("gesturechange", function (event) {
        event.preventDefault();
        if (!openOn) return;
        view = zoomAbout(view, gestureBase * event.scale, event.clientX, event.clientY);
        paint();
      });
      v.addEventListener("touchmove", function (event) {
        event.preventDefault();
      }, { passive: false });

      v.addEventListener("pointerdown", function (event) {
        if (!openOn || event.button !== 0) return;
        if (dom.bar.contains(event.target)) return;
        event.preventDefault();
        press = {
          id: event.pointerId,
          sx: event.clientX,
          sy: event.clientY,
          vx: view.x,
          vy: view.y,
          moved: false,
          backdrop: onBackdrop(event.clientX, event.clientY)
        };
        try {
          v.setPointerCapture(event.pointerId);
        } catch (err) {
          // Capture is a nicety: a drag that leaves the window ends there.
        }
        v.focus();
      });
      v.addEventListener("pointermove", function (event) {
        if (!press || event.pointerId !== press.id) return;
        var dx = event.clientX - press.sx;
        var dy = event.clientY - press.sy;
        if (!press.moved && Math.abs(dx) + Math.abs(dy) > DRAG_SLOP) {
          press.moved = true;
          v.setAttribute("data-dragging", "true");
        }
        view = { scale: view.scale, x: press.vx + dx, y: press.vy + dy };
        paint();
      });
      function release(event) {
        if (!press || event.pointerId !== press.id) return;
        var was = press;
        press = null;
        v.removeAttribute("data-dragging");
        // A click on the dimmed area closes. A drag that ends there is a pan.
        if (event.type === "pointerup" && !was.moved && was.backdrop && onBackdrop(event.clientX, event.clientY)) close();
      }
      // A click inside the view never acts on what it lands on. The copy is
      // already inert (inertCopy); this is the second lock, for anything the
      // strip did not know about. The toolbar's own buttons still work: their
      // click handlers run, and a type=button has no default to lose.
      v.addEventListener(
        "click",
        function (event) {
          if (!dom.bar.contains(event.target)) event.preventDefault();
        },
        true
      );
      v.addEventListener("pointerup", release);
      v.addEventListener("pointercancel", release);

    }

    // Every key while the view is open, caught on the WINDOW in the capture
    // phase. That is the first stop on the way down, ahead of the document-level
    // capture handlers comments.js and editing.js bind. A listener on the viewer
    // itself runs after those, so the edit chord pressed over the view started
    // edit state behind it, and Esc then went to the edit instead of closing.
    // So no key reaches the page or the layer's chord handlers while it is
    // open. Tab is handled here too: it walks the toolbar.
    function onViewerKey(event) {
      if (!openOn || !dom) return;
      event.stopPropagation();
      var key = event.key;
      var handled = true;
      var step = event.shiftKey ? PAN_STEP * 4 : PAN_STEP;
      if (key === "Escape") close();
      else if (key === "+" || key === "=") zoomBy(KEY_ZOOM);
      else if (key === "-" || key === "_") zoomBy(1 / KEY_ZOOM);
      else if (key === "0") fit();
      else if (key === "1") actualSize();
      // The arrows look the way a map does: Left shows more of the left.
      else if (key === "ArrowLeft") panBy(step, 0);
      else if (key === "ArrowRight") panBy(-step, 0);
      else if (key === "ArrowUp") panBy(0, step);
      else if (key === "ArrowDown") panBy(0, -step);
      else if (key === "Tab") trapTab(event);
      else if (key !== " " && key !== "PageUp" && key !== "PageDown" && key !== "Home" && key !== "End") handled = false;
      // The keys the view used do nothing else: no scroll, no default.
      if (handled) event.preventDefault();
    }

    // Focus stays in the dialog: Tab walks the toolbar and wraps.
    function trapTab(event) {
      var list = ["out", "in", "fit", "actual", "close"].map(function (k) {
        return dom.controls[k];
      });
      var at = list.indexOf(dom.shadow.activeElement);
      var next = event.shiftKey ? (at <= 0 ? list.length - 1 : at - 1) : at === -1 || at === list.length - 1 ? 0 : at + 1;
      event.preventDefault();
      list[next].focus();
    }

    // -------------------------------------------------------------------------
    // Binding, and what a test can read
    // -------------------------------------------------------------------------

    function bind() {
      if (bound || !doc || !win) return;
      bound = true;
      var group = listeners.GROUP.OVERLAY;
      handles.push(registry.on(doc, "pointermove", onPointerMove, { capture: true, passive: true }, group));
      handles.push(registry.on(doc, "pointerout", onPointerOut, { capture: true, passive: true }, group));
      handles.push(registry.on(doc, "focusin", onFocusIn, true, group));
      handles.push(registry.on(doc, "keydown", onKeyDown, true, group));
      handles.push(registry.on(win, "keydown", onViewerKey, true, group));
      handles.push(registry.on(win, "scroll", onScrollOrResize, { capture: true, passive: true }, group));
      handles.push(registry.on(win, "resize", onScrollOrResize, { passive: true }, group));
    }

    function unbind() {
      handles.forEach(function (h) {
        h.off();
      });
      handles = [];
      bound = false;
    }

    function teardown() {
      close();
      hideNow();
      unbind();
      if (dom && dom.host.parentNode) dom.host.parentNode.removeChild(dom.host);
      dom = null;
    }

    function rectOf(node) {
      var r = node.getBoundingClientRect();
      return { x: r.left, y: r.top, width: r.width, height: r.height };
    }

    /** Where everything is, for specs and probes. Reads only. */
    function info() {
      var live = dom && dom.host.isConnected ? dom : null;
      var isOpen = !!(live && openOn);
      var out = {
        button: {
          shown: !!(live && shown),
          focused: !!(live && live.shadow.activeElement === live.button),
          // A fade is waiting to start, and the button's opacity as drawn.
          hidePending: hideTimer !== null,
          opacity: live ? Number(win.getComputedStyle(live.button).opacity) : 0,
          movesSeen: movesSeen,
          rect: live && shown ? rectOf(live.button) : null,
          targetId: shown && target ? target.id || null : null,
          targetTag: shown && target ? tagOf(target) : null
        },
        viewer: { open: isOpen }
      };
      if (isOpen) {
        var v = out.viewer;
        v.kind = openOn.kind;
        v.scale = view.scale;
        v.x = view.x;
        v.y = view.y;
        v.width = openOn.width;
        v.height = openOn.height;
        v.label = live.pct.textContent;
        v.scheme = live.host.getAttribute(highlightModule.SCHEME_ATTR);
        v.contentRect = rectOf(live.content);
        v.markup = openOn.kind === "svg" ? openOn.node.outerHTML : null;
        v.src = openOn.kind === "img" ? openOn.node.src : null;
        v.controls = {};
        Object.keys(live.controls).forEach(function (k) {
          v.controls[k] = rectOf(live.controls[k]);
        });
      }
      return out;
    }

    /** Where a node inside the open view's copy is on screen, or null. */
    function probeRect(selector) {
      if (!openOn || !dom) return null;
      var node = dom.content.querySelector(selector);
      return node ? rectOf(node) : null;
    }

    /** A computed style inside the open view's copy, or null. */
    function probe(selector, property) {
      if (!openOn || !dom) return null;
      var node = dom.content.querySelector(selector);
      return node ? win.getComputedStyle(node).getPropertyValue(property) : null;
    }

    return {
      bind: bind,
      unbind: unbind,
      teardown: teardown,
      open: open,
      close: close,
      isOpen: function () {
        return !!openOn;
      },
      hideButton: hideNow,
      info: info,
      probe: probe,
      probeRect: probeRect
    };
  }

  return {
    SVG_MIN_SIDE: SVG_MIN_SIDE,
    IMG_MIN_LONG: IMG_MIN_LONG,
    MIN_SIDE: MIN_SIDE,
    MARGIN: MARGIN,
    MIN_SCALE: MIN_SCALE,
    MAX_SCALE: MAX_SCALE,
    KEY_ZOOM: KEY_ZOOM,
    PAN_STEP: PAN_STEP,
    HIDE_DELAY_MS: HIDE_DELAY_MS,
    WORDS: WORDS,
    svgQualifies: svgQualifies,
    svgOwnSize: svgOwnSize,
    imgQualifies: imgQualifies,
    fitView: fitView,
    zoomAbout: zoomAbout,
    wheelFactor: wheelFactor,
    percentLabel: percentLabel,
    createZoom: createZoom
  };
});
