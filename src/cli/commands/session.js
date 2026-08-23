// Open and close durable agent workstreams, and lease the shared helper only
// while at least one workstream is open.

"use strict";

var childProcess = require("node:child_process");
var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../../shared/protocol.js");
var stateDir = require("../../service/state_dir.js");
var sessions = require("../../service/agent_sessions.js");
var service = require("../../service/index.js");
var sourceStamp = require("../../service/source_stamp.js");
var staticServers = require("../../service/static_servers.js");

var statusCommand = require("./status.js");
var projection = require("../../service/projection.js");
var eventLog = require("../../service/log.js");

var BIN = path.join(__dirname, "..", "..", "..", "bin", "lahe.js");
// Every action `lahe session` accepts. parse() validates against this list, so
// a test can read the real actions instead of restating them.
var ACTIONS = ["list", "close", "reopen", "takeover"];
var USAGE = [
  "usage: lahe session <list|close|reopen|takeover> [session-id] [--port <n>] [--state-dir <path>] [--json]",
  "",
  "  list      every agent session on this machine, open ones first. Read-only: it takes no id",
  "            and changes nothing. This is how you FIND a session id.",
  "  close     end a session, keep its review history",
  "  reopen    reopen a closed session you already own",
  "  takeover  explicitly continue another agent's session, only when the human asks for it",
  "",
  "  --json    with list: one JSON object per session, then one summary line"
].join("\n");

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function waitFor(check, timeoutMs) {
  var end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return true;
    await delay(50);
  }
  return false;
}

function parse(argv) {
  var list = argv || [];
  var action = list[0] || null;
  // `list` is the only action that takes no id: it is the command an agent runs
  // BECAUSE it has no id yet. Its options therefore start one slot earlier.
  var listing = action === "list";
  var out = { action: action, id: listing ? null : list[1] || null, port: null, stateDir: null, json: false };
  for (var i = listing ? 1 : 2; i < list.length; i += 1) {
    if (list[i] === "--json") out.json = true;
    else if (list[i] === "--port" && list[i + 1] !== undefined) out.port = Number(list[(i += 1)]);
    else if (list[i] === "--state-dir" && list[i + 1] !== undefined) out.stateDir = list[(i += 1)];
    else return { error: "unknown or incomplete option " + JSON.stringify(list[i]) };
  }
  if (listing) {
    if (out.port !== null) return { error: "list takes no --port" };
    return out;
  }
  if (ACTIONS.indexOf(out.action) === -1) {
    return { error: "expected " + ACTIONS.slice(0, -1).join(", ") + ", or " + ACTIONS[ACTIONS.length - 1] };
  }
  if (out.json) return { error: "--json is only for `lahe session list`" };
  if (!protocol.isSafeId(out.id)) return { error: "session id must match " + String(protocol.SAFE_ID) };
  if (out.port !== null && (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535)) return { error: "--port takes a port number" };
  return out;
}

