/*
 * read-when: Changing src/domain/text.ts, or when one of these tests fails.
 * not-for: How markup is cleaned or read for text; see clean-markup.test.ts and block-text.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LINE_BREAK,
  PARAGRAPH_BREAK,
  cleanCharacters,
  collapseSpaces,
  firstWords,
  foldTypography,
  normalizeBlockText,
  normalizeText
} from "../../../src/domain/text.ts";

test("normalizeText folds every whitespace run to one space and trims both ends", () => {
  assert.equal(normalizeText("  The trainer\n\twrites   the plan.  "), "The trainer writes the plan.");
  assert.equal(normalizeText("a\r\nb"), "a b");
});

test("normalizeText folds each listed Unicode space, the hair space included", () => {
  for (const space of [" ", " ", " ", "　", " ", " ", " ", " ", " ", " "]) {
    assert.equal(normalizeText("a" + space + "b"), "a b", "U+" + (space.codePointAt(0) ?? 0).toString(16));
  }
  assert.equal(normalizeText(" 　a "), "a");
});

test("normalizeText makes rewrapping and reindenting invisible", () => {
  const oneLine = "The trainer writes the plan for the week.";
  const rewrapped = "The trainer writes\n    the plan for\n\tthe week.";
  assert.equal(normalizeText(rewrapped), normalizeText(oneLine));
});

test("normalizeText removes the zero width space, the byte order mark and the soft hyphen, and keeps the joiners", () => {
  assert.equal(normalizeText("a​b"), "ab");
  assert.equal(normalizeText("﻿abc"), "abc");
  assert.equal(normalizeText("co­op"), "coop");
  assert.equal(normalizeText("a‍b"), "a‍b");
  assert.equal(normalizeText("a‌b"), "a‌b");
});

test("normalizeText removes control characters instead of turning them into spaces", () => {
  assert.equal(normalizeText("a\u0007bc"), "abc");
  assert.equal(normalizeText("a\u000Bb"), "ab");
  assert.equal(normalizeText("a\u000Cb"), "ab");
  assert.equal(normalizeText("a\u0000b\u007Fc\u0085d\u009Fe"), "abcde");
  assert.equal(normalizeText("a\tb\nc"), "a b c");
});

test("normalizeText composes to NFC so two spellings of one accented word match", () => {
  assert.equal(normalizeText("café"), normalizeText("café"));
  assert.equal(normalizeText("café"), "café");
});

test("normalizeText keeps letter case and typography", () => {
  assert.notEqual(normalizeText("Fix"), normalizeText("fix"));
  assert.notEqual(normalizeText("don’t"), normalizeText("don't"));
});

test("normalizeText is idempotent", () => {
  for (const sample of ["  a  b  ", "a\n\nb", "café", "one two"]) {
    assert.equal(normalizeText(normalizeText(sample)), normalizeText(sample));
  }
});

test("normalizeText throws a TypeError on a value that is not a string, rather than stringifying it", () => {
  for (const bad of [undefined, null, 42]) {
    assert.throws(() => {
      Reflect.apply(normalizeText, undefined, [bad]);
    }, TypeError);
  }
});

test("normalizeBlockText folds whitespace like normalizeText and keeps a break", () => {
  assert.equal(normalizeBlockText("  Hello   world.  "), "Hello world.");
  assert.equal(normalizeBlockText("Hello \n\n\n\n world."), "Hello\n\nworld.");
  assert.equal(normalizeBlockText("Hello\r\nworld."), "Hello\nworld.");
  assert.equal(normalizeBlockText("Hello\rworld."), "Hello\nworld.");
  assert.equal(normalizeBlockText("Hello\nworld."), "Hello\nworld.");
});

test("normalizeBlockText drops a space or tab beside a break and folds every other space to a space", () => {
  assert.equal(normalizeBlockText("a\t\n\tb"), "a\nb");
  assert.equal(normalizeBlockText("a b c"), "a b c");
  assert.equal(normalizeBlockText("a \nb"), "a\nb");
  assert.equal(normalizeBlockText("a​b\u0007c­d"), "abcd");
  assert.equal(normalizeBlockText("café"), normalizeBlockText("café"));
});

test("normalizeBlockText is idempotent, and normalizeText still folds a break away", () => {
  for (const sample of ["  a \n\n\n b ", "a\r\nb", "Hello\n\nworld."]) {
    assert.equal(normalizeBlockText(normalizeBlockText(sample)), normalizeBlockText(sample));
  }
  assert.equal(normalizeText("Hello\n\nworld."), "Hello world.");
});

test("foldTypography sits on top of normalizeText and folds quotes, dashes and the ellipsis", () => {
  assert.equal(foldTypography("don’t “stop” — now…"), "don't \"stop\" - now...");
  assert.equal(foldTypography("‘a’ ‚b‛ ′ „x‟ ″"), "'a' 'b' ' \"x\" \"");
  assert.equal(foldTypography("a‐b‑c‒d–e―f−g"), "a-b-c-d-e-f-g");
  assert.equal(foldTypography("  a   b "), "a b");
});

test("foldTypography folds a run of hyphens to one, so a typed double hyphen matches a rendered dash", () => {
  assert.equal(foldTypography("then -- left"), "then - left");
  assert.equal(foldTypography("then---left"), "then-left");
  assert.equal(foldTypography("then -- left"), foldTypography("then — left"));
  assert.equal(foldTypography("re-asking"), "re-asking");
});

test("firstWords cuts to the word limit and adds the suffix only when it cut", () => {
  assert.equal(firstWords("  one   two three four  ", 3), "one two three");
  assert.equal(firstWords("one two three four", 3, "..."), "one two three...");
  assert.equal(firstWords("one two", 3, "..."), "one two");
  assert.equal(firstWords("one two three", 3, "..."), "one two three");
});

test("firstWords answers an absent or empty text with an empty string", () => {
  assert.equal(firstWords(null, 3, "..."), "");
  assert.equal(firstWords(undefined, 3, "..."), "");
  assert.equal(firstWords("", 3, "..."), "");
});

test("the two break strings are a line break and a blank line", () => {
  assert.equal(LINE_BREAK, "\n");
  assert.equal(PARAGRAPH_BREAK, "\n\n");
});

test("cleanCharacters composes, drops invisibles and controls, and keeps whitespace as it is", () => {
  assert.equal(cleanCharacters("café​\u0007 \t\nx"), "café \t\nx");
});

test("collapseSpaces turns every run of whitespace or Unicode space into one space without trimming", () => {
  assert.equal(collapseSpaces("  a \t\n b  c  "), " a b c ");
});
