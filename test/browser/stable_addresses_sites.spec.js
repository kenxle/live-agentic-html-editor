// Pages at their stable addresses, in a real browser (stable addresses, Task
// 1.3 and 1.4).
//
// Plan rows: V11 (a bound page loads at <name>.lahe.localhost with its rail,
// and says no agent is listening), V12 (relative images, styles and scripts,
// `../` inside a folder review), V13 (Markdown from source: images, and a link
// outside its folder through the site's mount), V16 (one site cannot read
// another, with a positive control), V20 (a gone worktree file shows the main
// checkout's copy read-only, with no script tag). It also takes the light and
// dark screenshots of the unknown-name and file-gone pages when
// LAHE_SCREENSHOT_DIR is set.
//
// The helper runs in this worker on free ports and a temp state folder, with
// the switch on. Every name resolves to loopback in each browser with no flag
// (the Task 1.0 spike). Teardown closes the helper even when a test fails.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect } = require("@playwright/test");

const service = require("../../src/service/index.js");
const agentSessions = require("../../src/service/agent_sessions.js");

const SHOT_DIR = process.env.LAHE_SCREENSHOT_DIR || null;
// A 2x2 opaque PNG, so naturalWidth proves the image really loaded.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==",
  "base64"
);

function writeFile(base, rel, contents) {
  const full = path.join(base, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return full;
}

let world = null;

test.beforeEach(async () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-sa-browser-")));
  const home = path.join(root, "home");
  const state = path.join(root, "state");
  fs.mkdirSync(home);
  const priorHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  const helper = await service.serve({
    port: 0,
    stateDir: state,
    quiet: true,
    pages: "sites",
    pagesPort: 0,
    sitesHome: home
  });
  world = { root, home, state, helper, priorHome };
});

test.afterEach(async () => {
  if (!world) return;
  await world.helper.close();
  if (world.priorHome === undefined) delete process.env.LAHE_HOME_DIR;
  else process.env.LAHE_HOME_DIR = world.priorHome;
  world = null;
});

/** A review in a session with no agent watching, bound to its site. */
function bind(target, root, entry, extra) {
  const store = agentSessions.createStore({ dir: world.state });
  const session = store.create({ name: "browser test" }).id;
  const review = world.helper.reviews.create(Object.assign({ target_path: target, agent_session_id: session, origins: ["null"] }, extra || {}));
  const bound = world.helper.sites.bind({ root, mode: "folder", entry });
  world.helper.reviews.stampServed(review.id);
  return { review, name: bound.name, origin: "http://" + bound.name + ".lahe.localhost:" + world.helper.pagesPort };
}

async function booted(page) {
  await expect.poll(() => page.evaluate(() => !!(window.__lahe && window.__lahe.booted)), {
    message: "the layer to boot from the injected script tag"
  }).toBe(true);
}

test("V11: a bound HTML page loads at its .lahe.localhost address with its rail, and says no agent is listening", async ({ page }) => {
  const folder = path.join(world.home, "ws", "repo", "docs");
  const file = writeFile(folder, "page.html", "<!doctype html><html><head><title>Brief</title></head><body><h1>Brief</h1><p>Reviewed words.</p></body></html>");
  const site = bind(file, folder, "page.html");
  await page.goto(site.origin + "/page.html");
  await expect(page.locator("h1")).toHaveText("Brief");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(site.review.id);
  await expect.poll(() => page.evaluate(() => window.__lahe.status()), { message: "the rail to read stored" }).toBe("stored");
  await expect
    .poll(() => page.evaluate(() => window.__lahe.rail.statusLine().text), { message: "the line to say no agent is listening" })
    .toContain("no agent listening");
  expect(await page.evaluate(() => window.isSecureContext)).toBe(true);
});

