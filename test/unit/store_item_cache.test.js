// The item bucket stops being parsed out of browser storage on every keystroke.
//
// The 2026-09-16 memory audit, finding 2: store.write reads every item and
// writes every item, and index.js re-reads every item into a fresh array on
// every change. On a review with hundreds of items that is a full parse and a
// full serialize per keystroke.
//
// The store now holds the parsed list in memory. The hazard that makes this
// interesting is that BROWSER STORAGE IS SHARED BY EVERY TAB ON THE ORIGIN, so
// a copy held in one tab goes stale the moment another tab writes. The answer is
// a small stamp written beside the list on every write: a reader compares the
// stamp it cached with the stamp in storage, and equal means nobody has written
// since. No events, so it is equally correct in a second tab, in Node, and
// between two store instances over one backing object, which is what the
// two-tab tests below drive.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");

const REVIEW = "review-items";

function spyBacking(seed) {
  const values = Object.assign(Object.create(null), seed || {});
  const reads = [];
  const writes = [];
  // onSet runs AFTER the value has landed, which is how a test stands another
  // tab in the middle of this one's write.
  const state = { full: false, onSet: null, refuseKey: null };
  return {
    reads: reads,
    writes: writes,
    state: state,
    values: values,
    getItem: (key) => {
      reads.push(key);
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem: (key, value) => {
      if (state.full || (state.refuseKey && key.indexOf(state.refuseKey) === 0)) {
        const err = new Error("The quota has been exceeded.");
        err.name = "QuotaExceededError";
        throw err;
      }
      writes.push(key);
      values[key] = String(value);
      if (state.onSet) state.onSet(key);
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
        note: "shorten this heading",
        page_origin: "http://127.0.0.1:4000",
        page_path: "/plan"
      },
      overrides || {}
    )
  );
}

function itemsKey(reviewId) {
  return storeModule.KEY_PREFIX + reviewId;
}

function readsOf(backing, key) {
  return backing.reads.filter((read) => read === key).length;
}

// ---------------------------------------------------------------------------
// The keystroke path
// ---------------------------------------------------------------------------

test("a second write does not read the item bucket back out of storage", () => {
  const backing = spyBacking();
  const store = storeModule.createStore({ backing: backing });
  const item = itemOf();

  store.write(REVIEW, item);
  backing.reads.length = 0;

  // Twenty keystrokes on one comment.
  let note = "";
  for (let i = 0; i < 20; i += 1) {
    note += "x";
    store.write(REVIEW, Object.assign({}, item, { note: note }));
  }

  assert.equal(readsOf(backing, itemsKey(REVIEW)), 0, "the bucket is never parsed again");
  assert.equal(store.readItem(REVIEW, item.id).note, note, "and it still says what the reviewer typed");
});

test("reading after a write gives the written item, from memory", () => {
  const backing = spyBacking();
  const store = storeModule.createStore({ backing: backing });
  const first = itemOf({ note: "one" });
  const second = itemOf({ note: "two" });

  store.write(REVIEW, first);
  store.write(REVIEW, second);
  backing.reads.length = 0;

  assert.deepEqual(
    store.read(REVIEW).map((item) => item.note),
    ["one", "two"]
  );
  store.write(REVIEW, Object.assign({}, first, { note: "one, reworded" }));
  assert.deepEqual(
    store.read(REVIEW).map((item) => item.note),
    ["one, reworded", "two"],
    "the update is in place, not appended"
  );
  assert.equal(readsOf(backing, itemsKey(REVIEW)), 0);
});

test("removing and merging keep the held copy in step", () => {
  const store = storeModule.createStore({ backing: spyBacking() });
  const first = itemOf({ note: "one" });
  const second = itemOf({ note: "two" });
  store.write(REVIEW, first);
  store.write(REVIEW, second);

  assert.equal(store.remove(REVIEW, first.id), true);
  assert.equal(store.read(REVIEW).length, 1);
  assert.equal(store.readItem(REVIEW, first.id), null);

  // The helper's copy of an item this browser has never seen arrives through
  // the merge, which writes the result back.
  const fromHelper = itemOf({ note: "three" });
  store.mergeWithHelper(REVIEW, [fromHelper]);
  assert.deepEqual(
    store
      .read(REVIEW)
      .map((item) => item.note)
      .sort(),
    ["three", "two"]
  );
});

test("what a caller does to the record it was handed does not reach the store", () => {
  // replay.js and tab_done.js both write a region stamp straight onto an item
  // they got from the store and only then persist it. A held copy that shared
  // those objects would take the change with no write behind it.
  const store = storeModule.createStore({ backing: spyBacking() });
  const item = itemOf({ note: "one" });
  store.write(REVIEW, item);

  const got = store.read(REVIEW)[0];
  got.note = "scribbled on";
  assert.equal(store.readItem(REVIEW, item.id).note, "one");

  const one = store.readItem(REVIEW, item.id);
  one.state = record.STATE.HANDLED;
  assert.equal(store.readItem(REVIEW, item.id).state, record.STATE.DRAFT);
});

// ---------------------------------------------------------------------------
// Two tabs
// ---------------------------------------------------------------------------

test("a second tab's write to the items is visible to the first", () => {
  const backing = spyBacking();
  const first = storeModule.createStore({ backing: backing });
  const second = storeModule.createStore({ backing: backing });
  const item = itemOf({ note: "one" });

  first.write(REVIEW, item);
  assert.equal(second.readItem(REVIEW, item.id).note, "one", "the second store sees the first store's write");

  second.write(REVIEW, Object.assign({}, item, { note: "one, reworded over there" }));
  assert.equal(first.readItem(REVIEW, item.id).note, "one, reworded over there", "and the first sees the second's");

  second.remove(REVIEW, item.id);
  assert.equal(first.read(REVIEW).length, 0, "including a removal");
});

