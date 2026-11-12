/*
 * read-when: Changing src/contract/item-check.ts, the check on a record before it is stored, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateItem } from "../../../src/contract/item-check.ts";
import { KIND, STATE } from "../../../src/contract/record.ts";
import { AT, aChoice, anItem, archived, folded } from "../domain/support/items.ts";
import { label } from "./support/untyped.ts";

function problems(value: unknown): string {
  try {
    validateItem(value);
  } catch (error) {
    if (error instanceof Error) return error.message;
  }
  throw new Error("expected validateItem to refuse " + label(value));
}

test("a valid record passes, and the call returns nothing", () => {
  const item = anItem();
  assert.doesNotThrow(() => {
    validateItem(item);
  });
});

test("a draft comment with no note is valid and durable", () => {
  const draft = anItem({ kind: KIND.COMMENT, state: STATE.DRAFT, before: null, after: null, change: null });
  assert.doesNotThrow(() => {
    validateItem(draft);
  });
});

test("a value that is not an object throws a TypeError naming what it got", () => {
  for (const value of [null, undefined, "x", 3, true]) {
    assert.throws(
      () => {
        validateItem(value);
      },
      (error: unknown) => error instanceof TypeError && error.message === "validateItem expects an object, got " + typeof value,
      label(value)
    );
  }
  assert.throws(
    () => {
      validateItem(null);
    },
    { name: "TypeError", message: "validateItem expects an object, got object" }
  );
});

test("an invalid record throws one error that names the record and lists every problem at once", () => {
  const broken = { ...anItem(), rev: 0, state: "nonsense" };
  assert.equal(
    problems(broken),
    "invalid item " + broken.id + ": rev must be a number >= 1; state must be one of draft, ready, handled, not_handled"
  );
});

test("the problems come in this order, one sentence each", () => {
  const nothing = problems({ thread: "x", reply: { status: "maybe" } });
  assert.equal(
    nothing,
    "invalid item undefined: " +
      [
        "id must be a non-empty string",
        "rev must be a number >= 1",
        "kind must be one of comment, edit, delete, format_only, note, choice",
        "state must be one of draft, ready, handled, not_handled",
        "page_origin must be a non-empty string",
        "page_path must be a non-empty string",
        "after_history must be an array; replay's branch three reads it",
        "thread must be an array of completed exchanges",
        "reply.status must be one of handled, not_handled, question"
      ].join("; ")
  );
});

test("the page fields must be non-empty strings", () => {
  const message = problems({ ...anItem(), page_origin: "", page_path: 3 });
  assert.ok(message.includes("page_origin must be a non-empty string; page_path must be a non-empty string"), message);
});

test("a ready comment or note must carry the reviewer's note, and a draft need not", () => {
  const comment = anItem({ kind: KIND.COMMENT, state: STATE.READY, note: null });
  assert.ok(problems(comment).endsWith("a ready comment must carry the reviewer's note"));
  const note = anItem({ kind: KIND.NOTE, state: STATE.READY, note: "" });
  assert.ok(problems(note).endsWith("a ready note must carry the reviewer's note"));
  assert.doesNotThrow(() => {
    validateItem({ ...comment, state: STATE.DRAFT });
  });
  assert.doesNotThrow(() => {
    validateItem({ ...comment, note: "words" });
  });
});

test("a ready edit must carry after text, and a delete, a format-only change and a choice have no such rule", () => {
  const edit = { ...anItem({ kind: KIND.EDIT, state: STATE.READY }), after: null };
  assert.ok(problems(edit).endsWith("a ready edit must carry after text"));
  assert.doesNotThrow(() => {
    validateItem({ ...edit, state: STATE.DRAFT });
  });
  assert.doesNotThrow(() => {
    validateItem({ ...anItem({ kind: KIND.DELETE, state: STATE.READY }), after: null });
  });
  assert.doesNotThrow(() => {
    validateItem({ ...anItem({ kind: KIND.FORMAT_ONLY, state: STATE.READY }), after: null });
  });
  assert.doesNotThrow(() => {
    validateItem(aChoice());
  });
});

test("a record with no thread is accepted: it was made before threads existed", () => {
  const legacy: Record<string, unknown> = { ...anItem() };
  delete legacy["thread"];
  assert.doesNotThrow(() => {
    validateItem(legacy);
  });
});

test("a thread that is present and not a list is refused", () => {
  assert.ok(problems({ ...anItem(), thread: "x" }).includes("thread must be an array of completed exchanges"));
  assert.ok(problems({ ...anItem(), thread: { rev: 1 } }).includes("thread must be an array of completed exchanges"));
});

test("each thread round is checked: an object, a revision, a reviewer, an agent and the agent's status", () => {
  const good = { rev: 1, reviewer: { note: "n", change: null, at: AT }, agent: archived() };
  assert.doesNotThrow(() => {
    validateItem({ ...anItem(), thread: [good] });
  });
  const message = problems({
    ...anItem(),
    thread: [good, "x", { rev: 0 }, { rev: 2, reviewer: {}, agent: { status: "maybe" } }, { rev: 3, reviewer: {}, agent: null }]
  });
  assert.equal(
    message.slice(message.indexOf(": ") + 2),
    [
      "thread[1] must be an object",
      "thread[2].rev must be >= 1",
      "thread[2].reviewer is required",
      "thread[2].agent is required",
      "thread[3].agent.status must be one of handled, not_handled, question",
      "thread[4].agent is required"
    ].join("; ")
  );
});

test("a reply's status must be handled, not_handled or question", () => {
  assert.doesNotThrow(() => {
    validateItem({ ...anItem(), reply: folded({ status: "question" }) });
  });
  assert.ok(problems({ ...anItem(), reply: { status: "maybe" } }).endsWith("reply.status must be one of handled, not_handled, question"));
  assert.doesNotThrow(() => {
    validateItem({ ...anItem(), reply: null });
  });
});

test("a choice problem rides last, with the choice check's own reason", () => {
  const forged = { ...aChoice(), before: "Promote this lesson?", rev: 0 };
  const message = problems(forged);
  assert.ok(message.endsWith("rev must be a number >= 1; a choice record carries before"), message);
  assert.ok(problems({ ...aChoice(), choice: { group: "bad group", answer: "x" } }).includes("choice.group is missing or off the grammar"));
  assert.ok(problems({ ...anItem(), choice: { group: "g", answer: "a" } }).includes("choice is set only on a choice record, and this is a edit"));
});

test("only the fields the rules name are checked: a record's other fields are trusted", () => {
  assert.doesNotThrow(() => {
    validateItem({ ...anItem(), region: null, context: "x", note: 5, page_seq: "7" });
  });
});
