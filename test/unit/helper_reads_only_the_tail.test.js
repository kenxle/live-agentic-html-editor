// Nothing reads the whole event log twice.
//
// Owner: 3A. The brief is
// docs/features/20260916.03_helper_lazy_projection/01_spec_lazy_projection.md.
// Making the projector fold incrementally only helps if the callers around it
// stop doing from the top what it just stopped doing: `review.read` folded the
// whole log twice on every page load and every `lahe status`, the reply poll
// folded it again to count outstanding work, and the reply folder folded it
// once per accepted reply line.
//
// HOW THESE TESTS BITE. After the first fold has happened, two doors are shut:
// `log.read`, which the projector and the routes call, AND `fs.readFileSync` on
// that review's events.jsonl, which is the door log.since's own from-the-top
// branch goes through and which a stub on the log object cannot see. Either one
// being opened fails the test, so a path that is merely slow rather than wrong
// still shows up. The projector holds the same log OBJECT the test does, and
// the call is a property lookup, so the replacement reaches it.
//
// The bar is not "it answered". It is "it answered with what a full read would
// have produced", so each test compares against a projection built the
// from-the-top way over the same directory.
//
// The second half of the file is the opposite case: a log that is NOT a
// continuation of what the reader scanned, where the right answer is to throw
// the fold away and start over. Those tests compare the bytes of review.json
// with what `regenerate` writes, because "start over" has to land exactly where
// never having started would have.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const stateDir = require("../../src/service/state_dir.js");
const routes = require("../../src/service/routes.js");
const projectionModule = require("../../src/service/projection.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");

let counter = 0;
function eventId() {
  counter += 1;
  return "evt_tail_" + counter;
}

/**
 * One state directory, one log, one review.
 *
 * A directory per test on purpose: the projector is shared per state directory,
 * so two tests sharing one would share folds and prove less than they look like
 * they prove.
 */
function fixture(reviewId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-tail-"));
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  reviews.create({ id: reviewId, origins: ["null"], agent_session_id: "s_tail" });
  const deps = { log: log, reviews: reviews, projection: projectionModule };
  return { dir, log, reviews, deps, review: reviewId };
}

function itemOf(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "the reviewer's own words",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/p.html",
        page_title: "Page",
        page_seq: 1
      },
      overrides || {}
    )
  );
}

function post(f, item, type) {
  f.log.append(f.review, [
    protocol.newEvent({
      event: type || (record.isDraft(item) ? protocol.EVENT.ITEM_CREATED : protocol.EVENT.ITEM_READY),
      event_id: eventId(),
      review: f.review,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: record.isDraft(item), record: item }
    })
  ]);
  return item;
}

/**
 * Shut both doors to the whole log, and remember anything that knocked.
 *
 * `log.read` is the one the projector and the routes call. `fs.readFileSync` on
 * this review's events.jsonl is the one log.since's own from-the-top branch
 * uses, and no stub on the log object can see it, because that call is to a
 * function closed over inside the module.
 *
 * Always paired with restore() in a finally: fs is a global, and a test that
 * throws while holding it would take the rest of the file with it.
 */
function forbidWholeReads(f) {
  const knocks = [];
  const eventsPath = stateDir.eventsPath(f.dir, f.review);
  const realLogRead = f.log.read;
  const realReadFileSync = fs.readFileSync;

  f.log.read = function (reviewId) {
    knocks.push("log.read(" + reviewId + ")");
    throw new Error("log.read: the whole log must not be read again");
  };
  fs.readFileSync = function (target) {
    if (String(target) === eventsPath) {
      knocks.push("fs.readFileSync(" + target + ")");
      throw new Error("fs.readFileSync: the whole log must not be read again");
    }
    return realReadFileSync.apply(fs, arguments);
  };

  return {
    knocks: knocks,
    restore: function () {
      f.log.read = realLogRead;
      fs.readFileSync = realReadFileSync;
    }
  };
}

/** What a from-the-top fold says right now, read through a separate log. */
function fromTheTop(f) {
  const fresh = logModule.createEventLog({ dir: f.dir });
  return projectionModule.project(f.review, fresh.read(f.review), { generated_at: "pinned" });
}

