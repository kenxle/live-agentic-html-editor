// What the agent changed, lit up for a moment.
//
// The reviewer asks for something, the agent edits the source, the page
// rebuilds, and LAHE reloads it under them. Until this they were looking at a
// page that was different in a way they could not see, and finding the change
// was their job.
//
// Four claims, and the last two are the ones that keep the mark honest:
//
//   1. A paragraph the agent rewrote and a paragraph the agent added both wear
//      the changed mark after the reload.
//   2. A paragraph nobody touched does not.
//   3. The reviewer's OWN outstanding edit, which replay re-applies on the way
//      in, does not. It was on the page before the reload too, so it is not
//      news, and a tool that reported it as news would be reporting the
//      reviewer's own work back to them.
//   4. The mark fades and is gone. It is an attention mark, never a state.
//
// And the one this feature got wrong first time round, reported by Ken on a
// reveal.js deck: a countdown timer and a slide number rewrite themselves every
// second, and both lit up as though the agent had written them. A page that
// changes itself is never the agent, so the page is read twice before it goes
// away and anything that moved between those two readings is left out.
//
// A live helper is required (the reload trigger is the reviewed file's mtime),
// so this serves a real file from a real directory, like auto_reload.spec.js.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, pollUntil, placeCaret, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");
const highlightModule = require("../../src/layer/highlight.js");
const replayModule = require("../../src/layer/replay.js");

const REVIEW = "change-highlight";
const PAGE_FILE = "page.html";

const UNTOUCHED = "Nothing about this paragraph changes across the rebuild.";
const ORIGINAL = "Runners come back too fast after a layoff.";
const REWRITTEN = "Runners come back too fast, and the third week is where it shows.";
const ADDED = "A new paragraph the agent wrote in answer to the comment.";
const MINE_BEFORE = "The reviewer will rewrite this sentence themselves.";
// The page's own moving parts, inlined from a fixture asset because a test file
// may not hold a timer.
const TICKER = fs.readFileSync(path.join(__dirname, "..", "fixtures", "assets", "ticking-counter.js"), "utf8");
const MOVING_PARTS = [
  '<p id="clock">0:00</p>',
  '<p id="pagenum">1 / 40</p>',
  '<p id="status">Recalculating the pace band for this week right now.</p>'
].join("\n");
const MINE_APPENDED = " And they added this themselves.";
const MINE_AFTER = MINE_BEFORE + MINE_APPENDED;

