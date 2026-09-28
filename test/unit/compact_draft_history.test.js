// The one-time repair for the draft history that bloated events.jsonl.
//
// Before the draft write-cost fix (spec 20260922.01) the browser posted the
// whole record on about every keystroke, so a review's log holds long runs of
// item.content events marked draft, each one replaced by the next. The script
// scripts/compact_draft_history.js drops the ones a later item.content for the
// same item replaces, and nothing else. These tests pin what it drops, what it
// keeps, the proof it runs before any swap, the safe write, and the refusal
// to run beside a live helper. See
// docs/features/20260928.02_compact_draft_history/NOTES.md.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const projection = require("../../src/service/projection.js");
const compact = require("../../scripts/compact_draft_history.js");

const REVIEW = "rcompact0001";
const FIXED_AT = "2026-09-20T00:00:00.000Z";
const GENERATED_AT = "2026-09-28T00:00:00.000Z";
const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "logs");

let counter = 0;
function eventId() {
  counter += 1;
  return "evt_compact_" + counter;
}

function itemOf(id, overrides) {
  return record.newItem(
    Object.assign(
      {
        id: id,
        kind: record.KIND.COMMENT,
        state: record.STATE.DRAFT,
        note: "",
        page_origin: "http://127.0.0.1:4321",
        page_path: "/",
        page_title: "Doc",
        page_seq: 1,
        created_at: FIXED_AT
      },
      overrides || {}
    )
  );
}

function reviewCreated() {
  return protocol.newEvent({
    event: protocol.EVENT.REVIEW_CREATED,
    event_id: eventId(),
    review: REVIEW,
    ts: FIXED_AT,
    payload: { token: "t".repeat(64), agent_session_id: "s_compacttest" }
  });
}

// An item event the way sync.js builds one: the whole record rides in it, and
// `draft` says whether the record is a draft.
function itemEvent(type, rec) {
  return protocol.newEvent({
    event: type,
    event_id: eventId(),
    review: REVIEW,
    ts: FIXED_AT,
    item: rec.id,
    rev: rec.rev,
    page_path: rec.page_path,
    page_title: rec.page_title,
    page_seq: rec.page_seq,
    payload: { draft: record.isDraft(rec), record: rec }
  });
}

function content(rec) {
  return itemEvent(protocol.EVENT.ITEM_CONTENT, rec);
}

function created(rec) {
  return itemEvent(protocol.EVENT.ITEM_CREATED, rec);
}

function replyFolded(id, rev, state, reply) {
  return protocol.newEvent({
    event: protocol.EVENT.REPLY_FOLDED,
    event_id: eventId(),
    review: REVIEW,
    ts: FIXED_AT,
    item: id,
    rev: rev,
    payload: { accepted: true, state: state, refusal: null, file: "replies.jsonl", reply: reply }
  });
}

// The helper assigns seq in file order; the fixture does the same.
function logText(events) {
  return events
    .map(function (event, i) {
      const stored = Object.assign({}, event, { seq: i + 1 });
      return protocol.encodeEventLine(stored);
    })
    .join("");
}

function parse(text) {
  return text
    .split("\n")
    .filter(Boolean)
    .map(function (line) {
      return JSON.parse(line);
    });
}

function stateDirWith(text, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-compact-"));
  const reviewDir = path.join(dir, "reviews", REVIEW);
  fs.mkdirSync(reviewDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(reviewDir, "events.jsonl"), text, { mode: 0o600 });
  // Sentinels: the script must never touch these.
  fs.writeFileSync(path.join(reviewDir, "review.json"), "{\"sentinel\":\"review\"}\n", { mode: 0o600 });
  fs.writeFileSync(path.join(reviewDir, "meta.json"), "{\"sentinel\":\"meta\"}\n", { mode: 0o600 });
  fs.writeFileSync(path.join(reviewDir, "replies.jsonl"), "{\"sentinel\":\"reply\"}\n", { mode: 0o600 });
  if (extra) extra(dir);
  return { dir: dir, reviewDir: reviewDir, eventsPath: path.join(reviewDir, "events.jsonl") };
}

function snapshot(dir) {
  const out = {};
  (function walk(at) {
    fs.readdirSync(at, { withFileTypes: true }).forEach(function (entry) {
      const full = path.join(at, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        return;
      }
      const stat = fs.statSync(full);
      out[path.relative(dir, full)] = { bytes: fs.readFileSync(full).toString("base64"), mtimeMs: stat.mtimeMs };
    });
  })(dir);
  return out;
}

