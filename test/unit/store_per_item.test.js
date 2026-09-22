// One storage key per item, so a keystroke writes one item and not the list.
//
// Owner: 1B. The spec is
// docs/features/20260922.01_draft_write_cost/01_spec_draft_write_cost.md,
// requirement 2. Before this, every keystroke re-serialized every item in the
// review (over 300 KB on the largest one, DRAFT_PERSISTENCE.md section 4).
//
// The layout:
//
//   lahe.item.v2:<review>:<item>   one record
//   lahe.index.v2:<review>         the ids in creation order, touched only on
//                                  create and delete
//   lahe.gen.v1:lahe.index.v2:<review>  one stamp for the whole review
//
// Written in that order, so a crash never loses an item: the worst case is an
// item key the index does not list yet, and the next load finds it.
//
// The old whole-list key (lahe.items.v1:<review>) is read and merged whenever
// it is present, per item, newest by revision then by updated_at. Only the tab
// holding the review's lock writes the merge down, and nothing deletes the old
// key in this release: an old-bundle tab mid-unload can still write it.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");

const REVIEW = "review-per-item";

function spyBacking(seed) {
  const values = Object.assign(Object.create(null), seed || {});
  const writes = [];
  const state = { refuseKey: null };
  return {
    writes: writes,
    state: state,
    values: values,
    getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
    setItem: (key, value) => {
      if (state.refuseKey && key.indexOf(state.refuseKey) === 0) {
        const err = new Error("The quota has been exceeded.");
        err.name = "QuotaExceededError";
        throw err;
      }
      writes.push(key);
      values[key] = String(value);
    },
    removeItem: (key) => {
      writes.push("remove:" + key);
      delete values[key];
    },
    key: (index) => Object.keys(values)[index] || null,
    get length() {
      return Object.keys(values).length;
    }
  };
}

