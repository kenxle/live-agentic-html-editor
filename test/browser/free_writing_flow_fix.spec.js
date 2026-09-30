// Free writing, the editing-side fixes from the flow walk
// (docs/features/20260928.01_free_writing/reviews_impl/flow_walk.md).
//
// Each describe block is one finding. The helper is down (the shared
// free-writing page set-up), so every decision checked here is the browser's.

"use strict";

const path = require("node:path");
const fs = require("node:fs");

const { test, expect, startStaticServer, pollPage } = require("../helpers");
const fw = require("./support/free_writing_page");

// Screenshots for the progress page: set LAHE_SHOTS_DIR to save them. They are
// taken after the assertions that prove the change, in the same run.
async function shot(page, name) {
  const dir = process.env.LAHE_SHOTS_DIR;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const lane = test.info().project.name;
  await page.screenshot({ path: path.join(dir, name + (lane === "chromium" ? "" : "-" + lane) + ".png") });
}

// A dense page: no margins between blocks, tight lines. There is no gap for
// the bar anywhere, which is where it used to cover the text above.
const DENSE_CSS =
  "p, h1, h2, ul, article > p, h2 + p { margin: 0 !important; } body { line-height: 1.3 !important; margin-top: 90px !important; }";
const DARK_CSS = "html, body { background: #16181d !important; color: #e6e6e6 !important; } strong { color: #ffd479 !important; }";

async function addStyle(page, css) {
  await page.evaluate((text) => {
    const el = document.createElement("style");
    el.textContent = text;
    document.head.appendChild(el);
  }, css);
}

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "fw-flow-fix" });
});

test.afterAll(async () => {
  await server.close();
});

const HEAD = "Most weeks look busy from the outside.";
const TAIL = "This one did not.";

// The flow walk's record 62: Enter in the middle of a paragraph, then new text,
// marked every new block from_anchor. The contract tells the agent not to add
// from_anchor words again, so a literal agent dropped the reviewer's sentence.
test.describe("from_anchor marks only the page's own words", () => {
  test("new lines typed into a split tail are new blocks; only the page's words are moved", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", HEAD.length);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Brand new words here.", { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("A second new line.", { delay: 2 });
    await page.keyboard.press("Enter");
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([
      { tag: "p", html: "Brand new words here." },
      { tag: "p", html: "A second new line." },
      { tag: "p", html: TAIL, from_anchor: true }
    ]);
    expect(item.anchor_after_html).toBe(HEAD);
    expect(item.change).toContain("Added 2 blocks");
  });

  // What a literal agent writes from the record, rebuilt on the page as the
  // source would come back: the anchor becomes anchor_after_html, and each
  // new block not marked from_anchor goes after it; a from_anchor block is
  // the anchor's own tail, split off as it is. Returns the blocks between the
  // anchor and #h2, and the page's words.
  function placeAndRebuild(page, item) {
    return page.evaluate((rec) => {
      const p1 = document.getElementById("p1");
      const original = "Most weeks look busy from the outside. This one did not.";
      // The source as it was: the session's blocks go, the anchor is the original.
      while (p1.nextElementSibling && p1.nextElementSibling.id !== "h2") p1.nextElementSibling.remove();
      p1.textContent = original;
      p1.innerHTML = rec.anchor_after_html;
      let at = p1;
      rec.new_blocks.forEach((b) => {
        const el = document.createElement(b.tag);
        el.innerHTML = b.html;
        at.after(el);
        at = el;
      });
      const out = [];
      for (let el = p1.nextElementSibling; el && el.id !== "h2"; el = el.nextElementSibling) {
        out.push(el.tagName.toLowerCase() + ":" + el.textContent);
      }
      return { blocks: out, text: document.getElementById("post").textContent };
    }, item);
  }

  function count(hay, needle) {
    return hay.split(needle).length - 1;
  }

  test("words typed at the start of a split tail make the whole tail one new block", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", HEAD.length);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Fresh words first. ", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: "Fresh words first. " + TAIL }]);
    expect(item.anchor_after_html, "the anchor gives up the moved words").toBe(HEAD);
    const placed = await placeAndRebuild(page, item);
    expect(placed.blocks, "one paragraph after placement and rebuild").toEqual(["p:Fresh words first. " + TAIL]);
    expect(count(placed.text, TAIL), "the moved words show once").toBe(1);
  });

  test("words typed at the end of a split tail make the whole tail one new block", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", HEAD.length);
    await page.keyboard.press("Enter");
    await fw.caretToEndOfSession(page);
    await page.keyboard.type(" And then <b>some</b> more.", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: TAIL + " And then &lt;b&gt;some&lt;/b&gt; more." }]);
    const placed = await placeAndRebuild(page, item);
    expect(placed.blocks, "one paragraph after placement and rebuild").toEqual(["p:" + TAIL + " And then <b>some</b> more."]);
    expect(count(placed.text, TAIL), "the moved words show once").toBe(1);
  });

  test("words typed into the middle of the moved words make the whole tail new, never moved", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", HEAD.length);
    await page.keyboard.press("Enter");
    await fw.caretAt(page, "#p1 + p", "This one".length);
    await page.keyboard.type(" really", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: "This one really did not." }]);
    expect(item.anchor_after_html, "the anchor gives up the moved words, so nothing is added twice").toBe(HEAD);
    const placed = await placeAndRebuild(page, item);
    expect(placed.blocks).toEqual(["p:This one really did not."]);
  });

  test("a tail made of words the reviewer typed into the anchor before splitting is new", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.type(" Typed here first.", { delay: 2 });
    await fw.caretAt(page, "#p1", (HEAD + " " + TAIL + " ").length);
    await page.keyboard.press("Enter");
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: "Typed here first." }]);
  });

  test("a split with no typing keeps one from_anchor tail", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1", HEAD.length);
    await page.keyboard.press("Enter");
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: TAIL, from_anchor: true }]);
  });
});

