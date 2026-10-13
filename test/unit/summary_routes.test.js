// The menu bar's two routes and their signed auth mode (AUTH.CLI_PROOF).
//
// Menu bar plan, Task 1.4. The rows this file proves:
//
//   V14  no proof, a wrong key, a proof older than 30 s and a repeated nonce
//        are 401; a good proof with any Sec-Fetch header is refused, a GET
//        with no Origin included; summary.open with an Origin is refused; a
//        non-loopback Host and the path at library.lahe.localhost are refused;
//        the raw CLI secret header and the Library token are refused; auth.js
//        matches proof_vectors.json
//   V15  summary.open returns the address catalog Open returns, never writes
//        to the request queue, and returns url null for a row only an agent
//        can serve
//   V16  another version gets a signed 409 SUMMARY_VERSION
//   V34  (the helper's half) a captured proof replayed to the helper is
//        refused, and no answer carries the secret
//
// Every helper runs in this process on free ports with a temp state folder
// (test/helpers/sites_world.js), and closes in teardown even when a test
// fails. The helper's clock is injected, so the 30-second window is tested
// without waiting.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const auth = require("../../src/service/auth.js");
const sitesModule = require("../../src/service/sites.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const stateDirModule = require("../../src/service/state_dir.js");
const { writeOldServerRecord } = require("../helpers/old_server_record.js");
const service = require("../../src/service/index.js");
const { sitesWorld, raw, writeFile } = require("../helpers/sites_world.js");

const VECTORS = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", "menubar", "proof_vectors.json"), "utf8"));
const READ = protocol.route("summary.read");
const OPEN = protocol.route("summary.open");
const PAGE_HTML = "<!doctype html><html><head><title>A page</title></head><body><p>words</p></body></html>";

// ---------------------------------------------------------------------------
// The vectors
// ---------------------------------------------------------------------------

test("V14: auth.js matches every request in proof_vectors.json", () => {
  VECTORS.requests.forEach((v) => {
    assert.equal(auth.sha256Hex(Buffer.from(v.body, "utf8")), v.body_sha256, v.name + ": body hash");
    const signed = auth.proofSignedString(v.method, v.path, v.ts, v.nonce, v.body_sha256);
    assert.equal(signed, v.signed_string, v.name + ": signed string");
    assert.equal(auth.hmacHex(VECTORS.secret, signed), v.proof, v.name + ": proof");
    assert.deepEqual(v.headers, {
      [protocol.HEADER.PROOF_TS]: v.ts,
      [protocol.HEADER.PROOF_NONCE]: v.nonce,
      [protocol.HEADER.PROOF]: v.proof
    }, v.name + ": header names");
  });
});

test("V14: auth.js matches every answer in proof_vectors.json", () => {
  VECTORS.replies.forEach((v) => {
    assert.equal(auth.sha256Hex(Buffer.from(v.body, "utf8")), v.body_sha256, v.name + ": body hash");
    assert.equal(auth.replySignedString(v.nonce, v.status, v.body_sha256), v.signed_string, v.name + ": signed string");
    assert.equal(auth.replyProof(VECTORS.secret, v.nonce, v.status, Buffer.from(v.body, "utf8")), v.proof, v.name + ": proof");
    assert.deepEqual(Object.keys(v.headers), [protocol.HEADER.PROOF_REPLY]);
  });
});

test("V14: the check block accepts a vector inside the window and refuses it once used or outside it", () => {
  const v = VECTORS.requests[1];
  const nonces = auth.createNonceCache();
  const request = {
    routeName: "summary.open",
    method: v.method,
    target: v.path,
    body: Buffer.from(v.body, "utf8"),
    headers: Object.assign({ host: "127.0.0.1:7817", "content-type": "application/json" }, v.headers)
  };
  const at = Number(v.ts);
  assert.equal(auth.checkProofRequest(request, VECTORS.secret, at + 29999, nonces).ok, true);
  const again = auth.checkProofRequest(request, VECTORS.secret, at + 29999, nonces);
  assert.equal(again.ok, false, "a nonce is used once");
  assert.equal(again.check, protocol.CHECK.PROOF);
  assert.equal(auth.checkProofRequest(request, VECTORS.secret, at + 30001, auth.createNonceCache()).ok, false, "past the window");
  assert.equal(auth.checkProofRequest(request, VECTORS.secret, at - 30001, auth.createNonceCache()).ok, false, "before it too");
});

// ---------------------------------------------------------------------------
// A live helper
// ---------------------------------------------------------------------------

async function world(t) {
  const clock = { ms: 1760000000000 };
  const w = await sitesWorld(t, { helper: { now: () => clock.ms } });
  w.clock = clock;
  w.secret = sitesModule.readCliSecret(w.state);
  assert.match(w.secret, /^[0-9a-f]{64}$/, "the helper made its CLI secret");
  return w;
}

/** A signed request, built the way the app builds it. */
function signed(w, method, target, body, overrides) {
  const o = overrides || {};
  const bytes = body === undefined ? "" : typeof body === "string" ? body : JSON.stringify(body);
  const ts = o.ts !== undefined ? String(o.ts) : String(w.clock.ms);
  const nonce = o.nonce || crypto.randomBytes(16).toString("hex");
  const key = o.secret || w.secret;
  const proof = auth.hmacHex(key, auth.proofSignedString(method, target, ts, nonce, auth.sha256Hex(Buffer.from(bytes, "utf8"))));
  const headers = Object.assign(
    {
      host: "127.0.0.1:" + w.helper.port,
      [protocol.HEADER.PROOF_TS]: ts,
      [protocol.HEADER.PROOF_NONCE]: nonce,
      [protocol.HEADER.PROOF]: proof
    },
    method === "POST" ? { "content-type": "application/json" } : {},
    o.headers || {}
  );
  return { port: o.port || w.helper.port, options: { method, path: target, headers, body: method === "POST" ? bytes : undefined }, nonce };
}

async function send(req) {
  const res = await raw(req.port, req.options);
  res.nonce = req.nonce;
  return res;
}

function read(w, overrides) {
  return send(signed(w, "GET", READ.path + "?v=" + protocol.SUMMARY_VERSION, undefined, overrides));
}

function open(w, body, overrides) {
  return send(signed(w, "POST", OPEN.path, body, overrides));
}

/** Does the answer carry the helper's own signature over what it sent? */
function signedByHelper(w, res) {
  return res.headers[protocol.HEADER.PROOF_REPLY] === auth.replyProof(w.secret, res.nonce, res.status, Buffer.from(res.text, "utf8"));
}

function assertRefused(w, res, label) {
  assert.equal(res.status, 401, label + ": " + res.text);
  assert.equal(res.json.error.code, "AUTH_REFUSED", label);
  assert.ok(signedByHelper(w, res), label + ": the refusal is signed");
}

test("V14: a good proof reads the summary, and the answer is signed; no CORS header and no secret", async (t) => {
  const w = await world(t);
  const res = await read(w);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.summary_version, 1);
  assert.ok(signedByHelper(w, res));
  assert.equal(res.headers["access-control-allow-origin"], undefined);
  assert.equal(res.text.includes(w.secret), false);
  assert.ok(fs.existsSync(path.join(w.state, "summary.json")), "the first read seeds the cutoff");
});

