"use strict";

// The catalog reader: builds the Library's list from the state dir.
// LAHE Library plan, Task 1.1, "Reader and store (1.1)" in the Test List;
// architecture "The list response" and "Failure Modes".
//
// Every test installs the committed fixture (test/fixtures/catalog_state/) into
// its own temporary directory, with every modified time set by fs.utimesSync.
// Time is passed in as `now`; nothing sleeps.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const catalogReader = require("../../src/service/catalog_reader.js");
const staticServers = require("../../src/service/static_servers.js");
const fixture = require("../fixtures/catalog_state.js");

const LIST_FIXTURE = path.join(__dirname, "..", "fixtures", "catalog_list.json");
const MINUTE = 60 * 1000;

// What 1.4's request queue hands the reader for the fixture, in its own shape
// (by_name already filled): one request in each state, plus an answer older
// than ANSWER_SHOWN_MS that must not show.
function fixtureRequests(nowMs) {
  const at = (msAgo) => new Date(nowMs - msAgo).toISOString();
  const named = (requests) => {
    Object.keys(requests).forEach((id) => { requests[id].by_name = "document index"; });
    return requests;
  };
  return named({
    r_brief: { id: "cq_waiting1", action: "pickup", at: at(2 * MINUTE), for: "s_index", state: "waiting" },
    r_spec: {
      id: "cq_done1", action: "pickup", at: at(40 * MINUTE), for: "s_index", state: "done",
      by: "s_index", text: "watching Shared Title", answered_at: at(35 * MINUTE)
    },
    r_notes: {
      id: "cq_refused1", action: "launch", at: at(60 * MINUTE), for: "s_index", state: "refused",
      by: "s_index", text: "I can't open a terminal here.", answered_at: at(58 * MINUTE)
    },
    r_wt_gone: { id: "cq_expired1", action: "pickup", at: at(90 * MINUTE), for: "s_index", state: "expired", reason: "monitor_dead" },
    r_legacy: {
      id: "cq_old1", action: "pickup", at: at(2 * 24 * 60 * MINUTE), for: "s_index", state: "done",
      by: "s_index", text: "long ago", answered_at: at(2 * 24 * 60 * MINUTE - MINUTE)
    }
  });
}

function setup(overrides) {
  const installed = fixture.install();
  const reads = [];
  const requests = fixtureRequests(installed.nowMs);
  const options = Object.assign(
    {
      dir: installed.dir,
      home: installed.home,
      readFile: (file, encoding) => {
        reads.push(file);
        return fs.readFileSync(file, encoding);
      },
      pidAlive: () => true,
      probe: async (meta) => meta.id === "ss_beta",
      attachment: () => ({ session: "s_index", name: "document index", at: new Date(installed.nowMs - 5 * MINUTE).toISOString(), watching: true }),
      requestFor: (reviewId) => requests[reviewId] || null
    },
    overrides || {}
  );
  const reader = catalogReader.createReader(options);
  return { installed, reader, reads, options };
}

function rows(list) {
  const out = [];
  list.sessions.forEach((s) => s.reviews.forEach((r) => out.push(Object.assign({ session_id: s.id }, r))));
  return out;
}

function row(list, id) {
  const found = rows(list).find((r) => r.id === id);
  assert.ok(found, "no row " + id + " in the list");
  return found;
}

function session(list, id) {
  const found = list.sessions.find((s) => s.id === id);
  assert.ok(found, "no session " + id + " in the list");
  return found;
}

function readsOf(reads, suffix) {
  return reads.filter((file) => file.endsWith(suffix)).length;
}

// --- grouping ----------------------------------------------------------------

test("reviews group by session, newest session first, reviews newest first", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  const lasts = list.sessions.map((s) => s.last);
  assert.deepEqual(lasts, lasts.slice().sort().reverse());
  list.sessions.forEach((s) => {
    const reviewLasts = s.reviews.map((r) => r.last);
    assert.deepEqual(reviewLasts, reviewLasts.slice().sort().reverse(), "reviews in " + s.id);
    assert.equal(s.last, reviewLasts[0], "a session's last is its newest review's");
  });
  assert.equal(list.sessions[0].id, "s_coach");
  assert.deepEqual(session(list, "s_coach").reviews.map((r) => r.id), ["r_brief", "r_spec", "r_notes", "r_mounted", "r_deleted"]);
});

test("a review's last is its newest work event's own time", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  const log = path.join(installed.dir, "reviews", "r_brief", "events.jsonl");
  assert.equal(row(list, "r_brief").last, newestWorkTs(log));
});

test("the legacy review lists under the legacy session with kind legacy", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  const legacy = row(list, "r_legacy");
  assert.equal(legacy.session_id, "legacy");
  assert.equal(legacy.kind, "legacy");
  assert.equal(legacy.openable, "via-agent");
  assert.equal(session(list, "legacy").name, null);
});

// --- projects ----------------------------------------------------------------

test("a session that touched two projects carries both labels", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.deepEqual(session(list, "s_coach").projects, ["alpha", "beta"]);
  assert.equal(row(list, "r_spec").project, "beta");
});

test("a worktree review carries its owning repository's name, live or gone", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_wt_live").project, "alpha");
  assert.equal(row(list, "r_wt_gone").project, "alpha");
  assert.deepEqual(session(list, "s_ops").projects, ["alpha"]);
});

test("a review outside git has no project", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_shared").project, null);
  assert.deepEqual(session(list, "s_old3").projects, ["alpha"]);
});

// --- folding -----------------------------------------------------------------

