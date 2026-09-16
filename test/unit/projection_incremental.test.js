// The resumable fold: folding a log in pieces has to land on the same bytes as
// folding it from the top.
//
// Owner: 3A. The brief is
// docs/features/20260916.03_helper_lazy_projection/01_spec_lazy_projection.md,
// and it names two hard requirements. Startup rebuilds nothing, and the
// incremental fold is byte-identical to the full fold, "proven, not argued".
// This file is the proof.
//
// It runs against sequences a browser really produced rather than sequences a
// test author invented, because the fold keeps state across event boundaries
// and an invented sequence is a guess about which boundaries matter.
// test/fixtures/logs holds five of them: the largest log under the brief's
// 20 MB cap, the one with the most replies and rewordings, and the small ones
// carrying the rarer events (a delete, a reopen, an archive).
//
// They are real in SHAPE and fake in CONTENT. scripts/scrub-log-fixtures.js
// replaced every word, path, origin and token with a deterministic fake of the
// same length, and two tests at the bottom of this file hold that line: one
// asserts the scrub changed nothing the fold reads, the other asserts nothing a
// person wrote survived.
//
// The equality asserted is the bytes of review.json, not a deep-equal of some
// intermediate object, because the bytes are what an agent reads.
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
const scrub = require("../../scripts/scrub-log-fixtures.js");

const FIXTURE_DIR = path.join(__dirname, "..", "fixtures", "logs");

// Pinned, because projectReview stamps `new Date()` when nothing is passed and
// two folds a millisecond apart would then differ for a reason that is not the
// fold.
const GENERATED_AT = "2026-09-16T00:00:00.000Z";

const FIXTURES = [
  { file: "r9de3b2a18cd4.events.jsonl", why: "the largest log under 20 MB" },
  { file: "r9dcf69be6afc.events.jsonl", why: "the most replies and the most rewording" },
  { file: "ra34b8e0e4d5a.events.jsonl", why: "60 replies in a short log, and a delete" },
  { file: "r0fce850a67da.events.jsonl", why: "carries an item.reopened" },
  { file: "r28b63eabad87.events.jsonl", why: "tiny, and carries review.archived" }
];

const SHAPE = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, "shape.json"), "utf8"));

// Parsing a 19 MB log is the expensive part, so each fixture is read once.
const parsedCache = Object.create(null);

function eventsOf(file) {
  if (parsedCache[file]) return parsedCache[file];
  const out = [];
  fs.readFileSync(path.join(FIXTURE_DIR, file), "utf8")
    .split("\n")
    .forEach((line) => {
      if (!line) return;
      const parsed = protocol.parseEventLine(line);
      if (parsed.ok) out.push(parsed.event);
    });
  parsedCache[file] = out;
  return out;
}

function reviewIdOf(file) {
  return file.replace(".events.jsonl", "");
}

function fullBytes(reviewId, events) {
  return projection.stringify(projection.project(reviewId, events, { generated_at: GENERATED_AT }));
}

