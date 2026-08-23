// `lahe session list`: the read-only discovery command.
//
// A human said "claim the lahe sessions" and the agent had no id, so it went
// looking through its HOST's sessions instead (2026-08-20). These tests pin the
// command that answers the question: what agent sessions exist here, which are
// open, how much work is waiting in each, and is anybody watching.
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
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const agentSessionsModule = require("../../src/service/agent_sessions.js");
const sessionCommand = require("../../src/cli/commands/session.js");

function tempState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-session-list-"));
}

function anItem(note, state) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: state,
    note: note,
    page_origin: "http://127.0.0.1:8000",
    page_path: "/report.html",
    page_seq: 1
  });
}

function itemEvent(reviewId, item) {
  return protocol.newEvent({
    event: protocol.EVENT.ITEM_READY,
    event_id: "ev_" + Math.random().toString(16).slice(2),
    review: reviewId,
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    page_path: item[record.FIELD.PAGE_PATH],
    page_seq: item[record.FIELD.PAGE_SEQ],
    payload: { draft: false, record: item }
  });
}

async function runList(args, opts) {
  const out = [];
  const err = [];
  const code = await sessionCommand.run(
    args,
    Object.assign({ stdout: (text) => out.push(text), stderr: (text) => err.push(text) }, opts || {})
  );
  return { code, stdout: out.join(""), stderr: err.join("") };
}

function lineFor(stdout, id) {
  return stdout.split("\n").find((line) => line.indexOf(id) === 0);
}

test("an empty state directory lists no sessions and is not an error", async () => {
  const dir = tempState();
  const listed = await runList(["list", "--state-dir", dir]);
  assert.equal(listed.code, protocol.CLI_EXIT.OK);
  assert.match(listed.stdout, /no agent sessions/);
  assert.equal(listed.stderr, "");
  // No sessions means nothing to claim, so the takeover hint stays quiet.
  assert.equal(listed.stdout.includes("takeover"), false);
});