test("V14: no proof, a wrong key, a stale proof and a repeated nonce are each 401, signed", async (t) => {
  const w = await world(t);
  // A minute after the helper started, so a proof 29 s old is still after it.
  w.clock.ms += 60000;
  const bare = await raw(w.helper.port, { path: READ.path + "?v=1", headers: { host: "127.0.0.1:" + w.helper.port } });
  bare.nonce = "";
  assertRefused(w, bare, "no proof");
  assert.equal(bare.text, VECTORS.replies[2].body, "the refusal's bytes are the vector's");

  assertRefused(w, await read(w, { secret: "0".repeat(64) }), "a wrong key");
  assertRefused(w, await read(w, { ts: w.clock.ms - 31000 }), "older than 30 s");
  assertRefused(w, await read(w, { ts: w.clock.ms + 31000 }), "from the future");
  assert.equal((await read(w, { ts: w.clock.ms - 29000 })).status, 200, "inside the window");

  const first = signed(w, "GET", READ.path + "?v=1");
  assert.equal((await send(first)).status, 200);
  assertRefused(w, await send(first), "the same nonce again");
});

test("V34: a proof captured off the port and replayed to the helper is refused", async (t) => {
  const w = await world(t);
  // What a program squatting on the port would capture: one request's headers.
  const captured = signed(w, "GET", READ.path + "?v=1");
  assert.equal(JSON.stringify(captured.options.headers).includes(w.secret), false, "the request carries a proof, never the secret");
  assert.equal((await send(captured)).status, 200, "the app's own request");
  w.clock.ms += 5000;
  assertRefused(w, await send(captured), "the replay");
  // Nor can it be moved to another route: the path is signed.
  const moved = signed(w, "GET", READ.path + "?v=1");
  moved.options.method = "POST";
  moved.options.path = OPEN.path;
  moved.options.headers["content-type"] = "application/json";
  moved.options.body = JSON.stringify({ review: "r1", summary_version: 1 });
  assertRefused(w, await send(moved), "a proof for another route");
});

