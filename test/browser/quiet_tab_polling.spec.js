// A tab nobody is looking at stops asking the helper anything.
//
// Spec: docs/features/20260928.01_quiet_tab_polling/01_spec_quiet_tab_polling.md.
// The unit suite (test/unit/quiet_tab_polling.test.js) pins every number on a
// fake clock. This is the same rule on a real page, a real helper and a real
// agent reply:
//
//   1. A hidden tab sends no reply poll for ten minutes. Its only requests are
//      the beat that tells the helper it went quiet and one "still open" beat
//      five minutes later. Bringing it back polls at once, and a reply the
//      agent wrote while nobody was looking is on the page from that one poll.
//   2. A visible page without focus (beside the terminal) polls every 15
//      seconds, so a reply shows up within 15 seconds without focusing it.
//   3. Closing a tab while it is unfocused still hands the review back.
//
// TIME. Ten minutes cannot be waited out, and the harness forbids sleeps, so
// the page runs on Playwright's clock once it has booted. Every jump forward
// is followed by waiting for the answer to the request it fired, so no
// request's own two second deadline is ever run past its answer.
//
// FOCUS. Playwright tells every page it has focus, so the test says otherwise
// the way a browser would: document.hasFocus answers false and the window gets
// a blur event (and document.hidden, for the hidden case).

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  startStaticServer,
  startService,
  readEventLog
} = require("../helpers");
const protocol = require("../../src/shared/protocol.js");

const REVIEW = "quiet-tab-polling";
const PAGE_FILE = "page.html";
const FIVE_MINUTES = 5 * 60 * 1000;

function docHtml(helperOrigin, token) {
  const attrs = protocol.SCRIPT_ATTR;
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Long Run Plan</title></head>\n' +
    "<body>\n<main>\n" +
    '<p id="body">Build the long run by ten percent a week, and hold it every fourth week.</p>\n' +
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

/** Every request this page makes to the helper, in order. */
function recordHelperRequests(page, helperOrigin) {
  const seen = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.indexOf(helperOrigin) !== 0) return;
    let kind = "other";
    if (url.indexOf("/window/release") !== -1) kind = "release";
    else if (url.indexOf("/window") !== -1) kind = "claim";
    else if (url.indexOf("/replies") !== -1) kind = "poll";
    else if (url.indexOf("/events") !== -1) kind = "append";
    let body = null;
    try {
      body = request.postData() ? JSON.parse(request.postData()) : null;
    } catch (err) {
      body = null;
    }
    seen.push({ kind, body });
  });
  return seen;
}

async function bootHolding(page, url) {
  await page.goto(url);
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
  await pollPage(page, () => window.__lahe.handle.sync.lockState().helperGranted === true, undefined, {
    message: "the helper to grant this window the review"
  });
}

/** The reviewer leaves: another app takes focus, and optionally the tab hides. */
function leave(page, options) {
  return page.evaluate((hide) => {
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
    window.dispatchEvent(new Event("blur"));
    if (hide) {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    }
  }, !!(options && options.hide));
}

/** The reviewer comes back: the tab shows, and the window takes focus. */
function comeBack(page) {
  return page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hasFocus", { configurable: true, value: () => true });
    window.dispatchEvent(new Event("focus"));
  });
}

/** Move the page's clock and wait for the answer to the one beat it fires. */
async function runToNextBeat(page, ms) {
  const answered = page.waitForResponse((response) => {
    const url = response.url();
    return url.indexOf("/window") !== -1 && url.indexOf("/release") === -1;
  });
  await page.clock.runFor(ms);
  await answered;
}

/** Move the page's clock and wait for the answer to the one poll it fires. */
async function runToNextPoll(page, ms) {
  const answered = page.waitForResponse((response) => response.url().indexOf("/replies") !== -1);
  await page.clock.runFor(ms);
  await answered;
}

/** Put the page on Playwright's clock, paused, after it has booted for real. */
async function freezeClock(page) {
  await page.clock.install();
  await page.clock.pauseAt(Date.now() + 1000);
  // A poll timer armed before the clock was installed is a real one. Let it
  // land, and wait for its answer, so every timer from here on is the clock's.
  await page.waitForResponse((response) => response.url().indexOf("/replies") !== -1);
}

