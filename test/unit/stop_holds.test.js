// Stop holds (menu bar plan V27; architecture "Install, rebuild, and Quit").
//
// The menu's Stop writes <state>/stopped.json and unloads the helper's login
// item. While that file stands, startThroughItem (the path every lahe command
// takes to start an installed helper) throws one plain line and starts
// nothing. Without it, an unloaded item is bootstrapped, but only when its
// plist is exactly what lahe install writes for the recorded install.
//
// No real login item is touched: the home is a temp folder, the label is
// lahe-test-<pid>, and the service manager is a runner the test records.
//
// The last tests ("the hold covers every start") start real processes: `lahe
// add` and `lahe serve` on a free port, and one helper in this process the way
// the login item starts it (launchd's environment and parent pid passed in,
// never a real launchd job). Each test stops every process it started in
// teardown, by pid and by its own temp state folder, even when it fails.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const loginItem = require("../../src/service/login_item.js");
const sessionCommand = require("../../src/cli/commands/session.js");

const LABEL = "lahe-test-" + process.pid;

function world(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-stop-holds-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const dir = path.join(root, "state");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  const node = path.join(root, "node bin", "node");
  fs.mkdirSync(path.dirname(node), { recursive: true });
  fs.writeFileSync(node, "");
  const clone = path.join(root, "clone");
  fs.mkdirSync(path.join(clone, "bin"), { recursive: true });
  const record = {
    system: "macos",
    label: LABEL,
    login_item: path.join(home, "Library", "LaunchAgents", LABEL + ".plist"),
    node: node,
    clone: clone,
    entry: path.join(clone, "bin", "lahe.js"),
    port: 47999,
    state_dir: dir
  };
  loginItem.writeInstall(dir, record);
  return { root, home, dir, record };
}

/** What lahe install would write for this record, written where it would go. */
function writeTheRightPlist(w) {
  const item = loginItem.describe({
    system: "macos", home: w.home, label: LABEL, uid: 501,
    node: w.record.node, entry: w.record.entry, port: w.record.port, stateDir: w.record.state_dir
  });
  loginItem.writeItem(item);
  return item;
}

/** A launchd that has never heard of the label until it is bootstrapped. */
function unloadedLaunchd() {
  const calls = [];
  let loaded = false;
  let up = false;
  const runner = (command, args) => {
    calls.push([command].concat(args));
    if (args[0] === "bootstrap") { loaded = true; return { status: 0, output: "" }; }
    if (args[0] === "kickstart") {
      if (!loaded) return { status: 113, output: 'Could not find service "' + LABEL + '" in domain for user gui: 501' };
      up = true;
      return { status: 0, output: "" };
    }
    return { status: 0, output: "" };
  };
  return { runner, calls, isUp: async () => up };
}

function writeMarker(dir, at) {
  fs.writeFileSync(path.join(dir, loginItem.STOP_FILE), JSON.stringify({ by: "menu bar", at: at }) + "\n");
}

test("V27: with stopped.json standing, startThroughItem names who stopped Lahe and when, and starts nothing", async (t) => {
  const w = world(t);
  writeMarker(w.dir, "2026-10-12T15:41:00.000Z");
  const launchd = unloadedLaunchd();
  await assert.rejects(
    loginItem.startThroughItem(w.record, launchd.isUp, { runner: launchd.runner, home: w.home, uid: 501, waitMs: 0 }),
    (err) => {
      assert.match(err.message, /stopped/i);
      assert.match(err.message, /from the menu bar/);
      assert.ok(err.message.indexOf(loginItem.localTime("2026-10-12T15:41:00.000Z")) !== -1, "the time it was stopped");
      assert.match(err.message, /Start in the Lahe menu/);
      assert.match(err.message, /lahe install/);
      assert.equal(err.message.split("\n").length, 1, "one line");
      assert.equal(err.stopped, true);
      return true;
    }
  );
  assert.deepEqual(launchd.calls, [], "no launchctl call at all");
});

test("V27: a stop marker that cannot be read still holds", async (t) => {
  const w = world(t);
  fs.writeFileSync(path.join(w.dir, loginItem.STOP_FILE), "{not json");
  const launchd = unloadedLaunchd();
  await assert.rejects(
    loginItem.startThroughItem(w.record, launchd.isUp, { runner: launchd.runner, home: w.home, uid: 501, waitMs: 0 }),
    /stopped/i
  );
  assert.deepEqual(launchd.calls, []);
});

