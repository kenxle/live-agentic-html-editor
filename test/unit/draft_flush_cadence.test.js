// Unsent drafts go to the helper rarely; committed work never waits.
//
// Owner: 1B. The spec is
// docs/features/20260922.01_draft_write_cost/01_spec_draft_write_cost.md,
// requirements 4, 5 and 7 (tasks 3 and 4). Measured before this: the helper
// heard from a typing page about once a second, because every post that
// finished posted again at once (DRAFT_PERSISTENCE.md section 4).
//
// The rules under test:
//
//   - A draft for an item goes at most once per 10 seconds. The floor lives in
//     flush, so the poll loop cannot get round it, and it is a fixed deadline
//     from the item's last draft post, not a timer that typing pushes back.
//   - Leaving the box, hiding the tab and leaving the page send at once.
//   - An item is held back only when every event it has queued is a draft, so
//     a ready event never goes ahead of its own older draft.
//   - A commit asked for during a post goes the moment that post finishes.
//   - Hold still holds: blur and tab-hide post nothing while it is on.
//
// The clock is node:test's mock timers, and the poll loop is running (start()).
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");

const REVIEW = "review-cadence";
const FLOOR = protocol.FLUSH.DRAFT_FLOOR_MS;

function draftItem(note) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.DRAFT,
    note: note,
    page_origin: "http://127.0.0.1:4000",
    page_path: "/plan"
  });
}

function eventTarget() {
  const handlers = Object.create(null);
  return {
    addEventListener(name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
    },
    removeEventListener(name, fn) {
      handlers[name] = (handlers[name] || []).filter((each) => each !== fn);
    },
    fire(name) {
      (handlers[name] || []).slice().forEach((fn) => fn({ type: name }));
    }
  };
}

function ok(body) {
  return { ok: true, status: 200, json: async () => body };
}

// A running client over a fake helper. Every events.append is recorded with the
// mocked clock's time, and `hold()` makes the next one wait until released.
function rig(t, options) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000000 });
  const opts = options || {};
  const store = storeModule.createStore({ locks: null });
  if (opts.held) store.setHeld(REVIEW, true);
  const posts = [];
  let gate = null;
  let seq = 0;
  const doc = Object.assign(eventTarget(), { hidden: false, location: { pathname: "/plan" } });
  const win = Object.assign(eventTarget(), { location: { pathname: "/plan" } });
  const fetchImpl = async (url, config) => {
    const path = String(url);
    if (path.indexOf("/events") !== -1) {
      const sent = JSON.parse(config.body);
      posts.push({ at: Date.now(), events: sent.events, keepalive: !!config.keepalive });
      if (gate) await gate.promise;
      seq += sent.events.length;
      return ok({ accepted: sent.events.map((e) => e.event_id), seq: seq });
    }
    if (path.indexOf("/replies") !== -1) return ok({ events: [], seq: seq });
    if (path.indexOf("/window/release") !== -1) return ok({ released: true });
    return ok({ granted: true, session_secret: "secret", heartbeat_seconds: 30 });
  };
  const sync = syncModule.createSync({
    review: REVIEW,
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: doc,
    window: win,
    fetch: fetchImpl
  });
  t.after(() => {
    sync.stop();
    t.mock.timers.reset();
  });

  async function drain() {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  }

  return {
    store,
    sync,
    doc,
    win,
    posts,
    drain,
    // Posts that carried a draft event.
    draftPosts: () => posts.filter((p) => p.events.some((e) => e.draft === true)),
    async advance(ms, step) {
      const by = step || 100;
      for (let done = 0; done < ms; done += by) {
        t.mock.timers.tick(Math.min(by, ms - done));
        await drain();
      }
    },
    hold() {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      gate = { promise, release };
      return () => {
        gate = null;
        release();
      };
    },
    type(item, text) {
      const next = Object.assign({}, item, { note: text });
      store.write(REVIEW, next);
      sync.recordItem(next);
      return next;
    }
  };
}

async function started(r) {
  await r.sync.start();
  await r.drain();
}

// ---------------------------------------------------------------------------
// Task 3: the cadence
// ---------------------------------------------------------------------------

