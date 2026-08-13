// The command dispatcher. Three commands: serve, add, wait.
//
// Owner: 1A, which wires `serve`. `add` is 3B's and is wired the same way serve
// is. `wait` is 3A's and is still a dispatch stub here that says so and exits 4
// (bad usage, protocol.WAIT.EXIT). It is a stub rather than an absent entry on
// purpose: a user who types `lahe wait` should read what is missing, not
// "unknown command".
//
// The three commands are the whole surface. The agent-facing pair from the
// archived send model (`next` and `ack`) is gone: an agent answers by appending
// one JSON line to a reply file, which needs no command at all.
//
// Node-only.

"use strict";

var protocol = require("../shared/protocol.js");

var USAGE = [
  "usage: lahe <command> [options]",
  "",
  "  serve   run the local helper on 127.0.0.1:" + protocol.DEFAULT_PORT + " (configurable with --port)",
  "  add     add the library to a page and mint that review's token",
  "  wait    block until a review has new work, then print it as JSON lines",
  "",
  "Run `lahe <command> --help` for a command's own options."
].join("\n");

// TODO(3A): replace with require("./commands/wait.js"). The route it calls
// already exists and blocks correctly; only the command is missing.
function waitNotYet() {
  process.stderr.write(
    [
      "lahe wait is not built yet. Task 3A owns it.",
      "",
      "The helper already serves the route it will call:",
      "  GET " + protocol.BASE + "/wait?review=<id>&since=<cursor>&timeout=<seconds>",
      "It blocks until something new passes the watermark, consumes nothing, and acknowledges nothing."
    ].join("\n") + "\n"
  );
  return protocol.WAIT.EXIT.BAD_USAGE;
}

/**
 * @param {string[]} argv everything after the program name
 * @returns {Promise<number>} the process exit code
 */
async function main(argv) {
  var list = argv || [];
  var command = list[0];
  var rest = list.slice(1);

  if (!command || command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(USAGE + "\n");
    return command ? 0 : protocol.WAIT.EXIT.BAD_USAGE;
  }

  if (command === "serve") return require("./commands/serve.js").run(rest);
  if (command === "add") return require("./commands/add.js").run(rest);
  if (command === "wait") return waitNotYet();

  process.stderr.write("lahe: unknown command " + JSON.stringify(command) + "\n\n" + USAGE + "\n");
  return protocol.WAIT.EXIT.BAD_USAGE;
}

module.exports = { USAGE: USAGE, main: main };
