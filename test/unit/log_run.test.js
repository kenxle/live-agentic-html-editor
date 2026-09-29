// The helper's check on a run record, at append (free-writing plan Task 2.8).
//
// A forged run event is refused with its code and never reaches events.jsonl
// or review.json. A valid run is stored and projected whole. The size tests
// compute the sizes; none of them assume a number.
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
const service = require("../../src/service/index.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");

const fx = () => createFixtures({ seed: "logrun" });

let counter = 0;
function eventFor(reviewId, item) {
  counter += 1;
  return protocol.newEvent({
    event: protocol.EVENT.ITEM_READY,
    event_id: "evt_logrun_" + counter,
    review: reviewId,
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    page_path: item[record.FIELD.PAGE_PATH],
    page_title: item[record.FIELD.PAGE_TITLE],
    page_seq: item[record.FIELD.PAGE_SEQ],
    payload: { draft: false, record: item }
  });
}

function setup(reviewId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-logrun-"));
  const log = logModule.createEventLog({ dir: dir });
  stateDir.ensureReviewDir(dir, reviewId);
  const projector = projection.createProjector({ dir: dir, log: log });
  projector.watch(reviewId);
  return { dir, log, projector, file: stateDir.reviewJsonPath(dir, reviewId) };
}

function reviewJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("every forged run is refused with its code, and nothing reaches the log or review.json", () => {
  const forged = fx().forgedRuns();
  assert.ok(forged.length >= 4);
  forged.forEach((f, i) => {
    const reviewId = "rlogrun0000f" + i;
    const { log, projector, file } = setup(reviewId);
    const event = eventFor(reviewId, f.item);
    const result = log.append(reviewId, [event]);
    assert.deepEqual(result.accepted, [], f.name);
    assert.equal(result.rejected.length, 1, f.name);
    assert.equal(result.rejected[0].code, f.code, f.name);
    assert.equal(result.rejected[0].event_id, event.event_id, f.name);
    assert.equal(typeof result.rejected[0].reason, "string");
    assert.deepEqual(log.read(reviewId), [], f.name + ": events.jsonl holds nothing");
    projector.tickReview(reviewId);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    assert.equal(text.indexOf(f.item.id), -1, f.name + ": review.json never names it");
    projector.stop();
  });
});

test("a refused event does not burn its event_id: the same id, fixed, is stored", () => {
  const reviewId = "rlogrun0000id";
  const { log } = setup(reviewId);
  const bad = fx().forgedRuns()[0].item;
  const event = eventFor(reviewId, bad);
  assert.equal(log.append(reviewId, [event]).rejected.length, 1);
  const good = fx().runFixtures()[0].item;
  const fixed = Object.assign({}, event, { record: good });
  assert.deepEqual(log.append(reviewId, [fixed]).accepted, [event.event_id]);
});

test("a valid run is stored and projected whole", () => {
  const reviewId = "rlogrun00ok01";
  const { log, projector, file } = setup(reviewId);
  const item = fx().runFixtures()[0].item;
  const result = log.append(reviewId, [eventFor(reviewId, item)]);
  assert.equal(result.accepted.length, 1);
  assert.deepEqual(result.rejected, []);
  projector.tickReview(reviewId);
  const projected = reviewJson(file).pages.reduce((o, pg) => o.concat(pg.items), []).find((x) => x.id === item.id);
  assert.ok(projected, "the run is in review.json");
  assert.deepEqual(
    projected.new_blocks.map((b) => ({ tag: b.tag, html: b.html })),
    item.new_blocks.map((b) => ({ tag: b.tag, html: b.html }))
  );
  assert.equal(projected.placement, item.placement);
  projector.stop();
});

// A block of exactly `bytes` UTF-8 bytes of clean markup.
function blockOf(i, bytes) {
  const head = "Block " + i + " ";
  return { tag: "p", html: head + "x".repeat(bytes - head.length) };
}

// A run at both block ceilings, taken through bumpRev `revisions` times, each
// revision rewording one block, the way a reviewer's sittings grow history.
function ceilingRun(revisions) {
  const per = record.NEW_BLOCKS_MAX_BYTES / record.NEW_BLOCKS_MAX;
  const blocks = [];
  for (let i = 0; i < record.NEW_BLOCKS_MAX; i += 1) blocks.push(blockOf(i, per));
  let item = fx().runItem({ new_blocks: blocks });
  for (let r = 0; r < revisions; r += 1) {
    const next = item.new_blocks.slice();
    const i = r % next.length;
    const html = next[i].html;
    next[i] = { tag: "p", html: html.slice(0, html.length - 1) + String.fromCharCode(97 + (r % 26)) };
    const built = record.buildRunAfter(item.anchor_after_html, next);
    item = record.bumpRev(item, { new_blocks: next, after_html: built.after_html, after: built.after });
  }
  return item;
}

function postedBytes(reviewId, item) {
  return Buffer.byteLength(JSON.stringify({ review: reviewId, events: [eventFor(reviewId, item)] }), "utf8");
}

test("a record at both block ceilings with RUN_HISTORY_KEEP full entries fits the body limit", () => {
  const item = ceilingRun(record.RUN_HISTORY_KEEP);
  assert.equal(item.new_blocks.length, record.NEW_BLOCKS_MAX);
  assert.equal(record.blocksBytes(item.new_blocks), record.NEW_BLOCKS_MAX_BYTES);
  const full = item.after_history.filter((h) => Array.isArray(h.new_blocks) && typeof h.after_html === "string");
  assert.ok(full.length >= record.RUN_HISTORY_KEEP, "the history carries the kept full entries");
  assert.equal(record.validateRun(item), null, "the helper accepts it");
  assert.ok(postedBytes("rlogrunsize01", item) < service.MAX_BODY_BYTES);
});

test("older history entries push the record over RUN_RECORD_MAX_BYTES, and it is refused", () => {
  // Grow the history one revision at a time. Every record the helper accepts
  // fits under MAX_BODY_BYTES as a posted event; the first one past the
  // record ceiling is refused with RUN_OVER_CEILING.
  const reviewId = "rlogrunsize02";
  const { log } = setup(reviewId);
  let item = ceilingRun(record.RUN_HISTORY_KEEP);
  let refused = null;
  for (let r = 0; r < 200 && !refused; r += 1) {
    const verdict = record.validateRun(item);
    if (verdict) {
      refused = verdict;
      break;
    }
    assert.ok(postedBytes(reviewId, item) < service.MAX_BODY_BYTES, "revision " + item.rev + " fits the body limit");
    const next = item.new_blocks.slice();
    const i = r % next.length;
    next[i] = { tag: "p", html: next[i].html.slice(0, -1) + (r % 2 ? "y" : "z") };
    const built = record.buildRunAfter(item.anchor_after_html, next);
    item = record.bumpRev(item, { new_blocks: next, after_html: built.after_html, after: built.after });
  }
  assert.ok(refused, "the record crossed the ceiling within the loop");
  assert.equal(refused.code, "RUN_OVER_CEILING");
  assert.ok(record.recordBytes(item) > record.RUN_RECORD_MAX_BYTES);
  const result = log.append(reviewId, [eventFor(reviewId, item)]);
  assert.equal(result.rejected[0].code, "RUN_OVER_CEILING");
  assert.deepEqual(log.read(reviewId), []);
});
