// Library Task 1.3: restarting one recorded static server, keeping its port
// history, swapping its stale loopback origins for the new ones, and the Host
// check on every static server.
//
// The Library's Open restarts a closed review's own recorded server. A server
// restarted on port 0 comes back on a random port that no review has
// registered, so the rail on it is refused; and the old port's origins stay on
// the review for good, which both leaves a door open for whatever takes that
// port next and walks the review toward ORIGIN_LIMIT. So a restart prefers the
// old port, and when it cannot have it, it registers the new origin and
// removes this server's old loopback origins, and only those.
//
// Every test uses its own temporary state dir, and no port is fixed: 7817 is
// never touched.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const staticServers = require("../../src/service/static_servers.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const sessionsModule = require("../../src/service/agent_sessions.js");
const stateDirModule = require("../../src/service/state_dir.js");
const protocol = require("../../src/shared/protocol.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** One GET with a chosen Host header (or none: HTTP/1.0 lets a request omit it). */
function rawGet(port, pathname, hostHeader) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host: "127.0.0.1", port }, () => {
      const lines = [(hostHeader === null ? "GET " + pathname + " HTTP/1.0" : "GET " + pathname + " HTTP/1.1")];
      if (hostHeader !== null) lines.push("Host: " + hostHeader);
      lines.push("Connection: close", "", "");
      socket.write(lines.join("\r\n"));
    });
    const chunks = [];
    socket.on("data", (chunk) => chunks.push(chunk));
    socket.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      const status = Number((/^HTTP\/1\.[01] (\d{3})/.exec(text) || [])[1]);
      const body = text.slice(text.indexOf("\r\n\r\n") + 4);
      resolve({ status, body });
    });
    socket.on("error", reject);
  });
}

/** Hold a loopback port so a restart cannot have it. */
function holdPort(port) {
  return new Promise((resolve, reject) => {
    // Every connection is dropped at once, so a probe of the held port fails
    // fast and closing the holder never waits on a socket.
    const server = net.createServer((socket) => socket.destroy());
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

// freePort: a free loopback port, for an origin nothing is listening on.
// portInUse: whether a parallel test took a freed port.
const { freePort, portInUse } = require("../helpers/free_port.js");

/**
 * One session with one single-page review, served by one static server, the
 * shape `lahe review page.html` leaves behind, with the server's origins
 * registered the way `lahe review` registers them.
 */
async function fixture() {
  const root = tempDir("lahe-restart-root-");
  const state = path.join(tempDir("lahe-restart-state-"), "state");
  const page = path.join(root, "page.html");
  fs.writeFileSync(page, "<!doctype html><p>restart me</p>");
  const sessionId = "s_restart";
  const store = sessionsModule.createStore({ dir: state });
  store.create({ id: sessionId });
  const log = logModule.createEventLog({ dir: state });
  const reviews = reviewsModule.createReviews({ dir: state, log: log });
  const review = reviews.create({ id: "r_restart", origins: [], target_path: page, agent_session_id: sessionId });
  const first = await staticServers.start({ dir: state, sessionId, root });
  reviews.registerOrigin(review.id, "http://127.0.0.1:" + first.meta.port);
  reviews.registerOrigin(review.id, "http://localhost:" + first.meta.port);
  const ops = staticServers.createCatalogOps({ dir: state, reviews, sessions: store });
  return { root, state, page, sessionId, store, log, reviews, review, first, ops };
}

/** A POST to the helper as the page at `origin` would send it, checked the way auth.js checks it. */
function postFrom(reviews, reviewId, origin) {
  return protocol.checkRequest(
    {
      routeName: "events.append",
      review: reviewId,
      headers: {
        [protocol.HEADER.HOST]: "127.0.0.1:" + protocol.DEFAULT_PORT,
        [protocol.HEADER.CLIENT]: protocol.CLIENTS[0],
        [protocol.HEADER.TOKEN]: reviews.get(reviewId).token,
        [protocol.HEADER.CONTENT_TYPE]: "application/json",
        [protocol.HEADER.ORIGIN]: origin
      }
    },
    reviews.config()
  );
}

function loopback(port) {
  return ["http://127.0.0.1:" + port, "http://localhost:" + port];
}

// ---------------------------------------------------------------------------
// The Host check
// ---------------------------------------------------------------------------

test("a static server accepts 127.0.0.1 and localhost at its own port", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const port = f.first.meta.port;
  for (const host of ["127.0.0.1:" + port, "localhost:" + port]) {
    assert.equal((await rawGet(port, "/page.html", host)).status, 200, "page under " + host);
    assert.equal((await rawGet(port, staticServers.LIBRARY_PATH, host)).status, 200, "library under " + host);
    assert.equal((await rawGet(port, "/nope.html", host)).status, 404, "a missing page under " + host);
  }
});

test("a static server refuses another port, a foreign name, and a missing Host, on every path", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const port = f.first.meta.port;
  const other = port === 65535 ? port - 1 : port + 1;
  const refusedHosts = ["127.0.0.1:" + other, "localhost:" + other, "evil.test", "evil.test:" + port, "127.0.0.1", null];
  for (const host of refusedHosts) {
    for (const pathname of ["/page.html", staticServers.LIBRARY_PATH, "/nope.html"]) {
      const res = await rawGet(port, pathname, host);
      assert.equal(res.status, 400, JSON.stringify(host) + " on " + pathname + " must be refused");
      assert.doesNotMatch(res.body, /restart me/, "no page bytes behind a refused Host");
    }
  }
});

// ---------------------------------------------------------------------------
// Restart, preferred port, port history
// ---------------------------------------------------------------------------

test("a restart reuses the old port when it is free, and the record keeps its port history", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const oldPort = f.first.meta.port;
  assert.deepEqual(f.first.meta.ports, [oldPort], "a fresh server records the port it took");
  await staticServers.stopAll(f.state, f.sessionId);

  const result = await f.ops.reopenForCatalog(f.sessionId, f.first.meta.id);
  assert.equal(result.started, true);
  if (result.server.port !== oldPort) {
    // Between the stop and the restart, another test running in parallel can
    // bind the freed port. Then the restart rightly takes a new one; that is
    // accepted only when a holder really has the old port, and the record
    // must still keep its history.
    assert.equal(await portInUse(oldPort), true, "the old port was skipped although nothing holds it");
    assert.deepEqual(result.server.ports, [oldPort, result.server.port]);
    return;
  }
  assert.equal(result.server.port, oldPort, "the old port, so an old tab's URL works again");
  assert.deepEqual(result.server.ports, [oldPort], "a reused port is not recorded twice");
  assert.equal((await rawGet(oldPort, "/page.html", "127.0.0.1:" + oldPort)).status, 200);
  assert.equal(postFrom(f.reviews, f.review.id, "http://127.0.0.1:" + oldPort).ok, true, "the old origin still works");
});

