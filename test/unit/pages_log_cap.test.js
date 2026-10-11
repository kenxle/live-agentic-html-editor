// Any web page can make the browser ask for random *.lahe.localhost names or
// send random Host headers. Each one used to add a key to a map and a line to
// helper.log, with no limit, so a page could grow the helper's memory and its
// log without end. Both are now capped, and a repeated refused Host is logged
// once.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const pageRoutes = require("../../src/service/page_routes.js");
const { sitesWorld, raw } = require("../helpers/sites_world.js");

function logLines(w, pattern) {
  return fs.readFileSync(path.join(w.state, "helper.log"), "utf8").split("\n").filter((l) => pattern.test(l));
}

const MANY = pageRoutes.LOG_NOTE_CAP + 40;

test("unknown names stop being logged after the cap, with one line saying so", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  for (let i = 0; i < MANY; i++) {
    const res = await raw(port, { path: "/", headers: { host: "nobody-" + i + ".lahe.localhost:" + port } });
    assert.equal(res.status, 404);
  }
  assert.equal(logLines(w, /no document by the name/).length, pageRoutes.LOG_NOTE_CAP);
  assert.equal(logLines(w, /further notes of this kind are not logged/).length, 1);
});

test("a refused Host is logged once per distinct Host, names the check, and stops at the cap", async (t) => {
  const w = await sitesWorld(t);
  const port = w.helper.pagesPort;
  for (let i = 0; i < 3; i++) await raw(port, { path: "/", headers: { host: "same.example:" + port } });
  const same = logLines(w, /refused Host "same\.example/);
  assert.equal(same.length, 1);
  assert.match(same[0], /check host failed/);
  for (let i = 0; i < MANY; i++) await raw(port, { path: "/", headers: { host: "evil-" + i + ".example" } });
  assert.equal(logLines(w, /refused Host /).length, pageRoutes.LOG_NOTE_CAP);
  assert.equal(logLines(w, /further refused Hosts are not logged/).length, 1);
});