test("V14: a good proof with any Sec-Fetch header is refused, a GET with no Origin included", async (t) => {
  const w = await world(t);
  for (const header of ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"]) {
    const res = await read(w, { headers: { [header]: "same-origin" } });
    assertRefused(w, res, header);
  }
  const fromPage = await open(w, { review: "r1", summary_version: 1 }, { headers: { "sec-fetch-site": "cross-site", origin: "http://example.com" } });
  assertRefused(w, fromPage, "a page's POST");
});

test("V14: summary.open with an Origin header is refused", async (t) => {
  const w = await world(t);
  assertRefused(w, await open(w, { review: "r1", summary_version: 1 }, { headers: { origin: "http://127.0.0.1:" + w.helper.port } }), "an Origin");
});

test("V14: a non-loopback Host, and the path at library.lahe.localhost, are refused", async (t) => {
  const w = await world(t);
  const rebound = await read(w, { headers: { host: "attacker.example:" + w.helper.port } });
  assert.equal(rebound.status, 400, "the Host check stands in front");
  const library = await read(w, { port: w.helper.pagesPort, headers: { host: "library.lahe.localhost:" + w.helper.pagesPort } });
  assert.equal(library.status, 400, "the Library host never routes to the summary");
  assert.equal(library.json && library.json.summary_version, undefined);
});

test("V14: the raw CLI secret header and the Library token are refused", async (t) => {
  const w = await world(t);
  assertRefused(w, await read(w, { headers: { [protocol.HEADER.CLI_SECRET]: w.secret } }), "a good proof plus the raw secret");
  const secretOnly = await raw(w.helper.port, {
    path: READ.path + "?v=1",
    headers: { host: "127.0.0.1:" + w.helper.port, [protocol.HEADER.CLI_SECRET]: w.secret, [protocol.HEADER.CLIENT]: protocol.CLIENT_CLI }
  });
  secretOnly.nonce = "";
  assertRefused(w, secretOnly, "the raw secret alone");
  const library = await raw(w.helper.port, {
    path: READ.path + "?v=1",
    headers: {
      host: "127.0.0.1:" + w.helper.port,
      [protocol.HEADER.CLIENT]: protocol.CLIENT_CATALOG,
      [protocol.HEADER.TOKEN]: w.helper.catalog.token
    }
  });
  library.nonce = "";
  assertRefused(w, library, "the Library token");
});

test("V16: another version gets a signed 409 SUMMARY_VERSION, on both routes", async (t) => {
  const w = await world(t);
  const nonce = VECTORS.replies[1].nonce;
  const res = await send(signed(w, "GET", READ.path + "?v=2", undefined, { nonce }));
  assert.equal(res.status, 409);
  assert.equal(res.text, VECTORS.replies[1].body, "the vector's exact bytes");
  assert.ok(signedByHelper(w, res));
  const none = await send(signed(w, "GET", READ.path));
  assert.equal(none.status, 409, "no version is another version");
  const opened = await open(w, { review: "r1", summary_version: 2 });
  assert.equal(opened.status, 409);
  assert.equal(opened.json.error.code, "SUMMARY_VERSION");
  assert.ok(signedByHelper(w, opened));
});

