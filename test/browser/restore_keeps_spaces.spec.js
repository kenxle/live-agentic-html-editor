// A repaint of the block the reviewer is typing in keeps the space they just typed.
//
// Found on CI on 2026-10-01 as keep_mine_live_page line 180, on a Linux runner
// under load. The reviewer's sentence was committed with a word glued to the
// one before it ("Texthim before lunch") or with the caret one character off
// ("Text him before lunchD.evon"), and the record the spec waited for never
// existed.
//
// The mechanism, read off the page's own events: the reviewer types a space at
// the end of the block, a raw repaint destroys the block before the next key,
// and protection's layer three rebuilds it from its snapshot. The snapshot held
// the space. The rebuild ran the snapshot's markup through normalize.cleanMarkup,
// which trims and folds whitespace, so the block came back without it, and the
// next word ran into the last one. A leading space went the same way, and then
// the caret offset the snapshot recorded landed one character to the right.
//
// So this spec makes that repaint happen on purpose, between two keys, on a page
// whose timer is off: no timing, one morph, one answer.

"use strict";

const { test: base, expect, pollPage, placeCaret } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");
const { withLayer } = require("./support/with_layer");

const ORIGINAL = "Devon has missed two easy runs in a row and has not said why.";
const REGION = "#coach-note";

function feedHtml() {
  return (
    '<article id="feed-coach-note" class="feed-item"><h3>Coach note</h3>' +
    '<p id="coach-note">' +
    ORIGINAL +
    "</p></article>"
  );
}

const test = base.extend({
  appServer: async function ({}, use) {
    const server = await startAppServer();
    await use(server);
    await server.close();
  }
});

async function openOnCoachNote(page, appServer) {
  await withLayer(page, { review: "restore-keeps-spaces", token: "restore-keeps-spaces-token", helper: "http://127.0.0.1:1" });
  await page.route("**/api/feed", (route) =>
    route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      body: feedHtml()
    })
  );
  await page.goto(appServer.urlFor("/?morph=raw&poll=250"));
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot"
  });
  await pollPage(page, (sel) => !!document.querySelector(sel), REGION, {
    message: "the frozen feed to land"
  });
  // The timer goes off, and anything it already sent lands, so the only morph
  // after this point is the one the test fires.
  await page.evaluate(() => window.__app.morph.stop());
  await pollPage(page, () => window.__app.counters.feedPolls === window.__app.counters.morphPasses, undefined, {
    message: "the timer's last poll to land"
  });
  await placeCaret(page, { selector: REGION, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.handle.editing.state().open, undefined, {
    message: "Cmd-Shift-E to open the coach note"
  });
}

/** One raw morph, and the block's text and caret once protection has answered it. */
async function morphNow(page) {
  return page.evaluate(async (sel) => {
    const restoresBefore = window.__lahe.counters.restores;
    await window.__app.morph.pollNow();
    const el = document.querySelector(sel);
    const s = window.getSelection();
    const r = document.createRange();
    r.setStart(el, 0);
    r.setEnd(s.anchorNode, s.anchorOffset);
    // An edge space typed in a contenteditable block is a no-break space in
    // the DOM; it is still the space the reviewer typed.
    return { text: el.textContent.replace(/\u00a0/g, " "), caret: r.toString().length, restored: window.__lahe.counters.restores - restoresBefore };
  }, REGION);
}

test.describe("protection's restore keeps the reviewer's spaces", () => {
  test("a space typed at the end of the block survives a raw repaint, and the next word follows it", async ({
    page,
    appServer
  }) => {
    await openOnCoachNote(page, appServer);
    await placeCaret(page, { selector: REGION, offset: ORIGINAL.length });
    await page.keyboard.type(" Text ");

    const after = await morphNow(page);
    expect(after.restored, "the repaint destroyed the block and layer three rebuilt it").toBeGreaterThan(0);
    expect(after.text, "the trailing space came back with the block").toBe(ORIGINAL + " Text ");
    expect(after.caret, "and the caret is after it").toBe((ORIGINAL + " Text ").length);

    await page.keyboard.type("him");
    expect(await page.evaluate((sel) => document.querySelector(sel).textContent.replace(/\u00a0/g, " "), REGION)).toBe(
      ORIGINAL + " Text him"
    );
  });

  test("a space typed at the front survives a raw repaint, and the caret stays where it was", async ({
    page,
    appServer
  }) => {
    await openOnCoachNote(page, appServer);
    await placeCaret(page, { selector: REGION, offset: 0 });
    await page.keyboard.type("Note: ");
    // Back to the very front, then one space: the block now starts with it.
    await placeCaret(page, { selector: REGION, offset: 0 });
    await page.keyboard.type(" ");

    const after = await morphNow(page);
    expect(after.restored, "the repaint destroyed the block and layer three rebuilt it").toBeGreaterThan(0);
    expect(after.text, "the leading space came back with the block").toBe(" Note: " + ORIGINAL);
    expect(after.caret, "and the caret did not move").toBe(1);
  });
});