test("with the old port held, the restart takes a new port, registers it, and the old origin is refused", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const oldPort = f.first.meta.port;
  await staticServers.stopAll(f.state, f.sessionId);
  const holder = await holdPort(oldPort);
  t.after(() => closeServer(holder));

  const result = await f.ops.reopenForCatalog(f.sessionId, f.first.meta.id);
  const newPort = result.server.port;
  assert.notEqual(newPort, oldPort);
  assert.deepEqual(result.server.ports, [oldPort, newPort], "oldest first");
  assert.deepEqual(staticServers.list(f.state, f.sessionId)[0].ports, [oldPort, newPort], "on disk too");
  assert.equal(result.origin, "http://127.0.0.1:" + newPort);
  assert.deepEqual(result.reviews, [f.review.id]);

  const origins = f.reviews.get(f.review.id).origins;
  loopback(newPort).forEach((origin) => assert.ok(origins.includes(origin), origin + " is registered"));
  loopback(oldPort).forEach((origin) => assert.ok(!origins.includes(origin), origin + " is removed"));
  assert.equal(postFrom(f.reviews, f.review.id, "http://127.0.0.1:" + newPort).ok, true);
  assert.equal(postFrom(f.reviews, f.review.id, "http://localhost:" + newPort).ok, true);
  for (const origin of loopback(oldPort)) {
    const refused = postFrom(f.reviews, f.review.id, origin);
    assert.equal(refused.ok, false, origin + " must be refused");
    assert.equal(refused.check, protocol.CHECK.ORIGIN);
  }

  const events = f.log.read(f.review.id).filter((event) => event.event === protocol.EVENT.ORIGIN_REMOVED);
  assert.deepEqual(events.map((event) => event.origin || event.payload.origin).sort(), loopback(oldPort).sort());
});

