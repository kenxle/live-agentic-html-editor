// The menu bar's summary: the one-review reader (Task 1.2) and the summary
// with its cache (Task 1.3).
//
// Menu bar plan, Step 1. The rows this file proves:
//
//   V1   seeded_at is written on the first summary.read, not before; replies
//        older than it count neither as questions nor as unread
//   V2   a question counts exactly as any other unread reply, and stops when
//        its card is opened, Ken answers, an agent replies again, Ken marks it
//        done, or the card is deleted; the count equals the rail's own
//   V6   a corrupt or missing summary.json starts fresh at now; no count rises
//   V8   retired, ended and missing-file reviews never wait on you
//   V9   three answered cards on one document are one document; two reviews
//        folded into one Library row are one; count is the listed documents
//   V10  waiting_on_agents.count is the Library's waiting total
//   V11  open documents, connected sessions, a session's name and its review
//   V12  recent follows the Library's order; lists cap at 8 with `more`;
//        waiting on you is never capped
//   V13  no comment text, token, absolute path, control or format character,
//        or title past the cap
//   V17  the cache: nothing changed rebuilds nothing; one log touched rebuilds
//        one review; a same-size rewrite in the same millisecond rebuilds; a
//        deleted document drops out; a Library rename shows
//
// and the shape: nested key paths and value types match
// test/fixtures/menubar/summary.json in both directions (and the empty and
// many fixtures).
//
// Every state folder is made up (test/fixtures/menubar/state.js) under the OS
// temp folder. Time is passed in; nothing sleeps and nothing is started.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const stateDir = require("../../src/service/state_dir.js");
const projection = require("../../src/service/projection.js");
const summaryModule = require("../../src/service/summary.js");
const catalogReader = require("../../src/service/catalog_reader.js");
const tabDone = require("../../src/layer/tab_done.js");
const fixture = require("../fixtures/menubar/state.js");

const FIXTURES = path.join(__dirname, "..", "fixtures", "menubar");
const SECOND = 1000;
const MINUTE = 60 * SECOND;
// A write the helper does not make shows within one beat of the summary.
const BEAT = protocol.CATALOG.POLL_MS;

/**
 * Beats until every review's own files have been looked at again (the
 * summary looks at a slice of them each beat): the last answer, and every
 * review those beats rebuilt.
 */
function afterEveryReview(summary, clock) {
  let answer = null;
  const rebuilt = [];
  for (let n = 0; n < summary.FULL_PASS_BEATS; n += 1) {
    clock.ms += BEAT;
    answer = summary.read();
    summary.lastRebuilt().forEach((id) => { if (rebuilt.indexOf(id) === -1) rebuilt.push(id); });
  }
  return { answer, rebuilt };
}

function readFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8"));
}

/** A state folder with the cutoff a minute ago, and a summary over it. */
function setup(options) {
  const o = options || {};
  const state = fixture.createState();
  const T = Date.now();
  if (o.seed !== false) state.seed(T - MINUTE);
  const clock = { ms: T };
  const reader = state.reader();
  const held = o.holders || {};
  const summary = summaryModule.createSummary({
    dir: state.dir,
    reader: reader,
    reviews: fixture.holders(held),
    now: () => clock.ms,
    version: "0.4.0",
    startedAt: "2026-10-20T08:00:00.000Z",
    alwaysOn: true,
    libraryUrl: () => "http://library.lahe.localhost:1483/catalog"
  });
  // The helper's own wiring: its event log tells the summary what it wrote.
  state.listen(summary.touched);
  return { state, reader, summary, clock, T, held };
}

const iso = (ms) => new Date(ms).toISOString();

function waitingIds(answer) {
  return answer.waiting_on_you.documents.map((d) => d.review);
}

function doc(answer, review) {
  return answer.waiting_on_you.documents.find((d) => d.review === review) || null;
}

// ---------------------------------------------------------------------------
// The shape, against the committed fixtures
// ---------------------------------------------------------------------------

/** path -> type for every nested key; array elements share the path "[]". */
function shapeOf(value, at, out) {
  const map = out || new Map();
  const here = at || "$";
  if (Array.isArray(value)) {
    map.set(here, "array");
    value.forEach((v) => shapeOf(v, here + "[]", map));
  } else if (value && typeof value === "object") {
    map.set(here, "object");
    Object.keys(value).forEach((k) => shapeOf(value[k], here + "." + k, map));
  } else {
    const type = value === null ? "null" : Number.isInteger(value) ? "integer" : typeof value;
    const had = map.get(here);
    if (had && had !== type) map.set(here, had + "|" + type);
    else map.set(here, type);
  }
  return map;
}

function assertSameShape(actual, expected, label) {
  const a = shapeOf(actual);
  const e = shapeOf(expected);
  const missing = [...e.keys()].filter((k) => !a.has(k));
  const extra = [...a.keys()].filter((k) => !e.has(k));
  assert.deepEqual(missing, [], label + ": key paths the fixture has and the answer does not");
  assert.deepEqual(extra, [], label + ": key paths the answer has and the fixture does not");
  [...e.keys()].forEach((k) => assert.equal(a.get(k), e.get(k), label + ": type of " + k));
}

