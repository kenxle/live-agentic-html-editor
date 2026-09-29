#!/usr/bin/env node
// Writes test/fixtures/catalog_state/, the Library reader's committed state dir.
//
// LAHE Library plan, Task 1.1. Run it only to change the fixture:
//
//   node test/fixtures/catalog_state_build.js
//
// It writes files and never removes any, so a file dropped from the list below
// has to be removed by hand. The events and review.json files are made by the
// real record, event and projection code, so the reader is tested against the
// shapes the helper really writes.
//
// THE COMMITTED TREE IS NOT A STATE DIR YET. Three things cannot be committed
// as they will be read, and test/fixtures/catalog_state.js puts them right when
// it copies the tree into a temporary directory:
//
//   ${ROOT}      absolute paths inside JSON are written as ${ROOT}/..., and the
//                install puts the temporary directory there
//   dot-<name>   a path segment spelled dot-git or dot-claude becomes .git or
//                .claude, because a real .git inside this repository is not a
//                file git will commit
//   mtimes.json  every file's modified time, set with fs.utimesSync, because
//                git does not keep modified times and the reader's `last`,
//                staleness and fold rules all read them
//
// One review's log is over REPROJECT_MAX_BYTES. The install makes it so by
// extending the file (fs.truncateSync), rather than committing 5 MB of bytes
// nobody will ever read.
//
// Every name here is synthetic. The repository is public.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../../src/shared/protocol.js");
var record = require("../../src/shared/record.js");
var reviewFormat = require("../../src/shared/review_format.js");
var projection = require("../../src/service/projection.js");

var OUT = path.join(__dirname, "catalog_state");
var STATE = "state";
var HOME = "home";

var CUTOFF_MS = Date.parse(protocol.CATALOG.FOLD_CUTOFF);
var MINUTE = 60 * 1000;
var DAY = 24 * 60 * MINUTE;

function iso(ms) {
  return new Date(ms).toISOString();
}

var NOW_MS = Date.parse("2026-09-28T16:00:00.000Z");
var MARKER = "MARKER-7f3c-comment-text-never-listed";

var mtimes = {};

function write(rel, contents, mtime) {
  var file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  if (mtime) mtimes[rel] = mtime;
}

function json(value) {
  return JSON.stringify(value, null, 2) + "\n";
}

function home(rel) {
  return "${ROOT}/" + HOME + "/" + rel;
}

// ---------------------------------------------------------------------------
// The documents on disk
// ---------------------------------------------------------------------------

function page(title) {
  return "<!doctype html>\n<title>" + title + "</title>\n<p>" + title + "</p>\n";
}

var docs = {
  "projects/alpha/docs/brief.html": "Brief",
  "projects/alpha/docs/notes.md": null,
  "projects/alpha/shared/figure.html": "Figure",
  "projects/alpha/old-pages/p1.html": "Page One",
  "projects/alpha/old-pages/p2.html": "Page Two",
  "projects/alpha/old-pages/p3.html": "Page Three",
  "projects/alpha/old-pages/p4.html": "Page Four",
  "projects/alpha/old-pages/p5.html": "Page Five",
  "projects/alpha/other/x.html": "Other",
  "projects/alpha/dot-claude/worktrees/wt-live/page.html": "Worktree Page",
  "projects/beta/specs/spec.html": "Spec",
  "loose/shared.html": "Shared",
  "loose/big.html": "Big",
  "loose/stale.html": "Stale",
  "loose/untitled.html": "Untitled",
  "loose/b.html": "B",
  "loose/c.html": "C",
  "loose/legacy.html": "Legacy",
  "loose/meta.html": "Meta",
  "loose/review.html": "Review"
};
Object.keys(docs).forEach(function (rel) {
  write(path.join(HOME, rel), docs[rel] === null ? "# Coach notes\n\nSome notes.\n" : page(docs[rel]));
});
// Repository markers. A .git directory for the two repositories, and a .git
// FILE for the live worktree, the way `git worktree add` leaves one.
write(path.join(HOME, "projects/alpha/dot-git/HEAD"), "ref: refs/heads/main\n");
write(path.join(HOME, "projects/beta/dot-git/HEAD"), "ref: refs/heads/main\n");
write(
  path.join(HOME, "projects/alpha/dot-claude/worktrees/wt-live/dot-git"),
  "gitdir: " + home("projects/alpha/.git/worktrees/wt-live") + "\n"
);
// The Markdown review's rendered page lives in the state dir, like the real one.
write(
  path.join(STATE, "agent-sessions/s_coach/review-artifacts/notes1/notes.html"),
  page("Coach Notes")
);

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