function pagesOf(projected) {
  return JSON.stringify(projected.pages);
}

function stripGeneratedAt(text) {
  return text.replace(/"generated_at": "[^"]*"/, '"generated_at": "pinned"');
}

/** The review.json the projector wrote. */
function onDisk(f) {
  return stripGeneratedAt(fs.readFileSync(stateDir.reviewJsonPath(f.dir, f.review), "utf8"));
}

/**
 * The review.json a from-the-top rebuild writes for the same log bytes.
 *
 * In its own directory, through projection.regenerate, so this is the real
 * reference path rather than a re-implementation of it.
 */
function regenerated(f) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-regen-"));
  stateDir.ensureReviewDir(dir, f.review);
  fs.copyFileSync(stateDir.eventsPath(f.dir, f.review), stateDir.eventsPath(dir, f.review));
  const log = logModule.createEventLog({ dir: dir });
  projectionModule.regenerate({ dir: dir, log: log, review: f.review });
  return stripGeneratedAt(fs.readFileSync(stateDir.reviewJsonPath(dir, f.review), "utf8"));
}

function rewrite(f, lines) {
  fs.writeFileSync(stateDir.eventsPath(f.dir, f.review), lines.join("\n") + "\n", { mode: 0o600 });
}

function linesOf(f) {
  return fs
    .readFileSync(stateDir.eventsPath(f.dir, f.review), "utf8")
    .split("\n")
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// review.read
// ---------------------------------------------------------------------------

test("review.read answers off the kept fold, and says exactly what a full read would", () => {
  const f = fixture("rtail0000000001");
  post(f, itemOf({ id: "itm_first", note: "the first comment" }));
  post(f, itemOf({ id: "itm_draft1", state: record.STATE.DRAFT, note: "half a thought" }));

  const read = routes.handlerFor("review.read");
  const warm = read({ review: f.review, query: {} }, f.deps);
  assert.equal(warm.status, 200);
  assert.equal(warm.body.draft_count, 1);

  // Everything after this point has to come off the fold.
  const guard = forbidWholeReads(f);
  let answer;
  try {
    post(f, itemOf({ id: "itm_second", note: "the second comment" }));
    post(f, itemOf({ id: "itm_draft2", state: record.STATE.DRAFT, note: "still typing" }));
    answer = read({ review: f.review, query: {} }, f.deps);
  } finally {
    guard.restore();
  }
  assert.deepEqual(guard.knocks, [], "nothing asked for the whole log");
  assert.equal(answer.status, 200);
  assert.equal(answer.body.draft_count, 2, "the draft count comes off the same fold, not a second pass");
  assert.equal(pagesOf(answer.body), pagesOf(fromTheTop(f)), "and the items are what folding from the top gives");

  const notes = [];
  (answer.body.pages || []).forEach((page) => page.items.forEach((item) => notes.push(item.note)));
  assert.deepEqual(notes, ["the first comment", "the second comment"]);
  assert.equal(JSON.stringify(answer.body).indexOf("half a thought"), -1, "and drafts are still withheld (R7)");
});

test("review.read still answers when there is no projector to ask", () => {
  // The fallback is the from-the-top read, which is the right answer and the
  // expensive one. A caller handing in a partial projection module gets it.
  const f = fixture("rtail0000000002");
  post(f, itemOf({ id: "itm_only", note: "one comment" }));

  const partial = {
    project: projectionModule.project,
    itemsFrom: projectionModule.itemsFrom
  };
  const answer = routes.handlerFor("review.read")(
    { review: f.review, query: {} },
    { log: f.log, reviews: f.reviews, projection: partial }
  );
  assert.equal(answer.status, 200);
  assert.equal(pagesOf(answer.body), pagesOf(fromTheTop(f)));
});

// ---------------------------------------------------------------------------
// The reply poll's outstanding-work count
// ---------------------------------------------------------------------------

test("the reply poll counts outstanding work off the kept fold", () => {
  const f = fixture("rtail0000000003");
  const agentSessions = require("../../src/service/agent_sessions.js").createStore({ dir: f.dir });
  agentSessions.create({ id: "s_tail" });
  f.deps.agentSessions = agentSessions;

  post(f, itemOf({ id: "itm_work1", note: "one thing" }));
  const poll = routes.handlerFor("replies.poll");
  assert.equal(poll({ review: f.review, query: { since: 0 } }, f.deps).body.agent_liveness.unanswered, 1);

  const guard = forbidWholeReads(f);
  let answer;
  try {
    post(f, itemOf({ id: "itm_work2", note: "a second thing" }));
    post(f, itemOf({ id: "itm_work3", note: "a third thing" }));
    answer = poll({ review: f.review, query: { since: 0 } }, f.deps);
  } finally {
    guard.restore();
  }
  assert.deepEqual(guard.knocks, [], "nothing asked for the whole log");
  assert.equal(answer.body.agent_liveness.unanswered, 3);
});

test("the page's poll, an event behind, is answered without reading the log", () => {
  // The ordinary shape of a session, and the one that was still costing a whole
  // read per event: the library posts an event, the events.append route ticks
  // the projector (which moves the reader's cursor PAST that event), and only
  // then does the page poll with the cursor IT last saw, which is now one
  // behind. That cursor had nowhere to be answered from but the top of the
  // file, so a 5,000-event review re-read 5,000 events to hand back one.
  const f = fixture("rtail0000000008");
  const agentSessions = require("../../src/service/agent_sessions.js").createStore({ dir: f.dir });
  agentSessions.create({ id: "s_tail" });
  f.deps.agentSessions = agentSessions;

  for (let i = 0; i < 20; i += 1) post(f, itemOf({ id: "itm_warm_" + i, note: "warming up " + i }));
  const poll = routes.handlerFor("replies.poll");
  const append = routes.handlerFor("events.append");
  poll({ review: f.review, query: { since: 0 } }, f.deps);

  let browserCursor = f.log.currentSeq(f.review);
  const guard = forbidWholeReads(f);
  const rounds = [];
  try {
    for (let round = 0; round < 5; round += 1) {
      const item = itemOf({ id: "itm_round_" + round, note: "round " + round });
      append(
        {
          review: f.review,
          query: {},
          body: {
            events: [
              protocol.newEvent({
                event: protocol.EVENT.ITEM_READY,
                event_id: eventId(),
                review: f.review,
                item: item[record.FIELD.ID],
                rev: item[record.FIELD.REV],
                page_path: item[record.FIELD.PAGE_PATH],
                page_title: item[record.FIELD.PAGE_TITLE],
                page_seq: item[record.FIELD.PAGE_SEQ],
                payload: { draft: false, record: item }
              })
            ]
          }
        },
        f.deps
      );
      const answer = poll({ review: f.review, query: { since: browserCursor } }, f.deps);
      rounds.push(answer.body.seq);
      browserCursor = answer.body.seq;
    }
  } finally {
    guard.restore();
  }
  assert.deepEqual(guard.knocks, [], "five events, five polls, and the log was never read whole");
  assert.equal(rounds.length, 5);
  assert.equal(browserCursor, f.log.currentSeq(f.review), "and the page's cursor kept up");
});

// ---------------------------------------------------------------------------
// The reply folder
// ---------------------------------------------------------------------------

test("the reply folder finds the item in the kept fold, not in a fresh read of the log", () => {
  const f = fixture("rtail0000000004");
  const item = post(f, itemOf({ id: "itm_reply", note: "shorten the heading" }));
  projectionModule.startWatching(f.deps, [f.review]);

  const guard = forbidWholeReads(f);
  let ticked;
  try {
    fs.writeFileSync(
      stateDir.replyFilePath(f.dir, f.review, "replies-claude.jsonl"),
      JSON.stringify({ item: item.id, rev: 1, status: "handled", agent: "claude" }) + "\n",
      { mode: 0o600 }
    );
    ticked = projectionModule.tickReview(f.deps, f.review);
  } finally {
    guard.restore();
  }

  assert.deepEqual(guard.knocks, [], "nothing asked for the whole log");
  assert.equal(ticked.wrote, true);
  assert.equal(ticked.summary.accepted.length, 1);

  const parsed = JSON.parse(fs.readFileSync(stateDir.reviewJsonPath(f.dir, f.review), "utf8"));
  const items = [];
  (parsed.pages || []).forEach((page) => page.items.forEach((each) => items.push(each)));
  assert.equal(items[0].state, "handled");
  assert.equal(items[0].reply.agent, "claude");
});

test("a reply is judged against the revision the item is at NOW, not at the last tick", () => {
  // The ordering this protects: the folder's kept fold is caught up BEFORE the
  // reply file is read. Without that, a reviewer who reworded since the last
  // tick would have the rewording swallowed by an answer to the old revision,
  // which is the exact case D5's per-revision rule exists to prevent.
  const f = fixture("rtail0000000005");
  const item = post(f, itemOf({ id: "itm_reworded", note: "shorten the heading" }));
  projectionModule.startWatching(f.deps, [f.review]);

  // The reviewer rewords. Nothing ticks, so the last fold still says rev 1.
  const reworded = Object.assign({}, item);
  reworded[record.FIELD.REV] = 2;
  reworded[record.FIELD.NOTE] = "shorten the heading, and drop the subtitle";
  post(f, reworded);

  const guard = forbidWholeReads(f);
  let ticked;
  try {
    fs.writeFileSync(
      stateDir.replyFilePath(f.dir, f.review, "replies-claude.jsonl"),
      JSON.stringify({ item: item.id, rev: 1, status: "handled", agent: "claude" }) + "\n",
      { mode: 0o600 }
    );
    ticked = projectionModule.tickReview(f.deps, f.review);
  } finally {
    guard.restore();
  }

  assert.deepEqual(guard.knocks, [], "nothing asked for the whole log");
  assert.equal(ticked.summary.accepted.length, 0, "the stale answer is not accepted");
  assert.equal(ticked.summary.refused.length, 1);
  assert.match(ticked.summary.refused[0].refusal, /rev/, "and the refusal names the revision");

  const parsed = JSON.parse(fs.readFileSync(stateDir.reviewJsonPath(f.dir, f.review), "utf8"));
  const items = [];
  (parsed.pages || []).forEach((page) => page.items.forEach((each) => items.push(each)));
  assert.equal(items[0].state, "ready", "the rewording is still outstanding");
  assert.equal(items[0].rev, 2);
});

// ---------------------------------------------------------------------------
// One projector per state directory
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// When the log is NOT a continuation of what was scanned
// ---------------------------------------------------------------------------
//
// A cursor is a promise that the bytes before it have not changed. Everything
// below breaks that promise in a different way, and the required answer is
// always the same: throw the fold away and start over, landing exactly where
// never having started would have landed.
//
// This is also what makes compacting old logs (fix 4 on the memory audit)
// safe to build. Compaction rewrites a log in place under a running helper,
// which is precisely a rewrite the size check alone would not notice.

test("a log truncated between ticks is refolded from the top", () => {
  const f = fixture("rtail0000000009");
  post(f, itemOf({ id: "itm_a", note: "first" }));
  post(f, itemOf({ id: "itm_b", note: "second" }));
  post(f, itemOf({ id: "itm_c", note: "third" }));
  projectionModule.startWatching(f.deps, [f.review]);
  assert.equal(onDisk(f), regenerated(f));

  rewrite(f, linesOf(f).slice(0, 2));
  projectionModule.tickReview(f.deps, f.review);
  assert.equal(onDisk(f), regenerated(f), "a shorter log is refolded, not folded on top of");
});

test("a log rewritten in place to the same length is refolded from the top", () => {
  // The case a size check cannot see. The cursor still points inside the file,
  // the file is still exactly as long, and every byte before the cursor is
  // different. Folding the tail on top of the old fold would keep items the
  // rewrite removed and miss every line it added.
  const f = fixture("rtail0000000010");
  post(f, itemOf({ id: "itm_keep", note: "kept" }));
  post(f, itemOf({ id: "itm_edited", note: "aaaaaaaaaaaaaaaaaaaa" }));
  projectionModule.startWatching(f.deps, [f.review]);
  const before = fs.statSync(stateDir.eventsPath(f.dir, f.review)).size;

  // Same line count, same byte length, different words. Deliberately the LAST
  // line, so the file's head is untouched and the only thing that has moved is
  // inside it.
  const lines = linesOf(f);
  const at = lines.length - 1;
  const swapped = lines[at].replace('"note":"aaaaaaaaaaaaaaaaaaaa"', '"note":"bbbbbbbbbbbbbbbbbbbb"');
  assert.notEqual(swapped, lines[at], "the note really was found and changed");
  assert.equal(swapped.length, lines[at].length, "and the rewrite really is the same length");
  rewrite(f, lines.slice(0, at).concat([swapped]));
  assert.equal(fs.statSync(stateDir.eventsPath(f.dir, f.review)).size, before, "the file is the same size");

  projectionModule.tickReview(f.deps, f.review);
  assert.equal(onDisk(f), regenerated(f));
  assert.equal(onDisk(f).indexOf("bbbbbbbbbbbbbbbbbbbb") !== -1, true, "and it is the new words on disk");
});

test("a log rewritten longer, with a different prefix, is refolded from the top", () => {
  const f = fixture("rtail0000000011");
  post(f, itemOf({ id: "itm_one", note: "one" }));
  post(f, itemOf({ id: "itm_two", note: "two" }));
  projectionModule.startWatching(f.deps, [f.review]);

  const lines = linesOf(f);
  // A different first line AND more of them, so the file is longer than the
  // cursor and nothing before the cursor is what it was.
  rewrite(f, [lines[1], lines[0], lines[1].replace('"seq":2', '"seq":9').replace(/"event_id":"[^"]*"/, '"event_id":"evt_rewritten"')]);

  projectionModule.tickReview(f.deps, f.review);
  assert.equal(onDisk(f), regenerated(f));
});

test("a second writer's duplicate seq is folded, not skipped", () => {
  // Two createEventLog objects on one directory each keep their own idea of the
  // high-water mark, so the second one hands out a seq the first has already
  // passed. Filtering the tail by "after the cursor" drops that line silently,
  // which is a comment missing from what an agent reads.
  const f = fixture("rtail0000000012");
  post(f, itemOf({ id: "itm_mine", note: "from the helper" }));
  projectionModule.startWatching(f.deps, [f.review]);

  const other = logModule.createEventLog({ dir: f.dir });
  const theirs = itemOf({ id: "itm_theirs", note: "from the other writer" });
  other.append(f.review, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: eventId(),
      review: f.review,
      item: theirs[record.FIELD.ID],
      rev: theirs[record.FIELD.REV],
      page_path: theirs[record.FIELD.PAGE_PATH],
      page_title: theirs[record.FIELD.PAGE_TITLE],
      page_seq: theirs[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: theirs }
    })
  ]);

  // The helper appends next, reusing a seq the other writer already used.
  post(f, itemOf({ id: "itm_after", note: "from the helper again" }));
  projectionModule.tickReview(f.deps, f.review);

  assert.equal(onDisk(f), regenerated(f));
  assert.equal(onDisk(f).indexOf("from the other writer") !== -1, true, "the other writer's event is in the file");
});

