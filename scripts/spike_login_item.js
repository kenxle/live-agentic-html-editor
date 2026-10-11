// Spike for stable addresses Task 5.1: does the login item this clone writes
// start the helper, restart it when it is killed, start it on request, and
// go away cleanly, on this machine's real service manager?
//
//   node scripts/spike_login_item.js [--ci]
//
// It uses src/service/login_item.js as `lahe install` does, with a unique
// label, a throwaway state folder, and a free port. It never touches the real
// login item (label lahe-helper), port 7817, or ~/.local/state/lahe, and it
// removes its own login item in a finally block whatever happens.
//
// --ci prepares a GitHub runner first. On Linux that is a user systemd: a CI
// job has no login session, so it turns on lingering for the runner account
// and points the environment at that user's bus.
//
// Prints one line per step and ends with "SPIKE RESULT: pass" or
// "SPIKE RESULT: fail". Login itself cannot be shown here; the service
// manager's own start stands in for it.
//
// Temporary: removed at the stable addresses feature's cleanup, with
// .github/workflows/spike.yml.

"use strict";

var childProcess = require("node:child_process");
var crypto = require("node:crypto");
var fs = require("node:fs");
var net = require("node:net");
var os = require("node:os");
var path = require("node:path");

var loginItem = require("../src/service/login_item.js");
var service = require("../src/service/index.js");
var stateDirModule = require("../src/service/state_dir.js");

var ENTRY = path.join(__dirname, "..", "bin", "lahe.js");
var HOST = "127.0.0.1";

