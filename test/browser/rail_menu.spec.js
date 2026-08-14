// Copy and Export live in the rail's header menu, not in the footer.
//
// D10 was revised from real use: the two review-level actions stayed reachable
// but stopped standing in the reviewer's face as a pair of submit-looking
// buttons under their own words. This file is the guard for the revision, and
// for the two things a menu has to get right or it is worse than the buttons
// it replaced:
//
//   IT IS REACHABLE   the button is in the head beside the collapse arrow, it
//                     is labelled, it opens on a real click and on the keyboard,
//                     and it comes back after a remount (the menu is chrome)
//   IT GETS OUT OF THE WAY   it closes on Esc, on a click outside, on choosing
//                     an item, and on collapse, and Esc gives focus back to the
//                     button that opened it
//
// And the outcome assertion that matters: choosing Export review produces the
// same real download the footer button produced. The path under test is a real
// mouse click at the control's on-screen geometry (the rail's root is closed,
// so the geometry comes from the rail's own self-report, the way the takeover
// walk reads the refusal button).

"use strict";

const fs = require("node:fs");

const { test, expect, pollPage, pollUntil, startService, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "rail-menu-review";
const EPHEMERAL_PORT = ["--port", "0"];

const REGION = { lede: "p.lede" };

async function startBoth() {
  const app = await startAppServer();
  const helper = await startService({
    entry: SERVICE_ENTRY,
    args: EPHEMERAL_PORT,
    reviews: [REVIEW],
    allowedOrigins: [app.origin]
  });
  return { app, helper, token: helper.tokenFor(REVIEW) };
}

async function bootedPage(page, app, helper, token) {
  app.useLayer({ review: REVIEW, token: token, helper: helper.url });
  await page.goto(app.urlFor("/?morph=off"));
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

async function commentOn(page, selector, text) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  await pollPage(page, () => window.__lahe.items().some((i) => i.state === "ready"), undefined, {
    message: "the comment to be ready"
  });
}

// --- reading and driving a closed root ---------------------------------------

function menuInfo(page) {
  return page.evaluate(() => window.__lahe.rail.menuInfo());
}

function centerOf(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** A real mouse click on the menu button, at its on-screen geometry. */
async function clickMenuButton(page) {
  const info = await menuInfo(page);
  expect(info.present, "the rail's head carries a menu button").toBe(true);
  const at = centerOf(info.rect);
  await page.mouse.click(at.x, at.y);
  return info;
}

/** Open the menu (if it is closed) and really click one of its items. */
async function chooseMenuItem(page, label) {
  let info = await menuInfo(page);
  if (!info.open) {
    await clickMenuButton(page);
    info = await pollUntil(async () => {
      const got = await menuInfo(page);
      return got.open ? got : null;
    }, { message: "the header menu to open on a click" });
  }
  const item = info.items.filter((one) => one.label === label)[0];
  if (!item) {
    throw new Error(
      "no menu item labelled " + label + ". The menu holds: " + info.items.map((one) => one.label).join(", ")
    );
  }
  const at = centerOf(item.rect);
  await page.mouse.click(at.x, at.y);
  return true;
}

/** Every button label the rail's footer draws. */
function footerButtonLabels(page) {
  return page.evaluate(() => {
    const pane = window.__lahe.rail.tabBody("active");
    const root = pane.getRootNode();
    const foot = root.querySelector(".foot");
    if (!foot) throw new Error("the rail has no footer");
    return Array.prototype.slice.call(foot.querySelectorAll("button")).map((node) =>
      (node.textContent || "").trim()
    );
  });
}

test.describe("the review's actions live in the head's menu", () => {
  test("the footer no longer carries Copy and Export, and the head carries a labelled menu button", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOn(page, REGION.lede, "Say which number this is.");

      const labels = await footerButtonLabels(page);
      expect(labels, "the footer stopped offering Copy as a submit-looking button").not.toContain("Copy");
      expect(labels, "the footer stopped offering Export as a submit-looking button").not.toContain("Export");

      // The footer's own content is untouched: the keycap hints and the status
      // line are what it is for.
      const kept = await page.evaluate(() => {
        const root = window.__lahe.rail.tabBody("active").getRootNode();
        const foot = root.querySelector(".foot");
        return {
          hints: !!foot.querySelector(".hints kbd"),
          status: !!foot.querySelector(".status .status__text")
        };
      });
      expect(kept.hints, "the keycap hints stayed in the footer").toBe(true);
      expect(kept.status, "the status line stayed in the footer").toBe(true);

      const info = await menuInfo(page);
      expect(info.present, "the head carries the menu button").toBe(true);
      expect(info.label, "the button says what it is to a screen reader").toBe("More actions");
      expect(info.title, "and it names itself on hover").toBe("More actions");
      expect(info.open, "it starts closed: nothing stands in the reviewer's face").toBe(false);
      expect(info.expanded).toBe("false");
      expect(info.rect.width, "it is really on screen").toBeGreaterThan(0);

      // Same hit area and same register as the collapse control it sits beside.
      expect(info.rect.height).toBe(info.collapseRect.height);
      expect(info.rect.width).toBe(info.collapseRect.width);
      expect(Math.round(info.rect.y)).toBe(Math.round(info.collapseRect.y));
      expect(info.rect.right, "it sits to the left of the collapse arrow").toBeLessThanOrEqual(
        info.collapseRect.x + 1
      );
    } finally {
      await app.close();
      await helper.kill9();
    }
  });

  test("the menu opens on a real click and closes on Esc, on a click outside, and on collapse", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOn(page, REGION.lede, "Pick one number and use it twice.");

      // --- opens, and holds exactly the two review-level actions -------------
      await clickMenuButton(page);
      let info = await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.open ? got : null;
      }, { message: "the menu to open on a real click" });
      expect(info.expanded).toBe("true");
      expect(info.items.map((one) => one.label)).toEqual(["Copy review", "Export review"]);
      info.items.forEach((one) => {
        expect(one.rect.width, one.label + " is really on screen").toBeGreaterThan(0);
      });
      expect(info.focusedIndex, "opening puts the keyboard on the first item").toBe(0);

      // --- Esc closes it and hands focus back --------------------------------
      await page.keyboard.press("Escape");
      info = await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.open === false ? got : null;
      }, { message: "Esc to close the menu" });
      expect(info.buttonFocused, "Esc gives the keyboard back to the button that opened it").toBe(true);

      // --- the keyboard opens it too -----------------------------------------
      await page.keyboard.press("Enter");
      info = await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.open ? got : null;
      }, { message: "Enter on the focused button to open the menu" });
      await page.keyboard.press("ArrowDown");
      info = await menuInfo(page);
      expect(info.focusedIndex, "the arrows move down the menu").toBe(1);
      await page.keyboard.press("Escape");
      await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.open === false ? got : null;
      }, { message: "Esc to close the menu again" });

      // --- a click out on the page closes it ---------------------------------
      await clickMenuButton(page);
      await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.open ? got : null;
      }, { message: "the menu to open again" });
      await page.mouse.click(40, 400);
      await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.open === false ? got : null;
      }, { message: "a click out on the page to close the menu" });

      // --- collapsing the rail takes the menu with it ------------------------
      await clickMenuButton(page);
      await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.open ? got : null;
      }, { message: "the menu to open before the collapse" });
      await page.evaluate(() => window.__lahe.rail.collapse(true));
      info = await menuInfo(page);
      expect(info.open, "a collapsed rail carries no open menu").toBe(false);
      await page.evaluate(() => window.__lahe.rail.collapse(false));
    } finally {
      await app.close();
      await helper.kill9();
    }
  });

  test("the menu button is chrome: it comes back after a remount, closed", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOn(page, REGION.lede, "This one needs a unit.");

      await clickMenuButton(page);
      await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.open ? got : null;
      }, { message: "the menu to open before the remount" });

      await page.evaluate(() => window.__lahe.remount());

      const info = await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.present ? got : null;
      }, { message: "the menu button to come back with the rail's chrome" });
      expect(info.rect.width, "and to be really on screen again").toBeGreaterThan(0);
      // Open is a moment, not a piece of state: the rail that comes back is at
      // rest, which is the correct thing for a transient overlay.
      expect(info.open, "the remounted rail comes back with the menu closed").toBe(false);

      // And it still works after the remount, rather than merely existing.
      await clickMenuButton(page);
      await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.open ? got : null;
      }, { message: "the remounted menu to open on a click" });
    } finally {
      await app.close();
      await helper.kill9();
    }
  });

  test("choosing Export review downloads the review, the same way the footer button did", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    const said = "The notes column is doing two jobs. Split it.";
    try {
      await bootedPage(page, app, helper, token);
      await commentOn(page, REGION.lede, said);

      const [download] = await Promise.all([
        page.waitForEvent("download"),
        chooseMenuItem(page, "Export review")
      ]);
      const text = fs.readFileSync(await download.path(), "utf8");
      expect(download.suggestedFilename()).toMatch(/\.txt$/);
      expect(text.length, "the export is not empty").toBeGreaterThan(0);
      expect(text, "it carries the reviewer's own words").toContain(said);

      const last = await page.evaluate(() => window.__lahe.exporter.last());
      expect(last.ok, "and it reported its own result honestly").toBe(true);

      // Choosing an item closes the menu behind itself.
      const info = await pollUntil(async () => {
        const got = await menuInfo(page);
        return got.open === false ? got : null;
      }, { message: "the menu to close behind the item that was chosen" });
      expect(info.present).toBe(true);
    } finally {
      await app.close();
      await helper.kill9();
    }
  });
});
