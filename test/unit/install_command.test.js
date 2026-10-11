// `lahe install` and `lahe uninstall` (src/cli/commands/install.js).
//
//   V48  No terminal, or running as root: refused. More than one user on the
//        machine: warned. The login item carries the port and the state folder.
//   V72  A reinstall replaces the item; uninstall removes it and install.json.
//
// No real login item is registered. The home folder is a temp folder, so the
// item's file lands there, and the service manager is a runner the test plays:
// a load or start command starts a detached `bin/lahe.js serve --always-on`
// the way launchd would, and an unload stops it. Every helper is stopped in
// teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");
const stateDir = require("../../src/service/state_dir.js");
const loginItem = require("../../src/service/login_item.js");
const installCommand = require("../../src/cli/commands/install.js");
const { freePort } = require("../helpers/free_port.js");
const { pollUntil } = require("../helpers/poll.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");

function world(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-install-")));
  const home = path.join(root, "home dir");
  const dir = path.join(root, "state dir");
  fs.mkdirSync(home, { recursive: true });
  t.after(() => stopTempHelpers(dir));
  return { root, home, dir };
}

function readyPid(dir) {
  try { return JSON.parse(fs.readFileSync(stateDir.readyPath(dir), "utf8")).pid; } catch (err) { return null; }
}

/** The service manager, played by the test. */
function fakeManager(w, port) {
  const calls = [];
  const startWords = ["bootstrap", "kickstart", "enable", "start", "/Run"];
  const stopWords = ["bootout", "disable", "/End"];
  const runner = async (command, args) => {
    calls.push([command].concat(args));
    if (args.some((a) => stopWords.indexOf(a) !== -1)) {
      const pid = readyPid(w.dir);
      if (pid) {
        try { process.kill(pid, "SIGTERM"); } catch (err) { /* gone */ }
        await pollUntil(async () => !(await service.probeHealth(protocol.DEFAULT_HOST, port)), {
          timeoutMs: 10000,
          message: "the helper to stop on unload"
        });
      }
      return { status: 0, output: "" };
    }
    if (args.some((a) => startWords.indexOf(a) !== -1) && !(await service.probeHealth(protocol.DEFAULT_HOST, port))) {
      const child = childProcess.spawn(
        process.execPath,
        [BIN, "serve", "--always-on", "--port", String(port), "--state-dir", w.dir],
        { detached: true, stdio: "ignore" }
      );
      child.unref();
    }
    return { status: 0, output: "" };
  };
  return { runner, calls };
}

function deps(w, overrides) {
  const out = [];
  const err = [];
  const base = {
    stdout: (x) => out.push(x),
    stderr: (x) => err.push(x),
    isTTY: true,
    uid: 501,
    platform: "darwin",
    home: w.home,
    node: path.join(w.root, "node bin", "node"),
    users: () => ["jo"]
  };
  const d = Object.assign(base, overrides || {});
  d.out = () => out.join("");
  d.err = () => err.join("");
  return d;
}

test("V48: install refuses to run without a terminal, and tells an agent what to ask for", async (t) => {
  const w = world(t);
  const d = deps(w, { isTTY: false });
  const code = await installCommand.run(["--state-dir", w.dir], d);
  assert.notEqual(code, 0);
  assert.match(d.err(), /needs a terminal/);
  assert.match(d.err(), /! lahe install/);
  assert.equal(fs.existsSync(loginItem.installPath(w.dir)), false);
});

test("V48: install refuses to run as root", async (t) => {
  const w = world(t);
  const d = deps(w, { uid: 0 });
  const code = await installCommand.run(["--state-dir", w.dir], d);
  assert.notEqual(code, 0);
  assert.match(d.err(), /as root/);
});

test("V48 and V72: install writes a login item carrying the port and state folder, starts it, and records install.json", async (t) => {
  const w = world(t);
  const port = await freePort();
  const manager = fakeManager(w, port);
  const d = deps(w, { runner: manager.runner });
  const code = await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d);
  assert.equal(code, 0, d.err());

  const plistPath = path.join(w.home, "Library", "LaunchAgents", loginItem.LABEL + ".plist");
  const plist = fs.readFileSync(plistPath, "utf8");
  assert.match(plist, new RegExp("<string>" + port + "</string>"));
  assert.ok(plist.indexOf("<string>" + w.dir + "</string>") !== -1, "the state folder, spaces and all");
  assert.match(plist, /<string>--always-on<\/string>/);

  const record = loginItem.readInstall(w.dir);
  assert.equal(record.system, "macos");
  assert.equal(record.port, port);
  assert.equal(record.state_dir, w.dir);
  assert.equal(record.login_item, plistPath);
  assert.equal(record.lahe_names, false);
  assert.equal(record.port_80, false);

  assert.deepEqual(manager.calls[manager.calls.length - 1], ["launchctl", "bootstrap", "gui/501", plistPath]);
  const health = await service.probeHealth(protocol.DEFAULT_HOST, port);
  assert.equal(health.always_on, true, "the login item's helper answers");
  assert.match(d.out(), /starts at login/);
  assert.match(d.out(), /lahe uninstall/);
});

