// RETIRED by stable addresses Task 4.3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/catalog_lifetime.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: Open no longer reopens a session, so there is no reopened session for the sweep to close and for the Library's poll to take over from.
// They are kept as they were, so they still name the helpers they used.

test("R10a, the Library's own rule: once the sweep closes the reopened session, a fresh Library poll alone keeps the helper up through the last close", async (t) => {
  const w = await started(t);
  const site = path.join(tempDir(), "site");
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, "doc.html"), "<!doctype html><title>Synthetic doc</title><p>still here</p>");
  w.store.create({ id: "s_old" });
  const log = logModule.createEventLog({ dir: w.dir });
  reviewsModule.createReviews({ dir: w.dir, log }).create({ id: "r_old", agent_session_id: "s_old", target_path: path.join(site, "doc.html") });
  await staticServers.start({ dir: w.dir, sessionId: "s_old", root: site });
  t.after(async () => { await staticServers.stopAll(w.dir, "s_old").catch(() => {}); });
  await staticServers.stopAll(w.dir, "s_old");
  w.store.close("s_old");

  const opened = await libraryCall(w.port, "catalog.open", { review: "r_old", handoff: true });
  assert.equal(opened.status, 200, opened.text);
  assert.equal(w.store.read("s_old").closed_at, null, "Open reopened the session");

  // Age the reopen past REOPENED_AUTOCLOSE_MS rather than waiting it out, then
  // let the helper's own sweep (every POLL_MS, on its real clock) close it.
  const store = catalogStore.createCatalogStore({ dir: w.dir });
  const entry = store.read().data.reopened.s_old;
  assert.ok(entry, "the Library recorded the reopen");
  store.setReopened("s_old", {
    at: new Date(Date.now() - C.REOPENED_AUTOCLOSE_MS - 60 * 1000).toISOString(),
    handoff_rev: entry.handoff_rev
  });
  await pollUntil(() => !!w.store.read("s_old").closed_at, {
    timeoutMs: C.POLL_MS * 3,
    message: "the helper's sweep to close the quiet reopened session"
  });

  // Now s_last is the only open session, and nothing but the Library holds the
  // helper: no reopened session, no held document window.
  assert.equal(fs.existsSync(stateDir.windowsPath(w.dir)) && /r_old/.test(fs.readFileSync(stateDir.windowsPath(w.dir), "utf8")), false);
  assert.equal((await libraryCall(w.port, "catalog.list")).status, 200);
  const closed = await close(w.dir, "s_last", Date.now());
  assert.equal(closed.code, protocol.CLI_EXIT.OK, closed.stderr);
  assert.match(closed.stdout, /shared helper left running: the Library page polled it/);
  assert.ok(await health(w.port), "health still answers");
});

