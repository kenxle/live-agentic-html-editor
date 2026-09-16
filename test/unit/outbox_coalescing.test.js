// The outbox stops growing one entry per keystroke.
//
// The 2026-09-16 memory audit counted 144,724 item.content lines across 383
// review logs, one item written 1,515 times, and one log at 84 MB. Every one of
// those lines is a keystroke, and every one of them carries the whole record.
// The rule that makes that stop is here: a queued item.content for an item AT
// ONE REVISION is replaced by the next one rather than joined by it.
//
// What is NOT coalesced matters as much as what is. item.created, item.ready,
// item.deleted and item.reopened are lifecycle facts; each one is the only line
// in the log that says a thing happened, so each one reaches the helper. And a
// content event at a HIGHER revision never replaces one at a lower revision,
// because the helper's projection composes a continuation against prev.rev + 1
// (src/service/projection.js, itemsFrom) and a skipped revision breaks that
// chain. See docs/ongoing/OUTBOX_COALESCING.md.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");

const REVIEW = "review-outbox";

function memoryBacking(seed) {
  const values = Object.assign(Object.create(null), seed || {});
  const reads = [];
  return {
    reads: reads,
    values: values,
    getItem: (key) => {
      reads.push(key);
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
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

function itemOf(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.DRAFT,
        note: "half a thought",
        page_origin: "http://127.0.0.1:4000",
        page_path: "/plan"
      },
      overrides || {}
    )
  );
}

let minted = 0;
function eventOf(type, item, overrides) {
  minted += 1;
  return protocol.newEvent(
    Object.assign(
      {
        event: type,
        event_id: "evt_" + minted,
        review: REVIEW,
        item: item[record.FIELD.ID],
        rev: item[record.FIELD.REV],
        page_path: item[record.FIELD.PAGE_PATH],
        payload: { draft: record.isDraft(item), record: item }
      },
      overrides || {}
    )
  );
}

function typed(item, note) {
  return Object.assign({}, item, { note: note });
}

// ---------------------------------------------------------------------------
// The coalescing rule
// ---------------------------------------------------------------------------

test("two content events for one item at one revision collapse to one, and the newer wins", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const item = itemOf();

  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, typed(item, "half a")));
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, typed(item, "half a thought")));

  const queue = store.pendingEvents(REVIEW);
  assert.equal(queue.length, 1, "one entry per item per revision, not one per keystroke");
  assert.equal(queue[0].record.note, "half a thought", "the newest wording is the one that is kept");
});

test("content events for two different items both stay", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const first = itemOf({ note: "one" });
  const second = itemOf({ note: "two" });

  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, first));
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, second));

  const queue = store.pendingEvents(REVIEW);
  assert.equal(queue.length, 2);
  assert.deepEqual(
    queue.map((event) => event.item),
    [first.id, second.id]
  );
});

test("created and ready are lifecycle facts and are never coalesced away", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const item = itemOf();

  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CREATED, item));
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, typed(item, "one")));
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, typed(item, "two")));

  const queue = store.pendingEvents(REVIEW);
  assert.deepEqual(
    queue.map((event) => event.event),
    [protocol.EVENT.ITEM_CREATED, protocol.EVENT.ITEM_CONTENT],
    "the creation line survives; the two keystrokes are one line"
  );
  assert.equal(queue[1].record.note, "two");

  // Two readies for one item are two lines. item.ready is what wakes the agent
  // (routes.js WAKE_EVENTS), so a second one is a second ask, not a repeat.
  const other = itemOf({ state: record.STATE.READY, note: "ready" });
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_READY, other));
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_READY, other));
  assert.equal(
    store.pendingEvents(REVIEW).filter((event) => event.event === protocol.EVENT.ITEM_READY).length,
    2
  );
});

test("a ready queued after a content stays alongside it, and the next keystroke goes to the back", () => {
  // ORDER IS RECENCY. The helper's projection takes the LAST event for an item
  // in log order (src/service/projection.js, itemsFrom), so a replacement that
  // kept the old entry's position would leave a stale ready sitting after the
  // fresh content and the helper would fold the wrong one.
  const store = storeModule.createStore({ backing: memoryBacking() });
  const item = itemOf();

  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, typed(item, "one")));
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_READY, Object.assign({}, item, { state: record.STATE.READY })));
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, typed(item, "one more word")));

  const queue = store.pendingEvents(REVIEW);
  assert.deepEqual(
    queue.map((event) => event.event),
    [protocol.EVENT.ITEM_READY, protocol.EVENT.ITEM_CONTENT],
    "the ready is kept and the replacement is appended behind it"
  );
  assert.equal(queue[1].record.note, "one more word");
});

test("a content event at a higher revision joins the queue rather than replacing a lower one", () => {
  // The helper composes a continuation against prev.rev + 1 (projection.js,
  // itemsFrom). Dropping the event that carried revision 1 would make revision
  // 2 arrive against revision 0 and break that chain, so revision is part of
  // what "the same content event" means. Keystrokes never bump the revision
  // (comments.js type(), editing.js captureTyping), so this costs the fix
  // nothing: the 1,515 lines the audit found all sat at one revision.
  const store = storeModule.createStore({ backing: memoryBacking() });
  const item = itemOf();
  const bumped = Object.assign({}, item, { rev: item.rev + 1, note: "reworded" });

  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, item));
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, bumped));

  const queue = store.pendingEvents(REVIEW);
  assert.equal(queue.length, 2);
  assert.deepEqual(
    queue.map((event) => event.rev),
    [item.rev, bumped.rev]
  );

  // And a second keystroke at the new revision still collapses onto its own.
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, Object.assign({}, bumped, { note: "reworded twice" })));
  assert.equal(store.pendingEvents(REVIEW).length, 2);
  assert.equal(store.pendingEvents(REVIEW)[1].record.note, "reworded twice");
});

