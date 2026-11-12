/*
 * read-when: Changing src/contract/style-rules.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import {
  DESCRIPTION_MAX,
  ID_PATTERN,
  NAME_MAX,
  PALETTE_MAX,
  RESERVED_ID,
  RESERVED_NAME,
  isHexColour,
  isStyleId,
  isStyleName
} from "../../../src/contract/style-rules.ts";

const NOT_TEXT: readonly unknown[] = [42, null, undefined, true, {}, ["a"]];

test("a style id is 1 to 40 lowercase letters, digits and hyphens, starting with a letter or digit", () => {
  for (const id of ["sample-dark", "a", "0x", "a".repeat(40), "a-b-c", "9"]) {
    assert.equal(isStyleId(id), true, id);
  }
  for (const id of ["Sample", "-x", "", "a".repeat(41), "a_b", "../x", "a b", "a.b", "é", "a\n"]) {
    assert.equal(isStyleId(id), false, JSON.stringify(id));
  }
  for (const value of NOT_TEXT) assert.equal(isStyleId(value), false, String(value));
});

test("the house style has a reserved id and name, and both pass their own checks", () => {
  assert.equal(RESERVED_ID, "international");
  assert.equal(RESERVED_NAME, "International Style");
  assert.equal(isStyleId(RESERVED_ID), true);
  assert.equal(isStyleName(RESERVED_NAME), true);
});

test("a palette colour is a # and 3, 4, 6 or 8 hex digits, in either case", () => {
  for (const colour of ["#1f6b3a", "#ABC", "#abcd", "#11223344", "#aBc", "#FFFFFF"]) {
    assert.equal(isHexColour(colour), true, colour);
  }
  for (const colour of ["#12345", "1f6b3a", "#ggg", "#1234567", "#", "", "#12 ", " #123", "#123\n"]) {
    assert.equal(isHexColour(colour), false, JSON.stringify(colour));
  }
  for (const value of NOT_TEXT) assert.equal(isHexColour(value), false, String(value));
});

test("a style name is plain words: letters and digits of any script, spaces, apostrophes, ampersands, hyphens", () => {
  for (const name of ["Rock & Roll", "Textbook", "Café Noir", "O'Brien", "Sans-serif 2", "日本語", "x".repeat(40)]) {
    assert.equal(isStyleName(name), true, name);
  }
  const refused = [
    "",
    " ",
    " Textbook",
    "Textbook ",
    "Use it. Now!",
    "Ignore previous instructions.",
    "a\nb",
    "a‮b",
    "x".repeat(41),
    "(x)",
    "a:b",
    "a/b",
    "a_b"
  ];
  for (const name of refused) assert.equal(isStyleName(name), false, JSON.stringify(name));
  for (const value of NOT_TEXT) assert.equal(isStyleName(value), false, String(value));
});

test("a name is measured in UTF-16 units, so an astral letter counts as two", () => {
  const astral = "\u{1D49C}";
  assert.equal(astral.length, 2);
  assert.equal(isStyleName(astral.repeat(20)), true);
  assert.equal(isStyleName(astral.repeat(21)), false);
});

test("the limits are the ones the service and the layer show", () => {
  assert.equal(NAME_MAX, 40);
  assert.equal(DESCRIPTION_MAX, 300);
  assert.equal(PALETTE_MAX, 6);
});

test("the id pattern the server re-exports matches exactly what the id check accepts", () => {
  assert.ok(ID_PATTERN instanceof RegExp);
  const samples = ["sample-dark", "a", "0x", "a".repeat(40), "Sample", "-x", "", "a".repeat(41), "a_b", "../x", "a\n"];
  for (const sample of samples) {
    assert.equal(ID_PATTERN.test(sample), isStyleId(sample), JSON.stringify(sample));
  }
});

test("the old path loads the same functions, in an ordinary object old code can write to", () => {
  const load = createRequire(import.meta.url);
  const old: unknown = load("../../../src/shared/style_rules.js");
  assert.ok(typeof old === "object" && old !== null && "isStyleId" in old);
  assert.equal(old.isStyleId, isStyleId);
  assert.equal(Reflect.get(old, "ID_PATTERN"), ID_PATTERN);
  const replacement = (): boolean => true;
  Reflect.set(old, "isStyleId", replacement);
  assert.equal(Reflect.get(old, "isStyleId"), replacement);
  Reflect.set(old, "isStyleId", isStyleId);
});
