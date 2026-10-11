// The unknown-name and file-gone pages link to the Library. The link used to
// point at 127.0.0.1:<api>/catalog, which a page at <name>.lahe.localhost
// reaches as a cross-site click, so the Library refused it and the link was
// dead. The link now goes to library.lahe.localhost at the printed port (a
// same-site click), and the Library page alone accepts a same-site top-level
// navigation. Every Library API route still takes same-origin only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const auth = require("../../src/service/auth.js");
const protocol = require("../../src/shared/protocol.js");
const pageRoutes = require("../../src/service/page_routes.js");
const { sitesWorld, raw } = require("../helpers/sites_world.js");

const CATALOG = { token: "t".repeat(43), port: 5000, pagesPort: 6000 };

function request(routeName, extra) {
  return {
    routeName,
    headers: Object.assign({ host: "library.lahe.localhost:6000" }, extra)
  };
}

const NAVIGATE = { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" };

test("the Library page accepts a same-site top-level navigation", () => {
  assert.equal(auth.checkCatalogRequest(request("catalog.page", NAVIGATE), CATALOG).ok, true);
});

test("the Library page refuses same-site requests that are not a top-level navigation", () => {
  const cases = [
    Object.assign({}, NAVIGATE, { "sec-fetch-dest": "iframe" }),
    Object.assign({}, NAVIGATE, { "sec-fetch-dest": "frame" }),
    Object.assign({}, NAVIGATE, { "sec-fetch-mode": "cors" }),
    Object.assign({}, NAVIGATE, { "sec-fetch-mode": "no-cors", "sec-fetch-dest": "empty" }),
    { "sec-fetch-site": "same-site" },
    Object.assign({}, NAVIGATE, { "sec-fetch-site": "cross-site" })
  ];
  for (const headers of cases) {
    const result = auth.checkCatalogRequest(request("catalog.page", headers), CATALOG);
    assert.equal(result.ok, false, JSON.stringify(headers));
    assert.equal(result.check, protocol.CHECK.SEC_FETCH_SITE);
  }
});

test("no Library route but the page takes a same-site navigation", () => {
  for (const r of protocol.CATALOG_ROUTES.filter((x) => x.name !== "catalog.page")) {
    const result = auth.checkCatalogRequest(request(r.name, NAVIGATE), CATALOG);
    assert.equal(result.ok, false, r.name);
  }
});

test("the Library address on these pages uses the printed port, and no port through the port-80 forward", () => {
  assert.equal(pageRoutes.libraryAddress(1483), "http://library.lahe.localhost:1483/catalog");
  assert.equal(pageRoutes.libraryAddress(80), "http://library.lahe.localhost/catalog");
});

test("a served unknown-name page links to the Library at the pages port", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  const res = await raw(port, { path: "/", headers: { host: "nobody.lahe.localhost:" + port } });
  assert.equal(res.status, 404);
  assert.ok(res.text.includes('href="http://library.lahe.localhost:' + port + '/catalog"'), res.text);
});

test("the Library page cannot be framed", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  const res = await raw(port, { path: "/catalog", headers: Object.assign({ host: "library.lahe.localhost:" + port }, NAVIGATE) });
  assert.equal(res.status, 200);
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
});