function readReady(dir) {
  try { return JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8")); } catch (err) { return null; }
}

async function stopVerifiedHelper(dir) {
  var ready = readReady(dir);
  if (!ready || typeof ready.pid !== "number" || typeof ready.port !== "number") return false;
  var live = await service.probeHealth(protocol.DEFAULT_HOST, ready.port);
  if (!live) return false;
  if (live.started_at !== ready.started_at) {
    throw new Error("refusing to stop an unverified pid from service.json");
  }
  try { process.kill(ready.pid, "SIGTERM"); } catch (err) { if (err.code !== "ESRCH") throw err; }
  var stopped = await waitFor(async function () {
    return !(await service.probeHealth(protocol.DEFAULT_HOST, ready.port));
  }, 10000);
  if (!stopped) throw new Error("the helper did not stop within 10 seconds");
  return true;
}

/**
 * Make sure a helper this clone can talk to is running, and leave a current one
 * exactly where it is.
 *
 * Two things say the running one is behind: a lower service contract, which is
 * hand-bumped and so only catches what somebody remembered to declare, and the
 * mtimes of the code it loaded, which nobody has to remember (see
 * src/service/source_stamp.js). Either one gets it stopped and started again;
 * neither costs anything when the helper is current, because the source check
 * only runs when one is answering.
 *
 * @returns {Promise<{started: boolean, stale: boolean}>} `started` is true when
 *   this call put a new process there, whether or not it replaced one.
 */
async function startHelper(dir, port) {
  var stale = false;
  var live = await service.probeHealth(protocol.DEFAULT_HOST, port);
  if (live) {
    var liveContract = Number.isInteger(live.service_contract) ? live.service_contract : 0;
    if (liveContract > protocol.SERVICE_CONTRACT) {
      throw new Error(
        "the running helper uses newer service contract " + liveContract +
        "; update this clone before changing the session"
      );
    }
    if (liveContract === protocol.SERVICE_CONTRACT) {
      stale = sourceStamp.helperPredatesSource(live.started_at).stale;
      if (!stale) return { started: false, stale: false };
    }
    if (!(await stopVerifiedHelper(dir))) {
      throw new Error("refusing to replace an older helper whose process identity cannot be verified");
    }
  }
  var child = childProcess.spawn(process.execPath, [BIN, "serve", "--port", String(port), "--state-dir", dir], {
    detached: true,
    stdio: "ignore"
  });
  child.unref();
  var started = await waitFor(function () { return service.probeHealth(protocol.DEFAULT_HOST, port); }, 10000);
  if (!started) throw new Error("the helper did not start within 10 seconds");
  return { started: true, stale: stale };
}

// ---------------------------------------------------------------------------
// `lahe session list`
// ---------------------------------------------------------------------------
//
// WHY IT EXISTS. A human says "claim the lahe session" and the agent has no id.
// Every other session action needs one, so without this command the agent's
// only move was to guess, or to go looking through its HOST's sessions, which
// are a different thing entirely (2026-08-20). This command is read-only: it
// starts nothing, stops nothing, and marks nothing seen.
//
// It reuses the routing and work definitions rather than restating them:
// ownership comes from status.ownerOfReview, an item counts as work only
// through record.isUnansweredReady (status.isUnansweredReady), and watcher
// liveness comes from the session store's own liveness helper.

/** The unanswered ready work in one review, read straight off the log. */
function reviewWork(dir, reviewId) {
  var events;
  try {
    events = eventLog.createEventLog({ dir: dir }).read(reviewId);
  } catch (err) {
    return { unanswered: 0, oldestUnansweredAt: null, lastItemAt: null };
  }
  if (!events.length) return { unanswered: 0, oldestUnansweredAt: null, lastItemAt: null };
  var items = statusCommand.itemsOf(projection.project(reviewId, events));
  var open = items.filter(statusCommand.isUnansweredReady);
  var oldest = null;
  open.forEach(function (item) {
    var at = item.created_at || item.updated_at || null;
    if (typeof at === "string" && at && (!oldest || at < oldest)) oldest = at;
  });
  return { unanswered: open.length, oldestUnansweredAt: oldest, lastItemAt: statusCommand.lastItemAt(items) };
}

function newest() {
  var best = null;
  for (var i = 0; i < arguments.length; i += 1) {
    var at = arguments[i];
    if (typeof at === "string" && at && (!best || at > best)) best = at;
  }
  return best;
}

/**
 * One row per agent session on disk, open first and newest activity first.
 *
 * @param {{dir: string, nowMs?: number}} input
 */
function collect(input) {
  var spec = input || {};
  var dir = spec.dir;
  var nowMs = typeof spec.nowMs === "number" ? spec.nowMs : Date.now();
  var store = sessions.createStore({ dir: dir });

  var owners = Object.create(null);
  statusCommand.reviewsOnDisk(dir).forEach(function (reviewId) {
    var owner = statusCommand.ownerOfReview(dir, reviewId);
    if (!owners[owner]) owners[owner] = [];
    owners[owner].push(reviewId);
  });

  var rows = store.list().map(function (session) {
    var owned = owners[session.id] || [];
    var unanswered = 0;
    var oldestUnansweredAt = null;
    var lastItemAt = null;
    owned.forEach(function (reviewId) {
      var work = reviewWork(dir, reviewId);
      unanswered += work.unanswered;
      if (work.oldestUnansweredAt && (!oldestUnansweredAt || work.oldestUnansweredAt < oldestUnansweredAt)) {
        oldestUnansweredAt = work.oldestUnansweredAt;
      }
      lastItemAt = newest(lastItemAt, work.lastItemAt);
    });
    var liveness = store.liveness(session.id, {
      unanswered: unanswered,
      oldestUnansweredAt: oldestUnansweredAt,
      nowMs: nowMs
    });
    var monitorAt = liveness[protocol.AGENT_LIVENESS.FIELD.MONITOR_AT];
    return {
      id: session.id,
      open: !session.closed_at,
      closed_at: session.closed_at || null,
      handoff_rev: sessions.handoffRev(session),
      reviews: owned.length,
      unanswered_ready: unanswered,
      liveness: liveness,
      last_activity_at: newest(
        session.created_at,
        session.taken_over_at,
        session.closed_at,
        liveness[protocol.AGENT_LIVENESS.FIELD.ACTIVITY_AT],
        monitorAt,
        lastItemAt
      )
    };
  });

  rows.sort(function (a, b) {
    if (a.open !== b.open) return a.open ? -1 : 1;
    var left = a.last_activity_at || "";
    var right = b.last_activity_at || "";
    if (left !== right) return left < right ? 1 : -1;
    return a.id.localeCompare(b.id);
  });
  return rows;
}

/** Watching, or how long ago the last heartbeat was, or nobody. */
function watcherText(row, nowMs) {
  var state = row.liveness[protocol.AGENT_LIVENESS.FIELD.STATE];
  if (state === protocol.AGENT_LIVENESS.STATE.WATCHING) return "watching";
  var at = row.liveness[protocol.AGENT_LIVENESS.FIELD.MONITOR_AT];
  var when = at ? statusCommand.ago(at, nowMs) : null;
  return when ? "last heartbeat " + when : "no watcher";
}

function listLine(row, nowMs) {
  return (
    row.id +
    "  " +
    (row.open ? "open" : "closed " + row.closed_at) +
    "  handoff " + row.handoff_rev +
    "  reviews " + row.reviews +
    "  unanswered " + row.unanswered_ready +
    "  " + watcherText(row, nowMs)
  );
}

var TAKEOVER_HINT = "claim one with: lahe session takeover <id> (requires the human's explicit request)";

function runList(args, opts) {
  var out = opts.stdout;
  var err = opts.stderr;
  var nowMs = typeof opts.now === "number" ? opts.now : Date.now();
  var dir;
  try { dir = args.stateDir ? stateDir.stateDir({ dir: args.stateDir }) : stateDir.stateDir(); }
  catch (error) { err("lahe session: " + error.message + "\n"); return 1; }

  var rows;
  try { rows = collect({ dir: dir, nowMs: nowMs }); }
  catch (error) { err("lahe session: " + error.message + "\n"); return 1; }

  if (args.json) {
    rows.forEach(function (row) { out(JSON.stringify(row) + "\n"); });
    out(JSON.stringify({
      sessions: rows.length,
      open: rows.filter(function (row) { return row.open; }).length,
      unanswered_ready: rows.reduce(function (sum, row) { return sum + row.unanswered_ready; }, 0),
      state_dir: dir
    }) + "\n");
    return protocol.CLI_EXIT.OK;
  }

  if (rows.length === 0) {
    // A plain sentence rather than an error: no sessions is a normal state, and
    // an agent that just arrived needs to be told that in words.
    out("no agent sessions in " + stateDir.agentSessionsRoot(dir) + "\n");
    return protocol.CLI_EXIT.OK;
  }
  rows.forEach(function (row) { out(listLine(row, nowMs) + "\n"); });
  out(TAKEOVER_HINT + "\n");
  return protocol.CLI_EXIT.OK;
}

async function run(argv, options) {
  var opts = options || {};
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  var errOut = opts.stderr || function (text) { process.stderr.write(text); };
  if ((argv || []).indexOf("--help") !== -1 || (argv || []).indexOf("-h") !== -1) {
    out(USAGE + "\n");
    return protocol.CLI_EXIT.OK;
  }
  var args = parse(argv);
  if (args.error) {
    errOut("lahe session: " + args.error + "\n\n" + USAGE + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  if (args.action === "list") return runList(args, { stdout: out, stderr: errOut, now: opts.now });
  var dir;
  try { dir = args.stateDir ? stateDir.stateDir({ dir: args.stateDir }) : stateDir.stateDir(); }
  catch (err) { errOut("lahe session: " + err.message + "\n"); return 1; }
  var store = sessions.createStore({ dir: dir });
  try {
    if (args.action === "close") {
      var staticStopped = await staticServers.stopAll(dir, args.id);
      store.close(args.id);
      var stopped = false;
      if (store.openSessions().length === 0) stopped = await stopVerifiedHelper(dir);
      out(
        "agent session " + args.id + " closed; review history kept" +
          (staticStopped ? "; static review server" + (staticStopped === 1 ? "" : "s") + " stopped" : "") +
          (stopped ? "; shared helper stopped" : "") + "\n"
      );
    } else {
      var handedOff = args.action === "takeover";
      var session = handedOff ? store.takeover(args.id) : store.reopen(args.id);
      var prior = readReady(dir);
      var port = args.port || (prior && prior.port) || protocol.DEFAULT_PORT;
      var helperRun = await startHelper(dir, port);
      var staticStarted = await staticServers.restartAll(dir, args.id);
      var helperNote = "; shared helper already running";
      if (helperRun.started) helperNote = helperRun.stale ? "; shared helper restarted" : "; shared helper started";
      var message =
        "agent session " + args.id + (handedOff ? " taken over explicitly" : " reopened") +
          helperNote +
          (staticStarted ? "; static review server" + (staticStarted === 1 ? "" : "s") + " restarted" : "") + "\n";
      // Never a silent bounce: a restart drops every open review page's
      // connection for a moment, and the person watching that page is owed the
      // reason.
      if (helperRun.stale) {
        message +=
          "  helper    " + sourceStamp.REASON + ", so it was stopped and started again\n" +
          "            any review page open right now goes unreachable for a moment and reconnects on its own\n";
      }
      if (handedOff) {
        message +=
          "  handoff   " + session.handoff_rev + "  (older lahe monitor processes exit with " +
            protocol.CLI_EXIT.SESSION_TAKEN_OVER + ")\n" +
          "  catch-up  lahe status --session " + args.id + " --json\n" +
          "            handle every unanswered item before you start watching\n" +
          sessions.commandBlock({ dir: dir, session: args.id });
      }
      out(message);
    }
    return protocol.CLI_EXIT.OK;
  } catch (err) {
    errOut("lahe session: " + err.message + "\n");
    return 1;
  }
}

module.exports = {
  USAGE: USAGE,
  ACTIONS: ACTIONS,
  TAKEOVER_HINT: TAKEOVER_HINT,
  parse: parse,
  collect: collect,
  listLine: listLine,
  watcherText: watcherText,
  stopVerifiedHelper: stopVerifiedHelper,
  startHelper: startHelper,
  run: run
};
