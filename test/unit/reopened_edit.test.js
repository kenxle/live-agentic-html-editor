// Typing into a reopened hand edit takes it off the agent's desk until commit.
//
// Owner: 2A. The spec is
// docs/features/20260922.01_draft_write_cost/01_spec_draft_write_cost.md,
// requirement 6 (task 5). Before this, a committed edit the reviewer opened
// again and typed into kept its `ready` state while they typed, so every
// keystroke posted `item.ready` (never coalesced) and review.json showed the
// half-typed text as work the agent could act on (DRAFT_PERSISTENCE.md, "Something
// the numbers turned up").
//
// The rule, the way comments already work:
//
//   - opening an edit changes nothing
//   - the first keystroke that changes its text withdraws it to draft
//   - typing it back to the committed wording puts it back to ready
//   - committing it bumps the revision, decided from whether it was ever
//     committed, never from whether it is a draft right now
//   - a crash while withdrawn does not leave the edit off the page and out of
//     review.json: the next holder of the review commits it, as leaving the
//     page would have
//
// The fake element is the one storage_quota_typing.test.js uses, plus a way to
// fire the block's input event.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const lifecycle = require("../../src/shared/lifecycle.js");
const protocol = require("../../src/shared/protocol.js");
const projection = require("../../src/service/projection.js");
const storeModule = require("../../src/layer/store.js");
const editingModule = require("../../src/layer/editing.js");

const REVIEW = "review-reopen";
const PAGE = { origin: "http://localhost:3000", path: "/plan", title: "Plan", seq: 1, source_hint: null };

function fakeElement(text) {
  const attrs = Object.create(null);
  const handlers = Object.create(null);
  return {
    nodeType: 1,
    tagName: "P",
    textContent: text,
    innerHTML: text,
    isConnected: true,
    parentElement: null,
    parentNode: null,
    childNodes: [],
    firstChild: null,
    classList: { add() {}, remove() {}, contains: () => false },
    style: {},
    closest: () => null,
    matches: () => false,
    hasAttribute: (name) => Object.prototype.hasOwnProperty.call(attrs, name),
    getAttribute: (name) => (Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null),
    setAttribute: (name, value) => {
      attrs[name] = String(value);
    },
    removeAttribute: (name) => {
      delete attrs[name];
    },
    addEventListener(name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
    },
    removeEventListener(name, fn) {
      handlers[name] = (handlers[name] || []).filter((each) => each !== fn);
    },
    getBoundingClientRect: () => ({ top: 0, left: 0, width: 100, height: 20, bottom: 20, right: 100 }),
    querySelectorAll: () => [],
    contains: () => false,
    focus() {},
    // The reviewer typing: the block's words change, then its input event fires.
    typeTo(next) {
      this.textContent = next;
      this.innerHTML = next;
      (handlers.input || []).slice().forEach((fn) => fn({ type: "input", inputType: "insertText" }));
    }
  };
}

function surfaceOver(store, posted) {
  const doc = {
    body: fakeElement(""),
    documentElement: null,
    createElement: () => fakeElement(""),
    createRange: null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {},
    getElementById: () => null
  };
  return editingModule.createEditing({
    document: doc,
    window: null,
    reviewId: REVIEW,
    store: store,
    sync: { recordItem: (item, options) => posted.push({ item: Object.assign({}, item), options: options || {} }) },
    highlights: { ensureStylesheet() {}, surface: () => ({ root: null }), addSurfaceStyle() {} },
    page: PAGE
  });
}

// One committed hand edit, rev 1, ready, and the block it lives on.
function committedEdit() {
  const store = storeModule.createStore();
  const posted = [];
  const surface = surfaceOver(store, posted);
  const block = fakeElement("Warm up for ten minutes.");
  surface.editBlock(block);
  block.typeTo("Warm up for fifteen minutes.");
  const committed = surface.commit({ reason: "commit" });
  assert.equal(committed.state, record.STATE.READY);
  assert.equal(committed.rev, 1);
  posted.length = 0;
  return { store, posted, surface, block, id: committed.id };
}

test("opening a committed edit without changing its text changes nothing", () => {
  const { store, posted, surface, block, id } = committedEdit();
  const before = store.readItem(REVIEW, id);

  surface.editBlock(block);
  assert.deepEqual(store.readItem(REVIEW, id), before, "opening wrote nothing");
  assert.equal(posted.length, 0, "and posted nothing");
  assert.equal(surface.commit({ reason: "commit" }), null, "leaving without a change is not a commit");
  const after = store.readItem(REVIEW, id);
  assert.equal(after.state, record.STATE.READY);
  assert.equal(after.rev, 1);
});

test("the first keystroke that changes the text withdraws the edit to draft, and posts content, not ready", () => {
  const { store, posted, surface, block, id } = committedEdit();
  surface.editBlock(block);
  block.typeTo("Warm up for fifteen minutes, then");

  const now = store.readItem(REVIEW, id);
  assert.equal(now.state, record.STATE.DRAFT, "off the agent's desk while the reviewer types");
  assert.equal(now.rev, 1, "a keystroke never moves the revision");
  assert.equal(posted.length, 1);
  assert.equal(posted[0].item.state, record.STATE.DRAFT);
  assert.equal(posted[0].options.existing, true, "posted as content on an item the helper knows");
  assert.equal(posted[0].options.immediate, undefined);
});

