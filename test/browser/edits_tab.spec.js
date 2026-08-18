// 3D's done bar: after a session with six hand edits including one
// formatting-only change, the Edits tab lists six before-and-after rows, none of
// them appear in the Active thread, and the list exports through 3C's pinned
// exportRecords seam.
//
// It is a REAL session on a real page: six hand edits through the real editing
// surface (four typed edits, one delete, one bold), plus a real comment through
// the real comment surface, because "kept apart from the comment thread" cannot
// be measured against a thread with nothing in it.
//
// The export half runs against a one-file stub of 3C's pinned API
// (test/browser/support/export_stub.js), which calls the real frozen formatter.
// The stub is REPLACED AT THE PHASE 3 STITCH, and the second test here is the
// one that proves the button is honest when the module is genuinely absent.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/edits-tab-doc.html";
const REVIEW = "review-3d";

// The four typed edits. Each one appends a sentence, so before and after differ
// in text and the record is kind `edit`.
const TYPED = [
  { block: "one", add: " Nobody has ever asked her to." },
  { block: "two", add: " Two of them read it on Monday." },
  { block: "three", add: " They read it at the gym instead." },
  { block: "four", add: " One page would do." }
];

function fixtureUrl(server) {
  return server.urlFor(FIXTURE) + "?review=" + REVIEW;
}

async function typeEdit(page, blockId, text) {
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

  const length = await page.evaluate((id) => document.getElementById(id).textContent.length, blockId);
  await placeCaret(page, { selector: "#" + blockId, offset: length });
  await page.keyboard.type(text, { delay: 10 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdits.isEditing() === false, undefined, {
    message: "Esc to commit the edit on #" + blockId
  });
}

// The formatting-only change: same words, one of them emphasized. It is made
// through the real edit session and the real format command, because a record
// hand-built as kind format_only would prove nothing about the row.
async function boldAWord(page, blockId, word) {
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
  const selected = await page.evaluate(
    ([id, w]) => window.__laheEdits.selectWordIn(id, w),
    [blockId, word]
  );
  expect(selected, "the word to select inside #" + blockId).toBe(true);
  await page.evaluate(() => window.__laheEdits.format("bold"));
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdits.isEditing() === false, undefined, {
    message: "Esc to commit the formatting-only change on #" + blockId
  });
}

// The whole session: six hand edits and one comment.
async function runSession(page) {
  for (const one of TYPED) await typeEdit(page, one.block, one.add);
  await page.evaluate(() => window.__laheEdits.deleteBlock("gone"));
  await boldAWord(page, "format", "ten");
  const commentId = await page.evaluate(() =>
    window.__laheEdits.commentOn("say", "opposite", "This contradicts the paragraph under it.")
  );
  expect(commentId, "the comment to be made through the real comment surface").toBeTruthy();
  return commentId;
}

