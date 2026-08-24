"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const routes = require("../../src/service/routes.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const projectionModule = require("../../src/service/projection.js");
const record = require("../../src/shared/record.js");
const syncModule = require("../../src/layer/sync.js");
const overlay = require("../../src/layer/overlay.js");

const watchersModule = require("../../src/service/watchers.js");
const { pollUntil } = require("../helpers/poll.js");

const NOW = Date.parse("2026-08-18T12:00:00.000Z");
const LIVENESS = protocol.AGENT_LIVENESS;
const STATE = protocol.AGENT_LIVENESS.STATE;

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-liveness-"));
}

function agoMs(ms) {
  return new Date(NOW - ms).toISOString();
}

// ---------------------------------------------------------------------------
// What the helper is allowed to say, computed from the machine
// ---------------------------------------------------------------------------
//
// The question the rail answers is "has anything come back?", so these tests are
// about elapsed times and about which evidence is allowed to change the wording.
// The old states (watching, working, unattended) reported on our own plumbing,
// which is not a thing the reviewer can act on and not a thing they asked.

/** A watcher probe that always gives the same answer, and spawns nothing. */
function probeSaying(answer) {
  return watchersModule.createWatchers({
    probe: () => Promise.resolve({ listening: answer, supported: answer !== null })
  });
}

function livingPid() {
  return process.pid;
}

function deadPid() {
  return 0;
}

test("nothing waiting says nothing at all, however long the agent has been quiet", () => {
  // THE HEALTHY, ORDINARY REVIEW. Every item answered, an agent still sitting on
  // it, and the reviewer has not opened that document in an hour because they
  // are working a different one. Nothing here is a symptom, so nothing is said:
  // a rail that speaks up on this state speaks up on nearly every session the
  // reviewer has open, and then it is not read on the one that matters.
  const quiet = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    listening: true,
    unanswered: 0,
    lastReplyAt: agoMs(46 * 60000),
    nowMs: NOW
  });
  assert.equal(quiet.state, STATE.NONE);

  // And it stays NONE with nothing listening either. An answered review with the
  // agent gone home is finished, not broken.
  const finished = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    listening: false,
    monitor: null,
    activity: { at: agoMs(6 * 3600000) },
    unanswered: 0,
    lastReplyAt: agoMs(6 * 3600000),
    nowMs: NOW
  });
  assert.equal(finished.state, STATE.NONE);
  assert.equal(finished.last_reply_at, agoMs(6 * 3600000), "still reported, just not said out loud");
});

test("working: something is waiting, and the agent has done something in the last few minutes", () => {
  // The distinction that keeps this honest in the other direction: "waiting 10m
  // and nothing has happened" is worth knowing, "waiting 10m while the agent
  // works" is not an alarm.
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    activity: { at: agoMs(30000) },
    listening: null,
    unanswered: 2,
    oldestUnansweredAt: agoMs(10 * 60000),
    nowMs: NOW
  });
  assert.equal(out.state, STATE.WORKING);

  // A reply landing counts as doing something too, which is the same fact from
  // the other side.
  const replying = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    activity: null,
    listening: null,
    unanswered: 2,
    oldestUnansweredAt: agoMs(10 * 60000),
    lastReplyAt: agoMs(40000),
    nowMs: NOW
  });
  assert.equal(replying.state, STATE.WORKING);

  // Stale footprints are not footprints. Ten minutes of nothing is a wait.
  const stopped = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    activity: { at: agoMs(LIVENESS.ACTIVE_MS + 1000) },
    listening: null,
    unanswered: 2,
    oldestUnansweredAt: agoMs(10 * 60000),
    lastReplyAt: agoMs(LIVENESS.ACTIVE_MS + 1000),
    nowMs: NOW
  });
  assert.equal(stopped.state, STATE.WAITING);
});

test("waiting: items are waiting and nothing has come back", () => {
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    listening: null,
    unanswered: 1,
    oldestUnansweredAt: agoMs(360000),
    lastReplyAt: null,
    nowMs: NOW
  });
  assert.equal(out.state, STATE.WAITING);
  assert.equal(out.oldest_unanswered_at, agoMs(360000));
  assert.equal(out.listening, null, "cannot tell is an answer, and it is this one");
});

test("no_agent: the machine can see that nothing is listening", () => {
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    // Nothing holds the wake feed open, no heartbeat, and the last lahe command
    // was long enough ago that no monitor is off working a batch either.
    listening: false,
    monitor: null,
    activity: { at: agoMs(LIVENESS.RECENT_COMMAND_MS + 60000) },
    unanswered: 1,
    oldestUnansweredAt: agoMs(360000),
    nowMs: NOW
  });
  assert.equal(out.state, STATE.NO_AGENT);
  assert.equal(out.listening, false);
});

