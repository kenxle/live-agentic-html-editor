// Linked documents and root Markdown pages at a stable address (stable
// addresses Step 3). Carried over from the retired linked_docs_rail.test.js
// and root_markdown_rail.test.js: the rail follows a link to a document in
// another folder, through a mount stored on the site, and a Markdown file in
// a reviewed folder carries the right rail. What changed: there are no
// redirects between pages, and the rule has no session filter.
//
// Each test serves from an in-process helper on free ports and a temp state
// folder, and closes it in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageRoutes = require("../../src/service/page_routes.js");
const { sitesWorld, writeFile, getPage } = require("../helpers/sites_world.js");

const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>words</p></body></html>";

function reviewIn(html) {
  const found = /data-lahe-review="([^"]+)"/.exec(html);
  return found ? found[1] : null;
}

/**
 * A hub Markdown page in ws/repo/notes that links to far.md, far.html and a
 * page beside them in ws/other, and a review of the hub.
 */
async function hubWorld(t, reviewSpec) {
  const w = await sitesWorld(t);
  const notes = path.join(w.home, "ws", "repo", "notes");
  const other = path.join(w.home, "ws", "other");
  writeFile(other, "far.md", "# Far\n\nSee [next](next.md).\n");
  writeFile(other, "next.md", "# Next\n");
  writeFile(other, "far.html", PAGE);
  writeFile(other, "unlinked.html", PAGE);
  writeFile(other, "data.json", "{}");
  const hub = writeFile(notes, "hub.md", "# Hub\n\n[far](../../other/far.md) and [html](../../other/far.html) and [data](../../other/data.json)\n");
  const bound = w.helper.sites.bind({ root: fs.realpathSync(notes), mode: "folder", entry: "hub.md" });
  const review = w.helper.reviews.create(Object.assign({
    target_path: path.join(w.state, "artifact-hub.html"),
    source_path: hub,
    agent_session_id: "s_hub",
    origins: ["null"]
  }, reviewSpec || {}));
  const page = await getPage(w, bound.name, "/hub.md");
  const mount = /href="(\/\.lahe-source\/[a-f0-9]+\/)far\.md"/.exec(page.text);
  assert.ok(mount, "the hub's link to far.md is a mount");
  return Object.assign(w, { name: bound.name, review, hub: page, mount: mount[1], other: fs.realpathSync(other), notes: fs.realpathSync(notes) });
}

test("a review whose page linked a file is recorded against that file on the site", async (t) => {
  const w = await hubWorld(t);
  const site = w.helper.sites.get(w.name);
  assert.deepEqual(site.linked_files[path.join(w.other, "far.md")], [w.review.id]);
  assert.deepEqual(site.linked_files[path.join(w.other, "far.html")], [w.review.id]);
  assert.equal(site.linked_files[path.join(w.other, "data.json")], undefined, "a data file is never a page");
});

test("a linked Markdown document with no review of its own carries the linking page's rail", async (t) => {
  const w = await hubWorld(t);
  const far = await getPage(w, w.name, w.mount + "far.md");
  assert.equal(far.status, 200);
  assert.equal(reviewIn(far.text), w.review.id);
});

test("a linked HTML document with no review of its own carries the linking page's rail", async (t) => {
  const w = await hubWorld(t);
  assert.equal(reviewIn((await getPage(w, w.name, w.mount + "far.html")).text), w.review.id);
});

test("an HTML file in a mounted folder that no page linked to is not served", async (t) => {
  const w = await hubWorld(t);
  const res = await getPage(w, w.name, w.mount + "unlinked.html");
  assert.equal(res.status, 404);
  assert.equal(reviewIn(res.text), null);
});

test("a linked Markdown page's own links ride the same review, one hop on", async (t) => {
  const w = await hubWorld(t);
  const far = await getPage(w, w.name, w.mount + "far.md");
  const next = /href="(\/\.lahe-source\/[a-f0-9]+\/next\.md)"/.exec(far.text) || /href="([^"]*next\.md)"/.exec(far.text);
  assert.ok(next, far.text.slice(0, 400));
  assert.equal(reviewIn((await getPage(w, w.name, next[1])).text), w.review.id);
});

