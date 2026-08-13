// CP2-mid: ranked test 2, end to end, with REAL edit records.
//
// The headline property (D7): a human and an agent edit at once and nothing
// gets clobbered. 2C already wrote this test against 0A-kernel's record fixture
// generator, with 2A's editing surface and 2B's protection standing in. This
// file is the same two halves with nothing standing in:
//
//   REAL  2A's editing surface, entered with Cmd-Shift-E and committed with Esc
//   REAL  2B's three protection layers, installed on the document
//   REAL  2C's replay engine, scheduled the way 2D will schedule it
//   REAL  the records: every one of them minted by the reviewer's own gestures
//         through 2A, written to the real store, anchored by 1C's real mint
//   REAL  the repaint engine actively reverting the page to the server's version
//
// Why this is a checkpoint of its own, before 2D merges: the seam between real
// records and replay is the one thing none of the three builders could test.
// It broke here, exactly as the plan predicted, and the two bugs are named in
// the progress doc: protection was lifting (and running the commit pass) before
// the record was written, and a change the page made to a protected block was
// restored away without anything ever telling the reviewer.
//
// Half one: the reviewer is mid-edit in region A while the page rewrites region
// B underneath. A's text and caret survive, B's committed record re-applies,
// every other record is byte-identical, and branch four writes nothing.
//
// Half two: the page rewrites region A itself while it is protected. On commit
// one card is flagged, it carries both versions in full, and nothing is written.

"use strict";

const path = require("node:path");
// The product's own string, not a copy of it: a conflict block's heading is
// design copy, and a spec that re-types it drifts the day the copy changes.
const LAHE_CONFLICT_TITLE = require("../../src/layer/replay.js").CONFLICT_TITLE;
const {
  test,
  expect,
  startStaticServer,
  pollPage,
  placeCaret,
  readCounters,
  countersAround,
  assertCaretSurvivesTyping,
  configureFixture,
  forceRepaint,
  stopRepaints
} = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/cp2-mid-doc.html";

// The page's own wording, written out rather than read back, because a test
// that reads the page for its expectation cannot tell a pinned `before` from a
// drifting one.
const SOURCE = {
  a: "The trainer writes the plan every week.",
  b: "Dana moved her long run to Saturday because of the weather.",
  c: "Marcus is resting completely on Wednesday.",
  d: "This paragraph is here to be deleted."
};

// What the agent lands on region A while the reviewer is inside it. It is a
// rewording, not a replacement: the block is still recognizably itself, which
// is what makes this branch four rather than a lost anchor.
const AGENTS_VERSION = "The trainer and the client agree the plan together at the start of each block.";

// --- the reviewer's gestures, all real -------------------------------------

async function enterEdit(page, selector) {
  await placeCaret(page, { selector: selector, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__laheCp2.isEditing(), undefined, {
    message: "Cmd-Shift-E to put the block under the caret into edit state"
  });
}

async function typeAtEnd(page, selector, text) {
  const length = await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await placeCaret(page, { selector: selector, offset: length });
  await page.keyboard.type(text, { delay: 20 });
}

async function commitWithEscape(page) {
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheCp2.isEditing() === false, undefined, {
    message: "Esc to commit the edit and give the block back to the page"
  });
}

/** One whole edit session: in, type at the end, out. Returns the record. */
async function editAndCommit(page, selector, text) {
  await enterEdit(page, selector);
  await typeAtEnd(page, selector, text);
  await commitWithEscape(page);
  return page.evaluate((sel) => window.__laheCp2.itemFor(sel), selector);
}

