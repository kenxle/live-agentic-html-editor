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
var staticServers = require("../../service/static_servers.js");

var BIN = path.join(__dirname, "..", "..", "..", "bin", "lahe.js");
var USAGE = "usage: lahe session <close|reopen|takeover> <session-id> [--port <n>] [--state-dir <path>]";

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
  var out = { action: list[0] || null, id: list[1] || null, port: null, stateDir: null };
  for (var i = 2; i < list.length; i += 1) {
    if (list[i] === "--port" && list[i + 1] !== undefined) out.port = Number(list[(i += 1)]);
    else if (list[i] === "--state-dir" && list[i + 1] !== undefined) out.stateDir = list[(i += 1)];
    else return { error: "unknown or incomplete option " + JSON.stringify(list[i]) };
  }
  if (out.action !== "close" && out.action !== "reopen" && out.action !== "takeover") {
    return { error: "expected close, reopen, or takeover" };
  }
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

async function startHelper(dir, port) {
  var live = await service.probeHealth(protocol.DEFAULT_HOST, port);
  if (live) {
    var liveContract = Number.isInteger(live.service_contract) ? live.service_contract : 0;
    if (liveContract > protocol.SERVICE_CONTRACT) {
      throw new Error(
        "the running helper uses newer service contract " + liveContract +
        "; update this clone before changing the session"
      );
    }
    if (liveContract === protocol.SERVICE_CONTRACT) return false;
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
  return true;
}

async function run(argv) {
  if ((argv || []).indexOf("--help") !== -1 || (argv || []).indexOf("-h") !== -1) {
    process.stdout.write(USAGE + "\n");
    return protocol.CLI_EXIT.OK;
  }
  var args = parse(argv);
  if (args.error) {
    process.stderr.write("lahe session: " + args.error + "\n\n" + USAGE + "\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  var dir;
  try { dir = args.stateDir ? stateDir.stateDir({ dir: args.stateDir }) : stateDir.stateDir(); }
  catch (err) { process.stderr.write("lahe session: " + err.message + "\n"); return 1; }
  var store = sessions.createStore({ dir: dir });
  try {
    if (args.action === "close") {
      var staticStopped = await staticServers.stopAll(dir, args.id);
      store.close(args.id);
      var stopped = false;
      if (store.openSessions().length === 0) stopped = await stopVerifiedHelper(dir);
      process.stdout.write(
        "agent session " + args.id + " closed; review history kept" +
          (staticStopped ? "; static review server" + (staticStopped === 1 ? "" : "s") + " stopped" : "") +
          (stopped ? "; shared helper stopped" : "") + "\n"
      );
    } else {
      var handedOff = args.action === "takeover";
      var session = handedOff ? store.takeover(args.id) : store.reopen(args.id);
      var prior = readReady(dir);
      var port = args.port || (prior && prior.port) || protocol.DEFAULT_PORT;
      var started = await startHelper(dir, port);
      var staticStarted = await staticServers.restartAll(dir, args.id);
      var message =
        "agent session " + args.id + (handedOff ? " taken over explicitly" : " reopened") +
          (started ? "; shared helper started" : "; shared helper already running") +
          (staticStarted ? "; static review server" + (staticStarted === 1 ? "" : "s") + " restarted" : "") + "\n";
      if (handedOff) {
        message +=
          "  handoff   " + session.handoff_rev + "  (older lahe monitor processes exit with " +
            protocol.CLI_EXIT.SESSION_TAKEN_OVER + ")\n" +
          "  catch-up  lahe status --session " + args.id + " --json\n" +
          "            handle every unanswered item before you start watching\n" +
          sessions.commandBlock({ dir: dir, session: args.id });
      }
      process.stdout.write(message);
    }
    return protocol.CLI_EXIT.OK;
  } catch (err) {
    process.stderr.write("lahe session: " + err.message + "\n");
    return 1;
  }
}

module.exports = { USAGE: USAGE, parse: parse, stopVerifiedHelper: stopVerifiedHelper, startHelper: startHelper, run: run };
