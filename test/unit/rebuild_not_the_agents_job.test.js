// The rebuild is not the agent's job, and a handled claim is checked.
//
// Two halves of one failure. An agent edits the Markdown behind a rendered
// review and does not rerun the review command: the artifact the page is
// showing never changes, so the page never reloads. The agent then replies
// handled, the item retires, replay stops re-applying the reviewer's own edit,
// and their words disappear on the next refresh. The owner made one edit three
// times before reporting it.
//
// The first half is src/service/rebuild.js: the helper re-renders the artifact
// itself, on the same stat the reload trigger already makes. The second is
// src/service/handled_check.js: a handled reply for a hand edit does not retire
// the item unless the built page really shows the words.
//
// The browser half (the page actually reloading onto the new render, and the
// card saying the change has not arrived) is
// test/browser/rebuild_not_the_agents_job.spec.js.
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
const routes = require("../../src/service/routes.js");
const markdown = require("../../src/service/markdown.js");
const stateDirModule = require("../../src/service/state_dir.js");
const rebuildModule = require("../../src/service/rebuild.js");
const handledCheck = require("../../src/service/handled_check.js");
const replies = require("../../src/service/replies.js");
const projection = require("../../src/service/projection.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const lifecycle = require("../../src/shared/lifecycle.js");

const SESSION = "s_rebuildtest0001";

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-rebuild-"));
}

/** A state directory plus a source folder, the way `lahe review` leaves them. */
function markdownReview(body, options) {
  const opts = options || {};
  const root = tempRoot();
  const dir = path.join(root, "state");
  fs.mkdirSync(dir, { recursive: true });
  const work = path.join(root, "work");
  fs.mkdirSync(work, { recursive: true });
  const source = path.join(work, "guide.md");
  fs.writeFileSync(source, body);

  const rendered = markdown.writeArtifact(dir, SESSION, source);
  const log = logModule.createEventLog({ dir: dir });
  let now = opts.startAt || 1000;
  const reviews = reviewsModule.createReviews({
    dir: dir,
    log: log,
    now: function () {
      return now;
    }
  });
  reviews.create({
    id: "review-md",
    origins: ["null"],
    target_path: rendered.target,
    source_path: source,
    agent_session_id: SESSION
  });
  return {
    root: root,
    dir: dir,
    source: source,
    target: rendered.target,
    log: log,
    reviews: reviews,
    advance: function (ms) {
      now += ms;
    }
  };
}

/** Write the source and push its mtime clear of the artifact's. */
function editSource(setup, body) {
  fs.writeFileSync(setup.source, body);
  const later = new Date(Date.now() + 10000);
  fs.utimesSync(setup.source, later, later);
}

function pollBody(setup) {
  return routes.handlerFor("replies.poll")(
    { review: "review-md", query: { since: 0 } },
    { log: setup.log, reviews: setup.reviews }
  ).body;
}

/**
 * Poll until the page stops moving, and answer its settled mtime.
 *
 * The script-line healer writes the review's tag into an artifact that no
 * static server is serving, which is what a unit test's review looks like, and
 * that write moves the mtime once. A test about re-rendering measures what
 * happens after it.
 */
function settle(setup) {
  var at = null;
  for (var i = 0; i < 5; i += 1) {
    pollBody(setup);
    setup.advance(5000);
    var now = fs.statSync(setup.target).mtimeMs;
    if (now === at) return at;
    at = now;
  }
  return at;
}

// ---------------------------------------------------------------------------
// The re-render trigger
// ---------------------------------------------------------------------------

test("a Markdown source newer than the page re-renders it, with no agent action at all", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nThe first paragraph.\n");
  const before = pollBody(setup).target_mtime;
  assert.ok(fs.readFileSync(setup.target, "utf8").includes("The first paragraph."));

  // The whole point: the .md changes and NOTHING else happens. No review
  // command is rerun, no build, no agent.
  editSource(setup, "# Guide\n\n## One\n\nThe agent rewrote this paragraph.\n");
  setup.advance(5000);

  const after = pollBody(setup).target_mtime;
  assert.notEqual(after, before, "the page the browser polls has moved");
  const html = fs.readFileSync(setup.target, "utf8");
  assert.ok(html.includes("The agent rewrote this paragraph."), "the new render is on disk");
  assert.ok(!html.includes("The first paragraph."), "the old render is gone");
});

