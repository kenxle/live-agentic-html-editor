// `lahe install` and `lahe uninstall`: the helper starts at login and
// restarts if it stops (stable addresses, brief requirement 7).
//
//   lahe install   [--port <n>] [--state-dir <path>]
//   lahe uninstall [--port <n>] [--state-dir <path>]
//
// WITHOUT THE INSTALL NOTHING CHANGES. A clone keeps starting the helper on
// demand, and the helper keeps stopping itself when quiet. The install is the
// switch: it writes the login item (src/service/login_item.js), records
// install.json in the state folder, and from then on the CLI asks the login
// item for a helper instead of spawning one.
//
// A PERSON RUNS IT, NOT AN AGENT. Both commands refuse without a terminal, so
// an agent asks the human to type `! lahe install`. Both refuse to run as
// root: a login item belongs to one user, and a root-owned state folder would
// lock that user out of it.
//
// MORE THAN ONE ACCOUNT. An always-on helper can be reached by other accounts
// on the same computer (architecture, "Always-on exposure"). Install warns when
// there is more than one, and goes on.
//
// Node-only. Service-manager commands run as argument arrays, never a shell.

"use strict";

var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var childProcess = require("node:child_process");
var net = require("node:net");

var protocol = require("../../shared/protocol.js");
var stateDirModule = require("../../service/state_dir.js");
var service = require("../../service/index.js");
var loginItem = require("../../service/login_item.js");
var selfStop = require("../../service/self_stop.js");
var sessionCommand = require("./session.js");

var CLONE = path.join(__dirname, "..", "..", "..");
var ENTRY = path.join(CLONE, "bin", "lahe.js");

var USAGE = [
  "usage: lahe install [--port-80] [--lahe-names] [--port <n>] [--state-dir <path>]",
  "       lahe uninstall [--port <n>] [--state-dir <path>]",
  "",
  "  install    start the helper at login and restart it if it stops, so a document's address",
  "             keeps working after a session closes, after idle time, and after a reboot.",
  "             Run it yourself in a terminal; an agent asks you to type `! lahe install`.",
  "  uninstall  remove that. `lahe review` goes back to starting the helper on demand.",
  "",
  "  --port-80     macOS: forward this computer's own port 80 to the pages port, so addresses",
  "                print without :" + protocol.PAGES.PORT + ". One admin password. Skipped when something holds port 80.",
  "  --lahe-names  macOS: let every page also answer at <name>.lahe. One admin password.",
  "                On Linux and Windows these record a step you do by hand (docs/INSTALL.md), and the",
  "                helper checks it. .lahe is not available on Windows yet.",
  "                A later `lahe install` keeps whichever of these is already set up.",
  "",
  "  --port       the helper's port. Default " + protocol.DEFAULT_PORT + ".",
  "  --state-dir  the state folder the login item pins. Default $LAHE_STATE_DIR, then",
  "               $XDG_STATE_HOME/lahe, then ~/.local/state/lahe."
].join("\n");

