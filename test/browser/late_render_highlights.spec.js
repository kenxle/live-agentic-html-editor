// A page that arrives as one blob and becomes blocks a moment later, and the
// highlight that used to cover the whole thing while that was true.
//
// Ken, 2026-08-23: "sometimes the page will refresh and everything is
// highlighted. it usually goes away after a bit, but still, it shouldn't
// happen."
//
// Both halves of that sentence were the same bug. A repaint resolved the
// record's reference and painted the WHOLE resolved element, and the anchor
// engine is allowed to bind to an element that merely CONTAINS the region's
// text (which R16 needs: an agent that rewraps a paragraph must not cost the
// reviewer their comment). On a page that has not finished drawing itself the
// commented block does not exist yet, so the innermost element holding its
// words is a container holding the entire document. Every record bound there,
// every character on the page got washed, and the settle-window repaint two
// seconds later found the real blocks and cleared it. That two seconds is the
// "goes away after a bit".
//
// WHY THIS SPEC WATCHES THE WHOLE LOAD. An assertion about the end state would
// have passed against the broken code, because the end state was always right.
// The bug only exists between boot and the settle window, so the paint is
// sampled on every animation frame from before the first script runs, and every
// sample has to hold.
//
// The second thing it pins: a comment made on three words of a paragraph comes
// back as three words. The repaint used to widen it to the whole block on every
// reload, which is the same "paint the resolved element" habit, just quieter.

"use strict";

const { test, expect, pollPage, startStaticServer } = require("../helpers");
const { withLayer, scriptTagFor } = require("./support/with_layer");

const REVIEW = "late-render";
const TOKEN = "late-render-token";
const DOC_PATH = "/late-render-doc.html";

const HEADING = "Coming back from a layoff";
const PASSAGE = "The third week is where a comeback stops being about willpower.";
const TAIL = "Everything else on this page is written to be read once and acted on.";
// The three words the reviewer actually selects, inside the passage.
const QUOTE = "stops being about willpower";
const SAID = "Name the week, not the feeling.";

/**
 * The document, as the server sends it on every load: one container holding
 * every word the page will ever show, and no blocks. late-blocks.js turns it
 * into blocks a few hundred milliseconds later.
 */
function docHtml(config) {
  const blob = [HEADING, PASSAGE, TAIL].join(" ");
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" />' +
    "<title>Late render</title></head>\n<body>\n<main>\n" +
    '<div id="source">' +
    blob +
    "</div>\n" +
    "</main>\n" +
    '<script src="/late-blocks.js" data-draw-ms="600" data-heading="' +
    HEADING +
    '" data-passage="' +
    PASSAGE +
    '" data-tail="' +
    TAIL +
    '"></script>\n' +
    scriptTagFor(config) +
    "\n</body>\n</html>\n"
  );
}

/**
 * The sampler. It is installed before any script on the page runs, and from the
 * first animation frame it records what is painted and whether the page had
 * become blocks yet.
 *
 * Not a wait and not a sleep: nothing in the spec ever blocks on it. It is a
 * recorder, and the assertions read what it recorded.
 */
async function samplePaintThroughout(page) {
  await page.addInitScript(function () {
    window.__paintSamples = [];
    var frame = function () {
      try {
        var handle = window.__lahe && window.__lahe.handle;
        var highlights = handle && handle.comments && handle.comments.highlights;
        if (highlights) {
          highlights.paintedIds().forEach(function (id) {
            var range = highlights.rangeFor(id);
            var text = range ? String(range) : "";
            if (!text) return;
            window.__paintSamples.push({
              id: id,
              text: text,
              blocksDrawn: !!document.getElementById("built")
            });
          });
        }
      } catch (err) {
        window.__paintSamples.push({ id: null, text: "SAMPLER FAILED: " + String(err), blocksDrawn: false });
      }
      window.requestAnimationFrame(frame);
    };
    window.requestAnimationFrame(frame);
  });
}

/** The reviewer selects three words inside the passage and comments on them. */
async function commentOnWords(page, selector, words, note) {
  await page.evaluate(function (input) {
    const el = document.querySelector(input.selector);
    if (!el) throw new Error("nothing matched " + input.selector);
    const node = el.firstChild;
    if (!node || node.nodeType !== 3) throw new Error(input.selector + " does not hold one text node");
    const at = node.nodeValue.indexOf(input.words);
    if (at === -1) throw new Error("the words are not in " + input.selector);
    const range = document.createRange();
    range.setStart(node, at);
    range.setEnd(node, at + input.words.length);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, { selector: selector, words: words });
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the selected words"
  });
  await page.keyboard.type(note);
  await page.keyboard.press("ControlOrMeta+Enter");
  await pollPage(
    page,
    (said) => window.__lahe.items().some((item) => item.note === said && item.state === "ready"),
    note,
    { message: "the comment to be ready" }
  );
}

