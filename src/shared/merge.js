// The merge rule: what happens when browser storage and the helper's store
// disagree about one item.
//
// Owner: 0A-kernel. Imported by: the store (1B) on every load and reconnect,
// the helper's projection (3A), and reply folding (3A).
//
// This is D5's rule, as code rather than as prose, because two builders who
// each invent half of it produce a tool where an agent's stale "handled"
// retires a comment the reviewer just reworded. Stated once:
//
//   THE BROWSER WINS ON CONTENT for anything the helper has not acknowledged.
//   THE STORE WINS ON LIFECYCLE, PER REVISION.
//
// The per-revision half is the whole point. A "handled" that names rev 1
// retires rev 1. A reviewer who reworded to rev 2 while the helper was down
// still has rev 2 outstanding after the merge: the reply named a revision that
// no longer exists, so it cannot retire anything.
//
// The case this exists to protect, drawn out:
//
//   1. the reviewer marks a comment ready               (rev 1, ready)
//   2. an agent replies handled, naming rev 1           (store: rev 1 handled)
//   3. the helper goes down
//   4. the reviewer rewords the comment                 (browser: rev 2, ready)
//   5. the helper comes back and the page reloads
//   -> the merged item is rev 2, READY, with the reviewer's new words.
//      The rewording is not swallowed.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.merge = factory(root.LAHE.record);
  } else {
    module.exports = factory(require("./record.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (record) {
  "use strict";

  var FIELD = record.FIELD;

  // The fields the browser owns while its work is unacknowledged. These are
  // the reviewer's typing and the region it is tied to: everything that only
  // the browser can know, because it is the only place the reviewer typed it.
  var CONTENT_FIELDS = [
    FIELD.KIND,
    FIELD.NOTE,
    FIELD.CHANGE,
    FIELD.BEFORE,
    FIELD.AFTER,
    FIELD.BEFORE_HTML,
    FIELD.AFTER_HTML,
    FIELD.AFTER_HISTORY,
    FIELD.REGION,
    FIELD.CONTEXT,
    FIELD.PAGE_ORIGIN,
    FIELD.PAGE_PATH,
    FIELD.PAGE_TITLE,
    FIELD.PAGE_SEQ,
    FIELD.SOURCE_HINT,
    FIELD.THREAD,
    FIELD.UPDATED_AT
  ];

  // The reasons a merge decided what it decided. Returned on the result so a
  // failing test says which half of the rule broke, and so the rail can say
  // something true about it.
  var REASON = {
    ONLY_BROWSER: "only_browser",
    ONLY_STORE: "only_store",
    BROWSER_NEWER_REV: "browser_newer_rev",
    STORE_NEWER_REV: "store_newer_rev",
    SAME_REV_ACKED: "same_rev_acknowledged",
    SAME_REV_UNACKED: "same_rev_unacknowledged"
  };

  function isAcknowledged(browserItem) {
    // The library marks an item acknowledged when the helper has confirmed the
    // event carrying THIS revision. 1B sets it; the merge rule reads it.
    return !!(browserItem && browserItem.acknowledged === true);
  }

  function copyContent(from, onto) {
    var out = Object.assign({}, onto);
    for (var i = 0; i < CONTENT_FIELDS.length; i += 1) {
      out[CONTENT_FIELDS[i]] = from[CONTENT_FIELDS[i]];
    }
    return out;
  }

  /**
   * Merges one item's browser state and store state into the item the reviewer
   * sees and the agent reads.
   *
   * Either side may be null: an item made offline exists only in the browser,
   * and an item made in another window of the same review exists only in the
   * store.
   *
   * @param {Object|null} browserItem
   * @param {Object|null} storeItem
   * @returns {Object} {item, reason}
   */
  function mergeItem(browserItem, storeItem) {
    if (!browserItem && !storeItem) {
      throw new TypeError("mergeItem: at least one side must be an item");
    }
    if (!storeItem) {
      return { item: browserItem, reason: REASON.ONLY_BROWSER };
    }
    if (!browserItem) {
      return { item: storeItem, reason: REASON.ONLY_STORE };
    }
    if (browserItem[FIELD.ID] !== storeItem[FIELD.ID]) {
      throw new Error(
        "mergeItem: two different items (" + browserItem[FIELD.ID] + " and " + storeItem[FIELD.ID] + ")"
      );
    }

    var bRev = browserItem[FIELD.REV];
    var sRev = storeItem[FIELD.REV];

    // The reword-offline case. The browser holds a revision the store has never
    // seen, so nothing the store knows about lifecycle can apply to it: the
    // store's status names an older revision.
    if (bRev > sRev) {
      return { item: browserItem, reason: REASON.BROWSER_NEWER_REV };
    }

    // The store is ahead. That happens when another window of the same review
    // moved the item on, or when this browser's copy is stale after a restore.
    // The store's content and lifecycle both win, because the browser has
    // nothing newer to protect.
    if (sRev > bRev) {
      return { item: storeItem, reason: REASON.STORE_NEWER_REV };
    }

    // Same revision. Lifecycle comes from the store, because a reply naming
    // this revision is exactly what the store knows and the browser does not.
    var merged = Object.assign({}, storeItem);

    // Content comes from the browser while its work is unacknowledged: it may
    // hold keystrokes the helper never received.
    if (!isAcknowledged(browserItem)) {
      merged = copyContent(browserItem, merged);
      return { item: merged, reason: REASON.SAME_REV_UNACKED };
    }
    return { item: merged, reason: REASON.SAME_REV_ACKED };
  }

  /**
   * Merges two lists of items by id. Order follows the browser's list first
   * (which is what the reviewer's rail is showing), then anything only the
   * store has, so the rail never reorders itself under a focused card.
   *
   * @returns {Object} {items, reasons}  reasons keyed by item id
   */
  function mergeLists(browserItems, storeItems) {
    var byId = Object.create(null);
    var order = [];
    var i;

    for (i = 0; i < (browserItems || []).length; i += 1) {
      var b = browserItems[i];
      byId[b[FIELD.ID]] = { browser: b, store: null };
      order.push(b[FIELD.ID]);
    }
    for (i = 0; i < (storeItems || []).length; i += 1) {
      var s = storeItems[i];
      var id = s[FIELD.ID];
      if (!byId[id]) {
        byId[id] = { browser: null, store: s };
        order.push(id);
      } else {
        byId[id].store = s;
      }
    }

    var items = [];
    var reasons = {};
    for (i = 0; i < order.length; i += 1) {
      var pair = byId[order[i]];
      var got = mergeItem(pair.browser, pair.store);
      items.push(got.item);
      reasons[order[i]] = got.reason;
    }
    return { items: items, reasons: reasons };
  }

  return {
    CONTENT_FIELDS: CONTENT_FIELDS,
    REASON: REASON,
    isAcknowledged: isAcknowledged,
    mergeItem: mergeItem,
    mergeLists: mergeLists
  };
});
