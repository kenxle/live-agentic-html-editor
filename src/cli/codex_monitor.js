// Codex's native queue is the wake channel. One local watcher per conversation
// waits outside model turns and exits after the host accepts a real batch.
"use strict";

var fs = require("node:fs");
var crypto = require("node:crypto");
var net = require("node:net");
var os = require("node:os");
var path = require("node:path");
var childProcess = require("node:child_process");
var agentSessions = require("../service/agent_sessions.js");
var stateDir = require("../service/state_dir.js");
var protocol = require("../shared/protocol.js");

var THREAD_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
var COMMAND_TIMEOUT_MS = 10000;

function execFile(file, args, options) {
  return new Promise(function (resolve, reject) {
    childProcess.execFile(file, args, options, function (error, stdout) {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function readRegistry(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

function registryPath(dir, thread) {
  return path.join(dir, "codex-monitors", thread + ".json");
}

// Read-only connection check. This starts no daemon, thread, or model call.
function probeThread(thread, env) {
  return new Promise(function (resolve, reject) {
    var socketPath = path.join(env.CODEX_HOME || path.join(os.homedir(), ".codex"), "app-server-control", "app-server-control.sock");
    var socket = net.createConnection(socketPath);
    var timer = setTimeout(function () { finish(new Error("Codex connection timed out")); }, COMMAND_TIMEOUT_MS);
    var settled = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve();
    }
    socket.once("error", finish);
    socket.once("connect", function () { finish(); });
  });
}

// Serialize startup and registrations so simultaneous arms cannot fork two
// workers. A dead starter's lock is recoverable; a live starter is awaited locally.
async function acquire(file) {
  var deadline = Date.now() + COMMAND_TIMEOUT_MS;
  // A symlink stores its target atomically. There is no empty-file window if
  // the starter dies, and the nonce distinguishes a replacement lock.
  var token = process.pid + "." + crypto.randomBytes(16).toString("hex");
  for (;;) {
    try {
      fs.symlinkSync(token, file);
      return function () {
        try { if (fs.readlinkSync(file) === token) fs.unlinkSync(file); }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      var owner;
      var target;
      try { target = fs.readlinkSync(file); owner = Number(target.split(".")[0]); }
      catch (readError) { if (readError.code === "ENOENT") continue; throw readError; }
      if (owner && !agentSessions.pidAlive(owner)) {
        try { if (fs.readlinkSync(file) === target) fs.unlinkSync(file); } catch (unlinkError) { if (unlinkError.code !== "ENOENT") throw unlinkError; }
        continue;
      }
      if (Date.now() >= deadline) throw new Error("another Codex watcher is still starting; retry this command");
      await new Promise(function (resolve) { setTimeout(resolve, 25); });
    }
  }
}

function liveBeat(beat, rev) {
  return beat && beat.handoff_rev === rev && Number.isFinite(Date.parse(beat.at)) &&
    Date.now() - Date.parse(beat.at) <= protocol.MONITOR.HEARTBEAT_FRESH_MS && agentSessions.pidAlive(beat.pid);
}

async function start(argv, args, options) {
  var opts = options || {};
  var env = opts.env || process.env;
  var out = opts.stdout || function (text) { process.stdout.write(text); };
  var err = opts.stderr || function (text) { process.stderr.write(text); };
  var thread = env.CODEX_THREAD_ID || env.CODEX_SESSION_ID;
  if (!THREAD_ID.test(thread || "")) {
    err("lahe monitor --codex: CODEX_THREAD_ID must name the current Codex conversation. No foreground wait was started.\n");
    return protocol.CLI_EXIT.BAD_USAGE;
  }
  var dir = stateDir.stateDir({ dir: args.stateDir || undefined });
  var store = agentSessions.createStore({ dir: dir });
  var file = registryPath(dir, thread);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: stateDir.DIR_MODE });
  var release;
  try {
    release = await acquire(file + ".lock");
    var existing = readRegistry(file);
    var registrations = [];
    var droppedCode = null;
    // Save the revisions BEFORE any asynchronous capability or socket check.
    args.sessions.forEach(function (id) {
      var session = store.read(id);
      if (!session) throw new Error("session " + id + " is unknown");
      if (session.closed_at) {
        droppedCode = protocol.CLI_EXIT.SESSION_CLOSED;
        err("lahe monitor --codex: session " + id + " is closed; skipping it\n");
        return;
      }
      if (args.handoffRevisions[id] !== undefined && args.handoffRevisions[id] !== agentSessions.handoffRev(session)) {
        droppedCode = protocol.CLI_EXIT.SESSION_TAKEN_OVER;
        err("lahe monitor --codex: session " + id + " changed hands; skipping this stale request\n");
        return;
      }
      registrations.push({ id: id, rev: agentSessions.handoffRev(session) });
    });
    if (!registrations.length) return droppedCode;
    var active = existing && agentSessions.pidAlive(existing.pid) &&
      existing.sessions.some(function (entry) {
        var session = store.read(entry.id);
        var beat = store.readMonitor(entry.id);
        return session && !session.closed_at && agentSessions.handoffRev(session) === entry.rev &&
          liveBeat(beat, entry.rev) && beat.pid === existing.pid && beat.codex_thread === thread;
      });
    registrations.forEach(function (entry) {
      var beat = store.readMonitor(entry.id);
      if (liveBeat(beat, entry.rev) && !(active && beat.pid === existing.pid && beat.codex_thread === thread)) {
        throw new Error("session " + entry.id + " already has another live monitor; stop it before changing hosts");
      }
    });
    if (active) {
      existing.sessions = existing.sessions.filter(function (entry) {
        var session = store.read(entry.id);
        return session && !session.closed_at && agentSessions.handoffRev(session) === entry.rev;
      });
      registrations.forEach(function (entry) {
        existing.sessions = existing.sessions.filter(function (other) { return other.id !== entry.id; });
        existing.sessions.push(entry);
      });
      stateDir.writeAtomic(file, JSON.stringify(existing) + "\n");
      out("Lahe's Codex watcher is already active for this conversation; its session list is updated. End this turn when your work is done.\n");
      return protocol.CLI_EXIT.OK;
    }
    var help = await (opts.execFile || execFile)("codex", ["queue", "--help"], { env: env, timeout: COMMAND_TIMEOUT_MS, maxBuffer: 65536 });
    if (!/--thread/.test(help) || !/--message/.test(help)) throw new Error("this Codex CLI does not support codex queue");
    await (opts.probeThread || probeThread)(thread, env);
    registrations = registrations.filter(function (entry) {
      var session = store.read(entry.id);
      return session && !session.closed_at && agentSessions.handoffRev(session) === entry.rev;
    });
    if (!registrations.length) {
      err("lahe monitor --codex: a session closed or changed hands during startup; do not re-arm this stale request.\n");
      return protocol.CLI_EXIT.SESSION_TAKEN_OVER;
    }
    stateDir.writeAtomic(file, JSON.stringify({ pid: null, sessions: registrations }) + "\n");
    stateDir.ensureAgentSessionDir(dir, registrations[0].id);
    var logPath = path.join(stateDir.agentSessionDir(dir, registrations[0].id), "codex-monitor.log");
    var log = fs.openSync(logPath, "a", stateDir.FILE_MODE);
    var workerArgs = [__filename, thread];
    registrations.forEach(function (entry) { workerArgs.push("--session", entry.id); });
    workerArgs.push("--interval", String(args.intervalSeconds), "--state-dir", dir);
    var child;
    try {
      child = childProcess.spawn(process.execPath, workerArgs, {
        env: env, detached: true, stdio: ["ignore", "ignore", log, "ipc"]
      });
    } finally { fs.closeSync(log); }
    return await new Promise(function (resolve) {
      var settled = false;
      var timer = setTimeout(function () { finish(false, "watcher startup timed out"); }, COMMAND_TIMEOUT_MS);
      function finish(ok, why) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (child.connected) child.disconnect();
        if (ok) {
          child.unref();
          out("Lahe's Codex watcher is active. It queues real feedback to this conversation and uses no model calls while idle. End this turn when your work is done.\n");
        } else {
          child.kill("SIGTERM");
          err("lahe monitor --codex: " + why + ". See " + logPath + "\n");
        }
        resolve(ok ? protocol.CLI_EXIT.OK : protocol.CLI_EXIT.BAD_USAGE);
      }
      child.once("message", function (message) { if (message && message.ready) finish(true); });
      child.once("error", function (error) { finish(false, error.message); });
      child.once("exit", function (code) { finish(false, "watcher exited with code " + code); });
    });
  } catch (error) {
    err("lahe monitor --codex: " + error.message + ". Requires codex queue and access to the existing local Codex daemon. No foreground wait was started.\n");
    return error.laheExit || protocol.CLI_EXIT.BAD_USAGE;
  } finally { if (release) release(); }
}

async function worker(thread, argv, options) {
  var opts = options || {};
  var monitor = require("./commands/monitor.js");
  var args = monitor.parseArgs(argv);
  var dir = stateDir.stateDir({ dir: args.stateDir || undefined });
  var store = agentSessions.createStore({ dir: dir });
  var file = registryPath(dir, thread);
  var starting = readRegistry(file);
  var lastError = null;
  var deliveryRelease = null;
  var owned = new Set(args.sessions);
  function clear() { owned.forEach(function (id) { store.clearMonitor(id, { pid: process.pid }); }); }
  function stop() { clear(); if (deliveryRelease) deliveryRelease(); process.exit(0); }
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);
  try {
    return await monitor.run(argv, {
      codexThread: thread,
      expectedRevisions: Object.fromEntries(starting.sessions.map(function (entry) { return [entry.id, entry.rev]; })),
      additionalSessions: function () {
        var current = readRegistry(file);
        if (!current || current.pid !== process.pid) throw new Error("this Codex watcher was replaced");
        current.sessions.forEach(function (entry) { owned.add(entry.id); });
        return current.sessions;
      },
      onReady: function () {
        starting.pid = process.pid;
        stateDir.writeAtomic(file, JSON.stringify(starting) + "\n");
        if (process.send) process.send({ ready: true });
      },
      deliverWork: async function (line, watched) {
        try {
          deliveryRelease = await acquire(file + ".lock");
          var current = readRegistry(file);
        // A registration that raced this poll belongs in the same queued batch.
        // Retry locally with the expanded watch set before sending anything.
          var changed = !current || current.pid !== process.pid || current.sessions.some(function (entry) {
          var session = store.read(entry.id);
          return session && !session.closed_at && agentSessions.handoffRev(session) === entry.rev &&
            !watched.some(function (other) { return other.id === entry.id && other.rev === entry.rev; });
          });
          if (changed) { deliveryRelease(); deliveryRelease = null; return false; }
          await (opts.execFile || execFile)("codex", ["queue", "--remote", "unix://", "--thread", thread, "--message", line.trim()], {
            timeout: COMMAND_TIMEOUT_MS, maxBuffer: 65536
          });
          lastError = null;
          return true;
        } catch (error) {
          if (error.message !== lastError) process.stderr.write("Codex queue failed; feedback remains pending and will be retried locally: " + error.message + "\n");
          lastError = error.message;
          if (deliveryRelease) deliveryRelease();
          deliveryRelease = null;
          return false;
        }
      }
    });
  } finally {
    clear();
    if (deliveryRelease) deliveryRelease();
    process.removeListener("SIGTERM", stop);
    process.removeListener("SIGINT", stop);
  }
}

module.exports = { start: start, worker: worker, probeThread: probeThread };

if (require.main === module) {
  worker(process.argv[2], process.argv.slice(3)).then(function (code) {
    process.exitCode = code;
  }).catch(function (error) {
    process.stderr.write(error.stack + "\n");
    process.exitCode = 1;
  });
}
