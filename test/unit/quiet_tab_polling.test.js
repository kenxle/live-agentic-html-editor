// A review tab nobody is looking at stops asking the helper anything.
//
// Owner: 1B. The spec is
// docs/features/20260928.01_quiet_tab_polling/01_spec_quiet_tab_polling.md.
// Measured before this: an idle, focused tab polled the helper once a second
// forever, a hidden one every 10 seconds, and both posted a heartbeat every 10
// seconds on top (GitHub issue 16).
//
// The rules under test:
//
//   - Focus is the switch. Focused: the reply poll runs once a second,
//     steadily, as before. Keystrokes, clicks and selection changes cost
//     nothing: no request, no storage write, no timer.
//   - Visible but not focused (beside the terminal): the reply poll and the
//     read-only re-ask every 15 seconds; the ordinary 10 second heartbeat.
//   - Hidden: no reply poll and no read-only re-ask at all. The only request
//     is a "still open" heartbeat every 5 minutes, after a granted beat has
//     told the helper `quiet`. A blur sends nothing itself.
//   - Focus, or becoming visible from hidden, polls at once, once, shows what
//     arrived, and does any reload a rebuild owes; then the new pace runs.
//   - Closing the tab while unfocused still says goodbye.
//   - The helper holds a quiet holder for 390s and any other for 30s.
//
// The clock is node:test's mock timers, and the poll loop is running (start()).
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const storeModule = require("../../src/layer/store.js");
const syncModule = require("../../src/layer/sync.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const routes = require("../../src/service/routes.js");

const REVIEW = "review-quiet";
const FAST = syncModule.POLL_INTERVAL_MS;
const QUIET_BEAT = 300000;
const LONG = 15 * 60 * 1000;

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

function answer(status, body) {
  return { ok: status >= 200 && status < 300, status: status, json: async () => body };
}

function routeOf(url) {
  const where = String(url);
  if (where.indexOf("/window/release") !== -1) return "release";
  if (where.indexOf("/window") !== -1) return "claim";
  if (where.indexOf("/replies") !== -1) return "poll";
  if (where.indexOf("/events") !== -1) return "append";
  return "other";
}

/**
 * A running page over a fake helper.
 *
 * Every request is recorded with the mocked clock's time. `helper` is what the
 * fake helper answers with, and a test changes it between polls: `replies` is
 * handed out once, `mtime` and `liveness` stand until changed, `quietBeat` is
 * the slow heartbeat it offers (null for an old helper), and `refuse` makes
 * every claim a second-window refusal.
 */
function rig(t, options) {
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now: 1000000 });
  const opts = options || {};
  const helper = {
    replies: [],
    mtime: "2026-09-28T11:00:00.000Z",
    liveness: { state: "none", monitor_at: "2026-09-28T11:00:00.000Z", unanswered: 0 },
    quietBeat: opts.quietBeat === undefined ? 300 : opts.quietBeat,
    refuse: !!opts.refuse,
    down: false
  };
  const requests = [];
  let seq = 0;
  let focused = !opts.startHidden;
  const doc = Object.assign(eventTarget(), {
    hidden: !!opts.startHidden,
    visibilityState: opts.startHidden ? "hidden" : "visible",
    location: { pathname: "/plan" },
    hasFocus: () => focused
  });
  const reloads = [];
  const win = Object.assign(eventTarget(), {
    location: {
      pathname: "/plan",
      reload: () => reloads.push(Date.now())
    }
  });
  const fetchImpl = async (url, config) => {
    const route = routeOf(url);
    const body = config && typeof config.body === "string" ? JSON.parse(config.body) : null;
    requests.push({ at: Date.now(), route: route, body: body });
    if (helper.down) throw new TypeError("Failed to fetch");
    if (route === "append") {
      seq += body.events.length;
      return answer(200, { accepted: body.events.map((e) => e.event_id), seq: seq });
    }
    if (route === "poll") {
      const events = helper.replies;
      helper.replies = [];
      seq += events.length;
      return answer(200, { events: events, seq: seq, target_mtime: helper.mtime, agent_liveness: helper.liveness });
    }
    if (route === "release") return answer(200, { released: true });
    const beat = { heartbeat_seconds: 10 };
    if (helper.quietBeat !== null) beat.quiet_heartbeat_seconds = helper.quietBeat;
    if (helper.refuse) {
      return answer(409, Object.assign({ granted: false, reason: "this review is already open in another window." }, beat));
    }
    return answer(200, Object.assign({ granted: true, session_secret: "secret" }, beat));
  };
  const storageWrites = { count: 0 };
  const values = Object.create(null);
  const backing = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null),
    setItem: (k, v) => {
      storageWrites.count += 1;
      values[k] = String(v);
    },
    removeItem: (k) => {
      storageWrites.count += 1;
      delete values[k];
    },
    key: (i) => Object.keys(values)[i] || null,
    get length() {
      return Object.keys(values).length;
    }
  };
  const store = storeModule.createStore({ locks: null, backing: backing });
  const sync = syncModule.createSync({
    review: REVIEW,
    token: "t",
    helperOrigin: "http://127.0.0.1:7817",
    store: store,
    document: doc,
    window: win,
    fetch: fetchImpl,
    reloadNoticeMs: 0
  });
  t.after(() => {
    sync.stop();
    t.mock.timers.reset();
  });

  async function drain() {
    for (let i = 0; i < 50; i += 1) await Promise.resolve();
  }

  const r = {
    sync,
    store,
    doc,
    win,
    helper,
    requests,
    reloads,
    storageWrites,
    drain,
    polls: () => requests.filter((q) => q.route === "poll").map((q) => q.at),
    claims: () => requests.filter((q) => q.route === "claim"),
    async advance(ms, step) {
      const by = step || 100;
      for (let done = 0; done < ms; done += by) {
        t.mock.timers.tick(Math.min(by, ms - done));
        await drain();
      }
    },
    blur() {
      focused = false;
      win.fire("blur");
    },
    focus() {
      focused = true;
      win.fire("focus");
    },
    // Focus is back but no focus event arrived, which a browser can do.
    focusSilently() {
      focused = true;
      doc.hidden = false;
      doc.visibilityState = "visible";
    },
    hide() {
      focused = false;
      win.fire("blur");
      doc.hidden = true;
      doc.visibilityState = "hidden";
      doc.fire("visibilitychange");
    },
    show() {
      doc.hidden = false;
      doc.visibilityState = "visible";
      doc.fire("visibilitychange");
    }
  };
  return r;
}

