// The login item per system (src/service/login_item.js): what file it writes,
// what that file starts, and the commands that load, start, and remove it.
//
// No test here registers a real login item. The files are written into a temp
// home, and the service-manager calls go through a runner the test records.
// The macOS, Linux, and Windows spikes (scripts/spike_login_item.js) are where
// a real service manager runs them.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const loginItem = require("../../src/service/login_item.js");

const SPACED = {
  node: "/Users/Jo Smith/.nvm/versions/node/v20.19.0/bin/node",
  entry: "/Users/Jo Smith/code/lahe clone/bin/lahe.js",
  port: 47817,
  stateDir: "/Users/Jo Smith/Lahe State/lahe"
};

function tempHome() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-login-item-")));
}

test("the helper is started with --always-on, the port, and the state folder", () => {
  assert.deepEqual(loginItem.helperArgs(SPACED), [
    SPACED.node,
    SPACED.entry,
    "serve",
    "--always-on",
    "--port",
    "47817",
    "--state-dir",
    SPACED.stateDir
  ]);
});

test("macOS: the plist names each argument as its own string, spaces kept, XML escaped", () => {
  const item = loginItem.describe(Object.assign({ system: "macos", home: "/Users/Jo Smith", label: "lahe-helper", uid: 501 }, SPACED));
  assert.equal(item.path, "/Users/Jo Smith/Library/LaunchAgents/lahe-helper.plist");
  assert.match(item.contents, /<key>RunAtLoad<\/key>\s*<true\/>/);
  assert.match(item.contents, /<key>KeepAlive<\/key>\s*<true\/>/);
  assert.match(item.contents, /<string>\/Users\/Jo Smith\/Lahe State\/lahe<\/string>/);
  assert.match(item.contents, /<string>--always-on<\/string>/);
  assert.match(item.contents, /<string>47817<\/string>/);

  const odd = loginItem.describe(Object.assign({}, SPACED, { system: "macos", home: "/h", label: "lahe-helper", uid: 501, stateDir: "/h/a&b<c>" }));
  assert.match(odd.contents, /<string>\/h\/a&amp;b&lt;c&gt;<\/string>/);
});

test("macOS: load, start, and remove go through launchctl for this user", () => {
  const item = loginItem.describe(Object.assign({ system: "macos", home: "/h", label: "lahe-helper", uid: 501 }, SPACED));
  assert.deepEqual(item.load, [["launchctl", "bootstrap", "gui/501", "/h/Library/LaunchAgents/lahe-helper.plist"]]);
  assert.deepEqual(item.start, [["launchctl", "kickstart", "gui/501/lahe-helper"]]);
  assert.deepEqual(item.unload, [["launchctl", "bootout", "gui/501/lahe-helper"]]);
});

test("Linux: the unit quotes each argument for systemd, and restarts always", () => {
  const item = loginItem.describe(Object.assign({ system: "linux", home: "/home/jo", label: "lahe-helper" }, SPACED, {
    stateDir: '/home/jo/50% "odd" $dir\\x'
  }));
  assert.equal(item.path, "/home/jo/.config/systemd/user/lahe-helper.service");
  const exec = item.contents.split("\n").find((line) => line.startsWith("ExecStart="));
  assert.equal(
    exec,
    'ExecStart="' + SPACED.node + '" "' + SPACED.entry + '" "serve" "--always-on" "--port" "47817" "--state-dir" ' +
      '"/home/jo/50%% \\"odd\\" $$dir\\\\x"'
  );
  assert.match(item.contents, /^Restart=always$/m);
  assert.match(item.contents, /^WantedBy=default\.target$/m);
  assert.deepEqual(item.load, [
    ["systemctl", "--user", "daemon-reload"],
    ["systemctl", "--user", "enable", "--now", "lahe-helper.service"]
  ]);
  assert.deepEqual(item.start, [["systemctl", "--user", "start", "lahe-helper.service"]]);
});

test("Linux: XDG_CONFIG_HOME moves the unit folder", () => {
  const item = loginItem.describe(Object.assign({ system: "linux", home: "/home/jo", label: "lahe-helper", configHome: "/home/jo/cfg" }, SPACED));
  assert.equal(item.path, "/home/jo/cfg/systemd/user/lahe-helper.service");
});

