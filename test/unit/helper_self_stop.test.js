// The helper stops itself once nothing needs it (src/service/self_stop.js).
//
// WHY. The last `lahe session close` leaves the helper running when a review
// page is open or the Library polled in the last two minutes. Nothing used to
// stop it after that, so every test run that closed its session with a page
// still open left one helper behind for good: 1,892 of them on one Mac, about
// 12 GB resident. Two rules now:
//
//   1. A deferred final close leaves stop-when-quiet.json in the state dir.
//      The helper stops itself once there is no open session, no open review
//      window and no Library poll for the whole grace window (two minutes).
//      An open session disarms the ask.
//   2. A helper whose state directory is gone (or replaced) stops at once.
//
// The rules are tested with an injected clock and a short grace, never a real
// two-minute wait. The process tests start a real helper on a free port and a
// temp state dir, never 7817 and never the real state dir.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const service = require("../../src/service/index.js");
const stateDir = require("../../src/service/state_dir.js");
const selfStop = require("../../src/service/self_stop.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const sessionCommand = require("../../src/cli/commands/session.js");
const staticServers = require("../../src/service/static_servers.js");
const { pollUntil } = require("../helpers/poll.js");
const { onFreePort } = require("../helpers/free_port.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const GRACE = 1000;
// The helper's own pid and start time, as service.json would name it.
const OWNER = { pid: process.pid, started_at: "2026-10-07T12:00:00.000Z" };

function tempState() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-self-stop-")));
  const dir = path.join(root, "state");
  fs.mkdirSync(dir, { recursive: true });
  return { root, dir };
}

/** A self-stop over fakes, with a clock the test moves by hand. */
function rig(options) {
  const opts = options || {};
  const w = opts.state || tempState();
  const state = {
    at: 1000000,
    sessions: opts.sessions || [],
    windows: [],
    seenAt: null,
    stops: []
  };
  const instance = selfStop.createSelfStop({
    dir: w.dir,
    agentSessions: { openSessions: () => state.sessions },
    reviews: { openWindowReviews: () => state.windows },
    catalog: { seenAt: () => (state.seenAt === null ? null : new Date(state.seenAt).toISOString()) },
    now: () => state.at,
    graceMs: GRACE,
    sweepMs: GRACE,
    owner: OWNER,
    onStop: (reason) => state.stops.push(reason)
  });
  return Object.assign(w, { state, instance });
}

function ask(dir, atMs) {
  fs.writeFileSync(stateDir.stopWhenQuietPath(dir), JSON.stringify({ asked_at: new Date(atMs).toISOString() }));
}

test("without a stop-when-quiet ask, a quiet helper keeps running", () => {
  const r = rig();
  r.state.at += 100 * GRACE;
  r.instance.check();
  assert.deepEqual(r.state.stops, []);
});

test("after a deferred close, the helper stops once quiet for the whole grace, not before", () => {
  const r = rig();
  ask(r.dir, r.state.at);
  r.state.at += GRACE - 1;
  r.instance.check();
  assert.deepEqual(r.state.stops, [], "1 ms short of the grace");
  r.state.at += 1;
  r.instance.check();
  assert.deepEqual(r.state.stops, [selfStop.REASON.QUIET]);
  assert.equal(fs.existsSync(stateDir.stopWhenQuietPath(r.dir)), false, "the ask is used up");
  r.state.at += GRACE;
  r.instance.check();
  assert.equal(r.state.stops.length, 1, "it stops once");
});

test("an open review window holds the helper, and the grace counts from when it was last seen", () => {
  const r = rig();
  ask(r.dir, r.state.at);
  r.state.windows = ["r_open"];
  r.state.at += 10 * GRACE;
  r.instance.check();
  assert.deepEqual(r.state.stops, [], "a window is open");
  const lastSeen = r.state.at;
  r.state.windows = [];
  r.state.at = lastSeen + GRACE - 1;
  r.instance.check();
  assert.deepEqual(r.state.stops, [], "the window closed less than the grace ago");
  r.state.at = lastSeen + GRACE;
  r.instance.check();
  assert.deepEqual(r.state.stops, [selfStop.REASON.QUIET]);
});

test("a recent Library poll holds the helper until the grace runs out after it", () => {
  const r = rig();
  ask(r.dir, r.state.at);
  r.state.at += 5 * GRACE;
  r.state.seenAt = r.state.at - 10;
  r.instance.check();
  assert.deepEqual(r.state.stops, []);
  r.state.at = r.state.seenAt + GRACE;
  r.instance.check();
  assert.deepEqual(r.state.stops, [selfStop.REASON.QUIET]);
});

test("an open session never lets the helper stop, and it takes the ask back", () => {
  const r = rig({ sessions: [{ id: "s_open" }] });
  ask(r.dir, r.state.at);
  r.state.at += 100 * GRACE;
  r.instance.check();
  assert.deepEqual(r.state.stops, []);
  assert.equal(fs.existsSync(stateDir.stopWhenQuietPath(r.dir)), false, "an open session disarms the ask");
  r.state.sessions = [];
  r.state.at += 100 * GRACE;
  r.instance.check();
  assert.deepEqual(r.state.stops, [], "with the ask gone, the next close decides again");
});

test("a helper whose state directory was removed stops on the second check that misses it, even with a session open", () => {
  const r = rig({ sessions: [{ id: "s_open" }] });
  r.instance.check();
  assert.deepEqual(r.state.stops, []);
  fs.rmSync(r.root, { recursive: true, force: true });
  r.instance.check();
  assert.deepEqual(r.state.stops, [], "one miss is not enough");
  r.instance.check();
  assert.deepEqual(r.state.stops, [selfStop.REASON.STATE_DIR_GONE]);
});

test("one missing check followed by the token back is not a gone state dir", () => {
  const r = rig();
  const file = stateDir.stateIdPath(r.dir);
  const token = fs.readFileSync(file, "utf8");
  fs.renameSync(file, file + ".aside");
  r.instance.check();
  fs.renameSync(file + ".aside", file);
  r.instance.check();
  assert.equal(fs.readFileSync(file, "utf8"), token);
  fs.renameSync(file, file + ".aside");
  r.instance.check();
  assert.deepEqual(r.state.stops, [], "the misses were not in a row");
});

test("a state directory removed and made again is not the helper's any more", () => {
  const r = rig();
  fs.rmSync(r.dir, { recursive: true, force: true });
  fs.mkdirSync(r.dir, { recursive: true });
  r.instance.check();
  r.instance.check();
  assert.deepEqual(r.state.stops, [selfStop.REASON.STATE_DIR_GONE]);
});

// Linux can give a directory made again the very inode the removed one had, so
// the check cannot lean on the filesystem's idea of identity. These two keep
// the same directory (same inode, same device on every platform) and change
// only what is in it, which is what a reused inode looks like from inside.
test("the same directory emptied out is a replaced state dir, whatever its inode", () => {
  const r = rig();
  const before = fs.statSync(r.dir).ino;
  for (const name of fs.readdirSync(r.dir)) fs.rmSync(path.join(r.dir, name), { recursive: true, force: true });
  assert.equal(fs.statSync(r.dir).ino, before, "the directory itself never changed");
  r.instance.check();
  r.instance.check();
  assert.deepEqual(r.state.stops, [selfStop.REASON.STATE_DIR_GONE]);
});

test("the same directory carrying another helper's token is a replaced state dir", () => {
  const r = rig();
  fs.writeFileSync(stateDir.stateIdPath(r.dir), "someone-else\n");
  r.instance.check();
  assert.deepEqual(r.state.stops, [selfStop.REASON.STATE_DIR_GONE]);
});

test("a replacement copy that still names this helper keeps it running; one that names another does not", () => {
  const r = rig();
  // A restored backup or a synced copy: another token, but service.json still
  // names this very process.
  fs.writeFileSync(stateDir.readyPath(r.dir), JSON.stringify({ pid: OWNER.pid, started_at: OWNER.started_at, port: 1 }));
  fs.writeFileSync(stateDir.stateIdPath(r.dir), "the-copy's-token\n");
  r.instance.check();
  r.instance.check();
  assert.deepEqual(r.state.stops, [], "the copy still names this helper");
  // A different helper's service.json and token: this one is not wanted there.
  fs.writeFileSync(stateDir.readyPath(r.dir), JSON.stringify({ pid: OWNER.pid, started_at: "2026-10-07T13:00:00.000Z", port: 1 }));
  fs.writeFileSync(stateDir.stateIdPath(r.dir), "a-third-token\n");
  r.instance.check();
  assert.deepEqual(r.state.stops, [selfStop.REASON.STATE_DIR_GONE]);
});

test("a stop request left by an earlier helper does not stop a new one", () => {
  const w = tempState();
  ask(w.dir, 0);
  const r = rig({ state: w });
  assert.equal(fs.existsSync(stateDir.stopWhenQuietPath(r.dir)), false, "the new helper cleared it");
  r.state.at += 100 * GRACE;
  r.instance.check();
  assert.deepEqual(r.state.stops, []);
});

test("a wake from sleep restarts the grace, so an open page gets its first heartbeat in", () => {
  const r = rig();
  ask(r.dir, r.state.at);
  r.state.windows = ["r_open"];
  r.instance.check();
  // The lid closes for 30 minutes. The page's holder goes stale meanwhile,
  // and its first heartbeat after the wake has not landed yet.
  r.state.windows = [];
  r.state.at += 30 * 60 * 1000;
  r.instance.check();
  assert.deepEqual(r.state.stops, [], "the first check after a wake never stops");
  r.state.at += GRACE;
  r.instance.check();
  assert.deepEqual(r.state.stops, [selfStop.REASON.QUIET], "quiet for a full grace after the wake");
});

test("a token file it briefly cannot read is not a gone state dir", { skip: process.platform === "win32" || process.getuid() === 0 }, (t) => {
  const r = rig();
  const file = stateDir.stateIdPath(r.dir);
  fs.chmodSync(file, 0o000);
  t.after(() => fs.chmodSync(file, 0o600));
  r.instance.check();
  r.instance.check();
  r.instance.check();
  assert.deepEqual(r.state.stops, [], "EACCES never counts, however many times");
  fs.chmodSync(file, 0o600);
  r.instance.check();
  assert.deepEqual(r.state.stops, [], "readable again and unchanged");
});

test("in process: serve() with a stop-when-quiet ask closes itself and reports why", async (t) => {
  const w = tempState();
  let reason = null;
  const { result: helper } = await onFreePort((port) => service.serve({
    port,
    stateDir: w.dir,
    quiet: true,
    selfStopGraceMs: 150,
    selfStopSweepMs: 25,
    onSelfStop: (why) => { reason = why; }
  }));
  t.after(() => helper.close());
  ask(w.dir, Date.now());
  await pollUntil(() => reason, { message: "the helper to stop itself", timeoutMs: 5000 });
  assert.equal(reason, selfStop.REASON.QUIET);
  assert.equal(await service.probeHealth(protocol.DEFAULT_HOST, helper.port), null, "the listener is closed");
});

/** One open session and a real helper process, started the way the CLI starts one. */
async function realHelper(t) {
  const w = tempState();
  const store = agentSessions.createStore({ dir: w.dir });
  store.create({ id: "s_last" });
  const saved = { grace: process.env.LAHE_SELF_STOP_GRACE_MS, sweep: process.env.LAHE_SELF_STOP_SWEEP_MS };
  process.env.LAHE_SELF_STOP_GRACE_MS = "300";
  process.env.LAHE_SELF_STOP_SWEEP_MS = "50";
  t.after(() => {
    if (saved.grace === undefined) delete process.env.LAHE_SELF_STOP_GRACE_MS;
    else process.env.LAHE_SELF_STOP_GRACE_MS = saved.grace;
    if (saved.sweep === undefined) delete process.env.LAHE_SELF_STOP_SWEEP_MS;
    else process.env.LAHE_SELF_STOP_SWEEP_MS = saved.sweep;
  });
  const { port } = await onFreePort((p) => sessionCommand.startHelper(w.dir, p));
  const pid = JSON.parse(fs.readFileSync(stateDir.readyPath(w.dir), "utf8")).pid;
  // Whatever the test proves, this helper does not outlive it.
  t.after(() => stopTempHelpers(w.dir));
  return Object.assign(w, { port, pid, store });
}

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code !== "ESRCH"; }
}

