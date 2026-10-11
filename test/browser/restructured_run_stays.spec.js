// The hackathon case: loose lines the agent placed, then turned into a table on
// request. Spec docs/features/20261011.01_stuck_replayed_blocks.
//
// Before the fix, the page check saw the lines missing (they were table cells
// now), reopened the old card, and replay wrote the lines back, often inside
// the table. When the agent refused the reopened card, replay kept writing them
// on every repaint. Now, after the agent answers, the page is the file:
//
//   handled   the card stays handled, nothing is added to it, and the page
//             shows only the table
//   refused   a card the agent refused is not written onto the page either,
//             so a card already stuck that way clears on the next reload
//
// Real `lahe review` walk on a Markdown source, through test/browser/support.

"use strict";

const { test, expect, pollPage } = require("../helpers");
const fw = require("./support/free_writing_page");
const world_ = require("./support/lahe_world");
const agent = require("./support/scripted_agent");

const { makeWorld, closeWorld, readSource, helperHas, reply, booted, claim, agentWrites, reviewerReloads, countOnPage, reviewJsonItem } =
  world_;

const DOC_MD = [
  "# Hackathon notes",
  "",
  "A short lede that sits in the hero.",
  "",
  "## The company you are hacking for",
  "",
  "Read their site before the kickoff.",
  "",
  "## What comes next",
  "",
  "- Pick a team",
  ""
].join("\n");

const ANCHOR_P = "main > section:first-of-type > p:first-of-type";
const LINES = ["Competitors zqxcanary", "Pricing pages zqxcanary", "Their changelog zqxcanary"];

// The agent's restructure: the three loose lines become rows of one table.
function asTable(source) {
  const loose = LINES.join("\n\n") + "\n\n";
  const table = "| Research | Notes |\n| --- | --- |\n" + LINES.map((l) => "| " + l + " | to do |").join("\n") + "\n\n";
  if (source.indexOf(loose) === -1) throw new Error("the placed lines are not in the source as loose paragraphs:\n" + source);
  return source.replace(loose, table);
}

async function openEditAt(page, selector) {
  await claim(page);
  await fw.caretAt(page, selector, 0);
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "edit state to open" });
  const at = await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await fw.caretAt(page, selector, at);
}

async function writeRun(page) {
  await openEditAt(page, ANCHOR_P);
  for (const line of LINES) {
    await page.keyboard.press("Enter");
    await page.keyboard.type(line, { delay: 2 });
  }
  await fw.commitByEsc(page);
  await pollPage(page, () => window.__lahe.items().some((i) => i.state === "ready" && i.kind === "edit"), undefined, {
    message: "a ready free-writing run in the store"
  });
  return page.evaluate(() => {
    const it = window.__lahe.items().filter((i) => i.state === "ready" && i.kind === "edit")[0];
    return { id: it.id, rev: it.rev };
  });
}

function state(page, id) {
  return page.evaluate((i) => {
    const it = window.__lahe.itemById(i);
    return it ? { state: it.state, rev: it.rev, note: it.note || null } : null;
  }, id);
}

async function heldState(page, id, want) {
  await pollPage(
    page,
    (args) => {
      const it = window.__lahe.itemById(args[0]);
      return !!it && it.state === args[1];
    },
    [id, want],
    { message: "the browser to hold " + id + " as " + want, timeoutMs: 20000 }
  );
}

/** Where each line is on the page: how many times, and in a table cell or not. */
function placesOf(page) {
  return page.evaluate((lines) => {
    const main = document.querySelector("main");
    return lines.map((line) => {
      const hits = Array.from(main.querySelectorAll("p, td, th, li, h2, h3")).filter((n) => n.textContent.trim() === line);
      return { line: line, count: hits.length, tags: hits.map((n) => n.tagName.toLowerCase()) };
    });
  }, LINES);
}

