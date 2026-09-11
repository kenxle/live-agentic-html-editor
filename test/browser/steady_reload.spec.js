// The reload sits still: no jump, no jitter.
//
// R36's auto-reload replaces the document under a reviewer who did not ask for
// it, and until this the page came back at the same PIXEL offset. A rebuild
// that added content above the viewport put that offset on a different
// sentence, and late-drawn content moved the layout again after the restore had
// already run. Both read as the page jumping, which is what Ken reported.
//
// Four claims, none of which a unit test can see:
//
//   1. Content added ABOVE the viewport does not move the block the reviewer
//      was reading. It comes back at the same offset from the top of the
//      screen, within a few pixels.
//   2. When the block's text is no longer unique, the pixel offset is still
//      the answer. An ambiguous match is not a match (the anchor ladder's
//      honesty rule), and falling back is not a failure.
//   3. The page is never left hidden. It goes to opacity 0 for the correction
//      and it comes back, inside the constant plus a margin.
//   4. The reviewer always wins. A scroll during the settling window ends the
//      corrections on the spot and the page stays where they put it.
//
// A live helper is required (the reload trigger is the reviewed file's mtime),
// so this serves a real file from a real directory, like auto_reload.spec.js.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, pollUntil, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");
const syncModule = require("../../src/layer/sync.js");

const REVIEW = "steady-reload";
const PAGE_FILE = "page.html";

// The block the reviewer is reading. Its text is what the marker carries, so it
// has to be unique on the page and it has to survive the rebuild unchanged.
const ANCHOR_TEXT = "The third week is where a comeback either holds or comes apart.";

// How far below the top of the screen the anchor sits before the rebuild.
const ANCHOR_OFFSET = 12;

/** One paragraph per line, each with text nothing else on the page has. */
function paragraph(prefix, n) {
  return '<p class="line">' + prefix + " line " + n + ": pacing notes for a runner coming back.</p>";
}

/**
 * The reviewed page.
 *
 * @param {number} above  paragraphs before the anchor; a rebuild adds more
 * @param {boolean} duplicate  repeat the anchor's text, so it matches twice
 */
function docHtml(helperOrigin, token, edition, above, duplicate) {
  const attrs = protocol.SCRIPT_ATTR;
  const lines = [];
  for (let i = 0; i < above; i += 1) lines.push(paragraph("Before", i));
  lines.push('<p id="anchor" class="line">' + ANCHOR_TEXT + "</p>");
  if (duplicate) lines.push('<p id="twin" class="line">' + ANCHOR_TEXT + "</p>");
  for (let i = 0; i < 60; i += 1) lines.push(paragraph("After", i));
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Steady Pace</title>\n' +
    "<style>body{margin:0;font:16px/1.4 system-ui} .line{margin:0 0 60px;padding:0}</style>\n</head>\n" +
    '<body>\n<main>\n<h1 id="edition">' +
    edition +
    "</h1>\n" +
    lines.join("\n") +
    "\n</main>\n" +
    '<script src="' +
    helperOrigin +
    '/lahe-layer.js" ' +
    attrs.REVIEW +
    '="' +
    REVIEW +
    '" ' +
    attrs.TOKEN +
    '="' +
    token +
    '" ' +
    attrs.HELPER +
    '="' +
    helperOrigin +
    '"></script>\n</body>\n</html>\n'
  );
}

function rebuild(filePath, helperOrigin, token, edition, above, duplicate) {
  fs.writeFileSync(filePath, docHtml(helperOrigin, token, edition, above, duplicate));
  // A coarse filesystem clock can give two quick writes the same mtime, and the
  // mtime is the signal. Stamping it forward makes the change unambiguous.
  const later = new Date(Date.now() + 10000);
  fs.utimesSync(filePath, later, later);
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

async function baselineMtime(page) {
  await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
    message: "the first poll to establish the baseline mtime"
  });
}

/** Put the anchor paragraph ANCHOR_OFFSET pixels below the top of the screen. */
async function parkOnTheAnchor(page) {
  return page.evaluate((offset) => {
    const el = document.querySelector("#anchor");
    window.scrollTo(0, Math.round(el.getBoundingClientRect().top + window.scrollY - offset));
    return { y: window.scrollY, top: document.querySelector("#anchor").getBoundingClientRect().top };
  }, ANCHOR_OFFSET);
}

/**
 * Every style the library puts on the root element, from before the page's own
 * scripts run.
 *
 * The observer is on `document` rather than on documentElement because an init
 * script runs before there IS a documentElement. The old value is what proves
 * the page was hidden: the hold can be gone inside one frame, so sampling would
 * miss it and the mutation record would not.
 */
const WATCH_THE_ROOT = () => {
  window.__laheStyles = [];
  const seen = new window.MutationObserver((records) => {
    records.forEach((entry) => {
      if (entry.target !== document.documentElement || entry.attributeName !== "style") return;
      window.__laheStyles.push({ was: entry.oldValue, now: document.documentElement.getAttribute("style") });
    });
  });
  seen.observe(document, { attributes: true, attributeFilter: ["style"], attributeOldValue: true, subtree: true });
};

