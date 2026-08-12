// RANKED TEST 1: typed text does not revert. Three layers, scored separately,
// in both fixture flavors.
//
// Owner: 2B. The plan's bar for this task, in its own words: ranked test 1
// passes on all three layers separately, each with the assertion that layer can
// meet, against the actively reverting repaint engine in both fixture flavors;
// and a protected block survives a morph that would otherwise replace it, in the
// veto flavor and in the no-hook flavor.
//
// WHY EACH LAYER GETS ITS OWN RUN. The cooperative-skip attribute and the veto
// event are two different framework features, and a run with both installed
// cannot say which one saved the caret. Each test below installs exactly one
// layer, so a layer that does nothing scores zero rather than riding on its
// neighbour.
//
// WHY TWO ASSERTIONS. Layers one and two keep the reviewer's text node alive, so
// node identity is achievable and assertCaretSurvivesTyping is the bar. Layer
// three restores after the repaint destroyed that node, so the caret is in a new
// node by construction and assertCaretRestoredAcrossRepaints is the bar instead
// (same character offset in the node now holding the text, no characters lost
// after ANY repaint, restore counter incremented).
//
// Every run here loads src/layer/protect.js. The stub layer is blocked at the
// network on the harness fixture; 0C's app fixture never loads it at all.

"use strict";

const {
  test,
  expect,
  startFixtureServer,
  configureFixture,
  forceRepaint,
  forceRepaints,
  startRepaints,
  stopRepaints,
  readCounters,
  assertCaretSurvivesTyping,
  assertCaretRestoredAcrossRepaints,
  placeCaret
} = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");
const { blockStubLayer, loadRealLayer, tagNode, nodeStillIdentical } = require("./support/protect_page");

const LAYER = {
  COOPERATIVE_SKIP: "cooperative_skip",
  VETO: "veto",
  SNAPSHOT_RESTORE: "snapshot_restore"
};

// The harness fixture's block under test, and 0C's.
const HARNESS_REGION = '[data-region="live-note"]';
const APP_REGION = "#feed-coach-note";

/**
 * The harness fixture, with the stub layer blocked and the real layer loaded.
 *
 * `protection: "off"` is not a detail. The repaint engine has its own
 * data-lahe-protected shortcut, and leaving it on would let the FIXTURE protect
 * the block while the library did nothing.
 */
async function openHarnessFixture(page, options) {
  const server = await startFixtureServer();
  await blockStubLayer(page);
  await page.goto(server.urlFor("repainting.html") + (options.query || ""));
  await loadRealLayer(page, { layers: options.layers });
  if (options.hooks !== "off") {
    await configureFixture(page, { protection: "off", flavor: options.flavor || "morph" });
  }
  return server;
}

/** 0C's app fixture. No stub layer exists on it at all. */
async function openAppFixture(page, options) {
  const app = await startAppServer();
  await page.goto(app.urlFor("/?morph=" + options.morph + "&poll=200"));
  await page.waitForFunction(function () {
    return !!(window.__app && window.__app.morph);
  });
  // Stop the application's own timer while the block is put into edit state, so
  // a poll cannot land between reading the block's wording and protecting it.
  await page.evaluate(function () {
    window.__app.morph.stop();
  });
  await loadRealLayer(page, { layers: options.layers });
  return app;
}

