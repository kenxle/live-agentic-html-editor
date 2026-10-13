// The menu bar app's build recipe, login item and rebuild tick
// (src/service/menubar.js; menu bar plan V21 to V25).
//
// Nothing here runs a real xcrun, swiftc or launchctl: the runner is the Mac
// test/helpers/fake_mac.js plays. The home is a temp folder and the label is
// lahe-test-menubar-<pid>, so no real login item is read, written, loaded or
// stopped. Nothing is spawned.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const loginItem = require("../../src/service/login_item.js");
const menubar = require("../../src/service/menubar.js");
const { fakeMac, writeMenubarSources } = require("../helpers/fake_mac.js");

const LABEL = "lahe-test-menubar-" + process.pid;

const writeSources = writeMenubarSources;

function world(t, options) {
  const opts = options || {};
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-menubar-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const dir = path.join(root, "state");
  const clone = path.join(root, "clone");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(dir, { recursive: true });
  writeSources(clone, opts.swift || "// version one\n");
  const record = { system: "macos", label: "lahe-test", port: 47999, clone: clone, state_dir: dir, installed_at: "2026-10-12T00:00:00.000Z" };
  loginItem.writeInstall(dir, record);
  return { root, home, dir, clone, record };
}

function base(w, mac, extra) {
  return Object.assign({ stateDir: w.dir, home: w.home, uid: 501, label: LABEL, runner: mac.runner, arch: "arm64", platform: "darwin" }, extra || {});
}

function appProgram(w) {
  return path.join(w.dir, "menubar", "Lahe.app", "Contents", "MacOS", "LaheMenuBar");
}

// --- Task 3.1: build and the login item --------------------------------------

test("V21: installApp builds Lahe.app in the state folder, writes its plist, loads it, and records the menubar block", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  const result = await menubar.installApp(base(w, mac, { clone: w.clone }));
  assert.equal(result.ok, true, result.message);

  const app = path.join(w.dir, "menubar", "Lahe.app");
  assert.equal(fs.readFileSync(path.join(app, "Contents", "MacOS", "LaheMenuBar"), "utf8"), "// version one\n");
  assert.match(fs.readFileSync(path.join(app, "Contents", "Info.plist"), "utf8"), /CFBundleExecutable/);

  const plistPath = path.join(w.home, "Library", "LaunchAgents", LABEL + ".plist");
  const plist = fs.readFileSync(plistPath, "utf8");
  assert.match(plist, new RegExp("<string>" + LABEL + "</string>"));
  assert.match(plist, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.ok(
    plist.indexOf("<string>" + path.join(app, "Contents", "MacOS", "LaheMenuBar") + "</string>\n    <string>--state-dir</string>\n    <string>" + w.dir + "</string>") !== -1,
    "the app's arguments are pinned as absolute values"
  );

  const launchctl = mac.calls.filter((c) => c[0] === "launchctl");
  assert.deepEqual(launchctl.slice(-2), [
    ["launchctl", "bootstrap", "gui/501", plistPath],
    ["launchctl", "kickstart", "gui/501/" + LABEL]
  ]);
  assert.equal(mac.job(LABEL).running, true);

  const record = loginItem.readInstall(w.dir);
  assert.deepEqual(Object.keys(record.menubar).sort(), ["app", "built_at", "label", "login_item", "source_stamp"]);
  assert.equal(record.menubar.app, app);
  assert.equal(record.menubar.label, LABEL);
  assert.equal(record.menubar.login_item, plistPath);
  assert.equal(record.menubar.source_stamp, menubar.sourceStamp(w.clone));
  assert.ok(!Number.isNaN(Date.parse(record.menubar.built_at)));
  const rest = Object.assign({}, record);
  delete rest.menubar;
  assert.deepEqual(rest, w.record, "the rest of install.json is untouched");
});

test("V23: the app's login item restarts it only on a crash, so Hide (a clean exit) holds", async (t) => {
  const w = world(t);
  const item = menubar.describeApp({ home: w.home, uid: 501, label: LABEL, stateDir: w.dir });
  assert.match(item.contents, /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>\s*<\/dict>/);
  assert.doesNotMatch(item.contents, /<key>KeepAlive<\/key>\s*<true\/>/);
  // The helper's own item is unchanged: it restarts on any exit.
  const helper = loginItem.describe({ system: "macos", home: w.home, uid: 501, label: "lahe-test", node: "/n", entry: "/e", port: 1, stateDir: w.dir });
  assert.match(helper.contents, /<key>KeepAlive<\/key>\s*<true\/>/);
});