test("V12: relative images, styles and scripts load, including ../ inside a folder review", async ({ page }) => {
  const folder = path.join(world.home, "ws", "site", "www");
  writeFile(folder, "img/dot.png", PNG);
  writeFile(folder, "css/site.css", "p.styled { color: rgb(1, 2, 3); }");
  writeFile(folder, "js/site.js", "window.siteScriptRan = true;");
  writeFile(folder, "pages/one.html",
    "<!doctype html><html><head><title>One</title><link rel=stylesheet href=\"../css/site.css\"><script src=\"../js/site.js\"></script></head>" +
    "<body><p class=styled>styled</p><img id=dot src=\"../img/dot.png\"></body></html>");
  writeFile(folder, "index.html", "<!doctype html><title>Index</title><p>index</p>");
  const site = bind(folder, folder, "index.html");
  await page.goto(site.origin + "/pages/one.html");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(site.review.id);
  await expect.poll(() => page.evaluate(() => document.getElementById("dot").naturalWidth)).toBe(2);
  expect(await page.evaluate(() => getComputedStyle(document.querySelector("p.styled")).color)).toBe("rgb(1, 2, 3)");
  expect(await page.evaluate(() => window.siteScriptRan === true)).toBe(true);
});

test("V13: a Markdown page renders from source, its image loads, and a link outside its folder opens through the site's mount with the rail", async ({ page }) => {
  const folder = path.join(world.home, "ws", "repo", "notes");
  writeFile(folder, "pic.png", PNG);
  writeFile(world.home, "ws/other/far.md", "# Far document\n\nThe far side.\n");
  const doc = writeFile(folder, "doc.md", "# The doc\n\n![a dot](pic.png)\n\nSee [the far one](../../other/far.md).\n");
  const site = bind(path.join(world.state, "artifact-doc.html"), folder, "doc.md", { source_path: doc });
  await page.goto(site.origin + "/doc.md");
  await expect(page.locator("h1")).toHaveText("The doc");
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(site.review.id);
  await expect.poll(() => page.evaluate(() => document.querySelector("img").naturalWidth)).toBe(2);
  await page.getByText("the far one").click();
  await expect(page.locator("h1")).toHaveText("Far document");
  expect(new URL(page.url()).origin).toBe(site.origin);
  expect(new URL(page.url()).pathname).toMatch(/^\/\.lahe-source\/[a-f0-9]+\/far\.md$/);
  await booted(page);
  expect(await page.evaluate(() => window.__lahe.review)).toBe(site.review.id);
});

test("V16: a page on site A cannot fetch a page or token from site B, while the same fetch from site B succeeds", async ({ page }) => {
  const a = path.join(world.home, "ws", "alpha", "docs");
  const b = path.join(world.home, "ws", "beta", "docs");
  const fileA = writeFile(a, "a.html", "<!doctype html><title>A</title><p>alpha</p>");
  const fileB = writeFile(b, "b.html", "<!doctype html><title>B</title><p>beta secret</p>");
  const siteA = bind(fileA, a, "a.html");
  const siteB = bind(fileB, b, "b.html");
  const target = siteB.origin + "/b.html";
  async function attempt() {
    return page.evaluate(async (url) => {
      const out = {};
      try {
        const res = await fetch(url);
        const text = await res.text();
        out.cors = /data-lahe-token/.test(text) ? "token" : (/beta secret/.test(text) ? "page" : "other");
      } catch (err) {
        out.cors = "blocked";
      }
      try {
        await fetch(url, { mode: "no-cors" });
        out.noCors = "loaded";
      } catch (err) {
        out.noCors = "blocked";
      }
      return out;
    }, target);
  }
  await page.goto(siteA.origin + "/a.html");
  const fromA = await attempt();
  expect(fromA.cors).toBe("blocked");
  expect(fromA.noCors, "Cross-Origin-Resource-Policy refuses the opaque read too").toBe("blocked");
  // The positive control: the same fetch, from site B itself.
  await page.goto(siteB.origin + "/b.html");
  const fromB = await attempt();
  expect(fromB.cors).toBe("token");
  expect(fromB.noCors).toBe("loaded");
});