test.describe("3D: the Edits tab", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "edits-tab" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("six hand edits become six before-and-after rows, apart from the thread, and they export", async ({
    page
  }) => {
    await page.goto(fixtureUrl(pages));
    await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, {
      message: "the real boot to put the library and the fixture's readers on the page"
    });

    const commentId = await runSession(page);

    // Six records, and the kinds the row rendering has to tell apart.
    const kinds = await page.evaluate(() =>
      window.__laheEdits
        .items()
        .filter((i) => i.kind === "edit" || i.kind === "delete" || i.kind === "format_only")
        .map((i) => i.kind)
    );
    expect(kinds.length, "six hand edits in the store").toBe(6);
    expect(kinds.filter((k) => k === "format_only").length, "one formatting-only change").toBe(1);
    expect(kinds.filter((k) => k === "delete").length, "one deletion").toBe(1);

    // Six rows in the tab.
    expect(await page.evaluate(() => window.__laheEdits.rowCount()), "six rows in the Edits tab").toBe(6);

    const rows = await page.evaluate(() => window.__laheEdits.rows());
    expect(rows.length).toBe(6);
    // Newest first: the last hand edit made is the first row.
    expect(rows[0].kind, "the newest hand edit is the formatting-only one, at the top").toBe("format_only");

    for (const row of rows) {
      expect(typeof row.before, "every row carries a before: " + row.id).toBe("string");
      expect(row.before.length, "the before is not empty: " + row.id).toBeGreaterThan(0);
    }

    const deletion = rows.find((r) => r.kind === "delete");
    expect(deletion.after, "a delete row reads as a deletion rather than as an empty edit").toMatch(/deleted/i);

    const formatOnly = rows.find((r) => r.kind === "format_only");
    expect(formatOnly.before, "the formatting-only row's words are unchanged").toBe(formatOnly.after);
    expect(
      formatOnly.structure,
      "the formatting-only row says what changed structurally"
    ).toMatch(/strong|bold|b>/i);

    const typedRow = rows.find((r) => r.kind === "edit");
    expect(typedRow.after, "an edit row's after is the reviewer's text").not.toBe(typedRow.before);

    // None of them are in the Active thread. Two readings of the same claim: the
    // rail's own count for the Active tab, and the rows really in that pane.
    expect(await page.evaluate(() => window.__laheEdits.rowsInPane("active")), "no edit row in the Active pane").toEqual([]);
    expect(await page.evaluate(() => window.__laheEdits.countFor("active")), "the Active tab holds the comment and nothing else").toBe(1);
    expect(await page.evaluate(() => window.__laheEdits.countFor("edits")), "the Edits tab holds the six hand edits").toBe(6);
    expect(
      await page.evaluate(() => window.__laheEdits.pillCount()),
      "all six unimplemented direct edits count as incomplete alongside the comment"
    ).toBe("7 (7)");

    const inEditsPane = await page.evaluate(() => window.__laheEdits.rowsInPane("edits"));
    expect(inEditsPane.length, "all six rows are in the Edits pane").toBe(6);
    expect(inEditsPane.map((r) => r.id)).not.toContain(commentId);

    // The list exports through 3C's real seam: the click delivers the file and
    // hands back the formatter's text, labeled as a slice (the edit list is a
    // subset of the review, never the whole).
    expect(await page.evaluate(() => window.__laheEdits.exportEnabled()), "the export button is live").toBe(true);
    const [download, exported] = await Promise.all([
      page.waitForEvent("download"),
      page.evaluate(() => window.__laheEdits.clickExport())
    ]);
    expect(exported.ok, "the export succeeded").toBe(true);
    expect(typeof exported.text, "the button returns the formatter's text").toBe("string");
    expect(exported.count, "the six hand edits went through the seam").toBe(6);
    expect(exported.text).toContain(TYPED[0].add.trim());
    expect(download.suggestedFilename(), "the click really delivered a file").toMatch(/\.txt$/);
  });

  // A CROSS-TASK DEFECT 3D found and cannot fix in its own file.
  //
  // comments.outstanding() returns every record that is not handled, hand edits
  // included, so 1D's Active tab builds a comment row for each hand edit and
  // attaches it INTO the edit's card. The card then carries "Empty draft" and a
  // Reword and Delete pair under the before-and-after row: the comment thread's
  // machinery rendered onto a hand edit, which is half of R32 broken.
  //
  // The fix is one filter in src/layer/tab_active.js (1D's file, not 3D's):
  // outstanding items of kind comment or note. The test is written here so the
  // stitch has something to fix against; it is fixme so it reports rather than
  // failing a branch that cannot land the fix.
  test("a hand edit's card carries no comment-thread row (1D's tab_active.js)", async ({ page }) => {
    await page.goto(fixtureUrl(pages));
    await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, { message: "the real boot" });
    await typeEdit(page, "one", " One line is enough to make a row.");

    const cardText = await page.evaluate(() => {
      const pane = window.__lahe.handle.rail.tabBody("edits");
      return pane.querySelector(".card").textContent;
    });
    expect(cardText, "no draft label and no Reword/Delete pair on a hand edit").not.toMatch(/Empty draft|Reword/);
  });

  // The export module ships in the bundle now, so "absent" can only mean the
  // namespace was lost at runtime. The guard's promise is unchanged: the button
  // says so instead of failing quietly.
  test("with the export namespace gone, the button says so instead of failing quietly", async ({ page }) => {
    await page.goto(fixtureUrl(pages));
    await pollPage(page, () => !!window.__lahe && !!window.__laheEdits, undefined, {
      message: "the real boot to put the library and the fixture's readers on the page"
    });
    await page.evaluate(() => {
      delete window.LAHE.exporter;
      delete window.LAHE.export;
    });
    await typeEdit(page, "one", " One line is enough to make a row.");

    expect(await page.evaluate(() => window.__laheEdits.rowCount())).toBe(1);
    const result = await page.evaluate(() => window.__laheEdits.clickExport());
    expect(result.ok, "the export reports failure rather than pretending").toBe(false);
    expect(result.reason).toMatch(/export/i);
    expect(await page.evaluate(() => window.__laheEdits.exportTitle())).toMatch(/export/i);
  });
});
