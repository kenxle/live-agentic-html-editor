"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const routes = require("../../src/service/routes.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const projectionModule = require("../../src/service/projection.js");
const record = require("../../src/shared/record.js");
const syncModule = require("../../src/layer/sync.js");

const NOW = Date.parse("2026-08-18T12:00:00.000Z");
const STATE = protocol.AGENT_LIVENESS.STATE;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-liveness-"));
}

function agoMs(ms) {
  return new Date(NOW - ms).toISOString();
}

test("watching: a fresh heartbeat for this handoff rev, whatever else is true", () => {
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 2 },
    monitor: { pid: 1, handoff_rev: 2, at: agoMs(5000) },
    activity: null,
    unanswered: 3,
    oldestUnansweredAt: agoMs(600000),
    nowMs: NOW
  });
  assert.equal(out.state, STATE.WATCHING);
  assert.equal(out.monitor_at, agoMs(5000));
  assert.equal(out.unanswered, 3);
  assert.equal(out.oldest_unanswered_at, agoMs(600000));
});

test("working: no live monitor, but unanswered work and a recent lahe command", () => {
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    monitor: { pid: 1, handoff_rev: 0, at: agoMs(protocol.MONITOR.HEARTBEAT_FRESH_MS + 1000) },
    activity: { at: agoMs(30000) },
    unanswered: 2,
    nowMs: NOW
  });
  assert.equal(out.state, STATE.WORKING);
  // The timestamp is still reported: the rail says how long ago the monitor was
  // last heard from. It just does not make the state watching.
  assert.equal(out.monitor_at, agoMs(protocol.MONITOR.HEARTBEAT_FRESH_MS + 1000));
  assert.equal(out.activity_at, agoMs(30000));
});

test("unattended: unanswered work, no heartbeat, and nothing has run in minutes", () => {
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    monitor: null,
    activity: { at: agoMs(protocol.MONITOR.ACTIVITY_FRESH_MS + 1000) },
    unanswered: 7,
    oldestUnansweredAt: agoMs(900000),
    nowMs: NOW
  });
  assert.equal(out.state, STATE.UNATTENDED);
  assert.equal(out.unanswered, 7);
  assert.equal(out.oldest_unanswered_at, agoMs(900000));
});

test("none: nothing is waiting, so nobody missing is not an alarm", () => {
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    monitor: null,
    activity: null,
    unanswered: 0,
    nowMs: NOW
  });
  assert.equal(out.state, STATE.NONE);
  assert.equal(out.unanswered, 0);
  assert.equal(out.oldest_unanswered_at, null);
});

test("a heartbeat from before a takeover never claims the new agent is watching", () => {
  const out = agentSessions.livenessFrom({
    // The session has moved on; the old monitor has not noticed yet.
    session: { handoff_rev: 1 },
    monitor: { pid: 1, handoff_rev: 0, at: agoMs(1000) },
    activity: null,
    unanswered: 1,
    nowMs: NOW
  });
  assert.equal(out.state, STATE.UNATTENDED);
  assert.equal(out.monitor_at, null);
});

test("the heartbeat window is three of the monitor's own loops", () => {
  const session = { handoff_rev: 0 };
  const justInside = agentSessions.livenessFrom({
    session: session,
    monitor: { pid: 1, handoff_rev: 0, at: agoMs(protocol.MONITOR.HEARTBEAT_FRESH_MS - 1) },
    unanswered: 1,
    nowMs: NOW
  });
  const justOutside = agentSessions.livenessFrom({
    session: session,
    monitor: { pid: 1, handoff_rev: 0, at: agoMs(protocol.MONITOR.HEARTBEAT_FRESH_MS + 1) },
    unanswered: 1,
    nowMs: NOW
  });
  assert.equal(protocol.MONITOR.HEARTBEAT_FRESH_MS, 45000);
  assert.equal(justInside.state, STATE.WATCHING);
  assert.equal(justOutside.state, STATE.UNATTENDED);
});

