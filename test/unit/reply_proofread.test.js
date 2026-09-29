// `lahe reply --proofread --suggest <block> <from> <to>` (free-writing plan
// Task 2.12, architecture "The proofreading reply").
//
// The agent never writes the suggestions' JSON by hand. The command reads the
// item from review.json at the rev it names and refuses, by name, a
// suggestion record.applySuggestions would refuse.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const reply = require("../../src/cli/commands/reply.js");
const protocol = require("../../src/shared/protocol.js");
const logModule = require("../../src/service/log.js");
const stateDir = require("../../src/service/state_dir.js");
const projection = require("../../src/service/projection.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");

const REVIEW = "rproofread01";

// A state folder whose review.json holds one ready run record, projected the
// way the helper projects it.
function aReview(item) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-proofread-"));
  const log = logModule.createEventLog({ dir: dir });
  stateDir.ensureReviewDir(dir, REVIEW);
  log.append(REVIEW, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "evt_proofread_1",
      review: REVIEW,
      item: item.id,
      rev: item.rev,
      page_path: item.page_path,
      page_title: item.page_title,
      page_seq: item.page_seq,
      payload: { draft: false, record: item }
    })
  ]);
  const projector = projection.createProjector({ dir: dir, log: log });
  projector.watch(REVIEW);
  projector.tickReview(REVIEW);
  projector.stop();
  return dir;
}

function runItem() {
  return createFixtures({ seed: "proofread" }).runItem({
    new_blocks: [
      { tag: "h2", html: "What the chat window cost me" },
      { tag: "p", html: "I lost my place every time, and the place was the the point." }
    ]
  });
}

async function run(dir, args) {
  const stdout = [];
  const stderr = [];
  const code = await reply.run(["--review", REVIEW, "--state-dir", dir].concat(args), {
    stdout: (t) => stdout.push(String(t)),
    stderr: (t) => stderr.push(String(t)),
    stdinIsTty: true
  });
  return { code, stdout: stdout.join(""), stderr: stderr.join("") };
}

function lastLine(dir) {
  const file = path.join(dir, "reviews", REVIEW, "replies.jsonl");
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  return lines[lines.length - 1];
}

test("--proofread and --suggest write a question line with proofread and suggestions, which the parser accepts", async () => {
  const item = runItem();
  const dir = aReview(item);
  const r = await run(dir, [
    "--item", item.id, "--rev", String(item.rev), "--status", "question",
    "--text", "I placed your words as written. Two fixes you may want.",
    "--proofread",
    "--suggest", "0", "cost me", "cost us",
    "--suggest", "1", "the the", "the"
  ]);
  assert.equal(r.code, protocol.CLI_EXIT.OK, r.stderr);
  const line = lastLine(dir);
  const parsed = protocol.parseReplyLine(line);
  assert.equal(parsed.ok, true, parsed.reason);
  assert.equal(parsed.reply.proofread, true);
  assert.deepEqual(parsed.reply.suggestions, [
    { block: 0, from: "cost me", to: "cost us" },
    { block: 1, from: "the the", to: "the" }
  ]);
});

test("--suggest on a handled reply is refused, and nothing is written", async () => {
  const item = runItem();
  const dir = aReview(item);
  const r = await run(dir, [
    "--item", item.id, "--rev", String(item.rev), "--status", "handled",
    "--proofread", "--suggest", "0", "cost me", "cost us"
  ]);
  assert.equal(r.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(r.stderr, /question/);
  assert.equal(lastLine(dir), null);
});

test("--suggest without --proofread is refused", async () => {
  const item = runItem();
  const dir = aReview(item);
  const r = await run(dir, [
    "--item", item.id, "--rev", String(item.rev), "--status", "question", "--text", "Fixes?",
    "--suggest", "0", "cost me", "cost us"
  ]);
  assert.equal(r.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(r.stderr, /--proofread/);
  assert.equal(lastLine(dir), null);
});

test("a suggestion whose from appears twice in its block is refused, and the message names it", async () => {
  const item = runItem();
  const dir = aReview(item);
  const r = await run(dir, [
    "--item", item.id, "--rev", String(item.rev), "--status", "question", "--text", "Fixes?",
    "--proofread",
    "--suggest", "0", "cost me", "cost us",
    "--suggest", "1", "place", "spot"
  ]);
  assert.equal(r.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(r.stderr, /SUGGESTION_NOT_FOUND/);
  assert.match(r.stderr, /--suggest 1 "place" "spot"/);
  assert.doesNotMatch(r.stderr, /cost me/, "only the refused suggestion is named");
  assert.equal(lastLine(dir), null);
});

test("--proofread on an item at another rev is refused: the words it names are not that revision's", async () => {
  const item = runItem();
  const dir = aReview(item);
  const r = await run(dir, [
    "--item", item.id, "--rev", String(item.rev + 1), "--status", "question", "--text", "Fixes?",
    "--proofread", "--suggest", "0", "cost me", "cost us"
  ]);
  assert.equal(r.code, protocol.CLI_EXIT.BAD_USAGE);
  assert.match(r.stderr, /rev/);
  assert.equal(lastLine(dir), null);
});

test("--suggest needs a whole-number block", async () => {
  const args = reply.parseArgs(["--review", REVIEW, "--item", "itm_x", "--rev", "1", "--status", "question",
    "--text", "t", "--proofread", "--suggest", "one", "a", "b"]);
  assert.match(args.error, /--suggest/);
});
