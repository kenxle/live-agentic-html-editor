// RETIRED by stable addresses Step 3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/sites_mappers.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: The LAHE_PAGES switch is removed, so nothing reads page-server records any more. The switch-off runs of V26, V27, V28 and V30 went with the same change: the loop below now runs the switch-on case only.
// They are kept as they were, so they still name the helpers they used.

test("off: nothing is active, so the registry answers nothing", async (t) => {
  const w = world(t, "off");
  const folder = path.join(w.home, "ws", "repo", "docs");
  writeFile(folder, "page.html", PAGE);
  w.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "page.html" });
  assert.equal(pageRoutes.fileForPage(w.dir, "http://ws.repo.docs.lahe.localhost:" + PAGES_PORT, "/page.html"), null);
  assert.equal(pageRoutes.servesFile(w.dir, path.join(folder, "page.html")), false);
});

