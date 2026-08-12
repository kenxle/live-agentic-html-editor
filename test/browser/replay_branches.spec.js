// Replay's four branches, its idempotence, and its lost anchors, in a real
// browser, on a page that actively reverts what the tool writes.
//
// Ranked tests 13, 8 and 14. The unit half of the same bar is
// test/unit/replay_pass.test.js, which runs the branch decisions over a
// simulated DOM in milliseconds. This file is where they have to be true.
//
// Every assertion reads the counters as well as the DOM. A test that only reads
// the DOM is passed by an engine that never ran: the page looks right because
// nothing touched it.

"use strict";

const path = require("node:path");
const {
  test,
  expect,
  startStaticServer,
  readCounters,
  waitForCounter,
  assertNoSecondWrite,
  forceRepaint,
  configureFixture
} = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/replay-doc.html";

// Counters read INSIDE the page, in the same task as the pass they are about.
//
// Replay schedules itself off the page's own mutations, so between a
// page.evaluate that changes the page and a later readCounters over the wire,
// another pass can legitimately have run. A delta measured across that gap is
// the sum of two passes and the assertion becomes a race. Anything asserting
// "this pass did exactly this" reads the counters where the pass happened.
const READ_COUNTERS = "(function(){var c={};Object.keys(window.__lahe.counters).forEach(function(k){c[k]=window.__lahe.counters[k];});return c;})()";

