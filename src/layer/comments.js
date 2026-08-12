// Comment boxes, element-pick mode, and the untethered note.
//
// Owner: 1D. Implements architecture D3 (the gesture vocabulary, browse is the
// page untouched) for the comment half, and leans on D8 (highlights that do not
// change the page) for everything it paints.
//
// ---------------------------------------------------------------------------
// What a reviewer does, and what happens
// ---------------------------------------------------------------------------
//
//   Cmd-Shift-C with text selected     a box opens already focused on that
//                                      passage, and the passage is painted
//   Cmd-Shift-C with nothing selected  element-pick mode: hovering outlines the
//                                      element under the pointer, clicking one
//                                      comments on the whole thing, Esc cancels
//   a box at the foot of the thread    a note tied to nothing (R18)
//   Cmd-Enter                          marks the comment ready. Nothing that is
//                                      not ready is actionable (R7)
//   Esc                                closes the box, KEEPING the draft
//   rewording a ready comment          bumps its revision (R21)
//   deleting                           the reviewer's own act, and the only
//                                      thing that ever removes an item
//
// ---------------------------------------------------------------------------
// Four rules this file must not lose
// ---------------------------------------------------------------------------
//
//  1. THE BOX IS NEVER RE-CREATED WHILE IT HOLDS FOCUS. Opening a box for an id
//     that already has one returns the same node. A rail that rebuilds its
//     cards on every repaint is the single largest revert mechanism in the tool
//     being replaced.
//  2. NOTHING THE LIBRARY ADDS EVER REACHES A RECORD. Every node here is marked
//     as the library's, and every node here lives inside the closed shadow
//     surface, so the normalizer strips it and the page's CSS cannot reach it.
//  3. EVERY KEYSTROKE IS DURABLE, SYNCHRONOUSLY. Not on a timer, not on blur.
//  4. NOTHING IS WRITTEN TO THE REVIEWED PAGE. No outline on a hovered element,
//     no wrapper around a highlighted range, no class on a commented block. The
//     pick outline is a rectangle drawn in the library's own shadow root over
//     the element's bounding box, which is why ranked test 18 can assert that
//     every block's rectangle is unchanged.
//
// The gesture decisions are NOT made here. They come from the one pure table in
// src/shared/gestures.js, so the rail's hint lines and this file's behavior
// cannot drift apart.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.comments = factory(
      root.LAHE.markers,
      root.LAHE.normalize,
      root.LAHE.record,
      root.LAHE.regions,
      root.LAHE.store,
      root.LAHE.gestures,
      root.LAHE.anchor,
      root.LAHE.highlight,
      root.LAHE.listeners
    );
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/normalize.js"),
      require("../shared/record.js"),
      require("../shared/regions.js"),
      require("./store.js"),
      require("../shared/gestures.js"),
      require("./anchor.js"),
      require("./highlight.js"),
      require("./listeners.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  markers,
  normalize,
  record,
  regions,
  storeModule,
  gestures,
  anchor,
  highlightModule,
  listeners
) {
  "use strict";

  var BOX_CLASS = "lahe-comment-box";
  var INPUT_CLASS = "lahe-comment-input";
  var OUTLINE_CLASS = "lahe-pick-outline";
  var LISTENER_GROUP = "comments";

  // Ken's copy, exactly. One spelling, used on every card.
  var HINT_READY = "Cmd-Enter when done with this comment";

  // The box's own look. Quiet: a card the reviewer can ignore while they read,
  // and unmistakably not part of the page. It lives in the shadow root, so
  // nothing here can leak into the page and the page cannot restyle it.
  var BOX_STYLE = [
    ":host, * { box-sizing: border-box; }",
    "." + BOX_CLASS + " {",
    "  position: fixed;",
    "  width: 288px;",
    "  max-width: calc(100vw - 32px);",
    "  pointer-events: auto;",
    "  display: flex;",
    "  flex-direction: column;",
    "  gap: 8px;",
    "  padding: 12px;",
    "  border-radius: 10px;",
    "  border: 1px solid rgba(17, 17, 17, 0.12);",
    "  background: #ffffff;",
    "  box-shadow: 0 8px 28px rgba(17, 17, 17, 0.16), 0 1px 2px rgba(17, 17, 17, 0.08);",
    "  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;",
    "  color: #111111;",
    "}",
    "." + BOX_CLASS + "[data-lahe-placement='inline'] {",
    "  position: static;",
    "  width: auto;",
    "  box-shadow: none;",
    "  border-color: rgba(17, 17, 17, 0.16);",
    "}",
    ".lahe-comment-quote {",
    "  margin: 0;",
    "  padding-left: 8px;",
    "  border-left: 2px solid rgba(255, 178, 26, 0.9);",
    "  color: rgba(17, 17, 17, 0.62);",
    "  font-size: 12px;",
    "  max-height: 3.2em;",
    "  overflow: hidden;",
    "}",
    "." + INPUT_CLASS + " {",
    "  width: 100%;",
    "  min-height: 66px;",
    "  resize: vertical;",
    "  border: 1px solid rgba(17, 17, 17, 0.16);",
    "  border-radius: 6px;",
    "  padding: 7px 8px;",
    "  font: inherit;",
    "  color: inherit;",
    "  background: #ffffff;",
    "}",
    "." + INPUT_CLASS + ":focus-visible, ." + INPUT_CLASS + ":focus {",
    "  outline: 2px solid rgba(255, 158, 0, 0.85);",
    "  outline-offset: 1px;",
    "  border-color: transparent;",
    "}",
    ".lahe-comment-foot {",
    "  display: flex;",
    "  align-items: center;",
    "  justify-content: space-between;",
    "  gap: 8px;",
    "  color: rgba(17, 17, 17, 0.5);",
    "  font-size: 11px;",
    "}",
    ".lahe-comment-state[data-state='ready'] { color: rgba(17, 17, 17, 0.72); }",
    "." + OUTLINE_CLASS + " {",
    "  position: fixed;",
    "  pointer-events: none;",
    "  border-radius: 4px;",
    "  outline: 2px solid rgba(255, 158, 0, 0.95);",
    "  outline-offset: 2px;",
    "  background: rgba(255, 202, 84, 0.12);",
    "  z-index: 1;",
    "  display: none;",
    "}",
    "@media (prefers-color-scheme: dark) {",
    "  ." + BOX_CLASS + " { background: #1b1b1d; color: #f2f2f2; border-color: rgba(255,255,255,0.16); }",
    "  ." + INPUT_CLASS + " { background: #111113; color: inherit; border-color: rgba(255,255,255,0.18); }",
    "  .lahe-comment-quote { color: rgba(242,242,242,0.66); }",
    "  .lahe-comment-foot { color: rgba(242,242,242,0.55); }",
    "}"
  ].join("\n");

  function createComments(options) {
    var opts = options || {};
    var store = opts.store || storeModule.shared;
    var reviewId = opts.reviewId || null;
    var hasDoc = Object.prototype.hasOwnProperty.call(opts, "document");
    var doc = hasDoc ? opts.document : typeof document !== "undefined" ? document : null;
    var win = opts.window || (typeof window !== "undefined" ? window : null);
    // The shared instance when this is the real document, because the library
    // has ONE surface host on a page and a second instance would create a
    // second one. A caller working on some other document (a test, a frame)
    // gets its own.
    var isRealDocument = doc && typeof document !== "undefined" && doc === document;
    var highlights =
      opts.highlights ||
      (isRealDocument ? highlightModule.shared : doc ? highlightModule.createHighlights({ document: doc }) : null);
    var defaultPage = opts.page || null;

    // id -> handle
    var open = Object.create(null);
    var listenerHandles = [];
    var listenersState = [];
    var pick = { active: false, element: null };
    // How much room the rail is assumed to take on the right. The rail's real
    // width is 1B's; this is only a clamp for box placement, so being generous
    // costs nothing.
    var RAIL_ALLOWANCE = 340;
    var outlineNode = null;
    var surfaceRoot = null;

    function requireReview() {
      if (!reviewId) throw new Error("comments: a reviewId is required before a comment can be stored");
      return reviewId;
    }

    function setReview(id) {
      reviewId = id;
      return reviewId;
    }

    function setPage(page) {
      defaultPage = page;
      return defaultPage;
    }

    function onChange(fn) {
      listenersState.push(fn);
      return function () {
        listenersState = listenersState.filter(function (f) {
          return f !== fn;
        });
      };
    }

    function emit(item, event) {
      for (var i = 0; i < listenersState.length; i += 1) listenersState[i](item, event || "changed");
    }

    // The one write path. Synchronous to storage before anything else happens.
    function persist(item, event) {
      store.write(requireReview(), item);
      emit(item, event);
      return item;
    }

    // ------------------------------------------------------------------------
    // The shadow surface
    // ------------------------------------------------------------------------

    function surface() {
      if (!doc || !highlights) return null;
      if (surfaceRoot) return surfaceRoot;
      var got = highlights.surface();
      surfaceRoot = got.root || got.host;
      highlights.addSurfaceStyle("comments", BOX_STYLE);
      return surfaceRoot;
    }

    // A box the rail hosts lives in the RAIL's root, not in the surface root
    // the styles above went into, and a shadow root's styles stop at its own
    // boundary. So the box carries its stylesheet to whichever root it lands
    // in, once per root.
    var styledRoots = [];
    function ensureBoxStyleIn(host) {
      if (!doc || !host || typeof host.getRootNode !== "function") return null;
      var rootNode = host.getRootNode();
      if (!rootNode || rootNode === doc) return null;
      if (styledRoots.indexOf(rootNode) !== -1) return null;
      styledRoots.push(rootNode);
      var style = doc.createElement("style");
      style.textContent = BOX_STYLE;
      rootNode.appendChild(style);
      return style;
    }

    // ------------------------------------------------------------------------
    // Opening a box
    // ------------------------------------------------------------------------

    /**
     * Opens a comment box and mints its record.
     *
     * @param {Object} input
     *   page       {origin, path, title, seq, source_hint} from record.pageFrom
     *   quote      the passage the reviewer selected, or null for a note
     *   kind       record.KIND.COMMENT (default) or record.KIND.NOTE
     *   region     the anchor reference, when one has been minted
     *   range      a live Range to paint and to position the box against
     *   element    the element the comment is about, for an element pick
     *   host       a node inside the surface to append the box to
     *   placement  "anchored" (default) or "inline" (in the rail's thread)
     * @returns {Object} a handle: {id, item, node, input, focus, type,
     *                              markReady, close, remove}
     */
    function openBox(input) {
      var src = input || {};
      var page = src.page || defaultPage || {};
      var kind = src.kind || record.KIND.COMMENT;
      var context = record.emptyContext();
      if (src.quote) context.quote = src.quote;
      if (src.element && src.element.tagName) context.element = src.element.tagName;
      if (src.heading) context.heading = src.heading;

      var item = record.newItem({
        kind: kind,
        state: record.STATE.DRAFT,
        note: "",
        page_origin: page.origin,
        page_path: page.path,
        page_title: page.title,
        page_seq: page.seq,
        source_hint: page.source_hint,
        region: src.region || record.emptyRegion(),
        context: context
      });

      // A draft exists the moment the box does. An empty box the reviewer
      // abandons is a draft they can come back to, which costs nothing; a box
      // whose first keystroke is the first durable thing can lose that
      // keystroke.
      //
      // The ONE exception, and it is not a weakening of that rule: the note box
      // standing open at the foot of the thread all session. It is not a box
      // the reviewer opened, so minting a record for it would put an empty note
      // in the rail, in review.json, and in the agent's queue on every page
      // load. It mints on its first keystroke instead, still synchronously, and
      // still before anything else happens.
      if (!src.deferred) persist(item, "opened");

      var handle = buildHandle(item, src);
      open[item[record.FIELD.ID]] = handle;

      if (src.range && highlights) {
        highlights.paint(item[record.FIELD.ID], src.range, highlightModule.NAME.ACTIVE);
      }
      return handle;
    }

    // Opens a box for an item that already exists: the reword path. Mints
    // nothing, and returns the SAME node when one is already open.
    //
    // `host` and `placement` are how a tab file rewords INSIDE the rail's own
    // card rather than in a box floating over the page. That is what makes the
    // card really hold what the reviewer is typing into, which is the guard
    // that stops a focused card being removed or re-parented.
    function reopen(id, options) {
      var where = options || {};
      if (open[id]) return open[id];
      var item = store.readItem(requireReview(), id);
      if (!item) throw new Error("comments.reopen: no item " + String(id) + " in review " + requireReview());
      var handle = buildHandle(item, {
        quote: item[record.FIELD.CONTEXT] ? item[record.FIELD.CONTEXT].quote : null,
        range: highlights ? highlights.rangeFor(id) : null,
        host: where.host || null,
        placement: where.host ? where.placement || "inline" : "anchored"
      });
      open[id] = handle;
      return handle;
    }

    function buildHandle(item, src) {
      var id = item[record.FIELD.ID];
      var node = null;
      var inputEl = null;
      var stateEl = null;
      var placement = src && src.placement === "inline" ? "inline" : "anchored";

      if (doc) {
        var host = (src && src.host) || surface();
        ensureBoxStyleIn(host);
        node = doc.createElement("div");
        node.className = BOX_CLASS;
        // Marked as the library's own chrome, so nothing here can reach a
        // record's markup (R23).
        markers.markChrome(node);
        node.setAttribute("data-lahe-item", id);
        node.setAttribute("data-lahe-placement", placement);

        var quote = item[record.FIELD.CONTEXT] ? item[record.FIELD.CONTEXT].quote : null;
        if (quote) {
          var quoteEl = doc.createElement("p");
          quoteEl.className = "lahe-comment-quote";
          quoteEl.textContent = quote;
          node.appendChild(quoteEl);
        }

        inputEl = doc.createElement("textarea");
        inputEl.className = INPUT_CLASS;
        inputEl.setAttribute("spellcheck", "false");
        inputEl.setAttribute("rows", "3");
        inputEl.setAttribute(
          "placeholder",
          item[record.FIELD.KIND] === record.KIND.NOTE ? "Not tied to any passage" : "What should change here?"
        );
        inputEl.value = item[record.FIELD.NOTE] || "";
        node.appendChild(inputEl);

        var foot = doc.createElement("div");
        foot.className = "lahe-comment-foot";
        var hint = doc.createElement("span");
        hint.className = "lahe-comment-hint";
        hint.textContent = HINT_READY;
        stateEl = doc.createElement("span");
        stateEl.className = "lahe-comment-state";
        stateEl.setAttribute("data-state", item[record.FIELD.STATE]);
        stateEl.textContent = item[record.FIELD.STATE] === record.STATE.READY ? "Ready" : "Draft";
        foot.appendChild(hint);
        foot.appendChild(stateEl);
        node.appendChild(foot);

        inputEl.addEventListener("input", function () {
          type(inputEl.value);
        });
        inputEl.addEventListener("keydown", function (event) {
          var got = gestures.gestureFor({
            type: "keydown",
            key: event.key,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
            inCommentBox: true
          });
          if (got.gesture === gestures.GESTURE.MARK_READY) {
            if (got.preventDefault) event.preventDefault();
            markReady();
            close();
          } else if (got.gesture === gestures.GESTURE.CANCEL) {
            if (got.preventDefault) event.preventDefault();
            // Esc cancels the thing that is open. Picking is more recent than
            // the box, so it goes first; a second Esc closes the box, with the
            // draft kept.
            if (pick.active) exitPickMode();
            else close();
          } else if (got.gesture === gestures.GESTURE.ENTER_ELEMENT_PICK) {
            // Starting the next comment without leaving the box first. The
            // document-level handler cannot see this one: the event retargets
            // to the library's own host, and everything of the library's is
            // skipped there by design.
            if (got.preventDefault) event.preventDefault();
            enterPickMode();
          }
        });

        if (host) host.appendChild(node);
        if (placement === "anchored") positionAt(node, src && src.range ? src.range : null);
      }

      // Every keystroke. Synchronous, before anything else.
      function type(text) {
        var current = handleItem();
        // A draft does not bump rev: drafts flow to the helper and the log
        // legitimately holds many events at one revision (idempotence is by
        // event id, never by item and rev).
        var next;
        if (record.isDraft(current)) {
          next = Object.assign({}, current);
          next[record.FIELD.NOTE] = String(text);
          next[record.FIELD.UPDATED_AT] = record.nowIso();
        } else {
          // Rewording something already ready bumps the revision, which is what
          // makes a stale reply naming the old revision refusable (R21).
          next = record.bumpRev(current, { note: String(text) });
        }
        store.write(requireReview(), next);
        if (inputEl && inputEl.value !== next[record.FIELD.NOTE]) inputEl.value = next[record.FIELD.NOTE];
        paintState(next);
        emit(next, "typed");
        return next;
      }

      function markReady() {
        var current = handleItem();
        var next = Object.assign({}, current);
        next[record.FIELD.STATE] = record.STATE.READY;
        next[record.FIELD.UPDATED_AT] = record.nowIso();
        record.validateItem(next);
        store.write(requireReview(), next);
        paintState(next);
        emit(next, "ready");
        return next;
      }

      function paintState(next) {
        if (!stateEl) return;
        stateEl.setAttribute("data-state", next[record.FIELD.STATE]);
        stateEl.textContent = next[record.FIELD.STATE] === record.STATE.READY ? "Ready" : "Draft";
      }

      function close() {
        // The draft is kept. Closing a box is not discarding work; only the
        // reviewer's own delete removes an item.
        if (node && node.parentNode) node.parentNode.removeChild(node);
        delete open[id];
        if (highlights) highlights.setActive(id, false);
        emit(handleItem(), "closed");
        return handleItem();
      }

      function focus() {
        if (inputEl && typeof inputEl.focus === "function") inputEl.focus();
        return inputEl;
      }

      function handleItem() {
        return store.readItem(requireReview(), id) || item;
      }

      return {
        id: id,
        get item() {
          return handleItem();
        },
        node: node,
        input: inputEl,
        placement: placement,
        focus: focus,
        type: type,
        markReady: markReady,
        close: close
      };
    }

    // Places an anchored box under its passage, kept inside the viewport and
    // clear of the rail. Fixed positioning, inside the shadow root: the page's
    // own layout never learns this happened.
    function positionAt(node, range) {
      if (!node || !win) return node;
      var vw = win.innerWidth || 1024;
      var vh = win.innerHeight || 768;
      var width = 288;
      var rect = range && typeof range.getBoundingClientRect === "function" ? range.getBoundingClientRect() : null;
      var top = rect ? rect.bottom + 10 : 24;
      var left = rect ? rect.left : 24;
      var rightLimit = Math.max(16, vw - width - 16 - RAIL_ALLOWANCE);
      if (left > rightLimit) left = rightLimit;
      if (left < 16) left = 16;
      if (top > vh - 180) top = Math.max(16, (rect ? rect.top : vh) - 180);
      node.style.top = Math.round(top) + "px";
      node.style.left = Math.round(left) + "px";
      return node;
    }

    // ------------------------------------------------------------------------
    // The three ways a comment starts
    // ------------------------------------------------------------------------

    // Cmd-Shift-C with a selection. The box opens already focused on that
    // passage (R16).
    function commentOnSelection(input) {
      var src = input || {};
      var selection = src.selection || (win && win.getSelection ? win.getSelection() : null);
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
      var range = selection.getRangeAt(0).cloneRange();
      var quote = String(selection.toString()).trim();
      if (!quote) return null;
      var element = blockOf(range.commonAncestorContainer);
      var handle = openBox({
        page: src.page,
        quote: quote,
        range: range,
        element: null,
        region: regionFor(element, range),
        heading: headingTextFor(element)
      });
      // The reviewer's selection has done its job; leaving it painted under the
      // highlight reads as two overlapping colors.
      if (selection.removeAllRanges) selection.removeAllRanges();
      handle.focus();
      return handle;
    }

    // Cmd-Shift-C with nothing selected. Hovering outlines, clicking comments,
    // Esc cancels (R17).
    function enterPickMode() {
      if (!doc) return pickState();
      pick.active = true;
      pick.element = null;
      showOutline(null);
      return pickState();
    }

    function exitPickMode() {
      pick.active = false;
      pick.element = null;
      showOutline(null);
      return pickState();
    }

    function pickState() {
      return {
        active: pick.active,
        outlining: pick.element ? pick.element.id || pick.element.tagName : null,
        element: pick.element
      };
    }

    // Comments on a whole element: the element's own contents are the passage.
    function commentOnElement(element, input) {
      var src = input || {};
      if (!element) return null;
      var range = doc.createRange();
      range.selectNodeContents(element);
      var handle = openBox({
        page: src.page,
        quote: String(element.textContent || "").trim(),
        range: range,
        element: element,
        region: regionFor(element, range),
        heading: headingTextFor(element)
      });
      handle.focus();
      return handle;
    }

    // A note tied to nothing (R18). No range, so nothing is painted and nothing
    // is anchored: the region stays empty and honest.
    function openNote(input) {
      var src = input || {};
      var handle = openBox({
        page: src.page,
        kind: record.KIND.NOTE,
        host: src.host,
        placement: src.host ? "inline" : "anchored",
        deferred: src.deferred !== false
      });
      if (src.focus !== false) handle.focus();
      return handle;
    }

    // ------------------------------------------------------------------------
    // Anchoring and labels
    // ------------------------------------------------------------------------

    function blockOf(node) {
      var el = node;
      while (el && el.nodeType !== 1) el = el.parentNode;
      return el && el.nodeType === 1 ? el : null;
    }

    function headingTextFor(element) {
      if (!element) return null;
      var el = element.previousElementSibling;
      while (el) {
        if (/^H[1-6]$/.test(el.tagName)) return normalize.normalizeText(el.textContent || "");
        el = el.previousElementSibling;
      }
      var parent = element.parentElement;
      return parent && parent !== doc.body ? headingTextFor(parent) : null;
    }

    // Mints the durable reference through 1C's engine and pins a display label
    // once. The label is display only; identity is the reference.
    function regionFor(element, range) {
      var region = record.emptyRegion();
      if (!element) return region;
      region.ref = anchor.mint({ element: element, range: range, root: doc });
      try {
        regions.pinLabel(region, descriptorFor(element));
      } catch (err) {
        // A label is a display convenience. A region with a reference and no
        // label is still a usable record, so this is the one place a failure is
        // recorded rather than thrown.
        region.label = null;
      }
      return region;
    }

    function descriptorFor(element) {
      var tag = String(element.tagName || "").toLowerCase();
      var ordinal = 1;
      var sibling = element.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === element.tagName) ordinal += 1;
        sibling = sibling.previousElementSibling;
      }
      return {
        authorName: element.getAttribute ? element.getAttribute(regions.AUTHOR_ATTR) : null,
        id: element.id || null,
        ariaLabel: element.getAttribute ? element.getAttribute("aria-label") : null,
        heading: headingTextFor(element),
        ordinal: ordinal,
        tag: tag,
        text: element.textContent || null
      };
    }

    // ------------------------------------------------------------------------
    // The pick-mode outline: drawn over the page, never on it
    // ------------------------------------------------------------------------

    function ensureOutline() {
      var host = surface();
      if (!host) return null;
      if (outlineNode && outlineNode.parentNode) return outlineNode;
      outlineNode = doc.createElement("div");
      outlineNode.className = OUTLINE_CLASS;
      markers.markChrome(outlineNode);
      host.appendChild(outlineNode);
      return outlineNode;
    }

    function showOutline(element) {
      var el = ensureOutline();
      if (!el) return null;
      if (!element) {
        el.style.display = "none";
        return el;
      }
      var r = element.getBoundingClientRect();
      el.style.display = "block";
      el.style.top = r.top + "px";
      el.style.left = r.left + "px";
      el.style.width = r.width + "px";
      el.style.height = r.height + "px";
      return el;
    }

    // ------------------------------------------------------------------------
    // The reviewer's own edits to their own comments
    // ------------------------------------------------------------------------

    function remove(id) {
      var removed = store.remove(requireReview(), id);
      if (open[id]) open[id].close();
      if (highlights) highlights.clear(id);
      if (removed) emit({ id: id }, "removed");
      return removed;
    }

    function items() {
      return store.read(requireReview());
    }

    // Outstanding work, newest first: what the Active tab shows.
    //
    // The reverse comes first, and it is not decoration. Two comments made in
    // the same millisecond carry the same created_at, and a sort alone would
    // then fall back to storage order, which is oldest first: the exact
    // opposite of what the rail promises. Reversing first, then sorting with a
    // stable sort, makes the tie break the right way.
    function outstanding() {
      var list = items().filter(function (item) {
        return item[record.FIELD.STATE] !== record.STATE.HANDLED;
      });
      list.reverse();
      return list.sort(function (a, b) {
        return String(b[record.FIELD.CREATED_AT]).localeCompare(String(a[record.FIELD.CREATED_AT]));
      });
    }

    function openBoxes() {
      return Object.keys(open).map(function (id) {
        return open[id];
      });
    }

    function closeAll() {
      openBoxes().forEach(function (handle) {
        handle.close();
      });
    }

    // Reopening an id that is already open returns the SAME node.
    function boxFor(id) {
      return open[id] || null;
    }

    function focusedBox() {
      return openBoxes().filter(function (handle) {
        return handle.node && handle.input && isFocused(handle.input);
      })[0] || null;
    }

    function isFocused(el) {
      var rootNode = el.getRootNode ? el.getRootNode() : doc;
      return rootNode && rootNode.activeElement === el;
    }

    // ------------------------------------------------------------------------
    // Wiring the gestures
    // ------------------------------------------------------------------------
    //
    // Every decision comes from the pure table. This function's only job is to
    // describe the world to it and then do what it says.

    function bind(input) {
      var src = input || {};
      var target = src.document || doc;
      if (!target) return { bound: false, reason: "no document" };
      if (src.page) setPage(src.page);
      unbind();

      listenerHandles.push(listeners.on(target, "keydown", onKeydown, true, LISTENER_GROUP));
      listenerHandles.push(listeners.on(target, "mousemove", onMouseMove, true, LISTENER_GROUP));
      listenerHandles.push(listeners.on(target, "click", onClick, true, LISTENER_GROUP));
      return { bound: true, listeners: listenerHandles.length };
    }

    function unbind() {
      listenerHandles.forEach(function (handle) {
        handle.off();
      });
      listenerHandles = [];
    }

    function describe(event) {
      var selection = win && win.getSelection ? win.getSelection() : null;
      return {
        type: event.type,
        key: event.key,
        metaKey: event.metaKey === true,
        ctrlKey: event.ctrlKey === true,
        shiftKey: event.shiftKey === true,
        hasSelection: !!(selection && selection.rangeCount > 0 && !selection.isCollapsed),
        inOverlay: markers.isInsideOverlay(event.target),
        pickMode: pick.active === true,
        inCommentBox: !!focusedBox()
      };
    }

    function onKeydown(event) {
      // The library's own UI handles its own keys; the box's handler already
      // ran by the time this sees it.
      if (markers.isInsideOverlay(event.target)) return;
      var got = gestures.gestureFor(describe(event));
      if (got.gesture === gestures.GESTURE.COMMENT_ON_SELECTION) {
        if (got.preventDefault) event.preventDefault();
        commentOnSelection({});
      } else if (got.gesture === gestures.GESTURE.ENTER_ELEMENT_PICK) {
        if (got.preventDefault) event.preventDefault();
        enterPickMode();
      } else if (got.gesture === gestures.GESTURE.CANCEL) {
        if (got.preventDefault) event.preventDefault();
        if (pick.active) exitPickMode();
      }
    }

    function onMouseMove(event) {
      if (!pick.active) return;
      var el = blockOf(event.target);
      if (!el || markers.isInsideOverlay(el)) return;
      if (el === doc.documentElement || el === doc.body) {
        pick.element = null;
        showOutline(null);
        return;
      }
      pick.element = el;
      showOutline(el);
    }

    function onClick(event) {
      if (markers.isInsideOverlay(event.target)) return;
      var got = gestures.gestureFor(describe(event));
      if (got.gesture !== gestures.GESTURE.PICK_ELEMENT) return;
      // The ONE time the library takes a click on the page, entered
      // deliberately by a keystroke one moment earlier.
      if (got.preventDefault) event.preventDefault();
      event.stopPropagation();
      var element = pick.element || blockOf(event.target);
      exitPickMode();
      if (element) commentOnElement(element, {});
    }

    function teardown() {
      unbind();
      closeAll();
      if (highlights) highlights.teardown();
      surfaceRoot = null;
      outlineNode = null;
    }

    return {
      BOX_CLASS: BOX_CLASS,
      INPUT_CLASS: INPUT_CLASS,
      OUTLINE_CLASS: OUTLINE_CLASS,
      HINT_READY: HINT_READY,
      setReview: setReview,
      setPage: setPage,
      onChange: onChange,
      openBox: openBox,
      openNote: openNote,
      reopen: reopen,
      remove: remove,
      items: items,
      outstanding: outstanding,
      boxFor: boxFor,
      openBoxes: openBoxes,
      closeAll: closeAll,
      focusedBox: focusedBox,
      commentOnSelection: commentOnSelection,
      commentOnElement: commentOnElement,
      enterPickMode: enterPickMode,
      exitPickMode: exitPickMode,
      pickMode: pickState,
      highlights: highlights,
      bind: bind,
      unbind: unbind,
      teardown: teardown
    };
  }

  return {
    BOX_CLASS: BOX_CLASS,
    INPUT_CLASS: INPUT_CLASS,
    OUTLINE_CLASS: OUTLINE_CLASS,
    HINT_READY: HINT_READY,
    BOX_STYLE: BOX_STYLE,
    createComments: createComments
  };
});
