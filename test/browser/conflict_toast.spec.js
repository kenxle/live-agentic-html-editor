// The conflict toast, in Ken's case.
//
// Ken asked the agent to add a module to his article and kept writing in the
// same spot while it worked. When he committed, the page reloaded onto the
// agent's version, replay's fourth branch ("matches none of these") flagged a
// conflict and wrote nothing, and his paragraphs vanished from the page. They
// were safe on the conflict card, but nothing told him. This spec is that
// sequence: the reviewer edits a block, the page's source changes that block
// underneath them, the reload lands on the source, and the collision has to be
// TOLD, once, on the page, with the rail closed.
//
// The helper is deliberately down (a loopback port with nothing on it): the
// collision is decided entirely in the browser, and nothing here is about sync.
//
// Screenshots: set LAHE_SCREENSHOT_DIR to a folder and the light and dark toast
// are written there from the same run that proves them.

"use strict";

const path = require("node:path");

const { test, expect, pollPage, pollUntil, placeCaret, startStaticServer } = require("../helpers");
const { withLayer, scriptTagFor } = require("./support/with_layer");

const SHOT_DIR = process.env.LAHE_SCREENSHOT_DIR || null;
const TOKEN = "conflict-toast-token";
const DOC_PATH = "/article.html";
const HELPER = "http://127.0.0.1:1";

// The agent's change EXTENDS the original sentence, so the anchor (placed by
// text) still finds the block and the outcome is a collision, not a lost anchor.
const ORIGINAL = "Most runners come back from a layoff too fast and pay for it in the third week.";
const REVIEWER_TAIL = " I learned this the hard way in 2019, when a calf strain cost me a spring.";
const AGENT_TAIL = " The new module below walks through a safer four-week return.";
const MINE = ORIGINAL + REVIEWER_TAIL;
const THEIRS = ORIGINAL + AGENT_TAIL;

const TITLE = "Your edit clashed with a change to the page";
const BODY = "Nothing is lost. Both versions are on the card. Click to choose which to keep.";

function articleHtml(config, sentence, dark) {
  const style = dark
    ? "<style>body{background:#16181d;color:#e6e8ec;font:17px/1.6 Georgia,serif;margin:40px}</style>"
    : "<style>body{background:#fff;color:#1a1c20;font:17px/1.6 Georgia,serif;margin:40px}</style>";
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Coming back</title>' +
    style +
    "</head>\n<body>\n<main>\n<h1>Coming back from a layoff</h1>\n" +
    '<p id="lede">' +
    sentence +
    "</p>\n" +
    '<p id="tail">The rest of this article holds still while the agent works.</p>\n' +
    "</main>\n" +
    scriptTagFor(config) +
    "\n</body>\n</html>\n"
  );
}

async function booted(page) {
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

/** Open the page, make the reviewer's edit, change the source, reload. */
async function reachTheConflict(page, pages, review, options) {
  const opts = options || {};
  const config = { review: review, token: TOKEN, helper: HELPER };
  const served = { sentence: ORIGINAL };
  await withLayer(page, config);
  await page.route("**" + DOC_PATH, function (route) {
    return route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      body: articleHtml(config, served.sentence, opts.dark === true)
    });
  });

  await page.goto(pages.origin + DOC_PATH);
  await booted(page);
  // Ken works with the rail closed. That is the case the toast exists for.
  await page.evaluate(() => window.__lahe.rail.collapse(true));

  await placeCaret(page, { selector: "#lede", offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.isEditing() === true, undefined, {
    message: "Cmd-Shift-E to open the block for editing"
  });
  await placeCaret(page, { selector: "#lede", offset: ORIGINAL.length });
  await page.keyboard.type(REVIEWER_TAIL);
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "Esc to commit" });

  const id = await pollUntil(
    async () => {
      const items = await page.evaluate(() => window.__lahe.items());
      const edit = items.filter((item) => item.kind === "edit" && item.after === MINE)[0];
      return edit ? edit.id : null;
    },
    { message: "the committed edit to carry the reviewer's sentence" }
  );
  expect(await conflictToasts(page), "no collision yet, so nothing to say").toEqual([]);

  // The agent rewrites the block in the source, and the page reloads onto it.
  served.sentence = THEIRS;
  await page.reload();
  await booted(page);
  await pollPage(page, (itemId) => window.__lahe.flaggedIds().indexOf(itemId) !== -1, id, {
    message: "replay to flag the collision on the card"
  });
  expect(
    await page.evaluate(() => document.querySelector("#lede").textContent),
    "branch four writes nothing: the page shows the agent's version"
  ).toBe(THEIRS);
  return { id, served };
}

function conflictToasts(page) {
  return page.evaluate(() =>
    window.__lahe.rail.toastInfo().toasts.filter((toast) => toast.label === "Conflict")
  );
}

