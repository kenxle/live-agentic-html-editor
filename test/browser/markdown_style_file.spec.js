"use strict";

// A rendered Markdown file that names an installed style carries the style's
// stylesheet and fonts beside it, so the file opened straight from disk, with
// no Lahe running, still shows the style through its relative paths.
//
// Plan row V24 (R8, a saved file), in
// docs/features/20260930.01_style_switcher/03_plan_style_switcher.md.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const { test, expect } = require("../helpers");
const markdown = require("../../src/service/markdown.js");
const styles = require("../../src/service/styles.js");

const FIXTURES = path.join(__dirname, "..", "fixtures", "styles");

/** A state directory with the fixture style installed, and a rendered artifact. */
function renderWith(frontmatter) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-style-file-"));
  const state = path.join(root, "state");
  const copy = path.join(root, "src", "sample");
  fs.cpSync(path.join(FIXTURES, "sample"), copy, { recursive: true });
  const installed = styles.install(state, copy);
  if (!installed.ok) throw new Error(installed.reason);
  const source = path.join(root, "work", "doc.md");
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, frontmatter + "# A styled document\n\nSome words in the body.\n\n## A section\n\nMore words.\n");
  return markdown.writeArtifact(state, "s_style_file", source).target;
}

async function pageLook(page) {
  return page.evaluate(async () => {
    await document.fonts.ready;
    const body = getComputedStyle(document.body);
    const sample = Array.from(document.fonts).filter((face) => face.family.replace(/"/g, "") === "Sample Face");
    return {
      background: body.backgroundColor,
      color: body.color,
      fontFamily: body.fontFamily,
      sampleFaceStatus: sample.map((face) => face.status),
      sampleFaceUsable: document.fonts.check("16px \"Sample Face\"")
    };
  });
}

test("V24: a saved file shows the style's colours and font through its relative paths", async ({ page }) => {
  const target = renderWith("---\nlahe-style: sample\n---\n");
  await page.goto(pathToFileURL(target).href);
  const look = await pageLook(page);
  // #fbf3e4 and #2b1d0e, the fixture's page ground and ink.
  expect(look.background).toBe("rgb(251, 243, 228)");
  expect(look.color).toBe("rgb(43, 29, 14)");
  expect(look.fontFamily).toMatch(/^"Sample Face"/);
  expect(look.sampleFaceStatus).toContain("loaded");
  expect(look.sampleFaceUsable).toBe(true);
});

test("V24: the same document with no style line keeps the house look", async ({ page }) => {
  const target = renderWith("");
  await page.goto(pathToFileURL(target).href);
  const look = await pageLook(page);
  expect(look.background).not.toBe("rgb(251, 243, 228)");
  expect(look.fontFamily).not.toMatch(/Sample Face/);
});
