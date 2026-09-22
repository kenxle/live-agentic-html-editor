// A split is not a conflict.
//
// Review r88dec64b8451 (2026-09-22): the reviewer typed several paragraphs into
// one <p>. The agent wrote them into the Markdown source as separate
// paragraphs, which is right, and the rebuilt page came back with one <p> per
// paragraph. Replay compared the one block the record anchors to, found only
// the first paragraph there, took branch four ("matches none of these") and the
// conflict toast told the reviewer their edit had clashed with the page. It had
// not: every word they typed was on the page, in the blocks right after it.
//
// This spec is that sequence with the rail closed: type three paragraphs into
// one block, commit, the source becomes three <p>, reload. No conflict card and
// no conflict toast. The control keeps branch four honest: a source whose
// last paragraph differs from the reviewer's still conflicts.
//
// The helper is deliberately down: the decision is made entirely in the
// browser.

"use strict";

const { test, expect, pollPage, pollUntil, placeCaret, startStaticServer } = require("../helpers");
const { withLayer, scriptTagFor } = require("./support/with_layer");

const TOKEN = "split-not-conflict-token";
const DOC_PATH = "/sketch.html";
const HELPER = "http://127.0.0.1:1";

const ORIGINAL = "It's becoming a common experience to have the following conversation.";
const SECOND = "Human: Claude it looks like you didn't do X.";
const THIRD = "Claude: You're right! Let's do that.";
const MINE = ORIGINAL + "\n\n" + SECOND + "\n\n" + THIRD;

// Markdown-shaped markup: no ids, one <p> per paragraph, and a paragraph after
// the edited one that holds still.
function sketchHtml(config, paragraphs) {
  return (
    '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8" /><title>Sketch</title></head>\n' +
    "<body>\n<main>\n<h1>The new debugging hell</h1>\n" +
    paragraphs.map((p) => "<p>" + p + "</p>\n").join("") +
    "<p>The rest of this sketch holds still while the agent works.</p>\n" +
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

function conflictToasts(page) {
  return page.evaluate(() =>
    window.__lahe.rail.toastInfo().toasts.filter((toast) => toast.label === "Conflict")
  );
}

async function afterAPass(page) {
  await pollPage(page, () => window.LAHE.replay.isSettling() === false, undefined, {
    message: "replay's settling window to close"
  });
  await page.evaluate(() => window.__lahe.replayNow());
}

/** Type three paragraphs into the first <p>, commit, then serve `rebuilt` and reload. */
async function splitAndReload(page, pages, review, rebuilt) {
  const config = { review: review, token: TOKEN, helper: HELPER };
  const served = { paragraphs: [ORIGINAL] };
  await withLayer(page, config);
  await page.route("**" + DOC_PATH, function (route) {
    return route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
      body: sketchHtml(config, served.paragraphs)
    });
  });

  await page.goto(pages.origin + DOC_PATH);
  await booted(page);
  await page.evaluate(() => window.__lahe.rail.collapse(true));

  const target = "main > p:first-of-type";
  await placeCaret(page, { selector: target, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.isEditing() === true, undefined, {
    message: "Cmd-Shift-E to open the block for editing"
  });
  await placeCaret(page, { selector: target, offset: ORIGINAL.length });
  await page.keyboard.press("Enter");
  await page.keyboard.type(SECOND, { delay: 2 });
  await page.keyboard.press("Enter");
  await page.keyboard.type(THIRD, { delay: 2 });
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "Esc to commit" });

  const id = await pollUntil(
    async () => {
      const items = await page.evaluate(() => window.__lahe.items());
      const edit = items.filter((item) => item.kind === "edit" && item.state !== "draft")[0];
      return edit && edit.after === MINE ? edit.id : null;
    },
    { message: "the committed edit to carry three paragraphs separated by blank lines" }
  );

  // The agent writes the source, and the rebuilt page arrives before its reply.
  served.paragraphs = rebuilt;
  await page.reload();
  await booted(page);
  await afterAPass(page);
  await afterAPass(page);
  return id;
}

test.describe("a paragraph split the source carried is applied, not a conflict", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ label: "split-not-conflict" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("three typed paragraphs rebuilt as three <p> raise no conflict card and no toast", async ({ page }) => {
    const id = await splitAndReload(page, pages, "split-not-conflict-applied", [ORIGINAL, SECOND, THIRD]);

    expect(await page.evaluate(() => window.__lahe.flaggedIds()), "no conflict on the card").not.toContain(id);
    expect(await conflictToasts(page), "no conflict toast").toEqual([]);
    const texts = await page.evaluate(() =>
      Array.prototype.map.call(document.querySelectorAll("main > p"), (p) => p.textContent)
    );
    expect(texts.slice(0, 3), "replay wrote nothing over the rebuilt blocks").toEqual([ORIGINAL, SECOND, THIRD]);
  });

  test("control: a rebuilt page whose last paragraph differs still conflicts", async ({ page }) => {
    // Every paragraph is there and the last one carries words the reviewer
    // never typed: the split is not the reviewer's version, so branch four
    // stands and the toast is right to say so.
    const theirs = THIRD + " The agent added this sentence.";
    const id = await splitAndReload(page, pages, "split-not-conflict-control", [ORIGINAL, SECOND, theirs]);

    await pollPage(page, (itemId) => window.__lahe.flaggedIds().indexOf(itemId) !== -1, id, {
      message: "a real difference to be flagged on the card"
    });
    await pollUntil(async () => (await conflictToasts(page)).length === 1, {
      message: "the conflict toast for a real difference"
    });
  });
});
