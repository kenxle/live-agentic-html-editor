/*
 * read-when: test/unit/strictness_gate.test.js fails on this fixture.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

test("a node:test call needs no await", () => {
  assert.equal(1 + 1, 2);
});
