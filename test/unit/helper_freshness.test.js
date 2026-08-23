// The helper that outlived the code it is running.
//
// THE SCAR, TWICE. The predecessor tool wore it first (human-review's 8bb9ce4:
// an upgraded CLI against a stale running helper silently serves broken
// pieces), the architecture review wrote it down as an open finding for this
// tool, and on 2026-08-23 it happened here. A merge changed the `contract` array
// in src/shared/review_format.js. The helper had been up since 2026-08-21,
// holding its modules in memory, so every review.json it wrote carried the OLD
// 31-entry contract with no `subject` field. Static servers are spawned per
// review and so were current: injection worked, the page looked right, and the
// only stale thing on the machine was the one file the agent reads.
//
// The gate that would NOT have caught it is a version comparison. package.json's
// version did not change that day and the hand-bumped service contract did not
// either, so both numbers matched and both would have reported everything fine.
// The signal these tests pin is the filesystem: the helper's own start instant
// against the newest mtime of the code it loaded.
//
// Three things are pinned here, and the third is not a nicety:
//
//   1. A helper older than the code is detected and replaced.
//   2. A helper that is CURRENT is left alone, same pid, same run of it. A
//      restart drops every open review page's connection, so a check that
//      bounces on every command is worse than the bug.
//   3. The restart is announced. The reviewer watching the rail go unreachable
//      is owed the reason in plain words.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { pollUntil } = require("../helpers/poll.js");
const service = require("../../src/service/index.js");
const sourceStamp = require("../../src/service/source_stamp.js");
const sessionCommand = require("../../src/cli/commands/session.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "lahe.js");

const PAGE = [
  "<!doctype html>",
  "<html>",
  "  <head><title>A report</title></head>",
  "  <body><h1>A report</h1><p>One paragraph.</p></body>",
  "</html>",
  ""
].join("\n");

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

function run(command, args, env) {
  const result = { code: 0, stdout: "", stderr: "" };
  try {
    result.stdout = execFileSync(process.execPath, [BIN, command].concat(args), {
      env: Object.assign({}, process.env, env || {}),
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8"
    });
  } catch (err) {
    result.code = typeof err.status === "number" ? err.status : 1;
    result.stdout = err.stdout ? String(err.stdout) : "";
    result.stderr = err.stderr ? String(err.stderr) : "";
  }
  return result;
}

function readyFile(stateDir) {
  return JSON.parse(fs.readFileSync(path.join(stateDir, "service.json"), "utf8"));
}

/**
 * A scratch tree standing in for this clone's `src/`.
 *
 * The check reads real mtimes, and the real clone's mtimes are shared with every
 * other test file running beside this one: touching them would make a helper
 * another test just started look stale mid-assertion. LAHE_SOURCE_DIR is the
 * same seam LAHE_STATE_DIR and LAHE_HOME_DIR give the state directory and the
 * home root, and it is what keeps this test from reaching outside its own
 * sandbox.
 */
function scratchSource() {
  const dir = tempDir("lahe-source-");
  const file = path.join(dir, "service", "reviews.js");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "// stand-in for a file the helper loads at boot\n");
  return { dir: dir, file: file };
}

/** Move one file's mtime to an exact instant, in milliseconds. */
function setMtime(file, whenMs) {
  const seconds = whenMs / 1000;
  fs.utimesSync(file, seconds, seconds);
}

/** Stop a helper the way a user's Ctrl-C would, and wait for the port to go quiet. */
async function stopHelper(stateDir) {
  const readyPath = path.join(stateDir, "service.json");
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
  await pollUntil(
    async function () {
      const up = await service.probeHealth("127.0.0.1", ready.port);
      return up ? null : true;
    },
    { message: "the helper to stop answering" }
  );
}

// ---------------------------------------------------------------------------
// The check itself
// ---------------------------------------------------------------------------

test("a helper that started after the last source change is not stale", () => {
  const source = scratchSource();
  const startedMs = Date.now();
  setMtime(source.file, startedMs - 60000);

  const verdict = sourceStamp.helperPredatesSource(new Date(startedMs).toISOString(), {
    roots: [source.dir]
  });
  assert.equal(verdict.stale, false, "the code has not moved since the helper booted");
  assert.equal(verdict.source_mtime_ms < verdict.helper_started_ms, true);
});

test("a source file changed after the helper started makes it stale", () => {
  const source = scratchSource();
  const startedMs = Date.now();
  setMtime(source.file, startedMs + 1000);

  const verdict = sourceStamp.helperPredatesSource(new Date(startedMs).toISOString(), {
    roots: [source.dir]
  });
  assert.equal(verdict.stale, true, "the process is running code this clone no longer has");
});

