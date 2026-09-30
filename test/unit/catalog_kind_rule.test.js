"use strict";

// What makes a row `dev-server` (Library fix round, CL minor).
//
// It used to be "no recorded static server covers it". So a static review whose
// ss_*.json record was lost read as dev-server, and the skill tells an agent to
// refuse a dev-server pickup: the document was stranded. Now dev-server needs a
// registered origin that no static server record serves, on a target LAHE
// would not serve itself (a project folder, not a page file). A review with
// neither a record nor such an origin is `static` and marked unreadable: its
// record is gone, and a takeover still works. The drain and describeReview carry
// the dev server's origin, so the refusal can name it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const catalogReader = require("../../src/service/catalog_reader.js");
const fixture = require("../fixtures/catalog_state.js");

function reader(installed) {
  return catalogReader.createReader({ dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false });
}

function rowOf(list, id) {
  for (const s of list.sessions) for (const r of s.reviews) {
    if (r.id === id) return r;
    for (const p of r.parts || []) if (p.id === id) return r;
  }
  return null;
}

test("a dev-server review keeps its kind, and describeReview names its origin", () => {
  const installed = fixture.install();
  const d = reader(installed).describeReview("r_dev", installed.nowMs);
  assert.equal(d.kind, "dev-server");
  assert.equal(d.origin, "http://localhost:3000");
});

test("a static review whose server record was lost is static and unreadable, not dev-server", async () => {
  const installed = fixture.install();
  const record = path.join(installed.dir, "agent-sessions", "s_coach", "static-servers", "ss_alphadocs.json");
  fs.renameSync(record, record + ".lost");
  const r = reader(installed);
  const d = r.describeReview("r_brief", installed.nowMs);
  assert.equal(d.kind, "static");
  assert.equal(d.origin, null);
  assert.equal(d.openable, "via-agent", "no server to restart: an agent re-serves it");
  const row = rowOf(await r.list(installed.nowMs), "r_brief");
  assert.equal(row.kind, "static");
  assert.equal(row.unreadable, true);
});

test("a static review keeps origin null", () => {
  const installed = fixture.install();
  const d = reader(installed).describeReview("r_brief", installed.nowMs);
  assert.equal(d.kind, "static");
  assert.equal(d.origin, null);
});

test("the drain carries a dev-server row's origin, so the refusal can name it", async () => {
  const os = require("node:os");
  const protocol = require("../../src/shared/protocol.js");
  const agentSessions = require("../../src/service/agent_sessions.js");
  const logModule = require("../../src/service/log.js");
  const reviewsModule = require("../../src/service/reviews.js");
  const catalogRequests = require("../../src/service/catalog_requests.js");
  const status = require("../../src/cli/commands/status.js");
  const T0 = Date.parse("2026-09-28T16:00:00.000Z");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-kind-rule-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-kind-project-"));
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_attached" });
  store.create({ id: "s_doc" });
  reviewsModule.createReviews({ dir, log: logModule.createEventLog({ dir }) })
    .create({ id: "r_app", agent_session_id: "s_doc", target_path: project, origins: ["http://localhost:5173"] });
  catalogRequests.writeAttach(dir, "s_attached", T0);
  const rev = agentSessions.handoffRev(store.read("s_attached"));
  store.writeMonitor("s_attached", { pid: process.pid, handoff_rev: rev, at: new Date(T0).toISOString() });
  catalogRequests.createQueue({ dir }).append({ action: "pickup", review: "r_app", session: "s_doc", for: "s_attached" }, T0);
  const stdout = [];
  await status.run(["--session", "s_attached", "--json", "--quiet", "--state-dir", dir], {
    stdout: (t) => stdout.push(t), stderr: () => {}, now: T0 + 1000
  });
  const lines = stdout.join("").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  const entry = lines[lines.length - 1].catalog_requests[0];
  assert.equal(entry.kind, "dev-server");
  assert.equal(entry.origin, "http://localhost:5173");
  assert.equal(protocol.isSafeId(entry.review), true);
});

test("every copy of the pickup steps names the origin in a dev-server refusal", () => {
  const rf = require("../../src/shared/review_format.js");
  const root = path.join(__dirname, "..", "..");
  const copies = {
    contract: rf.CONTRACT.join("\n"),
    skill: fs.readFileSync(path.join(root, "skills", "lahe", "SKILL.md"), "utf8"),
    contracts_md: fs.readFileSync(path.join(root, "docs", "CONTRACTS.md"), "utf8")
  };
  for (const [name, text] of Object.entries(copies)) {
    assert.match(text, /Start the dev server at <origin>, then ask me again/, name);
  }
});
