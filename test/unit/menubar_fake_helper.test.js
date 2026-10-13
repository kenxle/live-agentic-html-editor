// The menu bar app's fake helper (test/fixtures/menubar/fake_helper.js): it
// checks proofs and signs answers by the wire in docs/CONTRACTS.md, and each
// mode gives the answer it names. The app's own tests stand on this, so it is
// tested on its own here, on every system. It runs as a child process, the way
// the app's tests use it, and is stopped in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { pollUntil } = require("../helpers/poll.js");

const FAKE = path.join(__dirname, "..", "fixtures", "menubar", "fake_helper.js");
const fake = require(FAKE);
const FIXTURE = fs.readFileSync(path.join(__dirname, "..", "fixtures", "menubar", "summary.json"), "utf8");

/** Start the fake helper as a child; resolves once it prints its ready line. */
function startFake(stateDir, extra) {
  const child = spawn(process.execPath, [FAKE, "--state-dir", stateDir].concat(extra || []), { stdio: ["pipe", "pipe", "inherit"] });
  const lines = [];
  const waiters = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (text) => {
    buffer += text;
    let at;
    while ((at = buffer.indexOf("\n")) >= 0) {
      const line = JSON.parse(buffer.slice(0, at));
      buffer = buffer.slice(at + 1);
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else lines.push(line);
    }
  });
  const next = () => new Promise((resolve) => (lines.length ? resolve(lines.shift()) : waiters.push(resolve)));
  const command = (line) => {
    child.stdin.write(line + "\n");
    return next();
  };
  // Closing stdin stops it; a SIGKILL only if it lingers.
  const gone = () => child.exitCode !== null || child.signalCode !== null;
  const stop = async () => {
    if (gone()) return;
    child.stdin.end();
    try {
      await pollUntil(gone, { timeoutMs: 3000, message: "the fake helper to exit" });
    } catch (e) {
      child.kill("SIGKILL");
      await pollUntil(gone, { timeoutMs: 3000, message: "the fake helper to die" });
    }
  };
  return next().then((ready) => ({ child, ready, command, stop }));
}

/** One request by the wire. `tweak` can change headers or the signed parts. */
function ask(port, secret, options) {
  const o = Object.assign({ method: "GET", path: "/lahe/v1/summary?v=1", body: "", headers: {} }, options);
  const ts = o.ts || String(Date.now());
  const nonce = o.nonce || crypto.randomBytes(16).toString("hex");
  const proof = o.proof || fake.hmacHex(secret, fake.requestString(o.method, o.path, ts, nonce, o.body));
  const headers = Object.assign(
    { "x-lahe-proof-ts": ts, "x-lahe-proof-nonce": nonce, "x-lahe-proof": proof },
    o.method === "POST" ? { "Content-Type": "application/json" } : {},
    o.headers
  );
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, method: o.method, path: o.path, headers, timeout: o.timeout || 3000 }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        const body = Buffer.concat(chunks);
        const reply = res.headers["x-lahe-proof-reply"];
        const signed = reply === fake.hmacHex(secret, fake.replyString(nonce, res.statusCode, body));
        resolve({ status: res.statusCode, body: body.toString("utf8"), reply, signed, nonce });
      });
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
    req.end(o.body);
  });
}

test("the fake helper's wire matches every proof vector", () => {
  assert.equal(fake.checkVectors(), 6);
});

