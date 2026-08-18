// Starting the local service, and killing it the way a laptop lid does.
//
// `kill -9` is the interesting half. A graceful shutdown proves nothing about
// durability: the service gets to flush. SIGKILL is what AC3 means by "nothing
// is taken back", so that is the default way these tests end a service.
//
// THE READINESS CONTRACT. The helper waits for two things, in order:
//
//   1. <stateDir>/service.json exists and parses to { port, pid, reviews }
//   2. a TCP connection to that port succeeds
//
// Both, because a file written before the listener is up is a lie, and a port
// that answers before state is on disk means the durability tests race. The real
// helper already has to record its port and its credentials in an owner-only
// file (architecture D11), so this is that file. A builder whose helper writes a
// different filename or shape changes SERVICE_READY_FILE and readReadyFile
// below, and nothing else in the harness moves.
//
// THE TOKEN IS PER REVIEW, not per machine and not per run (D11: loopback is not
// a boundary, so the page proves itself). `reviews` maps a review id to that
// review's credentials:
//
//   { "port": 7817, "pid": 4211,
//     "reviews": { "rev-abc": { "token": "..." } } }
//
// Read one with handle.tokenFor(id). handle.token still works and means "the
// token, when there is exactly one review"; with two reviews open it throws
// rather than handing back whichever came first, because a test that
// authenticates against the wrong review would pass for the wrong reason.
//
// THE EVENT LOG IS PER REVIEW TOO: reviews/<id>/events.jsonl. readEventLog is
// the reader every durability and every refusal assertion runs through, so a
// stale path here would leave every "the log is still empty" assertion passing
// forever against a helper that is writing happily somewhere else.
//
// Until src/service/index.js is a real server, point `entry` at
// STUB_SERVICE_ENTRY, which honors the same contract.

"use strict";

const { spawn, execFileSync } = require("node:child_process");
const net = require("node:net");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { pollUntil } = require("./poll");

const REPO_ROOT = path.join(__dirname, "..", "..");
const SERVICE_ENTRY = path.join(REPO_ROOT, "src", "service", "index.js");
const STUB_SERVICE_ENTRY = path.join(REPO_ROOT, "test", "fixtures", "servers", "stub-service.js");
const SERVICE_READY_FILE = "service.json";
const DEFAULT_REVIEW_ID = "review-1";
const REVIEWS_DIR = "reviews";
const EVENT_LOG_FILE = "events.jsonl";

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
    // The reviews map is part of the readiness signal, not an extra. A helper
    // that is listening but has not written its per-review credentials yet is
    // not ready for anything a test wants to do next.
    if (!parsed.reviews || typeof parsed.reviews !== "object") return null;
    return parsed;
  } catch (err) {
    // Half-written file. The real helper writes through a temp name and a
    // rename (D11) so this should not happen, but the poll must not crash on it.
    return null;
  }
}

/** The token for one review, or a failure naming the reviews that do exist. */
function tokenFromReadyFile(ready, reviewId) {
  const reviews = (ready && ready.reviews) || {};
  const ids = Object.keys(reviews);

  if (reviewId === undefined) {
    if (ids.length === 1) return tokenFromReadyFile(ready, ids[0]);
    throw new Error(
      "tokenFor: the helper is holding " +
        ids.length +
        " reviews (" +
        (ids.join(", ") || "none") +
        "), so there is no single token. Name the review: handle.tokenFor(id)."
    );
  }

  const entry = reviews[reviewId];
  if (!entry) {
    throw new Error(
      "tokenFor: no review named '" + reviewId + "'. The helper is holding: " + (ids.join(", ") || "none")
    );
  }
  const token = typeof entry === "string" ? entry : entry.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new Error("tokenFor: review '" + reviewId + "' has no token in " + SERVICE_READY_FILE);
  }
  return token;
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
 * The OS's own view of a process's state, as a single letter. 'T' is stopped on
 * both macOS and Linux, which is how suspend() proves SIGSTOP actually landed
 * rather than assuming it did.
 *
 * @returns {string|null} null when the process is gone or ps is unavailable
 */
function processState(pid) {
  try {
    const out = execFileSync("ps", ["-o", "state=", "-p", String(pid)], { stdio: "pipe" })
      .toString()
      .trim();
    return out.length > 0 ? out[0] : null;
  } catch (err) {
    return null;
  }
}

function processStopped(pid) {
  return processState(pid) === "T";
}

