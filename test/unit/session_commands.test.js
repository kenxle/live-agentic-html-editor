"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const reviewCommand = require("../../src/cli/commands/review.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const service = require("../../src/service/index.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const staticServers = require("../../src/service/static_servers.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
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

async function capture(run) {
  const stdout = [];
  const stderr = [];
  const oldOut = process.stdout.write;
  const oldErr = process.stderr.write;
  process.stdout.write = (chunk) => { stdout.push(String(chunk)); return true; };
  process.stderr.write = (chunk) => { stderr.push(String(chunk)); return true; };
  try {
    const code = await run();
    return { code, stdout: stdout.join(""), stderr: stderr.join("") };
  } finally {
    process.stdout.write = oldOut;
    process.stderr.write = oldErr;
  }
}

test("review re-entry infers its session, and the final close stops the helper", async (t) => {
  const root = tempDir("lahe-session-command-");
  const state = path.join(root, "state");
  const page = path.join(root, "page.html");
  fs.writeFileSync(page, "<!doctype html><body><p>Review me</p></body>");
  const port = await freePort();

  const first = await capture(() => reviewCommand.run([page, "--state-dir", state, "--port", String(port)]));
  assert.equal(first.code, 0, first.stderr);
  const sessionId = first.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const reviewId = first.stdout.match(/^\s*review\s+(r[a-f0-9]+)/m)[1];
  const firstServer = staticServers.list(state, sessionId)[0];
  assert.ok(firstServer);
  assert.match(first.stdout, new RegExp("open\\s+http://127\\.0\\.0\\.1:" + firstServer.port + "/page\\.html"));
  assert.equal(await staticServers.isExactServer(firstServer), true);
  t.after(async () => {
    await capture(() => sessionCommand.run(["close", sessionId, "--state-dir", state, "--port", String(port)]));
  });

  const second = await capture(() => reviewCommand.run([page, "--state-dir", state, "--port", String(port)]));
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, new RegExp("session\\s+" + sessionId));
  assert.match(second.stdout, new RegExp("review\\s+" + reviewId));
  assert.match(second.stdout, new RegExp("server\\s+http://127\\.0\\.0\\.1:" + firstServer.port + ".*reused"));

  const closed = await capture(() => sessionCommand.run(["close", sessionId, "--state-dir", state, "--port", String(port)]));
  assert.equal(closed.code, 0, closed.stderr);
  assert.match(closed.stdout, /shared helper stopped/);
  assert.match(closed.stdout, /static review server stopped/);
  assert.equal(await service.probeHealth("127.0.0.1", port), null);
  assert.equal(await staticServers.isExactServer(firstServer), false);

  const reopened = await capture(() => sessionCommand.run(["reopen", sessionId, "--state-dir", state, "--port", String(port)]));
  assert.equal(reopened.code, 0, reopened.stderr);
  assert.match(reopened.stdout, /shared helper started/);
  assert.match(reopened.stdout, /static review server restarted/);
  assert.ok(await service.probeHealth("127.0.0.1", port));
  const restartedServer = staticServers.list(state, sessionId)[0];
  assert.notEqual(restartedServer.instance, firstServer.instance);
  assert.equal(await staticServers.isExactServer(restartedServer), true);

  await capture(() => sessionCommand.run(["close", sessionId, "--state-dir", state, "--port", String(port)]));
});

test("closing one of several open sessions keeps the shared helper alive", async (t) => {
  const root = tempDir("lahe-shared-session-command-");
  const state = path.join(root, "state");
  const page = path.join(root, "page.html");
  fs.writeFileSync(page, "<!doctype html><body><p>Shared helper</p></body>");
  const port = await freePort();
  const first = await capture(() => reviewCommand.run([page, "--state-dir", state, "--port", String(port)]));
  assert.equal(first.code, 0, first.stderr);
  const firstId = first.stdout.match(/^\s*session\s+(s_[a-f0-9]+)/m)[1];
  const secondId = agentSessions.createStore({ dir: state }).create({ id: "s_second" }).id;
  t.after(async () => {
    await capture(() => sessionCommand.run(["close", firstId, "--state-dir", state, "--port", String(port)]));
    await capture(() => sessionCommand.run(["close", secondId, "--state-dir", state, "--port", String(port)]));
  });

  const firstClose = await capture(() => sessionCommand.run(["close", firstId, "--state-dir", state, "--port", String(port)]));
  assert.equal(firstClose.code, 0, firstClose.stderr);
  assert.equal(firstClose.stdout.includes("helper stopped"), false);
  assert.ok(await service.probeHealth("127.0.0.1", port));

  const finalClose = await capture(() => sessionCommand.run(["close", secondId, "--state-dir", state, "--port", String(port)]));
  assert.equal(finalClose.code, 0, finalClose.stderr);
  assert.match(finalClose.stdout, /shared helper stopped/);
  assert.equal(await service.probeHealth("127.0.0.1", port), null);
});

test("closing the final session succeeds when its recorded helper is already down", async () => {
  const root = tempDir("lahe-stopped-session-command-");
  const state = path.join(root, "state");
  const port = await freePort();
  const sessionId = agentSessions.createStore({ dir: state }).create({ id: "s_stopped" }).id;
  fs.writeFileSync(
    path.join(state, "service.json"),
    JSON.stringify({ pid: 999999, port, started_at: "2026-08-18T00:00:00.000Z" })
  );

  const closed = await capture(() => sessionCommand.run(["close", sessionId, "--state-dir", state]));
  assert.equal(closed.code, 0, closed.stderr);
  assert.match(closed.stdout, /review history kept/);
  assert.equal(closed.stdout.includes("helper stopped"), false);
  assert.ok(agentSessions.createStore({ dir: state }).read(sessionId).closed_at);
});

test("takeover is explicit, advances the handoff fence, and prints safe catch-up commands", async (t) => {
  const root = tempDir("lahe-takeover-session-command-");
  const state = path.join(root, "state");
  const port = await freePort();
  const sessionId = agentSessions.createStore({ dir: state }).create({ id: "s_takeover" }).id;
  t.after(async () => {
    await capture(() => sessionCommand.run(["close", sessionId, "--state-dir", state, "--port", String(port)]));
  });

  const result = await capture(() => sessionCommand.run([
    "takeover", sessionId, "--state-dir", state, "--port", String(port)
  ]));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /taken over explicitly/);
  assert.match(result.stdout, new RegExp("catch-up\\s+lahe status --session " + sessionId + " --json"));
  // The new owner gets the same four commands `lahe review` printed, wake line
  // first, so a handoff does not send anyone back to a doc for the exact paths.
  assert.match(result.stdout, new RegExp("wake\\s+tail -n 0 -f \\S+/agent-sessions/" + sessionId + "/wake\\.log"));
  assert.match(result.stdout, new RegExp("monitor\\s+lahe monitor --session " + sessionId + "$", "m"));
  assert.match(result.stdout, new RegExp("drain\\s+lahe status --session " + sessionId + " --json --quiet"));
  assert.match(result.stdout, /older lahe monitor processes exit with 6/);
  assert.equal(agentSessions.createStore({ dir: state }).read(sessionId).handoff_rev, 1);
});
