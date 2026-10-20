// Pages served by the helper (stable addresses, Task 1.3).
//
// Plan rows: V14 (hidden files and dot segments), V15 (notes page-only), V17
// (Cross-Origin-Resource-Policy), V18 (unknown name), V19 (gone file), V23
// (a GET never writes), V69 (escaping), plus the unit half of V12 and V13
// (assets and Markdown served from the site). Requests are raw so the path
// reaches the helper exactly as written: a browser would normalize `..`.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageRoutes = require("../../src/service/page_routes.js");
const sites = require("../../src/service/sites.js");
const stateDir = require("../../src/service/state_dir.js");
const { sitesWorld, raw, writeFile, getPage, siteHost } = require("../helpers/sites_world.js");

const PAGE = "<!doctype html><html><head><title>t</title></head><body><p id=x>hello page</p></body></html>";

async function folderWorld(t) {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  writeFile(folder, "page.html", PAGE);
  writeFile(folder, "img/a.png", "PNGBYTES");
  writeFile(folder, ".env", "SECRET=1");
  writeFile(folder, ".git/config", "[core]");
  writeFile(folder, "sub/.hidden.html", "<p>hidden</p>");
  writeFile(folder, "sub/inner.html", "<p>inner</p>");
  writeFile(w.home, "ws/repo/outside.html", "<p>outside the root</p>");
  const bound = w.helper.sites.bind({ root: folder, mode: "folder", entry: "page.html" });
  return Object.assign(w, { folder, name: bound.name });
}

// --- the ordinary case, and what it injects ----------------------------------

test("a page of a bound review is served with that review's script tag", async (t) => {
  const w = await folderWorld(t);
  const review = w.helper.reviews.create({ target_path: path.join(w.folder, "page.html"), agent_session_id: "s1" });
  const res = await getPage(w, w.name, "/page.html");
  assert.equal(res.status, 200);
  assert.match(res.text, /hello page/);
  assert.match(res.text, new RegExp('data-lahe-review="' + review.id + '"'));
  assert.match(res.text, /src="\/\.lahe-library\/lahe-layer\.js"/);
});

test("a page no review answers for is served plain, with no script tag", async (t) => {
  const w = await folderWorld(t);
  const res = await getPage(w, w.name, "/page.html");
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /data-lahe-review/);
});

test("V12 (unit half): images and other files under the root are served as bytes with no tag", async (t) => {
  const w = await folderWorld(t);
  w.helper.reviews.create({ target_path: path.join(w.folder, "page.html"), agent_session_id: "s1" });
  const img = await getPage(w, w.name, "/img/a.png");
  assert.equal(img.status, 200);
  assert.equal(img.text, "PNGBYTES");
  assert.equal(img.headers["content-type"], "image/png");
});

test("the library and the document style come from Lahe, never from the folder", async (t) => {
  const w = await folderWorld(t);
  const lib = await getPage(w, w.name, "/.lahe-library/lahe-layer.js");
  assert.equal(lib.status, 200);
  assert.match(lib.headers["content-type"], /javascript/);
  const css = await getPage(w, w.name, "/sub/.lahe-doc-style.css");
  assert.equal(css.status, 200);
  assert.match(css.headers["content-type"], /text\/css/);
});

// --- V14: dot segments and encoded slashes ------------------------------------
//
// Hidden files get no special handling: a dotfile under the root is served
// like any other file (test/unit/hidden_files_served.test.js). What V14 still
// refuses is a path that climbs out: raw dot segments, their encoded
// spellings, and encoded slashes.

test("V14: raw dot segments and their encoded spellings are 404 under every site, and dotfiles are served", async (t) => {
  const w = await folderWorld(t);
  const refused = [
    "/../outside.html",
    "/sub/../../outside.html",
    "/sub/./inner.html",
    "/%2e%2e/outside.html",
    "/sub/%2E%2E/%2e%2e/outside.html",
    "/..%2foutside.html",
    "/sub%2f..%2f..%2foutside.html",
    "/sub%5c..%5c..%5coutside.html"
  ];
  for (const p of refused) {
    const res = await getPage(w, w.name, p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.text, /outside the root/, p);
  }
  for (const [p, words] of [["/.env", /SECRET=1/], ["/.git/config", /\[core\]/], ["/sub/.hidden.html", /hidden/], ["/%2Eenv", /SECRET=1/]]) {
    const res = await getPage(w, w.name, p);
    assert.equal(res.status, 200, p);
    assert.match(res.text, words, p);
  }
  assert.equal((await getPage(w, w.name, "/sub/inner.html")).status, 200);
});

