// THROWAWAY STUB CONSUMER: 0A-wire
//
// Committed by 0A-kernel to prove its stubs are sufficient for 0A-wire, which is
// the single reason that task exists. It calls every kernel signature 0A-wire
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 0A-wire's worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 0A-wire has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const lifecycle = require("../../src/shared/lifecycle.js");
const manifest = require("../../src/shared/manifest.js");
const fixtures = require("../../src/shared/record_fixtures.js").createFixtures({ seed: "wire" });

test("0A-wire can project an item into review.json's shape", () => {
  const item = fixtures.comment();

  // Grouping: origin plus pathname, ordered by first visit.
  assert.equal(typeof record.pageKey(item), "string");
  assert.equal(typeof item[record.FIELD.PAGE_SEQ], "number");
  assert.equal(record.pageKey(item).includes(item[record.FIELD.PAGE_PATH]), true);

  // The data-versus-intent split the contract field describes.
  assert.deepEqual(record.INTENT_FIELDS, ["note", "change"]);
  assert.equal(record.fieldClass(record.FIELD.NOTE), record.CLASS_INSTRUCTION);
  assert.equal(record.fieldClass(record.FIELD.AFTER), record.CLASS_DATA);
  assert.equal(record.fieldClass("reply.text"), record.CLASS_DATA);

  // Only ready items are actionable, and drafts never are.
  assert.deepEqual(lifecycle.ACTIONABLE_STATES, [record.STATE.READY]);
  assert.equal(record.isDraft(fixtures.draftComment()), true);
});

test("0A-wire can validate a reply line against the kernel's vocabulary", () => {
  const item = fixtures.edit();
  assert.deepEqual(record.REPLY_STATUSES.slice().sort(), ["handled", "not_handled", "question"]);
  const refused = lifecycle.applyReply(item, { rev: item.rev + 1, status: "handled" });
  assert.equal(refused.accepted, false);
  assert.equal(typeof refused.refusal, "string");
});

test("0A-wire owns exactly the files the manifest says it owns", () => {
  assert.equal(manifest.ownerOf("src/shared/protocol.js"), "0A-wire");
  assert.equal(manifest.ownerOf("src/shared/failures.js"), "0A-wire");
  assert.match(manifest.ownerOf("src/shared/review_format.js"), /^0A-wire/);
});
