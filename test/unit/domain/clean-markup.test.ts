/*
 * read-when: Changing src/domain/clean-markup.ts, or when one of these tests fails.
 * not-for: How cleaned markup is read for text or compared; see block-text.test.ts and comparison.test.ts.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanMarkup } from "../../../src/domain/clean-markup.ts";

function cleans(input: string, expected: string): void {
  assert.equal(cleanMarkup(input), expected, JSON.stringify(input));
}

test("tool chrome is dropped with its subtree and a tool wrapper is replaced by its contents", () => {
  cleans(
    '<p>Hi <span data-lahe="chrome">chip text</span><span data-lahe="wrap">kept</span> there</p>',
    "<p>Hi kept there</p>"
  );
  cleans('<div data-lahe="chrome"><p>deep <b>x</b></p></div>after', "after");
  cleans('<p>a<span data-lahe="wrap"><em>b</em></span>c</p>', "<p>a<em>b</em>c</p>");
});

test("every data-lahe attribute and every lahe- class token is dropped, the stamp included", () => {
  cleans('<p class="prose lahe-highlight" data-lahe-item="itm_1" id="x">text</p>', '<p class="prose" id="x">text</p>');
  cleans('<p class="prose" data-lahe-id="e7f2a91c">text</p>', '<p class="prose">text</p>');
  cleans('<p DATA-LAHE-X="1">t</p>', "<p>t</p>");
});

test("a class attribute left with no tokens is dropped, and the rest are joined by single spaces", () => {
  cleans('<p class="lahe-a lahe-b">t</p>', "<p>t</p>");
  cleans('<p class="  a   b ">t</p>', '<p class="a b">t</p>');
  cleans('<p class="">t</p>', "<p>t</p>");
});

test("a style attribute never gets through, and neither do the editing hints", () => {
  cleans('<p style="color:red">t</p>', "<p>t</p>");
  for (const name of ["contenteditable", "spellcheck", "autocorrect", "autocapitalize", "data-turbo-permanent", "srcdoc"]) {
    cleans("<p " + name + '="x" id="k">t</p>', '<p id="k">t</p>');
  }
});

test("event handler attributes are dropped, and so is any attribute whose name starts with on", () => {
  cleans('<a href="/x" onclick="steal()">t</a>', '<a href="/x">t</a>');
  cleans('<a href="/x" ONMOUSEOVER="steal()" one="1">t</a>', '<a href="/x">t</a>');
});

test("a URL attribute is kept only with no scheme or a web, mail or phone scheme", () => {
  const dropped = [
    "javascript:alert(1)",
    "java&#09;script:alert(1)",
    "JaVaScRiPt:x",
    "&#x6A;avascript:x",
    "&#106avascript:x",
    " java\nscript:x",
    "javascript&colon;x",
    "vbscript:x",
    "ftp://x"
  ];
  for (const value of dropped) cleans('<a href="' + value + '">t</a>', "<a>t</a>");
  cleans('<img src="data:text/html,<script>x</script>">', "<img>");
  const kept = ["https://example.com", "/relative#frag", "mailto:a@b.c", "tel:1", "/a:b", "?a:b", "1a:b", "HTTP://x.y", "Mailto:a@b.c"];
  for (const value of kept) cleans('<a href="' + value + '">t</a>', '<a href="' + value + '">t</a>');
});

test("every URL attribute is checked, not only href", () => {
  for (const name of ["href", "src", "srcset", "action", "formaction", "poster", "xlink:href", "data", "cite", "background"]) {
    cleans("<x-el " + name + '="javascript:x">t</x-el>', "<x-el>t</x-el>");
    cleans("<x-el " + name + '="https://ok.example/a">t</x-el>', "<x-el " + name + '="https://ok.example/a">t</x-el>');
  }
  cleans('<p title="javascript:x">t</p>', '<p title="javascript:x">t</p>');
});

test("a script, style, template, noscript, iframe, object, embed, applet, frame or frameset is dropped with its contents", () => {
  cleans("<p>a<script>bad()</script>b</p>", "<p>ab</p>");
  for (const name of ["script", "style", "template", "noscript", "iframe", "object", "applet", "frame", "frameset"]) {
    cleans("<p>a<" + name + ">bad <b>x</b></" + name + ">b</p>", "<p>ab</p>");
    cleans("<p>a<" + name.toUpperCase() + ">bad</" + name.toUpperCase() + ">b</p>", "<p>ab</p>");
  }
  cleans("<p>a<embed src=x>b</p>", "<p>ab</p>");
});

test("a dropped element that is never closed drops everything to the end", () => {
  cleans("<p>a<script>b", "<p>a</p>");
  cleans("<p>a<iframe src=x>b", "<p>a</p>");
  cleans("<p>a<iframe src=x>b</p><p>c</p>", "<p>a</p><p>c</p>");
});

test("a comment, a declaration and an instruction are dropped, and a comment never closed drops the rest", () => {
  cleans("<p>a<!-- secret -->b</p>", "<p>ab</p>");
  cleans("<!DOCTYPE html><p>x</p>", "<p>x</p>");
  cleans("<p>a<?php echo 1 ?>b</p>", "<p>ab</p>");
  cleans("<p>a<!-- never closed</p><p>b</p>", "<p>a</p>");
  cleans("<p>a<!-- <p>hidden</p> -->b</p>", "<p>ab</p>");
});

test("tag and attribute names are lowercased, b and i become strong and em, and attributes are written sorted", () => {
  cleans("<P>a <B>b</B> <I>c</I></P>", "<p>a <strong>b</strong> <em>c</em></p>");
  cleans('<a href="/x" id="y" title="z">t</a>', '<a href="/x" id="y" title="z">t</a>');
  cleans('<a title="z" href="/x" id="y">t</a>', '<a href="/x" id="y" title="z">t</a>');
  cleans('<A HREF="/x">t</A>', '<a href="/x">t</a>');
});

test("an attribute with no value is written with an empty one, and a value is escaped when written", () => {
  cleans("<input disabled>", '<input disabled="">');
  cleans("<p title='a\"b<c>'>t</p>", '<p title="a&quot;b&lt;c&gt;">t</p>');
});

test("a void element is written with no end tag and a slash on it is dropped", () => {
  cleans("<p>a<br/>b<img src=x.png alt='z'/></p>", '<p>a<br>b<img alt="z" src="x.png"></p>');
  cleans("<p>a<br></br>b<hr></p>", "<p>a<br>b<hr></p>");
  cleans('<p>a<span data-lahe="wrap"/>b</p>', "<p>ab</p>");
});

test("a slash on an element that is not void opens it, as a browser does, so the output stays balanced", () => {
  cleans("<p>a<span/>b</p>", "<p>a<span>b</span></p>");
  cleans("<div/>text", "<div>text</div>");
  cleans("<p>a<script/>b</p>", "<p>a</p>");
});

test("the output is balanced: open elements close innermost first, an end tag closes what opened inside it, a stray one is ignored", () => {
  cleans("<p>a<em>b", "<p>a<em>b</em></p>");
  cleans("<p><em>a</p>b", "<p><em>a</em></p>b");
  cleans("<p>a</em>b</p>", "<p>ab</p>");
  cleans("</p>x</div>", "x");
  cleans("<ul><li>a<li>b</ul>", "<ul><li>a<li>b</li></li></ul>");
});

test("a style that states a not-bold weight wraps the element in the not-bold marker", () => {
  cleans(
    'Runners come back <span style="font-weight: normal;">too fast</span> after a layoff.',
    "Runners come back <not-bold>too fast</not-bold> after a layoff."
  );
  cleans('<span style="font-weight:400">x</span>', "<not-bold>x</not-bold>");
  cleans('<span style="font-weight:lighter">x</span>', "<not-bold>x</not-bold>");
  cleans('<span style="font-weight:500">x</span>', "<not-bold>x</not-bold>");
});

test("a style that states font-style normal wraps the element in the not-italic marker, and both nest with not-bold outside", () => {
  cleans('<span style="font-style: normal;">x</span>', "<not-italic>x</not-italic>");
  cleans(
    '<span style="font-weight:normal;font-style:normal">x</span>',
    "<not-bold><not-italic>x</not-italic></not-bold>"
  );
  cleans(
    '<span style="font-style:normal;font-weight:normal">x</span>',
    "<not-bold><not-italic>x</not-italic></not-bold>"
  );
});

test("a style that says the opposite is simply dropped, and the last declaration of a property wins", () => {
  cleans('<span style="font-weight:700">x</span>', "<span>x</span>");
  cleans('<span style="font-weight: bold;">x</span>', "<span>x</span>");
  cleans('<span style="font-weight:bold;font-weight:normal">x</span>', "<not-bold>x</not-bold>");
  cleans('<span style="font-weight:normal;font-weight:bold">x</span>', "<span>x</span>");
});

test("an element that says something else too keeps its own tag inside the marker, and only it carries attributes", () => {
  cleans('<span class="k" style="font-weight:normal">x</span>', '<not-bold><span class="k">x</span></not-bold>');
  cleans('<em style="font-weight:normal">x</em>', "<not-bold><em>x</em></not-bold>");
  cleans('<b style="font-weight:normal">x</b>', "<not-bold><strong>x</strong></not-bold>");
  cleans('<span style="font-weight:normal">a<b>b</b>c</span>', "<not-bold>a<strong>b</strong>c</not-bold>");
  cleans('<p style="font-style:normal" id="q">x</p>', '<not-italic><p id="q">x</p></not-italic>');
});

test("no output ever holds a style attribute", () => {
  for (const input of [
    '<span style="font-weight:normal;color:red">x</span>',
    '<p style="color:red"><b style="font-weight:700">x</b></p>',
    '<a style="font-style:normal" href="/x">x</a>',
    "<p STYLE='x:y'>x</p>"
  ]) {
    assert.doesNotMatch(cleanMarkup(input), /style=/);
  }
});

test("text is composed to NFC and loses the invisible characters and the controls", () => {
  cleans("<p>cafe\u0301 a\u200Bb\uFEFFc\u00ADd\u0007e\u0000f</p>", "<p>caf\u00E9 abcdef</p>");
  cleans("<p>a\u200Db\u200Cc</p>", "<p>a\u200Db\u200Cc</p>");
});

test("outside pre every run of whitespace is one space, and every spelling of a no-break space is a space", () => {
  cleans("<p>a    b</p>", "<p>a b</p>");
  cleans("<p>a&nbsp;b&#160;c&#xA0;d\u00A0e&NBSP;f&#xa0;g</p>", "<p>a b c d e f g</p>");
  cleans("<p>a \t\n \u2009 b</p>", "<p>a b</p>");
});

test("inside pre and textarea whitespace is kept as written", () => {
  cleans("<pre>a    b</pre>", "<pre>a    b</pre>");
  cleans("<pre>a  <b>b   c</b>\n d</pre>", "<pre>a  <strong>b   c</strong>\n d</pre>");
  cleans("<textarea>a   b\n c</textarea>", "<textarea>a   b\n c</textarea>");
  cleans("<p>a  b</p><pre>c  d</pre><p>e  f</p>", "<p>a b</p><pre>c  d</pre><p>e f</p>");
});

test("other character references are kept as written, and a less-than sign that starts no tag is text", () => {
  cleans("<p>Fish &amp; chips &lt;3</p>", "<p>Fish &amp; chips &lt;3</p>");
  cleans("<p>a < b</p>", "<p>a < b</p>");
  cleans("1 <2 and <3", "1 <2 and <3");
  cleans("<p>x &#65; &bogus;</p>", "<p>x &#65; &bogus;</p>");
});

test("the result is trimmed, and an empty input is an empty output", () => {
  cleans("  <p> a </p>  ", "<p> a </p>");
  cleans("", "");
  cleans("   ", "");
});

test("keepWhitespace keeps the reviewer's spaces, spellings and ends, and still cleans", () => {
  const keep = { keepWhitespace: true };
  assert.equal(cleanMarkup("Text him ", keep), "Text him ");
  assert.equal(cleanMarkup(" Devon", keep), " Devon");
  assert.equal(cleanMarkup("a&nbsp;&nbsp;b&nbsp;", keep), "a&nbsp;&nbsp;b&nbsp;");
  assert.equal(cleanMarkup("a   b", keep), "a   b");
  assert.equal(cleanMarkup('Text <b onclick="x()">him</b> <script>bad()</script>', keep), "Text <strong>him</strong> ");
  assert.equal(cleanMarkup("Text him "), "Text him");
  assert.equal(cleanMarkup("a&nbsp;&nbsp;b"), "a b");
});

test("cleaning twice gives what cleaning once gives", () => {
  for (const input of [
    '<P CLASS="x lahe-h" style="color:red">Hi <B>b</B><span data-lahe="chrome">c</span></P>',
    '<span style="font-weight:normal">a <i>b</i></span> <pre>x  y</pre>',
    "<p>a<em>b",
    "1 <2 and <3",
    "<p>a&nbsp;b</p>",
    '<a href="https://e.com/a" title="t">l</a><br/>'
  ]) {
    const once = cleanMarkup(input);
    assert.equal(cleanMarkup(once), once, JSON.stringify(input));
  }
});

test("markup that differs only in attribute order, tag case, b or strong, i or em, or incidental whitespace cleans to one string", () => {
  assert.equal(cleanMarkup("<p>the <b>word</b></p>"), cleanMarkup("<p>the <strong>word</strong></p>"));
  assert.equal(cleanMarkup("<P>the <I>word</I></P>"), cleanMarkup("<p>the <em>word</em></p>"));
  assert.equal(cleanMarkup('<a id="y" href="/x">t</a>'), cleanMarkup('<a href="/x" id="y">t</a>'));
  assert.equal(cleanMarkup("<p>the   word</p>"), cleanMarkup("<p>the word</p>"));
});

test("markup that adds bold does not clean to the same string as markup without it", () => {
  assert.notEqual(cleanMarkup("<p>the word</p>"), cleanMarkup("<p>the <strong>word</strong></p>"));
  assert.notEqual(cleanMarkup("<p>the <strong>word</strong></p>"), cleanMarkup("<p>the <em>word</em></p>"));
});

test("D8: an attribute value is decoded when read and escaped once when written, so a link keeps its ampersands", () => {
  cleans('<a href="/a?x=1&amp;y=2">t</a>', '<a href="/a?x=1&amp;y=2">t</a>');
  cleans('<a title="a&quot;b">t</a>', '<a title="a&quot;b">t</a>');
  cleans('<a title="a&lt;b&gt;c">t</a>', '<a title="a&lt;b&gt;c">t</a>');
  cleans("<a title='a\"b'>t</a>", '<a title="a&quot;b">t</a>');
  cleans('<a title="&#65;&bogus;">t</a>', '<a title="A&amp;bogus;">t</a>');
});

test("D8: cleaning is a fixed point on attribute values that hold an ampersand, a quote or an angle bracket", () => {
  for (const input of [
    '<a href="/a?x=1&amp;y=2">t</a>',
    '<a title="a&quot;b">t</a>',
    '<a title="x &lt; y &gt; z &amp; w">t</a>',
    "<a title='say \"hi\" & go'>t</a>"
  ]) {
    const once = cleanMarkup(input);
    assert.equal(cleanMarkup(once), once, JSON.stringify(input));
  }
});

test("D8: a record stored with a doubled escape keeps its bytes, so old records still equal their own cleaned form", () => {
  const stored = '<a href="/a?x=1&amp;amp;y=2" title="a&amp;quot;b">t</a>';
  cleans(stored, stored);
});

test("D8: the scheme check runs on the decoded value and decodes again, so it is no weaker", () => {
  cleans('<a href="java&amp;#09;script:alert(1)">t</a>', "<a>t</a>");
  cleans('<a href="&amp;#106;avascript:x">t</a>', "<a>t</a>");
  cleans('<a href="javascript&amp;colon;x">t</a>', "<a>t</a>");
  cleans('<a href="https://e.com/?a=1&amp;b=2">t</a>', '<a href="https://e.com/?a=1&amp;b=2">t</a>');
});
