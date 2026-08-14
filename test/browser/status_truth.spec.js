// The status line and the failure chips must never lie.
//
// Three walkers found the same family of bugs on 2026-08-14, and each test here
// is one of their reproductions, written so it fails on the code they walked:
//
//   1. Commit, then click a link. The navigation aborts the in-flight post, the
//      sync client called the abort a helper failure, and the chip it raised was
//      persisted to storage and stood on every later page next to a green
//      "Stored." The record was never in danger: it is in browser storage and it
//      re-posts on the next load, which is why the abort is not a failure.
//   2. A freshly loaded page with a healthy helper read "Kept in this browser.
//      Nothing is lost; it will be stored when the helper is back." forever,
//      because the only thing that proved the helper existed was a successful
//      POST, and a page with nothing queued never posts. The helper being away
//      was invented.
//   3. The same page after a kill -9 and a restart stayed stuck on kept-locally
//      until the reviewer typed something new.
//
// The true-failure path is asserted in the same file, because the cheapest way
// to pass tests 1 and 2 is to stop reporting a helper that really is down.

"use strict";

const path = require("node:path");
const {
  test,
  expect,
  startStaticServer,
  startService,
  pollPage,
  placeCaret,
  SERVICE_ENTRY: serviceEntry
} = require("../helpers");
const { startAppServer: startApp } = require("../fixtures/app/server");

const REPO_ROOT = path.join(__dirname, "..", "..");
const SERVICE_ENTRY = serviceEntry;
const REVIEW = "status-truth";
const EPHEMERAL_PORT = ["--port", "0"];

const UNREACHABLE = "HELPER_UNREACHABLE";

function railUrl(server, helper, token) {
  const query = new URLSearchParams({ review: REVIEW, helper: helper, token: token });
  return server.urlFor("test/fixtures/rail.html") + "?" + query.toString();
}

function codesOf(chips) {
  return chips.map((chip) => chip.code);
}

test.describe("the status line and the chips tell the truth", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "status-truth" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("a fresh page with a healthy helper reads stored, with nothing typed", async ({ page }) => {
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });

    try {
      await page.goto(railUrl(pages, helper.url, helper.tokenFor(REVIEW)));
      await page.evaluate(() => window.__laheRail.startSync());

      // Not one keystroke. The helper answers the reply poll, which is all the
      // proof a page with an empty outbox can have or needs.
      await pollPage(page, () => window.__laheRail.status() === "stored", undefined, {
        timeoutMs: 10000,
        message: "the status line to read stored on a page with nothing queued"
      });

      const reading = await page.evaluate(() => ({
        status: window.__laheRail.status(),
        text: window.__laheRail.statusText(),
        chips: window.__laheRail.chips(),
        pending: window.__laheRail.pending()
      }));
      expect(reading.pending).toBe(0);
      expect(reading.text).toBe("Stored.");
      expect(codesOf(reading.chips), "and no chip about a helper that is up").not.toContain(UNREACHABLE);
    } finally {
      if (helper.alive()) await helper.kill9();
    }
  });

  test("a helper that is really gone still gets its chip, and it never counts past one", async ({ page }) => {
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });

    try {
      await page.goto(railUrl(pages, helper.url, helper.tokenFor(REVIEW)));
      await page.evaluate(() => window.__laheRail.startSync());
      await pollPage(page, () => window.__laheRail.status() === "stored", undefined, {
        timeoutMs: 10000,
        message: "the status line to read stored before the helper is killed"
      });

      await helper.kill9();

      await pollPage(page, () => window.__laheRail.status() === "kept_locally", undefined, {
        timeoutMs: 20000,
        message: "the status line to read kept-locally against a helper that is gone"
      });

      const down = await page.evaluate(() => ({
        text: window.__laheRail.statusText(),
        chips: window.__laheRail.chips()
      }));
      expect(down.text).toContain("Nothing is lost");
      expect(codesOf(down.chips)).toContain(UNREACHABLE);

      // Several failed polls later it is still ONE standing chip, not a tally of
      // how many times the reviewer's page asked. The wait is on the poll
      // counter, so it is the asking that is counted, never the clock.
      const asked = await page.evaluate(() => window.__laheRail.sync().counters.polls);
      await pollPage(page, (target) => window.__laheRail.sync().counters.polls >= target, asked + 4, {
        timeoutMs: 20000,
        message: "four more polls into a helper that is gone"
      });
      const later = await page.evaluate(() => window.__laheRail.chips());
      const chip = later.filter((c) => c.code === UNREACHABLE)[0];
      expect(chip, "the standing chip is still there while the helper is down").toBeTruthy();
      expect(chip.count, "a standing state, not four occurrences").toBe(1);
    } finally {
      if (helper.alive()) await helper.kill9();
    }
  });

  test("kill -9 then restart returns to stored, and clears the chip, with nothing typed", async ({ page }) => {
    const first = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });
    const port = first.port;
    const token = first.tokenFor(REVIEW);
    const stateDir = first.stateDir;
    let second = null;

    try {
      await page.goto(railUrl(pages, first.url, token));
      await page.evaluate(() => window.__laheRail.startSync());

      const one = await page.evaluate(() => window.__laheRail.openCard());
      await page.keyboard.type("A comment the helper takes", { delay: 5 });
      await page.evaluate((id) => window.__laheRail.markReady(id), one.id);
      await pollPage(page, () => window.__laheRail.status() === "stored", undefined, {
        timeoutMs: 10000,
        message: "the first record to be stored"
      });

      await first.kill9();
      await pollPage(page, () => window.__laheRail.status() === "kept_locally", undefined, {
        timeoutMs: 20000,
        message: "the status line to tell the truth about a helper that is gone"
      });

      second = await startService({
        entry: SERVICE_ENTRY,
        stateDir: stateDir,
        reviews: [REVIEW],
        allowedOrigins: [pages.origin],
        env: { LAHE_PORT: String(port), LAHE_TOKEN: token }
      });

      // Nothing is typed here. The reply poll finding the helper again is what
      // has to move the line back.
      await pollPage(page, () => window.__laheRail.status() === "stored", undefined, {
        timeoutMs: 20000,
        message: "the status line to return to stored with no new typing"
      });

      const back = await page.evaluate(() => ({
        chips: window.__laheRail.chips(),
        pending: window.__laheRail.pending()
      }));
      expect(back.pending).toBe(0);
      expect(codesOf(back.chips), "the standing chip goes when its condition ends").not.toContain(UNREACHABLE);
    } finally {
      if (second) await second.kill9();
      if (first.alive()) await first.kill9();
    }
  });
});

