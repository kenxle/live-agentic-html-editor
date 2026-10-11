// Every helper module agrees on page-to-file mapping at a stable address
// (stable addresses, Step 2), in a real browser.
//
// Plan rows: V27 (an agent's edit to one page of a multi-page review reloads
// that page, and only that page), V29 (a linked document rides the linking
// review's rail, and review.json names its file), V31 (a review created on a
// random port carries its old address on the tag, and review.json groups its
// old comments with the new address), and the Step 2 step test: an agent edit
// reloads the page, the handled check reads the right file, and no served HTML
// file changes on disk after a poll. The rail showing the old comments is not
// proved here: see "Blocked" under Step 2 in the progress file.
//
// The helper runs in this worker on free ports and a temp state folder, with
// the switch on. Teardown closes it even when a test fails.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const service = require("../../src/service/index.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const staticServers = require("../../src/service/static_servers.js");
const stateDir = require("../../src/service/state_dir.js");
const handledCheck = require("../../src/service/handled_check.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");

const OLD_PORT = 51234;
let world = null;
let eventCounter = 0;

function writeFile(base, rel, contents) {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

/** Rewrite a file the way an agent does, with a modification time clearly later. */
function agentWrites(file, contents) {
  fs.writeFileSync(file, contents);
  const later = new Date(Date.now() + 10000);
  fs.utimesSync(file, later, later);
}

function docHtml(edition, extra) {
  return "<!doctype html><html><head><title>Doc</title></head><body><h1 id=edition>" + edition +
    "</h1><p id=body>the reviewed paragraph</p>" + (extra || "") + "</body></html>";
}

test.beforeEach(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-sa-mappers-")));
  const home = path.join(root, "home");
  const state = path.join(root, "state");
  fs.mkdirSync(home);
  const priorHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  const helper = await service.serve({ port: 0, stateDir: state, quiet: true, pages: "sites", pagesPort: 0, sitesHome: home });
  world = { root, home, state, helper, priorHome };
});

test.afterEach(async () => {
  if (!world) return;
  await world.helper.close();
  if (world.priorHome === undefined) delete process.env.LAHE_HOME_DIR;
  else process.env.LAHE_HOME_DIR = world.priorHome;
  world = null;
});

function newReview(spec) {
  const session = agentSessions.createStore({ dir: world.state }).create({ name: "mappers" }).id;
  return world.helper.reviews.create(Object.assign({ agent_session_id: session, origins: ["null"] }, spec));
}

function bindSite(root, entry) {
  const bound = world.helper.sites.bind({ root, mode: "folder", entry });
  return { name: bound.name, origin: protocol.siteOrigin(bound.name, world.helper.pagesPort) };
}

/** A page server record from before this feature, naming `root` on OLD_PORT. */
function oldPageServer(root) {
  const session = "s_before";
  const id = staticServers.serverId(root);
  stateDir.ensureStaticServersRoot(world.state, session);
  fs.writeFileSync(stateDir.staticServerPath(world.state, session, id), JSON.stringify({
    schema: 1, id, session_id: session, instance: "old", root, logical_root: root, host: "127.0.0.1",
    port: OLD_PORT, ports: [OLD_PORT], pid: 999999, started_at: "2026-09-01T00:00:00.000Z",
    stopped_at: "2026-09-01T01:00:00.000Z", stop_reason: "session closed", mounts: {}, linked_files: {}
  }));
}

/** An item the reviewer made, appended to the review's log as the helper would. */
function postItem(reviewId, fields) {
  const item = record.newItem(Object.assign({ state: record.STATE.READY, page_title: "Doc", page_seq: 1 }, fields));
  eventCounter += 1;
  world.helper.log.append(reviewId, [protocol.newEvent({
    event: protocol.EVENT.ITEM_READY,
    event_id: "ev_sa_mappers_" + eventCounter,
    review: reviewId,
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    page_path: item[record.FIELD.PAGE_PATH],
    page_title: item[record.FIELD.PAGE_TITLE],
    page_seq: item[record.FIELD.PAGE_SEQ],
    payload: { draft: false, record: item }
  })]);
  return item;
}

function reviewJson(reviewId) {
  try {
    return JSON.parse(fs.readFileSync(path.join(world.state, "reviews", reviewId, "review.json"), "utf8"));
  } catch (err) {
    return null;
  }
}

async function booted(page) {
  await expect.poll(() => page.evaluate(() => !!(window.__lahe && window.__lahe.booted)), {
    message: "the layer to boot from the injected script tag"
  }).toBe(true);
  await page.evaluate(() => window.__lahe.interactionBusy(50));
}

