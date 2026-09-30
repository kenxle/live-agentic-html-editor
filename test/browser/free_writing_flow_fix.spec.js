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

/**
 * The card on screen, light and dark, as test attachments. The page picks the
 * rail's scheme from its background, so dark is a dark page background.
 */
async function shootCard(page, testInfo, id, name) {
  await page.setViewportSize({ width: 1280, height: 1000 });
  for (const scheme of ["light", "dark"]) {
    await page.evaluate(
      ([itemId, want]) => {
        const bg = want === "dark" ? "#12151a" : "";
        document.documentElement.style.background = bg;
        document.body.style.background = bg;
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
    window.__lahe.rail.refreshScheme();
  });
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

  const BLOG_HTML = require("node:fs").readFileSync(require("node:path").join(fw.REPO_ROOT, "test/fixtures/free_writing/blog.html"), "utf8");

  const FAIL3 = [
    {
      name: "Markdown",
      file: "doc.md",
      text: DOC_MD,
      anchor: ANCHOR_P,
      scope: "main",
      words: "We stopped measuring motion and started measuring outcomes.",
      theirs: "We stopped counting motion and started counting outcomes.",
      choice: "take_theirs"
    },
    {
      name: "HTML",
      file: "blog.html",
      text: BLOG_HTML,
      anchor: "#p2",
      scope: "#post",
      words: "and started measuring outcomes.",
      theirs: "and started counting outcomes.",
      choice: "keep_mine"
    }
  ];

  for (const c of FAIL3) {
    test("Fail 3 (" + c.name + "): the agent rewords the anchor the reviewer reworded; the card asks which version stands and the new paragraphs stay on the page after it", async ({
      page
    }, testInfo) => {
      world = await makeWorld({ file: c.file, text: c.text });
      await page.goto(world.open);
      await booted(page);
      // The reviewer rewords the anchor's last word and writes two paragraphs.
      await openEditAt(page, c.anchor);
      for (let i = 0; i < "outcomes.".length; i += 1) await page.keyboard.press("Backspace");
      await page.keyboard.type("results.", { delay: 2 });
      await page.keyboard.press("Enter");
      await page.keyboard.type("Friday ships feel calmer.", { delay: 2 });
      await page.keyboard.press("Enter");
      await page.keyboard.type("Nobody misses the old way.", { delay: 2 });
      await fw.commitByEsc(page);
      const ref = await committed(page);
      const item = await helperHas(world, ref.id, ref.rev);
      expect(item.anchor_after_html).toContain("results.");

      // The agent, working on something else, rewords the same sentence.
      const source = readSource(world);
      expect(source).toContain(c.words);
      await world_.agentWrites(page, world, source.replace(c.words, c.theirs));
      await page.evaluate(() => window.__lahe.replayNow());

      await pollPage(page, (id) => window.LAHE.replay.conflictIds().indexOf(id) !== -1, ref.id, {
        message: "the conflict card for the reworded anchor",
        timeoutMs: 20000
      });
      const card = await page.evaluate((id) => {
        const k = window.LAHE.replay.conflictFor(id);
        return { yours: k.yours, theirs: k.theirs, run: !!k.run };
      }, ref.id);
      expect(card.yours).toContain("results.");
      expect(card.theirs).toContain("counting");
      expect(card.run, "the card shows the run").toBe(true);
      expect(
        await page.evaluate((id) => window.__lahe.rail.cardBadges(id).map((b) => b.code), ref.id),
        "no bare could-not-be-matched note"
      ).not.toContain("ANCHOR_NO_TEXT_MATCH");
      expect(reviewJsonItem(world, ref.id).lost || null, "the record is not stamped lost").toBeNull();

      // The reviewer's new blocks are on the page, right after the page's anchor.
      const nextTwo = (anchorText) =>
        page.evaluate(
          ([t, sel]) => {
            const a = Array.from(document.querySelectorAll(sel + " p")).find((p) => p.textContent.indexOf(t) !== -1);
            const n1 = a && a.nextElementSibling;
            const n2 = n1 && n1.nextElementSibling;
            return [n1 && n1.textContent.trim(), n2 && n2.textContent.trim()];
          },
          [anchorText, c.scope]
        );
      const blocks = ["Friday ships feel calmer.", "Nobody misses the old way."];
      expect(await nextTwo("counting")).toEqual(blocks);
      for (const t of blocks) expect(await countOnPage(page, t, c.scope), "'" + t + "' once while waiting").toBe(1);
      const line = await page.evaluate((id) => {
        const n = window.__lahe.rail.cardNode(id).querySelector("[data-lahe-conflict-run-line]");
        return n ? n.textContent : null;
      }, ref.id);
      expect(line).toBe("Your 2 new blocks are on the page after this paragraph. Either answer keeps them.");
      await shootCard(page, testInfo, ref.id, "item2-reworded-anchor-" + c.name.toLowerCase());

      // Either answer keeps the new blocks, once.
      const res = await page.evaluate(([id, choice]) => window.LAHE.replay.resolveConflict(id, choice), [ref.id, c.choice]);
      expect(res.resolved).toBe(true);
      await page.evaluate(() => window.__lahe.replayNow());
      expect(await nextTwo(c.choice === "keep_mine" ? "results." : "counting")).toEqual(blocks);
      for (const t of blocks) expect(await countOnPage(page, t, c.scope), "'" + t + "' once after the answer").toBe(1);
      expect(await page.evaluate(() => window.LAHE.replay.conflictIds())).toEqual([]);
    });
  }

  test("the clash card and the reopen line say what is true when the agent adds words to a placed block", async ({ page }, testInfo) => {
    world = await makeWorld({ file: "doc.md", text: DOC_MD });
    await page.goto(world.open);
    await booted(page);
    await openEditAt(page, ANCHOR_P);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Friday ships feel calmer.", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Nobody misses the old way at all.", { delay: 2 });
    await fw.commitByEsc(page);
    const ref = await committed(page);
    const item = await helperHas(world, ref.id, ref.rev);
    // The agent places the run, adds a sentence to the second block, and says handled.
    const placed = agent.place(world.source, readSource(world), item);
    const extra = placed.replace("Nobody misses the old way at all.", "Nobody misses the old way at all. The agent added this line.");
    expect(extra).not.toBe(placed);
    await agentWrites(page, world, extra);
    const folded = await reply(world, item, "handled");
    // The helper's handled check reads the block with its added line as not
    // the reviewer's words, so it holds the item open; the page never sees it
    // as handled. Either way the agent is never told to reapply anything.
    expect(folded.handled_not_on_page, "the handled check held it").toBe(true);
    await reviewerReloads(page);
    const after = await state(page, ref.id);
    expect(after.state).toBe("ready");
    expect(after.note || "").not.toMatch(/original text is back|Reapply/);

    // Replay then finds the clash, and its card says so in its own words.
    await page.evaluate(() => window.__lahe.replayNow());
    await pollPage(page, (id) => window.LAHE.replay.conflictIds().indexOf(id) !== -1, ref.id, {
      message: "the block clash card",
      timeoutMs: 20000
    });
    const badge = await page.evaluate(
      (id) => window.__lahe.rail.cardBadges(id).filter((b) => b.code === "REPLAY_NEITHER_MATCHES").map((b) => b.message)[0],
      ref.id
    );
    expect(badge).toBe("On the page, your new paragraph has words you did not write. Lahe changed nothing. Pick the version that stands.");
    await shootCard(page, testInfo, ref.id, "item4-block-clash");
  });

  test("a placed block a later rebuild drops reopens with the run's own lines, never undone or reapply", async ({ page }, testInfo) => {
    world = await makeWorld({ file: "doc.md", text: DOC_MD });
    await page.goto(world.open);
    await booted(page);
    await openEditAt(page, ANCHOR_P);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Friday ships feel calmer.", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Nobody misses the old way at all.", { delay: 2 });
    await fw.commitByEsc(page);
    const ref = await committed(page);
    await agentRound(page, world, ref);
    await heldHandled(page, ref.id);
    await reviewerReloads(page);
    expect(await state(page, ref.id)).toMatchObject({ state: "handled" });

    // A later rebuild loses the second block.
    const dropped = readSource(world).replace("Nobody misses the old way at all.\n\n", "");
    expect(dropped).not.toBe(readSource(world));
    await agentWrites(page, world, dropped);
    await pollPage(page, (id) => window.__lahe.itemById(id).state === "ready", ref.id, {
      message: "the page check to reopen the run",
      timeoutMs: 20000
    });
    const after = await state(page, ref.id);
    expect(after.note).toContain("Reopened by the page check: a block in new_blocks is not on the page as written.");
    expect(after.note).not.toMatch(/original text is back|Reapply/);
    const notice = await page.evaluate((id) => {
      const n = window.__lahe.rail.cardNode(id).querySelector(".card__notice");
      return n ? n.textContent : "";
    }, ref.id);
    expect(notice).toBe("A block you wrote is not on the page as you wrote it. The item is open again.");
    await shootCard(page, testInfo, ref.id, "item4-run-reopened");
  });

  test("opening a block draws no struck-through draft card until something changes", async ({ page }) => {
    world = await makeWorld({ file: "doc.md", text: DOC_MD });
    await page.goto(world.open);
    await booted(page);
    await openEditAt(page, ANCHOR_P);
    const view = () =>
      page.evaluate(() => {
        const rail = window.__lahe.rail;
        const drafts = window.__lahe.items().filter((i) => i.state === "draft" && i.kind === "edit");
        const shown = drafts.filter((i) => {
          const card = rail.cardNode(i.id);
          return !!card && card.getClientRects().length > 0;
        });
        return { drafts: drafts.length, shown: shown.length, edits: rail.countFor("edits") };
      });
    await page.evaluate(() => {
      window.__lahe.rail.collapse(false);
      window.__lahe.rail.selectTab("edits");
    });
    // Whether or not capture keeps a draft for an untouched block, none is drawn.
    const opened = await view();
    expect(opened.shown, "no draft card for an untouched block").toBe(0);
    expect(opened.edits, "the Edits count does not move").toBe(0);
    await page.keyboard.type(" More.", { delay: 2 });
    await pollPage(page, () => window.__lahe.rail.countFor("edits") === 1, undefined, { message: "the typed change to draw its card" });
    expect((await view()).shown).toBe(1);
  });

  test("an untouched draft left in storage draws no card after a reload", async ({ page }) => {
    world = await makeWorld({ file: "doc.md", text: DOC_MD });
    await page.goto(world.open);
    await booted(page);
    await openEditAt(page, ANCHOR_P);
    const draft = await page.evaluate(() => window.__lahe.items().find((i) => i.state === "draft" && i.kind === "edit") || null);
    expect(draft, "opening a block stores a draft").toBeTruthy();
    // Leave it in storage the way a closed tab would, then load the page again.
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.reload();
    await booted(page);
    await page.evaluate((d) => {
      const h = window.__lahe.handle;
      if (!h.allStore.read(h.review).some((i) => i.id === d.id)) h.allStore.write(h.review, d);
    }, draft);
    await page.reload();
    await booted(page);
    const got = await page.evaluate((id) => {
      const rail = window.__lahe.rail;
      rail.collapse(false);
      rail.selectTab("edits");
      const card = rail.cardNode(id);
      return {
        stored: window.__lahe.items().some((i) => i.id === id && i.state === "draft"),
        shown: !!card && card.getClientRects().length > 0,
        edits: rail.countFor("edits")
      };
    }, draft.id);
    expect(got.stored, "the draft is still in storage").toBe(true);
    expect(got.shown, "no card for it").toBe(false);
    expect(got.edits, "and no count").toBe(0);
  });
});
