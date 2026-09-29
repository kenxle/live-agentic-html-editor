// The string block reader and the run matcher (free-writing architecture,
// Replay after a rebuild: "The walk", "Where the walk stops", and the
// presence table's first row).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const normalize = require("../../src/shared/normalize.js");
const markers = require("../../src/shared/markers.js");
const corpus = require("../fixtures/free_writing/corpus.js");

const FIXTURES = path.join(__dirname, "..", "fixtures", "free_writing");
const read = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");

function shape(leaves) {
  return leaves.map((l) => l.tag + ": " + l.words);
}

function block(tag, html, extra) {
  return Object.assign({ tag: tag, html: html }, extra || {});
}

function leavesOf(html) {
  return normalize.leafBlocks(html);
}

test("the walk's numbers are the plan's", () => {
  assert.equal(normalize.SHORT_BLOCK_WORDS, 5);
  assert.equal(normalize.RUN_WALK_SLACK, 2);
});

test("the file-name title marker has one spelling", () => {
  assert.equal(markers.FILE_TITLE_ATTR, "data-lahe-file-title");
  assert.equal(markers.EDIT_HOST_ATTR, "data-lahe-edit-host");
  const el = { getAttribute: (n) => (n === markers.FILE_TITLE_ATTR ? markers.FILE_TITLE_VALUE : null) };
  assert.equal(markers.isFileTitle(el), true);
  assert.equal(markers.isFileTitle({ getAttribute: () => null }), false);
});

test("on the Markdown render the reader skips the Section N label", () => {
  assert.deepEqual(shape(leavesOf(read("md_render.html"))), [
    "h1: Spike doc",
    "p: A short lede that sits in the hero.",
    "h2: What changed",
    "p: We stopped measuring motion and started measuring outcomes.",
    "p: A second paragraph in the first section.",
    "h2: What comes next",
    "ul: Fewer meetings Longer blocks"
  ]);
});

test("the reader skips the marked file-name title, so an empty notes page has no blocks", () => {
  assert.deepEqual(leavesOf(read("empty_notes.html")), []);
});

test("the reader skips elements with no text", () => {
  assert.deepEqual(shape(leavesOf("<p></p><div><p> </p></div><p>Words</p><h2><br></h2>")), ["p: Words"]);
});

test("a list is one block whose lines are its items", () => {
  const got = leavesOf("<ul><li>One</li><li>Two <strong>b</strong></li></ul>");
  assert.equal(got.length, 1);
  assert.equal(got[0].tag, "ul");
  assert.equal(got[0].words, "One Two b");
  assert.equal(got[0].html, "<li>One</li><li>Two <strong>b</strong></li>");
});

test("a leaf keeps its inner markup, cleaned", () => {
  const got = leavesOf('<p class="x">A <b>bold</b> word</p>');
  assert.equal(got[0].html, 'A <strong>bold</strong> word');
});

test("the reader follows the browser's repair of malformed markup", () => {
  const m = {};
  corpus.MALFORMED.forEach((s) => (m[s.name] = shape(leavesOf(s.html))));
  assert.deepEqual(m["p closed by a div"], ["p: First words here", "div: Then a div block"]);
  assert.deepEqual(m["unclosed li"], ["ul: One item Two item", "p: After the list"]);
  assert.deepEqual(m["script holding a p"], ["p: Before the script", "p: After the script"]);
  assert.deepEqual(m["template contents"], ["p: Outside the template"]);
  assert.deepEqual(m.comments, ["p: Kept words", "p: More kept words"]);
});

test("tool chrome is not a block", () => {
  assert.deepEqual(shape(leavesOf('<p>Page words</p><div data-lahe="chrome"><p>Rail words</p></div>')), ["p: Page words"]);
});

test("words are folded for typography", () => {
  assert.equal(normalize.blockWords("It\u2019s \u201cdone\u201d \u2014 now"), "It's \"done\" - now");
  assert.equal(normalize.blockWords("Fish &amp; chips &quot;x&quot;"), 'Fish & chips "x"');
});

// ---------------------------------------------------------------------------
// The matcher
// ---------------------------------------------------------------------------

test("a block found as a whole leaf is whole", () => {
  const got = normalize.matchRun([block("p", "Hello there friend")], leavesOf("<p>Hello there friend</p>"));
  assert.deepEqual(got, [{ index: 0, status: "whole", leaves: [0] }]);
});

test("two blocks in one leaf are joined", () => {
  const got = normalize.matchRun(
    [block("p", "First part of it."), block("p", "Second part of it.")],
    leavesOf("<p>First part of it. Second part of it.</p>")
  );
  assert.deepEqual(got, [
    { index: 0, status: "joined", leaves: [0] },
    { index: 1, status: "joined", leaves: [0] }
  ]);
});

test("one block spread over two leaves is split", () => {
  const got = normalize.matchRun(
    [block("p", "First part of it. Second part of it.")],
    leavesOf("<p>First part of it.</p><p>Second part of it.</p>")
  );
  assert.deepEqual(got, [{ index: 0, status: "split", leaves: [0, 1] }]);
});

test("a block not in the walk is missing, and the walk goes on to the next block", () => {
  const got = normalize.matchRun(
    [block("p", "Alpha words here"), block("p", "Beta words here"), block("p", "Gamma words here")],
    leavesOf("<p>Alpha words here</p><p>Gamma words here</p>")
  );
  assert.deepEqual(got, [
    { index: 0, status: "whole", leaves: [0] },
    { index: 1, status: "missing", leaves: [] },
    { index: 2, status: "whole", leaves: [1] }
  ]);
});