test.describe("ranked test 1: typed text does not revert", () => {
  test("layer one alone, cooperative skip, harness fixture", async ({ page }) => {
    const server = await openHarnessFixture(page, { layers: [LAYER.COOPERATIVE_SKIP] });
    try {
      await page.evaluate(function (sel) {
        return window.__lahe.enterEdit(sel);
      }, HARNESS_REGION);

      const result = await assertCaretSurvivesTyping(page, {
        selector: HARNESS_REGION,
        text: "0123456789",
        keystrokeDelayMs: 50,
        repaintIntervalMs: 200,
        minReplayPasses: 5
      });
      expect(result.actual).toBe(result.expected);
      // The engine really did try to revert the block while the reviewer typed.
      // Without this, a page where nothing repainted passes with a perfect score.
      expect(result.repaints).toBeGreaterThanOrEqual(2);

      const counters = await readCounters(page);
      // The layer that was installed did the work, and the others did not run.
      expect(counters.marked).toBeGreaterThanOrEqual(1);
      expect(counters.vetoes).toBe(0);
      expect(counters.restores).toBe(0);
      expect(counters.elementsSkippedCooperative).toBeGreaterThanOrEqual(1);
    } finally {
      await server.close();
    }
  });

  test("layer one alone, cooperative skip, 0C's app fixture", async ({ page }) => {
    const app = await openAppFixture(page, { morph: "hooked", layers: [LAYER.COOPERATIVE_SKIP] });
    try {
      await page.evaluate(function (sel) {
        return window.__lahe.enterEdit(sel);
      }, APP_REGION);

      const result = await assertCaretSurvivesTyping(page, {
        selector: APP_REGION,
        text: "0123456789",
        keystrokeDelayMs: 50,
        repaintIntervalMs: 200,
        minReplayPasses: 5
      });
      expect(result.actual).toBe(result.expected);
      // The engine really did try to revert the block while the reviewer typed.
      // Without this, a page where nothing repainted passes with a perfect score.
      expect(result.repaints).toBeGreaterThanOrEqual(2);

      const counters = await readCounters(page);
      expect(counters.vetoes).toBe(0);
      expect(counters.restores).toBe(0);
      const skipped = await page.evaluate(function () {
        return window.__app.counters.morphsSkipped;
      });
      expect(skipped).toBeGreaterThanOrEqual(1);
    } finally {
      await app.close();
    }
  });

  test("layer two alone, the pre-morph veto, harness fixture", async ({ page }) => {
    const server = await openHarnessFixture(page, { layers: [LAYER.VETO], flavor: "morph" });
    try {
      await page.evaluate(function (sel) {
        return window.__lahe.enterEdit(sel);
      }, HARNESS_REGION);

      const result = await assertCaretSurvivesTyping(page, {
        selector: HARNESS_REGION,
        text: "0123456789",
        keystrokeDelayMs: 50,
        repaintIntervalMs: 200,
        minReplayPasses: 5
      });
      expect(result.actual).toBe(result.expected);
      // The engine really did try to revert the block while the reviewer typed.
      // Without this, a page where nothing repainted passes with a perfect score.
      expect(result.repaints).toBeGreaterThanOrEqual(2);

      const counters = await readCounters(page);
      expect(counters.vetoes).toBeGreaterThanOrEqual(1);
      expect(counters.restores).toBe(0);
      // No skip attribute was written, so nothing the framework did was
      // cooperative: the veto is the only thing standing between the reviewer
      // and the repaint.
      expect(counters.elementsSkippedCooperative ?? 0).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("layer two alone, the pre-morph veto, 0C's app fixture", async ({ page }) => {
    const app = await openAppFixture(page, { morph: "hooked", layers: [LAYER.VETO] });
    try {
      await page.evaluate(function (sel) {
        return window.__lahe.enterEdit(sel);
      }, APP_REGION);

      const result = await assertCaretSurvivesTyping(page, {
        selector: APP_REGION,
        text: "0123456789",
        keystrokeDelayMs: 50,
        repaintIntervalMs: 200,
        minReplayPasses: 5
      });
      expect(result.actual).toBe(result.expected);
      // The engine really did try to revert the block while the reviewer typed.
      // Without this, a page where nothing repainted passes with a perfect score.
      expect(result.repaints).toBeGreaterThanOrEqual(2);

      const counters = await readCounters(page);
      expect(counters.vetoes).toBeGreaterThanOrEqual(1);
      expect(counters.restores).toBe(0);
    } finally {
      await app.close();
    }
  });

  test("layer three alone, snapshot and restore, harness no-hook flavor", async ({ page }) => {
    // A failing run polls for every one of the twelve repaints before it can
    // name the keystroke the text was lost at, and that report is worth more
    // than a timeout.
    test.setTimeout(60000);
    const server = await openHarnessFixture(page, {
      layers: [LAYER.SNAPSHOT_RESTORE],
      query: "?repaint=no-hook",
      hooks: "off"
    });
    try {
      await page.evaluate(function (sel) {
        return window.__lahe.enterEdit(sel);
      }, HARNESS_REGION);

      const result = await assertCaretRestoredAcrossRepaints(page, {
        selector: HARNESS_REGION,
        text: "0123456789",
        minRestores: 10,
        trailingRepaints: 2,
        repaintTimeoutMs: 1500
      });
      expect(result.actual).toBe(result.expected);
      // The engine really did try to revert the block while the reviewer typed.
      // Without this, a page where nothing repainted passes with a perfect score.
      expect(result.repaints).toBeGreaterThanOrEqual(2);

      const counters = await readCounters(page);
      expect(counters.restoreFailures).toBe(0);
      // Nothing cooperated and nothing was vetoed: this flavor offers neither.
      expect(counters.vetoes).toBe(0);
    } finally {
      await server.close();
    }
  });

  test("layer three alone, snapshot and restore, 0C's app fixture raw flavor", async ({ page }) => {
    test.setTimeout(60000);
    const app = await openAppFixture(page, { morph: "raw", layers: [LAYER.SNAPSHOT_RESTORE] });
    try {
      await page.evaluate(function (sel) {
        return window.__lahe.enterEdit(sel);
      }, APP_REGION);

      const result = await assertCaretRestoredAcrossRepaints(page, {
        selector: APP_REGION,
        text: "0123456789",
        minRestores: 10,
        trailingRepaints: 2,
        repaintTimeoutMs: 1500
      });
      expect(result.actual).toBe(result.expected);
      // The engine really did try to revert the block while the reviewer typed.
      // Without this, a page where nothing repainted passes with a perfect score.
      expect(result.repaints).toBeGreaterThanOrEqual(2);

      const counters = await readCounters(page);
      expect(counters.restoreFailures).toBe(0);
      expect(counters.vetoes).toBe(0);
    } finally {
      await app.close();
    }
  });
});

test.describe("a protected block survives a morph that would otherwise replace it", () => {
  test("veto flavor: the frame-level event fires on an element CONTAINING the block", async ({ page }) => {
    // The turbo-frame flavor replaces the frame's children wholesale and fires
    // the cancelable event on the FRAME. A veto written only against "is el the
    // protected block, or inside it" never fires here, and layer two silently
    // does nothing. This test is that direction.
    const server = await openHarnessFixture(page, { layers: [LAYER.VETO], flavor: "turbo-frame" });
    try {
      await page.evaluate(function (sel) {
        return window.__lahe.enterEdit(sel);
      }, HARNESS_REGION);
      await placeCaret(page, { selector: HARNESS_REGION, offset: 5 });
      await page.keyboard.type("KEPT", { delay: 20 });

      const before = await page.evaluate(function (sel) {
        return document.querySelector(sel).textContent;
      }, HARNESS_REGION);
      await tagNode(page, HARNESS_REGION, "veto-block");

      await forceRepaints(page, 5);

      const after = await nodeStillIdentical(page, HARNESS_REGION, "veto-block");
      expect(after.identical).toBe(true);
      expect(after.connected).toBe(true);
      expect(after.text).toBe(before);

      const counters = await readCounters(page);
      expect(counters.vetoes).toBeGreaterThanOrEqual(5);
    } finally {
      await server.close();
    }
  });

  test("no-hook flavor: the block is destroyed and comes back with the reviewer's words", async ({ page }) => {
    const server = await openHarnessFixture(page, {
      layers: [LAYER.SNAPSHOT_RESTORE],
      query: "?repaint=no-hook",
      hooks: "off"
    });
    try {
      await page.evaluate(function (sel) {
        return window.__lahe.enterEdit(sel);
      }, HARNESS_REGION);
      await placeCaret(page, { selector: HARNESS_REGION, offset: 5 });
      await page.keyboard.type("KEPT", { delay: 20 });

      const before = await page.evaluate(function (sel) {
        return document.querySelector(sel).textContent;
      }, HARNESS_REGION);
      expect(before).toContain("KEPT");
      await tagNode(page, HARNESS_REGION, "restore-block");

      await forceRepaints(page, 5);
      await page.waitForFunction(
        function (args) {
          const el = document.querySelector(args[0]);
          return !!el && el.textContent === args[1];
        },
        [HARNESS_REGION, before]
      );

      // The node itself did NOT survive, and that is the point of this flavor.
      const identity = await nodeStillIdentical(page, HARNESS_REGION, "restore-block");
      expect(identity.identical).toBe(false);
      expect(identity.text).toBe(before);

      // The block is still the reviewer's: editable, protected, and typeable.
      const state = await page.evaluate(function (sel) {
        const el = document.querySelector(sel);
        return {
          editable: el.getAttribute("contenteditable"),
          protected: window.LAHE.protect.isProtected(el),
          focused: document.activeElement === el
        };
      }, HARNESS_REGION);
      expect(state.editable).toBe("true");
      expect(state.protected).toBe(true);
      expect(state.focused).toBe(true);

      // Typing after the restore lands in the block rather than nowhere, which
      // is the failure a restore that only puts text back produces.
      await page.keyboard.type("MORE", { delay: 20 });
      const typed = await page.evaluate(function (sel) {
        return document.querySelector(sel).textContent;
      }, HARNESS_REGION);
      expect(typed).toContain("MORE");
    } finally {
      await server.close();
    }
  });
});

test.describe("the commit seam", () => {
  test("release lifts every layer's mark and runs a replay pass immediately", async ({ page }) => {
    const server = await openHarnessFixture(page, { layers: null });
    try {
      await page.evaluate(function (sel) {
        return window.__lahe.enterEdit(sel);
      }, HARNESS_REGION);

      const marked = await page.evaluate(function (sel) {
        const el = document.querySelector(sel);
        return {
          skip: el.getAttribute("data-lahe-permanent"),
          turbo: el.getAttribute("data-turbo-permanent"),
          app: el.getAttribute("data-app-permanent"),
          protectedAttr: el.hasAttribute("data-lahe-protected"),
          isProtected: window.LAHE.protect.isProtected(el)
        };
      }, HARNESS_REGION);
      expect(marked.skip).toBe("");
      expect(marked.turbo).toBe("");
      expect(marked.app).toBe("");
      expect(marked.protectedAttr).toBe(true);
      expect(marked.isProtected).toBe(true);

      // Type something, so the block genuinely differs from what the page
      // believes and the revert after the commit is observable.
      await placeCaret(page, { selector: HARNESS_REGION, offset: 5 });
      await page.keyboard.type("ZZZ", { delay: 20 });

      const before = await readCounters(page);
      await page.evaluate(function (sel) {
        return window.__lahe.commitEdit(sel);
      }, HARNESS_REGION);
      const after = await readCounters(page);

      // Protection lifts and replay's pass runs immediately, so a change the
      // page tried to make while the block was protected surfaces through
      // replay rather than being silently swallowed. 2C owns the branch; 2B
      // owns the call.
      expect(after.replayPasses).toBeGreaterThan(before.replayPasses);

      const lifted = await page.evaluate(function (sel) {
        const el = document.querySelector(sel);
        return {
          skip: el.hasAttribute("data-lahe-permanent"),
          protectedAttr: el.hasAttribute("data-lahe-protected"),
          isProtected: window.LAHE.protect.isProtected(el)
        };
      }, HARNESS_REGION);
      expect(lifted.skip).toBe(false);
      expect(lifted.protectedAttr).toBe(false);
      expect(lifted.isProtected).toBe(false);

      // Once protection has lifted the page gets its block back: the repaint
      // reverts it, which is what makes the protected runs above meaningful.
      await forceRepaint(page);
      const reverted = await page.evaluate(function (sel) {
        return document.querySelector(sel).textContent;
      }, HARNESS_REGION);
      expect(reverted).not.toContain("ZZZ");
    } finally {
      await server.close();
    }
  });
});
