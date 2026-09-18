// Hold: queue several comments, release them to the agent at once.
//
// docs/features/20260917.01_hold_toggle/01_spec_hold_toggle.md. Hold gates
// DELIVERY, not the item lifecycle (see docs/diagrams/item_lifecycle.md): an
// item still becomes `ready`, durably, in the browser, the moment the
// reviewer commits it. All Hold does is stop sync.js's flush from posting
// that event while the review is held.
//
// This file covers the two layers that are decidable without a browser:
//
//   1. store.js: setHeld/isHeld, persisted per review, best effort (Task 1).
//   2. sync.js: flush gated on isHeld, and the force bypass end-review and
//      releasing Hold both need (Task 2).
//
// The visual (a held card's distinct state, the toggle, the collapsed pill)
// and the integration proof that a held item never reaches review.json, the
// wake feed, or the overdue clock (Requirement 4) are a browser spec:
// test/browser/rail_hold.spec.js. Node cannot draw a card or run the real
// helper's wake feed against a real AGENT_LIVENESS clock.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");
const overlay = require("../../src/layer/overlay.js");

function memoryBacking(seed) {
  const values = Object.assign(Object.create(null), seed || {});
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
    setItem: (key, value) => {
      values[key] = String(value);
    },
    removeItem: (key) => {
      delete values[key];
    },
    key: (index) => Object.keys(values)[index] || null,
    get length() {
      return Object.keys(values).length;
    }
  };
}

function readyItem(note) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: note,
    page_origin: "http://127.0.0.1:4000",
    page_path: "/roster"
  });
}

// ---------------------------------------------------------------------------
// Task 1: store.js
// ---------------------------------------------------------------------------

test("hold is off by default, and setHeld/isHeld round-trip", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  assert.equal(store.isHeld("review-a"), false, "a review starts not held");
  assert.equal(store.setHeld("review-a", true), true);
  assert.equal(store.isHeld("review-a"), true);
  assert.equal(store.setHeld("review-a", false), false);
  assert.equal(store.isHeld("review-a"), false);
});

test("hold is per review, never global", () => {
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });
  store.setHeld("review-a", true);
  assert.equal(store.isHeld("review-b"), false, "another review keeps its own default");
});

test("hold survives a simulated reload: a fresh store instance over the same backing", () => {
  const backing = memoryBacking();
  const first = storeModule.createStore({ backing: backing });
  first.setHeld("review-a", true);

  const reloaded = storeModule.createStore({ backing: backing });
  assert.equal(reloaded.isHeld("review-a"), true, "the reload reads the same choice back");
});

test("turning hold back off clears the stored flag rather than leaving a false lying around", () => {
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });
  store.setHeld("review-a", true);
  store.setHeld("review-a", false);
  assert.equal(backing.getItem(storeModule.HELD_PREFIX + "review-a"), null);
});

test("denied storage degrades to not-held, the safe direction, rather than throwing", () => {
  const denied = {
    getItem: () => {
      throw new Error("storage denied");
    },
    setItem: () => {
      throw new Error("storage denied");
    },
    removeItem: () => {
      throw new Error("storage denied");
    }
  };
  const store = storeModule.createStore({ backing: denied });
  assert.doesNotThrow(() => store.setHeld("review-a", true));
  assert.equal(store.isHeld("review-a"), false, "a Hold that cannot be remembered must not silently stop delivery");
});

// ---------------------------------------------------------------------------
// Task 2: sync.js
// ---------------------------------------------------------------------------

function harnessWithFetch(fetchImpl, storeOverride) {
  const store = storeOverride || storeModule.createStore();
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: fetchImpl
  });
  return { store, sync };
}

test("a queued event does not post while the review is held", async (t) => {
  let posted = 0;
  const store = storeModule.createStore();
  store.setHeld("review-1", true);
  const { sync } = harnessWithFetch(async (_url, config) => {
    posted += 1;
    const sent = JSON.parse(config.body);
    return { ok: true, status: 200, json: async () => ({ accepted: sent.events.map((e) => e.event_id), seq: 1 }) };
  }, store);
  t.after(() => sync.stop());

  sync.recordItem(readyItem("one"), { immediate: "ready" });
  const result = await sync.flush();

  assert.equal(posted, 0, "held: nothing goes over the wire");
  assert.equal(result.held, true);
  assert.equal(result.remaining, 1);
  assert.equal(store.pendingEvents("review-1").length, 1, "still queued in the browser, not lost");
});

