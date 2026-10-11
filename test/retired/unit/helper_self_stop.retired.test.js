// RETIRED by stable addresses Step 3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/helper_self_stop.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: There are no page-server processes to stop.
// They are kept as they were, so they still name the helpers they used.

test("a page server exits when its state directory is removed", async (t) => {
  const w = tempState();
  const saved = process.env.LAHE_SELF_STOP_SWEEP_MS;
  process.env.LAHE_SELF_STOP_SWEEP_MS = "50";
  t.after(() => {
    if (saved === undefined) delete process.env.LAHE_SELF_STOP_SWEEP_MS;
    else process.env.LAHE_SELF_STOP_SWEEP_MS = saved;
  });
  t.after(() => stopTempHelpers(w.dir));
  const site = path.join(w.root, "site");
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, "index.html"), "<p>hi</p>");
  const started = await staticServers.start({ dir: w.dir, sessionId: "s_page", root: site });
  const pid = started.meta.pid;
  assert.ok(alive(pid));
  fs.rmSync(w.root, { recursive: true, force: true });
  await pollUntil(() => !alive(pid), { message: "the page server to exit", timeoutMs: 10000 });
});
