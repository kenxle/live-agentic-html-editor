// Ranked test 36: the helper refuses a symlink inside its data directory, an
// unsafe review id, an unsafe agent segment in a reply filename, and a write
// outside its data directory.
//
// Owner: 1A. Architecture D11 and the Data and state section.
//
// These are refusals, so every assertion here is that something THROWS. The
// paired positive case is next to each one, because a path helper that refuses
// everything passes a file full of assert.throws and ships a helper that cannot
// write its own log.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const stateDir = require("../../src/service/state_dir.js");
const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");
const protocol = require("../../src/shared/protocol.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lahe-paths-"));
}

test("an unsafe review id is refused, and a safe one is not", () => {
  const dir = tempDir();
  const unsafe = ["../escape", "a/b", "..", "", ".hidden", "has space", "x".repeat(100), null, 7];
  for (const id of unsafe) {
    assert.throws(
      () => stateDir.eventsPath(dir, id),
      /path components|safe id|non-empty|separator/,
      "accepted an unsafe review id: " + JSON.stringify(id)
    );
  }
  assert.match(stateDir.eventsPath(dir, "review-1"), /reviews\/review-1\/events\.jsonl$/);
});

test("a write outside the data directory is refused", () => {
  const dir = tempDir();
  assert.throws(() => stateDir.resolveWithin(dir, ["..", "elsewhere"]), /separator|outside/);
  assert.throws(() => stateDir.resolveWithin(dir, ["/etc/passwd"]), /separator/);
  assert.throws(() => stateDir.resolveWithin(dir, ["reviews", "..\\..\\escape"]), /separator/);
  // The positive: an ordinary path under the directory resolves.
  assert.equal(
    stateDir.resolveWithin(dir, ["reviews", "review-1"]),
    path.join(dir, "reviews", "review-1")
  );
});

test("a symlink inside the data directory is refused rather than followed", () => {
  const dir = tempDir();
  const outside = path.join(tempDir(), "somewhere-else");
  fs.mkdirSync(outside, { recursive: true });
  fs.mkdirSync(path.join(dir, "reviews"), { recursive: true });

  // A symlinked review directory. Following it turns an append-only log into an
  // append-anywhere primitive, and the append itself is the whole attack.
  fs.symlinkSync(outside, path.join(dir, "reviews", "review-1"));
  assert.throws(() => stateDir.eventsPath(dir, "review-1"), /symlink/);

  // A symlinked log file inside a real review directory, which is the subtler
  // shape: the directory checks out and the file does not.
  fs.mkdirSync(path.join(dir, "reviews", "review-2"), { recursive: true });
  fs.symlinkSync(path.join(outside, "target.jsonl"), path.join(dir, "reviews", "review-2", "events.jsonl"));
  assert.throws(() => stateDir.eventsPath(dir, "review-2"), /symlink/);

  // The positive: an ordinary review directory with no symlink in it resolves.
  fs.mkdirSync(path.join(dir, "reviews", "review-3"), { recursive: true });
  assert.ok(stateDir.eventsPath(dir, "review-3").endsWith("review-3/events.jsonl"));
});

test("an unsafe agent segment in a reply filename is refused", () => {
  const dir = tempDir();
  const unsafe = [
    "replies-../escape.jsonl",
    "replies-a/b.jsonl",
    "replies-.jsonl",
    "replies.jsonl.bak",
    "notes.jsonl",
    "replies-" + "x".repeat(100) + ".jsonl"
  ];
  for (const name of unsafe) {
    assert.throws(
      () => stateDir.replyFilePath(dir, "review-1", name),
      /reply file name|unsafe agent|separator/,
      "accepted an unsafe reply filename: " + name
    );
  }
  // The positives, both shapes the contract names.
  assert.ok(stateDir.replyFilePath(dir, "review-1", "replies.jsonl").endsWith("replies.jsonl"));
  assert.ok(stateDir.replyFilePath(dir, "review-1", "replies-claude.jsonl").endsWith("replies-claude.jsonl"));
});

test("the state directory refuses to sit inside a checkout", () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, ".git"), { recursive: true });
  const inside = path.join(dir, "state");

  const saved = process.env.LAHE_STATE_DIR;
  process.env.LAHE_STATE_DIR = inside;
  try {
    assert.throws(() => stateDir.stateDir(), /outside any checkout/);
    // The escape hatch exists for the repo's own tooling and says so.
    assert.equal(stateDir.stateDir({ allowInsideCheckout: true }), inside);
  } finally {
    if (saved === undefined) delete process.env.LAHE_STATE_DIR;
    else process.env.LAHE_STATE_DIR = saved;
  }
});

