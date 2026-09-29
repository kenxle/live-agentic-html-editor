"use strict";

// `lahe library serve <request-id> --session <id>` (Library fix round, SEC2).
//
// A pickup of a legacy or worktree row used to tell the agent to run
// `lahe review '<path>'`, putting a page-derived path into a shell string: a
// quote in a file name broke out of it. This verb reads the path itself from
// the request's review, re-runs the candidate checks at serve time, and runs
// `lahe review` with the path as one argv entry. No shell sees it.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");

const protocol = require("../../src/shared/protocol.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const library = require("../../src/cli/commands/library.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix || "lahe-library-serve-")));
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

function lahe(args, cwd) {
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN].concat(args), { cwd, encoding: "utf8" }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

/** s_agent attached and working (a lahe command just now), and one pickup for it. */
function listen(dir, store, review, session) {
  catalogRequests.writeAttach(dir, "s_agent", Date.now());
  store.touchActivity("s_agent");
  const appended = catalogRequests.createQueue({ dir }).append({ action: "pickup", review, session, for: "s_agent" }, Date.now());
  assert.ok(appended.ok, JSON.stringify(appended));
  return appended.request;
}

/** State with s_agent (the Library's agent) and one legacy review of `doc`. */
function world(doc) {
  const dir = path.join(tempDir(), "state");
  fs.mkdirSync(dir);
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_agent" });
  store.create({ id: "s_other" });
  const log = logModule.createEventLog({ dir });
  reviewsModule.createReviews({ dir, log }).create({ id: "r_legacy", target_path: doc });
  const request = listen(dir, store, "r_legacy", "legacy");
  return { dir, store, request };
}

test("parse: serve needs a request id and --session", () => {
  assert.match(library.parse(["serve"]).error, /request id/);
  assert.match(library.parse(["serve", "cq_x"]).error, /--session/);
  const ok = library.parse(["serve", "cq_x", "--session", "s_agent"]);
  assert.equal(ok.error, null);
  assert.equal(ok.serve, true);
  assert.equal(ok.id, "cq_x");
});

test("a legacy row whose file name holds a quote and $(...) reaches lahe review as one argument, and no shell ever runs it", async (t) => {
  const docs = tempDir("lahe-serve-doc-");
  const doc = path.join(docs, "a'$(touch pwned)'.html");
  // A legacy document carries its review's script line: serve checks for it.
  fs.writeFileSync(doc, '<!doctype html><title>Quoted</title><p>body</p>\n<script src="http://127.0.0.1:7817/lahe-layer.js" data-lahe-review="r_legacy"></script>\n');
  const w = world(doc);
  const cwd = tempDir("lahe-serve-cwd-");
  const port = await freePort();
  t.after(() => lahe(["session", "close", "s_agent", "--state-dir", w.dir, "--port", String(port)], cwd));
  const out = await lahe(["library", "serve", w.request.id, "--session", "s_agent", "--state-dir", w.dir, "--port", String(port)], cwd);
  assert.equal(fs.existsSync(path.join(cwd, "pwned")), false, "nothing ran in the caller's folder");
  assert.equal(fs.existsSync(path.join(docs, "pwned")), false, "nothing ran beside the document");
  // lahe review read that exact file: it found the file's own script line.
  // It then refuses, because the carried review belongs to no session (see
  // the todo below); what this test proves is the argv path, not adoption.
  assert.match(out.stderr + out.stdout, /r_legacy/, out.stderr + out.stdout);
});

/** Every file under a review's state folder, with its bytes. */
function snapshot(dir, reviewId) {
  const root = path.join(dir, "reviews", reviewId);
  const out = {};
  for (const name of fs.readdirSync(root)) {
    const file = path.join(root, name);
    if (fs.statSync(file).isFile()) out[name] = fs.readFileSync(file, "utf8");
  }
  return out;
}

