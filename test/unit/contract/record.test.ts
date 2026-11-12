/*
 * read-when: Changing src/contract/record.ts, the record's field names, kinds, states and stored shapes, or when one of these tests fails.
 * not-for: The rules that read a record; see test/unit/domain/.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { FIELD_CLASS } from "../../../src/contract/field-class.ts";
import {
  CLOSED_BY_REVIEWER,
  FIELD,
  FILE_ORIGIN,
  KIND,
  KINDS,
  PLACEMENT,
  PLACEMENTS,
  REPLY_STAMP_MAX,
  REPLY_STATUS,
  REPLY_STATUSES,
  RUN_FIELDS,
  STATE,
  STATES,
  SUBJECT_SRC_REF,
  TOOL_ROUND,
  emptyContext,
  emptyRegion,
  emptySlideContext,
  hasRunFields,
  isChoice,
  isHandEdit,
  isItemState,
  isKind,
  isPlacement,
  isRevert,
  isRunRecord,
  isToolRoundName
} from "../../../src/contract/record.ts";
import type { FieldName, Item } from "../../../src/contract/record.ts";
import * as replies from "../../../src/contract/replies.ts";
import { newItem } from "../../../src/domain/item-revisions.ts";
import { PAGE } from "../domain/support/items.ts";
import { label } from "./support/untyped.ts";

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const itemKeysAreTheFieldNames: Same<keyof Item, FieldName> = true;
const classKeysAreTheFieldNames: Same<keyof typeof FIELD_CLASS, FieldName> = true;

test("FIELD names exactly these thirty-four fields, spelled as the wire spells them", () => {
  assert.deepEqual(FIELD, {
    ID: "id",
    REV: "rev",
    KIND: "kind",
    STATE: "state",
    NOTE: "note",
    CHANGE: "change",
    BEFORE: "before",
    AFTER: "after",
    BEFORE_HTML: "before_html",
    AFTER_HTML: "after_html",
    AFTER_HISTORY: "after_history",
    REGION: "region",
    CONTEXT: "context",
    PAGE_ORIGIN: "page_origin",
    PAGE_PATH: "page_path",
    PAGE_TITLE: "page_title",
    PAGE_SEQ: "page_seq",
    SOURCE_HINT: "source_hint",
    REVERTS: "reverts",
    REPLY: "reply",
    HANDLED_NOT_ON_PAGE: "handled_not_on_page",
    CLOSED_BY: "closed_by",
    CLOSED_AT: "closed_at",
    RECEIVED_AT: "received_at",
    REPLY_SEEN: "reply_seen",
    THREAD: "thread",
    NEW_BLOCKS: "new_blocks",
    ANCHOR_AFTER_HTML: "anchor_after_html",
    ANCHOR_TAG_AFTER: "anchor_tag_after",
    PLACEMENT: "placement",
    REMOVE_BLOCKS: "remove_blocks",
    CHOICE: "choice",
    CREATED_AT: "created_at",
    UPDATED_AT: "updated_at"
  });
  assert.equal(Object.keys(FIELD).length, 34);
});

test("the record's keys and the field classes' keys are exactly the FIELD values, checked by the compiler", () => {
  assert.equal(itemKeysAreTheFieldNames, true);
  assert.equal(classKeysAreTheFieldNames, true);
  assert.deepEqual(Object.keys(FIELD_CLASS).sort(), Object.values(FIELD).sort());
});

test("the kinds are exactly D4's closed list, in the order the error messages print them", () => {
  assert.deepEqual(KIND, {
    COMMENT: "comment",
    EDIT: "edit",
    DELETE: "delete",
    FORMAT_ONLY: "format_only",
    NOTE: "note",
    CHOICE: "choice"
  });
  assert.deepEqual(KINDS, ["comment", "edit", "delete", "format_only", "note", "choice"]);
});

test("isKind is true for the six kinds and for nothing else", () => {
  for (const kind of KINDS) assert.equal(isKind(kind), true, kind);
  for (const value of ["moved", "resized", "toString", "", null, 3, undefined, {}]) {
    assert.equal(isKind(value), false, label(value));
  }
});

test("the dead send model's fields and kinds are gone", () => {
  const item = newItem({ kind: KIND.EDIT, ...PAGE });
  for (const field of ["moved", "resized", "delivered", "ack", "verification", "feedback"]) {
    assert.equal(Object.hasOwn(item, field), false, field + " should be gone");
  }
  assert.equal(KINDS.map(String).includes("moved"), false);
  assert.equal(isKind("resized"), false);
});

test("there are exactly four states, and question and reopened are not among them", () => {
  assert.deepEqual(STATE, { DRAFT: "draft", READY: "ready", HANDLED: "handled", NOT_HANDLED: "not_handled" });
  assert.deepEqual(STATES, ["draft", "ready", "handled", "not_handled"]);
  assert.equal(isItemState("ready"), true);
  assert.equal(isItemState("question"), false, "a question is a reply status");
  assert.equal(isItemState("reopened"), false, "reopening is a transition");
  assert.equal(isItemState(undefined), false);
});

test("the reply statuses read through the record are the objects replies.ts exports", () => {
  assert.ok(REPLY_STATUS === replies.REPLY_STATUS);
  assert.ok(REPLY_STATUSES === replies.REPLY_STATUSES);
  assert.deepEqual([...REPLY_STATUSES].sort(), ["handled", "not_handled", "question"]);
  assert.equal(REPLY_STATUS.QUESTION, "question");
});

test("the pinned constants keep their spelling", () => {
  assert.equal(FILE_ORIGIN, "file");
  assert.equal(CLOSED_BY_REVIEWER, "reviewer");
  assert.equal(SUBJECT_SRC_REF, "lahe:subject.src");
  assert.equal(REPLY_STAMP_MAX, 64);
  assert.deepEqual(TOOL_ROUND, { PAGE_CHECK_STAMP: "page_check_stamp" });
  assert.equal(isToolRoundName("page_check_stamp"), true);
  for (const value of ["", "page_check_tag", "toString", null, 5]) assert.equal(isToolRoundName(value), false, String(value));
});

test("a region starts with these keys, in this order, and two regions share nothing", () => {
  const region = emptyRegion();
  assert.deepEqual(region, { ref: null, label: null, lost: null, accepted_page_texts: [], check_reopen: null });
  assert.deepEqual(Object.keys(region), ["ref", "label", "lost", "accepted_page_texts", "check_reopen"]);
  const other = emptyRegion();
  assert.notEqual(region, other);
  assert.notEqual(region.accepted_page_texts, other.accepted_page_texts);
});

test("a context and a slide context start empty, and each call returns a new object", () => {
  assert.deepEqual(emptyContext(), { quote: null, prefix: null, suffix: null, heading: null, element: null, subject: null });
  assert.deepEqual(emptySlideContext(), { index: null, total: null, uncounted: false, id: null, heading: null, text: null });
  assert.notEqual(emptyContext(), emptyContext());
  assert.notEqual(emptySlideContext(), emptySlideContext());
});

test("a record's new region carries its lost-anchor state as a named field", () => {
  const item = newItem({ kind: KIND.EDIT, ...PAGE });
  assert.deepEqual(Object.keys(item.region).sort(), ["accepted_page_texts", "check_reopen", "label", "lost", "ref"]);
});

test("a hand edit is an edit, a delete or a format-only change and nothing else", () => {
  assert.equal(isHandEdit({ kind: KIND.EDIT }), true);
  assert.equal(isHandEdit({ kind: KIND.DELETE }), true);
  assert.equal(isHandEdit({ kind: KIND.FORMAT_ONLY }), true);
  for (const kind of [KIND.COMMENT, KIND.NOTE, KIND.CHOICE]) assert.equal(isHandEdit({ kind }), false, kind);
  assert.equal(isHandEdit(null), false);
  assert.equal(isHandEdit(undefined), false);
});

test("a choice is a choice record, and a revert is a record naming what it takes back", () => {
  assert.equal(isChoice({ kind: KIND.CHOICE }), true);
  assert.equal(isChoice({ kind: KIND.COMMENT }), false);
  assert.equal(isChoice(null), false);
  assert.equal(isRevert({ reverts: "itm_1" }), true);
  assert.equal(isRevert({ reverts: "" }), false);
  assert.equal(isRevert({ reverts: null }), false);
  assert.equal(isRevert(null), false);
});

test("the placements are after the anchor or at the start of the container", () => {
  assert.deepEqual(PLACEMENT, { AFTER_ANCHOR: "after_anchor", START_OF_CONTAINER: "start_of_container" });
  assert.deepEqual(PLACEMENTS, ["after_anchor", "start_of_container"]);
  assert.equal(isPlacement("after_anchor"), true);
  assert.equal(isPlacement("start_of_container"), true);
  for (const value of ["", "before_anchor", "toString", null, undefined]) assert.equal(isPlacement(value), false, String(value));
});

test("the run fields are these five, in this order", () => {
  assert.deepEqual(RUN_FIELDS, ["new_blocks", "anchor_after_html", "anchor_tag_after", "placement", "remove_blocks"]);
});

test("a run record carries a non-empty new_blocks, and nothing else is one", () => {
  const block = { tag: "p", html: "x" };
  assert.equal(isRunRecord({ new_blocks: [block] }), true);
  assert.equal(isRunRecord({ new_blocks: [] }), false);
  assert.equal(isRunRecord({}), false);
  assert.equal(isRunRecord(null), false);
});

test("a record has run fields when any is present and neither null nor an empty list", () => {
  const block = { tag: "p", html: "x" };
  assert.equal(hasRunFields({ new_blocks: [block] }), true);
  assert.equal(hasRunFields({ remove_blocks: [block] }), true);
  assert.equal(hasRunFields({ anchor_tag_after: "h2" }), true, "a tag-only change counts");
  assert.equal(hasRunFields({ placement: "after_anchor" }), true, "a bare placement counts");
  assert.equal(hasRunFields({ anchor_after_html: "x" }), true);
  assert.equal(hasRunFields({ new_blocks: [] }), false);
  assert.equal(hasRunFields({ new_blocks: [], remove_blocks: [], anchor_tag_after: null }), false);
  assert.equal(hasRunFields({}), false);
  assert.equal(hasRunFields(null), false);
  assert.equal(hasRunFields(undefined), false);
});
