// `npm run install-skills` also installs `lahe hook stop` as a Claude Code Stop
// hook (docs/features/20261006.02_rearm_guard). Every test here works on a temp
// home; none of them reads or writes the real ~/.claude/settings.json.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const installSkills = require("../../scripts/install-skills.js");

const PATHS = { node: "/opt/node/bin/node", entry: "/clone/bin/lahe.js" };
const OURS = installSkills.hookCommand(PATHS);

function tempHome() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-hook-home-"));
  assert.ok(home !== os.homedir());
  return home;
}

function settingsFile(home) {
  return path.join(home, ".claude", "settings.json");
}

function writeSettings(home, value) {
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(settingsFile(home), typeof value === "string" ? value : JSON.stringify(value, null, 2));
}

function readSettings(home) {
  return JSON.parse(fs.readFileSync(settingsFile(home), "utf8"));
}

function ourCommands(settings) {
  const groups = (settings.hooks && settings.hooks.Stop) || [];
  const found = [];
  groups.forEach((group) => (group.hooks || []).forEach((hook) => {
    if (installSkills.isOurHook(hook.command)) found.push(hook.command);
  }));
  return found;
}

const FIXTURE = {
  env: { BASH_MAX_TIMEOUT_MS: "86400000" },
  permissions: { allow: ["Bash(ls:*)"] },
  hooks: {
    PostToolUse: [{ hooks: [{ type: "command", command: "/home/me/.claude/hooks/audit.sh" }] }],
    Stop: [{ matcher: "", hooks: [{ type: "command", command: "say done" }] }]
  },
  statusLine: { type: "command", command: "echo hi" }
};

test("the hook command pins both absolute paths and is recognised as ours", () => {
  assert.equal(OURS, '"/opt/node/bin/node" "/clone/bin/lahe.js" hook stop');
  assert.equal(installSkills.isOurHook(OURS), true);
  assert.equal(installSkills.isOurHook("lahe hook stop"), true, "a hand-written one is ours to replace");
  assert.equal(installSkills.isOurHook('"/n" "/elsewhere/bin/lahe.js" hook stop'), true, "an older clone path too");
  assert.equal(installSkills.isOurHook("say done"), false);
  assert.equal(installSkills.isOurHook("echo lahe hook stopped"), false);
  assert.equal(installSkills.isOurHook(undefined), false);
});

test("merge adds the Stop hook and keeps every other hook and setting", () => {
  const merged = installSkills.mergeStopHook(JSON.parse(JSON.stringify(FIXTURE)), OURS);
  assert.equal(merged.changed, true);
  const s = merged.settings;
  assert.deepEqual(s.env, FIXTURE.env);
  assert.deepEqual(s.permissions, FIXTURE.permissions);
  assert.deepEqual(s.statusLine, FIXTURE.statusLine);
  assert.deepEqual(s.hooks.PostToolUse, FIXTURE.hooks.PostToolUse);
  assert.deepEqual(s.hooks.Stop[0], FIXTURE.hooks.Stop[0], "the other Stop hook is untouched");
  assert.deepEqual(ourCommands(s), [OURS]);
  const ourGroup = s.hooks.Stop[s.hooks.Stop.length - 1];
  assert.equal(ourGroup.hooks[0].type, "command");
  assert.equal(typeof ourGroup.hooks[0].timeout, "number");
});

test("merge is idempotent, and replaces an older lahe hook rather than adding a second", () => {
  const once = installSkills.mergeStopHook({}, OURS).settings;
  const twice = installSkills.mergeStopHook(JSON.parse(JSON.stringify(once)), OURS);
  assert.equal(twice.changed, false);
  assert.deepEqual(twice.settings, once);

  const moved = installSkills.mergeStopHook(JSON.parse(JSON.stringify(once)), '"/n" "/new/bin/lahe.js" hook stop');
  assert.equal(moved.changed, true);
  assert.deepEqual(ourCommands(moved.settings), ['"/n" "/new/bin/lahe.js" hook stop']);
});

test("merge keeps a group that also holds someone else's hook", () => {
  const shared = { hooks: { Stop: [{ hooks: [{ type: "command", command: "say done" }, { type: "command", command: "lahe hook stop" }] }] } };
  const merged = installSkills.mergeStopHook(shared, OURS).settings;
  assert.deepEqual(merged.hooks.Stop[0].hooks, [{ type: "command", command: "say done" }]);
  assert.deepEqual(ourCommands(merged), [OURS]);
});

