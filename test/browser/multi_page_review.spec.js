// One review, two pages, and each page shows only its own items.
//
// A review MAY span pages: `lahe add <page> --review <id>` attaches a second
// page to a live review on purpose. Browser storage is keyed by REVIEW ID, so
// until record.samePage was read at the layer's one read boundary, the second
// page inherited everything the first page had said: live on 2026-08-17 a
// one-pager attached to a review of a full report came up wearing all 78 of the
// report's items, tried to re-anchor every one of them here, and the reviewer's
// select-and-hotkey gesture stopped doing anything.
//
// Four claims, none of them visible to a unit test:
//
//   1. Page B shows ZERO of page A's items: not in the count pill, not in the
//      rail, not as highlights.
//   2. Commenting on page B still works, with page A's items in the same
//      storage bucket.
//   3. Page A still has its own items when the reviewer goes back.
//   4. Page A's items were not deleted, re-posted, or modified by B's session.
//      They belong to another page and B leaves them alone.
//
// A live helper is required, so this serves real files from a real directory and
// lets the library reach the helper directly. No page.route anywhere.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "two-pages";
const PAGE_A = "report.html";
const PAGE_B = "one-pager.html";

const SAID_ON_A = "Say which week this is about.";
const SAID_ON_B = "This headline is doing two jobs.";

function docHtml(helperOrigin, token, title, paragraph) {
  const attrs = protocol.SCRIPT_ATTR;
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>' +
    title +
    "</title></head>\n<body>\n<main>\n" +
    '<h1 id="title">' +
    title +
    "</h1>\n" +
    '<p id="body">' +
    paragraph +
    "</p>\n</main>\n" +
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

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

/** The reviewer's gesture, exactly as they make it: select, Cmd-Shift-C, type, Cmd-Enter. */
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
  await page.evaluate(() => window.__lahe.handle.comments.closeAll());
}

function itemsOnThisPage(page) {
  return page.evaluate(() =>
    window.__lahe.items().map((item) => ({ note: item.note, path: item.page_path, rev: item.rev, state: item.state }))
  );
}

function everyItemInTheReview(page) {
  return page.evaluate(() =>
    window.__lahe.allItems().map((item) => ({ note: item.note, path: item.page_path, rev: item.rev, state: item.state }))
  );
}