test("tag and markup never decide presence", () => {
  const got = normalize.matchRun(
    [block("h2", "<strong>What it cost me</strong>"), block("ul", "<li>scrolling</li><li>re-asking</li>")],
    leavesOf("<p>What it cost me</p><p>scrolling re-asking</p>")
  );
  assert.deepEqual(got.map((g) => g.status), ["whole", "whole"]);
});

test("leading leaves that match nothing are skipped before the first match", () => {
  const got = normalize.matchRun([block("p", "Target words")], leavesOf("<p>Something else</p><p>Target words</p>"));
  assert.deepEqual(got, [{ index: 0, status: "whole", leaves: [1] }]);
});

test("a short block inside a later unrelated block is missing", () => {
  const got = normalize.matchRun([block("p", "Notes")], leavesOf("<p>These Notes are about something else entirely</p>"));
  assert.equal(got[0].status, "missing");
});

test("blocks out of run order: the one out of order is missing", () => {
  const got = normalize.matchRun(
    [block("p", "Alpha words here"), block("p", "Beta words here")],
    leavesOf("<p>Beta words here</p><p>Alpha words here</p>")
  );
  assert.deepEqual(got.map((g) => g.status), ["missing", "whole"]);
});

test("a block that is only a prefix of a longer leaf is missing", () => {
  const got = normalize.matchRun([block("p", "The first words")], leavesOf("<p>The first words and then a lot more</p>"));
  assert.equal(got[0].status, "missing");
});

test("a block past a leaf that matches nothing, after a match, is missing", () => {
  const got = normalize.matchRun(
    [block("p", "Alpha words here"), block("p", "Beta words here")],
    leavesOf("<p>Alpha words here</p><p>Unrelated</p><p>Beta words here</p>")
  );
  assert.deepEqual(got.map((g) => g.status), ["whole", "missing"]);
});

test("a block past the run's length plus the slack is missing", () => {
  // One block, so the walk reads at most 1 + RUN_WALK_SLACK leaves.
  const got = normalize.matchRun([block("p", "Target words")], leavesOf("<p>a</p><p>b</p><p>c</p><p>Target words</p>"));
  assert.equal(got[0].status, "missing");
});

test("runWords counts the run and skips from_anchor blocks", () => {
  const blocks = [
    block("p", "moved tail words here", { from_anchor: true }),
    block("h2", "A <strong>new</strong> heading"),
    block("ul", "<li>one two</li><li>three</li>")
  ];
  assert.equal(normalize.runWords(blocks), 6);
  assert.equal(normalize.runWords([]), 0);
});

test("the matcher reads a typed -- and a rendered dash as the same block", () => {
  const got = normalize.matchRun([block("p", "She said no -- then left")], leavesOf("<p>She said no — then left</p>"));
  assert.deepEqual(got, [{ index: 0, status: "whole", leaves: [0] }]);
});

// ---------------------------------------------------------------------------
// The clash: a leaf holding a run block's words plus words nobody typed
// ---------------------------------------------------------------------------

test("a leaf holding a block's words plus a sentence the agent added is a clash on that block", () => {
  const run = [block("p", "Alpha words here"), block("p", "Beta words here")];
  const got = normalize.runClash(run, leavesOf("<p>Alpha words here</p><p>Beta words here. The agent added this.</p>"));
  assert.deepEqual(got, { index: 0 + 1, blocks: 1, leaf: 1 });
});

test("the clash can be the run's first block, at the first leaf after the anchor", () => {
  const run = [block("p", "Alpha words here")];
  const got = normalize.runClash(run, leavesOf("<p>Before it, Alpha words here</p>"));
  assert.deepEqual(got, { index: 0, blocks: 1, leaf: 0 });
});

test("two blocks joined in one leaf with extra words are one clash over both", () => {
  const run = [block("p", "Alpha words here"), block("p", "Beta words here"), block("p", "Gamma words here")];
  const got = normalize.runClash(run, leavesOf("<p>Alpha words here</p><p>Beta words here Gamma words here and more</p>"));
  assert.deepEqual(got, { index: 1, blocks: 2, leaf: 1 });
});

test("an exact join, a split, or a whole block is never a clash", () => {
  const run = [block("p", "First part of it."), block("p", "Second part of it.")];
  assert.equal(normalize.runClash(run, leavesOf("<p>First part of it. Second part of it.</p>")), null);
  assert.equal(normalize.runClash([block("p", "First part of it. Second part of it.")], leavesOf("<p>First part of it.</p><p>Second part of it.</p>")), null);
  assert.equal(normalize.runClash(run, leavesOf("<p>First part of it.</p><p>Second part of it.</p>")), null);
});

test("a missing block that is not inside the next leaf is missing, not a clash", () => {
  const run = [block("p", "Alpha words here"), block("p", "Beta words here")];
  assert.equal(normalize.runClash(run, leavesOf("<p>Alpha words here</p><p>Something else entirely</p>")), null);
});

test("words must be whole words: a block's words inside a longer word are not a clash", () => {
  const run = [block("p", "Alpha words here"), block("p", "Beta")];
  assert.equal(normalize.runClash(run, leavesOf("<p>Alpha words here</p><p>Betamax tapes</p>")), null);
});

test("with nothing matched, only the first leaf after the anchor can clash", () => {
  const run = [block("p", "Notes")];
  assert.equal(normalize.runClash(run, leavesOf("<p>Unrelated first</p><p>These Notes are about something else</p>")), null);
});
