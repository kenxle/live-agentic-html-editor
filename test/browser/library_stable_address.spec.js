// The Library with stable addresses, in a real browser (stable addresses,
// Tasks 4.1 and 4.2).
//
// Plan rows: V39 (Open on an old row binds and opens its stable address, and
// the page that opens has its rail), V40 (Open on an older row leaves a newer
// open review's rail alone and the row says which review holds it), V43 (the
// Library loads at library.lahe.localhost, and 127.0.0.1 still works), V44
// (the Library's Copy button works with the clipboard API removed). It also
// takes the light and dark screenshots of the Library when LAHE_SCREENSHOT_DIR
// is set.
//
// The helper runs in this worker on free ports and a temp state folder, with
// the switch on. Every name under .lahe.localhost resolves to loopback in each
// browser with no flag (the Task 1.0 spike). Teardown closes the helper even
// when a test fails.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const service = require("../../src/service/index.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const markdown = require("../../src/service/markdown.js");

const SHOT_DIR = process.env.LAHE_SCREENSHOT_DIR || null;
const PAGE_HTML = (title) =>
  "<!doctype html><html><head><title>" + title + "</title></head><body><h1>" + title + "</h1><p>Words to review.</p></body></html>";

function writeFile(base, rel, contents) {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

let world = null;

test.beforeEach(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-sa-library-")));
  const home = path.join(root, "home");
  const state = path.join(root, "state");
  fs.mkdirSync(home);
  const priorHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  const helper = await service.serve({ port: 0, stateDir: state, quiet: true, pages: "sites", pagesPort: 0, sitesHome: home });
  const store = agentSessions.createStore({ dir: state });
  world = { root, home, state, helper, store, priorHome };
});

test.afterEach(async () => {
  if (!world) return;
  await world.helper.close();
  if (world.priorHome === undefined) delete process.env.LAHE_HOME_DIR;
  else process.env.LAHE_HOME_DIR = world.priorHome;
  world = null;
});

function libraryUrl() {
  return "http://library.lahe.localhost:" + world.helper.pagesPort + "/catalog";
}

function review(session, target, extra) {
  return world.helper.reviews.create(Object.assign({ agent_session_id: session, target_path: target, origins: ["null"] }, extra || {}));
}

async function loaded(page) {
  await expect(page.locator("#lahe-catalog-main .lib-section").first()).toBeVisible();
  await page.evaluate(() => window.__laheCatalogPollNow());
}

function rowOf(page, id) {
  return page.locator('li[data-review="' + id + '"]');
}

/** A scene for the screenshots: one project's documents in two sessions. */
function scene() {
  const repo = path.join(world.home, "ws", "live-agentic-html-editor");
  // A repository, so the rows show their path from its root.
  fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
  const mockups = path.join(repo, "docs", "features", "stable-addresses", "mockups");
  const ongoing = path.join(repo, "docs", "ongoing");
  world.store.create({ id: "s_build", name: "Stable addresses, the Library" });
  world.store.create({ id: "s_notes", name: "Notes and drafts" });
  const home = writeFile(mockups, "library.html", PAGE_HTML("Library mockup"));
  const pages = writeFile(mockups, "unknown_name.html", PAGE_HTML("Unknown name page"));
  const md = writeFile(ongoing, "LIBRARY.md", "# The Library\n\nHow the Library works now.\n");
  // The rendered copy the CLI wrote when it first reviewed the Markdown, which
  // is what vouches for the folder Open will serve.
  const artifactPath = markdown.artifactPath(world.state, "s_notes", md);
  const artifact = writeFile(path.dirname(artifactPath), path.basename(artifactPath), PAGE_HTML("The Library"));
  const txt = writeFile(path.join(repo, "notes"), "scratch.txt", "not a page");
  const a = review("s_build", home);
  const b = review("s_build", pages);
  const c = review("s_notes", artifact, { source_path: md });
  const d = review("s_notes", txt);
  // Two of them already have names; the others get one on Open.
  world.helper.sites.bind({ root: fs.realpathSync(mockups), mode: "folder", entry: "library.html" });
  return { a, b, c, d, md, home, pages, txt };
}

test("V43: the Library loads at library.lahe.localhost with its rows, and at 127.0.0.1 as before", async ({ page }) => {
  const s = scene();
  await page.goto(libraryUrl());
  await loaded(page);
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
  await expect(rowOf(page, s.a.id)).toBeVisible();

  await page.goto("http://127.0.0.1:" + world.helper.port + "/catalog");
  await loaded(page);
  await expect(rowOf(page, s.a.id)).toBeVisible();
});

test("a link to the Library on a page from another origin opens it with its list loaded, in the same tab and in a new one", async ({ page, context }) => {
  const s = scene();
  const library = libraryUrl();
  // A page on another site, as a doc or an email's web view would be.
  await page.route("http://other-site.example/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<!doctype html><title>Elsewhere</title><p><a id="same" href="' + library + '">Library</a> ' +
        '<a id="blank" target="_blank" href="' + library + '">Library in a new tab</a></p>'
    })
  );
  await page.goto("http://other-site.example/notes");
  await page.locator("#same").click();
  await page.waitForURL(library);
  await expect(page.locator("#lahe-catalog-main .lib-section").first()).toBeVisible();
  await expect(rowOf(page, s.a.id)).toBeVisible();

  // target=_blank: the Library opens, and the page that linked to it has no handle on it.
  await page.goto("http://other-site.example/notes");
  const [popup] = await Promise.all([context.waitForEvent("page"), page.locator("#blank").click()]);
  await popup.waitForURL(library);
  await expect(popup.locator("#lahe-catalog-main .lib-section").first()).toBeVisible();
  await expect(rowOf(popup, s.a.id)).toBeVisible();
  expect(await popup.evaluate(() => window.opener), "COOP cuts the opener off").toBeNull();
  await popup.close();
});

