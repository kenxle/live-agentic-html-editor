/*
 * read-when: Changing src/contract/flush.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { FLUSH, fitsKeepalive } from "../../../src/contract/flush.ts";

test("the flush policy is exactly these numbers and these immediate triggers", () => {
  assert.deepEqual(FLUSH, {
    HELPER_DEBOUNCE_MS: 750,
    DRAFT_FLOOR_MS: 10000,
    RUN_DRAFT_FLOOR_MS: 30000,
    PRESS_QUIET_MS: 3000,
    PRESS_CAP_MS: 10000,
    IMMEDIATE_ON: ["blur", "hide", "ready", "navigation", "unload"],
    KEEPALIVE_MAX_BYTES: 65536
  });
});

test("run records wait longer between drafts than other items do", () => {
  assert.equal(FLUSH.RUN_DRAFT_FLOOR_MS, 30000);
  assert.equal(FLUSH.DRAFT_FLOOR_MS, 10000);
});

test("a body of 65536 bytes fits the keepalive limit and one more does not", () => {
  assert.equal(fitsKeepalive("x".repeat(1000)), true);
  assert.equal(fitsKeepalive("x".repeat(65536)), true);
  assert.equal(fitsKeepalive("x".repeat(65537)), false);
  assert.equal(fitsKeepalive("x".repeat(70000)), false);
  assert.equal(fitsKeepalive(""), true);
});

test("text is measured in UTF-8 bytes, as a browser's encoder counts them", () => {
  assert.equal(fitsKeepalive("é".repeat(32768)), true, "two bytes each: exactly 65536");
  assert.equal(fitsKeepalive("é".repeat(32769)), false);
  assert.equal(fitsKeepalive("€".repeat(21845)), true, "three bytes each: 65535");
  assert.equal(fitsKeepalive("€".repeat(21846)), false);
  assert.equal(fitsKeepalive("😀".repeat(16384)), true, "four bytes each: exactly 65536");
  assert.equal(fitsKeepalive("😀".repeat(16385)), false);
  assert.equal(fitsKeepalive("x".repeat(65532) + "😀"), true, "an emoji after 65532 bytes ends on the limit");
  assert.equal(fitsKeepalive("x".repeat(65533) + "😀"), false);
});

test("a lone surrogate counts three bytes, because the encoder writes it as U+FFFD", () => {
  assert.equal(fitsKeepalive("x".repeat(65533) + "\ud800"), true);
  assert.equal(fitsKeepalive("x".repeat(65534) + "\ud800"), false);
  assert.equal(fitsKeepalive("x".repeat(65533) + "\udc00"), true);
  assert.equal(fitsKeepalive("x".repeat(65534) + "\udc00"), false);
});

test("a body that is not text is measured as the bytes of its JSON", () => {
  assert.equal(fitsKeepalive({ events: [] }), true);
  assert.equal(fitsKeepalive({ text: "x".repeat(65536) }), false);
  assert.equal(fitsKeepalive({ text: "x".repeat(65536 - '{"text":""}'.length) }), true);
  assert.equal(fitsKeepalive({ text: "x".repeat(65537 - '{"text":""}'.length) }), false);
  assert.equal(fitsKeepalive([1, 2, 3]), true);
  assert.equal(fitsKeepalive(null), true);
  assert.equal(fitsKeepalive(undefined), true);
});