test("the same event_id still replaces, so a re-queue after a failed post cannot double-count", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const item = itemOf();
  const event = eventOf(protocol.EVENT.ITEM_READY, item);

  store.queueEvent(REVIEW, event);
  const again = eventOf(protocol.EVENT.ITEM_READY, typed(item, "again"), { event_id: event.event_id });
  store.queueEvent(REVIEW, again);

  const queue = store.pendingEvents(REVIEW);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].event_id, event.event_id);
  assert.equal(queue[0].record.note, "again", "and it is the REPLACEMENT that is queued, not the first one");
});

test("what a caller does to the record it queued does not change the queued event", () => {
  // sync.js builds the event around the record the surface is holding, and the
  // surface goes on editing that object. The queue is written to storage, so it
  // was immune to that before it was also held in memory.
  const store = storeModule.createStore({ backing: memoryBacking() });
  const item = itemOf({ note: "one" });
  const event = eventOf(protocol.EVENT.ITEM_CREATED, item);

  store.queueEvent(REVIEW, event);
  event.record.note = "scribbled on after queueing";
  event.rev = 99;

  const queue = store.pendingEvents(REVIEW);
  assert.equal(queue[0].record.note, "one");
  assert.equal(queue[0].rev, item.rev);
});

test("acknowledge still drops only the ids the helper named", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const first = itemOf({ note: "one" });
  const second = itemOf({ note: "two" });

  const a = store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CREATED, first))[0];
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CREATED, second));

  store.acknowledge(REVIEW, [a.event_id, "evt_never_queued"]);
  const queue = store.pendingEvents(REVIEW);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].item, second.id);
});

// ---------------------------------------------------------------------------
// The pending count stops parsing the outbox on every poll tick
// ---------------------------------------------------------------------------

test("the pending count is right after a queue, a replacement and an acknowledge", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const item = itemOf();

  assert.equal(store.pendingCount(REVIEW), 0);
  const created = store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CREATED, item))[0];
  assert.equal(store.pendingCount(REVIEW), 1);

  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, typed(item, "one")));
  assert.equal(store.pendingCount(REVIEW), 2);
  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, typed(item, "two")));
  assert.equal(store.pendingCount(REVIEW), 2, "a replacement does not add to the count");

  store.acknowledge(REVIEW, [created.event_id]);
  assert.equal(store.pendingCount(REVIEW), 1);
  store.acknowledge(REVIEW, []);
  assert.equal(store.pendingCount(REVIEW), 1);
});

test("the poll tick does not re-read the outbox out of storage", () => {
  // The audit's finding: recomputeStatus and pendingCount both parsed the whole
  // outbox on every tick, once a second while the tab is visible. The count now
  // comes from memory. The only thing read from storage is the small stamp that
  // says whether another tab has written since.
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });
  const item = itemOf();
  const key = storeModule.OUTBOX_PREFIX + REVIEW;

  store.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, item));
  backing.reads.length = 0;

  for (let i = 0; i < 20; i += 1) store.pendingCount(REVIEW);
  assert.equal(
    backing.reads.filter((read) => read === key).length,
    0,
    "twenty poll ticks, no read of the outbox itself"
  );
});

// ---------------------------------------------------------------------------
// Two tabs
// ---------------------------------------------------------------------------

test("a second tab's write to the outbox is visible to the first", () => {
  // Browser storage is shared by every tab on the origin, so an in-memory cache
  // that nothing invalidates goes stale the moment another tab writes. Two store
  // instances over one backing object is that situation, in one process.
  const backing = memoryBacking();
  const first = storeModule.createStore({ backing: backing });
  const second = storeModule.createStore({ backing: backing });
  const item = itemOf();

  first.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CREATED, item));
  assert.equal(second.pendingCount(REVIEW), 1, "the second store sees the first store's write");

  second.queueEvent(REVIEW, eventOf(protocol.EVENT.ITEM_CONTENT, typed(item, "typed over there")));
  assert.equal(first.pendingCount(REVIEW), 2, "and the first sees the second's");
  assert.equal(first.pendingEvents(REVIEW)[1].record.note, "typed over there");

  first.acknowledge(REVIEW, first.pendingEvents(REVIEW).map((event) => event.event_id));
  assert.equal(second.pendingCount(REVIEW), 0, "an acknowledge in one tab empties the queue in both");
});

// ---------------------------------------------------------------------------
// Through the sync client, which is where the keystrokes actually arrive
// ---------------------------------------------------------------------------

function syncHarness() {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const sync = syncModule.createSync({
    review: REVIEW,
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: null
  });
  return { store, sync };
}

test("twenty keystrokes on one comment are one creation and one content event", (t) => {
  const { store, sync } = syncHarness();
  t.after(() => sync.stop());

  const item = itemOf({ note: "" });
  let note = "";
  for (let i = 0; i < 20; i += 1) {
    note += "x";
    sync.recordItem(Object.assign({}, item, { note: note }));
  }

  const queue = store.pendingEvents(REVIEW);
  assert.deepEqual(
    queue.map((event) => event.event),
    [protocol.EVENT.ITEM_CREATED, protocol.EVENT.ITEM_CONTENT],
    "the first event for an item is its creation and is never coalesced away"
  );
  assert.equal(queue[1].record.note, note, "and the surviving content event holds the last keystroke");
});
