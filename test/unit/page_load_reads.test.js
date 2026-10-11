// Every page load used to read every review's meta.json and every old
// page-server record, synchronously, to pick the review that answers and the
// old origins for the script tag. The old records no longer change, so they
// are read once. A meta.json is read again only when its file changed: `lahe
// add` writes meta.json in its own process (a reused review gains a page
// there), so the helper's in-memory copy can be behind, and the disk stays
// the answer. The review a page load picks is the same as before.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { sitesWorld, writeFile, getPage } = require("../helpers/sites_world.js");
const agentSessions = require("../../src/service/agent_sessions.js");

const PAGE = "<!doctype html><html><head><title>p</title></head><body><p>x</p></body></html>";

function countReads(t, matcher) {
  const counts = { n: 0 };
  const read = fs.readFileSync;
  const list = fs.readdirSync;
  fs.readFileSync = function (file) {
    if (matcher(String(file))) { counts.n += 1; }
    return read.apply(fs, arguments);
  };
  fs.readdirSync = function (file) {
    if (matcher(String(file))) counts.n += 1;
    return list.apply(fs, arguments);
  };
  t.after(() => { fs.readFileSync = read; fs.readdirSync = list; });
  return counts;
}

test("a page load reads no review meta.json and no old page-server record", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "docs");
  const file = writeFile(folder, "page.html", PAGE);
  const session = agentSessions.createStore({ dir: w.state }).create({ name: "t" }).id;
  for (let i = 0; i < 5; i++) w.helper.reviews.create({ target_path: path.join(folder, "other" + i + ".html"), agent_session_id: session, origins: ["null"] });
  const review = w.helper.reviews.create({ target_path: file, agent_session_id: session, origins: ["null"] });
  // An old page-server record for this root, so the tag carries aliases.
  writeFile(path.join(w.state, "agent-sessions", session, "static-servers"), "ss_old.json",
    JSON.stringify({ schema: 1, root: fs.realpathSync(folder), port: 61234, ports: [61234], started_at: "2026-10-01T00:00:00.000Z" }));
  const bound = w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "page.html" });
  w.helper.reviews.stampServed(review.id);

  const first = await getPage(w, bound.name, "/page.html");
  assert.equal(first.status, 200);
  assert.ok(first.text.includes('data-lahe-review="' + review.id + '"'));
  const aliases = /data-lahe-aliases="([^"]*)"/.exec(first.text);

  const counts = countReads(t, (p) => /[\\/]reviews[\\/].*meta\.json$/.test(p) || /static-servers/.test(p) || /[\\/]agent-sessions$/.test(p));
  for (let i = 0; i < 3; i++) {
    const res = await getPage(w, bound.name, "/page.html");
    assert.equal(res.status, 200);
    assert.ok(res.text.includes('data-lahe-review="' + review.id + '"'), "the same review answers");
    const again = /data-lahe-aliases="([^"]*)"/.exec(res.text);
    assert.deepEqual(again && again[1], aliases && aliases[1], "the same aliases");
  }
  assert.equal(counts.n, 0, "no meta.json or old record read on a page load");
});

test("a meta.json changed on disk by another process is read again on the next load", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "docs");
  writeFile(folder, "page.html", PAGE);
  const fresh = writeFile(folder, "fresh.html", PAGE);
  const session = agentSessions.createStore({ dir: w.state }).create({ name: "t" }).id;
  const first = w.helper.reviews.create({ target_path: path.join(folder, "page.html"), agent_session_id: session, origins: ["null"] });
  const second = w.helper.reviews.create({ target_path: path.join(folder, "other.html"), agent_session_id: session, origins: ["null"], only_recorded_pages: true });
  const bound = w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "page.html" });
  const before = await getPage(w, bound.name, "/fresh.html");
  assert.ok(before.text.includes('data-lahe-review="' + first.id + '"'));
  // What `lahe add --review` does from its own process: the review gains a page.
  const metaFile = path.join(w.state, "reviews", second.id, "meta.json");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  meta.target_paths = (meta.target_paths || []).concat([fresh]);
  fs.writeFileSync(metaFile, JSON.stringify(meta) + "\n");
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(metaFile, later, later);
  const after = await getPage(w, bound.name, "/fresh.html");
  assert.ok(after.text.includes('data-lahe-review="' + second.id + '"'), "the review that recorded the file answers");
});