for (const tz of ["America/New_York", "UTC"]) {
  test("fold: reviews one minute either side of FOLD_CUTOFF fold and do not fold, under TZ=" + tz, async (t) => {
    const before = process.env.TZ;
    process.env.TZ = tz;
    t.after(() => {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    });
    const { reader, installed } = setup();
    const list = await reader.list(installed.nowMs);
    // r_old2 was created one minute before the cutoff, r_old4 one minute after.
    const folded = row(list, "r_old2");
    assert.deepEqual(folded.folded_from, ["r_old1", "r_old3"]);
    assert.equal(row(list, "r_old4").folded_from.length, 0);
    assert.equal(rows(list).some((r) => r.id === "r_old1" || r.id === "r_old3"), false);
  });
}

test("fold negatives: two sessions in one folder, one session in two folders, and a folder review stay unfolded", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  // p5.html is in the fold folder but in another session.
  assert.equal(row(list, "r_s3page").session_id, "s_old3");
  assert.deepEqual(row(list, "r_s3page").folded_from, []);
  // x.html is the same session's only pre-cutoff page in its folder.
  assert.deepEqual(row(list, "r_other").folded_from, []);
  // The folder review of old-pages itself is not a single page.
  assert.deepEqual(row(list, "r_oldfolder").folded_from, []);
});

test("a fold is titled from its folder, sums waiting and total, and shows a star from an older folded review", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  const folded = row(list, "r_old2");
  assert.equal(folded.title, "old-pages");
  assert.equal(folded.display_name, "old-pages");
  assert.equal(folded.file, null);
  assert.equal(folded.folder, "old-pages");
  assert.equal(folded.waiting, 3);
  assert.equal(folded.total, 6);
  assert.equal(folded.starred, true, "r_old1 is starred and it is inside the fold");
  // Every folded review.json is current, so the fold's counts are not stale.
  assert.equal(folded.counts_as_of, folded.last);
});

// --- display names -------------------------------------------------------------

test("a review with no review.json shows its file name", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_notitle").title, null);
  assert.equal(row(list, "r_notitle").display_name, "loose / untitled.html");
});

test("a title shared by two rows shows folder and file on both", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_spec").title, "Shared Title");
  assert.equal(row(list, "r_spec").display_name, "specs / spec.html");
  assert.equal(row(list, "r_shared").display_name, "loose / shared.html");
  assert.equal(row(list, "r_brief").display_name, "Feature Brief: Coach Activity");
});

test("a Markdown review is named and placed by its source file, not the rendered page", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  const notes = row(list, "r_notes");
  assert.equal(notes.file, "notes.md");
  assert.equal(notes.folder, "docs");
  assert.equal(notes.path_hint, "~/projects/alpha/docs");
  assert.equal(notes.ended, true);
});

// --- counts, staleness, re-projection -------------------------------------------

test("a small review whose log is newer than review.json is re-projected", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  const stale = row(list, "r_stale");
  // review.json was written before either comment; the log has both.
  assert.equal(stale.waiting, 2);
  assert.equal(stale.total, 2);
  assert.equal(stale.counts_as_of, stale.last);
});

test("a log over REPROJECT_MAX_BYTES is never read, and the row shows counts_as_of", async () => {
  const { reader, installed, reads } = setup();
  const big = path.join(installed.dir, "reviews", fixture.BIG_REVIEW, "events.jsonl");
  assert.ok(fs.statSync(big).size > protocol.CATALOG.REPROJECT_MAX_BYTES);
  const list = await reader.list(installed.nowMs);
  assert.equal(reads.filter((file) => file === big).length, 0);
  const row0 = row(list, fixture.BIG_REVIEW);
  const reviewJson = path.join(installed.dir, "reviews", fixture.BIG_REVIEW, "review.json");
  assert.equal(row0.counts_as_of, fs.statSync(reviewJson).mtime.toISOString());
  assert.ok(row0.counts_as_of < row0.last);
  assert.equal(row0.total, 1, "the counts review.json had, not the log's");
});

test("waiting counts unanswered ready comments and total counts every comment", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_brief").waiting, 3);
  assert.equal(row(list, "r_brief").total, 5);
});

// --- cache -------------------------------------------------------------------

test("cache: a second list with no changes reads zero review.json files", async () => {
  const { reader, installed, reads } = setup();
  await reader.list(installed.nowMs);
  assert.ok(readsOf(reads, "review.json") > 0);
  reads.length = 0;
  await reader.list(installed.nowMs);
  assert.equal(readsOf(reads, "review.json"), 0);
  assert.equal(readsOf(reads, "meta.json"), 0);
  assert.equal(readsOf(reads, "session.json"), 0);
});

test("cache: a change with the same modified time and a new size is seen", async () => {
  const { reader, installed } = setup();
  await reader.list(installed.nowMs);
  const file = path.join(installed.dir, "reviews", "r_brief", "review.json");
  const stat = fs.statSync(file);
  const body = JSON.parse(fs.readFileSync(file, "utf8"));
  body.pages[0].title = "Feature Brief: Coach Activity, renamed";
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + "\n");
  fs.utimesSync(file, stat.atime, stat.mtime);
  assert.equal(fs.statSync(file).mtimeMs, stat.mtimeMs);
  assert.notEqual(fs.statSync(file).size, stat.size);
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_brief").title, "Feature Brief: Coach Activity, renamed");
});

// --- openable and kind -------------------------------------------------------------

