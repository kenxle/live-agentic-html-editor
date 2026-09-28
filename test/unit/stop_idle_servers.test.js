// Page servers nobody is looking at stop, and come back when asked.
//
// Spec: docs/features/20260928.05_stop_idle_servers/01_spec_stop_idle_servers.md.
// The owner (2026-09-28): servers for open docs may keep running, but "if there
// are no browser windows open, then I think we're ok to close". The session
// stays open, so its agent keeps watching.
//
// Real page servers and the real review registry. The clock the registry and
// the sweeper read is injected, so "two minutes later" is a number, not a wait.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const staticServers = require("../../src/service/static_servers.js");
const idleServers = require("../../src/service/idle_servers.js");
const reviewsModule = require("../../src/service/reviews.js");
const logModule = require("../../src/service/log.js");
const agentSessionsModule = require("../../src/service/agent_sessions.js");
const status = require("../../src/cli/commands/status.js");
const stateDirModule = require("../../src/service/state_dir.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BIN = path.join(REPO_ROOT, "bin", "lahe.js");

const GRACE_MS = 2 * 60 * 1000;

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function get(port, pathname) {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port: port, path: pathname }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", (err) => resolve({ status: 0, error: err.code }));
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

/**
 * One state directory with a clock, a registry, a session store and a sweeper,
 * and a helper for standing up a session that owns one served page.
 */
function world(t) {
  const dir = path.join(tempDir("lahe-idle-state-"), "state");
  fs.mkdirSync(dir, { recursive: true });
  const clock = { at: Date.now() };
  const now = () => clock.at;
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: now });
  const sessions = agentSessionsModule.createStore({ dir: dir });
  const sweeper = idleServers.createIdleServers({
    dir: dir,
    reviews: reviews,
    agentSessions: sessions,
    log: log,
    now: now,
    graceMs: GRACE_MS
  });
  const owned = [];
  t.after(async () => {
    for (const id of owned) {
      try { await staticServers.stopAll(dir, id); } catch (err) { /* best effort */ }
    }
  });

  async function session(id) {
    sessions.create({ id: id });
    sessions.wake.ensure(id);
    const root = tempDir("lahe-idle-root-");
    const page = path.join(root, "page.html");
    fs.writeFileSync(page, "<!doctype html><title>Idle</title><p>" + id + "</p>");
    const started = await staticServers.start({ dir: dir, sessionId: id, root: root });
    owned.push(id);
    const review = reviews.create({
      agent_session_id: id,
      target_path: page,
      origins: ["http://127.0.0.1:" + started.meta.port]
    });
    return { id: id, root: root, page: page, review: review.id, server: started.meta };
  }

  function running(id) {
    return staticServers.list(dir, id).filter((meta) => !meta.stopped_at);
  }

  function advance(ms) {
    clock.at += ms;
  }

  return { dir, clock, advance, reviews, sessions, sweeper, session, running, log };
}

/** Open a window on a review: a claim the helper grants. Returns its secret. */
function openWindow(w, reviewId, windowId, extra) {
  const granted = w.reviews.claimWindow(reviewId, Object.assign({ window_id: windowId }, extra || {}));
  assert.equal(granted.granted, true, "the window was granted the review");
  w.sweeper.windowActivity(reviewId);
  return granted.session_secret;
}

function beat(w, reviewId, windowId, secret, extra) {
  const granted = w.reviews.claimWindow(reviewId, Object.assign({ window_id: windowId, session_secret: secret }, extra || {}));
  assert.equal(granted.granted, true, "the heartbeat was granted");
  w.sweeper.windowActivity(reviewId);
}

function goodbye(w, reviewId, secret) {
  assert.equal(w.reviews.releaseWindow(reviewId, { session_secret: secret }).released, true);
  w.sweeper.windowActivity(reviewId);
}

test("a session whose last window says goodbye stops its servers after the grace, and not before", async (t) => {
  const w = world(t);
  const a = await w.session("s_goodbye");
  const secret = openWindow(w, a.review, "win-1");
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 1, "a window is open: the server runs");

  w.advance(5000);
  goodbye(w, a.review, secret);
  w.advance(GRACE_MS - 1000);
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 1, "inside the grace the server still runs");
  assert.equal((await get(a.server.port, "/page.html")).status, 200);

  w.advance(2000);
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 0, "two minutes after the goodbye the server is stopped");
  const record = staticServers.list(w.dir, a.id)[0];
  assert.equal(record.stop_reason, staticServers.IDLE_REASON);
  assert.equal((await get(a.server.port, "/page.html")).status, 0, "nothing answers on the old port");
});

