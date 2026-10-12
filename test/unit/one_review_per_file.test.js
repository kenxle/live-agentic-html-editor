// One review per file (each_page_its_own_comments.md, Part 1). `lahe review`
// of a file that already has a review opens that review and never makes a
// second one. In another agent session's review it prints the address and
// says whose it is: when that session's agent is listening it says to ask the
// human, and only otherwise does it name the takeover. A link alone, or a
// folder review with nothing said about the file, never claims it. A CLI
// takeover of a session someone is listening to is refused.
//
// Each test runs the real command through bin/lahe.js on free ports, a temp
// state folder and a temp home, and stops every helper it started.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const logModule = require("../../src/service/log.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const { freePort } = require("../helpers/free_port.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");
const { tempRoot, writeFile, raw } = require("../helpers/sites_world.js");

const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");
const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>";

async function cliWorld(t) {
  const root = tempRoot("lahe-one-review-");
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const w = { root, home, state: path.join(root, "state"), port: await freePort(), sessions: [] };
  w.env = Object.assign({}, process.env, { LAHE_HOME_DIR: home, LAHE_PAGES_PORT: String(await freePort()) });
  t.after(async () => {
    for (const s of w.sessions) run(w, ["session", "close", s]);
    await stopTempHelpers(w.state);
  });
  return w;
}

function run(w, args, withPort) {
  const full = [BIN].concat(args, ["--state-dir", w.state]).concat(withPort === false ? [] : ["--port", String(w.port)]);
  try {
    return { code: 0, stdout: execFileSync(process.execPath, full, { env: w.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), stderr: "" };
  } catch (err) {
    return { code: err.status || 1, stdout: String(err.stdout || ""), stderr: String(err.stderr || "") };
  }
}

function review(w, args) {
  const out = run(w, ["review"].concat(args));
  const s = /--session (s_[A-Za-z0-9_-]+)/.exec(out.stdout);
  if (s && w.sessions.indexOf(s[1]) === -1) w.sessions.push(s[1]);
  return out;
}

function reviewIds(w) {
  const dir = path.join(w.state, "reviews");
  return fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [];
}

function openUrl(out) {
  const m = /^\s*open\s+(\S+)/m.exec(out.stdout);
  return m ? m[1] : null;
}

function sessionOf(out) {
  return /--session (s_[A-Za-z0-9_-]+)/.exec(out.stdout)[1];
}

function reviewOf(out) {
  return /^\s*review\s+(r[A-Za-z0-9_-]+)/m.exec(out.stdout)[1];
}

let counter = 0;
/** A committed comment, appended to the review's log as the helper would. */
function comment(w, reviewId, origin, pagePath) {
  const item = record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, note: "said here", page_origin: origin, page_path: pagePath, page_title: "t", page_seq: 1 });
  counter += 1;
  logModule.createEventLog({ dir: w.state }).append(reviewId, [protocol.newEvent({
    event: protocol.EVENT.ITEM_READY, event_id: "ev_one_" + counter, review: reviewId, item: item.id, rev: item.rev,
    page_path: pagePath, page_title: "t", page_seq: 1, payload: { draft: false, record: item }
  })]);
}

function liveMonitor(w, sessionId) {
  const store = agentSessions.createStore({ dir: w.state });
  store.writeMonitor(sessionId, { pid: process.pid, handoff_rev: agentSessions.handoffRev(store.read(sessionId)) });
}

test("another agent's lahe review of a file with a review opens it, names its session and the takeover, and makes nothing", async (t) => {
  const w = await cliWorld(t);
  const file = writeFile(w.home, "ws/repo/docs/page.html", PAGE);
  const first = review(w, [file]);
  assert.equal(first.code, 0, first.stderr);
  const owner = sessionOf(first);
  const sessionsBefore = fs.readdirSync(path.join(w.state, "agent-sessions")).length;

  const second = run(w, ["review", file]);
  assert.equal(second.code, 0, second.stderr);
  assert.equal(openUrl(second), openUrl(first), "the same address");
  assert.match(second.stdout, new RegExp("agent session " + owner));
  assert.match(second.stdout, /already has a review/);
  assert.match(second.stdout, new RegExp("lahe session takeover " + owner));
  assert.deepEqual(reviewIds(w), [reviewOf(first)], "no second review");
  assert.equal(fs.readdirSync(path.join(w.state, "agent-sessions")).length, sessionsBefore, "no new session either");

  // Another agent's own session gets the same answer.
  const other = run(w, ["review", file, "--new-session"]);
  assert.notEqual(other.code, 0, "--new-session on a file with a review is refused");
  assert.deepEqual(reviewIds(w), [reviewOf(first)]);
});

