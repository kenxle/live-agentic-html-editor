// Ranked test 17: `before` is pinned at FIRST TOUCH.
//
// Enter edit state, type, commit, re-enter, type again, commit. One record, one
// id, the revision bumped, and `before` byte-identical to the page's original
// wording BOTH times.
//
// The bug this catches is quiet and expensive. If `before` drifts to the last
// committed wording, everything on screen still looks right: the rail shows the
// edit, the page shows the new text. But replay's branch two never matches the
// source again, so the agent receives a diff that is a no-op against the file it
// is supposed to change, and nobody finds out until the change silently does not
// land. So the assertion is byte-for-byte against the string that was in the
// HTML, not against a re-read of the record.
//
// Every gesture here is the reviewer's: the caret goes in the block, Cmd-Shift-E
// enters edit state, real keystrokes type, Esc commits.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/editing-doc.html";

// The page's own wording, exactly as it is in editing-doc.html. Written out
// rather than read from the DOM, because a test that reads the page for its
// expectation cannot tell a pinned `before` from a drifting one.
const ORIGINAL_ALPHA = "Runners come back too fast after a layoff.";

const FIRST_GO = " Most of them know it while they are doing it.";
const SECOND_GO = " Say it once, plainly.";

async function editBlockWithCaret(page, selector) {
  await placeCaret(page, { selector: selector, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__laheEdit.isEditing(), undefined, {
    message: "Cmd-Shift-E to put the block under the caret into edit state"
  });
}

// Types at the END of the block, where a reviewer adding a sentence would.
async function typeAtEnd(page, selector, text) {
  const length = await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await placeCaret(page, { selector: selector, offset: length });
  await page.keyboard.type(text, { delay: 20 });
}

async function commitWithEscape(page) {
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
    message: "Esc to commit the edit and give the block back to the page"
  });
}

test.describe("2A: before is pinned at first touch (R29)", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "editing" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("two edit sessions on one block leave one record, one id, rev 2, and the original before", async ({
    page
  }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=edit-before");

    // --- first session ------------------------------------------------------

    await editBlockWithCaret(page, "#alpha");
    await typeAtEnd(page, "#alpha", FIRST_GO);
    await commitWithEscape(page);

    const afterFirst = await page.evaluate(() => window.__laheEdit.items());
    expect(afterFirst, "one edit session is one record").toHaveLength(1);

    const first = afterFirst[0];
    expect(first.kind).toBe("edit");
    expect(first.state, "a committed edit is ready for the agent").toBe("ready");
    expect(first.rev, "the first commit is revision one").toBe(1);
    expect(first.before, "before is the page's own wording").toBe(ORIGINAL_ALPHA);
    expect(first.after).toBe(ORIGINAL_ALPHA + FIRST_GO);

    // --- second session, on the same block ----------------------------------

    await editBlockWithCaret(page, "#alpha");
    await typeAtEnd(page, "#alpha", SECOND_GO);
    await commitWithEscape(page);

    const afterSecond = await page.evaluate(() => window.__laheEdit.items());
    expect(afterSecond, "re-entering the same block rewords the SAME record").toHaveLength(1);

    const second = afterSecond[0];
    expect(second.id, "one id across both sessions").toBe(first.id);
    expect(second.rev, "the second commit bumps the revision exactly once").toBe(2);
    expect(second.after).toBe(ORIGINAL_ALPHA + FIRST_GO + SECOND_GO);

    // The assertion this whole test exists for. Byte for byte: R3's named
    // failure is a comma that came back as an em dash, and an equality that
    // passes on a lookalike string would miss it.
    expect(
      Buffer.compare(Buffer.from(second.before, "utf8"), Buffer.from(ORIGINAL_ALPHA, "utf8")),
      "before is byte-identical to the original page wording after the SECOND commit"
    ).toBe(0);

    // Branch three of replay reads this. The first committed wording is kept,
    // and the current one is not counted as an earlier version of itself.
    const priorAfters = second.after_history.map((entry) => entry.after);
    expect(priorAfters, "the applied-after history carries both committed wordings").toEqual([
      ORIGINAL_ALPHA + FIRST_GO,
      ORIGINAL_ALPHA + FIRST_GO + SECOND_GO
    ]);

    // And the page really says what the record says it says.
    expect(await page.evaluate(() => window.__laheEdit.blockText("alpha"))).toBe(
      ORIGINAL_ALPHA + FIRST_GO + SECOND_GO
    );
  });

  test("committing does not bump the revision a second time on the way out", async ({ page }) => {
    // The blur double-commit. Clearing edit state removes contenteditable,
    // which fires blur, whose handler commits again and bumps rev. One edit
    // then reaches the agent as a rewording that never happened, and a reply
    // naming revision one is refused for no reason.
    await page.goto(pages.urlFor(FIXTURE) + "?review=edit-once");

    await editBlockWithCaret(page, "#beta");
    await typeAtEnd(page, "#beta", " The fourth is spent injured.");
    await commitWithEscape(page);

    const items = await page.evaluate(() => window.__laheEdit.items());
    expect(items).toHaveLength(1);
    expect(items[0].rev, "one commit, one revision").toBe(1);
    expect(items[0].after_history, "and one entry in the history").toHaveLength(1);

    // A second Escape with nothing open must not mint, commit, or bump anything.
    await page.keyboard.press("Escape");
    const again = await page.evaluate(() => window.__laheEdit.items());
    expect(again).toHaveLength(1);
    expect(again[0].rev).toBe(1);
  });

  test("entering edit state and leaving it unchanged leaves no record behind", async ({ page }) => {
    // A reviewer who opens a block, reads it, and presses Esc has said nothing.
    // A draft record for that is a row in the rail and a line in the agent's
    // queue for an edit that does not exist.
    await page.goto(pages.urlFor(FIXTURE) + "?review=edit-nochange");

    await editBlockWithCaret(page, "#alpha");
    await commitWithEscape(page);

    expect(await page.evaluate(() => window.__laheEdit.items())).toHaveLength(0);
    expect(await page.evaluate(() => window.__laheEdit.blockText("alpha"))).toBe(ORIGINAL_ALPHA);
  });
});
