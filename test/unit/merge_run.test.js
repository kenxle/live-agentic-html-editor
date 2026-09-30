// Merge on load for a run record (free-writing plan Task 1.4): the browser
// wins on the new fields while its work is unacknowledged, whichever way the
// run moved, and a later helper revision still wins over an acknowledged copy.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const merge = require("../../src/shared/merge.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");

const RUN_KEYS = ["new_blocks", "anchor_after_html", "anchor_tag_after", "placement"];

function pair(browserBlocks, storeBlocks) {
  const f = createFixtures({ seed: "merge" });
  const base = f.runItem();
  const browser = Object.assign({}, base, { new_blocks: browserBlocks, acknowledged: false });
  const store = Object.assign({}, base, { new_blocks: storeBlocks });
  return { browser, store };
}

test("the four run fields are content fields", () => {
  for (const key of RUN_KEYS) assert.ok(merge.CONTENT_FIELDS.indexOf(key) !== -1, key);
});

test("at the same revision, unacknowledged, the browser's longer run wins", () => {
  const longer = [{ tag: "p", html: "One" }, { tag: "p", html: "Two" }, { tag: "p", html: "Three" }];
  const { browser, store } = pair(longer, longer.slice(0, 1));
  const got = merge.mergeItem(browser, store);
  assert.equal(got.reason, merge.REASON.SAME_REV_UNACKED);
  assert.deepEqual(got.item.new_blocks, longer);
});

test("at the same revision, unacknowledged, the browser's shorter run also wins", () => {
  const longer = [{ tag: "p", html: "One" }, { tag: "p", html: "Two" }, { tag: "p", html: "Three" }];
  const { browser, store } = pair(longer.slice(0, 1), longer);
  const got = merge.mergeItem(browser, store);
  assert.deepEqual(got.item.new_blocks, longer.slice(0, 1));
});

test("the browser's tag change and anchor markup win too", () => {
  const { browser, store } = pair([{ tag: "p", html: "One" }], [{ tag: "p", html: "One" }]);
  browser.anchor_tag_after = "h2";
  browser.anchor_after_html = "Browser words";
  store.anchor_tag_after = null;
  store.anchor_after_html = "Store words";
  const got = merge.mergeItem(browser, store).item;
  assert.equal(got.anchor_tag_after, "h2");
  assert.equal(got.anchor_after_html, "Browser words");
});

test("a browser copy with no run fields leaves none behind from the store", () => {
  const { browser, store } = pair([{ tag: "p", html: "One" }], [{ tag: "p", html: "One" }]);
  for (const key of RUN_KEYS) delete browser[key];
  const got = merge.mergeItem(browser, store).item;
  for (const key of RUN_KEYS) assert.equal(Object.prototype.hasOwnProperty.call(got, key), false, key);
});

test("a later helper revision wins over an acknowledged browser copy", () => {
  const { browser, store } = pair([{ tag: "p", html: "Browser" }], [{ tag: "p", html: "Helper" }]);
  browser.acknowledged = true;
  const later = record.bumpRev(store, { new_blocks: [{ tag: "p", html: "Helper later" }] });
  const got = merge.mergeItem(browser, later);
  assert.equal(got.reason, merge.REASON.STORE_NEWER_REV);
  assert.deepEqual(got.item.new_blocks, [{ tag: "p", html: "Helper later" }]);
});
