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
        tabEdits: require("./tab_edits.js"),
        tabDone: require("./tab_done.js"),
        sync: require("./sync.js"),
        editing: require("./editing.js"),
        protect: require("./protect.js"),
        exporter: require("./export.js")
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

    // The window-session state machine's boot half (D5, findings 1/12, NEW-2). A
    // window that loses the claim goes READ-ONLY: its edit and comment handlers
    // are torn down so it writes nothing to the shared bucket, and the refusal
    // panel is shown. Its button re-claims with a takeover, and on success the
    // handlers are re-installed and the panel hidden.
    var readOnlyActive = false;

    function enterReadOnly(info) {
      if (readOnlyActive) {
        rail.showRefusal(info);
        return;
      }
      readOnlyActive = true;
      comments.closeAll();
      // unbind, NEVER comments.teardown(): teardown also tears down the SHARED
      // highlight surface the rail lives in, and the next gesture after a
      // takeover then died on highlight.surface's second-host guard. The
      // reviewer pressed "Review here instead", the helper granted it, and the
      // window still could not comment (first-real-use bug two, 2026-08-14).
      comments.unbind();
      editing.teardown();
      rail.showRefusal(info);
    }

    function exitReadOnly() {
      if (!readOnlyActive) return;
      readOnlyActive = false;
      comments.bind({ page: page });
      editing.bind({ page: page });
      rail.hideRefusal();
      // The condition ended, so its chip goes too (clear, not dismiss: dismiss
      // would suppress every future refusal's chip).
      rail.failures.clear("SECOND_WINDOW_REFUSED");
    }

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
      onRefused: function (info) {
        enterReadOnly(info);
      },
      onHeld: function () {
        exitReadOnly();
      },
      onReplies: function (events) {
        // 1B's poll loop brings folded replies and rejected lines back; 3A's
        // file decides what each one does to a card.
        done.applyReplies(events);
      }
    });

    // The refusal panel's "Review here instead" button (finding 12), through the
    // same action seam Copy and Export use.
    rail.onAction("takeover", function () {
      rail.markRefusalPending();
      return sync.takeover().then(function (result) {
        // On success the sync client's onHeld already hid the panel and re-bound
        // the handlers. On failure the review is still held elsewhere: say so and
        // leave the button pressable again.
        if (!result || !result.ok) {
          rail.showRefusal({ reason: (result && result.reason) || "The review is still open in another window." });
        }
        return result;
      });
    });

    // Copy and Export (3C). The rail holds the buttons and hands the click on;
    // this is where the click meets the work. Both controls are visible at all
    // times (D10), so both are wired at all times: a handler registered only
    // when the helper is missing is a button that does nothing on the day the
    // reviewer needs it.
    var exporter = opts.exporter || ns.exporter.createExport({
      review: reviewId,
      token: config.token,
      helperOrigin: config.helper,
      store: store,
      sync: sync,
      rail: rail,
      document: doc,
      window: win
    });
    ns.exporter.configure(exporter);
    rail.onAction("copy", exporter.copyReview);
    rail.onAction("export", exporter.exportReview);

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

    // The Edits tab's contents, inside the rail's own Edits pane, the way the
    // Active tab lives inside the Active one. It is created after the edit
    // surface because it subscribes to it: a hand edit becomes a row on the
    // same act that writes the record.
    var editsTab = makeEditsTab();

    function makeEditsTab() {
      var made = ns.tabEdits.createEditsTab({
        store: store,
        reviewId: reviewId,
        overlay: rail,
        host: rail.tabBody(ns.overlay.TAB.EDITS),
        editing: editing
      });
      made.mount();
      return made;
    }

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
      repaintHighlights(merged);
      counters.merges += 1;
      return merged;
    }

    // The kinds that carry a mark on the page. An edit is not one of them: its
    // mark IS the changed text, which replay puts back.
    var PAINTED_KINDS = [record.KIND.COMMENT, record.KIND.NOTE];

    /**
     * Put the reviewer's marks back on the page.
     *
     * A highlight is DOM, so it dies with the page and it is not restored by
     * anything else here: the records come back from browser storage, the cards
     * are redrawn above, replay puts committed edits back, and until this
     * existed the passages themselves came back bare (found on a reload,
     * 2026-08-14). The reviewer's marks are their map of what they have already
     * looked at, so a reload that erases them is a reviewer reading the page
     * twice.
     *
     * comments.repaint resolves the record's own anchor against the page as it
     * is now and paints nothing when it does not bind, which is the honest
     * answer and the same one replay gives: a passage the agent deleted stays
     * unpainted and keeps its lost state.
     *
     * A HANDLED item is skipped, because a handled item having no highlight is
     * the rule (R37), not an accident. An item whose box is open is skipped too:
     * its paint is the louder ACTIVE one, and repainting would quietly downgrade
     * the passage the reviewer is looking at right now.
     */
    function repaintHighlights(merged) {
      merged.forEach(function (item) {
        if (PAINTED_KINDS.indexOf(item[record.FIELD.KIND]) === -1) return;
        if (item[record.FIELD.STATE] === record.STATE.HANDLED) return;
        var id = item[record.FIELD.ID];
        if (comments.boxFor(id)) return;
        comments.repaint(id);
      });
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

    // Finding 30: replay is configured with no fold/merge/retire/rail hooks on
    // purpose. Those four steps run on their own schedules (replies on the sync
    // poll, merge on remount, rail on onChange), so a replay pass may raise a
    // provisional collision that a later fold clears. That is the intended
    // trade, documented at replay.js configure(); see its "Honest note for 3A".
    ns.replay.configure({
      root: doc.body || doc,
      items: function () {
        return items;
      },
      cards: rail,
      protect: protect,
      document: doc,
      // For one thing only: the conflict card's "take the page's" button, which
      // retires a record and writes nothing. See replay's `context`.
      editing: editing,
      // How a record replay changed gets written down. `items` above is a
      // CACHE, and merge() replaces it from the store on every remount, so a
      // change replay only made in memory dies at the next morph. That is what
      // made "Keep mine" a one-shot: the accepted page state it recorded was
      // gone before the pass that needed it (2026-08-14).
      persist: function (item) {
        store.write(reviewId, item);
        refreshItems();
        rail.upsertCard(item);
      }
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
      editsTab.unmount();
      done.unmount();
      rail.unmount();
      rail.mount();
      // The tab holds the pane node it was given, and that node went with the
      // old root, so the tab is built again against the new one.
      tab = createTab();
      editsTab = makeEditsTab();
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
        // A remount must not resurrect the gestures in a refused window: Ken's
        // read-only tab re-armed Cmd-Shift-C on its first Turbo navigation and
        // opened comment boxes that could do nothing (first-real-use bug,
        // 2026-08-14). exitReadOnly re-binds when the window becomes holder.
        if (!readOnlyActive) {
          comments.bind({ page: page });
          editing.bind({ page: page });
        }
        // The page that comes back from a navigation or a morph is not required
        // to have the background the page that left had, and the library wears
        // the PAGE's scheme rather than the OS's.
        rail.refreshScheme();
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
      editsTab: function () {
        return editsTab;
      },
      doneTab: function () {
        return done;
      },
      sync: sync,
      exporter: exporter,
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
        // sync.stop() first (finding 13): it clears the poll timer, the
        // heartbeat and liveness timers, and releases the window lock and the
        // window-registered unload listeners, all of which used to leak.
        sync.stop();
        injector.teardown();
        if (pageObserver) pageObserver.disconnect();
        pageObserver = null;
        protect.uninstall();
        editing.teardown();
        comments.teardown();
        tab.unmount();
        editsTab.unmount();
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

      // Copy and Export. The buttons are the reviewer's path; this is here so a
      // spec can read what the last click actually did, which is the only way
      // to tell a copy that worked from one that quietly did not.
      exporter: handle.exporter,

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