test("cannot tell is never turned into nobody", () => {
  // A machine with no lsof on it answers null. Saying "no agent listening" there
  // would be a fabrication, and a fabricated calm or a fabricated alarm are the
  // same bug.
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    listening: null,
    monitor: null,
    activity: null,
    unanswered: 1,
    oldestUnansweredAt: agoMs(600000),
    nowMs: NOW
  });
  assert.equal(out.state, STATE.WAITING, "the honest line is the wait, which is always knowable");
  assert.equal(out.listening, null);
});

test("something holding the wake feed open counts as listening, which is the whole point", () => {
  // This is the Claude Code host: it arms its own `tail -n 0 -f wake.log` and
  // runs no monitor at all. That tail is the wake channel we want, and it used
  // to leave no trace the helper could read, so an armed session looked exactly
  // like one nobody had ever opened.
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    listening: true,
    monitor: null,
    activity: null,
    unanswered: 1,
    oldestUnansweredAt: agoMs(360000),
    nowMs: NOW
  });
  assert.equal(out.listening, true);
  assert.equal(out.state, STATE.WAITING, "listening is not answering, so the wait still stands");
});

test("a heartbeat whose process is gone is not a heartbeat", () => {
  // Freshness alone used to be the whole check, so a monitor killed thirty
  // seconds ago still read as live for another fifteen.
  const dead = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    monitor: { pid: 424242, handoff_rev: 0, at: agoMs(5000) },
    listening: false,
    activity: null,
    unanswered: 1,
    oldestUnansweredAt: agoMs(360000),
    pidAlive: deadPid() === 0 ? () => false : () => true,
    nowMs: NOW
  });
  assert.equal(dead.state, STATE.NO_AGENT, "a dead pid does not hold off the alarm");
  assert.equal(dead.listening, false);

  const alive = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    monitor: { pid: livingPid(), handoff_rev: 0, at: agoMs(5000) },
    listening: false,
    activity: null,
    unanswered: 1,
    oldestUnansweredAt: agoMs(360000),
    pidAlive: () => true,
    nowMs: NOW
  });
  assert.equal(alive.state, STATE.WAITING);
  assert.equal(alive.listening, true);
});

test("the heartbeat window is three of the monitor's own loops, and the rev still fences it", () => {
  const justInside = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    monitor: { pid: 1, handoff_rev: 0, at: agoMs(protocol.MONITOR.HEARTBEAT_FRESH_MS - 1) },
    pidAlive: () => true,
    listening: false,
    unanswered: 1,
    oldestUnansweredAt: agoMs(360000),
    nowMs: NOW
  });
  const justOutside = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    monitor: { pid: 1, handoff_rev: 0, at: agoMs(protocol.MONITOR.HEARTBEAT_FRESH_MS + 1) },
    pidAlive: () => true,
    listening: false,
    unanswered: 1,
    oldestUnansweredAt: agoMs(360000),
    nowMs: NOW
  });
  assert.equal(protocol.MONITOR.HEARTBEAT_FRESH_MS, 45000);
  assert.equal(justInside.listening, true);
  assert.equal(justOutside.listening, false);

  // A heartbeat carrying an older handoff rev is a pre-takeover monitor that has
  // not noticed yet. It must never speak for the agent that took over.
  const fenced = agentSessions.livenessFrom({
    session: { handoff_rev: 1 },
    monitor: { pid: 1, handoff_rev: 0, at: agoMs(1000) },
    pidAlive: () => true,
    listening: false,
    unanswered: 1,
    oldestUnansweredAt: agoMs(360000),
    nowMs: NOW
  });
  assert.equal(fenced.listening, false);
  assert.equal(fenced.monitor_at, null);
  assert.equal(fenced.state, STATE.NO_AGENT);
});

test("a lahe command in the last few minutes holds off the no-agent wording", () => {
  // The exit-on-work monitor is GONE the moment it prints work, so a Codex or
  // Antigravity agent spends the next few minutes editing with nothing holding
  // the feed open and no heartbeat. Calling that nobody would be a false alarm
  // at exactly the moment the agent is doing the work.
  const midBatch = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    monitor: null,
    activity: { at: agoMs(240000) },
    listening: false,
    unanswered: 1,
    oldestUnansweredAt: agoMs(300000),
    nowMs: NOW
  });
  assert.equal(midBatch.state, STATE.WAITING, "still waiting; just not accused of nobody");
  assert.equal(midBatch.listening, true);

  // It buys no quiet, though. The wait is still on the line and still grows.
  assert.equal(midBatch.oldest_unanswered_at, agoMs(300000));
});