/** A state folder with every section of the answer filled. */
function fullState() {
  const s = setup({ holders: { r_a: { quiet: false }, r_b: { quiet: true } } });
  const { state, T } = s;
  state.sessions.create({ id: "s_listen", name: "listening agent" });
  state.sessions.create({ id: "s_work" });
  state.clock.iso = iso(T);
  state.sessions.writeMonitor("s_listen", { pid: process.pid, handoff_rev: 0, at: iso(T) });
  state.sessions.touchActivity("s_work");
  state.review("r_a", { session: "s_listen", doc: "docs/a.md", title: "Doc A" });
  state.review("r_b", { session: "s_work", doc: "docs/b.md", title: "Doc B" });
  const a = state.item("r_a", { page_title: "Doc A" });
  state.reply("r_a", a, { status: "question", ts: iso(T - 10 * SECOND) });
  state.item("r_b", { page_title: "Doc B" });
  return s;
}

test("the answer's key paths and types match summary.json, both directions", () => {
  const { summary } = fullState();
  assertSameShape(summary.read(), readFixture("summary.json"), "full");
});

test("an empty state folder matches summary_empty.json, and the many fixture has summary.json's shape", () => {
  const { summary } = setup();
  assertSameShape(summary.read(), readFixture("summary_empty.json"), "empty");
  assertSameShape(readFixture("summary_many.json"), readFixture("summary.json"), "many");
});

test("the fixtures agree with the contract: unread counts every unread reply, questions included", () => {
  ["summary.json", "summary_many.json"].forEach((name) => {
    readFixture(name).waiting_on_you.documents.forEach((d) => {
      assert.ok(d.unread >= d.questions, name + ": " + d.review + " has more questions than unread replies");
      assert.ok(d.unread > 0, name + ": " + d.review + " is listed with nothing unread");
    });
  });
});

// ---------------------------------------------------------------------------
// The cutoff (V1, V6)
// ---------------------------------------------------------------------------

test("V1: seeded_at is written on the first summary.read, not before, and older replies never count", () => {
  const { state, summary, clock, T } = setup({ seed: false });
  const file = path.join(state.dir, summaryModule.SUMMARY_FILE);
  state.review("r_a", { session: "s_one", title: "Doc A" });
  const old = state.item("r_a", { page_title: "Doc A" });
  state.reply("r_a", old, { status: "question", ts: iso(T - 5 * MINUTE) });
  assert.equal(fs.existsSync(file), false, "making the summary writes nothing");

  const first = summary.read();
  const seeded = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepEqual(seeded, { version: 1, seeded_at: iso(T) });
  assert.equal(first.waiting_on_you.count, 0, "day one shows nothing");

  const fresh = state.item("r_a", { page_title: "Doc A" });
  state.reply("r_a", fresh, { status: "question", ts: iso(T + 2 * SECOND) });
  clock.ms = T + 5 * SECOND;
  const second = summary.read();
  assert.deepEqual(waitingIds(second), ["r_a"]);
  assert.equal(doc(second, "r_a").questions, 1, "the old question is not counted");
  assert.equal(doc(second, "r_a").unread, 1);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).seeded_at, iso(T), "seeded once");
});

test("V6: a corrupt or missing summary.json starts fresh at now, and no count goes up", () => {
  const { state, summary, clock, T } = setup();
  state.review("r_a", { session: "s_one", title: "Doc A" });
  const it = state.item("r_a", { page_title: "Doc A" });
  state.reply("r_a", it, { status: "question", ts: iso(T - 10 * SECOND) });
  assert.equal(summary.read().waiting_on_you.count, 1);

  const file = path.join(state.dir, summaryModule.SUMMARY_FILE);
  fs.writeFileSync(file, "{not json");
  clock.ms = T + MINUTE;
  const afterCorrupt = summary.read();
  assert.equal(afterCorrupt.waiting_on_you.count, 0, "the fresh cutoff is later, so the count can only fall");
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).seeded_at, iso(T + MINUTE));

  fs.unlinkSync(file);
  clock.ms = T + 2 * MINUTE;
  assert.equal(summary.read().waiting_on_you.count, 0);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).seeded_at, iso(T + 2 * MINUTE), "recreated on loss");
});

// ---------------------------------------------------------------------------
// One rule, one review (V2, V8)
// ---------------------------------------------------------------------------

test("V2: a question stops counting when opened, answered, replied to again, marked done or deleted", () => {
  const { state, reader, T } = setup();
  state.review("r_a", { session: "s_one", title: "Doc A" });
  const since = T - MINUTE;
  const ask = (n) => {
    const it = state.item("r_a", { page_title: "Doc A", id: "itm_" + n });
    state.reply("r_a", it, { status: "question", ts: iso(T - 30 * SECOND + n) });
    return it;
  };
  const opened = ask(1);
  const answered = ask(2);
  const repliedAgain = ask(3);
  const closed = ask(4);
  const deleted = ask(5);
  const routine = state.item("r_a", { page_title: "Doc A", id: "itm_6" });
  state.reply("r_a", routine, { status: "handled", text: null, ts: iso(T - 20 * SECOND) });
  assert.deepEqual(reader.reviewPart("r_a", { since }).unread.count, 5, "five questions, and the routine reply is not one");
  assert.equal(reader.reviewPart("r_a", { since }).unread.questions, 5);

  state.seen("r_a", opened.id);
  state.item("r_a", { id: answered.id, page_title: "Doc A", rev: answered.rev + 1, note: "the April one" });
  state.reply("r_a", repliedAgain, { status: "handled", text: null, ts: iso(T - 10 * SECOND) });
  state.append("r_a", protocol.EVENT.ITEM_CLOSED, { item: closed.id, rev: closed.rev });
  state.append("r_a", protocol.EVENT.ITEM_DELETED, { item: deleted.id, rev: deleted.rev });
  const part = reader.reviewPart("r_a", { since });
  assert.equal(part.unread.count, 0, "every way a question is settled settles it");
  assert.equal(part.unread.questions, 0);
});

