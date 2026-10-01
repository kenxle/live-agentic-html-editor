// The Document style panel: trying a style on the real page.
//
// docs/features/20260930.01_style_switcher, plan Step 2, Test List rows V8 to
// V12, V14 to V16, V18, V19, V22 (the layer half), V25 (the layer half), V26
// and V27. The keep flow through a Markdown rebuild (V23) is
// style_switcher_keep.spec.js.
//
// Every page here is served by a real `lahe review` (lahe_world.js), with its
// own state folder and helper port. Styles reach it through
// support/style_fixtures.js: by `lahe style add` once the service half is
// merged, and as files beside the page before that.
//
// Screenshots: set LAHE_SCREENSHOT_DIR to a folder and the V19 states are
// written there, light on `sample` and dark on `sample-dark`.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { test, expect, pollPage, pollUntil } = require("../helpers");
const { withLayer } = require("./support/with_layer");
const { startStaticServer } = require("../helpers/servers");
const world$ = require("./support/lahe_world");
const styles = require("./support/style_fixtures");

const SHOT_DIR = process.env.LAHE_SCREENSHOT_DIR || null;
const FIXTURES = path.join(__dirname, "..", "fixtures");
const DOC = fs.readFileSync(path.join(FIXTURES, "style-switch-doc.html"), "utf8");
const OWN_CSS = fs.readFileSync(path.join(FIXTURES, "style-switch-own-css.html"), "utf8");

test.describe.configure({ mode: "serial" });

// --- driving the rail through its own geometry --------------------------------

function center(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

async function panel(page) {
  return page.evaluate(() => window.__lahe.stylePanel());
}

async function styleInfo(page) {
  return page.evaluate(() => window.__lahe.style());
}

async function menuItems(page) {
  return page.evaluate(() => {
    const rail = window.__lahe.rail;
    const wasOpen = rail.menuIsOpen();
    if (!wasOpen) rail.openMenu(0);
    const items = rail.menuInfo().items.map((i) => ({ action: i.action, label: i.label }));
    if (!wasOpen) rail.closeMenu(false);
    return items;
  });
}

/** Menu, then Document style, with real clicks. Waits for the list to answer. */
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
  expect(item, "the menu offers Document style").toBeTruthy();
  await page.mouse.click(center(item.rect).x, center(item.rect).y);
  await pollPage(page, () => window.__lahe.stylePanel().mode === "open", undefined, { message: "the panel to open" });
  await pollPage(page, () => window.__lahe.handle.styleList().loaded === true, undefined, {
    message: "the style list to answer"
  });
  return panel(page);
}

async function clickRow(page, id) {
  const info = await panel(page);
  const row = info.rows.find((r) => r.id === id);
  expect(row, "the panel lists " + id).toBeTruthy();
  await page.mouse.click(center(row.nameRect).x, center(row.nameRect).y);
}

async function clickControl(page, which) {
  const info = await panel(page);
  const control = info[which];
  expect(control && control.rect, "the panel shows its " + which + " control").toBeTruthy();
  await page.mouse.click(center(control.rect).x, center(control.rect).y);
}

/** The page has settled into this style: the switch says so and the paint follows. */
async function showing(page, id) {
  await pollPage(
    page,
    (want) => {
      const s = window.__lahe.style();
      return s.settled && s.shown === want && (want === s.documentId ? !s.previewing : s.previewing);
    },
    id,
    { message: "the page to show " + id }
  );
}

function looks(page) {
  return page.evaluate(() => {
    const body = getComputedStyle(document.body);
    return { background: body.backgroundColor, color: body.color, font: body.fontFamily };
  });
}

async function openWorld(page, spec) {
  const world = await world$.makeWorld({ file: spec.file || "doc.html", text: spec.text || DOC });
  const installed = styles.installStyles(world, spec.styles || []);
  await page.setViewportSize({ width: 1180, height: 860 });
  await page.goto(world.open);
  await world$.settled(page);
  await world$.claim(page);
  return Object.assign(world, { installed });
}

async function shoot(page, name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name + ".png"), animations: "disabled" });
}

// --- V8: only where it works ---------------------------------------------------

