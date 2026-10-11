// RETIRED by stable addresses Step 3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/sites_dispatch.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: The LAHE_PAGES switch is removed: the helper always serves pages.
// They are kept as they were, so they still name the helpers they used.

test("with the switch off, no pages listener opens and service.json says so", async (t) => {
  const w = await sitesWorld(t, { pages: null, pagesPort: null });
  assert.equal(w.helper.pagesPort, null);
  const ready = JSON.parse(fs.readFileSync(path.join(w.state, "service.json"), "utf8"));
  assert.equal(ready.pages.mode, "servers");
  assert.equal(ready.pages.port, null);
});

