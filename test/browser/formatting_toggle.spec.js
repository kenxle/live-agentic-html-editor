// The B and I buttons, both directions, in every engine.
//
// Ken, 2026-08-23: "simply changing the bolding on a word or phrase doesn't
// seem to be captured as an edit."
//
// Applying bold always worked. Taking it off did not, and which half failed
// depended on where the bold came from:
//
//   bold through a <strong>   worked. Taking the tag off is a structural
//                             difference and the commit saw it.
//   bold through page CSS     lost. There is no HTML tag that means "not
//                             bold", so all three engines write
//                             <span style="font-weight: normal">, the style
//                             attribute is dropped on the way into the record
//                             (R35: the tool never writes one and never reports
//                             one), and the bare span left behind is not a
//                             structural difference. The page changed under the
//                             reviewer's cursor and no row appeared in the rail.
//   italic through page CSS   worse in Firefox, which declines to change the
//                             block at all: the click simply did not happen.
//
// The fix is the same shape as the Enter fix: the layer says which way the
// button is going (gestures.formatIntentFor) and writes the markup itself, in
// one vocabulary all three engines record identically. The reset is a tag,
// <not-bold> or <not-italic>, which is what lets the structural comparison see
// it without a style attribute existing anywhere.
//
// The buttons themselves were driven by no test before this file, apart from
// one italic-on-plain-text case in editing_undo.spec.js. Every case here goes
// through a real mouse click on the frame's own bar, at its own rectangle,
// because the bar lives in a closed shadow root and a click that stole focus
// from the block would format nothing and look broken.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage, placeCaret } = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/formatting-doc.html";

const WORDS = "Runners come back too fast after a layoff.";
const PHRASE = "too fast";

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

/** Select the phrase and press the bar's own button, the way a reviewer does. */
async function pressButton(page, blockId, phrase, command) {
  await enterEditState(page, blockId);
  const selected = await page.evaluate(
    ([id, text]) => window.__laheEdit.selectPhrase(id, text),
    [blockId, phrase]
  );
  expect(selected, "the phrase to format is selected").toBe(true);
  const rect = await page.evaluate((name) => window.__laheEdit.buttonRect(name), command);
  expect(rect, "the frame's " + command + " button is on screen").toBeTruthy();
  await page.mouse.click(rect.cx, rect.cy);
}

async function commit(page) {
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__laheEdit.isEditing() === false, undefined, {
    message: "Esc to commit the formatting change"
  });
}

function items(page) {
  return page.evaluate(() => window.__laheEdit.items());
}