test("when that session's agent is listening, it says to ask the human and names no takeover, and a CLI takeover is refused", async (t) => {
  const w = await cliWorld(t);
  const file = writeFile(w.home, "ws/repo/docs/page.html", PAGE);
  const first = review(w, [file]);
  const owner = sessionOf(first);
  liveMonitor(w, owner);
  const second = run(w, ["review", file]);
  assert.equal(second.code, 0, second.stderr);
  assert.match(second.stdout, /Ask your human/);
  assert.doesNotMatch(second.stdout, /lahe session takeover/);
  const takeover = run(w, ["session", "takeover", owner], false);
  assert.notEqual(takeover.code, 0);
  assert.match(takeover.stderr, /listening/);
});

test("--new on this session's own file is refused and names retire; after retire, a new review is made", async (t) => {
  const w = await cliWorld(t);
  const file = writeFile(w.home, "ws/repo/docs/page.html", PAGE);
  const first = review(w, [file]);
  const owner = sessionOf(first);
  const again = review(w, [file, "--session", owner, "--new"]);
  assert.notEqual(again.code, 0);
  assert.match(again.stderr, new RegExp("lahe review retire " + reviewOf(first) + " --session " + owner));
  assert.equal(reviewIds(w).length, 1);

  const foreign = run(w, ["review", "retire", reviewOf(first), "--session", "s_nobody"]);
  assert.notEqual(foreign.code, 0, "retire of another session's review is refused");
  const retired = run(w, ["review", "retire", reviewOf(first), "--session", owner]);
  assert.equal(retired.code, 0, retired.stderr);

  const fresh = review(w, [file, "--session", owner]);
  assert.equal(fresh.code, 0, fresh.stderr);
  assert.equal(reviewIds(w).length, 2, "a retired review no longer counts as the file's review");
  const url = new URL(openUrl(fresh));
  const page = await raw(Number(url.port), { path: url.pathname, headers: { host: url.host } });
  assert.match(page.text, new RegExp('data-lahe-review="' + reviewOf(fresh) + '"'));
});

test("a folder review holds a page only once it has a comment on it", async (t) => {
  const w = await cliWorld(t);
  const folder = path.join(w.home, "ws", "site", "pages");
  writeFile(folder, "index.html", PAGE);
  const page = writeFile(folder, "two.html", PAGE);
  const first = review(w, [folder]);
  assert.equal(first.code, 0, first.stderr);
  const owner = sessionOf(first);
  const origin = new URL(openUrl(first)).origin;

  // Nothing said about two.html: its own review is made, in this session.
  const unclaimed = review(w, [page, "--session", owner]);
  assert.equal(unclaimed.code, 0, unclaimed.stderr);
  assert.equal(reviewIds(w).length, 2);
  run(w, ["review", "retire", reviewOf(unclaimed), "--session", owner]);

  // With a comment on two.html, the folder review holds it.
  comment(w, reviewOf(first), origin, "/two.html");
  const claimed = review(w, [page, "--session", owner]);
  assert.equal(claimed.code, 0, claimed.stderr);
  assert.equal(reviewOf(claimed), reviewOf(first), "the folder review is opened");
  assert.equal(reviewIds(w).length, 2, "no third review");
});

test("a link alone never claims a file; a linking review with a comment on it does", async (t) => {
  const w = await cliWorld(t);
  const notes = path.join(w.home, "ws", "repo", "notes");
  const far = writeFile(w.home, "ws/other/far.md", "# Far\n\nThe far side.\n");
  writeFile(notes, "hub.md", "# Hub\n\n[far](../../other/far.md)\n");
  const hub = review(w, [path.join(notes, "hub.md")]);
  assert.equal(hub.code, 0, hub.stderr);
  const hubUrl = new URL(openUrl(hub));
  // Viewing the hub records the link on its site.
  const hubPage = await raw(Number(hubUrl.port), { path: hubUrl.pathname, headers: { host: hubUrl.host } });
  const mount = /href="(\/\.lahe-source\/[a-f0-9]+\/)far\.md"/.exec(hubPage.text)[1];

  const viewedOnly = run(w, ["review", far]);
  assert.equal(viewedOnly.code, 0, viewedOnly.stderr);
  assert.doesNotMatch(viewedOnly.stdout, /already has a review/, "a link alone claims nothing");
  const s2 = sessionOf(viewedOnly);
  w.sessions.push(s2);
  const farReview = reviewOf(viewedOnly);
  run(w, ["review", "retire", farReview, "--session", s2]);

  comment(w, reviewOf(hub), hubUrl.origin, mount + "far.md");
  const claimed = run(w, ["review", far]);
  assert.equal(claimed.code, 0, claimed.stderr);
  assert.match(claimed.stdout, /already has a review/);
  assert.equal(reviewOf(claimed), reviewOf(hub));
});

