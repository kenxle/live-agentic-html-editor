// Hidden files get no special handling: they are served and linked like any
// other file (Ken's rule, commit dd710f5 on main). Worktrees usually live in a
// hidden folder (repo/.claude/worktrees/<name>/), so refusing hidden segments
// broke every document in a worktree.
//
// What still bounds a request: the home folder for a mount, real-path
// containment for the site root and every mount, the state folder, decodePath
// (dot segments, encoded slashes, NUL), and Lahe's own reserved names.
//
// Each test serves from an in-process helper on free ports and a temp state
// folder, closed in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const markdownLinks = require("../../src/service/markdown_links.js");
const { sitesWorld, writeFile, getPage } = require("../helpers/sites_world.js");

function bindReview(w, folder, entry, source) {
  const real = fs.realpathSync.native(folder);
  const bound = w.helper.sites.bind({ root: real, mode: "folder", entry });
  if (source) {
    w.helper.reviews.create({ target_path: path.join(w.state, "artifact.html"), source_path: source, agent_session_id: "s1", origins: ["null"] });
  }
  return bound;
}

test("a Markdown review of a file in a worktree under .claude serves, and its links to sibling files work", async (t) => {
  const w = await sitesWorld(t);
  const docs = path.join(w.home, "ws", "repo", ".claude", "worktrees", "x", "docs");
  const doc = writeFile(docs, "brief.md", "# Brief\n\nSee [the plan](plan.md) and [notes](../notes/n.md).\n");
  writeFile(docs, "plan.md", "# Plan\n\nThe plan words.\n");
  writeFile(path.join(docs, "..", "notes"), "n.md", "# Notes\n\nThe notes words.\n");
  const bound = bindReview(w, docs, "brief.md", doc);
  const page = await getPage(w, bound.name, "/brief.md");
  assert.equal(page.status, 200);
  assert.match(page.text, /data-lahe-review="/);
  const plan = await getPage(w, bound.name, "/plan.md");
  assert.equal(plan.status, 200);
  assert.match(plan.text, /The plan words/);
  const mount = /href="(\/\.lahe-source\/[a-f0-9]+\/)n\.md"/.exec(page.text);
  assert.ok(mount, "the link out of the folder is a mount");
  const notes = await getPage(w, bound.name, mount[1] + "n.md");
  assert.equal(notes.status, 200);
  assert.match(notes.text, /The notes words/);
});

test("a link into a hidden folder under home is translated and served", async (t) => {
  const w = await sitesWorld(t);
  const prior = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = w.home;
  t.after(() => { if (prior === undefined) delete process.env.LAHE_HOME_DIR; else process.env.LAHE_HOME_DIR = prior; });
  writeFile(w.home, ".config/notes/x.md", "# Hidden notes\n\nThe hidden words.\n");
  const docs = path.join(w.home, "ws", "repo", "docs");
  const doc = writeFile(docs, "doc.md", "# Doc\n\n[x](../../../.config/notes/x.md)\n");
  assert.equal(markdownLinks.mountableDir(path.join(w.home, ".config", "notes")), true);
  assert.equal(markdownLinks.classify("../../../.config/notes/x.md", docs, markdownLinks.createRegistry()).kind, "translate");
  const bound = bindReview(w, docs, "doc.md", doc);
  const page = await getPage(w, bound.name, "/doc.md");
  const mount = /href="(\/\.lahe-source\/[a-f0-9]+\/)x\.md"/.exec(page.text);
  assert.ok(mount, "the hidden link is translated");
  const res = await getPage(w, bound.name, mount[1] + "x.md");
  assert.equal(res.status, 200);
  assert.match(res.text, /The hidden words/);
});

test("a hidden file under the site root is served, and so is one under a mount", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  writeFile(folder, "page.html", "<p>page</p>");
  writeFile(folder, ".env", "VISIBLE=1");
  writeFile(folder, "sub/.hidden.html", "<p>hidden page</p>");
  const other = path.join(w.home, "elsewhere");
  writeFile(other, ".notes.txt", "mounted hidden");
  const prefix = "/.lahe-source/0123456789abcdef/";
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(folder), mode: "folder", entry: "page.html", mounts: { [prefix]: fs.realpathSync.native(other) } });
  for (const [p, words] of [["/.env", /VISIBLE=1/], ["/%2Eenv", /VISIBLE=1/], ["/sub/.hidden.html", /hidden page/], [prefix + ".notes.txt", /mounted hidden/]]) {
    const res = await getPage(w, bound.name, p);
    assert.equal(res.status, 200, p);
    assert.match(res.text, words, p);
  }
});

