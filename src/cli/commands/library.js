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
// that session. The last agent to run it is attached.
//
// NO `--session`: A NEW SESSION, EVERY TIME. The agent asked to "open the
// lahe library" often has no LAHE session, since only `lahe review` used to
// make one. So plain `lahe library` creates an agent session, attaches it, and
// prints its commands, the block `lahe review` prints. It never reuses the
// attached session: the command cannot tell one agent from another, and handing
// agent B agent A's live session leaves B's monitor refused. Reuse is
// `--session`, which the output tells the agent to pass from then on. The new
// session owns no review, so it is not an empty review.

// SERVING. `lahe library serve` serves the document a legacy or worktree
// pickup names. It reads the path itself, from the request's review, re-runs the
// candidate checks at serve time, and runs `lahe review` with the path as one
// argv entry. A page-derived path never passes through a shell string.

// ANSWERING. `lahe library answer` is the only CLI writer of
// catalog-requests.jsonl, and the only line it writes is the answer. The
// helper appends requests and recorded expiries.
//
// Node-only.

"use strict";

var childProcess = require("node:child_process");
var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../../shared/protocol.js");
var stateDir = require("../../service/state_dir.js");
var agentSessions = require("../../service/agent_sessions.js");
var catalogRequests = require("../../service/catalog_requests.js");
var catalogReader = require("../../service/catalog_reader.js");

var BIN = path.join(__dirname, "..", "..", "..", "bin", "lahe.js");

var EXIT = protocol.CLI_EXIT;
var C = protocol.CATALOG;