test.describe("CP2-mid: ranked test 2 with real records", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "cp2-mid" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test.beforeEach(async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=cp2-mid-" + Date.now());
    await pollPage(page, () => !!window.__laheCp2, undefined, { message: "the CP2-mid boot to run" });
  });

  test("the reviewer types in region A while the page rewrites region B, and nothing else moves", async ({
    page
  }) => {
    // --- the reviewer's other work, done before any of this ------------------
    //
    // Three real records, made the way a reviewer makes them: two edits and a
    // deleted block. They are what "every other record is byte-identical" is
    // about, and they are the records replay is re-applying pass after pass
    // while the reviewer types in region A.

    const recordB = await editAndCommit(page, "#region-b", " She will run it Sunday instead.");
    const recordC = await editAndCommit(page, "#region-c", " He lifts again on Thursday.");
    await page.evaluate(() => window.__laheCp2.deleteBlock("#region-d"));

    expect(recordB.state, "an edit the reviewer left is ready, not a draft").toBe("ready");
    expect(recordB.before, "before is the page's own wording, pinned at first touch").toBe(SOURCE.b);
    expect(recordB.after).toBe(SOURCE.b + " She will run it Sunday instead.");
    expect(recordC.before).toBe(SOURCE.c);

    // --- the reviewer is now in region A ------------------------------------
    //
    // They edited it once already and are back in it, which is the case that
    // has teeth: region A's record is OUTSTANDING, so replay has a committed
    // version of this very block that it would write over the reviewer's
    // in-progress sentence if protection did not stop it. A first-touch draft
    // is never replayed at all (a draft is not outstanding), so it cannot show
    // that anything protected anything.

    const firstGo = await editAndCommit(page, "#region-a", " Every Monday.");
    expect(firstGo.state).toBe("ready");
    expect(firstGo.before).toBe(SOURCE.a);

    await enterEdit(page, "#region-a");
    const openItemId = await page.evaluate(() => window.__laheCp2.state().itemId);
    expect(
      await page.evaluate(() => window.__laheCp2.protectedItemId()),
      "protection knows WHICH record the reviewer is in, which is what replay asks"
    ).toBe(openItemId);

    // Every record except the one being typed, exactly as it stands right now.
    const before = await page.evaluate((id) => window.__laheCp2.snapshot([id]), openItemId);
    const countersBefore = await readCounters(page);

    // A morph, which is what Turbo does: the frame re-renders around the block
    // the library asked to be left alone. The fixture's own protection is OFF,
    // so nothing but src/layer/protect.js is protecting anything here.
    await configureFixture(page, { flavor: "morph", target: "#live-frame", protection: "off" });

    // The reviewer types, with the page reverting itself underneath them, for
    // at least five replay passes.
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
    // The positive control. Text that survived because nothing ever damaged it
    // is not protection working.
    expect(typed.repaints, "the page really did repaint under the reviewer").toBeGreaterThanOrEqual(2);

    // B's record re-applies. The repaint puts the page back to what the server
    // believes and replay puts the reviewer's version back on top: branch two,
    // never a collision. Polled rather than read once, because the last repaint
    // may land after the last pass did.
    await pollPage(
      page,
      (args) => window.__laheCp2.text("#region-b") === args[0],
      [recordB.after],
      { message: "region B to hold the reviewer's committed wording again" }
    );

    const countersAfter = await readCounters(page);
    expect(countersAfter.regionsWritten).toBeGreaterThan(countersBefore.regionsWritten);

    // EXACTLY ZERO records written by branch four, through all of it.
    expect(countersAfter.regionsBlockedChanged - countersBefore.regionsBlockedChanged).toBe(0);
    expect(await page.evaluate(() => window.__laheCp2.flaggedIds())).toEqual([]);

    // Replay REFUSED to write into the region the reviewer was in, rather than
    // never having considered it.
    expect(countersAfter.regionsSkippedProtected).toBeGreaterThan(countersBefore.regionsSkippedProtected);

    // The deleted block stays deleted, however many times the page puts it back.
    expect(await page.evaluate(() => window.__laheCp2.exists("#region-d"))).toBe(false);

    // And nothing else moved: every other record byte-identical, state included.
    expect(await page.evaluate((id) => window.__laheCp2.snapshot([id]), openItemId)).toBe(before);

    // The reviewer's own record carries what they typed, and it is still on
    // revision one: a revision is a committed wording, and they have not left
    // the block.
    const open = await page.evaluate((id) => window.__laheCp2.itemById(id), openItemId);
    expect(open.id, "a re-entry rewords the SAME record").toBe(firstGo.id);
    expect(open.rev).toBe(1);
    expect(open.before, "before is pinned to the page's wording, not to what is on screen").toBe(SOURCE.a);
    expect(open.after).toBe(typed.expected);
  });

  test("the page rewrites region A while the reviewer is in it: on commit, one card is flagged and nothing is written", async ({
    page
  }) => {
    const recordB = await editAndCommit(page, "#region-b", " She will run it Sunday instead.");
    const recordC = await editAndCommit(page, "#region-c", " He lifts again on Thursday.");
    expect(recordC.after).toBe(SOURCE.c + " He lifts again on Thursday.");

    // The reviewer is in region A and has typed their version. It is not
    // committed yet: they are still in the block.
    await enterEdit(page, "#region-a");
    const openItemId = await page.evaluate(() => window.__laheCp2.state().itemId);
    await typeAtEnd(page, "#region-a", " Every Monday.");
    const mine = SOURCE.a + " Every Monday.";
    expect(await page.evaluate(() => window.__laheCp2.text("#region-a"))).toBe(mine);

    const others = await page.evaluate((id) => window.__laheCp2.snapshot([id]), openItemId);

    // The agent lands a rewrite of this very block, under the reviewer's feet.
    // Protection takes it back off, which is its job: the reviewer keeps their
    // caret and their sentence. What must NOT happen is that the agent's change
    // disappears without trace.
    await page.evaluate((text) => window.__laheCp2.rewrite("#region-a", text), AGENTS_VERSION);

    await pollPage(page, () => window.__laheCp2.displaced() !== null, undefined, {
      message: "protection to take the page's change back off and keep what it said"
    });
    expect(
      await page.evaluate(() => window.__laheCp2.displaced().text),
      "protection kept the page's version, which is the only copy of it anywhere"
    ).toBe(AGENTS_VERSION);
    expect(
      await page.evaluate(() => window.__laheCp2.text("#region-a")),
      "the reviewer's sentence is back on the page"
    ).toBe(mine);

    // --- the commit ---------------------------------------------------------
    //
    // Esc commits, protection lifts, and lifting it runs the pass. This is the
    // seam: the collision surfaces here or it never surfaces at all.

    const { before: countersBefore, after: countersAfter } = await countersAround(page, async () => {
      await commitWithEscape(page);
    });

    expect(countersAfter.regionsBlockedChanged - countersBefore.regionsBlockedChanged).toBe(1);
    expect(countersAfter.regionsWritten - countersBefore.regionsWritten, "R5: nothing is written").toBe(0);

    // Neither version was overwritten. The record keeps the reviewer's words,
    // and the reviewer's words are what is on the page.
    const committed = await page.evaluate((id) => window.__laheCp2.itemById(id), openItemId);
    expect(committed.state).toBe("ready");
    expect(committed.after).toBe(mine);
    expect(committed.before).toBe(SOURCE.a);
    expect(await page.evaluate(() => window.__laheCp2.text("#region-a"))).toBe(mine);

    // ONE card is flagged, and it shows BOTH versions in full.
    expect(await page.evaluate(() => window.__laheCp2.flaggedIds())).toEqual([openItemId]);
    const card = await page.evaluate(() => window.__laheCp2.card("#region-a"));
    expect(card.badges).toContain("REPLAY_NEITHER_MATCHES");
    expect(card.conflict.yours).toBe(mine);
    expect(card.conflict.theirs).toBe(AGENTS_VERSION);
    // The block asks the DECISION; "nothing was written" is the badge's line
    // (REPLAY_NEITHER_MATCHES, asserted above) and the page's own text, which
    // this test already checked. Two sentences for one fact on one card is what
    // 4B took out.
    expect(card.conflict.title).toBe(LAHE_CONFLICT_TITLE);

    const flaggedElsewhere = await page.evaluate(() =>
      ["#region-b", "#region-c"].filter(
        (selector) => window.__laheCp2.card(selector).badges.indexOf("REPLAY_NEITHER_MATCHES") !== -1
      )
    );
    expect(flaggedElsewhere).toEqual([]);
    expect(recordB.after).toBe(SOURCE.b + " She will run it Sunday instead.");

    // The flag is not ephemeral. A later pass finds the reviewer's own words on
    // the page (protection put them there) and must not read that as the
    // collision having resolved itself: the agent's version is still the source
    // and the reviewer still has not seen it decided.
    await forceRepaint(page, { flavor: "morph", target: "#live-frame", protection: "off" });
    await pollPage(page, (args) => window.__lahe.counters.replayPasses > args[0], [countersAfter.replayPasses], {
      message: "another replay pass after the commit"
    });
    const stillFlagged = await page.evaluate(() => window.__laheCp2.card("#region-a"));
    expect(stillFlagged.badges).toContain("REPLAY_NEITHER_MATCHES");
    expect(stillFlagged.conflict.theirs).toBe(AGENTS_VERSION);

    // And every other record is still byte-identical, state included.
    expect(await page.evaluate((id) => window.__laheCp2.snapshot([id]), openItemId)).toBe(others);
  });
});
