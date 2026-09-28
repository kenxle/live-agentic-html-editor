// The Library, end to end. LAHE Library plan, Task 3.2, "End to end and
// cross-site (3.2)" in the Test List.
//
// Nothing here is stubbed on the page's side. The world is built with the real
// CLI, the way an agent builds it (test/browser/support/catalog_world.js):
//
//   - `lahe review` opens five documents in four agent sessions, on a free
//     port (never 7817) with a temporary state dir (never the real one).
//   - `lahe session close` closes one of them, so the Library has a closed
//     review to Open.
//   - `lahe monitor` runs for real on another session, so that session is
//     watched by "another agent" and the confirm step has something to ask.
//   - `lahe library --session` attaches the stub agent and prints the URL the
//     browser goes to.
//
// THE STUB AGENT uses only what a real agent uses: it reads the request id from
// the real `lahe status --session <id> --json --quiet` output and answers with
// the real `lahe library answer`. Its drain also stamps its activity, which is
// what makes it "listening" to the helper, exactly as for a real agent.
//
// No test waits out the page's 15-second poll: every wait is expect.poll (or
// pollUntil, which is the same thing on the node side) after the page's own
// window.__laheCatalogPollNow() hook.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const { test, expect } = require("@playwright/test");
const { pollUntil, pollPage } = require("../helpers/poll");
const { buildWorld, REPO_ROOT, CLI } = require("./support/catalog_world");

const protocol = require("../../src/shared/protocol.js");
const VM = require("../../src/layer/catalog/view_model.js");

const SHOTS = path.join(REPO_ROOT, "docs", "features", "20260922.02_lahe_library");
const T = VM.TEXT;

const AGENT_NAME = "stub agent";
const OTHER_AGENT = "other agent";

test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 1280, height: 860 } });

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (m, key) => (key in values ? String(values[key]) : m));
}

let world = null;

/** Drain until the request for `reviewId` shows, then return it. */
async function requestFor(reviewId, action) {
  return pollUntil(() => world.drainRequests().filter((r) => r.review === reviewId && r.action === action)[0], {
    message: "the stub agent's drain to list a " + action + " request for " + reviewId,
    describe: () => ({ drained: world.drainRequests() })
  });
}

async function openLibrary(page) {
  await page.goto(world.libraryUrl);
  await pollPage(page, () => !!document.querySelector("#lahe-catalog-main .lib-section"), undefined, {
    message: "the Library to render its first list from the real helper"
  });
}

function row(page, reviewId) {
  return page.locator('li[data-review="' + reviewId + '"]').first();
}

/** Ask the page to poll now, then read the row's note. */
async function noteAfterPoll(page, reviewId) {
  await page.evaluate(() => window.__laheCatalogPollNow());
  const note = row(page, reviewId).locator(".lib-note-text");
  return (await note.count()) ? await note.first().textContent() : null;
}

function events(reviewId) {
  const text = world.eventsText(reviewId);
  if (text === "<absent>") return [];
  return text.split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
}

async function commentOn(page, selector, text) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  await pollPage(page, () => window.__lahe.items().some((i) => i.state === "ready"), undefined, {
    message: "the comment to be ready"
  });
}

// ---------------------------------------------------------------------------

