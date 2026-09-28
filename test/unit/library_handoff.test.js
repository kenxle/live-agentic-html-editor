"use strict";

// The Library's own hand-off message (story walk, Library fix round).
//
// The rail's message says the earlier agent "stopped answering my comments",
// which is wrong for a Library hand-over: the session may be closed, or the
// reviewer may simply want a new agent on it. It also said "add --state-dir
// ... ask me" without the folder, though the helper knows it. The Library gets
// its own wording (taking a session over, no blame) with the real --state-dir
// when it is not the default. The rail keeps its message for its own case.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const stateDir = require("../../src/service/state_dir.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const actionsModule = require("../../src/service/catalog_actions.js");
const status = require("../../src/cli/commands/status.js");
const vm = require("../../src/layer/catalog/view_model.js");

const LIST = require(path.join(__dirname, "..", "fixtures", "catalog_list.json"));
const T0 = Date.parse("2026-09-28T16:00:00.000Z");
const libraryHandoff = protocol.AGENT_LIVENESS.libraryHandoffMessage;

test("the Library's message takes a session over with the real --state-dir, and blames nobody", () => {
  const custom = "/Users/me/lahe state";
  const message = libraryHandoff("s_doc", null, custom);
  assert.ok(message.includes(protocol.takeoverCommand("s_doc", custom)), message);
  assert.ok(message.includes("--state-dir '/Users/me/lahe state'"), message);
  assert.equal(/stopped answering/.test(message), false, "no blame: the session may be closed, or a new agent wanted");
  assert.equal(/ask me/i.test(message), false, "the folder is given, not asked for");
  assert.match(message, /take over/i);
});

test("with the default state dir the command has no --state-dir, and a human name is quoted", () => {
  const message = libraryHandoff("s_doc", "coach activity", null);
  assert.ok(message.includes("    lahe session takeover s_doc\n"), message);
  assert.equal(message.includes("--state-dir"), false);
  assert.ok(message.includes('"coach activity"'));
});

test("with no session to take, it points at the session list in the right state dir", () => {
  const message = libraryHandoff(null, null, "/srv/lahe");
  assert.ok(message.includes("lahe session list --state-dir /srv/lahe"), message);
  assert.ok(message.includes("lahe session takeover <session-id> --state-dir /srv/lahe"), message);
});

test("the rail keeps its own message for its own case", () => {
  assert.match(protocol.AGENT_LIVENESS.handoffMessage("s_doc", null, false), /stopped answering my comments/);
});

test("the drain's handoff is the Library's message, with the drained state dir", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-library-handoff-"));
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_attached" });
  store.create({ id: "s_doc" });
  reviewsModule.createReviews({ dir, log: logModule.createEventLog({ dir }) }).create({ id: "r_doc", agent_session_id: "s_doc" });
  catalogRequests.writeAttach(dir, "s_attached", T0);
  const rev = agentSessions.handoffRev(store.read("s_attached"));
  store.writeMonitor("s_attached", { pid: process.pid, handoff_rev: rev, at: new Date(T0).toISOString() });
  catalogRequests.createQueue({ dir }).append({ action: "launch", review: "r_doc", session: "s_doc", for: "s_attached" }, T0);
  const stdout = [];
  await status.run(["--session", "s_attached", "--json", "--quiet", "--state-dir", dir], {
    stdout: (t) => stdout.push(t), stderr: () => {}, now: T0 + 1000
  });
  const lines = stdout.join("").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  const entry = lines[lines.length - 1].catalog_requests[0];
  assert.equal(entry.handoff, libraryHandoff("s_doc", null, stateDir.flagFor(dir)));
  assert.ok(entry.handoff.includes(stateDir.flagFor(dir)), "the real folder is in the command");
});

test("catalog.list carries the state dir only when it is not the default, and the panel uses it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-library-handoff-"));
  const actions = actionsModule.createCatalogActions({
    dir,
    reader: { list: async () => JSON.parse(JSON.stringify(LIST)) },
    queue: {}, store: {}, ops: {}, sessions: {}, log: () => {}
  });
  const listed = (await actions.list(T0)).body;
  assert.equal(listed.state_dir, stateDir.flagFor(dir));
  listed.attached = null;
  const view = vm.build(listed, vm.withPanel(vm.withFetch(vm.initialState(), { ok: true }), "r_mounted", "no_agent"), T0, {
    timeZone: "UTC"
  });
  let panel = null;
  view.sections.forEach((s) => s.cards.forEach((c) => c.rows.forEach((r) => { if (r.id === "r_mounted") panel = r.panel; })));
  assert.equal(panel.message, libraryHandoff("s_coach", "coach activity", stateDir.flagFor(dir)));
});
