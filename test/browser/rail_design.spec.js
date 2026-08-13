// The rail as a SHIPPING SURFACE: the four things the 4A design review found
// broken that a screenshot found and no test did.
//
// Every one of these is a regression guard for a defect that green specs did
// not see, because each is about what the reviewer looks at rather than about
// what the code returns:
//
//   F1/F2  the hosted path installed no stylesheet, so every `.lahe-rail-*`
//          element in the rail rendered naked: an eight-line prose wall of hints
//          in full ink, and two buttons run together into "RewordDelete" under
//          the reviewer's own sentence on every card. The assertion is on
//          COMPUTED STYLE, because "the class is on the node" was true the whole
//          time it was broken
//   F4     the conflict card had no pick affordance at all. The reviewer was
//          told the decision was theirs and given nothing to press. Both buttons
//          are driven through the real card here, and the page and the store are
//          read afterwards
//   F5     a handled card said the reviewer's note, the agent's sentence and the
//          file list twice each. The assertion counts occurrences in the card's
//          own text
//
// Real page, real gestures, real helper, real rail in its closed shadow root.

"use strict";

const { test, expect, pollPage, startService, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "rail-design-review";
const EPHEMERAL_PORT = ["--port", "0"];

const REGION = {
  lede: "p.lede",
  rest: "section.focus p:nth-of-type(2)"
};

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
  app.useLayer({ review: REVIEW, token: token, helper: helper.url });
  await page.goto(app.urlFor("/?morph=off"));
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
}

async function commentOn(page, selector, text) {
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
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  await pollPage(page, () => window.__lahe.items().some((i) => i.state === "ready"), undefined, {
    message: "the comment to be ready"
  });
}

/** Fold an agent reply the way the helper's poll loop delivers one. */
function fold(page, item, reply, state) {
  return page.evaluate((a) => {
    window.__lahe.handle.doneTab().applyReplies([
      {
        event: "reply.folded",
        item: a.item.id,
        rev: a.item.rev,
        accepted: true,
        state: a.state,
        ts: new Date().toISOString(),
        reply: a.reply
      }
    ]);
  }, { item, reply, state });
}

