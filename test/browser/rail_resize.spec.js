// Dragging the rail wider, and everything that has to get out of its way.
//
// Ken: "some of these responses are getting quite thorough and long, so the
// chat rail should be drag-expandable: you should be able to drag the edge of
// it to expand it horizontally so you can read more."
//
// Three things can go wrong here and this file is about all three.
//
//   1. The drag does not reach the width the pointer asked for, or it reaches
//      it by pushing the PAGE around. The rail is fixed inside a closed root
//      (D8), so widening it must change nothing about the document underneath.
//   2. The width is not remembered, so every reload hands back a column sized
//      for a status line.
//   3. The rail grows and the surfaces that keep clear of it do not: the toast
//      column and the anchored comment box were both placed against a number
//      typed into comments.js, and a resizable rail makes that number a lie.
//
// The bounds themselves are stated without a browser in
// test/unit/rail_width.test.js.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");

/** The rail's box, through its own self-report: the root is closed. */
function railRect(page) {
  return page.evaluate(() => {
    const g = window.__laheRail.geometry();
    if (!g.rail) return null;
    return { left: g.rail.left, right: g.rail.right, width: g.rail.right - g.rail.left };
  });
}

function gripInfo(page) {
  return page.evaluate(() => window.__laheRail.gripInfo());
}

/** The page's own width, which a fixed panel must never change. */
function documentWidth(page) {
  return page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    body: document.body.getBoundingClientRect().width
  }));
}

/** A real press on the grip, a real move, a real release. */
async function dragGrip(page, byX) {
  const grip = await gripInfo(page);
  const fromX = grip.rect.x + grip.rect.width / 2;
  const fromY = grip.rect.y + grip.rect.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  // In steps, because one jump from press to release is not what a hand does
  // and would sail past a handler that only listens while moving.
  await page.mouse.move(fromX + byX / 2, fromY, { steps: 5 });
  await page.mouse.move(fromX + byX, fromY, { steps: 5 });
  await page.mouse.up();
}

test.describe("the rail widens when the reviewer drags its edge", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ root: REPO_ROOT, label: "rail-resize" });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("a drag on the grip widens the rail and leaves the page exactly as it was", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=resize-drag"));

    const before = await railRect(page);
    const pageBefore = await documentWidth(page);

    await dragGrip(page, -200);

    const after = await railRect(page);
    // About 200, not exactly: the grip is 8px wide and the press lands in the
    // middle of it, so the assertion is about the distance travelled.
    expect(after.width - before.width, "the rail grew by the distance dragged").toBeGreaterThan(190);
    expect(after.width - before.width).toBeLessThan(210);
    expect(after.right, "and it is still pinned to the right edge").toBeCloseTo(before.right, 0);

    // THE POINT OF D8. The rail is a fixed panel in a closed root; the page it
    // is reviewing must not learn that anything happened.
    expect(await documentWidth(page), "the page underneath did not move").toEqual(pageBefore);

    const grip = await gripInfo(page);
    expect(grip.dragging, "the drag is over").toBe(false);
    expect(grip.valueNow, "and the grip says how wide it is now").toBe(Math.round(after.width));
  });

  test("the width the reviewer chose is still there after a reload", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=resize-persist"));
    await dragGrip(page, -220);
    const chosen = await railRect(page);

    await page.reload();
    await pollPage(page, () => window.__laheRail.geometry().railVisible === true, undefined, {
      message: "the rail to come back up"
    });

    const back = await railRect(page);
    expect(back.width, "the rail came back the width it was left").toBeCloseTo(chosen.width, 0);

    // Scoped to the review, like every other chrome preference.
    await page.goto(server.urlFor("test/fixtures/rail.html?review=resize-other"));
    const other = await railRect(page);
    expect(other.width, "another review keeps the default width").toBeLessThan(chosen.width - 100);
  });

  test("a drag past the maximum stops at it, and the page stays visible beside the rail", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=resize-clamp"));
    const viewport = page.viewportSize();

    await dragGrip(page, -viewport.width);

    const after = await railRect(page);
    expect(after.width, "the rail stopped at 70% of the viewport").toBeCloseTo(viewport.width * 0.7, 0);
    expect(after.left, "so there is still a page to review beside it").toBeGreaterThan(100);
  });

  test("a double press on the grip puts the rail back to its default width", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=resize-reset"));
    const before = await railRect(page);

    await dragGrip(page, -240);
    expect((await railRect(page)).width).toBeGreaterThan(before.width + 200);

    const grip = await gripInfo(page);
    await page.mouse.dblclick(grip.rect.x + grip.rect.width / 2, grip.rect.y + grip.rect.height / 2);

    expect((await railRect(page)).width, "back to the width it started at").toBeCloseTo(before.width, 0);
  });

  test("the grip is reachable and usable without a pointer", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=resize-keys"));

    expect(await page.evaluate(() => window.__laheRail.focusGrip()), "the grip takes focus").toBe(true);
    const grip = await gripInfo(page);
    expect(grip.role).toBe("separator");
    expect(grip.orientation).toBe("vertical");
    expect(grip.label).toBe("Resize the review panel");
    expect(grip.valueMin).toBe(280);

    const before = await railRect(page);
    // LEFT GROWS: the rail's left edge is the one that moves, so left is the
    // direction a reviewer drags to make it wider.
    await page.keyboard.press("ArrowLeft");
    expect((await railRect(page)).width, "one press is one step of 16").toBeCloseTo(before.width + 16, 0);

    await page.keyboard.press("ArrowRight");
    expect((await railRect(page)).width, "and back again").toBeCloseTo(before.width, 0);

    await page.keyboard.press("Home");
    expect((await railRect(page)).width, "Home is the narrowest the rail goes").toBe(280);

    await page.keyboard.press("End");
    const viewport = page.viewportSize();
    expect((await railRect(page)).width, "End is the widest").toBeCloseTo(viewport.width * 0.7, 0);
  });

  test("Escape during a drag puts the width back to where the drag started", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=resize-escape"));
    const before = await railRect(page);
    const grip = await gripInfo(page);
    const fromX = grip.rect.x + grip.rect.width / 2;
    const fromY = grip.rect.y + grip.rect.height / 2;

    await page.mouse.move(fromX, fromY);
    await page.mouse.down();
    await page.mouse.move(fromX - 260, fromY, { steps: 6 });
    expect((await railRect(page)).width, "mid-drag it is following the pointer").toBeGreaterThan(
      before.width + 200
    );

    await page.keyboard.press("Escape");
    await page.mouse.up();

    expect((await railRect(page)).width, "the drag was abandoned, not applied").toBeCloseTo(before.width, 0);
    expect((await gripInfo(page)).dragging).toBe(false);
  });
});

