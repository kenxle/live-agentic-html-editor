/*
 * read-when: A record is refused before it is stored, or adding a rule every stored record must meet.
 */

import { validateChoice } from "./choice.ts";
import { isJsonObject } from "./json-object.ts";
import { FIELD, KIND, KINDS, REPLY_STATUSES, STATE, STATES, isItemState, isKind } from "./record.ts";
import type { Item } from "./record.ts";

function isReplyStatus(value: unknown): boolean {
  return REPLY_STATUSES.some((status) => status === value);
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value !== "";
}

function threadProblems(thread: unknown): string[] {
  if (thread === undefined) return [];
  if (!Array.isArray(thread)) return ["thread must be an array of completed exchanges"];
  const problems: string[] = [];
  thread.forEach((round: unknown, index: number) => {
    const at = "thread[" + String(index) + "]";
    if (!isJsonObject(round)) {
      problems.push(at + " must be an object");
      return;
    }
    const rev = round["rev"];
    if (typeof rev !== "number" || rev < 1) problems.push(at + ".rev must be >= 1");
    if (!isJsonObject(round["reviewer"])) problems.push(at + ".reviewer is required");
    const agent = round["agent"];
    if (!isJsonObject(agent)) problems.push(at + ".agent is required");
    if (agent && !isReplyStatus(isJsonObject(agent) ? agent["status"] : undefined)) {
      problems.push(at + ".agent.status must be one of " + REPLY_STATUSES.join(", "));
    }
  });
  return problems;
}

function readyProblems(record: Readonly<Record<string, unknown>>): string[] {
  if (record[FIELD.STATE] === STATE.DRAFT) return [];
  const kind = record[FIELD.KIND];
  const problems: string[] = [];
  if ((kind === KIND.COMMENT || kind === KIND.NOTE) && !record[FIELD.NOTE]) {
    problems.push("a ready " + kind + " must carry the reviewer's note");
  }
  if (kind === KIND.EDIT && typeof record[FIELD.AFTER] !== "string") problems.push("a ready edit must carry after text");
  return problems;
}

export function validateItem(value: unknown): asserts value is Item {
  if (!isJsonObject(value)) throw new TypeError("validateItem expects an object, got " + typeof value);
  const problems: string[] = [];
  const rev = value[FIELD.REV];
  if (!isNonEmptyString(value[FIELD.ID])) problems.push("id must be a non-empty string");
  if (typeof rev !== "number" || rev < 1) problems.push("rev must be a number >= 1");
  if (!isKind(value[FIELD.KIND])) problems.push("kind must be one of " + KINDS.join(", "));
  if (!isItemState(value[FIELD.STATE])) problems.push("state must be one of " + STATES.join(", "));
  if (!isNonEmptyString(value[FIELD.PAGE_ORIGIN])) problems.push("page_origin must be a non-empty string");
  if (!isNonEmptyString(value[FIELD.PAGE_PATH])) problems.push("page_path must be a non-empty string");
  if (!Array.isArray(value[FIELD.AFTER_HISTORY])) problems.push("after_history must be an array; replay's branch three reads it");
  problems.push(...threadProblems(value[FIELD.THREAD]));
  problems.push(...readyProblems(value));
  const reply = value[FIELD.REPLY];
  if (reply && !isReplyStatus(isJsonObject(reply) ? reply["status"] : undefined)) {
    problems.push("reply.status must be one of " + REPLY_STATUSES.join(", "));
  }
  const choice = validateChoice(value);
  if (choice !== null) problems.push(choice.reason);
  if (problems.length > 0) throw new Error("invalid item " + String(value[FIELD.ID]) + ": " + problems.join("; "));
}
