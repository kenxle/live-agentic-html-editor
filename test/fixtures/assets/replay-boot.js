// The boot 2C's browser specs run against: the real replay engine, the real
// rail, the real anchor engine, on a page that fights back.
//
// This is what 2D's index.js will do on a real page, written out here because
// 2D does not exist yet. It wires nothing of its own. Every decision under test
// (which branch, what the card says, what the counters do) is made in
// src/layer/replay.js. If an assertion in test/browser/replay_*.spec.js could
// pass because of a line in this file, the line is in the wrong file.
//
// Two jobs beyond wiring:
//
//   1. It publishes the counters the harness reads. The contract is in
//      test/helpers/counters.js: window.__lahe.counters.replayPasses and
//      .regionsWritten. They are GETTERS over replay's own counters rather than
//      copies, so nothing here can drift from what the engine counted.
//
//   2. It stands in for the parts of Phase 2 that are being built in parallel.
//      2A's editing surface is a contentEditable and a commit that bumps the
//      record's revision from the DOM. 2B's protection is the repaint engine's
//      cooperative-skip attribute plus protect.mark. Both are named
//      standIn* below so nothing reads as the real thing, and the real
//      integration is CP2-mid.
//
// The records come from 0A-kernel's fixture generator and are re-anchored to
// this page's real nodes with 1C's real mint. Nothing here hand-writes a
// reference.

