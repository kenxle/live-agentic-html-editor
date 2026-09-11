// The page's own keyboard shortcuts, and the places they must not fire.
//
// A reviewer on a reveal.js deck types in the library and the deck changes
// slides. reveal listens for keydown on the document and decides "is someone
// typing" by reading document.activeElement. Everything the library draws lives
// in a CLOSED shadow root, so focus is retargeted: from the page's side the
// active element is a plain host div, which is not editable. reveal therefore
// handles the key, and the space bar in the middle of a sentence advances the
// slide.
//
// The rule this file pins:
//
//   - Browsing the page: the page's hotkeys work, untouched.
//   - Typing in any of the library's own text fields: the page never sees it.
//     That means the comment box anchored on the page AND every field in the
//     rail, which is a second closed shadow root nested inside the first.
//   - Focus on the library's non-text chrome (a button): the page sees keys
//     again, because a reviewer who pressed a button and then an arrow key
//     still means the page.
//   - The field's own handlers still run, which is why the fence listens in the
//     bubbling phase rather than capture: Cmd-Enter still commits.
//
// Both halves of the counter matter. The fixture counts on document and on
// window separately, because pages differ on where they listen, and a fence
// that stopped the event only at the document would leave a window listener
// firing.
//
// The fixture reproduces reveal's activeElement check rather than loading
// reveal, so the test states the condition instead of depending on a version of
// somebody else's deck framework.

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("../helpers");
const { startStaticServer } = require("../helpers/servers");
const manifest = require("../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "hotkeys-page.html";
const REVIEW = "rev_hotkeys";

// The bundle, concatenated in the manifest's order, in memory. Builders never
// commit dist/, so reading dist/ would test whoever last ran the build script
// rather than the source in this worktree.
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

// The REAL boot, rail and tabs included, with the sync client held back: the
// helper is not part of this question and a poll loop against a closed port
// would only add chips to the rail. Everything under test here is in the page.
async function bootLayer(page) {
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(function (review) {
    window.__h = window.LAHE.layer.boot({
      review: review,
      token: "",
      helper: "http://127.0.0.1:1",
      startSync: false
    });
  }, REVIEW);
}

function counters(page) {
  return page.evaluate(function () {
    return { document: window.__hotkeys, window: window.__hotkeysWindow };
  });
}

function selectElementText(page, selector) {
  return page.evaluate(function (sel) {
    var el = document.querySelector(sel);
    var range = document.createRange();
    range.selectNodeContents(el);
    var s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }, selector);
}

function itemsIn(page) {
  return page.evaluate(function (review) {
    return window.__h.store.read(review);
  }, REVIEW);
}

// One committed comment, so the rail has a card to grow its fields on.
async function commitComment(page, selector, text) {
  await selectElementText(page, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  const items = await itemsIn(page);
  return items[0];
}

/**
 * Focus one of the rail's own fields, by name, from inside the closed root.
 *
 * The rail's root is closed, so Playwright cannot select into it and a card
 * node the library hands back is the only way in: its getRootNode() is the root
 * everything else in the rail is queried from.
 */
function focusRailField(page, which, itemId) {
  return page.evaluate(function (args) {
    var h = window.__h;
    var node = h.rail.cardNode(args.id);
    var root = node ? node.getRootNode() : null;
    if (!root) return null;
    var field = null;
    if (args.which === "card-note") {
      field = node.querySelector(".lahe-rail-note");
      if (field) field.focus();
    } else if (args.which === "composer") {
      field = root.querySelector('textarea[aria-label="Add another message to this comment"]');
      if (field) field.focus();
    } else if (args.which === "page-note") {
      var noteHandle = h.tab().ensureNoteBox();
      h.tab().focusNote();
      field = noteHandle ? noteHandle.input : null;
    } else if (args.which === "followup") {
      h.rail.selectTab("done");
      var composer = h.doneTab().followup(args.id);
      field = composer ? composer.querySelector("textarea") : null;
      if (field) field.focus();
    }

    var active = root.activeElement;
    if (!field || active !== field) {
      return {
        focused: false,
        wanted: args.which,
        active: active ? active.tagName + "." + active.className : null
      };
    }
    return {
      focused: true,
      tag: field.tagName,
      editable: field.isContentEditable === true,
      before: typeof field.value === "string" ? field.value : field.textContent
    };
  }, { which: which, id: itemId });
}

function focusedRailText(page, itemId) {
  return page.evaluate(function (id) {
    var node = window.__h.rail.cardNode(id);
    var root = node ? node.getRootNode() : null;
    var active = root ? root.activeElement : null;
    if (!active) return null;
    return typeof active.value === "string" ? active.value : active.textContent;
  }, itemId);
}

test.describe("page hotkeys are fenced out of the library's text fields", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ label: "hotkeys-fixtures" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test("the page's keys work while browsing, stop while typing in a comment box, and Cmd-Enter still commits", async ({
    page
  }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    // 1. Browsing. Nothing of the library's holds focus, so the page's own
    //    shortcuts are the page's own business, on document and on window.
    await page.click("#hk-title");
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("s");
    expect(await counters(page)).toEqual({ document: 3, window: 3 });

    // 2. Typing in a comment box anchored on the page. The words carry both a
    //    space and the letter s, and an arrow key follows them, so all three of
    //    the page's shortcuts are exercised against a focused text field.
    await selectElementText(page, "#hk-intro");
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");

    const focusedQuote = await page.evaluate(function () {
      var box = window.__h.comments.focusedBox();
      return box ? box.item.context.quote : null;
    });
    expect(focusedQuote).toContain("contradicts the heading");

    const typed = "this sentence says the opposite";
    await page.keyboard.type(typed);
    await page.keyboard.press("ArrowRight");

    expect(await counters(page)).toEqual({ document: 3, window: 3 });
    const inBox = await page.evaluate(function () {
      var box = window.__h.comments.focusedBox();
      return box ? box.input.value : null;
    });
    expect(inBox).toBe(typed);

    // 3. The box's own handlers still run. The fence listens on the way back up,
    //    after the target has had the event, so the commit gesture is untouched.
    await page.keyboard.press("ControlOrMeta+Enter");
    const items = await itemsIn(page);
    expect(items).toHaveLength(1);
    expect(items[0].note).toBe(typed);
    expect(items[0].state).toBe("ready");
  });

  test("typing in the rail's own fields never reaches the page", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    const item = await commitComment(page, "#hk-intro", "first pass at this");
    expect(item).toBeTruthy();
    const before = await counters(page);
    expect(before).toEqual({ document: 0, window: 0 });

    // The three fields the Active tab holds while a comment is still open: the
    // card's own note, editable in place; the composer under it; and the page
    // note at the foot of the tab. Each one is in the rail's nested closed root,
    // which is the boundary the first version of this fence could not see past.
    const activeFields = ["card-note", "composer", "page-note"];
    for (const which of activeFields) {
      const focused = await focusRailField(page, which, item.id);
      expect(focused, "the " + which + " field takes focus").toBeTruthy();
      expect(focused.focused, "the " + which + " field takes focus").toBe(true);

      const words = " a spaced sentence";
      await page.keyboard.type(words);
      await page.keyboard.press("ArrowRight");

      expect(await counters(page), "keys typed in " + which + " stayed in the rail").toEqual(before);
      const text = await focusedRailText(page, item.id);
      expect(text, "the words landed in " + which).toContain("a spaced sentence");
    }

    // And the Done tab's follow-up composer, which only exists once an agent has
    // answered. The reply is folded the way the poll loop folds one.
    const folded = await page.evaluate(function (args) {
      // The revision is re-read here rather than captured earlier: the typing
      // above went into the card's own note, which moves the record on. A fold
      // naming the revision the agent answered would be refused as stale, and
      // a refused reply grows no composer to type into.
      var current = window.__h.store.read(args.review).filter(function (row) {
        return row.id === args.id;
      })[0];
      return window.__h.doneTab().applyReplies([
        {
          event: "reply.folded",
          item: current.id,
          rev: current.rev,
          accepted: true,
          state: "handled",
          ts: new Date().toISOString(),
          reply: { status: "handled", agent: "codex", message: "Rewritten so it agrees with the heading." }
        }
      ]);
    }, { id: item.id, review: REVIEW });
    expect(folded.map((entry) => entry.kind)).toEqual(["folded"]);

    const followup = await focusRailField(page, "followup", item.id);
    expect(followup.focused, "the follow-up composer takes focus").toBe(true);

    await page.keyboard.type("s and a space here too");
    await page.keyboard.press("ArrowRight");

    expect(await counters(page), "keys typed in the follow-up stayed in the rail").toEqual(before);
    expect(await focusedRailText(page, item.id)).toContain("s and a space here too");
  });

  test("a key aimed at the rail's buttons still reaches the page", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    const item = await commitComment(page, "#hk-intro", "a comment to make a card");

    // A real button in the rail, focused the way a reviewer's click focuses one.
    // It is chrome, not a text field, so the fence lets the key through.
    const focusedButton = await page.evaluate(function (id) {
      var node = window.__h.rail.cardNode(id);
      var root = node ? node.getRootNode() : null;
      var button = root ? root.querySelector("button") : null;
      if (!button) return null;
      button.focus();
      return {
        focused: root.activeElement === button,
        label: button.getAttribute("aria-label") || button.textContent
      };
    }, item.id);
    expect(focusedButton).toBeTruthy();
    expect(focusedButton.focused).toBe(true);

    const before = await counters(page);
    await page.keyboard.press("ArrowRight");
    expect(await counters(page)).toEqual({
      document: before.document + 1,
      window: before.window + 1
    });
  });
});