test("an agent that is mid-task is not an alarm, however long the queue behind it", () => {
  // Ten minutes with the agent demonstrably running commands is a busy agent,
  // not a missing one. The wait is still on the line; it is just explained.
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    listening: true,
    activity: { at: agoMs(20000) },
    unanswered: 1,
    oldestUnansweredAt: agoMs(LIVENESS.STALE_MS + 60000),
    nowMs: NOW
  });
  assert.equal(out.state, STATE.WORKING);

  const rail = overlay.createRail({ document: null, now: () => NOW });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);
  rail.setAgentLiveness(out);
  assert.equal(rail.statusLine().text, "Stored · agent is working, 11m");
  assert.equal(rail.statusLine().loud, false, "a busy agent is not shouted about");
  rail.unmount();
});

test("an agent that has genuinely gone away still reads as gone", () => {
  // The heartbeat stopped, its process is gone, nothing holds the feed open and
  // no command has run in an hour. This is the reading that has to survive every
  // signal added above it.
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    monitor: { pid: 424242, handoff_rev: 0, at: agoMs(3600000) },
    pidAlive: () => false,
    activity: { at: agoMs(3600000) },
    listening: false,
    unanswered: 3,
    oldestUnansweredAt: agoMs(20 * 60000),
    lastReplyAt: agoMs(46 * 60000),
    nowMs: NOW
  });
  assert.equal(out.state, STATE.NO_AGENT);

  const rail = overlay.createRail({ document: null, now: () => NOW });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);
  rail.setAgentLiveness(out);
  const line = rail.statusLine();
  assert.equal(line.text, "Stored · nobody has picked this up, 20m");
  assert.equal(line.loud, true);
  rail.unmount();
});

test("an armed watcher over an agent that stopped reading is not called healthy", () => {
  // The reviewer had a session in exactly this state: a tail armed, nothing back
  // for 46 minutes. Detecting the watcher must not buy it any calm.
  const out = agentSessions.livenessFrom({
    session: { handoff_rev: 0 },
    listening: true,
    unanswered: 1,
    oldestUnansweredAt: agoMs(46 * 60000),
    lastReplyAt: agoMs(46 * 60000),
    nowMs: NOW
  });
  assert.equal(out.state, STATE.WAITING);

  const rail = overlay.createRail({ document: null, now: () => NOW });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);
  rail.setAgentLiveness(out);
  assert.equal(rail.statusLine().text, "Stored · nothing back yet, 46m");
  assert.equal(rail.statusLine().loud, true);
  rail.unmount();
});

test("the store reads the heartbeat, the activity stamp and the watcher off the machine", async () => {
  const dir = tempDir();
  const nobody = probeSaying(false);
  const store = agentSessions.createStore({ dir: dir, watchers: nobody });
  store.create({ id: "s_disk" });
  await store.warmWatching(["s_disk"]);

  const waiting = { unanswered: 1, oldestUnansweredAt: new Date(Date.now() - 400000).toISOString() };
  assert.equal(store.liveness("s_disk", waiting).state, STATE.NO_AGENT);
  assert.equal(store.watchingFeed("s_disk"), false);

  store.touchActivity("s_disk");
  assert.equal(store.liveness("s_disk", waiting).state, STATE.WORKING, "a command just ran");
  assert.equal(store.liveness("s_disk", { unanswered: 0 }).state, STATE.NONE, "and nothing waiting says nothing");

  const someone = probeSaying(true);
  const armed = agentSessions.createStore({ dir: dir, watchers: someone });
  await armed.warmWatching(["s_disk"]);
  assert.equal(armed.watchingFeed("s_disk"), true);
});

test("the probe answers off a real tail, and never blocks the poll", async () => {
  // The mechanism itself, against a real process holding a real file open. This
  // is the fact the whole design rests on: the helper is local, so it can ask
  // the machine a question a web server could not.
  const dir = tempDir();
  const file = path.join(dir, "wake.log");
  fs.writeFileSync(file, "");
  const watchers = watchersModule.createWatchers();

  // The FIRST call never waits. It says "cannot tell" and schedules the look,
  // because the reply poll runs about once a second per open page and a
  // subprocess at that rate is not a thing to do.
  assert.equal(watchers.listening(file), null);
  assert.equal(await watchers.refresh(file), false, "nothing holds it open");

  const tail = require("node:child_process").spawn("tail", ["-n", "0", "-f", file], { stdio: "ignore" });
  try {
    // Polled rather than slept on: the tail takes a moment to have the file
    // open, and the thing being waited for is that fact, not a duration.
    await pollUntil(() => watchers.refresh(file), {
      message: "the machine to report the tail holding the wake feed open"
    });
    assert.equal(watchers.listening(file), true, "and the answer is cached for the next poll");
  } finally {
    tail.kill();
  }
});

