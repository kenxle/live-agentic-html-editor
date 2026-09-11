// What counts as a change, and what the snapshot refuses to carry.
//
// The paint itself is a browser thing (test/browser/change_highlight.spec.js).
// These are the two pure parts underneath it: the comparison that decides which
// blocks are new or different, and the cap that decides when the page is too
// big to bother.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const sync = require("../../src/layer/sync.js");

function memoryStorage() {
  const values = Object.create(null);
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
    setItem: (key, value) => {
      values[key] = String(value);
    },
    removeItem: (key) => {
      delete values[key];
    }
  };
}

/** A document that answers querySelectorAll with plain paragraphs. */
function fakeDocument(texts) {
  const blocks = texts.map((text) => ({
    tagName: "P",
    textContent: text,
    id: "",
    nodeType: 1,
    parentNode: null,
    getAttribute: () => null,
    contains: () => false
  }));
  return { querySelectorAll: () => blocks };
}

function fakeWindow(options) {
  const opts = options || {};
  return {
    location: { href: opts.href || "http://127.0.0.1:8000/report.html", hash: "" },
    sessionStorage: opts.storage || memoryStorage(),
    document: fakeDocument(opts.texts || [])
  };
}

test("a block whose text is new is a change, and a block that only moved is not", () => {
  const before = ["one", "two", "three"];
  const after = ["two", "three", "one", "brand new"];

  assert.deepEqual(sync.diffBlockTexts(before, after), [3], "only the new block");
});

test("an edited block reads as a change, because its new text is new", () => {
  const before = ["intro", "the third week is where it shows", "outro"];
  const after = ["intro", "the third week is where a comeback holds", "outro"];

  assert.deepEqual(sync.diffBlockTexts(before, after), [1]);
});

test("a repeated paragraph paints only the copy that was added", () => {
  const before = ["said once"];
  const after = ["said once", "said once"];

  assert.deepEqual(sync.diffBlockTexts(before, after), [1], "the count is tracked, not just membership");
});

test("a removal paints nothing: there is nothing left to paint", () => {
  const before = ["one", "two", "three"];
  const after = ["one", "three"];

  assert.deepEqual(sync.diffBlockTexts(before, after), []);
});

test("no baseline is not everything changed", () => {
  assert.deepEqual(sync.diffBlockTexts([], ["one", "two"]), [], "a first load lights nothing up");
  assert.deepEqual(sync.diffBlockTexts(null, ["one"]), []);
  assert.deepEqual(sync.diffBlockTexts(["one"], []), []);
});

test("the snapshot refuses a page with more blocks than the cap", () => {
  const many = [];
  for (let i = 0; i <= sync.SNAPSHOT_MAX_BLOCKS; i += 1) many.push("line " + i);

  assert.equal(sync.snapshotPayload("review-1", "http://x/", many), null, "over the block cap it stores nothing");
  assert.ok(
    sync.snapshotPayload("review-1", "http://x/", many.slice(0, sync.SNAPSHOT_MAX_BLOCKS)),
    "and at the cap it still does"
  );
});

test("the snapshot refuses a page whose text is over the byte cap", () => {
  const fat = ["x".repeat(sync.SNAPSHOT_MAX_BYTES + 1)];

  assert.equal(sync.snapshotPayload("review-1", "http://x/", fat), null);
});

test("an empty page stores nothing rather than an empty baseline", () => {
  assert.equal(sync.snapshotPayload("review-1", "http://x/", []), null);
});

test("the snapshot is exact to the review and the URL, and it is read once", () => {
  const storage = memoryStorage();
  const win = fakeWindow({ storage: storage, texts: ["first block", "second block"] });

  assert.equal(sync.saveBlockSnapshot(win, "review-1"), true);
  assert.deepEqual(sync.takeBlockSnapshot(win, "review-1"), ["first block", "second block"]);
  assert.equal(sync.takeBlockSnapshot(win, "review-1"), null, "a snapshot is never used twice");

  sync.saveBlockSnapshot(win, "review-1");
  assert.equal(sync.takeBlockSnapshot(win, "review-2"), null, "another review's snapshot is not this one's");

  sync.saveBlockSnapshot(win, "review-1");
  const elsewhere = fakeWindow({ storage: storage, href: "http://127.0.0.1:8000/other.html" });
  assert.equal(sync.takeBlockSnapshot(elsewhere, "review-1"), null, "another page's snapshot is not this page's");
});

test("a page over the cap leaves nothing behind for the next load to read", () => {
  const storage = memoryStorage();
  const many = [];
  for (let i = 0; i <= sync.SNAPSHOT_MAX_BLOCKS; i += 1) many.push("line " + i);
  const win = fakeWindow({ storage: storage, texts: many });

  assert.equal(sync.saveBlockSnapshot(win, "review-1"), false);
  assert.equal(storage.getItem(sync.BLOCK_SNAPSHOT_KEY), null);
  assert.equal(sync.takeBlockSnapshot(win, "review-1"), null, "and the feature simply sits that reload out");
});
