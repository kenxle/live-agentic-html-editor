// Every helper module agrees on page-to-file mapping at a stable address
// (stable addresses, Step 2), in a real browser.
//
// Plan rows: V27 (an agent's edit to one page of a multi-page review reloads
// that page, and only that page), V29 (a linked document rides the linking
// review's rail, and review.json names its file), V31 (a review created on a
// random port carries its old address on the tag, and review.json groups its
// old comments with the new address), V31 option A (a comment made at the old
// address shows as one card at the new one, stays one after a reload, and
// posts nothing back), and the Step 2 step test: an agent edit reloads the
// page, the handled check reads the right file, and no served HTML file
// changes on disk after a poll.
//
// The helper runs in this worker on free ports and a temp state folder, with
// the switch on. Teardown closes it even when a test fails.

"use strict";

const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const service = require("../../src/service/index.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const stateDir = require("../../src/service/state_dir.js");
const handledCheck = require("../../src/service/handled_check.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const scriptLine = require("../../src/shared/script_line.js");

const SHOT_DIR = process.env.LAHE_SCREENSHOT_DIR || null;

// The id the old page servers gave their record: a hash of the root.
function oldServerId(root) {
  return "ss_" + require("node:crypto").createHash("sha256").update(path.resolve(root)).digest("hex").slice(0, 16);
}

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

function newReview(spec) {
  const session = agentSessions.createStore({ dir: world.state }).create({ name: "mappers" }).id;
  return world.helper.reviews.create(Object.assign({ agent_session_id: session, origins: ["null"] }, spec));
}

function bindSite(root, entry) {
  const bound = world.helper.sites.bind({ root, mode: "folder", entry });
  return { name: bound.name, origin: protocol.siteOrigin(bound.name, world.helper.pagesPort) };
}

/** A page server record from before this feature, naming `root` on OLD_PORT (or `port`). */
function oldPageServer(root, port) {
  const at = port || OLD_PORT;
  const session = "s_before";
  const id = oldServerId(root);
  stateDir.ensureStaticServersRoot(world.state, session);
  fs.writeFileSync(stateDir.staticServerPath(world.state, session, id), JSON.stringify({
    schema: 1, id, session_id: session, instance: "old", root, logical_root: root, host: "127.0.0.1",
    port: at, ports: [at], pid: 999999, started_at: "2026-09-01T00:00:00.000Z",
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
  // The reload can land mid-evaluate; that read counts as "not yet".
  await expect.poll(() => page.evaluate(() => document.querySelector("#edition") && document.querySelector("#edition").textContent).catch(() => null), {
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
  // The reload this waits for can land mid-evaluate; that read counts as "not
  // yet", not as a failure.
  await expect.poll(() => page.evaluate(() => document.querySelector("#edition") && document.querySelector("#edition").textContent).catch(() => null), {
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

// --- V31, option A: the old comment comes over --------------------------------

/**
 * What an old page server was: a loopback port that served the folder with
 * the review's script line in each response. Stopped by the caller.
 */
async function oldAddress(folder, review) {
  const helperOrigin = "http://127.0.0.1:" + world.helper.port;
  const tag = protocol.scriptTag({
    src: helperOrigin + protocol.route("library.get").path,
    review: review.id,
    token: review.token,
    helper: helperOrigin
  });
  const server = http.createServer((req, res) => {
    const file = path.join(folder, decodeURIComponent(String(req.url).split("?")[0]));
    if (!file.startsWith(folder) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
    const html = scriptLine.placeScriptLine(fs.readFileSync(file, "utf8"), tag).html;
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: "http://127.0.0.1:" + server.address().port, port: server.address().port };
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

function eventsFor(reviewId, itemId) {
  return world.helper.log.read(reviewId).filter((event) => event.item === itemId).length;
}

test("V31: a comment made at the old address shows once as a card at the new one, stays one after a reload, and posts nothing back", async ({ page }) => {
  const folder = path.join(world.home, "ws", "repo", "docs");
  writeFile(folder, "page.html", docHtml("First edition"));
  const real = fs.realpathSync.native(folder);
  const session = agentSessions.createStore({ dir: world.state }).create({ name: "v31" }).id;
  const review = world.helper.reviews.create({ target_path: path.join(real, "page.html"), agent_session_id: session, origins: ["null"] });
  const old = await oldAddress(real, review);
  try {
    world.helper.reviews.registerOrigin(review.id, old.origin);

    // The reviewer comments at the old address, and the helper takes it.
    await page.goto(old.origin + "/page.html");
    await booted(page);
    await commentOn(page, "#body", "a comment made at the old address");
    await expect.poll(() => page.evaluate(() => window.__lahe.handle.sync.status().counters.acknowledged), {
      message: "the helper to take the comment"
    }).toBeGreaterThan(0);
    const made = await page.evaluate(() => window.__lahe.items().map((item) => item.id));
    expect(made).toHaveLength(1);
    const id = made[0];
    await expect.poll(() => eventsFor(review.id, id), { message: "the comment in the log" }).toBeGreaterThan(0);
    const before = eventsFor(review.id, id);

    // Stable addresses arrive: the old server is a record, the folder a site.
    oldPageServer(real, old.port);
    const site = bindSite(real, "page.html");

    await page.goto(site.origin + "/page.html");
    await booted(page);
    await expect.poll(() => page.evaluate((itemId) => !!window.__lahe.rail.getCard(itemId), id), {
      message: "the old comment to show as a card at the new address"
    }).toBe(true);
    expect(await page.evaluate((itemId) => window.__lahe.items().filter((item) => item.id === itemId).length, id)).toBe(1);
    expect(await page.evaluate(() => window.__lahe.items().length)).toBe(1);
    const card = await page.evaluate((itemId) => window.__lahe.rail.getCard(itemId).state, id);
    expect(card).toBe(record.STATE.READY);
    expect(await page.evaluate((itemId) => window.__lahe.itemById(itemId).note, id)).toBe("a comment made at the old address");

    // A reload shows it once again, from this origin's own storage now.
    await page.reload();
    await booted(page);
    await expect.poll(() => page.evaluate((itemId) => !!window.__lahe.rail.getCard(itemId), id), {
      message: "the card after a reload"
    }).toBe(true);
    expect(await page.evaluate(() => window.__lahe.items().length)).toBe(1);

    // Nothing was posted back: the log holds what it held, and nothing waits.
    await expect.poll(() => page.evaluate(() => window.__lahe.handle.sync.status().counters.polls), {
      message: "a few polls to pass"
    }).toBeGreaterThan(2);
    expect(eventsFor(review.id, id)).toBe(before);
    expect(await page.evaluate(() => window.__lahe.handle.store.pendingCount(window.__lahe.review))).toBe(0);

    // The card at the new address, in light and dark, each from a fresh load.
    if (SHOT_DIR) {
      for (const scheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.reload();
        await booted(page);
        await expect.poll(() => page.evaluate((itemId) => !!window.__lahe.rail.getCard(itemId), id), {
          message: "the card in " + scheme
        }).toBe(true);
        await page.screenshot({ path: path.join(SHOT_DIR, "v31_old_comment_card_" + scheme + ".png") });
      }
      expect(await page.evaluate(() => window.__lahe.items().length)).toBe(1);
      expect(eventsFor(review.id, id)).toBe(before);
    }
  } finally {
    await new Promise((resolve) => old.server.close(resolve));
  }
});
