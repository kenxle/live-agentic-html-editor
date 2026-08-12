// The command dispatcher. Three commands: serve, add, wait.
//
// Owner: 1A, which wires `serve`. `add` is 3B's and `wait` is 3A's, and both are
// dispatch stubs here that say so and exit 4 (bad usage, protocol.WAIT.EXIT).
// They are stubs rather than absent entries on purpose: a user who types
// `lahe add` should read what is missing, not "unknown command".
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

// TODO(3B): replace with require("./commands/add.js"). `add` mints the review
// through src/service/reviews.js, which 1A built, and starts the helper when it
// is not already up.
function addNotYet() {
  process.stderr.write(
    [
      "lahe add is not built yet. Task 3B owns it.",
      "",
      "Until it lands, the same two acts are available directly:",
      "  lahe serve --review <id> --origin <your dev server's origin>",
      "then read the review's token out of the helper's service.json and put it on the script tag as " +
        protocol.SCRIPT_ATTR.TOKEN +
        "."
    ].join("\n") + "\n"
  );
  return protocol.WAIT.EXIT.BAD_USAGE;
}

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
  if (command === "add") return addNotYet();
  if (command === "wait") return waitNotYet();

  process.stderr.write("lahe: unknown command " + JSON.stringify(command) + "\n\n" + USAGE + "\n");
  return protocol.WAIT.EXIT.BAD_USAGE;
}

module.exports = { USAGE: USAGE, main: main };
