// The staleness excuse: an agent refusing a reworded item because its card was
// created yesterday.
//
// What happened (review raa43efbab8d1, 2026-09-23). The reviewer reworded two
// cards made the day before. Rewording bumps the rev and makes the item
// outstanding again, so both were current work. The agent replied not_handled
// twice and wrote nothing:
//
//   "Nothing's actually wrong with the article. This is a leftover comment card
//    from yesterday (created 9/22, before you'd even asked to remove [et al]
//    the first time)."
//   "Another stale card from 9/22. You explicitly deleted 'Will we be saved?' a
//    minute ago (handled)."
//
// The reviewer retyped his change three times and it never landed. The record
// handed the agent a created_at that invited the judgment, while the fact that
// mattered, when the reviewer last changed these words, was not the obvious
// field. So three things are asserted here:
//
//  1. every projected item names when the reviewer last changed it, and the
//     card's first-created time cannot be read as "how old this request is";
//  2. the contract says in plain words that an item you are shown is current;
//  3. a not_handled or question reply cannot be filed without words in it.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const rf = require("../../src/shared/review_format.js");
const record = require("../../src/shared/record.js");
const protocol = require("../../src/shared/protocol.js");
const logModule = require("../../src/service/log.js");
const status = require("../../src/cli/commands/status.js");
const reply = require("../../src/cli/commands/reply.js");

const YESTERDAY = "2026-09-22T14:15:57.244Z";
const A_MINUTE_AGO = "2026-09-23T23:33:10.000Z";

function anItem(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        page_origin: record.FILE_ORIGIN,
        page_path: "article.html",
        page_title: "New Debugging Hell",
        page_seq: 1,
        note: "take [et al] out of this line",
        region: { ref: { id: "ref_1" }, label: "Introduction, p 2", lost: null }
      },
      overrides || {}
    )
  );
}

function reviewWith(items) {
  return {
    id: "rev_test",
    generated_at: A_MINUTE_AGO,
    started_at: YESTERDAY,
    ended_at: null,
    items: items
  };
}

// ---------------------------------------------------------------------------
// 1. The field that matters is the obvious one
// ---------------------------------------------------------------------------

test("a projected item names when the reviewer last changed it, not just when the card was made", () => {
  const item = anItem({ rev: 3, created_at: YESTERDAY, updated_at: A_MINUTE_AGO });
  const json = rf.projectReview(reviewWith([item]));
  const projected = json.pages[0].items[0];

  assert.equal(projected.reviewer_last_changed_at, A_MINUTE_AGO);
  assert.equal(projected.card_first_created_at, YESTERDAY);
  // The two old names are gone: "created_at" beside "updated_at" is what read
  // as "how old this request is".
  assert.equal(Object.prototype.hasOwnProperty.call(projected, "created_at"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(projected, "updated_at"), false);
});

test("an item never touched since it was made still carries a last-changed time", () => {
  const item = anItem({ created_at: YESTERDAY, updated_at: null });
  const projected = rf.projectReview(reviewWith([item])).pages[0].items[0];
  assert.equal(projected.reviewer_last_changed_at, YESTERDAY);
});

test("the human-readable text says the words are the reviewer's current wording", () => {
  const item = anItem({ rev: 3, created_at: YESTERDAY, updated_at: A_MINUTE_AGO });
  const text = rf.renderText(reviewWith([item]));
  assert.match(text, /reviewer last changed these words/i);
  assert.match(text, new RegExp(A_MINUTE_AGO));
  assert.match(text, /current wording/i);
});

test("the drain's item line carries the reviewer's last-changed time", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-stale-"));
  const item = anItem({ page_origin: "http://127.0.0.1:8000", page_path: "/article.html" });
  const log = logModule.createEventLog({ dir: dir });
  log.append("rev1", [
    protocol.newEvent({
      event: protocol.EVENT.REVIEW_CREATED,
      event_id: "ev_created",
      review: "rev1",
      payload: { token: "t".repeat(8) }
    })
  ]);
  log.append("rev1", [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "ev_item",
      review: "rev1",
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item }
    })
  ]);

  const out = [];
  const err = [];
  const code = await status.run([], { stateDir: dir, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
  assert.equal(code, protocol.CLI_EXIT.OK, err.join(""));
  assert.match(out.join(""), /last changed/);

  // And the machine-readable drain carries the field itself.
  const jsonOut = [];
  await status.run(["--json", "--quiet"], { stateDir: dir, stdout: (t) => jsonOut.push(t), stderr: () => {} });
  const lines = jsonOut.join("").split("\n").filter((line) => line.trim());
  const itemLine = lines.map((line) => JSON.parse(line)).find((obj) => obj.id === item[record.FIELD.ID]);
  assert.ok(itemLine, "the item is on the drain");
  assert.equal(typeof itemLine.reviewer_last_changed_at, "string");
});

