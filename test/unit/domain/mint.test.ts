/*
 * read-when: Changing src/domain/mint.ts, how a record gets its id or its timestamp, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { nowIso, randomId } from "../../../src/domain/mint.ts";

test("an id is the prefix, an underscore and twenty-four lowercase hex digits", () => {
  assert.match(randomId("itm"), /^itm_[0-9a-f]{24}$/);
  assert.match(randomId("evt"), /^evt_[0-9a-f]{24}$/);
});

test("an id with no prefix, or an empty one, is the twenty-four hex digits alone", () => {
  assert.match(randomId(), /^[0-9a-f]{24}$/);
  assert.match(randomId(""), /^[0-9a-f]{24}$/);
});

test("ids are unique, five hundred minted in a row", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 500; i += 1) seen.add(randomId("itm"));
  assert.equal(seen.size, 500);
});

test("with no cryptographic generator, minting an id throws, and never falls back to Math.random", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  assert.ok(descriptor, "this Node has globalThis.crypto");
  const realRandom = Math.random;
  let randomCalls = 0;
  Math.random = () => {
    randomCalls += 1;
    return realRandom();
  };
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true, writable: true });
  try {
    assert.throws(() => randomId("itm"), {
      message: "randomId: no CSPRNG available (globalThis.crypto.getRandomValues)"
    });
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
    assert.throws(() => randomId("itm"), /no CSPRNG available/);
    assert.equal(randomCalls, 0, "Math.random was never read");
  } finally {
    Math.random = realRandom;
    Object.defineProperty(globalThis, "crypto", descriptor);
  }
  assert.match(randomId("itm"), /^itm_[0-9a-f]{24}$/, "the real generator is back");
});

test("nowIso is the current time as toISOString writes it", () => {
  const before = Date.now();
  const text = nowIso();
  const after = Date.now();
  assert.match(text, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const read = Date.parse(text);
  assert.ok(read >= before && read <= after, text);
  assert.equal(new Date(read).toISOString(), text);
});
