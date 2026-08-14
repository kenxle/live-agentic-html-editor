// Ranked test 25: a second window on the same review is refused with a reason,
// in BOTH shapes, plus the one case nothing can refuse.
//
//   shared storage, no helper      the client-side Web Lock refuses. This is
//                                  the shape that has to work with nothing
//                                  running, which is why it is a lock and not
//                                  a call to the helper
//   separate storage, helper up    the lock cannot see across storage buckets,
//                                  so the HELPER's session refuses, naming the
//                                  window that holds it
//   separate storage, no helper    refused by nothing. Asserted as a NAMED
//                                  LIMIT on the rail, never as a refusal
//
// The positive control is in every shape: the first window keeps working and
// keeps accumulating after the refusal. A refusal that quietly breaks the
// window that was there first is worse than no refusal.

"use strict";

const path = require("node:path");
const {
  test,
  expect,
  startStaticServer,
  startService,
  openTwoTabs,
  openTwoContexts,
  pollPage,
  SERVICE_ENTRY: serviceEntry
} = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
// 1A's real helper, which is what CP1 exists to run these against. It was the
// stand-in (test/fixtures/servers/protocol-service.js) only while 1A was still
// in flight; SERVICE_ENTRY is the harness's own constant now.
const SERVICE_ENTRY = serviceEntry;
const REVIEW = "review-1";

// The helper's own default port is fixed (7817) because a page has it baked
// into its script tag. A parallel Playwright run would collide on it, so every
// spec that does not need a pinned port asks for an ephemeral one and reads the
// real port back out of service.json.
const EPHEMERAL_PORT = ["--port", "0"];


function railUrl(server, helper, token) {
  const query = new URLSearchParams({ review: REVIEW });
  if (helper) query.set("helper", helper);
  if (token) query.set("token", token);
  return server.urlFor("test/fixtures/rail.html") + "?" + query.toString();
}

async function startAndClaim(page) {
  return page.evaluate(async () => {
    await window.__laheRail.startSync();
    return window.__laheRail.windowLock();
  });
}

test.describe("a second window is refused with a reason", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "repo" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("shared storage with no helper: the client lock refuses and names the first window", async ({ browser }) => {
    const tabs = await openTwoTabs(browser, railUrl(pages));
    try {
      const first = await startAndClaim(tabs.first.page);
      expect(first.acquired).toBe(true);

      const second = await startAndClaim(tabs.second.page);
      expect(second.acquired, "the second tab is refused with the helper down").toBe(false);
      expect(second.refusedBy).toBe("lock");
      expect(second.reason, "and the refusal points at the window that has it").toContain("already open in");
      expect(second.holder, "the first window is named, not implied").toBeTruthy();

      // The positive control: the first tab still works and still accumulates.
      const opened = await tabs.first.page.evaluate(() => window.__laheRail.openCard());
      await tabs.first.page.keyboard.type("Still typing in the first window", { delay: 5 });
      const stored = await tabs.first.page.evaluate(
        (id) => window.__laheRail.storedText(id),
        opened.id
      );
      expect(stored).toBe("Still typing in the first window");

      const chips = await tabs.second.page.evaluate(() => window.__laheRail.chips());
      expect(chips.map((chip) => chip.code)).toContain("SECOND_WINDOW_REFUSED");
    } finally {
      await tabs.closeAll();
    }
  });

  test("separate storage with the helper running: the helper refuses, naming the first", async ({ browser }) => {
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });
    const contexts = await openTwoContexts(browser, railUrl(pages, helper.url, helper.tokenFor(REVIEW)));

    try {
      const first = await startAndClaim(contexts.first.page);
      expect(first.acquired).toBe(true);
      expect(first.helperGranted, "the helper's session is held by the first window").toBe(true);

      const second = await startAndClaim(contexts.second.page);
      expect(second.acquired, "a window the lock cannot see is still refused, by the helper").toBe(false);
      expect(second.refusedBy).toBe("helper");
      expect(second.reason).toContain("already open in another window");

      // The refusal is LOUD: the rail expands so the panel is on screen. A
      // refusal behind the collapsed pill reads as "the tool is broken" to a
      // reviewer who was told nothing (first-real-use finding, 2026-08-14).
      // Polled, not read once: the panel shows a beat after the claim answer.
      await pollPage(contexts.second.page, () => window.__laheRail.refusalShown(), undefined, {
        message: "the refusal panel to be shown on the refused window"
      });
      const refusedCollapsed = await contexts.second.page.evaluate(() => window.__laheRail.isCollapsed());
      expect(refusedCollapsed, "the rail is expanded so the refusal can be seen").toBe(false);

      // Positive control again, on the window that was there first.
      const opened = await contexts.first.page.evaluate(() => window.__laheRail.openCard());
      await contexts.first.page.keyboard.type("The first window keeps going", { delay: 5 });
      await contexts.first.page.evaluate((id) => window.__laheRail.markReady(id), opened.id);
      await pollPage(contexts.first.page, () => window.__laheRail.pending() === 0, undefined, {
        message: "the first window's record to reach the helper after the second was refused"
      });
    } finally {
      await contexts.closeAll();
      await helper.kill9();
    }
  });

  test("separate storage with no helper: stated as a limit, never claimed as a refusal", async ({ browser }) => {
    const contexts = await openTwoContexts(browser, railUrl(pages));
    try {
      const first = await startAndClaim(contexts.first.page);
      const second = await startAndClaim(contexts.second.page);

      // Nothing can see this collision, and the tool does not pretend it can.
      expect(first.acquired).toBe(true);
      expect(second.acquired, "no lock and no helper can see across two storage buckets").toBe(true);

      const limit = await contexts.second.page.evaluate(() => window.__laheRail.limit());
      expect(limit, "the rail says so out loud").toContain("separate browser profile cannot be detected");
    } finally {
      await contexts.closeAll();
    }
  });
});