test("a preflight to a summary path is refused", async (t) => {
  const w = await world(t);
  const res = await raw(w.helper.port, {
    method: "OPTIONS",
    path: OPEN.path,
    headers: { host: "127.0.0.1:" + w.helper.port, origin: "null", "access-control-request-method": "POST" }
  });
  assert.equal(res.status, 401);
  assert.equal(res.headers["access-control-allow-origin"], undefined);
  res.nonce = "";
  assert.ok(signedByHelper(w, res), "signed, over the empty nonce");
});

// ---------------------------------------------------------------------------
// summary.open (V15)
// ---------------------------------------------------------------------------

/** A Library client, like the page, for catalog Open's own answer. */
async function libraryOpen(w, review) {
  const port = w.helper.pagesPort;
  const host = "library.lahe.localhost:" + port;
  const r = protocol.route("catalog.open");
  return raw(port, {
    method: r.method,
    path: r.path,
    headers: {
      host,
      "sec-fetch-site": "same-origin",
      [protocol.HEADER.CLIENT]: protocol.CLIENT_CATALOG,
      [protocol.HEADER.TOKEN]: w.helper.catalog.token,
      "content-type": protocol.JSON_CONTENT_TYPE,
      origin: "http://" + host
    },
    body: JSON.stringify({ review, handoff: false, confirmed: false })
  });
}

test("V15: summary.open answers catalog Open's address, writes nothing to the request queue, and null for an agent-only row", async (t) => {
  const w = await world(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  const file = writeFile(folder, "page.html", PAGE_HTML);
  agentSessions.createStore({ dir: w.state }).create({ id: "s_a", name: "session a" });
  writeOldServerRecord(w.state, "s_a", fs.realpathSync(folder), {});
  const review = w.helper.reviews.create({ origins: ["null"], agent_session_id: "s_a", target_path: file });
  const devServer = w.helper.reviews.create({ origins: ["http://127.0.0.1:5999"], agent_session_id: "s_a" });

  const ours = await open(w, { review: review.id, summary_version: 1 });
  assert.equal(ours.status, 200, ours.text);
  assert.ok(signedByHelper(w, ours));
  assert.match(ours.json.url, /^http:\/\/[a-z0-9.-]+\.lahe\.localhost:\d+\/page\.html$/);
  const library = await libraryOpen(w, review.id);
  assert.equal(library.status, 200, library.text);
  assert.equal(ours.json.url, library.json.url, "the address catalog Open uses");
  assert.deepEqual(Object.keys(ours.json), ["url"]);

  const agentOnly = await open(w, { review: devServer.id, summary_version: 1 });
  assert.equal(agentOnly.status, 200, agentOnly.text);
  assert.deepEqual(agentOnly.json, { url: null });
  assert.equal(fs.existsSync(stateDirModule.catalogRequestsPath(w.state)), false, "no request was ever queued");
});

// ---------------------------------------------------------------------------
// Fix round (security review of the integrated diff)
// ---------------------------------------------------------------------------

test("a proof signed before the helper started is refused, so a capture replays against no restart", async (t) => {
  const w = await world(t);
  const captured = signed(w, "GET", READ.path + "?v=1");
  await w.helper.close();
  const T = w.clock.ms;
  const second = await service.serve({ port: 0, stateDir: w.state, quiet: true, pagesPort: 0, sitesHome: w.home, now: () => T + 5000 });
  t.after(() => second.close());
  captured.port = second.port;
  captured.options.headers.host = "127.0.0.1:" + second.port;
  const replayed = await send(captured);
  assertRefused(w, replayed, "the proof from before the restart");
  w.clock.ms = T + 5000;
  const fresh = signed(w, "GET", READ.path + "?v=1", undefined, { port: second.port, headers: { host: "127.0.0.1:" + second.port } });
  assert.equal((await send(fresh)).status, 200, "the app's next poll, signed after the start, is answered");
});

/**
 * A POST that sends only `partial` of its declared body, then reads the
 * answer. The helper may answer, and close the connection, before the rest
 * arrives; that is the point, so a broken pipe on the unsent rest is expected.
 */
function postEarly(w, req, partial) {
  return new Promise((resolve, reject) => {
    const sent = http.request(
      { host: "127.0.0.1", port: w.helper.port, method: "POST", path: req.options.path, headers: req.options.headers, agent: false },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          sent.destroy();
          resolve({ status: res.statusCode, headers: res.headers, text, json: JSON.parse(text), nonce: req.nonce });
        });
      }
    );
    sent.on("error", (err) => {
      if (err.code !== "EPIPE" && err.code !== "ECONNRESET") reject(err);
    });
    sent.write(partial);
  });
}

