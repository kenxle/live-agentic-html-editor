// Ranked test 15: two neighbouring regions never merge into one record.
//
// Two REAL Cmd-Shift-E sessions in the browser, on two paragraphs with nothing
// between them, resolved in both orders. A pure-function version of this test
// proves nothing: the merge bug lives in edit-state boundaries, not in the
// anchor predicate, and an implementation that made a whole container editable
// (or that kept one session open while the reviewer moved) passes every unit
// test and still hands the agent one record holding two paragraphs of text.
//
// "Resolved in either order" is the second half, and it is why each order gets
// its own run: the two records are retired one at a time, in the opposite order
// to the one they were made in, and the survivor has to come through
// byte-identical.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/editing-doc.html";

const ORIGINAL = {
  alpha: "Runners come back too fast after a layoff.",
  beta: "The first two weeks feel easy and the third week hurts."
};

const ADDED = {
  alpha: " Most of them know it while they are doing it.",
  beta: " The fourth week is spent injured."
};

async function editAndType(page, blockId, text) {
  await placeCaret(page, { selector: "#" + blockId, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(
    page,
    (id) => {
      const state = window.__laheEdit.state();
      return state.open && state.blockId === id;
    },
    blockId,
    { message: "Cmd-Shift-E to put #" + blockId + " into edit state, and only that block" }
  );

  const length = await page.evaluate((id) => document.getElementById(id).textContent.length, blockId);
  await placeCaret(page, { selector: "#" + blockId, offset: length });
  await page.keyboard.type(text, { delay: 20 });

  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
    message: "Esc to commit the edit on #" + blockId
  });
}

// Everything a record says about itself that this test cares about, plus where
// its anchor actually lands on the page right now.
async function describeRecords(page) {
  return page.evaluate(() =>
    window.__laheEdit.items().map((item) => ({
      id: item.id,
      kind: item.kind,
      state: item.state,
      before: item.before,
      after: item.after,
      label: item.region.label,
      resolvesTo: window.__laheEdit.resolveRegion(item.id)
    }))
  );
}

test.describe("2A: two neighbouring regions stay two records (R30)", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "editing-two" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  for (const order of [["alpha", "beta"], ["beta", "alpha"]]) {
    const [firstId, secondId] = order;

    test(`edited ${firstId} then ${secondId}: two records, two regions, neither merged`, async ({ page }) => {
      await page.goto(pages.urlFor(FIXTURE) + "?review=edit-two-" + firstId);

      await editAndType(page, firstId, ADDED[firstId]);
      await editAndType(page, secondId, ADDED[secondId]);

      const records = await describeRecords(page);
      expect(records, "two edit sessions are two records").toHaveLength(2);

      const byBlock = {};
      records.forEach((row) => {
        expect(row.resolvesTo.bound, "every record's anchor binds to a live block").toBe(true);
        byBlock[row.resolvesTo.elementId] = row;
      });

      expect(Object.keys(byBlock).sort(), "one record per block, and they are the two blocks edited").toEqual([
        "alpha",
        "beta"
      ]);
      expect(byBlock.alpha.id).not.toBe(byBlock.beta.id);

      ["alpha", "beta"].forEach((id) => {
        expect(byBlock[id].kind).toBe("edit");
        expect(byBlock[id].state).toBe("ready");
        // The merge bug's signature: one record whose text is both paragraphs.
        expect(byBlock[id].before, "#" + id + "'s before is its own paragraph, whole and alone").toBe(
          ORIGINAL[id]
        );
        expect(byBlock[id].after).toBe(ORIGINAL[id] + ADDED[id]);
        expect(byBlock[id].after).not.toContain(ORIGINAL[id === "alpha" ? "beta" : "alpha"]);
      });

      // The page agrees with both records, separately.
      expect(await page.evaluate(() => window.__laheEdit.blockText("alpha"))).toBe(ORIGINAL.alpha + ADDED.alpha);
      expect(await page.evaluate(() => window.__laheEdit.blockText("beta"))).toBe(ORIGINAL.beta + ADDED.beta);

      // --- resolved in the opposite order to the one they were made in ------

      const undoneFirst = byBlock[secondId];
      const survivor = byBlock[firstId];

      const undone = await page.evaluate((id) => window.__laheEdit.undo(id), undoneFirst.id);
      expect(undone.reverted).toBe(true);

      const afterOne = await describeRecords(page);
      expect(afterOne, "retiring one record retires exactly one").toHaveLength(1);
      expect(afterOne[0].id).toBe(survivor.id);
      expect(afterOne[0].after, "the surviving record is byte-identical to what it was").toBe(survivor.after);
      expect(
        await page.evaluate((id) => window.__laheEdit.blockText(id), secondId),
        "the undone block is back to the page's own wording"
      ).toBe(ORIGINAL[secondId]);
      expect(
        await page.evaluate((id) => window.__laheEdit.blockText(id), firstId),
        "and the other block was not touched"
      ).toBe(ORIGINAL[firstId] + ADDED[firstId]);

      const last = await page.evaluate((id) => window.__laheEdit.undo(id), survivor.id);
      expect(last.reverted).toBe(true);
      expect(await page.evaluate(() => window.__laheEdit.items())).toHaveLength(0);
      expect(await page.evaluate((id) => window.__laheEdit.blockText(id), firstId)).toBe(ORIGINAL[firstId]);
    });
  }

  test("edit state is on one block, and its neighbour stays a plain part of the page", async ({ page }) => {
    // The positive control for the assertion above: if the library made a
    // container editable, both paragraphs would carry the editing attributes
    // and the two-record assertion would still pass by luck.
    await page.goto(pages.urlFor(FIXTURE) + "?review=edit-two-scope");

    await placeCaret(page, { selector: "#alpha", offset: 0 });
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__laheEdit.isEditing(), undefined, {
      message: "edit state to open on #alpha"
    });

    const alpha = await page.evaluate(() => window.__laheEdit.blockAttrs("alpha"));
    const beta = await page.evaluate(() => window.__laheEdit.blockAttrs("beta"));
    const body = await page.evaluate(() => document.body.getAttribute("contenteditable"));

    expect(alpha.contenteditable).toBe("true");
    expect(alpha.spellcheck, "the platform must not rewrite a word and have it recorded as intent").toBe(
      "false"
    );
    expect(beta.contenteditable, "the neighbour is still the page").toBe(undefined);
    expect(body, "and so is everything above it").toBe(null);

    // The frame is real, and it is over the block the reviewer is in.
    const frame = await page.evaluate(() => window.__laheEdit.frameRect());
    const block = await page.locator("#alpha").boundingBox();
    expect(frame, "the block in edit state is visibly framed").toBeTruthy();
    expect(Math.abs(frame.y - block.y)).toBeLessThan(12);
    expect(frame.width).toBeGreaterThanOrEqual(block.width);
    expect(await page.evaluate(() => window.__laheEdit.frameLabel())).toContain("Esc to finish");

    // And it is drawn in the library's own root, not written onto the page.
    expect(await page.evaluate(() => document.querySelectorAll(".lahe-edit-frame").length)).toBe(0);
  });
});
