// Ranked test 21 (the status line tells the truth) and ranked test 22 (a
// suspended helper never blocks the reviewer).
//
// Both assert TRANSITIONS rather than the presence of a string, because a
// status line that says "stored" while a backlog sits unposted is worse than no
// status line at all: the reviewer stops checking.
//
// The suspended case is the one a client written only against kill -9 fails. A
// killed helper refuses the connection at once. A SUSPENDED one accepts the
// socket and answers nothing, which is what a laptop coming back from sleep and
// a paused container both look like, and without a request deadline the page
// waits on it forever.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, startService, readEventLog, pollPage } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const SERVICE_ENTRY = path.join(REPO_ROOT, "test", "fixtures", "servers", "protocol-service.js");
const REVIEW = "review-1";

function railUrl(server, helper, token) {
  const query = new URLSearchParams({ review: REVIEW, helper: helper, token: token });
  return server.urlFor("test/fixtures/rail.html") + "?" + query.toString();
}

test.describe("the status line tells the truth", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "repo" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("stored, then kept-locally on a kill -9, then stored only once the backlog is acknowledged", async ({
    page
  }) => {
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
      await page.keyboard.type("A comment the helper acknowledges", { delay: 5 });
      await page.evaluate((id) => window.__laheRail.markReady(id), one.id);

      await pollPage(page, () => window.__laheRail.status() === "stored", undefined, {
        message: "the status line to read stored"
      });

      await first.kill9();

      // A record made against a helper that is gone.
      const two = await page.evaluate(() => window.__laheRail.openCard());
      await page.keyboard.type("A comment made while it is down", { delay: 5 });
      await page.evaluate((id) => window.__laheRail.markReady(id), two.id);

      await pollPage(page, () => window.__laheRail.status() === "kept_locally", undefined, {
        message: "the status line to read kept-locally"
      });

      const whileDown = await page.evaluate(() => ({
        status: window.__laheRail.status(),
        pending: window.__laheRail.pending(),
        text: window.__laheRail.statusText()
      }));
      expect(whileDown.pending, "the backlog is still queued while it says kept-locally").toBeGreaterThan(0);
      expect(whileDown.text).toContain("Nothing is lost");

      second = await startService({
        entry: SERVICE_ENTRY,
        stateDir: stateDir,
        reviews: [REVIEW],
        allowedOrigins: [pages.origin],
        env: { LAHE_PORT: String(port), LAHE_TOKEN: token }
      });

      await pollPage(page, () => window.__laheRail.status() === "stored", undefined, {
        timeoutMs: 20000,
        message: "the status line to return to stored after the backlog drained"
      });

      const transitions = await page.evaluate(() => window.__laheRail.statusLog());
      const shape = transitions.filter((value, index) => value !== transitions[index - 1]);
      expect(shape.slice(-3), "the three transitions, in order").toEqual([
        "stored",
        "kept_locally",
        "stored"
      ]);

      // Stored is only said once the backlog is actually acknowledged.
      const drained = await page.evaluate(() => window.__laheRail.pending());
      expect(drained).toBe(0);
    } finally {
      if (second) await second.kill9();
      if (first.alive()) await first.kill9();
    }
  });

  test("a suspended helper never blocks the reviewer, and every record arrives once on resume", async ({
    page
  }) => {
    const helper = await startService({
      entry: SERVICE_ENTRY,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });

    try {
      await page.goto(railUrl(pages, helper.url, helper.tokenFor(REVIEW)));
      await page.evaluate(() => window.__laheRail.startSync());

      const one = await page.evaluate(() => window.__laheRail.openCard());
      await page.keyboard.type("Typed before the freeze", { delay: 5 });
      await page.evaluate((id) => window.__laheRail.markReady(id), one.id);
      await pollPage(page, () => window.__laheRail.status() === "stored", undefined, {
        message: "the first record to be stored"
      });

      // SIGSTOP: the socket is still accepted, and nothing is ever answered.
      await helper.suspend();
      expect(helper.suspended()).toBe(true);

      const two = await page.evaluate(() => window.__laheRail.openCard());
      await page.keyboard.type("Typed while it is frozen", { delay: 5 });
      await page.evaluate((id) => window.__laheRail.markReady(id), two.id);

      // Not blocked: the keystrokes landed and are durable, with the helper
      // still hanging on an open socket.
      const whileFrozen = await page.evaluate(
        (id) => window.__laheRail.typeFinalKeystrokeAndRead({ id: id, character: "!" }),
        two.id
      );
      expect(whileFrozen.durable, "typing is durable while the helper hangs").toBe(true);

      await pollPage(page, () => window.__laheRail.status() === "kept_locally", undefined, {
        timeoutMs: 20000,
        message: "the status line to read kept-locally for a helper that answers nothing"
      });

      await helper.resume();

      await pollPage(page, () => window.__laheRail.pending() === 0, undefined, {
        timeoutMs: 30000,
        message: "the backlog to drain once the helper is running again"
      });

      const log = readEventLog(helper.stateDir, REVIEW);
      const ids = log.map((event) => event.event_id);
      expect(new Set(ids).size, "exactly once, even though requests were retried into a frozen socket").toBe(
        ids.length
      );
      const notes = log.filter((event) => event.record).map((event) => event.record.note);
      expect(notes).toContain("Typed before the freeze");
      expect(notes).toContain("Typed while it is frozen!");
    } finally {
      if (helper.suspended()) await helper.resume();
      await helper.kill9();
    }
  });
});
