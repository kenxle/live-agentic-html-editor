// Moving the collapsed pill out of the page's way.
//
// The pill sits bottom-right, which is out of the way of most pages and not out
// of the way of all of them. Ken, reviewing a site that puts its own bar along
// the bottom for thumb reach: "i finally found a need to drag the pill. when
// i've got a bottom bar for thumb clicks on mobile it's covering the buttons and
// i need to drag it to a different location."
//
// The tool is a guest on somebody else's page and it cannot know what is
// underneath it, so the reviewer moves it and the choice is remembered.
//
// The two things that can break here are the two this file is about: a drag that
// opens the rail it was trying to get out of the way of, and a position that is
// remembered as a point and lands off screen the next time the viewport is a
// different size.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");

/** The pill's box. geometry() reports edges, so the size is derived here. */
function pillRect(page) {
  return page.evaluate(() => {
    const g = window.__laheRail.geometry();
    if (!g.pill) return null;
    return {
      x: g.pill.left,
      y: g.pill.top,
      w: g.pill.right - g.pill.left,
      h: g.pill.bottom - g.pill.top
    };
  });
}

async function showThePill(page) {
  await page.evaluate(() => window.__laheRail.collapse(true));
  await pollPage(page, () => window.__laheRail.geometry().pillVisible === true, undefined, {
    message: "the collapsed pill to be on screen"
  });
}

/** A real press, a real move, a real release, in the coordinates a thumb uses. */
async function dragPill(page, byX, byY) {
  const before = await pillRect(page);
  const fromX = before.x + before.w / 2;
  const fromY = before.y + before.h / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  // In steps, because one jump from press to release is not what a finger does
  // and would sail past a handler that only listens while moving.
  await page.mouse.move(fromX + byX / 2, fromY + byY / 2, { steps: 4 });
  await page.mouse.move(fromX + byX, fromY + byY, { steps: 4 });
  await page.mouse.up();
  return before;
}

test.describe("the collapsed pill can be moved off the page's own furniture", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ root: REPO_ROOT, label: "rail-pill-move" });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("a drag moves the pill and does not open the rail", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=pill-move-a"));
    await showThePill(page);

    // Up and to the left, which is the direction someone clears a bottom bar in.
    const before = await dragPill(page, -160, -220);
    const after = await pillRect(page);

    expect(after.y, "the pill came up off the bottom").toBeLessThan(before.y - 100);
    expect(after.x, "and in from the right").toBeLessThan(before.x - 60);
    // THE WHOLE POINT. A drag that ends by opening the rail has put the rail on
    // top of the thing the reviewer was trying to uncover.
    expect(await page.evaluate(() => window.__laheRail.isCollapsed()), "the rail stayed shut").toBe(true);
  });

  test("a press that does not move still opens the rail", async ({ page }) => {
    // The other half of the same rule. The drag threshold has to be small enough
    // that a deliberate move is caught and large enough that a thumb tap, which
    // never lands perfectly still, is not read as one.
    await page.goto(server.urlFor("test/fixtures/rail.html?review=pill-move-b"));
    await showThePill(page);

    const rect = await pillRect(page);
    await page.mouse.click(rect.x + rect.w / 2, rect.y + rect.h / 2);

    expect(await page.evaluate(() => window.__laheRail.isCollapsed()), "a tap still opens it").toBe(false);
  });

  test("the pill is where the reviewer left it on the next load", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=pill-move-c"));
    await showThePill(page);
    await dragPill(page, -140, -200);
    const moved = await pillRect(page);

    await page.reload();
    await showThePill(page);
    const remembered = await pillRect(page);

    // Within a pixel or two: the offsets are rounded on the way into storage.
    expect(Math.abs(remembered.x - moved.x), "same place across the reload").toBeLessThanOrEqual(2);
    expect(Math.abs(remembered.y - moved.y)).toBeLessThanOrEqual(2);

    // And it belongs to the review, not to the browser: another review opens on
    // the default corner rather than inheriting somebody else's arrangement.
    await page.goto(server.urlFor("test/fixtures/rail.html?review=pill-move-d"));
    await showThePill(page);
    const other = await pillRect(page);
    expect(other.y, "a different review starts on the default corner").toBeGreaterThan(moved.y + 100);
  });

  test("a remembered spot is clamped back on screen when the viewport shrinks", async ({ page }) => {
    // A phone rotates, an address bar slides away, a window is dragged narrower.
    // A pill three quarters off the screen is a pill the reviewer cannot drag
    // back, so the spot is clamped on every apply rather than only when it is
    // set.
    await page.setViewportSize({ width: 1200, height: 900 });
    await page.goto(server.urlFor("test/fixtures/rail.html?review=pill-move-e"));
    await showThePill(page);
    // Far from the bottom-right corner it starts on, so the offsets it stores
    // are large enough to fall outside a small viewport.
    await dragPill(page, -900, -700);

    await page.setViewportSize({ width: 420, height: 640 });
    await pollPage(page, () => !!window.__laheRail.geometry().pill, undefined, {
      message: "the pill to settle after the viewport change"
    });

    const rect = await pillRect(page);
    expect(rect.x, "still on screen horizontally").toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.w, "and not hanging off the right").toBeLessThanOrEqual(420);
    expect(rect.y, "still on screen vertically").toBeGreaterThanOrEqual(0);
    expect(rect.y + rect.h, "and not below the fold").toBeLessThanOrEqual(640);
  });
});
