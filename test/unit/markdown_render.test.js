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
  assert.match(html, /max-width: ?calc\(var\(--read\)/, "the reading column comes from the --read token");
  assert.match(html, /color-scheme: ?light/, "the document style is light only");
  // Light only was a decision, not an oversight. The old renderer shipped a
  // dark palette; nothing in the bundle may ask the browser for a scheme.
  assert.doesNotMatch(html, /prefers-color-scheme/, "no dark palette survives in the document style");
  assert.match(html, /@font-face/, "the vendored faces are declared");
  assert.match(html, /\.lahe-fonts\/schibsted-grotesk-variable\.woff2/);
  assert.match(html, /<pre class="mermaid">flowchart TD\n  A --&gt; B<\/pre>/);
  assert.match(html, /\.lahe-mermaid-11\.16\.1\.js/);
  assert.match(html, /mermaid\.initialize\(\{startOnLoad:true,securityLevel:"strict"\}\)/);
  assert.match(html, /<pre><code class="language-js">const untouched = true;<\/code><\/pre>/);
});

test("the document style is one bundle, and a written artifact carries its own faces", () => {
  const css = markdown.styleSheet();

  // The three vendored files are joined into one string. document.css opens
  // with an @import of the tokens, which is right when the two are separate
  // files and wrong here: an @import has to come before every other rule, and
  // the tokens are already above it. The join drops that line.
  assert.doesNotMatch(css, /@import/, "no @import survives in the middle of the bundle");
  assert.match(css, /--read:68ch/, "the tokens file leads");
  assert.match(css, /ul\.dot/, "document.css follows it");
  assert.match(css, /body > main/, "LAHE's own layer comes last");

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