function quiet() {
  const lines = [];
  return {
    lines: lines,
    write: function (text) {
      lines.push(String(text));
    }
  };
}

function projectText(text) {
  const events = parse(text);
  return projection.stringify(projection.project(REVIEW, events, { generated_at: GENERATED_AT }));
}

// ---------------------------------------------------------------------------
// What is dropped
// ---------------------------------------------------------------------------

test("superseded drafts drop, and the projection is identical", () => {
  const typed = [
    itemOf("itm_a", { note: "t" }),
    itemOf("itm_a", { note: "th" }),
    itemOf("itm_a", { note: "thi" }),
    itemOf("itm_a", { note: "this" })
  ];
  const committed = itemOf("itm_a", { note: "this is it", state: record.STATE.READY });
  const events = [reviewCreated(), created(typed[0]), content(typed[1]), content(typed[2]), content(typed[3]), content(committed)];
  const text = logText(events);

  const result = compact.compactBuffer(Buffer.from(text), REVIEW);
  assert.equal(result.dropped, 3, "the three item.content drafts a later item.content replaces are dropped");
  const kept = parse(result.compacted.toString("utf8"));
  assert.deepEqual(
    kept.map((e) => e.event_id),
    [events[0].event_id, events[1].event_id, events[5].event_id],
    "review.created, the item.created and the commit stay, in order"
  );
  assert.equal(projectText(result.compacted.toString("utf8")), projectText(text));
  assert.equal(compact.proveSame(Buffer.from(text), result.compacted, REVIEW).same, true);
});

test("the last draft of an item the reviewer never sent survives", () => {
  const events = [
    reviewCreated(),
    created(itemOf("itm_unsent", { note: "I think" })),
    content(itemOf("itm_unsent", { note: "I think this" })),
    content(itemOf("itm_unsent", { note: "I think this paragraph is too long" }))
  ];
  const text = logText(events);
  const result = compact.compactBuffer(Buffer.from(text), REVIEW);
  assert.equal(result.dropped, 1);
  const items = projection.itemsFrom(parse(result.compacted.toString("utf8")));
  assert.equal(items.length, 1);
  assert.equal(items[0].state, record.STATE.DRAFT);
  assert.equal(items[0].note, "I think this paragraph is too long", "the unsent words are still in the log");
});

test("a committed event between two drafts stays, and so does another item's event", () => {
  const events = [
    reviewCreated(),
    created(itemOf("itm_b", { note: "first" })),
    content(itemOf("itm_b", { note: "first draft" })),
    content(itemOf("itm_b", { note: "first draft done", state: record.STATE.READY })),
    created(itemOf("itm_c", { note: "other", state: record.STATE.READY })),
    content(itemOf("itm_b", { note: "first draft done, reworded" })),
    content(itemOf("itm_b", { note: "first draft done, reworded again" }))
  ];
  const text = logText(events);
  const result = compact.compactBuffer(Buffer.from(text), REVIEW);
  const keptIds = parse(result.compacted.toString("utf8")).map((e) => e.event_id);
  assert.ok(keptIds.includes(events[3].event_id), "the committed item.content stays");
  assert.ok(keptIds.includes(events[4].event_id), "the other item's event stays");
  assert.ok(!keptIds.includes(events[2].event_id), "the draft the commit replaces is dropped");
  assert.ok(!keptIds.includes(events[5].event_id), "the reworded draft a later draft replaces is dropped");
  assert.ok(keptIds.includes(events[6].event_id), "the last draft stays");
  assert.equal(result.dropped, 2);
  assert.equal(projectText(result.compacted.toString("utf8")), projectText(text));
});

