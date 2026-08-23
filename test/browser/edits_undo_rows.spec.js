// R28 from the REVIEWER's side: every hand edit can be undone on its own,
// with a button they can actually press.
//
// The walk on 2026-08-14 found editing.undo(id) working perfectly and reachable
// only from the console: the rail's Edits tab drew a before-and-after row and no
// way to take it back. This spec presses the row's own Undo, at its on-screen
// geometry, in a real browser, for each of the three hand-edit kinds.
//
// It is the reviewer-facing half of editing_undo.spec.js, and it keeps that
// file's counter assertion: an undone delete must not be re-applied by the next
// replay pass.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/edits-tab-doc.html";
const REVIEW = "review-undo-rows";

const ORIGINAL = {
  one: "The trainer writes the plan every week.",
  gone: "This paragraph exists to be deleted.",
  format: "Warm up for ten minutes before every session."
};

const ADDED = " Nobody has ever asked her to.";

function fixtureUrl(server) {
  return server.urlFor(FIXTURE) + "?review=" + REVIEW;
}

async function bootAndWait(page, server) {
  await page.goto(fixtureUrl(server));
  await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, {
    message: "the real boot to put the library and the fixture's readers on the page"
  });
}

async function enterEditState(page, blockId) {
  await placeCaret(page, { selector: "#" + blockId, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(
    page,
    (id) => {
      const state = window.__lahe.editState();
      return state.open && state.blockId === id;
    },
    blockId,
    { message: "Cmd-Shift-E to put #" + blockId + " into edit state" }
  );
}

async function typeEdit(page, blockId, text) {
  await enterEditState(page, blockId);
  const length = await page.evaluate((id) => document.getElementById(id).textContent.length, blockId);
  await placeCaret(page, { selector: "#" + blockId, offset: length });
  await page.keyboard.type(text, { delay: 10 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdits.isEditing() === false, undefined, {
    message: "Esc to commit the edit on #" + blockId
  });
}

async function boldAWord(page, blockId, word) {
  await enterEditState(page, blockId);
  const selected = await page.evaluate(([id, w]) => window.__laheEdits.selectWordIn(id, w), [blockId, word]);
  expect(selected, "the word to select inside #" + blockId).toBe(true);
  await page.evaluate(() => window.__laheEdits.format("bold"));
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdits.isEditing() === false, undefined, {
    message: "Esc to commit the formatting-only change on #" + blockId
  });
}

// One session: an edit, a formatting-only change, and a delete.
async function runSession(page) {
  await typeEdit(page, "one", ADDED);
  await boldAWord(page, "format", "ten");
  await page.evaluate(() => window.__laheEdits.deleteBlock("gone"));
  await pollPage(page, () => window.__laheEdits.rowCount() === 3, undefined, {
    message: "three hand-edit rows in the Edits tab"
  });
  await page.evaluate(() => window.__laheEdits.showEditsTab());
}

/** The real press: the row's own button, at its on-screen geometry. */
async function pressUndo(page, id) {
  const rect = await page.evaluate((itemId) => window.__laheEdits.undoButtonInfo(itemId), id);
  expect(rect, "an Undo button on the row for " + id).toBeTruthy();
  expect(rect.visible, "the Undo button is really on screen for " + id).toBe(true);
  await page.mouse.click(rect.cx, rect.cy);
  return rect;
}

function rowsById(rows) {
  const out = {};
  rows.forEach((row) => {
    out[row.kind] = row;
  });
  return out;
}

test.describe("R28 in the rail: every hand edit has its own Undo", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "edits-undo-rows" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("every hand-edit row offers Undo, and undoing the delete puts the block back for good", async ({
    page
  }) => {
    await bootAndWait(page, pages);
    await runSession(page);

    const rows = rowsById(await page.evaluate(() => window.__laheEdits.rows()));
    expect(Object.keys(rows).sort(), "one row of each hand-edit kind").toEqual([
      "delete",
      "edit",
      "format_only"
    ]);

    // Every kind, not just the ordinary edit: a reviewer who deletes a block by
    // mistake has the same right to take it back.
    for (const kind of ["edit", "format_only", "delete"]) {
      const info = await page.evaluate((id) => window.__laheEdits.undoButtonInfo(id), rows[kind].id);
      expect(info, "an Undo button on the " + kind + " row").toBeTruthy();
      expect(info.label, "it says Undo on the " + kind + " row").toMatch(/undo/i);
      expect(info.visible, "and it is on screen on the " + kind + " row").toBe(true);
      expect(info.disabled, "and it is pressable on the " + kind + " row").toBe(false);
    }

    // The delete: pressed, the block comes back where it was.
    await pressUndo(page, rows.delete.id);
    await pollPage(page, () => window.__laheEdits.blockExists("gone"), undefined, {
      message: "the deleted block to come back"
    });
    expect(await page.evaluate(() => window.__laheEdits.blockText("gone"))).toBe(ORIGINAL.gone);
    expect(
      await page.evaluate(() => document.getElementById("gone").nextElementSibling.id),
      "in its own place, not appended at the end"
    ).toBe("format");

    // The record retired, so the row left the tab.
    await pollPage(page, () => window.__laheEdits.rowCount() === 2, undefined, {
      message: "the undone row to leave the Edits tab"
    });
    expect(
      (await page.evaluate(() => window.__laheEdits.rows())).map((r) => r.id),
      "and it is the delete row that left"
    ).not.toContain(rows.delete.id);

    // Five replay passes. A retired record must not come back to life and
    // re-delete the block the reviewer just undid.
    // Both counter reads and the five passes happen inside ONE evaluate. The
    // page runs replay passes of its own, so with a separate evaluate for the
    // baseline, one of those can land in the gap and the delta reads six passes
    // where the test drove five. That is the harness racing itself, not a claim
    // about the product, and it failed a lane at random depending on which
    // engine got there first. replay() is synchronous, so once this function
    // starts nothing can interleave.
    const ran = await page.evaluate(() => {
      const start = window.__laheEdits.replayCounters();
      const end = window.__laheEdits.replay(5);
      return {
        passes: end.passes - start.passes,
        regionsWritten: end.regionsWritten - start.regionsWritten
      };
    });
    expect(ran.passes, "five replay passes really ran").toBe(5);
    expect(ran.regionsWritten, "and they wrote nothing").toBe(0);
    expect(await page.evaluate(() => window.__laheEdits.blockExists("gone")), "the block stayed").toBe(true);
  });

  test("undoing one edit restores its wording and leaves the other rows alone", async ({ page }) => {
    await bootAndWait(page, pages);
    await runSession(page);

    const rows = rowsById(await page.evaluate(() => window.__laheEdits.rows()));
    const formatBefore = rows.format_only;
    const deleteBefore = rows.delete;

    await pressUndo(page, rows.edit.id);
    await pollPage(page, () => window.__laheEdits.rowCount() === 2, undefined, {
      message: "the undone edit row to leave the Edits tab"
    });

    expect(
      await page.evaluate(() => window.__laheEdits.blockText("one")),
      "the region is back to the page's own wording"
    ).toBe(ORIGINAL.one);

    const left = rowsById(await page.evaluate(() => window.__laheEdits.rows()));
    expect(Object.keys(left).sort(), "the other two rows are still there").toEqual(["delete", "format_only"]);
    expect(left.format_only.id).toBe(formatBefore.id);
    expect(left.format_only.before, "byte-identical").toBe(formatBefore.before);
    expect(left.delete.id).toBe(deleteBefore.id);

    // And their regions on the page were not touched: the deleted block is
    // still gone, and the formatted one still carries its markup.
    expect(await page.evaluate(() => window.__laheEdits.blockExists("gone"))).toBe(false);
    expect(await page.evaluate(() => window.__laheEdits.blockText("format"))).toBe(ORIGINAL.format);
    expect(await page.evaluate(() => window.__laheEdits.blockHtml("format"))).toMatch(/<b>|<strong>/i);
  });

  test("an undo that cannot revert says so on the row instead of failing quietly", async ({ page }) => {
    await bootAndWait(page, pages);
    await typeEdit(page, "one", ADDED);
    await page.evaluate(() => window.__laheEdits.showEditsTab());
    const row = (await page.evaluate(() => window.__laheEdits.rows()))[0];

    // The region this record points at leaves the page under the reviewer's
    // feet, which is exactly the case editing.undo answers with reverted:false.
    await page.evaluate(() => {
      const el = document.getElementById("one");
      el.parentNode.removeChild(el);
    });

    await pressUndo(page, row.id);
    await pollPage(page, (id) => !!window.__laheEdits.rowFailure(id), row.id, {
      message: "the row to say the undo failed"
    });
    const said = await page.evaluate((id) => window.__laheEdits.rowFailure(id), row.id);
    expect(said, "it names why, in the reviewer's words").toMatch(/not on the page|could not/i);
    expect(
      (await page.evaluate(() => window.__laheEdits.rows())).map((r) => r.id),
      "and the record is kept, because nothing was put back"
    ).toContain(row.id);
  });
});
