// The Document style panel: trying a style on the real page.
//
// docs/features/20260930.01_style_switcher, plan Step 2, Test List rows V8 to
// V12, V14 to V16, V18, V19, V22 (the layer half), V25 (the layer half), V26
// and V27. The keep flow through a Markdown rebuild (V23) is
// style_switcher_keep.spec.js.
//
// Every page here is served by a real `lahe review` (lahe_world.js), with its
// own state folder and helper port. Styles are installed into that state
// folder with `lahe style add` (support/style_fixtures.js). Only V22 stands in
// a crafted list, with Playwright routing, because no real install can serve one.
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

/** A real click on the Document style button in the rail's head. */
async function clickStyleButton(page) {
  const info = await panel(page);
  expect(info.button && info.button.shown, "the head shows the Document style button").toBe(true);
  await page.mouse.click(center(info.button.rect).x, center(info.button.rect).y);
}

/** The Document style button, with a real click. Waits for the list to answer. */
async function openPanel(page) {
  expect((await panel(page)).mode, "the dropdown starts closed").toBe("closed");
  await clickStyleButton(page);
  await pollPage(page, () => window.__lahe.stylePanel().mode === "open", undefined, { message: "the dropdown to open" });
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
  styles.installStyles(world, spec.styles || []);
  await page.setViewportSize({ width: 1180, height: 860 });
  await page.goto(world.open);
  await world$.settled(page);
  await world$.claim(page);
  return world;
}

async function shoot(page, name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, name + ".png"), animations: "disabled" });
}

// The button's own shots: the top of the rail, cropped so the head and the
// dropdown read at full size. Set LAHE_BUTTON_SCREENSHOT_DIR to write them.
const BUTTON_SHOT_DIR = process.env.LAHE_BUTTON_SCREENSHOT_DIR || null;

async function shootHead(page, name) {
  if (!BUTTON_SHOT_DIR) return;
  fs.mkdirSync(BUTTON_SHOT_DIR, { recursive: true });
  const size = page.viewportSize();
  const width = 440;
  // The pointer off the rail, so no hover tint stands in for a state.
  await page.mouse.move(5, 5);
  await page.screenshot({
    path: path.join(BUTTON_SHOT_DIR, name + ".png"),
    animations: "disabled",
    clip: { x: size.width - width, y: 0, width: width, height: 600 }
  });
}

// --- V8: only where it works ---------------------------------------------------

test.describe("the control appears only where it works (V8, R1)", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("a house-style HTML page shows the Document style button in the head, and the menu no longer lists it", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample"] });
    const info = await panel(page);
    expect(info.button.shown).toBe(true);
    expect(info.button.label).toBe("Document style");
    expect(info.button.expanded).toBe("false");
    expect(info.mode).toBe("closed");
    // In the head's row, just before the menu button.
    const menu = await page.evaluate(() => window.__lahe.rail.menuInfo());
    expect(Math.abs(info.button.rect.y - menu.rect.y), "on the head's row").toBeLessThanOrEqual(1);
    expect(info.button.rect.right, "left of the menu button").toBeLessThanOrEqual(menu.rect.x);
    expect(info.button.rect.width).toBe(menu.rect.width);
    const actions = (await menuItems(page)).map((i) => i.action);
    expect(actions).not.toContain("document-style");
    expect(info.menuItemActions).not.toContain("document-style");
  });

  test("a page with its own CSS has no style control at all", async ({ page }) => {
    world = await openWorld(page, { text: OWN_CSS, styles: ["sample"] });
    const actions = (await menuItems(page)).map((i) => i.action);
    expect(actions).not.toContain("document-style");
    const info = await panel(page);
    expect(info.available).toBe(false);
    expect(info.button.shown, "no button in the head").toBe(false);
    expect(info.mode).toBe("closed");
    expect((await styleInfo(page)).usesHouseStyle).toBe(false);
  });
});

// --- The button in the head (Ken, 2026-10-02: "just a button at the top") -------

