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
    "@media (prefers-color-scheme: dark) {",
    "  ." + PANEL_CLASS + ", ." + ROW_CLASS + ", .lahe-rail-pill { background: #1b1b1d; color: #f2f2f2; border-color: rgba(255,255,255,0.16); }",
    "  .lahe-rail-count, .lahe-rail-quote, .lahe-rail-rowfoot, .lahe-rail-hints, .lahe-rail-footlabel { color: rgba(242,242,242,0.6); }",
    "  .lahe-rail-keys { color: rgba(242,242,242,0.85); }",
    "}"
  ].join("\n");

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
    var providedHost = opts.host || null;

    var panel = null;
    var listEl = null;
    var emptyEl = null;
    var countEl = null;
    var footEl = null;
    var pill = null;
    var noteHandle = null;
    var collapsed = false;
    var mounted = false;
    var unsubscribe = null;
    // id -> row node. The reason there is no rebuild path.
    var rows = Object.create(null);

    function surfaceRoot() {
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

    // The note box at the foot of the thread: an open box tied to nothing
    // (R18). It is created once and replaced only when the reviewer finishes
    // the one that is there.
    function openNoteBox() {
      if (!footEl) return null;
      noteHandle = comments.openNote({ host: footEl, focus: false });
      // Keep the hint list last, under the box.
      footEl.appendChild(footEl.querySelector(".lahe-rail-hints"));
      return noteHandle;
    }

    function hintList() {
      var list = el("ul", "lahe-rail-hints");
      gestures.hintLines().forEach(function (line) {
        var li = el("li");
        li.appendChild(el("span", "lahe-rail-keys", line.keys));
        li.appendChild(el("span", "lahe-rail-hint", line.hint));
        list.appendChild(li);
      });
      return list;
    }

    function hintText() {
      if (!panel) {
        return gestures
          .hintLines()
          .map(function (line) {
            return line.keys + " " + line.hint;
          })
          .join("\n");
      }
      return panel.querySelector(".lahe-rail-hints").textContent;
    }

    function onItemChanged(item, event) {
      if (!mounted) return;
      if (event === "removed") {
        dropRow(item.id);
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
      if (!listEl) return handle();
      var items = comments.outstanding().filter(function (item) {
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
          listEl.insertBefore(rows[id], listEl.firstChild);
        }
        updateRow(rows[id], item);
      });

      Object.keys(rows).forEach(function (id) {
        if (!seen[id]) dropRow(id);
      });

      emptyEl.hidden = items.length > 0;
      if (emptyEl.parentNode !== listEl) listEl.appendChild(emptyEl);
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

      var quote = el("p", "lahe-rail-quote", "");
      row.appendChild(quote);

      var note = el("p", "lahe-rail-note", "");
      row.appendChild(note);

      var foot = el("div", "lahe-rail-rowfoot");
      foot.appendChild(el("span", "lahe-rail-state", ""));
      var reword = el("button", "lahe-rail-btn", "Reword");
      reword.setAttribute("type", "button");
      reword.addEventListener("click", function () {
        comments.reopen(id).focus();
      });
      var del = el("button", "lahe-rail-btn", "Delete");
      del.setAttribute("type", "button");
      del.addEventListener("click", function () {
        comments.remove(id);
      });
      foot.appendChild(reword);
      foot.appendChild(del);
      row.appendChild(foot);
      return row;
    }

    function updateRow(row, item) {
      var quote = row.querySelector(".lahe-rail-quote");
      var quoteText = item[record.FIELD.CONTEXT] ? item[record.FIELD.CONTEXT].quote : null;
      quote.textContent = quoteText || "";
      quote.hidden = !quoteText;

      var note = row.querySelector(".lahe-rail-note");
      var text = item[record.FIELD.NOTE];
      note.textContent = text ? text : "Empty draft";
      note.setAttribute("data-empty", text ? "false" : "true");

      var state = row.querySelector(".lahe-rail-state");
      state.textContent = stateLabel(item);
      row.setAttribute("data-state", item[record.FIELD.STATE]);
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

    function dropRow(id) {
      var row = rows[id];
      if (row && row.parentNode) row.parentNode.removeChild(row);
      delete rows[id];
      rail.removeCard(id);
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
      collapsed = next === undefined ? !collapsed : !!next;
      if (panel) panel.hidden = collapsed;
      if (pill) pill.hidden = !collapsed;
      return collapsed;
    }

    function isCollapsed() {
      return collapsed;
    }

    // What the rail occupies right now, in viewport coordinates, INCLUDING the
    // reach of its shadow. A box shadow paints outside the element's box, so a
    // caller told the border-box edge and asked "is the page identical outside
    // the rail" gets a wrong answer by 44 pixels. Ranked test 18 clips its
    // screenshot to everything left of this, which is the honest reading of
    // "identical outside the rail's bounds".
    function bounds() {
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
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      if (pill && pill.parentNode) pill.parentNode.removeChild(pill);
      panel = null;
      pill = null;
      listEl = null;
      footEl = null;
      countEl = null;
      emptyEl = null;
      noteHandle = null;
      rows = Object.create(null);
      mounted = false;
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