/** A seeded generator, so a failing chunking is reproducible from its seed. */
function rng(seed) {
  let state = seed >>> 0;
  return function next() {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// The equivalence proof
// ---------------------------------------------------------------------------

FIXTURES.forEach((fixture) => {
  test(
    "the incremental fold equals the full fold at every chunk boundary: " + fixture.file + " (" + fixture.why + ")",
    () => {
      const events = eventsOf(fixture.file);
      const reviewId = reviewIdOf(fixture.file);
      assert.equal(events.length > 0, true, "the fixture parsed into events");

      // Capped at half the log, so even the 46-line fixture is really folded in
      // pieces rather than swallowed whole by one lucky chunk size.
      const biggestChunk = Math.max(1, Math.min(400, Math.ceil(events.length / 2)));

      [1, 7, 31].forEach((seed) => {
        const next = rng(seed);
        const state = projection.createFold();
        let at = 0;
        let boundaries = 0;
        while (at < events.length) {
          const size = 1 + Math.floor(next() * biggestChunk);
          const chunk = events.slice(at, at + size);
          projection.foldEvents(state, chunk);
          at += chunk.length;
          boundaries += 1;
          assert.equal(
            projection.stringify(projection.projectFold(reviewId, state, { generated_at: GENERATED_AT })),
            fullBytes(reviewId, events.slice(0, at)),
            "seed " + seed + ", boundary after event " + at + " of " + events.length
          );
        }
        assert.equal(boundaries > 1, true, "the log really was folded in pieces, not in one go");
      });
    }
  );
});

// ---------------------------------------------------------------------------
// The two boundaries the brief calls out by name
// ---------------------------------------------------------------------------
//
// A random chunking hits these eventually. Naming them makes the test say what
// it is protecting: the fold keeps two pieces of cross-event state, the reply a
// revision answered and the record the browser last posted, and both are read
// across exactly these seams.

function itemEventIndexesAtHigherRev(events) {
  const seen = Object.create(null);
  const out = [];
  events.forEach((event, index) => {
    const type = event[protocol.EVENT_FIELD.EVENT];
    if (type !== protocol.EVENT.ITEM_CREATED && type !== protocol.EVENT.ITEM_CONTENT && type !== protocol.EVENT.ITEM_READY) {
      return;
    }
    const id = event[protocol.EVENT_FIELD.ITEM];
    const rev = event[protocol.EVENT_FIELD.REV];
    if (typeof id === "string" && typeof rev === "number") {
      if (id in seen && rev > seen[id]) out.push(index);
      seen[id] = rev;
    }
  });
  return out;
}

function replyIndexes(events) {
  const out = [];
  events.forEach((event, index) => {
    if (event[protocol.EVENT_FIELD.EVENT] === protocol.EVENT.REPLY_FOLDED) out.push(index + 1);
  });
  return out;
}

function assertSplitsAgree(reviewId, events, splits) {
  const expected = fullBytes(reviewId, events);
  splits.forEach((split) => {
    const state = projection.createFold();
    projection.foldEvents(state, events.slice(0, split));
    projection.foldEvents(state, events.slice(split));
    assert.equal(
      projection.stringify(projection.projectFold(reviewId, state, { generated_at: GENERATED_AT })),
      expected,
      "a fold paused at event " + split + " of " + events.length
    );
  });
}

test("a chunk boundary sitting on a revision bump does not change the bytes", () => {
  let checked = 0;
  FIXTURES.forEach((fixture) => {
    const events = eventsOf(fixture.file);
    const splits = itemEventIndexesAtHigherRev(events);
    checked += splits.length;
    assertSplitsAgree(reviewIdOf(fixture.file), events, splits);
  });
  assert.equal(checked > 0, true, "the fixtures really do contain rewordings");
});

test("a chunk boundary sitting right after a folded reply does not change the bytes", () => {
  let checked = 0;
  FIXTURES.forEach((fixture) => {
    const events = eventsOf(fixture.file);
    const splits = replyIndexes(events);
    checked += splits.length;
    assertSplitsAgree(reviewIdOf(fixture.file), events, splits);
  });
  assert.equal(checked > 0, true, "the fixtures really do contain folded replies");
});

test("folding one event at a time equals folding the whole log at once", () => {
  // The extreme of the chunking above, run on the small fixtures where it is
  // cheap, because a fold that only works in batches is a fold with hidden
  // lookahead.
  ["r0fce850a67da.events.jsonl", "r28b63eabad87.events.jsonl"].forEach((file) => {
    const events = eventsOf(file);
    const reviewId = reviewIdOf(file);
    const state = projection.createFold();
    events.forEach((event) => projection.foldEvents(state, [event]));
    assert.equal(
      projection.stringify(projection.projectFold(reviewId, state, { generated_at: GENERATED_AT })),
      fullBytes(reviewId, events),
      file
    );
  });
});

test("the fold state keeps items, not events", () => {
  // Memory, from the brief: the point of the change is that a helper watching a
  // review holds its items rather than its log. A state that quietly kept the
  // events would pass every equality test above and still be the bug.
  const events = eventsOf("r28b63eabad87.events.jsonl");
  const state = projection.createFold();
  projection.foldEvents(state, events);
  const text = JSON.stringify(state);
  events.forEach((event) => {
    const id = event[protocol.EVENT_FIELD.EVENT_ID];
    if (typeof id === "string" && id) {
      assert.equal(text.indexOf(id), -1, "the fold state holds no event_id, so it is holding no events: " + id);
    }
  });
});

// ---------------------------------------------------------------------------
// Startup rebuilds nothing
// ---------------------------------------------------------------------------

let eventCounter = 0;
function eventId() {
  eventCounter += 1;
  return "evt_lazy_" + eventCounter;
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

function postItem(log, reviewId, item) {
  log.append(reviewId, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: eventId(),
      review: reviewId,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item }
    })
  ]);
  return item;
}

function makeStateDir(reviewIds) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-lazy-"));
  const log = logModule.createEventLog({ dir: dir });
  reviewIds.forEach((id, index) => {
    stateDir.ensureReviewDir(dir, id);
    postItem(log, id, itemOf({ id: "itm_" + index, note: "item in " + id }));
  });
  return { dir, log };
}

