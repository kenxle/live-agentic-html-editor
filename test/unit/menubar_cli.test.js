// `lahe menubar show`, `lahe menubar rebuild`, and the menu bar line in
// `lahe status` (menu bar plan V23, V26).
//
// The Mac is test/helpers/fake_mac.js: no real xcrun, swiftc or launchctl
// runs. The home is a temp folder and the label is lahe-test-menubar-<pid>.
// Nothing is spawned.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const loginItem = require("../../src/service/login_item.js");
const menubar = require("../../src/service/menubar.js");
const menubarCommand = require("../../src/cli/commands/menubar.js");
const status = require("../../src/cli/commands/status.js");
const { fakeMac, writeMenubarSources } = require("../helpers/fake_mac.js");

const LABEL = "lahe-test-menubar-" + process.pid;
const SRC = path.join(__dirname, "..", "..", "src");

function world(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-menubar-cli-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const dir = path.join(root, "state");
  const clone = path.join(root, "clone");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  writeMenubarSources(clone, "// one\n");
  loginItem.writeInstall(dir, { system: "macos", label: "lahe-test", port: 47999, clone: clone, state_dir: dir });
  return { root, home, dir, clone };
}

async function withIcon(t) {
  const w = world(t);
  const mac = fakeMac();
  const added = await menubar.installApp({ clone: w.clone, stateDir: w.dir, home: w.home, uid: 501, label: LABEL, runner: mac.runner, arch: "arm64" });
  assert.equal(added.ok, true, added.message);
  mac.calls.length = 0;
  return { w, mac };
}

function deps(w, mac, extra) {
  const out = [];
  const err = [];
  const d = Object.assign({
    stdout: (x) => out.push(x),
    stderr: (x) => err.push(x),
    platform: "darwin",
    isTTY: true,
    home: w.home,
    uid: 501,
    label: LABEL,
    arch: "arm64",
    runner: mac.runner
  }, extra || {});
  d.out = () => out.join("");
  d.err = () => err.join("");
  return d;
}

// --- lahe menubar ----------------------------------------------------------------

test("V23: lahe menubar show brings a hidden icon back by kickstarting its item", async (t) => {
  const { w, mac } = await withIcon(t);
  mac.job(LABEL).running = false; // Hide
  const d = deps(w, mac);
  assert.equal(await menubarCommand.run(["show", "--state-dir", w.dir], d), 0, d.err());
  assert.deepEqual(mac.calls, [["launchctl", "kickstart", "gui/501/" + LABEL]]);
  assert.equal(mac.job(LABEL).running, true);
});

test("V23 and R17: lahe menubar show needs a terminal, so nothing an agent runs brings the icon back", async (t) => {
  const { w, mac } = await withIcon(t);
  mac.job(LABEL).running = false;
  const d = deps(w, mac, { isTTY: false });
  assert.equal(await menubarCommand.run(["show", "--state-dir", w.dir], d), 1);
  assert.match(d.err(), /needs a terminal/);
  assert.match(d.err(), /! lahe menubar show/);
  assert.deepEqual(mac.calls, []);
  assert.equal(mac.job(LABEL).running, false);
});

test("lahe menubar rebuild builds now from install.json's clone and restarts a running icon", async (t) => {
  const { w, mac } = await withIcon(t);
  writeMenubarSources(w.clone, "// two\n");
  const d = deps(w, mac, { isTTY: false });
  assert.equal(await menubarCommand.run(["rebuild", "--state-dir", w.dir], d), 0, d.err());
  assert.equal(fs.readFileSync(path.join(menubar.appPath(w.dir), "Contents", "MacOS", "LaheMenuBar"), "utf8"), "// two\n");
  assert.ok(mac.calls.some((c) => c.join(" ") === "launchctl kickstart -k gui/501/" + LABEL));
  assert.match(d.out(), /rebuilt/);
  assert.match(d.out(), /restarted/);
});