test.describe("the control appears only where it works (V8, R1)", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("a house-style HTML page offers Document style, just before Hide for presenting", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample"] });
    const items = await menuItems(page);
    const actions = items.map((i) => i.action);
    expect(actions).toContain("document-style");
    expect(actions.indexOf("document-style")).toBe(actions.indexOf("present") - 1);
    expect(items.find((i) => i.action === "document-style").label).toBe("Document style");
    expect((await panel(page)).mode).toBe("closed");
  });

  test("a page with its own CSS has no style control at all", async ({ page }) => {
    world = await openWorld(page, { text: OWN_CSS, styles: ["sample"] });
    const actions = (await menuItems(page)).map((i) => i.action);
    expect(actions).not.toContain("document-style");
    const info = await panel(page);
    expect(info.available).toBe(false);
    expect(info.mode).toBe("closed");
    expect((await styleInfo(page)).usesHouseStyle).toBe(false);
  });
});

// --- V9 and V12: the list, and an honest rail ---------------------------------

test.describe("the list, and a rail that says what the page shows (V9, V12, R2, R5, R11)", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("International Style first, then each installed style with its strip; the document's own row marked", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    const info = await openPanel(page);
    expect(info.rows.map((r) => r.id)).toEqual(["international", "sample", "sample-dark"]);
    expect(info.rows[0].name).toBe("International Style");
    expect(info.rows[0].inDocument).toBe(true);
    expect(info.rows[0].checked).toBe(true);
    expect(info.rows[0].palette.length).toBe(6);
    expect(info.rows[1].palette.length).toBeGreaterThan(0);
    expect(info.rows.filter((r) => r.inDocument).map((r) => r.id)).toEqual(["international"]);
    expect(info.status).toBe("The document uses International Style.");
    expect(info.notes).toEqual([]);
    expect(info.ask.shown).toBe(false);
    expect(info.back.shown).toBe(false);
    // Opening the panel puts focus on the checked radio (V18).
    expect(info.focusedId).toBe("international");
  });

  test("nothing installed: International Style alone, and the line naming the command", async ({ page }) => {
    world = await openWorld(page, { styles: [] });
    const info = await openPanel(page);
    expect(info.rows.map((r) => r.id)).toEqual(["international"]);
    expect(info.notes).toEqual(["Add styles with lahe style add <folder>, or ask your agent to."]);
    await shoot(page, "nothing_installed_light");
  });

  test("previewing: the words, Back, the collapsed line, and the overdue banner above it", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    await openPanel(page);
    await clickRow(page, "sample");
    await showing(page, "sample");
    let info = await panel(page);
    const name = info.rows.find((r) => r.id === "sample").name;
    expect(info.status).toBe("Previewing " + name + ". The document uses International Style.");
    expect(info.statusLive).toBe("polite");
    expect(info.ask.label).toBe("Ask the agent to use " + name);
    expect(info.back.label).toBe("Back to the document's style");
    await shoot(page, "panel_open_previewing_light");

    // Closed while previewing: the panel collapses to its status line and Back.
    await clickControl(page, "close");
    await pollPage(page, () => window.__lahe.stylePanel().mode === "collapsed", undefined, {
      message: "the panel to collapse to its status line"
    });
    info = await panel(page);
    expect(info.status).toBe("Previewing " + name);
    expect(info.back.shown).toBe(true);
    expect(info.ask.shown).toBe(false);
    expect(info.menuButtonFocused, "Close returns focus to the menu button (V18)").toBe(true);
    await shoot(page, "collapsed_line_light");

    // The overdue banner, when it shows, stays above the status line. The
    // agent's liveness is set the way rail_agent_liveness.spec.js sets it, and
    // both are measured in the same turn so the next poll cannot race it.
    const stacked = await page.evaluate((at) => {
      window.__lahe.rail.setAgentLiveness({
        state: "waiting",
        unanswered: 1,
        oldest_unanswered_at: at,
        last_reply_at: null,
        listening: false
      });
      return { banner: window.__lahe.rail.waitBannerInfo(), panel: window.__lahe.stylePanel() };
    }, new Date(Date.now() - 25 * 60 * 1000).toISOString());
    expect(stacked.banner.visible, "the overdue banner is up").toBe(true);
    expect(stacked.panel.lateRect, "the banner has a place on screen").toBeTruthy();
    expect(stacked.panel.lateRect.bottom).toBeLessThanOrEqual(stacked.panel.rect.y);
    await shoot(page, "overdue_banner_with_status_light");

    // Back clears the preview and the key.
    await clickControl(page, "back");
    await showing(page, "international");
    const after = await styleInfo(page);
    expect(after.stored).toBe(null);
    expect(after.previewLinks).toBe(0);
    expect((await panel(page)).mode).toBe("closed");
  });
});

// --- V10, V11, V18, V27: one click, a reload, the keyboard, the scheme ---------

async function openCommentBox(page, selector, text) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, { message: "the comment box to open" });
  await page.keyboard.type(text);
  return page.evaluate(() => window.__lahe.handle.comments.focusedBox().id);
}