test("openable is yes exactly when static_servers.coveragePath covers the file for a recorded server, mounts included", async () => {
  // The coverage rule lives once, in static_servers.js; servesPath is that rule
  // plus "running right now" (tested there). Open restarts stopped servers, so
  // the reader asks the rule alone, and every row whose document is on disk
  // must agree with it.
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  let compared = 0;
  rows(list).forEach((r) => {
    if (r.unreadable || r.session_id === "legacy") return;
    const d = reader.describeReview(r.id, installed.nowMs);
    if (!d.path || !fs.existsSync(d.path)) return;
    const meta = JSON.parse(fs.readFileSync(path.join(installed.dir, "reviews", r.id, "meta.json"), "utf8"));
    const covered = staticServers
      .list(installed.dir, r.session_id)
      .some((record) => staticServers.coveragePath(record, meta.target_path) !== null);
    assert.equal(r.openable === "yes", covered, r.id + ": openable " + r.openable + ", covered " + covered);
    compared += 1;
  });
  assert.ok(compared >= 8, "compared " + compared + " rows");
  assert.equal(row(list, "r_mounted").openable, "yes", "served through a mount");
});

test("a stopped recorded server still makes its review openable: Open restarts it", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_brief").openable, "yes");
  assert.equal(row(list, "r_brief").kind, "static");
});

test("a dev-server review is via-agent with kind dev-server", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_dev").openable, "via-agent");
  assert.equal(row(list, "r_dev").kind, "dev-server");
});

test("a review whose worktree is gone but whose main-repo copy exists is via-agent, kind worktree; with neither it is missing", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_wt_gone").openable, "via-agent");
  assert.equal(row(list, "r_wt_gone").kind, "worktree");
  assert.equal(row(list, "r_wt_vanished").openable, "missing");
  assert.equal(row(list, "r_deleted").openable, "missing");
});

// --- describeReview and the worktree candidate ------------------------------------

test("describeReview gives the display name, the document's path, and a checked worktree candidate", async () => {
  const { reader, installed } = setup();
  const brief = reader.describeReview("r_brief", installed.nowMs);
  assert.equal(brief.display_name, "Feature Brief: Coach Activity");
  assert.equal(brief.path, path.join(installed.home, "projects/alpha/docs/brief.html"));
  assert.equal(brief.candidate, null);
  const gone = reader.describeReview("r_wt_gone", installed.nowMs);
  assert.equal(gone.kind, "worktree");
  assert.equal(gone.candidate, path.join(installed.home, "projects/alpha/docs/brief.html"));
  assert.equal(reader.describeReview("r_spec", installed.nowMs).display_name, "specs / spec.html");
  assert.equal(reader.describeReview("r_nope", installed.nowMs), null);
});

test("describeReview also names what Open needs: the covering server, the URL path on it, the served file, who is watching, and last", async () => {
  const { reader, installed } = setup();
  const brief = reader.describeReview("r_brief", installed.nowMs);
  assert.equal(brief.session, "s_coach");
  assert.equal(brief.openable, "yes");
  assert.equal(brief.server, "ss_alphadocs");
  assert.equal(brief.url_path, "/brief.html");
  assert.equal(brief.served_path, path.join(installed.home, "projects/alpha/docs/brief.html"));
  assert.deepEqual(brief.watching, { session: "s_coach", name: "coach activity", state: "listening", last_active: new Date(installed.nowMs - 10 * 1000).toISOString() });
  assert.equal(brief.last, "2026-09-28T15:40:00.000Z");
  const mounted = reader.describeReview("r_mounted", installed.nowMs);
  assert.match(mounted.url_path, /^\/\.lahe-source\/[a-f0-9]+\/figure\.html$/);
  const dev = reader.describeReview("r_dev", installed.nowMs);
  assert.equal(dev.server, null);
  assert.equal(dev.url_path, null);
  assert.equal(dev.watching, null);
});

test("a worktree candidate that is hidden, symlinked out of its repository, or not a page is null", async () => {
  const { installed } = setup();
  const alpha = path.join(installed.home, "projects/alpha");
  const cases = {
    hidden: ".secret/brief.html",
    symlinked: "docs/linked.html",
    notpage: "docs/data.json"
  };
  fs.mkdirSync(path.join(alpha, ".secret"));
  fs.writeFileSync(path.join(alpha, ".secret/brief.html"), "<p>hidden</p>");
  const outside = path.join(installed.root, "outside.html");
  fs.writeFileSync(outside, "<p>outside</p>");
  fs.symlinkSync(outside, path.join(alpha, "docs/linked.html"));
  fs.writeFileSync(path.join(alpha, "docs/data.json"), "{}");
  for (const [label, rel] of Object.entries(cases)) {
    const target = path.join(alpha, ".claude/worktrees/wt-gone", rel);
    const metaFile = path.join(installed.dir, "reviews", "r_wt_gone", "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    meta.target_path = target;
    meta.target_paths = [target];
    fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2) + "\n");
    const reader = catalogReader.createReader({ dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false });
    assert.equal(reader.describeReview("r_wt_gone", installed.nowMs).candidate, null, label);
    const list = await reader.list(installed.nowMs);
    assert.equal(row(list, "r_wt_gone").openable, "missing", label + ": a failed candidate is not a main-repo copy");
  }
});

test("a worktree candidate owned by another user is null, and the row is missing (T2)", async (t) => {
  if (typeof process.getuid !== "function") {
    t.skip("no file owners on this platform");
    return;
  }
  const { installed } = setup();
  const realGetuid = process.getuid;
  // The reader has no uid option, so the check's own source of "the current
  // user" is swapped for one that owns nothing in the fixture. The candidate
  // file itself is untouched: it still exists, under the repository, a page.
  process.getuid = () => realGetuid.call(process) + 1;
  try {
    const reader = catalogReader.createReader({ dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false });
    assert.equal(reader.describeReview("r_wt_gone", installed.nowMs).candidate, null);
    const list = await reader.list(installed.nowMs);
    assert.equal(row(list, "r_wt_gone").openable, "missing");
  } finally {
    process.getuid = realGetuid;
  }
  // The same fixture with the real owner has a candidate, so the null above is
  // the owner check and nothing else.
  const reader = catalogReader.createReader({ dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false });
  assert.equal(reader.describeReview("r_wt_gone", installed.nowMs).candidate, path.join(installed.home, "projects/alpha/docs/brief.html"));
});

