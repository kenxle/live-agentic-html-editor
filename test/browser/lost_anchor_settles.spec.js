// A page that finishes drawing itself after load, and the lost card that used
// to stick to it.
//
// Reported live on 2026-08-17. A comment card read "The passage this comment
// points at is gone from the page" while the passage was on screen, and the
// review's own review.json flagged nothing lost. Both halves were true at once:
// the passage went briefly unfindable while the page was still rendering (the
// reviewed report draws its mermaid diagrams a few hundred milliseconds after
// load, replacing whole sections), replay stamped the record and badged the
// card, the next pass found the passage and cleared the stamp, and nothing ever
// took the badge back off.
//
// The page here is that pattern, in miniature: a script replaces a section's
// DOM half a second after load with the same words in new nodes. The reload is
// what the auto-reload work (R36) now does routinely, which is why this started
// being seen.
//
// The control is the other half of the promise. A passage that really is gone
// gets the lost card, and it KEEPS it: this must not become a fix that softens
// real loss detection into silence (R20).

"use strict";

const { test, expect, pollPage, startStaticServer } = require("../helpers");
const { withLayer, scriptTagFor } = require("./support/with_layer");

const REVIEW = "settling-page";
const TOKEN = "settling-token";
const DOC_PATH = "/settling-doc.html";

const PASSAGE = "The third week is where a comeback stops being about willpower.";
const SAID = "Name the week, not the feeling.";

// The two beats of the render: the drawn copy goes in beside the source, and
// the source comes out. Both are well inside replay's settling window, and the
// first is late enough that the boot pass has certainly already run against
// the served HTML.
const CLEAR_MS = 300;
const DRAW_MS = 700;

// The window in which the reviewer's passage is on none of the page: this is
// where the false lost verdict was reached.
const SETTLED_MS = 2600;

/**
 * A document whose diagram section is rendered after load, in the two beats a
 * renderer actually takes: it draws its own copy alongside the source it was
 * given, and then takes the source away. In between, the reviewer's passage is
 * on the page TWICE, which is a lost anchor exactly like being on it zero
 * times: nothing can be written or moved when two places match.
 *
 * `mode` is what the finished render leaves behind:
 *   "same"   the passage, in the drawn section: a re-render, nothing is lost
 *   "gone"   a diagram and no passage: a genuine loss
 */
function docHtml(config, mode) {
  var drawnBody =
    mode === "gone"
      ? '"<p id=\\"diagram\\">A diagram stands here now.</p>"'
      : '\'<p id="passage">\' + ' + JSON.stringify(PASSAGE) + ' + "</p>"';
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" />' +
    "<title>Settling</title></head>\n<body>\n<main>\n" +
    "<h1>Coming back from a layoff</h1>\n" +
    '<section id="source">\n<p id="passage">' +
    PASSAGE +
    "</p>\n</section>\n" +
    '<p id="tail">Everything else on this page holds still.</p>\n' +
    "</main>\n" +
    "<script>\n" +
    'var source = document.getElementById("source");\n' +
    "setTimeout(function () {\n" +
    '  var drawn = document.createElement("section");\n' +
    '  drawn.id = "drawn";\n' +
    "  drawn.innerHTML = " +
    drawnBody +
    ";\n" +
    "  source.parentNode.insertBefore(drawn, source);\n" +
    "}, " +
    CLEAR_MS +
    ");\n" +
    "setTimeout(function () {\n" +
    "  source.remove();\n" +
    "}, " +
    DRAW_MS +
    ");\n" +
    "</script>\n" +
    scriptTagFor(config) +
    "\n</body>\n</html>\n"
  );
}

/** The reviewer's own gesture: select the passage, Cmd-Shift-C, type, Cmd-Enter. */
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

/** What the reviewer can actually see about this item's lost state. */
function lostState(page, id) {
  return page.evaluate(function (itemId) {
    const item = window.__lahe.itemById(itemId);
    const badges = window.__lahe.rail.cardBadges(itemId) || [];
    return {
      stamped: !!(item && item.region && item.region.lost),
      badged: badges.some(function (b) {
        return b.canonical_code === "ANCHOR_LOST";
      }),
      painted: window.__lahe.handle.comments.highlights.paintedIds().indexOf(itemId) !== -1
    };
  }, id);
}

