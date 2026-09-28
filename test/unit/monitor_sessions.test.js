// `lahe monitor --session a --session b`: one monitor watching several sessions
// (LAHE Library, Task 1.4, architecture "Watching several sessions").
//
// After a Library pick-up the agent owns two sessions: its own and the
// document's. One monitor watches both, so the agent never runs two.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const monitor = require("../../src/cli/commands/monitor.js");
const protocol = require("../../src/shared/protocol.js");
const agentSessions = require("../../src/service/agent_sessions.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-monitor-multi-"));
}

function sessionOf(args) {
  return args[args.indexOf("--session") + 1];
}

function world() {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_a" });
  store.create({ id: "s_b" });
  return { dir, store };
}

test("--session may be given more than once", () => {
  const parsed = monitor.parseArgs(["--session", "s_a", "--session", "s_b"]);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.sessions, ["s_a", "s_b"]);
  assert.equal(parsed.session, "s_a", "the first one is the primary");
  const repeated = monitor.parseArgs(["--session", "s_a", "--session", "s_a"]);
  assert.deepEqual(repeated.sessions, ["s_a"], "a repeated id is watched once");
  assert.match(monitor.parseArgs(["--session", "s_a", "--session", "../x"]).error, /safe id/);
});

test("a heartbeat goes into every watched session, each with its own rev and primary naming the first", async () => {
  const w = world();
  w.store.takeover("s_b"); // s_b is at handoff_rev 1, s_a at 0
  let seen = null;
  const code = await monitor.run(["--session", "s_a", "--session", "s_b", "--state-dir", w.dir], {
    stdout: () => {},
    stderr: () => {},
    pid: 777,
    statusRun: async (args, io) => {
      if (!seen) {
        seen = {
          a: w.store.readMonitor("s_a"),
          b: w.store.readMonitor("s_b")
        };
      }
      if (sessionOf(args) === "s_b") io.stdout('{"review":"r_b","id":"c_b","rev":1}\n');
      return protocol.CLI_EXIT.OK;
    },
    wait: async () => {}
  });
  assert.equal(code, protocol.CLI_EXIT.OK);
  const field = protocol.MONITOR.HEARTBEAT_FIELD;
  assert.equal(seen.a[field.PID], 777);
  assert.equal(seen.a[field.HANDOFF_REV], 0);
  assert.equal(seen.a[field.PRIMARY], "s_a");
  assert.equal(seen.b[field.PID], 777);
  assert.equal(seen.b[field.HANDOFF_REV], 1);
  assert.equal(seen.b[field.PRIMARY], "s_a");
  // A work exit takes every heartbeat down, so the relaunch is not refused.
  assert.equal(w.store.readMonitor("s_a"), null);
  assert.equal(w.store.readMonitor("s_b"), null);
});

test("work in either session exits 0, with the drain for that session and a relaunch naming both", async () => {
  const w = world();
  const stdout = [];
  const polled = [];
  const code = await monitor.run(["--session", "s_a", "--session", "s_b", "--state-dir", w.dir], {
    stdout: (text) => stdout.push(text),
    stderr: () => {},
    statusRun: async (args, io) => {
      polled.push(sessionOf(args));
      if (sessionOf(args) === "s_b" && polled.length > 2) io.stdout('{"review":"r_b","id":"c_b","rev":1}\n');
      return protocol.CLI_EXIT.OK;
    },
    wait: async () => {}
  });
  assert.equal(code, protocol.CLI_EXIT.OK);
  assert.deepEqual(polled, ["s_a", "s_b", "s_a", "s_b"]);
  const printed = stdout.join("");
  assert.ok(printed.startsWith(monitor.ACTION_REQUIRED));
  assert.match(printed, /"id":"c_b"/);
  const flag = " --state-dir " + w.dir;
  assert.ok(printed.includes(protocol.drainCommand("s_b", w.dir)), printed);
  assert.ok(printed.includes("lahe monitor --session s_a --session s_b" + flag), printed);
});

test("when one session closes, the monitor says so, drops it, and keeps watching the other", async () => {
  const w = world();
  const stdout = [];
  const stderr = [];
  let loops = 0;
  const polled = [];
  const code = await monitor.run(["--session", "s_a", "--session", "s_b", "--state-dir", w.dir], {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    statusRun: async (args, io) => {
      polled.push(sessionOf(args));
      if (sessionOf(args) === "s_b" && loops === 2) io.stdout('{"review":"r_b","id":"c_b","rev":1}\n');
      return protocol.CLI_EXIT.OK;
    },
    wait: async () => {
      loops += 1;
      if (loops === 1) w.store.close("s_a");
    }
  });
  assert.equal(code, protocol.CLI_EXIT.OK);
  assert.deepEqual(polled, ["s_a", "s_b", "s_b", "s_b"]);
  assert.match(stderr.join(""), /agent session s_a is closed; no longer watching it; still watching s_b/);
  assert.ok(stdout.join("").includes("lahe monitor --session s_b --state-dir " + w.dir));
  assert.equal(stdout.join("").includes("--session s_a"), false, "the relaunch leaves the closed session out");
  assert.equal(w.store.readMonitor("s_a"), null, "the dropped session's heartbeat comes down");
});