function docHtml(helperOrigin, token, edition, body) {
  const attrs = protocol.SCRIPT_ATTR;
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Steady Pace</title></head>\n' +
    '<body>\n<main>\n<h1 id="edition">' +
    edition +
    "</h1>\n" +
    // The moving parts come FIRST, so a rebuild that adds a paragraph does not
    // shift their position. That is the shape a deck has (a timer and a slide
    // number in a corner, the content below), and it is the shape the exclusion
    // is exact for: a self-changing block that a rebuild pushes DOWN the page
    // keeps only the counter guard, since both its position and its text have
    // moved on.
    MOVING_PARTS +
    "\n" +
    body +
    "\n</main>\n" +
    "<script>\n" +
    TICKER +
    "\n</script>\n" +
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

function firstEdition(helperOrigin, token) {
  return docHtml(
    helperOrigin,
    token,
    "First edition",
    ['<p id="untouched">' + UNTOUCHED + "</p>", '<p id="reworded">' + ORIGINAL + "</p>", '<p id="mine">' + MINE_BEFORE + "</p>"].join(
      "\n"
    )
  );
}

/** The agent's rebuild: one paragraph reworded, one paragraph added. */
function secondEdition(helperOrigin, token) {
  return docHtml(
    helperOrigin,
    token,
    "Second edition",
    [
      '<p id="untouched">' + UNTOUCHED + "</p>",
      '<p id="reworded">' + REWRITTEN + "</p>",
      '<p id="added">' + ADDED + "</p>",
      '<p id="mine">' + MINE_BEFORE + "</p>"
    ].join("\n")
  );
}

function write(filePath, html) {
  fs.writeFileSync(filePath, html);
  // A coarse filesystem clock can give two quick writes the same mtime, and the
  // mtime is the signal.
  const later = new Date(Date.now() + 10000);
  fs.utimesSync(filePath, later, later);
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

/**
 * Which of the page's paragraphs are wearing a changed mark, by id.
 *
 * Read from the browser's own highlight registry rather than from the library,
 * so this is what the reviewer's screen actually shows.
 */
function markedIds(page, names) {
  return page.evaluate((changedNames) => {
    const ids = [];
    if (typeof CSS === "undefined" || !CSS.highlights) return ids;
    document.querySelectorAll("p[id]").forEach((el) => {
      CSS.highlights.forEach((highlight, name) => {
        if (changedNames.indexOf(name) === -1) return;
        highlight.forEach((range) => {
          const node = range.commonAncestorContainer;
          if ((el === node || el.contains(node)) && ids.indexOf(el.id) === -1) ids.push(el.id);
        });
      });
    });
    return ids.sort();
  }, names);
}

/**
 * Wait until the page has been read TWICE: once at boot, once when the settling
 * window closed. That second reading is what tells the page's own moving parts
 * from the agent's edits, so a rebuild that beats it has only the boot reading
 * to go on and the counter guard to fall back to.
 */
async function readTwice(page) {
  await pollPage(page, () => window.LAHE.sync.stableBlocks() !== null, undefined, {
    message: "the page to be read once at boot"
  });
  const firstReading = await page.evaluate(() => window.LAHE.sync.stableBlocks().join("|"));
  await pollPage(
    page,
    (was) => {
      const now = window.LAHE.sync.stableBlocks();
      return !!now && now.join("|") !== was;
    },
    firstReading,
    { message: "the settled reading to catch the page moving on its own", timeoutMs: replayModule.SETTLE_MS + 10000 }
  );
}

/** The reviewer's gesture: open the block, type into it, commit. */
async function rewriteMine(page) {
  await placeCaret(page, { selector: "#mine", offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.handle.editing.isEditing() === true, undefined, {
    message: "edit state to open on the reviewer's own paragraph"
  });
  const length = await page.evaluate(() => document.querySelector("#mine").textContent.length);
  await placeCaret(page, { selector: "#mine", offset: length });
  await page.keyboard.type(MINE_APPENDED, { delay: 20 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.handle.editing.isEditing() === false, undefined, {
    message: "Esc to commit the reviewer's edit"
  });
  await pollPage(page, () => window.__lahe.items().length > 0, undefined, {
    message: "the edit to be recorded"
  });
}

test.describe("the reviewer can see what the agent changed", () => {
  let dir;
  let filePath;
  let pages;
  let service;
  let token;
  const CHANGED_NAMES = [
    highlightModule.NAME.CHANGED,
    highlightModule.NAME.CHANGED_FADING,
    highlightModule.NAME.CHANGED_FAINT
  ];

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-change-highlight-"));
    filePath = path.join(dir, PAGE_FILE);
    pages = await startStaticServer({ root: dir, label: "change-highlight" });
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

  test("the rewritten and the added paragraph are marked; the untouched one is not", async ({ page }) => {
    write(filePath, firstEdition(service.url, token));
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime"
    });

    await readTwice(page);

    // The reviewer's own edit, which replay re-applies after the reload. It is
    // on both sides of the comparison, so it is not news.
    await rewriteMine(page);

    write(filePath, secondEdition(service.url, token));
    await pollPage(page, () => document.querySelector("#edition").textContent === "Second edition", undefined, {
      message: "the page to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await booted(page);

    // The comparison runs once the page has finished drawing itself and replay
    // has put the reviewer's records back.
    await pollPage(page, () => window.__lahe.handle.changedBlocks().length > 0, undefined, {
      message: "the changed blocks to be marked",
      timeoutMs: replayModule.SETTLE_MS + 10000
    });

    expect(await markedIds(page, CHANGED_NAMES), "what the agent changed, and only that").toEqual([
      "added",
      "reworded"
    ]);

    // The reviewer's own re-applied edit is on the page, and unmarked.
    expect(await page.evaluate(() => document.querySelector("#mine").textContent.trim())).toBe(MINE_AFTER);
  });

  test("the mark fades out and is gone", async ({ page }) => {
    write(filePath, firstEdition(service.url, token));
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime"
    });

    await readTwice(page);
    write(filePath, secondEdition(service.url, token));
    await pollPage(page, () => document.querySelector("#edition").textContent === "Second edition", undefined, {
      message: "the page to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await booted(page);
    await pollPage(page, () => window.__lahe.handle.changedBlocks().length > 0, undefined, {
      message: "the changed blocks to be marked",
      timeoutMs: replayModule.SETTLE_MS + 10000
    });

    // It goes through the fading rules on its way out rather than blinking off.
    await pollPage(
      page,
      (faint) => {
        const held = CSS.highlights.get(faint);
        return !!held && held.size > 0;
      },
      highlightModule.NAME.CHANGED_FAINT,
      { message: "the mark to reach its faintest step", timeoutMs: highlightModule.CHANGED_MS + 5000 }
    );

    await pollPage(page, () => window.__lahe.handle.changedBlocks().length === 0, undefined, {
      message: "the mark to be gone after the fade",
      timeoutMs: highlightModule.CHANGED_MS + 5000
    });
    expect(await markedIds(page, CHANGED_NAMES), "nothing is left painted").toEqual([]);
  });

  test("nothing the page changes by itself is ever marked", async ({ page }) => {
    write(filePath, firstEdition(service.url, token));
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime"
    });

    // The timer gives itself away between the two readings of this page.
    await readTwice(page);

    write(filePath, secondEdition(service.url, token));
    await pollPage(page, () => document.querySelector("#edition").textContent === "Second edition", undefined, {
      message: "the page to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await booted(page);
    await pollPage(page, () => window.__lahe.handle.changedBlocks().length > 0, undefined, {
      message: "the changed blocks to be marked",
      timeoutMs: replayModule.SETTLE_MS + 10000
    });

    expect(
      await markedIds(page, CHANGED_NAMES),
      "the agent's paragraphs, and never the clock, the slide number or the status line"
    ).toEqual(["added", "reworded"]);
  });

  test("a change with no reload behind it paints nothing at all", async ({ page }) => {
    write(filePath, firstEdition(service.url, token));
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime"
    });

    // A dev server hot-swapping a block, or the page rewriting one on its own.
    // Nobody rebuilt anything the reviewer asked for, so there is nothing to
    // report and nothing is painted.
    await page.evaluate((text) => {
      document.querySelector("#reworded").textContent = text;
    }, REWRITTEN);

    // Two reply polls is long past the debounce the old mutation path used,
    // measured on a counter the library already keeps rather than on a clock.
    const polls = await page.evaluate(() => window.__lahe.handle.sync.status().counters.polls);
    await pollUntil(
      async () => (await page.evaluate(() => window.__lahe.handle.sync.status().counters.polls)) >= polls + 3,
      { timeoutMs: 20000, message: "the page to sit with its own mutation on it" }
    );

    expect(await page.evaluate(() => window.__lahe.handle.changedBlocks())).toEqual([]);
    expect(await markedIds(page, CHANGED_NAMES), "a page mutating itself is never the agent").toEqual([]);
  });
});
