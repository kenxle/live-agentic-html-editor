// A review follows its document out of a removed worktree, in a real browser
// (docs/features/20261015.01_review_follows_document/01_spec_review_follows_document.md).
//
//  - from the worktree: two comments made on the worktree's page, one answered
//    handled; the worktree is removed and the main copy served in the same
//    review; the main copy's rail shows Active 1 and Done 1, both cards on
//    their words;
//  - from the old address: a page load follows the redirect and lands on the
//    main copy with the same counts;
//  - Ken's state: a newer, empty review on the main copy and the old review
//    re-attached by hand; the old review wins and its cards show;
//  - a main copy whose text changed under one card: that card says it cannot
//    find its words, the other is on its words.
//
// Screenshots, light and dark, of the main copy's rail and the Library row when
// LAHE_SCREENSHOT_DIR is set.
//
// The helper runs in this worker on free ports and a temp state folder.
// Teardown closes it even when a test fails. The worktree is "removed" by
// moving it and git's admin folder aside: nothing is deleted.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const service = require("../../src/service/index.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");

const SHOT_DIR = process.env.LAHE_SCREENSHOT_DIR || null;
const FIRST = "The first paragraph the reviewer read closely.";
const SECOND = "The second paragraph the reviewer read closely.";
const WT_TEXT = "# Progress\n\n" + FIRST + "\n\n" + SECOND + "\n";
const MAIN_TEXT = WT_TEXT + "\nA line the merge added.\n";
const REL = path.join("docs", "features", "x");

let world = null;
let counter = 0;