async function started(r) {
  await r.sync.start();
  await r.drain();
}

function gaps(times) {
  const out = [];
  for (let i = 1; i < times.length; i += 1) out.push(times[i] - times[i - 1]);
  return out;
}

/** Idle until the poll has backed off to the cap, then return the time. */
async function backedOff(r) {
  await r.advance(FAST + 2000 + 4000 + 8000 + CAP + 500);
  const g = gaps(r.polls());
  assert.equal(g[g.length - 1], CAP, "precondition: the poll is at its cap, gaps were " + g.join(","));
  return Date.now();
}

function draftItem(note) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.DRAFT,
    note: note,
    page_origin: "http://127.0.0.1:4000",
    page_path: "/plan"
  });
}

// ---------------------------------------------------------------------------
// The constants
// ---------------------------------------------------------------------------

test("the poll is once a second focused, every 15 seconds visible, and not at all hidden", () => {
  assert.equal(FAST, 1000);
  assert.equal(syncModule.pollIntervalFor({ hidden: false, hasFocus: () => true }), 1000);
  assert.equal(syncModule.pollIntervalFor({ hidden: true }), null, "hidden: no poll");
  assert.equal(syncModule.pollIntervalFor({ hidden: false, hasFocus: () => false }), 15000, "visible, unfocused");
  assert.equal(syncModule.VISIBLE_POLL_INTERVAL_MS, 15000);
  assert.equal(syncModule.pollIntervalFor({ hidden: false }), 1000, "no hasFocus to ask is treated as focused");
  assert.equal(syncModule.isAway(null), false);
});

// ---------------------------------------------------------------------------
// Focused: steady, and keystrokes are free
// ---------------------------------------------------------------------------

test("a focused tab polls once a second, steadily, however long it sits idle", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(60000, 100);
  const g = gaps(r.polls());
  assert.ok(g.length >= 55, "about one a second for a minute: " + g.length);
  g.forEach((each) => assert.equal(each, FAST, "no slowdown"));
});

// The owner, approving this design: "just be careful about anything that is
// firing on every keystroke, as i think that was part of what slowed us down
// before. we were writing multiple places every keystroke."

