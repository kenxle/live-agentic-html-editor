// The parts of the sync client that are decidable without a browser: what it
// mints, what it queues, how it names a failure, and that it reads the flush
// policy from protocol.js rather than restating it.
//
// Everything about actually posting is a browser test (test/browser/rail_*.spec
// .js), because the failures worth catching are a real kill -9, a real SIGSTOP
// and a real CSP header, none of which exist in this file's world.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");
const overlay = require("../../src/layer/overlay.js");

function draft(note) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.DRAFT,
    note: note,
    page_origin: "http://127.0.0.1:4000",
    page_path: "/roster"
  });
}

function harness() {
  const store = storeModule.createStore();
  const statuses = [];
  const raised = [];
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: null,
    onStatus: (state) => statuses.push(state),
    onFailure: (failure) => raised.push(failure)
  });
  return { store, sync, statuses, raised };
}

// Every test that records something stops the client afterwards: retrying
// forever is the behavior under test, and a client that gave up when the test
// ended would be the bug.
test("a keystroke is queued durably in the same call, before any network", (t) => {
  const { store, sync } = harness();
  t.after(() => sync.stop());
  const item = draft("half a thought");
  sync.recordItem(item);
  const queued = store.pendingEvents("review-1");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].item, item.id);
  assert.equal(queued[0].draft, true, "drafts flow to the helper marked draft (D5, R7)");
  assert.equal(queued[0].record.note, "half a thought");
});

test("the first event for an item is created, the next is content, ready is ready", () => {
  const { sync } = harness();
  const item = draft("one");
  assert.equal(sync.eventFor(item).event, protocol.EVENT.ITEM_CREATED);
  assert.equal(sync.eventFor(item).event, protocol.EVENT.ITEM_CONTENT);
  const ready = Object.assign({}, item, { state: record.STATE.READY, note: "one" });
  assert.equal(sync.eventFor(ready).event, protocol.EVENT.ITEM_READY);
});

test("every event carries its own id, because idempotence is by event_id", () => {
  const { sync } = harness();
  const item = draft("one");
  const ids = [sync.eventFor(item).event_id, sync.eventFor(item).event_id, sync.eventFor(item).event_id];
  assert.equal(new Set(ids).size, 3);
  assert.equal(protocol.IDEMPOTENCE_KEY, "event_id");
});

test("an immediate flush reason has to be one protocol.js names", (t) => {
  const { sync } = harness();
  t.after(() => sync.stop());
  assert.throws(() => sync.recordItem(draft("x"), { immediate: "whenever" }), /immediate must be one of/);
  protocol.FLUSH.IMMEDIATE_ON.forEach((reason) => {
    assert.doesNotThrow(() => sync.recordItem(draft("x"), { immediate: reason }));
  });
});

test("a CSP refusal is named distinctly from a helper that is down", async (t) => {
  const listeners = {};
  const fakeDocument = {
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    removeEventListener: () => {}
  };
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: storeModule.createStore(),
    document: fakeDocument,
    window: null,
    fetch: null
  });
  t.after(() => sync.stop());

  // Before any violation: an opaque fetch failure is the helper being down,
  // and the remedy says start the helper.
  const down = sync.classify(new Error("Failed to fetch"), {});
  assert.equal(down.code, "HELPER_UNREACHABLE");
  assert.match(down.remedy, /Start the helper/);

  await sync.start();
  // The real event a browser fires when connect-src refuses the request. The
  // fetch failure is IDENTICAL either side of this line, which is exactly why
  // the detection cannot be a guess from the error text.
  listeners.securitypolicyviolation({
    effectiveDirective: "connect-src",
    blockedURI: "http://127.0.0.1:7817"
  });

  const refused = sync.classify(new Error("Failed to fetch"), {});
  assert.equal(refused.code, "CSP_REFUSED");
  assert.match(refused.remedy, /connect-src/);
  assert.notEqual(refused.code, down.code, "two failures, two remedies, pointing opposite ways");
  assert.equal(sync.status().cspRefused, true);
});

test("the status line never says stored before anything has been acknowledged", (t) => {
  const { sync, statuses } = harness();
  t.after(() => sync.stop());
  sync.recordItem(draft("something"));
  assert.equal(sync.status().status, overlay.STATUS.KEPT_LOCALLY);
  assert.deepEqual(statuses, [overlay.STATUS.KEPT_LOCALLY]);
});

test("the flush policy is imported, not restated", () => {
  assert.equal(protocol.FLUSH.HELPER_DEBOUNCE_MS, 750);
  assert.equal(protocol.FLUSH.SEND_BEACON_IS_FORBIDDEN, true);
  assert.equal(protocol.REPLY_CURSOR_FIELD, "seq");
  // The library's own poll is a different number from the helper's file poll,
  // deliberately, and both are named rather than typed twice.
  assert.notEqual(syncModule.POLL_INTERVAL_MS, protocol.REPLY_POLL.INTERVAL_MS);
});

test("a card can carry a loud attachment, which is what an agent question needs", () => {
  const rail = overlay.createRail();
  const item = draft("a comment");
  rail.upsertCard(item);
  rail.setAgentMessage(item.id, { status: "question", agent: "claude", text: "Which heading?" });
  assert.equal(rail.getCard(item.id).agentMessage.loud, true);
  rail.setAgentMessage(item.id, { status: "handled", agent: "claude" });
  assert.equal(rail.getCard(item.id).agentMessage.loud, false);
});
