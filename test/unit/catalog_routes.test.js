// The Library's API routes, wired (LAHE Library, Task 2.1).
//
// Plan: "Routes, lifetime, drain text and log (2.1)" in the Test List.
// Architecture: Key Flows (Open, Star, Launch), Helper lifetime, The log line.
//
// Every test runs a real helper in this process on port 0 against its own
// temporary state dir, with the helper's clock injected (`now`), and speaks raw
// HTTP with the headers the Library page sends. Static servers are real child
// processes and every test stops the ones it started. Nothing uses port 7817
// or the real state dir, and nothing sleeps.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");
const stateDir = require("../../src/service/state_dir.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const staticServers = require("../../src/service/static_servers.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const catalogStore = require("../../src/service/catalog_store.js");

const C = protocol.CATALOG;
const T0 = Date.parse("2026-09-28T16:00:00.000Z");
const MINUTE = 60 * 1000;
const SECRET = "SECRET-3b1f-outside-the-recorded-root";

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix || "lahe-catalog-routes-")));
}

/** A live monitor heartbeat for a session, as `lahe monitor` writes it. */
function beat(store, id, nowMs, primary) {
  const rev = agentSessions.handoffRev(store.read(id));
  store.writeMonitor(id, { pid: process.pid, handoff_rev: rev, at: new Date(nowMs).toISOString(), primary });
}

/**
 * The world most tests share:
 *
 *   s_doc    owns r_page, a single-page review served by a real static server,
 *            and r_dev, a review with no file (a dev server's), and r_gone,
 *            whose file was deleted
 *   s_agent  the agent that opened the Library: attached, with a live monitor
 *
 * The helper is served last, so it loads every review from disk.
 */
async function world(t, options) {
  const opts = options || {};
  const root = tempDir();
  const dir = path.join(root, "state");
  const site = path.join(root, "site");
  fs.mkdirSync(site);
  const page = path.join(site, "page.html");
  fs.writeFileSync(page, "<!doctype html><title>Synthetic page</title><p>the page body</p>");
  const page2 = path.join(site, "page2.html");
  fs.writeFileSync(page2, "<!doctype html><title>Second synthetic page</title><p>second</p>");
  const gone = path.join(site, "gone.html");
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_doc", name: "doc session" });
  store.create({ id: "s_agent", name: "library agent" });
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  reviews.create({ id: "r_page", agent_session_id: "s_doc", target_path: page });
  reviews.create({ id: "r_new", agent_session_id: "s_doc", target_path: page2 });
  reviews.create({ id: "r_dev", agent_session_id: "s_doc" });
  reviews.create({ id: "r_gone", agent_session_id: "s_doc", target_path: gone });
  const first = await staticServers.start({ dir, sessionId: "s_doc", root: site });
  reviews.registerOrigin("r_page", "http://127.0.0.1:" + first.meta.port);
  reviews.registerOrigin("r_page", "http://localhost:" + first.meta.port);
  reviews.registerOrigin("r_new", "http://127.0.0.1:" + first.meta.port);
  reviews.registerOrigin("r_new", "http://localhost:" + first.meta.port);
  t.after(async () => {
    await staticServers.stopAll(dir, "s_doc").catch(() => {});
  });
  if (opts.attach !== false) {
    catalogRequests.writeAttach(dir, "s_agent", T0 - MINUTE);
    beat(store, "s_agent", T0);
  }
  const clock = { now: T0 };
  const helper = await service.serve(
    Object.assign({ port: 0, stateDir: dir, quiet: true, now: () => clock.now }, opts.serve || {})
  );
  t.after(() => helper.close());
  const token = await libraryToken(helper.port);
  return { root, dir, site, page, gone, store, reviews, first, helper, token, clock };
}

/** One raw request. Headers are sent exactly as given. */
function raw(port, options) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: "127.0.0.1", port, method: options.method || "GET", path: options.path, headers: options.headers || {}, setHost: false },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try { json = JSON.parse(text); } catch (err) { json = null; }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      }
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

