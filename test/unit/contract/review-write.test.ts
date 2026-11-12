/*
 * read-when: Changing src/contract/review-write.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOOPBACK_ORIGIN_HOSTS,
  ORIGIN_LIMIT,
  acceptsNotesFlag,
  isRegisterableOrigin
} from "../../../src/contract/review-write.ts";
import { label } from "./support/untyped.ts";

test("a review write accepts origins on three loopback hosts, at most 16 of them", () => {
  assert.deepEqual(LOOPBACK_ORIGIN_HOSTS, ["localhost", "127.0.0.1", "[::1]"]);
  assert.equal(ORIGIN_LIMIT, 16);
});

test("the string null and a loopback http or https origin written as a browser writes it are registerable", () => {
  const registerable = [
    "null",
    "http://localhost:3000",
    "https://127.0.0.1:8443",
    "http://[::1]:5000",
    "http://localhost",
    "https://localhost",
    "http://localhost:0",
    "http://127.0.0.1:7817",
    "http://localhost:65535",
    "http://localhost:81",
    "https://localhost:80",
    "http://localhost:443"
  ];
  for (const origin of registerable) assert.equal(isRegisterableOrigin(origin), true, origin);
});

test("anything after the origin is refused: a path, a query, a fragment, credentials", () => {
  const refused = [
    "http://localhost:3000/",
    "http://localhost:3000/x",
    "http://localhost:3000?",
    "http://localhost:3000?a=1",
    "http://localhost:3000#",
    "http://localhost:3000#x",
    "http://u:p@localhost:3000",
    "http://u@localhost:3000",
    "http://localhost:3000 ",
    " http://localhost:3000",
    "http://localhost:3000\n"
  ];
  for (const origin of refused) assert.equal(isRegisterableOrigin(origin), false, JSON.stringify(origin));
});

test("an origin a browser would never send is refused: a default port, leading zeros, a huge or empty port, other case", () => {
  const refused = [
    "http://localhost:80",
    "https://localhost:443",
    "http://localhost:03000",
    "http://localhost:00",
    "http://localhost:65536",
    "http://localhost:999999",
    "http://localhost:",
    "HTTP://localhost:3000",
    "Http://localhost:3000",
    "http://LOCALHOST:3000",
    "http://127.0.0.1:-1",
    "http://127.0.0.1:1e3",
    "http://localhost:3000:3000"
  ];
  for (const origin of refused) assert.equal(isRegisterableOrigin(origin), false, origin);
});

test("an origin on a host that is not exactly loopback, or on another scheme, is refused", () => {
  const refused = [
    "http://127.1:3000",
    "http://0.0.0.0:3000",
    "http://127.0.0.2:3000",
    "http://[::2]:3000",
    "http://::1:3000",
    "http://localhost.evil.example",
    "http://evil.example",
    "http://evil.example:3000",
    "ftp://localhost",
    "file://localhost",
    "ws://localhost:3000",
    "localhost:3000",
    "//localhost:3000",
    "NULL",
    "null ",
    ""
  ];
  for (const origin of refused) assert.equal(isRegisterableOrigin(origin), false, JSON.stringify(origin));
});

test("an origin that is not text is refused", () => {
  for (const origin of [3000, null, undefined, {}, ["null"], true]) assert.equal(isRegisterableOrigin(origin), false, label(origin));
});

test("a review write marks a notes review only with the boolean true", () => {
  assert.equal(acceptsNotesFlag({ notes: true }), true);
  assert.equal(acceptsNotesFlag({ notes: true, review: "rev_a" }), true);
  for (const body of [{ notes: "true" }, { notes: 1 }, { notes: false }, { notes: null }, {}, null, undefined, "notes", ["notes"], 1]) {
    assert.equal(acceptsNotesFlag(body), false, JSON.stringify(body));
  }
});
