/*
 * read-when: Changing src/domain/page-check.ts, the page check's sentence, its reopen or its stamp, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { STATE, TOOL_ROUND, emptyRegion } from "../../../src/contract/record.ts";
import type { Item } from "../../../src/contract/record.ts";
import { bumpRev } from "../../../src/domain/item-revisions.ts";
import {
  LEGACY_PAGE_CHECK_NOTE,
  PAGE_CHECK_NOTES,
  PAGE_CHECK_STAMP_NOTE,
  appendNoteOnce,
  collapsePageCheckNote,
  pageCheckReopenOf,
  reviewerNote,
  stampPageCheckReopen
} from "../../../src/domain/page-check.ts";
import * as pageCheck from "../../../src/domain/page-check.ts";
import { toolRoundOf } from "../../../src/domain/tool-round.ts";
import { callUntyped } from "../contract/support/untyped.ts";
import { AT, anItem, folded } from "./support/items.ts";

test("the page check's two sentences are pinned, and its notes are those two", () => {
  assert.equal(
    PAGE_CHECK_STAMP_NOTE,
    "Reopened by the page check: the change landed but the data-lahe-id stamp did not reach the source. Write the stamp onto that element so the next build reproduces it, or reply not_handled saying why."
  );
  assert.equal(
    LEGACY_PAGE_CHECK_NOTE,
    "Reopened by the page check: this handled change is no longer on the page and the original text is back. Reapply it, or reply not_handled saying why."
  );
  assert.deepEqual(PAGE_CHECK_NOTES, [PAGE_CHECK_STAMP_NOTE, LEGACY_PAGE_CHECK_NOTE]);
});

test("the page check writes no sentence about a run: its only round is the stamp", () => {
  for (const name of ["PAGE_CHECK_TAG_NOTE", "PAGE_CHECK_RUN_NOTE", "PAGE_CHECK_TAKEBACK_NOTE"]) {
    assert.equal(Object.hasOwn(pageCheck, name), false, name);
  }
});

test("appending a sentence to a blank or missing note is the sentence, and a blank sentence changes nothing", () => {
  assert.equal(appendNoteOnce(null, "S."), "S.");
  assert.equal(appendNoteOnce(undefined, "S."), "S.");
  assert.equal(appendNoteOnce("   ", "S."), "S.");
  assert.equal(appendNoteOnce("note", ""), "note");
  assert.equal(appendNoteOnce("note", "  \n"), "note");
  assert.equal(appendNoteOnce(null, ""), null);
  assert.equal(appendNoteOnce(undefined, "  "), null);
});

test("a note that already holds the sentence comes back unchanged, and any other note gains it after a blank line", () => {
  assert.equal(appendNoteOnce("Fix this. S. And more.", "S."), "Fix this. S. And more.");
  assert.equal(appendNoteOnce("Fix this.", "S."), "Fix this.\n\nS.");
});

test("stamping a reopen writes a new region with the check's reopen, and returns it", () => {
  const item = anItem({ rev: 4, region: { ...emptyRegion(), label: "kept label", accepted_page_texts: ["a"] } });
  const held = item.region;
  const got = stampPageCheckReopen(item, "T@3", AT, TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.deepEqual(got, { rev: 4, at: AT, stamp: "T@3", tool: "page_check_stamp" });
  assert.deepEqual(item.region.check_reopen, got);
  assert.equal(item.region.label, "kept label", "every other region key is kept");
  assert.deepEqual(item.region.accepted_page_texts, ["a"]);
  assert.notEqual(item.region, held, "a new region object");
  assert.equal(held.check_reopen, null, "the region the caller held before is not changed");
});

test("a stamp that is not a string is null, a tool that is not a tool round name is null, and the time defaults to now", () => {
  const item = anItem();
  const before = Date.now();
  const got = callUntyped(stampPageCheckReopen, item, 7, undefined, "page_check_tag");
  assert.ok(typeof got === "object" && got !== null);
  assert.equal("stamp" in got && got.stamp, null);
  assert.equal("tool" in got && got.tool, null);
  assert.ok("at" in got && typeof got.at === "string" && Date.parse(got.at) >= before);
  assert.equal(stampPageCheckReopen(null, "x"), null);
  assert.equal(stampPageCheckReopen(undefined, "x"), null);
});

test("a record with no region is given an empty one to stamp", () => {
  const item = { ...anItem(), region: null };
  callUntyped(stampPageCheckReopen, item, null, AT, null);
  assert.deepEqual(item.region, { ...emptyRegion(), check_reopen: { rev: 1, at: AT, stamp: null, tool: null } });
});

test("the page check reopens a handled item with its note appended once and its reply stamped", () => {
  const answered = { ...anItem({ rev: 2, note: "Keep my words.", reply: folded({ at: "2026-08-18T12:00:00.000Z" }) }), state: STATE.HANDLED };
  const reopened = pageCheckReopenOf(answered, PAGE_CHECK_STAMP_NOTE, AT, TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(reopened.rev, 3);
  assert.equal(reopened.state, STATE.READY);
  assert.equal(reopened.reply, null);
  assert.equal(reopened.note, "Keep my words.\n\n" + PAGE_CHECK_STAMP_NOTE);
  assert.deepEqual(reopened.region.check_reopen, { rev: 3, at: AT, stamp: "2026-08-18T12:00:00.000Z@2", tool: "page_check_stamp" });
  assert.equal(toolRoundOf(reopened), "page_check_stamp", "with the stamp tool the result is a tool round");
});

test("the sentence lands in the note exactly once, however many cycles run", () => {
  let item: Item = { ...anItem({ rev: 1, note: "Keep my words.", reply: folded() }), state: STATE.HANDLED };
  for (let cycle = 0; cycle < 4; cycle += 1) {
    item = pageCheckReopenOf(item, PAGE_CHECK_STAMP_NOTE, AT, TOOL_ROUND.PAGE_CHECK_STAMP);
    item = { ...item, state: STATE.HANDLED, reply: folded() };
  }
  assert.equal(item.note?.split(PAGE_CHECK_STAMP_NOTE).length, 2, "one copy");
  assert.equal(item.rev, 5);
});

test("the agent's next handled reply ends the round, because the revision moves past the stamp", () => {
  const answered = { ...anItem({ rev: 1, reply: folded() }), state: STATE.HANDLED };
  const reopened = pageCheckReopenOf(answered, PAGE_CHECK_STAMP_NOTE, AT, TOOL_ROUND.PAGE_CHECK_STAMP);
  assert.equal(toolRoundOf(reopened), "page_check_stamp");
  assert.equal(toolRoundOf(bumpRev(reopened, { note: "reviewer reworded" })), null);
});

test("a reopen with a blank note appends nothing", () => {
  const answered = anItem({ rev: 1, note: "Mine.", reply: folded() });
  assert.equal(pageCheckReopenOf(answered, "  ", AT, null).note, "Mine.");
});

test("a note carrying a repeated sentence collapses to one copy, with the words between kept after one blank line", () => {
  const S = PAGE_CHECK_STAMP_NOTE;
  assert.equal(collapsePageCheckNote({ note: S + "\n\n" + S + "\n\n" + S }).note, S);
  assert.equal(collapsePageCheckNote({ note: "Mine.\n\n" + S + "\n\n\n\n" + S }).note, "Mine.\n\n" + S);
  assert.equal(collapsePageCheckNote({ note: S + "\n\nMy extra words.\n\n" + S }).note, S + "\n\nMy extra words.");
  const legacy = LEGACY_PAGE_CHECK_NOTE;
  assert.equal(collapsePageCheckNote({ note: legacy + "\n\n" + legacy }).note, legacy);
  assert.equal(collapsePageCheckNote({ note: S + "\n\n" + legacy + "\n\n" + S + "\n\n" + legacy }).note, S + "\n\n" + legacy);
});

test("collapsing returns the value itself when nothing repeats, when the note is not a string, and when it is not an object", () => {
  const once = { note: PAGE_CHECK_STAMP_NOTE };
  assert.equal(collapsePageCheckNote(once), once);
  const noNote = { note: null };
  assert.equal(collapsePageCheckNote(noNote), noNote);
  assert.equal(collapsePageCheckNote(null), null);
  assert.equal(collapsePageCheckNote("x"), "x");
  const array = [PAGE_CHECK_STAMP_NOTE, PAGE_CHECK_STAMP_NOTE];
  assert.equal(collapsePageCheckNote(array), array);
  const twice = { id: "i", note: PAGE_CHECK_STAMP_NOTE + " " + PAGE_CHECK_STAMP_NOTE };
  const got = collapsePageCheckNote(twice);
  assert.notEqual(got, twice, "a shallow copy");
  assert.equal(got.id, "i");
  assert.equal(twice.note, PAGE_CHECK_STAMP_NOTE + " " + PAGE_CHECK_STAMP_NOTE, "the input is not changed");
});

test("a stored note carrying an old sentence many times collapses to one copy when it is read", () => {
  const stored = anItem({ note: "x\n\n" + LEGACY_PAGE_CHECK_NOTE + "\n\n" + LEGACY_PAGE_CHECK_NOTE + "\n\n" + LEGACY_PAGE_CHECK_NOTE });
  const read = collapsePageCheckNote(stored);
  assert.equal(read.note, "x\n\n" + LEGACY_PAGE_CHECK_NOTE);
  assert.equal(read.id, stored.id);
});

test("the reviewer's note is their own words, with the stamp sentence taken back out", () => {
  assert.equal(reviewerNote({ note: "Keep my words.\n\n" + PAGE_CHECK_STAMP_NOTE }), "Keep my words.");
  assert.equal(reviewerNote({ note: PAGE_CHECK_STAMP_NOTE }), null, "nothing left");
  assert.equal(reviewerNote({ note: "A.\n\n" + PAGE_CHECK_STAMP_NOTE + "\n\n\n\nB.\n\n" + PAGE_CHECK_STAMP_NOTE }), "A.\n\nB.");
  assert.equal(reviewerNote({ note: "  plain  " }), "plain");
  assert.equal(reviewerNote({ note: "" }), null);
  assert.equal(reviewerNote({ note: null }), null);
  assert.equal(reviewerNote(null), null);
  assert.equal(reviewerNote(undefined), null);
});

test("an older check's sentence about the reviewer's own words is kept, because those rounds were the reviewer's business", () => {
  assert.equal(reviewerNote({ note: "Mine.\n\n" + LEGACY_PAGE_CHECK_NOTE }), "Mine.\n\n" + LEGACY_PAGE_CHECK_NOTE);
});