test("a probe that cannot run is asked once and then left alone", async () => {
  let asked = 0;
  const watchers = watchersModule.createWatchers({
    probe: () => {
      asked += 1;
      return Promise.resolve({ listening: null, supported: false });
    }
  });
  assert.equal(watchers.listening("/nowhere/wake.log"), null);
  await watchers.refresh("/nowhere/wake.log");
  assert.equal(watchers.unsupported(), true);
  watchers.listening("/nowhere/wake.log");
  await watchers.refresh("/nowhere/wake.log");
  assert.equal(asked, 1, "a machine that cannot answer is not asked every fifteen seconds forever");
});

// ---------------------------------------------------------------------------
// Through the wire
// ---------------------------------------------------------------------------

test("replies.poll answers with how long it has been, not with a claim", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const store = agentSessions.createStore({ dir: dir, watchers: probeSaying(false) });
  store.create({ id: "s_wire" });
  reviews.create({ id: "r_wire", agent_session_id: "s_wire" });

  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "the reviewer's own words",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/p.html",
    page_title: "Page",
    page_seq: 1
  });
  log.append("r_wire", [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "ev_ready",
      review: "r_wire",
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item }
    })
  ]);

  const deps = { log: log, reviews: reviews, agentSessions: store, projection: projectionModule };
  const poll = routes.handlerFor("replies.poll");
  const liveness = poll({ review: "r_wire", query: { since: 0 } }, deps).body.agent_liveness;

  assert.ok(liveness, "the rail gets ground truth, not the agent's claim");
  assert.equal(liveness.unanswered, 1);
  assert.ok(liveness.oldest_unanswered_at, "the rail can say how long the item has waited");
  assert.equal(liveness.last_reply_at, null, "nothing has come back yet");
  assert.equal(liveness.state, STATE.WAITING);
  assert.deepEqual(Object.keys(liveness).sort(), [
    "activity_at",
    "last_reply_at",
    "listening",
    "monitor_at",
    "oldest_unanswered_at",
    "state",
    "unanswered"
  ]);

  // The agent answers. The line now reports the answer rather than the wait, and
  // the timestamp is the folded reply's own, not something the page guessed.
  const folded = protocol.newEvent({
    event: protocol.EVENT.REPLY_FOLDED,
    event_id: "ev_reply",
    review: "r_wire",
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    payload: {
      accepted: true,
      state: record.STATE.HANDLED,
      reply: { status: "handled", agent: "claude", reason: null, text: null, files: [] }
    }
  });
  log.append("r_wire", [folded]);
  const after = poll({ review: "r_wire", query: { since: 0 } }, deps).body.agent_liveness;
  assert.equal(after.unanswered, 0);
  assert.equal(
    after.last_reply_at,
    folded[protocol.EVENT_FIELD.TS],
    "when the reply landed is still reported, off the reply the helper folded"
  );
  // ...and the state goes quiet, because nothing is waiting any more. An
  // answered review is the healthy case and the rail says nothing about it.
  assert.equal(after.state, STATE.NONE);
});

test("a reopened item is as old as its last transition, not as old as the comment", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const store = agentSessions.createStore({ dir: dir });
  store.create({ id: "s_old" });
  reviews.create({ id: "r_old", agent_session_id: "s_old" });

  const wroteAt = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
  const reopenedAt = new Date(Date.now() - 60 * 1000).toISOString();
  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "still not right",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/p.html",
    page_title: "Page",
    page_seq: 1
  });
  item[record.FIELD.CREATED_AT] = wroteAt;
  item[record.FIELD.UPDATED_AT] = reopenedAt;

  log.append("r_old", [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "ev_old",
      review: "r_old",
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item }
    }),
    protocol.newEvent({
      event: protocol.EVENT.ITEM_REOPENED,
      event_id: "ev_reopened",
      review: "r_old",
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV]
    })
  ]);

  const poll = routes.handlerFor("replies.poll");
  const liveness = poll(
    { review: "r_old", query: { since: 0 } },
    { log: log, reviews: reviews, agentSessions: store, projection: projectionModule }
  ).body.agent_liveness;

  assert.equal(liveness.unanswered, 1);
  // The rail says "oldest item 1m", not "oldest item 4h". The comment is four
  // hours old; the WORK is a minute old, and the age is what tells a reviewer
  // whether an agent is late.
  assert.equal(liveness.oldest_unanswered_at, reopenedAt);
});

