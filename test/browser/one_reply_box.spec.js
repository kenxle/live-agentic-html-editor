// One reply box per thread, at the bottom, under the newest message.
//
// Ken, on a card that showed "Add another message" with Send and then, right
// under it, "Follow up" with its own button: "that's confusing UX". And then:
// "two response boxes show up in every thread, one below my last response, and
// one below the latest claude response. we should only have the one at the
// bottom."
//
// The two boxes mean different things, and only one is ever drawn:
//
//   ADD ANOTHER MESSAGE  the newest reviewer message is still waiting on the
//                        agent. It appends to that message (comments.appendToNote).
//   FOLLOW UP            the agent has answered the newest message. It archives
//                        the answered exchange and opens a new round
//                        (record.followUp).
//
// The rule was already right in tab_active's updateRow, which sets `hidden` on
// the add box once a reply lands. The stylesheet then drew the box anyway:
// `.lahe-rail-add{display:flex}` beats the browser's own `[hidden]` rule, so
// `hidden` was true and the box was on screen, under the reviewer's note and
// above the agent's reply. A handled card hid it by accident, through the rule
// that hides the whole active row on a handled card. A question reply and a
// not-handled reply keep the card out of handled, so those showed both boxes.
// Every check here is about what is DRAWN, not about the attribute, because the
// attribute was right all along.
//
// Screenshots: set LAHE_SHOT_DIR to a folder and each case saves its card there
// in light and dark. Without it nothing is written.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { test, expect, pollPage, pollUntil, startService, readEventLog, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "one-reply-box-review";
const SHOT_DIR = process.env.LAHE_SHOT_DIR || null;

function appendReply(helper, fields) {
  const file = path.join(helper.stateDir, "reviews", REVIEW, "replies-claude.jsonl");
  fs.appendFileSync(file, JSON.stringify(fields) + "\n");
}

