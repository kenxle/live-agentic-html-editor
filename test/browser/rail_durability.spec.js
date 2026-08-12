// Ranked test 6 (nothing is lost across a reload, a tab close and a kill -9)
// and ranked test 19 (a draft survives a reload mid-sentence and reaches the
// helper marked draft).
//
// The sharp edge of test 6 is the ORDERING: durability is asserted in the same
// task as the final keystroke, with no awaited timer in between. A store that
// debounces its write cannot pass that, which is the whole point; the debounce
// in this design is on the post to the HELPER (750ms of typing idle,
// protocol.FLUSH), never on the write to browser storage.

"use strict";

const path = require("node:path");
const {
  test,
  expect,
  startStaticServer,
  startService,
  readEventLog,
  pollUntil,
  pollPage
} = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
// The stand-in helper that speaks protocol.js. When 1A's real helper lands,
// this constant is the only line that changes.
const SERVICE_ENTRY = path.join(REPO_ROOT, "test", "fixtures", "servers", "protocol-service.js");
const REVIEW = "review-1";

function railUrl(server, helper, token) {
  const query = new URLSearchParams({ review: REVIEW });
  if (helper) query.set("helper", helper);
  if (token) query.set("token", token);
  return server.urlFor("test/fixtures/rail.html") + "?" + query.toString();
}

test.describe("nothing typed is lost", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "repo" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("the last keystroke is in browser storage before the keystroke returns", async ({ page }) => {
    await page.goto(railUrl(pages));
    const opened = await page.evaluate(() => window.__laheRail.openCard());
    await page.keyboard.type("The heading promises a summary", { delay: 5 });

    // One task: dispatch the final keystroke, read raw browser storage, return.
    // No await, no timer, no poll in between.
    const durable = await page.evaluate(
      (id) => window.__laheRail.typeFinalKeystrokeAndRead({ id: id, character: "." }),
      opened.id
    );

    expect(durable.typed).toBe("The heading promises a summary.");
    expect(durable.durable, "the final character is in browser storage in the same task").toBe(true);
    expect(durable.queued, "and it is queued for the helper, durably, in the same task").toBe(true);
  });

  test("a reload mid-sentence keeps the draft, and it reaches the helper marked draft", async ({ page }) => {
    const helper = await startService({
      entry: SERVICE_ENTRY,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });

    try {
      await page.goto(railUrl(pages, helper.url, helper.tokenFor(REVIEW)));
      await page.evaluate(() => window.__laheRail.startSync());
      const opened = await page.evaluate(() => window.__laheRail.openCard());
      await page.keyboard.type("Half a thought about the", { delay: 5 });

      // The draft, not a finished comment: no Cmd-Enter has happened.
      await pollPage(page, () => window.__laheRail.pending() === 0, undefined, {
        message: "the draft to be acknowledged by the helper"
      });

      const log = await pollUntil(
        () => {
          const lines = readEventLog(helper.stateDir, REVIEW);
          return lines.length > 0 ? lines : null;
        },
        { message: "the draft to reach events.jsonl" }
      );
      const drafts = log.filter((event) => event.draft === true);
      expect(drafts.length, "a half-written thought is in the helper's log too").toBeGreaterThan(0);
      expect(drafts[drafts.length - 1].record.note).toBe("Half a thought about the");
      expect(drafts[drafts.length - 1].record.state).toBe("draft");

      await page.reload();
      const afterReload = await page.evaluate(() => ({
        items: window.__laheRail.storedItems(),
        cards: window.__laheRail.cardIds()
      }));
      expect(afterReload.items.length).toBe(1);
      expect(afterReload.items[0].note, "the sentence survived the reload exactly as typed").toBe(
        "Half a thought about the"
      );
      expect(afterReload.items[0].state).toBe("draft");
      expect(afterReload.cards, "and it is back on the rail as a card").toContain(opened.id);
    } finally {
      await helper.kill9();
    }
  });

  test("a kill -9 and a restart lose nothing, and every record lands exactly once", async ({ page }) => {
    const first = await startService({
      entry: SERVICE_ENTRY,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });
    const port = first.port;
    const token = first.tokenFor(REVIEW);
    const stateDir = first.stateDir;
    let second = null;

    try {
      await page.goto(railUrl(pages, first.url, token));
      await page.evaluate(() => window.__laheRail.startSync());

      const one = await page.evaluate(() => window.__laheRail.openCard());
      await page.keyboard.type("Before the helper dies", { delay: 5 });
      await page.evaluate((id) => window.__laheRail.markReady(id), one.id);
      await pollPage(page, () => window.__laheRail.pending() === 0, undefined, {
        message: "the first record to be acknowledged"
      });

      await first.kill9();

      // Typing continues against a helper that is gone. Nothing blocks, and
      // everything is still durable.
      const two = await page.evaluate(() => window.__laheRail.openCard());
      await page.keyboard.type("After the helper died", { delay: 5 });
      const durable = await page.evaluate(
        (id) => window.__laheRail.typeFinalKeystrokeAndRead({ id: id, character: "." }),
        two.id
      );
      expect(durable.durable).toBe(true);
      expect(durable.queued, "the backlog is in browser storage, not in a JS array").toBe(true);

      second = await startService({
        entry: SERVICE_ENTRY,
        stateDir: stateDir,
        reviews: [REVIEW],
        allowedOrigins: [pages.origin],
        env: { LAHE_PORT: String(port), LAHE_TOKEN: token }
      });

      await pollPage(page, () => window.__laheRail.pending() === 0, undefined, {
        timeoutMs: 20000,
        message: "the backlog to drain into the restarted helper"
      });

      const log = readEventLog(stateDir, REVIEW);
      const ids = log.map((event) => event.event_id);
      expect(new Set(ids).size, "every event is in the log exactly once").toBe(ids.length);

      const notes = log.filter((event) => event.record).map((event) => event.record.note);
      expect(notes).toContain("Before the helper dies");
      expect(notes).toContain("After the helper died.");
    } finally {
      if (second) await second.kill9();
      if (first.alive()) await first.kill9();
    }
  });
});
