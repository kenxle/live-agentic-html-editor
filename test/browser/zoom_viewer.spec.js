// The zoom viewer (docs/features/20261007.01_zoom_viewer/01_spec_zoom_viewer.md).
//
// A magnifier button appears at the top right of a graph or a large image while
// the pointer is over it, and opens a full-screen view to zoom and pan. Every
// row of the spec's proof table is a test here, on one fixture page with a
// Mermaid-shaped wide SVG, a large image, a small icon, an image inside a link,
// and an svg nested inside another.
//
// The button and the viewer live in the layer's closed shadow roots, so the
// page cannot query them. The specs drive them the way a reviewer does (mouse,
// wheel, keys, at real coordinates) and read where things are through the
// module's own info() seam, which reports rects and the view's scale.
//
// The helper is deliberately down: everything here happens in the browser.
// Run `node scripts/build-layer.js` first.

"use strict";

const path = require("node:path");
const { test, expect, startStaticServer, pollPage } = require("../helpers");
const fw = require("./support/free_writing_page");

const FIXTURE = "test/fixtures/zoom/zoom.html";
const SHOT_DIR = path.join(fw.REPO_ROOT, "docs", "features", "20261007.01_zoom_viewer");

let server;

test.beforeAll(async () => {
  server = await startStaticServer({ root: fw.REPO_ROOT, label: "zoom" });
});

test.afterAll(async () => {
  await server.close();
});

async function open(page, query) {
  await fw.openFixture(page, server, FIXTURE + (query || ""));
  // Every image has to be decoded before its natural size can be read.
  await pollPage(page, () => Array.from(document.images).every((img) => img.complete && img.naturalWidth > 0), undefined, {
    message: "the fixture's images to load"
  });
}

function info(page) {
  return page.evaluate(() => window.__lahe.handle.zoom.info());
}

function constants(page) {
  return page.evaluate(() => ({
    margin: window.LAHE.zoom.MARGIN,
    min: window.LAHE.zoom.MIN_SCALE,
    max: window.LAHE.zoom.MAX_SCALE
  }));
}

/** Move the pointer onto the middle of an element, scrolling it into view first. */
async function hoverOn(page, selector) {
  await page.evaluate((sel) => document.querySelector(sel).scrollIntoView({ block: "center" }), selector);
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
}

/**
 * Hover an element and prove it got no button. The pointer handler runs
 * synchronously inside the move, so once the module has counted the move its
 * answer is final: a button would already be up.
 */
async function expectNoButtonOver(page, selector, why) {
  const before = (await info(page)).button.movesSeen;
  await hoverOn(page, selector);
  const button = (await info(page)).button;
  expect(button.movesSeen, "the move over " + selector + " was seen").toBeGreaterThan(before);
  expect(button.shown, why).toBe(false);
}

async function buttonShownFor(page, id) {
  await pollPage(
    page,
    (want) => {
      const b = window.__lahe.handle.zoom.info().button;
      return b.shown === true && b.targetId === want;
    },
    id,
    { message: "the zoom button to show for #" + id }
  );
  return (await info(page)).button;
}