// Flow walk fail 2, capture side: adding an item to a list the agent had
// already placed reopened the placed run record. Architecture "Two sittings in
// the same place": once the agent placed a run, its blocks are the page's own,
// so a sitting there is an ordinary edit of that block. Only an unplaced run
// reopens its record.
test.describe("a sitting on a placed block is an ordinary edit", () => {
  const LIST = "- first item";

  async function commitRunWithList(page) {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.press("Enter");
    await page.keyboard.type(LIST, { delay: 2 });
    await page.keyboard.press("Enter");
    await page.keyboard.type("second item", { delay: 2 });
    await fw.commitByEsc(page);
    return fw.onlyEdit(page);
  }

  async function setState(page, id, patch) {
    await page.evaluate(
      ([itemId, fields]) => {
        const h = window.__lahe.handle;
        h.store.write(h.review, Object.assign({}, h.store.readItem(h.review, itemId), fields));
      },
      [id, patch]
    );
  }

  async function addThirdItem(page) {
    await fw.openEdit(page, "#p1 + ul li:last-child");
    await page.keyboard.press("Enter");
    await page.keyboard.type("third item", { delay: 2 });
    await fw.commitByEsc(page);
  }

  test("a handled run: the list edit is a new record whose before is the placed list", async ({ page }) => {
    const run = await commitRunWithList(page);
    await setState(page, run.id, { state: "handled" });
    await addThirdItem(page);
    const all = await fw.items(page);
    const same = all.find((it) => it.id === run.id);
    expect(same.rev, "the placed record is not reopened").toBe(run.rev);
    expect(same.state).toBe("handled");
    const fresh = all.filter((it) => it.id !== run.id);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].before.replace(/\s+/g, " ").trim()).toBe("first item second item");
    expect(fresh[0].state).toBe("ready");
  });

  test("a run the agent placed and then asked a proofreading question on: same, a new record", async ({ page }) => {
    const run = await commitRunWithList(page);
    await setState(page, run.id, {
      reply: {
        status: "question",
        agent: "claude",
        text: "Two fixes?",
        at: new Date().toISOString(),
        proofread: true,
        suggestions: [{ block: 0, from: "first", to: "First" }]
      }
    });
    await addThirdItem(page);
    const all = await fw.items(page);
    const same = all.find((it) => it.id === run.id);
    expect(same.rev, "the placed record is not reopened").toBe(run.rev);
    expect(same.state).toBe("ready");
    const fresh = all.filter((it) => it.id !== run.id);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].before.replace(/\s+/g, " ").trim()).toBe("first item second item");
  });

  test("an unplaced run still reopens its own record", async ({ page }) => {
    const run = await commitRunWithList(page);
    await addThirdItem(page);
    const edits = (await fw.items(page)).filter((it) => it.kind === "edit");
    expect(edits).toHaveLength(1);
    expect(edits[0].id).toBe(run.id);
    expect(edits[0].rev).toBe(run.rev + 1);
  });
});

