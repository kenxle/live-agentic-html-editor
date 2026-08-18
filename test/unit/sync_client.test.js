// The parts of the sync client that are decidable without a browser: what it
// mints, what it queues, how it names a failure, and that it reads the flush
// policy from protocol.js rather than restating it.
//
// Everything about actually posting is a browser test (test/browser/rail_*.spec
// .js), because the failures worth catching are a real kill -9, a real SIGSTOP
// and a real CSP header, none of which exist in this file's world.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");
const overlay = require("../../src/layer/overlay.js");
const failuresModule = require("../../src/shared/failures.js");

function draft(note) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.DRAFT,
    note: note,
    page_origin: "http://127.0.0.1:4000",
    page_path: "/roster"
  });
}

function harness() {
  const store = storeModule.createStore();
  const statuses = [];
  const raised = [];
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: null,
    onStatus: (state) => statuses.push(state),
    onFailure: (failure) => raised.push(failure)
  });
  return { store, sync, statuses, raised };
}

// Every test that records something stops the client afterwards: retrying
// forever is the behavior under test, and a client that gave up when the test
// ended would be the bug.
test("a keystroke is queued durably in the same call, before any network", (t) => {
  const { store, sync } = harness();
  t.after(() => sync.stop());
  const item = draft("half a thought");
  sync.recordItem(item);
  const queued = store.pendingEvents("review-1");
  assert.equal(queued.length, 1);
  assert.equal(queued[0].item, item.id);
  assert.equal(queued[0].draft, true, "drafts flow to the helper marked draft (D5, R7)");
  assert.equal(queued[0].record.note, "half a thought");
});

test("the first event for an item is created, the next is content, ready is ready", () => {
  const { sync } = harness();
  const item = draft("one");
  assert.equal(sync.eventFor(item).event, protocol.EVENT.ITEM_CREATED);
  assert.equal(sync.eventFor(item).event, protocol.EVENT.ITEM_CONTENT);
  const ready = Object.assign({}, item, { state: record.STATE.READY, note: "one" });
  assert.equal(sync.eventFor(ready).event, protocol.EVENT.ITEM_READY);
});

test("every event carries its own id, because idempotence is by event_id", () => {
  const { sync } = harness();
  const item = draft("one");
  const ids = [sync.eventFor(item).event_id, sync.eventFor(item).event_id, sync.eventFor(item).event_id];
  assert.equal(new Set(ids).size, 3);
  assert.equal(protocol.IDEMPOTENCE_KEY, "event_id");
});

test("an immediate flush reason has to be one protocol.js names", (t) => {
  const { sync } = harness();
  t.after(() => sync.stop());
  assert.throws(() => sync.recordItem(draft("x"), { immediate: "whenever" }), /immediate must be one of/);
  protocol.FLUSH.IMMEDIATE_ON.forEach((reason) => {
    assert.doesNotThrow(() => sync.recordItem(draft("x"), { immediate: reason }));
  });
});

test("a CSP refusal is named distinctly from a helper that is down", async (t) => {
  const listeners = {};
  const fakeDocument = {
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    removeEventListener: () => {}
  };
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: storeModule.createStore(),
    document: fakeDocument,
    window: null,
    fetch: null
  });
  t.after(() => sync.stop());

  // Before any violation: an opaque fetch failure is the helper being down,
  // and the remedy says start the helper.
  const down = sync.classify(new Error("Failed to fetch"), {});
  assert.equal(down.code, "HELPER_UNREACHABLE");
  assert.match(down.remedy, /Start the helper/);

  await sync.start();
  // The real event a browser fires when connect-src refuses the request. The
  // fetch failure is IDENTICAL either side of this line, which is exactly why
  // the detection cannot be a guess from the error text.
  listeners.securitypolicyviolation({
    effectiveDirective: "connect-src",
    blockedURI: "http://127.0.0.1:7817"
  });

  const refused = sync.classify(new Error("Failed to fetch"), {});
  assert.equal(refused.code, "CSP_REFUSED");
  assert.match(refused.remedy, /connect-src/);
  assert.notEqual(refused.code, down.code, "two failures, two remedies, pointing opposite ways");
  assert.equal(sync.status().cspRefused, true);
});

