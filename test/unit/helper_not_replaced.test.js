// A helper with a reviewer on it is not replaced under them.
//
// The shared helper is stopped and started again whenever a command finds the
// code on disk newer than the running process. That is right when nobody is
// using it and wrong when somebody is: on 2026-09-10 and 2026-09-11 it fired
// five times in a day and twice inside one minute, and each time the person
// with a page open lost their connection, their window session, and in one case
// the comment boxes they had open (see
// test/unit/window_sessions_restart.test.js for the three observations).
//
// So a command about to replace a stale helper reads the window table first. If
// a page spoke within LIVE_WINDOW_MS the helper is left running and the command
// says so in one sentence. `lahe serve --restart` is the deliberate override.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const childProcess = require("node:child_process");

const { pollUntil } = require("../helpers/poll.js");
const reviewsModule = require("../../src/service/reviews.js");
const stateDirModule = require("../../src/service/state_dir.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const serviceModule = require("../../src/service/index.js");
const protocol = require("../../src/shared/protocol.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "lahe.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function freePort() {
  return new Promise(function (resolve, reject) {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () {
      const port = server.address().port;
      server.close(function () {
        resolve(port);
      });
    });
  });
}

// ---------------------------------------------------------------------------
// The CLI leaves a helper with a reviewer on it alone
// ---------------------------------------------------------------------------

/** A scratch stand-in for this clone's src/, so mtimes here touch nothing real. */
function scratchSource() {
  const dir = tempDir("lahe-source-");
  const file = path.join(dir, "service", "reviews.js");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "// stand-in for a file the helper loads at boot\n");
  return { dir: dir, file: file };
}

function setMtime(file, whenMs) {
  const seconds = whenMs / 1000;
  fs.utimesSync(file, seconds, seconds);
}

function readyFile(dir) {
  return JSON.parse(fs.readFileSync(stateDirModule.readyPath(dir), "utf8"));
}

async function stopHelper(dir) {
  const readyPath = stateDirModule.readyPath(dir);
  if (!fs.existsSync(readyPath)) return;
  let ready;
  try {
    ready = JSON.parse(fs.readFileSync(readyPath, "utf8"));
  } catch (err) {
    return;
  }
  if (!ready || typeof ready.pid !== "number") return;
  try {
    process.kill(ready.pid, "SIGTERM");
  } catch (err) {
    if (err.code !== "ESRCH") throw err;
  }
  await pollUntil(async function () {
    return !(await serviceModule.probeHealth(protocol.DEFAULT_HOST, ready.port));
  }, { timeoutMs: 10000, message: "the helper to stop" });
}

/** Put a holder in the table by hand, as a page that spoke `agoMs` ago. */
function pretendSomebodyIsReviewing(dir, reviewId, agoMs) {
  stateDirModule.ensureDir(dir);
  stateDirModule.writeAtomic(
    stateDirModule.windowsPath(dir),
    JSON.stringify({
      version: 1,
      saved_at: new Date().toISOString(),
      sessions: {
        [reviewId]: {
          window_id: "win-open",
          session_secret: "a".repeat(48),
          since: new Date(Date.now() - agoMs).toISOString(),
          since_ms: Date.now() - agoMs,
          last_seen: Date.now() - agoMs
        }
      }
    }) + "\n"
  );
}

test("a stale helper with a reviewer on it is left running, and the caller is told why", async () => {
  const dir = path.join(tempDir("lahe-keep-helper-"), "state");
  const source = scratchSource();
  const port = await freePort();
  const previous = process.env.LAHE_SOURCE_DIR;
  process.env.LAHE_SOURCE_DIR = source.dir;

  try {
    const boot = await sessionCommand.startHelper(dir, port);
    assert.equal(boot.started, true, "nothing was running, so one was started");
    const first = readyFile(dir);

    // The code on disk is now newer than the running helper, which is the whole
    // trigger for a replacement, AND somebody has a page open on it.
    setMtime(source.file, Date.parse(first.started_at) + 1000);
    pretendSomebodyIsReviewing(dir, "rkeep01", 8000);

    const kept = await sessionCommand.startHelper(dir, port);
    assert.equal(kept.started, false, "the reviewer's helper is not replaced under them");
    assert.equal(kept.stale, true, "it is still behind the code, and the caller knows it");
    assert.match(kept.keptForReviewer, /rkeep01/, "the sentence names the review that is open");
    assert.match(kept.keptForReviewer, /8s ago/, "and how long ago that page spoke");
    assert.match(kept.keptForReviewer, /lahe serve --restart/, "and how to override it");
    assert.equal(readyFile(dir).pid, first.pid, "same process, same run");

    // The same helper, the same staleness, nobody reviewing: replaced as before.
    fs.unlinkSync(stateDirModule.windowsPath(dir));
    const replaced = await sessionCommand.startHelper(dir, port);
    assert.equal(replaced.started, true, "with nobody on it, a stale helper is still replaced");
    assert.equal(replaced.keptForReviewer, null);
    assert.notEqual(readyFile(dir).pid, first.pid, "a new process is answering");
  } finally {
    if (previous === undefined) delete process.env.LAHE_SOURCE_DIR;
    else process.env.LAHE_SOURCE_DIR = previous;
    await stopHelper(dir);
  }
});

test("lahe serve --restart replaces the helper anyway, and says whose page it interrupted", async () => {
  const dir = path.join(tempDir("lahe-force-restart-"), "state");
  const port = await freePort();

  try {
    const boot = await sessionCommand.startHelper(dir, port);
    assert.equal(boot.started, true);
    const first = readyFile(dir);
    pretendSomebodyIsReviewing(dir, "rforce01", 3000);

    // Detached, the way the command is really run: it does not exit, it serves.
    const child = childProcess.spawn(
      process.execPath,
      [BIN, "serve", "--restart", "--port", String(port), "--state-dir", dir],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    let out = "";
    child.stdout.on("data", function (chunk) {
      out += String(chunk);
    });

    await pollUntil(async function () {
      const live = await serviceModule.probeHealth(protocol.DEFAULT_HOST, port);
      return !!live && live.started_at !== first.started_at;
    }, { timeoutMs: 10000, message: "the forced restart to put a new helper on the port" });

    assert.match(out, /rforce01/, "the override names the review it is interrupting");
    assert.match(out, /Replacing the helper anyway/, "and does not do it silently");
    assert.notEqual(readyFile(dir).pid, first.pid, "a new process is answering");
    child.kill("SIGTERM");
  } finally {
    await stopHelper(dir);
  }
});