function say(line) {
  process.stdout.write(line + "\n");
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function freePort() {
  return new Promise(function (resolve, reject) {
    var server = net.createServer();
    server.once("error", reject);
    server.listen(0, HOST, function () {
      var port = server.address().port;
      server.close(function () { resolve(port); });
    });
  });
}

async function waitFor(check, ms) {
  var started = Date.now();
  while (Date.now() - started < ms) {
    var value = await check();
    if (value) return { value: value, seconds: ((Date.now() - started) / 1000).toFixed(1) };
    await sleep(250);
  }
  return null;
}

function readyFile(dir) {
  try { return JSON.parse(fs.readFileSync(stateDirModule.readyPath(dir), "utf8")); } catch (err) { return null; }
}

function run(argv) {
  var result = loginItem.defaultRunner(argv[0], argv.slice(1));
  say("  $ " + argv.join(" ") + "  -> " + result.status + (result.output.trim() ? "  " + result.output.trim().split("\n").slice(0, 3).join(" | ") : ""));
  return result;
}

function prepareLinuxCi() {
  var user = os.userInfo();
  run(["sudo", "loginctl", "enable-linger", user.username]);
  var runtime = "/run/user/" + user.uid;
  process.env.XDG_RUNTIME_DIR = runtime;
  process.env.DBUS_SESSION_BUS_ADDRESS = "unix:path=" + runtime + "/bus";
}

async function main() {
  var ci = process.argv.indexOf("--ci") !== -1;
  var system = loginItem.systemFor(process.platform);
  if (!system) {
    say("SPIKE RESULT: fail (no login item for " + process.platform + ")");
    return 1;
  }
  if (ci && system === "linux") {
    prepareLinuxCi();
    await waitFor(function () { return fs.existsSync(process.env.XDG_RUNTIME_DIR + "/bus"); }, 15000);
  }

  var root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-spike-")));
  var dir = path.join(root, "state dir");
  var port = await freePort();
  var label = "lahe-spike-" + crypto.randomBytes(4).toString("hex");
  // macOS loads a plist from any path, so the spike's stays in its temp
  // folder. systemd only finds user units in its own folders.
  var home = system === "macos" ? path.join(root, "home") : os.homedir();
  var item = loginItem.describe({
    system: system,
    home: home,
    label: label,
    uid: typeof process.getuid === "function" ? process.getuid() : null,
    user: (process.env.USERDOMAIN ? process.env.USERDOMAIN + "\\" : "") + (process.env.USERNAME || os.userInfo().username),
    node: process.execPath,
    entry: ENTRY,
    port: port,
    stateDir: dir
  });
  var verdicts = {};
  say("spike: " + system + ", label " + label + ", port " + port + ", state " + dir);
  say("spike: item " + item.path);

  var up = function () {
    return service.probeHealth(HOST, port).then(function (live) { return live && live.always_on === true ? live : null; });
  };

  try {
    // 1. Install and start.
    fs.mkdirSync(dir, { recursive: true });
    loginItem.writeInstall(dir, { system: system, label: label, port: port, state_dir: dir, login_item: item.path });
    loginItem.writeItem(item);
    item.load.forEach(run);
    var first = await waitFor(up, 30000);
    verdicts.start = first ? "ok in " + first.seconds + "s" : "fail: no helper within 30s";
    say("START: " + verdicts.start);
    if (!first) return 1;

    // 2. Killed hard: does the service manager bring it back?
    var pid1 = readyFile(dir).pid;
    process.kill(pid1, "SIGKILL");
    var back = await waitFor(function () {
      return up().then(function (live) { return live && live.started_at !== first.value.started_at ? live : null; });
    }, 150000);
    verdicts.restart = back ? "ok in " + back.seconds + "s (pid " + pid1 + " -> " + readyFile(dir).pid + ")" : "fail: not restarted within 150s";
    say("RESTART: " + verdicts.restart);

    // 3. Stopped, then started on request, the way the CLI asks for it.
    var current = await up();
    if (current) {
      var pid2 = readyFile(dir).pid;
      process.kill(pid2, "SIGTERM");
      await waitFor(function () { return service.probeHealth(HOST, port).then(function (live) { return !live || live.started_at !== current.started_at; }); }, 10000);
      loginItem.startCommands({ system: system, label: label }).forEach(run);
      var kicked = await waitFor(function () {
        return up().then(function (live) { return live && live.started_at !== current.started_at ? live : null; });
      }, 30000);
      verdicts.kick = kicked ? "ok in " + kicked.seconds + "s" : "fail: not started within 30s";
    } else {
      verdicts.kick = "skipped: no helper to stop";
    }
    say("START ON REQUEST: " + verdicts.kick);
  } catch (err) {
    say("spike error: " + (err && err.stack ? err.stack : String(err)));
    verdicts.error = String(err && err.message);
  } finally {
    // 4. Uninstall, whatever happened above.
    item.unload.forEach(run);
    try { fs.unlinkSync(item.path); } catch (err) { /* already gone */ }
    if (system === "linux") run(["systemctl", "--user", "daemon-reload"]);
    var ready = readyFile(dir);
    if (ready && (await service.probeHealth(HOST, port))) {
      try { process.kill(ready.pid, "SIGTERM"); } catch (err) { /* gone */ }
    }
    var gone = await waitFor(function () { return service.probeHealth(HOST, port).then(function (live) { return !live; }); }, 15000);
    var known;
    if (system === "macos") known = run(["launchctl", "print", "gui/" + process.getuid() + "/" + label]).status === 0;
    else if (system === "linux") known = run(["systemctl", "--user", "cat", label + ".service"]).status === 0;
    else known = run(["schtasks", "/Query", "/TN", label]).status === 0;
    // Still restarting after all that: stop it by force, and say so.
    if (known && system === "macos") run(["launchctl", "bootout", "gui/" + process.getuid() + "/" + label]);
    verdicts.uninstall = gone && !known ? "ok" : "fail: " + (gone ? "" : "helper still answering; ") + (known ? "service manager still knows " + label : "");
    say("UNINSTALL: " + verdicts.uninstall);
    var logPath = path.join(dir, loginItem.LOG_FILE);
    if (fs.existsSync(logPath)) say("login item log:\n" + fs.readFileSync(logPath, "utf8").split("\n").slice(-20).join("\n"));
  }
  var pass = ["start", "restart", "kick", "uninstall"].every(function (k) { return /^ok/.test(verdicts[k] || ""); });
  say("SPIKE RESULT: " + (pass ? "pass" : "fail"));
  return pass ? 0 : 1;
}

main().then(function (code) { process.exitCode = code; }, function (err) {
  say("SPIKE RESULT: fail (" + (err && err.stack ? err.stack : err) + ")");
  process.exitCode = 1;
});
