// `lahe library`: print the Library's address, and attach an agent to it.
// `lahe library answer`: answer a request the Library queued for that agent.
//
// Owner: LAHE Library, Task 1.4. Architecture: docs/features/
// 20260922.02_lahe_library/02_architecture_lahe_library.md, "Reaching the
// Library" and "Files".
//
// `lahe library` PRINTS THE URL, IT NEVER OPENS A BROWSER. The agent runs
// `open` on it. The URL is the helper's own origin, read from service.json
// after the helper is up, so `--port` is honored rather than assumed.
//
// ATTACHING. `--session <id>` writes catalog-attach.json, which only this
// command writes: the Library hands "Pick this up" and "Launch a new agent" to
// that session. The last agent to run it is attached. With no `--session` the
// attach is left as it is and the command says who is attached.
//
// ANSWERING. `lahe library answer` is the only CLI writer of
// catalog-requests.jsonl, and the only line it writes is the answer. The
// helper appends requests and recorded expiries.
//
// Node-only.

"use strict";

var fs = require("node:fs");

var protocol = require("../../shared/protocol.js");
var stateDir = require("../../service/state_dir.js");
var agentSessions = require("../../service/agent_sessions.js");
var catalogRequests = require("../../service/catalog_requests.js");

var EXIT = protocol.CLI_EXIT;
var C = protocol.CATALOG;

var USAGE = [
  "usage: lahe library [--session <id>] [--json] [--port <n>] [--state-dir <path>]",
  "       lahe library answer <request-id> --session <id> --status done|refused --text \"...\" [--state-dir <path>]",
  "",
  "  lahe library           start the helper if it is not running, then print the Library's",
  "                         address. It never opens a browser: run `open` on the URL it prints.",
  "  --session <id>         attach this agent session: the Library hands its requests to it.",
  "                         Without it, the attach is left as it is and the command says who it is.",
  "  --json                 print {url, attached, helper_started} as one JSON line",
  "  --port <n>             the helper's port. Default " + protocol.DEFAULT_PORT,
  "",
  "  answer                 answer one request from the catalog_requests section of the drain.",
  "                         --session is your own session, the one the request is for.",
  "                         --text is at most " + C.ANSWER_TEXT_MAX + " characters and shows on the Library row.",
  "",
  "Exit codes: " + EXIT.OK + " done, " + EXIT.BAD_USAGE + " bad usage or a refused answer."
].join("\n");

function parse(argv) {
  var list = argv || [];
  var out = {
    answer: false,
    id: null,
    session: null,
    status: null,
    text: null,
    json: false,
    port: null,
    stateDir: null,
    help: false,
    error: null
  };
  var i = 0;
  if (list[0] === "answer") {
    out.answer = true;
    i = 1;
    if (list[1] !== undefined && !/^--/.test(String(list[1]))) {
      out.id = String(list[1]);
      i = 2;
    }
  }
  for (; i < list.length; i += 1) {
    var arg = list[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
    } else if (arg === "--json" && !out.answer) {
      out.json = true;
    } else if (arg === "--session" || arg === "--state-dir" || arg === "--port" ||
      (out.answer && (arg === "--status" || arg === "--text"))) {
      if (list[i + 1] === undefined) {
        out.error = arg + " needs a value";
        break;
      }
      var value = String(list[(i += 1)]);
      if (arg === "--session") out.session = value;
      if (arg === "--state-dir") out.stateDir = value;
      if (arg === "--status") out.status = value;
      if (arg === "--text") out.text = value;
      if (arg === "--port") {
        var port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
          out.error = "--port takes a port number";
          break;
        }
        out.port = port;
      }
    } else {
      out.error = "unknown option " + JSON.stringify(arg);
      break;
    }
  }
  if (out.help || out.error) return out;
  if (out.session !== null && !protocol.isSafeId(out.session)) {
    out.error = "--session must be a safe id: " + String(protocol.SAFE_ID);
    return out;
  }
  if (out.answer) {
    if (!out.id) out.error = "answer needs the request id: lahe library answer <request-id> ...";
    else if (!protocol.isSafeId(out.id)) out.error = "the request id must be a safe id: " + String(protocol.SAFE_ID);
    else if (!out.session) out.error = "answer needs --session <id>, your own session";
    else if (catalogRequests.ANSWER_STATUSES.indexOf(out.status) === -1) {
      out.error = "answer needs --status " + catalogRequests.ANSWER_STATUSES.join("|");
    } else if (out.text === null) out.error = "answer needs --text \"...\", which shows on the Library row";
  }
  return out;
}

function resolveDir(args) {
  return args.stateDir ? stateDir.stateDir({ dir: args.stateDir }) : stateDir.stateDir();
}

function readReady(dir) {
  try {
    return JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8"));
  } catch (err) {
    return null;
  }
}

