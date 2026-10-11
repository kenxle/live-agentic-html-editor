// RETIRED by stable addresses Task 4.3 (docs/features/20261011.02_stable_addresses).
// These tests were moved out of test/unit/catalog_routes.test.js. Nothing runs this file: test:unit reads
// test/unit/ and Playwright reads test/browser/. Ken approves deleting it at cleanup.
// Why: Open restarted a page server and reopened a closed session, the reopened-session sweep and its Open races are removed. Open binds a site and reopens nothing (V39 to V42).
// They are kept as they were, so they still name the helpers they used.

test("Open on a closed review reopens its session, restarts its server, and returns a loopback URL that serves the page", async (t) => {
  const w = await world(t);
  await staticServers.stopAll(w.dir, "s_doc");
  w.store.close("s_doc");
  const res = await api(w, "catalog.open", { review: "r_page" });
  assert.equal(res.status, 200, res.text);
  assert.match(res.json.url, /^http:\/\/127\.0\.0\.1:\d+\/page\.html$/);
  assert.equal(w.store.read("s_doc").closed_at, null, "the session is open again");
  const served = await fetchText(res.json.url);
  assert.equal(served.status, 200);
  assert.match(served.text, /the page body/);
  const read = catalogJson(w.dir);
  assert.deepEqual(read.data.reopened.s_doc, { at: new Date(T0).toISOString(), handoff_rev: 0 }, "recorded for the sweep");
});

test("sweepReopened closes a Library-reopened session at 30:00 and not at 29:59, then clears its entry", async (t) => {
  const w = await libraryReopened(t);
  const early = await w.helper.sweepReopened(T0 + C.REOPENED_AUTOCLOSE_MS - 1000);
  assert.deepEqual(early.closed, []);
  assert.equal(w.store.read("s_doc").closed_at, null);
  const due = await w.helper.sweepReopened(T0 + C.REOPENED_AUTOCLOSE_MS);
  assert.deepEqual(due.closed, ["s_doc"]);
  assert.ok(w.store.read("s_doc").closed_at, "closed");
  assert.ok(staticServers.list(w.dir, "s_doc").every((m) => m.stopped_at), "its servers stopped");
  assert.equal(catalogJson(w.dir).data.reopened.s_doc, undefined, "the entry is cleared");
});

test("sweepReopened leaves alone a session reopened with lahe session reopen", async (t) => {
  const w = await world(t);
  w.store.close("s_doc");
  w.store.reopen("s_doc");
  const out = await w.helper.sweepReopened(T0 + 10 * C.REOPENED_AUTOCLOSE_MS);
  assert.deepEqual(out.closed, []);
  assert.equal(w.store.read("s_doc").closed_at, null);
});

test("sweepReopened leaves alone a session taken over since the Library reopened it", async (t) => {
  const w = await libraryReopened(t);
  w.store.takeover("s_doc");
  const out = await w.helper.sweepReopened(T0 + C.REOPENED_AUTOCLOSE_MS);
  assert.deepEqual(out.closed, []);
  assert.equal(w.store.read("s_doc").closed_at, null);
  assert.equal(catalogJson(w.dir).data.reopened.s_doc, undefined, "an agent's session now, so the entry goes");
});

test("sweepReopened leaves alone a session whose monitor is live", async (t) => {
  const w = await libraryReopened(t);
  const at = T0 + C.REOPENED_AUTOCLOSE_MS;
  beat(w.store, "s_doc", at);
  const out = await w.helper.sweepReopened(at);
  assert.deepEqual(out.closed, []);
  assert.deepEqual(out.kept, ["s_doc"]);
  assert.equal(w.store.read("s_doc").closed_at, null);
  assert.ok(catalogJson(w.dir).data.reopened.s_doc, "kept for a later sweep");
});

test("sweepReopened counts a held window of the session's reviews as not quiet", async (t) => {
  const w = await libraryReopened(t);
  holdWindow(w.dir, "r_page", T0 + 10 * MINUTE);
  const held = await w.helper.sweepReopened(T0 + C.REOPENED_AUTOCLOSE_MS);
  assert.deepEqual(held.closed, [], "a window held 20 minutes ago keeps it");
  const quiet = await w.helper.sweepReopened(T0 + 10 * MINUTE + C.REOPENED_AUTOCLOSE_MS);
  assert.deepEqual(quiet.closed, ["s_doc"]);
});

test("CX2: an Open whose server cannot restart leaves a closed session closed and records no reopen", async (t) => {
  const w = await world(t);
  await staticServers.stopAll(w.dir, "s_doc");
  w.store.close("s_doc");
  breakServerRoot(w);
  const res = await api(w, "catalog.open", { review: "r_page" });
  assert.equal(res.status, 409, res.text);
  assert.equal(res.json.error.code, "PROTO_NOT_OPENABLE");
  assert.ok(w.store.read("s_doc").closed_at, "still closed: nothing is left for the sweep to find");
  const read = catalogJson(w.dir);
  assert.equal(read.ok ? read.data.reopened.s_doc : undefined, undefined);
});

