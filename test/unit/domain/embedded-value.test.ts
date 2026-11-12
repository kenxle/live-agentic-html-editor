/*
 * read-when: Changing src/domain/embedded-value.ts, or when one of these tests fails.
 * not-for: How a record stores an embedded value once and refers to it; see the oversized-records feature folder.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { embeddedName, isEmbeddedValue } from "../../../src/domain/embedded-value.ts";

test("a value is embedded when it starts with data: in any letter case, after any leading whitespace", () => {
  assert.equal(isEmbeddedValue(" DATA:x"), true);
  assert.equal(isEmbeddedValue("data:image/png;base64,AAAA"), true);
  assert.equal(isEmbeddedValue("\n\tData:,x"), true);
  assert.equal(isEmbeddedValue("https://x/y.png"), false);
  assert.equal(isEmbeddedValue("x data:y"), false);
  assert.equal(isEmbeddedValue(""), false);
});

test("a value that is not embedded keeps its own name", () => {
  assert.equal(embeddedName("https://x/y.png"), "https://x/y.png");
  assert.equal(embeddedName(""), "");
});

test("an embedded value is named by its media type, its length and a 64-bit digest, and the names are pinned", () => {
  assert.equal(embeddedName("data:image/png;base64,AAAA"), "embedded:image/png;base64:26:21d9003773dfa10b");
  assert.equal(embeddedName("  data:image/png;base64,AAAA"), "embedded:image/png;base64:26:21d9003773dfa10b");
  assert.equal(embeddedName("data:abc"), "embedded::8:a0ce84f82dbf3642");
  assert.equal(embeddedName("data:,x"), "embedded::7:03e93c54159aab40");
  assert.equal(embeddedName("data:image/svg+xml,<svg/>"), "embedded:image/svg+xml:25:4c06c0ac12134308");
});

test("the media type is the text before the first comma", () => {
  assert.match(embeddedName("data:text/plain,a,b"), /^embedded:text\/plain:19:[0-9a-f]{16}$/);
});

test("two values of one size and type get different names, and one value always gets one name", () => {
  const a = embeddedName("data:image/png;base64,AAAA");
  const b = embeddedName("data:image/png;base64,AAAB");
  assert.notEqual(a, b);
  assert.equal(embeddedName("data:image/png;base64,AAAB"), b);
  assert.match(a, /^embedded:image\/png;base64:26:[0-9a-f]{16}$/);
});

test("the length counts UTF-16 code units, so the browser and Node agree", () => {
  assert.match(embeddedName("data:text/plain,\u{1F600}"), /^embedded:text\/plain:18:[0-9a-f]{16}$/);
});