// Flow walk design problem 1: the bar sat over the text just above what the
// writer was writing (the anchor's last line, a heading, the byline).
test.describe("the edit bar never covers the text above the frame", () => {
  // Every text line of these blocks, as rects.
  function lineRects(page, selectors) {
    return page.evaluate((sels) => {
      const out = [];
      sels.forEach((sel) => {
        const el = document.querySelector(sel);
        const r = document.createRange();
        r.selectNodeContents(el);
        Array.from(r.getClientRects()).forEach((b) => {
          if (b.width && b.height) out.push({ sel, top: b.top, bottom: b.bottom, left: b.left, right: b.right });
        });
      });
      return out;
    }, selectors);
  }

  function overlaps(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }

  async function writeAfterP2(page) {
    await fw.openEdit(page, "#p2");
    await page.keyboard.press("Enter");
    await page.keyboard.type("A new paragraph written after the list intro.", { delay: 2 });
    await pollPage(page, () => {
      const b = window.__lahe.handle.editing.barInfo();
      return !!b && b.rect.height > 0;
    }, undefined, { message: "the bar to lay out" });
    // Two frames, so the frame watcher has placed the bar for this layout.
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    return page.evaluate(() => ({
      bar: window.__lahe.handle.editing.barInfo().rect,
      frame: window.__lahe.handle.editing.frameRect()
    }));
  }

  for (const scheme of ["light", "dark"]) {
    test("on a dense page with no gap, the bar goes below the frame (" + scheme + ")", async ({ page }) => {
      await fw.openFixture(page, server, "blog.html");
      await addStyle(page, DENSE_CSS + (scheme === "dark" ? DARK_CSS : ""));
      // The layer samples the page's background at boot; this page turned dark after it.
      if (scheme === "dark") await page.evaluate(() => window.__lahe.rail.refreshScheme());
      const got = await writeAfterP2(page);
      const bar = { top: got.bar.y, bottom: got.bar.y + got.bar.height, left: got.bar.x, right: got.bar.x + got.bar.width };
      expect(bar.top, "below the frame").toBeGreaterThanOrEqual(got.frame.y + got.frame.height);
      const above = await lineRects(page, ["#title", "#p1", "#h2", "#p2"]);
      above.forEach((line) => expect(overlaps(bar, line), "the bar covers a line of " + line.sel).toBe(false));
      await shot(page, "item4-bar-dense-" + scheme);
    });
  }

  test("with a real gap above the frame, the bar sits in it and covers nothing", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await addStyle(page, "#p2 { margin-bottom: 80px !important; }");
    const got = await writeAfterP2(page);
    const bar = { top: got.bar.y, bottom: got.bar.y + got.bar.height, left: got.bar.x, right: got.bar.x + got.bar.width };
    expect(bar.bottom, "above the frame").toBeLessThanOrEqual(got.frame.y);
    const above = await lineRects(page, ["#title", "#p1", "#h2", "#p2"]);
    above.forEach((line) => expect(overlaps(bar, line), "the bar covers a line of " + line.sel).toBe(false));
    await shot(page, "item4-bar-gap-light");
  });
});