test("V21: the build copies the fixed file list into a fresh folder in the state folder, compiles the copy with pinned flags, and leaves no build folder", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  const built = await menubar.build({ clone: w.clone, stateDir: w.dir, runner: mac.runner, arch: "arm64" });
  assert.equal(built.ok, true, built.message);
  assert.deepEqual(mac.calls[0], [menubar.XCRUN, "--find", "swiftc"]);
  const compile = mac.calls[1];
  const out = compile[compile.indexOf("-o") + 1];
  const source = compile[compile.length - 1];
  const work = path.dirname(path.dirname(source));
  assert.equal(path.dirname(work), path.join(w.dir, "menubar"), "the build folder is inside the state folder");
  assert.match(path.basename(work), /^\.build-/);
  assert.deepEqual(compile, [
    menubar.XCRUN, "swiftc", "-swift-version", "5", "-target", "arm64-apple-macosx13.0", "-O",
    "-o", path.join(work, "Lahe.app", "Contents", "MacOS", "LaheMenuBar"),
    path.join(work, "src", "LaheMenuBar.swift")
  ]);
  assert.equal(out, path.join(work, "Lahe.app", "Contents", "MacOS", "LaheMenuBar"));
  assert.equal(fs.existsSync(work), false, "the build folder is gone");
  assert.deepEqual(fs.readdirSync(path.join(w.dir, "menubar")), ["Lahe.app"]);
  assert.equal(built.stamp, menubar.sourceStamp(w.clone));
});

test("the host architecture names the target: arm64 and x86_64, and nothing else", () => {
  assert.equal(menubar.targetFor("arm64"), "arm64-apple-macosx13.0");
  assert.equal(menubar.targetFor("x64"), "x86_64-apple-macosx13.0");
  assert.throws(() => menubar.targetFor("ia32"), /no menu bar app for/);
});

test("a test build can add compile-time names, and refuses anything that is not a plain name", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  assert.equal((await menubar.build({ clone: w.clone, stateDir: w.dir, runner: mac.runner, arch: "arm64", defines: ["LAHE_TEST_LABELS"] })).ok, true);
  assert.deepEqual(mac.calls[1].slice(7, 9), ["-D", "LAHE_TEST_LABELS"]);
  await assert.rejects(menubar.build({ clone: w.clone, stateDir: w.dir, runner: mac.runner, arch: "arm64", defines: ["X; rm"] }), /not a compile-time name/);
});

test("the source stamp covers the fixed list only, in a fixed order, and moves when one byte does", (t) => {
  const w = world(t);
  const first = menubar.sourceStamp(w.clone);
  assert.match(first, /^[0-9a-f]{64}$/);
  fs.writeFileSync(path.join(w.clone, "macos", "menubar", "README.md"), "other notes\n");
  assert.equal(menubar.sourceStamp(w.clone), first, "a file off the list does not move it");
  fs.appendFileSync(path.join(w.clone, "macos", "menubar", "Info.plist"), " ");
  assert.notEqual(menubar.sourceStamp(w.clone), first);
  assert.deepEqual(menubar.SOURCE_FILES, ["LaheMenuBar.swift", "Info.plist"]);
});

test("V22: with no swiftc, the build names xcode-select --install and nothing is written", async (t) => {
  const w = world(t);
  const mac = fakeMac({ swiftc: false });
  const result = await menubar.installApp(base(w, mac, { clone: w.clone }));
  assert.equal(result.ok, false);
  assert.equal(result.code, menubar.FAILED.NO_TOOLS);
  assert.match(result.message, /xcode-select --install/);
  assert.equal(fs.existsSync(path.join(w.home, "Library", "LaunchAgents", LABEL + ".plist")), false, "no plist");
  assert.equal(fs.existsSync(path.join(w.dir, "menubar", "Lahe.app")), false, "no app");
  assert.equal(loginItem.readInstall(w.dir).menubar, undefined, "no block");
  assert.deepEqual(mac.calls, [[menubar.XCRUN, "--find", "swiftc"]], "nothing past the tools check");
});

