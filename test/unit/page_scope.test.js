// Which records belong to the page in front of the reviewer, and the elapsed
// phrase the helper and the rail both say.
//
// A review MAY span pages. The browser layer is loaded into ONE document and can
// only act on that one, so record.samePage is the filter every surface in the
// layer reads through. Live on 2026-08-17 a second page attached to an existing
// review inherited all 78 of the first page's items, tried to re-anchor them,
// and listed them in the rail.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const elapsed = require("../../src/shared/elapsed.js");

function itemOn(origin, path) {
  return record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "say which week this is about",
    page_origin: origin,
    page_path: path,
    page_title: "A page",
    page_seq: 1
  });
}

function pageOn(origin, path) {
  return { origin: origin, path: path, title: "A page", seq: 1, source_hint: null };
}

// ---------------------------------------------------------------------------
// Origin plus path
// ---------------------------------------------------------------------------

test("an item made on this page is this page's", () => {
  assert.equal(record.samePage(itemOn("http://127.0.0.1:8080", "/report.html"), pageOn("http://127.0.0.1:8080", "/report.html")), true);
});

test("two different documents on one origin never see each other's items", () => {
  const item = itemOn("http://127.0.0.1:8080", "/report.html");
  assert.equal(record.samePage(item, pageOn("http://127.0.0.1:8080", "/one-pager.html")), false);
});

test("two dev servers both serving /dashboard are two pages, as pageKey says", () => {
  const item = itemOn("http://127.0.0.1:3000", "/dashboard");
  assert.equal(record.samePage(item, pageOn("http://127.0.0.1:4000", "/dashboard")), false);
});

test("pageKeyFor and pageKey spell the same key", () => {
  const item = itemOn("http://127.0.0.1:8080", "/report.html");
  assert.equal(record.pageKey(item), record.pageKeyFor(pageOn("http://127.0.0.1:8080", "/report.html")));
});

// ---------------------------------------------------------------------------
// The file:// nuance
// ---------------------------------------------------------------------------
//
// One document, two ways of visiting it. Opened from disk it carries origin
// "file" and its basename; served over http it carries the server's origin and a
// full pathname. Those keys can never be equal, so a strict match would hide
// each visit's comments from the other on ONE document.

test("a document opened from disk and served over http is one page", () => {
  const fromDisk = itemOn(record.FILE_ORIGIN, "report.html");
  assert.equal(record.samePage(fromDisk, pageOn("http://127.0.0.1:8080", "/docs/report.html")), true);
});

test("and the same holds the other way round", () => {
  const served = itemOn("http://127.0.0.1:8080", "/docs/report.html");
  assert.equal(record.samePage(served, pageOn(record.FILE_ORIGIN, "report.html")), true);
});

test("two different documents from disk stay apart", () => {
  const one = itemOn(record.FILE_ORIGIN, "report.html");
  assert.equal(record.samePage(one, pageOn(record.FILE_ORIGIN, "one-pager.html")), false);
});

test("a file item and a differently named served document stay apart", () => {
  const fromDisk = itemOn(record.FILE_ORIGIN, "report.html");
  assert.equal(record.samePage(fromDisk, pageOn("http://127.0.0.1:8080", "/docs/one-pager.html")), false);
});

test("pageFrom builds a file page the rule can match", () => {
  const page = record.pageFrom({ origin: "null", pathname: "/Users/ken/docs/report.html", href: "file:///Users/ken/docs/report.html" });
  assert.equal(page.origin, record.FILE_ORIGIN);
  assert.equal(page.path, "docs/report.html");
  assert.equal(record.samePage(itemOn("http://127.0.0.1:8080", "/report.html"), page), true);
});

// ---------------------------------------------------------------------------
// Two documents with the same name, off disk
// ---------------------------------------------------------------------------
//
// The bug the basename rule recreated: two DIFFERENT index.html files attached
// to one review both keyed as "file|index.html", so rule 1 matched before any
// disambiguation could run and page B inherited every one of page A's records.
// The file page keeps its parent folder, so the tail comparison tells them
// apart.

test("two index.html files in two folders are two pages, both off disk", () => {
  const a = record.pageFrom({ origin: "null", pathname: "/Users/ken/notes/index.html", href: "file:///Users/ken/notes/index.html" });
  const b = record.pageFrom({ origin: "null", pathname: "/Users/ken/deck/index.html", href: "file:///Users/ken/deck/index.html" });
  assert.notEqual(record.pageKeyFor(a), record.pageKeyFor(b), "the two keys are not the same key");
  assert.equal(record.samePage(itemOn(a.origin, a.path), b), false);
  assert.equal(record.samePage(itemOn(b.origin, b.path), a), false);
});