test("the unanswered count is computed once per log position, not once per poll", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const store = agentSessions.createStore({ dir: dir });
  store.create({ id: "s_cache" });
  reviews.create({ id: "r_cache", agent_session_id: "s_cache" });

  const item = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "one thing",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/p.html",
    page_title: "Page",
    page_seq: 1
  });
  const readyEvent = protocol.newEvent({
    event: protocol.EVENT.ITEM_READY,
    event_id: "ev_cache",
    review: "r_cache",
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    page_path: item[record.FIELD.PAGE_PATH],
    page_title: item[record.FIELD.PAGE_TITLE],
    page_seq: item[record.FIELD.PAGE_SEQ],
    payload: { draft: false, record: item }
  });
  log.append("r_cache", [readyEvent]);

  // The poll runs about once a second per open page. Counting three items used
  // to mean re-reading the whole event log and re-projecting it every time.
  let reads = 0;
  const countingLog = Object.assign({}, log, {
    read: function (id) {
      reads += 1;
      return log.read(id);
    }
  });
  const deps = { log: countingLog, reviews: reviews, agentSessions: store, projection: projectionModule };
  const poll = routes.handlerFor("replies.poll");

  assert.equal(poll({ review: "r_cache", query: { since: 0 } }, deps).body.agent_liveness.unanswered, 1);
  const afterFirst = reads;
  assert.equal(poll({ review: "r_cache", query: { since: 0 } }, deps).body.agent_liveness.unanswered, 1);
  assert.equal(poll({ review: "r_cache", query: { since: 0 } }, deps).body.agent_liveness.unanswered, 1);
  assert.equal(reads, afterFirst, "an unchanged log is not re-read to answer the same question");

  // A projection is a pure function of the log, so the log's seq is the whole
  // cache key: a new event moves it and the answer is computed again.
  const second = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "another thing",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/p.html",
    page_title: "Page",
    page_seq: 1
  });
  log.append("r_cache", [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "ev_cache_2",
      review: "r_cache",
      item: second[record.FIELD.ID],
      rev: second[record.FIELD.REV],
      page_path: second[record.FIELD.PAGE_PATH],
      page_title: second[record.FIELD.PAGE_TITLE],
      page_seq: second[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: second }
    })
  ]);
  assert.equal(poll({ review: "r_cache", query: { since: 0 } }, deps).body.agent_liveness.unanswered, 2);
});

// ---------------------------------------------------------------------------
// One line, in a reviewer's words, that ages on its own clock
// ---------------------------------------------------------------------------

test("the rail's words are the protocol's, not a second hand-copied spelling", () => {
  // They used to be declared again in the layer from string literals. Rename a
  // state on the helper and the rail quietly stopped recognising it, which looks
  // exactly like a healthy rail with nothing to say.
  assert.equal(overlay.AGENT_TEXT, LIVENESS.TEXT, "one object, not two copies");
  [STATE.WORKING, STATE.WAITING, STATE.NO_AGENT].forEach((state) => {
    assert.equal(typeof LIVENESS.TEXT[state], "string", state + " has words");
    assert.match(LIVENESS.TEXT[state], /\{age\}/, state + " carries an elapsed time");
  });
  assert.equal(LIVENESS.TEXT[STATE.NONE], undefined, "the quiet state has no wait to report");
  assert.equal(typeof LIVENESS.CONNECTION.connected, "string");
  assert.equal(typeof LIVENESS.CONNECTION.absent, "string");

  // NONE OF THE REVIEWER-FACING WORDS IS ABOUT OUR PLUMBING. A monitor, a
  // heartbeat and a wake feed are all things the reviewer cannot act on, and
  // naming them asks them to care about how we are built.
  const words = []
    .concat(Object.keys(LIVENESS.TEXT).map((state) => LIVENESS.TEXT[state]))
    .concat(Object.keys(LIVENESS.CONNECTION).map((key) => LIVENESS.CONNECTION[key]))
    .concat(Object.keys(LIVENESS.DETAIL).map((key) => LIVENESS.DETAIL[key]))
    .concat([LIVENESS.SAVE_LABEL])
    .join(" ")
    .toLowerCase();
  ["monitor", "heartbeat", "wake", "watching", "unattended", "checked in", "liveness"].forEach((jargon) => {
    assert.equal(words.includes(jargon), false, "nothing the reviewer reads says " + JSON.stringify(jargon));
  });
});

