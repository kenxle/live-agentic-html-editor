"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const storeModule = require("../../src/layer/store.js");
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

test("rail collapse preference is versioned, review-scoped, and defaults open", () => {
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });

  const first = overlay.createRail({ document: null, store: store, reviewId: "review-a" });
  assert.equal(first.isCollapsed(), false, "a new review starts open");
  first.collapse(true);

  assert.deepEqual(JSON.parse(backing.getItem(storeModule.UI_PREFIX + "review-a")), { collapsed: true });
  assert.equal(
    overlay.createRail({ document: null, store: store, reviewId: "review-a" }).isCollapsed(),
    true,
    "the same review restores its choice"
  );
  assert.equal(
    overlay.createRail({ document: null, store: store, reviewId: "review-b" }).isCollapsed(),
    false,
    "another review keeps the default"
  );

  first.collapse(false);
  assert.equal(
    overlay.createRail({ document: null, store: store, reviewId: "review-a" }).isCollapsed(),
    false,
    "expansion is persisted as well"
  );
});

test("denied and malformed preference storage degrades to an open, usable rail", () => {
  const denied = {
    getItem: () => {
      throw new Error("storage denied");
    },
    setItem: () => {
      throw new Error("storage denied");
    }
  };
  const deniedStore = storeModule.createStore({ backing: denied });
  const rail = overlay.createRail({ document: null, store: deniedStore, reviewId: "review-denied" });

  assert.equal(rail.isCollapsed(), false);
  assert.doesNotThrow(() => rail.collapse(true));
  assert.equal(rail.isCollapsed(), true, "the in-memory choice still works");

  const corruptBacking = memoryBacking({
    [storeModule.UI_PREFIX + "review-corrupt"]: "{not json"
  });
  const corruptStore = storeModule.createStore({ backing: corruptBacking });
  assert.equal(corruptStore.readUiPreferences("review-corrupt").collapsed, false);
  assert.equal(
    overlay.createRail({ document: null, store: corruptStore, reviewId: "review-corrupt" }).isCollapsed(),
    false
  );
});

test("follow-up drafts are versioned, review-scoped, synchronous, and private", () => {
  const backing = memoryBacking();
  const first = storeModule.createStore({ backing: backing });
  first.writeFollowupDraft("review-a", "item-1", "A half-written follow-up");

  assert.equal(
    backing.getItem(storeModule.FOLLOWUP_PREFIX + "review-a"),
    JSON.stringify({ "item-1": "A half-written follow-up" })
  );
  assert.equal(storeModule.createStore({ backing: backing }).readFollowupDraft("review-a", "item-1"), "A half-written follow-up");
  assert.equal(first.readFollowupDraft("review-b", "item-1"), "", "another review cannot see it");
  assert.equal(first.clearFollowupDraft("review-a", "item-1"), true);
  assert.equal(first.readFollowupDraft("review-a", "item-1"), "");
});