/** Count every timer the page schedules from here on. */
function countTimers(t) {
  const counted = { count: 0 };
  const realSet = globalThis.setTimeout;
  const wrapper = function () {
    counted.count += 1;
    return realSet.apply(this, arguments);
  };
  globalThis.setTimeout = wrapper;
  t.after(() => {
    // Only undo our own wrapper. If the mock clock was already reset, the real
    // setTimeout is back in place and must not be replaced with the mock's.
    if (globalThis.setTimeout === wrapper) globalThis.setTimeout = realSet;
  });
  return counted;
}

test("200 key presses, clicks and selection changes in a row cost nothing at all", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(1500);
  const requestsBefore = r.requests.length;
  const writesBefore = r.storageWrites.count;
  const timers = countTimers(t);
  for (let i = 0; i < 200; i += 1) {
    r.doc.fire("keydown");
    r.doc.fire("selectionchange");
    r.doc.fire("pointermove");
    if (i % 10 === 0) r.doc.fire("pointerdown");
  }
  await r.drain();
  assert.equal(r.requests.length - requestsBefore, 0, "no request");
  assert.equal(r.storageWrites.count - writesBefore, 0, "no browser storage write");
  assert.equal(timers.count, 0, "no timer scheduled or moved");
});

test("200 key presses spread over 10 seconds leave the poll on its clock", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(1500);
  const at = Date.now();
  const writesBefore = r.storageWrites.count;
  for (let i = 0; i < 200; i += 1) {
    r.doc.fire("keydown");
    r.doc.fire("selectionchange");
    await r.advance(50, 50);
  }
  const polls = r.polls().filter((p) => p > at);
  assert.ok(polls.length <= 10, "one a second, not one a key: " + polls.length);
  gaps(polls).forEach((g) => assert.equal(g, FAST));
  assert.equal(r.storageWrites.count - writesBefore, 0, "no browser storage write from the events");
});

// ---------------------------------------------------------------------------
// Away: no polling at all
// ---------------------------------------------------------------------------

test("a visible page without focus polls every 15 seconds and keeps the ordinary heartbeat", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(3500);
  const at = Date.now();
  r.blur();
  await r.drain();
  assert.equal(r.requests.filter((q) => q.at >= at).length, 0, "the blur itself sends nothing");
  await r.advance(60000, 500);
  const polls = r.polls().filter((p) => p > at);
  assert.equal(polls.length, 4, "four polls in a minute: " + polls.map((p) => p - at).join(","));
  gaps(polls).forEach((g) => assert.equal(g, 15000));
  const beats = r.claims().filter((c) => c.at > at);
  assert.ok(beats.length >= 5, "the 10 second beat carries on: " + beats.length);
  beats.forEach((b) => assert.equal(b.body.quiet, false, "never quiet: it keeps the 30 second window"));
});

test("a visible page without focus shows a reply within 15 seconds", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(3500);
  r.blur();
  await r.advance(20000, 500);
  r.helper.replies = [{ event: "item.reply", item: "i1", seq: 1 }];
  await r.advance(15000, 500);
  assert.equal(r.sync.repliesSeen().length, 1, "the reply is on the page");
});

test("becoming visible from hidden, without focus, polls at once and then every 15 seconds", async (t) => {
  const r = rig(t);
  await started(r);
  r.hide();
  await r.advance(LONG, 1000);
  const at = Date.now();
  r.show();
  await r.drain();
  assert.deepEqual(r.polls().filter((p) => p >= at), [at], "one poll right away");
  await r.advance(31000, 500);
  assert.deepEqual(gaps(r.polls().filter((p) => p >= at)), [15000, 15000]);
});

test("a page that goes hidden and back to visible keeps the claim right both ways", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(3500);
  r.hide();
  await r.advance(20000, 500);
  assert.ok(r.claims().some((c) => c.body && c.body.quiet === true), "hidden: the helper was told quiet");
  const at = Date.now();
  r.show();
  await r.drain();
  const back = r.claims().filter((c) => c.at >= at);
  assert.equal(back.length, 1, "visible again: one beat at once");
  assert.equal(back[0].body.quiet, false, "saying it is not quiet, so the 30 second window is back");
  await r.advance(21000, 500);
  assert.equal(r.claims().filter((c) => c.at >= at).length, 3, "then the 10 second beat");
});