test("V43: a document's own address never shows the Library", async ({ page }) => {
  const s = scene();
  const named = world.helper.sites.list()[0].name;
  const res = await page.goto("http://" + named + ".lahe.localhost:" + world.helper.pagesPort + "/catalog");
  expect(res.status()).toBe(404);
  await expect(page.locator('meta[name="lahe-catalog-token"]')).toHaveCount(0);
  expect(s.a.id).toBeTruthy();
});

test("V39: Open on an old row binds its site, opens the stable address in a new tab, and that page has the review's rail", async ({ page, context }) => {
  const s = scene();
  await page.goto(libraryUrl());
  await loaded(page);
  // The row for the Markdown review has no name yet: its address comes from Open.
  const row = rowOf(page, s.c.id);
  await expect(row).toBeVisible();
  expect(world.helper.sites.byRoot(fs.realpathSync(path.dirname(s.md)), "folder")).toBeNull();
  const [popup] = await Promise.all([context.waitForEvent("page"), row.locator('[data-act="open"]').click()]);
  await popup.waitForURL(/\.lahe\.localhost:\d+\/LIBRARY\.md$/);
  const bound = world.helper.sites.byRoot(fs.realpathSync(path.dirname(s.md)), "folder");
  expect(bound, "Open named the site").toBeTruthy();
  expect(popup.url()).toBe("http://" + bound.name + ".lahe.localhost:" + world.helper.pagesPort + "/LIBRARY.md");
  await expect(popup.locator("h1")).toHaveText("The Library");
  await expect
    .poll(() => popup.evaluate(() => !!(window.__lahe && window.__lahe.booted)), { message: "the layer to boot on the opened page" })
    .toBe(true);
  expect(await popup.evaluate(() => window.__lahe.review)).toBe(s.c.id);
  await popup.close();

  // The row now links to the same address.
  await page.evaluate(() => window.__laheCatalogPollNow());
  const link = row.locator(".lib-address a");
  await expect(link).toHaveAttribute("href", "http://" + bound.name + ".lahe.localhost:" + world.helper.pagesPort + "/LIBRARY.md");
  await expect(link).toHaveAttribute("rel", /noopener/);
});

test("V40: Open on an older row leaves a newer open review's rail alone, and the row says which review holds it", async ({ page, context }) => {
  const repo = path.join(world.home, "ws", "repo", "docs");
  const file = writeFile(repo, "shared.html", PAGE_HTML("Shared page"));
  world.store.create({ id: "s_old", name: "older session" });
  world.store.create({ id: "s_new", name: "newer session" });
  // The newer review is created second and its id sorts after, so it is the
  // newer even within one millisecond.
  const older = review("s_old", file, { id: "r-a-older" });
  const newer = review("s_new", file, { id: "r-b-newer" });
  world.helper.sites.bind({ root: fs.realpathSync(repo), mode: "folder", entry: "shared.html" });

  await page.goto(libraryUrl());
  await loaded(page);
  const row = rowOf(page, older.id);
  await expect(row).toBeVisible();
  const [popup] = await Promise.all([context.waitForEvent("page"), row.locator('[data-act="open"]').click()]);
  await popup.waitForURL(/shared\.html$/);
  await expect
    .poll(() => popup.evaluate(() => !!(window.__lahe && window.__lahe.booted)), { message: "the layer to boot on the opened page" })
    .toBe(true);
  expect(await popup.evaluate(() => window.__lahe.review), "the rail is the newer review's").toBe(newer.id);
  await popup.close();
  await expect(row.locator(".lib-note")).toContainText("Open did not move the chat bar");
});

test("V44: the Library's Copy button works with the clipboard API removed", async ({ page }) => {
  const s = scene();
  await page.addInitScript(() => {
    try { delete Navigator.prototype.clipboard; } catch (err) { /* below */ }
    try { Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true }); } catch (err) { /* gone already */ }
    window.__copied = [];
    document.addEventListener("copy", () => {
      const el = document.activeElement;
      window.__copied.push(el && typeof el.value === "string" ? el.value.slice(el.selectionStart, el.selectionEnd) : String(window.getSelection()));
    }, true);
  });
  await page.goto(libraryUrl());
  await loaded(page);
  expect(await page.evaluate(() => typeof navigator.clipboard), "the control: the page really has no clipboard API").toBe("undefined");

  // A via-agent row with no agent attached offers the hand-off message to copy.
  const row = rowOf(page, s.d.id);
  await expect(row).toBeVisible();
  await row.locator('[data-act="handoff"]').click();
  const message = await row.locator(".lib-panel pre").innerText();
  expect(message.length).toBeGreaterThan(20);
  await row.locator('[data-act="copy"]').click();
  await expect(row.locator(".lib-copy-status")).toHaveText("Copied.");
  const copied = await page.evaluate(() => window.__copied);
  expect(copied).toEqual([message]);
  // The hidden field is gone.
  expect(await page.evaluate(() => document.querySelectorAll("textarea").length)).toBe(0);
});

test("screenshots: the Library with stable addresses, light and dark", async ({ page }) => {
  test.skip(!SHOT_DIR, "LAHE_SCREENSHOT_DIR is not set");
  const s = scene();
  // A row that was already opened through its address, so it shows one.
  world.helper.reviews.stampServed(s.a.id);
  await page.setViewportSize({ width: 1180, height: 900 });
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(libraryUrl());
    await loaded(page);
    await expect(rowOf(page, s.a.id).locator(".lib-address a")).toBeVisible();
    fs.mkdirSync(SHOT_DIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOT_DIR, "library_stable_addresses_" + scheme + ".png"), fullPage: true });
  }
});