async function libraryToken(port) {
  const res = await raw(port, {
    path: protocol.CATALOG_PAGE_PATH,
    headers: { host: "127.0.0.1:" + port, "sec-fetch-site": "none" }
  });
  assert.equal(res.status, 200);
  const m = new RegExp('<meta name="' + protocol.CATALOG_TOKEN_META + '" content="([^"]*)"').exec(res.text);
  assert.ok(m, "the page carries the token");
  return m[1];
}

/** A Library API call, with exactly the headers the page sends. */
function api(w, name, body, token) {
  const r = protocol.route(name);
  const headers = {
    host: "127.0.0.1:" + w.helper.port,
    "sec-fetch-site": "same-origin",
    [protocol.HEADER.CLIENT]: protocol.CLIENT_CATALOG,
    [protocol.HEADER.TOKEN]: token === undefined ? w.token : token
  };
  if (r.method === "POST") {
    headers["content-type"] = protocol.JSON_CONTENT_TYPE;
    headers.origin = "http://127.0.0.1:" + w.helper.port;
  }
  return raw(w.helper.port, {
    method: r.method,
    path: r.path,
    headers,
    body: r.method === "POST" ? JSON.stringify(body || {}) : undefined
  });
}

function queueLines(dir) {
  const file = stateDir.catalogRequestsPath(dir);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

function catalogJson(dir) {
  return catalogStore.createCatalogStore({ dir }).read();
}

function catalogLogLines(dir) {
  const file = stateDir.helperLogPath(dir);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter((line) => /^\S+ catalog (open|star|unstar|pickup|launch) /.test(line));
}

function fetchText(url) {
  const u = new URL(url);
  return raw(Number(u.port), { path: u.pathname, headers: { host: u.host } });
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

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

test("Open on a served review starts nothing and returns the live URL", async (t) => {
  const w = await world(t);
  const res = await api(w, "catalog.open", { review: "r_page" });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.url, "http://127.0.0.1:" + w.first.meta.port + "/page.html");
  const records = staticServers.list(w.dir, "s_doc");
  assert.equal(records.length, 1);
  assert.equal(records[0].instance, w.first.meta.instance, "the same server process, not a restart");
  assert.equal(catalogJson(w.dir).data.reopened.s_doc, undefined, "an open session is not the Library's to close");
});

test("Open refuses a review with no recorded server, a missing one, and an unknown one, with PROTO_NOT_OPENABLE", async (t) => {
  const w = await world(t);
  const dev = await api(w, "catalog.open", { review: "r_dev" });
  assert.equal(dev.status, 409);
  assert.equal(dev.json.error.code, "PROTO_NOT_OPENABLE");
  assert.match(dev.json.error.detail, /via-agent/);
  const gone = await api(w, "catalog.open", { review: "r_gone" });
  assert.equal(gone.status, 409);
  assert.equal(gone.json.error.code, "PROTO_NOT_OPENABLE");
  assert.match(gone.json.error.detail, /missing/);
  const unknown = await api(w, "catalog.open", { review: "r_nobody" });
  assert.equal(unknown.json.error.code, "PROTO_NOT_OPENABLE");
  const unsafe = await api(w, "catalog.open", { review: "../r_page" });
  assert.equal(unsafe.status, 400);
  assert.equal(queueLines(w.dir).length, 0);
});

test("Open ignores extra path, root and url fields in its body", async (t) => {
  const w = await world(t);
  const outside = path.join(w.root, "outside.html");
  fs.writeFileSync(outside, SECRET);
  const res = await api(w, "catalog.open", { review: "r_page", path: outside, root: w.root, url: "http://evil.test/" });
  assert.equal(res.status, 200);
  assert.equal(res.json.url, "http://127.0.0.1:" + w.first.meta.port + "/page.html");
  assert.equal(res.text.indexOf(SECRET), -1);
});

test("Open with target_path rewritten outside the recorded root refuses, and the outside file's bytes appear in no response", async (t) => {
  const w = await world(t);
  const outsideDir = path.join(w.root, "private");
  fs.mkdirSync(outsideDir);
  const outside = path.join(outsideDir, "secret.html");
  fs.writeFileSync(outside, SECRET);
  const metaFile = stateDir.metaPath(w.dir, "r_page");
  const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  meta.target_path = outside;
  meta.target_paths = [outside];
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n");
  const res = await api(w, "catalog.open", { review: "r_page", handoff: false });
  assert.equal(res.status, 409);
  assert.equal(res.json.error.code, "PROTO_NOT_OPENABLE");
  assert.equal(res.text.indexOf(SECRET), -1);
  const listed = await api(w, "catalog.list");
  assert.equal(listed.text.indexOf(SECRET), -1);
  const viaServer = await fetchText("http://127.0.0.1:" + w.first.meta.port + "/../private/secret.html");
  assert.equal(viaServer.text.indexOf(SECRET), -1, "the recorded server serves only its own root");
});

test("Open refuses a recorded file not owned by the current user", async (t) => {
  // chown needs root, so the helper is told to check against another uid; the
  // file is then, from its point of view, owned by somebody else.
  if (typeof process.getuid !== "function") return t.skip("no uids on this platform");
  const w = await world(t, { serve: { uid: process.getuid() + 1 } });
  const res = await api(w, "catalog.open", { review: "r_page" });
  assert.equal(res.status, 409);
  assert.equal(res.json.error.code, "PROTO_NOT_OPENABLE");
  assert.match(res.json.error.detail, /not owned/);
});

// ---------------------------------------------------------------------------
// Open and the hand-over
// ---------------------------------------------------------------------------

test("Open queues a pick-up with handoff, a live attached agent, and no one watching", async (t) => {
  const w = await world(t);
  const res = await api(w, "catalog.open", { review: "r_page", handoff: true });
  assert.equal(res.status, 200, res.text);
  assert.match(res.json.request_id, /^cq_/);
  assert.equal(res.json.not_asked, null);
  const lines = queueLines(w.dir);
  assert.equal(lines.length, 1);
  assert.deepEqual(
    { action: lines[0].action, review: lines[0].review, session: lines[0].session, for: lines[0].for, id: lines[0].id },
    { action: "pickup", review: "r_page", session: "s_doc", for: "s_agent", id: res.json.request_id }
  );
});

test("\"Just open it to read\" leaves the queue empty", async (t) => {
  const w = await world(t);
  const res = await api(w, "catalog.open", { review: "r_page", handoff: false });
  assert.equal(res.status, 200);
  assert.equal(res.json.request_id, null);
  assert.equal(res.json.not_asked, null);
  assert.equal(queueLines(w.dir).length, 0);
});

test("an unconfirmed hand-over on a watched session gets PROTO_CONFIRM_NEEDED; a confirmed one is queued", async (t) => {
  const w = await world(t);
  beat(w.store, "s_doc", T0, "s_doc");
  const unconfirmed = await api(w, "catalog.open", { review: "r_page", handoff: true });
  assert.equal(unconfirmed.status, 409);
  assert.equal(unconfirmed.json.error.code, "PROTO_CONFIRM_NEEDED");
  assert.equal(queueLines(w.dir).length, 0);
  const viaRequest = await api(w, "catalog.request", { review: "r_page", action: "pickup" });
  assert.equal(viaRequest.json.error.code, "PROTO_CONFIRM_NEEDED");
  const confirmed = await api(w, "catalog.open", { review: "r_page", handoff: true, confirmed: true });
  assert.equal(confirmed.status, 200, confirmed.text);
  assert.match(confirmed.json.request_id, /^cq_/);
});

test("with the queue full, Open still opens, with not_asked queue_full", async (t) => {
  const w = await world(t);
  const queue = catalogRequests.createQueue({ dir: w.dir, log: () => {} });
  for (let i = 0; i < C.QUEUE_CAP; i += 1) {
    assert.equal(queue.append({ action: "pickup", review: "r_filler" + i, session: "s_doc", for: "s_agent" }, T0).ok, true);
  }
  const res = await api(w, "catalog.open", { review: "r_page", handoff: true });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.url, "http://127.0.0.1:" + w.first.meta.port + "/page.html");
  assert.equal(res.json.request_id, null);
  assert.equal(res.json.not_asked, "queue_full");
  const full = await api(w, "catalog.request", { review: "r_page", action: "launch" });
  assert.equal(full.status, 429);
  assert.equal(full.json.error.code, "PROTO_QUEUE_FULL");
});