test("a takeover of either session fences it: its work captured in that poll is never delivered", async () => {
  const w = world();
  const stdout = [];
  const stderr = [];
  let loops = 0;
  const code = await monitor.run(["--session", "s_a", "--session", "s_b", "--state-dir", w.dir], {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    statusRun: async (args, io) => {
      if (sessionOf(args) === "s_b" && loops === 0) {
        io.stdout('{"review":"r_b","id":"c_taken","rev":1}\n');
        w.store.takeover("s_b");
      }
      if (sessionOf(args) === "s_a" && loops === 1) io.stdout('{"review":"r_a","id":"c_a","rev":1}\n');
      return protocol.CLI_EXIT.OK;
    },
    wait: async () => { loops += 1; }
  });
  assert.equal(code, protocol.CLI_EXIT.OK);
  const printed = stdout.join("");
  assert.equal(printed.includes("c_taken"), false, "work of a session taken over mid-poll is not handed out");
  assert.match(printed, /"id":"c_a"/);
  assert.match(stderr.join(""), /agent session s_b was taken over; no longer watching it; still watching s_a/);
});

test("the monitor exits with a session's own code only when no session is left", async () => {
  const w = world();
  let loops = 0;
  const stderr = [];
  const code = await monitor.run(["--session", "s_a", "--session", "s_b", "--state-dir", w.dir], {
    stdout: () => {},
    stderr: (text) => stderr.push(text),
    statusRun: async () => protocol.CLI_EXIT.OK,
    wait: async () => {
      loops += 1;
      if (loops === 1) w.store.close("s_a");
      if (loops === 2) w.store.takeover("s_b");
    }
  });
  assert.equal(code, protocol.CLI_EXIT.SESSION_TAKEN_OVER);
  assert.match(stderr.join(""), /s_b was taken over; this older monitor has ended; do not relaunch it/);
});

test("a closed session at startup is dropped when another is still open", async () => {
  const w = world();
  w.store.close("s_a");
  const stderr = [];
  const polled = [];
  const code = await monitor.run(["--session", "s_a", "--session", "s_b", "--state-dir", w.dir], {
    stdout: () => {},
    stderr: (text) => stderr.push(text),
    statusRun: async (args, io) => {
      polled.push(sessionOf(args));
      io.stdout('{"review":"r_b","id":"c_b","rev":1}\n');
      return protocol.CLI_EXIT.OK;
    },
    wait: async () => {}
  });
  assert.equal(code, protocol.CLI_EXIT.OK);
  assert.deepEqual(polled, ["s_b"]);
  assert.match(stderr.join(""), /s_a is closed; no longer watching it; still watching s_b/);
  // The primary is the first session still watched.
});

test("an unknown session among several is bad usage, before anything is written", async () => {
  const w = world();
  const stderr = [];
  const code = await monitor.run(["--session", "s_a", "--session", "s_ghost", "--state-dir", w.dir], {
    stdout: () => {},
    stderr: (text) => stderr.push(text),
    statusRun: async () => { throw new Error("must not poll"); },
    wait: async () => {}
  });
  assert.equal(code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(stderr.join(""), /unknown agent session "s_ghost"/);
  assert.equal(w.store.readMonitor("s_a"), null);
});

test("a live monitor on either session refuses a second one", async () => {
  const w = world();
  w.store.writeMonitor("s_b", { pid: process.pid, handoff_rev: 0 });
  const stderr = [];
  const code = await monitor.run(["--session", "s_a", "--session", "s_b", "--state-dir", w.dir], {
    stdout: () => {},
    stderr: (text) => stderr.push(text),
    pid: process.pid + 1,
    statusRun: async () => { throw new Error("must not poll"); },
    wait: async () => {}
  });
  assert.equal(code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(stderr.join(""), /s_b already has a live monitor/);
});

test("protocol.monitorCommand spells a relaunch for several sessions", () => {
  assert.equal(protocol.monitorCommand(["s_a", "s_b"], null), "lahe monitor --session s_a --session s_b");
  assert.equal(protocol.monitorCommand("s_a", null), "lahe monitor --session s_a");
});