function reviewJsonCount(dir, reviewIds) {
  return reviewIds.filter((id) => fs.existsSync(stateDir.reviewJsonPath(dir, id))).length;
}

test("a helper that starts with 50 reviews on disk rebuilds none of them", () => {
  const ids = [];
  for (let i = 0; i < 50; i += 1) ids.push("rlazy" + String(100000000000 + i));
  const { dir, log } = makeStateDir(ids);

  const projector = projection.createProjector({ dir: dir, log: log });
  projector.start();
  assert.equal(reviewJsonCount(dir, ids), 0, "starting the projector wrote no review.json at all");
  assert.equal(projector.counters.writes, 0);
  assert.deepEqual(projector.watching(), [], "and it is watching nothing");

  // The safety-net timer fires on its own, and it must not find them either.
  projector.tick();
  assert.equal(reviewJsonCount(dir, ids), 0, "a tick walks the watched reviews, not the directory");

  // Touching one, which is what a page poll or an agent's status read does.
  projector.watch(ids[7]);
  assert.equal(reviewJsonCount(dir, ids), 1, "exactly one review was rebuilt");
  assert.equal(fs.existsSync(stateDir.reviewJsonPath(dir, ids[7])), true, "and it is the one that was asked about");
  projector.stop();
});

test("a review nobody asked about is left exactly as its last rebuild wrote it", () => {
  const ids = ["rlazy000000000a", "rlazy000000000b"];
  const { dir, log } = makeStateDir(ids);

  const projector = projection.createProjector({ dir: dir, log: log });
  projector.watch(ids[0]);
  const before = fs.readFileSync(stateDir.reviewJsonPath(dir, ids[0]), "utf8");

  // The untouched review gets a new item. Nothing asks about it, so nothing
  // rewrites it, and the watched review is untouched too.
  postItem(log, ids[1], itemOf({ id: "itm_late", note: "arrived while nobody was looking" }));
  projector.tick();

  assert.equal(fs.existsSync(stateDir.reviewJsonPath(dir, ids[1])), false, "the unwatched review has no file yet");
  assert.equal(fs.readFileSync(stateDir.reviewJsonPath(dir, ids[0]), "utf8"), before, "and the watched one did not churn");
  projector.stop();
});

// ---------------------------------------------------------------------------
// A rebuild reads only what is new
// ---------------------------------------------------------------------------

test("after the first rebuild, a tick never reads the log from the top again", () => {
  const ids = ["rlazy000000000c"];
  const { dir, log } = makeStateDir(ids);
  const reviewId = ids[0];
  const eventsPath = stateDir.eventsPath(dir, reviewId);

  const projector = projection.createProjector({ dir: dir, log: log });
  projector.watch(reviewId);

  const wholeFileReads = [];
  const realReadFileSync = fs.readFileSync;
  fs.readFileSync = function (target) {
    if (String(target) === eventsPath) wholeFileReads.push(String(target));
    return realReadFileSync.apply(fs, arguments);
  };
  try {
    for (let i = 0; i < 5; i += 1) {
      postItem(log, reviewId, itemOf({ id: "itm_more_" + i, note: "another one" }));
      projector.tickReview(reviewId);
    }
  } finally {
    fs.readFileSync = realReadFileSync;
  }

  assert.deepEqual(wholeFileReads, [], "the events log was never read whole again after the first rebuild");

  // And the file is still right, which is the whole point of not reading it.
  const parsed = JSON.parse(fs.readFileSync(stateDir.reviewJsonPath(dir, reviewId), "utf8"));
  const notes = [];
  (parsed.pages || []).forEach((page) => page.items.forEach((item) => notes.push(item.note)));
  assert.equal(notes.length, 6, "the first item plus the five appended after the fold started");
  projector.stop();
});

test("log.since hands back only the new events, and an older cursor still works", () => {
  const ids = ["rlazy000000000d"];
  const { dir, log } = makeStateDir(ids);
  const reviewId = ids[0];

  const first = log.currentSeq(reviewId);
  assert.equal(log.since(reviewId, first).length, 0, "nothing is new yet");

  postItem(log, reviewId, itemOf({ id: "itm_new", note: "after the cursor" }));
  const fresh = log.since(reviewId, first);
  assert.equal(fresh.length, 1);
  assert.equal(fresh[0][protocol.EVENT_FIELD.SEQ], first + 1);

  // The slow path is still the honest answer: a cursor behind what the reader
  // has already scanned re-reads and returns everything after it.
  assert.equal(log.since(reviewId, 0).length, log.read(reviewId).length);
});

// ---------------------------------------------------------------------------
// The one thing that used to depend on the walk
// ---------------------------------------------------------------------------