test("a line with no seq at all is folded, not skipped", () => {
  const f = fixture("rtail0000000013");
  const item = post(f, itemOf({ id: "itm_seqd", note: "an ordinary event" }));
  projectionModule.startWatching(f.deps, [f.review]);

  // A hand-written or legacy line: same shape, no seq. log.since cannot filter
  // it by "after the cursor", so the fold has to start over rather than lose it.
  const reworded = Object.assign({}, item);
  reworded[record.FIELD.REV] = 2;
  reworded[record.FIELD.NOTE] = "written by hand, with no seq";
  const line = protocol.newEvent({
    event: protocol.EVENT.ITEM_READY,
    event_id: eventId(),
    review: f.review,
    item: reworded[record.FIELD.ID],
    rev: 2,
    page_path: reworded[record.FIELD.PAGE_PATH],
    page_title: reworded[record.FIELD.PAGE_TITLE],
    page_seq: reworded[record.FIELD.PAGE_SEQ],
    payload: { draft: false, record: reworded }
  });
  delete line.seq;
  fs.appendFileSync(stateDir.eventsPath(f.dir, f.review), JSON.stringify(line) + "\n");

  post(f, itemOf({ id: "itm_later", note: "and one after it" }));
  projectionModule.tickReview(f.deps, f.review);

  assert.equal(onDisk(f), regenerated(f));
  assert.equal(onDisk(f).indexOf("written by hand, with no seq") !== -1, true, "the seq-less line reached the file");
});