test.describe("commit, then click a link", () => {
  test("an edit committed on the way out leaves no failure chip on the next page", async ({ page }) => {
    const appServer = await startApp();
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [appServer.origin]
    });
    const token = helper.tokenFor(REVIEW);

    try {
      appServer.useLayer({ review: REVIEW, token: token, helper: helper.url });
      await page.goto(appServer.urlFor("/"));
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot from its script tag"
      });

      // The reviewer's edit, committed with Esc, and then a real link click in
      // the same breath: this is the walk, verbatim.
      const region = "section.focus p:nth-of-type(1)";
      await placeCaret(page, { selector: region, offset: 0 });
      await page.keyboard.press("ControlOrMeta+Shift+KeyE");
      await pollPage(page, () => window.__lahe.isEditing(), undefined, {
        message: "Cmd-Shift-E to open edit state"
      });
      const length = await page.evaluate((sel) => document.querySelector(sel).textContent.length, region);
      await placeCaret(page, { selector: region, offset: length });
      await page.keyboard.type(" Say which one you text first.", { delay: 15 });
      await page.keyboard.press("Escape");
      await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
        message: "Esc to commit the edit"
      });

      await page.getByRole("link", { name: "Clients" }).click();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot on the page the reviewer clicked to"
      });

      // The chip list is persisted, so anything the last page raised is here.
      const chips = await page.evaluate(() => window.__lahe.failures().map((f) => f.code));
      expect(chips, "the navigation aborted a post; that is not the helper being unreachable").not.toContain(
        UNREACHABLE
      );

      await pollPage(page, () => window.__lahe.status() === "stored", undefined, {
        timeoutMs: 15000,
        message: "the status line on the second page to read stored"
      });
      const after = await page.evaluate(() => window.__lahe.failures().map((f) => f.code));
      expect(after, "and no chip appears once everything has drained either").not.toContain(UNREACHABLE);
    } finally {
      if (helper.alive()) await helper.kill9();
      await appServer.close();
    }
  });
});