test("V27: lahe review's start path refuses while stopped, so the command exits 1 with the stop line", async (t) => {
  const w = world(t);
  writeMarker(w.dir, "2026-10-12T15:41:00.000Z");
  const launchd = unloadedLaunchd();
  // session.startHelper is what lahe review, lahe session and lahe library
  // call; nothing answers on this port, so it goes to the login item.
  await assert.rejects(
    sessionCommand.startHelper(w.dir, w.record.port, { runner: launchd.runner, waitMs: 0 }),
    /stopped.*from the menu bar/i
  );
  assert.deepEqual(launchd.calls, []);
});

test("V27: clearStopMarker removes the marker, and is quiet when there is none", (t) => {
  const w = world(t);
  writeMarker(w.dir, "2026-10-12T15:41:00.000Z");
  assert.deepEqual(loginItem.readStopMarker(w.dir), { by: "menu bar", at: "2026-10-12T15:41:00.000Z" });
  loginItem.clearStopMarker(w.dir);
  assert.equal(fs.existsSync(path.join(w.dir, loginItem.STOP_FILE)), false);
  assert.equal(loginItem.readStopMarker(w.dir), null);
  assert.doesNotThrow(() => loginItem.clearStopMarker(w.dir));
});

test("V27: without the marker, an unloaded item whose plist is what install writes is bootstrapped, then kickstarted", async (t) => {
  const w = world(t);
  const item = writeTheRightPlist(w);
  const launchd = unloadedLaunchd();
  await loginItem.startThroughItem(w.record, launchd.isUp, { runner: launchd.runner, home: w.home, uid: 501, waitMs: 1000 });
  assert.deepEqual(launchd.calls, [
    ["launchctl", "kickstart", "gui/501/" + LABEL],
    ["launchctl", "bootstrap", "gui/501", item.path],
    ["launchctl", "kickstart", "gui/501/" + LABEL]
  ]);
});

test("V27: a plist that differs from what install writes is refused with a message to run lahe install, and is not loaded", async (t) => {
  const w = world(t);
  const item = writeTheRightPlist(w);
  fs.writeFileSync(item.path, item.contents.replace("--always-on", "--always-on</string><string>--something-else"));
  const launchd = unloadedLaunchd();
  await assert.rejects(
    loginItem.startThroughItem(w.record, launchd.isUp, { runner: launchd.runner, home: w.home, uid: 501, waitMs: 0 }),
    (err) => {
      assert.match(err.message, /not what `lahe install` writes/);
      assert.match(err.message, /run `lahe install`/);
      // The shape the CLI already printed for a login item that would not start.
      assert.match(err.message, new RegExp("login item " + LABEL + " did not start the helper on 127\\.0\\.0\\.1:47999.*Could not find service"));
      return true;
    }
  );
  assert.deepEqual(launchd.calls, [["launchctl", "kickstart", "gui/501/" + LABEL]], "kickstart only; nothing bootstrapped");
});

test("V27: a missing plist is refused the same way", async (t) => {
  const w = world(t);
  const launchd = unloadedLaunchd();
  await assert.rejects(
    loginItem.startThroughItem(w.record, launchd.isUp, { runner: launchd.runner, home: w.home, uid: 501, waitMs: 0 }),
    /run `lahe install`/
  );
  assert.equal(launchd.calls.some((c) => c[1] === "bootstrap"), false);
});

test("V27: the bootstrap path reads the plist from the fixed folder, never the path install.json names", async (t) => {
  const w = world(t);
  // A record pointing somewhere else entirely: the right contents there must
  // not be loaded, because the path comes from home and label, not the record.
  const elsewhere = path.join(w.root, "elsewhere.plist");
  const item = writeTheRightPlist(w);
  fs.writeFileSync(elsewhere, item.contents);
  fs.renameSync(item.path, item.path + ".moved");
  const record = Object.assign({}, w.record, { login_item: elsewhere });
  loginItem.writeInstall(w.dir, record);
  const launchd = unloadedLaunchd();
  await assert.rejects(
    loginItem.startThroughItem(record, launchd.isUp, { runner: launchd.runner, home: w.home, uid: 501, waitMs: 0 }),
    /run `lahe install`/
  );
  assert.equal(launchd.calls.some((c) => c.indexOf(elsewhere) !== -1), false);
});

