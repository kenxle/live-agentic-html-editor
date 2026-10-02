// `lahe style add` and `lahe style list`, run through the dispatcher against
// a temporary state directory.
//
// Plan rows V1 (installs a folder), V2 (refuses with a reason) and V4
// (reinstall, a failed swap, the lock, and list), in
// docs/features/20260930.01_style_switcher/03_plan_style_switcher.md.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const cli = require("../../src/cli/index.js");
const protocol = require("../../src/shared/protocol.js");
const styles = require("../../src/service/styles.js");
const stateDirModule = require("../../src/service/state_dir.js");

const FIXTURES = path.join(__dirname, "..", "fixtures", "styles");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function tempState() {
  return path.join(tempDir("lahe-style-cmd-state-"), "state");
}

function copyFixture(fixture, name) {
  const target = path.join(tempDir("lahe-style-cmd-src-"), name || fixture);
  fs.cpSync(path.join(FIXTURES, fixture), target, { recursive: true });
  return target;
}

async function run(args) {
  const stdout = [];
  const stderr = [];
  const originalOut = process.stdout.write;
  const originalErr = process.stderr.write;
  process.stdout.write = function (chunk) { stdout.push(String(chunk)); return true; };
  process.stderr.write = function (chunk) { stderr.push(String(chunk)); return true; };
  try {
    const code = await cli.main(args);
    return { code: code, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  }
}

/** Every name in the styles folder, dotfiles included, so a leftover shows. */
function rootNames(state) {
  return fs.readdirSync(stateDirModule.stylesRoot(state)).sort();
}

test("the dispatcher advertises and routes `style`", async () => {
  const help = await run(["--help"]);
  assert.match(help.stdout, /\bstyle\b/);
  assert.ok(cli.COMMAND_NAMES.indexOf("style") !== -1);

  const bare = await run(["style"]);
  assert.equal(bare.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(bare.stderr, /usage: lahe style/);

  const ownHelp = await run(["style", "--help"]);
  assert.equal(ownHelp.code, protocol.CLI_EXIT.OK);
  assert.match(ownHelp.stdout, /lahe style add/);
  assert.match(ownHelp.stdout, /lahe style list/);

  const noFolder = await run(["style", "add", "--state-dir", tempState()]);
  assert.equal(noFolder.code, protocol.CLI_EXIT.BAD_USAGE);

  const unknown = await run(["style", "remove", "sample"]);
  assert.equal(unknown.code, protocol.CLI_EXIT.BAD_USAGE);
});

test("V1: add installs the fixture and prints its id and name", async () => {
  const state = tempState();
  const result = await run(["style", "add", copyFixture("sample"), "--state-dir", state]);
  assert.equal(result.code, protocol.CLI_EXIT.OK, result.stderr);
  assert.match(result.stdout, /installed sample \(Sample\)/);
  assert.equal(result.stderr, "");
  assert.deepEqual(rootNames(state), ["sample"]);
  assert.ok(fs.existsSync(path.join(stateDirModule.stylesRoot(state), "sample", "fonts", "sample-face.woff2")));
});

test("V1: add takes several folders at once", async () => {
  const state = tempState();
  const result = await run(["style", "add", copyFixture("sample"), copyFixture("sample-dark"), "--state-dir", state]);
  assert.equal(result.code, protocol.CLI_EXIT.OK, result.stderr);
  assert.match(result.stdout, /installed sample \(Sample\)/);
  assert.match(result.stdout, /installed sample-dark \(Sample Dark\)/);
});

test("V2: a refused folder exits non-zero with the reason and what a style folder needs", async () => {
  const state = tempState();
  const folder = copyFixture("sample");
  fs.appendFileSync(path.join(folder, "style.css"), "\n@import url(\"https://example.com/x.css\");\n");
  const result = await run(["style", "add", folder, "--state-dir", state]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /refused/);
  assert.match(result.stderr, /@import/);
  assert.match(result.stderr, /A style folder holds/);
  assert.equal(result.stdout, "");
  assert.equal(styles.list(state).length, 0, "nothing was installed");
});

test("V2: a refusal printed to the terminal carries no escape codes from the folder", async () => {
  const state = tempState();
  const folder = copyFixture("sample");
  fs.writeFileSync(path.join(folder, "metadata.json"), JSON.stringify({ name: "Evil\u001b]0;pwned\u0007" }));
  const result = await run(["style", "add", folder, "--state-dir", state]);
  assert.equal(result.code, 1);
  assert.equal(/[\u0000-\u0008\u000b-\u001f\u007f]/.test(result.stderr), false, JSON.stringify(result.stderr));
});

test("one refused folder does not stop the others, and the exit says something was refused", async () => {
  const state = tempState();
  const bad = copyFixture("sample", "international");
  const result = await run(["style", "add", bad, copyFixture("sample-dark"), "--state-dir", state]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /International Style/);
  assert.match(result.stdout, /installed sample-dark/);
});

test("V4: installing the same id again replaces it, with no leftover files", async () => {
  const state = tempState();
  assert.equal((await run(["style", "add", copyFixture("sample"), "--state-dir", state])).code, 0);

  const changed = copyFixture("sample");
  const meta = JSON.parse(fs.readFileSync(path.join(changed, "metadata.json"), "utf8"));
  meta.name = "Sample Two";
  meta.version = "2.0.0";
  fs.writeFileSync(path.join(changed, "metadata.json"), JSON.stringify(meta));
  fs.rmSync(path.join(changed, "DESIGN.md"));

  const again = await run(["style", "add", changed, "--state-dir", state]);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /installed sample \(Sample Two\), replacing the earlier install/);
  assert.deepEqual(rootNames(state), ["sample"], "no aside folder, temp folder or lock is left");
  const installed = path.join(stateDirModule.stylesRoot(state), "sample");
  assert.equal(fs.existsSync(path.join(installed, "DESIGN.md")), false, "files the new folder lacks are gone");
  assert.equal(JSON.parse(fs.readFileSync(path.join(installed, "metadata.json"), "utf8")).version, "2.0.0");
});

test("V4: a failure between the two renames leaves the old install in place", async (t) => {
  const state = tempState();
  assert.equal((await run(["style", "add", copyFixture("sample"), "--state-dir", state])).code, 0);
  const before = fs.readFileSync(path.join(stateDirModule.stylesRoot(state), "sample", "metadata.json"), "utf8");

  styles._hooks.betweenRenames = function () { throw new Error("disk full"); };
  t.after(() => { styles._hooks.betweenRenames = null; });
  const changed = copyFixture("sample");
  fs.writeFileSync(path.join(changed, "metadata.json"), JSON.stringify({ name: "Sample Two" }));
  const result = await run(["style", "add", changed, "--state-dir", state]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /earlier install is kept/);
  assert.deepEqual(rootNames(state), ["sample"], "no aside or temp folder is left");
  assert.equal(fs.readFileSync(path.join(stateDirModule.stylesRoot(state), "sample", "metadata.json"), "utf8"), before);
});

test("V4: a second add of the same id while one holds the lock is refused", async () => {
  const state = tempState();
  stateDirModule.ensureStylesRoot(state);
  fs.writeFileSync(styles._lockPath(state, "sample"), "12345\n");
  const result = await run(["style", "add", copyFixture("sample"), "--state-dir", state]);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /another lahe style add of sample is running/);
  assert.equal(fs.existsSync(path.join(stateDirModule.stylesRoot(state), "sample")), false);
});

