// The Edits tab's contents: every hand edit as a before-and-after row.
//
// Owner: 3D. The rail CHROME (the tab shell, the panes, the status line, the
// card API) is 1B's, in overlay.js, and nothing here edits that file. This file
// is only what the Edits tab holds.
//
// Implements D10's Edits tab: R32 (hand edits are kept apart from the comment
// thread so neither buries the other) and R39 (the end-of-session list of hand
// edits, worth feeding a style guide).
//
// ---------------------------------------------------------------------------
// Why a hand edit is not a comment
// ---------------------------------------------------------------------------
//
// A session produces a handful of comments and a great many small hand edits.
// Mixed into one list, the edits bury the comments, and the reviewer stops
// reading either. The rail already routes a record by kind (overlay's
// paneForItem sends edit, delete and format_only to this tab), so the
// separation is the rail's law and this file never has to re-decide it. What
// this file owns is what a row SAYS.
//
// Three kinds, three readings, because a row that renders all three the same
// way is wrong twice:
//
//   edit         before struck through, after in the reviewer's words
//   delete       before struck through, and the row says it was deleted, not
//                that it was edited into nothing (R27)
//   format_only  the words are unchanged, so showing before and after would
//                show the same sentence twice. The row shows the words once and
//                names what changed in the markup (R31)
//
// ---------------------------------------------------------------------------
// The law inherited from the rail: THE LIST UPDATES IN PLACE
// ---------------------------------------------------------------------------
//
// There is no render(items) here. Rows are created once, updated where they
// are, and removed only when their record is gone. Newest first is done with
// flex `order` on the card the rail already built, never by re-appending:
// re-parenting a node blurs anything focused inside it, which is the exact
// revert mechanism the rail's law exists to stop.
//
// ---------------------------------------------------------------------------
// The export seam
// ---------------------------------------------------------------------------
//
// This tab does not format anything for export. The list-export button calls
// 3C's `exportRecords(records, options)` in src/layer/export.js, which renders
// through the frozen human-readable formatter in shared/review_format.js. One
// formatter, one wording, wherever the same records are read.
//
// The module is resolved LAZILY, on mount and on click, for a mechanical
// reason: export.js loads AFTER this file in the bundle (manifest.js pins the
// order), so a reference captured when this factory runs would always be
// undefined. When the module is absent the button renders disabled and says why
// rather than throwing on click or, worse, doing nothing.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.tabEdits = factory(
      root,
      root.LAHE.markers,
      root.LAHE.record,
      root.LAHE.normalize,
      root.LAHE.overlay
    );
  } else {
    module.exports = factory(
      typeof globalThis !== "undefined" ? globalThis : this,
      require("../shared/markers.js"),
      require("../shared/record.js"),
      require("../shared/normalize.js"),
      require("./overlay.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, markers, record, normalize, overlayModule) {
  "use strict";

  // The marker a row carries. It is how a test asks "is an edit row in the
  // Active pane", which is the honest reading of "kept apart": counting cards
  // would only prove the rail's routing, not what this file drew.
  var ROW_ATTR = "data-lahe-edit-row";
  var ROW_CLASS = "lahe-edits";
  var BAR_CLASS = "lahe-edits-bar";
  // The bar sits above every row. Cards are ordered negatively (newest first,
  // never more negative than the row count), so one number well below that keeps
  // the bar first without re-appending it. This is the end-of-session list, and
  // the way to take it elsewhere should not be six rows down a scroll.
  var BAR_ORDER = -100000;

  var DELETED_TEXT = "Deleted";
  var EXPORT_LABEL = "Export the edit list";
  var EXPORT_MISSING_TITLE =
    "Export is arriving with the copy-and-export module; the list export wires up at the Phase 3 stitch.";
  var EXPORT_TITLE = "The hand edits on this page, as text, for a style guide or a chat window.";

  // Quiet neutrals, one accent, and the rail's own tokens: this pane is inside
  // the rail's closed shadow root, so :host's custom properties inherit into it
  // and the tab cannot drift from the chrome around it.
  var STYLE = [
    "." + ROW_CLASS + "{display:flex;flex-direction:column;gap:6px}",
    "." + ROW_CLASS + "__pair{display:flex;flex-direction:column;gap:4px;",
    "border-left:2px solid var(--line);padding-left:9px}",
    "." + ROW_CLASS + "[data-kind='edit'] ." + ROW_CLASS + "__pair{border-left-color:var(--accent)}",
    "." + ROW_CLASS + "__before,." + ROW_CLASS + "__after{font-size:12.5px;line-height:1.45;",
    "display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}",
    "." + ROW_CLASS + "__before{color:var(--ink-faint);text-decoration:line-through;",
    "text-decoration-thickness:1px}",
    "." + ROW_CLASS + "__after{color:var(--ink)}",
    // A deletion has no after text, so the line that would hold it says what
    // happened instead, in the tab's quiet register rather than in red.
    "." + ROW_CLASS + "__after[data-empty='true']{color:var(--ink-soft);font-style:italic}",
    // Formatting-only: the words ONCE, plainly, because they did not change.
    // Both lines exist in the DOM so the row's shape is the same for every kind;
    // the second one is not drawn, because printing the same sentence twice is
    // how a reviewer learns to skip the row.
    "." + ROW_CLASS + "[data-kind='format_only'] ." + ROW_CLASS + "__before{",
    "text-decoration:none;color:var(--ink)}",
    "." + ROW_CLASS + "[data-kind='format_only'] ." + ROW_CLASS + "__after{display:none}",
    "." + ROW_CLASS + "__structure{font-size:11.5px;color:var(--ink-soft);",
    "font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
    "." + ROW_CLASS + "__structure:empty{display:none}",
    "." + ROW_CLASS + "__said{font-size:12px;color:var(--ink-soft)}",
    "." + ROW_CLASS + "__said:empty{display:none}",

    "." + BAR_CLASS + "{display:flex;align-items:center;gap:8px;padding:0 2px 10px;",
    "border-bottom:1px solid var(--line-soft)}",
    "." + BAR_CLASS + "__count{font-size:11.5px;color:var(--ink-faint);",
    "font-variant-numeric:tabular-nums}",
    "." + BAR_CLASS + "__btn{margin-left:auto;font-size:12px;font-weight:550;padding:6px 10px;",
    "border-radius:8px;border:1px solid var(--line);background:var(--paper);color:var(--ink)}",
    "." + BAR_CLASS + "__btn:hover:not(:disabled){background:var(--surface)}",
    "." + BAR_CLASS + "__btn:disabled{color:var(--ink-faint);cursor:default}"
  ].join("");

  // The three kinds this tab holds. Asked in one place so a fourth kind added
  // later cannot half-appear.
  function isHandEdit(item) {
    var kind = item[record.FIELD.KIND];
    return kind === record.KIND.EDIT || kind === record.KIND.DELETE || kind === record.KIND.FORMAT_ONLY;
  }

  // ---------------------------------------------------------------------------
  // What a formatting-only row says
  // ---------------------------------------------------------------------------
  //
  // Pure, and exported, so it is unit-testable without a browser. It reads the
  // STRUCTURAL view of both sides (shared/normalize.js's one structural mode),
  // so what it names is exactly what the comparison the record was classified by
  // can see. A summary computed off raw innerHTML would name a wrapper the
  // comparison ignores.

  function tagCounts(html) {
    var counts = Object.create(null);
    var reduced = normalize.structureOf(String(html || ""));
    var re = /<([a-z0-9]+)>/g;
    var found = re.exec(reduced);
    while (found) {
      counts[found[1]] = (counts[found[1]] || 0) + 1;
      found = re.exec(reduced);
    }
    return counts;
  }

  function structuralSummary(beforeHtml, afterHtml) {
    var before = tagCounts(beforeHtml);
    var after = tagCounts(afterHtml);
    var names = {};
    Object.keys(before).forEach(function (n) {
      names[n] = true;
    });
    Object.keys(after).forEach(function (n) {
      names[n] = true;
    });
    var added = [];
    var removed = [];
    Object.keys(names)
      .sort()
      .forEach(function (name) {
        var delta = (after[name] || 0) - (before[name] || 0);
        if (delta > 0) added.push("<" + name + ">" + (delta > 1 ? " x" + delta : ""));
        if (delta < 0) removed.push("<" + name + ">" + (delta < -1 ? " x" + -delta : ""));
      });
    var parts = [];
    if (added.length) parts.push("added " + added.join(" "));
    if (removed.length) parts.push("removed " + removed.join(" "));
    // Same tags, different arrangement. Saying "the markup changed" is the
    // honest answer; naming a tag that did not change would not be.
    if (!parts.length) return "the markup changed";
    return parts.join(", ");
  }

  // What the row shows for each side, per kind. Pure, and the one place the
  // three readings are decided.
  function rowText(item) {
    var kind = item[record.FIELD.KIND];
    var before = item[record.FIELD.BEFORE];
    var after = item[record.FIELD.AFTER];
    if (kind === record.KIND.DELETE) {
      return { before: typeof before === "string" ? before : "", after: DELETED_TEXT, emptyAfter: true, structure: "" };
    }
    if (kind === record.KIND.FORMAT_ONLY) {
      return {
        before: typeof after === "string" ? after : typeof before === "string" ? before : "",
        after: typeof after === "string" ? after : typeof before === "string" ? before : "",
        emptyAfter: false,
        structure: structuralSummary(item[record.FIELD.BEFORE_HTML], item[record.FIELD.AFTER_HTML])
      };
    }
    return {
      before: typeof before === "string" ? before : "",
      after: typeof after === "string" ? after : "",
      emptyAfter: typeof after !== "string" || after === "",
      structure: ""
    };
  }

  // ---------------------------------------------------------------------------
  // The tab
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} options
   * @param {Object} options.store      1B's store; the records are read from it
   * @param {string} options.reviewId
   * @param {Object} [options.overlay]  the rail; the shared one otherwise
   * @param {Element} [options.host]    the rail's Edits pane
   * @param {Object} [options.editing]  2A's surface. When given, the tab
   *   subscribes to its changes itself, so the boot wiring stays one call
   * @param {Object} [options.exportModule]  3C's module, for a test that wants
   *   to hand one in. Resolved off the namespace otherwise
   */
  function createEditsTab(options) {
    var opts = options || {};
    var store = opts.store || null;
    if (!store) throw new TypeError("createEditsTab: a store is required");
    var reviewId = opts.reviewId || null;
    if (!reviewId) throw new TypeError("createEditsTab: a reviewId is required");
    var doc = Object.prototype.hasOwnProperty.call(opts, "document")
      ? opts.document
      : typeof document !== "undefined"
      ? document
      : null;
    var rail = opts.overlay || overlayModule.shared;
    var host = opts.host || null;
    var editing = opts.editing || null;

    var mounted = false;
    var unsubscribe = null;
    // id -> row node. The reason there is no rebuild path.
    var rows = Object.create(null);
    var barNode = null;
    var countNode = null;
    var buttonNode = null;
    var lastExport = null;

    function el(tag, className, text) {
      var node = doc.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== null) node.textContent = text;
      markers.markChrome(node);
      return node;
    }

    // The records this tab is about, oldest first. Sorted by when they were
    // made rather than by store order, because the store's order is write
    // order and a rewording rewrites in place.
    function handEdits() {
      return store
        .read(reviewId)
        .filter(isHandEdit)
        .map(function (item, index) {
          return { item: item, index: index };
        })
        .sort(function (a, b) {
          var at = String(a.item[record.FIELD.CREATED_AT] || "");
          var bt = String(b.item[record.FIELD.CREATED_AT] || "");
          if (at !== bt) return at < bt ? -1 : 1;
          return a.index - b.index;
        })
        .map(function (row) {
          return row.item;
        });
    }

    // 3C's module, resolved every time it is asked. See the header: this file
    // loads before export.js, so there is nothing to capture at factory time.
    function exportModule() {
      if (opts.exportModule) return opts.exportModule;
      var ns = root && root.LAHE ? root.LAHE : null;
      if (ns && ns.export && typeof ns.export.exportRecords === "function") return ns.export;
      return null;
    }

    // -------------------------------------------------------------------------
    // Mount
    // -------------------------------------------------------------------------

    function mount() {
      if (mounted) return api;
      mounted = true;
      if (!doc || !host) return api;
      addStyle();
      buildBar();
      if (editing && typeof editing.onChange === "function") {
        unsubscribe = editing.onChange(function () {
          refresh();
        });
      }
      refresh();
      return api;
    }

    // One stylesheet, inside the pane. A <style> element anywhere in a shadow
    // tree applies to the whole tree, so this reaches the rows without this file
    // touching the rail's own CSS or adding anything to the page.
    function addStyle() {
      if (host.querySelector("style[data-lahe-edits-style]")) return;
      var style = doc.createElement("style");
      style.setAttribute("data-lahe-edits-style", "");
      markers.markChrome(style);
      style.textContent = STYLE;
      host.insertBefore(style, host.firstChild);
    }

    function buildBar() {
      if (barNode) return barNode;
      barNode = el("div", BAR_CLASS);
      barNode.style.order = String(BAR_ORDER);
      countNode = el("span", BAR_CLASS + "__count", "");
      barNode.appendChild(countNode);

      buttonNode = el("button", BAR_CLASS + "__btn", EXPORT_LABEL);
      buttonNode.setAttribute("type", "button");
      buttonNode.addEventListener("click", function () {
        exportList();
      });
      barNode.appendChild(buttonNode);
      host.appendChild(barNode);
      paintBar(0);
      return barNode;
    }

    // -------------------------------------------------------------------------
    // The list, in place
    // -------------------------------------------------------------------------

    function refresh() {
      if (!mounted || !doc || !host) return api;
      var items = handEdits();
      var seen = Object.create(null);

      items.forEach(function (item, index) {
        var id = item[record.FIELD.ID];
        seen[id] = true;
        // The rail's own model has to know the card exists before anything can
        // be put inside it. Upserting a card that exists MUTATES it.
        rail.upsertCard(item);
        if (!rows[id]) {
          rows[id] = buildRow(item);
          rail.attachCardNode(id, rows[id]);
        } else if (rows[id].parentNode === null) {
          // A remount rebuilt the card. attachCardNode is idempotent and puts
          // the same node back rather than making a second one.
          rail.attachCardNode(id, rows[id]);
        }
        updateRow(rows[id], item);
        // Newest first, without moving a node: the pane is a flex column, and
        // the newest record gets the most negative order.
        var card = rail.cardNode(id);
        if (card && card.style) card.style.order = String(index - items.length);
      });

      Object.keys(rows).forEach(function (id) {
        if (!seen[id]) dropRow(id);
      });

      paintBar(items.length);
      return api;
    }

    function buildRow(item) {
      var row = el("div", ROW_CLASS);
      row.setAttribute(ROW_ATTR, item[record.FIELD.ID]);
      row.setAttribute("data-kind", item[record.FIELD.KIND]);

      var pair = el("div", ROW_CLASS + "__pair");
      pair.appendChild(el("p", ROW_CLASS + "__before", ""));
      pair.appendChild(el("p", ROW_CLASS + "__after", ""));
      row.appendChild(pair);

      row.appendChild(el("p", ROW_CLASS + "__structure", ""));
      // The reviewer's own words about the change, when they wrote any. It is
      // the only intent field a hand edit carries, and a style guide is built
      // out of exactly this.
      row.appendChild(el("p", ROW_CLASS + "__said", ""));
      return row;
    }

    function updateRow(row, item) {
      var text = rowText(item);
      row.setAttribute("data-kind", item[record.FIELD.KIND]);
      var before = row.querySelector("." + ROW_CLASS + "__before");
      var after = row.querySelector("." + ROW_CLASS + "__after");
      before.textContent = text.before;
      after.textContent = text.after;
      after.setAttribute("data-empty", text.emptyAfter ? "true" : "false");
      row.querySelector("." + ROW_CLASS + "__structure").textContent = text.structure;
      row.querySelector("." + ROW_CLASS + "__said").textContent = item[record.FIELD.CHANGE] || "";
      return row;
    }

    function dropRow(id) {
      var row = rows[id];
      if (row && row.parentNode) row.parentNode.removeChild(row);
      delete rows[id];
    }

    function paintBar(count) {
      if (!countNode || !buttonNode) return;
      countNode.textContent = count === 1 ? "1 hand edit" : count + " hand edits";
      var available = !!exportModule();
      buttonNode.disabled = !available || count === 0;
      buttonNode.title = available ? EXPORT_TITLE : EXPORT_MISSING_TITLE;
    }

    // -------------------------------------------------------------------------
    // Export
    // -------------------------------------------------------------------------

    /**
     * Hand the list to 3C's export path, newest first, so what a reader sees is
     * what the text says.
     *
     * It returns the text rather than delivering it: the clipboard grant and the
     * download are copyReview() and exportReview(), which are 3C's, and the
     * delivery is wired at the Phase 3 stitch.
     */
    function exportList() {
      var mod = exportModule();
      var items = handEdits().reverse();
      if (!mod) {
        lastExport = { ok: false, reason: EXPORT_MISSING_TITLE, text: null, count: items.length };
        return lastExport;
      }
      var text = mod.exportRecords(items, { review: reviewId, scope: "edits" });
      lastExport = { ok: true, reason: null, text: text, count: items.length };
      return lastExport;
    }

    function unmount() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
      Object.keys(rows).forEach(function (id) {
        dropRow(id);
      });
      if (barNode && barNode.parentNode) barNode.parentNode.removeChild(barNode);
      barNode = null;
      countNode = null;
      buttonNode = null;
      mounted = false;
    }

    var api = {
      ROW_ATTR: ROW_ATTR,
      ROW_CLASS: ROW_CLASS,
      mount: mount,
      unmount: unmount,
      isMounted: function () {
        return mounted;
      },
      refresh: refresh,
      rowCount: function () {
        return Object.keys(rows).length;
      },
      // The list as data, newest first: what the tab is showing, without a
      // caller reaching into a closed shadow root to read it.
      rows: function () {
        return handEdits()
          .reverse()
          .map(function (item) {
            var text = rowText(item);
            return {
              id: item[record.FIELD.ID],
              kind: item[record.FIELD.KIND],
              before: text.before,
              after: text.after,
              structure: text.structure,
              said: item[record.FIELD.CHANGE] || null
            };
          });
      },
      exportList: exportList,
      exportButton: function () {
        return buttonNode;
      },
      exportEnabled: function () {
        return !!buttonNode && !buttonNode.disabled;
      },
      exportTitle: function () {
        return buttonNode ? buttonNode.title : null;
      },
      lastExport: function () {
        return lastExport;
      }
    };

    return api;
  }

  return {
    ROW_ATTR: ROW_ATTR,
    ROW_CLASS: ROW_CLASS,
    BAR_CLASS: BAR_CLASS,
    STYLE: STYLE,
    DELETED_TEXT: DELETED_TEXT,
    EXPORT_LABEL: EXPORT_LABEL,
    EXPORT_MISSING_TITLE: EXPORT_MISSING_TITLE,
    isHandEdit: isHandEdit,
    structuralSummary: structuralSummary,
    rowText: rowText,
    createEditsTab: createEditsTab
  };
});
