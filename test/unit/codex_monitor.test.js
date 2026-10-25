"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { execFile } = require("node:child_process");
const monitor = require("../../src/cli/commands/monitor.js");
const status = require("../../src/cli/commands/status.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const stateDir = require("../../src/service/state_dir.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const { pollUntil } = require("../helpers/poll.js");
const CLI = path.resolve(__dirname, "../../bin/lahe.js");
const THREAD = "11111111-2222-3333-4444-555555555555";

function world() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-cx-"));
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_codex" });
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  reviews.create({ id: "r_codex", agent_session_id: "s_codex" });
  const argv = ["--session", "s_codex", "--state-dir", dir];
  return { dir, store, log, reviews, argv };
}

test("Codex delivery retries locally, commits only after acceptance, and fences a queued drain", async () => {
  const w = world();
  w.log.append("r_codex", [protocol.newEvent({ event: protocol.EVENT.REVIEW_ARCHIVED, event_id: "ev_cx_end", review: "r_codex" })]);
  let attempts = 0;
  const code = await monitor.run(w.argv, {
    stdout: () => assert.fail("push mode must not print a second wake"), stderr: () => {}, wait: async () => {},
    deliverWork: async line => {
      attempts += 1;
      assert.match(line, /1 ended review/);
      assert.match(line, /--handoff-rev 0/);
      assert.match(line, /--codex\. End this turn/);
      assert.equal(fs.existsSync(stateDir.endedDeliveredPath(w.dir, "s_codex")), false);
      return attempts === 2;
    }
  });
  assert.equal(code, 0);
  assert.equal(attempts, 2);
  assert.match(fs.readFileSync(stateDir.endedDeliveredPath(w.dir, "s_codex"), "utf8"), /r_codex woke 0/);
  assert.equal(w.store.readMonitor("s_codex"), null);
  const accepted = [];
  assert.equal(await status.run(w.argv.concat(["--json", "--quiet", "--handoff-rev", "0"]), {
    stdout: text => accepted.push(text), stderr: () => {}
  }), 0);
  assert.match(accepted.join(""), /ended_reviews/);
  w.store.takeover("s_codex");
  const stdout = [];
  assert.equal(await status.run(w.argv.concat(["--json", "--quiet", "--handoff-rev", "0"]), {
    stdout: text => stdout.push(text), stderr: () => {}
  }), protocol.CLI_EXIT.SESSION_TAKEN_OVER);
  assert.equal(stdout.join(""), "");
});

test("a failed push does not consume a Library request", async () => {
  const w = world();
  w.store.create({ id: "s_other" });
  w.reviews.create({ id: "r_other", agent_session_id: "s_other" });
  catalogRequests.writeAttach(w.dir, "s_codex", Date.now());
  const queue = catalogRequests.createQueue({ dir: w.dir, writeExpired: true });
  queue.append({ action: "pickup", review: "r_other", session: "s_other", for: "s_codex" }, Date.now());
  let attempts = 0;
  await monitor.run(w.argv, {
    stdout: () => {}, stderr: () => {}, wait: async () => {},
    deliverWork: async line => {
      attempts += 1;
      assert.match(line, /1 Library request/);
      assert.equal(fs.existsSync(stateDir.catalogDeliveredPath(w.dir, "s_codex")), false);
      return attempts === 2;
    }
  });
  assert.equal(attempts, 2);
  assert.ok(fs.existsSync(stateDir.catalogDeliveredPath(w.dir, "s_codex")));
  assert.ok(w.store.readActivity("s_codex"), "an accepted delivery keeps the Library request alive until the agent drains");
  const printed = [];
  await status.run(w.argv.concat(["--json", "--quiet"]), { stdout: text => printed.push(text), stderr: () => {} });
  assert.match(printed.join(""), /catalog_requests/);
});

test("Codex mode refuses missing conversation identity without starting a foreground wait", async () => {
  const w = world();
  const stderr = [];
  assert.equal(await monitor.run(w.argv.concat("--codex"), { env: {}, stderr: text => stderr.push(text) }), 4);
  assert.match(stderr.join(""), /CODEX_THREAD_ID/);
  assert.equal(w.store.readMonitor("s_codex"), null);
});

