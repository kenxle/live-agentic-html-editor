/*
 * read-when: Changing the reply line an agent writes, how reply files are found or polled, or a limit on a proofread's fixes.
 */

import { isJsonObject } from "./json-object.ts";
import { SAFE_ID, isSafeId } from "./safe-id.ts";
import type { SafeId } from "./safe-id.ts";

export const REPLY_FIELD = {
  ITEM: "item",
  REV: "rev",
  STATUS: "status",
  AGENT: "agent",
  REASON: "reason",
  TEXT: "text",
  FILES: "files",
  NEEDS_SEE: "user_needs_to_see_reply",
  PROOFREAD: "proofread",
  SUGGESTIONS: "suggestions"
} as const;

export const REPLY_STATUS = { HANDLED: "handled", NOT_HANDLED: "not_handled", QUESTION: "question" } as const;
export type ReplyStatus = (typeof REPLY_STATUS)[keyof typeof REPLY_STATUS];
export const REPLY_STATUSES: readonly ReplyStatus[] = Object.values(REPLY_STATUS);

export const SUGGESTIONS_MAX = 400;
export const SUGGESTION_TEXT_MAX = 200000;

export interface Suggestion {
  readonly block: number;
  readonly from: string;
  readonly to: string;
}

interface ReplyCommon {
  readonly item: string;
  readonly rev: number;
  readonly agent: string | null;
  readonly reason: string | null;
  readonly text: string | null;
  readonly files: readonly unknown[];
  readonly user_needs_to_see_reply: boolean;
}
type NoProofread = { readonly proofread?: never; readonly suggestions?: never };
type Proofread = { readonly proofread: true; readonly suggestions: readonly Suggestion[] };

export type Reply =
  | (ReplyCommon & NoProofread & { readonly status: "handled" })
  | (ReplyCommon & NoProofread & { readonly status: "not_handled"; readonly reason: string })
  | (ReplyCommon & (NoProofread | Proofread) & { readonly status: "question"; readonly text: string });

export type ReplyParse =
  | { readonly ok: true; readonly reply: Reply; readonly reason: null }
  | { readonly ok: false; readonly code: "REPLY_LINE_MALFORMED"; readonly reason: string };

export interface ReplyParseOptions {
  readonly filenameAgent?: string | null;
}

type SuggestionsParse =
  | { readonly ok: true; readonly suggestions: readonly Suggestion[] }
  | { readonly ok: false; readonly reason: string };

type RequiredField = typeof REPLY_FIELD.ITEM | typeof REPLY_FIELD.REV | typeof REPLY_FIELD.STATUS | typeof REPLY_FIELD.REASON | typeof REPLY_FIELD.TEXT;

const REQUIRED: { readonly [Status in ReplyStatus]: readonly RequiredField[] } = {
  handled: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS],
  not_handled: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS, REPLY_FIELD.REASON],
  question: [REPLY_FIELD.ITEM, REPLY_FIELD.REV, REPLY_FIELD.STATUS, REPLY_FIELD.TEXT]
};

function malformed(reason: string): ReplyParse {
  return { ok: false, code: "REPLY_LINE_MALFORMED", reason };
}

function isReplyStatus(value: unknown): value is ReplyStatus {
  return typeof value === "string" && REPLY_STATUSES.some((status) => status === value);
}

