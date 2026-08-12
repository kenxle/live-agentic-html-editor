// Ranked test 33: failure chips. A chip appears, survives a remount, a
// navigation and a replay pass, and stays gone once dismissed.
//
// The reason a chip has to survive a remount is D7: the library re-creates its
// root on navigation, and a failure list that lives in the DOM is a failure
// list the reviewer loses the moment they click a link. So chips live in
// browser storage keyed by review, and the DOM is a rendering of them.
//
// DISMISSED STAYS DISMISSED, including against the same failure happening
// again. A chip that reappears on the next poll is the reviewer's own dismissal
// not working, and the underlying state is still on the status line, so
// dismissing hides the chip and never the truth.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, forceRepaints } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const REVIEW = "review-1";

function railUrl(server) {
  return server.urlFor("test/fixtures/rail.html") + "?" + new URLSearchParams({ review: REVIEW }).toString();
}

test.describe("failure chips", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "repo" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("a chip survives a remount, a navigation and a repaint, and stays gone once dismissed", async ({ page }) => {
    await page.goto(railUrl(pages));

    const added = await page.evaluate(() => window.__laheRail.addChip("HELPER_UNREACHABLE"));
    expect(added).toBe("HELPER_UNREACHABLE");
    expect(await page.evaluate(() => window.__laheRail.chips())).toHaveLength(1);

    // A remount: the rail's own root is thrown away and rebuilt, which is what
    // 2D does on navigation.
    await page.evaluate(() => window.__laheRail.remount());
    expect(
      await page.evaluate(() => window.__laheRail.chips().map((chip) => chip.code)),
      "the chip survives the rail being rebuilt"
    ).toEqual(["HELPER_UNREACHABLE"]);

    // A replay pass, standing in as twenty repaints of the page underneath.
    await forceRepaints(page, 3, { target: '[data-repaint-target="live"]' });
    expect(await page.evaluate(() => window.__laheRail.chips())).toHaveLength(1);

    // A navigation: a whole new document, same review, same storage.
    await page.goto(railUrl(pages));
    expect(
      await page.evaluate(() => window.__laheRail.chips().map((chip) => chip.code)),
      "and it survives the page being navigated"
    ).toEqual(["HELPER_UNREACHABLE"]);

    await page.evaluate(() => window.__laheRail.dismissChip("HELPER_UNREACHABLE"));
    expect(await page.evaluate(() => window.__laheRail.chips())).toHaveLength(0);

    // The same failure happens again, which is the ordinary case: a helper that
    // is down stays down and every poll fails.
    await page.evaluate(() => window.__laheRail.addChip("HELPER_UNREACHABLE"));
    expect(
      await page.evaluate(() => window.__laheRail.chips()),
      "a dismissed code does not come back on the next failure"
    ).toHaveLength(0);

    await page.goto(railUrl(pages));
    expect(
      await page.evaluate(() => window.__laheRail.chips()),
      "and it is still gone after a navigation"
    ).toHaveLength(0);

    // Dismissing hid the chip, not the truth: a different failure still shows.
    await page.evaluate(() => window.__laheRail.addChip("CSP_REFUSED"));
    expect(await page.evaluate(() => window.__laheRail.chips().map((chip) => chip.code))).toEqual([
      "CSP_REFUSED"
    ]);
  });

  test("a repeated failure counts up on one chip rather than stacking duplicates", async ({ page }) => {
    await page.goto(railUrl(pages));
    await page.evaluate(() => {
      window.__laheRail.addChip("HELPER_UNREACHABLE");
      window.__laheRail.addChip("HELPER_UNREACHABLE");
      window.__laheRail.addChip("HELPER_UNREACHABLE");
    });
    const chips = await page.evaluate(() => window.__laheRail.chips());
    expect(chips).toHaveLength(1);
    expect(chips[0].count).toBe(3);
  });
});