// Flow walk design problem 7: "+ Write here" was a few pixels tall, the first
// clicks missed, and a miss closed the session with the typing going nowhere.
test.describe("+ Write here: a comfortable target, and a near miss still writes", () => {
  // The middle of the page's own gap between #p1 and #h2.
  function gapPoint(page, xFrom) {
    return page.evaluate((from) => {
      const a = document.getElementById("p1").getBoundingClientRect();
      const b = document.getElementById("h2").getBoundingClientRect();
      // Toward the right of the column: when the bar sits below the frame it
      // takes the gap's left part, and the line starts past it.
      const x = from === "left" ? a.left + 60 : a.right - 40;
      return { x: x, y: (a.bottom + b.top) / 2, gap: b.top - a.bottom };
    }, xFrom);
  }

  async function lineShown(page) {
    await pollPage(page, () => {
      const info = window.__lahe.handle.editing.lineInfo();
      return !!info && info.opacity === "1";
    }, undefined, { message: "+ Write here to show, past its fade" });
    return page.evaluate(() => window.__lahe.handle.editing.lineInfo());
  }

  test("the line is at least 24px tall and stays while the pointer is on it", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    const at = await gapPoint(page);
    await page.mouse.move(at.x, at.y);
    const line = await lineShown(page);
    expect(line.rect.height).toBeGreaterThanOrEqual(24);
    const bar = await page.evaluate(() => window.__lahe.handle.editing.barInfo().rect);
    const overlapsBar =
      line.rect.x < bar.x + bar.width && bar.x < line.rect.x + line.rect.width &&
      line.rect.y < bar.y + bar.height && bar.y < line.rect.y + line.rect.height;
    expect(overlapsBar, "the line and its label are never under the bar").toBe(false);
    // To the line's lower edge, past the gap's own middle: it does not vanish.
    await page.mouse.move(at.x, line.rect.y + line.rect.height - 2);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    expect(await page.evaluate(() => !!window.__lahe.handle.editing.lineInfo())).toBe(true);
    await shot(page, "item5-write-here-light");
  });

  test("the line in dark mode", async ({ page }) => {
    await fw.openFixture(page, server, "dark.html");
    await fw.openEdit(page, "main > p");
    const at = await page.evaluate(() => {
      const a = document.querySelector("main > p").getBoundingClientRect();
      const b = document.querySelector("main > h2").getBoundingClientRect();
      return { x: a.right - 40, y: (a.bottom + b.top) / 2 };
    });
    await page.mouse.move(at.x, at.y);
    const line = await lineShown(page);
    expect(line.rect.height).toBeGreaterThanOrEqual(24);
    await shot(page, "item5-write-here-dark");
  });

  test("a press in the gap where the line is not drawn starts writing there instead of ending the session", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.type(" Kept words.", { delay: 2 });
    const at = await gapPoint(page);
    expect(at.gap).toBeGreaterThan(4);
    // A press with no hover first: the line was never drawn, so this is the
    // near miss the flow walk hit.
    await page.evaluate(({ x, y }) => {
      const target = document.elementFromPoint(x, y);
      const opts = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0 };
      target.dispatchEvent(new PointerEvent("pointerdown", opts));
      target.dispatchEvent(new MouseEvent("mousedown", opts));
      target.dispatchEvent(new PointerEvent("pointerup", opts));
      target.dispatchEvent(new MouseEvent("mouseup", opts));
      target.dispatchEvent(new MouseEvent("click", opts));
    }, at);
    expect(await page.evaluate(() => window.__lahe.isEditing())).toBe(true);
    const els = await page.evaluate(() =>
      window.__lahe.handle.editing.sessionElements().map((el) => el.tagName.toLowerCase() + ":" + el.textContent)
    );
    expect(els[0]).toBe("p:Most weeks look busy from the outside. This one did not. Kept words.");
    expect(els[1], "an empty paragraph after the block above the gap, caret in it").toMatch(/^p:\s*$/);
    await page.keyboard.type("Typed after the miss.", { delay: 2 });
    await fw.commitByEsc(page);
    const item = await fw.onlyEdit(page);
    expect(item.new_blocks).toEqual([{ tag: "p", html: "Typed after the miss." }]);
    expect(item.anchor_after_html).toBe("Most weeks look busy from the outside. This one did not. Kept words.");
  });

  test("a real mouse click on the line still opens writing after the block above", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p2");
    const at = await gapPoint(page, "left");
    await page.mouse.move(at.x, at.y);
    const line = await lineShown(page);
    await page.mouse.click(line.rect.cx, line.rect.cy);
    const els = await page.evaluate(() => window.__lahe.handle.editing.sessionElements().map((el) => el.tagName.toLowerCase()));
    expect(els).toEqual(["p", "p"]);
    expect(await page.evaluate(() => window.__lahe.handle.editing.sessionElements()[0].id)).toBe("p1");
  });

  test("a click that really lands outside still commits", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html");
    await fw.openEdit(page, "#p1");
    await page.keyboard.type(" More.", { delay: 2 });
    const title = await page.evaluate(() => {
      const r = document.getElementById("title").getBoundingClientRect();
      return { x: r.left + 20, y: r.top + r.height / 2 };
    });
    await page.mouse.click(title.x, title.y);
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the click outside to commit" });
    const item = await fw.onlyEdit(page);
    expect(item.state).toBe("ready");
    // And a press in the page's margin, outside the column, commits too.
    await fw.openEdit(page, "#p2");
    await page.mouse.click(4, title.y + 200);
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the margin click to commit" });
  });
});

