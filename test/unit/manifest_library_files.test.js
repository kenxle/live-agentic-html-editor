// read-when: Changing which manifest entries go into the Library page's built file (libraryFiles in src/shared/manifest.js), or when this test fails.

"use strict";

// A planned entry names a file a later slice creates, so it is not on disk yet.
// The layer's list leaves those out (builtFiles), and the Library page's list
// has to as well, or adding one breaks the build. Each test file runs in its own
// process, so the entries pushed onto the manifest's lists here go nowhere else;
// they are taken off again at the end of each test all the same.

const test = require("node:test");
const assert = require("node:assert/strict");

const manifest = require("../../src/shared/manifest.js");

function withEntry(t, list, entry) {
  list.push(entry);
  t.after(() => {
    list.splice(list.indexOf(entry), 1);
  });
}

test("a planned Library entry is left out of the Library page's file, and a built one is kept", (t) => {
  withEntry(t, manifest.CATALOG_PAGE, { path: "src/browser/library-page/later.ts", registers: [], planned: true });
  const paths = manifest.libraryFiles().map((entry) => entry.path);
  assert.ok(!paths.includes("src/browser/library-page/later.ts"), "the planned entry is not built");
  assert.ok(paths.includes("src/layer/catalog/page.js"), "the page script still is");
});

test("a Library entry that stands for a planned layer entry is left out too", (t) => {
  withEntry(t, manifest.LAYER_FILES, { path: "src/browser/review-layer/later.ts", registers: ["later"], planned: true });
  withEntry(t, manifest.CATALOG_PAGE, { sameAsLayer: "later" });
  const paths = manifest.libraryFiles().map((entry) => entry.path);
  assert.ok(!paths.includes("src/browser/review-layer/later.ts"));
  assert.ok(paths.includes("src/shared/protocol.js"), "the protocol entry still resolves");
});
