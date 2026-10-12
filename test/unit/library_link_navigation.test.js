// Any top-level navigation to the Library page opens it: a link in a document
// or an email, a bookmark, a typed address, from any site. The browser says so
// with Sec-Fetch-Mode navigate and Sec-Fetch-Dest document, whatever
// Sec-Fetch-Site says, and a request with no Sec-Fetch headers at all (a
// program, an old browser) is not a page asking for a response it can read.
//
// What keeps that safe: a cross-site navigation cannot read the page it
// loads, the page cannot be framed (X-Frame-Options and frame-ancestors), its
// Cross-Origin-Opener-Policy cuts any opener off, nothing on it acts on its
// URL, and every Library API route still needs the token, the exact Origin,
// JSON and the custom header. A cross-site fetch or iframe asking for the page
// is still refused, so a page cannot pull the token into a script.

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
const SITES = ["none", "same-origin", "same-site", "cross-site"];

test("the Library page accepts a top-level navigation from any site, including cross-site", () => {
  for (const site of SITES) {
    const headers = Object.assign({}, NAVIGATE, { "sec-fetch-site": site });
    assert.equal(auth.checkCatalogRequest(request("catalog.page", headers), CATALOG).ok, true, site);
  }
});

// The header sets real browsers send for a click on the "Open the Library" link
// from <name>.lahe.localhost to library.lahe.localhost, logged from each lane of
// the browser spec. WebKit calls the two names cross-site and sends no
// Sec-Fetch-User; Chromium and Firefox call them same-site.
const WEBKIT_CLICK = { "sec-fetch-site": "cross-site", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };
const CHROMIUM_CLICK = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-fetch-site": "same-site", "sec-fetch-user": "?1" };

test("the Library page accepts the exact header sets WebKit, Chromium and Firefox send for a click on a link", () => {
  for (const headers of [WEBKIT_CLICK, CHROMIUM_CLICK]) {
    assert.equal(auth.checkCatalogRequest(request("catalog.page", headers), CATALOG).ok, true, JSON.stringify(headers));
  }
  // The same sets as a fetch or a frame are still refused.
  for (const headers of [
    Object.assign({}, WEBKIT_CLICK, { "sec-fetch-dest": "iframe" }),
    Object.assign({}, WEBKIT_CLICK, { "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" }),
    Object.assign({}, CHROMIUM_CLICK, { "sec-fetch-dest": "iframe" })
  ]) {
    assert.equal(auth.checkCatalogRequest(request("catalog.page", headers), CATALOG).ok, false, JSON.stringify(headers));
  }
});

test("the Library page accepts a request with no Sec-Fetch headers at all", () => {
  assert.equal(auth.checkCatalogRequest(request("catalog.page", {}), CATALOG).ok, true);
});

test("the Library page still refuses a request that is not a top-level navigation: a cross-site fetch, an iframe, an embed", () => {
  const cases = [];
  for (const site of ["same-site", "cross-site"]) {
    for (const [mode, dest] of [
      ["navigate", "iframe"], ["navigate", "frame"], ["navigate", "embed"], ["navigate", "object"],
      ["cors", "empty"], ["no-cors", "empty"], ["no-cors", "script"], ["same-origin", "empty"]
    ]) {
      cases.push({ "sec-fetch-site": site, "sec-fetch-mode": mode, "sec-fetch-dest": dest });
    }
    cases.push({ "sec-fetch-site": site });
    cases.push({ "sec-fetch-site": site, "sec-fetch-mode": "navigate" });
    cases.push({ "sec-fetch-site": site, "sec-fetch-dest": "document" });
  }
  // Some Sec-Fetch headers but not the pair that says top-level navigation.
  cases.push({ "sec-fetch-mode": "cors" });
  for (const headers of cases) {
    const result = auth.checkCatalogRequest(request("catalog.page", headers), CATALOG);
    assert.equal(result.ok, false, JSON.stringify(headers));
    assert.equal(result.check, protocol.CHECK.SEC_FETCH_SITE);
  }
});

