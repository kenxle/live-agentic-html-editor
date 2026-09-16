"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const markdown = require("../../src/service/markdown.js");

test("Markdown rendering preserves block structure, applies reading styles, and prepares Mermaid", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-markdown-render-"));
  const source = path.join(root, "SKILL.md");
  fs.writeFileSync(source, [
    "---",
    "name: example",
    "---",
    "",
    "# Workflow",
    "",
    "- Prior bullet",
    "",
    "The main agent acts as Product Manager. Your role is to ensure that the feature is fully documented, that agents can follow it, and that it works.",
    "",
    "![Diagram](assets/diagram.png)",
    "",
    "```mermaid",
    "flowchart TD",
    "  A --> B",
    "```",
    "",
    "```js",
    "const untouched = true;",
    "```",
    "",
    "[External](https://example.com)"
  ].join("\n"));

  const html = markdown.render(source);
  assert.match(html, /<ul>\s*<li>Prior bullet<\/li>\s*<\/ul>\s*<p>The main agent acts/);
  assert.doesNotMatch(html, /<li>Prior bullet[\s\S]*The main agent acts[\s\S]*<\/li>/);
  assert.match(html, /<summary>Document metadata<\/summary>/);
  assert.match(html, /src="\/\.lahe-source\/[a-f0-9]+\/assets\/diagram\.png"/);
  assert.match(html, /href="https:\/\/example\.com"/);
  // The document style is inlined rather than linked, so a rendered artifact
  // moved off the helper still looks right. These two tokens stand in for the
  // whole vendored bundle: the first is from system-tokens.css, the second is
  // the one accent the guide allows.
  assert.match(html, /--ink:#1f1e1a/, "generated Markdown carries the St. Clair AI tokens");
  assert.match(html, /--purple:#46188c/, "generated Markdown carries the St. Clair AI tokens");
  assert.match(html, /max-width: ?var\(--read\)/, "the reading measure comes from the --read token");
  assert.match(html, /color-scheme: ?light/, "the document style is light only");
  // Light only was a decision, not an oversight. The old renderer shipped a
  // dark palette; nothing in the bundle may ask the browser for a scheme.
  assert.doesNotMatch(html, /prefers-color-scheme/, "no dark palette survives in the document style");
  assert.match(html, /@font-face/, "the vendored faces are declared");
  assert.match(html, /\.lahe-fonts\/schibsted-grotesk-variable\.woff2/);
  assert.match(html, /<pre class="mermaid">flowchart TD\n  A --&gt; B<\/pre>/);
  assert.match(html, /\.lahe-mermaid-11\.16\.1\.js/);
  assert.match(html, /mermaid\.initialize\(\{[^)]*"securityLevel":"strict"/);
  assert.match(html, /"theme":"base"/, "diagrams draw in the document palette, not Mermaid's own");
  assert.match(html, /<pre><code class="language-js">const untouched = true;<\/code><\/pre>/);
});

// The page shape. It is the same shape build_styled_doc.py builds in the
// personal repo, and the reason a rendered .md and one of Ken's reference
// documents look like the same thing rather than the same typeface.
function renderSource(prefix, lines) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const source = path.join(root, "DOC.md");
  fs.writeFileSync(source, lines.join("\n"));
  return markdown.render(source);
}

test("a document becomes a hero and one numbered section per H2", () => {
  const html = renderSource("lahe-markdown-shape-", [
    "# Replay branches",
    "",
    "What happens when an edit cannot be replayed.",
    "",
    "## The clean path",
    "",
    "Text.",
    "",
    "## The drifted path",
    "",
    "| case | result |",
    "| --- | --- |",
    "| moved | re-anchor |",
    "",
    "- a bullet",
    "",
    "1. a step",
    "",
    "## The lost path",
    "",
    "```sh",
    "## this is a shell comment, not a heading",
    "```"
  ]);

  const hero = html.match(/<div class="hero">([\s\S]*?)<\/div>/);
  assert.notEqual(hero, null, "the hero wrapper is emitted");
  assert.match(hero[1], /<h1>Replay branches<\/h1>/, "the first H1 is the hero title");
  assert.match(hero[1], /<p>What happens when an edit cannot be replayed\.<\/p>/,
    "everything up to the first H2 is the lede, and it sits in the hero");

  assert.equal(html.match(/<section class="sheet[^"]*">/g).length, 3,
    "three H2s open three sections, and the fenced '## ' line opens none");
  assert.doesNotMatch(html, /class="sheet first"/, "there is a lede, so the first section keeps its top padding");
  for (const n of [1, 2, 3]) {
    assert.match(html, new RegExp('<span class="n">Section ' + n + "</span>"),
      "sections are numbered from 1 in document order");
  }
  assert.match(html, /<div class="sheet-head"><h2>The clean path<\/h2>/, "the H2 is the section's head");
  assert.match(html, /<pre><code class="language-sh">## this is a shell comment/,
    "the fenced line stays code");

  assert.match(html, /<div class="scrollx"><table>/, "a table is wrapped for horizontal scroll");
  // The renderer stopped writing class="dot": document.css draws the dot on a
  // class-free ul, so a class here would opt the list OUT of the house look.
  assert.match(html, /<ul>\s*<li>a bullet<\/li>/, "an unordered list is left bare");
  assert.match(html, /<ol>\s*<li>a step<\/li>/, "an ordered list is left bare");
  assert.doesNotMatch(html, /class="dot"/, "no list carries the old dot class");
  assert.doesNotMatch(html, /class="wrap/, "the hero no longer carries the old wrap class");
});

test("a section that follows the title with nothing in between hangs its rule under it", () => {
  const html = renderSource("lahe-markdown-first-", ["# Straight in", "", "## First thing", "", "Text."]);
  assert.match(html, /<section class="sheet first">/,
    "no lede means the first section drops its top padding");
});

test("a heading keeps its inline markup, and a document with no H1 still gets a hero", () => {
  const withMarkup = renderSource("lahe-markdown-inline-", [
    "# Title",
    "",
    "## The `render` function and [the doc](https://example.com)"
  ]);
  assert.match(withMarkup, /<h2>The <code>render<\/code> function and <a href="https:\/\/example\.com">the doc<\/a><\/h2>/,
    "a code span or a link in an H2 survives into the sheet head");

  const noTitle = renderSource("lahe-markdown-notitle-", ["Just a paragraph.", "", "## A section", "", "Text."]);
  assert.match(noTitle, /<div class="hero">\s*<h1>DOC\.md<\/h1>/,
    "with no H1 the hero falls back to the title the renderer already computes");
  assert.match(noTitle, /<div class="hero">[\s\S]*<p>Just a paragraph\.<\/p>/,
    "content before the H1 goes into the lede rather than vanishing");
});

test("the document style is one bundle, and a written artifact carries its own faces", () => {
  const css = markdown.styleSheet();

  // The three vendored files are joined into one string. document.css opens
  // with an @import of the tokens, which is right when the two are separate
  // files and wrong here: an @import has to come before every other rule, and
  // the tokens are already above it. The join drops that line.
  assert.doesNotMatch(css, /@import/, "no @import survives in the middle of the bundle");
  assert.match(css, /--read:68ch/, "the tokens file leads");
  assert.match(css, /ul:where\(:not\(\[class\]\), \.dot\)/, "document.css follows it");
  assert.match(css, /\.lahe-readonly-note/, "LAHE's own layer comes last");

  // The column is declared once, by the base, as a rule about the page. The
  // layer used to declare a second one on body > main at 68 characters, and
  // the two drifted apart, which is what this refresh ended. The font size
  // went the same way: the rebuilt scale has no 16px step to restate.
  assert.equal(css.match(/max-width:\s*var\(--maxw\)/g).length, 1,
    "exactly one rule sets the page column, and it is the base's");
  assert.doesNotMatch(css, /font-size:\s*16px/, "no rule in the bundle hard-codes a body size");
  assert.doesNotMatch(css, /body\s*>\s*main/, "nothing sets a second column on main");

  // A rendered artifact inlines the CSS, so the only thing it still reaches for
  // is the type. writeArtifact copies the faces beside it, which is what lets
  // the file be opened from disk with no helper running and still look right.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-markdown-fonts-"));
  const source = path.join(root, "NOTE.md");
  fs.writeFileSync(source, "# Note\n\nOne paragraph.\n");
  const artifact = markdown.writeArtifact(path.join(root, "state"), "s_fonts", source);
  const fontDir = path.join(path.dirname(artifact.target), markdown.FONT_ASSET_DIR);
  for (const name of markdown.FONT_ASSETS) {
    assert.equal(fs.existsSync(path.join(fontDir, name)), true, name + " is copied beside the artifact");
  }
});
