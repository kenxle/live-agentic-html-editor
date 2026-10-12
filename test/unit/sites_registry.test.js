// The name registry for stable addresses (src/service/sites.js).
//
// Plan rows: V1 (name rule), V2 (clash), V3 (reserved), V4 (registry loss),
// V5 (worktree record), V66 (bind target). The registry is the helper's only:
// these tests drive the module directly against a temp state folder and a
// temp home, never the real ones.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const sites = require("../../src/service/sites.js");

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function mkdirs(base, rel) {
  const full = path.join(base, rel);
  fs.mkdirSync(full, { recursive: true });
  return full;
}

function world() {
  const home = tempDir("lahe-sites-home-");
  const state = tempDir("lahe-sites-state-");
  return { home, state };
}

function registry(w, extra) {
  return sites.createSites(Object.assign({ dir: w.state, home: w.home }, extra || {}));
}

// --- V1: the name rule ------------------------------------------------------

test("V1: a folder and its two parents become lowercase labels in path order, joined by dots", () => {
  const w = world();
  const root = mkdirs(w.home, "Documents/workspace/live-agentic-html-editor/docs/ongoing");
  assert.equal(sites.nameFor(root, { home: w.home }), "live-agentic-html-editor.docs.ongoing");
});

test("V1: runs of other characters inside a folder name become one dash", () => {
  const w = world();
  const root = mkdirs(w.home, "repo/docs/features/20261011.02_stable_addresses");
  assert.equal(sites.nameFor(root, { home: w.home }), "docs.features.20261011-02-stable-addresses");
  const odd = mkdirs(w.home, "A  B/__C__/My Notes!!");
  assert.equal(sites.nameFor(odd, { home: w.home }), "a-b.c.my-notes");
});

test("V1: the home folder and anything above it are never part of a name", () => {
  const w = world();
  const root = mkdirs(w.home, "notes");
  assert.equal(sites.nameFor(root, { home: w.home }), "notes");
  const two = mkdirs(w.home, "a/b");
  assert.equal(sites.nameFor(two, { home: w.home }), "a.b");
});

test("V1: a name with nothing left becomes doc", () => {
  const w = world();
  assert.equal(sites.nameFor(w.home, { home: w.home }), "doc");
  const punct = mkdirs(w.home, "___");
  assert.equal(sites.nameFor(punct, { home: w.home }), "doc");
});

test("V1: each label is at most 63 characters", () => {
  const w = world();
  const long = "x".repeat(80);
  const root = mkdirs(w.home, "a/" + long);
  const name = sites.nameFor(root, { home: w.home });
  name.split(".").forEach((label) => assert.ok(label.length <= 63, label));
  assert.equal(name, "a." + "x".repeat(63));
});

test("V1: a name over 150 characters drops the outermost parent first", () => {
  const w = world();
  const sixty = (c) => c.repeat(60);
  const root = mkdirs(w.home, sixty("a") + "/" + sixty("b") + "/" + sixty("c"));
  const name = sites.nameFor(root, { home: w.home });
  assert.equal(name, sixty("b") + "." + sixty("c"));
  assert.ok(name.length <= 150);
});

test("V1: xn-- and -- in positions 3 and 4 never reach a label", () => {
  assert.equal(sites.labelFor("xn--abc"), "xn-abc");
  assert.equal(sites.labelFor("ab--cd"), "ab-cd");
  assert.equal(sites.isLabel("xn--abc"), false);
  assert.equal(sites.isLabel("ab--cd"), false);
  assert.equal(sites.isLabel("-ab"), false);
  assert.equal(sites.isLabel("ab-"), false);
  assert.equal(sites.isLabel("ab-cd"), true);
});

test("V1: a notes page is named for the folder it sits in", () => {
  const w = world();
  const folder = mkdirs(w.home, "x/y/notes");
  const file = path.join(folder, "today.md");
  fs.writeFileSync(file, "# hi\n");
  assert.equal(sites.nameFor(file, { home: w.home, mode: "page-only" }), "x.y.notes");
});

// --- V2: clash --------------------------------------------------------------

