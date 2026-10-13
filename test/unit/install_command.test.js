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
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");
const stateDir = require("../../src/service/state_dir.js");
const loginItem = require("../../src/service/login_item.js");
const installCommand = require("../../src/cli/commands/install.js");
const menubar = require("../../src/service/menubar.js");
const { fakeMac, writeMenubarSources } = require("../helpers/fake_mac.js");
const { freePort } = require("../helpers/free_port.js");
const dgram = require("node:dgram");
const net = require("node:net");

function freeUdpPort() {
  return new Promise((resolve) => {
    const socket = dgram.createSocket("udp4");
    socket.bind(0, "127.0.0.1", () => {
      const port = socket.address().port;
      socket.close(() => resolve(port));
    });
  });
}
const { pollUntil } = require("../helpers/poll.js");
const { trackSpawned } = require("../helpers/spawned.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");
const MENUBAR_LABEL = "lahe-test-menubar-" + process.pid;

/**
 * A temp home and state folder, plus the test-owned listeners a helper's
 * address checks use instead of the real ones: a free UDP port for the name
 * server, and a TCP listener standing in for port 80. No helper in this file
 * binds 7853, sends a request to port 80, or asks the system resolver.
 */
async function world(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-install-")));
  const home = path.join(root, "home dir");
  const dir = path.join(root, "state dir");
  fs.mkdirSync(home, { recursive: true });
  // Every helper the fake service manager or a test starts is tracked by pid,
  // so teardown stops one that was still starting when the test ended.
  const spawned = trackSpawned(t, dir);
  const udp = await freeUdpPort();
  const port80 = { hits: 0 };
  const stand = net.createServer((socket) => { port80.hits += 1; socket.destroy(); });
  await new Promise((resolve) => stand.listen(0, "127.0.0.1", resolve));
  port80.port = stand.address().port;
  t.after(() => new Promise((resolve) => stand.close(() => resolve())));
  // What the helpers this file starts get in place of port 80 and the system
  // resolver.
  const helperEnv = {
    LAHE_FORWARD_CHECK_PORT: String(port80.port),
    LAHE_NAME_CHECK_SERVER: "127.0.0.1:" + udp
  };
  return { root, home, dir, spawned, udp, port80, helperEnv };
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
      w.spawned.spawn([BIN, "serve", "--always-on", "--port", String(port), "--state-dir", w.dir], w.helperEnv);
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
    users: () => ["jo"],
    // The menu bar question is never put to the terminal running the tests,
    // and the app's login item, if a test adds one, has a test label.
    canAsk: false,
    menubarLabel: MENUBAR_LABEL,
    arch: "arm64",
    nameServerPort: w.udp,
    // Never the real /etc files or the real port 80.
    portHolder: () => null,
    rootPaths: {
      resolver: path.join(w.root, "no-etc", "resolver-lahe"),
      rule: path.join(w.root, "no-etc", "pf-anchor-lahe"),
      daemon: path.join(w.root, "no-etc", "lahe-port80.plist")
    }
  };
  const d = Object.assign(base, overrides || {});
  d.out = () => out.join("");
  d.err = () => err.join("");
  return d;
}

test("V48: install refuses to run without a terminal, and tells an agent what to ask for", async (t) => {
  const w = await world(t);
  const d = deps(w, { isTTY: false });
  const code = await installCommand.run(["--state-dir", w.dir], d);
  assert.notEqual(code, 0);
  assert.match(d.err(), /needs a terminal/);
  assert.match(d.err(), /! lahe install/);
  assert.equal(fs.existsSync(loginItem.installPath(w.dir)), false);
});

test("V48: install refuses to run as root", async (t) => {
  const w = await world(t);
  const d = deps(w, { uid: 0 });
  const code = await installCommand.run(["--state-dir", w.dir], d);
  assert.notEqual(code, 0);
  assert.match(d.err(), /as root/);
});

