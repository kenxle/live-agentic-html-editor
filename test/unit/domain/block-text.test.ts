/*
 * read-when: Changing src/domain/block-text.ts, or when one of these tests fails.
 * not-for: Which of two texts count as the same edit; see comparison.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { blockText, blockTextFromNode, textOf, topLevelBlocks } from "../../../src/domain/block-text.ts";
import type { TextSourceNode } from "../../../src/domain/block-text.ts";

const ELEMENT = 1;
const TEXT = 3;
const CDATA = 4;
const COMMENT = 8;
const DOCUMENT = 9;
const FRAGMENT = 11;

function link(nodes: readonly TextSourceNode[]): TextSourceNode | null {
  let next: TextSourceNode | null = null;
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    const node = nodes[index];
    if (node === undefined) continue;
    next = { ...node, nextSibling: next };
  }
  return next;
}

function text(data: string): TextSourceNode {
  return { nodeType: TEXT, data };
}

function valueText(nodeValue: string): TextSourceNode {
  return { nodeType: TEXT, nodeValue };
}

function el(tagName: string, ...children: readonly (TextSourceNode | string)[]): TextSourceNode {
  const nodes = children.map((child) => (typeof child === "string" ? text(child) : child));
  return { nodeType: ELEMENT, tagName, firstChild: link(nodes) };
}

function container(nodeType: number, ...children: readonly (TextSourceNode | string)[]): TextSourceNode {
  const nodes = children.map((child) => (typeof child === "string" ? text(child) : child));
  return { nodeType, firstChild: link(nodes) };
}

function chrome(tagName: string, ...children: readonly (TextSourceNode | string)[]): TextSourceNode {
  const nodes = children.map((child) => (typeof child === "string" ? text(child) : child));
  return {
    nodeType: ELEMENT,
    tagName,
    firstChild: link(nodes),
    getAttribute: (name: string) => (name === "data-lahe" ? "chrome" : null)
  };
}

test("blockText reads a break off the markup in each shape a browser writes it", () => {
  assert.equal(blockText("Hello<p>&nbsp;world.</p>"), "Hello\n\nworld.");
  assert.equal(blockText("Hello<br>&nbsp;world."), "Hello\nworld.");
  assert.equal(blockText("Hello world.<p>Second para.</p>"), "Hello world.\n\nSecond para.");
  assert.equal(blockText("<p>a</p><p>b</p>"), "a\n\nb");
  assert.equal(blockText("<ul><li>one</li><li>two</li></ul>"), "one\n\ntwo");
  assert.equal(blockText("<table><tr><td>a</td><td>b</td></tr></table>"), "a\n\nb");
  assert.equal(blockText("a<hr>b"), "a\n\nb");
  assert.equal(blockText("a<br><br><br>b"), "a\n\nb");
});

test("blockText folds the whitespace a source carries, and only that", () => {
  assert.equal(blockText("<p>Hello\n   world.</p>"), "Hello world.");
  assert.equal(blockText("<p>Hello    world.</p>"), "Hello world.");
  assert.equal(blockText("<p>Hello\nworld.</p>"), "Hello world.");
  assert.notEqual(blockText("<p>Hello<br>world.</p>"), blockText("<p>Hello world.</p>"));
  assert.equal(blockText("a\nb"), "a b");
});

test("blockText keeps the whitespace inside a pre, where it is content", () => {
  assert.equal(blockText("<pre>line one\n   indented</pre>"), "line one\n   indented");
  assert.equal(blockText("<p>a   b</p><pre>c   d</pre>"), "a b\n\nc   d");
  assert.equal(blockText("<pre>col1\tcol2\n\tindented</pre>"), "col1\tcol2\n\tindented");
  assert.equal(textOf("<pre>col1\tcol2</pre>"), "col1\tcol2");
  assert.equal(blockTextFromNode(el("pre", "col1\tcol2")), "col1\tcol2");
});

test("blockText reads no words from tool chrome, dropped elements, comments or the reset markers", () => {
  assert.equal(blockText("a <not-bold>b</not-bold> c"), "a b c");
  assert.equal(blockText("a <not-italic>b</not-italic> c"), "a b c");
  assert.equal(blockText('a<span data-lahe="chrome">x</span>b'), "ab");
  assert.equal(blockText("a<script>x</script>b"), "ab");
  assert.equal(blockText("a<!-- x -->b"), "ab");
  assert.equal(blockText("Fish &amp; chips"), "Fish &amp; chips");
});

test("textOf reads plain text and markup alike, and a newline already in the string is a break", () => {
  assert.equal(textOf("a\nb"), "a\nb");
  assert.equal(textOf("<p>a\nb</p>"), "a\nb");
  assert.equal(textOf("Hello\n\nworld."), "Hello\n\nworld.");
  assert.equal(textOf("Hello<br>world."), "Hello\nworld.");
  assert.equal(textOf("<p>a</p><p>b</p>"), "a\n\nb");
});

test("textOf removes the contents of dropped elements but not tool chrome, and reads no words from a marker", () => {
  assert.equal(textOf("a <not-bold>b</not-bold> c"), "a b c");
  assert.equal(textOf("a<script>x</script>b"), "ab");
  assert.equal(textOf("a<style>p{}</style>b<template><p>t</p></template>c"), "abc");
  assert.equal(textOf('a<span data-lahe="chrome">x</span>b'), "axb");
});

test("textOf turns the no-break spellings into a space and leaves other character references as written", () => {
  assert.equal(textOf("a&nbsp;&nbsp;b"), "a b");
  assert.equal(textOf("a&#160;b&#xA0;c&#xa0;d"), "a b c d");
  assert.equal(textOf("a &amp; b"), "a &amp; b");
  assert.equal(textOf("a &lt; b"), "a &lt; b");
});

test("textOf keeps whitespace inside pre and textarea, and a less-than sign that starts no tag", () => {
  assert.equal(textOf("<pre>a   b\n  c</pre>"), "a   b\n  c");
  assert.equal(textOf("<textarea>a   b</textarea>"), "a   b");
  assert.equal(textOf("a < b"), "a < b");
  assert.equal(textOf("1 <2 and <3"), "1 <2 and <3");
});

test("blockTextFromNode reads a live node the way blockText reads markup", () => {
  assert.equal(blockTextFromNode(el("P", "Hello", el("P", " world."))), "Hello\n\nworld.");
  assert.equal(blockTextFromNode(el("p", "Hello\n   world.")), "Hello world.");
  assert.equal(blockTextFromNode(el("div", el("p", "Hello"), el("p", "world."))), "Hello\n\nworld.");
  assert.equal(blockTextFromNode(el("p", "Hello", el("br"), " world.")), "Hello\nworld.");
  assert.equal(blockTextFromNode(el("pre", "a  b\n c")), "a  b\n c");
  assert.equal(blockTextFromNode(el("p", "a ", el("em", "b"), " c")), "a b c");
});

test("blockTextFromNode skips tool chrome and wrappers by default, and a dropped element always", () => {
  assert.equal(blockTextFromNode(el("p", chrome("span", "x"), "y")), "y");
  assert.equal(blockTextFromNode(el("div", el("script", "x"), "y")), "y");
  assert.equal(blockTextFromNode(el("p", "a", el("style", "p{}"), el("template", el("p", "t")), "b")), "ab");
});

test("blockTextFromNode lets the caller say which subtrees are not page content", () => {
  const skipSpans = (node: TextSourceNode): boolean => node.tagName === "SPAN";
  assert.equal(blockTextFromNode(el("p", el("SPAN", "x"), "y"), { skip: skipSpans }), "y");
  assert.equal(blockTextFromNode(el("p", chrome("em", "x"), "y"), { skip: () => false }), "xy");
});

test("blockTextFromNode reads a document or fragment through its children, and any other node as nothing", () => {
  assert.equal(blockTextFromNode(container(FRAGMENT, "a  b")), "a b");
  assert.equal(blockTextFromNode(container(DOCUMENT, el("p", "x"), el("p", "y"))), "x\n\ny");
  assert.equal(blockTextFromNode({ nodeType: COMMENT, data: "hidden" }), "");
  assert.equal(blockTextFromNode(container(COMMENT, "x")), "");
});

test("blockTextFromNode reads a text or CDATA node's data, or its node value when it has none", () => {
  assert.equal(blockTextFromNode(el("p", valueText("from value"))), "from value");
  assert.equal(blockTextFromNode(el("p", { nodeType: CDATA, data: "cdata" })), "cdata");
  assert.equal(blockTextFromNode(el("p", { nodeType: TEXT, nodeValue: null })), "");
  assert.equal(blockTextFromNode(el("p", { nodeType: TEXT, data: "wins", nodeValue: "loses" })), "wins");
});

test("the markup reader and the node reader agree on text that holds no ampersand or angle bracket", () => {
  assert.equal(
    blockTextFromNode(el("p", "Hello", el("p", " world."))),
    blockText("Hello<p>&nbsp;world.</p>")
  );
  assert.equal(blockTextFromNode(el("p", "Hello", el("br"), " world.")), blockText("Hello<br>&nbsp;world."));
  assert.equal(
    blockTextFromNode(el("div", el("ul", el("li", "one"), el("li", "two")), el("pre", "a  b"))),
    blockText("<div><ul><li>one</li><li>two</li></ul><pre>a  b</pre></div>")
  );
});

test("topLevelBlocks cuts markup at its top level and returns each piece's inner markup", () => {
  assert.deepEqual(topLevelBlocks('One <b>bold</b>.<p>Two.</p><p>Three <a href="https://e.com">x</a>.</p>'), [
    "One <strong>bold</strong>.",
    "Two.",
    'Three <a href="https://e.com">x</a>.'
  ]);
  assert.deepEqual(topLevelBlocks("One.<br><br>Two <em>it</em>."), ["One.", "Two <em>it</em>."]);
  assert.deepEqual(topLevelBlocks("<p>One.</p>\n  <p>Two.</p>"), ["One.", "Two."]);
  assert.deepEqual(topLevelBlocks("a<hr>b"), ["a", "b"]);
});

test("topLevelBlocks cuts nothing that is nested, so a block inside an inline element or a div stays whole", () => {
  assert.deepEqual(topLevelBlocks("<strong>One.<p>Two.</p></strong>"), ["<strong>One.<p>Two.</p></strong>"]);
  assert.deepEqual(topLevelBlocks("<div><p>a</p><p>b</p></div>"), ["<p>a</p><p>b</p>"]);
});

test("topLevelBlocks answers null when a piece holds markup but no words, and an empty list for nothing", () => {
  assert.equal(topLevelBlocks('One.<p><img src="a.png"></p>'), null);
  assert.equal(topLevelBlocks('<img src="a.png">'), null);
  assert.deepEqual(topLevelBlocks("<br><br>"), []);
  assert.deepEqual(topLevelBlocks(""), []);
  assert.deepEqual(topLevelBlocks("  <p> </p> "), []);
});
