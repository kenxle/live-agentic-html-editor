/*
 * read-when: Changing src/domain/run-match.ts, or when one of these tests fails.
 * not-for: How a new block is cleaned before it is written; see run-blocks.test.ts.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { blockWords } from "../../../src/domain/run-blocks.ts";
import {
  MATCH_STATUS,
  RUN_WALK_SLACK,
  SHORT_BLOCK_WORDS,
  leafBlocks,
  matchRun,
  runClash
} from "../../../src/domain/run-match.ts";
import type { LeafBlock, MatchEntry } from "../../../src/domain/run-match.ts";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "fixtures", "free_writing");

function read(name: string): string {
  return readFileSync(join(FIXTURES, name), "utf8");
}

function shape(leaves: readonly LeafBlock[]): string[] {
  return leaves.map((leaf) => leaf.tag + ": " + leaf.words);
}

function block(html: string): MatchEntry {
  return { html };
}

function leavesOf(html: string): readonly LeafBlock[] {
  return leafBlocks(html);
}

interface MalformedSample {
  readonly name: string;
  readonly html: string;
  readonly expected: readonly string[];
}

const MALFORMED: readonly MalformedSample[] = [
  {
    name: "p closed by a div",
    html: "<p>First words here<div>Then a div block</div>",
    expected: ["p: First words here", "div: Then a div block"]
  },
  {
    name: "unclosed li",
    html: "<ul><li>One item<li>Two item</ul><p>After the list</p>",
    expected: ["ul: One item Two item", "p: After the list"]
  },
  {
    name: "script holding a p",
    html: '<p>Before the script</p><script>var s = "<p>not a block</p>";</script><p>After the script</p>',
    expected: ["p: Before the script", "p: After the script"]
  },
  {
    name: "template contents",
    html: "<p>Outside the template</p><template><p>Inside the template</p></template>",
    expected: ["p: Outside the template"]
  },
  {
    name: "comments",
    html: "<p>Kept words<!-- <p>hidden</p> --></p><!-- a comment --><p>More kept words</p>",
    expected: ["p: Kept words", "p: More kept words"]
  }
];

test("the walk's numbers are the plan's", () => {
  assert.equal(SHORT_BLOCK_WORDS, 5);
  assert.equal(RUN_WALK_SLACK, 2);
});

test("the four match statuses are whole, joined, split and missing", () => {
  assert.deepEqual(MATCH_STATUS, { WHOLE: "whole", JOINED: "joined", SPLIT: "split", MISSING: "missing" });
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
  assert.deepEqual(got, [{ tag: "ul", html: "<li>One</li><li>Two <strong>b</strong></li>", words: "One Two b" }]);
});

test("a leaf keeps its inner markup, cleaned", () => {
  const got = leavesOf('<p class="x">A <b>bold</b> word</p>');
  assert.deepEqual(got, [{ tag: "p", html: "A <strong>bold</strong> word", words: "A bold word" }]);
});

test("the reader follows the browser's repair of malformed markup", () => {
  for (const sample of MALFORMED) assert.deepEqual(shape(leavesOf(sample.html)), sample.expected, sample.name);
  assert.deepEqual(shape(leavesOf("<p>a<p>b")), ["p: a", "p: b"]);
});

test("the reader handles comments, void elements and raw-text elements as a browser does", () => {
  assert.deepEqual(shape(leavesOf("<p>a</p><!-- never closed <p>b</p>")), ["p: a"]);
  assert.deepEqual(shape(leavesOf("<p>a<br>b</p>")), ["p: a b"]);
  assert.deepEqual(shape(leavesOf("<p>a</p><style>p { color: red }</style><p>b</p>")), ["p: a", "p: b"]);
  assert.deepEqual(shape(leavesOf("<p>a</p><SCRIPT>x</SCRIPT><p>b</p>")), ["p: a", "p: b"]);
  assert.deepEqual(shape(leavesOf("<p>a</p><script>never closed <p>b</p>")), ["p: a"]);
  assert.deepEqual(shape(leavesOf("</p><p>a</p></div>")), ["p: a"]);
});

test("the start of a block closes an open paragraph, and an li closes the nearest open li unless a list is nearer", () => {
  assert.deepEqual(shape(leavesOf("<p>a<h2>b</h2>")), ["p: a", "h2: b"]);
  assert.deepEqual(shape(leavesOf("<ul><li>a<ul><li>b</li></ul><li>c</ul>")), ["ul: a b c"]);
});

test("the leaves come back in document order, and loose text in a block that holds blocks is never a leaf", () => {
  assert.deepEqual(shape(leavesOf("<blockquote><p>a</p>loose</blockquote>")), ["p: a"]);
  assert.deepEqual(shape(leavesOf("<section><h2>t</h2><p>one</p><div><p>two</p></div></section>")), ["h2: t", "p: one", "p: two"]);
});

test("tool chrome, the overlay root and dropped elements are not blocks and never decide whether a parent is a leaf", () => {
  assert.deepEqual(shape(leavesOf('<p>Page words</p><div data-lahe="chrome"><p>Rail words</p></div>')), ["p: Page words"]);
  assert.deepEqual(shape(leavesOf('<div id="lahe-surface-root"><p>rail</p></div><p>x</p>')), ["p: x"]);
  assert.deepEqual(shape(leavesOf("<head><title>t</title></head><p>x</p>")), ["p: x"]);
  assert.deepEqual(shape(leavesOf('<div>words <div data-lahe="chrome"><p>rail</p></div></div>')), ["div: words"]);
  assert.deepEqual(shape(leavesOf("<div>words <template><p>t</p></template></div>")), ["div: words"]);
});

test("the file-name title is skipped, but a hero holding only the title is still not a leaf", () => {
  const title = '<h1 data-lahe-file-title="file-name">notes.md</h1>';
  assert.deepEqual(shape(leavesOf("<header>" + title + "</header><p>x</p>")), ["p: x"]);
  assert.deepEqual(shape(leavesOf("<header>Label" + title + "</header>")), []);
});

test("a leaf's words are folded for typography", () => {
  assert.deepEqual(shape(leavesOf("<p>It\u2019s \u201Cdone\u201D \u2014 now</p>")), ["p: It's \"done\" - now"]);
});

test("a block found as a whole leaf is whole", () => {
  const got = matchRun([block("Hello there friend")], leavesOf("<p>Hello there friend</p>"));
  assert.deepEqual(got, [{ index: 0, status: "whole", leaves: [0] }]);
});

test("two blocks in one leaf are joined", () => {
  const got = matchRun(
    [block("First part of it."), block("Second part of it.")],
    leavesOf("<p>First part of it. Second part of it.</p>")
  );
  assert.deepEqual(got, [
    { index: 0, status: "joined", leaves: [0] },
    { index: 1, status: "joined", leaves: [0] }
  ]);
});

test("one block spread over two leaves is split", () => {
  const got = matchRun(
    [block("First part of it. Second part of it.")],
    leavesOf("<p>First part of it.</p><p>Second part of it.</p>")
  );
  assert.deepEqual(got, [{ index: 0, status: "split", leaves: [0, 1] }]);
});

test("a block not in the walk is missing, and the walk goes on to the next block", () => {
  const got = matchRun(
    [block("Alpha words here"), block("Beta words here"), block("Gamma words here")],
    leavesOf("<p>Alpha words here</p><p>Gamma words here</p>")
  );
  assert.deepEqual(got, [
    { index: 0, status: "whole", leaves: [0] },
    { index: 1, status: "missing", leaves: [] },
    { index: 2, status: "whole", leaves: [1] }
  ]);
});

test("tag and markup never decide presence", () => {
  const got = matchRun(
    [block("<strong>What it cost me</strong>"), block("<li>scrolling</li><li>re-asking</li>")],
    leavesOf("<p>What it cost me</p><p>scrolling re-asking</p>")
  );
  assert.deepEqual(
    got.map((match) => match.status),
    ["whole", "whole"]
  );
});

test("an entry that carries its words is compared by them, and one that carries markup by its words", () => {
  const leaves = leavesOf("<p>Alpha words here</p><p>Beta words here</p>");
  const viaWords = matchRun([{ words: blockWords("Alpha words here") }, { words: blockWords("Beta words here") }], leaves);
  const viaMarkup = matchRun([block("Alpha words here"), block("<em>Beta</em> words here")], leaves);
  assert.deepEqual(viaWords, viaMarkup);
  assert.deepEqual(
    viaWords.map((match) => match.status),
    ["whole", "whole"]
  );
  assert.deepEqual(matchRun([{ words: blockWords("Alpha words here") }], [{ words: blockWords("Alpha words here") }]), [
    { index: 0, status: "whole", leaves: [0] }
  ]);
});

test("leading leaves that match nothing are skipped before the first match", () => {
  const got = matchRun([block("Target words")], leavesOf("<p>Something else</p><p>Target words</p>"));
  assert.deepEqual(got, [{ index: 0, status: "whole", leaves: [1] }]);
});

test("a short block inside a later unrelated block is missing", () => {
  const got = matchRun([block("Notes")], leavesOf("<p>These Notes are about something else entirely</p>"));
  assert.deepEqual(got, [{ index: 0, status: "missing", leaves: [] }]);
});

test("blocks out of run order: the one out of order is missing", () => {
  const got = matchRun(
    [block("Alpha words here"), block("Beta words here")],
    leavesOf("<p>Beta words here</p><p>Alpha words here</p>")
  );
  assert.deepEqual(
    got.map((match) => match.status),
    ["missing", "whole"]
  );
});

test("a block that is only a prefix of a longer leaf is missing", () => {
  const got = matchRun([block("The first words")], leavesOf("<p>The first words and then a lot more</p>"));
  assert.equal(got[0]?.status, "missing");
});

test("a block past a leaf that matches nothing, after a match, is missing", () => {
  const got = matchRun(
    [block("Alpha words here"), block("Beta words here")],
    leavesOf("<p>Alpha words here</p><p>Unrelated</p><p>Beta words here</p>")
  );
  assert.deepEqual(
    got.map((match) => match.status),
    ["whole", "missing"]
  );
});

test("a block past the run's length plus the slack is missing", () => {
  const got = matchRun([block("Target words")], leavesOf("<p>a</p><p>b</p><p>c</p><p>Target words</p>"));
  assert.equal(got[0]?.status, "missing");
  const within = matchRun([block("Target words")], leavesOf("<p>a</p><p>b</p><p>Target words</p>"));
  assert.deepEqual(within, [{ index: 0, status: "whole", leaves: [2] }]);
});

test("a split never reaches past the walk limit", () => {
  const got = matchRun([block("one two three")], leavesOf("<p>one</p><p>two</p><p>three</p>"));
  assert.deepEqual(got, [{ index: 0, status: "split", leaves: [0, 1, 2] }]);
  const tooFar = matchRun([block("one two three four")], leavesOf("<p>one</p><p>two</p><p>three</p><p>four</p>"));
  assert.equal(tooFar[0]?.status, "missing");
});

test("a block with no words is always missing", () => {
  const got = matchRun([block("<em></em>"), block("Alpha words here")], leavesOf("<p>Alpha words here</p>"));
  assert.deepEqual(got, [
    { index: 0, status: "missing", leaves: [] },
    { index: 1, status: "whole", leaves: [0] }
  ]);
  assert.deepEqual(matchRun([], leavesOf("<p>x</p>")), []);
  assert.deepEqual(matchRun([block("x")], []), [{ index: 0, status: "missing", leaves: [] }]);
});

test("the matcher reads a typed double hyphen and a rendered dash as the same block", () => {
  const got = matchRun([block("She said no -- then left")], leavesOf("<p>She said no \u2014 then left</p>"));
  assert.deepEqual(got, [{ index: 0, status: "whole", leaves: [0] }]);
});

test("a leaf holding a block's words plus a sentence the agent added is a clash on that block", () => {
  const run = [block("Alpha words here"), block("Beta words here")];
  const got = runClash(run, leavesOf("<p>Alpha words here</p><p>Beta words here. The agent added this.</p>"));
  assert.deepEqual(got, { index: 1, blocks: 1, leaf: 1 });
});

test("the clash can be the run's first block, at the first leaf after the anchor", () => {
  const run = [block("Alpha words here and there")];
  const got = runClash(run, leavesOf("<p>Before it, Alpha words here and there</p>"));
  assert.deepEqual(got, { index: 0, blocks: 1, leaf: 0 });
});

test("with nothing matched, a short first block inside the page's next paragraph is not a clash", () => {
  assert.equal(
    runClash(
      [block("Next"), block("Some new words here today")],
      leavesOf("<p>Next, we tested the build on Windows.</p>")
    ),
    null
  );
  assert.equal(runClash([block("Yes")], leavesOf("<p>Yes, that is the plan we agreed.</p>")), null);
});

test("after an earlier block matched, a short block inside the next leaf is still a clash", () => {
  const run = [block("Alpha words here"), block("Yes")];
  const got = runClash(run, leavesOf("<p>Alpha words here</p><p>Yes, and the agent added this.</p>"));
  assert.deepEqual(got, { index: 1, blocks: 1, leaf: 1 });
});

test("two blocks joined in one leaf with extra words are one clash over both", () => {
  const run = [block("Alpha words here"), block("Beta words here"), block("Gamma words here")];
  const got = runClash(run, leavesOf("<p>Alpha words here</p><p>Beta words here Gamma words here and more</p>"));
  assert.deepEqual(got, { index: 1, blocks: 2, leaf: 1 });
});

test("an exact join, a split, or a whole block is never a clash", () => {
  const run = [block("First part of it."), block("Second part of it.")];
  assert.equal(runClash(run, leavesOf("<p>First part of it. Second part of it.</p>")), null);
  assert.equal(
    runClash([block("First part of it. Second part of it.")], leavesOf("<p>First part of it.</p><p>Second part of it.</p>")),
    null
  );
  assert.equal(runClash(run, leavesOf("<p>First part of it.</p><p>Second part of it.</p>")), null);
});

test("a missing block that is not inside the next leaf is missing, not a clash", () => {
  const run = [block("Alpha words here"), block("Beta words here")];
  assert.equal(runClash(run, leavesOf("<p>Alpha words here</p><p>Something else entirely</p>")), null);
});

test("words must be whole words: a block's words inside a longer word are not a clash", () => {
  const run = [block("Alpha words here"), block("Beta")];
  assert.equal(runClash(run, leavesOf("<p>Alpha words here</p><p>Betamax tapes</p>")), null);
  const accented = [block("Alpha words here"), block("Beta")];
  assert.equal(runClash(accented, leavesOf("<p>Alpha words here</p><p>Beta\u00E9 tapes</p>")), null);
  assert.equal(runClash(accented, leavesOf("<p>Alpha words here</p><p>Beta\u0431 tapes</p>")), null);
});

test("with nothing matched, only the first leaf after the anchor can clash", () => {
  const run = [block("Notes")];
  assert.equal(runClash(run, leavesOf("<p>Unrelated first</p><p>These Notes are about something else</p>")), null);
});
