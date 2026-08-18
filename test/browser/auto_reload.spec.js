// R36 for a static page: the page reloads itself when the agent rebuilds it.
//
// D7 grounded R36 but assumed the serving environment supplies the refresh. A
// built page behind a plain http server supplies nothing, so until this the
// reviewer had to be told to press reload, and an agent live on 2026-08-17 had
// to explain that the tool does not do it. The helper reports the reviewed
// file's mtime on the reply poll and the library reloads when it moves.
//
// Three claims, all of them things a unit test cannot see:
//
//   1. Rewrite the file the review was added at, and the reviewer's browser
//      lands on the new page without touching anything.
//   2. Their comment is still there afterwards. The reload is only safe because
//      D7's replay pass puts their outstanding work back, so a reload that
//      loses a comment is worse than no reload at all.
//   3. NOTHING RELOADS UNDER AN OPEN EDIT. The file changes mid-edit, the page
//      stays put, and the reload happens when the edit is committed.
//
// A live helper is required (the mtime comes from it), so this spec serves a
// real file from a real directory and lets the library reach the helper
// directly. No page.route anywhere: with a route handler registered, the page's
// cross-origin calls never leave the browser (see support/with_layer.js).

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, pollUntil, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "auto-reload";
const PAGE_FILE = "page.html";
const SAID = "Say which week this is about.";

const PARAGRAPH = "Runners come back too fast after a layoff, and the third week is where it shows.";