test("remove takes out only lahe's hook", () => {
  const installed = installSkills.mergeStopHook(JSON.parse(JSON.stringify(FIXTURE)), OURS).settings;
  const removed = installSkills.removeStopHook(installed);
  assert.equal(removed.changed, true);
  assert.deepEqual(removed.settings, FIXTURE);
  assert.equal(installSkills.removeStopHook(JSON.parse(JSON.stringify(FIXTURE))).changed, false);
  const only = installSkills.removeStopHook(installSkills.mergeStopHook({ model: "x" }, OURS).settings);
  assert.deepEqual(only.settings, { model: "x" }, "an emptied Stop list and hooks object go too");
});

test("installHook writes a fixture settings file in a temp home, atomically and idempotently", () => {
  const home = tempHome();
  writeSettings(home, FIXTURE);
  const out = [];
  const first = installSkills.installHook({ home: home, node: PATHS.node, entry: PATHS.entry, stdout: (t) => out.push(t), stderr: () => {} });
  assert.equal(first, 0);
  const after = readSettings(home);
  assert.deepEqual(ourCommands(after), [OURS]);
  assert.deepEqual(after.env, FIXTURE.env);
  assert.match(out.join(""), /added the Claude Code Stop hook/);
  assert.deepEqual(fs.readdirSync(path.join(home, ".claude")).filter((n) => n !== "settings.json"), [], "no temp file left behind");

  const before = fs.readFileSync(settingsFile(home), "utf8");
  out.length = 0;
  assert.equal(installSkills.installHook({ home: home, node: PATHS.node, entry: PATHS.entry, stdout: (t) => out.push(t), stderr: () => {} }), 0);
  assert.equal(fs.readFileSync(settingsFile(home), "utf8"), before, "a second run writes nothing");
  assert.match(out.join(""), /already installed/);
});

test("installHook creates settings.json when there is none", () => {
  const home = tempHome();
  assert.equal(installSkills.installHook({ home: home, node: PATHS.node, entry: PATHS.entry, stdout: () => {}, stderr: () => {} }), 0);
  assert.deepEqual(ourCommands(readSettings(home)), [OURS]);
});

test("installHook leaves a settings file it cannot parse exactly as it was", () => {
  const home = tempHome();
  writeSettings(home, "{ \"env\": { broken");
  const err = [];
  assert.equal(installSkills.installHook({ home: home, node: PATHS.node, entry: PATHS.entry, stdout: () => {}, stderr: (t) => err.push(t) }), 1);
  assert.equal(fs.readFileSync(settingsFile(home), "utf8"), "{ \"env\": { broken");
  assert.match(err.join(""), /left .* alone/);
});

test("installHook writes through a symlinked settings.json instead of replacing the link", () => {
  const home = tempHome();
  const real = path.join(home, "dotfiles-settings.json");
  fs.writeFileSync(real, JSON.stringify({ model: "x" }));
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.symlinkSync(real, settingsFile(home));
  assert.equal(installSkills.installHook({ home: home, node: PATHS.node, entry: PATHS.entry, stdout: () => {}, stderr: () => {} }), 0);
  assert.equal(fs.lstatSync(settingsFile(home)).isSymbolicLink(), true);
  assert.deepEqual(ourCommands(JSON.parse(fs.readFileSync(real, "utf8"))), [OURS]);
});

test("uninstallHook removes it again", () => {
  const home = tempHome();
  writeSettings(home, FIXTURE);
  installSkills.installHook({ home: home, node: PATHS.node, entry: PATHS.entry, stdout: () => {}, stderr: () => {} });
  assert.equal(installSkills.uninstallHook({ home: home, stdout: () => {}, stderr: () => {} }), 0);
  assert.deepEqual(readSettings(home), FIXTURE);
});

test("install() puts the skill and the hook in the given home", () => {
  const home = tempHome();
  assert.equal(installSkills.install({ home: home, stdout: () => {}, stderr: () => {} }), 0);
  const commands = ourCommands(readSettings(home));
  assert.equal(commands.length, 1);
  assert.ok(commands[0].indexOf(path.resolve(__dirname, "..", "..", "bin", "lahe.js")) !== -1, "it points at this clone");
  assert.ok(commands[0].indexOf(process.execPath) !== -1, "with the node that ran it");
});
