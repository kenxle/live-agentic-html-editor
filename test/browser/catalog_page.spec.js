// The Library page in a real browser. LAHE Library plan, Task 2.2, "Page in the
// browser (2.2)" in the Test List.
//
// What is real and what is stubbed:
//
//  - The PAGE is real. A real helper (port 0, its own temporary state dir, never
//    7817) serves /catalog and its assets, so the content policy, the token meta
//    tag and the script loading are the ones that ship.
//  - catalog.list goes to that helper first, so its auth is real: after a helper
//    restart the old token really gets a 401. A 200 is then answered with
//    test/fixtures/catalog_list.json, so the page draws a fixed list.
//  - open, star and request are answered by the test, which also checks that
//    the page sent the Library's own headers.
//
// Every state and every string is proved in the view model's unit tests; this
// file proves only what needs a DOM: text stays text, Open's tab sequence, the
// dialog, the panel, the toggle, the restart. No test waits out a poll: the page
// exposes window.__laheCatalogPollNow().

"use strict";

const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { startService, SERVICE_ENTRY } = require("../helpers");
const { pollPage } = require("../helpers/poll");
const { startAppServer } = require("../fixtures/app/server");

const protocol = require("../../src/shared/protocol.js");

const LIST = require("../fixtures/catalog_list.json");
const NOW = "2026-09-28T16:00:00.000Z";
const SHOTS = path.join(__dirname, "..", "..", "docs", "features", "20260922.02_lahe_library");
const EPHEMERAL_PORT = ["--port", "0"];

function freshList() {
  return JSON.parse(JSON.stringify(LIST));
}

function reviewIn(list, id) {
  for (const s of list.sessions) for (const r of s.reviews) if (r.id === id) return r;
  throw new Error("no review " + id);
}

// Route the Library's API for one page. `list` is read on every poll, so a
// test can change it between polls. `answers` maps a route name to a function
// (body) => {status, body}. Every POST is recorded.
async function routeCatalog(page, options) {
  const calls = [];
  const realStatuses = [];
  calls.realStatuses = realStatuses;
  const listPath = protocol.route("catalog.list").path;
  await page.route("**" + listPath, async (route) => {
    // Playwright's route.fetch replays the request without the headers the
    // browser adds at the network layer, Sec-Fetch-Site among them, and the
    // helper refuses a list call that lacks it. The page's own call is
    // same-origin, so that is the value restored; the token and the client
    // header are the page's own.
    const real = await route.fetch({
      headers: Object.assign({}, route.request().headers(), { "sec-fetch-site": "same-origin" })
    });
    realStatuses.push(real.status());
    if (real.status() === 401) {
      await route.fulfill({ response: real });
      return;
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(options.list()) });
  });
  for (const name of ["catalog.open", "catalog.star", "catalog.request"]) {
    await page.route("**" + protocol.route(name).path, async (route) => {
      const req = route.request();
      const headers = req.headers();
      const body = JSON.parse(req.postData() || "{}");
      calls.push({ name, body, headers });
      const answer = (options.answers && options.answers[name]) || (() => ({ status: 200, body: {} }));
      const out = await answer(body);
      await route.fulfill({ status: out.status, contentType: "application/json", body: JSON.stringify(out.body) });
    });
  }
  return calls;
}

// Record every action POST the page starts, from the moment it is called.
// page.on("request") fires when the browser starts a request, before any route
// handler runs, so a click's request cannot slip past it.
function recordActions(page) {
  const paths = ["catalog.open", "catalog.star", "catalog.request"].map((n) => protocol.route(n).path);
  const sent = [];
  page.on("request", (req) => {
    const url = new URL(req.url());
    if (req.method() === "POST" && paths.indexOf(url.pathname) !== -1) sent.push(url.pathname);
  });
  return sent;
}

// "Nothing was sent": one more poll-now round trip first, so a request a click
// started has had every chance to show up before the count is read.
async function expectNothingSent(page, sent, message) {
  await page.evaluate(() => window.__laheCatalogPollNow());
  expect(sent, message).toEqual([]);
}

