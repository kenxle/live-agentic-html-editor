// RETIRED by stable addresses Task 4.3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/library_address.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: The pages switch is gone: the helper always serves pages, so there is no switch-off Library to keep to two loopback Hosts. The Hosts the Library answers are covered by the remaining V43 tests.
// They are kept as they were, so they still name the helpers they used.

test("V43: with the switch off the Library keeps its two loopback Hosts and nothing else", async (t) => {
  const w = await sitesWorld(t, { pages: null, pagesPort: null });
  const api = w.helper.port;
  for (const host of ["library.lahe.localhost:" + api, "library.lahe.localhost"]) {
    const res = await raw(api, { path: PAGE.path, headers: pageHeaders(host) });
    assert.equal(res.status, 400, host);
    assert.equal(tokenFromPage(res.text), null, host);
  }
  const ok = await raw(api, { path: PAGE.path, headers: pageHeaders("127.0.0.1:" + api) });
  assert.equal(ok.status, 200);
});

