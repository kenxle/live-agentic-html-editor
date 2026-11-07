// read-when: Changing which key sends a comment, or the switch for it in the Keyboard shortcuts panel.
//
// Enter sends a comment and Shift-Enter starts a new line. The Keyboard
// shortcuts panel has a switch that turns that back to Cmd-Enter, where a bare
// Enter is a new line. Every key here is a real key press into the real box,
// and the switch is a real mouse click at its on-screen geometry.

"use strict";

const path = require("node:path");

const { test, expect, pollPage, pollUntil, startService, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "send-key-review";
const SHOTS = process.env.LAHE_SEND_KEY_SHOTS || null;

async function startBoth() {
  const app = await startAppServer();
  const helper = await startService({
    entry: SERVICE_ENTRY,
    args: ["--port", "0"],
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

async function openBoxOn(page, selector) {
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
}

function items(page) {
  return page.evaluate(() => window.__lahe.items().map((i) => ({ state: i.state, comment: i.note })));
}

function centerOf(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function openShortcuts(page) {
  let info = await page.evaluate(() => window.__lahe.rail.menuInfo());
  await page.mouse.click(centerOf(info.rect).x, centerOf(info.rect).y);
  info = await pollUntil(async () => {
    const got = await page.evaluate(() => window.__lahe.rail.menuInfo());
    return got.open ? got : null;
  }, { message: "the header menu to open" });
  const item = info.items.filter((one) => one.label === "Keyboard shortcuts")[0];
  await page.mouse.click(centerOf(item.rect).x, centerOf(item.rect).y);
  await pollUntil(async () => ((await readSwitch(page)).open ? true : null), {
    message: "the shortcuts panel to open"
  });
}

function readSwitch(page) {
  return page.evaluate(() => {
    const root = window.__lahe.rail.tabBody("active").getRootNode();
    const panel = root.querySelector(".keyspanel");
    const opts = Array.from(root.querySelectorAll(".sendkey__opt")).map((b) => {
      const r = b.getBoundingClientRect();
      return {
        key: b.getAttribute("data-lahe-send-key"),
        label: b.textContent,
        pressed: b.getAttribute("aria-pressed") === "true",
        rect: { x: r.x, y: r.y, width: r.width, height: r.height }
      };
    });
    const rows = panel ? Array.from(panel.querySelectorAll(".keyspanel__row")).map((r) => r.textContent) : [];
    const box = panel ? panel.getBoundingClientRect() : null;
    return {
      open: !!panel && panel.getAttribute("data-shown") === "open",
      opts,
      rows,
      panelRect: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
    };
  });
}

async function shoot(page, name) {
  if (!SHOTS) return;
  const got = await readSwitch(page);
  const r = got.panelRect;
  await page.screenshot({
    path: path.join(SHOTS, name),
    clip: { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 8), width: r.width + 16, height: r.height + 16 }
  });
}

// Screenshots for the change's record, only when asked for. The rail takes its
// scheme from the page's own background, so dark means a dark page.
async function applyScheme(page) {
  if (process.env.LAHE_SEND_KEY_SCHEME !== "dark") return;
  await page.evaluate(() => {
    document.documentElement.style.background = "#12151a";
    document.body.style.background = "#12151a";
    window.__lahe.rail.refreshScheme();
  });
}

test.describe("the send key", () => {
  test("Enter sends a comment, and Shift-Enter is a new line inside it", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await openBoxOn(page, "p.lede");
      await page.keyboard.type("first line");
      await page.keyboard.press("Shift+Enter");
      await page.keyboard.type("second line");
      const drafted = await items(page);
      expect(drafted.some((i) => i.state === "ready"), "Shift-Enter does not send").toBe(false);
      await page.keyboard.press("Enter");
      const sent = await pollUntil(async () => {
        const got = await items(page);
        return got.find((i) => i.state === "ready") || null;
      }, { message: "Enter to send the comment" });
      expect(sent.comment).toBe("first line\nsecond line");
    } finally {
      await app.close();
      await helper.kill9();
    }
  });

  test("the switch turns sending back to Cmd-Enter, and the choice survives a reload", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await applyScheme(page);
      await openShortcuts(page);
      const before = await readSwitch(page);
      expect(before.opts.map((o) => [o.key, o.pressed])).toEqual([
        ["enter", true],
        ["mod_enter", false]
      ]);
      expect(before.rows.some((r) => r.indexOf("Shift-Enter for a new line") !== -1)).toBe(true);
      await shoot(page, "send_key_enter_" + (process.env.LAHE_SEND_KEY_SCHEME || "light") + ".png");

      const mod = before.opts.find((o) => o.key === "mod_enter");
      await page.mouse.click(centerOf(mod.rect).x, centerOf(mod.rect).y);
      const after = await pollUntil(async () => {
        const got = await readSwitch(page);
        return got.opts.find((o) => o.key === "mod_enter" && o.pressed) ? got : null;
      }, { message: "the switch to move to Cmd-Enter" });
      expect(after.rows.some((r) => r.indexOf("Enter for a new line") !== -1 && r.indexOf("Shift") === -1)).toBe(true);
      await shoot(page, "send_key_mod_" + (process.env.LAHE_SEND_KEY_SCHEME || "light") + ".png");
      // A click on the page closes the panel and gives the keyboard back to it.
      await page.mouse.click(20, 20);
      await pollUntil(async () => ((await readSwitch(page)).open ? null : true), {
        message: "the panel to close on a click outside"
      });

      await openBoxOn(page, "p.lede");
      await page.keyboard.type("one");
      await page.keyboard.press("Enter");
      await page.keyboard.type("two");
      expect((await items(page)).some((i) => i.state === "ready"), "a bare Enter is a new line now").toBe(false);
      await page.keyboard.press("ControlOrMeta+Enter");
      const sent = await pollUntil(async () => {
        const got = await items(page);
        return got.find((i) => i.state === "ready") || null;
      }, { message: "Cmd-Enter to send" });
      expect(sent.comment).toBe("one\ntwo");

      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again"
      });
      await openShortcuts(page);
      const kept = await readSwitch(page);
      expect(kept.opts.find((o) => o.key === "mod_enter").pressed, "the choice is remembered").toBe(true);
    } finally {
      await app.close();
      await helper.kill9();
    }
  });
});