test("continuous typing, with the poll loop running, posts a draft at most once per 10 seconds", async (t) => {
  const r = rig(t);
  await started(r);
  let item = draftItem("");
  let text = "";
  // Thirty seconds of typing, a keystroke every 200ms: 150 keystrokes.
  for (let i = 0; i < 150; i += 1) {
    text += "x";
    item = r.type(item, text);
    await r.advance(200);
  }
  const drafts = r.draftPosts();
  assert.ok(drafts.length >= 2, "drafts still reach the helper while typing: " + drafts.length);
  assert.ok(drafts.length <= 4, "no more than one per 10 seconds, plus the first: " + drafts.length);
  for (let i = 1; i < drafts.length; i += 1) {
    assert.ok(drafts[i].at - drafts[i - 1].at >= FLOOR, "draft posts " + (i - 1) + " and " + i + " are 10s apart");
  }
});

test("the floor is a deadline, not a timer that typing pushes back", async (t) => {
  const r = rig(t);
  await started(r);
  let item = r.type(draftItem("a"), "a");
  await r.advance(1000);
  const first = r.draftPosts().length;
  assert.equal(first, 1, "the first draft of an item goes promptly");

  // Keep typing well inside the floor. The next post lands at the deadline set
  // by the first post, however many keystrokes came after it.
  const firstAt = r.draftPosts()[0].at;
  let text = "a";
  for (let i = 0; i < 60; i += 1) {
    text += "b";
    item = r.type(item, text);
    await r.advance(200);
  }
  const drafts = r.draftPosts();
  assert.ok(drafts.length >= 2);
  assert.ok(drafts[1].at - firstAt >= FLOOR, "held for the floor");
  assert.ok(drafts[1].at - firstAt <= FLOOR + 1000, "and sent at the deadline, not after the typing stopped");
});

test("leaving the box posts the draft at once", async (t) => {
  const r = rig(t);
  await started(r);
  let item = r.type(draftItem("a"), "a");
  await r.advance(1000);
  item = r.type(item, "ab");
  await r.advance(500);
  const before = r.draftPosts().length;

  r.sync.flushNow("blur");
  await r.drain();
  assert.equal(r.draftPosts().length, before + 1, "the blur did not wait for the floor");
  assert.equal(r.draftPosts()[before].events[0].record.note, "ab");
});

test("hiding the tab posts the draft at once", async (t) => {
  const r = rig(t);
  await started(r);
  let item = r.type(draftItem("a"), "a");
  await r.advance(1000);
  item = r.type(item, "ab");
  await r.advance(500);
  const before = r.draftPosts().length;

  r.doc.hidden = true;
  r.doc.fire("visibilitychange");
  await r.drain();
  assert.equal(r.draftPosts().length, before + 1);
});

test("leaving the page posts the draft at once, with keepalive", async (t) => {
  const r = rig(t);
  await started(r);
  let item = r.type(draftItem("a"), "a");
  await r.advance(1000);
  item = r.type(item, "ab");
  await r.advance(500);
  const before = r.draftPosts().length;

  r.win.fire("pagehide");
  await r.drain();
  assert.equal(r.draftPosts().length, before + 1);
  assert.equal(r.draftPosts()[before].keepalive, true);
});

test("Cmd-Enter posts at once, even inside the draft floor", async (t) => {
  const r = rig(t);
  await started(r);
  let item = r.type(draftItem("a"), "a");
  await r.advance(1000);
  item = r.type(item, "ab");
  await r.advance(200);
  const before = r.posts.length;

  const ready = Object.assign({}, item, { state: record.STATE.READY });
  r.store.write(REVIEW, ready);
  r.sync.recordItem(ready, { immediate: "ready" });
  await r.advance(1, 1);
  await r.drain();
  assert.equal(r.posts.length, before + 1);
  const types = r.posts[before].events.map((e) => e.event);
  assert.deepEqual(types, [protocol.EVENT.ITEM_CONTENT, protocol.EVENT.ITEM_READY], "the older draft first, then ready");
});

