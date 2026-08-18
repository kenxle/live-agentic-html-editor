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
  assert.match(html, /max-width:52rem/, "generated Markdown gets the neutral reading style");
  assert.match(html, /<pre class="mermaid">flowchart TD\n  A --&gt; B<\/pre>/);
  assert.match(html, /\.lahe-mermaid-11\.16\.1\.js/);
  assert.match(html, /mermaid\.initialize\(\{startOnLoad:true,securityLevel:"strict"\}\)/);
  assert.match(html, /<pre><code class="language-js">const untouched = true;<\/code><\/pre>/);
});
