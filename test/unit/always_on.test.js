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
const { trackSpawned } = require("../helpers/spawned.js");

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
function fakeLoginItem(t, dir, port, options) {
  const opts = options || {};
  const calls = [];
  // Each helper it starts is tracked by pid and stopped in teardown, even one
  // still starting when the test ends.
  const spawned = trackSpawned(t, dir);
  const runner = (command, args) => {
    calls.push([command].concat(args));
    if (opts.fail) return { status: 113, output: "Could not find service" };
    spawned.spawn([BIN, "serve", "--always-on", "--port", String(port), "--state-dir", dir]);
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
  const item = fakeLoginItem(t, w.dir, port);
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
  const item = fakeLoginItem(t, w.dir, port, { fail: true });
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
  const item = fakeLoginItem(t, w.dir, port);
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

// --- the same rules in `lahe add` --------------------------------------------

const addCommand = require("../../src/cli/commands/add.js");

test("V50: lahe add's own start asks the login item when installed, and spawns nothing", async (t) => {
  const w = tempState();
  t.after(() => stopTempHelpers(w.dir));
  const port = await freePort();
  install(w.dir, port);
  const item = fakeLoginItem(t, w.dir, port);
  const health = await addCommand.startHelper(protocol.DEFAULT_HOST, port, w.dir, { runner: item.runner });
  assert.equal(health.always_on, true);
  assert.equal(item.calls.length, 1);
  assert.equal(helperProcessesFor(w.dir).length, 1);
});

test("V52: lahe add against a helper with another state folder says so", async (t) => {
  const a = tempState();
  const b = tempState();
  const { result: helper } = await onFreePort((port) => service.serve({ port, stateDir: a.dir, quiet: true }));
  t.after(() => helper.close());
  t.after(() => stopTempHelpers(b.dir));
  const page = path.join(b.root, "page.html");
  fs.writeFileSync(page, "<!doctype html><title>t</title><p>hi</p>\n");
  // Async, never spawnSync: the helper is in this process and must answer.
  const result = await new Promise((resolve) => {
    childProcess.execFile(
      process.execPath,
      [BIN, "add", page, "--port", String(helper.port), "--state-dir", b.dir],
      { encoding: "utf8", timeout: 60000 },
      (err, stdout, stderr) => resolve({ status: err ? err.code : 0, stderr })
    );
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /uses a different state folder than /);
});

test("the helper log says once per start whether a login item runs it", async (t) => {
  const w = tempState();
  const port = await freePort();
  install(w.dir, port);
  const helper = await service.serve({ port, stateDir: w.dir, quiet: true, alwaysOn: true });
  t.after(() => helper.close());
  const logged = fs.readFileSync(stateDir.helperLogPath(w.dir), "utf8");
  assert.match(logged, /login item lahe-test-\d+ \(\w+\) runs this helper; it does not stop when quiet/);

  const plain = tempState();
  const other = await onFreePort((p) => service.serve({ port: p, stateDir: plain.dir, quiet: true }));
  t.after(() => other.result.close());
  assert.match(fs.readFileSync(stateDir.helperLogPath(plain.dir), "utf8"), /no login item: started on demand/);
});

// --- lahe serve by hand, when installed --------------------------------------

test("installed: lahe serve --restart restarts through the login item instead of binding by hand", async (t) => {
  const w = tempState();
  t.after(() => stopTempHelpers(w.dir));
  const port = await freePort();
  install(w.dir, port);
  const item = fakeLoginItem(t, w.dir, port);
  await sessionCommand.startHelper(w.dir, port, { runner: item.runner });
  const before = await service.probeHealth(protocol.DEFAULT_HOST, port);
  const out = [];
  const code = await serveCommand.run(["--restart", "--port", String(port), "--state-dir", w.dir], {
    runner: item.runner,
    stdout: (x) => out.push(x),
    stderr: (x) => out.push(x)
  });
  assert.equal(code, 0, out.join(""));
  const after = await service.probeHealth(protocol.DEFAULT_HOST, port);
  assert.notEqual(after.started_at, before.started_at);
  assert.equal(after.always_on, true, "the login item's helper, not one bound by this process");
  assert.equal(item.calls.length, 2);
  assert.match(out.join(""), /restarted through the login item/);
});

test("installed: lahe serve by hand does not start a second helper beside the login item", async (t) => {
  const w = tempState();
  const port = await freePort();
  install(w.dir, port);
  const out = [];
  const code = await serveCommand.run(["--port", String(port), "--state-dir", w.dir], {
    stdout: (x) => out.push(x),
    stderr: (x) => out.push(x)
  });
  assert.notEqual(code, 0);
  assert.match(out.join(""), /login item lahe-test-\d+ runs the helper on this port/);
  assert.equal(await service.probeHealth(protocol.DEFAULT_HOST, port), null);
});

// Review finding 8: installed, the login item runs the clone it was installed
// from. A CLI from another clone that finds the helper's contract older must
// not restart it: the restart runs that same older clone, every open page
// drops for up to 20 seconds, and nothing gets newer.
const http = require("node:http");

/** A stand-in helper that answers /health with an older service contract. */
async function olderHelper(t) {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, service_contract: protocol.SERVICE_CONTRACT - 1, started_at: "2026-10-01T00:00:00.000Z" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  return server.address().port;
}

test("installed from another clone: an older contract is reported, not restarted through the login item", async (t) => {
  const w = tempState();
  const port = await olderHelper(t);
  const otherClone = path.join(w.root, "other-clone");
  fs.mkdirSync(otherClone);
  install(w.dir, port, { clone: otherClone });
  const calls = [];
  await assert.rejects(
    sessionCommand.startHelper(w.dir, port, { runner: (c, a) => { calls.push([c].concat(a)); return { status: 0, output: "" }; } }),
    (err) => {
      assert.ok(err.message.indexOf("the login item runs " + otherClone) !== -1, err.message);
      assert.match(err.message, /[Rr]un `lahe install` from this clone/);
      return true;
    }
  );
  assert.equal(calls.length, 0, "the login item was not asked to restart anything");
  assert.ok(await service.probeHealth(protocol.DEFAULT_HOST, port), "the running helper was left alone");
});

test("installed from another clone: lahe add says the same, and stops nothing", async (t) => {
  const w = tempState();
  const port = await olderHelper(t);
  const otherClone = path.join(w.root, "other-clone");
  fs.mkdirSync(otherClone);
  install(w.dir, port, { clone: otherClone });
  const page = path.join(w.root, "page.html");
  fs.writeFileSync(page, "<!doctype html><title>t</title><p>hi</p>\n");
  const result = await new Promise((resolve) => {
    childProcess.execFile(process.execPath, [BIN, "add", page, "--port", String(port), "--state-dir", w.dir],
      { encoding: "utf8", timeout: 60000, env: Object.assign({}, process.env, { LAHE_PAGES_PORT: process.env.LAHE_PAGES_PORT || "0" }) },
      (err, stdout, stderr) => resolve({ status: err ? err.code : 0, stderr }));
  });
  assert.notEqual(result.status, 0);
  assert.ok(result.stderr.indexOf("the login item runs " + otherClone) !== -1, result.stderr);
  assert.ok(await service.probeHealth(protocol.DEFAULT_HOST, port), "the running helper was left alone");
});