(function () {
  "use strict";

  var ns = window.__lahe || (window.__lahe = {});
  var counters = ns.counters || (ns.counters = {});

  var replay = LAHE.replay;
  var record = LAHE.record;
  var anchor = LAHE.anchor;
  var protect = LAHE.protect;

  // ---------------------------------------------------------------------------
  // The counters the harness reads
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

  // ---------------------------------------------------------------------------
  // The rail
  // ---------------------------------------------------------------------------

  var reviewId = "replay-review";
  var store = LAHE.store.createStore();
  var rail = LAHE.overlay.createRail({ store: store, reviewId: reviewId });
  rail.mount();

  // ---------------------------------------------------------------------------
  // The records
  // ---------------------------------------------------------------------------

  var fixtures = LAHE.record_fixtures.createFixtures({
    seed: "2c-browser",
    page: { origin: location.origin, path: location.pathname, title: document.title, seq: 1 }
  });

  var items = [];
  var byRegion = Object.create(null);

  function textOf(selector) {
    var el = document.querySelector(selector);
    return el ? el.textContent : null;
  }

  /** Re-anchors a fixture record to a real node with 1C's real mint. */
  function place(item, selector) {
    var el = document.querySelector(selector);
    if (!el) throw new Error("replay-boot: no element matches " + selector);
    var ref = anchor.mint({ element: el, root: document.body });
    if (!ref.ok) {
      // Deliberately loud. A fixture page whose regions cannot be anchored
      // would make every replay assertion on it meaningless.
      throw new Error(
        "replay-boot: could not mint an anchor for " + selector + ": " + JSON.stringify(ref.failure)
      );
    }
    item[record.FIELD.REGION] = { ref: ref, label: selector, lost: null };
    items.push(item);
    byRegion[selector] = item;
    rail.upsertCard(item);
    return item;
  }

  // Region A: the one the reviewer edits. Its `after` is written at commit time
  // from what they actually typed.
  place(
    fixtures.edit({
      before: textOf("#region-a"),
      after: textOf("#region-a"),
      before_html: document.querySelector("#region-a").innerHTML,
      after_html: document.querySelector("#region-a").innerHTML,
      change: "the reviewer is still typing"
    }),
    "#region-a"
  );

  // Region B: reworded TWICE, so the earlier `after` is neither the current
  // `after` nor the `before`. This is branch three's only honest fixture.
  place(
    fixtures.editRewordedTwice({
      before: textOf("#region-b"),
      before_html: document.querySelector("#region-b").innerHTML
    }),
    "#region-b"
  );

  place(
    fixtures.edit({
      before: textOf("#region-c"),
      after: "Marcus is resting completely on Thursday.",
      before_html: document.querySelector("#region-c").innerHTML,
      after_html: "Marcus is resting completely on Thursday."
    }),
    "#region-c"
  );

  place(
    fixtures.formatOnly({
      before: textOf("#region-format"),
      after: textOf("#region-format"),
      before_html: "This part matters.",
      after_html: "This part <strong>matters</strong>."
    }),
    "#region-format"
  );

  place(
    fixtures.deletion({
      before: textOf("#region-delete"),
      before_html: document.querySelector("#region-delete").innerHTML
    }),
    "#region-delete"
  );

  // Two identical blocks with identical context on both sides. The anchor
  // cannot tell them apart, and failing closed is the required behavior.
  var twin = fixtures.edit({
    before: textOf("#region-twin-1"),
    after: "Two clients still owe you an answer on the invite.",
    before_html: document.querySelector("#region-twin-1").innerHTML,
    after_html: "Two clients still owe you an answer on the invite."
  });
  twin[record.FIELD.REGION] = {
    // Minted against a page that had only one of them, which is the real
    // sequence: the reviewer commented, then the page grew a duplicate.
    ref: mintAgainstOneTwin(),
    label: "#region-twin-1",
    lost: null
  };
  items.push(twin);
  byRegion["#region-twin-1"] = twin;
  rail.upsertCard(twin);

  function mintAgainstOneTwin() {
    var second = document.querySelector("#region-twin-2");
    var parent = second.parentNode;
    var lead = document.querySelector("#twin-lead-2");
    var tail = document.querySelector("#twin-tail-2");
    // Take the duplicate out, mint, put it back exactly where it was.
    var marker = document.createComment("twin");
    parent.replaceChild(marker, second);
    parent.removeChild(lead);
    parent.removeChild(tail);
    var ref = anchor.mint({ element: document.querySelector("#region-twin-1"), root: document.body });
    parent.insertBefore(lead, marker);
    parent.replaceChild(second, marker);
    parent.insertBefore(tail, second.nextSibling);
    if (!ref.ok) throw new Error("replay-boot: the twin fixture could not mint: " + JSON.stringify(ref.failure));
    return ref;
  }

  // A record whose subject the page removes entirely: zero matches.
  place(
    fixtures.edit({
      before: textOf("#region-outside"),
      after: "This block is outside every repaint target and stays that way.",
      before_html: document.querySelector("#region-outside").innerHTML,
      after_html: "This block is outside every repaint target and stays that way."
    }),
    "#region-outside"
  );

  // ---------------------------------------------------------------------------
  // Wiring replay
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

  // A repaint is a reason to replay. So is any mutation the tool did not make;
  // schedule() refuses while the write epoch is open, which is what stops
  // replay's own writes from scheduling replay.
  document.addEventListener("lahe:repainted", function () {
    replay.schedule(replay.REASON.REMOUNT, { immediate: true });
  });

  var observer = new MutationObserver(function () {
    replay.schedule(replay.REASON.MUTATION);
  });
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });

  // ---------------------------------------------------------------------------
  // What the spec reads and drives
  // ---------------------------------------------------------------------------

  function safeItem(item) {
    return JSON.parse(JSON.stringify(item));
  }

  function safeSummary(summary) {
    // The summary carries live nodes and the records themselves; neither
    // survives the wire, and neither is what a test asserts on.
    return {
      reason: summary.reason,
      epoch: summary.epoch,
      wrote: summary.wrote,
      skipped: summary.skipped,
      conflicts: summary.conflicts,
      lost: summary.lost,
      steps: summary.steps.map(function (s) {
        return { step: s.step, ran: s.ran };
      }),
      results: summary.results.map(function (r) {
        return {
          id: r.item[record.FIELD.ID],
          region: r.item[record.FIELD.REGION].label,
          branch: r.branch,
          wrote: r.wrote,
          lost: r.lost,
          reason: r.reason
        };
      })
    };
  }

  var standIn = {
    /**
     * 2B's protection, standing in. BOTH halves, because they are two different
     * things: the repaint engine's cooperative-skip attribute keeps the
     * framework's hands off the block, and protect.mark is what replay asks
     * before it writes anywhere.
     */
    protectRegion: function (selector) {
      var el = document.querySelector(selector);
      el.setAttribute("data-lahe-permanent", "");
      el.setAttribute("contenteditable", "true");
      protect.mark(el, { reason: "the reviewer is editing" });
      return true;
    },

    /** 2A's commit, standing in: the record's next revision is what is on screen. */
    commit: function (selector) {
      var el = document.querySelector(selector);
      var item = byRegion[selector];
      var next = record.bumpRev(item, { after: el.textContent, after_html: el.innerHTML });
      items[items.indexOf(item)] = next;
      byRegion[selector] = next;
      rail.upsertCard(next);
      return safeItem(next);
    },

    /** Protection lifts, and replay runs immediately on the block. 2C's seam. */
    release: function (selector) {
      var el = document.querySelector(selector);
      protect.release(el);
      el.removeAttribute("contenteditable");
      var outcome = replay.applyRecord(byRegion[selector], { element: el });
      return {
        branch: outcome.branch,
        wrote: outcome.wrote,
        lost: outcome.lost,
        reason: outcome.reason
      };
    }
  };

  window.__laheReplay = {
    reviewId: reviewId,
    standIn: standIn,

    /** One pass, synchronously, with a reason from the enum. */
    pass: function (reason) {
      return safeSummary(replay.runPass(reason || replay.REASON.MANUAL));
    },

    text: textOf,
    exists: function (selector) {
      return !!document.querySelector(selector);
    },

    /** The page (or the agent that just landed a change) writing its own text. */
    rewrite: function (selector, text) {
      var el = document.querySelector(selector);
      if (!el) throw new Error("rewrite: no element matches " + selector);
      el.textContent = text;
      return el.textContent;
    },

    /** The page removing a block outright, which is how a subject goes missing. */
    removeBlock: function (selector) {
      var el = document.querySelector(selector);
      if (!el) return false;
      el.parentNode.removeChild(el);
      return true;
    },

    items: function () {
      return items.map(safeItem);
    },
    itemFor: function (selector) {
      return byRegion[selector] ? safeItem(byRegion[selector]) : null;
    },
    /** Every record as one string, for the byte-identical assertions. */
    snapshot: function (except) {
      var skip = except || [];
      return items
        .filter(function (item) {
          return skip.indexOf(item[record.FIELD.REGION].label) === -1;
        })
        .map(function (item) {
          return JSON.stringify(item);
        })
        .join("\n");
    },

    /** What the reviewer's card is showing. The rail is a closed shadow root. */
    card: function (selector) {
      var item = byRegion[selector];
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
    }
  };
})();
