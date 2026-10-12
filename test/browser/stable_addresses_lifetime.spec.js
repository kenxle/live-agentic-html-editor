// A stable address outlives the session and the helper (stable addresses
// Step 3, Task 3.1).
//
// Plan rows: V33 (after `lahe session close`, the page still loads), V67 (clone
// mode: after the helper stops and `lahe review` starts it again, the old
// address loads), V63 (an unsent draft on a page is there after the helper
// restarts and the tab reloads).
//
// Each test runs the real CLI on a temp state folder, with its own fixed free
// pages port (so the address is the same after a restart), and stops every
// helper its state folder names in teardown, even when it fails.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil } = require("../helpers");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");
const PAGE = "<!doctype html><html><head><meta charset=utf-8><title>Lifetime</title></head>" +
  "<body><main><h1 id=edition>The document</h1><p id=body>A paragraph the reviewer will comment on.</p></main></body></html>";

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

let world = null;

test.beforeEach(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-sa-lifetime-")));
  const stateDir = path.join(root, "state");
  const page = path.join(root, "docs", "lifetime", "page.html");
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, PAGE);
  const port = await freePort();
  const pagesPort = await freePort();
  const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir, LAHE_PAGES_PORT: String(pagesPort) });
  delete env.XDG_STATE_HOME;
  function cli(args) {
    try {
      return execFileSync(process.execPath, [CLI].concat(args), { cwd: REPO_ROOT, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      return String(err.stdout || "") + String(err.stderr || "");
    }
  }
  world = { root, stateDir, page, port, pagesPort, cli, sessions: [] };
});

test.afterEach(async () => {
  if (!world) return;
  for (const session of world.sessions) world.cli(["session", "close", session]);
  await stopTempHelpers(world.stateDir);
  world = null;
});

function review() {
  const out = world.cli(["review", world.page, "--port", String(world.port)]);
  const session = labelled(out, "session");
  if (session && world.sessions.indexOf(session) === -1) world.sessions.push(session);
  return { out, open: labelled(out, "open"), session, review: labelled(out, "review") };
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from the injected script tag"
  });
}

function helperUp() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port: world.port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

test("V33: after lahe session close, the page still loads at its address, with its rail", async ({ page }) => {
  const first = review();
  expect(first.open).toMatch(new RegExp("^http://[a-z0-9.-]+\\.lahe\\.localhost:" + world.pagesPort + "/page\\.html$"));
  await page.goto(first.open);
  await booted(page);
  const closed = world.cli(["session", "close", first.session]);
  expect(closed).toMatch(/closed; review history kept/);
  expect(closed).not.toMatch(/static review server/);
  // The page is open, so the close leaves the helper up for it.
  await page.reload();
  await expect(page.locator("#edition")).toHaveText("The document");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(first.review);
});

test("V67: in clone mode, after the helper stops and lahe review starts it again, the old address loads", async ({ page }) => {
  const first = review();
  await stopTempHelpers(world.stateDir);
  expect(await helperUp()).toBe(false);
  // Asked outside the tab, so no error page is left navigating in it.
  const failed = await page.request.get(first.open).then(() => null, (err) => err);
  expect(failed, "the address is dead while no helper runs").toBeTruthy();
  const second = review();
  expect(second.open, "the same address").toBe(first.open);
  await page.goto(first.open);
  await expect(page.locator("#edition")).toHaveText("The document");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(first.review);
});

test("V63: an unsent draft on a page is there after the helper restarts and the tab reloads", async ({ page }) => {
  const first = review();
  await page.goto(first.open);
  await booted(page);
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
  await page.keyboard.type("Half a thought about this", { delay: 5 });
  await pollPage(page, () => window.__lahe.items().some((i) => i.note === "Half a thought about this" && i.state === "draft"), undefined, {
    message: "the draft to be in browser storage"
  });

  // The helper goes away and comes back; the address does not change.
  await stopTempHelpers(world.stateDir);
  const again = review();
  expect(again.open).toBe(first.open);
  await page.reload();
  await booted(page);
  const drafts = await page.evaluate(() => window.__lahe.items().filter((i) => i.state === "draft").map((i) => i.note));
  expect(drafts).toContain("Half a thought about this");
  await pollUntil(() => helperUp(), { message: "the helper to be up again" });
});
