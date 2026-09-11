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
// A live helper is required (the reload trigger is the reviewed file's mtime),
// so this serves a real file from a real directory, like auto_reload.spec.js.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, placeCaret, startStaticServer, startService } = require("../helpers");
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
const MINE_APPENDED = " And they added this themselves.";
const MINE_AFTER = MINE_BEFORE + MINE_APPENDED;

function docHtml(helperOrigin, token, edition, body) {
  const attrs = protocol.SCRIPT_ATTR;
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Steady Pace</title></head>\n' +
    '<body>\n<main>\n<h1 id="edition">' +
    edition +
    "</h1>\n" +
    body +
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

  test("a change that lands with no reload at all is marked too", async ({ page }) => {
    write(filePath, firstEdition(service.url, token));
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime"
    });

    // The baseline this page will compare against. On a reload it comes from
    // the page that left; here the page takes its own, which is what the boot
    // pass does on a first load.
    await page.evaluate(() => window.__lahe.handle.paintWhatChanged(null));

    // The page rewrites a paragraph on its own: a dev server hot-swapping it,
    // or an app repainting a section.
    await page.evaluate((text) => {
      document.querySelector("#reworded").textContent = text;
    }, REWRITTEN);

    await pollPage(page, () => window.__lahe.handle.changedBlocks().length > 0, undefined, {
      message: "the hot-swapped paragraph to be marked",
      timeoutMs: 10000
    });
    expect(await markedIds(page, CHANGED_NAMES), "only the block whose text changed").toEqual(["reworded"]);
  });
});