test("a reload inside the grace keeps the servers", async (t) => {
  const w = world(t);
  const a = await w.session("s_reload");
  const first = openWindow(w, a.review, "win-1");
  await w.sweeper.sweep();

  // The reload: the outgoing page says goodbye, the new one claims.
  goodbye(w, a.review, first);
  w.advance(800);
  const second = openWindow(w, a.review, "win-2");
  // The new page keeps beating every ten seconds for well past the grace.
  for (let i = 0; i < 30; i += 1) {
    w.advance(10000);
    beat(w, a.review, "win-2", second);
    await w.sweeper.sweep();
  }
  assert.equal(w.running(a.id).length, 1, "the reloaded page is open, so its server runs");
  assert.equal((await get(a.server.port, "/page.html")).status, 200);
});

test("a hidden tab on the slow heartbeat keeps its servers for its whole claim window", async (t) => {
  const w = world(t);
  const a = await w.session("s_hidden");
  const secret = openWindow(w, a.review, "win-hidden");
  // The tab goes hidden: its next beat says quiet, then it beats every five
  // minutes. The helper holds a quiet holder for 390 seconds.
  w.advance(10000);
  beat(w, a.review, "win-hidden", secret, { quiet: true });
  for (let i = 0; i < 3; i += 1) {
    // Swept every thirty seconds across a five minute gap, and a minute late
    // (Chrome wakes a long-hidden tab's timers once a minute).
    for (let s = 0; s < 12; s += 1) {
      w.advance(30000);
      await w.sweeper.sweep();
      assert.equal(w.running(a.id).length, 1, "a hidden tab is still open (beat " + i + ", sweep " + s + ")");
    }
    beat(w, a.review, "win-hidden", secret, { quiet: true });
  }

  // The tab crashed while hidden: no goodbye. It counts as open until its 390
  // second window runs out, and the grace starts there.
  w.advance(380000);
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 1, "at 380 seconds the hidden holder still counts");
  w.advance(20000);
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 1, "the grace has only just started");
  w.advance(GRACE_MS);
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 0, "390 seconds plus the grace after its last beat, it is stopped");
});

test("another session's windows never keep or stop this session's servers", async (t) => {
  const w = world(t);
  const a = await w.session("s_alone");
  const b = await w.session("s_other");
  const secretB = openWindow(w, b.review, "win-b");
  await w.sweeper.sweep();

  // b keeps beating the whole time; a never had a window.
  for (let i = 0; i < 14; i += 1) {
    w.advance(10000);
    beat(w, b.review, "win-b", secretB);
    await w.sweeper.sweep();
  }
  assert.equal(w.running(a.id).length, 0, "a's server stopped although b had a window open all along");
  assert.equal(w.running(b.id).length, 1, "b's server runs: its own window is open");
  assert.equal((await get(b.server.port, "/page.html")).status, 200);
});

test("a server whose link was just handed out gets its own grace", async (t) => {
  const w = world(t);
  const a = await w.session("s_handout");
  const secret = openWindow(w, a.review, "win-1");
  goodbye(w, a.review, secret);
  w.advance(GRACE_MS - 5000);
  await w.sweeper.sweep();
  // `lahe review` reuses the running server and prints its link again.
  staticServers.noteLinkGiven(w.dir, a.id, a.server.id, new Date(w.clock.at).toISOString());
  w.advance(60000);
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 1, "the reviewer has two minutes from the new link");
  w.advance(GRACE_MS);
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 0);
});

test("a window that comes back brings an idle-stopped server back on its old port", async (t) => {
  const w = world(t);
  const a = await w.session("s_back");
  const secret = openWindow(w, a.review, "win-1");
  await w.sweeper.sweep();
  goodbye(w, a.review, secret);
  w.advance(GRACE_MS + 1000);
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 0);

  // A hidden second window that never held the review comes back and claims it.
  openWindow(w, a.review, "win-2");
  await w.sweeper.settled();
  const back = w.running(a.id);
  assert.equal(back.length, 1, "the claim brought the server back");
  assert.equal(back[0].port, a.server.port, "on the port the page's address names");
  assert.equal((await get(a.server.port, "/page.html")).status, 200);
});

test("the session stays open, and its wake feed and monitor are untouched", async (t) => {
  const w = world(t);
  const a = await w.session("s_watch");
  w.sessions.writeMonitor(a.id, { pid: process.pid, handoff_rev: 0 });
  const monitorBefore = fs.readFileSync(stateDirModule.monitorPath(w.dir, a.id), "utf8");
  const feedBefore = fs.readFileSync(w.sessions.wake.path(a.id), "utf8");
  const sessionBefore = w.sessions.read(a.id);

  await w.sweeper.sweep();
  w.advance(GRACE_MS + 1000);
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 0, "the server stopped");

  const after = w.sessions.read(a.id);
  assert.equal(after.closed_at, null, "the session is still open");
  assert.equal(after.handoff_rev, sessionBefore.handoff_rev, "no handoff happened");
  assert.equal(fs.readFileSync(w.sessions.wake.path(a.id), "utf8"), feedBefore, "nothing was written to the wake feed");
  assert.equal(fs.readFileSync(stateDirModule.monitorPath(w.dir, a.id), "utf8"), monitorBefore);
  assert.ok(w.sessions.openSessions().some((s) => s.id === a.id));
  assert.ok(w.reviews.get(a.review), "the review is still known");
});

