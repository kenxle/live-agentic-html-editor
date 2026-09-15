// Cmd-Shift-1: opening and closing the review panel without the mouse.
//
// Ken: "we need a hotkey to toggle the rail. Ideally left hand only, that
// doesn't conflict with common hotkeys."
//
// What these assert, in the order they matter:
//
//   it toggles    the panel goes away and the pill appears, and back again
//   the keyboard  opening puts the focus in the open tab, so a reviewer who
//                 never touched the mouse can work; closing gives it back to
//                 the page
//   remembered    a keyboard toggle is a decision, so it survives a reload the
//                 way the collapse arrow's does
//   in a field    the chord works while the reviewer is mid-sentence in a
//                 comment box, and the "1" does not land in their words
//   presenting    the chord does nothing while the tool is hidden; Cmd-Shift-X
//                 is the way back
//
// The whole thing is the real tool: the app server, the library arriving as one
// script tag, and the real helper.

"use strict";

const { test, expect, pollPage, startService, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "rail-hotkey-review";
const EPHEMERAL_PORT = ["--port", "0"];

/** The chord, pressed on the page itself. */
function pressChord(page) {
  return page.keyboard.press("ControlOrMeta+Shift+Digit1");
}

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

function railShape(page) {
  return page.evaluate(() => {
    const rail = window.__lahe.rail;
    const geometry = rail.geometry();
    return {
      collapsed: rail.isCollapsed(),
      railVisible: geometry.railVisible,
      pillVisible: geometry.pillVisible,
      focused: rail.focusedControl(),
      pageFocus: document.activeElement ? document.activeElement.id || document.activeElement.tagName : null
    };
  });
}

async function selectText(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
}

test.describe("Cmd-Shift-1 opens and closes the review panel", () => {
  test("the chord toggles the panel, and opening puts the keyboard in it", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);

      const before = await railShape(page);
      expect(before.collapsed, "a fresh review starts open").toBe(false);
      expect(before.railVisible).toBe(true);

      await pressChord(page);
      await pollPage(page, () => window.__lahe.rail.isCollapsed() === true, undefined, {
        message: "the chord to put the panel away"
      });
      const away = await railShape(page);
      expect(away.railVisible, "the panel is gone").toBe(false);
      expect(away.pillVisible, "and the pill is what is left").toBe(true);

      // The pill teaches the chord, because it is the only control on screen
      // once the panel is away.
      const pillTitle = await page.evaluate(() => window.__lahe.rail.geometry().pillTitle);
      expect(pillTitle).toContain("Cmd-Shift-1");

      await pressChord(page);
      await pollPage(page, () => window.__lahe.rail.isCollapsed() === false, undefined, {
        message: "the chord to bring the panel back"
      });
      const back = await railShape(page);
      expect(back.railVisible).toBe(true);
      expect(back.pillVisible).toBe(false);
      expect(back.focused, "the keyboard is inside the panel").toBeTruthy();
      expect(back.focused.inPane, "and on a control in the tab the reviewer is looking at").toBe(true);

      // Closing gives the keyboard back to the page.
      await pressChord(page);
      await pollPage(page, () => window.__lahe.rail.isCollapsed() === true, undefined, {
        message: "the chord to put the panel away again"
      });
      const released = await page.evaluate(() => {
        const node = document.activeElement;
        const host = document.getElementById("lahe-surface-root");
        return { isHost: !!host && node === host, tag: node ? node.tagName : null };
      });
      expect(released.isHost, "the focus is not parked on the library's host").toBe(false);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a keyboard toggle is a decision, so it survives a reload", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await pressChord(page);
      await pollPage(page, () => window.__lahe.rail.isCollapsed() === true, undefined, {
        message: "the chord to put the panel away"
      });

      await bootedPage(page, app, helper, token);
      await pollPage(page, () => window.__lahe.rail.isCollapsed() === true, undefined, {
        message: "the reload to come up with the panel still away"
      });
      expect((await railShape(page)).pillVisible, "the pill is where the reviewer left it").toBe(true);

      await pressChord(page);
      await pollPage(page, () => window.__lahe.rail.isCollapsed() === false, undefined, {
        message: "the chord to open it again"
      });
      await bootedPage(page, app, helper, token);
      await pollPage(page, () => window.__lahe.rail.isCollapsed() === false, undefined, {
        message: "the reload to come up open"
      });
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("the chord works mid-sentence in a comment box, and the 1 stays out of the words", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);

      await selectText(page, "p.lede");
      await page.keyboard.press("ControlOrMeta+Shift+KeyC");
      await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
        message: "the comment box to open on the passage"
      });
      await page.keyboard.type("cut this to");

      await pressChord(page);
      await pollPage(page, () => window.__lahe.rail.isCollapsed() === true, undefined, {
        message: "the chord to work from inside the comment box"
      });
      const typed = await page.evaluate(() => window.__lahe.focusedBoxText());
      expect(typed, "no 1 and no ! landed in the reviewer's sentence").toBe("cut this to");

      await pressChord(page);
      await pollPage(page, () => window.__lahe.rail.isCollapsed() === false, undefined, {
        message: "and to open it again"
      });
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("the chord does nothing while the tool is hidden for presenting", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const openBefore = await page.evaluate(() => window.__lahe.rail.isCollapsed());

      await page.keyboard.press("ControlOrMeta+Shift+KeyX");
      await pollPage(page, () => window.__lahe.present() === true, undefined, {
        message: "the library to go into present mode"
      });

      await pressChord(page);
      await pressChord(page);
      const during = await page.evaluate(() => ({
        present: window.__lahe.present(),
        collapsed: window.__lahe.rail.isCollapsed()
      }));
      expect(during.present, "the chord did not take the library out of present mode").toBe(true);
      expect(during.collapsed, "and it did not move the panel behind the curtain").toBe(openBefore);

      // Cmd-Shift-X is still the way back, and the rail chord works again after.
      await page.keyboard.press("ControlOrMeta+Shift+KeyX");
      await pollPage(page, () => window.__lahe.present() === false, undefined, {
        message: "the present chord to bring the library back"
      });
      await pressChord(page);
      await pollPage(page, (was) => window.__lahe.rail.isCollapsed() === !was, openBefore, {
        message: "the rail chord to work again"
      });
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});