function session(id, name, createdMs) {
  var body = { schema: 1, id: id, created_at: iso(createdMs), closed_at: iso(createdMs + DAY), handoff_rev: 0 };
  if (name) body.name = name;
  write(path.join(STATE, "agent-sessions", id, "session.json"), json(body));
}

function monitor(id, atMs, primary) {
  var beat = {};
  beat[protocol.MONITOR.HEARTBEAT_FIELD.PID] = 424242;
  beat[protocol.MONITOR.HEARTBEAT_FIELD.HANDOFF_REV] = 0;
  beat[protocol.MONITOR.HEARTBEAT_FIELD.AT] = iso(atMs);
  beat[protocol.MONITOR.HEARTBEAT_FIELD.PRIMARY] = primary;
  write(path.join(STATE, "agent-sessions", id, protocol.MONITOR.HEARTBEAT_FILE), json(beat));
}

function server(sessionId, id, root, opts) {
  var o = opts || {};
  write(
    path.join(STATE, "agent-sessions", sessionId, "static-servers", id + ".json"),
    json({
      schema: 1,
      id: id,
      session_id: sessionId,
      instance: "inst_" + id,
      root: root,
      logical_root: root,
      host: protocol.DEFAULT_HOST,
      port: o.port,
      pid: 515151,
      started_at: "2026-09-20T10:00:00.000Z",
      stopped_at: o.live ? null : "2026-09-21T10:00:00.000Z",
      mounts: o.mounts || {}
    })
  );
}

session("s_coach", "coach activity", NOW_MS - 10 * DAY);
session("s_ops", "ops fixes", CUTOFF_MS - 5 * DAY);
session("s_old3", null, CUTOFF_MS - 4 * DAY);
session("s_dev", "app dev", NOW_MS - 3 * DAY);
session("s_ssbroken", "broken server record", NOW_MS - 3 * DAY);
session("s_index", "document index", NOW_MS - DAY);
write(path.join(STATE, "agent-sessions/s_badsession/session.json"), "{ this session file is torn");

// Heartbeats. The reader is handed a pidAlive that says yes, so freshness is
// decided by `at` alone: 10 seconds is fresh, 10 minutes is stale.
monitor("s_coach", NOW_MS - 10 * 1000, "s_coach");
monitor("s_ops", NOW_MS - 10 * 1000, "s_index");
monitor("s_old3", NOW_MS - 10 * MINUTE, "s_old3");
monitor("s_index", NOW_MS - 10 * 1000, "s_index");

server("s_coach", "ss_alphadocs", home("projects/alpha/docs"), { port: 54010 });
server("s_coach", "ss_beta", home("projects/beta/specs"), { port: 54011, live: true });
server("s_coach", "ss_notes", "${ROOT}/" + STATE + "/agent-sessions/s_coach/review-artifacts/notes1", {
  port: 54012,
  mounts: { "/.lahe-source/ab12cd/": home("projects/alpha/shared") }
});
server("s_ops", "ss_oldpages", home("projects/alpha/old-pages"), { port: 54020 });
server("s_ops", "ss_other", home("projects/alpha/other"), { port: 54021 });
server("s_ops", "ss_wtlive", home("projects/alpha/.claude/worktrees/wt-live"), { port: 54022 });
server("s_ops", "ss_wtgone", home("projects/alpha/.claude/worktrees/wt-gone/docs"), { port: 54023 });
server("s_old3", "ss_old3pages", home("projects/alpha/old-pages"), { port: 54030 });
server("s_old3", "ss_loose", home("loose"), { port: 54031 });
server("s_ssbroken", "ss_fine", home("loose/nowhere-else"), { port: 54040 });
write(path.join(STATE, "agent-sessions/s_ssbroken/static-servers/ss_broken.json"), "{ torn server record");
server("s_badsession", "ss_badsession", home("loose"), { port: 54050 });

// ---------------------------------------------------------------------------
// Reviews
// ---------------------------------------------------------------------------

var eventCount = 0;

