// RANKED TEST 2, the headline property: a human and an agent edit at once,
// and nothing gets clobbered.
//
// The reviewer is typing in region A while the page re-renders under them and
// the agent's change lands under region B. What has to be true:
//
//   - A's in-progress text and caret survive the repaints
//   - B's outstanding record re-applies, through branch two or branch three
//   - every other record is byte-identical and unchanged in state
//   - exactly zero records were written by branch four
//
// Then the interleaving that must FLAG rather than write: the page changes
// region A itself while the reviewer is in it, and on commit branch four flags
// that one card, shows both versions in full, and writes nothing.
//
// What is real here and what is standing in, stated plainly because the whole
// value of this test is that it is not theatre:
//
//   REAL   replay (2C), the anchor engine (1C), the rail and its cards (1B),
//          0A-kernel's records, the repaint engine actively reverting the page,
//          real key events through Playwright
//   STANDS IN  2A's editing surface (a contentEditable and a commit that bumps
//          the record from the DOM) and 2B's protection (the repaint engine's
//          cooperative-skip attribute plus protect.mark, which is what replay
//          asks). The full integration with 2A's real records and 2B's three
//          protection layers is CP2-mid, and it is not this file's claim.

"use strict";

const path = require("node:path");
const {
  test,
  expect,
  startStaticServer,
  readCounters,
  waitForCounter,
  assertCaretSurvivesTyping,
  configureFixture,
  stopRepaints
} = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/replay-doc.html";

test.describe("ranked test 2: a human and an agent edit at once", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "replay-2" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE));
    await page.waitForFunction(() => !!window.__laheReplay);
    await waitForCounter(page, "replayPasses", 1);
    await page.evaluate(() => window.__laheReplay.pass("boot"));
  });

  test("the reviewer types in region A while the page rewrites region B, and nothing else moves", async ({
    page
  }) => {
    // The reviewer is in region A. Protection is 2B's; here it is the repaint
    // engine's cooperative-skip attribute (so the framework flows around the
    // block) plus protect.mark (so replay refuses to write into it).
    await page.evaluate(() => window.__laheReplay.standIn.protectRegion("#region-a"));

    // Every record except A's, exactly as it stands before any of this.
    const before = await page.evaluate(() => window.__laheReplay.snapshot(["#region-a"]));
    const countersBefore = await readCounters(page);

    // A morph, which is what Turbo actually does: the frame re-renders around
    // the block the framework was asked to leave alone.
    await configureFixture(page, { flavor: "morph", target: "#live-frame", protection: "off" });

    // The reviewer types, with the page reverting itself underneath, for at
    // least five replay passes.
    const typed = await assertCaretSurvivesTyping(page, {
      selector: "#region-a",
      text: "0123456789",
      repaintIntervalMs: 100,
      keystrokeDelayMs: 40,
      minReplayPasses: 5
    });
    await stopRepaints(page);

    expect(typed.actual).toBe(typed.expected);
    expect(typed.replayPasses).toBeGreaterThanOrEqual(5);

    const countersAfter = await readCounters(page);

    // B's record re-applied. The repaint puts the page back to what the server
    // believes, and replay puts the reviewer's version back on top: branch two
    // or branch three, never a collision.
    expect(await page.evaluate(() => window.__laheReplay.text("#region-b"))).toBe(
      await page.evaluate(() => window.__laheReplay.itemFor("#region-b").after)
    );
    expect(countersAfter.regionsWritten).toBeGreaterThan(countersBefore.regionsWritten);

    // EXACTLY ZERO records written by branch four, through all of it.
    expect(countersAfter.regionsBlockedChanged - countersBefore.regionsBlockedChanged).toBe(0);

    // And nothing else moved: every other record byte-identical, state included.
    const after = await page.evaluate(() => window.__laheReplay.snapshot(["#region-a"]));
    expect(after).toBe(before);

    // Replay refused to write into the region the reviewer was in, rather than
    // never having considered it.
    expect(countersAfter.regionsSkippedProtected).toBeGreaterThan(0);
  });

  test("the page changes region A while the reviewer is in it: on commit, one card is flagged and nothing is written", async ({
    page
  }) => {
    await page.evaluate(() => window.__laheReplay.standIn.protectRegion("#region-a"));

    // The reviewer types their version and commits it. That is what their
    // record now says, and it is never overwritten by anything below.
    await page.click("#region-a");
    await page.evaluate(() => {
      const el = document.querySelector("#region-a");
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.keyboard.type(" Every Monday.");
    const mine = await page.evaluate(() => window.__laheReplay.standIn.commit("#region-a"));
    expect(mine.after).toContain("Every Monday.");

    // While it was protected, the page changed that same block: an agent landed
    // a rewrite of the source under the reviewer's feet.
    const theirs = await page.evaluate(() =>
      window.__laheReplay.rewrite(
        "#region-a",
        "The trainer and the client agree the plan together at the start of each block."
      )
    );

    const others = await page.evaluate(() => window.__laheReplay.snapshot(["#region-a"]));

    // Protection lifts, and replay runs immediately on that block. This is the
    // seam: a change the page made while the region was protected surfaces
    // here, rather than being silently swallowed.
    const released = await page.evaluate((READ) => {
      const countersBefore = eval(READ);
      const outcome = window.__laheReplay.standIn.release("#region-a");
      return { outcome: outcome, countersBefore: countersBefore, countersAfter: eval(READ) };
    }, "(function(){var c={};Object.keys(window.__lahe.counters).forEach(function(k){c[k]=window.__lahe.counters[k];});return c;})()");

    expect(released.outcome.branch).toBe("content_changed");
    expect(released.outcome.wrote).toBe(false);
    expect(released.countersAfter.regionsWritten - released.countersBefore.regionsWritten).toBe(0);
    expect(released.countersAfter.regionsBlockedChanged - released.countersBefore.regionsBlockedChanged).toBe(1);

    // R5. Neither version was overwritten: the page keeps its text, the record
    // keeps the reviewer's.
    expect(await page.evaluate(() => window.__laheReplay.text("#region-a"))).toBe(theirs);
    expect(await page.evaluate(() => window.__laheReplay.itemFor("#region-a").after)).toBe(mine.after);

    // ONE card is flagged, and it shows both versions in full.
    const card = await page.evaluate(() => window.__laheReplay.card("#region-a"));
    expect(card.badges).toContain("REPLAY_NEITHER_MATCHES");
    expect(card.conflict.yours).toBe(mine.after);
    expect(card.conflict.theirs).toBe(theirs);
    expect(card.conflict.title).toContain("Nothing was written");

    const flagged = await page.evaluate(() =>
      ["#region-b", "#region-c", "#region-format", "#region-twin-1", "#region-outside"].filter(
        (selector) => window.__laheReplay.card(selector).badges.indexOf("REPLAY_NEITHER_MATCHES") !== -1
      )
    );
    expect(flagged).toEqual([]);

    // And every other record is still byte-identical.
    expect(await page.evaluate(() => window.__laheReplay.snapshot(["#region-a"]))).toBe(others);
  });
});
