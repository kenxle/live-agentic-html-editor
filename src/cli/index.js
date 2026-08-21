// The command dispatcher.
//
// Owner: 1A, which wires `serve`. `add` is 3B's and `status` is 3A's, each wired
// the same way serve is.
//
// The public commands are the whole surface. The agent-facing pair from the
// archived send model (`next` and `ack`) is gone: an agent answers by appending
// one JSON line to a reply file, which needs no command at all.
//
// `wait` IS RETIRED, and it is not wired here any more. It blocked, which meant
// agents ran it in the foreground and stopped working while a reviewer typed,
// and it answered for one review at a time behind a cursor an agent had to
// carry. `lahe monitor --session <id>` answers the same
// question for one agent workstream, stays silent while polling locally, and
// exits on new work so a background-task host can wake the agent without model
// turns on no-ops. It needs no cursor or parser and survives a restart because
// the seen file is the state. Two subtly different blocking commands would be
// a trap, so monitor is the only public waiting surface.
//
// Node-only.

"use strict";

var protocol = require("../shared/protocol.js");

var USAGE = [
  "usage: lahe <command> [options]",
  "",
  "  serve   run the local helper on 127.0.0.1:" + protocol.DEFAULT_PORT + " (configurable with --port)",
  "  review  start or continue a document review in an isolated agent session",
  "  session list the agent sessions on this machine, or close, reopen, or take one over",
  "  add     add the library to a page and mint that review's token",
  "  status  print what is open right now, and whether the page is still connected",
  "  monitor watch locally for session work, print it, and exit (zero-token no-ops)",
  "",
  "Run `lahe <command> --help` for a command's own options."
].join("\n");

// Every public command, in the order the usage text lists them. Dispatch reads
// this map, so the routed commands and the advertised commands are one list
// rather than two that can drift. Each entry loads its module only when the
// command runs, which keeps startup to the one command being used. A test reads
// COMMAND_NAMES to check that every `lahe <command>` in the docs is real.
var COMMANDS = {
  serve: function () { return require("./commands/serve.js"); },
  review: function () { return require("./commands/review.js"); },
  session: function () { return require("./commands/session.js"); },
  add: function () { return require("./commands/add.js"); },
  status: function () { return require("./commands/status.js"); },
  monitor: function () { return require("./commands/monitor.js"); }
};

var COMMAND_NAMES = Object.keys(COMMANDS);

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

  if (Object.prototype.hasOwnProperty.call(COMMANDS, command)) return COMMANDS[command]().run(rest);

  process.stderr.write("lahe: unknown command " + JSON.stringify(command) + "\n\n" + USAGE + "\n");
  return protocol.CLI_EXIT.BAD_USAGE;
}

module.exports = { USAGE: USAGE, COMMANDS: COMMANDS, COMMAND_NAMES: COMMAND_NAMES, main: main };
