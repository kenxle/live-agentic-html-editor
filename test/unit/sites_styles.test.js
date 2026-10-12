// Installed document styles at a stable address (stable addresses Step 3).
// Carried over from the retired test/retired/unit/static_styles.test.js: the
// helper answers the reserved `.lahe-styles` segment from the installed styles
// only, from any folder of a site, a notes site and a mount, before it looks
// at the disk. Plan row V5 of docs/features/20260930.01_style_switcher.
//
// Each test serves from an in-process helper on free ports and a temp state
// folder, and closes it in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const styles = require("../../src/service/styles.js");
const stateDirModule = require("../../src/service/state_dir.js");
const markdown = require("../../src/service/markdown.js");
const { sitesWorld, writeFile, raw } = require("../helpers/sites_world.js");

const FIXTURES = path.join(__dirname, "..", "fixtures", "styles");

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/** A helper with the two fixture styles installed, and a reviewed folder bound as a site. */
async function setup(t, options) {
  const w = await sitesWorld(t);
  for (const name of ["sample", "sample-dark"]) {
    const copy = path.join(tempDir("lahe-site-styles-src-"), name);
    fs.cpSync(path.join(FIXTURES, name), copy, { recursive: true });
    const result = styles.install(w.state, copy);
    assert.equal(result.ok, true, result.reason);
  }
  const root = path.join(w.home, "ws", "styles", "root");
  writeFile(root, "page.html", "<!doctype html><p>page</p>");
  writeFile(root, "sub/inner.html", "<!doctype html><p>inner</p>");
  const opts = options || {};
  const bound = w.helper.sites.bind({ root: fs.realpathSync(root), mode: "folder", entry: "page.html", mounts: opts.mounts });
  return { w, state: w.state, root: fs.realpathSync(root), name: bound.name, installed: path.join(stateDirModule.stylesRoot(w.state), "sample") };
}

