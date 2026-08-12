// CP2-mid's boot: 2A, 2B and 2C wired together on one page, all real.
//
// This is what 2D's index.js will do on a real page, written out here because
// 2D is still being built. It makes no decision of its own. The store, the
// rail, the editing surface, the three protection layers, the anchor engine and
// the replay engine are the shipped modules out of /dist/lahe-layer.js; if an
// assertion in test/browser/cp2_mid.spec.js could pass because of a line in
// this file, the line is in the wrong file.
//
// What it does, and nothing else:
//
//   1. Wires the four modules to each other the way the architecture says they
//      wire: editing marks and releases protection, protection runs the commit
//      pass, replay asks protection before it writes, protection's restore
//      hands the rebuilt block back to editing.
//   2. Publishes the counters the harness reads, as GETTERS over the modules'
//      own counters, so no number here can drift from what a module counted.
//   3. Gives the spec a way to read the store and to play the AGENT: the page
//      rewriting its own source under the reviewer.
//
// THE RECORDS ARE REAL. Nothing here mints a record, hand-writes an anchor, or
// bumps a revision. Every record on this page was made by the reviewer's own
// gestures through 2A, which is the whole point of this checkpoint.

(function () {
  "use strict";

  var ns = window.__lahe || (window.__lahe = {});
  var counters = ns.counters || (ns.counters = {});

  var params = new URLSearchParams(location.search);
  var reviewId = params.get("review") || "cp2-mid";

  var record = LAHE.record;
  var replay = LAHE.replay;
  var protect = LAHE.protect;

  // ---------------------------------------------------------------------------
  // The store, the rail, the editing surface
  // ---------------------------------------------------------------------------

  var store = LAHE.store.createStore();

  var page = LAHE.record.pageFrom(
    { origin: location.origin, pathname: location.pathname, href: location.href, title: document.title },
    { seq: 1 }
  );

  var rail = LAHE.overlay.createRail({ store: store, reviewId: reviewId });
  rail.mount();

  var editing = LAHE.editing.createEditing({ store: store, reviewId: reviewId, page: page });
  editing.bind({ page: page });

  // The records replay runs over. Read from the store, cached between changes,
  // because replay stamps a lost region on the object it was handed and a fresh
  // copy per pass would throw that away. Every commit refreshes the cache.
  var items = store.read(reviewId);

  function refreshItems() {
    items = store.read(reviewId);
    return items;
  }

  editing.onChange(function (item) {
    refreshItems();
    rail.upsertCard(item);
  });

  // ---------------------------------------------------------------------------
  // Protection
  // ---------------------------------------------------------------------------
  //
  // All three layers. onRestore is 2B's seam and editing.rebind is 2A's side of
  // it: when layer three puts the reviewer's words back into a node the repaint
  // built, the open session moves onto that node, or the next keystroke lands
  // in an element nothing is listening to.

  protect.install({
    onRestore: function (el) {
      editing.rebind(el);
    }
  });

  // ---------------------------------------------------------------------------
  // Replay
  // ---------------------------------------------------------------------------

  replay.configure({
    root: document.body,
    items: function () {
      return items;
    },
    cards: rail,
    protect: protect,
    document: document
  });

  // 2D's job in the shipped library: the page changed, so replay gets a pass.
  //
  // The ORDINARY coalescing path, deliberately: no {immediate: true} anywhere.
  // 2B's spec glue had to force immediate because replay deferred through
  // requestAnimationFrame alone and a page that is not painting never replayed.
  // That is fixed in replay's own scheduler (a timer races the frame), so this
  // wiring is the honest one, and if the fix regresses this page hangs rather
  // than hiding it.
  var observer = new MutationObserver(function () {
    replay.schedule(replay.REASON.MUTATION);
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });

  document.addEventListener("lahe:repainted", function () {
    replay.schedule(replay.REASON.REMOUNT);
  });

  // ---------------------------------------------------------------------------
  // Counters, as getters over the modules' own
  // ---------------------------------------------------------------------------

  function publish(name, read) {
    Object.defineProperty(counters, name, { get: read, configurable: true, enumerable: true });
  }

  publish("replayPasses", function () {
    return replay.counters.passes;
  });
  publish("regionsWritten", function () {
    return replay.counters.regionsWritten;
  });
  publish("regionsSkippedIdentical", function () {
    return replay.counters.regionsSkippedEqual;
  });
  publish("regionsSkippedProtected", function () {
    return replay.counters.regionsSkippedProtected;
  });
  publish("regionsBlockedChanged", function () {
    return replay.counters.regionsConflicted;
  });
  publish("regionsEarlierRevision", function () {
    return replay.counters.regionsEarlierRevision;
  });
  publish("regionsLost", function () {
    return replay.counters.regionsLost;
  });
  ["marked", "vetoes", "snapshots", "restores", "restoreFailures"].forEach(function (name) {
    publish(name, function () {
      return protect.counters[name];
    });
  });

  // ---------------------------------------------------------------------------
  // What the spec reads and drives
  // ---------------------------------------------------------------------------

  function textOf(selector) {
    var el = document.querySelector(selector);
    return el ? el.textContent : null;
  }

  function itemForRegion(selector) {
    var el = document.querySelector(selector);
    var byElement = el ? editing.itemFor(el) : null;
    if (byElement) return store.readItem(reviewId, byElement[record.FIELD.ID]);
    // The block may be gone (a delete) or rebuilt (a repaint), so fall back to
    // the record whose label names this region.
    var found = null;
    store.read(reviewId).forEach(function (item) {
      var region = item[record.FIELD.REGION] || {};
      if (region.label === selector) found = item;
    });
    return found;
  }

  window.__laheCp2 = {
    reviewId: reviewId,

    // --- the store, which is the source of truth for every record assertion --
    items: function () {
      return store.read(reviewId);
    },
    itemById: function (id) {
      return store.readItem(reviewId, id);
    },
    itemFor: itemForRegion,
    /** Every record except the named ids, as one string, byte for byte. */
    snapshot: function (exceptIds) {
      var skip = exceptIds || [];
      return store
        .read(reviewId)
        .filter(function (item) {
          return skip.indexOf(item[record.FIELD.ID]) === -1;
        })
        .map(function (item) {
          return JSON.stringify(item);
        })
        .join("\n");
    },

    // --- the editing surface, as the reviewer sees it -----------------------
    isEditing: function () {
      return editing.isEditing();
    },
    state: function () {
      return editing.state();
    },
    deleteBlock: function (selector) {
      var item = editing.deleteBlock(document.querySelector(selector));
      return item ? item[record.FIELD.ID] : null;
    },

    // --- the page, read raw -------------------------------------------------
    text: textOf,
    exists: function (selector) {
      return !!document.querySelector(selector);
    },

    // --- protection, as replay asks it --------------------------------------
    protectedItemId: function () {
      return protect.protectedItemId();
    },
    displaced: function () {
      var d = protect.displacedChange();
      return d ? { text: d.text } : null;
    },

    // --- the agent -----------------------------------------------------------
    /**
     * The page rewriting its own source. Two halves, because they are two
     * different events and a test needs to choose:
     *
     *   `dom`     the page writes the block right now. This is an agent landing
     *             a change in a live document.
     *   `source`  what the repaint engine will write back from here on, which
     *             is the server's version of this block changing.
     */
    rewrite: function (selector, text, options) {
      var opts = options || {};
      var el = document.querySelector(selector);
      if (!el) throw new Error("rewrite: no element matches " + selector);
      if (opts.dom !== false) el.textContent = text;
      if (opts.source) window.__lahe.fixture.snapshot();
      return el.textContent;
    },

    // --- the rail, which is a closed shadow root ----------------------------
    card: function (selector) {
      var item = itemForRegion(selector);
      if (!item) return null;
      var id = item[record.FIELD.ID];
      var card = rail.getCard(id);
      var body = rail.cardBody(id);
      var conflict = body ? body.querySelector("[data-lahe-conflict]") : null;
      return {
        id: id,
        state: card ? card.state : null,
        notice: card ? card.notice : null,
        badges: rail.cardBadges(id).map(function (b) {
          return b.canonical_code;
        }),
        conflict: conflict
          ? {
              hidden: conflict.hasAttribute("hidden"),
              title: conflict.firstChild.textContent,
              yours: conflict.querySelector('[data-lahe-conflict-side="yours"] [data-lahe-conflict-text]')
                .textContent,
              theirs: conflict.querySelector('[data-lahe-conflict-side="theirs"] [data-lahe-conflict-text]')
                .textContent
            }
          : null
      };
    },
    flaggedIds: function () {
      return replay.conflictIds();
    },

    /**
     * What the last pass decided, per record. The summary itself carries live
     * nodes and the records themselves, neither of which survives the wire, so
     * this is the readable part of it. It is here for diagnosis: "which branch
     * did this record take" is the first question every replay bug asks.
     */
    lastPass: function () {
      var summary = replay.lastPass();
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
            state: r.item[record.FIELD.STATE],
            branch: r.branch,
            wrote: r.wrote,
            reason: r.reason
          };
        })
      };
    }
  };
})();