test("after a helper restart the old origin stays refused and every other origin is untouched", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const oldPort = f.first.meta.port;

  // A second server of the same session, on another folder, whose origin the
  // review also carries; a dev server; and a non-loopback origin.
  const otherRoot = tempDir("lahe-restart-other-");
  fs.writeFileSync(path.join(otherRoot, "other.html"), "<!doctype html><p>other</p>");
  const other = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: otherRoot });
  const devPort = await freePort();
  const keep = [
    "http://127.0.0.1:" + other.meta.port,
    "http://localhost:" + other.meta.port,
    "http://localhost:" + devPort,
    "https://docs.example.test",
    "null"
  ];
  keep.forEach((origin) => f.reviews.registerOrigin(f.review.id, origin));

  await staticServers.stopOne(f.state, f.sessionId, staticServers.list(f.state, f.sessionId).find((m) => m.id === f.first.meta.id));
  const holder = await holdPort(oldPort);
  t.after(() => closeServer(holder));
  const result = await f.ops.reopenForCatalog(f.sessionId, f.first.meta.id);
  const newPort = result.server.port;

  // A new helper reads meta.json.
  const fresh = reviewsModule.createReviews({ dir: f.state, log: logModule.createEventLog({ dir: f.state }) });
  fresh.loadFromDisk();
  loopback(oldPort).forEach((origin) => assert.equal(postFrom(fresh, f.review.id, origin).ok, false, origin));
  loopback(newPort).concat(keep).forEach((origin) => assert.equal(postFrom(fresh, f.review.id, origin).ok, true, origin));

  // A new helper that has to rebuild the review from its log applies
  // origin.removed in order with origin.registered.
  fs.unlinkSync(stateDirModule.metaPath(f.state, f.review.id));
  const recovered = reviewsModule.createReviews({ dir: f.state, log: logModule.createEventLog({ dir: f.state }) });
  recovered.loadFromDisk();
  loopback(oldPort).forEach((origin) => assert.equal(postFrom(recovered, f.review.id, origin).ok, false, origin));
  loopback(newPort).concat(keep).forEach((origin) => assert.equal(postFrom(recovered, f.review.id, origin).ok, true, origin));
});

test("an origin removed and then registered again is held after a rebuild from the log", () => {
  const state = path.join(tempDir("lahe-restart-order-"), "state");
  const reviews = reviewsModule.createReviews({ dir: state, log: logModule.createEventLog({ dir: state }) });
  reviews.create({ id: "r_order", origins: ["http://127.0.0.1:40001"] });
  reviews.removeOrigin("r_order", "http://127.0.0.1:40001");
  assert.ok(!reviews.get("r_order").origins.includes("http://127.0.0.1:40001"));
  reviews.registerOrigin("r_order", "http://127.0.0.1:40001");
  fs.unlinkSync(stateDirModule.metaPath(state, "r_order"));
  const recovered = reviewsModule.createReviews({ dir: state, log: logModule.createEventLog({ dir: state }) });
  recovered.loadFromDisk();
  assert.deepEqual(recovered.get("r_order").origins, ["http://127.0.0.1:40001"]);
});

test("removeOrigin refuses anything but a plain loopback http origin", () => {
  const state = path.join(tempDir("lahe-restart-guard-"), "state");
  const reviews = reviewsModule.createReviews({ dir: state, log: logModule.createEventLog({ dir: state }) });
  const held = ["http://localhost:3000", "https://docs.example.test", "null", "https://localhost:4443"];
  reviews.create({ id: "r_guard", origins: held });
  ["https://docs.example.test", "null", "https://localhost:4443"].forEach((origin) => {
    assert.throws(() => reviews.removeOrigin("r_guard", origin), /loopback/);
  });
  assert.deepEqual(reviews.get("r_guard").origins, held);
});

// ---------------------------------------------------------------------------
// reopenForCatalog and closeQuiet
// ---------------------------------------------------------------------------

test("reopenForCatalog restarts the server and reopens a closed session", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  await f.ops.closeQuiet(f.sessionId);
  assert.ok(f.store.read(f.sessionId).closed_at, "closeQuiet closed the session");
  assert.equal(await staticServers.isExactServer(f.first.meta), false, "and stopped its server");

  const result = await f.ops.reopenForCatalog(f.sessionId, f.first.meta.id);
  assert.equal(f.store.read(f.sessionId).closed_at, null);
  assert.equal(result.started, true);
  assert.equal(await staticServers.isExactServer(result.server), true);
});

test("reopenForCatalog on a server that is already up starts nothing", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const result = await f.ops.reopenForCatalog(f.sessionId, f.first.meta.id);
  assert.equal(result.started, false);
  assert.equal(result.server.instance, f.first.meta.instance);
  assert.equal(result.origin, "http://127.0.0.1:" + f.first.meta.port);
});