/** GET a path on a site, as {status, headers, body: Buffer}. */
function request(f, pathname, name) {
  return new Promise((resolve, reject) => {
    const http = require("node:http");
    const req = http.request({
      host: "127.0.0.1",
      port: f.w.helper.pagesPort,
      path: pathname,
      headers: { host: (name || f.name) + ".lahe.localhost:" + f.w.helper.pagesPort },
      setHost: false
    }, (res) => {
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

const SHEET = fs.readFileSync(path.join(FIXTURES, "sample", "style.css"));
const FONT = fs.readFileSync(path.join(FIXTURES, "sample", "fonts", "sample-face.woff2"));

async function assertServesStyles(f, prefix, label, name) {
  const index = await request(f, prefix + ".lahe-styles/index.json", name);
  assert.equal(index.status, 200, label + " index");
  assert.match(index.headers["content-type"], /^application\/json/, label);
  assert.deepEqual(JSON.parse(index.body.toString("utf8")).styles.map((s) => s.id), ["sample", "sample-dark"], label);

  const sheet = await request(f, prefix + ".lahe-styles/sample/style.css", name);
  assert.equal(sheet.status, 200, label + " style.css");
  assert.match(sheet.headers["content-type"], /^text\/css/, label);
  assert.equal(sheet.headers["x-content-type-options"], "nosniff", label);
  assert.deepEqual(sheet.body, SHEET, label + " the installed bytes");

  const font = await request(f, prefix + ".lahe-styles/sample/fonts/sample-face.woff2", name);
  assert.equal(font.status, 200, label + " font");
  assert.equal(font.headers["content-type"], "font/woff2", label);
  assert.deepEqual(font.body, FONT, label);
}

test("V5: a site answers the styles from its root, a subfolder, a missing folder and a mount", async (t) => {
  const linked = tempDir("lahe-site-styles-linked-");
  fs.writeFileSync(path.join(linked, "linked.md"), "# linked\n");
  const mount = "/.lahe-source/aaaa06/";
  const f = await setup(t, { mounts: { [mount]: linked } });
  await assertServesStyles(f, "/", "root");
  await assertServesStyles(f, "/sub/", "subfolder");
  await assertServesStyles(f, "/no/such/folder/", "a folder that does not exist");
  await assertServesStyles(f, mount, "mount");
});

test("V5: a notes site answers the styles too", async (t) => {
  const f = await setup(t);
  const notes = writeFile(path.join(f.w.home, "ws", "notes", "n"), "today.md", "# t\n");
  const bound = f.w.helper.sites.bind({ root: fs.realpathSync(notes), mode: "page-only", entry: "today.md" });
  await assertServesStyles(f, "/", "notes site", bound.name);
});

test("V5: a .lahe-styles folder on disk in the reviewed folder is never served", async (t) => {
  const f = await setup(t);
  const planted = path.join(f.root, ".lahe-styles");
  fs.mkdirSync(path.join(planted, "sample"), { recursive: true });
  fs.mkdirSync(path.join(planted, "fake"), { recursive: true });
  fs.writeFileSync(path.join(planted, "sample", "style.css"), "body{background:url(https://example.com/leak)}");
  fs.writeFileSync(path.join(planted, "fake", "style.css"), "body{background:url(https://example.com/leak)}");
  fs.writeFileSync(path.join(planted, "index.json"), JSON.stringify({ styles: [{ id: "fake" }] }));
  const sheet = await request(f, "/.lahe-styles/sample/style.css");
  assert.equal(sheet.status, 200);
  assert.deepEqual(sheet.body, SHEET, "the installed style, not the folder's copy");
  assert.equal((await request(f, "/.lahe-styles/fake/style.css")).status, 404);
  const index = await request(f, "/.lahe-styles/index.json");
  assert.deepEqual(JSON.parse(index.body.toString("utf8")).styles.map((s) => s.id), ["sample", "sample-dark"]);
});

test("V5: the copy beside an artifact is never served; the installed style is", async (t) => {
  const f = await setup(t);
  const source = writeFile(path.join(f.w.home, "ws", "styled"), "doc.md", "---\nlahe-style: sample\n---\n# Doc\n\nWords.\n");
  const rendered = markdown.writeArtifact(f.state, "s_styles_artifact", source);
  assert.ok(fs.existsSync(path.join(path.dirname(rendered.target), ".lahe-styles", "sample", "style.css")), "the copy is there for file://");
  const changed = path.join(tempDir("lahe-site-styles-src-"), "sample");
  fs.cpSync(path.join(FIXTURES, "sample"), changed, { recursive: true });
  fs.appendFileSync(path.join(changed, "style.css"), "\n/* reinstalled */\n");
  assert.equal(styles.install(f.state, changed).ok, true);
  const bound = f.w.helper.sites.bind({ root: fs.realpathSync(path.dirname(source)), mode: "folder", entry: "doc.md" });
  const page = await request(f, "/doc.md", bound.name);
  assert.match(page.body.toString("utf8"), /\.lahe-styles\/sample\/style\.css/);
  const sheet = await request(f, "/.lahe-styles/sample/style.css", bound.name);
  assert.equal(sheet.status, 200);
  assert.match(sheet.body.toString("utf8"), /reinstalled/);
});

test("V5: everything but the three shapes is refused", async (t) => {
  const f = await setup(t);
  const outside = path.join(tempDir("lahe-site-styles-outside-"), "secret.txt");
  fs.writeFileSync(outside, "secret");
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
    const res = await request(f, pathname);
    assert.equal(res.status, 404, pathname);
    assert.equal(res.body.toString("utf8").indexOf("secret"), -1, pathname);
  }
});

test("V5: a symlink planted after install is refused, and said once in the helper log", async (t) => {
  const f = await setup(t);
  const outside = path.join(tempDir("lahe-site-styles-outside-"), "secret.woff2");
  fs.writeFileSync(outside, "secret bytes");
  const font = path.join(f.installed, "fonts", "sample-face.woff2");
  fs.renameSync(font, font + ".moved");
  fs.symlinkSync(outside, font);
  const res = await request(f, "/.lahe-styles/sample/fonts/sample-face.woff2");
  assert.equal(res.status, 404);
  assert.equal(res.body.toString("utf8").indexOf("secret"), -1);
  const sheetLink = path.join(f.installed, "style.css");
  fs.renameSync(sheetLink, sheetLink + ".moved");
  fs.symlinkSync(path.join(FIXTURES, "sample", "style.css"), sheetLink);
  assert.equal((await request(f, "/.lahe-styles/sample/style.css")).status, 404);
  assert.equal((await request(f, "/.lahe-styles/sample/style.css")).status, 404);
  const lines = logLines(f.state, "refused style sample");
  assert.equal(lines.length, 2, "one line per reason: " + JSON.stringify(lines));
  assert.ok(lines.every((line) => /symlink/.test(line)));
});

test("V5: a good sheet is served, then edited to fetch, then refused on every site, with one log line", async (t) => {
  const f = await setup(t);
  const notes = writeFile(path.join(f.w.home, "ws", "notes", "n"), "today.md", "# t\n");
  const other = f.w.helper.sites.bind({ root: fs.realpathSync(notes), mode: "page-only", entry: "today.md" }).name;
  assert.equal((await request(f, "/.lahe-styles/sample/style.css")).status, 200);
  assert.equal((await request(f, "/.lahe-styles/sample/style.css", other)).status, 200);
  fs.appendFileSync(path.join(f.installed, "style.css"), "\na{background:url(\"https://example.com/leak\")}\n");
  for (const name of [f.name, f.name, other, other]) {
    assert.equal((await request(f, "/.lahe-styles/sample/style.css", name)).status, 404);
  }
  const index = await request(f, "/.lahe-styles/index.json");
  assert.deepEqual(JSON.parse(index.body.toString("utf8")).styles.map((s) => s.id), ["sample-dark"]);
  assert.equal((await request(f, "/.lahe-styles/sample/fonts/sample-face.woff2")).status, 404);
  const lines = logLines(f.state, "refused style sample");
  assert.equal(lines.length, 1, "one line for the helper, which serves every site: " + JSON.stringify(lines));
  assert.ok(lines.every((line) => /url\(/.test(line)), "the line names the reason");
});

test("fix round 1: a style refused for a new reason is said again, once per reason", async (t) => {
  const f = await setup(t);
  const sheet = path.join(f.installed, "style.css");
  fs.appendFileSync(sheet, "\na{background:url(\"https://example.com/leak\")}\n");
  assert.equal((await request(f, "/.lahe-styles/sample/style.css")).status, 404);
  assert.equal((await request(f, "/.lahe-styles/sample/style.css")).status, 404);
  fs.renameSync(sheet, sheet + ".moved");
  fs.symlinkSync(path.join(FIXTURES, "sample", "style.css"), sheet);
  assert.equal((await request(f, "/.lahe-styles/sample/style.css")).status, 404);
  assert.equal((await request(f, "/.lahe-styles/sample/style.css")).status, 404);
  const lines = logLines(f.state, "refused style sample");
  assert.equal(lines.length, 2, JSON.stringify(lines));
  assert.match(lines[0], /url\(/);
  assert.match(lines[1], /symlink/);
});

test("fix round 1: an error while answering a style is a 404 and one helper-log line, not silence", async (t) => {
  const f = await setup(t);
  const fonts = path.join(f.installed, "fonts");
  fs.chmodSync(fonts, 0o000);
  t.after(() => fs.chmodSync(fonts, 0o700));
  assert.equal((await request(f, "/.lahe-styles/sample/style.css")).status, 404);
  assert.equal((await request(f, "/.lahe-styles/sample/style.css")).status, 404);
  const lines = logLines(f.state, "could not answer");
  assert.equal(lines.length, 1, JSON.stringify(lines));
});
