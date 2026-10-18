#!/usr/bin/env node
// What clearing the lesson queue costs the agent: presses against comments.
//
// Plan Task 4.2, verification row V12 (brief R15 and R13). Two runs over the
// same sixteen open lessons of the rebuilt lesson queue
// (preview/02_lesson_queue.md):
//
//   presses    one choice record per lesson, answer "promote"
//   comments   one comment per lesson, the shortest realistic one: the word
//              "promote" on the lesson's heading
//
// Each run walks a timeline. The reviewer acts at a reading pace, one lesson
// every PACE_S seconds. A press leaves the browser's outbox HOLD_S seconds after
// the last press (the architecture's quiet window; at this pace every press is
// alone in its window), a comment leaves at once. The agent waits with
// `lahe monitor`, which polls every POLL_S seconds and exits on the first poll
// that finds undelivered work; the agent then spends WORK_S seconds draining
// and answering before it launches the monitor again, whose first poll is at
// once. Every wake runs the real monitor, the real drain and the real reply
// command in process, against a throwaway state folder and a faked helper that
// projects the log, exactly as measure_one_comment.js does. Characters are
// counted as a host would see them; tokens are estimated as characters / 4.
//
// Red (plan V12) when presses cost more drain characters than comments, or
// more wakes. Usage: node docs/features/20261013.01_choice_buttons/measure_choice_queue.js [--show]
//
// The script removes the temp folders it made, and nothing else.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.join(__dirname, "..", "..", "..");
const protocol = require(path.join(root, "src/shared/protocol.js"));
const record = require(path.join(root, "src/shared/record.js"));
const logModule = require(path.join(root, "src/service/log.js"));
const reviewsModule = require(path.join(root, "src/service/reviews.js"));
const agentSessions = require(path.join(root, "src/service/agent_sessions.js"));
const projectionModule = require(path.join(root, "src/service/projection.js"));
const stateDirModule = require(path.join(root, "src/service/state_dir.js"));
const monitor = require(path.join(root, "src/cli/commands/monitor.js"));
const status = require(path.join(root, "src/cli/commands/status.js"));
const reply = require(path.join(root, "src/cli/commands/reply.js"));

const PACE_S = 8;
const HOLD_S = 3;
const POLL_S = protocol.MONITOR.INTERVAL_SECONDS;
const WORK_S = 20;

const SESSION = "s_7a1e2c3d4b5f6071";
const REVIEW = "r2b3c4d5e6f70811";
const ORIGIN = "http://docs.features.20261012-01-forge-international-style.lahe.localhost";
const PATH = "/02_lesson_queue.md";
const TITLE = "Lesson queue: 19 waiting";
const QUEUE = path.join(__dirname, "preview", "02_lesson_queue.md");
const SOURCE = "/Users/kennethstclair/Documents/workspace/personal/docs/features/20261012.01_forge_international_style/02_lesson_queue.md";

/** The open lessons of the rebuilt queue: heading and group name, in order. */
function lessons() {
  const lines = fs.readFileSync(QUEUE, "utf8").split("\n");
  const out = [];
  let heading = null;
  lines.forEach(function (line) {
    const h = /^### (.+)$/.exec(line);
    if (h) heading = h[1].trim();
    const g = /data-choice="([a-z0-9-]+)"/.exec(line);
    if (g && heading) out.push({ heading: heading, group: g[1] });
  });
  return out;
}

function pressRecord(lesson, index, at) {
  return record.newItem({
    id: "itm_" + String(index).padStart(2, "0") + "a1b2c3d4e5f6a7b8c9d0e1",
    kind: record.KIND.CHOICE,
    state: record.STATE.READY,
    choice: { group: lesson.group, answer: "promote" },
    page_origin: ORIGIN,
    page_path: PATH,
    page_title: TITLE,
    page_seq: 1,
    created_at: at,
    updated_at: at,
    context: { quote: "What should happen to this lesson?", prefix: null, suffix: null, heading: lesson.heading, element: null, subject: null },
    region: { ref: { kind: "choice", group: lesson.group }, label: "choice", lost: null }
  });
}

function commentRecord(lesson, index, at) {
  return record.newItem({
    id: "itm_" + String(index).padStart(2, "0") + "b2c3d4e5f6a7b8c9d0e1f2",
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "promote",
    page_origin: ORIGIN,
    page_path: PATH,
    page_title: TITLE,
    page_seq: 1,
    created_at: at,
    updated_at: at,
    context: { quote: lesson.heading, prefix: "", suffix: "", heading: lesson.heading, element: null, subject: null },
    region: {
      ref: { id: "ref_" + index, stamp: "e" + String(index).padStart(8, "0"), where: "main > section.sheet > h3", ordinal: { index: 1, of: 1 } },
      label: "h3 " + index,
      lost: null
    }
  });
}

function buildState() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-measure-choice-"));
  agentSessions.createStore({ dir: dir }).create({ id: SESSION });
  const log = logModule.createEventLog({ dir: dir });
  reviewsModule.createReviews({ dir: dir, log: log }).create({ id: REVIEW, agent_session_id: SESSION });
  fs.writeFileSync(
    stateDirModule.readyPath(dir),
    JSON.stringify({ port: 7999, reviews: { [REVIEW]: { token: "t".repeat(16), origins: [ORIGIN] } } })
  );
  return { dir: dir, log: log };
}