var USAGE = [
  "usage: lahe library [--session <id>] [--name <name>] [--json] [--port <n>] [--state-dir <path>]",
  "       lahe library serve <request-id> --session <id> [--port <n>] [--state-dir <path>]",
  "       lahe library answer <request-id> --session <id> --status done|refused --text \"...\" [--state-dir <path>]",
  "",
  "  lahe library           start the helper if it is not running, then print the Library's",
  "                         address. It never opens a browser: run `open` on the URL it prints.",
  "  --session <id>         attach this agent session: the Library hands its requests to it.",
  "                         Without it, a new agent session (no reviews) is started and attached,",
  "                         and its monitor, drain and close commands are printed. The first time,",
  "                         run it bare; after that, pass the --session it printed.",
  "  --name <name>          your host's name for this agent: names the new session, or the --session one.",
  "  --json                 print {url, attached, helper_started, session, session_created} as one JSON line",
  "  --port <n>             the helper's port. Default " + protocol.DEFAULT_PORT,
  "",
  "  serve                  serve the document a legacy or worktree pickup names, as `lahe review`",
  "                         does. It reads the path itself, so no page text passes through a shell.",
  "                         --session is your own session, the one the request is for.",
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
    serve: false,
    id: null,
    session: null,
    name: null,
    status: null,
    text: null,
    json: false,
    port: null,
    stateDir: null,
    help: false,
    error: null
  };
  var i = 0;
  if (list[0] === "answer" || list[0] === "serve") {
    out.answer = list[0] === "answer";
    out.serve = list[0] === "serve";
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
    } else if (arg === "--json" && !out.answer && !out.serve) {
      out.json = true;
    } else if (arg === "--session" || arg === "--state-dir" || arg === "--port" ||
      (!out.answer && !out.serve && arg === "--name") ||
      (out.answer && (arg === "--status" || arg === "--text"))) {
      if (list[i + 1] === undefined) {
        out.error = arg + " needs a value";
        break;
      }
      var value = String(list[(i += 1)]);
      if (arg === "--session") out.session = value;
      if (arg === "--name") out.name = value;
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
  if (out.serve) {
    if (!out.id) out.error = "serve needs the request id: lahe library serve <request-id> --session <id>";
    else if (!protocol.isSafeId(out.id)) out.error = "the request id must be a safe id: " + String(protocol.SAFE_ID);
    else if (!out.session) out.error = "serve needs --session <id>, your own session";
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
  if (!attached) return "no agent. Run lahe library to attach one";
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
  var store = agentSessions.createStore({ dir: dir });
  var sessionId = args.session;
  var created = false;
  if (args.session) {
    // Checked BEFORE the helper starts: attaching a session that does not exist
    // would leave the Library handing requests to nobody.
    try {
      store.requireOpen(args.session);
      if (args.name !== null) store.setName(args.session, args.name);
    } catch (error) {
      err("lahe library: " + error.message + "\n");
      return EXIT.BAD_USAGE;
    }
  } else {
    try {
      // Marked as the Library's own, so the helper closes it once it is idle
      // and owns no reviews (CATALOG.LIBRARY_SESSION_IDLE_MS).
      var spec = { created_by: protocol.CATALOG.CREATED_BY_LIBRARY };
      if (args.name !== null) spec.name = args.name;
      sessionId = store.create(spec).id;
      created = true;
      // The block printed below names the wake feed's path, so it has to exist
      // before an agent copies that line.
      store.wake.ensure(sessionId);
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
    // A session this call made and never handed out is closed again.
    if (created) store.close(sessionId);
    err("lahe library: " + error.message + "\n");
    return EXIT.HELPER_UNREACHABLE;
  }
  var ready = readReady(dir);
  if (!ready || !Number.isInteger(ready.port)) {
    // The same as a failed start: a session this call made is closed again.
    if (created) store.close(sessionId);
    err("lahe library: the helper is up but " + stateDir.readyPath(dir) + " names no port\n");
    return EXIT.HELPER_UNREACHABLE;
  }

  catalogRequests.writeAttach(dir, sessionId, nowMs);
  var url = "http://" + protocol.DEFAULT_HOST + ":" + ready.port + protocol.CATALOG_PAGE_PATH;
  var attached = catalogRequests.createQueue({ dir: dir }).readAttached(nowMs);

  if (args.json) {
    out(JSON.stringify({
      url: url,
      attached: attached,
      helper_started: started.started === true,
      session: sessionId,
      session_created: created
    }) + "\n");
    return EXIT.OK;
  }
  var sessionLine = created
    ? "session   " + sessionId + "  (started for this agent)\n" +
      "            next time, run: lahe library --session " + sessionId + protocol.stateDirFlag(stateDir.flagFor(dir)) + "\n"
    : "";
  out(
    sessionLine +
    "Library   " + url + "\n" +
      "attached  " + attachedLine(attached) + "\n" +
      (started.keptForReviewer ? "helper    " + started.keptForReviewer + "\n" : "") +
      "open it   open " + url + "\n" +
      (args.session ? "" : agentSessions.commandBlock({ dir: dir, session: sessionId }))
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
 * The file or folder a pickup serves, checked now, or a reason it cannot be.
 *
 * legacy: the review's own document, which must still be there, hold this
 * review's own script line, and be this user's. worktree: the main-repo candidate, which describeReview re-checks on
 * this read (real path under the repository, not hidden, a page, this user's,
 * no quote or control character). Every other kind is not served.
 */
function serveTarget(described) {
  if (!described) return { error: "its review is gone; answer refused" };
  if (described.kind === "legacy") {
    var stat = null;
    try { stat = described.path ? fs.statSync(described.path) : null; } catch (error) { stat = null; }
    if (!stat || !(stat.isFile() || stat.isDirectory())) return { error: "its document is gone; answer refused" };
    // The recorded path is page text (review.write records it with the page's
    // own token). Only a file that holds this review's script line is its
    // document.
    if (!described.verified_path || described.verified_path !== described.path) {
      return { error: "its recorded file does not hold this review's script line; answer refused" };
    }
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) {
      return { error: "its document belongs to another user; answer refused" };
    }
    return { target: described.verified_path };
  }
  if (described.kind === "worktree") {
    if (!described.candidate) return { error: "its worktree is gone and no main-repo copy passes the checks; answer refused" };
    return { target: described.candidate };
  }
  return {
    error: "its row is kind " + described.kind + ": serve is for legacy and worktree rows. " +
      (described.kind === "static" ? "Take the session over instead" : "Answer refused")
  };
}

async function runServe(args, opts, out, err) {
  var nowMs = typeof opts.now === "number" ? opts.now : Date.now();
  var dir;
  try {
    dir = resolveDir(args);
  } catch (error) {
    err("lahe library serve: " + error.message + "\n");
    return EXIT.BAD_USAGE;
  }
  var request = catalogRequests.createQueue({ dir: dir }).pendingFor(args.session, nowMs).filter(function (r) {
    return r.id === args.id;
  })[0];
  if (!request) {
    err("lahe library serve: no pending Library request " + args.id + " for agent session " + args.session + "\n");
    return EXIT.BAD_USAGE;
  }
  if (request.action !== catalogRequests.ACTION.PICKUP) {
    err("lahe library serve: request " + args.id + " is a " + request.action + ", not a pickup\n");
    return EXIT.BAD_USAGE;
  }
  var chosen = serveTarget(catalogReader.createReader({ dir: dir }).describeReview(request.review, nowMs));
  if (chosen.error) {
    err("lahe library serve: request " + args.id + ": " + chosen.error + "\n");
    return EXIT.BAD_USAGE;
  }
  // argv, never a shell: the path is page text and arrives as one argument.
  var argv = [BIN, "review", chosen.target, "--session", args.session];
  if (args.stateDir) argv.push("--state-dir", args.stateDir);
  if (args.port !== null) argv.push("--port", String(args.port));
  var code = await new Promise(function (resolve) {
    var child = childProcess.spawn(process.execPath, argv, { stdio: ["ignore", "pipe", "pipe"], shell: false });
    child.stdout.on("data", function (chunk) { out(String(chunk)); });
    child.stderr.on("data", function (chunk) { err(String(chunk)); });
    child.on("error", function (error) {
      err("lahe library serve: " + error.message + "\n");
      resolve(1);
    });
    child.on("close", function (status) { resolve(typeof status === "number" ? status : 1); });
  });
  if (code === EXIT.OK) agentSessions.createStore({ dir: dir }).touchActivity(args.session);
  return code;
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
  if (args.serve) return runServe(args, opts, out, err);
  return runLibrary(args, opts, out, err);
}

module.exports = { USAGE: USAGE, parse: parse, run: run };
