// Folding a card down to one line, in a real browser, on a real review.
//
// Ken, 2026-09-15: "I'm scrolling through comments a lot now. We should make
// individual comments in a thread collapsible, so I can close them down to a
// single line when I'm doing a lot of chatting across lots of different things."
//
// The rail is a CLOSED shadow root, so every press below is a real mouse click
// at a control's own reported geometry, and everything read back is read off the
// real nodes. The agent is the real one: one appended JSON line, which is all an
// agent is allowed to do.
//
// The one reading rule this changes has its own test here, because it is the
// only way folding can hurt the reviewer: a card folded to one line must not
// count as read, or an answer disappears without ever being on screen.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { test, expect, pollPage, pollUntil, startService, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "card-collapse-review";
const EPHEMERAL_PORT = ["--port", "0"];

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

// --- the agent's whole API ----------------------------------------------------

function appendReply(helper, fields) {
  fs.appendFileSync(
    path.join(helper.stateDir, "reviews", REVIEW, "replies-claude.jsonl"),
    JSON.stringify(fields) + "\n"
  );
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

/** Wait until the helper has projected this item, and hand it back. */
function projected(helper, itemId) {
  return pollUntil(
    () => {
      const got = projectedItems(reviewJson(helper)).find((item) => item.id === itemId);
      return got || null;
    },
    {
      message: "the record to reach review.json",
      describe: () => ({ items: projectedItems(reviewJson(helper)).length })
    }
  );
}

// --- the reviewer's gestures --------------------------------------------------

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
  await pollPage(page, (want) => window.__lahe.items().some((i) => i.note === want), text, {
    message: "the comment to become a record"
  });
  const items = await page.evaluate(() => window.__lahe.items());
  return items.find((item) => item.note === text);
}

// --- reading a closed root back ------------------------------------------------

/** What the card looks like right now, measured rather than assumed. */
function cardShape(page, id) {
  return page.evaluate((itemId) => {
    const node = window.__lahe.rail.cardNode(itemId);
    if (!node) return null;
    const box = node.getBoundingClientRect();
    const shown = (selector) => {
      const part = node.querySelector(selector);
      if (!part) return null;
      const r = part.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    };
    const lineText = node.querySelector(".card__linetext");
    return {
      folded: node.getAttribute("data-lahe-collapsed") === "true",
      height: Math.round(box.height),
      lineShown: shown(".card__line"),
      line: lineText ? lineText.textContent : null,
      quoteShown: shown(".card__quote"),
      bodyShown: shown(".card__body"),
      agentShown: shown(".agent"),
      threadShown: shown(".lahe-thread"),
      newTag: shown(".card__tag--new"),
      askTag: shown(".card__tag--ask"),
      expanded: node.querySelector(".carddisclose").getAttribute("aria-expanded"),
      unseen: node.getAttribute("data-lahe-unseen") === "true"
    };
  }, id);
}

/**
 * Wait until the card is drawn where the reviewer is looking.
 *
 * A card whose reply just landed moves from Active to Done on the rail's next
 * repaint, and until that repaint the one card node is still parented in a pane
 * the tab strip has already left. A pane that is not the current one is
 * display:none, so everything measured inside it is zero and everything read
 * off it is the card as it was. Chromium happened to run that repaint before
 * the next read and the other two do not, which is a race rather than a
 * difference: the move lands inside a frame in all three. So the wait is for
 * the card to be ON SCREEN, which is the state the assertions below are about.
 */
function cardOnScreen(page, id) {
  return pollPage(
    page,
    (cardId) => {
      const node = window.__lahe.rail.cardNode(cardId);
      if (!node) return false;
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    },
    id,
    { message: "the card to be drawn on the tab the reviewer is looking at" }
  );
}

/** The chevron's own geometry, so the press below is a real click on it. */
async function clickChevron(page, id) {
  const rect = await page.evaluate((itemId) => {
    const node = window.__lahe.rail.cardNode(itemId);
    const button = node.querySelector(".carddisclose");
    button.scrollIntoView({ block: "center" });
    const r = button.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, id);
  expect(rect.width, "the chevron to be on screen").toBeGreaterThan(0);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}

/** A press on the card's contents, which is still the jump gesture. */
async function clickCardBody(page, id) {
  const rect = await page.evaluate((itemId) => {
    const r = window.__lahe.rail.cardNode(itemId).getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  }, id);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height - 4);
}

