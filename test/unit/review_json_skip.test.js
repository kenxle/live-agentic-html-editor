// review.json is rewritten only when something an agent can see changed.
//
// Owner: 3A. The spec is
// docs/features/20260922.01_draft_write_cost/01_spec_draft_write_cost.md,
// requirement 1. A draft save is an event the projection withholds, so the
// file's bytes do not change apart from `generated_at`. Before this, every
// draft post rewrote the whole file with an fsync.
//
// The comparison is against the bytes THIS process last wrote, with
// `generated_at` left out. The baseline starts empty, so a helper that just
// started (perhaps with new contract text) always writes once. A file someone
// deleted is written again.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logModule = require("../../src/service/log.js");
const stateDir = require("../../src/service/state_dir.js");
const projection = require("../../src/service/projection.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");

let counter = 0;
function eventId() {
  counter += 1;
  return "evt_skip_" + counter;
}

function itemOf(overrides) {
  return record.newItem(
    Object.assign(
      {
        kind: record.KIND.COMMENT,
        state: record.STATE.READY,
        note: "the reviewer's own words",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/",
        page_title: "Page",
        page_seq: 1
      },
      overrides || {}
    )
  );
}

function post(log, reviewId, type, item, draft) {
  log.append(reviewId, [
    protocol.newEvent({
      event: type,
      event_id: eventId(),
      review: reviewId,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: !!draft, record: item }
    })
  ]);
  return item;
}

function setup(reviewId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-skip-"));
  const log = logModule.createEventLog({ dir: dir });
  stateDir.ensureReviewDir(dir, reviewId);
  post(log, reviewId, protocol.EVENT.ITEM_READY, itemOf({ id: "itm_first", note: "a ready comment" }));
  const projector = projection.createProjector({ dir: dir, log: log });
  projector.watch(reviewId);
  const file = stateDir.reviewJsonPath(dir, reviewId);
  // Back-date the file so an unwanted rewrite shows in the modified time even
  // on a filesystem with coarse timestamps.
  const past = new Date(Date.now() - 60 * 1000);
  fs.utimesSync(file, past, past);
  return { dir, log, projector, file };
}

function snapshot(file) {
  return { bytes: fs.readFileSync(file, "utf8"), mtimeMs: fs.statSync(file).mtimeMs };
}

test("a draft-only event leaves review.json's bytes and modified time untouched", () => {
  const reviewId = "rskip00000001";
  const { log, projector, file } = setup(reviewId);
  const before = snapshot(file);
  const writesBefore = projector.counters.writes;

  const draft = itemOf({ id: "itm_draft", state: record.STATE.DRAFT, note: "half a thou" });
  post(log, reviewId, protocol.EVENT.ITEM_CREATED, draft, true);
  projector.tickReview(reviewId);
  post(log, reviewId, protocol.EVENT.ITEM_CONTENT, Object.assign({}, draft, { note: "half a thought" }), true);
  const result = projector.tickReview(reviewId);

  const after = snapshot(file);
  assert.equal(result.wrote, false, "the tick reports it wrote nothing");
  assert.equal(projector.counters.writes, writesBefore, "no write was counted");
  assert.equal(after.bytes, before.bytes, "the bytes did not change, generated_at included");
  assert.equal(after.mtimeMs, before.mtimeMs, "the file was not replaced");
  projector.stop();
});

test("a ready event rewrites review.json", () => {
  const reviewId = "rskip00000002";
  const { log, projector, file } = setup(reviewId);
  const before = snapshot(file);

  post(log, reviewId, protocol.EVENT.ITEM_READY, itemOf({ id: "itm_second", note: "now it is ready" }));
  const result = projector.tickReview(reviewId);

  const after = snapshot(file);
  assert.equal(result.wrote, true);
  assert.notEqual(after.mtimeMs, before.mtimeMs, "the file was replaced");
  assert.ok(after.bytes.indexOf("now it is ready") !== -1, "and it carries the new item");
  projector.stop();
});

test("a reply rewrites review.json", () => {
  const reviewId = "rskip00000003";
  const { dir, projector, file } = setup(reviewId);
  const before = snapshot(file);

  fs.writeFileSync(
    stateDir.replyFilePath(dir, reviewId, "replies-claude.jsonl"),
    JSON.stringify({ item: "itm_first", rev: 1, status: "handled", agent: "claude" }) + "\n",
    { mode: 0o600 }
  );
  const result = projector.tickReview(reviewId);

  const after = snapshot(file);
  assert.equal(result.wrote, true);
  assert.notEqual(after.mtimeMs, before.mtimeMs);
  const parsed = JSON.parse(after.bytes);
  assert.equal(parsed.pages[0].items[0].state, "handled");
  projector.stop();
});

test("a helper that just started writes review.json once even when the bytes already on disk match", () => {
  const reviewId = "rskip00000004";
  const { dir, log, projector, file } = setup(reviewId);
  projector.stop();
  const before = snapshot(file);

  // A second process over the same directory: its baseline is empty, so it
  // writes, which is how new contract text reaches a file an older helper wrote.
  const fresh = projection.createProjector({ dir: dir, log: log });
  fresh.watch(reviewId);
  assert.equal(fresh.counters.writes, 1);
  assert.notEqual(snapshot(file).mtimeMs, before.mtimeMs);
  fresh.stop();
});

test("a review.json someone deleted is written again on the next draft save", () => {
  const reviewId = "rskip00000005";
  const { log, projector, file } = setup(reviewId);
  fs.unlinkSync(file);

  const draft = itemOf({ id: "itm_draft2", state: record.STATE.DRAFT, note: "typing" });
  post(log, reviewId, protocol.EVENT.ITEM_CREATED, draft, true);
  const result = projector.tickReview(reviewId);

  assert.equal(result.wrote, true);
  assert.equal(fs.existsSync(file), true, "the missing file came back");
  projector.stop();
});