test("a hidden tab sends no reply poll at all", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(3000);
  const at = Date.now();
  r.hide();
  await r.advance(LONG, 1000);
  assert.deepEqual(r.polls().filter((p) => p > at), []);
});

test("a hidden tab's only requests are one heartbeat per 5 minutes", async (t) => {
  const r = rig(t);
  await started(r);
  // Half way between two polls, so nothing is on the wire at the blur.
  await r.advance(3500);
  const at = Date.now();
  r.hide();
  await r.drain();
  assert.equal(r.requests.filter((q) => q.at >= at).length, 0, "hiding with nothing queued sends nothing");
  await r.advance(LONG, 1000);
  const sent = r.requests.filter((q) => q.at >= at);
  assert.ok(sent.every((q) => q.route === "claim"), "nothing but heartbeats: " + sent.map((q) => q.route).join(","));
  // The first is the ordinary beat already due, which tells the helper this
  // tab went quiet. After that, one every five minutes.
  assert.ok(sent[0].at - at <= 10000, "the beat that says quiet was the one already due");
  assert.deepEqual(gaps(sent.map((q) => q.at)), [QUIET_BEAT, QUIET_BEAT]);
  sent.forEach((q) => assert.equal(q.body.quiet, true, "each one says quiet"));
});

test("focusing the window polls at once, then at one second", async (t) => {
  const r = rig(t);
  await started(r);
  r.hide();
  await r.advance(60000, 1000);
  const at = Date.now();
  r.show();
  r.focus();
  await r.drain();
  assert.deepEqual(r.polls().filter((p) => p >= at), [at], "one poll, right away");
  await r.advance(FAST);
  assert.equal(r.polls().filter((p) => p > at).length, 1, "and the next one second later");
});

test("coming back to a hidden tab polls once, whichever of visibility and focus fires", async (t) => {
  const r = rig(t);
  await started(r);
  r.hide();
  await r.advance(60000, 1000);
  const at = Date.now();
  r.show();
  await r.drain();
  assert.deepEqual(r.polls().filter((p) => p >= at), [at], "becoming visible polls at once");
  r.focus();
  await r.drain();
  assert.deepEqual(r.polls().filter((p) => p >= at), [at], "and the focus right after it adds no second poll");
});

test("a key or click while the page thinks it is away, with focus actually back, is a return", async (t) => {
  const r = rig(t);
  await started(r);
  r.hide();
  await r.advance(30000, 1000);
  const at = Date.now();
  r.focusSilently();
  r.doc.fire("pointerdown");
  await r.drain();
  assert.deepEqual(r.polls().filter((p) => p >= at), [at], "polled at once, as on focus");
});

test("a reply that arrived while the tab was unfocused reaches the page the moment it comes back", async (t) => {
  const r = rig(t);
  await started(r);
  r.hide();
  await r.advance(LONG, 1000);
  r.helper.replies = [{ event: "item.reply", item: "i1", seq: 1 }];
  const at = Date.now();
  r.show();
  r.focus();
  await r.drain();
  assert.equal(r.sync.repliesSeen().length, 1, "the reply is on the page with no wait");
  assert.deepEqual(r.polls().filter((p) => p >= at), [at]);
});

test("a page rebuilt while the tab was away reloads when the reviewer comes back", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(FAST + 100);
  r.hide();
  r.helper.mtime = "2026-09-28T11:10:00.000Z";
  await r.advance(LONG, 1000);
  assert.equal(r.reloads.length, 0, "nothing polled while away, so nothing reloaded");
  r.show();
  r.focus();
  await r.drain();
  await r.advance(syncModule.RELOAD_DEBOUNCE_MS + 200);
  assert.equal(r.reloads.length, 1, "reloaded within the debounce of coming back");
});

test("closing the tab while unfocused still says goodbye", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(3000);
  r.blur();
  await r.advance(LONG, 1000);
  const at = Date.now();
  r.win.fire("pagehide");
  await r.drain();
  const release = r.requests.filter((q) => q.at >= at && q.route === "release");
  assert.equal(release.length, 1, "the goodbye went out");
  assert.equal(release[0].body.session_secret, "secret", "carrying the secret that proves it was the holder");
});

// ---------------------------------------------------------------------------
// The heartbeat
// ---------------------------------------------------------------------------

