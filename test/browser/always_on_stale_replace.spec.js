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
// The page here is one the helper itself serves, at its stable address: the
// real CLI runs `lahe review` on a temp state folder with a fixed free pages
// port, so the address is the same after the restart. The login item is a
// runner the test passes in; where launchd would start the helper, it starts
// `lahe serve --always-on` on the same ports and state folder. No real login
// item is registered, and teardown stops every helper the state folder names,
// even when the test fails.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const childProcess = require("node:child_process");

const { test, expect, pollPage } = require("../helpers");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");
const loginItem = require("../../src/service/login_item.js");
const sessionCommand = require("../../src/cli/commands/session.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");
const PAGE = "<!doctype html><html><head><meta charset=utf-8><title>Quiet Hours</title></head>" +
  "<body><main><p id=body>The library stays open until nine, and the reading room closes at eight.</p></main></body></html>";

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function labelled(output, label) {
  const m = new RegExp("^\\s*" + label + "\\s+(\\S+)", "m").exec(output);
  return m ? m[1] : null;
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

let world = null;

test.beforeEach(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-always-on-stale-")));
  const stateDir = path.join(root, "state");
  const page = path.join(root, "docs", "quiet", "page.html");
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, PAGE);
  const port = await freePort();
  const pagesPort = await freePort();
  const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir, LAHE_PAGES_PORT: String(pagesPort) });
  delete env.XDG_STATE_HOME;
  function cli(args) {
    try {
      return childProcess.execFileSync(process.execPath, [CLI].concat(args), { cwd: REPO_ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return String(err.stdout || "") + String(err.stderr || "");
    }
  }
  world = { root, stateDir, page, port, pagesPort, env, cli, savedSource: process.env.LAHE_SOURCE_DIR };
});

test.afterEach(async () => {
  if (!world) return;
  if (world.savedSource === undefined) delete process.env.LAHE_SOURCE_DIR;
  else process.env.LAHE_SOURCE_DIR = world.savedSource;
  await stopTempHelpers(world.stateDir);
  world = null;
});

test("V51: replaced through the login item at a quiet moment, and the helper-served page posts to the new helper", async ({ page }) => {
  const out = world.cli(["review", world.page, "--port", String(world.port)]);
  const open = labelled(out, "open");
  const reviewId = labelled(out, "review");
  expect(open, out).toMatch(new RegExp("^http://[a-z0-9.-]+\\.lahe\\.localhost:" + world.pagesPort + "/page\\.html$"));

  await page.goto(open);
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, { message: "the layer to boot" });
  await pollPage(page, () => window.__lahe.handle.sync.lockState().checked === true, undefined, {
    message: "the page to hold its window"
  });
  // The page's heartbeat is what puts the window on disk; send one now
  // rather than waiting for the timer.
  await page.evaluate(() => window.__lahe.handle.sync.heartbeat());

  // Without the install: the open window keeps a stale helper where it is.
  process.env.LAHE_SOURCE_DIR = path.join(newerSource(world.root, "clone-source"), "src");
  const kept = await sessionCommand.startHelper(world.stateDir, world.port);
  expect(kept.started, "a clone leaves a stale helper alone while a page is open").toBe(false);
  expect(kept.keptForReviewer).toBeTruthy();

  // Installed: the login item runs the clone named in install.json, which is
  // newer than the helper.
  loginItem.writeInstall(world.stateDir, {
    system: loginItem.systemFor(process.platform) || "linux",
    label: "lahe-test-stale",
    port: world.port,
    state_dir: world.stateDir,
    clone: newerSource(world.root, "installed-clone")
  });
  const before = JSON.parse(fs.readFileSync(path.join(world.stateDir, "service.json"), "utf8"));
  const asked = [];
  const runner = (command, args) => {
    asked.push([command].concat(args));
    const child = childProcess.spawn(process.execPath,
      [CLI, "serve", "--always-on", "--port", String(world.port), "--state-dir", world.stateDir],
      { env: world.env, detached: true, stdio: "ignore" });
    child.unref();
    return { status: 0, output: "" };
  };
  const replaced = await sessionCommand.startHelper(world.stateDir, world.port, { runner, quietMs: 200, quietMaxMs: 5000 });
  expect(replaced.started, "replaced with the window still open").toBe(true);
  expect(replaced.stale).toBe(true);
  expect(replaced.keptForReviewer).toBeNull();
  expect(asked.length, "the new helper came from the login item, not a spawn").toBe(1);
  const after = JSON.parse(fs.readFileSync(path.join(world.stateDir, "service.json"), "utf8"));
  expect(after.pid).not.toBe(before.pid);
  expect(after.always_on, "the helper answering now is the login item's").toBe(true);

  // The page carries on with the new helper, at the same address.
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
  const logged = fs.readFileSync(path.join(world.stateDir, "reviews", reviewId, "events.jsonl"), "utf8");
  expect(logged).toContain("Say which room closes first.");

  // The page is still the helper's own, at its stable address.
  await page.reload();
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, { message: "the layer to boot after reload" });
  expect(page.url()).toBe(open);
});