// Flow walk design problem 8: after a click on the rail, Cmd-Shift-E and the
// typing after it went nowhere until the writer clicked the page.
test.describe("Cmd-Shift-E right after clicking the rail", () => {
  async function clickRailTab(page, name) {
    const rect = await page.evaluate((label) => {
      const root = window.__lahe.rail.tabBody("edits").getRootNode();
      const tab = Array.from(root.querySelectorAll('[role="tab"]')).find((t) => t.textContent.indexOf(label) !== -1);
      const r = tab.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, name);
    await page.mouse.click(rect.x, rect.y);
    // WebKit does not focus a button on click, as Safari never does; a
    // keyboard user tabbing into the rail gets there anyway. Focus the tab so
    // every engine starts from the same place: the rail holding focus.
    await page.evaluate((label) => {
      const root = window.__lahe.rail.tabBody("edits").getRootNode();
      const tab = Array.from(root.querySelectorAll('[role="tab"]')).find((t) => t.textContent.indexOf(label) !== -1);
      if (root.activeElement !== tab) tab.focus();
    }, name);
    // The rail holds focus now: the page's active element is the layer's host.
    const onRail = await page.evaluate(() => {
      const a = document.activeElement;
      return !!a && a !== document.body && !document.querySelector("article").contains(a);
    });
    expect(onRail, "the click put focus on the rail").toBe(true);
  }

  test("the chord opens the block the caret was last in, and typing lands there", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html", { collapseRail: false });
    await fw.caretAt(page, "#p1", HEAD.length);
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(r)));
    await clickRailTab(page, "Edits");
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "the chord to open #p1" });
    expect(await page.evaluate(() => window.__lahe.handle.editing.sessionElements()[0].id)).toBe("p1");
    await page.keyboard.type(" Typed after the rail.", { delay: 2 });
    expect(await page.evaluate(() => document.getElementById("p1").textContent)).toContain("Typed after the rail.");
    await fw.commitByEsc(page);
  });

  test("with no caret on the page, the chord still enters edit state", async ({ page }) => {
    await fw.openFixture(page, server, "blog.html", { collapseRail: false });
    await page.evaluate(() => window.getSelection().removeAllRanges());
    await clickRailTab(page, "Edits");
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.editState().editState === true || window.__lahe.isEditing() === true, undefined, {
      message: "the chord to enter edit state"
    });
  });
});

// Flow walk design problem 6: Cmd-Shift-E on a paragraph, nothing typed, drew
// a Draft card with the whole block struck through and moved the Edits count.
test.describe("opening a block without changing it shows no card", () => {
  for (const scheme of ["light", "dark"]) {
    test("no card and no count until the first change, and the draft is still stored (" + scheme + ")", async ({ page }) => {
      await fw.openFixture(page, server, scheme === "dark" ? "dark.html" : "blog.html", { collapseRail: false });
      await page.evaluate(() => window.__lahe.rail.selectTab("edits"));
      const target = scheme === "dark" ? "main > p" : "#p1";
      await fw.openEdit(page, target);
      const opened = await page.evaluate(() => {
        const h = window.__lahe.handle;
        return {
          cards: window.__lahe.cardIds().length,
          edits: window.__lahe.rail.tabNewCount ? window.__lahe.rail.tabNewCount("edits") : null,
          stored: h.store.read(h.review).filter((it) => it.kind === "edit" && it.state === "draft").length
        };
      });
      expect(opened.cards, "no card for an untouched block").toBe(0);
      expect(opened.stored, "the draft is still in browser storage").toBe(1);
      await shot(page, "item7-opened-no-card-" + scheme);
      await page.keyboard.type(" x", { delay: 2 });
      await pollPage(page, () => window.__lahe.cardIds().length === 1, undefined, { message: "the first change to draw the card" });
      await fw.commitByEsc(page);
    });
  }
});

// Flow walk design problem 5: "## " made a Subheading (h3), one level off
// from what "##" means in the Markdown source.
test.describe("Markdown heading shortcuts match Markdown", () => {
  for (const [typed, tag] of [["# ", "h2"], ["## ", "h2"], ["### ", "h3"], ["#### ", "h4"]]) {
    test(JSON.stringify(typed) + " makes " + tag, async ({ page }) => {
      await fw.openFixture(page, server, "blog.html");
      await fw.openEdit(page, "#p1");
      await page.keyboard.press("Enter");
      await page.keyboard.type(typed + "Words", { delay: 2 });
      const got = await page.evaluate(() =>
        window.__lahe.handle.editing.sessionElements().map((el) => el.tagName.toLowerCase() + ":" + el.textContent)
      );
      expect(got[1]).toBe(tag + ":Words");
      await fw.commitByEsc(page);
      const item = await fw.onlyEdit(page);
      expect(item.new_blocks).toEqual([{ tag: tag, html: "Words" }]);
    });
  }
});