function eventId() {
  eventCount += 1;
  return "ev_fixture_" + eventCount;
}

function item(reviewId, n, state, title, atMs) {
  return record.newItem({
    id: "itm_" + reviewId + "_" + n,
    kind: record.KIND.COMMENT,
    state: state,
    note: MARKER + " comment " + n + " on " + reviewId,
    page_origin: "http://127.0.0.1:4321",
    page_path: "/",
    page_title: title,
    page_seq: 1,
    created_at: iso(atMs),
    updated_at: iso(atMs)
  });
}

/**
 * One review: meta.json, events.jsonl, and (unless `noReviewJson`) a
 * review.json projected from the events that existed when it was written.
 */
function review(id, spec) {
  var created = spec.createdMs;
  var dirRel = path.join(STATE, "reviews", id);
  var meta = {
    id: id,
    token: "fixture-token-" + id + "-not-a-secret",
    origins: spec.origins || ["http://127.0.0.1:" + (spec.port || 54000)],
    target_path: spec.target,
    target_paths: spec.target ? [spec.target] : [],
    source_path: spec.source || null,
    only_recorded_pages: false,
    created_at: iso(created)
  };
  if (spec.session) meta.agent_session_id = spec.session;
  write(path.join(dirRel, "meta.json"), spec.badMeta ? "{ torn meta" : json(meta));

  var seq = 0;
  function ev(fields) {
    seq += 1;
    return protocol.newEvent(Object.assign({ event_id: eventId(), review: id, seq: seq }, fields));
  }
  // The Library's `last` is the newest work event's own time, so the newest
  // event is stamped `lastMs`: the archive for an ended review, else the last
  // comment, else (no comments) the review's creation event.
  var items0 = (spec.items || []).length;
  var events = [
    ev({
      event: protocol.EVENT.REVIEW_CREATED,
      ts: iso(!spec.ended && items0 === 0 ? spec.lastMs : created),
      payload: { token: meta.token, agent_session_id: spec.session || "legacy" }
    })
  ];
  var items = [];
  (spec.items || []).forEach(function (state, n) {
    var at = !spec.ended && n === items0 - 1 ? spec.lastMs : created + (n + 1) * MINUTE;
    var it = item(id, n + 1, state, spec.title, at);
    items.push(it);
    events.push(
      ev({
        event: protocol.EVENT.ITEM_READY,
        ts: iso(at),
        item: it[record.FIELD.ID],
        rev: it[record.FIELD.REV],
        page_path: "/",
        page_title: spec.title,
        page_seq: 1,
        payload: { draft: false, record: it }
      })
    );
  });
  if (spec.ended) {
    events.push(ev({ event: protocol.EVENT.REVIEW_ARCHIVED, ts: iso(spec.lastMs) }));
  }
  // review.json is written from the first `projectedEvents` events; a stale one
  // leaves some out, so the log is newer than the projection.
  var projectedEvents = typeof spec.projectedEvents === "number" ? events.slice(0, spec.projectedEvents) : events;
  if (!spec.noReviewJson) {
    var projected = projection.project(id, projectedEvents, { generated_at: iso(spec.reviewJsonMs) });
    write(
      path.join(dirRel, "review.json"),
      spec.badReview ? "{ torn review" : reviewFormat.stringifyReview(projected),
      iso(spec.reviewJsonMs)
    );
  }
  write(
    path.join(dirRel, "events.jsonl"),
    events.map(function (e) { return JSON.stringify(e); }).join("\n") + "\n",
    iso(spec.lastMs)
  );
}

var H = record.STATE.HANDLED;
var W = record.STATE.READY;

