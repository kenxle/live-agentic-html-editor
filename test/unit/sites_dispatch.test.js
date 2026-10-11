// Host dispatch and the listeners (stable addresses, Task 1.2).
//
// Plan rows: V7 (Host closed set), V8 (grammar), V9 (dispatch order), V10
// (::1), V68 (listen addresses). Every request here is raw, with the Host sent
// exactly as written, because a browser always normalizes it and these rows are
// about what reaches the helper.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");
const { sitesWorld, raw, writeFile, siteHost, getPage, tempRoot } = require("../helpers/sites_world.js");

const HEALTH = protocol.route("health").path;

async function worldWithSite(t, options) {
  const world = await sitesWorld(t, options);
  const folder = path.join(world.home, "ws", "repo", "docs");
  writeFile(folder, "page.html", "<!doctype html><title>t</title><p id=x>hello page</p>");
  const bound = world.helper.sites.bind({ root: folder, mode: "folder", entry: "page.html" });
  return Object.assign(world, { folder, name: bound.name });
}

// --- V7: closed set of Hosts per family -------------------------------------

test("V7: the API answers loopback Hosts on its own port", async (t) => {
  const w = await sitesWorld(t);
  for (const host of ["127.0.0.1:" + w.helper.port, "localhost:" + w.helper.port, "[::1]:" + w.helper.port]) {
    const res = await raw(w.helper.port, { path: HEALTH, headers: { host } });
    assert.equal(res.status, 200, host);
    assert.equal(res.json.ok, true);
  }
});

test("V7: a foreign Host is a 400 on both listeners", async (t) => {
  const w = await worldWithSite(t);
  for (const port of [w.helper.port, w.helper.pagesPort]) {
    const res = await raw(port, { path: HEALTH, headers: { host: "evil.example:" + port } });
    assert.equal(res.status, 400, "port " + port);
  }
});

test("V7: a page name is refused on the API port", async (t) => {
  const w = await worldWithSite(t);
  const res = await raw(w.helper.port, {
    path: "/page.html",
    headers: { host: w.name + ".lahe.localhost:" + w.helper.port }
  });
  assert.equal(res.status, 400);
  assert.doesNotMatch(res.text, /hello page/);
});

test("V7: a registered name answers on the pages port", async (t) => {
  const w = await worldWithSite(t);
  const res = await getPage(w, w.name, "/page.html");
  assert.equal(res.status, 200);
  assert.match(res.text, /hello page/);
});

// --- V8: grammar ------------------------------------------------------------

test("V8: trailing dot, five labels, wrong port and uppercase are refused", async (t) => {
  const w = await worldWithSite(t);
  const port = w.helper.pagesPort;
  const bad = [
    w.name + ".lahe.localhost.:" + port,
    "a.b.c.d.e.lahe.localhost:" + port,
    w.name + ".lahe.localhost:" + (port + 1),
    w.name.toUpperCase() + ".lahe.localhost:" + port,
    w.name + ".LAHE.localhost:" + port
  ];
  for (const host of bad) {
    const res = await raw(port, { path: "/page.html", headers: { host } });
    assert.equal(res.status, 400, host);
    assert.doesNotMatch(res.text, /hello page/, host);
  }
});

test("V8: a parent or child of a registered name is not that site", async (t) => {
  const w = await worldWithSite(t);
  const labels = w.name.split(".");
  const parent = labels.slice(1).join(".");
  const child = "x." + w.name;
  for (const name of [parent, child]) {
    const res = await getPage(w, name, "/page.html");
    assert.equal(res.status, 404, name);
    assert.doesNotMatch(res.text, /hello page/, name);
  }
});

test("V8: a page Host with no port is accepted by the grammar", () => {
  const out = protocol.classifyHost("a.b.lahe.localhost", { pagesPort: 1483 });
  assert.deepEqual(out, { family: "page", name: "a.b" });
  assert.equal(protocol.classifyHost("a.b.lahe.localhost:1483", { pagesPort: 1483 }).family, "page");
  assert.equal(protocol.classifyHost("a.b.lahe.localhost:7817", { pagesPort: 1483 }).family, "bad");
  // The port is checked before the Library's name: the Library answers at the
  // pages port or with no port, never at another.
  assert.equal(protocol.classifyHost("library.lahe.localhost:7817", { pagesPort: 1483 }).family, "bad");
});

// --- V9: dispatch order -----------------------------------------------------

