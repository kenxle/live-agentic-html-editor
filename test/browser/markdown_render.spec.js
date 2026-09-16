"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, startStaticServer } = require("../helpers");
const markdown = require("../../src/service/markdown.js");
const staticServers = require("../../src/service/static_servers.js");

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

    // Mermaid picks its own lavender unless it is handed a palette, and the
    // stylesheet cannot reach inside the SVG it draws. #ECECFF is that stock
    // fill; #e6effc is cobalt-tint, which is what the theme asks for.
    const fills = await page.evaluate(() => Array.from(
      document.querySelectorAll(".mermaid svg rect, .mermaid svg polygon"),
      (node) => getComputedStyle(node).fill
    ));
    expect(fills.length).toBeGreaterThan(0);
    expect(fills).not.toContain("rgb(236, 236, 255)");
    expect(fills).toContain("rgb(230, 239, 252)");
  } finally {
    await server.close();
  }
});

// The point of the structure pass: a rendered document is built out of the
// document style's own components, so document.css's chrome applies without
// this repo restating any of it. The hanging rule over a section head is the
// visible half of that, and it comes from a stylesheet we never edit.
test("a rendered section carries document.css's hanging rule", async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-markdown-sheet-"));
  const state = path.join(root, "state");
  const source = path.join(root, "REPORT.md");
  fs.writeFileSync(source, [
    "# Replay branches",
    "",
    "A lede paragraph.",
    "",
    "## The clean path",
    "",
    "Text."
  ].join("\n"));
  const artifact = markdown.writeArtifact(state, "s_sheet", source);
  const server = await startStaticServer({ root: path.dirname(artifact.target), label: "markdown-sheet" });

  try {
    await page.goto(server.origin + "/" + path.basename(artifact.target));
    await expect(page.locator("div.wrap.hero h1")).toHaveText("Replay branches");
    await expect(page.locator("section.sheet")).toHaveCount(1);
    await expect(page.locator("section.sheet .sheet-head .n")).toHaveText("Section 1");
    // --divider is 2px solid ink, and it is the only border on the head.
    await expect(page.locator("section.sheet .sheet-head"))
      .toHaveCSS("border-top", "2px solid rgb(31, 30, 26)");
  } finally {
    await server.close();
  }
});

// The style is inlined into a rendered artifact, but the faces are not: they
// are three files copied beside it. This is the check that the copy lands and
// the browser actually uses them, rather than falling back to system-ui and
// nobody noticing until a document looks wrong in front of Ken.
test("a rendered document is set in the vendored faces", async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-markdown-fonts-"));
  const state = path.join(root, "state");
  const source = path.join(root, "REPORT.md");
  fs.writeFileSync(source, ["# A rendered heading", "", "One paragraph of body copy.", "", "`inline code`"].join("\n"));
  const artifact = markdown.writeArtifact(state, "s_fonts", source);
  const server = await startStaticServer({ root: path.dirname(artifact.target), label: "markdown-fonts" });

  try {
    await page.goto(server.origin + "/" + path.basename(artifact.target));
    await page.evaluate(() => document.fonts.ready);

    const heading = page.locator("h1");
    await expect(heading).toHaveCSS("font-family", /^"?Schibsted Grotesk"?/);
    await expect(page.locator("code")).toHaveCSS("font-family", /^"?JetBrains Mono"?/);

    // toHaveCSS only proves the declaration won. This proves the woff2 loaded.
    const loaded = await page.evaluate(() => ({
      display: document.fonts.check('600 20px "Schibsted Grotesk"'),
      body: document.fonts.check('400 17px "Hanken Grotesk"'),
      mono: document.fonts.check('400 15px "JetBrains Mono"')
    }));
    expect(loaded).toEqual({ display: true, body: true, mono: true });
  } finally {
    await server.close();
  }
});

// The other half of the "one copy, two ways to reach it" decision. A page an
// agent wrote for review links ./.lahe-doc-style.css, and the directory it sits
// in has no such file. The helper answers it from the vendored copy, the same
// basename fallback the Mermaid script already relies on.
test("an agent-authored page gets the document style from the helper", async ({ page }) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-doc-style-"));
  const state = path.join(root, "state");
  fs.writeFileSync(path.join(root, "page.html"), [
    "<!doctype html>",
    '<html lang="en"><head><meta charset="utf-8"><title>Options</title>',
    '<link rel="stylesheet" href="./.lahe-doc-style.css">',
    "</head><body><main><h1>Three options</h1><p>Pick one.</p></main></body></html>"
  ].join("\n"));

  const started = await staticServers.start({ dir: state, sessionId: "s_doc_style", root });
  try {
    const origin = "http://" + started.meta.host + ":" + started.meta.port;

    const css = await page.request.get(origin + "/.lahe-doc-style.css");
    expect(css.status()).toBe(200);
    expect(css.headers()["content-type"]).toMatch(/^text\/css/);
    expect(await css.text()).toContain("--ink:#1f1e1a");

    const font = await page.request.get(origin + "/.lahe-fonts/schibsted-grotesk-variable.woff2");
    expect(font.status()).toBe(200);
    expect(font.headers()["content-type"]).toBe("font/woff2");

    await page.goto(origin + "/page.html");
    await page.evaluate(() => document.fonts.ready);
    await expect(page.locator("h1")).toHaveCSS("font-family", /^"?Schibsted Grotesk"?/);
  } finally {
    await staticServers.stopAll(state, "s_doc_style");
  }
});
