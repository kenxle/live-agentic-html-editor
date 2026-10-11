// RETIRED in the stable addresses fix round (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/sites_step3.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: V34 cannot fail: the idle sweep is gone, so nothing in the helper can stop a page for being idle, and the idle options it passed (idleGraceMs, idleSweepMs) are read by nothing. Code review fix round, finding 10.
// They are kept as they were, so they still name the helpers they used.

test("V34: after the old idle wait with no window open, the page still loads", async (t) => {
  const w = await sitesWorld(t, { helper: { idleGraceMs: 1, idleSweepMs: 1, now: () => Date.now() + 60 * 60 * 1000 } });
  const folder = path.join(w.home, "ws", "repo", "docs");
  const page = writeFile(folder, "page.html", PAGE);
  const session = agentSessions.createStore({ dir: w.state }).create({ name: "idle" }).id;
  w.helper.reviews.create({ target_path: page, agent_session_id: session, origins: ["null"] });
  const bound = w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "page.html" });
  assert.ok(!Object.keys(require.cache).some((file) => /idle_servers\.js$/.test(file)), "the idle sweep is not even loaded");
  // The Library's own sweep, run an hour on: it closes no page. (The reopened-
  // session sweep it once ran beside it is gone with Open's reopen.)
  await w.helper.sweepLibrarySessions(Date.now() + 60 * 60 * 1000);
  const res = await getPage(w, bound.name, "/page.html");
  assert.equal(res.status, 200);
  assert.match(res.text, /still here/);
});


