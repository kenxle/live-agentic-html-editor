// Markdown through pandoc in a real browser (docs/features/20261017.02_pandoc_render).
//
// Two things only a browser answers. A rendered page with fenced divs draws
// them as house components (the panels have the house look, and no ::: line
// is left on screen). And on a machine with no pandoc, the rail tells the
// reader why the boxes are plain text, in Ken's words, while a page that
// needed nothing from pandoc shows no line at all.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");
const markdown = require("../../src/service/markdown.js");
const pandoc = require("../../src/service/pandoc.js");

const REVIEW = "markdown-pandoc";
const RAIL_TEXT = "Ask your agent to install pandoc to get the correct styles";

function withPandocEnv(values, fn) {
  const saved = {};
  Object.keys(values).forEach((key) => {
    saved[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  });
  pandoc.reset();
  try {
    return fn();
  } finally {
    Object.keys(saved).forEach((key) => {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    });
    pandoc.reset();
  }
}

const HAVE_PANDOC = withPandocEnv({ LAHE_MARKDOWN_ENGINE: undefined, LAHE_PANDOC: undefined }, () => !!pandoc.locate().path);

const FENCED = [
  "# Brief",
  "",
  "## Requirements",
  "",
  "::: callout-req",
  "**R1.** One.",
  ":::",
  "",
  "::: callout-question",
  "Which one?",
  ":::",
  "",
  ":::: cardgrid",
  "::: card",
  "**First**",
  "",
  "Body.",
  ":::",
  "::::"
].join("\n");

function scriptTag(helperOrigin, token) {
  const attrs = protocol.SCRIPT_ATTR;
  return '<script src="' + helperOrigin + '/lahe-layer.js" ' + attrs.REVIEW + '="' + REVIEW + '" ' +
    attrs.TOKEN + '="' + token + '" ' + attrs.HELPER + '="' + helperOrigin + '"></script>\n';
}

// A rendered artifact, renamed into the served folder, with the layer's
// script line added the way a page under review carries it.
function servedPage(dir, state, name, text, env, helper) {
  const source = path.join(dir, name + ".md");
  fs.writeFileSync(source, text);
  const artifact = withPandocEnv(env, () => markdown.writeArtifact(state, "s_pandoc", source));
  let html = fs.readFileSync(artifact.target, "utf8");
  if (helper) html = html.replace("</body>", scriptTag(helper.url, helper.token) + "</body>");
  fs.writeFileSync(path.join(path.dirname(artifact.target), name + ".html"), html);
  return { folder: path.dirname(artifact.target), file: name + ".html" };
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

test("fenced divs draw as house components, with no ::: line left on the page", async ({ page }) => {
  test.skip(!HAVE_PANDOC, "pandoc 3 is not installed here");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-pandoc-browser-"));
  const served = servedPage(dir, path.join(dir, "state"), "brief", FENCED, { LAHE_MARKDOWN_ENGINE: undefined, LAHE_PANDOC: undefined });
  const server = await startStaticServer({ root: served.folder, label: "markdown-pandoc" });
  try {
    await page.goto(server.origin + "/" + served.file);
    await expect(page.locator("p.eyebrow", { hasText: "Requirement" })).toBeVisible();
    // The caveat panel is the purple tint, --emphasis-tint #f1ebfa.
    await expect(page.locator(".insight.insight--caveat")).toHaveCSS("background-color", "rgb(241, 235, 250)");
    await expect(page.locator(".cards > .card h4")).toHaveText("First");
    const fenceLines = await page.evaluate(() => document.body.innerText.split("\n").filter((line) => /^\s*:{3,}/.test(line)));
    expect(fenceLines).toEqual([]);
  } finally {
    await server.close();
  }
});

test.describe("the rail says when pandoc is missing", () => {
  let dir;
  let pages;
  let service;
  let withNote;
  let withoutNote;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-pandoc-rail-"));
    const state = path.join(dir, "state");
    // Both pages land in the same artifacts folder, so one server serves both.
    const probe = servedPage(dir, state, "probe", "# p\n", { LAHE_PANDOC: "none" }, null);
    pages = await startStaticServer({ root: probe.folder, label: "markdown-pandoc-rail" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    const helper = { url: service.url, token: service.tokenFor(REVIEW) };
    const missing = { LAHE_MARKDOWN_ENGINE: undefined, LAHE_PANDOC: "none" };
    withNote = servedPage(dir, state, "fenced", FENCED, missing, helper);
    withoutNote = servedPage(dir, state, "plain", "# Plain\n\nNo fences here.\n", missing, helper);
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("a page whose fenced divs show as text gets Ken's line", async ({ page }) => {
    await page.goto(pages.origin + "/" + withNote.file);
    await booted(page);
    const info = await page.evaluate(() => window.__lahe.handle.rail.renderNoteInfo());
    expect(info.present).toBe(true);
    expect(info.visible).toBe(true);
    expect(info.text).toBe(RAIL_TEXT);
    // The progress page's picture of the line, taken in the run that proves it.
    if (process.env.LAHE_SHOT_DIR) await page.screenshot({ path: path.join(process.env.LAHE_SHOT_DIR, "rail_pandoc_note.png") });
    await page.goto("about:blank");
  });

  test("a page with no fenced div shows no line", async ({ page }) => {
    await page.goto(pages.origin + "/" + withoutNote.file);
    await booted(page);
    const info = await page.evaluate(() => window.__lahe.handle.rail.renderNoteInfo());
    expect(info.visible).toBe(false);
    await page.goto("about:blank");
  });
});
