// THROWAWAY STUB CONSUMER: 3B (install and add)
//
// Committed by 0A-kernel to prove its stubs are sufficient for 3B (install and add), which is
// the single reason that task exists. It calls every kernel signature 3B (install and add)
// will need and asserts the shape it gets back, so a missing or wrong-shaped
// stub fails HERE, in Phase 0, rather than in 3B (install and add)'s worktree a phase later.
//
// ON THE PHASE 4B CLEANUP BATCH. Delete this file when 3B (install and add) has landed.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const manifest = require("../../src/shared/manifest.js");
const storeModule = require("../../src/layer/store.js");

test("3B knows which built file the script line points at, and it is never the helper", () => {
  assert.equal(manifest.BUNDLE_OUTPUT, "dist/lahe-layer.js");
  assert.equal(manifest.GLOBAL_NAMESPACE, "LAHE");
});

test("3B can record the page a review was added to, static file or dev server", () => {
  const onDisk = record.pageFrom({ origin: "null", pathname: "/Users/x/report.html", href: "file:///Users/x/report.html" });
  assert.equal(onDisk.origin, record.FILE_ORIGIN);
  assert.equal(onDisk.path, "report.html");

  const onServer = record.pageFrom(
    { origin: "http://localhost:3000", pathname: "/clients", href: "http://localhost:3000/clients?page=2", title: "Clients" },
    { seq: 1, source_hint: "app/views/clients/index.html.erb" }
  );
  assert.equal(onServer.path, "/clients");
  assert.equal(onServer.source_hint, "app/views/clients/index.html.erb");
});

test("3B's review id is the store's key, so add twice reuses one bucket", () => {
  const store = storeModule.createStore();
  assert.equal(store.keyFor("rev_abc"), storeModule.KEY_PREFIX + "rev_abc");
  assert.notEqual(store.keyFor("rev_abc"), store.keyFor("rev_def"));
});

test("3B owns add and the bin field; 1A owns the helper API add calls", () => {
  assert.equal(manifest.ownerOf("src/cli/commands/add.js"), "3B");
  assert.equal(manifest.ownerOf("src/service/reviews.js"), "1A");
});