test("a source file missing from the clone, or one that is a link, fails the build and writes no app", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  fs.renameSync(path.join(w.clone, "macos", "menubar", "Info.plist"), path.join(w.root, "Info.plist"));
  let built = await menubar.build({ clone: w.clone, stateDir: w.dir, runner: mac.runner, arch: "arm64" });
  assert.equal(built.ok, false);
  assert.match(built.message, /Info\.plist/);
  fs.symlinkSync(path.join(w.root, "Info.plist"), path.join(w.clone, "macos", "menubar", "Info.plist"));
  built = await menubar.build({ clone: w.clone, stateDir: w.dir, runner: mac.runner, arch: "arm64" });
  assert.equal(built.ok, false);
  assert.match(built.message, /not a plain file/);
  assert.equal(fs.existsSync(path.join(w.dir, "menubar", "Lahe.app")), false);
  assert.deepEqual(fs.readdirSync(path.join(w.dir, "menubar")), [], "no build folder left behind");
});

// --- Task 3.2's module half: show and remove -----------------------------------

test("V23: showApp kickstarts the app's item; an unloaded item is bootstrapped only when its plist is what install writes", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  await menubar.installApp(base(w, mac, { clone: w.clone }));
  mac.job(LABEL).running = false; // Hide
  mac.calls.length = 0;
  assert.equal((await menubar.showApp(base(w, mac))).ok, true);
  assert.deepEqual(mac.calls, [["launchctl", "kickstart", "gui/501/" + LABEL]]);
  assert.equal(mac.job(LABEL).running, true);

  // Unloaded (booted out by hand): bootstrap from the fixed path, then start.
  mac.jobs[LABEL] = { loaded: false, running: false };
  mac.calls.length = 0;
  assert.equal((await menubar.showApp(base(w, mac))).ok, true);
  assert.deepEqual(mac.calls.map((c) => c[1]), ["kickstart", "bootstrap", "kickstart"]);

  // A plist someone else changed is refused.
  mac.jobs[LABEL] = { loaded: false, running: false };
  const plistPath = path.join(w.home, "Library", "LaunchAgents", LABEL + ".plist");
  fs.appendFileSync(plistPath, "<!-- changed -->\n");
  mac.calls.length = 0;
  const refused = await menubar.showApp(base(w, mac));
  assert.equal(refused.ok, false);
  assert.match(refused.message, /lahe install --menu-bar/);
  assert.equal(mac.calls.some((c) => c[1] === "bootstrap"), false);
});

test("showApp with the icon not installed says how to install it and runs nothing", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  const result = await menubar.showApp(base(w, mac));
  assert.equal(result.ok, false);
  assert.match(result.message, /lahe install --menu-bar/);
  assert.deepEqual(mac.calls, []);
});

test("V25: removeApp unloads the item, removes its plist, the built app and the menubar block, and leaves nothing loaded", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  await menubar.installApp(base(w, mac, { clone: w.clone }));
  const removed = await menubar.removeApp(base(w, mac));
  assert.equal(removed.ok, true);
  assert.equal(fs.existsSync(path.join(w.home, "Library", "LaunchAgents", LABEL + ".plist")), false);
  assert.equal(fs.existsSync(path.join(w.dir, "menubar", "Lahe.app")), false);
  assert.equal(loginItem.readInstall(w.dir).menubar, undefined);
  assert.deepEqual(mac.job(LABEL), { loaded: false, running: false });
  assert.equal(loginItem.readInstall(w.dir).port, w.record.port, "the rest of install.json stays");
});

// --- Task 3.3: rebuild on change ----------------------------------------------

/** The tick's child process, run in this process with the fake Mac. */
function inProcess(mac) {
  let builds = 0;
  const spawnRebuild = (dir) => {
    builds += 1;
    return menubar.rebuildNow({ stateDir: dir, uid: 501, label: LABEL, runner: mac.runner, arch: "arm64" });
  };
  return { spawnRebuild, builds: () => builds };
}

async function installed(t, options) {
  const w = world(t, options);
  const mac = fakeMac();
  assert.equal((await menubar.installApp(base(w, mac, { clone: w.clone }))).ok, true);
  mac.calls.length = 0;
  return { w, mac };
}

test("V24: an unchanged source stamp does nothing", async (t) => {
  const { w, mac } = await installed(t);
  const child = inProcess(mac);
  const result = await menubar.tick({ stateDir: w.dir, platform: "darwin", spawnRebuild: child.spawnRebuild });
  assert.equal(result.rebuilt, false);
  assert.equal(child.builds(), 0);
  assert.deepEqual(mac.calls, []);
});

