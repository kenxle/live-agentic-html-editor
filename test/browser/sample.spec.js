// Trivial passing browser test. Proves the browser test harness (Playwright,
// Chromium only) actually loads a real page in a real browser and can assert
// on it. Replace/extend once the review layer lands.

const { test, expect } = require("@playwright/test");
const path = require("node:path");

const fixture = path.join(__dirname, "..", "fixtures", "sample.html");

test("the static fixture page loads and has the expected headline", async ({ page }) => {
  await page.goto(`file://${fixture}`);
  await expect(page).toHaveTitle("Sample Review Target");
  await expect(page.locator("#headline")).toHaveText("Sample Review Target");
  await expect(page.locator("#list li")).toHaveCount(3);
});
