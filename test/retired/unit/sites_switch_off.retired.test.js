// RETIRED by stable addresses Step 3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/sites_cli.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: The LAHE_PAGES switch is removed: the helper always serves pages.
// They are kept as they were, so they still name the helpers they used.

test("with the switch off, lahe review still starts a page server on a loopback port", async (t) => {
  const w = await cliWorld(t, { pages: false });
  const file = writeFile(w.home, "ws/repo/docs/page.html", PAGE);
  const out = review(w, [file]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(openUrl(out), /^http:\/\/127\.0\.0\.1:\d+\/page\.html$/);
  assert.equal(pageServerRecords(w), 1);
  assert.equal(fs.existsSync(path.join(w.state, "sites.json")), false);
});

// --- V6: the single writer ------------------------------------------------------

