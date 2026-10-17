// A file's comments move with it, in a real browser
// (docs/features/20261017.01_comments_follow_moved_file/01_spec_comments_follow_moved_file.md).
//
// Two comments are made on a page at its old address, and the agent answers
// one handled. The page's folder then moves, and the real CLI records the new
// path the way an agent is told to: `lahe review <new path> --session <id>
// --review <id>`. The new address's rail shows Active 1 and Done 1, each card
// on its words. The old site is rooted above the folder that moves, as Ken's
// was. One run also leaves a symlink at the old folder, which points outside
// the old site's root.
//
// Screenshots, light and dark, of the rail at the new address when
// LAHE_SCREENSHOT_DIR is set.
//
// The helper runs in this worker on free ports and a temp state folder, and
// the CLI talks to it there. Teardown closes it, and stops any helper left
// under the temp state folder, even when a test fails. Nothing is deleted:
// the folder is moved.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { test, expect } = require("@playwright/test");

const service = require("../../src/service/index.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const CLI = path.join(__dirname, "..", "..", "bin", "lahe.js");
const REPO_ROOT = path.join(__dirname, "..", "..");
const SHOT_DIR = process.env.LAHE_SCREENSHOT_DIR || null;
const FIRST = "The brief says what we will study, and why it matters now.";
const SECOND = "The second paragraph names the sources we will read first.";
const HTML = [
  "<!doctype html>",
  "<html lang=\"en\"><head><meta charset=\"utf-8\"><title>Brief</title></head>",
  "<body><main><h1>Brief</h1>",
  "<p>" + FIRST + "</p>",
  "<p>" + SECOND + "</p>",
  "</main></body></html>",
  ""
].join("\n");

let world = null;
let counter = 0;

test.beforeEach(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-move-")));
  const home = path.join(root, "home");
  const state = path.join(root, "state");
  fs.mkdirSync(home);
  const priorHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  const helper = await service.serve({ port: 0, stateDir: state, quiet: true, pagesPort: 0, sitesHome: home });
  world = { root, home, state, helper, priorHome };
});

test.afterEach(async () => {
  if (!world) return;
  await world.helper.close();
  await stopTempHelpers(world.state);
  if (world.priorHome === undefined) delete process.env.LAHE_HOME_DIR;
  else process.env.LAHE_HOME_DIR = world.priorHome;
  world = null;
});

