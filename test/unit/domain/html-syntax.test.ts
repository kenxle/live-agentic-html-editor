/*
 * read-when: Changing src/domain/html-syntax.ts, or when one of these tests fails.
 * not-for: What cleaning does with a tag once it is read; see clean-markup.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BLOCK_TAGS,
  DROP_SUBTREE_TAGS,
  breakOfTag,
  decodeEntities,
  escapeAttrValue,
  isBlockTag,
  isDroppedSubtreeTag,
  isVoidTag,
  isWhitespacePreservingTag,
  nbspToSpace,
  readTag,
  skipDeclaration,
  tokenizeMarkup
} from "../../../src/domain/html-syntax.ts";
import type { TagToken } from "../../../src/domain/html-syntax.ts";

function startTag(token: TagToken | null): Extract<TagToken, { readonly kind: "start" }> {
  assert.ok(token !== null && token.kind === "start");
  return token;
}

test("a tag starts with a less-than sign and an ASCII letter, and anything else is text", () => {
  assert.equal(readTag("a < b", 2), null);
  assert.equal(readTag("<2 and", 0), null);
  assert.equal(readTag("<!-- x -->", 0), null);
  assert.equal(readTag("<?x?>", 0), null);
  assert.equal(readTag("</ p>", 0), null);
  assert.equal(readTag("</2>", 0), null);
  assert.equal(readTag("<", 0), null);
  assert.equal(readTag("<\u00E9>", 0), null);
  assert.equal(readTag("a <b> c", 2)?.kind, "start");
  assert.equal(readTag("</p>", 0)?.kind, "end");
});

test("the tag name is the longest run of name characters, lowercased", () => {
  assert.equal(readTag("<DIV-x:y_z9 class=a>", 0)?.name, "div-x:y_z9");
  assert.equal(readTag("<P>", 0)?.name, "p");
  assert.equal(readTag("</SPAN>", 0)?.name, "span");
  assert.equal(readTag("<h2.x>", 0)?.name, "h2");
});

test("end is the index just past the closing angle bracket, or the length when none follows", () => {
  assert.equal(readTag("<p>text", 0)?.end, 3);
  assert.equal(readTag("ab<p class=x>text", 2)?.end, 13);
  assert.equal(readTag("<p class=a", 0)?.end, 10);
  assert.equal(readTag("</p", 0)?.end, 3);
  assert.equal(readTag("<a title=\"unfinished", 0)?.end, 20);
});

test("a start tag's attributes come back in source order, duplicates included, with lowercased names", () => {
  const tag = startTag(readTag("<a HREF=\"/x\" title='y' data-x=z disabled id=\"a\" id=\"b\">", 0));
  assert.deepEqual(tag.attributes, [
    { name: "href", value: "/x" },
    { name: "title", value: "y" },
    { name: "data-x", value: "z" },
    { name: "disabled", value: "" },
    { name: "id", value: "a" },
    { name: "id", value: "b" }
  ]);
  assert.equal(tag.selfClosing, false);
});

test("an attribute name ends at whitespace, an equals sign, a slash or a closing bracket", () => {
  const tag = startTag(readTag("<input a=1 b = 2 c/>", 0));
  assert.deepEqual(tag.attributes, [
    { name: "a", value: "1" },
    { name: "b", value: "2" },
    { name: "c", value: "" }
  ]);
  assert.equal(tag.selfClosing, true);
});

test("an unquoted value ends at whitespace or a closing bracket, and a quoted one may hold either", () => {
  const unquoted = startTag(readTag("<a href=/x/y title=t>", 0));
  assert.deepEqual(unquoted.attributes, [
    { name: "href", value: "/x/y" },
    { name: "title", value: "t" }
  ]);
  const quoted = startTag(readTag("<a title=\"a > b  c\">", 0));
  assert.deepEqual(quoted.attributes, [{ name: "title", value: "a > b  c" }]);
});

test("a quoted value missing its closing quote runs to the end of the input", () => {
  const tag = startTag(readTag("<a title=\"abc", 0));
  assert.deepEqual(tag.attributes, [{ name: "title", value: "abc" }]);
  assert.equal(tag.end, 13);
});

test("character references in a value are resolved once when the tag is read", () => {
  const tag = startTag(readTag("<a href=\"/a?x=1&amp;y=2\" title=\"a&quot;b&lt;&#65;&bogus;\">", 0));
  assert.deepEqual(tag.attributes, [
    { name: "href", value: "/a?x=1&y=2" },
    { name: "title", value: "a\"b<A&bogus;" }
  ]);
});

test("a start tag ending in a slash reports selfClosing", () => {
  assert.equal(startTag(readTag("<br/>", 0)).selfClosing, true);
  assert.equal(startTag(readTag("<br />", 0)).selfClosing, true);
  assert.equal(startTag(readTag("<br>", 0)).selfClosing, false);
});

test("an end tag reports its name and end only, and anything before its bracket is ignored", () => {
  assert.deepEqual(readTag("</p foo=\"bar\">x", 0), { kind: "end", name: "p", end: 14 });
  assert.deepEqual(readTag("</P>", 0), { kind: "end", name: "p", end: 4 });
});

test("decodeEntities resolves the named and numeric references it knows and leaves the rest as written", () => {
  assert.equal(
    decodeEntities("&amp;&LT;&nbsp;&#65;&#x41;&#0;&#x110000;&bogus;&apos;&quot;&gt;&AMP;"),
    "&<\u00A0AA&#0;&#x110000;&bogus;'\">&"
  );
  assert.equal(decodeEntities("&#X41;&#x1F600;"), "A\u{1F600}");
});

test("decodeEntities requires the semicolon and resolves only once", () => {
  assert.equal(decodeEntities("&amp &#65 &lt"), "&amp &#65 &lt");
  assert.equal(decodeEntities("&amp;lt;"), "&lt;");
  assert.equal(decodeEntities("&#99999999999999999999;"), "&#99999999999999999999;");
});

test("escapeAttrValue escapes the four characters an attribute value cannot hold and leaves an apostrophe", () => {
  assert.equal(escapeAttrValue("a&\"<>'b"), "a&amp;&quot;&lt;&gt;'b");
});

test("BLOCK_TAGS is the 39 names the text readers treat as blocks, in order", () => {
  assert.deepEqual(
    [...BLOCK_TAGS],
    (
      "address article aside blockquote dd details div dl dt fieldset figcaption figure footer form " +
      "h1 h2 h3 h4 h5 h6 header hgroup hr li main nav ol p pre section summary table tbody td tfoot th thead tr ul"
    ).split(" ")
  );
  assert.equal(BLOCK_TAGS.length, 39);
});

test("isBlockTag is true for exactly the lowercase block names", () => {
  for (const name of BLOCK_TAGS) assert.equal(isBlockTag(name), true, name);
  for (const name of ["P", "span", "strong", "br", "img", "constructor", "toString", "__proto__", ""]) {
    assert.equal(isBlockTag(name), false, name);
  }
});

test("the dropped-subtree, void and whitespace-preserving tags are exactly their lists", () => {
  assert.deepEqual([...DROP_SUBTREE_TAGS], ["script", "style", "template", "noscript", "iframe", "object", "embed", "applet", "frame", "frameset"]);
  for (const name of DROP_SUBTREE_TAGS) assert.equal(isDroppedSubtreeTag(name), true, name);
  for (const name of ["SCRIPT", "span", "head", "constructor"]) assert.equal(isDroppedSubtreeTag(name), false, name);

  const voids = "area base br col embed hr img input link meta param source track wbr".split(" ");
  for (const name of voids) assert.equal(isVoidTag(name), true, name);
  for (const name of ["p", "span", "BR", "constructor"]) assert.equal(isVoidTag(name), false, name);

  assert.equal(isWhitespacePreservingTag("pre"), true);
  assert.equal(isWhitespacePreservingTag("textarea"), true);
  for (const name of ["code", "PRE", "p", "constructor"]) assert.equal(isWhitespacePreservingTag(name), false, name);
});

test("tokenizeMarkup splits markup into text and tags, and keeps a less-than sign that starts no tag as text", () => {
  const html = "a<b>c</b> < d<2 e";
  const tokens = tokenizeMarkup(html);
  assert.equal(
    tokens.map((token) => (token.kind === "text" ? token.text : token.source)).join(""),
    html
  );
  const tags = tokens.flatMap((token) => (token.kind === "tag" ? [token.source] : []));
  assert.deepEqual(tags, ["<b>", "</b>"]);
  const names = tokens.flatMap((token) => (token.kind === "tag" ? [token.tag.kind + ":" + token.tag.name] : []));
  assert.deepEqual(names, ["start:b", "end:b"]);
  assert.deepEqual(tokenizeMarkup(""), []);
});

test("skipDeclaration returns the index after a comment, declaration or instruction, and null for anything else", () => {
  assert.equal(skipDeclaration("<!-- x -->b", 0), 10);
  assert.equal(skipDeclaration("a<!-- x -->b", 1), 11);
  assert.equal(skipDeclaration("<!-- never closed", 0), 17);
  assert.equal(skipDeclaration("<!DOCTYPE html>x", 0), 15);
  assert.equal(skipDeclaration("<?x?>y", 0), 5);
  assert.equal(skipDeclaration("<! never closed", 0), 15);
  assert.equal(skipDeclaration("<p>", 0), null);
  assert.equal(skipDeclaration("< p>", 0), null);
});

test("nbspToSpace turns every spelling of a no-break space into a plain space", () => {
  assert.equal(nbspToSpace("a&nbsp;b&NBSP;c&#160;d&#xa0;e&#xA0;f&#XA0;g"), "a b c d e f g");
  assert.equal(nbspToSpace("&amp;nbsp; &nbsp &#16;"), "&amp;nbsp; &nbsp &#16;");
});

test("breakOfTag gives a line break for br, a blank line for a block element and nothing for the rest", () => {
  assert.equal(breakOfTag("br"), "\n");
  for (const name of BLOCK_TAGS) assert.equal(breakOfTag(name), "\n\n", name);
  for (const name of ["span", "strong", "img", "BR", "constructor", ""]) assert.equal(breakOfTag(name), "", name);
});