/** Wait for the conflict toast, and for it to stop sliding, so a press lands. */
async function waitForConflictToast(page) {
  let previous = null;
  return pollUntil(
    async () => {
      const list = await conflictToasts(page);
      if (list.length !== 1 || !list[0].rect) return false;
      const geometry = JSON.stringify(list[0].rect);
      const settled = geometry === previous;
      previous = geometry;
      return settled ? list[0] : false;
    },
    { message: "the conflict toast to be on screen and settled" }
  );
}

/** A pass has run and said everything it is going to say. */
async function afterAPass(page) {
  await pollPage(page, () => window.LAHE.replay.isSettling() === false, undefined, {
    message: "replay's settling window to close"
  });
  await page.evaluate(() => window.__lahe.replayNow());
}

async function shoot(page, toast, scheme) {
  if (!SHOT_DIR) return;
  const view = page.viewportSize();
  const pad = 24;
  const x = Math.max(0, Math.floor(toast.rect.x - 280));
  const width = Math.min(view.width - x, Math.ceil(toast.rect.width + 280 + pad));
  await page.screenshot({
    path: path.join(SHOT_DIR, "conflict_toast_" + scheme + ".png"),
    clip: { x: x, y: 0, width: width, height: Math.ceil(toast.rect.y + toast.rect.height + pad + 120) }
  });
}

test.describe("a collision on reload is told on the page, once", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ label: "conflict-toast" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("the toast appears, and a reload with the conflict still open does not raise it again", async ({ page }) => {
    const { id } = await reachTheConflict(page, pages, "conflict-toast-reload");

    const toast = await waitForConflictToast(page);
    expect(toast.text).toBe(TITLE);
    expect(toast.about).toBe(BODY);
    expect(toast.sticky, "it waits: this is the moment they think their work is gone").toBe(true);
    expect(toast.armed, "no clock").toBe(false);
    await shoot(page, toast, "light");

    // The next pass re-finds the same collision. It is not news.
    await afterAPass(page);
    expect((await conflictToasts(page)).length, "one toast, not one per pass").toBe(1);

    await page.reload();
    await booted(page);
    await pollPage(page, (itemId) => window.__lahe.flaggedIds().indexOf(itemId) !== -1, id, {
      message: "the same collision to be flagged again after the reload"
    });
    await afterAPass(page);
    expect(await conflictToasts(page), "already told on this tab: no second toast").toEqual([]);
  });

  test("pressing the toast opens the rail on the conflict card", async ({ page }) => {
    const { id } = await reachTheConflict(page, pages, "conflict-toast-open");
    const toast = await waitForConflictToast(page);

    await page.mouse.click(toast.rect.x + toast.rect.width / 2, toast.rect.y + toast.rect.height / 2);
    await pollPage(page, () => window.__lahe.rail.isCollapsed() === false, undefined, {
      message: "the rail to open"
    });
    const rail = await page.evaluate(() => ({
      tab: window.__lahe.rail.currentTab(),
      focused: window.__lahe.rail.focusedCardId()
    }));
    expect(rail.tab, "on the tab the conflict card is in").toBe("edits");
    expect(rail.focused, "with that card focused").toBe(id);
    expect(await conflictToasts(page), "and the toast has done its job").toEqual([]);
  });

  test("choosing a version resolves the conflict and takes the toast away", async ({ page }) => {
    const { id } = await reachTheConflict(page, pages, "conflict-toast-resolve", { dark: true });
    const toast = await waitForConflictToast(page);
    await shoot(page, toast, "dark");

    // The reviewer opens the rail themselves and answers on the card, with the
    // toast still standing. The helper is down, so its failure chips are waved
    // away first: they sit over the foot of the card.
    await page.evaluate(() => {
      const failures = window.__lahe.handle.rail.failures;
      failures.list().forEach((chip) => failures.dismiss(chip.code));
      window.__lahe.rail.collapse(false);
    });
    const rect = await pollUntil(
      () =>
        page.evaluate((itemId) => {
          const rail = window.__lahe.handle.rail;
          rail.selectTab("edits");
          const node = rail.cardNode(itemId);
          const button = node ? node.querySelector('[data-lahe-conflict-choice="keep_mine"]') : null;
          if (!button) return null;
          button.scrollIntoView({ block: "center" });
          const r = button.getBoundingClientRect();
          if (!r.width || !r.height) return null;
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }, id),
      { message: "the Keep mine button to be on screen" }
    );
    expect((await conflictToasts(page)).length, "the toast is still up while they choose").toBe(1);
    await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);

    await pollPage(page, (itemId) => window.__lahe.flaggedIds().indexOf(itemId) === -1, id, {
      message: "Keep mine to resolve the collision"
    });
    await pollPage(page, () => document.querySelector("#lede").textContent.indexOf("calf strain") !== -1, undefined, {
      message: "the reviewer's words to be back on the page"
    });
    await pollUntil(async () => (await conflictToasts(page)).length === 0, {
      message: "resolving to take the toast away"
    });
  });
});
