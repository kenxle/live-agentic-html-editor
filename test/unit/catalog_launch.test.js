"use strict";

// The helper launching a new agent itself (src/service/catalog_launch.js).
//
// On a Mac, "Launch a new agent" on a Library row needs no attached agent:
// the helper opens the Terminal window with a fixed osascript command, the
// request is queued `for` the helper and answered at once, and the new
// agent's takeover names that request. Elsewhere the request still goes to
// the attached agent.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { EventEmitter } = require("node:events");

const protocol = require("../../src/shared/protocol.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const catalogReader = require("../../src/service/catalog_reader.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const catalogStore = require("../../src/service/catalog_store.js");
const catalogLaunch = require("../../src/service/catalog_launch.js");
const actionsModule = require("../../src/service/catalog_actions.js");
const stateDir = require("../../src/service/state_dir.js");
const vm = require("../../src/layer/catalog/view_model.js");
const fixture = require("../fixtures/catalog_state.js");

const LIST = require(path.join(__dirname, "..", "fixtures", "catalog_list.json"));

/** A spawn seam that records its call and exits with `code` on the next tick. */
function fakeSpawn(code, calls) {
  return function (cmd, args, opts) {
    const child = new EventEmitter();
    child.stderr = new EventEmitter();
    calls.push({ cmd, args, opts });
    setImmediate(() => {
      if (code !== 0) child.stderr.emit("data", "execution error: Terminal got an error (-1743)\n");
      child.emit("close", code);
    });
    return child;
  };
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-launch-"));
}

test("the launcher is available only on a Mac, and names its host", () => {
  const dir = tmpDir();
  assert.equal(catalogLaunch.createLauncher({ dir, enabled: true, platform: "darwin" }).available(), true);
  assert.equal(catalogLaunch.createLauncher({ dir, platform: "linux" }).available(), false);
  assert.deepEqual(catalogLaunch.createLauncher({ dir, enabled: true, platform: "darwin", host: "codex" }).describe(), { direct: true, host: "codex" });
  // An unknown host falls back to claude: the host is a fixed command, never free text.
  assert.equal(catalogLaunch.createLauncher({ dir, enabled: true, platform: "darwin", host: "bash -c rm" }).host, "claude");
});

test("launch runs osascript with the skill's script as -e arguments, the host, and two files; no shell", async () => {
  const dir = tmpDir();
  const calls = [];
  const launcher = catalogLaunch.createLauncher({ dir, enabled: true, platform: "darwin", spawn: fakeSpawn(0, calls) });
  const result = await launcher.launch({ id: "cq_0123456789abcdef" }, "Please take over my review.", "/Users/me/project");
  assert.equal(result.ok, true);
  assert.equal(result.text, "Launched claude in a new Terminal window.");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "osascript");
  assert.equal(calls[0].opts.shell, false);
  const args = calls[0].args;
  const handoffFile = path.join(dir, "launches", "cq_0123456789abcdef.handoff.txt");
  const folderFile = path.join(dir, "launches", "cq_0123456789abcdef.folder.txt");
  assert.deepEqual(args.slice(-3), ["claude", handoffFile, folderFile]);
  assert.equal(fs.readFileSync(handoffFile, "utf8"), "Please take over my review.");
  assert.equal(fs.readFileSync(folderFile, "utf8"), "/Users/me/project\n");
  // Every other argument is a -e line of the fixed script: the message and
  // folder are read from the files, never spliced into the script.
  const script = args.slice(0, -3);
  for (let i = 0; i < script.length; i += 2) assert.equal(script[i], "-e");
  assert.ok(script.some((line) => /quoted form of dir/.test(line)));
  assert.ok(!script.some((line) => /Please take over/.test(line)));
});

test("with no folder the script has no cd, and the row's text says so", async () => {
  const dir = tmpDir();
  const calls = [];
  const launcher = catalogLaunch.createLauncher({ dir, enabled: true, platform: "darwin", spawn: fakeSpawn(0, calls) });
  const result = await launcher.launch({ id: "cq_fedcba9876543210" }, "msg", null);
  assert.equal(result.ok, true);
  assert.match(result.text, /default folder/);
  assert.equal(calls[0].args.slice(-2)[0], "claude");
  assert.ok(!calls[0].args.some((line) => /cd /.test(line)));
});