test("V48 and V72: install writes a login item carrying the port and state folder, starts it, and records install.json", async (t) => {
  const w = await world(t);
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
  const w = await world(t);
  const port = await freePort();
  const d = deps(w, { runner: fakeManager(w, port).runner, users: () => ["jo", "sam"] });
  const code = await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d);
  assert.equal(code, 0, d.err());
  assert.match(d.out() + d.err(), /2 people have accounts on this computer/);
  assert.match(d.out() + d.err(), /other accounts can reach/);
  // Security review S4: say the whole of it. The review token is on the page.
  assert.match(d.out() + d.err(), /read and write every review/);
  assert.match(d.out() + d.err(), /reaches your agent/);
});

test("V72: installing again replaces the login item rather than adding a second", async (t) => {
  const w = await world(t);
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
  const w = await world(t);
  const port = await freePort();
  w.spawned.spawn([BIN, "serve", "--port", String(port), "--state-dir", w.dir], w.helperEnv);
  await pollUntil(() => service.probeHealth(protocol.DEFAULT_HOST, port), { timeoutMs: 10000, message: "the plain helper" });
  const d = deps(w, { runner: fakeManager(w, port).runner });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d), 0, d.err());
  assert.equal((await service.probeHealth(protocol.DEFAULT_HOST, port)).always_on, true);
});

test("Linux without a user systemd: install says so, stays in clone mode, and writes nothing", async (t) => {
  const w = await world(t);
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
  const w = await world(t);
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
  const w = await world(t);
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

// --- the two macOS admin options (lahe-names workstream) ----------------------
//
// sudo is never run: the fake service manager also plays sudo, records the
// call, and reads the files the install handed it. Nothing is written to /etc.

/** The fake manager, plus a sudo that records each call and the files it was given. */
/**
 * The fake manager, plus a sudo that records each call. It plays root too: an
 * install step writes the file root would build (from the port it was given)
 * into the test's stand-in paths, so a later uninstall finds it.
 */
function withSudo(w, port, options) {
  const opts = options || {};
  const manager = fakeManager(w, port);
  const sudo = [];
  const runner = async (command, args) => {
    if (command === "sudo") {
      sudo.push({ args });
      if (opts.sudoFails) return { status: 1, output: "Sorry, try again." };
      const script = args[2];
      const given = Number(args[4]);
      if (opts.paths && script === loginItem.ROOT_SCRIPTS.installResolver) {
        fs.writeFileSync(opts.paths.resolver, loginItem.resolverText(given));
      }
      if (opts.paths && script === loginItem.ROOT_SCRIPTS.installForward) {
        fs.writeFileSync(opts.paths.rule, loginItem.forwardRuleText(given));
        fs.writeFileSync(opts.paths.daemon, loginItem.forwardDaemonText());
      }
      return { status: 0, output: "" };
    }
    return manager.runner(command, args);
  };
  return { runner, sudo, calls: manager.calls };
}

function rootPaths(w) {
  const etc = path.join(w.root, "etc");
  fs.mkdirSync(etc, { recursive: true });
  return {
    resolver: path.join(etc, "resolver-lahe"),
    rule: path.join(etc, "pf-anchor-lahe"),
    daemon: path.join(etc, "lahe-port80.plist")
  };
}

test("V56: --lahe-names makes one sudo call with the fixed resolver file, and records it", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port);
  const d = deps(w, { runner: fake.runner, portHolder: () => null, rootPaths: rootPaths(w) });
  const code = await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--lahe-names"], d);
  assert.equal(code, 0, d.err());
  assert.equal(fake.sudo.length, 1, "one admin step, one sudo call");
  assert.equal(fake.sudo[0].args[2], loginItem.ROOT_SCRIPTS.installResolver);
  assert.deepEqual(fake.sudo[0].args.slice(3), ["lahe", String(w.udp)], "only the port crosses to root, no file and no folder");
  const record = loginItem.readInstall(w.dir);
  assert.equal(record.lahe_names, true);
  assert.equal(record.resolver, loginItem.RESOLVER_PATH);
  assert.equal(record.name_server_port, w.udp, "a free port the test owns, never 7853");
  assert.equal(record.port_80, false, "the other option stays off");
  assert.match(d.out(), /\.lahe/);
});