test("V2: the summary's count for a review equals the rail's badge total for the same records", () => {
  const { state, reader, T } = setup();
  state.review("r_a", { session: "s_one", title: "Doc A" });
  const statuses = [
    { status: "question" },
    { status: "not_handled" },
    { status: "handled", flagged: true, text: "done, on the other slide" },
    { status: "handled", flagged: true, text: "" },
    { status: "handled", text: null }
  ];
  const items = statuses.map((spec, n) => {
    const it = state.item("r_a", { page_title: "Doc A" });
    state.reply("r_a", it, Object.assign({ ts: iso(T - 30 * SECOND + n) }, spec));
    return it;
  });
  state.seen("r_a", items[1].id);
  const records = projection.itemsFrom(state.log.read("r_a"));
  const railCount = tabDone.unseenReplyIds(records, {}).length;
  assert.equal(railCount, 2, "the question and the flagged answer with words");
  assert.equal(reader.reviewPart("r_a", { since: T - MINUTE }).unread.count, railCount);
  assert.equal(reader.reviewPart("r_a", { since: T - MINUTE }).unread.newest_at, iso(T - 30 * SECOND + 2));
});

test("V8: retired, ended and missing-file reviews never wait on you", () => {
  const { state, summary, T } = setup();
  const ask = (id) => {
    const it = state.item(id, { page_title: id });
    state.reply(id, it, { status: "question", ts: iso(T - 10 * SECOND) });
  };
  state.review("r_live", { session: "s_one", title: "Live" });
  state.review("r_retired", { session: "s_one", title: "Retired", retired_at: iso(T - 5 * SECOND) });
  state.review("r_ended", { session: "s_one", title: "Ended" });
  const gone = state.review("r_gone", { session: "s_one", title: "Gone" });
  ["r_live", "r_retired", "r_ended", "r_gone"].forEach(ask);
  state.append("r_ended", protocol.EVENT.REVIEW_ARCHIVED, {});
  fs.unlinkSync(gone.file);
  const answer = summary.read();
  assert.deepEqual(waitingIds(answer), ["r_live"]);
  const everywhere = JSON.stringify(answer);
  assert.equal(everywhere.includes("r_retired"), false, "a retired review is in no section at all");
});

test("titles lose control and format characters and are cut at 120, path hints at 200", () => {
  assert.equal(catalogReader.menuText("Pay ‮redro‬ now\u0007​", 120), "Pay redro now");
  assert.equal(catalogReader.menuText("x".repeat(300), catalogReader.MENU_TITLE_MAX).length, 120);
  assert.equal(catalogReader.menuText("\u{1F600}".repeat(130), 120), "\u{1F600}".repeat(120), "cut by characters, never mid-pair");
  assert.equal(catalogReader.menuText("\u0000‮", 120), null);
  assert.equal(catalogReader.MENU_PATH_HINT_MAX, 200);
});

// ---------------------------------------------------------------------------
// Counting documents (V9, V10)
// ---------------------------------------------------------------------------

test("V9: three answered cards on one document are one document, and two folded reviews are one row", () => {
  const { state, summary, T } = setup();
  state.review("r_three", { session: "s_one", title: "Three" });
  [0, 1, 2].forEach((n) => {
    const it = state.item("r_three", { page_title: "Three" });
    state.reply("r_three", it, { status: n === 0 ? "question" : "not_handled", ts: iso(T - 20 * SECOND + n) });
  });
  // Two reviews of one document in one session: the Library's one row.
  const first = state.review("r_first", { session: "s_two", doc: "notes/shared.md", title: "Shared", created_at: "2026-10-20T08:00:00.000Z" });
  state.review("r_second", { session: "s_two", file: first.file, title: "Shared", created_at: "2026-10-20T09:00:00.000Z" });
  ["r_first", "r_second"].forEach((id, n) => {
    const it = state.item(id, { page_title: "Shared" });
    state.reply(id, it, { status: "question", ts: iso(T - 10 * SECOND + n) });
  });
  const answer = summary.read();
  assert.equal(answer.waiting_on_you.count, 2, "two documents");
  assert.equal(answer.waiting_on_you.count, answer.waiting_on_you.documents.length);
  const three = doc(answer, "r_three");
  assert.deepEqual([three.unread, three.questions], [3, 1]);
  const shared = answer.waiting_on_you.documents.find((d) => d.title === "Shared");
  assert.deepEqual([shared.unread, shared.questions], [2, 2], "both reviews' replies, on one row");
});