test("a legacy pickup adopts the review into the agent's session and serves it with its old comments", async (t) => {
  const docs = tempDir("lahe-serve-doc-");
  const doc = path.join(docs, "legacy.html");
  fs.writeFileSync(doc, '<!doctype html><title>Legacy</title><p>body</p>\n<script src="http://127.0.0.1:7817/lahe-layer.js" data-lahe-review="r_legacy"></script>\n');
  const w = world(doc);
  const cwd = tempDir("lahe-serve-cwd-");
  const port = await freePort();
  t.after(() => lahe(["session", "close", "s_agent", "--state-dir", w.dir, "--port", String(port)], cwd));
  const out = await lahe(["library", "serve", w.request.id, "--session", "s_agent", "--state-dir", w.dir, "--port", String(port)], cwd);
  assert.equal(out.code, 0, out.stderr + out.stdout);
  assert.deepEqual(fs.readdirSync(path.join(w.dir, "reviews")), ["r_legacy"], "no new review");
  const meta = JSON.parse(fs.readFileSync(path.join(w.dir, "reviews", "r_legacy", "meta.json"), "utf8"));
  assert.equal(meta.agent_session_id, "s_agent", "the review now belongs to the agent's session");
  const events = fs.readFileSync(path.join(w.dir, "reviews", "r_legacy", "events.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const adopted = events.filter((e) => e.event === protocol.EVENT.REVIEW_ADOPTED);
  assert.equal(adopted.length, 1, "one adoption, recorded in the review's own log");
  assert.equal(adopted[0].agent_session_id, "s_agent");
  assert.match(out.stdout + out.stderr, /old comments/i);
  assert.doesNotMatch(out.stdout + out.stderr, /new review/i);
});

test("the drain says a legacy pickup keeps its old comments, and does not say it starts a new review", async () => {
  const docs = tempDir("lahe-serve-doc-");
  const doc = path.join(docs, "legacy.html");
  fs.writeFileSync(doc, '<!doctype html>\n<script src="http://127.0.0.1:7817/lahe-layer.js" data-lahe-review="r_legacy"></script>\n');
  const w = world(doc);
  const status = require("../../src/cli/commands/status.js");
  const stdout = [];
  await status.run(["--session", "s_agent", "--json", "--quiet", "--state-dir", w.dir], { stdout: (x) => stdout.push(x), stderr: () => {} });
  const lines = stdout.join("").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  const entry = lines[lines.length - 1].catalog_requests.find((e) => e.request === w.request.id);
  assert.equal(entry.kind, "legacy");
  assert.match(entry.note, /old comments/);
  assert.doesNotMatch(entry.note, /new review/);
});

async function refused(w, args) {
  const err = [];
  const code = await library.run(args.concat(["--state-dir", w.dir]), { stdout: () => {}, stderr: (t) => err.push(t) });
  return { code, stderr: err.join("") };
}

test("serve refuses an unknown request, one for another session, and one whose review is gone", async () => {
  const docs = tempDir("lahe-serve-doc-");
  const doc = path.join(docs, "page.html");
  fs.writeFileSync(doc, "<p>page</p>");
  const w = world(doc);
  const unknown = await refused(w, ["serve", "cq_ghost", "--session", "s_agent"]);
  assert.equal(unknown.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(unknown.stderr, /no pending Library request cq_ghost/);
  const other = await refused(w, ["serve", w.request.id, "--session", "s_other"]);
  assert.equal(other.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(other.stderr, /no pending Library request/);
  fs.renameSync(doc, doc + ".gone");
  const gone = await refused(w, ["serve", w.request.id, "--session", "s_agent"]);
  assert.equal(gone.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(gone.stderr, /answer refused/);
});

test("serve refuses a static or dev-server row: those are taken over or refused, not served", async () => {
  const docs = tempDir("lahe-serve-doc-");
  const dir = path.join(tempDir(), "state");
  fs.mkdirSync(dir);
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_agent" });
  store.create({ id: "s_doc" });
  const log = logModule.createEventLog({ dir });
  reviewsModule.createReviews({ dir, log }).create({ id: "r_dev", agent_session_id: "s_doc", target_path: docs, origins: ["http://localhost:3000"] });
  const request = listen(dir, store, "r_dev", "s_doc");
  const out = await refused({ dir }, ["serve", request.id, "--session", "s_agent"]);
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(out.stderr, /kind dev-server/);
});

// Every copy of the agent instructions: no page-derived path in a shell string.
test("the contract, the skill and CONTRACTS.md carry no '<path>' or '<candidate>' template, and send pickups to lahe library serve", () => {
  const rf = require("../../src/shared/review_format.js");
  const root = path.join(__dirname, "..", "..");
  const copies = {
    contract: rf.CONTRACT.join("\n"),
    skill: fs.readFileSync(path.join(root, "skills", "lahe", "SKILL.md"), "utf8"),
    contracts_md: fs.readFileSync(path.join(root, "docs", "CONTRACTS.md"), "utf8")
  };
  for (const [name, text] of Object.entries(copies)) {
    assert.equal(text.includes("'<path>'"), false, name + " has a '<path>' template");
    assert.equal(text.includes("'<candidate>'"), false, name + " has a '<candidate>' template");
    assert.equal(/except a path you pass to (`)?lahe review/.test(text), false, name + " still carves out a shell exception");
    assert.match(text, /lahe library serve <request> --session/, name);
  }
});
