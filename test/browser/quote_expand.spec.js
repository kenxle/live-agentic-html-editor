// The quoted passage on a card opens out.
//
// Ken, 2026-10-12, on a card whose passage was cut to two lines: "i should be
// able to expand this somehow." The quote itself is the control: a passage
// longer than two lines takes a click (or Enter) and shows the whole thing, a
// second click clamps it again, and a short passage is not a control at all.

"use strict";

const { test, expect, pollPage, startService, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "quote-expand-review";

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
  await pollPage(page, (want) => window.__lahe.items().some((i) => i.note === want), text, {
    message: "the comment to become a record"
  });
  const items = await page.evaluate(() => window.__lahe.items());
  return items.find((item) => item.note === text);
}

function quoteShape(page, id) {
  return page.evaluate((itemId) => {
    const node = window.__lahe.rail.cardNode(itemId);
    const quote = node.querySelector(".card__quote");
    const r = quote.getBoundingClientRect();
    return {
      height: Math.round(r.height),
      more: quote.getAttribute("data-lahe-more") === "true",
      open: quote.getAttribute("data-lahe-quote-open") === "true",
      role: quote.getAttribute("role"),
      expanded: quote.getAttribute("aria-expanded"),
      clipped: quote.scrollHeight > quote.clientHeight + 1,
      rect: { x: r.x, y: r.y, width: r.width, height: r.height }
    };
  }, id);
}

test("a long passage opens out on a click and clamps again on the next", async ({ page }) => {
  const app = await startAppServer();
  const helper = await startService({
    entry: SERVICE_ENTRY,
    args: ["--port", "0"],
    reviews: [REVIEW],
    allowedOrigins: [app.origin]
  });
  try {
    app.useLayer({ review: REVIEW, token: helper.tokenFor(REVIEW), helper: helper.url });
    await page.goto(app.urlFor("/?morph=off"));
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot"
    });

    // The short passage first: the comment chord needs the page's own focus,
    // and the keyboard steps below leave it inside the rail.
    const short = await commentOn(page, "#feed-queue h3", "rename this");
    const long = await commentOn(page, "p.lede", "cut this down");
    await pollPage(
      page,
      (id) => {
        const node = window.__lahe.rail.cardNode(id);
        return !!node && node.querySelector(".card__quote").getAttribute("data-lahe-more") === "true";
      },
      long.id,
      { message: "the long passage to be marked as having more to show" }
    );

    const clamped = await quoteShape(page, long.id);
    expect(clamped.clipped, "two lines of a three-line passage").toBe(true);
    expect(clamped.role, "the quote is a control").toBe("button");
    expect(clamped.expanded).toBe("false");

    await page.mouse.click(clamped.rect.x + clamped.rect.width / 2, clamped.rect.y + clamped.rect.height / 2);
    await pollPage(
      page,
      (id) => window.__lahe.rail.cardNode(id).querySelector(".card__quote").getAttribute("data-lahe-quote-open") === "true",
      long.id,
      { message: "the quote to open out" }
    );
    const opened = await quoteShape(page, long.id);
    expect(opened.clipped, "nothing is cut off any more").toBe(false);
    expect(opened.height).toBeGreaterThan(clamped.height);
    expect(opened.expanded).toBe("true");

    // Enter on the focused quote clamps it again.
    await page.evaluate((id) => {
      window.__lahe.rail.cardNode(id).querySelector(".card__quote").focus();
    }, long.id);
    await page.keyboard.press("Enter");
    await pollPage(
      page,
      (id) => window.__lahe.rail.cardNode(id).querySelector(".card__quote").getAttribute("data-lahe-quote-open") !== "true",
      long.id,
      { message: "the quote to clamp again" }
    );
    const again = await quoteShape(page, long.id);
    expect(again.clipped).toBe(true);
    expect(again.height).toBe(clamped.height);

    // A short passage is plain text, not a control.
    await page.evaluate((id) => {
      window.__lahe.rail.cardNode(id).scrollIntoView({ block: "center" });
    }, short.id);
    // The overflow mark is measured a frame after the fill; wait for the frame.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const plain = await quoteShape(page, short.id);
    expect(plain.clipped).toBe(false);
    expect(plain.more).toBe(false);
    expect(plain.role).toBeNull();
  } finally {
    await helper.kill9();
    await app.close();
  }
});
