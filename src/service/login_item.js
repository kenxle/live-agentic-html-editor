// The login item: what makes the helper start at login and restart if it stops.
//
// Owner: stable addresses, install workstream. `lahe install` writes one of
// these and `lahe uninstall` removes it (src/cli/commands/install.js). The CLI
// reads install.json to know it must ask the login item for a helper instead
// of spawning its own (startHelper in src/cli/commands/session.js and add.js).
//
// ONE ITEM PER SYSTEM.
//
//   macOS    ~/Library/LaunchAgents/<label>.plist, RunAtLoad and KeepAlive,
//            loaded with `launchctl bootstrap gui/<uid>`.
//   Linux    ~/.config/systemd/user/<label>.service, Restart=always, enabled
//            with `systemctl --user enable --now`.
//   Windows  a Task Scheduler task imported from XML: at logon, plus a
//            once-a-minute trigger that starts it again if it stopped (a task
//            already running ignores it), plus restart on failure.
//
// THE ITEM PINS EVERYTHING. A service manager does not start programs with the
// user's shell environment, so the item names the Node that ran the install,
// the clone's bin/lahe.js, the port, and the resolved state folder, all as
// absolute paths. Nothing is read from PATH or LAHE_STATE_DIR at login.
//
// EVERY ARGUMENT IS QUOTED BY ITS OWN FORMAT'S RULES: a plist <string> per
// argument, systemd's double-quote rules (with % and $ doubled), and the
// Windows command-line rules inside XML. The commands that load and start an
// item are argument arrays for execFile, never a shell line.
//
// Node-only. No dependencies.

"use strict";

var childProcess = require("node:child_process");
var fs = require("node:fs");
var path = require("node:path");

var LABEL = "lahe-helper";
var INSTALL_FILE = "install.json";
var LOG_FILE = "login-item.log";
var WINDOWS_XML_FILE = "login-item.xml";

/** "macos", "linux", "windows", or null for a system with no login item. */
function systemFor(platform) {
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  if (platform === "win32") return "windows";
  return null;
}

/** What the login item runs: the pinned Node, the clone's entry, and serve. */
function helperArgs(spec) {
  return [spec.node, spec.entry, "serve", "--always-on", "--port", String(spec.port), "--state-dir", spec.stateDir];
}

