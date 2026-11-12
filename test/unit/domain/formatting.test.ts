/*
 * read-when: Changing src/domain/formatting.ts, or when one of these tests fails.
 * not-for: How a reset marker is written into cleaned markup; see clean-markup.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  NOT_BOLD_TAG,
  NOT_ITALIC_TAG,
  RESET_TAGS,
  STRUCTURAL_TAGS,
  isNotBoldWeight,
  isNotItalicStyle,
  isStructuralTag,
  resetTagsForStyle
} from "../../../src/domain/formatting.ts";

test("the reset markers carry the tag names an agent reads in a record", () => {
  assert.equal(NOT_BOLD_TAG, "not-bold");
  assert.equal(NOT_ITALIC_TAG, "not-italic");
  assert.deepEqual(RESET_TAGS, { bold: "not-bold", italic: "not-italic" });
});

test("formatting is a closed list of four structural tags, in this order", () => {
  assert.deepEqual([...STRUCTURAL_TAGS], ["em", "strong", "not-bold", "not-italic"]);
  for (const name of STRUCTURAL_TAGS) assert.equal(isStructuralTag(name), true, name);
  for (const name of ["b", "i", "span", "EM", "constructor", ""]) assert.equal(isStructuralTag(name), false, name);
});

test("a font weight counts as not bold when it is normal, lighter, or 500 and under", () => {
  for (const value of ["normal", "Normal", " 300 ", "lighter", "100", "200", "300", "400", "500"]) {
    assert.equal(isNotBoldWeight(value), true, value);
  }
  for (const value of ["600", "700", "bold", "bolder", "", "inherit", "constructor"]) {
    assert.equal(isNotBoldWeight(value), false, value);
  }
});

test("a font style counts as not italic only when it is normal", () => {
  assert.equal(isNotItalicStyle("normal"), true);
  assert.equal(isNotItalicStyle(" NORMAL "), true);
  for (const value of ["italic", "oblique", "", "inherit"]) assert.equal(isNotItalicStyle(value), false, value);
});

test("a style says which markers it needs, outermost first", () => {
  assert.deepEqual(resetTagsForStyle("font-weight: normal;"), ["not-bold"]);
  assert.deepEqual(resetTagsForStyle("font-style: normal"), ["not-italic"]);
  assert.deepEqual(resetTagsForStyle("font-style:normal;font-weight:normal"), ["not-bold", "not-italic"]);
  assert.deepEqual(resetTagsForStyle("FONT-WEIGHT : 400"), ["not-bold"]);
  assert.deepEqual(resetTagsForStyle("font-weight:700; font-style: italic"), []);
  assert.deepEqual(resetTagsForStyle("color:red"), []);
  assert.deepEqual(resetTagsForStyle(""), []);
});

test("the last declaration of a property in a style wins", () => {
  assert.deepEqual(resetTagsForStyle("font-weight:bold;font-weight:normal"), ["not-bold"]);
  assert.deepEqual(resetTagsForStyle("font-weight:normal;font-weight:bold"), []);
});
