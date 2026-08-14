// 1D: comments, element-pick, the untethered note, and the highlights that do
// not change the page.
//
// Owner: 1D. Ranked test 18 is the last test in this file, and it is the reason
// the file exists:
//
//   "The page renders identically with and without the library: screenshot diff
//    at two widths with the rail open and collapsed, zero diff outside the
//    rail's bounds, scrollHeight and every block rect identical, and the ONLY
//    page-level addition is the one marked highlight stylesheet. Positive
//    control in the same test: the rail exists, a highlight is painted, a
//    record exists."
//
// The positive control is not a separate test on purpose. A page with no
// library on it renders identically to itself at any width, so the negative
// half alone passes when the library is absent, broken, or never booted. Both
// halves run against the SAME two pages in the SAME test, so the only way to
// pass is for the library to be really there and really painting.
//
// Why two pages rather than one page measured before and after: a teardown that
// forgets one node would make the "after" measurement lie in the library's
// favour. Two independent loads of the same URL, one with the library and one
// without, cannot be fooled that way.

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
      return (
        "/* ---- " + entry.path + " ---- */\n" +
        fs.readFileSync(path.join(REPO_ROOT, entry.path), "utf8")
      );
    })
    .join("\n");
}

const BUNDLE = layerBundle();

// Boots the comment surface on a page that has none. Returns nothing; every
// assertion reads the page back afterwards.
async function bootLayer(page, options = {}) {
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(function (opts) {
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
  }, { reviewId: options.reviewId || "rev_1d" });
}

