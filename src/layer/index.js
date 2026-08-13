// The review layer's entry point: boot, the version stamp, and the one place
// the library's pieces are wired to each other.
//
// Owner: 2D (living in the page).
//
// Loaded LAST in the bundle, because it calls into everything above it. See
// src/shared/manifest.js.
//
// ---------------------------------------------------------------------------
// What boot does, and why it is here rather than in a page's own script
// ---------------------------------------------------------------------------
//
// A reviewed page adds ONE script tag (the architecture's D1), carrying
// protocol.js's three attributes:
//
//   <script src="/lahe-layer.js"
//           data-lahe-review="rev-abc"
//           data-lahe-token="..."
//           data-lahe-helper="http://127.0.0.1:7817"></script>
//
// Everything after that is this file: the store, the rail, the comment surface,
// the Active tab inside the rail, sync, the remount contract, and the first
// replay pass. Until this landed, the CP1 walk's fixture did that wiring by
// hand in test/fixtures/assets/cp1-boot.js. That file now calls boot() and does
// nothing else but expose what the walk reads.
//
// ---------------------------------------------------------------------------
// The refusal that used to live here, and why it is gone
// ---------------------------------------------------------------------------
//
// This file used to refuse to initialize on a non-loopback origin. That refusal
// is removed: a built document opened from disk has a `file://` URL and an
// opaque origin, that case is a supported primary one (1A's spike proved it
// works), and the refusal broke it. The local-only controls that remain are the
// real ones: the helper serves loopback only, it checks the per-review token on
// every request, and it registers the origins a review accepts.
//
// The layer is never FETCHED from the helper either. It ships as one
// concatenated file copied into the host application's own static assets, so a
// stopped helper still means a working layer.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.layer = factory(root.LAHE, typeof document !== "undefined" ? document.currentScript : null);
  } else {
    // Node has no page to boot. The namespace is assembled from the same
    // modules so the pure parts (reading a script tag's config, the shape boot
    // returns) are unit-testable without a browser.
    module.exports = factory(
      Object.assign({}, require("../shared/contracts.js"), {
        listeners: require("./listeners.js"),
        replay: require("./replay.js"),
        inject: require("./inject.js"),
        store: require("./store.js"),
        overlay: require("./overlay.js"),
        highlight: require("./highlight.js"),
        comments: require("./comments.js"),
        tabActive: require("./tab_active.js"),
        tabDone: require("./tab_done.js"),
        sync: require("./sync.js"),
        editing: require("./editing.js"),
        protect: require("./protect.js")
      }),
      null
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (ns, ownScript) {
  "use strict";

  // Replaced by scripts/build-layer.js at concatenation time.
  var VERSION = "0.0.0-dev";

  var protocol = ns.protocol;
  var record = ns.record;
  var markers = ns.markers;

  // The global the library publishes about itself. The browser test harness
  // reads counters off it (test/helpers/README.md, "the counter contract"), and
  // so does anyone debugging a page. It is published unconditionally: the layer
  // is a development tool that only ever runs on a page whose author added its
  // script tag, so there is nothing here to hide behind a flag.
  var GLOBAL = "__lahe";

  // ---------------------------------------------------------------------------
  // Configuration
  // ---------------------------------------------------------------------------

  /**
   * The script tag's config, read the way protocol.js specifies: the running
   * script first, then the selector, which is what covers `defer` and any case
   * where currentScript is null by the time boot is called.
   *
   * @param {Document} doc
   * @param {HTMLScriptElement} [script]
   * @returns {{review: string|null, token: string|null, helper: string|null, from: string|null}}
   */
  function readScriptConfig(doc, script) {
    var attr = protocol.SCRIPT_ATTR;
    var tag = script && script.getAttribute && script.getAttribute(attr.REVIEW) ? script : null;
    var from = tag ? "currentScript" : null;
    if (!tag && doc && typeof doc.querySelector === "function") {
      tag = doc.querySelector(protocol.SCRIPT_SELECTOR);
      from = tag ? "selector" : null;
    }
    if (!tag) return { review: null, token: null, helper: null, from: null };
    return {
      review: tag.getAttribute(attr.REVIEW) || null,
      token: tag.getAttribute(attr.TOKEN) || null,
      helper: tag.getAttribute(attr.HELPER) || null,
      from: from
    };
  }

  /** Explicit options win over the tag; the tag is the default, not the law. */
  function resolveConfig(doc, options, script) {
    var opts = options || {};
    var fromTag = readScriptConfig(doc, script);
    return {
      review: opts.review || fromTag.review,
      token: opts.token !== undefined ? opts.token : fromTag.token,
      helper: opts.helper || fromTag.helper || protocol.DEFAULT_HELPER_ORIGIN,
      from: opts.review ? "options" : fromTag.from
    };
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------

  var current = null;

  /**
   * Wire the library onto this page.
   *
   * @param {Object} [options]
   * @param {string} [options.review]  the review id; the script tag's otherwise
   * @param {string} [options.token]
   * @param {string} [options.helper]
   * @param {boolean} [options.startSync]  default true. The CP1 walk starts sync
   *        itself, because the walk is about what happens either side of it.
   * @returns {Object} the boot handle
   */
  function boot(options) {
    var opts = options || {};
    var doc = opts.document || (typeof document !== "undefined" ? document : null);
    var win = opts.window || (typeof window !== "undefined" ? window : null);
    if (!doc || !win) {
      return { booted: false, reason: "no document: the layer needs a page", version: VERSION };
    }

    var config = resolveConfig(doc, opts, opts.script || ownScript);
    if (!config.review) {
      // Fails closed and LOUD. A page with the library on it and no review id
      // is a misconfiguration, and a quiet no-op here is a reviewer typing into
      // a rail that never appears.
      throw new Error(
        "LAHE.layer.boot: no review id. The script tag needs " +
          protocol.SCRIPT_ATTR.REVIEW +
          ', as in <script src="..." ' +
          protocol.SCRIPT_ATTR.REVIEW +
          '="rev-abc" ' +
          protocol.SCRIPT_ATTR.TOKEN +
          '="...">'
      );
    }
    if (current) return current;

    var reviewId = config.review;
    var store = opts.store || ns.store.createStore();
    var rail = opts.rail || ns.overlay.createRail({ store: store, reviewId: reviewId });
    rail.mount();

    var page = record.pageFrom(
      { origin: win.location.origin, pathname: win.location.pathname, href: win.location.href, title: doc.title },
      { seq: 1 }
    );

    var comments = opts.comments || ns.comments.createComments({ store: store, reviewId: reviewId, page: page });
    comments.bind({ page: page });

    // The Active tab's contents live INSIDE the rail's own Active pane, so
    // there is one rail on the page and one host under it.
    var tab = createTab();
    // The Done tab, wired the same way: 3A's file draws what the Done pane
    // holds, and it is also what an agent's answer reaches when the reply poll
    // brings one back.
    var done = createDoneTab();

    function createTab() {
      var made = ns.tabActive.createActiveTab({
        comments: comments,
        overlay: rail,
        host: rail.tabBody(ns.overlay.TAB.ACTIVE)
      });
      made.mount();
      return made;
    }

    function createDoneTab() {
      var made = ns.tabDone.createDoneTab({
        store: store,
        reviewId: reviewId,
        comments: comments,
        overlay: rail,
        host: rail.tabBody(ns.overlay.TAB.DONE),
        sync: function () {
          return sync;
        }
      });
      made.mount();
      return made;
    }

    var statusLog = [];
    var counters = { merges: 0, cardsDrawn: 0 };

    var sync = opts.sync || ns.sync.createSync({
      review: reviewId,
      token: config.token,
      helperOrigin: config.helper || undefined,
      store: store,
      onStatus: function (state) {
        statusLog.push(state);
        rail.setStatusLine(state);
      },
      onFailure: function (failure) {
        rail.failures.add(failure);
      },
      onLimit: function (text) {
        rail.setLimitNote(text);
      },
      onReplies: function (events) {
        // 1B's poll loop brings folded replies and rejected lines back; 3A's
        // file decides what each one does to a card.
        done.applyReplies(events);
      }
    });

    // The editing surface. It is handed sync, because a record is posted by the
    // same act that writes it, and it is bound to the document the way the
    // comment surface is: through the listener registry, under its own group, so
    // a remount clears exactly what it re-registers.
    var editing = opts.editing || ns.editing.createEditing({
      store: store,
      reviewId: reviewId,
      page: page,
      sync: sync
    });
    editing.bind({ page: page });

    // The records replay runs over. Read from the store and CACHED between
    // changes, not re-read per pass: replay stamps a lost region on the object
    // it was handed, and a fresh copy every pass would throw that stamp away and
    // re-stamp it, which turns "this record was untouched" into a diff on every
    // pass. Every write refreshes the cache.
    var items = store.read(reviewId);

    function refreshItems() {
      items = store.read(reviewId);
      return items;
    }

    // The load-merge. Everything browser storage holds for this review comes
    // back as a card, drafts included. It runs on boot AND after every remount:
    // a page restored from the back/forward cache never re-ran boot, and its
    // rail would otherwise show whatever it showed before the reviewer left.
    function merge() {
      var merged = refreshItems();
      merged.forEach(function (item) {
        rail.upsertCard(item);
        counters.cardsDrawn += 1;
      });
      counters.merges += 1;
      return merged;
    }

    merge();

    editing.onChange(function (item) {
      // No sync call here: editing posts through the sync it was handed, on the
      // same act that wrote the record. And NO replay pass here either. The pass
      // that follows a commit comes out of protect.release(), once, through the
      // ordinary scheduler; a second one scheduled from this callback would run
      // against the same page for no reason and would hide a regression in the
      // one that matters.
      refreshItems();
      rail.upsertCard(item);
    });

    comments.onChange(function (item, event) {
      // "removed" carries an id and nothing else, and "closed" is not a change
      // to the record: the state it would post was already posted by the
      // keystroke or by ready.
      if (event === "removed" || event === "closed") return;
      rail.upsertCard(item);
      sync.recordItem(item, event === "ready" ? { immediate: "ready" } : undefined);
    });

    // -------------------------------------------------------------------------
    // Protection, and replay
    // -------------------------------------------------------------------------
    //
    // The four modules wire to each other exactly as CP2-mid proved them on
    // test/fixtures/assets/cp2-mid-boot.js: editing marks and releases
    // protection, protection runs the commit pass, replay asks protection before
    // it writes, and protection's restore hands the rebuilt block back to
    // editing. That last one is the seam with no symptom of its own: when layer
    // three puts the reviewer's words back into a node the repaint built, the
    // open session has to move onto that node, or the text on screen is right
    // and the next keystroke goes nowhere.

    var protect = ns.protect;
    protect.install({
      document: doc,
      onRestore: function (el) {
        editing.rebind(el);
      }
    });

    ns.replay.configure({
      root: doc.body || doc,
      items: function () {
        return items;
      },
      cards: rail,
      protect: protect,
      document: doc
    });

    // "The page changed, so replay gets a pass."
    //
    // The ORDINARY coalescing path, deliberately: no {immediate: true} anywhere
    // in this file. replay.schedule races the frame against a 50ms timer, so a
    // page that is not painting still runs its pass; forcing a pass immediate
    // would hide a regression in that race rather than reporting it. Replay's
    // own writes never land here, because schedule() refuses while the write
    // epoch is open.
    var pageObserver = null;
    if (typeof win.MutationObserver === "function" && doc.body) {
      pageObserver = new win.MutationObserver(function () {
        ns.replay.schedule(ns.replay.REASON.MUTATION);
      });
      pageObserver.observe(doc.body, { childList: true, characterData: true, subtree: true });
    }

    // -------------------------------------------------------------------------
    // The remount contract
    // -------------------------------------------------------------------------

    // The host element the whole library draws into. Held by reference, and
    // that reference is the difference between a cheap remount and a lossy one.
    var hostNode = doc.getElementById(markers.OVERLAY_ROOT_ID);

    /**
     * Put the overlay root back when a morph took it.
     *
     * RE-ATTACH THE SAME NODE rather than building a new one. The node holds a
     * closed shadow root, and every piece of the library caches something
     * inside it: the rail's DOM, the comment surface's root, the Active tab's
     * pane, the box stylesheets. Removing an element from the document does not
     * destroy it, so appending the same node back leaves every one of those
     * references valid, keeps the reviewer's open box open, and costs one DOM
     * insertion. Building a fresh host instead leaves those caches pointing
     * into a detached root, which looks like the library working (records are
     * still written) while nothing the reviewer types is on screen.
     *
     * The rebuild path stays for the case where there is no node to re-attach.
     *
     * @returns {boolean} true when this call put a root back
     */
    function ensureRoot() {
      if (doc.getElementById(markers.OVERLAY_ROOT_ID)) return false;

      if (hostNode && !hostNode.isConnected) {
        (doc.body || doc.documentElement).appendChild(hostNode);
        return true;
      }

      // Nothing to re-attach: build the surface again from the rail down. Every
      // box the reviewer had open died with the old root, so they are closed
      // first; their text is already durable, because a draft is written on the
      // keystroke and not on the close.
      comments.closeAll();
      tab.unmount();
      done.unmount();
      rail.unmount();
      rail.mount();
      // The tab holds the pane node it was given, and that node went with the
      // old root, so the tab is built again against the new one.
      tab = createTab();
      done = createDoneTab();
      hostNode = doc.getElementById(markers.OVERLAY_ROOT_ID);
      merge();
      return !!hostNode;
    }

    var injector = ns.inject.install({
      document: doc,
      window: win,
      ensureRoot: ensureRoot,
      rebind: function () {
        comments.bind({ page: page });
        editing.bind({ page: page });
      },
      merge: merge,
      onRemount: opts.onRemount || null
    });
    injector.start();

    // A CSP that refuses the helper's origin looks exactly like a helper that is
    // down, and the two need opposite fixes. sync.js reads the same event for
    // its own state; this one names it on the rail.
    injector.watchForCspRefusal(function (failure) {
      rail.failures.add(failure);
    }, { helperOrigin: config.helper });

    if (opts.startSync !== false) sync.start();

    // The first pass. Replay is what puts committed edits back on a page that
    // was reloaded, so it runs on boot and not only on a later repaint.
    ns.replay.schedule(ns.replay.REASON.BOOT);

    var handle = {
      booted: true,
      version: VERSION,
      review: reviewId,
      config: config,
      page: page,
      store: store,
      rail: rail,
      comments: comments,
      tab: function () {
        return tab;
      },
      doneTab: function () {
        return done;
      },
      sync: sync,
      editing: editing,
      protect: protect,
      injector: injector,
      merge: merge,
      items: function () {
        return items;
      },
      remount: injector.remount,
      statusLog: function () {
        return statusLog.slice();
      },
      counters: counters,
      teardown: function () {
        injector.teardown();
        if (pageObserver) pageObserver.disconnect();
        pageObserver = null;
        protect.uninstall();
        editing.teardown();
        comments.teardown();
        tab.unmount();
        done.unmount();
        rail.unmount();
        if (win[GLOBAL] && win[GLOBAL].handle === handle) delete win[GLOBAL];
        current = null;
      }
    };

    current = handle;
    publish(win, handle);
    return handle;
  }

  // ---------------------------------------------------------------------------
  // What the page can read about the library
  // ---------------------------------------------------------------------------
  //
  // The counter names are the harness's contract (test/helpers/README.md):
  // replayPasses increments on a pass that wrote nothing, regionsWritten only
  // when replay actually wrote. They are GETTERS over the live counters rather
  // than a copy, because a snapshot taken at boot is a number that never moves.

  function publish(win, handle) {
    var counters = {};
    function live(name, read) {
      Object.defineProperty(counters, name, { enumerable: true, get: read });
    }

    live("replayPasses", function () {
      return ns.replay.counters.passes;
    });
    live("regionsWritten", function () {
      return ns.replay.counters.regionsWritten;
    });
    live("regionsSkippedProtected", function () {
      return ns.replay.counters.regionsSkippedProtected;
    });
    live("regionsLost", function () {
      return ns.replay.counters.regionsLost;
    });
    // The diagnostic names, spelled the way CP2-mid's fixture spelled them, so a
    // test that moves from that fixture to the real boot reads the same counter
    // under the same name.
    live("regionsSkippedIdentical", function () {
      return ns.replay.counters.regionsSkippedEqual;
    });
    live("regionsBlockedChanged", function () {
      return ns.replay.counters.regionsConflicted;
    });
    live("regionsEarlierRevision", function () {
      return ns.replay.counters.regionsEarlierRevision;
    });
    ["remounts", "rootsRecreated", "handlersCleared", "mutationFallbacks", "bfcacheRestores", "historyHooks", "cspRefusals"].forEach(
      function (name) {
        live(name, function () {
          return handle.injector.counters[name];
        });
      }
    );
    live("merges", function () {
      return handle.counters.merges;
    });
    // 2B's, published here so a test reads one counters object whichever module
    // owns the number.
    if (ns.protect && ns.protect.counters) {
      Object.keys(ns.protect.counters).forEach(function (name) {
        live(name, function () {
          return ns.protect.counters[name];
        });
      });
    }

    win[GLOBAL] = {
      booted: true,
      version: VERSION,
      review: handle.review,
      rootId: markers.OVERLAY_ROOT_ID,
      handle: handle,
      counters: counters,

      // The store, and what is in it right now.
      store: function () {
        return handle.store;
      },
      page: function () {
        return handle.page;
      },
      items: function () {
        return handle.store.read(handle.review);
      },
      itemById: function (id) {
        return handle.store.readItem(handle.review, id);
      },
      merge: handle.merge,

      // The listener registry's self-report. Ranked test 4's first half.
      listenerCount: function (group) {
        return ns.listeners.count(group);
      },
      listenerGroups: function () {
        return ns.listeners.shared.groups();
      },

      // The rail, which is inside a closed shadow root and cannot be reached
      // with a selector.
      rail: handle.rail,
      status: function () {
        return handle.rail.getStatusLine();
      },
      statusLog: handle.statusLog,
      failures: function () {
        return handle.rail.failures.list();
      },
      cardIds: function () {
        return handle.rail.cardIds();
      },

      // The editing surface, and what replay decided. Both are inside the
      // library; a spec on a real application page has no other way to ask.
      isEditing: function () {
        return handle.editing.isEditing();
      },
      editState: function () {
        return handle.editing.state();
      },
      itemForElement: function (selector) {
        var el = handle.page && typeof document !== "undefined" ? document.querySelector(selector) : null;
        return el ? handle.editing.itemFor(el) : null;
      },
      flaggedIds: function () {
        return ns.replay.conflictIds();
      },
      lastPass: function () {
        var summary = ns.replay.lastPass();
        if (!summary) return null;
        return {
          reason: summary.reason,
          wrote: summary.wrote,
          conflicts: summary.conflicts,
          lost: summary.lost,
          results: summary.results.map(function (r) {
            var region = r.item[record.FIELD.REGION] || {};
            return {
              id: r.item[record.FIELD.ID],
              label: region.label || null,
              branch: r.branch,
              wrote: r.wrote,
              reason: r.reason
            };
          })
        };
      },

      // The comment surface, for the gesture waits.
      focusedBoxQuote: function () {
        var box = handle.comments.focusedBox();
        return box ? box.item.context.quote || box.id : null;
      },
      pickMode: function () {
        return handle.comments.pickMode().active;
      },

      // The remount contract, observable. Ranked test 24 asserts the remount
      // RAN on a bfcache restore, which is a different claim from the rail
      // happening to be present.
      remount: handle.remount,
      remountLog: function () {
        return handle.injector.log();
      },
      lastRemount: function () {
        return handle.injector.last();
      },

      // The harness's replay hook.
      replayNow: function () {
        return ns.replay.schedule(ns.replay.REASON.MANUAL, { immediate: true });
      },
      startSync: function () {
        return handle.sync.start();
      },
      teardown: handle.teardown
    };
    return win[GLOBAL];
  }

  // ---------------------------------------------------------------------------
  // Auto-boot
  // ---------------------------------------------------------------------------
  //
  // One script tag is the whole of what a page adds, so the tag booting itself
  // is the contract. A page with the bundle on it and NO config tag (a test
  // loading the modules, a build that concatenates it early) boots nothing and
  // says nothing: that is not a misconfiguration, it is a page that has not
  // asked for a review yet.

  function autoBoot() {
    if (typeof document === "undefined" || typeof window === "undefined") return null;
    var config = readScriptConfig(document, ownScript);
    if (!config.review) return null;
    return boot({ script: ownScript });
  }

  var api = {
    VERSION: VERSION,
    GLOBAL: GLOBAL,
    boot: boot,
    booted: function () {
      return current;
    },
    readScriptConfig: readScriptConfig,
    resolveConfig: resolveConfig
  };

  // Runs at the bottom of the concatenated bundle, which is the bottom of the
  // page's <body> in the ordinary case, so the document is already parsed.
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        autoBoot();
      });
    } else {
      autoBoot();
    }
  }

  return api;
});