test("the printed setup instructions release Codex turns and repeated session guards bind correctly", () => {
  const w = world();
  const block = agentSessions.commandBlock({ dir: w.dir, session: "s_codex" });
  assert.match(block, /Codex: add --codex/);
  assert.doesNotMatch(block, /foreground pending exec/);
  const args = monitor.parseArgs(["--session", "s_codex", "--session", "s_other", "--session", "s_codex", "--handoff-rev", "2"]);
  assert.equal(args.handoffRevisions.s_codex, 2);
  assert.equal(args.handoffRevisions.s_other, undefined);
});

test("a takeover during capability checks cannot bind the old conversation to the new revision", async () => {
  const w = world();
  const stderr = [];
  const code = await monitor.run(w.argv.concat("--codex"), {
    env: { CODEX_THREAD_ID: THREAD }, stderr: text => stderr.push(text),
    execFile: async () => "--thread --message",
    probeThread: async () => w.store.takeover("s_codex")
  });
  assert.equal(code, protocol.CLI_EXIT.SESSION_TAKEN_OVER);
  assert.equal(w.store.readMonitor("s_codex"), null);
  assert.match(stderr.join(""), /changed hands/);
});

test("a worker independently refuses a changed startup revision", async () => {
  const w = world();
  w.store.takeover("s_codex");
  assert.equal(await monitor.run(w.argv, { expectedRevisions: { s_codex: 0 }, stderr: () => {} }), protocol.CLI_EXIT.SESSION_TAKEN_OVER);
  assert.equal(w.store.readMonitor("s_codex"), null);
});

test("capability and socket errors fail without a watcher or foreground fallback", async () => {
  for (const cause of ["help", "socket"]) {
    const w = world();
    const errors = [];
    const code = await monitor.run(w.argv.concat("--codex"), {
      env: { CODEX_THREAD_ID: THREAD }, stderr: text => errors.push(text),
      execFile: async () => { if (cause === "help") throw new Error("old CLI"); return "--thread --message"; },
      probeThread: async () => { throw new Error("socket denied"); }
    });
    assert.equal(code, 4);
    assert.equal(w.store.readMonitor("s_codex"), null);
    assert.match(errors.join(""), /No foreground wait was started/);
  }
});

async function fixture(t) {
  const w = world();
  // macOS Unix socket paths have a small fixed limit; TMPDIR can exceed it.
  const home = fs.mkdtempSync(path.join(process.platform === "darwin" ? "/tmp" : os.tmpdir(), "cx-home-"));
  const control = path.join(home, "app-server-control");
  fs.mkdirSync(control, { recursive: true });
  const server = net.createServer(socket => socket.end());
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(path.join(control, "app-server-control.sock"), resolve); });
  const bin = path.join(w.dir, "bin");
  fs.mkdirSync(bin);
  fs.copyFileSync(path.join(__dirname, "../fixtures/codex_queue_cli.js"), path.join(bin, "codex"));
  fs.chmodSync(path.join(bin, "codex"), 0o755);
  const queueLog = path.join(w.dir, "queue.jsonl");
  const fail = path.join(w.dir, "fail");
  const env = { ...process.env, CODEX_HOME: home, CODEX_THREAD_ID: THREAD, PATH: bin + path.delimiter + process.env.PATH,
    LAHE_TEST_CODEX_LOG: queueLog, LAHE_TEST_CODEX_FAIL: fail };
  t.after(async () => {
    for (const id of ["s_codex", "s_added"]) {
      if (!w.store.read(id)) continue;
      w.store.close(id);
      const beat = w.store.readMonitor(id);
      if (beat && beat.pid !== process.pid) { try { process.kill(beat.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; } }
      await pollUntil(() => !w.store.readMonitor(id), { message: "the detached test watcher to stop" });
    }
    await new Promise(resolve => server.close(resolve));
  });
  function run(args = w.argv) {
    return new Promise((resolve, reject) => {
      execFile(process.execPath, [CLI, "monitor", ...args, "--interval", "1"], { env, timeout: 10000 }, (error, stdout, stderr) => {
        if (error) reject(new Error(stderr || error.message));
        else resolve(stdout);
      });
    });
  }
  function queued() { try { return fs.readFileSync(queueLog, "utf8").trim().split("\n").map(JSON.parse); } catch (error) { return []; } }
  return { ...w, env, run, queued, fail };
}

