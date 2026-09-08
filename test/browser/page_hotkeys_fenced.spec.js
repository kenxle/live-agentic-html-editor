// The page's own keyboard shortcuts, and the one place they must not fire.
//
// A reviewer on a reveal.js deck opens a comment box and types. reveal listens
// for keydown on the document and decides "is someone typing" by reading
// document.activeElement. The library's comment box lives in a CLOSED shadow
// root, so focus is retargeted: from the page's side the active element is the
// plain shadow host, which is not editable. reveal therefore handles the key,
// and the space bar in the middle of a sentence advances the slide.
//
// The rule this file pins:
//
//   - Browsing the page: the page's hotkeys work, untouched.
//   - Typing in one of the library's own text fields: the page never sees it.
//   - Focus on the library's non-text chrome (a button): the page sees it
//     again, because a reviewer who pressed a button and then an arrow key
//     still means the page.
//   - The box's own handlers still run, which is why the fence listens in the
//     bubbling phase rather than capture: Cmd-Enter still commits.
//
// The fixture reproduces reveal's activeElement check rather than loading
// reveal, so the test states the condition instead of depending on a version of
// somebody else's deck framework.

const path = require("node:path");
const fs = require("node:fs");
const { test, expect } = require("../helpers");
const { startStaticServer } = require("../helpers/servers");
const manifest = require("../../src/shared/manifest.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "hotkeys-page.html";

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

async function bootLayer(page, options = {}) {
  await page.addScriptTag({ content: BUNDLE });
  await page.evaluate(function (opts) {
    var LAHE = window.LAHE;
    var pageRef = LAHE.record.pageFrom({
      origin: location.origin,
      pathname: location.pathname,
      href: location.href,
      title: document.title
    });
    var comments = LAHE.comments.createComments({ reviewId: opts.reviewId, page: pageRef });
    comments.bind();
    window.__lahe = { comments: comments, page: pageRef, reviewId: opts.reviewId };
  }, { reviewId: options.reviewId || "rev_hotkeys" });
}

function hotkeyCount(page) {
  return page.evaluate(function () {
    return window.__hotkeys;
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

test.describe("page hotkeys are fenced out of the library's text fields", () => {
  let server;

  test.beforeAll(async () => {
    server = await startStaticServer({ label: "hotkeys-fixtures" });
  });

  test.afterAll(async () => {
    if (server) await server.close();
  });

  test("the page's keys work while browsing, stop while typing, and Cmd-Enter still commits", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    // 1. Browsing. Nothing of the library's is open or focused, so the page's
    //    own shortcuts are the page's own business.
    await page.click("#hk-title");
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("s");
    expect(await hotkeyCount(page)).toBe(3);

    // 2. Typing in a comment box. The words contain both a space and the letter
    //    s, and an arrow key follows them, so all three of the page's shortcuts
    //    are exercised against a focused text field.
    await selectElementText(page, "#hk-intro");
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");

    const focusedQuote = await page.evaluate(function () {
      var box = window.__lahe.comments.focusedBox();
      return box ? box.item.context.quote : null;
    });
    expect(focusedQuote).toContain("contradicts the heading");

    const typed = "this sentence says the opposite";
    await page.keyboard.type(typed);
    await page.keyboard.press("ArrowRight");

    expect(await hotkeyCount(page)).toBe(3);
    const inBox = await page.evaluate(function () {
      var box = window.__lahe.comments.focusedBox();
      return box ? box.input.value : null;
    });
    expect(inBox).toBe(typed);

    // 3. The box's own handlers still run. The fence listens on the way back up,
    //    after the target has had the event, so the commit gesture is untouched.
    await page.keyboard.press("ControlOrMeta+Enter");
    const items = await page.evaluate(function () {
      return window.LAHE.store.shared.read(window.__lahe.reviewId);
    });
    expect(items).toHaveLength(1);
    expect(items[0].note).toBe(typed);
    expect(items[0].state).toBe("ready");
  });

  test("a key aimed at the library's non-text chrome still reaches the page", async ({ page }) => {
    await page.goto(server.urlFor(FIXTURE));
    await bootLayer(page);

    await selectElementText(page, "#hk-intro");
    await page.keyboard.press("ControlOrMeta+Shift+KeyC");

    // The box's own Delete button, focused the way a reviewer's click focuses
    // it. It is chrome, not a text field, so the fence lets the key through.
    const focusedButton = await page.evaluate(function () {
      var box = window.__lahe.comments.focusedBox();
      if (!box || !box.node) return null;
      var button = box.node.querySelector("button");
      if (!button) return null;
      button.focus();
      return button.textContent;
    });
    expect(focusedButton).toBeTruthy();

    const before = await hotkeyCount(page);
    await page.keyboard.press("ArrowRight");
    expect(await hotkeyCount(page)).toBe(before + 1);
  });
});