test("a real helper kept up by an open page stops itself once the page is gone", async (t) => {
  const w = await realHelper(t);
  // A page held a window a moment ago: the last close leaves the helper up.
  const nowMs = Date.now();
  fs.writeFileSync(stateDir.windowsPath(w.dir), JSON.stringify({
    version: 1,
    sessions: { r_held: { window_id: "w", session_secret: "s", since: new Date(nowMs).toISOString(), since_ms: nowMs - 1000, last_seen: nowMs - 1000 } }
  }));
  const out = [];
  const code = await sessionCommand.run(["close", "s_last", "--state-dir", w.dir], { stdout: (x) => out.push(x), stderr: (x) => out.push(x), now: nowMs });
  assert.equal(code, protocol.CLI_EXIT.OK, out.join(""));
  assert.match(out.join(""), /shared helper left running for an open review page/);
  assert.ok(fs.existsSync(stateDir.stopWhenQuietPath(w.dir)), "the close asked the helper to stop once quiet");
  // The helper never saw that window (it was written behind its back), so it
  // is quiet now and goes after the short grace.
  await pollUntil(() => !alive(w.pid), { message: "the helper process to exit", timeoutMs: 10000 });
  assert.equal(await service.probeHealth(protocol.DEFAULT_HOST, w.port), null);
});