function xmlEscape(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** One argument in a systemd ExecStart line. */
function systemdQuote(arg) {
  return '"' + String(arg).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$") + '"';
}

/**
 * One argument on a Windows command line, by the rules CommandLineToArgvW and
 * the C runtime read it back with: backslashes are literal unless they come
 * before a quote (or the closing quote), where they are doubled.
 */
function windowsQuote(arg) {
  var text = String(arg);
  if (text !== "" && !/[\s"]/.test(text)) return text;
  var out = '"';
  var slashes = 0;
  for (var i = 0; i < text.length; i += 1) {
    var ch = text[i];
    if (ch === "\\") {
      slashes += 1;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(slashes * 2 + 1) + '"';
    } else {
      out += "\\".repeat(slashes) + ch;
    }
    slashes = 0;
  }
  return out + "\\".repeat(slashes * 2) + '"';
}

function plist(label, args, logPath) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    "  <string>" + xmlEscape(label) + "</string>",
    "  <key>ProgramArguments</key>",
    "  <array>"
  ]
    .concat(args.map(function (arg) { return "    <string>" + xmlEscape(arg) + "</string>"; }))
    .concat([
      "  </array>",
      "  <key>RunAtLoad</key>",
      "  <true/>",
      "  <key>KeepAlive</key>",
      "  <true/>",
      "  <key>StandardOutPath</key>",
      "  <string>" + xmlEscape(logPath) + "</string>",
      "  <key>StandardErrorPath</key>",
      "  <string>" + xmlEscape(logPath) + "</string>",
      "</dict>",
      "</plist>",
      ""
    ])
    .join("\n");
}

function systemdUnit(args) {
  return [
    "[Unit]",
    "Description=Lahe helper: serves review pages at stable addresses",
    "",
    "[Service]",
    "ExecStart=" + args.map(systemdQuote).join(" "),
    "Restart=always",
    "RestartSec=2",
    "",
    "[Install]",
    "WantedBy=default.target",
    ""
  ].join("\n");
}

function taskXml(user, args, startBoundary) {
  // conhost --headless runs the console program with no window. node.exe is a
  // console program, so started directly at logon it would open one.
  var argLine = ["--headless"].concat(args.map(windowsQuote)).join(" ");
  var who = xmlEscape(user);
  return [
    '<?xml version="1.0" encoding="UTF-16"?>',
    '<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">',
    "  <RegistrationInfo>",
    "    <Description>Lahe helper: serves review pages at stable addresses</Description>",
    "  </RegistrationInfo>",
    "  <Triggers>",
    "    <LogonTrigger>",
    "      <Enabled>true</Enabled>",
    "      <UserId>" + who + "</UserId>",
    "    </LogonTrigger>",
    "    <TimeTrigger>",
    "      <Repetition>",
    "        <Interval>PT1M</Interval>",
    "        <StopAtDurationEnd>false</StopAtDurationEnd>",
    "      </Repetition>",
    "      <StartBoundary>" + xmlEscape(startBoundary) + "</StartBoundary>",
    "      <Enabled>true</Enabled>",
    "    </TimeTrigger>",
    "  </Triggers>",
    "  <Principals>",
    '    <Principal id="Author">',
    "      <UserId>" + who + "</UserId>",
    "      <LogonType>InteractiveToken</LogonType>",
    "      <RunLevel>LeastPrivilege</RunLevel>",
    "    </Principal>",
    "  </Principals>",
    "  <Settings>",
    "    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>",
    "    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>",
    "    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>",
    "    <AllowHardTerminate>true</AllowHardTerminate>",
    "    <StartWhenAvailable>true</StartWhenAvailable>",
    "    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>",
    "    <IdleSettings>",
    "      <StopOnIdleEnd>false</StopOnIdleEnd>",
    "      <RestartOnIdle>false</RestartOnIdle>",
    "    </IdleSettings>",
    "    <AllowStartOnDemand>true</AllowStartOnDemand>",
    "    <Enabled>true</Enabled>",
    "    <Hidden>true</Hidden>",
    "    <RunOnlyIfIdle>false</RunOnlyIfIdle>",
    "    <WakeToRun>false</WakeToRun>",
    "    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>",
    "    <Priority>7</Priority>",
    "    <RestartOnFailure>",
    "      <Interval>PT1M</Interval>",
    "      <Count>999</Count>",
    "    </RestartOnFailure>",
    "  </Settings>",
    '  <Actions Context="Author">',
    "    <Exec>",
    "      <Command>conhost.exe</Command>",
    "      <Arguments>" + xmlEscape(argLine) + "</Arguments>",
    "    </Exec>",
    "  </Actions>",
    "</Task>",
    ""
  ].join("\n");
}

/** A label is a file name and a service name: letters, digits, dot, dash, underscore. */
function checkedLabel(label) {
  var text = String(label || "");
  if (!/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(text)) throw new Error("not a login item label: " + JSON.stringify(text));
  return text;
}

/**
 * Everything about one login item, computed and not yet written: its file,
 * the file's contents, and the service-manager commands for it.
 *
 * @param {{system: string, home: string, label?: string, node: string,
 *          entry: string, port: number, stateDir: string, uid?: number,
 *          user?: string, configHome?: string, now?: Date}} spec
 * @returns {{system: string, label: string, path: string, contents: string,
 *            load: string[][], start: string[][], unload: string[][]}}
 */
function describe(spec) {
  var label = checkedLabel(spec.label || LABEL);
  var args = helperArgs(spec);
  if (spec.system === "macos") {
    var domain = "gui/" + spec.uid;
    var plistPath = path.join(spec.home, "Library", "LaunchAgents", label + ".plist");
    return {
      system: "macos",
      label: label,
      path: plistPath,
      contents: plist(label, args, path.join(spec.stateDir, LOG_FILE)),
      load: [["launchctl", "bootstrap", domain, plistPath]],
      start: startCommands({ system: "macos", label: label, uid: spec.uid }),
      unload: [["launchctl", "bootout", domain + "/" + label]]
    };
  }
  if (spec.system === "linux") {
    var unit = label + ".service";
    var configHome = spec.configHome || path.join(spec.home, ".config");
    return {
      system: "linux",
      label: label,
      path: path.join(configHome, "systemd", "user", unit),
      contents: systemdUnit(args),
      load: [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "--now", unit]],
      start: startCommands({ system: "linux", label: label }),
      unload: [["systemctl", "--user", "disable", "--now", unit]]
    };
  }
  if (spec.system === "windows") {
    // Windows paths cannot hold a quote, so one here is not a path: refuse it
    // rather than trust the quoting with it (security review SR12).
    args.forEach(function (arg) {
      if (String(arg).indexOf('"') !== -1) throw new Error("refusing a path with a quote character: " + arg);
    });
    var xmlPath = path.join(spec.stateDir, WINDOWS_XML_FILE);
    // Local time, no zone: the form Task Scheduler writes itself.
    var at = (spec.now || new Date());
    var pad = function (n) { return String(n).padStart(2, "0"); };
    var boundary = at.getFullYear() + "-" + pad(at.getMonth() + 1) + "-" + pad(at.getDate()) + "T" +
      pad(at.getHours()) + ":" + pad(at.getMinutes()) + ":" + pad(at.getSeconds());
    return {
      system: "windows",
      label: label,
      path: xmlPath,
      contents: taskXml(spec.user, args, boundary),
      load: [["schtasks", "/Create", "/TN", label, "/XML", xmlPath, "/F"], ["schtasks", "/Run", "/TN", label]],
      start: startCommands({ system: "windows", label: label }),
      // /End stops the task's own process; the CLI then stops the verified
      // helper by its pid, because ending conhost need not end node.
      unload: [["schtasks", "/End", "/TN", label], ["schtasks", "/Delete", "/TN", label, "/F"]]
    };
  }
  throw new Error("no login item for system " + JSON.stringify(spec.system));
}