test("reopenForCatalog restarts only the one server it names", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const otherRoot = tempDir("lahe-restart-only-");
  fs.writeFileSync(path.join(otherRoot, "other.html"), "<!doctype html><p>other</p>");
  const other = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: otherRoot });
  await staticServers.stopAll(f.state, f.sessionId);

  await f.ops.reopenForCatalog(f.sessionId, f.first.meta.id);
  const records = staticServers.list(f.state, f.sessionId);
  const otherNow = records.find((m) => m.id === other.meta.id);
  assert.ok(otherNow.stopped_at, "the other server stays stopped");
  assert.equal(await staticServers.isExactServer(otherNow), false);
});

test("reopenForCatalog refuses a server id the session never recorded", async () => {
  const f = await fixture();
  try {
    await assert.rejects(f.ops.reopenForCatalog(f.sessionId, "ss_0000000000000000"), /no recorded static server/);
    await assert.rejects(f.ops.reopenForCatalog(f.sessionId, "../ss_x"), /no recorded static server/);
  } finally {
    await staticServers.stopAll(f.state, f.sessionId);
  }
});

test("closeQuiet stops the session's servers and closes it without touching the helper", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const result = await f.ops.closeQuiet(f.sessionId);
  assert.equal(result.stopped, 1);
  assert.ok(f.store.read(f.sessionId).closed_at);
  assert.ok(staticServers.list(f.state, f.sessionId)[0].stopped_at);
});

// ---------------------------------------------------------------------------
// `lahe session reopen` keeps working, and now prefers the old port too
// ---------------------------------------------------------------------------

test("restartAll prefers each server's old port", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const oldPort = f.first.meta.port;
  await staticServers.stopAll(f.state, f.sessionId);
  assert.equal(await staticServers.restartAll(f.state, f.sessionId), 1);
  const now = staticServers.list(f.state, f.sessionId)[0];
  if (now.port !== oldPort) {
    // A parallel test took the freed port: accepted only when one really did.
    assert.equal(await portInUse(oldPort), true, "the old port was skipped although nothing holds it");
    return;
  }
  assert.equal(now.port, oldPort);
  assert.equal(http.STATUS_CODES[(await rawGet(oldPort, "/page.html", "localhost:" + oldPort)).status], "OK");
});

test("a port another server of the session is on now keeps its origins, even if this server once had it", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const otherRoot = tempDir("lahe-restart-reused-");
  fs.writeFileSync(path.join(otherRoot, "other.html"), "<!doctype html><p>other</p>");
  const other = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: otherRoot });
  loopback(other.meta.port).forEach((origin) => f.reviews.registerOrigin(f.review.id, origin));

  // This server's history says it once had the port the other server is on.
  await staticServers.stopOne(f.state, f.sessionId, staticServers.list(f.state, f.sessionId).find((m) => m.id === f.first.meta.id));
  const file = stateDirModule.staticServerPath(f.state, f.sessionId, f.first.meta.id);
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  record.ports = [other.meta.port, record.port];
  fs.writeFileSync(file, JSON.stringify(record, null, 2) + "\n");

  const result = await f.ops.reopenForCatalog(f.sessionId, f.first.meta.id);
  assert.deepEqual(result.removed, []);
  loopback(other.meta.port).forEach((origin) => assert.equal(postFrom(f.reviews, f.review.id, origin).ok, true, origin));
});

test("CL3: reopenForCatalog registers the new origin on a review served through one of the server's mounts, by the one coverage rule", async (t) => {
  const f = await fixture();
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const mountDir = fs.realpathSync(tempDir("lahe-restart-mount-"));
  const figure = path.join(mountDir, "figure.html");
  fs.writeFileSync(figure, "<!doctype html><p>mounted</p>");
  f.reviews.create({ id: "r_mounted", origins: [], target_path: figure, agent_session_id: f.sessionId });
  await staticServers.stopAll(f.state, f.sessionId);
  const record = staticServers.list(f.state, f.sessionId)[0];
  record.mounts = { "/.lahe-source/abc123/": mountDir };
  fs.writeFileSync(stateDirModule.staticServerPath(f.state, f.sessionId, record.id), JSON.stringify(record, null, 2) + "\n");
  assert.notEqual(staticServers.coveragePath(record, figure), null, "the coverage rule covers it through the mount");

  const result = await f.ops.reopenForCatalog(f.sessionId, record.id, "r_mounted");
  assert.ok(result.reviews.includes("r_mounted"), "the mounted review is one this server serves");
  assert.ok(result.reviews.includes(f.review.id), "and so is the root's own review");
  loopback(result.server.port).forEach((origin) => {
    assert.ok(f.reviews.get("r_mounted").origins.includes(origin), origin + " is registered on the mounted review");
  });
});
