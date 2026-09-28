// The Library's request queue: catalog-requests.jsonl (LAHE Library, Task 1.4).
//
// Every expiry takes `now` as an argument. These tests pass a fixed clock and
// never sleep, and each time rule is tested as a pair: just inside the limit,
// and at it.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const stateDir = require("../../src/service/state_dir.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const catalogRequests = require("../../src/service/catalog_requests.js");

const C = protocol.CATALOG;
const T0 = Date.parse("2026-09-28T16:00:00.000Z");
const ALIVE_PID = 4242;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-catalog-queue-"));
}

// A state dir with the attached agent `s_attached` (attached at T0 and running a
// monitor whose heartbeat is written at T0) and a document session `s_doc`.
function world(options) {
  const opts = options || {};
  const dir = tempDir();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_attached", name: "document index" });
  store.create({ id: "s_doc" });
  store.create({ id: "s_other" });
  const heartbeatAt = opts.heartbeatAt === undefined ? T0 : opts.heartbeatAt;
  if (heartbeatAt !== null) {
    store.writeMonitor("s_attached", { pid: ALIVE_PID, handoff_rev: 0, at: new Date(heartbeatAt).toISOString() });
  }
  catalogRequests.writeAttach(dir, "s_attached", T0);
  const logged = [];
  const queue = catalogRequests.createQueue({
    dir,
    writeExpired: opts.writeExpired === true,
    pidAlive: (pid) => pid === ALIVE_PID,
    log: (line) => logged.push(line)
  });
  return { dir, store, queue, logged };
}