/**
 * The commands that ask an installed login item to start the helper. Built
 * from the record's system and label, never read from the record as commands.
 *
 * @param {{system: string, label: string, uid?: number}} record
 */
function startCommands(record) {
  var label = checkedLabel(record.label);
  if (record.system === "macos") {
    var uid = typeof record.uid === "number" ? record.uid : process.getuid();
    return [["launchctl", "kickstart", "gui/" + uid + "/" + label]];
  }
  if (record.system === "linux") return [["systemctl", "--user", "start", label + ".service"]];
  if (record.system === "windows") return [["schtasks", "/Run", "/TN", label]];
  throw new Error("install.json names no system this clone knows: " + JSON.stringify(record.system));
}

/** Write the item's file. Windows wants its task XML in UTF-16 with a BOM. */
function writeItem(item) {
  fs.mkdirSync(path.dirname(item.path), { recursive: true });
  var bytes = item.system === "windows" ? Buffer.from("\ufeff" + item.contents, "utf16le") : item.contents;
  fs.writeFileSync(item.path, bytes, { mode: 0o644 });
}

/**
 * Run service-manager commands in order, as argument arrays (no shell).
 *
 * @param {string[][]} commands
 * @param {function(string, string[]): {status: number, output: string}} [runner]
 * @returns {Promise<{ok: boolean, failed: string|null}>} `failed` names the
 *   first command that failed and what it printed
 */
async function runCommands(commands, runner) {
  var run = runner || defaultRunner;
  for (var i = 0; i < commands.length; i += 1) {
    var result = await run(commands[i][0], commands[i].slice(1));
    if (!result || result.status !== 0) {
      return {
        ok: false,
        failed: commands[i].join(" ") + " exited " + (result ? result.status : "?") +
          (result && result.output ? ": " + String(result.output).trim().slice(0, 400) : "")
      };
    }
  }
  return { ok: true, failed: null };
}

function defaultRunner(command, args) {
  var result = childProcess.spawnSync(command, args, { encoding: "utf8", windowsHide: true, timeout: 30000 });
  if (result.error) return { status: -1, output: result.error.message };
  return { status: result.status, output: (result.stdout || "") + (result.stderr || "") };
}

// launchd will not start a job again within ten seconds of its last start, so
// a restart soon after a start waits out that throttle.
var START_WAIT_MS = 20000;

/**
 * Ask the installed login item to start the helper, and wait for it to answer.
 * The CLI never spawns its own helper when installed: a second copy would hold
 * the port, and the service manager's own restart would then loop on it.
 *
 * @param {object} record install.json
 * @param {function(): Promise<boolean>} isUp whether the helper answers
 * @param {{runner?: function, waitMs?: number}} [options]
 */