test("V9: a document Host never gets a CORS preflight answer", async (t) => {
  const w = await worldWithSite(t);
  const res = await raw(w.helper.pagesPort, {
    method: "OPTIONS",
    path: protocol.route("events.append").path,
    headers: {
      host: siteHost(w, w.name),
      origin: "http://" + siteHost(w, w.name),
      "access-control-request-method": "POST"
    }
  });
  assert.notEqual(res.status, 204);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

test("V9: a document Host never reaches a catalog route", async (t) => {
  const w = await worldWithSite(t);
  for (const p of [protocol.route("catalog.page").path, protocol.route("catalog.list").path]) {
    const res = await getPage(w, w.name, p, { "sec-fetch-site": "same-origin" });
    assert.equal(res.status, 404, p);
    assert.doesNotMatch(res.text, /lahe-catalog-token/);
    assert.ok(!(res.json && res.json.attached !== undefined), "no catalog list");
  }
});

test("V9: on the API port, a foreign Host's preflight is refused before the preflight rule", async (t) => {
  const w = await sitesWorld(t);
  const res = await raw(w.helper.port, {
    method: "OPTIONS",
    path: protocol.route("events.append").path,
    headers: { host: "evil.example:" + w.helper.port, origin: "null", "access-control-request-method": "POST" }
  });
  assert.equal(res.status, 400);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
});

// --- V10 and V68: listeners -------------------------------------------------

function ipv6Available() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.listen(0, "::1", () => s.close(() => resolve(true)));
  });
}

test("V10: the helper serves on ::1 too", async (t) => {
  if (!(await ipv6Available())) return t.skip("this machine has no IPv6 loopback");
  const w = await worldWithSite(t);
  const api = await raw(w.helper.port, { address: "::1", path: HEALTH, headers: { host: "[::1]:" + w.helper.port } });
  assert.equal(api.status, 200);
  const page = await raw(w.helper.pagesPort, { address: "::1", path: "/page.html", headers: { host: siteHost(w, w.name) } });
  assert.equal(page.status, 200);
  assert.match(page.text, /hello page/);
});

test("V10: a failed ::1 bind is a log line and the helper keeps serving", async (t) => {
  if (!(await ipv6Available())) return t.skip("this machine has no IPv6 loopback");
  // Hold ::1 on a port, then ask the helper for that same port.
  const holder = net.createServer();
  await new Promise((r) => holder.listen(0, "::1", r));
  t.after(() => new Promise((r) => holder.close(() => r())));
  const port = holder.address().port;
  const dir = path.join(tempRoot(), "state");
  let helper;
  try {
    helper = await service.serve({ port, stateDir: dir, quiet: true });
  } catch (err) {
    // 127.0.0.1 on that port was taken by someone else: nothing to prove here.
    if (err && err.code === "EADDRINUSE") return t.skip("127.0.0.1:" + port + " was taken");
    throw err;
  }
  t.after(() => helper.close());
  const res = await raw(port, { path: HEALTH, headers: { host: "127.0.0.1:" + port } });
  assert.equal(res.status, 200);
  const log = fs.readFileSync(path.join(dir, "helper.log"), "utf8");
  assert.match(log, /could not listen on \[::1\]:\d+/);
});

test("V68: the helper listens on 127.0.0.1 and ::1 only, never on all addresses", async (t) => {
  const w = await worldWithSite(t);
  const addresses = w.helper.listeners().map((l) => l.address);
  assert.ok(addresses.length >= 2, JSON.stringify(addresses));
  addresses.forEach((a) => assert.ok(a === "127.0.0.1" || a === "::1", a));
  assert.ok(addresses.includes("127.0.0.1"));
});

// --- the switch -------------------------------------------------------------

test("with the switch on, service.json reports the mode, the port and the printed ending", async (t) => {
  const w = await sitesWorld(t);
  const ready = JSON.parse(fs.readFileSync(path.join(w.state, "service.json"), "utf8"));
  assert.equal(ready.pages.mode, "sites");
  assert.equal(ready.pages.port, w.helper.pagesPort);
  assert.equal(ready.pages.printed_ending, "lahe.localhost");
});

test("library.lahe.localhost at a port that is not the pages port is a bad Host, not the Library", () => {
  const protocol = require("../../src/shared/protocol.js");
  assert.equal(protocol.classifyHost("library.lahe.localhost:9999", { pagesPort: 1483 }).family, protocol.HOST_FAMILY.BAD);
  assert.equal(protocol.classifyHost("library.lahe.localhost:1483", { pagesPort: 1483 }).family, protocol.HOST_FAMILY.LIBRARY);
  assert.equal(protocol.classifyHost("library.lahe.localhost", { pagesPort: 1483 }).family, protocol.HOST_FAMILY.LIBRARY);
});