test.describe("replay: the four branches", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "replay" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  // Every test starts from a SETTLED page: the library loaded, the first pass
  // ran, and every record that was going to be applied is applied. Replay
  // schedules itself off the page's own mutations, so a test that raced that
  // first pass would be asserting on a half-applied document.
  test.beforeEach(async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE));
    await page.waitForFunction(() => !!window.__laheReplay);
    await waitForCounter(page, "replayPasses", 1);
    await page.evaluate(() => window.__laheReplay.pass("boot"));
  });

  // -------------------------------------------------------------------------
  // Ranked test 13
  // -------------------------------------------------------------------------

  test("branch three: an earlier revision landed, so the current one is re-applied once and the card says so", async ({
    page
  }) => {
    // The page holds an EARLIER `after` of region B. Two rewordings back, so it
    // is neither the current `after` nor the `before`: a single rewording would
    // let branch two pass this test by accident.
    // The rewrite and the pass happen in ONE task on purpose. Replay schedules
    // itself off the page's mutations, so a pass driven from the test would
    // otherwise be the second one and would see branch three already handled.
    const setup = await page.evaluate((READ) => {
      const item = window.__laheReplay.itemFor("#region-b");
      const earlier = item.after_history
        .map((entry) => entry.after)
        .filter((after) => after && after !== item.after)[0];
      window.__laheReplay.rewrite("#region-b", earlier);
      const countersBefore = eval(READ);
      const summary = window.__laheReplay.pass("manual");
      return {
        earlier: earlier,
        current: item.after,
        before: item.before,
        summary: summary,
        countersBefore: countersBefore,
        countersAfter: eval(READ)
      };
    }, READ_COUNTERS);
    const before = setup.countersBefore;
    const after = setup.countersAfter;
    const summary = setup.summary;

    expect(setup.earlier).not.toBe(setup.current);
    expect(setup.earlier).not.toBe(setup.before);

    const result = summary.results.find((r) => r.region === "#region-b");
    expect(result.branch).toBe("earlier_revision");
    expect(await page.evaluate(() => window.__laheReplay.text("#region-b"))).toBe(setup.current);

    // Exactly one write for this region, and it is counted as branch three
    // rather than as a collision.
    expect(after.regionsEarlierRevision - before.regionsEarlierRevision).toBe(1);
    expect(after.regionsBlockedChanged - before.regionsBlockedChanged).toBe(0);
    expect(summary.results.filter((r) => r.region === "#region-b" && r.wrote)).toHaveLength(1);
    expect(after.replayPasses - before.replayPasses).toBe(1);

    // And the reviewer is told, in the words the module owns.
    const card = await page.evaluate(() => window.__laheReplay.card("#region-b"));
    const message = await page.evaluate(() => LAHE.replay.EARLIER_REVISION_MESSAGE);
    expect(card.notice).toBe(message);
    expect(message).toContain("earlier version");
  });

  test("branch two: the repaint put the page back, so the edit is applied again", async ({ page }) => {
    const applied = await page.evaluate(() => window.__laheReplay.text("#region-c"));
    expect(applied).toBe("Marcus is resting completely on Thursday.");

    // The page reverts to what the server believes, which is the `before`.
    const before = await readCounters(page);
    await forceRepaint(page, { flavor: "turbo-frame" });
    const after = await readCounters(page);

    expect(await page.evaluate(() => window.__laheReplay.text("#region-c"))).toBe(applied);
    expect(after.regionsWritten).toBeGreaterThan(before.regionsWritten);
    expect(after.replayPasses).toBeGreaterThan(before.replayPasses);
  });

  test("branch four: the page changed underneath, so nothing is written and the card shows both versions in full", async ({
    page
  }) => {
    // The agent landed a change under region C: still recognizably that region,
    // and neither what the reviewer edited nor what they changed it to.
    const landed = await page.evaluate((READ) => {
      const item = window.__laheReplay.itemFor("#region-c");
      const theirs = window.__laheReplay.rewrite(
        "#region-c",
        item.before + " The agent rewrote this from the source."
      );
      const countersBefore = eval(READ);
      const summary = window.__laheReplay.pass("manual");
      return { theirs: theirs, summary: summary, countersBefore: countersBefore, countersAfter: eval(READ) };
    }, READ_COUNTERS);
    const before = landed.countersBefore;
    const after = landed.countersAfter;
    const summary = landed.summary;
    const theirs = landed.theirs;

    const result = summary.results.find((r) => r.region === "#region-c");
    expect(result.branch).toBe("content_changed");
    expect(result.wrote).toBe(false);

    // R5: the reviewer's unsent work is never silently overwritten, and neither
    // is the page's.
    expect(await page.evaluate(() => window.__laheReplay.text("#region-c"))).toBe(theirs);
    expect(after.regionsWritten - before.regionsWritten).toBe(0);
    expect(after.regionsBlockedChanged - before.regionsBlockedChanged).toBe(1);

    const card = await page.evaluate(() => window.__laheReplay.card("#region-c"));
    expect(card.badges).toContain("REPLAY_NEITHER_MATCHES");
    // BOTH versions, in full, on the card. No "see theirs" indirection.
    expect(card.conflict.yours).toBe("Marcus is resting completely on Thursday.");
    expect(card.conflict.theirs).toBe(theirs);
    expect(card.conflict.hidden).toBe(false);
  });

  test("a format-only record compares on structure, and a delete is idempotent by absence", async ({
    page
  }) => {
    // Both landed on the settled page. Text-equal and structure-different: a
    // comparator that fell back to text would call the format-only record a
    // no-op and write nothing at all.
    expect(await page.evaluate(() => document.querySelector("#region-format").innerHTML)).toContain(
      "<strong>matters</strong>"
    );
    expect(await page.evaluate(() => window.__laheReplay.exists("#region-delete"))).toBe(false);
    const settled = await readCounters(page);
    expect(settled.regionsWritten).toBeGreaterThanOrEqual(2);

    // The block gone is what the delete asked for. Nothing more to write, on
    // this pass or any later one, and it is not reported as a lost anchor.
    const results = await page.evaluate(() => {
      const summary = window.__laheReplay.pass("manual");
      return {
        del: summary.results.find((r) => r.region === "#region-delete"),
        fmt: summary.results.find((r) => r.region === "#region-format")
      };
    });
    const again = await readCounters(page);
    expect(results.del.branch).toBe("already_applied");
    expect(results.del.wrote).toBe(false);
    expect(results.del.lost).toBe(false);
    expect(results.fmt.branch).toBe("already_applied");
    expect(again.regionsWritten).toBe(settled.regionsWritten);
  });

  // -------------------------------------------------------------------------
  // Ranked test 8: idempotence as the ABSENCE of a second write
  // -------------------------------------------------------------------------

  test("five passes with no repaint in between write nothing at all", async ({ page }) => {
    // The page is settled (see beforeEach). What this test is about is the
    // passes after that.
    await page.evaluate(() => window.__laheReplay.pass("manual"));

    const outcome = await assertNoSecondWrite(page, {
      selector: "#live-frame",
      minReplayPasses: 5,
      message: "five replay passes over regions that already hold the reviewer's text",
      action: async () =>
        page.evaluate(() => {
          const summaries = [];
          for (let i = 0; i < 5; i += 1) summaries.push(window.__laheReplay.pass("manual"));
          return summaries;
        })
    });

    expect(outcome.replayPasses).toBeGreaterThanOrEqual(5);
    expect(outcome.records).toHaveLength(0);

    // And the same thing said as counters: replay ran, looked, and chose not to
    // write. The two are different failures and both are worth naming.
    const counters = await readCounters(page);
    expect(counters.regionsSkippedIdentical).toBeGreaterThanOrEqual(5);
  });

  test("a repaint reverting the page is the only thing that makes replay write again", async ({ page }) => {
    const settled = await readCounters(page);

    await page.evaluate(() => {
      for (let i = 0; i < 5; i += 1) window.__laheReplay.pass("manual");
    });
    const quiet = await readCounters(page);
    expect(quiet.regionsWritten).toBe(settled.regionsWritten);

    // The positive control. Without it, an engine that never writes anything at
    // all passes the assertion above.
    await configureFixture(page, { flavor: "turbo-frame" });
    await forceRepaint(page);
    const loud = await readCounters(page);
    expect(loud.regionsWritten).toBeGreaterThan(quiet.regionsWritten);
  });

  // -------------------------------------------------------------------------
  // Ranked test 14: a lost anchor, both shapes
  // -------------------------------------------------------------------------

  test("an anchor that matches nothing is surfaced as lost, and writes nothing", async ({ page }) => {
    // The page removed the block this record is about, and replay looks at the
    // document as it is now.
    const ran = await page.evaluate((READ) => {
      window.__laheReplay.removeBlock("#region-outside");
      const countersBefore = eval(READ);
      const summary = window.__laheReplay.pass("manual");
      return { summary: summary, countersBefore: countersBefore, countersAfter: eval(READ) };
    }, READ_COUNTERS);
    const summary = ran.summary;
    const before = ran.countersBefore;
    const after = ran.countersAfter;

    const result = summary.results.find((r) => r.region === "#region-outside");
    expect(result.lost).toBe(true);
    expect(result.wrote).toBe(false);
    expect(after.replayPasses - before.replayPasses).toBe(1);
    expect(after.regionsWritten - before.regionsWritten).toBe(0);
    // Two lost records now: this one and the ambiguous twin, which is lost on
    // every pass. The counter counts what the pass reported, and the pass says
    // so itself.
    expect(after.regionsLost - before.regionsLost).toBe(summary.lost);
    expect(summary.results.filter((r) => r.lost).map((r) => r.region)).toContain("#region-outside");

    // On the record, which is what the projection reads, and on the card.
    const item = await page.evaluate(() => window.__laheReplay.itemFor("#region-outside"));
    expect(item.region.lost.code).toBe("ANCHOR_LOST");
    expect(item.region.lost.reason).toContain("not on this page");
    expect(item.after).toBe("This block is outside every repaint target and stays that way.");

    const card = await page.evaluate(() => window.__laheReplay.card("#region-outside"));
    expect(card.badges).toContain("ANCHOR_LOST");
  });

  test("an anchor that matches two places is surfaced as lost, and moves nothing", async ({ page }) => {
    const ran = await page.evaluate((READ) => {
      const countersBefore = eval(READ);
      const summary = window.__laheReplay.pass("manual");
      return { summary: summary, countersBefore: countersBefore, countersAfter: eval(READ) };
    }, READ_COUNTERS);
    const summary = ran.summary;
    const before = ran.countersBefore;
    const after = ran.countersAfter;

    const result = summary.results.find((r) => r.region === "#region-twin-1");
    expect(result.lost).toBe(true);
    expect(after.regionsLost - before.regionsLost).toBe(1);
    expect(after.replayPasses - before.replayPasses).toBe(1);
    expect(after.regionsWritten - before.regionsWritten).toBe(0);

    // Neither twin was written, and neither moved. Binding to "the best one" is
    // exactly the high-confidence-ambiguous error the predicate refuses.
    const twins = await page.evaluate(() => [
      window.__laheReplay.text("#region-twin-1"),
      window.__laheReplay.text("#region-twin-2")
    ]);
    expect(twins[0]).toBe("Two clients have not accepted the invite yet.");
    expect(twins[1]).toBe("Two clients have not accepted the invite yet.");

    const item = await page.evaluate(() => window.__laheReplay.itemFor("#region-twin-1"));
    expect(item.region.lost.code).toBe("ANCHOR_LOST");
    expect(item.region.lost.reason).toContain("more than one place");

    const card = await page.evaluate(() => window.__laheReplay.card("#region-twin-1"));
    expect(card.badges).toContain("ANCHOR_LOST");
  });
});
