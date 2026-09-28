// The Active tab's contents: outstanding comments and notes, newest visible,
// and the open note box at the foot.
//
// Owner: 1D. The rail CHROME (the tab shell, the status line, the failure
// chips, the card API) is 1B's, in overlay.js. This file is only what the
// Active tab holds, which is why five tasks are not writing one file.
//
// ---------------------------------------------------------------------------
// The law inherited from the rail: THE LIST UPDATES IN PLACE
// ---------------------------------------------------------------------------
//
// There is no render(items) here that redraws everything, and that is
// deliberate. A rail that rebuilds every row on every change destroys a
// half-reworded comment, because a removed node never fires blur. So: rows are
// created once, updated in place, and only ever removed when the reviewer
// deletes the item.
//
// ---------------------------------------------------------------------------
// How this file talks to the rail it lives in
// ---------------------------------------------------------------------------
//
// Through overlay's card API, never by editing overlay.js. Every item this tab
// shows is upserted as a card so the rail's own model knows its state, and the
// visible row is this file's. Until 1B's real rail lands, `mount()` with no
// host draws its own panel inside the library's one closed shadow surface, so
// the surface is scoreable on its own. When 1B passes a host, that fallback is
// never built. See the builder notes for the seam.
//
// Every gesture appears here as a readable hint line, rendered from the one
// gesture table, so a new user works the tool out from the page itself (R43).
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.tabActive = factory(
      root.LAHE.markers,
      root.LAHE.record,
      root.LAHE.gestures,
      root.LAHE.highlight,
      root.LAHE.overlay
    );
  } else {
    module.exports = factory(
      require("../shared/markers.js"),
      require("../shared/record.js"),
      require("../shared/gestures.js"),
      require("./highlight.js"),
      require("./overlay.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, record, gestures, highlightModule, overlayModule) {
  "use strict";

  var PANEL_CLASS = "lahe-rail";
  var PANEL_ATTR = "data-lahe-rail";
  var ROW_CLASS = "lahe-rail-row";
  var PANEL_WIDTH = 320;

  // How far each shadow paints beyond its element's box: offset plus blur,
  // rounded up. Kept beside the CSS that produces it, because bounds() is wrong
  // the moment the two disagree.
  var PANEL_SHADOW_REACH = 48;
  var PILL_SHADOW_REACH = 28;

  // Quiet furniture. It sits beside the page all session, so it is deliberately
  // plain: one hairline, one soft shadow, one accent, and type that does not
  // compete with whatever the page is doing.
  var PANEL_STYLE = [
    "." + PANEL_CLASS + " {",
    "  position: fixed;",
    "  top: 0;",
    "  right: 0;",
    "  bottom: 0;",
    "  width: " + PANEL_WIDTH + "px;",
    "  max-width: 92vw;",
    "  pointer-events: auto;",
    "  display: flex;",
    "  flex-direction: column;",
    "  background: #ffffff;",
    "  border-left: 1px solid rgba(17, 17, 17, 0.12);",
    "  box-shadow: -12px 0 32px rgba(17, 17, 17, 0.08);",
    // Above the pick-mode outline, which is drawn over the page and must not
    // paint across the rail.
    "  z-index: 2;",
    "  font: 13px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif;",
    "  color: #111111;",
    "}",
    "." + PANEL_CLASS + "[hidden] { display: none; }",
    ".lahe-rail-head {",
    "  display: flex;",
    "  align-items: baseline;",
    "  justify-content: space-between;",
    "  gap: 8px;",
    "  padding: 14px 16px 10px;",
    "  border-bottom: 1px solid rgba(17, 17, 17, 0.08);",
    "}",
    ".lahe-rail-title { font-weight: 600; letter-spacing: 0.01em; }",
    ".lahe-rail-count { color: rgba(17, 17, 17, 0.5); font-size: 12px; }",
    ".lahe-rail-list { flex: 1 1 auto; overflow-y: auto; padding: 8px 12px 12px; display: flex; flex-direction: column; gap: 8px; }",
    ".lahe-rail-empty { color: rgba(17, 17, 17, 0.45); font-size: 12px; padding: 8px 4px; }",
    "." + ROW_CLASS + " {",
    "  border: 1px solid rgba(17, 17, 17, 0.1);",
    "  border-radius: 10px;",
    "  padding: 10px;",
    "  background: #ffffff;",
    "  display: flex;",
    "  flex-direction: column;",
    "  gap: 6px;",
    "}",
    "." + ROW_CLASS + "[data-kind='note'] { border-style: dashed; }",
    ".lahe-rail-quote {",
    "  margin: 0;",
    "  padding-left: 8px;",
    "  border-left: 2px solid rgba(255, 178, 26, 0.9);",
    "  color: rgba(17, 17, 17, 0.6);",
    "  font-size: 12px;",
    "  max-height: 3.2em;",
    "  overflow: hidden;",
    "}",
    ".lahe-rail-note { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }",
    ".lahe-rail-note[data-empty='true'] { color: rgba(17, 17, 17, 0.4); }",
    // The note is the input (there is no Reword button), so it says so: a
    // pointer that means text, a quiet hover, and a real focus ring when the
    // reviewer is in it.
    ".lahe-rail-note[data-lahe-note-editor] { cursor: text; border-radius: 6px;",
    "  margin: 0 -4px; padding: 2px 4px; }",
    ".lahe-rail-note[data-lahe-note-editor]:hover { background: rgba(17, 17, 17, 0.04); }",
    ".lahe-rail-note[data-lahe-note-editor]:focus { outline: 2px solid rgba(60, 86, 165, 0.9);",
    "  outline-offset: 1px; background: #ffffff; }",
    ".lahe-rail-note[contenteditable='false'] { cursor: default; }",
    ".lahe-rail-note[data-empty='true']::before { content: 'Empty draft'; }",
    ".lahe-rail-rowfoot { display: flex; align-items: center; gap: 8px; font-size: 11px; color: rgba(17, 17, 17, 0.5); }",
    ".lahe-rail-state { text-transform: none; }",
    ".lahe-rail-btn {",
    "  margin-left: auto;",
    "  border: 0;",
    "  background: none;",
    "  padding: 2px 4px;",
    "  font: inherit;",
    "  color: rgba(17, 17, 17, 0.55);",
    "  cursor: pointer;",
    "  border-radius: 4px;",
    "}",
    ".lahe-rail-btn:hover { color: #111111; background: rgba(17, 17, 17, 0.06); }",
    ".lahe-rail-foot { border-top: 1px solid rgba(17, 17, 17, 0.08); padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }",
    ".lahe-rail-footlabel { font-size: 11px; color: rgba(17, 17, 17, 0.5); }",
    ".lahe-rail-hints { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 4px; font-size: 11px; color: rgba(17, 17, 17, 0.55); }",
    ".lahe-rail-hints li { display: flex; gap: 8px; }",
    ".lahe-rail-keys { flex: 0 0 auto; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: rgba(17, 17, 17, 0.75); }",
    ".lahe-rail-pill {",
    "  position: fixed;",
    "  right: 16px;",
    "  bottom: 16px;",
    "  pointer-events: auto;",
    "  min-width: 44px;",
    "  height: 32px;",
    "  padding: 0 12px;",
    "  border-radius: 999px;",
    "  border: 1px solid rgba(17, 17, 17, 0.12);",
    "  background: #ffffff;",
    "  box-shadow: 0 6px 20px rgba(17, 17, 17, 0.16);",
    "  font: 12px/32px ui-sans-serif, system-ui, -apple-system, sans-serif;",
    "  color: #111111;",
    "  cursor: pointer;",
    "  z-index: 2;",
    "}",
    ".lahe-rail-pill[hidden] { display: none; }",
    // The page picks the scheme, not the OS (highlight.js stamps the host).
    ":host([data-lahe-scheme='dark']) ." + PANEL_CLASS + ",",
    ":host([data-lahe-scheme='dark']) ." + ROW_CLASS + ",",
    ":host([data-lahe-scheme='dark']) .lahe-rail-pill { background: #1b1b1d; color: #f2f2f2; border-color: rgba(255,255,255,0.16); }",
    ":host([data-lahe-scheme='dark']) .lahe-rail-count,",
    ":host([data-lahe-scheme='dark']) .lahe-rail-quote,",
    ":host([data-lahe-scheme='dark']) .lahe-rail-rowfoot,",
    ":host([data-lahe-scheme='dark']) .lahe-rail-hints,",
    ":host([data-lahe-scheme='dark']) .lahe-rail-footlabel { color: rgba(242,242,242,0.6); }",
    ":host([data-lahe-scheme='dark']) .lahe-rail-keys { color: rgba(242,242,242,0.85); }"
  ].join("\n");

  // ---------------------------------------------------------------------------
  // What this tab draws INSIDE the rail
  // ---------------------------------------------------------------------------
  //
  // PANEL_STYLE above draws the standalone panel and is added to the library's
  // outer surface. It is NOT the rail's stylesheet and never was: the rail lives
  // in a second, closed shadow root of its own, so nothing added to the outer
  // surface reaches a hosted row. The hosted path used to add no stylesheet at
  // all, which is why every `.lahe-rail-*` element in the rail rendered naked:
  // full-ink prose where a hint list should be, and two unstyled buttons run
  // together into "RewordDelete" under the reviewer's own sentence.
  //
  // So the hosted path has its own sheet, installed in the rail's own closed
  // root through the rail's ensureStyleSheet. It is small on purpose: the rail
  // already owns the card, the quote, the state chip and the button register
  // (`.cardact`), and this file adds only the three things it actually draws.
  var HOSTED_SHEET_KEY = "tab_active";
  var HOSTED_STYLE = [
    ".lahe-rail-foot{display:flex;flex-direction:column;gap:9px;padding:2px 0 0}",
    ".lahe-rail-footlabel{font-size:10px;font-weight:600;letter-spacing:.08em;",
    "text-transform:uppercase;color:var(--ink-faint)}",
    // The hosted row is a column with real air in it. Without this the note and
    // the action under it touched, which is worse now the note is a surface the
    // reviewer clicks into: the click target ended where Delete began.
    "[data-lahe-active-row]{display:flex;flex-direction:column;gap:8px}",
    ".lahe-rail-note{white-space:pre-wrap;overflow-wrap:anywhere}",
    ".lahe-rail-note[data-empty='true']{color:var(--ink-faint)}",
    // THE NOTE IS THE INPUT. Ken: "do we really need a button for 'reword'?
    // before we could just edit a comment and the color would go from green to
    // yellow and that was how we knew." So the words carry the affordance the
    // button used to: a text cursor, a hover that lifts them off the card, and a
    // focus ring while the reviewer is typing in them.
    ".lahe-rail-note[data-lahe-note-editor]{cursor:text;border-radius:6px;",
    "margin:0 -4px;padding:2px 4px;transition:background 90ms ease}",
    ".lahe-rail-note[data-lahe-note-editor]:hover{background:var(--sunken)}",
    ".lahe-rail-note[data-lahe-note-editor]:focus{outline:2px solid var(--accent);",
    "outline-offset:1px;background:var(--paper)}",
    // A window that may not write to the review reads as prose again.
    ".lahe-rail-note[contenteditable='false']{cursor:default}",
    ".lahe-rail-note[contenteditable='false']:hover{background:transparent}",
    // The empty-draft label is drawn, not typed: text inside the node would be
    // text the reviewer has to delete before writing their own sentence.
    ".lahe-rail-note[data-empty='true']::before{content:'Empty draft'}",
    // The one hint surface is the rail footer's keycaps. Every OTHER gesture is
    // still reachable, and still rendered from the one gesture table (R43), but
    // it is behind a disclosure instead of being an eight-line wall of prose
    // that is the loudest thing in an empty rail.
    ".lahe-rail-more{font-size:11.5px;color:var(--ink-soft)}",
    ".lahe-rail-more>summary{list-style:none;cursor:pointer;display:flex;align-items:center;",
    "gap:5px;color:var(--ink-faint);font-size:11px;font-weight:550;letter-spacing:.01em}",
    ".lahe-rail-more>summary::-webkit-details-marker{display:none}",
    ".lahe-rail-more>summary::before{content:'›';display:inline-block;font-size:13px;line-height:1;",
    "transform:translateY(-1px);transition:transform 120ms ease}",
    ".lahe-rail-more[open]>summary::before{transform:rotate(90deg) translateX(-1px)}",
    ".lahe-rail-more>summary:hover{color:var(--ink-soft)}",
    ".lahe-rail-hints{list-style:none;display:flex;flex-direction:column;gap:6px;",
    "margin-top:8px;font-size:11.5px;color:var(--ink-soft);line-height:1.4}",
    ".lahe-rail-hints li{display:flex;gap:8px;align-items:baseline}",
    // The same keycap the footer's hints use, so there is one hint language.
    ".lahe-rail-keys{flex:0 0 auto;font-size:10.5px;font-weight:600;color:var(--ink);",
    "background:var(--sunken);border:1px solid var(--line);border-bottom-width:2px;",
    "border-radius:5px;padding:1px 5px;white-space:nowrap}",
    ".lahe-rail-hint{flex:1}",
    // F10: the note box is not in a .card__body, so it never picked up the
    // rail's resize:none and wore the browser's diagonal grabber. It is the one
    // place the rail looked like a form control instead of a surface.
    ".lahe-rail-foot textarea{resize:none}",
    // ADD ANOTHER MESSAGE, while the agent has not answered yet. Ken: "we
    // should still be able to leave more comments in that thread, not being
    // forced to wait for a response before leaving another comment."
    //
    // Quiet by default and only as tall as one line, because the note above it
    // is the reviewer's actual comment and this must not compete with it. It
    // grows when they click into it, which is the same bargain the note itself
    // makes: the affordance is the surface, not a button beside it.
    ".lahe-rail-add{display:flex;flex-direction:column;gap:6px}",
    ".lahe-rail-add textarea{resize:none;width:100%;box-sizing:border-box;",
    "font:inherit;font-size:12.5px;line-height:1.45;color:var(--ink);",
    "background:var(--sunken);border:1px solid var(--line);border-radius:6px;",
    "padding:5px 7px;transition:background 90ms ease}",
    ".lahe-rail-add textarea::placeholder{color:var(--ink-faint)}",
    ".lahe-rail-add textarea:focus{outline:2px solid var(--accent);outline-offset:1px;",
    "background:var(--paper)}",
    ".lahe-rail-add textarea:disabled{opacity:.55}",
    ".lahe-rail-addacts{display:flex;justify-content:flex-end}",
    ".lahe-rail-send{font-size:11.5px;font-weight:600;padding:3px 10px;border-radius:6px;",
    "border:1px solid var(--line);background:var(--paper);color:var(--ink-soft);cursor:pointer}",
    ".lahe-rail-send:hover{background:var(--surface);color:var(--ink)}",
    ".lahe-rail-send[disabled]{opacity:.55;cursor:default}"
  ].join("");

  function createActiveTab(options) {
    var opts = options || {};
    var comments = opts.comments || null;
    if (!comments) throw new TypeError("createActiveTab: a comments surface is required");
    var doc = Object.prototype.hasOwnProperty.call(opts, "document")
      ? opts.document
      : typeof document !== "undefined"
      ? document
      : null;
    var rail = opts.overlay || overlayModule.shared;
    var highlights = opts.highlights || comments.highlights || null;
    // For the add-another-message box's draft only. Optional, because this file
    // is mountable on its own with no rail and no storage (that is what makes
    // 1D scoreable alone), and a missing store costs a draft rather than the
    // feature: the box still sends, it just does not survive a reload.
    var store = opts.store || null;
    var reviewId = opts.reviewId || null;
    // The rail's Active pane, when 1B's rail is what this tab lives in. With a
    // host, this file draws the tab's CONTENTS and nothing else: no panel of
    // its own, no pill, no chrome. Without one it falls back to its own panel
    // in the library's shadow surface, which is what makes 1D scoreable alone.
    var providedHost = opts.host || null;
    var hosted = !!providedHost;

    var panel = null;
    var listEl = null;
    var emptyEl = null;
    var countEl = null;
    var footEl = null;
    var pill = null;
    var noteHandle = null;
    var collapsed = false;
    var mounted = false;
    // The sheet itself, not a boolean. See ensureHostedStyle.
    var hostedStyleNode = null;
    var unsubscribe = null;
    // id -> row node. The reason there is no rebuild path.
    var rows = Object.create(null);

    function surfaceRoot() {
      // PANEL_STYLE draws the standalone panel, so it is not added when the
      // rail is the panel.
      if (providedHost) return providedHost;
      if (!doc || !highlights) return null;
      highlights.addSurfaceStyle("tab_active", PANEL_STYLE);
      var got = highlights.surface();
      return got.root || got.host;
    }

    function el(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = text;
      markers.markChrome(node);
      return node;
    }

    function mount() {
      if (mounted) return handle();
      var host = surfaceRoot();
      if (!host) {
        mounted = true;
        return handle();
      }

      if (hosted) return mountInRail(host);

      panel = el("section", PANEL_CLASS);
      panel.setAttribute(PANEL_ATTR, "");
      panel.setAttribute("aria-label", "Review");

      var head = el("header", "lahe-rail-head");
      head.appendChild(el("span", "lahe-rail-title", "Active"));
      countEl = el("span", "lahe-rail-count", "");
      head.appendChild(countEl);
      panel.appendChild(head);

      listEl = el("div", "lahe-rail-list");
      emptyEl = el("p", "lahe-rail-empty", "Nothing outstanding. Select text and press Cmd-Shift-C.");
      listEl.appendChild(emptyEl);
      panel.appendChild(listEl);

      footEl = el("footer", "lahe-rail-foot");
      footEl.appendChild(el("span", "lahe-rail-footlabel", "A note about the page, tied to nothing"));
      panel.appendChild(footEl);
      footEl.appendChild(hintList());

      pill = el("button", "lahe-rail-pill", "Review");
      pill.setAttribute("type", "button");
      pill.hidden = true;
      pill.addEventListener("click", function () {
        collapse(false);
      });

      host.appendChild(panel);
      host.appendChild(pill);

      openNoteBox();
      unsubscribe = comments.onChange(function (item, event) {
        onItemChanged(item, event);
      });
      mounted = true;
      refresh();
      return handle();
    }

    // Inside the rail's Active pane. The rail owns the panel, the counts, the
    // status line and the collapsed pill, so none of that is built here; what
    // is left is the tab's own contents, which is the note box at the foot, the
    // gesture hints, and a body inside each of the rail's own cards.
    //
    // The foot is kept last by flex ORDER rather than by re-appending it after
    // every change: the rail appends new cards to the same pane, and moving the
    // foot would re-parent the note box the reviewer may be typing in.
    function mountInRail(host) {
      footEl = el("footer", "lahe-rail-foot");
      footEl.style.order = "9";
      // The stylesheet goes in with the first node this file puts in the rail's
      // closed root. Without it every class below is a name with nothing behind
      // it, which is exactly what shipped.
      ensureHostedStyle(footEl);
      footEl.appendChild(el("span", "lahe-rail-footlabel", "A note about the page"));
      host.appendChild(footEl);
      footEl.appendChild(hintList());

      openNoteBox();
      unsubscribe = comments.onChange(function (item, event) {
        onItemChanged(item, event);
      });
      mounted = true;
      refresh();
      return handle();
    }

    // The note box at the foot of the thread: an open box tied to nothing
    // (R18). It is created once and replaced only when the reviewer finishes
    // the one that is there.
    function openNoteBox() {
      if (!footEl) return null;
      noteHandle = comments.openNote({ host: footEl, focus: false });
      // Keep the hint disclosure last, under the box.
      var more = footEl.querySelector(".lahe-rail-more") || footEl.querySelector(".lahe-rail-hints");
      if (more) footEl.appendChild(more);
      return noteHandle;
    }

    // A refused window closes every composer before it becomes read-only. When
    // an explicit takeover makes that window writable again, restore the
    // always-available page-note composer instead of leaving a subtly reduced
    // rail that can select comments but cannot write an untethered note.
    function ensureNoteBox() {
      if (noteHandle && comments.boxFor(noteHandle.id)) return noteHandle;
      return openNoteBox();
    }

    /**
     * The hosted stylesheet, once, inside the rail's own closed root.
     *
     * Connectedness, not a boolean, and the rail's root rather than the foot.
     * The sheet used to ride inside the footer this file builds; a footer that
     * is removed on its own takes the sheet with it while a flag set once still
     * says "installed", and every `.lahe-rail-*` element after that draws naked.
     *
     * `node` is the fallback host for a rail with no ensureStyleSheet on it
     * (a stub in a unit test).
     */
    function ensureHostedStyle(node) {
      if (!hosted || !doc) return;
      if (hostedStyleNode && hostedStyleNode.isConnected) return;
      if (rail && typeof rail.ensureStyleSheet === "function") {
        hostedStyleNode = rail.ensureStyleSheet(HOSTED_SHEET_KEY, HOSTED_STYLE);
        if (hostedStyleNode) return;
      }
      if (!node) return;
      var style = doc.createElement("style");
      style.setAttribute("data-lahe-sheet", HOSTED_SHEET_KEY);
      style.textContent = HOSTED_STYLE;
      node.appendChild(style);
      hostedStyleNode = style;
    }

    // Every gesture, from the one gesture table (R43), rendered as keycaps
    // rather than as prose. Hosted, it is behind a disclosure: the rail's footer
    // already teaches the three gestures a reviewer needs on the first day, and
    // printing eight more above them made the reviewer read the rules twice in
    // two registers in one column. Standalone there is no footer to defer to, so
    // the list is open.
    function hintList() {
      var list = el("ul", "lahe-rail-hints");
      gestures.hintLines().forEach(function (line) {
        var li = el("li");
        li.appendChild(el("span", "lahe-rail-keys", line.keys));
        li.appendChild(el("span", "lahe-rail-hint", line.hint));
        list.appendChild(li);
      });
      if (!hosted) return list;
      var more = el("details", "lahe-rail-more");
      more.appendChild(el("summary", null, "All shortcuts"));
      more.appendChild(list);
      return more;
    }

    function hintText() {
      var container = panel || footEl;
      if (!container) {
        return gestures
          .hintLines()
          .map(function (line) {
            return line.keys + " " + line.hint;
          })
          .join("\n");
      }
      return container.querySelector(".lahe-rail-hints").textContent;
    }

    function onItemChanged(item, event) {
      if (!mounted) return;
      if (event === "removed") {
        dropRow(item.id);
        // Deleting the page-note draft takes its box with it, and the composer
        // at the foot of the thread is meant to stand open all session. A fresh
        // empty one replaces it, exactly as finishing a note does.
        if (noteHandle && item.id === noteHandle.id) openNoteBox();
        refreshCount();
        return;
      }
      if (noteHandle && item[record.FIELD.ID] === noteHandle.id && event === "ready") {
        // The reviewer finished the untethered note, so the foot gets a fresh
        // empty one and the finished note joins the list.
        openNoteBox();
      }
      refresh();
    }

    // In place, always. New items get a row at the top (newest visible without
    // scrolling); existing rows are updated where they are.
    function refresh() {
      if (!mounted && !listEl) return handle();
      if (!listEl && !hosted) return handle();
      // Every paint, not only the mount that built the foot: the sheet lives in
      // the rail's root, and a remount throws that root away.
      ensureHostedStyle(footEl);
      var items = comments.outstanding().filter(function (item) {
        // The Active thread carries comments and notes only. Hand edits live in
        // the Edits tab (R32: neither buries the other); rendering a comment row
        // into an edit's card was the cross-task defect 3D flagged at the stitch.
        var kind = item[record.FIELD.KIND];
        if (kind !== record.KIND.COMMENT && kind !== record.KIND.NOTE) return false;
        return !noteHandle || item[record.FIELD.ID] !== noteHandle.id || !record.isDraft(item);
      });
      var seen = Object.create(null);

      items.forEach(function (item) {
        var id = item[record.FIELD.ID];
        seen[id] = true;
        rail.upsertCard(item);
        rail.setCardState(id, item[record.FIELD.STATE]);
        if (!rows[id]) {
          rows[id] = buildRow(item);
          // Inside the rail's own card, so the card really holds what the
          // reviewer is looking at and holdsFocus(id) can be true for it.
          if (hosted) rail.attachCardNode(id, rows[id]);
          else listEl.insertBefore(rows[id], listEl.firstChild);
        }
        updateRow(rows[id], item);
      });

      Object.keys(rows).forEach(function (id) {
        if (!seen[id]) dropRow(id);
      });

      if (emptyEl) {
        emptyEl.hidden = items.length > 0;
        if (emptyEl.parentNode !== listEl) listEl.appendChild(emptyEl);
      }
      refreshCount();
      return handle();
    }

    function refreshCount() {
      if (!countEl) return;
      var n = Object.keys(rows).length;
      countEl.textContent = n === 1 ? "1 open" : n + " open";
    }

    function buildRow(item) {
      var id = item[record.FIELD.ID];
      var row = el("article", ROW_CLASS);
      row.setAttribute("data-lahe-item", id);
      row.setAttribute("data-kind", item[record.FIELD.KIND]);
      // What the rail hides on a card that moved to Done: the note and the two
      // actions below are the ACTIVE tab's carriers, and a handled card gets
      // both from the Done row and the rail's own agent block instead. The
      // marker rather than a call, because a row is never withdrawn from a card
      // the reviewer may be typing in.
      if (hosted) row.setAttribute("data-lahe-active-row", "");

      // The rail's card already carries the quote and the lifecycle chip, so a
      // hosted row would say both of them twice. It draws what is left.
      if (!hosted) {
        var quote = el("p", "lahe-rail-quote", "");
        row.appendChild(quote);
      }

      // THE ROW'S NOTE IS THE INPUT, and it is created once with the row.
      //
      // There is no Reword button any more. Ken, after using the rail: "do we
      // really need a button for 'reword'? before we could just edit a comment
      // and the color would go from green to yellow and that was how we knew."
      // Clicking into these words starts the same rewording session the button
      // used to open, and the rules of that session (keystrokes are content, the
      // commit is the revision, R21) live in one place, in comments.js.
      //
      // The node the reviewer READS and the node they TYPE IN are the same node.
      // Swapping one for a control on click would be the rail rebuilding a row
      // under a caret, which is the revert mechanism this file exists to avoid.
      var note = el("p", "lahe-rail-note", "");
      row.appendChild(note);
      comments.attachNoteEditor(id, note);

      // Hosted, these are the rail's own quiet card actions (one register for
      // every control that sits on a card). Standalone they keep the panel's own
      // button class, which its stylesheet does draw.
      var actionClass = hosted ? "cardact cardact--quiet" : "lahe-rail-btn";
      var foot = el("div", hosted ? "cardacts" : "lahe-rail-rowfoot");
      if (!hosted) foot.appendChild(el("span", "lahe-rail-state", ""));
      var del = el("button", actionClass, "Delete");
      del.setAttribute("data-lahe-act", "delete");
      del.setAttribute("type", "button");
      del.addEventListener("click", function () {
        comments.remove(id);
      });
      foot.appendChild(del);
      row.appendChild(foot);

      // The box for another message, under the row's own actions. It is drawn
      // once with the row like everything else here, and shown or hidden by
      // updateRow, because building it on demand would be this file rebuilding
      // a row under a caret.
      row.appendChild(buildAddBox(id));
      return row;
    }

    /**
     * "Add another message", for a comment no agent has answered yet.
     *
     * The reviewer submitted a comment and then thought of something else. Until
     * this existed the card had no input at all: the note above is a rewording
     * surface, so using it meant editing the sentence they already sent rather
     * than adding to it, and the follow-up composer only ever appears once a
     * reply has landed.
     *
     * It APPENDS rather than opening a round. comments.appendToNote carries the
     * reasoning and the guarantee that the agent is woken for it; the short
     * version is that a thread round is a completed exchange and nothing here
     * has been answered, so there is no exchange to keep.
     */
    /**
     * How this rail spells the commit chord, from the one gesture table.
     *
     * Read rather than typed, so the placeholder cannot drift from the footer's
     * own hints when the table changes. R43 is that every gesture is rendered
     * from one table; a hard-coded chord here would be a second spelling of it.
     */
    function sendKeys() {
      var row = null;
      (gestures.TABLE || []).forEach(function (entry) {
        if (!row && entry.gesture === gestures.GESTURE.MARK_READY) row = entry;
      });
      return (row && row.keys) || "Cmd-Enter";
    }

    function keepsDrafts() {
      return !!(store && reviewId && typeof store.readFollowupDraft === "function");
    }

    function buildAddBox(id) {
      var box = el("section", "lahe-rail-add");
      box.setAttribute("data-lahe-add", id);
      box.hidden = true;

      var input = el("textarea", "");
      input.id = "lahe-add-" + id;
      input.setAttribute("rows", "1");
      input.setAttribute("aria-label", "Add another message to this comment");
      // A SEND BUTTON, because that is what a text input has. Ken: "a send
      // button under a text input is a fine idea. that is convention."
      //
      // It is not one of the card's actions and it is not in their row. Delete
      // acts on the comment; this belongs to the box above it, the same way the
      // follow-up composer's own send button belongs to its box. That is the
      // line between a control worth removing and a control worth keeping: the
      // ones taken off these cards today all sat in the action row repeating
      // something already on screen.
      input.setAttribute("placeholder", "Add another message");
      input.value = keepsDrafts() ? store.readFollowupDraft(reviewId, id) : "";

      function submit() {
        var text = input.value;
        if (!text.trim()) return;
        // Storage first, then the box: appendToNote writes the record, and
        // clearing the field before it committed would lose the words if the
        // write refused.
        var next = comments.appendToNote(id, text);
        if (!next) return;
        if (keepsDrafts()) {
          try {
            store.clearFollowupDraft(reviewId, id);
          } catch (err) {
            if (err && err.failure && rail && rail.failures) rail.failures.add(err.failure);
          }
        }
        input.value = "";
      }

      input.addEventListener("input", function () {
        if (keepsDrafts()) store.writeFollowupDraft(reviewId, id, input.value);
      });
      input.addEventListener("keydown", function (event) {
        // The same commit gesture as every other box in the rail.
        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();
          submit();
        }
      });

      var acts = el("div", "lahe-rail-addacts");
      var send = el("button", "lahe-rail-send", "Send");
      send.setAttribute("type", "button");
      send.addEventListener("click", submit);
      send.title = "Send this message (" + sendKeys() + ")";
      acts.appendChild(send);

      box.appendChild(input);
      box.appendChild(acts);
      return box;
    }

    function updateRow(row, item) {
      var quote = row.querySelector(".lahe-rail-quote");
      if (quote) {
        var quoteText = item[record.FIELD.CONTEXT] ? item[record.FIELD.CONTEXT].quote : null;
        quote.textContent = quoteText || "";
        quote.hidden = !quoteText;
      }

      var note = row.querySelector(".lahe-rail-note");
      var text = item[record.FIELD.NOTE];
      // NEVER WRITE OVER THE REVIEWER'S CARET. Every keystroke in the note comes
      // back through here as a changed item, and putting the same words back
      // into the node the reviewer is typing in would collapse their caret to
      // the start of the sentence on every letter. The record is already what
      // they typed; the node is already showing it.
      if (!isBeingEdited(note)) note.textContent = text ? text : "";
      // The empty-draft label is drawn by the stylesheet, so this attribute is
      // kept current even mid-sentence: without it the label would sit beside
      // the first letter the reviewer types.
      note.setAttribute("data-empty", text ? "false" : "true");
      comments.setNoteEditorEnabled(item[record.FIELD.ID], !item[record.FIELD.REPLY]);

      // Only while the agent has not answered, and only once the comment has
      // actually been sent. A draft is not waiting on anybody, so its own note
      // is still the place to keep writing; an answered comment continues in the
      // follow-up composer, where the completed exchange stays intact.
      var add = row.querySelector(".lahe-rail-add");
      if (add) {
        add.hidden = !!item[record.FIELD.REPLY] || item[record.FIELD.STATE] !== record.STATE.READY;
        var field = add.querySelector("textarea");
        if (field) field.disabled = !!item[record.FIELD.REPLY];
        var send = add.querySelector(".lahe-rail-send");
        if (send) send.disabled = !!item[record.FIELD.REPLY];
      }

      var state = row.querySelector(".lahe-rail-state");
      if (state) state.textContent = stateLabel(item);
      row.setAttribute("data-state", item[record.FIELD.STATE]);
    }

    /**
     * Is the reviewer's cursor in this note right now?
     *
     * Asked of the note's own root rather than of the document: the rail is a
     * closed shadow root, and document.activeElement outside one only ever names
     * the host.
     */
    function isBeingEdited(note) {
      if (!note || typeof note.getRootNode !== "function") return false;
      var rootNode = note.getRootNode();
      return !!rootNode && rootNode.activeElement === note;
    }

    // Nothing that is not ready is actionable (R7), and the row says so in
    // words rather than in a color a reviewer has to learn.
    function stateLabel(item) {
      var state = item[record.FIELD.STATE];
      if (state === record.STATE.DRAFT) return "Draft, not sent";
      if (state === record.STATE.READY) return "Ready";
      if (state === record.STATE.NOT_HANDLED) return "Not handled";
      return "Handled";
    }

    // This tab's row goes, always. The CARD goes only when no other tab is
    // showing it: it is one shared card per item, and a handled comment's card
    // belongs to the Done tab while this tab still has a row to clean up (the
    // reviewer closes the comment box, this tab refreshes, the handled item is
    // no longer outstanding). Removing the card there deleted the reply Done
    // was displaying. rail.releaseCard is the one place that rule is spelled.
    function dropRow(id) {
      // The note goes with the row it was drawn in: a session left registered
      // against a node nobody can see is a rewording nobody can end.
      comments.detachNoteEditor(id);
      var row = rows[id];
      // detachCardNode, not removeChild: the card remembers the nodes attached
      // to it and puts them back when it is rebuilt, so a row torn out of the
      // DOM alone comes back on the next remount.
      if (row && !rail.detachCardNode(id, row) && row.parentNode) {
        row.parentNode.removeChild(row);
      }
      delete rows[id];
      rail.releaseCard(id, overlayModule.TAB.ACTIVE);
    }

    function focusNote() {
      if (!noteHandle) return null;
      return noteHandle.focus();
    }

    function noteBox() {
      return noteHandle;
    }

    // The collapsed pill never overlaps the open rail: only one of the two is
    // ever on screen.
    function collapse(next) {
      // The rail owns the collapsed pill when the rail is the panel. Two things
      // that collapse independently would let the reviewer hide one and keep
      // the other.
      if (hosted) {
        collapsed = rail.collapse(next);
        return collapsed;
      }
      collapsed = next === undefined ? !collapsed : !!next;
      if (panel) panel.hidden = collapsed;
      if (pill) pill.hidden = !collapsed;
      return collapsed;
    }

    function isCollapsed() {
      return hosted ? rail.isCollapsed() : collapsed;
    }

    // What the rail occupies right now, in viewport coordinates, INCLUDING the
    // reach of its shadow. A box shadow paints outside the element's box, so a
    // caller told the border-box edge and asked "is the page identical outside
    // the rail" gets a wrong answer by 44 pixels. Ranked test 18 clips its
    // screenshot to everything left of this, which is the honest reading of
    // "identical outside the rail's bounds".
    function bounds() {
      if (hosted) {
        var geometry = rail.geometry();
        var rect = geometry.rail || geometry.pill;
        if (!rect) return { left: 0, top: 0, width: 0, height: 0 };
        var railReach = geometry.rail ? PANEL_SHADOW_REACH : PILL_SHADOW_REACH;
        return {
          left: rect.left - railReach,
          top: rect.top - railReach,
          width: rect.right - rect.left + railReach,
          height: rect.bottom - rect.top + railReach * 2,
          right: rect.right,
          bottom: rect.bottom + railReach
        };
      }
      var node = collapsed ? pill : panel;
      if (!node || !node.getBoundingClientRect) return { left: 0, top: 0, width: 0, height: 0 };
      var reach = collapsed ? PILL_SHADOW_REACH : PANEL_SHADOW_REACH;
      var r = node.getBoundingClientRect();
      return {
        left: r.left - reach,
        top: r.top - reach,
        width: r.width + reach,
        height: r.height + reach * 2,
        right: r.right,
        bottom: r.bottom + reach
      };
    }

    function unmount() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      Object.keys(rows).forEach(function (id) {
        comments.detachNoteEditor(id);
      });
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      if (pill && pill.parentNode) pill.parentNode.removeChild(pill);
      if (footEl && footEl.parentNode) footEl.parentNode.removeChild(footEl);
      panel = null;
      pill = null;
      listEl = null;
      footEl = null;
      countEl = null;
      emptyEl = null;
      noteHandle = null;
      rows = Object.create(null);
      mounted = false;
      // The sheet lives in the rail's root now, which a remount throws away, so
      // the next mount asks for it again rather than trusting a stale handle.
      hostedStyleNode = null;
    }

    function isMounted() {
      return mounted;
    }

    function handle() {
      return api;
    }

    var api = {
      PANEL_CLASS: PANEL_CLASS,
      PANEL_ATTR: PANEL_ATTR,
      ROW_CLASS: ROW_CLASS,
      mount: mount,
      unmount: unmount,
      isMounted: isMounted,
      refresh: refresh,
      rowCount: function () {
        return Object.keys(rows).length;
      },
      hintText: hintText,
      focusNote: focusNote,
      noteBox: noteBox,
      ensureNoteBox: ensureNoteBox,
      collapse: collapse,
      isCollapsed: isCollapsed,
      bounds: bounds
    };

    return api;
  }

  return {
    PANEL_CLASS: PANEL_CLASS,
    PANEL_ATTR: PANEL_ATTR,
    ROW_CLASS: ROW_CLASS,
    PANEL_WIDTH: PANEL_WIDTH,
    PANEL_STYLE: PANEL_STYLE,
    createActiveTab: createActiveTab
  };
});
