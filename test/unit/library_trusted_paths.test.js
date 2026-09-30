"use strict";

// A reviewed page cannot choose what `lahe library serve` serves or where a
// launched agent starts (final adversarial review, finding 1).
//
// `review.write` is reachable with the per-review token, which any script on
// the reviewed page can read off its script tag, and it records whatever
// `source_path` and `target_path` it is sent. So those two fields are page text.
// The Library takes its locations only from records a page cannot write:
//
//   - static and worktree rows: the covering server record's root
//     (ss_*.json, written by the helper)
//   - legacy rows: the recorded file, and only when that file holds this
//     review's own script line

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
const routes = require("../../src/service/routes.js");
const staticServers = require("../../src/service/static_servers.js");
const catalogReader = require("../../src/service/catalog_reader.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const status = require("../../src/cli/commands/status.js");
const library = require("../../src/cli/commands/library.js");

const T0 = Date.now();

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix || "lahe-trusted-paths-")));
}

function repo(root, name) {
  const at = path.join(root, name);
  fs.mkdirSync(path.join(at, ".git"), { recursive: true });
  return at;
}

function scriptLine(reviewId) {
  return '<script src="http://127.0.0.1:7817/lahe-layer.js" data-lahe-review="' + reviewId + '"></script>';
}

/** A static server record the helper would have written, without a process. */
function serverRecord(dir, sessionId, id, root) {
  const file = stateDir.staticServerPath(dir, sessionId, id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({
    schema: staticServers.SCHEMA, id, session_id: sessionId, instance: "inst_" + id, root, logical_root: root,
    host: "127.0.0.1", port: 54999, pid: 999999, started_at: new Date(T0 - 60000).toISOString(),
    stopped_at: new Date(T0 - 30000).toISOString(), mounts: {}
  }, null, 2) + "\n");
}

/**
 * State with s_agent (the Library's agent, attached and watching) and s_doc,
 * plus `root`: a temp folder holding the reviewed project and an unrelated
 * `elsewhere` repository a page would like to point the Library at.
 */
function world() {
  const root = tempDir();
  const dir = path.join(root, "state");
  fs.mkdirSync(dir);
  const store = agentSessions.createStore({ dir });
  store.create({ id: "s_agent" });
  store.create({ id: "s_doc" });
  const log = logModule.createEventLog({ dir });
  const reviews = reviewsModule.createReviews({ dir, log });
  const project = repo(root, "project");
  const elsewhere = repo(root, "elsewhere");
  const bait = path.join(elsewhere, "doc.html");
  fs.writeFileSync(bait, "<p>not the reviewed document</p>");
  catalogRequests.writeAttach(dir, "s_agent", T0);
  store.touchActivity("s_agent");
  const rev = agentSessions.handoffRev(store.read("s_agent"));
  store.writeMonitor("s_agent", { pid: process.pid, handoff_rev: rev, at: new Date(T0).toISOString() });
  return { root, dir, store, log, reviews, project, elsewhere, bait };
}

/** What a script on the reviewed page can do with the review token. */
function pageWrites(w, reviewId, body) {
  const result = routes.handlerFor("review.write")({ review: reviewId, query: {}, body }, { log: w.log, reviews: w.reviews });
  assert.equal(result.status, 200, JSON.stringify(result));
}

function queue(w, action, review, session) {
  const appended = catalogRequests.createQueue({ dir: w.dir }).append({ action, review, session, for: "s_agent" }, T0);
  assert.ok(appended.ok, JSON.stringify(appended));
  return appended.request;
}

async function drainEntry(w, requestId) {
  const stdout = [];
  await status.run(["--session", "s_agent", "--json", "--quiet", "--state-dir", w.dir], {
    stdout: (t) => stdout.push(t), stderr: () => {}, now: T0 + 1000
  });
  const lines = stdout.join("").split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
  const summary = lines[lines.length - 1];
  return (summary.catalog_requests || []).filter((e) => e.request === requestId)[0];
}

async function serve(w, requestId) {
  const err = [];
  const out = [];
  const code = await library.run(["serve", requestId, "--session", "s_agent", "--state-dir", w.dir], {
    stdout: (t) => out.push(t), stderr: (t) => err.push(t), now: T0 + 1000
  });
  return { code, stderr: err.join(""), stdout: out.join("") };
}

function notElsewhere(w, folder) {
  assert.notEqual(folder, w.elsewhere, "the launch folder is not the page's chosen repository");
  assert.ok(folder === null || folder.indexOf(w.elsewhere) !== 0, "nor anything inside it: " + folder);
}

test("legacy: a page that rewrites source_path cannot make serve serve another file, and the drain's folder is not that file's repository", async () => {
  const w = world();
  const doc = path.join(w.project, "legacy.html");
  fs.writeFileSync(doc, "<!doctype html><p>legacy</p>\n" + scriptLine("r_leg") + "\n");
  w.reviews.create({ id: "r_leg", target_path: doc });
  pageWrites(w, "r_leg", { source_path: w.bait });
  const request = queue(w, "pickup", "r_leg", "legacy");

  const out = await serve(w, request.id);
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE, out.stdout + out.stderr);
  assert.match(out.stderr, /script line/);

  const entry = await drainEntry(w, request.id);
  assert.ok(entry, "the pickup is in the drain");
  notElsewhere(w, entry.folder);
});

