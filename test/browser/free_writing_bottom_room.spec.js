// Free writing at the bottom of the page (phase 7, fix H2).
//
// Ken, on a real notes page: at the bottom of the page he could not scroll, the
// line Enter made went below the window, and the edit bar sat over it. So,
// while a writing session is open:
//   - the page can scroll far enough that the caret's line sits above the bar
//   - Enter, typing and pasting keep the caret's line in view
//   - the bar never covers the caret's line
// and when the session ends the room goes away without the page jumping.
//
// Each test is a real `lahe write` notes page from this checkout, with its own
// state folder and a free helper port (support/lahe_world.js).

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const { test, expect, pollPage } = require("../helpers");
const world_ = require("./support/lahe_world");
const fw = require("./support/free_writing_page");

const { makeWorld, closeWorld, booted, claim } = world_;

const DARK_CSS = "html, body { background: #16181d !important; color: #e6e6e6 !important; }";

async function shot(page, name) {
  const dir = process.env.LAHE_SHOTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const lane = test.info().project.name;
  await page.screenshot({ path: path.join(dir, name + (lane === "chromium" ? "" : "-" + lane) + ".png") });
}

async function frames(page) {
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

// The caret's line: the text rect at the caret, or the caret's block when the
// line is empty (a fresh paragraph holds only a <br>).
async function measure(page) {
  return page.evaluate(() => {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const range = sel.getRangeAt(0).cloneRange();
    let line = null;
    const rects = range.getClientRects();
    if (rects.length && rects[rects.length - 1].height) {
      const r = rects[rects.length - 1];
      line = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }
    if (!line) {
      let el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      while (el && getComputedStyle(el).display.indexOf("inline") === 0) el = el.parentElement;
      if (el && range.startContainer.nodeType === 1 && range.startContainer.childNodes[range.startOffset]) {
        const child = range.startContainer.childNodes[range.startOffset];
        if (child.nodeType === 1 && getComputedStyle(child).display.indexOf("inline") !== 0) el = child;
      }
      const r = el.getBoundingClientRect();
      line = { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    }
    const info = window.__lahe.handle.editing.barInfo();
    const bar = info ? { top: info.rect.y, bottom: info.rect.y + info.rect.height, left: info.rect.x, right: info.rect.x + info.rect.width } : null;
    const el = document.scrollingElement;
    return {
      line: line,
      bar: bar,
      viewport: innerHeight,
      scrollY: scrollY,
      scrollHeight: el.scrollHeight
    };
  });
}

function overlaps(a, b) {
  return a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left;
}

function expectLineClear(m, label) {
  expect(m, label + ": a caret").toBeTruthy();
  expect(m.bar, label + ": the bar is showing").toBeTruthy();
  expect(m.line.top, label + ": the caret's line is below the top of the window").toBeGreaterThanOrEqual(0);
  expect(m.line.bottom, label + ": the caret's line is inside the window").toBeLessThanOrEqual(m.viewport);
  expect(overlaps(m.line, m.bar), label + ": the bar does not cover the caret's line " + JSON.stringify(m)).toBe(false);
}

async function openNotes(page, scheme) {
  const world = await makeWorld({ file: "notes.md", command: "write", create: false });
  await page.setViewportSize({ width: 1000, height: 560 });
  await page.goto(world.open);
  await booted(page);
  if (scheme === "dark") {
    await page.evaluate((text) => {
      const el = document.createElement("style");
      el.textContent = text;
      document.head.appendChild(el);
    }, DARK_CSS);
    await page.evaluate(() => window.__lahe.rail.refreshScheme());
  }
  await claim(page);
  await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "the empty page to open ready to type" });
  return world;
}

async function writeParagraphs(page, count, from) {
  const seen = [];
  for (let i = 0; i < count; i += 1) {
    await page.keyboard.press("Enter");
    await frames(page);
    const afterEnter = await measure(page);
    expectLineClear(afterEnter, "after Enter " + (from + i));
    await page.keyboard.type("Paragraph " + (from + i) + " of the notes, long enough to read as a line.", { delay: 1 });
    await frames(page);
    const afterTyping = await measure(page);
    expectLineClear(afterTyping, "after typing " + (from + i));
    seen.push(afterEnter);
  }
  return seen;
}

test.describe("writing at the bottom of the page", () => {
  let world;

  test.afterEach(async () => {
    await closeWorld(world);
    world = null;
  });

  for (const scheme of ["light", "dark"]) {
    test("Enter past the bottom of the window keeps the caret's line in view and clear of the bar (" + scheme + ")", async ({
      page
    }) => {
      world = await openNotes(page, scheme);
      await page.keyboard.type("# Notes", { delay: 2 });
      const seen = await writeParagraphs(page, 18, 1);
      const first = seen[0];
      const last = seen[seen.length - 1];
      expect(last.scrollY, "the page scrolled as the notes grew").toBeGreaterThan(first.scrollY);
      // Room below the caret's line for the bar, and a little more.
      expect(last.viewport - last.line.bottom, "the caret's line sits well above the bottom of the window").toBeGreaterThanOrEqual(
        (last.bar.bottom - last.bar.top) + 8
      );
      await shot(page, "bottom-of-page-" + scheme);
    });
  }

  test("a paste at the bottom of the window keeps the caret's line in view", async ({ page }) => {
    world = await openNotes(page, "light");
    await page.keyboard.type("# Notes", { delay: 2 });
    await writeParagraphs(page, 10, 1);
    await page.keyboard.press("Enter");
    await fw.pasteText(page, "A pasted line.\n\nAnother pasted line.\n\nA third pasted line.\n\nA fourth pasted line.");
    await frames(page);
    expectLineClear(await measure(page), "after paste");
  });

  test("the room goes away when the session ends, and the page does not jump", async ({ page }) => {
    world = await openNotes(page, "light");
    await page.keyboard.type("# Notes", { delay: 2 });
    await writeParagraphs(page, 14, 1);
    const before = await page.evaluate(() => {
      const last = Array.from(document.querySelectorAll("p")).find((p) => p.textContent.indexOf("Paragraph 14 ") === 0);
      return { top: last.getBoundingClientRect().top, text: last.textContent };
    });
    await fw.commitByEsc(page);
    await frames(page);
    const after = await page.evaluate((text) => {
      const last = Array.from(document.querySelectorAll("p")).find((p) => p.textContent === text);
      return { top: last ? last.getBoundingClientRect().top : null };
    }, before.text);
    expect(after.top, "the last line did not move when the session ended").toBeCloseTo(before.top, 0);
    // Scrolling back to the top takes the rest of the room away.
    await page.evaluate(() => window.scrollTo(0, 0));
    await pollPage(
      page,
      () => {
        const s = getComputedStyle(document.documentElement, "::after");
        return s.content === "none" || s.content === "normal" || s.display === "none";
      },
      undefined,
      { message: "the room to go away after scrolling up" }
    );
  });
});