test("V14: a mount refuses dot segments and an encoded mount prefix, and serves its dotfiles", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "a", "b", "c");
  writeFile(folder, "doc.html", PAGE);
  const other = path.join(w.home, "elsewhere");
  writeFile(other, "linked.html", "<p>linked</p>");
  writeFile(other, ".secret", "the dotfile");
  const prefix = "/.lahe-source/0123456789abcdef/";
  const bound = w.helper.sites.bind({ root: folder, mode: "folder", entry: "doc.html", mounts: { [prefix]: other } });
  w.helper.sites.addMountFiles(bound.name, [fs.realpathSync(path.join(other, "linked.html")), fs.realpathSync(path.join(other, ".secret"))]);
  assert.equal((await getPage(w, bound.name, prefix + "linked.html")).status, 200);
  for (const p of [prefix + ".secret", prefix + "%2esecret"]) {
    const res = await getPage(w, bound.name, p);
    assert.equal(res.status, 200, p);
    assert.match(res.text, /the dotfile/, p);
  }
  for (const p of [prefix + "../c/doc.html", "/%2Elahe-source/0123456789abcdef/linked.html"]) {
    const res = await getPage(w, bound.name, p);
    assert.equal(res.status, 404, p);
  }
});

// --- V15: notes page-only -----------------------------------------------------

test("V15: a notes site serves its one page and Lahe's reserved files, and 404s a sibling", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "notes", "today");
  const notes = writeFile(folder, "today.md", "# Today\n\nsome words\n");
  writeFile(folder, "other.md", "# Other\n\nprivate\n");
  writeFile(folder, "page.html", PAGE);
  const bound = w.helper.sites.bind({ root: notes, mode: "page-only", entry: "today.md" });
  const page = await getPage(w, bound.name, "/today.md");
  assert.equal(page.status, 200);
  assert.match(page.text, /some words/);
  assert.equal((await getPage(w, bound.name, "/.lahe-doc-style.css")).status, 200);
  assert.equal((await getPage(w, bound.name, "/.lahe-library/lahe-layer.js")).status, 200);
  for (const p of ["/other.md", "/page.html", "/", "/today.md/../other.md"]) {
    const res = await getPage(w, bound.name, p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.text, /private|hello page/, p);
  }
});

test("V15: a notes review's page carries its rail", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "notes", "today");
  const notes = writeFile(folder, "today.md", "# Today\n\nsome words\n");
  const bound = w.helper.sites.bind({ root: notes, mode: "page-only", entry: "today.md" });
  const review = w.helper.reviews.create({
    target_path: path.join(w.state, "artifact-today.html"),
    source_path: notes,
    agent_session_id: "s1",
    notes: true
  });
  const page = await getPage(w, bound.name, "/today.md");
  assert.match(page.text, new RegExp('data-lahe-review="' + review.id + '"'));
});

// --- V13 (unit half): Markdown from source -------------------------------------

test("V13 (unit half): a Markdown page renders from source, its images stay on the site, and an outside link becomes this site's mount", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "notes");
  writeFile(folder, "pic.png", "PNG");
  const outside = writeFile(w.home, "ws/other/far.md", "# Far\n\nfar away\n");
  writeFile(folder, "doc.md", "# Doc\n\n![pic](pic.png)\n\n[far](../../other/far.md)\n");
  const bound = w.helper.sites.bind({ root: folder, mode: "folder", entry: "doc.md" });
  const res = await getPage(w, bound.name, "/doc.md");
  assert.equal(res.status, 200);
  assert.match(res.text, /src="\/pic\.png"/);
  const link = /href="(\/\.lahe-source\/[a-f0-9]+\/far\.md)"/.exec(res.text);
  assert.ok(link, "the outside link was translated to a mount");
  assert.equal((await getPage(w, bound.name, "/pic.png")).text, "PNG");
  const far = await getPage(w, bound.name, link[1]);
  assert.equal(far.status, 200);
  assert.match(far.text, /far away/);
  assert.ok(outside);
});