test("V2: a second folder with the same name takes one more parent, then a number", () => {
  const w = world();
  const reg = registry(w);
  reg.load();
  const first = mkdirs(w.home, "one/repo/docs/ongoing");
  const second = mkdirs(w.home, "two/repo/docs/ongoing");
  assert.equal(reg.bind({ root: first, mode: "folder", entry: "a.html" }).name, "repo.docs.ongoing");
  assert.equal(reg.bind({ root: second, mode: "folder", entry: "a.html" }).name, "two.repo.docs.ongoing");
  // A third root whose four-label name is also taken gets a number.
  const clash = mkdirs(w.home, "deep/two/repo/docs/ongoing");
  assert.equal(reg.bind({ root: clash, mode: "folder", entry: "a.html" }).name, "two.repo.docs.ongoing-2");
});

test("V2: a folder keeps its name, and a name is never reused for another root", () => {
  const w = world();
  const reg = registry(w);
  reg.load();
  const first = mkdirs(w.home, "p/q/r");
  const named = reg.bind({ root: first, mode: "folder", entry: "a.html" }).name;
  assert.equal(reg.bind({ root: first, mode: "folder", entry: "b.html" }).name, named);
  // The folder is gone; another folder of the same name still does not get it.
  fs.rmdirSync(first);
  const again = mkdirs(w.home, "z/p/q/r");
  assert.notEqual(reg.bind({ root: again, mode: "folder", entry: "a.html" }).name, named);
});

// --- V3: reserved -----------------------------------------------------------

test("V3: library, lahe, www and api are never granted", () => {
  const w = world();
  const reg = registry(w);
  reg.load();
  for (const word of ["library", "lahe", "www", "api"]) {
    const root = mkdirs(w.home, "top-" + word + "/" + word);
    fs.mkdirSync(root, { recursive: true });
  }
  for (const word of ["library", "lahe", "www", "api"]) {
    const bare = mkdirs(w.home, word);
    const name = reg.bind({ root: bare, mode: "folder", entry: "a.html" }).name;
    assert.notEqual(name, word);
    assert.ok(!sites.RESERVED.includes(name), name);
  }
});

// --- V4: registry loss ------------------------------------------------------

test("V4: a corrupt sites.json rebuilds from sites.log with the same names", () => {
  const w = world();
  const reg = registry(w);
  reg.load();
  const a = mkdirs(w.home, "r1/docs/a");
  const b = mkdirs(w.home, "r2/docs/a");
  const nameA = reg.bind({ root: a, mode: "folder", entry: "x.html" }).name;
  const nameB = reg.bind({ root: b, mode: "folder", entry: "x.html" }).name;
  fs.writeFileSync(sites.jsonPath(w.state), "{not json");
  const again = registry(w);
  again.load();
  assert.equal(again.readOnly(), false);
  assert.equal(again.byRoot(a, "folder").name, nameA);
  assert.equal(again.byRoot(b, "folder").name, nameB);
  // And the rebuilt file is written back.
  assert.ok(JSON.parse(fs.readFileSync(sites.jsonPath(w.state), "utf8")).sites[nameA]);
});

test("V4: a missing sites.json rebuilds from sites.log", () => {
  const w = world();
  const reg = registry(w);
  reg.load();
  const a = mkdirs(w.home, "r1/docs/a");
  const nameA = reg.bind({ root: a, mode: "folder", entry: "x.html" }).name;
  fs.renameSync(sites.jsonPath(w.state), sites.jsonPath(w.state) + ".moved");
  const again = registry(w);
  again.load();
  assert.equal(again.get(nameA).root, a);
});

test("V4: with neither file readable, no new name is minted", () => {
  const w = world();
  const reg = registry(w);
  reg.load();
  const a = mkdirs(w.home, "r1/docs/a");
  reg.bind({ root: a, mode: "folder", entry: "x.html" });
  fs.writeFileSync(sites.jsonPath(w.state), "{not json");
  fs.writeFileSync(sites.logPath(w.state), "garbage\nmore garbage\n");
  const again = registry(w);
  again.load();
  assert.equal(again.readOnly(), true);
  const b = mkdirs(w.home, "r9/docs/b");
  assert.throws(() => again.bind({ root: b, mode: "folder", entry: "x.html" }), /registry/);
  assert.equal(fs.readFileSync(sites.jsonPath(w.state), "utf8"), "{not json");
});