test("with a dead attached agent, Open opens with not_asked no_agent and request returns PROTO_NO_AGENT", async (t) => {
  const w = await world(t);
  w.clock.now = T0 + protocol.MONITOR.HEARTBEAT_FRESH_MS + 1;
  const open = await api(w, "catalog.open", { review: "r_page", handoff: true });
  assert.equal(open.status, 200, open.text);
  assert.equal(open.json.not_asked, "no_agent");
  assert.equal(open.json.request_id, null);
  const request = await api(w, "catalog.request", { review: "r_page", action: "pickup" });
  assert.equal(request.status, 409);
  assert.equal(request.json.error.code, "PROTO_NO_AGENT");
  const devOpen = await api(w, "catalog.open", { review: "r_dev", handoff: true });
  assert.equal(devOpen.json.error.code, "PROTO_NO_AGENT", "a via-agent Open with no agent is the no-agent result");
  assert.equal(queueLines(w.dir).filter((line) => line.action).length, 0);
});

test("with no attach at all, Open still opens and says no agent was asked", async (t) => {
  const w = await world(t, { attach: false });
  const open = await api(w, "catalog.open", { review: "r_page", handoff: true });
  assert.equal(open.status, 200);
  assert.equal(open.json.not_asked, "no_agent");
});

test("Open on a via-agent review with handoff and a live agent queues the pick-up and returns no URL", async (t) => {
  const w = await world(t);
  const res = await api(w, "catalog.open", { review: "r_dev", handoff: true });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.url, null);
  assert.match(res.json.request_id, /^cq_/);
  const again = await api(w, "catalog.request", { review: "r_dev", action: "pickup" });
  assert.equal(again.status, 409);
  assert.equal(again.json.error.code, "PROTO_REQUEST_PENDING", "one pending request per review");
});

