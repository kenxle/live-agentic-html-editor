// The command dispatcher. Three commands: serve, add, status.
//
// Owner: 1A, which wires `serve`. `add` is 3B's and `status` is 3A's, each wired
// the same way serve is.
//
// The three commands are the whole surface. The agent-facing pair from the
// archived send model (`next` and `ack`) is gone: an agent answers by appending
// one JSON line to a reply file, which needs no command at all.
//
// `wait` IS RETIRED, and it is not wired here any more. It blocked, which meant
// agents ran it in the foreground and stopped working while a reviewer typed,
// and it answered for one review at a time behind a cursor an agent had to
// carry. `lahe status --json --seen-file <path>` answers the same question for
// every review at once, blocks on nothing, needs no cursor and no parser, and
// survives a restart because the seen file is the state. Two ways to keep up,
// one of them a trap, is not a thing a young tool should carry.
//
// Node-only.

"use strict";

var protocol = require("../shared/protocol.js");

var USAGE = [
  "usage: lahe <command> [options]",
  "",
  "  serve   run the local helper on 127.0.0.1:" + protocol.DEFAULT_PORT + " (configurable with --port)",
  "  add     add the library to a page and mint that review's token",
  "  status  print what is open right now, and whether the page is still connected",
  "          (--json --seen-file <path> is the keep-up loop: any item line is new work)",
  "",
  "Run `lahe <command> --help` for a command's own options."
].join("\n");

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
    return command ? protocol.CLI_EXIT.OK : protocol.CLI_EXIT.BAD_USAGE;
  }

  if (command === "serve") return require("./commands/serve.js").run(rest);
  if (command === "add") return require("./commands/add.js").run(rest);
  if (command === "status") return require("./commands/status.js").run(rest);

  process.stderr.write("lahe: unknown command " + JSON.stringify(command) + "\n\n" + USAGE + "\n");
  return protocol.CLI_EXIT.BAD_USAGE;
}

module.exports = { USAGE: USAGE, main: main };
