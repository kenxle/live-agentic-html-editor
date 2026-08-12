// Starting the local service, and killing it the way a laptop lid does.
//
// `kill -9` is the interesting half. A graceful shutdown proves nothing about
// durability: the service gets to flush. SIGKILL is what AC3 means by "nothing
// is taken back", so that is the default way these tests end a service.
//
// THE READINESS CONTRACT. The helper waits for two things, in order:
//
//   1. <stateDir>/service.json exists and parses to { port, pid }
//   2. a TCP connection to that port succeeds
//
// Both, because a file written before the listener is up is a lie, and a port
// that answers before state is on disk means the durability tests race. The real
// service already has to record its run token and port in an owner-only file per
// architecture D9, so this is that file. A builder whose service writes a
// different filename or shape changes SERVICE_READY_FILE and readReadyFile
// below, and nothing else in the harness moves.
//
// Until src/service/index.js is a real server, point `entry` at
// STUB_SERVICE_ENTRY, which honors the same contract.

"use strict";

const { spawn } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { pollUntil } = require("./poll");

const REPO_ROOT = path.join(__dirname, "..", "..");
const SERVICE_ENTRY = path.join(REPO_ROOT, "src", "service", "index.js");
const STUB_SERVICE_ENTRY = path.join(REPO_ROOT, "test", "fixtures", "servers", "stub-service.js");
const SERVICE_READY_FILE = "service.json";

/** A throwaway state directory. Caller deletes it, or leaves it in the OS temp. */
function makeStateDir(prefix = "lahe-state-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function readReadyFile(stateDir) {
  const readyPath = path.join(stateDir, SERVICE_READY_FILE);
  if (!fs.existsSync(readyPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(readyPath, "utf8"));
    if (typeof parsed.port !== "number") return null;
    return parsed;
  } catch (err) {
    // Half-written file. The real service writes through a temp name and a
    // rename (D11) so this should not happen, but the poll must not crash on it.
    return null;
  }
}

/** Is a TCP listener answering on this port? */
function tcpProbe(port, host = "127.0.0.1", timeoutMs = 500) {
  return new Promise(function (resolve) {
    const socket = new net.Socket();
    let settled = false;
    function finish(value) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    }
    socket.setTimeout(timeoutMs);
    socket.once("connect", function () {
      finish(true);
    });
    socket.once("timeout", function () {
      finish(false);
    });
    socket.once("error", function () {
      finish(false);
    });
    socket.connect(port, host);
  });
}

function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return false;
  }
}

/**
 * Start the service and wait until it is genuinely up.
 *
 * @param {{stateDir?: string, entry?: string, args?: string[],
 *          env?: Record<string,string>, allowedOrigins?: string[],
 *          readyTimeoutMs?: number}} [options]
 * @returns {Promise<object>} a handle with port, url, token, stateDir, logs, and
 *   stop / kill9 / waitForExit
 */
async function startService(options = {}) {
  const stateDir = options.stateDir || makeStateDir();
  const entry = options.entry || SERVICE_ENTRY;
  const readyTimeoutMs = options.readyTimeoutMs ?? 10000;

  if (!fs.existsSync(entry)) {
    throw new Error("startService: no such entry point: " + entry);
  }

  const env = Object.assign({}, process.env, {
    LAHE_STATE_DIR: stateDir,
    LAHE_ALLOWED_ORIGINS: (options.allowedOrigins || []).join(",")
  }, options.env || {});

  const child = spawn(process.execPath, [entry].concat(options.args || []), {
    env: env,
    stdio: ["ignore", "pipe", "pipe"]
  });

  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", function (chunk) {
    stdoutChunks.push(chunk.toString());
  });
  child.stderr.on("data", function (chunk) {
    stderrChunks.push(chunk.toString());
  });

  let exited = null;
  child.on("exit", function (code, signal) {
    exited = { code: code, signal: signal };
  });

  const ready = await pollUntil(
    async function () {
      if (exited) {
        throw new Error(
          "startService: the service exited before it was ready (code " +
            exited.code +
            ", signal " +
            exited.signal +
            ").\nstdout: " +
            stdoutChunks.join("") +
            "\nstderr: " +
            stderrChunks.join("")
        );
      }
      const file = readReadyFile(stateDir);
      if (!file) return null;
      const listening = await tcpProbe(file.port);
      return listening ? file : null;
    },
    {
      timeoutMs: readyTimeoutMs,
      message:
        "the service to write " +
        SERVICE_READY_FILE +
        " into " +
        stateDir +
        " and answer on its port",
      describe: function () {
        return { stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") };
      }
    }
  );

  const handle = {
    child: child,
    pid: child.pid,
    port: ready.port,
    token: ready.token || null,
    url: "http://127.0.0.1:" + ready.port,
    stateDir: stateDir,
    entry: entry,
    stdout: function () {
      return stdoutChunks.join("");
    },
    stderr: function () {
      return stderrChunks.join("");
    },
    alive: function () {
      return processAlive(child.pid);
    },
    waitForExit: function (timeoutMs = 5000) {
      return pollUntil(
        function () {
          return exited ? exited : null;
        },
        { timeoutMs: timeoutMs, message: "the service process to exit" }
      );
    },
    /** Ask nicely. Use this only when the test is about graceful shutdown. */
    stop: async function (timeoutMs = 5000) {
      if (exited) return exited;
      child.kill("SIGTERM");
      return handle.waitForExit(timeoutMs);
    },
    /** SIGKILL, which is what a durability test means. */
    kill9: async function (timeoutMs = 5000) {
      return killServiceHard(handle, timeoutMs);
    }
  };

  return handle;
}

/**
 * kill -9 the service and wait until it is really gone: the process is reaped
 * AND the port stops answering. Checking only the process leaves a race where a
 * follow-up request lands on a socket that has not closed yet.
 */
async function killServiceHard(handle, timeoutMs = 5000) {
  if (handle.alive()) {
    try {
      process.kill(handle.pid, "SIGKILL");
    } catch (err) {
      if (err.code !== "ESRCH") throw err;
    }
  }
  await pollUntil(
    async function () {
      if (processAlive(handle.pid)) return null;
      const stillListening = await tcpProbe(handle.port, "127.0.0.1", 200);
      return stillListening ? null : true;
    },
    {
      timeoutMs: timeoutMs,
      message: "the service process to die and its port to stop answering",
      describe: function () {
        return { pid: handle.pid, port: handle.port, alive: processAlive(handle.pid) };
      }
    }
  );
  return true;
}

/** Every line the service appended to its event log, parsed. */
function readEventLog(stateDir) {
  const logPath = path.join(stateDir, "events.log");
  if (!fs.existsSync(logPath)) return [];
  return fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(function (line) {
      return line.trim().length > 0;
    })
    .map(function (line) {
      return JSON.parse(line);
    });
}

module.exports = {
  SERVICE_ENTRY,
  STUB_SERVICE_ENTRY,
  SERVICE_READY_FILE,
  makeStateDir,
  readReadyFile,
  readEventLog,
  tcpProbe,
  processAlive,
  startService,
  killServiceHard
};