test("a file in a nested directory counts: the helper loads the whole tree", () => {
  const source = scratchSource();
  const startedMs = Date.now();
  setMtime(source.file, startedMs - 60000);
  const nested = path.join(source.dir, "shared", "deeper", "review_format.js");
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, "// the contract text lives in a file like this\n");
  setMtime(nested, startedMs + 1000);

  assert.equal(
    sourceStamp.helperPredatesSource(new Date(startedMs).toISOString(), { roots: [source.dir] }).stale,
    true
  );
});

test("a check that cannot tell never bounces a helper other sessions are using", () => {
  const source = scratchSource();
  setMtime(source.file, Date.now() + 60000);

  ["", "not an instant", undefined, null, 17].forEach(function (startedAt) {
    assert.equal(
      sourceStamp.helperPredatesSource(startedAt, { roots: [source.dir] }).stale,
      false,
      "an unreadable start instant is not evidence of anything: " + JSON.stringify(startedAt)
    );
  });

  const missing = path.join(tempDir("lahe-source-missing-"), "nothing-here");
  assert.equal(
    sourceStamp.helperPredatesSource(new Date(0).toISOString(), { roots: [missing] }).stale,
    false,
    "and neither is a source tree that is not there"
  );
});

test("the roots are this clone's own code, and LAHE_SOURCE_DIR replaces them", () => {
  const defaults = sourceStamp.roots();
  assert.deepEqual(
    defaults,
    [path.join(REPO_ROOT, "src"), path.join(REPO_ROOT, "vendor")],
    "src/ plus the vendored packages the helper requires at boot"
  );
  assert.equal(
    defaults.indexOf(path.join(REPO_ROOT, "dist")),
    -1,
    "and NOT dist/: the helper re-reads the built bundle from disk, so a rebuild must not force a restart"
  );

  const previous = process.env.LAHE_SOURCE_DIR;
  const scratch = tempDir("lahe-source-env-");
  process.env.LAHE_SOURCE_DIR = scratch;
  try {
    assert.deepEqual(sourceStamp.roots(), [scratch]);
  } finally {
    if (previous === undefined) delete process.env.LAHE_SOURCE_DIR;
    else process.env.LAHE_SOURCE_DIR = previous;
  }
});

// ---------------------------------------------------------------------------
// The command
// ---------------------------------------------------------------------------

test("a current helper is left exactly where it is, and a stale one is restarted and said out loud", async () => {
  const pageDir = tempDir("lahe-stale-page-");
  const page = path.join(pageDir, "report.html");
  fs.writeFileSync(page, PAGE);
  const stateDir = path.join(tempDir("lahe-stale-state-"), "state");
  const source = scratchSource();
  const port = await freePort();
  const env = { LAHE_SOURCE_DIR: source.dir };

  try {
    const first = run("add", [page, "--port", String(port), "--state-dir", stateDir], env);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    const boot = readyFile(stateDir);
    const review = /data-lahe-review="([^"]+)"/.exec(fs.readFileSync(page, "utf8"))[1];
    const eventsPath = path.join(stateDir, "reviews", review, "events.jsonl");
    const eventsBefore = fs.readFileSync(eventsPath, "utf8");
    const tokenBefore = boot.reviews[review].token;

    // Nothing has changed since it booted.
    setMtime(source.file, Date.parse(boot.started_at) - 1000);
    const current = run("add", [page, "--port", String(port), "--state-dir", stateDir], env);
    assert.equal(current.code, 0, current.stdout + current.stderr);
    const unchanged = readyFile(stateDir);
    assert.equal(unchanged.pid, boot.pid, "the SAME helper process: a current helper is not bounced");
    assert.equal(unchanged.started_at, boot.started_at, "and the same run of it");
    assert.doesNotMatch(current.stdout, /restarted/i, "and add claims no restart it did not do");

    // Now the code moves under it, which is the whole finding.
    setMtime(source.file, Date.parse(boot.started_at) + 1000);
    const stale = run("add", [page, "--port", String(port), "--state-dir", stateDir], env);
    assert.equal(stale.code, 0, stale.stdout + stale.stderr);

    const after = readyFile(stateDir);
    assert.notEqual(after.pid, boot.pid, "the old process is gone");
    assert.equal(
      Date.parse(after.started_at) > Date.parse(boot.started_at),
      true,
      "and the one answering now booted after the code changed"
    );
    const live = await service.probeHealth("127.0.0.1", port);
    assert.ok(live && live.ok, "a helper is answering when add returns");

    // Never silently. The reviewer's page just went unreachable for a moment.
    assert.match(
      stale.stdout,
      new RegExp(sourceStamp.REASON),
      "add says the helper was behind the code, in the one spelling of that reason"
    );
    assert.match(stale.stdout, /started again/i, "and that it was restarted");
    assert.match(stale.stdout, /reconnects on its own/i, "and that open pages come back by themselves");

    // And nothing was lost.
    assert.equal(fs.readFileSync(eventsPath, "utf8"), eventsBefore, "the event log is untouched");
    assert.ok(after.reviews[review], "the new helper holds the same review");
    assert.equal(after.reviews[review].token, tokenBefore, "with the same token, so the open page still authenticates");
    assert.equal(
      /data-lahe-review="([^"]+)"/.exec(fs.readFileSync(page, "utf8"))[1],
      review,
      "and the page is still on the review it has always had"
    );
  } finally {
    await stopHelper(stateDir);
  }
});