test("a file linked from two reviewed pages keeps both, and the newest review answers", async (t) => {
  const w = await hubWorld(t);
  const later = w.helper.reviews.create({
    target_path: path.join(w.state, "artifact-hub-2.html"),
    source_path: path.join(w.notes, "hub.md"),
    agent_session_id: "s_other",
    origins: ["null"]
  });
  w.helper.reviews.stampServed(later.id, new Date(Date.now() + 60000).toISOString());
  await getPage(w, w.name, "/hub.md");
  const site = w.helper.sites.get(w.name);
  assert.deepEqual(site.linked_files[path.join(w.other, "far.md")].slice().sort(), [w.review.id, later.id].sort());
  assert.equal(reviewIn((await getPage(w, w.name, w.mount + "far.md")).text), later.id);
});

test("a linking review from another agent session still answers: the rule has no session filter", async (t) => {
  const w = await hubWorld(t, { agent_session_id: "s_someone_else" });
  assert.equal(reviewIn((await getPage(w, w.name, w.mount + "far.md")).text), w.review.id);
});

test("an --only linking review keeps its linked documents read-only", async (t) => {
  const w = await hubWorld(t, { only_recorded_pages: true });
  assert.equal(reviewIn((await getPage(w, w.name, w.mount + "far.md")).text), null);
});

test("a linked document whose linking review is gone is served read-only, and nothing is created", async (t) => {
  const w = await hubWorld(t);
  w.helper.sites.addLinked(w.name, "r-gone", [path.join(w.other, "unlinked.html")]);
  const before = fs.readdirSync(path.join(w.state, "reviews")).sort();
  assert.equal(reviewIn((await getPage(w, w.name, w.mount + "unlinked.html")).text), null);
  assert.deepEqual(fs.readdirSync(path.join(w.state, "reviews")).sort(), before);
});

test("a linked file that is not a page is never named as the file to edit", async (t) => {
  const w = await hubWorld(t);
  assert.equal(pageRoutes.linkedFileForPage(w.state, w.review.id, w.mount + "data.json"), null);
  assert.equal(pageRoutes.linkedFileForPage(w.state, w.review.id, w.mount + "far.md"), path.join(w.other, "far.md"));
});

// --- a root Markdown file -----------------------------------------------------

async function rootWorld(t) {
  const w = await sitesWorld(t);
  const root = path.join(w.home, "ws", "site", "pages");
  writeFile(root, "index.html", PAGE);
  const notes = writeFile(root, "notes.md", "# Notes\n\nSee [far](../../far/far.md).\n");
  writeFile(w.home, "ws/far/far.md", "# Far\n");
  const bound = w.helper.sites.bind({ root: fs.realpathSync(root), mode: "folder", entry: "index.html" });
  return Object.assign(w, { root: fs.realpathSync(root), notes, name: bound.name });
}

test("a root Markdown file with its own review carries that review, with no redirect", async (t) => {
  const w = await rootWorld(t);
  w.helper.reviews.create({ target_path: w.root, agent_session_id: "s1", origins: ["null"] });
  const own = w.helper.reviews.create({ target_path: path.join(w.state, "a.html"), source_path: w.notes, agent_session_id: "s1", origins: ["null"] });
  const res = await getPage(w, w.name, "/notes.md");
  assert.equal(res.status, 200);
  assert.equal(reviewIn(res.text), own.id);
});

test("a root Markdown file with no review of its own carries the root review's rail", async (t) => {
  const w = await rootWorld(t);
  const folder = w.helper.reviews.create({ target_path: w.root, agent_session_id: "s1", origins: ["null"] });
  assert.equal(reviewIn((await getPage(w, w.name, "/notes.md")).text), folder.id);
});

test("a root Markdown file with no review behind the root stays read-only", async (t) => {
  const w = await rootWorld(t);
  const res = await getPage(w, w.name, "/notes.md");
  assert.equal(reviewIn(res.text), null);
  assert.match(res.text, /lahe-readonly-note/);
});

test("a root Markdown file stays read-only when the only root review is --only", async (t) => {
  const w = await rootWorld(t);
  w.helper.reviews.create({ target_path: path.join(w.root, "index.html"), agent_session_id: "s1", origins: ["null"], only_recorded_pages: true });
  assert.equal(reviewIn((await getPage(w, w.name, "/notes.md")).text), null);
});

test("a root Markdown file passes its rail on to a document it links to outside the root", async (t) => {
  const w = await rootWorld(t);
  const folder = w.helper.reviews.create({ target_path: w.root, agent_session_id: "s1", origins: ["null"] });
  const notes = await getPage(w, w.name, "/notes.md");
  const link = /href="(\/\.lahe-source\/[a-f0-9]+\/far\.md)"/.exec(notes.text);
  assert.ok(link);
  assert.equal(reviewIn((await getPage(w, w.name, link[1])).text), folder.id);
});