test("the fake helper checks proofs, signs answers, and gives each mode's answer", async (t) => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-menubar-fake-"));
  const helper = await startFake(stateDir);
  t.after(() => helper.stop());
  const port = helper.ready.port;
  const secret = fs.readFileSync(path.join(stateDir, "cli-secret"), "utf8").trim();

  const service = JSON.parse(fs.readFileSync(path.join(stateDir, "service.json"), "utf8"));
  assert.equal(service.port, port, "service.json names the port the app connects to");
  assert.equal(service.pages.port, 1483, "and the pages port the allowlist accepts");
  assert.equal(fs.statSync(path.join(stateDir, "cli-secret")).mode & 0o777, 0o600, "the secret is owner-only");

  const good = await ask(port, secret);
  assert.equal(good.status, 200);
  assert.ok(good.signed, "the answer is signed over the request's nonce");
  assert.equal(good.body, FIXTURE, "the fixture, byte for byte");

  const replay = await ask(port, secret, { nonce: good.nonce });
  assert.equal(replay.status, 401, "a nonce seen in the window is refused");
  assert.ok(replay.signed, "refusals are signed too");

  const stale = await ask(port, secret, { ts: String(Date.now() - 31000) });
  assert.equal(stale.status, 401, "a timestamp outside 30 seconds is refused");

  const wrongKey = await ask(port, secret + "0");
  assert.equal(wrongKey.status, 401, "a proof made with another key is refused");
  assert.equal(JSON.parse(wrongKey.body).error.code, "AUTH_REFUSED");

  const version = await ask(port, secret, { path: "/lahe/v1/summary?v=2" });
  assert.equal(version.status, 409);
  assert.equal(JSON.parse(version.body).error.code, "SUMMARY_VERSION");
  assert.ok(version.signed);

  const browser = await ask(port, secret, { headers: { "Sec-Fetch-Site": "cross-site" } });
  assert.equal(browser.status, 403, "a request carrying Sec-Fetch headers is refused");

  const rawSecret = await ask(port, secret, { headers: { "x-lahe-cli-secret": secret } });
  assert.equal(rawSecret.status, 401, "the raw secret header is refused");

  const openBody = JSON.stringify({ review: "r183d18583a43", summary_version: 1 });
  const opened = await ask(port, secret, { method: "POST", path: "/lahe/v1/summary/open", body: openBody });
  assert.equal(opened.status, 200);
  assert.ok(opened.signed);
  assert.equal(JSON.parse(opened.body).url, "http://notes.lahe.localhost:1483/r183d18583a43.md");

  const withOrigin = await ask(port, secret, { method: "POST", path: "/lahe/v1/summary/open", body: openBody, headers: { Origin: "http://evil.example" } });
  assert.equal(withOrigin.status, 403, "summary.open refuses any Origin");

  assert.deepEqual(await helper.command("open-url null"), { ok: true, open_url: null });
  const agentOnly = await ask(port, secret, { method: "POST", path: "/lahe/v1/summary/open", body: openBody });
  assert.deepEqual(JSON.parse(agentOnly.body), { url: null });

  await helper.command("mode 401");
  const refused = await ask(port, secret);
  assert.equal(refused.status, 401);
  assert.ok(refused.signed, "mode 401 answers a signed refusal");

  await helper.command("mode 409");
  const mismatch = await ask(port, secret);
  assert.equal(mismatch.status, 409);
  assert.ok(mismatch.signed);

  await helper.command("mode unsigned");
  const unsigned = await ask(port, secret);
  assert.equal(unsigned.status, 200);
  assert.equal(unsigned.reply, undefined, "mode unsigned sends no reply header");

  await helper.command("mode badsig");
  const badsig = await ask(port, secret);
  assert.ok(badsig.reply && !badsig.signed, "mode badsig sends a reply header that does not check");

  await helper.command("mode timeout");
  await assert.rejects(ask(port, secret, { timeout: 500 }), /timeout/, "mode timeout never answers");

  await helper.command("mode down");
  await assert.rejects(ask(port, secret), /ECONNREFUSED/, "mode down refuses the connection");

  await helper.command("mode ok");
  assert.equal((await ask(port, secret)).status, 200, "back up on the same port");

  const replaced = crypto.randomBytes(32).toString("hex");
  fs.writeFileSync(path.join(stateDir, "cli-secret"), replaced + "\n");
  assert.equal((await ask(port, secret)).status, 401, "a replaced secret file is read on the next request");
  assert.equal((await ask(port, replaced)).status, 200);

  await helper.command("fixture summary_empty.json");
  assert.equal(JSON.parse((await ask(port, replaced)).body).waiting_on_you.count, 0);

  const stats = await helper.command("stats");
  assert.equal(stats.secret_seen, true, "the raw-secret request above was noticed");
});

test("the fake helper stops when its stdin closes", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-menubar-fake-"));
  const helper = await startFake(stateDir);
  const exited = new Promise((resolve) => helper.child.once("exit", (code) => resolve(code)));
  helper.child.stdin.end();
  assert.equal(await exited, 0);
});
