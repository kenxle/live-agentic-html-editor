// RETIRED by stable addresses Step 3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/heal_script_line.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: A site never stops serving a page, and V26 covers the healer standing down for a served file.
// They are kept as they were, so they still name the helpers they used.

test("a page a live static server is serving is not healed, and loses nothing by it", async (t) => {
  const state = path.join(tempDir(), "state");
  const work = tempDir();
  const page = path.join(work, "page.html");
  fs.writeFileSync(page, BUILT_WITHOUT_LINE);

  const log = logModule.createEventLog({ dir: state });
  const clock = { at: 10000 };
  const reviews = reviewsModule.createReviews({ dir: state, log: log, now: () => clock.at });
  reviews.create({ id: "r1", origins: ["null"], target_path: page, agent_session_id: "s_served" });

  const server = await staticServers.start({ dir: state, sessionId: "s_served", root: work });
  t.after(async () => { await staticServers.stopAll(state, "s_served"); });

  reviews.targetMtime("r1");
  clock.at += 2000;
  const mtime = reviews.targetMtime("r1");

  assert.ok(mtime, "the reload trigger still reports the file's mtime, which is what R36 rides");
  assert.equal(
    fs.readFileSync(page, "utf8"),
    BUILT_WITHOUT_LINE,
    "the reviewer's own file is byte for byte what their build wrote"
  );
  assert.equal(
    fs.existsSync(path.join(work, "lahe-layer.js")),
    false,
    "and no copy of the bundle was left beside it either"
  );

  // Nothing is lost: the rail arrives with the page, from the server.
  const res = await fetch("http://" + server.meta.host + ":" + server.meta.port + "/page.html");
  const body = await res.text();
  assert.equal(scriptLine.reviewAlreadyInFile(body), "r1", "the served response carries the line the file does not");
});


test("the same page stops being served, and the healer takes it back over", async (t) => {
  const state = path.join(tempDir(), "state");
  const work = tempDir();
  const page = path.join(work, "page.html");
  fs.writeFileSync(page, BUILT_WITHOUT_LINE);

  const log = logModule.createEventLog({ dir: state });
  const clock = { at: 10000 };
  const reviews = reviewsModule.createReviews({ dir: state, log: log, now: () => clock.at });
  reviews.create({ id: "r1", origins: ["null"], target_path: page, agent_session_id: "s_stops" });

  await staticServers.start({ dir: state, sessionId: "s_stops", root: work });
  t.after(async () => { await staticServers.stopAll(state, "s_stops"); });
  reviews.targetMtime("r1");
  clock.at += 2000;
  reviews.targetMtime("r1");
  assert.equal(fs.readFileSync(page, "utf8"), BUILT_WITHOUT_LINE, "nothing written while it was served");

  // The session closed, so the injecting server is gone. A file:// reader is
  // all the reviewer has left, and the on-disk line is the only thing that
  // carries the rail there.
  await staticServers.stopAll(state, "s_stops");
  fs.writeFileSync(page, BUILT_WITHOUT_LINE + "<!-- rebuilt -->\n");
  clock.at += 2000;
  reviews.targetMtime("r1");
  clock.at += 2000;
  reviews.targetMtime("r1");

  assert.equal(
    scriptLine.reviewAlreadyInFile(fs.readFileSync(page, "utf8")),
    "r1",
    "with nothing serving it, the healer is back on the file"
  );
});