function centre(rect) {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/** Hover a target and press its button with the mouse. Leaves the viewer open. */
async function openViewerOn(page, selector) {
  await hoverOn(page, selector);
  const button = await buttonShownFor(page, selector.slice(1));
  const at = centre(button.rect);
  await page.mouse.move(at.x, at.y, { steps: 3 });
  await page.mouse.click(at.x, at.y);
  await pollPage(page, () => window.__lahe.handle.zoom.info().viewer.open === true, undefined, {
    message: "the viewer to open for " + selector
  });
  return (await info(page)).viewer;
}

async function viewerClosed(page, message) {
  await pollPage(page, () => window.__lahe.handle.zoom.info().viewer.open === false, undefined, { message: message });
}

test.describe("zoom viewer: the hover button", () => {
  test("hovering a wide SVG shows the button at its top right; a small icon gets none", async ({ page }) => {
    await open(page);
    await hoverOn(page, "#mermaid-1");
    const button = await buttonShownFor(page, "mermaid-1");
    const svgBox = await page.locator("#mermaid-1").boundingBox();
    // Inside the graph's corner: right edges within a button's width, tops close.
    expect(button.rect.x + button.rect.width).toBeLessThanOrEqual(svgBox.x + svgBox.width + 1);
    expect(button.rect.x + button.rect.width).toBeGreaterThan(svgBox.x + svgBox.width - 60);
    expect(Math.abs(button.rect.y - svgBox.y)).toBeLessThan(30);

    await hoverOn(page, "#icon");
    await pollPage(page, () => window.__lahe.handle.zoom.info().button.shown === false, undefined, {
      message: "the button to go when the pointer moves onto a small icon"
    });
    // And the icon never earns one of its own.
    await expectNoButtonOver(page, "#icon", "a small icon gets no button");
  });

  test("a large image shown smaller than its real size gets the button", async ({ page }) => {
    await open(page);
    await hoverOn(page, "#big");
    await buttonShownFor(page, "big");
  });

  test("the button stays while the pointer moves from the graph onto it, and fades after leaving both", async ({ page }) => {
    await open(page);
    await hoverOn(page, "#mermaid-1");
    const button = await buttonShownFor(page, "mermaid-1");
    const at = centre(button.rect);
    await page.mouse.move(at.x, at.y, { steps: 3 });
    const onButton = (await info(page)).button;
    expect(onButton.shown).toBe(true);
    expect(onButton.hidePending, "no fade is waiting while the pointer is on the button").toBe(false);
    // Off to the left margin, outside the graph and the button.
    await page.mouse.move(5, at.y, { steps: 3 });
    await pollPage(page, () => window.__lahe.handle.zoom.info().button.shown === false, undefined, {
      message: "the button to fade after the pointer leaves"
    });
  });

  test("a nested svg gets no button of its own: the outer one does", async ({ page }) => {
    await open(page);
    await page.evaluate(() => document.querySelector("#outer").scrollIntoView({ block: "center" }));
    const inner = await page.locator("#inner").boundingBox();
    await page.mouse.move(inner.x + inner.width / 2, inner.y + inner.height / 2, { steps: 4 });
    const button = await buttonShownFor(page, "outer");
    expect(button.targetId).toBe("outer");
  });

  test("no button in edit mode, in pick mode, or while presenting", async ({ page }) => {
    await open(page);

    await fw.openEdit(page, "#p1");
    await expectNoButtonOver(page, "#big", "no button while a block is being edited");
    await fw.commitByEsc(page);
    await hoverOn(page, "#mermaid-1");
    await buttonShownFor(page, "mermaid-1");

    await page.evaluate(() => window.__lahe.handle.comments.enterPickMode());
    await expectNoButtonOver(page, "#big", "no button in pick mode");
    await page.evaluate(() => window.__lahe.handle.comments.exitPickMode());

    await page.evaluate(() => window.__lahe.present(true));
    await expectNoButtonOver(page, "#mermaid-1", "no button while presenting");
    await page.evaluate(() => window.__lahe.present(false));
    await hoverOn(page, "#big");
    await buttonShownFor(page, "big");
  });

  test("keyboard: focusing a linked image offers the button on Tab, Enter opens it, Esc returns focus to it", async ({ page }) => {
    await open(page);
    await page.focus("#photolink");
    await buttonShownFor(page, "photo");
    await page.keyboard.press("Tab");
    await pollPage(page, () => window.__lahe.handle.zoom.info().button.focused === true, undefined, {
      message: "Tab to move focus onto the zoom button"
    });
    await page.keyboard.press("Enter");
    await pollPage(page, () => window.__lahe.handle.zoom.info().viewer.open === true, undefined, {
      message: "Enter on the button to open the viewer"
    });
    expect(await page.evaluate(() => location.hash)).toBe("");
    await page.keyboard.press("Escape");
    await viewerClosed(page, "Esc to close the viewer");
    expect((await info(page)).button.focused, "focus goes back to the button").toBe(true);
  });
});

test.describe("zoom viewer: the view", () => {
  test("an image in a link: the button opens the viewer, a click on the image still follows the link", async ({ page }) => {
    await open(page);
    const viewer = await openViewerOn(page, "#photo");
    expect(viewer.kind).toBe("img");
    expect(viewer.src).toMatch(/photo\.svg$/);
    expect(await page.evaluate(() => location.hash), "pressing the button does not follow the link").toBe("");
    await page.keyboard.press("Escape");
    await viewerClosed(page, "Esc to close");
    await page.locator("#photo").click();
    await pollPage(page, () => location.hash === "#linked", undefined, { message: "the link to be followed" });
  });

  test("opens fitted to the window with a margin", async ({ page }) => {
    await open(page);
    const viewer = await openViewerOn(page, "#big");
    const c = await constants(page);
    const vp = page.viewportSize();
    const fit = Math.min((vp.width - 2 * c.margin) / viewer.width, (vp.height - 2 * c.margin) / viewer.height);
    expect(viewer.width).toBe(1600);
    expect(viewer.height).toBe(1000);
    expect(viewer.scale).toBeCloseTo(fit, 4);
    expect(viewer.label).toBe(Math.round(fit * 100) + "%");
  });

  test("the wheel zooms toward the pointer, and the page under the viewer does not scroll", async ({ page }) => {
    await open(page);
    let viewer = await openViewerOn(page, "#big");
    const scrollBefore = await page.evaluate(() => window.scrollY);
    // Whole pixels: a mouse event's clientX and clientY are integers.
    const px = Math.round(viewer.x + viewer.width * viewer.scale * 0.3);
    const py = Math.round(viewer.y + viewer.height * viewer.scale * 0.6);
    const before = { x: (px - viewer.x) / viewer.scale, y: (py - viewer.y) / viewer.scale };
    await page.mouse.move(px, py);
    await page.mouse.wheel(0, -300);
    await pollPage(page, (s) => window.__lahe.handle.zoom.info().viewer.scale > s * 1.05, viewer.scale, {
      message: "the wheel to zoom in"
    });
    viewer = (await info(page)).viewer;
    const after = { x: (px - viewer.x) / viewer.scale, y: (py - viewer.y) / viewer.scale };
    expect(after.x).toBeCloseTo(before.x, 1);
    expect(after.y).toBeCloseTo(before.y, 1);
    expect(await page.evaluate(() => window.scrollY), "the page did not scroll").toBe(scrollBefore);
  });

  test("zoom stays inside its limits, and plus and minus keys zoom", async ({ page }) => {
    await open(page);
    let viewer = await openViewerOn(page, "#big");
    const c = await constants(page);
    await page.keyboard.press("+");
    let next = (await info(page)).viewer;
    expect(next.scale).toBeGreaterThan(viewer.scale);
    await page.keyboard.press("-");
    await page.keyboard.press("-");
    expect((await info(page)).viewer.scale).toBeLessThan(next.scale);
    await page.mouse.move(400, 300);
    for (let i = 0; i < 12; i += 1) await page.mouse.wheel(0, -2000);
    await pollPage(page, (max) => window.__lahe.handle.zoom.info().viewer.scale === max, c.max, {
      message: "zoom in to stop at the maximum"
    });
    for (let i = 0; i < 20; i += 1) await page.mouse.wheel(0, 2000);
    await pollPage(page, (min) => window.__lahe.handle.zoom.info().viewer.scale === min, c.min, {
      message: "zoom out to stop at the minimum"
    });
  });

  test("dragging pans, arrow keys pan, and fit and 100% set the expected scale", async ({ page }) => {
    await open(page);
    let viewer = await openViewerOn(page, "#big");
    const c = await constants(page);
    const vp = page.viewportSize();
    const fit = Math.min((vp.width - 2 * c.margin) / viewer.width, (vp.height - 2 * c.margin) / viewer.height);
    const start = centre(viewer.contentRect);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 120, start.y + 70, { steps: 6 });
    await page.mouse.up();
    let moved = (await info(page)).viewer;
    expect(moved.x - viewer.x).toBeCloseTo(120, 0);
    expect(moved.y - viewer.y).toBeCloseTo(70, 0);
    expect(moved.open, "a drag over the image does not close the viewer").toBe(true);

    // ArrowLeft looks further left, the way a map does: the picture moves right.
    await page.keyboard.press("ArrowLeft");
    const keyed = (await info(page)).viewer;
    expect(keyed.x).toBeGreaterThan(moved.x);

    await page.mouse.click(centre(keyed.controls.actual).x, centre(keyed.controls.actual).y);
    viewer = (await info(page)).viewer;
    expect(viewer.scale).toBe(1);
    expect(viewer.label).toBe("100%");

    await page.mouse.click(centre(viewer.controls.in).x, centre(viewer.controls.in).y);
    expect((await info(page)).viewer.scale).toBeGreaterThan(1);
    await page.mouse.click(centre(viewer.controls.out).x, centre(viewer.controls.out).y);
    await page.mouse.click(centre(viewer.controls.out).x, centre(viewer.controls.out).y);
    expect((await info(page)).viewer.scale).toBeLessThan(1);

    await page.mouse.click(centre(viewer.controls.fit).x, centre(viewer.controls.fit).y);
    viewer = (await info(page)).viewer;
    expect(viewer.scale).toBeCloseTo(fit, 4);
    // Fitted means centred, too.
    expect(viewer.contentRect.x + viewer.contentRect.width / 2).toBeCloseTo(vp.width / 2, 0);
    expect(viewer.contentRect.y + viewer.contentRect.height / 2).toBeCloseTo(vp.height / 2, 0);
  });

  test("Esc, the close button and a backdrop click close it; a drag ending on the backdrop does not", async ({ page }) => {
    await open(page);
    await openViewerOn(page, "#big");
    await page.keyboard.press("Escape");
    await viewerClosed(page, "Esc to close");

    let viewer = await openViewerOn(page, "#big");
    await page.mouse.click(centre(viewer.controls.close).x, centre(viewer.controls.close).y);
    await viewerClosed(page, "the close button to close");

    viewer = await openViewerOn(page, "#big");
    const vp = page.viewportSize();
    // A drag from the image that ends out on the dimmed area is a pan.
    const from = centre(viewer.contentRect);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(8, vp.height - 8, { steps: 8 });
    await page.mouse.up();
    expect((await info(page)).viewer.open, "a drag ending on the backdrop keeps it open").toBe(true);

    // A drag that starts and ends on the backdrop is still a drag.
    await page.mouse.click(centre(viewer.controls.fit).x, centre(viewer.controls.fit).y);
    await page.mouse.move(10, vp.height / 2);
    await page.mouse.down();
    await page.mouse.move(30, vp.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    expect((await info(page)).viewer.open).toBe(true);

    await page.mouse.click(10, vp.height / 2);
    await viewerClosed(page, "a click on the dimmed area to close");
  });

  test("the viewer's SVG is a vector copy, and the page's original is untouched", async ({ page }) => {
    await open(page);
    const original = await page.evaluate(() => document.getElementById("mermaid-1").outerHTML);
    const viewer = await openViewerOn(page, "#mermaid-1");
    expect(viewer.kind).toBe("svg");
    expect(viewer.width).toBe(2400);
    expect(viewer.height).toBe(300);
    // A copy of the vector: the paths, the marker and the graph's own <style>.
    expect(viewer.markup).toMatch(/^<svg/);
    expect(viewer.markup).toContain("<style>");
    expect(viewer.markup).toContain("mermaid-1_arrow");
    expect(viewer.markup).toContain("Architecture");
    // The page still holds exactly one element with the graph's id.
    expect(await page.evaluate(() => document.querySelectorAll("#mermaid-1").length)).toBe(1);
    // The copy is drawn with its styles: a node's rect is filled from the svg's <style>.
    expect(await page.evaluate(() => window.__lahe.handle.zoom.probe(".node rect", "fill"))).toBe("rgb(238, 242, 251)");
    await page.keyboard.press("Escape");
    await viewerClosed(page, "Esc to close");
    expect(await page.evaluate(() => document.getElementById("mermaid-1").outerHTML)).toBe(original);
  });

  test("a link inside the copied SVG does nothing in the viewer", async ({ page }) => {
    await open(page);
    const viewer = await openViewerOn(page, "#mermaid-1");
    expect(viewer.markup, "the copy carries no href").not.toMatch(/href=/);
    expect(viewer.markup, "the copy carries no inline handler").not.toMatch(/onclick=/);
    // Bring the linked node ("Plan", the fifth) under the pointer and click it.
    const at = await page.evaluate(() => window.__lahe.handle.zoom.probeRect("#mermaid-1-n4 rect"));
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    expect(await page.evaluate(() => location.hash), "the page did not navigate").toBe("");
    expect(await page.evaluate(() => window.__zoomNodeClicked === true), "the node's handler did not run").toBe(false);
    expect((await info(page)).viewer.open, "the viewer is still open").toBe(true);
  });

  test("the edit chord while the viewer is open does nothing, and Esc still closes it", async ({ page }) => {
    await open(page);
    await openViewerOn(page, "#big");
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    const state = await page.evaluate(() => window.__lahe.editState());
    expect(state.open, "no edit session").toBe(false);
    expect(state.editState, "no edit state").toBe(false);
    expect((await info(page)).viewer.open, "the viewer is still open").toBe(true);
    await page.keyboard.press("Escape");
    await viewerClosed(page, "Esc to close the viewer after the chord");
    expect((await page.evaluate(() => window.__lahe.editState())).editState).toBe(false);
  });

  test("the page is not written to by hovering or by the viewer", async ({ page }) => {
    await open(page);
    await page.evaluate((rootId) => {
      window.__zoomRecords = [];
      const host = document.getElementById(rootId);
      const observer = new MutationObserver((list) => {
        list.forEach((r) => {
          // The library's own host is chrome; anything else is the page.
          if (r.target === host) return;
          window.__zoomRecords.push({ type: r.type, target: r.target.nodeName, attr: r.attributeName });
        });
      });
      observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        characterData: true
      });
      window.__zoomObserver = observer;
    }, await page.evaluate(() => window.__lahe.rootId));

    await hoverOn(page, "#mermaid-1");
    await buttonShownFor(page, "mermaid-1");
    await openViewerOn(page, "#mermaid-1");
    await page.mouse.wheel(0, -200);
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    await viewerClosed(page, "Esc to close");
    await openViewerOn(page, "#big");
    await page.keyboard.press("Escape");
    await viewerClosed(page, "Esc to close");

    const records = await page.evaluate(() => {
      window.__zoomObserver.takeRecords();
      return window.__zoomRecords;
    });
    expect(records).toEqual([]);
  });

  test("the viewer wears the page's scheme: dark on a dark page", async ({ page }) => {
    await open(page, "?dark");
    const viewer = await openViewerOn(page, "#big");
    expect(viewer.scheme).toBe("dark");
  });
});