test("Windows: the task runs at logon, hidden, with each argument quoted by the Windows rules", () => {
  const item = loginItem.describe({
    system: "windows",
    home: "C:\\Users\\Jo Smith",
    label: "lahe-helper",
    user: "JO-PC\\Jo Smith",
    node: "C:\\Program Files\\nodejs\\node.exe",
    entry: "C:\\Users\\Jo Smith\\lahe clone\\bin\\lahe.js",
    port: 47817,
    stateDir: "C:\\Users\\Jo Smith\\state dir\\"
  });
  // The XML is only the import source, so it sits in the state folder.
  assert.equal(item.path, path.join("C:\\Users\\Jo Smith\\state dir\\", "login-item.xml"));
  assert.match(item.contents, /<LogonTrigger>/);
  assert.match(item.contents, /<UserId>JO-PC\\Jo Smith<\/UserId>/);
  assert.match(item.contents, /<Command>conhost\.exe<\/Command>/);
  const args = /<Arguments>([^<]*)<\/Arguments>/.exec(item.contents)[1];
  assert.equal(
    args,
    "--headless &quot;C:\\Program Files\\nodejs\\node.exe&quot; &quot;C:\\Users\\Jo Smith\\lahe clone\\bin\\lahe.js&quot; " +
      "serve --always-on --port 47817 --state-dir &quot;C:\\Users\\Jo Smith\\state dir\\\\&quot;"
  );
  assert.match(item.contents, /<RestartOnFailure>/);
  assert.match(item.contents, /<MultipleInstancesPolicy>IgnoreNew<\/MultipleInstancesPolicy>/);
  assert.deepEqual(item.start, [["schtasks", "/Run", "/TN", "lahe-helper"]]);
  assert.deepEqual(item.load[0], ["schtasks", "/Create", "/TN", "lahe-helper", "/XML", item.path, "/F"]);
});

test("Windows: a path with a quote character is refused rather than quoted into a task", () => {
  assert.throws(
    () => loginItem.describe(Object.assign({}, SPACED, { system: "windows", home: "C:\\h", user: "u", stateDir: 'C:\\a"b' })),
    /quote character/
  );
});

test("Windows argument quoting leaves plain words bare and doubles backslashes only before a quote", () => {
  assert.equal(loginItem.windowsQuote("serve"), "serve");
  assert.equal(loginItem.windowsQuote("C:\\a b\\c"), '"C:\\a b\\c"');
  assert.equal(loginItem.windowsQuote('a\\"b'), '"a\\\\\\"b"');
  assert.equal(loginItem.windowsQuote("trail\\ "), '"trail\\ "');
  assert.equal(loginItem.windowsQuote("end\\"), "end\\");
  assert.equal(loginItem.windowsQuote("sp end\\"), '"sp end\\\\"');
  assert.equal(loginItem.windowsQuote(""), '""');
});

test("write puts the file where the item says, and Windows XML as UTF-16 with a byte-order mark", () => {
  const home = tempHome();
  const mac = loginItem.describe(Object.assign({ system: "macos", home: home, label: "lahe-test", uid: 501 }, SPACED));
  loginItem.writeItem(mac);
  assert.equal(fs.readFileSync(mac.path, "utf8"), mac.contents);

  const win = loginItem.describe(Object.assign({}, SPACED, { system: "windows", home: home, label: "lahe-test", user: "u", stateDir: path.join(home, "state") }));
  loginItem.writeItem(win);
  const bytes = fs.readFileSync(win.path);
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xfe);
  assert.equal(bytes.slice(2).toString("utf16le"), win.contents);
  assert.match(win.contents, /^<\?xml version="1\.0" encoding="UTF-16"\?>/);
});

test("the install record round-trips, and the status says to reinstall when the recorded Node is gone", () => {
  const home = tempHome();
  const dir = path.join(home, "state");
  fs.mkdirSync(dir);
  const node = path.join(home, "node bin", "node");
  fs.mkdirSync(path.dirname(node));
  fs.writeFileSync(node, "");
  const clone = path.join(home, "clone");
  fs.mkdirSync(clone);
  const record = { system: "macos", label: "lahe-test", login_item: "/x.plist", node: node, clone: clone, port: 47817, state_dir: dir };
  loginItem.writeInstall(dir, record);
  assert.deepEqual(loginItem.readInstall(dir), record);
  assert.equal(loginItem.reinstallReason(record), null);

  fs.renameSync(node, node + ".gone");
  assert.match(loginItem.reinstallReason(record), /the Node at .*node bin.* is gone; run `lahe install` again/);

  fs.renameSync(node + ".gone", node);
  fs.renameSync(clone, clone + "-moved");
  assert.match(loginItem.reinstallReason(record), /the clone at .* is gone; run `lahe install` again from the clone you use/);
});

test("installedFor answers only for the port the record names", () => {
  const home = tempHome();
  const record = { system: "macos", label: "lahe-test", port: 47817, state_dir: home };
  assert.equal(loginItem.installedFor(home, 47817), null);
  loginItem.writeInstall(home, record);
  assert.deepEqual(loginItem.installedFor(home, 47817), record);
  assert.equal(loginItem.installedFor(home, 47818), null);
});

test("a label that could leave its folder is refused", () => {
  assert.throws(() => loginItem.describe(Object.assign({ system: "macos", home: "/h", uid: 501, label: "../x" }, SPACED)), /not a login item label/);
  assert.throws(() => loginItem.startCommands({ system: "linux", label: "a b" }), /not a login item label/);
});
