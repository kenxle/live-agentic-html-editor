// "+ Write here" never outlives its edit (phase 7, fix H3).
//
// Ken, on a real notes page: "a leftover +write here that's floating in like
// the center". The line was drawn beside a list with no edit open. Then again
// on an ordinary review, floating over a paragraph he had just typed into.
//
// The rule these tests hold: the line shows only while an edit is open and the
// pointer is in a gap between blocks, and when edit state ends the line is
// taken out of the layer's shadow root, not just hidden. While it shows, it is
// always in a real gap: a scroll or a block growing under a still pointer does
// not leave it over text.
//
// Each test is a real `lahe write` notes page or `lahe review` page from this
// checkout, with its own state folder and a free helper port
// (support/lahe_world.js). The agent is support/scripted_agent.js.

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const { test, expect, pollPage } = require("../helpers");
const world_ = require("./support/lahe_world");
const fw = require("./support/free_writing_page");
const agent = require("./support/scripted_agent");

const { makeWorld, closeWorld, booted, claim, helperHas, agentWrites, readSource } = world_;

const DARK_CSS = "html, body { background: #16181d !important; color: #e6e6e6 !important; }";

const BLOG_MD = [
  "# Blog draft",
  "",
  "A short lede that sits at the top of the draft.",
  "",
  "## Carried over",
  "",
  "Why is it difficult: these things are hard to do, and hard to debug when the agent does not follow the instructions you wrote.",
  "",
  "A second paragraph, the one the reviewer types into until it wraps onto more lines.",
  "",
  "How we do debugging: evals, a set of use cases and the results you want from them.",
  "",
  "A closing paragraph, so every block above has a gap below it.",
  "",
  ...Array.from({ length: 12 }, (_, i) => "Filler paragraph " + (i + 1) + " so the page can scroll a good way.\n")
].join("\n");

async function shot(page, name) {
  const dir = process.env.LAHE_SHOTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const lane = test.info().project.name;
  await page.screenshot({ path: path.join(dir, name + (lane === "chromium" ? "" : "-" + lane) + ".png") });
}

async function frames(page, n) {
  for (let i = 0; i < (n || 3); i += 1) {
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
}

/**
 * Every "+ Write here" node in the layer's shadow root, whether the line is
 * showing, where its rule is drawn, whether an edit is open, and whether the
 * rule sits inside any block's box (it should only ever sit in a gap).
 */
async function lineState(page) {
  return page.evaluate(() => {
    const s = window.__lahe.handle.comments.highlights.surface();
    const root = s.root || s.host;
    const nodes = Array.from(root.querySelectorAll(".lahe-insert-line"));
    const shown = nodes.filter((n) => n.getAttribute("data-lahe-show") === "true");
    let overText = null;
    if (shown.length) {
      const r = shown[0].getBoundingClientRect();
      const ruleY = r.top + 13.75;
      const blocks = Array.from(document.querySelectorAll("main p, main li, main h1, main h2, main h3, main h4, body > p, body > ul li"));
      for (const b of blocks) {
        const br = b.getBoundingClientRect();
        if (ruleY > br.top + 1 && ruleY < br.bottom - 1 && r.left < br.right && r.right > br.left) {
          overText = (b.textContent || "").slice(0, 60);
          break;
        }
      }
    }
    return {
      nodes: nodes.length,
      shown: shown.length,
      overText: overText,
      editOpen: window.__lahe.isEditing() === true || window.__lahe.editState().editState === true
    };
  });
}

/** The line obeys the rule: no edit open, no node; showing, never over text. */
async function expectLineHonest(page, label) {
  await frames(page);
  const s = await lineState(page);
  if (!s.editOpen) expect(s.nodes, label + ": no edit open, so no line in the shadow root " + JSON.stringify(s)).toBe(0);
  expect(s.overText, label + ": the line is never drawn over a block " + JSON.stringify(s)).toBe(null);
  return s;
}

async function expectNoLine(page, label) {
  await frames(page);
  const s = await lineState(page);
  expect(s.nodes, label + ": no line in the shadow root " + JSON.stringify(s)).toBe(0);
}

/** The pointer into the gap below `selector` (or between it and the next block), and the line showing there. */
async function pointToGapBelow(page, selector) {
  const at = await page.evaluate((sel) => {
    const el = typeof sel === "string" ? document.querySelector(sel) : null;
    const r = el.getBoundingClientRect();
    let next = el.nextElementSibling;
    while (next && !next.getClientRects().length) next = next.nextElementSibling;
    const bottom = next ? next.getBoundingClientRect().top : r.bottom + 30;
    return { x: r.left + Math.min(200, r.width / 2), y: Math.round((r.bottom + bottom) / 2) };
  }, selector);
  await page.mouse.move(at.x, at.y - 2);
  await page.mouse.move(at.x, at.y);
  await pollPage(page, () => !!window.__lahe.handle.editing.lineInfo(), undefined, { message: "the line to show in the gap below " + selector });
  return at;
}

async function openNotes(page, scheme) {
  const world = await makeWorld({ file: "notes.md", command: "write", create: false });
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto(world.open);
  await booted(page);
  if (scheme === "dark") await darken(page);
  await claim(page);
  await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "the empty page to open ready to type" });
  return world;
}

