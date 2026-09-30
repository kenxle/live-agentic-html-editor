// Plan Task 3.4: the tests that need every free-writing branch together.
//
// Each test is a real review: `lahe review` or `lahe write` from this checkout,
// its own helper port and state folder (support/lahe_world.js). The reviewer
// types for real. The agent is support/scripted_agent.js: it reads only the
// item, parsed from review.json at its committed revision (or from a drain
// line), and the source text, and it answers with `lahe reply`. A rebuild is a
// write of the source, and the page must reload itself: there is no reload by
// hand anywhere in this file except where the test says the reviewer reloads.
//
// The seams these tests hold together (plan, "Who owns the joins"):
//   2A capture -> 2B replay       typed runs are rebuilt and replayed
//   2A capture -> 2C handled check  real records, read back from review.json
//   the contract -> 2B and 2C     the scripted agent places from the item alone

"use strict";

const { test, expect, pollPage, pollUntil } = require("../helpers");
const fw = require("./support/free_writing_page");
const world_ = require("./support/lahe_world");
const agent = require("./support/scripted_agent");

const {
  makeWorld,
  closeWorld,
  readSource,
  helperHas,
  drainLines,
  reply,
  booted,
  claim,
  settled,
  agentWrites,
  reviewerReloads,
  countOnPage,
  reviewJsonItem
} = world_;

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

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
const ANCHOR_WORDS = "We stopped measuring motion and started measuring outcomes.";

// The worked example (architecture, Key Flows).
const HEADER = "What the chat window cost me";
const PARA = "I lost my place every time";
const BOLD = "every";
const ITEMS = ["scrolling", "re-asking"];

// ---------------------------------------------------------------------------
// The reviewer
// ---------------------------------------------------------------------------

async function openEditAt(page, selector, offset) {
  await claim(page);
  await fw.caretAt(page, selector, 0);
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "edit state to open" });
  const at =
    typeof offset === "number" ? offset : await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await fw.caretAt(page, selector, at);
}