test.describe("the Document style button: toggle, Esc, a click elsewhere, and the dot", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("a click opens the dropdown and a second click closes it; aria-expanded follows; the dot marks a preview", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    let info = await panel(page);
    expect(info.button.expanded).toBe("false");
    expect(info.button.controls, "the button names the dropdown it opens").toBeTruthy();
    expect(info.button.indicator, "nothing previewed: no dot").toBe(null);
    expect(info.button.dot.shown).toBe(false);
    expect(info.button.title).toBe("Document style");
    await shootHead(page, "head_light");

    info = await openPanel(page);
    expect(info.button.expanded).toBe("true");
    expect(info.focusedId, "focus goes to the checked radio").toBe("international");
    // The dropdown hangs from the head, below the button, inside the rail.
    expect(info.rect.y).toBeGreaterThanOrEqual(info.button.rect.bottom);
    expect(info.rect.right).toBeLessThanOrEqual(page.viewportSize().width);

    await clickStyleButton(page);
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, { message: "a second click to close it" });
    info = await panel(page);
    expect(info.button.expanded).toBe("false");
    expect(info.buttonFocused, "focus stays on the button").toBe(true);

    // A preview marks the button, open or closed.
    await openPanel(page);
    await clickRow(page, "sample");
    await showing(page, "sample");
    info = await panel(page);
    expect(info.mode, "a pick leaves the dropdown open").toBe("open");
    expect(info.button.indicator).toBe("preview");
    expect(info.button.dot.shown).toBe(true);
    await shootHead(page, "dropdown_previewing_light");

    await clickStyleButton(page);
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, { message: "close" });
    info = await panel(page);
    expect(info.button.dot.shown, "closed, the dot still says the page is previewing").toBe(true);
    expect(info.button.dot.rect, "the dot sits on the button").toBeTruthy();
    expect(info.button.dot.rect.x).toBeGreaterThanOrEqual(info.button.rect.x);
    expect(info.button.dot.rect.right).toBeLessThanOrEqual(info.button.rect.right);
    expect(info.button.title).toMatch(/^Document style: Previewing /);
    await shootHead(page, "closed_previewing_light");
  });

  test("Esc closes it and puts a visible focus ring on the button", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample"] });
    await openPanel(page);
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, { message: "Esc to close it" });
    const info = await panel(page);
    expect(info.button.expanded).toBe("false");
    expect(info.buttonFocused).toBe(true);
    expect(info.button.outline.style).toBe("solid");
    expect(info.button.outline.width).toBe("2px");
    await shootHead(page, "focus_ring_light");
  });

  test("a click on the page, or elsewhere in the rail, closes it; a click inside it does not; the menu and it take turns", async ({
    page
  }) => {
    world = await openWorld(page, { styles: ["sample"] });

    // Inside: a row is a pick, and the dropdown stays.
    await openPanel(page);
    await clickRow(page, "sample");
    await showing(page, "sample");
    expect((await panel(page)).mode).toBe("open");

    // On the page.
    const para = await page.evaluate(() => {
      const r = document.querySelector("#s1p2").getBoundingClientRect();
      return { x: r.x + 20, y: r.y + r.height / 2 };
    });
    await page.mouse.click(para.x, para.y);
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, { message: "a page click to close it" });
    let info = await panel(page);
    expect(info.button.expanded).toBe("false");
    expect((await styleInfo(page)).shown, "closing keeps the preview").toBe("sample");

    // Elsewhere in the rail: the head, left of the button.
    await openPanel(page);
    info = await panel(page);
    await page.mouse.click(info.button.rect.x - 150, center(info.button.rect).y);
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, { message: "a rail click to close it" });

    // The menu opening closes the dropdown, and the button closes the menu.
    await openPanel(page);
    const menu = await page.evaluate(() => window.__lahe.rail.menuInfo());
    await page.mouse.click(center(menu.rect).x, center(menu.rect).y);
    await pollPage(page, () => window.__lahe.rail.menuIsOpen() === true, undefined, { message: "the menu to open" });
    expect((await panel(page)).mode, "one thing hangs from the head at a time").toBe("closed");
    await openPanel(page);
    expect(await page.evaluate(() => window.__lahe.rail.menuIsOpen())).toBe(false);
  });

  test("dark: the head, the dropdown while previewing, and the closed button's dot", async ({ page }) => {
    // A document that keeps a dark-ground style: the rail is dark and nothing
    // is previewed.
    const darkDoc = DOC.replace(
      '<link rel="stylesheet" href="./.lahe-doc-style.css">',
      '<link rel="stylesheet" href="./.lahe-doc-style.css">\n  <link rel="stylesheet" href="./.lahe-styles/sample-dark/style.css">'
    );
    world = await openWorld(page, { text: darkDoc, styles: ["sample", "sample-dark"] });
    await pollPage(page, () => window.__lahe.stylePanel().scheme === "dark", undefined, { message: "a dark rail" });
    let info = await panel(page);
    expect(info.button.indicator).toBe(null);
    await shootHead(page, "head_dark");
    world$.closeWorld(world);

    // A house page previewing the dark style.
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    await openPanel(page);
    await clickRow(page, "sample-dark");
    await showing(page, "sample-dark");
    await pollPage(page, () => window.__lahe.stylePanel().scheme === "dark", undefined, { message: "the rail to turn dark" });
    await shootHead(page, "dropdown_previewing_dark");
    await clickStyleButton(page);
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, { message: "close" });
    info = await panel(page);
    expect(info.button.dot.shown).toBe(true);
    await shootHead(page, "closed_previewing_dark");
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

  test("previewing: the words, Back, the button's dot, and the overdue banner below the head", async ({ page }) => {
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

    // Closed while previewing: the dropdown goes, and the button's dot and
    // hover line say the page is not in its own style.
    await clickControl(page, "close");
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, {
      message: "the dropdown to close"
    });
    info = await panel(page);
    expect(info.button.indicator).toBe("preview");
    expect(info.button.dot.shown).toBe(true);
    expect(info.button.title).toBe("Document style: Previewing " + name);
    expect(info.button.label, "the accessible name stays the button's name").toBe("Document style");
    expect(info.buttonFocused, "Close returns focus to the style button (V18)").toBe(true);

    // The overdue banner, when it shows, sits under the head, so the button
    // and its dot stay above it. The agent's liveness is set the way
    // rail_agent_liveness.spec.js sets it, and both are measured in the same
    // turn so the next poll cannot race it.
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
    expect(stacked.panel.button.rect.bottom).toBeLessThanOrEqual(stacked.panel.lateRect.y);
    expect(stacked.panel.button.dot.shown).toBe(true);
    await shoot(page, "overdue_banner_with_status_light");

    // Back clears the preview and the key, and the dot goes with it.
    await openPanel(page);
    await clickControl(page, "back");
    await showing(page, "international");
    const after = await styleInfo(page);
    expect(after.stored).toBe(null);
    expect(after.previewLinks).toBe(0);
    info = await panel(page);
    expect(info.mode, "Back keeps the dropdown open for another pick").toBe("open");
    expect(info.button.indicator).toBe(null);
    expect(info.button.dot.shown).toBe(false);
    expect(info.button.title).toBe("Document style");
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
    // And the face itself loaded from the style's folder, the way V24 checks a saved file.
    // check() alone is true for a family nobody declared, so the face has to
    // be in the document's font set and loaded as well.
    const face = await page.evaluate(() => {
      const faces = Array.from(document.fonts).filter((f) => f.family.replace(/"/g, "") === "Sample Face");
      return {
        declared: faces.length,
        loaded: faces.some((f) => f.status === "loaded"),
        usable: document.fonts.check('16px "Sample Face"')
      };
    });
    expect(face.declared, "the style declares its face").toBeGreaterThan(0);
    expect(face.loaded, "the face loaded from the style's folder").toBe(true);
    expect(face.usable).toBe(true);
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

  test("the keyboard: focus on the checked radio, arrows preview, held arrows end on the last, Esc returns to the button", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    const info = await openPanel(page);
    expect(info.focusedId).toBe("international");

    // Two presses in a row, faster than a stylesheet loads: only the last
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
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, {
      message: "Esc to close the dropdown"
    });
    const closed = await panel(page);
    expect(closed.buttonFocused, "Esc returns focus to the style button").toBe(true);
    expect(closed.button.expanded).toBe("false");
    expect(closed.button.outline.style, "a keyboard focus shows the ring").toBe("solid");
    expect(closed.button.outline.width).toBe("2px");
    got = await styleInfo(page);
    expect(got.shown, "closing the dropdown keeps the preview").toBe("sample");
    // Enter on the focused button opens it again, focus on the checked radio.
    await page.keyboard.press("Enter");
    await pollPage(page, () => window.__lahe.stylePanel().mode === "open", undefined, { message: "Enter to open it" });
    expect((await panel(page)).focusedId).toBe("sample");
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
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, { message: "close" });
    expect((await panel(page)).button.dot.shown, "the dot shows on the dark rail too").toBe(true);
    await openPanel(page);
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
    const reloaded = await panel(page);
    expect(reloaded.mode, "a reload closes the dropdown").toBe("closed");
    expect(reloaded.button.indicator, "and the button's dot says so after the reload").toBe("preview");
    expect(Math.abs((await topOf(page, reading)) - top)).toBeLessThanOrEqual(1);

    // The second page of the same review: the house style, no preview.
    await page.goto(world.open.replace(/[^/]+$/, "second.html"));
    await world$.settled(page);
    const other = await styleInfo(page);
    expect(other.previewing).toBe(false);
    expect(other.stored).toBe(null);
    expect(other.previewLinks).toBe(0);
  });
});