// s_coach: two projects, a served review, a Markdown review, a mount, a missing file.
review("r_brief", {
  session: "s_coach", target: home("projects/alpha/docs/brief.html"), title: "Feature Brief: Coach Activity",
  items: [W, W, W, H, H], createdMs: NOW_MS - 9 * DAY, lastMs: NOW_MS - 20 * MINUTE, reviewJsonMs: NOW_MS - 20 * MINUTE
});
review("r_spec", {
  session: "s_coach", target: home("projects/beta/specs/spec.html"), title: "Shared Title",
  items: [H], createdMs: NOW_MS - 8 * DAY, lastMs: NOW_MS - 2 * DAY, reviewJsonMs: NOW_MS - 2 * DAY
});
review("r_notes", {
  session: "s_coach",
  target: "${ROOT}/" + STATE + "/agent-sessions/s_coach/review-artifacts/notes1/notes.html",
  source: home("projects/alpha/docs/notes.md"), title: "Coach Notes", ended: true,
  items: [H, H], createdMs: NOW_MS - 7 * DAY, lastMs: NOW_MS - 3 * DAY, reviewJsonMs: NOW_MS - 3 * DAY
});
review("r_deleted", {
  session: "s_coach", target: home("projects/alpha/docs/deleted.html"), title: "Deleted Page",
  items: [W], createdMs: NOW_MS - 9 * DAY, lastMs: NOW_MS - 6 * DAY, reviewJsonMs: NOW_MS - 6 * DAY
});
review("r_mounted", {
  session: "s_coach", target: home("projects/alpha/shared/figure.html"), title: "Figure",
  items: [], createdMs: NOW_MS - 7 * DAY, lastMs: NOW_MS - 4 * DAY, reviewJsonMs: NOW_MS - 4 * DAY
});

// s_ops: the fold, its negatives, and the worktrees.
review("r_old1", {
  session: "s_ops", target: home("projects/alpha/old-pages/p1.html"), title: "Page One",
  items: [W, H], createdMs: CUTOFF_MS - 3 * DAY, lastMs: CUTOFF_MS - 3 * DAY + HOUR(), reviewJsonMs: CUTOFF_MS - 3 * DAY + HOUR()
});
review("r_old2", {
  session: "s_ops", target: home("projects/alpha/old-pages/p2.html"), title: "Page Two",
  items: [H], createdMs: CUTOFF_MS - MINUTE, lastMs: CUTOFF_MS + 2 * DAY, reviewJsonMs: CUTOFF_MS + 2 * DAY
});
review("r_old3", {
  session: "s_ops", target: home("projects/alpha/old-pages/p3.html"), title: "Page Three",
  items: [W, W, H], createdMs: CUTOFF_MS - 2 * DAY, lastMs: CUTOFF_MS - 2 * DAY + HOUR(), reviewJsonMs: CUTOFF_MS - 2 * DAY + HOUR()
});
review("r_old4", {
  session: "s_ops", target: home("projects/alpha/old-pages/p4.html"), title: "Page Four",
  items: [W], createdMs: CUTOFF_MS + MINUTE, lastMs: CUTOFF_MS + 3 * DAY, reviewJsonMs: CUTOFF_MS + 3 * DAY
});
review("r_oldfolder", {
  session: "s_ops", target: home("projects/alpha/old-pages"), title: "Old Pages Site",
  items: [], createdMs: CUTOFF_MS - 4 * DAY, lastMs: CUTOFF_MS - 4 * DAY + HOUR(), reviewJsonMs: CUTOFF_MS - 4 * DAY + HOUR()
});
review("r_other", {
  session: "s_ops", target: home("projects/alpha/other/x.html"), title: "Other Page",
  items: [], createdMs: CUTOFF_MS - 3 * DAY, lastMs: CUTOFF_MS - 3 * DAY + HOUR(), reviewJsonMs: CUTOFF_MS - 3 * DAY + HOUR()
});
review("r_wt_gone", {
  session: "s_ops", target: home("projects/alpha/.claude/worktrees/wt-gone/docs/brief.html"), title: "Worktree Brief",
  items: [W], createdMs: NOW_MS - 5 * DAY, lastMs: NOW_MS - 5 * DAY + HOUR(), reviewJsonMs: NOW_MS - 5 * DAY + HOUR()
});
review("r_wt_vanished", {
  session: "s_ops", target: home("projects/alpha/.claude/worktrees/wt-gone/docs/vanished.html"), title: "Vanished Page",
  items: [], createdMs: NOW_MS - 5 * DAY, lastMs: NOW_MS - 5 * DAY + 2 * HOUR(), reviewJsonMs: NOW_MS - 5 * DAY + 2 * HOUR()
});
review("r_wt_live", {
  session: "s_ops", target: home("projects/alpha/.claude/worktrees/wt-live/page.html"), title: "Worktree Page",
  items: [], createdMs: NOW_MS - 4 * DAY, lastMs: NOW_MS - 4 * DAY + HOUR(), reviewJsonMs: NOW_MS - 4 * DAY + HOUR()
});

