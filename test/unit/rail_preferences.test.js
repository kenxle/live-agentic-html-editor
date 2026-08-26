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

  // The bucket is written whole, so both preferences are always in it. `pill`
  // is null until the reviewer moves it off its default corner.
  assert.deepEqual(JSON.parse(backing.getItem(storeModule.UI_PREFIX + "review-a")), {
    collapsed: true,
    pill: null
  });
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

// ---------------------------------------------------------------------------
// Where the reviewer put the pill
// ---------------------------------------------------------------------------
//
// The pill sits bottom-right, which is out of the way of most pages and not out
// of the way of all of them. Ken, on a site with its own bottom bar for thumb
// reach: "it's covering the buttons and i need to drag it to a different
// location." The tool is a guest on somebody else's page and cannot know what is
// underneath it, so the reviewer moves it and the choice is remembered.

test("a moved pill is remembered as a corner and two offsets, never as a point", () => {
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });

  store.writeUiPreferences("review-a", { collapsed: true, pill: { h: "left", x: 12, v: "top", y: 90 } });

  assert.deepEqual(store.readUiPreferences("review-a"), {
    collapsed: true,
    pill: { h: "left", x: 12, v: "top", y: 90 }
  });
  assert.equal(store.readUiPreferences("review-b").pill, null, "another review keeps the default corner");
});

test("collapsing does not forget where the pill was put, and moving it does not forget collapse", () => {
  // The bucket is written whole. Writing one field and omitting the other is how
  // a reviewer collapses the rail and finds the pill back in the corner they
  // dragged it out of.
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });

  store.writeUiPreferences("review-a", { collapsed: false, pill: { h: "right", x: 16, v: "top", y: 24 } });
  store.writeUiPreferences("review-a", {
    collapsed: true,
    pill: store.readUiPreferences("review-a").pill
  });

  const kept = store.readUiPreferences("review-a");
  assert.equal(kept.collapsed, true);
  assert.deepEqual(kept.pill, { h: "right", x: 16, v: "top", y: 24 });
});

test("a spot that is not a spot is no spot at all", () => {
  // Browser storage is editable by anyone with devtools open, and by an earlier
  // version of this file. A shape that cannot be trusted is dropped rather than
  // applied, which puts the pill back on its default corner instead of somewhere
  // the reviewer cannot reach it.
  const store = storeModule.createStore({ backing: memoryBacking() });

  const rejected = [
    { h: "middle", x: 1, v: "top", y: 1 },
    { h: "left", v: "top" },
    { h: "left", x: -5, v: "top", y: 10 },
    { h: "left", x: "12", v: "top", y: NaN },
    "bottom-left",
    null
  ];
  rejected.forEach((pill, index) => {
    store.writeUiPreferences("review-junk", { collapsed: false, pill: pill });
    assert.equal(store.readUiPreferences("review-junk").pill, null, "rejected " + index);
  });
});
