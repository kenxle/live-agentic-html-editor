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

// ---------------------------------------------------------------------------
// The shapes the check must keep its hands off
// ---------------------------------------------------------------------------
//
// One test per exempt shape, because each one was, or would have been, a
// finished item the check held open forever. The two browser specs named in
// handled_check.js are the ones that actually hung.

test("a revert is never checked: it asks for text to be taken OUT", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nThe reviewer's own sentence.\n");
  const handled = anEdit({ state: record.STATE.HANDLED });
  // The reviewer undoes it. The take-back's after is the ORIGINAL wording, and
  // what it really asks for is the absence of the agent's change, which no
  // containment test can see.
  const taken = record.revertOf(handled, {});
  assert.ok(record.isRevert(taken), "the fixture really is a take-back");
  assert.equal(handledCheck.checkable(taken), false);

  const folded = foldHandled(setup, taken);
  assert.equal(folded[record.FIELD.STATE], record.STATE.HANDLED, "the agent's answer ends it");
  assert.equal(folded[record.FIELD.HANDLED_NOT_ON_PAGE], false);
});

test("a page-check reopen is never checked: two checks arguing means the item never closes", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nThe first paragraph.\n");
  const handled = anEdit({ id: "itm_tool_round", state: record.STATE.HANDLED });
  handled[record.FIELD.REPLY] = { status: "handled", agent: "claude", at: "2026-09-23T12:00:00.000Z" };
  const reopened = record.pageCheckReopenOf(
    handled,
    record.PAGE_CHECK_STAMP_NOTE,
    "2026-09-23T12:01:00.000Z",
    record.TOOL_ROUND.PAGE_CHECK_STAMP
  );
  reopened[record.FIELD.REPLY] = null;
  assert.ok(record.toolRoundOf(reopened), "the fixture really is a tool round");
  assert.equal(handledCheck.checkable(reopened), false);

  const folded = foldHandled(setup, reopened);
  assert.equal(folded[record.FIELD.STATE], record.STATE.HANDLED, "the agent's next handled reply ends it");
  assert.equal(folded[record.FIELD.HANDLED_NOT_ON_PAGE], false);
});

test("an empty after is never checked: there is nothing to look for", () => {
  assert.equal(handledCheck.checkable(anEdit({ after: "" })), false);
  assert.equal(handledCheck.checkable(anEdit({ after: "   \n  " })), false);
  assert.equal(handledCheck.checkable(anEdit({ after: null })), false);
});

test("a delete is never checked; a format-only record is, by its bold and italic (free writing, R14)", () => {
  const deleted = record.newItem({
    id: "itm_deleted",
    kind: record.KIND.DELETE,
    state: record.STATE.READY,
    before: "The first paragraph.",
    after: "",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/guide.html"
  });
  assert.equal(handledCheck.checkable(deleted), false);

  const formatOnly = record.newItem({
    id: "itm_format_only",
    kind: record.KIND.FORMAT_ONLY,
    state: record.STATE.READY,
    before: "The first paragraph.",
    after: "The first paragraph.",
    after_html: "<strong>The first paragraph.</strong>",
    page_origin: "http://127.0.0.1:4321",
    page_path: "/guide.html"
  });
  // Its words equal its before by construction, so it is judged by the bold
  // and italic it added, and only when nothing was written
  // (test/unit/handled_check_run.test.js).
  assert.equal(handledCheck.checkable(formatOnly), true);
});

