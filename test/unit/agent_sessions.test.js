"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sessions = require("../../src/service/agent_sessions.js");
const reviewsModule = require("../../src/service/reviews.js");
const logModule = require("../../src/service/log.js");
const reviewCommand = require("../../src/cli/commands/review.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-agent-sessions-"));
}

test("agent sessions are durable, closeable, and reopenable", () => {
  let n = 0;
  const dir = tempDir();
  const store = sessions.createStore({ dir, now: () => "time-" + (++n) });
  const made = store.create();
  assert.match(made.id, /^s_[a-f0-9]+$/);
  assert.equal(store.requireOpen(made.id).closed_at, null);
  assert.equal(store.openSessions().length, 1);

  store.close(made.id);
  assert.throws(() => store.requireOpen(made.id), /is closed/);
  assert.equal(store.openSessions().length, 0);

  store.reopen(made.id);
  assert.equal(store.requireOpen(made.id).closed_at, null);
  assert.equal(sessions.createStore({ dir }).read(made.id).id, made.id);
});

test("an explicit takeover advances stewardship without moving owned reviews", () => {
  let n = 0;
  const dir = tempDir();
  const store = sessions.createStore({ dir, now: () => "time-" + (++n) });
  const made = store.create({ id: "s_handoff" });
  assert.equal(sessions.handoffRev(made), 0);

  store.close(made.id);
  const handedOff = store.takeover(made.id);
  assert.equal(handedOff.closed_at, null);
  assert.equal(handedOff.handoff_rev, 1);
  assert.equal(handedOff.taken_over_at, "time-3");

  const again = store.takeover(made.id);
  assert.equal(again.handoff_rev, 2);
  assert.equal(store.requireOpen(made.id).id, made.id);
});

test("legacy is synthetic and cannot be opened or mutated", () => {
  const store = sessions.createStore({ dir: tempDir() });
  assert.equal(store.read(sessions.LEGACY_ID).synthetic, true);
  assert.throws(() => store.requireOpen(sessions.LEGACY_ID), /unknown/);
  assert.throws(() => store.create({ id: sessions.LEGACY_ID }), /invalid/);
});

test("corrupt session metadata fails loud", () => {
  const dir = tempDir();
  const store = sessions.createStore({ dir });
  const made = store.create({ id: "s_broken" });
  fs.writeFileSync(path.join(dir, "agent-sessions", made.id, "session.json"), "not json");
  assert.throws(() => store.read(made.id), /unreadable session\.json/);
});

test("review ownership is immutable and ambiguous target re-entry fails loud", () => {
  const dir = tempDir();
  const target = path.join(dir, "same.html");
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  reviews.create({ id: "r_one", target_path: target, agent_session_id: "s_one" });
  assert.throws(
    () => reviews.create({ id: "r_one", agent_session_id: "s_two" }),
    /belongs to agent session s_one/
  );
  reviews.create({ id: "r_two", target_path: target, agent_session_id: "s_two" });
  assert.throws(() => reviewCommand.inferSession(dir, target), /more than one agent session/);
});