// ---------------------------------------------------------------------------
// When the file gets rewritten, and when it does not
// ---------------------------------------------------------------------------

test("an event from another writer rewrites review.json, not just the fold", () => {
  // The write gate used to be log.currentSeq, which only moves on appends THIS
  // process made. An event written by anything else was folded into memory and
  // then never reached disk: the helper knew, and review.json did not.
  const f = fixture("rtail0000000014");
  post(f, itemOf({ id: "itm_first", note: "from the helper" }));
  projectionModule.startWatching(f.deps, [f.review]);
  const before = onDisk(f);

  const other = logModule.createEventLog({ dir: f.dir });
  const theirs = itemOf({ id: "itm_other", note: "appended by something else" });
  other.append(f.review, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: eventId(),
      review: f.review,
      item: theirs[record.FIELD.ID],
      rev: theirs[record.FIELD.REV],
      page_path: theirs[record.FIELD.PAGE_PATH],
      page_title: theirs[record.FIELD.PAGE_TITLE],
      page_seq: theirs[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: theirs }
    })
  ]);

  const ticked = projectionModule.tickReview(f.deps, f.review);
  assert.equal(ticked.wrote, true, "the tick wrote the file");
  assert.notEqual(onDisk(f), before);
  assert.equal(onDisk(f), regenerated(f));
});