test("an ordinary edit IS checked, so the exemptions above are exemptions", () => {
  assert.equal(handledCheck.checkable(anEdit()), true);
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

// ---------------------------------------------------------------------------
// The words only convict when nothing moved
// ---------------------------------------------------------------------------
//
// Containment answers "no" in more cases than it answers "dishonestly no": the
// agent reflowed the paragraph, split it in two, or said the same thing in its
// own words. test/browser/reverted_edit.spec.js is that third one, and the
// check held its finished item open. So the words are only allowed to convict
// when nothing the review is built from was written since the reviewer typed
// them, which is the reported failure exactly and nothing else.

test("an agent that rewrote the page in its own words is not second-guessed", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nThe first paragraph.\n");
  const item = anEdit({ after: "The reviewer's own sentence." });
  // The agent did real work and worded it differently, which is its call to
  // make and the reviewer's to judge.
  editSource(setup, "# Guide\n\n## One\n\nA sentence of the agent's own.\n");

  const folded = foldHandled(setup, item);
  assert.equal(folded[record.FIELD.STATE], record.STATE.HANDLED);
  assert.equal(folded[record.FIELD.HANDLED_NOT_ON_PAGE], false);
});

test("touchedSince is the gate, and it fails toward leaving the item alone", () => {
  const setup = markdownReview("# Guide\n\n## One\n\nThe first paragraph.\n");
  const meta = rebuildModule.readMeta(setup.dir, "review-md");
  const longAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();

  // Committed an hour ago, and the files were written since: not ours to grade.
  assert.equal(handledCheck.touchedSince(meta, anEdit({ updated_at: longAgo, created_at: longAgo })), true);
  // Committed now, nothing written since: the words are allowed to speak.
  const soon = new Date(Date.now() + 60 * 1000).toISOString();
  assert.equal(handledCheck.touchedSince(meta, anEdit({ updated_at: soon, created_at: soon })), false);
  // An unreadable time is not evidence of anything.
  assert.equal(handledCheck.touchedSince(meta, anEdit({ updated_at: "not a date", created_at: "not a date" })), true);
});

// ---------------------------------------------------------------------------
// The check is per edit, not per review
// ---------------------------------------------------------------------------
//
// The gate above covers the REVIEW: one write anywhere disarms it for every
// item. An agent that fixes one of five edits and answers handled to all five
// used to slip the other four past it. So each edit is also judged on its own
// passage: the item's BEFORE, found as whole blocks on the built page exactly
// once, means nobody touched that passage, and then a missing after convicts.
// If the before is gone, the agent changed that passage in some words of its
// own, and the reply stands.

const FIVE = [
  "The first point is short.",
  "The second point is vague.",
  "The third point is enough.",
  "The fourth point is long.",
  "The fifth point is late."
];

function fiveParagraphs(lines) {
  return "# Guide\n\n## One\n\n" + lines.join("\n\n") + "\n";
}

/** Several items, one handled line each, folded in one tick. */
function foldAllHandled(setup, items) {
  items.forEach(function (item) {
    postItem(setup.log, "review-md", item);
  });
  items.forEach(function (item) {
    appendReply(setup.dir, "review-md", item);
  });
  const projector = projection.createProjector({ dir: setup.dir, log: setup.log });
  projector.tickReview("review-md");
  const byId = {};
  projection.itemsFrom(setup.log.read("review-md")).forEach(function (each) {
    byId[each[record.FIELD.ID]] = each;
  });
  return items.map(function (item) {
    return byId[item[record.FIELD.ID]];
  });
}

function fiveEdits() {
  return FIVE.map(function (line, i) {
    return anEdit({
      id: "itm_five_" + (i + 1),
      before: line,
      after: line.replace(/is \w+\.$/, "is now what the reviewer typed, number " + (i + 1) + ".")
    });
  });
}

function assertHeldOpen(folded, label) {
  assert.equal(folded[record.FIELD.STATE], record.STATE.READY, label + " did not retire");
  assert.equal(folded[record.FIELD.HANDLED_NOT_ON_PAGE], true, label + " says why");
}

function assertRetired(folded, label) {
  assert.equal(folded[record.FIELD.STATE], record.STATE.HANDLED, label + " retired");
  assert.equal(folded[record.FIELD.HANDLED_NOT_ON_PAGE], false, label + " carries no finding");
}

test("five edits, one fixed, five handled replies: the four untouched stay open and the fixed one retires", () => {
  const setup = markdownReview(fiveParagraphs(FIVE));
  const items = fiveEdits();
  // The agent fixes the third, exactly as the reviewer typed it, and nothing
  // else. The write it made is newer than every item, which is what used to
  // disarm the check for all five.
  const fixed = FIVE.slice();
  fixed[2] = items[2][record.FIELD.AFTER];
  editSource(setup, fiveParagraphs(fixed));

  const folded = foldAllHandled(setup, items);
  assertRetired(folded[2], "the fixed third edit");
  [0, 1, 3, 4].forEach(function (i) {
    assertHeldOpen(folded[i], "untouched edit " + (i + 1));
    assert.ok(record.isUnansweredReady(folded[i]), "edit " + (i + 1) + " is back on the drain list");
  });
});

test("an agent that rewords the passage in its own words retires, even with other edits held", () => {
  const setup = markdownReview(fiveParagraphs(FIVE));
  const items = fiveEdits();
  // The reviewer asked for "is now what the reviewer typed, number 3". The
  // agent wrote "is plenty". That is its call to make and the reviewer's to
  // judge, never this check's.
  const reworded = FIVE.slice();
  reworded[2] = "The third point is plenty.";
  editSource(setup, fiveParagraphs(reworded));

  const folded = foldAllHandled(setup, items);
  assertRetired(folded[2], "the reworded third edit");
  assertHeldOpen(folded[0], "the untouched first edit");
});

test("an agent that kept the reviewer's old sentence and added its own is not held: the passage is whole blocks, not a substring", () => {
  const setup = markdownReview(fiveParagraphs(FIVE));
  const item = anEdit({ before: FIVE[2], after: "The third point is enough, and it is ready." });
  // The old sentence is still a substring of the page. The paragraph is not the
  // paragraph it was, so somebody worked on it.
  const expanded = FIVE.slice();
  expanded[2] = "The third point is enough. The agent says it is ready now.";
  editSource(setup, fiveParagraphs(expanded));

  assertRetired(foldHandled(setup, item), "the expanded passage");
});

test("a before found twice on the page is ambiguous and passes: the check never guesses", () => {
  const lines = ["To be decided.", "The middle paragraph.", "To be decided."];
  const setup = markdownReview(fiveParagraphs(lines));
  const item = anEdit({ before: "To be decided.", after: "Decided: we ship Tuesday." });
  // Something else was written, so the review-level gate is open, and the
  // passage cannot be told apart from its twin.
  const other = lines.slice();
  other[1] = "The middle paragraph, reworked.";
  editSource(setup, fiveParagraphs(other));

  assertRetired(foldHandled(setup, item), "the ambiguous edit");
});

test("a before that was on the page twice when the reviewer edited it passes, even once only one copy is left", () => {
  const lines = ["To be decided.", "The middle paragraph.", "To be decided."];
  const setup = markdownReview(fiveParagraphs(lines));
  const item = anEdit({ before: "To be decided.", after: "Decided: we ship Tuesday." });
  // The reviewer's page recorded that these words were not unique.
  item[record.FIELD.REGION] = { ref: { text_unique: false }, label: null, lost: false };
  // The agent changed the right copy in its own words. One "To be decided."
  // is left, and it is the OTHER one.
  const done = lines.slice();
  done[0] = "Settled: Tuesday.";
  editSource(setup, fiveParagraphs(done));

  assertRetired(foldHandled(setup, item), "the edit whose twin is left");
});

test("a short before is judged as a whole block: a unique heading left alone is held, one the agent expanded retires", () => {
  const body = "# Guide\n\n## Summary\n\nThe first paragraph.\n\n## Other\n\nA second paragraph.\n";
  const renamed = anEdit({ before: "Summary", after: "Overview" });

  const untouched = markdownReview(body);
  editSource(untouched, body.replace("A second paragraph.", "A second paragraph, reworked."));
  assertHeldOpen(foldHandled(untouched, renamed), "the untouched heading");

  const expanded = markdownReview(body);
  editSource(expanded, body.replace("## Summary", "## Summary of findings"));
  assertRetired(foldHandled(expanded, anEdit({ before: "Summary", after: "Overview" })), "the expanded heading");
});

test("a reviewer who trimmed words is held when the passage is untouched, though the trimmed words are on the page inside it", () => {
  const setup = markdownReview(fiveParagraphs(FIVE));
  const item = anEdit({ before: FIVE[2], after: "The third point" });
  const other = FIVE.slice();
  other[0] = "The first point, reworked by the agent.";
  editSource(setup, fiveParagraphs(other));

  assertHeldOpen(foldHandled(setup, item), "the untouched trim");
});

test("a reviewer who split a paragraph in two is not held once the agent made the split", () => {
  const setup = markdownReview(fiveParagraphs(FIVE));
  const item = anEdit({ before: FIVE[2], after: FIVE[2] + "\n\nA new paragraph the reviewer added." });
  const split = FIVE.slice();
  split[2] = FIVE[2] + "\n\nA new paragraph the reviewer added.";
  editSource(setup, fiveParagraphs(split));

  // The first block of the after IS the before, so the before is still on the
  // page once, but the after runs past it.
  assertRetired(foldHandled(setup, item), "the applied split");
});

test("an edit whose before and after differ only in typography is never held on its passage", () => {
  const setup = markdownReview(fiveParagraphs(["It's the first point.", "The second point."]));
  const item = anEdit({ before: "It's the first point.", after: "It’s the first point." });
  editSource(setup, fiveParagraphs(["It's the first point.", "The second point, reworked."]));

  assertRetired(foldHandled(setup, item), "the typography-only edit");
});

test("an insertion has no passage to find, so only the review-level gate can hold it", () => {
  const item = function () {
    return anEdit({ before: "", after: "A paragraph the reviewer added." });
  };

  // Nothing written since: the agent changed nothing at all, which is the
  // original failure, and it is still caught.
  const idle = markdownReview(fiveParagraphs(FIVE));
  assertHeldOpen(foldHandled(idle, item()), "the insertion with nothing written");

  // Something written: there is no passage to say it was not this one.
  const busy = markdownReview(fiveParagraphs(FIVE));
  const other = FIVE.slice();
  other[0] = "The first point, reworked by the agent.";
  editSource(busy, fiveParagraphs(other));
  assertRetired(foldHandled(busy, item()), "the insertion after a write");
});

test("a reviewer who only added words is not held when the agent kept the old block and added its own", () => {
  // test/browser/reverted_edit.spec.js, in unit form. The reviewer's after is
  // their before plus a sentence ("is enough"). The agent left the block as it
  // was and put the sentence in a paragraph of its own, in its own words ("is
  // plenty"). The before is still on the page, and that proves nothing: an
  // edit that only adds words keeps its before whether or not the work was done.
  const lines = ["Warm up before every session.", "Stretch after."];
  const setup = markdownReview(fiveParagraphs(lines));
  const item = anEdit({
    before: "Warm up before every session.",
    after: "Warm up before every session. Five minutes of easy jogging is enough."
  });
  editSource(setup, fiveParagraphs(["Warm up before every session.", "Five minutes of easy jogging is plenty.", "Stretch after."]));

  assertRetired(foldHandled(setup, item), "the addition the agent made its own way");
});

test("a split nobody made is held", () => {
  // The after holds the before's words, so the per-edit witness stands aside
  // and the nothing-written gate decides. Flat text would find the old words
  // and miss that the reviewer's paragraph break is not on the page.
  const item = anEdit({ before: "Alpha beta gamma.", after: "Alpha beta\n\ngamma." });
  assert.equal(handledCheck.verdictFor(["<p>Alpha beta gamma.</p>"], item, true), false, "nothing written: held");
  assert.equal(handledCheck.verdictFor(["<p>Alpha beta</p><p>gamma.</p>"], item, true), true, "the split made: shown");

  const setup = markdownReview(fiveParagraphs(["Alpha beta gamma.", "The second point."]));
  assertHeldOpen(foldHandled(setup, anEdit({ before: "Alpha beta gamma.", after: "Alpha beta\n\ngamma." })), "the unmade split");
});
