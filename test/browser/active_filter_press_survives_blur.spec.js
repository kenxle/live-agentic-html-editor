// A press on the filter button is not lost to the blur that starts it.
//
// WebKit blurs a script-focused button at mousedown. The rail listens for
// focusout and repaints its tabs and filter; when that repaint rewrote the
// button's label with the same words it swapped the text node under the
// pointer, and WebKit then dropped the click. In Safari the second press on
// the filter button (after a pick had returned focus to it) did nothing.
//
// The assertion is on the cause, so it fails in every lane: a focusout leaves
// the label's, the tab counts' and the pill's text nodes where they were.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");

test.describe("a repaint on focusout", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "filter-press-blur" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("keeps the text nodes under the pointer", async ({ page }) => {
    await page.goto(pages.urlFor("test/fixtures/edits-tab-doc.html") + "?review=review-press-blur");
    await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, { message: "the boot" });
    const result = await page.evaluate(() => {
      window.__laheEdits.deleteBlock("gone");
      window.__lahe.rail.collapse(false);
      window.__lahe.rail.selectTab("active");
      window.__lahe.rail.setActiveFilter("edits");
      const pane = window.__lahe.rail.tabBody("active");
      const root = pane.getRootNode();
      const label = pane.querySelector(".filterbtn__label");
      const count = root.querySelector('[role="tab"][data-tab="active"] .count');
      const nodes = [label.firstChild, count.firstChild];
      pane.querySelector("[data-lahe-filter-toggle]").focus();
      pane.querySelector("[data-lahe-filter-toggle]").blur();
      return {
        label: label.textContent,
        sameLabelNode: label.firstChild === nodes[0],
        sameCountNode: count.firstChild === nodes[1]
      };
    });
    expect(result.label, "a pick is named on the button").toBe("Edits");
    expect(result.sameLabelNode, "the label's text node survives a focusout").toBe(true);
    expect(result.sameCountNode, "the tab count's text node survives a focusout").toBe(true);
  });
});
