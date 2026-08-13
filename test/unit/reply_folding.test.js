// Reply folding: the helper reading replies*.jsonl and folding what it finds
// into the log and the projection.
//
// Owner: 3A. Ranked test 10's unit half (a stale reply is refused and the
// reworded item stays outstanding), ranked test 32's fold half (two files, one
// item, one revision, deterministic winner with both lines in the log; a torn
// final line held then folded once; a malformed line skipped with the file and
// the line number named), and ranked test 20 (drafts are never actionable).
//
// Everything here runs against REAL files: a real events.jsonl written by
// src/service/log.js, real replies*.jsonl on disk, and the real reader. A fold
// tested against an array of objects proves nothing about byte offsets, torn
// lines, or truncation.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logModule = require("../../src/service/log.js");
const stateDir = require("../../src/service/state_dir.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const replies = require("../../src/service/replies.js");
const projection = require("../../src/service/projection.js");

const REVIEW = "reply-fold-review";

function freshDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-fold-"));
}

let eventCounter = 0;
function eventId() {
  eventCounter += 1;
  return "evt_test_" + eventCounter;
}

/** One item, posted the way sync.js posts one: the record rides in the event. */
function postItem(log, item, type) {
  return log.append(REVIEW, [
    protocol.newEvent({
      event: type,
      event_id: eventId(),
      review: REVIEW,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: record.isDraft(item), record: item }
    })
  ]);
}

function readyItem(overrides) {
  return record.newItem(
    Object.assign(
      {
        id: "itm_ready",
        kind: record.KIND.EDIT,
        state: record.STATE.READY,
        note: "say which one you will text first",
        before: "Nine clients checked in this week.",
        after: "Nine clients checked in this week. Say which one you will text first.",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/",
        page_title: "Coach",
        page_seq: 1
      },
      overrides || {}
    )
  );
}

function writeReplyFile(dir, filename, lines) {
  fs.writeFileSync(stateDir.replyFilePath(dir, REVIEW, filename), lines.join(""), { mode: 0o600 });
}

function replyLine(fields) {
  return JSON.stringify(fields) + "\n";
}

function setup() {
  const dir = freshDir();
  const log = logModule.createEventLog({ dir: dir });
  stateDir.ensureReviewDir(dir, REVIEW);
  const folder = replies.createReplyFolder({ dir: dir, log: log });
  return { dir, log, folder };
}

function itemsNow(log) {
  return projection.itemsFrom(log.read(REVIEW));
}

test("a reply naming a stale revision is refused and the reworded item stays outstanding", () => {
  const { dir, log, folder } = setup();

  const item = readyItem();
  postItem(log, item, protocol.EVENT.ITEM_READY);

  // The reviewer rewords while the agent is reading. rev moves to 2.
  const reworded = record.bumpRev(item, { after: item.after + " And say it by lunch." });
  postItem(log, reworded, protocol.EVENT.ITEM_CONTENT);
  assert.equal(itemsNow(log)[0].rev, 2, "the rewording landed");

  // The agent answers the revision it read.
  writeReplyFile(dir, "replies-claude.jsonl", [
    replyLine({ item: item.id, rev: 1, status: "handled", agent: "claude" })
  ]);

  const summary = folder.fold(REVIEW);

  assert.equal(summary.refused.length, 1, "the stale line is refused");
  assert.match(summary.refused[0].refusal, /rev 1/);
  assert.equal(summary.accepted.length, 0);

  const after = itemsNow(log)[0];
  assert.equal(after.state, record.STATE.READY, "the rewording stays outstanding");
  assert.equal(after.rev, 2);
  assert.equal(after.reply, null, "a refused reply is not the item's reply");

  // The refusal is IN THE LOG, so the library can say it on the card rather
  // than the reviewer wondering why nothing happened.
  const folded = log.read(REVIEW).filter((e) => e.event === protocol.EVENT.REPLY_FOLDED);
  assert.equal(folded.length, 1);
  assert.equal(folded[0].accepted, false);
});

test("a reply naming the current revision retires the item", () => {
  const { dir, log, folder } = setup();
  const item = readyItem();
  postItem(log, item, protocol.EVENT.ITEM_READY);

  writeReplyFile(dir, "replies.jsonl", [
    replyLine({ item: item.id, rev: 1, status: "handled", agent: "claude", files: ["app/views/home.html.erb"] })
  ]);
  const summary = folder.fold(REVIEW);
  assert.equal(summary.accepted.length, 1);

  const after = itemsNow(log)[0];
  assert.equal(after.state, record.STATE.HANDLED);
  assert.equal(after.reply.agent, "claude");
  assert.deepEqual(after.reply.files, ["app/views/home.html.erb"]);
});