async function startBoth() {
  const app = await startAppServer();
  const helper = await startService({
    entry: SERVICE_ENTRY,
    args: ["--port", "0"],
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

async function commentOnLede(page, text) {
  await page.evaluate(() => {
    const range = document.createRange();
    range.selectNodeContents(document.querySelector("p.lede"));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  });
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
    message: "the comment box to open on the passage"
  });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  const items = await page.evaluate(() => window.__lahe.items());
  return items[0];
}

function waitForRevInLog(helper, itemId, rev) {
  return pollUntil(
    () => {
      const lines = readEventLog(helper.stateDir, REVIEW);
      return lines.some((e) => e.item === itemId && e.record && e.rev === rev) ? lines : null;
    },
    { message: "revision " + rev + " to reach the helper's log" }
  );
}

/** The agent answers the item's current revision with one appended line. */
async function agentAnswers(page, helper, id, status, text) {
  const item = await page.evaluate((itemId) => window.__lahe.itemById(itemId), id);
  await waitForRevInLog(helper, id, item.rev);
  const line = { item: id, rev: item.rev, status, agent: "claude", text };
  // A not-handled reply has to say why, or the helper refuses it.
  if (status === "not_handled") line.reason = "the wording is your call, so I left it";
  appendReply(helper, line);
  await pollPage(page, (itemId) => window.__lahe.itemById(itemId).reply !== null, id, {
    message: "the " + status + " reply to fold onto the card"
  });
}

/** The reviewer types into the Follow up box and sends it. */
async function reviewerFollowsUp(page, id, text) {
  const before = await page.evaluate((itemId) => window.__lahe.itemById(itemId).thread.length, id);
  await page.evaluate(
    (args) => {
      const input = window.__lahe.handle.doneTab().focusFollowup(args.id);
      input.value = args.text;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
    },
    { id, text }
  );
  await pollPage(
    page,
    (args) => {
      const item = window.__lahe.itemById(args.id);
      return item.reply === null && item.thread.length === args.before + 1;
    },
    { id, before },
    { message: "the follow-up to open a new round" }
  );
}

/** A thread with `rounds` complete back-and-forths, ending on a reviewer message. */
async function longThread(page, helper, rounds) {
  const item = await commentOnLede(page, "Make this headline shorter.");
  const statuses = ["handled", "question", "not_handled"];
  for (let i = 0; i < rounds; i += 1) {
    await agentAnswers(page, helper, item.id, statuses[i % statuses.length], "Reply number " + (i + 1) + ".");
    await reviewerFollowsUp(page, item.id, "Reviewer message number " + (i + 2) + ".");
  }
  return item;
}

/**
 * Which reply boxes the reviewer can actually see on this card, and whether the
 * one they see sits under every message.
 *
 * Looks at layout, not at the `hidden` attribute: the bug was an attribute that
 * said hidden over a box that was drawn. The card's pane is selected first so a
 * handled card (which lives in Done) is on screen to be measured at all.
 */
function boxesOnCard(page, id) {
  return page.evaluate((itemId) => {
    const rail = window.__lahe.rail;
    const card = rail.getCard(itemId);
    if (card && card.pane) rail.selectTab(card.pane);
    const node = rail.cardNode(itemId);
    if (!node) return null;
    function drawn(el) {
      if (!el) return false;
      if (typeof el.checkVisibility === "function") return el.checkVisibility();
      return el.getClientRects().length > 0;
    }
    // Every message on the card, whoever wrote it: earlier rounds' turns, the
    // reviewer's current note, the agent's current reply, and a question block.
    // Rounds the rail has folded still count, because they are still above.
    const messages = Array.from(
      node.querySelectorAll(".lahe-thread-turn, .lahe-rail-note, .agent, .lahe-ask")
    ).filter((m) => m.textContent.trim() !== "");
    const box = Array.from(node.querySelectorAll(".lahe-rail-add, .lahe-followup")).filter(drawn)[0] || null;
    const follows = (a, b) => !!(b.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING);
    return {
      pane: card && card.pane,
      state: card && card.state,
      messages: messages.length,
      newest: messages.length ? messages[messages.length - 1].textContent : null,
      boxIsLast: !!box && messages.every((m) => follows(box, m)),
      add: drawn(node.querySelector(".lahe-rail-add")),
      followUp: drawn(node.querySelector(".lahe-followup")),
      visibleInputs: Array.from(node.querySelectorAll("textarea")).filter(drawn).length,
      buttons: Array.from(node.querySelectorAll("button:not(.carddisclose)"))
        .filter(drawn)
        .map((b) => b.textContent.trim())
    };
  }, id);
}

async function waitForBoxes(page, id, want, message) {
  await pollPage(
    page,
    (args) => {
      const rail = window.__lahe.rail;
      const card = rail.getCard(args.id);
      if (card && card.pane) rail.selectTab(card.pane);
      const node = rail.cardNode(args.id);
      if (!node) return false;
      const vis = (el) => !!el && el.checkVisibility();
      return (
        vis(node.querySelector(".lahe-rail-add")) === args.want.add &&
        vis(node.querySelector(".lahe-followup")) === args.want.followUp
      );
    },
    { id, want },
    { message }
  );
}

/** One box, under the newest message. `kind` is "add" or "followUp". */
async function expectOneBoxLast(page, id, kind) {
  const want = { add: kind === "add", followUp: kind === "followUp" };
  await waitForBoxes(page, id, want, "only the " + kind + " box on the card");
  const boxes = await boxesOnCard(page, id);
  expect(boxes.visibleInputs, "exactly one box on the card").toBe(1);
  expect(boxes.add).toBe(want.add);
  expect(boxes.followUp).toBe(want.followUp);
  expect(boxes.boxIsLast, "the box sits under the newest message").toBe(true);
  if (kind === "add") {
    expect(boxes.buttons).toContain("Send");
    expect(boxes.buttons).not.toContain("Follow up");
  } else {
    expect(boxes.buttons).toContain("Follow up");
    expect(boxes.buttons).not.toContain("Send");
  }
  return boxes;
}

async function shoot(page, id, name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  for (const scheme of ["light", "dark"]) {
    await page.evaluate((s) => {
      const bg = s === "dark" ? "#12151a" : "";
      document.documentElement.style.background = bg;
      document.body.style.background = bg;
      window.__lahe.rail.refreshScheme();
    }, scheme);
    const box = await page.evaluate((itemId) => {
      const node = window.__lahe.rail.cardNode(itemId);
      node.scrollIntoView({ block: "start" });
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    }, id);
    const pad = 8;
    await page.screenshot({
      path: path.join(SHOT_DIR, name + "-" + scheme + ".png"),
      clip: {
        x: Math.max(0, box.x - pad),
        y: Math.max(0, box.y - pad),
        width: box.width + pad * 2,
        height: box.height + pad * 2
      }
    });
  }
  await page.evaluate(() => {
    document.documentElement.style.background = "";
    document.body.style.background = "";
    window.__lahe.rail.refreshScheme();
  });
}

test.describe("one reply box per card", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
  });

  test("a sent comment nobody has answered shows Add another message, and no Follow up", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const item = await commentOnLede(page, "Make this headline shorter.");
      await waitForRevInLog(helper, item.id, 1);
      const boxes = await expectOneBoxLast(page, item.id, "add");
      expect(boxes.buttons).toEqual(["Delete", "Send"]);
      await shoot(page, item.id, "waiting-on-agent");
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  for (const status of ["question", "not_handled", "handled"]) {
    test("a " + status + " reply shows Follow up, and no Add another message", async ({ page }) => {
      const { app, helper, token } = await startBoth();
      try {
        await bootedPage(page, app, helper, token);
        const item = await commentOnLede(page, "Make this headline shorter.");
        await agentAnswers(
          page,
          helper,
          item.id,
          status,
          status === "question" ? "Which headline, the page's or the section's?" : "Looked at it."
        );
        await expectOneBoxLast(page, item.id, "followUp");
        await shoot(page, item.id, "answered-" + status.replace("_", "-"));
      } finally {
        await helper.kill9();
        await app.close();
      }
    });
  }

  test("after a follow-up, the newer message waits on the agent: Add another message comes back, Follow up goes", async ({
    page
  }) => {
    // The card holds an answered exchange AND a newer unanswered message. The
    // newest message decides the box.
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const item = await commentOnLede(page, "Make this headline shorter.");
      await agentAnswers(page, helper, item.id, "question", "Which headline?");
      await expectOneBoxLast(page, item.id, "followUp");

      await reviewerFollowsUp(page, item.id, "The page heading.");
      const after = await page.evaluate((id) => window.__lahe.itemById(id), item.id);
      expect(after.thread.length, "the answered exchange is kept as a round").toBe(1);
      expect(after.note).toBe("The page heading.");

      await expectOneBoxLast(page, item.id, "add");
      await shoot(page, item.id, "followed-up-waiting");
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});

test.describe("one reply box at the bottom of a long thread", () => {
  // Three full back-and-forths, so the card carries three archived rounds above
  // the current turn, and then each way the newest message can end.
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 1400 });
  });

  test("ending on the reviewer's message: one Add another message box, under it", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      const item = await longThread(page, helper, 3);
      const boxes = await expectOneBoxLast(page, item.id, "add");
      expect(boxes.messages, "three rounds of two turns, plus the newest note").toBeGreaterThanOrEqual(7);

      // Adding to the waiting message keeps it one message, and still one box.
      await page.evaluate((id) => {
        const input = window.__lahe.rail.cardNode(id).querySelector(".lahe-rail-add textarea");
        input.value = "And one more thought.";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
      }, item.id);
      await pollPage(page, (id) => /one more thought/.test(window.__lahe.itemById(id).note || ""), item.id, {
        message: "the added message to join the waiting note"
      });
      const after = await page.evaluate((id) => window.__lahe.itemById(id), item.id);
      expect(after.thread.length, "adding opens no round").toBe(3);
      await expectOneBoxLast(page, item.id, "add");
      await shoot(page, item.id, "long-thread-waiting-on-agent");
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  for (const status of ["question", "not_handled", "handled"]) {
    test("ending on a " + status + " reply: one Follow up box, under it", async ({ page }) => {
      const { app, helper, token } = await startBoth();
      try {
        await bootedPage(page, app, helper, token);
        const item = await longThread(page, helper, 3);
        await agentAnswers(page, helper, item.id, status, "The newest reply, number 4.");
        const boxes = await expectOneBoxLast(page, item.id, "followUp");
        expect(boxes.messages).toBeGreaterThanOrEqual(8);
        // The box is under the newest message only if that message is on the
        // card at all. The reviewer's focus is still inside this card from the
        // follow-up they just sent, which is when a question used to go missing.
        expect(boxes.newest, "the newest reply is drawn above the box").toContain("The newest reply, number 4.");
        await shoot(page, item.id, "long-thread-answered-" + status.replace("_", "-"));
      } finally {
        await helper.kill9();
        await app.close();
      }
    });
  }
});