function menuInfo(page) {
  return page.evaluate(() => window.__lahe.rail.menuInfo());
}

async function chooseMenuItem(page, label) {
  let info = await menuInfo(page);
  if (!info.open) {
    const at = info.rect;
    await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
    info = await pollUntil(
      async () => {
        const got = await menuInfo(page);
        return got.open ? got : null;
      },
      { message: "the header menu to open on a click" }
    );
  }
  // The fold actions live under the View group, which opens in place.
  if (!info.items.some((one) => one.label === label)) {
    const group = info.items.filter((one) => one.label === "View")[0];
    if (group) {
      await page.mouse.click(group.rect.x + group.rect.width / 2, group.rect.y + group.rect.height / 2);
      info = await menuInfo(page);
    }
  }
  const item = info.items.filter((one) => one.label === label)[0];
  expect(item, "a menu item labelled " + label).toBeTruthy();
  await page.mouse.click(item.rect.x + item.rect.width / 2, item.rect.y + item.rect.height / 2);
}

function foldedIds(page) {
  return page.evaluate(() => window.__lahe.rail.collapsedCardIds().slice().sort());
}

test.describe("a card folds to one line", () => {
  test("the head folds it, the chevron opens it, and the contents still jump", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const item = await commentOn(page, "p.lede", "cut this to one sentence");
      // A second passage, far enough down the page that arriving at it is a real
      // scroll. Made now, before anything is pressed in the rail: the comment
      // chord needs the page's own focus and a selection in it.
      const below = await commentOn(page, "#feed-queue p", "this queue is longer than the day is");

      const open = await cardShape(page, item.id);
      expect(open.folded, "a card starts open").toBe(false);
      expect(open.expanded).toBe("true");
      expect(open.quoteShown, "the passage is on screen").toBe(true);
      expect(open.lineShown, "and the folded line is not").toBe(false);

      // A press on the chevron folds it.
      await clickChevron(page, item.id);
      const folded = await cardShape(page, item.id);
      expect(folded.folded).toBe(true);
      expect(folded.expanded).toBe("false");
      expect(folded.lineShown, "the one line is what is left").toBe(true);
      expect(folded.line, "and it says what the card is about").toContain("Nine clients checked in");
      expect(folded.quoteShown, "the passage is put away").toBe(false);
      expect(folded.bodyShown, "and so is everything the tabs drew").toBe(false);
      expect(folded.height, "a folded card is one row").toBeLessThan(open.height);

      // And a press on the chevron opens it again.
      await clickChevron(page, item.id);
      const reopened = await cardShape(page, item.id);
      expect(reopened.folded).toBe(false);
      expect(reopened.quoteShown).toBe(true);
      expect(reopened.lineShown).toBe(false);

      // The head, anywhere on it, is the same gesture. This is the half that has
      // to not break the jump: a press on the CONTENTS still goes to the page.
      // The press lands on the strip's empty middle: the state chip at its
      // right end is a control of its own on an outstanding card (Mark as
      // done), so a press there opens the chip's menu instead.
      const headRect = await page.evaluate((id) => {
        const r = window.__lahe.rail
          .cardNode(id)
          .querySelector("[data-lahe-card-head] .spacer")
          .getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, item.id);
      expect(headRect.width, "the head strip has empty room to press").toBeGreaterThan(4);
      await page.mouse.click(headRect.x + headRect.width / 2, headRect.y + headRect.height / 2);
      expect((await cardShape(page, item.id)).folded, "a press on the head strip folds it").toBe(true);

      await clickChevron(page, item.id);
      await page.evaluate(() => window.scrollTo(0, 0));
      await pollPage(page, () => window.scrollY === 0, undefined, { message: "the page back at the top" });
      await clickCardBody(page, below.id);
      await pollPage(page, () => window.scrollY > 0, undefined, {
        message: "a press on the card's contents to jump to the passage"
      });
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("the chevron takes the keyboard, and Enter and Space both fold it", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const item = await commentOn(page, "p.lede", "cut this to one sentence");

      await page.evaluate((id) => {
        window.__lahe.rail.cardNode(id).querySelector(".carddisclose").focus();
      }, item.id);
      const holdsIt = await page.evaluate((id) => {
        const node = window.__lahe.rail.cardNode(id);
        return node.getRootNode().activeElement === node.querySelector(".carddisclose");
      }, item.id);
      expect(holdsIt, "the chevron takes focus").toBe(true);

      await page.keyboard.press("Enter");
      expect((await cardShape(page, item.id)).folded, "Enter folds it").toBe(true);
      await page.keyboard.press("Space");
      expect((await cardShape(page, item.id)).folded, "Space opens it").toBe(false);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a fold survives a reload, per card", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const first = await commentOn(page, "p.lede", "cut this to one sentence");
      const second = await commentOn(page, "#feed-queue p", "this queue is longer than the day is");

      await clickChevron(page, first.id);
      expect(await foldedIds(page)).toEqual([first.id]);

      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again"
      });
      await pollPage(page, (id) => !!window.__lahe.rail.cardNode(id), first.id, {
        message: "the cards to come back from storage"
      });

      expect(await foldedIds(page), "the fold came back with the review").toEqual([first.id]);
      expect((await cardShape(page, first.id)).folded).toBe(true);
      expect((await cardShape(page, second.id)).folded, "the card beside it is still open").toBe(false);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("Collapse all and Expand all act on the tab the reviewer is looking at", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const first = await commentOn(page, "p.lede", "cut this to one sentence");
      const second = await commentOn(page, "#feed-queue p", "this queue is longer than the day is");

      await chooseMenuItem(page, "Collapse all cards");
      expect(await foldedIds(page)).toEqual([first.id, second.id].sort());
      expect((await cardShape(page, first.id)).folded).toBe(true);
      expect((await cardShape(page, second.id)).folded).toBe(true);

      await chooseMenuItem(page, "Expand all cards");
      expect(await foldedIds(page)).toEqual([]);
      expect((await cardShape(page, second.id)).folded).toBe(false);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});

test.describe("a folded card is not a card anyone has read", () => {
  test("a reply arriving on a folded card says 1 new, and opening it is the reading", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const item = await commentOn(page, "p.lede", "cut this to one sentence");
      const entry = await projected(helper, item.id);

      // Folded, and the reviewer is sitting on the tab the reply will land in.
      await clickChevron(page, item.id);
      expect((await cardShape(page, item.id)).folded).toBe(true);

      appendReply(helper, {
        item: entry.id,
        rev: entry.rev,
        status: "handled",
        agent: "claude",
        user_needs_to_see_reply: true,
        text: "done, but I left the second number in because it carries the point"
      });

      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the reply to fold onto the record through the poll loop"
      });
      await page.evaluate(() => window.__lahe.rail.selectTab("done"));

      // THE POINT. The reviewer has now visited the tab the card is on, and the
      // answer is still unread: its words were never on the screen.
      await cardOnScreen(page, item.id);
      const waiting = await cardShape(page, item.id);
      expect(waiting.folded, "it stayed folded when the reply arrived").toBe(true);
      expect(waiting.newTag, "and it says there is something to read").toBe(true);
      expect(waiting.unseen, "the card keeps its unseen mark").toBe(true);
      expect(waiting.agentShown, "the answer itself is still put away").toBe(false);
      expect(
        await page.evaluate(() => window.__lahe.handle.doneTab().unseenIds()),
        "a visit to the tab did not mark a folded card read"
      ).toEqual([item.id]);

      // Opening it is the reading.
      await clickChevron(page, item.id);
      await pollPage(page, () => window.__lahe.handle.doneTab().unseenIds().length === 0, undefined, {
        message: "opening the card to mark its reply read"
      });
      const read = await cardShape(page, item.id);
      expect(read.folded).toBe(false);
      expect(read.agentShown, "the answer is on the screen").toBe(true);
      expect(read.newTag, "and the tag is gone with the fold").toBe(false);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  // Ken, 2026-10-12: "it's not clear when the 'needs to be seen' thing goes
  // away. I can read something and then close that card with the accordion and
  // it still says 'new'." Opening the card is the reading; folding it again
  // afterwards must not bring the tag back, here or after a reload.
  test("a reply read on an opened card stays read when the card is folded again", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const item = await commentOn(page, "p.lede", "cut this to one sentence");
      const entry = await projected(helper, item.id);

      await clickChevron(page, item.id);
      appendReply(helper, {
        item: entry.id,
        rev: entry.rev,
        status: "handled",
        agent: "claude",
        user_needs_to_see_reply: true,
        text: "done, but I left the second number in because it carries the point"
      });
      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the reply to fold onto the record through the poll loop"
      });
      await page.evaluate(() => window.__lahe.rail.selectTab("done"));
      await cardOnScreen(page, item.id);

      const badge = () => page.evaluate(() => window.__lahe.rail.tabNewCount("done"));
      const arrived = await cardShape(page, item.id);
      expect(arrived.newTag, "the folded card says 1 new").toBe(true);
      expect(await badge(), "and the Done badge counts it").toBe(1);

      // The reviewer opens it and reads it.
      await clickChevron(page, item.id);
      await pollPage(page, () => window.__lahe.handle.doneTab().unseenIds().length === 0, undefined, {
        message: "opening the card to mark its reply read"
      });
      expect(await badge(), "the badge drops the moment the card is open").toBe(0);

      // And folds it away again. THE POINT: nothing says new any more.
      await clickChevron(page, item.id);
      const refolded = await cardShape(page, item.id);
      expect(refolded.folded).toBe(true);
      expect(refolded.newTag, "a card read and folded again does not say 1 new").toBe(false);
      expect(refolded.unseen, "and wears no unread mark").toBe(false);
      expect(await badge(), "the badge stays down").toBe(0);

      // Read is durable: a reload does not bring the tag back.
      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again"
      });
      await pollPage(page, (id) => !!window.__lahe.rail.cardNode(id), item.id, {
        message: "the card to come back from storage"
      });
      await page.evaluate(() => window.__lahe.rail.selectTab("done"));
      await cardOnScreen(page, item.id);
      const reloaded = await cardShape(page, item.id);
      expect(reloaded.folded, "the fold came back with the review").toBe(true);
      expect(reloaded.newTag, "and the tag did not").toBe(false);
      expect(await badge()).toBe(0);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a folded card carrying a question says so", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const item = await commentOn(page, "p.lede", "cut this to one sentence");
      const entry = await projected(helper, item.id);

      appendReply(helper, {
        item: entry.id,
        rev: entry.rev,
        status: "question",
        agent: "claude",
        text: "which number do you want to lead with?"
      });
      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the question to fold onto the record"
      });
      await pollPage(page, (id) => window.__lahe.handle.doneTab().question(id) !== null, item.id, {
        message: "the question block to be drawn on the card"
      });

      await clickChevron(page, item.id);
      const folded = await cardShape(page, item.id);
      expect(folded.folded).toBe(true);
      expect(folded.askTag, "a folded card with an open question says question").toBe(true);
      expect(folded.newTag, "and says it once: a question is the louder of the two").toBe(false);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});

