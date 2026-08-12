// Ranked test 16: per-record undo, plus the two record kinds that are not an
// ordinary edit.
//
//   - undo reverts ONE record's region to its `before`, retires that record,
//     and leaves every other record untouched, with the caret in the region it
//     just put back (R28)
//   - undo a DELETE, then five replay passes: the block stays and
//     `regionsWritten` does not increment. The interaction is the point: a
//     record that has been retired must not be re-applied by the next pass,
//     which is exactly how an undone delete re-deletes itself
//   - a formatting-only change produces a record (R31), of its own kind,
//     because its `after` text is identical to its `before` by construction
//   - no record carries any node the library added (R23, R33)
//
// Replay is 2C's, and today it is the kernel's stub with live counters. That is
// enough for the counter assertion here and nothing more is claimed by it.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/editing-doc.html";

const ORIGINAL = {
  alpha: "Runners come back too fast after a layoff.",
  beta: "The first two weeks feel easy and the third week hurts.",
  gamma: "This paragraph exists to be deleted.",
  delta: "Warm up for ten minutes before every session."
};

async function enterEditState(page, blockId) {
  await placeCaret(page, { selector: "#" + blockId, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(
    page,
    (id) => {
      const state = window.__laheEdit.state();
      return state.open && state.blockId === id;
    },
    blockId,
    { message: "edit state to open on #" + blockId }
  );
}

async function editAndCommit(page, blockId, text) {
  await enterEditState(page, blockId);
  const length = await page.evaluate((id) => document.getElementById(id).textContent.length, blockId);
  await placeCaret(page, { selector: "#" + blockId, offset: length });
  await page.keyboard.type(text, { delay: 20 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
    message: "Esc to commit the edit on #" + blockId
  });
}

test.describe("2A: per-record undo, deletes, and formatting (R27, R28, R31)", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "editing-undo" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("undo reverts one record with the caret in it, and leaves the other untouched", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=edit-undo");

    await editAndCommit(page, "alpha", " They know it while they do it.");
    await editAndCommit(page, "beta", " The fourth week is spent injured.");

    const items = await page.evaluate(() => window.__laheEdit.items());
    expect(items).toHaveLength(2);
    const alphaItem = items.find((item) => item.before === ORIGINAL.alpha);
    const betaItem = items.find((item) => item.before === ORIGINAL.beta);
    expect(alphaItem && betaItem).toBeTruthy();

    // The reviewer is inside the region they are undoing, which is where the
    // caret assertion has any meaning: putting the text back must put the caret
    // back with it rather than dropping the reviewer somewhere else.
    await enterEditState(page, "alpha");

    const result = await page.evaluate((id) => window.__laheEdit.undo(id), alphaItem.id);
    expect(result.reverted).toBe(true);
    expect(result.kind).toBe("edit");

    expect(
      await page.evaluate(() => window.__laheEdit.blockText("alpha")),
      "the region is back to its before, byte for byte"
    ).toBe(ORIGINAL.alpha);
    expect(await page.evaluate(() => window.__laheEdit.caretIn("alpha")), "the caret is in the region").toBe(
      true
    );
    expect(await page.evaluate(() => window.__laheEdit.isEditing()), "and edit state closed with it").toBe(
      false
    );

    const left = await page.evaluate(() => window.__laheEdit.items());
    expect(left, "the undone record is retired, and only it").toHaveLength(1);
    expect(left[0].id).toBe(betaItem.id);
    expect(left[0].rev).toBe(betaItem.rev);
    expect(left[0].after, "the other record is byte-identical").toBe(betaItem.after);
    expect(
      await page.evaluate(() => window.__laheEdit.blockText("beta")),
      "and its region on the page was not touched"
    ).toBe(betaItem.after);

    // Undo puts the block back to the page's wording. It does not put back the
    // editing attributes, which are the library's and never the page's.
    const attrs = await page.evaluate(() => window.__laheEdit.blockAttrs("alpha"));
    expect(attrs.contenteditable).toBe(undefined);
    expect(attrs["data-lahe"]).toBe(undefined);
  });

  test("undo a delete: the block comes back where it was and five replay passes leave it alone", async ({
    page
  }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=edit-undo-delete");

    // The delete is its own gesture, from the frame the reviewer is looking at.
    await enterEditState(page, "gamma");
    // The frame is drawn before the click is aimed. Its bar is positioned by
    // its bottom edge so it cannot move a frame later, and this poll is the
    // second half of that: nothing is clicked until it is on screen.
    await pollPage(page, () => !!window.__laheEdit.buttonRect("delete"), undefined, {
      message: "the frame and its Delete block button to be drawn"
    });
    const button = await page.evaluate(() => window.__laheEdit.buttonRect("delete"));
    expect(button, "the frame offers deleting the block").toBeTruthy();
    await page.mouse.click(button.cx, button.cy);

    await pollPage(page, () => window.__laheEdit.blockExists("gamma") === false, undefined, {
      message: "the block to leave the page"
    });

    const deletedItems = await page.evaluate(() => window.__laheEdit.items());
    expect(deletedItems, "a deletion is one record").toHaveLength(1);
    expect(deletedItems[0].kind, "and it reads as a deletion, not as an edit to nothing").toBe("delete");
    expect(deletedItems[0].before).toBe(ORIGINAL.gamma);
    expect(deletedItems[0].after).toBe(null);
    expect(deletedItems[0].state).toBe("ready");

    // Back it comes, in its own place: still between the heading and #delta.
    const undone = await page.evaluate((id) => window.__laheEdit.undo(id), deletedItems[0].id);
    expect(undone.reverted).toBe(true);
    expect(undone.kind).toBe("delete");

    expect(await page.evaluate(() => window.__laheEdit.blockText("gamma"))).toBe(ORIGINAL.gamma);
    expect(
      await page.evaluate(() => document.getElementById("gamma").nextElementSibling.id),
      "and it is back where it was, not appended at the end"
    ).toBe("delta");
    expect(await page.evaluate(() => window.__laheEdit.items()), "the record is retired").toHaveLength(0);

    // Five passes. The retired record must not come back to life and re-delete
    // the block it was undone from.
    const before = await page.evaluate(() => window.__laheEdit.replayCounters());
    const after = await page.evaluate(() => window.__laheEdit.replay(5));

    expect(after.passes - before.passes, "five replay passes really ran").toBe(5);
    expect(after.regionsWritten - before.regionsWritten, "and they wrote nothing").toBe(0);
    expect(await page.evaluate(() => window.__laheEdit.blockExists("gamma")), "the block stayed").toBe(true);
    expect(await page.evaluate(() => window.__laheEdit.blockText("gamma"))).toBe(ORIGINAL.gamma);
  });

  test("a formatting-only change is still a change, and it is its own kind", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=edit-format");

    await enterEditState(page, "delta");

    // Select one word inside the block and press the frame's italic button. The
    // bar refuses focus on mousedown, so the selection the command applies to
    // is still the reviewer's.
    await page.evaluate(() => {
      const el = document.getElementById("delta");
      const text = el.firstChild; // "Warm up for "
      const range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 4); // "Warm"
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    });

    const italic = await page.evaluate(() => window.__laheEdit.buttonRect("italic"));
    expect(italic).toBeTruthy();
    await page.mouse.click(italic.cx, italic.cy);

    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
      message: "Esc to commit the formatting change"
    });

    const items = await page.evaluate(() => window.__laheEdit.items());
    expect(items, "a formatting change produces a record").toHaveLength(1);
    expect(items[0].kind, "of its own kind, because it compares on structure").toBe("format_only");
    expect(items[0].before, "the text did not change").toBe(ORIGINAL.delta);
    expect(items[0].after).toBe(ORIGINAL.delta);
    expect(items[0].before_html).not.toBe(items[0].after_html);
    expect(items[0].after_html, "and the markup did").toMatch(/<em>|<i>/);

    // R35: the tool never writes a style attribute onto a reviewed element.
    expect(items[0].after_html).not.toContain("style=");
    expect(await page.evaluate(() => window.__laheEdit.blockHtml("delta"))).not.toContain("style=");
  });

  test("no record carries anything the library added", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=edit-markers");

    await editAndCommit(page, "alpha", " A sentence typed with the frame on screen.");
    await enterEditState(page, "beta");
    await page.keyboard.press("Escape");
    await editAndCommit(page, "delta", " And one more.");

    const serialized = await page.evaluate(() => JSON.stringify(window.__laheEdit.items()));
    expect(serialized).not.toContain("data-lahe");
    expect(serialized).not.toContain("lahe-edit");
    expect(serialized).not.toContain("lahe-surface-root");
    expect(serialized).not.toContain("contenteditable");

    // The positive control: the library really did have chrome on the page
    // while those records were being made, so the assertion above is not
    // passing because nothing was ever drawn.
    expect(
      await page.evaluate(() => document.querySelectorAll("#lahe-surface-root").length),
      "the library's own host is on the page"
    ).toBe(1);
  });
});