test("releasing hold flushes the queue immediately, in one pass", async (t) => {
  const store = storeModule.createStore();
  store.setHeld("review-1", true);
  const posts = [];
  const { sync } = harnessWithFetch(async (_url, config) => {
    const sent = JSON.parse(config.body);
    posts.push(sent.events.length);
    return { ok: true, status: 200, json: async () => ({ accepted: sent.events.map((e) => e.event_id), seq: 1 }) };
  }, store);
  t.after(() => sync.stop());

  sync.recordItem(readyItem("one"), { immediate: "ready" });
  sync.recordItem(readyItem("two"), { immediate: "ready" });
  sync.recordItem(readyItem("three"), { immediate: "ready" });
  assert.equal(posts.length, 0, "nothing sent yet: still held");

  store.setHeld("review-1", false);
  const result = await sync.flush({ force: true });

  assert.deepEqual(posts, [3], "the agent's drain sees all three at once, not as they were typed");
  assert.equal(result.remaining, 0);
});

test("an item committed while NOT held still posts on the ordinary debounce, unaffected", async (t) => {
  const posts = [];
  const { store, sync } = harnessWithFetch(async (_url, config) => {
    const sent = JSON.parse(config.body);
    posts.push(sent.events.length);
    return { ok: true, status: 200, json: async () => ({ accepted: sent.events.map((e) => e.event_id), seq: 1 }) };
  });
  t.after(() => sync.stop());

  sync.recordItem(readyItem("one"), { immediate: "ready" });
  await sync.flush();
  assert.deepEqual(posts, [1]);
  assert.equal(store.isHeld("review-1"), false);
});

test("ending a review force-flushes anything still held, no confirm, nothing lost", async (t) => {
  const store = storeModule.createStore();
  store.setHeld("review-1", true);
  const posts = [];
  const { sync } = harnessWithFetch(async (url, config) => {
    if (String(url).indexOf("/end") !== -1) {
      return { ok: true, status: 200, json: async () => ({ ended_at: "2026-09-18T00:00:00.000Z" }) };
    }
    const sent = JSON.parse(config.body);
    posts.push(sent.events.length);
    return { ok: true, status: 200, json: async () => ({ accepted: sent.events.map((e) => e.event_id), seq: 1 }) };
  }, store);
  t.after(() => sync.stop());

  sync.recordItem(readyItem("one"), { immediate: "ready" });
  sync.recordItem(readyItem("two"), { immediate: "ready" });
  const result = await sync.endReview();

  assert.deepEqual(posts, [2], "held items go out anyway when the reviewer ends the review");
  assert.equal(result.ok, true);
  assert.equal(result.unsent, 0, "nothing is left behind for the reviewer to be told about");
  assert.equal(store.isHeld("review-1"), true, "ending a review force-flushes; it does not silently turn Hold off");
});

test("a flush the moment Hold goes on suppresses anything already sitting in the outbox, not only what comes after", async (t) => {
  // Requirement 9: turning Hold on gates the WHOLE outbox, including an event
  // queued before the toggle was flipped (e.g. a retry after a brief outage).
  let posted = 0;
  const store = storeModule.createStore();
  const { sync } = harnessWithFetch(async (_url, config) => {
    posted += 1;
    const sent = JSON.parse(config.body);
    return { ok: true, status: 200, json: async () => ({ accepted: sent.events.map((e) => e.event_id), seq: 1 }) };
  }, store);
  t.after(() => sync.stop());

  sync.recordItem(readyItem("already queued before hold"), { immediate: "ready" });
  store.setHeld("review-1", true);
  const result = await sync.flush();

  assert.equal(posted, 0, "held after the fact still suppresses what was already queued");
  assert.equal(result.held, true);
  assert.equal(store.pendingEvents("review-1").length, 1);
});

// ---------------------------------------------------------------------------
// Task 3: overlay.js's display-only card state (headless: no jsdom in this
// repo, so DOM attributes and rendered text are the browser spec's job;
// this is the state computation underneath them).
// ---------------------------------------------------------------------------

const REVIEW = "review-hold";

/** Simulate sync.js having queued this item's ready event, the way recordItem does. */
function queueReadyEvent(store, item) {
  // store.write first: heldQueuedCount reads the item back by id to tell a
  // real comment from a queued draft, so a test event with no backing record
  // would silently count as zero, same as a draft does.
  store.write(REVIEW, item);
  store.queueEvent(REVIEW, {
    event_id: "evt-" + item.id + "-" + item.rev,
    event: "item.ready",
    item: item.id,
    rev: item.rev,
    record: item
  });
}

test("a ready item whose event is still queued while held reads as a distinct 'held' card state", () => {
  const store = storeModule.createStore();
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  const item = readyItem("batched while managing turns");

  store.setHeld(REVIEW, true);
  queueReadyEvent(store, item);
  rail.upsertCard(item);

  assert.equal(rail.getCard(item.id).state, "held");
});

