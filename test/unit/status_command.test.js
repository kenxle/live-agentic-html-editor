// `lahe status`: the read path beside `wait`'s blocking one.
//
// These tests build a review's log on disk directly and read it back through
// the command, because that is the path an agent takes with no helper running,
// and because a projection is a pure function of the log: the same items come
// back through the helper.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const logModule = require("../../src/service/log.js");
const status = require("../../src/cli/commands/status.js");

function tempState() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-status-"));
}

/** One item as the library would have posted it. */
function itemEvent(reviewId, item, type) {
  return protocol.newEvent({
    event: type,
    event_id: "ev_" + Math.random().toString(16).slice(2),
    review: reviewId,
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    page_path: item[record.FIELD.PAGE_PATH],
    page_seq: item[record.FIELD.PAGE_SEQ],
    payload: { draft: record.isDraft(item), record: item }
  });
}

function seed(dir, reviewId, items) {
  const log = logModule.createEventLog({ dir: dir });
  log.append(reviewId, [
    protocol.newEvent({
      event: protocol.EVENT.REVIEW_CREATED,
      event_id: "ev_created",
      review: reviewId,
      payload: { token: "t".repeat(8) }
    })
  ]);
  items.forEach((item) => {
    log.append(reviewId, [
      itemEvent(reviewId, item, record.isDraft(item) ? protocol.EVENT.ITEM_CREATED : protocol.EVENT.ITEM_READY)
    ]);
  });
  return log;
}

function anItem(note, state) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: state,
    note: note,
    page_origin: "http://127.0.0.1:8000",
    page_path: "/report.html",
    page_seq: 1
  });
}

async function runStatus(args, dir) {
  const out = [];
  const err = [];
  const code = await status.run(args, {
    stateDir: dir,
    stdout: (text) => out.push(text),
    stderr: (text) => err.push(text)
  });
  return { code, stdout: out.join(""), stderr: err.join("") };
}

test("unanswered ready is the one definition: ready, with no reply on it", () => {
  const ready = { id: "c_1", state: record.STATE.READY, reply: null };
  const answered = { id: "c_2", state: record.STATE.READY, reply: { status: "question" } };
  const draft = { id: "c_3", state: record.STATE.DRAFT, reply: null };
  const handled = { id: "c_4", state: record.STATE.HANDLED, reply: { status: "handled" } };

  assert.equal(status.isUnansweredReady(ready), true);
  assert.equal(status.isUnansweredReady(answered), false, "an answered item is not waiting on the agent");
  assert.equal(status.isUnansweredReady(draft), false, "a draft is the reviewer still writing");
  assert.equal(status.isUnansweredReady(handled), false);
});

test("status prints a per-review summary and the items that are waiting", async () => {
  const dir = tempState();
  seed(dir, "rev1", [anItem("tighten this headline", record.STATE.READY), anItem("half a thought", record.STATE.DRAFT)]);

  const run = await runStatus([], dir);
  assert.equal(run.code, protocol.WAIT.EXIT.NEW_WORK, run.stderr);
  assert.match(run.stdout, /review rev1/);
  assert.match(run.stdout, /\/report\.html/);
  assert.match(run.stdout, /1 ready for you/);
  assert.match(run.stdout, /tighten this headline/);
  // The draft is COUNTED and named, and never listed as work.
  assert.match(run.stdout, /drafts    1/);
  assert.equal(run.stdout.indexOf("half a thought"), -1, "a draft is never listed as something to act on");
});

test("with no helper up, liveness is unknown rather than a stale number", async () => {
  const dir = tempState();
  seed(dir, "rev1", [anItem("one comment", record.STATE.READY)]);
  const run = await runStatus([], dir);
  assert.match(run.stdout, /page last seen unknown/);
  assert.match(run.stdout, /last comment/);
});

test("--json prints one line per unanswered item, then a summary line", async () => {
  const dir = tempState();
  seed(dir, "rev1", [anItem("fix the footer", record.STATE.READY), anItem("still typing", record.STATE.DRAFT)]);

  const run = await runStatus(["--json"], dir);
  assert.equal(run.code, protocol.WAIT.EXIT.NEW_WORK, run.stderr);
  const lines = run.stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(lines.length, 2, "one item, then the summary");
  assert.equal(lines[0].note, "fix the footer");
  assert.equal(lines[0].review, "rev1");
  assert.equal(lines[0].page.path, "/report.html", "the same field shapes wait prints");
  assert.equal(lines[1].unanswered_ready, 1);
  assert.equal(lines[1].reviews, 1);
});

test("--review scopes it, and an unknown one is exit UNKNOWN_REVIEW", async () => {
  const dir = tempState();
  seed(dir, "rev1", [anItem("a", record.STATE.READY)]);
  seed(dir, "rev2", [anItem("b", record.STATE.READY)]);

  const one = await runStatus(["--review", "rev2"], dir);
  assert.match(one.stdout, /review rev2/);
  assert.equal(one.stdout.indexOf("review rev1"), -1);

  const missing = await runStatus(["--review", "nope"], dir);
  assert.equal(missing.code, protocol.WAIT.EXIT.UNKNOWN_REVIEW);
});

test("an empty state directory prints that, and still exits 0", async () => {
  const dir = tempState();
  const run = await runStatus([], dir);
  assert.equal(run.code, protocol.WAIT.EXIT.NEW_WORK);
  assert.match(run.stdout, /no reviews/);
});

test("a mistyped flag is bad usage, never a silent default", async () => {
  const dir = tempState();
  const run = await runStatus(["--sicne", "3"], dir);
  assert.equal(run.code, protocol.WAIT.EXIT.BAD_USAGE);
  assert.match(run.stderr, /unknown option/);
});

test("the liveness sentence has three honest states and never invents a fourth", () => {
  assert.match(status.livenessLine({ helper_up: false, page_last_seen_at: null }), /unknown/);
  assert.match(status.livenessLine({ helper_up: true, page_last_seen_at: null }), /no page has connected yet/);
  const now = Date.now();
  assert.match(
    status.livenessLine({ helper_up: true, page_last_seen_at: new Date(now - 4000).toISOString() }, now),
    /page last seen 4s ago/
  );
});
