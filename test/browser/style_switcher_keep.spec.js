// The whole keep flow, through a real review of a Markdown source (V23), and
// the style control on a rendered Markdown page (V8, the Markdown half).
//
// docs/features/20260930.01_style_switcher, plan Test List rows V8 and V23.
// Preview a style, ask the agent to keep it, see the note in review.json with
// its marker, land a scripted reply, add the frontmatter line the way the
// agent would, and watch the rebuild reload the page on its own into the kept
// style with the preview key gone.
//
// It runs on the whole feature: `lahe style add`, the page server answering
// `.lahe-styles/` from the installed styles, and the renderer turning
// `lahe-style: <id>` into the link and marking the house bundle
// `data-lahe-doc-style`.

"use strict";

const { test, expect, pollPage, pollUntil } = require("../helpers");
const world$ = require("./support/lahe_world");
const styles = require("./support/style_fixtures");

test.describe.configure({ mode: "serial" });

const SOURCE = [
  "# Coming back after a layoff",
  "",
  "A six-week return plan for a runner who stopped for a month or more.",
  "",
  "## The first two weeks",
  "",
  "Runners come back too fast after a layoff. They know it while they are doing it.",
  "",
  "The first two weeks feel easy and the third week hurts.",
  ""
].join("\n");

function center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function openPanel(page) {
  const before = await page.evaluate(() => window.__lahe.stylePanel());
  expect(before.button.shown, "a rendered Markdown page shows the Document style button (V8)").toBe(true);
  // Opened from closed: a dropdown left open by an earlier step is closed first.
  if (before.mode === "open") {
    await page.mouse.click(center(before.button.rect).x, center(before.button.rect).y);
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, { message: "the dropdown to close" });
  }
  await page.mouse.click(center(before.button.rect).x, center(before.button.rect).y);
  await pollPage(page, () => window.__lahe.stylePanel().mode === "open", undefined, { message: "the dropdown to open" });
  await pollPage(page, () => window.__lahe.handle.styleList().loaded === true, undefined, {
    message: "the style list to answer"
  });
  return page.evaluate(() => window.__lahe.stylePanel());
}

async function click(page, rect) {
  await page.mouse.click(center(rect).x, center(rect).y);
}

test.describe("keeping a style on a Markdown page, end to end (V8, V23)", () => {
  let world = null;
  test.afterEach(async () => {
    await world$.closeWorld(world);
    world = null;
  });

  test("preview, keep, the note reaches review.json, a reply, the frontmatter line, and the kept style after the rebuild", async ({
    page
  }) => {
    world = await world$.makeWorld({ file: "plan.md", text: SOURCE });
    styles.installStyles(world, ["sample"]);

    await page.setViewportSize({ width: 1180, height: 860 });
    await page.goto(world.open);
    await world$.settled(page);
    await world$.claim(page);
    const house = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect((await page.evaluate(() => window.__lahe.style())).usesHouseStyle, "the rendered page carries the marked bundle").toBe(
      true
    );

    // Preview.
    const opened = await openPanel(page);
    const row = opened.rows.find((r) => r.id === "sample");
    expect(row, "the installed fixture style is listed").toBeTruthy();
    await click(page, row.nameRect);
    await pollPage(page, () => window.__lahe.style().previewing && window.__lahe.style().settled, undefined, {
      message: "the preview to land"
    });
    const previewed = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(previewed, "the page restyled").not.toBe(house);

    // Keep: one ready note, with the marker, in review.json.
    const panel = await page.evaluate(() => window.__lahe.stylePanel());
    await click(page, panel.ask.rect);
    const asked = await pollUntil(
      async () => {
        const items = await page.evaluate(() => window.__lahe.items());
        return items.length === 1 ? items[0] : null;
      },
      { message: "the keep request" }
    );
    const stored = await world$.helperHas(world, asked.id, asked.rev);
    expect(stored.kind).toBe("note");
    expect(stored.note).toBe("Use the " + row.name + " style for this page (lahe-style: sample).");

    // The scripted agent answers, then writes the one line it was told to.
    await world$.reply(world, stored, "handled");
    await world$.agentWrites(page, world, "---\nlahe-style: sample\n---\n" + SOURCE);

    // The rebuild reloaded the page on its own (agentWrites fails otherwise),
    // and the document now carries the style: no preview, no key.
    await pollPage(page, () => window.__lahe.style().settled, undefined, { message: "the reloaded page to settle" });
    const after = await page.evaluate(() => window.__lahe.style());
    expect(after.documentId).toBe("sample");
    expect(after.previewing).toBe(false);
    expect(after.stored, "the preview key is cleared").toBe(null);
    expect(after.previewLinks).toBe(0);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "the kept style shows").toBe(previewed);
    expect(await page.evaluate(() => window.__lahe.stylePanel().mode), "nothing says previewing").toBe("closed");

    // Going back (fix round 2). Preview International, ask for it, and have
    // the agent do the least it might: take out the one line and leave the
    // fences. The page comes back in the house style with no empty block and
    // no rules where the fences were.
    const back = await openPanel(page);
    await click(page, back.rows.find((r) => r.id === "international").nameRect);
    await pollPage(page, () => window.__lahe.style().shown === "international" && window.__lahe.style().settled, undefined, {
      message: "the International preview"
    });
    const askBack = await page.evaluate(() => window.__lahe.stylePanel());
    expect(askBack.ask.label).toBe("Ask the agent to use International Style");
    await click(page, askBack.ask.rect);
    await pollPage(page, () => window.__lahe.stylePanel().status.indexOf("Sent to the agent.") === 0, undefined, {
      message: "the waiting line"
    });
    expect(await page.evaluate(() => window.__lahe.stylePanel().status)).toBe(
      "Sent to the agent. Waiting for it to return this page to International Style."
    );
    const backNote = (await page.evaluate(() => window.__lahe.items())).find((it) => /lahe-style: international/.test(it.note));
    expect(backNote.note).toBe("Use the International Style for this page (lahe-style: international).");
    await world$.reply(world, await world$.helperHas(world, backNote.id, backNote.rev), "handled");
    await world$.agentWrites(page, world, "---\n---\n" + SOURCE);
    await pollPage(page, () => window.__lahe.style().settled, undefined, { message: "the page after going back" });
    const home = await page.evaluate(() => window.__lahe.style());
    expect(home.documentId).toBe("international");
    expect(home.previewing).toBe(false);
    expect(home.stored).toBe(null);
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(house);
    const leftovers = await page.evaluate(() => ({
      rules: document.querySelectorAll("body hr").length,
      metadata: document.body.innerText.indexOf("Document metadata") !== -1,
      fences: document.body.innerText.indexOf("---") !== -1
    }));
    expect(leftovers).toEqual({ rules: 0, metadata: false, fences: false });
  });
});