test("V74: --port-80 makes one sudo call with the fixed forward rule and boot item, and records it", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port);
  const d = deps(w, { runner: fake.runner, portHolder: () => null, rootPaths: rootPaths(w) });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--port-80"], d), 0, d.err());
  assert.equal(fake.sudo.length, 1);
  assert.equal(fake.sudo[0].args[2], loginItem.ROOT_SCRIPTS.installForward);
  assert.deepEqual(fake.sudo[0].args.slice(3), ["lahe", String(protocol.PAGES.PORT)], "only the pages port crosses to root");
  const record = loginItem.readInstall(w.dir);
  assert.equal(record.port_80, true);
  assert.equal(record.forward_rule, loginItem.FORWARD_RULE_PATH);
  await pollUntil(() => w.port80.hits > 0, { timeoutMs: 10000, message: "the helper's forward check to reach the test's stand-in for port 80" });
  assert.equal(record.lahe_names, false);
});

test("V74: --port-80 is skipped, naming the holder, when something listens on port 80", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port);
  const d = deps(w, { runner: fake.runner, portHolder: () => "httpd (pid 412)", rootPaths: rootPaths(w) });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--port-80"], d), 0, d.err());
  assert.equal(fake.sudo.length, 0, "no admin step");
  assert.match(d.out(), /port 80 is held by httpd \(pid 412\)/);
  assert.match(d.out(), /:1483/);
  const record = loginItem.readInstall(w.dir);
  assert.equal(record.port_80, false);
  assert.match(record.port_80_reason, /httpd \(pid 412\)/);
});

test("on Linux, both options are steps done by hand: install records them so the helper checks them, and runs no sudo", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port);
  const d = deps(w, { platform: "linux", runner: fake.runner });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--lahe-names", "--port-80"], d), 0, d.err());
  assert.equal(fake.sudo.length, 0);
  const record = loginItem.readInstall(w.dir);
  assert.equal(record.lahe_names, true);
  assert.equal(record.resolver, loginItem.LINUX_RESOLVER_PATH);
  assert.equal(record.name_server_port, w.udp, "a free port the test owns, never 7853");
  assert.equal(record.port_80, true);
  assert.equal(record.by_hand, true);
  assert.match(d.out(), /by hand/);
  assert.match(d.out(), /docs\/INSTALL\.md/);
});

test("on Windows, --port-80 is a step done by hand, and --lahe-names is refused for now", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port);
  const refused = deps(w, { platform: "win32", uid: null, runner: fake.runner });
  assert.notEqual(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--lahe-names"], refused), 0);
  assert.match(refused.err(), /port 53/);
  assert.equal(fake.calls.length, 0, "nothing was changed");
  const d = deps(w, { platform: "win32", uid: null, runner: fake.runner });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--port-80"], d), 0, d.err());
  assert.equal(loginItem.readInstall(w.dir).port_80, true);
  assert.equal(fake.sudo.length, 0);
});

test("a refused sudo leaves the option off and says so; the login item still installs", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port, { sudoFails: true });
  const d = deps(w, { runner: fake.runner, portHolder: () => null, rootPaths: rootPaths(w) });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--lahe-names"], d), 0, d.err());
  assert.equal(loginItem.readInstall(w.dir).lahe_names, false);
  assert.match(d.err(), /\.lahe was not set up/);
});

test("a later plain install keeps the options already set, with no new sudo call", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port);
  const paths = rootPaths(w);
  const first = deps(w, { runner: fake.runner, portHolder: () => null, rootPaths: paths });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--lahe-names", "--port-80"], first), 0,
    first.out() + first.err());
  assert.equal(fake.sudo.length, 2, "one sudo call per option");
  const second = deps(w, { runner: fake.runner, portHolder: () => null, rootPaths: paths });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], second), 0,
    second.out() + second.err());
  assert.equal(fake.sudo.length, 2);
  const record = loginItem.readInstall(w.dir);
  assert.equal(record.lahe_names, true);
  assert.equal(record.port_80, true);
});