test("closing the session relabels an idle stop, and a claim does not restart a closed session", async (t) => {
  const w = world(t);
  const a = await w.session("s_closed");
  await w.sweeper.sweep();
  w.advance(GRACE_MS + 1000);
  await w.sweeper.sweep();
  assert.equal(staticServers.list(w.dir, a.id)[0].stop_reason, staticServers.IDLE_REASON);

  await staticServers.stopAll(w.dir, a.id);
  w.sessions.close(a.id);
  assert.equal(staticServers.list(w.dir, a.id)[0].stop_reason, "session closed");

  w.reviews.claimWindow(a.review, { window_id: "late" });
  w.sweeper.windowActivity(a.review);
  await w.sweeper.settled();
  assert.equal(w.running(a.id).length, 0, "a closed session's server stays down");
});

test("an idle-stopped server still counts as serving its page, so nothing is written into it", async (t) => {
  const w = world(t);
  const a = await w.session("s_heal");
  await w.sweeper.sweep();
  w.advance(GRACE_MS + 1000);
  await w.sweeper.sweep();
  assert.equal(w.running(a.id).length, 0);
  assert.equal(staticServers.servesPath(w.dir, a.id, a.page), true);
  await staticServers.stopAll(w.dir, a.id);
  assert.equal(staticServers.servesPath(w.dir, a.id, a.page), false, "after a session close it no longer does");
});

test("lahe review restarts a stopped server on its old port, and the page loads", async (t) => {
  const state = path.join(tempDir("lahe-idle-cli-"), "state");
  const root = tempDir("lahe-idle-cli-root-");
  const page = path.join(root, "doc.html");
  fs.writeFileSync(page, "<!doctype html><title>Doc</title><p id=p>still here</p>");
  const helperPort = await freePort();
  const env = Object.assign({}, process.env, { LAHE_STATE_DIR: state });
  delete env.XDG_STATE_HOME;
  const run = (args) => execFileSync(process.execPath, [BIN].concat(args), { env: env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  const first = run(["review", page, "--port", String(helperPort)]);
  const session = /^\s*session\s+(\S+)/m.exec(first)[1];
  t.after(() => {
    try { run(["session", "close", session, "--port", String(helperPort)]); } catch (err) { /* best effort */ }
  });
  const open = /^\s*open\s+(\S+)/m.exec(first)[1];
  const port = Number(new URL(open).port);
  const meta = staticServers.list(state, session)[0];
  assert.ok(meta.link_given_at, "lahe review stamped the link it handed out");

  // The helper's sweep, as it does it: stopped for idleness.
  assert.equal(await staticServers.stopOne(state, session, meta, staticServers.IDLE_REASON), true);
  assert.equal((await get(port, "/doc.html")).status, 0, "the old link is refused");

  const again = run(["review", page, "--session", session, "--port", String(helperPort)]);
  const reopened = /^\s*open\s+(\S+)/m.exec(again)[1];
  assert.match(again, /started for this agent session/);
  assert.equal(reopened, open, "the same link as before, because the old port was free");
  const loaded = await get(port, "/doc.html");
  assert.equal(loaded.status, 200);
  assert.match(loaded.body, /still here/);
  assert.match(loaded.body, /lahe-layer\.js/, "the page carries the rail again");
});

test("lahe status says the server is stopped and names the command that restarts it", async (t) => {
  const w = world(t);
  const a = await w.session("s_status");
  await w.sweeper.sweep();
  w.advance(GRACE_MS + 1000);
  await w.sweeper.sweep();

  const out = [];
  const code = await status.run(["--session", a.id], {
    stateDir: w.dir,
    stdout: (text) => out.push(text),
    stderr: () => {}
  });
  assert.equal(code, 0);
  const text = out.join("");
  assert.match(text, /server\s+stopped/);
  assert.ok(text.indexOf("lahe review " + a.page + " --session " + a.id) !== -1, text);

  const json = [];
  await status.run(["--session", a.id, "--json"], { stateDir: w.dir, stdout: (s) => json.push(s), stderr: () => {} });
  const summary = JSON.parse(json.join("").trim().split("\n").pop());
  assert.equal(summary.stopped_servers.length, 1);
  assert.equal(summary.stopped_servers[0].review, a.review);
  assert.equal(
    summary.stopped_servers[0].restart,
    "lahe review " + a.page + " --session " + a.id + " --state-dir " + stateDirModule.flagFor(w.dir),
    "the state directory rides along, since this one is not the default"
  );
});
