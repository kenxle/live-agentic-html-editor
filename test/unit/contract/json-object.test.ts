/*
 * read-when: Changing src/contract/json-object.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { isJsonObject } from "../../../src/contract/json-object.ts";

test("a plain object is a JSON object, whatever it holds", () => {
  assert.equal(isJsonObject({}), true);
  assert.equal(isJsonObject({ a: 1, b: [2], c: { d: null } }), true);
  assert.equal(isJsonObject(Object.create(null)), true);
  const parsed: unknown = JSON.parse('{"event":"item.ready"}');
  assert.equal(isJsonObject(parsed), true);
});

test("an array is not a JSON object, even though typeof says object", () => {
  assert.equal(typeof [], "object");
  assert.equal(isJsonObject([]), false);
  assert.equal(isJsonObject([{ a: 1 }]), false);
});

test("null, text, numbers, booleans and nothing are not JSON objects", () => {
  for (const value of [null, undefined, "x", "", 0, 1, true, false, () => ({})]) {
    assert.equal(isJsonObject(value), false, String(value));
  }
});
