// The takeover walk: the real boot, the real button, a live holder.
//
// Born from the first real use (2026-08-14). Ken's window was refused while a
// forgotten tab held the review; he pressed "Review here instead" and nothing
// happened. The takeover was GRANTED, but entering read-only had torn down the
// shared highlight surface, so every gesture after the takeover died on
// highlight.surface's second-host guard. Separately, a Turbo remount re-armed
// Cmd-Shift-C in the still-refused window, opening comment boxes that could do
// nothing. Both are walked here the way he hit them: two real windows, the app
// fixture's real boot, a real mouse click at the button's on-screen geometry.
//
// The second-window SPECS (rail_second_window.spec.js) run on the rail harness;
// this one runs the real product wiring end to end, because the harness and the
// boot diverging is exactly how the first bug shipped.

"use strict";

const { test, expect } = require("@playwright/test");
const { startService, readEventLog, SERVICE_ENTRY } = require("../helpers");
const { pollUntil, pollPage } = require("../helpers/poll");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "takeover-walk";
const EPHEMERAL_PORT = ["--port", "0"];

async function bootAndWait(page, url) {
  await page.goto(url);
  await pollPage(page, () => window.__lahe && window.__lahe.booted, undefined, {
    message: "the layer to boot from the app's own script tag"
  });
}

function railState(page) {
  return page.evaluate(() => {
    const h = window.__lahe.handle;
    return {
      refusalShown: h.rail.refusalShown(),
      button: h.rail.refusalButtonInfo(),
      openBoxes: h.comments.openBoxes().length
    };
  });
}

async function selectAndComment(page, text) {
  await page.evaluate(() => {
    const p = document.querySelector("main p, p");
    window.getSelection().selectAllChildren(p);
  });
  await page.keyboard.press("Meta+Shift+C");
  if (text) {
    await page.keyboard.type(text, { delay: 5 });
    await page.keyboard.press("Meta+Enter");
  }
}

test.describe("the takeover walk, on the real boot", () => {
  let appServer;
  let helper;

  test.beforeEach(async () => {
    appServer = await startAppServer();
    helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [appServer.origin]
    });
    appServer.useLayer({ review: REVIEW, token: helper.tokenFor(REVIEW), helper: helper.url });
  });

  test.afterEach(async () => {
    if (appServer) await appServer.close();
    if (helper) await helper.stop();
  });

  test("a refused window presses the real button and can actually review", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const winA = await ctxA.newPage();
    const winB = await ctxB.newPage();
    try {
      await bootAndWait(winA, appServer.urlFor("/"));
      await pollPage(winA, () => window.__lahe.handle.sync.lockState().helperGranted, undefined, {
        message: "the first window to hold the helper session"
      });

      await bootAndWait(winB, appServer.urlFor("/"));
      await pollPage(winB, () => window.__lahe.handle.rail.refusalShown(), undefined, {
        message: "the second window to be refused"
      });

      // Read-only means READ-ONLY: the gesture opens nothing.
      await selectAndComment(winB, null);
      const refused = await railState(winB);
      expect(refused.openBoxes, "Cmd-Shift-C opens nothing in a refused window").toBe(0);
      expect(refused.button.visible, "the button is really on screen").toBe(true);

      // The REAL click, at the button's on-screen geometry (the root is closed,
      // so hit-testing is the only honest way in, and it is also what a hand does).
      const rect = refused.button.rect;
      await winB.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await pollPage(winB, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
        message: "the takeover to be granted"
      });
      expect(
        await winB.evaluate(() => window.__lahe.handle.comments.openBoxes().length),
        "takeover restores the page-note composer that read-only mode closed"
      ).toBe(1);

      // The whole point: the window can REVIEW now. A real gesture, a real
      // comment, landing in the log. This is the assertion that was missing
      // when the takeover shipped granted-but-dead.
      await selectAndComment(winB, "Takeover, then a real comment");
      await pollUntil(
        () => readEventLog(helper.stateDir, REVIEW).filter((e) => e.event === "item.ready").length >= 1,
        { message: "the post-takeover comment to reach events.jsonl" }
      );

      const after = await railState(winB);
      expect(after.refusalShown, "the panel is gone").toBe(false);
      expect(after.button.disabled, "the button is not stuck pending").toBe(false);

      // The deposed window learns on its next heartbeat and shows the panel.
      await pollPage(winA, () => window.__lahe.handle.rail.refusalShown(), undefined, {
        message: "the deposed window to show the refusal panel",
        timeoutMs: 20000
      });
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("a remount does not re-arm gestures in a refused window", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const winA = await ctxA.newPage();
    const winB = await ctxB.newPage();
    try {
      await bootAndWait(winA, appServer.urlFor("/"));
      await pollPage(winA, () => window.__lahe.handle.sync.lockState().helperGranted, undefined, {
        message: "the first window to hold the helper session"
      });

      // The refused window lives on the morphing page, like Ken's Turbo app.
      await bootAndWait(winB, appServer.urlFor("/?morph=hooked&poll=200"));
      await pollPage(winB, () => window.__lahe.handle.rail.refusalShown(), undefined, {
        message: "the second window to be refused"
      });

      // Force a real remount (the app's own morph engine destroys and the
      // injector re-creates), then gesture: still nothing.
      await winB.evaluate(() => window.__lahe.handle.injector.remount("test-forced"));
      await selectAndComment(winB, null);
      const state = await railState(winB);
      expect(state.openBoxes, "the remount did not re-arm Cmd-Shift-C").toBe(0);
      expect(state.refusalShown, "and the refusal panel is still on screen").toBe(true);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