test("the store reads the heartbeat and the activity stamp off disk", () => {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir: dir });
  store.create({ id: "s_disk" });

  assert.equal(store.liveness("s_disk", { unanswered: 1 }).state, STATE.UNATTENDED);

  store.touchActivity("s_disk");
  assert.equal(store.liveness("s_disk", { unanswered: 1 }).state, STATE.WORKING);

  store.writeMonitor("s_disk", { pid: process.pid, handoff_rev: 0 });
  assert.equal(store.liveness("s_disk", { unanswered: 1 }).state, STATE.WATCHING);
});

// ---------------------------------------------------------------------------
// Through the wire
// ---------------------------------------------------------------------------

test("replies.poll answers with the owning session's liveness", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const store = agentSessions.createStore({ dir: dir });
  store.create({ id: "s_wire" });
  reviews.create({ id: "r_wire", agent_session_id: "s_wire" });

  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "the reviewer's own words",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/p.html",
    page_title: "Page",
    page_seq: 1
  });
  log.append("r_wire", [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "ev_ready",
      review: "r_wire",
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item }
    })
  ]);

  const deps = { log: log, reviews: reviews, agentSessions: store, projection: projectionModule };
  const poll = routes.handlerFor("replies.poll");
  const answer = poll({ review: "r_wire", query: { since: 0 } }, deps);

  const liveness = answer.body.agent_liveness;
  assert.ok(liveness, "the rail gets ground truth, not the agent's claim");
  assert.equal(liveness.unanswered, 1);
  assert.ok(liveness.oldest_unanswered_at, "the rail can say how old the oldest item is");
  assert.equal(liveness.state, STATE.UNATTENDED);

  store.writeMonitor("s_wire", { pid: process.pid, handoff_rev: 0 });
  assert.equal(poll({ review: "r_wire", query: { since: 0 } }, deps).body.agent_liveness.state, STATE.WATCHING);
});

test("the layer raises the liveness on a state change and holds it in between", async () => {
  const raised = [];
  let answer = { events: [], seq: 0, target_mtime: null, agent_liveness: null };
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    store: { pendingEvents: () => [], windowId: "w1" },
    document: null,
    window: { location: { pathname: "/p.html", reload: () => {} } },
    fetch: async () => ({ ok: true, status: 200, json: async () => answer }),
    onAgentLiveness: (liveness) => raised.push(liveness.state)
  });

  // Nothing said yet: nothing raised, and nothing invented.
  await sync.poll();
  assert.deepEqual(raised, []);
  assert.equal(sync.status().agentLiveness, null);

  answer = Object.assign({}, answer, { agent_liveness: { state: "unattended", unanswered: 2 } });
  await sync.poll();
  assert.deepEqual(raised, ["unattended"]);

  // The same state on the next poll raises nothing. The rail's agent line is
  // calm text; repainting it every two seconds is churn nobody asked for.
  await sync.poll();
  await sync.poll();
  assert.deepEqual(raised, ["unattended"]);
  // The object is still held, so a repaint can re-read the oldest item's age.
  assert.equal(sync.status().agentLiveness.unanswered, 2);

  answer = Object.assign({}, answer, { agent_liveness: { state: "watching", unanswered: 2 } });
  await sync.poll();
  assert.deepEqual(raised, ["unattended", "watching"]);
});

test("the route table documents agent_liveness, so nobody has to read the handler to find it", () => {
  const route = protocol.route("replies.poll");
  assert.match(route.response, /agent_liveness/);
  assert.match(route.response, /oldest_unanswered_at/);
});

test("a review with no agent session reports none rather than a false alarm", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const store = agentSessions.createStore({ dir: dir });
  reviews.create({ id: "r_legacy" });

  const poll = routes.handlerFor("replies.poll");
  const answer = poll(
    { review: "r_legacy", query: { since: 0 } },
    { log: log, reviews: reviews, agentSessions: store, projection: projectionModule }
  );
  assert.equal(answer.body.agent_liveness.state, STATE.NONE);
});
