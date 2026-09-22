// The conflict toast: "your edit clashed, nothing is lost, go choose".
//
// Owner: conflict-toast (2026-09-22). The toast itself is the rail's
// (overlay.js showToast); the collision is replay's (branch four, flagConflict).
// This file is only the decision in between: when a collision is news, what the
// toast says, and where pressing it goes.
//
// WHY IT EXISTS. Ken asked the agent to add a module to his article, then kept
// writing in the same spot while it worked. When he committed, the page
// reloaded onto the agent's version, replay's fourth branch ("matches none of
// these") flagged a conflict and wrote nothing, and his paragraphs vanished
// from the page. They were safe on the conflict card in the rail, but nothing
// told him, and he thought he had lost his writing. His ask: "use the toasts to
// be like, hey, there was a conflict, you just need to resolve it."
//
// The rules:
//
//   ONCE PER CONFLICT  A conflict is a record id plus the rev that conflicted.
//                      A repaint that re-finds it raises nothing, and neither
//                      does a reload: the keys already told are kept in
//                      sessionStorage, the same place the rail keeps its
//                      overdue notices, so they last as long as the browser tab.
//                      Resolving a conflict forgets its key, so the same record
//                      colliding again later is told again.
//   ONE TOAST          Several collisions share one toast that names the count.
//                      A new collision while one stands replaces it with the
//                      new count rather than stacking a second.
//   IT WAITS           Sticky: no timer. It goes when pressed, swiped or closed,
//                      or when every conflict it named is resolved.
//   HELD WHILE HIDDEN  While the tool is hidden for presenting (or the window is
//                      read-only), nothing is raised and nothing is spent. The
//                      next sync after the reviewer comes back raises it.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.conflictToast = factory();
  } else {
    module.exports = factory();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var LABEL = "Conflict";
  var TITLE_ONE = "Your edit clashed with a change to the page";
  var BODY_ONE = "Nothing is lost. Both versions are on the card. Click to choose which to keep.";
  var BODY_MANY = "Nothing is lost. Both versions are on each card. Click to choose which to keep.";

  var SEEN_PREFIX = "lahe:conflict-notices:";
  // A tab that has been told fifty collisions and resolved none of them is not
  // helped by the fifty-first key; the oldest go first.
  var SEEN_MAX = 50;

  function titleFor(count) {
    if (count <= 1) return TITLE_ONE;
    return String(count) + " of your edits clashed with changes to the page";
  }

  function bodyFor(count) {
    return count <= 1 ? BODY_ONE : BODY_MANY;
  }

  function conflictKey(id, rev) {
    return String(id) + ":" + String(rev);
  }

  /**
   * @param {object} opts
   * @param {object} opts.rail           the overlay: showToast, dismissToast, collapse, selectTab, ...
   * @param {string} opts.reviewId
   * @param {object|null} opts.storage   sessionStorage, or null (memory only)
   * @param {function} opts.conflictIds  replay's standing conflicts, as record ids
   * @param {function} opts.itemById     the record for an id, or null
   * @param {function} [opts.isHidden]   true while presenting or read-only
   */
  function createConflictToasts(opts) {
    var o = opts || {};
    var rail = o.rail;
    var storage = o.storage || null;
    var storageKey = SEEN_PREFIX + String(o.reviewId || "");
    // The in-page copy, so a missing or failing storage still stops repeats
    // within this page life.
    var memory = [];
    var standing = null; // { toastId, ids }
    var seq = 0;

    function readSeen() {
      var list = memory.slice();
      if (!storage) return list;
      try {
        var parsed = JSON.parse(storage.getItem(storageKey) || "[]");
        if (Array.isArray(parsed)) {
          parsed.forEach(function (key) {
            if (list.indexOf(key) === -1) list.push(key);
          });
        }
      } catch (err) {
        // Unreadable storage is memory-only storage.
      }
      return list;
    }

    function writeSeen(list) {
      var kept = list.slice(-SEEN_MAX);
      memory = kept.slice();
      if (!storage) return kept;
      try {
        storage.setItem(storageKey, JSON.stringify(kept));
      } catch (err) {
        // A full or blocked storage keeps the in-page memory, which is enough
        // to stop repeats until the next reload.
      }
      return kept;
    }

    function openConflicts() {
      var ids = typeof o.conflictIds === "function" ? o.conflictIds() || [] : [];
      var out = [];
      ids.forEach(function (id) {
        var item = typeof o.itemById === "function" ? o.itemById(id) : null;
        if (!item) return;
        out.push({ id: id, key: conflictKey(id, item.rev) });
      });
      return out;
    }

    function hidden() {
      return typeof o.isHidden === "function" && o.isHidden() === true;
    }

    function dropStanding(reason) {
      if (!standing) return false;
      var toastId = standing.toastId;
      standing = null;
      if (rail && typeof rail.dismissToast === "function") rail.dismissToast(toastId, reason || "replaced");
      return true;
    }

    /**
     * Bring the toast in line with what replay says now. Called after every
     * replay pass, after a resolution, and when the reviewer stops presenting.
     *
     * @returns {string|null} the id of a toast raised by this call, or null
     */
    function sync() {
      if (!rail || typeof rail.showToast !== "function") return null;
      var open = openConflicts();
      var openIds = open.map(function (c) {
        return c.id;
      });

      // A standing toast names only what is still open; empty, it goes.
      if (standing) {
        standing.ids = standing.ids.filter(function (id) {
          return openIds.indexOf(id) !== -1;
        });
        if (!standing.ids.length) dropStanding("replaced");
      }

      if (!open.length || hidden()) return null;
      var seen = readSeen();
      var fresh = open.filter(function (c) {
        return seen.indexOf(c.key) === -1;
      });
      if (!fresh.length) return null;
      writeSeen(
        seen.concat(
          fresh.map(function (c) {
            return c.key;
          })
        )
      );

      var ids = standing ? standing.ids.slice() : [];
      fresh.forEach(function (c) {
        if (ids.indexOf(c.id) === -1) ids.push(c.id);
      });
      dropStanding("replaced");

      seq += 1;
      var mine = { toastId: null, ids: ids };
      var toastId = rail.showToast({
        // Our own memory is the dedupe; the rail's per-key rule would refuse a
        // conflict that was resolved and came back, so every raise is unique.
        key: "conflict:" + String(seq) + ":" + ids.join(","),
        label: LABEL,
        text: titleFor(ids.length),
        about: bodyFor(ids.length),
        sticky: true,
        onOpen: function () {
          openCard(mine.ids);
        },
        onGone: function () {
          if (standing === mine) standing = null;
        }
      });
      if (!toastId) return null;
      mine.toastId = toastId;
      standing = mine;
      return toastId;
    }

    /** The reviewer chose on the card. Forget the key so a later clash is news. */
    function resolved(id) {
      var prefix = String(id) + ":";
      var seen = readSeen();
      var kept = seen.filter(function (key) {
        return key.indexOf(prefix) !== 0;
      });
      if (kept.length !== seen.length) writeSeen(kept);
      sync();
      return true;
    }

    /**
     * Open the rail on the first conflict card still standing, the way a reply
     * toast opens its card: unfold it, scroll to the choice, focus the card.
     */
    function openCard(ids) {
      var flagged = typeof o.conflictIds === "function" ? o.conflictIds() || [] : [];
      var id = null;
      (ids || []).forEach(function (candidate) {
        if (id === null && flagged.indexOf(candidate) !== -1) id = candidate;
      });
      if (id === null) id = ids && ids.length ? ids[0] : null;
      if (typeof rail.collapse === "function") rail.collapse(false);
      if (id === null) return false;
      var item = typeof o.itemById === "function" ? o.itemById(id) : null;
      if (item && typeof rail.paneForItem === "function" && typeof rail.selectTab === "function") {
        rail.selectTab(rail.paneForItem(item));
      }
      if (typeof rail.setCardCollapsed === "function") rail.setCardCollapsed(id, false);
      var node = typeof rail.cardNode === "function" ? rail.cardNode(id) : null;
      if (!node) return true;
      var choice = typeof node.querySelector === "function" ? node.querySelector("[data-lahe-conflict]") : null;
      var target = choice || node;
      if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "nearest" });
      node.tabIndex = -1;
      if (typeof node.focus === "function") node.focus();
      return true;
    }

    function info() {
      return { standing: standing ? { toastId: standing.toastId, ids: standing.ids.slice() } : null, seen: readSeen() };
    }

    return { sync: sync, resolved: resolved, openCard: openCard, info: info };
  }

  return {
    LABEL: LABEL,
    TITLE_ONE: TITLE_ONE,
    BODY_ONE: BODY_ONE,
    BODY_MANY: BODY_MANY,
    SEEN_PREFIX: SEEN_PREFIX,
    titleFor: titleFor,
    bodyFor: bodyFor,
    conflictKey: conflictKey,
    createConflictToasts: createConflictToasts
  };
});
