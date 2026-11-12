// read-when: Changing how scripts/build-layer.js bundles the review layer or the Library page, or when these tests fail.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const build = require("../../scripts/build-layer.js");
const manifest = require("../../src/shared/manifest.js");
const pkg = require("../../package.json");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURES = path.join(REPO_ROOT, "test", "fixtures", "build_layer");

test.after(() => build.stop());

const ENTRIES = [
  { path: "first.js" },
  { path: "middle.ts", registers: ["middle", "greeter"] },
  { path: "last.js" }
];

// Runs a bundle the way a page does: one script, a window with a document, and
// globalThis as the window. Returns the namespace it left behind.
function runInPage(code) {
  const page = { document: {} };
  page.window = page;
  vm.createContext(page);
  vm.runInContext(code, page);
  return page.LAHE;
}

function fixtureBundle(root, entries) {
  return build.bundle({ root: root || FIXTURES, entries: entries || ENTRIES, title: "fixture bundle", namespace: true });
}

test("old files register themselves in order, and a converted module is registered at its own place", async () => {
  const LAHE = runInPage(await fixtureBundle());
  assert.equal(LAHE.first.sawMiddle, false, "first.js ran before the converted module was registered");
  assert.equal(LAHE.last.greeting, "hello reviewer", "last.js received the converted module through window.LAHE");
  assert.equal(LAHE.middle.greet("you"), "hello you");
});

test("a converted module is registered under every name its old file used", async () => {
  const LAHE = runInPage(await fixtureBundle());
  assert.equal(LAHE.greeter, LAHE.middle);
});

test("one namespace name can be backed by several converted modules, combined into one object", async () => {
  const LAHE = runInPage(
    await fixtureBundle(FIXTURES, [
      { path: "first.js" },
      { path: "middle.ts", modules: ["middle.ts", "middle_more.ts"], registers: ["middle"] },
      { path: "last.js" }
    ])
  );
  assert.equal(LAHE.middle.greet("you"), "hello you");
  assert.equal(LAHE.middle.shout("you"), "YOU!");
  assert.equal(LAHE.middle.PUNCTUATION, "!");
  assert.equal(LAHE.last.greeting, "hello reviewer");
});

test("the registered object is ordinary and writable, so old code and tests can replace a function on it", async () => {
  const LAHE = runInPage(await fixtureBundle());
  const replacement = () => "replaced";
  LAHE.middle.greet = replacement;
  assert.equal(LAHE.middle.greet, replacement);
});

test("a converted entry with an empty registration runs in its place and registers nothing", async () => {
  const LAHE = runInPage(
    await fixtureBundle(FIXTURES, [{ path: "first.js" }, { path: "middle.ts", registers: [] }])
  );
  assert.deepEqual(Object.keys(LAHE).sort(), ["first", "version"]);
});

test("two modules combined under one name may not export the same name", async () => {
  await assert.rejects(
    () =>
      fixtureBundle(FIXTURES, [{ path: "middle.ts", modules: ["middle.ts", "clashing.ts"], registers: ["middle"] }]),
    /greet/
  );
});

test("a combined entry's path is the first of its modules", async () => {
  await assert.rejects(
    () =>
      fixtureBundle(FIXTURES, [{ path: "middle_more.ts", modules: ["middle.ts", "middle_more.ts"], registers: ["middle"] }]),
    /middle_more\.ts/
  );
});

test("an old file's Node branch stays out of the bundle, even when it requires a Node module", async () => {
  const code = await fixtureBundle();
  assert.equal(code.indexOf("NODE_ONLY_MARKER"), -1);
  assert.equal(runInPage(code).last.greeting, "hello reviewer");
});

test("the bundle carries one version: the package version and a content hash, on the namespace and in the VERSION placeholder", async () => {
  const LAHE = runInPage(await fixtureBundle());
  assert.match(LAHE.version, new RegExp("^" + pkg.version.replace(/\./g, "\\.") + "\\+[0-9a-f]{12}$"));
  assert.equal(LAHE.last.version, LAHE.version);
});

test("a bundle without the namespace leaves window.LAHE to the files themselves and sets no version", async () => {
  const code = await build.bundle({ root: FIXTURES, entries: ENTRIES, title: "fixture bundle", namespace: false });
  const LAHE = runInPage(code);
  assert.equal(LAHE.version, undefined);
  assert.equal(LAHE.last.greeting, "hello reviewer");
});

test("building twice with no change gives the same bytes, and a source change gives a new version", async (t) => {
  const first = await fixtureBundle();
  assert.equal(await fixtureBundle(), first);

  const copy = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-build-layer-"));
  t.after(() => fs.rmSync(copy, { recursive: true, force: true }));
  for (const name of fs.readdirSync(FIXTURES)) fs.copyFileSync(path.join(FIXTURES, name), path.join(copy, name));
  fs.writeFileSync(path.join(copy, "middle.ts"), 'export function greet(name: string): string {\n  return "hi " + name;\n}\n');
  const changed = runInPage(await fixtureBundle(copy));
  assert.equal(changed.last.greeting, "hi reviewer");
  assert.notEqual(changed.version, runInPage(first).version);
});

test("a converted entry that names no registration is refused, naming the file", async () => {
  await assert.rejects(
    () => fixtureBundle(FIXTURES, [{ path: "first.js" }, { path: "middle.ts" }]),
    /middle\.ts/
  );
});

test("the repo builds two files: the review layer and the Library page", async () => {
  const outputs = await build.buildAll();
  assert.deepEqual(
    outputs.map((output) => output.output),
    [manifest.BUNDLE_OUTPUT, manifest.LIBRARY_OUTPUT]
  );
  const layer = outputs[0].contents;
  const version = /\.version = "([^"]+)"/.exec(layer);
  assert.ok(version, "the layer sets window.LAHE.version");
  assert.ok(layer.indexOf('var VERSION = "' + version[1] + '";') !== -1, "and stamps the same version into the layer's VERSION");
  assert.equal(layer.indexOf("0.0.0-dev"), -1, "no unstamped placeholder is left");
});

test("the Library page bundle holds the protocol, the view model, the copy function and the page script, in that order", () => {
  assert.deepEqual(
    manifest.libraryFiles().map((entry) => entry.path),
    ["src/contract/protocol.ts", "src/layer/catalog/view_model.js", "src/layer/copy_text.js", "src/layer/catalog/page.js"]
  );
});
