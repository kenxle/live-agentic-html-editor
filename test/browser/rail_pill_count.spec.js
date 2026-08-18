// The collapsed pill's burn-down: still to handle, then the all-time total.
//
// The pill is what a reviewer sees for most of a session, because the rail
// spends most of it collapsed. With only the open count on it there was no
// sense of how much was on the page and no sign the tool was alive: a reviewer
// who had answered everything and one who had never written anything saw the
// same empty pill. "3 (7)" says both things, and "0 (7)" is the finished state
// rather than a blank.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");

async function pillCount(page) {
  return page.evaluate(() => window.__laheRail.geometry().pillCount);
}

test.describe("1B: the collapsed pill counts what is left, and what there was", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ root: REPO_ROOT, label: "rail-pill" });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("the pill shows open (total), updates live, and burns down to 0 (n)", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html"));

    // Nothing written yet: an empty pill invites, it does not report a zero.
    await page.evaluate(() => window.__laheRail.collapse(true));
    await pollPage(page, () => window.__laheRail.geometry().pillVisible === true, undefined, {
      message: "the collapsed pill to be on screen"
    });
    expect(await pillCount(page), "an untouched page prints no number").toBe("");

    // The reviewer writes two comments, which happens with the rail open.
    await page.evaluate(() => window.__laheRail.collapse(false));
    const first = await page.evaluate(() => window.__laheRail.openCard());
    await page.keyboard.type("The heading promises a summary", { delay: 5 });
    await page.evaluate((id) => window.__laheRail.markReady(id), first.id);
    const second = await page.evaluate(() => window.__laheRail.openCard());
    await page.keyboard.type("And the footer date is wrong", { delay: 5 });
    await page.evaluate((id) => window.__laheRail.markReady(id), second.id);

    await page.evaluate(() => window.__laheRail.collapse(true));
    expect(await pillCount(page), "two items, none handled").toBe("2 (2)");

    // An agent answers one of them: it moves to Done, so it comes off the
    // left-hand number and stays in the total, live, with the rail collapsed.
    await page.evaluate((id) => window.__laheRail.setCardState(id, "handled"), first.id);
    expect(await pillCount(page), "a handled item burns down, and the total remembers it").toBe("1 (2)");

    await page.evaluate((id) => window.__laheRail.setCardState(id, "handled"), second.id);
    expect(await pillCount(page), "everything done reads zero over the total, not blank").toBe("0 (2)");
  });

  test("the pill opens the rail when it is clicked", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html"));
    const opened = await page.evaluate(() => window.__laheRail.openCard());
    await page.keyboard.type("One thing to fix", { delay: 5 });
    await page.evaluate((id) => window.__laheRail.markReady(id), opened.id);
    await page.evaluate(() => window.__laheRail.collapse(true));
    await pollPage(page, () => window.__laheRail.geometry().pillVisible === true, undefined, {
      message: "the collapsed pill to be on screen"
    });

    const box = await page.evaluate(() => window.__laheRail.geometry().pill);
    await page.mouse.click(box.left + (box.right - box.left) / 2, box.top + (box.bottom - box.top) / 2);

    await pollPage(page, () => window.__laheRail.isCollapsed() === false, undefined, {
      message: "the pill click to open the rail"
    });
    expect(await page.evaluate(() => window.__laheRail.geometry().railVisible)).toBe(true);
  });
});