test("V59 and V74: uninstall removes the resolver and the forward only when each carries the marker", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port);
  const paths = rootPaths(w);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)],
    deps(w, { runner: fake.runner, rootPaths: paths })), 0);
  // As root would have left them: ours carry the marker, the stranger does not.
  fs.writeFileSync(paths.resolver, loginItem.resolverText(7853));
  fs.writeFileSync(paths.rule, "rdr pass on lo0 inet proto tcp from any to 127.0.0.1 port 80 -> 127.0.0.1 port 8080\n");
  const d = deps(w, { runner: fake.runner, rootPaths: paths });
  assert.equal(await installCommand.uninstall.run(["--state-dir", w.dir], d), 0, d.err());
  const scripts = fake.sudo.map((call) => call.args[2]);
  assert.deepEqual(scripts, [loginItem.ROOT_SCRIPTS.removeResolver], "only the marked file is removed");
  assert.match(d.out(), /pf-anchor-lahe was not written by Lahe; left alone/);
  assert.match(d.out(), /\.lahe\.localhost addresses keep working/);
});

test("--port-80 again, with Lahe's forward already in place, is not mistaken for another program on port 80", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port);
  const paths = rootPaths(w);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--port-80"],
    deps(w, { runner: fake.runner, portHolder: () => null, rootPaths: paths })), 0);
  // Now port 80 answers, because the forward sends it to the helper.
  const d = deps(w, { runner: fake.runner, portHolder: () => "a program", rootPaths: paths });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--port-80"], d), 0, d.err());
  assert.equal(fake.sudo.length, 2);
  assert.equal(loginItem.readInstall(w.dir).port_80, true);
});

test("uninstall after hand steps says which steps to undo by hand", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--port-80"],
    deps(w, { platform: "linux", runner: fake.runner })), 0);
  const d = deps(w, { platform: "linux", runner: fake.runner });
  assert.equal(await installCommand.uninstall.run(["--state-dir", w.dir], d), 0, d.err());
  assert.match(d.out(), /undo the port 80 forward by hand/);
  assert.equal(fake.sudo.length, 0);
});

test("a failed install takes back what root set up, through the marker-guarded removal, and names a blocked pages port", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const paths = rootPaths(w);
  const fake = withSudo(w, port, { paths });
  // The login item "starts" nothing: the helper never comes up.
  const runner = (command, args) => (command === "sudo" ? fake.runner(command, args) : { status: 0, output: "" });
  // Another program holds the pages port.
  const holder = require("node:net").createServer();
  await new Promise((resolve) => holder.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => holder.close(() => resolve())));
  const d = deps(w, { runner, portHolder: () => null, rootPaths: paths, waitMs: 300, pagesPort: holder.address().port });
  assert.notEqual(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--port-80", "--lahe-names"], d), 0);
  const scripts = fake.sudo.map((call) => call.args[2]);
  assert.ok(scripts.indexOf(loginItem.ROOT_SCRIPTS.removeResolver) !== -1, "the resolver it installed is removed");
  assert.ok(scripts.indexOf(loginItem.ROOT_SCRIPTS.removeForward) !== -1, "the forward it installed is removed");
  assert.match(d.err(), new RegExp("port " + holder.address().port + " is taken by another program"));
  assert.doesNotMatch(d.err(), /Nothing is left installed/);
  assert.equal(fs.existsSync(loginItem.installPath(w.dir)), false);
});

