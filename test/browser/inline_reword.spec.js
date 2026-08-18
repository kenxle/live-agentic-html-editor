// The comment's own words are the editable surface. There is no Reword button.
//
// Ken, after using the rail for real: "do we really need a button for 'reword'?
// before we could just edit a comment and the color would go from green to yellow
// and that was how we knew."
//
// So the card's note IS the input. Click into it and type: the item drops out of
// ready back to draft, the card's wash goes green -> amber, and it leaves the set
// the agent may act on (drafts are not in review.json, R7). Cmd-Enter readies it
// again and moves the revision ONCE, which is the same flushReword commit the
// button used to reach (R21).
//
// What each test here protects:
//
//   1  typing in a ready note drops it to draft, amber, ON THE SAME CARD NODE
//   2  Cmd-Enter readies it again: rev exactly +1, green again
//   3  the file the agent reads loses the item while it is a draft and gets it
//      back at the committed revision, through the real helper
//   4  there is no Reword button anywhere on a card. Delete stays
//   5  a read-only window cannot type in it either
//
// The washes are asserted on COMPUTED background, in the rail's own closed root,
// because "the attribute changed" was true the whole time the rail had no colour.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  startService,
  SERVICE_ENTRY
} = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "inline-reword-review";
const EPHEMERAL_PORT = ["--port", "0"];

const FIRST = "shorten this";
const REWORDED = "shorten this, and lead with the number of clients";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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

async function bootedPage(page, app, helper, token) {
  app.useLayer({ review: REVIEW, token: token, helper: helper ? helper.url : undefined });
  await page.goto(app.urlFor("/?morph=off"));
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

/** A ready comment on a passage, made the way the reviewer makes one. */
async function commentOnSelection(page, selector, text) {
  await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text, { delay: 10 });
  await page.keyboard.press("ControlOrMeta+Enter");
  await pollPage(page, () => (window.__lahe.items()[0] || {}).state === "ready", undefined, {
    message: "the comment to be ready"
  });
  return (await page.evaluate(() => window.__lahe.items()))[0];
}

// ---------------------------------------------------------------------------
// Reading the rail, which is in a closed shadow root
// ---------------------------------------------------------------------------

/** The card's note, where it really is on screen, and whether it takes typing. */
function noteInfo(page, id) {
  return page.evaluate((itemId) => {
    const card = window.__lahe.rail.cardNode(itemId);
    if (!card) return null;
    const note = card.querySelector(".lahe-rail-note");
    if (!note) return null;
    note.scrollIntoView({ block: "center" });
    const rect = note.getBoundingClientRect();
    return {
      text: note.textContent,
      editable: note.isContentEditable === true,
      attribute: note.getAttribute("contenteditable"),
      visible: rect.width > 0 && rect.height > 0,
      cx: rect.x + rect.width / 2,
      cy: rect.y + rect.height / 2
    };
  }, id);
}

/** Click into the note the way a reviewer does, and select what is there. */
async function editNote(page, id) {
  const note = await noteInfo(page, id);
  expect(note, "the card carries the reviewer's own note").toBeTruthy();
  expect(note.visible, "and it is on screen").toBe(true);
  await page.mouse.click(note.cx, note.cy);
  await pollPage(page, (itemId) => window.__lahe.rail.holdsFocus(itemId), id, {
    message: "the card to hold the reviewer's cursor"
  });
  // Replace the words rather than appending at wherever the click landed, which
  // is what a reviewer rewriting a sentence does. Select-all inside an editing
  // host is scoped to the host in every engine.
  await page.keyboard.press("ControlOrMeta+KeyA");
  return note;
}

function cardPaint(page, id) {
  return page.evaluate((itemId) => {
    const node = window.__lahe.rail.cardNode(itemId);
    if (!node) return null;
    return {
      background: window.getComputedStyle(node).backgroundColor,
      state: node.getAttribute("data-state"),
      probe: node.getAttribute("data-inline-probe"),
      railState: window.__lahe.rail.getCard(itemId).state
    };
  }, id);
}

function stampCard(page, id) {
  return page.evaluate((itemId) => {
    window.__lahe.rail.cardNode(itemId).setAttribute("data-inline-probe", "1");
    return true;
  }, id);
}

