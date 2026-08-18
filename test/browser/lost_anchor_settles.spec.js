// A page that finishes drawing itself after load, and the lost card that used
// to stick to it.
//
// Reported live on 2026-08-17. A comment card read "The passage this comment
// points at is gone from the page" while the passage was on screen, and the
// review's own review.json flagged nothing lost. Both halves were true at once:
// the passage went briefly unfindable while the page was still rendering (the
// reviewed report draws its mermaid diagrams a few hundred milliseconds after
// load, and while one is being drawn its words are on the page twice, so the
// anchor matches two places and binds to neither), replay stamped the record
// and badged the card, the next pass found the passage again and cleared the
// stamp, and nothing ever took the badge back off.
//
// test/fixtures/settling-render.js is that renderer in miniature. The reload is
// what the auto-reload work (R36) now does routinely, which is why this started
// being seen this week.
//
// The control is the other half of the promise. When replay cannot safely find
// the reviewed place, it keeps that truthful warning until the place can be
// matched again (R20).

"use strict";

const { test, expect, pollPage, startStaticServer } = require("../helpers");
const { withLayer, scriptTagFor } = require("./support/with_layer");

const REVIEW = "settling-page";
const TOKEN = "settling-token";
const DOC_PATH = "/settling-doc.html";

const PASSAGE = "The third week is where a comeback stops being about willpower.";
const SAID = "Name the week, not the feeling.";

/** The document, with the fixture renderer wired to `mode`. See the fixture. */
function docHtml(config, mode) {
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" />' +
    "<title>Settling</title></head>\n<body>\n<main>\n" +
    "<h1>Coming back from a layoff</h1>\n" +
    '<section id="source">\n<p id="passage">' +
    PASSAGE +
    "</p>\n</section>\n" +
    '<p id="tail">Everything else on this page holds still.</p>\n' +
    "</main>\n" +
    '<script src="/settling-render.js" data-mode="' +
    mode +
    '" data-passage="' +
    PASSAGE +
    '"></script>\n' +
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
    const anchorBadge = badges.find(function (b) {
      return /^(ANCHOR_NO_TEXT_MATCH|ANCHOR_AMBIGUOUS|ANCHOR_STRUCTURE_ONLY|ANCHOR_LOST)$/.test(
        b.canonical_code
      );
    });
    return {
      stamped: !!(item && item.region && item.region.lost),
      stampCode: item && item.region && item.region.lost ? item.region.lost.code : null,
      badged: !!anchorBadge,
      badgeCode: anchorBadge ? anchorBadge.canonical_code : null,
      badgeMessage: anchorBadge ? anchorBadge.message : null,
      painted: window.__lahe.handle.comments.highlights.paintedIds().indexOf(itemId) !== -1
    };
  }, id);
}

/** The page has finished drawing: the drawn section is in and the source is out. */
async function rendered(page) {
  await pollPage(page, () => !!document.getElementById("drawn") && !document.getElementById("source"), undefined, {
    message: "the fixture renderer to finish both of its beats"
  });
}

/**
 * The settling window is over AND a pass has run since it closed.
 *
 * Not a sleep: the window's end is a condition the library states, and the pass
 * after it is asked for rather than waited on. Anything replay is going to say
 * about this page it has said by the time this returns.
 */
async function afterTheWindowCloses(page) {
  await pollPage(page, () => window.LAHE.replay.isSettling() === false, undefined, {
    message: "replay's settling window to close"
  });
  await page.evaluate(() => window.__lahe.replayNow());
}

test.describe("a page that is still drawing itself is not called lost", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ label: "settling-page" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("a section rendered after load never leaves a lost card behind", async ({ page }) => {
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
    // Comment on the RENDERED page, so the record is minted against what the
    // renderer built and the reload is the only thing under test.
    await rendered(page);
    await commentOnSelection(page, "#passage", SAID);

    const id = await page.evaluate((said) => {
      const found = window.__lahe.items().filter((item) => item.note === said)[0];
      return found ? found.id : null;
    }, SAID);
    expect(id, "the comment exists").toBeTruthy();

    // The reload. This is what a rebuild does to the reviewer's page now (R36).
    await page.reload();
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot again after the reload"
    });
    await rendered(page);
    await afterTheWindowCloses(page);

    const state = await lostState(page, id);
    expect(state.badged, "the card must not say the passage is gone: it is right there").toBe(false);
    expect(state.stamped, "and the record must carry no lost stamp either").toBe(false);
    expect(
      await page.evaluate(() => !!document.querySelector("#passage")),
      "the passage really is on the page, which is the whole point"
    ).toBe(true);

    // The comment landed where it belongs: on the passage, in the section the
    // page drew after load.
    // The condition is the TEXT under the tint, not the id in the registry. A
    // registry entry whose range died with the nodes it was painted on is
    // exactly the stale answer this poll must not accept.
    await pollPage(
      page,
      (said) => String(window.__lahe.handle.comments.highlights.rangeFor(said.id) || "") === said.passage,
      { id: id, passage: PASSAGE },
      { message: "the passage to be tinted again on the rendered section" }
    );
  });

  test("a deleted passage gets a matching-failed card that clears when it reappears", async ({ page }) => {
    const config = { review: REVIEW + "-gone", token: TOKEN, helper: "http://127.0.0.1:1" };
    // The passage is drawn on the first load and not on the second, which is an
    // agent deleting it between rebuilds.
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
    await rendered(page);
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
    await rendered(page);
    await afterTheWindowCloses(page);

    const state = await lostState(page, id);
    expect(state.badged, "a failed match is still told to the reviewer").toBe(true);
    expect(state.stamped, "and it is on the record, which is what the agent reads").toBe(true);
    expect(state.badgeCode).toBe("ANCHOR_NO_TEXT_MATCH");
    expect(state.stampCode).toBe("ANCHOR_NO_TEXT_MATCH");
    expect(state.badgeMessage).toContain("could not be safely matched");
    expect(state.badgeMessage).not.toMatch(/gone|does not exist|not on this page/i);
    expect(
      await page.evaluate(() => !!document.querySelector("#passage")),
      "the passage really is off the page, which is what makes this a real loss"
    ).toBe(false);

    // It stays while matching still fails.
    await page.evaluate(() => window.__lahe.replayNow());
    const later = await lostState(page, id);
    expect(later.badged, "the matching warning is still there a pass later").toBe(true);
    expect(later.stamped).toBe(true);

    // Once the exact reviewed place is present again, replay reattaches it and
    // clears every form of anchor warning rather than leaving a stale badge.
    mode = "same";
    await page.reload();
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot after the passage reappears"
    });
    await rendered(page);
    await afterTheWindowCloses(page);

    const reattached = await lostState(page, id);
    expect(reattached.badged, "the matching warning clears after reattachment").toBe(false);
    expect(reattached.stamped, "the record's matching warning clears too").toBe(false);
  });
});
