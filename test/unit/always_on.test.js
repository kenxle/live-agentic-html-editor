// The helper as the login item runs it (stable addresses, install Task 5.3).
//
//   V49  `--always-on` does not stop itself when quiet, and still stops when
//        its state folder is removed.
//   V50  With install.json, the CLI asks the login item for a helper and never
//        spawns one itself.
//   V52  A CLI pointed at a different state folder says so, instead of failing
//        on the port.
//   and  A stale always-on helper is replaced at a quiet moment even with a
//        review window open, through the login item; a busy one is left.
//
// No test registers a real login item. The login item is a runner the test
// passes in: it records the command it was asked to run, and where the real
// service manager would start the helper, it starts one the same way (a
// detached `bin/lahe.js serve --always-on`). Every helper runs on a free port
// in a temp state folder and is stopped in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");
const stateDir = require("../../src/service/state_dir.js");
const selfStop = require("../../src/service/self_stop.js");
const loginItem = require("../../src/service/login_item.js");
const serveCommand = require("../../src/cli/commands/serve.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const { pollUntil } = require("../helpers/poll.js");
const { onFreePort, freePort } = require("../helpers/free_port.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");
const GRACE = 1000;

function tempState() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-always-on-")));
  const dir = path.join(root, "state");
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir };
}

function ask(dir, atMs) {
  fs.writeFileSync(stateDir.stopWhenQuietPath(dir), JSON.stringify({ asked_at: new Date(atMs).toISOString() }));
}

function alwaysOnRig() {
  const w = tempState();
  const state = { at: 1000000, stops: [] };
  const instance = selfStop.createSelfStop({
    dir: w.dir,
    alwaysOn: true,
    agentSessions: { openSessions: () => [] },
    reviews: { openWindowReviews: () => [] },
    catalog: { seenAt: () => null },
    now: () => state.at,
    graceMs: GRACE,
    sweepMs: GRACE,
    owner: { pid: process.pid, started_at: "2026-10-11T12:00:00.000Z" },
    onStop: (reason) => state.stops.push(reason)
  });
  return Object.assign(w, { state, instance });
}

// --- V49 -------------------------------------------------------------------

test("V49: an always-on helper does not stop itself when quiet, even after a deferred close asked it to", () => {
  const r = alwaysOnRig();
  ask(r.dir, r.state.at);
  r.state.at += 100 * GRACE;
  r.instance.check();
  assert.deepEqual(r.state.stops, []);
});

test("V49: an always-on helper still stops when its state folder is removed", () => {
  const r = alwaysOnRig();
  r.instance.check();
  fs.rmSync(r.root, { recursive: true, force: true });
  r.instance.check();
  r.instance.check();
  assert.deepEqual(r.state.stops, [selfStop.REASON.STATE_DIR_GONE]);
});

test("V49: lahe serve takes --always-on", () => {
  const parsed = serveCommand.parseArgs(["--always-on", "--port", "4000"]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.options.alwaysOn, true);
  assert.equal(serveCommand.parseArgs([]).options.alwaysOn, undefined);
});

test("V49: an always-on helper says so in service.json and on /health, with its state-folder id", async (t) => {
  const w = tempState();
  const { result: helper } = await onFreePort((port) => service.serve({ port, stateDir: w.dir, quiet: true, alwaysOn: true }));
  t.after(() => helper.close());
  const health = await service.probeHealth(protocol.DEFAULT_HOST, helper.port);
  assert.equal(health.always_on, true);
  assert.equal(health.state_id, selfStop.stateToken(w.dir));
  const ready = JSON.parse(fs.readFileSync(stateDir.readyPath(w.dir), "utf8"));
  assert.equal(ready.always_on, true);
});

test("V49: a helper started without the flag reports always_on false", async (t) => {
  const w = tempState();
  const { result: helper } = await onFreePort((port) => service.serve({ port, stateDir: w.dir, quiet: true }));
  t.after(() => helper.close());
  const health = await service.probeHealth(protocol.DEFAULT_HOST, helper.port);
  assert.equal(health.always_on, false);
  assert.equal(JSON.parse(fs.readFileSync(stateDir.readyPath(w.dir), "utf8")).always_on, false);
});

