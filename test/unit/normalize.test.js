// The one normalizer. These tests are the reason four other tasks are allowed
// to import it without arguing about it.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const n = require("../../src/shared/normalize.js");

// ---------------------------------------------------------------------------
// normalizeText
// ---------------------------------------------------------------------------

test("normalizeText is idempotent", () => {
  const inputs = ["  a  b  ", "a\n\nb", "café", "one two", "x three"];
  for (const input of inputs) {
    const once = n.normalizeText(input);
    assert.equal(n.normalizeText(once), once, `not idempotent for ${JSON.stringify(input)}`);
  }
});

test("normalizeText collapses every whitespace run to one space and trims", () => {
  assert.equal(n.normalizeText("  The trainer\n\twrites   the plan.  "), "The trainer writes the plan.");
});

test("normalizeText makes rewrapping invisible, which is what R16 needs", () => {
  const built = "The trainer writes the plan. Acey writes the messages.";
  const rewrapped = "  The trainer writes the plan.\n\tAcey writes\n   the messages.  ";
  assert.equal(n.normalizeText(built), n.normalizeText(rewrapped));
});

test("normalizeText folds a non-breaking space and a hair space into a plain space", () => {
  // The hair space is the one that costs a debugging session: it is invisible
  // in a fixture and in a diff.
  assert.equal(n.normalizeText("a\u00A0b"), "a b");
  assert.equal(n.normalizeText("a\u200Ab"), "a b");
  assert.equal(n.normalizeText("a\u2009b"), "a b");
  assert.equal(n.normalizeText("a\u3000b"), "a b");
});

test("normalizeText removes a zero width space and a BOM but keeps a zero width joiner", () => {
  assert.equal(n.normalizeText("a\u200Bb"), "ab");
  assert.equal(n.normalizeText("\uFEFFabc"), "abc");
  // Removing ZWJ would break an emoji family and Persian text.
  assert.equal(n.normalizeText("a\u200Db"), "a\u200Db");
});

test("normalizeText composes to NFC so two spellings of one accented word match", () => {
  const composed = "caf\u00E9";
  const decomposed = "cafe\u0301";
  assert.notEqual(composed, decomposed);
  assert.equal(n.normalizeText(composed), n.normalizeText(decomposed));
});

test("normalizeText strips control characters but keeps tab and newline as spaces", () => {
  assert.equal(n.normalizeText("a\u0007bc"), "abc");
  assert.equal(n.normalizeText("a\tb\nc"), "a b c");
});

test("normalizeText is case sensitive and typography preserving", () => {
  assert.notEqual(n.normalizeText("Fix"), n.normalizeText("fix"));
  assert.notEqual(n.normalizeText("don\u2019t"), n.normalizeText("don't"));
});

test("normalizeText throws on a non-string rather than stringifying it", () => {
  // A silent String(undefined) becomes the literal comparison key "undefined",
  // which matches nothing forever and looks like an anchoring bug.
  assert.throws(() => n.normalizeText(undefined), /expects a string/);
  assert.throws(() => n.normalizeText(null), /expects a string/);
  assert.throws(() => n.normalizeText(42), /expects a string/);
});

test("foldTypography sits on top of normalizeText and is not a second normalizer", () => {
  assert.equal(n.foldTypography("don\u2019t \u201Cstop\u201D \u2014 now\u2026"), 'don\'t "stop" - now...');
  assert.equal(n.foldTypography("  a   b "), "a b");
});

// ---------------------------------------------------------------------------
// cleanMarkup
// ---------------------------------------------------------------------------

test("cleanMarkup drops tool chrome with its subtree and unwraps tool wrappers", () => {
  const html =
    '<p>Hi <span data-lahe="chrome">chip text</span><span data-lahe="wrap">kept</span> there</p>';
  assert.equal(n.cleanMarkup(html), "<p>Hi kept there</p>");
});