test("V20: a gone worktree file shows the main checkout's copy read-only, with the moved note and no script tag", async ({ page }) => {
  const main = path.join(world.home, "ws", "repo");
  fs.mkdirSync(path.join(main, ".git", "worktrees", "feature"), { recursive: true });
  writeFile(main, "docs/page.html", "<!doctype html><title>Main copy</title><h1>From the main checkout</h1>");
  const worktree = path.join(world.home, "ws", "repo-wt", "feature");
  writeFile(worktree, ".git", "gitdir: " + path.join(main, ".git", "worktrees", "feature") + "\n");
  const docs = path.join(worktree, "docs");
  const file = writeFile(docs, "page.html", "<!doctype html><title>Worktree copy</title><h1>From the worktree</h1>");
  const site = bind(file, docs, "page.html");
  await page.goto(site.origin + "/page.html");
  await booted(page);
  // The worktree is removed (moved out of the way here, so nothing is deleted).
  fs.renameSync(worktree, worktree + "-removed");
  await page.goto(site.origin + "/page.html");
  await expect(page.locator("h1")).toHaveText("From the main checkout");
  await expect(page.locator(".lahe-moved-note")).toContainText("worktree is gone");
  await expect(page.locator(".lahe-moved-note")).toContainText(path.join(main, "docs", "page.html"));
  expect(await page.evaluate(() => document.querySelectorAll("script[data-lahe-review]").length)).toBe(0);
  expect(await page.evaluate(() => !!window.__lahe)).toBe(false);
});

test("Open the Library on the unknown-name and file-gone pages opens the Library in one click", async ({ page }) => {
  const folder = path.join(world.home, "ws", "repo", "docs");
  const file = writeFile(folder, "page.html", "<!doctype html><title>x</title><p>x</p>");
  const site = bind(file, folder, "page.html");
  for (const start of ["http://no-such.docs.lahe.localhost:" + world.helper.pagesPort + "/brief.md", site.origin + "/old-brief.html"]) {
    await page.goto(start);
    const [library] = await Promise.all([
      page.waitForResponse((res) => res.url().endsWith("/catalog")),
      page.getByRole("link", { name: "Open the Library" }).click()
    ]);
    expect(library.status(), "the Library page answered " + start + "'s link").toBe(200);
    expect(library.url()).toBe("http://library.lahe.localhost:" + world.helper.pagesPort + "/catalog");
    expect((await library.request().allHeaders())["sec-fetch-site"]).toBe("same-site");
    await expect(page.locator("#lahe-catalog-main .lib-section").first()).toBeVisible();
    await expect(page.locator('meta[name="lahe-catalog-token"]')).toHaveCount(1);
  }
});

test("the unknown-name and file-gone pages read plainly, in light and dark", async ({ page }) => {
  const folder = path.join(world.home, "ws", "repo", "docs");
  const file = writeFile(folder, "page.html", "<!doctype html><title>x</title><p>x</p>");
  const site = bind(file, folder, "page.html");
  await page.setViewportSize({ width: 1100, height: 640 });
  for (const scheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme: scheme });
    const unknown = await page.goto("http://no-such.docs.lahe.localhost:" + world.helper.pagesPort + "/brief.md");
    expect(unknown.status()).toBe(404);
    await expect(page.locator("h1")).toHaveText("No document by that name");
    await expect(page.getByRole("link", { name: "Open the Library" })).toHaveAttribute("href", "http://library.lahe.localhost:" + world.helper.pagesPort + "/catalog");
    const ground = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(ground).toBe(scheme === "dark" ? "rgb(31, 30, 26)" : "rgb(255, 255, 255)");
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(() => [...document.fonts].some((f) => /Hanken/.test(f.family) && f.status === "loaded")),
      "the house fonts load on this page too"
    ).toBe(true);
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "unknown_name_" + scheme + ".png") });
    const gone = await page.goto(site.origin + "/old-brief.html");
    expect(gone.status()).toBe(410);
    await expect(page.locator("h1")).toHaveText("This file is gone");
    await expect(page.locator("code").first()).toHaveText(path.join(folder, "old-brief.html"));
    await page.evaluate(() => document.fonts.ready);
    if (SHOT_DIR) await page.screenshot({ path: path.join(SHOT_DIR, "file_gone_" + scheme + ".png") });
  }
});