// --- V13 and V14: keeping a style ----------------------------------------------

function itemEvents(world) {
  const file = path.join(world.reviewDir, "events.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line))
    .filter((e) => typeof e.event === "string" && e.event.indexOf("item.") === 0);
}

test.describe("keeping a style is one deliberate request (V13, V14, R6, R8)", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("flipping sends nothing; Ask sends one ready note; waiting; a second press sends nothing; a reply ends it; the agent's line keeps it", async ({
    page
  }) => {
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    await openPanel(page);
    for (const id of ["sample", "sample-dark", "sample"]) {
      await clickRow(page, id);
      await showing(page, id);
    }
    await page.evaluate(() => window.__lahe.handle.sync.flush({ force: true }));
    expect(await page.evaluate(() => window.__lahe.items().length), "flipping makes no item").toBe(0);
    expect(itemEvents(world), "and posts no event").toEqual([]);

    const name = (await panel(page)).rows.find((r) => r.id === "sample").name;
    await clickControl(page, "ask");
    const items = await pollUntil(
      async () => {
        const got = await page.evaluate(() => window.__lahe.items());
        return got.length ? got : null;
      },
      { message: "the request to be stored" }
    );
    expect(items.length).toBe(1);
    const asked = items[0];
    expect(asked.kind).toBe("note");
    expect(asked.state).toBe("ready");
    expect(asked.note).toBe("Use the " + name + " style for this page (lahe-style: sample).");
    // An ordinary item on the Active tab.
    expect(await page.evaluate(() => window.__lahe.cardIds())).toContain(asked.id);
    expect(await page.evaluate((it) => window.LAHE.overlay.paneForItem(it), asked)).toBe("active");
    // The helper has it, marker and all, where an agent reads.
    const stored = await world$.helperHas(world, asked.id, asked.rev);
    expect(stored.note).toContain("lahe-style: sample");

    // Waiting, and the button is gone.
    await pollPage(page, () => window.__lahe.stylePanel().status.indexOf("Sent to the agent.") === 0, undefined, {
      message: "the waiting line"
    });
    let info = await panel(page);
    expect(info.status).toBe("Sent to the agent. Waiting for it to add " + name + " to this page.");
    expect(info.ask.shown).toBe(false);
    await shoot(page, "waiting_light");

    // A second press while one is waiting makes nothing.
    await page.evaluate(() => window.__lahe.rail.clickStyleAsk());
    expect((await page.evaluate(() => window.__lahe.items())).length).toBe(1);

    // Any reply ends waiting. Handled, without the line written yet, leaves
    // the preview and offers the request again.
    await world$.reply(world, stored, "handled");
    await pollPage(page, () => window.__lahe.stylePanel().ask.shown === true, undefined, {
      message: "the reply to end the waiting line"
    });
    info = await panel(page);
    expect(info.status).toBe("Previewing " + name + ". The document uses International Style.");

    // V14: the agent writes the one line into the HTML, after the house style.
    const source = world$.readSource(world);
    const kept = source.replace(
      '<link rel="stylesheet" href="./.lahe-doc-style.css">',
      '<link rel="stylesheet" href="./.lahe-doc-style.css">\n  <link rel="stylesheet" href="./.lahe-styles/sample/style.css">'
    );
    expect(kept).not.toBe(source);
    await world$.agentWrites(page, world, kept);
    await showing(page, "sample");
    const after = await styleInfo(page);
    expect(after.documentId).toBe("sample");
    expect(after.previewing).toBe(false);
    expect(after.stored, "the preview key is cleared").toBe(null);
    expect(after.previewLinks, "no preview link in the page").toBe(0);
    expect((await panel(page)).mode).toBe("closed");
    expect((await panel(page)).button.indicator, "the kept style is the document's: no dot").toBe(null);
    const info2 = await openPanel(page);
    expect(info2.rows.find((r) => r.id === "sample").inDocument).toBe(true);
    expect(info2.rows.find((r) => r.id === "sample").checked).toBe(true);
  });
});

