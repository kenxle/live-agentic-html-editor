#!/usr/bin/env node
// A stand-in for the Lahe helper's two summary routes, for testing the menu bar
// app without a real helper. Node core modules only.
//
//   node test/fixtures/menubar/fake_helper.js --state-dir <dir>
//        [--fixture summary.json] [--mode ok] [--port 0] [--pages-port 1483] [--no-stdin]
//
// It speaks the wire in docs/CONTRACTS.md, "The summary routes and the
// signed-request wire (menu bar)": it checks every request's proof, signs every
// answer, and asserts test/fixtures/menubar/proof_vectors.json against its own
// code before it listens. It writes cli-secret (when missing) and service.json
// into the state folder, the two files the app reads, then prints one line:
// {"ready": true, "port": ..., "pages_port": ..., "pid": ...}.
//
// It reads cli-secret again on every request, the way a helper whose secret
// was replaced would answer with the new key.
//
// Commands, one per line on stdin, each answered with one JSON line:
//   mode ok|401|409|timeout|unsigned|badsig|down
//        ok        the real checks and the fixture
//        401, 409  a signed refusal or version mismatch
//        timeout   accept the request and never answer
//        unsigned  the fixture with no x-lahe-proof-reply
//        badsig    the fixture with a wrong x-lahe-proof-reply
//        down      stop listening, so a connection is refused
//   fixture <file>     serve another summary (a name in this folder, or a path)
//   open-url <url>     what summary.open answers next; "null" for {url: null}
//   stats              requests seen, and whether the raw secret ever arrived
//   quit
// stdin closing also stops it, so a test that dies takes it down. Under
// launchd, where stdin is empty, pass --no-stdin.

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const SUMMARY_VERSION = 1;
const WINDOW_MS = 30000;
const MODES = ["ok", "401", "409", "timeout", "unsigned", "badsig", "down"];

// ---------------------------------------------------------------------------
// The wire
// ---------------------------------------------------------------------------

function sha256Hex(body) {
  return crypto.createHash("sha256").update(body).digest("hex");
}

function hmacHex(secret, text) {
  return crypto.createHmac("sha256", Buffer.from(secret, "utf8")).update(text, "utf8").digest("hex");
}

function requestString(method, pathWithQuery, ts, nonce, body) {
  return ["lahe-proof-v1", method, pathWithQuery, ts, nonce, sha256Hex(body)].join("\n");
}

function replyString(nonce, status, body) {
  return ["lahe-proof-reply-v1", nonce, String(status), sha256Hex(body)].join("\n");
}

function sameHex(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length || !/^[0-9a-f]*$/.test(a)) return false;
  return crypto.timingSafeEqual(Buffer.from(a, "utf8"), Buffer.from(b, "utf8"));
}

/** Every case in proof_vectors.json against this file's code; throws on the first miss. */
function checkVectors(vectorsPath) {
  const vectors = JSON.parse(fs.readFileSync(vectorsPath || path.join(__dirname, "proof_vectors.json"), "utf8"));
  const expect = (ok, what) => {
    if (!ok) throw new Error("proof vector failed: " + what);
  };
  vectors.requests.forEach((r) => {
    const signed = requestString(r.method, r.path, r.ts, r.nonce, r.body);
    expect(sha256Hex(r.body) === r.body_sha256, r.name + " body hash");
    expect(signed === r.signed_string, r.name + " signed string");
    expect(hmacHex(vectors.secret, signed) === r.proof, r.name + " proof");
    expect(r.headers["x-lahe-proof"] === r.proof, r.name + " header");
  });
  vectors.replies.forEach((r) => {
    const signed = replyString(r.nonce, r.status, r.body);
    expect(sha256Hex(r.body) === r.body_sha256, r.name + " body hash");
    expect(signed === r.signed_string, r.name + " signed string");
    expect(hmacHex(vectors.secret, signed) === r.proof, r.name + " proof");
    expect(r.headers["x-lahe-proof-reply"] === r.proof, r.name + " header");
  });
  return vectors.requests.length + vectors.replies.length;
}

// ---------------------------------------------------------------------------
// The server
// ---------------------------------------------------------------------------

function argValue(argv, name, fallback) {
  const at = argv.indexOf(name);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : fallback;
}

function fixturePath(name) {
  return name.includes("/") ? path.resolve(name) : path.join(__dirname, name);
}

function errorBody(code, detail) {
  return JSON.stringify({ error: { code: code, detail: detail } });
}

