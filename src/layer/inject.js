// Living in the page: the remount contract, route detection, and the CSP
// refusal watcher.
//
// Owner: 2D (living in the page). Implements the architecture's browse-is-fully
// -native half (R13, the page keeps working, which outranks editing
// convenience) and the remount contract.
//
// ---------------------------------------------------------------------------
// The remount contract, stated here because it is the thing that breaks silently
// ---------------------------------------------------------------------------
//
//   The overlay root is NOT in the server's HTML. So any wholesale replacement
//   of the body, any morph that reaches it, any navigation that re-renders the
//   page can take it away. It is re-created on five paths:
//
//     turbo:morph      Hotwire replaced part of the page
//     turbo:load       a Turbo Drive navigation finished
//     popstate         the reviewer went back or forward
//     pageshow         a fresh load, OR a back/forward cache restore
//     a MutationObserver fallback, for a framework that fires none of the above
//
//   EVERY HANDLER IS DE-REGISTERED BEFORE RE-REGISTRATION, through the listener
//   registry, and replay runs after each remount.
//
// The order below is not decoration. Re-registering before de-registering IS
// the leak: the tool being replaced re-registers document-level mousedown and
// mouseup on every morph with no removal, so after one hundred morphs one
// gesture produces one hundred items. Ranked test 4 counts it.
//
// The bfcache path is the one nobody tests. Navigating away and pressing Back
// restores the page WITHOUT a fresh load: no script re-runs, so a library that
// only ever wires itself from a fresh boot comes back to a page whose root a
// framework may already have replaced, with a store it never re-merged and a
// replay that never ran. `pageshow` with `persisted` is the only signal, and
// ranked test 24 asserts the remount really ran there rather than asserting the
// rail happens to be present.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.inject = factory(root.LAHE.listeners, root.LAHE.replay, root.LAHE.markers, root.LAHE.failures);
  } else {
    module.exports = factory(
      require("./listeners.js"),
      require("./replay.js"),
      require("../shared/markers.js"),
      require("../shared/failures.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (listeners, replay, markers, failures) {
  "use strict";

  // Every event that can cost the layer its root. Data, so a test can assert
  // the list rather than the implementation.
  var REMOUNT_TRIGGERS = [
    { event: "turbo:morph", on: "document", why: "Hotwire replaced part of the page" },
    { event: "turbo:load", on: "document", why: "a Turbo Drive navigation finished" },
    { event: "popstate", on: "window", why: "the reviewer went back or forward" },
    { event: "pageshow", on: "window", why: "restored from the back/forward cache" },
    { event: "mutation-fallback", on: "document.body", why: "a framework that fires none of the above still removes the root" }
  ];

  // The order remount runs in. Written down because doing these out of order is
  // exactly the leak: re-registering before de-registering doubles the handlers.
  var REMOUNT_ORDER = [
    "listeners.offGroup(DOCUMENT) and offGroup(NAVIGATION)",
    "re-create the overlay root if it is gone",
    "re-register document and navigation handlers through the registry",
    "merge the store, so a restored page is not reading a stale set of records",
    "replay.schedule(REASON.REMOUNT)"
  ];

  // Client-side routing gives the layer no event unless it hooks history. The
  // shim moves into the layer; it does not disappear.
  var HISTORY_HOOKS = ["pushState", "replaceState"];

  // The groups a remount clears before it re-registers. The comments surface
  // registers under its own group name, which is why the list is data: a group
  // that is not on it is a group that leaks.
  var CLEARED_GROUPS = [listeners.GROUP.DOCUMENT, listeners.GROUP.NAVIGATION, "comments"];

  // How many remounts to remember. A log rather than a single value because
  // "which trigger fired, in what order" is the first question every remount
  // bug asks, and the answer is gone by the time anyone looks.
  var LOG_LIMIT = 50;

  function noop() {}

  /**
   * Install the remount contract on a real page.
   *
   * Everything this module does not own is a callback, because the WORK of a
   * remount (re-creating the root, re-binding the comment surface, merging the
   * store) belongs to modules 2D does not own. What lives here is the ORDER, the
   * trigger list, and the de-registration.
   *
   * @param {Object} options
   * @param {Document} options.document
   * @param {Window} [options.window]
   * @param {Object} [options.registry]  the listener registry; defaults to the shared one
   * @param {() => boolean} [options.ensureRoot]  re-create the overlay root if it is gone;
   *                                              returns true when it actually created one
   * @param {() => void} [options.rebind]  re-register the document-level handlers
   * @param {() => void} [options.merge]   the store's load-merge
   * @param {(detail: Object) => void} [options.onRemount]
   * @param {string[]} [options.groups]
   */
  function install(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (typeof window !== "undefined" ? window : null);
    if (!doc) throw new Error("inject.install: a document is required");

    var registry = opts.registry || listeners.shared;
    var ensureRoot = opts.ensureRoot || function () {
      return false;
    };
    var rebind = opts.rebind || noop;
    var merge = opts.merge || noop;
    var onRemount = opts.onRemount || noop;
    var groups = opts.groups || CLEARED_GROUPS;

    var counters = {
      remounts: 0,
      rootsRecreated: 0,
      handlersCleared: 0,
      mutationFallbacks: 0,
      bfcacheRestores: 0,
      historyHooks: 0,
      cspRefusals: 0
    };
    var byTrigger = Object.create(null);
    var log = [];
    var observer = null;
    var historyPatched = null;
    var installed = false;

    function rootMissing() {
      return !doc.getElementById(markers.OVERLAY_ROOT_ID);
    }

    function note(detail) {
      log.push(detail);
      if (log.length > LOG_LIMIT) log.shift();
      byTrigger[detail.reason] = (byTrigger[detail.reason] || 0) + 1;
    }

    /**
     * One remount, in REMOUNT_ORDER. Synchronous on purpose: the handler that
     * fired is the framework's, and anything deferred to a frame runs after the
     * next gesture the reviewer makes.
     */
    function remount(reason, extra) {
      var detail = { reason: reason || "manual", at: Date.now(), persisted: false, rootWasMissing: rootMissing() };
      if (extra) {
        Object.keys(extra).forEach(function (key) {
          detail[key] = extra[key];
        });
      }

      // 1. De-register EVERY handler, through the registry, before anything
      //    re-registers. This line is the whole contract.
      var cleared = 0;
      groups.forEach(function (group) {
        cleared += registry.offGroup(group);
      });
      counters.handlersCleared += cleared;
      detail.handlersCleared = cleared;

      // 2. The root, if it is gone.
      var created = false;
      if (detail.rootWasMissing) {
        created = ensureRoot() === true;
        if (created) counters.rootsRecreated += 1;
      }
      detail.rootRecreated = created;

      // 3. Re-register, document handlers first and then the navigation ones we
      //    just cleared out from under ourselves.
      rebind();
      registerNavigation();

      // 4. The store's load-merge. A restored page that never re-merges shows
      //    the reviewer a rail from before whatever else wrote to storage.
      merge();

      // 5. Replay, every time, whichever path got us here.
      detail.replayScheduled = replay.schedule(replay.REASON.REMOUNT) === true;

      counters.remounts += 1;
      note(detail);
      onRemount(detail);
      return detail;
    }

    // ------------------------------------------------------------------------
    // The five paths
    // ------------------------------------------------------------------------

    function registerNavigation() {
      var group = listeners.GROUP.NAVIGATION;
      registry.on(doc, "turbo:morph", function () {
        remount("turbo:morph");
      }, false, group);
      registry.on(doc, "turbo:load", function () {
        remount("turbo:load");
      }, false, group);
      if (!win) return;
      registry.on(win, "popstate", function () {
        remount("popstate");
      }, false, group);
      registry.on(win, "pageshow", function (event) {
        var persisted = !!(event && event.persisted);
        // A fresh load fires pageshow too, and boot has already done this work.
        // The restore is the one that has nothing else behind it.
        if (persisted) counters.bfcacheRestores += 1;
        remount(persisted ? "pageshow-persisted" : "pageshow", { persisted: persisted });
      }, false, group);
    }

    // The MutationObserver fallback. It watches for the root GOING AWAY rather
    // than for change in general: a page that repaints on a timer would
    // otherwise remount several times a second for no reason, and a remount
    // that runs constantly is indistinguishable from one that never runs.
    function startObserver() {
      if (observer || !win || typeof win.MutationObserver !== "function") return null;
      observer = new win.MutationObserver(function () {
        if (!rootMissing()) return;
        counters.mutationFallbacks += 1;
        remount("mutation");
      });
      // documentElement, not body: a framework that replaces the whole body
      // takes an observer bound to the old body with it.
      observer.observe(doc.documentElement, { childList: true, subtree: true });
      return observer;
    }

    // Client-side routing that never touches the network fires nothing at all.
    // Patched ONCE and remembered, because a shim re-applied on every remount is
    // the same leak in a different shape: one hundred morphs, one hundred
    // wrappers, one hundred remounts per route change.
    function patchHistory() {
      if (historyPatched || !win || !win.history) return null;
      var history = win.history;
      var originals = {};
      HISTORY_HOOKS.forEach(function (name) {
        if (typeof history[name] !== "function") return;
        originals[name] = history[name];
        history[name] = function () {
          var result = originals[name].apply(history, arguments);
          counters.historyHooks += 1;
          remount("history:" + name);
          return result;
        };
      });
      historyPatched = { history: history, originals: originals };
      return historyPatched;
    }

    function unpatchHistory() {
      if (!historyPatched) return;
      Object.keys(historyPatched.originals).forEach(function (name) {
        historyPatched.history[name] = historyPatched.originals[name];
      });
      historyPatched = null;
    }

    // ------------------------------------------------------------------------
    // CSP refusal
    // ------------------------------------------------------------------------
    //
    // A page whose Content-Security-Policy refuses connections to the helper
    // looks EXACTLY like a helper that is down, from a fetch's point of view,
    // and the two need opposite fixes: one is "start the helper", the other is
    // "add the helper's origin to connect-src in this app's development CSP".
    // The browser tells us which, once, through securitypolicyviolation.
    //
    // sync.js watches the same event for its own state machine. This watcher is
    // the layer-wide one: it names the refusal on the rail even when nothing has
    // tried to sync yet.

    function watchForCspRefusal(onRefusal, watchOptions) {
      var o = watchOptions || {};
      var helperOrigin = o.helperOrigin || null;
      var handler = function (event) {
        var directive = String((event && (event.effectiveDirective || event.violatedDirective)) || "");
        if (directive.indexOf("connect-src") !== 0) return;
        var blocked = String((event && event.blockedURI) || "");
        if (blocked && helperOrigin && blocked.indexOf(helperOrigin) !== 0) return;
        counters.cspRefusals += 1;
        (onRefusal || noop)(cspFailure("connect-src blocked " + (blocked || helperOrigin || "the helper")));
      };
      registry.on(doc, "securitypolicyviolation", handler, false, listeners.GROUP.NETWORK);
      return { watching: true, handler: handler };
    }

    function start() {
      if (installed) return api;
      installed = true;
      registerNavigation();
      startObserver();
      patchHistory();
      return api;
    }

    function teardown() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      unpatchHistory();
      groups.forEach(function (group) {
        registry.offGroup(group);
      });
      registry.offGroup(listeners.GROUP.NETWORK);
      installed = false;
    }

    var api = {
      start: start,
      remount: remount,
      teardown: teardown,
      watchForCspRefusal: watchForCspRefusal,
      counters: counters,
      byTrigger: byTrigger,
      rootMissing: rootMissing,
      isInstalled: function () {
        return installed;
      },
      log: function () {
        return log.slice();
      },
      last: function () {
        return log.length ? log[log.length - 1] : null;
      },
      registry: registry
    };
    return api;
  }

  function cspFailure(detail) {
    return failures.failure("CSP_REFUSED", detail || null);
  }

  return {
    REMOUNT_TRIGGERS: REMOUNT_TRIGGERS,
    REMOUNT_ORDER: REMOUNT_ORDER,
    HISTORY_HOOKS: HISTORY_HOOKS,
    CLEARED_GROUPS: CLEARED_GROUPS,
    OVERLAY_ROOT_ID: markers.OVERLAY_ROOT_ID,
    install: install,
    cspFailure: cspFailure,
    replayReason: replay.REASON.REMOUNT
  };
});
