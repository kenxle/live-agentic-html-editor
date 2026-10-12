// The Library at library.lahe.localhost (stable addresses, Task 4.2, row V43).
//
// The Library answers at library.lahe.localhost:<pages port> as well as at
// 127.0.0.1:<port>/catalog, with today's checks: its own token, same-origin,
// an exact Origin on a POST. A document's Host, a made-up Host and the short
// `.lahe` ending never reach it. 127.0.0.1 and localhost keep reaching it.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const { sitesWorld, raw, writeFile } = require("../helpers/sites_world.js");

const PAGE = protocol.route("catalog.page");
const LIST = protocol.route("catalog.list");
const STAR = protocol.route("catalog.star");

function tokenFromPage(html) {
  const re = new RegExp('<meta name="' + protocol.CATALOG_TOKEN_META + '" content="([^"]*)"');
  const m = re.exec(html);
  return m ? m[1] : null;
}

function pageHeaders(host) {
  return { host: host, "sec-fetch-site": "none" };
}

function apiHeaders(host, token, extra) {
  return Object.assign({
    host: host,
    "sec-fetch-site": "same-origin",
    [protocol.HEADER.CLIENT]: protocol.CLIENT_CATALOG,
    [protocol.HEADER.TOKEN]: token,
    "content-type": protocol.JSON_CONTENT_TYPE,
    origin: "http://" + host
  }, extra || {});
}

async function libraryToken(port, host) {
  const res = await raw(port, { path: PAGE.path, headers: pageHeaders(host) });
  assert.equal(res.status, 200, "the Library loads at " + host + ": " + res.text.slice(0, 200));
  const token = tokenFromPage(res.text);
  assert.ok(token && token.length >= 32, "the page carries the Library token");
  return token;
}

test("V43: the Library loads at library.lahe.localhost on the pages port, with its token", async (t) => {
  const w = await sitesWorld(t);
  const host = "library.lahe.localhost:" + w.helper.pagesPort;
  const token = await libraryToken(w.helper.pagesPort, host);
  const list = await raw(w.helper.pagesPort, {
    method: LIST.method,
    path: LIST.path,
    headers: apiHeaders(host, token)
  });
  assert.equal(list.status, 200, "catalog.list passes the checks from the Library's own origin: " + list.text);
  assert.ok(Array.isArray(list.json.sessions));
});

test("V43: the Library at the new address still checks the token, Sec-Fetch-Site and Origin", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  const host = "library.lahe.localhost:" + port;
  const token = await libraryToken(port, host);
  const call = (extra, body) => raw(port, {
    method: STAR.method,
    path: STAR.path,
    headers: apiHeaders(host, token, extra),
    body: JSON.stringify(body || { review: "none", starred: true })
  });
  const cases = [
    { extra: { [protocol.HEADER.TOKEN]: "x" + token.slice(1) }, check: protocol.CHECK.TOKEN },
    { extra: { [protocol.HEADER.TOKEN]: undefined }, check: protocol.CHECK.TOKEN },
    { extra: { "sec-fetch-site": "same-site" }, check: protocol.CHECK.SEC_FETCH_SITE },
    { extra: { "sec-fetch-site": "cross-site" }, check: protocol.CHECK.SEC_FETCH_SITE },
    { extra: { origin: "http://127.0.0.1:" + w.helper.port }, check: protocol.CHECK.ORIGIN },
    { extra: { origin: "http://library.lahe.localhost" }, check: protocol.CHECK.ORIGIN },
    { extra: { origin: "null" }, check: protocol.CHECK.ORIGIN }
  ];
  for (const c of cases) {
    const extra = Object.fromEntries(Object.entries(c.extra));
    const res = await call(extra);
    assert.notEqual(res.status, 200, JSON.stringify(c.extra));
    assert.equal(res.json && res.json.error && res.json.error.check, c.check, JSON.stringify(c.extra) + " -> " + res.text);
  }
});

test("V43: a document's Host never reaches the Library", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  writeFile(folder, "a.html", "<!doctype html><title>a</title><p>a</p>");
  const bound = w.helper.sites.bind({ root: folder, mode: "folder", entry: "a.html" });
  const port = w.helper.pagesPort;
  for (const host of [
    bound.name + ".lahe.localhost:" + port,
    "evil.lahe.localhost:" + port,
    "not-library.lahe.localhost:" + port
  ]) {
    const res = await raw(port, { path: PAGE.path, headers: pageHeaders(host) });
    assert.notEqual(res.status, 200, host);
    assert.equal(tokenFromPage(res.text), null, host + " never gets a Library token");
    assert.ok(!/Lahe Library/.test(res.text), host + " is not the Library page");
    const api = await raw(port, { method: LIST.method, path: LIST.path, headers: apiHeaders(host, "x".repeat(64)) });
    assert.notEqual(api.status, 200, host);
  }
});

test("V43: library.lahe, a trailing dot, uppercase and a wrong port are refused", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  for (const host of [
    "library.lahe:" + port,
    "library.lahe.localhost.:" + port,
    "LIBRARY.LAHE.LOCALHOST:" + port,
    "library.lahe.localhost:" + (port + 1),
    "library.lahe.localhost:" + w.helper.port + "x",
    "x.library.lahe.localhost:" + port
  ]) {
    const res = await raw(port, { path: PAGE.path, headers: pageHeaders(host) });
    assert.notEqual(res.status, 200, host);
    assert.equal(tokenFromPage(res.text), null, host);
  }
});

test("V43: the API port does not answer to the library name; 127.0.0.1 and localhost still reach the Library", async (t) => {
  const w = await sitesWorld(t);
  const api = w.helper.port;
  const named = await raw(api, { path: PAGE.path, headers: pageHeaders("library.lahe.localhost:" + api) });
  assert.equal(named.status, 400);
  assert.equal(tokenFromPage(named.text), null);
  for (const host of ["127.0.0.1:" + api, "localhost:" + api]) {
    const res = await raw(api, { path: PAGE.path, headers: pageHeaders(host) });
    assert.equal(res.status, 200, host);
  }
});

// Port-free addresses (lahe-names, Task 6.0): through the port 80 forward the
// browser sends the Host with no port. The Library answers that too, with the
// same checks; `library.lahe` stays refused with or without a port.
test("the Library answers at library.lahe.localhost with no port, as the port 80 forward delivers it", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  const host = "library.lahe.localhost";
  const token = await libraryToken(port, host);
  const list = await raw(port, { method: LIST.method, path: LIST.path, headers: apiHeaders(host, token) });
  assert.equal(list.status, 200, list.text);
  const wrongOrigin = await raw(port, {
    method: STAR.method,
    path: STAR.path,
    headers: apiHeaders(host, token, { origin: "http://library.lahe.localhost:" + port }),
    body: JSON.stringify({ review: "none", starred: true })
  });
  assert.equal(wrongOrigin.json.error.check, protocol.CHECK.ORIGIN, "the Origin still has to be the page's own");
  for (const refused of ["library.lahe", "library.lahe.localhost."]) {
    const res = await raw(port, { path: PAGE.path, headers: pageHeaders(refused) });
    assert.notEqual(res.status, 200, refused);
  }
});
