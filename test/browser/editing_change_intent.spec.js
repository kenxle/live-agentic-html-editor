// Finding 7 (cluster C2): the edit commit populates the `change` intent field.
//
// The tool's primary gesture is "fix this sentence". Before this fix, a
// committed edit shipped the agent NO intent field at all: both `note` and
// `change` projected null, and the only thing describing the reviewer's vetted
// change was the data-class, 2000-char-bounded `after_full`/`before` the
// contract explicitly tells the agent never to treat as an instruction. That is
// the exact D12 laundering the redraw exists to prevent.
//
// This drives a REAL edit through the real commit path (caret, Cmd-Shift-E, real
// keystrokes, Esc) and then through the real projection, and asserts `change` is
// non-null and carried verbatim. The existing unit tests hand-build items with
// `change` already set, which is why this gap stayed green.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage, placeCaret } = require("../helpers");
const reviewFormat = require("../../src/shared/review_format.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/editing-doc.html";

const ORIGINAL_ALPHA = "Runners come back too fast after a layoff.";
const ADDED = " Most of them know it while they are doing it.";

async function editBlockWithCaret(page, selector) {
  await placeCaret(page, { selector: selector, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__laheEdit.isEditing(), undefined, {
    message: "Cmd-Shift-E to put the block under the caret into edit state"
  });
}

async function typeAtEnd(page, selector, text) {
  const length = await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await placeCaret(page, { selector: selector, offset: length });
  await page.keyboard.type(text, { delay: 20 });
}

async function commitWithEscape(page) {
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
    message: "Esc to commit the edit and give the block back to the page"
  });
}

test.describe("2A: an edit commit carries a real intent field (finding 7, C2)", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "change-intent" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("a committed edit sets `change`, and the projection carries it verbatim", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=edit-change");

    await editBlockWithCaret(page, "#alpha");
    await typeAtEnd(page, "#alpha", ADDED);
    await commitWithEscape(page);

    const items = await page.evaluate(() => window.__laheEdit.items());
    expect(items, "one edit session is one record").toHaveLength(1);
    const item = items[0];

    // The gap this test exists for. Before the fix this is null.
    expect(item.change, "the edit commit populates the intent field").not.toBeNull();
    expect(typeof item.change).toBe("string");
    expect(item.change.length).toBeGreaterThan(0);
    // The reviewer's own words (what they added) are inside it.
    expect(item.change).toContain(ADDED.trim());

    // Through the REAL projection: the intent field is carried verbatim, never
    // truncated, never cleaned up (D12).
    const review = {
      id: "edit-change",
      generated_at: "2026-08-12T00:00:00.000Z",
      started_at: "2026-08-12T00:00:00.000Z",
      ended_at: null,
      items: [item]
    };
    const projected = reviewFormat.projectReview(review);
    const projectedItem = projected.pages[0].items[0];
    expect(projectedItem.change, "change survives projection byte for byte").toBe(item.change);
    expect(reviewFormat.INTENT_FIELDS).toContain("change");
  });

  test("a long edit keeps its intent whole while the page-text field is bounded", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=edit-change-long");

    // A replacement longer than the data bound, inserted as one real input
    // event (char-by-char typing of 2000+ chars is too slow to be worth it; the
    // input handler is the same path).
    const longAdd = " " + "lengthen this considerably ".repeat(120); // ~3000 chars
    await editBlockWithCaret(page, "#beta");
    const length = await page.evaluate(() => document.querySelector("#beta").textContent.length);
    await placeCaret(page, { selector: "#beta", offset: length });
    await page.keyboard.insertText(longAdd);
    await commitWithEscape(page);

    const item = (await page.evaluate(() => window.__laheEdit.items()))[0];
    expect(item.change, "even a long edit carries an intent field").not.toBeNull();

    const projected = reviewFormat.projectReview({
      id: "edit-change-long",
      generated_at: "2026-08-12T00:00:00.000Z",
      started_at: "2026-08-12T00:00:00.000Z",
      ended_at: null,
      items: [item]
    }).pages[0].items[0];

    // Intent is never truncated.
    expect(projected.change).toBe(item.change);
    expect(projected.change.includes(reviewFormat.TRUNCATION_MARKER.split("{n}")[0])).toBe(false);
    // Page text is bounded and says so.
    expect(projected.after_full.length).toBeLessThanOrEqual(item.after.length);
    expect(projected.after_full.includes(reviewFormat.TRUNCATION_MARKER.split("{n}")[0])).toBe(true);
  });
});