test("a focused holder beats every 10 seconds and says it is not quiet", async (t) => {
  const r = rig(t);
  await started(r);
  const start = Date.now();
  await r.advance(35000, 500);
  const beats = r.claims().filter((c) => c.at > start);
  assert.deepEqual(gaps(beats.map((b) => b.at)), [10000, 10000]);
  beats.forEach((b) => assert.equal(b.body.quiet, false));
});

test("coming back beats at once saying not quiet, then every 10 seconds", async (t) => {
  const r = rig(t);
  await started(r);
  r.hide();
  await r.advance(LONG, 1000);
  const at = Date.now();
  r.show();
  r.focus();
  await r.drain();
  await r.advance(21000, 500);
  const beats = r.claims().filter((c) => c.at >= at);
  assert.equal(beats[0].at, at, "a beat the moment the reviewer came back");
  assert.equal(beats.length, 3, "one for the return, then every 10 seconds");
  beats.forEach((b) => assert.equal(b.body.quiet, false));
});

test("a quick look away, shorter than one beat, costs no extra request on return", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(12000, 500);
  r.blur();
  await r.advance(2000, 500);
  const at = Date.now();
  r.focus();
  await r.drain();
  assert.equal(r.claims().filter((c) => c.at >= at).length, 0, "the helper was never told quiet, so nothing to undo");
  assert.equal(r.polls().filter((p) => p >= at).length, 1, "the return still polls");
});

test("against a helper that never offers the slow beat, the page keeps the fast one and never says quiet", async (t) => {
  const r = rig(t, { quietBeat: null });
  await started(r);
  const at = Date.now();
  r.hide();
  await r.advance(35000, 500);
  const beats = r.claims().filter((c) => c.at > at);
  assert.ok(beats.length >= 3, "still beating every 10 seconds: " + beats.length);
  gaps(beats.map((b) => b.at)).forEach((g) => assert.ok(g <= 10000, "gap " + g));
  beats.forEach((b) => assert.notEqual(b.body.quiet, true));
});

// ---------------------------------------------------------------------------
// Review fixes
// ---------------------------------------------------------------------------

test("a page that loads hidden still records the version it shows, so a rebuild before return reloads it", async (t) => {
  // The page reloaded for a rebuild and the reviewer switched to the terminal
  // while it loaded. The agent rebuilds again. On return the page must know it
  // is showing the older file.
  const r = rig(t, { startHidden: true });
  await started(r);
  await r.drain();
  assert.equal(r.polls().length, 1, "one poll at load, even hidden, to learn the version on screen");
  r.helper.mtime = "2026-09-28T11:20:00.000Z";
  await r.advance(LONG, 1000);
  assert.equal(r.polls().length, 1, "and no repeating poll while away");
  r.show();
  r.focus();
  await r.drain();
  await r.advance(syncModule.RELOAD_DEBOUNCE_MS + 200);
  assert.equal(r.reloads.length, 1, "the newer file reloads the page on return");
});

test("the beat that would tell the helper quiet fails, so the next beat stays fast and says quiet again", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(3500);
  r.hide();
  // The helper is being replaced at exactly the beat that says quiet.
  r.helper.down = true;
  await r.advance(10000, 500);
  const failed = r.claims().filter((c) => c.body && c.body.quiet === true);
  assert.equal(failed.length, 1, "precondition: the quiet beat went out into a helper that was down");
  r.helper.down = false;
  const at = failed[0].at;
  await r.advance(25000, 500);
  const next = r.claims().filter((c) => c.at > at);
  assert.ok(next.length >= 1, "beat again");
  assert.ok(next[0].at - at <= 10000, "at the fast pace, because nothing ever answered the quiet beat: " + (next[0].at - at));
  assert.equal(next[0].body.quiet, true, "saying quiet again");
  // Once a grant has answered it, the slow beat starts.
  const confirmedAt = next[0].at;
  await r.advance(QUIET_BEAT, 1000);
  const after = r.claims().filter((c) => c.at > confirmedAt);
  assert.ok(after.length >= 1, "the slow beat did come");
  // Timed from the grant, which this rig delivers within one clock step.
  const gap = after[0].at - confirmedAt;
  assert.ok(gap >= QUIET_BEAT && gap <= QUIET_BEAT + 1000, "five minutes after the granted quiet beat: " + gap);
});