test("Cmd-Enter pressed during an in-flight post goes the moment that post finishes", async (t) => {
  const r = rig(t);
  await started(r);
  let item = draftItem("a");
  const release = r.hold();
  item = r.type(item, "a");
  await r.advance(1000);
  assert.equal(r.posts.length, 1, "the first draft post is in flight");

  const ready = Object.assign({}, item, { note: "a, sent", state: record.STATE.READY });
  r.store.write(REVIEW, ready);
  r.sync.recordItem(ready, { immediate: "ready" });
  await r.advance(300);
  assert.equal(r.posts.length, 1, "nothing can go while the first post is out");

  release();
  await r.drain();
  await r.advance(1, 1);
  assert.equal(r.posts.length, 2, "the commit went as soon as the post finished, not at the floor");
  assert.equal(r.posts[1].events[r.posts[1].events.length - 1].event, protocol.EVENT.ITEM_READY);
});

test("a ready event never posts ahead of its own older draft, and another item's draft still waits", async (t) => {
  const r = rig(t);
  await started(r);
  let x = r.type(draftItem("x"), "x");
  let y = r.type(draftItem("y"), "y");
  await r.advance(1000);
  assert.equal(r.draftPosts().length, 1);

  x = r.type(x, "x2");
  y = r.type(y, "y2");
  await r.advance(200);
  const before = r.posts.length;
  const ready = Object.assign({}, x, { state: record.STATE.READY });
  r.store.write(REVIEW, ready);
  r.sync.recordItem(ready, { immediate: "ready" });
  await r.advance(1, 1);
  await r.drain();

  const sent = r.posts[before].events;
  assert.deepEqual(
    sent.map((e) => e.item + ":" + e.event),
    [x.id + ":" + protocol.EVENT.ITEM_CONTENT, x.id + ":" + protocol.EVENT.ITEM_READY],
    "x's draft and its ready go together, in order; y's young draft is held"
  );
  assert.equal(r.store.pendingEvents(REVIEW).filter((e) => e.item === y.id).length, 1, "y is still queued");
});

test("with Hold on, leaving the box and hiding the tab post nothing", async (t) => {
  const r = rig(t, { held: true });
  await started(r);
  let item = r.type(draftItem("a"), "a");
  await r.advance(12000);
  item = r.type(item, "ab");
  r.sync.flushNow("blur");
  await r.drain();
  r.doc.hidden = true;
  r.doc.fire("visibilitychange");
  await r.drain();
  assert.equal(r.posts.length, 0, "held means held");
  assert.ok(r.store.pendingEvents(REVIEW).length > 0, "and the work is still queued");
});

test("a leaving reason has to be one protocol.js names", (t) => {
  const r = rig(t);
  assert.throws(() => r.sync.flushNow("because"), /must be one of/);
});

// ---------------------------------------------------------------------------
// Task 4: queued during a post waits its turn
// ---------------------------------------------------------------------------

test("drafts typed during a post wait for the floor after it finishes", async (t) => {
  const r = rig(t);
  await started(r);
  let item = draftItem("a");
  const release = r.hold();
  item = r.type(item, "a");
  await r.advance(1000);
  assert.equal(r.posts.length, 1, "the first draft post is in flight");

  item = r.type(item, "ab");
  item = r.type(item, "abc");
  const firstAt = r.posts[0].at;
  release();
  await r.drain();
  await r.advance(2000);
  assert.equal(r.posts.length, 1, "no follow-up post the moment the first one finished");

  await r.advance(FLOOR);
  assert.equal(r.posts.length, 2, "the draft went at the floor");
  assert.ok(r.posts[1].at - firstAt >= FLOOR);
  assert.equal(r.posts[1].events[0].record.note, "abc");
});

// ---------------------------------------------------------------------------
// Leaving the box is heard: the comment surface's hook boot wires to flushNow
// ---------------------------------------------------------------------------

test("closing a comment box tells the host the reviewer left it", () => {
  const commentsModule = require("../../src/layer/comments.js");
  let left = 0;
  const comments = commentsModule.createComments({
    store: storeModule.createStore(),
    reviewId: "rev_leave",
    document: null,
    page: { origin: "http://localhost:3000", path: "/p", title: "P", seq: 1, source_hint: null },
    onLeave: () => {
      left += 1;
    }
  });
  const box = comments.openBox({ quote: "q" });
  box.type("half a thought");
  assert.equal(left, 0, "typing is not leaving");
  box.close();
  assert.equal(left, 1);
});
