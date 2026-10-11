// RETIRED by stable addresses Task 4.3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/catalog_store.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: The reopened map is removed: Open reopens no session, so the store keeps no record of one.
// They are kept as they were, so they still name the helpers they used.

test("the reopened map records a session with its handoff_rev and clears it", () => {
  const store = catalogStore.createCatalogStore({ dir: tempState() });
  assert.equal(store.setReopened("s_one", { at: "2026-09-28T16:21:00.000Z", handoff_rev: 2 }).ok, true);
  assert.deepEqual(store.read().data.reopened, { s_one: { at: "2026-09-28T16:21:00.000Z", handoff_rev: 2 } });
  assert.equal(store.clearReopened("s_one").ok, true);
  assert.deepEqual(store.read().data.reopened, {});
});

