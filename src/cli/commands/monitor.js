// `lahe monitor`: wait locally for new session work, print it, and exit.
//
// This process, not an LLM timer, pays for idle polling. Agents launch it as a
// background task. Empty status checks stay inside this Node process; the task
// completes only when new item lines exist or the session closes. A host that
// wakes an agent on background-task completion therefore spends no model tokens
// on no-ops.

"use strict";

var protocol = require("../../shared/protocol.js");
var agentSessions = require("../../service/agent_sessions.js");
var stateDir = require("../../service/state_dir.js");
var status = require("./status.js");

var DEFAULT_INTERVAL_SECONDS = 15;
var MAX_INTERVAL_SECONDS = 3600;
var ACTION_REQUIRED = "LAHE ACTION REQUIRED: do not end this turn or report that work is ready. Handle every item below now, rebuild and verify visible output, append replies, drain status until empty, then relaunch lahe monitor.\n";

var USAGE = [
  "usage: lahe monitor --session <id> --seen-file <path> [--interval <seconds>] [--state-dir <path>]",
  "",
  "Polls session-scoped status locally, prints only new work, then exits.",
  "Launch it as a background task and relaunch it after handling each batch.",
  "Idle polls invoke no model and print nothing.",
  "",
  "  --session <id>       required agent-session owner",
  "  --seen-file <path>   required durable session/review/item/revision ledger",
  "  --interval <seconds> local polling interval; default " + DEFAULT_INTERVAL_SECONDS,
  "  --state-dir <path>   same state root used by review and status",
  "",
  "Exit codes: " + protocol.CLI_EXIT.OK + " new work printed, " +
    protocol.CLI_EXIT.BAD_USAGE + " invalid or closed session."
].join("\n");

function parseArgs(argv) {
  var out = {
    session: null,
    seenFile: null,
    intervalSeconds: DEFAULT_INTERVAL_SECONDS,
    stateDir: null,
    help: false,
    error: null
  };
  var list = argv || [];
  for (var i = 0; i < list.length; i += 1) {
    var arg = list[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--session" || arg === "--seen-file" || arg === "--interval" || arg === "--state-dir") {
      if (list[i + 1] === undefined) {
        out.error = arg + " needs a value";
        break;
      }
      var value = list[(i += 1)];
      if (arg === "--session") out.session = value;
      if (arg === "--seen-file") out.seenFile = value;
      if (arg === "--state-dir") out.stateDir = value;
      if (arg === "--interval") {
        var seconds = Number(value);
        if (!Number.isInteger(seconds) || seconds < 1 || seconds > MAX_INTERVAL_SECONDS) {
          out.error = "--interval must be an integer from 1 through " + MAX_INTERVAL_SECONDS;
          break;
        }
        out.intervalSeconds = seconds;
      }
    } else {
      out.error = "unknown option " + JSON.stringify(arg);
      break;
    }
  }
  if (out.help || out.error) return out;
  if (!out.session) out.error = "--session is required";
  else if (!protocol.isSafeId(out.session)) out.error = "--session must be a safe id: " + String(protocol.SAFE_ID);
  else if (!out.seenFile) out.error = "--seen-file is required";
  return out;
}

function waitMs(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function run(argv, options) {
  var opts = options || {};
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  var err = opts.stderr || function (text) { process.stderr.write(text); };
  var statusRun = opts.statusRun || status.run;
  var wait = opts.wait || waitMs;
  var readSession = opts.readSession || function (id, stateDirOption) {
    var dir = stateDirOption ? stateDir.stateDir({ dir: stateDirOption }) : stateDir.stateDir();
    return agentSessions.createStore({ dir: dir }).read(id);
  };
  var args = parseArgs(argv);

  if (args.help) {
    out(USAGE + "\n");
    return protocol.CLI_EXIT.OK;
  }
  if (args.error) {
    err("lahe monitor: " + args.error + "\n\n" + USAGE + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }

  var startingSession;
  try {
    startingSession = readSession(args.session, args.stateDir);
  } catch (readError) {
    err("lahe monitor: " + readError.message + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  if (!startingSession) {
    err("lahe monitor: unknown agent session " + JSON.stringify(args.session) + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  var handoffRev = agentSessions.handoffRev(startingSession);

  function stillOwnsSession() {
    var current = readSession(args.session, args.stateDir);
    return current && agentSessions.handoffRev(current) === handoffRev;
  }

  function handoffExit() {
    err("lahe monitor: agent session " + args.session + " was taken over; this older monitor has ended\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }

  var statusArgs = [
    "--session", args.session,
    "--json",
    "--seen-file", args.seenFile,
    "--quiet"
  ];
  if (args.stateDir) statusArgs.push("--state-dir", args.stateDir);

  while (true) {
    try {
      if (!stillOwnsSession()) return handoffExit();
    } catch (readError) {
      err("lahe monitor: " + readError.message + "\n");
      return protocol.CLI_EXIT.BAD_USAGE;
    }
    var stdout = [];
    var stderr = [];
    var code = await statusRun(statusArgs, {
      stdout: function (text) { stdout.push(String(text)); },
      stderr: function (text) { stderr.push(String(text)); }
    });
    var printed = stdout.join("");
    var errors = stderr.join("");

    try {
      if (!stillOwnsSession()) return handoffExit();
    } catch (readError) {
      err("lahe monitor: " + readError.message + "\n");
      return protocol.CLI_EXIT.BAD_USAGE;
    }

    if (printed) {
      err(ACTION_REQUIRED);
      out(printed);
    }
    if (errors) err(errors);
    if (code !== protocol.CLI_EXIT.OK) return code;
    if (printed) return protocol.CLI_EXIT.OK;

    await wait(args.intervalSeconds * 1000);
  }
}

module.exports = {
  DEFAULT_INTERVAL_SECONDS: DEFAULT_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS: MAX_INTERVAL_SECONDS,
  ACTION_REQUIRED: ACTION_REQUIRED,
  USAGE: USAGE,
  parseArgs: parseArgs,
  run: run
};
