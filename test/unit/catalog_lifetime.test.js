// The helper's lifetime with the Library open (LAHE Library 2.1, architecture
// "Helper lifetime (R10a)").
//
// `lahe session close` on the last open session used to stop the helper. The
// Library is the first page that must outlive every session, so the close now
// reads `catalog_seen_at` from health and leaves the helper up when the
// Library polled within LIBRARY_SEEN_MS, or when a document window is held.
//
// These tests start a real helper process the way the CLI does, on a free port
// and a temporary state dir (never 7817, never the real state dir), and pass
// the close its `now` rather than sleeping.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");
const stateDir = require("../../src/service/state_dir.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const staticServers = require("../../src/service/static_servers.js");
const sessionCommand = require("../../src/cli/commands/session.js");

const C = protocol.CATALOG;

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-catalog-lifetime-")));
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

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
          resolve({ status: res.statusCode, text, json });
        });
      }
    );
    req.on("error", reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

/** The Library page's token, then one authenticated call, as the page makes it. */
async function libraryCall(port, name, body) {
  const page = await raw(port, { path: protocol.CATALOG_PAGE_PATH, headers: { host: "127.0.0.1:" + port, "sec-fetch-site": "none" } });
  const token = new RegExp('<meta name="' + protocol.CATALOG_TOKEN_META + '" content="([^"]*)"').exec(page.text)[1];
  const r = protocol.route(name);
  const headers = {
    host: "127.0.0.1:" + port,
    "sec-fetch-site": "same-origin",
    [protocol.HEADER.CLIENT]: protocol.CLIENT_CATALOG,
    [protocol.HEADER.TOKEN]: token
  };
  if (r.method === "POST") {
    headers["content-type"] = protocol.JSON_CONTENT_TYPE;
    headers.origin = "http://127.0.0.1:" + port;
  }
  return raw(port, { method: r.method, path: r.path, headers, body: r.method === "POST" ? JSON.stringify(body || {}) : undefined });
}

async function health(port) {
  return service.probeHealth(protocol.DEFAULT_HOST, port);
}

async function close(dir, sessionId, nowMs) {
  const out = [];
  const err = [];
  const code = await sessionCommand.run(["close", sessionId, "--state-dir", dir], {
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text),
    now: nowMs
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

/** One open agent session and a helper started for it, the way the CLI starts one. */
async function started(t) {
  const dir = path.join(tempDir(), "state");
  const port = await freePort();
  assert.notEqual(port, protocol.DEFAULT_PORT);
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_last" });
  t.after(async () => { await sessionCommand.stopVerifiedHelper(dir).catch(() => {}); });
  await sessionCommand.startHelper(dir, port);
  return { dir, port, store };
}

test("the last session close with a Library poll 1:59 ago leaves the helper up; at 2:00 it stops it", async (t) => {
  const w = await started(t);
  assert.equal((await libraryCall(w.port, "catalog.list")).status, 200);
  const seenAt = Date.parse((await health(w.port))[protocol.HEALTH_FIELD.CATALOG_SEEN_AT]);
  assert.ok(!Number.isNaN(seenAt), "the list was recorded");

  const inside = await close(w.dir, "s_last", seenAt + C.LIBRARY_SEEN_MS - 1000);
  assert.equal(inside.code, protocol.CLI_EXIT.OK, inside.stderr);
  assert.match(inside.stdout, /shared helper left running: the Library page polled it/);
  assert.ok(await health(w.port), "the helper is still up");

  w.store.reopen("s_last");
  const at = await close(w.dir, "s_last", seenAt + C.LIBRARY_SEEN_MS);
  assert.equal(at.code, protocol.CLI_EXIT.OK, at.stderr);
  assert.match(at.stdout, /shared helper stopped/);
  assert.equal(await health(w.port), null, "the helper is gone");
});

test("with a stale Library poll but a held document window, the last close leaves the helper up", async (t) => {
  const w = await started(t);
  assert.equal((await libraryCall(w.port, "catalog.list")).status, 200);
  const seenAt = Date.parse((await health(w.port))[protocol.HEALTH_FIELD.CATALOG_SEEN_AT]);
  const nowMs = seenAt + 10 * C.LIBRARY_SEEN_MS;
  fs.writeFileSync(stateDir.windowsPath(w.dir), JSON.stringify({
    version: 1,
    sessions: { r_held: { window_id: "w", session_secret: "s", since: new Date(nowMs).toISOString(), since_ms: nowMs - 1000, last_seen: nowMs - 1000 } }
  }));
  const out = await close(w.dir, "s_last", nowMs);
  assert.equal(out.code, protocol.CLI_EXIT.OK, out.stderr);
  assert.match(out.stdout, /shared helper left running for an open review page/);
  assert.ok(await health(w.port));
});

test("with no Library poll and no held window, the last close stops the helper as before", async (t) => {
  const w = await started(t);
  const out = await close(w.dir, "s_last", Date.now());
  assert.match(out.stdout, /shared helper stopped/);
  assert.equal(await health(w.port), null);
});

test("R10a: Open a closed review with no agent, close the last agent's own session, and the document still answers and takes a comment", async (t) => {
  const w = await started(t);
  // A document from an earlier session, closed, with its server stopped.
  const site = path.join(tempDir(), "site");
  fs.mkdirSync(site);
  const page = path.join(site, "doc.html");
  fs.writeFileSync(page, "<!doctype html><title>Synthetic doc</title><p>still here</p>");
  w.store.create({ id: "s_old" });
  const log = logModule.createEventLog({ dir: w.dir });
  reviewsModule.createReviews({ dir: w.dir, log }).create({ id: "r_old", agent_session_id: "s_old", target_path: page });
  await staticServers.start({ dir: w.dir, sessionId: "s_old", root: site });
  t.after(async () => { await staticServers.stopAll(w.dir, "s_old").catch(() => {}); });
  await staticServers.stopAll(w.dir, "s_old");
  w.store.close("s_old");

  // No agent is attached: Open still opens.
  const opened = await libraryCall(w.port, "catalog.open", { review: "r_old", handoff: true });
  assert.equal(opened.status, 200, opened.text);
  assert.equal(opened.json.not_asked, "no_agent");

  // The agent that started the helper closes its own session.
  const closed = await close(w.dir, "s_last", Date.now());
  assert.equal(closed.code, protocol.CLI_EXIT.OK, closed.stderr);
  assert.doesNotMatch(closed.stdout, /shared helper stopped/);
  assert.ok(await health(w.port), "LAHE keeps serving after the last agent session closes");

  // The opened document still answers, with its rail's helper behind it.
  const url = new URL(opened.json.url);
  const doc = await raw(Number(url.port), { path: url.pathname, headers: { host: url.host } });
  assert.equal(doc.status, 200);
  assert.match(doc.text, /still here/);

  // And it takes a comment: an event posted from the document's own origin.
  const token = JSON.parse(fs.readFileSync(stateDir.metaPath(w.dir, "r_old"), "utf8")).token;
  const event = protocol.newEvent({
    event: protocol.EVENT.ITEM_CREATED,
    event_id: "ev_after_close",
    review: "r_old",
    item: "c_after_close",
    rev: 1,
    payload: { text: "a comment after the last session closed" }
  });
  const posted = await raw(w.port, {
    method: "POST",
    path: protocol.route("events.append").path,
    headers: {
      host: "127.0.0.1:" + w.port,
      "content-type": protocol.JSON_CONTENT_TYPE,
      [protocol.HEADER.CLIENT]: protocol.CLIENT_LAYER,
      [protocol.HEADER.TOKEN]: token,
      origin: url.origin
    },
    body: JSON.stringify({ review: "r_old", events: [event] })
  });
  assert.equal(posted.status, 200, posted.text);
  const onDisk = fs.readFileSync(stateDir.eventsPath(w.dir, "r_old"), "utf8");
  assert.match(onDisk, /ev_after_close/);
});
