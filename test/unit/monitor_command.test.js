"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const monitor = require("../../src/cli/commands/monitor.js");
const protocol = require("../../src/shared/protocol.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const stateDir = require("../../src/service/state_dir.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-monitor-"));
}

test("monitor requires a session id and a sane interval", async () => {
  const stderr = [];
  const missing = await monitor.run([], { stderr: (text) => stderr.push(text) });
  assert.equal(missing, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(stderr.join(""), /--session is required/);

  const badInterval = monitor.parseArgs(["--session", "s_owner", "--interval", "0"]);
  assert.match(badInterval.error, /--interval must be an integer/);

  // The seen file is gone from the doctrine but still accepted, so an agent
  // reading an older doc is not failed on a flag whose absence changes nothing.
  const legacy = monitor.parseArgs(["--session", "s_owner", "--seen-file", "/tmp/seen"]);
  assert.equal(legacy.error, null);
  assert.equal(legacy.session, "s_owner");
});

test("idle polls stay local until work appears, then monitor prints once and exits", async () => {
  const stdout = [];
  const stderr = [];
  const calls = [];
  const waits = [];
  let count = 0;

  const code = await monitor.run([
    "--session", "s_owner",
    "--interval", "7"
  ], {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    readSession: () => ({ id: "s_owner", handoff_rev: 0, closed_at: null }),
    statusRun: async (args, io) => {
      calls.push(args);
      count += 1;
      if (count === 3) io.stdout('{"review":"r_one","id":"c_one","rev":1}\n');
      return protocol.CLI_EXIT.OK;
    },
    wait: async (ms) => waits.push(ms)
  });

  assert.equal(code, protocol.CLI_EXIT.OK);
  assert.equal(calls.length, 3);
  assert.deepEqual(waits, [7000, 7000]);

  const printed = stdout.join("");
  // The banner is on STDOUT, ahead of the items. A host that captures one
  // stream used to get the instruction without the work.
  assert.ok(printed.startsWith(monitor.ACTION_REQUIRED), "the banner leads stdout");
  assert.match(printed, /\{"review":"r_one","id":"c_one","rev":1\}/);
  // The stderr copy is kept for hosts that surface only that stream.
  assert.match(stderr.join(""), /LAHE ACTION REQUIRED/);

  // The exact next commands, printed where the agent is already looking.
  assert.match(printed, /lahe status --session s_owner --json --quiet/);
  assert.match(printed, /lahe monitor --session s_owner/);
  assert.match(printed, /repeat until it prints no items/);

  // The drain command the monitor runs is the same one it prints.
  calls.forEach((args) => {
    assert.deepEqual(args, ["--session", "s_owner", "--json", "--quiet"]);
  });
});

test("a closed session exits with SESSION_CLOSED off the real session record", async () => {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir: dir });
  const created = store.create({ id: "s_closed" });
  store.close(created.id);

  const stderr = [];
  let polled = false;
  let waited = false;
  const code = await monitor.run(["--session", "s_closed"], {
    stderr: (text) => stderr.push(text),
    store: () => store,
    statusRun: async () => { polled = true; return protocol.CLI_EXIT.OK; },
    wait: async () => { waited = true; }
  });

  assert.equal(code, protocol.CLI_EXIT.SESSION_CLOSED);
  assert.equal(polled, false, "a closed session is never polled");
  assert.equal(waited, false);
  assert.match(stderr.join(""), /monitoring has ended/);
  assert.match(stderr.join(""), /do not relaunch/);
});

test("a session closed mid-loop exits SESSION_CLOSED rather than polling forever", async () => {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir: dir });
  store.create({ id: "s_live" });

  const stderr = [];
  let polls = 0;
  const code = await monitor.run(["--session", "s_live"], {
    stderr: (text) => stderr.push(text),
    store: () => store,
    statusRun: async () => {
      polls += 1;
      if (polls === 1) store.close("s_live");
      return protocol.CLI_EXIT.OK;
    },
    wait: async () => {}
  });

  assert.equal(code, protocol.CLI_EXIT.SESSION_CLOSED);
  assert.equal(polls, 1);
  assert.match(stderr.join(""), /monitoring has ended/);
});