test("V4: sites.json is owner-only", () => {
  const w = world();
  const reg = registry(w);
  reg.load();
  reg.bind({ root: mkdirs(w.home, "m/n/o"), mode: "folder", entry: "x.html" });
  assert.equal(fs.statSync(sites.jsonPath(w.state)).mode & 0o777, 0o600);
  assert.equal(fs.statSync(sites.logPath(w.state)).mode & 0o777, 0o600);
});

// --- V5: worktree record ----------------------------------------------------

test("V5: binding inside a sibling worktree records main_checkout from its .git file", () => {
  const w = world();
  const main = mkdirs(w.home, "ws/repo");
  mkdirs(main, ".git/worktrees/feature");
  const worktree = mkdirs(w.home, "ws/repo-worktrees/feature");
  fs.writeFileSync(path.join(worktree, ".git"), "gitdir: " + path.join(main, ".git", "worktrees", "feature") + "\n");
  // git's back-link from the main checkout to the worktree.
  fs.writeFileSync(path.join(main, ".git", "worktrees", "feature", "gitdir"), path.join(worktree, ".git") + "\n");
  const root = mkdirs(worktree, "docs/ongoing");
  const reg = registry(w);
  reg.load();
  const bound = reg.bind({ root, mode: "folder", entry: "a.md" });
  assert.equal(bound.site.main_checkout, main);
  assert.equal(bound.site.worktree_root, worktree);
});

// Security review S5: the .git file is folder content, so it alone cannot
// name the main checkout the read-only fallback reads from. git's back-link
// in the main checkout has to point at this worktree too.
test("V5: a .git file whose main checkout does not link back records no main_checkout", () => {
  const w = world();
  const main = mkdirs(w.home, "ws/victim");
  mkdirs(main, ".git/worktrees/feature");
  const other = mkdirs(w.home, "ws/somewhere-else");
  fs.writeFileSync(path.join(main, ".git", "worktrees", "feature", "gitdir"), path.join(other, ".git") + "\n");
  const forged = mkdirs(w.home, "ws/forged");
  fs.writeFileSync(path.join(forged, ".git"), "gitdir: " + path.join(main, ".git", "worktrees", "feature") + "\n");
  const noBackLink = mkdirs(w.home, "ws/no-back-link");
  fs.writeFileSync(path.join(noBackLink, ".git"), "gitdir: " + path.join(w.home, "ws", "nowhere", ".git", "worktrees", "x") + "\n");
  const reg = registry(w);
  reg.load();
  for (const root of [mkdirs(forged, "docs"), mkdirs(noBackLink, "docs")]) {
    const bound = reg.bind({ root, mode: "folder", entry: "a.md" });
    assert.equal(bound.site.main_checkout, null, root);
    assert.equal(bound.site.worktree_root, null, root);
  }
});

test("V5: an ordinary checkout records no main_checkout", () => {
  const w = world();
  const repo = mkdirs(w.home, "ws/plain");
  mkdirs(repo, ".git");
  const root = mkdirs(repo, "docs");
  const reg = registry(w);
  reg.load();
  const bound = reg.bind({ root, mode: "folder", entry: "a.md" });
  assert.equal(bound.site.main_checkout, null);
  assert.equal(bound.site.worktree_root, null);
});

// --- V66: bind target -------------------------------------------------------

test("V66: the filesystem root, the state folder, and anything inside it are refused", () => {
  const w = world();
  assert.match(sites.rootProblem(path.parse(w.home).root, "folder", w.state), /filesystem root/);
  assert.match(sites.rootProblem(w.state, "folder", w.state), /state folder/);
  const inside = mkdirs(w.state, "reviews/x");
  assert.match(sites.rootProblem(inside, "folder", w.state), /state folder/);
});

test("V66: a folder site must be a folder, and a notes site must be a file", () => {
  const w = world();
  const file = path.join(mkdirs(w.home, "f"), "page.html");
  fs.writeFileSync(file, "<p>x</p>");
  assert.match(sites.rootProblem(file, "folder", w.state), /not a folder/);
  assert.match(sites.rootProblem(path.dirname(file), "page-only", w.state), /not a file/);
  assert.equal(sites.rootProblem(path.dirname(file), "folder", w.state), null);
  assert.equal(sites.rootProblem(file, "page-only", w.state), null);
  assert.match(sites.rootProblem(path.join(w.home, "missing"), "folder", w.state), /not there/);
});