function writeFile(base, rel, contents) {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

function origin(name) {
  return protocol.siteOrigin(name, world.helper.pagesPort);
}

async function booted(page) {
  await expect.poll(() => page.evaluate(() => !!(window.__lahe && window.__lahe.booted)), { message: "the layer to boot" }).toBe(true);
  await page.evaluate(() => window.__lahe.interactionBusy(50));
}

async function commentOn(page, text, note) {
  await page.evaluate((words) => {
    const p = Array.from(document.querySelectorAll("p")).find((one) => one.textContent.trim() === words);
    const range = document.createRange();
    range.selectNodeContents(p);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }, text);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await expect.poll(() => page.evaluate(() => !!window.__lahe.focusedBoxQuote()), { message: "the comment box to open" }).toBe(true);
  await page.keyboard.type(note);
  await page.keyboard.press("ControlOrMeta+Enter");
}

/** The agent's handled reply, folded into the log as the helper folds one. */
function answerHandled(reviewId, item) {
  counter += 1;
  world.helper.log.append(reviewId, [protocol.newEvent({
    event: protocol.EVENT.REPLY_FOLDED,
    event_id: "ev_move_browser_" + counter, review: reviewId, item: item.id, rev: item.rev,
    payload: {
      accepted: true,
      state: record.STATE.HANDLED,
      file: "replies-claude.jsonl",
      reply: { status: "handled", agent: "claude", reason: null, text: "Done before the move.", files: [] }
    }
  })]);
}

/** Active and Done counts as the rail's tabs show them. */
function counts(page) {
  return page.evaluate(() => {
    const pane = window.__lahe.rail.tabBody("active");
    const tabs = Array.from(pane.getRootNode().querySelectorAll('[role="tab"]'));
    const count = (name) => {
      const tab = tabs.find((t) => t.getAttribute("data-tab") === name);
      const node = tab ? tab.querySelector(".count") : null;
      return node ? node.textContent : "0";
    };
    return { active: count("active"), done: count("done") };
  });
}

function lostOf(page, id) {
  return page.evaluate((itemId) => {
    const found = window.__lahe.items().find((item) => item.id === itemId);
    return found ? (found.region && found.region.lost) || null : "no such item";
  }, id);
}

/**
 * One CLI run against this worker's helper and state folder. Never a sync
 * run: the helper answers from this process, so a blocked event loop leaves
 * the CLI waiting on it until the CLI starts a helper of its own.
 */
async function lahe(args) {
  const env = Object.assign({}, process.env, { LAHE_HOME_DIR: world.home });
  delete env.LAHE_STATE_DIR;
  delete env.XDG_STATE_HOME;
  const out = await promisify(execFile)(process.execPath, [CLI].concat(args, ["--state-dir", world.state, "--port", String(world.helper.port)]), {
    cwd: REPO_ROOT,
    env: env,
    encoding: "utf8",
    timeout: 30000
  });
  return out.stdout;
}

/**
 * A brief at ws/projects/reports/x/brief.html, served from a site rooted at
 * ws/projects: two comments made in the browser at that address, the second
 * answered handled.
 */
async function reviewedBrief(page) {
  const oldFolder = path.join(world.home, "ws", "projects", "reports", "x");
  const newFolder = path.join(world.home, "ws", "docs", "reports", "x");
  const oldFile = writeFile(oldFolder, "brief.html", HTML);
  const session = agentSessions.createStore({ dir: world.state }).create({ name: "Researcher" }).id;
  const review = world.helper.reviews.create({ target_path: oldFile, agent_session_id: session, origins: ["null"] });
  const oldSite = world.helper.sites.bind({ root: path.join(world.home, "ws", "projects"), mode: "folder", entry: "reports/x/brief.html" });
  world.helper.reviews.stampServed(review.id);

  await page.goto(origin(oldSite.name) + "/reports/x/brief.html");
  await booted(page);
  await commentOn(page, FIRST, "an open card");
  await commentOn(page, SECOND, "a card the agent answered");
  await expect.poll(() => page.evaluate(() => window.__lahe.handle.sync.status().counters.acknowledged), { message: "the helper to take both" }).toBeGreaterThanOrEqual(2);
  const items = await page.evaluate(() => window.__lahe.items().map((item) => ({ id: item.id, rev: item.rev, note: item.note })));
  const open = items.find((one) => one.note === "an open card");
  const done = items.find((one) => one.note === "a card the agent answered");
  answerHandled(review.id, done);
  await page.goto("about:blank");

  return {
    oldFolder, newFolder, oldFile, session, review, oldSite, open, done,
    newFile: path.join(newFolder, "brief.html"),
    /** mv the folder, and leave a link at the old one when asked. */
    move(options) {
      fs.mkdirSync(path.dirname(newFolder), { recursive: true });
      fs.renameSync(oldFolder, newFolder);
      if (options && options.symlink) fs.symlinkSync(newFolder, oldFolder);
    },
    /** What the agent runs after the move. Returns the address it printed. */
    async carry() {
      const out = await lahe(["review", path.join(newFolder, "brief.html"), "--session", session, "--review", review.id]);
      const opened = /^\s*open\s+(\S+)/m.exec(out);
      expect(opened, "`lahe review` printed the new address").toBeTruthy();
      return opened[1];
    }
  };
}

/** The new address shows the old cards, open and done, each on its words. */
async function expectCarried(page, w, url) {
  await page.goto(url);
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(w.review.id);
  await expect.poll(() => counts(page), { message: "the old cards at the new address" }).toEqual({ active: "1", done: "1" });
  await expect.poll(() => lostOf(page, w.open.id), { message: "the open card on its words" }).toBe(null);
  await expect.poll(() => lostOf(page, w.done.id), { message: "the done card on its words" }).toBe(null);
}

test("a plain move: lahe review --review on the new path, and the rail shows Active 1 and Done 1 on their words", async ({ page }) => {
  const w = await reviewedBrief(page);
  w.move();
  const url = await w.carry();
  expect(new URL(url).hostname).not.toBe(w.oldSite.name + ".lahe.localhost");
  await expectCarried(page, w, url);
  if (SHOT_DIR) {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await booted(page);
      await expect.poll(() => counts(page)).toEqual({ active: "1", done: "1" });
      await page.screenshot({ path: path.join(SHOT_DIR, "moved_rail_" + scheme + ".png") });
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
});

test("Ken's case: a link left at the old folder; the new address shows both cards, and the old address goes there", async ({ page }) => {
  const w = await reviewedBrief(page);
  w.move({ symlink: true });
  const url = await w.carry();
  await expectCarried(page, w, url);
  await page.goto(origin(w.oldSite.name) + "/reports/x/brief.html");
  expect(page.url()).toBe(url);
  await booted(page);
  await expect.poll(() => counts(page), { message: "the old cards after the redirect" }).toEqual({ active: "1", done: "1" });
});