// --- V15, V16, V25: what the document names ---------------------------------------

test.describe("what the document names, and a style that goes away (V15, V16, V25, R12)", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("a document naming a style this machine lacks shows International Style and the panel names it", async ({ page }) => {
    const text = DOC.replace(
      '<link rel="stylesheet" href="./.lahe-doc-style.css">',
      '<link rel="stylesheet" href="./.lahe-doc-style.css">\n  <link rel="stylesheet" href="./.lahe-styles/foo/style.css">'
    );
    world = await openWorld(page, { text: text, styles: ["sample"] });
    expect((await styleInfo(page)).documentId).toBe("foo");
    const info = await openPanel(page);
    expect(info.notes).toEqual(["This document asks for foo, which is not installed here. Showing International Style."]);
    expect(info.rows.filter((r) => r.checked).map((r) => r.id)).toEqual(["international"]);
    expect(info.rows.filter((r) => r.inDocument).length).toBe(0);
    await shoot(page, "missing_style_light");
  });

  test("with two style links in the source, the last one is the document's style (V25)", async ({ page }) => {
    const text = DOC.replace(
      '<link rel="stylesheet" href="./.lahe-doc-style.css">',
      '<link rel="stylesheet" href="./.lahe-doc-style.css">\n' +
        '  <link rel="stylesheet" href="./.lahe-styles/sample-dark/style.css">\n' +
        '  <link rel="stylesheet" href="./.lahe-styles/sample/style.css">'
    );
    world = await openWorld(page, { text: text, styles: ["sample", "sample-dark"] });
    expect((await styleInfo(page)).documentId).toBe("sample");
    const info = await openPanel(page);
    expect(info.rows.filter((r) => r.inDocument).map((r) => r.id)).toEqual(["sample"]);
    // A preview disables both of the document's links.
    await clickRow(page, "international");
    await showing(page, "international");
    expect((await styleInfo(page)).disabledDocumentLinks).toBe(2);
  });

  test("a preview whose style was removed clears itself and says so (V16)", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample"] });
    await openPanel(page);
    await clickRow(page, "sample");
    await showing(page, "sample");
    await clickControl(page, "close");
    const name = (await page.evaluate(() => window.__lahe.handle.styleList().styles)).find((s) => s.id === "sample").name;

    styles.removeStyle(world, "sample");
    await world$.agentWrites(page, world, world$.readSource(world));
    await pollPage(page, () => !!window.__lahe.style().removed, undefined, { message: "the preview to clear itself" });
    await showing(page, "international");
    const got = await styleInfo(page);
    expect(got.stored).toBe(null);
    expect(got.previewLinks).toBe(0);
    await pollPage(page, () => window.__lahe.handle.styleList().loaded === true, undefined, {
      message: "the list to name the style"
    });
    const removedLines = [name, "sample"].map((n) => n + " is no longer installed, so the page is back to its own style.");
    let info = await panel(page);
    expect(info.mode).toBe("closed");
    // The button carries a warn dot, and its hover line says why.
    expect(info.button.indicator).toBe("removed");
    expect(info.button.dot.shown).toBe(true);
    expect(removedLines.map((line) => "Document style: " + line)).toContain(info.button.title);
    await shootHead(page, "removed_closed_light");
    // Opening the dropdown shows the line in full.
    info = await openPanel(page);
    expect(removedLines).toContain(info.notes[0]);
    // Closing it is the acknowledgement: the dot goes.
    await clickControl(page, "close");
    await pollPage(page, () => window.__lahe.stylePanel().button.indicator === null, undefined, {
      message: "closing the dropdown to dismiss the removed line"
    });
    expect((await styleInfo(page)).removed).toBe(null);
  });
});