// --- probes ------------------------------------------------------------------

test("served_url is set only when the recorded server answers its exact-identity probe; stopped records are skipped and a probe is not repeated within one POLL_MS", async (t) => {
  const hits = [];
  let identity = null;
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    if (!identity || req.url !== "/.lahe-static-health/" + identity.id + "/" + identity.instance) {
      res.writeHead(404);
      return res.end();
    }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(identity));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const port = server.address().port;

  const installed = fixture.install();
  const serversDir = path.join(installed.dir, "agent-sessions", "s_coach", "static-servers");
  const retarget = (name) => {
    const file = path.join(serversDir, name + ".json");
    const meta = JSON.parse(fs.readFileSync(file, "utf8"));
    meta.port = port;
    fs.writeFileSync(file, JSON.stringify(meta, null, 2) + "\n");
    return meta;
  };
  const beta = retarget("ss_beta");
  retarget("ss_alphadocs"); // stopped: must never be probed
  identity = { id: beta.id, instance: beta.instance, started_at: beta.started_at, pid: beta.pid };

  const reader = catalogReader.createReader({ dir: installed.dir, home: installed.home, pidAlive: () => true });
  const first = await reader.list(installed.nowMs);
  assert.equal(row(first, "r_spec").served_url, "http://127.0.0.1:" + port + "/spec.html");
  assert.equal(row(first, "r_brief").served_url, null, "a stopped record is not probed");
  assert.equal(hits.length, 1);
  assert.ok(hits.every((url) => url.indexOf("ss_alphadocs") === -1));

  await reader.list(installed.nowMs + protocol.CATALOG.POLL_MS - 1);
  assert.equal(hits.length, 1, "cached for one POLL_MS");
  await reader.list(installed.nowMs + protocol.CATALOG.POLL_MS);
  assert.equal(hits.length, 2, "probed again at POLL_MS");

  identity = Object.assign({}, identity, { pid: identity.pid + 1 });
  const wrong = await reader.list(installed.nowMs + 2 * protocol.CATALOG.POLL_MS);
  assert.equal(row(wrong, "r_spec").served_url, null, "a server with another identity is not this review's");
});

// --- watching and attached ------------------------------------------------------

test("watching names the primary session from a fresh heartbeat, and is null for a stale one", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.deepEqual(session(list, "s_coach").watching, { session: "s_coach", name: "coach activity", state: "listening", last_active: new Date(installed.nowMs - 10 * 1000).toISOString() });
  assert.deepEqual(session(list, "s_ops").watching, { session: "s_index", name: "document index", state: "listening", last_active: new Date(installed.nowMs - 10 * 1000).toISOString() });
  assert.equal(session(list, "s_old3").watching, null);
  assert.equal(session(list, "s_dev").watching, null);
});

test("watching turns stale exactly at HEARTBEAT_FRESH_MS", async () => {
  const { reader, installed } = setup();
  const beatAt = installed.nowMs - 10 * 1000;
  const inside = await reader.list(beatAt + protocol.MONITOR.HEARTBEAT_FRESH_MS);
  assert.notEqual(session(inside, "s_coach").watching, null);
  const at = await reader.list(beatAt + protocol.MONITOR.HEARTBEAT_FRESH_MS + 1);
  assert.equal(session(at, "s_coach").watching, null);
});

test("attached names the attached session and whether its monitor is live", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.deepEqual(list.attached, { session: "s_index", name: "document index", watching: true, closed: false });
});

/** A reader wired to the real queue over the fixture, as the helper wires it. */
function queueReader(installed) {
  const catalogRequests = require("../../src/service/catalog_requests.js");
  const queue = catalogRequests.createQueue({ dir: installed.dir, pidAlive: () => true, log: () => {} });
  return catalogReader.createReader(Object.assign({
    dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false
  }, catalogReader.queueInputs(queue)));
}

test("attached: the later of two attaches wins", async () => {
  const catalogRequests = require("../../src/service/catalog_requests.js");
  const installed = fixture.install();
  const reader = queueReader(installed);
  catalogRequests.writeAttach(installed.dir, "s_coach", Date.parse("2026-09-28T15:50:00.000Z"));
  assert.equal((await reader.list(installed.nowMs)).attached.session, "s_coach");
  catalogRequests.writeAttach(installed.dir, "s_index", Date.parse("2026-09-28T15:55:00.000Z"));
  assert.equal((await reader.list(installed.nowMs)).attached.session, "s_index");
});

test("attached: a stale heartbeat gives watching false", async () => {
  const catalogRequests = require("../../src/service/catalog_requests.js");
  const installed = fixture.install();
  catalogRequests.writeAttach(installed.dir, "s_old3", Date.parse("2026-09-28T15:50:00.000Z"));
  const list = await queueReader(installed).list(installed.nowMs);
  assert.deepEqual(list.attached, { session: "s_old3", name: null, watching: false, closed: true });
});

test("attached: an attach with nothing on disk behind it is no agent", async () => {
  const catalogRequests = require("../../src/service/catalog_requests.js");
  const installed = fixture.install();
  const reader = queueReader(installed);
  assert.equal((await reader.list(installed.nowMs)).attached, null, "no attach at all");
  catalogRequests.writeAttach(installed.dir, "s_ghost", Date.parse("2026-09-28T15:50:00.000Z"));
  assert.equal((await reader.list(installed.nowMs)).attached, null);
});

// --- requests -----------------------------------------------------------------

