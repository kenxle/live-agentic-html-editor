/*
 * read-when: Changing src/contract/replies.ts, the reply line an agent writes or the reply poll, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { CODES } from "../../../src/contract/failures.ts";
import { isSafeId } from "../../../src/contract/safe-id.ts";
import {
  REPLY_CURSOR_FIELD,
  REPLY_FIELD,
  REPLY_FILE,
  REPLY_POLL,
  REPLY_STATUS,
  REPLY_STATUSES,
  SUGGESTIONS_MAX,
  SUGGESTION_TEXT_MAX,
  agentFromFilename,
  nextReadOffset,
  parseReplyLine,
  splitCompleteLines
} from "../../../src/contract/replies.ts";
import { callUntyped, jsonMessage } from "./support/untyped.ts";

function line(fields: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ item: "itm_1", rev: 2, agent: "claude", ...fields });
}

function refusal(reason: string): unknown {
  return { ok: false, code: "REPLY_LINE_MALFORMED", reason };
}

test("the reply fields and statuses are exactly these", () => {
  assert.deepEqual(REPLY_FIELD, {
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
  });
  assert.deepEqual(REPLY_STATUS, { HANDLED: "handled", NOT_HANDLED: "not_handled", QUESTION: "question" });
  assert.deepEqual(REPLY_STATUSES, ["handled", "not_handled", "question"]);
});

test("a handled reply needs an item, a revision and a status", () => {
  const ok = parseReplyLine('{"item":"c_7fa2","rev":2,"status":"handled","agent":"claude"}');
  assert.deepEqual(ok, {
    ok: true,
    reply: {
      item: "c_7fa2",
      rev: 2,
      status: "handled",
      agent: "claude",
      reason: null,
      text: null,
      files: [],
      user_needs_to_see_reply: false
    },
    reason: null
  });
});

test("a not_handled reply also needs a reason and a question also needs text", () => {
  const noReason = parseReplyLine('{"item":"c_7fa2","rev":2,"status":"not_handled"}');
  assert.deepEqual(noReason, refusal("status not_handled needs item, rev, status, reason; missing or wrong type: reason"));
  const noText = parseReplyLine('{"item":"c_7fa2","rev":2,"status":"question"}');
  assert.deepEqual(noText, refusal("status question needs item, rev, status, text; missing or wrong type: text"));
  const reason = parseReplyLine('{"item":"c_7fa2","rev":2,"status":"not_handled","reason":"cannot do that"}');
  assert.equal(reason.ok ? reason.reply.reason : null, "cannot do that");
  const text = parseReplyLine('{"item":"c_7fa2","rev":2,"status":"question","text":"which one?"}');
  assert.equal(text.ok ? text.reply.text : null, "which one?");
});

test("a status outside the three is refused, naming the status as JSON", () => {
  const list = "status must be one of handled, not_handled, question, got ";
  assert.deepEqual(parseReplyLine('{"item":"c_7fa2","rev":2,"status":"done"}'), refusal(list + '"done"'));
  assert.deepEqual(parseReplyLine('{"item":"c_7fa2","rev":2}'), refusal(list + "undefined"));
  assert.deepEqual(parseReplyLine('{"item":"c_7fa2","rev":2,"status":5}'), refusal(list + "5"));
  assert.deepEqual(parseReplyLine('{"item":"c_7fa2","rev":2,"status":null}'), refusal(list + "null"));
  assert.deepEqual(parseReplyLine('{"item":"c_7fa2","rev":2,"status":"Handled"}'), refusal(list + '"Handled"'));
});

test("an item must be a string with a character in it and a revision must be a number; a blank reason or text counts as missing", () => {
  const needs = "status handled needs item, rev, status; missing or wrong type: ";
  assert.deepEqual(parseReplyLine('{"item":"   ","rev":2,"status":"handled"}'), refusal(needs + "item"));
  assert.deepEqual(parseReplyLine('{"item":"","rev":2,"status":"handled"}'), refusal(needs + "item"));
  assert.deepEqual(parseReplyLine('{"item":5,"rev":2,"status":"handled"}'), refusal(needs + "item"));
  assert.deepEqual(parseReplyLine('{"item":"c_1","rev":"2","status":"handled"}'), refusal(needs + "rev"));
  assert.deepEqual(
    parseReplyLine('{"item":"c_1","rev":2,"status":"not_handled","reason":"   "}'),
    refusal("status not_handled needs item, rev, status, reason; missing or wrong type: reason")
  );
  assert.deepEqual(
    parseReplyLine('{"item":"c_1","rev":2,"status":"question","text":" \\n\\t"}'),
    refusal("status question needs item, rev, status, text; missing or wrong type: text")
  );
  assert.equal(parseReplyLine('{"item":"c_1","rev":0,"status":"handled"}').ok, true, "revision zero is a number");
});

test("a field that fails is named once in the reason, in the order the reason lists them", () => {
  const needs = "status handled needs item, rev, status; missing or wrong type: ";
  assert.deepEqual(parseReplyLine('{"rev":2,"status":"handled"}'), refusal(needs + "item"));
  assert.deepEqual(parseReplyLine('{"item":null,"rev":2,"status":"handled"}'), refusal(needs + "item"));
  assert.deepEqual(parseReplyLine('{"item":"c_1","status":"handled"}'), refusal(needs + "rev"));
  assert.deepEqual(parseReplyLine('{"item":"c_1","rev":"","status":"handled"}'), refusal(needs + "rev"));
  assert.deepEqual(parseReplyLine('{"status":"handled"}'), refusal(needs + "item, rev"));
  assert.deepEqual(parseReplyLine('{"status":"handled","rev":"x","item":5}'), refusal(needs + "item, rev"));
  assert.deepEqual(
    parseReplyLine('{"item":5,"rev":2,"status":"not_handled"}'),
    refusal("status not_handled needs item, rev, status, reason; missing or wrong type: item, reason")
  );
  assert.deepEqual(
    parseReplyLine('{"rev":2,"status":"question"}'),
    refusal("status question needs item, rev, status, text; missing or wrong type: item, text")
  );
});

test("a malformed line is refused with a reason, whatever it holds, and never throws", () => {
  const bad = parseReplyLine("{oops");
  assert.deepEqual(bad, refusal("not JSON: " + jsonMessage("{oops")));
  assert.equal(Object.hasOwn(CODES, "REPLY_LINE_MALFORMED"), true);
  assert.equal(CODES.REPLY_LINE_MALFORMED.persistent, true, "the chip stays until the reviewer dismisses it");
  for (const text of ["", " ", "null", "5", '"text"', "true", "[]", '[{"status":"handled"}]', "{", "}", "\u0000", "{}", "\n", '{"a":', "{'a':1}"]) {
    assert.doesNotThrow(() => parseReplyLine(text), JSON.stringify(text));
    const got = parseReplyLine(text);
    assert.equal(got.ok, false, JSON.stringify(text));
    assert.equal(got.ok ? "" : got.code, "REPLY_LINE_MALFORMED");
  }
  for (const text of ["null", "5", '"text"', "true", "[]", '[{"status":"handled"}]']) {
    assert.deepEqual(parseReplyLine(text), refusal("a reply line must be a JSON object"), text);
  }
  assert.doesNotThrow(() => callUntyped(parseReplyLine, undefined));
  assert.doesNotThrow(() => callUntyped(parseReplyLine, 7));
});

test("user_needs_to_see_reply is true only for the boolean true, and anything else costs nothing", () => {
  const flagged = parseReplyLine('{"item":"c_7fa2","rev":2,"status":"handled","user_needs_to_see_reply":true}');
  assert.equal(flagged.ok ? flagged.reply.user_needs_to_see_reply : null, true);
  const absent = parseReplyLine('{"item":"c_7fa2","rev":2,"status":"handled"}');
  assert.equal(absent.ok ? absent.reply.user_needs_to_see_reply : null, false, "absent means no, not unknown");
  for (const value of ['"yes"', "1", "null", "{}", "false", '"true"', "[true]"]) {
    const parsed = parseReplyLine('{"item":"c_7fa2","rev":2,"status":"handled","user_needs_to_see_reply":' + value + "}");
    assert.equal(parsed.ok, true, value + " does not cost the agent the whole line");
    assert.equal(parsed.ok ? parsed.reply.user_needs_to_see_reply : null, false, value + " is not a flag");
  }
});

test("an accepted reply carries a copy of the files list, or an empty list when files is not a list", () => {
  const files = ["a.html", { path: "b.html" }, 3];
  const withFiles = parseReplyLine(line({ status: "handled", files }));
  assert.deepEqual(withFiles.ok ? withFiles.reply.files : null, files);
  const text = JSON.stringify({ item: "itm_1", rev: 2, status: "handled", files });
  const first = parseReplyLine(text);
  const second = parseReplyLine(text);
  assert.notEqual(first.ok ? first.reply.files : 1, second.ok ? second.reply.files : 2, "each reply gets its own list");
  for (const value of ['"a.html"', "null", "{}", "5"]) {
    const parsed = parseReplyLine('{"item":"c_1","rev":1,"status":"handled","files":' + value + "}");
    assert.deepEqual(parsed.ok ? parsed.reply.files : null, [], value);
  }
});

test("the line's agent beats the filename's agent, and a missing agent is the filename's, else null", () => {
  const withBoth = parseReplyLine('{"item":"c_1","rev":1,"status":"handled","agent":"codex"}', { filenameAgent: "claude" });
  assert.equal(withBoth.ok ? withBoth.reply.agent : null, "codex");
  const filenameOnly = parseReplyLine('{"item":"c_1","rev":1,"status":"handled"}', { filenameAgent: "claude" });
  assert.equal(filenameOnly.ok ? filenameOnly.reply.agent : "x", "claude");
  const neither = parseReplyLine('{"item":"c_1","rev":1,"status":"handled"}');
  assert.equal(neither.ok ? neither.reply.agent : "x", null);
  for (const value of ['""', "5", "null", "{}"]) {
    const got = parseReplyLine('{"item":"c_1","rev":1,"status":"handled","agent":' + value + "}", { filenameAgent: "claude" });
    assert.equal(got.ok ? got.reply.agent : "x", "claude", value);
  }
  const nullFilename = parseReplyLine('{"item":"c_1","rev":1,"status":"handled"}', { filenameAgent: null });
  assert.equal(nullFilename.ok ? nullFilename.reply.agent : "x", null);
});

test("an ordinary reply carries no proofread keys, and a proofread question carries both", () => {
  const plain = parseReplyLine(line({ status: "handled" }));
  assert.equal(plain.ok, true);
  assert.equal(Object.hasOwn(plain.ok ? plain.reply : {}, "proofread"), false);
  assert.equal(Object.hasOwn(plain.ok ? plain.reply : {}, "suggestions"), false);
  const suggestions = [
    { block: 0, from: "teh", to: "the" },
    { block: 3, from: "its", to: "it's" }
  ];
  const got = parseReplyLine(
    line({ status: "question", text: "I placed your words as written. Two fixes you may want.", proofread: true, suggestions })
  );
  assert.equal(got.ok, true);
  assert.equal(got.ok ? got.reply.proofread : null, true);
  assert.deepEqual(got.ok ? got.reply.suggestions : null, suggestions);
  const empty = parseReplyLine(line({ status: "question", text: "q", proofread: true }));
  assert.equal(empty.ok ? empty.reply.proofread : null, true);
  assert.deepEqual(empty.ok ? empty.reply.suggestions : null, [], "suggestions missing is an empty list");
});

test("a suggestion keeps only block, from and to", () => {
  const got = parseReplyLine(
    line({ status: "question", text: "q", proofread: true, suggestions: [{ block: 1, from: "a", to: "b", extra: "dropped", note: 5 }] })
  );
  assert.deepEqual(got.ok ? got.reply.suggestions : null, [{ block: 1, from: "a", to: "b" }]);
  const first = got.ok ? got.reply.suggestions?.[0] : undefined;
  assert.deepEqual(Object.keys(first ?? {}), ["block", "from", "to"]);
});

test("proofread and suggestions belong on a question reply only, and proofread must be the literal true", () => {
  const belong = "proofread and suggestions belong on a question reply only";
  assert.deepEqual(parseReplyLine(line({ status: "handled", suggestions: [{ block: 0, from: "a", to: "b" }] })), refusal(belong));
  assert.deepEqual(parseReplyLine(line({ status: "not_handled", reason: "x", proofread: true })), refusal(belong));
  assert.deepEqual(parseReplyLine(line({ status: "handled", proofread: false })), refusal(belong));
  const literal = "proofread must be true when suggestions are given";
  for (const proofread of ["yes", false, 1, null, "true"]) {
    assert.deepEqual(parseReplyLine(line({ status: "question", text: "q", proofread, suggestions: [] })), refusal(literal), String(proofread));
  }
  assert.deepEqual(parseReplyLine(line({ status: "question", text: "q", suggestions: [] })), refusal(literal));
});

test("suggestions of the wrong shape are refused, each with its own reason", () => {
  const question = (suggestions: unknown): string => line({ status: "question", text: "q", proofread: true, suggestions });
  const cases: readonly (readonly [unknown, string])[] = [
    [{ block: 0, from: "a", to: "b" }, "suggestions must be a list"],
    ["not a list", "suggestions must be a list"],
    [null, "suggestions must be a list"],
    [["not an object"], "suggestion 0 must be an object"],
    [[null], "suggestion 0 must be an object"],
    [[[1]], "suggestion 0 must be an object"],
    [[{ block: 0, from: "a", to: "b" }, 5], "suggestion 1 must be an object"],
    [[{ block: -1, from: "a", to: "b" }], "suggestion 0 block must be a whole number from 0"],
    [[{ block: 1.5, from: "a", to: "b" }], "suggestion 0 block must be a whole number from 0"],
    [[{ block: "0", from: "a", to: "b" }], "suggestion 0 block must be a whole number from 0"],
    [[{ from: "a", to: "b" }], "suggestion 0 block must be a whole number from 0"],
    [[{ block: 0, from: "", to: "b" }], "suggestion 0 from must be a non-empty string"],
    [[{ block: 0, from: 5, to: "b" }], "suggestion 0 from must be a non-empty string"],
    [[{ block: 0, to: "b" }], "suggestion 0 from must be a non-empty string"],
    [[{ block: 0, from: "a" }], "suggestion 0 to must be a string"],
    [[{ block: 0, from: "a", to: 3 }], "suggestion 0 to must be a string"],
    [[{ block: 0, from: "a", to: "b" }, { block: 2, from: "a", to: null }], "suggestion 1 to must be a string"]
  ];
  for (const [suggestions, reason] of cases) {
    assert.deepEqual(parseReplyLine(question(suggestions)), refusal(reason), JSON.stringify(suggestions));
  }
  assert.equal(parseReplyLine(question([{ block: 0, from: "a", to: "" }])).ok, true, "a fix may delete: to can be empty");
});

test("the suggestion limits are 400 fixes and 200000 characters, and a list or a string at the limit is accepted", () => {
  assert.equal(SUGGESTIONS_MAX, 400);
  assert.equal(SUGGESTION_TEXT_MAX, 200000);
  const question = (suggestions: unknown): string => line({ status: "question", text: "q", proofread: true, suggestions });
  const fix = { block: 0, from: "a", to: "b" };
  assert.equal(parseReplyLine(question(Array.from({ length: 400 }, () => fix))).ok, true);
  assert.deepEqual(parseReplyLine(question(Array.from({ length: 401 }, () => fix))), refusal("suggestions holds 401 fixes, more than 400"));
  assert.equal(parseReplyLine(question([{ block: 0, from: "a".repeat(200000), to: "b" }])).ok, true);
  assert.equal(parseReplyLine(question([{ block: 0, from: "a", to: "b".repeat(200000) }])).ok, true);
  const over = "suggestion 0 from or to is over 200000 characters";
  assert.deepEqual(parseReplyLine(question([{ block: 0, from: "a".repeat(200001), to: "b" }])), refusal(over));
  assert.deepEqual(parseReplyLine(question([{ block: 0, from: "a", to: "b".repeat(200001) }])), refusal(over));
});

test("the reply files are replies.jsonl and replies-<agent>.jsonl, where the agent follows the safe id rule", () => {
  assert.equal(REPLY_FILE.SINGLE, "replies.jsonl");
  assert.equal(REPLY_FILE.prefix, "replies-");
  assert.equal(REPLY_FILE.suffix, ".jsonl");
  assert.deepEqual(Object.keys(REPLY_FILE).sort(), ["PATTERN", "SINGLE", "prefix", "suffix"]);
  assert.equal(REPLY_FILE.PATTERN.exec("replies.jsonl")?.[1], undefined);
  assert.equal(REPLY_FILE.PATTERN.exec("replies-claude.jsonl")?.[1], "claude");
  assert.equal(REPLY_FILE.PATTERN.test("replies-.jsonl"), false);
  const agents = ["claude", "a", "a".repeat(64), "a".repeat(65), "", ".x", "-x", "a b", "a/b", "../../etc/passwd", "a.b-c_d", "é", "a\n"];
  for (const agent of agents) {
    assert.equal(REPLY_FILE.PATTERN.test("replies-" + agent + ".jsonl"), isSafeId(agent), JSON.stringify(agent));
  }
});

test("the agent a reply file belongs to comes from its name, and a name that is not a reply file is refused", () => {
  assert.deepEqual(agentFromFilename("replies.jsonl"), { ok: true, agent: null, reason: null });
  assert.deepEqual(agentFromFilename("replies-claude.jsonl"), { ok: true, agent: "claude", reason: null });
  const refused = { ok: false, agent: null, reason: "reply file name is not replies.jsonl or replies-<agent>.jsonl" };
  const names = ["replies-../../etc/passwd.jsonl", "replies-.jsonl", "notes.txt", "replies-" + "a".repeat(65) + ".jsonl", "replies.json", "xreplies.jsonl", "replies-a.jsonl.bak", ""];
  for (const name of names) assert.deepEqual(agentFromFilename(name), refused, name);
  for (const value of [undefined, null, 5, ["replies.jsonl"], {}]) assert.deepEqual(agentFromFilename(value), refused, String(value));
});

test("the reply poll asks every 5 seconds and its cursor is a seq, never a timestamp", () => {
  assert.deepEqual(REPLY_POLL, { INTERVAL_MS: 5000 });
  assert.equal(REPLY_CURSOR_FIELD, "seq");
});

test("the reply poll tracks a byte offset and resets when a file shrinks", () => {
  assert.deepEqual(nextReadOffset(120, 400), { offset: 120, refold: false });
  assert.deepEqual(nextReadOffset(400, 120), { offset: 0, refold: true });
  assert.deepEqual(nextReadOffset(null, 50), { offset: 0, refold: false });
  assert.deepEqual(nextReadOffset(undefined, 50), { offset: 0, refold: false });
  assert.deepEqual(nextReadOffset(400, 400), { offset: 400, refold: false });
  assert.deepEqual(nextReadOffset(0, 0), { offset: 0, refold: false });
  assert.deepEqual(nextReadOffset(-5, 10), { offset: 0, refold: false });
  assert.deepEqual(nextReadOffset("120", 400), { offset: 0, refold: false });
  assert.deepEqual(nextReadOffset(5, 0), { offset: 0, refold: true });
});

test("a file size that is not a finite number of 0 or more is refused", () => {
  for (const size of [-1, NaN, Infinity, -Infinity]) {
    assert.throws(() => nextReadOffset(0, size), { message: "nextReadOffset: fileSize must be a number" }, String(size));
  }
  for (const size of ["5", null, undefined, {}]) {
    assert.throws(() => callUntyped(nextReadOffset, 0, size), { message: "nextReadOffset: fileSize must be a number" }, String(size));
  }
});

test("a chunk splits into its complete lines and the torn text after the last newline", () => {
  assert.deepEqual(splitCompleteLines('{"a":1}\n{"b":2}\n{"c":3 half-written'), { lines: ['{"a":1}', '{"b":2}'], remainder: '{"c":3 half-written' });
  assert.deepEqual(splitCompleteLines('{"a":1}\n'), { lines: ['{"a":1}'], remainder: "" });
  assert.deepEqual(splitCompleteLines(""), { lines: [], remainder: "" });
  assert.deepEqual(splitCompleteLines("half"), { lines: [], remainder: "half" });
  assert.deepEqual(splitCompleteLines("\n"), { lines: [""], remainder: "" });
  assert.deepEqual(splitCompleteLines("a\n\nb"), { lines: ["a", ""], remainder: "b" });
});