test.describe("a tab nobody is looking at stops asking", () => {
  let dir;
  let pages;
  let service;
  let url;

  test.beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-quiet-tab-"));
    pages = await startStaticServer({ root: dir, label: "quiet-tab-polling" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    fs.writeFileSync(path.join(dir, PAGE_FILE), docHtml(service.url, service.tokenFor(REVIEW)));
    url = pages.origin + "/" + PAGE_FILE;
  });

  test.afterEach(async () => {
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("a hidden tab sends only two heartbeats in ten minutes, and coming back shows the reply that arrived", async ({
    page
  }) => {
    await bootHolding(page, url);

    // A committed note, so the agent has something to answer.
    await page.evaluate(() => window.__lahe.handle.tab().focusNote());
    await page.keyboard.type("the fourth-week hold needs a reason");
    await page.keyboard.press("ControlOrMeta+Enter");
    await pollPage(page, () => window.__lahe.items().some((i) => i.state === "ready"), undefined, {
      message: "the note to be committed"
    });
    const item = await page.evaluate(() => window.__lahe.items().find((i) => i.state === "ready"));
    await pollUntil(
      () => readEventLog(service.stateDir, REVIEW).some((e) => e.item === item.id && e.event === "item.ready"),
      { message: "the ready note to reach the helper" }
    );

    await freezeClock(page);
    const requests = recordHelperRequests(page, service.url);

    await leave(page, { hide: true });
    // The beat already due (at most ten seconds out) tells the helper this tab
    // went quiet. Then one "still open" beat five minutes later.
    await runToNextBeat(page, 11000);
    fs.appendFileSync(
      path.join(service.stateDir, "reviews", REVIEW, "replies-claude.jsonl"),
      JSON.stringify({ item: item.id, rev: item.rev, status: "handled", agent: "claude" }) + "\n"
    );
    await runToNextBeat(page, FIVE_MINUTES);
    await page.clock.runFor(10 * 60 * 1000 - 11000 - FIVE_MINUTES);

    expect(requests.filter((r) => r.kind === "poll"), "no reply poll while hidden").toHaveLength(0);
    const beats = requests.filter((r) => r.kind === "claim");
    expect(beats, "one beat to say quiet, one five minutes later").toHaveLength(2);
    beats.forEach((beat) => expect(beat.body.quiet, "each beat says quiet").toBe(true));
    expect(requests.map((r) => r.kind), "and nothing else").toEqual(["claim", "claim"]);
    expect(
      await page.evaluate((id) => window.__lahe.itemById(id).reply, item.id),
      "the reply is not on the page yet: nothing has asked"
    ).toBeNull();

    // Coming back polls at once, and that one poll brings the reply.
    const polled = page.waitForResponse((response) => response.url().indexOf("/replies") !== -1);
    await comeBack(page);
    await polled;
    await expect
      .poll(() => page.evaluate((id) => window.__lahe.itemById(id).reply !== null, item.id), {
        message: "the reply written while the tab was hidden is on the page"
      })
      .toBe(true);
    expect(requests.filter((r) => r.kind === "poll").length, "from one poll, with no clock moved").toBe(1);
  });

  test("a visible page without focus shows a reply within 15 seconds", async ({ page }) => {
    await bootHolding(page, url);
    await page.evaluate(() => window.__lahe.handle.tab().focusNote());
    await page.keyboard.type("say why the fourth week holds");
    await page.keyboard.press("ControlOrMeta+Enter");
    await pollPage(page, () => window.__lahe.items().some((i) => i.state === "ready"), undefined, {
      message: "the note to be committed"
    });
    const item = await page.evaluate(() => window.__lahe.items().find((i) => i.state === "ready"));
    await pollUntil(
      () => readEventLog(service.stateDir, REVIEW).some((e) => e.item === item.id && e.event === "item.ready"),
      { message: "the ready note to reach the helper" }
    );

    await freezeClock(page);
    const requests = recordHelperRequests(page, service.url);
    // The reviewer clicks into the terminal beside the page. Still visible.
    // Losing focus moves the next poll to the 15 second pace.
    await leave(page);
    const before = requests.filter((r) => r.kind === "poll").length;

    fs.appendFileSync(
      path.join(service.stateDir, "reviews", REVIEW, "replies-claude.jsonl"),
      JSON.stringify({ item: item.id, rev: item.rev, status: "handled", agent: "claude" }) + "\n"
    );
    // The helper folds reply files on a poll, so the next one brings it.
    await runToNextPoll(page, 15000);
    await expect
      .poll(() => page.evaluate((id) => window.__lahe.itemById(id).reply !== null, item.id), {
        message: "the reply is on the page, with the window never focused"
      })
      .toBe(true);
    expect(requests.filter((r) => r.kind === "poll").length - before, "from one poll 15 seconds later").toBe(1);
  });

  test("closing a tab while it is unfocused still hands the review back", async ({ page, browser }) => {
    await bootHolding(page, url);
    await freezeClock(page);
    await leave(page);
    await runToNextBeat(page, 11000);
    // A real close, which is what fires pagehide.
    await page.close();

    const context = await browser.newContext();
    const next = await context.newPage();
    try {
      await bootHolding(next, url);
      const lock = await next.evaluate(() => window.__lahe.handle.sync.lockState());
      expect(lock.helperGranted, "the next window got the review with no clock to wait out").toBe(true);
      expect(await next.evaluate(() => window.__lahe.handle.sync.status().readOnly)).toBe(false);
    } finally {
      await next.evaluate(() => window.__lahe.handle.sync.commitOnUnload()).catch(() => null);
      await context.close();
    }
  });
});