/** The page has become blocks: the renderer's one beat is done. */
async function blocksDrawn(page) {
  await pollPage(page, () => !!document.getElementById("built") && !document.getElementById("source"), undefined, {
    message: "the fixture renderer to turn the blob into blocks"
  });
}

/** The settling window is over and a pass has run since it closed. */
async function afterTheWindowCloses(page) {
  await pollPage(page, () => window.LAHE.replay.isSettling() === false, undefined, {
    message: "replay's settling window to close"
  });
  await page.evaluate(() => window.__lahe.replayNow());
}

test.describe("a page that becomes blocks after load is never washed end to end", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ label: "late-render" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("no highlight ever covers more than the words it was made on, at any point in the load", async ({
    page
  }) => {
    const config = { review: REVIEW, token: TOKEN, helper: "http://127.0.0.1:1" };
    await samplePaintThroughout(page);
    await withLayer(page, config);
    await page.route("**" + DOC_PATH, function (route) {
      return route.fulfill({
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        body: docHtml(config)
      });
    });

    await page.goto(pages.origin + DOC_PATH);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its script tag"
    });
    // Comment on the RENDERED page, the way a reviewer does: the blocks are
    // there, three words of one of them are selected. The reload is what is
    // under test.
    await blocksDrawn(page);
    await commentOnWords(page, "#passage", QUOTE, SAID);

    const id = await page.evaluate((said) => {
      const found = window.__lahe.items().filter((item) => item.note === said)[0];
      return found ? found.id : null;
    }, SAID);
    expect(id, "the comment exists").toBeTruthy();

    // The reload. This is what a rebuild does to the reviewer's page now (R36),
    // which is why Ken saw this at all.
    await page.reload();
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot again after the reload"
    });
    await blocksDrawn(page);
    await afterTheWindowCloses(page);
    // One more frame after the last thing that could paint, so the sampler has
    // seen the settled page too.
    await pollPage(
      page,
      () => window.__paintSamples.some((sample) => sample.blocksDrawn),
      undefined,
      { message: "the sampler to see the page after it became blocks" }
    );

    const samples = await page.evaluate(() => window.__paintSamples);
    expect(samples.length, "the sampler recorded nothing, so it is broken, not passing").toBeGreaterThan(0);

    // It really did watch the window the bug lived in: the page was still one
    // blob, and the layer had already painted.
    const beforeBlocks = samples.filter((sample) => !sample.blocksDrawn);
    expect(
      beforeBlocks.length,
      "nothing was sampled while the page was still one blob, so this proves nothing"
    ).toBeGreaterThan(0);

    // The whole assertion, and it holds for every frame rather than for the end
    // state. A sample carrying the heading or the tail is the reported bug.
    const wrong = samples.filter((sample) => sample.text !== QUOTE);
    expect(
      wrong.slice(0, 3),
      "every paint, at every moment of the load, covers the words the comment was made on and nothing else"
    ).toEqual([]);

    // And the mark is really there at the end, on the passage, not merely absent
    // all the way through: a fix that painted nothing would pass everything above.
    const settled = await page.evaluate((itemId) => {
      const highlights = window.__lahe.handle.comments.highlights;
      const range = highlights.rangeFor(itemId);
      const inPassage = range
        ? !!(document.getElementById("passage") &&
            document.getElementById("passage").contains(
              range.commonAncestorContainer.nodeType === 1
                ? range.commonAncestorContainer
                : range.commonAncestorContainer.parentNode
            ))
        : false;
      return {
        painted: highlights.paintedIds().indexOf(itemId) !== -1,
        text: range ? String(range) : null,
        inPassage: inPassage
      };
    }, id);
    expect(settled.painted, "the reviewer's mark came back with the page").toBe(true);
    expect(settled.text, "and it is the three words they selected, not the paragraph").toBe(QUOTE);
    expect(settled.inPassage, "painted on the block the renderer built, which is where the words are").toBe(true);
  });
});
