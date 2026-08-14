// Highlights after a reload.
//
// Found by a real-browser walker on 2026-08-14. Comment on a passage of a static
// page: the passage is tinted, a card appears, the record is durable. Reload the
// page. The records come back, the cards come back, committed edits are replayed
// back onto the page, LAHE.anchor.resolve says bound:true for the comment's own
// reference, and the passage is not tinted at all: paintedIds() is empty.
//
// Boot's merge() redrew the cards and replay put the edits back, and nothing
// ever repainted the comment highlights, because a highlight is DOM and DOM does
// not survive a load. The reviewer's own marks are the map of what they have
// looked at, so a page whose marks vanish on every reload is a reviewer doing
// the pass twice. Reopen-after-reload cannot show a highlight either, for the
// same reason.
//
// The no-reload lifecycle already worked and has to keep working: paint on
// comment, unpaint when the agent handles it, repaint on reopen (ac3_walk.spec
// and the AC3 walk own that half). This spec is only about the load path.
//
// A LOST ANCHOR MUST STAY LOST. The second passage is gone from the document the
// server sends after the reload, which is the ordinary case on a dev server the
// agent is editing. That record has to come back unpainted, with no error: an
// honest miss, the same answer replay gives.

"use strict";

const { test, expect, pollPage, startStaticServer } = require("../helpers");
const { withLayer, scriptTagFor } = require("./support/with_layer");

const REVIEW = "reload-highlights";
const TOKEN = "reload-token";
const DOC_PATH = "/reload-doc.html";

const KEEPER = "Runners come back too fast after a layoff, and the third week is where it shows.";
const VANISHING = "The plan for week one is three easy runs and nothing else.";

const SAID = {
  keeper: "Name the week, not the feeling.",
  vanishing: "Say how long each run is."
};

// A static document. Nothing on it re-renders, nothing polls: the only thing
// that happens to this page is the reviewer, and the reload.
function docHtml(config, options) {
  return (
    "<!doctype html>\n<html lang=\"en\">\n<head><meta charset=\"utf-8\" />" +
    "<title>Steady Pace</title></head>\n<body>\n<main>\n" +
    "<h1>Steady Pace</h1>\n" +
    '<p id="keeper">' +
    KEEPER +
    "</p>\n" +
    (options.dropVanishing ? "" : '<p id="vanishing">' + VANISHING + "</p>\n") +
    '<p id="tail">Everything here is written to be read once and acted on.</p>\n' +
    "</main>\n" +
    scriptTagFor(config) +
    "\n</body>\n</html>\n"
  );
}

/** The reviewer's own gesture: select a passage, Cmd-Shift-C, type, Cmd-Enter. */
async function commentOnSelection(page, selector, text) {
  await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("nothing matched " + sel);
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
  await pollPage(
    page,
    (note) => window.__lahe.items().some((item) => item.note === note && item.state === "ready"),
    text,
    { message: "the comment to be ready" }
  );
}

// What the browser will actually paint, by id, plus the text inside each painted
// range. The range text is the load-bearing half: an id in the registry pointing
// at a collapsed range is a highlight nobody can see.
function paintState(page, id) {
  return page.evaluate(function (itemId) {
    const highlights = window.__lahe.handle.comments.highlights;
    const range = highlights.rangeFor(itemId);
    return {
      painted: highlights.paintedIds().indexOf(itemId) !== -1,
      text: range ? String(range) : null,
      allPainted: highlights.paintedIds().length
    };
  }, id);
}

test.describe("the reviewer's highlights come back with the page", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ label: "reload-highlights" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("a reload repaints every outstanding comment, and a lost one stays honestly unpainted", async ({
    page
  }) => {
    const config = { review: REVIEW, token: TOKEN, helper: "http://127.0.0.1:1" };
    // The agent deletes the second passage from the source between the two
    // loads. One variable, flipped once.
    let dropVanishing = false;

    // withLayer is here for ONE thing: it serves the built bundle from a path on
    // this origin. The document itself is this file's, so it can change between
    // loads.
    await withLayer(page, config);
    await page.route("**" + DOC_PATH, function (route) {
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: docHtml(config, { dropVanishing: dropVanishing })
      });
    });

    await page.goto(pages.origin + DOC_PATH);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its script tag"
    });

    await commentOnSelection(page, "#keeper", SAID.keeper);
    await commentOnSelection(page, "#vanishing", SAID.vanishing);

    const before = await page.evaluate((said) => {
      const byNote = {};
      window.__lahe.items().forEach((item) => {
        byNote[item.note] = item.id;
      });
      return { keeper: byNote[said.keeper], vanishing: byNote[said.vanishing] };
    }, SAID);
    expect(before.keeper, "the first comment exists").toBeTruthy();
    expect(before.vanishing, "the second comment exists").toBeTruthy();

    const paintedKeeper = await paintState(page, before.keeper);
    expect(paintedKeeper.painted, "the passage is tinted when the comment is made").toBe(true);
    expect(paintedKeeper.text, "and the tint covers that passage").toBe(KEEPER);
    expect((await paintState(page, before.vanishing)).painted).toBe(true);

    // --- the reload, with the second passage gone from the source ------------

    dropVanishing = true;
    await page.reload();
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot again after the reload"
    });
    await pollPage(page, () => window.__lahe.items().length === 2, undefined, {
      message: "both records to come back from browser storage"
    });

    // Everything that already survived a reload still does. Without this, a
    // regression in the load path could read as "the highlight came back"
    // while the rail lost the card it belongs to.
    expect(await page.evaluate(() => window.__lahe.cardIds().length), "both cards are redrawn").toBe(2);
    expect(await page.evaluate(() => !!document.querySelector("#vanishing"))).toBe(false);

    // The bug: this was [] and nothing on the page was tinted.
    await pollPage(
      page,
      (itemId) => window.__lahe.handle.comments.highlights.paintedIds().indexOf(itemId) !== -1,
      before.keeper,
      { message: "the surviving passage to be tinted again after the reload" }
    );
    const after = await paintState(page, before.keeper);
    expect(after.text, "and it is the same passage, not some other run of text").toBe(KEEPER);

    // The lost one is an honest miss: no paint, no error, and the record is
    // still the reviewer's to see in the rail.
    const lost = await paintState(page, before.vanishing);
    expect(lost.painted, "a record whose passage is gone is not painted").toBe(false);
    expect(lost.allPainted, "and it did not paint something else instead").toBe(1);
    expect(
      await page.evaluate((itemId) => !!window.__lahe.itemById(itemId), before.vanishing),
      "the lost record is still kept"
    ).toBe(true);

    // Reopen-after-reload, which could not work while nothing repainted: the box
    // opens on a passage that is really marked on the page.
    await page.evaluate((itemId) => window.__lahe.handle.comments.reopen(itemId), before.keeper);
    const reopened = await paintState(page, before.keeper);
    expect(reopened.painted, "the reopened comment is still tinted").toBe(true);
    expect(reopened.text).toBe(KEEPER);
  });
});
