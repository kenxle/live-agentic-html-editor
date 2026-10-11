// A Markdown link like ../../.ssh/id_rsa used to mount ~/.ssh, and the site
// then served every file in it at /.lahe-source/<hex>/...; raw HTML in the
// Markdown could fetch it. Mounts are saved in the registry and served all
// day. A mount whose real folder has a hidden segment below home is now
// refused in three places: when a link makes it, when the registry takes it,
// and at serve time (which neuters a mount already in sites.json).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const markdownLinks = require("../../src/service/markdown_links.js");
const sitesModule = require("../../src/service/sites.js");
const { sitesWorld, writeFile, getPage } = require("../helpers/sites_world.js");

function withHome(t, home) {
  const prior = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  t.after(() => {
    if (prior === undefined) delete process.env.LAHE_HOME_DIR;
    else process.env.LAHE_HOME_DIR = prior;
  });
}

test("a link into a hidden folder below home is inert, not a mount", async (t) => {
  const w = await sitesWorld(t);
  withHome(t, w.home);
  writeFile(w.home, ".ssh/id_rsa", "PRIVATE KEY");
  writeFile(w.home, "ws/.config/notes.md", "# hidden\n");
  writeFile(w.home, "ws/shared/ok.md", "# fine\n");
  const docDir = path.join(w.home, "ws", "repo");
  fs.mkdirSync(docDir, { recursive: true });
  const registry = markdownLinks.createRegistry();
  assert.equal(markdownLinks.classify("../../.ssh/id_rsa", docDir, registry).kind, "inert");
  assert.equal(markdownLinks.classify("../.config/notes.md", docDir, registry).kind, "inert");
  assert.equal(markdownLinks.classify("../shared/ok.md", docDir, registry).kind, "translate");
  assert.equal(markdownLinks.mountableDir(path.join(w.home, ".ssh")), false);
  assert.equal(markdownLinks.mountableDir(path.join(w.home, "ws", "shared")), true);
});

test("the registry drops a mount of a hidden folder", async (t) => {
  const w = await sitesWorld(t);
  withHome(t, w.home);
  writeFile(w.home, ".ssh/id_rsa", "PRIVATE KEY");
  writeFile(w.home, "ws/shared/ok.md", "# fine\n");
  const clean = sitesModule.cleanMounts({
    "/.lahe-source/aaaaaaaaaaaaaaaa/": path.join(w.home, ".ssh"),
    "/.lahe-source/bbbbbbbbbbbbbbbb/": path.join(w.home, "ws", "shared")
  });
  assert.deepEqual(Object.keys(clean), ["/.lahe-source/bbbbbbbbbbbbbbbb/"]);
});

test("a hidden-folder mount already in sites.json serves nothing", async (t) => {
  const w = await sitesWorld(t);
  withHome(t, w.home);
  writeFile(w.home, ".ssh/id_rsa", "PRIVATE KEY");
  const folder = path.join(w.home, "ws", "repo");
  writeFile(folder, "page.md", "# p\n");
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(folder), mode: "folder", entry: "page.md" });
  // As an older helper would have saved it: put straight into the entry.
  const site = w.helper.sites.get(bound.name);
  site.mounts = Object.assign({}, site.mounts, { "/.lahe-source/cccccccccccccccc/": fs.realpathSync.native(path.join(w.home, ".ssh")) });
  const res = await getPage(w, bound.name, "/.lahe-source/cccccccccccccccc/id_rsa");
  assert.equal(res.status, 404);
  assert.doesNotMatch(res.text, /PRIVATE KEY/);
});