test("two reply files answering one item at one revision fold deterministically, both lines kept", () => {
  const { dir, log, folder } = setup();
  const item = readyItem();
  postItem(log, item, protocol.EVENT.ITEM_READY);

  writeReplyFile(dir, "replies-alpha.jsonl", [
    replyLine({ item: item.id, rev: 1, status: "handled", agent: "alpha" })
  ]);
  writeReplyFile(dir, "replies-zulu.jsonl", [
    replyLine({ item: item.id, rev: 1, status: "not_handled", agent: "zulu", reason: "the file is generated" })
  ]);

  const summary = folder.fold(REVIEW);
  assert.equal(summary.accepted.length, 2, "both lines folded");

  // Latest wins, and arrival order inside one fold is by filename so it is the
  // same on every machine and on every run.
  const after = itemsNow(log)[0];
  assert.equal(after.state, record.STATE.NOT_HANDLED);
  assert.equal(after.reply.agent, "zulu");

  const folded = log.read(REVIEW).filter((e) => e.event === protocol.EVENT.REPLY_FOLDED);
  assert.equal(folded.length, 2, "both lines are in events.jsonl");
  assert.deepEqual(
    folded.map((e) => e.reply.agent),
    ["alpha", "zulu"]
  );

  // Deterministic: folding the same two files again changes nothing.
  const again = replies.createReplyFolder({ dir: dir, log: log }).fold(REVIEW);
  assert.equal(again.accepted.length, 2, "a re-fold reads the same lines");
  assert.equal(
    log.read(REVIEW).filter((e) => e.event === protocol.EVENT.REPLY_FOLDED).length,
    2,
    "and appends nothing new: folding is idempotent by event_id"
  );
  assert.equal(itemsNow(log)[0].reply.agent, "zulu");
});

test("a higher revision beats a later arrival", () => {
  const { dir, log, folder } = setup();
  const item = readyItem();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  const reworded = record.bumpRev(item, { after: item.after + " Today." });
  postItem(log, reworded, protocol.EVENT.ITEM_CONTENT);

  // alpha answers the current rev; zulu arrives later naming the old one.
  writeReplyFile(dir, "replies-alpha.jsonl", [
    replyLine({ item: item.id, rev: 2, status: "handled", agent: "alpha" })
  ]);
  writeReplyFile(dir, "replies-zulu.jsonl", [
    replyLine({ item: item.id, rev: 1, status: "not_handled", agent: "zulu", reason: "stale read" })
  ]);

  folder.fold(REVIEW);
  const after = itemsNow(log)[0];
  assert.equal(after.state, record.STATE.HANDLED, "the current revision wins over the later stale line");
  assert.equal(after.reply.agent, "alpha");
});

test("a torn final line is held, and folded once when it completes", () => {
  const { dir, log, folder } = setup();
  const item = readyItem();
  postItem(log, item, protocol.EVENT.ITEM_READY);

  const whole = replyLine({ item: item.id, rev: 1, status: "handled", agent: "claude" });
  const torn = whole.slice(0, whole.length - 6);
  const replyPath = stateDir.replyFilePath(dir, REVIEW, "replies.jsonl");
  fs.writeFileSync(replyPath, torn, { mode: 0o600 });

  const first = folder.fold(REVIEW);
  assert.equal(first.accepted.length, 0, "a torn final line is held, never half-parsed");
  assert.equal(first.rejected.length, 0, "and it is not reported as malformed");
  assert.equal(itemsNow(log)[0].state, record.STATE.READY);

  fs.appendFileSync(replyPath, whole.slice(whole.length - 6));
  const second = folder.fold(REVIEW);
  assert.equal(second.accepted.length, 1, "the completed line folds");
  assert.equal(itemsNow(log)[0].state, record.STATE.HANDLED);

  const third = folder.fold(REVIEW);
  assert.equal(third.accepted.length, 0, "and folds exactly once");
});

test("a malformed line is skipped, the file and the line number are named, and the reader lives", () => {
  const { dir, log, folder } = setup();
  const item = readyItem();
  postItem(log, item, protocol.EVENT.ITEM_READY);

  writeReplyFile(dir, "replies-claude.jsonl", [
    "{not json at all\n",
    replyLine({ item: item.id, rev: 1, status: "handled", agent: "claude" })
  ]);

  const summary = folder.fold(REVIEW);
  assert.equal(summary.rejected.length, 1);
  assert.equal(summary.rejected[0].file, "replies-claude.jsonl");
  assert.equal(summary.rejected[0].line, 1, "the line number is 1-based, the way an editor counts");
  assert.equal(summary.accepted.length, 1, "the good line after it still folds");
  assert.equal(itemsNow(log)[0].state, record.STATE.HANDLED);

  const rejected = log.read(REVIEW).filter((e) => e.event === protocol.EVENT.REPLY_REJECTED);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].file, "replies-claude.jsonl");
  assert.equal(rejected[0].line, 1);
  assert.match(rejected[0].reason, /not JSON/);
});