// s_old3: unnamed, stale heartbeat; a second session in the fold folder; the
// shared title, the stale and oversized logs, no review.json, corrupt files.
review("r_s3page", {
  session: "s_old3", target: home("projects/alpha/old-pages/p5.html"), title: "Page Five",
  items: [], createdMs: CUTOFF_MS - 2 * DAY, lastMs: CUTOFF_MS - 2 * DAY + HOUR(), reviewJsonMs: CUTOFF_MS - 2 * DAY + HOUR()
});
review("r_shared", {
  session: "s_old3", target: home("loose/shared.html"), title: "Shared Title",
  items: [H], createdMs: NOW_MS - 10 * DAY, lastMs: NOW_MS - 9 * DAY, reviewJsonMs: NOW_MS - 9 * DAY
});
review("r_big", {
  session: "s_old3", target: home("loose/big.html"), title: "Big Log",
  items: [W, W], projectedEvents: 2,
  createdMs: NOW_MS - 10 * DAY, lastMs: NOW_MS - 8 * DAY, reviewJsonMs: NOW_MS - 9 * DAY
});
review("r_stale", {
  session: "s_old3", target: home("loose/stale.html"), title: "Stale Projection",
  items: [W, W], projectedEvents: 1,
  createdMs: NOW_MS - 10 * DAY, lastMs: NOW_MS - 8 * DAY + HOUR(), reviewJsonMs: NOW_MS - 9 * DAY
});
review("r_notitle", {
  session: "s_old3", target: home("loose/untitled.html"), title: null, noReviewJson: true,
  items: [], createdMs: NOW_MS - 10 * DAY, lastMs: NOW_MS - 10 * DAY + HOUR()
});
review("r_badmeta", {
  session: "s_old3", target: home("loose/meta.html"), title: "Torn Meta", badMeta: true,
  items: [], createdMs: NOW_MS - 10 * DAY, lastMs: NOW_MS - 10 * DAY + 2 * HOUR(), reviewJsonMs: NOW_MS - 10 * DAY + 2 * HOUR()
});
review("r_badreview", {
  session: "s_old3", target: home("loose/review.html"), title: "Torn Review", badReview: true,
  items: [], createdMs: NOW_MS - 10 * DAY, lastMs: NOW_MS - 10 * DAY + 3 * HOUR(), reviewJsonMs: NOW_MS - 10 * DAY + 3 * HOUR()
});

// s_dev: a dev-server review. s_ssbroken: a corrupt server record. s_badsession:
// a corrupt session.json. And one legacy review with no session at all.
review("r_dev", {
  session: "s_dev", target: home("projects/beta"), title: "App Home",
  origins: ["http://localhost:3000"],
  items: [W], createdMs: NOW_MS - 2 * DAY, lastMs: NOW_MS - DAY, reviewJsonMs: NOW_MS - DAY
});
review("r_ssbroken", {
  session: "s_ssbroken", target: home("loose/c.html"), title: "Server Record Torn",
  items: [], createdMs: NOW_MS - 2 * DAY, lastMs: NOW_MS - 2 * DAY + HOUR(), reviewJsonMs: NOW_MS - 2 * DAY + HOUR()
});
review("r_badsession", {
  session: "s_badsession", target: home("loose/b.html"), title: "Session Torn",
  items: [], createdMs: NOW_MS - 2 * DAY, lastMs: NOW_MS - 2 * DAY + HOUR(), reviewJsonMs: NOW_MS - 2 * DAY + HOUR()
});
review("r_legacy", {
  session: null, target: home("loose/legacy.html"), title: "Legacy Page",
  items: [W], createdMs: NOW_MS - 20 * DAY, lastMs: NOW_MS - 19 * DAY, reviewJsonMs: NOW_MS - 19 * DAY
});

function HOUR() {
  return 60 * MINUTE;
}

// Stars: the newest review, and an OLDER review inside the fold (its star
// still shows on the folded row).
write(
  path.join(STATE, "catalog.json"),
  json({
    schema: 1,
    stars: { r_brief: iso(NOW_MS - DAY), r_old1: iso(NOW_MS - 2 * DAY) },
    reopened: {}
  })
);

write("mtimes.json", json(mtimes));
process.stdout.write("wrote " + OUT + " (" + Object.keys(mtimes).length + " modified times)\n");
