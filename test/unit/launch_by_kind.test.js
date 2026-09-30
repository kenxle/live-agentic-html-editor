"use strict";

// Launch follows the row's kind (final adversarial review, finding 2).
//
// A launched agent's first prompt is the Library's hand-off message: take the
// document's session over. A legacy review has no session, so that message
// told the new agent to go find one in `lahe session list` and take it over:
// a session nobody pointed at. A worktree row's session serves a folder that
// is gone. So Launch is refused on legacy and worktree rows, on the page and
// in the API, with a reason; the drain carries no hand-off for them; and the
// page offers no hand-off message to copy for them.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const catalogReader = require("../../src/service/catalog_reader.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const catalogStore = require("../../src/service/catalog_store.js");
const actionsModule = require("../../src/service/catalog_actions.js");
const status = require("../../src/cli/commands/status.js");
const vm = require("../../src/layer/catalog/view_model.js");
const fixture = require("../fixtures/catalog_state.js");

const LIST = require(path.join(__dirname, "..", "fixtures", "catalog_list.json"));
const NO_TAKEOVER = ["r_legacy", "r_wt_gone"];

function rowsOf(view) {
  const rows = [];
  (view.sections || []).forEach((s) => (s.cards || []).forEach((c) => (c.rows || []).forEach((r) => rows.push(r))));
  (view.missing && view.missing.rows ? view.missing.rows : []).forEach((r) => rows.push(r));
  return rows;
}

function viewRow(state, id, list) {
  const nowMs = Date.parse(fixture.NOW || "2026-09-28T16:00:00.000Z");
  const base = vm.withFetch(vm.initialState(), { ok: true });
  const view = vm.build(list || LIST, Object.assign(base, state ? state(base) : {}), nowMs, { timeZone: "UTC" });
  return rowsOf(view).filter((r) => r.id === id)[0] || null;
}

function mentionsSessionHunt(value) {
  const text = JSON.stringify(value);
  return /lahe session list/.test(text) || /takeover <session-id>/.test(text) || /session takeover legacy/.test(text);
}

test("the fixture has the rows this test is about, as the kinds it expects", () => {
  const kinds = {};
  LIST.sessions.forEach((s) => s.reviews.forEach((r) => { kinds[r.id] = r.kind; }));
  assert.equal(kinds.r_legacy, "legacy");
  assert.equal(kinds.r_wt_gone, "worktree");
  assert.equal(kinds.r_brief, "static");
});

for (const id of NO_TAKEOVER) {
  test("page: Launch is disabled on " + id + " with a reason, and Pick this up stays", () => {
    const row = viewRow(null, id);
    assert.ok(row, id + " is drawn");
    assert.equal(row.buttons.launch.enabled, false);
    assert.equal(typeof row.buttons.launch.reason, "string");
    assert.ok(row.buttons.launch.reason.length > 0);
    assert.equal(row.buttons.pickup.enabled, true);
  });

  test("page: " + id + " offers no hand-off message that hunts for a session, even with the panel open", () => {
    const list = JSON.parse(JSON.stringify(LIST));
    list.attached = null;
    const row = viewRow((s) => vm.withPanel(s, id, "no_agent"), id, list);
    assert.ok(row, id + " is drawn");
    assert.equal(row.offerHandoff, false);
    assert.equal(mentionsSessionHunt(row), false, JSON.stringify(row.panel));
    assert.equal(row.panel ? row.panel.message : null, null);
  });
}

test("page: a static row still offers Launch", () => {
  const row = viewRow(null, "r_brief");
  assert.equal(row.buttons.launch.enabled, true);
  assert.equal(row.buttons.launch.reason, null);
});

function actionsFor(installed) {
  const queue = catalogRequests.createQueue({ dir: installed.dir });
  const reader = catalogReader.createReader(Object.assign({
    dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false
  }, catalogReader.queueInputs(queue)));
  return {
    queue,
    actions: actionsModule.createCatalogActions({
      dir: installed.dir,
      reader,
      queue: { readAttached: () => ({ session: "s_library", name: "library agent", watching: true }), append: queue.append.bind(queue) },
      store: catalogStore.createCatalogStore({ dir: installed.dir }),
      ops: {},
      sessions: agentSessions.createStore({ dir: installed.dir }),
      log: () => {}
    })
  };
}

for (const id of NO_TAKEOVER) {
  test("API: catalog.request refuses a launch on " + id + " and queues nothing", async () => {
    const installed = fixture.install();
    const { actions } = actionsFor(installed);
    const res = await actions.request({ review: id, action: "launch", confirmed: true }, installed.nowMs);
    assert.equal(res.status, 409, JSON.stringify(res));
    assert.equal(res.error.code, "PROTO_NO_LAUNCH");
    const file = require("../../src/service/state_dir.js").catalogRequestsPath(installed.dir);
    const lines = fs.existsSync(file) ? fs.readFileSync(file, "utf8").split("\n").filter(Boolean) : [];
    assert.equal(lines.some((l) => JSON.parse(l).review === id), false, "nothing queued");
  });
}

test("PROTO_NO_LAUNCH is a known failure with a remedy the page can show", () => {
  const failures = require("../../src/shared/failures.js");
  const all = failures.FAILURES || failures.CODES || failures;
  const def = all.PROTO_NO_LAUNCH || (typeof failures.lookup === "function" ? failures.lookup("PROTO_NO_LAUNCH") : null);
  assert.ok(def, "defined");
  assert.equal(protocol.statusFor("PROTO_NO_LAUNCH"), 409);
});

test("drain: a launch already queued on the legacy or worktree row carries no hand-off", async () => {
  const installed = fixture.install();
  const store = agentSessions.createStore({ dir: installed.dir });
  store.create({ id: "s_library" });
  const now = Date.now();
  catalogRequests.writeAttach(installed.dir, "s_library", now);
  store.touchActivity("s_library");
  const rev = agentSessions.handoffRev(store.read("s_library"));
  store.writeMonitor("s_library", { pid: process.pid, handoff_rev: rev, at: new Date(now).toISOString() });
  const queue = catalogRequests.createQueue({ dir: installed.dir });
  assert.ok(queue.append({ action: "launch", review: "r_legacy", session: "legacy", for: "s_library" }, now).ok);
  assert.ok(queue.append({ action: "launch", review: "r_wt_gone", session: "s_ops", for: "s_library" }, now).ok);
  const stdout = [];
  await status.run(["--session", "s_library", "--json", "--quiet", "--state-dir", installed.dir], {
    stdout: (t) => stdout.push(t), stderr: () => {}, now: now + 1000
  });
  const lines = stdout.join("").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  const entries = lines[lines.length - 1].catalog_requests;
  assert.equal(entries.length, 2);
  for (const entry of entries) {
    assert.equal(entry.handoff, null, entry.review + ": " + entry.handoff);
    assert.equal(mentionsSessionHunt(entry), false);
  }
});

test("every copy of the agent instructions says a launch on a legacy or worktree row is refused", () => {
  const rf = require("../../src/shared/review_format.js");
  const root = path.join(__dirname, "..", "..");
  const copies = {
    contract: rf.CONTRACT.join("\n"),
    skill: fs.readFileSync(path.join(root, "skills", "lahe", "SKILL.md"), "utf8"),
    contracts_md: fs.readFileSync(path.join(root, "docs", "CONTRACTS.md"), "utf8")
  };
  for (const [name, text] of Object.entries(copies)) {
    assert.match(text, /A launch request is only for a static row/, name);
  }
});
