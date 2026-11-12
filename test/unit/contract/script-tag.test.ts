/*
 * read-when: Changing src/contract/script-tag.ts, the script tag lahe add writes, or when one of these tests fails.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALIAS_MAX,
  DOCUMENT_ON,
  FRAMES_ALLOW,
  NOTES_ON,
  SCRIPT_ATTR,
  SCRIPT_FALLBACK_ONERROR,
  SCRIPT_SELECTOR,
  START_HIDDEN,
  isLoopbackPortOrigin,
  isPathAlias,
  isSpelling,
  isSpellingOrigin,
  scriptTag
} from "../../../src/contract/script-tag.ts";
import { callUntyped, safeId } from "./support/untyped.ts";

const REVIEW = safeId("rev_a");
const SRC = "http://127.0.0.1:7817/lahe-layer.js";

test("the script attributes, the selector and the opt-in values are exactly these", () => {
  assert.deepEqual(SCRIPT_ATTR, {
    REVIEW: "data-lahe-review",
    TOKEN: "data-lahe-token",
    HELPER: "data-lahe-helper",
    FALLBACK: "data-lahe-fallback",
    FRAMES: "data-lahe-frames",
    START: "data-lahe-start",
    NOTES: "data-lahe-notes",
    DOCUMENT: "data-lahe-document",
    ALIASES: "data-lahe-aliases",
    PATH_ALIASES: "data-lahe-path-aliases",
    SPELLINGS: "data-lahe-spellings"
  });
  assert.equal(SCRIPT_SELECTOR, "script[data-lahe-review]");
  assert.equal(FRAMES_ALLOW, "allow");
  assert.equal(START_HIDDEN, "hidden");
  assert.equal(NOTES_ON, "true");
  assert.equal(DOCUMENT_ON, "true");
  assert.equal(ALIAS_MAX, 16);
});

test("the fallback onerror text is exactly this, and holds no > and no double quote", () => {
  assert.equal(
    SCRIPT_FALLBACK_ONERROR,
    "var s=document.createElement('script');s.src=this.getAttribute('data-lahe-fallback');document.head.appendChild(s)"
  );
  assert.equal(SCRIPT_FALLBACK_ONERROR.indexOf(">"), -1);
  assert.equal(SCRIPT_FALLBACK_ONERROR.indexOf('"'), -1);
});

test("the script tag has the pinned attributes and the fixed default helper", () => {
  const tag = scriptTag({ src: "/lahe/lahe-layer.js", review: REVIEW, token: "tok_abc" });
  assert.equal(
    tag,
    '<script src="/lahe/lahe-layer.js"\n' +
      '        data-lahe-review="rev_a"\n' +
      '        data-lahe-token="tok_abc"\n' +
      '        data-lahe-helper="http://127.0.0.1:7817"\n' +
      "        defer></script>"
  );
  assert.equal(tag.includes("onerror"), false, "no fallback asked for, no fallback written");
  assert.equal(tag.includes(SCRIPT_ATTR.FALLBACK), false);
  const named = scriptTag({ src: SRC, review: REVIEW, token: "tok_abc", helper: "http://localhost:9000" });
  assert.equal(named.includes('data-lahe-helper="http://localhost:9000"'), true);
});

test("the script tag carries the offline fallback when one is named, byte for byte", () => {
  const tag = scriptTag({ src: SRC, review: REVIEW, token: "tok_abc", fallback: "lahe-layer.js" });
  assert.equal(
    tag,
    '<script src="http://127.0.0.1:7817/lahe-layer.js"\n' +
      '        data-lahe-review="rev_a"\n' +
      '        data-lahe-token="tok_abc"\n' +
      '        data-lahe-helper="http://127.0.0.1:7817"\n' +
      '        data-lahe-fallback="lahe-layer.js"\n' +
      "        onerror=\"var s=document.createElement('script');s.src=this.getAttribute('data-lahe-fallback');document.head.appendChild(s)\"\n" +
      "        defer></script>"
  );
  assert.equal(tag.includes(SCRIPT_FALLBACK_ONERROR), true);
  assert.equal(scriptTag({ src: SRC, review: REVIEW, token: "t", fallback: "" }).includes("onerror"), false, "an empty fallback is no fallback");
});

test("every attribute, in order, one per line after eight spaces", () => {
  const tag = scriptTag({
    src: SRC,
    review: REVIEW,
    token: "tok_abc",
    helper: "http://127.0.0.1:7817",
    fallback: "lahe-layer.js",
    notes: true,
    document: true,
    aliases: ["http://127.0.0.1:51001", "http://localhost:51001"],
    pathAliases: ["/old/a.html"],
    spellings: ["http://a.lahe.localhost:1483 /doc.md"]
  });
  const lines = tag.split("\n");
  assert.deepEqual(lines, [
    '<script src="http://127.0.0.1:7817/lahe-layer.js"',
    '        data-lahe-review="rev_a"',
    '        data-lahe-token="tok_abc"',
    '        data-lahe-helper="http://127.0.0.1:7817"',
    '        data-lahe-fallback="lahe-layer.js"',
    "        onerror=\"" + SCRIPT_FALLBACK_ONERROR + '"',
    '        data-lahe-notes="true"',
    '        data-lahe-document="true"',
    '        data-lahe-aliases="[&quot;http://127.0.0.1:51001&quot;,&quot;http://localhost:51001&quot;]"',
    '        data-lahe-path-aliases="[&quot;/old/a.html&quot;]"',
    '        data-lahe-spellings="[&quot;http://a.lahe.localhost:1483 /doc.md&quot;]"',
    "        defer></script>"
  ]);
});

test("the notes and document attributes are written only when asked for with the boolean true", () => {
  const plain = scriptTag({ src: SRC, review: REVIEW, token: "t" });
  assert.equal(plain.includes("data-lahe-notes"), false);
  assert.equal(plain.includes("data-lahe-document"), false);
  assert.equal(scriptTag({ src: SRC, review: REVIEW, token: "t", notes: false }).includes("data-lahe-notes"), false);
  assert.equal(scriptTag({ src: SRC, review: REVIEW, token: "t", document: false }).includes("data-lahe-document"), false);
  assert.equal(scriptTag({ src: SRC, review: REVIEW, token: "t", notes: true }).includes('data-lahe-notes="true"'), true);
  assert.equal(scriptTag({ src: SRC, review: REVIEW, token: "t", document: true }).includes('data-lahe-document="true"'), true);
  assert.equal(callUntyped(scriptTag, { src: SRC, review: "rev_a", token: "t", notes: "true", document: 1 }), plain, "only the boolean true counts");
});

test("a list attribute is written when the list is given, even empty, and not otherwise", () => {
  const none = scriptTag({ src: SRC, review: REVIEW, token: "t" });
  assert.equal(none.includes("aliases"), false);
  assert.equal(none.includes("spellings"), false);
  assert.equal(scriptTag({ src: SRC, review: REVIEW, token: "t", aliases: [] }).includes('data-lahe-aliases="[]"'), true);
  assert.equal(scriptTag({ src: SRC, review: REVIEW, token: "t", pathAliases: [] }).includes('data-lahe-path-aliases="[]"'), true);
  assert.equal(scriptTag({ src: SRC, review: REVIEW, token: "t", spellings: [] }).includes('data-lahe-spellings="[]"'), true);
});

test("the JSON lists are written with ampersand, double quote, less-than and greater-than as entities", () => {
  const tag = scriptTag({
    src: SRC,
    review: REVIEW,
    token: "t",
    aliases: ["http://127.0.0.1:51001", "http://localhost:51001"],
    pathAliases: ["/a&b/c.html"],
    spellings: ["http://a.b.lahe.localhost:1483 /x&y.md"]
  });
  assert.equal(tag.includes('data-lahe-aliases="[&quot;http://127.0.0.1:51001&quot;,&quot;http://localhost:51001&quot;]"'), true);
  assert.equal(tag.includes('data-lahe-path-aliases="[&quot;/a&amp;b/c.html&quot;]"'), true);
  assert.equal(tag.includes('data-lahe-spellings="[&quot;http://a.b.lahe.localhost:1483 /x&amp;y.md&quot;]"'), true);
  const attributes = tag.split("\n").filter((entry) => entry.includes("-aliases=") || entry.includes("-spellings="));
  for (const attribute of attributes) {
    const value = attribute.slice(attribute.indexOf('="') + 2, -1);
    assert.equal(/["<>]/.test(value), false, attribute);
  }
});

test("a script tag without src, token or a safe review id is refused before anything is written, with these messages", () => {
  const good = { src: SRC, review: "rev_a", token: "tok" };
  const refuse = (changes: Readonly<Record<string, unknown>>, message: string): void => {
    assert.throws(() => callUntyped(scriptTag, { ...good, ...changes }), { message }, message);
  };
  refuse({ src: undefined }, "scriptTag: src is required (the path to the built library)");
  refuse({ src: "" }, "scriptTag: src is required (the path to the built library)");
  refuse({ review: "../etc" }, "scriptTag: review must be a safe id");
  refuse({ review: undefined }, "scriptTag: review must be a safe id");
  refuse({ token: undefined }, "scriptTag: token is required; absent configuration fails closed");
  refuse({ token: "" }, "scriptTag: token is required; absent configuration fails closed");
  assert.throws(() => scriptTag({ src: "x.js", review: REVIEW, token: "" }), /token/);
  assert.throws(() => callUntyped(scriptTag, { src: "x.js", review: "../etc", token: "t" }), /safe id/);
});

test("a list that is not a list, is too long, or holds a member that fails its check is refused with these messages", () => {
  const good = { src: SRC, review: "rev_a", token: "tok" };
  const refuse = (changes: Readonly<Record<string, unknown>>, message: string): void => {
    assert.throws(() => callUntyped(scriptTag, { ...good, ...changes }), { message }, message);
  };
  const seventeen = (member: string): string[] => Array.from({ length: 17 }, () => member);
  refuse({ aliases: "http://127.0.0.1:1" }, "scriptTag: aliases must be a list");
  refuse({ aliases: seventeen("http://127.0.0.1:1") }, "scriptTag: at most 16 aliases");
  refuse({ aliases: ["https://127.0.0.1:1"] }, 'scriptTag: an alias must be a loopback http origin, not "https://127.0.0.1:1"');
  refuse({ aliases: ["http://127.0.0.1:1", 5] }, "scriptTag: an alias must be a loopback http origin, not 5");
  refuse({ pathAliases: "/a" }, "scriptTag: pathAliases must be a list");
  refuse({ pathAliases: seventeen("/a") }, "scriptTag: at most 16 path aliases");
  refuse({ pathAliases: ["a"] }, 'scriptTag: a path alias must be an absolute path, not "a"');
  refuse({ pathAliases: ['/a"b'] }, 'scriptTag: a path alias must be an absolute path, not "/a\\"b"');
  refuse({ spellings: "x" }, "scriptTag: spellings must be a list");
  refuse({ spellings: seventeen("http://a /x") }, "scriptTag: at most 16 spellings");
  refuse({ spellings: [" /doc.md"] }, 'scriptTag: a spelling is "origin path", not " /doc.md"');
  const sixteen = (member: string): string[] => Array.from({ length: 16 }, () => member);
  assert.equal(typeof callUntyped(scriptTag, { ...good, aliases: sixteen("http://127.0.0.1:1") }), "string");
  assert.equal(typeof callUntyped(scriptTag, { ...good, pathAliases: sixteen("/a") }), "string");
  assert.equal(typeof callUntyped(scriptTag, { ...good, spellings: sixteen("http://a /x") }), "string");
});

test("a loopback port origin is http on 127.0.0.1 or localhost with a port of 1 to 5 digits", () => {
  for (const value of ["http://127.0.0.1:1", "http://localhost:51001", "http://127.0.0.1:00000", "http://localhost:99999"]) {
    assert.equal(isLoopbackPortOrigin(value), true, value);
  }
  const refused = ["https://127.0.0.1:1", "http://[::1]:1", "http://127.0.0.1", "http://localhost", "http://127.0.0.1:123456", "http://127.0.0.1:", "http://127.0.0.1:1/", "http://localhost:1/x", "HTTP://localhost:1", "http://LOCALHOST:1", "http://127.0.0.1:1 ", "http://127.0.0.1:a"];
  for (const value of refused) assert.equal(isLoopbackPortOrigin(value), false, value);
  for (const value of [undefined, null, 5, ["http://localhost:1"]]) assert.equal(isLoopbackPortOrigin(value), false, String(value));
});

test("a path alias is a slash and up to 511 characters, none a quote, an angle bracket, a backslash or white space", () => {
  for (const value of ["/", "/a/b-c.html", "/" + "a".repeat(511), "/a&b", "/é", "/a%20b"]) assert.equal(isPathAlias(value), true, value.slice(0, 20));
  for (const value of ["a", "", "/a b", '/a"b', "/a'b", "/a<b", "/a>b", "/a\\b", "/a\nb", "/a\tb", "/" + "a".repeat(512)]) {
    assert.equal(isPathAlias(value), false, JSON.stringify(value.slice(0, 20)));
  }
  assert.equal(isPathAlias("/" + "a".repeat(512)), false, "a 513-character path is refused");
  for (const value of [undefined, null, 5, ["/a"]]) assert.equal(isPathAlias(value), false, String(value));
});

test("a spelling origin is http and 1 to 253 of lowercase letters, digits, dots and dashes, with an optional port", () => {
  for (const value of ["http://a", "http://a.lahe.localhost:1483", "http://" + "a".repeat(253), "http://127.0.0.1:51001", "http://a-b.c"]) {
    assert.equal(isSpellingOrigin(value), true, value.slice(0, 30));
  }
  for (const value of ["http://", "http://" + "a".repeat(254), "https://a", "http://A", "http://a:", "http://a:123456", "http://a/", "http://a b", "http://a_b", "a"]) {
    assert.equal(isSpellingOrigin(value), false, value.slice(0, 30));
  }
  for (const value of [undefined, null, 5]) assert.equal(isSpellingOrigin(value), false, String(value));
});

test("a spelling is an origin and a path, split at the first space", () => {
  assert.equal(isSpelling("http://a.lahe.localhost:1483 /doc.md"), true);
  assert.equal(isSpelling("http://a /"), true);
  for (const value of [" /doc.md", "http://a /x y", "https://a /x", "http://a", "http://a x", "http://a ", "", "/doc.md http://a", "http://a  /x"]) {
    assert.equal(isSpelling(value), false, JSON.stringify(value));
  }
  for (const value of [undefined, null, 5, ["http://a /x"]]) assert.equal(isSpelling(value), false, String(value));
});