// The screenshots for the spec's "Built" section. Off by default, so an
// ordinary run never rewrites the docs folder: LAHE_ZOOM_SHOTS=1 turns them on.
test.describe("zoom viewer: screenshots", () => {
  test.skip(!process.env.LAHE_ZOOM_SHOTS, "set LAHE_ZOOM_SHOTS=1 to capture the screenshots");

  for (const scheme of ["light", "dark"]) {
    test("hover button and zoomed viewer, " + scheme, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await open(page, scheme === "dark" ? "?dark" : "");
      await hoverOn(page, "#mermaid-1");
      const button = await buttonShownFor(page, "mermaid-1");
      await page.mouse.move(centre(button.rect).x - 120, centre(button.rect).y + 30);
      await buttonShownFor(page, "mermaid-1");
      await pollPage(page, () => window.__lahe.handle.zoom.info().button.opacity === 1, undefined, {
        message: "the button's fade-in to finish"
      });
      await page.screenshot({ path: path.join(SHOT_DIR, "button_" + scheme + ".png") });

      const viewer = await openViewerOn(page, "#mermaid-1");
      const at = { x: viewer.contentRect.x + viewer.contentRect.width * 0.35, y: viewer.contentRect.y + viewer.contentRect.height / 2 };
      await page.mouse.move(at.x, at.y);
      for (let i = 0; i < 3; i += 1) await page.mouse.wheel(0, -200);
      await pollPage(page, (s) => window.__lahe.handle.zoom.info().viewer.scale > s * 1.5, viewer.scale, {
        message: "the wheel to zoom in"
      });
      await page.screenshot({ path: path.join(SHOT_DIR, "viewer_" + scheme + ".png") });
    });
  }
});