test.describe("the rail as a shipping surface", () => {
  // --- F1 / F2: the hosted path's stylesheet ---------------------------------

  test("the hosted pane has its own styles installed: the hints are keycaps, not a prose wall, and the card actions are buttons", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOn(page, REGION.lede, "Pick one number and use it twice.");

      const styled = await page.evaluate(() => {
        const pane = window.__lahe.rail.tabBody("active");
        const foot = pane.querySelector(".lahe-rail-foot");
        const keys = pane.querySelector(".lahe-rail-keys");
        const note = pane.querySelector(".lahe-rail-note");
        const acts = pane.querySelector(".cardacts");
        const reword = pane.querySelector('[data-lahe-act="reword"]');
        const del = pane.querySelector('[data-lahe-act="delete"]');
        const cs = (el) => (el ? window.getComputedStyle(el) : null);
        const keyStyle = cs(keys);
        const actStyle = cs(reword);
        const rowActs = acts ? acts.getBoundingClientRect() : null;
        const rewordRect = reword ? reword.getBoundingClientRect() : null;
        const delRect = del ? del.getBoundingClientRect() : null;
        return {
          // The tab's sheet reached the rail's own closed root at all: the foot
          // is laid out by it, and a naked <footer> is not a flex column.
          footDisplay: foot ? cs(foot).display : null,
          // The hints are the keycap system, not full-ink prose.
          hasKeycap: !!keys,
          keyBorder: keyStyle ? keyStyle.borderBottomWidth : null,
          keyFontSize: keyStyle ? keyStyle.fontSize : null,
          // ...and they are behind a disclosure rather than being a permanent
          // wall above the footer's own hints.
          hintsBehindDisclosure: !!pane.querySelector("details.lahe-rail-more .lahe-rail-hints"),
          hintsHidden: !!pane.querySelector("details.lahe-rail-more:not([open])"),
          // The note box is a surface, not a form control (F10).
          noteResize: (() => {
            const ta = foot ? foot.querySelector("textarea") : null;
            return ta ? cs(ta).resize : null;
          })(),
          noteWhiteSpace: note ? cs(note).whiteSpace : null,
          // The two card actions are buttons in a row, with real space between
          // them. "RewordDelete" was two zero-gap inline buttons.
          actsDisplay: rowActs && actStyle ? window.getComputedStyle(acts).display : null,
          actPadding: actStyle ? actStyle.paddingLeft : null,
          gap: rewordRect && delRect ? Math.round(delRect.left - rewordRect.right) : null,
          labels: [reword && reword.textContent, del && del.textContent]
        };
      });

      expect(styled.footDisplay, "the hosted stylesheet reached the rail's closed root").toBe("flex");
      expect(styled.hasKeycap).toBe(true);
      expect(styled.keyBorder, "the keycap's bottom-weighted border").toBe("2px");
      expect(parseFloat(styled.keyFontSize)).toBeLessThan(13);
      expect(styled.hintsBehindDisclosure, "one hint system: the keycaps, behind a disclosure").toBe(true);
      expect(styled.hintsHidden, "and closed, so it is not a wall in an empty rail").toBe(true);
      expect(styled.noteResize, "no native resize grabber on the note box").toBe("none");
      expect(styled.noteWhiteSpace).toBe("pre-wrap");
      expect(styled.actsDisplay).toBe("flex");
      expect(styled.labels).toEqual(["Reword", "Delete"]);
      expect(styled.gap, "Reword and Delete are two buttons, not one word").toBeGreaterThanOrEqual(4);
      expect(parseFloat(styled.actPadding), "and they are drawn as buttons").toBeGreaterThan(0);
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });

  // --- F5: one carrier per fact on a handled card ----------------------------

  test("a handled card says the reviewer's note, the agent's sentence and the files once each", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const NOTE = "Nine checked in, four cards below. Pick one number and use it twice.";
      const SAID = "Used the nine-check-in number in the lede and dropped it from the card row.";
      const FILE = "app/helpers/digest_helper.rb";
      await commentOn(page, REGION.lede, NOTE);

      const item = (await page.evaluate(() => window.__lahe.items())).filter((i) => i.state === "ready")[0];
      await fold(page, item, {
        status: "handled",
        agent: "claude",
        reason: SAID,
        files: ["app/views/dashboard/index.html.erb", FILE]
      }, "handled");
      await pollPage(page, (id) => window.__lahe.rail.getCard(id).pane === "done", item.id, {
        message: "the card to move to the Done pane"
      });

      const card = await page.evaluate((id) => {
        const node = window.__lahe.rail.cardNode(id);
        const visible = (el) => !!el && window.getComputedStyle(el).display !== "none";
        return {
          text: node.textContent,
          // The Active tab's row is still ATTACHED (withdrawing a node from a
          // card the reviewer may be typing in is the rail's own law), and it is
          // not DRAWN on a card that moved to Done.
          activeRowAttached: !!node.querySelector("[data-lahe-active-row]"),
          activeRowVisible: visible(node.querySelector("[data-lahe-active-row]")),
          rewordVisible: visible(node.querySelector('[data-lahe-act="reword"]')),
          deleteVisible: visible(node.querySelector('[data-lahe-act="delete"]')),
          reopenVisible: visible(node.querySelector(".cardacts .cardact"))
        };
      }, item.id);

      const times = (haystack, needle) => haystack.split(needle).length - 1;
      expect(times(card.text, NOTE), "the reviewer's own words, once").toBe(1);
      expect(times(card.text, SAID), "what the agent said, once").toBe(1);
      expect(times(card.text, FILE), "the file it touched, once").toBe(1);

      expect(card.activeRowAttached, "the row is never withdrawn from a card").toBe(true);
      expect(card.activeRowVisible, "and it is not drawn on a card in Done").toBe(false);
      expect(card.rewordVisible, "Reword makes no sense on a handled item").toBe(false);
      expect(card.deleteVisible, "and neither does Delete").toBe(false);
      expect(card.reopenVisible, "Done keeps Reopen").toBe(true);
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });

  // --- F4: the conflict card's two decisions ---------------------------------

  test("keeping mine re-applies the reviewer's version and clears the collision", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const { id, mine } = await editAndCollide(page);

      const pressed = await pressConflict(page, id, "keep_mine");
      expect(pressed.found, "the card carries a keep-mine button").toBe(true);

      await pollPage(page, () => window.__lahe.flaggedIds().length === 0, undefined, {
        message: "the collision to clear"
      });
      const onPage = await page.evaluate((sel) => document.querySelector(sel).textContent, REGION.rest);
      expect(onPage, "the reviewer's version is what stands").toBe(mine);
      expect(await page.evaluate((itemId) => !!window.__lahe.itemById(itemId), id), "and the record stands").toBe(true);
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });

  test("taking the page's retires the record and writes nothing to the page", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const { id, theirs } = await editAndCollide(page);

      const pressed = await pressConflict(page, id, "take_theirs");
      expect(pressed.found, "the card carries a take-the-page's button").toBe(true);
      expect(pressed.labels, "both decisions are on the card, in the reviewer's words").toEqual([
        "Keep mine",
        "Take the page's"
      ]);

      await pollPage(page, (itemId) => !window.__lahe.itemById(itemId), id, {
        message: "the record to be retired"
      });
      expect(await page.evaluate(() => window.__lahe.flaggedIds())).toEqual([]);
      const onPage = await page.evaluate((sel) => document.querySelector(sel).textContent, REGION.rest);
      expect(onPage, "the page is left exactly as it is; nothing was written").toBe(theirs);
      expect(
        await page.evaluate((itemId) => window.__lahe.cardIds().indexOf(itemId) === -1, id),
        "and the card goes with the record"
      ).toBe(true);
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });

  test("both versions are readable as a comparison: labelled, separated, and the differing run marked", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const { id, mine, theirs } = await editAndCollide(page);

      const block = await page.evaluate((itemId) => {
        const node = window.__lahe.rail.cardNode(itemId).querySelector("[data-lahe-conflict]");
        if (!node) return null;
        const side = (which) => node.querySelector('[data-lahe-conflict-side="' + which + '"]');
        const cs = (el) => window.getComputedStyle(el);
        return {
          title: node.querySelector("[data-lahe-conflict-title]").textContent,
          yoursLabel: side("yours").querySelector("[data-lahe-conflict-label]").textContent,
          theirsLabel: side("theirs").querySelector("[data-lahe-conflict-label]").textContent,
          // A rule per side, and the reviewer's is the accent one, so the pair
          // reads as a pair rather than as four undifferentiated paragraphs.
          yoursRule: cs(side("yours")).borderLeftColor,
          theirsRule: cs(side("theirs")).borderLeftColor,
          labelTransform: cs(side("yours").querySelector("[data-lahe-conflict-label]")).textTransform,
          yoursText: side("yours").querySelector("[data-lahe-conflict-text]").textContent,
          theirsText: side("theirs").querySelector("[data-lahe-conflict-text]").textContent,
          yoursDiff: side("yours").querySelector("[data-lahe-conflict-diff]").textContent,
          theirsDiff: side("theirs").querySelector("[data-lahe-conflict-diff]").textContent
        };
      }, id);

      expect(block, "the conflict block is on the card").not.toBeNull();
      expect(block.title).toBe("Which version stands?");
      expect(block.yoursLabel).toBe("Your version");
      expect(block.theirsLabel).toBe("On the page now");
      expect(block.labelTransform, "the tab's own eyebrow type").toBe("uppercase");
      expect(block.yoursRule, "the two rules differ, so the sides do").not.toBe(block.theirsRule);
      // Both versions IN FULL. The mark points at the divergence; it never
      // replaces or truncates either side.
      expect(block.yoursText).toBe(mine);
      expect(block.theirsText).toBe(theirs);
      expect(block.yoursDiff.length, "the run that differs is marked on each side").toBeGreaterThan(0);
      expect(mine).toContain(block.yoursDiff);
      expect(theirs).toContain(block.theirsDiff);
      expect(block.yoursDiff).not.toBe(block.theirsDiff);
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });

  // --- driving a real branch-four collision -----------------------------------

  /**
   * A hand edit, then the page rewriting the same block to something that is
   * neither the reviewer's version nor what they edited. Replay's branch four,
   * reached the way the design review reached it.
   */
  async function editAndCollide(page) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const range = document.createRange();
      range.setStart(el.firstChild, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, REGION.rest);
    await page.keyboard.press("ControlOrMeta+Shift+KeyE");
    await pollPage(page, () => window.__lahe.isEditing(), undefined, { message: "edit state" });
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const node = el.lastChild;
      const range = document.createRange();
      range.setStart(node, node.textContent.length);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, REGION.rest);
    await page.keyboard.type(" Say that out loud in the app.");
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, { message: "the edit to commit" });

    const item = await page.evaluate((sel) => window.__lahe.itemForElement(sel), REGION.rest);
    const theirs = await page.evaluate((sel) => {
      const record = window.__lahe.itemForElement(sel);
      const el = document.querySelector(sel);
      el.textContent = record.before + " The agent rewrote this from the source.";
      return el.textContent;
    }, REGION.rest);

    await pollPage(page, () => window.__lahe.flaggedIds().length === 1, undefined, {
      message: "replay's branch four to flag the collision"
    });
    return { id: item.id, mine: item.after, theirs: theirs };
  }

  /** Press one of the conflict card's own buttons, through the real card. */
  function pressConflict(page, id, choice) {
    return page.evaluate((a) => {
      const node = window.__lahe.rail.cardNode(a.id).querySelector("[data-lahe-conflict]");
      if (!node) return { found: false, labels: [] };
      const buttons = Array.prototype.slice.call(node.querySelectorAll("[data-lahe-conflict-choice]"));
      const labels = buttons.map((b) => b.textContent);
      const button = buttons.filter((b) => b.getAttribute("data-lahe-conflict-choice") === a.choice)[0];
      if (!button) return { found: false, labels: labels };
      button.click();
      return { found: true, labels: labels };
    }, { id, choice });
  }
});
