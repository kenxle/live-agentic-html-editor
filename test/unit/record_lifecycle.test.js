// The record shape and the lifecycle transition table.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const lifecycle = require("../../src/shared/lifecycle.js");

function anItem(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.EDITED,
        target: "http://localhost:3000/clients",
        before: "old wording",
        after: "new wording"
      },
      overrides || {}
    )
  );
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

test("every field architecture D4 names is present on a new item", () => {
  const item = anItem();
  const expected = [
    "id",
    "rev",
    "kind",
    "group",
    "target",
    "state",
    "feedback",
    "before",
    "after",
    "before_html",
    "after_html",
    "moved_before",
    "moved_after",
    "region",
    "context",
    "reply",
    "delivered",
    "ack",
    "verification",
    "created_at",
    "updated_at",
    "diagnostics"
  ];
  for (const field of expected) {
    assert.equal(Object.prototype.hasOwnProperty.call(item, field), true, `missing field ${field}`);
  }
});

test("the region reference carries its lost-anchor state as a named field (R17)", () => {
  const item = anItem();
  assert.deepEqual(Object.keys(item.region).sort(), ["label", "lost", "ref"]);
});

test("ids are unique and minted in the browser", () => {
  const seen = new Set();
  for (let i = 0; i < 500; i += 1) seen.add(record.randomId("itm"));
  assert.equal(seen.size, 500);
});

test("newItem refuses an unknown kind and a missing target", () => {
  assert.throws(() => record.newItem({ kind: "nonsense", target: "/x" }), /kind must be one of/);
  assert.throws(() => record.newItem({ kind: record.KIND.NOTE }), /target/);
});

test("bumpRev increments rev, which is what stops an ack swallowing a rewording", () => {
  const first = anItem();
  const second = record.bumpRev(first, { after: "reworded" });
  assert.equal(second.rev, first.rev + 1);
  assert.equal(second.after, "reworded");
  assert.equal(second.id, first.id);
});

test("validateItem reports every problem at once rather than the first", () => {
  const broken = anItem();
  broken.rev = 0;
  broken.state = "nonsense";
  assert.throws(
    () => record.validateItem(broken),
    (err) => /rev must be/.test(err.message) && /state must be/.test(err.message)
  );
});

test("the overall note is an item like any other (R20)", () => {
  const note = record.newItem({
    kind: record.KIND.NOTE,
    target: "http://localhost:3000/clients",
    feedback: "The whole flow feels one step too long."
  });
  record.validateItem(note);
  assert.equal(note.state, record.STATE.OUTSTANDING);
  assert.equal(lifecycle.isSendEnabled(lifecycle.countOutstanding([note])), true);
});

test("the state named for a deleted item is not the same word as the deleted kind", () => {
  // One word meaning two things in the same record is how a builder writes the
  // wrong comparison.
  assert.equal(record.STATES.includes("deleted"), false);
  assert.equal(record.KINDS.includes("deleted"), true);
  assert.equal(record.STATE.DISCARDED, "discarded");
});

test("every field is classified as instruction or data (D10)", () => {
  assert.equal(record.fieldClass("after"), record.CLASS_INSTRUCTION);
  assert.equal(record.fieldClass("feedback"), record.CLASS_INSTRUCTION);
  assert.equal(record.fieldClass("before"), record.CLASS_DATA);
  assert.equal(record.fieldClass("before_html"), record.CLASS_DATA);
  assert.equal(record.fieldClass("context.quote"), record.CLASS_DATA);
  // An unknown field defaults to data. Failing safe here means a new field
  // added by a later task is fenced until someone decides otherwise.
  assert.equal(record.fieldClass("something_new"), record.CLASS_DATA);
});

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

test("an item event is a full snapshot with a client-minted id (D6)", () => {
  const item = anItem();
  const ev = record.itemUpsertEvent(item, { actor: record.ACTOR.REVIEWER, review: "rev_1" });
  assert.match(ev.event_id, /^evt_[0-9a-f]{24}$/);
  assert.equal(ev.seq, null, "seq is assigned by the service, not the client");
  assert.deepEqual(ev.payload.item, item);
  assert.equal(ev.target, item.target);
});

test("newEvent refuses an unknown type and a missing actor", () => {
  assert.throws(() => record.newEvent("nope", {}, { actor: "reviewer" }), /unknown type/);
  assert.throws(() => record.newEvent(record.EVENT.REVIEW_SEND, {}, {}), /actor must be/);
});

// ---------------------------------------------------------------------------
// The lifecycle
// ---------------------------------------------------------------------------

test("the agent may only move an item out of delivered", () => {
  const A = record.ACTOR.AGENT;
  const S = record.STATE;
  assert.equal(lifecycle.canTransition(S.DELIVERED, S.APPLIED, A), true);
  assert.equal(lifecycle.canTransition(S.DELIVERED, S.DECLINED, A), true);
  // The forged burn-down with a friendly face.
  assert.equal(lifecycle.canTransition(S.OUTSTANDING, S.APPLIED, A), false);
  assert.equal(lifecycle.canTransition(S.DECLINED, S.APPLIED, A), false);
  assert.equal(lifecycle.canTransition(S.OUTSTANDING, S.DISCARDED, A), false);
});

test("the service makes no lifecycle transition on its own initiative", () => {
  for (const t of lifecycle.TRANSITIONS) {
    assert.notEqual(t.actor, record.ACTOR.SERVICE);
  }
});

test("a declined item can be reopened, and an applied item can too (R58)", () => {
  const R = record.ACTOR.REVIEWER;
  const S = record.STATE;
  assert.equal(lifecycle.canTransition(S.DECLINED, S.OUTSTANDING, R), true);
  assert.equal(lifecycle.canTransition(S.APPLIED, S.OUTSTANDING, R), true);
});

test("an illegal transition throws rather than being ignored", () => {
  assert.throws(
    () => lifecycle.assertTransition(record.STATE.APPLIED, record.STATE.DELIVERED, record.ACTOR.AGENT),
    /illegal lifecycle transition/
  );
});

test("an ack applies only for the revision it names (D4)", () => {
  const item = anItem();
  assert.equal(lifecycle.ackApplies(item, 1), true);
  const reworded = record.bumpRev(item, { after: "reworded after delivery" });
  assert.equal(lifecycle.ackApplies(reworded, 1), false, "the older rev must not win");
  assert.equal(lifecycle.ackApplies(reworded, 2), true);
});

// ---------------------------------------------------------------------------
// Send enablement (plan test 2's static half)
// ---------------------------------------------------------------------------

test("send enablement takes exactly one input and it is not agent presence", () => {
  assert.equal(lifecycle.isSendEnabled.length, 1, "one parameter, so presence cannot be passed in");
  const source = lifecycle.isSendEnabled.toString();
  assert.equal(/presence/i.test(source), false, "presence must not appear in the enablement expression");
  assert.equal(/agent/i.test(source), false, "no agent concept in the enablement expression");
});

test("send is enabled whenever anything is outstanding and never otherwise", () => {
  assert.equal(lifecycle.isSendEnabled(0), false);
  assert.equal(lifecycle.isSendEnabled(1), true);
  assert.equal(lifecycle.isSendEnabled(300), true);
  // No latch: a delivered item does not count, a newly created one does.
  const delivered = anItem({ state: record.STATE.DELIVERED });
  const fresh = anItem();
  assert.equal(lifecycle.countOutstanding([delivered]), 0);
  assert.equal(lifecycle.countOutstanding([delivered, fresh]), 1);
});