function appendReady(log, item, seq) {
  log.append(REVIEW, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "ev_measure_" + seq,
      review: REVIEW,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item }
    })
  ]);
}

function fakeHelper(dir) {
  return async function () {
    const events = logModule.createEventLog({ dir: dir }).read(REVIEW);
    const projection = projectionModule.project(REVIEW, events);
    projection.page_last_seen_at = new Date(Date.now() - 5000).toISOString();
    return { ok: true, status: 200, json: async () => projection };
  };
}

/**
 * The timeline: when each item reaches the helper, and when the agent wakes.
 * Returns the wakes, each with the indexes of the items it delivers.
 */
function timeline(count, holdS) {
  const lands = [];
  for (let i = 0; i < count; i += 1) lands.push(i * PACE_S + holdS);
  const wakes = [];
  let delivered = 0;
  let pollAt = 0; // the monitor's first poll is at launch
  while (delivered < count) {
    // The first poll at or after pollAt that finds work it has not delivered.
    let t = pollAt;
    while (lands[delivered] > t) t += POLL_S;
    const items = [];
    while (delivered < count && lands[delivered] <= t) { items.push(delivered); delivered += 1; }
    wakes.push({ at: t, items: items });
    pollAt = t + WORK_S; // drain, answer, relaunch; the relaunched monitor polls at once
  }
  return wakes;
}

async function runScenario(name, makeRecord, holdS, show) {
  const state = buildState();
  const fetchImpl = fakeHelper(state.dir);
  const all = lessons();
  const wakes = timeline(all.length, holdS);
  let monitorChars = 0;
  let drainChars = 0;
  let replyChars = 0;
  let seq = 0;
  const items = [];
  for (const wake of wakes) {
    // The items that landed before this wake.
    wake.items.forEach(function (i) {
      const at = new Date(Date.UTC(2026, 9, 17, 18, 0, i * PACE_S)).toISOString();
      const item = makeRecord(all[i], i, at);
      items[i] = item;
      appendReady(state.log, item, seq++);
    });
    const wakeOut = [];
    await monitor.run(["--session", SESSION, "--state-dir", state.dir], {
      stdout: (t) => wakeOut.push(String(t)),
      stderr: (t) => wakeOut.push(String(t)),
      sameStream: true,
      wait: async () => {},
      statusRun: (args, io) => status.run(args, Object.assign({}, io, { fetch: fetchImpl }))
    });
    const drainOut = [];
    await status.run(["--session", SESSION, "--json", "--quiet", "--state-dir", state.dir], {
      stdout: (t) => drainOut.push(String(t)),
      stderr: (t) => drainOut.push(String(t)),
      fetch: fetchImpl
    });
    monitorChars += wakeOut.join("").length;
    drainChars += drainOut.join("").length;
    if (show) { console.log("--- " + name + " wake at " + wake.at + "s"); console.log(drainOut.join("")); }
    for (const i of wake.items) {
      const out = [];
      await reply.run(
        ["--review", REVIEW, "--item", items[i][record.FIELD.ID], "--rev", "1", "--status", "handled",
         "--agent", "claude", "--text", "Promoted.", "--file", SOURCE, "--state-dir", state.dir],
        { stdout: (t) => out.push(String(t)), stderr: (t) => out.push(String(t)), stdinIsTty: true }
      );
      replyChars += out.join("").length;
    }
  }
  fs.rmSync(state.dir, { recursive: true, force: true });
  return { name: name, lessons: all.length, wakes: wakes.length, monitorChars, drainChars, replyChars };
}

function tokens(chars) { return Math.round(chars / 4); }

async function main() {
  const show = process.argv.indexOf("--show") !== -1;
  const presses = await runScenario("presses", pressRecord, HOLD_S, show);
  const comments = await runScenario("comments", commentRecord, 0, show);
  console.log("lessons: " + presses.lessons + ", pace " + PACE_S + " s, hold " + HOLD_S + " s, poll " + POLL_S + " s, agent work " + WORK_S + " s per wake");
  console.log("");
  console.log("run       wakes  monitor chars  drain chars  reply chars  drain tokens  total tokens");
  [presses, comments].forEach(function (r) {
    const total = r.monitorChars + r.drainChars + r.replyChars;
    console.log(
      r.name.padEnd(9) + String(r.wakes).padStart(6) + String(r.monitorChars).padStart(15) +
      String(r.drainChars).padStart(13) + String(r.replyChars).padStart(13) +
      String(tokens(r.drainChars)).padStart(14) + String(tokens(total)).padStart(14)
    );
  });
  const red = presses.drainChars > comments.drainChars || presses.wakes > comments.wakes;
  console.log("");
  console.log(red ? "RED: presses cost more than comments" : "GREEN: presses cost no more than comments in drain characters and wakes");
  process.exit(red ? 1 : 0);
}

main().catch(function (error) {
  console.error(error);
  process.exit(1);
});
