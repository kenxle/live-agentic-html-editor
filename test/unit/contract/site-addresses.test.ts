/*
 * read-when: Changing src/contract/site-addresses.ts, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HOST_FAMILY,
  PAGES,
  classifyHost,
  isSiteLabel,
  isSiteName,
  siteNameFromOrigin,
  siteOrigin
} from "../../../src/contract/site-addresses.ts";

const OPTIONS = { pagesPort: 1483 } as const;
const WITH_LAHE = { pagesPort: 1483, laheNames: true } as const;

test("the pages table is exactly this, and its reason strings are the words lahe status prints", () => {
  assert.deepEqual(PAGES, {
    PORT: 1483,
    PORT_ENV: "LAHE_PAGES_PORT",
    SUFFIX: "lahe.localhost",
    PRINTED_ENDING: "lahe.localhost",
    PRINTED_ENDING_REASON: "every browser treats .localhost names as this computer and as secure, with no setup",
    PORT_FREE_OFF_REASON: "the port-80 forward is not set up",
    LAHE_NAMES_OFF_REASON: "the .lahe option is not set up",
    LIBRARY_NAME: "library",
    MAX_LABELS: 4,
    LABEL_MAX: 63,
    NAME_MAX: 150,
    RESERVED_NAMES: ["library", "lahe", "www", "api"],
    MODE_SITES: "sites",
    CORP: "same-origin"
  });
});

test("a site label is 1 to 63 lowercase letters and digits in runs joined by single dashes", () => {
  for (const label of ["a", "a1", "my-site", "a".repeat(63), "0", "a-b-c", "1-2"]) {
    assert.equal(isSiteLabel(label), true, label);
  }
  for (const label of ["a".repeat(64), "-a", "a-", "a--b", "xn--abc", "A", "a_b", "a.b", "", "a b", "é", "a\n", "ab--", "--"]) {
    assert.equal(isSiteLabel(label), false, JSON.stringify(label));
  }
  for (const value of [5, null, undefined, ["a"], {}]) assert.equal(isSiteLabel(value), false, String(value));
});

test("a site name is one to four site labels joined by dots, at most 150 characters", () => {
  for (const name of ["a", "a.b", "a.b.c.d", "my-site.docs", "a".repeat(63)]) assert.equal(isSiteName(name), true, name);
  const longest = ["a".repeat(63), "b".repeat(63), "c".repeat(22)].join(".");
  assert.equal(longest.length, 150);
  assert.equal(isSiteName(longest), true);
  assert.equal(isSiteName(longest + "d"), false);
  for (const name of ["a.b.c.d.e", "a..b", "a.", ".a", "A.b", "", "a.b.", "a.-b", "a.b-"]) {
    assert.equal(isSiteName(name), false, JSON.stringify(name));
  }
  for (const value of [5, null, undefined, ["a"]]) assert.equal(isSiteName(value), false, String(value));
});

test("the four Host families are api, library, page and bad", () => {
  assert.deepEqual(HOST_FAMILY, { API: "api", LIBRARY: "library", PAGE: "page", BAD: "bad" });
});

test("a Host the helper's own address accepts is the api family, and carries no name", () => {
  for (const host of ["127.0.0.1:7817", "localhost", "[::1]:9", "127.0.0.1"]) {
    assert.deepEqual(classifyHost(host, OPTIONS), { family: "api" }, host);
  }
});

test("a .lahe.localhost Host is a page, the Library or bad, at the pages port or with no port", () => {
  assert.deepEqual(classifyHost("a.lahe.localhost", OPTIONS), { family: "page", name: "a" });
  assert.deepEqual(classifyHost("a.lahe.localhost:1483", OPTIONS), { family: "page", name: "a" });
  assert.deepEqual(classifyHost("a.b.c.d.lahe.localhost:1483", OPTIONS), { family: "page", name: "a.b.c.d" });
  assert.deepEqual(classifyHost("library.lahe.localhost", OPTIONS), { family: "library", name: "library" });
  assert.deepEqual(classifyHost("library.lahe.localhost:1483", OPTIONS), { family: "library", name: "library" });
});

test("another port is a bad Host, for the Library too", () => {
  for (const host of ["library.lahe.localhost:9999", "library.lahe.localhost:7817", "a.lahe.localhost:9999", "a.lahe.localhost:80"]) {
    assert.deepEqual(classifyHost(host, OPTIONS), { family: "bad" }, host);
  }
  assert.deepEqual(classifyHost("a.lahe.localhost:1483"), { family: "bad" }, "no pages port given: only the no-port form can match");
  assert.deepEqual(classifyHost("a.lahe.localhost"), { family: "page", name: "a" });
});

test("a .lahe Host is a page only once the .lahe check has passed, and never the Library", () => {
  assert.deepEqual(classifyHost("a.b.lahe", OPTIONS), { family: "bad" });
  assert.deepEqual(classifyHost("a.b.lahe", { pagesPort: 1483, laheNames: false }), { family: "bad" });
  assert.deepEqual(classifyHost("a.b.lahe", WITH_LAHE), { family: "page", name: "a.b" });
  assert.deepEqual(classifyHost("a.b.lahe:1483", WITH_LAHE), { family: "page", name: "a.b" });
  assert.deepEqual(classifyHost("a.b.lahe:9999", WITH_LAHE), { family: "bad" });
  assert.deepEqual(classifyHost("library.lahe", OPTIONS), { family: "bad" });
  assert.deepEqual(classifyHost("library.lahe", WITH_LAHE), { family: "bad" });
  assert.deepEqual(classifyHost("library.lahe:1483", WITH_LAHE), { family: "bad" });
});

test("every other Host is bad: a trailing dot, uppercase, too many labels, a foreign name, nothing, not text", () => {
  const bad = [
    "a.b.lahe.",
    "a.lahe.localhost.",
    "A.b.lahe",
    "A.lahe.localhost",
    "a.b.c.d.e.lahe.localhost",
    "a.b.c.d.e.lahe",
    "a.example.com",
    "lahe.localhost",
    "lahe",
    ".lahe.localhost",
    "a..b.lahe.localhost",
    "a.lahe.localhost.evil.com",
    "xn--a.lahe.localhost",
    "a--b.lahe.localhost",
    "LOCALHOST",
    ""
  ];
  for (const host of bad) assert.deepEqual(classifyHost(host, WITH_LAHE), { family: "bad" }, JSON.stringify(host));
  for (const host of [undefined, null, 5, ["a.lahe.localhost"], {}]) {
    assert.deepEqual(classifyHost(host, WITH_LAHE), { family: "bad" }, String(host));
  }
});

test("the api and bad results carry no name key at all", () => {
  assert.equal(Object.hasOwn(classifyHost("localhost", OPTIONS), "name"), false);
  assert.equal(Object.hasOwn(classifyHost("nope", OPTIONS), "name"), false);
});

test("a site's origin is http, its name, lahe.localhost and its port, with no port for 80", () => {
  assert.equal(siteOrigin("a.b", 1483), "http://a.b.lahe.localhost:1483");
  assert.equal(siteOrigin("docs", 80), "http://docs.lahe.localhost");
  assert.equal(siteOrigin("docs", 8080), "http://docs.lahe.localhost:8080");
});

test("an origin names its site at the pages port or with no port, and never otherwise", () => {
  assert.equal(siteNameFromOrigin("http://a.b.lahe.localhost", 1483), "a.b");
  assert.equal(siteNameFromOrigin("http://a.b.lahe.localhost:1483", 1483), "a.b");
  assert.equal(siteNameFromOrigin("http://a.b.lahe.localhost:9999", 1483), null);
  assert.equal(siteNameFromOrigin("https://a.b.lahe.localhost", 1483), null);
  assert.equal(siteNameFromOrigin("http://library.lahe.localhost", 1483), null, "never the Library");
  assert.equal(siteNameFromOrigin("http://A.b.lahe.localhost", 1483), null);
  assert.equal(siteNameFromOrigin("http://a.b.c.d.e.lahe.localhost", 1483), null);
  assert.equal(siteNameFromOrigin("http://a.b.lahe.localhost/", 1483), null);
  assert.equal(siteNameFromOrigin("http://a.b.lahe.localhost:1483/x", 1483), null);
  for (const value of [undefined, null, 5, ["http://a.lahe.localhost"]]) assert.equal(siteNameFromOrigin(value, 1483), null, String(value));
});

test("a .lahe origin names its site only once the .lahe check has passed, and never the Library", () => {
  assert.equal(siteNameFromOrigin("http://a.b.lahe", 1483), null);
  assert.equal(siteNameFromOrigin("http://a.b.lahe", 1483, false), null);
  assert.equal(siteNameFromOrigin("http://a.b.lahe", 1483, true), "a.b");
  assert.equal(siteNameFromOrigin("http://a.b.lahe:1483", 1483, true), "a.b");
  assert.equal(siteNameFromOrigin("http://a.b.lahe:9999", 1483, true), null);
  assert.equal(siteNameFromOrigin("http://library.lahe", 1483, true), null);
  assert.equal(siteNameFromOrigin("https://a.b.lahe", 1483, true), null);
  assert.equal(siteNameFromOrigin("http://a.b.lahe.localhost", 1483, true), "a.b");
});
