// Clicking a card to find its place on the page.
//
// A card in the rail is a pointer at a passage, and the reviewer's question in
// front of it is "where is this?". Scrolling the page by hand to find out is the
// tax this removes: the whole card is the gesture, in every tab.
//
// What is asserted here is the four answers, on a real page, through real
// clicks:
//
//   a ready comment       scrolls to its painted passage and washes it
//   the Follow up button  does its own job, and the page does not move
//   a page-level note     points at nothing, so nothing happens (and nothing breaks)
//   a handled hand edit   has no paint left, and still finds its region
//
// It runs on 0C's application with a real helper, because "handled" is a state
// only an agent's reply can produce, and the reply here is what the contract
// says it is: one appended JSON line.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  placeCaret,
  startService,
  readEventLog,
  SERVICE_ENTRY
} = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "card-jump-review";
const EPHEMERAL_PORT = ["--port", "0"];

// Short enough that everything in the feed is below the fold, so "the page
// moved" is a real measurement rather than a rounding error.
const VIEWPORT = { width: 900, height: 380 };

function appendReply(helper, fields) {
  const file = path.join(helper.stateDir, "reviews", REVIEW, "replies-claude.jsonl");
  fs.appendFileSync(file, JSON.stringify(fields) + "\n");
}

function waitForItemInLog(helper, itemId) {
  return pollUntil(
    () => {
      const lines = readEventLog(helper.stateDir, REVIEW);
      return lines.some((event) => event.item === itemId && event.record) ? lines : null;
    },
    { message: "the record to reach the helper's events.jsonl" }
  );
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
  await page.setViewportSize(VIEWPORT);
  await page.goto(app.urlFor("/?morph=off"));
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

// --- the reviewer's gestures --------------------------------------------------

async function commentOnSelection(page, selector, text) {
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
}

async function untetheredNote(page, text) {
  await page.evaluate(() => window.__lahe.handle.tab().focusNote());
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

async function typeEdit(page, selector, text) {
  await placeCaret(page, { selector: selector, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.editState().open === true, undefined, {
    message: "Cmd-Shift-E to put the block into edit state"
  });
  const length = await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await placeCaret(page, { selector: selector, offset: length });
  await page.keyboard.type(text, { delay: 10 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
    message: "Esc to commit the edit"
  });
}

// --- reading the page back ----------------------------------------------------

function scrollY(page) {
  return page.evaluate(() => window.scrollY);
}

async function toTop(page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await pollPage(page, () => window.scrollY === 0, undefined, { message: "the page to be back at the top" });
}

/** Where a card is on screen. The rail is a closed shadow root; it answers. */
function cardRect(page, id) {
  return page.evaluate((itemId) => {
    const node = window.__lahe.rail.cardNode(itemId);
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, id);
}

/** A click on the card itself: the top strip, which holds no control. */
async function clickCard(page, id) {
  const rect = await cardRect(page, id);
  expect(rect, "the card to be on screen").toBeTruthy();
  expect(rect.width, "the card to be in the tab the reviewer is looking at").toBeGreaterThan(0);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + 6);
}

async function clickCardButton(page, id, label) {
  const rect = await page.evaluate(
    ([itemId, want]) => {
      const node = window.__lahe.rail.cardNode(itemId);
      if (!node) return null;
      const button = Array.prototype.find.call(node.querySelectorAll("button"), (b) =>
        (b.textContent || "").trim() === want
      );
      if (!button) return null;
      // Scrolled into the rail's own view BEFORE it is measured. The press below
      // is a real mouse click at these coordinates, which is the point (the
      // card's click-to-jump handler has to get the chance to swallow it and
      // not take it). A control below the fold is measured at a y the viewport
      // does not contain, and the click then lands on the page instead, which
      // reads as the handler silently doing nothing.
      button.scrollIntoView({ block: "center" });
      const r = button.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    [id, label]
  );
  expect(rect, 'the "' + label + '" button to be on the card').toBeTruthy();
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
  return rect;
}

function emphasized(page) {
  return page.evaluate(() => window.__lahe.emphasizedText());
}

/** The smooth scroll has arrived, and the passage is whole inside the window. */
function settledInView(page, selector) {
  return pollPage(
    page,
    (sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return r.top > 0 && r.bottom < window.innerHeight;
    },
    selector,
    { message: "the smooth scroll to settle with " + selector + " in view" }
  );
}

test.describe("clicking a card jumps to its place on the page", () => {
  test("a ready comment scrolls its passage into view and washes it", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "#feed-queue p", "this queue is longer than the day is");
      const [item] = await page.evaluate(() => window.__lahe.items());

      await toTop(page);
      await clickCard(page, item.id);

      await pollPage(page, () => window.scrollY > 0, undefined, {
        message: "the click to scroll the passage into view"
      });
      const emphasis = await emphasized(page);
      expect(emphasis, "the passage itself is washed, briefly").toContain("check-ins");

      // Centered, not merely on screen: the passage is not left under the rail
      // or against the top edge. Polled, because the scroll is a smooth one and
      // reading the rect mid-animation measures the trip rather than the arrival.
      await settledInView(page, "#feed-queue p");

      // And it does not stay: the emphasis is a moment, never a third state.
      await pollPage(page, () => window.__lahe.emphasizedText() === "", undefined, {
        message: "the wash to lift on its own"
      });
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a drag that selects text inside a card is a selection, not a jump", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "#feed-queue p", "this queue is longer than the day is");
      const [item] = await page.evaluate(() => window.__lahe.items());

      await toTop(page);
      // Copying the agent's words, or the reviewer's own, out of a card ends in
      // a mouse-up inside the card. It must not throw the page somewhere.
      const rect = await cardRect(page, item.id);
      const y = rect.y + rect.height / 2;
      await page.mouse.move(rect.x + 12, y);
      await page.mouse.down();
      await page.mouse.move(rect.x + rect.width - 12, y, { steps: 8 });
      await page.mouse.up();

      expect(await scrollY(page), "a selection is not a jump").toBe(0);
      expect(await emphasized(page)).toBe("");
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a page-level note points at nothing, so clicking it does nothing at all", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await untetheredNote(page, "the whole page reads like two pages");
      const [item] = await page.evaluate(() => window.__lahe.items());

      await toTop(page);
      await clickCard(page, item.id);

      // Nothing moves and nothing lights up, and nothing is broken: the card is
      // still there, still the reviewer's note.
      expect(await scrollY(page)).toBe(0);
      expect(await emphasized(page)).toBe("");
      expect(await page.evaluate((id) => window.__lahe.itemById(id).note, item.id)).toBe(
        "the whole page reads like two pages"
      );
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("sending a follow-up does its own job, and the page stays where it is", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "#feed-queue p", "this queue is longer than the day is");
      const [item] = await page.evaluate(() => window.__lahe.items());
      await waitForItemInLog(helper, item.id);

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "handled",
        agent: "claude",
        text: "Trimmed it to three."
      });
      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the reply to fold onto the card"
      });
      await page.evaluate(() => window.__lahe.rail.selectTab("done"));

      // The card used to carry a Follow up button whose whole job was focusing
      // the box below it. It is gone, and the box's own send button is the
      // control this test is about now: a real one, with words in the field.
      await page.evaluate((id) => {
        const input = window.__lahe.rail.cardNode(id).querySelector("textarea.lahe-followup-input");
        input.value = "It still runs long.";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, item.id);

      await toTop(page);
      await clickCardButton(page, item.id, "Follow up");

      expect(await scrollY(page), "a press meant for a control is not a jump").toBe(0);
      expect(await emphasized(page)).toBe("");
      // It did what it is for: the item is back in front of the agent.
      await pollPage(page, (id) => window.__lahe.itemById(id).state === "ready", item.id, {
        message: "the follow-up to put the item back in front of the agent"
      });
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a handled hand edit has no paint left, and still finds its region", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await typeEdit(page, "#feed-queue p", " Two of them can wait for Thursday.");
      const [item] = await page.evaluate(() => window.__lahe.items());
      expect(item.kind).toBe("edit");
      await waitForItemInLog(helper, item.id);

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "handled",
        agent: "claude",
        text: "Carried it into the template."
      });
      await pollPage(page, (id) => window.__lahe.itemById(id).state === "handled", item.id, {
        message: "the edit to be handled, which unpaints it"
      });
      // A handled item lives in Done, and a card in a pane that is not showing
      // is not a card the reviewer can click.
      await page.evaluate(() => window.__lahe.rail.selectTab("done"));

      await toTop(page);
      await clickCard(page, item.id);

      await pollPage(page, () => window.scrollY > 0, undefined, {
        message: "the click to re-find the region through the anchor and scroll to it"
      });
      expect(await emphasized(page), "and the region is washed the same way").toContain("Thursday");
      await settledInView(page, "#feed-queue p");
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});