async function startThroughItem(record, isUp, options) {
  var opts = options || {};
  var waitMs = typeof opts.waitMs === "number" ? opts.waitMs : START_WAIT_MS;
  var ran = await runCommands(startCommands(record), opts.runner);
  var deadline = Date.now() + waitMs;
  for (;;) {
    if (await isUp()) return;
    if (Date.now() >= deadline) break;
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  var reason = reinstallReason(record);
  throw new Error(
    "the login item " + record.label + " did not start the helper on 127.0.0.1:" + record.port +
      " within " + Math.round(waitMs / 1000) + " seconds" +
      (ran.failed ? " (" + ran.failed + ")" : "") +
      (reason ? "; " + reason : "") +
      (record.state_dir ? ". Its log is " + path.join(record.state_dir, LOG_FILE) : "") +
      ". `lahe uninstall` goes back to starting the helper on demand."
  );
}

// ---------------------------------------------------------------------------
// install.json
// ---------------------------------------------------------------------------

function installPath(dir) {
  return path.join(dir, INSTALL_FILE);
}

/** The install record, or null when this state folder has none. */
function readInstall(dir) {
  try {
    var parsed = JSON.parse(fs.readFileSync(installPath(dir), "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (err) {
    return null;
  }
}

function writeInstall(dir, record) {
  fs.mkdirSync(dir, { recursive: true });
  var target = installPath(dir);
  var temp = target + ".tmp-" + process.pid;
  fs.writeFileSync(temp, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  fs.renameSync(temp, target);
}

/** The record when this state folder is installed for this port, else null. */
function installedFor(dir, port) {
  var record = readInstall(dir);
  return record && record.port === port ? record : null;
}

/**
 * Why the login item cannot start the helper any more, as a sentence, or null.
 * The item names the Node that ran the install and the clone it ran from, so
 * removing either one means installing again.
 */
function reinstallReason(record) {
  if (!record) return null;
  if (record.node && !fs.existsSync(record.node)) {
    return "the Node at " + record.node + " is gone; run `lahe install` again";
  }
  if (record.clone && !fs.existsSync(record.clone)) {
    return "the clone at " + record.clone + " is gone; run `lahe install` again from the clone you use";
  }
  return null;
}

/**
 * The code an installed helper runs: the clone the login item names. A CLI in
 * another clone (a worktree, say) must judge staleness by that clone, or it
 * would bounce the helper on every command and the restart would still run
 * the old code.
 */
function sourceRoots(record) {
  return [path.join(record.clone, "src"), path.join(record.clone, "vendor")];
}

// ---------------------------------------------------------------------------
// A quiet moment
// ---------------------------------------------------------------------------
//
// An always-on helper that is older than its code is replaced even with review
// windows open: the address and the port do not change, and the layer already
// rides out a helper restart (test/browser/helper_restart_holds.spec.js). It
// waits for a moment when no review is being written to, so a comment is not
// in flight while the helper goes. A comment that is still lands anyway, from
// the page's outbox on reconnect; the wait only makes that rare.

var QUIET_MS = 2000;
var QUIET_MAX_MS = 10000;

function newestReviewWriteMs(dir) {
  var root = path.join(dir, "reviews");
  var names;
  try { names = fs.readdirSync(root); } catch (err) { return null; }
  var newest = null;
  names.forEach(function (name) {
    try {
      var at = fs.statSync(path.join(root, name, "events.jsonl")).mtimeMs;
      if (newest === null || at > newest) newest = at;
    } catch (err) { /* a review with no log yet */ }
  });
  return newest;
}

/**
 * Wait until no review's log has been written for `quietMs`, for at most
 * `maxMs`. True when the moment came.
 *
 * @param {string} dir the state folder
 * @param {{quietMs?: number, maxMs?: number}} [options]
 * @returns {Promise<boolean>}
 */
async function waitForQuiet(dir, options) {
  var opts = options || {};
  var quietMs = typeof opts.quietMs === "number" ? opts.quietMs : QUIET_MS;
  var maxMs = typeof opts.maxMs === "number" ? opts.maxMs : QUIET_MAX_MS;
  var deadline = Date.now() + maxMs;
  for (;;) {
    var newest = newestReviewWriteMs(dir);
    if (newest === null || Date.now() - newest >= quietMs) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
}

module.exports = {
  QUIET_MS: QUIET_MS,
  QUIET_MAX_MS: QUIET_MAX_MS,
  LABEL: LABEL,
  INSTALL_FILE: INSTALL_FILE,
  LOG_FILE: LOG_FILE,
  systemFor: systemFor,
  helperArgs: helperArgs,
  windowsQuote: windowsQuote,
  systemdQuote: systemdQuote,
  describe: describe,
  startCommands: startCommands,
  startThroughItem: startThroughItem,
  sourceRoots: sourceRoots,
  waitForQuiet: waitForQuiet,
  writeItem: writeItem,
  runCommands: runCommands,
  defaultRunner: defaultRunner,
  installPath: installPath,
  readInstall: readInstall,
  writeInstall: writeInstall,
  installedFor: installedFor,
  reinstallReason: reinstallReason
};
