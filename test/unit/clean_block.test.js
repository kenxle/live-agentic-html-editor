// cleanBlock: the one allowlist every new block passes, at capture, at the
// helper, and before every page write (free-writing architecture, Security &
// Privacy Notes, "One allowlist, three places").

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const normalize = require("../../src/shared/normalize.js");
const failures = require("../../src/shared/failures.js");
const corpus = require("../fixtures/free_writing/corpus.js");

const REFUSED = "RUN_BLOCK_REFUSED";

function refused(tag, html) {
  const got = normalize.cleanBlock(tag, html);
  assert.equal(got.code, REFUSED, "expected " + tag + " " + JSON.stringify(html) + " to be refused, got " + JSON.stringify(got));
  assert.equal(got.html, undefined, "a refusal carries no html");
}

test("the writable tags are the six a record may carry", () => {
  assert.deepEqual(normalize.WRITABLE_BLOCK_TAGS, ["p", "h2", "h3", "h4", "ul", "ol"]);
});

test("the refusal code is a real failure code", () => {
  assert.ok(failures.describe(REFUSED));
});

test("a script or iframe tag is refused", () => {
  refused("script", "alert(1)");
  refused("iframe", "x");
  refused("div", "A div is not a writable block");
  refused("h1", "The page title is not writable");
});

test("a script or iframe inside a block is refused, not cleaned", () => {
  refused("p", "Hello <script>alert(1)</script> there");
  refused("p", "Hello <iframe src=\"https://evil.example\"></iframe>");
});

test("the SVG animate href case is refused", () => {
  refused("p", '<svg><a><animate attributeName="href" values="javascript:alert(1)"></animate><text x="20" y="20">click</text></a></svg>');
});

test("a remote image is refused", () => {
  refused("p", 'Look <img src="https://example.com/x.png">');
});

test("a link is refused", () => {
  refused("p", 'Read <a href="https://example.com">this</a>');
});

test("an li inside a p block is refused", () => {
  refused("p", "<li>Not a list</li>");
  refused("h2", "Heading <li>item</li>");
});

test("a list block holds only li children, and no nested list", () => {
  refused("ul", "Loose words <li>item</li>");
  refused("ul", "<p>A paragraph in a list</p>");
  refused("ul", "<li>One<ul><li>Nested</li></ul></li>");
});

test("a comment or a processing instruction is refused", () => {
  refused("p", "Words <!-- hidden --> more");
  refused("p", "Words <?php echo 1 ?>");
});

test("an empty block is refused", () => {
  refused("p", "");
  refused("p", "   <br>");
  refused("ul", "<li></li><li> </li>");
});

test("every attribute is dropped", () => {
  const got = normalize.cleanBlock("p", 'A <strong class="x" onclick="alert(1)" data-lahe-id="s1">bold</strong> <em style="color:red">word</em>');
  assert.equal(got.html, "A <strong>bold</strong> <em>word</em>");
});

test("text is escaped again on output", () => {
  assert.equal(normalize.cleanBlock("p", "Fish &amp; chips &lt;3").html, "Fish &amp; chips &lt;3");
  assert.equal(normalize.cleanBlock("p", "a < b and c > d").html, "a &lt; b and c &gt; d");
  assert.equal(normalize.cleanBlock("p", "&lt;script&gt;alert(1)&lt;/script&gt;").html, "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("b and i become strong and em, and the reset tags are kept", () => {
  assert.equal(normalize.cleanBlock("p", "<b>x</b> <i>y</i>").html, "<strong>x</strong> <em>y</em>");
  assert.equal(normalize.cleanBlock("p", "<not-bold>x</not-bold> y").html, "<not-bold>x</not-bold> y");
});

test("elements come only from the allowlist's constants", () => {
  // Uppercase and odd spellings come out as the constant's spelling.
  assert.equal(normalize.cleanBlock("P", "<STRONG>x</STRONG> <Em>y</Em>").html, "<strong>x</strong> <em>y</em>");
  refused("p", "<strongx>x</strongx>");
  refused("p", "<span>x</span>");
});

test("a list keeps its items and drops an empty one", () => {
  assert.equal(normalize.cleanBlock("ul", "<li>One</li>\n<li></li><li>Two <b>b</b></li>").html, "<li>One</li><li>Two <strong>b</strong></li>");
});

test("a trailing break is dropped and a middle one kept", () => {
  assert.equal(normalize.cleanBlock("p", "Line one<br>Line two<br>").html, "Line one<br>Line two");
});

test("nbsp folds to a space and whitespace collapses", () => {
  assert.equal(normalize.cleanBlock("p", "Two&nbsp;words  and\n a space&nbsp;").html, "Two words and a space");
});

test("cleanBlock is a fixed point on its own output over the engine corpus", () => {
  for (const sample of corpus.ENGINE) {
    const once = normalize.cleanBlock(sample.tag, sample.html);
    assert.equal(typeof once.html, "string", sample.name + " cleans");
    const twice = normalize.cleanBlock(sample.tag, once.html);
    assert.equal(twice.html, once.html, sample.name + " is a fixed point");
  }
});

test("cleanBlock keeps the words of the engine corpus", () => {
  for (const sample of corpus.ENGINE) {
    const once = normalize.cleanBlock(sample.tag, sample.html);
    assert.equal(normalize.blockWords(once.html), normalize.blockWords(sample.html), sample.name + " keeps its words");
  }
});