test("a truncated file resets its offset and re-folds without duplicating", () => {
  const { dir, log, folder } = setup();
  const item = readyItem();
  postItem(log, item, protocol.EVENT.ITEM_READY);

  const line = replyLine({ item: item.id, rev: 1, status: "handled", agent: "claude" });
  const replyPath = stateDir.replyFilePath(dir, REVIEW, "replies.jsonl");
  fs.writeFileSync(replyPath, line + line.replace("handled", "handled"), { mode: 0o600 });
  folder.fold(REVIEW);
  const foldedFirst = log.read(REVIEW).filter((e) => e.event === protocol.EVENT.REPLY_FOLDED).length;

  // The agent rewrote its file instead of appending to it.
  fs.writeFileSync(replyPath, line, { mode: 0o600 });
  const summary = folder.fold(REVIEW);
  assert.equal(summary.refolded, true, "a file shorter than its offset is re-read from zero");
  assert.equal(
    log.read(REVIEW).filter((e) => e.event === protocol.EVENT.REPLY_FOLDED).length,
    foldedFirst,
    "and nothing is folded twice"
  );
});

test("an unsafe agent segment in a filename is ignored and reported", () => {
  const { dir, log, folder } = setup();
  const item = readyItem();
  postItem(log, item, protocol.EVENT.ITEM_READY);

  // Written by hand, because replyFilePath refuses to build this path at all.
  const dirPath = stateDir.reviewDir(dir, REVIEW);
  fs.writeFileSync(path.join(dirPath, "replies-..%2fetc.jsonl"), replyLine({ item: item.id, rev: 1, status: "handled" }), {
    mode: 0o600
  });
  fs.writeFileSync(path.join(dirPath, "notes.txt"), "not a reply file at all\n", { mode: 0o600 });

  const summary = folder.fold(REVIEW);
  assert.equal(summary.accepted.length, 0, "nothing in an unsafe file is folded");
  assert.equal(summary.ignoredFiles.length, 1, "the reply-shaped name with the unsafe segment is reported");
  assert.match(summary.ignoredFiles[0].file, /replies-/);
  assert.equal(itemsNow(log)[0].state, record.STATE.READY);
});

test("the line's agent beats the filename's", () => {
  const { dir, log, folder } = setup();
  const item = readyItem();
  postItem(log, item, protocol.EVENT.ITEM_READY);

  writeReplyFile(dir, "replies-fromfile.jsonl", [
    replyLine({ item: item.id, rev: 1, status: "question", agent: "fromline", text: "which heading do you mean?" })
  ]);
  folder.fold(REVIEW);

  const after = itemsNow(log)[0];
  assert.equal(after.reply.agent, "fromline");
  assert.equal(after.state, record.STATE.READY, "a question leaves the item outstanding");
  assert.equal(after.reply.text, "which heading do you mean?");
});

test("an agent with no name in its line is named by its file, and by nothing when there is neither", () => {
  const { dir, log, folder } = setup();
  const item = readyItem();
  postItem(log, item, protocol.EVENT.ITEM_READY);
  const second = readyItem({ id: "itm_two" });
  postItem(log, second, protocol.EVENT.ITEM_READY);

  writeReplyFile(dir, "replies-claude.jsonl", [replyLine({ item: item.id, rev: 1, status: "handled" })]);
  writeReplyFile(dir, "replies.jsonl", [replyLine({ item: second.id, rev: 1, status: "handled" })]);
  folder.fold(REVIEW);

  const items = itemsNow(log);
  assert.equal(items.find((i) => i.id === item.id).reply.agent, "claude");
  assert.equal(items.find((i) => i.id === second.id).reply.agent, null, "no name anywhere; the card says agent");
});

test("an agent may not retire an item that is not ready", () => {
  const { dir, log, folder } = setup();
  const draft = readyItem({ id: "itm_draft", state: record.STATE.DRAFT, note: "half a thought" });
  postItem(log, draft, protocol.EVENT.ITEM_CREATED);

  writeReplyFile(dir, "replies.jsonl", [replyLine({ item: draft.id, rev: 1, status: "handled", agent: "claude" })]);
  const summary = folder.fold(REVIEW);
  assert.equal(summary.refused.length, 1);
  assert.match(summary.refused[0].refusal, /only a ready item is actionable/);
  assert.equal(itemsNow(log)[0].state, record.STATE.DRAFT);
});