/** The page and the card, light and dark, as test attachments. */
async function shoot(page, testInfo, id, name) {
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const scheme of ["light", "dark"]) {
    await page.evaluate(
      ([itemId, want]) => {
        const bg = want === "dark" ? "#12151a" : "";
        document.documentElement.style.background = bg;
        document.body.style.background = bg;
        document.body.style.color = want === "dark" ? "#e6e6e6" : "";
        const rail = window.__lahe.rail;
        rail.refreshScheme();
        rail.collapse(false);
        rail.selectTab(rail.getCard(itemId).pane);
        const card = rail.cardNode(itemId);
        if (card) card.scrollIntoView({ block: "start" });
      },
      [id, scheme]
    );
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const file = testInfo.outputPath(name + "-" + scheme + ".png");
    await page.screenshot({ path: file });
    await testInfo.attach(name + "-" + scheme, { path: file, contentType: "image/png" });
  }
  await page.evaluate(() => {
    document.documentElement.style.background = "";
    document.body.style.background = "";
    document.body.style.color = "";
    window.__lahe.rail.refreshScheme();
  });
}

test.describe("loose lines the agent turned into a table", () => {
  let world = null;
  test.afterEach(async () => {
    await closeWorld(world);
    world = null;
  });

  test("handled, then restructured: the page shows only the table and the card stays handled", async ({ page }, testInfo) => {
    world = await makeWorld({ file: "doc.md", text: DOC_MD });
    await page.goto(world.open);
    await booted(page);

    const ref = await writeRun(page);
    const item = await helperHas(world, ref.id, ref.rev);
    await agentWrites(page, world, agent.place(world.source, readSource(world), item));
    await reply(world, item, "handled");
    await heldState(page, ref.id, "handled");
    await reviewerReloads(page);
    const placed = await state(page, ref.id);
    expect(placed.state).toBe("handled");

    // The reviewer asks for a table elsewhere and the agent rebuilds the lines
    // as one.
    await agentWrites(page, world, asTable(readSource(world)));
    await reviewerReloads(page);
    await reviewerReloads(page);

    const places = await placesOf(page);
    for (const p of places) {
      expect(p, "'" + p.line + "' is on the page once, in the table").toEqual({ line: p.line, count: 1, tags: ["td"] });
    }
    expect(await countOnPage(page, LINES[0]), "no stray copy anywhere in main").toBe(1);
    expect(await page.evaluate(() => window.__lahe.counters.revertReopens), "the page check reopened nothing").toBe(0);
    const after = await state(page, ref.id);
    expect(after.state, "the card stays handled").toBe("handled");
    expect(after.rev, "at the revision the agent answered").toBe(placed.rev);
    expect(after.note || "", "nothing new on the card").not.toMatch(/Reopened by the page check/);
    expect(await page.evaluate((id) => window.__lahe.rail.cardBadges(id), ref.id), "no badge on the card").toEqual([]);
    expect(reviewJsonItem(world, ref.id).state, "review.json says handled too").toBe("handled");

    await shoot(page, testInfo, ref.id, "hackathon-table");
  });

  test("refused while the lines are table rows: nothing is written back on reload", async ({ page }) => {
    world = await makeWorld({ file: "doc.md", text: DOC_MD });
    await page.goto(world.open);
    await booted(page);

    // The stuck card from the hackathon review: the agent built the table and
    // answered not_handled ("these lines are rows in the table now").
    const ref = await writeRun(page);
    const item = await helperHas(world, ref.id, ref.rev);
    const placedSource = agent.place(world.source, readSource(world), item);
    await agentWrites(page, world, asTable(placedSource));
    await reply(world, item, "not_handled", ["--reason", "These lines are rows in the table now."]);
    await heldState(page, ref.id, "not_handled");
    await reviewerReloads(page);
    await reviewerReloads(page);

    const places = await placesOf(page);
    for (const p of places) {
      expect(p, "'" + p.line + "' is on the page once, in the table").toEqual({ line: p.line, count: 1, tags: ["td"] });
    }
    expect((await state(page, ref.id)).state, "the card keeps the agent's answer").toBe("not_handled");
  });
});