test.describe("a LAHE reload lands where the reviewer was looking", () => {
  let dir;
  let filePath;
  let pages;
  let service;
  let token;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-steady-reload-"));
    filePath = path.join(dir, PAGE_FILE);
    pages = await startStaticServer({ root: dir, label: "steady-reload" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    token = service.tokenFor(REVIEW);

    const written = await fetch(service.url + protocol.route("review.write").path, {
      method: "POST",
      headers: {
        "Content-Type": protocol.JSON_CONTENT_TYPE,
        "x-lahe-client": protocol.CLIENT_CLI,
        "x-lahe-token": token,
        Origin: pages.origin
      },
      body: JSON.stringify({ review: REVIEW, origins: [pages.origin], target_path: filePath })
    });
    expect(written.status, "the helper recorded the reviewed file's path").toBe(200);
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("content added above the viewport does not move the block being read", async ({ page }) => {
    await page.addInitScript(WATCH_THE_ROOT);
    rebuild(filePath, service.url, token, "First edition", 20, false);
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await baselineMtime(page);

    const before = await parkOnTheAnchor(page);
    expect(Math.abs(before.top - ANCHOR_OFFSET), "the anchor starts where the test put it").toBeLessThanOrEqual(1);

    // The agent lands forty lines above where the reviewer is reading.
    rebuild(filePath, service.url, token, "Second edition", 60, false);
    await pollPage(page, () => document.querySelector("#edition").textContent === "Second edition", undefined, {
      message: "the page to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await booted(page);

    // The corrections run across replay's settling window and end with it.
    await pollPage(page, () => !!(window.LAHE.sync.lastSteady() || {}).state, undefined, {
      message: "the steady controller the restore built"
    });
    await pollPage(page, () => window.LAHE.sync.lastSteady().state().stopped === true, undefined, {
      message: "the settling window to close",
      timeoutMs: 20000
    });

    const after = await page.evaluate(() => ({
      top: document.querySelector("#anchor").getBoundingClientRect().top,
      y: window.scrollY,
      opacity: document.documentElement.style.opacity,
      byBlock: window.LAHE.sync.lastReloadRestore().byBlock
    }));
    expect(
      Math.abs(after.top - ANCHOR_OFFSET),
      "the block the reviewer was reading came back at the same offset"
    ).toBeLessThanOrEqual(3);
    // Forty paragraphs went in above it, so a pixel-only restore could not have
    // landed here: this is the content anchor doing the work.
    expect(after.y, "the page scrolled further down to keep the block still").toBeGreaterThan(before.y);
    expect(after.byBlock, "the restore used the content anchor, not the pixels").toBe(true);
  });

  test("the page is hidden for the correction and always comes back", async ({ page }) => {
    await page.addInitScript(WATCH_THE_ROOT);
    rebuild(filePath, service.url, token, "Hidden first", 20, false);
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await baselineMtime(page);
    await parkOnTheAnchor(page);

    rebuild(filePath, service.url, token, "Hidden second", 60, false);
    await pollPage(page, () => document.querySelector("#edition").textContent === "Hidden second", undefined, {
      message: "the page to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await booted(page);

    // Inside the hold plus the fade plus a generous margin, and never longer.
    await pollPage(
      page,
      () =>
        window.__laheStyles.some(
          (entry) => String(entry.was || "").indexOf("opacity:0") !== -1 || String(entry.now || "").indexOf("opacity:0") !== -1
        ),
      undefined,
      {
        message: "the page to be held invisible while the correction ran",
        timeoutMs: syncModule.STEADY_HIDE_MS + syncModule.STEADY_FADE_MS + 4000
      }
    );

    // And the inline style goes away entirely: the page is left exactly as its
    // own stylesheet drew it.
    await pollPage(page, () => document.documentElement.getAttribute("style") === null, undefined, {
      message: "the temporary inline style to be removed",
      timeoutMs: 20000
    });
  });

  test("a text that now matches twice falls back to the pixel offset", async ({ page }) => {
    rebuild(filePath, service.url, token, "Twin first", 20, false);
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await baselineMtime(page);
    const before = await parkOnTheAnchor(page);

    // The rebuild repeats the anchor's sentence lower down and adds nothing
    // above it, so the text matches twice and the pixels are still correct.
    rebuild(filePath, service.url, token, "Twin second", 20, true);
    await pollPage(page, () => document.querySelector("#edition").textContent === "Twin second", undefined, {
      message: "the page to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await booted(page);

    const landed = await page.evaluate(() => ({
      y: window.scrollY,
      steady: window.LAHE.sync.lastSteady() === null,
      restore: window.LAHE.sync.lastReloadRestore()
    }));
    expect(landed.y, "the pixel offset was the fallback and it was honoured").toBe(before.y);
    expect(landed.restore.byBlock, "the ambiguous text was refused rather than guessed at").toBe(false);
    expect(landed.steady, "no correction loop is armed when there is no block to hold").toBe(true);
  });

  test("a reviewer's scroll during the settling window ends the corrections", async ({ page }) => {
    rebuild(filePath, service.url, token, "Scroll first", 20, false);
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await baselineMtime(page);
    await parkOnTheAnchor(page);

    rebuild(filePath, service.url, token, "Scroll second", 60, false);
    await pollPage(page, () => document.querySelector("#edition").textContent === "Scroll second", undefined, {
      message: "the page to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await booted(page);
    await pollPage(page, () => !!(window.LAHE.sync.lastSteady() || {}).state, undefined, {
      message: "the steady controller the restore built"
    });

    // The reviewer takes the page back.
    const mine = await page.evaluate(() => {
      window.scrollTo(0, 40);
      return window.scrollY;
    });
    await pollPage(page, () => window.LAHE.sync.lastSteady().state().stopped === true, undefined, {
      message: "the corrections to stop the moment the reviewer scrolled"
    });

    // Two reply polls is the settling window and more, measured on a counter
    // the library already keeps rather than on a clock.
    const polls = await page.evaluate(() => window.__lahe.handle.sync.status().counters.polls);
    await pollUntil(
      async () => (await page.evaluate(() => window.__lahe.handle.sync.status().counters.polls)) >= polls + 3,
      { timeoutMs: 20000, message: "the settling window to pass with the reviewer in charge" }
    );
    expect(await page.evaluate(() => window.scrollY), "nothing scrolled them back").toBe(mine);
  });
});
