// RETIRED by stable addresses Step 3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/helper_freshness.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: Its page server no longer exists; V67 proves an old address loads again after a helper restart.
// They are kept as they were, so they still name the helpers they used.

test("a served review survives the restart: the session, its static server, and the page come back", async () => {
  const pageDir = tempDir("lahe-stale-served-");
  const page = path.join(pageDir, "report.html");
  fs.writeFileSync(page, PAGE);
  const stateDir = path.join(tempDir("lahe-stale-served-state-"), "state");
  const source = scratchSource();
  const port = await freePort();
  const env = { LAHE_SOURCE_DIR: source.dir };
  let sessionId = null;

  try {
    const opened = run("review", [page, "--port", String(port), "--state-dir", stateDir], env);
    assert.equal(opened.code, 0, opened.stdout + opened.stderr);
    sessionId = opened.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
    const openUrl = opened.stdout.match(/^\s*open\s+(http:\/\/\S+)/m)[1];
    const boot = readyFile(stateDir);
    const review = opened.stdout.match(/^\s*review\s+(r[A-Za-z0-9_-]+)/m)[1];
    const eventsPath = path.join(stateDir, "reviews", review, "events.jsonl");
    const eventsBefore = fs.readFileSync(eventsPath, "utf8");
    const metaBefore = fs.readFileSync(path.join(stateDir, "reviews", review, "meta.json"), "utf8");

    // The reviewer has the page open. Now the code changes under the helper.
    setMtime(source.file, Date.parse(boot.started_at) + 1000);
    const again = run("review", [page, "--port", String(port), "--state-dir", stateDir, "--session", sessionId], env);
    assert.equal(again.code, 0, again.stdout + again.stderr);
    assert.match(again.stdout, new RegExp(sourceStamp.REASON));

    const after = readyFile(stateDir);
    assert.notEqual(after.pid, boot.pid, "the helper really was replaced");

    // The static server belongs to the agent session, not to the helper, so it
    // was never in the blast radius: the reviewer's URL still answers, still
    // with the script line put into the response rather than into their folder.
    const served = await fetch(openUrl);
    assert.equal(served.status, 200, "the page the reviewer has open still serves");
    const html = await served.text();
    assert.match(html, new RegExp('data-lahe-review="' + review + '"'), "still on the same review");
    assert.equal(fs.readFileSync(page, "utf8"), PAGE, "and still with nothing written into their folder");

    // The durable record is exactly as it was.
    assert.equal(fs.readFileSync(eventsPath, "utf8"), eventsBefore, "the event log is untouched");
    assert.equal(
      fs.readFileSync(path.join(stateDir, "reviews", review, "meta.json"), "utf8"),
      metaBefore,
      "and so is the review's meta"
    );
    const sessions = run("session", ["list", "--state-dir", stateDir], env);
    assert.equal(sessions.code, 0, sessions.stdout + sessions.stderr);
    assert.match(sessions.stdout, new RegExp(sessionId), "the agent session is still there");
    assert.match(sessions.stdout, /open/, "and still open");
  } finally {
    if (sessionId) {
      run("session", ["close", sessionId, "--state-dir", stateDir, "--port", String(port)], env);
    }
    await stopHelper(stateDir);
  }
});