// --- V22: a list from anywhere reaches the rail as data --------------------------

// --- Fix round 1 -------------------------------------------------------------------

/** A route that holds one stylesheet until released. */
async function holdSheet(page, id) {
  let release = null;
  const released = new Promise((resolve) => {
    release = resolve;
  });
  let requested = false;
  await page.route("**/.lahe-styles/" + id + "/style.css", async (route) => {
    requested = true;
    await released;
    await route.continue().catch(() => {});
  });
  return { release: () => release(), requested: () => requested };
}

test.describe("fix round 1: removal without a reload, one paint per pick, the latest pick", () => {
  let world = null;
  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: "ignoreErrors" });
    world$.closeWorld(world);
    world = null;
  });

  test("a style removed during a live preview: reopening the panel ends the preview and says so, with no reload", async ({
    page
  }) => {
    world = await openWorld(page, { styles: ["sample"] });
    const nav = world$.navCounter(page);
    await openPanel(page);
    await clickRow(page, "sample");
    await showing(page, "sample");
    await clickControl(page, "close");

    styles.removeStyle(world, "sample");
    const info = await openPanel(page);
    await showing(page, "international");
    const got = await styleInfo(page);
    expect(got.stored, "the stored preview is cleared").toBe(null);
    expect(got.previewLinks).toBe(0);
    const after = await panel(page);
    expect(after.status).toBe("The document uses International Style.");
    expect(after.ask.shown, "nothing to ask the agent for").toBe(false);
    expect(after.notes[0]).toBe("Sample is no longer installed, so the page is back to its own style.");
    expect(after.rows.map((r) => r.id)).toEqual(["international"]);
    expect(info.rows.length).toBeGreaterThan(0);
    expect(nav.count, "no reload").toBe(0);
    nav.stop();
    await shoot(page, "style_removed_live_light");

    // Read in the open dropdown, so closing it dismisses the line: no dot.
    await clickControl(page, "close");
    await pollPage(page, () => window.__lahe.stylePanel().mode === "closed", undefined, { message: "the dropdown to close" });
    await pollPage(page, () => window.__lahe.stylePanel().button.indicator === null, undefined, {
      message: "the removed line to be dismissed"
    });
  });

  test("the latest pick wins: a held first stylesheet released late changes nothing, and its promise settles", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    const held = await holdSheet(page, "sample");
    await page.evaluate(() => {
      window.__firstPick = null;
      window.__lahe.handle.styleSwitch.preview("sample").then((r) => {
        window.__firstPick = r;
      });
    });
    await pollUntil(() => held.requested(), { message: "the first stylesheet to be asked for" });
    await page.evaluate(() => window.__lahe.handle.styleSwitch.preview("sample-dark"));
    await showing(page, "sample-dark");
    // The first pick's promise settled when it was overtaken, before its link
    // ever answered.
    expect(await page.evaluate(() => window.__firstPick)).toEqual({ ok: false, superseded: true });

    held.release();
    // Let the released response arrive and give it every chance to paint.
    await page.evaluate(() => document.fonts.ready);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const got = await styleInfo(page);
    expect(got.shown).toBe("sample-dark");
    expect(got.previewLinks, "exactly one preview link").toBe(1);
    expect(got.stored).toBe("sample-dark");
  });

  test("one paint per pick: while the next stylesheet loads the old preview stays on screen, never the house style", async ({
    page
  }) => {
    world = await openWorld(page, { styles: ["sample", "sample-dark"] });
    await page.evaluate(() => window.__lahe.handle.styleSwitch.preview("sample"));
    await showing(page, "sample");
    const sampleLooks = await looks(page);

    const held = await holdSheet(page, "sample-dark");
    await page.evaluate(() => {
      window.__lahe.handle.styleSwitch.preview("sample-dark");
    });
    await pollUntil(() => held.requested(), { message: "the next stylesheet to be asked for" });
    // Held mid-load: the page still wears the old preview, not the house style.
    expect(await looks(page)).toEqual(sampleLooks);
    expect((await styleInfo(page)).previewLinks, "the old link stays until the new one loads").toBe(2);

    held.release();
    await showing(page, "sample-dark");
    expect((await looks(page)).background).not.toBe(sampleLooks.background);
    expect((await styleInfo(page)).previewLinks).toBe(1);
  });

  test("a pick whose stylesheet fails keeps the preview that was on screen", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample"] });
    await page.evaluate(() => window.__lahe.handle.styleSwitch.preview("sample"));
    await showing(page, "sample");
    const before = await looks(page);
    const result = await page.evaluate(() => window.__lahe.handle.styleSwitch.preview("not-installed"));
    expect(result.ok).toBe(false);
    await showing(page, "sample");
    const got = await styleInfo(page);
    expect(got.previewLinks).toBe(1);
    expect(got.stored).toBe("sample");
    expect(await looks(page)).toEqual(before);
  });
});