test("V24: a changed stamp in the installed clone rebuilds once, swaps the app in, and restarts it because it was running", async (t) => {
  const { w, mac } = await installed(t);
  writeSources(w.clone, "// version two\n");
  const child = inProcess(mac);
  const env = { stateDir: w.dir, platform: "darwin", spawnRebuild: child.spawnRebuild };
  // Two ticks while the first build runs: one build.
  const [first, second] = await Promise.all([menubar.tick(env), menubar.tick(env)]);
  assert.equal(child.builds(), 1);
  assert.equal(first.rebuilt, true);
  assert.equal(second.rebuilt, false);
  assert.equal(fs.readFileSync(appProgram(w), "utf8"), "// version two\n");
  assert.equal(loginItem.readInstall(w.dir).menubar.source_stamp, menubar.sourceStamp(w.clone));
  assert.deepEqual(mac.calls.filter((c) => c[0] === "launchctl"), [
    ["launchctl", "print", "gui/501/" + LABEL],
    ["launchctl", "kickstart", "-k", "gui/501/" + LABEL]
  ]);
  // And again: nothing, the stamp now matches.
  assert.equal((await menubar.tick(env)).rebuilt, false);
  assert.equal(child.builds(), 1);
});

test("V24: a hidden app is rebuilt but not restarted, so it stays hidden", async (t) => {
  const { w, mac } = await installed(t);
  mac.job(LABEL).running = false; // Hide: loaded, not running
  writeSources(w.clone, "// version two\n");
  const child = inProcess(mac);
  await menubar.tick({ stateDir: w.dir, platform: "darwin", spawnRebuild: child.spawnRebuild });
  assert.equal(fs.readFileSync(appProgram(w), "utf8"), "// version two\n");
  assert.equal(mac.calls.some((c) => c[1] === "kickstart"), false, "no kickstart");
  assert.equal(mac.job(LABEL).running, false);
});

test("V24: a failed build keeps the old app, logs, records last_error, and does not retry until the stamp changes again", async (t) => {
  const { w, mac } = await installed(t);
  const before = loginItem.readInstall(w.dir).menubar;
  writeSources(w.clone, "// broken\n");
  const broken = fakeMac({ compiles: false });
  broken.jobs[LABEL] = { loaded: true, running: true };
  const child = inProcess(broken);
  const env = { stateDir: w.dir, platform: "darwin", spawnRebuild: child.spawnRebuild };
  await menubar.tick(env);
  assert.equal(child.builds(), 1);
  assert.equal(fs.readFileSync(appProgram(w), "utf8"), "// version one\n", "the old app stays");
  assert.match(fs.readFileSync(path.join(w.dir, "menubar.log"), "utf8"), /rebuild failed.*expected expression/);
  const after = loginItem.readInstall(w.dir).menubar;
  assert.equal(after.source_stamp, before.source_stamp, "the recorded stamp is still the running app's");
  assert.equal(after.last_error.source_stamp, menubar.sourceStamp(w.clone));
  assert.match(after.last_error.message, /expected expression/);
  assert.equal(broken.calls.some((c) => c[1] === "kickstart"), false, "the old app is not restarted");

  await menubar.tick(env);
  await menubar.tick(env);
  assert.equal(child.builds(), 1, "not retried for the same stamp");

  writeSources(w.clone, "// fixed\n");
  const fixed = fakeMac();
  fixed.jobs[LABEL] = { loaded: true, running: true };
  const again = inProcess(fixed);
  await menubar.tick({ stateDir: w.dir, platform: "darwin", spawnRebuild: again.spawnRebuild });
  assert.equal(again.builds(), 1, "a new stamp is built");
  assert.equal(fs.readFileSync(appProgram(w), "utf8"), "// fixed\n");
  assert.equal(loginItem.readInstall(w.dir).menubar.last_error, undefined, "a good build clears the error");
});

