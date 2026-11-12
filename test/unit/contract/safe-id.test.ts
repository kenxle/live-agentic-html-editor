/*
 * read-when: Changing src/contract/safe-id.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { SAFE_ID, isSafeId } from "../../../src/contract/safe-id.ts";
import { label } from "./support/untyped.ts";

test("a safe id is 1 to 64 ASCII letters, digits, dots, underscores and dashes, starting with a letter or digit", () => {
  for (const id of ["rev_a", "a", "a".repeat(64), "s.1-x_2", "0", "A9", "a.b", "a-", "a_"]) {
    assert.equal(isSafeId(id), true, id);
  }
});

test("anything that could climb a path, hide a file, look like a flag or hold a separator is not a safe id", () => {
  const refused = ["a".repeat(65), "", ".hidden", "-a", "../etc", "a b", "a/b", "_a", "a\n", "a\\b", "é", "a:b", "..", "."];
  for (const id of refused) assert.equal(isSafeId(id), false, JSON.stringify(id));
});

test("a value that is not text is not a safe id", () => {
  for (const value of [7, null, undefined, {}, ["a"], true]) assert.equal(isSafeId(value), false, label(value));
});

test("SAFE_ID is an unflagged pattern whose source other patterns can be built from", () => {
  assert.ok(SAFE_ID instanceof RegExp);
  assert.equal(SAFE_ID.source, "^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$");
  assert.equal(SAFE_ID.flags, "");
  const built = new RegExp("^replies-(" + SAFE_ID.source.slice(1, -1) + ")\\.jsonl$");
  assert.equal(built.test("replies-claude.jsonl"), true);
  assert.equal(built.test("replies-.x.jsonl"), false);
});