// ---------------------------------------------------------------------------
// Request, list, star
// ---------------------------------------------------------------------------

test("catalog.request with extra title, text, path and url fields stores none of them", async (t) => {
  const w = await world(t);
  const res = await api(w, "catalog.request", {
    review: "r_page", action: "launch", confirmed: false,
    title: "TITLE-MARKER", text: "TEXT-MARKER", path: "/PATH-MARKER", url: "http://URL-MARKER/"
  });
  assert.equal(res.status, 200, res.text);
  assert.match(res.json.request_id, /^cq_/);
  const lines = queueLines(w.dir);
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(lines[0]), catalogRequests.REQUEST_KEYS);
  const bytes = fs.readFileSync(stateDir.catalogRequestsPath(w.dir), "utf8");
  for (const marker of ["TITLE-MARKER", "TEXT-MARKER", "PATH-MARKER", "URL-MARKER"]) assert.equal(bytes.indexOf(marker), -1, marker);
  const bad = await api(w, "catalog.request", { review: "r_page", action: "delete" });
  assert.equal(bad.status, 400);
});

test("catalog.list carries attached and each review's request, and marks the Library seen", async (t) => {
  const w = await world(t);
  const queued = await api(w, "catalog.request", { review: "r_page", action: "pickup" });
  assert.equal(queued.status, 200);
  const res = await api(w, "catalog.list");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.attached, { session: "s_agent", name: "library agent", watching: true });
  const session = res.json.sessions.find((s) => s.id === "s_doc");
  const row = session.reviews.find((r) => r.id === "r_page");
  assert.equal(row.request.id, queued.json.request_id);
  assert.equal(row.request.state, "waiting");
  assert.equal(row.request.by_name, "library agent");
  assert.equal(row.openable, "yes");
  assert.equal(w.helper.catalog.seenAt(), new Date(T0).toISOString(), "seen at the helper's own clock");
});

