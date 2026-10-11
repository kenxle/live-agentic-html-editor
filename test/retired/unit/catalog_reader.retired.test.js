// RETIRED by stable addresses Task 4.3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/catalog_reader.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: A row's served_url came from probing a recorded page server for its identity. Page servers are retired; a named site is served, and its address is known from the registry without a probe.
// They are kept as they were, so they still name the helpers they used.

test("served_url is set only when the recorded server answers its exact-identity probe; stopped records are skipped and a probe is not repeated within one POLL_MS", async (t) => {
  const hits = [];
  let identity = null;
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (!identity || req.url !== "/.lahe-static-health/" + identity.id + "/" + identity.instance) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(identity));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const installed = fixture.install();
  const serversDir = path.join(installed.dir, "agent-sessions", "s_coach", "static-servers");
  const retarget = (name) => {
    const file = path.join(serversDir, name + ".json");
    const meta = JSON.parse(fs.readFileSync(file, "utf8"));
    meta.port = port;
    fs.writeFileSync(file, JSON.stringify(meta, null, 2) + "\n");
    return meta;
  };
  const beta = retarget("ss_beta");
  retarget("ss_alphadocs"); // stopped: must never be probed
  identity = { id: beta.id, instance: beta.instance, started_at: beta.started_at, pid: beta.pid };

  const reader = catalogReader.createReader({ dir: installed.dir, home: installed.home, pidAlive: () => true });
  const first = await reader.list(installed.nowMs);
  assert.equal(row(first, "r_spec").served_url, "http://127.0.0.1:" + port + "/spec.html");
  assert.equal(row(first, "r_brief").served_url, null, "a stopped record is not probed");
  assert.equal(hits.length, 1);
  assert.ok(hits.every((url) => url.indexOf("ss_alphadocs") === -1));

  await reader.list(installed.nowMs + protocol.CATALOG.POLL_MS - 1);
  assert.equal(hits.length, 1, "cached for one POLL_MS");
  await reader.list(installed.nowMs + protocol.CATALOG.POLL_MS);
  assert.equal(hits.length, 2, "probed again at POLL_MS");

  identity = Object.assign({}, identity, { pid: identity.pid + 1 });
  const wrong = await reader.list(installed.nowMs + 2 * protocol.CATALOG.POLL_MS);
  assert.equal(row(wrong, "r_spec").served_url, null, "a server with another identity is not this review's");
});

test("CX1: with every server answering, out of order, each row's served_url is its own server's port and path", async () => {
  // Every probe answers true, and later probes answer first, so a callback
  // that closed over a shared `row` or `cover` would write one row's URL onto
  // another.
  const installed = fixture.install();
  // Every record running, so several rows are probed in the one list.
  const sessionsRoot = path.join(installed.dir, "agent-sessions");
  fs.readdirSync(sessionsRoot).forEach((sessionId) => {
    const serversDir = path.join(sessionsRoot, sessionId, "static-servers");
    if (!fs.existsSync(serversDir)) return;
    fs.readdirSync(serversDir).forEach((name) => {
      const file = path.join(serversDir, name);
      let meta;
      try { meta = JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { return; }
      if (!meta || typeof meta !== "object") return;
      meta.stopped_at = null;
      fs.writeFileSync(file, JSON.stringify(meta, null, 2) + "\n");
    });
  });
  const waits = [];
  const probe = (meta) => new Promise((resolve) => { waits.push(() => resolve(true)); });
  const reader = catalogReader.createReader({ dir: installed.dir, home: installed.home, pidAlive: () => true, probe });
  const pending = reader.list(installed.nowMs);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(waits.length >= 2, "at least two rows are probed, got " + waits.length);
  waits.slice().reverse().forEach((go) => go());
  const list = await pending;
  let served = 0;
  rows(list).forEach((r) => {
    if (!r.served_url) return;
    served += 1;
    const d = reader.describeReview(r.id, installed.nowMs);
    const record = staticServers.list(installed.dir, r.session_id).find((m) => m.id === d.server);
    assert.equal(r.served_url, "http://127.0.0.1:" + record.port + d.url_path, r.id);
  });
  const openableYes = rows(list).filter((r) => r.openable === "yes").length;
  assert.equal(served, openableYes, "every openable row got a URL");
  assert.ok(served >= 2, "several rows served, got " + served);
});