test.describe("fix round 1: every way a request stops waiting (V13)", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  async function askAndWait(page) {
    const before = (await page.evaluate(() => window.__lahe.items())).length;
    await clickControl(page, "ask");
    await pollPage(page, () => window.__lahe.stylePanel().status.indexOf("Sent to the agent.") === 0, undefined, {
      message: "the waiting line"
    });
    const items = await page.evaluate(() => window.__lahe.items());
    expect(items.length).toBe(before + 1);
    return items.find((it) => it.state === "ready" && /lahe-style: sample/.test(it.note) && !it.reply);
  }

  async function askShownAgain(page) {
    await pollPage(page, () => window.__lahe.stylePanel().ask.shown === true, undefined, {
      message: "the Ask button to come back"
    });
    expect((await panel(page)).status.indexOf("Previewing ")).toBe(0);
  }

  test("a question, a not handled, a delete and a reword each end waiting; the handler's own guard sends nothing twice", async ({
    page
  }) => {
    world = await openWorld(page, { styles: ["sample"] });
    await openPanel(page);
    await clickRow(page, "sample");
    await showing(page, "sample");

    // A question ends waiting.
    let asked = await askAndWait(page);
    await world$.reply(world, await world$.helperHas(world, asked.id, asked.rev), "question", ["--text", "Which pages?"]);
    await askShownAgain(page);

    // A not handled ends waiting.
    asked = await askAndWait(page);
    await world$.reply(world, await world$.helperHas(world, asked.id, asked.rev), "not_handled", ["--reason", "Not today."]);
    await askShownAgain(page);

    // Deleting the request ends waiting, and Ask comes back.
    asked = await askAndWait(page);
    await page.evaluate((id) => window.__lahe.handle.comments.remove(id), asked.id);
    await askShownAgain(page);

    // Rewording the request so it no longer carries the marker ends waiting.
    asked = await askAndWait(page);
    await page.evaluate((id) => {
      const box = window.__lahe.handle.comments.reopen(id);
      box.type("Actually, leave the style as it is.");
      box.commitReword();
      box.close();
    }, asked.id);
    await askShownAgain(page);

    // The guard in the ask handler itself: while one is waiting, a direct call
    // for the same style mints nothing.
    asked = await askAndWait(page);
    const count = (await page.evaluate(() => window.__lahe.items())).length;
    const second = await page.evaluate(() => window.__lahe.handle.askForStyle("sample"));
    expect(second).toBe(null);
    expect((await page.evaluate(() => window.__lahe.items())).length).toBe(count);
  });
});

