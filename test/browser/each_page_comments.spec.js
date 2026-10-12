// Each page carries its own comments, in a real browser
// (docs/features/20261011.02_stable_addresses/parts/architecture/
// each_page_its_own_comments.md).
//
//  - a comment made through a link shows once at the file's own address, and
//    stays one after a reload;
//  - the reverse: a comment at the file's own address shows when the file is
//    reached through a link (the page load is redirected there);
//  - a comment already split into another review shows read-only, in its own
//    list, with no way to write to it, and nothing is posted;
//  - a read-only card and an own item with the same id are both shown, with
//    edit controls only on the own one.
//
// The helper runs in this worker on free ports and a temp state folder.
// Teardown closes it even when a test fails.

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
const PAGE = "<!doctype html><html><head><title>Two</title></head><body><h1>Page two</h1><p id=body>The paragraph on page two.</p></body></html>";

let world = null;
let counter = 0;

test.beforeEach(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-each-page-")));
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

function session(name) {
  return agentSessions.createStore({ dir: world.state }).create({ name }).id;
}

function origin(name) {
  return protocol.siteOrigin(name, world.helper.pagesPort);
}

function postItem(reviewId, fields) {
  const item = record.newItem(Object.assign({ kind: record.KIND.COMMENT, state: record.STATE.READY, page_title: "Two", page_seq: 1 }, fields));
  counter += 1;
  world.helper.log.append(reviewId, [protocol.newEvent({
    event: protocol.EVENT.ITEM_READY, event_id: "ev_each_page_" + counter, review: reviewId, item: item.id, rev: item.rev,
    page_path: item.page_path, page_title: "Two", page_seq: 1, payload: { draft: false, record: item }
  })]);
  return item;
}

function logText(reviewId) {
  try { return fs.readFileSync(path.join(world.state, "reviews", reviewId, "events.jsonl"), "utf8"); } catch (err) { return ""; }
}

async function booted(page) {
  await expect.poll(() => page.evaluate(() => !!(window.__lahe && window.__lahe.booted)), { message: "the layer to boot" }).toBe(true);
  await page.evaluate(() => window.__lahe.interactionBusy(50));
}

async function commentOn(page, selector, text) {
  await page.evaluate((sel) => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector(sel));
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
  }, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await expect.poll(() => page.evaluate(() => !!window.__lahe.focusedBoxQuote()), { message: "the comment box to open" }).toBe(true);
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

/** A hub Markdown page in one folder that links to far.md in another, reviewed. */
async function linkWorld(page) {
  const notes = path.join(world.home, "ws", "repo", "notes");
  const other = path.join(world.home, "ws", "other");
  const far = writeFile(other, "far.md", "# Far\n\nThe far paragraph.\n");
  const hubFile = writeFile(notes, "hub.md", "# Hub\n\nSee [the far one](../../other/far.md).\n");
  const s1 = session("Hub agent");
  const hub = world.helper.reviews.create({ target_path: path.join(world.state, "artifact-hub.html"), source_path: hubFile, agent_session_id: s1, origins: ["null"] });
  const hubSite = world.helper.sites.bind({ root: fs.realpathSync.native(notes), mode: "folder", entry: "hub.md" });
  world.helper.reviews.stampServed(hub.id);
  return { far: fs.realpathSync.native(far), other: fs.realpathSync.native(other), hub, hubSite, s1 };
}

async function cardCount(page, id) {
  return page.evaluate((itemId) => window.__lahe.items().filter((item) => item.id === itemId).length, id);
}

test("a comment made through a link shows once at the file's own address, and stays one after a reload", async ({ page }) => {
  const w = await linkWorld(page);
  await page.goto(origin(w.hubSite.name) + "/hub.md");
  await booted(page);
  await page.getByText("the far one").click();
  await booted(page);
  expect(new URL(page.url()).pathname).toMatch(/^\/\.lahe-source\/[a-f0-9]+\/far\.md$/);
  await commentOn(page, "main p", "said through the link");
  await expect.poll(() => page.evaluate(() => window.__lahe.handle.sync.status().counters.acknowledged), { message: "the helper to take it" }).toBeGreaterThan(0);
  const id = (await page.evaluate(() => window.__lahe.items().map((item) => item.id)))[0];

  // The file gets its own address, in the hub's review (one review per file).
  world.helper.reviews.recordPaths(w.hub.id, { target_path: w.far });
  const own = world.helper.sites.bind({ root: w.other, mode: "folder", entry: "far.md" });
  const before = logText(w.hub.id);
  await page.goto(origin(own.name) + "/far.md");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(w.hub.id);
  await expect.poll(() => page.evaluate((itemId) => !!window.__lahe.rail.getCard(itemId), id), { message: "the card at its own address" }).toBe(true);
  expect(await cardCount(page, id)).toBe(1);
  await page.reload();
  await booted(page);
  await expect.poll(() => page.evaluate((itemId) => !!window.__lahe.rail.getCard(itemId), id), { message: "the card after a reload" }).toBe(true);
  expect(await cardCount(page, id)).toBe(1);
  expect(logText(w.hub.id), "nothing posted back").toBe(before);
});

test("the reverse: a comment at the file's own address shows when the file is reached through a link", async ({ page }) => {
  const w = await linkWorld(page);
  const farReview = world.helper.reviews.create({ target_path: w.far, agent_session_id: session("Far agent"), origins: ["null"] });
  const own = world.helper.sites.bind({ root: w.other, mode: "folder", entry: "far.md" });
  await page.goto(origin(own.name) + "/far.md");
  await booted(page);
  await commentOn(page, "main p", "said at its own address");
  await expect.poll(() => page.evaluate(() => window.__lahe.handle.sync.status().counters.acknowledged), { message: "the helper to take it" }).toBeGreaterThan(0);
  const id = (await page.evaluate(() => window.__lahe.items().map((item) => item.id)))[0];

  await page.goto(origin(w.hubSite.name) + "/hub.md");
  await booted(page);
  await page.getByText("the far one").click();
  await page.waitForURL(origin(own.name) + "/far.md");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(farReview.id);
  await expect.poll(() => page.evaluate((itemId) => !!window.__lahe.rail.getCard(itemId), id), { message: "its card" }).toBe(true);
  expect(await cardCount(page, id)).toBe(1);
  expect(logText(w.hub.id).indexOf("said at its own address"), "never in the hub's review").toBe(-1);
});

test("a comment already split into another review shows read-only in its own list, and nothing is posted", async ({ page }) => {
  const folder = path.join(world.home, "ws", "site", "pages");
  writeFile(folder, "index.html", PAGE);
  const two = writeFile(folder, "two.html", PAGE);
  const real = fs.realpathSync.native(folder);
  const folderReview = world.helper.reviews.create({ target_path: real, agent_session_id: session("Folder agent"), origins: ["null"] });
  const site = world.helper.sites.bind({ root: real, mode: "folder", entry: "index.html" });
  const old = postItem(folderReview.id, {
    page_origin: origin(site.name), page_path: "/two.html", note: "<b>Shorten</b> this paragraph.",
    before: "The paragraph on page two."
  });
  // From before one review per file: the page got its own review.
  const own = world.helper.reviews.create({ target_path: fs.realpathSync.native(two), agent_session_id: session("Page agent"), origins: ["null"] });
  const folderLog = logText(folderReview.id);
  const ownLog = logText(own.id);

  await page.goto(origin(site.name) + "/two.html");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(own.id);
  await expect.poll(() => page.evaluate(() => window.__lahe.handle.tab().otherCardCount()), { message: "the read-only card" }).toBe(1);
  expect(await page.evaluate(() => window.__lahe.items().length), "never in this review's store").toBe(0);
  expect(await page.evaluate(() => window.__lahe.handle.store.pendingCount(window.__lahe.review)), "nothing queued").toBe(0);
  const shown = await page.evaluate(() => window.__lahe.handle.tab().othersText());
  expect(shown).toContain("Folder agent");
  expect(shown, "markup is shown as text").toContain("<b>Shorten</b> this paragraph.");
  expect(shown).toContain("Library");
  expect(shown).not.toContain(folderReview.id);
  expect(shown).not.toContain(folderReview.agent_session_id);
  expect(await page.evaluate(() => window.__lahe.handle.tab().otherControlCount()), "no way to write to it").toBe(0);
  if (SHOT_DIR) {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.reload();
      await booted(page);
      await expect.poll(() => page.evaluate(() => window.__lahe.handle.tab().otherCardCount()), { message: "the card in " + scheme }).toBe(1);
      await page.screenshot({ path: path.join(SHOT_DIR, "read_only_card_" + scheme + ".png") });
    }
  }
  await expect.poll(() => page.evaluate(() => window.__lahe.handle.sync.status().counters.polls), { message: "a few polls" }).toBeGreaterThan(2);
  expect(logText(folderReview.id), "the other review's log is untouched").toBe(folderLog);
  expect(logText(own.id).indexOf(old.id), "and its item never entered this review").toBe(-1);
  expect(ownLog.length).toBeLessThanOrEqual(logText(own.id).length);
});

