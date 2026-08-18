// The selection popover: the pill that appears when a reviewer finishes
// selecting text on the page.
//
// Ken's words, from real use: "when i highlight things, i no longer get the
// button popup with the comment button. that was actually nice." The hotkeys
// stay exactly as they are. This is the affordance ON TOP of them, so a reviewer
// who has never read a hint line can still comment on a passage, and can learn
// the keystroke from the tooltip while they do it.
//
// What every test here asserts is the OUTCOME of a REAL gesture, never the
// presence of a node. A pill that renders and does nothing is the failure this
// file exists to catch, so the Comment test types a comment and reads the record
// back, and the Edit test asks the editing surface whether the block is really
// in edit state.
//
// The pill lives in the library's own closed shadow surface, so a selector
// cannot reach it. Both honest ways in are used: the library's own report of
// where the buttons are (comments.selectionPopover()), and a real mouse click at
// that on-screen geometry, which is what a hand does.

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("../helpers");
const { startStaticServer } = require("../helpers/servers");
const { pollPage, pollUntil } = require("../helpers/poll");
const { startService, readEventLog, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");
const manifest = require("../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "css-reset.html";

// The bundle, concatenated in the manifest's order, in memory. Builders never
// commit dist/, and a test that read dist/ would be testing whoever last ran the
// build script rather than the source in this worktree.
function layerBundle() {
  return manifest
    .builtFiles()
    .map(function (entry) {
      return "/* ---- " + entry.path + " ---- */\n" + fs.readFileSync(path.join(REPO_ROOT, entry.path), "utf8");
    })
    .join("\n");
}

const BUNDLE = layerBundle();

// Boots the comment surface AND the editing surface, because the pill's two
// buttons reach one each and a harness with only half of that would let the Edit
// button pass by doing nothing.
async function bootLayer(page, options = {}) {
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(function (opts) {
    var LAHE = window.LAHE;
    var pageRec = LAHE.record.pageFrom({
      origin: location.origin,
      pathname: location.pathname,
      href: location.href,
      title: document.title
    });
    var comments = LAHE.comments.createComments({ reviewId: opts.reviewId, page: pageRec });
    comments.bind();
    var editing = LAHE.editing.createEditing({ reviewId: opts.reviewId, page: pageRec });
    editing.bind();
    var tab = LAHE.tabActive.createActiveTab({ comments: comments });
    tab.mount();
    window.__lahe = {
      comments: comments,
      editing: editing,
      tab: tab,
      page: pageRec,
      reviewId: opts.reviewId
    };
  }, { reviewId: options.reviewId || "rev_popover" });
}

function itemsIn(page) {
  return page.evaluate(function () {
    return window.LAHE.store.shared.read(window.__lahe.reviewId);
  });
}

// A partial selection inside one paragraph, the way a reviewer's drag makes one:
// it starts and ends mid-paragraph, so "near the end of the selection" is a real
// claim rather than the paragraph's own box restated.
async function selectWords(page, selector, start, end) {
  await page.evaluate(function (args) {
    var el = document.querySelector(args.selector);
    var node = el.firstChild;
    var range = document.createRange();
    range.setStart(node, args.start);
    range.setEnd(node, args.end);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, { selector: selector, start: start, end: end });
}

function popoverState(page) {
  return page.evaluate(function () {
    return window.__lahe.comments.selectionPopover();
  });
}

// The pill is debounced, so every wait for it is a poll rather than a sleep.
function waitForPill(page) {
  return pollPage(page, () => window.__lahe.comments.selectionPopover().visible === true, undefined, {
    message: "the selection pill to appear after the selection settled"
  });
}

function waitForNoPill(page) {
  return pollPage(page, () => window.__lahe.comments.selectionPopover().visible === false, undefined, {
    message: "the selection pill to go away"
  });
}

function buttonOf(state, action) {
  return state.buttons.filter(function (b) {
    return b.action === action;
  })[0];
}

async function clickButton(page, action) {
  const state = await popoverState(page);
  const button = buttonOf(state, action);
  expect(button, "the " + action + " button is on screen").toBeTruthy();
  await page.mouse.click(button.rect.x + button.rect.width / 2, button.rect.y + button.rect.height / 2);
}

// The range's own rectangle, read from the page, so placement is checked against
// the reviewer's selection rather than against the library's memory of it.
function selectionRect(page) {
  return page.evaluate(function () {
    var r = window.getSelection().getRangeAt(0).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, top: r.top, bottom: r.bottom, right: r.right };
  });
}

test.describe("the selection popover", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ label: "popover-fixtures" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test("finishing a selection shows a pill with Comment and Edit at the selection", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    // Nothing selected, nothing shown. The pill is not a permanent piece of
    // furniture on the page.
    expect((await popoverState(page)).visible).toBe(false);

    await selectWords(page, "#reset-intro", 5, 60);
    await waitForPill(page);

    const state = await popoverState(page);
    expect(state.buttons.map((b) => b.action)).toEqual(["comment", "edit"]);
    expect(state.buttons.map((b) => b.label)).toEqual(["Comment", "Edit"]);
    expect(state.rect.width, "the pill has real width").toBeGreaterThan(0);
    expect(state.rect.height, "the pill has real height").toBeGreaterThan(0);

    // Near the end of the selection, above or below it, and never on top of the
    // words the reviewer just chose.
    const sel = await selectionRect(page);
    const gap =
      state.placement === "above" ? sel.top - (state.rect.y + state.rect.height) : state.rect.y - sel.bottom;
    expect(["above", "below"]).toContain(state.placement);
    expect(gap, "the pill clears the selected line").toBeGreaterThanOrEqual(0);
    expect(gap, "and it stays next to it").toBeLessThan(24);
    const pillCentre = state.rect.x + state.rect.width / 2;
    expect(Math.abs(pillCentre - sel.right), "it sits by the END of the selection").toBeLessThan(
      state.rect.width
    );

    // The keystroke is on the button, in the rail's keycap register, and it is
    // the one this platform really uses.
    const keys = await page.evaluate(function () {
      return window.LAHE.comments.POPOVER_KEYS;
    });
    expect(buttonOf(state, "comment").keys).toEqual(keys.comment);
    expect(buttonOf(state, "edit").keys).toEqual(keys.edit);
    expect(keys.comment[keys.comment.length - 1]).toBe("C");
    expect(keys.edit[keys.edit.length - 1]).toBe("E");

    // The tooltip is hover-revealed, not permanent chrome.
    expect(state.tooltip.visible, "no tooltip before a hover").toBe(false);
    const commentBtn = buttonOf(state, "comment");
    await page.mouse.move(
      commentBtn.rect.x + commentBtn.rect.width / 2,
      commentBtn.rect.y + commentBtn.rect.height / 2
    );
    await pollPage(page, () => window.__lahe.comments.selectionPopover().tooltip.visible === true, undefined, {
      message: "the tooltip to appear on hover"
    });
    const hovered = await popoverState(page);
    expect(hovered.tooltip.for).toBe("comment");
    expect(hovered.tooltip.keys).toEqual(keys.comment);
  });

  test("a real click on Comment opens the box on that passage and Cmd-Enter lands a ready record", async ({
    page
  }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await selectWords(page, "#reset-intro", 5, 60);
    await waitForPill(page);

    await clickButton(page, "comment");

    // The box is open, focused, and holds THAT passage: the click did not
    // collapse the selection out from under the gesture.
    await pollPage(
      page,
      () => {
        var box = window.__lahe.comments.focusedBox();
        return !!(box && box.item.context.quote);
      },
      undefined,
      { message: "the comment box to open focused on the selected passage" }
    );
    const quote = await page.evaluate(function () {
      return window.__lahe.comments.focusedBox().item.context.quote;
    });
    expect(quote).toContain("resets list markers away");

    await page.keyboard.type("this sentence buries the point");
    await page.keyboard.press("ControlOrMeta+Enter");

    const items = await itemsIn(page);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("comment");
    expect(items[0].state).toBe("ready");
    expect(items[0].note).toBe("this sentence buries the point");
    expect(items[0].context.quote).toContain("resets list markers away");
    expect(items[0].region.ref, "the passage is anchored").toBeTruthy();

    // And the pill is gone: a box is open, so the offer to open one is stale.
    expect((await popoverState(page)).visible).toBe(false);
  });

  test("a real click on Edit puts the block holding the selection into edit state", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await selectWords(page, "#reset-scratch", 4, 30);
    await waitForPill(page);

    await clickButton(page, "edit");

    await pollPage(page, () => window.__lahe.editing.state().open === true, undefined, {
      message: "the Edit button to put the block into edit state"
    });

    const editable = await page.evaluate(function () {
      return document.querySelector("#reset-scratch").getAttribute("contenteditable");
    });
    expect(editable, "the block holding the selection is the one being edited").toBe("true");

    // Only that block.
    const others = await page.evaluate(function () {
      return document.querySelectorAll("[contenteditable='true']").length;
    });
    expect(others).toBe(1);

    expect((await popoverState(page)).visible, "the pill is gone once editing starts").toBe(false);
  });

  test("collapsing the selection hides the pill", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await selectWords(page, "#reset-intro", 5, 60);
    await waitForPill(page);

    await page.evaluate(function () {
      window.getSelection().removeAllRanges();
    });
    await waitForNoPill(page);

    // And Esc dismisses a pill over a selection the reviewer keeps.
    await selectWords(page, "#reset-intro", 5, 60);
    await waitForPill(page);
    await page.keyboard.press("Escape");
    await waitForNoPill(page);
    expect(await page.evaluate(() => window.getSelection().isCollapsed), "the selection survives Esc").toBe(
      false
    );
  });

  test("with nothing selected the page renders identically with and without the library", async ({
    browser
  }) => {
    // Ranked test 18's law, re-run for this feature: the pill is additive UI in
    // the library's own surface, so a page with no selection is byte-identical
    // to the same page without the library. Same shape as
    // comments_highlights.spec.js, not a weakened version of it.
    const viewport = { width: 1280, height: 800 };
    const bare = await browser.newContext({ viewport: viewport });
    const withLayer = await browser.newContext({ viewport: viewport });
    const barePage = await bare.newPage();
    const layerPage = await withLayer.newPage();

    try {
      await barePage.goto(server.urlFor(FIXTURE));
      await layerPage.goto(server.urlFor(FIXTURE));
      await bootLayer(layerPage);

      // The pill really works on this page, so the comparison is not passing
      // because the feature is absent or dead.
      await selectWords(layerPage, "#reset-intro", 5, 60);
      await waitForPill(layerPage);
      const shown = await popoverState(layerPage);
      expect(shown.visible, "the pill really appeared on this page").toBe(true);

      // Then the reviewer does what a reviewer does: they click away.
      await layerPage.evaluate(function () {
        window.getSelection().removeAllRanges();
      });
      await waitForNoPill(layerPage);

      const geometryOf = (p) =>
        p.evaluate(function () {
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

      const bareGeometry = await geometryOf(barePage);
      const layerGeometry = await geometryOf(layerPage);
      expect(layerGeometry.scrollHeight).toBe(bareGeometry.scrollHeight);
      expect(layerGeometry.blocks).toEqual(bareGeometry.blocks);

      // The library put nothing inside the page: the pill is in the surface,
      // like every other thing this library draws.
      const intruders = await layerPage.evaluate(function () {
        var out = [];
        var marked = document.querySelectorAll("[data-lahe]");
        for (var i = 0; i < marked.length; i += 1) {
          var el = marked[i];
          if (el.id === "lahe-surface-root") continue;
          if (el.getAttribute("data-lahe-highlight") !== null) continue;
          out.push(el.tagName + (el.id ? "#" + el.id : ""));
        }
        return out;
      });
      expect(intruders, "the library put nothing inside the page").toEqual([]);

      // Clipped to everything left of the rail, exactly as ranked test 18 does
      // it: D8 allows the rail as a visible addition and allows nothing else.
      // With no selection there is no pill, so every pixel of the page itself
      // must match.
      const railLeft = await layerPage.evaluate(function () {
        return Math.floor(window.__lahe.tab.bounds().left);
      });
      expect(railLeft).toBeGreaterThan(0);
      expect(railLeft).toBeLessThan(viewport.width);

      const clip = { x: 0, y: 0, width: railLeft, height: viewport.height };
      const bareShot = await barePage.screenshot({ clip: clip });
      const layerShot = await layerPage.screenshot({ clip: clip });
      expect(bareShot.length, "the bare page really rendered").toBeGreaterThan(0);
      expect(Buffer.compare(bareShot, layerShot), "no selection, no pixel of difference").toBe(0);
    } finally {
      await bare.close();
      await withLayer.close();
    }
  });
});