test("an unchanged source is not re-rendered", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nUntouched.\n");
  // Poll until nothing moves first. The script-line healer writes into an
  // artifact no static server is serving in a unit test, and that write moves
  // the mtime once. What is being measured is every poll AFTER that.
  const settledAt = settle(setup);
  pollBody(setup);
  setup.advance(5000);
  pollBody(setup);
  assert.equal(fs.statSync(setup.target).mtimeMs, settledAt, "nothing was rewritten");
});

test("a source that cannot be rendered still answers the poll", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nFine so far.\n");
  settle(setup);
  const before = pollBody(setup).target_mtime;
  // A source that is gone is the render failure the helper is most likely to
  // meet: an agent moving the file, or a save that goes through a rename.
  fs.rmSync(setup.source);
  setup.advance(5000);

  const body = pollBody(setup);
  assert.equal(body.target_mtime, before, "the page is still the page it was");
  assert.deepEqual(body.events, []);
  assert.equal(typeof body.seq, "number");
  assert.ok(fs.existsSync(setup.target), "the artifact the reviewer is reading is left alone");
});

test("a review whose page is not LAHE's own render is never rewritten", () => {
  const root = tempRoot();
  const dir = path.join(root, "state");
  fs.mkdirSync(dir, { recursive: true });
  const work = path.join(root, "work");
  fs.mkdirSync(work, { recursive: true });
  // Somebody else's build: a Markdown source, and an HTML page THEY produce.
  const source = path.join(work, "notes.md");
  const built = path.join(work, "notes.html");
  fs.writeFileSync(source, "# Notes\n\n## One\n\nTheir words.\n");
  fs.writeFileSync(built, "<h1>Notes</h1><p>Their words.</p>");

  const log = logModule.createEventLog({ dir: dir });
  let now = 1000;
  const reviews = reviewsModule.createReviews({ dir: dir, log: log, now: () => now });
  reviews.create({
    id: "review-theirs",
    origins: ["null"],
    target_path: built,
    source_path: source,
    agent_session_id: SESSION
  });

  const bytes = fs.readFileSync(built, "utf8");
  const later = new Date(Date.now() + 10000);
  fs.writeFileSync(source, "# Notes\n\n## One\n\nTheir new words.\n");
  fs.utimesSync(source, later, later);
  now += 5000;
  routes.handlerFor("replies.poll")({ review: "review-theirs", query: { since: 0 } }, { log: log, reviews: reviews });

  assert.equal(fs.readFileSync(built, "utf8"), bytes, "their build output is theirs");
});

test("a review with no source at all is not a re-render candidate", () => {
  const root = tempRoot();
  const dir = path.join(root, "state");
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(rebuildModule.renderableOf(dir, { id: "r", target_path: "/tmp/x.html" }), null);
  assert.equal(
    rebuildModule.renderableOf(dir, { id: "r", source_path: "/tmp/x.txt", target_path: "/tmp/x.html", agent_session_id: SESSION }),
    null
  );
});

// ---------------------------------------------------------------------------
// The handled check
// ---------------------------------------------------------------------------

let itemCounter = 0;
function anEdit(overrides) {
  itemCounter += 1;
  return record.newItem(
    Object.assign(
      {
        id: "itm_edit_" + itemCounter,
        kind: record.KIND.EDIT,
        state: record.STATE.READY,
        change: "say it in the reviewer's words",
        before: "The first paragraph.",
        after: "The reviewer's own sentence.",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/guide.html"
      },
      overrides || {}
    )
  );
}

function postItem(log, reviewId, item) {
  log.append(reviewId, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_CREATED,
      event_id: "evt_" + item[record.FIELD.ID],
      review: reviewId,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      payload: { draft: false, record: item }
    })
  ]);
}