function nonBlankText(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function parseSuggestions(list: unknown): SuggestionsParse {
  if (!Array.isArray(list)) return { ok: false, reason: "suggestions must be a list" };
  if (list.length > SUGGESTIONS_MAX) {
    return { ok: false, reason: "suggestions holds " + String(list.length) + " fixes, more than " + String(SUGGESTIONS_MAX) };
  }
  const suggestions: Suggestion[] = [];
  for (const [index, entry] of list.entries()) {
    const candidate: unknown = entry;
    const label = "suggestion " + String(index);
    if (!isJsonObject(candidate)) return { ok: false, reason: label + " must be an object" };
    const { block, from, to } = candidate;
    if (typeof block !== "number" || !Number.isInteger(block) || block < 0) {
      return { ok: false, reason: label + " block must be a whole number from 0" };
    }
    if (typeof from !== "string" || from === "") return { ok: false, reason: label + " from must be a non-empty string" };
    if (typeof to !== "string") return { ok: false, reason: label + " to must be a string" };
    if (from.length > SUGGESTION_TEXT_MAX || to.length > SUGGESTION_TEXT_MAX) {
      return { ok: false, reason: label + " from or to is over " + String(SUGGESTION_TEXT_MAX) + " characters" };
    }
    suggestions.push({ block, from, to });
  }
  return { ok: true, suggestions };
}

export function parseReplyLine(line: string, options?: ReplyParseOptions): ReplyParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return malformed("not JSON: " + (error instanceof Error ? error.message : String(error)));
  }
  if (!isJsonObject(parsed)) return malformed("a reply line must be a JSON object");

  const status = parsed[REPLY_FIELD.STATUS];
  if (!isReplyStatus(status)) {
    return malformed("status must be one of " + REPLY_STATUSES.join(", ") + ", got " + JSON.stringify(status));
  }

  const item = nonBlankText(parsed[REPLY_FIELD.ITEM]);
  const givenRev = parsed[REPLY_FIELD.REV];
  const rev = typeof givenRev === "number" ? givenRev : null;
  const givenReason = parsed[REPLY_FIELD.REASON];
  const givenText = parsed[REPLY_FIELD.TEXT];
  const reason = nonBlankText(givenReason);
  const text = nonBlankText(givenText);
  const found: { readonly [Field in RequiredField]: unknown } = { item, rev, status, reason, text };
  const missing = REQUIRED[status].filter((field) => found[field] === null);
  const incomplete = (): ReplyParse =>
    malformed("status " + status + " needs " + REQUIRED[status].join(", ") + "; missing or wrong type: " + missing.join(", "));
  if (missing.length > 0 || item === null || rev === null) return incomplete();

  const marksProofread = parsed[REPLY_FIELD.PROOFREAD] !== undefined || parsed[REPLY_FIELD.SUGGESTIONS] !== undefined;
  let proofread: readonly Suggestion[] | null = null;
  if (marksProofread) {
    if (status !== REPLY_STATUS.QUESTION) return malformed("proofread and suggestions belong on a question reply only");
    if (parsed[REPLY_FIELD.PROOFREAD] !== true) return malformed("proofread must be true when suggestions are given");
    const given = parsed[REPLY_FIELD.SUGGESTIONS];
    const checked = parseSuggestions(given === undefined ? [] : given);
    if (!checked.ok) return malformed(checked.reason);
    proofread = checked.suggestions;
  }

  const lineAgent = parsed[REPLY_FIELD.AGENT];
  const filenameAgent = options?.filenameAgent;
  const agent = typeof lineAgent === "string" && lineAgent !== "" ? lineAgent : filenameAgent === undefined || filenameAgent === "" ? null : filenameAgent;
  const files: unknown = parsed[REPLY_FIELD.FILES];
  const common: ReplyCommon = {
    item,
    rev,
    agent,
    reason: typeof givenReason === "string" ? givenReason : null,
    text: typeof givenText === "string" ? givenText : null,
    files: Array.isArray(files) ? files.slice() : [],
    user_needs_to_see_reply: parsed[REPLY_FIELD.NEEDS_SEE] === true
  };
  switch (status) {
    case "handled":
      return { ok: true, reply: { ...common, status: "handled" }, reason: null };
    case "not_handled":
      return reason === null ? incomplete() : { ok: true, reply: { ...common, status: "not_handled", reason }, reason: null };
    case "question":
      if (text === null) return incomplete();
      return {
        ok: true,
        reply:
          proofread === null
            ? { ...common, status: "question", text }
            : { ...common, status: "question", text, proofread: true, suggestions: proofread },
        reason: null
      };
  }
}

export const REPLY_FILE: {
  readonly SINGLE: "replies.jsonl";
  readonly PATTERN: RegExp;
  readonly prefix: "replies-";
  readonly suffix: ".jsonl";
} = {
  SINGLE: "replies.jsonl",
  PATTERN: new RegExp("^replies(?:-(" + SAFE_ID.source.slice(1, -1) + "))?\\.jsonl$"),
  prefix: "replies-",
  suffix: ".jsonl"
};

export type ReplyFileAgent =
  | { readonly ok: true; readonly agent: SafeId | null; readonly reason: null }
  | { readonly ok: false; readonly agent: null; readonly reason: string };

export function agentFromFilename(filename: unknown): ReplyFileAgent {
  const match = typeof filename === "string" ? REPLY_FILE.PATTERN.exec(filename) : null;
  if (match === null) {
    return { ok: false, agent: null, reason: "reply file name is not replies.jsonl or replies-<agent>.jsonl" };
  }
  const agent = match[1];
  return { ok: true, agent: isSafeId(agent) ? agent : null, reason: null };
}

export const REPLY_POLL = { INTERVAL_MS: 5000 } as const;

export const REPLY_CURSOR_FIELD = "seq";

export function nextReadOffset(recordedOffset: unknown, fileSize: number): { readonly offset: number; readonly refold: boolean } {
  const size: unknown = fileSize;
  if (typeof size !== "number" || !Number.isFinite(size) || size < 0) throw new Error("nextReadOffset: fileSize must be a number");
  const offset = typeof recordedOffset === "number" && recordedOffset > 0 ? recordedOffset : 0;
  return size < offset ? { offset: 0, refold: true } : { offset, refold: false };
}

export function splitCompleteLines(chunk: string): { readonly lines: readonly string[]; readonly remainder: string } {
  const lines = chunk.split("\n");
  const remainder = lines.pop() ?? "";
  return { lines, remainder };
}
