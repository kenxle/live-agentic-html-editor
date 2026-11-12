/*
 * read-when: Changing src/contract/helper-address.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_HELPER_ORIGIN, DEFAULT_HOST, DEFAULT_PORT, hostAllowed } from "../../../src/contract/helper-address.ts";

test("the helper listens on 127.0.0.1 port 7817 unless told otherwise", () => {
  assert.equal(DEFAULT_PORT, 7817);
  assert.equal(DEFAULT_HOST, "127.0.0.1");
  assert.equal(DEFAULT_HELPER_ORIGIN, "http://127.0.0.1:7817");
});

test("a Host naming the helper passes, at any port", () => {
  for (const host of ["127.0.0.1:7817", "127.0.0.1", "localhost", "localhost:1", "localhost:99999", "[::1]", "[::1]:9", "[::1]:7817"]) {
    assert.equal(hostAllowed(host), true, host);
  }
});

test("a Host naming anything else is refused: a rebound name, a lookalike, another case, a bare IPv6 address", () => {
  const refused = [
    "::1",
    "LOCALHOST",
    "Localhost:7817",
    "evil.example.com",
    "evil.example.com:7817",
    "127.0.0.1.nip.io:7817",
    "library.lahe.localhost",
    "a.lahe.localhost:1483",
    "localhost.evil.com",
    "127.0.0.2",
    "localhost:",
    "localhost:80x",
    "localhost:80:80",
    " localhost",
    ""
  ];
  for (const host of refused) assert.equal(hostAllowed(host), false, JSON.stringify(host));
});

test("a Host header that is missing or is not one string is refused", () => {
  for (const host of [undefined, null, ["localhost"], 7817, {}]) assert.equal(hostAllowed(host), false, String(host));
});
