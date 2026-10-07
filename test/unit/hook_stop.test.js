// `lahe hook stop`: Claude Code's Stop hook (docs/features/20261006.02_rearm_guard).
//
// Claude Code runs it each time the main agent tries to end its turn. It blocks
// that stop, once, when a Lahe session this agent started is open and has no
// live monitor, and hands the agent the exact command to restart the watcher.
// Everything else, errors included, is silence and exit 0.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const hook = require("../../src/cli/commands/hook.js");
const cli = require("../../src/cli/index.js");
const protocol = require("../../src/shared/protocol.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const stateDirModule = require("../../src/service/state_dir.js");
const reviewFormat = require("../../src/shared/review_format.js");

const REPO = path.join(__dirname, "..", "..");
const OURS = "s_0123456789abcdef";
const OTHER = "s_fedcba9876543210";

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || "lahe-hook-"));
}

// A transcript line the way Claude Code writes one: JSON, so the review's own
// output sits inside an escaped string.
function toolResultLine(text) {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: text }] }
  }) + "\n";
}

function toolUseLine(command) {
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content: [{ type: "tool_use", id: "toolu_2", name: "Bash", input: { command: command } }] }
  }) + "\n";
}

// What `lahe review` prints for a session in the default state directory.
function reviewOutput(id) {
  return agentSessions.commandBlock({ dir: stateDirModule.stateDir({ allowInsideCheckout: true }), session: id });
}

function world(options) {
  const opts = options || {};
  const dir = tempDir("lahe-hook-state-");
  const store = agentSessions.createStore({ dir });
  store.create({ id: OURS });
  const transcript = path.join(tempDir("lahe-hook-transcript-"), "session.jsonl");
  const lines = opts.lines || [toolUseLine("lahe review notes.md"), toolResultLine(reviewOutput(OURS))];
  fs.writeFileSync(transcript, lines.join(""));
  return { dir, store, transcript };
}

function input(w, extra) {
  return JSON.stringify(Object.assign({
    session_id: "claude-session-1",
    transcript_path: w.transcript,
    cwd: "/tmp",
    hook_event_name: "Stop",
    last_assistant_message: "Done.",
    stop_hook_active: false
  }, extra || {}));
}

async function runHook(w, stdin, extra) {
  const out = [];
  const err = [];
  const code = await hook.run(["stop", "--state-dir", w.dir], Object.assign({
    stdin: stdin,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    env: {}
  }, extra || {}));
  return { code, stdout: out.join(""), stderr: err.join("") };
}

function liveHeartbeat(w, id, rev) {
  w.store.writeMonitor(id, { pid: process.pid, handoff_rev: rev || 0, at: new Date().toISOString() });
}