test("a reply stays, and a draft whose next event for its item is a reply is kept", () => {
  const ready = itemOf("itm_r", { note: "fix the title", state: record.STATE.READY });
  const events = [
    reviewCreated(),
    created(ready),
    replyFolded("itm_r", 1, record.STATE.READY, { status: "question", agent: "claude", text: "which title?" }),
    content(itemOf("itm_r", { note: "fix the title, the h1", state: record.STATE.DRAFT })),
    content(itemOf("itm_r", { note: "fix the title, the h1 one", state: record.STATE.DRAFT })),
    replyFolded("itm_r", 1, record.STATE.READY, { status: "question", agent: "claude", text: "still unsure" }),
    content(itemOf("itm_r", { note: "fix the title, the h1 one please", state: record.STATE.DRAFT })),
    content(itemOf("itm_r", { note: "fix the title, the h1 one please", state: record.STATE.READY }))
  ];
  const text = logText(events);
  const result = compact.compactBuffer(Buffer.from(text), REVIEW);
  const keptIds = parse(result.compacted.toString("utf8")).map((e) => e.event_id);
  assert.ok(keptIds.includes(events[2].event_id), "the first reply stays");
  assert.ok(keptIds.includes(events[5].event_id), "the second reply stays");
  assert.ok(!keptIds.includes(events[3].event_id), "a draft replaced by the next draft is dropped");
  assert.ok(keptIds.includes(events[4].event_id), "the draft right before a reply is kept: the reply reads it");
  assert.equal(result.narrowed.next_not_content, 1);
  assert.equal(projectText(result.compacted.toString("utf8")), projectText(text));
  assert.equal(compact.proveSame(Buffer.from(text), result.compacted, REVIEW).same, true);
});

// ---------------------------------------------------------------------------
// When dropping would change the result
// ---------------------------------------------------------------------------

// The continuation shape (projection.js, the thread branch of the item fold).
// The agent asked a question on rev 1. The reviewer starts an answer, which
// the browser posts as a draft at rev 2 with one more round in its thread, and
// the fold copies the helper's reply into that round. The next event, also rev
// 2, carries the browser's own copy of the round. Without the draft, the next
// event would be the one the fold patches, and its thread would change.
function continuationEvents() {
  const asked = itemOf("itm_q", { note: "shorten this", state: record.STATE.READY });
  const helperReply = { status: "question", agent: "claude", text: "the helper's winning reply" };
  const draftAnswer = itemOf("itm_q", {
    rev: 2,
    note: "shorten this, the second paragraph",
    state: record.STATE.DRAFT,
    thread: [{ note: "shorten this", agent: { status: "question", agent: "claude", text: "draft copy" } }]
  });
  const sentAnswer = itemOf("itm_q", {
    rev: 2,
    note: "shorten this, the second paragraph",
    state: record.STATE.READY,
    thread: [{ note: "shorten this", agent: { status: "question", agent: "claude", text: "the browser's stale copy" } }]
  });
  return [
    reviewCreated(),
    created(asked),
    replyFolded("itm_q", 1, record.STATE.READY, helperReply),
    content(draftAnswer),
    content(sentAnswer)
  ];
}

test("a draft whose removal would change how the next event folds is kept", () => {
  const events = continuationEvents();
  const text = logText(events);
  const result = compact.compactBuffer(Buffer.from(text), REVIEW);
  assert.equal(result.dropped, 0, "the draft carries the continuation, so it stays");
  assert.equal(result.narrowed.fold_differs, 1);
  assert.equal(result.compacted.toString("utf8"), text);
});

test("a review whose compacted log would project differently is left alone", () => {
  const events = continuationEvents();
  const text = logText(events);
  const { dir, eventsPath, reviewDir } = stateDirWith(text);
  const before = snapshot(dir);

  // A naive planner that drops every superseded draft, the rule without its
  // narrowing. The proof has to catch it and leave the review untouched.
  const naive = function (lines) {
    const drops = new Set();
    lines.forEach(function (line, i) {
      if (!line.event || line.event.event !== protocol.EVENT.ITEM_CONTENT || line.event.draft !== true) return;
      for (let j = i + 1; j < lines.length; j += 1) {
        const later = lines[j].event;
        if (later && later.event === protocol.EVENT.ITEM_CONTENT && later.item === line.event.item) {
          drops.add(i);
          return;
        }
      }
    });
    return { drops: drops, narrowed: {} };
  };

  const report = compact.compactReview({ dir: dir, review: REVIEW, apply: true, planner: naive });
  assert.equal(report.check, "failed");
  assert.equal(report.applied, false);
  assert.match(report.reason, /differ/);
  assert.deepEqual(snapshot(dir), before, "nothing in the state directory changed");
  assert.equal(fs.readFileSync(eventsPath, "utf8"), text);
  assert.equal(fs.existsSync(path.join(reviewDir, "events.jsonl.pre-compact.gz")), false);
});

// ---------------------------------------------------------------------------
// The safe write
// ---------------------------------------------------------------------------

