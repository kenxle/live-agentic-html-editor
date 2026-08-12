// The replay engine: entry point and caller ordering.
//
// Owner: Task 2B. STUB: schedule() and runPass() are real signatures and a
// working no-op. The counters are real from Phase 0, because the plan's tests
// read them (test 1 asserts the replay-pass counter incremented at least five
// times; test 13 asserts idempotence as no second write) and a counter that
// only appears in Phase 2 means those tests cannot be written first.
//
// What 2B fills in is the body of applyRecord(). Everything above it, the
// ordering, the epoch discipline, the counters, is settled here so five callers
// do not each invent a scheduling policy.
//
// ---------------------------------------------------------------------------
// The ordering inside one pass. This is architecture D7's ordering rule plus
// what has to happen around it.
// ---------------------------------------------------------------------------
//
//   1. Drain lifecycle first: acks before replay. An item the agent applied is
//      retired BEFORE the repaint its own change caused. Otherwise replay
//      stamps the reviewer's wording back over a fix that landed and reports a
//      collision that is not one.
//   2. Reconcile the store against the service projection, lifecycle winning
//      per rev.
//   3. Retire applied items: drop their highlights, move them to Completed.
//   4. Re-resolve the region reference of every outstanding record. Identity is
//      minted once and re-resolved every pass; a repaint destroys anything
//      stored on the node.
//   5. Apply committed records under D3, skipping protected regions.
//   6. Update the rail in place. Never re-create a card that holds focus.
//
// Honest note for 3A: in a host page the agent's source write arrives as a
// morph seconds before the ack does, so a provisional collision may show and
// then clear when the ack explains it. That is the truth about the ordering,
// not a bug to hide.
//
// ---------------------------------------------------------------------------
// Callers, and the reason each one schedules a pass.
// ---------------------------------------------------------------------------
//
// Every caller passes a REASON from the enum. A pass with no reason is refused,
// because "who scheduled this" is the first question every replay bug asks.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.replay = factory(root.LAHE.epoch, root.LAHE.uniqueness, root.LAHE.normalize);
  } else {
    module.exports = factory(
      require("../shared/epoch.js"),
      require("../shared/uniqueness.js"),
      require("../shared/normalize.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (epoch, uniqueness, normalize) {
  "use strict";

  var REASON = {
    REMOUNT: "remount", // turbo:morph, turbo:load, popstate
    MUTATION: "mutation", // the MutationObserver saw the page change
    LIFECYCLE: "lifecycle", // an ack or a projection update arrived
    UNDO: "undo", // the reviewer undid an item. Law 3: not ambient
    MANUAL: "manual", // the reviewer asked for a refresh
    BOOT: "boot" // first pass after the layer loads
  };
  var REASONS = Object.keys(REASON).map(function (k) {
    return REASON[k];
  });

  // Ordered. Index 0 runs first.
  var PASS_ORDER = [
    { step: "drain_lifecycle", why: "D7: acks are processed before replay, so an applied item is retired first" },
    { step: "reconcile_store", why: "D6: lifecycle wins per rev; a newer revision survives as outstanding" },
    { step: "retire_applied", why: "R57: applied items lose their highlight and move to Completed" },
    { step: "resolve_regions", why: "identity is re-resolved every pass; a repaint destroys anything on the node" },
    { step: "apply_records", why: "D3: the three-way comparison, protected regions skipped, groups atomic" },
    { step: "update_rail", why: "D14: in place, and a card holding focus is never re-created" }
  ];

  // The counters the tests read. Public and stable from Phase 0.
  var counters = {
    passes: 0, // how many passes have run
    regionsWritten: 0, // how many regions replay actually wrote
    regionsSkippedProtected: 0,
    regionsSkippedEqual: 0, // already applied: the idempotence path
    regionsUnplaceable: 0, // failed Law 1, text kept, card says so
    groupsRefused: 0 // an atomic group where one member failed Law 1
  };

  function resetCounters() {
    Object.keys(counters).forEach(function (k) {
      counters[k] = 0;
    });
  }

  var scheduled = null;
  var lastReason = null;

  /**
   * Schedules a pass. Coalescing is deliberate: five callers can fire inside
   * one morph and the reviewer should get one pass, not five.
   *
   * @param {string} reason one of REASON
   * @param {Object} options {immediate: boolean}
   */
  function schedule(reason, options) {
    if (REASONS.indexOf(reason) === -1) {
      throw new Error(
        "replay.schedule: reason must be one of " + REASONS.join(", ") + ", got " + String(reason)
      );
    }
    // The write-epoch rule. Replay's own mutations must not schedule replay.
    if (epoch.isWriting()) {
      epoch.shared.noteExternalMutation();
      return false;
    }
    lastReason = reason;
    var opts = options || {};
    if (opts.immediate) {
      runPass(reason);
      return true;
    }
    if (scheduled) return true;
    scheduled = defer(function () {
      scheduled = null;
      runPass(reason);
    });
    return true;
  }

  function defer(fn) {
    if (typeof requestAnimationFrame === "function") return requestAnimationFrame(fn);
    return setTimeout(fn, 0);
  }

  /**
   * Runs one pass. STUB: counts the pass, runs no steps, writes nothing.
   *
   * 2B replaces the body with the PASS_ORDER steps. The counter increment and
   * the epoch wrapper stay.
   *
   * @param {string} reason
   * @returns {Object} a summary of what the pass did
   */
  function runPass(reason) {
    counters.passes += 1;
    return {
      reason: reason || lastReason,
      epoch: epoch.epoch(),
      wrote: 0,
      skipped: 0,
      isStub: true
    };
  }

  /**
   * D3's three-way comparison, against the record rather than against history.
   * This one IS implemented in Phase 0, because it is a pure function of three
   * strings, every branch of it is a named requirement, and two builders would
   * otherwise write two versions.
   *
   *   equals after   already applied. Skip. This is what makes replay idempotent
   *   equals before  the page re-rendered the same content. Re-apply
   *   equals neither the content genuinely changed. Write nothing, say so
   *
   * @param {string} domText the region's current text
   * @param {string} before the record's before
   * @param {string} after the record's after
   * @returns {string} "skip_already_applied" | "reapply" | "content_changed"
   */
  function compareToRecord(domText, before, after) {
    var d = normalize.normalizeText(domText);
    if (typeof after === "string" && d === normalize.normalizeText(after)) return "skip_already_applied";
    if (typeof before === "string" && d === normalize.normalizeText(before)) return "reapply";
    return "content_changed";
  }

  var COMPARISON = {
    SKIP_ALREADY_APPLIED: "skip_already_applied",
    REAPPLY: "reapply",
    CONTENT_CHANGED: "content_changed"
  };

  /**
   * Applies one committed record. STUB: writes nothing and reports it.
   *
   * 2B's contract for this function:
   *  - refuse when the region is protected (the reviewer is in it right now)
   *  - refuse when uniqueness.selectUnique does not bind
   *  - branch on compareToRecord
   *  - every DOM write happens inside epoch.write("replay", ...)
   *  - a record in a group only writes when every member of the group binds
   */
  function applyRecord(item, context) {
    void item;
    void context;
    return { wrote: false, reason: "stub", code: null };
  }

  return {
    REASON: REASON,
    REASONS: REASONS,
    PASS_ORDER: PASS_ORDER,
    COMPARISON: COMPARISON,
    counters: counters,
    resetCounters: resetCounters,
    schedule: schedule,
    runPass: runPass,
    compareToRecord: compareToRecord,
    applyRecord: applyRecord,
    uniqueness: uniqueness,
    isStub: true
  };
});
