/*
 * read-when: Changing src/contract/field-class.ts, which fields are the reviewer's instruction and which are page data, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CLASS_DATA,
  CLASS_INSTRUCTION,
  FIELD_CLASS,
  INSTRUCTION_PATHS,
  INTENT_FIELDS,
  fieldClass
} from "../../../src/contract/field-class.ts";
import { FIELD } from "../../../src/contract/record.ts";

const INSTRUCTION = ["note", "change", "choice.group", "choice.answer"];

const OLD_DATA_PATHS = [
  "before",
  "after",
  "before_html",
  "after_html",
  "after_history",
  "context.quote",
  "context.prefix",
  "context.suffix",
  "context.heading",
  "context.element",
  "context.subject",
  "context.slide",
  "region.label",
  "region.accepted_page_texts",
  "region.check_reopen",
  "closed_by",
  "closed_at",
  "received_at",
  "reply_seen",
  "page_title",
  "page_path",
  "reply.reason",
  "reply.text",
  "thread[].reviewer.note",
  "thread[].reviewer.change",
  "thread[].agent.reason",
  "thread[].agent.text",
  "new_blocks",
  "anchor_after_html",
  "anchor_tag_after",
  "placement",
  "remove_blocks"
];

test("the two classes are instruction and data", () => {
  assert.equal(CLASS_INSTRUCTION, "instruction");
  assert.equal(CLASS_DATA, "data");
});

test("the intent channel is exactly note and change, and a choice's group and answer are instruction too", () => {
  assert.deepEqual(INTENT_FIELDS, ["note", "change"]);
  assert.deepEqual(INSTRUCTION_PATHS, INSTRUCTION);
});

test("only the four instruction paths are instruction, and every other path is data", () => {
  for (const path of INSTRUCTION) assert.equal(fieldClass(path), CLASS_INSTRUCTION, path);
  for (const path of OLD_DATA_PATHS) assert.equal(fieldClass(path), CLASS_DATA, path);
  for (const path of ["choice", "waiting_since", "", "toString", "__proto__", "something_new"]) {
    assert.equal(fieldClass(path), CLASS_DATA, JSON.stringify(path));
  }
});

test("an earlier turn's words are data: only the current note and change are intent", () => {
  assert.equal(fieldClass("thread[].reviewer.note"), CLASS_DATA);
  assert.equal(fieldClass("thread[].reviewer.change"), CLASS_DATA);
  assert.equal(fieldClass("reply.text"), CLASS_DATA, "an agent's words are not the reviewer's intent");
  assert.equal(fieldClass("after"), CLASS_DATA, "a region's full after is the page's own words");
});

test("the new free-writing fields are data", () => {
  for (const field of ["new_blocks", "anchor_after_html", "anchor_tag_after", "placement", "remove_blocks"]) {
    assert.equal(fieldClass(field), CLASS_DATA, field);
  }
});

test("FIELD_CLASS has one entry for every field, note and change are instruction and the other thirty-two are data", () => {
  assert.deepEqual(Object.keys(FIELD_CLASS).sort(), Object.values(FIELD).sort());
  for (const [field, kind] of Object.entries(FIELD_CLASS)) {
    assert.equal(kind, field === "note" || field === "change" ? CLASS_INSTRUCTION : CLASS_DATA, field);
  }
  assert.equal(Object.values(FIELD_CLASS).filter((kind) => kind === CLASS_DATA).length, 32);
});

test("FIELD_CLASS agrees with fieldClass for every field", () => {
  for (const field of Object.values(FIELD)) assert.equal(FIELD_CLASS[field], fieldClass(field), field);
});