test("legacy: a page that rewrites target_path as well is refused the same way", async () => {
  const w = world();
  const doc = path.join(w.project, "legacy.html");
  fs.writeFileSync(doc, "<!doctype html><p>legacy</p>\n" + scriptLine("r_leg") + "\n");
  w.reviews.create({ id: "r_leg", target_path: doc });
  pageWrites(w, "r_leg", { source_path: w.bait, target_path: w.bait });
  const request = queue(w, "pickup", "r_leg", "legacy");
  const out = await serve(w, request.id);
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE, out.stdout + out.stderr);
  notElsewhere(w, (await drainEntry(w, request.id)).folder);
});

test("legacy: a file that holds another review's script line is not this review's document", async () => {
  const w = world();
  const doc = path.join(w.project, "legacy.html");
  fs.writeFileSync(doc, "<!doctype html>\n" + scriptLine("r_someone_else") + "\n");
  w.reviews.create({ id: "r_leg", target_path: doc });
  const request = queue(w, "pickup", "r_leg", "legacy");
  const out = await serve(w, request.id);
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(out.stderr, /script line/);
  assert.equal((await drainEntry(w, request.id)).folder, null);
});

test("legacy: the untouched review's drain folder is its own repository", async () => {
  const w = world();
  const doc = path.join(w.project, "legacy.html");
  fs.writeFileSync(doc, "<!doctype html>\n" + scriptLine("r_leg") + "\n");
  w.reviews.create({ id: "r_leg", target_path: doc });
  const request = queue(w, "launch", "r_leg", "legacy");
  assert.equal((await drainEntry(w, request.id)).folder, w.project);
});

test("static: a page that rewrites source_path does not move the drain's folder; it comes from the server record's root", async () => {
  const w = world();
  const site = path.join(w.project, "site");
  fs.mkdirSync(site);
  const page = path.join(site, "page.html");
  fs.writeFileSync(page, "<p>page</p>");
  w.reviews.create({ id: "r_st", agent_session_id: "s_doc", target_path: page });
  serverRecord(w.dir, "s_doc", "ss_site", site);
  pageWrites(w, "r_st", { source_path: w.bait });
  const request = queue(w, "pickup", "r_st", "s_doc");

  const out = await serve(w, request.id);
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE, out.stdout + out.stderr);
  const entry = await drainEntry(w, request.id);
  notElsewhere(w, entry.folder);
  assert.equal(entry.folder, w.project, "the repository holding the recorded server's root");
});

test("a fake worktree source_path does not turn a static row into a worktree row", async () => {
  const w = world();
  const site = path.join(w.project, "site");
  fs.mkdirSync(site);
  const page = path.join(site, "page.html");
  fs.writeFileSync(page, "<p>page</p>");
  // The main-repo copy the fake worktree path would map to exists.
  fs.mkdirSync(path.join(w.elsewhere, "docs"));
  fs.writeFileSync(path.join(w.elsewhere, "docs", "x.html"), "<p>x</p>");
  w.reviews.create({ id: "r_st", agent_session_id: "s_doc", target_path: page });
  serverRecord(w.dir, "s_doc", "ss_site", site);
  pageWrites(w, "r_st", { source_path: path.join(w.elsewhere, ".claude", "worktrees", "wt", "docs", "x.html") });

  const d = catalogReader.createReader({ dir: w.dir }).describeReview("r_st", T0);
  assert.notEqual(d.kind, "worktree");
  assert.equal(d.candidate, null);
  const request = queue(w, "pickup", "r_st", "s_doc");
  const out = await serve(w, request.id);
  assert.equal(out.code, protocol.CLI_EXIT.BAD_USAGE, out.stdout + out.stderr);
  const entry = await drainEntry(w, request.id);
  assert.notEqual(entry.kind, "worktree");
  notElsewhere(w, entry.folder);
});

test("a legacy review cannot be made a worktree row by a fake worktree path either", async () => {
  const w = world();
  const doc = path.join(w.project, "legacy.html");
  fs.writeFileSync(doc, "<!doctype html>\n" + scriptLine("r_leg") + "\n");
  fs.mkdirSync(path.join(w.elsewhere, "docs"));
  fs.writeFileSync(path.join(w.elsewhere, "docs", "x.html"), "<p>x</p>");
  w.reviews.create({ id: "r_leg", target_path: doc });
  const fake = path.join(w.elsewhere, ".claude", "worktrees", "wt", "docs", "x.html");
  pageWrites(w, "r_leg", { source_path: fake, target_path: fake });
  const d = catalogReader.createReader({ dir: w.dir }).describeReview("r_leg", T0);
  assert.equal(d.kind, "legacy");
  assert.equal(d.candidate, null);
});