test("coming back by clicking straight into a frame on the page is noticed on the next pointer move", async (t) => {
  const r = rig(t);
  await started(r);
  r.hide();
  await r.advance(30000, 1000);
  const at = Date.now();
  // Focus is inside a frame: the top page gets no focus and no click.
  r.focusSilently();
  r.doc.fire("pointermove");
  await r.drain();
  assert.deepEqual(r.polls().filter((p) => p >= at), [at], "polled at once, as on focus");
});

test("after a helper restart, the page's last-seen time comes from the saved session table", () => {
  const first = registry("lahe-quiet-lastseen-");
  first.reviews.claimWindow("rquiet1", { window_id: "a", quiet: true });
  first.at.ms += 120000;
  const second = first.make();
  second.create({ id: "rquiet1", origins: ["null"] });
  second.loadSessions();
  assert.equal(
    second.lastSeenAt("rquiet1"),
    new Date(first.at.ms - 120000).toISOString(),
    "an unfocused page that has not beaten since the restart is still seen as open"
  );
});

test("an away tab with the helper down does not retry every second", async (t) => {
  const r = rig(t);
  await started(r);
  await r.advance(3000);
  r.hide();
  await r.advance(12000, 500);
  r.helper.down = true;
  const at = Date.now();
  await r.advance(LONG, 1000);
  const tries = r.claims().filter((c) => c.at > at).length;
  assert.ok(tries <= 3, "one try per slow beat, not one a second: " + tries);
});

test("a read-only window re-asks every 10 seconds focused, not at all hidden, and at once on return", async (t) => {
  const r = rig(t, { refuse: true });
  await started(r);
  assert.equal(r.sync.isReadOnly(), true, "precondition: the helper refused this window");
  let at = Date.now();
  await r.advance(25000, 500);
  assert.deepEqual(gaps(r.claims().filter((c) => c.at > at).map((c) => c.at)), [10000]);

  r.hide();
  at = Date.now();
  await r.advance(LONG, 1000);
  assert.equal(r.claims().filter((c) => c.at > at).length, 0, "no re-ask while hidden");

  at = Date.now();
  r.show();
  r.focus();
  await r.drain();
  assert.equal(r.claims().filter((c) => c.at >= at).length, 1, "re-asked at once on return");
  await r.advance(10000, 500);
  assert.equal(r.claims().filter((c) => c.at >= at).length, 2, "and every 10 seconds again");
});

test("a read-only window beside the terminal re-asks every 15 seconds", async (t) => {
  const r = rig(t, { refuse: true });
  await started(r);
  await r.advance(3500);
  r.blur();
  const at = Date.now();
  await r.advance(46000, 500);
  const asks = r.claims().filter((c) => c.at > at).map((c) => c.at);
  assert.deepEqual(gaps(asks), [15000, 15000]);
});

// ---------------------------------------------------------------------------
// The helper's side: how long a quiet holder keeps the review
// ---------------------------------------------------------------------------

function registry(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const at = { ms: Date.parse("2026-09-28T12:00:00.000Z") };
  const make = () =>
    reviewsModule.createReviews({ dir: dir, log: logModule.createEventLog({ dir: dir }), now: () => at.ms });
  const reviews = make();
  reviews.create({ id: "rquiet1", origins: ["null"] });
  return { reviews, at, make };
}

test("the helper's quiet window is 390 seconds, the slow beat it offers is 300", () => {
  assert.equal(reviewsModule.STALE_AFTER_MS, 30000, "a holder that is not quiet is unchanged");
  assert.equal(reviewsModule.QUIET_STALE_AFTER_MS, 390000);
  assert.equal(reviewsModule.QUIET_HEARTBEAT_SECONDS, 300);
});

test("grants and refusals both offer the slow beat", () => {
  const { reviews } = registry("lahe-quiet-offer-");
  const grant = reviews.claimWindow("rquiet1", { window_id: "a" });
  assert.equal(grant.quiet_heartbeat_seconds, 300);
  const refusal = reviews.claimWindow("rquiet1", { window_id: "b" });
  assert.equal(refusal.granted, false);
  assert.equal(refusal.quiet_heartbeat_seconds, 300);
});