function docHtml(helperOrigin, token, edition) {
  const attrs = protocol.SCRIPT_ATTR;
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Steady Pace</title></head>\n' +
    "<body>\n<main>\n" +
    '<h1 id="edition">' +
    edition +
    "</h1>\n" +
    '<p id="body">' +
    PARAGRAPH +
    "</p>\n" +
    "</main>\n" +
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

/** What the agent does: rebuild the file the review was added at. */
function rebuild(filePath, helperOrigin, token, edition) {
  fs.writeFileSync(filePath, docHtml(helperOrigin, token, edition));
  // The mtime is the signal, and a filesystem whose timestamps are coarse can
  // give two quick writes the same one. Stamping it forward makes the change
  // unambiguous rather than probable.
  const later = new Date(Date.now() + 10000);
  fs.utimesSync(filePath, later, later);
}

/** A rebuild that lost the lahe script line, which is what a real build does. */
function rebuildWithoutTheLine(filePath, edition) {
  fs.writeFileSync(
    filePath,
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Steady Pace</title></head>\n' +
      "<body>\n<main>\n" +
      '<h1 id="edition">' +
      edition +
      "</h1>\n" +
      '<p id="body">' +
      PARAGRAPH +
      "</p>\n" +
      "</main>\n</body>\n</html>\n"
  );
  const later = new Date(Date.now() + 10000);
  fs.utimesSync(filePath, later, later);
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

/** The reviewer's gesture: select the passage, Cmd-Shift-C, type, Cmd-Enter. */
async function commentOnBody(page, text) {
  await page.evaluate(() => {
    const el = document.querySelector("#body");
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
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
  // An open box is mid-work, and mid-work defers the reload on purpose. Closing
  // it here is the reviewer putting their pen down, and it makes what the rest
  // of the test asserts about the reload a statement about the file rather than
  // about whether a box happened to still be on screen.
  await page.evaluate(() => window.__lahe.handle.comments.closeAll());
}

/** How many times the library has DECIDED about a reload, fired or deferred. */
function reloadState(page) {
  return page.evaluate(() => {
    const s = window.__lahe.handle.sync.status();
    return { checks: s.reloadChecks, fired: s.reloadsFired, pending: s.reloadPending, mtime: s.targetMtime };
  });
}

test.describe("the page updates itself as the agent lands changes (R36)", () => {
  let dir;
  let filePath;
  let pages;
  let service;
  let token;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-auto-reload-"));
    filePath = path.join(dir, PAGE_FILE);
    pages = await startStaticServer({ root: dir, label: "auto-reload" });
    // Port 0, so this helper never collides with the machine's real one on
    // 7817. A developer running this suite is usually mid-review themselves.
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    token = service.tokenFor(REVIEW);

    // What `lahe add` does: tell the helper which file this review is of. That
    // recorded path is the only thing the mtime can come from.
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

  test("a rebuild reloads the reviewer's page, and their comment comes with it", async ({ page }) => {
    rebuild(filePath, service.url, token, "First edition");
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime"
    });

    await commentOnBody(page, SAID);

    // The agent lands a change and rebuilds. Nobody touches the browser.
    rebuild(filePath, service.url, token, "Second edition");

    await pollPage(page, () => document.querySelector("#edition").textContent === "Second edition", undefined, {
      message: "the page to reload itself onto the rebuilt file",
      timeoutMs: 20000
    });
    await booted(page);

    // The reload is only safe because their work comes back with it.
    await pollPage(
      page,
      (note) => window.__lahe.items().some((item) => item.note === note),
      SAID,
      { message: "the comment to survive the reload", timeoutMs: 20000 }
    );
    expect(await page.evaluate(() => window.__lahe.cardIds().length), "and its card is redrawn").toBe(1);
  });

  test("no reload lands on an open edit; it waits until the edit is committed", async ({ page }) => {
    rebuild(filePath, service.url, token, "Third edition");
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime"
    });

    // The reviewer opens an edit on the paragraph and starts typing.
    await page.click("#body");
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.isEditing(), undefined, {
      message: "Cmd-Shift-E to open the edit session"
    });
    await page.keyboard.type(" The fourth week is where it stops.", { delay: 10 });

    // The agent rebuilds underneath them. This is the moment the feature could
    // do real harm.
    rebuild(filePath, service.url, token, "Fourth edition");

    // The library noticed and DECIDED, which is what makes the next assertion a
    // fact rather than a race won by being slow.
    await pollUntil(async () => (await reloadState(page)).checks >= 1, {
      timeoutMs: 20000,
      message: "the library to reach its reload decision"
    });
    const deferred = await reloadState(page);
    expect(deferred.fired, "the page did not reload under the open edit").toBe(0);
    expect(deferred.pending, "and the reload is deferred, not dropped").toBe(true);
    expect(await page.evaluate(() => document.querySelector("#edition").textContent)).toBe("Third edition");
    expect(await page.evaluate(() => window.__lahe.isEditing()), "the edit is still open").toBe(true);

    // They finish. Now the page is allowed to catch up.
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "Esc to commit the edit"
    });

    // Committing an edit leaves the note box open ("what was this change?"), and
    // that box IS mid-work by the same rule: the reviewer is still typing. So
    // the reload is still correctly waiting here, which is worth asserting
    // rather than discovering.
    const stillOpen = await page.evaluate(() => window.__lahe.handle.comments.openBoxes().length);
    expect(stillOpen, "the edit commit left the note box open").toBe(1);
    const afterCommit = await reloadState(page);
    expect(afterCommit.fired, "so the page still has not reloaded").toBe(0);

    // The reviewer puts their pen down. Now the page catches up on its own.
    await page.evaluate(() => window.__lahe.handle.comments.closeAll());
    await pollPage(page, () => document.querySelector("#edition").textContent === "Fourth edition", undefined, {
      message: "the deferred reload to happen once the reviewer is idle",
      timeoutMs: 20000
    });
    await booted(page);
    expect(
      await page.evaluate(() => window.__lahe.items().length),
      "and the edit they made before the reload is still theirs"
    ).toBeGreaterThan(0);
  });

  test("a rebuild that stripped the script line heals itself, with no CLI call in between", async ({ page }) => {
    rebuild(filePath, service.url, token, "Fifth edition");
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => !!window.__lahe.handle.sync.status().targetMtime, undefined, {
      message: "the first poll to establish the baseline mtime"
    });

    await commentOnBody(page, SAID);

    // The real failure, twice on 2026-08-18: the build regenerates the page and
    // the script line is gone with it. Nobody runs `lahe add`. Nobody touches
    // the browser. The helper is the only thing awake.
    rebuildWithoutTheLine(filePath, "Sixth edition");

    await pollUntil(
      () => {
        const html = fs.readFileSync(filePath, "utf8");
        return html.indexOf('data-lahe-review="' + REVIEW + '"') !== -1;
      },
      { timeoutMs: 20000, message: "the helper to put the script line back into the rebuilt file" }
    );
    expect(
      fs.readFileSync(filePath, "utf8").indexOf(token),
      "and it is this review's own token on the line"
    ).toBeGreaterThan(-1);

    await pollPage(page, () => document.querySelector("#edition").textContent === "Sixth edition", undefined, {
      message: "the page to reload itself onto the healed file",
      timeoutMs: 20000
    });
    // The rail is back, which is the whole point: a page that reloaded onto a
    // line-less file would show the new text and nothing to review it with.
    await booted(page);
    await pollPage(
      page,
      (note) => window.__lahe.items().some((item) => item.note === note),
      SAID,
      { message: "the comment to survive the heal and the reload", timeoutMs: 20000 }
    );
    expect(await page.evaluate(() => window.__lahe.cardIds().length), "its card is redrawn").toBe(1);
    expect(await page.evaluate(() => window.__lahe.review), "on the same review").toBe(REVIEW);
  });
});