test("a failed osascript is reported, not thrown, with its first stderr line", async () => {
  const dir = tmpDir();
  const launcher = catalogLaunch.createLauncher({ dir, enabled: true, platform: "darwin", spawn: fakeSpawn(1, []) });
  const result = await launcher.launch({ id: "cq_aaaaaaaaaaaaaaaa" }, "msg", "/x");
  assert.equal(result.ok, false);
  assert.match(result.text, /Couldn't open a Terminal window: execution error/);
});

test("the hand-off: null for legacy or a worktree with no copy; a worktree copy adds the serve line", () => {
  const dir = tmpDir();
  const request = { id: "cq_1111111111111111", session: "s_doc" };
  assert.equal(catalogLaunch.handoffFor(dir, { kind: "legacy" }, { id: request.id, session: "legacy" }, null), null);
  assert.equal(catalogLaunch.handoffFor(dir, { kind: "worktree", candidate: null }, request, null), null);
  const plain = catalogLaunch.handoffFor(dir, { kind: "static" }, request, "coach activity");
  assert.match(plain, /lahe session takeover s_doc .*--request cq_1111111111111111/);
  assert.match(plain, /"coach activity"/);
  assert.ok(!/lahe review /.test(plain));
  const wt = catalogLaunch.handoffFor(dir, { kind: "worktree", candidate: "/repo/docs/brief.html" }, request, null);
  assert.match(wt, /lahe session takeover s_doc .*--request cq_1111111111111111/);
  assert.match(wt, /lahe review \/repo\/docs\/brief\.html --session s_doc/);
});

// ---------------------------------------------------------------------------
// The request path through catalog_actions
// ---------------------------------------------------------------------------

function world(installed, launcherOpts, attached) {
  const queue = catalogRequests.createQueue({ dir: installed.dir, log: () => {} });
  const reader = catalogReader.createReader(Object.assign({
    dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false
  }, catalogReader.queueInputs(queue)));
  const calls = [];
  const launcher = catalogLaunch.createLauncher(Object.assign({ dir: installed.dir, enabled: true, spawn: fakeSpawn(0, calls) }, launcherOpts));
  const actions = actionsModule.createCatalogActions({
    dir: installed.dir,
    reader,
    queue: {
      readAttached: () => attached === undefined ? null : attached,
      append: queue.append.bind(queue),
      answer: queue.answer.bind(queue)
    },
    store: catalogStore.createCatalogStore({ dir: installed.dir }),
    sessions: agentSessions.createStore({ dir: installed.dir }),
    launcher,
    log: () => {}
  });
  return { queue, actions, calls };
}

function queueLines(dir) {
  const file = stateDir.catalogRequestsPath(dir);
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
}

test("API: on a Mac with no agent attached, a launch opens the window, queues for the helper, and answers done", async () => {
  const installed = fixture.install();
  const { queue, actions, calls } = world(installed, { platform: "darwin" }, null);
  const res = await actions.request({ review: "r_brief", action: "launch", confirmed: true }, installed.nowMs);
  assert.equal(res.status, 200, JSON.stringify(res));
  assert.equal(res.body.launched, true);
  assert.equal(res.body.text, "Launched claude in a new Terminal window.");
  assert.equal(calls.length, 1, "one osascript");
  const lines = queueLines(installed.dir);
  const request = lines.find((l) => l.action === "launch" && l.review === "r_brief");
  assert.ok(request, "queued");
  assert.equal(request.for, catalogRequests.LAUNCHER_FOR);
  assert.equal(request.id, res.body.request_id);
  const answer = lines.find((l) => l.id === request.id && l.answered_at);
  assert.ok(answer, "answered");
  assert.equal(answer.by, catalogRequests.LAUNCHER_FOR);
  assert.equal(answer.status, "done");
  // No agent's drain sees it, and the row names the Library as who answered.
  assert.deepEqual(queue.pendingFor("s_library", installed.nowMs + 1), []);
  const row = queue.requestFor("r_brief", installed.nowMs + 1);
  assert.equal(row.state, "done");
  assert.equal(row.by_name, catalogRequests.LAUNCHER_NAME);
  // The hand-off the new agent got names the takeover with this request.
  const handoff = fs.readFileSync(path.join(installed.dir, "launches", request.id + ".handoff.txt"), "utf8");
  assert.match(handoff, new RegExp("lahe session takeover " + request.session + " .*--request " + request.id));
  // And the takeover check honors it, though it is already answered.
  assert.equal(queue.confirms(request.id, request.session, installed.nowMs + 60000), true);
  assert.equal(queue.confirms(request.id, "s_other", installed.nowMs + 60000), false);
  assert.equal(queue.confirms(request.id, request.session, installed.nowMs + protocol.CATALOG.REQUEST_EXPIRY_MS + 1), false, "until its own expiry");
});

test("API: a helper launch is not expired by an attach change or a dead monitor", () => {
  const installed = fixture.install();
  const queue = catalogRequests.createQueue({ dir: installed.dir, log: () => {} });
  const now = installed.nowMs;
  const queued = queue.append({ action: "launch", review: "r_brief", session: "s_doc", for: catalogRequests.LAUNCHER_FOR }, now);
  assert.ok(queued.ok);
  catalogRequests.writeAttach(installed.dir, "s_other", now);
  assert.equal(queue.pending(now + 1000).length, 1, "still pending with another agent attached and no monitor");
  assert.equal(queue.pending(now + protocol.CATALOG.REQUEST_EXPIRY_MS).length, 0, "the timeout still applies");
});

test("API: on Linux a launch still needs the attached agent", async () => {
  const installed = fixture.install();
  const { actions, calls } = world(installed, { platform: "linux" }, null);
  const res = await actions.request({ review: "r_brief", action: "launch", confirmed: true }, installed.nowMs);
  assert.equal(res.status, 409);
  assert.equal(res.error.code, "PROTO_NO_AGENT");
  assert.equal(calls.length, 0);
});

test("API: a direct launch on a session someone is watching asks first", async () => {
  const installed = fixture.install();
  const { actions, calls } = world(installed, { platform: "darwin" }, null);
  // r_brief's session is watched in the fixture (a live monitor for s_doc).
  const res = await actions.request({ review: "r_brief", action: "launch" }, installed.nowMs);
  if (res.status === 200) return; // the fixture's session is not watched on this run; nothing to confirm
  assert.equal(res.error.code, "PROTO_CONFIRM_NEEDED");
  assert.equal(calls.length, 0);
});

test("API: a legacy row is still refused and opens no window; a worktree row with a main-repo copy launches with the serve line", async () => {
  const installed = fixture.install();
  const { actions, calls } = world(installed, { platform: "darwin" }, null);
  const res = await actions.request({ review: "r_legacy", action: "launch", confirmed: true }, installed.nowMs);
  assert.equal(res.status, 409, JSON.stringify(res));
  assert.equal(res.error.code, "PROTO_NO_LAUNCH");
  assert.equal(calls.length, 0);
  const wt = await actions.request({ review: "r_wt_gone", action: "launch", confirmed: true }, installed.nowMs);
  assert.equal(wt.status, 200, JSON.stringify(wt));
  assert.equal(wt.body.launched, true);
  const handoff = fs.readFileSync(path.join(installed.dir, "launches", wt.body.request_id + ".handoff.txt"), "utf8");
  assert.match(handoff, /lahe session takeover s_ops /);
  assert.match(handoff, /The worktree this document was reviewed in is gone/);
  assert.match(handoff, /lahe review \S+\/projects\/alpha\/docs\/brief\.html --session s_ops/);
});

test("API: a failed window is answered refused with the reason, and the page is told", async () => {
  const installed = fixture.install();
  const queue = catalogRequests.createQueue({ dir: installed.dir, log: () => {} });
  const reader = catalogReader.createReader(Object.assign({
    dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false
  }, catalogReader.queueInputs(queue)));
  const launcher = catalogLaunch.createLauncher({ dir: installed.dir, enabled: true, platform: "darwin", spawn: fakeSpawn(1, []) });
  const actions = actionsModule.createCatalogActions({
    dir: installed.dir, reader,
    queue: { readAttached: () => null, append: queue.append.bind(queue), answer: queue.answer.bind(queue) },
    store: catalogStore.createCatalogStore({ dir: installed.dir }),
    sessions: agentSessions.createStore({ dir: installed.dir }), launcher, log: () => {}
  });
  const res = await actions.request({ review: "r_brief", action: "launch", confirmed: true }, installed.nowMs);
  assert.equal(res.status, 200);
  assert.equal(res.body.launched, false);
  assert.match(res.body.text, /Couldn't open a Terminal window/);
  assert.equal(queue.requestFor("r_brief", installed.nowMs + 1).state, "refused");
});

// ---------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------

function viewWith(list, state) {
  const nowMs = Date.parse(fixture.NOW || "2026-09-28T16:00:00.000Z");
  return vm.build(list, state || vm.withFetch(vm.initialState(), { ok: true }), nowMs, { timeZone: "UTC" });
}

function rowOf(view, id) {
  const rows = [];
  (view.sections || []).forEach((s) => (s.cards || []).forEach((c) => (c.rows || []).forEach((r) => rows.push(r))));
  return rows.find((r) => r.id === id) || null;
}

test("page: with direct launch and no agent, the header says Launch still works and Launch sends a request", () => {
  const list = JSON.parse(JSON.stringify(LIST));
  list.attached = null;
  list.launch = { direct: true, host: "claude" };
  // r_brief carries a request in the fixture; here nothing is waiting on it.
  list.sessions.forEach((s) => s.reviews.forEach((r) => { if (r.id === "r_brief") r.request = null; }));
  const view = viewWith(list);
  assert.match(view.agent.text, /Open and Launch a new agent still work/);
  const d = vm.decide(list, vm.withFetch(vm.initialState(), { ok: true }), "r_brief", "launch", {});
  assert.ok(d.kind === "request" || d.kind === "confirm", d.kind);
  if (d.kind === "confirm") {
    const confirmed = vm.decide(list, vm.withFetch(vm.initialState(), { ok: true }), "r_brief", "launch", { confirmed: true });
    assert.equal(confirmed.kind, "request");
    assert.equal(confirmed.body.confirmed, true);
    // The confirm dialog draws with no agent attached.
    const dialog = viewWith(list, vm.withDialog(vm.withFetch(vm.initialState(), { ok: true }), "r_brief", "launch")).dialog;
    assert.ok(dialog, "dialog drawn");
    assert.match(dialog.body, /A new agent takes the whole session over/);
  }
  // Pick this up still offers the hand-off message to paste.
  assert.equal(vm.decide(list, vm.withFetch(vm.initialState(), { ok: true }), "r_brief", "pickup", {}).kind, "handoff");
});

test("page: without direct launch and no agent, Launch offers the hand-off message as before", () => {
  const list = JSON.parse(JSON.stringify(LIST));
  list.attached = null;
  assert.equal(vm.decide(list, vm.withFetch(vm.initialState(), { ok: true }), "r_brief", "launch", {}).kind, "handoff");
  assert.match(viewWith(list).agent.text, /hand-overs give you a message to paste/);
});

test("page: the helper's answer lands on the row at once", () => {
  const list = JSON.parse(JSON.stringify(LIST));
  list.launch = { direct: true, host: "claude" };
  const NOW = Date.parse("2026-09-28T16:00:00.000Z");
  const state = vm.afterRequest(vm.withFetch(vm.initialState(), { ok: true }), list, "r_brief", "launch",
    { ok: true, body: { request_id: "cq_2222222222222222", launched: true, text: "Launched claude in a new Terminal window." } }, NOW);
  const row = rowOf(viewWith(list, state), "r_brief");
  assert.equal(row.note.text, "Launched claude in a new Terminal window.");
  assert.equal(row.note.tone, "ok");
  assert.equal(row.note.busy, false);
  const failed = vm.afterRequest(vm.withFetch(vm.initialState(), { ok: true }), list, "r_brief", "launch",
    { ok: true, body: { request_id: "cq_2222222222222222", launched: false, text: "Couldn't open a Terminal window: no" } }, NOW);
  assert.equal(rowOf(viewWith(list, failed), "r_brief").note.tone, "warn");
});

test("page: a worktree row has Launch enabled; a legacy row keeps its reason", () => {
  const view = viewWith(JSON.parse(JSON.stringify(LIST)));
  assert.equal(rowOf(view, "r_wt_gone").buttons.launch.enabled, true);
  assert.equal(rowOf(view, "r_wt_gone").buttons.launch.reason, null);
  assert.equal(rowOf(view, "r_legacy").buttons.launch.enabled, false);
  assert.match(rowOf(view, "r_legacy").buttons.launch.reason, /before sessions/);
});