test("the status line never says stored before anything has been acknowledged", (t) => {
  const { sync, statuses } = harness();
  t.after(() => sync.stop());
  sync.recordItem(draft("something"));
  // Queued, with the helper never heard from: not stored, and not an outage
  // either, because nothing has failed yet.
  assert.equal(sync.status().status, overlay.STATUS.KEPT_UNCONFIRMED);
  assert.deepEqual(statuses, [overlay.STATUS.KEPT_UNCONFIRMED]);
  assert.notEqual(sync.status().status, overlay.STATUS.STORED);
});

// ---------------------------------------------------------------------------
// The status-truth cluster (three walkers, 2026-08-14)
// ---------------------------------------------------------------------------

test("a page with nothing queued and no helper answer yet does not claim the helper is away", (t) => {
  const { sync } = harness();
  t.after(() => sync.stop());
  sync.flush();
  assert.equal(sync.status().status, overlay.STATUS.KEPT_UNCONFIRMED);
  const text = overlay.STATUS_TEXT[overlay.STATUS.KEPT_UNCONFIRMED];
  assert.doesNotMatch(text, /helper is back|not reachable|is down|away/i, "no invented outage");
  assert.match(text, /Kept in this browser/);
});

test("a successful poll is enough to read stored, with no post and no typing", async (t) => {
  const store = storeModule.createStore();
  const recovered = [];
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ events: [], seq: 3 }) }),
    onRecovered: (code) => recovered.push(code)
  });
  t.after(() => sync.stop());

  await sync.poll();
  assert.equal(sync.status().status, overlay.STATUS.STORED, "a reachable helper with an empty outbox IS stored");
  assert.deepEqual(recovered, ["HELPER_UNREACHABLE"], "the first answer ends the one chip that was standing");

  // A healthy page polls every second, and each clear is a browser-storage
  // write and a full chip-list rebuild. Clearing codes that were never raised
  // destroyed and recreated every OTHER chip's buttons once a second, which is
  // what stole the "Copy for your agent" confirmation (review, 2026-08-17).
  recovered.length = 0;
  await sync.poll();
  await sync.poll();
  assert.deepEqual(recovered, [], "a poll that changes nothing clears nothing");
});

test("an origin refusal that ended is cleared by the first authenticated success", async (t) => {
  const store = storeModule.createStore();
  const recovered = [];
  let originAllowed = false;
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: async (url) => {
      if (String(url).indexOf("/health") !== -1) return { ok: true, status: 200, json: async () => ({}) };
      if (!originAllowed) throw new TypeError("Failed to fetch");
      return { ok: true, status: 200, json: async () => ({ events: [], seq: 1 }) };
    },
    onRecovered: (code) => recovered.push(code)
  });
  t.after(() => sync.stop());

  await sync.poll();
  recovered.length = 0;
  originAllowed = true;
  await sync.poll();
  assert.deepEqual(
    recovered.slice().sort(),
    ["HELPER_UNREACHABLE", "SYNC_ORIGIN_NOT_ALLOWED", "SYNC_UNAUTHORIZED"],
    "registering the origin ends the chip that said it was broken"
  );
});

// ---------------------------------------------------------------------------
// The origin diagnosis is a claim about right now (review, 2026-08-17)
// ---------------------------------------------------------------------------