test("request carries the latest request on the review with the agent's name", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_brief").request.state, "waiting");
  assert.equal(row(list, "r_brief").request.by_name, "document index");
  assert.equal(row(list, "r_spec").request.state, "done");
  assert.equal(row(list, "r_spec").request.text, "watching Shared Title");
  assert.equal(row(list, "r_notes").request.state, "refused");
  assert.equal(row(list, "r_wt_gone").request.state, "expired");
  assert.equal(row(list, "r_other").request, null);
});

test("an answer stays on its row until ANSWER_SHOWN_MS, and not at it", async () => {
  const answeredAt = "2026-09-28T15:00:00.000Z";
  const request = { id: "cq_a", action: "pickup", at: "2026-09-28T14:59:00.000Z", state: "done", by_name: "document index", text: "ok", answered_at: answeredAt };
  const { reader } = setup({ requestFor: (id) => (id === "r_brief" ? request : null) });
  const limit = Date.parse(answeredAt) + protocol.CATALOG.ANSWER_SHOWN_MS;
  assert.notEqual(row(await reader.list(limit - 1), "r_brief").request, null);
  assert.equal(row(await reader.list(limit), "r_brief").request, null);
});

test("wired to 1.4's real queue: attached comes from readAttached and each row's request from requestFor", async () => {
  const catalogRequests = require("../../src/service/catalog_requests.js");
  const installed = fixture.install();
  const now = installed.nowMs;
  // The fixture's s_index is closed; the queue counts a closed session as not
  // listening, so the attached agent is reopened first, as a live one would be.
  require("../../src/service/agent_sessions.js").createStore({ dir: installed.dir }).reopen("s_index");
  catalogRequests.writeAttach(installed.dir, "s_index", now - 5 * MINUTE);
  const queue = catalogRequests.createQueue({ dir: installed.dir, writeExpired: true, pidAlive: () => true, log: () => {} });
  const waiting = queue.append({ action: "pickup", review: "r_brief", session: "s_coach", for: "s_index" }, now - 2 * MINUTE);
  const done = queue.append({ action: "launch", review: "r_spec", session: "s_coach", for: "s_index" }, now - 4 * MINUTE);
  assert.equal(queue.answer({ id: done.request.id, by: "s_index", status: "done", text: "Launched claude" }, now - 3 * MINUTE).ok, true);
  const reader = catalogReader.createReader({
    dir: installed.dir,
    home: installed.home,
    pidAlive: () => true,
    probe: async () => false,
    attachment: queue.readAttached,
    requestFor: queue.requestFor
  });
  const list = await reader.list(now);
  assert.deepEqual(list.attached, { session: "s_index", name: "document index", watching: true, closed: false });
  assert.deepEqual(row(list, "r_brief").request, {
    id: waiting.request.id, action: "pickup", at: waiting.request.at, state: "waiting",
    by_name: "document index", text: null, answered_at: null, reason: null
  });
  const answered = row(list, "r_spec").request;
  assert.equal(answered.state, "done");
  assert.equal(answered.by_name, "document index");
  assert.equal(answered.text, "Launched claude");
  assert.equal(row(list, "r_notes").request, null);
});

test("one list call reads catalog-requests.jsonl once, not once per row, and every row still gets its request", async () => {
  // The page polls every POLL_MS; before this, each row's requestFor re-read
  // and re-folded the whole queue file, so a few hundred rows meant a few
  // hundred reads per poll.
  const catalogRequests = require("../../src/service/catalog_requests.js");
  const stateDir = require("../../src/service/state_dir.js");
  const installed = fixture.install();
  const now = installed.nowMs;
  require("../../src/service/agent_sessions.js").createStore({ dir: installed.dir }).reopen("s_index");
  catalogRequests.writeAttach(installed.dir, "s_index", now - 5 * MINUTE);
  const queueFile = stateDir.catalogRequestsPath(installed.dir);
  let queueReads = 0;
  const queue = catalogRequests.createQueue({
    dir: installed.dir, writeExpired: true, pidAlive: () => true, log: () => {},
    readFile: (file, encoding) => {
      if (file === queueFile) queueReads += 1;
      return fs.readFileSync(file, encoding);
    }
  });
  const brief = queue.append({ action: "pickup", review: "r_brief", session: "s_coach", for: "s_index" }, now - 2 * MINUTE);
  const spec = queue.append({ action: "launch", review: "r_spec", session: "s_coach", for: "s_index" }, now - 2 * MINUTE);
  // Wired exactly as src/service/index.js wires the helper's reader.
  const reader = catalogReader.createReader(Object.assign({
    dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false
  }, catalogReader.queueInputs(queue)));
  queueReads = 0;
  const list = await reader.list(now);
  assert.ok(rows(list).length > 2, "the fixture has many rows");
  assert.equal(queueReads, 1, "one read of the queue file per list call");
  assert.equal(row(list, "r_brief").request.id, brief.request.id);
  assert.equal(row(list, "r_spec").request.id, spec.request.id);
  assert.equal(row(list, "r_notes").request, null);
});

test("attached.watching is the queue's own answer when the attach carries one, so the header and Open agree", async () => {
  const catalogRequests = require("../../src/service/catalog_requests.js");
  const installed = fixture.install();
  // s_index has a fresh heartbeat but is closed: the queue will not hand it a
  // request, so the Library must not say it is watching.
  catalogRequests.writeAttach(installed.dir, "s_index", installed.nowMs - 5 * MINUTE);
  const queue = catalogRequests.createQueue({ dir: installed.dir, pidAlive: () => true, log: () => {} });
  assert.equal(queue.readAttached(installed.nowMs).watching, false);
  const reader = catalogReader.createReader({
    dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false,
    attachment: queue.readAttached, requestFor: queue.requestFor
  });
  assert.deepEqual((await reader.list(installed.nowMs)).attached, { session: "s_index", name: "document index", watching: false, closed: true });
});