test("list prints open and closed sessions with their reviews, work, and watcher", async () => {
  const dir = tempState();
  const sessions = agentSessionsModule.createStore({ dir });
  sessions.create({ id: "s_open" });
  sessions.create({ id: "s_shut" });
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  reviews.create({ id: "r_one", agent_session_id: "s_open" });
  reviews.create({ id: "r_two", agent_session_id: "s_open" });
  reviews.create({ id: "r_old", agent_session_id: "s_shut" });

  log.append("r_one", [itemEvent("r_one", anItem("fix the heading", record.STATE.READY))]);
  log.append("r_two", [itemEvent("r_two", anItem("tighten the intro", record.STATE.READY))]);
  log.append("r_two", [itemEvent("r_two", anItem("cut the last line", record.STATE.READY))]);
  // Not work: the reviewer is still holding this one.
  log.append("r_old", [itemEvent("r_old", anItem("still mine", record.STATE.NOT_HANDLED))]);
  sessions.close("s_shut");

  const listed = await runList(["list", "--state-dir", dir]);
  assert.equal(listed.code, protocol.CLI_EXIT.OK, listed.stderr);

  const openLine = lineFor(listed.stdout, "s_open");
  assert.match(openLine, /\bopen\b/);
  assert.match(openLine, /handoff 0/);
  assert.match(openLine, /reviews 2/);
  assert.match(openLine, /unanswered 3/);
  assert.match(openLine, /no watcher/);

  const shutLine = lineFor(listed.stdout, "s_shut");
  assert.match(shutLine, /closed \d{4}-\d{2}-\d{2}T/, "a closed session says when it closed");
  assert.match(shutLine, /reviews 1/);
  assert.match(shutLine, /unanswered 0/);

  assert.match(listed.stdout, /claim one with: lahe session takeover <id> \(requires the human's explicit request\)/);
});

test("list sorts open sessions first, then newest activity first", async () => {
  const dir = tempState();
  const sessions = agentSessionsModule.createStore({ dir });
  sessions.create({ id: "s_older" });
  sessions.create({ id: "s_newer" });
  sessions.create({ id: "s_gone" });
  sessions.close("s_gone");
  // The newer session's activity stamp is what puts it first, not its id: the
  // ids here sort the other way round on purpose.
  fs.writeFileSync(
    path.join(dir, "agent-sessions", "s_older", "activity.json"),
    JSON.stringify({ at: "2026-08-19T00:00:00.000Z" })
  );
  fs.writeFileSync(
    path.join(dir, "agent-sessions", "s_newer", "activity.json"),
    JSON.stringify({ at: "2026-08-20T00:00:00.000Z" })
  );

  const rows = sessionCommand.collect({ dir, nowMs: Date.parse("2026-08-20T01:00:00.000Z") });
  assert.deepEqual(rows.map((row) => row.id), ["s_newer", "s_older", "s_gone"]);
});

test("the watcher column reports listening, nobody, or that it could not tell", async () => {
  // THE OPERATOR'S COLUMN, not the reviewer's line. Here the plumbing is the
  // point: this is how a human finds the session whose agent wandered off. The
  // rail says how long it has been since a reply and never mentions watchers.
  const dir = tempState();
  const sessions = agentSessionsModule.createStore({ dir });
  sessions.create({ id: "s_watched" });
  sessions.create({ id: "s_none" });
  const nowMs = Date.parse("2026-08-20T12:00:00.000Z");
  // A heartbeat with a pid that really exists, so the pid check passes.
  sessions.writeMonitor("s_watched", { pid: process.pid, handoff_rev: 0, at: "2026-08-20T11:59:55.000Z" });

  const rows = sessionCommand.collect({ dir, nowMs });
  const by = {};
  rows.forEach((row) => { by[row.id] = row; });
  assert.equal(sessionCommand.watcherText(by.s_watched, nowMs), "listening");
  // Nothing holds the feed open and there is no heartbeat. The probe has not
  // been warmed in this process, so the honest word is that we cannot tell.
  assert.equal(sessionCommand.watcherText(by.s_none, nowMs), "watcher unknown");

  // A heartbeat whose process is gone is not a watcher, however fresh it is.
  sessions.writeMonitor("s_none", { pid: 424242, handoff_rev: 0, at: "2026-08-20T11:59:55.000Z" });
  const refreshed = sessionCommand.collect({ dir, nowMs });
  const gone = refreshed.filter((row) => row.id === "s_none")[0];
  assert.notEqual(sessionCommand.watcherText(gone, nowMs), "listening");
});

test("--json prints one object per session and one summary line", async () => {
  const dir = tempState();
  const sessions = agentSessionsModule.createStore({ dir });
  sessions.create({ id: "s_json" });
  sessions.create({ id: "s_json_closed" });
  sessions.close("s_json_closed");
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  reviews.create({ id: "r_json", agent_session_id: "s_json" });
  log.append("r_json", [itemEvent("r_json", anItem("one job", record.STATE.READY))]);

  const listed = await runList(["list", "--json", "--state-dir", dir]);
  assert.equal(listed.code, protocol.CLI_EXIT.OK, listed.stderr);
  const lines = listed.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 3);

  const first = lines[0];
  assert.equal(first.id, "s_json");
  assert.equal(first.open, true);
  assert.equal(first.closed_at, null);
  assert.equal(first.handoff_rev, 0);
  assert.equal(first.reviews, 1);
  assert.equal(first.unanswered_ready, 1);
  // Work nobody has answered, in a state directory nothing on this machine is
  // watching. Either word is honest: `no_agent` where the machine can be asked
  // whether anything holds the wake feed open (the CLI warms that probe before
  // it reads), and `waiting` where it cannot be asked at all.
  assert.ok(
    [protocol.AGENT_LIVENESS.STATE.WAITING, protocol.AGENT_LIVENESS.STATE.NO_AGENT].indexOf(
      first.liveness[protocol.AGENT_LIVENESS.FIELD.STATE]
    ) !== -1,
    "unanswered work is waiting, or waiting on nobody"
  );
  assert.notEqual(first.liveness[protocol.AGENT_LIVENESS.FIELD.LISTENING], true);
  assert.equal(first.liveness[protocol.AGENT_LIVENESS.FIELD.LAST_REPLY_AT], null);

  const summary = lines[2];
  assert.deepEqual(summary, { sessions: 2, open: 1, unanswered_ready: 1, state_dir: dir });
  // Machine output stays machine output: the human hint is not in it.
  assert.equal(listed.stdout.includes("claim one with"), false);
});

test("list takes no id and no --port, and --json is refused on the write actions", async () => {
  assert.equal(sessionCommand.parse(["list"]).action, "list");
  assert.equal(sessionCommand.parse(["list"]).id, null);
  assert.equal(sessionCommand.parse(["list", "--json"]).json, true);
  assert.match(sessionCommand.parse(["list", "--port", "9999"]).error, /no --port/);
  assert.match(sessionCommand.parse(["takeover", "s_x", "--json"]).error, /--json is only for/);
  assert.match(sessionCommand.parse(["bogus", "s_x"]).error, /expected list, close, reopen, or takeover/);
});

test("a takeover handoff shows up in the list's handoff column", async () => {
  const dir = tempState();
  const sessions = agentSessionsModule.createStore({ dir });
  sessions.create({ id: "s_handed" });
  sessions.takeover("s_handed");
  const listed = await runList(["list", "--state-dir", dir]);
  assert.match(lineFor(listed.stdout, "s_handed"), /handoff 1/);
});