// --- Fix round 2 ---------------------------------------------------------------------

/**
 * A made-up style, written by the test into a temporary folder and installed
 * with the real command: table rows several times taller, the shape of a
 * ledger-like style that the reading position has to survive.
 */
function installTallRows(world) {
  const dir = path.join(fs.mkdtempSync(path.join(require("node:os").tmpdir(), "lahe-style-tall-")), "tall-rows");
  fs.mkdirSync(dir, { recursive: true });
  // A ledger keeps its column heads in view while the rows scroll under them,
  // so the head row is always at the top of the window and is never where the
  // reader is.
  fs.writeFileSync(
    path.join(dir, "style.css"),
    "td,th{padding:26px 12px;line-height:1.9}\ntable{border-spacing:0 10px}\n" +
      "thead th{position:sticky;top:0;background:#ffffff}\n"
  );
  fs.writeFileSync(
    path.join(dir, "metadata.json"),
    JSON.stringify({ name: "Tall Rows", description: "A made-up style for the reading-position test.", palette: [{ value: "#ffffff" }] })
  );
  world.cli(["style", "add", dir]);
}

function tableDoc(rows) {
  const body = [];
  for (let i = 1; i <= rows; i += 1) body.push("    <tr><td id=\"r" + i + "\">Row " + i + " entry</td><td>Week " + i + " miles</td></tr>");
  return DOC.replace(
    "<section class=\"sheet\">",
    "<section class=\"sheet\">\n  <div class=\"sheet-head\"><h2>The log</h2><span class=\"n\">Log</span></div>\n" +
      "  <table>\n    <thead><tr><th>Entry</th><th>Miles</th></tr></thead>\n    <tbody>\n" +
      body.join("\n") +
      "\n    </tbody>\n  </table>\n</section>\n\n<section class=\"sheet\">"
  );
}

test.describe("fix round 2: the reading position inside a long table", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("switching between styles that change row heights keeps the row at the top of the window where it was", async ({
    page
  }) => {
    world = await openWorld(page, { text: tableDoc(80), styles: ["sample"] });
    installTallRows(world);
    await page.evaluate(() => window.__lahe.handle.styleSwitch.preview("tall-rows"));
    await showing(page, "tall-rows");
    // Into the table, with a row part way under the top edge.
    await page.evaluate(() => {
      document.querySelector("#r40").scrollIntoView({ block: "start", behavior: "instant" });
      window.scrollBy({ top: 12, behavior: "instant" });
    });
    // The row the reader is at: the first whose bottom is below the top edge.
    const at = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll("tbody tr"));
      const row = rows.find((r) => r.getBoundingClientRect().bottom > 0);
      return { id: row.firstElementChild.id, top: row.getBoundingClientRect().top };
    });

    await openPanel(page);
    await clickRow(page, "sample");
    await showing(page, "sample");
    const top = await topOf(page, "#" + at.id);
    expect(Math.abs(top - at.top), "row " + at.id + " stayed where it was").toBeLessThanOrEqual(2);
  });
});

test.describe("fix round 2: going back, and the line on reload", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("asking to go back to International says the agent will return the page, not add a style (V13)", async ({ page }) => {
    const kept = DOC.replace(
      '<link rel="stylesheet" href="./.lahe-doc-style.css">',
      '<link rel="stylesheet" href="./.lahe-doc-style.css">\n  <link rel="stylesheet" href="./.lahe-styles/sample/style.css">'
    );
    world = await openWorld(page, { text: kept, styles: ["sample"] });
    await openPanel(page);
    await clickRow(page, "international");
    await showing(page, "international");
    expect((await panel(page)).ask.label).toBe("Ask the agent to use International Style");
    await clickControl(page, "ask");
    await pollPage(page, () => window.__lahe.stylePanel().status.indexOf("Sent to the agent.") === 0, undefined, {
      message: "the waiting line"
    });
    expect((await panel(page)).status).toBe("Sent to the agent. Waiting for it to return this page to International Style.");
    await shoot(page, "waiting_back_light");
  });

  test("on reload while previewing, the line names the style from the first frame, never by its id", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample"] });
    await openPanel(page);
    await clickRow(page, "sample");
    await showing(page, "sample");
    const name = (await panel(page)).rows.find((r) => r.id === "sample").name;
    // Every hover line the marked button carries from the first frame of the
    // next load.
    await page.addInitScript(() => {
      window.__styleLines = [];
      const watch = () => {
        const lahe = window.__lahe;
        if (lahe && lahe.stylePanel) {
          const info = lahe.stylePanel();
          if (info.button && info.button.indicator) window.__styleLines.push(info.button.title);
        }
        requestAnimationFrame(watch);
      };
      requestAnimationFrame(watch);
    });
    await page.reload();
    await world$.settled(page);
    await showing(page, "sample");
    await pollPage(page, () => window.__lahe.handle.styleList().loaded === true, undefined, { message: "the list" });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const lines = await page.evaluate(() => window.__styleLines);
    expect(lines.length).toBeGreaterThan(0);
    expect(
      lines.every((line) => line === "Document style: Previewing " + name),
      JSON.stringify(Array.from(new Set(lines)))
    ).toBe(true);
  });
});

