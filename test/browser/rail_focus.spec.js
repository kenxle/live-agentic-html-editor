// Ranked test 12: a focused card is never re-created.
//
// Node identity, activeElement, and the typed characters, all intact through
// twenty repaints. This is the law 1B owns (D10, the rail), and it is the
// single largest in-page revert mechanism in the tool being replaced: a rail
// that rebuilds every card on every change destroys a half-reworded comment,
// because a removed node never fires blur.
//
// What makes this test non-vacuous, and how to check that it still is: change
// overlay.js's upsertCard to build a fresh card node on the update path (rather
// than mutating the one that exists) and this test fails on the node identity
// assertion. The demonstration is pasted in 1b_builder_notes.md.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, forceRepaints, pollPage } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const REPAINTS = 20;
const SENTENCE = "This paragraph should name the client, not the plan.";

test.describe("the rail updates in place", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ root: REPO_ROOT, label: "repo" });
  });

  test.afterAll(async () => {
    await server.close();
  });

  test("a focused card survives twenty repaints with its node, focus and text intact", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html"));

    const opened = await page.evaluate(() => window.__laheRail.openCard());
    expect(opened.id).toBeTruthy();

    // Typed with real key events, because the whole mechanism under test lives
    // between a keystroke and a repaint.
    await page.keyboard.type(SENTENCE.slice(0, 20), { delay: 10 });

    const before = await page.evaluate((id) => window.__laheRail.activeInfo(), opened.id);
    expect(before.cardId).toBe(opened.id);
    expect(before.isCardInput).toBe(true);

    await forceRepaints(page, REPAINTS, { target: '[data-repaint-target="live"]' });

    // Still typing AFTER the repaints, into the same box, with no re-focus:
    // a re-created node would have swallowed the rest of the sentence.
    await page.keyboard.type(SENTENCE.slice(20), { delay: 10 });

    const after = await page.evaluate((id) => {
      return {
        sameNode: window.__laheRail.sameCardNode(id),
        active: window.__laheRail.activeInfo(),
        text: window.__laheRail.cardText(id),
        stored: window.__laheRail.storedText(id)
      };
    }, opened.id);

    expect(after.sameNode, "the card node is the one the reviewer started typing into").toBe(true);
    expect(after.active.cardId, "focus never left the card").toBe(opened.id);
    expect(after.active.isCardInput).toBe(true);
    expect(after.active.selectionStart, "the caret is at the end of what was typed").toBe(SENTENCE.length);
    expect(after.text).toBe(SENTENCE);
    expect(after.stored, "every keystroke reached browser storage").toBe(SENTENCE);

    // The positive control: the repaint engine really ran, so this is not a
    // test passed by a page that never repainted.
    const repaints = await page.evaluate(() => window.__lahe.counters.repaints);
    expect(repaints).toBeGreaterThanOrEqual(REPAINTS);
  });

  test("a card that holds focus refuses to be removed", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html"));
    const opened = await page.evaluate(() => window.__laheRail.openCard());
    await page.keyboard.type("half a thought", { delay: 10 });

    const removed = await page.evaluate((id) => {
      const rail = window.__laheRail;
      return { refused: rail.removeCard(id), stillThere: rail.cardIds().indexOf(id) !== -1 };
    }, opened.id);

    expect(removed.refused, "removeCard tells the caller no rather than dropping the box").toBe(false);
    expect(removed.stillThere).toBe(true);
  });

  test("the collapsed pill never overlaps the open rail", async ({ page }) => {
    await page.goto(server.urlFor("test/fixtures/rail.html"));

    const open = await page.evaluate(() => window.__laheRail.geometry());
    expect(open.railVisible).toBe(true);
    expect(open.pillVisible, "with the rail open there is no pill to overlap it").toBe(false);

    await page.evaluate(() => window.__laheRail.collapse(true));
    await pollPage(page, () => window.__laheRail.geometry().pillVisible === true, undefined, {
      message: "the collapsed pill to be on screen"
    });
    const collapsed = await page.evaluate(() => window.__laheRail.geometry());
    expect(collapsed.railVisible).toBe(false);
    expect(collapsed.overlap, "pill and rail are never both on screen").toBe(false);
  });

  test("collapse and expansion persist per review across remounts and full reloads", async ({ page }) => {
    const url = server.urlFor("test/fixtures/rail.html") + "?review=collapse-reload-review";
    await page.goto(url);

    expect(await page.evaluate(() => window.__laheRail.isCollapsed()), "a new review starts open").toBe(false);

    await page.evaluate(() => window.__laheRail.collapse(true));
    expect(await page.evaluate(() => window.__laheRail.remount()), "the rail remounted").toBe(true);
    expect(await page.evaluate(() => window.__laheRail.isCollapsed()), "a remount keeps it collapsed").toBe(true);

    await page.reload();
    await pollPage(page, () => !!window.__laheRail, undefined, { message: "the rail to boot after reload" });
    expect(await page.evaluate(() => window.__laheRail.isCollapsed()), "a full reload keeps it collapsed").toBe(true);

    await page.evaluate(() => window.__laheRail.collapse(false));
    await page.reload();
    await pollPage(page, () => !!window.__laheRail, undefined, { message: "the rail to boot after expansion" });
    expect(await page.evaluate(() => window.__laheRail.isCollapsed()), "pill expansion persists too").toBe(false);
  });

  test("a refusal expands transiently without erasing the collapsed preference", async ({ page }) => {
    const url = server.urlFor("test/fixtures/rail.html") + "?review=refusal-collapse-review";
    await page.goto(url);
    await page.evaluate(() => window.__laheRail.collapse(true));

    await page.evaluate(() => window.__laheRail.showRefusal("Held by another window."));
    expect(await page.evaluate(() => window.__laheRail.isCollapsed()), "the refusal is visible in an open rail").toBe(
      false
    );

    await page.evaluate(() => window.__laheRail.hideRefusal());
    expect(await page.evaluate(() => window.__laheRail.isCollapsed()), "closing it restores the user's choice").toBe(
      true
    );

    await page.reload();
    await pollPage(page, () => !!window.__laheRail, undefined, { message: "the rail to boot after the refusal" });
    expect(
      await page.evaluate(() => window.__laheRail.isCollapsed()),
      "the forced expansion never overwrote browser storage"
    ).toBe(true);
  });
});