test("a reply appended to a review with no page polling is folded and lands in review.json", () => {
  const ids = ["rlazy000000000e"];
  const { dir, log } = makeStateDir(ids);
  const reviewId = ids[0];
  const item = postItem(log, reviewId, itemOf({ id: "itm_reply", note: "shorten the heading" }));

  fs.writeFileSync(
    stateDir.replyFilePath(dir, reviewId, "replies-claude.jsonl"),
    JSON.stringify({ item: item.id, rev: 1, status: "handled", agent: "claude" }) + "\n",
    { mode: 0o600 }
  );

  // This is the agent's own path: `lahe status` reads through the helper's
  // review.read route, which calls startWatching and then tickReview for that
  // one review. No page is polling and the projector never walked the
  // directory.
  const deps = { log: log };
  const projector = projection.startWatching(deps, [reviewId]);
  projection.tickReview(deps, reviewId);

  const parsed = JSON.parse(fs.readFileSync(stateDir.reviewJsonPath(dir, reviewId), "utf8"));
  const items = [];
  (parsed.pages || []).forEach((page) => page.items.forEach((each) => items.push(each)));
  assert.equal(items.length, 2);
  const folded = items.filter((each) => each.id === "itm_reply")[0];
  assert.equal(folded.state, "handled");
  assert.equal(folded.reply.agent, "claude");
  if (projector) projector.stop();
});

// ---------------------------------------------------------------------------
// The same proof, through the real path
// ---------------------------------------------------------------------------
//
// Everything above folds arrays that were already parsed, so it proves the FOLD
// resumes and says nothing about the CURSOR. The cursor is where the sharp
// edges are: bytes arrive in whatever sizes the filesystem hands over, a chunk
// boundary lands in the middle of a line as a matter of course, and a torn line
// has to be held rather than half-parsed. So this one writes a real fixture into
// a real state directory in byte chunks that cut wherever they land, ticks the
// projector after each write, and compares the bytes of review.json with what
// regenerate writes from the top for the same partial file.

function stripGeneratedAt(text) {
  return text.replace(/"generated_at": "[^"]*"/, '"generated_at": "pinned"');
}

/** What a from-the-top rebuild writes for the same bytes, in its own directory. */
function regeneratedBytes(sourcePath, reviewId) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-regen-"));
  stateDir.ensureReviewDir(dir, reviewId);
  fs.copyFileSync(sourcePath, stateDir.eventsPath(dir, reviewId));
  const log = logModule.createEventLog({ dir: dir });
  projection.regenerate({ dir: dir, log: log, review: reviewId });
  return stripGeneratedAt(fs.readFileSync(stateDir.reviewJsonPath(dir, reviewId), "utf8"));
}

["r28b63eabad87.events.jsonl", "r0fce850a67da.events.jsonl", "ra34b8e0e4d5a.events.jsonl"].forEach((file) => {
  test("written in byte chunks that cut mid-line, " + file + " still lands on the full rebuild's bytes", () => {
    const raw = fs.readFileSync(path.join(FIXTURE_DIR, file));
    const reviewId = reviewIdOf(file);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-chunks-"));
    stateDir.ensureReviewDir(dir, reviewId);
    const eventsPath = stateDir.eventsPath(dir, reviewId);
    fs.writeFileSync(eventsPath, "", { mode: 0o600 });

    const log = logModule.createEventLog({ dir: dir });
    const projector = projection.createProjector({ dir: dir, log: log });
    projector.watch(reviewId);

    const next = rng(11);
    // Big enough to get through a multi-megabyte fixture in a dozen or so
    // writes, small enough that most of them land inside a line.
    const biggestChunk = Math.max(1, Math.ceil(raw.length / 8));
    let at = 0;
    let torn = 0;
    while (at < raw.length) {
      const size = 1 + Math.floor(next() * biggestChunk);
      const chunk = raw.slice(at, at + size);
      fs.appendFileSync(eventsPath, chunk);
      at += chunk.length;
      if (at < raw.length && raw[at - 1] !== 0x0a) torn += 1;

      projector.tickReview(reviewId);
      assert.equal(
        stripGeneratedAt(fs.readFileSync(stateDir.reviewJsonPath(dir, reviewId), "utf8")),
        regeneratedBytes(eventsPath, reviewId),
        file + ": after " + at + " of " + raw.length + " bytes"
      );
    }
    assert.equal(torn > 0, true, "at least one write really did stop in the middle of a line");
    projector.stop();
  });
});

