/*
read-when: Changing the Node minimum, the message an old Node sees, or install-cli's refusal on an old Node.
*/

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const espree = require("espree");

const floor = require("../../bin/node_floor.js");
const installCli = require("../../scripts/install-cli.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "lahe.js");

test("the floor is 24.12.0 and package.json, .nvmrc and CI say the same", () => {
  assert.equal(floor.FLOOR_TEXT, "24.12.0");
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8"));
  assert.equal(pkg.engines.node, ">=" + floor.FLOOR_TEXT);
  assert.deepEqual(pkg.dependencies || {}, {});
  const nvmrc = fs.readFileSync(path.join(REPO_ROOT, ".nvmrc"), "utf8").trim();
  assert.equal(floor.meetsFloor(nvmrc), true, ".nvmrc names a Node at or above the floor");
  const gate = fs.readFileSync(path.join(REPO_ROOT, ".github", "workflows", "gate.yml"), "utf8");
  assert.match(gate, /node-version: 24\s*$/m);
});

test("a Node below the floor does not meet it", () => {
  assert.equal(floor.meetsFloor("20.19.0"), false);
  assert.equal(floor.meetsFloor("24.11.1"), false);
  assert.equal(floor.meetsFloor("18.2.0"), false);
  assert.equal(floor.meetsFloor("23.99.99"), false);
});

test("the floor itself meets it", () => {
  assert.equal(floor.meetsFloor("24.12.0"), true);
  assert.equal(floor.meetsFloor("v24.12.0"), true, "a leading v is how process.version spells it");
});

test("a Node above the floor meets it, whatever part is higher", () => {
  assert.equal(floor.meetsFloor("24.12.1"), true);
  assert.equal(floor.meetsFloor("24.13.0"), true);
  assert.equal(floor.meetsFloor("24.22.3"), true);
  assert.equal(floor.meetsFloor("25.0.0"), true);
  assert.equal(floor.meetsFloor("100.0.0"), true, "numbers compare as numbers, not as text");
  assert.equal(floor.meetsFloor("24.100.0"), true);
});

test("a version string that cannot be read does not meet the floor", () => {
  for (const bad of ["", "banana", "24", "24.12", "24.x.0", "-24.12.0", "24.12.0.1", null, undefined, 24]) {
    assert.equal(floor.meetsFloor(bad), false, "unreadable: " + String(bad));
  }
});

test("the old-Node message names the version found, the version needed and the fix", () => {
  const message = floor.problem("20.19.0", "/some/clone");
  assert.match(message, /Node 24\.12 or newer/);
  assert.match(message, /this is Node 20\.19\.0/);
  assert.match(message, /Install Node 24/);
  assert.match(message, /npm run install-cli/);
  assert.match(message, /lahe install/);
  assert.match(message, /\/some\/clone/, "the clone's path, so the user knows where to run them");
});

test("a Node 24 below 24.12 is told to install 24.12 or newer, not just Node 24", () => {
  const message = floor.problem("24.11.1", "/some/clone");
  assert.match(message, /this is Node 24\.11\.1/);
  assert.match(message, /Install Node 24\.12 or newer/);
});

test("the message for an unreadable version quotes it", () => {
  const message = floor.problem("banana", "/some/clone");
  assert.match(message, /Node 24\.12 or newer/);
  assert.match(message, /"banana"/);
});

test("a Node that meets the floor has no problem", () => {
  assert.equal(floor.problem("24.12.0", "/some/clone"), null);
  assert.equal(floor.problem("24.22.3", "/some/clone"), null);
});

/** A temp folder the test removes when it ends. */
function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** Every string literal in an ES5 parse of the file; the parse throws on anything newer than ES5. */
function es5Strings(file) {
  const text = fs.readFileSync(file, "utf8").replace(/^#!.*/, "");
  const ast = espree.parse(text, { ecmaVersion: 5, sourceType: "script" });
  const strings = [];
  const visit = (node) => {
    if (!node || typeof node.type !== "string") return;
    if (node.type === "Literal" && typeof node.value === "string") strings.push(node.value);
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(ast);
  return strings;
}

test("bin/lahe.js and bin/node_floor.js parse as ES5 and load no node: module, so a very old Node reaches the message", () => {
  for (const name of ["lahe.js", "node_floor.js"]) {
    const file = path.join(REPO_ROOT, "bin", name);
    let strings;
    assert.doesNotThrow(() => {
      strings = es5Strings(file);
    }, "bin/" + name + " parses as ES5");
    assert.deepEqual(strings.filter((text) => text.startsWith("node:")), [], "bin/" + name + " names no node: module");
  }
});

test("bin/lahe.js on an old Node prints the message to stderr and exits non-zero", (t) => {
  const preload = path.join(tempDir(t, "lahe-floor-"), "pretend_old_node.js");
  fs.writeFileSync(
    preload,
    'Object.defineProperty(process, "versions", { value: Object.assign({}, process.versions, { node: "20.19.0" }) });\n'
  );
  const ran = childProcess.spawnSync(process.execPath, ["--require", preload, BIN, "status"], {
    encoding: "utf8",
    timeout: 20000
  });
  assert.notEqual(ran.status, 0);
  assert.equal(ran.stdout, "", "nothing on stdout, so a script that reads it sees nothing");
  assert.match(ran.stderr, /this is Node 20\.19\.0/);
  assert.ok(ran.stderr.indexOf(REPO_ROOT) !== -1, "names this clone's absolute path");
});

test("bin/lahe.js still runs on this Node", () => {
  const ran = childProcess.spawnSync(process.execPath, [BIN, "--help"], { encoding: "utf8", timeout: 20000 });
  assert.equal(ran.status, 0);
  assert.doesNotMatch(ran.stderr, /Node 24\.12 or newer/);
});

test("install-cli refuses to install from a Node below the floor and writes nothing", (t) => {
  const home = tempDir(t, "lahe-floor-home-");
  let stdout = "";
  let stderr = "";
  const code = installCli.install({
    home: home,
    nodeVersion: "20.19.0",
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    }
  });
  assert.equal(code, 1);
  assert.equal(stdout, "");
  assert.match(stderr, /Node 24\.12 or newer/);
  assert.match(stderr, /this is Node 20\.19\.0/);
  assert.equal(fs.existsSync(path.join(home, ".local")), false, "nothing was written");
});

test("install-cli on a Node 24 below 24.12 says to install 24.12 or newer", (t) => {
  let stderr = "";
  const code = installCli.install({
    home: tempDir(t, "lahe-floor-home-"),
    nodeVersion: "24.11.1",
    stdout: () => {},
    stderr: (text) => {
      stderr += text;
    }
  });
  assert.equal(code, 1);
  assert.match(stderr, /Install Node 24\.12 or newer/);
});

test("install-cli goes ahead on a Node at the floor", (t) => {
  const home = tempDir(t, "lahe-floor-home-");
  let stderr = "";
  const code = installCli.install({
    home: home,
    nodeVersion: "24.12.0",
    stdout: () => {},
    stderr: (text) => {
      stderr += text;
    }
  });
  assert.equal(code, 0, stderr);
  assert.ok(fs.existsSync(path.join(home, ".local", "bin", "lahe")));
});