test("V10: waiting_on_agents.count is the Library's waiting total for the same folder", async () => {
  const { state, summary, reader } = setup();
  state.review("r_a", { session: "s_one", title: "A" });
  state.review("r_b", { session: "s_two", title: "B" });
  state.review("r_c", { session: "s_two", title: "C" });
  [["r_a", 3], ["r_b", 1], ["r_c", 0]].forEach(([id, n]) => {
    for (let i = 0; i < n; i += 1) state.item(id, { page_title: id });
  });
  const list = await reader.list(Date.now());
  const libraryTotal = list.sessions.reduce((n, s) => n + s.reviews.reduce((m, r) => m + r.waiting, 0), 0);
  const answer = summary.read();
  assert.equal(libraryTotal, 4);
  assert.equal(answer.waiting_on_agents.count, libraryTotal);
  assert.deepEqual(answer.waiting_on_agents.documents.map((d) => [d.review, d.waiting]).sort(), [["r_a", 3], ["r_b", 1]]);
});

// ---------------------------------------------------------------------------
// Open, connected, recent (V11, V12)
// ---------------------------------------------------------------------------

test("V11: open documents are the window holders; connected sessions pass the Library's test; names and reviews", () => {
  const s = setup({ holders: { r_a: { quiet: false }, r_b: { quiet: true } } });
  const { state, summary, T } = s;
  state.clock.iso = iso(T);
  state.sessions.create({ id: "s_listen", name: "agent one" });
  state.sessions.create({ id: "s_work" });
  state.sessions.create({ id: "s_away" });
  state.sessions.create({ id: "s_closed" });
  state.sessions.writeMonitor("s_listen", { pid: process.pid, handoff_rev: 0, at: iso(T) });
  state.sessions.touchActivity("s_work");
  state.sessions.touchActivity("s_closed");
  state.clock.iso = iso(T - 30 * MINUTE);
  state.sessions.touchActivity("s_away");
  state.sessions.close("s_closed");
  state.catalog({ session_names: { s_listen: "menu bar icon" } });
  state.review("r_a", { session: "s_listen", title: "Doc A" });
  state.review("r_b", { session: "s_work", title: "Doc B older" });
  state.item("r_b", { page_title: "Doc B older", ts: iso(T - 20 * MINUTE) });
  state.review("r_c", { session: "s_work", title: "Doc C newest" });
  state.item("r_c", { page_title: "Doc C newest", ts: iso(T - MINUTE) });

  const answer = summary.read();
  assert.deepEqual(answer.open_documents.items.map((d) => [d.review, d.focused]).sort(), [["r_a", true], ["r_b", false]]);
  assert.equal(answer.open_documents.count, 2);
  assert.equal(answer.sessions.open, 3, "every session not closed");
  const connected = Object.fromEntries(answer.sessions.connected.items.map((c) => [c.session, c]));
  assert.deepEqual(Object.keys(connected).sort(), ["s_listen", "s_work"]);
  assert.equal(connected.s_listen.presence, "listening");
  assert.equal(connected.s_work.presence, "working");
  assert.equal(connected.s_listen.name, "menu bar icon", "the Library rename");
  assert.equal(connected.s_work.name, "Doc C newest", "else the newest document's title");
  assert.equal(connected.s_work.review, "r_c", "and it points at its newest document");
  assert.equal(connected.s_listen.last_heard_at, iso(T));
});

test("V12: recent follows the Library's order and caps at 8; waiting on you is never capped", async () => {
  const { state, summary, reader, T } = setup({ holders: Object.fromEntries([...Array(10).keys()].map((n) => ["r_" + n, {}])) });
  for (let n = 0; n < 10; n += 1) {
    const id = "r_" + n;
    state.review(id, { session: "s_" + (n % 3), title: "Doc " + n });
    const it = state.item(id, { page_title: "Doc " + n, ts: iso(T - (20 - n) * MINUTE) });
    state.reply(id, it, { status: "question", ts: iso(T - 30 * SECOND + n) });
    // And one comment no agent has answered, so every row waits on an agent too.
    state.item(id, { page_title: "Doc " + n, ts: iso(T - (20 - n) * MINUTE) });
  }
  const list = await reader.list(Date.now());
  const libraryOrder = list.sessions
    .reduce((all, s) => all.concat(s.reviews), [])
    .sort((a, b) => (a.last < b.last ? 1 : a.last > b.last ? -1 : a.id < b.id ? 1 : -1))
    .map((r) => r.id);
  const answer = summary.read();
  assert.deepEqual(answer.recent.items.map((r) => r.review), libraryOrder.slice(0, 8));
  assert.equal(answer.recent.more, 2);
  assert.equal(answer.open_documents.items.length, 8);
  assert.equal(answer.open_documents.more, 2);
  assert.equal(answer.open_documents.count, 10);
  assert.equal(answer.waiting_on_agents.documents.length, 8);
  assert.equal(answer.waiting_on_agents.more, 2);
  assert.equal(answer.waiting_on_you.count, 10);
  assert.equal(answer.waiting_on_you.documents.length, 10, "never cut short");
  assert.deepEqual(
    answer.waiting_on_you.documents.map((d) => d.review),
    [...Array(10).keys()].map((n) => "r_" + (9 - n)),
    "all open, so newest reply first"
  );
});

