// 3A: the agent loop, on a real page, with a real helper and real reply files.
//
// Ranked tests 10, 32 and 35, plus the question treatment.
//
// Everything an agent does here it does the way the contract says: it appends
// one JSON line to a file in the review's folder. There is no test-only route
// and no injected reply. What the reviewer sees comes off the real rail, in its
// closed shadow root, through the real poll loop.
//
//   REAL  the application: 0C's node app, serving its own HTML
//   REAL  the arrival: one script tag, and src/layer/index.js booting off it
//   REAL  the helper, and the per-review token it minted
//   REAL  the records: every one made by the reviewer's own gestures
//   REAL  the agent: `fs.appendFileSync` on replies-<name>.jsonl, nothing else

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

const REVIEW = "agent-loop-review";
const EPHEMERAL_PORT = ["--port", "0"];

// --- the agent's whole API ----------------------------------------------------

function replyPath(helper, filename) {
  return path.join(helper.stateDir, "reviews", REVIEW, filename);
}

/** One appended JSON line, which is everything an agent is allowed to do. */
function appendReply(helper, filename, fields) {
  fs.appendFileSync(replyPath(helper, filename), JSON.stringify(fields) + "\n");
}

/** A line cut in half by an agent writing while the helper reads. */
function appendTorn(helper, filename, fields) {
  const whole = JSON.stringify(fields) + "\n";
  fs.appendFileSync(replyPath(helper, filename), whole.slice(0, whole.length - 8));
  return whole.slice(whole.length - 8);
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

// --- the reviewer's gestures --------------------------------------------------

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

async function commentOnElement(page, selector, text) {
  await page.evaluate(() => window.getSelection().removeAllRanges());
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => window.__lahe.pickMode() === true, undefined, { message: "element-pick mode" });
  const box = await page.locator(selector).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + Math.min(12, box.height / 2));
  await pollPage(page, () => window.__lahe.pickMode() === false, undefined, { message: "the element to be picked" });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