test("attached.closed is true when the attached session has closed_at, and false once it is reopened", async () => {
  // The page's header reads it: a closed attached session says "No agent
  // attached", not "stopped watching".
  const catalogRequests = require("../../src/service/catalog_requests.js");
  const installed = fixture.install();
  catalogRequests.writeAttach(installed.dir, "s_index", installed.nowMs - 5 * MINUTE);
  const reader = queueReader(installed);
  assert.equal((await reader.list(installed.nowMs)).attached.closed, true, "the fixture's s_index is closed");
  require("../../src/service/agent_sessions.js").createStore({ dir: installed.dir }).reopen("s_index");
  const reopened = (await reader.list(installed.nowMs)).attached;
  assert.equal(reopened.closed, false);
  assert.equal(reopened.watching, true);
});

// --- corrupt files ---------------------------------------------------------------

test("a corrupt review.json, meta.json, session.json or ss_*.json marks only its own row unreadable", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  const unreadable = rows(list).filter((r) => r.unreadable).map((r) => r.id).sort();
  assert.deepEqual(unreadable, ["r_badmeta", "r_badreview", "r_badsession", "r_ssbroken"]);
  assert.equal(row(list, "r_badmeta").session_id, "s_old3", "placed by its review.json");
  assert.equal(row(list, "r_brief").unreadable, false);
});

test("a corrupt catalog.json gives no stars and a notice", async () => {
  const { reader, installed } = setup();
  fs.writeFileSync(path.join(installed.dir, "catalog.json"), "{ torn");
  const list = await reader.list(installed.nowMs);
  assert.equal(list.notice, "PROTO_CATALOG_UNREADABLE");
  assert.equal(rows(list).some((r) => r.starred), false);
});

test("stars come from catalog.json", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(list.notice, null);
  assert.equal(row(list, "r_brief").starred, true);
  assert.equal(row(list, "r_spec").starred, false);
});

// --- completeness and privacy -------------------------------------------------------

test("every review folder is listed once, counting folded_from (R1)", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  const ids = [];
  rows(list).forEach((r) => {
    ids.push(r.id);
    r.folded_from.forEach((id) => ids.push(id));
  });
  assert.equal(ids.length, installed.reviewDirs.length);
  assert.deepEqual(ids.slice().sort(), installed.reviewDirs);
});

test("a marker string in a fixture comment is absent from the list, and so is every review token", async () => {
  const { reader, installed } = setup();
  const text = JSON.stringify(await reader.list(installed.nowMs));
  assert.ok(fs.readFileSync(path.join(installed.dir, "reviews", "r_brief", "review.json"), "utf8").includes(fixture.MARKER));
  assert.equal(text.includes(fixture.MARKER), false);
  assert.equal(text.includes("fixture-token-"), false);
  assert.equal(text.includes(installed.root), false, "no absolute path from this machine");
});

// --- the committed list fixture -------------------------------------------------------

test("the reader's output equals test/fixtures/catalog_list.json", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  const text = JSON.stringify(list, null, 2) + "\n";
  if (process.env.LAHE_WRITE_CATALOG_LIST === "1") fs.writeFileSync(LIST_FIXTURE, text);
  assert.deepEqual(list, JSON.parse(fs.readFileSync(LIST_FIXTURE, "utf8")));
});

test("the committed list fixture covers every row kind and state the page draws", () => {
  const list = JSON.parse(fs.readFileSync(LIST_FIXTURE, "utf8"));
  const all = rows(list);
  const seen = (field) => new Set(all.map((r) => r[field]));
  ["yes", "via-agent", "missing"].forEach((v) => assert.ok(seen("openable").has(v), "openable " + v));
  ["static", "dev-server", "legacy", "worktree"].forEach((v) => assert.ok(seen("kind").has(v), "kind " + v));
  ["waiting", "done", "refused", "expired"].forEach((v) =>
    assert.ok(all.some((r) => r.request && r.request.state === v), "request " + v)
  );
  assert.ok(list.attached && list.attached.watching === true);
  assert.ok(all.some((r) => r.served_url), "being served now");
  assert.ok(all.some((r) => r.ended), "review ended");
  assert.ok(all.some((r) => r.starred), "starred");
  assert.ok(all.some((r) => r.unreadable), "unreadable");
  assert.ok(all.some((r) => r.folded_from.length > 0), "folded");
  assert.ok(all.some((r) => r.counts_as_of && r.counts_as_of < r.last), "stale counts");
  assert.ok(list.sessions.some((s) => s.watching && s.watching.session !== s.id), "watched by another agent");
  assert.ok(list.sessions.some((s) => s.name === null), "unnamed session");
});

// --- fix round (phase 7) -----------------------------------------------------