/**
 * @param {{stateDir: string, fixture?: string, mode?: string, port?: number, pagesPort?: number}} options
 * @returns {Promise<{port: number, command: function(string): object, close: function(): Promise<void>}>}
 */
async function start(options) {
  const stateDir = options.stateDir;
  const pagesPort = options.pagesPort || 1483;
  fs.mkdirSync(stateDir, { recursive: true });
  const secretPath = path.join(stateDir, "cli-secret");
  if (!fs.existsSync(secretPath)) fs.writeFileSync(secretPath, crypto.randomBytes(32).toString("hex") + "\n", { mode: 0o600 });

  let mode = options.mode || "ok";
  let fixture = fs.readFileSync(fixturePath(options.fixture || "summary.json"));
  let openUrl; // undefined: the default address
  const seen = new Map(); // nonce -> time, for the replay check
  const hanging = new Set();
  const stats = { requests: 0, secret_seen: false, refused: {} };
  let port = options.port || 0;

  function secret() {
    return fs.readFileSync(secretPath, "utf8").trim();
  }

  function send(res, nonce, status, body, signature) {
    const bytes = Buffer.from(body, "utf8");
    const headers = { "Content-Type": "application/json", "Content-Length": bytes.length };
    if (signature === undefined) headers["x-lahe-proof-reply"] = hmacHex(secret(), replyString(nonce, status, bytes));
    else if (signature !== null) headers["x-lahe-proof-reply"] = signature;
    res.writeHead(status, headers);
    res.end(bytes);
  }

  function refuse(res, nonce, status, code, detail) {
    stats.refused[code] = (stats.refused[code] || 0) + 1;
    send(res, nonce, status, errorBody(code, detail));
  }

  /** The real checks, in the helper's order. Returns true when the request may proceed. */
  function admitted(req, res, body, nonce) {
    if (req.headers.host !== "127.0.0.1:" + port) return refuse(res, nonce, 403, "PROTO_BAD_HOST", "host " + req.headers.host), false;
    const fetchHeader = ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-dest"].some((h) => req.headers[h] !== undefined);
    if (fetchHeader) return refuse(res, nonce, 403, "PROTO_CROSS_SITE", "a browser request"), false;
    if (req.headers["x-lahe-cli-secret"] !== undefined) return refuse(res, nonce, 401, "AUTH_REFUSED", "the raw secret is refused"), false;
    if (req.method === "POST" && req.headers.origin !== undefined) return refuse(res, nonce, 403, "PROTO_FORBIDDEN_ORIGIN", "an Origin header"), false;
    const ts = req.headers["x-lahe-proof-ts"];
    const proof = req.headers["x-lahe-proof"];
    const now = Date.now();
    for (const [old, at] of seen) if (now - at > WINDOW_MS) seen.delete(old);
    const fresh = typeof ts === "string" && /^\d+$/.test(ts) && Math.abs(now - Number(ts)) <= WINDOW_MS;
    const goodNonce = typeof nonce === "string" && /^[0-9a-f]{32}$/.test(nonce) && !seen.has(nonce);
    const expected = hmacHex(secret(), requestString(req.method, req.url, String(ts), String(nonce), body));
    if (!fresh || !goodNonce || !sameHex(proof, expected)) return refuse(res, nonce || "", 401, "AUTH_REFUSED", "the proof did not check"), false;
    seen.set(nonce, now);
    return true;
  }

  function handle(req, res, body) {
    stats.requests += 1;
    const key = secret();
    const raw = JSON.stringify(req.headers) + body.toString("utf8");
    if (key && raw.includes(key)) stats.secret_seen = true;
    const nonce = req.headers["x-lahe-proof-nonce"] || "";

    if (mode === "timeout") {
      hanging.add(res);
      res.on("close", () => hanging.delete(res));
      return;
    }
    if (mode === "401") return send(res, nonce, 401, errorBody("AUTH_REFUSED", "the proof did not check"));
    if (mode === "409") return send(res, nonce, 409, errorBody("SUMMARY_VERSION", "this helper answers summary_version " + SUMMARY_VERSION));
    if (mode === "unsigned") return send(res, nonce, 200, fixture.toString("utf8"), null);
    if (mode === "badsig") return send(res, nonce, 200, fixture.toString("utf8"), "0".repeat(64));

    if (!admitted(req, res, body, nonce)) return;
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/lahe/v1/summary") {
      if (url.searchParams.get("v") !== String(SUMMARY_VERSION)) {
        return refuse(res, nonce, 409, "SUMMARY_VERSION", "this helper answers summary_version " + SUMMARY_VERSION);
      }
      return send(res, nonce, 200, fixture.toString("utf8"));
    }
    if (req.method === "POST" && url.pathname === "/lahe/v1/summary/open") {
      let asked = null;
      try {
        asked = JSON.parse(body.toString("utf8"));
      } catch (e) {
        asked = null;
      }
      if (!asked || typeof asked.review !== "string") return refuse(res, nonce, 400, "PROTO_BAD_REQUEST", "review is required");
      if (asked.summary_version !== SUMMARY_VERSION) {
        return refuse(res, nonce, 409, "SUMMARY_VERSION", "this helper answers summary_version " + SUMMARY_VERSION);
      }
      const answer = openUrl === undefined ? "http://notes.lahe.localhost:" + pagesPort + "/" + asked.review + ".md" : openUrl;
      return send(res, nonce, 200, JSON.stringify({ url: answer }));
    }
    return refuse(res, nonce, 404, "PROTO_NOT_FOUND", "no such route");
  }

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => handle(req, res, Buffer.concat(chunks)));
  });

  function listen() {
    return new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () => {
        server.removeListener("error", reject);
        port = server.address().port;
        resolve();
      });
    });
  }

  function dropHanging() {
    hanging.forEach((res) => res.destroy());
    hanging.clear();
  }

  function goDown() {
    dropHanging();
    return new Promise((resolve) => {
      if (!server.listening) return resolve();
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }

  if (mode !== "down") await listen();
  else {
    await listen();
    await goDown();
  }
  const service = { port: port, pid: process.pid, started_at: new Date().toISOString(), pages: { port: pagesPort } };
  fs.writeFileSync(path.join(stateDir, "service.json"), JSON.stringify(service, null, 2) + "\n", { mode: 0o600 });

  async function command(line) {
    const [verb, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(" ");
    if (verb === "mode") {
      if (!MODES.includes(arg)) return { ok: false, error: "unknown mode " + arg };
      if (mode === "timeout") dropHanging();
      mode = arg;
      if (arg === "down") await goDown();
      else if (!server.listening) await listen();
      return { ok: true, mode: mode };
    }
    if (verb === "fixture") {
      fixture = fs.readFileSync(fixturePath(arg));
      return { ok: true, fixture: arg };
    }
    if (verb === "open-url") {
      openUrl = arg === "null" ? null : arg;
      return { ok: true, open_url: openUrl };
    }
    if (verb === "stats") return Object.assign({ ok: true, mode: mode }, stats);
    return { ok: false, error: "unknown command " + verb };
  }

  return { port: () => port, pagesPort: pagesPort, command: command, close: goDown };
}

async function main(argv) {
  checkVectors();
  const helper = await start({
    stateDir: path.resolve(argValue(argv, "--state-dir", "")),
    fixture: argValue(argv, "--fixture", "summary.json"),
    mode: argValue(argv, "--mode", "ok"),
    port: Number(argValue(argv, "--port", "0")),
    pagesPort: Number(argValue(argv, "--pages-port", "1483"))
  });
  const say = (object) => process.stdout.write(JSON.stringify(object) + "\n");
  say({ ready: true, port: helper.port(), pages_port: helper.pagesPort, pid: process.pid });
  const stop = () => helper.close().then(() => process.exit(0));
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  if (argv.includes("--no-stdin")) return;
  let buffer = "";
  let queue = Promise.resolve();
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (text) => {
    buffer += text;
    let newline;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      if (line.trim() === "quit") {
        queue = queue.then(stop);
        continue;
      }
      queue = queue.then(() => helper.command(line)).then(say, (err) => say({ ok: false, error: err.message }));
    }
  });
  process.stdin.on("end", stop);
}

if (require.main === module) {
  if (!process.argv.includes("--state-dir")) {
    process.stderr.write("usage: node fake_helper.js --state-dir <dir> [--fixture f] [--mode m] [--port p] [--no-stdin]\n");
    process.exit(2);
  }
  main(process.argv.slice(2)).catch((err) => {
    process.stderr.write("fake_helper: " + err.message + "\n");
    process.exit(1);
  });
}

module.exports = { checkVectors, hmacHex, replyString, requestString, sha256Hex, start };