function lines(dir) {
  const file = stateDir.catalogRequestsPath(dir);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function ask(queue, review, nowMs, action) {
  return queue.append({ action: action || "pickup", review, session: "s_doc", for: "s_attached" }, nowMs);
}

// Keeps the attached monitor's heartbeat fresh at `nowMs`, so a test about one
// rule is not expired by another.
function beat(w, nowMs) {
  w.store.writeMonitor("s_attached", { pid: ALIVE_PID, handoff_rev: 0, at: new Date(nowMs).toISOString() });
}

test("a stored request line has exactly the documented keys, and ids only", () => {
  const w = world();
  const made = w.queue.append(
    { action: "pickup", review: "r_one", session: "s_doc", for: "s_attached", title: "<b>x</b>", path: "/etc/passwd", text: "hi" },
    T0
  );
  assert.equal(made.ok, true);
  const stored = lines(w.dir);
  assert.equal(stored.length, 1);
  assert.deepEqual(Object.keys(stored[0]).sort(), ["action", "at", "for", "id", "review", "session"]);
  assert.match(stored[0].id, /^cq_[a-f0-9]+$/);
  assert.equal(stored[0].at, new Date(T0).toISOString());
  assert.equal(made.request.id, stored[0].id);
});

test("append refuses an unknown action and unsafe ids", () => {
  const w = world();
  assert.equal(w.queue.append({ action: "delete", review: "r_one", session: "s_doc", for: "s_attached" }, T0).ok, false);
  assert.equal(w.queue.append({ action: "pickup", review: "../x", session: "s_doc", for: "s_attached" }, T0).ok, false);
  assert.equal(w.queue.append({ action: "launch", review: "r_one", session: "s_doc", for: "" }, T0).ok, false);
  assert.deepEqual(lines(w.dir), []);
});

test("one pending request per review: a second is refused with PROTO_REQUEST_PENDING", () => {
  const w = world();
  assert.equal(ask(w.queue, "r_one", T0).ok, true);
  const second = ask(w.queue, "r_one", T0 + 1000, "launch");
  assert.equal(second.ok, false);
  assert.equal(second.code, "PROTO_REQUEST_PENDING");
  assert.equal(lines(w.dir).length, 1);
});

test("the pending cap: QUEUE_CAP requests are taken and the next is refused with PROTO_QUEUE_FULL", () => {
  const w = world();
  for (let i = 0; i < C.QUEUE_CAP; i += 1) {
    assert.equal(ask(w.queue, "r_" + i, T0 + i).ok, true, "request " + i);
  }
  const over = ask(w.queue, "r_over", T0 + 100);
  assert.equal(over.ok, false);
  assert.equal(over.code, "PROTO_QUEUE_FULL");
  assert.equal(w.queue.pending(T0 + 100).length, C.QUEUE_CAP);
});

test("an answered request frees its review's slot and its share of the cap", () => {
  const w = world();
  const ids = [];
  for (let i = 0; i < C.QUEUE_CAP; i += 1) ids.push(ask(w.queue, "r_" + i, T0).request.id);
  const answered = w.queue.answer({ id: ids[0], by: "s_attached", status: "done", text: "watching it" }, T0 + 10);
  assert.equal(answered.ok, true);
  assert.equal(ask(w.queue, "r_0", T0 + 20).ok, true, "the answered review takes a new request");
  assert.equal(ask(w.queue, "r_extra", T0 + 30).code, "PROTO_QUEUE_FULL", "and the cap is full again");
});

test("an expired request frees its review's slot and its share of the cap", () => {
  const w = world();
  for (let i = 0; i < C.QUEUE_CAP; i += 1) ask(w.queue, "r_" + i, T0);
  const later = T0 + C.REQUEST_EXPIRY_MS;
  beat(w, later);
  assert.equal(w.queue.pending(later).length, 0);
  assert.equal(ask(w.queue, "r_0", later).ok, true);
  assert.equal(w.queue.pending(later).length, 1);
});

test("timeout: pending one millisecond inside REQUEST_EXPIRY_MS, expired at it", () => {
  const w = world();
  const id = ask(w.queue, "r_one", T0).request.id;
  const inside = T0 + C.REQUEST_EXPIRY_MS - 1;
  beat(w, inside);
  assert.deepEqual(w.queue.pending(inside).map((r) => r.id), [id]);
  const at = T0 + C.REQUEST_EXPIRY_MS;
  beat(w, at);
  assert.deepEqual(w.queue.pending(at), []);
  const state = w.queue.requestFor("r_one", at);
  assert.equal(state.state, "expired");
  assert.equal(state.reason, "timeout");
});

test("monitor dead: pending just inside HEARTBEAT_FRESH_MS, expired once the liveness function calls it stale", () => {
  // The liveness function in agent_sessions.js counts a heartbeat exactly
  // HEARTBEAT_FRESH_MS old as still fresh (withinMs is inclusive), so "at the
  // limit" here is the first millisecond that function reports it dead.
  const w = world();
  const id = ask(w.queue, "r_one", T0).request.id;
  const inside = T0 + protocol.MONITOR.HEARTBEAT_FRESH_MS - 1;
  assert.deepEqual(w.queue.pending(inside).map((r) => r.id), [id]);
  // Pinned: a heartbeat exactly HEARTBEAT_FRESH_MS old is still fresh. A change
  // to an exclusive comparison fails here, not somewhere downstream.
  const exactly = T0 + protocol.MONITOR.HEARTBEAT_FRESH_MS;
  assert.deepEqual(w.queue.pending(exactly).map((r) => r.id), [id], "exactly HEARTBEAT_FRESH_MS is still fresh");
  assert.equal(w.queue.requestFor("r_one", exactly).state, "waiting");
  const stale = T0 + protocol.MONITOR.HEARTBEAT_FRESH_MS + 1;
  assert.deepEqual(w.queue.pending(stale), []);
  assert.equal(w.queue.requestFor("r_one", stale).reason, "monitor_dead");
});

test("monitor dead: a fresh heartbeat whose pid is gone expires the request", () => {
  const w = world();
  ask(w.queue, "r_one", T0);
  w.store.writeMonitor("s_attached", { pid: 99999, handoff_rev: 0, at: new Date(T0).toISOString() });
  assert.deepEqual(w.queue.pending(T0 + 1), []);
  assert.equal(w.queue.requestFor("r_one", T0 + 1).reason, "monitor_dead");
});

test("a lahe command in the last few minutes keeps the request alive while the exit-on-work monitor is down", () => {
  // The monitor exits on the very request it delivers and takes its heartbeat
  // down with it. The agent's drain stamps activity, which the liveness
  // function reads as listening, so the request survives the agent working it.
  const w = world({ heartbeatAt: null });
  const id = ask(w.queue, "r_one", T0).request.id;
  fs.writeFileSync(
    stateDir.activityPath(w.dir, "s_attached"),
    JSON.stringify({ at: new Date(T0 + 1000).toISOString() })
  );
  assert.deepEqual(w.queue.pending(T0 + 2000).map((r) => r.id), [id]);
});

test("an attach to a different session expires the request; re-attaching the same session does not", () => {
  const w = world();
  const id = ask(w.queue, "r_one", T0).request.id;
  catalogRequests.writeAttach(w.dir, "s_attached", T0 + 1000);
  assert.deepEqual(w.queue.pending(T0 + 2000).map((r) => r.id), [id], "same session re-attached");
  catalogRequests.writeAttach(w.dir, "s_other", T0 + 3000);
  assert.deepEqual(w.queue.pending(T0 + 4000), []);
  assert.equal(w.queue.requestFor("r_one", T0 + 4000).reason, "attach_changed");
});

test("the expired line is appended once, by a queue that records expiry", () => {
  const w = world({ writeExpired: true });
  const id = ask(w.queue, "r_one", T0).request.id;
  const at = T0 + C.REQUEST_EXPIRY_MS;
  beat(w, at);
  w.queue.pending(at);
  w.queue.pending(at + 1);
  w.queue.requestFor("r_one", at + 2);
  const expired = lines(w.dir).filter((line) => line.expired_at);
  assert.equal(expired.length, 1);
  assert.deepEqual(Object.keys(expired[0]).sort(), ["expired_at", "id", "reason"]);
  assert.equal(expired[0].id, id);
  assert.equal(expired[0].reason, "timeout");
  assert.equal(expired[0].expired_at, new Date(at).toISOString());
});

test("a queue that does not record expiry (the CLI) never writes an expired line", () => {
  const w = world({ writeExpired: false });
  ask(w.queue, "r_one", T0);
  const at = T0 + C.REQUEST_EXPIRY_MS;
  assert.deepEqual(w.queue.pending(at), []);
  assert.equal(lines(w.dir).filter((line) => line.expired_at).length, 0);
});

test("a recorded expiry stands even when the rule that caused it no longer holds", () => {
  const w = world({ writeExpired: true });
  ask(w.queue, "r_one", T0);
  catalogRequests.writeAttach(w.dir, "s_other", T0 + 10);
  w.queue.pending(T0 + 20);
  catalogRequests.writeAttach(w.dir, "s_attached", T0 + 30);
  assert.deepEqual(w.queue.pending(T0 + 40), []);
  assert.equal(w.queue.requestFor("r_one", T0 + 40).reason, "attach_changed");
});

test("a truncated last line is skipped with a log line, and the queue still works", () => {
  const w = world();
  const id = ask(w.queue, "r_one", T0).request.id;
  fs.appendFileSync(stateDir.catalogRequestsPath(w.dir), '{"id":"cq_torn","at":"2026-09-28T16:0');
  assert.deepEqual(w.queue.pending(T0 + 1).map((r) => r.id), [id]);
  assert.equal(w.logged.length > 0, true);
  assert.match(w.logged.join("\n"), /catalog-requests\.jsonl/);
  // The next append does not join the torn fragment: it starts its own line.
  assert.equal(ask(w.queue, "r_two", T0 + 2).ok, true);
  assert.equal(w.queue.pending(T0 + 3).length, 2);
});

test("answer: done marks the request answered with the documented keys", () => {
  const w = world();
  const id = ask(w.queue, "r_one", T0).request.id;
  const result = w.queue.answer({ id, by: "s_attached", status: "done", text: "watching it" }, T0 + 5000);
  assert.equal(result.ok, true);
  const answer = lines(w.dir).find((line) => line.answered_at);
  assert.deepEqual(Object.keys(answer).sort(), ["answered_at", "by", "id", "status", "text"]);
  const state = w.queue.requestFor("r_one", T0 + 6000);
  assert.equal(state.state, "done");
  assert.equal(state.text, "watching it");
  assert.equal(state.by_name, "document index");
  assert.equal(state.answered_at, new Date(T0 + 5000).toISOString());
  assert.deepEqual(w.queue.pending(T0 + 6000), []);
});

test("answer refuses an unknown id, the wrong session, an expired request, a second answer, and a bad status", () => {
  const w = world();
  const id = ask(w.queue, "r_one", T0).request.id;
  assert.equal(w.queue.answer({ id: "cq_nope", by: "s_attached", status: "done", text: "" }, T0).reason, "unknown");
  assert.equal(w.queue.answer({ id, by: "s_other", status: "done", text: "" }, T0).reason, "not_for");
  assert.equal(w.queue.answer({ id, by: "s_attached", status: "maybe", text: "" }, T0).reason, "bad_status");
  assert.equal(w.queue.answer({ id, by: "s_attached", status: "refused", text: "first" }, T0 + 1).ok, true);
  const second = w.queue.answer({ id, by: "s_attached", status: "done", text: "second" }, T0 + 2);
  assert.equal(second.reason, "answered");
  assert.equal(second.first.text, "first");
  assert.equal(second.first.status, "refused");

  const late = ask(w.queue, "r_two", T0).request.id;
  const expiredAt = T0 + C.REQUEST_EXPIRY_MS;
  beat(w, expiredAt);
  assert.equal(w.queue.answer({ id: late, by: "s_attached", status: "done", text: "" }, expiredAt).reason, "expired");
});

test("answer text: ANSWER_TEXT_MAX characters are accepted, one more is refused", () => {
  const w = world();
  const a = ask(w.queue, "r_one", T0).request.id;
  const b = ask(w.queue, "r_two", T0).request.id;
  const over = w.queue.answer({ id: a, by: "s_attached", status: "done", text: "x".repeat(C.ANSWER_TEXT_MAX + 1) }, T0);
  assert.equal(over.ok, false);
  assert.equal(over.reason, "too_long");
  assert.equal(w.queue.answer({ id: b, by: "s_attached", status: "done", text: "x".repeat(C.ANSWER_TEXT_MAX) }, T0).ok, true);
});

test("requestFor: the latest request on a review, and an answer shows for ANSWER_SHOWN_MS", () => {
  const w = world();
  assert.equal(w.queue.requestFor("r_one", T0), null);
  const id = ask(w.queue, "r_one", T0).request.id;
  const waiting = w.queue.requestFor("r_one", T0 + 1);
  assert.equal(waiting.id, id);
  assert.equal(waiting.state, "waiting");
  assert.equal(waiting.action, "pickup");
  w.queue.answer({ id, by: "s_attached", status: "done", text: "ok" }, T0 + 10);
  assert.equal(w.queue.requestFor("r_one", T0 + 10 + C.ANSWER_SHOWN_MS - 1).state, "done");
  assert.equal(w.queue.requestFor("r_one", T0 + 10 + C.ANSWER_SHOWN_MS), null);
});

test("requestFor: a new request on the review replaces the old answer", () => {
  const w = world();
  const first = ask(w.queue, "r_one", T0).request.id;
  w.queue.answer({ id: first, by: "s_attached", status: "refused", text: "no" }, T0 + 1);
  const second = ask(w.queue, "r_one", T0 + 2, "launch").request.id;
  const state = w.queue.requestFor("r_one", T0 + 3);
  assert.equal(state.id, second);
  assert.equal(state.state, "waiting");
  assert.equal(state.action, "launch");
});

test("readAttached: the session, its name, and whether its monitor is live", () => {
  const w = world();
  const attached = w.queue.readAttached(T0 + 1);
  assert.deepEqual(attached, {
    session: "s_attached",
    name: "document index",
    at: new Date(T0).toISOString(),
    watching: true
  });
  assert.equal(w.queue.readAttached(T0 + protocol.MONITOR.HEARTBEAT_FRESH_MS + 1).watching, false);
});

test("readAttached: no attach file, a corrupt one, or an attach with no session on disk is no agent", () => {
  const w = world();
  catalogRequests.writeAttach(w.dir, "s_ghost", T0);
  assert.equal(w.queue.readAttached(T0), null);
  fs.writeFileSync(stateDir.catalogAttachPath(w.dir), "{not json");
  assert.equal(w.queue.readAttached(T0), null);
  const empty = tempDir();
  assert.equal(catalogRequests.createQueue({ dir: empty }).readAttached(T0), null);
});

test("the attach file has the documented shape, and the later of two attaches wins", () => {
  const w = world();
  catalogRequests.writeAttach(w.dir, "s_other", T0 + 5);
  const onDisk = JSON.parse(fs.readFileSync(stateDir.catalogAttachPath(w.dir), "utf8"));
  assert.deepEqual(onDisk, { schema: 1, session: "s_other", at: new Date(T0 + 5).toISOString() });
  assert.equal(w.queue.readAttached(T0 + 6).session, "s_other");
});

test("pendingFor: only the requests whose `for` is the given session", () => {
  const w = world();
  ask(w.queue, "r_one", T0);
  assert.equal(w.queue.pendingFor("s_attached", T0 + 1).length, 1);
  assert.equal(w.queue.pendingFor("s_other", T0 + 1).length, 0);
});

test("a bad line is logged once per queue, not on every poll", () => {
  const w = world();
  ask(w.queue, "r_one", T0);
  fs.appendFileSync(stateDir.catalogRequestsPath(w.dir), '{"id":"cq_torn","at":"2026-09-28T16:0');
  w.queue.pending(T0 + 1);
  w.queue.pending(T0 + 2);
  w.queue.requestFor("r_one", T0 + 3);
  assert.equal(w.logged.length, 1, w.logged.join("\n"));
});

test("a bad line that ends in a newline is a complete unreadable line, not a torn one; a tail with no newline is torn", () => {
  const w = world();
  ask(w.queue, "r_one", T0);
  fs.appendFileSync(stateDir.catalogRequestsPath(w.dir), "not json\n");
  w.queue.pending(T0 + 1);
  assert.match(w.logged.join("\n"), /an unreadable line 2 /);
  assert.doesNotMatch(w.logged.join("\n"), /torn/);
  fs.appendFileSync(stateDir.catalogRequestsPath(w.dir), "{\"id\":");
  w.queue.pending(T0 + 2);
  assert.match(w.logged[w.logged.length - 1], /a torn last line/);
});
