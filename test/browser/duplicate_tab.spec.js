// A DUPLICATED tab is a second window, whatever its window id says.
//
// The window id lives in sessionStorage so a same-tab reload can prove it is the
// same tab. But a browser COPIES sessionStorage into a duplicated tab (Chrome's
// "Duplicate", and session restore does it too), so the copy arrives holding the
// first tab's id, matched the recorded holder, and was handed the review with no
// Web Lock behind it. Two live tabs then wrote one storage bucket with nothing
// between them: last write wins, silently, which is the one outcome this tool
// exists to prevent.
//
// The lock decides now, not the id. This drives the real thing: two tabs in one
// browser context, the second one booted with the first one's window id already
// in its sessionStorage.
//
// The reload case that MUST keep working is test/browser/reload_claim.spec.js.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "duplicate-tab";
const PAGE_FILE = "page.html";
const WINDOW_ID_KEY = "lahe.window.id.v1";

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

function claimState(page) {
  return page.evaluate(() => ({
    chips: window.__lahe.failures().map((f) => f.code),
    refusalShown: window.__lahe.handle.rail.refusalShown(),
    readOnly: window.__lahe.handle.sync.status().readOnly,
    acquired: window.__lahe.handle.sync.lockState().acquired,
    refusedBy: window.__lahe.handle.sync.lockState().refusedBy
  }));
}

test.describe("a duplicated tab does not inherit the review", () => {
  let dir;
  let pages;
  let service;
  let token;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-duplicate-tab-"));
    pages = await startStaticServer({ root: dir, label: "duplicate-tab" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    token = service.tokenFor(REVIEW);
    fs.writeFileSync(path.join(dir, PAGE_FILE), docHtml(service.url, token));
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  // A WINDOW THAT LEAVES HANDS THE REVIEW BACK.
  //
  // Until this, a window lost a review only by GOING QUIET, and the helper waited
  // out the staleness clock before believing it. A same-tab reload was already
  // fine, because the page that comes back reads the outgoing page's session
  // secret out of storage and is recognized as the same holder. What was not fine
  // was every other way a page ends: navigating somewhere else, or the address
  // changing under the reviewer because the server that served it restarted on a
  // new port. There is no shared storage across those, so the new page asks as a
  // stranger, and the review it is asking for is still held by a page that no
  // longer exists (Ken, live, 2026-08-25).
  //
  // The second context is the point: no shared storage, so nothing but the
  // release can free the review in time.
  test("a window that navigates away frees the review at once, not in thirty seconds", async ({ page, browser }) => {
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
      message: "the first page to take the review"
    });

    // It leaves. This is the reviewer clicking a link, or the address changing
    // under them; either way the document goes and its goodbye goes with it.
    await page.goto("about:blank");

    const stranger = await browser.newContext();
    try {
      const next = await stranger.newPage();
      await next.goto(pages.origin + "/" + PAGE_FILE);
      await booted(next);
      // The budget is the assertion. The goodbye is fire and forget, so the
      // next window can ask before it lands and be refused once. What it must
      // not do is wait out the staleness clock: this poll gives up long before
      // the thirty seconds that a window going quiet would have cost, so it can
      // only pass if the review was actually handed back.
      await pollPage(next, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
        message: "the next window to be given the review"
      });

      const state = await claimState(next);
      expect(state.acquired, "the review was handed back, so the next window has it").toBe(true);
      expect(state.readOnly, "and it can actually review").toBe(false);
    } finally {
      await stranger.close();
    }
  });

  test("the copy is refused and goes read-only, and the original keeps the review", async ({ page }) => {
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
      message: "the first tab's claim to be decided"
    });
    expect((await claimState(page)).acquired, "the first tab holds the review").toBe(true);

    // What Duplicate does: the same storage bucket AND a copy of ALL of
    // sessionStorage. Window id and helper session secret both, which is the
    // whole point: with the secret copied too, the helper recognizes the copy as
    // the holder's own heartbeat and grants it. Nothing but the client Web Lock
    // is left to tell the two tabs apart. Seeded before any script runs, so the
    // layer boots with it exactly as the copied tab would.
    await pollPage(page, () => !!window.sessionStorage.getItem("lahe.session.v1:duplicate-tab"), undefined, {
      message: "the first tab to hold a helper session secret worth copying"
    });
    const session = await page.evaluate(() => {
      const out = {};
      for (let i = 0; i < window.sessionStorage.length; i += 1) {
        const key = window.sessionStorage.key(i);
        out[key] = window.sessionStorage.getItem(key);
      }
      return out;
    });
    expect(session[WINDOW_ID_KEY], "the first tab minted a window id").toBeTruthy();

    const copy = await page.context().newPage();
    try {
      await copy.addInitScript((entries) => {
        Object.keys(entries).forEach((key) => window.sessionStorage.setItem(key, entries[key]));
      }, session);
      await copy.goto(pages.origin + "/" + PAGE_FILE);
      await booted(copy);
      await pollPage(copy, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
        message: "the duplicated tab's claim to be decided"
      });

      const state = await claimState(copy);
      expect(state.acquired, "the id matched, but a live window holds the lock").toBe(false);
      // The CLIENT lock is what refused it. The helper granted the claim: the
      // copy presented the holder's own session secret, because a duplicated tab
      // has it.
      expect(state.refusedBy, "refused by the lock, not by the helper").toBe("lock");
      // The refusal PANEL is what tells the copy what it is: a read-only
      // window shows the panel with its takeover button, and the chip saying
      // the same two sentences beside it was deduplicated away (one surface
      // per fact, 2026-08-18). The chip appears only on the panel-less paths.
      expect(state.refusalShown, "so the copy is told what it is, by the panel").toBe(true);
      expect(state.chips, "and not by a duplicate chip beside it").not.toContain("SECOND_WINDOW_REFUSED");
      expect(state.readOnly, "and it writes nothing to the shared bucket").toBe(true);

      // The first tab is untouched by any of it.
      const original = await claimState(page);
      expect(original.acquired, "the original still holds the review").toBe(true);
      expect(original.readOnly, "and is still writable").toBe(false);
    } finally {
      await copy.close();
    }
  });
});
