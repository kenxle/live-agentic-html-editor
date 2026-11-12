/*
 * read-when: Changing src/contract/utf8.ts, or the way a string is measured in bytes, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { FLUSH, fitsKeepalive } from "../../../src/contract/flush.ts";
import { utf8ByteLength } from "../../../src/contract/utf8.ts";

const encoder = new TextEncoder();

const CORPUS = [
  "",
  "x",
  "hello world",
  "\u00e9",
  "\u20ac",
  "\u{1F600}",
  "a\u00e9\u20ac\u{1F600}z",
  "\u007f",
  "\u0080",
  "\u07ff",
  "\u0800",
  "\uffff",
  "\u{10000}",
  "\u{10FFFF}",
  "\ud800",
  "\udfff",
  "a\ud800b",
  "\udc00\ud800",
  "\ud83d",
  "<p>\u4e2d\u6587 text</p>\n\tend"
];

test("known strings measure the bytes UTF-8 writes", () => {
  assert.equal(utf8ByteLength(""), 0);
  assert.equal(utf8ByteLength("x"), 1);
  assert.equal(utf8ByteLength("\u00e9"), 2);
  assert.equal(utf8ByteLength("\u20ac"), 3);
  assert.equal(utf8ByteLength("\u{1F600}"), 4);
});

test("a lone surrogate counts three bytes, as an encoder writes it as U+FFFD", () => {
  assert.equal(utf8ByteLength("\ud800"), 3);
  assert.equal(utf8ByteLength("\udfff"), 3);
});

test("the length agrees with TextEncoder at every boundary and over a mixed corpus", () => {
  for (const text of CORPUS) assert.equal(utf8ByteLength(text), encoder.encode(text).length, JSON.stringify(text));
});

test("the keepalive limit measures with the same count", () => {
  const threes = Math.floor(FLUSH.KEEPALIVE_MAX_BYTES / 3);
  assert.equal(fitsKeepalive("x".repeat(FLUSH.KEEPALIVE_MAX_BYTES)), true);
  assert.equal(fitsKeepalive("x".repeat(FLUSH.KEEPALIVE_MAX_BYTES + 1)), false);
  assert.equal(fitsKeepalive("\u20ac".repeat(threes) + "x"), true, "three-byte characters count three bytes each, to the limit");
  assert.equal(fitsKeepalive("\u20ac".repeat(threes) + "xx"), false, "and one byte past it is refused");
});
