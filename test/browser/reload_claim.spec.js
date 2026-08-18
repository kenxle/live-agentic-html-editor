// A page that reloads itself must not trip its own second-window guard.
//
// R36's auto-reload starts a new document in the same tab, and the new document
// starts BEFORE the outgoing one is torn down. For that moment the outgoing page
// still holds the Web Lock, so the incoming one was refused, went read-only, and
// showed "This review is open in another window" with exactly one window open
// (Ken, live, 2026-08-18). The window id lives in sessionStorage and survives a
// same-tab reload, so the two are the same tab and the store now says so.
//
// The second half is the chip. A chip is restored from browser storage on every
// load, and it was trusted as it stood, so a refusal from an earlier session
// stayed on the rail while the reviewer typed happily into the review it claimed
// was locked. Every successful claim now re-validates it.
//
// Three claims:
//
//   1. Reload the page, several times: no second-window chip, not read-only, and
//      the reviewer can still comment.
//   2. A second-window chip seeded into storage before the load is GONE once the
//      claim succeeds.
//   3. The helper restarting mid-session does not refuse the page that is
//      already open: the claims are in memory, so a restart means no holder.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "reload-claim";
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

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

function refusalState(page) {
  return page.evaluate(() => ({
    chips: window.__lahe.failures().map((f) => f.code),
    readOnly: window.__lahe.handle.sync.status().readOnly,
    refusalShown: window.__lahe.rail.refusalShown()
  }));
}

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

test.describe("a reload is the same window, not a second one", () => {
  let dir;
  let filePath;
  let pages;
  let service;
  let token;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-reload-claim-"));
    filePath = path.join(dir, PAGE_FILE);
    pages = await startStaticServer({ root: dir, label: "reload-claim" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    token = service.tokenFor(REVIEW);
    fs.writeFileSync(filePath, docHtml(service.url, token));
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("reloading the page over and over never refuses it, and it stays writable", async ({ page }) => {
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);

    for (let i = 0; i < 4; i += 1) {
      await page.reload();
      await booted(page);
      // The claim is asynchronous, so wait for it to have been decided rather
      // than reading a state that has not happened yet.
      await pollPage(page, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
        message: "the window claim to be decided after the reload"
      });
      const state = await refusalState(page);
      expect(state.chips, "no second-window chip after reload " + (i + 1)).not.toContain("SECOND_WINDOW_REFUSED");
      expect(state.readOnly, "and the window is not read-only").toBe(false);
      expect(state.refusalShown, "and the refusal panel is not shown").toBe(false);
    }

    // Still the reviewer's page: they can comment on it.
    await commentOnBody(page, "This paragraph needs a number.");
    expect((await page.evaluate(() => window.__lahe.items())).length).toBe(1);
  });

  test("a second-window chip left in storage does not survive a successful claim", async ({ page }) => {
    // A refusal from an earlier session, exactly as browser storage holds it.
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await page.evaluate(
      ({ key }) => {
        window.localStorage.setItem(
          key,
          JSON.stringify({
            chips: [
              {
                code: "SECOND_WINDOW_REFUSED",
                message: "This review is already open in another window.",
                detail: "the window on page.html, open for the last 4 minutes",
                count: 1
              }
            ],
            dismissed: []
          })
        );
      },
      { key: "lahe.chips.v1:" + REVIEW }
    );

    await page.reload();
    await booted(page);
    await pollPage(page, () => !window.__lahe.failures().some((f) => f.code === "SECOND_WINDOW_REFUSED"), undefined, {
      message: "the stale second-window chip to be cleared by the successful claim"
    });
    expect((await refusalState(page)).readOnly, "and the window is not read-only").toBe(false);
  });

  test("a helper restart does not refuse the page that is already open", async ({ page }) => {
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
      message: "the first claim to be decided"
    });

    // The helper's claims are in memory, so a restart is the case where the page
    // outlives every record of who holds what.
    const port = String(service.port);
    const stateDir = service.stateDir;
    await service.stop();
    service = await startService({
      reviews: [REVIEW],
      allowedOrigins: [pages.origin],
      stateDir: stateDir,
      env: { LAHE_PORT: port }
    });
    expect(service.tokenFor(REVIEW), "the token persists across a restart").toBe(token);

    await pollPage(page, () => window.__lahe.handle.sync.status().counters.polls > 0, undefined, {
      message: "the page to keep polling across the restart"
    });
    const state = await refusalState(page);
    expect(state.chips, "the restart did not refuse the open page").not.toContain("SECOND_WINDOW_REFUSED");
    expect(state.readOnly).toBe(false);
  });
});