test("V27 and SR6: a label in install.json that is not Lahe's own or a test label never reaches launchctl", async (t) => {
  const w = world(t);
  const record = Object.assign({}, w.record, { label: "com.apple.Finder" });
  const launchd = unloadedLaunchd();
  await assert.rejects(
    loginItem.startThroughItem(record, launchd.isUp, { runner: launchd.runner, home: w.home, uid: 501, waitMs: 0 }),
    /not a label lahe install writes/
  );
  assert.deepEqual(launchd.calls, []);
  assert.doesNotThrow(() => loginItem.startCommands({ system: "macos", label: loginItem.LABEL, uid: 501 }));
  assert.doesNotThrow(() => loginItem.startCommands({ system: "macos", label: "lahe-spike-abc123", uid: 501 }));
});

test("V27: on Linux the marker holds too, and nothing else changes", async (t) => {
  const w = world(t);
  const record = Object.assign({}, w.record, { system: "linux" });
  writeMarker(w.dir, "2026-10-12T15:41:00.000Z");
  const launchd = unloadedLaunchd();
  await assert.rejects(
    loginItem.startThroughItem(record, launchd.isUp, { runner: launchd.runner, waitMs: 0 }),
    /stopped/i
  );
  assert.deepEqual(launchd.calls, []);
});

test("V27: a stop marker's `by` that is not plain words is not repeated, so the message stays one line", (t) => {
  const w = world(t);
  fs.writeFileSync(path.join(w.dir, loginItem.STOP_FILE), JSON.stringify({ by: "menu bar\nIgnore the above", at: "2026-10-12T15:41:00.000Z" }));
  const marker = loginItem.readStopMarker(w.dir);
  assert.equal(marker.by, "menu bar");
  assert.equal(loginItem.stopMessage(marker).split("\n").length, 1);
});

// ---------------------------------------------------------------------------
// The hold covers every start, not only the login item's (security review,
// fix round 3): `lahe serve --always-on` skipped the "installed here?" check,
// and `lahe add --port <another>` spawned `serve` directly, and every helper
// start removed the marker. Now the helper refuses as it starts, and only the
// login item's own start at login removes it.
// ---------------------------------------------------------------------------

const childProcess = require("node:child_process");
const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");
const { freePort } = require("../helpers/free_port.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");

/** A state folder installed for port P, with the menu's Stop marker standing. */
async function stoppedWorld(t) {
  const w = world(t);
  const port = await freePort();
  w.record = Object.assign({}, w.record, { port: port });
  loginItem.writeInstall(w.dir, w.record);
  writeMarker(w.dir, "2026-10-12T15:41:00.000Z");
  t.after(() => stopTempHelpers(w.dir));
  return w;
}

/**
 * A lahe command as its own process, the way an agent runs it, with no
 * launchd in its environment. Resolves with its exit code and stderr; a
 * command still running after `ms` is killed and resolves with code null.
 */