test("takeover fences the old monitor before it can deliver another agent's work", async () => {
  const stdout = [];
  const stderr = [];
  let reads = 0;
  const code = await monitor.run(["--session", "s_owner"], {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    readSession: () => ({ id: "s_owner", closed_at: null, handoff_rev: reads++ < 2 ? 0 : 1 }),
    statusRun: async (_args, io) => {
      io.stdout('{"review":"r_one","id":"c_new","rev":1}\n');
      return protocol.CLI_EXIT.OK;
    }
  });

  assert.equal(code, protocol.CLI_EXIT.SESSION_TAKEN_OVER);
  assert.equal(stdout.join(""), "", "work captured after takeover is never delivered to the old agent");
  assert.match(stderr.join(""), /was taken over/);
  assert.match(stderr.join(""), /do not relaunch/);
});

test("every loop writes a heartbeat carrying the pid and the handoff rev", async () => {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir: dir });
  store.create({ id: "s_beat" });

  let polls = 0;
  const code = await monitor.run(["--session", "s_beat"], {
    stdout: () => {},
    stderr: () => {},
    store: () => store,
    pid: 4242,
    statusRun: async (_args, io) => {
      polls += 1;
      if (polls === 2) io.stdout('{"review":"r","id":"c","rev":1}\n');
      return protocol.CLI_EXIT.OK;
    },
    wait: async () => {}
  });

  assert.equal(code, protocol.CLI_EXIT.OK);
  assert.equal(polls, 2);
  const beat = JSON.parse(fs.readFileSync(stateDir.monitorPath(dir, "s_beat"), "utf8"));
  assert.equal(beat.pid, 4242);
  assert.equal(beat.handoff_rev, 0);
  assert.ok(beat.at, "the heartbeat carries when the loop last ran");
});

test("a second monitor refuses to start while a live one holds the same rev", async () => {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir: dir });
  store.create({ id: "s_dup" });
  // This process is alive by definition, so it stands in for the live monitor.
  store.writeMonitor("s_dup", { pid: process.pid, handoff_rev: 0 });

  const stderr = [];
  let polled = false;
  const code = await monitor.run(["--session", "s_dup"], {
    stderr: (text) => stderr.push(text),
    store: () => store,
    pid: process.pid + 1,
    statusRun: async () => { polled = true; return protocol.CLI_EXIT.OK; },
    wait: async () => {}
  });

  assert.equal(code, protocol.CLI_EXIT.BAD_USAGE);
  assert.equal(polled, false);
  assert.match(stderr.join(""), new RegExp("already has a live monitor \\(pid " + process.pid + "\\)"));
});

test("a stale heartbeat, a dead pid, and an older rev are all overwritten rather than obeyed", async () => {
  const nowMs = Date.parse("2026-08-18T12:00:00.000Z");
  const fresh = new Date(nowMs - 1000).toISOString();
  const stale = new Date(nowMs - protocol.MONITOR.HEARTBEAT_FRESH_MS - 1000).toISOString();

  // Stale: the loop stopped writing, so the process is gone.
  assert.equal(
    monitor.liveDuplicate({ pid: process.pid, handoff_rev: 0, at: stale }, 0, nowMs, process.pid + 1),
    null
  );
  // Dead pid: fresh file, no process. A crashed monitor must not block its own
  // replacement.
  assert.equal(
    monitor.liveDuplicate({ pid: 2147483646, handoff_rev: 0, at: fresh }, 0, nowMs, process.pid),
    null
  );
  // Older rev: a pre-takeover monitor, already fenced. Not a duplicate.
  assert.equal(
    monitor.liveDuplicate({ pid: process.pid, handoff_rev: 0, at: fresh }, 1, nowMs, process.pid + 1),
    null
  );
  // Our own pid: a relaunch in the same process is not a second monitor.
  assert.equal(
    monitor.liveDuplicate({ pid: process.pid, handoff_rev: 0, at: fresh }, 0, nowMs, process.pid),
    null
  );
  // All three conditions together: a genuine duplicate.
  assert.equal(
    monitor.liveDuplicate({ pid: process.pid, handoff_rev: 0, at: fresh }, 0, nowMs, process.pid + 1),
    process.pid
  );
});

test("the usage text names every exit code a host has to act on", () => {
  assert.match(monitor.USAGE, new RegExp("\\s" + protocol.CLI_EXIT.SESSION_CLOSED + "\\s+the agent session is closed"));
  assert.match(monitor.USAGE, new RegExp("\\s" + protocol.CLI_EXIT.SESSION_TAKEN_OVER + "\\s+another agent took"));
  assert.doesNotMatch(monitor.USAGE, /--seen-file/, "the usage no longer teaches a ledger");
});
