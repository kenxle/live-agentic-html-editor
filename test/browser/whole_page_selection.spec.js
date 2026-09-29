// A reviewer who selects the whole page gets the whole page highlighted.
//
// The owner's rule: "if *I* highlighted the entire page, then that's the
// highlight. that doesn't happen very often, but if that's what i did, then
// that's what gets highlighted."
//
// The oversized-records work (docs/features/20260928.03_oversized_records)
// fixed the accidental case: a triple-click whose range ended at the start of
// the next block made the region the whole page. oversized_records.spec.js
// keeps that fixed. This spec is the other side: when the reviewer's own
// selection really does run from the first word to the last, the record is
// found (not lost) and every word of the page is painted, on the page and again
// after a reload, including after the agent has changed something on the page.

"use strict";

const { test, expect, pollPage, startStaticServer } = require("../helpers");
const { withLayer, scriptTagFor } = require("./support/with_layer");

const REVIEW = "whole-page-selection";
const TOKEN = "whole-page-token";
const DOC_PATH = "/whole-page-doc.html";

const WORDS = {
  title: "Steady Pace",
  intro: "Runners come back too fast after a layoff, and the third week is where it shows.",
  weekOne: "Week one is three easy runs and nothing else.",
  weekTwo: "Week two adds a fourth run.",
  closing: "Everything here is written to be read once and acted on."
};

// A flat document: every block sits directly in <main>, so the only element
// holding the whole selection is the page itself.
function docHtml(config, options) {
  const weekTwo = options.reworded ? "Week two adds a fourth run, still easy." : WORDS.weekTwo;
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" />' +
    "<title>Steady Pace</title>" +
    "<style>body{font:16px/1.5 system-ui,sans-serif;margin:2rem}</style></head>\n<body>\n<main>\n" +
    '<h1 id="title">' + WORDS.title + "</h1>\n" +
    '<p id="intro">' + WORDS.intro + "</p>\n" +
    '<ul id="weeks">\n<li>' + WORDS.weekOne + "</li>\n<li>" + weekTwo + "</li>\n</ul>\n" +
    '<p id="closing">' + WORDS.closing + "</p>\n" +
    "</main>\n" +
    scriptTagFor(config) +
    "\n</body>\n</html>\n"
  );
}

/** The page's visible words, collapsed, the way a reader sees them. */
function pageWords(page) {
  return page.evaluate(function () {
    return document.querySelector("main").innerText.replace(/\s+/g, " ").trim();
  });
}

/** Where the first and last word sit on screen. */
function wordEnds(page) {
  return page.evaluate(function () {
    function rectOf(node, from, to) {
      const range = document.createRange();
      range.setStart(node, from);
      range.setEnd(node, to);
      const r = range.getBoundingClientRect();
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    }
    const first = document.getElementById("title").firstChild;
    const last = document.getElementById("closing").firstChild;
    return {
      first: rectOf(first, 0, 1),
      last: rectOf(last, last.data.length - 1, last.data.length)
    };
  });
}

/** The reviewer's own gesture: drag from the first word to the last, comment. */
async function commentOnWholePage(page, note) {
  const ends = await wordEnds(page);
  await page.mouse.move(ends.first.left + 1, (ends.first.top + ends.first.bottom) / 2);
  await page.mouse.down();
  await page.mouse.move(ends.last.right - 1, (ends.last.top + ends.last.bottom) / 2, { steps: 8 });
  await page.mouse.move(ends.last.right, (ends.last.top + ends.last.bottom) / 2);
  await page.mouse.up();
  const selected = await page.evaluate(() => String(window.getSelection()).replace(/\s+/g, " ").trim());
  expect(selected, "the drag selected every word of the page").toBe(await pageWords(page));

  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the selection"
  });
  await page.keyboard.type(note);
  await page.keyboard.press("ControlOrMeta+Enter");
  await pollPage(
    page,
    (text) => window.__lahe.items().some((item) => item.note === text && item.state === "ready"),
    note,
    { message: "the comment to be ready" }
  );
  return page.evaluate((text) => window.__lahe.items().find((item) => item.note === text), note);
}