test("a served review survives the restart: the session, its static server, and the page come back", async () => {
  const pageDir = tempDir("lahe-stale-served-");
  const page = path.join(pageDir, "report.html");
  fs.writeFileSync(page, PAGE);
  const stateDir = path.join(tempDir("lahe-stale-served-state-"), "state");
  const source = scratchSource();
  const port = await freePort();
  const env = { LAHE_SOURCE_DIR: source.dir };
  let sessionId = null;

  try {
    const opened = run("review", [page, "--port", String(port), "--state-dir", stateDir], env);
    assert.equal(opened.code, 0, opened.stdout + opened.stderr);
    sessionId = opened.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
    const openUrl = opened.stdout.match(/^\s*open\s+(http:\/\/\S+)/m)[1];
    const boot = readyFile(stateDir);
    const review = opened.stdout.match(/^\s*review\s+(r[A-Za-z0-9_-]+)/m)[1];
    const eventsPath = path.join(stateDir, "reviews", review, "events.jsonl");
    const eventsBefore = fs.readFileSync(eventsPath, "utf8");
    const metaBefore = fs.readFileSync(path.join(stateDir, "reviews", review, "meta.json"), "utf8");

    // The reviewer has the page open. Now the code changes under the helper.
    setMtime(source.file, Date.parse(boot.started_at) + 1000);
    const again = run("review", [page, "--port", String(port), "--state-dir", stateDir, "--session", sessionId], env);
    assert.equal(again.code, 0, again.stdout + again.stderr);
    assert.match(again.stdout, new RegExp(sourceStamp.REASON));

    const after = readyFile(stateDir);
    assert.notEqual(after.pid, boot.pid, "the helper really was replaced");

    // The static server belongs to the agent session, not to the helper, so it
    // was never in the blast radius: the reviewer's URL still answers, still
    // with the script line put into the response rather than into their folder.
    const served = await fetch(openUrl);
    assert.equal(served.status, 200, "the page the reviewer has open still serves");
    const html = await served.text();
    assert.match(html, new RegExp('data-lahe-review="' + review + '"'), "still on the same review");
    assert.equal(fs.readFileSync(page, "utf8"), PAGE, "and still with nothing written into their folder");

    // The durable record is exactly as it was.
    assert.equal(fs.readFileSync(eventsPath, "utf8"), eventsBefore, "the event log is untouched");
    assert.equal(
      fs.readFileSync(path.join(stateDir, "reviews", review, "meta.json"), "utf8"),
      metaBefore,
      "and so is the review's meta"
    );
    const sessions = run("session", ["list", "--state-dir", stateDir], env);
    assert.equal(sessions.code, 0, sessions.stdout + sessions.stderr);
    assert.match(sessions.stdout, new RegExp(sessionId), "the agent session is still there");
    assert.match(sessions.stdout, /open/, "and still open");
  } finally {
    if (sessionId) {
      run("session", ["close", sessionId, "--state-dir", stateDir, "--port", String(port)], env);
    }
    await stopHelper(stateDir);
  }
});

test("session reopen replaces a stale helper and says why", async () => {
  const stateDir = path.join(tempDir("lahe-stale-session-"), "state");
  const source = scratchSource();
  const port = await freePort();
  const previous = process.env.LAHE_SOURCE_DIR;
  process.env.LAHE_SOURCE_DIR = source.dir;

  try {
    const boot = await sessionCommand.startHelper(stateDir, port);
    assert.deepEqual(boot, { started: true, stale: false }, "nothing was running, so one was started");
    const first = readyFile(stateDir);

    setMtime(source.file, Date.parse(first.started_at) - 1000);
    assert.deepEqual(
      await sessionCommand.startHelper(stateDir, port),
      { started: false, stale: false },
      "a current helper is left running"
    );
    assert.equal(readyFile(stateDir).pid, first.pid, "same process, same run");

    setMtime(source.file, Date.parse(first.started_at) + 1000);
    assert.deepEqual(
      await sessionCommand.startHelper(stateDir, port),
      { started: true, stale: true },
      "a helper older than the code is replaced, and the caller is told why so it can print it"
    );
    assert.notEqual(readyFile(stateDir).pid, first.pid, "a new process is answering");
  } finally {
    if (previous === undefined) delete process.env.LAHE_SOURCE_DIR;
    else process.env.LAHE_SOURCE_DIR = previous;
    await stopHelper(stateDir);
  }
});
