// The brief: the same file gets the same address, in any review. `lahe review
// X` made site X, and `lahe review X/sub/p.html` then made site X/sub, so
// X/sub/p.html had two addresses. A file is now bound into the deepest
// registered folder site that already contains it. Both orders are pinned:
// the file keeps the address it got first.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const sitesModule = require("../../src/service/sites.js");
const { tempRoot, writeFile, raw } = require("../helpers/sites_world.js");
const { freePort } = require("../helpers/free_port.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");
const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>";

function world() {
  const root = tempRoot("lahe-same-file-");
  const home = path.join(root, "home");
  const state = path.join(root, "state");
  const x = path.join(home, "ws", "x");
  writeFile(x, "index.html", PAGE);
  writeFile(x, "sub/p.html", PAGE);
  const registry = sitesModule.createSites({ dir: state, home });
  registry.load();
  return { home, state, x, registry };
}

test("folder X first: a file under X binds site X at its path, not a new site", () => {
  const w = world();
  const outer = w.registry.bind({ root: w.x, mode: "folder", entry: "index.html" });
  const file = w.registry.bind({ root: path.join(w.x, "sub"), mode: "folder", entry: "p.html", containing: true });
  assert.equal(file.name, outer.name);
  assert.equal(file.entry, "sub/p.html");
  assert.equal(file.site.entry, "index.html", "X's own landing page is unchanged");
  assert.equal(w.registry.list().length, 1);
});

test("file first: its folder's site is the deepest one, so the file keeps its address after X is reviewed", () => {
  const w = world();
  const first = w.registry.bind({ root: path.join(w.x, "sub"), mode: "folder", entry: "p.html", containing: true });
  const outer = w.registry.bind({ root: w.x, mode: "folder", entry: "index.html" });
  assert.notEqual(outer.name, first.name, "the folder review gets its own site");
  const again = w.registry.bind({ root: path.join(w.x, "sub"), mode: "folder", entry: "p.html", containing: true });
  assert.equal(again.name, first.name);
});

test("a page-only (notes) site never takes in another file", () => {
  const w = world();
  w.registry.bind({ root: path.join(w.x, "index.html"), mode: "page-only", entry: "index.html" });
  const file = w.registry.bind({ root: path.join(w.x, "sub"), mode: "folder", entry: "p.html", containing: true });
  assert.equal(file.created, true);
});

test("lahe review X, then lahe review X/sub/p.html: one site, and the page loads at X's address", async (t) => {
  const w = world();
  const port = await freePort();
  const env = Object.assign({}, process.env, { LAHE_HOME_DIR: w.home, LAHE_PAGES_PORT: String(await freePort()) });
  const sessions = [];
  const run = (args) => {
    try { return execFileSync(process.execPath, [BIN].concat(args, ["--state-dir", w.state, "--port", String(port)]), { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
    catch (err) { throw new Error(String(err.stdout) + String(err.stderr)); }
  };
  t.after(async () => {
    for (const s of sessions) { try { execFileSync(process.execPath, [BIN, "session", "close", s, "--state-dir", w.state], { env, stdio: "ignore" }); } catch (err) { /* stop below */ } }
    await stopTempHelpers(w.state);
  });
  const first = run(["review", w.x]);
  const session = /--session (s_[A-Za-z0-9_-]+)/.exec(first)[1];
  sessions.push(session);
  const firstUrl = new URL(/^\s*open\s+(\S+)/m.exec(first)[1]);
  const second = run(["review", path.join(w.x, "sub", "p.html"), "--session", session]);
  const secondUrl = new URL(/^\s*open\s+(\S+)/m.exec(second)[1]);
  assert.equal(secondUrl.host, firstUrl.host, "same site");
  assert.equal(secondUrl.pathname, "/sub/p.html");
  assert.match(second, new RegExp("root\\s+" + w.x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s"));
  const res = await raw(Number(secondUrl.port), { path: secondUrl.pathname, headers: { host: secondUrl.host } });
  assert.equal(res.status, 200);
  assert.match(res.text, /data-lahe-review="/);
});
