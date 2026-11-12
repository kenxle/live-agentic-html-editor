// read-when: Changing where the Library's hand-off message reaches a person (the drain's handoff, the catalog.list state dir and the Library's panel), or when its tests fail.

"use strict";

// The Library's hand-off message, where it reaches a person. The message itself
// is built by `handoffMessage` in src/contract/agent-liveness.ts and tested in
// test/unit/contract/agent-liveness.test.ts; this file checks that the drain
// and the Library's panel hand it the real state dir.

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
const libraryHandoff = (sessionId, name, dir) =>
  protocol.handoffMessage({ from: "library", sessionId: sessionId, name: name, stateDir: dir, request: null });

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
  // The command names the request, which lets it through while s_doc's agent listens.
  assert.equal(
    entry.handoff,
    protocol.handoffMessage({ from: "library", sessionId: "s_doc", name: null, stateDir: stateDir.flagFor(dir), request: entry.request })
  );
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