test("the quiet indicator answers one question: is the chain intact", () => {
  // The two moments a reviewer actually looks at this: when they start, and when
  // they come back from a break. Both are "will my comments reach the agent?".
  const clock = Date.parse("2026-08-23T09:00:00.000Z");
  const rail = overlay.createRail({ document: null, now: () => clock });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);

  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, listening: true, last_reply_at: null });
  assert.equal(rail.statusLine().text, "Stored · agent listening");
  assert.equal(rail.statusLine().loud, false, "a working chain is never loud");
  assert.equal(rail.statusLine().save, null, "and it is not an emergency, so no escape hatch");

  // Something died while they were away. Still not an alarm (nothing is
  // waiting), but it is the thing they came back to check.
  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, listening: false, last_reply_at: null });
  assert.equal(rail.statusLine().text, "Stored · no agent listening");
  assert.equal(rail.statusLine().loud, false);

  // A machine that cannot be asked says nothing rather than guessing either way.
  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, listening: null, last_reply_at: null });
  assert.equal(rail.statusLine().text, "Stored");
  rail.unmount();
});

test("the hover text carries everything the tool knows about the connection", () => {
  const clock = Date.parse("2026-08-23T09:00:00.000Z");
  const rail = overlay.createRail({ document: null, now: () => clock });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);
  rail.setAgentLiveness({
    state: STATE.WAITING,
    unanswered: 1,
    listening: true,
    oldest_unanswered_at: new Date(clock - 45000).toISOString(),
    last_reply_at: new Date(clock - 240000).toISOString()
  });

  const title = rail.statusLine().title;
  assert.match(title, /helper is answering this page/);
  assert.match(title, /An agent has this review open\./);
  assert.match(title, /last replied 4m ago\./);
  assert.match(title, /waiting 45s\./);
  assert.match(title, /stored in this browser and in the helper's log on disk/);
  assert.match(title, /Save a copy/, "the way out is named where the detail is read");

  // Nothing known, nothing claimed.
  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, listening: null, last_reply_at: null });
  const bare = rail.statusLine().title;
  assert.match(bare, /cannot be checked on this computer/);
  assert.match(bare, /has not replied on this review yet/);
  assert.equal(/Save a copy/.test(bare), false, "the offer belongs to the moment it is needed");

  // A helper that is not answering says so first, and says nothing about agents:
  // nothing has reached one.
  rail.setStatusLine(overlay.STATUS.KEPT_LOCALLY);
  const down = rail.statusLine().title;
  assert.match(down, /helper is not answering right now/);
  assert.equal(/agent/i.test(down.replace(/hand to an agent/, "")), false, "no claim about agents while it is down");
  rail.unmount();
});

test("one line, and it never contradicts itself", () => {
  // THE BUG, as the reviewer met it. A reply arrives, the status line latches to
  // "Stored · agent reading" off a list that only ever grew, and it keeps saying
  // that for the rest of the session while a second line underneath reads "No
  // agent watching · oldest item 6m" (Ken, live, 2026-08-23).
  const clock = Date.parse("2026-08-23T09:00:00.000Z");
  const rail = overlay.createRail({ document: null, now: () => clock });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);
  rail.setAgentLiveness({
    state: STATE.WAITING,
    unanswered: 1,
    oldest_unanswered_at: new Date(clock - 360000).toISOString(),
    last_reply_at: new Date(clock - 900000).toISOString(),
    listening: true
  });

  const line = rail.statusLine();
  assert.equal(line.text, "Stored · nothing back yet, 6m");
  assert.equal(overlay.STATUS.AGENT_CONNECTED, undefined, "there is no agent status to latch to");
  assert.equal(overlay.STATUS_SHORT.agent_connected, undefined);
  rail.unmount();
});

test("work that is not stored yet says nothing about agents", () => {
  const clock = Date.parse("2026-08-23T09:00:00.000Z");
  const rail = overlay.createRail({ document: null, now: () => clock });
  rail.mount();
  rail.setAgentLiveness({
    state: STATE.NO_AGENT,
    unanswered: 1,
    oldest_unanswered_at: new Date(clock - 600000).toISOString(),
    listening: false
  });
  rail.setStatusLine(overlay.STATUS.KEPT_LOCALLY);
  // Nothing has reached a helper, so nothing has reached an agent. Saying an
  // agent is missing would be blaming the wrong thing.
  assert.equal(rail.statusLine().text, "Kept in this browser");
  assert.equal(rail.statusLine().agentState, null);
  rail.unmount();
});