function appendReply(dir, reviewId, item, extra) {
  const file = stateDirModule.replyFilePath(dir, reviewId, "replies.jsonl");
  fs.appendFileSync(
    file,
    JSON.stringify(
      Object.assign({ item: item[record.FIELD.ID], rev: item[record.FIELD.REV], status: "handled", agent: "claude" }, extra || {})
    ) + "\n"
  );
}

/** One review, one item, one handled line, folded the way the helper folds it. */
function foldHandled(setup, item) {
  postItem(setup.log, "review-md", item);
  appendReply(setup.dir, "review-md", item);
  const projector = projection.createProjector({ dir: setup.dir, log: setup.log });
  projector.tickReview("review-md");
  const items = projection.itemsFrom(setup.log.read("review-md"));
  return items.filter(function (each) {
    return each[record.FIELD.ID] === item[record.FIELD.ID];
  })[0];
}

test("a handled edit whose words are on the page retires", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nThe first paragraph.\n");
  const item = anEdit();
  // The agent did the work: the source now says what the reviewer asked for.
  editSource(setup, "# Guide\n\n## One\n\nThe reviewer's own sentence.\n");

  const folded = foldHandled(setup, item);
  assert.equal(folded[record.FIELD.STATE], record.STATE.HANDLED);
  assert.equal(folded[record.FIELD.HANDLED_NOT_ON_PAGE], false);
  assert.ok(!record.isUnansweredReady(folded), "it is off the drain list");
});

test("a handled edit the page does not show stays open, and says why", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nThe first paragraph.\n");
  const item = anEdit();
  // The agent replied without touching anything. This is the exact shape of the
  // reported failure.
  const folded = foldHandled(setup, item);

  assert.equal(folded[record.FIELD.STATE], record.STATE.READY, "it did not retire");
  assert.equal(folded[record.FIELD.HANDLED_NOT_ON_PAGE], true);
  assert.ok(record.isUnansweredReady(folded), "the next drain lists it again");
  assert.ok(folded[record.FIELD.REPLY], "what the agent said is still on the card");

  const projected = JSON.parse(fs.readFileSync(stateDirModule.reviewJsonPath(setup.dir, "review-md"), "utf8"));
  const wire = projected.pages[0].items.filter(function (each) {
    return each.id === item[record.FIELD.ID];
  })[0];
  assert.equal(wire.handled_not_on_page, true, "the agent reads the same fact");
  assert.equal(wire.state, "ready");
});

test("a typography-only difference counts as the change having arrived", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nThe first paragraph.\n");
  // The reviewer typed a curly apostrophe and an em dash on the page; the
  // Markdown holds the straight forms. That is the same sentence.
  const item = anEdit({ after: "The reviewer’s own sentence — all of it." });
  editSource(setup, "# Guide\n\n## One\n\nThe reviewer's own sentence - all of it.\n");

  const folded = foldHandled(setup, item);
  assert.equal(folded[record.FIELD.STATE], record.STATE.HANDLED);
  assert.equal(folded[record.FIELD.HANDLED_NOT_ON_PAGE], false);
});

test("a comment is not checked against the page", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nThe first paragraph.\n");
  const item = record.newItem({
    id: "itm_comment_1",
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "this whole section reads cold",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/guide.html"
  });

  const folded = foldHandled(setup, item);
  assert.equal(folded[record.FIELD.STATE], record.STATE.HANDLED, "a comment retires on the agent's word");
  assert.equal(folded[record.FIELD.HANDLED_NOT_ON_PAGE], false);
});

test("cannot tell is treated as told: an unreadable page never holds an item open", () => {
  const root = tempRoot();
  const dir = path.join(root, "state");
  fs.mkdirSync(dir, { recursive: true });
  const checker = handledCheck.createHandledCheck({ dir: dir });
  assert.equal(checker.pageShows("review-that-does-not-exist", anEdit()), null);
});

