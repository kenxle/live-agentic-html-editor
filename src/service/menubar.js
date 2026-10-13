// The menu bar app: its one build recipe, its login item, and the rebuild tick.
//
// Owner: menu-bar install. macOS only; every other system skips it. The app
// itself is Swift in macos/menubar/ (the macapp workstream); this file turns
// that source into <state>/menubar/Lahe.app and keeps it current. See the menu
// bar architecture, "Install, rebuild, and Quit".
//
// ONE BUILD RECIPE. `lahe install --menu-bar`, `lahe menubar rebuild`, the
// helper's rebuild tick and scripts/check_menubar.js all call build() below.
// It is the only place the file list and the compiler flags are spelled.
//
// WHAT A BUILD COMPILES (security review SR5). Only the fixed file list, only
// from the clone install.json names (never a worktree), copied into a fresh
// folder first, hashed there, compiled there with /usr/bin/xcrun as an
// argument array (never a shell), and renamed into place only on success. The
// fresh folder sits inside <state>/menubar so the final rename stays on one
// volume and is atomic.
//
// LABELS ARE CONSTANTS (SR6). The real label is LABEL. Tests pass their own
// (lahe-test-...) through the `label` option; nothing here reads a label from
// install.json to run launchctl. The block install.json records is what
// `lahe status` prints and what the tick compares, nothing more.
//
// A REBUILD RESPECTS HIDE. After swapping a rebuilt app in, it is restarted
// only if launchctl says it was running, so a hidden icon stays hidden through
// a `git pull` (brief R17).
//
// Node-only. No dependencies. Every system call goes through a runner,
// (command, args) => {status, output}, so the tests play the Mac.

"use strict";

var childProcess = require("node:child_process");
var crypto = require("node:crypto");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var loginItem = require("./login_item.js");

var LABEL = loginItem.MENUBAR_LABEL;
var XCRUN = "/usr/bin/xcrun";
// The fixed file list, in the order the stamp hashes them. Swift files are
// compiled; Info.plist becomes Contents/Info.plist.
var SOURCE_FILES = ["LaheMenuBar.swift", "Info.plist"];
var SOURCE_DIR = ["macos", "menubar"];
var APP_FOLDER = "menubar";
var APP_NAME = "Lahe.app";
// Info.plist's CFBundleExecutable names this.
var EXECUTABLE = "LaheMenuBar";
var MACOS_FLOOR = "13.0";
// The pinned flags, less the target and the output. Part of the stamp, so a
// change to the recipe rebuilds the app just as a change to its source does.
var COMPILE_FLAGS = ["-swift-version", "5"];
var OPTIMIZE_FLAGS = ["-O"];
var LOG_FILE = "menubar.log";
var BUILD_PREFIX = ".build-";
// A build folder this old was left by a build that was killed (the helper
// restarting mid-build, say). Younger ones may be another build still running.
var STALE_BUILD_MS = 60 * 60 * 1000;
// swiftc -O on one file takes seconds; a slow Mac gets plenty of room.
var COMPILE_TIMEOUT_MS = 10 * 60 * 1000;

var FAILED = {
  NO_TOOLS: "no_tools",
  SOURCE: "source",
  COMPILE: "compile",
  NOT_INSTALLED: "not_installed",
  NOT_MACOS: "not_macos"
};

var TARGET_ARCH = { arm64: "arm64", x64: "x86_64" };

/** The swiftc target for a Node `process.arch`: the host architecture and the macOS floor. */
function targetFor(arch) {
  if (!Object.prototype.hasOwnProperty.call(TARGET_ARCH, arch)) throw new Error("no menu bar app for the " + arch + " architecture");
  return TARGET_ARCH[arch] + "-apple-macosx" + MACOS_FLOOR;
}

function sourceDir(clone) {
  return path.join.apply(path, [clone].concat(SOURCE_DIR));
}

/**
 * The stamp of a folder holding the fixed file list: sha256 over the recipe
 * and then each file's name, length and bytes, in list order. Throws when a
 * file is missing.
 */
function stampOf(dir) {
  var hash = crypto.createHash("sha256");
  hash.update("recipe\0" + COMPILE_FLAGS.concat(OPTIMIZE_FLAGS, [MACOS_FLOOR]).join(" ") + "\0");
  SOURCE_FILES.forEach(function (name) {
    var bytes = fs.readFileSync(path.join(dir, name));
    hash.update(name + "\0" + bytes.length + "\0");
    hash.update(bytes);
  });
  return hash.digest("hex");
}

