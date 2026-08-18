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