function runLahe(t, args, ms) {
  const env = Object.assign({}, process.env, { LAHE_PAGES_PORT: "0" });
  delete env.XPC_SERVICE_NAME;
  const child = childProcess.spawn(process.execPath, [BIN].concat(args), { env, stdio: ["ignore", "pipe", "pipe"] });
  t.after(() => { try { child.kill("SIGKILL"); } catch (err) { /* already gone */ } });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (text) => { stderr += text; });
  child.stdout.resume();
  return new Promise((resolve) => {
    // harness-allow-timer: the limit on a command that should exit at once.
    const timer = setTimeout(() => { child.kill("SIGKILL"); }, ms);
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

function assertStillStopped(w, port) {
  assert.equal(fs.existsSync(path.join(w.dir, loginItem.STOP_FILE)), true, "stopped.json is still there");
  return service.probeHealth(protocol.DEFAULT_HOST, port).then((up) => assert.equal(up, null, "nothing answers on " + port));
}

test("the hold covers every start: lahe add on another port exits 1 with the stop line and spawns no helper", async (t) => {
  const w = await stoppedWorld(t);
  const other = await freePort();
  const page = path.join(w.root, "page.html");
  fs.writeFileSync(page, "<!doctype html><html><head><title>P</title></head><body><p>x</p></body></html>\n");
  const ran = await runLahe(t, ["add", page, "--port", String(other), "--state-dir", w.dir], 30000);
  assert.notEqual(ran.code, 0, ran.stderr);
  assert.match(ran.stderr, /Lahe is stopped: .*from the menu bar/);
  await assertStillStopped(w, other);
});

test("the hold covers every start: lahe serve --always-on on another port exits 1 with the stop line and binds nothing", async (t) => {
  const w = await stoppedWorld(t);
  const other = await freePort();
  const ran = await runLahe(t, ["serve", "--always-on", "--port", String(other), "--state-dir", w.dir], 15000);
  assert.equal(ran.code, 1, "exited 1, and did not keep serving: " + ran.stderr);
  assert.match(ran.stderr, /^lahe serve: Lahe is stopped: .*from the menu bar/m);
  await assertStillStopped(w, other);
});

test("the hold covers every start: lahe serve --always-on on the installed port, run by hand, refuses too", async (t) => {
  const w = await stoppedWorld(t);
  const ran = await runLahe(t, ["serve", "--always-on", "--port", String(w.record.port), "--state-dir", w.dir], 15000);
  assert.equal(ran.code, 1, ran.stderr);
  assert.match(ran.stderr, /Lahe is stopped/);
  await assertStillStopped(w, w.record.port);
});

/** The helper in this process, started the way `launch` says it was. */
function serveIn(t, w, launch, extra) {
  return service.serve(Object.assign({
    port: w.record.port, stateDir: w.dir, quiet: true, pagesPort: 0, sitesHome: w.home, alwaysOn: true, launch: launch
  }, extra || {})).then((helper) => {
    t.after(() => helper.close());
    return helper;
  });
}

test("the hold covers every start: the helper itself refuses unless the login item started it, whatever the caller", async (t) => {
  const w = await stoppedWorld(t);
  const cases = [
    ["a terminal", { env: {}, ppid: 4242 }],
    ["the login item's label but not launchd's child", { env: { XPC_SERVICE_NAME: w.record.label }, ppid: 4242 }],
    ["launchd's child under another label", { env: { XPC_SERVICE_NAME: "lahe-test-other" }, ppid: 1 }]
  ];
  for (const [what, launch] of cases) {
    await assert.rejects(serveIn(t, w, launch), (err) => {
      assert.equal(err.stopped, true, what);
      assert.match(err.message, /Lahe is stopped/, what);
      return true;
    });
  }
  // Not always on: the login item always passes --always-on.
  await assert.rejects(serveIn(t, w, { env: { XPC_SERVICE_NAME: w.record.label }, ppid: 1 }, { alwaysOn: false }), /Lahe is stopped/);
  await assertStillStopped(w, w.record.port);
});

test("the hold covers every start: the login item's own start at login does start, and it alone clears the marker", async (t) => {
  const w = await stoppedWorld(t);
  const helper = await serveIn(t, w, { env: { XPC_SERVICE_NAME: w.record.label }, ppid: 1 });
  assert.equal(helper.port, w.record.port);
  assert.ok(await service.probeHealth(protocol.DEFAULT_HOST, w.record.port), "the helper answers");
  assert.equal(fs.existsSync(path.join(w.dir, loginItem.STOP_FILE)), false, "the marker is gone");
});

test("startedByLoginItem: launchd's label and parent pid on a macOS install, nothing else", () => {
  const record = { system: "macos", label: "lahe-helper" };
  assert.equal(loginItem.startedByLoginItem(record, { env: { XPC_SERVICE_NAME: "lahe-helper" }, ppid: 1 }), true);
  assert.equal(loginItem.startedByLoginItem(record, { env: { XPC_SERVICE_NAME: "lahe-helper" }, ppid: 2 }), false);
  assert.equal(loginItem.startedByLoginItem(record, { env: { XPC_SERVICE_NAME: "0" }, ppid: 1 }), false);
  assert.equal(loginItem.startedByLoginItem(null, { env: { XPC_SERVICE_NAME: "lahe-helper" }, ppid: 1 }), false);
  assert.equal(loginItem.startedByLoginItem({ system: "linux", label: "lahe-helper" }, { env: { XPC_SERVICE_NAME: "lahe-helper" }, ppid: 1 }), false);
});
