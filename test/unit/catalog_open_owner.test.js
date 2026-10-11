"use strict";

// Open's owner check (Library fix round, SEC4). Open binds a site, which serves
// everything under its root. So the check covers the root as well as the
// reviewed and served files, and a recorded file that is not on disk is not
// openable: there is nothing to check it against.
//
// chown needs root, so these tests pass `uid` (the user everything must belong
// to) and a `statFile` that reports each path's owner.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const actionsModule = require("../../src/service/catalog_actions.js");

const NOW = Date.parse("2026-09-28T16:00:00.000Z");
const ME = 501;

function world(owners, overrides) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-open-owner-")));
  const file = path.join(root, "page.html");
  fs.writeFileSync(file, "<p>page</p>");
  const described = Object.assign({
    review: "r_page", session: "s_doc", display_name: "page.html", title: null,
    path: file, served_path: file, kind: "static", openable: "yes", candidate: null,
    site: { mode: "folder", root, file, url_path: "/page.html", name: null, address: null, worktree: false },
    watching: null, last: new Date(NOW).toISOString()
  }, overrides ? overrides(root, file) : {});
  const bound = [];
  const actions = actionsModule.createCatalogActions({
    dir: root,
    reader: { describeReview: () => described },
    queue: { readAttached: () => null, append: () => ({ ok: false }) },
    store: {},
    pages: {
      bindPlan: (plan) => { bound.push(plan.root); return { name: "n", site: {} }; },
      addressOf: (name, urlPath) => "http://" + name + ".lahe.localhost:1" + urlPath,
      railHolder: () => null,
      stamp: () => {}
    },
    sessions: { read: () => ({ id: "s_doc", closed_at: null }) },
    log: () => {},
    uid: ME,
    statFile: (p) => {
      const stat = fs.statSync(p);
      return { uid: Object.prototype.hasOwnProperty.call(owners, p === root ? "root" : "file") ? owners[p === root ? "root" : "file"] : ME, isFile: () => stat.isFile() };
    }
  });
  return { actions, bound, root, file };
}

test("Open refuses when the site's root belongs to another user, before naming a site", async () => {
  const w = world({ root: ME + 1 });
  const out = await w.actions.open({ review: "r_page" }, NOW);
  assert.equal(out.error && out.error.code, "PROTO_NOT_OPENABLE");
  assert.match(out.error.detail, /not owned/);
  assert.deepEqual(w.bound, [], "no site was named");
});

test("Open goes on to bind the site when the files and the root are all this user's", async () => {
  const w = world({});
  const out = await w.actions.open({ review: "r_page" }, NOW);
  assert.equal(out.status, 200, JSON.stringify(out));
  assert.deepEqual(w.bound, [w.root], "the owner check passed");
  assert.equal(out.body.url, "http://n.lahe.localhost:1/page.html");
});

test("Open refuses a recorded file that is no longer on disk", async () => {
  const w = world({}, (root) => ({ served_path: path.join(root, "gone.html") }));
  const out = await w.actions.open({ review: "r_page" }, NOW);
  assert.equal(out.error && out.error.code, "PROTO_NOT_OPENABLE");
  assert.deepEqual(w.bound, []);
});

test("Open refuses when nothing vouches for a site at all, and names none", async () => {
  const w = world({}, () => ({ site: null, openable: "via-agent" }));
  const out = await w.actions.open({ review: "r_page" }, NOW);
  assert.equal(out.error && out.error.code, "PROTO_NOT_OPENABLE");
  assert.deepEqual(w.bound, []);
});