test("V9: a notes page still follows no links: a link out of its folder is plain text and makes no mount", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "notes");
  writeFile(w.home, "ws/fresh/far.md", "# Far\n\nfar away\n");
  writeFile(folder, "sibling.md", "# Sibling\n");
  const notes = writeFile(folder, "today.md", "# Today\n\n[far](../fresh/far.md) and [sibling](sibling.md)\n");
  const bound = w.helper.sites.bind({ root: fs.realpathSync(notes), mode: "page-only", entry: "today.md" });
  const res = await getPage(w, bound.name, "/today.md");
  assert.equal(res.status, 200);
  assert.match(res.text, /<span class="lahe-local-link" title="local file, open it on disk: [^"]*far\.md">far<\/span>/);
  assert.doesNotMatch(res.text, /href="\/\.lahe-source\//);
  assert.deepEqual(Object.keys(w.helper.sites.get(bound.name).mounts || {}), []);
});

test("V16: a page naming 260 files under mounts: 256 work, 4 render as plain text with the limit title, one log line, the same on every reload", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "notes");
  const lines = ["# Doc", ""];
  for (let i = 0; i < 260; i += 1) {
    writeFile(w.home, "ws/many/file-" + String(i).padStart(3, "0") + ".md", "# File " + i + "\n");
    lines.push("[file " + i + "](../../many/file-" + String(i).padStart(3, "0") + ".md)", "");
  }
  writeFile(folder, "doc.md", lines.join("\n"));
  const bound = w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "doc.md" });
  let prefix = null;
  for (let load = 0; load < 3; load += 1) {
    const res = await getPage(w, bound.name, "/doc.md");
    assert.equal((res.text.match(/class="lahe-local-link"/g) || []).length, 4, "load " + load);
    assert.equal((res.text.match(/links more than 256 files/g) || []).length, 4, "the title says why, load " + load);
    prefix = /href="(\/\.lahe-source\/[a-f0-9]+\/)file-000\.md"/.exec(res.text)[1];
  }
  assert.equal((await getPage(w, bound.name, prefix + "file-255.md")).status, 200);
  assert.equal((await getPage(w, bound.name, prefix + "file-256.md")).status, 404);
  assert.equal(w.helper.sites.get(bound.name).mount_files.length, 256);
  assert.equal(Object.keys(w.helper.sites.get(bound.name).mounts).length, 1);
  const log = fs.readFileSync(stateDir.helperLogPath(w.state), "utf8");
  assert.equal(log.split("names more than 256 files").length - 1, 1, log);
});

// --- V17: CORP ----------------------------------------------------------------

test("V17: every page response carries Cross-Origin-Resource-Policy: same-origin", async (t) => {
  const w = await folderWorld(t);
  for (const p of ["/page.html", "/img/a.png", "/.lahe-library/lahe-layer.js", "/missing.png", "/gone.html", "/.env"]) {
    const res = await getPage(w, w.name, p);
    assert.equal(res.headers["cross-origin-resource-policy"], "same-origin", p);
  }
  const unknown = await getPage(w, "no.such.site", "/x.html");
  assert.equal(unknown.headers["cross-origin-resource-policy"], "same-origin");
});

// --- V18 and V19: unknown and gone -------------------------------------------

test("V18: an unknown name shows the no-document page with a Library link", async (t) => {
  const w = await folderWorld(t);
  const res = await getPage(w, "no.such.site", "/x.html");
  assert.equal(res.status, 404);
  assert.match(res.text, /No document by that name/);
  assert.match(res.text, /no\.such\.site\.lahe\.localhost/);
  // library.lahe.localhost at the pages port: a same-site click the Library
  // page accepts. 127.0.0.1 was cross-site, and the Library refused it.
  assert.ok(res.text.includes('href="http://library.lahe.localhost:' + w.helper.pagesPort + '/catalog"'));
});