test("a quiet holder keeps the review through 389 seconds of silence and loses it at 391", () => {
  const { reviews, at } = registry("lahe-quiet-hold-");
  const secret = reviews.claimWindow("rquiet1", { window_id: "a" }).session_secret;
  assert.equal(reviews.claimWindow("rquiet1", { window_id: "a", session_secret: secret, quiet: true }).granted, true);

  at.ms += 389000;
  const early = reviews.claimWindow("rquiet1", { window_id: "b" });
  assert.equal(early.granted, false, "still held at 389 seconds");
  assert.match(early.reason, /7 minutes/, "and the refusal names the quiet holder's own wait: " + early.reason);

  at.ms += 2000;
  const late = reviews.claimWindow("rquiet1", { window_id: "b" });
  assert.equal(late.granted, true, "taken at 391 seconds");
  assert.equal(late.took_over, true);
});

test("Review here instead takes a quiet holder's review at once", () => {
  const { reviews, at } = registry("lahe-quiet-takeover-");
  const secret = reviews.claimWindow("rquiet1", { window_id: "a", quiet: true }).session_secret;
  at.ms += 5000;
  const taken = reviews.claimWindow("rquiet1", { window_id: "b", takeover: true });
  assert.equal(taken.granted, true, "no wait for the quiet window");
  assert.equal(taken.took_over, true);
  const old = reviews.claimWindow("rquiet1", { window_id: "a", session_secret: secret, quiet: true });
  assert.equal(old.granted, false);
  assert.equal(old.deposed, true, "and the quiet tab is told plainly it was deposed");
});

test("a holder that is not quiet is still taken after 30 seconds", () => {
  const { reviews, at } = registry("lahe-quiet-loud-");
  const secret = reviews.claimWindow("rquiet1", { window_id: "a" }).session_secret;
  reviews.claimWindow("rquiet1", { window_id: "a", session_secret: secret, quiet: false });
  at.ms += 31000;
  assert.equal(reviews.claimWindow("rquiet1", { window_id: "b" }).granted, true);
});

test("a quiet holder that beats again without quiet goes back to the 30 second window", () => {
  const { reviews, at } = registry("lahe-quiet-back-");
  const secret = reviews.claimWindow("rquiet1", { window_id: "a", quiet: true }).session_secret;
  at.ms += 60000;
  reviews.claimWindow("rquiet1", { window_id: "a", session_secret: secret });
  at.ms += 31000;
  assert.equal(reviews.claimWindow("rquiet1", { window_id: "b" }).granted, true);
});

test("a first claim that says quiet is held for the quiet window too", () => {
  const { reviews, at } = registry("lahe-quiet-first-");
  reviews.claimWindow("rquiet1", { window_id: "a", quiet: true });
  at.ms += 300000;
  assert.equal(reviews.claimWindow("rquiet1", { window_id: "b" }).granted, false);
});

test("a quiet holder is restored by a helper that restarts inside its window, and dropped after it", () => {
  const first = registry("lahe-quiet-restart-");
  first.reviews.claimWindow("rquiet1", { window_id: "a", quiet: true });

  first.at.ms += 300000;
  const second = first.make();
  second.create({ id: "rquiet1", origins: ["null"] });
  second.loadSessions();
  assert.ok(second.holderOf("rquiet1"), "restored at 300 seconds");
  assert.equal(second.holderOf("rquiet1").stale, false);

  first.at.ms += 91000;
  const third = first.make();
  third.create({ id: "rquiet1", origins: ["null"] });
  third.loadSessions();
  assert.equal(third.holderOf("rquiet1"), null, "dropped at 391 seconds");
});

test("the window.claim route passes quiet through as a boolean and nothing else", () => {
  const seen = [];
  const deps = {
    reviews: {
      claimWindow: (review, req) => {
        seen.push(req);
        return { granted: true };
      }
    }
  };
  const handler = routes.HANDLERS["window.claim"];
  handler({ review: "r", body: { window_id: "w", quiet: true } }, deps);
  handler({ review: "r", body: { window_id: "w", quiet: "yes" } }, deps);
  handler({ review: "r", body: { window_id: "w" } }, deps);
  assert.deepEqual(
    seen.map((s) => s.quiet),
    [true, false, false]
  );
});

test("protocol describes quiet on the window.claim route", () => {
  const route = protocol.route("window.claim");
  assert.match(route.request, /quiet\?/);
  assert.match(route.response, /quiet_heartbeat_seconds/);
});