test("V12: open documents wait first, then the newest reply", () => {
  const { state, summary, T } = setup({ holders: { r_old: {} } });
  state.review("r_old", { session: "s_one", title: "Old" });
  state.review("r_new", { session: "s_one", title: "New" });
  const o = state.item("r_old", { page_title: "Old" });
  state.reply("r_old", o, { status: "question", ts: iso(T - 40 * SECOND) });
  const n = state.item("r_new", { page_title: "New" });
  state.reply("r_new", n, { status: "question", ts: iso(T - 5 * SECOND) });
  const answer = summary.read();
  assert.deepEqual(waitingIds(answer), ["r_old", "r_new"]);
  assert.equal(doc(answer, "r_old").open, true);
});

// ---------------------------------------------------------------------------
// Privacy (V13)
// ---------------------------------------------------------------------------

test("V13: no comment text, token, absolute path, control or format character, or title past the cap", () => {
  const { state, summary, T } = fullState();
  const long = "L".repeat(300);
  state.review("r_bidi", { session: "s_listen", doc: "docs/bidi.md", title: "Invoice ‮gnp.exe‬" });
  const b = state.item("r_bidi", { page_title: "Invoice ‮gnp.exe‬\u0007" });
  state.reply("r_bidi", b, { status: "question", ts: iso(T - 5 * SECOND) });
  state.review("r_long", { session: "s_listen", doc: "docs/long.md", title: long });
  const l = state.item("r_long", { page_title: long });
  state.reply("r_long", l, { status: "question", ts: iso(T - 4 * SECOND) });
  // A document outside the home folder: never shown by its absolute path.
  const outside = path.join(state.root, "outside", "elsewhere.md");
  fs.mkdirSync(path.dirname(outside), { recursive: true });
  fs.writeFileSync(outside, "# Elsewhere\n");
  state.review("r_out", { session: "s_listen", file: outside, title: "Elsewhere" });
  state.item("r_out", { page_title: "Elsewhere" });

  const answer = summary.read();
  const text = JSON.stringify(answer);
  assert.equal(text.includes(fixture.MARKER), false, "no comment text");
  assert.equal(text.includes("tok_"), false, "no token");
  assert.equal(text.includes(state.root), false, "no absolute path");
  // eslint-disable-next-line no-control-regex
  assert.equal(/[\u0000-\u001f\u007f]|\p{Cf}/u.test(JSON.parse(text) && collectStrings(answer).join("")), false, "no control or format character");
  collectTitles(answer).forEach((t) => assert.ok(t === null || Array.from(t).length <= 120, "title past the cap: " + t));
  collectHints(answer).forEach((h) => assert.ok(h === null || h.charAt(0) === "~" || h.indexOf("/") === -1, "a path hint is ~ or a bare name: " + h));
  assert.equal(doc(answer, "r_bidi").title, "Invoice gnp.exe");
});

function collectStrings(value, out) {
  const list = out || [];
  if (typeof value === "string") list.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, list));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, list));
  return list;
}

function collectByKey(value, key, out) {
  const list = out || [];
  if (Array.isArray(value)) value.forEach((v) => collectByKey(v, key, list));
  else if (value && typeof value === "object") {
    Object.keys(value).forEach((k) => {
      if (k === key) list.push(value[k]);
      else collectByKey(value[k], key, list);
    });
  }
  return list;
}

const collectTitles = (answer) => collectByKey(answer, "title").concat(collectByKey(answer, "name"));
const collectHints = (answer) => collectByKey(answer, "path_hint");

// ---------------------------------------------------------------------------
// The cache (V17)
// ---------------------------------------------------------------------------

test("V17: nothing changed rebuilds nothing; touching one log rebuilds only that review", () => {
  const { state, summary, T } = setup();
  ["r_a", "r_b", "r_c"].forEach((id) => {
    state.review(id, { session: "s_one", title: id });
    state.item(id, { page_title: id });
  });
  summary.read();
  assert.deepEqual(summary.lastRebuilt().sort(), ["r_a", "r_b", "r_c"], "the first answer builds every review");
  summary.read();
  assert.deepEqual(summary.lastRebuilt(), [], "nothing changed, nothing rebuilt");
  const it = state.item("r_b", { page_title: "r_b" });
  state.reply("r_b", it, { status: "question", ts: iso(T - 5 * SECOND) });
  const answer = summary.read();
  assert.deepEqual(summary.lastRebuilt(), ["r_b"]);
  assert.deepEqual(waitingIds(answer), ["r_b"]);
});