/** Press the bar's B with the mouse, over a phrase selected in the session. */
async function boldPhrase(page, phrase) {
  const found = await page.evaluate((words) => {
    const blocks = window.__lahe.handle.editing.sessionElements();
    for (const el of blocks) {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const at = n.data.indexOf(words);
        if (at === -1) continue;
        const range = document.createRange();
        range.setStart(n, at);
        range.setEnd(n, at + words.length);
        getSelection().removeAllRanges();
        getSelection().addRange(range);
        return true;
      }
    }
    return false;
  }, phrase);
  expect(found, "the phrase '" + phrase + "' is in the sitting").toBe(true);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const rect = await page.evaluate(() => {
    const node = window.__lahe.handle.editing.buttonNode("bold");
    if (!node) return null;
    const r = node.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  expect(rect, "the edit bar shows its B button").toBeTruthy();
  await page.mouse.click(rect.x, rect.y);
  await fw.caretToEndOfSession(page);
}

async function typeWorkedExample(page, anchorSelector, para) {
  await openEditAt(page, anchorSelector);
  await page.keyboard.press("Enter");
  await page.keyboard.type("# " + HEADER, { delay: 2 });
  await page.keyboard.press("Enter");
  await page.keyboard.type(para || PARA, { delay: 2 });
  await boldPhrase(page, BOLD);
  await page.keyboard.press("Enter");
  await page.keyboard.type("- " + ITEMS[0], { delay: 2 });
  await page.keyboard.press("Enter");
  await page.keyboard.type(ITEMS[1], { delay: 2 });
  await fw.commitByEsc(page);
}

/**
 * A ready hand edit the browser holds, other than the ones named in `skip`.
 * Only its id and rev are used: the agent reads the item from review.json.
 */
async function committed(page, skip) {
  const not = skip || [];
  await pollPage(
    page,
    (ids) =>
      window.__lahe.items().some((i) => i.state === "ready" && (i.kind === "edit" || i.kind === "format_only") && ids.indexOf(i.id) === -1),
    not,
    { message: "a ready hand edit in the store" }
  );
  return page.evaluate((ids) => {
    const it = window.__lahe
      .items()
      .filter((i) => i.state === "ready" && (i.kind === "edit" || i.kind === "format_only") && ids.indexOf(i.id) === -1)[0];
    return { id: it.id, rev: it.rev };
  }, not);
}

// ---------------------------------------------------------------------------
// The agent's round: read review.json, place, rebuild, reply
// ---------------------------------------------------------------------------

async function agentRound(page, world, ref, options) {
  const opts = options || {};
  const item = await helperHas(world, ref.id, ref.rev);
  const next = agent.place(world.source, readSource(world), item, opts);
  await agentWrites(page, world, next);
  if (opts.reply !== false) {
    item.folded = await reply(world, item, opts.status || "handled", opts.replyArgs);
  }
  return item;
}

function state(page, id) {
  return page.evaluate((i) => {
    const it = window.__lahe.itemById(i);
    return it ? { state: it.state, rev: it.rev, note: it.note || null } : null;
  }, id);
}

function badges(page, id) {
  return page.evaluate((i) => window.__lahe.rail.cardBadges(i).map((b) => b.code), id);
}

/** The worked example on the page: each block once, with its tag and its bold. */
async function expectWorkedExampleOnce(page, scope, para) {
  const root = scope || "main";
  const PARA_ = para || PARA;
  const shape = await page.evaluate(
    ([sel, header, para, items]) => {
      const r = document.querySelector(sel);
      const h = Array.from(r.querySelectorAll("h2, h3, h4, p, li")).filter((n) => n.textContent.trim() === header);
      const p = Array.from(r.querySelectorAll("p")).filter((n) => n.textContent.trim() === para);
      const lis = items.map((t) => Array.from(r.querySelectorAll("li")).filter((n) => n.textContent.trim() === t));
      return {
        headerTags: h.map((n) => n.tagName.toLowerCase()),
        paraCount: p.length,
        paraBold: p.length ? (p[0].querySelector("strong, b") || { textContent: null }).textContent : null,
        listTags: lis.map((l) => l.map((n) => n.parentElement.tagName.toLowerCase())),
        sameList: lis[0].length === 1 && lis[1].length === 1 && lis[0][0].parentElement === lis[1][0].parentElement
      };
    },
    [root, HEADER, PARA_, ITEMS]
  );
  expect(shape).toEqual({ headerTags: ["h2"], paraCount: 1, paraBold: BOLD, listTags: [["ul"], ["ul"]], sameList: true });
  for (const t of [HEADER, PARA_].concat(ITEMS)) expect(await countOnPage(page, t, root), "'" + t + "' shows once").toBe(1);
}

const BLOG_HTML = require("node:fs").readFileSync(require("node:path").join(fw.REPO_ROOT, "test/fixtures/free_writing/blog.html"), "utf8");

/** The item is handled on both sides: the helper did not hold it, the page did not reopen it. */
async function expectQuietlyHandled(page, world, id) {
  expect(reviewJsonItem(world, id), "the handled check let it through").toMatchObject({ state: "handled", handled_not_on_page: false });
  // The page learns of the agent's reply on its next poll. Until it holds the
  // handled state, "the page check did not reopen it" cannot be told apart from
  // "the page check has not seen the reply yet". So wait for the browser to
  // hold it, then load again so the page check runs on a page that has it.
  await pollPage(
    page,
    (i) => {
      const it = window.__lahe.itemById(i);
      return !!it && it.state === "handled";
    },
    id,
    { message: "the browser to hold " + id + " as handled", timeoutMs: 20000 }
  );
  await reviewerReloads(page);
  expect(await state(page, id), "the page check did not reopen it").toMatchObject({ state: "handled" });
  expect(await page.evaluate(() => window.__lahe.counters.revertReopens), "the page check reopened nothing on this load").toBe(0);
  expect(await badges(page, id), "no note on the card").toEqual([]);
}

/** Held by the handled check: still ready in review.json, flagged, back on the drain. */
async function expectHeld(world, id) {
  const it = await pollUntil(
    () => {
      const got = reviewJsonItem(world, id);
      return got && got.handled_not_on_page === true ? got : null;
    },
    { message: "the handled check to hold " + id, timeoutMs: 20000 }
  );
  expect(it.state).toBe("ready");
  expect(drainLines(world).map((l) => l.id), "the held item is back on the drain").toContain(id);
}

function newWorld(file, text) {
  return makeWorld({ file: file, text: text });
}

test.describe("free writing seams", () => {
  let world = null;
  test.afterEach(() => {
    closeWorld(world);
    world = null;
  });

  test("placement: a header, paragraph and list typed after a block are placed, rebuilt, shown once with tags and bold, not reopened", async ({
    page
  }) => {
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await typeWorkedExample(page, ANCHOR_P);
    const ref = await committed(page);
    const item = await helperHas(world, ref.id, ref.rev);
    expect(item.new_blocks.map((b) => b.tag)).toEqual(["h2", "p", "ul"]);

    // The drain line carries the same item, its text under page, and the
    // agent places it the same way.
    const line = drainLines(world).find((l) => l.id === ref.id);
    expect(line, "the drain lists the item").toBeTruthy();
    expect(line.page.new_blocks, "new_blocks sits under page on a drain line").toEqual(item.new_blocks);
    expect(line.new_blocks, "and not at the top level").toBeUndefined();
    const fromDrain = agent.place(world.source, readSource(world), agent.itemFromDrainLine(line));
    expect(fromDrain).toBe(agent.place(world.source, readSource(world), item));

    await agentRound(page, world, ref);
    await expectWorkedExampleOnce(page);
    await reviewerReloads(page);
    await expectWorkedExampleOnce(page);
    await expectQuietlyHandled(page, world, ref.id);
  });

  test("HTML: the worked example, one block holding < and &, placed into blog.html's source; both checks pass", async ({ page }) => {
    const para = "I lost my place every time, 3 < 5 & counting";
    world = await newWorld("blog.html", BLOG_HTML);
    await page.goto(world.open);
    await booted(page);
    await typeWorkedExample(page, "#p2", para);
    const ref = await committed(page);
    const item = await helperHas(world, ref.id, ref.rev);
    expect(item.new_blocks[1].html).toBe("I lost my place <strong>every</strong> time, 3 &lt; 5 &amp; counting");

    // The drain line variant, placed from the drain line itself this time.
    const line = drainLines(world).find((l) => l.id === ref.id);
    const next = agent.place(world.source, readSource(world), agent.itemFromDrainLine(line));
    expect(next).toContain("<p>I lost my place <strong>every</strong> time, 3 &lt; 5 &amp; counting</p>");
    await agentWrites(page, world, next);
    await reply(world, item, "handled");
    await expectWorkedExampleOnce(page, "#post", para);
    await reviewerReloads(page);
    await expectWorkedExampleOnce(page, "#post", para);
    await expectQuietlyHandled(page, world, ref.id);
  });

  test("special characters: the page's text is the typed text, typography folded, and both checks pass", async ({ page }) => {
    const typed = "Use <b> & *stars* _under_ `code` # not a heading 1. not a list \"straight\" 'quotes' -- dashes";
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await openEditAt(page, ANCHOR_P);
    await page.keyboard.press("Enter");
    await page.keyboard.type(typed, { delay: 2 });
    await fw.commitByEsc(page);
    const ref = await committed(page);
    await agentRound(page, world, ref);
    // R6: the words match on the page, in the record, and in the source. The
    // scripted agent decodes and escapes everything it is given, so a mangled
    // record would still show the right words on the page; read the record and
    // the source themselves.
    const recorded = reviewJsonItem(world, ref.id);
    // The projection's text is the block's words with < > & as entities (see
    // the progress page: whether the contract should say so is F3's call).
    // Read back through those entities it must be exactly what was typed.
    const unescaped = recorded.new_blocks[0].text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
    expect(unescaped, "the record holds the typed text").toBe(typed);
    expect(recorded.new_blocks[0].html, "and its html escapes only < > &").toBe(
      typed.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    );
    const placedSource = readSource(world)
      .split(/\n[ \t]*\n/)
      .find((b) => agent.mdWords(b) === agent.htmlWords(typed.replace(/&/g, "&amp;").replace(/</g, "&lt;")));
    expect(placedSource, "the source holds the typed words as its own block").toBeTruthy();
    const shown = await page.evaluate((anchor) => {
      const a = Array.from(document.querySelectorAll("main p")).find((p) => p.textContent.trim() === anchor);
      const next = a && a.nextElementSibling;
      return next ? { tag: next.tagName.toLowerCase(), text: next.textContent, marks: next.querySelectorAll("*").length } : null;
    }, ANCHOR_WORDS);
    const f = (t) => agent.htmlWords(t.replace(/&/g, "&amp;").replace(/</g, "&lt;"));
    expect(shown, "the block right after the anchor").toBeTruthy();
    expect(shown.tag).toBe("p");
    expect(shown.marks, "no markup read out of the literal text").toBe(0);
    expect(f(shown.text)).toBe(f(typed));
    await reviewerReloads(page);
    await expectQuietlyHandled(page, world, ref.id);
  });

  test("split: Enter mid-paragraph, type, commit; the agent splits the source; the text shows once with no conflict card", async ({
    page
  }) => {
    const head = "We stopped measuring motion";
    const tail = "and started measuring outcomes.";
    const typed = "Typed after the split";
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await openEditAt(page, ANCHOR_P, head.length);
    await page.keyboard.press("Enter");
    await fw.caretToEndOfSession(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type(typed, { delay: 2 });
    await fw.commitByEsc(page);
    const ref = await committed(page);
    const item = await helperHas(world, ref.id, ref.rev);
    expect(item.new_blocks[0]).toMatchObject({ from_anchor: true, text: tail });
    await agentRound(page, world, ref);
    expect(readSource(world)).toContain(head + "\n\n" + tail + "\n\n" + typed);
    for (const t of [head, tail, typed]) expect(await countOnPage(page, t), "'" + t + "' once").toBe(1);
    await reviewerReloads(page);
    await expectQuietlyHandled(page, world, ref.id);
  });

  test("retag and undo: paragraph to heading, rebuilt, then undone: the heading survives the rebuild, undo restores the paragraph and raises a take-back", async ({
    page
  }) => {
    const words = "A second paragraph in the first section.";
    const sel = "main > section:first-of-type > p:nth-of-type(2)";
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await openEditAt(page, sel, 0);
    await page.keyboard.type("# ", { delay: 2 });
    await fw.commitByEsc(page);
    const ref = await committed(page);
    const item = await agentRound(page, world, ref);
    expect(item.anchor_tag_after).toBe("h2");
    expect(readSource(world)).toContain("## " + words);
    const tagNow = () =>
      page.evaluate((w) => Array.from(document.querySelectorAll("main h2, main p")).filter((n) => n.textContent.trim() === w).map((n) => n.tagName), words);
    expect(await tagNow(), "the heading survives the rebuild").toEqual(["H2"]);
    await expectQuietlyHandled(page, world, ref.id);

    const res = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), ref.id);
    expect(res.reverted).toBe(true);
    expect(res.revert, "undo of a handled edit raises a take-back").toBeTruthy();
    expect(await tagNow(), "undo restores the paragraph").toEqual(["P"]);
    const back = await committed(page, [ref.id]);
    expect(back.id).toBe(res.revert);
    const taken = await helperHas(world, back.id, back.rev);
    expect(taken.reverts).toBe(ref.id);
  });

  test("undo a ready run, then reload twice: the run is gone", async ({ page }) => {
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await typeWorkedExample(page, ANCHOR_P);
    const ref = await committed(page);
    await helperHas(world, ref.id, ref.rev);
    const res = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), ref.id);
    expect(res.reverted).toBe(true);
    expect(res.revert, "an unhandled run is withdrawn, not taken back").toBeNull();
    for (let i = 0; i < 2; i += 1) {
      await reviewerReloads(page);
      for (const t of [HEADER, PARA].concat(ITEMS)) expect(await countOnPage(page, t), "'" + t + "' is gone").toBe(0);
    }
    await pollUntil(() => drainLines(world).every((l) => l.id !== ref.id), { message: "the withdrawn run to leave the drain" });
  });

  test("undo a handled run: the agent removes the blocks and answers the take-back; nothing is reinserted and neither item reopens", async ({
    page
  }) => {
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await typeWorkedExample(page, ANCHOR_P);
    const ref = await committed(page);
    await agentRound(page, world, ref);
    await expectWorkedExampleOnce(page);

    const res = await page.evaluate((id) => window.__lahe.handle.editing.undo(id), ref.id);
    expect(res.revert).toBeTruthy();
    const back = await committed(page, [ref.id]);
    const taken = await agentRound(page, world, back);
    expect(taken.remove_blocks.length).toBe(3);
    expect(readSource(world)).not.toContain(HEADER);
    // The page holds the take-back's answer before any of the checks below can mean anything.
    await pollPage(
      page,
      (i) => {
        const it = window.__lahe.itemById(i);
        return !!it && it.state === "handled";
      },
      back.id,
      { message: "the browser to hold the take-back as handled", timeoutMs: 20000 }
    );
    for (let i = 0; i < 2; i += 1) {
      await reviewerReloads(page);
      for (const t of [HEADER, PARA].concat(ITEMS)) expect(await countOnPage(page, t), "'" + t + "' is not reinserted").toBe(0);
      expect(await state(page, back.id)).toMatchObject({ state: "handled" });
      expect(reviewJsonItem(world, back.id)).toMatchObject({ state: "handled", handled_not_on_page: false });
      expect(["handled", "reverted", "withdrawn"]).toContain((await state(page, ref.id) || { state: "withdrawn" }).state);
      expect(drainLines(world).map((l) => l.id)).not.toContain(ref.id);
    }
  });

  test("list: Enter at the end of an existing bullet, type, commit, rebuild: the new item shows once", async ({ page }) => {
    const sel = "main > section:nth-of-type(2) li:last-child";
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await openEditAt(page, sel);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Deeper work", { delay: 2 });
    await fw.commitByEsc(page);
    const ref = await committed(page);
    await agentRound(page, world, ref);
    expect(readSource(world)).toContain("- Fewer meetings\n- Longer blocks\n- Deeper work");
    expect(await countOnPage(page, "Deeper work")).toBe(1);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll("main ul")).map((u) => u.children.length))).toEqual([3]);
    await reviewerReloads(page);
    await expectQuietlyHandled(page, world, ref.id);
  });

  test("reload mid-sitting: the record is ready and the run is back, and Cmd-Shift-E on a run block reopens it", async ({ page }) => {
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await openEditAt(page, ANCHOR_P);
    await page.keyboard.press("Enter");
    await page.keyboard.type("# " + HEADER, { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type(PARA, { delay: 2 });
    await reviewerReloads(page);
    const ref = await committed(page);
    await helperHas(world, ref.id, ref.rev);
    for (const t of [HEADER, PARA]) expect(await countOnPage(page, t), "'" + t + "' is back once").toBe(1);
    await claim(page);
    const runP = await page.evaluate((w) => {
      const p = Array.from(document.querySelectorAll("main p")).find((n) => n.textContent.trim() === w);
      p.setAttribute("data-seams-probe", "1");
      return true;
    }, PARA);
    expect(runP).toBe(true);
    await fw.caretAt(page, "[data-seams-probe]", 3);
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "Cmd-Shift-E on a run block" });
    expect(await page.evaluate(() => window.__lahe.editState().itemId)).toBe(ref.id);
  });

  test("reload mid-sitting with a run over FLUSH.KEEPALIVE_MAX_BYTES: the run still reaches the helper", async ({ page }) => {
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    const max = await page.evaluate(() => window.LAHE.protocol.FLUSH.KEEPALIVE_MAX_BYTES);
    const para = (n) => "Paragraph " + n + " " + "of a long sitting that goes on and on ".repeat(12).trim();
    const count = Math.ceil(max / para(0).length) + 4;
    const text = Array.from({ length: count }, (_, i) => para(i)).join("\n\n");
    await openEditAt(page, ANCHOR_P);
    await page.keyboard.press("Enter");
    await fw.pasteText(page, text);
    const size = await page.evaluate(() => {
      const d = window.__lahe.items().find((i) => i.kind === "edit");
      return d ? JSON.stringify(d).length : 0;
    });
    expect(size, "the draft is over the keepalive ceiling").toBeGreaterThan(max);
    await reviewerReloads(page);
    const ref = await committed(page);
    const item = await helperHas(world, ref.id, ref.rev);
    expect(item.new_blocks.length).toBe(count);
    expect(item.new_blocks[count - 1].text).toBe(para(count - 1));
  });

  test("rebuild mid-sitting: the reload waits while the sitting is open, the text stays, and the commit brings the rebuilt page", async ({
    page
  }) => {
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await world_.mtimeBaseline(page);
    await openEditAt(page, ANCHOR_P);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Half a thought", { delay: 2 });
    const caretBefore = await fw.caretSpot(page);
    expect(caretBefore, "the caret is in the run before the rebuild").toMatchObject({ block: 1 });
    const nav = world_.navCounter(page);
    world_.writeSource(world, DOC_MD.replace("A short lede that sits in the hero.", "A lede the agent rebuilt."));
    await pollPage(
      page,
      () => {
        const s = window.__lahe.handle.sync.status();
        return s.reloadPending === true && s.reloadChecks >= 1;
      },
      undefined,
      { message: "the rebuild to wait on the open sitting", timeoutMs: 30000 }
    );
    expect(nav.count, "no navigation while the sitting is open").toBe(0);
    const during = await page.evaluate(() => {
      const s = getSelection();
      const blocks = window.__lahe.handle.editing.sessionElements();
      return {
        open: window.__lahe.isEditing(),
        text: blocks.map((b) => b.textContent).join("|"),
        caretInRun: !!s.focusNode && blocks.some((b) => b.contains(s.focusNode))
      };
    });
    expect(during.open).toBe(true);
    expect(during.text).toContain("Half a thought");
    expect(during.caretInRun).toBe(true);
    expect(await fw.caretSpot(page), "the caret stayed at its block and offset").toEqual(caretBefore);
    await page.keyboard.type(" more", { delay: 2 });
    await fw.commitByEsc(page);
    await pollUntil(() => nav.count > 0, { message: "the commit to let the rebuild reload the page", timeoutMs: 30000 });
    nav.stop();
    await page.waitForLoadState("load");
    await settled(page);
    expect(await countOnPage(page, "A lede the agent rebuilt.", "body")).toBe(1);
    expect(await countOnPage(page, "Half a thought more")).toBe(1);
  });

  // Two ways the browser goes down mid-sitting. "renderer" crashes the
  // renderer and then closes the browser cleanly (browser storage is flushed
  // on the way out). "sigkill" kills the browser process itself, the way a real
  // crash or a force quit does, with nothing flushed.
  // "sigkill-late" waits 6 seconds after the last keystroke first, longer than
  // a browser takes to flush its storage: what was typed that long ago must
  // survive. "sigkill" kills at once, and only records how much survived.
  for (const how of ["renderer", "sigkill", "sigkill-late"]) {
    test("crash mid-sitting, " + how + " (persistent context): the next load commits the whole run, each block once, and the run reopens", async ({ browserName }, testInfo) => {
      test.skip(browserName !== "chromium", "a persistent Chromium context and a renderer crash");
      const { chromium } = require("@playwright/test");
      const { execFileSync } = require("node:child_process");
      world = await newWorld("doc.md", DOC_MD);
      const profile = testInfo.outputPath("profile");
      let ctx = await chromium.launchPersistentContext(profile, { headless: true });
      let page = ctx.pages()[0] || (await ctx.newPage());
      await page.goto(world.open);
      await booted(page);
      await openEditAt(page, ANCHOR_P);
      await page.keyboard.press("Enter");
      await page.keyboard.type("# " + HEADER, { delay: 2 });
      await page.keyboard.press("Enter");
      await page.keyboard.type(PARA, { delay: 2 });
      await page.keyboard.press("Enter");
      await page.keyboard.type("A third block before the crash", { delay: 2 });
      await pollPage(
        page,
        () => {
          const d = window.__lahe.items().find((i) => i.kind === "edit");
          return !!d && Array.isArray(d.new_blocks) && d.new_blocks.length === 3;
        },
        undefined,
        { message: "the draft to hold all three blocks" }
      );
      const psLines = () => execFileSync("ps", ["-ax", "-o", "pid=,command="], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).split("\n");
      const gone = new Promise((resolve) => ctx.once("close", resolve));
      if (how === "renderer") {
        // Crash the renderer, so no unload runs, then let the browser go down.
        const spare = await ctx.newPage();
        const browserSession = await ctx.newCDPSession(spare);
        const cdp = await ctx.newCDPSession(page);
        const crashed = new Promise((resolve) => page.once("crash", resolve));
        cdp.send("Page.crash").catch(() => null); // never answers: the renderer is gone
        await crashed;
        await browserSession.send("Browser.close").catch(() => null);
      } else {
        if (how === "sigkill-late") {
          // No signal says the browser's storage reached disk; the condition is
          // the clock: six seconds since the last keystroke.
          const flushedBy = Date.now() + 6000;
          await pollUntil(() => (Date.now() >= flushedBy ? true : null), {
            message: "six seconds to pass since the last keystroke, so the browser has flushed its storage",
            timeoutMs: 20000
          });
        }
        // The browser process for this profile: the one line naming the
        // profile that is not a child (renderer, GPU, utility) process.
        const main = psLines().filter((l) => l.indexOf(profile) !== -1 && l.indexOf("--type=") === -1);
        expect(main.length, "exactly one browser process owns the profile").toBe(1);
        process.kill(Number(main[0].trim().split(/\s+/)[0]), "SIGKILL");
      }
      await gone;
      // The old browser has exited before the new one opens its profile.
      await pollUntil(() => psLines().every((l) => l.indexOf(profile) === -1), { message: "the crashed browser to exit", timeoutMs: 20000 });

      ctx = await chromium.launchPersistentContext(profile, { headless: true, timeout: 20000 });
      try {
        page = ctx.pages()[0] || (await ctx.newPage());
        await page.goto(world.open);
        await booted(page);
        // The dead tab's hold on the review is the reviewer's to take back.
        await claim(page);
        await settled(page);
        const typed = [HEADER, PARA, "A third block before the crash"];
        let ref = null;
        try {
          ref = await committed(page);
        } catch (err) {
          // Nothing in the store: only an immediate SIGKILL may lose it all.
          expect(how, "a run typed 6 seconds before the kill, or a clean close, is not lost").toBe("sigkill");
        }
        testInfo.annotations.push({ type: "kept-after-" + how, description: ref ? "a ready record" : "nothing in the browser store" });
        if (!ref) return;
        const item = await helperHas(world, ref.id, ref.rev);
        expect(item.state).toBe("ready");
        const kept = item.new_blocks.map((b) => b.text);
        // How much a SIGKILL loses is a product question, not a test fix: the
        // kept blocks are recorded on the progress page. What must hold either
        // way is that what was kept is a prefix of what was typed.
        testInfo.annotations.push({ type: "kept-after-" + how, description: JSON.stringify(kept) });
        expect(kept, "what survived is the start of what was typed, in order").toEqual(typed.slice(0, kept.length));
        if (how !== "sigkill") expect(kept).toEqual(typed);
        // R5: the reviewer can reopen it and keep writing. Each kept block is
        // on the page once, and Cmd-Shift-E on the last one reopens the record.
        for (const t of kept) expect(await countOnPage(page, t), "'" + t + "' shows once after the relaunch").toBe(1);
        const last = kept[kept.length - 1];
        await page.evaluate((w) => {
          const p = Array.from(document.querySelectorAll("main h2, main h3, main p")).find((n) => n.textContent.trim() === w);
          p.setAttribute("data-seams-probe", "1");
        }, last);
        await fw.caretAt(page, "[data-seams-probe]", 2);
        await page.keyboard.press("ControlOrMeta+Shift+KeyE");
        await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "Cmd-Shift-E on the last kept block" });
        expect(await page.evaluate(() => window.__lahe.editState().itemId), "it reopened the record").toBe(ref.id);
      } finally {
        await ctx.close();
      }
    });
  }

  test("handled check: a real run answered handled with nothing written is held open", async ({ page }) => {
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await typeWorkedExample(page, ANCHOR_P);
    const ref = await committed(page);
    const item = await helperHas(world, ref.id, ref.rev);
    await reply(world, item, "handled");
    await expectHeld(world, ref.id);
  });

  test("handled check: a real run whose words the agent wrote as raw HTML is held open", async ({ page }) => {
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await openEditAt(page, ANCHOR_P);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Wrap the word in <b> tags", { delay: 2 });
    await fw.commitByEsc(page);
    const ref = await committed(page);
    const item = await helperHas(world, ref.id, ref.rev);
    // Not the contract: the block's html decoded and pasted in, unescaped.
    const raw = readSource(world).replace(ANCHOR_WORDS + "\n", ANCHOR_WORDS + "\n\nWrap the word in <b> tags\n");
    await agentWrites(page, world, raw);
    await reply(world, item, "handled");
    await expectHeld(world, ref.id);
  });

  test("handled check: two real runs, one placed, handled on both: the skipped one is held open", async ({ page }) => {
    world = await newWorld("doc.md", DOC_MD);
    await page.goto(world.open);
    await booted(page);
    await typeWorkedExample(page, ANCHOR_P);
    const a = await committed(page);
    await openEditAt(page, "main > section:nth-of-type(2) > div.sheet-head h2");
    await page.keyboard.press("Enter");
    await page.keyboard.type("A second run the agent skips", { delay: 2 });
    await fw.commitByEsc(page);
    const b = await committed(page, [a.id]);
    const itemB = await helperHas(world, b.id, b.rev);
    await agentRound(page, world, a);
    await reply(world, itemB, "handled");
    await expectHeld(world, b.id);
    expect(reviewJsonItem(world, a.id)).toMatchObject({ state: "handled", handled_not_on_page: false });
  });

  test("notes page: three sittings on an empty lahe write page become one record, placed at the top, every block once", async ({
    page
  }) => {
    world = await makeWorld({ file: "notes.md", command: "write", create: false });
    await page.goto(world.open);
    await booted(page);
    await claim(page);
    await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "the empty page to open ready to type" });
    await page.keyboard.type("# Notes", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("First thought", { delay: 2 });
    await fw.commitByEsc(page);
    const first = await committed(page);
    for (const more of ["Second thought", "Third thought"]) {
      await continueSitting(page, more);
    }
    const ref = await committed(page);
    expect(ref.id, "every sitting grew the one record").toBe(first.id);
    const item = await agentRound(page, world, ref);
    expect(item.placement).toBe("start_of_container");
    expect(item.new_blocks.map((b) => b.text)).toEqual(["Notes", "First thought", "Second thought", "Third thought"]);
    expect(readSource(world)).toBe("## Notes\n\nFirst thought\n\nSecond thought\n\nThird thought\n");
    for (const t of ["Notes", "First thought", "Second thought", "Third thought"]) expect(await countOnPage(page, t), t).toBe(1);
    await reviewerReloads(page);
    await expectQuietlyHandled(page, world, ref.id);
  });

  // WAITING ON F1 (testing I8): editing.js hasContent() counts the front-matter
  // block (<details class="frontmatter"><pre>) as page content, so a notes
  // file holding only front matter never opens ready to type. With hasContent
  // ignoring details.frontmatter this whole test passes (progress/phase7_fix_f4.md).
  test.fixme("notes page with front matter: the page opens ready to type, the blocks sit below the metadata once, and the source keeps its front matter byte for byte", async ({
    page
  }) => {
    const front = "---\ntitle: Field notes\ndate: 2026-09-29\n---\n";
    world = await makeWorld({ file: "notes.md", command: "write", create: true, text: front });
    await page.goto(world.open);
    await booted(page);
    await claim(page);
    await pollPage(page, () => window.__lahe.editState().open === true, undefined, {
      message: "a front-matter-only page to open ready to type"
    });
    await page.keyboard.type("First thought", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("Second thought", { delay: 2 });
    await fw.commitByEsc(page);
    const ref = await committed(page);
    const item = await agentRound(page, world, ref);
    expect(item.placement).toBe("start_of_container");
    const src = readSource(world);
    expect(src.startsWith(front), "the front matter is untouched, byte for byte").toBe(true);
    expect(src.slice(front.length).replace(/^\n+/, "")).toBe("First thought\n\nSecond thought\n");
    for (const t of ["First thought", "Second thought"]) expect(await countOnPage(page, t), t + " once").toBe(1);
    // Below the metadata: the page's first typed block does not come before the
    // block the front matter renders as.
    const order = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll("main *, body > *"));
      const at = (t) => all.findIndex((n) => n.children.length === 0 && n.textContent.trim() === t);
      return { meta: all.findIndex((n) => /Field notes/.test(n.textContent) && n.children.length === 0), first: at("First thought"), second: at("Second thought") };
    });
    expect(order.first, "the first block is on the page").toBeGreaterThan(-1);
    if (order.meta > -1) expect(order.meta, "the metadata comes before the typed blocks").toBeLessThan(order.first);
    expect(order.first).toBeLessThan(order.second);
    await reviewerReloads(page);
    await expectQuietlyHandled(page, world, ref.id);
  });

  test("notes page: a sitting added after revision 1 is placed is placed as revision 2, every block once", async ({ page }) => {
    world = await makeWorld({ file: "notes.md", command: "write", create: false });
    await page.goto(world.open);
    await booted(page);
    await claim(page);
    await pollPage(page, () => window.__lahe.editState().open === true, undefined, { message: "the empty page to open ready to type" });
    await page.keyboard.type("First thought", { delay: 2 });
    await fw.commitByEsc(page);
    const one = await committed(page);
    await agentRound(page, world, one, { reply: false });
    expect(await countOnPage(page, "First thought")).toBe(1);
    await continueSitting(page, "Second thought");
    const two = await committed(page);
    expect(two).toEqual({ id: one.id, rev: one.rev + 1 });
    await agentRound(page, world, two);
    expect(readSource(world)).toBe("First thought\n\nSecond thought\n");
    for (const t of ["First thought", "Second thought"]) expect(await countOnPage(page, t), t).toBe(1);
    await reviewerReloads(page);
    await expectQuietlyHandled(page, world, one.id);
  });

  // The "long" case is a sitting past the 2000 characters review.json keeps of
  // each earlier revision (review_format BEFORE_MAX): the typo sits in a block
  // past that cut, so an agent reading only review.json cannot find the old
  // words in after_history. WAITING ON F3 (testing I3, ADV 4): the contract
  // decision (keep new_blocks uncut for run records, or tell the agent to find
  // the old words by the suggestion's from). Once that lands this case is the
  // guard; the scripted agent then follows the contract's new line.
  const PROOF_CASES = [
    { answer: "use-fixes", long: false },
    { answer: "keep-mine", long: false },
    { answer: "use-fixes", long: true }
  ];
  for (const { answer, long } of PROOF_CASES) {
    const proofTest = long ? test.fixme : test;
    proofTest("proofreading" + (long ? " (long run, typo past character 2000)" : "") + ": a run over 150 words, placed, proofread; " + answer + ", the agent answers; not held or reopened over two reloads", async ({
      page
    }) => {
      const wrong = "I lost my place evry time I scrolled back.";
      const right = "I lost my place every time I scrolled back.";
      const filler = long
        ? Array.from({ length: 12 }, (_, p) =>
            Array.from({ length: 6 }, (_, i) => "Sentence " + (p * 6 + i + 1) + " of the long sitting has ten words in it.").join(" ")
          ).join("\n\n")
        : Array.from({ length: 16 }, (_, i) => "Sentence " + (i + 1) + " of the long sitting has ten words in it.").join(" ");
      // The block the typo is in: the run's last (1 for the short sitting).
      const typoBlock = long ? 12 : 1;
      world = await newWorld("doc.md", DOC_MD);
      await page.goto(world.open);
      await booted(page);
      await openEditAt(page, ANCHOR_P);
      await page.keyboard.press("Enter");
      await fw.pasteText(page, filler + "\n\n" + wrong);
      await fw.commitByEsc(page);
      const ref = await committed(page);
      const item = await agentRound(page, world, ref, { reply: false });
      expect(item.proofread).toBe(true);
      expect(item.run_words).toBeGreaterThan(150);
      await reply(world, item, "question", [
        "--proofread",
        "--text",
        "I placed your words as written. One typo, if you want it fixed.",
        "--suggest",
        String(typoBlock),
        "evry",
        "every"
      ]);
      await pollPage(
        page,
        ([id, act]) => {
          const card = window.__lahe.rail.cardNode(id);
          return !!(card && card.querySelector(".lahe-ask [data-lahe-act='" + act + "']"));
        },
        [ref.id, answer],
        { message: "the proofread question's buttons on the card" }
      );
      await page.evaluate(
        ([id, act]) => window.__lahe.rail.cardNode(id).querySelector(".lahe-ask [data-lahe-act='" + act + "']").click(),
        [ref.id, answer]
      );
      // A question keeps the item outstanding, so a ready edit is already in
      // the store; wait for the bump itself, as agent_replies does.
      await pollPage(page, ([id, rev]) => window.__lahe.itemById(id).rev === rev + 1, [ref.id, ref.rev], {
        message: "the answer to make revision " + (ref.rev + 1)
      });
      const again = await committed(page);
      expect(again).toEqual({ id: ref.id, rev: ref.rev + 1 });
      const fixed = await agentRound(page, world, again);
      if (answer === "use-fixes") {
        expect(fixed.new_blocks[typoBlock].text).toBe(right);
        expect(readSource(world)).not.toContain(wrong);
      } else {
        expect(fixed.new_blocks[typoBlock].text).toBe(wrong);
      }
      const shown = answer === "use-fixes" ? right : wrong;
      for (let i = 0; i < 2; i += 1) {
        await reviewerReloads(page);
        expect(await countOnPage(page, shown)).toBe(1);
        if (answer === "use-fixes") expect(await countOnPage(page, wrong), "the original sentence is gone").toBe(0);
        await expectQuietlyHandled(page, world, ref.id);
      }
    });
  }

  // The plan asks, for both sources, that the item be "reopened or flagged,
  // never quietly handled". In Markdown it is: after pasted as paragraphs
  // loses the heading and the list, and the page check reopens it. In HTML the
  // old agent applies after_html as the anchor's content, and after_html now
  // carries every block with its tag, so the browser's parse gives the right
  // page (the p closes at the h2). The architecture ("Rollout and old agents")
  // promises only that nothing wrong is handled silently, so the HTML case
  // holds that: reopened or flagged, OR every block on the page with its tag
  // and bold. Flagged to the orchestrator as a plan-versus-architecture gap.
  for (const kind of ["html", "md"]) {
    test("old agents (" + kind + "): the old-contract agent shows no block twice, and nothing wrong is quietly handled", async ({
      page
    }) => {
      world = kind === "html" ? await newWorld("blog.html", BLOG_HTML) : await newWorld("doc.md", DOC_MD);
      const scope = kind === "html" ? "#post" : "main";
      await page.goto(world.open);
      await booted(page);
      await typeWorkedExample(page, kind === "html" ? "#p2" : ANCHOR_P);
      const ref = await committed(page);
      await agentRound(page, world, ref, { oldContract: true });
      // The page learns of the reply on its next poll. Reload only once it
      // holds the reply, or the page check runs on a page that has not heard.
      await pollPage(
        page,
        (i) => {
          const it = window.__lahe.itemById(i);
          return !!it && (it.state === "handled" || !!it.reply);
        },
        ref.id,
        { message: "the browser to hold the old agent's reply", timeoutMs: 20000 }
      );
      await reviewerReloads(page);
      for (const t of [HEADER, PARA].concat(ITEMS)) {
        const n = await countOnPage(page, t, scope);
        expect(n, "'" + t + "' at most once").toBeLessThanOrEqual(1);
        // The architecture says an old agent places every word, with whatever
        // tag it manages. A Markdown agent that dropped a block would pass "at
        // most once", so there each block's words must show exactly once.
        if (kind === "md") expect(n, "'" + t + "' is on the page, once").toBe(1);
      }
      const seen = { json: reviewJsonItem(world, ref.id), page: await state(page, ref.id), badges: await badges(page, ref.id) };
      const reopened = seen.json.state === "ready" || (seen.page && seen.page.state === "ready");
      const flagged = seen.json.handled_not_on_page === true || seen.badges.length > 0;
      if (kind === "md") {
        expect(reopened || flagged, "reopened or flagged: " + JSON.stringify(seen)).toBe(true);
        expect(seen.page.note, "the page check names the wrong tag").toContain("different tag");
      } else if (!(reopened || flagged)) {
        await expectWorkedExampleOnce(page, scope);
      }
    });
  }
});

/** Cmd-Shift-E at the end of the record's last block, Enter, a new block, Esc. */
async function continueSitting(page, words) {
  await claim(page);
  await page.evaluate(() => {
    const main = document.querySelector("main");
    const leaves = Array.from(main.querySelectorAll("p, h2, h3, h4, li")).filter((n) => n.textContent.trim());
    leaves[leaves.length - 1].setAttribute("data-seams-last", "1");
  });
  await openEditAt(page, "[data-seams-last]");
  await page.evaluate(() => document.querySelector("[data-seams-last]").removeAttribute("data-seams-last"));
  await page.keyboard.press("Enter");
  await page.keyboard.type(words, { delay: 2 });
  await fw.commitByEsc(page);
}