// V59, proved by loading a page rather than by the printed sentence: after
// uninstall removes the .lahe setup, a site's .lahe.localhost address still
// loads whenever the helper runs. In process, in this test's temp folder; no
// real login item, no real /etc file.
test("V59: after uninstall, a .lahe.localhost address loads a page again once the helper runs", async (t) => {
  const { writeFile, raw } = require("../helpers/sites_world.js");
  const w = await world(t);
  const port = await freePort();
  const paths = rootPaths(w);
  const fake = withSudo(w, port, { paths });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--lahe-names"],
    deps(w, { runner: fake.runner, rootPaths: paths })), 0);
  const d = deps(w, { runner: fake.runner, rootPaths: paths });
  assert.equal(await installCommand.uninstall.run(["--state-dir", w.dir], d), 0, d.err());
  assert.ok(fake.sudo.some((call) => call.args[2] === loginItem.ROOT_SCRIPTS.removeResolver), "the .lahe setup was removed");
  assert.equal(fs.existsSync(loginItem.installPath(w.dir)), false);

  // The helper as `lahe review` starts it after an uninstall: on demand, same state folder.
  const helper = await service.serve({ port, stateDir: w.dir, quiet: true, pagesPort: 0, sitesHome: w.home });
  t.after(() => helper.close());
  const folder = path.join(w.home, "ws", "repo", "docs");
  writeFile(folder, "plan.html", "<!doctype html><title>Plan</title><p>Still here after uninstall.</p>");
  const bound = helper.sites.bind({ root: folder, mode: "folder", entry: "plan.html" });
  const res = await raw(helper.pagesPort, { path: "/plan.html", headers: { host: bound.name + ".lahe.localhost:" + helper.pagesPort } });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.match(res.text, /Still here after uninstall\./);
});

test("a label passed in names the login item, and uninstall finds it from install.json", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withSudo(w, port);
  const d = deps(w, { runner: fake.runner, label: "lahe-spike-abc123" });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d), 0, d.err());
  assert.ok(fs.existsSync(path.join(w.home, "Library", "LaunchAgents", "lahe-spike-abc123.plist")));
  assert.equal(loginItem.readInstall(w.dir).label, "lahe-spike-abc123");
  const u = deps(w, { runner: fake.runner });
  assert.equal(await installCommand.uninstall.run(["--state-dir", w.dir], u), 0, u.err());
  assert.ok(fake.calls.some((c) => c.join(" ") === "launchctl bootout gui/501/lahe-spike-abc123"));
  assert.equal(fs.existsSync(path.join(w.home, "Library", "LaunchAgents", "lahe-spike-abc123.plist")), false);
});

// --- the menu bar icon (menu bar plan V21, V22, V25, V27) ---------------------
//
// The Mac's half is test/helpers/fake_mac.js: it answers xcrun and the app's
// launchctl calls (label lahe-test-menubar-<pid>); every other call goes to the
// fake service manager above, which starts and stops the helper. The app's
// source is a temp clone named through the `clone` seam, so install.json's
// clone is that folder and the build reads it from there.

function withMac(w, port, options) {
  const manager = fakeManager(w, port);
  const mac = fakeMac(Object.assign({ labels: [MENUBAR_LABEL] }, options || {}));
  const runner = (command, args) => (mac.handles(command, args) ? mac.runner(command, args) : manager.runner(command, args));
  return { runner, mac, manager };
}

function iconClone(w) {
  const clone = path.join(w.root, "clone");
  writeMenubarSources(clone, "// the app\n");
  return clone;
}

function appPlist(w) {
  return path.join(w.home, "Library", "LaunchAgents", MENUBAR_LABEL + ".plist");
}

test("V21: on macOS, --menu-bar installs the helper, builds the app, writes its plist, and records the menubar block", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  const d = deps(w, { runner: fake.runner, clone: iconClone(w) });
  const code = await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--menu-bar"], d);
  assert.equal(code, 0, d.err());
  assert.equal((await service.probeHealth(protocol.DEFAULT_HOST, port)).always_on, true);
  assert.ok(fs.existsSync(appPlist(w)), "the app's plist");
  assert.equal(fs.readFileSync(menubar.appPath(w.dir) + "/Contents/MacOS/Lahe", "utf8"), "// the app\n");
  const record = loginItem.readInstall(w.dir);
  assert.equal(record.menubar.label, MENUBAR_LABEL);
  assert.equal(record.menubar.source_stamp, menubar.sourceStamp(record.clone));
  assert.equal(fake.mac.job(MENUBAR_LABEL).running, true);
  assert.match(d.out(), /menu bar/);
  assert.match(d.out(), /lahe menubar show/);
});

test("V21: --no-menu-bar skips the icon and asks nothing", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  const d = deps(w, { runner: fake.runner, clone: iconClone(w), canAsk: true, ask: () => { throw new Error("asked"); } });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--no-menu-bar"], d), 0, d.err());
  assert.equal(fs.existsSync(appPlist(w)), false);
  assert.equal(loginItem.readInstall(w.dir).menubar, undefined);
  assert.deepEqual(fake.mac.calls, [], "no xcrun, no app launchctl");
});

