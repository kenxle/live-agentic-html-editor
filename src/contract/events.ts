/*
 * read-when: Changing an event type, the fields of an events.jsonl line, or how a line is built, written or read back.
 */

import { isJsonObject } from "./json-object.ts";
import type { JsonObject } from "./json-object.ts";
import { isSafeId } from "./safe-id.ts";
import type { SafeId } from "./safe-id.ts";

export const EVENT = {
  REVIEW_CREATED: "review.created",
  ORIGIN_REGISTERED: "origin.registered",
  ORIGIN_REMOVED: "origin.removed",
  PAGE_VISITED: "page.visited",
  ITEM_CREATED: "item.created",
  ITEM_CONTENT: "item.content",
  ITEM_READY: "item.ready",
  ITEM_DELETED: "item.deleted",
  ITEM_REOPENED: "item.reopened",
  ITEM_CLOSED: "item.closed",
  REPLY_SEEN: "reply.seen",
  REPLY_FOLDED: "reply.folded",
  REPLY_REJECTED: "reply.rejected",
  REVIEW_ARCHIVED: "review.archived",
  REVIEW_ADOPTED: "review.adopted"
} as const;
export type EventType = (typeof EVENT)[keyof typeof EVENT];

export const EVENT_TYPES: readonly EventType[] = Object.values(EVENT);

export const EVENT_FIELD = {
  EVENT: "event",
  EVENT_ID: "event_id",
  TS: "ts",
  SEQ: "seq",
  REVIEW: "review",
  ITEM: "item",
  REV: "rev",
  PAGE_PATH: "page_path",
  PAGE_TITLE: "page_title",
  PAGE_SEQ: "page_seq",
  SOURCE_HINT: "source_hint",
  RECEIVED_AT: "received_at"
} as const;

export const IDEMPOTENCE_KEY: typeof EVENT_FIELD.EVENT_ID = EVENT_FIELD.EVENT_ID;

export interface NewEventInput {
  readonly event: EventType;
  readonly event_id: string;
  readonly review: SafeId;
  readonly ts?: string;
  readonly seq?: number | null;
  readonly item?: string | null;
  readonly rev?: number | null;
  readonly page_path?: string | null;
  readonly page_title?: string | null;
  readonly page_seq?: number | null;
  readonly source_hint?: string | null;
  readonly payload?: JsonObject;
}

export interface WireEvent {
  readonly event: EventType;
  readonly event_id: string;
  readonly ts: string;
  readonly seq: number | null;
  readonly review: SafeId;
  readonly item: string | null;
  readonly rev: number | null;
  readonly page_path: string | null;
  readonly page_title: string | null;
  readonly page_seq: number | null;
  readonly source_hint: string | null;
  readonly [payloadField: string]: unknown;
}

export interface LoggedEvent {
  readonly event: EventType;
  readonly event_id: string;
  readonly [field: string]: unknown;
}

export type EventLineParse =
  | { readonly ok: true; readonly event: LoggedEvent }
  | { readonly ok: false; readonly reason: string };

function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && EVENT_TYPES.some((type) => type === value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

export function newEvent(input: NewEventInput): WireEvent {
  const type: unknown = input.event;
  if (!isEventType(type)) {
    throw new Error("newEvent: event must be one of " + EVENT_TYPES.join(", ") + ", got " + String(type));
  }
  const eventId: unknown = input.event_id;
  if (typeof eventId !== "string" || eventId === "") {
    throw new Error("newEvent: event_id is required and is client-minted; idempotence is by event_id");
  }
  const review: unknown = input.review;
  if (!isSafeId(review)) throw new Error("newEvent: review must be a safe id, got " + String(review));

  const event: WireEvent = {
    event: type,
    event_id: eventId,
    ts: typeof input.ts === "string" && input.ts !== "" ? input.ts : new Date().toISOString(),
    seq: numberOrNull(input.seq),
    review,
    item: textOrNull(input.item),
    rev: numberOrNull(input.rev),
    page_path: textOrNull(input.page_path),
    page_title: textOrNull(input.page_title),
    page_seq: numberOrNull(input.page_seq),
    source_hint: textOrNull(input.source_hint)
  };
  const payload: unknown = input.payload;
  if (isJsonObject(payload)) {
    for (const [key, value] of Object.entries(payload)) {
      if (!Object.hasOwn(event, key)) Object.defineProperty(event, key, { value, enumerable: true, writable: true, configurable: true });
    }
  }
  return event;
}

export function encodeEventLine(event: JsonObject): string {
  return JSON.stringify(event) + "\n";
}

export function parseEventLine(line: string): EventLineParse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    return { ok: false, reason: "not JSON: " + (error instanceof Error ? error.message : String(error)) };
  }
  if (!isJsonObject(parsed)) return { ok: false, reason: "not an object" };
  const type = parsed[EVENT_FIELD.EVENT];
  if (!isEventType(type)) return { ok: false, reason: "unknown event type " + String(type) };
  const eventId = parsed[EVENT_FIELD.EVENT_ID];
  if (typeof eventId !== "string" || eventId === "") {
    return { ok: false, reason: "missing event_id, which is the idempotence key" };
  }
  return { ok: true, event: { ...parsed, event: type, event_id: eventId } };
}
