"use strict";

// A session bare `lahe library` started closes itself when idle (Ken's
// decision, adversary fixes).
//
// Bare `lahe library` starts a fresh session every run, so an agent that runs
// it and goes away leaves one behind each time. The CLI marks such a session in
// session.json (`created_by: "library"`); the helper never writes that field.
// The helper's sweep closes a marked session once it owns no reviews and its
// agent has been quiet for CATALOG.LIBRARY_SESSION_IDLE_MS: no live monitor
// heartbeat and no lahe command in that window. A session that has gained a
// review, or was taken over, is left alone.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const stateDir = require("../../src/service/state_dir.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const catalogStore = require("../../src/service/catalog_store.js");
const catalogActions = require("../../src/service/catalog_actions.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const library = require("../../src/cli/commands/library.js");
const { onFreePort } = require("../helpers/free_port.js");

const C = protocol.CATALOG;
const T0 = Date.parse("2026-09-29T16:00:00.000Z");
const MINUTE = 60 * 1000;

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-library-autoclose-")));
}

/** A store whose clock is `clock.at`, and actions over it with a recording closeQuiet. */
function world() {
  const dir = tempDir();
  const clock = { at: T0 };
  const store = agentSessions.createStore({ dir, now: () => new Date(clock.at).toISOString() });
  const closed = [];
  const actions = catalogActions.createCatalogActions({
    dir,
    reader: { describeReview: () => null },
    queue: { readAttached: () => null },
    store: catalogStore.createCatalogStore({ dir }),
    ops: { closeQuiet: async (id) => { closed.push(id); store.close(id); } },
    sessions: store,
    log: () => {},
    pidAlive: () => true
  });
  return { dir, clock, store, actions, closed };
}

function librarySession(w, id) {
  return w.store.create({ id, created_by: C.CREATED_BY_LIBRARY });
}

test("the CLI marks a session bare lahe library started, and not one it was given", async (t) => {
  const dir = tempDir();
  const { port } = await onFreePort((p) => sessionCommand.startHelper(dir, p));
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir); });
  const out = [];
  await library.run(["--state-dir", dir, "--port", String(port), "--json"], { stdout: (x) => out.push(x), stderr: () => {} });
  const made = JSON.parse(out.join("").trim()).session;
  const store = agentSessions.createStore({ dir });
  assert.equal(store.read(made).created_by, C.CREATED_BY_LIBRARY);
  store.create({ id: "s_mine" });
  await library.run(["--session", "s_mine", "--state-dir", dir, "--port", String(port)], { stdout: () => {}, stderr: () => {} });
  assert.equal(store.read("s_mine").created_by, undefined, "a session passed with --session is not marked");
});

test("a quiet Library-started session with no reviews closes at exactly the limit", async () => {
  const w = world();
  librarySession(w, "s_lib");
  const out = await w.actions.sweepLibrarySessions(T0 + C.LIBRARY_SESSION_IDLE_MS);
  assert.deepEqual(out.closed, ["s_lib"]);
  assert.ok(w.store.read("s_lib").closed_at);
});

test("one millisecond under the limit it is left open", async () => {
  const w = world();
  librarySession(w, "s_lib");
  const out = await w.actions.sweepLibrarySessions(T0 + C.LIBRARY_SESSION_IDLE_MS - 1);
  assert.deepEqual(out.closed, []);
  assert.equal(w.store.read("s_lib").closed_at, null);
});

test("a lahe command in the window counts from the command, not from the start", async () => {
  const w = world();
  librarySession(w, "s_lib");
  w.clock.at = T0 + 20 * MINUTE;
  w.store.touchActivity("s_lib");
  assert.deepEqual((await w.actions.sweepLibrarySessions(T0 + C.LIBRARY_SESSION_IDLE_MS)).closed, []);
  assert.deepEqual((await w.actions.sweepLibrarySessions(T0 + 20 * MINUTE + C.LIBRARY_SESSION_IDLE_MS)).closed, ["s_lib"]);
});

test("a live monitor heartbeat keeps it open", async () => {
  const w = world();
  librarySession(w, "s_lib");
  const at = T0 + C.LIBRARY_SESSION_IDLE_MS;
  const rev = agentSessions.handoffRev(w.store.read("s_lib"));
  w.store.writeMonitor("s_lib", { pid: process.pid, handoff_rev: rev, at: new Date(at).toISOString() });
  assert.deepEqual((await w.actions.sweepLibrarySessions(at)).closed, []);
});

test("once it owns a review it is left alone", async () => {
  const w = world();
  librarySession(w, "s_lib");
  reviewsModule.createReviews({ dir: w.dir, log: logModule.createEventLog({ dir: w.dir }) })
    .create({ id: "r_doc", agent_session_id: "s_lib" });
  assert.deepEqual((await w.actions.sweepLibrarySessions(T0 + 2 * C.LIBRARY_SESSION_IDLE_MS)).closed, []);
});

test("a taken-over session is left alone", async () => {
  const w = world();
  librarySession(w, "s_lib");
  w.store.takeover("s_lib");
  assert.ok(agentSessions.handoffRev(w.store.read("s_lib")) > 0);
  assert.deepEqual((await w.actions.sweepLibrarySessions(T0 + 2 * C.LIBRARY_SESSION_IDLE_MS)).closed, []);
});

test("a session nobody marked is never closed by this sweep", async () => {
  const w = world();
  w.store.create({ id: "s_plain" });
  assert.deepEqual((await w.actions.sweepLibrarySessions(T0 + 2 * C.LIBRARY_SESSION_IDLE_MS)).closed, []);
});

test("the helper's timer runs this sweep too", async (t) => {
  const service = require("../../src/service/index.js");
  const dir = tempDir();
  const ticks = [];
  const schedule = (fn, ms) => { ticks.push({ fn, ms }); return { unref() {} }; };
  const store = agentSessions.createStore({ dir, now: () => new Date(T0).toISOString() });
  store.create({ id: "s_lib", created_by: C.CREATED_BY_LIBRARY });
  const clock = { now: T0 };
  const helper = await service.serve({ port: 0, stateDir: dir, quiet: true, now: () => clock.now, schedule });
  t.after(() => helper.close());
  clock.now = T0 + C.LIBRARY_SESSION_IDLE_MS;
  await ticks[0].fn();
  assert.ok(agentSessions.createStore({ dir }).read("s_lib").closed_at, "closed by the timer's run");
  assert.ok(fs.existsSync(stateDir.readyPath(dir)), "the helper itself stays up");
});
