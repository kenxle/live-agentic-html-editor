// What counts as a change, and what the snapshot refuses to carry.
//
// The paint itself is a browser thing (test/browser/change_highlight.spec.js).
// These are the pure parts underneath it: the comparison that decides which
// blocks are new or different, the rule that keeps a page's own moving parts
// out of it, and the cap that decides when the page is too big to bother.

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

  assert.equal(
    sync.snapshotPayload("review-1", "http://x/", many, null, sync.RELOAD_REASON.REBUILT),
    null,
    "over the block cap it stores nothing"
  );
  assert.ok(
    sync.snapshotPayload("review-1", "http://x/", many.slice(0, sync.SNAPSHOT_MAX_BLOCKS), null, sync.RELOAD_REASON.REBUILT),
    "and at the cap it still does"
  );
});

test("the snapshot refuses a page whose text is over the byte cap", () => {
  const fat = ["x".repeat(sync.SNAPSHOT_MAX_BYTES + 1)];

  assert.equal(sync.snapshotPayload("review-1", "http://x/", fat, null, sync.RELOAD_REASON.REBUILT), null);
});

test("an empty page stores nothing rather than an empty baseline", () => {
  assert.equal(sync.snapshotPayload("review-1", "http://x/", [], null, sync.RELOAD_REASON.REBUILT), null);
});

test("the snapshot is exact to the review and the URL, and it is read once", () => {
  const storage = memoryStorage();
  const win = fakeWindow({ storage: storage, texts: ["first block", "second block"] });

  assert.equal(sync.saveBlockSnapshot(win, "review-1", sync.RELOAD_REASON.REBUILT), true);
  assert.deepEqual(sync.takeBlockSnapshot(win, "review-1").texts, ["first block", "second block"]);
  assert.equal(sync.takeBlockSnapshot(win, "review-1"), null, "a snapshot is never used twice");

  sync.saveBlockSnapshot(win, "review-1", sync.RELOAD_REASON.REBUILT);
  assert.equal(sync.takeBlockSnapshot(win, "review-2"), null, "another review's snapshot is not this one's");

  sync.saveBlockSnapshot(win, "review-1", sync.RELOAD_REASON.REBUILT);
  const elsewhere = fakeWindow({ storage: storage, href: "http://127.0.0.1:8000/other.html" });
  assert.equal(sync.takeBlockSnapshot(elsewhere, "review-1"), null, "another page's snapshot is not this page's");
});

test("a page over the cap leaves nothing behind for the next load to read", () => {
  const storage = memoryStorage();
  const many = [];
  for (let i = 0; i <= sync.SNAPSHOT_MAX_BLOCKS; i += 1) many.push("line " + i);
  const win = fakeWindow({ storage: storage, texts: many });

  assert.equal(sync.saveBlockSnapshot(win, "review-1", sync.RELOAD_REASON.REBUILT), false);
  assert.equal(storage.getItem(sync.BLOCK_SNAPSHOT_KEY), null);
  assert.equal(sync.takeBlockSnapshot(win, "review-1"), null, "and the feature simply sits that reload out");
});

// ---------------------------------------------------------------------------
// A page that changes itself is not the agent
// ---------------------------------------------------------------------------
//
// Ken, on a reveal.js deck: "that countdown timer is automatically dynamic. The
// agent is not changing it, but the highlight is applying to it because it's
// changing. I'm seeing that on page number changes as well."

test("a block that moved between two readings of the SAME page is self-changing", () => {
  const settled = ["a paragraph", "12:04", "slide 3"];
  const atReload = ["a paragraph", "12:01", "slide 3"];

  const excluded = sync.selfChangingBlocks(settled, atReload);
  assert.deepEqual(excluded.indexes, [1], "by position");
  assert.deepEqual(excluded.texts.sort(), ["12:01", "12:04"], "and by both texts it wore");
});

test("a block the old page was already changing is left alone, however new it looks", () => {
  // A status line the page rewrites itself, caught between the two readings.
  const settled = ["a paragraph", "Recalculating the pace band right now."];
  const atReload = ["a paragraph", "Holding the pace band steady right now."];
  const moving = sync.selfChangingBlocks(settled, atReload);
  const snapshot = {
    texts: atReload,
    excludedPaths: ["MAIN[0]/P[1]"],
    excludedTexts: moving.texts
  };

  // It comes back saying a THIRD thing, so neither text it wore matches. Its
  // position in the page is what is left, and that is enough.
  assert.equal(
    sync.isExcludedBlock(snapshot, "Recalculating the pace band once more.", "MAIN[0]/P[1]"),
    true,
    "excluded by where it sits"
  );
  assert.equal(sync.isExcludedBlock(snapshot, atReload[1], "MAIN[0]/P[9]"), true, "and by what it said");
});

test("a block that changes only across the reload is painted", () => {
  const settled = ["a paragraph", "a second paragraph"];
  const atReload = settled.slice();
  const moving = sync.selfChangingBlocks(settled, atReload);
  const snapshot = { texts: atReload, excludedPaths: [], excludedTexts: moving.texts };

  assert.deepEqual(sync.diffBlockTexts(snapshot, ["a paragraph", "the agent rewrote this one"]), [1]);
  assert.equal(
    sync.isExcludedBlock(snapshot, "the agent rewrote this one", "MAIN[0]/P[1]"),
    false,
    "nothing about it was moving on its own"
  );
});