/**
 * Start the service and wait until it is genuinely up.
 *
 * @param {{stateDir?: string, entry?: string, args?: string[],
 *          env?: Record<string,string>, allowedOrigins?: string[],
 *          reviews?: string[], readyTimeoutMs?: number}} [options]
 *   `reviews` names the review ids the helper should have open when it reports
 *   ready. Default one, so the common test says nothing about it and still gets
 *   a review with a token.
 * @returns {Promise<object>} a handle with port, url, reviews, tokenFor,
 *   stateDir, logs, and stop / kill9 / suspend / resume / waitForExit
 */
async function startService(options = {}) {
  const stateDir = options.stateDir || makeStateDir();
  const entry = options.entry || SERVICE_ENTRY;
  const readyTimeoutMs = options.readyTimeoutMs ?? 10000;
  const reviewIds = options.reviews && options.reviews.length > 0 ? options.reviews : [DEFAULT_REVIEW_ID];

  if (!fs.existsSync(entry)) {
    throw new Error("startService: no such entry point: " + entry);
  }

  const env = Object.assign({}, process.env, {
    LAHE_STATE_DIR: stateDir,
    LAHE_ALLOWED_ORIGINS: (options.allowedOrigins || []).join(","),
    LAHE_REVIEWS: reviewIds.join(",")
  }, options.env || {});

  const child = spawn(process.execPath, [entry].concat(options.args || []), {
    env: env,
    // The IPC channel is a lifetime lease, not a test-control protocol. If a
    // Playwright worker is interrupted or crashes, the channel closes and the
    // test helper exits instead of becoming a PID-1 orphan that polls forever.
    // Real `lahe serve` / `lahe add` processes have no IPC channel and are
    // therefore unaffected.
    stdio: ["ignore", "pipe", "pipe", "ipc"]
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
    reviews: ready.reviews,
    reviewIds: Object.keys(ready.reviews),
    url: "http://127.0.0.1:" + ready.port,
    stateDir: stateDir,
    entry: entry,
    /** The token for one review. Omit the id only when there is exactly one. */
    tokenFor: function (reviewId) {
      return tokenFromReadyFile(ready, reviewId);
    },
    /** Where a review's items are posted. Omit the id only when there is one. */
    itemsUrlFor: function (reviewId) {
      const id = reviewId === undefined ? handle.singleReviewId() : reviewId;
      return "http://127.0.0.1:" + ready.port + "/reviews/" + encodeURIComponent(id) + "/items";
    },
    singleReviewId: function () {
      const ids = Object.keys(ready.reviews);
      if (ids.length === 1) return ids[0];
      throw new Error(
        "this helper is holding " +
          ids.length +
          " reviews (" +
          (ids.join(", ") || "none") +
          "), so there is no single one. Name the review."
      );
    },
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
    },
    /**
     * SIGSTOP. The helper keeps its socket and answers nothing.
     *
     * This is a DIFFERENT failure from a dead helper and the library has to tell
     * them apart: a killed helper refuses the connection immediately, so the
     * status line can say kept-locally within a poll, while a suspended one
     * accepts the connection and then hangs, which is what a laptop coming back
     * from sleep and a paused container both look like. A sync client written
     * only against kill9 blocks the reviewer here.
     */
    suspend: async function (timeoutMs = 5000) {
      return suspendService(handle, timeoutMs);
    },
    /** SIGCONT. Everything queued against the socket is delivered at once. */
    resume: async function (timeoutMs = 5000) {
      return resumeService(handle, timeoutMs);
    },
    /** 'T' while suspended. Null once the process is gone. */
    state: function () {
      return processState(child.pid);
    },
    suspended: function () {
      return processStopped(child.pid);
    }
  };

  // Kept for the single-review case, which is most tests. It throws rather than
  // guessing when the helper is holding more than one review.
  Object.defineProperty(handle, "token", {
    enumerable: true,
    get: function () {
      return tokenFromReadyFile(ready);
    }
  });
  Object.defineProperty(handle, "itemsUrl", {
    enumerable: true,
    get: function () {
      return handle.itemsUrlFor();
    }
  });

  return handle;
}

/**
 * Suspend the helper and wait until the OS says it is really stopped.
 *
 * Waiting matters: SIGSTOP is delivered asynchronously, so a test that suspends
 * and immediately asserts "the request hangs" can race the signal and watch the
 * request succeed instead.
 */
async function suspendService(handle, timeoutMs = 5000) {
  if (!handle.alive()) {
    throw new Error("suspend: the service process is already gone (pid " + handle.pid + ")");
  }
  process.kill(handle.pid, "SIGSTOP");
  await pollUntil(
    function () {
      if (!processAlive(handle.pid)) {
        throw new Error("suspend: the service died instead of stopping (pid " + handle.pid + ")");
      }
      return processStopped(handle.pid) ? true : null;
    },
    {
      timeoutMs: timeoutMs,
      message: "the service process to report itself stopped after SIGSTOP",
      describe: function () {
        return { pid: handle.pid, state: processState(handle.pid) };
      }
    }
  );
  return true;
}