test.describe("one review, two pages", () => {
  let dir;
  let pages;
  let service;
  let token;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-two-pages-"));
    pages = await startStaticServer({ root: dir, label: "two-pages" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    token = service.tokenFor(REVIEW);
    fs.writeFileSync(
      path.join(dir, PAGE_A),
      docHtml(service.url, token, "The full report", "Runners come back too fast after a layoff, and the third week is where it shows.")
    );
    fs.writeFileSync(
      path.join(dir, PAGE_B),
      docHtml(service.url, token, "The one pager", "One page, one ask, and a number the reader can hold onto.")
    );
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("the second page shows none of the first page's items, and commenting on it still works", async ({ page }) => {
    // Page A: the reviewer says something.
    await page.goto(pages.origin + "/" + PAGE_A);
    await booted(page);
    await commentOnBody(page, SAID_ON_A);
    expect((await itemsOnThisPage(page)).length, "one item on page A").toBe(1);

    // Page B, same review, same browser storage bucket.
    await page.goto(pages.origin + "/" + PAGE_B);
    await booted(page);

    const onB = await itemsOnThisPage(page);
    expect(onB, "page B shows none of page A's items").toEqual([]);
    expect(await page.evaluate(() => window.__lahe.cardIds().length), "and the rail draws no cards").toBe(0);
    expect(
      (await page.evaluate(() => window.__lahe.rail.geometry().pillCount)),
      "and the count pill counts nothing"
    ).toBe("");
    expect(
      await page.evaluate(() => window.__lahe.handle.comments.highlights.paintedIds().length),
      "and nothing of page A's is painted here"
    ).toBe(0);

    // But page A's items are still in the review, untouched.
    const all = await everyItemInTheReview(page);
    expect(all.length, "page A's item is still in browser storage").toBe(1);
    expect(all[0].note).toBe(SAID_ON_A);
    expect(all[0].state, "and it was not acknowledged or retired by B's session").toBe("ready");
    expect(all[0].rev, "and it was not reworded").toBe(1);

    // Claim 2: the gesture still works here, with a foreign item in the bucket.
    await commentOnBody(page, SAID_ON_B);
    const afterB = await itemsOnThisPage(page);
    expect(afterB.length, "page B has exactly its own one item").toBe(1);
    expect(afterB[0].note).toBe(SAID_ON_B);
    expect(await page.evaluate(() => window.__lahe.cardIds().length), "and one card").toBe(1);

    // Claim 3: back to page A, which still has its own and only its own.
    await page.goto(pages.origin + "/" + PAGE_A);
    await booted(page);
    const backOnA = await itemsOnThisPage(page);
    expect(backOnA.length, "page A still shows its own item").toBe(1);
    expect(backOnA[0].note).toBe(SAID_ON_A);
    expect(backOnA[0].rev, "and B's session did not touch it").toBe(1);

    // Claim 4, from the helper's side: the review holds both, one per page.
    const both = await everyItemInTheReview(page);
    expect(both.length).toBe(2);
    expect(both.map((i) => i.note).sort()).toEqual([SAID_ON_A, SAID_ON_B].sort());
  });

  // The live symptom that came WITH the foreign items: the reviewer selected
  // text on the one-pager, pressed the hotkey, and nothing happened. 78 records
  // that cannot anchor here is the difference between this and the test above,
  // so the reproduction seeds that many before the page ever boots.
  test("a page carrying dozens of another page's records still takes a comment", async ({ page }) => {
    await page.goto(pages.origin + "/" + PAGE_A);
    await booted(page);
    await commentOnBody(page, SAID_ON_A);
    const template = await page.evaluate(() => JSON.stringify(window.__lahe.items()[0]));

    // What the live review looked like: one bucket, 78 records from the other
    // page, all of them written before this page boots.
    await page.addInitScript(
      ({ key, template }) => {
        const one = JSON.parse(template);
        const many = [];
        for (let i = 0; i < 78; i += 1) {
          const copy = JSON.parse(template);
          copy.id = "c_seed" + i;
          copy.note = "item " + i + " from the report";
          many.push(copy);
        }
        many.push(one);
        window.localStorage.setItem(key, JSON.stringify(many));
      },
      { key: "lahe.items.v1:" + REVIEW, template: template }
    );

    await page.goto(pages.origin + "/" + PAGE_B);
    await booted(page);
    expect((await itemsOnThisPage(page)).length, "none of the 79 belong to this page").toBe(0);

    // The gesture, on a page holding 79 foreign records.
    await commentOnBody(page, SAID_ON_B);
    const mine = await itemsOnThisPage(page);
    expect(mine.length, "the hotkey opened a box and the comment landed").toBe(1);
    expect(mine[0].note).toBe(SAID_ON_B);

    const all = await everyItemInTheReview(page);
    expect(all.length, "and all 79 foreign records are still there, untouched").toBe(80);
    expect(all.filter((i) => i.note.indexOf("from the report") !== -1).length).toBe(78);
  });

  // THE NAVIGATION THAT DOES NOT RELOAD.
  //
  // Everything above uses page.goto, which is a full load: a new document, a new
  // boot, and the page identity read fresh on the way up. A Rails or Turbo site
  // does not do that. It pushes a new URL onto history and swaps the body, and
  // the library's document never goes away, so the page it thinks it is on is
  // only as current as whatever re-reads it.
  //
  // Ken, walking a Rails app: "i'm currently walking through
  // /coach/clients/start with lahe and the comments are going across pages."
  // His records were stamped correctly, two distinct paths, so the writing half
  // was right and the showing half was not.
  test("a client-side navigation stops showing the page it left", async ({ page }) => {
    await page.goto(pages.origin + "/" + PAGE_A);
    await booted(page);
    await commentOnBody(page, SAID_ON_A);
    expect((await itemsOnThisPage(page)).length, "one item on page A").toBe(1);

    // The Turbo navigation, in the two moves that matter: the URL changes and
    // the body is replaced. No load event, no new document, no reboot.
    await page.evaluate((href) => {
      window.history.pushState({}, "", href);
      const body = document.createElement("body");
      const p = document.createElement("p");
      p.id = "body";
      p.textContent = "One page, one ask, and a number the reader can hold onto.";
      const main = document.createElement("main");
      main.appendChild(p);
      body.appendChild(main);
      document.documentElement.replaceChild(body, document.body);
    }, "/" + PAGE_B);

    await pollPage(page, () => window.__lahe.handle.page.path.indexOf("one-pager") !== -1, undefined, {
      message: "the library to notice which page it is on now"
    });

    const onB = await itemsOnThisPage(page);
    expect(onB, "page B shows none of page A's items").toEqual([]);
    expect(await page.evaluate(() => window.__lahe.cardIds().length), "and the rail draws no cards").toBe(0);

    // Page A's item is untouched: filtered, never deleted.
    const all = await everyItemInTheReview(page);
    expect(all.length, "page A's item is still in the review").toBe(1);
    expect(all[0].note).toBe(SAID_ON_A);
  });
});