test("the line stays quiet for the first two minutes, then says how long", () => {
  const clock = Date.parse("2026-08-23T09:00:00.000Z");
  const rail = overlay.createRail({ document: null, now: () => clock });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);
  const waitingSince = (ms) => new Date(clock - ms).toISOString();

  // An agent that has had a comment for forty seconds is reading it, and the
  // reviewer has just pressed submit. A stopwatch started in front of them there
  // is noise on every single comment.
  rail.setAgentLiveness({ state: STATE.WAITING, unanswered: 1, oldest_unanswered_at: waitingSince(10000) });
  assert.equal(rail.statusLine().text, "Stored");

  rail.setAgentLiveness({
    state: STATE.WAITING,
    unanswered: 1,
    oldest_unanswered_at: waitingSince(LIVENESS.QUIET_MS + 1000)
  });
  assert.equal(rail.statusLine().text, "Stored · nothing back yet, 31s");
  assert.equal(rail.statusLine().loud, false, "half a minute is information, not an alarm");

  // The agent is demonstrably mid-task, so the wait is explained rather than
  // shouted about.
  rail.setAgentLiveness({
    state: STATE.WORKING,
    unanswered: 1,
    oldest_unanswered_at: waitingSince(300000),
    activity_at: waitingSince(20000)
  });
  assert.equal(rail.statusLine().text, "Stored · agent is working, 5m");
  assert.equal(rail.statusLine().loud, false);

  // Past ten minutes with nothing happening, the line is loud.
  rail.setAgentLiveness({
    state: STATE.WAITING,
    unanswered: 1,
    oldest_unanswered_at: waitingSince(LIVENESS.STALE_MS + 1000)
  });
  assert.equal(rail.statusLine().text, "Stored · nothing back yet, 10m");
  assert.equal(rail.statusLine().loud, true);

  // No agent listening is loud from the moment it is known, because the
  // reviewer's next move is a different one.
  rail.setAgentLiveness({
    state: STATE.NO_AGENT,
    unanswered: 1,
    oldest_unanswered_at: waitingSince(LIVENESS.QUIET_MS + 1000),
    listening: false
  });
  assert.equal(rail.statusLine().text, "Stored · nobody has picked this up, 31s");
  assert.equal(rail.statusLine().loud, true, "waiting longer will not help, so it is not quiet");

  // And an answered review goes silent again, whatever else is true.
  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, oldest_unanswered_at: null });
  assert.equal(rail.statusLine().text, "Stored");
  rail.unmount();
});

test("the clock never starts on a draft the reviewer is still typing", () => {
  // A draft is waiting on nobody. Agents cannot see drafts anywhere else in this
  // design, and the wait clock does not see them either: the helper counts with
  // record.isUnansweredReady, which is READY and unanswered.
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const store = agentSessions.createStore({ dir: dir, watchers: probeSaying(false) });
  store.create({ id: "s_draft" });
  reviews.create({ id: "r_draft", agent_session_id: "s_draft" });

  const draft = record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.DRAFT,
    note: "half a thought, still being typed",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/p.html",
    page_title: "Page",
    page_seq: 1
  });
  log.append("r_draft", [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_CREATED,
      event_id: "ev_draft",
      review: "r_draft",
      item: draft[record.FIELD.ID],
      rev: draft[record.FIELD.REV],
      page_path: draft[record.FIELD.PAGE_PATH],
      page_title: draft[record.FIELD.PAGE_TITLE],
      page_seq: draft[record.FIELD.PAGE_SEQ],
      payload: { draft: true, record: draft }
    })
  ]);

  const liveness = routes.handlerFor("replies.poll")(
    { review: "r_draft", query: { since: 0 } },
    { log: log, reviews: reviews, agentSessions: store, projection: projectionModule }
  ).body.agent_liveness;
  assert.equal(liveness.unanswered, 0);
  assert.equal(liveness.oldest_unanswered_at, null);
  assert.equal(liveness.state, STATE.NONE, "nobody is late for something nobody was given");
});

