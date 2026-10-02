// The page servers answer the reserved `.lahe-styles` segment from the
// installed styles only, from any directory, in both kinds of page server,
// before they look at the disk.
//
// Plan row V5 (R13, serves only what it should), in
// docs/features/20260930.01_style_switcher/03_plan_style_switcher.md.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const staticServers = require("../../src/service/static_servers.js");
const styles = require("../../src/service/styles.js");
const stateDirModule = require("../../src/service/state_dir.js");
const markdown = require("../../src/service/markdown.js");

const FIXTURES = path.join(__dirname, "..", "fixtures", "styles");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request(meta, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: meta.host, port: meta.port, path: pathname, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

function logLines(state, phrase) {
  let text = "";
  try { text = fs.readFileSync(path.join(state, "helper.log"), "utf8"); } catch (err) { /* none yet */ }
  return text.split("\n").filter((line) => line.indexOf(phrase) !== -1);
}

/** A state directory with the two fixture styles installed, and a reviewed folder. */
function setup() {
  const state = path.join(tempDir("lahe-static-styles-state-"), "state");
  for (const name of ["sample", "sample-dark"]) {
    const copy = path.join(tempDir("lahe-static-styles-src-"), name);
    fs.cpSync(path.join(FIXTURES, name), copy, { recursive: true });
    const result = styles.install(state, copy);
    assert.equal(result.ok, true, result.reason);
  }
  const root = tempDir("lahe-static-styles-root-");
  fs.writeFileSync(path.join(root, "page.html"), "<!doctype html><p>page</p>");
  fs.mkdirSync(path.join(root, "sub"));
  fs.writeFileSync(path.join(root, "sub", "inner.html"), "<!doctype html><p>inner</p>");
  return { state, root, installed: path.join(stateDirModule.stylesRoot(state), "sample") };
}

const SHEET = fs.readFileSync(path.join(FIXTURES, "sample", "style.css"));
const FONT = fs.readFileSync(path.join(FIXTURES, "sample", "fonts", "sample-face.woff2"));

async function assertServesStyles(meta, prefix, label) {
  const index = await request(meta, prefix + ".lahe-styles/index.json");
  assert.equal(index.status, 200, label + " index");
  assert.match(index.headers["content-type"], /^application\/json/, label);
  assert.deepEqual(JSON.parse(index.body.toString("utf8")).styles.map((s) => s.id), ["sample", "sample-dark"], label);

  const sheet = await request(meta, prefix + ".lahe-styles/sample/style.css");
  assert.equal(sheet.status, 200, label + " style.css");
  assert.match(sheet.headers["content-type"], /^text\/css/, label);
  assert.equal(sheet.headers["x-content-type-options"], "nosniff", label);
  assert.deepEqual(sheet.body, SHEET, label + " the installed bytes");

  const font = await request(meta, prefix + ".lahe-styles/sample/fonts/sample-face.woff2");
  assert.equal(font.status, 200, label + " font");
  assert.equal(font.headers["content-type"], "font/woff2", label);
  assert.deepEqual(font.body, FONT, label);
}

test("V5: a folder server answers the styles from its root, a subfolder and a mount", async (t) => {
  const f = setup();
  const server = await staticServers.start({ dir: f.state, sessionId: "s_styles_folder", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_styles_folder"); });
  const linked = tempDir("lahe-static-styles-linked-");
  fs.writeFileSync(path.join(linked, "linked.md"), "# linked\n");
  const mount = "/.lahe-source/aaaa06/";
  await staticServers.registerMount(f.state, "s_styles_folder", server.meta, mount, linked);

  await assertServesStyles(server.meta, "/", "root");
  await assertServesStyles(server.meta, "/sub/", "subfolder");
  await assertServesStyles(server.meta, "/no/such/folder/", "a folder that does not exist");
  await assertServesStyles(server.meta, mount, "mount");
});

test("V5: a one-page server answers the styles too", async (t) => {
  const f = setup();
  const page = path.join(f.root, "page.html");
  const server = await staticServers.start({ dir: f.state, sessionId: "s_styles_page", root: page });
  t.after(async () => { await staticServers.stopAll(f.state, "s_styles_page"); });
  assert.equal(server.meta.page, true);
  await assertServesStyles(server.meta, "/", "one-page server");
});

test("V5: a .lahe-styles folder on disk in the reviewed folder is never served", async (t) => {
  const f = setup();
  const planted = path.join(f.root, ".lahe-styles");
  fs.mkdirSync(path.join(planted, "sample"), { recursive: true });
  fs.mkdirSync(path.join(planted, "fake"), { recursive: true });
  fs.writeFileSync(path.join(planted, "sample", "style.css"), "body{background:url(https://example.com/leak)}");
  fs.writeFileSync(path.join(planted, "fake", "style.css"), "body{background:url(https://example.com/leak)}");
  fs.writeFileSync(path.join(planted, "index.json"), JSON.stringify({ styles: [{ id: "fake" }] }));
  const server = await staticServers.start({ dir: f.state, sessionId: "s_styles_planted", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_styles_planted"); });

  const sheet = await request(server.meta, "/.lahe-styles/sample/style.css");
  assert.equal(sheet.status, 200);
  assert.deepEqual(sheet.body, SHEET, "the installed style, not the folder's copy");
  assert.equal((await request(server.meta, "/.lahe-styles/fake/style.css")).status, 404);
  const index = await request(server.meta, "/.lahe-styles/index.json");
  assert.deepEqual(JSON.parse(index.body.toString("utf8")).styles.map((s) => s.id), ["sample", "sample-dark"]);
});

test("V5: the copy beside an artifact is never served; the installed style is", async (t) => {
  const f = setup();
  const work = tempDir("lahe-static-styles-work-");
  const source = path.join(work, "doc.md");
  fs.writeFileSync(source, "---\nlahe-style: sample\n---\n# Doc\n\nWords.\n");
  const rendered = markdown.writeArtifact(f.state, "s_styles_artifact", source);
  const artifactDir = path.dirname(rendered.target);
  assert.ok(fs.existsSync(path.join(artifactDir, ".lahe-styles", "sample", "style.css")), "the copy is there for file://");

  // Reinstall with different bytes. A served page must see the new install.
  const changed = path.join(tempDir("lahe-static-styles-src-"), "sample");
  fs.cpSync(path.join(FIXTURES, "sample"), changed, { recursive: true });
  fs.appendFileSync(path.join(changed, "style.css"), "\n/* reinstalled */\n");
  assert.equal(styles.install(f.state, changed).ok, true);

  const server = await staticServers.start({ dir: f.state, sessionId: "s_styles_artifact", root: artifactDir });
  t.after(async () => { await staticServers.stopAll(f.state, "s_styles_artifact"); });
  const sheet = await request(server.meta, "/.lahe-styles/sample/style.css");
  assert.equal(sheet.status, 200);
  assert.match(sheet.body.toString("utf8"), /reinstalled/);
});

test("V5: everything but the three shapes is refused", async (t) => {
  const f = setup();
  const outside = path.join(tempDir("lahe-static-styles-outside-"), "secret.txt");
  fs.writeFileSync(outside, "secret");
  const server = await staticServers.start({ dir: f.state, sessionId: "s_styles_refuse", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_styles_refuse"); });

  for (const pathname of [
    "/.lahe-styles/sample/DESIGN.md",
    "/.lahe-styles/sample/metadata.json",
    "/.lahe-styles/sample/LICENSE",
    "/.lahe-styles/sample/fonts/LICENSE",
    "/.lahe-styles/sample/",
    "/.lahe-styles/",
    "/.lahe-styles",
    "/.lahe-styles/sample/style.css/x",
    "/.lahe-styles/unknown/style.css",
    "/.lahe-styles/international/style.css",
    "/.lahe-styles/Sample/style.css",
    "/.lahe-styles/%2e%2e/sample/style.css",
    "/.lahe-styles/sample/%2e%2e/metadata.json",
    "/.lahe-styles/sample/fonts/..%2F..%2Fmetadata.json",
    "/.lahe-styles/sample/fonts/%2e%2e%2f%2e%2e%2fmetadata.json",
    "/.lahe-styles/..%2F..%2F..%2F" + encodeURIComponent(outside.slice(1)),
    "/.lahe-styles/sample/fonts/missing.woff2"
  ]) {
    const res = await request(server.meta, pathname);
    assert.equal(res.status, 404, pathname);
    assert.equal(res.body.toString("utf8").indexOf("secret"), -1, pathname);
  }
});

test("V5: a symlink planted after install is refused, and said once in the helper log", async (t) => {
  const f = setup();
  const outside = path.join(tempDir("lahe-static-styles-outside-"), "secret.woff2");
  fs.writeFileSync(outside, "secret bytes");
  const font = path.join(f.installed, "fonts", "sample-face.woff2");
  fs.rmSync(font);
  fs.symlinkSync(outside, font);
  const server = await staticServers.start({ dir: f.state, sessionId: "s_styles_symlink", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_styles_symlink"); });

  const res = await request(server.meta, "/.lahe-styles/sample/fonts/sample-face.woff2");
  assert.equal(res.status, 404);
  assert.equal(res.body.toString("utf8").indexOf("secret"), -1);

  const sheetLink = path.join(f.installed, "style.css");
  fs.rmSync(sheetLink);
  fs.symlinkSync(path.join(FIXTURES, "sample", "style.css"), sheetLink);
  assert.equal((await request(server.meta, "/.lahe-styles/sample/style.css")).status, 404);
  assert.equal((await request(server.meta, "/.lahe-styles/sample/style.css")).status, 404);
  // One line per server per style and reason: the font, then the sheet, each
  // said once although the sheet was asked for twice.
  const lines = logLines(f.state, "refused style sample");
  assert.equal(lines.length, 2, "one line per reason: " + JSON.stringify(lines));
  assert.ok(lines.every((line) => /symlink/.test(line)));
});

test("V5: a good sheet is served, then edited to fetch, then refused, with one log line per server", async (t) => {
  const f = setup();
  const one = await staticServers.start({ dir: f.state, sessionId: "s_styles_edit", root: f.root });
  const pageRoot = path.join(f.root, "page.html");
  const two = await staticServers.start({ dir: f.state, sessionId: "s_styles_edit", root: pageRoot });
  t.after(async () => { await staticServers.stopAll(f.state, "s_styles_edit"); });

  assert.equal((await request(one.meta, "/.lahe-styles/sample/style.css")).status, 200);
  assert.equal((await request(two.meta, "/.lahe-styles/sample/style.css")).status, 200);

  fs.appendFileSync(path.join(f.installed, "style.css"), "\na{background:url(\"https://example.com/leak\")}\n");
  for (const meta of [one.meta, one.meta, two.meta, two.meta]) {
    assert.equal((await request(meta, "/.lahe-styles/sample/style.css")).status, 404);
  }
  // The style also drops out of the list, and its fonts stop being served.
  const index = await request(one.meta, "/.lahe-styles/index.json");
  assert.deepEqual(JSON.parse(index.body.toString("utf8")).styles.map((s) => s.id), ["sample-dark"]);
  assert.equal((await request(one.meta, "/.lahe-styles/sample/fonts/sample-face.woff2")).status, 404);

  const lines = logLines(f.state, "refused style sample");
  assert.equal(lines.length, 2, "one line for each of the two servers: " + JSON.stringify(lines));
  assert.ok(lines.every((line) => /url\(/.test(line)), "the line names the reason");
});

test("fix round 1: a style refused for a new reason is said again, once per reason", async (t) => {
  const f = setup();
  const server = await staticServers.start({ dir: f.state, sessionId: "s_styles_reasons", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_styles_reasons"); });

  const sheet = path.join(f.installed, "style.css");
  fs.appendFileSync(sheet, "\na{background:url(\"https://example.com/leak\")}\n");
  assert.equal((await request(server.meta, "/.lahe-styles/sample/style.css")).status, 404);
  assert.equal((await request(server.meta, "/.lahe-styles/sample/style.css")).status, 404);

  fs.rmSync(sheet);
  fs.symlinkSync(path.join(FIXTURES, "sample", "style.css"), sheet);
  assert.equal((await request(server.meta, "/.lahe-styles/sample/style.css")).status, 404);
  assert.equal((await request(server.meta, "/.lahe-styles/sample/style.css")).status, 404);

  const lines = logLines(f.state, "refused style sample");
  assert.equal(lines.length, 2, JSON.stringify(lines));
  assert.match(lines[0], /url\(/);
  assert.match(lines[1], /symlink/);
});

test("fix round 1: an error while answering a style is a 404 and one helper-log line, not silence", async (t) => {
  const f = setup();
  const fonts = path.join(f.installed, "fonts");
  fs.chmodSync(fonts, 0o000);
  t.after(() => fs.chmodSync(fonts, 0o700));
  const server = await staticServers.start({ dir: f.state, sessionId: "s_styles_error", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_styles_error"); });

  assert.equal((await request(server.meta, "/.lahe-styles/sample/style.css")).status, 404);
  assert.equal((await request(server.meta, "/.lahe-styles/sample/style.css")).status, 404);
  const lines = logLines(f.state, "could not answer");
  assert.equal(lines.length, 1, JSON.stringify(lines));
});