test("no Library route but the page takes a navigation or a request with no Sec-Fetch headers", () => {
  for (const r of protocol.CATALOG_ROUTES.filter((x) => x.name !== "catalog.page")) {
    for (const headers of [NAVIGATE, Object.assign({}, NAVIGATE, { "sec-fetch-site": "cross-site" }), {}]) {
      const result = auth.checkCatalogRequest(request(r.name, headers), CATALOG);
      assert.equal(result.ok, false, r.name + " " + JSON.stringify(headers));
    }
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

const CROSS_SITE_NAVIGATE = { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", referer: "http://evil.example/page" };

test("a cross-site top-level navigation to the Library gets the page, over HTTP", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  const res = await raw(port, { path: "/catalog", headers: Object.assign({ host: "library.lahe.localhost:" + port }, CROSS_SITE_NAVIGATE) });
  assert.equal(res.status, 200, res.text.slice(0, 200));
  assert.match(res.text, /Lahe Library/);
  // Reached through the API port's loopback name too, as a bookmark would.
  const viaApi = await raw(w.helper.port, { path: "/catalog", headers: Object.assign({ host: "127.0.0.1:" + w.helper.port }, CROSS_SITE_NAVIGATE) });
  assert.equal(viaApi.status, 200);
  // And with no Sec-Fetch headers at all.
  const bare = await raw(port, { path: "/catalog", headers: { host: "library.lahe.localhost:" + port } });
  assert.equal(bare.status, 200);
});

test("a cross-site fetch or iframe request for the Library page is refused, and carries no token", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  for (const extra of [
    { "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" },
    { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe" },
    { "sec-fetch-site": "same-site", "sec-fetch-mode": "no-cors", "sec-fetch-dest": "empty" }
  ]) {
    const res = await raw(port, { path: "/catalog", headers: Object.assign({ host: "library.lahe.localhost:" + port }, extra) });
    assert.equal(res.status, 403, JSON.stringify(extra));
    assert.ok(!res.text.includes(protocol.CATALOG_TOKEN_META), "a refusal never carries the token");
  }
});

test("an API call from another origin is refused, with or without the token", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  const host = "library.lahe.localhost:" + port;
  const page = await raw(port, { path: "/catalog", headers: { host, "sec-fetch-site": "none", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } });
  const token = new RegExp('<meta name="' + protocol.CATALOG_TOKEN_META + '" content="([^"]*)"').exec(page.text)[1];
  for (const name of ["catalog.list", "catalog.open", "catalog.star", "catalog.rename", "catalog.request"]) {
    const r = protocol.route(name);
    const attempt = (extra) => raw(port, {
      method: r.method,
      path: r.path,
      headers: Object.assign({
        host,
        "sec-fetch-site": "same-origin",
        [protocol.HEADER.CLIENT]: protocol.CLIENT_CATALOG,
        [protocol.HEADER.TOKEN]: token,
        "content-type": protocol.JSON_CONTENT_TYPE,
        origin: "http://" + host
      }, extra),
      body: r.method === "POST" ? JSON.stringify({ review: "none" }) : undefined
    });
    // The positive control: the same call, as the page makes it, passes the checks.
    assert.notEqual((await attempt({})).status, 403, name + " passes the checks from its own page");
    for (const extra of [
      { "sec-fetch-site": "cross-site", origin: "http://evil.example" },
      { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" },
      // A POST's Origin must be the page's own. (A GET's guard is Sec-Fetch-Site.)
      ...(r.method === "POST" ? [{ origin: "http://evil.example" }, { origin: "null" }] : []),
      { [protocol.HEADER.TOKEN]: "x".repeat(64) },
      { [protocol.HEADER.CLIENT]: undefined },
      ...(r.method === "POST" ? [{ "content-type": "text/plain" }] : [])
    ]) {
      const res = await attempt(extra);
      assert.ok(res.status >= 400 && res.status < 500, name + " " + JSON.stringify(extra) + " -> " + res.status);
    }
  }
});

test("the Library page cannot be framed and cuts off any opener", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  const res = await raw(port, { path: "/catalog", headers: Object.assign({ host: "library.lahe.localhost:" + port }, CROSS_SITE_NAVIGATE) });
  assert.equal(res.status, 200);
  assert.equal(res.headers["x-frame-options"], "DENY");
  assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(res.headers["cross-origin-opener-policy"], "same-origin");
  const refused = await raw(port, { path: "/catalog", headers: { host: "library.lahe.localhost:" + port, "sec-fetch-site": "cross-site", "sec-fetch-mode": "cors", "sec-fetch-dest": "empty" } });
  assert.equal(refused.headers["cross-origin-opener-policy"], "same-origin", "refusals carry it too");
});

test("the assets are unchanged: a cross-site navigation does not open an asset", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  const res = await raw(port, { path: "/catalog/assets/page.js", headers: Object.assign({ host: "library.lahe.localhost:" + port }, CROSS_SITE_NAVIGATE) });
  assert.equal(res.status, 403);
});

test("nothing on the Library page acts on load from its URL: no script reads the query or the fragment", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const dir = path.join(__dirname, "..", "..", "src", "layer", "catalog");
  for (const file of fs.readdirSync(dir)) {
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    assert.doesNotMatch(text, /location\s*\.\s*(search|hash|href|pathname)\b(?!\s*=[^=])/, file + " reads the page's own URL");
    assert.doesNotMatch(text, /URLSearchParams/, file);
  }
  const page = require("../../src/service/catalog_page.js").renderPage("tok");
  assert.doesNotMatch(page, /<script(?![^>]*\bsrc=)/, "no inline script");
});