// ---------------------------------------------------------------------------
// The refused window
// ---------------------------------------------------------------------------
//
// A window that lost the claim writes nothing. Its gestures are unbound, and the
// pill must be unbound with them: an affordance that offers to do something the
// window cannot do is worse than no affordance, because the reviewer presses it.
// Two real windows, the app fixture's real boot, like takeover_walk.spec.js.

const REFUSED_REVIEW = "popover-refused";
const EPHEMERAL_PORT = ["--port", "0"];

test.describe("the pill in a refused window", () => {
  let appServer;
  let helper;

  test.beforeEach(async () => {
    appServer = await startAppServer();
    helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REFUSED_REVIEW],
      allowedOrigins: [appServer.origin]
    });
    appServer.useLayer({ review: REFUSED_REVIEW, token: helper.tokenFor(REFUSED_REVIEW), helper: helper.url });
  });

  test.afterEach(async () => {
    if (appServer) await appServer.close();
    if (helper) await helper.stop();
  });

  test("the pill comes back after a remount, on a page that morphs under the reviewer", async ({ page }) => {
    // The lesson this feature was built under: transient UI has to be re-shown
    // from state after a remount. The reviewer's selection survives a morph, so
    // the pill has to. It did not, the first time: the morph unbound the group,
    // the pill went, and selectionchange had already happened and was never
    // going to happen again.
    await page.goto(appServer.urlFor("/?morph=hooked&poll=200"));
    await pollPage(page, () => window.__lahe && window.__lahe.booted, undefined, {
      message: "the layer to boot from the app's own script tag"
    });

    await page.evaluate(() => {
      const p = document.querySelector("main p, p");
      window.getSelection().removeAllRanges();
      window.getSelection().selectAllChildren(p);
    });
    await pollPage(page, () => window.__lahe.handle.comments.selectionPopover().visible === true, undefined, {
      message: "the pill to appear"
    });

    await page.evaluate(() => window.__lahe.handle.injector.remount("test-forced"));
    await pollPage(page, () => window.__lahe.handle.comments.selectionPopover().visible === true, undefined, {
      message: "the pill to be back after the remount, with the selection still made"
    });
    expect(await page.evaluate(() => window.getSelection().isCollapsed)).toBe(false);
  });

  test("a refused window never shows the pill, and shows it again after the takeover", async ({ browser }) => {
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    const winA = await ctxA.newPage();
    const winB = await ctxB.newPage();

    async function bootAndWait(page) {
      await page.goto(appServer.urlFor("/"));
      await pollPage(page, () => window.__lahe && window.__lahe.booted, undefined, {
        message: "the layer to boot from the app's own script tag"
      });
    }

    // Cleared first, then made: setting a selection to the one that is already
    // there fires no selectionchange, and a reviewer making a second selection
    // has always dropped the first.
    async function selectParagraph(page) {
      await page.evaluate(() => {
        const p = document.querySelector("main p, p");
        window.getSelection().removeAllRanges();
        window.getSelection().selectAllChildren(p);
      });
    }

    function pillIn(page) {
      return page.evaluate(() => window.__lahe.handle.comments.selectionPopover());
    }

    try {
      await bootAndWait(winA);
      await pollPage(winA, () => window.__lahe.handle.sync.lockState().helperGranted, undefined, {
        message: "the first window to hold the helper session"
      });

      // The holder gets the pill: the positive control, so "no pill" in the
      // refused window is not "no pill anywhere".
      await selectParagraph(winA);
      await pollPage(winA, () => window.__lahe.handle.comments.selectionPopover().visible === true, undefined, {
        message: "the holding window to show the pill"
      });

      await bootAndWait(winB);
      await pollPage(winB, () => window.__lahe.handle.rail.refusalShown(), undefined, {
        message: "the second window to be refused"
      });

      await selectParagraph(winB);
      // The negative, proved structurally rather than by waiting a while and
      // hoping: the popover is bound in the comments group, and a refused
      // window has no listeners in that group at all, so there is nothing that
      // could schedule a pill.
      expect(
        await winB.evaluate(() => window.__lahe.listenerCount("comments")),
        "a refused window has no comment gestures bound"
      ).toBe(0);
      expect((await pillIn(winB)).visible, "a refused window offers nothing").toBe(false);

      // The button that undoes it: after the takeover the window can review, so
      // the pill comes back with the rest of the gestures. Asked once more first,
      // several round trips later, so a pill that arrived late would be caught.
      expect((await pillIn(winB)).visible, "and still nothing, a moment later").toBe(false);
      const info = await winB.evaluate(() => window.__lahe.handle.rail.refusalButtonInfo());
      await winB.mouse.click(info.rect.x + info.rect.width / 2, info.rect.y + info.rect.height / 2);
      await pollPage(winB, () => window.__lahe.handle.sync.lockState().acquired === true, undefined, {
        message: "the takeover to be granted"
      });

      await selectParagraph(winB);
      await pollPage(winB, () => window.__lahe.handle.comments.selectionPopover().visible === true, undefined, {
        message: "the pill to come back after the takeover"
      });

      // And it still WORKS, not just appears: a real click, a real comment, in
      // the helper's log.
      //
      // THE WHOLE GESTURE IS THE UNIT OF RETRY, selection included, and that is
      // the point rather than a workaround. This page renders itself on a timer,
      // and the pill is an offer about a selection: when a repaint lands between
      // the selection and the press, the range the pill was offering is gone,
      // commentOnSelection finds a collapsed selection and opens nothing, and
      // the pill hides itself on the way out. Clicking again there presses a
      // pill that is no longer on screen. A reviewer whose click did nothing
      // selects the passage again and presses again, so that is what this does:
      // select, wait for the pill it earns, aim at geometry just read, press
      // once, and give the box a moment to open before starting over.
      await pollUntil(
        async () => {
          // Every wait inside one attempt is short, and its failure only ends
          // THAT attempt: the whole gesture is the unit of retry, and the outer
          // timeout below is the one that decides the test.
          try {
            // Cleared, and the clearing WAITED FOR, before selecting again. The
            // pill is drawn off selectionchange, and a selection replaced with
            // the same one in the same task can settle back to where it started
            // without the page ever firing the event, which leaves the retry
            // waiting for a pill that has no reason to appear.
            await winB.evaluate(() => window.getSelection().removeAllRanges());
            await pollPage(
              winB,
              () => window.__lahe.handle.comments.selectionPopover().visible === false,
              undefined,
              { timeoutMs: 5000, message: "the pill to go before the passage is selected again" }
            );
            await selectParagraph(winB);
            const button = await pollUntil(
              async () => {
                const state = await pillIn(winB);
                if (!state || state.visible !== true || !Array.isArray(state.buttons)) return null;
                const candidate = state.buttons.filter((b) => b.action === "comment")[0];
                if (!candidate || !candidate.rect || !candidate.rect.width) return null;
                return candidate;
              },
              { timeoutMs: 5000, message: "the pill's Comment button to be on screen" }
            );
            await winB.mouse.click(button.rect.x + button.rect.width / 2, button.rect.y + button.rect.height / 2);
            await pollPage(winB, () => window.__lahe.focusedBoxQuote() !== null, undefined, {
              timeoutMs: 2000,
              message: "the comment box to open from this press"
            });
            return true;
          } catch (err) {
            // A repaint took the selection out from under the offer. Go again.
            return null;
          }
        },
        {
          intervalMs: 100,
          timeoutMs: 30000,
          message: "the pill's Comment button to open the comment box after the takeover"
        }
      );
      await winB.keyboard.type("From the pill, after a takeover", { delay: 5 });
      await winB.keyboard.press("Meta+Enter");
      await pollUntil(
        () => readEventLog(helper.stateDir, REFUSED_REVIEW).filter((e) => e.event === "item.ready").length >= 1,
        { message: "the pill's comment to reach events.jsonl" }
      );
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
