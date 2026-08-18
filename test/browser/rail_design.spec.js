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
//   F5b    a handled HAND EDIT was the same defect one layer down: the Edits row
//          and the Done row both printed the change summary, around a diff that
//          was already saying it, and Reopen and Undo sat at opposite ends of
//          the card. Occurrences again, plus the two buttons' shared parent
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

/**
 * Open a comment box, type into it, and STOP: no Cmd-Enter, so the item stays a
 * draft. This is the state Ken reads off color, so a test about the color needs
 * a real one rather than a hand-set attribute.
 */
async function openDraftOn(page, selector, text) {
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
  await pollPage(page, () => window.__lahe.items().some((i) => i.state === "draft"), undefined, {
    message: "the draft to reach the rail"
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
        const del = pane.querySelector('[data-lahe-act="delete"]');
        const cs = (el) => (el ? window.getComputedStyle(el) : null);
        const keyStyle = cs(keys);
        const actStyle = cs(del);
        const rowActs = acts ? acts.getBoundingClientRect() : null;
        const noteRect = note ? note.getBoundingClientRect() : null;
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
          // The note is the reviewer's way into rewording it (there is no button
          // any more), so it is drawn as something you can type in: a text
          // cursor, and a real editing surface underneath.
          noteEditable: note ? note.isContentEditable === true : null,
          noteCursor: note ? cs(note).cursor : null,
          // The card's actions are buttons in a row, clear of the reviewer's own
          // sentence. "RewordDelete" was two zero-gap inline buttons.
          actsDisplay: rowActs && actStyle ? window.getComputedStyle(acts).display : null,
          actPadding: actStyle ? actStyle.paddingLeft : null,
          noteToActs: noteRect && delRect ? Math.round(delRect.top - noteRect.bottom) : null,
          labels: Array.from(pane.querySelectorAll(".cardacts button")).map((b) => b.textContent)
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
      expect(styled.noteEditable, "the reviewer's own words are the input").toBe(true);
      expect(styled.noteCursor, "and they are drawn as something you type in").toBe("text");
      expect(styled.actsDisplay).toBe("flex");
      expect(styled.labels, "one action on the card: Delete. Rewording is the note itself").toEqual(["Delete"]);
      expect(styled.noteToActs, "the action row is clear of the reviewer's sentence").toBeGreaterThanOrEqual(2);
      expect(parseFloat(styled.actPadding), "and it is drawn as a button").toBeGreaterThan(0);
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });

  // --- the card's state is a color, not only a word --------------------------
  //
  // Ken read state off color in the module this one replaces: a comment he had
  // not submitted yet was yellow, a submitted one was green, and he could see
  // the state of the whole list without reading a single chip. The chips stay;
  // the color comes back as a WASH, quiet enough that the reviewer's own
  // sentence is still the strongest thing on the card.
  //
  // Asserted on COMPUTED background, in both schemes, because "the attribute is
  // on the node" was true the whole time the rail had no color coding at all.

  test("a draft card is washed warm and a ready card green, in both schemes, and the wash changes in place", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);

      // Two cards: one left as a draft, one submitted, so both washes are read
      // off the same pane at the same moment.
      await commentOn(page, REGION.lede, "Pick one number and use it twice.");
      await openDraftOn(page, REGION.rest, "Half written, not submitted yet.");

      const read = () =>
        page.evaluate(() => {
          const rail = window.__lahe.rail;
          const items = window.__lahe.items();
          const idFor = (state) => (items.filter((i) => i.state === state)[0] || {}).id || null;
          const bg = (id) => {
            const node = id ? rail.cardNode(id) : null;
            return node ? window.getComputedStyle(node).backgroundColor : null;
          };
          const draftId = idFor("draft");
          const readyId = idFor("ready");
          const railNode = rail.tabBody("active").getRootNode().querySelector(".rail");
          return {
            draftId: draftId,
            readyId: readyId,
            draft: bg(draftId),
            ready: bg(readyId),
            paper: window.getComputedStyle(railNode).getPropertyValue("--paper").trim(),
            scheme: rail
              .tabBody("active")
              .getRootNode()
              .host.getAttribute("data-lahe-scheme")
          };
        });

      const rgb = (value) => {
        const m = String(value).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        if (!m) throw new Error("not an rgb color: " + value);
        return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
      };

      const light = await read();
      expect(light.scheme, "the page is light, so the rail is").toBe("light");
      expect(light.draftId, "there is a draft card on screen").toBeTruthy();
      expect(light.readyId, "and a ready one").toBeTruthy();

      const lightDraft = rgb(light.draft);
      const lightReady = rgb(light.ready);
      expect(light.draft, "draft and ready do not wear the same background").not.toBe(light.ready);
      expect(lightDraft.r - lightDraft.b, "the draft wash is warm: amber, the rail's own needs-you color").toBeGreaterThanOrEqual(8);
      expect(lightReady.g - lightReady.r, "the ready wash is green").toBeGreaterThanOrEqual(4);
      expect(lightReady.g - lightReady.b, "green, not blue").toBeGreaterThanOrEqual(2);
      // Quiet: a wash over the card's paper, not a fill. The reviewer's sentence
      // is still the strongest thing on the card.
      const paper = (() => {
        if (!light.paper.startsWith("#")) return rgb(light.paper);
        const hex = light.paper.slice(1);
        const full = hex.length === 3 ? hex.split("").map((c) => c + c).join("") : hex;
        return {
          r: parseInt(full.slice(0, 2), 16),
          g: parseInt(full.slice(2, 4), 16),
          b: parseInt(full.slice(4, 6), 16)
        };
      })();
      ["r", "g", "b"].forEach((channel) => {
        expect(
          Math.abs(lightDraft[channel] - paper[channel]),
          "the draft wash stays quiet on " + channel
        ).toBeLessThanOrEqual(30);
        expect(
          Math.abs(lightReady[channel] - paper[channel]),
          "the ready wash stays quiet on " + channel
        ).toBeLessThanOrEqual(30);
      });

      // --- the wash follows the state, in place ------------------------------
      const before = await page.evaluate((id) => {
        window.__lahe.rail.cardNode(id).setAttribute("data-wash-probe", "1");
        return window.getComputedStyle(window.__lahe.rail.cardNode(id)).backgroundColor;
      }, light.draftId);
      await page.keyboard.press("ControlOrMeta+Enter");
      await pollPage(page, (id) => window.__lahe.rail.getCard(id).state === "ready", light.draftId, {
        message: "Cmd-Enter to submit the draft"
      });
      const after = await page.evaluate((id) => {
        const node = window.__lahe.rail.cardNode(id);
        return {
          bg: window.getComputedStyle(node).backgroundColor,
          sameNode: node.getAttribute("data-wash-probe") === "1"
        };
      }, light.draftId);
      expect(after.sameNode, "the card was repainted, never rebuilt").toBe(true);
      expect(after.bg, "and its wash went from draft to ready").not.toBe(before);
      expect(after.bg).toBe(light.ready);

      // --- the same two washes in dark ---------------------------------------
      await openDraftOn(page, REGION.lede, "Another one, still unsent.");
      await page.evaluate(() => {
        document.documentElement.style.background = "#12151a";
        document.body.style.background = "#12151a";
        window.__lahe.rail.refreshScheme();
      });

      const dark = await read();
      expect(dark.scheme, "a dark page puts the rail in dark").toBe("dark");
      const darkDraft = rgb(dark.draft);
      const darkReady = rgb(dark.ready);
      expect(dark.draft).not.toBe(dark.ready);
      expect(darkDraft.r + darkDraft.g + darkDraft.b, "the dark draft wash is dark").toBeLessThan(330);
      expect(darkReady.r + darkReady.g + darkReady.b, "the dark ready wash is dark").toBeLessThan(330);
      expect(darkDraft.r - darkDraft.b, "still warm in dark").toBeGreaterThanOrEqual(4);
      expect(darkReady.g - darkReady.r, "still green in dark").toBeGreaterThanOrEqual(3);
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });

  // --- a long file path stays inside the card --------------------------------

  test("a very long reply file path wraps inside the card instead of running out of it", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    const LONG = "app/views/dashboard/components/roster/weekly_digest/_client_activity_summary_row.html.erb";
    try {
      await bootedPage(page, app, helper, token);
      await commentOn(page, REGION.lede, "Name the client in this row.");

      const item = (await page.evaluate(() => window.__lahe.items())).filter((i) => i.state === "ready")[0];
      await fold(page, item, {
        status: "handled",
        agent: "claude",
        reason: "Named the client in the row and dropped the duplicate count.",
        files: [LONG, "app/helpers/digest_helper.rb"]
      }, "handled");
      await pollPage(page, (id) => window.__lahe.rail.getCard(id).pane === "done", item.id, {
        message: "the card to move to the Done pane"
      });
      await page.evaluate(() => window.__lahe.rail.selectTab("done"));

      const box = await page.evaluate((id) => {
        const node = window.__lahe.rail.cardNode(id);
        const files = node.querySelector(".agent__files");
        const cardRect = node.getBoundingClientRect();
        const filesRect = files.getBoundingClientRect();
        const pane = window.__lahe.rail.tabBody("done").getBoundingClientRect();
        return {
          cardScroll: node.scrollWidth,
          cardClient: node.clientWidth,
          filesRight: filesRect.right,
          cardRight: cardRect.right,
          filesLeft: filesRect.left,
          cardLeft: cardRect.left,
          paneRight: pane.right,
          // Wrapped rather than clipped: two paths on more than two lines.
          filesHeight: filesRect.height,
          lineCount: files.querySelectorAll(".agent__file").length
        };
      }, item.id);

      expect(box.cardScroll, "the card holds its own contents").toBeLessThanOrEqual(box.cardClient);
      expect(box.filesRight, "the file list ends inside the card").toBeLessThanOrEqual(box.cardRight);
      expect(box.filesLeft).toBeGreaterThanOrEqual(box.cardLeft);
      expect(box.filesRight, "and inside the pane").toBeLessThanOrEqual(box.paneRight);
      expect(box.lineCount, "one path per line").toBe(2);
      expect(box.filesHeight, "the long path really wrapped rather than being cut off").toBeGreaterThan(30);
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

      // Looking at the pane the reviewer is looking at. A pane that is not the
      // current tab renders nothing at all, so "is this drawn" is only a real
      // question inside the open one.
      await page.evaluate(() => window.__lahe.rail.selectTab("done"));

      const card = await page.evaluate((id) => {
        const node = window.__lahe.rail.cardNode(id);
        // Rendered at all, ancestors included. A computed display of its own
        // says nothing about a button inside a hidden row.
        const visible = (el) => !!el && el.getClientRects().length > 0;
        // What the reviewer actually reads. NOT textContent, which counts the
        // Active row that is attached-but-not-drawn and the injected stylesheets
        // as text; and not innerText either, which falls back to textContent for
        // content this deep in nested closed shadow roots.
        const visibleText = (root) => {
          let out = "";
          const walk = (el) => {
            if (el.tagName === "STYLE" || el.tagName === "SCRIPT") return;
            if (window.getComputedStyle(el).display === "none") return;
            el.childNodes.forEach((child) => {
              if (child.nodeType === 3) out += child.nodeValue;
              else if (child.nodeType === 1) walk(child);
            });
          };
          walk(root);
          return out;
        };

        return {
          text: visibleText(node),
          // The Active tab's row is still ATTACHED (withdrawing a node from a
          // card the reviewer may be typing in is the rail's own law), and it is
          // not DRAWN on a card that moved to Done.
          activeRowAttached: !!node.querySelector("[data-lahe-active-row]"),
          activeRowVisible: visible(node.querySelector("[data-lahe-active-row]")),
          // The note is the rewording surface, so "no rewording a handled item"
          // is now a claim about the note rather than about a button.
          noteAttached: !!node.querySelector(".lahe-rail-note"),
          noteVisible: visible(node.querySelector(".lahe-rail-note")),
          deleteVisible: visible(node.querySelector('[data-lahe-act="delete"]')),
          reopenVisible: visible(node.querySelector(".lahe-done-row .cardact"))
        };
      }, item.id);

      const times = (haystack, needle) => haystack.split(needle).length - 1;
      expect(times(card.text, NOTE), "the reviewer's own words, once").toBe(1);
      expect(times(card.text, SAID), "what the agent said, once").toBe(1);
      expect(times(card.text, FILE), "the file it touched, once").toBe(1);

      expect(card.activeRowAttached, "the row is never withdrawn from a card").toBe(true);
      expect(card.activeRowVisible, "and it is not drawn on a card in Done").toBe(false);
      expect(card.noteAttached, "the row is never withdrawn, so the note is still there").toBe(true);
      expect(card.noteVisible, "but rewording makes no sense on a handled item, so it is not drawn").toBe(false);
      expect(card.deleteVisible, "and neither does Delete").toBe(false);
      expect(card.reopenVisible, "Done keeps Reopen").toBe(true);
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });

  // --- F5b: the same defect on a handled HAND EDIT ---------------------------
  //
  // A handled edit card carries TWO rows, the Edits tab's and the Done tab's,
  // and both used to print the change summary: once at the top of the card,
  // once under the before-and-after, with the diff itself saying it a third
  // time in between. The two things the reviewer can do about it were at
  // opposite ends, Reopen at the top and Undo at the bottom.

  /** Make a real hand edit on the page, the way a reviewer makes one. */
  async function handEditOn(page, selector, tail) {
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const range = document.createRange();
      range.setStart(el.firstChild, 0);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    }, selector);
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
    }, selector);
    await page.keyboard.type(tail);
    await page.keyboard.press("Escape");
    await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
      message: "the edit to commit"
    });
    return page.evaluate((sel) => window.__lahe.itemForElement(sel), selector);
  }

  test("a handled hand edit says the change once and keeps Reopen and Undo together", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const SAID = "Rewrote the paragraph to name the number once.";
      const item = await handEditOn(page, REGION.rest, " Say that out loud in the app.");
      expect(item, "the hand edit reached the store").toBeTruthy();

      await fold(page, item, { status: "handled", agent: "claude", reason: SAID, files: [] }, "handled");
      await pollPage(page, (id) => window.__lahe.rail.getCard(id).pane === "done", item.id, {
        message: "the card to move to the Done pane"
      });
      await page.evaluate(() => window.__lahe.rail.selectTab("done"));

      const card = await page.evaluate((id) => {
        const node = window.__lahe.rail.cardNode(id);
        const visible = (el) => !!el && el.getClientRects().length > 0;
        const visibleText = (root) => {
          let out = "";
          const walk = (el) => {
            if (el.tagName === "STYLE" || el.tagName === "SCRIPT") return;
            if (window.getComputedStyle(el).display === "none") return;
            el.childNodes.forEach((child) => {
              if (child.nodeType === 3) out += child.nodeValue;
              else if (child.nodeType === 1) walk(child);
            });
          };
          walk(node);
          return out;
        };
        const reopen = Array.from(node.querySelectorAll(".cardact")).filter(
          (b) => b.textContent === "Reopen"
        )[0];
        const undo = node.querySelector('[data-lahe-act="undo"]');
        return {
          text: visibleText(node),
          summary: node.querySelector(".lahe-edits__said")
            ? node.querySelector(".lahe-edits__said").textContent
            : "",
          // The Done row is still ATTACHED, the rail's own law, and it draws
          // nothing on a hand-edit card because it has nothing left to say.
          doneSaidVisible: visible(node.querySelector(".lahe-done-said")),
          reopenVisible: visible(reopen),
          undoVisible: visible(undo),
          // The one thing this test is really about: one footer, both buttons.
          sameFooter: !!reopen && !!undo && reopen.parentNode === undo.parentNode,
          // Reopen reads first: keeping the change is the ordinary answer.
          reopenFirst: !!reopen && reopen.parentNode.firstElementChild === reopen,
          // The summary heads the diff rather than trailing it.
          summaryBeforePair: (() => {
            const said = node.querySelector(".lahe-edits__said");
            const pair = node.querySelector(".lahe-edits__pair");
            if (!said || !pair) return false;
            return !!(said.compareDocumentPosition(pair) & Node.DOCUMENT_POSITION_FOLLOWING);
          })()
        };
      }, item.id);

      const times = (haystack, needle) => haystack.split(needle).length - 1;
      expect(card.summary, "the card carries a change summary").not.toBe("");
      expect(times(card.text, card.summary), "the change summary, once").toBe(1);
      expect(times(card.text, SAID), "what the agent said, once").toBe(1);
      expect(card.doneSaidVisible, "and the Done row does not say it a second time").toBe(false);
      expect(card.summaryBeforePair, "the summary heads the before-and-after").toBe(true);
      expect(card.reopenVisible, "Reopen is on the card").toBe(true);
      expect(card.undoVisible, "so is Undo").toBe(true);
      expect(card.sameFooter, "and they are one button group, not two ends of a card").toBe(true);
      expect(card.reopenFirst, "Reopen reads first").toBe(true);
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
