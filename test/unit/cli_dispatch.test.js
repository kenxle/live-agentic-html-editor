// The public command dispatcher.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cli = require("../../src/cli/index.js");
const protocol = require("../../src/shared/protocol.js");

async function captureMain(args) {
  const stdout = [];
  const stderr = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = function (chunk) {
    stdout.push(String(chunk));
    return true;
  };
  process.stderr.write = function (chunk) {
    stderr.push(String(chunk));
    return true;
  };
  try {
    const code = await cli.main(args);
    return { code: code, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

test("the dispatcher advertises review and session lifecycle", async () => {
  const help = await captureMain(["--help"]);
  assert.equal(help.code, protocol.CLI_EXIT.OK);
  assert.match(help.stdout, /\bserve\b/);
  assert.match(help.stdout, /\breview\b/);
  assert.match(help.stdout, /\bsession\b/);
  assert.match(help.stdout, /\badd\b/);
  assert.match(help.stdout, /\bstatus\b/);
  assert.match(help.stdout, /\bmonitor\b/);
  assert.equal(/\bwait\b/.test(help.stdout), false);
});

test("the dispatcher routes `session list`, the one session action that needs no id", async () => {
  // Discovery has to be reachable from the top-level usage text: an agent that
  // cannot see the command goes looking through its host's sessions instead.
  const help = await captureMain(["--help"]);
  assert.match(help.stdout, /session list the agent sessions/);

  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-dispatch-list-"));
  const listed = await captureMain(["session", "list", "--state-dir", empty]);
  assert.equal(listed.code, protocol.CLI_EXIT.OK, listed.stderr);
  assert.match(listed.stdout, /no agent sessions/);
  assert.equal(listed.stderr, "");
});

test("missing and unknown commands use the shared CLI bad-usage exit", async () => {
  const missing = await captureMain([]);
  assert.equal(missing.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(missing.stdout, /usage: lahe/);

  const unknown = await captureMain(["not-a-command"]);
  assert.equal(unknown.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(unknown.stderr, /unknown command/);
});

test("add, serve, session, and monitor help use stdout and the successful help exit", async () => {
  for (const command of ["add", "serve", "session", "monitor"]) {
    const help = await captureMain([command, "--help"]);
    assert.equal(help.code, protocol.CLI_EXIT.OK, command + " --help exits successfully");
    assert.match(help.stdout, new RegExp("usage: lahe " + command));
    assert.equal(help.stderr, "", command + " --help is not an error");
  }
});

test("malformed add and serve options remain bad usage on stderr", async () => {
  for (const command of ["add", "serve"]) {
    const malformed = await captureMain([command, "--not-an-option"]);
    assert.equal(malformed.code, protocol.CLI_EXIT.BAD_USAGE);
    assert.match(malformed.stderr, /unknown option/);
    assert.equal(malformed.stdout, "");
  }
});

test("status owns the active read exits under CLI_EXIT", () => {
  assert.deepEqual(protocol.CLI_EXIT, {
    OK: 0,
    HELPER_UNREACHABLE: 2,
    UNKNOWN_REVIEW: 3,
    BAD_USAGE: 4,
    // The two the monitor adds. A host reads the number to decide whether to
    // relaunch, and "stop relaunching, the session is over" cannot share a code
    // with "you typed the command wrong".
    SESSION_CLOSED: 5,
    SESSION_TAKEN_OVER: 6
  });
  assert.equal(Object.prototype.hasOwnProperty.call(protocol, "WAIT"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(protocol, "WAIT_EVENT_TYPES"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(protocol, "countsAsNew"), false);
});
