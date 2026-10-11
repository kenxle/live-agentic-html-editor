// The `.lahe` ending and the port-free address, as the core sees them
// (stable addresses Step 3, with lahe-names 6.0 to 6.2).
//
// The Host check and the Origin check accept `<name>.lahe` only once the
// helper has proved its own name server answers `.lahe` lookups on this
// computer (addresses.js), and never for the Library. A port-free
// `<name>.lahe.localhost` is always accepted as an origin: it is the port-80
// forward, and the name cannot be answered by anyone else. site.bind prints
// the port the helper has proved, 80 once the forward is checked.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const routes = require("../../src/service/routes.js");
const pageRoutes = require("../../src/service/page_routes.js");
const sitesModule = require("../../src/service/sites.js");
const { sitesWorld, writeFile, raw, tempRoot } = require("../helpers/sites_world.js");

const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>hello</p></body></html>";

// --- the Host check -------------------------------------------------------------

test("a .lahe Host is a page only once the .lahe check has passed", () => {
  const off = { pagesPort: 1483, laheNames: false };
  const on = { pagesPort: 1483, laheNames: true };
  assert.equal(protocol.classifyHost("a.b.lahe", off).family, "bad");
  assert.equal(protocol.classifyHost("a.b.lahe:1483", off).family, "bad");
  assert.deepEqual(protocol.classifyHost("a.b.lahe", on), { family: "page", name: "a.b" });
  assert.deepEqual(protocol.classifyHost("a.b.lahe:1483", on), { family: "page", name: "a.b" });
  assert.equal(protocol.classifyHost("a.b.lahe:7817", on).family, "bad", "a wrong port is still refused");
  assert.equal(protocol.classifyHost("A.b.lahe", on).family, "bad", "uppercase is still refused");
  assert.equal(protocol.classifyHost("a.b.lahe.", on).family, "bad", "a trailing dot is still refused");
});

test("library.lahe is never accepted, checked or not", () => {
  for (const laheNames of [false, true]) {
    for (const host of ["library.lahe", "library.lahe:1483"]) {
      assert.equal(protocol.classifyHost(host, { pagesPort: 1483, laheNames }).family, "bad", host);
    }
  }
  assert.equal(protocol.classifyHost("library.lahe.localhost:1483", { pagesPort: 1483 }).family, "library");
});

// --- the Origin check ------------------------------------------------------------

test("a port-free .lahe.localhost origin is the forward, and always names its site", () => {
  assert.equal(protocol.siteNameFromOrigin("http://a.b.lahe.localhost", 1483, false), "a.b");
  assert.equal(protocol.siteNameFromOrigin("http://a.b.lahe.localhost:1483", 1483, false), "a.b");
  assert.equal(protocol.siteNameFromOrigin("http://a.b.lahe.localhost:9999", 1483, false), null);
});

test("a .lahe origin names its site only once the .lahe check has passed", () => {
  for (const origin of ["http://a.b.lahe", "http://a.b.lahe:1483"]) {
    assert.equal(protocol.siteNameFromOrigin(origin, 1483, false), null, origin);
    assert.equal(protocol.siteNameFromOrigin(origin, 1483, true), "a.b", origin);
  }
  assert.equal(protocol.siteNameFromOrigin("http://a.b.lahe:9999", 1483, true), null);
  assert.equal(protocol.siteNameFromOrigin("http://library.lahe", 1483, true), null);
  assert.equal(protocol.siteNameFromOrigin("https://a.b.lahe", 1483, true), null);
});

test("fileForPage follows the same rule for a .lahe origin", (t) => {
  const root = tempRoot("lahe-names-file-");
  const home = path.join(root, "home");
  const dir = path.join(root, "state");
  fs.mkdirSync(home);
  fs.mkdirSync(dir);
  const folder = path.join(home, "ws", "repo", "docs");
  const page = writeFile(folder, "page.html", PAGE);
  const sites = sitesModule.createSites({ dir, home });
  sites.load();
  const bound = sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "page.html" });
  let verified = false;
  pageRoutes.activate(dir, { sites, pagesPort: 1483, laheNames: () => verified });
  t.after(() => pageRoutes.deactivate(dir));
  assert.equal(pageRoutes.fileForPage(dir, "http://" + bound.name + ".lahe", "/page.html"), null);
  assert.equal(pageRoutes.fileForPage(dir, "http://" + bound.name + ".lahe.localhost", "/page.html"), fs.realpathSync(page));
  verified = true;
  assert.equal(pageRoutes.fileForPage(dir, "http://" + bound.name + ".lahe", "/page.html"), fs.realpathSync(page));
});

// --- through a helper -------------------------------------------------------------

async function boundHelper(t) {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  const page = writeFile(folder, "page.html", PAGE);
  const review = w.helper.reviews.create({ target_path: page, agent_session_id: "s1", origins: ["null"] });
  const bound = w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "page.html" });
  return Object.assign(w, { review, name: bound.name });
}

function readAs(w, origin) {
  return raw(w.helper.port, {
    path: protocol.route("review.read").path + "?review=" + w.review.id,
    headers: { host: "127.0.0.1:" + w.helper.port, "x-lahe-client": "layer", "x-lahe-token": w.review.token, origin }
  });
}

test("the helper answers a .lahe Host, and accepts a .lahe origin, only once the check has passed", async (t) => {
  const w = await boundHelper(t);
  const addresses = w.helper.addresses();
  const lahe = w.name + ".lahe:" + w.helper.pagesPort;
  assert.equal((await raw(w.helper.pagesPort, { path: "/page.html", headers: { host: lahe } })).status, 400);
  assert.equal((await readAs(w, "http://" + lahe)).status, 403);
  // The positive control: the .lahe.localhost origin is accepted either way.
  assert.equal((await readAs(w, "http://" + w.name + ".lahe.localhost:" + w.helper.pagesPort)).status, 200);
  addresses.laheNamesVerified = () => true;
  const page = await raw(w.helper.pagesPort, { path: "/page.html", headers: { host: lahe } });
  assert.equal(page.status, 200);
  assert.match(page.text, /hello/);
  assert.equal((await readAs(w, "http://" + lahe)).status, 200);
  assert.equal((await raw(w.helper.pagesPort, {
    path: "/catalog", headers: { host: "library.lahe:" + w.helper.pagesPort }
  })).status, 400, "library.lahe is never served");
});

test("site.bind prints the port the helper has proved: 80 once the forward is checked, else the pages port", async (t) => {
  const root = tempRoot("lahe-names-bind-");
  const dir = path.join(root, "state");
  const folder = path.join(root, "home", "ws", "repo", "docs");
  writeFile(folder, "page.html", PAGE);
  const logModule = require("../../src/service/log.js");
  const reviewsModule = require("../../src/service/reviews.js");
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  const review = reviews.create({ target_path: path.join(folder, "page.html"), agent_session_id: "s1", origins: ["null"] });
  const sites = sitesModule.createSites({ dir, home: path.join(root, "home") });
  sites.load();
  let printed = 1483;
  const deps = { sites, reviews, log, now: () => Date.now(), pagesPort: () => 1483, printedPort: () => printed };
  const body = { review: review.id, root: folder, mode: "folder", entry: "page.html" };
  const first = routes.handlerFor("site.bind")({ body }, deps);
  assert.equal(first.status, 200);
  assert.match(first.body.url, /^http:\/\/ws\.repo\.docs\.lahe\.localhost:1483\/page\.html$/);
  printed = 80;
  const second = routes.handlerFor("site.bind")({ body }, deps);
  assert.equal(second.body.url, "http://ws.repo.docs.lahe.localhost/page.html");
});