async function untetheredNote(page, text) {
  await page.evaluate(() => window.__lahe.handle.tab().focusNote());
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

/**
 * Reword an item the way the reviewer does: reopen it, retype, and commit.
 *
 * The commit is not decoration. A rewording SESSION is one revision, so the
 * typing moves the words and the commit moves rev (R21); typing alone leaves the
 * item at the revision the agent already read, which is the point.
 */
async function reword(page, itemId, newText) {
  await page.evaluate((args) => {
    const box = window.__lahe.handle.comments.reopen(args[0]);
    box.type(args[1]);
    box.markReady();
    box.close();
  }, [itemId, newText]);
  await pollPage(page, (id) => window.__lahe.itemById(id).rev >= 2, itemId, {
    message: "the rewording to bump the revision"
  });
  return page.evaluate((id) => window.__lahe.itemById(id), itemId);
}

function itemsIn(page) {
  return page.evaluate(() => window.__lahe.items());
}

/** The rail is in a closed shadow root, so it answers about itself. */
function cardOf(page, id) {
  return page.evaluate((itemId) => {
    const card = window.__lahe.rail.getCard(itemId);
    if (!card) return null;
    return {
      state: card.state,
      pane: card.pane,
      notice: card.notice,
      agentMessage: card.agentMessage
    };
  }, id);
}

function doneTabState(page) {
  return page.evaluate(() => {
    const done = window.__lahe.handle.doneTab();
    return { rows: done.rowCount(), questions: done.questionIds(), counters: done.counters };
  });
}

async function bootedPage(page, app, helper, token) {
  app.useLayer({ review: REVIEW, token: token, helper: helper.url });
  await page.goto(app.urlFor("/?morph=off"));
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

/** Wait until an item's record has reached the helper's log. */
function waitForItemInLog(helper, itemId) {
  return pollUntil(
    () => {
      const lines = readEventLog(helper.stateDir, REVIEW);
      return lines.some((event) => event.item === itemId && event.record) ? lines : null;
    },
    {
      message: "the record to reach the helper's events.jsonl",
      describe: () => ({ events: readEventLog(helper.stateDir, REVIEW).length })
    }
  );
}

test.describe("3A: an agent answers by appending one line", () => {
  // --- ranked test 35 ---------------------------------------------------------

  test("an untethered note, an element comment and a selection comment each round-trip to review.json and back to a card", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);

      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      await commentOnElement(page, "#log-session", "this button is doing two jobs");
      await untetheredNote(page, "the whole page reads cold");

      const items = await itemsIn(page);
      expect(items.map((i) => i.kind).sort()).toEqual(["comment", "comment", "note"]);
      const byNote = {};
      items.forEach((item) => {
        byNote[item.note] = item;
      });

      // OUT: all three are in the file the agent reads, written by the helper
      // from its own log with no test touching it.
      const projection = await pollUntil(
        () => {
          const got = reviewJson(helper);
          return got && projectedItems(got).length === 3 ? got : null;
        },
        {
          message: "review.json to hold all three items",
          describe: () => ({ items: projectedItems(reviewJson(helper)).length })
        }
      );

      const projected = projectedItems(projection);
      const selection = projected.find((i) => i.note === "cut this to one sentence");
      const element = projected.find((i) => i.note === "this button is doing two jobs");
      const note = projected.find((i) => i.note === "the whole page reads cold");

      expect(selection.quote).toContain("Nine clients checked in this week");
      expect(selection.state).toBe("ready");
      expect(element.kind).toBe("comment");
      expect(element.context.element).toBeTruthy();
      expect(note.kind).toBe("note");
      expect(note.quote).toBeNull();
      expect(projection.pages).toHaveLength(1);
      expect(projection.pages[0].path).toBe("/");

      // BACK: the agent answers each one, by appending one line per item.
      appendReply(helper, "replies-claude.jsonl", {
        item: selection.id,
        rev: selection.rev,
        status: "handled",
        agent: "claude",
        files: ["app/views/home.html.erb"]
      });
      appendReply(helper, "replies-claude.jsonl", {
        item: element.id,
        rev: element.rev,
        status: "handled",
        agent: "claude"
      });
      appendReply(helper, "replies-claude.jsonl", {
        item: note.id,
        rev: note.rev,
        status: "not_handled",
        agent: "claude",
        reason: "the tone is a design decision, so I left it for you"
      });

      // The reviewer sees it on the page, on each item's own card.
      await pollPage(
        page,
        (ids) => ids.every((id) => window.__lahe.itemById(id).reply !== null),
        [selection.id, element.id, note.id],
        { message: "the folded replies to reach the cards through the poll loop" }
      );

      const selectionCard = await cardOf(page, selection.id);
      expect(selectionCard.state).toBe("handled");
      expect(selectionCard.pane).toBe("done");
      expect(selectionCard.agentMessage.agent).toBe("claude");

      const noteCard = await cardOf(page, note.id);
      expect(noteCard.state).toBe("not_handled");
      expect(noteCard.agentMessage.reason).toBe("the tone is a design decision, so I left it for you");
      expect(noteCard.pane, "a not-handled item is still in front of the reviewer").toBe("active");

      const done = await doneTabState(page);
      expect(done.rows).toBe(2);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  // --- ranked test 10, online -------------------------------------------------

  test("a stale reply is refused and the reworded item stays outstanding", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "shorten this");
      const first = (await itemsIn(page))[0];
      await waitForItemInLog(helper, first.id);

      // The reviewer rewords while the agent is reading. rev moves to 2.
      const reworded = await reword(page, first.id, "shorten this, and lead with the number");
      expect(reworded.rev).toBe(2);
      await pollUntil(
        () => {
          const got = reviewJson(helper);
          const item = projectedItems(got).find((i) => i.id === first.id);
          return item && item.rev === 2 ? item : null;
        },
        { message: "the rewording to reach the file the agent reads" }
      );

      // The agent answers the revision it read.
      appendReply(helper, "replies-claude.jsonl", { item: first.id, rev: 1, status: "handled", agent: "claude" });

      // The refusal is in the log, the item is still outstanding, and the card
      // says why rather than leaving the reviewer to wonder.
      const folded = await pollUntil(
        () => {
          const lines = readEventLog(helper.stateDir, REVIEW).filter((e) => e.event === "reply.folded");
          return lines.length ? lines : null;
        },
        { message: "the helper to fold the reply line" }
      );
      expect(folded[folded.length - 1].accepted).toBe(false);
      expect(folded[folded.length - 1].refusal).toContain("rev 1");

      await pollPage(page, (id) => window.__lahe.rail.getCard(id).notice !== null, first.id, {
        message: "the refusal to reach the card"
      });
      const card = await cardOf(page, first.id);
      expect(card.state).toBe("ready");
      expect(card.notice).toContain("older version");
      expect((await itemsIn(page))[0].state).toBe("ready");

      const projected = projectedItems(reviewJson(helper)).find((i) => i.id === first.id);
      expect(projected.state).toBe("ready");
      expect(projected.rev).toBe(2);
      expect(projected.reply).toBeNull();
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  // --- ranked test 10, offline ------------------------------------------------

  test("a rewording made with the helper killed still refuses the stale answer when they meet again", async ({
    page
  }) => {
    const app = await startAppServer();
    let helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [app.origin]
    });
    const port = helper.port;
    const stateDir = helper.stateDir;
    const token = helper.tokenFor(REVIEW);

    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "shorten this");
      const first = (await itemsIn(page))[0];
      await waitForItemInLog(helper, first.id);

      // The helper dies. Not politely.
      await helper.kill9();

      // The reviewer keeps working. The rewording lives in browser storage and
      // nowhere else, which is the half of this test that a helper-side unit
      // test cannot reach.
      const reworded = await reword(page, first.id, "shorten this, and lead with the number");
      expect(reworded.rev).toBe(2);
      const queued = await page.evaluate(
        () => window.__lahe.store().pendingEvents(window.__lahe.review).length
      );
      expect(queued, "the rewording is queued, undelivered").toBeGreaterThan(0);

      // The helper comes back on the same port, with the same state directory:
      // the page has the port baked into its script tag and cannot learn a new
      // one, which is why the port is fixed by default.
      helper = await startService({
        entry: SERVICE_ENTRY,
        args: ["--port", String(port)],
        stateDir: stateDir,
        reviews: [REVIEW],
        allowedOrigins: [app.origin]
      });

      // On reconnect the backlog drains: the rewording made while the helper was
      // dead reaches the helper and its file, and the item is at rev 2. This is
      // the offline-only half a helper-side unit test cannot reach: the rev 2
      // lived in browser storage across the kill and nowhere else.
      await pollUntil(
        () => {
          const got = reviewJson(helper);
          const item = projectedItems(got).find((i) => i.id === first.id);
          return item && item.rev === 2 ? item : null;
        },
        {
          message: "the reworded record to reach the helper and its file",
          describe: async () => ({
            projected: projectedItems(reviewJson(helper)).map((i) => ({ id: i.id, rev: i.rev, state: i.state })),
            status: await page.evaluate(() => window.__lahe.status())
          })
        }
      );

      // Only now does the agent, which read rev 1 before any of this, answer it.
      // Appending after the offline rewording has landed makes the fold
      // deterministic: the reply meets an item already at rev 2, so it must be
      // refused on the first and only fold. (Appended before reconnect, the reply
      // races the drain and can fold against rev 1 first, and the fold is
      // idempotent by file+line so it never re-folds; that race is what made the
      // fold-order assertion flaky.)
      fs.appendFileSync(
        path.join(stateDir, "reviews", REVIEW, "replies-claude.jsonl"),
        JSON.stringify({ item: first.id, rev: 1, status: "handled", agent: "claude" }) + "\n"
      );

      // ASSERT THE REFUSAL ITSELF, not just the end-state (finding 6). The
      // end-state (rewording survives) is also what the reconnect merge restores
      // even if the helper had wrongly accepted the stale reply, so a fork that
      // accepted every reply regardless of revision stayed green on the end-state
      // alone. Reading the fold event and asserting it was refused, naming rev 1,
      // is what actually bites that fork.
      const folded = await pollUntil(
        () => {
          const lines = readEventLog(helper.stateDir, REVIEW).filter((e) => e.event === "reply.folded");
          return lines.length ? lines : null;
        },
        {
          message: "the stale reply to be folded",
          describe: () => ({
            folds: readEventLog(helper.stateDir, REVIEW)
              .filter((e) => e.event === "reply.folded")
              .map((e) => ({ accepted: e.accepted, refusal: e.refusal }))
          })
        }
      );
      const lastFold = folded[folded.length - 1];
      expect(lastFold.accepted, "the stale answer was refused, not accepted").toBe(false);
      expect(lastFold.refusal, "the refusal names the stale revision").toContain("rev 1");

      const projected = projectedItems(reviewJson(helper)).find((i) => i.id === first.id);
      expect(projected.state, "the rewording stays outstanding").toBe("ready");
      expect(projected.reply).toBeNull();

      // And in the browser, which is where the reviewer is looking.
      const stored = await page.evaluate((id) => window.__lahe.itemById(id), first.id);
      expect(stored.state).toBe("ready");
      expect(stored.rev).toBe(2);
      expect(stored.reply).toBeNull();
      const card = await cardOf(page, first.id);
      expect(card.state).toBe("ready");
      expect(card.pane).toBe("active");
    } finally {
      if (helper.alive()) await helper.kill9();
      await app.close();
    }
  });

  // --- ranked test 32 ---------------------------------------------------------

  test("two reply files answering one item fold deterministically, and a malformed line becomes a chip naming it", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "shorten this");
      const item = (await itemsIn(page))[0];
      await waitForItemInLog(helper, item.id);
      await pollUntil(
        () => (projectedItems(reviewJson(helper)).length ? true : null),
        { message: "the item to reach review.json" }
      );

      // Two agents answer the same item at the same revision, differently.
      appendReply(helper, "replies-alpha.jsonl", { item: item.id, rev: 1, status: "handled", agent: "alpha" });
      appendReply(helper, "replies-zulu.jsonl", {
        item: item.id,
        rev: 1,
        status: "not_handled",
        agent: "zulu",
        reason: "that file is generated, so I would only be editing the build output"
      });

      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the fold to reach the card"
      });

      // Latest wins inside one pass, and arrival order is by filename, so the
      // winner is the same on every machine.
      await pollPage(page, (id) => window.__lahe.itemById(id).reply.agent === "zulu", item.id, {
        message: "the card to settle on the winner"
      });
      const card = await cardOf(page, item.id);
      expect(card.state).toBe("not_handled");
      expect(card.agentMessage.agent).toBe("zulu");

      // Both lines are still in the log: nothing is silently dropped.
      const folded = readEventLog(helper.stateDir, REVIEW).filter((e) => e.event === "reply.folded");
      expect(folded.map((e) => e.reply.agent).sort()).toEqual(["alpha", "zulu"]);

      // A torn final line is held, not half-parsed, and folds once when it
      // completes. The absence is paired with a positive control in the same
      // wait: a whole line written to another file AFTER the torn one folds,
      // which proves the reader really did run over both files in between.
      const rest = appendTorn(helper, "replies-alpha.jsonl", {
        item: item.id,
        rev: 1,
        status: "handled",
        agent: "alpha",
        files: ["app/views/home.html.erb"]
      });
      appendReply(helper, "replies-zulu.jsonl", {
        item: item.id,
        rev: 1,
        status: "question",
        agent: "zulu",
        text: "which heading did you mean?"
      });
      await pollUntil(
        () => {
          const lines = readEventLog(helper.stateDir, REVIEW).filter((e) => e.event === "reply.folded");
          return lines.some((e) => e.reply.status === "question") ? lines : null;
        },
        { message: "the whole line written after the torn one to fold" }
      );
      expect(
        readEventLog(helper.stateDir, REVIEW)
          .filter((e) => e.event === "reply.folded")
          .some((e) => (e.reply.files || []).length > 0),
        "the torn line folded nothing while the reader was reading past it"
      ).toBe(false);

      fs.appendFileSync(replyPath(helper, "replies-alpha.jsonl"), rest);
      const withTorn = await pollUntil(
        () => {
          const lines = readEventLog(helper.stateDir, REVIEW)
            .filter((e) => e.event === "reply.folded")
            .filter((e) => (e.reply.files || []).length > 0);
          return lines.length ? lines : null;
        },
        { message: "the completed line to fold" }
      );
      expect(withTorn, "and folds exactly once").toHaveLength(1);

      // A malformed line is skipped, and the reviewer gets a dismissible chip
      // naming the file and the line number.
      fs.appendFileSync(replyPath(helper, "replies-zulu.jsonl"), "{this is not json\n");
      await pollPage(
        page,
        () => window.__lahe.failures().some((f) => f.code === "REPLY_LINE_MALFORMED"),
        undefined,
        { message: "the malformed line to reach the rail as a chip" }
      );
      const chip = (await page.evaluate(() => window.__lahe.failures())).find(
        (f) => f.code === "REPLY_LINE_MALFORMED"
      );
      expect(chip.detail).toContain("replies-zulu.jsonl");
      // zulu's third line, counted the way an editor counts, so the person
      // fixing it opens the file and looks at that line.
      expect(chip.detail).toMatch(/line 3/);

      // The helper is still serving: a bad line from one agent never takes the
      // reviewer's session with it.
      expect(helper.alive()).toBe(true);
      await commentOnSelection(page, "section.focus p:nth-of-type(1)", "and this one too");
      expect((await itemsIn(page)).length).toBe(2);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  // --- the question treatment ---------------------------------------------------

  test("a question is the loudest thing on the card: its own block, the largest type, and something to press", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "shorten this");
      const item = (await itemsIn(page))[0];
      await waitForItemInLog(helper, item.id);

      appendReply(helper, "replies-claude.jsonl", {
        item: item.id,
        rev: 1,
        status: "question",
        agent: "claude",
        text: "Do you mean the <b>page</b> heading, or the one inside the focus section?"
      });

      await pollPage(page, (id) => window.__lahe.handle.doneTab().questionIds().indexOf(id) !== -1, item.id, {
        message: "the question to be drawn on the card"
      });

      // A question is not a state change: the work is still outstanding.
      const card = await cardOf(page, item.id);
      expect(card.state).toBe("ready");
      expect(card.agentMessage, "the question is said once, in the loud block").toBeNull();

      const drawn = await page.evaluate((id) => {
        const done = window.__lahe.handle.doneTab();
        const ask = done.question(id);
        const cardNode = window.__lahe.rail.cardNode(id);
        const text = ask.querySelector(".lahe-ask-text");
        const styles = getComputedStyle(text);
        const said = cardNode.querySelector(".card__body");
        return {
          who: ask.querySelector(".lahe-ask-name").textContent,
          text: text.textContent,
          markupInside: text.querySelectorAll("*").length,
          fontSize: parseFloat(styles.fontSize),
          ruleWidth: parseFloat(getComputedStyle(ask).borderLeftWidth),
          order: parseFloat(getComputedStyle(cardNode).order),
          marked: cardNode.getAttribute("data-lahe-asking"),
          hasAnswer: !!ask.querySelector(".lahe-ask-answer"),
          bodyFontSize: parseFloat(getComputedStyle(said).fontSize),
          reviewerDatetime: cardNode.querySelector(".card__time").getAttribute("datetime"),
          agentDatetime: ask.querySelector(".lahe-ask-time").getAttribute("datetime"),
          recordReviewerAt: window.__lahe.itemById(id).updated_at || window.__lahe.itemById(id).created_at,
          recordAgentAt: window.__lahe.itemById(id).reply.at,
          // The whole card, so a second copy of the question anywhere on it
          // fails here rather than being noticed in a screenshot months later.
          timesSaid: (cardNode.textContent.match(/Do you mean the/g) || []).length
        };
      }, item.id);

      expect(drawn.who).toBe("claude is asking");
      // Plain text, always. The angle brackets the agent sent are characters on
      // the page, not elements in it.
      expect(drawn.text).toContain("<b>page</b>");
      expect(drawn.markupInside).toBe(0);
      // Loud, as geometry rather than as intent: bigger than the reviewer's own
      // words, a rule of its own, first in its pane, and something to press.
      expect(drawn.fontSize).toBeGreaterThan(drawn.bodyFontSize);
      expect(drawn.ruleWidth).toBeGreaterThanOrEqual(3);
      expect(drawn.order).toBeLessThan(0);
      expect(drawn.marked).toBe("true");
      expect(drawn.hasAnswer).toBe(true);
      expect(drawn.timesSaid, "the question appears once on the card").toBe(1);
      // The rendered time is the record's own timestamp, not a render-time clock.
      expect(drawn.reviewerDatetime).toBe(drawn.recordReviewerAt);
      expect(drawn.agentDatetime).toBe(drawn.recordAgentAt);

      // Answering opens the blank continuation composer, not the original-note
      // rewording box.
      await page.evaluate((id) => {
        window.__lahe.handle.doneTab().question(id).querySelector(".lahe-ask-answer").click();
      }, item.id);
      await pollPage(page, (id) => {
        const composer = window.__lahe.handle.doneTab().followup(id);
        const input = composer && composer.querySelector("textarea");
        return !!input && input.getRootNode().activeElement === input && input.value === "";
      }, item.id, {
        message: "the blank follow-up composer to open on the card"
      });

      await page.evaluate((id) => {
        const input = window.__lahe.handle.doneTab().followup(id).querySelector("textarea");
        input.value = "Keep the focus-section heading.";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }));
      }, item.id);

      const continued = await page.evaluate((id) => window.__lahe.itemById(id), item.id);
      expect(continued.rev).toBe(2);
      expect(continued.state).toBe("ready");
      expect(continued.note).toBe("Keep the focus-section heading.");
      expect(continued.change).toBeNull();
      expect(continued.reply).toBeNull();
      expect(continued.thread).toHaveLength(1);
      expect(continued.thread[0].reviewer.note).toBe("shorten this");
      expect(continued.thread[0].agent.text).toContain("page</b> heading");

      const historyTimes = await page.evaluate((id) => {
        const item = window.__lahe.itemById(id);
        return {
          rendered: Array.from(window.__lahe.handle.doneTab().thread(id).querySelectorAll(".lahe-thread-time"))
            .map((node) => node.getAttribute("datetime")),
          expected: [item.thread[0].reviewer.at, item.thread[0].agent.at]
        };
      }, item.id);
      expect(historyTimes.rendered).toEqual(historyTimes.expected);

      const historyText = await page.evaluate((id) => window.__lahe.handle.doneTab().thread(id).textContent, item.id);
      expect(historyText).toContain("shorten this");
      expect(historyText).toContain("Do you mean the <b>page</b> heading");
      const chronological = await page.evaluate((id) => {
        const thread = window.__lahe.handle.doneTab().thread(id);
        const current = window.__lahe.rail.cardNode(id).querySelector("[data-lahe-active-row]");
        return !!thread && !!current && !!(thread.compareDocumentPosition(current) & Node.DOCUMENT_POSITION_FOLLOWING);
      }, item.id);
      expect(chronological, "completed rounds render before the current reviewer turn").toBe(true);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  // --- R38 -----------------------------------------------------------------------

  test("a handled item is kept and reopenable, and reopening puts it back in front of the agent", async ({
    page
  }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "shorten this");
      const item = (await itemsIn(page))[0];
      await waitForItemInLog(helper, item.id);

      appendReply(helper, "replies-claude.jsonl", { item: item.id, rev: 1, status: "handled", agent: "claude" });
      await pollPage(page, (id) => window.__lahe.itemById(id).state === "handled", item.id, {
        message: "the item to retire into the Done tab"
      });
      expect((await doneTabState(page)).rows).toBe(1);

      const composer = await page.evaluate((id) => {
        const node = window.__lahe.handle.doneTab().followup(id);
        const input = node && node.querySelector("textarea");
        const label = node && node.querySelector("label");
        return {
          exists: !!node,
          value: input && input.value,
          associated: !!input && !!label && label.getAttribute("for") === input.id
        };
      }, item.id);
      expect(composer).toEqual({ exists: true, value: "", associated: true });

      // Draft continuation text is private browser state: durable across a
      // reload, absent from the agent-facing projection until submitted.
      const privateDraft = "I need to add one more detail before sending";
      await page.evaluate(({ id, text }) => {
        const input = window.__lahe.handle.doneTab().followup(id).querySelector("textarea");
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, { id: item.id, text: privateDraft });
      expect(JSON.stringify(reviewJson(helper))).not.toContain(privateDraft);

      await page.reload();
      await pollPage(page, (id) => {
        const done = window.__lahe && window.__lahe.handle && window.__lahe.handle.doneTab();
        const node = done && done.followup(id);
        return node && node.querySelector("textarea").value;
      }, item.id, { message: "the private follow-up draft to return after reload" });
      expect(
        await page.evaluate((id) => window.__lahe.handle.doneTab().followup(id).querySelector("textarea").value, item.id)
      ).toBe(privateDraft);
      expect(JSON.stringify(reviewJson(helper))).not.toContain(privateDraft);

      const blockedByDraft = await page.evaluate((id) => {
        const done = window.__lahe.handle.doneTab();
        const before = window.__lahe.itemById(id);
        const after = done.reopen(id);
        const button = Array.from(window.__lahe.rail.cardNode(id).querySelectorAll("button")).find(
          (candidate) => candidate.textContent === "Reopen issue"
        );
        return { beforeRev: before.rev, afterRev: after.rev, disabled: button && button.disabled };
      }, item.id);
      expect(blockedByDraft).toEqual({ beforeRev: item.rev, afterRev: item.rev, disabled: true });

      await page.evaluate((id) => {
        const input = window.__lahe.handle.doneTab().followup(id).querySelector("textarea");
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }, item.id);
      await page.evaluate((id) => window.__lahe.handle.doneTab().reopen(id), item.id);

      const reopened = await page.evaluate((id) => window.__lahe.itemById(id), item.id);
      expect(reopened.state).toBe("ready");
      expect(reopened.reply).toBeNull();
      expect(reopened.thread).toHaveLength(1);
      expect(reopened.thread[0].reviewer.note).toBe("shorten this");
      expect(reopened.thread[0].agent.status).toBe("handled");
      expect((await cardOf(page, item.id)).pane).toBe("active");
      expect((await doneTabState(page)).rows).toBe(0);

      // And the helper agrees, so the next re-post cannot restore `handled`.
      await pollUntil(
        () => {
          const projected = projectedItems(reviewJson(helper)).find((i) => i.id === item.id);
          return projected && projected.state === "ready" ? projected : null;
        },
        {
          message: "the reopening to reach the helper and the file the agent reads",
          describe: () => ({
            projected: projectedItems(reviewJson(helper)).map((i) => ({ id: i.id, state: i.state }))
          })
        }
      );
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});
