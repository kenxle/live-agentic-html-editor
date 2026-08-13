// `lahe add`: the install command. Task 3B.
//
// These tests run the REAL command through the real entry point
// (`node bin/lahe.js add ...`), because the thing under test is a command: its
// exit code, what it prints, what it leaves in the file, and the helper it
// starts. Calling run() in-process would skip the half of it that a user meets.
//
// Every invocation is pointed at a throwaway state directory and an ephemeral
// port. The default port is fixed on purpose (a page has it baked into its
// script tag), and a parallel test run would collide on it, which is the same
// reason 1A's specs pass --port.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { pollUntil } = require("../helpers/poll.js");
const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "lahe.js");

const PAGE = [
  "<!doctype html>",
  "<html>",
  "  <head><title>A report</title></head>",
  "  <body>",
  "    <h1>A report</h1>",
  "    <p>One paragraph.</p>",
  "  </body>",
  "</html>",
  ""
].join("\n");

/** A throwaway directory. Left in the OS temp; nothing here deletes. */
function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix || "lahe-3b-"));
}

/** A port nothing is listening on right now. */
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

/**
 * One `lahe add` run.
 *
 * @returns {{code: number, stdout: string, stderr: string}}
 */
function runAdd(args, env) {
  const result = { code: 0, stdout: "", stderr: "" };
  try {
    result.stdout = execFileSync(process.execPath, [BIN, "add"].concat(args), {
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

/** The helper `add` started, stopped the way a user's Ctrl-C would. */
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
    { message: "the helper add started to stop answering" }
  );
}

/** Every script tag `add` could have written, as matched text. */
function scriptTagsIn(html) {
  const found = html.match(/<script\b[^>]*data-lahe-review="[^"]*"[^>]*><\/script>/gi);
  return found || [];
}

function reviewIdIn(html) {
  const found = html.match(/data-lahe-review="([^"]+)"/);
  return found ? found[1] : null;
}

function tokenIn(html) {
  const found = html.match(/data-lahe-token="([^"]+)"/);
  return found ? found[1] : null;
}

/** A fresh page in a fresh directory, with a fresh state directory and port. */
async function aWorkspace() {
  const dir = tempDir();
  const pagePath = path.join(dir, "report.html");
  fs.writeFileSync(pagePath, PAGE);
  const stateDir = path.join(tempDir(), "state");
  const port = await freePort();
  return {
    dir: dir,
    page: pagePath,
    stateDir: stateDir,
    port: port,
    read: function () {
      return fs.readFileSync(pagePath, "utf8");
    },
    add: function (extra) {
      return runAdd(
        [pagePath, "--port", String(port), "--state-dir", stateDir].concat(extra || []),
        {}
      );
    },
    stop: function () {
      return stopHelper(stateDir);
    }
  };
}

test("add twice on the same file reuses the review, and --new does not", async () => {
  const work = await aWorkspace();
  try {
    const first = work.add();
    assert.equal(first.code, 0, "the first add succeeded:\n" + first.stdout + first.stderr);

    const afterFirst = work.read();
    const firstReview = reviewIdIn(afterFirst);
    const firstToken = tokenIn(afterFirst);
    assert.ok(firstReview, "the first add wrote a review id into the page");
    assert.ok(firstToken, "and its token");
    assert.equal(scriptTagsIn(afterFirst).length, 1, "exactly one script line");

    const second = work.add();
    assert.equal(second.code, 0, "the second add succeeded:\n" + second.stdout + second.stderr);

    const afterSecond = work.read();
    assert.equal(
      reviewIdIn(afterSecond),
      firstReview,
      "add twice on the same file reuses the review it already carries"
    );
    assert.equal(tokenIn(afterSecond), firstToken, "and the token that review was minted with");
    assert.equal(scriptTagsIn(afterSecond).length, 1, "still exactly one script line");
    assert.match(second.stdout, /reus/i, "and it says so rather than pretending it minted one");

    const third = work.add(["--new"]);
    assert.equal(third.code, 0, "add --new succeeded:\n" + third.stdout + third.stderr);

    const afterThird = work.read();
    assert.notEqual(reviewIdIn(afterThird), firstReview, "--new minted a second review");
    assert.notEqual(tokenIn(afterThird), firstToken, "with its own token");
    assert.equal(scriptTagsIn(afterThird).length, 1, "and replaced the line rather than adding one");
  } finally {
    await work.stop();
  }
});
