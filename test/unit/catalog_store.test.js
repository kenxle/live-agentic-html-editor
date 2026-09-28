"use strict";

// The catalog store: the only reader and writer of <state>/catalog.json (stars
// and the reopened map). LAHE Library plan, Task 1.1; architecture "Files".

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const catalogStore = require("../../src/service/catalog_store.js");

function tempState() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-catalog-store-")), "state");
}

test("a state dir with no catalog.json reads as no stars and no reopened sessions", () => {
  const store = catalogStore.createCatalogStore({ dir: tempState() });
  const read = store.read();
  assert.equal(read.ok, true);
  assert.deepEqual(read.data, { schema: 1, stars: {}, reopened: {} });
});

test("a star is written, read back, and removed by unstarring", () => {
  const dir = tempState();
  const store = catalogStore.createCatalogStore({ dir });
  const starred = store.setStar("r_alpha1", true, "2026-09-28T16:20:00.000Z");
  assert.equal(starred.ok, true);
  assert.deepEqual(store.read().data.stars, { r_alpha1: "2026-09-28T16:20:00.000Z" });
  // A second store over the same directory sees it: it is on disk, not in memory.
  assert.deepEqual(catalogStore.createCatalogStore({ dir }).read().data.stars, { r_alpha1: "2026-09-28T16:20:00.000Z" });
  assert.equal(store.setStar("r_alpha1", false, "2026-09-28T16:21:00.000Z").ok, true);
  assert.deepEqual(store.read().data.stars, {});
});

test("the file is owner-only and keeps the architecture's shape", () => {
  const dir = tempState();
  const store = catalogStore.createCatalogStore({ dir });
  store.setStar("r_alpha1", true, "2026-09-28T16:20:00.000Z");
  store.setReopened("s_one", { at: "2026-09-28T16:21:00.000Z", handoff_rev: 4 });
  const file = catalogStore.catalogPath(dir);
  assert.equal(path.basename(file), "catalog.json");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), {
    schema: 1,
    stars: { r_alpha1: "2026-09-28T16:20:00.000Z" },
    reopened: { s_one: { at: "2026-09-28T16:21:00.000Z", handoff_rev: 4 } }
  });
});

test("the reopened map records a session with its handoff_rev and clears it", () => {
  const store = catalogStore.createCatalogStore({ dir: tempState() });
  assert.equal(store.setReopened("s_one", { at: "2026-09-28T16:21:00.000Z", handoff_rev: 2 }).ok, true);
  assert.deepEqual(store.read().data.reopened, { s_one: { at: "2026-09-28T16:21:00.000Z", handoff_rev: 2 } });
  assert.equal(store.clearReopened("s_one").ok, true);
  assert.deepEqual(store.read().data.reopened, {});
});

test("an unsafe review or session id is refused before anything is written", () => {
  const dir = tempState();
  const store = catalogStore.createCatalogStore({ dir });
  assert.throws(() => store.setStar("../etc", true, "2026-09-28T16:20:00.000Z"), /id/);
  assert.throws(() => store.setReopened("a/b", { at: "2026-09-28T16:20:00.000Z", handoff_rev: 0 }), /id/);
  assert.equal(fs.existsSync(catalogStore.catalogPath(dir)), false);
});

for (const [label, bytes] of [
  ["not JSON", "{ this is not json"],
  ["the wrong schema", JSON.stringify({ schema: 2, stars: {}, reopened: {} })],
  ["stars that are not an object", JSON.stringify({ schema: 1, stars: [], reopened: {} })]
]) {
  test("a corrupt catalog.json (" + label + ") reads as unreadable and every write is refused with its bytes unchanged", () => {
    const dir = tempState();
    fs.mkdirSync(dir, { recursive: true });
    const file = catalogStore.catalogPath(dir);
    fs.writeFileSync(file, bytes);
    const store = catalogStore.createCatalogStore({ dir });
    const read = store.read();
    assert.equal(read.ok, false);
    assert.equal(read.code, "PROTO_CATALOG_UNREADABLE");
    for (const attempt of [
      () => store.setStar("r_alpha1", true, "2026-09-28T16:20:00.000Z"),
      () => store.setReopened("s_one", { at: "2026-09-28T16:21:00.000Z", handoff_rev: 1 }),
      () => store.clearReopened("s_one")
    ]) {
      const result = attempt();
      assert.equal(result.ok, false);
      assert.equal(result.code, "PROTO_CATALOG_UNREADABLE");
    }
    assert.equal(fs.readFileSync(file, "utf8"), bytes);
  });
}

test("a symlinked catalog.json is refused rather than followed", () => {
  const dir = tempState();
  fs.mkdirSync(dir, { recursive: true });
  const elsewhere = path.join(path.dirname(dir), "elsewhere.json");
  fs.writeFileSync(elsewhere, JSON.stringify({ schema: 1, stars: {}, reopened: {} }));
  fs.symlinkSync(elsewhere, catalogStore.catalogPath(dir));
  const store = catalogStore.createCatalogStore({ dir });
  assert.equal(store.read().ok, false);
  const refused = store.setStar("r_alpha1", true, "2026-09-28T16:20:00.000Z");
  assert.equal(refused.ok, false);
  assert.equal(refused.code, "PROTO_CATALOG_UNREADABLE");
  assert.equal(fs.readFileSync(elsewhere, "utf8"), JSON.stringify({ schema: 1, stars: {}, reopened: {} }));
});