test.describe("a round of a thread folds too", () => {
  test("a three-round thread shows the newest open and the older rounds folded", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const item = await commentOn(page, "p.lede", "cut this to one sentence");

      // Three completed exchanges: the agent answers, the reviewer follows up,
      // twice. Every reply is a real appended line; every follow-up is the real
      // composer, which is what pushes the finished round into the thread.
      for (let round = 1; round <= 3; round += 1) {
        const entry = await pollUntil(
          () => {
            const got = projectedItems(reviewJson(helper)).find((one) => one.id === item.id);
            return got && got.rev === round ? got : null;
          },
          { message: "the record to reach review.json at rev " + round }
        );
        appendReply(helper, {
          item: entry.id,
          rev: entry.rev,
          status: "handled",
          agent: "claude",
          text: "answer number " + round + ", with enough words on it to need a line of its own"
        });
        await pollPage(
          page,
          (args) => {
            const got = window.__lahe.itemById(args[0]);
            return !!got.reply && got.reply.text.indexOf("answer number " + args[1]) === 0;
          },
          [item.id, round],
          { message: "reply " + round + " to fold onto the record" }
        );
        if (round === 3) break;
        await page.evaluate(
          (args) => window.__lahe.handle.doneTab().followUp(args[0], "follow up number " + args[1]),
          [item.id, round]
        );
        await pollPage(page, (args) => window.__lahe.itemById(args[0]).thread.length === args[1], [item.id, round], {
          message: "follow-up " + round + " to close a round into the thread"
        });
      }

      await page.evaluate(() => window.__lahe.rail.selectTab("done"));
      await cardOnScreen(page, item.id);
      const rounds = await page.evaluate((id) => {
        const thread = window.__lahe.handle.doneTab().thread(id);
        return {
          earlier: !!thread.querySelector(".lahe-thread-earlier"),
          rounds: Array.prototype.map.call(thread.querySelectorAll(".lahe-thread-round"), (node) => {
            const turns = node.querySelector(".lahe-round-turns");
            const r = turns.getBoundingClientRect();
            return {
              open: node.getAttribute("data-lahe-open") === "true",
              turnsShown: r.width > 0 && r.height > 0,
              sides: Array.prototype.map.call(node.querySelectorAll(".lahe-thread-turn"), (t) => t.getAttribute("data-side"))
            };
          })
        };
      }, item.id);

      expect(rounds.rounds.length, "two finished rounds are in the thread").toBe(2);
      // Two rounds is not a scroll, so both are open (roundStartsExpanded), and
      // there is nothing for an "earlier messages" line to hold.
      rounds.rounds.forEach((one, index) => {
        expect(one.open, "round " + index + " is open in a two-round thread").toBe(true);
        expect(one.turnsShown).toBe(true);
        expect(one.sides, "the reviewer on the right, then the agent on the left").toEqual(["you", "agent"]);
      });
      expect(rounds.earlier, "no earlier line on a short thread").toBe(false);

      // One more exchange makes it a scroll: now only the newest round is open.
      const entry = await pollUntil(
        () => {
          const got = projectedItems(reviewJson(helper)).find((one) => one.id === item.id);
          return got && got.rev === 3 ? got : null;
        },
        { message: "the third revision in review.json" }
      );
      await page.evaluate((id) => window.__lahe.handle.doneTab().followUp(id, "one more thing"), item.id);
      await pollPage(page, (id) => window.__lahe.itemById(id).thread.length === 3, item.id, {
        message: "the third round to close into the thread"
      });
      appendReply(helper, {
        item: entry.id,
        rev: 4,
        status: "handled",
        agent: "claude",
        text: "answer number 4, which is the one the reviewer came back for"
      });
      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the fourth reply to fold on"
      });

      const later = await page.evaluate((id) => {
        const thread = window.__lahe.handle.doneTab().thread(id);
        const earlier = thread.querySelector(".lahe-thread-earlier");
        return {
          earlier: earlier
            ? { text: earlier.textContent, expanded: earlier.getAttribute("aria-expanded"), first: thread.firstElementChild === earlier }
            : null,
          rounds: Array.prototype.map.call(thread.querySelectorAll(".lahe-thread-round"), (node) => ({
            open: node.getAttribute("data-lahe-open") === "true"
          }))
        };
      }, item.id);

      expect(later.rounds.length).toBe(3);
      expect(later.rounds[0].open, "the oldest round is folded once the thread is worth scrolling").toBe(false);
      expect(later.rounds[1].open, "and so is the one after it").toBe(false);
      expect(later.rounds[2].open, "the newest is what the reviewer came back for").toBe(true);
      // ONE line holds them, at the top of the thread, and says how many
      // messages are behind it: two rounds, two turns each.
      expect(later.earlier, "one earlier-messages line holds the folded rounds").not.toBeNull();
      expect(later.earlier.first, "and it sits at the top of the thread").toBe(true);
      expect(later.earlier.expanded).toBe("false");
      expect(later.earlier.text).toBe("Show 4 earlier messages");

      // And the reviewer can open them, by pressing that line.
      const opened = await page.evaluate((id) => {
        const thread = window.__lahe.handle.doneTab().thread(id);
        const earlier = thread.querySelector(".lahe-thread-earlier");
        earlier.click();
        const first = thread.querySelectorAll(".lahe-thread-round")[0];
        const turns = first.querySelector(".lahe-round-turns").getBoundingClientRect();
        return {
          open: Array.prototype.every.call(thread.querySelectorAll(".lahe-thread-round"), (n) => n.getAttribute("data-lahe-open") === "true"),
          turnsShown: turns.width > 0 && turns.height > 0,
          expanded: earlier.getAttribute("aria-expanded"),
          text: earlier.textContent
        };
      }, item.id);
      expect(opened.open, "every round is open").toBe(true);
      expect(opened.turnsShown, "the oldest round's turns are on the screen").toBe(true);
      expect(opened.expanded).toBe("true");
      expect(opened.text).toBe("Hide earlier messages");
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});