test("the lifecycle call is what decides, and only an explicit false changes it", () => {
  const item = anEdit();
  const base = { rev: 1, status: "handled", agent: "claude" };
  assert.equal(lifecycle.applyReply(item, base).state, record.STATE.HANDLED);
  assert.equal(lifecycle.applyReply(item, Object.assign({}, base, { page_shows_change: true })).state, record.STATE.HANDLED);
  const held = lifecycle.applyReply(item, Object.assign({}, base, { page_shows_change: false }));
  assert.equal(held.accepted, true, "the agent's words are still folded");
  assert.equal(held.state, record.STATE.READY);
  assert.equal(held.not_on_page, true);
});

test("the fold carries the finding, so every surface says the same thing", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nThe first paragraph.\n");
  const item = anEdit();
  postItem(setup.log, "review-md", item);
  appendReply(setup.dir, "review-md", item);
  const folder = replies.createReplyFolder({
    dir: setup.dir,
    log: setup.log,
    pageShows: function () {
      return false;
    }
  });
  const summary = folder.fold("review-md");
  assert.equal(summary.accepted.length, 1);
  assert.equal(summary.accepted[0].not_on_page, true);
  const folded = setup.log.read("review-md").filter(function (event) {
    return event[protocol.EVENT_FIELD.EVENT] === protocol.EVENT.REPLY_FOLDED;
  });
  assert.equal(folded.length, 1);
  assert.equal(folded[0].handled_not_on_page, true);
});

// ---------------------------------------------------------------------------
// The card does not also run the waiting clock
// ---------------------------------------------------------------------------
//
// The item is on the agent's drain list, so record.isUnansweredReady counts it.
// The rail's overdue clock reads the same predicate, and without a second rule
// the card goes amber, then loud, and offers to hand the work to another agent,
// directly above a line saying the agent reported it done. Nobody is being slow
// here: the answer arrived and did not land.

const storeModule = require("../../src/layer/store.js");
const overlay = require("../../src/layer/overlay.js");

const RAIL_REVIEW = "rail-review";

function railItem(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.EDIT,
        state: record.STATE.READY,
        change: "say it in the reviewer's words",
        before: "The first paragraph.",
        after: "The reviewer's own sentence.",
        page_origin: "http://127.0.0.1:4000",
        page_path: "/guide.html"
      },
      overrides || {}
    )
  );
}

function mountOnRail(item, longAgo) {
  const store = storeModule.createStore();
  const rail = overlay.createRail({ document: null, store: store, reviewId: RAIL_REVIEW });
  store.write(RAIL_REVIEW, item);
  store.queueEvent(RAIL_REVIEW, {
    event_id: "evt-" + item[record.FIELD.ID] + "-" + item[record.FIELD.REV],
    event: "item.ready",
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    record: item
  });
  rail.upsertCard(item);
  // cardWaitFor computes nothing before STATUS.STORED, so without this the
  // assertion below would pass for an unrelated reason.
  rail.setStatusLine(overlay.STATUS.STORED);
  rail.setAgentLiveness({ state: "no_agent", oldest_unanswered_at: longAgo, unanswered: 1 });
  return rail;
}

test("a card the handled check held open never goes late, however long it sits", () => {
  const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const held = railItem({ id: "itm_held_open", updated_at: longAgo, created_at: longAgo });
  held[record.FIELD.REPLY] = { status: "handled", agent: "claude", at: longAgo };
  held[record.FIELD.HANDLED_NOT_ON_PAGE] = true;

  assert.ok(record.isUnansweredReady(held), "it is still work the agent has to come back to");
  const wait = mountOnRail(held, longAgo).cardWait(held[record.FIELD.ID]);
  assert.equal(wait.overdue, false, "and the card does not accuse anyone of being silent about it");
  assert.equal(wait.text, "");

  // The same item, the same wait, with nobody having answered: this is what the
  // rule above is holding back, so the assertion is about the flag and not a
  // fluke of the harness.
  const unanswered = railItem({ id: "itm_never_answered", updated_at: longAgo, created_at: longAgo });
  const other = mountOnRail(unanswered, longAgo).cardWait(unanswered[record.FIELD.ID]);
  assert.equal(other.overdue, true);
});
