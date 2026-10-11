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
  var label = spec.label || LABEL;
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
      start: [["launchctl", "kickstart", domain + "/" + label]],
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
      start: [["systemctl", "--user", "start", unit]],
      unload: [["systemctl", "--user", "disable", "--now", unit]]
    };
  }
  if (spec.system === "windows") {
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
      start: [["schtasks", "/Run", "/TN", label]],
      // /End stops the task's own process; the CLI then stops the verified
      // helper by its pid, because ending conhost need not end node.
      unload: [["schtasks", "/End", "/TN", label], ["schtasks", "/Delete", "/TN", label, "/F"]]
    };
  }
  throw new Error("no login item for system " + JSON.stringify(spec.system));
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

module.exports = {
  LABEL: LABEL,
  INSTALL_FILE: INSTALL_FILE,
  LOG_FILE: LOG_FILE,
  systemFor: systemFor,
  helperArgs: helperArgs,
  windowsQuote: windowsQuote,
  systemdQuote: systemdQuote,
  describe: describe,
  writeItem: writeItem,
  runCommands: runCommands,
  defaultRunner: defaultRunner,
  installPath: installPath,
  readInstall: readInstall,
  writeInstall: writeInstall,
  installedFor: installedFor,
  reinstallReason: reinstallReason
};