test("Codex CLI returns while idle, queues only real work, and re-arms after a batch", async t => {
  const w = await fixture(t);
  assert.match(await w.run(), /End this turn/);
  const first = w.store.readMonitor("s_codex");
  assert.equal(first.codex_thread, THREAD);
  assert.match(await w.run(), /already active/);
  assert.equal(w.store.readMonitor("s_codex").pid, first.pid);
  await pollUntil(() => w.store.readMonitor("s_codex").at !== first.at, { message: "a second idle poll" });
  assert.deepEqual(w.queued(), [], "idle monitoring never invokes codex queue");
  w.log.append("r_codex", [protocol.newEvent({ event: protocol.EVENT.REVIEW_ARCHIVED, event_id: "ev_cx_native_end", review: "r_codex" })]);
  await pollUntil(() => w.queued().length, { message: "the watcher to queue feedback" });
  await pollUntil(() => !w.store.readMonitor("s_codex"), { message: "the delivered watcher to stop" });
  const args = w.queued()[0];
  assert.deepEqual(args.slice(0, 6), ["queue", "--remote", "unix://", "--thread", THREAD, "--message"]);
  assert.match(args[6], /LAHE ACTION REQUIRED/);
  assert.match(await w.run(), /watcher is active/);
  const next = w.store.readMonitor("s_codex");
  await pollUntil(() => w.store.readMonitor("s_codex").at !== next.at, { message: "the re-armed watcher to poll" });
  assert.equal(w.queued().length, 1, "the same ending does not queue twice");
});

test("adding a session extends the same watcher and delivers that session's work", async t => {
  const w = await fixture(t);
  w.store.create({ id: "s_added" });
  w.reviews.create({ id: "r_added", agent_session_id: "s_added" });
  await Promise.all([w.run(), w.run()]);
  const pid = w.store.readMonitor("s_codex").pid;
  await w.run(w.argv.concat(["--session", "s_added"]));
  await pollUntil(() => w.store.readMonitor("s_added"), { message: "the existing watcher to add its session" });
  assert.equal(w.store.readMonitor("s_added").pid, pid);
  w.log.append("r_added", [protocol.newEvent({ event: protocol.EVENT.REVIEW_ARCHIVED, event_id: "ev_cx_multi2", review: "r_added" })]);
  await pollUntil(() => w.queued().length && !w.store.readMonitor("s_codex") && !w.store.readMonitor("s_added"), { message: "the added session's delivery" });
  assert.equal(w.queued().length, 1);
  assert.match(w.queued()[0][6], /1 ended review/);
  assert.match(w.queued()[0][6], /Drain: lahe status --session s_added/);
  assert.match(w.queued()[0][6], /--session s_codex.*--handoff-rev 0/);
  assert.match(w.queued()[0][6], /--session s_added.*--handoff-rev 0/);
});

test("work already pending in both sessions is coalesced into one queue", async t => {
  const w = await fixture(t);
  w.store.create({ id: "s_added" });
  w.reviews.create({ id: "r_added", agent_session_id: "s_added" });
  // End both before scanning: arrivals between reads can form separate batches.
  w.log.append("r_codex", [protocol.newEvent({ event: protocol.EVENT.REVIEW_ARCHIVED, event_id: "ev_cx_multi1", review: "r_codex" })]);
  w.log.append("r_added", [protocol.newEvent({ event: protocol.EVENT.REVIEW_ARCHIVED, event_id: "ev_cx_multi2", review: "r_added" })]);
  await w.run(w.argv.concat(["--session", "s_added"]));
  await pollUntil(() => w.queued().length && !w.store.readMonitor("s_codex") && !w.store.readMonitor("s_added"), { message: "one combined delivery" });
  assert.equal(w.queued().length, 1);
  assert.match(w.queued()[0][6], /2 ended reviews/);
  assert.match(w.queued()[0][6], /--session s_codex.*--handoff-rev 0/);
  assert.match(w.queued()[0][6], /--session s_added.*--handoff-rev 0/);
});

test("a stale heartbeat pointing at a reused live pid does not prevent startup", async t => {
  const w = await fixture(t);
  w.store.writeMonitor("s_codex", { pid: process.pid, handoff_rev: 0, codex_thread: THREAD, at: "2000-01-01T00:00:00Z" });
  assert.match(await w.run(), /watcher is active/);
  assert.notEqual(w.store.readMonitor("s_codex").pid, process.pid);
});

