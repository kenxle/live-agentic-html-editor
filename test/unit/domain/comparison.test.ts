/*
 * read-when: Changing src/domain/comparison.ts, or when one of these tests fails.
 * not-for: How markup is read for text; see block-text.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { blockText } from "../../../src/domain/block-text.ts";
import { COMPARISON_MODE, emphasisRuns, equalsInMode, modeFor, structureOf } from "../../../src/domain/comparison.ts";

const UNBOLDED = 'Runners come back <span style="font-weight: normal;">too fast</span> after a layoff.';
const PLAIN = "Runners come back too fast after a layoff.";

test("the two comparison modes are text and structure", () => {
  assert.deepEqual(COMPARISON_MODE, { TEXT: "text", STRUCTURE: "structure" });
});

test("a format-only record compares on structure and every other kind on text", () => {
  assert.equal(modeFor("format_only"), "structure");
  assert.equal(modeFor("edit"), "text");
  assert.equal(modeFor("comment"), "text");
  assert.equal(modeFor(""), "text");
});

test("structureOf keeps the four structural tags bare and drops the rest, leaving a space where a break was", () => {
  assert.equal(
    structureOf("<p>a <b>b</b> <span>c</span><br>d</p><p>e <i>f</i></p>"),
    "a <strong>b</strong> c d e <em>f</em>"
  );
  assert.equal(structureOf('<p class="lead"><a href="https://example.com">a</a> <code>b</code></p>'), "a b");
  assert.equal(structureOf("a<br>b"), "a b");
});

test("structureOf writes a reset marker as a tag, so an unbolded sentence has structure", () => {
  assert.equal(structureOf(UNBOLDED), "Runners come back <not-bold>too fast</not-bold> after a layoff.");
  assert.equal(structureOf('<span style="font-style:normal">x</span>'), "<not-italic>x</not-italic>");
});

test("structureOf folds all whitespace, pre included", () => {
  assert.equal(structureOf("<pre>a   <b>b</b></pre>"), "a <strong>b</strong>");
  assert.equal(structureOf("<p>a</p>\n\n<p>b</p>"), "a b");
});

test("text mode compares what textOf reads", () => {
  assert.equal(equalsInMode("text", "Hello world.", "Hello\n\nworld."), false);
  assert.equal(equalsInMode("text", "<p>Hello world.</p>", "Hello world."), true);
  assert.equal(equalsInMode("text", "<p>Hello <strong>world.</strong></p>", "Hello world."), true);
  assert.equal(equalsInMode(COMPARISON_MODE.TEXT, "a", "b"), false);
});

test("structure mode compares which words carry which emphasis, and nothing else", () => {
  assert.equal(equalsInMode("structure", "<p>a <span class=x>b</span> c</p>", "<p>a b c</p>"), true);
  assert.equal(equalsInMode("structure", "<p>a <b>b</b> c</p>", "<p>a <strong>b</strong> c</p>"), true);
  assert.equal(equalsInMode("structure", "<p>a <b>b</b> c</p>", "<p>a <em>b</em> c</p>"), false);
  assert.equal(equalsInMode("structure", "<p><strong>a</strong> b</p>", "<p>a <strong>b</strong></p>"), false);
  assert.equal(equalsInMode(COMPARISON_MODE.STRUCTURE, PLAIN, UNBOLDED), false);
});

test("the modes disagree on a text-equal, structure-different pair and agree on a pair equal both ways", () => {
  const plain = "<p>The plan is ready now</p>";
  const bold = "<p>The plan is <strong>ready</strong> now</p>";
  assert.equal(equalsInMode("text", plain, bold), true);
  assert.equal(equalsInMode("structure", plain, bold), false);

  const tidy = "<p>The plan is <em>ready</em> now</p>";
  const loose = "<p>The   plan is <i>ready</i> now</p>";
  assert.equal(equalsInMode("text", tidy, loose), true);
  assert.equal(equalsInMode("structure", tidy, loose), true);
});

test("a plain sentence and its unbolded form are equal in text and different in structure", () => {
  assert.equal(blockText(UNBOLDED), PLAIN);
  assert.equal(equalsInMode("text", UNBOLDED, PLAIN), true);
  assert.equal(equalsInMode("structure", UNBOLDED, PLAIN), false);
});

test("emphasisRuns lists each run of a structural tag with its words", () => {
  assert.deepEqual(emphasisRuns("a <em>b</em> c"), [{ tag: "em", text: "b" }]);
  assert.deepEqual(emphasisRuns("a <b>b c</b> d"), [{ tag: "strong", text: "b c" }]);
  assert.deepEqual(emphasisRuns("a <not-bold>b</not-bold> c"), [{ tag: "not-bold", text: "b" }]);
  assert.deepEqual(emphasisRuns("a <not-italic>b</not-italic> c"), [{ tag: "not-italic", text: "b" }]);
});

test("emphasisRuns lists a run nested inside another once per tag, inner first, in the order the runs close", () => {
  assert.deepEqual(emphasisRuns("<strong><em>x</em></strong>"), [
    { tag: "em", text: "x" },
    { tag: "strong", text: "x" }
  ]);
  assert.deepEqual(emphasisRuns("<em>a <em>b</em> c</em>"), [
    { tag: "em", text: "b" },
    { tag: "em", text: "a b c" }
  ]);
});

test("emphasisRuns leaves out a run with no words and everything that is not bold or italic", () => {
  assert.deepEqual(emphasisRuns('<p class="lead"><a href="https://example.com">a</a> <code>b</code></p>'), []);
  assert.deepEqual(emphasisRuns("a <em> </em>b"), []);
  assert.deepEqual(emphasisRuns(""), []);
});

test("emphasisRuns lists runs still open at the end after the rest, innermost first", () => {
  assert.deepEqual(emphasisRuns("<em>a <strong>b"), [
    { tag: "strong", text: "b" },
    { tag: "em", text: "a b" }
  ]);
});