test("Lahe's reserved names still answer as before, and dot segments and encoded slashes are still refused", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  writeFile(folder, "page.html", "<p>page</p>");
  // Copies a folder might hold under the reserved names: never served from disk.
  writeFile(folder, ".lahe-doc-style.css", "FROM THE FOLDER");
  writeFile(folder, ".lahe-library/lahe-layer.js", "FROM THE FOLDER");
  writeFile(folder, ".lahe-source/0000000000000000/x.html", "FROM THE FOLDER");
  writeFile(w.home, "ws/repo/outside.html", "<p>outside</p>");
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(folder), mode: "folder", entry: "page.html" });
  const css = await getPage(w, bound.name, "/.lahe-doc-style.css");
  assert.equal(css.status, 200);
  assert.doesNotMatch(css.text, /FROM THE FOLDER/);
  const lib = await getPage(w, bound.name, "/.lahe-library/lahe-layer.js");
  assert.equal(lib.status, 200);
  assert.doesNotMatch(lib.text, /FROM THE FOLDER/);
  assert.equal((await getPage(w, bound.name, "/.lahe-fonts/hanken-grotesk-variable.woff2")).status, 200);
  for (const p of [
    "/.lahe-source/0000000000000000/x.html",
    "/%2Elahe-source/0000000000000000/x.html",
    "/../outside.html",
    "/%2e%2e/outside.html",
    "/..%2foutside.html",
    "/sub%5c..%5coutside.html"
  ]) {
    const res = await getPage(w, bound.name, p);
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.text, /FROM THE FOLDER|outside/, p);
  }
});

test("a symlink out of a mount is still refused", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  writeFile(folder, "page.html", "<p>page</p>");
  const other = path.join(w.home, "elsewhere");
  writeFile(other, "ok.html", "<p>ok</p>");
  const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-outside-")));
  writeFile(outside, "secret.html", "<p>OUTSIDE SECRET</p>");
  fs.symlinkSync(path.join(outside, "secret.html"), path.join(other, ".escape.html"));
  const prefix = "/.lahe-source/0123456789abcdef/";
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(folder), mode: "folder", entry: "page.html", mounts: { [prefix]: fs.realpathSync.native(other) } });
  assert.equal((await getPage(w, bound.name, prefix + "ok.html")).status, 200);
  const res = await getPage(w, bound.name, prefix + ".escape.html");
  assert.equal(res.status, 404);
  assert.doesNotMatch(res.text, /OUTSIDE SECRET/);
});

// Every page a site serves may be framed by its own site only. A reveal.js
// speaker-notes window frames the same deck, which is same-origin; any other
// page framing a reviewed page (and its token) is refused by the browser.
test("served pages carry frame-ancestors 'self'", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  writeFile(folder, "page.html", "<p>page</p>");
  writeFile(folder, "doc.md", "# Doc\n");
  writeFile(folder, "img.png", "PNG");
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(folder), mode: "folder", entry: "page.html" });
  for (const p of ["/page.html", "/doc.md", "/img.png", "/nothing-here.html"]) {
    const res = await getPage(w, bound.name, p);
    assert.match(String(res.headers["content-security-policy"] || ""), /frame-ancestors 'self'/, p);
  }
});

// LAHE-csv-served-as-download: a link to a CSV on a served page showed nothing
// and dropped a file into Downloads, because .csv had no type and fell back to
// application/octet-stream.
test("a CSV or TSV is served as plain text, so the browser shows it", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "runs");
  writeFile(folder, "page.html", "<p>page</p>");
  writeFile(folder, "run.csv", "a,b\n1,2\n");
  writeFile(folder, "run.tsv", "a\tb\n1\t2\n");
  const bound = bindReview(w, folder, "page.html");
  for (const [file, body] of [["/run.csv", "a,b\n1,2\n"], ["/run.tsv", "a\tb\n1\t2\n"]]) {
    const res = await getPage(w, bound.name, file);
    assert.equal(res.status, 200, file);
    assert.equal(res.headers["content-type"], "text/plain; charset=utf-8", file);
    assert.equal(res.headers["content-disposition"], undefined, file + " carries no attachment header");
    assert.equal(res.text, body);
  }
});