/** Resume it, and wait until the OS says it is running again. */
async function resumeService(handle, timeoutMs = 5000) {
  if (!handle.alive()) {
    throw new Error("resume: the service process is gone (pid " + handle.pid + ")");
  }
  process.kill(handle.pid, "SIGCONT");
  await pollUntil(
    function () {
      if (!processAlive(handle.pid)) {
        throw new Error("resume: the service died instead of continuing (pid " + handle.pid + ")");
      }
      return processStopped(handle.pid) ? null : true;
    },
    {
      timeoutMs: timeoutMs,
      message: "the service process to leave the stopped state after SIGCONT",
      describe: function () {
        return { pid: handle.pid, state: processState(handle.pid) };
      }
    }
  );
  return true;
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

/** Which reviews have a folder on disk. */
function listReviewDirs(stateDir) {
  const dir = path.join(stateDir, REVIEWS_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter(function (entry) {
      return entry.isDirectory();
    })
    .map(function (entry) {
      return entry.name;
    })
    .sort();
}

/** Where one review's append-only log lives. */
function eventLogPath(stateDir, reviewId) {
  return path.join(stateDir, REVIEWS_DIR, reviewId, EVENT_LOG_FILE);
}

/**
 * Every line one review appended to its log, parsed.
 *
 * This is the reader behind every durability and every refusal assertion, which
 * is why the review id is not optional in spirit: reading the wrong path returns
 * an empty array, and an empty array is what a passing refusal assertion looks
 * like. It is inferred only when the state directory holds exactly one review,
 * and it throws, naming them, when it holds several.
 *
 * A torn final line (kill -9 mid write) is reported as a parse failure naming
 * the line rather than swallowed, because "the last line is half written" is a
 * thing a durability test asserts, not a thing it should have to discover.
 *
 * @param {string} stateDir
 * @param {string} [reviewId]
 * @returns {object[]}
 */
function readEventLog(stateDir, reviewId) {
  const id = reviewId === undefined ? inferReviewId(stateDir) : reviewId;
  const logPath = eventLogPath(stateDir, id);
  if (!fs.existsSync(logPath)) return [];
  const lines = fs
    .readFileSync(logPath, "utf8")
    .split("\n")
    .filter(function (line) {
      return line.trim().length > 0;
    });
  return lines.map(function (line, index) {
    try {
      return JSON.parse(line);
    } catch (err) {
      throw new Error(
        "readEventLog: line " +
          (index + 1) +
          " of " +
          logPath +
          " is not JSON. A torn last line after kill -9 is expected and readable with " +
          "readEventLogRaw(); anything earlier in the file is a bug in the writer.\n  " +
          line
      );
    }
  });
}

/** The raw lines, for a durability test that means to look at a torn one. */
function readEventLogRaw(stateDir, reviewId) {
  const id = reviewId === undefined ? inferReviewId(stateDir) : reviewId;
  const logPath = eventLogPath(stateDir, id);
  if (!fs.existsSync(logPath)) return [];
  return fs.readFileSync(logPath, "utf8").split("\n").filter(function (line) {
    return line.length > 0;
  });
}

function inferReviewId(stateDir) {
  const ids = listReviewDirs(stateDir);
  if (ids.length === 1) return ids[0];
  if (ids.length === 0) {
    // Nothing has been written yet. Name the default so the ordinary
    // "the log is still empty" assertion reads an honest path.
    return DEFAULT_REVIEW_ID;
  }
  throw new Error(
    "readEventLog: " +
      stateDir +
      " holds " +
      ids.length +
      " reviews (" +
      ids.join(", ") +
      "). Name the one you mean: readEventLog(stateDir, reviewId)."
  );
}

module.exports = {
  SERVICE_ENTRY,
  STUB_SERVICE_ENTRY,
  SERVICE_READY_FILE,
  DEFAULT_REVIEW_ID,
  REVIEWS_DIR,
  EVENT_LOG_FILE,
  makeStateDir,
  readReadyFile,
  tokenFromReadyFile,
  listReviewDirs,
  eventLogPath,
  readEventLog,
  readEventLogRaw,
  tcpProbe,
  processAlive,
  processState,
  processStopped,
  startService,
  killServiceHard,
  suspendService,
  resumeService
};