test("V19: a gone file shows the file-is-gone page naming the path", async (t) => {
  const w = await folderWorld(t);
  const res = await getPage(w, w.name, "/gone.html");
  assert.equal(res.status, 410);
  assert.match(res.text, /This file is gone/);
  assert.ok(res.text.includes(path.join(w.folder, "gone.html")));
  assert.ok(res.text.includes('href="http://library.lahe.localhost:' + w.helper.pagesPort + '/catalog"'));
  assert.match(res.text, /\/catalog"/);
  // A missing asset is a plain 404, not the page.
  assert.equal((await getPage(w, w.name, "/missing.png")).status, 404);
});

test("V19: a gone notes page shows the file-is-gone page", async (t) => {
  const w = await sitesWorld(t);
  const notes = writeFile(path.join(w.home, "n", "o"), "today.md", "# t\n");
  const bound = w.helper.sites.bind({ root: notes, mode: "page-only", entry: "today.md" });
  fs.renameSync(notes, notes + ".moved");
  const res = await getPage(w, bound.name, "/today.md");
  assert.equal(res.status, 410);
  assert.ok(res.text.includes(notes));
});

// --- V69: escaping ----------------------------------------------------------

test("V69: the name and path on these pages are escaped", () => {
  const evilPath = "/tmp/<script>alert(1)</script>&\"'.html";
  const gone = pageRoutes.gonePage(evilPath, "http://127.0.0.1:7817");
  assert.doesNotMatch(gone, /<script>alert/);
  assert.match(gone, /&lt;script&gt;alert\(1\)&lt;\/script&gt;&amp;&quot;&#39;\.html/);
  const unknown = pageRoutes.unknownNamePage("a<b>\"c", "http://127.0.0.1:7817\"><x");
  assert.doesNotMatch(unknown, /a<b>/);
  assert.doesNotMatch(unknown, /"><x/);
});

test("V69: a gone file whose name carries markup is escaped on the served page", async (t) => {
  const w = await folderWorld(t);
  const res = await getPage(w, w.name, "/%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E.html");
  assert.equal(res.status, 410);
  assert.doesNotMatch(res.text, /<img src=x onerror/);
  assert.match(res.text, /&lt;img src=x onerror=alert\(1\)&gt;\.html/);
});

// --- V23: a GET never writes --------------------------------------------------

function snapshot(dir) {
  const out = {};
  for (const file of ["sites.json", "sites.log"]) {
    try { out[file] = fs.readFileSync(path.join(dir, file), "utf8"); } catch (err) { out[file] = null; }
  }
  const reviewsDir = path.join(dir, "reviews");
  let ids = [];
  try { ids = fs.readdirSync(reviewsDir); } catch (err) { ids = []; }
  ids.forEach((id) => {
    try { out["meta:" + id] = fs.readFileSync(path.join(reviewsDir, id, "meta.json"), "utf8"); } catch (err) { /* none */ }
  });
  return out;
}

test("V23: a page GET for an unbound file creates no name and changes no review", async (t) => {
  const w = await folderWorld(t);
  w.helper.reviews.create({ target_path: path.join(w.folder, "page.html"), agent_session_id: "s1" });
  const elsewhere = path.join(w.home, "never", "bound");
  writeFile(elsewhere, "x.html", PAGE);
  const before = snapshot(w.state);
  const names = sites.candidates(elsewhere, { home: w.home });
  for (const name of names) await getPage(w, name, "/x.html");
  await getPage(w, w.name, "/page.html");
  await getPage(w, w.name, "/sub/inner.html");
  await getPage(w, w.name, "/gone.html");
  assert.deepEqual(snapshot(w.state), before);
  assert.equal(w.helper.sites.byRoot(elsewhere, "folder"), null);
});

// --- methods ------------------------------------------------------------------

test("a site answers GET and HEAD only", async (t) => {
  const w = await folderWorld(t);
  const head = await raw(w.helper.pagesPort, { method: "HEAD", path: "/page.html", headers: { host: siteHost(w, w.name) } });
  assert.equal(head.status, 200);
  assert.equal(head.text, "");
  const post = await raw(w.helper.pagesPort, { method: "POST", path: "/page.html", headers: { host: siteHost(w, w.name) }, body: "{}" });
  assert.equal(post.status, 405);
});
