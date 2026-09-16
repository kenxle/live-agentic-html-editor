// A folder of HTML pages is a static site, not somebody's dev server.
//
// WHY THIS EXISTS. `lahe review <folder>` used to fall into the app-in-dev row
// every time, because a directory was classified as a dev server and nothing
// else. That row prints a script line for you to paste into the app's shared
// layout, and a set of wireframes has no shared layout: there is nowhere to
// paste it. The reviewer got a snippet instead of a URL, and the agent enrolled
// the pages one at a time to work around it.
//
// Two decisions live here, and both are cheap to get wrong:
//
//   1. WHICH DIRECTORIES ARE OURS. A directory holding at least one .html file
//      of its own is a static site we serve. A directory with no HTML in it is
//      still the dev-server row, because that is what pointing at a project
//      checkout means.
//   2. WHICH PAGE THE LINK OPENS. index.html when there is one, else the first
//      page in name order, so two runs on the same folder hand the reviewer the
//      same URL.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const add = require("../../src/cli/commands/add.js");
const review = require("../../src/cli/commands/review.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function write(dir, name, body) {
  var file = path.join(dir, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body === undefined ? "<!doctype html><p>page</p>\n" : body);
  return file;
}

test("a directory holding HTML is a static site; one with no HTML is still a dev server", () => {
  const site = tempDir("lahe-classify-site-");
  write(site, "index.html");
  write(site, "plan.html");
  assert.equal(add.classify(site), "static-folder");

  const project = tempDir("lahe-classify-project-");
  write(project, "package.json", "{}\n");
  write(project, "README.md", "# a project\n");
  assert.equal(add.classify(project), "dev-server", "a project checkout is the app-in-dev row, as it always was");

  // HTML buried in a subfolder does not make the folder a static site. The rule
  // is the folder's OWN pages, so the open link and the served root agree.
  const nested = tempDir("lahe-classify-nested-");
  write(nested, path.join("pages", "deep.html"));
  assert.equal(add.classify(nested), "dev-server");

  const page = path.join(site, "index.html");
  assert.equal(add.classify(page), "static", "a single HTML file is unchanged");
  assert.equal(add.classify(path.join(project, "package.json")), "dev-server");
});

test("the open link is index.html when there is one, else the first page in name order", () => {
  const withIndex = tempDir("lahe-entry-index-");
  write(withIndex, "zebra.html");
  write(withIndex, "index.html");
  write(withIndex, "about.html");
  assert.equal(add.folderEntryPage(withIndex), "index.html");

  const withoutIndex = tempDir("lahe-entry-first-");
  write(withoutIndex, "zebra.html");
  write(withoutIndex, "about.html");
  write(withoutIndex, "notes.txt", "not a page\n");
  assert.equal(add.folderEntryPage(withoutIndex), "about.html");

  const oldSchool = tempDir("lahe-entry-htm-");
  write(oldSchool, "zebra.html");
  write(oldSchool, "index.htm");
  assert.equal(add.folderEntryPage(oldSchool), "index.htm");

  const empty = tempDir("lahe-entry-empty-");
  write(empty, "notes.txt", "not a page\n");
  assert.equal(add.folderEntryPage(empty), null);
});

test("`lahe review` serves a folder of HTML itself, and hands a named origin back to its owner", () => {
  const site = tempDir("lahe-served-site-");
  write(site, "index.html");
  const page = path.join(site, "index.html");
  const project = tempDir("lahe-served-project-");
  write(project, "package.json", "{}\n");

  assert.equal(review.servedKind(site, { remove: false, origins: [] }), "folder");
  assert.equal(review.servedKind(page, { remove: false, origins: [] }), "file");
  assert.equal(
    review.servedKind(project, { remove: false, origins: [] }),
    null,
    "a directory with no pages of its own is the app-in-dev row"
  );
  assert.equal(
    review.servedKind(site, { remove: false, origins: ["http://localhost:3000"] }),
    null,
    "--origin means somebody else's server is serving these pages"
  );
  assert.equal(review.servedKind(site, { remove: true, origins: [] }), null);
  assert.equal(review.servedKind(path.join(site, "gone.html"), { remove: false, origins: [] }), null);
});