function bloatedEvents() {
  const events = [reviewCreated(), created(itemOf("itm_w", { note: "a" }))];
  let note = "a";
  for (let i = 0; i < 30; i += 1) {
    note += "b";
    events.push(content(itemOf("itm_w", { note: note })));
  }
  events.push(content(itemOf("itm_w", { note: note + " done", state: record.STATE.READY })));
  return events;
}

test("--apply keeps the original as a gz that restores the exact bytes, and touches nothing else", () => {
  const text = logText(bloatedEvents());
  const { dir, eventsPath, reviewDir } = stateDirWith(text);
  const sentinels = ["review.json", "meta.json", "replies.jsonl"].map(function (name) {
    const full = path.join(reviewDir, name);
    return { full: full, bytes: fs.readFileSync(full), mtimeMs: fs.statSync(full).mtimeMs };
  });

  const out = quiet();
  const code = compact.main(["--apply", "--state-dir", dir], { stdout: out, stderr: out });
  assert.equal(code, 0, out.lines.join(""));

  const gz = path.join(reviewDir, "events.jsonl.pre-compact.gz");
  assert.ok(fs.existsSync(gz), "the original is kept beside the log");
  assert.ok(zlib.gunzipSync(fs.readFileSync(gz)).equals(Buffer.from(text)), "gunzip gives back the exact original bytes");

  const after = fs.readFileSync(eventsPath, "utf8");
  assert.ok(after.length < text.length);
  assert.equal(parse(after).length, 3, "review.created, item.created and the commit");
  assert.equal(projectText(after), projectText(text));
  assert.equal(fs.statSync(eventsPath).mode & 0o777, 0o600, "the new log is owner-only like the old one");

  sentinels.forEach(function (s) {
    assert.ok(fs.readFileSync(s.full).equals(s.bytes), s.full + " is untouched");
    assert.equal(fs.statSync(s.full).mtimeMs, s.mtimeMs, s.full + " was not rewritten");
  });
  const leftovers = fs.readdirSync(reviewDir).filter((n) => /\.tmp$/.test(n));
  assert.deepEqual(leftovers, [], "no temp file is left behind");
});

test("a second --apply does not overwrite the first backup", () => {
  const text = logText(bloatedEvents());
  const { dir, reviewDir, eventsPath } = stateDirWith(text);
  const out = quiet();
  assert.equal(compact.main(["--apply", "--state-dir", dir], { stdout: out, stderr: out }), 0);
  const gz = path.join(reviewDir, "events.jsonl.pre-compact.gz");
  const firstBackup = fs.readFileSync(gz);

  // New drafts land after the first compaction; a second run must keep the
  // true original rather than replace it with the half-compacted one.
  const more = [
    content(itemOf("itm_x", { note: "x" })),
    content(itemOf("itm_x", { note: "xy" }))
  ].map(function (event, i) {
    return protocol.encodeEventLine(Object.assign({}, event, { seq: 1000 + i }));
  });
  fs.appendFileSync(eventsPath, more.join(""));
  const beforeSecond = fs.readFileSync(eventsPath);

  const report = compact.compactReview({ dir: dir, review: REVIEW, apply: true });
  assert.equal(report.applied, false);
  assert.match(report.reason, /pre-compact\.gz already exists/);
  assert.ok(fs.readFileSync(gz).equals(firstBackup), "the first backup is untouched");
  assert.ok(fs.readFileSync(eventsPath).equals(beforeSecond), "the log is untouched");
});

test("the dry run writes nothing, and prints per-review and total numbers from the run", () => {
  const text = logText(bloatedEvents());
  const { dir } = stateDirWith(text);
  const before = snapshot(dir);

  const out = quiet();
  const code = compact.main(["--state-dir", dir], { stdout: out, stderr: out });
  assert.equal(code, 0, out.lines.join(""));
  assert.deepEqual(snapshot(dir), before, "a dry run leaves every file as it was");

  const printed = out.lines.join("");
  const expected = compact.compactBuffer(Buffer.from(text), REVIEW);
  assert.match(printed, /dry run/i);
  assert.ok(printed.includes(REVIEW));
  assert.ok(printed.includes(String(Buffer.byteLength(text))), "bytes before");
  assert.ok(printed.includes(String(expected.compacted.length)), "bytes after");
  assert.match(printed, /passed/);
  assert.match(printed, new RegExp("events dropped: " + expected.dropped));
});