test("an added paragraph is not suppressed by the block the reviewer edited", () => {
  // The collision a bare index had, which is why the exclusion is a structural
  // path: the reviewer's own edited paragraph differs between the two readings,
  // the agent adds a paragraph above it, and the added one inherits the index
  // the edited one used to hold.
  const snapshot = { texts: ["intro", "reviewer edited this"], excludedPaths: ["MAIN[0]/P[1]"], excludedTexts: [] };

  assert.equal(sync.isExcludedBlock(snapshot, "the agent added this", "MAIN[0]/P[2]"), false);
});

test("a page that adds blocks to itself excludes rather than paints", () => {
  const settled = ["one", "two"];
  const atReload = ["a banner the page added", "one", "two"];

  const excluded = sync.selfChangingBlocks(settled, atReload);
  assert.deepEqual(excluded.indexes, [0, 1, 2], "every position past the insertion moved on its own");
});

test("the counter guard catches the tick that held still across both readings", () => {
  ["12:04", "3 / 40", "87%", "2 of 9", "0:09", "1,204"].forEach((text) => {
    assert.equal(sync.looksLikeACounter(text), true, text + " reads as a counter");
  });
  [
    "The third week is where it shows.",
    "Week 3 of the comeback plan",
    "",
    "chapter",
    "1234567890123"
  ].forEach((text) => {
    assert.equal(sync.looksLikeACounter(text), false, text + " does not");
  });
});

test("the guard keeps a counter out even with nothing excluded", () => {
  const snapshot = { texts: ["a paragraph", "12:04"], excludedPaths: [], excludedTexts: [] };

  assert.equal(sync.isExcludedBlock(snapshot, "12:03", "MAIN[0]/P[1]"), true, "the tick is not news");
  assert.equal(sync.isExcludedBlock(snapshot, "The agent rewrote this.", "MAIN[0]/P[0]"), false);
});

test("only the agent's rebuild is read back: any other reload reports nothing", () => {
  const storage = memoryStorage();
  const win = fakeWindow({ storage: storage, texts: ["first block", "second block"] });

  assert.equal(sync.saveBlockSnapshot(win, "review-1", "heal"), true, "it is still written");
  assert.equal(
    sync.takeBlockSnapshot(win, "review-1"),
    null,
    "and refused on the way in, because no agent edit is behind it"
  );
});

// ---------------------------------------------------------------------------
// A mirror of the page's text is not a change
// ---------------------------------------------------------------------------
//
// reveal.js copies the current slide's words into an off-screen aria-live
// region for screen readers. An agent rewording that slide changes the page in
// two places, and only one of them is somewhere a person is looking.

function fakeElement(attrs, parent) {
  const values = attrs || {};
  return {
    nodeType: 1,
    tagName: "DIV",
    parentNode: parent || null,
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(values, name),
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(values, name) ? values[name] : null)
  };
}

test("a block inside a live region, or a hidden one, is not the page changing", () => {
  const cases = [
    { "aria-live": "polite" },
    { "aria-live": "assertive" },
    { role: "status" },
    { role: "alert" },
    { role: "log" }
  ];
  cases.forEach((attrs) => {
    const announcer = fakeElement(attrs, fakeElement({}, null));
    const block = fakeElement({}, announcer);
    assert.equal(sync.isInsideMirror(block), true, JSON.stringify(attrs) + " marks a copy, not the page");
  });
});

test("an off-screen slide is the page, not a copy of it", () => {
  const main = fakeElement({}, null);
  assert.equal(sync.isInsideMirror(fakeElement({}, main)), false);
  assert.equal(sync.isInsideMirror(fakeElement({ role: "main" }, main)), false);
  assert.equal(sync.isInsideMirror(null), false);
  // reveal marks every slide that is not the current one with BOTH the hidden
  // attribute and aria-hidden. Those are the reviewer's own slides, and most of
  // what an agent changes is not on screen when it lands, so neither spelling
  // may read as a mirror.
  const offScreenSlide = fakeElement({ "aria-hidden": "true", hidden: "" }, main);
  assert.equal(sync.isInsideMirror(fakeElement({}, offScreenSlide)), false);
});

test("a one pixel box is a screen-reader copy; no box at all is a hidden slide", () => {
  const srOnly = {
    getClientRects: () => [{ width: 1, height: 1 }],
    getBoundingClientRect: () => ({ width: 1, height: 1 })
  };
  const takenOutOfLayout = {
    getClientRects: () => [],
    getBoundingClientRect: () => ({ width: 0, height: 0 })
  };
  const realParagraph = {
    getClientRects: () => [{ width: 600, height: 48 }],
    getBoundingClientRect: () => ({ width: 600, height: 48 })
  };

  assert.equal(sync.isVisuallyHidden(srOnly), true);
  assert.equal(
    sync.isVisuallyHidden(takenOutOfLayout),
    false,
    "a slide reveal has taken out of layout still carries news worth painting"
  );
  assert.equal(sync.isVisuallyHidden(realParagraph), false);
});