/** The stamp of the app's source in a clone. */
function sourceStamp(clone) {
  return stampOf(sourceDir(clone));
}

function checkedDefine(name) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(String(name))) throw new Error("not a compile-time name: " + JSON.stringify(name));
  return String(name);
}

/** The compile command: /usr/bin/xcrun swiftc with the pinned flags. */
function compileCommand(options) {
  var defines = [];
  (options.defines || []).forEach(function (name) { defines.push("-D", checkedDefine(name)); });
  return [XCRUN, "swiftc"]
    .concat(COMPILE_FLAGS, ["-target", targetFor(options.arch)], OPTIMIZE_FLAGS, defines, ["-o", options.out], options.sources);
}

function defaultRunner(command, args) {
  var compiling = command === XCRUN && args[0] === "swiftc";
  var result = childProcess.spawnSync(command, args, {
    encoding: "utf8",
    timeout: compiling ? COMPILE_TIMEOUT_MS : 30000,
    maxBuffer: 16 * 1024 * 1024
  });
  if (result.error) return { status: -1, output: result.error.message };
  return { status: result.status, output: (result.stdout || "") + (result.stderr || "") };
}

function failure(code, message) {
  return { ok: false, code: code, message: message };
}

function firstLines(text, count) {
  return String(text || "").trim().split("\n").slice(0, count).join("\n").slice(0, 2000);
}

function appPath(stateDir) {
  return path.join(stateDir, APP_FOLDER, APP_NAME);
}