test("an open session this agent started, with no live monitor, blocks once with the exact command", async () => {
  const w = world();
  const result = await runHook(w, input(w));
  assert.equal(result.code, 0);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.decision, "block");
  assert.match(parsed.reason, new RegExp("lahe monitor --session " + OURS + " --state-dir " + w.dir.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")));
  assert.match(parsed.reason, /run_in_background/);
  assert.match(parsed.reason, /timeout 7200000/);
});

test("the timeout in the reason follows BASH_MAX_TIMEOUT_MS when it allows more than two hours", async () => {
  const w = world();
  const raised = JSON.parse((await runHook(w, input(w), { env: { BASH_MAX_TIMEOUT_MS: "86400000" } })).stdout);
  assert.match(raised.reason, /timeout 86400000/);
  const lower = JSON.parse((await runHook(w, input(w), { env: { BASH_MAX_TIMEOUT_MS: "60000" } })).stdout);
  assert.match(lower.reason, /timeout 7200000/, "a lower or default limit leaves the two-hour maximum");
  const junk = JSON.parse((await runHook(w, input(w), { env: { BASH_MAX_TIMEOUT_MS: "lots" } })).stdout);
  assert.match(junk.reason, /timeout 7200000/);
});

test("stop_hook_active true never blocks: at most one block per turn", async () => {
  const w = world();
  const result = await runHook(w, input(w, { stop_hook_active: true }));
  assert.equal(result.code, 0);
  assert.equal(result.stdout, "");
});

test("a session with a live monitor is not blocked", async () => {
  const w = world();
  liveHeartbeat(w, OURS, 0);
  const result = await runHook(w, input(w));
  assert.equal(result.stdout, "");
});

test("a heartbeat from a dead pid, or at another handoff rev, does not count as a live monitor", async () => {
  const w = world();
  w.store.writeMonitor(OURS, { pid: 2147483646, handoff_rev: 0, at: new Date().toISOString() });
  assert.equal(JSON.parse((await runHook(w, input(w))).stdout).decision, "block", "dead pid");
  w.store.writeMonitor(OURS, { pid: process.pid, handoff_rev: 3, at: new Date().toISOString() });
  assert.equal(JSON.parse((await runHook(w, input(w))).stdout).decision, "block", "a fenced older rev");
});

test("after sleep, a stale heartbeat at this rev from a live pid still counts as watching", async () => {
  // The machine slept: the monitor is alive but has not looped, so its
  // heartbeat is older than HEARTBEAT_FRESH_MS. Blocking here would start a
  // second monitor beside the one that is about to wake.
  const w = world();
  w.store.writeMonitor(OURS, { pid: process.pid, handoff_rev: 0, at: new Date(Date.now() - 2 * 60 * 1000).toISOString() });
  assert.equal((await runHook(w, input(w))).stdout, "");
});

test("lahe library --json's started-for-this-agent output proves ownership", async () => {
  const json = JSON.stringify({ url: "http://127.0.0.1:4789/catalog", attached: null, helper_started: false, session: OURS, session_created: true });
  const w = world({ lines: [toolUseLine("lahe library --json"), toolResultLine(json + "\n")] });
  assert.match(JSON.parse((await runHook(w, input(w))).stdout).reason, new RegExp("--session " + OURS));
  const attachedOnly = JSON.stringify({ url: "u", attached: null, helper_started: false, session: OURS, session_created: false });
  const w2 = world({ lines: [toolResultLine(attachedOnly + "\n")] });
  assert.equal((await runHook(w2, input(w2))).stdout, "", "session_created false is not proof");
});

test("a refused default state directory does not silence a session under an explicit --state-dir", async () => {
  const w = world();
  const printed = agentSessions.commandBlock({ dir: w.dir, session: OURS });
  fs.writeFileSync(w.transcript, toolResultLine(printed));
  const out = [];
  const code = await hook.run(["stop"], {
    stdin: input(w),
    stdout: (text) => out.push(text),
    stderr: () => {},
    env: { LAHE_STATE_DIR: path.join(REPO, "inside-a-checkout") }
  });
  assert.equal(code, 0);
  assert.match(JSON.parse(out.join("")).reason, new RegExp("--session " + OURS));
});

test("a closed session is not blocked (the monitor exited 5)", async () => {
  const w = world();
  w.store.close(OURS);
  assert.equal((await runHook(w, input(w))).stdout, "");
});

test("a session another agent took over is not blocked (the monitor exited 6)", async () => {
  const w = world();
  w.store.takeover(OURS);
  assert.equal((await runHook(w, input(w))).stdout, "");
});

test("a session this agent took over itself is still its own", async () => {
  const w = world({
    lines: [
      toolUseLine("lahe session takeover " + OTHER),
      toolResultLine(
        "agent session " + OTHER + " taken over explicitly; shared helper already running\n" +
          "  handoff   1  (older lahe monitor processes exit with 6)\n" +
          "  catch-up  lahe status --session " + OTHER + " --json\n" +
          reviewOutput(OTHER)
      )
    ]
  });
  w.store.create({ id: OTHER });
  w.store.takeover(OTHER);
  const blocked = JSON.parse((await runHook(w, input(w))).stdout);
  assert.match(blocked.reason, new RegExp("--session " + OTHER));
  // Taken over again by somebody else: rev 2 is not the rev this agent took.
  w.store.takeover(OTHER);
  assert.equal((await runHook(w, input(w))).stdout, "");
});

test("a session whose every review the reviewer ended is not blocked", async () => {
  const w = world();
  const review = "rv_ended1";
  const reviewDir = path.join(w.dir, "reviews", review);
  fs.mkdirSync(reviewDir, { recursive: true });
  fs.writeFileSync(path.join(reviewDir, "meta.json"), JSON.stringify({ agent_session_id: OURS }));
  // review.json exactly as the helper writes it: the projection nests ended_at
  // under `review`, and a hand-written top-level field would hide a wrong read.
  const projected = (endedAt) => reviewFormat.stringifyReview(reviewFormat.projectReview({
    id: review, items: [], agent_session_id: OURS, started_at: "2026-10-06T11:00:00.000Z", ended_at: endedAt
  }));
  fs.writeFileSync(path.join(reviewDir, "review.json"), projected(null));
  assert.equal(JSON.parse((await runHook(w, input(w))).stdout).decision, "block", "a live review still needs watching");
  fs.writeFileSync(path.join(reviewDir, "review.json"), projected("2026-10-06T12:00:00.000Z"));
  assert.equal((await runHook(w, input(w))).stdout, "");
});

test("a session the transcript never mentions is ignored, and so is an id that only appears in passing", async () => {
  const w = world({
    lines: [
      toolResultLine("  \"agent_session_id\": \"" + OTHER + "\",\n"),
      toolResultLine(OTHER + "  open  handoff 0  reviews 1  unanswered 0  no watcher\n")
    ]
  });
  w.store.create({ id: OTHER });
  assert.equal((await runHook(w, input(w))).stdout, "", "neither OURS (never mentioned) nor OTHER (only read about)");
});

test("several unwatched sessions go into one monitor command", async () => {
  const w = world({
    lines: [
      toolResultLine(reviewOutput(OURS)),
      toolUseLine("lahe monitor --session " + OTHER)
    ]
  });
  w.store.create({ id: OTHER });
  const parsed = JSON.parse((await runHook(w, input(w))).stdout);
  assert.match(parsed.reason, /lahe monitor --session s_[0-9a-f]{16} --session s_[0-9a-f]{16}/);
  assert.ok(parsed.reason.indexOf(OURS) !== -1 && parsed.reason.indexOf(OTHER) !== -1);
});

test("a session not in the state directory is ignored", async () => {
  const w = world({ lines: [toolUseLine("lahe monitor --session " + OTHER)] });
  assert.equal((await runHook(w, input(w))).stdout, "");
});

test("bad JSON, a missing transcript, and an unreadable state never block and print nothing", async () => {
  const w = world();
  for (const stdin of ["", "not json", "[]", "null", JSON.stringify({ stop_hook_active: false })]) {
    const result = await runHook(w, stdin);
    assert.equal(result.code, 0, stdin);
    assert.equal(result.stdout + result.stderr, "", stdin);
  }
  const missing = await runHook(w, input(w, { transcript_path: path.join(w.dir, "nope.jsonl") }));
  assert.equal(missing.code, 0);
  assert.equal(missing.stdout + missing.stderr, "");

  fs.writeFileSync(stateDirModule.agentSessionPath(w.dir, OURS), "{ not json");
  const broken = await runHook(w, input(w));
  assert.equal(broken.code, 0);
  assert.equal(broken.stdout + broken.stderr, "");

  const noState = await hook.run(["stop", "--state-dir", path.join(REPO, "inside-a-checkout")], {
    stdin: input(w), stdout: () => assert.fail("printed"), stderr: () => assert.fail("printed"), env: {}
  });
  assert.equal(noState, 0, "a refused state directory is silence too");
});

test("unknown hook events print nothing", async () => {
  const w = world();
  const result = await hook.run(["subagent-stop", "--state-dir", w.dir], {
    stdin: input(w), stdout: () => assert.fail("printed"), stderr: () => {}, env: {}
  });
  assert.equal(result, 0);
});

test("the dispatcher routes `lahe hook`", () => {
  assert.ok(cli.COMMAND_NAMES.indexOf("hook") !== -1);
  assert.match(cli.USAGE, /\bhook\b/);
});

test("the transcript scan reads the last 32 MB at most, from the end", () => {
  // Bounded work instead of a wall-clock assertion, which would flake on CI.
  assert.equal(hook.TRANSCRIPT_CAP_BYTES, 32 * 1024 * 1024);
  const w = world({ lines: [] });
  const filler = toolResultLine("x".repeat(4000)).repeat(16);
  const fd = fs.openSync(w.transcript, "w");
  fs.writeSync(fd, toolUseLine("lahe monitor --session " + OTHER)); // the start, past the cap
  for (let i = 0; i < 8; i += 1) fs.writeSync(fd, filler);
  fs.writeSync(fd, toolUseLine("lahe monitor --session " + OURS)); // the end
  fs.closeSync(fd);
  const size = fs.statSync(w.transcript).size;
  const cap = Math.floor(size / 2);
  assert.deepEqual(Array.from(hook.scanTranscript(w.transcript, { capBytes: cap }).keys()), [OURS], "only the last cap bytes are read");
  assert.deepEqual(Array.from(hook.scanTranscript(w.transcript, { capBytes: size }).keys()).sort(), [OURS, OTHER].sort());
});

test("a match that straddles a chunk boundary is still found", () => {
  const w = world({ lines: [] });
  const line = toolUseLine("lahe monitor --session " + OURS);
  const at = line.indexOf(OURS) + 5;
  const filler = "y".repeat(hook.CHUNK_BYTES - at) + "\n";
  // The chunk boundary falls inside the id when read from the end.
  fs.writeFileSync(w.transcript, line + filler);
  assert.deepEqual(Array.from(hook.scanTranscript(w.transcript).keys()), [OURS]);
});

test("end to end through bin/lahe.js: stdin in, block JSON out, exit 0", () => {
  const w = world();
  const ran = childProcess.spawnSync(process.execPath, [path.join(REPO, "bin", "lahe.js"), "hook", "stop", "--state-dir", w.dir], {
    input: input(w),
    encoding: "utf8",
    env: Object.assign({}, process.env, { BASH_MAX_TIMEOUT_MS: "" })
  });
  assert.equal(ran.status, 0, ran.stderr);
  assert.equal(ran.stderr, "");
  assert.equal(JSON.parse(ran.stdout).decision, "block");

  const quiet = childProcess.spawnSync(process.execPath, [path.join(REPO, "bin", "lahe.js"), "hook", "stop", "--state-dir", w.dir], {
    input: "garbage", encoding: "utf8"
  });
  assert.equal(quiet.status, 0);
  assert.equal(quiet.stdout + quiet.stderr, "");
});

test("the block reason is exactly the text the docs show", () => {
  assert.equal(
    hook.blockReason([{ id: OURS, stateDir: null }], 7200000),
    "Lahe: nothing is watching your review session " + OURS + ", so the reviewer's next comment will go unanswered. " +
      "Before you end this turn, start the watcher again with the Bash tool, run_in_background true and timeout 7200000:\n\n" +
      "  lahe monitor --session " + OURS + "\n\n" +
      "Run only that one command; there is no need to drain or to message the reviewer first. " +
      "If the human has said this review is over, close the session instead with lahe session close " + OURS + ". " +
      "If the session is not yours, say so in one line and end your turn."
  );
  assert.equal(protocol.monitorCommand([OURS], null), "lahe monitor --session " + OURS);
});
