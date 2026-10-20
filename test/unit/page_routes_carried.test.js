// The page-server behaviors that stay, carried over to the helper's own page
// serving (stable addresses Step 3). Their page-server versions are in the
// retired test/retired/unit/static_servers.test.js.
//
// Each test serves a site from an in-process helper on free ports and a temp
// state folder, and closes it in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const scriptLine = require("../../src/shared/script_line.js");
const pageRoutes = require("../../src/service/page_routes.js");
const markdown = require("../../src/service/markdown.js");
const { sitesWorld, writeFile, getPage } = require("../helpers/sites_world.js");

const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>words</p></body></html>";

async function site(t, files, entry) {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  Object.keys(files).forEach((rel) => writeFile(folder, rel, files[rel]));
  const bound = w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: entry || Object.keys(files)[0] });
  return Object.assign(w, { folder: fs.realpathSync(folder), name: bound.name });
}

function review(w, spec) {
  return w.helper.reviews.create(Object.assign({ agent_session_id: "s1", origins: ["null"] }, spec));
}

function reviewIn(html) {
  const found = /data-lahe-review="([^"]+)"/.exec(html);
  return found ? found[1] : null;
}

test("a file that already carries this review's tag is served with exactly one, not two", async (t) => {
  const w = await site(t, { "page.html": PAGE });
  const r = review(w, { target_path: path.join(w.folder, "page.html") });
  const tag = protocol.scriptTag({ src: "/x.js", review: r.id, token: r.token });
  fs.writeFileSync(path.join(w.folder, "page.html"), scriptLine.placeScriptLine(PAGE, tag).html);
  const res = await getPage(w, w.name, "/page.html");
  assert.equal((res.text.match(/data-lahe-review=/g) || []).length, 1);
});

test("a page carrying another review's tag on disk is served as it is", async (t) => {
  const w = await site(t, { "page.html": PAGE });
  review(w, { target_path: path.join(w.folder, "page.html") });
  const tag = protocol.scriptTag({ src: "/x.js", review: "someone-else", token: "t" });
  fs.writeFileSync(path.join(w.folder, "page.html"), scriptLine.placeScriptLine(PAGE, tag).html);
  const res = await getPage(w, w.name, "/page.html");
  assert.equal(reviewIn(res.text), "someone-else");
  assert.equal((res.text.match(/data-lahe-review=/g) || []).length, 1);
});

test("a served page with no tab icon of its own gets the fallback, and one that has an icon keeps it", async (t) => {
  const w = await site(t, {
    "plain.html": PAGE,
    "icon.html": "<!doctype html><html><head><link rel=\"icon\" href=\"/mine.png\"></head><body>x</body></html>"
  });
  review(w, { target_path: w.folder });
  assert.match((await getPage(w, w.name, "/plain.html")).text, /rel="icon"/);
  const own = await getPage(w, w.name, "/icon.html");
  assert.equal((own.text.match(/rel="icon"/g) || []).length, 1);
  assert.match(own.text, /\/mine\.png/);
});

test("the injected tag loads the library from the page's own address and keeps the helper as the fallback", async (t) => {
  const w = await site(t, { "page.html": PAGE });
  review(w, { target_path: path.join(w.folder, "page.html") });
  const html = (await getPage(w, w.name, "/page.html")).text;
  assert.match(html, new RegExp('src="' + pageRoutes.LIBRARY_PATH.replace(/\./g, "\\.") + '"'));
  assert.match(html, new RegExp('data-lahe-helper="http://127\\.0\\.0\\.1:' + w.helper.port + '"'));
  assert.match(html, new RegExp('data-lahe-fallback="http://127\\.0\\.0\\.1:' + w.helper.port + '/lahe-layer\\.js"'));
});

test("a folder review puts its line on a page nobody recorded, and writes nothing to do it", async (t) => {
  const w = await site(t, { "index.html": PAGE, "later.html": PAGE });
  const r = review(w, { target_path: w.folder });
  const res = await getPage(w, w.name, "/later.html");
  assert.equal(reviewIn(res.text), r.id);
  assert.equal(fs.readFileSync(path.join(w.folder, "later.html"), "utf8"), PAGE);
});

test("a single-page review's folder follows the reviewer: a sibling carries the rail too", async (t) => {
  const w = await site(t, { "a.html": PAGE, "b.html": PAGE });
  const r = review(w, { target_path: path.join(w.folder, "a.html") });
  assert.equal(reviewIn((await getPage(w, w.name, "/b.html")).text), r.id);
});

test("a nested folder's review never answers for the outer folder's pages", async (t) => {
  const w = await site(t, { "index.html": PAGE, "inner/page.html": PAGE });
  const outer = review(w, { target_path: w.folder });
  review(w, { target_path: path.join(w.folder, "inner") });
  assert.equal(reviewIn((await getPage(w, w.name, "/index.html")).text), outer.id);
});

test("a page recorded on its own keeps its own review while the folder review takes the rest", async (t) => {
  const w = await site(t, { "index.html": PAGE, "own.html": PAGE });
  const own = review(w, { target_path: path.join(w.folder, "own.html") });
  const folder = review(w, { target_path: w.folder });
  assert.equal(reviewIn((await getPage(w, w.name, "/own.html")).text), own.id);
  assert.equal(reviewIn((await getPage(w, w.name, "/index.html")).text), folder.id);
});

test("a mount refuses a symlink that resolves outside it", async (t) => {
  const w = await sitesWorld(t);
  const folder = fs.realpathSync(path.dirname(writeFile(path.join(w.home, "a", "b", "c"), "doc.html", PAGE)));
  const mounted = path.join(w.home, "mounted");
  writeFile(mounted, "ok.html", PAGE);
  writeFile(w.home, "outside/secret.html", "<p>secret</p>");
  fs.symlinkSync(path.join(w.home, "outside", "secret.html"), path.join(mounted, "link.html"));
  const prefix = "/.lahe-source/00aa11bb22cc33dd/";
  const bound = w.helper.sites.bind({ root: folder, mode: "folder", entry: "doc.html", mounts: { [prefix]: fs.realpathSync(mounted) } });
  // The link's target is listed on purpose, so it is the real-path check that refuses it.
  w.helper.sites.addMountFiles(bound.name, [path.join(fs.realpathSync(mounted), "ok.html"), path.join(fs.realpathSync(path.join(w.home, "outside")), "secret.html")]);
  assert.equal((await getPage(w, bound.name, prefix + "ok.html")).status, 200);
  const res = await getPage(w, bound.name, prefix + "link.html");
  assert.equal(res.status, 404);
  assert.doesNotMatch(res.text, /secret/);
});

test("a mount still serves the document stylesheet and its fonts", async (t) => {
  const w = await sitesWorld(t);
  const folder = fs.realpathSync(path.dirname(writeFile(path.join(w.home, "a", "b", "c"), "doc.html", PAGE)));
  const mounted = fs.realpathSync(path.dirname(writeFile(w.home, "mounted/x.html", PAGE)));
  const prefix = "/.lahe-source/00aa11bb22cc33dd/";
  const bound = w.helper.sites.bind({ root: folder, mode: "folder", entry: "doc.html", mounts: { [prefix]: mounted } });
  const css = await getPage(w, bound.name, prefix + markdown.DOC_STYLE_ASSET);
  assert.equal(css.status, 200);
  assert.match(css.headers["content-type"], /text\/css/);
  const font = await getPage(w, bound.name, prefix + markdown.FONT_ASSET_DIR + "/" + markdown.FONT_ASSETS[0]);
  assert.equal(font.status, 200);
  assert.equal(font.headers["content-type"], "font/woff2");
});