test("an explicit takeover followed by rearming replaces the old revision's watcher", async t => {
  const w = await fixture(t);
  await w.run();
  const oldPid = w.store.readMonitor("s_codex").pid;
  w.store.takeover("s_codex");
  await w.run();
  await pollUntil(() => w.store.readMonitor("s_codex")?.handoff_rev === 1, { message: "the new revision to be watched" });
  assert.notEqual(w.store.readMonitor("s_codex").pid, oldPid);
  const first = w.store.readMonitor("s_codex").at;
  await pollUntil(() => w.store.readMonitor("s_codex")?.at !== first, { message: "the replacement watcher to remain active" });
  const staleErrors = [];
  assert.equal(await monitor.run(w.argv.concat(["--codex", "--handoff-rev", "0"]), {
    env: w.env, stderr: text => staleErrors.push(text)
  }), 6);
  assert.match(staleErrors.join(""), /stale request/);
});

test("a stale guarded session does not prevent the remaining session from being armed", async t => {
  const w = await fixture(t);
  w.store.create({ id: "s_added" });
  w.reviews.create({ id: "r_added", agent_session_id: "s_added" });
  w.store.takeover("s_codex");
  const output = await w.run(w.argv.concat(["--handoff-rev", "0", "--session", "s_added", "--handoff-rev", "0"]));
  assert.match(output, /watcher is active/);
  assert.equal(w.store.readMonitor("s_codex"), null);
  assert.ok(w.store.readMonitor("s_added"));
});

test("daemon failure leaves an ending pending across a watcher restart", async t => {
  const w = await fixture(t);
  fs.writeFileSync(w.fail, "down");
  w.log.append("r_codex", [protocol.newEvent({ event: protocol.EVENT.REVIEW_ARCHIVED, event_id: "ev_cx_retry_end", review: "r_codex" })]);
  await w.run();
  const logPath = path.join(stateDir.agentSessionDir(w.dir, "s_codex"), "codex-monitor.log");
  await pollUntil(() => fs.readFileSync(logPath, "utf8").includes("feedback remains pending"), { message: "the failed delivery" });
  assert.equal(fs.existsSync(stateDir.endedDeliveredPath(w.dir, "s_codex")), false);
  process.kill(w.store.readMonitor("s_codex").pid, "SIGTERM");
  await pollUntil(() => !w.store.readMonitor("s_codex"), { message: "the failed watcher to stop" });
  fs.renameSync(w.fail, w.fail + ".resolved");
  await w.run();
  await pollUntil(() => w.queued().length, { message: "delivery after the daemon returns" });
  assert.equal(w.queued().length, 1);
});

test("ordinary feedback wakes once per revision and page text stays out of the queued message", async t => {
  const w = await fixture(t);
  const item = record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY,
    note: "Move the explanation above the example", quote: "Untrusted page text", page_origin: "http://127.0.0.1:8000", page_path: "/guide.html", page_seq: 1 });
  function append(rev, eventId) {
    const current = { ...item, rev };
    w.log.append("r_codex", [protocol.newEvent({ event: protocol.EVENT.ITEM_READY, event_id: eventId, review: "r_codex",
      item: item.id, rev, page_path: "/guide.html", page_seq: 1, payload: { draft: false, record: current } })]);
  }
  await w.run();
  append(1, "ev_cx_comment1");
  await pollUntil(() => w.queued().length === 1 && !w.store.readMonitor("s_codex"), { message: "the first comment wake" });
  assert.match(w.queued()[0][6], /1 item waiting/);
  assert.doesNotMatch(w.queued()[0][6], /Untrusted page text|Move the explanation/);
  await w.run();
  const armed = w.store.readMonitor("s_codex").at;
  await pollUntil(() => w.store.readMonitor("s_codex")?.at !== armed, { message: "an idle poll past already delivered feedback" });
  assert.equal(w.queued().length, 1);
  append(2, "ev_cx_comment2");
  await pollUntil(() => w.queued().length === 2 && !w.store.readMonitor("s_codex"), { message: "the reworded comment wake" });
});
