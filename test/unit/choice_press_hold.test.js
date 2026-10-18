// Presses travel together (choice buttons, plan Task 2.2, V10).
//
// Every event of a choice item is held in the outbox until 3 seconds after the
// page's last press, and never longer than 10 seconds from the first press
// still held. Hiding the tab sends at once. A comment is never held by it, and
// Hold's gate still applies on top.
//
// The clock is node:test's mock timers, and the poll loop is running
// (createSync().start()), as in draft_flush_cadence.test.js.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");

const REVIEW = "review-press-hold";
const QUIET = protocol.FLUSH.PRESS_QUIET_MS;
const CAP = protocol.FLUSH.PRESS_CAP_MS;

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

function rig(t, options) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000000 });
  const opts = options || {};
  const store = storeModule.createStore({ locks: null });
  if (opts.held) store.setHeld(REVIEW, true);
  const posts = [];
  let seq = 0;
  const doc = Object.assign(eventTarget(), { hidden: false, location: { pathname: "/doc.md" } });
  const win = Object.assign(eventTarget(), { location: { pathname: "/doc.md" } });
  const fetchImpl = async (url, config) => {
    const path = String(url);
    if (path.indexOf("/events") !== -1) {
      const sent = JSON.parse(config.body);
      posts.push({ at: Date.now(), events: sent.events });
      seq += sent.events.length;
      return ok({ accepted: sent.events.map((e) => e.event_id), rejected: [], seq: seq });
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
    posts,
    drain,
    async advance(ms, step) {
      const by = step || 100;
      for (let done = 0; done < ms; done += by) {
        t.mock.timers.tick(Math.min(by, ms - done));
        await drain();
      }
    },
    // A press as choices.js records it: draft then ready in one tick, no
    // immediate flush.
    press(group, answer) {
      const draft = record.newItem({
        kind: record.KIND.CHOICE,
        state: record.STATE.DRAFT,
        page_origin: "http://doc.lahe.localhost:1483",
        page_path: "/doc.md",
        choice: { group: group, answer: answer },
        region: { ref: record.choiceRef(group), label: "choice", lost: null }
      });
      store.write(REVIEW, draft);
      sync.recordItem(draft, { press: true });
      const ready = Object.assign({}, draft, { state: record.STATE.READY });
      store.write(REVIEW, ready);
      sync.recordItem(ready, { press: true });
      return ready;
    },
    choicePosts: () => posts.filter((p) => p.events.some((e) => e.record && e.record.kind === "choice")),
    commentPosts: () => posts.filter((p) => p.events.some((e) => e.record && e.record.kind === "comment"))
  };
}

async function started(r) {
  await r.sync.start();
  await r.drain();
}

test("a press is held until 3 seconds after it, then both its events go in one post", async (t) => {
  const r = rig(t);
  await started(r);
  const at = Date.now();
  r.press("lesson-a", "promote");
  await r.advance(QUIET - 200);
  assert.equal(r.choicePosts().length, 0, "still held inside the quiet spell");
  await r.advance(600);
  const posts = r.choicePosts();
  assert.equal(posts.length, 1, "one post");
  assert.ok(posts[0].at - at >= QUIET, "not before the quiet spell ended");
  assert.deepEqual(
    posts[0].events.map((e) => e.event),
    [protocol.EVENT.ITEM_CREATED, protocol.EVENT.ITEM_READY],
    "the draft and the ready travel together, in order"
  );
});

test("presses close together travel in one post, 3 seconds after the last of them", async (t) => {
  const r = rig(t);
  await started(r);
  r.press("lesson-a", "promote");
  await r.advance(1000);
  r.press("lesson-b", "discard");
  await r.advance(1000);
  const last = Date.now();
  r.press("lesson-c", "merge");
  await r.advance(QUIET - 200);
  assert.equal(r.choicePosts().length, 0);
  await r.advance(600);
  const posts = r.choicePosts();
  assert.equal(posts.length, 1, "three presses, one post");
  assert.ok(posts[0].at - last >= QUIET);
  assert.equal(posts[0].events.length, 6);
});

test("steady pressing is released at 10 seconds from the first held press", async (t) => {
  const r = rig(t);
  await started(r);
  const first = Date.now();
  let n = 0;
  // A press every 2 seconds, for 14 seconds: the quiet spell never comes.
  for (let i = 0; i < 7; i += 1) {
    r.press("lesson-" + i, "promote");
    n += 1;
    await r.advance(2000);
  }
  const posts = r.choicePosts();
  assert.ok(posts.length >= 1, "the cap released the held presses");
  assert.ok(posts[0].at - first >= CAP, "not before the cap: " + (posts[0].at - first));
  assert.ok(posts[0].at - first <= CAP + 1000, "and at the cap, not after: " + (posts[0].at - first));
  assert.ok(n === 7);
});

test("hiding the tab sends a held press at once", async (t) => {
  const r = rig(t);
  await started(r);
  r.press("lesson-a", "promote");
  await r.advance(500);
  assert.equal(r.choicePosts().length, 0);
  r.doc.hidden = true;
  r.doc.fire("visibilitychange");
  await r.drain();
  assert.equal(r.choicePosts().length, 1, "sent on hide, inside the quiet spell");
});

test("a comment is never held by a press, even while one is held", async (t) => {
  const r = rig(t);
  await started(r);
  r.press("lesson-a", "promote");
  const comment = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "this needs a source",
    page_origin: "http://doc.lahe.localhost:1483",
    page_path: "/doc.md"
  });
  r.store.write(REVIEW, comment);
  r.sync.recordItem(comment, { immediate: "ready" });
  await r.advance(1000);
  assert.equal(r.commentPosts().length, 1, "the comment went at once");
  assert.equal(
    r.commentPosts()[0].events.some((e) => e.record && e.record.kind === "choice"),
    false,
    "and the press did not ride along"
  );
  assert.equal(r.choicePosts().length, 0, "the press is still held");
  await r.advance(QUIET);
  assert.equal(r.choicePosts().length, 1);
});

test("Hold's gate still applies: a held review posts no press, and releasing Hold sends it", async (t) => {
  const r = rig(t, { held: true });
  await started(r);
  r.press("lesson-a", "promote");
  await r.advance(QUIET + CAP);
  assert.equal(r.choicePosts().length, 0, "nothing posts while Hold is on");
  r.store.setHeld(REVIEW, false);
  await r.sync.flush({ force: true });
  await r.drain();
  assert.equal(r.choicePosts().length, 1);
});

test("a press made after the held ones went out starts its own hold", async (t) => {
  const r = rig(t);
  await started(r);
  r.press("lesson-a", "promote");
  await r.advance(QUIET + 500);
  assert.equal(r.choicePosts().length, 1);
  const second = Date.now();
  r.press("lesson-b", "discard");
  await r.advance(QUIET - 300);
  assert.equal(r.choicePosts().length, 1, "the second press waits its own quiet spell");
  await r.advance(600);
  assert.equal(r.choicePosts().length, 2);
  assert.ok(r.choicePosts()[1].at - second >= QUIET);
});
