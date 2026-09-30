// Brief R14 (bold and italic edits survive the rebuild), on a real
// `lahe review post.md`.
//
// This is the runnable port of the script that reproduced the three R14 cases
// (test/fixtures/free_writing/r14_repro_reference.js). On main at 2b6eb96 the
// first case passed and the other three failed (plan Task 1.1). With the
// free-writing branches merged, all of them are ordinary tests:
//
//   bold in the first paragraph, left out by the agent   comes back bold
//   bold in the second paragraph, left out by the agent  comes back bold
//   the header line, by click and by Esc                 shows once, under the h2
//   bold two words, the agent changes nothing            not retired
//   bold two words, a correct agent                      survives, retired
//
// Plan Task 3.4 adds, typed for real: the lone-paragraph cases now also have
// the agent reply handled, and the item must reopen (the helper holds it);
// the header case checks the line sits right below the sheet-head and takes
// screenshots while writing and after the rebuild.
//
// Nothing is simulated: the session, the helper, its server, the reply and the
// rebuild are all real, and a rebuild is a rewrite of the source file. Each
// test runs its own helper on its own port with its own state folder, and
// never touches the helper on 7817.

"use strict";

const { test, expect, pollPage } = require("../helpers");
// The world helpers are shared with the seams spec (support/lahe_world.js). This
// file kept its own copies once, and they drifted: the copy of reply did not
// wait for a new reply.at, and its agentWrites used a fixed mtime offset.
const world_ = require("./support/lahe_world");

const { closeWorld, booted, claim, settled, helperHas, reviewJsonItem, countOnPage, reply } = world_;

const ORIGINAL = "Runners come back too fast after a layoff.";
const INTRO_SECTION = "main > section:first-of-type";
const INTRO_P = "main > section:first-of-type > p";
const INTRO_H2 = "main > section:first-of-type h2";
const P_BOLD = "First new paragraph has a bold word in it.";
const P_PLAIN = "Second new paragraph is plain.";
const NEW_LINE = "A new line";

function md(introBlocks) {
  return ["# Debugging hell", "", "## Intro", ""]
    .concat(introBlocks.join("\n\n"))
    .concat(["", "## Premise", "", "All those days are gone.", ""])
    .join("\n");
}

function makeWorld(testInfo, blocks) {
  return world_.makeWorld({ file: "post.md", text: md(blocks) });
}

function caret(page, selector, offset) {
  return page.evaluate(
    ({ selector, offset }) => {
      const el = document.querySelector(selector);
      if (el.focus) el.focus();
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      const nodes = [];
      for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
      let node = nodes[0];
      let at = offset;
      if (offset === "end") {
        node = nodes[nodes.length - 1];
        at = node.data.length;
      }
      const range = document.createRange();
      range.setStart(node, at);
      range.collapse(true);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
    },
    { selector, offset }
  );
}

function selectAll(page, selector) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n);
    const range = document.createRange();
    range.setStart(nodes[0], 0);
    const last = nodes[nodes.length - 1];
    range.setEnd(last, last.data.length);
    getSelection().removeAllRanges();
    getSelection().addRange(range);
  }, selector);
}

function selectPhrase(page, selector, phrase) {
  return page.evaluate(
    ({ selector, phrase }) => {
      const el = document.querySelector(selector);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.data.indexOf(phrase);
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + phrase.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return true;
      }
      return false;
    },
    { selector, phrase }
  );
}

async function openEdit(page, selector) {
  await claim(page);
  await caret(page, selector, 0);
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "edit state to open" });
}

