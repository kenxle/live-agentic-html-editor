// The flow walk's replay-side and rail-side failures, on a real review
// (reviews_impl/flow_walk.md, fix builder G2).
//
// Each test is a real review from this checkout (support/lahe_world.js): the
// reviewer types for real, the agent is support/scripted_agent.js reading only
// review.json, and a rebuild is a write of the source.
//
//   Fail 2  a later edit of a block the agent already placed does not reopen
//           the placed record, never asks the agent to reapply it, and raises
//           no "Which version stands?" card between the reviewer's own two
//           versions. The list shows once after a reload.
//   Fail 3  when the agent rewords the anchor the reviewer reworded, the card
//           asks which version stands, and the reviewer's new blocks stay on
//           the page after the anchor while it waits.

"use strict";

const { test, expect, pollPage } = require("../helpers");
const fw = require("./support/free_writing_page");
const world_ = require("./support/lahe_world");
const agent = require("./support/scripted_agent");

const { makeWorld, closeWorld, readSource, helperHas, reply, booted, claim, agentWrites, reviewerReloads, countOnPage, reviewJsonItem } =
  world_;

const DOC_MD = [
  "# Spike doc",
  "",
  "A short lede that sits in the hero.",
  "",
  "## What changed",
  "",
  "We stopped measuring motion and started measuring outcomes.",
  "",
  "A second paragraph in the first section.",
  "",
  "## What comes next",
  "",
  "- Fewer meetings",
  "- Longer blocks",
  ""
].join("\n");

const ANCHOR_P = "main > section:first-of-type > p:first-of-type";

async function openEditAt(page, selector, offset) {
  await claim(page);
  await fw.caretAt(page, selector, 0);
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "edit state to open" });
  const at =
    typeof offset === "number" ? offset : await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await fw.caretAt(page, selector, at);
}

async function committed(page, skip) {
  const not = skip || [];
  await pollPage(
    page,
    (ids) => window.__lahe.items().some((i) => i.state === "ready" && i.kind === "edit" && ids.indexOf(i.id) === -1),
    not,
    { message: "a ready hand edit in the store" }
  );
  return page.evaluate((ids) => {
    const it = window.__lahe.items().filter((i) => i.state === "ready" && i.kind === "edit" && ids.indexOf(i.id) === -1)[0];
    return { id: it.id, rev: it.rev };
  }, not);
}

async function agentRound(page, world, ref, options) {
  const opts = options || {};
  const item = await helperHas(world, ref.id, ref.rev);
  const next = agent.place(world.source, readSource(world), item, opts);
  await agentWrites(page, world, next);
  if (opts.reply !== false) item.folded = await reply(world, item, opts.status || "handled");
  return item;
}

function state(page, id) {
  return page.evaluate((i) => {
    const it = window.__lahe.itemById(i);
    return it ? { state: it.state, rev: it.rev, note: it.note || null } : null;
  }, id);
}

async function heldHandled(page, id) {
  await pollPage(
    page,
    (i) => {
      const it = window.__lahe.itemById(i);
      return !!it && it.state === "handled";
    },
    id,
    { message: "the browser to hold " + id + " as handled", timeoutMs: 20000 }
  );
}

test.describe("flow walk fixes, replay and rail side", () => {
  let world = null;
  test.afterEach(() => {
    closeWorld(world);
    world = null;
  });

  async function placedPlan(page) {
    world = await makeWorld({ file: "doc.md", text: DOC_MD });
    await page.goto(world.open);
    await booted(page);
    // The first sitting: a heading, a paragraph and a two-item list.
    await openEditAt(page, ANCHOR_P);
    await page.keyboard.press("Enter");
    await page.keyboard.type("# Plan for the week", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Two things today.", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("- First item", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second item", { delay: 2 });
    await fw.commitByEsc(page);
    const first = await committed(page);
    await agentRound(page, world, first);
    await heldHandled(page, first.id);
    await reviewerReloads(page);
    expect(await state(page, first.id)).toMatchObject({ state: "handled" });
    return first;
  }

  async function openOnSecondItem(page) {
    // Found by place, not marked: an attribute added here would ride into the
    // record's markup and on into the source.
    const sel = "main > section:nth-of-type(2) li:nth-of-type(2)";
    expect(await page.evaluate((q) => document.querySelector(q).textContent.trim(), sel)).toBe("Second item");
    await openEditAt(page, sel);
  }

  async function expectPlacedStaysHandled(page, first, words) {
    await reviewerReloads(page);
    expect(await state(page, first.id), "the placed record is not reopened").toMatchObject({ state: "handled" });
    expect(await page.evaluate(() => window.__lahe.counters.revertReopens), "the page check reopened nothing").toBe(0);
    expect(reviewJsonItem(world, first.id).state, "the helper holds it handled too").toBe("handled");
    expect(reviewJsonItem(world, first.id).note || "", "the agent is never told to reapply").not.toMatch(/Reapply/);
    expect(await page.evaluate(() => window.LAHE.replay.conflictIds()), "no Which version stands card").toEqual([]);
    for (const t of words) expect(await countOnPage(page, t), "'" + t + "' once").toBe(1);
  }

  test("Fail 2: an item added to a list the agent placed is its own record; the placed record stays handled, no clash card, the list shows once", async ({
    page
  }) => {
    const first = await placedPlan(page);
    await openOnSecondItem(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Third item", { delay: 2 });
    await fw.commitByEsc(page);
    const second = await committed(page, [first.id]);
    expect(second.id, "the later edit is its own record").not.toBe(first.id);
    await expectPlacedStaysHandled(page, first, ["First item", "Second item", "Third item"]);

    // Undo of the later record finds its anchor and puts the two-item list back.
    const res = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), second.id);
    expect(res.reason || null, "undo found the anchor").toBeNull();
    expect(res.reverted).toBe(true);
    expect(await countOnPage(page, "Third item")).toBe(0);
    await reviewerReloads(page);
    expect(await state(page, first.id)).toMatchObject({ state: "handled" });
    for (const t of ["First item", "Second item"]) expect(await countOnPage(page, t), "'" + t + "' once after undo").toBe(1);
  });

  test("Fail 2, the messy case: a list item plus a paragraph after a placed list; the agent places it; reload shows each once; undo finds the anchor", async ({
    page
  }) => {
    const first = await placedPlan(page);
    await openOnSecondItem(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Third item", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.press("Enter");
    await page.keyboard.type("A paragraph after the list.", { delay: 2 });
    await fw.commitByEsc(page);
    const second = await committed(page, [first.id]);
    expect(second.id, "the later edit is its own record").not.toBe(first.id);
    const words = ["First item", "Second item", "Third item", "A paragraph after the list."];
    await expectPlacedStaysHandled(page, first, words);

    // The agent places the later record, and the rebuilt page shows it once.
    await agentRound(page, world, second);
    await heldHandled(page, second.id);
    await expectPlacedStaysHandled(page, first, words);
    expect(await state(page, second.id)).toMatchObject({ state: "handled" });

    // Undo of the later, handled record finds its anchor.
    const res = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), second.id);
    expect(res.reason || null, "undo found the anchor").toBeNull();
    expect(res.reverted).toBe(true);
  });
});
