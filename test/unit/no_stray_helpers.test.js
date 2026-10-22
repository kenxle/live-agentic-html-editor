// The survivor check counts only its own run (test/helpers/temp_helpers.js).
//
// Each test run gets its own TMPDIR folder, and the check counts only helpers
// whose command line names that folder. A helper from another run in the same
// checkout, or one somebody started by hand, is never counted and never
// stopped. Real helpers on free ports and temp state dirs, never 7817.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const stateDir = require("../../src/service/state_dir.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const { onFreePort } = require("../helpers/free_port.js");
const { makeRunRoot, strayHelpers, reapStrayHelpers, stopTempHelpers } = require("../helpers/temp_helpers.js");

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code !== "ESRCH"; }
}

async function helperIn(root) {
  const dir = path.join(fs.mkdtempSync(path.join(root, "lahe-stray-")), "state");
  await onFreePort((p) => sessionCommand.startHelper(dir, p));
  return { dir, pid: JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8")).pid };
}

test("the survivor check counts and stops only its own run's helpers", { skip: process.platform === "win32" }, async (t) => {
  const ours = makeRunRoot();
  const elsewhere = makeRunRoot();
  const outside = await helperIn(elsewhere);
  t.after(() => stopTempHelpers(outside.dir));
  assert.deepEqual(strayHelpers(ours), [], "a helper outside the run is not counted");
  assert.deepEqual(await reapStrayHelpers(ours, 200), [], "and the run passes");
  assert.ok(alive(outside.pid), "and it is left running");

  const inside = await helperIn(ours);
  t.after(() => stopTempHelpers(inside.dir));
  // Registered last, so the helpers are stopped before their folders go.
  // (Hooks run in the order registered; a helper whose service.json is gone
  // can no longer be found and stopped.)
  t.after(() => {
    fs.rmSync(ours, { recursive: true, force: true });
    fs.rmSync(elsewhere, { recursive: true, force: true });
  });
  assert.deepEqual(strayHelpers(ours).map((p) => p.pid), [inside.pid], "only the run's own helper counts");
  const left = await reapStrayHelpers(ours, 200);
  assert.deepEqual(left.map((p) => [p.pid, p.stopped]), [[inside.pid, true]], "it is reported and stopped");
  assert.equal(alive(inside.pid), false);
  assert.ok(alive(outside.pid), "the other run's helper is still untouched");
});

// The wrapper (scripts/no_stray_helpers.js) makes the run folder, and removes it
// at the end. One unit run left about 600 MB in it; a few dozen filled a disk.

const wrapper = require("../../scripts/no_stray_helpers.js");

/** Run the wrapper on a command, with its messages held back. */
async function wrap(argv, options) {
  const messages = [];
  let runRoot = null;
  const note = (text) => { messages.push(String(text)); };
  const code = await wrapper.main(argv, Object.assign({ onRunRoot: (r) => { runRoot = r; }, out: note, err: note }, options));
  return { code, runRoot, output: messages.join("") };
}

test("the wrapper removes its run folder after a clean run", async () => {
  const command = "require('fs').writeFileSync(require('path').join(process.env.TMPDIR, 'scratch.txt'), 'x')";
  const result = await wrap([process.execPath, "-e", command], { graceMs: 200 });
  assert.equal(result.code, 0);
  assert.ok(path.basename(result.runRoot).startsWith("lahe-run-"));
  assert.equal(fs.existsSync(result.runRoot), false, "the run folder and what the command put in it are gone");
});

test("the wrapper keeps its run folder, and prints it, when a helper survived", { skip: process.platform === "win32" }, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-wrap-test-"));
  const pidFile = path.join(scratch, "fake.pid");
  let kept = null;
  t.after(() => {
    // The fake helper is ours: stop it, then remove the folders we made.
    try { process.kill(Number(fs.readFileSync(pidFile, "utf8")), "SIGKILL"); } catch (err) { /* already gone */ }
    if (kept) fs.rmSync(kept, { recursive: true, force: true });
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  // A detached process whose command line looks like a helper on a state dir
  // under the run folder, and which no state dir record names, so the wrapper
  // cannot stop it.
  const keepAlive = "require('net').createServer().listen(0)";
  const command =
    "const { spawn } = require('child_process'); const path = require('path');" +
    "const child = spawn(process.execPath, ['-e', " + JSON.stringify(keepAlive) + ", 'bin/lahe.js', 'serve', '--state-dir', path.join(process.env.TMPDIR, 'fake-state')], { detached: true, stdio: 'ignore' });" +
    "child.unref(); require('fs').writeFileSync(process.argv[1], String(child.pid));";
  const result = await wrap([process.execPath, "-e", command, pidFile], { graceMs: 200 });
  kept = result.runRoot;
  assert.equal(result.code, 1, "the run fails");
  assert.ok(fs.existsSync(result.runRoot), "the run folder is kept as evidence");
  assert.ok(result.output.includes(result.runRoot), "and its path is printed");
});

/**
 * Wait for a signalled process to go. A zombie counts as gone: it has stopped,
 * and a container's first process may never reap it.
 */
async function goneWithin(pid, ms) {
  const until = Date.now() + ms;
  for (;;) {
    let zombie = false;
    try { zombie = /^\S+ \(.*\) Z/.test(fs.readFileSync("/proc/" + pid + "/stat", "utf8")); } catch (err) { /* no /proc */ }
    if (!alive(pid) || zombie) return true;
    if (Date.now() > until) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// LAHE-unit-run-timeout: one stuck test used to hold the unit run for a day,
// because nothing in the chain had a deadline. The wrapper now has one for the
// whole run, and stops the command and everything it started when it passes.

test("the wrapper stops a run that outlives its limit, and fails it", { skip: process.platform === "win32" }, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-wrap-test-"));
  const pidFile = path.join(scratch, "grandchild.pid");
  t.after(() => {
    try { process.kill(Number(fs.readFileSync(pidFile, "utf8")), "SIGKILL"); } catch (err) { /* already gone */ }
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  // Like `node --test`, the command runs its work in a child of its own, and
  // neither ever exits.
  const command =
    "const { spawn } = require('child_process');" +
    "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });" +
    "require('fs').writeFileSync(process.argv[1], String(child.pid)); setInterval(() => {}, 1000);";
  const started = Date.now();
  const result = await wrap([process.execPath, "-e", command, pidFile], { graceMs: 200, limitMs: 1500 });
  assert.equal(result.code, 1, "the run fails");
  assert.ok(Date.now() - started < 10000, "and ends near its limit");
  assert.match(result.output, /limit/, "the output says the run hit its limit");
  const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
  assert.equal(await goneWithin(grandchild, 3000), true, "what the command started is stopped too");
});

test("the wrapper reads its limit from --limit-minutes before the command", () => {
  assert.deepEqual(wrapper.parseArgs(["--limit-minutes", "30", "node", "--test", "x"]), { limitMs: 30 * 60000, command: ["node", "--test", "x"] });
  assert.deepEqual(wrapper.parseArgs(["node", "--limit-minutes", "3"]), { limitMs: null, command: ["node", "--limit-minutes", "3"] }, "a flag after the command is the command's");
});

test("package.json gives the unit run a limit", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8"));
  assert.match(pkg.scripts["test:unit"], /no_stray_helpers\.js --limit-minutes \d+ node --test/);
});

const service = require("../../src/service/index.js");
const net = require("node:net");

test("probeHealth gives up on a port that accepts and never answers", async (t) => {
  const sockets = [];
  const silent = net.createServer((s) => { sockets.push(s); });
  await new Promise((resolve) => silent.listen(0, "127.0.0.1", resolve));
  t.after(() => { sockets.forEach((s) => s.destroy()); silent.close(); });
  const started = Date.now();
  const health = await service.probeHealth("127.0.0.1", silent.address().port, { timeoutMs: 300 });
  assert.equal(health, null);
  assert.ok(Date.now() - started < 3000, "it returned near its timeout");
  assert.ok(service.HEALTH_PROBE_TIMEOUT_MS > 0 && service.HEALTH_PROBE_TIMEOUT_MS <= 10000, "and has a default timeout");
});