test("a diagnosed origin refusal does not resurrect the unreachable chip on later failures", async (t) => {
  const store = storeModule.createStore();
  const raised = [];
  const recovered = [];
  let healthAnswers = true;
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: async (url) => {
      if (String(url).indexOf("/health") !== -1) {
        if (!healthAnswers) throw new TypeError("Failed to fetch");
        return { ok: true, status: 200, json: async () => ({}) };
      }
      // Every authenticated route is refused at the preflight, which reaches
      // fetch as a plain network error with no status.
      throw new TypeError("Failed to fetch");
    },
    onFailure: (failure) => raised.push(failure.code),
    onRecovered: (code) => recovered.push(code)
  });
  t.after(() => sync.stop());

  // Fail, diagnose, then fail twice more. The page must end with exactly one
  // chip standing and it must be the origin one.
  await sync.poll();
  await sync.poll();
  await sync.poll();

  const standing = [];
  raised.forEach((code) => {
    if (standing.indexOf(code) === -1) standing.push(code);
  });
  recovered.forEach((code) => {
    const at = standing.indexOf(code);
    if (at !== -1) standing.splice(at, 1);
  });
  assert.deepEqual(standing, ["SYNC_ORIGIN_NOT_ALLOWED"], "one chip, and the origin one");
  assert.equal(
    raised.filter((code) => code === "SYNC_ORIGIN_NOT_ALLOWED").length,
    1,
    "a standing condition is raised once, never once per retry"
  );

  // Now the helper actually dies: health stops answering too. Unreachable is
  // the truth again, and the origin chip has to go.
  healthAnswers = false;
  raised.length = 0;
  recovered.length = 0;
  await sync.poll();
  assert.ok(raised.indexOf("HELPER_UNREACHABLE") !== -1, "a helper that really went down surfaces as unreachable");
  assert.ok(recovered.indexOf("SYNC_ORIGIN_NOT_ALLOWED") !== -1, "the origin diagnosis is over");
});

test("a post the navigation aborted is not a failure, and raises no chip", async (t) => {
  const listeners = {};
  const fakeWindow = {
    addEventListener: (type, fn) => {
      listeners[type] = fn;
    },
    removeEventListener: () => {}
  };
  const store = storeModule.createStore();
  const raised = [];
  const abort = new Error("The user aborted a request.");
  abort.name = "AbortError";
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: fakeWindow,
    fetch: async () => {
      throw abort;
    },
    onFailure: (failure) => raised.push(failure.code)
  });
  t.after(() => sync.stop());

  await sync.start();
  raised.length = 0;
  sync.recordItem(readyEdit("committed on the way out"), { immediate: "ready" });
  // The reviewer clicks a link: pagehide fires, the keepalive post goes out,
  // and the document going away aborts it.
  await listeners.pagehide();
  await new Promise((resolve) => setImmediate(resolve));

  assert.deepEqual(raised, [], "an aborted unload post raises nothing");
  assert.notEqual(sync.status().status, overlay.STATUS.KEPT_LOCALLY, "and the status line does not flap");
  assert.ok(store.pendingEvents("review-1").length > 0, "the record is still queued, and re-posts on the next load");
});

test("a genuine transport failure still raises the unreachable chip", async (t) => {
  const store = storeModule.createStore();
  const raised = [];
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: async () => {
      throw new TypeError("Failed to fetch");
    },
    onFailure: (failure) => raised.push(failure.code)
  });
  t.after(() => sync.stop());

  sync.recordItem(readyEdit("typed against a dead helper"), { immediate: "ready" });
  await sync.flush();
  assert.deepEqual(raised, ["HELPER_UNREACHABLE"], "the true-failure path is untouched");
  assert.equal(sync.status().status, overlay.STATUS.KEPT_LOCALLY);
});

test("the unreachable helper is a standing state, so its chip never counts", () => {
  const failuresModule = require("../../src/shared/failures.js");
  assert.equal(failuresModule.failure("HELPER_UNREACHABLE").standing, true);
  const rail = overlay.createRail();
  rail.failures.add(failuresModule.failure("HELPER_UNREACHABLE", "one"));
  rail.failures.add(failuresModule.failure("HELPER_UNREACHABLE", "two"));
  rail.failures.add(failuresModule.failure("HELPER_UNREACHABLE", "three"));
  const chips = rail.failures.list();
  assert.equal(chips.length, 1);
  assert.equal(chips[0].count, 1, "still true, not four occurrences");
});