test("a refused catalog.list does not update catalog_seen_at", async (t) => {
  const w = await world(t);
  const refused = await api(w, "catalog.list", undefined, "not-the-token");
  assert.equal(refused.status, 401);
  assert.equal(w.helper.catalog.seenAt(), null);
});

test("Star survives a helper restart; with a corrupt catalog.json it is refused and the file is left as it was", async (t) => {
  const w = await world(t);
  const starred = await api(w, "catalog.star", { review: "r_page", starred: true });
  assert.equal(starred.status, 200, starred.text);
  assert.deepEqual(starred.json, { review: "r_page", starred: true });
  await w.helper.close();
  const second = await service.serve({ port: 0, stateDir: w.dir, quiet: true, now: () => T0 });
  t.after(() => second.close());
  const w2 = Object.assign({}, w, { helper: second, token: await libraryToken(second.port) });
  const listed = await api(w2, "catalog.list");
  const row = listed.json.sessions.find((s) => s.id === "s_doc").reviews.find((r) => r.id === "r_page");
  assert.equal(row.starred, true);

  const unstar = await api(w2, "catalog.star", { review: "r_page", starred: false });
  assert.deepEqual(unstar.json, { review: "r_page", starred: false });
  const bad = await api(w2, "catalog.star", { review: "r_page", starred: "yes" });
  assert.equal(bad.status, 400);

  const file = catalogStore.catalogPath(w.dir);
  fs.writeFileSync(file, "{not json");
  const refused = await api(w2, "catalog.star", { review: "r_page", starred: true });
  assert.equal(refused.status, 500);
  assert.equal(refused.json.error.code, "PROTO_CATALOG_UNREADABLE");
  assert.equal(fs.readFileSync(file, "utf8"), "{not json");
});

// ---------------------------------------------------------------------------
// The log line
// ---------------------------------------------------------------------------

test("Open, Star, Pick up and Launch through the real routes each write one catalog log line in the protocol.js format", async (t) => {
  const w = await world(t);
  const before = catalogLogLines(w.dir).length;
  assert.equal((await api(w, "catalog.open", { review: "r_page" })).status, 200);
  assert.equal((await api(w, "catalog.star", { review: "r_page", starred: true })).status, 200);
  assert.equal((await api(w, "catalog.star", { review: "r_page", starred: false })).status, 200);
  assert.equal((await api(w, "catalog.request", { review: "r_page", action: "pickup" })).status, 200);
  assert.equal((await api(w, "catalog.request", { review: "r_dev", action: "launch" })).status, 200);
  // A refused action writes no catalog line.
  assert.equal((await api(w, "catalog.open", { review: "r_gone" })).status, 409);
  const lines = catalogLogLines(w.dir).slice(before);
  const at = new Date(T0).toISOString();
  const ageOf = (reviewId) => {
    const last = fs.statSync(stateDir.eventsPath(w.dir, reviewId)).mtimeMs;
    return Math.max(0, Math.floor((T0 - last) / (24 * 60 * MINUTE)));
  };
  assert.deepEqual(lines, [
    at + " " + protocol.catalogLogLine("open", "r_page", ageOf("r_page")),
    at + " " + protocol.catalogLogLine("star", "r_page", ageOf("r_page")),
    at + " " + protocol.catalogLogLine("unstar", "r_page", ageOf("r_page")),
    at + " " + protocol.catalogLogLine("pickup", "r_page", ageOf("r_page")),
    at + " " + protocol.catalogLogLine("launch", "r_dev", ageOf("r_dev"))
  ]);
});

// ---------------------------------------------------------------------------
// The reopened-session sweep
// ---------------------------------------------------------------------------

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