function removeTree(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

/** Clear build folders a killed build left behind. */
function sweepStaleBuilds(folder, nowMs) {
  var names;
  try { names = fs.readdirSync(folder); } catch (err) { return; }
  names.forEach(function (name) {
    if (name.indexOf(BUILD_PREFIX) !== 0) return;
    var full = path.join(folder, name);
    try {
      if (nowMs - fs.statSync(full).mtimeMs > STALE_BUILD_MS) removeTree(full);
    } catch (err) { /* already gone */ }
  });
}

/** Put the new app where the old one was, keeping the old one until the new one is in. */
function swapInto(built, dest) {
  var aside = null;
  if (fs.existsSync(dest)) {
    aside = dest + ".old-" + process.pid + "-" + Date.now();
    fs.renameSync(dest, aside);
  }
  try {
    fs.renameSync(built, dest);
  } catch (err) {
    if (aside) fs.renameSync(aside, dest);
    throw err;
  }
  // A running app keeps its open program file, so removing the old copy
  // under it is safe; the restart (or the next login) runs the new one.
  if (aside) removeTree(aside);
}

/**
 * The one build recipe. Builds <state>/menubar/Lahe.app from the fixed file
 * list in `clone`, or says why not. Nothing is replaced unless the build
 * succeeds.
 *
 * @param {{clone: string, stateDir: string, runner?: function, arch?: string,
 *          defines?: string[], now?: function(): number}} options
 *   `defines` adds `-D <name>` per name: the app's test labels, for a test build
 * @returns {Promise<{ok: true, app: string, stamp: string, builtAt: string}|
 *                   {ok: false, code: string, message: string}>}
 */
async function build(options) {
  var run = options.runner || defaultRunner;
  var now = options.now || Date.now;
  var arch = options.arch || process.arch;
  // Checked before anything runs: a bad name is a caller's mistake.
  (options.defines || []).forEach(checkedDefine);
  targetFor(arch);

  var tools = await run(XCRUN, ["--find", "swiftc"]);
  if (!tools || tools.status !== 0) {
    return failure(
      FAILED.NO_TOOLS,
      "the menu bar icon needs Apple's command line tools, and this Mac does not have them (xcrun could not find swiftc). " +
        "Run `xcode-select --install`, then `lahe install --menu-bar`."
    );
  }

  var folder = path.join(options.stateDir, APP_FOLDER);
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  sweepStaleBuilds(folder, now());
  var work = fs.mkdtempSync(path.join(folder, BUILD_PREFIX));
  try {
    var from = sourceDir(options.clone);
    var src = path.join(work, "src");
    fs.mkdirSync(src);
    for (var i = 0; i < SOURCE_FILES.length; i += 1) {
      var name = SOURCE_FILES[i];
      var stat;
      try { stat = fs.lstatSync(path.join(from, name)); } catch (err) {
        return failure(FAILED.SOURCE, "the menu bar app's source " + path.join(from, name) + " is missing");
      }
      if (!stat.isFile()) return failure(FAILED.SOURCE, path.join(from, name) + " is not a plain file, so it is not built");
      fs.copyFileSync(path.join(from, name), path.join(src, name));
    }
    var stamp = stampOf(src);

    var app = path.join(work, APP_NAME);
    var program = path.join(app, "Contents", "MacOS", EXECUTABLE);
    fs.mkdirSync(path.dirname(program), { recursive: true });
    var sources = SOURCE_FILES.filter(function (n) { return /\.swift$/.test(n); }).map(function (n) { return path.join(src, n); });
    var command = compileCommand({ arch: arch, out: program, sources: sources, defines: options.defines });
    var compiled = await run(command[0], command.slice(1));
    if (!compiled || compiled.status !== 0) {
      return failure(FAILED.COMPILE, "swiftc failed: " + firstLines(compiled && compiled.output, 20));
    }
    if (!fs.existsSync(program)) return failure(FAILED.COMPILE, "swiftc reported success but wrote no program");
    fs.copyFileSync(path.join(src, "Info.plist"), path.join(app, "Contents", "Info.plist"));

    var dest = appPath(options.stateDir);
    swapInto(app, dest);
    return { ok: true, app: dest, stamp: stamp, builtAt: new Date(now()).toISOString() };
  } finally {
    removeTree(work);
  }
}

// ---------------------------------------------------------------------------
// The login item
// ---------------------------------------------------------------------------

/**
 * The app's login item, computed and not yet written. RunAtLoad starts it at
 * login; KeepAlive restarts it only on a crash, so Hide (a clean exit) holds
 * until the next login or `lahe menubar show`.
 *
 * @param {{home: string, uid: number, label?: string, stateDir: string}} spec
 */
function describeApp(spec) {
  var label = loginItem.knownLabel(spec.label || LABEL);
  var domain = "gui/" + spec.uid;
  var plistPath = path.join(spec.home, "Library", "LaunchAgents", label + ".plist");
  var program = path.join(appPath(spec.stateDir), "Contents", "MacOS", EXECUTABLE);
  return {
    system: "macos",
    label: label,
    path: plistPath,
    contents: loginItem.plistText(label, [program, "--state-dir", spec.stateDir], path.join(spec.stateDir, LOG_FILE), { keepAliveOnCrash: true }),
    load: [["launchctl", "bootstrap", domain, plistPath], ["launchctl", "kickstart", domain + "/" + label]],
    unload: [["launchctl", "bootout", domain + "/" + label]],
    show: [["launchctl", "kickstart", domain + "/" + label]],
    restart: [["launchctl", "kickstart", "-k", domain + "/" + label]],
    print: ["launchctl", "print", domain + "/" + label]
  };
}

function specOf(options) {
  return {
    home: options.home || os.homedir(),
    uid: typeof options.uid === "number" ? options.uid : process.getuid(),
    label: options.label || LABEL,
    stateDir: options.stateDir
  };
}

/**
 * Change install.json's menubar block and nothing else in it. `block` replaces
 * it whole, null removes it, and a function receives the current block and
 * returns the new one.
 */
function writeBlock(stateDir, block) {
  var record = loginItem.readInstall(stateDir);
  if (!record) return;
  var next = typeof block === "function" ? block(record.menubar || {}) : block;
  if (next === null) delete record.menubar;
  else record.menubar = next;
  loginItem.writeInstall(stateDir, record);
}

function appendLog(stateDir, line) {
  try {
    fs.appendFileSync(path.join(stateDir, LOG_FILE), new Date().toISOString() + " " + line.replace(/\n/g, "\n    ") + "\n");
  } catch (err) { /* the log is a courtesy; the record carries the error too */ }
}

/** Is the app running now, by `launchctl print`? False when its item is not loaded. */
async function isRunning(item, run) {
  var printed = await run(item.print[0], item.print.slice(1));
  return !!printed && printed.status === 0 && /^\s*state = running\s*$/m.test(String(printed.output || ""));
}

/**
 * Build the app, write its login item, load and start it, and record the
 * menubar block. A failed build writes no plist and records nothing.
 *
 * @param {{clone: string, stateDir: string, home?: string, uid?: number,
 *          label?: string, runner?: function, arch?: string, defines?: string[]}} options
 */
async function installApp(options) {
  var run = options.runner || defaultRunner;
  var built = await build(options);
  if (!built.ok) {
    if (built.code !== FAILED.NO_TOOLS) appendLog(options.stateDir, "install build failed: " + built.message);
    return built;
  }
  var item = describeApp(specOf(options));
  loginItem.writeItem(item);
  // Not loaded yet is the usual answer; an earlier copy must go first, or
  // bootstrap refuses a label it already has.
  await loginItem.runCommands(item.unload, run);
  var loaded = await loginItem.runCommands(item.load, run);
  writeBlock(options.stateDir, {
    app: built.app,
    label: item.label,
    login_item: item.path,
    source_stamp: built.stamp,
    built_at: built.builtAt
  });
  return { ok: true, item: item, app: built.app, loaded: loaded };
}

function notInstalled() {
  return failure(FAILED.NOT_INSTALLED, "the menu bar icon is not installed; `lahe install --menu-bar` adds it");
}

/**
 * Bring a hidden icon back: kickstart its item. An item launchd has no record
 * of is bootstrapped from its fixed path first, only when the plist there is
 * exactly what install writes.
 */
async function showApp(options) {
  var run = options.runner || defaultRunner;
  var record = loginItem.readInstall(options.stateDir);
  if (!record || !record.menubar) return notInstalled();
  var item = describeApp(specOf(options));
  var shown = await loginItem.runCommands(item.show, run);
  if (shown.ok) return { ok: true };
  if (!shown.notLoaded) return failure("launchctl", "launchd did not start the menu bar app (" + shown.failed + ")");
  var actual = null;
  try { actual = fs.readFileSync(item.path, "utf8"); } catch (err) { actual = null; }
  if (actual !== item.contents) {
    return failure(
      FAILED.NOT_INSTALLED,
      "the menu bar app's login item " + item.path + " is missing or not what Lahe writes, so it was not loaded; run `lahe install --menu-bar`"
    );
  }
  var loaded = await loginItem.runCommands(item.load, run);
  return loaded.ok ? { ok: true } : failure("launchctl", "launchd did not start the menu bar app (" + loaded.failed + ")");
}

/** Unload the app's item, remove its plist, the built app and the menubar block. */
async function removeApp(options) {
  var run = options.runner || defaultRunner;
  var item = describeApp(specOf(options));
  // Not loaded is fine: the goal is that it is not.
  await loginItem.runCommands(item.unload, run);
  try { fs.unlinkSync(item.path); } catch (err) { if (err.code !== "ENOENT") throw err; }
  removeTree(appPath(options.stateDir));
  writeBlock(options.stateDir, null);
  return { ok: true, item: item };
}

/**
 * Build again now, from the clone install.json names, and swap the app in. On
 * success the block's stamp moves and the app restarts if it was running. On
 * failure the old app stays, the error goes to menubar.log and to the block's
 * last_error, and the tick does not try this stamp again.
 */
async function rebuildNow(options) {
  var run = options.runner || defaultRunner;
  var record = loginItem.readInstall(options.stateDir);
  if (!record || !record.menubar) return notInstalled();
  if (!record.clone) return failure(FAILED.SOURCE, "install.json names no clone to build from; run `lahe install --menu-bar`");
  var built = await build({
    clone: record.clone,
    stateDir: options.stateDir,
    runner: run,
    arch: options.arch,
    defines: options.defines,
    now: options.now
  });
  if (!built.ok) {
    var stamp = null;
    try { stamp = sourceStamp(record.clone); } catch (err) { stamp = null; }
    appendLog(options.stateDir, "rebuild failed (source " + (stamp ? stamp.slice(0, 12) : "unreadable") + "): " + built.message);
    var lastError = { at: new Date((options.now || Date.now)()).toISOString(), message: built.message, source_stamp: stamp };
    writeBlock(options.stateDir, function (block) { return Object.assign({}, block, { last_error: lastError }); });
    return built;
  }
  writeBlock(options.stateDir, function (block) {
    var next = Object.assign({}, block, { app: built.app, source_stamp: built.stamp, built_at: built.builtAt });
    delete next.last_error;
    return next;
  });

  var item = describeApp(specOf(options));
  var restarted = false;
  if (await isRunning(item, run)) {
    var again = await loginItem.runCommands(item.restart, run);
    restarted = again.ok;
    if (!again.ok) appendLog(options.stateDir, "rebuilt, but the restart failed: " + again.failed);
  }
  appendLog(options.stateDir, "rebuilt from source " + built.stamp.slice(0, 12) + (restarted ? ", restarted" : ", not running so not restarted"));
  return { ok: true, app: built.app, stamp: built.stamp, restarted: restarted };
}

// ---------------------------------------------------------------------------
// The rebuild tick
// ---------------------------------------------------------------------------

// One build at a time per state folder: a 15-second tick must not start a
// second while a slow first is still compiling.
var inFlight = new Map();

/** Run the rebuild in a child process, so the helper's event loop never waits on swiftc. */
function spawnRebuildChild(stateDir) {
  return new Promise(function (resolve) {
    var child = childProcess.spawn(process.execPath, [__filename, "rebuild", "--state-dir", stateDir], { stdio: "ignore" });
    child.once("error", function (err) {
      appendLog(stateDir, "could not start the rebuild: " + err.message);
      resolve({ ok: false });
    });
    child.once("exit", function (code) { resolve({ ok: code === 0 }); });
  });
}

/**
 * The helper calls this from its 15-second timer. On macOS with the icon
 * installed: when the source stamp in the clone install.json names differs
 * from the recorded one, and is not a stamp that already failed, rebuild.
 *
 * @param {{stateDir: string, platform?: string,
 *          spawnRebuild?: function(string): Promise}} env
 *   `spawnRebuild` is the tests' stand-in for the child process
 * @returns {Promise<{rebuilt: boolean, reason?: string}>}
 */
function tick(env) {
  var platform = env.platform || process.platform;
  if (platform !== "darwin") return Promise.resolve({ rebuilt: false, reason: FAILED.NOT_MACOS });
  var dir = env.stateDir;
  if (inFlight.has(dir)) return Promise.resolve({ rebuilt: false, reason: "building" });
  var record = loginItem.readInstall(dir);
  if (!record || !record.menubar || !record.clone) return Promise.resolve({ rebuilt: false, reason: FAILED.NOT_INSTALLED });
  var stamp;
  try { stamp = sourceStamp(record.clone); } catch (err) {
    return Promise.resolve({ rebuilt: false, reason: FAILED.SOURCE });
  }
  if (stamp === record.menubar.source_stamp) return Promise.resolve({ rebuilt: false, reason: "current" });
  var failed = record.menubar.last_error;
  if (failed && failed.source_stamp === stamp) return Promise.resolve({ rebuilt: false, reason: "failed before" });
  var spawn = env.spawnRebuild || spawnRebuildChild;
  var running = Promise.resolve()
    .then(function () { return spawn(dir); })
    .then(function (result) { return { rebuilt: !!(result && result.ok) }; }, function (err) {
      appendLog(dir, "rebuild crashed: " + (err && err.message ? err.message : String(err)));
      return { rebuilt: false, reason: "crashed" };
    })
    .finally(function () { inFlight.delete(dir); });
  inFlight.set(dir, running);
  return running;
}

// ---------------------------------------------------------------------------
// What `lahe status` prints
// ---------------------------------------------------------------------------

/**
 * The icon's state, read only: whether the block is recorded, whether
 * launchctl says it runs, the stop marker, and the last failed rebuild.
 */
async function appState(options) {
  var run = options.runner || defaultRunner;
  var record = loginItem.readInstall(options.stateDir);
  var block = record && record.menubar ? record.menubar : null;
  var running = false;
  if (block && (options.platform || process.platform) === "darwin") running = await isRunning(describeApp(specOf(options)), run);
  return {
    installed: !!block,
    running: running,
    stopped: loginItem.readStopMarker(options.stateDir),
    lastError: block && block.last_error ? block.last_error : null
  };
}

module.exports = {
  LABEL: LABEL,
  XCRUN: XCRUN,
  SOURCE_FILES: SOURCE_FILES,
  SOURCE_DIR: SOURCE_DIR,
  EXECUTABLE: EXECUTABLE,
  MACOS_FLOOR: MACOS_FLOOR,
  LOG_FILE: LOG_FILE,
  FAILED: FAILED,
  targetFor: targetFor,
  sourceStamp: sourceStamp,
  compileCommand: compileCommand,
  appPath: appPath,
  build: build,
  describeApp: describeApp,
  installApp: installApp,
  showApp: showApp,
  removeApp: removeApp,
  rebuildNow: rebuildNow,
  tick: tick,
  appState: appState,
  defaultRunner: defaultRunner
};

// The tick's child process: `node menubar.js rebuild --state-dir <dir>`.
if (require.main === module) {
  var argv = process.argv.slice(2);
  var at = argv.indexOf("--state-dir");
  if (argv[0] !== "rebuild" || at === -1 || !argv[at + 1]) {
    process.stderr.write("usage: node src/service/menubar.js rebuild --state-dir <path>\n");
    process.exit(2);
  }
  rebuildNow({ stateDir: argv[at + 1] }).then(function (result) {
    process.exit(result.ok ? 0 : 1);
  }, function (err) {
    appendLog(argv[at + 1], "rebuild crashed: " + (err && err.message ? err.message : String(err)));
    process.exit(1);
  });
}