test("CX1: with every server answering, out of order, each row's served_url is its own server's port and path", async () => {
  // Every probe answers true, and later probes answer first, so a callback
  // that closed over a shared `row` or `cover` would write one row's URL onto
  // another.
  const installed = fixture.install();
  // Every record running, so several rows are probed in the one list.
  const sessionsRoot = path.join(installed.dir, "agent-sessions");
  fs.readdirSync(sessionsRoot).forEach((sessionId) => {
    const serversDir = path.join(sessionsRoot, sessionId, "static-servers");
    if (!fs.existsSync(serversDir)) return;
    fs.readdirSync(serversDir).forEach((name) => {
      const file = path.join(serversDir, name);
      let meta;
      try { meta = JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { return; }
      if (!meta || typeof meta !== "object") return;
      meta.stopped_at = null;
      fs.writeFileSync(file, JSON.stringify(meta, null, 2) + "\n");
    });
  });
  const waits = [];
  const probe = (meta) => new Promise((resolve) => { waits.push(() => resolve(true)); });
  const reader = catalogReader.createReader({ dir: installed.dir, home: installed.home, pidAlive: () => true, probe });
  const pending = reader.list(installed.nowMs);
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(waits.length >= 2, "at least two rows are probed, got " + waits.length);
  waits.slice().reverse().forEach((go) => go());
  const list = await pending;
  let served = 0;
  rows(list).forEach((r) => {
    if (!r.served_url) return;
    served += 1;
    const d = reader.describeReview(r.id, installed.nowMs);
    const record = staticServers.list(installed.dir, r.session_id).find((m) => m.id === d.server);
    assert.equal(r.served_url, "http://127.0.0.1:" + record.port + d.url_path, r.id);
  });
  const openableYes = rows(list).filter((r) => r.openable === "yes").length;
  assert.equal(served, openableYes, "every openable row got a URL");
  assert.ok(served >= 2, "several rows served, got " + served);
});

test("CR5: origin events an Open's swap appends do not move a review's last; the newest other event's time is its last", async () => {
  const { reader, installed } = setup();
  const log = path.join(installed.dir, "reviews", "r_spec", "events.jsonl");
  const events = fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
  const newestTs = events.map((e) => e.ts).sort().pop();
  const swapAt = new Date(installed.nowMs).toISOString();
  const origin = (event, port) => JSON.stringify({ event, event_id: "ev_swap_" + port, ts: swapAt, review: "r_spec", payload: { origin: "http://127.0.0.1:" + port } });
  fs.appendFileSync(log, origin("origin.registered", 5001) + "\n" + origin("origin.removed", 4321) + "\n");
  fs.utimesSync(log, new Date(installed.nowMs), new Date(installed.nowMs));
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_spec").last, newestTs);
  assert.equal(reader.describeReview("r_spec", installed.nowMs).last, newestTs, "the log line's age reads the same last");
});

test("an expired request's reason reaches the list, so the page can word attach_changed and a dead monitor apart", async () => {
  const catalogRequests = require("../../src/service/catalog_requests.js");
  const installed = fixture.install();
  const now = installed.nowMs;
  require("../../src/service/agent_sessions.js").createStore({ dir: installed.dir }).reopen("s_index");
  catalogRequests.writeAttach(installed.dir, "s_index", now - 5 * MINUTE);
  const queue = catalogRequests.createQueue({ dir: installed.dir, writeExpired: true, pidAlive: () => true, log: () => {} });
  queue.append({ action: "launch", review: "r_brief", session: "s_coach", for: "s_index" }, now - 2 * MINUTE);
  catalogRequests.writeAttach(installed.dir, "s_coach", now - MINUTE);
  const reader = catalogReader.createReader(Object.assign({
    dir: installed.dir, home: installed.home, pidAlive: () => true, probe: async () => false
  }, catalogReader.queueInputs(queue)));
  const list = await reader.list(now);
  assert.equal(row(list, "r_brief").request.state, "expired");
  assert.equal(row(list, "r_brief").request.reason, "attach_changed");
});

// --- phase 8: listening, working, or last active --------------------------------

function stampActivity(installed, sessionId, atMs) {
  const stateDir = require("../../src/service/state_dir.js");
  stateDir.writeAtomic(stateDir.activityPath(installed.dir, sessionId), JSON.stringify({ [protocol.MONITOR.ACTIVITY_FIELD.AT]: new Date(atMs).toISOString() }) + "\n");
}

test("phase 8: a live monitor is listening, and nothing is away", async () => {
  const { reader, installed } = setup();
  const s = session(await reader.list(installed.nowMs), "s_coach");
  assert.deepEqual(s.watching, { session: "s_coach", name: "coach activity", state: "listening", last_active: new Date(installed.nowMs - 10 * 1000).toISOString() });
  assert.equal(s.away, null);
});

test("phase 8: a stale monitor plus a lahe command inside WORKING_MS is working, with that command's time", async () => {
  const { reader, installed } = setup();
  const later = installed.nowMs + 10 * protocol.MONITOR.HEARTBEAT_FRESH_MS;
  stampActivity(installed, "s_coach", later - protocol.CATALOG.WORKING_MS);
  const s = session(await reader.list(later), "s_coach");
  assert.deepEqual(s.watching, { session: "s_coach", name: "coach activity", state: "working", last_active: new Date(later - protocol.CATALOG.WORKING_MS).toISOString() });
  assert.equal(s.away, null);
});

test("phase 8: a lahe command older than WORKING_MS is not watching: the agent is away, with its last active time", async () => {
  const { reader, installed } = setup();
  const later = installed.nowMs + 10 * protocol.MONITOR.HEARTBEAT_FRESH_MS;
  const commandAt = later - protocol.CATALOG.WORKING_MS - 1;
  stampActivity(installed, "s_coach", commandAt);
  const s = session(await reader.list(later), "s_coach");
  assert.equal(s.watching, null);
  assert.deepEqual(s.away, { session: "s_coach", name: "coach activity", last_active: new Date(commandAt).toISOString() });
  assert.equal(reader.describeReview("r_brief", later).watching, null, "Open reads the same answer");
});

test("phase 8: a stale heartbeat and no command is away since the heartbeat; no record at all is no agent", async () => {
  const { reader, installed } = setup();
  const list = await reader.list(installed.nowMs);
  assert.equal(session(list, "s_old3").watching, null);
  assert.deepEqual(session(list, "s_old3").away, { session: "s_old3", name: null, last_active: new Date(installed.nowMs - 10 * MINUTE).toISOString() });
  assert.equal(session(list, "s_dev").away, null);
  assert.equal(session(list, "s_dev").watching, null);
});

test("phase 8: a session watched from another session's monitor takes that agent's state", async () => {
  const { reader, installed, options } = setup();
  // s_ops's heartbeat names s_index. Both go stale; s_index's agent ran a
  // command a minute ago, so it is working, and s_ops says so.
  const later = installed.nowMs + 10 * protocol.MONITOR.HEARTBEAT_FRESH_MS;
  stampActivity(installed, "s_index", later - MINUTE);
  const s = session(await reader.list(later), "s_ops");
  assert.deepEqual(s.watching, { session: "s_index", name: "document index", state: "working", last_active: new Date(later - MINUTE).toISOString() });
  stampActivity(installed, "s_index", later - 5 * MINUTE);
  // A fresh reader, so the rewritten stamp is read rather than cached.
  const away = session(await catalogReader.createReader(options).list(later), "s_ops");
  assert.equal(away.watching, null);
  assert.deepEqual(away.away, { session: "s_index", name: "document index", last_active: new Date(later - 5 * MINUTE).toISOString() });
});

// --- `last` is the newest work event's own time, never a file's mtime ----------

function newestWorkTs(log) {
  const skip = ["origin.registered", "origin.removed", "page.visited"];
  return fs.readFileSync(log, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    .filter((e) => skip.indexOf(e.event) === -1).map((e) => e.ts).sort().pop();
}

test("last: a compacted log rewritten today keeps its old last, and the card's week split uses it", async () => {
  const { reader, installed } = setup();
  const log = path.join(installed.dir, "reviews", "r_spec", "events.jsonl");
  const before = newestWorkTs(log);
  // Compaction rewrites the log in place: same events, a new mtime, and two
  // housekeeping files beside it.
  fs.writeFileSync(log, fs.readFileSync(log, "utf8"));
  fs.writeFileSync(log + ".compacted-ids", "ev_x\n");
  fs.writeFileSync(log + ".pre-compact.gz", "");
  fs.utimesSync(log, new Date(installed.nowMs), new Date(installed.nowMs));
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_spec").last, before);
  assert.ok(Date.parse(before) < installed.nowMs - protocol.CATALOG.POLL_MS, "the fixture's newest event is old");
  assert.equal(row(list, "r_spec").counts_as_of, before, "counts are as of the same last");
  assert.equal(reader.describeReview("r_spec", installed.nowMs).last, before);
});

test("last: a review whose every file is new but whose newest event is from August says August", async () => {
  const { reader, installed } = setup();
  const log = path.join(installed.dir, "reviews", "r_mounted", "events.jsonl");
  const events = fs.readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const august = "2026-08-18T05:00:03.270Z";
  events.forEach((e) => { e.ts = august; });
  fs.writeFileSync(log, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  // A reviewer's visit is not work on the document.
  fs.appendFileSync(log, JSON.stringify({ event: "page.visited", event_id: "ev_visit", ts: new Date(installed.nowMs).toISOString(), review: "r_mounted" }) + "\n");
  const rj = path.join(installed.dir, "reviews", "r_mounted", "review.json");
  fs.utimesSync(log, new Date(installed.nowMs), new Date(installed.nowMs));
  fs.utimesSync(rj, new Date(installed.nowMs), new Date(installed.nowMs));
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_mounted").last, august);
});

test("last: with no readable event, it is review.json's generated time, else meta created_at, never an mtime", async () => {
  const { reader, installed } = setup();
  const log = path.join(installed.dir, "reviews", "r_mounted", "events.jsonl");
  fs.writeFileSync(log, "{ torn\n");
  fs.utimesSync(log, new Date(installed.nowMs), new Date(installed.nowMs));
  const rj = JSON.parse(fs.readFileSync(path.join(installed.dir, "reviews", "r_mounted", "review.json"), "utf8"));
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_mounted").last, new Date(Date.parse(rj.generated_at)).toISOString());

  const meta = JSON.parse(fs.readFileSync(path.join(installed.dir, "reviews", "r_notitle", "meta.json"), "utf8"));
  const log2 = path.join(installed.dir, "reviews", "r_notitle", "events.jsonl");
  fs.writeFileSync(log2, "");
  fs.utimesSync(log2, new Date(installed.nowMs), new Date(installed.nowMs));
  // r_notitle has no review.json at all.
  const again = await reader.list(installed.nowMs);
  assert.equal(row(again, "r_notitle").last, new Date(Date.parse(meta.created_at)).toISOString());
});

// --- project labels for files under a .claude folder ---------------------------

function extraReview(installed, id, target) {
  const reviewsModule = require("../../src/service/reviews.js");
  const logModule = require("../../src/service/log.js");
  reviewsModule.createReviews({ dir: installed.dir, log: logModule.createEventLog({ dir: installed.dir }) }).create({ id, agent_session_id: "s_coach", target_path: target });
}

test("project: a file under ~/.claude, itself a git repository, is labelled claude config, not .claude", async () => {
  const { reader, installed } = setup();
  const skill = path.join(installed.home, ".claude", "skills", "crucible", "SKILL.md");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.mkdirSync(path.join(installed.home, ".claude", ".git"));
  fs.writeFileSync(skill, "# Crucible\n");
  extraReview(installed, "r_skill", skill);
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_skill").project, "claude config");
});

test("project: a worktree under <repo>/.claude/worktrees is labelled with the repo's name, even with no .git to read", async () => {
  const { reader, installed } = setup();
  const doc = path.join(installed.home, "projects", "gamma", ".claude", "worktrees", "wt-x", "docs", "brief.html");
  fs.mkdirSync(path.dirname(doc), { recursive: true });
  fs.writeFileSync(doc, "<!doctype html><title>x</title>");
  extraReview(installed, "r_gamma", doc);
  const list = await reader.list(installed.nowMs);
  assert.equal(row(list, "r_gamma").project, "gamma");
});