test("an item already sent and acknowledged before Hold went on stays a plain ready card", () => {
  const store = storeModule.createStore();
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  const item = readyItem("sent before the reviewer turned Hold on");

  // Nothing queued for this item (the ack already dropped its event from the
  // outbox), so turning Hold on afterward must not relabel it.
  store.setHeld(REVIEW, true);
  rail.upsertCard(item);

  assert.equal(rail.getCard(item.id).state, "ready", "already delivered, so plain ready, not held");
});

test("hold off: an item with something queued (e.g. a network retry) is not drawn 'held'", () => {
  const store = storeModule.createStore();
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  const item = readyItem("queued because the helper hiccuped, not because of Hold");

  queueReadyEvent(store, item);
  rail.upsertCard(item);

  assert.equal(rail.getCard(item.id).state, "ready", "held is only ever a Hold reading, never a retry reading");
});

test("a draft stays a draft even when everything in the outbox is held", () => {
  const store = storeModule.createStore();
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  const draftItem = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.DRAFT,
    note: "still typing",
    page_origin: "http://127.0.0.1:4000",
    page_path: "/roster"
  });

  store.setHeld(REVIEW, true);
  store.queueEvent(REVIEW, { event_id: "evt-draft", event: "item.content", item: draftItem.id, rev: draftItem.rev, record: draftItem });
  rail.upsertCard(draftItem);

  assert.equal(rail.getCard(draftItem.id).state, "draft", "held is a ready-only reading; a draft was never going to an agent anyway");
});

test("R4: a held item's own local clock never turns it late, however long it has sat", () => {
  const store = storeModule.createStore();
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const item = Object.assign(readyItem("sat for an hour, held"), { updated_at: longAgo, created_at: longAgo });

  store.setHeld(REVIEW, true);
  queueReadyEvent(store, item);
  rail.upsertCard(item);
  // cardWaitFor only computes anything past STATUS.STORED (statusLine() short-
  // circuits otherwise), so this has to be set for the guard under test to be
  // reached at all rather than the assertion passing for an unrelated reason.
  rail.setStatusLine(overlay.STATUS.STORED);
  rail.setAgentLiveness({ state: "no_agent", oldest_unanswered_at: longAgo, unanswered: 1 });

  const wait = rail.cardWait(item.id);
  assert.equal(wait.overdue, false, "held is invisible to the overdue clock (R4), not merely usually-fine");
  assert.equal(wait.text, "");

  // Proves the assertion above is actually about Hold, not a fluke: the exact
  // same item, at the exact same wait, WOULD be overdue once it is not held.
  store.setHeld(REVIEW, false);
  const unheld = rail.cardWait(item.id);
  assert.equal(unheld.overdue, true, "same item, same wait, not held: this is what R4 is guarding against");
});

test("releasing hold flips a held card back to ready in the same call, before any network round trip", () => {
  const store = storeModule.createStore();
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  const item = readyItem("about to be released");

  store.setHeld(REVIEW, true);
  queueReadyEvent(store, item);
  rail.upsertCard(item);
  assert.equal(rail.getCard(item.id).state, "held");

  rail.setHeld(false);
  // renderStatus (called by setHeld) repaints every card against the fresh
  // isHeld() reading; the event is still physically in the outbox (nothing
  // here has a network), but Hold itself is off, so the card reads ready.
  rail.upsertCard(item);
  assert.equal(rail.getCard(item.id).state, "ready");
});

test("the toggle's queued count is distinct comments, not raw outbox events", () => {
  const store = storeModule.createStore();
  const rail = overlay.createRail({ document: null, store: store, reviewId: REVIEW });
  assert.equal(rail.heldCount(), 0);
  rail.setHeld(true);
  const one = readyItem("one");
  queueReadyEvent(store, one);
  queueReadyEvent(store, readyItem("two"));
  assert.equal(rail.heldCount(), 2);

  // A second event for the SAME item (a rework, still queued) is one comment,
  // not two, and a queued draft (never going to an agent either way, held or
  // not) is not a comment the reviewer is waiting to release at all.
  const reworded = Object.assign({}, one, { rev: one.rev + 1, note: "one, reworded" });
  store.write(REVIEW, reworded);
  store.queueEvent(REVIEW, { event_id: "evt-extra", event: "item.content", item: reworded.id, rev: reworded.rev, record: reworded });
  assert.equal(rail.heldCount(), 2, "the rework did not become a third queued comment");

  const draftItem = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.DRAFT,
    note: "still typing, never sent",
    page_origin: "http://127.0.0.1:4000",
    page_path: "/roster"
  });
  store.write(REVIEW, draftItem);
  store.queueEvent(REVIEW, { event_id: "evt-draft", event: "item.content", item: draftItem.id, rev: draftItem.rev, record: draftItem });
  assert.equal(rail.heldCount(), 2, "a queued draft is not one of the comments Hold is holding");
});