test("when the line speaks it also offers the way out, and only then", () => {
  // The reassurance is the point, not the alarm. What worries a reviewer who has
  // had no answer is whether they are about to lose what they just wrote, so the
  // moment the line says nothing has come back, the way to keep a copy is beside
  // it rather than three clicks into a menu.
  const clock = Date.parse("2026-08-23T09:00:00.000Z");
  const exported = [];
  const rail = overlay.createRail({ document: null, now: () => clock });
  rail.mount();
  rail.onAction("export", () => {
    exported.push(true);
    return true;
  });
  rail.setStatusLine(overlay.STATUS.STORED);

  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, oldest_unanswered_at: null });
  assert.equal(rail.statusLine().save, null, "a healthy review is not offered an escape hatch");

  rail.setAgentLiveness({
    state: STATE.WAITING,
    unanswered: 1,
    oldest_unanswered_at: new Date(clock - 45000).toISOString()
  });
  const line = rail.statusLine();
  assert.equal(line.text, "Stored · nothing back yet, 45s");
  assert.equal(line.save, protocol.AGENT_LIVENESS.SAVE_LABEL);
  assert.match(line.title, /stored in this browser and in the helper's log on disk/);
  assert.equal(exported.length, 0, "the offer is an offer; nothing runs until it is pressed");
  rail.unmount();
});

test("the line ages on its own clock, with the helper saying nothing new", () => {
  let clock = Date.parse("2026-08-23T09:00:00.000Z");
  const intervals = [];
  const rail = overlay.createRail({
    document: null,
    now: () => clock,
    timers: {
      setInterval: (fn, ms) => {
        const handle = { fn: fn, ms: ms, cleared: false };
        intervals.push(handle);
        return handle;
      },
      clearInterval: (handle) => {
        if (handle) handle.cleared = true;
      }
    }
  });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);

  // Nothing waiting: no clock on the line, no timer, nothing said.
  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, oldest_unanswered_at: null });
  assert.equal(intervals.length, 0);
  assert.equal(rail.statusLine().text, "Stored");

  const oldest = new Date(clock - 10000).toISOString();
  rail.setAgentLiveness({ state: STATE.WAITING, unanswered: 1, oldest_unanswered_at: oldest });
  // Under half a minute the line has nothing to say YET, and that is exactly why
  // the timer has to be running: the moment it crosses thirty seconds has to
  // arrive on the rail's own clock.
  assert.equal(rail.statusLine().text, "Stored");
  assert.equal(intervals.length, 1, "a wait that has not spoken yet still needs a tick");
  assert.equal(intervals[0].ms, 30000);

  // The helper says nothing new for ten minutes.
  clock += 10 * 60000;
  assert.equal(rail.statusLine().text, "Stored · nothing back yet, 10m");
  assert.equal(rail.statusLine().loud, true, "it went loud without being told anything");

  // Everything answered: the clock leaves the line and the timer goes with it.
  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0, oldest_unanswered_at: null });
  assert.equal(rail.statusLine().text, "Stored");
  assert.equal(intervals[0].cleared, true, "a line with no wait on it holds no timer");

  rail.setAgentLiveness({ state: STATE.WAITING, unanswered: 1, oldest_unanswered_at: oldest });
  assert.equal(intervals.length, 2);
  rail.unmount();
  assert.equal(intervals[1].cleared, true, "an unmounted rail leaves no interval behind");
});

test("a state the rail has never heard of says nothing rather than inventing a sentence", () => {
  const rail = overlay.createRail({ document: null });
  rail.mount();
  rail.setStatusLine(overlay.STATUS.STORED);
  assert.equal(rail.setAgentLiveness({ state: "hibernating", unanswered: 4 }) !== null, true);
  assert.equal(rail.agentLine(), null);
  assert.equal(rail.statusLine().text, "Stored");
  // And the state the protocol does define as quiet is quiet for the same reason
  // a reviewer would want: nothing is waiting and nothing was ever said.
  rail.setAgentLiveness({ state: STATE.NONE, unanswered: 0 });
  assert.equal(rail.agentLine(), null);
  rail.unmount();
});

test("the route table documents agent_liveness, so nobody has to read the handler to find it", () => {
  const route = protocol.route("replies.poll");
  assert.match(route.response, /agent_liveness/);
  assert.match(route.response, /oldest_unanswered_at/);
});

test("a review with no agent session is told the truth, and never accused of nobody", () => {
  // A review reached some other way has no session for an agent to be missing
  // from, so "no agent listening" would be an alarm about nobody. The wait is
  // still the wait, and it is still reported.
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  const store = agentSessions.createStore({ dir: dir, watchers: probeSaying(false) });
  reviews.create({ id: "r_legacy" });

  const poll = routes.handlerFor("replies.poll");
  const answer = poll(
    { review: "r_legacy", query: { since: 0 } },
    { log: log, reviews: reviews, agentSessions: store, projection: projectionModule }
  );
  assert.equal(answer.body.agent_liveness.state, STATE.NONE);
  assert.equal(answer.body.agent_liveness.listening, null);
});
