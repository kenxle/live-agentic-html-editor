"use strict";

// An Open that fails AFTER its server started (final adversarial review,
// finding 3).
//
// Open reopens a closed session only once the server is up (fix round CX2).
// But registering the new origins can still throw after that, and Open used to
// clear its `reopened` record on any throw. The sweep then never saw a session
// the Library had reopened, and the server it started kept running. Now the
// record is cleared only when start() itself threw; after that point the
// helper closes the session again and stops the server it started.

const test = require("node:test");
const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const stateDir = require("../../src/service/state_dir.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const staticServers = require("../../src/service/static_servers.js");
const catalogReader = require("../../src/service/catalog_reader.js");
const catalogStore = require("../../src/service/catalog_store.js");
const catalogActions = require("../../src/service/catalog_actions.js");

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-open-rollback-")));
}

function serverPids(file) {
  const out = childProcess.spawnSync("pgrep", ["-f", file], { encoding: "utf8" });
  return (out.stdout || "").split("\n").filter(Boolean).map(Number);
}

async function world(t, options) {
  const root = tempDir();
  const dir = path.join(root, "state");
  const site = path.join(root, "site");
  fs.mkdirSync(site);
  const page = path.join(site, "page.html");
  fs.writeFileSync(page, "<!doctype html><title>Page</title><p>page</p>");
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_doc" });
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  reviews.create({ id: "r_page", agent_session_id: "s_doc", target_path: page });
  const first = await staticServers.start({ dir, sessionId: "s_doc", root: site });
  const recordFile = stateDir.staticServerPath(dir, "s_doc", first.meta.id);
  t.after(async () => {
    await staticServers.stopAll(dir, "s_doc").catch(() => {});
    serverPids(recordFile).forEach((pid) => { try { process.kill(pid, "SIGTERM"); } catch (err) { /* gone */ } });
  });
  await staticServers.stopAll(dir, "s_doc");
  store.close("s_doc");
  if (options && options.breakOrigins) {
    reviews.registerOrigin = () => { throw new Error("synthetic: the registry refused the origin"); };
  }
  const catalog = catalogStore.createCatalogStore({ dir });
  const actions = catalogActions.createCatalogActions({
    dir,
    reader: catalogReader.createReader({ dir, pidAlive: () => true, probe: async () => false }),
    queue: { readAttached: () => null },
    store: catalog,
    ops: staticServers.createCatalogOps({ dir, reviews, sessions: store }),
    sessions: store,
    log: () => {}
  });
  return { dir, store, catalog, actions, recordFile };
}

test("an Open whose origin step throws after the server started leaves the session closed and no ss_ server running", async (t) => {
  if (process.platform === "win32") return t.skip("pgrep is not on this platform");
  const w = await world(t, { breakOrigins: true });
  const res = await w.actions.open({ review: "r_page" }, Date.now());
  assert.equal(res.status, 409, JSON.stringify(res));
  assert.equal(res.error.code, "PROTO_NOT_OPENABLE");
  assert.ok(w.store.read("s_doc").closed_at, "closed again");
  assert.ok(staticServers.list(w.dir, "s_doc").every((m) => m.stopped_at), "every record says stopped");
  assert.deepEqual(serverPids(w.recordFile), [], "no server process left running");
});

test("with the same failure, a session the rollback could not close keeps its reopened record for the sweep", async (t) => {
  if (process.platform === "win32") return t.skip("pgrep is not on this platform");
  const w = await world(t, { breakOrigins: true });
  // The close in the rollback fails; the sweep is the only thing left to close it.
  const realClose = w.store.close.bind(w.store);
  let refuse = true;
  w.store.close = (id) => {
    if (refuse) { refuse = false; throw new Error("synthetic: close failed"); }
    return realClose(id);
  };
  const res = await w.actions.open({ review: "r_page" }, Date.now());
  assert.equal(res.status, 409, JSON.stringify(res));
  const read = w.catalog.read();
  assert.ok(read.ok && read.data.reopened && read.data.reopened.s_doc, "the reopen stays recorded");
});

test("a start that throws still clears the reopened record, and the session stays closed", async (t) => {
  const w = await world(t);
  // The real ops, with start() failing: reopenForCatalog marks such an error
  // as the start's own, before anything was reopened.
  const ops = staticServers.createCatalogOps({ dir: w.dir, reviews: { get: () => null }, sessions: w.store });
  const actions = catalogActions.createCatalogActions({
    dir: w.dir,
    reader: catalogReader.createReader({ dir: w.dir, pidAlive: () => true, probe: async () => false }),
    queue: { readAttached: () => null },
    store: w.catalog,
    ops: {
      reopenForCatalog: async () => {
        const err = new Error("synthetic: the server never answered");
        err.stage = staticServers.REOPEN_STAGE.START;
        throw err;
      },
      closeQuiet: ops.closeQuiet
    },
    sessions: w.store,
    log: () => {}
  });
  const res = await actions.open({ review: "r_page" }, Date.now());
  assert.equal(res.status, 409, JSON.stringify(res));
  assert.ok(w.store.read("s_doc").closed_at);
  const read = w.catalog.read();
  assert.equal(read.ok ? (read.data.reopened || {}).s_doc : undefined, undefined);
});