async function pressBold(page) {
  const rect = await page.evaluate(() => {
    const node = window.__lahe.handle.editing.buttonNode("bold");
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(rect, "the edit frame shows its B button").toBeTruthy();
  await page.mouse.click(rect.x, rect.y);
}

async function commitByEsc(page) {
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the edit to commit" });
}

async function commitByClickOutside(page) {
  const box = await page.locator("main > section:nth-of-type(2) > p").boundingBox();
  await page.mouse.click(box.x + 20, box.y + box.height / 2);
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the edit to commit" });
}

async function committedEdit(page) {
  await pollPage(
    page,
    () => window.__lahe.items().some((i) => i.state === "ready" && (i.kind === "edit" || i.kind === "format_only")),
    undefined,
    { message: "a ready hand edit in the store" }
  );
  return page.evaluate(() =>
    window.__lahe.items().filter((i) => i.state === "ready" && (i.kind === "edit" || i.kind === "format_only"))[0]
  );
}

/** The agent writes the .md; the page reloads itself off the new render. */
function agentWrites(page, world, blocks) {
  return world_.agentWrites(page, world, md(blocks));
}

function sectionText(page) {
  return page.evaluate((sel) => document.querySelector(sel).innerText.replace(/\s+/g, " "), INTRO_SECTION);
}

/** The agent says handled. The words it left out keep the item open. */
async function heldAfterHandled(world, it) {
  const got = await reply(world, it, "handled");
  expect(got.state, "the item reopens: it is still in front of the agent").toBe("ready");
  expect(got.handled_not_on_page).toBe(true);
}

test.describe("brief R14: bold and italic edits survive the rebuild", () => {
  let world = null;

  test.afterEach(() => {
    closeWorld(world);
    world = null;
  });

  test("a lone paragraph: bold in the FIRST new paragraph, left out by the agent, comes back bold", async ({ page }, testInfo) => {
    world = await makeWorld(testInfo, [ORIGINAL]);
    await page.goto(world.open);
    await booted(page);
    await openEdit(page, INTRO_P);
    await selectAll(page, INTRO_P);
    await page.keyboard.type(P_BOLD, { delay: 2 });
    await selectPhrase(page, INTRO_P, "bold");
    await pressBold(page);
    await caret(page, INTRO_P, "end");
    await page.keyboard.press("Enter");
    await page.keyboard.type(P_PLAIN, { delay: 2 });
    await commitByEsc(page);
    const it = await committedEdit(page);
    await helperHas(world, it.id, it.rev);

    // The agent places only the plain paragraph.
    await agentWrites(page, world, [ORIGINAL, P_PLAIN]);

    await pollPage(page, (sel) => !!document.querySelector(sel + " strong"), INTRO_SECTION, {
      message: "the bold paragraph to be written back with its bold",
      timeoutMs: 5000
    });
    expect(await countOnPage(page, P_BOLD)).toBe(1);
    expect(await countOnPage(page, P_PLAIN)).toBe(1);
    await heldAfterHandled(world, it);
  });

  test("a lone paragraph: bold in the SECOND new paragraph, left out by the agent, comes back bold", async ({ page }, testInfo) => {
    world = await makeWorld(testInfo, [ORIGINAL]);
    await page.goto(world.open);
    await booted(page);
    await openEdit(page, INTRO_P);
    await selectAll(page, INTRO_P);
    await page.keyboard.type(P_PLAIN, { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type(P_BOLD, { delay: 2 });
    // Enter made the second paragraph its own p (a run block), so the phrase
    // is looked for across the section, not in the first p.
    expect(await selectPhrase(page, INTRO_SECTION, "bold")).toBe(true);
    await pressBold(page);
    await caret(page, INTRO_SECTION + " > p:last-of-type", "end");
    await commitByEsc(page);
    const it = await committedEdit(page);
    expect(it.new_blocks.map((b) => b.html)).toEqual(["First new paragraph has a <strong>bold</strong> word in it."]);
    await helperHas(world, it.id, it.rev);

    await agentWrites(page, world, [P_PLAIN]);

    await pollPage(page, (sel) => !!document.querySelector(sel + " strong"), INTRO_SECTION, {
      message: "the left-out bold paragraph to come back with its bold",
      timeoutMs: 5000
    });
    expect(await countOnPage(page, P_BOLD)).toBe(1);
    await heldAfterHandled(world, it);
  });

  for (const leave of ["click", "Esc"]) {
    test("the header line: a line written after a heading shows once after the rebuild, left by " + leave, async ({ page }, testInfo) => {
      world = await makeWorld(testInfo, [ORIGINAL]);
      await page.goto(world.open);
      await booted(page);
      await openEdit(page, INTRO_H2);
      await caret(page, INTRO_H2, "end");
      await page.keyboard.press("Enter");
      await page.keyboard.type(NEW_LINE, { delay: 5 });
      await page.screenshot({ path: testInfo.outputPath("header-line-writing-" + leave + ".png") });
      if (leave === "click") await commitByClickOutside(page);
      else await commitByEsc(page);
      const it = await committedEdit(page);
      await helperHas(world, it.id, it.rev);

      // A correct agent: the new line as its own paragraph under the heading.
      await agentWrites(page, world, [NEW_LINE, ORIGINAL]);

      expect(await page.evaluate((s) => document.querySelector(s).textContent, INTRO_H2), "the h2's text is exactly the header").toBe("Intro");
      expect(await countOnPage(page, NEW_LINE)).toBe(1);
      expect(await sectionText(page)).toContain(NEW_LINE + " " + ORIGINAL);
      const below = await page.evaluate((sel) => {
        const head = document.querySelector(sel + " > .sheet-head");
        const next = head && head.nextElementSibling;
        return next ? { tag: next.tagName, text: next.textContent.trim() } : null;
      }, INTRO_SECTION);
      expect(below, "the line is the block right below the sheet-head").toEqual({ tag: "P", text: NEW_LINE });
      await page.screenshot({ path: testInfo.outputPath("header-line-rebuilt-" + leave + ".png") });
    });
  }

  test("bold two words: an agent that changes nothing and replies handled does not retire the edit", async ({ page }, testInfo) => {
    world = await makeWorld(testInfo, [ORIGINAL]);
    await page.goto(world.open);
    await booted(page);
    await openEdit(page, INTRO_P);
    expect(await selectPhrase(page, INTRO_P, "too fast")).toBe(true);
    await pressBold(page);
    await commitByEsc(page);
    const it = await committedEdit(page);
    expect(it.kind).toBe("format_only");
    await helperHas(world, it.id, it.rev);

    const folded = await reply(world, it, "handled");
    expect(folded.state).toBe("ready");
    expect(folded.handled_not_on_page).toBe(true);
  });

  test("bold two words: a correct agent carries the bold, and it survives the rebuild", async ({ page }, testInfo) => {
    world = await makeWorld(testInfo, [ORIGINAL]);
    await page.goto(world.open);
    await booted(page);
    await openEdit(page, INTRO_P);
    expect(await selectPhrase(page, INTRO_P, "too fast")).toBe(true);
    await pressBold(page);
    await commitByEsc(page);
    const it = await committedEdit(page);
    await helperHas(world, it.id, it.rev);

    await agentWrites(page, world, ["Runners come back **too fast** after a layoff."]);
    const folded = await reply(world, it, "handled");
    expect(folded.state).toBe("handled");
    expect(folded.handled_not_on_page).toBe(false);
    await page.reload();
    await settled(page);
    expect(await page.evaluate((sel) => Array.from(document.querySelectorAll(sel + " strong")).map((n) => n.textContent), INTRO_P)).toEqual([
      "too fast"
    ]);
    expect(await page.evaluate((id) => window.__lahe.itemById(id).state, it.id), "the page check leaves it handled").toBe("handled");
  });
});