test("V17: a same-size rewrite in the same millisecond still rebuilds, within one beat", () => {
  const { state, summary, clock } = setup();
  state.review("r_a", { session: "s_one", title: "Same size A" });
  state.item("r_a", { page_title: "Same size A" });
  const file = stateDir.reviewJsonPath(state.dir, "r_a");
  // A whole second, which every file system stores exactly.
  // The log no newer than review.json, so the reader takes review.json's title.
  const stamp = Math.floor(Date.now() / 1000);
  fs.utimesSync(stateDir.eventsPath(state.dir, "r_a"), stamp, stamp);
  fs.utimesSync(file, stamp, stamp);
  summary.read();
  const before = fs.statSync(file);
  const bytes = fs.readFileSync(file, "utf8").replace("Same size A", "Same size B");
  assert.equal(Buffer.byteLength(bytes), before.size, "the same size");
  const temp = file + ".tmp";
  fs.writeFileSync(temp, bytes);
  fs.utimesSync(temp, stamp, stamp);
  fs.renameSync(temp, file);
  assert.equal(fs.statSync(file).mtimeMs, before.mtimeMs, "and the same modified time");
  const { answer, rebuilt } = afterEveryReview(summary, clock);
  assert.deepEqual(rebuilt, ["r_a"]);
  assert.equal(answer.recent.items[0].title, "Same size B");
});

test("V17: deleting the reviewed document drops it from waiting on you within one beat", () => {
  const { state, summary, T, clock } = setup();
  const a = state.review("r_a", { session: "s_one", title: "A" });
  const it = state.item("r_a", { page_title: "A" });
  state.reply("r_a", it, { status: "question", ts: iso(T - 5 * SECOND) });
  assert.deepEqual(waitingIds(summary.read()), ["r_a"]);
  fs.unlinkSync(a.file);
  clock.ms += BEAT;
  assert.deepEqual(waitingIds(summary.read()), []);
  assert.deepEqual(summary.lastRebuilt(), ["r_a"]);
});

test("V17: a Library rename shows on the next summary, with nothing rebuilt", () => {
  const { state, summary } = setup();
  state.review("r_a", { session: "s_one", title: "Original" });
  state.item("r_a", { page_title: "Original" });
  assert.equal(summary.read().recent.items[0].title, "Original");
  state.catalog({ names: { r_a: "Renamed by Ken" } });
  const answer = summary.read();
  assert.equal(answer.recent.items[0].title, "Renamed by Ken");
  assert.deepEqual(summary.lastRebuilt(), [], "catalog.json is read once per request, not per review");
});

test("the reader's unread fold reads only a log's new lines once it has folded it", () => {
  const { state, reader, T } = setup();
  state.review("r_a", { session: "s_one", title: "A" });
  const first = state.item("r_a", { page_title: "A" });
  state.reply("r_a", first, { status: "question", ts: iso(T - 30 * SECOND) });
  assert.equal(reader.reviewPart("r_a", { since: T - MINUTE }).unread.count, 1);
  const second = state.item("r_a", { page_title: "A" });
  state.reply("r_a", second, { status: "not_handled", ts: iso(T - 20 * SECOND) });
  state.seen("r_a", first.id);
  const part = reader.reviewPart("r_a", { since: T - MINUTE });
  assert.deepEqual([part.unread.count, part.unread.questions], [1, 0], "the continued fold matches a fresh one");
  const fresh = record.unseenReplyIds(projection.itemsFrom(state.log.read("r_a")));
  assert.deepEqual(fresh, [second.id]);
});

// ---------------------------------------------------------------------------
// Fix round (code and security review of the integrated diff)
// ---------------------------------------------------------------------------

test("V17: a rewrite the review folder's own times do not show still rebuilds: the key is the files", () => {
  const { state, summary, clock } = setup();
  state.review("r_a", { session: "s_one", title: "Same size A" });
  state.item("r_a", { page_title: "Same size A" });
  const folder = stateDir.reviewDir(state.dir, "r_a");
  const file = stateDir.reviewJsonPath(state.dir, "r_a");
  const stamp = Math.floor(Date.now() / 1000);
  fs.utimesSync(stateDir.eventsPath(state.dir, "r_a"), stamp, stamp);
  fs.utimesSync(file, stamp, stamp);
  fs.utimesSync(folder, stamp, stamp);
  summary.read();
  const temp = file + ".tmp";
  fs.writeFileSync(temp, fs.readFileSync(file, "utf8").replace("Same size A", "Same size B"));
  fs.utimesSync(temp, stamp, stamp);
  fs.renameSync(temp, file);
  // Linux stamps a folder from a coarse clock, so two rewrites in one tick
  // leave it looking untouched. Put it back to say exactly that.
  fs.utimesSync(folder, stamp, stamp);
  const { answer, rebuilt } = afterEveryReview(summary, clock);
  assert.deepEqual(rebuilt, ["r_a"]);
  assert.equal(answer.recent.items[0].title, "Same size B");
});

test("menuText removes lone surrogates, C1 controls and line and paragraph separators", () => {
  assert.equal(catalogReader.menuText("a\uD800b", 120), "ab");
  assert.equal(catalogReader.menuText("a\uDC00b", 120), "ab");
  assert.equal(catalogReader.menuText("a\u0085b\u2028c\u2029d", 120), "abcd");
  assert.equal(catalogReader.menuText("\u{1F600}x", 120), "\u{1F600}x", "a real pair is kept");
});

