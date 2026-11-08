/*
read-when: Send stays enabled over an empty rail box, or a read-only window's boxes give no answer when clicked.
*/
"use strict";

// Board rows LAHE-send-disabled-when-empty and LAHE-readonly-click-feedback,
// shipped together in docs/features/20261107.03_board_small_fixes_three.
//
// Send greys out while its box is blank, everywhere a Send sits under a text
// box in the rail: the Active tab's "Add another message" box and the Done
// tab's follow-up composer. (The comment box on the page already did this.)
//
// A window that is read-only because the review is open in another window
// answers a click, a tab or a keypress in a locked box, and the comment or
// edit chord on the page, by showing the refusal panel again and pulsing its
// "Review here instead" button. The boxes read as locked before the click.
//
// The screenshots in the feature folder come from the last test.

const fs = require("node:fs");
const path = require("node:path");

const { test, expect, pollPage, pollUntil, startService, readEventLog, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "board-fixes-three";
const SHOTS = path.join(__dirname, "..", "..", "docs", "features", "20261107.03_board_small_fixes_three");

function appendReply(helper, fields) {
  const file = path.join(helper.stateDir, "reviews", REVIEW, "replies-claude.jsonl");
  fs.appendFileSync(file, JSON.stringify(fields) + "\n");
}

async function startBoth() {
  const app = await startAppServer();
  const helper = await startService({
    entry: SERVICE_ENTRY,
    args: ["--port", "0"],
    reviews: [REVIEW],
    allowedOrigins: [app.origin]
  });
  app.useLayer({ review: REVIEW, token: helper.tokenFor(REVIEW), helper: helper.url });
  return { app, helper };
}

async function bootedPage(page, app) {
  await page.goto(app.urlFor("/?morph=off"));
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

async function commentOnLede(page, text) {
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("p.lede"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  await pollPage(page, () => window.__lahe.items().some((i) => i.state === "ready"), undefined, {
    message: "the comment to be sent"
  });
  return page.evaluate(() => window.__lahe.items().find((i) => i.state === "ready"));
}

function waitForRevInLog(helper, itemId, rev) {
  return pollUntil(
    () => {
      const lines = readEventLog(helper.stateDir, REVIEW);
      return lines.some((e) => e.item === itemId && e.record && e.rev === rev) ? lines : null;
    },
    { message: "revision " + rev + " to reach the helper's log" }
  );
}

async function agentAnswers(page, helper, id, status, text) {
  const item = await page.evaluate((itemId) => window.__lahe.itemById(itemId), id);
  await waitForRevInLog(helper, id, item.rev);
  appendReply(helper, { item: id, rev: item.rev, status, agent: "claude", text });
  await pollPage(page, (itemId) => window.__lahe.itemById(itemId).reply !== null, id, {
    message: "the " + status + " reply to fold onto the card"
  });
}

/** The box and its Send inside a card, read through the rail's own handles. */
function boxState(page, id, boxSelector, sendSelector) {
  return page.evaluate(
    (args) => {
      const rail = window.__lahe.rail;
      const card = rail.getCard(args.id);
      if (card && card.pane) rail.selectTab(card.pane);
      const node = rail.cardNode(args.id);
      const box = node && node.querySelector(args.boxSelector);
      const send = node && node.querySelector(args.sendSelector);
      if (!box || !send) return null;
      return {
        visible: box.checkVisibility(),
        value: box.value,
        placeholder: box.getAttribute("placeholder"),
        boxLocked: box.getAttribute("data-lahe-locked") === "true",
        boxReadOnly: box.readOnly,
        boxDisabled: box.disabled,
        sendDisabled: send.disabled,
        sendLocked: send.getAttribute("data-lahe-locked") === "true"
      };
    },
    { id, boxSelector, sendSelector }
  );
}

async function focusRailBox(page, id, selector) {
  await pollPage(
    page,
    (args) => {
      const rail = window.__lahe.rail;
      const card = rail.getCard(args.id);
      if (card && card.pane) rail.selectTab(card.pane);
      const node = rail.cardNode(args.id);
      const box = node && node.querySelector(args.selector);
      if (!box || !box.checkVisibility()) return false;
      box.focus();
      return box.getRootNode().activeElement === box;
    },
    { id, selector },
    { message: "the box " + selector + " to take the keyboard" }
  );
}

function railState(page) {
  return page.evaluate(() => {
    const h = window.__lahe.handle;
    return {
      refusalShown: h.rail.refusalShown(),
      nudged: h.rail.refusalNudged(),
      button: h.rail.refusalButtonInfo()
    };
  });
}

const ADD = { box: ".lahe-rail-add textarea", send: ".lahe-rail-add .lahe-rail-send" };
const FOLLOWUP = { box: ".lahe-followup textarea", send: ".lahe-followup button" };

test.describe("Send greys out over an empty box", () => {
  let app;
  let helper;

  test.beforeEach(async () => {
    ({ app, helper } = await startBoth());
  });

  test.afterEach(async () => {
    if (app) await app.close();
    if (helper) await helper.stop();
  });

  test("the Active tab's add-another-message box: off while blank, on with words, off again on whitespace", async ({ page }) => {
    await bootedPage(page, app);
    const item = await commentOnLede(page, "Shorter headline.");
    await waitForRevInLog(helper, item.id, 1);

    await pollPage(page, (id) => {
      const node = window.__lahe.rail.cardNode(id);
      const box = node && node.querySelector(".lahe-rail-add textarea");
      return !!(box && box.checkVisibility());
    }, item.id, { message: "the add-another-message box to show under the sent comment" });

    let state = await boxState(page, item.id, ADD.box, ADD.send);
    expect(state.value).toBe("");
    expect(state.sendDisabled, "an empty box offers no Send").toBe(true);
    expect(state.boxDisabled, "the box itself stays open for typing").toBe(false);

    await focusRailBox(page, item.id, ADD.box);
    await page.keyboard.type("   ");
    state = await boxState(page, item.id, ADD.box, ADD.send);
    expect(state.sendDisabled, "spaces are not a message").toBe(true);

    // The send key over a blank box stays a no-op: no second revision.
    await page.keyboard.press("Enter");
    const revBefore = await page.evaluate((id) => window.__lahe.itemById(id).rev, item.id);
    expect(revBefore).toBe(1);

    await page.keyboard.type("also the lede");
    state = await boxState(page, item.id, ADD.box, ADD.send);
    expect(state.sendDisabled, "words make Send live").toBe(false);

    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    state = await boxState(page, item.id, ADD.box, ADD.send);
    expect(state.sendDisabled, "emptied again, Send goes off again").toBe(true);
  });

  test("a restored draft in the add box enables Send on reload", async ({ page }) => {
    await bootedPage(page, app);
    const item = await commentOnLede(page, "Shorter headline.");
    await waitForRevInLog(helper, item.id, 1);
    await focusRailBox(page, item.id, ADD.box);
    await page.keyboard.type("half a thought");
    await pollPage(page, (id) => {
      const node = window.__lahe.rail.cardNode(id);
      return node.querySelector(".lahe-rail-add textarea").value === "half a thought";
    }, item.id, { message: "the draft to land in the box" });

    await page.reload();
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, { message: "the reload to boot" });
    await pollPage(page, (id) => {
      const node = window.__lahe.rail.cardNode(id);
      const box = node && node.querySelector(".lahe-rail-add textarea");
      return !!(box && box.value === "half a thought");
    }, item.id, { message: "the draft to come back after the reload" });
    const state = await boxState(page, item.id, ADD.box, ADD.send);
    expect(state.sendDisabled, "a restored draft is something to send").toBe(false);
  });

  test("the Done tab's follow-up composer: off while blank, on with words", async ({ page }) => {
    await bootedPage(page, app);
    const item = await commentOnLede(page, "Shorter headline.");
    await agentAnswers(page, helper, item.id, "handled", "Done.");

    await pollPage(page, (id) => {
      const done = window.__lahe.handle.doneTab();
      return !!(done && done.followup && done.followup(id));
    }, item.id, { message: "the follow-up composer to be drawn for the answered card" });

    let state = await boxState(page, item.id, FOLLOWUP.box, FOLLOWUP.send);
    expect(state, "the composer and its Send are on the card").not.toBeNull();
    expect(state.sendDisabled, "an empty follow-up box offers no Send").toBe(true);

    await focusRailBox(page, item.id, FOLLOWUP.box);
    await page.keyboard.type("One more thing.");
    state = await boxState(page, item.id, FOLLOWUP.box, FOLLOWUP.send);
    expect(state.sendDisabled, "words make Send live").toBe(false);

    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("  ");
    state = await boxState(page, item.id, FOLLOWUP.box, FOLLOWUP.send);
    expect(state.sendDisabled, "whitespace is not a follow-up").toBe(true);
  });
});

test.describe("a read-only window answers a click in a locked box", () => {
  let app;
  let helper;

  test.beforeEach(async () => {
    ({ app, helper } = await startBoth());
  });

  test.afterEach(async () => {
    if (app) await app.close();
    if (helper) await helper.stop();
  });

  // ONE CONTEXT, TWO TABS, as a person has them: the second tab shares the
  // first one's storage, so it draws the same cards and is refused the review.
  // (Two contexts would be two browsers, and the second would have no cards
  // to lock.) ctxB is the same context, kept under a second name so the
  // teardown reads the same in every test.
  async function refusedPair(browser, dark) {
    const ctxA = await browser.newContext();
    const ctxB = ctxA;
    const winA = await ctxA.newPage();
    const winB = await ctxA.newPage();
    if (dark) await winB.emulateMedia({ colorScheme: "dark" });
    await bootedPage(winA, app);
    await pollPage(winA, () => window.__lahe.handle.sync.lockState().helperGranted, undefined, {
      message: "the first window to hold the review"
    });
    // One sent comment and one answered one, so the second window draws an
    // add-another-message box on the Active tab and a composer on Done.
    const open = await commentOnLede(winA, "Shorter headline.");
    await waitForRevInLog(helper, open.id, 1);

    await bootedPage(winB, app);
    await pollPage(winB, () => window.__lahe.handle.rail.refusalShown(), undefined, {
      message: "the second window to be refused"
    });
    await pollPage(winB, (id) => {
      const node = window.__lahe.rail.cardNode(id);
      const box = node && node.querySelector(".lahe-rail-add textarea");
      return !!box;
    }, open.id, { message: "the refused window to draw the sent comment's card" });
    return { ctxA, ctxB, winA, winB, open };
  }

  test("the boxes read as locked, and a click, a tab or a key brings the dismissed panel back and pulses it", async ({ browser }) => {
    const { ctxA, ctxB, winB, open } = await refusedPair(browser, false);
    try {
      let box = await boxState(winB, open.id, ADD.box, ADD.send);
      expect(box.boxLocked, "the add box is marked locked").toBe(true);
      expect(box.boxReadOnly, "locked means read-only, not disabled").toBe(true);
      expect(box.boxDisabled).toBe(false);
      expect(box.placeholder, "the box says where the review is before anyone clicks").toBe("Open in another window");
      expect(box.sendLocked).toBe(true);
      expect(box.sendDisabled, "a locked Send keeps its click so it can answer").toBe(false);

      // The reviewer closes the panel, as Ken did, then clicks into the box.
      await winB.evaluate(() => window.__lahe.handle.rail.dismissRefusal());
      let state = await railState(winB);
      expect(state.refusalShown, "dismissed").toBe(false);

      await focusRailBox(winB, open.id, ADD.box);
      await pollPage(winB, () => window.__lahe.handle.rail.refusalShown() && window.__lahe.handle.rail.refusalNudged(), undefined, {
        message: "the panel to come back and pulse on a tab into the locked box"
      });
      state = await railState(winB);
      expect(state.button.visible, "the way out is on screen").toBe(true);

      // Typing into the locked box types nothing and nudges again.
      await pollPage(winB, () => !window.__lahe.handle.rail.refusalNudged(), undefined, {
        message: "the first pulse to end",
        timeoutMs: 5000
      });
      await winB.keyboard.type("x");
      await pollPage(winB, () => window.__lahe.handle.rail.refusalNudged(), undefined, {
        message: "a keypress in the locked box to pulse the panel"
      });
      box = await boxState(winB, open.id, ADD.box, ADD.send);
      expect(box.value, "nothing was typed into a locked box").toBe("");

      // A real press on the locked Send, at its on-screen geometry.
      await winB.evaluate(() => window.__lahe.handle.rail.dismissRefusal());
      const rect = await winB.evaluate((id) => {
        const node = window.__lahe.rail.cardNode(id);
        const r = node.querySelector(".lahe-rail-add .lahe-rail-send").getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, open.id);
      await winB.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
      await pollPage(winB, () => window.__lahe.handle.rail.refusalShown() && window.__lahe.handle.rail.refusalNudged(), undefined, {
        message: "a click on the locked Send to bring the panel back"
      });

      // The comment chord on the page, with the panel dismissed again.
      await winB.evaluate(() => window.__lahe.handle.rail.dismissRefusal());
      await winB.mouse.click(5, 5);
      await winB.keyboard.press("ControlOrMeta+Shift+KeyC");
      await pollPage(winB, () => window.__lahe.handle.rail.refusalShown() && window.__lahe.handle.rail.refusalNudged(), undefined, {
        message: "Cmd-Shift-C in a refused window to bring the panel back"
      });
      expect(
        await winB.evaluate(() => window.__lahe.handle.comments.openBoxes().length),
        "read-only still opens no box"
      ).toBe(0);

      // Nothing leaked into the log from the refused window.
      const readies = readEventLog(helper.stateDir, REVIEW).filter((e) => e.event === "item.ready");
      expect(readies.length).toBe(1);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test("taking the review over unlocks the boxes and puts their own placeholder back", async ({ browser }) => {
    const { ctxA, ctxB, winB, open } = await refusedPair(browser, false);
    try {
      const info = await winB.evaluate(() => window.__lahe.handle.rail.refusalButtonInfo());
      await winB.mouse.click(info.rect.x + info.rect.width / 2, info.rect.y + info.rect.height / 2);
      await pollPage(winB, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
        message: "the takeover to be granted"
      });
      await pollPage(winB, (id) => {
        const node = window.__lahe.rail.cardNode(id);
        const box = node && node.querySelector(".lahe-rail-add textarea");
        return !!box && box.getAttribute("data-lahe-locked") !== "true";
      }, open.id, { message: "the add box to unlock" });
      const box = await boxState(winB, open.id, ADD.box, ADD.send);
      expect(box.boxReadOnly).toBe(false);
      expect(box.placeholder).toBe("Add another message");
      expect(box.sendLocked).toBe(false);
      expect(box.sendDisabled, "unlocked and empty: Send is off for the ordinary reason").toBe(true);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  for (const dark of [false, true]) {
    test("screenshot: the locked box and the nudged panel, " + (dark ? "dark" : "light"), async ({ browser }) => {
      const { ctxA, ctxB, winB, open } = await refusedPair(browser, dark);
      try {
        await winB.setViewportSize({ width: 1100, height: 720 });
        if (dark) {
          await winB.evaluate(() => {
            document.documentElement.style.background = "#14161b";
            document.body.style.background = "#14161b";
            document.body.style.color = "#e6e6e6";
            window.__lahe.rail.refreshScheme();
          });
        }
        await focusRailBox(winB, open.id, ADD.box);
        await pollPage(winB, () => window.__lahe.handle.rail.refusalNudged(), undefined, { message: "the pulse" });
        fs.mkdirSync(SHOTS, { recursive: true });
        await winB.screenshot({ path: path.join(SHOTS, dark ? "readonly_nudge_dark.png" : "readonly_nudge_light.png") });
      } finally {
        await ctxA.close();
        await ctxB.close();
      }
    });
  }
});
