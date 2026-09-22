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
//   UNTIL DEALT WITH   A conflict is a record id plus the rev that conflicted.
//                      Each key has two states, kept in sessionStorage (the
//                      same place the rail keeps its overdue notices, so they
//                      last as long as the browser tab): RAISED, and DEALT
//                      WITH. Dealt with means the reviewer pressed or swiped
//                      the toast, or resolved the conflict. A repaint that
//                      re-finds a standing conflict raises nothing. A reload
//                      raises again every open conflict not yet dealt with (one
//                      toast, same count rule): the agent may still be writing,
//                      so a reload with the toast up is likely, and it must not
//                      take the toast away for good while the conflict stays.
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
  // helped by the fifty-first key; the oldest go first (per state).
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
    // within this page life. Two lists of keys: raised, and dealt with.
    var memory = { raised: [], dealt: [] };
    var standing = null; // { toastId, ids, keys }
    var seq = 0;

    function merge(into, from) {
      (Array.isArray(from) ? from : []).forEach(function (key) {
        if (typeof key === "string" && into.indexOf(key) === -1) into.push(key);
      });
      return into;
    }

    function readState() {
      var state = { raised: memory.raised.slice(), dealt: memory.dealt.slice() };
      if (!storage) return state;
      try {
        var parsed = JSON.parse(storage.getItem(storageKey) || "null");
        if (Array.isArray(parsed)) {
          // The first shape was one list of keys already told, never to be
          // raised again: that is what dealt with means now.
          merge(state.dealt, parsed);
        } else if (parsed && typeof parsed === "object") {
          merge(state.raised, parsed.raised);
          merge(state.dealt, parsed.dealt);
        }
      } catch (err) {
        // Unreadable storage is memory-only storage.
      }
      return state;
    }

    function writeState(state) {
      var kept = { raised: state.raised.slice(-SEEN_MAX), dealt: state.dealt.slice(-SEEN_MAX) };
      memory = { raised: kept.raised.slice(), dealt: kept.dealt.slice() };
      if (!storage) return kept;
      try {
        storage.setItem(storageKey, JSON.stringify(kept));
      } catch (err) {
        // A full or blocked storage keeps the in-page memory, which is enough
        // to stop repeats until the next reload.
      }
      return kept;
    }

    /** The reviewer has dealt with these keys: never raise them again. */
    function markDealt(keys) {
      if (!keys || !keys.length) return;
      var state = readState();
      keys.forEach(function (key) {
        if (state.dealt.indexOf(key) === -1) state.dealt.push(key);
      });
      writeState(state);
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
        standing.keys = standing.keys.filter(function (key) {
          return standing.ids.some(function (id) {
            return key.indexOf(String(id) + ":") === 0;
          });
        });
        if (!standing.ids.length) dropStanding("replaced");
      }

      if (!open.length || hidden()) return null;
      var state = readState();
      // News is an open conflict the reviewer has not dealt with and the
      // standing toast does not already name. After a reload nothing stands,
      // so every open conflict raised and not dealt with comes back.
      var fresh = open.filter(function (c) {
        if (state.dealt.indexOf(c.key) !== -1) return false;
        return !(standing && standing.ids.indexOf(c.id) !== -1);
      });
      if (!fresh.length) return null;
      fresh.forEach(function (c) {
        if (state.raised.indexOf(c.key) === -1) state.raised.push(c.key);
      });
      writeState(state);

      var ids = standing ? standing.ids.slice() : [];
      var keys = standing ? standing.keys.slice() : [];
      fresh.forEach(function (c) {
        if (ids.indexOf(c.id) === -1) ids.push(c.id);
        if (keys.indexOf(c.key) === -1) keys.push(c.key);
      });
      dropStanding("replaced");

      seq += 1;
      var mine = { toastId: null, ids: ids, keys: keys };
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
        onGone: function (reason) {
          if (standing === mine) standing = null;
          // Pressed or swiped: the reviewer has seen it. Replaced by a newer
          // count, or taken down because its conflicts closed, is not that.
          if (reason === "user") markDealt(mine.keys);
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
      var keep = function (key) {
        return key.indexOf(prefix) !== 0;
      };
      var state = readState();
      writeState({ raised: state.raised.filter(keep), dealt: state.dealt.filter(keep) });
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
      var state = readState();
      return {
        standing: standing ? { toastId: standing.toastId, ids: standing.ids.slice() } : null,
        raised: state.raised,
        dealt: state.dealt
      };
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