test.describe("fix round 1: a missing style on rendered Markdown (V15)", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("a Markdown file naming a style this machine lacks shows International Style and the panel names it", async ({
    page
  }) => {
    const text = "---\nlahe-style: foo\n---\n# Coming back after a layoff\n\nRunners come back too fast after a layoff.\n";
    world = await openWorld(page, { file: "plan.md", text: text, styles: ["sample"] });
    const got = await styleInfo(page);
    expect(got.usesHouseStyle).toBe(true);
    expect(got.documentId).toBe("foo");
    const info = await openPanel(page);
    expect(info.notes).toContain("This document asks for foo, which is not installed here. Showing International Style.");
    expect(info.rows.filter((r) => r.checked).map((r) => r.id)).toEqual(["international"]);
  });
});

test.describe("the list the layer re-checks (V22, display)", () => {
  let world = null;
  test.afterEach(() => {
    world$.closeWorld(world);
    world = null;
  });

  test("a bad id or colour is dropped, a name is text, and a 40-character name wraps", async ({ page }) => {
    world = await openWorld(page, { styles: ["sample"] });
    const LONG = "Field Notes for Long Weekends and Trails";
    expect(LONG.length).toBe(40);
    // A list served from anywhere. The route stands in for a page server that
    // does not check, which is exactly what the layer must not trust.
    await page.route("**/.lahe-styles/index.json", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          styles: [
            { id: "sample", name: "Sample", palette: ["#fbf3e4", "url(https://example.invalid/x)", "#000;background:red", "#2b2118"] },
            { id: "../evil", name: "Evil" },
            { id: "markup", name: "<img src=x onerror=window.__pwned=1>" },
            { id: "trails", name: LONG, palette: ["#e9efe6", "#24331f", "#6f8f4e", "#c9a96e", "#3a5a78", "#f4f1e8"] }
          ]
        })
      })
    );
    const info = await openPanel(page);
    expect(info.rows.map((r) => r.id)).toEqual(["international", "trails", "sample"]);
    const sample = info.rows.find((r) => r.id === "sample");
    expect(sample.palette.length, "only the two real colours reach a swatch").toBe(2);
    expect(await page.evaluate(() => window.__pwned === undefined)).toBe(true);
    const trails = info.rows.find((r) => r.id === "trails");
    expect(trails.name).toBe(LONG);
    // Wrapped, never clipped: the name's box is taller than one line, and the
    // strip still fits beside it inside the row.
    expect(trails.nameRect.height).toBeGreaterThan(20);
    expect(trails.nameRect.right).toBeLessThanOrEqual(trails.rect.right);
    await shoot(page, "long_name_light");
    await page.unrouteAll({ behavior: "ignoreErrors" });
  });
});

// --- V26: a house-style page no Lahe page server serves ---------------------------

test.describe("a page that no Lahe page server serves (V26)", () => {
  let server = null;
  test.afterEach(async () => {
    if (server) await server.close();
    server = null;
  });

  test("International Style alone and the add line, and a stored preview clears itself", async ({ page }) => {
    const root = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "lahe-style-plain-"));
    fs.writeFileSync(path.join(root, "doc.html"), DOC);
    server = await startStaticServer({ root: root, label: "plain" });
    const review = "rev-style-plain";
    await withLayer(page, { review: review, token: "unused", helper: "http://127.0.0.1:9" });
    await page.addInitScript((key) => {
      try {
        localStorage.setItem(key, "sample");
      } catch (err) {
        // A page that refuses storage has nothing to restore.
      }
    }, "lahe.style.v1:" + review + ":/doc.html");
    await page.setViewportSize({ width: 1180, height: 860 });
    await page.goto(server.urlFor("/doc.html"));
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, { message: "the layer to boot" });
    await pollPage(page, () => window.__lahe.style().stored === null && window.__lahe.style().settled, undefined, {
      message: "the stored preview to clear itself"
    });
    expect((await styleInfo(page)).previewLinks).toBe(0);
    const info = await openPanel(page);
    expect(info.rows.map((r) => r.id)).toEqual(["international"]);
    expect(info.notes).toContain("Add styles with lahe style add <folder>, or ask your agent to.");
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
