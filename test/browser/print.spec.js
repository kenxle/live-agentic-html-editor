// Print: the reviewed page prints as the document, not as the document plus
// the review tool.
//
// Owner: this task (unit/print-clean). Everything the library ever draws is a
// descendant of the one shadow host at markers.OVERLAY_ROOT_ID (the rail, a
// comment box, the pick-mode outline, every chip and badge): see comments.js
// and editing.js, which both mount into highlight.js's one surface() rather
// than creating hosts of their own. So the print rule that hides it is one
// `:host{display:none}` rule inside that host's own closed shadow root
// (highlight.js's PRINT_HOST_STYLE_TEXT), and this file is what proves it
// actually hides the whole tree rather than just the rail, and that hiding it
// does not move the page underneath.
//
// The painted highlights are a second, separate case: they live in the page's
// own document (the CSS Custom Highlight API forces that, see highlight.js),
// not inside the shadow host, so they need their own print rule
// (STYLE_TEXT's `@media not print` wrapper). This file's second test is the
// browser proof for that: the wash is really painted on screen, and really
// gone under print, in the exact same passage.

const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("../helpers");
const { startStaticServer } = require("../helpers/servers");
const manifest = require("../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "css-reset.html";

// The bundle, concatenated in the manifest's order, in memory. Builders never
// commit dist/, and a test that read dist/ would be testing whoever last ran
// the build script rather than the source in this worktree.
function layerBundle() {
  return manifest
    .builtFiles()
    .map(function (entry) {
      return "/* ---- " + entry.path + " ---- */\n" + fs.readFileSync(path.join(REPO_ROOT, entry.path), "utf8");
    })
    .join("\n");
}

const BUNDLE = layerBundle();

async function bootLayer(page, options = {}) {
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(
    function (opts) {
      var LAHE = window.LAHE;
      var page = LAHE.record.pageFrom({
        origin: location.origin,
        pathname: location.pathname,
        href: location.href,
        title: document.title
      });
      var comments = LAHE.comments.createComments({ reviewId: opts.reviewId, page: page });
      comments.bind();
      var tab = LAHE.tabActive.createActiveTab({ comments: comments });
      tab.mount();
      window.__lahe = { comments: comments, tab: tab, page: page, reviewId: opts.reviewId };
    },
    { reviewId: options.reviewId || "rev_print" }
  );
}

// Selects the whole text of one element, the way a reviewer's drag does.
async function selectElementText(page, selector) {
  await page.evaluate(function (sel) {
    var el = document.querySelector(sel);
    var range = document.createRange();
    range.selectNodeContents(el);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, selector);
}

// A comment, ready and painted, the same gesture a reviewer uses: select,
// Cmd-Shift-C, type, Cmd-Enter.
async function commentOn(page, selector, note) {
  await selectElementText(page, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await page.keyboard.type(note);
  await page.keyboard.press("ControlOrMeta+Enter");
}

// Every element the page itself owns, with its box. The library's one shadow
// host is excluded BY ID, not by marker: a marker-based filter would hide the
// very failure this file exists to catch (something the library drew shifting
// the page), the same reasoning ranked test 18 in comments_highlights.spec.js
// uses for the identical helper.
function pageGeometry(page) {
  return page.evaluate(function () {
    var out = { scrollHeight: document.documentElement.scrollHeight, blocks: [] };
    var all = document.body.querySelectorAll("*");
    for (var i = 0; i < all.length; i += 1) {
      var el = all[i];
      if (el.id === "lahe-surface-root" || (el.closest && el.closest("#lahe-surface-root"))) continue;
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
      var r = el.getBoundingClientRect();
      out.blocks.push({
        tag: el.tagName,
        id: el.id || null,
        x: Math.round(r.x * 100) / 100,
        y: Math.round(r.y * 100) / 100,
        w: Math.round(r.width * 100) / 100,
        h: Math.round(r.height * 100) / 100
      });
    }
    return out;
  });
}

test.describe("print: a reviewed page prints as the document, not the document plus the tool", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ label: "print-fixtures" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test("the rail and an open comment box are in the host print hides, on screen the page is untouched, and under print the host and the page's layout both hold", async ({
    browser
  }) => {
    const viewport = { width: 1280, height: 900 };
    const bare = await browser.newContext({ viewport: viewport });
    const withLayer = await browser.newContext({ viewport: viewport });
    const barePage = await bare.newPage();
    const layerPage = await withLayer.newPage();

    try {
      await barePage.goto(server.urlFor(FIXTURE));
      await layerPage.goto(server.urlFor(FIXTURE));
      await bootLayer(layerPage);
      await commentOn(layerPage, "#reset-intro", "the tone here is off");

      // --- screen: the library is really there, not a no-op ------------------
      const onScreen = await layerPage.evaluate(function () {
        var painted = 0;
        if (typeof CSS !== "undefined" && CSS.highlights) {
          CSS.highlights.forEach(function (h) {
            painted += h.size;
          });
        }
        var host = document.getElementById(window.LAHE.highlight.SURFACE_ID);
        return {
          display: host && window.getComputedStyle(host).display,
          railWidth: window.__lahe.tab.bounds().width,
          painted: painted,
          boxesOpen: window.__lahe.comments.openBoxes().length
        };
      });
      expect(onScreen.display, "the surface has a box on screen").not.toBe("none");
      expect(onScreen.railWidth, "the rail occupies space on screen").toBeGreaterThan(0);
      expect(onScreen.painted, "a highlight is painted on screen").toBeGreaterThan(0);
      expect(onScreen.boxesOpen, "the comment box is open on screen").toBeGreaterThan(0);

      const screenBare = await pageGeometry(barePage);
      const screenLayer = await pageGeometry(layerPage);
      expect(screenLayer, "screen: the page's own layout is exactly the bare page's").toEqual(screenBare);

      // --- print: one host, hidden, and the page under it does not move ------
      await barePage.emulateMedia({ media: "print" });
      await layerPage.emulateMedia({ media: "print" });

      const inPrint = await layerPage.evaluate(function () {
        var host = document.getElementById(window.LAHE.highlight.SURFACE_ID);
        var r = host.getBoundingClientRect();
        return {
          display: window.getComputedStyle(host).display,
          width: r.width,
          height: r.height
        };
      });
      // Not tab.bounds(): it pads a zero rect out by the rail's box-shadow
      // reach on purpose (see tab_active.js), so it is not zero even when the
      // rail underneath renders nothing. The host's own rect is the honest
      // reading of "this element has no box at all".
      expect(inPrint.display, "the surface is display:none under print").toBe("none");
      expect(inPrint.width, "the host itself has no box under print").toBe(0);
      expect(inPrint.height).toBe(0);

      const printBare = await pageGeometry(barePage);
      const printLayer = await pageGeometry(layerPage);
      expect(printLayer, "print: the page's own layout is still exactly the bare page's").toEqual(printBare);
    } finally {
      await bare.close();
      await withLayer.close();
    }
  });

  test("a painted highlight visibly washes the passage on screen, and is gone from the same pixels under print", async ({
    browser
  }) => {
    const viewport = { width: 1280, height: 900 };
    const bare = await browser.newContext({ viewport: viewport });
    const withLayer = await browser.newContext({ viewport: viewport });
    const barePage = await bare.newPage();
    const layerPage = await withLayer.newPage();

    try {
      await barePage.goto(server.urlFor(FIXTURE));
      await layerPage.goto(server.urlFor(FIXTURE));
      await bootLayer(layerPage);
      await commentOn(layerPage, "#reset-intro", "the tone here is off");
      // The box itself is chrome and already covered by the first test; this
      // one is about the page-level wash, so the box is closed and only the
      // painted range is left to differ.
      await layerPage.evaluate(function () {
        window.__lahe.comments.closeAll();
      });

      // Clipped to everything left of the rail, the same defensive crop
      // ranked test 18 uses, so nothing the rail itself draws can land in
      // either screenshot and be mistaken for the highlight's effect.
      const railLeft = await layerPage.evaluate(function () {
        return Math.floor(window.__lahe.tab.bounds().left);
      });
      const clip = { x: 0, y: 0, width: railLeft, height: viewport.height };

      const screenBare = await barePage.screenshot({ clip: clip });
      const screenLayer = await layerPage.screenshot({ clip: clip });
      expect(
        Buffer.compare(screenBare, screenLayer),
        "on screen, the painted passage is not pixel-identical to the bare page"
      ).not.toBe(0);

      await barePage.emulateMedia({ media: "print" });
      await layerPage.emulateMedia({ media: "print" });

      const printBare = await barePage.screenshot({ clip: clip });
      const printLayer = await layerPage.screenshot({ clip: clip });
      expect(
        Buffer.compare(printBare, printLayer),
        "under print, the same passage is pixel-identical to the bare page: no wash reaches the printed page"
      ).toBe(0);
    } finally {
      await bare.close();
      await withLayer.close();
    }
  });
});
