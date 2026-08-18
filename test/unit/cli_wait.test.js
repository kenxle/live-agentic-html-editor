// `lahe wait` is RETIRED, and this file is what holds it retired.
//
// Owner: 3A. It used to be the command's own suite: the five exit codes, the
// JSON-lines output, the cursor, and the promise that a wait consumes nothing.
// All of that worked. It was retired anyway, because the command BLOCKED: agents
// ran it in the foreground and stopped working while the reviewer typed, and it
// watched one review from behind a cursor the caller had to carry.
// `lahe status --json --seen-file <path>` answers the same question without
// blocking, across every review, and a restarted loop misses nothing because the
// seen file is the state.
//
// The tests below are the ones that matter now: the command is not reachable,
// the route is off the wire, and the exit-code table `status` borrows is still
// where it always was. src/cli/commands/wait.js is still on disk and is on the
// cleanup batch; nothing loads it.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const cli = require("../../src/cli/index.js");
const protocol = require("../../src/shared/protocol.js");
const routes = require("../../src/service/routes.js");

test("the dispatcher does not offer wait, and says so with an unknown-command exit", async () => {
  assert.equal(/\bwait\b/.test(cli.USAGE), false, "the usage text names three commands, and wait is not one");

  const errors = [];
  const originalWrite = process.stderr.write;
  process.stderr.write = function (chunk) {
    errors.push(String(chunk));
    return true;
  };
  let code;
  try {
    code = await cli.main(["wait", "--review", "r1"]);
  } finally {
    process.stderr.write = originalWrite;
  }
  assert.equal(code, protocol.WAIT.EXIT.BAD_USAGE);
  assert.match(errors.join(""), /unknown command/);
});

test("the wait route is off the wire, so nothing can long-poll the helper", () => {
  const names = protocol.ROUTES.map((route) => route.name);
  assert.equal(names.indexOf("wait"), -1);
  assert.throws(() => protocol.route("wait"), /unknown route/);
  assert.throws(() => routes.handlerFor("wait"), /unknown route/);
  // The route table and the handler table still agree on everything else: the
  // load-time check in routes.js throws if they ever do not.
  names.forEach((name) => {
    assert.equal(typeof routes.handlerFor(name), "function", name + " has a handler");
  });
});

test("the exit-code table survives the command, because status borrows it", () => {
  assert.equal(typeof protocol.WAIT.EXIT.NEW_WORK, "number");
  assert.equal(typeof protocol.WAIT.EXIT.BAD_USAGE, "number");
  assert.equal(typeof protocol.WAIT.EXIT.HELPER_UNREACHABLE, "number");
  assert.equal(typeof protocol.WAIT.EXIT.UNKNOWN_REVIEW, "number");
});
