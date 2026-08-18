"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const staticServers = require("../../src/service/static_servers.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request(meta, pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: meta.host, port: meta.port, path: pathname, method }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("a session-owned static server is reusable, read-only, contained, and stoppable", async (t) => {
  const root = tempDir("lahe-static-root-");
  const state = path.join(tempDir("lahe-static-state-"), "state");
  const outside = path.join(tempDir("lahe-static-outside-"), "secret.txt");
  fs.writeFileSync(path.join(root, "page.html"), "<!doctype html><p>review page</p>");
  fs.writeFileSync(outside, "do not serve");
  fs.symlinkSync(outside, path.join(root, "outside.txt"));

  const first = await staticServers.start({ dir: state, sessionId: "s_static", root });
  t.after(async () => { await staticServers.stopAll(state, "s_static"); });
  assert.equal(first.started, true);
  assert.equal(await staticServers.isExactServer(first.meta), true);

  const page = await request(first.meta, "/page.html");
  assert.equal(page.status, 200);
  assert.equal(page.body, "<!doctype html><p>review page</p>");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.match(page.headers["content-type"], /^text\/html/);

  assert.equal((await request(first.meta, "/outside.txt")).status, 403);
  assert.equal((await request(first.meta, "/page.html", "POST")).status, 405);

  const second = await staticServers.start({ dir: state, sessionId: "s_static", root });
  assert.equal(second.started, false);
  assert.equal(second.meta.instance, first.meta.instance);

  assert.equal(await staticServers.stopOne(state, "s_static", first.meta), true);
  assert.equal(await staticServers.isExactServer(first.meta), false);
  assert.ok(staticServers.list(state, "s_static")[0].stopped_at);
});

test("corrupt static-server metadata fails loud instead of losing process ownership", async () => {
  const state = path.join(tempDir("lahe-static-corrupt-"), "state");
  const root = path.join(state, "agent-sessions", "s_corrupt", "static-servers");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "ss_broken.json"), "not json");
  assert.throws(
    () => staticServers.list(state, "s_corrupt"),
    /metadata is corrupt/
  );
});

test("two agent sessions in the same project root own independent server leases", async (t) => {
  const root = tempDir("lahe-static-shared-root-");
  const state = path.join(tempDir("lahe-static-shared-state-"), "state");
  fs.writeFileSync(path.join(root, "page.html"), "<!doctype html><p>shared root</p>");
  const alpha = await staticServers.start({ dir: state, sessionId: "s_alpha", root });
  const beta = await staticServers.start({ dir: state, sessionId: "s_beta", root });
  t.after(async () => {
    await staticServers.stopAll(state, "s_alpha");
    await staticServers.stopAll(state, "s_beta");
  });

  assert.notEqual(alpha.meta.instance, beta.meta.instance);
  assert.notEqual(alpha.meta.port, beta.meta.port);
  await staticServers.stopAll(state, "s_alpha");
  assert.equal(await staticServers.isExactServer(alpha.meta), false);
  assert.equal(await staticServers.isExactServer(beta.meta), true);
});

test("one agent session can own static reviews in different project roots", async (t) => {
  const firstRoot = tempDir("lahe-static-first-root-");
  const secondRoot = tempDir("lahe-static-second-root-");
  const state = path.join(tempDir("lahe-static-many-state-"), "state");
  fs.writeFileSync(path.join(firstRoot, "one.html"), "one");
  fs.writeFileSync(path.join(secondRoot, "two.html"), "two");
  const first = await staticServers.start({ dir: state, sessionId: "s_many", root: firstRoot });
  const second = await staticServers.start({ dir: state, sessionId: "s_many", root: secondRoot });
  t.after(async () => { await staticServers.stopAll(state, "s_many"); });

  assert.equal(staticServers.list(state, "s_many").length, 2);
  assert.equal(await staticServers.isExactServer(first.meta), true);
  assert.equal(await staticServers.isExactServer(second.meta), true);
  assert.equal(await staticServers.stopAll(state, "s_many"), 2);
  assert.equal(await staticServers.isExactServer(first.meta), false);
  assert.equal(await staticServers.isExactServer(second.meta), false);
});
