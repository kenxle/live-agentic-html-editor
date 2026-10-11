// Two kinds of real path were in use: fs.realpathSync keeps the case a path
// was given in, and fs.realpathSync.native returns the case on disk. Roots are
// made with .native (site.bind, the Library), so the state-folder check, made
// with the other kind, missed a state folder named in a different case on a
// case-insensitive disk (the macOS default). Everything now uses .native.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sitesModule = require("../../src/service/sites.js");
const { tempRoot, writeFile, sitesWorld, getPage } = require("../helpers/sites_world.js");

function caseInsensitive(dir) {
  return fs.existsSync(dir.toUpperCase()) || fs.existsSync(path.join(path.dirname(dir), path.basename(dir).toUpperCase()));
}

test("a root inside the state folder is refused when the state folder is named in another case", (t) => {
  const root = tempRoot("lahe-realpath-");
  const state = path.join(root, "State");
  fs.mkdirSync(path.join(state, "inside"), { recursive: true });
  if (!caseInsensitive(state)) return t.skip("this disk is case-sensitive");
  const inside = fs.realpathSync.native(path.join(state, "inside"));
  assert.match(String(sitesModule.rootProblem(inside, "folder", path.join(root, "state"))), /state folder is never served/);
});

test("the pages never serve a state folder named in another case", async (t) => {
  const w = await sitesWorld(t);
  if (!caseInsensitive(w.state)) return t.skip("this disk is case-sensitive");
  writeFile(w.root, "page.html", "<p>public</p>");
  // The site's root as site.bind makes it (.native), and a path into the
  // state folder spelled in the other case.
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(w.root), mode: "folder", entry: "page.html" });
  const res = await getPage(w, bound.name, "/STATE/cli-secret");
  assert.equal(res.status, 404);
});