test.describe("the Library, end to end, with a stub agent on the real CLI", () => {
  let monitor = null;
  const monitorOut = [];

  test.beforeAll(async () => {
    world = await buildWorld({
      agentName: AGENT_NAME,
      docs: [
        // Closed before the Library opens: Open has to reopen it. It declares
        // light and dark, so the dark screenshot shows the document following.
        { key: "closed", folder: "closed", file: "brief.html", title: "Closed Brief", body: "A brief from last week.", name: "closed work", close: true, colorScheme: "light dark" },
        // Open and unwatched: Pick this up goes straight through.
        { key: "pick", folder: "pick", file: "plan.html", title: "Pick Up Plan", body: "A plan waiting for an agent.", name: "pick work" },
        // Watched by another agent, with a second review in the same session.
        { key: "watched", folder: "watched", file: "spec.html", title: "Watched Spec", body: "A spec someone else is on.", name: OTHER_AGENT },
        { key: "watched2", folder: "watched2", file: "figure.html", title: "Watched Figure", body: "A figure in the same session.", sessionOf: "watched" }
      ]
    });
    expect(world.docs.watched2.session).toBe(world.docs.watched.session);
    expect(world.libraryUrl).toBe(world.helperOrigin + protocol.CATALOG_PAGE_PATH);
    expect(world.attachedAtStart.session).toBe(world.agent.session);
    expect(world.drainRequests()).toEqual([]);

    // The other agent: a real monitor on the watched session. Its heartbeat
    // is what the Library reads as "watching".
    monitor = spawn(process.execPath, [CLI, "monitor", "--session", world.docs.watched.session, "--interval", "1"], {
      cwd: REPO_ROOT,
      env: world.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    monitor.stdout.on("data", (c) => monitorOut.push(c.toString()));
    monitor.stderr.on("data", (c) => monitorOut.push(c.toString()));
    const beat = path.join(world.stateDir, "agent-sessions", world.docs.watched.session, "monitor.json");
    await pollUntil(() => fs.existsSync(beat), {
      message: "the other agent's monitor to write its heartbeat",
      describe: () => ({ monitor: monitorOut.join("") })
    });
  });

  test.afterAll(async () => {
    if (monitor && monitor.exitCode === null) monitor.kill("SIGTERM");
    if (world) world.teardown();
  });

  test("Open a closed review: the document lands in a new tab with its rail, takes a comment, and the stub agent's answer shows", async ({
    page,
    context
  }) => {
    await openLibrary(page);
    await expect(page.locator("#lahe-catalog-agent")).toHaveText(fill(T.AGENT_ATTACHED, { agent: AGENT_NAME }));

    // Never opened in a browser, so no title was ever recorded: the Library
    // names it by folder and file (R2).
    const name = "closed / brief.html";
    await expect(row(page, world.docs.closed.review).locator(".lib-name")).toHaveText(name);
    const tabPromise = context.waitForEvent("page");
    await row(page, world.docs.closed.review).locator('[data-act="open"]').click();
    const tab = await tabPromise;
    await pollUntil(() => /^http:\/\/127\.0\.0\.1:\d+\/brief\.html$/.test(tab.url()), {
      message: "the new tab to land on the reopened document",
      describe: () => ({ url: tab.url() })
    });
    expect(await tab.evaluate(() => window.opener)).toBeNull();
    await pollPage(tab, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the rail to boot in the opened document",
      timeoutMs: 20000
    });
    await expect(tab.locator("h1")).toHaveText("Closed Brief");

    // The session is open again, and its server answers on the tab's port.
    expect(world.sessionClosed(world.docs.closed.session), "Open reopened the closed session").toBe(false);

    // A comment from the opened tab reaches the helper's log for that review.
    await commentOn(tab, "#p", "Is this still the plan?");
    await pollUntil(() => events(world.docs.closed.review).some((e) => e.event === "item.ready"), {
      message: "the comment from the Library-opened tab to reach events.jsonl"
    });

    // With the stub agent attached and no one watching, Open also queued a
    // pick-up. Until the agent answers, the banner does not claim it watches.
    await expect(page.locator("#lahe-catalog-banner")).toHaveText(
      fill(T.OPENED_WAITING, { name: name, agent: AGENT_NAME })
    );
    const req = await requestFor(world.docs.closed.review, "pickup");
    expect(req.session).toBe(world.docs.closed.session);
    expect([name, "Closed Brief"], "the drain names the document").toContain(req.title);
    world.answer(req.request, "done", "Watching Closed Brief.");

    const shown = fill(T.DONE, { agent: AGENT_NAME, text: "Watching Closed Brief." });
    await expect.poll(() => noteAfterPoll(page, world.docs.closed.review), { message: "the row to show the agent's answer" }).toBe(shown);
    await expect(page.locator("#lahe-catalog-banner")).toHaveText(
      fill(T.DONE_AFTER_OPEN, { name: name, agent: AGENT_NAME })
    );

    // Screenshots of the document as the Library opened it, rail and comment
    // on screen, in the same run as the assertions above.
    await tab.bringToFront();
    await tab.evaluate(() => document.fonts.ready);
    await tab.emulateMedia({ colorScheme: "light" });
    await tab.screenshot({ path: path.join(SHOTS, "catalog_opened_doc_light.png") });
    await tab.emulateMedia({ colorScheme: "dark" });
    await tab.screenshot({ path: path.join(SHOTS, "catalog_opened_doc_dark.png") });
    await tab.close();
  });

  test("Pick this up: the stub agent reads the request from lahe status, answers with lahe library answer, and the row shows it", async ({
    page
  }) => {
    await openLibrary(page);
    const target = row(page, world.docs.pick.review);
    await target.locator('[data-act="pickup"]').click();
    await expect(target.locator(".lib-note-text")).toHaveText(fill(T.WAITING, { agent: AGENT_NAME }));

    const req = await requestFor(world.docs.pick.review, "pickup");
    expect(req.session).toBe(world.docs.pick.session);
    expect(req.kind).toBe("static");
    expect(req.title).toBe("pick / plan.html");
    expect(req.path).toBe(world.docs.pick.file);
    expect(req.handoff).toContain(world.docs.pick.session);

    // A second click while it waits sends nothing and says so.
    await target.locator('[data-act="pickup"]').click();
    await expect(target.locator(".lib-note-text")).toHaveText(fill(T.ALREADY_WAITING, { agent: AGENT_NAME }));
    expect(world.drainRequests().filter((r) => r.review === world.docs.pick.review)).toHaveLength(1);

    world.answer(req.request, "done", "Took over Pick Up Plan.");
    const shown = fill(T.DONE, { agent: AGENT_NAME, text: "Took over Pick Up Plan." });
    await expect.poll(() => noteAfterPoll(page, world.docs.pick.review), { message: "the row to show the agent's answer" }).toBe(shown);

    // Answered means off the drain, and a second answer is refused.
    expect(world.drainRequests().filter((r) => r.request === req.request)).toHaveLength(0);
    expect(() => world.answer(req.request, "done", "again")).toThrow(/already answered/);
  });

  test("a watched session asks first; Move the session queues the pick-up, and the stub agent's answer shows", async ({
    page
  }) => {
    await openLibrary(page);
    const target = row(page, world.docs.watched.review);
    await target.locator('[data-act="pickup"]').click();

    const dialog = page.locator("#lahe-catalog-confirm");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("h2")).toHaveText(T.CONFIRM_TITLE);
    await expect(dialog.locator("p")).toHaveText(
      fill(T.CONFIRM_BODY, { name: "watched / spec.html", session: OTHER_AGENT, agent: AGENT_NAME }) + " " + T.CONFIRM_MOVES
    );
    await expect(dialog.locator("li")).toHaveText(["watched2 / figure.html"]);
    expect(world.drainRequests().filter((r) => r.review === world.docs.watched.review), "nothing is queued before the reader decides").toHaveLength(0);

    await dialog.locator('[data-act="move"]').click();
    await expect(dialog).toBeHidden();
    await expect(target.locator(".lib-note-text")).toHaveText(fill(T.WAITING, { agent: AGENT_NAME }));

    const req = await requestFor(world.docs.watched.review, "pickup");
    expect(req.session).toBe(world.docs.watched.session);
    expect(req.moves_with).toEqual([world.docs.watched2.review]);
    world.answer(req.request, "refused", "The other agent is mid-task; ask again in a minute.");
    const shown = fill(T.REFUSED, { agent: AGENT_NAME, text: "The other agent is mid-task; ask again in a minute" });
    await expect.poll(() => noteAfterPoll(page, world.docs.watched.review), { message: "the row to show the refusal" }).toBe(shown);
  });
});