/** Painted or not, and the words the paint covers. */
function paintState(page, id) {
  return page.evaluate(function (itemId) {
    const highlights = window.__lahe.handle.comments.highlights;
    const range = highlights.rangeFor(itemId);
    return {
      painted: highlights.paintedIds().indexOf(itemId) !== -1,
      text: range ? String(range).replace(/\s+/g, " ").trim() : null
    };
  }, id);
}

test.describe("a whole-page selection is the whole page", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ label: "whole-page-selection" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  async function openDoc(page, options) {
    const config = { review: REVIEW, token: TOKEN, helper: "http://127.0.0.1:1" };
    await withLayer(page, config);
    await page.route("**" + DOC_PATH, function (route) {
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: docHtml(config, options)
      });
    });
    await page.goto(pages.origin + DOC_PATH);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its script tag"
    });
  }

  test("dragging from the first word to the last paints the whole page, and it still does after a reload", async ({
    page
  }) => {
    const options = { reworded: false };
    await openDoc(page, options);
    const words = await pageWords(page);

    const item = await commentOnWholePage(page, "Tighten the whole page.");
    expect(item.region.lost, "the record is found").toBe(null);
    expect(item.region.ref.path, "and its region is the page, not the first block").toBe("body>main:1");

    const now = await paintState(page, item.id);
    expect(now.painted, "the selection is painted when the comment is made").toBe(true);
    expect(now.text, "and the paint is every word of the page").toBe(words);

    // Painted from the record alone, with the comment box gone.
    const repainted = await page.evaluate((itemId) => {
      const comments = window.__lahe.handle.comments;
      comments.unpaint(itemId);
      return comments.repaint(itemId);
    }, item.id);
    expect(repainted, "a repaint from the record paints").toBe(true);
    expect((await paintState(page, item.id)).text).toBe(words);

    await page.reload();
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot again after the reload"
    });
    await pollPage(
      page,
      (itemId) => window.__lahe.handle.comments.highlights.paintedIds().indexOf(itemId) !== -1,
      item.id,
      { message: "the whole page to be painted again after the reload" }
    );
    const after = await paintState(page, item.id);
    expect(after.text, "the same whole page, after the reload").toBe(words);
    const stored = await page.evaluate((itemId) => window.__lahe.itemById(itemId), item.id);
    expect(stored.region.lost, "and the record is still found").toBe(null);
  });

  test("a whole-page comment whose region is the page stays found and painted after the agent changes the page", async ({
    page
  }) => {
    const options = { reworded: false };
    await openDoc(page, options);

    // Select the whole page from the body's edges: the region is the page.
    await page.evaluate(function () {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector("main"));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
      message: "the comment box to open on the selection"
    });
    await page.keyboard.type("Tighten the whole page.");
    await page.keyboard.press("ControlOrMeta+Enter");
    await pollPage(page, () => window.__lahe.items().some((item) => item.state === "ready"), undefined, {
      message: "the comment to be ready"
    });
    const item = await page.evaluate(() => window.__lahe.items()[0]);
    expect(item.region.lost).toBe(null);
    expect(item.region.ref.path).toBe("body>main:1");

    // The agent rewords one line and carries the stamps into the source.
    const stamped = await page.evaluate(() => document.querySelector("main").outerHTML);
    options.reworded = true;
    await page.unroute("**" + DOC_PATH);
    await page.route("**" + DOC_PATH, function (route) {
      const html =
        '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Steady Pace</title></head>\n<body>\n' +
        stamped.replace(WORDS.weekTwo, "Week two adds a fourth run, still easy.") +
        "\n" +
        scriptTagFor({ review: REVIEW, token: TOKEN, helper: "http://127.0.0.1:1" }) +
        "\n</body>\n</html>\n";
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: html
      });
    });
    await page.reload();
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot again after the reload"
    });
    await pollPage(
      page,
      (itemId) => window.__lahe.handle.comments.highlights.paintedIds().indexOf(itemId) !== -1,
      item.id,
      { message: "the whole page to be painted after the agent's change" }
    );
    const after = await paintState(page, item.id);
    expect(after.text).toBe(await pageWords(page));
    const stored = await page.evaluate((itemId) => window.__lahe.itemById(itemId), item.id);
    expect(stored.region.lost, "the record is found, not lost").toBe(null);
  });
});