test("cleanMarkup strips every data-lahe attribute and lahe- class token", () => {
  const html = '<p class="prose lahe-highlight" data-lahe-item="itm_1" id="x">text</p>';
  assert.equal(n.cleanMarkup(html), '<p class="prose" id="x">text</p>');
});

test("cleanMarkup drops a class attribute that was only tool classes", () => {
  assert.equal(n.cleanMarkup('<p class="lahe-a lahe-b">t</p>'), "<p>t</p>");
});

test("cleanMarkup never lets a style attribute through", () => {
  // R34 and R35: the tool does not restyle the host and does not report a style
  // it never wrote.
  assert.equal(n.cleanMarkup('<p style="color:red">t</p>'), "<p>t</p>");
});

test("cleanMarkup drops event handler attributes", () => {
  assert.equal(n.cleanMarkup('<a href="/x" onclick="steal()">t</a>'), '<a href="/x">t</a>');
});

test("cleanMarkup drops a script with its contents", () => {
  assert.equal(n.cleanMarkup("<p>a<script>bad()</script>b</p>"), "<p>ab</p>");
});

test("cleanMarkup refuses an executable scheme, including one hidden behind an entity", () => {
  assert.equal(n.cleanMarkup('<a href="javascript:alert(1)">t</a>'), "<a>t</a>");
  assert.equal(n.cleanMarkup('<a href="java&#09;script:alert(1)">t</a>'), "<a>t</a>");
  assert.equal(n.cleanMarkup('<a href="JaVaScRiPt:x">t</a>'), "<a>t</a>");
  assert.equal(n.cleanMarkup('<img src="data:text/html,<script>x</script>">'), "<img>");
  // and keeps the ones a reviewed document legitimately uses
  assert.equal(n.cleanMarkup('<a href="https://example.com">t</a>'), '<a href="https://example.com">t</a>');
  assert.equal(n.cleanMarkup('<a href="/relative#frag">t</a>'), '<a href="/relative#frag">t</a>');
  assert.equal(n.cleanMarkup('<a href="mailto:a@b.c">t</a>'), '<a href="mailto:a@b.c">t</a>');
});

test("cleanMarkup canonicalizes tags so a formatting comparison is stable", () => {
  assert.equal(n.cleanMarkup("<P>a <B>b</B> <I>c</I></P>"), "<p>a <strong>b</strong> <em>c</em></p>");
});

test("cleanMarkup sorts attributes so a reserialization is not a formatting change", () => {
  const a = '<a href="/x" id="y" title="z">t</a>';
  const b = '<a title="z" href="/x" id="y">t</a>';
  assert.equal(n.cleanMarkup(a), n.cleanMarkup(b));
});

test("cleanMarkup collapses whitespace outside pre and preserves it inside", () => {
  assert.equal(n.cleanMarkup("<p>a    b</p>"), "<p>a b</p>");
  assert.equal(n.cleanMarkup("<pre>a    b</pre>"), "<pre>a    b</pre>");
});

test("cleanMarkup closes tags the source left open", () => {
  assert.equal(n.cleanMarkup("<p>a<em>b"), "<p>a<em>b</em></p>");
});

test("cleanMarkup drops comments", () => {
  assert.equal(n.cleanMarkup("<p>a<!-- secret -->b</p>"), "<p>ab</p>");
});

test("cleanMarkup is idempotent", () => {
  const html = '<P CLASS="x lahe-h" style="color:red">Hi <B>b</B><span data-lahe="chrome">c</span></P>';
  const once = n.cleanMarkup(html);
  assert.equal(n.cleanMarkup(once), once);
});

test("markupEquals reports a formatting-only change as a change (R30)", () => {
  assert.equal(n.markupEquals("<p>the word</p>", "<p>the <strong>word</strong></p>"), false);
  assert.equal(n.markupEquals("<p>the <b>word</b></p>", "<p>the <strong>word</strong></p>"), true);
});

// ---------------------------------------------------------------------------
// canonicalTarget
// ---------------------------------------------------------------------------

