// A ready comment or edit that the reviewer starts rewording again goes back
// to draft on its first changing keystroke (spec 20260922.01 requirement 6).
// That write must reach the helper on the ordinary debounce, not wait behind
// the 10 second draft floor: a stale `draftSentAt` left over from BEFORE the
// item was ever marked ready otherwise held the withdrawal back up to 10
// seconds, during which the agent kept reading the old, ready wording as
// current (review finding on the draft-write-cost branch).
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");

const REVIEW = "review-withdraw";
const FLOOR = protocol.FLUSH.DRAFT_FLOOR_MS;
const DEBOUNCE = protocol.FLUSH.HELPER_DEBOUNCE_MS;

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

function rig(t) {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 1000000 });
  const store = storeModule.createStore({ locks: null });
  const posts = [];
  let seq = 0;
  const doc = Object.assign(eventTarget(), { hidden: false, location: { pathname: "/plan" } });
  const win = Object.assign(eventTarget(), { location: { pathname: "/plan" } });
  const fetchImpl = async (url, config) => {
    const path = String(url);
    if (path.indexOf("/events") !== -1) {
      const sent = JSON.parse(config.body);
      posts.push({ at: Date.now(), events: sent.events, keepalive: !!config.keepalive });
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
    posts,
    async advance(ms, step) {
      const by = step || 100;
      for (let done = 0; done < ms; done += by) {
        t.mock.timers.tick(Math.min(by, ms - done));
        await drain();
      }
    }
  };
}

async function started(r) {
  await r.sync.start();
  const drain = async () => {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  };
  await drain();
}

test("a write that withdraws a ready item to draft posts on the ordinary debounce, not the stale floor", async (t) => {
  const r = rig(t);
  await started(r);

  // This item posted a draft a long time ago (before it was ever marked
  // ready), which is what leaves draftSentAt holding a stale timestamp.
  let item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.DRAFT,
    note: "first pass",
    page_origin: "http://127.0.0.1:4000",
    page_path: "/plan"
  });
  r.store.write(REVIEW, item);
  r.sync.recordItem(item);
  // Only the ordinary debounce, not a whole floor: the draft posts and
  // stamps draftSentAt for this item, and the stale floor it leaves behind
  // is still most of the way to FLOOR in the future when the withdrawal
  // below happens.
  await r.advance(DEBOUNCE + 200);
  assert.equal(r.posts.length, 1, "the first draft went out on the ordinary debounce");

  // It gets marked ready and the helper is told at once, the way Cmd-Enter
  // does today.
  item = Object.assign({}, item, { state: record.STATE.READY, note: "final wording" });
  r.store.write(REVIEW, item);
  r.sync.recordItem(item, { immediate: "ready" });
  await r.advance(200);
  const readyPosts = r.posts.length;
  assert.ok(readyPosts >= 1, "the ready post went out");

  // Almost immediately after (well inside the old floor from the first
  // draft), the reviewer starts rewording it again: the withdrawal.
  item = Object.assign({}, item, { state: record.STATE.DRAFT, note: "final wordin" });
  r.store.write(REVIEW, item);
  r.sync.recordItem(item, { withdrawnFromReady: true });

  // The old floor from the very first draft would have made this wait up to
  // FLOOR ms. It must go on the ordinary debounce instead.
  await r.advance(DEBOUNCE + 200);
  const withdrawal = r.posts.slice(readyPosts);
  assert.equal(withdrawal.length, 1, "the withdrawal posted on the ordinary debounce, not held behind the old floor");
  assert.equal(withdrawal[0].events[0].record.note, "final wordin");
  assert.equal(withdrawal[0].events[0].draft, true);
});

test("a second keystroke on the same withdrawn draft still obeys the 10 second floor", async (t) => {
  const r = rig(t);
  await started(r);

  let item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "final wording",
    page_origin: "http://127.0.0.1:4000",
    page_path: "/plan"
  });
  r.store.write(REVIEW, item);
  r.sync.recordItem(item, { immediate: "ready" });
  await r.advance(200);

  item = Object.assign({}, item, { state: record.STATE.DRAFT, note: "final wordin" });
  r.store.write(REVIEW, item);
  r.sync.recordItem(item, { withdrawnFromReady: true });
  await r.advance(DEBOUNCE + 200);

  const afterWithdrawal = r.posts.length;

  // A second keystroke, right away: this one is an ordinary draft on an
  // already-draft item, so it waits for the floor the withdrawal post itself
  // just started.
  item = Object.assign({}, item, { note: "final word" });
  r.store.write(REVIEW, item);
  r.sync.recordItem(item);
  await r.advance(1000);
  assert.equal(r.posts.length, afterWithdrawal, "the second keystroke did not post inside the floor");

  await r.advance(FLOOR);
  assert.ok(r.posts.length > afterWithdrawal, "it goes once the floor from the withdrawal post has passed");
});