test("typing it back to the committed wording puts it back to ready", () => {
  const { store, surface, block, id } = committedEdit();
  surface.editBlock(block);
  block.typeTo("Warm up for fifteen minutes, then");
  assert.equal(store.readItem(REVIEW, id).state, record.STATE.DRAFT);

  block.typeTo("Warm up for fifteen minutes.");
  const back = store.readItem(REVIEW, id);
  assert.equal(back.state, record.STATE.READY);
  assert.equal(back.rev, 1);
});

test("committing a withdrawn edit bumps the revision and a reply to the old one is refused", () => {
  const { store, surface, block, id } = committedEdit();
  surface.editBlock(block);
  block.typeTo("Warm up for twenty minutes.");
  assert.equal(store.readItem(REVIEW, id).state, record.STATE.DRAFT);

  const committed = surface.commit({ reason: "commit" });
  assert.equal(committed.state, record.STATE.READY);
  assert.equal(committed.rev, 2, "the agent sees a new revision");
  assert.equal(committed.after, "Warm up for twenty minutes.");

  const stale = lifecycle.applyReply(committed, { rev: 1, status: "handled", agent: "claude" });
  assert.equal(stale.accepted, false, "a reply naming the old wording's revision is refused as stale");
  const fresh = lifecycle.applyReply(committed, { rev: 2, status: "handled", agent: "claude" });
  assert.equal(fresh.accepted, true);
});

test("a first commit of a new edit still stays at revision one", () => {
  const store = storeModule.createStore();
  const posted = [];
  const surface = surfaceOver(store, posted);
  const block = fakeElement("Warm up for ten minutes.");
  surface.editBlock(block);
  block.typeTo("Warm up for twelve minutes.");
  const committed = surface.commit({ reason: "commit" });
  assert.equal(committed.rev, 1);
  assert.equal(committed.state, record.STATE.READY);
});

// What the helper would project from the posts, in order, as review.json does.
function projected(posts) {
  let n = 0;
  const events = posts.map((p) => {
    n += 1;
    const type = p.options.existing
      ? protocol.EVENT.ITEM_CONTENT
      : p.item.state === record.STATE.READY
        ? protocol.EVENT.ITEM_READY
        : protocol.EVENT.ITEM_CREATED;
    const e = protocol.newEvent({
      event: type,
      event_id: "evt_reopen_" + n,
      review: REVIEW,
      item: p.item.id,
      rev: p.item.rev,
      page_path: p.item.page_path,
      page_title: p.item.page_title,
      page_seq: p.item.page_seq,
      payload: { draft: record.isDraft(p.item), record: p.item }
    });
    e.seq = n;
    return e;
  });
  const got = projection.project(REVIEW, events, { generated_at: "2026-09-22T00:00:00.000Z" });
  const items = [];
  (got.pages || []).forEach((page) => page.items.forEach((item) => items.push(item)));
  return items;
}

test("a crash while withdrawn does not drop the edit from the page or review.json", () => {
  const store = storeModule.createStore();
  const posted = [];
  const first = surfaceOver(store, posted);
  const block = fakeElement("Warm up for ten minutes.");
  first.editBlock(block);
  block.typeTo("Warm up for fifteen minutes.");
  const committed = first.commit({ reason: "commit" });
  first.editBlock(block);
  block.typeTo("Warm up for fifteen minutes, then stretch");
  assert.equal(store.readItem(REVIEW, committed.id).state, record.STATE.DRAFT);
  assert.equal(projected(posted).length, 0, "while withdrawn, review.json does not carry it");

  // The tab dies here: no commit, no unload. The next page to hold the review
  // builds a new surface over the same storage.
  const second = surfaceOver(store, posted);
  const recovered = second.recoverWithdrawn();
  assert.equal(recovered.length, 1);

  const item = store.readItem(REVIEW, committed.id);
  assert.equal(item.state, record.STATE.READY, "it is outstanding again, so replay puts it on the page");
  assert.equal(record.isOutstanding(item), true);
  assert.equal(item.rev, 2, "committed as leaving the page would have, at a new revision");
  assert.equal(item.after, "Warm up for fifteen minutes, then stretch", "nothing the reviewer typed is lost");

  const inFile = projected(posted);
  assert.equal(inFile.length, 1, "and review.json carries it again");
  assert.equal(inFile[0].state, "ready");
  assert.equal(inFile[0].rev, 2);
});

test("recovery leaves a never-committed draft edit, and the edit being typed, alone", () => {
  const store = storeModule.createStore();
  const posted = [];
  const surface = surfaceOver(store, posted);
  const fresh = fakeElement("A new block.");
  surface.editBlock(fresh);
  fresh.typeTo("A new block, changed.");
  // Still open: this is the reviewer typing right now.
  assert.equal(surface.recoverWithdrawn().length, 0);
  const id = surface.itemFor(fresh).id;
  assert.equal(store.readItem(REVIEW, id).state, record.STATE.DRAFT);

  // A second surface (a later page) finds a draft that was never committed:
  // there is no committed wording to protect, so it is left for the reviewer.
  const later = surfaceOver(store, posted);
  assert.equal(later.recoverWithdrawn().length, 0);
});
