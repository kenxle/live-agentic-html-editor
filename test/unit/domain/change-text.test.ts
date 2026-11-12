/*
 * read-when: Changing src/domain/change-text.ts, or the sentence an agent reads about a hand edit is wrong, misleading or missing emphasis, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { KIND } from "../../../src/contract/record.ts";
import {
  BREAK_ADDED_LINE,
  BREAK_ADDED_PARAGRAPH,
  BREAK_REMOVED,
  changedSpan,
  editChangeText,
  formattingChangeText,
  paragraphAddition
} from "../../../src/domain/change-text.ts";
import { callUntyped } from "../contract/support/untyped.ts";

const EXISTING = "A friend asked me last week how I actually work with AI.";
const PASTED =
  "Article drop! Some thoughts on how collaborating with AI can move beyond the chat window, " +
  "complete with an open source tool for doing so. https://www.stclair.ai/blog/the-chat-window.html";

test("the three break sentences are pinned", () => {
  assert.equal(BREAK_ADDED_PARAGRAPH, "Added a paragraph break: this block becomes two paragraphs.");
  assert.equal(BREAK_ADDED_LINE, "Added a line break.");
  assert.equal(BREAK_REMOVED, "Removed a break, joining the lines into one.");
});

test("the changed span is what is left of each side after the shared start and end, widened to whole words", () => {
  assert.deepEqual(changedSpan("A friend asked me last week.", "Article drop! A friend asked me last week."), {
    removed: "",
    added: "Article drop! "
  });
  assert.deepEqual(changedSpan("the cat sat", "the cats sat"), { removed: "cat", added: "cats" });
  assert.deepEqual(changedSpan("I like dogs", "I love dogs"), { removed: "like", added: "love" });
});

test("a shared letter at the front no longer splits a word", () => {
  assert.deepEqual(changedSpan("A friend asked", "Article drop!\n\nA friend asked"), { removed: "", added: "Article drop!\n\n" });
  assert.equal(editChangeText(KIND.EDIT, "the cat sat", "the caterpillar sat"), 'Changed "cat" to "caterpillar".');
});

test("a word the two strings share the end of is reported whole", () => {
  assert.deepEqual(changedSpan("xy abc", "xy zbc"), { removed: "abc", added: "zbc" });
  assert.equal(editChangeText(KIND.EDIT, "running fast", "runs fast"), 'Changed "running" to "runs".');
});

test("an apostrophe and an accented letter are word characters, and a non-string reads as empty", () => {
  assert.deepEqual(changedSpan("don't stop", "don't go"), { removed: "stop", added: "go" });
  assert.deepEqual(changedSpan("café au lait", "cafés au lait"), { removed: "café", added: "cafés" });
  assert.deepEqual(changedSpan("it’s here", "it’s there"), { removed: "here", added: "there" });
  assert.deepEqual(changedSpan(null, "x"), { removed: "", added: "x" });
  assert.deepEqual(changedSpan("x", undefined), { removed: "x", added: "" });
  assert.deepEqual(changedSpan(undefined, null), { removed: "", added: "" });
  assert.deepEqual(callUntyped(changedSpan, 5, 6), { removed: "", added: "" });
  assert.deepEqual(changedSpan("same", "same"), { removed: "", added: "" });
});

test("a paragraph added above or below is found when the block's whole earlier text is still there, in one piece", () => {
  assert.deepEqual(paragraphAddition(EXISTING, PASTED + "\n\n" + EXISTING), { where: "before", text: PASTED });
  assert.deepEqual(paragraphAddition(EXISTING, EXISTING + "\n\nA second thought."), { where: "after", text: "A second thought." });
  assert.deepEqual(paragraphAddition("  a  ", "  a\n\n\nb  "), { where: "after", text: "b" }, "both sides trimmed, two or more newlines");
});

test("a split, an insertion in the middle, an equal text or an empty side is no paragraph addition", () => {
  const head = "Runners come back too fast after a layoff. ";
  const tail = "Most of them know it while they are doing it.";
  assert.equal(paragraphAddition(head + tail, head.trim() + "\n\n" + tail), null);
  assert.equal(paragraphAddition("a b", "a\n\nx\n\nb"), null);
  assert.equal(paragraphAddition("a", "a"), null);
  assert.equal(paragraphAddition("", "a\n\nb"), null);
  assert.equal(paragraphAddition("a", ""), null);
  assert.equal(paragraphAddition(null, "x"), null);
  assert.equal(paragraphAddition("a", "a\nb"), null, "one newline is a line break, not a paragraph");
  assert.equal(paragraphAddition("a", "a\n\n   "), null, "no words after the break");
});

test("a paragraph pasted above another is said as that, naming the one it sits against", () => {
  const said = editChangeText(KIND.EDIT, EXISTING, PASTED + "\n\n" + EXISTING);
  assert.equal(said, 'Added a paragraph before "' + EXISTING + '": "' + PASTED + '".');
  assert.equal(said.indexOf('"rticle'), -1, "no quoted fragment starting mid-word");
  assert.equal(said.indexOf(' A".'), -1, "and none ending on a stray letter");
});

test("a paragraph added below is said the same way", () => {
  const added = "A second thought, written underneath.";
  assert.equal(editChangeText(KIND.EDIT, EXISTING, EXISTING + "\n\n" + added), 'Added a paragraph after "' + EXISTING + '": "' + added + '".');
});

test("the paragraph it sits against is named by its lead, whitespace folded and cut short at a space", () => {
  const long = "The trainer writes the plan every week, and the athlete reads it on a Sunday night before the first session.";
  const said = editChangeText(KIND.EDIT, long, "A new opening line.\n\n" + long);
  assert.equal(said.indexOf('Added a paragraph before "The trainer writes the plan every week, and'), 0);
  assert.equal(said.indexOf("..."), said.indexOf('": "') - 3, "the quoted lead is cut short, at a space");
  assert.ok(said.includes('"A new opening line."'), "and the new words are quoted in full");
  const spaced = editChangeText(KIND.EDIT, "One   two\n three", "New.\n\nOne   two\n three");
  assert.equal(spaced, 'Added a paragraph before "One two three": "New.".');
});

test("a lead of sixty characters or fewer is quoted whole, and a longer one is cut to sixty and back to its last space", () => {
  const sixty = "a".repeat(30) + " " + "b".repeat(29);
  assert.equal(sixty.length, 60);
  assert.equal(editChangeText(KIND.EDIT, sixty, "New.\n\n" + sixty), 'Added a paragraph before "' + sixty + '": "New.".');
  const words = ("word ".repeat(20)).trim();
  const said = editChangeText(KIND.EDIT, words, "New.\n\n" + words);
  assert.equal(said, 'Added a paragraph before "' + ("word ".repeat(12)).trim() + '...": "New.".');
  const unbroken = "x".repeat(80);
  assert.equal(editChangeText(KIND.EDIT, unbroken, "New.\n\n" + unbroken), 'Added a paragraph before "' + "x".repeat(60) + '...": "New.".');
  const early = "ab " + "c".repeat(80);
  assert.equal(editChangeText(KIND.EDIT, early, "New.\n\n" + early), 'Added a paragraph before "' + "ab " + "c".repeat(57) + '...": "New.".', "a space before the twentieth character is not a cut point");
});

test("splitting one paragraph in two is a break, not a paragraph added", () => {
  const head = "Runners come back too fast after a layoff. ";
  const tail = "Most of them know it while they are doing it.";
  assert.equal(editChangeText(KIND.EDIT, head + tail, head.trim() + "\n\n" + tail), BREAK_ADDED_PARAGRAPH);
});

test("a typed line break, a typed paragraph break and a removed break are each said in words, quoting nothing", () => {
  assert.equal(editChangeText(KIND.EDIT, "One two three", "One two\n\nthree"), BREAK_ADDED_PARAGRAPH);
  assert.equal(editChangeText(KIND.EDIT, "One two three", "One two\nthree"), BREAK_ADDED_LINE);
  assert.equal(editChangeText(KIND.EDIT, "One two\nthree", "One two three"), BREAK_REMOVED);
  assert.equal(editChangeText(KIND.EDIT, "One two\n\nthree", "One two three"), BREAK_REMOVED);
});

test("with a break sentence, the span's words are folded to single spaces before they are quoted", () => {
  assert.equal(editChangeText(KIND.EDIT, "One two three", "One 2\n\nthree"), BREAK_ADDED_PARAGRAPH + ' Changed "two" to "2".');
});

test("the words are quoted as the span has them: changed, added or removed", () => {
  assert.equal(editChangeText(KIND.EDIT, "I like dogs", "I love dogs"), 'Changed "like" to "love".');
  assert.equal(editChangeText(KIND.EDIT, "ab", "ab cd"), 'Added " cd".');
  assert.equal(editChangeText(KIND.EDIT, "ab cd", "ab"), 'Removed " cd".');
  assert.equal(editChangeText(KIND.EDIT, "The trainer writes the plan every week.", "The trainer writes the whole plan every week."), 'Added "whole ".');
  assert.equal(editChangeText(KIND.EDIT, "the plan is short", "the planned plan is short"), 'Added "planned ".');
});

test("an edit that changes nothing a person could name is edited", () => {
  assert.equal(editChangeText(KIND.EDIT, "same", "same"), "Edited this block.");
  assert.equal(editChangeText(KIND.COMMENT, null, null), "Edited this block.");
});

test("a delete and a format-only change have their own sentences whatever the words are", () => {
  assert.equal(editChangeText(KIND.DELETE, "a", null), "Deleted this block.");
  assert.equal(editChangeText(KIND.FORMAT_ONLY, "a", "a", "a", "<strong>a</strong>"), "Changed the emphasis in this block; the words are the same.");
});

test("italic the reviewer added is named", () => {
  assert.equal(formattingChangeText("a b c", "a <em>b</em> c"), 'Made "b" italic.');
  assert.equal(editChangeText(KIND.EDIT, "a b c", "a b c", "a b c", "a <em>b</em> c"), 'Made "b" italic.');
});

test("bold the reviewer added is named", () => {
  assert.equal(editChangeText(KIND.EDIT, "a b c", "a b c", "a b c", "a <strong>b c</strong>"), 'Made "b c" bold.');
});

test("bold the reviewer removed is named once, however the browser said it", () => {
  assert.equal(formattingChangeText("a <strong>b</strong> c", "a b c"), 'Removed bold from "b".');
  assert.equal(formattingChangeText("a <strong>b</strong> c", "a <not-bold>b</not-bold> c"), 'Removed bold from "b".');
  assert.equal(
    editChangeText(
      KIND.EDIT,
      "runners come back too fast",
      "runners come back too fast",
      "runners come back <strong>too fast</strong>",
      "runners come back <not-bold>too fast</not-bold>"
    ),
    'Removed bold from "too fast".'
  );
  assert.equal(formattingChangeText("a b c", "a <not-bold>b</not-bold> c"), 'Removed bold from "b".', "words a stylesheet made bold: no strong to lose");
  assert.equal(formattingChangeText("a <em>b</em> c", "a <not-italic>b</not-italic> c"), 'Removed italic from "b".');
  assert.equal(formattingChangeText("a <em>b</em> c", "a b c"), 'Removed italic from "b".');
});

test("runs are counted, so two identical runs are two and one lost run is one sentence", () => {
  assert.equal(formattingChangeText("<em>x</em> and <em>x</em>", "<em>x</em> and x"), 'Removed italic from "x".');
  assert.equal(formattingChangeText("x and x", "<em>x</em> and <em>x</em>"), 'Made "x" italic. Made "x" italic.');
  assert.equal(formattingChangeText("<em>x</em> and <em>x</em>", "<em>x</em> and <em>x</em>"), "");
});

test("a reworded edit that also changes emphasis says both, wording first", () => {
  const said = editChangeText(
    KIND.EDIT,
    "it is more functional and you can turn any page into an interface",
    "it is more functional and you can turn any HTML page into an interface",
    "it is more functional and you can turn any page into an interface",
    "it is more <em>functional</em> and <strong>you can turn any HTML page into an interface</strong>"
  );
  assert.equal(said, 'Added "HTML ". Made "functional" italic. Made "you can turn any HTML page into an interface" bold.');
});

test("an edit that changes no emphasis says nothing about emphasis", () => {
  assert.equal(
    editChangeText(KIND.EDIT, "the quick fox", "the quick brown fox", "the <em>quick</em> fox", "the <em>quick</em> brown fox"),
    'Added "brown ".'
  );
  assert.equal(formattingChangeText("the <em>quick</em> fox", "the <em>quick</em> brown fox"), "");
});

test("markup that is not bold or italic is never reported as a formatting change", () => {
  assert.equal(formattingChangeText('a <span class="x">b</span> c', '<p class="lead"><a href="https://example.com">a</a> <code>b</code> c</p>'), "");
});

test("no after markup, or none that moved, is no formatting sentence", () => {
  assert.equal(formattingChangeText("a <em>b</em>", ""), "");
  assert.equal(formattingChangeText("a <em>b</em>", null), "");
  assert.equal(formattingChangeText("a <em>b</em>", undefined), "");
  assert.equal(formattingChangeText(null, "a <em>b</em>"), 'Made "b" italic.');
  assert.equal(formattingChangeText(undefined, "plain"), "");
});

test("a paragraph added above with emphasis in it still says the emphasis", () => {
  const said = editChangeText(
    KIND.EDIT,
    EXISTING,
    "Article drop!\n\n" + EXISTING,
    EXISTING,
    "<p><strong>Article drop!</strong></p><p>" + EXISTING + "</p>"
  );
  assert.equal(said.indexOf("Added a paragraph before"), 0);
  assert.ok(said.includes('Made "Article drop!" bold.'));
  assert.ok(said.includes('": "Article drop!". Made'), "the paragraph sentence, one space, then the formatting sentence");
});

test("the sentence is the break, the words and the formatting, each present, joined by one space", () => {
  assert.equal(
    editChangeText(KIND.EDIT, "One two", "One\n\nthree", "One two", "<em>One</em>\n\nthree"),
    BREAK_ADDED_PARAGRAPH + ' Changed "two" to "three". Made "One" italic.'
  );
});