test("V21: with neither flag, a terminal is asked once; yes adds the icon", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  const asked = [];
  const d = deps(w, { runner: fake.runner, clone: iconClone(w), canAsk: true, ask: async (q) => { asked.push(q); return "y"; } });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d), 0, d.err());
  assert.equal(asked.length, 1);
  assert.match(asked[0], /menu bar/);
  assert.match(asked[0], /\[y\/N\]/);
  assert.ok(loginItem.readInstall(w.dir).menubar);
});

test("V21: with neither flag, answering no (or nothing) leaves the icon out and says how to add it", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  const d = deps(w, { runner: fake.runner, clone: iconClone(w), canAsk: true, ask: async () => "" });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d), 0, d.err());
  assert.equal(loginItem.readInstall(w.dir).menubar, undefined);
  assert.match(d.out(), /lahe install --menu-bar/);
  assert.deepEqual(fake.mac.calls, []);
});

test("V21: with neither flag and no terminal to ask, the icon is not added and install says how", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  const d = deps(w, { runner: fake.runner, clone: iconClone(w), canAsk: false, ask: () => { throw new Error("asked"); } });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d), 0, d.err());
  assert.equal(loginItem.readInstall(w.dir).menubar, undefined);
  assert.match(d.out(), /lahe install --menu-bar/);
  assert.deepEqual(fake.mac.calls, []);
});

test("V21: an existing install plus --menu-bar adds only the icon: the helper's plist, its process and the rest of install.json are untouched", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  const clone = iconClone(w);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], deps(w, { runner: fake.runner, clone })), 0);
  const helperPlist = loginItem.readInstall(w.dir).login_item;
  const before = {
    plist: fs.readFileSync(helperPlist, "utf8"),
    mtime: fs.statSync(helperPlist).mtimeMs,
    record: loginItem.readInstall(w.dir),
    pid: readyPid(w.dir)
  };
  fake.manager.calls.length = 0;
  const d = deps(w, { runner: fake.runner, clone });
  // No --port: the record's port is the one in use.
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--menu-bar"], d), 0, d.err());
  assert.deepEqual(fake.manager.calls, [], "nothing ran against the helper's login item");
  assert.equal(fs.readFileSync(helperPlist, "utf8"), before.plist);
  assert.equal(fs.statSync(helperPlist).mtimeMs, before.mtime);
  assert.equal(readyPid(w.dir), before.pid, "the same helper process");
  const after = loginItem.readInstall(w.dir);
  assert.ok(after.menubar, "the icon is recorded");
  const rest = Object.assign({}, after);
  delete rest.menubar;
  assert.deepEqual(rest, before.record, "the rest of install.json is untouched");
  assert.ok(fs.existsSync(appPlist(w)));
});

test("V21: on Linux and Windows, --menu-bar says it is macOS only and the install goes on", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  const linux = deps(w, { platform: "linux", runner: fake.runner, clone: iconClone(w) });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--menu-bar"], linux), 0, linux.err());
  assert.match(linux.out() + linux.err(), /menu bar icon is macOS only/);
  assert.equal((await service.probeHealth(protocol.DEFAULT_HOST, port)).always_on, true);
  assert.equal(loginItem.readInstall(w.dir).menubar, undefined);

  const win = deps(w, { platform: "win32", uid: null, runner: fake.runner, clone: iconClone(w) });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--menu-bar"], win), 0, win.err());
  assert.match(win.out() + win.err(), /menu bar icon is macOS only/);
  assert.deepEqual(fake.mac.calls, [], "no xcrun anywhere but a Mac");
});