test("canonicalTarget converges both loopback spellings, the trailing slash, and the fragment (R11)", () => {
  const a = n.canonicalTarget("http://localhost:3000/clients/").canonical;
  const b = n.canonicalTarget("http://127.0.0.1:3000/clients#anything").canonical;
  assert.equal(a, b);
  assert.equal(a, "http://localhost:3000/clients");
});

test("canonicalTarget keeps the root slash", () => {
  assert.equal(n.canonicalTarget("http://localhost:3000/").canonical, "http://localhost:3000/");
});

test("canonicalTarget drops a default port and keeps a query", () => {
  assert.equal(n.canonicalTarget("http://example.com:80/a?b=1").canonical, "http://example.com/a?b=1");
});

test("canonicalTarget resolves dot segments in a route path", () => {
  assert.equal(n.canonicalTarget("http://localhost:3000/a/../b").canonical, "http://localhost:3000/b");
});

test("canonicalTarget does NOT percent-decode a route path, because that is the traversal primitive", () => {
  const got = n.canonicalTarget("http://localhost:3000/a/%2e%2e%2fetc").canonical;
  assert.equal(got.indexOf("..") === -1, true, "a percent-encoded dot segment must not become a real one");
  assert.equal(got, "http://localhost:3000/a/%2E%2E%2Fetc");
});

test("canonicalTarget marks a remote host as not local", () => {
  assert.equal(n.canonicalTarget("http://example.com/a").isLocal, false);
  assert.equal(n.canonicalTarget("http://127.0.0.5:9/a").isLocal, true);
});

test("canonicalTarget normalizes a file path and reports whether symlinks were resolved", () => {
  const t = n.canonicalTarget("/tmp/./a/../b/index.html");
  assert.equal(t.kind, "file");
  assert.equal(t.canonical, "/tmp/b/index.html");
  assert.equal(t.resolved, false);
  assert.equal(n.canonicalTarget("/tmp/x.html", { resolved: true }).resolved, true);
});

test("canonicalTarget handles a file URL", () => {
  assert.equal(n.canonicalTarget("file:///tmp/a%20b.html").canonical, "/tmp/a b.html");
});

test("canonicalTarget refuses a relative path rather than guessing a base", () => {
  assert.throws(() => n.canonicalTarget("docs/index.html"), /absolute file path/);
  assert.throws(() => n.canonicalTarget(""), /non-empty string/);
});

// ---------------------------------------------------------------------------
// targetSlug
// ---------------------------------------------------------------------------

test("targetSlug can never contribute a path separator or a dot segment", () => {
  const nasty = [
    "http://localhost:3000/a/../../etc/passwd",
    "/tmp/../../../etc/passwd",
    "http://localhost:3000/%2e%2e%2f%2e%2e",
    "/a/b/..%2f..%2fCLAUDE.md"
  ];
  for (const input of nasty) {
    const slug = n.targetSlug(n.canonicalTarget(input).canonical);
    assert.match(slug, /^[a-z0-9-]+$/, `slug for ${input} was ${slug}`);
    assert.equal(slug.includes("/"), false);
    assert.equal(slug === "." || slug === "..", false);
    assert.equal(slug.length <= n.SLUG_MAX, true);
  }
});

test("targetSlug is readable for the ordinary case", () => {
  assert.equal(n.targetSlug("/Users/x/docs/02_architecture.html"), "02-architecture-html");
});

// ---------------------------------------------------------------------------
// The two comparison modes (ranked test 31)
// ---------------------------------------------------------------------------
//
// Ordinary records compare on normalized text. Format-only records compare on
// structure, because their whole point is a change the text normalizer is built
// to ignore. Two modes that are accidentally identical make the entire
// format-only branch of replay a silent no-op, so the bar is that they
// DISAGREE on a text-equal, structure-different pair.

