// A site root that is an ancestor of a non-hidden state folder used to serve
// the state folder: the CLI secret, each review's meta.json (with its token),
// and every event log. rootProblem refuses a root equal to or inside the
// state folder, but not one above it. The page handler now answers 404 for
// any file whose real path is inside the real state folder.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { sitesWorld, writeFile, getPage } = require("../helpers/sites_world.js");

test("a site above the state folder never serves a file inside it", async (t) => {
  const w = await sitesWorld(t);
  writeFile(w.root, "page.html", "<!doctype html><p>public</p>");
  writeFile(w.state, "reviews/r_x/meta.json", "{\"token\":\"secret-token\"}");
  writeFile(w.state, "page.md", "# inside the state folder\n");
  // A link to the state folder, from inside the site, is caught by real path.
  fs.symlinkSync(w.state, path.join(w.root, "linked"));
  const bound = w.helper.sites.bind({ root: w.root, mode: "folder", entry: "page.html" });

  const ok = await getPage(w, bound.name, "/page.html");
  assert.equal(ok.status, 200);
  for (const p of ["/state/cli-secret", "/state/reviews/r_x/meta.json", "/state/page.md", "/state/helper.log",
    "/linked/cli-secret", "/linked/reviews/r_x/meta.json", "/state/", "/state/sites.json"]) {
    const res = await getPage(w, bound.name, p);
    assert.equal(res.status, 404, p + " answered " + res.status);
    assert.doesNotMatch(res.text, /secret-token|inside the state folder/, p);
  }
});