test("V13: a page title holding a lone surrogate, a C1 control or a line separator reaches the summary clean", () => {
  const { state, summary, T } = setup();
  state.review("r_odd", { session: "s_one", doc: "docs/odd.md", title: "Odd" });
  const it = state.item("r_odd", { page_title: "Half \uD800 pair\u0085 and\u2028 break" });
  state.reply("r_odd", it, { status: "question", ts: iso(T - 5 * SECOND) });
  const answer = summary.read();
  const body = JSON.stringify(answer);
  assert.equal(/\\ud[89a-f]/i.test(body), false, "no lone surrogate escape in the body: " + body);
  assert.equal(/[\u0080-\u009f\u2028\u2029]/.test(collectStrings(answer).join("")), false);
  assert.equal(doc(answer, "r_odd").title, "Half  pair and break");
});

test("one unreadable review is skipped, logged once, and the rest of the summary answers", () => {
  const s = setup();
  const lines = [];
  const summary = summaryModule.createSummary({
    dir: s.state.dir,
    reader: s.reader,
    reviews: fixture.holders({}),
    now: () => s.clock.ms,
    version: "0.4.0",
    startedAt: "2026-10-20T08:00:00.000Z",
    libraryUrl: () => "u",
    log: (line) => lines.push(line)
  });
  const { state, T } = s;
  state.review("r_good", { session: "s_one", title: "Good" });
  const g = state.item("r_good", { page_title: "Good" });
  state.reply("r_good", g, { status: "question", ts: iso(T - 5 * SECOND) });
  state.review("r_bad", { session: "s_one", title: "Bad" });
  const events = stateDir.eventsPath(state.dir, "r_bad");
  const outside = path.join(state.root, "outside-events.jsonl");
  fs.renameSync(events, outside);
  fs.symlinkSync(outside, events);
  const first = summary.read();
  summary.read();
  assert.deepEqual(waitingIds(first), ["r_good"]);
  assert.equal(JSON.stringify(first).includes("r_bad"), false);
  assert.equal(lines.length, 1, "one line, not one per poll: " + JSON.stringify(lines));
  assert.match(lines[0], /r_bad/);
});

test("a session file swapped for a symlink after the first read reads as bad, and its target never shows", () => {
  const { state, reader } = setup();
  state.sessions.create({ id: "s_swap", name: "inside name" });
  state.review("r_a", { session: "s_swap", title: "A" });
  assert.equal(reader.reviewPart("r_a").unreadable, false);
  assert.equal(reader.sessionsAt(Date.now()).find((s) => s.id === "s_swap").name, "inside name");
  const file = stateDir.agentSessionPath(state.dir, "s_swap");
  const outside = path.join(state.root, "outside-session.json");
  const held = JSON.parse(fs.readFileSync(file, "utf8"));
  fs.writeFileSync(outside, JSON.stringify(Object.assign(held, { name: "OUTSIDE NAME" })));
  fs.unlinkSync(file);
  fs.symlinkSync(outside, file);
  assert.equal(reader.reviewPart("r_a").unreadable, true, "the session reads as bad");
  const sessions = reader.sessionsAt(Date.now());
  assert.equal(JSON.stringify(sessions).includes("OUTSIDE NAME"), false);
});

// ---------------------------------------------------------------------------
// Spec check follow-up: the app decodes every string field as a string
// ---------------------------------------------------------------------------

/** Every path in the answer whose value is null. */
function nullPaths(value, at, out) {
  const list = out || [];
  const here = at || "$";
  if (value === null) list.push(here);
  else if (Array.isArray(value)) value.forEach((v) => nullPaths(v, here + "[]", list));
  else if (typeof value === "object") Object.keys(value).forEach((k) => nullPaths(value[k], here + "." + k, list));
  return list;
}

test("no null anywhere but a session's review, over a sparse state folder", () => {
  const { state, summary, T } = setup({ holders: { r_untitled: { quiet: false }, r_blank: {}, r_nodoc: {} } });
  state.clock.iso = iso(T);
  // A live session with no name, no Library name, no monitor ever, and no review.
  state.sessions.create({ id: "s_bare" });
  state.sessions.touchActivity("s_bare");
  // A review whose page has no title and whose file has no heading.
  const untitled = path.join(state.home, "notes", "untitled.html");
  fs.mkdirSync(path.dirname(untitled), { recursive: true });
  fs.writeFileSync(untitled, "<p>no title here</p>\n");
  state.review("r_untitled", { session: "s_bare_two", file: untitled });
  const it = state.item("r_untitled", { page_title: null });
  state.reply("r_untitled", it, { status: "question", ts: iso(T - 5 * SECOND) });
  // A page title made only of characters the menu removes.
  state.review("r_blank", { session: "s_bare_two", doc: "notes/blank.md", title: "Blank" });
  const b = state.item("r_blank", { page_title: "‮\u0007" });
  state.reply("r_blank", b, { status: "question", ts: iso(T - 4 * SECOND) });
  // A review with no document on record at all.
  state.review("r_nodoc", { session: "s_bare_two", title: "No doc" });
  fs.writeFileSync(stateDir.metaPath(state.dir, "r_nodoc"), JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(stateDir.metaPath(state.dir, "r_nodoc"), "utf8")), { target_path: null, target_paths: [] })));

  const answer = summary.read();
  assert.deepEqual(nullPaths(answer), ["$.sessions.connected.items[].review"], JSON.stringify(answer, null, 2));
  const bare = answer.sessions.connected.items.find((s) => s.session === "s_bare");
  assert.equal(bare.name, "s_bare", "a session with no name is named by its id");
  assert.equal(typeof bare.last_heard_at, "string");
  assert.equal(doc(answer, "r_untitled").title, "untitled.html", "a document with no title is named by its file");
  assert.equal(doc(answer, "r_blank").title, "blank.md", "and so is one whose title cleans to nothing");
  assert.equal(typeof answer.helper.version, "string");
  assert.equal(typeof answer.library_url, "string");
});