function parse(argv) {
  var list = argv || [];
  var out = { port: protocol.DEFAULT_PORT, stateDir: null };
  for (var i = 0; i < list.length; i += 1) {
    if (list[i] === "--help" || list[i] === "-h") return { help: true };
    if (list[i] === "--port" && list[i + 1] !== undefined) {
      out.port = Number(list[(i += 1)]);
      if (!Number.isInteger(out.port) || out.port < 1 || out.port > 65535) return { error: "--port takes a port number" };
    } else if (list[i] === "--state-dir" && list[i + 1] !== undefined) {
      out.stateDir = list[(i += 1)];
    } else if (list[i] === "--port-80") {
      out.port80 = true;
    } else if (list[i] === "--lahe-names") {
      out.laheNames = true;
    } else {
      return { error: "unknown or incomplete option " + JSON.stringify(list[i]) };
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Who else has an account here
// ---------------------------------------------------------------------------

var interactiveUsers = {
  /** `dscl . -list /Users UniqueID`: real accounts start at 501; _names are system. */
  fromDscl: function (text) {
    return String(text).split("\n").map(function (line) { return line.trim().split(/\s+/); })
      .filter(function (parts) { return parts.length === 2 && parts[0][0] !== "_" && Number(parts[1]) >= 501; })
      .map(function (parts) { return parts[0]; });
  },
  /** /etc/passwd: uid 1000 up to nobody, with a login shell. */
  fromPasswd: function (text) {
    return String(text).split("\n").map(function (line) { return line.split(":"); })
      .filter(function (f) {
        var uid = Number(f[2]);
        return f.length >= 7 && uid >= 1000 && uid < 65534 && !/(nologin|false)$/.test(f[6]);
      })
      .map(function (f) { return f[0]; });
  },
  /** C:\Users: one folder per account, less the shared ones. */
  fromUsersFolder: function (names) {
    var shared = ["Public", "Default", "Default User", "All Users", "desktop.ini"];
    return names.filter(function (name) { return shared.indexOf(name) === -1; });
  }
};

function defaultUsers(platform) {
  try {
    if (platform === "darwin") {
      return interactiveUsers.fromDscl(childProcess.execFileSync("dscl", [".", "-list", "/Users", "UniqueID"], { encoding: "utf8" }));
    }
    if (platform === "linux") return interactiveUsers.fromPasswd(fs.readFileSync("/etc/passwd", "utf8"));
    if (platform === "win32") {
      return interactiveUsers.fromUsersFolder(fs.readdirSync(path.join(process.env.SystemDrive || "C:", "\\Users")));
    }
  } catch (err) {
    /* cannot tell: no warning, rather than a wrong one */
  }
  return [];
}

// ---------------------------------------------------------------------------
// The shared start of both commands
// ---------------------------------------------------------------------------

function environment(argv, given, name) {
  var d = given || {};
  var env = {
    out: d.stdout || function (text) { process.stdout.write(text); },
    err: d.stderr || function (text) { process.stderr.write(text); },
    isTTY: d.isTTY !== undefined ? d.isTTY : !!(process.stdin.isTTY && process.stdout.isTTY),
    uid: d.uid !== undefined ? d.uid : typeof process.getuid === "function" ? process.getuid() : null,
    platform: d.platform || process.platform,
    home: d.home || os.homedir(),
    node: d.node || process.execPath,
    runner: d.runner,
    users: d.users,
    waitMs: d.waitMs,
    portHolder: d.portHolder || defaultPortHolder,
    // The name server's port in install.json. Tests pass a free one.
    nameServerPort: typeof d.nameServerPort === "number" ? d.nameServerPort : loginItem.NAME_SERVER_PORT,
    rootPaths: d.rootPaths || {
      resolver: loginItem.RESOLVER_PATH,
      rule: loginItem.FORWARD_RULE_PATH,
      daemon: loginItem.FORWARD_DAEMON_PATH
    }
  };
  var args = parse(argv);
  if (args.help) {
    env.out(USAGE + "\n");
    return { done: protocol.CLI_EXIT.OK };
  }
  if (args.error) {
    env.err("lahe " + name + ": " + args.error + "\n\n" + USAGE + "\n");
    return { done: protocol.CLI_EXIT.BAD_USAGE };
  }
  if (!env.isTTY) {
    env.err(
      "lahe " + name + " needs a terminal: it changes what starts when you log in, so a person runs it.\n" +
        "An agent asks the human to type `! lahe " + name + "`.\n"
    );
    return { done: 1 };
  }
  if (env.uid === 0) {
    env.err("lahe " + name + ": refusing to run as root. Run it as the account that uses Lahe.\n");
    return { done: 1 };
  }
  env.system = loginItem.systemFor(env.platform);
  if (!env.system) {
    env.err("lahe " + name + ": there is no login item for " + env.platform + ". `lahe review` starts the helper on demand.\n");
    return { done: 1 };
  }
  try {
    env.dir = args.stateDir ? stateDirModule.stateDir({ dir: args.stateDir }) : stateDirModule.stateDir();
  } catch (error) {
    env.err("lahe " + name + ": " + error.message + "\n");
    return { done: 1 };
  }
  env.port = args.port;
  env.port80 = args.port80 === true;
  env.laheNames = args.laheNames === true;
  if (env.laheNames && env.system === "windows") {
    env.err(
      "lahe " + name + ": .lahe is not available on Windows yet. Windows sends a name ending to a name server\n" +
        "  only on port 53, and Lahe's name server answers on port " + loginItem.NAME_SERVER_PORT + ". Nothing was changed.\n" +
        "  <name>.lahe.localhost addresses work on Windows with no setup.\n"
    );
    return { done: 1 };
  }
  // The label an earlier install recorded, so a reinstall or an uninstall
  // finds the same item.
  env.record = loginItem.readInstall(env.dir);
  var label = env.record && env.record.system === env.system ? env.record.label : undefined;
  try {
    env.item = describeItem(env, label);
  } catch (error) {
    env.err("lahe " + name + ": " + error.message + "\n");
    return { done: 1 };
  }
  return { env: env };
}

function describeItem(env, label) {
  return loginItem.describe({
    system: env.system,
    label: label,
    home: env.home,
    uid: env.uid,
    user: (process.env.USERDOMAIN ? process.env.USERDOMAIN + "\\" : "") + (process.env.USERNAME || os.userInfo().username),
    configHome: process.env.XDG_CONFIG_HOME || null,
    node: env.node,
    entry: ENTRY,
    port: env.port,
    stateDir: env.dir
  });
}

/** Stop the helper on the port if it is this folder's; false when it is not ours. */
async function stopOurHelper(env) {
  var live = await service.probeHealth(protocol.DEFAULT_HOST, env.port);
  if (!live) return true;
  if (selfStop.stateFolderMismatch(env.dir, live)) return false;
  return sessionCommand.stopVerifiedHelper(env.dir);
}

function readyNames(dir, live) {
  try {
    var ready = JSON.parse(fs.readFileSync(stateDirModule.readyPath(dir), "utf8"));
    return typeof ready.pid === "number" && ready.started_at === live.started_at;
  } catch (err) {
    return false;
  }
}

async function waitForInstalledHelper(env) {
  var deadline = Date.now() + (typeof env.waitMs === "number" ? env.waitMs : 20000);
  for (;;) {
    var live = await service.probeHealth(protocol.DEFAULT_HOST, env.port);
    // Up, and done starting: service.json names this same helper, so a later
    // command can stop it by its pid.
    if (live && live.always_on === true && !selfStop.stateFolderMismatch(env.dir, live) && readyNames(env.dir, live)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
}

function removeFile(file) {
  try { fs.unlinkSync(file); } catch (err) { if (err.code !== "ENOENT") throw err; }
}

/** Unload the login item and remove its file. Failures to unload are said, not fatal. */
async function removeItem(env, item) {
  var unloaded = await loginItem.runCommands(item.unload, env.runner);
  removeFile(item.path);
  if (env.system === "linux") await loginItem.runCommands([["systemctl", "--user", "daemon-reload"]], env.runner);
  return unloaded;
}

// ---------------------------------------------------------------------------
// The macOS admin steps: --port-80 and --lahe-names
// ---------------------------------------------------------------------------

/** "<command> (pid N)" for whatever listens on loopback port 80, or null. */
function defaultPortHolder() {
  return new Promise(function (resolve) {
    var socket = net.connect({ host: "127.0.0.1", port: 80 });
    socket.setTimeout(1000);
    socket.once("connect", function () {
      socket.destroy();
      var name = "a program";
      try {
        var out = childProcess.execFileSync("lsof", ["-nP", "-iTCP:80", "-sTCP:LISTEN", "-Fpc"], { encoding: "utf8" });
        var pid = /^p(\d+)$/m.exec(out);
        var command = /^c(.+)$/m.exec(out);
        if (command) name = command[1] + (pid ? " (pid " + pid[1] + ")" : "");
      } catch (err) { /* another account's program: lsof cannot name it */ }
      resolve(name);
    });
    socket.once("error", function () { resolve(null); });
    socket.once("timeout", function () { socket.destroy(); resolve(null); });
  });
}

/** Write the step's files into a fresh private folder, and run its one sudo call. */
async function rootStep(env, script, files) {
  var folder = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-root-"));
  Object.keys(files).forEach(function (name) {
    fs.writeFileSync(path.join(folder, name), files[name], { mode: 0o644 });
  });
  env.out("lahe install: your admin password sets this up (one sudo call).\n");
  return loginItem.runCommands([loginItem.rootCommand(script, folder)], env.runner);
}

/**
 * The two options, as install.json records them. A flag runs its step; with
 * no flag, what an earlier install set up is kept as it was.
 */
async function adminSteps(env) {
  var before = env.record || {};
  var out = {
    port_80: before.port_80 === true,
    forward_rule: before.port_80 === true ? before.forward_rule || loginItem.FORWARD_RULE_PATH : null,
    port_80_reason: before.port_80_reason || null,
    lahe_names: before.lahe_names === true,
    resolver: before.lahe_names === true ? before.resolver || loginItem.RESOLVER_PATH : null,
    name_server_port: before.lahe_names === true ? before.name_server_port || env.nameServerPort : null
  };
  if (env.port80) {
    // With Lahe's own forward in place, port 80 answers because it reaches the
    // helper; that is not another program holding it.
    var holder = before.port_80 === true ? null : await env.portHolder();
    if (holder) {
      out.port_80 = false;
      out.forward_rule = null;
      out.port_80_reason = "port 80 is held by " + holder;
      env.out(
        "lahe install: port-free addresses skipped: " + out.port_80_reason + ". Addresses keep :" + protocol.PAGES.PORT + ".\n"
      );
    } else {
      var files = {};
      files[loginItem.ROOT_FILES.rule] = loginItem.forwardRuleText(protocol.PAGES.PORT);
      files[loginItem.ROOT_FILES.daemon] = loginItem.forwardDaemonText();
      var forward = await rootStep(env, "installForward", files);
      out.port_80 = forward.ok;
      out.forward_rule = forward.ok ? loginItem.FORWARD_RULE_PATH : null;
      out.port_80_reason = forward.ok ? null : "the admin step failed";
      if (forward.ok) env.out("lahe install: port 80 forwards to " + protocol.PAGES.PORT + " on this computer, reloaded at boot.\n");
      else env.err("lahe install: port-free addresses were not set up (" + forward.failed + ").\n");
    }
  }
  if (env.laheNames) {
    var names = {};
    names[loginItem.ROOT_FILES.resolver] = loginItem.resolverText(env.nameServerPort);
    var resolver = await rootStep(env, "installResolver", names);
    out.lahe_names = resolver.ok;
    out.resolver = resolver.ok ? loginItem.RESOLVER_PATH : null;
    out.name_server_port = resolver.ok ? env.nameServerPort : null;
    if (resolver.ok) env.out("lahe install: .lahe lookups on this Mac go to the helper's name server.\n");
    else env.err("lahe install: .lahe was not set up (" + resolver.failed + ").\n");
  }
  return out;
}

/**
 * Linux and Windows: the options are steps a person does by hand
 * (docs/INSTALL.md). Install records them, so the helper starts its name
 * server and runs the same checks it runs on macOS, and runs no sudo itself.
 * A step not done yet simply fails the check, and addresses keep :1483 and
 * .lahe.localhost.
 */
function handSteps(env) {
  var before = env.record || {};
  var port80 = env.port80 || before.port_80 === true;
  var names = env.laheNames || before.lahe_names === true;
  if (env.port80 || env.laheNames) {
    env.out(
      "lahe install: on " + (env.system === "linux" ? "Linux" : "Windows") + " " +
        [env.port80 ? "the port 80 forward" : null, env.laheNames ? ".lahe" : null].filter(Boolean).join(" and ") +
        " is set up by hand: follow docs/INSTALL.md. The helper checks it at start and every five minutes,\n" +
        "  and uses it only once the check passes.\n"
    );
  }
  return {
    by_hand: port80 || names,
    port_80: port80,
    forward_rule: null,
    port_80_reason: null,
    lahe_names: names,
    resolver: names ? loginItem.LINUX_RESOLVER_PATH : null,
    name_server_port: names ? env.nameServerPort : null
  };
}

function readOrNull(file) {
  try { return fs.readFileSync(file, "utf8"); } catch (err) { return null; }
}

/** Remove the admin steps' files that carry Lahe's marker; say which were left. */
async function removeAdminSteps(env) {
  var p = env.rootPaths;
  var resolver = readOrNull(p.resolver);
  var forwardFiles = [p.rule, p.daemon].map(function (file) { return { file: file, text: readOrNull(file) }; });
  var leftAlone = [{ file: p.resolver, text: resolver }].concat(forwardFiles).filter(function (f) {
    return f.text !== null && !loginItem.hasMarker(f.text);
  });
  var steps = [];
  if (resolver !== null && loginItem.hasMarker(resolver)) steps.push("removeResolver");
  if (forwardFiles.some(function (f) { return f.text !== null && loginItem.hasMarker(f.text); })) steps.push("removeForward");
  leftAlone.forEach(function (f) {
    env.out("lahe uninstall: " + f.file + " was not written by Lahe; left alone.\n");
  });
  for (var i = 0; i < steps.length; i += 1) {
    env.out("lahe uninstall: your admin password removes Lahe's " + (steps[i] === "removeResolver" ? ".lahe setup" : "port 80 forward") + ".\n");
    var done = await loginItem.runCommands([loginItem.rootCommand(steps[i])], env.runner);
    if (!done.ok) env.err("lahe uninstall: that admin step failed (" + done.failed + ").\n");
  }
  if (steps.length > 0) env.out("  .lahe.localhost addresses keep working whenever the helper runs.\n");
}

// ---------------------------------------------------------------------------
// lahe install
// ---------------------------------------------------------------------------

async function run(argv, deps) {
  var start = environment(argv, deps, "install");
  if (start.done !== undefined) return start.done;
  var env = start.env;
  var item = env.item;

  if (env.system === "linux") {
    var bus = await loginItem.runCommands([["systemctl", "--user", "show-environment"]], env.runner);
    if (!bus.ok) {
      env.err(
        "lahe install: this machine has no user systemd to start the helper at login (" + bus.failed + ").\n" +
          "Nothing was installed. `lahe review` starts the helper on demand, as before.\n"
      );
      return 1;
    }
  }

  var users = (env.users || defaultUsers)(env.platform);
  if (users.length > 1) {
    env.out(
      "lahe install: note, " + users.length + " people have accounts on this computer. With the helper always on,\n" +
        "  other accounts can reach its pages on this computer. Websites cannot.\n"
    );
  }

  // Again on purpose: replace the item rather than add a second one.
  if (env.record || fs.existsSync(item.path)) await removeItem(env, item);
  try {
    if (!(await stopOurHelper(env))) {
      env.err(
        "lahe install: something on " + protocol.DEFAULT_HOST + ":" + env.port +
          " is not this state folder's helper. Stop it, or install with --port <n>.\n"
      );
      return 1;
    }
  } catch (error) {
    env.err("lahe install: " + error.message + "\n");
    return 1;
  }

  // The admin steps before the login item loads, so the helper it starts
  // already finds them in install.json.
  var admin = env.system === "macos" ? await adminSteps(env) : handSteps(env);

  var record = {
    system: env.system,
    label: item.label,
    login_item: item.path,
    node: env.node,
    clone: CLONE,
    entry: ENTRY,
    port: env.port,
    state_dir: env.dir,
    pages_port: protocol.PAGES.PORT,
    lahe_names: admin ? admin.lahe_names : false,
    resolver: admin ? admin.resolver : null,
    name_server_port: admin ? admin.name_server_port : null,
    port_80: admin ? admin.port_80 : false,
    forward_rule: admin ? admin.forward_rule : null,
    port_80_reason: admin ? admin.port_80_reason : null,
    by_hand: admin ? admin.by_hand === true : false,
    installed_at: new Date().toISOString()
  };
  // install.json first: the helper reads it as it starts, to say in
  // service.json that a login item runs it.
  loginItem.writeInstall(env.dir, record);
  loginItem.writeItem(item);
  var loaded = await loginItem.runCommands(item.load, env.runner);
  var up = loaded.ok && (await waitForInstalledHelper(env));
  if (!up) {
    await removeItem(env, item);
    removeFile(loginItem.installPath(env.dir));
    env.err(
      "lahe install: the login item did not start the helper" +
        (loaded.failed ? " (" + loaded.failed + ")" : "") +
        ". Its log is " + path.join(env.dir, loginItem.LOG_FILE) + ".\n" +
        "Nothing is left installed. `lahe review` starts the helper on demand, as before.\n"
    );
    return 1;
  }

  env.out(
    [
      "lahe install: the helper now starts at login and restarts if it stops.",
      "  login item  " + item.path,
      "  node        " + env.node,
      "  clone       " + CLONE,
      "  port        " + env.port,
      "  state       " + env.dir,
      "  The login item runs this Node and this clone. If either moves or is removed, run `lahe install` again.",
      "  Remove it with `lahe uninstall`.",
      ""
    ].join("\n")
  );
  return protocol.CLI_EXIT.OK;
}

// ---------------------------------------------------------------------------
// lahe uninstall
// ---------------------------------------------------------------------------

async function runUninstall(argv, deps) {
  var start = environment(argv, deps, "uninstall");
  if (start.done !== undefined) return start.done;
  var env = start.env;
  var record = env.record;
  var item = env.item;

  if (env.system === "macos") await removeAdminSteps(env);
  if (record && record.by_hand) {
    var undo = [record.port_80 ? "the port 80 forward" : null, record.lahe_names ? "the .lahe setup" : null].filter(Boolean);
    if (undo.length) env.out("lahe uninstall: undo " + undo.join(" and ") + " by hand, as docs/INSTALL.md describes.\n");
  }
  if (!record && !fs.existsSync(item.path)) {
    env.out("lahe uninstall: nothing to uninstall for " + env.dir + ".\n");
    return protocol.CLI_EXIT.OK;
  }
  var unloaded = await removeItem(env, item);
  try {
    // Ending the task need not end node on Windows; stop it by its verified pid.
    await stopOurHelper(env);
  } catch (error) {
    env.err("lahe uninstall: " + error.message + "\n");
  }
  removeFile(loginItem.installPath(env.dir));
  env.out(
    "lahe uninstall: the helper no longer starts at login. `lahe review` starts it on demand, as before.\n" +
      (unloaded.ok ? "" : "  (the service manager said: " + unloaded.failed + ")\n")
  );
  return protocol.CLI_EXIT.OK;
}

module.exports = {
  USAGE: USAGE,
  interactiveUsers: interactiveUsers,
  run: run,
  uninstall: { run: runUninstall }
};
