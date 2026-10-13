// Stop holds (menu bar plan V27; architecture "Install, rebuild, and Quit").
//
// The menu's Stop writes <state>/stopped.json and unloads the helper's login
// item. While that file stands, startThroughItem (the path every lahe command
// takes to start an installed helper) throws one plain line and starts
// nothing. Without it, an unloaded item is bootstrapped, but only when its
// plist is exactly what lahe install writes for the recorded install.
//
// No real login item is touched: the home is a temp folder, the label is
// lahe-test-<pid>, and the service manager is a runner the test records. No
// helper is started, so there is nothing to stop in teardown.

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
