// Stable addresses, Step 3: page servers retired, the helper serves every page
// (Tasks 3.1 and 3.2).
//
// Plan rows: V35 (leftover page
// servers are stopped on start, only when their probe proves who they are),
// V36 (nothing spawns a page server), V37 (lahe review names a taken pages
// port), V71 (the log lines). Every process a test starts is stopped in
// teardown, even when it fails. V34 (the old idle wait stops nothing) could
// not fail once the idle sweep was gone; it is in
// test/retired/unit/sites_step3_v34.retired.test.js.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn, execFile } = require("node:child_process");

const staticServers = require("../../src/service/static_servers.js");
const stateDir = require("../../src/service/state_dir.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const { pollUntil } = require("../helpers/poll.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");
const { sitesWorld, writeFile, getPage, raw, tempRoot } = require("../helpers/sites_world.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "lahe.js");
const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>still here</p></body></html>";

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return false; }
}

/**
 * A process that answers a page server's health probe, as an old page server
 * did, on a free port. Returns {child, port}. Stopped in teardown.
 */
async function fakeOldServer(t, id, instance, startedAt) {
  const script = [
    "const http = require('http');",
    "const s = http.createServer((req, res) => {",
    "  if (req.url === '/.lahe-static-health/" + id + "/" + instance + "') {",
    "    res.writeHead(200, {'content-type': 'application/json'});",
    "    return res.end(JSON.stringify({id: '" + id + "', instance: '" + instance + "', started_at: '" + startedAt + "', pid: process.pid}));",
    "  }",
    "  res.writeHead(404); res.end();",
    "});",
    "s.listen(0, '127.0.0.1', () => process.stdout.write(String(s.address().port) + '\\n'));",
    "process.on('SIGTERM', () => s.close(() => process.exit(0)));"
  ].join("\n");
  const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "ignore"] });
  t.after(() => { if (alive(child.pid)) child.kill("SIGKILL"); });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once("data", (chunk) => resolve(Number(String(chunk).trim())));
    child.once("error", reject);
  });
  return { child, port };
}

function writeOldRecord(dir, session, record) {
  stateDir.ensureStaticServersRoot(dir, session);
  const file = stateDir.staticServerPath(dir, session, record.id);
  fs.writeFileSync(file, JSON.stringify(Object.assign({ schema: 1, session_id: session, host: "127.0.0.1", stopped_at: null, mounts: {} }, record)));
  return file;
}

// --- V35 ------------------------------------------------------------------------

test("V35: every helper start stops a leftover page server, after its health probe proves it is the recorded process", async (t) => {
  const root = tempRoot("lahe-leftover-");
  const state = path.join(root, "state");
  fs.mkdirSync(state);
  const startedAt = "2026-09-01T00:00:00.000Z";
  const old = await fakeOldServer(t, "ss_old", "inst_old", startedAt);
  const file = writeOldRecord(state, "s_before", {
    id: "ss_old", instance: "inst_old", root: root, port: old.port, ports: [old.port], pid: old.child.pid, started_at: startedAt
  });
  const helper = await require("../../src/service/index.js").serve({ port: 0, stateDir: state, quiet: true, pagesPort: 0 });
  t.after(() => helper.close());
  await pollUntil(() => !alive(old.child.pid), { timeoutMs: 10000, message: "the leftover page server to stop" });
  const record = await pollUntil(() => {
    const read = JSON.parse(fs.readFileSync(file, "utf8"));
    return read.stopped_at ? read : null;
  }, { timeoutMs: 5000, message: "its record to say it stopped" });
  assert.equal(record.stop_reason, staticServers.RETIRED_REASON);
  await pollUntil(() => /stopped 1 page server left over/.test(fs.readFileSync(path.join(state, "helper.log"), "utf8")), {
    timeoutMs: 5000, message: "the log line"
  });
});

test("V35: a process that does not answer as the recorded server is never signalled, and its record is closed", async (t) => {
  const root = tempRoot("lahe-leftover-stranger-");
  const state = path.join(root, "state");
  fs.mkdirSync(state);
  // A stranger: holds a pid and a port, and answers the probe with someone else's identity.
  const stranger = await fakeOldServer(t, "ss_other", "inst_other", "2026-09-02T00:00:00.000Z");
  const file = writeOldRecord(state, "s_before", {
    id: "ss_old", instance: "inst_old", root: root, port: stranger.port, ports: [stranger.port],
    pid: stranger.child.pid, started_at: "2026-09-01T00:00:00.000Z"
  });
  const stopped = await staticServers.stopLeftovers(state);
  assert.equal(stopped, 0);
  assert.equal(alive(stranger.child.pid), true, "the stranger was not touched");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).stop_reason, staticServers.RETIRED_REASON);
});

// --- V36 ------------------------------------------------------------------------

test("V36: no code path spawns a page server", () => {
  const offenders = [];
  (function walk(dir) {
    fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      if (!entry.name.endsWith(".js")) return;
      const text = fs.readFileSync(full, "utf8");
      if (/["']--serve["']/.test(text) || /require\.main === module/.test(text) && /static_servers/.test(full)) offenders.push(full);
    });
  })(path.join(REPO_ROOT, "src"));
  assert.deepEqual(offenders, []);
  ["start", "runServer", "restartAll", "stopAll", "registerMount", "createCatalogOps"].forEach((name) => {
    assert.equal(staticServers[name], undefined, name + " is gone");
  });
});

// --- V71 ------------------------------------------------------------------------

test("V71: the log records the port, the ending and why, each new name, and each refused Host without page content", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  writeFile(folder, "page.html", PAGE);
  const bound = w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "page.html" });
  await raw(w.helper.pagesPort, { path: "/secret-page-name.html?token=abc", headers: { host: "evil.example:" + w.helper.pagesPort } });
  const log = fs.readFileSync(path.join(w.state, "helper.log"), "utf8");
  assert.match(log, new RegExp("pages on port " + w.helper.pagesPort + "; addresses print as <name>\\.lahe\\.localhost because every browser"));
  assert.match(log, new RegExp("printed with :" + w.helper.pagesPort + " \\(port-80 forward: "));
  assert.match(log, new RegExp("sites: new name " + bound.name.replace(/\./g, "\\.") + " for "));
  const refused = log.split("\n").filter((line) => /refused Host "evil\.example/.test(line));
  assert.equal(refused.length, 1);
  assert.doesNotMatch(refused[0], /secret-page-name|token=abc/);
});

// --- V37: lahe review names a taken pages port ------------------------------------

test("V37: lahe review with no helper running names a pages port another program holds", async (t) => {
  const root = tempRoot("lahe-taken-");
  const state = path.join(root, "state");
  const page = writeFile(root, "doc/page.html", PAGE);
  const holder = net.createServer();
  await new Promise((r) => holder.listen(0, "127.0.0.1", r));
  t.after(() => new Promise((r) => holder.close(() => r())));
  const taken = holder.address().port;
  const apiPort = await new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  t.after(() => stopTempHelpers(state));
  const out = await new Promise((resolve) => {
    execFile(process.execPath, [BIN, "review", page, "--port", String(apiPort), "--state-dir", state], {
      env: Object.assign({}, process.env, { LAHE_PAGES_PORT: String(taken) }),
      encoding: "utf8"
    }, (err, stdout, stderr) => resolve({ code: err ? err.code : 0, stdout, stderr }));
  });
  assert.notEqual(out.code, 0);
  assert.match(out.stderr, new RegExp("port " + taken + " is taken by another program"));
});