test("the two comparison modes disagree on a text-equal structure-different pair", () => {
  const plain = "<p>The plan is ready now</p>";
  const bolded = "<p>The plan is <strong>ready</strong> now</p>";

  assert.equal(n.equalsInMode(n.MODE.TEXT, plain, bolded), true, "the text mode sees no change");
  assert.equal(n.equalsInMode(n.MODE.STRUCTURE, plain, bolded), false, "the structure mode sees the change");
});

test("the two comparison modes agree on a both-equal pair", () => {
  const a = "<p>The plan is <em>ready</em> now</p>";
  const b = "<p>The   plan is <i>ready</i> now</p>";
  assert.equal(n.equalsInMode(n.MODE.TEXT, a, b), true);
  assert.equal(n.equalsInMode(n.MODE.STRUCTURE, a, b), true);
});

test("the structure mode is defined against bold and italic and nothing else in v1", () => {
  assert.deepEqual(n.STRUCTURAL_TAGS, ["em", "strong"]);
  // A tag outside the closed list is not a structural difference.
  assert.equal(
    n.equalsInMode(n.MODE.STRUCTURE, "<p>a <span class=x>b</span> c</p>", "<p>a b c</p>"),
    true
  );
  // Bold and italic are, in both spellings.
  assert.equal(n.equalsInMode(n.MODE.STRUCTURE, "<p>a <b>b</b> c</p>", "<p>a <strong>b</strong> c</p>"), true);
  assert.equal(n.equalsInMode(n.MODE.STRUCTURE, "<p>a <b>b</b> c</p>", "<p>a <em>b</em> c</p>"), false);
});

test("the structure mode tells apart which words carry the emphasis", () => {
  assert.equal(
    n.equalsInMode(n.MODE.STRUCTURE, "<p><strong>a</strong> b</p>", "<p>a <strong>b</strong></p>"),
    false
  );
});

test("modeFor picks structure for a format-only record and text for everything else", () => {
  assert.equal(n.modeFor("format_only"), n.MODE.STRUCTURE);
  assert.equal(n.modeFor("edit"), n.MODE.TEXT);
  assert.equal(n.modeFor("comment"), n.MODE.TEXT);
});

test("equalsInMode refuses an unknown mode rather than guessing one", () => {
  assert.throws(() => n.equalsInMode("vibes", "<p>a</p>", "<p>a</p>"), /unknown comparison mode/);
});

// ---------------------------------------------------------------------------
// Deliberate breaks (Ken, 2026-08-20: "I just want to add a paragraph break
// and I've had this break on me")
// ---------------------------------------------------------------------------
//
// The crux is that ONE distinction has to survive: the whitespace a source
// carries because someone wrapped a line is incidental and folds, and the break
// a reviewer typed is content and does not. Lose the first half and every
// reformatted document reads as a change. Lose the second half and the
// reviewer's break is thrown away as a no-op, which is the bug that was
// reported.

test("blockText reads a break off the markup, in each shape a browser writes it", () => {
  // Enter in the middle of a paragraph, as Chromium writes it into a
  // contenteditable block: a nested <p> and an &nbsp;.
  assert.equal(n.blockText("Hello<p>&nbsp;world.</p>"), "Hello\n\nworld.");
  // Shift-Enter.
  assert.equal(n.blockText("Hello<br>&nbsp;world."), "Hello\nworld.");
  // Enter at the end of the block, then typing.
  assert.equal(n.blockText("Hello world.<p>Second para.</p>"), "Hello world.\n\nSecond para.");
  // Two blocks of any kind, and a list.
  assert.equal(n.blockText("<p>a</p><p>b</p>"), "a\n\nb");
  assert.equal(n.blockText("<ul><li>one</li><li>two</li></ul>"), "one\n\ntwo");
});