test("lahe menubar rebuild leaves a hidden icon hidden, and a failed build exits 1 with the reason", async (t) => {
  const { w, mac } = await withIcon(t);
  mac.job(LABEL).running = false;
  const d = deps(w, mac);
  assert.equal(await menubarCommand.run(["rebuild", "--state-dir", w.dir], d), 0, d.err());
  assert.match(d.out(), /not running/);
  assert.equal(mac.calls.some((c) => c[1] === "kickstart"), false);

  const broken = fakeMac({ compiles: false });
  const b = deps(w, broken);
  assert.equal(await menubarCommand.run(["rebuild", "--state-dir", w.dir], b), 1);
  assert.match(b.err(), /expected expression/);
  assert.match(b.err(), /menubar\.log/);
});

test("lahe menubar off macOS says so and runs nothing; no subcommand is bad usage", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  const linux = deps(w, mac, { platform: "linux" });
  assert.equal(await menubarCommand.run(["show", "--state-dir", w.dir], linux), 1);
  assert.match(linux.err(), /macOS only/);
  assert.deepEqual(mac.calls, []);
  const bare = deps(w, mac);
  assert.equal(await menubarCommand.run([], bare), protocol.CLI_EXIT.BAD_USAGE);
  assert.match(bare.err(), /lahe menubar show/);
  const help = deps(w, mac);
  assert.equal(await menubarCommand.run(["--help"], help), protocol.CLI_EXIT.OK);
  assert.match(help.out(), /lahe menubar rebuild/);
});

test("lahe menubar is a command the dispatcher knows", () => {
  const cli = require("../../src/cli/index.js");
  assert.ok(cli.COMMAND_NAMES.indexOf("menubar") !== -1);
  assert.equal(typeof cli.COMMANDS.menubar().run, "function");
  assert.match(cli.USAGE, /^  menubar /m);
});

// --- V23: the agent commands never touch the app's item ------------------------

// The helper itself (src/service/index.js) does load the menu bar module, for
// its rebuild tick; what it may do with it is proved by behavior in
// menubar.test.js: the tick runs on an always-on helper's beat only, and a
// rebuild restarts the app only when it was already running (V24).
test("V23: the commands an agent runs (review, monitor, session, add, library, serve) never require the menu bar module themselves; lahe status only reads its state", () => {
  const agentPaths = ["cli/commands/review.js", "cli/commands/monitor.js", "cli/commands/session.js", "cli/commands/add.js", "cli/commands/library.js", "cli/commands/serve.js"];
  agentPaths.forEach((rel) => {
    const text = fs.readFileSync(path.join(SRC, rel), "utf8");
    assert.doesNotMatch(text, /require\([^)]*menubar/, rel + " must not load the menu bar module");
  });
  const statusText = fs.readFileSync(path.join(SRC, "cli", "commands", "status.js"), "utf8");
  const called = new Set((statusText.match(/\bmenubar\.[a-z][A-Za-z]*\(/g) || []).map((m) => m.slice("menubar.".length, -1)));
  assert.deepEqual([...called], ["appState"], "status reads the icon's state and calls nothing else on it");
});

// --- V26: the status line ------------------------------------------------------

async function statusOut(w, mac, platform) {
  const out = [];
  const code = await status.run(["--state-dir", w.dir], {
    stdout: (x) => out.push(x),
    stderr: () => {},
    runner: mac.runner,
    platform: platform || "darwin",
    uid: 501,
    home: w.home,
    menubarLabel: LABEL
  });
  assert.equal(code, 0);
  return out.join("");
}

test("V26: lahe status says installed and running, and only reads the app's item", async (t) => {
  const { w, mac } = await withIcon(t);
  assert.match(await statusOut(w, mac), /^menu bar  installed and running$/m);
  assert.deepEqual(mac.calls.map((c) => c.slice(0, 2).join(" ")), ["launchctl print"]);
});

test("V26: lahe status says installed and not running, and how to show it", async (t) => {
  const { w, mac } = await withIcon(t);
  mac.job(LABEL).running = false;
  assert.match(await statusOut(w, mac), /^menu bar  installed, not running \(hidden\); `lahe menubar show` brings it back$/m);
});

test("V26: lahe status says not installed, and how to add it", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  assert.match(await statusOut(w, mac), /^menu bar  not installed; `lahe install --menu-bar` adds the icon$/m);
  assert.deepEqual(mac.calls, [], "nothing to ask launchd about");
});