test("V12: connected sessions cap at 8 with a correct more", () => {
  const { state, summary, T } = setup();
  state.clock.iso = iso(T);
  for (let n = 0; n < 10; n += 1) {
    state.sessions.create({ id: "s_live_" + n });
    state.sessions.touchActivity("s_live_" + n);
  }
  const connected = summary.read().sessions.connected;
  assert.equal(connected.count, 10);
  assert.equal(connected.items.length, 8);
  assert.equal(connected.more, 2);
});

// ---------------------------------------------------------------------------
// Fix round 2: an idle poll costs almost nothing
// ---------------------------------------------------------------------------

test("V18: an idle poll between beats stats one file, catalog.json, and reads none", () => {
  const { state, summary, clock } = setup();
  for (let n = 0; n < 20; n += 1) {
    state.review("r_" + n, { session: "s_one", title: "Doc " + n });
    state.item("r_" + n, { page_title: "Doc " + n });
  }
  summary.read();
  const stats = [];
  const reads = [];
  const realStat = fs.statSync;
  const realRead = fs.readFileSync;
  const realDir = fs.readdirSync;
  fs.statSync = function (file) { stats.push(String(file)); return realStat.apply(fs, arguments); };
  fs.readFileSync = function (file) { reads.push(String(file)); return realRead.apply(fs, arguments); };
  fs.readdirSync = function (file) { reads.push(String(file)); return realDir.apply(fs, arguments); };
  try {
    clock.ms += 5 * SECOND;
    summary.read();
    clock.ms += 5 * SECOND;
    summary.read();
  } finally {
    fs.statSync = realStat;
    fs.readFileSync = realRead;
    fs.readdirSync = realDir;
  }
  assert.deepEqual(stats.map((f) => path.basename(f)), ["catalog.json", "catalog.json"], "one stat per poll");
  assert.deepEqual(reads, [], "nothing read, nothing listed");
});

test("a write the helper did not make shows on the next beat; one it made shows on the next poll", () => {
  const { state, summary, clock, T } = setup();
  state.review("r_a", { session: "s_one", title: "A" });
  summary.read();
  // The helper's own append (the fixture's log tells the summary, as the
  // helper's does): the very next poll has it.
  const it = state.item("r_a", { page_title: "A" });
  state.reply("r_a", it, { status: "question", ts: iso(T - 5 * SECOND) });
  clock.ms += SECOND;
  assert.deepEqual(waitingIds(summary.read()), ["r_a"]);
  // A write behind the helper's back (another process's log): not until the beat.
  state.review("r_b", { session: "s_one", title: "B" });
  clock.ms += SECOND;
  summary.read();
  const other = require("../../src/service/log.js").createEventLog({ dir: state.dir });
  const b = record.newItem({ id: "itm_b", kind: record.KIND.COMMENT, state: record.STATE.READY, note: "x", page_origin: "http://127.0.0.1:4321", page_path: "/b.html", page_seq: 1 });
  other.append("r_b", [protocol.newEvent({ event: protocol.EVENT.ITEM_READY, event_id: "evt_other_b", review: "r_b", item: b.id, rev: b.rev, page_path: b.page_path, page_seq: 1, payload: { draft: false, record: b } })]);
  other.append("r_b", [protocol.newEvent({ event: protocol.EVENT.REPLY_FOLDED, event_id: "evt_other_fold", review: "r_b", item: b.id, rev: b.rev, ts: iso(T - 2 * SECOND), payload: { accepted: true, state: "ready", file: "replies.jsonl", reply: { status: "question", agent: "claude", text: "which?" } } })]);
  clock.ms += SECOND;
  assert.deepEqual(waitingIds(summary.read()), ["r_a"], "not yet: no beat since");
  const { answer } = afterEveryReview(summary, clock);
  assert.deepEqual(waitingIds(answer).sort(), ["r_a", "r_b"], "the beats find it");
});

test("an open session nobody watched shows connected on the next beat after its first heartbeat, and drops out when the heartbeat goes stale", () => {
  const { state, summary, clock, T } = setup();
  state.clock.iso = iso(T);
  state.sessions.create({ id: "s_quiet", name: "quiet" });
  const connected = () => summary.read().sessions.connected.items.map((s) => s.session);
  assert.deepEqual(connected(), []);
  clock.ms += BEAT;
  assert.deepEqual(connected(), [], "still nobody, and nothing written");
  state.sessions.writeMonitor("s_quiet", { pid: process.pid, handoff_rev: 0, at: iso(clock.ms) });
  clock.ms += BEAT;
  assert.deepEqual(connected(), ["s_quiet"], "the heartbeat moved its folder");
  clock.ms += 10 * MINUTE;
  assert.deepEqual(connected(), [], "a heartbeat ten minutes old is nobody listening");
});
