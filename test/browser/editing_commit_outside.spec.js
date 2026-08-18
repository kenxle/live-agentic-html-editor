// Leaving the edited block, every way a reviewer actually leaves it.
//
// THE BUG THIS PINS. An edit left in `draft` never passes
// protocol.countsAsNew, so it reaches no agent at all, and the reviewer has no
// way to tell: the page looks finished. In a live session, clicking the rail
// (the natural thing to do after finishing an edit) left the edit in draft,
// because the click retargets to the overlay host and the click handler skips
// anything inside the library's own UI. Switching to another window did the
// same, by having no handler at all.
//
// So all three ways out are asserted here: the empty page, the library's own
// rail, and the window losing focus. Each one must land the record in `ready`.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/editing-doc.html";

async function typeInto(page, blockId, text) {
  await placeCaret(page, { selector: "#" + blockId, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(
    page,
    (id) => {
      const state = window.__laheEdit.state();
      return state.open && state.blockId === id;
    },
    blockId,
    { message: "edit state to open on #" + blockId }
  );
  const length = await page.evaluate((id) => document.getElementById(id).textContent.length, blockId);
  await placeCaret(page, { selector: "#" + blockId, offset: length });
  await page.keyboard.type(text, { delay: 20 });
}

/** The one record on the page, whatever state it is in. */
async function onlyItem(page) {
  const items = await page.evaluate(() => window.__laheEdit.items());
  expect(items).toHaveLength(1);
  return items[0];
}

test.describe("2A: every way of leaving the block commits it (the stuck-draft bug)", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "commit-outside" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("clicking empty page space commits the edit", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=commit-empty");
    await typeInto(page, "alpha", " And they know it.");

    // A click with nothing under it but the page itself.
    await page.mouse.click(5, 5);
    await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
      message: "the click outside to commit"
    });

    const item = await onlyItem(page);
    expect(item.state, "a click on the page commits to ready").toBe("ready");
  });

  test("clicking the library's own rail commits the edit", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=commit-rail");
    await typeInto(page, "alpha", " And they know it.");

    // The rail lives in a chrome-marked host, and a click on it retargets to
    // that host. This is the exact shape that left an edit in draft forever.
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "lahe-surface-root";
      host.setAttribute("data-lahe", "chrome");
      host.style.cssText = "position:fixed;right:0;bottom:0;width:40px;height:40px";
      document.body.appendChild(host);
      host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, composed: true }));
      host.dispatchEvent(new MouseEvent("click", { bubbles: true, composed: true }));
    });

    await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
      message: "the click on the rail to commit"
    });
    const item = await onlyItem(page);
    expect(item.state, "clicking the rail commits to ready, it does not strand a draft").toBe("ready");
  });

  test("the window losing focus commits the edit", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=commit-blur");
    await typeInto(page, "alpha", " And they know it.");

    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
      message: "the window blur to commit"
    });

    const item = await onlyItem(page);
    expect(item.state, "switching windows is leaving the block too").toBe("ready");
  });

  // -------------------------------------------------------------------------
  // Two presses that are NOT leaving the block (review, 2026-08-17)
  // -------------------------------------------------------------------------
  //
  // The commit-outside rule widened from click to pointerdown to catch the rail,
  // and went too wide. A scrollbar drag fires pointerdown on the html element
  // with no click after it, so scrolling to see the rest of your own edit had
  // contenteditable stripped out from under your pointer mid-drag. A right-click
  // committed for the same reason.
  //
  // The commit handler is synchronous, so these assert the state IMMEDIATELY
  // after the press: nothing is waited on and nothing can be flaky. The primary
  // click at the end is the positive control, proving the machinery was live the
  // whole time rather than the edit surviving because nothing was listening.
  //
  // THE TWO SCROLLBAR TESTS SKIP ON A MACHINE WITH OVERLAY SCROLLBARS, which is
  // macOS without a mouse attached and is what a Mac Chromium run gets here. An
  // overlay scrollbar takes no layout space and receives no pointerdown, so
  // there is genuinely no press to make and nothing to assert; the reviewer who
  // hit this had a classic scrollbar, which Windows, Linux, and a Mac with a
  // mouse all give you. The geometry the rule turns on is not left to those
  // machines: it is a pure function, unit-tested exhaustively in
  // test/unit/session_fixes.test.js against gestures.isScrollbarPress.

  test("dragging the root scrollbar does not commit the edit", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=commit-scrollbar");
    await typeInto(page, "alpha", " And they know it.");

    // A page tall enough that the root actually has a scrollbar, and a styled
    // scrollbar so there IS a gutter to press on. macOS paints an overlay
    // scrollbar by default, which takes no layout space and never receives a
    // pointerdown; the reviewer who hit this had a mouse attached, which is the
    // classic scrollbar every Windows and Linux reviewer always gets.
    const bar = await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "::-webkit-scrollbar { width: 15px; height: 15px }";
      document.head.appendChild(style);
      document.body.style.minHeight = "5000px";
      const gutter = window.innerWidth - document.documentElement.clientWidth;
      return { gutter: gutter, x: document.documentElement.clientWidth + Math.max(1, Math.floor(gutter / 2)) };
    });
    test.skip(bar.gutter <= 0, "this browser paints an overlay scrollbar, so there is no gutter to press on");

    await page.mouse.move(bar.x, 200);
    await page.mouse.down();
    expect(await page.evaluate(() => window.__laheEdit.isEditing()), "a scrollbar press is scrolling, not leaving").toBe(
      true
    );
    await page.mouse.move(bar.x, 400);
    expect(await page.evaluate(() => window.__laheEdit.isEditing()), "and the drag does not commit it either").toBe(true);
    await page.mouse.up();

    // The positive control: a real press on content still commits.
    await page.mouse.click(5, 5);
    await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
      message: "the click on content to commit"
    });
    expect((await onlyItem(page)).state).toBe("ready");
  });

  test("dragging an inner scrollbar does not commit the edit", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=commit-inner-scrollbar");
    await typeInto(page, "alpha", " And they know it.");

    const bar = await page.evaluate(() => {
      // A classic scrollbar with a real gutter, for the reason the root test
      // states: an overlay scrollbar takes no layout space and gets no press.
      const style = document.createElement("style");
      style.textContent = "#scroller::-webkit-scrollbar { width: 15px; height: 15px }";
      document.head.appendChild(style);
      const box = document.createElement("div");
      box.id = "scroller";
      box.style.cssText = "position:fixed;left:20px;bottom:20px;width:200px;height:120px;overflow:auto";
      const tall = document.createElement("div");
      tall.style.height = "2000px";
      tall.textContent = "long";
      box.appendChild(tall);
      document.body.appendChild(box);
      const rect = box.getBoundingClientRect();
      const gutter = rect.width - box.clientWidth;
      return {
        gutter: gutter,
        x: rect.left + box.clientWidth + Math.max(1, Math.floor(gutter / 2)),
        y: rect.top + 40
      };
    });
    test.skip(bar.gutter <= 0, "this browser paints an overlay scrollbar, so there is no gutter to press on");

    await page.mouse.move(bar.x, bar.y);
    await page.mouse.down();
    expect(await page.evaluate(() => window.__laheEdit.isEditing()), "an inner scrollbar is a scrollbar too").toBe(true);
    await page.mouse.up();

    await page.mouse.click(5, 5);
    await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
      message: "the click on content to commit"
    });
    expect((await onlyItem(page)).state).toBe("ready");
  });

  test("a right-click outside the block does not commit the edit", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=commit-rightclick");
    await typeInto(page, "alpha", " And they know it.");

    await page.mouse.move(5, 5);
    await page.mouse.down({ button: "right" });
    expect(
      await page.evaluate(() => window.__laheEdit.isEditing()),
      "a context menu is not the reviewer leaving the block"
    ).toBe(true);
    await page.mouse.up({ button: "right" });

    await page.mouse.click(5, 5);
    await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
      message: "the primary click to commit"
    });
    expect((await onlyItem(page)).state).toBe("ready");
  });

  test("committing twice does not bump the revision: the commit is idempotent", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=commit-once");
    await typeInto(page, "alpha", " And they know it.");

    // Pointerdown then click then blur, which is what one real gesture produces.
    await page.mouse.click(5, 5);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
      message: "the edit to commit"
    });

    const item = await onlyItem(page);
    expect(item.state).toBe("ready");
    expect(item.rev, "one edit is one revision, however many events the gesture fired").toBe(1);
  });
});
