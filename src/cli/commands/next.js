// `next`: hand an agent everything outstanding.
//
// Owner: Task 1D. STUB: the flag parsing and the terminal payload printing are
// real, because they ARE the contract an agent branches on. What is stubbed is
// the part that talks to the service.
//
// The whole definition lives in src/shared/cli_contract.js: flags, blocking
// behavior, keepalive, terminal payload shapes, and exit codes. This file
// implements it and adds nothing to it.
//
// Node-only.

"use strict";

var cli = require("../../shared/cli_contract.js");

// stdout carries exactly one JSON object. Keepalives and progress go to stderr,
// so an agent can pipe stdout into a parser with no filter.
function emit(payload, exitCode) {
  process.stdout.write(JSON.stringify(payload) + "\n");
  return exitCode;
}

function keepalive(waitedSeconds) {
  process.stderr.write(JSON.stringify({ type: "keepalive", waited_seconds: waitedSeconds }) + "\n");
}

function parseArgs(argv) {
  var out = {
    review: null,
    wait: 0,
    keepalive: 20,
    format: "json",
    since: null,
    target: null,
    quiet: false
  };
  for (var i = 0; i < argv.length; i += 1) {
    var a = argv[i];
    if (a === "--review") out.review = argv[++i];
    else if (a === "--wait") out.wait = Number(argv[++i]);
    else if (a === "--keepalive") out.keepalive = Number(argv[++i]);
    else if (a === "--format") out.format = argv[++i];
    else if (a === "--since") out.since = argv[++i];
    else if (a === "--target") out.target = argv[++i];
    else if (a === "--quiet") out.quiet = true;
    else {
      var err = new Error("unknown flag: " + a);
      err.exit = cli.EXIT.USAGE;
      throw err;
    }
  }
  if (!(out.wait >= 0) || out.wait > cli.NEXT_BLOCKING.max_wait_seconds) {
    var e2 = new Error("--wait must be between 0 and " + cli.NEXT_BLOCKING.max_wait_seconds + " seconds");
    e2.exit = cli.EXIT.USAGE;
    throw e2;
  }
  if (out.format !== "json" && out.format !== "md") {
    var e3 = new Error("--format must be json or md");
    e3.exit = cli.EXIT.USAGE;
    throw e3;
  }
  return out;
}

/**
 * STUB: 1D implements the service call. Returns the exit code rather than
 * calling process.exit, so it is testable.
 */
function run(argv) {
  var args;
  try {
    args = parseArgs(argv || []);
  } catch (err) {
    return emit(
      cli.payloadFor("error", { code: "PROTO_BAD_REQUEST", message: err.message, remedy: null }),
      err.exit || cli.EXIT.USAGE
    );
  }
  void args;
  return emit(
    cli.payloadFor("error", {
      code: "CLI_NO_SERVICE",
      message: "not implemented yet: Task 1D owns src/cli/commands/next.js",
      remedy: null
    }),
    cli.EXIT.NO_SERVICE
  );
}

module.exports = { run: run, parseArgs: parseArgs, emit: emit, keepalive: keepalive, isStub: true };
