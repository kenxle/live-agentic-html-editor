// The helper gets replaced under a reviewer who is mid-sentence.
//
// One helper serves the whole machine, and any command that needs a helper
// newer than the running one stops it and starts another. On a day when code is
// landing that happened five times, and twice within one minute. Each time it
// hit somebody with a page open:
//
//   - review r4915e2d5d632, 2026-09-10 02:21Z. The new helper's window table was
//     empty, so the page's heartbeat, carrying the secret the OLD helper had
//     minted, was refused as "a second window, holder still alive". The page
//     went read-only, which closes every comment box the reviewer has open, and
//     thirty seconds later took the review over from a quiet holder that was
//     itself.
//   - review r929a3d60b3cb, 2026-09-11 03:36Z. Between two restarts a minute
//     apart the page told the reviewer its address was not registered for the
//     review. meta.json and the new helper both had the origin.
//
// So this is the whole event, with the real helper stopping and starting under
// a real page: the window session is on disk and the new helper reads it, and
// the page keeps its review, its open comment box, and its ability to post.
//
// The heartbeat is driven by hand rather than waited for. The harness forbids
// arbitrary sleeps, and a ten-second timer is exactly the kind of wait that
// turns into a flake.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "helper-restart-holds";
const PAGE_FILE = "page.html";

function docHtml(helperOrigin, token) {
  const attrs = protocol.SCRIPT_ATTR;
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Steady Pace</title></head>\n' +
    "<body>\n<main>\n" +
    '<p id="body">Runners come back too fast after a layoff, and the third week is where it shows.</p>\n' +
    '<p id="second">The plan asks for one easy week before anything else is added.</p>\n' +
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

function pageState(page) {
  return page.evaluate(() => ({
    chips: window.__lahe.failures().map((f) => f.code),
    readOnly: window.__lahe.handle.sync.status().readOnly,
    refusalShown: window.__lahe.rail.refusalShown(),
    busyBoxes: window.__lahe.handle.comments.busyBoxes().length
  }));
}

/** Select a paragraph and open a comment box on it, leaving it OPEN. */
async function openCommentBox(page, selector, text) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text);
}

test.describe("a helper restart is invisible to the page somebody has open", () => {
  let dir;
  let filePath;
  let pages;
  let service;
  let token;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-helper-restart-"));
    filePath = path.join(dir, PAGE_FILE);
    pages = await startStaticServer({ root: dir, label: "helper-restart" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    token = service.tokenFor(REVIEW);
    fs.writeFileSync(filePath, docHtml(service.url, token));
  });

  test.afterAll(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("the page keeps the review, its open comment box, and its next post across a restart", async ({ page }) => {
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
      message: "the first claim to be decided"
    });

    // The reviewer is mid-sentence. This box is what a read-only drop closes.
    await openCommentBox(page, "#body", "This paragraph needs a number.");
    expect((await pageState(page)).busyBoxes, "a comment box is open before the restart").toBe(1);

    // THE RESTART. Same state directory, same port, exactly as a command that
    // found the code on disk newer than the running helper does it.
    const port = String(service.port);
    const stateDir = service.stateDir;
    // What the OLD helper had written down about who holds this review. Without
    // this file the new helper starts with an empty table, and the page's
    // heartbeat carries a secret nobody has ever heard of.
    const beforeTable = JSON.parse(fs.readFileSync(path.join(stateDir, "windows.json"), "utf8"));
    const heldSecret = beforeTable.sessions[REVIEW].session_secret;
    expect(heldSecret, "the helper wrote the holder's secret down before it stopped").toBeTruthy();
    await service.stop();
    service = await startService({
      reviews: [REVIEW],
      allowedOrigins: [pages.origin],
      stateDir: stateDir,
      env: { LAHE_PORT: port }
    });
    expect(service.tokenFor(REVIEW), "the token persists across a restart").toBe(token);

    // Wait for the page to be talking to the new helper again, then send the
    // heartbeat that used to be refused.
    await pollPage(
      page,
      (before) => window.__lahe.handle.sync.status().counters.polls > before,
      await page.evaluate(() => window.__lahe.handle.sync.status().counters.polls),
      { message: "the page to poll the helper that replaced the old one" }
    );
    const beat = await page.evaluate(() => window.__lahe.handle.sync.heartbeat());
    expect(beat.granted, "the new helper recognizes the page as the holder it already was").toBe(true);
    expect(beat.body.took_over, "and does not tell it that it took the review from itself").toBe(false);
    expect(
      beat.body.session_secret,
      "it is the SAME session, restored off disk, not a fresh grant that happened to be free"
    ).toBe(heldSecret);

    const state = await pageState(page);
    expect(state.readOnly, "the page is not read-only").toBe(false);
    expect(state.refusalShown, "no refusal panel").toBe(false);
    expect(state.chips, "no second-window chip").not.toContain("SECOND_WINDOW_REFUSED");
    expect(state.chips, "and it never blamed the page's address").not.toContain("SYNC_ORIGIN_NOT_ALLOWED");
    expect(state.busyBoxes, "the reviewer's comment box is still open").toBe(1);

    // And the first post after the restart lands: the comment reaches the
    // helper's log, which is the only proof that matters.
    await page.keyboard.press("ControlOrMeta+Enter");
    await pollPage(
      page,
      (note) => window.__lahe.items().some((item) => item.note === note && item.state === "ready"),
      "This paragraph needs a number.",
      { message: "the comment to be ready" }
    );
    await pollPage(page, () => window.__lahe.handle.sync.status().queued === 0, undefined, {
      message: "the outbox to drain into the helper that replaced the old one"
    });

    const logged = fs.readFileSync(path.join(stateDir, "reviews", REVIEW, "events.jsonl"), "utf8");
    expect(logged, "the helper that came up second wrote the comment to the review's log").toContain(
      "This paragraph needs a number."
    );
  });

  test("a refusal that is only the helper swapping does not close the reviewer's boxes on the first miss", async ({
    page
  }) => {
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await booted(page);
    await pollPage(page, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
      message: "the claim to be decided"
    });
    await openCommentBox(page, "#second", "One easy week, then build.");

    // The helper is simply gone: every heartbeat fails at the transport. This is
    // the gap between the stop and the start, and it must cost nothing.
    await service.stop();
    const missed = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 3; i += 1) {
        const parsed = await window.__lahe.handle.sync.heartbeat();
        out.push({ granted: parsed.granted, refused: parsed.refused });
      }
      return {
        beats: out,
        readOnly: window.__lahe.handle.sync.status().readOnly,
        busyBoxes: window.__lahe.handle.comments.busyBoxes().length,
        refusalShown: window.__lahe.rail.refusalShown()
      };
    });
    expect(missed.beats.every((b) => b.granted === false && b.refused === false), "nothing answered").toBe(true);
    expect(missed.readOnly, "a helper that is down never takes the review away").toBe(false);
    expect(missed.refusalShown, "and shows no refusal panel").toBe(false);
    expect(missed.busyBoxes, "the reviewer's box is untouched").toBe(1);

    service = await startService({
      reviews: [REVIEW],
      allowedOrigins: [pages.origin],
      stateDir: service.stateDir,
      env: { LAHE_PORT: String(service.port) }
    });
    const back = await page.evaluate(() => window.__lahe.handle.sync.heartbeat());
    expect(back.granted, "and the page has its review back the moment a helper answers").toBe(true);
  });
});