test("one index.html visited twice off disk is one page", () => {
  const a = record.pageFrom({ origin: "null", pathname: "/Users/ken/notes/index.html", href: "file:///Users/ken/notes/index.html" });
  assert.equal(record.samePage(itemOn(a.origin, a.path), a), true);
});

test("the mixed case: one document off disk and served, folder and all", () => {
  const fromDisk = record.pageFrom({ origin: "null", pathname: "/Users/ken/notes/index.html", href: "file:///Users/ken/notes/index.html" });
  assert.equal(record.samePage(itemOn(fromDisk.origin, fromDisk.path), pageOn("http://127.0.0.1:8080", "/notes/index.html")), true);
  // And a DIFFERENT folder's index.html served over http is not that document.
  assert.equal(record.samePage(itemOn(fromDisk.origin, fromDisk.path), pageOn("http://127.0.0.1:8080", "/deck/index.html")), false);
});

test("a record written before the folder rule still matches on its name alone", () => {
  const older = itemOn(record.FILE_ORIGIN, "report.html");
  assert.equal(record.samePage(older, pageOn("http://127.0.0.1:8080", "/docs/report.html")), true);
});

// ---------------------------------------------------------------------------
// A directory URL is the index document
// ---------------------------------------------------------------------------
//
// A page served at the origin root has the pathname "/", which has no basename
// at all, so the file-versus-http rule could never match it and the reviewer's
// own items vanished on the revisit.

test("a document served at the origin root is the index document, both directions", () => {
  const fromDisk = itemOn(record.FILE_ORIGIN, "index.html");
  assert.equal(record.samePage(fromDisk, pageOn("http://127.0.0.1:8080", "/")), true);
  const served = itemOn("http://127.0.0.1:8080", "/");
  assert.equal(record.samePage(served, pageOn(record.FILE_ORIGIN, "index.html")), true);
});

test("a directory path deeper in is that directory's index document", () => {
  const fromDisk = record.pageFrom({ origin: "null", pathname: "/Users/ken/docs/index.html", href: "file:///Users/ken/docs/index.html" });
  assert.equal(record.samePage(itemOn(fromDisk.origin, fromDisk.path), pageOn("http://127.0.0.1:8080", "/docs/")), true);
});

test("the root is not every document: a named page there stays its own page", () => {
  const served = itemOn("http://127.0.0.1:8080", "/");
  assert.equal(record.samePage(served, pageOn(record.FILE_ORIGIN, "report.html")), false);
});

test("samePage refuses to guess at a missing item or page", () => {
  assert.throws(() => record.samePage(null, pageOn("http://x", "/a")), TypeError);
  assert.throws(() => record.samePage(itemOn("http://x", "/a"), null), TypeError);
});

// ---------------------------------------------------------------------------
// The elapsed phrase, one home
// ---------------------------------------------------------------------------

test("recent times read as a span, older ones as a date, and it never prints an ISO string", () => {
  const now = Date.parse("2026-08-18T04:40:00.000Z");
  const at = (msAgo) => new Date(now - msAgo).toISOString();
  assert.equal(elapsed.elapsedPhrase(at(20 * 1000), { now: now }), "for less than a minute");
  assert.equal(elapsed.elapsedPhrase(at(60 * 1000), { now: now }), "for the last 1 minute");
  assert.equal(elapsed.elapsedPhrase(at(4 * 60 * 1000), { now: now }), "for the last 4 minutes");
  const old = elapsed.elapsedPhrase(at(5 * 60 * 60 * 1000), { now: now });
  assert.equal(old.indexOf("since "), 0);
  assert.equal(old.indexOf("T"), -1, "a local date and time, never the ISO form");
});

test("an unreadable value is echoed rather than guessed at", () => {
  assert.equal(elapsed.elapsedPhrase("not a time"), "since not a time");
});

test("the helper's refusal and the rail's chip say the same words", () => {
  const store = require("../../src/layer/store.js");
  const since = new Date(Date.now() - 4 * 60 * 1000).toISOString();
  const described = store.createStore().describeHolder({ path: "/docs/report.html", since: since });
  assert.equal(described, "the window on docs/report.html, open for the last 4 minutes");
});

// A holder named by a name nobody can read is a refusal that points nowhere.
test("the refusal still names the window when the holder is served at the root", () => {
  const store = require("../../src/layer/store.js");
  const made = store.createStore();
  assert.match(made.describeHolder({ path: "/" }), /the window on \//);
  // Two folders' index.html are two windows, and the sentence says which.
  assert.match(made.describeHolder({ path: "/notes/index.html" }), /notes\/index\.html/);
  assert.match(made.describeHolder({ path: "/deck/index.html" }), /deck\/index\.html/);
});
