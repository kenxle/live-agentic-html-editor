"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, startStaticServer } = require("../helpers");
const markdown = require("../../src/service/markdown.js");

test("a fenced Mermaid flowchart renders as a diagram in generated Markdown HTML", async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-markdown-browser-"));
  const state = path.join(root, "state");
  const source = path.join(root, "SKILL.md");
  fs.writeFileSync(source, [
    "# Feature flow",
    "",
    "```mermaid",
    "flowchart TD",
    "  P0[Setup] --> P1[Review]",
    "```"
  ].join("\n"));
  const artifact = markdown.writeArtifact(state, "s_browser", source);
  const server = await startStaticServer({ root: path.dirname(artifact.target), label: "markdown-render" });

  try {
    await page.goto(server.origin + "/" + path.basename(artifact.target));
    await expect(page.locator(".mermaid svg")).toBeVisible();
    await expect(page.locator(".mermaid")).toContainText("Setup");
    await expect(page.locator("pre code")).toHaveCount(0);
  } finally {
    await server.close();
  }
});
