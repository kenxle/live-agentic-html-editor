// Closing the window hands the review back, and the next window gets it at once.
//
// D5 gives a review to one window at a time, and a window that simply goes
// quiet is not believed dead for thirty seconds. The goodbye is what keeps the
// reviewer from meeting that clock: on pagehide the layer flushes its words and
// releases the claim, so the next window is granted immediately instead of
// being told "this review is already open in another window" with no other
// window open.
//
// This is the assertion the browser harness now leans on. Playwright tearing a
// context down does not reliably fire pagehide, so the harness says the page's
// goodbye for it at teardown (test/helpers/test.js). That only works because
// the two things below are true of the product, and they are worth their own
// test rather than being assumed by every other spec in the suite:
//
//   1. A REAL tab close (page.close(), which does fire pagehide) hands the
//      review back, and a brand new window in a brand new context is granted
//      the review with nothing to wait for.
//   2. Waiting for sync.commitOnUnload() is enough on its own: a window that
//      says its goodbye and does nothing else leaves the review free for the
//      next one. The ordering underneath that (the promise resolves on the
//      helper's ANSWER to the release, not on having sent it) is pinned
//      deterministically in test/unit/sync_client.test.js, because on a quiet
//      machine the release lands inside the round trip either way.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, startStaticServer, startService, handBackTheReview } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "window-goodbye";
const PAGE_FILE = "page.html";

function docHtml(helperOrigin, token) {
  const attrs = protocol.SCRIPT_ATTR;
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Steady Pace</title></head>\n' +
    "<body>\n<main>\n" +
    '<p id="body">Runners come back too fast after a layoff, and the third week is where it shows.</p>\n' +
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

/** A window of this review, booted and holding the claim the helper granted it. */
async function openHoldingWindow(browser, url) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(url);
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
  await pollPage(page, () => window.__lahe.handle.sync.lockState().helperGranted === true, undefined, {
    message: "the helper to grant this window the review"
  });
  return { context: context, page: page };
}

/**
 * The next window's own answer from the helper: granted, or refused.
 *
 * `checked` flips as soon as the CLIENT lock has answered, while the claim to
 * the helper is still on the wire, so a window about to be refused reads as a
 * happy one until that request lands. helperGranted is a boolean once the
 * helper has answered either way, and refusedBy is "helper" on a refusal.
 */
async function helperAnswered(page) {
  await pollPage(
    page,
    () => {
      const lock = window.__lahe.handle.sync.lockState();
      return typeof lock.helperGranted === "boolean" || lock.refusedBy === "helper";
    },
    undefined,
    { message: "the helper's own answer to this window's claim" }
  );
  return page.evaluate(() => ({
    granted: window.__lahe.handle.sync.lockState().helperGranted === true,
    readOnly: window.__lahe.handle.sync.status().readOnly,
    chips: window.__lahe.failures().map((f) => f.code)
  }));
}

test.describe("closing the window hands the review back", () => {
  let dir;
  let pages;
  let service;
  let url;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-goodbye-"));
    pages = await startStaticServer({ root: dir, label: "window-goodbye" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    fs.writeFileSync(path.join(dir, PAGE_FILE), docHtml(service.url, service.tokenFor(REVIEW)));
    url = pages.origin + "/" + PAGE_FILE;
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("a closed tab leaves the review free for the next window, with no clock to wait out", async ({ browser }) => {
    const first = await openHoldingWindow(browser, url);
    // A real tab closing, which is what fires pagehide.
    await first.page.close();

    const second = await browser.newContext();
    const page = await second.newPage();
    await page.goto(url);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the second window's layer to boot"
    });
    const answer = await helperAnswered(page);
    expect(answer.granted, "the second window was granted the review the first one gave back").toBe(true);
    expect(answer.readOnly, "so it is not read-only").toBe(false);
    expect(answer.chips, "and it was not told another window has this review").not.toContain("SECOND_WINDOW_REFUSED");

    // This window holds the review now, and the contexts here are ours to close:
    // the harness's own teardown only covers the `page` fixture. Hand it back,
    // or the next test in this file meets the very refusal being tested.
    await handBackTheReview(page);
    await second.close();
    await first.context.close();
  });

  test("the goodbye is answered before commitOnUnload resolves, not merely sent", async ({ browser }) => {
    const first = await openHoldingWindow(browser, url);
    // The page's own goodbye, awaited, and nothing else. The next window opens
    // on the very next line, with no sleep between them.
    await first.page.evaluate(() => window.__lahe.handle.sync.commitOnUnload());

    const second = await browser.newContext();
    const page = await second.newPage();
    await page.goto(url);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the second window's layer to boot"
    });
    const answer = await helperAnswered(page);
    expect(answer.granted, "the goodbye had already landed when the next window asked").toBe(true);
    expect(answer.readOnly, "so it is not read-only").toBe(false);

    await handBackTheReview(page);
    await second.close();
    await first.context.close();
  });
});