// A Web Locks stand-in. `grant` true hands over the lock; false is a live
// second window holding it, so the claim is refused.
function fakeLocks(grant) {
  return {
    request: (name, options, callback) => {
      const cb = typeof options === "function" ? options : callback;
      return Promise.resolve(cb(grant ? { name: name } : null));
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

function itemKey(reviewId, id) {
  return storeModule.ITEM_PREFIX + reviewId + ":" + id;
}

function indexKey(reviewId) {
  return storeModule.INDEX_PREFIX + reviewId;
}

function stampKey(reviewId) {
  return storeModule.GEN_PREFIX + indexKey(reviewId);
}

function legacyKey(reviewId) {
  return storeModule.KEY_PREFIX + reviewId;
}

async function holder(backing) {
  const store = storeModule.createStore({ backing: backing, locks: fakeLocks(true) });
  const got = await store.claimWindow(REVIEW, { path: "/plan" });
  assert.equal(got.acquired, true);
  return store;
}

async function readOnly(backing) {
  const store = storeModule.createStore({ backing: backing, locks: fakeLocks(false) });
  const got = await store.claimWindow(REVIEW, { path: "/plan" });
  assert.equal(got.acquired, false);
  return store;
}

// ---------------------------------------------------------------------------
// The keystroke
// ---------------------------------------------------------------------------

test("a keystroke writes one item key and the review's stamp, nothing else", () => {
  const backing = spyBacking();
  const store = storeModule.createStore({ backing: backing });
  const others = [itemOf({ note: "one" }), itemOf({ note: "two" }), itemOf({ note: "three" })];
  others.forEach((item) => store.write(REVIEW, item));
  const typing = itemOf({ note: "f" });
  store.write(REVIEW, typing);

  backing.writes.length = 0;
  store.write(REVIEW, Object.assign({}, typing, { note: "fo" }));

  assert.deepEqual(backing.writes, [itemKey(REVIEW, typing.id), stampKey(REVIEW)]);
  assert.equal(JSON.parse(backing.values[itemKey(REVIEW, typing.id)]).note, "fo");
  assert.equal(backing.values[legacyKey(REVIEW)], undefined, "the old whole-list key is never written");
});

test("creating an item writes its key, then the index, then the stamp", () => {
  const backing = spyBacking();
  const store = storeModule.createStore({ backing: backing });
  const item = itemOf();
  store.write(REVIEW, item);
  assert.deepEqual(backing.writes, [itemKey(REVIEW, item.id), indexKey(REVIEW), stampKey(REVIEW)]);
});

test("creation order survives a reload, and a keystroke does not move an item", () => {
  const backing = spyBacking();
  const store = storeModule.createStore({ backing: backing });
  const a = itemOf({ note: "a" });
  const b = itemOf({ note: "b" });
  const c = itemOf({ note: "c" });
  [a, b, c].forEach((item) => store.write(REVIEW, item));
  store.write(REVIEW, Object.assign({}, a, { note: "a, reworded" }));

  const reloaded = storeModule.createStore({ backing: backing });
  assert.deepEqual(
    reloaded.read(REVIEW).map((item) => item.note),
    ["a, reworded", "b", "c"]
  );
});

test("a crash between the item key and the index loses nothing", () => {
  const backing = spyBacking();
  const store = storeModule.createStore({ backing: backing });
  const first = itemOf({ note: "already listed" });
  store.write(REVIEW, first);

  // The index write never lands: the tab died right after the item key did.
  const second = itemOf({ note: "the first keystroke of a new comment" });
  backing.state.refuseKey = storeModule.INDEX_PREFIX;
  assert.throws(() => store.write(REVIEW, second));
  backing.state.refuseKey = null;
  assert.ok(backing.values[itemKey(REVIEW, second.id)], "the item key landed");

  const reloaded = storeModule.createStore({ backing: backing });
  assert.deepEqual(
    reloaded.read(REVIEW).map((item) => item.note),
    ["already listed", "the first keystroke of a new comment"],
    "the next load finds the item nothing listed"
  );
});

test("a removed item is gone from every store, and its key with it", () => {
  const backing = spyBacking();
  const first = storeModule.createStore({ backing: backing });
  const a = itemOf({ note: "a" });
  const b = itemOf({ note: "b" });
  first.write(REVIEW, a);
  first.write(REVIEW, b);
  assert.equal(first.remove(REVIEW, a.id), true);

  assert.equal(backing.values[itemKey(REVIEW, a.id)], undefined);
  const reloaded = storeModule.createStore({ backing: backing });
  assert.deepEqual(
    reloaded.read(REVIEW).map((item) => item.note),
    ["b"]
  );
});

// ---------------------------------------------------------------------------
// Two stores over one storage
// ---------------------------------------------------------------------------

test("two store instances over one storage see each other's writes", () => {
  const backing = spyBacking();
  const one = storeModule.createStore({ backing: backing });
  const two = storeModule.createStore({ backing: backing });
  const a = itemOf({ note: "a" });
  one.write(REVIEW, a);
  assert.equal(two.readItem(REVIEW, a.id).note, "a");

  const b = itemOf({ note: "b" });
  two.write(REVIEW, b);
  two.write(REVIEW, Object.assign({}, a, { note: "a, reworded over there" }));
  assert.deepEqual(
    one.read(REVIEW).map((item) => item.note),
    ["a, reworded over there", "b"]
  );

  two.remove(REVIEW, a.id);
  assert.deepEqual(
    one.read(REVIEW).map((item) => item.note),
    ["b"]
  );
});

// ---------------------------------------------------------------------------
// The old whole-list key
// ---------------------------------------------------------------------------

test("the old whole-list key is merged by the tab holding the lock, and never deleted", async () => {
  const a = itemOf({ note: "from the old bundle" });
  const b = itemOf({ note: "also old" });
  const legacyBytes = JSON.stringify([a, b]);
  const backing = spyBacking({ [legacyKey(REVIEW)]: legacyBytes });

  const store = await holder(backing);
  assert.deepEqual(
    store.read(REVIEW).map((item) => item.note),
    ["from the old bundle", "also old"],
    "creation order is the old list's order"
  );
  assert.equal(JSON.parse(backing.values[itemKey(REVIEW, a.id)]).note, "from the old bundle", "written into its own key");
  assert.deepEqual(JSON.parse(backing.values[indexKey(REVIEW)]).ids, [a.id, b.id]);
  assert.equal(backing.values[legacyKey(REVIEW)], legacyBytes, "the old key is untouched");
  assert.equal(backing.writes.indexOf("remove:" + legacyKey(REVIEW)), -1);
});

test("a read-only tab shows the old key's items and writes nothing", async () => {
  const a = itemOf({ note: "from the old bundle" });
  const backing = spyBacking({ [legacyKey(REVIEW)]: JSON.stringify([a]) });
  const store = await readOnly(backing);
  backing.writes.length = 0;

  assert.equal(store.readItem(REVIEW, a.id).note, "from the old bundle", "the reviewer still sees it");
  assert.deepEqual(backing.writes, [], "and the read-only tab wrote nothing");
});

test("per item, the newer of the two copies wins: by revision, then by updated_at", async () => {
  const backing = spyBacking();
  const store = await holder(backing);
  const a = itemOf({ note: "a at rev 2", state: record.STATE.READY, rev: 2, updated_at: "2026-09-20T00:00:00.000Z" });
  const b = itemOf({ note: "b newer here", updated_at: "2026-09-20T00:00:05.000Z" });
  const c = itemOf({ note: "c older here", updated_at: "2026-09-20T00:00:01.000Z" });
  [a, b, c].forEach((item) => store.write(REVIEW, item));

  backing.values[legacyKey(REVIEW)] = JSON.stringify([
    Object.assign({}, a, { rev: 1, note: "a at rev 1" }),
    Object.assign({}, b, { note: "b older there", updated_at: "2026-09-20T00:00:01.000Z" }),
    Object.assign({}, c, { note: "c newer there", updated_at: "2026-09-20T00:00:09.000Z" })
  ]);
  const reloaded = await holder(backing);
  assert.deepEqual(
    reloaded.read(REVIEW).map((item) => item.note),
    ["a at rev 2", "b newer here", "c newer there"]
  );
});

test("an item the reviewer deleted does not come back from the old key", async () => {
  const a = itemOf({ note: "delete me" });
  const b = itemOf({ note: "keep me" });
  const backing = spyBacking({ [legacyKey(REVIEW)]: JSON.stringify([a, b]) });
  const store = await holder(backing);
  assert.equal(store.remove(REVIEW, a.id), true);

  const reloaded = await holder(backing);
  assert.deepEqual(
    reloaded.read(REVIEW).map((item) => item.note),
    ["keep me"]
  );
});

test("an old-bundle unload write after migration still lands", async () => {
  const a = itemOf({ note: "typed in the old tab" });
  const backing = spyBacking({ [legacyKey(REVIEW)]: JSON.stringify([a]) });
  const store = await holder(backing);
  assert.equal(store.readItem(REVIEW, a.id).note, "typed in the old tab");

  // The old bundle, on its way out, writes its whole list and its stamp, the
  // way the 2026-09-16 code does.
  const later = Object.assign({}, a, { note: "typed in the old tab, and more", updated_at: "2099-01-01T00:00:00.000Z" });
  backing.setItem(legacyKey(REVIEW), JSON.stringify([later]));
  backing.setItem(storeModule.GEN_PREFIX + legacyKey(REVIEW), "old-bundle:1");

  assert.equal(store.readItem(REVIEW, a.id).note, "typed in the old tab, and more", "the running tab sees it");
  assert.equal(
    JSON.parse(backing.values[itemKey(REVIEW, a.id)]).note,
    "typed in the old tab, and more",
    "and writes it down"
  );
});

test("an old-bundle write with no stamp lands when the next tab takes the lock", async () => {
  // The reload race: the new document boots and reads before the outgoing one
  // has finished unloading, and an older bundle writes no stamp at all.
  const a = itemOf({ note: "first" });
  const backing = spyBacking({ [legacyKey(REVIEW)]: JSON.stringify([a]) });
  const incoming = storeModule.createStore({ backing: backing, locks: fakeLocks(true) });
  assert.equal(incoming.readItem(REVIEW, a.id).note, "first");

  const later = Object.assign({}, a, { note: "first, and the last words", updated_at: "2099-01-01T00:00:00.000Z" });
  backing.setItem(legacyKey(REVIEW), JSON.stringify([later]));

  await incoming.claimWindow(REVIEW, { path: "/plan" });
  assert.equal(incoming.readItem(REVIEW, a.id).note, "first, and the last words");
  assert.equal(JSON.parse(backing.values[itemKey(REVIEW, a.id)]).note, "first, and the last words");
});
