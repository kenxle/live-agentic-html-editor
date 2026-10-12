// A mount serves every file in its folder for as long as the site lives, so
// the folder must be under the home folder by real path. That is checked in
// three places: when a link makes the mount, when the registry takes it, and
// at serve time (which neuters a mount in sites.json whose folder is outside
// home). Hidden folders under home get no special handling: a worktree
// usually lives in one, and its documents link to their neighbours.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const markdownLinks = require("../../src/service/markdown_links.js");
const sitesModule = require("../../src/service/sites.js");
const { sitesWorld, writeFile, getPage } = require("../helpers/sites_world.js");

function outsideHome() {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-outside-home-")));
}

test("a link to a file outside home is inert, and one into a hidden folder under home is a mount", async (t) => {
  const w = await sitesWorld(t);
  const outside = outsideHome();
  writeFile(outside, "x.md", "# outside\n");
  writeFile(w.home, ".config/notes.md", "# hidden but home\n");
  const docDir = path.join(w.home, "ws", "repo");
  fs.mkdirSync(docDir, { recursive: true });
  const registry = markdownLinks.createRegistry();
  assert.equal(markdownLinks.classify(path.join(outside, "x.md"), docDir, registry).kind, "inert");
  assert.equal(markdownLinks.classify("../../.config/notes.md", docDir, registry).kind, "translate");
  assert.equal(markdownLinks.mountableDir(outside), false);
  assert.equal(markdownLinks.mountableDir(path.join(w.home, ".config")), true);
});

test("the registry drops a mount of a folder outside home, and keeps a hidden folder under home", async (t) => {
  const w = await sitesWorld(t);
  const outside = outsideHome();
  writeFile(w.home, ".config/notes.md", "# n\n");
  const clean = sitesModule.cleanMounts({
    "/.lahe-source/aaaaaaaaaaaaaaaa/": outside,
    "/.lahe-source/bbbbbbbbbbbbbbbb/": path.join(w.home, ".config")
  });
  assert.deepEqual(Object.keys(clean), ["/.lahe-source/bbbbbbbbbbbbbbbb/"]);
});

test("a mount in sites.json whose folder is outside home serves nothing", async (t) => {
  const w = await sitesWorld(t);
  const outside = outsideHome();
  writeFile(outside, "secret.txt", "OUTSIDE HOME");
  const folder = path.join(w.home, "ws", "repo");
  writeFile(folder, "page.md", "# p\n");
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(folder), mode: "folder", entry: "page.md" });
  // As if written by hand or by an older helper: put straight into the entry.
  const site = w.helper.sites.get(bound.name);
  site.mounts = Object.assign({}, site.mounts, { "/.lahe-source/cccccccccccccccc/": outside });
  const res = await getPage(w, bound.name, "/.lahe-source/cccccccccccccccc/secret.txt");
  assert.equal(res.status, 404);
  assert.doesNotMatch(res.text, /OUTSIDE HOME/);
});