/** An open box, the passage it is about, and its words. */
function boxAndPassage(page, id) {
  return page.evaluate((boxId) => {
    const handle = window.__lahe.handle.comments.boxFor(boxId);
    const range = window.__lahe.handle.comments.highlights.rangeFor(boxId);
    const r = range.getBoundingClientRect();
    const passage = range.commonAncestorContainer;
    return {
      open: !!handle,
      text: handle ? handle.input.value : null,
      size: handle ? handle.size() : null,
      passage: { top: r.top, bottom: r.bottom },
      highlighted: String(range).replace(/\s+/g, " ").trim(),
      paragraph: (passage.nodeType === 1 ? passage : passage.parentElement).textContent.replace(/\s+/g, " ").trim()
    };
  }, id);
}

/** Where a block sits from the top of the window. */
function topOf(page, selector) {
  return page.evaluate((sel) => document.querySelector(sel).getBoundingClientRect().top, selector);
}

/**
 * The block the reader is at: the first of the page's blocks (sync.js's own
 * list) that shows in the window, partly visible counting. Returned as a
 * selector so its place can be read again after the switch.
 */
function readingBlock(page) {
  return page.evaluate(() => {
    const blocks = window.LAHE.sync.blockCandidates(document);
    for (const b of blocks) {
      const r = b.el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= window.innerHeight) continue;
      if (!b.el.id) throw new Error("the reading block has no id: " + b.el.outerHTML.slice(0, 80));
      return "#" + b.el.id;
    }
    return null;
  });
}