test("a tab that reads in the middle of another tab's write does not hold on to the old list", () => {
  // THE RACE. A write is two `setItem` calls, the list and the stamp, and
  // another tab can read between them. With the stamp written first, that tab
  // reads the NEW stamp and the OLD list, and caches the pair: its stamp check
  // then agrees forever and it never sees the write at all. So the list lands
  // first, and a reader that catches the halfway state holds a stamp that is
  // already out of date, which invalidates on its next read.
  const backing = spyBacking();
  const writer = storeModule.createStore({ backing: backing });
  const reader = storeModule.createStore({ backing: backing });
  const item = itemOf({ note: "one" });

  writer.write(REVIEW, item);
  assert.equal(reader.readItem(REVIEW, item.id).note, "one", "the reader is warm");

  // One read from the other tab, from inside the write, after the first of the
  // two keys has landed.
  let interleaved = 0;
  backing.state.onSet = () => {
    if (interleaved) return;
    interleaved += 1;
    reader.read(REVIEW);
  };
  writer.write(REVIEW, Object.assign({}, item, { note: "two" }));
  backing.state.onSet = null;
  assert.equal(interleaved, 1, "the read really did land in the middle of the write");

  assert.equal(reader.readItem(REVIEW, item.id).note, "two", "and the reader sees the finished write");
});

test("a stamp that could not be written leaves no reader trusting the list before it", () => {
  // The other half of the ordering: the list landed and the stamp did not, so
  // nothing in storage says the list moved. The stamp is cleared instead, which
  // every held copy disagrees with, so every reader goes back to the bytes.
  const backing = spyBacking();
  const writer = storeModule.createStore({ backing: backing });
  const reader = storeModule.createStore({ backing: backing });
  const item = itemOf({ note: "one" });

  writer.write(REVIEW, item);
  assert.equal(reader.readItem(REVIEW, item.id).note, "one");

  backing.state.refuseKey = storeModule.GEN_PREFIX;
  assert.throws(() => writer.write(REVIEW, Object.assign({}, item, { note: "two" })), /STORAGE_QUOTA|full/i);
  backing.state.refuseKey = null;

  assert.equal(reader.readItem(REVIEW, item.id).note, "two", "the list that did land is what both tabs read");
  assert.equal(writer.readItem(REVIEW, item.id).note, "two");
});

test("a record repaired on the way out of storage is repaired on the way in too", () => {
  // collapsePageCheckNote squashes the repeated page-check sentence that the
  // pre-2026-09-10 reopen loop wrote into a note. It used to run on every read,
  // which meant every read; it now runs on a cold parse, so the write path has
  // to do it as well or a record arriving from the helper reads doubled on the
  // card until the next reload.
  const sentence = record.PAGE_CHECK_NOTES[0];
  const doubled = sentence + " " + sentence;
  const backing = spyBacking();
  const store = storeModule.createStore({ backing: backing });

  const fromHelper = itemOf({ note: doubled, state: record.STATE.READY });
  store.mergeWithHelper(REVIEW, [fromHelper]);
  assert.equal(store.readItem(REVIEW, fromHelper.id).note, sentence, "the warm read is repaired");

  // And the repair is what was written down, so it holds without a reload and
  // for every other tab too.
  assert.equal(JSON.parse(backing.values[itemsKey(REVIEW)])[0].note, sentence);

  // The ordinary write path as well, not only the merge.
  store.write(REVIEW, Object.assign({}, fromHelper, { note: doubled }));
  assert.equal(store.readItem(REVIEW, fromHelper.id).note, sentence);
});

test("a bucket written before any stamp existed is still read", () => {
  // Storage format unchanged: an origin that already holds records from an
  // older version of this file has no stamp beside them, and those records are
  // the reviewer's work.
  const item = itemOf({ note: "written by the old code" });
  const backing = spyBacking({ [itemsKey(REVIEW)]: JSON.stringify([item]) });
  const store = storeModule.createStore({ backing: backing });

  assert.equal(store.readItem(REVIEW, item.id).note, "written by the old code");
  // And a write from here on stamps it, so the next reader can cache it.
  store.write(REVIEW, Object.assign({}, item, { note: "and reworded by the new" }));
  assert.equal(store.readItem(REVIEW, item.id).note, "and reworded by the new");
  assert.equal(
    JSON.parse(backing.values[itemsKey(REVIEW)])[0].note,
    "and reworded by the new",
    "the bucket on disk is still a plain array of records"
  );
});

test("a write that storage refused leaves nothing cached that disagrees with the disk", () => {
  // The stamp moves before the list. If the list write then fails, the stamp no
  // longer matches any held copy, so every reader goes back to the bytes rather
  // than believing a write that never landed.
  const backing = spyBacking();
  const store = storeModule.createStore({ backing: backing });
  const item = itemOf({ note: "the last thing that fitted" });
  store.write(REVIEW, item);

  backing.state.full = true;
  assert.throws(() => store.write(REVIEW, Object.assign({}, item, { note: "no room for this" })), /STORAGE_QUOTA|full/i);

  backing.state.full = false;
  assert.equal(
    store.readItem(REVIEW, item.id).note,
    "the last thing that fitted",
    "the store says what is on disk, not what the refused write wanted"
  );
});
