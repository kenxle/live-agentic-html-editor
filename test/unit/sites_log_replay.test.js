// A name is appended to sites.log and then written to sites.json. A crash
// between the two left sites.json parseable but missing the name, and load()
// never read the log past a good sites.json, so a printed address went dead
// after the restart. load() now replays sites.log over sites.json.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const sitesModule = require("../../src/service/sites.js");
const { tempRoot, writeFile } = require("../helpers/sites_world.js");

function world() {
  const root = tempRoot("lahe-sites-replay-");
  const home = path.join(root, "home");
  const dir = path.join(root, "state");
  fs.mkdirSync(home);
  writeFile(home, "ws/one/a.html", "<p>a</p>");
  writeFile(home, "ws/two/b.html", "<p>b</p>");
  return { root, home, dir };
}

test("a name in sites.log but not in sites.json survives the restart", () => {
  const w = world();
  const sites = sitesModule.createSites({ dir: w.dir, home: w.home });
  sites.load();
  const first = sites.bind({ root: path.join(w.home, "ws/one"), mode: "folder", entry: "a.html" });
  const jsonFile = path.join(w.dir, "sites.json");
  const beforeSecond = fs.readFileSync(jsonFile, "utf8");
  const second = sites.bind({ root: path.join(w.home, "ws/two"), mode: "folder", entry: "b.html" });
  // The crash: the log line landed, the sites.json write did not.
  fs.writeFileSync(jsonFile, beforeSecond);

  const lines = [];
  const again = sitesModule.createSites({ dir: w.dir, home: w.home, log: (line) => lines.push(line) });
  again.load();
  assert.ok(again.get(first.name), "the name sites.json had");
  assert.ok(again.get(second.name), "the name only the log had");
  assert.equal(again.get(second.name).root, path.join(w.home, "ws/two"));
  assert.ok(JSON.parse(fs.readFileSync(jsonFile, "utf8")).sites[second.name], "sites.json is written again with it");
  assert.ok(lines.some((l) => /sites\.log/.test(l)), "and the helper log says so");
});

test("a reader replays the log too, and writes nothing", () => {
  const w = world();
  const sites = sitesModule.createSites({ dir: w.dir, home: w.home });
  sites.load();
  sites.bind({ root: path.join(w.home, "ws/one"), mode: "folder", entry: "a.html" });
  const jsonFile = path.join(w.dir, "sites.json");
  const beforeSecond = fs.readFileSync(jsonFile, "utf8");
  const second = sites.bind({ root: path.join(w.home, "ws/two"), mode: "folder", entry: "b.html" });
  fs.writeFileSync(jsonFile, beforeSecond);
  const reader = sitesModule.createSites({ dir: w.dir, home: w.home, reader: true });
  reader.load();
  assert.ok(reader.get(second.name));
  assert.equal(fs.readFileSync(jsonFile, "utf8"), beforeSecond);
});
