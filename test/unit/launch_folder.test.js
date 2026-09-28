"use strict";

// Launch starts the new agent in the document's project folder (Library fix
// round, CR minor). It used to open in the home folder. The drain entry names
// the folder (`folder`, page-derived like `path`, so data), and the Launch
// steps pass it to Terminal through a file the agent writes and AppleScript's
// `quoted form of`, never through a shell string the agent types.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const rf = require("../../src/shared/review_format.js");
const stateDir = require("../../src/service/state_dir.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const status = require("../../src/cli/commands/status.js");

const T0 = Date.parse("2026-09-28T16:00:00.000Z");

function tempDir() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-launch-folder-")));
}

async function entryFor(doc) {
  const dir = tempDir();
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_attached" });
  store.create({ id: "s_doc" });
  reviewsModule.createReviews({ dir, log: logModule.createEventLog({ dir }) })
    .create({ id: "r_doc", agent_session_id: "s_doc", target_path: doc });
  const reviewJson = stateDir.reviewJsonPath(dir, "r_doc");
  fs.writeFileSync(reviewJson, JSON.stringify({ review: {}, pages: [{ title: "Doc", path: "/" + path.basename(doc), items: [] }] }));
  catalogRequests.writeAttach(dir, "s_attached", T0);
  const rev = agentSessions.handoffRev(store.read("s_attached"));
  store.writeMonitor("s_attached", { pid: process.pid, handoff_rev: rev, at: new Date(T0).toISOString() });
  catalogRequests.createQueue({ dir }).append({ action: "launch", review: "r_doc", session: "s_doc", for: "s_attached" }, T0);
  const stdout = [];
  await status.run(["--session", "s_attached", "--json", "--quiet", "--state-dir", dir], {
    stdout: (t) => stdout.push(t), stderr: () => {}, now: T0 + 1000
  });
  const lines = stdout.join("").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  return { entry: lines[lines.length - 1].catalog_requests[0], classes: lines[0].field_classes };
}

test("the drain names the document's project folder: the repository that holds it", async () => {
  const repo = tempDir();
  fs.mkdirSync(path.join(repo, ".git"));
  fs.mkdirSync(path.join(repo, "docs", "specs"), { recursive: true });
  const doc = path.join(repo, "docs", "specs", "brief.html");
  fs.writeFileSync(doc, "<p>brief</p>");
  const { entry, classes } = await entryFor(doc);
  assert.equal(entry.folder, repo);
  assert.equal(classes["catalog_requests[].folder"], record.CLASS_DATA, "a path is page text: data");
});

test("with no repository around it, the folder is the document's own", async () => {
  const loose = tempDir();
  const doc = path.join(loose, "notes.html");
  fs.writeFileSync(doc, "<p>notes</p>");
  const { entry } = await entryFor(doc);
  assert.equal(entry.folder, loose);
});

test("every copy of the Launch steps cds into the folder, read from a file, quoted by AppleScript", () => {
  const root = path.join(__dirname, "..", "..");
  const copies = {
    contract: rf.CONTRACT.join("\n"),
    skill: fs.readFileSync(path.join(root, "skills", "lahe", "SKILL.md"), "utf8"),
    contracts_md: fs.readFileSync(path.join(root, "docs", "CONTRACTS.md"), "utf8").replace(/\\"/g, '"')
  };
  for (const [name, text] of Object.entries(copies)) {
    const flat = text.replace(/\\"/g, '"');
    assert.ok(flat.includes("set dir to paragraph 1 of (read (POSIX file (item 3 of argv)) as «class utf8»)"), name);
    assert.ok(flat.includes('do script "cd " & (quoted form of dir) & " && " & (quoted form of (item 1 of argv))'), name);
  }
  assert.equal(protocol.isSafeId("s_doc"), true);
});