// A handoff the human confirmed in the Library ends with the agent running
// the takeover. While the session's agent is listening, the CLI takes it over
// only with the pending Library request that asked for it.
test("a takeover of a listened-to session goes through with the Library request that asked for it, and only with it", async (t) => {
  const w = await cliWorld(t);
  const file = writeFile(w.home, "ws/repo/docs/page.html", PAGE);
  const first = review(w, [file]);
  const owner = sessionOf(first);
  liveMonitor(w, owner);
  const caller = agentSessions.createStore({ dir: w.state }).create({ name: "caller" }).id;
  w.sessions.push(caller);
  // The agent attached to the Library, listening, as a pending request needs.
  liveMonitor(w, caller);
  catalogRequests.writeAttach(w.state, caller, Date.now());
  const queue = catalogRequests.createQueue({ dir: w.state });
  const asked = queue.append({ action: catalogRequests.ACTION.PICKUP, review: reviewOf(first), session: owner, for: caller }, Date.now());
  assert.equal(asked.ok, true);
  const other = queue.append({ action: catalogRequests.ACTION.PICKUP, review: "r_other_review", session: caller, for: caller }, Date.now());
  assert.equal(other.ok, true);

  const bare = run(w, ["session", "takeover", owner], false);
  assert.notEqual(bare.code, 0, "still refused without a request");
  const wrong = run(w, ["session", "takeover", owner, "--request", other.request.id], false);
  assert.notEqual(wrong.code, 0, "a request for another session does not count");
  const made = run(w, ["session", "takeover", owner, "--request", asked.request.id], false);
  assert.equal(made.code, 0, made.stderr);
  assert.match(made.stdout, /taken over explicitly/);
});

// Code review, critical 2: the hub's own session adding the linked file to
// the hub's review (add --review L --source far.md) must not take the hub's
// source away.
test("the hub's session reviewing a linked file it commented on keeps the hub's rail", async (t) => {
  const w = await cliWorld(t);
  const notes = path.join(w.home, "ws", "repo", "notes");
  const far = writeFile(w.home, "ws/other/far.md", "# Far\n\nThe far side.\n");
  const hubFile = writeFile(notes, "hub.md", "# Hub\n\n[far](../../other/far.md)\n");
  const hub = review(w, [hubFile]);
  const owner = sessionOf(hub);
  const hubUrl = new URL(openUrl(hub));
  const hubPage = await raw(Number(hubUrl.port), { path: hubUrl.pathname, headers: { host: hubUrl.host } });
  const mount = /href="(\/\.lahe-source\/[a-f0-9]+\/)far\.md"/.exec(hubPage.text)[1];
  comment(w, reviewOf(hub), hubUrl.origin, mount + "far.md");

  const farOut = review(w, [far, "--session", owner]);
  assert.equal(farOut.code, 0, farOut.stderr);
  assert.equal(reviewOf(farOut), reviewOf(hub), "the linked file joins the hub's review");
  const meta = JSON.parse(fs.readFileSync(path.join(w.state, "reviews", reviewOf(hub), "meta.json"), "utf8"));
  assert.equal(meta.source_path, hubFile, "the hub stays the review's first source");
  const again = await raw(Number(hubUrl.port), { path: hubUrl.pathname, headers: { host: hubUrl.host } });
  assert.match(again.text, new RegExp('data-lahe-review="' + reviewOf(hub) + '"'), "the hub keeps its rail");
  const hubAgain = review(w, [hubFile, "--session", owner]);
  assert.equal(reviewOf(hubAgain), reviewOf(hub), "and a later review of the hub opens the same review");
  assert.equal(reviewIds(w).length, 1);
});
