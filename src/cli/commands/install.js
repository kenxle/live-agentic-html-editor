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

var protocol = require("../../shared/protocol.js");
var stateDirModule = require("../../service/state_dir.js");
var service = require("../../service/index.js");
var loginItem = require("../../service/login_item.js");
var selfStop = require("../../service/self_stop.js");
var sessionCommand = require("./session.js");

var CLONE = path.join(__dirname, "..", "..", "..");
var ENTRY = path.join(CLONE, "bin", "lahe.js");

var USAGE = [
  "usage: lahe install [--port <n>] [--state-dir <path>]",
  "       lahe uninstall [--port <n>] [--state-dir <path>]",
  "",
  "  install    start the helper at login and restart it if it stops, so a document's address",
  "             keeps working after a session closes, after idle time, and after a reboot.",
  "             Run it yourself in a terminal; an agent asks you to type `! lahe install`.",
  "  uninstall  remove that. `lahe review` goes back to starting the helper on demand.",
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
    waitMs: d.waitMs
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

async function waitForInstalledHelper(env) {
  var deadline = Date.now() + (typeof env.waitMs === "number" ? env.waitMs : 20000);
  for (;;) {
    var live = await service.probeHealth(protocol.DEFAULT_HOST, env.port);
    if (live && live.always_on === true && !selfStop.stateFolderMismatch(env.dir, live)) return true;
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

  var record = {
    system: env.system,
    label: item.label,
    login_item: item.path,
    node: env.node,
    clone: CLONE,
    entry: ENTRY,
    port: env.port,
    state_dir: env.dir,
    lahe_names: false,
    resolver: null,
    port_80: false,
    forward_rule: null,
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