async function darken(page) {
  await page.evaluate((text) => {
    const el = document.createElement("style");
    el.textContent = text;
    document.head.appendChild(el);
  }, DARK_CSS);
  await page.evaluate(() => window.__lahe.rail.refreshScheme());
}

async function openBlog(page) {
  const world = await makeWorld({ file: "blog.md", text: BLOG_MD });
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.goto(world.open);
  await booted(page);
  await claim(page);
  return world;
}

/** Cmd-Shift-E with the caret at the end of the block `selector` names. */
async function editAt(page, selector) {
  await fw.caretAt(page, selector, 0);
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "Cmd-Shift-E to open " + selector });
  const end = await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await fw.caretAt(page, selector, end);
}

async function writeKensList(page) {
  await page.keyboard.type("# Summary", { delay: 2 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("What works so far:", { delay: 2 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("- Plain notes and lists work", { delay: 2 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("You can come back and keep writing", { delay: 2 });
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Open questions and problems:", { delay: 2 });
}

async function readyEdit(page) {
  await pollPage(page, () => window.__lahe.items().some((i) => i.state === "ready" && (i.kind === "edit" || i.kind === "format_only")), undefined, {
    message: "a ready hand edit"
  });
  return page.evaluate(() => {
    const it = window.__lahe.items().find((i) => i.state === "ready" && (i.kind === "edit" || i.kind === "format_only"));
    return { id: it.id, rev: it.rev };
  });
}

test.describe("\"+ Write here\" never outlives its edit", () => {
  let world;

  test.afterEach(async () => {
    await closeWorld(world);
    world = null;
  });

  test("Ken's case: a list on a notes page, committed with the pointer in the gap, placed by the agent and rebuilt; no line is left", async ({
    page
  }) => {
    world = await openNotes(page, "light");
    await writeKensList(page);
    await pointToGapBelow(page, "main ul, ul");
    await fw.commitByEsc(page);
    await expectNoLine(page, "after Esc with the pointer resting in the gap");

    const ref = await readyEdit(page);
    const item = await helperHas(world, ref.id, ref.rev);
    await agentWrites(page, world, agent.place(world.source, readSource(world), item, {}));
    await expectNoLine(page, "after the rebuild reloaded the page");
    await page.mouse.move(300, 300);
    await page.mouse.move(310, 320);
    await expectNoLine(page, "after the pointer moves over the rebuilt page with no edit open");

    // Ken then went back into the list and wrote one more item.
    await page.evaluate(() => {
      const lis = document.querySelectorAll("main li, li");
      lis[lis.length - 1].setAttribute("data-h3-last", "1");
    });
    await editAt(page, "[data-h3-last]");
    await page.keyboard.press("Enter");
    await page.keyboard.type("looks like i can get in here just fine", { delay: 2 });
    await pointToGapBelow(page, "main ul, ul");
    await expectLineHonest(page, "with the second sitting open");
    await fw.commitByEsc(page);
    await expectNoLine(page, "after the second sitting's Esc");
  });

  test("Esc from edit state with no block open removes the line", async ({ page }) => {
    world = await openBlog(page);
    await fw.caretAt(page, "main h1, h1", 0);
    await page.evaluate(() => getSelection().removeAllRanges());
    await page.evaluate(() => window.__lahe.handle.editing.enterEditState());
    await pointToGapBelow(page, "main p");
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.editState().editState !== true, undefined, { message: "Esc to leave edit state" });
    await expectNoLine(page, "after leaving edit state");
  });

  test("a click outside commits and removes the line", async ({ page }) => {
    world = await openBlog(page);
    await editAt(page, "main p");
    await pointToGapBelow(page, "main p");
    // A press in the far-left margin, beside the middle of a later paragraph,
    // commits as before. The y comes from the layout, not a fixed number: a
    // press in the gap between two blocks (and up to 40px either side of the
    // column) is the near miss that starts writing there (editing.js
    // writeInGap), not a click outside. A fixed (4, 400) landed in such a gap
    // once the vendored style shortened the hero's bottom padding, so it
    // opened a new block instead of committing. Beside a paragraph's middle
    // is never a gap, whatever the spacing.
    const outside = await page.evaluate(() => {
      const r = document.querySelectorAll("main p")[3].getBoundingClientRect();
      return { x: 4, y: Math.round(r.top + r.height / 2) };
    });
    await page.mouse.click(outside.x, outside.y);
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the click outside to commit" });
    await expectNoLine(page, "after a click outside");
  });

  test("clicking from one block to another leaves no line behind, and the line never stays over the text typed there", async ({ page }) => {
    world = await openBlog(page);
    await page.evaluate(() => {
      const ps = document.querySelectorAll("main p");
      ps[1].setAttribute("data-h3-a", "1");
      ps[3].setAttribute("data-h3-b", "1");
    });
    await editAt(page, "[data-h3-a]");
    await pointToGapBelow(page, "[data-h3-a]");
    const b = await page.evaluate(() => {
      const r = document.querySelector("[data-h3-b]").getBoundingClientRect();
      return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    await page.mouse.click(b.x, b.y);
    await pollPage(
      page,
      () => {
        const n = getSelection().anchorNode;
        const el = n && (n.nodeType === 1 ? n : n.parentElement);
        return !!el && !!el.closest("[data-h3-b]");
      },
      undefined,
      { message: "the caret to move to the clicked block" }
    );
    await expectLineHonest(page, "right after the click on the other block");
    expect((await lineState(page)).shown, "the pointer is on a block's text, not in a gap, so no line shows").toBe(0);
    // Writing goes on in the block clicked (Cmd-Shift-E when the click closed
    // the first sitting). Ken's second screenshot: the pointer rests in the gap
    // below it, and the words he types there wrap under the pointer.
    if (!(await page.evaluate(() => window.__lahe.isEditing()))) await editAt(page, "[data-h3-b]");
    await pointToGapBelow(page, "[data-h3-b]");
    await fw.caretAt(page, "[data-h3-b]", await page.evaluate(() => document.querySelector("[data-h3-b]").textContent.length));
    await page.keyboard.type(" i actually like the way once you're editing, if you click on another block, it switches the editor to include it.", {
      delay: 1
    });
    await expectLineHonest(page, "after typing into the block clicked");
    await fw.commitByEsc(page);
    await expectNoLine(page, "after Esc");
  });

  test("typing that grows the block under a still pointer never leaves the line over the text", async ({ page }) => {
    world = await openBlog(page);
    await page.evaluate(() => document.querySelectorAll("main p")[2].setAttribute("data-h3-grow", "1"));
    await editAt(page, "[data-h3-grow]");
    await pointToGapBelow(page, "[data-h3-grow]");
    await page.keyboard.type(
      " i actually like the way once you're editing, if you click on another block, it switches the editor to include it, and it keeps going onto more lines.",
      { delay: 1 }
    );
    await expectLineHonest(page, "after the block grew under the pointer");
    await fw.commitByEsc(page);
    await expectNoLine(page, "after Esc");
  });

  test("a scroll under a still pointer never leaves the line over the text", async ({ page }) => {
    world = await openBlog(page);
    await editAt(page, "main p");
    await pointToGapBelow(page, "main p");
    await page.evaluate(() => window.scrollBy(0, 37));
    await expectLineHonest(page, "after a scroll");
    await page.evaluate(() => window.scrollBy(0, 200));
    await expectLineHonest(page, "after a longer scroll");
  });

  test("the page re-rendering a block under the line (a replay pass) never leaves the line over text", async ({ page }) => {
    world = await openBlog(page);
    await page.evaluate(() => {
      const ps = document.querySelectorAll("main p");
      ps[0].setAttribute("data-h3-edit", "1");
      ps[2].setAttribute("data-h3-under", "1");
    });
    await editAt(page, "[data-h3-edit]");
    await pointToGapBelow(page, "[data-h3-under]");
    // The page rewrites the block above the gap, the way a replay pass or the
    // page's own render swaps a block for a longer copy.
    await page.evaluate(() => {
      const old = document.querySelector("[data-h3-under]");
      const fresh = document.createElement("p");
      fresh.textContent = old.textContent + " Rewritten with more words so it now runs onto a second and a third line of the page column.";
      old.replaceWith(fresh);
    });
    await expectLineHonest(page, "after the block was rewritten");
  });

  test("moving onto the rail, and pressing in it, removes the line", async ({ page }) => {
    world = await openBlog(page);
    await editAt(page, "main p");
    await pointToGapBelow(page, "main p");
    const rail = await page.evaluate(() => {
      const w = innerWidth;
      for (let x = w - 40; x > w - 400; x -= 20) {
        const el = document.elementFromPoint(x, 300);
        if (el && el.id === window.__lahe.handle.comments.highlights.surface().host.id) return { x: x, y: 300 };
      }
      return null;
    });
    expect(rail, "the rail is on screen").toBeTruthy();
    await page.mouse.move(rail.x, rail.y);
    await frames(page);
    expect((await lineState(page)).shown, "the pointer on the rail shows no line").toBe(0);
    await page.mouse.down();
    await page.mouse.up();
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "a press on the rail to commit" });
    await expectNoLine(page, "after the rail took the press");
  });

  test("the window losing focus commits and removes the line", async ({ page }) => {
    world = await openBlog(page);
    await editAt(page, "main p");
    await pointToGapBelow(page, "main p");
    await page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the blur to commit" });
    await expectNoLine(page, "after the window lost focus");
  });

  test("the pointer leaving the gap, and leaving the window, hides the line", async ({ page }) => {
    world = await openBlog(page);
    await editAt(page, "main p");
    await pointToGapBelow(page, "main p");
    const text = await page.evaluate(() => {
      const r = document.querySelectorAll("main p")[1].getBoundingClientRect();
      return { x: r.left + 60, y: r.top + r.height / 2 };
    });
    await page.mouse.move(text.x, text.y);
    await frames(page);
    expect((await lineState(page)).shown, "the pointer on text shows no line").toBe(0);
    await pointToGapBelow(page, "main p");
    await page.evaluate(() => document.documentElement.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: null })));
    await frames(page);
    expect((await lineState(page)).shown, "the pointer left the window, so no line shows").toBe(0);
  });

  test("a new sitting opened on another block with Cmd-Shift-E leaves no stale line", async ({ page }) => {
    world = await openBlog(page);
    await page.evaluate(() => document.querySelectorAll("main p")[3].setAttribute("data-h3-other", "1"));
    await editAt(page, "main p");
    await pointToGapBelow(page, "main p");
    await editAt(page, "[data-h3-other]");
    await page.keyboard.type(" and more words typed into the other block, enough to wrap it onto another line.", { delay: 1 });
    await expectLineHonest(page, "after the new sitting");
    await fw.commitByEsc(page);
    await expectNoLine(page, "after the new sitting's Esc");
  });

  test("another window taking the review removes the line from this one", async ({ page, context }) => {
    world = await openBlog(page);
    await editAt(page, "main p");
    await pointToGapBelow(page, "main p");
    const other = await context.newPage();
    await other.goto(world.open);
    await booted(other);
    await other.evaluate(() => window.__lahe.handle.sync.takeover());
    await pollPage(other, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, { message: "the other window to take the review" });
    await pollPage(page, () => window.__lahe.handle.sync.status().readOnly === true, undefined, {
      message: "this window to learn it lost the review",
      timeoutMs: 20000
    });
    await expectNoLine(page, "after another window took the review");
    await other.close();
  });

  for (const scheme of ["light", "dark"]) {
    test("screenshot: the notes page after the rebuild, with no line left (" + scheme + ")", async ({ page }) => {
      world = await openNotes(page, scheme);
      await writeKensList(page);
      await pointToGapBelow(page, "main ul, ul");
      await fw.commitByEsc(page);
      const ref = await readyEdit(page);
      const item = await helperHas(world, ref.id, ref.rev);
      await agentWrites(page, world, agent.place(world.source, readSource(world), item, {}));
      if (scheme === "dark") await darken(page);
      const gap = await page.evaluate(() => {
        const ul = document.querySelector("main ul, ul");
        const r = ul.getBoundingClientRect();
        return { x: r.left + 200, y: r.bottom + 6 };
      });
      await page.mouse.move(gap.x, gap.y);
      await expectNoLine(page, "on the rebuilt page");
      await shot(page, "notes-after-rebuild-" + scheme);
    });
  }
});
