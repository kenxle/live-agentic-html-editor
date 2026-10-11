// V51: a stale always-on helper is replaced at a quiet moment with a review
// window open, and the page keeps working.
//
// Without the install, a helper older than its code is left alone while a
// reviewer has a page open (helper_not_replaced.test.js). Installed, the helper
// serves every page all the time, so some window is nearly always open and new
// code would never take over (architecture review AR9). So the CLI replaces it
// with the window open, after a moment with no review writes, and asks the
// login item to start the new one instead of spawning it.
//
// The login item here is a runner the test passes in. Where launchd would start
// the helper, it starts one on the same port and state folder. No real login
// item is registered, and every helper is stopped in teardown.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { test, expect, pollPage, startStaticServer, startService } = require("../helpers");
const protocol = require("../../src/shared/protocol.js");
const loginItem = require("../../src/service/login_item.js");
const sessionCommand = require("../../src/cli/commands/session.js");

const REVIEW = "always-on-stale";
const PAGE_FILE = "page.html";

function docHtml(helperOrigin, token) {
  const attrs = protocol.SCRIPT_ATTR;
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Quiet Hours</title></head>\n' +
    "<body>\n<main>\n" +
    '<p id="body">The library stays open until nine, and the reading room closes at eight.</p>\n' +
    "</main>\n" +
    '<script src="' + helperOrigin + '/lahe-layer.js" ' +
    attrs.REVIEW + '="' + REVIEW + '" ' +
    attrs.TOKEN + '="' + token + '" ' +
    attrs.HELPER + '="' + helperOrigin + '"></script>\n</body>\n</html>\n'
  );
}

/** A scratch source tree newer than any helper running now. */
function newerSource(root, name) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, "src"), { recursive: true });
  const file = path.join(dir, "src", "x.js");
  fs.writeFileSync(file, "// newer than the helper\n");
  const future = new Date(Date.now() + 60 * 60 * 1000);
  fs.utimesSync(file, future, future);
  return dir;
}

test.describe("an always-on helper behind its code is replaced under an open page", () => {
  let dir;
  let pages;
  let service;
  let token;
  let savedSource;

  test.beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-always-on-stale-"));
    pages = await startStaticServer({ root: dir, label: "always-on-stale" });
    service = await startService({ reviews: [REVIEW], allowedOrigins: [pages.origin], env: { LAHE_PORT: "0" } });
    token = service.tokenFor(REVIEW);
    fs.writeFileSync(path.join(dir, PAGE_FILE), docHtml(service.url, token));
    savedSource = process.env.LAHE_SOURCE_DIR;
  });

  test.afterAll(async () => {
    if (savedSource === undefined) delete process.env.LAHE_SOURCE_DIR;
    else process.env.LAHE_SOURCE_DIR = savedSource;
    if (service) await service.stop();
    if (pages) await pages.close();
  });

  test("V51: replaced through the login item at a quiet moment, and the page posts to the new helper", async ({ page }) => {
    await page.goto(pages.origin + "/" + PAGE_FILE);
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, { message: "the layer to boot" });
    await pollPage(page, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
      message: "the page to hold its window"
    });
    // The page's heartbeat is what puts the window on disk; send one now
    // rather than waiting for the timer.
    await page.evaluate(() => window.__lahe.handle.sync.heartbeat());

    const port = service.port;
    const stateDir = service.stateDir;

    // Without the install: the open window keeps a stale helper where it is.
    process.env.LAHE_SOURCE_DIR = path.join(newerSource(dir, "clone-source"), "src");
    const kept = await sessionCommand.startHelper(stateDir, port);
    expect(kept.started, "a clone leaves a stale helper alone while a page is open").toBe(false);
    expect(kept.keptForReviewer).toBeTruthy();

    // Installed: the login item runs the clone named in install.json, which is
    // newer than the helper.
    loginItem.writeInstall(stateDir, {
      system: loginItem.systemFor(process.platform) || "linux",
      label: "lahe-test-stale",
      port: port,
      state_dir: stateDir,
      clone: newerSource(dir, "installed-clone")
    });
    const asked = [];
    const runner = async (command, args) => {
      asked.push([command].concat(args));
      service = await startService({
        reviews: [REVIEW],
        allowedOrigins: [pages.origin],
        stateDir: stateDir,
        env: { LAHE_PORT: String(port) }
      });
      return { status: 0, output: "" };
    };
    const before = service.pid;
    const replaced = await sessionCommand.startHelper(stateDir, port, { runner, quietMs: 200, quietMaxMs: 5000 });
    expect(replaced.started, "replaced with the window still open").toBe(true);
    expect(replaced.stale).toBe(true);
    expect(replaced.keptForReviewer).toBeNull();
    expect(asked.length, "the new helper came from the login item, not a spawn").toBe(1);
    expect(service.pid).not.toBe(before);

    // The page carries on with the new helper.
    await pollPage(
      page,
      (polls) => window.__lahe.handle.sync.status().counters.polls > polls,
      await page.evaluate(() => window.__lahe.handle.sync.status().counters.polls),
      { message: "the page to poll the new helper" }
    );
    const beat = await page.evaluate(() => window.__lahe.handle.sync.heartbeat());
    expect(beat.granted, "the new helper knows the page as the holder it was").toBe(true);
    const state = await page.evaluate(() => ({
      readOnly: window.__lahe.handle.sync.status().readOnly,
      chips: window.__lahe.failures().map((f) => f.code)
    }));
    expect(state.readOnly).toBe(false);
    expect(state.chips).not.toContain("SECOND_WINDOW_REFUSED");

    // And a comment made now reaches the new helper's log.
    await page.evaluate(() => {
      const el = document.querySelector("#body");
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, { message: "the comment box to open" });
    await page.keyboard.type("Say which room closes first.");
    await page.keyboard.press("ControlOrMeta+Enter");
    await pollPage(page, () => window.__lahe.handle.sync.status().queued === 0, undefined, {
      message: "the outbox to drain into the new helper"
    });
    const logged = fs.readFileSync(path.join(stateDir, "reviews", REVIEW, "events.jsonl"), "utf8");
    expect(logged).toContain("Say which room closes first.");
  });
});