// ---------------------------------------------------------------------------
// The fixtures are real in shape
// ---------------------------------------------------------------------------
//
// Everything above is only worth running if the scrub left the log folding the
// way the real one did. shape.json was written by
// scripts/scrub-log-fixtures.js, which computes the same census over the real
// log AND over its scrubbed copy and refuses to finish if the two differ. This
// test is the other half: the committed fixtures still match what was recorded,
// so a later edit to a fixture cannot quietly drop a branch.

test("the scrubbed fixtures still fold every branch the real logs did", () => {
  assert.equal(SHAPE.logs.length, FIXTURES.length);
  SHAPE.logs.forEach((entry) => {
    const events = eventsOf(entry.file);
    assert.deepEqual(
      scrub.shapeOf(events),
      entry.shape,
      entry.file + " no longer has the event counts, revisions and array lengths it was recorded with"
    );
    // Said again in the plain terms the brief uses, so a reader does not have
    // to decode a deep-equal failure to know what was lost.
    assert.equal(events.length, entry.shape.events, entry.file + ": event count");
    assert.equal(
      Object.keys(scrub.shapeOf(events).event_types).length,
      Object.keys(entry.shape.event_types).length,
      entry.file + ": the set of event types"
    );
  });

  const totals = SHAPE.logs.reduce(
    (out, entry) => ({
      replies: out.replies + entry.shape.replies_folded,
      reworded: out.reworded + entry.shape.items_past_rev_1,
      items: out.items + entry.shape.items
    }),
    { replies: 0, reworded: 0, items: 0 }
  );
  assert.equal(totals.replies > 200, true, "the set really does carry folded replies");
  assert.equal(totals.reworded > 10, true, "and items the reviewer reworded after an agent answered");
  assert.equal(totals.items > 200, true, "and enough items to group across pages");
});

// ---------------------------------------------------------------------------
// The fixtures are fake in content
// ---------------------------------------------------------------------------
//
// This repository is public. These files came out of a real state directory, so
// the test that matters most here is the one that fails if any of it came with
// them. Two passes: every prose field has to BE a slice of the scrub script's
// lorem corpus, which nothing a person wrote can be, and the raw bytes have to
// carry none of the shapes a secret or an identity takes.

function proseValues(events) {
  const out = [];
  function walk(node, at) {
    if (typeof node === "string") {
      if ((scrub.TABLE[at] || "text") === "text") out.push({ at: at, value: node });
      return;
    }
    if (node === null || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach((each) => walk(each, at + "[]"));
      return;
    }
    Object.keys(node).forEach((key) => walk(node[key], at ? at + "." + key : key));
  }
  events.forEach((event) => walk(event, ""));
  return out;
}

test("every prose field in the fixtures is a placeholder, not something a person wrote", () => {
  let checked = 0;
  FIXTURES.forEach((fixture) => {
    proseValues(eventsOf(fixture.file)).forEach((found) => {
      checked += 1;
      assert.equal(
        scrub.isPlaceholder(found.value),
        true,
        fixture.file + ": " + found.at + " is not a lorem slice, so it may be real text"
      );
    });
  });
  assert.equal(checked > 10000, true, "and there really were prose fields to check");
});

test("the fixture bytes carry no address, url, secret or name", () => {
  // Every origin the scrub mints, so the one URL shape that is allowed to be in
  // these files is named rather than pattern-matched.
  const allowedOrigins = /^http:\/\/127\.0\.0\.1:4\d{3}$/;

  const banned = [
    { name: "an email address or a handle", pattern: /@/ },
    { name: "a url", pattern: /https?:\/\/(?!127\.0\.0\.1:4\d{3}\b)/ },
    { name: "a secret-length hex string", pattern: /\b[0-9a-f]{32,}\b/ },
    { name: "a home directory path", pattern: /\/(Users|home)\// },
    { name: "Ken's name", pattern: /kenneth|stclair|st\.\s*clair|\bken\b/i },
    { name: "a windows path", pattern: /[A-Za-z]:\\/ }
  ];

  FIXTURES.forEach((fixture) => {
    const text = fs.readFileSync(path.join(FIXTURE_DIR, fixture.file), "utf8");
    banned.forEach((rule) => {
      const hit = text.match(rule.pattern);
      assert.equal(
        hit,
        null,
        fixture.file + " contains " + rule.name + ": " + JSON.stringify(hit ? hit[0] : "")
      );
    });

    // And the origins really are only the minted ones.
    eventsOf(fixture.file).forEach((event) => {
      [event.origin, event.record && event.record.page_origin].forEach((origin) => {
        if (typeof origin !== "string" || origin === "null") return;
        assert.equal(allowedOrigins.test(origin), true, fixture.file + ": unexpected origin " + origin);
      });
    });
  });
});
