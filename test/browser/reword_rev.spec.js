// One rewording is ONE revision.
//
// The walk on 2026-08-14 reworded a single sentence and watched rev go 1 -> 29:
// a bump per keystroke. The contract (docs/CONTRACTS.md: "rev, monotonic and
// bumped on every rewording"; drafts do not bump) means a rewording SESSION is
// one bump, at the commit.
//
// The bug is not cosmetic. An agent's reply echoes the rev it read, and a reply
// naming an older rev is refused as stale (R21). With rev racing per keystroke,
// every reply is refused the moment the reviewer touches the box again, and the
// stale-refusal protection turns into reply-blocking noise. So this spec asserts
// the arithmetic AND what it protects: at the committed rev the agent's answer
// lands, and only a genuinely older rev is refused.
//
// It runs on the real app fixture with a real helper, and the rewording is made
// the way a reviewer makes it: pressing the card's own Reword button at its
// on-screen geometry, typing, and pressing Cmd-Enter.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  startService,
  readEventLog,
  SERVICE_ENTRY
} = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "reword-rev-review";
const EPHEMERAL_PORT = ["--port", "0"];

const FIRST = "shorten this";
// Well over the twenty keystrokes it takes to make the old behaviour obvious.
const REWORDED = "shorten this, and lead with the number of clients";

function replyPath(helper, filename) {
  return path.join(helper.stateDir, "reviews", REVIEW, filename);
}

function appendReply(helper, filename, fields) {
  fs.appendFileSync(replyPath(helper, filename), JSON.stringify(fields) + "\n");
}

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
}

/** The card's own Reword button, where it really is on screen. */
function rewordButtonInfo(page, id) {
  return page.evaluate((itemId) => {
    const card = window.__lahe.rail.cardNode(itemId);
    if (!card) return null;
    const button = card.querySelector("[data-lahe-act='reword']");
    if (!button) return null;
    button.scrollIntoView({ block: "center" });
    const rect = button.getBoundingClientRect();
    return {
      visible: rect.width > 0 && rect.height > 0,
      cx: rect.x + rect.width / 2,
      cy: rect.y + rect.height / 2
    };
  }, id);
}

function itemById(page, id) {
  return page.evaluate((itemId) => window.__lahe.itemById(itemId), id);
}

test.describe("R21: one rewording moves rev exactly once", () => {
  test("typing a reword does not race rev; the commit bumps it once, and the agent can answer it", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", FIRST);

      const first = (await page.evaluate(() => window.__lahe.items()))[0];
      expect(first.state).toBe("ready");
      const revBefore = first.rev;

      // The reviewer's own gesture: the card's Reword button, pressed.
      const button = await rewordButtonInfo(page, first.id);
      expect(button, "the card offers Reword").toBeTruthy();
      expect(button.visible, "and it is on screen").toBe(true);
      await page.mouse.click(button.cx, button.cy);
      await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, {
        message: "the reword box to open on the card"
      });

      // Replace the words, one keystroke at a time, the way a hand does.
      await page.keyboard.press("ControlOrMeta+KeyA");
      await page.keyboard.type(REWORDED, { delay: 15 });

      // MID-SENTENCE: the revision has not moved. This is the assertion the
      // per-keystroke bump fails on, long before the commit.
      const midway = await itemById(page, first.id);
      expect(midway.note, "the typing is durable at once, as it always was").toBe(REWORDED);
      expect(
        midway.rev,
        "an uncommitted rewording is content, not a revision: rev has not moved yet"
      ).toBe(revBefore);

      await page.keyboard.press("ControlOrMeta+Enter");
      await pollPage(page, (args) => window.__lahe.itemById(args[0]).rev > args[1], [first.id, revBefore], {
        message: "the commit to bump the revision"
      });

      const after = await itemById(page, first.id);
      expect(after.rev, "one rewording, one bump").toBe(revBefore + 1);
      expect(after.note, "and the note is the whole new sentence").toBe(REWORDED);
      expect(after.state).toBe("ready");
      // The applied-after history records what was committed, never the
      // intermediate keystrokes.
      expect((after.after_history || []).length, "no history entry per keystroke").toBeLessThanOrEqual(1);

      // What the revision is FOR. The file the agent reads carries rev 2.
      await pollUntil(
        () => {
          const item = projectedItems(reviewJson(helper)).find((i) => i.id === first.id);
          return item && item.rev === revBefore + 1 ? item : null;
        },
        {
          message: "the rewording to reach the file the agent reads",
          describe: () => ({
            projected: projectedItems(reviewJson(helper)).map((i) => ({ id: i.id, rev: i.rev }))
          })
        }
      );

      // An answer naming the revision it read: refused, and the item stays
      // outstanding.
      appendReply(helper, "replies-stale.jsonl", {
        item: first.id,
        rev: revBefore,
        status: "handled",
        agent: "stale"
      });
      const refused = await pollUntil(
        () => {
          const folds = readEventLog(helper.stateDir, REVIEW).filter((e) => e.event === "reply.folded");
          return folds.length ? folds[folds.length - 1] : null;
        },
        { message: "the stale reply to be folded" }
      );
      expect(refused.accepted, "the older revision is refused").toBe(false);
      expect(refused.refusal).toContain("rev " + revBefore);

      // And the answer naming the COMMITTED revision lands. This is the half the
      // per-keystroke bump destroyed: with rev racing, the number an agent read
      // one keystroke ago was already stale, so nothing could ever be answered.
      appendReply(helper, "replies-current.jsonl", {
        item: first.id,
        rev: revBefore + 1,
        status: "handled",
        agent: "current",
        files: ["app/views/home.html.erb"]
      });
      await pollPage(page, (id) => window.__lahe.itemById(id).state === "handled", first.id, {
        message: "the reply at the committed revision to be accepted"
      });
      const handled = await itemById(page, first.id);
      expect(handled.reply.agent).toBe("current");
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});