test("the helper runs the sweep on its own timer every POLL_MS, at its own clock", async (t) => {
  const ticks = [];
  const schedule = (fn, ms) => { ticks.push({ fn, ms }); return { unref() {}, cleared: false }; };
  const w = await world(t, { serve: { schedule } });
  await staticServers.stopAll(w.dir, "s_doc");
  w.store.close("s_doc");
  assert.equal((await api(w, "catalog.open", { review: "r_page" })).status, 200);
  assert.equal(ticks.length, 1, "one timer");
  assert.equal(ticks[0].ms, C.POLL_MS);
  w.clock.now = T0 + C.REOPENED_AUTOCLOSE_MS;
  await ticks[0].fn();
  assert.ok(w.store.read("s_doc").closed_at, "the timer's run closed the quiet session");
});

// ---------------------------------------------------------------------------
// The captured log, for the count script (Task 3.3)
// ---------------------------------------------------------------------------

const LOG_FIXTURE = path.join(__dirname, "..", "fixtures", "catalog_log.txt");

test("a week of Library actions through the real routes writes the catalog lines committed as test/fixtures/catalog_log.txt", async (t) => {
  // Rerun with LAHE_WRITE_CATALOG_LOG=1 to rewrite the fixture after a format change.
  const w = await world(t, { attach: false });
  // Each review's `last` is its log's modified time, pinned so every age is fixed.
  const pin = (reviewId, isoTime) => {
    const at = new Date(isoTime);
    fs.utimesSync(stateDir.eventsPath(w.dir, reviewId), at, at);
  };
  pin("r_page", "2026-09-05T12:00:00.000Z");
  pin("r_new", "2026-09-20T12:00:00.000Z");
  pin("r_dev", "2026-09-14T12:00:00.000Z");
  catalogRequests.writeAttach(w.dir, "s_agent", Date.parse("2026-09-21T13:00:00.000Z"));
  const at = (isoTime) => {
    w.clock.now = Date.parse(isoTime);
    beat(w.store, "s_agent", w.clock.now);
  };
  const ok = async (name, body) => {
    const res = await api(w, name, body);
    assert.equal(res.status, 200, name + " " + JSON.stringify(body) + ": " + res.text);
  };

  at("2026-09-21T14:00:00.000Z"); await ok("catalog.open", { review: "r_new" });            // Monday
  at("2026-09-21T15:00:00.000Z"); await ok("catalog.open", { review: "r_page" });
  at("2026-09-22T10:00:00.000Z"); await ok("catalog.star", { review: "r_page", starred: true }); // Tuesday
  at("2026-09-23T09:00:00.000Z"); await ok("catalog.open", { review: "r_page" });           // Wednesday
  at("2026-09-23T09:05:00.000Z"); await ok("catalog.star", { review: "r_page", starred: false });
  at("2026-09-24T16:00:00.000Z"); await ok("catalog.request", { review: "r_new", action: "pickup" }); // Thursday
  at("2026-09-25T17:00:00.000Z"); await ok("catalog.open", { review: "r_new" });            // Friday
  at("2026-09-26T12:00:00.000Z"); await ok("catalog.open", { review: "r_page" });           // Saturday
  at("2026-09-28T08:00:00.000Z"); await ok("catalog.request", { review: "r_dev", action: "launch" }); // Monday
  at("2026-09-28T08:30:00.000Z"); await ok("catalog.open", { review: "r_new" });

  const captured = catalogLogLines(w.dir).join("\n") + "\n";
  if (process.env.LAHE_WRITE_CATALOG_LOG === "1") fs.writeFileSync(LOG_FIXTURE, captured);
  assert.equal(captured, fs.readFileSync(LOG_FIXTURE, "utf8"));
  const opens = captured.split("\n").filter((line) => / catalog open /.test(line));
  assert.equal(opens.length, 6);
  assert.match(captured, /^2026-09-28T08:30:00\.000Z catalog open review=r_new age_days=7$/m, "r_new is 7 whole days old on the last Open");
  assert.match(captured, /^2026-09-26T12:00:00\.000Z catalog open review=r_page age_days=21$/m);
});
