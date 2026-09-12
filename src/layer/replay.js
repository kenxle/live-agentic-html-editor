// The replay engine: entry point, pass ordering, counters, and the four-branch
// compare.
//
// Owner: 2C. The signatures, the pass ordering, the epoch discipline and the
// counters are 0A-kernel's and did not move. What 2C filled in is the body of
// applyRecord() and the DOM half of a pass: resolving every outstanding
// record's anchor against the document as it is right now, branching, writing
// through the epoch, and telling the reviewer on the card when it did not
// write.
//
// THE COUNTERS ARE REAL FROM PHASE 0, because the ranked tests read them (test
// 1 asserts the pass counter incremented at least five times; test 8 asserts
// idempotence as the absence of a second write) and a counter that only
// appeared in Phase 2 would mean those tests could not be written first.
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
// Branch two has a second door into it: a page state the reviewer already
// answered with "Keep mine" (region.accepted_page_texts, in record.js). Their
// decision is not re-litigated every time the page renders itself from a source
// that still disagrees, so that state is branch-two-equivalent and the current
// `after` is re-applied. See resolveConflict.
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
    root.LAHE.replay = factory(
      root.LAHE.epoch,
      root.LAHE.uniqueness,
      root.LAHE.normalize,
      root.LAHE.record,
      root.LAHE.failures,
      root.LAHE.anchor,
      root.LAHE.protect,
      root.LAHE.markers,
      root.LAHE.pointing,
      root.LAHE.highlight
    );
  } else {
    module.exports = factory(
      require("../shared/epoch.js"),
      require("../shared/uniqueness.js"),
      require("../shared/normalize.js"),
      require("../shared/record.js"),
      require("../shared/failures.js"),
      require("./anchor.js"),
      require("./protect.js"),
      require("../shared/markers.js"),
      require("./pointing.js"),
      require("./highlight.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  epoch,
  uniqueness,
  normalize,
  record,
  failures,
  anchorEngine,
  protectModule,
  markers,
  pointingModule,
  highlightModule
) {
  "use strict";

  var REASON = {
    REMOUNT: "remount", // a morph, a load, a popstate, a bfcache restore
    MUTATION: "mutation", // the MutationObserver saw the page change
    REPLY: "reply", // a reply arrived and was folded
    COMMIT: "commit", // an edit committed and protection lifted
    UNDO: "undo", // the reviewer undid one record
    MANUAL: "manual", // the reviewer asked for a refresh
    BOOT: "boot", // first pass after the library loads
    SETTLE: "settle" // the recheck that closes the settling window after a load
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
    regionsLost: 0, // the anchor bound to zero matches, or to more than one
    regionsLostDeferred: 0, // a lost verdict held back while the page was still settling
    regionsLostCleared: 0, // a later pass found the anchor, so the lost state ended
    regionsProbable: 0, // a lost comment was pointed at its probable place instead
    regionsProbableCleared: 0 // a later pass found it for certain, so the guess ended
  };

  function resetCounters() {
    Object.keys(counters).forEach(function (k) {
      counters[k] = 0;
    });
  }

  var scheduled = null;
  var lastReason = null;

  // ---------------------------------------------------------------------------
  // The settling window: a page that is still rendering itself
  // ---------------------------------------------------------------------------
  //
  // A reviewed page routinely finishes drawing itself well after load. Mermaid
  // replaces whole sections with rendered diagrams, a chart library swaps a
  // placeholder for a figure, a framework hydrates. An anchor resolved in that
  // gap binds to nothing through no fault of the record, and the reviewer gets
  // told their passage is gone while they are looking straight at it (reported
  // live on 2026-08-17, after the auto-reload work made a reload routine).
  //
  // So for a short window after a load or a remount, a lost verdict is DEFERRED
  // rather than surfaced: nothing is stamped on the record and nothing is put on
  // the card, and one recheck pass is armed for the end of the window. A passage
  // that is genuinely gone is still flagged, about a second later than before.
  // The window is not a silence: the outcome says `deferred`, and the summary
  // counts it, so "why did this pass not flag anything" has an answer.
  var SETTLE_MS = 2000;

  // The recheck is a little past the end of the window, so the pass it runs is
  // the first one the window no longer defers.
  var SETTLE_RECHECK_SLACK_MS = 50;

  var settleUntil = 0;
  var settleTimer = null;

  /** A load or a remount: the page may be about to rewrite itself. */
  function noteSettling(ms) {
    var span = typeof ms === "number" ? ms : SETTLE_MS;
    // Zero (or less) closes the window rather than extending it, which is how a
    // test says "the page has finished" without waiting out the clock.
    if (span <= 0) {
      settleUntil = 0;
      return settleUntil;
    }
    var until = Date.now() + span;
    if (until > settleUntil) settleUntil = until;
    return settleUntil;
  }

  function isSettling() {
    return Date.now() < settleUntil;
  }

  // One timer, however many records deferred inside the window.
  function armSettleRecheck() {
    if (settleTimer !== null) return;
    if (typeof setTimeout !== "function") return;
    var wait = settleUntil - Date.now() + SETTLE_RECHECK_SLACK_MS;
    settleTimer = setTimeout(function () {
      settleTimer = null;
      schedule(REASON.SETTLE, { immediate: true });
    }, wait > 0 ? wait : 0);
    // Node only, and only so a unit test's pending recheck does not hold the
    // process open. Browsers have no unref and do not need one.
    if (settleTimer && typeof settleTimer.unref === "function") settleTimer.unref();
  }

  // ---------------------------------------------------------------------------
  // The context: what a pass runs against
  // ---------------------------------------------------------------------------
  //
  // Replay does not own the store, the rail, or protection. It is handed them,
  // which is what lets 2C be built and tested against 0A-kernel's record
  // fixture generator without waiting on 2A, and what lets a unit test drive
  // the whole pass over a simulated DOM.
  //
  //   root      the document or element to resolve anchors in
  //   items     an array of records, or a function returning one
  //   cards     the rail's card API (1B's overlay). Only the four carriers are
  //             used: setCardNotice, setCardBadge, clearCardBadge,
  //             attachCardNode
  //   protect   2B's protection module. Replay asks isProtected and never writes
  //             into a region the reviewer is in
  //   anchor    the anchor engine. 1C's, unless a caller injects one
  //   document  where a conflict card's nodes are created
  //   editing   2A's editing surface, for ONE thing: the conflict card's "take
  //             the page's" button, which retires a record without writing to
  //             the page. Replay never edits through it and a missing one only
  //             costs that button
  //   persist   optional. Writes one record back to durable storage. Replay
  //             mutates records in place (the lost stamp, the accepted page
  //             states) and the items it is handed are a CACHE that any later
  //             merge replaces from the store, so a mutation nobody wrote down
  //             lives until the next remount and no longer. The reviewer's
  //             answer to a collision has to outlive that, so keep_mine writes
  //             through this. A caller that supplies none keeps the old
  //             memory-only behaviour, which is what the simulated-DOM unit
  //             tests run on
  //   hooks     one function per PASS_ORDER step that replay does not own:
  //             fold_replies, merge_store, retire_handled, update_rail. A
  //             missing hook is a no-op and is reported as one in the summary,
  //             never silently skipped
  //   pointing  the POINT ladder (1C's pointing.js), used for one thing: where
  //             a comment whose words are gone should point. It never places a
  //             write. Injected so a test can hand over a fake verdict
  //   highlights the paint surface (1D's highlight.js shared instance). Only
  //             the probable paint goes through it from here
  var context = {
    root: null,
    items: null,
    cards: null,
    protect: null,
    anchor: null,
    document: null,
    editing: null,
    persist: null,
    hooks: null,
    pointing: null,
    highlights: null
  };

  /** Write one record back to durable storage, when a caller gave us the seam. */
  function persistItem(ctx, item) {
    if (!ctx || typeof ctx.persist !== "function" || !item) return false;
    ctx.persist(item);
    return true;
  }

  // Finding 30: the wired product (src/layer/index.js) calls configure with NO
  // hooks, so fold_replies, merge_store, retire_handled and update_rail record
  // {ran:false} in the summary and run on their own independent schedules rather
  // than folded into the pass in PASS_ORDER. This is intended, not an oversight:
  // the "Honest note for 3A" at the top of this file anticipates exactly this in
  // a host page, where the agent's source write arrives as a morph seconds
  // before its reply, so replay may show a provisional collision that clears
  // when the reply is folded on its own schedule. The un-hooked order is the
  // truth about a live page, not a guarantee we silently dropped. (index.js's
  // configure call site wants a one-line pointer back here; the orchestrator
  // adds it at merge, since index.js is not this task's file.)
  function configure(next) {
    var patch = next || {};
    Object.keys(patch).forEach(function (key) {
      context[key] = patch[key];
    });
    return context;
  }

  function contextFor(override) {
    var merged = {};
    Object.keys(context).forEach(function (key) {
      merged[key] = context[key];
    });
    var patch = override || {};
    Object.keys(patch).forEach(function (key) {
      merged[key] = patch[key];
    });
    if (!merged.anchor) merged.anchor = anchorEngine;
    if (!merged.protect) merged.protect = protectModule;
    if (!merged.pointing) merged.pointing = pointingModule || null;
    if (!merged.document && typeof document !== "undefined") merged.document = document;
    if (!merged.root && merged.document) merged.root = merged.document;
    return merged;
  }

  function itemsIn(ctx) {
    var items = typeof ctx.items === "function" ? ctx.items() : ctx.items;
    return Array.isArray(items) ? items : [];
  }

  /**
   * Schedules a pass. Coalescing is deliberate: five callers can fire inside
   * one morph and the reviewer should get one pass, not five.
   *
   * @param {string} reason one of REASON
   * @param {Object} options {immediate: boolean, commit: Object}
   *   `commit` is the detail 2B's release() hands over on a commit:
   *   `{item, element, observed}`. It applies to exactly one record, the one
   *   named by `item`, and it is per-pass: nothing about it is remembered.
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
    // A load and a remount are the two moments the page starts drawing itself
    // again, so they open the settling window. See SETTLE_MS.
    if (reason === REASON.BOOT || reason === REASON.REMOUNT) noteSettling();
    lastReason = reason;
    var opts = options || {};
    var override = opts.commit ? { commit: opts.commit } : null;
    if (opts.immediate) {
      runPass(reason, override);
      return true;
    }
    if (scheduled) return true;
    scheduled = defer(function () {
      scheduled = null;
      runPass(reason, override);
    });
    return true;
  }

  // How long a deferred pass may wait on a frame that may never come. Long
  // enough that a painting page always runs its pass on the frame (one frame is
  // ~16ms) and the timer is the loser of the race; short enough that a page
  // nobody is painting still catches up while the reviewer's own commit or undo
  // is the thing waiting on it.
  var FRAME_FALLBACK_MS = 50;

  /**
   * Defer one pass to the next frame, WITH A TIMER ALONGSIDE IT.
   *
   * requestAnimationFrame alone is wrong, and it is wrong in production, not
   * only in a test. A browser that is not painting the page throttles rAF to
   * nothing: a backgrounded tab, a hidden window, a headless lane running six
   * workers wide. On such a page every deferred pass simply never runs, which
   * means an edit the reviewer committed is never re-applied, a reply that
   * arrived is never folded, and the page they come back to is stale. 2B found
   * this as a 30-second test hang on the WebKit lane and worked around it in
   * their spec glue with {immediate: true}; the product-side answer is here, so
   * no caller has to know.
   *
   * The frame is still preferred: a pass that writes to the page belongs on a
   * frame, and on any page that is painting the rAF callback wins the race by a
   * wide margin. The timer only ever fires on a page that stopped painting, and
   * whichever one gets there first cancels the other, so the pass runs exactly
   * once either way.
   */
  // The microtask defer used to run an owed pass AFTER the write epoch closes.
  // Injectable through nothing on purpose: it is the same primitive the epoch
  // uses to schedule its own close, so an owed pass queued here always runs
  // after the epoch's depth has unwound.
  var deferMicrotask =
    typeof queueMicrotask === "function"
      ? queueMicrotask
      : function (fn) {
          Promise.resolve().then(fn);
        };

  /**
   * Finding 9: consume the "a pass is owed" flag the epoch remembers.
   *
   * A genuine repaint can land in the same microtask batch as one of replay's
   * own writes. The observer early-returns while the write epoch is open and
   * only records that a pass is owed (epoch.noteExternalMutation). That seam was
   * written and never consumed, so a committed edit the repaint reverted sat
   * un-reapplied until some later unrelated mutation happened to schedule a
   * pass. This runs the owed pass instead.
   *
   * The take happens INSIDE the microtask, never synchronously here: the
   * observer's own noteExternalMutation is itself a microtask queued during this
   * pass's writes and has not run yet, and the epoch's depth is still non-zero
   * until its deferred close runs. Both settle before this microtask, so the
   * flag reads true when it should and schedule() is accepted rather than
   * refused (a refusal would only re-arm the flag we just took, and nobody would
   * run it).
   */
  function scheduleOwedPass() {
    deferMicrotask(function () {
      if (!epoch.shared || typeof epoch.shared.takePendingExternal !== "function") return;
      if (epoch.shared.takePendingExternal()) schedule(REASON.MUTATION);
    });
  }

  function defer(fn) {
    var done = false;
    var frame = null;
    var timer = null;

    function run() {
      if (done) return;
      done = true;
      if (frame !== null && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
      if (timer !== null) clearTimeout(timer);
      fn();
    }

    if (typeof requestAnimationFrame === "function") frame = requestAnimationFrame(run);
    timer = setTimeout(run, frame === null ? 0 : FRAME_FALLBACK_MS);
    return timer;
  }

  /**
   * Runs one pass, in PASS_ORDER.
   *
   * The pass counter increments FIRST and unconditionally, before anything can
   * throw or decide to do nothing. A test that asserts "replay ran and chose
   * not to write" is only meaningful if the count is the count of passes, not
   * the count of passes that got somewhere.
   *
   * @param {string} reason one of REASON
   * @param {Object} [override] a context for this pass only. See `context`
   * @returns {Object} a summary of what the pass did
   */
  function runPass(reason, override) {
    counters.passes += 1;
    var ctx = contextFor(override);
    var hooks = ctx.hooks || {};
    var summary = {
      reason: reason || lastReason,
      epoch: epoch.epoch(),
      steps: [],
      wrote: 0,
      skipped: 0,
      conflicts: 0,
      lost: 0,
      results: []
    };

    for (var i = 0; i < PASS_ORDER.length; i += 1) {
      var step = PASS_ORDER[i].step;
      if (step === "resolve_anchors") {
        // Not a step of its own here: an anchor resolved in one step and
        // written in the next is an anchor resolved against a document the
        // write itself has already changed. Each record resolves and applies
        // together, inside apply_records.
        summary.steps.push({ step: step, ran: true, note: "resolved per record, in apply_records" });
        continue;
      }
      if (step === "apply_records") {
        var items = itemsIn(ctx);
        for (var j = 0; j < items.length; j += 1) {
          var outcome = applyRecord(items[j], ctx);
          summary.results.push(outcome);
          if (outcome.wrote) summary.wrote += 1;
          else summary.skipped += 1;
          if (outcome.branch === BRANCH.CONTENT_CHANGED) summary.conflicts += 1;
          if (outcome.lost) summary.lost += 1;
        }
        summary.steps.push({ step: step, ran: true, records: items.length });
        continue;
      }
      if (typeof hooks[step] === "function") {
        hooks[step](ctx, summary);
        summary.steps.push({ step: step, ran: true });
      } else {
        // Reported rather than silent. "Which steps did this pass actually
        // run" is the second question every replay bug asks.
        summary.steps.push({ step: step, ran: false, why: "no hook supplied" });
      }
    }

    lastSummary = summary;
    // Finding 9: run any pass a colliding repaint owed but that the observer
    // could only remember while replay's own write epoch was open.
    scheduleOwedPass();
    return summary;
  }

  var lastSummary = null;

  function lastPass() {
    return lastSummary;
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
   * @param {string} [domHtml] the region's current markup, when the caller
   *                 holds it. Only read to answer the formatting question
   *                 below; a caller without it gets the text comparison alone
   * @returns {Object} {branch, earlierAfter}
   */
  function compare(item, domText, domHtml) {
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
      if (matchesAcceptedPageState(item, mode, domText)) {
        return { branch: BRANCH.REAPPLY, earlierAfter: null, accepted: true };
      }
      return { branch: BRANCH.CONTENT_CHANGED, earlierAfter: null };
    }

    if (typeof domText !== "string") {
      throw new TypeError("replay.compare: domText must be a string for a " + item[F.KIND] + " record");
    }

    if (typeof item[fields.after] === "string" && normalize.equalsInMode(mode, domText, item[fields.after])) {
      // The words are the reviewer's. The EMPHASIS still might not be, and the
      // text comparison above is built to ignore exactly that.
      if (formattingLost(item, domHtml)) {
        return { branch: BRANCH.REAPPLY, earlierAfter: null, formatting: true };
      }
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

    // A page state the reviewer already answered with "Keep mine". Their
    // decision stands until they change it, so this is branch two: re-apply the
    // current `after` and raise nothing. Without it the reviewer's answer lives
    // exactly one pass on any page that still renders the agent's sentence from
    // its own source, which is every live page.
    if (matchesAcceptedPageState(item, mode, domText)) {
      return { branch: BRANCH.REAPPLY, earlierAfter: null, accepted: true };
    }

    return { branch: BRANCH.CONTENT_CHANGED, earlierAfter: null };
  }

  // ---------------------------------------------------------------------------
  // The formatting half of branch one (2026-09-11)
  // ---------------------------------------------------------------------------
  //
  // An edit compares on TEXT, which is right for wording and blind to the one
  // thing normalizeText exists to ignore. The reviewer made a word italic and a
  // clause bold inside a rewrite; the agent carried the words into a Markdown
  // source and not the emphasis; the rebuilt page came back with the right
  // words in plain type; and this compare read the text, called it idempotent
  // and wrote nothing. The reviewer's formatting was gone from the page and
  // nothing anywhere said so.
  //
  // WHAT IS COMPARED: the bold and italic runs the record's after_html asks
  // for, read through normalize.emphasisRuns, whose vocabulary is the closed
  // list strong, em, not-bold, not-italic. A run is on the page when the page
  // has the same tag over the same words; a not-bold or not-italic run is on
  // the page when the page does NOT have that emphasis over those words, which
  // is what the reset tags mean.
  //
  // WHAT IS IGNORED: everything else in the markup. Links, spans, code, the
  // page's own classes and attributes, whitespace, and the way a framework
  // reserialized the block are all dropped by the same key. So is emphasis the
  // page has and the record never asked for: a page that adds its own <em> is
  // rendering, not losing anything, and writing over it every pass would be the
  // fight this tool exists to remove.
  //
  // ONE GUARD BEYOND THAT: writeRegion only uses after_html while it still says
  // the record's after text (markupSaysAfter). Asking for a write the writer
  // will not make is a pass that re-decides the same thing forever.
  function formattingLost(item, domHtml) {
    if (typeof domHtml !== "string") return false;
    if (!item || item[record.FIELD.KIND] !== record.KIND.EDIT) return false;
    if (!markupSaysAfter(item)) return false;
    return missingEmphasis(item[record.FIELD.AFTER_HTML], domHtml);
  }

  // Which emphasis tag each reset tag denies.
  var DENIES = {};
  DENIES[normalize.NOT_BOLD_TAG] = "strong";
  DENIES[normalize.NOT_ITALIC_TAG] = "em";

  /**
   * Does `html` fail to say what `afterHtml` says about bold and italic?
   *
   * Asymmetric on purpose, per the note above: only the runs after_html asks
   * for are looked for, and emphasis `html` has of its own is not a difference.
   */
  function missingEmphasis(afterHtml, html) {
    if (typeof afterHtml !== "string" || !afterHtml) return false;
    var wanted = normalize.emphasisRuns(afterHtml);
    if (!wanted.length) return false;
    var have = normalize.emphasisRuns(html);
    for (var i = 0; i < wanted.length; i += 1) {
      var run = wanted[i];
      if (Object.prototype.hasOwnProperty.call(DENIES, run.tag)) {
        if (coversAny(have, DENIES[run.tag], run.text)) return true;
        continue;
      }
      if (!coversAny(have, run.tag, run.text)) return true;
    }
    return false;
  }

  // Is any run of this tag over these words? Containment rather than equality,
  // so a page that emphasizes a longer phrase still counts as emphasizing the
  // words inside it.
  function coversAny(runs, tag, text) {
    for (var i = 0; i < runs.length; i += 1) {
      if (runs[i].tag !== tag) continue;
      if (runs[i].text.indexOf(text) !== -1) return true;
    }
    return false;
  }

  // Does this record's markup still say its text? The markup is used only when
  // it does: a record whose text was reworded without its markup would
  // otherwise write an older wording back onto the page, which is worse than
  // losing the emphasis. When they disagree, the text is the reviewer's answer.
  function markupSaysAfter(item) {
    var afterText = item[record.FIELD.AFTER];
    var afterHtml = item[record.FIELD.AFTER_HTML];
    if (typeof afterHtml !== "string" || !afterHtml) return false;
    if (typeof afterText !== "string") return false;
    return normalize.blockText(afterHtml) === normalize.normalizeBlockText(afterText);
  }

  // Has the reviewer already said "keep mine" about the page looking like this?
  function matchesAcceptedPageState(item, mode, domText) {
    if (typeof domText !== "string") return false;
    var accepted = record.acceptedPageTexts(item);
    for (var i = 0; i < accepted.length; i += 1) {
      if (normalize.equalsInMode(mode, domText, accepted[i])) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // The revert check: a handled hand edit whose change is gone again
  // ---------------------------------------------------------------------------
  //
  // The case this exists for. The reviewer hand-edits a line, the agent carries
  // the edit into the source and replies handled, and the item moves to Done.
  // Later the agent runs a doc-wide change for some other item and its sweep
  // takes the hand-edited line back out. The reviewer's decision is undone and
  // nothing says so: the item is in Done, so nobody is looking at it, and the
  // page just quietly reads the way it did before they touched it.
  //
  // The check runs once per page load, after the settling window closes, and it
  // reopens the item so the change becomes ready work again. It reopens any one
  // item ONCE: an agent that answers handled again while the page still reads
  // the same way is telling the check the rendering is intended, not inviting
  // another round. See the stamp rule below and record.js. The wake feed already
  // wakes on a reopen, so the agent is told without the reviewer having to
  // notice anything.
  //
  // BOTH HALVES ARE REQUIRED, and that is the whole design.
  //
  //   after gone       on its own is a legitimate rewrite. The passage was
  //                    rewritten for a reason nobody here can see, and calling
  //                    that a revert would reopen items every time a document
  //                    moves on.
  //   before back      is the signature of a straight revert: not only is the
  //                    reviewer's wording missing, the exact words they replaced
  //                    are sitting there again.
  //
  // Scope. In practice this is the `edit` kind. `format_only` records carry the
  // same text in `before` and `after` by construction (their difference is in
  // the markup), so the two halves can never both hold, and a `delete` has no
  // `after` text to go missing. Both fall out through the text requirements
  // below rather than through a kind list, so nothing has to be kept in sync.
  //
  // Whitespace-insensitive, via normalize's own key: a rebuild that rewraps a
  // paragraph has not reverted anything, and a substring compare on raw text
  // would say it had.

  // The sentence the reopened item carries. Authored in record.js beside the
  // rest of the tool-generated note text; named here too because this is where
  // it is used and where every test looks for it.
  var REVERTED_EDIT_NOTE = record.PAGE_CHECK_NOTE;

  // The check's other sentence: the words landed and the bold or italic did
  // not. Authored in record.js beside the first one, for the same reason.
  var FORMATTING_LOST_NOTE = record.PAGE_CHECK_FORMAT_NOTE;

  // The backstop, independent of the stamp rule below. Two checks that both look
  // at the same item cannot reopen it twice inside this window, whatever they
  // each believe about the record. Sixty seconds because the loop that caused
  // this ran roughly three times a minute, and a genuine revert is a thing a
  // build did minutes or hours ago, so nothing honest is lost by waiting.
  var CHECK_REOPEN_COOLDOWN_MS = 60000;

  /**
   * Has this handled hand edit been reverted on the page?
   *
   * Pure: a record and the page's current text in, a boolean out. `options.now`
   * is the clock, in milliseconds, so the cooldown can be tested without waiting
   * a minute.
   *
   * TWO THINGS HOLD IT BACK, and they answer different questions.
   *
   *   the stamp rule    has the agent already answered the revision this check
   *                     itself created? Then the reply in hand is the agent
   *                     saying "this is how it renders now", and reopening again
   *                     is the loop. See record.answeredPageCheckReopen.
   *   the cooldown      did any check reopen this item in the last minute? Then
   *                     not again, whatever the record says.
   *
   * @param {Object} item the record
   * @param {string} pageText the reviewed page's current text, the library's own
   *                 chrome excluded (see pageTextOf)
   * @param {Object} [options] {now}
   * @returns {boolean}
   */
  function isRevertedHandledEdit(item, pageText, options) {
    return pageCheckReasonFor(item, pageText, options) !== null;
  }

  // The two things the check can find, and the sentence each one carries. A
  // caller that only wants a yes or no asks isRevertedHandledEdit; one that has
  // to write the note asks pageCheckNoteFor.
  var CHECK_REASON = { REVERTED: "reverted", FORMATTING: "formatting" };

  /**
   * Why the page check would reopen this item, or null.
   *
   * @returns {string|null} CHECK_REASON.REVERTED, CHECK_REASON.FORMATTING, or null
   */
  function pageCheckReasonFor(item, pageText, options) {
    if (!item || typeof pageText !== "string") return null;
    if (!record.isHandEdit(item)) return null;
    if (item[record.FIELD.STATE] !== record.STATE.HANDLED) return null;
    if (record.answeredPageCheckReopen(item)) return null;
    if (withinCheckCooldown(item, options)) return null;

    var after = item[record.FIELD.AFTER];
    var before = item[record.FIELD.BEFORE];
    if (typeof after !== "string" || typeof before !== "string") return null;

    var afterKey = normalize.normalizeText(after);
    var beforeKey = normalize.normalizeText(before);
    // An edit whose after text was never page text (a delete, an empty region)
    // has nothing to go missing.
    if (!afterKey) return null;

    var pageKey = normalize.normalizeText(pageText);
    if (!pageKey) return null;
    if (pageKey.indexOf(afterKey) === -1) {
      // The revert half. An edit whose before and after read the same cannot be
      // both gone and back, which is why this test lives here and not above:
      // a format-only change is exactly that edit, and its formatting half is
      // still worth asking about.
      if (!beforeKey || beforeKey === afterKey) return null;
      return pageKey.indexOf(beforeKey) !== -1 ? CHECK_REASON.REVERTED : null;
    }
    // The reviewer's words ARE on the page. Their bold and italic may not be,
    // and a handled change that is only half on the page is still not on the
    // page. Compared and ignored: exactly what formattingLost compares and
    // ignores, over the whole document's markup rather than one block's.
    return formattingMissingFromPage(item, options) ? CHECK_REASON.FORMATTING : null;
  }

  /** The sentence a page-check reopen of this item should carry, or null. */
  function pageCheckNoteFor(item, pageText, options) {
    var reason = pageCheckReasonFor(item, pageText, options);
    if (reason === CHECK_REASON.REVERTED) return REVERTED_EDIT_NOTE;
    if (reason === CHECK_REASON.FORMATTING) return FORMATTING_LOST_NOTE;
    return null;
  }

  // Is the emphasis this edit asks for absent from the whole page's markup?
  // The caller passes the document's markup as `options.pageHtml`
  // (pageCheckOptions reads it off the body once per sweep).
  function formattingMissingFromPage(item, options) {
    var opts = options || {};
    var html = typeof opts.pageHtml === "string" ? opts.pageHtml : null;
    // Nothing to read is not evidence of anything: a check that guessed would
    // reopen every handled edit on the page.
    if (html === null) return false;
    if (item[record.FIELD.KIND] !== record.KIND.EDIT) return false;
    if (!markupSaysAfter(item)) return false;
    return missingEmphasis(item[record.FIELD.AFTER_HTML], html);
  }

  /** Did a check reopen this item less than CHECK_REOPEN_COOLDOWN_MS ago? */
  function withinCheckCooldown(item, options) {
    var stamp = record.pageCheckReopen(item);
    if (!stamp || typeof stamp.at !== "string") return false;
    var then = Date.parse(stamp.at);
    if (!Number.isFinite(then)) return false;
    var opts = options || {};
    var now = typeof opts.now === "number" ? opts.now : Date.now();
    return now - then < CHECK_REOPEN_COOLDOWN_MS;
  }

  /**
   * The ids of every item in `items` the check says was reverted BY THE PAGE.
   *
   * The one thing the single-item check cannot see, and the reason this takes
   * the whole list: A REVIEWER'S OWN UNDO LOOKS IDENTICAL TO PAGE DRIFT. Both
   * leave the reviewer's wording gone and the text it replaced back. The
   * difference is not on the page at all, it is in the log: an undo of a handled
   * edit mints a revert record naming the item it took back (record.revertOf),
   * and drift mints nothing.
   *
   * So an item another record reverts is skipped. Reopening it would tell the
   * agent to reapply the exact change the reviewer had just deliberately taken
   * back, while the revert record sitting beside it asks for the opposite. The
   * drift check itself is untouched and still does its job for the case it was
   * built for: a rebuild that quietly dropped an applied fix, where nobody asked
   * for anything.
   */
  function revertedHandledEditIds(items, pageText, options) {
    var list = Array.isArray(items) ? items : [];
    var takenBack = record.takenBackIds(list);
    var opts = options || {};
    var out = [];
    for (var i = 0; i < list.length; i += 1) {
      if (takenBack[list[i][record.FIELD.ID]]) continue;
      if (isRevertedHandledEdit(list[i], pageText, opts)) out.push(list[i][record.FIELD.ID]);
    }
    return out;
  }

  /**
   * The reviewed page's own text, with the library's chrome left out.
   *
   * The rail draws a handled edit's after text on its card, so text taken off
   * the whole document would find the after text in the library's own UI and
   * conclude nothing had been reverted. The rail lives in a closed shadow root,
   * which textContent does not cross, but the skip is explicit here anyway: a
   * chrome node that ever lands in the light DOM must not be read as page
   * content.
   *
   * It reads the text the same way a record's before and after were captured,
   * through the normalizer's break-aware reader, so the two compare like with
   * like. The check itself folds whitespace on top of that (normalizeText), so
   * a rebuild that rewraps a paragraph is still not a revert.
   */
  function pageTextOf(root) {
    if (!root) return "";
    return normalize.blockTextFromNode(root, { skip: markers.isToolNode });
  }

  /**
   * The page-check options for a whole sweep: the document's markup, read once.
   *
   * The tool's own chrome goes out of it the way it goes out of pageTextOf: the
   * rail lives in a closed shadow root, and cleanMarkup drops any chrome node
   * that ever lands in the light DOM on the way through emphasisRuns.
   */
  function pageCheckOptions(root, options) {
    var opts = options || {};
    var out = { pageHtml: root && typeof root.innerHTML === "string" ? root.innerHTML : null };
    if (typeof opts.now === "number") out.now = opts.now;
    return out;
  }

  // What the card says when branch three fires. Written once here so the
  // message a test asserts and the message the reviewer reads are the same
  // string.
  var EARLIER_REVISION_MESSAGE = "An earlier version of this edit had already landed. Your current version was re-applied.";

  // ---------------------------------------------------------------------------
  // What replay says on a card
  // ---------------------------------------------------------------------------
  //
  // Four carriers exist on the rail (1B's overlay) and replay uses three of
  // them: a notice for branch three, a badge for the two things that stopped a
  // write, and an attached node for the conflict itself. Nothing here rebuilds
  // a card; every call is one of the rail's in-place mutators.
  //
  // THE CONFLICT CARD SHOWS BOTH VERSIONS IN FULL: the reviewer's and the
  // page's, side by side, neither truncated and neither behind a "see theirs"
  // link. The reviewer decides which one stands, and they cannot decide that
  // from a summary of the difference.

  // The block asks the QUESTION; the card's badge (REPLAY_NEITHER_MATCHES)
  // already says what happened and why nothing was written. Two sentences for
  // one fact on one card is how the reviewer learns to skip both, and the block
  // is where the decision is, so it carries the decision's own words.
  var CONFLICT_TITLE = "Which version stands?";
  var YOURS_LABEL = "Your version";
  var THEIRS_LABEL = "On the page now";
  // The two decisions, as the reviewer reads them. Constants, so the button a
  // test presses and the button the reviewer presses are the same string.
  var KEEP_MINE_LABEL = "Keep mine";
  var TAKE_THEIRS_LABEL = "Take the page's";

  // AND THE REVIEWER CAN ACTUALLY DECIDE. Both versions in full was only half of
  // it: the card told the reviewer the decision was theirs and gave them nothing
  // to press, so the collision sat on the card forever and the only way out was
  // to edit the block again by hand.
  //
  //   Keep mine        re-applies this record's own version to the page and
  //                    clears the collision. The record stands
  //   Take the page's  retires the record and leaves the page exactly as it is.
  //                    Per-record, like undo, and it touches nothing else
  //
  // Drawn as two labelled panes rather than five paragraphs of one size: an
  // eyebrow per side, a left rule (the reviewer's in the accent, the page's in
  // the neutral line colour), and the two buttons under both.
  var CONFLICT_STYLE = [
    "[data-lahe-conflict]{display:flex;flex-direction:column;gap:9px;",
    "border-top:1px solid var(--line-soft);padding-top:9px}",
    "[data-lahe-conflict][hidden]{display:none}",
    "[data-lahe-conflict-title]{font-size:12.5px;font-weight:600;line-height:1.45;color:var(--ink)}",
    "[data-lahe-conflict-sides]{display:flex;flex-direction:column;gap:8px}",
    "[data-lahe-conflict-side]{padding-left:9px;border-left:2px solid var(--line);",
    "display:flex;flex-direction:column;gap:3px}",
    "[data-lahe-conflict-side='yours']{border-left-color:var(--accent)}",
    "[data-lahe-conflict-label]{font-size:10px;font-weight:600;letter-spacing:.08em;",
    "text-transform:uppercase;color:var(--ink-faint)}",
    "[data-lahe-conflict-side='yours'] [data-lahe-conflict-label]{color:var(--accent-ink)}",
    "[data-lahe-conflict-text]{font-size:12.5px;line-height:1.45;color:var(--ink-soft);",
    "white-space:pre-wrap;overflow-wrap:anywhere}",
    "[data-lahe-conflict-side='yours'] [data-lahe-conflict-text]{color:var(--ink)}",
    // The run that actually differs, so the reviewer is comparing two sentences
    // rather than reading two nearly identical ones and hunting for the change.
    "[data-lahe-conflict-diff]{background:var(--accent-wash);border-radius:3px;",
    "padding:0 2px;box-shadow:0 1px 0 var(--accent)}",
    "[data-lahe-conflict-side='theirs'] [data-lahe-conflict-diff]{background:var(--warn-wash);",
    "box-shadow:0 1px 0 var(--warn)}"
  ].join("");

  // One node per item, reused. Building a fresh node on every pass would be the
  // rail's own law broken from the outside: a card the reviewer is reading (or
  // typing in) must not be rebuilt underneath them.
  var conflictNodes = Object.create(null);
  var conflicts = Object.create(null);
  // The one style element, or null. See ensureConflictStyle.
  var conflictStyleAttached = null;

  function cardsIn(ctx) {
    return ctx && ctx.cards ? ctx.cards : null;
  }

  function callCard(ctx, method, a, b) {
    var cards = cardsIn(ctx);
    if (!cards || typeof cards[method] !== "function") return null;
    return cards[method](a, b);
  }

  function conflictNodeFor(ctx, id, yours, theirs) {
    var doc = ctx.document || (typeof document !== "undefined" ? document : null);
    if (!doc || typeof doc.createElement !== "function") return null;

    var node = conflictNodes[id];
    if (!node) {
      node = doc.createElement("div");
      node.setAttribute("data-lahe-conflict", id);
      var title = doc.createElement("div");
      title.setAttribute("data-lahe-conflict-title", "");
      node.appendChild(title);
      var sides = doc.createElement("div");
      sides.setAttribute("data-lahe-conflict-sides", "");
      sides.appendChild(sideNode(doc, "yours", YOURS_LABEL));
      sides.appendChild(sideNode(doc, "theirs", THEIRS_LABEL));
      node.appendChild(sides);
      node.appendChild(decideNode(ctx, doc, id));
      // The stylesheet rides in with the node, into the rail's own closed root,
      // the way 3A's Done tab puts its own in. Without it these are attribute
      // names with nothing behind them and the card that matters most in the
      // product draws in no system at all.
      ensureConflictStyle(doc, node);
      conflictNodes[id] = node;
    }
    node.firstChild.textContent = CONFLICT_TITLE;
    writeSide(doc, node, "yours", yours, theirs);
    writeSide(doc, node, "theirs", theirs, yours);
    node.removeAttribute("hidden");
    return node;
  }

  // Connectedness, not a boolean. The sheet rides inside the first conflict node
  // built, and that node can leave the document with its card or with a
  // remounted root; a flag alone would then say "installed" about a style
  // element that is not in any tree, and the next conflict would draw naked.
  function ensureConflictStyle(doc, node) {
    if (conflictStyleAttached && conflictStyleAttached.isConnected !== false) return;
    var style = doc.createElement("style");
    style.textContent = CONFLICT_STYLE;
    node.appendChild(style);
    conflictStyleAttached = style;
  }

  function sideNode(doc, side, label) {
    var wrap = doc.createElement("div");
    wrap.setAttribute("data-lahe-conflict-side", side);
    var head = doc.createElement("div");
    head.setAttribute("data-lahe-conflict-label", "");
    head.textContent = label;
    var body = doc.createElement("div");
    body.setAttribute("data-lahe-conflict-text", "");
    wrap.appendChild(head);
    wrap.appendChild(body);
    return wrap;
  }

  /**
   * One side's text, with the run that differs from the other side marked.
   *
   * Both versions still appear IN FULL and untruncated; the mark is only a
   * pointer at where they diverge, which is the difference between two legible
   * paragraphs and a comparison a reviewer can actually make. textContent
   * everywhere: neither side is ever parsed as markup.
   */
  function writeSide(doc, node, side, text, other) {
    var body = textIn(node, side);
    if (!body) return;
    body.textContent = "";
    var mine = text === null || text === undefined ? "" : String(text);
    var theirs = other === null || other === undefined ? "" : String(other);
    var span = commonAffixes(mine, theirs);
    if (!mine) return;
    if (span.head) body.appendChild(doc.createTextNode(span.head));
    var middle = mine.slice(span.head.length, mine.length - span.tail.length);
    if (middle) {
      var mark = doc.createElement("span");
      mark.setAttribute("data-lahe-conflict-diff", "");
      mark.textContent = middle;
      body.appendChild(mark);
    }
    if (span.tail) body.appendChild(doc.createTextNode(span.tail));
  }

  /** The shared start and the shared end of two strings. */
  function commonAffixes(a, b) {
    var head = 0;
    while (head < a.length && head < b.length && a.charAt(head) === b.charAt(head)) head += 1;
    var tail = 0;
    while (
      tail < a.length - head &&
      tail < b.length - head &&
      a.charAt(a.length - 1 - tail) === b.charAt(b.length - 1 - tail)
    ) {
      tail += 1;
    }
    return { head: a.slice(0, head), tail: tail ? a.slice(a.length - tail) : "" };
  }

  function textIn(node, side) {
    return node.querySelector('[data-lahe-conflict-side="' + side + '"] [data-lahe-conflict-text]');
  }

  /** The two buttons. A decision the reviewer is told is theirs needs both. */
  function decideNode(ctx, doc, id) {
    var acts = doc.createElement("div");
    acts.setAttribute("data-lahe-conflict-actions", "");
    // The rail's own card-action register, so these read as the rail's buttons
    // rather than as a third button voice inside one card.
    // N2 (design re-check): the two choices are weighted equally, because this
    // is the one screen whose whole claim is that the decision belongs to the
    // reviewer. Both get the same register (the outlined cardact), so neither
    // "Keep mine" nor "Take the page's" reads as the default. Drawing one as a
    // button and the other as a text link put a thumb on the scale toward
    // keeping your own version, which nothing about branch four justifies.
    acts.className = "cardacts";
    acts.appendChild(button(doc, "cardact", KEEP_MINE_LABEL, "keep_mine", id));
    acts.appendChild(button(doc, "cardact", TAKE_THEIRS_LABEL, "take_theirs", id));
    return acts;
  }

  function button(doc, className, label, choice, id) {
    var b = doc.createElement("button");
    b.className = className;
    b.setAttribute("type", "button");
    b.setAttribute("data-lahe-conflict-choice", choice);
    b.textContent = label;
    if (typeof b.addEventListener === "function") {
      b.addEventListener("click", function () {
        resolveConflict(id, choice);
      });
    }
    return b;
  }

  /**
   * The reviewer's decision on a collision, applied.
   *
   * @param {string} id      the record the conflict is on
   * @param {string} choice  "keep_mine" or "take_theirs"
   * @returns {{resolved: boolean, choice: string, reason: (string|null)}}
   */
  function resolveConflict(id, choice) {
    var ctx = contextFor(null);
    var flagged = conflicts[id];
    if (!flagged) return { resolved: false, choice: choice, reason: "no conflict is flagged on " + String(id) };

    if (choice === "take_theirs") {
      // The page stands and the record goes. Nothing is written to the page:
      // what the reviewer is accepting is already what is on it. `retire` is
      // editing's per-record seam, the same one undo ends with, minus the write.
      if (!ctx.editing || typeof ctx.editing.retire !== "function") {
        return { resolved: false, choice: choice, reason: "no editing surface to retire the record with" };
      }
      var retired = ctx.editing.retire(id);
      if (!retired || retired.retired !== true) {
        return { resolved: false, choice: choice, reason: (retired && retired.reason) || "the record was not retired" };
      }
      delete conflicts[id];
      forceClearConflict(ctx, id);
      callCard(ctx, "removeCard", id);
      return { resolved: true, choice: choice, reason: null };
    }

    if (choice !== "keep_mine") {
      return { resolved: false, choice: choice, reason: "unknown choice " + String(choice) };
    }

    // The reviewer's version stands, so it is written to the page exactly as an
    // ordinary re-apply would write it, and the collision is answered.
    var item = itemWithId(ctx, id);
    if (!item) return { resolved: false, choice: choice, reason: "no record " + String(id) };

    // FIRST, AND BEFORE THE WRITE: the record remembers that the reviewer
    // answered THIS page state. That memory is what makes the decision durable,
    // because the write below lasts exactly until the next repaint: the page's
    // own source still says the agent's sentence, so it renders it again, and
    // from then on the ordinary replay pass is the only thing carrying the
    // reviewer's version. It reads the accepted state as branch two and
    // re-applies, pass after pass, like any committed record. (The one-shot
    // write was the whole bug: found live on 2026-08-14, at
    // /?morph=raw&poll=250, where the press was undone 150ms later and the
    // collision re-raised forever with nothing said to the reviewer.)
    record.acceptPageText(item, flagged.theirs);
    persistItem(ctx, item);

    // The node from the last pass, or a fresh resolve when a repaint has been
    // through since. On a morphing page the element replay bound a moment ago is
    // routinely gone by the time a hand reaches the button, and refusing the
    // press for that is the same defect wearing a different hat.
    var element = lastElement[id];
    if (!element || element.isConnected === false) {
      var ref = item[record.FIELD.REGION] ? item[record.FIELD.REGION].ref : null;
      var verdict = ref ? resolveRegion(item, ref, ctx) : null;
      element = verdict ? verdict.element : null;
    }
    if (!element) {
      return { resolved: false, choice: choice, reason: "the region this record points at is not on the page" };
    }
    epoch.write("replay.keep_mine", function () {
      writeRegion(element, item);
    });
    counters.regionsWritten += 1;
    // Finding 25: this is an ordinary re-apply, so it clears the same two pieces
    // of state the ordinary write path clears. A record that was both lost and
    // conflict-flagged would otherwise keep a stale region.lost stamp (which 3A
    // projects into review.json) after the reviewer resolved in its favour, and
    // the element memory would point at a node that is no longer the truth.
    clearLost(ctx, item);
    persistItem(ctx, item);
    lastElement[id] = element;
    delete conflicts[id];
    forceClearConflict(ctx, id);
    return { resolved: true, choice: choice, reason: null };
  }

  function itemWithId(ctx, id) {
    var found = null;
    itemsIn(ctx).forEach(function (item) {
      if (item[record.FIELD.ID] === id) found = item;
    });
    return found;
  }

  /**
   * Clear a conflict the REVIEWER answered.
   *
   * Separate from clearConflict because that one deliberately refuses to clear a
   * displaced conflict: an ordinary pass must not wipe a warning nobody has
   * answered yet. A button press is the answer, so this one clears regardless.
   */
  function forceClearConflict(ctx, id) {
    delete conflicts[id];
    clearConflict(ctx, id);
  }

  // A conflict that resolved: the node stays where it is (removing it from a
  // card the reviewer may be in is the churn this file refuses), and it is
  // emptied and hidden.
  function clearConflict(ctx, id) {
    // A DISPLACED conflict is not cleared by an ordinary pass. It was raised
    // from something the page tried to say and protection took back off, so the
    // page now holds the reviewer's own words: every later pass reads branch
    // one and would clear a warning the reviewer has not answered yet, usually
    // within a frame of it appearing. It clears when the reviewer commits that
    // record again, which is the moment they have decided something.
    if (conflicts[id] && conflicts[id].displaced) return;
    if (conflicts[id]) delete conflicts[id];
    callCard(ctx, "clearCardBadge", id, "REPLAY_NEITHER_MATCHES");
    var node = conflictNodes[id];
    if (!node) return;
    if (node.firstChild) node.firstChild.textContent = "";
    var yours = textIn(node, "yours");
    var theirs = textIn(node, "theirs");
    if (yours) yours.textContent = "";
    if (theirs) theirs.textContent = "";
    node.setAttribute("hidden", "hidden");
  }

  /** What the reviewer's card is showing as a collision right now. */
  function conflictFor(id) {
    return conflicts[id] || null;
  }

  function conflictIds() {
    return Object.keys(conflicts);
  }

  // ---------------------------------------------------------------------------
  // Applying one record
  // ---------------------------------------------------------------------------

  // The node each record was last bound to. Used for ONE thing: asking whether
  // the reviewer is in this region right now, before the anchor is consulted.
  // It never places a write. A stale node is harmless here, because a detached
  // node is not the protected one.
  var lastElement = Object.create(null);

  // ---------------------------------------------------------------------------
  // The probable place: the point ladder, for the reviewer only
  // ---------------------------------------------------------------------------
  //
  // TWO LADDERS, AND THEY SERVE DIFFERENT PEOPLE. The write ladder (the anchor
  // engine, above) serves the AGENT: it decides where an edit may be written,
  // and it refuses unless exactly one element is certainly the right one,
  // because a wrong write destroys somebody's words. The point ladder
  // (pointing.js) serves the REVIEWER: it decides where a comment should point
  // on the page in front of them, and it is allowed a best guess, because a
  // wrong guess costs a mark in the wrong place and nothing else.
  //
  // So a probable place changes what the reviewer SEES and nothing else. The
  // record keeps its lost stamp, review.json still says lost, and the agent is
  // still told the passage could not be matched: the agent must not write on a
  // guess (the build doc's S8). Only the page shows it, in a visibly weaker
  // paint, with the word "probable" on the card.
  //
  // Comments and notes only. An edit, a delete and a format-only record all
  // exist to change text, and pointing one at a guess is one accepted click
  // away from writing on it. They refuse and stay refused.
  var GUESSABLE_KINDS = {};
  GUESSABLE_KINDS[record.KIND.COMMENT] = 1;
  GUESSABLE_KINDS[record.KIND.NOTE] = 1;

  // Card copy. The word first, always, so the reviewer reads "probable" before
  // they read why.
  var PROBABLE_NOTICE = "probable";

  // id -> {element, reason}. What the page is showing a guess for right now.
  var probable = Object.create(null);

  // The assertion behind S8, in code rather than in a comment. Everything that
  // reaches the page's text (writeRegion) refuses while this is set, so a
  // future edit that lets the probable path fall through into a write fails
  // loudly here instead of quietly rewriting a paragraph nobody matched.
  var guessing = false;

  /** Short, plain words for why this element is the probable one. */
  function probableReason(guess) {
    if (!guess) return "";
    // The ladder could not tell the candidates apart on identity and used the
    // remembered place to break the tie. That is exactly the reworded-passage
    // case, so say it the way the reviewer would.
    if (guess.via === "position") return "same place, words changed";
    var reasons = (guess.reasons || []).slice(0, 2);
    if (!reasons.length) return "closest match on the page";
    return reasons.join(" and ") + " match, words changed";
  }

  function highlightsIn(ctx) {
    if (ctx && ctx.highlights) return ctx.highlights;
    var shared = highlightModule && highlightModule.shared;
    if (!shared || typeof shared.paint !== "function") return null;
    if (typeof shared.supported === "function" && !shared.supported()) return null;
    return shared;
  }

  function rangeOver(ctx, element) {
    var doc = ctx.document || (typeof document !== "undefined" ? document : null);
    if (!doc || typeof doc.createRange !== "function" || !element) return null;
    var range = doc.createRange();
    range.selectNodeContents(element);
    return range;
  }

  function paintAs(ctx, id, element, name) {
    var highlights = highlightsIn(ctx);
    if (!highlights) return false;
    var range = rangeOver(ctx, element);
    if (!range) return false;
    highlights.paint(id, range, name);
    return true;
  }

  /**
   * Point this record at its probable place, when it has one.
   *
   * Called only from the branch that is about to stamp the record lost, and it
   * does not change that: the lost stamp is the agent's answer and it stands.
   *
   * @returns {Object|null} {element, reason} when a guess was painted
   */
  function bindProbable(item, ref, ctx) {
    var id = item[record.FIELD.ID];
    if (!ref || !GUESSABLE_KINDS[item[record.FIELD.KIND]]) return null;
    var ladder = ctx.pointing;
    if (!ladder || typeof ladder.bestGuess !== "function") return null;
    var guess;
    guessing = true;
    try {
      // The floor and the margin are pointing's own, and they are not restated
      // here: a second threshold in this file would be a second opinion about
      // how sure the ladder is. An element back means it cleared its own bar.
      guess = ladder.bestGuess(ref, ctx.root);
    } finally {
      guessing = false;
    }
    if (!guess || !guess.element) {
      clearProbable(ctx, id, null);
      return null;
    }
    var standing = probable[id];
    var reason = probableReason(guess);
    probable[id] = { element: guess.element, reason: reason };
    if (!standing || standing.element !== guess.element) counters.regionsProbable += 1;
    paintAs(ctx, id, guess.element, highlightModule.NAME.PROBABLE);
    callCard(ctx, "setCardNotice", id, PROBABLE_NOTICE + ": " + reason);
    return probable[id];
  }

  /**
   * The guess ends, because the region was found for certain.
   *
   * The certain find is what the stamp buys: the agent carried data-lahe-id
   * into the source, the page rebuilt with it, and the write ladder bound
   * without asking anyone to guess. So the weaker paint goes, the word
   * "probable" comes off the card, and the passage is painted like any other
   * commented passage.
   *
   * @param {Element|null} element the element that WAS found, when there is one
   */
  function clearProbable(ctx, id, element) {
    if (!probable[id]) return false;
    delete probable[id];
    counters.regionsProbableCleared += 1;
    callCard(ctx, "setCardNotice", id, null);
    if (element) paintAs(ctx, id, element, highlightModule.NAME.COMMENT);
    else {
      var highlights = highlightsIn(ctx);
      if (highlights && typeof highlights.clear === "function") highlights.clear(id);
    }
    return true;
  }

  /**
   * The element the agent's stamp names, when the write ladder refused it only
   * because the words under it changed.
   *
   * THIS IS THE CASE THE STAMP WAS ADDED FOR. The reviewer comments on a
   * sentence, the agent rewrites that sentence (which is what they asked for)
   * and carries `data-lahe-id` into the source with the rewrite, and the page
   * rebuilds. The words are gone, on purpose, and the id is still there on the
   * one element that used to hold them. Ken, deciding this on 2026-09-11: the
   * rebuilt page is "found with certainty, not probability".
   *
   * The write ladder still says no, and it is right to: the anchor engine's own
   * note on that refusal is "a write may not land on a maybe", because a stamp
   * over different words can also mean the agent stamped the wrong twin (S2).
   * A comment writes nothing, so it is not a maybe for a comment. It is where
   * the comment lives, and this is the only place that difference is drawn.
   *
   * Comments and notes only, one element only. Two elements carrying the id is
   * S1's ambiguity and gets no answer here either.
   *
   * @returns {Element|null}
   */
  function stampedPlace(item, ref, verdict, ctx) {
    if (!ref || !GUESSABLE_KINDS[item[record.FIELD.KIND]]) return null;
    if (!verdict || verdict.via !== "stamp" || verdict.element) return null;
    var engine = ctx.anchor || anchorEngine;
    if (!engine || typeof engine.findByStamp !== "function" || typeof engine.scopeOf !== "function") return null;
    if (!engine.STAMP_REASON || verdict.reason !== engine.STAMP_REASON.TEXT_MOVED) return null;
    var scope = engine.scopeOf(ctx.root, null);
    if (!scope) return null;
    var found = engine.findByStamp(scope, ref.stamp);
    return found.length === 1 ? found[0] : null;
  }

  /**
   * Paint a certain find that nothing else will paint.
   *
   * The ordinary repaint (comments.js) resolves the record's words against the
   * page, so a passage whose words the agent rewrote comes back bare however
   * certainly the stamp identified it. An existing mark is never disturbed: an
   * open comment box paints its own passage louder, and that is the reviewer's
   * current place.
   */
  function paintCertain(ctx, item, element) {
    var id = item[record.FIELD.ID];
    if (!GUESSABLE_KINDS[item[record.FIELD.KIND]]) return false;
    var highlights = highlightsIn(ctx);
    if (!highlights) return false;
    if (typeof highlights.rangeFor === "function" && highlights.rangeFor(id)) return false;
    return paintAs(ctx, id, element, highlightModule.NAME.COMMENT);
  }

  /** The probable element this record is pointing at, when it is still here. */
  function probableElement(id) {
    var standing = probable[id];
    if (!standing || !standing.element) return null;
    return standing.element.isConnected === false ? null : standing.element;
  }

  /**
   * Where on the page does this record point, right now?
   *
   * READ-ONLY. It writes nothing, stamps nothing, and counts nothing: it is the
   * same anchoring a pass does, asked as a question. The reviewer clicking a
   * card to find its passage is the caller, and a handled edit is the case that
   * needs it, because a handled item has no highlight left to scroll to (R37):
   * its region ref and its before/after context are all that remain.
   *
   * A record whose anchor is LOST returns its PROBABLE place when the point
   * ladder found one, and null otherwise. That is not a softening of the write
   * ladder: nothing here is written, and the card the reviewer clicked already
   * says "probable", so they are being taken somewhere the tool has told them
   * it is guessing about. With no guess the old answer stands, because
   * scrolling somewhere arbitrary is worse than not scrolling.
   *
   * @param {string} id  the record's id
   * @param {Object} [override] context override, as everywhere else here
   * @returns {Element|null}
   */
  function locate(id, override) {
    var ctx = contextFor(override);
    var item = itemWithId(ctx, id);
    if (!item) return null;
    var region = item[record.FIELD.REGION] || null;
    if (region && region.lost) return probableElement(id);
    // The node the last pass bound, when it is still in the document. This is
    // what carries an element pick whose text the matcher can never re-find.
    var bound = lastElement[id];
    if (bound && bound.isConnected !== false) return bound;
    var ref = region ? region.ref : null;
    // A page-level note points at nothing, and neither does a record whose ref
    // never minted. There is no wrong place to send the reviewer, so nowhere is
    // the answer.
    if (!ref) return null;
    var verdict = resolveRegion(item, ref, ctx);
    return verdict && verdict.element ? verdict.element : null;
  }

  // `isProtected`, never `touches`. They are different questions: `touches` is
  // the veto's ("would morphing this element destroy the protected block"), and
  // it answers true for an ancestor of the block, which is most of the page.
  // Replay's question is "is the reviewer inside THIS region", which is
  // isProtected's. 2B says the same thing from their side.
  function isProtectedNow(ctx, element) {
    if (!element) return false;
    if (!ctx.protect || typeof ctx.protect.isProtected !== "function") return false;
    return ctx.protect.isProtected(element);
  }

  /**
   * Is the reviewer in this record's region right now?
   *
   * Asked by id when protection can answer that way, which it can from CP2-mid
   * on: the editing surface passes the record into `protect.mark`, so the side
   * that knows which record is open says so directly. The node fallback is the
   * older answer and still the only one available to a caller that marks a
   * block without a record.
   */
  function protectedForItem(ctx, id) {
    if (!ctx.protect) return false;
    if (typeof ctx.protect.protectedItemId === "function") {
      var open = ctx.protect.protectedItemId();
      if (open) return open === id;
    }
    return isProtectedNow(ctx, lastElement[id]);
  }

  // The commit detail 2B's release() handed to this pass, when it is about this
  // record. See replay.schedule's options.
  function commitFor(ctx, id) {
    if (!ctx.commit || !id) return null;
    return ctx.commit.item === id ? ctx.commit : null;
  }

  var WRITING_KINDS = {};
  WRITING_KINDS[record.KIND.EDIT] = 1;
  WRITING_KINDS[record.KIND.DELETE] = 1;
  WRITING_KINDS[record.KIND.FORMAT_ONLY] = 1;

  function writes(item) {
    return Object.prototype.hasOwnProperty.call(WRITING_KINDS, item[record.FIELD.KIND]);
  }

  // What the page tried to say in a protected block, in the shape the compare
  // reads. Protection snapshots the block's raw textContent, which runs the
  // words on either side of a break together; the markup it snapshots beside it
  // is the same block, so the break-aware text comes from there when it exists.
  function observedValue(commit) {
    if (!commit) return null;
    if (typeof commit.observedHtml === "string") return normalize.blockText(commit.observedHtml);
    return typeof commit.observed === "string" ? commit.observed : null;
  }

  // The region's current value, in the shape the record compares against: the
  // markup for a format-only record, the text for everything else, and null for
  // a delete whose block is not in the document.
  function domValueOf(element, item) {
    if (!element) return null;
    if (item[record.FIELD.KIND] === record.KIND.FORMAT_ONLY) {
      return typeof element.innerHTML === "string" ? element.innerHTML : String(element.textContent || "");
    }
    // Read through the normalizer's break-aware reader, never off textContent:
    // the record's `after` carries the breaks the reviewer typed, and textContent
    // would compare a block that HAS those breaks against a record that says it
    // should, decide they differ, and write the block back to one paragraph.
    return normalize.blockTextFromNode(element);
  }

  // Why an anchor did not bind, in a sentence the reviewer can act on. Zero
  // matches and several matches are the same verdict (nothing is written) and
  // they are DIFFERENT situations, so they do not get the same sentence.
  function lostReason(verdict) {
    if (verdict.reason === uniqueness.REASON.AMBIGUOUS) {
      return (
        "more than one place on this page matches this item (" +
        verdict.considered +
        " candidates), so nothing was written or moved"
      );
    }
    if (verdict.reason === uniqueness.REASON.STRUCTURE_ONLY) {
      return "a structurally similar place is still present, but its text does not match, so nothing was written or moved";
    }
    return "this feedback could not be safely matched to the current page, so nothing was written or moved";
  }

  // Spelled once, in failures.js, because tab_done clears the same badges when
  // a reply folds as handled.
  var ANCHOR_FAILURE_CODES = (failures && failures.ANCHOR_FAILURE_CODES) || [];

  function anchorFailureCode(verdict) {
    if (verdict && typeof verdict.failureCode === "string" && verdict.failureCode) return verdict.failureCode;
    return uniqueness.REASON_FAILURE_CODE[verdict && verdict.reason] || "ANCHOR_NO_TEXT_MATCH";
  }

  function clearAnchorBadges(ctx, itemId) {
    ANCHOR_FAILURE_CODES.forEach(function (code) {
      callCard(ctx, "clearCardBadge", itemId, code);
    });
  }

  // ---------------------------------------------------------------------------
  // D9 at replay time: resolving a region whose text this tool has changed
  // ---------------------------------------------------------------------------
  //
  // A reference's probe is the region's text at mint time, which is the record's
  // `before`. The moment replay writes `after` into that region, the probe no
  // longer describes what is on the page, and a single-probe resolve would call
  // its own successful write a lost anchor on the very next pass.
  //
  // So a record is resolved against EVERY text it knows about, newest first:
  // the current `after`, then the `before`, then every earlier `after` from the
  // applied history. Only the probe varies. The stored context, the widening
  // depth and the uniqueness predicate are untouched, which is what keeps this
  // from becoming a second anchor engine: it is 1C's resolve, asked the same
  // question about several known spellings of one region.
  //
  // Order matters for one reason only: the newest text is the most likely to be
  // on the page, so the common case binds on the first try. The verdict is the
  // predicate's either way, and a probe that binds to two nodes is a lost
  // anchor exactly like a probe that binds to none.
  function probesFor(item, ref) {
    var out = [];
    function push(value) {
      if (typeof value !== "string" || !value) return;
      var text = normalize.textOf(value);
      if (!text) return;
      if (out.indexOf(text) === -1) out.push(text);
    }
    var fields = record.comparisonFields(item);
    push(item[fields.after]);
    push(item[record.FIELD.AFTER]);
    push(item[fields.before]);
    push(item[record.FIELD.BEFORE]);
    record.priorAfters(item, fields.after).forEach(push);
    // A page state the reviewer answered with "keep mine" is a spelling of this
    // region that was really on the page, so it belongs in the probe list beside
    // the record's own texts: on the next repaint it is what the page holds
    // again, and the region has to be findable before it can be re-written.
    record.acceptedPageTexts(item).forEach(push);
    if (ref && typeof ref.probe === "string") push(ref.probe);
    return out;
  }

  function refWithProbe(ref, probe) {
    var next = {};
    Object.keys(ref).forEach(function (key) {
      next[key] = ref[key];
    });
    next.probe = probe;
    return next;
  }

  function resolveRegion(item, ref, ctx) {
    var probes = probesFor(item, ref);
    var worst = null;
    for (var i = 0; i < probes.length; i += 1) {
      var verdict = ctx.anchor.resolve(refWithProbe(ref, probes[i]), ctx.root);
      if (verdict.bound) return verdict;
      // An ambiguous probe outranks a missing one in the report: "this matches
      // two places" and "this matches nowhere" need different sentences, and
      // the ambiguous one is the dangerous case.
      if (!worst || (verdict.reason === uniqueness.REASON.AMBIGUOUS && worst.reason !== uniqueness.REASON.AMBIGUOUS)) {
        worst = verdict;
      }
    }
    return worst || ctx.anchor.resolve(ref, ctx.root);
  }

  function markLost(item, verdict, ctx) {
    // A HANDLED ITEM IS NEVER STAMPED LOST. The agent's fix is expected to have
    // rewritten the very passage the item points at, so a failed re-anchor is
    // the fix working, not the feedback going missing. Saying "this could not
    // be matched to this version of the page" beside "I made the change" is one
    // card contradicting itself, which is how this was reported live on
    // 2026-08-18. applyRecord already returns before this on a handled record
    // (it is not outstanding); the guard is stated here too so the stamping
    // path itself carries the rule, whatever calls it.
    if (item && item[record.FIELD.STATE] === record.STATE.HANDLED) {
      return { wrote: false, branch: null, lost: false, reason: "handled: the fix was expected to change this passage", item: item, element: null };
    }

    // The page is still drawing itself, so this verdict is about a document
    // that is not finished. Say nothing yet, and come back when it is.
    if (isSettling()) {
      counters.regionsLostDeferred += 1;
      armSettleRecheck();
      return {
        wrote: false,
        branch: null,
        lost: false,
        deferred: true,
        reason: "the page is still settling, so this is rechecked before anything is said",
        item: item,
        element: null
      };
    }

    counters.regionsLost += 1;
    var region = item[record.FIELD.REGION] || record.emptyRegion();
    var reason = lostReason(verdict);
    var code = anchorFailureCode(verdict);

    // A record that is still lost for the same reason is not re-stamped. Every
    // pass would otherwise give it a new timestamp, which turns "this record
    // was untouched" into a diff on every pass and makes the byte-identical
    // assertions in ranked test 2 unstateable.
    if (region.lost && region.lost.code === code && region.lost.reason === reason) {
      return { wrote: false, branch: null, lost: true, reason: verdict.reason, item: item, element: null };
    }

    var next = {};
    Object.keys(region).forEach(function (key) {
      next[key] = region[key];
    });
    // The record's own lost state, which is what 3A projects into review.json.
    // review_format is not touched from here: the projection reads the record.
    next.lost = { code: code, reason: reason, at: new Date().toISOString() };
    item[record.FIELD.REGION] = next;
    // Written down for the same reason the clear is: `items` is a cache a
    // remount replaces from the store, so a stamp nobody persisted is gone at
    // the next morph and the reviewer's card outlives the state behind it.
    persistItem(ctx, item);

    if (failures) {
      clearAnchorBadges(ctx, item[record.FIELD.ID]);
      callCard(
        ctx,
        "setCardBadge",
        item[record.FIELD.ID],
        failures.failure(code, {
          verdict: verdict.reason,
          candidates: verdict.considered,
          survivors: verdict.survivors
        })
      );
    }
    return { wrote: false, branch: null, lost: true, reason: verdict.reason, item: item, element: null };
  }

  /**
   * The anchor bound again, so the lost state ends: on the record, on the card,
   * and in storage.
   *
   * The card is the half that was missing, and it is the whole of the bug
   * reported on 2026-08-17: a passage that went briefly unfindable while the
   * page was still rendering got a lost stamp and a lost badge, the very next
   * pass found it and cleared the stamp, and the badge stayed on the card
   * forever. The reviewer read "this passage is gone from the page" over a
   * passage sitting in front of them, and review.json, which projects the
   * record, disagreed with the card. Same shape as the standing origin chip
   * (f55094b): the condition ended, so the notice ends.
   *
   * Storage is the other half: the stamp lives on the cached record, and a
   * remount replaces that cache from the store, so a clear nobody wrote down
   * comes back on the next morph.
   */
  function clearLost(ctx, item) {
    var region = item[record.FIELD.REGION];
    // The badge is cleared even when the record carries no stamp: the two are
    // written by the same act and a card left holding a stale one is exactly
    // what this is here to end.
    clearAnchorBadges(ctx, item[record.FIELD.ID]);
    if (!region || !region.lost) return false;
    var next = {};
    Object.keys(region).forEach(function (key) {
      next[key] = region[key];
    });
    next.lost = null;
    item[record.FIELD.REGION] = next;
    counters.regionsLostCleared += 1;
    persistItem(ctx, item);
    return true;
  }

  /**
   * Applies one committed record.
   *
   * The contract, in the order it is enforced:
   *  - a record that is not outstanding is not replayed at all
   *  - a region the reviewer is in right now is skipped, never written
   *  - an anchor that does not bind uniquely is surfaced as lost: nothing is
   *    written, nothing is moved, and the record says so
   *  - the branch comes from compare(), and branch four writes NOTHING
   *  - every DOM write happens inside epoch.write("replay", ...)
   *  - every path increments the counter that names it
   *
   * @param {Object} item the record
   * @param {Object} ctx see `context`. `ctx.element` short-circuits the anchor
   *   for a caller that already holds the node
   * @returns {Object} {wrote, branch, lost, reason, element, item}
   */
  function applyRecord(item, override) {
    var ctx = contextFor(override);
    var id = item[record.FIELD.ID];
    var kind = item[record.FIELD.KIND];

    if (!record.isOutstanding(item)) {
      return { wrote: false, branch: null, lost: false, reason: "not outstanding", item: item, element: null };
    }

    var ref = item[record.FIELD.REGION] ? item[record.FIELD.REGION].ref : null;
    var commit = commitFor(ctx, id);
    var element = ctx.element || (commit && commit.element) || null;
    var verdict = null;

    // Protection is asked BEFORE the anchor, against the node this record was
    // last bound to. While the reviewer types, the region's text is neither the
    // record's `before` nor its `after` nor anything in between, so the anchor
    // cannot find it and would report the region the reviewer is looking at
    // right now as lost. The node is known; asking first is both cheaper and
    // the only honest answer.
    if (!element && protectedForItem(ctx, id)) {
      counters.regionsSkippedProtected += 1;
      return {
        wrote: false,
        branch: null,
        lost: false,
        reason: "the reviewer is in this region",
        item: item,
        element: lastElement[id]
      };
    }

    if (!element) {
      if (!ref) {
        return { wrote: false, branch: null, lost: false, reason: "no reference", item: item, element: null };
      }
      verdict = resolveRegion(item, ref, ctx);
      element = verdict.element;
    }

    if (!element) {
      // A delete whose block is not on the page is APPLIED, not lost. Absence
      // is what a delete asked for, and reporting it as a missing anchor would
      // flag every successful deletion.
      if (kind === record.KIND.DELETE && verdict && verdict.reason === uniqueness.REASON.NO_TEXT_MATCH) {
        counters.regionsSkippedEqual += 1;
        clearLost(ctx, item);
        clearConflict(ctx, id);
        return {
          wrote: false,
          branch: BRANCH.ALREADY_APPLIED,
          lost: false,
          reason: "the block is gone, which is what this record asked for",
          item: item,
          element: null
        };
      }
      // The record's last binding outranks a failed re-resolve: an element
      // this pass bound earlier that is STILL IN THE DOCUMENT cannot be lost,
      // whatever the matcher says about its text. An element-picked comment
      // (a chart, an image, a block with no unique words) has nothing for the
      // text matcher to re-find, and the settle recheck was marking it lost
      // while the reviewer was looking straight at it — which is how AC1's
      // Copy and Export came to disagree by one lost-anchor note (2026-08-18).
      //
      // The binding replaces the RESOLVE, never the rest of the pass: the
      // element continues into the content branches below, so a bound element
      // whose text changed underneath still surfaces its collision. An early
      // return here silently swallowed AC3's neither-matches conflict for a
      // whole morning.
      var bound = lastElement[id];
      if (bound && bound.isConnected) {
        clearLost(ctx, item);
        clearProbable(ctx, id, bound);
        element = bound;
      } else {
        // The stamp, for a record that writes nothing: certain, so it is not
        // lost and it is not a guess. See stampedPlace.
        var stamped = stampedPlace(item, ref, verdict, ctx);
        if (stamped) {
          clearLost(ctx, item);
          clearProbable(ctx, id, stamped);
          paintCertain(ctx, item, stamped);
          element = stamped;
        } else {
          // The write ladder has failed, and this is where the point ladder
          // gets its only turn. It runs BEFORE markLost and its result is
          // ignored by markLost, on purpose: a comment can be shown its
          // probable place and still be reported lost, because those two facts
          // are told to two different people. See "The probable place" above.
          bindProbable(item, ref, ctx);
          return markLost(item, verdict, ctx);
        }
      }
    }

    lastElement[id] = element;

    // Found for certain, which on a rebuilt page is what the stamp buys: the
    // weaker paint and the word "probable" both come off, and the passage is
    // painted like any other commented passage.
    clearProbable(ctx, id, element);

    if (isProtectedNow(ctx, element)) {
      counters.regionsSkippedProtected += 1;
      return {
        wrote: false,
        branch: null,
        lost: false,
        reason: "the reviewer is in this region",
        item: item,
        element: element
      };
    }

    clearLost(ctx, item);

    // A comment or a note has nothing to write. It resolved, so it is not lost,
    // and that is the whole of its replay.
    if (!writes(item)) {
      return { wrote: false, branch: null, lost: false, reason: "nothing to write", item: item, element: element };
    }

    // THE COMMIT SEAM. What the page tried to say in this block while the
    // reviewer had it, which protection took back off and nothing else ever
    // saw. If it is neither their version nor any version this record has had,
    // the two genuinely collide and the reviewer has to be shown both. Without
    // this the collision is invisible: the page holds the reviewer's own words
    // because protection put them back, so the compare below reads branch one
    // and the agent's rewrite is swallowed.
    //
    // It only ever FLAGS. A value that is not on the page cannot be a reason to
    // write to the page, so every other branch falls through to the DOM compare
    // below, which is the only thing a write is ever decided on.
    if (commit && writes(item)) {
      // A commit is the reviewer deciding something, so a displaced conflict
      // raised by an earlier commit stops being sticky here and this pass gets
      // to raise it again or let it go.
      if (conflicts[id] && conflicts[id].displaced) delete conflicts[id];
      var observed = observedValue(commit);
      if (typeof observed === "string" && compare(item, observed).branch === BRANCH.CONTENT_CHANGED) {
        return flagConflict(ctx, item, id, element, observed, true);
      }
    }

    var domValue = domValueOf(element, item);
    // The markup goes in beside the text so branch one can see emphasis the
    // text comparison is built to ignore (formattingLost).
    var verdictBranch = compare(item, domValue, typeof element.innerHTML === "string" ? element.innerHTML : null);
    var branch = verdictBranch.branch;

    if (branch === BRANCH.ALREADY_APPLIED) {
      counters.regionsSkippedEqual += 1;
      clearConflict(ctx, id);
      return { wrote: false, branch: branch, lost: false, reason: "idempotent", item: item, element: element };
    }

    if (branch === BRANCH.CONTENT_CHANGED) {
      return flagConflict(ctx, item, id, element, domValue);
    }

    // Branches two and three both write the CURRENT revision. Three also says
    // so on the card: an earlier version of this edit landed somewhere, which
    // the reviewer would otherwise read as their edit being applied twice.
    epoch.write("replay", function () {
      writeRegion(element, item);
    });
    counters.regionsWritten += 1;
    clearConflict(ctx, id);

    if (branch === BRANCH.EARLIER_REVISION) {
      counters.regionsEarlierRevision += 1;
      callCard(ctx, "setCardNotice", id, EARLIER_REVISION_MESSAGE);
    }

    return {
      wrote: true,
      branch: branch,
      lost: false,
      reason: branch === BRANCH.EARLIER_REVISION ? "an earlier revision had landed" : "re-applied",
      earlierAfter: verdictBranch.earlierAfter,
      item: item,
      element: element
    };
  }

  /**
   * Branch four, in one place: the badge, the card node carrying both versions
   * in full, and a result that says nothing was written. Called from the DOM
   * compare and from the commit seam, which are two ways of finding the same
   * collision and must say the same thing about it.
   *
   * @param {string} theirs what the page says, or tried to say
   */
  function flagConflict(ctx, item, id, element, theirs, displaced) {
    // The counter counts collisions ARISING, not passes re-detecting one that
    // is already standing: the still-bound rule re-runs the content
    // comparison every pass now, and a standing conflict re-counted itself
    // once per pass. The record below still refreshes (`theirs` can move
    // under a live page), only the count is once per conflict.
    if (!conflicts[id]) counters.regionsConflicted += 1;
    var yours = ours(item);
    conflicts[id] = {
      id: id,
      yours: yours,
      theirs: theirs,
      displaced: !!displaced,
      at: new Date().toISOString()
    };
    if (failures) {
      callCard(ctx, "setCardBadge", id, failures.failure("REPLAY_NEITHER_MATCHES", { yours: yours, theirs: theirs }));
    }
    var node = conflictNodeFor(ctx, id, yours, theirs);
    if (node) callCard(ctx, "attachCardNode", id, node);
    // R5. Nothing is written, in either direction.
    return {
      wrote: false,
      branch: BRANCH.CONTENT_CHANGED,
      lost: false,
      reason: "neither your version nor the one you edited is on the page",
      yours: yours,
      theirs: theirs,
      item: item,
      element: element
    };
  }

  // The reviewer's version, in full, in the shape the branch compares on.
  function ours(item) {
    var fields = record.comparisonFields(item);
    if (item[record.FIELD.KIND] === record.KIND.DELETE) return null;
    return item[fields.after];
  }

  // The one place replay touches the reviewed page. Everything above decides;
  // this writes.
  //
  // An edit writes its MARKUP when it has any, not just its text. Writing
  // textContent throws away everything the record's after_html knows: the
  // paragraph break the reviewer typed, and the emphasis that was in the block
  // before they touched it. That write was the second half of Ken's 2026-08-20
  // report, the "some edit later reverts it" half: the break survived the
  // commit and then the next replay pass flattened the block back to one line.
  function writeRegion(element, item) {
    var kind = item[record.FIELD.KIND];
    // S8, as an assertion rather than as a promise in a comment. A probable
    // place is the point ladder's guess, and the one thing a guess may never
    // receive is a write. Both halves are checked: nothing writes while the
    // ladder is being asked, and nothing writes into the element it answered
    // with. If a later change lets the probable path reach here, this throws in
    // the reviewer's face instead of quietly rewriting a paragraph the tool
    // never matched.
    var standing = probable[item[record.FIELD.ID]];
    if (guessing || (standing && standing.element === element)) {
      throw new Error(
        "replay: a probable place never receives a write. The point ladder serves the reviewer, " +
          "the write ladder serves the agent, and this record is still lost for the agent."
      );
    }
    if (kind === record.KIND.DELETE) {
      if (typeof element.remove === "function") {
        element.remove();
      } else if (element.parentNode && typeof element.parentNode.removeChild === "function") {
        element.parentNode.removeChild(element);
      }
      return;
    }
    if (kind === record.KIND.FORMAT_ONLY) {
      element.innerHTML = item[record.FIELD.AFTER_HTML];
      return;
    }
    // The markup is used only when it still says the record's after text
    // (markupSaysAfter, which the compare asks the same question of, so it can
    // never ask for a write this will not make).
    if (markupSaysAfter(item)) {
      element.innerHTML = item[record.FIELD.AFTER_HTML];
      return;
    }
    writeTextWithBreaks(element, item[record.FIELD.AFTER]);
  }

  // A record with no markup of its own, written so its breaks survive. Built
  // node by node rather than as a markup string: the text is page-derived data
  // and it goes into the page as text, never as markup.
  function writeTextWithBreaks(element, after) {
    var text = typeof after === "string" ? after : "";
    if (text.indexOf("\n") === -1) {
      element.textContent = text;
      return;
    }
    var doc = element.ownerDocument;
    element.textContent = "";
    var lines = text.split("\n");
    for (var i = 0; i < lines.length; i += 1) {
      if (i > 0) element.appendChild(doc.createElement("br"));
      if (lines[i]) element.appendChild(doc.createTextNode(lines[i]));
    }
  }

  return {
    configure: configure,
    context: context,
    lastPass: lastPass,
    conflictFor: conflictFor,
    conflictIds: conflictIds,
    resolveConflict: resolveConflict,
    CONFLICT_TITLE: CONFLICT_TITLE,
    YOURS_LABEL: YOURS_LABEL,
    THEIRS_LABEL: THEIRS_LABEL,
    KEEP_MINE_LABEL: KEEP_MINE_LABEL,
    TAKE_THEIRS_LABEL: TAKE_THEIRS_LABEL,
    REASON: REASON,
    REASONS: REASONS,
    PASS_ORDER: PASS_ORDER,
    BRANCH: BRANCH,
    formattingLost: formattingLost,
    BRANCHES: BRANCHES,
    EARLIER_REVISION_MESSAGE: EARLIER_REVISION_MESSAGE,
    counters: counters,
    resetCounters: resetCounters,
    SETTLE_MS: SETTLE_MS,
    PROBABLE_NOTICE: PROBABLE_NOTICE,
    probableElement: probableElement,
    noteSettling: noteSettling,
    isSettling: isSettling,
    // The creation-time seed for the still-bound rule: an item made ON an
    // element starts bound to it, so a matcher that can never re-find it (an
    // element pick with no unique text) does not get to call it lost while it
    // sits connected in the document. Boot calls this from comments' change
    // events; see the createdOn note in comments.js.
    bindElement: function (id, element) {
      if (id && element && element.nodeType === 1) lastElement[id] = element;
    },
    locate: locate,
    schedule: schedule,
    runPass: runPass,
    compare: compare,
    applyRecord: applyRecord,
    REVERTED_EDIT_NOTE: REVERTED_EDIT_NOTE,
    FORMATTING_LOST_NOTE: FORMATTING_LOST_NOTE,
    CHECK_REOPEN_COOLDOWN_MS: CHECK_REOPEN_COOLDOWN_MS,
    isRevertedHandledEdit: isRevertedHandledEdit,
    pageCheckReasonFor: pageCheckReasonFor,
    pageCheckNoteFor: pageCheckNoteFor,
    PAGE_CHECK_REASON: CHECK_REASON,
    revertedHandledEditIds: revertedHandledEditIds,
    pageTextOf: pageTextOf,
    pageCheckOptions: pageCheckOptions,
    uniqueness: uniqueness
  };
});
