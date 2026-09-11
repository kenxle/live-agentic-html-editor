// Present mode: the whole library off the screen, and still working.
//
// Ken reviews a reveal.js deck with LAHE and also presents it: "sometimes
// during a presentation there will not be LAHE on there, but during class it's
// nice if I can talk to the AI through the deck. I might want a way to hide the
// pill for the chat rail."
//
// So hidden is not off. What these assert, in the order they matter:
//
//   hidden       nothing of the library's is on screen: the one host is
//                display:none, so the rail, the pill, the toasts and the boxes
//                go with it, and no page wash is registered at all
//   disarmed     the comment and hand-edit chords do nothing in front of a room
//   not lost     a reply that folds during the talk is waiting as a message the
//                moment the reviewer comes back
//   the way back one chord, and the reviewer's choice survives a reload
//
// Everything here is the real thing: 0C's node app serving its own HTML, the
// library arriving as one script tag, the real helper, and an agent that is
// `fs.appendFileSync` on a replies file.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  startService,
  startStaticServer,
  SERVICE_ENTRY
} = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REPO_ROOT = path.join(__dirname, "..", "..");
const REVIEW = "present-review";
const EPHEMERAL_PORT = ["--port", "0"];

// The paints the library can put on the page's own words. Present mode empties
// every one of them, which is a different claim from "the rail is hidden".
const HIGHLIGHT_NAMES = ["lahe-comment", "lahe-comment-active", "lahe-emphasis", "lahe-changed"];

function appendReply(helper, fields) {
  const file = path.join(helper.stateDir, "reviews", REVIEW, "replies-claude.jsonl");
  fs.appendFileSync(file, JSON.stringify(fields) + "\n");
}

function reviewJson(helper) {
  const file = path.join(helper.stateDir, "reviews", REVIEW, "review.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null; // caught mid-rename, which the atomic write makes vanishingly rare
  }
}

function projectedItems(projection) {
  if (!projection) return [];
  return projection.pages.reduce((out, page) => out.concat(page.items), []);
}

function waitForProjected(helper, count) {
  return pollUntil(
    () => {
      const got = reviewJson(helper);
      return got && projectedItems(got).length >= count ? projectedItems(got) : null;
    },
    { message: "review.json to hold " + count + " item(s)" }
  );
}

async function selectText(page, selector) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
}

