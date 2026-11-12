/*
 * read-when: Changing src/domain/run-blocks.ts, or when one of these tests fails.
 * not-for: Which blocks the page already shows; see run-match.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MAX_BLOCK_NESTING,
  WRITABLE_BLOCK_TAGS,
  blockWords,
  cleanBlock,
  inlineTagFor,
  isWritableBlockTag,
  runWords
} from "../../../src/domain/run-blocks.ts";

interface EngineSample {
  readonly name: string;
  readonly tag: string;
  readonly html: string;
}

const ENGINE: readonly EngineSample[] = [
  { name: "b and i", tag: "p", html: "Some <b>bold</b> and <i>italic</i> words" },
  { name: "nbsp", tag: "p", html: "Two&nbsp;words and a trailing space&nbsp;" },
  { name: "trailing br", tag: "p", html: "Ends with a break<br>" },
  { name: "nested strong and em", tag: "p", html: "A <strong>bold <em>and italic</em></strong> run" },
  {
    name: "entities",
    tag: "p",
    html: "Fish &amp; chips &lt;3 &gt; &quot;quoted&quot; &#39;single&#39; &#x2014; dash"
  },
  { name: "uppercase tags", tag: "h2", html: "An <STRONG>Uppercase</STRONG> <EM>heading</EM>" },
  { name: "list items", tag: "ul", html: "<li>First <b>item</b></li><LI>Second item<br></LI>" },
  { name: "numbered list", tag: "ol", html: "<li>One</li><li>Two &amp; three</li>" },
  { name: "line break mid", tag: "p", html: "Line one<br>Line two" },
  { name: "captured: empty last list item", tag: "ul", html: "<li>only item</li><li><br></li>" },
  { name: "captured: nbsp after a drop", tag: "p", html: "Drop here:&nbsp;Dropped bold" }
];

function repeat(piece: string, count: number): string {
  return piece.repeat(count);
}

function accepted(tag: unknown, html: unknown): string {
  const got = cleanBlock(tag, html);
  assert.ok("html" in got, "expected " + JSON.stringify([tag, html]) + " to clean, got " + JSON.stringify(got));
  return got.html;
}

function refusal(tag: unknown, html: unknown, reason: string): void {
  const got = cleanBlock(tag, html);
  assert.ok(!("html" in got), "expected " + JSON.stringify([tag, html]) + " to be refused, got " + JSON.stringify(got));
  assert.equal(got.code, "RUN_BLOCK_REFUSED");
  assert.equal(got.reason, reason, JSON.stringify([tag, html]));
}

test("the writable tags are the six a record may carry", () => {
  assert.deepEqual([...WRITABLE_BLOCK_TAGS], ["p", "h2", "h3", "h4", "ul", "ol"]);
  for (const name of WRITABLE_BLOCK_TAGS) assert.equal(isWritableBlockTag(name), true, name);
  for (const name of ["h1", "div", "P", "li", "script", "constructor"]) assert.equal(isWritableBlockTag(name), false, name);
});

test("an inline tag is written by one name, and every other name is not allowed", () => {
  assert.equal(inlineTagFor("strong"), "strong");
  assert.equal(inlineTagFor("b"), "strong");
  assert.equal(inlineTagFor("em"), "em");
  assert.equal(inlineTagFor("i"), "em");
  assert.equal(inlineTagFor("not-bold"), "not-bold");
  assert.equal(inlineTagFor("not-italic"), "not-italic");
  for (const name of ["span", "a", "li", "br", "STRONG", "constructor", ""]) assert.equal(inlineTagFor(name), null, name);
});

test("the nesting cap is 32", () => {
  assert.equal(MAX_BLOCK_NESTING, 32);
});

test("a refusal names the failure code and a reason, and carries no html", () => {
  const got = cleanBlock("script", "alert(1)");
  assert.deepEqual(got, { code: "RUN_BLOCK_REFUSED", reason: "tag script is not writable" });
});

test("a tag that is not one of the six is refused, whatever its letter case or type", () => {
  refusal("script", "alert(1)", "tag script is not writable");
  refusal("iframe", "x", "tag iframe is not writable");
  refusal("div", "A div is not a writable block", "tag div is not writable");
  refusal("h1", "The page title is not writable", "tag h1 is not writable");
  refusal(5, "x", "tag 5 is not writable");
  refusal(undefined, "x", "tag undefined is not writable");
  refusal(null, "x", "tag null is not writable");
});

test("html that is not a string is refused", () => {
  refusal("p", 5, "html must be a string");
  refusal("p", undefined, "html must be a string");
  refusal("p", null, "html must be a string");
  refusal("p", { toString: () => "x" }, "html must be a string");
});

test("a script, iframe, svg, image, link or span inside a block is refused, not cleaned", () => {
  refusal("p", "Hello <script>alert(1)</script> there", "element script is not allowed in a block");
  refusal("p", 'Hello <iframe src="https://evil.example"></iframe>', "element iframe is not allowed in a block");
  refusal(
    "p",
    '<svg><a><animate attributeName="href" values="javascript:alert(1)"></animate><text x="20" y="20">click</text></a></svg>',
    "element svg is not allowed in a block"
  );
  refusal("p", 'Look <img src="https://example.com/x.png">', "element img is not allowed in a block");
  refusal("p", 'Read <a href="https://example.com">this</a>', "element a is not allowed in a block");
  refusal("p", "<span>x</span>", "element span is not allowed in a block");
  refusal("p", "<strongx>x</strongx>", "element strongx is not allowed in a block");
});

test("a block or a nested list inside a list block is refused", () => {
  refusal("ul", "<p>A paragraph in a list</p>", "element p is not allowed in a block");
  refusal("ul", "<li>One<ul><li>Nested</li></ul></li>", "element ul is not allowed in a block");
});

test("an li in a paragraph or heading block is refused, and so is an li inside an li", () => {
  refusal("p", "<li>Not a list</li>", "li inside a p block");
  refusal("h2", "Heading <li>item</li>", "li inside a h2 block");
  refusal("ul", "<li>One<li>Two</li></li>", "a nested item");
  refusal("ul", "<li>One <em><li>Two</li></em></li>", "a nested item");
});

test("words, a break or formatting directly in a list block are refused", () => {
  refusal("ul", "Loose words <li>item</li>", "words outside an item in a list block");
  refusal("ul", "<li>item</li> trailing", "words outside an item in a list block");
  refusal("ol", "a < b", "words outside an item in a list block");
  refusal("ul", "<br><li>item</li>", "a break outside an item in a list block");
  refusal("ul", "<strong>x</strong>", "formatting outside an item in a list block");
});

test("a comment, a declaration or an instruction is refused", () => {
  refusal("p", "Words <!-- hidden --> more", "a comment or declaration in a block");
  refusal("p", "Words <?php echo 1 ?>", "a comment or declaration in a block");
  refusal("p", "<!DOCTYPE html>Words", "a comment or declaration in a block");
});

test("a block nested more than 32 levels deep is refused, li included", () => {
  const depth = MAX_BLOCK_NESTING + 1;
  refusal("p", repeat("<em>", depth) + "words" + repeat("</em>", depth), "nesting deeper than 32");
  refusal("ul", "<li>" + repeat("<strong>", depth) + "words" + repeat("</strong>", depth) + "</li>", "nesting deeper than 32");
});

test("an empty block, or a list block with no words in its items, is refused", () => {
  refusal("p", "", "a block with no words");
  refusal("p", "   <br>", "a block with no words");
  refusal("h3", "<em></em>", "a block with no words");
  refusal("ul", "<li></li><li> </li>", "a list block with no words");
  refusal("ul", "", "a list block with no words");
});

test("an accepted block is rebuilt from constants with every attribute dropped", () => {
  assert.equal(
    accepted("p", 'A <strong class="x" onclick="alert(1)" data-lahe-id="s1">bold</strong> <em style="color:red">word</em>'),
    "A <strong>bold</strong> <em>word</em>"
  );
  assert.equal(accepted("p", "<b>x</b> <i>y</i>"), "<strong>x</strong> <em>y</em>");
  assert.equal(accepted("p", "<not-bold>x</not-bold> y"), "<not-bold>x</not-bold> y");
  assert.equal(accepted("p", "<not-italic>x</not-italic> y"), "<not-italic>x</not-italic> y");
  assert.equal(accepted("P", "<STRONG>x</STRONG> <Em>y</Em>"), "<strong>x</strong> <em>y</em>");
  assert.equal(accepted("H2", "x"), "x");
  assert.equal(accepted("ul", "<LI>x</LI>"), "<li>x</li>");
});

test("text is decoded, cleaned, and escaped again on output", () => {
  assert.equal(accepted("p", "Fish &amp; chips &lt;3"), "Fish &amp; chips &lt;3");
  assert.equal(accepted("p", "a < b and c > d"), "a &lt; b and c &gt; d");
  assert.equal(accepted("p", "&lt;script&gt;alert(1)&lt;/script&gt;"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(accepted("p", "Two&nbsp;words  and\n a space&nbsp;"), "Two words and a space");
  assert.equal(accepted("p", "a &bogus; b"), "a &amp;bogus; b");
  assert.equal(accepted("p", "cafe\u0301 a\u200Bb\u0007c"), "caf\u00E9 abc");
  assert.equal(accepted("p", "a\u2009b\u3000c\u2028d"), "a b c d");
});

test("tidying drops edge space, leading and trailing breaks and empty elements, and keeps a middle break", () => {
  assert.equal(accepted("p", "Line one<br>Line two<br>"), "Line one<br>Line two");
  assert.equal(accepted("ul", "<li>One</li>\n<li></li><li>Two <b>b</b></li>"), "<li>One</li><li>Two <strong>b</strong></li>");
  assert.equal(accepted("p", "<em> a</em>"), "<em>a</em>");
  assert.equal(accepted("p", "a <em></em> b"), "a b");
  assert.equal(accepted("p", "<br>a"), "a");
  assert.equal(accepted("p", "  a  <br>  b  "), "a <br> b");
  assert.equal(accepted("p", "<em>a<br></em>"), "<em>a</em>");
});

test("tidying closes the nearest open element of the end tag's written name, ignores a stray end tag and closes what is left open", () => {
  assert.equal(accepted("p", "<strong>a</b>c"), "<strong>a</strong>c");
  assert.equal(accepted("p", "a</em>b"), "ab");
  assert.equal(accepted("p", "a<em>b"), "a<em>b</em>");
  assert.equal(accepted("p", "<em>a<strong>b</em>c"), "<em>a<strong>b</strong></em>c");
});

test("cleanBlock is a fixed point on its own output, and keeps the words, over the engine corpus", () => {
  for (const sample of ENGINE) {
    const once = accepted(sample.tag, sample.html);
    assert.equal(accepted(sample.tag, once), once, sample.name + " is a fixed point");
    assert.equal(blockWords(once), blockWords(sample.html), sample.name + " keeps its words");
  }
});

test("a megabyte of nested tags is refused in well under a second", () => {
  const count = Math.floor((1024 * 1024) / 8);
  const html = repeat("<em>", count) + "words" + repeat("</b>", count);
  const started = Date.now();
  refusal("p", html, "nesting deeper than 32");
  assert.ok(Date.now() - started < 500, "took " + String(Date.now() - started) + "ms");
});

test("a block nested to the cap still cleans with its words, and one nesting level more is refused, not thrown", () => {
  const depth = MAX_BLOCK_NESTING - 1;
  const html = accepted("ul", "<li>" + repeat("<em>", depth) + "deep words" + repeat("</em>", depth) + "</li>");
  assert.equal(blockWords(html), "deep words");
  refusal("p", repeat("<em>", MAX_BLOCK_NESTING + 1) + "words", "nesting deeper than 32");
  assert.equal(blockWords(accepted("p", repeat("<em>", MAX_BLOCK_NESTING) + "words")), "words");
});

test("many empty elements between words clean in linear time", () => {
  const count = 50000;
  const started = Date.now();
  const html = accepted("p", repeat("a<em></em>", count));
  assert.equal(html, repeat("a", count));
  assert.ok(Date.now() - started < 500, "took " + String(Date.now() - started) + "ms");
});

test("a run of leading breaks costs linear time too", () => {
  const started = Date.now();
  const html = accepted("p", repeat("<br>", 50000) + "words" + repeat("<br>", 50000));
  assert.equal(html, "words");
  assert.ok(Date.now() - started < 500, "took " + String(Date.now() - started) + "ms");
});

test("blockWords folds typography and resolves references, so a typed dash and a rendered one read alike", () => {
  assert.equal(blockWords("It\u2019s \u201Cdone\u201D \u2014 now"), "It's \"done\" - now");
  assert.equal(blockWords("Fish &amp; chips &quot;x&quot;"), "Fish & chips \"x\"");
  assert.equal(blockWords("She said no -- then left"), blockWords("She said no &#8212; then left"));
  assert.equal(blockWords("<p>a \u2014 b</p>"), "a - b");
  assert.equal(blockWords("<p>A <b>x</b></p><p>y</p>"), "A x y");
});

test("blockWords answers an absent block with no words", () => {
  assert.equal(blockWords(null), "");
  assert.equal(blockWords(undefined), "");
  assert.equal(blockWords(""), "");
});

test("runWords counts the words of every block the reviewer wrote, and skips a moved anchor tail", () => {
  assert.equal(
    runWords([
      { html: "moved tail words here", from_anchor: true },
      { html: "A <strong>new</strong> heading" },
      { html: "<li>one two</li><li>three</li>" }
    ]),
    6
  );
  assert.equal(runWords([{ html: "a &amp; b" }]), 3);
  assert.equal(runWords([{ html: "x", from_anchor: false }]), 1);
});

test("runWords counts nothing for no run", () => {
  assert.equal(runWords(undefined), 0);
  assert.equal(runWords([]), 0);
});
