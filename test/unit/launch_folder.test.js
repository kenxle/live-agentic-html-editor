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
  // The folder comes from the helper's server record, never from meta.json's
  // paths, which a page can rewrite with its review token.
  const staticServers = require("../../src/service/static_servers.js");
  const record = stateDir.staticServerPath(dir, "s_doc", "ss_doc");
  fs.mkdirSync(path.dirname(record), { recursive: true });
  fs.writeFileSync(record, JSON.stringify({
    schema: staticServers.SCHEMA, id: "ss_doc", session_id: "s_doc", instance: "inst_ss_doc",
    root: path.dirname(doc), logical_root: path.dirname(doc), host: "127.0.0.1", port: 54997, pid: 999999,
    started_at: new Date(T0 - 60000).toISOString(), stopped_at: new Date(T0 - 30000).toISOString(), mounts: {}
  }) + "\n");
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

// Adversary fixes, finding 5: the walk up to a .git stops at the home folder,
// so a dotfiles repository in ~ never becomes the folder a new agent starts in.
test("a dotfiles repository in the home folder is never the launch folder", async (t) => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, ".git"));
  const notes = path.join(home, "notes");
  fs.mkdirSync(notes);
  const doc = path.join(notes, "plan.html");
  fs.writeFileSync(doc, "<p>plan</p>");
  const saved = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = saved; });
  assert.equal(os.homedir(), home, "the test controls the home folder");
  const { entry } = await entryFor(doc);
  assert.equal(entry.folder, notes);
});

test("a repository below the home folder is still found", async (t) => {
  const home = tempDir();
  fs.mkdirSync(path.join(home, ".git"));
  const repo = path.join(home, "code", "proj");
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  fs.mkdirSync(path.join(repo, "docs"));
  const doc = path.join(repo, "docs", "brief.html");
  fs.writeFileSync(doc, "<p>brief</p>");
  const saved = process.env.HOME;
  process.env.HOME = home;
  t.after(() => { process.env.HOME = saved; });
  const { entry } = await entryFor(doc);
  assert.equal(entry.folder, repo);
});

// Adversary fixes, round 2: a null folder skips the cd, and the answer says so.
test("every copy of the Launch steps says what to do when folder is null: no cd, and say so in the answer", () => {
  const root = path.join(__dirname, "..", "..");
  const copies = {
    contract: rf.CONTRACT.join("\n"),
    skill: fs.readFileSync(path.join(root, "skills", "lahe", "SKILL.md"), "utf8"),
    contracts_md: fs.readFileSync(path.join(root, "docs", "CONTRACTS.md"), "utf8")
  };
  for (const [name, text] of Object.entries(copies)) {
    const flat = text.replace(/\\"/g, '"').replace(/\s+/g, " ");
    assert.ok(flat.includes("When folder is null, skip the folder file and the cd"), name);
    assert.ok(flat.includes('do script (quoted form of (item 1 of argv)) & " " & (quoted form of msg)'), name);
    assert.ok(flat.includes("started in its default folder"), name);
  }
});
