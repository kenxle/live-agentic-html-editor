"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const monitor = require("../../src/cli/commands/monitor.js");
const protocol = require("../../src/shared/protocol.js");

test("monitor requires session ownership and a durable seen file", async () => {
  const stderr = [];
  const missing = await monitor.run([], { stderr: (text) => stderr.push(text) });
  assert.equal(missing, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(stderr.join(""), /--session is required/);

  const badInterval = monitor.parseArgs([
    "--session", "s_owner",
    "--seen-file", "/tmp/seen",
    "--interval", "0"
  ]);
  assert.match(badInterval.error, /--interval must be an integer/);
});

test("idle polls stay local until work appears, then monitor prints once and exits", async () => {
  const stdout = [];
  const stderr = [];
  const calls = [];
  const waits = [];
  let count = 0;

  const code = await monitor.run([
    "--session", "s_owner",
    "--seen-file", "/tmp/seen",
    "--interval", "7"
  ], {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    readSession: () => ({ id: "s_owner", handoff_rev: 0 }),
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
  assert.equal(stdout.join(""), '{"review":"r_one","id":"c_one","rev":1}\n');
  assert.equal(stderr.join(""), monitor.ACTION_REQUIRED);
  assert.match(stderr.join(""), /do not end this turn/i);
  assert.match(stderr.join(""), /Handle every item below now/);
  assert.match(stderr.join(""), /rebuild and verify visible output/);
  assert.match(stderr.join(""), /append replies/);
  assert.match(stderr.join(""), /drain status until empty/);
  assert.match(stderr.join(""), /relaunch lahe monitor/);
  calls.forEach((args) => {
    assert.deepEqual(args, [
      "--session", "s_owner",
      "--json",
      "--seen-file", "/tmp/seen",
      "--quiet"
    ]);
  });
});

test("closed or invalid sessions stop the local monitor instead of polling forever", async () => {
  const stderr = [];
  let waited = false;
  const code = await monitor.run([
    "--session", "s_owner",
    "--seen-file", "/tmp/seen"
  ], {
    stderr: (text) => stderr.push(text),
    readSession: () => ({ id: "s_owner", handoff_rev: 0 }),
    statusRun: async (_args, io) => {
      io.stderr("lahe status: agent session s_owner is closed; monitoring has ended\n");
      return protocol.CLI_EXIT.BAD_USAGE;
    },
    wait: async () => { waited = true; }
  });

  assert.equal(code, protocol.CLI_EXIT.BAD_USAGE);
  assert.equal(waited, false);
  assert.match(stderr.join(""), /monitoring has ended/);
});

test("takeover fences the old monitor before it can deliver another agent's work", async () => {
  const stdout = [];
  const stderr = [];
  let reads = 0;
  const code = await monitor.run([
    "--session", "s_owner",
    "--seen-file", "/tmp/seen"
  ], {
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    readSession: () => ({ id: "s_owner", handoff_rev: reads++ < 2 ? 0 : 1 }),
    statusRun: async (_args, io) => {
      io.stdout('{"review":"r_one","id":"c_new","rev":1}\n');
      return protocol.CLI_EXIT.OK;
    }
  });

  assert.equal(code, protocol.CLI_EXIT.BAD_USAGE);
  assert.equal(stdout.join(""), "", "work captured after takeover is never delivered to the old agent");
  assert.match(stderr.join(""), /was taken over; this older monitor has ended/);
});