// --- the login item, played by the test --------------------------------------

/**
 * A runner standing in for the service manager. It records every command, and
 * a start command starts a detached always-on helper, as launchd would.
 */
function fakeLoginItem(dir, port, options) {
  const opts = options || {};
  const calls = [];
  const runner = (command, args) => {
    calls.push([command].concat(args));
    if (opts.fail) return { status: 113, output: "Could not find service" };
    const child = childProcess.spawn(
      process.execPath,
      [BIN, "serve", "--always-on", "--port", String(port), "--state-dir", dir],
      { detached: true, stdio: "ignore" }
    );
    child.unref();
    return { status: 0, output: "" };
  };
  return { runner, calls };
}

function install(dir, port, extra) {
  const record = Object.assign(
    { system: loginItem.systemFor(process.platform) || "linux", label: "lahe-test-" + process.pid, port: port, state_dir: dir },
    extra || {}
  );
  loginItem.writeInstall(dir, record);
  return record;
}

function helperProcessesFor(dir) {
  const out = childProcess.execFileSync("ps", ["-axww", "-o", "command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\n").filter((line) => /bin\/lahe\.js serve\b/.test(line) && line.indexOf(dir) !== -1);
}

// --- V50 -------------------------------------------------------------------

test("V50: with install.json, startHelper asks the login item and does not spawn its own", async (t) => {
  const w = tempState();
  t.after(() => stopTempHelpers(w.dir));
  const port = await freePort();
  install(w.dir, port);
  const item = fakeLoginItem(w.dir, port);
  const result = await sessionCommand.startHelper(w.dir, port, { runner: item.runner });
  assert.equal(result.started, true);
  assert.equal(item.calls.length, 1, "one start command");
  assert.deepEqual(item.calls[0], loginItem.startCommands(loginItem.readInstall(w.dir))[0]);
  const health = await service.probeHealth(protocol.DEFAULT_HOST, port);
  assert.equal(health.always_on, true, "the helper answering is the login item's, not a plain spawn");
  assert.equal(helperProcessesFor(w.dir).length, 1);
});

test("V50: when the login item cannot start the helper, the CLI says so and spawns nothing", async (t) => {
  const w = tempState();
  t.after(() => stopTempHelpers(w.dir));
  const port = await freePort();
  install(w.dir, port);
  const item = fakeLoginItem(w.dir, port, { fail: true });
  await assert.rejects(
    sessionCommand.startHelper(w.dir, port, { runner: item.runner, waitMs: 300 }),
    /login item lahe-test-\d+ did not start the helper on 127\.0\.0\.1:\d+.*Could not find service/s
  );
  assert.equal(helperProcessesFor(w.dir).length, 0, "no helper was spawned behind the login item's back");
});

test("V50: install.json for another port leaves this port in clone mode", async () => {
  const w = tempState();
  install(w.dir, 1);
  assert.equal(loginItem.installedFor(w.dir, 2), null);
});

// --- V52 -------------------------------------------------------------------

test("V52: a CLI with a different state folder is told so, not refused on the port", async (t) => {
  const a = tempState();
  const b = tempState();
  const { result: helper } = await onFreePort((port) => service.serve({ port, stateDir: a.dir, quiet: true }));
  t.after(() => helper.close());
  await assert.rejects(
    sessionCommand.startHelper(b.dir, helper.port),
    (err) => {
      assert.match(err.message, /the helper on 127\.0\.0\.1:\d+ uses a different state folder than /);
      assert.ok(err.message.indexOf(b.dir) !== -1, "it names the folder this command is using");
      assert.match(err.message, /--state-dir|LAHE_STATE_DIR/);
      return true;
    }
  );
  const live = await service.probeHealth(protocol.DEFAULT_HOST, helper.port);
  assert.equal(selfStop.stateFolderMismatch(a.dir, live), false);
  assert.equal(selfStop.stateFolderMismatch(b.dir, live), true);
  assert.equal(selfStop.stateFolderMismatch(b.dir, { ok: true }), false, "an older helper with no id is not judged");
});

// --- stale replacement at a quiet moment --------------------------------------

/** A scratch "clone" whose src is newer than any running helper. */
function newerClone(root) {
  const clone = path.join(root, "clone");
  fs.mkdirSync(path.join(clone, "src"), { recursive: true });
  const file = path.join(clone, "src", "x.js");
  fs.writeFileSync(file, "// newer\n");
  const future = new Date(Date.now() + 60 * 60 * 1000);
  fs.utimesSync(file, future, future);
  return clone;
}

function holdWindow(dir, review) {
  const nowMs = Date.now();
  const sessions = {};
  sessions[review] = { window_id: "w", session_secret: "s", since: new Date(nowMs).toISOString(), since_ms: nowMs, last_seen: nowMs };
  fs.writeFileSync(stateDir.windowsPath(dir), JSON.stringify({ version: 1, sessions }));
}

async function installedHelper(t) {
  const w = tempState();
  t.after(() => stopTempHelpers(w.dir));
  const port = await freePort();
  const record = install(w.dir, port, { clone: newerClone(w.root) });
  const item = fakeLoginItem(w.dir, port);
  await sessionCommand.startHelper(w.dir, port, { runner: item.runner });
  const before = await service.probeHealth(protocol.DEFAULT_HOST, port);
  return Object.assign(w, { port, record, item, before });
}

test("stale: an always-on helper older than the login item's clone is replaced at a quiet moment, window open", async (t) => {
  const w = await installedHelper(t);
  holdWindow(w.dir, "r_open");
  const result = await sessionCommand.startHelper(w.dir, w.port, { runner: w.item.runner, quietMs: 50, quietMaxMs: 2000 });
  assert.equal(result.started, true);
  assert.equal(result.stale, true);
  assert.equal(result.keptForReviewer, null, "an open window does not hold an always-on helper back");
  const after = await service.probeHealth(protocol.DEFAULT_HOST, w.port);
  assert.notEqual(after.started_at, w.before.started_at, "a new helper answers");
  assert.equal(after.always_on, true, "started by the login item");
  assert.equal(w.item.calls.length, 2, "both starts went through the login item");
});

test("stale: a busy always-on helper is left for a later command, and the caller is told why", async (t) => {
  const w = await installedHelper(t);
  const events = stateDir.eventsPath(w.dir, "r_busy");
  fs.mkdirSync(path.dirname(events), { recursive: true });
  fs.writeFileSync(events, "");
  // Written a moment ago, and the quiet window is longer than the wait.
  const result = await sessionCommand.startHelper(w.dir, w.port, { runner: w.item.runner, quietMs: 60000, quietMaxMs: 200 });
  assert.equal(result.started, false);
  assert.equal(result.stale, true);
  assert.match(result.keptForReviewer, /busy taking a reviewer's changes/);
  const after = await service.probeHealth(protocol.DEFAULT_HOST, w.port);
  assert.equal(after.started_at, w.before.started_at, "the same helper still answers");
});

test("waitForQuiet: true once no review's log was written for the quiet window, false if that never comes", async () => {
  const w = tempState();
  assert.equal(await loginItem.waitForQuiet(w.dir, { quietMs: 1000, maxMs: 0 }), true, "no reviews at all is quiet");
  const events = stateDir.eventsPath(w.dir, "r1");
  fs.mkdirSync(path.dirname(events), { recursive: true });
  fs.writeFileSync(events, "");
  assert.equal(await loginItem.waitForQuiet(w.dir, { quietMs: 60000, maxMs: 100 }), false);
  const past = new Date(Date.now() - 120000);
  fs.utimesSync(events, past, past);
  assert.equal(await loginItem.waitForQuiet(w.dir, { quietMs: 60000, maxMs: 0 }), true);
});