test("--review limits the run to one review", () => {
  const text = logText(bloatedEvents());
  const { dir } = stateDirWith(text, function (d) {
    const other = path.join(d, "reviews", "rotherreview1");
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(other, "events.jsonl"), text);
  });
  const out = quiet();
  assert.equal(compact.main(["--apply", "--review", REVIEW, "--state-dir", dir], { stdout: out, stderr: out }), 0);
  assert.ok(fs.existsSync(path.join(dir, "reviews", REVIEW, "events.jsonl.pre-compact.gz")));
  assert.equal(fs.readFileSync(path.join(dir, "reviews", "rotherreview1", "events.jsonl"), "utf8"), text);
  assert.equal(fs.existsSync(path.join(dir, "reviews", "rotherreview1", "events.jsonl.pre-compact.gz")), false);
});

test("a torn final line and an unreadable line are kept byte for byte", () => {
  const events = bloatedEvents();
  const text = logText(events.slice(0, 3)) + "this is not json\n" + logText(events.slice(3)) + "{\"event\":\"item.con";
  const result = compact.compactBuffer(Buffer.from(text), REVIEW);
  const out = result.compacted.toString("utf8");
  assert.ok(out.includes("this is not json\n"));
  assert.ok(out.endsWith("{\"event\":\"item.con"), "the torn tail is left for the helper's own repair");
  assert.equal(compact.proveSame(Buffer.from(text), result.compacted, REVIEW).same, true);
});

// ---------------------------------------------------------------------------
// Never race the helper
// ---------------------------------------------------------------------------

test("it refuses to run while the helper is running, and says how to stop it", () => {
  const text = logText(bloatedEvents());
  const { dir } = stateDirWith(text, function (d) {
    // This test process is alive, so its pid stands in for a running helper.
    fs.writeFileSync(path.join(d, "service.json"), JSON.stringify({ port: 7817, pid: process.pid }) + "\n");
  });
  const before = snapshot(dir);
  const out = quiet();
  const code = compact.main(["--apply", "--state-dir", dir], { stdout: out, stderr: out });
  assert.notEqual(code, 0);
  const printed = out.lines.join("");
  assert.match(printed, /helper/);
  assert.ok(printed.includes(String(process.pid)));
  assert.match(printed, /lahe session close/);
  assert.deepEqual(snapshot(dir), before, "nothing was written");
});

test("it refuses to run while a static server is running", () => {
  const text = logText(bloatedEvents());
  const { dir } = stateDirWith(text, function (d) {
    const root = path.join(d, "agent-sessions", "s_compacttest", "static-servers");
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(
      path.join(root, "ss_one.json"),
      JSON.stringify({ id: "ss_one", session_id: "s_compacttest", pid: process.pid, port: 4000, root: "/x" }) + "\n"
    );
  });
  const before = snapshot(dir);
  const out = quiet();
  const code = compact.main(["--state-dir", dir], { stdout: out, stderr: out });
  assert.notEqual(code, 0);
  assert.match(out.lines.join(""), /static server/);
  assert.deepEqual(snapshot(dir), before);
});

test("a helper that is not running (a stale service.json) does not block the run", () => {
  const text = logText(bloatedEvents());
  const { dir } = stateDirWith(text, function (d) {
    fs.writeFileSync(path.join(d, "service.json"), JSON.stringify({ port: 7817, pid: 2147483646 }) + "\n");
  });
  const out = quiet();
  assert.equal(compact.main(["--state-dir", dir], { stdout: out, stderr: out }), 0, out.lines.join(""));
});

// ---------------------------------------------------------------------------
// Real logs
// ---------------------------------------------------------------------------

test("on the five scrubbed real logs, compaction drops drafts and the fold is unchanged", () => {
  const files = fs.readdirSync(FIXTURE_DIR).filter((n) => n.endsWith(".events.jsonl"));
  assert.ok(files.length >= 5);
  let droppedAnywhere = 0;
  files.forEach(function (name) {
    const buffer = fs.readFileSync(path.join(FIXTURE_DIR, name));
    const reviewId = name.split(".")[0];
    const result = compact.compactBuffer(buffer, reviewId);
    droppedAnywhere += result.dropped;
    const proof = compact.proveSame(buffer, result.compacted, reviewId);
    assert.equal(proof.same, true, name + ": " + proof.reason);
  });
  assert.ok(droppedAnywhere > 0, "the real logs do carry superseded drafts");
});
