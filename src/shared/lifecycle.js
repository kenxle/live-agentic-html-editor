// The item lifecycle transition table, and who may make each transition.
//
// Owner: 0A-kernel. Imported by: the store (1B), the helper's projection (3A),
// the rail (1B), reply folding (3A), the comment surface (1D).
//
// The architecture's "Item lifecycle" state diagram is this table. FOUR states,
// and the two things people keep turning into a fifth:
//
//   draft        the reviewer is still thinking. Durable, never actionable
//   ready        the reviewer said an agent may act on it (Cmd-Enter, or an
//                edit committing)
//   handled      an agent said it made the change
//   not_handled  an agent said it did not, with a reason the reviewer reads
//
//   `question` is a REPLY STATUS, not a state. An agent asking a question
//   leaves the item in ready, because the work is still outstanding and the
//   card is where the question is answered.
//
//   `reopened` is a TRANSITION, handled back to ready, not a state. An item
//   that has been reopened is simply ready again.
//
// Two things the diagram leaves implicit and this module makes explicit:
//
//  1. EVERY TRANSITION NAMES AN ACTOR. The agent may only move an item out of
//     ready, and only for the revision it named. Everything else is the
//     reviewer's. The helper makes no transition on its own initiative; it
//     records the ones it is told about. Without the actor column, a builder
//     writing the reply handler has nothing stopping it from moving a draft
//     straight to handled, which is silent loss of the reviewer's work with a
//     friendly face on it.
//
//  2. A TRANSITION ATTEMPTED OUTSIDE THE TABLE THROWS. Fail loud: a silently
//     ignored transition is a rail that stops matching the log.
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
  var FIELD = record.FIELD;

  // Who may move an item. The helper is deliberately not in this list as an
  // initiator: it appends what it is told and projects the result.
  var ACTOR = { REVIEWER: "reviewer", AGENT: "agent", HELPER: "helper" };
  var ACTORS = [ACTOR.REVIEWER, ACTOR.AGENT, ACTOR.HELPER];

  // from -> to, with the actor allowed to make it and why it exists.
  var TRANSITIONS = [
    {
      from: null,
      to: STATE.DRAFT,
      actor: ACTOR.REVIEWER,
      why: "the reviewer starts typing a comment, a note, or an edit"
    },
    {
      from: STATE.DRAFT,
      to: STATE.DRAFT,
      actor: ACTOR.REVIEWER,
      why: "the reviewer keeps typing. Every keystroke is durable; rev does not move for a draft"
    },
    {
      from: STATE.DRAFT,
      to: STATE.READY,
      actor: ACTOR.REVIEWER,
      why: "Cmd-Enter on a comment, or an edit committing. R7: the reviewer decides when it is ready"
    },
    {
      from: STATE.READY,
      to: STATE.READY,
      actor: ACTOR.REVIEWER,
      why: "the reviewer rewords. Bumps rev, so replies naming the old rev are refused (R21)"
    },
    {
      from: STATE.READY,
      to: STATE.HANDLED,
      actor: ACTOR.AGENT,
      why: "a reply naming the item's CURRENT rev says it made the change"
    },
    {
      from: STATE.READY,
      to: STATE.NOT_HANDLED,
      actor: ACTOR.AGENT,
      why: "a reply with a reason, which lands on the item's own card (R34)"
    },
    {
      from: STATE.NOT_HANDLED,
      to: STATE.READY,
      actor: ACTOR.REVIEWER,
      why: "the reviewer answers or rewords it and puts it back in front of the agent"
    },
    {
      from: STATE.HANDLED,
      to: STATE.READY,
      actor: ACTOR.REVIEWER,
      why: "REOPENED. R38: handled items are kept, and the reviewer reopens one whose fix did not land"
    }
  ];

  // Deletion is reachable from draft and ready only. A handled item is kept as
  // the record that a fix landed (R38), so the only way out of handled is
  // reopening it. The reviewer deletes their own outstanding work, never the
  // history.
  var DELETABLE_FROM = [STATE.DRAFT, STATE.READY];

  // Terminal for the rail's Active tab, not for the record: a handled item
  // moves to the Done tab and is never removed.
  var DONE_STATES = [STATE.HANDLED];

  // The states an agent is allowed to see as actionable. Drafts never reach an
  // agent, by design (R7).
  var ACTIONABLE_STATES = [STATE.READY];

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
  // the return value so an ignored result is a visible mistake.
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

  function canDelete(from, actor) {
    return actor === ACTOR.REVIEWER && DELETABLE_FROM.indexOf(from) !== -1;
  }

  // ---------------------------------------------------------------------------
  // The revision rule (R9, R21)
  // ---------------------------------------------------------------------------
  //
  // An agent may only move an item that names the item's CURRENT revision. A
  // reply naming rev 2 cannot retire rev 3: the reviewer reworded after the
  // agent read it, so their rewording stays outstanding and the reply is
  // refused. This is the rule a stale "handled" would otherwise walk straight
  // through.
  function replyApplies(item, replyRev) {
    if (typeof replyRev !== "number") {
      throw new TypeError("replyApplies: replyRev must be a number");
    }
    return item[FIELD.REV] === replyRev;
  }

  // The whole decision about what one reply line does to one item, in one pure
  // function, so the helper (3A) and the library (1B) cannot disagree about it.
  //
  // @param {Object} item the item as it stands now
  // @param {Object} reply {rev, status, agent, reason, text, files}
  // @returns {Object} {accepted, state, refusal}
  function applyReply(item, reply) {
    var r = reply || {};
    if (record.REPLY_STATUSES.indexOf(r.status) === -1) {
      return { accepted: false, state: item[FIELD.STATE], refusal: "unknown reply status " + String(r.status) };
    }
    if (!replyApplies(item, r.rev)) {
      return {
        accepted: false,
        state: item[FIELD.STATE],
        refusal:
          "reply names rev " +
          String(r.rev) +
          " but the item is at rev " +
          String(item[FIELD.REV]) +
          "; the reviewer reworded it, so it stays outstanding"
      };
    }
    // A question leaves the item exactly where it is. It is the loudest thing
    // on the card, and it is not a state change.
    if (r.status === record.REPLY_STATUS.QUESTION) {
      return { accepted: true, state: item[FIELD.STATE], refusal: null };
    }
    var to = r.status === record.REPLY_STATUS.HANDLED ? STATE.HANDLED : STATE.NOT_HANDLED;
    if (!canTransition(item[FIELD.STATE], to, ACTOR.AGENT)) {
      return {
        accepted: false,
        state: item[FIELD.STATE],
        refusal:
          "an agent may not move an item from " +
          String(item[FIELD.STATE]) +
          " to " +
          to +
          "; only a ready item is actionable"
      };
    }
    return { accepted: true, state: to, refusal: null };
  }

  // ---------------------------------------------------------------------------
  // Counting, for the rail's tabs
  // ---------------------------------------------------------------------------

  function countByState(items) {
    var counts = {};
    for (var s = 0; s < record.STATES.length; s += 1) counts[record.STATES[s]] = 0;
    for (var i = 0; i < items.length; i += 1) {
      var st = items[i][FIELD.STATE];
      if (Object.prototype.hasOwnProperty.call(counts, st)) counts[st] += 1;
    }
    return counts;
  }

  function countOutstanding(items) {
    var n = 0;
    for (var i = 0; i < items.length; i += 1) {
      if (record.isOutstanding(items[i])) n += 1;
    }
    return n;
  }

  return {
    ACTOR: ACTOR,
    ACTORS: ACTORS,
    TRANSITIONS: TRANSITIONS,
    DELETABLE_FROM: DELETABLE_FROM,
    DONE_STATES: DONE_STATES,
    ACTIONABLE_STATES: ACTIONABLE_STATES,
    canTransition: canTransition,
    assertTransition: assertTransition,
    findTransition: findTransition,
    canDelete: canDelete,
    replyApplies: replyApplies,
    applyReply: applyReply,
    countByState: countByState,
    countOutstanding: countOutstanding
  };
});
