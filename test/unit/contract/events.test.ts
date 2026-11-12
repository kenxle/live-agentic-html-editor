/*
 * read-when: Changing src/contract/events.ts, an event type or the events.jsonl line, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EVENT,
  EVENT_FIELD,
  EVENT_TYPES,
  IDEMPOTENCE_KEY,
  encodeEventLine,
  newEvent,
  parseEventLine
} from "../../../src/contract/events.ts";
import { isJsonObject } from "../../../src/contract/json-object.ts";
import { callUntyped, jsonMessage, safeId } from "./support/untyped.ts";

const REVIEW = safeId("rev_a");

const NAMES = [
  ["REVIEW_CREATED", "review.created"],
  ["ORIGIN_REGISTERED", "origin.registered"],
  ["ORIGIN_REMOVED", "origin.removed"],
  ["PAGE_VISITED", "page.visited"],
  ["ITEM_CREATED", "item.created"],
  ["ITEM_CONTENT", "item.content"],
  ["ITEM_READY", "item.ready"],
  ["ITEM_DELETED", "item.deleted"],
  ["ITEM_REOPENED", "item.reopened"],
  ["ITEM_CLOSED", "item.closed"],
  ["REPLY_SEEN", "reply.seen"],
  ["REPLY_FOLDED", "reply.folded"],
  ["REPLY_REJECTED", "reply.rejected"],
  ["REVIEW_ARCHIVED", "review.archived"],
  ["REVIEW_ADOPTED", "review.adopted"]
] as const;

const BASE_KEYS = ["event", "event_id", "ts", "seq", "review", "item", "rev", "page_path", "page_title", "page_seq", "source_hint"];

test("the event type vocabulary is closed and complete: fifteen types, in this order", () => {
  assert.deepEqual(Object.entries(EVENT), NAMES);
  assert.deepEqual(
    EVENT_TYPES,
    NAMES.map(([, value]) => value)
  );
  assert.equal(EVENT_TYPES.length, 15);
});

test("the event fields are exactly these, and idempotence is by event_id", () => {
  assert.deepEqual(EVENT_FIELD, {
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
  });
  assert.equal(IDEMPOTENCE_KEY, "event_id");
});

test("an event starts with the eleven base fields in a fixed order, then the payload's own", () => {
  const e = newEvent({
    event: EVENT.ITEM_CONTENT,
    event_id: "e1",
    review: REVIEW,
    ts: "2026-11-12T10:00:00.000Z",
    seq: 4,
    item: "itm_1",
    rev: 2,
    page_path: "/a.html",
    page_title: "A",
    page_seq: 3,
    source_hint: "a.md",
    payload: { text: "hello", more: { deep: [1] } }
  });
  assert.deepEqual(Object.keys(e), [...BASE_KEYS, "text", "more"]);
  assert.deepEqual(e, {
    event: "item.content",
    event_id: "e1",
    ts: "2026-11-12T10:00:00.000Z",
    seq: 4,
    review: "rev_a",
    item: "itm_1",
    rev: 2,
    page_path: "/a.html",
    page_title: "A",
    page_seq: 3,
    source_hint: "a.md",
    text: "hello",
    more: { deep: [1] }
  });
});

test("fields that are not given become null, and the time is now", () => {
  const before = Date.now();
  const e = newEvent({ event: EVENT.REVIEW_CREATED, event_id: "e2", review: REVIEW });
  const after = Date.now();
  assert.deepEqual(Object.keys(e), BASE_KEYS);
  assert.equal(typeof e.ts, "string");
  assert.match(e.ts, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.ok(Date.parse(e.ts) >= before && Date.parse(e.ts) <= after, e.ts);
  for (const key of ["seq", "item", "rev", "page_path", "page_title", "page_seq", "source_hint"]) {
    assert.equal(e[key], null, key);
  }
  assert.equal(newEvent({ event: EVENT.REVIEW_CREATED, event_id: "e2", review: REVIEW, ts: "" }).ts.length > 0, true, "an empty ts is the current time");
});

test("a text field that is empty is null, and a number field that is not a number is null", () => {
  const empty = newEvent({ event: EVENT.ITEM_READY, event_id: "e3", review: REVIEW, item: "", page_path: "", page_title: "", source_hint: "" });
  for (const key of ["item", "page_path", "page_title", "source_hint"]) assert.equal(empty[key], null, key);
  const odd = callUntyped(newEvent, { event: EVENT.ITEM_READY, event_id: "e4", review: "rev_a", seq: "5", rev: null, page_seq: undefined });
  assert.ok(isJsonObject(odd));
  assert.equal(odd["seq"], null);
  assert.equal(odd["rev"], null);
  assert.equal(odd["page_seq"], null);
  const zero = newEvent({ event: EVENT.ITEM_READY, event_id: "e5", review: REVIEW, seq: 0, rev: 0, page_seq: 0 });
  assert.equal(zero.seq, 0);
  assert.equal(zero.rev, 0);
  assert.equal(zero.page_seq, 0);
});

test("a payload key that names a base field is ignored, so a payload never changes an event's identity", () => {
  const e = newEvent({
    event: EVENT.ITEM_CONTENT,
    event_id: "real",
    review: REVIEW,
    item: "itm_1",
    ts: "2026-11-12T10:00:00.000Z",
    payload: { event_id: "forged", review: "rev_other", ts: "1999", event: "item.deleted", seq: 99, item: "itm_2", rev: 7, page_path: "/x", page_title: "x", page_seq: 1, source_hint: "x", text: "kept" }
  });
  assert.equal(e.event_id, "real");
  assert.equal(e.review, "rev_a");
  assert.equal(e.ts, "2026-11-12T10:00:00.000Z");
  assert.equal(e.event, "item.content");
  assert.equal(e.seq, null);
  assert.equal(e.item, "itm_1");
  assert.equal(e.text, "kept");
  assert.deepEqual(Object.keys(e), [...BASE_KEYS, "text"]);
});

test("a payload that is not an object adds nothing, and a payload key named received_at is kept", () => {
  for (const payload of [null, undefined, "text", 5]) {
    const e = callUntyped(newEvent, { event: EVENT.ITEM_READY, event_id: "e6", review: "rev_a", payload });
    assert.ok(isJsonObject(e));
    assert.deepEqual(Object.keys(e), BASE_KEYS, String(payload));
  }
  const stamped = newEvent({ event: EVENT.ITEM_READY, event_id: "e7", review: REVIEW, payload: { received_at: "x" } });
  assert.equal(stamped["received_at"], "x");
});

test("a payload key named __proto__ becomes a plain field and never changes the event's prototype", () => {
  const payload: unknown = JSON.parse('{"__proto__": {"polluted": true}, "text": "x"}');
  assert.ok(isJsonObject(payload));
  const e = newEvent({ event: EVENT.ITEM_READY, event_id: "e8", review: REVIEW, payload });
  assert.equal(Object.getPrototypeOf(e), Object.prototype);
  assert.equal(Object.hasOwn(e, "__proto__"), true);
  assert.equal(e["polluted"], undefined);
  assert.equal(Object.hasOwn(Object.prototype, "polluted"), false);
  assert.equal(e["text"], "x");
});

test("idempotence is by event_id, never by item and rev: two events for one item and revision stay distinct", () => {
  const base = { event: EVENT.ITEM_CONTENT, review: REVIEW, item: "itm_1", rev: 1 } as const;
  const a = newEvent({ ...base, event_id: "e1", payload: { text: "half a sen" } });
  const b = newEvent({ ...base, event_id: "e2", payload: { text: "half a sentence" } });
  assert.equal(a.item, b.item);
  assert.equal(a.rev, b.rev);
  assert.notEqual(a.event_id, b.event_id);
  assert.notEqual(a["text"], b["text"]);
});

test("an event with an unknown type, no event_id or an unsafe review is refused, with these messages", () => {
  assert.throws(
    () => callUntyped(newEvent, { event: "item.invented", event_id: "e", review: "rev_a" }),
    { message: "newEvent: event must be one of " + EVENT_TYPES.join(", ") + ", got item.invented" }
  );
  assert.throws(() => callUntyped(newEvent, { event_id: "e", review: "rev_a" }), { message: "newEvent: event must be one of " + EVENT_TYPES.join(", ") + ", got undefined" });
  for (const id of [undefined, "", 5, null]) {
    assert.throws(
      () => callUntyped(newEvent, { event: "item.ready", event_id: id, review: "rev_a" }),
      { message: "newEvent: event_id is required and is client-minted; idempotence is by event_id" },
      String(id)
    );
  }
  for (const review of ["../etc", "", undefined, "a b", 7]) {
    assert.throws(
      () => callUntyped(newEvent, { event: "item.ready", event_id: "e", review }),
      { message: "newEvent: review must be a safe id, got " + String(review) },
      String(review)
    );
  }
});

test("an event line is the JSON of the event and one newline, whatever the page's text does", () => {
  const text = 'a "quoted" line\nand another\ttab\r\nand \u2028 a separator and \\ a slash';
  const e = newEvent({ event: EVENT.ITEM_CONTENT, event_id: "e3", review: REVIEW, payload: { text } });
  const line = encodeEventLine(e);
  assert.equal(line, JSON.stringify(e) + "\n");
  assert.equal(line.endsWith("\n"), true);
  assert.equal(line.slice(0, -1).includes("\n"), false, "one event is one line");
  const back = parseEventLine(line.slice(0, -1));
  assert.equal(back.ok, true);
  assert.deepEqual(back.ok ? back.event : null, e);
  assert.equal(back.ok ? back.event["text"] : null, text);
});

test("a line that is a JSON object with a known event and a non-empty event_id parses, with every field kept", () => {
  const got = parseEventLine('{"event":"item.ready","event_id":"e1","seq":3,"future_field":{"a":[1,2]},"review":"not even checked"}');
  assert.deepEqual(got, {
    ok: true,
    event: { event: "item.ready", event_id: "e1", seq: 3, future_field: { a: [1, 2] }, review: "not even checked" }
  });
  for (const type of EVENT_TYPES) assert.equal(parseEventLine(JSON.stringify({ event: type, event_id: "x" })).ok, true, type);
});

test("a line that is not an event is refused with a reason, and never throws", () => {
  const parser = jsonMessage("{not json");
  assert.deepEqual(parseEventLine("{not json"), { ok: false, reason: "not JSON: " + parser });
  assert.deepEqual(parseEventLine(""), { ok: false, reason: "not JSON: " + jsonMessage("") });
  for (const line of ["null", "5", '"text"', "true", "false", "[]", '[{"event":"item.ready","event_id":"e"}]']) {
    assert.deepEqual(parseEventLine(line), { ok: false, reason: "not an object" }, line);
  }
  assert.deepEqual(parseEventLine("{}"), { ok: false, reason: "unknown event type undefined" });
  assert.deepEqual(parseEventLine('{"event":"item.invented","event_id":"e"}'), { ok: false, reason: "unknown event type item.invented" });
  assert.deepEqual(parseEventLine('{"event":5,"event_id":"e"}'), { ok: false, reason: "unknown event type 5" });
  for (const line of ['{"event":"item.ready"}', '{"event":"item.ready","event_id":""}', '{"event":"item.ready","event_id":5}', '{"event":"item.ready","event_id":null}']) {
    assert.deepEqual(parseEventLine(line), { ok: false, reason: "missing event_id, which is the idempotence key" }, line);
  }
  assert.doesNotThrow(() => callUntyped(parseEventLine, undefined));
  assert.doesNotThrow(() => callUntyped(parseEventLine, 7));
});