test("a lock left by an add that died is taken over", async () => {
  const state = tempState();
  stateDirModule.ensureStylesRoot(state);
  const lock = styles._lockPath(state, "sample");
  fs.writeFileSync(lock, "12345\n");
  const old = new Date(Date.now() - 5 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  const result = await run(["style", "add", copyFixture("sample"), "--state-dir", state]);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(rootNames(state), ["sample"]);
});

test("V4: list prints id, name and version, and names a refused folder", async () => {
  const state = tempState();
  const empty = await run(["style", "list", "--state-dir", state]);
  assert.equal(empty.code, 0);
  assert.match(empty.stdout, /no styles installed/);
  assert.match(empty.stdout, /lahe style add <folder>/);

  await run(["style", "add", copyFixture("sample"), copyFixture("sample-dark"), "--state-dir", state]);
  const hand = path.join(stateDirModule.stylesRoot(state), "hand-copied");
  fs.cpSync(path.join(FIXTURES, "sample"), hand, { recursive: true });
  fs.appendFileSync(path.join(hand, "style.css"), "\na{background:url(https://example.com/x)}\n");

  const listed = await run(["style", "list", "--state-dir", state]);
  assert.equal(listed.code, 0);
  const lines = listed.stdout.trim().split("\n");
  assert.match(lines[0], /^sample\s+Sample\s+1\.0\.0$/);
  assert.match(lines[1], /^sample-dark\s+Sample Dark\s+1\.0\.0$/);
  assert.match(listed.stdout, /hand-copied\s+refused: style\.css is refused/);
});
