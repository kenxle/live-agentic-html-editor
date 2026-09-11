// The selection pill while the reviewer is still dragging.
//
// Ken, highlighting a passage from the bottom line upward: the pill appeared as
// soon as the drag paused at a line boundary, right next to the cursor, and the
// cursor was still climbing through the text he wanted. He dragged over the word
// Comment, the selection jittered, the direction flipped, and the rest of the
// page below got selected instead. He could not finish the highlight.
//
// So this file drags with a real mouse, the slow way a hand does, and asserts
// the three rules that fix it:
//
//   1. No pill at all while a button is held. It arrives on release.
//   2. The pill is not selectable, so a drag that crosses it cannot turn into a
//      selection of the library's own chrome.
//   3. The pill lands on the side of the passage the cursor is NOT on: the top
//      of the selection after an upward drag, the bottom after a downward one.
//
// The drag has to PAUSE longer than the debounce between moves, because that
// pause is the bug: a hand stops at every line boundary. Waiting it out is a
// condition poll on the page's own clock, never a sleep, so the no-sleeps rule
// still holds.

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("../helpers");
const { startStaticServer } = require("../helpers/servers");
const { pollPage } = require("../helpers/poll");
const manifest = require("../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "css-reset.html";
const PARA_ID = "drag-para";

function layerBundle() {
  return manifest
    .builtFiles()
    .map(function (entry) {
      return "/* ---- " + entry.path + " ---- */\n" + fs.readFileSync(path.join(REPO_ROOT, entry.path), "utf8");
    })
    .join("\n");
}

const BUNDLE = layerBundle();

// A paragraph of the test's own making, narrow enough that the lines are known
// rather than guessed. It goes in BEFORE the library boots, so it is part of the
// page the reviewer opened rather than a change the layer has to account for.
async function addDragParagraph(page) {
  await page.evaluate(function (id) {
    var p = document.createElement("p");
    p.id = id;
    p.setAttribute("data-region", id);
    p.setAttribute("style", "width: 360px; margin: 24px 0; font: 16px/28px system-ui, sans-serif;");
    p.textContent =
      "The reviewer reads down the page and then decides the sentence above " +
      "was the one worth talking about, so the hand goes back up and drags " +
      "from the bottom of the passage toward the top of it, one line at a " +
      "time, pausing wherever a line ends.";
    document.body.appendChild(p);
  }, PARA_ID);
}

async function bootLayer(page, options = {}) {
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(
    function (opts) {
      var LAHE = window.LAHE;
      var pageRec = LAHE.record.pageFrom({
        origin: location.origin,
        pathname: location.pathname,
        href: location.href,
        title: document.title
      });
      var comments = LAHE.comments.createComments({ reviewId: opts.reviewId, page: pageRec });
      comments.bind();
      window.__lahe = { comments: comments, page: pageRec, reviewId: opts.reviewId };
    },
    { reviewId: options.reviewId || "rev_pill_drag" }
  );
}

function popoverState(page) {
  return page.evaluate(function () {
    return window.__lahe.comments.selectionPopover();
  });
}

function waitForPill(page) {
  return pollPage(page, () => window.__lahe.comments.selectionPopover().visible === true, undefined, {
    message: "the selection pill to appear once the drag finished"
  });
}

// One rectangle per rendered line of the paragraph, in viewport coordinates.
function lineRects(page) {
  return page.evaluate(function (id) {
    var el = document.getElementById(id);
    var range = document.createRange();
    range.selectNodeContents(el);
    return Array.prototype.map.call(range.getClientRects(), function (r) {
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
    });
  }, PARA_ID);
}

// A point well inside a line, so the drag lands on characters rather than on the
// paragraph's edge.
function pointIn(line, fromLeft) {
  return { x: line.left + fromLeft, y: line.top + line.height / 2 };
}

// The pause a hand makes at a line boundary. Not a sleep: it polls the page's
// own clock until the debounce window has provably elapsed, which is exactly the
// moment the old code put a pill under the moving cursor.
async function waitOutTheDebounce(page) {
  const delay = await page.evaluate(function () {
    return window.LAHE.comments.POPOVER_DELAY_MS;
  });
  await page.evaluate(function () {
    window.__dragMark = performance.now();
  });
  await pollPage(page, (ms) => performance.now() - window.__dragMark > ms, delay + 80, {
    message: "the pill's debounce window to elapse mid-drag"
  });
}

function selectionReport(page) {
  return page.evaluate(function (id) {
    var sel = window.getSelection();
    var text = sel ? String(sel) : "";
    var para = document.getElementById(id);
    var node = sel && sel.rangeCount ? sel.getRangeAt(0).commonAncestorContainer : null;
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    return {
      text: text,
      length: text.length,
      insideParagraph: !!(el && para.contains(el)),
      isSubstringOfParagraph: text.length > 0 && para.textContent.indexOf(text) !== -1,
      paragraphLength: para.textContent.length
    };
  }, PARA_ID);
}

test.describe("the selection pill during a drag", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ label: "pill-drag-fixtures" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test("dragging upward across three lines never shows the pill mid-drag, and the selection stays put", async ({
    page
  }) => {
    await page.goto(server.urlFor(FIXTURE));
    await addDragParagraph(page);
    await bootLayer(page);

    const lines = await lineRects(page);
    expect(lines.length, "the test paragraph wraps to at least three lines").toBeGreaterThanOrEqual(3);

    const third = pointIn(lines[2], 200);
    const second = pointIn(lines[1], 120);
    const first = pointIn(lines[0], 40);

    // Bottom to top, the way the hand that found this bug moved: press on the
    // third line, climb to the first, pausing past the debounce at every step.
    await page.mouse.move(third.x, third.y);
    await page.mouse.down();
    await waitOutTheDebounce(page);
    expect((await popoverState(page)).visible, "no pill on the press").toBe(false);

    await page.mouse.move(second.x, second.y, { steps: 8 });
    await waitOutTheDebounce(page);
    expect((await popoverState(page)).visible, "no pill at the second line").toBe(false);

    await page.mouse.move(first.x, first.y, { steps: 8 });
    await waitOutTheDebounce(page);
    expect((await popoverState(page)).visible, "no pill at the first line").toBe(false);

    // Still dragging, and the selection is still the reviewer's passage. This is
    // the runaway: with a selectable pill in the path, the anchor flips here and
    // everything below on the page gets selected instead.
    const during = await selectionReport(page);
    expect(during.insideParagraph, "the selection has not escaped the paragraph").toBe(true);

    await page.mouse.up();
    await waitForPill(page);

    const after = await selectionReport(page);
    expect(after.insideParagraph, "the selection is still the reviewer's passage").toBe(true);
    expect(after.isSubstringOfParagraph, "and is text from that paragraph only").toBe(true);
    expect(after.length, "it really did cross the lines").toBeGreaterThan(40);
    expect(after.length, "and it stopped where the reviewer stopped").toBeLessThan(after.paragraphLength);

    // Placed at the TOP of the selection, where the cursor finished, not at the
    // bottom the cursor just climbed away from.
    const state = await popoverState(page);
    const fresh = await lineRects(page);
    expect(state.placement).toBe("above");
    const pillBottom = state.rect.y + state.rect.height;
    expect(pillBottom, "the pill clears the first line of the selection").toBeLessThanOrEqual(
      fresh[0].top + 1
    );
    expect(fresh[0].top - pillBottom, "and sits right next to it").toBeLessThan(24);
  });

  test("dragging downward keeps the pill away until the release, then puts it at the end", async ({
    page
  }) => {
    await page.goto(server.urlFor(FIXTURE));
    await addDragParagraph(page);
    await bootLayer(page);

    const lines = await lineRects(page);
    const first = pointIn(lines[0], 40);
    const second = pointIn(lines[1], 120);
    const third = pointIn(lines[2], 200);

    await page.mouse.move(first.x, first.y);
    await page.mouse.down();
    await waitOutTheDebounce(page);
    await page.mouse.move(second.x, second.y, { steps: 8 });
    await waitOutTheDebounce(page);
    expect((await popoverState(page)).visible, "no pill at the second line").toBe(false);
    await page.mouse.move(third.x, third.y, { steps: 8 });
    await waitOutTheDebounce(page);
    expect((await popoverState(page)).visible, "no pill at the third line").toBe(false);

    await page.mouse.up();
    await waitForPill(page);

    const state = await popoverState(page);
    const end = await page.evaluate(function () {
      var rects = window.getSelection().getRangeAt(0).getClientRects();
      var r = rects[rects.length - 1];
      return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
    });
    const centre = state.rect.x + state.rect.width / 2;
    expect(Math.abs(centre - end.right), "the pill sits by the END of a downward drag").toBeLessThan(
      state.rect.width
    );
  });

  test("a selection made with no pointer held still gets the pill", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await addDragParagraph(page);
    await bootLayer(page);

    // Shift+ArrowDown by line, which is what the browser does with the key, run
    // through Selection.modify. A synthesized Shift+ArrowDown does not move a
    // caret in non-editable text in headless Chromium (that needs caret
    // browsing), so the key itself would test the harness rather than the rule:
    // no button held, so the pill still arrives after the debounce.
    await page.evaluate(function (id) {
      var el = document.getElementById(id);
      var range = document.createRange();
      range.setStart(el.firstChild, 0);
      range.collapse(true);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      sel.modify("extend", "forward", "line");
      sel.modify("extend", "forward", "line");
    }, PARA_ID);

    await waitForPill(page);
    const report = await selectionReport(page);
    expect(report.insideParagraph, "the keys selected inside the paragraph").toBe(true);
    expect(report.length).toBeGreaterThan(0);
  });

  test("the pill is not selectable, so a drag cannot turn into a selection of it", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await addDragParagraph(page);
    await bootLayer(page);

    await page.evaluate(function (id) {
      var el = document.getElementById(id);
      var range = document.createRange();
      range.setStart(el.firstChild, 5);
      range.setEnd(el.firstChild, 60);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }, PARA_ID);
    await waitForPill(page);

    // The pill lives in a closed root, so the library reads its own computed
    // style back out: the specs cannot query it and neither can the page.
    const styles = await page.evaluate(function () {
      return window.__lahe.comments.selectionPopoverStyles();
    });
    expect(styles.userSelect, "the pill itself").toBe("none");
    styles.buttons.forEach(function (value, index) {
      expect(value, "pill button " + index).toBe("none");
    });
  });
});