test("V22: with no swiftc, install names xcode-select --install, writes no app plist, and the rest of the install completes", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port, { swiftc: false });
  const d = deps(w, { runner: fake.runner, clone: iconClone(w) });
  const code = await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--menu-bar"], d);
  assert.equal(code, 0, "the helper installed, so install succeeded");
  assert.match(d.err(), /xcode-select --install/);
  assert.equal(fs.existsSync(appPlist(w)), false);
  const record = loginItem.readInstall(w.dir);
  assert.equal(record.menubar, undefined);
  assert.equal(record.port, port);
  assert.equal((await service.probeHealth(protocol.DEFAULT_HOST, port)).always_on, true);
});

test("V22: with no swiftc on an existing install, --menu-bar alone exits 1 and changes nothing", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const clone = iconClone(w);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], deps(w, { runner: withMac(w, port).runner, clone })), 0);
  const before = loginItem.readInstall(w.dir);
  const d = deps(w, { runner: withMac(w, port, { swiftc: false }).runner, clone });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--menu-bar"], d), 1);
  assert.match(d.err(), /xcode-select --install/);
  assert.deepEqual(loginItem.readInstall(w.dir), before);
});

test("R17: installing again keeps an installed icon without rebuilding or restarting it", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  const clone = iconClone(w);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--menu-bar"], deps(w, { runner: fake.runner, clone })), 0);
  const block = loginItem.readInstall(w.dir).menubar;
  fake.mac.job(MENUBAR_LABEL).running = false; // hidden
  fake.mac.calls.length = 0;
  const d = deps(w, { runner: fake.runner, clone, canAsk: true, ask: () => { throw new Error("asked"); } });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], d), 0, d.err());
  assert.deepEqual(loginItem.readInstall(w.dir).menubar, block);
  assert.deepEqual(fake.mac.calls, [], "the hidden icon stays hidden");
});

test("--no-menu-bar with the icon installed removes the icon and keeps the helper", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  const clone = iconClone(w);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--menu-bar"], deps(w, { runner: fake.runner, clone })), 0);
  const d = deps(w, { runner: fake.runner, clone });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--no-menu-bar"], d), 0, d.err());
  assert.equal(fs.existsSync(appPlist(w)), false);
  assert.equal(loginItem.readInstall(w.dir).menubar, undefined);
  assert.equal((await service.probeHealth(protocol.DEFAULT_HOST, port)).always_on, true);
});

test("--menu-bar and --no-menu-bar together are bad usage", async (t) => {
  const w = await world(t);
  const d = deps(w, { runner: () => ({ status: 0, output: "" }) });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--menu-bar", "--no-menu-bar"], d), protocol.CLI_EXIT.BAD_USAGE);
});

test("V25: uninstall removes the app's plist, the built app and the menubar block, and leaves the app unloaded", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--menu-bar"], deps(w, { runner: fake.runner, clone: iconClone(w) })), 0);
  const d = deps(w, { runner: fake.runner });
  assert.equal(await installCommand.uninstall.run(["--state-dir", w.dir], d), 0, d.err());
  assert.equal(fs.existsSync(appPlist(w)), false);
  assert.equal(fs.existsSync(menubar.appPath(w.dir)), false);
  assert.equal(fs.existsSync(loginItem.installPath(w.dir)), false);
  assert.deepEqual(fake.mac.job(MENUBAR_LABEL), { loaded: false, running: false });
  assert.match(d.out(), /menu bar icon/);
});

test("V27: lahe install removes stopped.json, so the hold ends", async (t) => {
  const w = await world(t);
  const port = await freePort();
  const fake = withMac(w, port);
  const clone = iconClone(w);
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port)], deps(w, { runner: fake.runner, clone })), 0);
  fs.writeFileSync(path.join(w.dir, loginItem.STOP_FILE), JSON.stringify({ by: "menu bar", at: new Date().toISOString() }));
  // Even an icon-only install: the helper is stopped, so the whole install runs.
  const d = deps(w, { runner: fake.runner, clone });
  assert.equal(await installCommand.run(["--state-dir", w.dir, "--port", String(port), "--menu-bar"], d), 0, d.err());
  assert.equal(fs.existsSync(path.join(w.dir, loginItem.STOP_FILE)), false);
  assert.equal((await service.probeHealth(protocol.DEFAULT_HOST, port)).always_on, true);
  assert.ok(loginItem.readInstall(w.dir).menubar);
});
