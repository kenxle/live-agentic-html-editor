// How wide the rail is allowed to be, and what is remembered about it.
//
// Ken: "some of these responses are getting quite thorough and long, so the
// chat rail should be drag-expandable: you should be able to drag the edge of
// it to expand it horizontally so you can read more."
//
// The drag, the arrow keys and the restore-from-storage path all go through one
// pure function, so the whole of the resize policy can be stated here without a
// browser. The browser half (the grip, the pointer, the surfaces that keep
// clear of a widened rail) is test/browser/rail_resize.spec.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const overlay = require("../../src/layer/overlay.js");
const storeModule = require("../../src/layer/store.js");

const clamp = overlay.clampRailWidth;

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

test("the rail's width is clamped to a readable panel that is not the whole window", () => {
  // A width the reviewer can have is handed back as it is.
  assert.equal(clamp(600, 1280), 600);

  // Too narrow: the cards' own controls start wrapping below this.
  assert.equal(clamp(120, 1280), overlay.RAIL_MIN_WIDTH);
  assert.equal(overlay.RAIL_MIN_WIDTH, 280);

  // Too wide: 70% of the viewport, or 48px short of its left edge, whichever
  // comes first. On 1280 that is 896 (0.7 x 1280) rather than 1232.
  assert.equal(clamp(5000, 1280), 896);
  assert.equal(clamp(5000, 1600), 1120, "0.7 x 1600, again the smaller of the two");

  // The minimum WINS a fight with the maximum. On a 360px phone 70% is 252,
  // which is a rail whose cards have started wrapping; a reviewer on a small
  // window is better served by a readable panel that covers more of the page.
  assert.equal(clamp(900, 360), overlay.RAIL_MIN_WIDTH);

  // Rounded, because this ends up as a pixel length on a style attribute.
  assert.equal(clamp(451.6, 1280), 452);
});

test("a width with no viewport to measure against is still bounded below", () => {
  // Node, or a rail built with no document: there is no viewport to ask, so
  // only the floor can be applied. Nothing here may throw.
  assert.equal(clamp(600), 600);
  assert.equal(clamp(10), overlay.RAIL_MIN_WIDTH);
  assert.equal(clamp(600, 0), 600, "a viewport of zero is not a measurement");
});

test("anything that is not a width reads as no width, which means the default", () => {
  [null, undefined, 0, -40, NaN, Infinity, "wide", {}].forEach((value) => {
    assert.equal(clamp(value, 1280), null, JSON.stringify(String(value)) + " is not a width");
  });
});

test("the width the reviewer dragged to survives a reload, beside the other chrome preferences", () => {
  const backing = memoryBacking();
  const store = storeModule.createStore({ backing: backing });

  store.writeUiPreferences("review-a", { collapsed: true, pill: null, width: 640 });
  const kept = store.readUiPreferences("review-a");
  assert.equal(kept.width, 640);
  assert.equal(kept.collapsed, true, "and it did not cost the other fields");

  // Stored UNCLAMPED. A window dragged narrow and then wide again gives the
  // reviewer back the width they chose, not the one the small window forced.
  store.writeUiPreferences("review-b", { collapsed: false, pill: null, width: 4000 });
  assert.equal(store.readUiPreferences("review-b").width, 4000);
  assert.equal(clamp(store.readUiPreferences("review-b").width, 1280), 896, "clamped where it is read");

  // A default width is the absence of a width, not a number standing in for one.
  assert.equal(store.readUiPreferences("review-c").width, null);
  store.writeUiPreferences("review-a", { collapsed: true, pill: null, width: "wide" });
  assert.equal(store.readUiPreferences("review-a").width, null, "and junk in the bucket is no width");
});

test("a rail with no document still answers about its width without throwing", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const rail = overlay.createRail({ document: null, store: store, reviewId: "review-headless" });

  assert.equal(rail.width(), null, "nothing is on screen to measure");
  assert.doesNotThrow(() => rail.setWidth(600));
  assert.deepEqual(rail.gripInfo(), { present: false, dragging: false, rect: null });
});
