/*
 * read-when: Changing src/domain/accepted-page-texts.ts, or a collision the reviewer already answered with Keep mine comes back, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { emptyRegion } from "../../../src/contract/record.ts";
import { ACCEPTED_PAGE_TEXTS_MAX, acceptPageText, acceptedPageTexts } from "../../../src/domain/accepted-page-texts.ts";
import { callUntyped } from "../contract/support/untyped.ts";
import { anItem } from "./support/items.ts";

test("the bound on what Keep mine remembers is eight", () => {
  assert.equal(ACCEPTED_PAGE_TEXTS_MAX, 8);
});

test("a new record has accepted nothing, and neither has a missing one", () => {
  assert.deepEqual(acceptedPageTexts(anItem()), []);
  assert.deepEqual(acceptedPageTexts(null), []);
  assert.deepEqual(acceptedPageTexts(undefined), []);
  assert.deepEqual(callUntyped(acceptedPageTexts, { region: { accepted_page_texts: "x" } }), []);
  assert.deepEqual(callUntyped(acceptedPageTexts, { region: null }), []);
});

test("an accepted page state is remembered, add-only and deduped", () => {
  const item = anItem();
  assert.deepEqual(acceptPageText(item, "the page said this"), ["the page said this"]);
  assert.deepEqual(acceptPageText(item, "the page said this"), ["the page said this"], "the same state is not doubled");
  assert.deepEqual(item.region.accepted_page_texts, ["the page said this"]);
  assert.deepEqual(acceptPageText(item, "and then it said this"), ["the page said this", "and then it said this"]);
  assert.deepEqual(item.region.accepted_page_texts, ["the page said this", "and then it said this"]);
  assert.deepEqual(acceptedPageTexts(item), item.region.accepted_page_texts);
});

test("the newest states are the ones kept, up to the bound", () => {
  const item = anItem();
  for (let i = 0; i < ACCEPTED_PAGE_TEXTS_MAX + 5; i += 1) acceptPageText(item, "churn " + String(i));
  assert.equal(item.region.accepted_page_texts.length, ACCEPTED_PAGE_TEXTS_MAX);
  assert.equal(item.region.accepted_page_texts[0], "churn 5");
  assert.equal(item.region.accepted_page_texts[ACCEPTED_PAGE_TEXTS_MAX - 1], "churn " + String(ACCEPTED_PAGE_TEXTS_MAX + 4));
});

test("accepting writes a new region with the new list, every other region key kept, and leaves the region the caller held alone", () => {
  const item = anItem({ region: { ...emptyRegion(), label: "kept", ref: { kind: "choice", group: "g" } } });
  const held = item.region;
  acceptPageText(item, "x");
  assert.notEqual(item.region, held);
  assert.equal(item.region.label, "kept");
  assert.deepEqual(item.region.ref, { kind: "choice", group: "g" });
  assert.deepEqual(held.accepted_page_texts, [], "the region held before is not changed");
});

test("a record with no region is given an empty one to remember into", () => {
  const item = { ...anItem(), region: null };
  assert.deepEqual(callUntyped(acceptPageText, item, "x"), ["x"]);
  assert.deepEqual(item.region, { ...emptyRegion(), accepted_page_texts: ["x"] });
});

test("a blank or non-string text, or a missing record, changes nothing and returns the current list", () => {
  const item = anItem();
  acceptPageText(item, "kept");
  const region = item.region;
  assert.deepEqual(acceptPageText(item, ""), ["kept"]);
  assert.deepEqual(callUntyped(acceptPageText, item, 5), ["kept"]);
  assert.deepEqual(callUntyped(acceptPageText, item, null), ["kept"]);
  assert.equal(item.region, region, "the region is the same object");
  assert.deepEqual(acceptPageText(null, "x"), []);
  assert.deepEqual(acceptPageText(undefined, "x"), []);
});

test("the diff base is never touched", () => {
  const item = anItem({ before: "the agent's diff base" });
  acceptPageText(item, "x");
  assert.equal(item.before, "the agent's diff base");
});