async function commentOnSelection(page, selector, text) {
  await selectText(page, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

/**
 * What anyone in the room can see of the library.
 *
 * The host is a plain element in the page, so it IS selectable; everything it
 * holds is behind a closed shadow root and is not.
 */
function onScreen(page) {
  return page.evaluate((names) => {
    const host = document.getElementById("lahe-surface-root");
    const computed = host ? window.getComputedStyle(host) : null;
    return {
      host: !!host,
      hiddenAttr: host ? host.getAttribute("data-lahe-hidden") : null,
      display: computed ? computed.display : null,
      presenting: window.__lahe.present(),
      // Sizes, not names: "registered and empty" is what a hidden paint looks
      // like, and it is different from "never painted".
      painted: names.reduce((total, name) => {
        const entry = window.CSS.highlights.get(name);
        return total + (entry ? entry.size : 0);
      }, 0)
    };
  }, HIGHLIGHT_NAMES);
}

async function bootedPage(page, app, helper, token, query) {
  app.useLayer({ review: REVIEW, token: token, helper: helper.url });
  await page.goto(app.urlFor(query || "/?morph=off"));
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

async function startBoth() {
  const app = await startAppServer();
  const helper = await startService({
    entry: SERVICE_ENTRY,
    args: EPHEMERAL_PORT,
    reviews: [REVIEW],
    allowedOrigins: [app.origin]
  });
  return { app, helper, token: helper.tokenFor(REVIEW) };
}

/** The chord, pressed on the page itself: Cmd-Shift-X, both ways. */
function pressChord(page) {
  return page.keyboard.press("ControlOrMeta+Shift+KeyX");
}

test.describe("present mode: the library hidden, and still working", () => {
  test("the menu item hides everything, and the chord brings it back", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const before = await onScreen(page);
      expect(before.presenting).toBe(false);
      expect(before.display, "the library is on screen to begin with").not.toBe("none");
      expect(before.painted, "and the reviewer's passage is washed").toBeGreaterThan(0);

      // Chosen the way a reviewer chooses it: the real item in the rail's menu,
      // clicked at the coordinates the rail reports, because a closed root has
      // no selector.
      const item = await page.evaluate(() => {
        window.__lahe.rail.openMenu(0);
        const info = window.__lahe.rail.menuInfo();
        return info.items.filter((one) => one.action === "present")[0];
      });
      expect(item, "the menu carries a way into present mode").toBeTruthy();
      expect(item.label, "and teaches the chord that is the way back").toContain("Cmd-Shift-X");
      await page.mouse.click(item.rect.x + item.rect.width / 2, item.rect.y + item.rect.height / 2);

      await pollPage(page, () => window.__lahe.present() === true, undefined, {
        message: "the library to go into present mode"
      });
      const hidden = await onScreen(page);
      expect(hidden.host, "the host is still there: hidden is not torn down").toBe(true);
      expect(hidden.hiddenAttr).toBe("true");
      expect(hidden.display, "and nothing it holds can be seen").toBe("none");
      expect(hidden.painted, "no wash of any kind is registered on the page").toBe(0);

      // The gestures are disarmed, which is the half a projector would show.
      await selectText(page, "h1");
      await page.keyboard.press("ControlOrMeta+Shift+KeyC");
      await page.keyboard.press("ControlOrMeta+Shift+KeyE");
      const quiet = await page.evaluate(() => ({
        box: window.__lahe.focusedBoxQuote(),
        editing: window.__lahe.isEditing(),
        items: window.__lahe.items().length
      }));
      expect(quiet.box, "Cmd-Shift-C does nothing while the tool is hidden").toBe(null);
      expect(quiet.editing, "and neither does Cmd-Shift-E").toBe(false);
      expect(quiet.items, "so nothing new was recorded in front of the room").toBe(1);

      // And the chord brings the whole thing back.
      await pressChord(page);
      await pollPage(page, () => window.__lahe.present() === false, undefined, {
        message: "the chord to bring the library back"
      });
      const back = await onScreen(page);
      expect(back.hiddenAttr).toBe(null);
      expect(back.display).not.toBe("none");
      await pollPage(page, () => window.__lahe.rail.cardIds().length === 1, undefined, {
        message: "the card to still be there"
      });
      expect((await onScreen(page)).painted, "and the reviewer's marks are back on the page").toBeGreaterThan(0);

      // The gestures came back with it.
      await commentOnSelection(page, "h1", "tighten this");
      await pollPage(page, () => window.__lahe.items().length === 2, undefined, {
        message: "commenting to work again"
      });
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("an answer that lands during the talk is waiting when the reviewer comes back", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);

      await page.evaluate(() => window.__lahe.present(true));
      await pollPage(page, () => window.__lahe.present() === true, undefined, {
        message: "the library to go into present mode"
      });

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "handled",
        agent: "claude",
        text: "cut it to one sentence, and moved the number to the front",
        user_needs_to_see_reply: true
      });

      // Sync kept polling and folding: the record has its answer, and the rail
      // put nothing on screen to say so.
      await pollPage(
        page,
        (id) => {
          const got = window.__lahe.itemById(id);
          return !!(got && got.reply);
        },
        item.id,
        { message: "the reply to fold while the library is hidden" }
      );
      expect(await page.evaluate(() => window.__lahe.rail.toastInfo().count)).toBe(0);

      await pressChord(page);
      await pollPage(page, () => window.__lahe.rail.toastInfo().count > 0, undefined, {
        message: "the answer to be waiting when the reviewer comes back"
      });
      const info = await page.evaluate(() => window.__lahe.rail.toastInfo());
      expect(info.toasts[0].text).toContain("moved the number to the front");
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("the choice survives a reload, so a reload mid-talk stays hidden", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await page.evaluate(() => window.__lahe.present(true));
      await pollPage(page, () => window.__lahe.present() === true, undefined, {
        message: "the library to go into present mode"
      });

      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again"
      });
      const after = await onScreen(page);
      expect(after.presenting, "the reviewer's choice came back with the page").toBe(true);
      expect(after.display).toBe("none");

      // And it un-sticks the same way it stuck.
      await pressChord(page);
      await pollPage(page, () => window.__lahe.present() === false, undefined, {
        message: "the chord to bring the library back"
      });
      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again"
      });
      expect(await page.evaluate(() => window.__lahe.present())).toBe(false);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});

test.describe('data-lahe-start="hidden": a page that always starts hidden', () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "repo" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("the page comes up with nothing of the library on it, and the chord reveals it", async ({ page }) => {
    await page.goto(pages.urlFor("test/fixtures/present-hidden-doc.html"));
    await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
      message: "the layer to boot from its script tag"
    });

    const start = await onScreen(page);
    expect(start.presenting, "the script tag asked for hidden, so hidden is how it starts").toBe(true);
    expect(start.display).toBe("none");

    await pressChord(page);
    await pollPage(page, () => window.__lahe.present() === false, undefined, {
      message: "the chord to reveal the library"
    });
    expect((await onScreen(page)).display).not.toBe("none");
  });
});