test("a tick with nothing new still writes nothing", () => {
  const f = fixture("rtail0000000015");
  post(f, itemOf({ id: "itm_settled", note: "settled" }));
  const projector = projectionModule.attach(f.deps);
  projector.watch(f.review);
  const writes = projector.counters.writes;
  projector.tickReview(f.review);
  projector.tickReview(f.review);
  assert.equal(projector.counters.writes, writes, "an unchanged log is not rewritten");
});

test("watching a review that was only ever read still writes its file", () => {
  // Answering a read mints the fold entry without writing anything, and watch()
  // returns early for a review it already has an entry for. Between the two, a
  // review could end up watched with no file on disk, which is an agent opening
  // review.json and finding nothing.
  const f = fixture("rtail0000000016");
  post(f, itemOf({ id: "itm_readfirst", note: "read before it was watched" }));

  projectionModule.currentProjection(f.deps, f.review);
  assert.equal(fs.existsSync(stateDir.reviewJsonPath(f.dir, f.review)), false, "a read alone writes nothing");

  projectionModule.startWatching(f.deps, [f.review]);
  assert.equal(fs.existsSync(stateDir.reviewJsonPath(f.dir, f.review)), true, "and watching it writes the file");
  assert.equal(onDisk(f), regenerated(f));
});

test("two state directories do not share one projector's folds", () => {
  // Before the routes took their answer from the projector this was invisible:
  // a single cached projector was only ever nudged, never read. Now a second
  // directory getting the first one's folds is an empty review where there
  // should be items.
  const one = fixture("rtail0000000006");
  const two = fixture("rtail0000000007");
  post(one, itemOf({ id: "itm_in_one", note: "belongs to the first directory" }));
  post(two, itemOf({ id: "itm_in_two", note: "belongs to the second directory" }));

  const read = routes.handlerFor("review.read");
  const first = read({ review: one.review, query: {} }, one.deps);
  const second = read({ review: two.review, query: {} }, two.deps);

  assert.equal(first.body.pages[0].items[0].note, "belongs to the first directory");
  assert.equal(second.body.pages[0].items[0].note, "belongs to the second directory");
});