test.describe("one click restyles the page and leaves the reviewer's work alone (V10, V11, V18, V27, R3, R4)", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("one click: colours and font change, no navigation, the box, the highlight and the reading position hold", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    const nav = world$.navCounter(page);
    const before = await looks(page);

    // The reader is part way down the page.
    await page.evaluate(() => document.querySelector("#s2p5").scrollIntoView({ block: "start", behavior: "instant" }));
    await page.evaluate(() => window.scrollBy({ top: -40, behavior: "instant" }));
    // A comment box open on a passage, with words typed in it.
    const boxId = await openCommentBox(page, "#s2p6", "Say how long a layoff this is for.");
    const reading = await readingBlock(page);
    const blockTop = await topOf(page, reading);
    const boxBefore = await boxAndPassage(page, boxId);
    expect(boxBefore.size.dragged).toBe(false);

    await openPanel(page);
    await clickRow(page, "sample");
    await showing(page, "sample");

    const after = await looks(page);
    expect(after.background, "the page's ground changed").not.toBe(before.background);
    expect(after.font, "the page's face changed").not.toBe(before.font);
    expect(nav.count, "no navigation, no reload").toBe(0);
    nav.stop();

    // The block at the top of the window stayed there.
    expect(Math.abs((await topOf(page, reading)) - blockTop)).toBeLessThanOrEqual(2);

    // The box is still open, still holds its words, and sits beside its passage
    // the way it did before: the passage moved under the new style, and the
    // box moved with it.
    const box = await boxAndPassage(page, boxId);
    expect(box.open).toBe(true);
    expect(box.text).toBe("Say how long a layoff this is for.");
    expect(box.highlighted, "the highlight still covers its passage").toBe(box.paragraph);
    expect(box.passage.top, "the restyle moved the passage").not.toBe(boxBefore.passage.top);
    // The placement rule (comments.js positionAt): in the gutter level with
    // the passage, or just under it.
    const beside = (b) =>
      Math.abs(b.size.top - b.passage.top) <= 2 || Math.abs(b.size.top - (b.passage.bottom + 10)) <= 2;
    expect(beside(boxBefore), "the box opened beside its passage").toBe(true);
    expect(beside(box), "and is beside it again after the switch").toBe(true);
  });

  test("an edit in progress keeps its words and its caret across a switch", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample"] });
    await placeCaretAt(page, "#s1p4", 0);
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.isEditing() === true, undefined, { message: "an edit to open" });
    const length = await page.evaluate(() => document.querySelector("#s1p4").textContent.length);
    await placeCaretAt(page, "#s1p4", length);
    await page.keyboard.type(" Keep it honest.");
    const typed = await page.evaluate(() => document.querySelector("#s1p4").textContent);

    // The switch itself, while the reviewer is still in the block.
    await page.evaluate(() => window.__lahe.handle.styleSwitch.preview("sample"));
    await showing(page, "sample");

    const still = await page.evaluate(() => {
      const sel = window.getSelection();
      const block = document.querySelector("#s1p4");
      return {
        editing: window.__lahe.isEditing(),
        text: block.textContent,
        caretInBlock: !!sel.anchorNode && block.contains(sel.anchorNode),
        caretAtEnd: sel.anchorOffset === sel.anchorNode.textContent.length
      };
    });
    expect(still.editing).toBe(true);
    expect(still.text).toBe(typed);
    expect(still.caretInBlock).toBe(true);
    expect(still.caretAtEnd).toBe(true);
    await page.keyboard.type(" More.");
    expect(await page.evaluate(() => document.querySelector("#s1p4").textContent)).toBe(typed + " More.");
  });

  test("the keyboard: focus on the checked radio, arrows preview, held arrows end on the last, Esc returns to the menu", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    const info = await openPanel(page);
    expect(info.focusedId).toBe("international");

    // Three presses in a row, faster than a stylesheet loads: only the last
    // pick applies.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await showing(page, "sample-dark");
    let got = await styleInfo(page);
    expect(got.previewLinks, "one preview link, the last pick's").toBe(1);
    expect(got.stored).toBe("sample-dark");
    expect((await panel(page)).focusedId, "the focus moved with the arrow").toBe("sample-dark");
    await shoot(page, "keyboard_focus_dark");

    await page.keyboard.press("ArrowUp");
    await showing(page, "sample");
    expect((await panel(page)).focusedId).toBe("sample");
    await shoot(page, "keyboard_focus_light");

    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.stylePanel().mode === "collapsed", undefined, {
      message: "Esc to close the panel to its line"
    });
    expect((await panel(page)).menuButtonFocused, "Esc returns focus to the menu button").toBe(true);
    got = await styleInfo(page);
    expect(got.shown, "closing the panel keeps the preview").toBe("sample");
  });

  test("the rail follows a dark-ground style to dark, and Back brings it light again (V27)", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    expect((await panel(page)).scheme).toBe("light");
    await openPanel(page);
    await clickRow(page, "sample-dark");
    await showing(page, "sample-dark");
    await pollPage(page, () => window.__lahe.stylePanel().scheme === "dark", undefined, {
      message: "the rail to turn dark over the dark ground"
    });
    await shoot(page, "panel_open_previewing_dark");
    await clickControl(page, "close");
    await pollPage(page, () => window.__lahe.stylePanel().mode === "collapsed", undefined, { message: "collapse" });
    await shoot(page, "collapsed_line_dark");
    await clickControl(page, "back");
    await showing(page, "international");
    await pollPage(page, () => window.__lahe.stylePanel().scheme === "light", undefined, {
      message: "the rail to turn light again on Back"
    });
  });

  test("a preview survives a reload at the same block, and another page of the review is untouched (V11)", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample"] });
    // A second page in the same reviewed folder, served by the same server.
    fs.writeFileSync(path.join(path.dirname(world.source), "second.html"), DOC.replace("Steady Pace", "Second page"));

    await openPanel(page);
    await clickRow(page, "sample");
    await showing(page, "sample");
    await page.evaluate(() => document.querySelector("#s3p2").scrollIntoView({ block: "start", behavior: "instant" }));
    const reading = await readingBlock(page);
    const top = await topOf(page, reading);

    // The reload an agent's rebuild does: the source moves, the page reloads
    // itself and puts the reader back.
    await world$.agentWrites(page, world, world$.readSource(world));
    await showing(page, "sample");
    const back = await styleInfo(page);
    expect(back.stored).toBe("sample");
    expect(back.previewLinks).toBe(1);
    expect((await panel(page)).mode, "the collapsed line says so after the reload").toBe("collapsed");
    expect(Math.abs((await topOf(page, reading)) - top)).toBeLessThanOrEqual(4);

    // The second page of the same review: the house style, no preview.
    await page.goto(world.open.replace(/[^/]+$/, "second.html"));
    await world$.settled(page);
    const other = await styleInfo(page);
    expect(other.previewing).toBe(false);
    expect(other.stored).toBe(null);
    expect(other.previewLinks).toBe(0);
  });
});

async function placeCaretAt(page, selector, offset) {
  await page.evaluate(
    ([sel, at]) => {
      const el = document.querySelector(sel);
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let node = walker.nextNode();
      let last = node;
      let left = at;
      while (node && left > node.textContent.length) {
        left -= node.textContent.length;
        last = node;
        node = walker.nextNode();
      }
      const target = node || last;
      const range = document.createRange();
      range.setStart(target, Math.min(left, target.textContent.length));
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    },
    [selector, offset]
  );
}
