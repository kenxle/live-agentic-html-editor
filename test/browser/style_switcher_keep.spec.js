// The whole keep flow, through a real review of a Markdown source (V23), and
// the style control on a rendered Markdown page (V8, the Markdown half).
//
// docs/features/20260930.01_style_switcher, plan Test List rows V8 and V23.
// Preview a style, ask the agent to keep it, see the note in review.json with
// its marker, land a scripted reply, add the frontmatter line the way the
// agent would, and watch the rebuild reload the page on its own into the kept
// style with the preview key gone.
//
// This needs the service half (pull request A): `lahe style add`, the page
// server answering `.lahe-styles/` from the installed styles, and the renderer
// turning `lahe-style: <id>` into the link and marking the house bundle
// `data-lahe-doc-style`. Before that has merged the tests say so and skip; they
// are not passed off as run.

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

const NEEDS_SERVICE =
  "needs pull request A (lahe style add, the .lahe-styles route and the Markdown style line); re-run after it merges";

function center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function openPanel(page) {
  const menu = await page.evaluate(() => window.__lahe.rail.menuInfo());
  await page.mouse.click(center(menu.rect).x, center(menu.rect).y);
  const open = await pollUntil(
    async () => {
      const info = await page.evaluate(() => window.__lahe.rail.menuInfo());
      return info.open ? info : null;
    },
    { message: "the head menu to open" }
  );
  const item = open.items.find((i) => i.action === "document-style");
  expect(item, "a rendered Markdown page offers Document style (V8)").toBeTruthy();
  await page.mouse.click(center(item.rect).x, center(item.rect).y);
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
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("preview, keep, the note reaches review.json, a reply, the frontmatter line, and the kept style after the rebuild", async ({
    page
  }) => {
    world = await world$.makeWorld({ file: "plan.md", text: SOURCE });
    test.skip(!styles.serviceMerged(world), NEEDS_SERVICE);
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
  });
});
