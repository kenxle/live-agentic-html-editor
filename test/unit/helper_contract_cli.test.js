// The CLI half of the helper version check (testing review I7).
//
// protocol_wire.test.js tests the pure verdict. These run the real
// `lahe add` against a real helper that is made to look one contract behind or
// ahead (test/helpers/helper_contract_preload.js), and check what the command
// does: replace an older helper, and refuse to replace a newer one. The
// literals are SERVICE_CONTRACT - 1 and SERVICE_CONTRACT + 1, so the test still
// tests the bump when the contract moves to 15.
//
// The layer's own check (a new layer refuses an old helper) is a browser
// concern: test/browser/helper_contract_layer.spec.js.
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
const PRELOAD = path.join(REPO_ROOT, "test", "helpers", "helper_contract_preload.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-contract-"));
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

function runAdd(args, skew) {
  const env = Object.assign({}, process.env);
  const nodeArgs = [];
  if (skew) {
    env.LAHE_TEST_HELPER_CONTRACT_SKEW = String(skew);
    nodeArgs.push("--require", PRELOAD);
  }
  const result = { code: 0, stdout: "", stderr: "" };
  try {
    result.stdout = execFileSync(process.execPath, nodeArgs.concat([BIN, "add"], args), {
      env: env,
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
    if (err.code === "ESRCH") return;
    throw err;
  }
  await pollUntil(
    function () {
      try {
        process.kill(ready.pid, 0);
        return null;
      } catch (err) {
        return err.code === "ESRCH" ? true : null;
      }
    },
    { message: "the helper to leave the process table" }
  );
}

async function workspace() {
  const dir = tempDir();
  const page = path.join(dir, "report.html");
  fs.writeFileSync(page, "<!doctype html><html><head><title>R</title></head><body><p>One paragraph.</p></body></html>\n");
  const stateDir = path.join(tempDir(), "state");
  const port = await freePort();
  const args = [page, "--port", String(port), "--state-dir", stateDir];
  return { args, stateDir, port };
}

function helperPid(stateDir) {
  return JSON.parse(fs.readFileSync(path.join(stateDir, "service.json"), "utf8")).pid;
}

test("lahe add replaces a helper one contract behind, and says why", async () => {
  const w = await workspace();
  try {
    const first = runAdd(w.args);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    const before = helperPid(w.stateDir);

    const again = runAdd(w.args, -1);
    assert.equal(again.code, 0, again.stdout + again.stderr);
    const old = protocol.SERVICE_CONTRACT - 1;
    assert.match(again.stdout, new RegExp("older service contract " + old + "; this clone requires " + protocol.SERVICE_CONTRACT));
    assert.match(again.stdout, /started again/);
    assert.notEqual(helperPid(w.stateDir), before, "a new helper process replaced the old one");
    const health = await service.probeHealth("127.0.0.1", w.port);
    assert.equal(health.service_contract, protocol.SERVICE_CONTRACT, "and it is on this clone's contract");
  } finally {
    await stopHelper(w.stateDir);
  }
});

test("lahe add refuses to replace a helper one contract ahead", async () => {
  const w = await workspace();
  try {
    const first = runAdd(w.args);
    assert.equal(first.code, 0, first.stdout + first.stderr);
    const before = helperPid(w.stateDir);

    const again = runAdd(w.args, 1);
    assert.notEqual(again.code, 0, "the command fails");
    assert.match(again.stderr, new RegExp("service contract " + (protocol.SERVICE_CONTRACT + 1)));
    assert.match(again.stderr, /Update this clone/);
    assert.equal(helperPid(w.stateDir), before, "the newer helper was left running");
  } finally {
    await stopHelper(w.stateDir);
  }
});
