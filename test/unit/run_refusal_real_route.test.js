// A refused run event, answered by the REAL events.append route.
//
// Testing review I10. The refusal tests elsewhere (draft_flush_cadence, the
// edits_tab browser spec, support/refusing_helper.js) build the helper's
// `rejected` answer by hand. If the route's answer drifts, the stand-ins stay
// green and the reviewer's words silently stop reaching the agent. Here the
// helper side is routes["events.append"] over a real event log, the forged run
// event goes through the log's own validateRun, and the layer's sync reads the
// answer that comes back byte for byte.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const routes = require("../../src/service/routes.js");
const projectionModule = require("../../src/service/projection.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");

const REVIEW = "rrefusal000000001";

function eventTarget() {
  const handlers = Object.create(null);
  return {
    addEventListener(name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
    },
    removeEventListener(name, fn) {
      handlers[name] = (handlers[name] || []).filter((each) => each !== fn);
    }
  };
}

function helperWorld() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-refusal-"));
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  reviews.create({ id: REVIEW, origins: ["null"], agent_session_id: "s_refusal" });
  return { dir, log, deps: { log: log, reviews: reviews, projection: projectionModule } };
}

/** A ready run record the helper's validateRun will refuse: one more block than the ceiling. */
function forgedRun() {
  const base = createFixtures({ seed: "refusal" }).runFixtures()[0].item;
  const many = [];
  for (let i = 0; i <= record.NEW_BLOCKS_MAX; i += 1) many.push({ tag: "p", html: "Block " + i });
  const built = record.buildRunAfter(base.anchor_after_html, many);
  return Object.assign({}, base, {
    state: record.STATE.READY,
    reply: null,
    new_blocks: many,
    after_html: built.after_html,
    after: built.after
  });
}

test("the real events.append answer to a forged run carries the code and reason sync reads", () => {
  const w = helperWorld();
  const item = forgedRun();
  const ev = protocol.newEvent({
    event: protocol.EVENT.ITEM_READY,
    event_id: "evt_refusal_shape",
    review: REVIEW,
    item: item.id,
    rev: item.rev,
    page_path: item.page_path,
    page_title: item.page_title,
    page_seq: item.page_seq,
    payload: { draft: false, record: item }
  });
  const answer = routes.handlerFor("events.append")({ review: REVIEW, query: {}, body: { events: [ev] } }, w.deps);
  assert.equal(answer.status, 200);
  assert.deepEqual(answer.body.accepted, [], "nothing accepted");
  assert.deepEqual(answer.body.stored, []);
  assert.deepEqual(answer.body.duplicates, []);
  assert.equal(answer.body.rejected.length, 1);
  const refused = answer.body.rejected[0];
  assert.equal(refused.event_id, "evt_refusal_shape");
  assert.equal(refused.code, "RUN_OVER_CEILING");
  assert.ok(refused.reason.indexOf("RUN_OVER_CEILING: ") === 0, "the reason leads with the code: " + refused.reason);
});

test("sync feeds the real route's answer through its refusal path: the item carries RUN_EVENT_REFUSED with the helper's code", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 2000000 });
  const w = helperWorld();
  const store = storeModule.createStore({ locks: null });
  const raised = [];
  const bodies = [];
  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetchImpl = async (url, config) => {
    const p = String(url);
    if (p.indexOf("/events") !== -1) {
      const sent = JSON.parse(config.body);
      // The helper's own route, on the events the layer really posted.
      const answer = routes.handlerFor("events.append")({ review: REVIEW, query: {}, body: sent }, w.deps);
      bodies.push(answer.body);
      return ok(answer.body);
    }
    if (p.indexOf("/replies") !== -1) return ok({ events: [], seq: 0 });
    if (p.indexOf("/window/release") !== -1) return ok({ released: true });
    return ok({ granted: true, session_secret: "secret", heartbeat_seconds: 30 });
  };
  const doc = Object.assign(eventTarget(), { hidden: false, location: { pathname: "/plan" } });
  const win = Object.assign(eventTarget(), { location: { pathname: "/plan" } });
  const sync = syncModule.createSync({
    review: REVIEW,
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: doc,
    window: win,
    fetch: fetchImpl,
    onItemRefused: (id, failure) => raised.push({ id, failure })
  });
  t.after(() => {
    sync.stop();
    t.mock.timers.reset();
  });
  const drain = async () => {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  };
  await sync.start();
  await drain();

  const item = forgedRun();
  store.write(REVIEW, item);
  sync.recordItem(item, { immediate: "ready" });
  for (let done = 0; done < 300; done += 100) {
    t.mock.timers.tick(100);
    await drain();
  }

  assert.ok(bodies.some((b) => b.rejected.length === 1), "the real route refused the forged run");
  const failure = sync.refusalFor(item.id);
  assert.ok(failure, "the item carries the refusal");
  assert.equal(failure.code, "RUN_EVENT_REFUSED");
  assert.equal(failure.detail.helper_code, "RUN_OVER_CEILING", "the helper's own code reached the item");
  assert.match(failure.detail.reason, /RUN_OVER_CEILING/);
  assert.equal(raised.length, 1);
  assert.equal(store.pendingEvents(REVIEW).length, 0, "the refused event left the outbox");
});