test("clearing one code leaves every other chip standing", () => {
  const failuresModule = require("../../src/shared/failures.js");
  const rail = overlay.createRail();
  rail.failures.add(failuresModule.failure("HELPER_UNREACHABLE", null));
  rail.failures.add(failuresModule.failure("COPY_FAILED", null));
  rail.failures.clear("HELPER_UNREACHABLE");
  assert.deepEqual(
    rail.failures.list().map((chip) => chip.code),
    ["COPY_FAILED"]
  );
});

test("the flush policy is imported, not restated", () => {
  assert.equal(protocol.FLUSH.HELPER_DEBOUNCE_MS, 750);
  assert.equal(protocol.FLUSH.SEND_BEACON_IS_FORBIDDEN, true);
  assert.equal(protocol.REPLY_CURSOR_FIELD, "seq");
  // The library's own poll is a different number from the helper's file poll,
  // deliberately, and both are named rather than typed twice.
  assert.notEqual(syncModule.POLL_INTERVAL_MS, protocol.REPLY_POLL.INTERVAL_MS);
});

test("a card can carry a loud attachment, which is what an agent question needs", () => {
  const rail = overlay.createRail();
  const item = draft("a comment");
  rail.upsertCard(item);
  rail.setAgentMessage(item.id, { status: "question", agent: "claude", text: "Which heading?" });
  assert.equal(rail.getCard(item.id).agentMessage.loud, true);
  rail.setAgentMessage(item.id, { status: "handled", agent: "claude" });
  assert.equal(rail.getCard(item.id).agentMessage.loud, false);
});

const merge = require("../../src/shared/merge.js");

function readyEdit(note) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: note,
    page_origin: "http://127.0.0.1:4000",
    page_path: "/roster"
  });
}

test("finding 10: a flush the helper acknowledges stamps the item acknowledged, and clears it on the next write", async (t) => {
  const store = storeModule.createStore();
  const fetchStub = async (_url, config) => {
    const sent = JSON.parse(config.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ accepted: sent.events.map((e) => e.event_id), seq: 1 })
    };
  };
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: null,
    window: null,
    fetch: fetchStub
  });
  t.after(() => sync.stop());

  const item = readyEdit("fix this sentence");
  store.write("review-1", item);
  sync.recordItem(item, { immediate: "ready" });
  await sync.flush();

  // The ack lives in the side-table, keyed by rev, not on the item itself (so it
  // never leaks into a snapshot or an export).
  assert.equal(store.acknowledgedRev("review-1", item.id), item.rev, "the helper confirmed this rev");
  assert.equal(store.readItem("review-1", item.id).acknowledged, undefined, "and it is NOT a field on the item");

  // With the browser copy acknowledged, the store wins fully at equal rev:
  // SAME_REV_ACKED becomes reachable instead of the browser always winning.
  const got = store.mergeWithHelper("review-1", [Object.assign({}, item)]);
  assert.equal(got.reasons[item.id], merge.REASON.SAME_REV_ACKED);
  // The merged item still carries no acknowledged field.
  assert.equal(store.readItem("review-1", item.id).acknowledged, undefined);

  // The next content write clears the ack: fresh keystrokes are unacknowledged
  // again until the helper confirms them, so the browser wins on content again.
  store.write("review-1", Object.assign({}, item, { note: "fix this sentence, and the next one" }));
  assert.equal(store.acknowledgedRev("review-1", item.id), null, "a content write clears the ack");
  const after = store.mergeWithHelper("review-1", [Object.assign({}, item)]);
  assert.equal(after.reasons[item.id], merge.REASON.SAME_REV_UNACKED);
});