test("V24 and SR5: only the clone install.json names is compiled, never a worktree's copy", async (t) => {
  const { w, mac } = await installed(t);
  // A worktree with its own, newer copy of the app; the running CLI or helper
  // may even live there. The rebuild still reads the installed clone.
  const worktree = path.join(w.root, "worktree");
  writeSources(worktree, "// worktree copy\n");
  writeSources(w.clone, "// version two\n");
  const child = inProcess(mac);
  await menubar.tick({ stateDir: w.dir, platform: "darwin", spawnRebuild: child.spawnRebuild });
  assert.equal(fs.readFileSync(appProgram(w), "utf8"), "// version two\n");
  assert.equal(mac.calls.some((c) => c.some((a) => String(a).indexOf(worktree) !== -1)), false);
  // A worktree change alone never triggers a build.
  writeSources(worktree, "// worktree copy, edited\n");
  assert.equal((await menubar.tick({ stateDir: w.dir, platform: "darwin", spawnRebuild: child.spawnRebuild })).rebuilt, false);
  assert.equal(child.builds(), 1);
});

test("V24: the tick does nothing off macOS, without the icon, or without the source", async (t) => {
  const w = world(t);
  const child = { spawnRebuild: () => { throw new Error("must not build"); } };
  assert.equal((await menubar.tick({ stateDir: w.dir, platform: "linux", spawnRebuild: child.spawnRebuild })).rebuilt, false);
  assert.equal((await menubar.tick({ stateDir: w.dir, platform: "darwin", spawnRebuild: child.spawnRebuild })).rebuilt, false);
  const record = loginItem.readInstall(w.dir);
  record.menubar = { app: "/x", label: LABEL, login_item: "/y", source_stamp: "0".repeat(64), built_at: "2026-10-12T00:00:00.000Z" };
  loginItem.writeInstall(w.dir, record);
  fs.renameSync(path.join(w.clone, "macos"), path.join(w.root, "macos-moved"));
  assert.equal((await menubar.tick({ stateDir: w.dir, platform: "darwin", spawnRebuild: child.spawnRebuild })).rebuilt, false);
});

test("rebuildNow with the icon not installed says how to install it", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  const result = await menubar.rebuildNow({ stateDir: w.dir, uid: 501, label: LABEL, runner: mac.runner, arch: "arm64" });
  assert.equal(result.ok, false);
  assert.match(result.message, /lahe install --menu-bar/);
  assert.deepEqual(mac.calls, []);
});

// --- Task 3.4's module half: what status prints ---------------------------------

test("V26: appState reads installed and running, installed and not running, not installed, a failed rebuild, and stopped", async (t) => {
  const w = world(t);
  const mac = fakeMac();
  const ask = () => menubar.appState({ stateDir: w.dir, uid: 501, label: LABEL, runner: mac.runner, platform: "darwin" });
  assert.deepEqual(await ask(), { installed: false, running: false, stopped: null, lastError: null });
  await menubar.installApp(base(w, mac, { clone: w.clone }));
  assert.equal((await ask()).running, true);
  mac.job(LABEL).running = false;
  assert.equal((await ask()).running, false);
  assert.equal((await ask()).installed, true);
  const record = loginItem.readInstall(w.dir);
  record.menubar.last_error = { at: "2026-10-12T15:00:00.000Z", message: "error: expected expression", source_stamp: "a".repeat(64) };
  loginItem.writeInstall(w.dir, record);
  assert.equal((await ask()).lastError.message, "error: expected expression");
  fs.writeFileSync(path.join(w.dir, loginItem.STOP_FILE), JSON.stringify({ by: "menu bar", at: "2026-10-12T15:41:00.000Z" }));
  assert.deepEqual((await ask()).stopped, { by: "menu bar", at: "2026-10-12T15:41:00.000Z" });
  assert.ok(mac.calls.filter((c) => c[0] === "launchctl").slice(-5).every((c) => c[1] === "print"), "status only reads");
});

test("labels are constants: the real label is lahe-menubar, and a label read from install.json is never used", async (t) => {
  assert.equal(menubar.LABEL, "lahe-menubar");
  const w = world(t);
  const mac = fakeMac();
  await menubar.installApp(base(w, mac, { clone: w.clone }));
  const record = loginItem.readInstall(w.dir);
  record.menubar.label = "com.apple.Finder";
  loginItem.writeInstall(w.dir, record);
  mac.calls.length = 0;
  await menubar.showApp(base(w, mac));
  await menubar.appState({ stateDir: w.dir, uid: 501, label: LABEL, runner: mac.runner, platform: "darwin" });
  await menubar.removeApp(base(w, mac));
  assert.equal(mac.calls.some((c) => c.join(" ").indexOf("com.apple.Finder") !== -1), false);
});