// The settling window plus the recheck plus room for the pass it schedules. A
// verdict that is going to be reached at all is reached inside this. The number
// is written out here rather than read off the library, so this spec measures
// the same interval against a build that has no settling window at all.
async function afterTheWindowCloses(page) {
  await page.waitForTimeout(SETTLED_MS);
}

test.describe("a page that is still drawing itself is not called lost", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ label: "settling-page" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("a section re-rendered after load never leaves a lost card behind", async ({ page }) => {
    const config = { review: REVIEW, token: TOKEN, helper: "http://127.0.0.1:1" };
    await withLayer(page, config);
    await page.route("**" + DOC_PATH, function (route) {
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: docHtml(config, "same")
      });
    });

    await page.goto(pages.origin + DOC_PATH);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its script tag"
    });
    // Comment AFTER the first re-render, so the record is minted against the
    // rendered page and the reload is the only thing under test.
    await page.waitForTimeout(DRAW_MS + 300);
    await commentOnSelection(page, "#passage", SAID);

    const id = await page.evaluate((said) => {
      const found = window.__lahe.items().filter((item) => item.note === said)[0];
      return found ? found.id : null;
    }, SAID);
    expect(id, "the comment exists").toBeTruthy();

    // The reload. This is what a rebuild does to the reviewer's page now.
    await page.reload();
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot again after the reload"
    });
    await afterTheWindowCloses(page);

    const state = await lostState(page, id);
    expect(state.badged, "the card must not say the passage is gone: it is right there").toBe(false);
    expect(state.stamped, "and the record must carry no lost stamp either").toBe(false);
    expect(
      await page.evaluate(() => !!document.querySelector("#passage")),
      "the passage really is on the page, which is the whole point"
    ).toBe(true);

    // The comment landed where it belongs: on the passage, in the rendered
    // section the page built after load.
    await pollPage(
      page,
      (itemId) => window.__lahe.handle.comments.highlights.paintedIds().indexOf(itemId) !== -1,
      id,
      { message: "the passage to be tinted again on the re-rendered section" }
    );
    const range = await page.evaluate(
      (itemId) => String(window.__lahe.handle.comments.highlights.rangeFor(itemId) || ""),
      id
    );
    expect(range, "and the tint covers that passage, not some other run of text").toBe(PASSAGE);
  });

  test("a passage that really is gone gets the lost card, and keeps it", async ({ page }) => {
    const config = { review: REVIEW + "-gone", token: TOKEN, helper: "http://127.0.0.1:1" };
    // The passage is there on the first load and removed by the re-render on
    // the second, which is an agent deleting it between rebuilds.
    let mode = "same";
    await withLayer(page, config);
    await page.route("**" + DOC_PATH, function (route) {
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: docHtml(config, mode)
      });
    });

    await page.goto(pages.origin + DOC_PATH);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its script tag"
    });
    await page.waitForTimeout(DRAW_MS + 300);
    await commentOnSelection(page, "#passage", SAID);
    const id = await page.evaluate((said) => {
      const found = window.__lahe.items().filter((item) => item.note === said)[0];
      return found ? found.id : null;
    }, SAID);
    expect(id).toBeTruthy();

    mode = "gone";
    await page.reload();
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot again after the reload"
    });
    await afterTheWindowCloses(page);

    const state = await lostState(page, id);
    expect(state.badged, "a real loss is still told to the reviewer").toBe(true);
    expect(state.stamped, "and it is on the record, which is what the agent reads").toBe(true);
    expect(
      await page.evaluate(() => !!document.querySelector("#passage")),
      "the passage really is off the page, which is what makes this a real loss"
    ).toBe(false);

    // And it stays. A later pass over the same page must not talk the reviewer
    // out of a warning that is true.
    await page.evaluate(() => window.__lahe.replayNow());
    await page.waitForTimeout(300);
    const later = await lostState(page, id);
    expect(later.badged, "the lost card is still there a pass later").toBe(true);
    expect(later.stamped).toBe(true);
  });
});
