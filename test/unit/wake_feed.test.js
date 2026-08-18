"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const wakeFeed = require("../../src/service/wake_feed.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const stateDir = require("../../src/service/state_dir.js");
const routes = require("../../src/service/routes.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-wake-"));
}

test("the feed exists, empty, from the moment the session does", () => {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir: dir });
  const session = store.create({ id: "s_armed" });

  const file = stateDir.wakeLogPath(dir, session.id);
  assert.ok(fs.existsSync(file), "a tail can be armed before any work exists");
  assert.equal(fs.readFileSync(file, "utf8"), "");
});

test("one line per ready transition, deduped by item and rev", () => {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir: dir });
  store.create({ id: "s_feed" });
  const feed = wakeFeed.createWakeFeed({ dir: dir });

  assert.ok(feed.appendWork({ session: "s_feed", review: "r_one", item: "c_1", rev: 1 }));
  // The same (item, rev) again is the same transition, however it arrived.
  assert.equal(feed.appendWork({ session: "s_feed", review: "r_one", item: "c_1", rev: 1 }), null);
  // A rework carries a new rev, so it is genuinely new work.
  assert.ok(feed.appendWork({ session: "s_feed", review: "r_one", item: "c_1", rev: 2 }));

  const lines = feed.read("s_feed");
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((line) => line.rev), [1, 2]);
  lines.forEach((line) => {
    assert.equal(line.kind, protocol.WAKE.KIND.WORK);
    assert.equal(line.review, "r_one");
    assert.equal(line.item, "c_1");
    assert.equal(line.drain, "lahe status --session s_feed --json --quiet");
    assert.ok(line.at);
  });
});

test("the dedupe survives a new process, because it is seeded from the file", () => {
  const dir = tempDir();
  agentSessions.createStore({ dir: dir }).create({ id: "s_restart" });
  wakeFeed.createWakeFeed({ dir: dir }).appendWork({ session: "s_restart", review: "r", item: "c_1", rev: 1 });

  const second = wakeFeed.createWakeFeed({ dir: dir });
  assert.equal(second.appendWork({ session: "s_restart", review: "r", item: "c_1", rev: 1 }), null);
  assert.equal(second.read("s_restart").length, 1);
});

test("a wake line is a pointer: it carries no reviewer text at all", () => {
  const dir = tempDir();
  agentSessions.createStore({ dir: dir }).create({ id: "s_fence" });
  const feed = wakeFeed.createWakeFeed({ dir: dir });
  const line = feed.appendWork({ session: "s_fence", review: "r", item: "c_1", rev: 1 });

  assert.deepEqual(Object.keys(line).sort(), ["at", "drain", "item", "kind", "rev", "review"]);
  assert.equal(line.note, undefined);
  assert.equal(line.change, undefined);
  assert.equal(line.quote, undefined);
});

test("takeover and close each append one line, and they name no item", () => {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir: dir });
  store.create({ id: "s_life" });

  store.takeover("s_life");
  store.close("s_life");

  const lines = store.wake.read("s_life");
  assert.deepEqual(lines.map((line) => line.kind), [protocol.WAKE.KIND.TAKEOVER, protocol.WAKE.KIND.CLOSED]);
  lines.forEach((line) => {
    assert.equal(line.review, undefined);
    assert.equal(line.item, undefined);
    assert.ok(line.at);
  });
});

test("the feed is appended to, never replaced, so a tail keeps its inode", () => {
  const dir = tempDir();
  agentSessions.createStore({ dir: dir }).create({ id: "s_inode" });
  const file = stateDir.wakeLogPath(dir, "s_inode");
  const before = fs.statSync(file).ino;

  const feed = wakeFeed.createWakeFeed({ dir: dir });
  feed.appendWork({ session: "s_inode", review: "r", item: "c_1", rev: 1 });
  feed.appendWork({ session: "s_inode", review: "r", item: "c_2", rev: 1 });
  feed.appendSessionEvent("s_inode", protocol.WAKE.KIND.CLOSED);

  assert.equal(fs.statSync(file).ino, before, "an atomic replace would leave every armed tail deaf");
});

// ---------------------------------------------------------------------------
// The route that feeds it
// ---------------------------------------------------------------------------

function harness() {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const store = agentSessions.createStore({ dir: dir });
  const session = store.create({ id: "s_route" });
  reviews.create({ id: "r_route", agent_session_id: session.id });
  return {
    dir: dir,
    store: store,
    deps: {
      log: log,
      reviews: reviews,
      agentSessions: store,
      projection: { tickReview: function () { return { wrote: false }; } }
    }
  };
}

function readyEvent(id, item, rev) {
  return protocol.newEvent({
    event: protocol.EVENT.ITEM_READY,
    event_id: id,
    review: "r_route",
    item: item,
    rev: rev
  });
}

function contentEvent(id, item, rev) {
  return protocol.newEvent({
    event: protocol.EVENT.ITEM_CONTENT,
    event_id: id,
    review: "r_route",
    item: item,
    rev: rev
  });
}

test("events.append wakes on ready transitions only, and never on typing", () => {
  const h = harness();
  const append = routes.handlerFor("events.append");

  append({ review: "r_route", body: { events: [contentEvent("ev_1", "c_1", 1), contentEvent("ev_2", "c_1", 1)] } }, h.deps);
  assert.equal(h.store.wake.read("s_route").length, 0, "a burst of typing wakes nobody");

  append({ review: "r_route", body: { events: [readyEvent("ev_3", "c_1", 1)] } }, h.deps);
  const lines = h.store.wake.read("s_route");
  assert.equal(lines.length, 1);
  assert.equal(lines[0].item, "c_1");
  assert.equal(lines[0].review, "r_route");
});

test("a replayed ready event appends nothing, because the log already stored it", () => {
  const h = harness();
  const append = routes.handlerFor("events.append");
  const request = { review: "r_route", body: { events: [readyEvent("ev_same", "c_9", 1)] } };

  append(request, h.deps);
  // The library re-posts anything it has not seen acknowledged. Same event_id.
  append(request, h.deps);
  append({ review: "r_route", body: { events: [readyEvent("ev_same", "c_9", 1)] } }, h.deps);

  assert.equal(h.store.wake.read("s_route").length, 1);
});