test("the Step 2 step test: a review from a random port, opened at its stable address", async ({ page }) => {
  const folder = path.join(world.home, "ws", "repo", "docs");
  const file = writeFile(folder, "page.html", docHtml("First edition"));
  const review = newReview({ target_path: file });
  oldPageServer(fs.realpathSync(folder));
  postItem(review.id, {
    kind: record.KIND.COMMENT,
    note: "a comment from the old address",
    page_origin: "http://127.0.0.1:" + OLD_PORT,
    page_path: "/page.html"
  });
  const site = bindSite(fs.realpathSync(folder), "page.html");
  const served = fs.readFileSync(file, "utf8");

  await page.goto(site.origin + "/page.html");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(review.id);

  // The tag carries the old address, so the layer reads a record made there
  // as made on this page (record.samePage). The rail itself is filled from
  // this browser's storage for this origin, which is empty at a new origin:
  // see "Blocked" under Step 2 in the progress file.
  expect(await page.evaluate(() => window.__lahe.page().aliases)).toEqual([
    "http://127.0.0.1:" + OLD_PORT,
    "http://localhost:" + OLD_PORT
  ]);

  // review.json groups the old address with the new one, under the new one.
  const newOne = postItem(review.id, { kind: record.KIND.COMMENT, note: "a comment here", page_origin: site.origin, page_path: "/page.html" });
  await expect.poll(() => {
    const json = reviewJson(review.id);
    if (!json) return null;
    return json.pages.map((p) => p.origin + p.path + ":" + p.items.length).join(",");
  }, { message: "review.json to group both addresses as one page", timeout: 20000 }).toBe(site.origin + "/page.html:2");
  expect(newOne.note).toBe("a comment here");

  // No served HTML file changes on disk after a poll.
  await expect.poll(() => page.evaluate(() => window.__lahe.handle.sync.status().counters.polls), {
    message: "a few polls to land"
  }).toBeGreaterThan(2);
  expect(fs.readFileSync(file, "utf8")).toBe(served);

  // An agent edit reloads the page.
  agentWrites(file, docHtml("Second edition"));
  await expect.poll(() => page.evaluate(() => document.querySelector("#edition") && document.querySelector("#edition").textContent), {
    message: "the page to reload onto the agent's edit",
    timeout: 20000
  }).toBe("Second edition");
  expect(fs.readFileSync(file, "utf8"), "and nothing was written into it").toBe(docHtml("Second edition"));

  // The handled check reads the right file: the page this item was made on.
  const edit = record.newItem({
    kind: record.KIND.EDIT, state: record.STATE.READY, page_origin: site.origin, page_path: "/page.html", page_title: "Doc", page_seq: 1
  });
  edit[record.FIELD.BEFORE] = "First edition";
  edit[record.FIELD.AFTER] = "Second edition";
  edit[record.FIELD.UPDATED_AT] = new Date(Date.now() + 60000).toISOString();
  expect(handledCheck.createHandledCheck({ dir: world.state }).pageShows(review.id, edit)).toBe(true);
});

test("V27: an agent's edit to one page of a multi-page review reloads that page, and an edit to another does not", async ({ page }) => {
  const folder = path.join(world.home, "ws", "site", "pages");
  const index = writeFile(folder, "index.html", docHtml("Index one"));
  const two = writeFile(folder, "two.html", docHtml("Two one"));
  newReview({ target_path: folder });
  const site = bindSite(fs.realpathSync(folder), "index.html");
  await page.goto(site.origin + "/two.html");
  await booted(page);
  await expect.poll(() => page.evaluate(() => !!window.__lahe.handle.sync.status().targetMtime), {
    message: "the first poll to set the baseline"
  }).toBe(true);
  await page.evaluate(() => { window.__stillHere = true; });

  agentWrites(index, docHtml("Index two"));
  const polls = await page.evaluate(() => window.__lahe.handle.sync.status().counters.polls);
  await expect.poll(() => page.evaluate(() => window.__lahe.handle.sync.status().counters.polls), {
    message: "a few more polls after the other page's edit"
  }).toBeGreaterThan(polls + 2);
  expect(await page.evaluate(() => window.__stillHere === true), "another page's edit does not reload this one").toBe(true);

  agentWrites(two, docHtml("Two two"));
  await expect.poll(() => page.evaluate(() => document.querySelector("#edition") && document.querySelector("#edition").textContent), {
    message: "this page to reload onto its own edit",
    timeout: 20000
  }).toBe("Two two");
});

test("V29: a linked document rides the linking review's rail, and review.json names its file", async ({ page }) => {
  const folder = path.join(world.home, "ws", "repo", "notes");
  const far = writeFile(world.home, "ws/other/far.md", "# Far document\n\nThe far side.\n");
  const doc = writeFile(folder, "doc.md", "# The doc\n\nSee [the far one](../../other/far.md).\n");
  const review = newReview({ target_path: path.join(world.state, "artifact-doc.html"), source_path: doc });
  const site = bindSite(fs.realpathSync(folder), "doc.md");
  await page.goto(site.origin + "/doc.md");
  await booted(page);
  await page.getByText("the far one").click();
  await expect(page.locator("h1")).toHaveText("Far document");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(review.id);
  const linkedPath = new URL(page.url()).pathname;
  postItem(review.id, { kind: record.KIND.COMMENT, note: "on the far one", page_origin: site.origin, page_path: linkedPath });
  await expect.poll(() => {
    const json = reviewJson(review.id);
    const group = json && json.pages.find((p) => p.path === linkedPath);
    return group ? group.linked_file : null;
  }, { message: "review.json to name the linked file", timeout: 20000 }).toBe(fs.realpathSync(far));
});
