// The document style switcher, page side: try an installed style on this page
// with no reload, keep the choice per page, and know when the agent has been
// asked to make it permanent.
//
// Owner: Style switcher 2.1. Design:
// docs/features/20260930.01_style_switcher/02_architecture_style_switcher.md
// (Boot, Applying a preview, Back to the document's style; and from Data /
// State Changes: the style id, What the document carries, The request to the
// agent, Waiting, The preview).
//
// What this file does NOT do: draw anything. The panel is overlay.js's, and the
// note to the agent is minted by comments.js. index.js wires the three. This
// file owns the rules they share (the id, the colours, the words, the marker,
// the waiting test) and the one piece of page work: a stylesheet link.
//
// ---------------------------------------------------------------------------
// How a preview works
// ---------------------------------------------------------------------------
//
// A page that uses the house style carries it one of two ways: a link to
// ./.lahe-doc-style.css (a page an agent wrote), or a <style data-lahe-doc-style>
// (rendered Markdown). A kept style is one more link, to
// ./.lahe-styles/<id>/style.css, after it. A preview disables every such link
// (a property, so the page's markup is not changed) and inserts ONE link of its
// own, chrome-marked so anchoring, replay and the handled check never see it,
// directly after the house style. The whole page restyles in one paint. Nothing
// in the body changes, which is why an open box, an edit in progress and a
// highlight all survive it.
//
// The choice is kept in browser storage under one key per page of a review, so
// the agent's rebuild (which reloads the page) does not throw it away.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.styleSwitch = factory(root.LAHE.markers, root.LAHE.record);
  } else {
    module.exports = factory(require("../shared/markers.js"), require("../shared/record.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (markers, record) {
  "use strict";

  // ---------------------------------------------------------------------------
  // The rules
  // ---------------------------------------------------------------------------

  // The free house style. Always there, needs nothing installed, and cannot be
  // installed over.
  var HOUSE_ID = "international";
  var HOUSE_NAME = "International Style";

  // Lowercase letters, digits and hyphens, starting with a letter or digit, at
  // most 40. Checked everywhere an id arrives from outside this library's own
  // code: a link in the page, the list the page server sends, a stored preview,
  // a note's words. A value that fails is no style at all.
  var ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

  // A colour reaches an inline style only after this check, so a list served
  // from anywhere cannot put CSS into the rail.
  var HEX_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

  // A name is written into the note to the agent, so it is letters, digits,
  // spaces, hyphens, apostrophes and ampersands only: nothing that can carry an
  // instruction (D12, page text is data). The service refuses anything else at
  // install; the layer checks again because the list could come from anywhere.
  var NAME_PATTERN = /^[\p{L}\p{N} '&-]{1,40}$/u;

  var PALETTE_MAX = 6;

  // International Style's strip, taken from the house tokens the way the
  // Mermaid theme in src/service/markdown.js is: one value per token, named.
  // vendor/stclair-doc-style/system-tokens.css.
  var HOUSE_PALETTE = [
    "#f7f7f5", // --paper
    "#1f1e1a", // --ink
    "#46188c", // --purple
    "#0760c7", // --cobalt
    "#8fb5a0", // --sage-fill
    "#8a5100" // --amber
  ];

  var HOUSE_SHEET_TAIL = /(?:^|\/)\.lahe-doc-style\.css(?:[?#].*)?$/;
  var HOUSE_ATTR = "data-lahe-doc-style";
  var STYLE_HREF_TAIL = /(?:^|\/)\.lahe-styles\/([^/?#]+)\/style\.css(?:[?#].*)?$/;
  var LIST_URL = "./.lahe-styles/index.json";
  // The preview link's own mark, beside the chrome mark, so the document's
  // links and ours are never confused.
  var PREVIEW_ATTR = "data-lahe-style-preview";
  var STORAGE_PREFIX = "lahe.style.v1:";
  // Only the marker is acted on: `lahe-style:` then an id. The id is re-checked
  // against ID_PATTERN by whoever reads it.
  var MARKER_PATTERN = /lahe-style:[ \t]*([a-z0-9][a-z0-9-]*)/;

  // ---------------------------------------------------------------------------
  // The words, one set, used everywhere (architecture, "The words")
  // ---------------------------------------------------------------------------

  var WORDS = {
    TITLE: "Document style",
    IN_DOCUMENT: "in the document",
    BACK: "Back to the document's style",
    CLOSE: "Close",
    ADD_COMMAND: "lahe style add <folder>",
    previewing: function (name, documentName) {
      return "Previewing " + name + ". The document uses " + documentName + ".";
    },
    collapsed: function (name) {
      return "Previewing " + name;
    },
    uses: function (documentName) {
      return "The document uses " + documentName + ".";
    },
    ask: function (name) {
      return "Ask the agent to use " + name;
    },
    waiting: function (name) {
      return "Sent to the agent. Waiting for it to add " + name + " to this page.";
    },
    removed: function (name) {
      return name + " is no longer installed. Back to the document's style.";
    }
  };

  function isStyleId(value) {
    return typeof value === "string" && ID_PATTERN.test(value);
  }

  function isHexColour(value) {
    return typeof value === "string" && HEX_PATTERN.test(value);
  }

  function isStyleName(value) {
    return typeof value === "string" && value.trim().length > 0 && NAME_PATTERN.test(value);
  }

  /**
   * The installed list, re-checked. An entry with a bad id or name is dropped;
   * a bad colour is dropped from its palette. The house id is never an
   * installed style. Sorted by name, International goes first on its own.
   *
   * @returns {Array<{id: string, name: string, description: string, palette: string[]}>}
   */
  function sanitizeList(json) {
    var list = json && Array.isArray(json.styles) ? json.styles : [];
    var seen = Object.create(null);
    var out = [];
    list.forEach(function (entry) {
      if (!entry || typeof entry !== "object") return;
      if (!isStyleId(entry.id) || entry.id === HOUSE_ID || seen[entry.id]) return;
      if (!isStyleName(entry.name)) return;
      seen[entry.id] = true;
      var palette = Array.isArray(entry.palette) ? entry.palette.filter(isHexColour).slice(0, PALETTE_MAX) : [];
      out.push({
        id: entry.id,
        name: entry.name,
        description: typeof entry.description === "string" ? entry.description.slice(0, 300) : "",
        palette: palette
      });
    });
    out.sort(function (a, b) {
      var byName = a.name.localeCompare(b.name);
      return byName !== 0 ? byName : a.id < b.id ? -1 : 1;
    });
    return out;
  }

  /** The note the agent gets, word for word, or null when the id or name fails. */
  function noteWords(id, name) {
    if (id === HOUSE_ID) return "Use the International Style for this page (lahe-style: international).";
    if (!isStyleId(id) || !isStyleName(name)) return null;
    return "Use the " + name + " style for this page (lahe-style: " + id + ").";
  }

  function markerIdOf(text) {
    if (typeof text !== "string") return null;
    var match = MARKER_PATTERN.exec(text);
    return match && isStyleId(match[1]) ? match[1] : null;
  }

  /**
   * Is a request for this style still on the agent's desk?
   *
   * The caller hands in this page's items (index.js's page-scoped store). Any
   * reply ends waiting, whatever it says; so does the reviewer rewording the
   * note or deleting it.
   */
  function isWaiting(items, id) {
    if (!Array.isArray(items) || !isStyleId(id)) return false;
    return items.some(function (item) {
      if (!item || item[record.FIELD.KIND] !== record.KIND.NOTE) return false;
      if (!record.isUnansweredReady(item)) return false;
      return markerIdOf(item[record.FIELD.NOTE]) === id;
    });
  }

  function storageKey(reviewId, pagePath) {
    return STORAGE_PREFIX + String(reviewId) + ":" + String(pagePath);
  }

  function styleIdFromHref(href) {
    if (typeof href !== "string") return null;
    var match = STYLE_HREF_TAIL.exec(href);
    return match && isStyleId(match[1]) ? match[1] : null;
  }

  function isHouseSheetHref(href) {
    return typeof href === "string" && HOUSE_SHEET_TAIL.test(href);
  }

  // ---------------------------------------------------------------------------
  // The panel's contents, as data
  // ---------------------------------------------------------------------------
  //
  // Pure, so every state's words are checked without a browser. overlay.js
  // draws exactly this and decides nothing.

  function noteText(parts) {
    return (parts || [])
      .map(function (part) {
        return part.text || part.code || part.kbd || "";
      })
      .join("");
  }

  /**
   * @param {{shown: string, documentId: string, list: Array, listLoaded: boolean,
   *          waiting?: boolean, removed?: {id: string, name: string}|null}} state
   * @returns {{status: string, collapsed: {text: string, action: string}|null,
   *            ask: string|null, back: boolean, rows: Array, notes: Array}}
   */
  function panelView(state) {
    var s = state || {};
    var list = Array.isArray(s.list) ? s.list : [];
    var byId = Object.create(null);
    list.forEach(function (entry) {
      byId[entry.id] = entry;
    });
    var documentId = isStyleId(s.documentId) ? s.documentId : HOUSE_ID;
    var shown = isStyleId(s.shown) ? s.shown : documentId;
    var previewing = shown !== documentId;

    function nameOf(id) {
      if (id === HOUSE_ID) return HOUSE_NAME;
      return byId[id] ? byId[id].name : id;
    }

    // A document asking for a style this machine does not have shows the house
    // style (the link 404s), so that is the row that is checked.
    var documentMissing = documentId !== HOUSE_ID && !!s.listLoaded && !byId[documentId];
    var checked = previewing ? shown : documentMissing ? HOUSE_ID : documentId;

    var rows = [{ id: HOUSE_ID, name: HOUSE_NAME, palette: HOUSE_PALETTE.slice(), description: "" }].concat(list);
    // Before the list has answered, the style on screen still gets a row to be
    // checked: the panel opens with focus on it.
    if (checked !== HOUSE_ID && !byId[checked]) {
      rows.push({ id: checked, name: nameOf(checked), palette: [], description: "" });
    }
    rows = rows.map(function (entry) {
      return {
        id: entry.id,
        name: entry.name,
        description: entry.description || "",
        palette: entry.palette || [],
        inDocument: entry.id === documentId,
        checked: entry.id === checked
      };
    });

    var waiting = previewing && s.waiting === true;
    var status;
    if (waiting) status = WORDS.waiting(nameOf(shown));
    else if (previewing) status = WORDS.previewing(nameOf(shown), nameOf(documentId));
    else status = WORDS.uses(nameOf(documentId));

    var notes = [];
    var removed = s.removed && isStyleId(s.removed.id) ? s.removed : null;
    var removedText = removed ? WORDS.removed(isStyleName(removed.name) ? removed.name : nameOf(removed.id)) : null;
    if (removedText) notes.push([{ text: removedText }]);
    if (documentMissing && !previewing) {
      notes.push([
        { text: "This document asks for " },
        { code: documentId },
        { text: ", which is not installed here. Showing " + HOUSE_NAME + "." }
      ]);
    }
    if (s.listLoaded && list.length === 0) {
      notes.push([{ text: "Add styles with " }, { kbd: WORDS.ADD_COMMAND }, { text: ", or ask your agent to." }]);
    }

    var collapsed = null;
    if (previewing) collapsed = { text: waiting ? status : WORDS.collapsed(nameOf(shown)), action: "back" };
    else if (removedText) collapsed = { text: removedText, action: "dismiss" };

    return {
      status: status,
      collapsed: collapsed,
      ask: previewing && !waiting ? WORDS.ask(nameOf(shown)) : null,
      askId: previewing && !waiting ? shown : null,
      back: previewing,
      rows: rows,
      notes: notes
    };
  }

  // ---------------------------------------------------------------------------
  // The page work
  // ---------------------------------------------------------------------------

  /**
   * @param {Object} options
   *   document, window    the page
   *   reviewId            for the storage key
   *   pagePath()          the page's path, read at call time (an SPA moves it)
   *   storage             browser storage; window.localStorage by default
   *   blocks()            the page's leaf blocks as [{el}], for the reading
   *                       position (index.js hands sync.blockCandidates)
   *   onSettled(info)     a switch has landed: re-place boxes, re-read the
   *                       rail's scheme, repaint the panel
   *   onChange(info)      anything the panel shows changed
   */
  function createStyleSwitch(options) {
    var opts = options || {};
    var doc = opts.document || null;
    var win = opts.window || (doc && doc.defaultView) || null;
    var reviewId = opts.reviewId || null;
    var pagePath =
      typeof opts.pagePath === "function"
        ? opts.pagePath
        : function () {
            return win && win.location ? win.location.pathname : "";
          };

    // The latest pick. Every switch takes a number; a load that finishes under
    // an older number is dropped, so holding an arrow key ends on the last
    // style it passed and nothing in between repaints over it.
    var seq = 0;
    var previewId = null;
    var previewLink = null;
    var removed = null;
    var listeners = { settled: [], change: [] };
    if (typeof opts.onSettled === "function") listeners.settled.push(opts.onSettled);
    if (typeof opts.onChange === "function") listeners.change.push(opts.onChange);

    function tell(kind, info) {
      listeners[kind].forEach(function (fn) {
        try {
          fn(info || {});
        } catch (err) {
          // One listener failing is not the switch failing.
        }
      });
    }

    function storage() {
      try {
        return opts.storage || (win && win.localStorage) || null;
      } catch (err) {
        return null;
      }
    }

    function key() {
      return storageKey(reviewId, pagePath());
    }

    function readKey() {
      var s = storage();
      if (!s || !reviewId) return null;
      try {
        var value = s.getItem(key());
        return isStyleId(value) ? value : value === null ? null : "";
      } catch (err) {
        return null;
      }
    }

    function writeKey(id) {
      var s = storage();
      if (!s || !reviewId) return false;
      try {
        s.setItem(key(), id);
        return true;
      } catch (err) {
        return false;
      }
    }

    function clearKey() {
      var s = storage();
      if (!s || !reviewId) return false;
      try {
        s.removeItem(key());
        return true;
      } catch (err) {
        return false;
      }
    }

    function stylesheetLinks() {
      if (!doc || typeof doc.querySelectorAll !== "function") return [];
      return Array.prototype.slice.call(doc.querySelectorAll("link[rel~='stylesheet' i]"));
    }

    function isPreviewLink(el) {
      return !!el && typeof el.hasAttribute === "function" && el.hasAttribute(PREVIEW_ATTR);
    }

    /** The house style element, or null: this page does not use it (R1). */
    function houseElement() {
      if (!doc || typeof doc.querySelector !== "function") return null;
      var inlined = doc.querySelector("style[" + HOUSE_ATTR + "]");
      var links = stylesheetLinks().filter(function (link) {
        return !isPreviewLink(link) && isHouseSheetHref(link.getAttribute("href"));
      });
      var linked = links.length ? links[links.length - 1] : null;
      if (inlined && linked) {
        // Whichever comes later in the document, so a preview lands after both.
        var follows = inlined.compareDocumentPosition(linked) & 4; // DOCUMENT_POSITION_FOLLOWING
        return follows ? linked : inlined;
      }
      return linked || inlined || null;
    }

    function usesHouseStyle() {
      return !!houseElement();
    }

    function documentLinks() {
      return stylesheetLinks().filter(function (link) {
        return !isPreviewLink(link) && styleIdFromHref(link.getAttribute("href")) !== null;
      });
    }

    /** The document's own style: the last style link, else the house style. */
    function documentStyle() {
      var links = documentLinks();
      if (!links.length) return HOUSE_ID;
      return styleIdFromHref(links[links.length - 1].getAttribute("href")) || HOUSE_ID;
    }

    function shown() {
      return previewId || documentStyle();
    }

    // --- the reading position ------------------------------------------------
    //
    // The same idea sync.js uses across a reload: the topmost block the reader
    // can see and how far below the top of the window it sits. Across a switch
    // the block is the very same node (nothing in the body changes), so the
    // node itself is kept rather than its text.

    function candidates() {
      if (typeof opts.blocks === "function") {
        try {
          return (opts.blocks() || []).map(function (entry) {
            return entry && entry.el ? entry.el : entry;
          });
        } catch (err) {
          return [];
        }
      }
      if (!doc || !doc.body) return [];
      return Array.prototype.slice
        .call(doc.body.querySelectorAll("p,li,h1,h2,h3,h4,h5,h6,pre,blockquote,td,th,figcaption,dt,dd"))
        .filter(function (el) {
          return !markers.isInsideOverlay(el);
        });
    }

    function capturePosition() {
      if (!win || typeof win.innerHeight !== "number") return null;
      var blocks = candidates();
      for (var i = 0; i < blocks.length; i += 1) {
        var el = blocks[i];
        if (!el || typeof el.getBoundingClientRect !== "function") continue;
        var rect = el.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) continue;
        if (rect.bottom <= 0 || rect.top >= win.innerHeight) continue;
        return { el: el, offset: rect.top };
      }
      return null;
    }

    function restorePosition(position) {
      if (!position || !position.el || !position.el.isConnected || !win || typeof win.scrollTo !== "function") return false;
      var rect = position.el.getBoundingClientRect();
      var delta = rect.top - position.offset;
      if (!Number.isFinite(delta) || Math.abs(delta) < 1) return true;
      win.scrollTo({ left: win.scrollX, top: Math.max(0, Math.round(win.scrollY + delta)), behavior: "instant" });
      return true;
    }

    // --- switching -----------------------------------------------------------

    function removePreviewLink() {
      if (previewLink && previewLink.parentNode) previewLink.parentNode.removeChild(previewLink);
      previewLink = null;
    }

    function setDocumentLinksDisabled(disabled) {
      documentLinks().forEach(function (link) {
        link.disabled = disabled;
      });
    }

    function fontsReady() {
      var fonts = doc && doc.fonts;
      if (fonts && fonts.ready && typeof fonts.ready.then === "function") {
        return fonts.ready.then(
          function () {},
          function () {}
        );
      }
      return Promise.resolve();
    }

    // The link has loaded (or there was none to load). Once its fonts have too,
    // put the reader back where they were and tell whoever re-places things.
    function settle(mine, position) {
      return fontsReady().then(function () {
        if (mine !== seq) return { ok: false, superseded: true };
        restorePosition(position);
        var info = { shown: shown(), documentId: documentStyle(), previewing: !!previewId };
        tell("settled", info);
        tell("change", info);
        return Object.assign({ ok: true }, info);
      });
    }

    /**
     * Show the page in this style. No reload, nothing sent.
     *
     * @param {string} id
     * @param {{keepPosition?: boolean}} [how]  false on boot: sync.js restores
     *   the reading position across the reload itself
     * @returns {Promise<{ok: boolean}>}
     */
    function preview(id, how) {
      var h = how || {};
      if (!usesHouseStyle() || !isStyleId(id)) return Promise.resolve({ ok: false, reason: "not-available" });
      if (id === documentStyle()) return back();
      var position = h.keepPosition === false ? null : capturePosition();
      seq += 1;
      var mine = seq;
      removed = null;
      removePreviewLink();
      setDocumentLinksDisabled(true);
      previewId = id;
      writeKey(id);
      if (id === HOUSE_ID) {
        tell("change", { shown: id, pending: true });
        return settle(mine, position);
      }
      var house = houseElement();
      var link = doc.createElement("link");
      markers.markChrome(link);
      link.setAttribute(PREVIEW_ATTR, id);
      link.rel = "stylesheet";
      link.href = "./.lahe-styles/" + id + "/style.css";
      previewLink = link;
      var done = new Promise(function (resolve) {
        link.addEventListener("load", function () {
          resolve(settle(mine, position));
        });
        link.addEventListener("error", function () {
          resolve(failed(mine, id, position));
        });
      });
      house.parentNode.insertBefore(link, house.nextSibling);
      tell("change", { shown: id, pending: true });
      return done;
    }

    // The style's stylesheet did not load: it was removed, or this page is not
    // served by a Lahe page server at all. The preview clears itself and the
    // panel says why.
    function failed(mine, id, position) {
      if (mine !== seq) return Promise.resolve({ ok: false, superseded: true });
      removed = { id: id, name: typeof opts.nameOf === "function" ? opts.nameOf(id) : null };
      return clear(position).then(function (result) {
        return Object.assign({}, result, { ok: false, removed: id });
      });
    }

    function clear(position) {
      seq += 1;
      var mine = seq;
      removePreviewLink();
      setDocumentLinksDisabled(false);
      previewId = null;
      clearKey();
      return settle(mine, position);
    }

    /** Back to the document's own style. */
    function back() {
      removed = null;
      return clear(capturePosition());
    }

    /**
     * On boot, before sync.js restores the reading position: put a kept
     * preview back, or drop it when the document now carries that style (the
     * agent applied it).
     *
     * @returns {{restored: string|null, cleared: boolean}}
     */
    function restore() {
      if (!usesHouseStyle()) return { restored: null, cleared: false };
      var stored = readKey();
      if (stored === null) return { restored: null, cleared: false };
      if (!stored || stored === documentStyle()) {
        clearKey();
        return { restored: null, cleared: true };
      }
      var landed = preview(stored, { keepPosition: false });
      return { restored: stored, cleared: false, landed: landed };
    }

    function dismissRemoved() {
      removed = null;
      tell("change", { shown: shown() });
    }

    /**
     * The installed list, re-checked. A page not served by a Lahe page server
     * (a dev server, file://) answers nothing, which is the same as nothing
     * installed.
     */
    function fetchList() {
      if (!win || typeof win.fetch !== "function") return Promise.resolve({ ok: false, styles: [] });
      var url;
      try {
        url = new win.URL(LIST_URL, doc.baseURI).href;
      } catch (err) {
        return Promise.resolve({ ok: false, styles: [] });
      }
      return win
        .fetch(url, { cache: "no-store", credentials: "same-origin" })
        .then(function (response) {
          if (!response || !response.ok) return { ok: false, styles: [] };
          return response.json().then(
            function (json) {
              return { ok: true, styles: sanitizeList(json) };
            },
            function () {
              return { ok: false, styles: [] };
            }
          );
        })
        .catch(function () {
          return { ok: false, styles: [] };
        });
    }

    function info() {
      return {
        usesHouseStyle: usesHouseStyle(),
        documentId: documentStyle(),
        shown: shown(),
        previewing: !!previewId,
        previewId: previewId,
        stored: readKey(),
        removed: removed,
        previewLinks: stylesheetLinks().filter(isPreviewLink).length,
        disabledDocumentLinks: documentLinks().filter(function (link) {
          return link.disabled;
        }).length,
        key: reviewId ? key() : null
      };
    }

    return {
      usesHouseStyle: usesHouseStyle,
      documentStyle: documentStyle,
      shown: shown,
      isPreviewing: function () {
        return !!previewId;
      },
      removed: function () {
        return removed;
      },
      preview: preview,
      back: back,
      restore: restore,
      dismissRemoved: dismissRemoved,
      fetchList: fetchList,
      onSettled: function (fn) {
        listeners.settled.push(fn);
      },
      onChange: function (fn) {
        listeners.change.push(fn);
      },
      info: info
    };
  }

  return {
    HOUSE_ID: HOUSE_ID,
    HOUSE_NAME: HOUSE_NAME,
    HOUSE_PALETTE: HOUSE_PALETTE,
    PALETTE_MAX: PALETTE_MAX,
    PREVIEW_ATTR: PREVIEW_ATTR,
    STORAGE_PREFIX: STORAGE_PREFIX,
    LIST_URL: LIST_URL,
    WORDS: WORDS,
    isStyleId: isStyleId,
    isHexColour: isHexColour,
    isStyleName: isStyleName,
    sanitizeList: sanitizeList,
    noteWords: noteWords,
    markerIdOf: markerIdOf,
    isWaiting: isWaiting,
    storageKey: storageKey,
    styleIdFromHref: styleIdFromHref,
    isHouseSheetHref: isHouseSheetHref,
    noteText: noteText,
    panelView: panelView,
    createStyleSwitch: createStyleSwitch
  };
});
