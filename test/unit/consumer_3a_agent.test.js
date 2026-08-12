// THROWAWAY STUB CONSUMER: 3A (the agent loop)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 3A (the agent loop), which is
// the single reason that task exists. It calls every kernel signature 3A (the agent loop)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 3A (the agent loop)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 3A (the agent loop) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const lifecycle = require("../../src/shared/lifecycle.js");
const merge = require("../../src/shared/merge.js");
const overlay = require("../../src/layer/overlay.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "3a" });

test("3A can fold a reply into an item, and a stale one is refused", () => {
  const item = fixtures.edit();
  const ok = lifecycle.applyReply(item, { rev: item.rev, status: "handled", agent: "claude", files: ["app/views/home.html.erb"] });
  assert.equal(ok.accepted, true);
  assert.equal(ok.state, record.STATE.HANDLED);

  const reworded = record.bumpRev(item, { after: "reworded while the agent was reading" });
  const stale = lifecycle.applyReply(reworded, { rev: item.rev, status: "handled" });
  assert.equal(stale.accepted, false);
  assert.equal(stale.state, record.STATE.READY, "the rewording stays outstanding");
});

test("a question is the loudest thing on a card, and it does not retire the item", () => {
  const item = fixtures.edit();
  const asked = lifecycle.applyReply(item, { rev: item.rev, status: "question", text: "which heading?" });
  assert.equal(asked.state, record.STATE.READY);

  const rail = overlay.createRail();
  rail.upsertCard(item);
  rail.setAgentMessage(item.id, { status: "question", text: "which heading?", agent: "claude" });
  assert.equal(rail.getCard(item.id).agentMessage.loud, true);
  assert.equal(rail.getCard(item.id).agentMessage.agent, "claude");
});

test("an agent with no name in its reply is called agent on the card", () => {
  const rail = overlay.createRail();
  const item = fixtures.comment();
  rail.upsertCard(item);
  rail.setAgentMessage(item.id, { status: "not_handled", reason: "no such file" });
  assert.equal(rail.getCard(item.id).agentMessage.agent, "agent");
});

test("3A can group a review by page in first-visit order", () => {
  const items = fixtures.acrossPages();
  const keys = items.map((i) => record.pageKey(i));
  assert.equal(new Set(keys).size, 3);
  assert.deepEqual(items.map((i) => i.page_seq), [1, 2, 3]);
});

test("3A merges the helper's lifecycle back to the library without touching content", () => {
  const item = fixtures.edit();
  const handled = Object.assign({}, item, { state: record.STATE.HANDLED });
  const got = merge.mergeItem(item, handled);
  assert.equal(got.item.state, record.STATE.HANDLED);
  assert.equal(got.item.after, item.after);
});