test("lastItemAt reads the new field names", () => {
  const newest = status.lastItemAt([
    { reviewer_last_changed_at: YESTERDAY, card_first_created_at: YESTERDAY },
    { reviewer_last_changed_at: A_MINUTE_AGO, card_first_created_at: YESTERDAY }
  ]);
  assert.equal(newest, A_MINUTE_AGO);
});

// ---------------------------------------------------------------------------
// 2. The contract forbids the excuse
// ---------------------------------------------------------------------------

test("the contract says an item you are shown is current, whatever its card's age", () => {
  const sentence = rf.CONTRACT.find((line) => /whatever its card/i.test(line));
  assert.ok(sentence, "the contract carries the no-stale-excuse rule");
  assert.match(sentence, /outstanding and current/i);
  assert.match(sentence, /reviewer_last_changed_at/);
  assert.match(sentence, /card_first_created_at/);
  assert.match(sentence, /already done/i);
});

// ---------------------------------------------------------------------------
// 3. A refusal carries words
// ---------------------------------------------------------------------------

const REVIEW = "rev_test";

function aStateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-refusal-"));
  fs.mkdirSync(path.join(dir, "reviews", REVIEW), { recursive: true });
  return dir;
}

async function runReply(dir, args) {
  const out = [];
  const err = [];
  const code = await reply.run(["--review", REVIEW, "--state-dir", dir].concat(args), {
    stdout: (text) => out.push(String(text)),
    stderr: (text) => err.push(String(text)),
    stdinIsTty: true
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

test("not_handled with a blank reason fails with a message that says what to write, and writes nothing", async () => {
  for (const blank of ["", "   ", "\n"]) {
    const dir = aStateDir();
    const result = await runReply(dir, ["--item", "itm_one", "--rev", "3", "--status", "not_handled", "--reason", blank]);
    assert.equal(result.code, protocol.CLI_EXIT.BAD_USAGE, "a blank reason is not a reason");
    assert.match(result.stderr, /--reason/);
    assert.match(result.stderr, /what you checked/i);
    assert.equal(fs.existsSync(path.join(dir, "reviews", REVIEW, "replies.jsonl")), false, "nothing is written");
  }
});

test("not_handled with a real reason still works", async () => {
  const dir = aStateDir();
  const result = await runReply(dir, [
    "--item", "itm_one", "--rev", "3", "--status", "not_handled",
    "--reason", "Looked at site/blog/new-debugging-hell.html: the line already reads without [et al]."
  ]);
  assert.equal(result.code, protocol.CLI_EXIT.OK, result.stderr);
  const raw = fs.readFileSync(path.join(dir, "reviews", REVIEW, "replies.jsonl"), "utf8");
  assert.match(raw, /new-debugging-hell/);
});

test("question with nothing in it fails too", async () => {
  const dir = aStateDir();
  const result = await runReply(dir, ["--item", "itm_one", "--rev", "1", "--status", "question", "--text", "  "]);
  assert.equal(result.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(result.stderr, /--text/);
  assert.equal(fs.existsSync(path.join(dir, "reviews", REVIEW, "replies.jsonl")), false);
});

test("a hand-appended refusal with a blank reason is rejected by the fold, not shown as an empty refusal", () => {
  const line = JSON.stringify({ item: "itm_one", rev: 3, status: "not_handled", agent: "claude", reason: "   " });
  const parsed = protocol.parseReplyLine(line, { filenameAgent: "claude" });
  assert.equal(parsed.ok, false, "whitespace is not a reason");
  assert.equal(parsed.code, "REPLY_LINE_MALFORMED");
  assert.match(parsed.reason, /reason/);

  const good = JSON.stringify({ item: "itm_one", rev: 3, status: "not_handled", reason: "checked the page" });
  assert.equal(protocol.parseReplyLine(good, { filenameAgent: null }).ok, true);
});