test("a real helper exits when its state directory is removed", async (t) => {
  const w = await realHelper(t);
  assert.ok(alive(w.pid));
  fs.rmSync(w.root, { recursive: true, force: true });
  await pollUntil(() => !alive(w.pid), { message: "the helper process to exit", timeoutMs: 10000 });
});

test("a page server exits when its state directory is removed", async (t) => {
  const w = tempState();
  const saved = process.env.LAHE_SELF_STOP_SWEEP_MS;
  process.env.LAHE_SELF_STOP_SWEEP_MS = "50";
  t.after(() => {
    if (saved === undefined) delete process.env.LAHE_SELF_STOP_SWEEP_MS;
    else process.env.LAHE_SELF_STOP_SWEEP_MS = saved;
  });
  t.after(() => stopTempHelpers(w.dir));
  const site = path.join(w.root, "site");
  fs.mkdirSync(site);
  fs.writeFileSync(path.join(site, "index.html"), "<p>hi</p>");
  const started = await staticServers.start({ dir: w.dir, sessionId: "s_page", root: site });
  const pid = started.meta.pid;
  assert.ok(alive(pid));
  fs.rmSync(w.root, { recursive: true, force: true });
  await pollUntil(() => !alive(pid), { message: "the page server to exit", timeoutMs: 10000 });
});