test("finding 1: a window refused the claim goes read-only and writes nothing to the shared bucket", async (t) => {
  const realStore = storeModule.createStore();
  // A store whose window claim is refused, the way the client Web Lock refuses a
  // second tab sharing one storage bucket.
  const refusingStore = Object.assign({}, realStore, {
    claimWindow: () =>
      Promise.resolve({
        acquired: false,
        holder: { window_id: "the-other-window" },
        windowId: realStore.windowId,
        failure: { code: "SECOND_WINDOW_REFUSED", message: "held elsewhere" },
        reason: "This review is already open in another window."
      })
  });
  let refusedInfo = null;
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: refusingStore,
    document: null,
    window: null,
    fetch: null,
    onRefused: (info) => {
      refusedInfo = info;
    }
  });
  t.after(() => sync.stop());

  await sync.start();
  assert.equal(sync.isReadOnly(), true, "a refused window is read-only");
  assert.ok(refusedInfo, "the boot layer is told to go read-only and show the refusal panel");

  const before = realStore.pendingEvents("review-1").length;
  const result = sync.recordItem(draft("trying to type in a refused window"));
  assert.equal(result, null, "the write path is a no-op in a refused window");
  assert.equal(
    realStore.pendingEvents("review-1").length,
    before,
    "nothing the refused window typed reached the shared outbox"
  );
});

test("finding 12/NEW-2: the refused window's takeover makes it the holder and lifts read-only", async (t) => {
  const realStore = storeModule.createStore();
  const refusingStore = Object.assign({}, realStore, {
    // The client lock refuses (a second tab sharing storage). start() goes
    // read-only without ever consulting the helper.
    claimWindow: () =>
      Promise.resolve({
        acquired: false,
        holder: { window_id: "the-other-window" },
        windowId: realStore.windowId,
        failure: { code: "SECOND_WINDOW_REFUSED", message: "held elsewhere" },
        reason: "This review is already open in another window."
      })
  });
  // The helper grants the explicit takeover (same-token-trusted, NEW-2).
  const fetchStub = async (url, config) => {
    const body = JSON.parse(config.body);
    if (String(url).indexOf("/window") !== -1 && body.takeover === true) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ granted: true, took_over: true, session_secret: "s2", heartbeat_seconds: 10, since: "now" })
      };
    }
    return { ok: false, status: 0, json: async () => null };
  };
  let held = 0;
  const sync = syncModule.createSync({
    review: "review-1",
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: refusingStore,
    document: null,
    window: null,
    fetch: fetchStub,
    onHeld: () => {
      held += 1;
    }
  });
  t.after(() => sync.stop());

  await sync.start();
  assert.equal(sync.isReadOnly(), true, "refused first: read-only");

  const result = await sync.takeover();
  assert.equal(result.ok, true, "the takeover is granted");
  assert.equal(sync.isReadOnly(), false, "and read-only is lifted");
  assert.equal(held, 1, "onHeld fires so boot re-installs the edit and comment handlers");

  // The window can write again now that it is the holder.
  const ev = sync.recordItem(draft("now I can type"));
  assert.ok(ev, "the write path is live again");
});

// ---------------------------------------------------------------------------
// Clearing a chip that is not there (review, 2026-08-17)
// ---------------------------------------------------------------------------

test("clearing a code with no chip on it writes nothing and rebuilds nothing", () => {
  var writes = 0;
  const rail = overlay.createRail({
    document: null,
    reviewId: "review-1",
    store: {
      readChips: () => ({ chips: [], dismissed: [] }),
      writeChips: () => {
        writes += 1;
      }
    }
  });
  rail.failures.add(failuresModule.failure("REPLY_LINE_MALFORMED", "replies.jsonl line 4"));
  const after = writes;

  // The sync client clears these on every successful poll, once a second.
  for (let i = 0; i < 5; i += 1) {
    assert.equal(rail.failures.clear("HELPER_UNREACHABLE"), false);
    assert.equal(rail.failures.clear("SYNC_ORIGIN_NOT_ALLOWED"), false);
  }
  assert.equal(writes, after, "no chip changed, so no storage write and no chip-list rebuild");
  assert.equal(rail.failures.count(), 1, "the unrelated chip is untouched");
  assert.equal(rail.failures.clear("REPLY_LINE_MALFORMED"), true, "a chip that IS there still clears");
});