test("a printed command names the state directory only when the default would miss it", () => {
  const dir = tempDir();
  const custom = path.join(dir, "elsewhere");

  const saved = process.env.LAHE_STATE_DIR;
  const savedXdg = process.env.XDG_STATE_HOME;
  try {
    process.env.LAHE_STATE_DIR = path.join(dir, "state");
    delete process.env.XDG_STATE_HOME;

    // A directory the default resolution would not reach: the flag is the only
    // thing that makes the copied command read the right reviews.
    assert.equal(stateDir.flagFor(custom), custom);

    // The env already points here, so a copied command resolves the same place
    // on its own and the flag would be noise on every command an agent runs.
    assert.equal(stateDir.flagFor(path.join(dir, "state")), null);
    assert.equal(stateDir.flagFor(null), null);

    // Relative paths are resolved before they are compared, so "." next to the
    // state directory is not mistaken for a different one.
    assert.equal(stateDir.flagFor(path.join(dir, "state", ".")), null);
  } finally {
    if (saved === undefined) delete process.env.LAHE_STATE_DIR;
    else process.env.LAHE_STATE_DIR = saved;
    if (savedXdg === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = savedXdg;
  }
});

test("the data directory and its files are owner-only", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  const reviews = reviewsModule.createReviews({ dir: dir, log: log });
  reviews.create({ id: "review-1", origins: ["http://127.0.0.1:3000"] });

  const modeOf = (target) => fs.statSync(target).mode & 0o777;
  assert.equal(modeOf(path.join(dir, "reviews", "review-1")), 0o700);
  assert.equal(modeOf(stateDir.eventsPath(dir, "review-1")), 0o600);
  assert.equal(modeOf(stateDir.metaPath(dir, "review-1")), 0o600);
  assert.equal(modeOf(stateDir.helperLogPath(dir)), 0o600);
});

test("events are idempotent by event_id, never by (item, rev)", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });

  const draft = (eventId, text) =>
    protocol.newEvent({
      event: protocol.EVENT.ITEM_CONTENT,
      event_id: eventId,
      review: "review-1",
      item: "c_1",
      rev: 1,
      payload: { draft: true, text: text }
    });

  // Two DIFFERENT draft keystroke batches share an item and a rev. Keying
  // idempotence on (item, rev) would drop the second and lose the sentence.
  const first = log.append("review-1", [draft("ev_1", "The qui")]);
  const second = log.append("review-1", [draft("ev_2", "The quick brown")]);
  assert.deepEqual(first.accepted, ["ev_1"]);
  assert.deepEqual(second.accepted, ["ev_2"]);

  // The same event posted twice, which is what every reconnect does.
  const again = log.append("review-1", [draft("ev_2", "The quick brown")]);
  assert.deepEqual(again.accepted, []);
  assert.deepEqual(again.duplicates, ["ev_2"]);
  assert.equal(log.read("review-1").length, 2);

  // seq is the helper's, monotonic, one per stored event.
  assert.deepEqual(log.read("review-1").map((e) => e.seq), [1, 2]);
});

test("a torn final line costs the last line and never the history", () => {
  const dir = tempDir();
  const log = logModule.createEventLog({ dir: dir });
  log.append("review-1", [
    protocol.newEvent({ event: protocol.EVENT.ITEM_CREATED, event_id: "ev_1", review: "review-1" }),
    protocol.newEvent({ event: protocol.EVENT.ITEM_CREATED, event_id: "ev_2", review: "review-1" })
  ]);

  // What a kill -9 in the middle of a write leaves behind.
  const logPath = stateDir.eventsPath(dir, "review-1");
  fs.appendFileSync(logPath, '{"event":"item.created","event_id":"ev_3","re');

  const reopened = logModule.createEventLog({ dir: dir });
  const history = reopened.read("review-1");
  assert.equal(history.length, 2, "the two complete lines are still readable");
  assert.deepEqual(history.map((e) => e.event_id), ["ev_1", "ev_2"]);

  // And the next append does not splice itself onto the wreckage.
  reopened.append("review-1", [
    protocol.newEvent({ event: protocol.EVENT.ITEM_CREATED, event_id: "ev_4", review: "review-1" })
  ]);
  const after = reopened.read("review-1");
  assert.deepEqual(after.map((e) => e.event_id), ["ev_1", "ev_2", "ev_4"]);
  assert.deepEqual(after.map((e) => e.seq), [1, 2, 3]);
});