function rgb(value) {
  const m = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) throw new Error("not an rgb color: " + value);
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

function itemById(page, id) {
  return page.evaluate((itemId) => window.__lahe.itemById(itemId), id);
}

// ---------------------------------------------------------------------------
// The file the agent reads
// ---------------------------------------------------------------------------

function reviewJson(helper) {
  const file = path.join(helper.stateDir, "reviews", REVIEW, "review.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null; // caught mid-rename
  }
}

function projectedItems(projection) {
  if (!projection) return [];
  return projection.pages.reduce((out, page) => out.concat(page.items), []);
}

// ---------------------------------------------------------------------------

test.describe("the note is the input: rewording without a button", () => {
  test("typing in a ready card's note drops it to draft and washes the same card amber", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const first = await commentOnSelection(page, "p.lede", FIRST);

      const ready = await cardPaint(page, first.id);
      expect(ready.state, "it starts ready").toBe("ready");
      const readyRgb = rgb(ready.background);
      expect(readyRgb.g - readyRgb.r, "and wears the green wash").toBeGreaterThanOrEqual(4);
      await stampCard(page, first.id);

      await editNote(page, first.id);
      await page.keyboard.type(REWORDED, { delay: 10 });

      await pollPage(page, (id) => window.__lahe.itemById(id).state === "draft", first.id, {
        message: "the edited item to drop back to draft"
      });

      const editing = await cardPaint(page, first.id);
      expect(editing.probe, "the card was washed in place, never re-created").toBe("1");
      expect(editing.railState, "the rail's own model moved too").toBe("draft");
      const draftRgb = rgb(editing.background);
      expect(editing.background, "draft and ready do not wear the same background").not.toBe(ready.background);
      expect(draftRgb.r - draftRgb.b, "the draft wash is warm: amber, the needs-you colour").toBeGreaterThanOrEqual(8);

      // The words are durable at once, as they always were, and the revision has
      // NOT moved: an uncommitted rewording is content, not a revision (R21).
      const midway = await itemById(page, first.id);
      expect(midway.note).toBe(REWORDED);
      expect(midway.rev, "typing is not a revision").toBe(first.rev);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("Cmd-Enter in the note readies it again: one rewording, one revision, green again", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const first = await commentOnSelection(page, "p.lede", FIRST);
      await stampCard(page, first.id);

      await editNote(page, first.id);
      await page.keyboard.type(REWORDED, { delay: 10 });
      await pollPage(page, (id) => window.__lahe.itemById(id).state === "draft", first.id, {
        message: "the edited item to drop back to draft"
      });

      await page.keyboard.press("ControlOrMeta+Enter");
      await pollPage(page, (id) => window.__lahe.itemById(id).state === "ready", first.id, {
        message: "the commit to ready it again"
      });

      const after = await itemById(page, first.id);
      expect(after.rev, "one rewording, one bump").toBe(first.rev + 1);
      expect(after.note, "and the note is the whole new sentence").toBe(REWORDED);
      expect((after.after_history || []).length, "no history entry per keystroke").toBeLessThanOrEqual(1);

      const committed = await cardPaint(page, first.id);
      expect(committed.probe, "still the same card node").toBe("1");
      const greenAgain = rgb(committed.background);
      expect(greenAgain.g - greenAgain.r, "the ready wash is back").toBeGreaterThanOrEqual(4);
      expect(greenAgain.g - greenAgain.b, "green, not blue").toBeGreaterThanOrEqual(2);

      // Typing on and committing again is a SECOND rewording, and moves it once
      // more: the bump is per commit, not per session-that-ever-existed.
      await page.keyboard.type(" today", { delay: 10 });
      await page.keyboard.press("ControlOrMeta+Enter");
      await pollPage(page, (args) => window.__lahe.itemById(args[0]).rev === args[1], [first.id, first.rev + 2], {
        message: "the second commit to bump once more"
      });
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("the agent's file loses the item while it is being reworded and gets it back at the committed revision", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const first = await commentOnSelection(page, "p.lede", FIRST);

      await pollUntil(
        () => {
          const item = projectedItems(reviewJson(helper)).find((i) => i.id === first.id);
          return item ? item : null;
        },
        { message: "the ready comment to reach the file the agent reads" }
      );

      await editNote(page, first.id);
      await page.keyboard.type(REWORDED, { delay: 10 });

      // Nothing that is not ready is actionable (R7). A comment the reviewer is
      // rewriting is not something an agent should be acting on.
      await pollUntil(
        () => {
          const gone = !projectedItems(reviewJson(helper)).some((i) => i.id === first.id);
          return gone ? true : null;
        },
        {
          message: "the item to leave the agent's actionable set while it is a draft",
          describe: () => ({ projected: projectedItems(reviewJson(helper)).map((i) => ({ id: i.id, state: i.state })) })
        }
      );

      await page.keyboard.press("ControlOrMeta+Enter");
      const back = await pollUntil(
        () => {
          const item = projectedItems(reviewJson(helper)).find((i) => i.id === first.id);
          return item && item.rev === first.rev + 1 ? item : null;
        },
        {
          message: "the committed rewording to reach the agent's file",
          describe: () => ({ projected: projectedItems(reviewJson(helper)).map((i) => ({ id: i.id, rev: i.rev })) })
        }
      );
      expect(back.note, "at the new words").toBe(REWORDED);
      expect(back.state).toBe("ready");
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("there is no Reword button on a card, and Delete is still there", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const first = await commentOnSelection(page, "p.lede", FIRST);

      const buttons = await page.evaluate((id) => {
        const card = window.__lahe.rail.cardNode(id);
        const pane = window.__lahe.rail.tabBody("active");
        return {
          onCard: Array.from(card.querySelectorAll("button")).map((b) => b.textContent),
          rewordAct: !!card.querySelector("[data-lahe-act='reword']"),
          deleteAct: !!card.querySelector("[data-lahe-act='delete']"),
          paneReword: !!pane.querySelector("[data-lahe-act='reword']"),
          paneRewordText: Array.from(pane.querySelectorAll("button")).some((b) => /reword/i.test(b.textContent))
        };
      }, first.id);

      expect(buttons.rewordAct, "the button the note replaced is gone").toBe(false);
      expect(buttons.paneReword, "and it is not anywhere else in the Active tab").toBe(false);
      expect(buttons.paneRewordText, "not under another name either").toBe(false);
      expect(buttons.onCard, "the card keeps exactly one action: Delete").toEqual(["Delete"]);
      expect(buttons.deleteAct).toBe(true);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a read-only window cannot type in the note", async ({ browser }) => {
    // Two tabs in ONE context, so they share a storage bucket: that is the shape
    // the client lock refuses (D5), and it is also the only shape where the
    // refused window is showing the same comment and therefore HAS a note to try
    // to type in. Two separate contexts would prove nothing about this note.
    const { app, helper, token } = await startBoth();
    app.useLayer({ review: REVIEW, token: token, helper: helper.url });
    const context = await browser.newContext();
    try {
      const first = await context.newPage();
      await first.goto(app.urlFor("/?morph=off"));
      await pollPage(first, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the first window to boot"
      });
      const item = await commentOnSelection(first, "p.lede", FIRST);

      const second = await context.newPage();
      await second.goto(app.urlFor("/?morph=off"));
      await pollPage(second, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the second window to boot"
      });
      // The refusal shows as the PANEL on a read-only window, not as a chip
      // beside it (one surface per fact, 2026-08-18), so read-only itself is
      // the thing to wait on.
      await pollPage(second, () => window.__lahe.handle.sync.status().readOnly === true, undefined, {
        message: "the second window to be refused and go read-only"
      });

      const note = await noteInfo(second, item.id);
      expect(note, "the read-only window still SHOWS the comment").toBeTruthy();
      expect(note.text, "with the reviewer's words on it").toContain(FIRST);
      expect(note.editable, "but it is not an editing surface here").toBe(false);
      expect(note.attribute).toBe("false");

      // And a real attempt writes nothing.
      await second.mouse.click(note.cx, note.cy);
      await second.keyboard.type("typed in the wrong window", { delay: 5 });
      const stored = await itemById(second, item.id);
      expect(stored.note, "the refused window wrote nothing").toBe(FIRST);
      expect(stored.state).toBe("ready");
    } finally {
      await context.close();
      await helper.kill9();
      await app.close();
    }
  });
});