test.describe("everything else keeps clear of the rail the reviewer widened", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ root: REPO_ROOT, label: "rail-resize-allowance" });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("the rail publishes how much room it takes, on the one host everything reads", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=resize-allowance"));

    await page.evaluate(() => window.__laheRail.setRailWidth(620));
    const rail = await railRect(page);
    const published = await page.evaluate(() => window.__laheRail.publishedAllowance());

    // The rail's width plus the gap it keeps from the viewport edge: the
    // distance from the right edge that is spoken for.
    expect(published).toBe(Math.round(rail.width + 16) + "px");
  });

  test("a toast that arrives after the rail was widened sits beside it, not on it", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=resize-toast"));
    await page.evaluate(() => window.__laheRail.setRailWidth(620));

    await page.evaluate(() =>
      window.__laheRail.toast({ label: "claude says", text: "A long and thorough answer.", sticky: true })
    );
    await pollPage(page, () => window.__laheRail.toastInfo().count > 0, undefined, {
      message: "the toast to be on screen"
    });

    const rail = await railRect(page);
    const toast = await page.evaluate(() => window.__laheRail.toastInfo().toasts[0].rect);
    expect(toast.width, "the toast is really on screen").toBeGreaterThan(0);
    // Polled, because a toast ARRIVES: it slides in from the edge, so its box
    // for the first frames is where it is coming from rather than where it has
    // been placed.
    await expect
      .poll(
        async () => {
          const rect = await page.evaluate(() => window.__laheRail.toastInfo().toasts[0].rect);
          return rect.x + rect.width;
        },
        { message: "the toast to settle beside the rail rather than on it" }
      )
      .toBeLessThanOrEqual(rail.left);

    // With the rail put away there is nothing to avoid, and the toast goes back
    // to the corner a person looks in, which is the case it exists for.
    await page.evaluate(() => window.__laheRail.collapse(true));
    const away = await page.evaluate(() => window.__laheRail.toastInfo().toasts[0].rect);
    expect(away.x + away.width, "back in the top-right corner").toBeGreaterThan(rail.left);
  });

  test("a comment box opened after the rail was widened does not land underneath it", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html?review=resize-box"));
    await page.evaluate(() => window.__laheRail.setRailWidth(620));

    const box = await page.evaluate(() => window.__laheRail.openAnchoredBox("#live-note"));
    const rail = await railRect(page);

    expect(box.rect.width, "the box is really on screen").toBeGreaterThan(0);
    expect(box.rect.x + box.rect.width, "and it stops short of the rail").toBeLessThanOrEqual(rail.left);
  });
});
