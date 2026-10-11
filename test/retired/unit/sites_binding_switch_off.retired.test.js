// RETIRED by stable addresses Step 3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/sites_binding.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: The LAHE_PAGES switch is removed: the helper always serves pages.
// They are kept as they were, so they still name the helpers they used.

test("V24: with the switch off, a site origin is never accepted", async (t) => {
  const w = await sitesWorld(t, { pages: null, pagesPort: null });
  const folder = path.join(w.home, "ws", "repo", "docs");
  const page = writeFile(folder, "page.html", PAGE);
  const review = w.helper.reviews.create({ target_path: page, agent_session_id: "s1" });
  w.helper.sites.bind({ root: folder, mode: "folder", entry: "page.html" });
  const res = await readReview(w, review.id, review.token, "http://repo.docs.lahe.localhost:1483");
  assert.equal(res.status, 403);
});

// --- the page the bind printed loads with that review's rail ----------------------