test("blockText folds the whitespace a source carries, and only that", () => {
  assert.equal(n.blockText("<p>Hello\n   world.</p>"), "Hello world.");
  assert.equal(n.blockText("<p>Hello    world.</p>"), "Hello world.");
  // Rewrapping a paragraph is not a change; typing a break is.
  assert.equal(n.blockText("<p>Hello\nworld.</p>") === n.blockText("<p>Hello world.</p>"), true);
  assert.equal(n.blockText("<p>Hello<br>world.</p>") === n.blockText("<p>Hello world.</p>"), false);
});

test("blockText keeps the whitespace inside a pre, where it is content", () => {
  assert.equal(n.blockText("<pre>line one\n   indented</pre>"), "line one\n   indented");
});

test("the text mode is break-aware, so a typed break is a change and a rewrap is not", () => {
  // Both of these are what the callers actually hold: block text, with the
  // breaks stated as newlines.
  assert.equal(n.equalsInMode(n.MODE.TEXT, "Hello world.", "Hello\n\nworld."), false);
  assert.equal(n.equalsInMode(n.MODE.TEXT, "Hello world.", "Hello world."), true);
  // Markup still works in the text mode, which is what a format-only record's
  // fields carry: the tags go and the words stay.
  assert.equal(n.equalsInMode(n.MODE.TEXT, "<p>Hello world.</p>", "Hello world."), true);
  assert.equal(n.equalsInMode(n.MODE.TEXT, "<p>Hello <strong>world.</strong></p>", "Hello world."), true);
  // The boundary between the two readers, stated so nobody trips on it: the
  // text mode does NOT fold the whitespace inside a text run, because a
  // record's text states its breaks with real newlines and folding them is the
  // bug. Markup reaches a record through blockText, which folds a source's line
  // wrap first, so nothing is ever recorded with an incidental newline in it.
  assert.equal(n.blockText("<p>Hello\n  world.</p>"), "Hello world.");
});

test("normalizeBlockText folds like normalizeText except that a break survives", () => {
  assert.equal(n.normalizeBlockText("  Hello   world.  "), "Hello world.");
  assert.equal(n.normalizeBlockText("Hello \n\n\n\n world."), "Hello\n\nworld.");
  assert.equal(n.normalizeBlockText("Hello\r\nworld."), "Hello\nworld.");
  // Idempotent, like every other key in this file.
  const once = n.normalizeBlockText("a \n\n\n b");
  assert.equal(n.normalizeBlockText(once), once);
  // normalizeText still folds the break away, which is what keeps anchoring
  // and the revert check whitespace-insensitive.
  assert.equal(n.normalizeText("Hello\n\nworld."), "Hello world.");
});

test("the two readers agree: markup in and a live node in give the same text", () => {
  // A minimal stand-in for the DOM, which is all blockTextFromNode asks for.
  function text(data) {
    return { nodeType: 3, data: data, nextSibling: null };
  }
  function el(tag, kids) {
    const node = { nodeType: 1, tagName: tag.toUpperCase(), firstChild: null };
    let prev = null;
    (kids || []).forEach(function (kid) {
      kid.nextSibling = null;
      if (prev) prev.nextSibling = kid;
      else node.firstChild = kid;
      prev = kid;
    });
    return node;
  }

  const split = el("p", [text("Hello"), el("p", [text(" world.")])]);
  assert.equal(n.blockTextFromNode(split), "Hello\n\nworld.");
  assert.equal(n.blockTextFromNode(split), n.blockText("Hello<p>&nbsp;world.</p>"));

  const line = el("p", [text("Hello"), el("br", []), text(" world.")]);
  assert.equal(n.blockTextFromNode(line), n.blockText("Hello<br>&nbsp;world."));

  // A wrapped source line is incidental on this side too.
  const wrapped = el("p", [text("Hello\n   world.")]);
  assert.equal(n.blockTextFromNode(wrapped), "Hello world.");

  // textContent would run these two words together into one made-up word.
  assert.equal(n.blockTextFromNode(el("div", [el("p", [text("Hello")]), el("p", [text("world.")])])), "Hello\n\nworld.");
});