test("V26: lahe status names a failed rebuild, its time and its error", async (t) => {
  const { w, mac } = await withIcon(t);
  const record = loginItem.readInstall(w.dir);
  record.menubar.last_error = { at: "2026-10-12T15:00:00.000Z", message: "swiftc failed: LaheMenuBar.swift:3:1: error: expected expression", source_stamp: "a".repeat(64) };
  loginItem.writeInstall(w.dir, record);
  const text = await statusOut(w, mac);
  const line = text.split("\n").find((l) => l.indexOf("menu bar  ") === 0);
  assert.match(line, /installed and running; the last rebuild failed at /);
  assert.ok(line.indexOf(loginItem.localTime("2026-10-12T15:00:00.000Z")) !== -1);
  assert.match(line, /expected expression/);
  assert.match(line, /old app keeps running/);
  assert.ok(line.indexOf(path.join(w.dir, "menubar.log")) !== -1);
});

test("V26 and V27: lahe status says stopped by you, with the time, while the marker stands", async (t) => {
  const { w, mac } = await withIcon(t);
  fs.writeFileSync(path.join(w.dir, loginItem.STOP_FILE), JSON.stringify({ by: "menu bar", at: "2026-10-12T15:41:00.000Z" }));
  const line = (await statusOut(w, mac)).split("\n").find((l) => l.indexOf("menu bar  ") === 0);
  assert.match(line, /^menu bar  Lahe stopped by you at /);
  assert.ok(line.indexOf(loginItem.localTime("2026-10-12T15:41:00.000Z")) !== -1);
  assert.match(line, /Start in the Lahe menu/);
  assert.match(line, /The icon: installed and running$/, "stopped still says how the icon is");
});

test("V26 and V27: while stopped, the line still names a hidden icon and a failed rebuild", async (t) => {
  const { w, mac } = await withIcon(t);
  mac.job(LABEL).running = false;
  const record = loginItem.readInstall(w.dir);
  record.menubar.last_error = { at: "2026-10-12T15:00:00.000Z", message: "swiftc failed: error: expected expression", source_stamp: "a".repeat(64) };
  loginItem.writeInstall(w.dir, record);
  fs.writeFileSync(path.join(w.dir, loginItem.STOP_FILE), JSON.stringify({ by: "menu bar", at: "2026-10-12T15:41:00.000Z" }));
  const line = (await statusOut(w, mac)).split("\n").find((l) => l.indexOf("menu bar  ") === 0);
  assert.match(line, /^menu bar  Lahe stopped by you at .*The icon: installed, not running \(hidden\).*the last rebuild failed at .*expected expression/);
});

test("V26: off macOS, lahe status prints no menu bar line", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  assert.doesNotMatch(await statusOut(w, mac, "linux"), /^menu bar/m);
});

test("V23: lahe status --json, the form lahe monitor polls with, never asks launchd about the icon", async (t) => {
  const { w, mac } = await withIcon(t);
  const out = [];
  const code = await status.run(["--state-dir", w.dir, "--json"], {
    stdout: (x) => out.push(x), stderr: () => {}, runner: mac.runner, platform: "darwin", uid: 501, home: w.home, menubarLabel: LABEL
  });
  assert.equal(code, 0);
  assert.match(out.join(""), /"reviews":0/);
  assert.deepEqual(mac.calls, []);
});