test("CR4: with catalog.json corrupt, an Open that would reopen a closed session is refused and reopens nothing", async (t) => {
  const w = await world(t);
  await staticServers.stopAll(w.dir, "s_doc");
  w.store.close("s_doc");
  const file = catalogStore.catalogPath(w.dir);
  fs.writeFileSync(file, "{not json");
  const res = await api(w, "catalog.open", { review: "r_page" });
  assert.equal(res.status, 500, res.text);
  assert.equal(res.json.error.code, "PROTO_CATALOG_UNREADABLE");
  assert.ok(w.store.read("s_doc").closed_at, "still closed");
  assert.ok(staticServers.list(w.dir, "s_doc").every((m) => m.stopped_at), "no server started");
  assert.equal(fs.readFileSync(file, "utf8"), "{not json", "left as it was");
});

test("CR1: two concurrent Opens on a closed session start one server, answer on its recorded port, and keep its origin", async (t) => {
  if (process.platform === "win32") return t.skip("pgrep is not on this platform");
  const w = await world(t);
  await staticServers.stopAll(w.dir, "s_doc");
  w.store.close("s_doc");
  const recordFile = stateDir.staticServerPath(w.dir, "s_doc", w.first.meta.id);
  t.after(() => serverPids(recordFile).forEach((pid) => { try { process.kill(pid, "SIGTERM"); } catch (err) { /* gone */ } }));
  const [a, b] = await Promise.all([
    api(w, "catalog.open", { review: "r_page" }),
    api(w, "catalog.open", { review: "r_new" })
  ]);
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  const records = staticServers.list(w.dir, "s_doc");
  assert.equal(records.length, 1, "one ss_ record");
  const port = records[0].port;
  assert.equal(new URL(a.json.url).port, String(port));
  assert.equal(new URL(b.json.url).port, String(port));
  assert.deepEqual(serverPids(recordFile), [records[0].pid], "one server process, no orphan");
  for (const id of ["r_page", "r_new"]) {
    assert.ok(w.helper.reviews.get(id).origins.includes("http://127.0.0.1:" + port), id + " keeps the live origin");
  }
});

test("CR1: the sweep leaves alone a session an Open is part way through bringing back", async () => {
  const catalogActions = require("../../src/service/catalog_actions.js");
  const dir = path.join(tempDir(), "state");
  // The Open owner check (SEC4) stats the record's root, so it has to be a
  // real folder this user owns, or Open refuses before the restart step.
  const root = tempDir();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_doc", name: "doc session" });
  store.close("s_doc");
  let release;
  const closed = [];
  const actions = catalogActions.createCatalogActions({
    dir,
    reader: {
      describeReview: (id) => ({
        review: id, session: "s_doc", openable: "yes", server: "ss_one", server_root: root, url_path: "/page.html",
        served_path: null, path: null, watching: null, last: new Date(T0).toISOString()
      })
    },
    queue: { readAttached: () => null },
    store: catalogStore.createCatalogStore({ dir }),
    ops: {
      reopenForCatalog: (sessionId) => new Promise((resolve) => {
        release = () => { store.reopen(sessionId); resolve({ origin: "http://127.0.0.1:1" }); };
      }),
      closeQuiet: async (sessionId) => { closed.push(sessionId); store.close(sessionId); }
    },
    sessions: store,
    log: () => {}
  });
  const opening = actions.open({ review: "r_page" }, T0 - 2 * C.REOPENED_AUTOCLOSE_MS);
  await new Promise((resolve) => setImmediate(resolve));
  store.reopen("s_doc");
  const during = await actions.sweepReopened(T0);
  assert.deepEqual(during.closed, [], "not closed while its Open is in flight");
  release();
  assert.equal((await opening).status, 200);
  const after = await actions.sweepReopened(T0);
  assert.deepEqual(after.closed, ["s_doc"], "closed once the Open is done and it is quiet");
});

// The helpers those tests used, as they were.

/** Open r_page from a closed session at T0, so the Library owns the reopen. */
async function libraryReopened(t) {
  const w = await world(t);
  await staticServers.stopAll(w.dir, "s_doc");
  w.store.close("s_doc");
  const res = await api(w, "catalog.open", { review: "r_page" });
  assert.equal(res.status, 200, res.text);
  assert.ok(catalogJson(w.dir).data.reopened.s_doc, "the reopen is recorded");
  return w;
}

function holdWindow(dir, reviewId, lastSeenMs) {
  fs.writeFileSync(stateDir.windowsPath(dir), JSON.stringify({
    version: 1,
    saved_at: new Date(lastSeenMs).toISOString(),
    sessions: { [reviewId]: { window_id: "w_test", session_secret: "secret", since: new Date(lastSeenMs).toISOString(), since_ms: lastSeenMs, last_seen: lastSeenMs } }
  }));
}

function breakServerRoot(w) {
  const record = staticServers.list(w.dir, "s_doc")[0];
  record.logical_root = w.site;
  record.root = path.join(w.root, "no-such-root");
  fs.writeFileSync(stateDir.staticServerPath(w.dir, "s_doc", record.id), JSON.stringify(record, null, 2) + "\n");
}

/** Pids of static server processes serving this record file, from the process table. */
function serverPids(file) {
  const out = require("node:child_process").spawnSync("pgrep", ["-f", file], { encoding: "utf8" });
  return (out.stdout || "").split("\n").filter(Boolean).map(Number);
}