test("summary.open checks its headers before reading the body, and caps the body", async (t) => {
  const w = await world(t);
  const before = w.helper.summaryCounters.bodiesRead;
  // A page's 1 MB post: only the first 16 KB is sent, and the answer comes
  // back without the rest, because the headers alone refuse it.
  const req = signed(w, "POST", OPEN.path, "", { headers: { "sec-fetch-site": "cross-site", "content-length": String(1024 * 1024) } });
  const fromPage = await postEarly(w, req, "x".repeat(16 * 1024));
  assertRefused(w, fromPage, "a page's 1 MB post");
  assert.equal(w.helper.summaryCounters.bodiesRead, before, "the body was never read");

  const padded = JSON.stringify({ review: "r1", summary_version: 1, pad: "x".repeat(64 * 1024) });
  const tooBigReq = signed(w, "POST", OPEN.path, padded);
  tooBigReq.options.headers["content-length"] = String(Buffer.byteLength(padded));
  const tooBig = await postEarly(w, tooBigReq, padded.slice(0, 16 * 1024));
  assert.equal(tooBig.status, 413, tooBig.text);
  assert.ok(signedByHelper(w, tooBig), "the 413 is signed");
});

test("one unreadable review does not fail summary.read, and no 5xx body names the state folder", async (t) => {
  const w = await world(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  const good = w.helper.reviews.create({ origins: ["null"], agent_session_id: "s_a", target_path: writeFile(folder, "good.html", PAGE_HTML) });
  const bad = w.helper.reviews.create({ origins: ["null"], agent_session_id: "s_a", target_path: writeFile(folder, "bad.html", PAGE_HTML) });
  const events = stateDirModule.eventsPath(w.state, bad.id);
  const outside = path.join(w.root, "outside-events.jsonl");
  fs.renameSync(events, outside);
  fs.symlinkSync(outside, events);
  const res = await read(w);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.recent.items.map((r) => r.review), [good.id]);

  // A summary that cannot be built at all: its cutoff file is a folder.
  fs.unlinkSync(path.join(w.state, "summary.json"));
  fs.mkdirSync(path.join(w.state, "summary.json"));
  // The cutoff file is checked on the beat.
  w.clock.ms += BEAT;
  const broken = await read(w);
  assert.equal(broken.status, 500);
  assert.ok(signedByHelper(w, broken));
  assert.equal(broken.text.includes(w.state), false, "the state folder's path stays in the log: " + broken.text);
  assert.equal(broken.text.includes(w.root), false);
});

test("a real helper's summary carries the Library's printed address, ending in /catalog", async (t) => {
  const w = await world(t);
  const res = await read(w);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.library_url, "http://library.lahe.localhost:" + w.helper.pagesPort + "/catalog");
  assert.equal(typeof res.json.helper.version, "string");
});

// ---------------------------------------------------------------------------
// Fix round 2: a reply to a document no page has open
// ---------------------------------------------------------------------------

const replyCommand = require("../../src/cli/commands/reply.js");
const record = require("../../src/shared/record.js");
const BEAT = protocol.CATALOG.POLL_MS;

