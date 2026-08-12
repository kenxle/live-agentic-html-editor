// The item lifecycle transition table, and who may make each transition.
//
// Owner: Task 0a (shared kernel). Imported by: the store (1B-ii), the service
// and its projection (1A), the rail (1B-i), the ack path (3A), the CLI (1D).
//
// Architecture's "Item lifecycle" state diagram is this table. Two things it
// leaves implicit and this module makes explicit:
//
//  1. Every transition names an actor. The agent may only move an item out of
//     delivered, and only for the revision it named. Everything else is the
//     reviewer's. The service makes no transition on its own initiative; it
//     records the ones it is told about. Without the actor column, a builder
//     writing the ack handler has nothing stopping it from moving an
//     outstanding item straight to applied, which is the forged-burn-down
//     failure with a friendly face.
//
//  2. A transition attempted outside the table throws. Fail loud: a silently
//     ignored transition is a burn-down that stops matching the log.
//
// Dual-environment module. See docs/CONTRACTS.md, "How a shared module loads".
(function (root, factory) {
  "use strict";
  var browser = typeof window !== "undefined" && !!window.document;
  if (browser) {
    root.LAHE = root.LAHE || {};
    root.LAHE.lifecycle = factory(root.LAHE.record);
  } else {
    module.exports = factory(require("./record.js"));
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function (record) {
  "use strict";

  var STATE = record.STATE;
  var ACTOR = record.ACTOR;

  // from -> to, with the actor allowed to make it and why it exists.
  var TRANSITIONS = [
    {
      from: null,
      to: STATE.OUTSTANDING,
      actor: ACTOR.REVIEWER,
      why: "the reviewer creates a comment, an edit, or the overall note"
    },
    {
      from: STATE.OUTSTANDING,
      to: STATE.OUTSTANDING,
      actor: ACTOR.REVIEWER,
      why: "rewords, retypes, or undoes; bumps rev and stays outstanding"
    },
    {
      from: STATE.OUTSTANDING,
      to: STATE.DELIVERED,
      actor: ACTOR.REVIEWER,
      why: "send. Recorded by the service, initiated by the reviewer"
    },
    {
      from: STATE.DELIVERED,
      to: STATE.OUTSTANDING,
      actor: ACTOR.REVIEWER,
      why: "the reviewer edits a delivered item again; the newer rev ships next"
    },
    {
      from: STATE.DELIVERED,
      to: STATE.APPLIED,
      actor: ACTOR.AGENT,
      why: "ack applied for the rev it names; verification runs after"
    },
    {
      from: STATE.DELIVERED,
      to: STATE.DECLINED,
      actor: ACTOR.AGENT,
      why: "ack declined with a reason"
    },
    {
      from: STATE.DECLINED,
      to: STATE.OUTSTANDING,
      actor: ACTOR.REVIEWER,
      why: "the reviewer reopens it, usually with an answer attached"
    },
    {
      from: STATE.APPLIED,
      to: STATE.OUTSTANDING,
      actor: ACTOR.REVIEWER,
      why: "R58: the reviewer looks at a completed item and reopens it because the fix did not land"
    },
    {
      from: STATE.OUTSTANDING,
      to: STATE.DISCARDED,
      actor: ACTOR.REVIEWER,
      why: "the reviewer deletes the item"
    }
  ];

  // Terminal for the burn-down, not for the record: an applied item moves to
  // the Completed list and is never deleted (D8).
  var COMPLETED_STATES = [STATE.APPLIED];

  function findTransition(from, to, actor) {
    for (var i = 0; i < TRANSITIONS.length; i += 1) {
      var t = TRANSITIONS[i];
      if (t.from === from && t.to === to && t.actor === actor) return t;
    }
    return null;
  }

  function canTransition(from, to, actor) {
    return findTransition(from, to, actor) !== null;
  }

  // Returns `to` when the transition is legal, throws otherwise. Callers use
  // the return value so an ignored result is a lint-visible mistake.
  function assertTransition(from, to, actor) {
    if (!canTransition(from, to, actor)) {
      throw new Error(
        "illegal lifecycle transition: " +
          String(from) +
          " -> " +
          String(to) +
          " by " +
          String(actor) +
          ". Legal transitions are listed in src/shared/lifecycle.js"
      );
    }
    return to;
  }

  // D4 and D6: lifecycle wins, but only for the revision it names. An ack for
  // rev 3 applied to an item now at rev 4 is refused, and the newer revision
  // survives as outstanding and ships next.
  function ackApplies(item, ackRev) {
    if (typeof ackRev !== "number") {
      throw new TypeError("ackApplies: ackRev must be a number");
    }
    return item[record.FIELD.REV] === ackRev;
  }

  // ---------------------------------------------------------------------------
  // Send enablement (R4, brief symptom "the send control stopped working")
  // ---------------------------------------------------------------------------
  //
  // The whole rule, in one pure function, with exactly one parameter. Agent
  // presence is displayed next to the button and is NEVER an input here (D7).
  // Test #2 in the plan asserts this statically: one parameter, and the
  // function's own source mentions nothing about presence. Keep it that way:
  // in the tool being replaced, displaying presence is how presence became a
  // gate.
  function isSendEnabled(outstandingCount) {
    return typeof outstandingCount === "number" && outstandingCount > 0;
  }

  function countOutstanding(items) {
    var n = 0;
    for (var i = 0; i < items.length; i += 1) {
      if (items[i][record.FIELD.STATE] === STATE.OUTSTANDING) n += 1;
    }
    return n;
  }

  return {
    TRANSITIONS: TRANSITIONS,
    COMPLETED_STATES: COMPLETED_STATES,
    canTransition: canTransition,
    assertTransition: assertTransition,
    findTransition: findTransition,
    ackApplies: ackApplies,
    isSendEnabled: isSendEnabled,
    countOutstanding: countOutstanding
  };
});