test("a read-only card and an own item with the same id are both shown, with edit controls only on the own one", async ({ page }) => {
  const folder = path.join(world.home, "ws", "site", "pages");
  writeFile(folder, "index.html", PAGE);
  const two = writeFile(folder, "two.html", PAGE);
  const real = fs.realpathSync.native(folder);
  const folderReview = world.helper.reviews.create({ target_path: real, agent_session_id: session("Folder agent"), origins: ["null"] });
  const site = world.helper.sites.bind({ root: real, mode: "folder", entry: "index.html" });
  const own = world.helper.reviews.create({ target_path: fs.realpathSync.native(two), agent_session_id: session("Page agent"), origins: ["null"] });
  const mine = postItem(own.id, { page_origin: origin(site.name), page_path: "/two.html", note: "mine" });
  const theirs = postItem(folderReview.id, { page_origin: origin(site.name), page_path: "/two.html", note: "theirs" });
  // The other review's item carries the same id as this review's own.
  const sameId = Object.assign({}, theirs, { id: mine.id });
  world.helper.log.append(folderReview.id, [protocol.newEvent({
    event: protocol.EVENT.ITEM_READY, event_id: "ev_same_id", review: folderReview.id, item: sameId.id, rev: sameId.rev,
    page_path: "/two.html", page_title: "Two", page_seq: 1, payload: { draft: false, record: sameId }
  })]);
  await page.goto(origin(site.name) + "/two.html");
  await booted(page);
  await expect.poll(() => page.evaluate(() => window.__lahe.handle.tab().otherCardCount()), { message: "the read-only cards" }).toBe(2);
  expect(await page.evaluate(() => window.__lahe.handle.tab().otherControlCount()), "no controls on the read-only cards").toBe(0);
  // The own item, taken in from the helper, is a card with its own controls.
  await expect.poll(() => page.evaluate((id) => !!window.__lahe.rail.getCard(id), mine.id), { message: "the own card" }).toBe(true);
  expect(await page.evaluate((id) => window.__lahe.itemById(id).note, mine.id)).toBe("mine");
});
