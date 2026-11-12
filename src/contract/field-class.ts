/*
 * read-when: Adding a field that carries text, or deciding whether an agent may act on a field's words.
 */

import type { FieldName } from "./record.ts";

export const CLASS_INSTRUCTION = "instruction";
export const CLASS_DATA = "data";
export type FieldClass = typeof CLASS_INSTRUCTION | typeof CLASS_DATA;

export const INTENT_FIELDS: readonly ["note", "change"] = ["note", "change"];
export type IntentField = (typeof INTENT_FIELDS)[number];
export const INSTRUCTION_PATHS: readonly ["note", "change", "choice.group", "choice.answer"] = [
  "note",
  "change",
  "choice.group",
  "choice.answer"
];
export type InstructionPath = (typeof INSTRUCTION_PATHS)[number];

export const FIELD_CLASS: {
  readonly [Field in FieldName]: Field extends IntentField ? typeof CLASS_INSTRUCTION : typeof CLASS_DATA;
} = {
  id: CLASS_DATA,
  rev: CLASS_DATA,
  kind: CLASS_DATA,
  state: CLASS_DATA,
  note: CLASS_INSTRUCTION,
  change: CLASS_INSTRUCTION,
  before: CLASS_DATA,
  after: CLASS_DATA,
  before_html: CLASS_DATA,
  after_html: CLASS_DATA,
  after_history: CLASS_DATA,
  region: CLASS_DATA,
  context: CLASS_DATA,
  page_origin: CLASS_DATA,
  page_path: CLASS_DATA,
  page_title: CLASS_DATA,
  page_seq: CLASS_DATA,
  source_hint: CLASS_DATA,
  reverts: CLASS_DATA,
  reply: CLASS_DATA,
  handled_not_on_page: CLASS_DATA,
  closed_by: CLASS_DATA,
  closed_at: CLASS_DATA,
  received_at: CLASS_DATA,
  reply_seen: CLASS_DATA,
  thread: CLASS_DATA,
  new_blocks: CLASS_DATA,
  anchor_after_html: CLASS_DATA,
  anchor_tag_after: CLASS_DATA,
  placement: CLASS_DATA,
  remove_blocks: CLASS_DATA,
  choice: CLASS_DATA,
  created_at: CLASS_DATA,
  updated_at: CLASS_DATA
};

export function fieldClass(path: string): FieldClass {
  return INSTRUCTION_PATHS.some((instruction) => instruction === path) ? CLASS_INSTRUCTION : CLASS_DATA;
}