/** A review with one ready comment, on a document no page has open. */
function closedDocument(w, name) {
  const folder = path.join(w.home, "ws", "repo", "docs");
  const review = w.helper.reviews.create({ origins: ["null"], agent_session_id: "s_a", target_path: writeFile(folder, name + ".html", PAGE_HTML) });
  const item = record.newItem({ id: "itm_" + name, kind: record.KIND.COMMENT, state: record.STATE.READY, note: "which week?", page_origin: "null", page_path: "/" + name + ".html", page_seq: 1 });
  w.helper.log.append(review.id, [protocol.newEvent({ event: protocol.EVENT.ITEM_READY, event_id: "evt_" + name, review: review.id, item: item.id, rev: item.rev, page_path: item.page_path, page_seq: 1, payload: { draft: false, record: item } })]);
  return { review, item };
}

/** `lahe reply`, the way an agent runs it. */
async function agentAsks(w, review, item) {
  const code = await replyCommand.run(
    ["--review", review.id, "--item", item.id, "--rev", String(item.rev), "--status", "question", "--text", "The race week or the week after?", "--agent", "claude"],
    { stateDir: w.state, stdout: () => {}, stderr: () => {} }
  );
  assert.equal(code, 0, "lahe reply wrote the line");
}

function waitingDoc(res, reviewId) {
  return res.json.waiting_on_you.documents.find((d) => d.review === reviewId) || null;
}

test("R3: a question on a document nobody has read since the helper started counts within one beat, and on a fresh helper's first read", async (t) => {
  const w = await world(t);
  const { review, item } = closedDocument(w, "closed");
  const before = await read(w);
  assert.equal(before.status, 200, before.text);
  assert.equal(waitingDoc(before, review.id), null);
  assert.equal(before.json.waiting_on_agents.count, 1, "the comment waits on an agent");

  await agentAsks(w, review, item);
  w.clock.ms += BEAT;
  const after = await read(w);
  const shown = waitingDoc(after, review.id);
  assert.ok(shown, "the question counts: " + JSON.stringify(after.json.waiting_on_you));
  assert.equal(shown.questions, 1);
  assert.equal(after.json.waiting_on_agents.count, 0, "and no longer waits on an agent");

  await w.helper.close();
  const later = w.clock.ms + 60000;
  const second = await service.serve({ port: 0, stateDir: w.state, quiet: true, pagesPort: 0, sitesHome: w.home, now: () => later });
  t.after(() => second.close());
  w.clock.ms = later;
  const fresh = await read(w, { port: second.port, headers: { host: "127.0.0.1:" + second.port } });
  assert.equal(fresh.status, 200, fresh.text);
  assert.equal(waitingDoc(fresh, review.id).questions, 1, "a fresh helper answers the same on its first read");
  assert.equal(fresh.json.waiting_on_agents.count, 0);
});

test("R3: a question written while no helper ran counts on the next helper's first read", async (t) => {
  const w = await world(t);
  const { review, item } = closedDocument(w, "offline");
  await w.helper.close();
  await agentAsks(w, review, item);
  const later = w.clock.ms + 60000;
  const second = await service.serve({ port: 0, stateDir: w.state, quiet: true, pagesPort: 0, sitesHome: w.home, now: () => later });
  t.after(() => second.close());
  w.clock.ms = later;
  const fresh = await read(w, { port: second.port, headers: { host: "127.0.0.1:" + second.port } });
  assert.equal(fresh.status, 200, fresh.text);
  const shown = waitingDoc(fresh, review.id);
  assert.ok(shown, JSON.stringify(fresh.json.waiting_on_you));
  assert.equal(shown.questions, 1);
});

test("a replaced cli-secret is used from the next request on", async (t) => {
  const w = await world(t);
  assert.equal((await read(w)).status, 200);
  const fresh = crypto.randomBytes(32).toString("hex");
  stateDirModule.writeAtomic(path.join(w.state, "cli-secret"), fresh + "\n");
  const old = await read(w);
  assert.equal(old.status, 401, "the old key no longer checks");
  w.secret = fresh;
  const res = await read(w);
  assert.equal(res.status, 200, res.text);
  assert.ok(signedByHelper(w, res), "and the answer is signed with the new key");
});
