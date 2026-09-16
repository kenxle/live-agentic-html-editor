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
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const routes = require("../../src/service/routes.js");
const stateDirModule = require("../../src/service/state_dir.js");

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

// ---------------------------------------------------------------------------
// --only: the review that keeps to the page it was given.
//
// The rail follows the reviewer by default, which is what a reviewer expects a
// review to do. The case that needs an answer is the folder nobody chose:
// `lahe review ~/Downloads/statement.html` roots a server at Downloads. The
// answer is a flag, not a narrower default.

test("--only parses on both commands and is off unless it is asked for", () => {
  const plain = add.parseArgs(["page.html"]);
  assert.equal(plain.ok, true);
  assert.equal(plain.options.only, false, "the rail follows the reviewer unless told otherwise");

  const isolated = add.parseArgs(["page.html", "--only"]);
  assert.equal(isolated.ok, true);
  assert.equal(isolated.options.only, true);

  assert.match(add.USAGE, /--only/, "a flag nobody can discover is a flag nobody uses");
});

test("--only is recorded on the review, and the review store is where it is read from", () => {
  const dir = path.join(tempDir("lahe-only-state-"), "state");
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });

  reviews.create({ id: "r_wide", origins: ["null"], target_path: "/tmp/one.html" });
  reviews.create({ id: "r_only", origins: ["null"], target_path: "/tmp/two.html", only_recorded_pages: true });

  const wide = JSON.parse(fs.readFileSync(stateDirModule.metaPath(dir, "r_wide"), "utf8"));
  const only = JSON.parse(fs.readFileSync(stateDirModule.metaPath(dir, "r_only"), "utf8"));
  assert.equal(wide.only_recorded_pages, false);
  assert.equal(only.only_recorded_pages, true);
});

test("a review can be narrowed to its own pages later, and never widened by anyone holding the token", () => {
  // The direction matters. Narrowing is the reviewer noticing what else is in
  // the folder. Widening is the one move a script that read the token off the
  // script tag would want to make, and review.write is reachable with exactly
  // that token, so this never goes the other way.
  const dir = path.join(tempDir("lahe-narrow-state-"), "state");
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  reviews.create({ id: "r_late", origins: ["null"], target_path: "/tmp/one.html" });

  reviews.isolate("r_late");
  assert.equal(reviews.get("r_late").only_recorded_pages, true);
  assert.equal(
    JSON.parse(fs.readFileSync(stateDirModule.metaPath(dir, "r_late"), "utf8")).only_recorded_pages,
    true,
    "written through to disk, which is the copy the static server reads"
  );

  const body = routes.handlerFor("review.write")(
    { review: "r_late", body: { origins: [], only_recorded_pages: false } },
    { log: log, reviews: reviews }
  );
  assert.equal(body.status, 200);
  assert.equal(reviews.get("r_late").only_recorded_pages, true, "the route cannot widen a review back out");

  routes.handlerFor("review.write")(
    { review: "r_wide_later", body: { origins: [] } },
    { log: log, reviews: reviews }
  );
  reviews.create({ id: "r_wide_later", origins: ["null"], target_path: "/tmp/three.html" });
  routes.handlerFor("review.write")(
    { review: "r_wide_later", body: { origins: [], only_recorded_pages: true } },
    { log: log, reviews: reviews }
  );
  assert.equal(reviews.get("r_wide_later").only_recorded_pages, true, "but it can narrow one");
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