test.beforeEach(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-follow-")));
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
    event_id: "ev_follow_browser_" + counter, review: reviewId, item: item.id, rev: item.rev,
    payload: {
      accepted: true,
      state: record.STATE.HANDLED,
      file: "replies-claude.jsonl",
      reply: { status: "handled", agent: "claude", reason: null, text: "Done in the worktree.", files: [] }
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
 * A main checkout and a worktree of it, git's links both ways, a Markdown
 * page reviewed in the worktree: two comments made in the browser, the second
 * answered handled.
 */
async function reviewedInWorktree(page) {
  const main = path.join(world.home, "ws", "repo");
  const admin = path.join(main, ".git", "worktrees", "feature");
  fs.mkdirSync(admin, { recursive: true });
  const wt = path.join(world.home, "ws", "repo-wt", "feature");
  writeFile(wt, ".git", "gitdir: " + admin + "\n");
  writeFile(admin, "gitdir", path.join(wt, ".git") + "\n");
  const wtFile = writeFile(path.join(wt, REL), "progress.md", WT_TEXT);
  const mainFile = writeFile(path.join(main, REL), "progress.md", MAIN_TEXT);
  const session = agentSessions.createStore({ dir: world.state }).create({ name: "Builder" }).id;
  const review = world.helper.reviews.create({
    target_path: path.join(world.state, "artifact-progress.html"),
    source_path: wtFile,
    agent_session_id: session,
    origins: ["null"]
  });
  const oldSite = world.helper.sites.bind({ root: path.join(wt, REL), mode: "folder", entry: "progress.md" });
  world.helper.reviews.stampServed(review.id);

  await page.goto(origin(oldSite.name) + "/progress.md");
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
    main, wt, admin, wtFile, mainFile, session, review, oldSite, open, done,
    /** git worktree remove: the worktree and its admin folder go (moved aside). */
    remove() {
      fs.renameSync(wt, wt + "-removed");
      fs.renameSync(admin, admin + "-removed");
    },
    /** What `lahe review <main copy> --session <owner>` does: record the main path, bind its folder. */
    serveMain() {
      world.helper.reviews.recordPaths(review.id, { source_path: mainFile });
      return world.helper.sites.bind({ root: path.join(main, REL), mode: "folder", entry: "progress.md" });
    }
  };
}

test("from the worktree: the main copy's rail shows the earlier cards, open and done, on their words", async ({ page }) => {
  const w = await reviewedInWorktree(page);
  w.remove();
  const mainSite = w.serveMain();
  await page.goto(origin(mainSite.name) + "/progress.md");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(w.review.id);
  await expect.poll(() => counts(page), { message: "the old cards on the main copy" }).toEqual({ active: "1", done: "1" });
  await expect.poll(() => lostOf(page, w.open.id), { message: "the open card on its words" }).toBe(null);
  await expect.poll(() => lostOf(page, w.done.id), { message: "the done card on its words" }).toBe(null);
  if (SHOT_DIR) {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await booted(page);
      await expect.poll(() => counts(page)).toEqual({ active: "1", done: "1" });
      await page.screenshot({ path: path.join(SHOT_DIR, "main_copy_rail_" + scheme + ".png") });
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
});

test("from the old address: a page load follows the redirect and lands on the main copy with the same cards", async ({ page }) => {
  const w = await reviewedInWorktree(page);
  w.remove();
  const mainSite = w.serveMain();
  await page.goto(origin(w.oldSite.name) + "/progress.md");
  expect(page.url()).toBe(origin(mainSite.name) + "/progress.md");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(w.review.id);
  await expect.poll(() => counts(page), { message: "the old cards after the redirect" }).toEqual({ active: "1", done: "1" });
});

test("Ken's state: a newer empty review on the main copy, the old one re-attached by hand; the old review's cards show", async ({ page }) => {
  const w = await reviewedInWorktree(page);
  w.remove();
  // `lahe review <main copy>` before this change made a second review.
  const newer = world.helper.reviews.create({
    target_path: path.join(world.state, "artifact-progress-main.html"),
    source_path: w.mainFile,
    agent_session_id: w.session,
    origins: ["null"]
  });
  const mainSite = world.helper.sites.bind({ root: path.join(w.main, REL), mode: "folder", entry: "progress.md" });
  world.helper.reviews.stampServed(newer.id);
  // Then the old review re-attached with --review: it records the main path.
  world.helper.reviews.recordPaths(w.review.id, { source_path: w.mainFile });
  world.helper.reviews.stampServedByHelper(newer.id, new Date(Date.now() + 60000).toISOString());
  await page.goto(origin(mainSite.name) + "/progress.md");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(w.review.id);
  await expect.poll(() => counts(page), { message: "the old cards in Ken's state" }).toEqual({ active: "1", done: "1" });
});

test("a main copy whose text changed under one card: that card cannot find its words, the other is on its words", async ({ page }) => {
  const w = await reviewedInWorktree(page);
  w.remove();
  fs.writeFileSync(w.mainFile, MAIN_TEXT.replace(FIRST, "A paragraph the branch rewrote completely before it merged."));
  const mainSite = w.serveMain();
  await page.goto(origin(mainSite.name) + "/progress.md");
  await booted(page);
  await expect.poll(() => counts(page), { message: "both cards come over" }).toEqual({ active: "1", done: "1" });
  await expect.poll(() => lostOf(page, w.open.id), { message: "the card whose words changed says so" }).not.toBe(null);
  await expect.poll(() => lostOf(page, w.done.id), { message: "the other card is on its words" }).toBe(null);
});

test("the Library shows the moved document once, marked as moved, and Open lands on the main copy with its cards", async ({ page }) => {
  const w = await reviewedInWorktree(page);
  w.remove();
  await page.goto("http://library.lahe.localhost:" + world.helper.pagesPort + "/catalog");
  const note = page.getByText("Moved from a worktree that is gone. Your comments came with it.");
  await expect(note).toHaveCount(1);
  if (SHOT_DIR) {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({ path: path.join(SHOT_DIR, "library_moved_row_" + scheme + ".png"), fullPage: true });
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
  const [opened] = await Promise.all([
    page.context().waitForEvent("page"),
    page.locator('[data-act="open"]').first().click()
  ]);
  // The Library opens a blank tab first and then sends it to the address.
  await opened.waitForURL(/\/progress\.md$/);
  await opened.waitForLoadState();
  await booted(opened);
  expect(await opened.evaluate(() => window.__lahe.review)).toBe(w.review.id);
  expect(new URL(opened.url()).hostname).not.toBe(w.oldSite.name + ".lahe.localhost");
  await expect.poll(() => counts(opened), { message: "the old cards from the Library's Open" }).toEqual({ active: "1", done: "1" });
});