test("V48: more than one user on the machine is warned about, and install goes on", async (t) => {
  const w = world(t);
  const port = await freePort();
  const d = deps(w, { runner: fakeManager(w, port).runner, users: () => ["jo", "sam"] });
  const code = await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d);
  assert.equal(code, 0, d.err());
  assert.match(d.out() + d.err(), /2 people have accounts on this computer/);
  assert.match(d.out() + d.err(), /other accounts can reach/);
});

test("V72: installing again replaces the login item rather than adding a second", async (t) => {
  const w = world(t);
  const port = await freePort();
  const manager = fakeManager(w, port);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], deps(w, { runner: manager.runner })), 0);
  const firstPid = readyPid(w.dir);
  manager.calls.length = 0;
  const d = deps(w, { runner: manager.runner });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d), 0, d.err());
  assert.deepEqual(manager.calls[0], ["launchctl", "bootout", "gui/501/" + loginItem.LABEL], "the old item is unloaded first");
  assert.notEqual(readyPid(w.dir), firstPid);
  assert.equal(fs.readdirSync(path.join(w.home, "Library", "LaunchAgents")).length, 1);
});

test("install replaces a helper the CLI started on demand, so the login item can take the port", async (t) => {
  const w = world(t);
  const port = await freePort();
  const plain = childProcess.spawn(process.execPath, [BIN, "serve", "--port", String(port), "--state-dir", w.dir], {
    detached: true,
    stdio: "ignore"
  });
  plain.unref();
  await pollUntil(() => service.probeHealth(protocol.DEFAULT_HOST, port), { timeoutMs: 10000, message: "the plain helper" });
  const d = deps(w, { runner: fakeManager(w, port).runner });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d), 0, d.err());
  assert.equal((await service.probeHealth(protocol.DEFAULT_HOST, port)).always_on, true);
});

test("Linux without a user systemd: install says so, stays in clone mode, and writes nothing", async (t) => {
  const w = world(t);
  const port = await freePort();
  const calls = [];
  const d = deps(w, {
    platform: "linux",
    runner: (command, args) => {
      calls.push([command].concat(args));
      return { status: 1, output: "Failed to connect to bus" };
    }
  });
  const code = await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d);
  assert.notEqual(code, 0);
  assert.match(d.err(), /no user systemd/);
  assert.match(d.err(), /starts the helper on demand/);
  assert.deepEqual(calls, [["systemctl", "--user", "show-environment"]]);
  assert.equal(fs.existsSync(path.join(w.home, ".config", "systemd", "user", loginItem.LABEL + ".service")), false);
  assert.equal(fs.existsSync(loginItem.installPath(w.dir)), false);
});

test("V72: uninstall unloads the item, removes its file and install.json, and the helper is stopped", async (t) => {
  const w = world(t);
  const port = await freePort();
  const manager = fakeManager(w, port);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], deps(w, { runner: manager.runner })), 0);
  const plistPath = loginItem.readInstall(w.dir).login_item;
  const d = deps(w, { runner: manager.runner });
  const code = await installCommand.uninstall.run(["--state-dir", w.dir], d);
  assert.equal(code, 0, d.err());
  assert.equal(fs.existsSync(plistPath), false);
  assert.equal(fs.existsSync(loginItem.installPath(w.dir)), false);
  assert.equal(await service.probeHealth(protocol.DEFAULT_HOST, port), null);
  assert.match(d.out(), /no longer starts at login/);
});

test("uninstall with nothing installed says so and succeeds", async (t) => {
  const w = world(t);
  const d = deps(w, { runner: () => ({ status: 0, output: "" }) });
  assert.equal(await installCommand.uninstall.run(["--state-dir", w.dir], d), 0);
  assert.match(d.out(), /nothing to uninstall/);
});

test("the default user count reads interactive accounts only", () => {
  assert.deepEqual(
    installCommand.interactiveUsers.fromDscl("_www 70\njo 501\nsam 502\nnobody -2\nroot 0\n"),
    ["jo", "sam"]
  );
  assert.deepEqual(
    installCommand.interactiveUsers.fromPasswd(
      "root:x:0:0::/root:/bin/bash\njo:x:1000:1000::/home/jo:/bin/bash\nsvc:x:1001:1001::/:/usr/sbin/nologin\nnobody:x:65534:65534::/:/bin/false\n"
    ),
    ["jo"]
  );
  assert.deepEqual(
    installCommand.interactiveUsers.fromUsersFolder(["Public", "Default", "Default User", "All Users", "desktop.ini", "Jo", "Sam"]),
    ["Jo", "Sam"]
  );
});

test("lahe install and lahe uninstall are commands the dispatcher knows", () => {
  const cli = require("../../src/cli/index.js");
  assert.ok(cli.COMMAND_NAMES.indexOf("install") !== -1);
  assert.ok(cli.COMMAND_NAMES.indexOf("uninstall") !== -1);
  assert.equal(typeof cli.COMMANDS.uninstall().run, "function");
  assert.match(cli.USAGE, /^  install /m);
  assert.match(cli.USAGE, /^  uninstall /m);
});