// Screenshots are written only on request (LAHE_SHOTS=1) and only on Chromium,
// so an ordinary run never rewrites a committed image.
function shotsWanted(browserName) {
  return process.env.LAHE_SHOTS === "1" && browserName === "chromium";
}

async function openLibrary(page, helper) {
  await page.clock.setFixedTime(new Date(NOW));
  await page.goto(helper.url + protocol.CATALOG_PAGE_PATH);
  await pollPage(page, () => !!document.querySelector("#lahe-catalog-main .lib-section"), undefined, {
    message: "the Library to render its first list"
  });
}

function rowLocator(page, reviewId) {
  return page.locator('li[data-review="' + reviewId + '"]');
}

test.use({ timezoneId: "UTC", viewport: { width: 1200, height: 900 } });

test.describe("the Library page", () => {
  let helper;

  test.beforeEach(async () => {
    helper = await startService({ entry: SERVICE_ENTRY, args: EPHEMERAL_PORT });
  });

  test.afterEach(async () => {
    if (helper) await helper.stop();
  });

  test("row text containing HTML renders as text", async ({ page }) => {
    const hostile = '<img src=x onerror="window.__pwned=1"><b>bold</b>';
    const list = freshList();
    reviewIn(list, "r_stale").display_name = hostile;
    reviewIn(list, "r_stale").folder = "<i>folder</i>";
    list.sessions.filter((s) => s.id === "s_coach")[0].name = "<script>window.__pwned=2</script>";
    await routeCatalog(page, { list: () => list });
    await openLibrary(page, helper);

    const row = rowLocator(page, "r_stale");
    await expect(row.locator(".lib-name")).toHaveText(hostile);
    await expect(row.locator(".lib-where")).toContainText("<i>folder</i>");
    await expect(page.locator('details[data-session="s_coach"] .lib-card-title')).toHaveText("<script>window.__pwned=2</script>");
    expect(await page.locator("#lahe-catalog-main img, #lahe-catalog-main b, #lahe-catalog-main i, #lahe-catalog-main script").count()).toBe(0);
    expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  });

  test("Open: the new tab has no opener, lands on the helper's URL, and the rail boots there", async ({ page, context }) => {
    const appServer = await startAppServer();
    const review = helper.reviewIds[0];
    // A second helper that knows the app's origin, so the opened document's
    // rail has a helper to talk to. The Library's own helper stays as it is.
    const docHelper = await startService({ entry: SERVICE_ENTRY, args: EPHEMERAL_PORT, reviews: [review], allowedOrigins: [appServer.origin] });
    try {
      appServer.useLayer({ review: review, token: docHelper.tokenFor(review), helper: docHelper.url });
      const target = appServer.urlFor("/");
      const calls = await routeCatalog(page, {
        list: freshList,
        answers: { "catalog.open": () => ({ status: 200, body: { url: target, request_id: null, not_asked: null } }) }
      });
      await openLibrary(page, helper);

      const tabPromise = context.waitForEvent("page");
      // s_old3 has no watcher, so Open goes straight through.
      await rowLocator(page, "r_stale").locator('[data-act="open"]').click();
      const tab = await tabPromise;
      await tab.waitForURL(target);
      expect(tab.url()).toBe(target);
      expect(await tab.evaluate(() => window.opener)).toBeNull();
      await pollPage(tab, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the rail to boot in the opened tab"
      });

      expect(calls.length).toBe(1);
      expect(calls[0].body).toEqual({ review: "r_stale", handoff: true, confirmed: false });
      expect(calls[0].headers[protocol.HEADER.CLIENT]).toBe(protocol.CLIENT_CATALOG);
      expect(calls[0].headers[protocol.HEADER.CONTENT_TYPE]).toBe(protocol.JSON_CONTENT_TYPE);
      expect(calls[0].headers[protocol.HEADER.TOKEN]).toMatch(/\S/);
      await expect(page.locator("#lahe-catalog-banner")).toHaveText('"Stale Projection" is open in a new tab.');
      await tab.close();
    } finally {
      await docHelper.stop();
      await appServer.close();
    }
  });

  test("Open closes the tab and says why when the helper answers with a non-loopback URL", async ({ page, context }) => {
    await routeCatalog(page, {
      list: freshList,
      answers: { "catalog.open": () => ({ status: 200, body: { url: "http://evil.test/", request_id: null, not_asked: null } }) }
    });
    await openLibrary(page, helper);
    const tabPromise = context.waitForEvent("page");
    await rowLocator(page, "r_stale").locator('[data-act="open"]').click();
    const tab = await tabPromise;
    if (!tab.isClosed()) await tab.waitForEvent("close");
    await expect(rowLocator(page, "r_stale").locator(".lib-note-text")).toHaveText(
      "LAHE answered with an address that is not on this computer, so the Library did not open it."
    );
  });

  test("Open answered with no URL closes the blank tab and shows the row waiting for the agent", async ({ page, context }) => {
    await routeCatalog(page, {
      list: freshList,
      answers: { "catalog.open": () => ({ status: 200, body: { url: null, request_id: "cq_s", not_asked: null } }) }
    });
    await openLibrary(page, helper);
    const tabPromise = context.waitForEvent("page");
    await rowLocator(page, "r_stale").locator('[data-act="open"]').click();
    const tab = await tabPromise;
    if (!tab.isClosed()) await tab.waitForEvent("close");
    await expect(rowLocator(page, "r_stale").locator(".lib-note-text")).toHaveText("Waiting for document index.");
    await expect(page.locator("#lahe-catalog-banner")).toHaveText("");
  });

  test("a watched session asks before a hand-over, naming the agent and the other reviews", async ({ page }) => {
    const sent = recordActions(page);
    const calls = await routeCatalog(page, {
      list: freshList,
      answers: { "catalog.request": () => ({ status: 200, body: { request_id: "cq_new" } }) }
    });
    await openLibrary(page, helper);
    await rowLocator(page, "r_mounted").locator('[data-act="pickup"]').click();

    const dialog = page.locator("#lahe-catalog-confirm");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h2")).toHaveText("Another agent is watching this.");
    await expect(dialog.locator("p")).toHaveText(
      '"shared / figure.html" belongs to session "coach activity". Handing it to document index moves the whole session and stops the other agent. These reviews move with it:'
    );
    await expect(dialog.locator("li")).toHaveText(["Feature Brief: Coach Activity", "specs / spec.html", "Coach Notes", "Deleted Page"]);
    await expect(dialog.locator("button")).toHaveText(["Move the session", "Just open it to read", "Cancel"]);
    await expectNothingSent(page, sent, "nothing is sent before the reader decides");

    await dialog.locator('[data-act="move"]').click();
    await expect(dialog).toBeHidden();
    // The dialog closes before the request is routed, so poll for it rather than
    // reading the call list the instant the dialog hides.
    await expect.poll(() => calls.map((c) => c.body)).toEqual([{ review: "r_mounted", action: "pickup", confirmed: true }]);
    await expect(rowLocator(page, "r_mounted").locator(".lib-note-text")).toHaveText("Waiting for document index.");
  });

  test("Cancel and Escape leave the watched session alone", async ({ page }) => {
    const sent = recordActions(page);
    await routeCatalog(page, { list: freshList });
    await openLibrary(page, helper);
    const dialog = page.locator("#lahe-catalog-confirm");
    await rowLocator(page, "r_mounted").locator('[data-act="launch"]').click();
    await dialog.locator('[data-act="cancel"]').click();
    await expect(dialog).toBeHidden();
    await rowLocator(page, "r_mounted").locator('[data-act="launch"]').click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expectNothingSent(page, sent);
  });

  test("with no agent attached, Pick this up and Launch show the hand-off message", async ({ page }) => {
    const list = freshList();
    list.attached = null;
    const sent = recordActions(page);
    await routeCatalog(page, { list: () => list });
    await openLibrary(page, helper);
    await expect(page.locator("#lahe-catalog-agent")).toHaveText(
      "No agent attached. Open still works; hand-overs give you a message to paste."
    );
    const message = protocol.AGENT_LIVENESS.handoffMessage("s_coach", "coach activity", false);
    for (const action of ["pickup", "launch"]) {
      await rowLocator(page, "r_mounted").locator('[data-act="' + action + '"]').click();
      const panel = rowLocator(page, "r_mounted").locator(".lib-panel");
      await expect(panel.locator("p")).toHaveText(
        "No agent is attached. This is the same hand-off message the rail already copies. Paste it into any agent:"
      );
      await expect(panel.locator("pre")).toHaveText(message);
      await expect(panel.locator('[data-act="copy"]')).toBeFocused();
      await panel.locator('[data-act="close-panel"]').click();
      await expect(panel).toHaveCount(0);
    }
    await expectNothingSent(page, sent);
  });

  test("a second click while a request waits does nothing and says so", async ({ page }) => {
    const sent = recordActions(page);
    await routeCatalog(page, { list: freshList });
    await openLibrary(page, helper);
    const row = rowLocator(page, "r_brief");
    await expect(row.locator(".lib-note-text")).toHaveText("Waiting for document index.");
    await row.locator('[data-act="pickup"]').click();
    await expect(row.locator(".lib-note-text")).toHaveText("Already waiting for document index.");
    await row.locator('[data-act="launch"]').click();
    await expect(row.locator(".lib-note-text")).toHaveText("Already waiting for document index.");
    await expectNothingSent(page, sent);
  });

  test("a double click on Open sends one request and shows Open busy until it answers", async ({ page, context }) => {
    const sent = recordActions(page);
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const tabs = [];
    context.on("page", (p) => tabs.push(p));
    await routeCatalog(page, {
      list: freshList,
      answers: {
        "catalog.open": async () => {
          await held;
          return { status: 200, body: { url: "http://evil.test/", request_id: null, not_asked: null } };
        }
      }
    });
    await openLibrary(page, helper);
    const open = rowLocator(page, "r_stale").locator('[data-act="open"]');
    await open.dblclick();
    await expect(rowLocator(page, "r_stale").locator('[data-act="open"]')).toHaveAttribute("aria-busy", "true");
    await rowLocator(page, "r_stale").locator('[data-act="open"]').click();
    await expect.poll(() => sent.length).toBe(1);
    release();
    // The answer is refused (not loopback), which closes the one tab and ends
    // the busy state. Its note is the sign the answer arrived.
    await expect(rowLocator(page, "r_stale").locator(".lib-note-text")).toHaveText(
      "LAHE answered with an address that is not on this computer, so the Library did not open it."
    );
    await expect(rowLocator(page, "r_stale").locator('[data-act="open"]')).not.toHaveAttribute("aria-busy", "true");
    await page.evaluate(() => window.__laheCatalogPollNow());
    expect(sent).toEqual([protocol.route("catalog.open").path]);
    expect(tabs.length, "one tab for one Open").toBe(1);
  });

  test("the missing toggle shows and hides missing rows", async ({ page }) => {
    await routeCatalog(page, { list: freshList });
    await openLibrary(page, helper);
    await expect(rowLocator(page, "r_deleted")).toHaveCount(0);
    await page.locator('[data-act="show-missing"]').click();
    const section = page.locator('[data-section="missing"]');
    await expect(section.locator("h2")).toHaveText("Missing (3). Neither the file nor a main-repo copy exists.");
    await expect(section.locator("li[data-review]")).toHaveCount(3);
    await expect(rowLocator(page, "r_deleted").locator('[data-act="open"]')).toBeDisabled();
    await expect(rowLocator(page, "r_deleted").locator('[data-act="star"]')).toBeEnabled();
    await section.locator('[data-act="hide-missing"]').click();
    await expect(rowLocator(page, "r_deleted")).toHaveCount(0);
    await expect(page.locator('[data-act="show-missing"]')).toHaveText("Show 3 missing");
  });

  test("a star changes when the helper answers, and a failed one goes back and says why", async ({ page }) => {
    let fail = false;
    const list = freshList();
    await routeCatalog(page, {
      list: () => list,
      answers: {
        "catalog.star": (body) => {
          if (fail) {
            return { status: 500, body: { error: { code: "PROTO_CATALOG_UNREADABLE", message: "m.", remedy: "Move catalog.json aside." } } };
          }
          reviewIn(list, body.review).starred = body.starred;
          return { status: 200, body: { review: body.review, starred: body.starred } };
        }
      }
    });
    await openLibrary(page, helper);
    const star = rowLocator(page, "r_stale").locator('[data-act="star"]');
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await star.click();
    await expect(rowLocator(page, "r_stale").locator('[data-act="star"]')).toHaveAttribute("aria-pressed", "true");

    fail = true;
    await rowLocator(page, "r_stale").locator('[data-act="star"]').click();
    await expect(rowLocator(page, "r_stale").locator(".lib-note-text")).toHaveText(
      "Couldn't save the star: Move catalog.json aside. The star goes back."
    );
    await expect(rowLocator(page, "r_stale").locator('[data-act="star"]')).toHaveAttribute("aria-pressed", "true");
  });

  test("restarting the helper under an open Library says so, and a reload recovers", async ({ page }) => {
    const calls = await routeCatalog(page, { list: freshList });
    await openLibrary(page, helper);
    // The real helper passed the page's token: not a refusal.
    expect(calls.realStatuses.length).toBeGreaterThan(0);
    calls.realStatuses.forEach((status) => expect(status).toBe(200));
    const port = helper.port;
    const stateDir = helper.stateDir;
    await helper.stop();
    helper = await startService({ entry: SERVICE_ENTRY, args: ["--port", String(port)], stateDir: stateDir });
    expect(helper.port).toBe(port);

    await page.evaluate(() => window.__laheCatalogPollNow());
    const banner = page.locator("#lahe-catalog-banner");
    await expect(banner.locator("p")).toHaveText("LAHE restarted, reload this page.");
    await expect(banner.locator('[data-act="reload"]')).toHaveText("Reload");

    await banner.locator('[data-act="reload"]').click();
    await pollPage(page, () => !!document.querySelector("#lahe-catalog-main .lib-section"), undefined, {
      message: "the reloaded Library to render"
    });
    await expect(banner).toHaveText("");
  });

  test("a watched card names its agent once, on its summary line, and its rows do not repeat it", async ({ page }) => {
    await routeCatalog(page, { list: freshList });
    await openLibrary(page, helper);
    const coach = page.locator('details[data-session="s_coach"]');
    await expect(coach.locator("summary .lib-card-watch")).toHaveText("watched by coach activity");
    await expect(coach.locator('summary .lib-badge[data-badge="watching"]')).toHaveCount(1);
    expect(await coach.locator("li[data-review]").count()).toBeGreaterThan(1);
    await expect(coach.locator('li[data-review] [data-badge="watching"]')).toHaveCount(0);
    await expect(page.locator('details[data-session="s_ops"] summary .lib-card-watch')).toHaveText(
      "watched by document index, the agent that opened this Library"
    );
    // A missing row is listed outside its card, so it keeps the badge.
    await page.locator('[data-act="show-missing"]').click();
    await expect(rowLocator(page, "r_deleted").locator('[data-badge="watching"]')).toHaveText("agent watching: coach activity");
  });

  test("screenshots, light and dark", async ({ page, browserName }) => {
    test.skip(!shotsWanted(browserName), "screenshots are written only with LAHE_SHOTS=1 on Chromium");
    const list = freshList();
    await routeCatalog(page, { list: () => list });
    await openLibrary(page, helper);
    await page.locator("#lahe-catalog-main").waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: path.join(SHOTS, "catalog_page_light.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.screenshot({ path: path.join(SHOTS, "catalog_page_dark.png"), fullPage: true });
  });
});
