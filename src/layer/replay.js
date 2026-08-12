// The replay engine: entry point, pass ordering, counters, and the four-branch
// compare.
//
// Owner: 2C. STUB committed by 0A-kernel: schedule() and runPass() are real
// signatures and a working no-op, and THE COUNTERS ARE REAL FROM PHASE 0,
// because the ranked tests read them (test 1 asserts the pass counter
// incremented at least five times; test 8 asserts idempotence as the absence of
// a second write) and a counter that only appears in Phase 2 means those tests
// cannot be written first.
//
// What 2C fills in is the body of applyRecord() and the DOM half of a pass.
// Everything above it, the ordering, the epoch discipline, the counters, and
// the compare, is settled here so five callers do not each invent a scheduling
// policy.
//
// ---------------------------------------------------------------------------
// The four branches (D7). Never guessing.
// ---------------------------------------------------------------------------
//
//   1. The DOM already matches the current `after`: do nothing. Idempotent.
//   2. It matches `before`: apply the edit again.
//   3. It matches an EARLIER revision's `after`, read from the record's
//      applied-history: an old version landed somewhere, so re-apply the
//      current revision and say on the card that an earlier version had landed.
//   4. It matches none of these: the content changed underneath the reviewer,
//      so flag it on the card and WRITE NOTHING (R5). The conflict card shows
//      both versions in full and the reviewer picks which one stands.
//
// Branch three is the one a builder skips. Without the applied-`after` history
// on the record (0A-kernel's field), a two-rewording case falls into branch
// four and flags a collision that is not one.
//
// A format-only record compares on STRUCTURE rather than on normalized text,
// through the one normalizer's second mode. A delete is idempotent by absence.
//
// ---------------------------------------------------------------------------
// The ordering inside one pass.
// ---------------------------------------------------------------------------
//
//   1. Fold replies first: a reply before replay. An item the agent handled is
//      retired BEFORE the repaint its own change caused. Otherwise replay
//      stamps the reviewer's wording back over a fix that landed and reports a
//      collision that is not one.
//   2. Merge the store against the helper's state, through shared/merge.js:
//      browser wins on content, store wins on lifecycle per revision.
//   3. Retire handled items: drop their highlights, move them to the Done tab.
//   4. Re-resolve the anchor of every outstanding record. Identity is minted
//      once and re-resolved every pass; a repaint destroys anything stored on
//      the node.
//   5. Apply committed records, skipping protected regions (D7's first half).
//   6. Update the rail in place. Never re-create a card that holds focus.
//
// Honest note for 3A: in a host page the agent's source write arrives as a
// morph seconds before the reply does, so a provisional collision may show and
// then clear when the reply explains it. That is the truth about the ordering,
// not a bug to hide.
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
    root.LAHE.replay = factory(root.LAHE.epoch, root.LAHE.uniqueness, root.LAHE.normalize, root.LAHE.record);
  } else {
    module.exports = factory(
      require("../shared/epoch.js"),
      require("../shared/uniqueness.js"),
      require("../shared/normalize.js"),
      require("../shared/record.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (epoch, uniqueness, normalize, record) {
  "use strict";

  var REASON = {
    REMOUNT: "remount", // a morph, a load, a popstate, a bfcache restore
    MUTATION: "mutation", // the MutationObserver saw the page change
    REPLY: "reply", // a reply arrived and was folded
    COMMIT: "commit", // an edit committed and protection lifted
    UNDO: "undo", // the reviewer undid one record
    MANUAL: "manual", // the reviewer asked for a refresh
    BOOT: "boot" // first pass after the library loads
  };
  var REASONS = Object.keys(REASON).map(function (k) {
    return REASON[k];
  });

  // Ordered. Index 0 runs first.
  var PASS_ORDER = [
    { step: "fold_replies", why: "D7: replies are folded before replay, so a handled item is retired first" },
    { step: "merge_store", why: "D5: browser wins on content, store wins on lifecycle per revision" },
    { step: "retire_handled", why: "R37: handled items lose their highlight and move to the Done tab" },
    { step: "resolve_anchors", why: "identity is re-resolved every pass; a repaint destroys anything on the node" },
    { step: "apply_records", why: "D7: the four-branch compare, protected regions skipped" },
    { step: "update_rail", why: "D10: in place, and a card holding focus is never re-created" }
  ];

  // The counters the tests read. Public and stable from Phase 0.
  var counters = {
    passes: 0, // how many passes have run
    regionsWritten: 0, // how many regions replay actually wrote
    regionsSkippedProtected: 0,
    regionsSkippedEqual: 0, // branch one: the idempotence path
    regionsEarlierRevision: 0, // branch three
    regionsConflicted: 0, // branch four: flagged, nothing written
    regionsLost: 0 // the anchor bound to zero matches, or to more than one
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
   * 2C replaces the body with the PASS_ORDER steps. The counter increment and
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

  // ---------------------------------------------------------------------------
  // The compare. Implemented in Phase 0, not stubbed.
  // ---------------------------------------------------------------------------
  //
  // It is a pure function of a record and the region's current text, every
  // branch of it is a named requirement, and two builders would otherwise write
  // two versions of it. The DOM work around it is 2C's; the decision is not.

  var BRANCH = {
    ALREADY_APPLIED: "already_applied", // 1
    REAPPLY: "reapply", // 2
    EARLIER_REVISION: "earlier_revision", // 3
    CONTENT_CHANGED: "content_changed" // 4
  };
  var BRANCHES = [BRANCH.ALREADY_APPLIED, BRANCH.REAPPLY, BRANCH.EARLIER_REVISION, BRANCH.CONTENT_CHANGED];

  /**
   * Which of the four branches this region is in.
   *
   * @param {Object} item the record
   * @param {string} domText the region's current text (or markup, for a
   *                 format-only record, which compares on structure)
   * @returns {Object} {branch, earlierAfter}
   */
  function compare(item, domText) {
    var mode = record.comparisonMode(item);
    var F = record.FIELD;
    // A format-only record compares on its MARKUP fields: its `after` text is
    // identical to its `before` by construction, so comparing text would make
    // this whole branch a silent no-op.
    var fields = record.comparisonFields(item);

    // A delete is idempotent by absence: the block gone is applied, the block
    // back is re-applied. The caller passes null for a region that is not in
    // the document.
    if (item[F.KIND] === record.KIND.DELETE) {
      if (domText === null || domText === undefined) {
        return { branch: BRANCH.ALREADY_APPLIED, earlierAfter: null };
      }
      if (typeof item[F.BEFORE] === "string" && normalize.equalsInMode(mode, domText, item[F.BEFORE])) {
        return { branch: BRANCH.REAPPLY, earlierAfter: null };
      }
      return { branch: BRANCH.CONTENT_CHANGED, earlierAfter: null };
    }

    if (typeof domText !== "string") {
      throw new TypeError("replay.compare: domText must be a string for a " + item[F.KIND] + " record");
    }

    if (typeof item[fields.after] === "string" && normalize.equalsInMode(mode, domText, item[fields.after])) {
      return { branch: BRANCH.ALREADY_APPLIED, earlierAfter: null };
    }
    if (typeof item[fields.before] === "string" && normalize.equalsInMode(mode, domText, item[fields.before])) {
      return { branch: BRANCH.REAPPLY, earlierAfter: null };
    }

    // Branch three. Every `after` this record has had, other than the current
    // one, read from the applied history the record carries.
    var priors = record.priorAfters(item, fields.after);
    for (var i = 0; i < priors.length; i += 1) {
      if (normalize.equalsInMode(mode, domText, priors[i])) {
        return { branch: BRANCH.EARLIER_REVISION, earlierAfter: priors[i] };
      }
    }

    return { branch: BRANCH.CONTENT_CHANGED, earlierAfter: null };
  }

  // What the card says when branch three fires. Written once here so the
  // message a test asserts and the message the reviewer reads are the same
  // string.
  var EARLIER_REVISION_MESSAGE = "An earlier version of this edit had already landed. Your current version was re-applied.";

  /**
   * Applies one committed record. STUB: writes nothing and reports it.
   *
   * 2C's contract for this function:
   *  - refuse when the region is protected (the reviewer is in it right now)
   *  - refuse when the anchor does not bind uniquely, and surface it as lost
   *  - branch on compare(), and write nothing at all on branch four
   *  - every DOM write happens inside epoch.write("replay", ...)
   *  - every path increments the counter that names it
   */
  function applyRecord(item, context) {
    void item;
    void context;
    return { wrote: false, branch: null, reason: "stub" };
  }

  return {
    REASON: REASON,
    REASONS: REASONS,
    PASS_ORDER: PASS_ORDER,
    BRANCH: BRANCH,
    BRANCHES: BRANCHES,
    EARLIER_REVISION_MESSAGE: EARLIER_REVISION_MESSAGE,
    counters: counters,
    resetCounters: resetCounters,
    schedule: schedule,
    runPass: runPass,
    compare: compare,
    applyRecord: applyRecord,
    uniqueness: uniqueness,
    isStub: true
  };
});