test.describe("formatting is captured in both directions (R31)", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "formatting-toggle" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("bold on plain text is a record, and the words are untouched", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=fmt-bold-apply");

    await pressButton(page, "plain", PHRASE, "bold");
    await commit(page);

    const list = await items(page);
    expect(list, "one record, not a discarded no-op").toHaveLength(1);
    expect(list[0].kind).toBe("format_only");
    expect(list[0].before).toBe(WORDS);
    expect(list[0].after, "a formatting change does not touch the wording").toBe(WORDS);
    expect(list[0].after_html).toBe("Runners come back <strong>too fast</strong> after a layoff.");
    expect(list[0].after_html).not.toContain("style=");
    expect(await page.evaluate(() => window.__laheEdit.blockHtml("plain"))).not.toContain("style=");
  });

  test("taking bold off a <strong> is a record", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=fmt-tag-remove");

    await pressButton(page, "tagbold", PHRASE, "bold");
    await commit(page);

    const list = await items(page);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("format_only");
    expect(list[0].before_html).toContain("<strong>");
    expect(list[0].after_html, "the tag came off, which is the whole change").toBe(WORDS);
    expect(list[0].after_html).not.toContain("style=");
  });

  // THE REPORTED BUG. Before the fix this test found zero records.
  test("taking bold off text a stylesheet made bold is a record too", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=fmt-css-remove");

    await pressButton(page, "cssbold", PHRASE, "bold");
    await commit(page);

    const list = await items(page);
    expect(list, "the reported bug: this used to be zero").toHaveLength(1);
    expect(list[0].kind).toBe("format_only");
    expect(list[0].before).toBe(WORDS);
    expect(list[0].after, "the reviewer changed no words").toBe(WORDS);
    // The record says what the reviewer meant, in a tag rather than in a style
    // attribute, because a style attribute can reach neither a record nor a
    // reviewed element (R35).
    expect(list[0].after_html).toBe("Runners come back <not-bold>too fast</not-bold> after a layoff.");
    expect(list[0].after_html).not.toContain("style=");
    expect(JSON.stringify(list[0])).not.toContain("font-weight");

    // R35, on the page itself: no style attribute is left behind either.
    expect(await page.evaluate(() => window.__laheEdit.blockHtml("cssbold"))).not.toContain("style=");

    // And the reviewer SEES it. A record with no visible change is half a
    // feature: the marker renders through the library's own page-level rule.
    expect(await page.evaluate(() => window.__laheEdit.computed("#cssbold not-bold", "fontWeight"))).toBe("400");
    expect(await page.evaluate(() => window.__laheEdit.computed("#cssbold", "fontWeight"))).toBe("700");
  });

  test("taking italic off text a stylesheet made italic is a record in every engine", async ({ page }) => {
    // Firefox writes nothing at all for this one, so before the fix the block
    // was untouched and the reviewer's click vanished without trace.
    await page.goto(pages.urlFor(FIXTURE) + "?review=fmt-css-italic");

    await pressButton(page, "cssitalic", PHRASE, "italic");
    await commit(page);

    const list = await items(page);
    expect(list).toHaveLength(1);
    expect(list[0].kind).toBe("format_only");
    expect(list[0].after).toBe(WORDS);
    expect(list[0].after_html).toBe("Runners come back <not-italic>too fast</not-italic> after a layoff.");
    expect(list[0].after_html).not.toContain("style=");
    expect(await page.evaluate(() => window.__laheEdit.blockHtml("cssitalic"))).not.toContain("style=");
    expect(await page.evaluate(() => window.__laheEdit.computed("#cssitalic not-italic", "fontStyle"))).toBe(
      "normal"
    );
  });

  test("italic on plain text is a record, so both buttons are covered both ways", async ({ page }) => {
    await page.goto(pages.urlFor(FIXTURE) + "?review=fmt-italic-apply");

    await pressButton(page, "plain", PHRASE, "italic");
    await commit(page);

    const list = await items(page);
    expect(list).toHaveLength(1);
    expect(list[0].after_html).toBe("Runners come back <em>too fast</em> after a layoff.");
    expect(list[0].after_html).not.toContain("style=");
  });

  test("a repaint that puts the bold back is put back again by replay", async ({ page }) => {
    // The other half of the round trip. A record is only worth anything if a
    // replay pass can read it back and re-apply it, and a reset that replay
    // flattened would be a change the reviewer watches disappear at the next
    // rebuild. That was the second half of Ken's 2026-08-20 report about
    // breaks, and it applies to this the same way.
    await page.goto(pages.urlFor(FIXTURE) + "?review=fmt-replay");

    await pressButton(page, "cssbold", PHRASE, "bold");
    await commit(page);
    expect(await items(page)).toHaveLength(1);

    // The page rebuilds the block from its own source, bold and all.
    await page.evaluate((words) => {
      document.getElementById("cssbold").innerHTML = words;
    }, WORDS);
    expect(await page.evaluate(() => window.__laheEdit.blockHtml("cssbold"))).toBe(WORDS);

    const summary = await page.evaluate(() =>
      window.LAHE.replay.runPass("test", { items: () => window.__laheEdit.items() })
    );
    expect(summary.wrote, "replay recognised the block and wrote the record back").toBe(1);
    expect(await page.evaluate(() => window.__laheEdit.blockHtml("cssbold"))).toBe(
      "Runners come back <not-bold>too fast</not-bold> after a layoff."
    );
    expect(await page.evaluate(() => window.__laheEdit.computed("#cssbold not-bold", "fontWeight"))).toBe(
      "400"
    );
  });

  test("un-bolding and bolding the same words again leaves nothing behind", async ({ page }) => {
    // The marker comes back out rather than having a <strong> nested inside it,
    // so the block ends exactly where it started and the commit correctly finds
    // there is nothing to tell an agent about.
    await page.goto(pages.urlFor(FIXTURE) + "?review=fmt-round-trip");

    await pressButton(page, "cssbold", PHRASE, "bold");
    expect(await page.evaluate(() => window.__laheEdit.blockHtml("cssbold"))).toContain("<not-bold>");

    await page.evaluate(([id, text]) => window.__laheEdit.selectPhrase(id, text), ["cssbold", PHRASE]);
    const rect = await page.evaluate(() => window.__laheEdit.buttonRect("bold"));
    await page.mouse.click(rect.cx, rect.cy);
    await commit(page);

    expect(
      await page.evaluate(() => window.__laheEdit.blockHtml("cssbold")),
      "the block is back to the markup it started with"
    ).toBe(WORDS);
    expect(await items(page), "and a change that undid itself is not an edit").toHaveLength(0);
  });
});