function attachedLine(attached) {
  if (!attached) return "no agent. Run lahe library --session <your session id> to attach one";
  var who = attached.name ? attached.name + " (" + attached.session + ")" : attached.session;
  return who + (attached.watching ? "" : ". Its monitor is not running, so it will not hear requests");
}

async function runLibrary(args, opts, out, err) {
  var nowMs = typeof opts.now === "number" ? opts.now : Date.now();
  var dir;
  try {
    dir = resolveDir(args);
  } catch (error) {
    err("lahe library: " + error.message + "\n");
    return EXIT.BAD_USAGE;
  }
  if (args.session) {
    // Checked BEFORE the helper starts: attaching a session that does not exist
    // would leave the Library handing requests to nobody.
    try {
      agentSessions.createStore({ dir: dir }).requireOpen(args.session);
    } catch (error) {
      err("lahe library: " + error.message + "\n");
      return EXIT.BAD_USAGE;
    }
  }

  var port = args.port === null ? protocol.DEFAULT_PORT : args.port;
  // The helper start `lahe session` uses: it leaves a current helper alone,
  // replaces one older than the code on disk, and keeps a stale one a reviewer
  // is typing into. Loaded here so `lahe library answer` never pulls it in.
  var sessionCommand = require("./session.js");
  var started;
  try {
    started = await sessionCommand.startHelper(dir, port);
  } catch (error) {
    err("lahe library: " + error.message + "\n");
    return EXIT.HELPER_UNREACHABLE;
  }
  var ready = readReady(dir);
  if (!ready || !Number.isInteger(ready.port)) {
    err("lahe library: the helper is up but " + stateDir.readyPath(dir) + " names no port\n");
    return EXIT.HELPER_UNREACHABLE;
  }

  if (args.session) catalogRequests.writeAttach(dir, args.session, nowMs);
  var url = "http://" + protocol.DEFAULT_HOST + ":" + ready.port + protocol.CATALOG_PAGE_PATH;
  var attached = catalogRequests.createQueue({ dir: dir }).readAttached(nowMs);

  if (args.json) {
    out(JSON.stringify({ url: url, attached: attached, helper_started: started.started === true }) + "\n");
    return EXIT.OK;
  }
  out(
    "Library   " + url + "\n" +
      "attached  " + attachedLine(attached) + "\n" +
      (started.keptForReviewer ? "helper    " + started.keptForReviewer + "\n" : "") +
      "open it   open " + url + "\n"
  );
  return EXIT.OK;
}

var ANSWER_REFUSAL = {
  unknown: function (args) {
    return "no Library request " + args.id + ". Request ids are in the catalog_requests section of the drain";
  },
  not_for: function (args, result) {
    return "request " + args.id + " is for agent session " + result.request.for + ", not " + args.session;
  },
  expired: function (args, result) {
    var reason = result.expired && result.expired.reason ? " (" + result.expired.reason + ")" : "";
    return "request " + args.id + " has expired" + reason + "; the Library row already says nobody answered";
  },
  answered: function (args, result) {
    return "request " + args.id + " was already answered at " + result.first.answered_at + ": " +
      result.first.status + ": " + result.first.text;
  },
  too_long: function () {
    return "--text is at most " + C.ANSWER_TEXT_MAX + " characters";
  },
  bad_status: function () {
    return "--status must be " + catalogRequests.ANSWER_STATUSES.join(" or ");
  }
};

function runAnswer(args, opts, out, err) {
  var nowMs = typeof opts.now === "number" ? opts.now : Date.now();
  var dir;
  try {
    dir = resolveDir(args);
  } catch (error) {
    err("lahe library answer: " + error.message + "\n");
    return EXIT.BAD_USAGE;
  }
  var result = catalogRequests.createQueue({ dir: dir }).answer(
    { id: args.id, by: args.session, status: args.status, text: args.text },
    nowMs
  );
  if (!result.ok) {
    var say = ANSWER_REFUSAL[result.reason] || function () { return "refused: " + result.reason; };
    err("lahe library answer: " + say(args, result) + "\n");
    return EXIT.BAD_USAGE;
  }
  // Answering is the agent working, the same as a drain or a reply.
  agentSessions.createStore({ dir: dir }).touchActivity(args.session);
  out("answered " + args.id + ": " + args.status + "\n");
  return EXIT.OK;
}

/**
 * @param {string[]} argv everything after `library`
 * @param {{stdout?: function, stderr?: function, now?: number}} [options]
 */
async function run(argv, options) {
  var opts = options || {};
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  var err = opts.stderr || function (text) { process.stderr.write(text); };
  var args = parse(argv);
  if (args.help) {
    out(USAGE + "\n");
    return EXIT.OK;
  }
  if (args.error) {
    err("lahe library: " + args.error + "\n\n" + USAGE + "\n");
    return EXIT.BAD_USAGE;
  }
  if (args.answer) return runAnswer(args, opts, out, err);
  return runLibrary(args, opts, out, err);
}

module.exports = { USAGE: USAGE, parse: parse, run: run };