function itemsIn(page) {
  return page.evaluate(function () {
    return window.LAHE.store.shared.read(window.__lahe.reviewId);
  });
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

// Every painted range, by highlight name, as the browser's own registry sees
// it. Nothing here reads the library's bookkeeping: the assertion is about what
// the browser will paint.
function paintedHighlights(page) {
  return page.evaluate(function () {
    var out = [];
    if (typeof CSS === "undefined" || !CSS.highlights) return out;
    CSS.highlights.forEach(function (highlight, name) {
      out.push({ name: name, ranges: highlight.size });
    });
    return out;
  });
}

// Every element the page itself owns, with its box.
//
// The ONLY thing excluded is the library's one shadow host, excluded BY ID
// rather than by marker. Excluding by marker would be a hole the size of this
// whole test: a wrapper element the library inserted inside reviewed content
// carries a marker too, so a marker-based filter hides exactly the failure the
// test exists to catch. It was caught that way, by the deliberate revert.
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

// Every stylesheet in the page's own document, plus whether it is the library's
// marked highlight sheet and what it contains.
function pageStylesheets(page) {
  return page.evaluate(function () {
    var out = [];
    for (var i = 0; i < document.styleSheets.length; i += 1) {
      var sheet = document.styleSheets[i];
      var owner = sheet.ownerNode;
      var rules = [];
      try {
        for (var j = 0; j < sheet.cssRules.length; j += 1) rules.push(sheet.cssRules[j].cssText);
      } catch (err) {
        rules.push("[unreadable] " + err.message);
      }
      out.push({
        marked: !!(owner && owner.getAttribute && owner.getAttribute("data-lahe-highlight") !== null),
        tool: !!(owner && owner.getAttribute && owner.getAttribute("data-lahe") !== null),
        rules: rules
      });
    }
    return {
      sheets: out,
      adopted: (document.adoptedStyleSheets || []).length
    };
  });
}

test.describe("1D: comments, gestures, and highlights", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ label: "1d-fixtures" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test("a comment on a selected passage mints a record with its anchor and paints a highlight", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await selectElementText(page, "#reset-intro");
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");

    // The box opens ALREADY FOCUSED on that passage, so the reviewer types
    // without reaching for the mouse.
    const focused = await page.evaluate(function () {
      var box = window.__lahe.comments.focusedBox();
      return box ? box.item.context.quote : null;
    });
    expect(focused).toContain("resets list markers away");

    await page.keyboard.type("this says the opposite of the heading");
    await page.keyboard.press("ControlOrMeta+Enter");

    const items = await itemsIn(page);
    expect(items).toHaveLength(1);
    const item = items[0];
    expect(item.kind).toBe("comment");
    expect(item.state).toBe("ready");
    expect(item.note).toBe("this says the opposite of the heading");
    // The anchor fields: the quote the reviewer selected, and a minted region
    // reference with a probe. Both are what an agent uses to find the place.
    expect(item.context.quote).toContain("resets list markers away");
    expect(item.region.ref).toBeTruthy();
    expect(item.region.ref.probe).toContain("resets list markers away");
    expect(item.page_origin).toBe(server.origin);

    const painted = await paintedHighlights(page);
    expect(painted.length).toBeGreaterThan(0);
    expect(painted.some((h) => h.name.indexOf("lahe-") === 0 && h.ranges > 0)).toBe(true);

    // No wrapper elements, ever. The highlighted paragraph still holds exactly
    // the nodes the page shipped.
    const wrappers = await page.evaluate(function () {
      return document.querySelectorAll("#reset-intro *").length;
    });
    expect(wrappers).toBe(0);
  });

  test("element-pick and the untethered note each mint their own kind", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    // Nothing selected: Cmd-Shift-C enters element-pick mode, hovering outlines
    // the element under the pointer, and a click comments on the whole thing.
    await page.evaluate(function () {
      window.getSelection().removeAllRanges();
    });
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    expect(await page.evaluate(() => window.__lahe.comments.pickMode().active)).toBe(true);

    const box = await page.locator("#reset-item-2").boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const outlined = await page.evaluate(function () {
      return window.__lahe.comments.pickMode().outlining;
    });
    expect(outlined).toBe("reset-item-2");

    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    expect(await page.evaluate(() => window.__lahe.comments.pickMode().active)).toBe(false);
    await page.keyboard.type("this item needs a marker");

    // The untethered note at the foot of the thread, tied to nothing.
    await page.evaluate(function () {
      window.__lahe.tab.focusNote();
    });
    await page.keyboard.type("the whole page reads cold");

    const items = await itemsIn(page);
    const kinds = items.map((i) => i.kind).sort();
    expect(kinds).toEqual(["comment", "note"]);

    const element = items.filter((i) => i.kind === "comment")[0];
    expect(element.note).toBe("this item needs a marker");
    expect(element.context.element).toBe("LI");
    expect(element.context.quote).toContain("Second item");

    const note = items.filter((i) => i.kind === "note")[0];
    expect(note.note).toBe("the whole page reads cold");
    expect(note.context.quote).toBe(null);
    expect(note.region.ref).toBe(null);

    // Esc cancels picking without minting anything.
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    expect(await page.evaluate(() => window.__lahe.comments.pickMode().active)).toBe(true);
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => window.__lahe.comments.pickMode().active)).toBe(false);
    expect((await itemsIn(page)).length).toBe(items.length);
  });

  test("rewording bumps the revision and the reviewer's own delete removes the item", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await selectElementText(page, "#reset-scratch");
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");
    await page.keyboard.type("say this instead");
    await page.keyboard.press("ControlOrMeta+Enter");

    let items = await itemsIn(page);
    expect(items[0].rev).toBe(1);
    const id = items[0].id;

    // A rewording SESSION is one revision: the keystrokes move the words, the
    // commit moves rev (R21). Typing in halves here so the "once" is a real
    // claim rather than an artefact of a single call.
    await page.evaluate(function (itemId) {
      const box = window.__lahe.comments.reopen(itemId);
      box.type("no, say ");
      box.type("no, say this instead");
    }, id);
    items = await itemsIn(page);
    expect(items[0].rev, "typing a reword does not bump rev").toBe(1);
    expect(items[0].note).toBe("no, say this instead");

    await page.evaluate(function (itemId) {
      window.__lahe.comments.reopen(itemId).close();
    }, id);
    items = await itemsIn(page);
    expect(items[0].rev, "the commit bumps it, once").toBe(2);
    expect(items[0].note).toBe("no, say this instead");

    // Deleting takes its highlight with it.
    await page.evaluate(function (itemId) {
      window.__lahe.comments.remove(itemId);
    }, id);
    expect(await itemsIn(page)).toHaveLength(0);
    const painted = await paintedHighlights(page);
    expect(painted.every((h) => h.ranges === 0)).toBe(true);
  });

  test("every gesture appears as a readable hint line on the rail", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    const shown = await page.evaluate(function () {
      return window.__lahe.tab.hintText();
    });
    const expected = await page.evaluate(function () {
      return window.LAHE.gestures.hintLines();
    });
    expect(expected.length).toBeGreaterThan(0);
    expected.forEach(function (line) {
      expect(shown).toContain(line.keys);
      expect(shown).toContain(line.hint);
    });
    // Ken's copy, exactly.
    expect(shown).toContain("Cmd-Enter when done with this comment");
  });

  // ---------------------------------------------------------------------------
  // Ranked test 18
  // ---------------------------------------------------------------------------

  const WIDTHS = [1280, 900];

  for (const width of WIDTHS) {
    for (const collapsed of [false, true]) {
      const railState = collapsed ? "collapsed" : "open";

      test(`the page renders identically with and without the library at ${width}px, rail ${railState}`, async ({ browser }) => {
        const viewport = { width: width, height: 800 };
        const bare = await browser.newContext({ viewport: viewport });
        const withLayer = await browser.newContext({ viewport: viewport });
        const barePage = await bare.newPage();
        const layerPage = await withLayer.newPage();

        try {
          await barePage.goto(server.urlFor(FIXTURE));
          await layerPage.goto(server.urlFor(FIXTURE));
          await bootLayer(layerPage);

          // A comment, so the library is doing its actual job during the
          // comparison rather than sitting inert.
          await selectElementText(layerPage, "#reset-intro");
          await layerPage.keyboard.press("ControlOrMeta+Shift+KeyC");
          await layerPage.keyboard.type("the tone here is off");
          await layerPage.keyboard.press("ControlOrMeta+Enter");
          await layerPage.evaluate(function (isCollapsed) {
            window.__lahe.comments.closeAll();
            window.__lahe.tab.collapse(isCollapsed);
          }, collapsed);

          // --- the positive control, in this same test ------------------------
          const control = await layerPage.evaluate(function () {
            var painted = 0;
            if (typeof CSS !== "undefined" && CSS.highlights) {
              CSS.highlights.forEach(function (h) {
                painted += h.size;
              });
            }
            // The rail lives in the library's one closed shadow root, so the
            // page cannot query it and neither can this test. Both halves are
            // asserted: the page-level host element exists, and the library's
            // own API says the rail occupies real space.
            var host = document.getElementById(window.LAHE.highlight.SURFACE_ID);
            return {
              rail: !!host && window.__lahe.tab.bounds().width > 0,
              painted: painted,
              records: window.LAHE.store.shared.read(window.__lahe.reviewId).length
            };
          });
          expect(control.rail, "the rail exists").toBe(true);
          expect(control.painted, "a highlight is painted").toBeGreaterThan(0);
          expect(control.records, "a record exists").toBeGreaterThan(0);

          // --- layout ---------------------------------------------------------
          const bareGeometry = await pageGeometry(barePage);
          const layerGeometry = await pageGeometry(layerPage);
          expect(layerGeometry.scrollHeight).toBe(bareGeometry.scrollHeight);
          expect(layerGeometry.blocks).toEqual(bareGeometry.blocks);

          // --- nothing of the library's is inside reviewed content --------------
          // No wrapper elements, ever. Stated as its own assertion rather than
          // left to the geometry, because a wrapper that happens not to move
          // anything would otherwise pass.
          const intruders = await layerPage.evaluate(function () {
            var out = [];
            var marked = document.querySelectorAll("[data-lahe]");
            for (var i = 0; i < marked.length; i += 1) {
              var el = marked[i];
              // The two page-level things the library is allowed: the marked
              // highlight stylesheet, and the one shadow host.
              if (el.id === "lahe-surface-root") continue;
              if (el.getAttribute("data-lahe-highlight") !== null) continue;
              out.push(el.tagName + (el.id ? "#" + el.id : ""));
            }
            return out;
          });
          expect(intruders, "the library put nothing inside the page").toEqual([]);

          // --- the one page-level addition -------------------------------------
          const bareSheets = await pageStylesheets(barePage);
          const layerSheets = await pageStylesheets(layerPage);
          expect(layerSheets.adopted).toBe(bareSheets.adopted);
          expect(layerSheets.sheets.length).toBe(bareSheets.sheets.length + 1);
          const added = layerSheets.sheets.filter((s) => s.tool);
          expect(added).toHaveLength(1);
          expect(added[0].marked).toBe(true);
          added[0].rules.forEach(function (rule) {
            expect(rule).toMatch(/^::highlight\(lahe-/);
          });

          // --- pixels -----------------------------------------------------------
          // Clipped to everything left of the rail, with the commented
          // paragraph masked, because D8 allows exactly two visible additions:
          // painted highlights and the fixed rail.
          const railLeft = await layerPage.evaluate(function () {
            return Math.floor(window.__lahe.tab.bounds().left);
          });
          expect(railLeft).toBeGreaterThan(0);
          expect(railLeft).toBeLessThan(width);

          const clip = { x: 0, y: 0, width: railLeft, height: viewport.height };
          const mask = [barePage.locator("#reset-intro")];
          const bareShot = await barePage.screenshot({ clip: clip, mask: mask });
          const layerShot = await layerPage.screenshot({
            clip: clip,
            mask: [layerPage.locator("#reset-intro")]
          });
          expect(Buffer.compare(bareShot, layerShot), "zero diff outside the rail's bounds").toBe(0);
        } finally {
          await bare.close();
          await withLayer.close();
        }
      });
    }
  }
});
