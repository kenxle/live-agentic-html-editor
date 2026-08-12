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
      root.LAHE.protect
    );
  } else {
    module.exports = factory(
      require("../shared/epoch.js"),
      require("../shared/uniqueness.js"),
      require("../shared/normalize.js"),
      require("../shared/record.js"),
      require("../shared/failures.js"),
      require("./anchor.js"),
      require("./protect.js")
    );
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (
  epoch,
  uniqueness,
  normalize,
  record,
  failures,
  anchorEngine,
  protectModule
) {
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
  //   hooks     one function per PASS_ORDER step that replay does not own:
  //             fold_replies, merge_store, retire_handled, update_rail. A
  //             missing hook is a no-op and is reported as one in the summary,
  //             never silently skipped
  var context = {
    root: null,
    items: null,
    cards: null,
    protect: null,
    anchor: null,
    document: null,
    hooks: null
  };

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

  var CONFLICT_TITLE = "The page changed under this edit. Nothing was written.";
  var YOURS_LABEL = "Your version";
  var THEIRS_LABEL = "On the page now";

  // One node per item, reused. Building a fresh node on every pass would be the
  // rail's own law broken from the outside: a card the reviewer is reading (or
  // typing in) must not be rebuilt underneath them.
  var conflictNodes = Object.create(null);
  var conflicts = Object.create(null);

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
      node.appendChild(sideNode(doc, "yours", YOURS_LABEL));
      node.appendChild(sideNode(doc, "theirs", THEIRS_LABEL));
      conflictNodes[id] = node;
    }
    node.firstChild.textContent = CONFLICT_TITLE;
    textIn(node, "yours").textContent = yours === null || yours === undefined ? "" : String(yours);
    textIn(node, "theirs").textContent = theirs === null || theirs === undefined ? "" : String(theirs);
    node.removeAttribute("hidden");
    return node;
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

  function textIn(node, side) {
    return node.querySelector('[data-lahe-conflict-side="' + side + '"] [data-lahe-conflict-text]');
  }

  // A conflict that resolved: the node stays where it is (removing it from a
  // card the reviewer may be in is the churn this file refuses), and it is
  // emptied and hidden.
  function clearConflict(ctx, id) {
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

  var WRITING_KINDS = {};
  WRITING_KINDS[record.KIND.EDIT] = 1;
  WRITING_KINDS[record.KIND.DELETE] = 1;
  WRITING_KINDS[record.KIND.FORMAT_ONLY] = 1;

  function writes(item) {
    return Object.prototype.hasOwnProperty.call(WRITING_KINDS, item[record.FIELD.KIND]);
  }

  // The region's current value, in the shape the record compares against: the
  // markup for a format-only record, the text for everything else, and null for
  // a delete whose block is not in the document.
  function domValueOf(element, item) {
    if (!element) return null;
    if (item[record.FIELD.KIND] === record.KIND.FORMAT_ONLY) {
      return typeof element.innerHTML === "string" ? element.innerHTML : String(element.textContent || "");
    }
    return String(element.textContent === undefined || element.textContent === null ? "" : element.textContent);
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
      return "only the page structure matched, not the text, so nothing was written or moved";
    }
    return "the passage this item is about is not on this page any more";
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
    counters.regionsLost += 1;
    var region = item[record.FIELD.REGION] || record.emptyRegion();
    var next = {};
    Object.keys(region).forEach(function (key) {
      next[key] = region[key];
    });
    // The record's own lost state, which is what 3A projects into review.json.
    // review_format is not touched from here: the projection reads the record.
    next.lost = { code: "ANCHOR_LOST", reason: lostReason(verdict), at: new Date().toISOString() };
    item[record.FIELD.REGION] = next;

    if (failures) {
      callCard(
        ctx,
        "setCardBadge",
        item[record.FIELD.ID],
        failures.failure("ANCHOR_LOST", {
          verdict: verdict.reason,
          candidates: verdict.considered,
          survivors: verdict.survivors
        })
      );
    }
    return { wrote: false, branch: null, lost: true, reason: verdict.reason, item: item, element: null };
  }

  function clearLost(item) {
    var region = item[record.FIELD.REGION];
    if (!region || !region.lost) return;
    var next = {};
    Object.keys(region).forEach(function (key) {
      next[key] = region[key];
    });
    next.lost = null;
    item[record.FIELD.REGION] = next;
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
    var element = ctx.element || null;
    var verdict = null;

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
        clearLost(item);
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
      return markLost(item, verdict, ctx);
    }

    if (ctx.protect && typeof ctx.protect.isProtected === "function" && ctx.protect.isProtected(element)) {
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

    clearLost(item);

    // A comment or a note has nothing to write. It resolved, so it is not lost,
    // and that is the whole of its replay.
    if (!writes(item)) {
      return { wrote: false, branch: null, lost: false, reason: "nothing to write", item: item, element: element };
    }

    var domValue = domValueOf(element, item);
    var verdictBranch = compare(item, domValue);
    var branch = verdictBranch.branch;

    if (branch === BRANCH.ALREADY_APPLIED) {
      counters.regionsSkippedEqual += 1;
      clearConflict(ctx, id);
      return { wrote: false, branch: branch, lost: false, reason: "idempotent", item: item, element: element };
    }

    if (branch === BRANCH.CONTENT_CHANGED) {
      counters.regionsConflicted += 1;
      var yours = ours(item);
      conflicts[id] = { id: id, yours: yours, theirs: domValue, at: new Date().toISOString() };
      if (failures) {
        callCard(
          ctx,
          "setCardBadge",
          id,
          failures.failure("REPLAY_NEITHER_MATCHES", { yours: yours, theirs: domValue })
        );
      }
      var node = conflictNodeFor(ctx, id, yours, domValue);
      if (node) callCard(ctx, "attachCardNode", id, node);
      // R5. Nothing is written, in either direction.
      return {
        wrote: false,
        branch: branch,
        lost: false,
        reason: "neither your version nor the one you edited is on the page",
        yours: yours,
        theirs: domValue,
        item: item,
        element: element
      };
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

  // The reviewer's version, in full, in the shape the branch compares on.
  function ours(item) {
    var fields = record.comparisonFields(item);
    if (item[record.FIELD.KIND] === record.KIND.DELETE) return null;
    return item[fields.after];
  }

  // The one place replay touches the reviewed page. Everything above decides;
  // this writes.
  function writeRegion(element, item) {
    var kind = item[record.FIELD.KIND];
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
    element.textContent = item[record.FIELD.AFTER];
  }

  return {
    configure: configure,
    context: context,
    lastPass: lastPass,
    conflictFor: conflictFor,
    conflictIds: conflictIds,
    CONFLICT_TITLE: CONFLICT_TITLE,
    YOURS_LABEL: YOURS_LABEL,
    THEIRS_LABEL: THEIRS_LABEL,
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
    uniqueness: uniqueness
  };
});
