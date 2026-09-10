// The toast: an answer that reaches a reviewer who keeps the rail closed.
//
// Ken works with the rail collapsed, because an open rail covers the page he
// came to review. The cost was real: "I forget to go look for answers and end
// up asking the same questions again." So an answer worth stopping for says so
// on the page, bottom-left, out from under both the rail and the pill.
//
// Everything here is the real thing:
//
//   REAL  the application: 0C's node app, serving its own HTML
//   REAL  the arrival: one script tag, and src/layer/index.js booting off it
//   REAL  the helper, and the per-review token it minted
//   REAL  the agent: `fs.appendFileSync` on replies-<name>.jsonl, nothing else
//   REAL  the click: viewport coordinates the rail itself reports, because the
//         toast is in a closed shadow root and a spec cannot select it
//
// The one seam is the clock: rail.toastDuration shortens the auto-dismiss so a
// test does not sit for ten seconds. The number it replaces is TOAST_MS in
// overlay.js, and nothing else knows it.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { test, expect, pollPage, pollUntil, startService, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "toast-review";
const EPHEMERAL_PORT = ["--port", "0"];
// Short enough that the suite never waits on it, long enough that a poll can
// catch a toast before it goes.
const SHORT_TOAST_MS = 400;

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

/** Wait until the helper's review.json holds this many items, and return them. */
function waitForProjected(helper, count) {
  return pollUntil(
    () => {
      const got = reviewJson(helper);
      return got && projectedItems(got).length >= count ? projectedItems(got) : null;
    },
    {
      message: "review.json to hold " + count + " item(s)",
      describe: () => ({ items: projectedItems(reviewJson(helper)).length })
    }
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

/** The toast lives in a closed root, so the rail says what is on screen. */
function toastState(page) {
  return page.evaluate(() => window.__lahe.rail.toastInfo());
}

function railState(page) {
  return page.evaluate(() => ({
    tab: window.__lahe.rail.currentTab(),
    collapsed: window.__lahe.rail.isCollapsed(),
    focused: window.__lahe.rail.focusedCardId()
  }));
}

/** Wait for a toast to be on screen, and hand back what it says. */
async function waitForToast(page, message) {
  await pollPage(page, () => window.__lahe.rail.toastInfo().count > 0, undefined, {
    message: message || "a toast to appear"
  });
  return toastState(page);
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

test.describe("the toast: an answer that finds a reviewer with the rail closed", () => {
  test("a flagged answer toasts, and pressing it opens the rail on that card", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);

      // The reviewer puts the rail away and goes back to reading the page,
      // which is the whole situation this exists for.
      await page.evaluate(() => window.__lahe.rail.collapse(true));

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "handled",
        agent: "claude",
        text: "cut it to one sentence, and moved the number to the front",
        user_needs_to_see_reply: true
      });

      const info = await waitForToast(page, "the flagged answer to toast");
      expect(info.count).toBe(1);
      expect(info.toasts[0].label).toBe("claude says");
      expect(info.toasts[0].text).toContain("moved the number to the front");
      expect(info.toasts[0].about, "the words the answer is about").toContain("Nine clients checked in this week");
      expect(info.toasts[0].sticky, "a note is not a question, so it can leave on its own").toBe(false);

      // Pressed at the coordinates the rail itself reports, because a closed
      // root has no selector.
      const rect = info.toasts[0].rect;
      expect(rect.width, "the toast is on screen and has a size").toBeGreaterThan(0);
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);

      await pollPage(page, () => window.__lahe.rail.isCollapsed() === false, undefined, {
        message: "the rail to open"
      });
      const rail = await railState(page);
      expect(rail.tab, "on the tab the card is in").toBe("done");
      expect(rail.focused, "with the card itself focused").toBe(item.id);
      expect((await toastState(page)).count, "and the toast has done its job").toBe(0);

      // The reviewer is looking at the answer, so the rail stops counting it.
      await pollPage(page, () => window.__lahe.rail.tabNewCount("done") === 0, undefined, {
        message: "the unread badge to clear, the way it does when a card is seen"
      });
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a question waits, while a note beside it comes and goes", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "which heading did you mean");
      await commentOnSelection(page, "h1", "tighten this");
      const projected = await waitForProjected(helper, 2);
      const asked = projected.find((i) => i.note === "which heading did you mean");
      const other = projected.find((i) => i.note === "tighten this");

      await page.evaluate((ms) => {
        window.__lahe.rail.collapse(true);
        window.__lahe.rail.toastDuration(ms);
      }, SHORT_TOAST_MS);

      appendReply(helper, {
        item: asked.id,
        rev: asked.rev,
        status: "question",
        agent: "claude",
        text: "the page has two headings. Which one?"
      });
      const question = await waitForToast(page, "the question to toast");
      expect(question.toasts[0].label).toBe("Question");
      expect(question.toasts[0].sticky, "a question stays until it is pressed").toBe(true);
      expect(question.toasts[0].armed, "so it has no clock at all").toBe(false);

      // A second answer arrives, one that DOES time out. When it has gone, a
      // full auto-dismiss window has passed with the question still standing,
      // which is the claim, without the spec waiting on a clock.
      appendReply(helper, {
        item: other.id,
        rev: other.rev,
        status: "handled",
        agent: "claude",
        text: "tightened it",
        user_needs_to_see_reply: true
      });
      await pollPage(page, () => window.__lahe.rail.toastInfo().count === 2, undefined, {
        message: "both toasts to be on screen"
      });
      await pollPage(page, () => window.__lahe.rail.toastInfo().count === 1, undefined, {
        message: "the note to dismiss itself"
      });

      const left = await toastState(page);
      expect(left.toasts[0].label, "the one still standing is the question").toBe("Question");
      expect(left.toasts[0].sticky).toBe(true);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a routine confirmation lands on its card and says nothing on the page", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);
      await page.evaluate(() => window.__lahe.rail.collapse(true));

      appendReply(helper, { item: item.id, rev: item.rev, status: "handled", agent: "claude" });

      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the reply to reach the card through the poll loop"
      });
      expect((await toastState(page)).count, "an unflagged confirmation is not an interruption").toBe(0);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("an answer arriving on the tab the reviewer is already looking at does not toast", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);

      // Rail open, on Done, which is where a handled card lands.
      await page.evaluate(() => {
        window.__lahe.rail.collapse(false);
        window.__lahe.rail.selectTab("done");
      });

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "handled",
        agent: "claude",
        text: "cut it to one sentence",
        user_needs_to_see_reply: true
      });

      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the reply to reach the card through the poll loop"
      });
      expect((await toastState(page)).count, "it is already on screen; a toast would say it twice").toBe(0);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  // --- read is read, and it survives the reload -------------------------------
  //
  // Ken, on an SPA that rebuilds (and so reloads) every few minutes: "this page
  // keeps toasting me telling me there are responses waiting and it appears
  // I've already read them all." Both halves of that are below: an answer read
  // as it lands, and an answer read by opening the rail onto the tab it is
  // already on, which selects no tab and used to write no mark at all.

  test("an answer read as it lands stays read across a reload", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);

      // Rail open, on the tab the handled card lands in: the reviewer is
      // looking straight at it when the answer arrives.
      await page.evaluate(() => {
        window.__lahe.rail.collapse(false);
        window.__lahe.rail.selectTab("done");
      });

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "handled",
        agent: "claude",
        text: "cut it to one sentence",
        user_needs_to_see_reply: true
      });
      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the reply to fold onto the card in front of the reviewer"
      });
      expect((await toastState(page)).count, "it is on screen, so it does not toast").toBe(0);

      // The agent rebuilds, the page reloads. Nothing new has happened.
      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again"
      });
      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the backlog to be applied again"
      });
      expect((await toastState(page)).count, "an answer already read is not announced again").toBe(0);
      expect(await page.evaluate(() => window.__lahe.handle.doneTab().unseenIds()), "and nothing is unread").toEqual([]);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("opening the rail on the tab it was already on counts as reading it", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);

      // Ken's own working state: the rail put away, sitting on Done.
      await page.evaluate(() => {
        window.__lahe.rail.selectTab("done");
        window.__lahe.rail.collapse(true);
      });

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "handled",
        agent: "claude",
        text: "cut it to one sentence",
        user_needs_to_see_reply: true
      });
      const info = await waitForToast(page, "the answer to toast at a closed rail");
      expect(info.count).toBe(1);

      // He opens the rail with the pill and reads the card. No tab is selected,
      // because it is the tab the rail was already on.
      const pill = await page.evaluate(() => window.__lahe.rail.geometry().pill);
      await page.mouse.click((pill.left + pill.right) / 2, (pill.top + pill.bottom) / 2);
      await pollPage(page, () => window.__lahe.rail.isCollapsed() === false, undefined, {
        message: "the pill to open the rail"
      });
      expect((await railState(page)).tab, "and it opened on the tab it was left on").toBe("done");

      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again"
      });
      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the backlog to be applied again"
      });
      expect((await toastState(page)).count, "he read it, so the reload says nothing").toBe(0);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  // --- the promises to the page underneath ------------------------------------
  //
  // Ken: "we need to be careful of it interacting with and preventing other
  // JavaScript on the page in a website." These two are the halves of that a
  // test can actually check.

  test("the page stays clickable in the toast's own column, everywhere the toast box is not", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);
      await page.evaluate(() => window.__lahe.rail.collapse(true));

      // The page's own click handling, which is the thing that must not be
      // taken away from it. Capture phase, on the document, which is where a
      // real application's delegated handlers usually sit.
      await page.evaluate(() => {
        window.__pageClicks = [];
        document.addEventListener(
          "click",
          (event) => {
            window.__pageClicks.push({ id: event.target.id || "", tag: event.target.tagName });
          },
          true
        );
      });

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "handled",
        agent: "claude",
        text: "cut it to one sentence",
        user_needs_to_see_reply: true
      });
      const info = await waitForToast(page, "the toast to appear top right");

      // Just below the toast box, in the stack's own column. The container is
      // pointer-events:none, so this is page, not tool.
      const rect = info.toasts[0].rect;
      await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height + 8);

      const clicks = await page.evaluate(() => window.__pageClicks);
      expect(clicks.length, "the page's own handler ran").toBe(1);
      expect(clicks[0].id, "and the click reached the page, not the tool's host").not.toBe("lahe-surface-root");
      expect((await toastState(page)).count, "the toast did not take a click that was not on it").toBe(1);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a toast appearing never takes focus off the page", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);
      await page.evaluate(() => window.__lahe.rail.collapse(true));

      // The reviewer is using the application, with the caret in it.
      await page.evaluate(() => document.querySelector("#log-session").focus());
      const before = await page.evaluate(() => document.activeElement.id);
      expect(before).toBe("log-session");

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "question",
        agent: "claude",
        text: "which heading did you mean?"
      });
      await waitForToast(page, "the question to toast");

      expect(await page.evaluate(() => document.activeElement.id), "focus stayed where the reviewer put it").toBe(
        "log-session"
      );
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  // --- the message, never a count ---------------------------------------------
  //
  // Ken, after a day: "toasts that just say one message is waiting, and then
  // another toast comes up while it's still there and says two messages are
  // waiting. I don't want those. I want the message."

  test("two answers at once are two messages, with their words, and no count", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      await commentOnSelection(page, "h1", "tighten this");
      const projected = await waitForProjected(helper, 2);
      await page.evaluate(() => window.__lahe.rail.collapse(true));

      const said = {};
      projected.forEach((item, index) => {
        said[item.id] = index === 0 ? "cut it to one sentence" : "tightened the heading";
        appendReply(helper, {
          item: item.id,
          rev: item.rev,
          status: "handled",
          agent: "claude",
          text: said[item.id],
          user_needs_to_see_reply: true
        });
      });

      await pollPage(page, () => window.__lahe.rail.toastInfo().count === 2, undefined, {
        message: "one toast for each answer"
      });
      const texts = (await toastState(page)).toasts.map((toast) => toast.text).sort();
      expect(texts).toEqual(["cut it to one sentence", "tightened the heading"].sort());
      texts.forEach((text) => expect(text, "no counts anywhere").not.toContain("waiting"));
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("pressing the X marks that answer read, and the reload says nothing about it", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);
      await page.evaluate(() => window.__lahe.rail.collapse(true));

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "handled",
        agent: "claude",
        text: "cut it to one sentence",
        user_needs_to_see_reply: true
      });
      const info = await waitForToast(page, "the answer to toast");

      // The real close control, at its own coordinates.
      const x = info.toasts[0].closeRect;
      expect(x, "the toast carries a close control").toBeTruthy();
      await page.mouse.click(x.x + x.width / 2, x.y + x.height / 2);
      await pollPage(page, () => window.__lahe.rail.toastInfo().count === 0, undefined, {
        message: "the toast to go"
      });

      expect(await page.evaluate(() => window.__lahe.handle.doneTab().unseenIds()), "read, because he read it").toEqual(
        []
      );
      expect(await page.evaluate(() => window.__lahe.rail.isCollapsed()), "and the rail was not opened").toBe(true);

      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again"
      });
      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the backlog to be applied again"
      });
      expect((await toastState(page)).count, "it never comes back").toBe(0);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("an answer nobody touches becomes one count, and a second one replaces it", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      await commentOnSelection(page, "h1", "tighten this");
      const projected = await waitForProjected(helper, 2);

      await page.evaluate((ms) => {
        window.__lahe.rail.collapse(true);
        window.__lahe.rail.toastDuration(ms);
        // The neglect window, shortened. TOAST_MS and NEGLECT_MS are the real
        // numbers; a test must not sit through two minutes of either.
        window.__lahe.handle.doneTab().neglectDelay(ms);
      }, SHORT_TOAST_MS);

      appendReply(helper, {
        item: projected[0].id,
        rev: projected[0].rev,
        status: "handled",
        agent: "claude",
        text: "cut it to one sentence",
        user_needs_to_see_reply: true
      });

      // It arrives with its words, is ignored, and times out.
      await waitForToast(page, "the first answer to toast");
      await pollPage(page, () => window.__lahe.rail.toastInfo().count === 0, undefined, {
        message: "the ignored answer to time out"
      });

      // Only now, and only because it was neglected, does a count appear.
      await pollPage(
        page,
        () => {
          const info = window.__lahe.rail.toastInfo();
          return info.count === 1 && info.toasts[0].text === "1 reply is waiting.";
        },
        undefined,
        { message: "one count for the neglected answer" }
      );

      appendReply(helper, {
        item: projected[1].id,
        rev: projected[1].rev,
        status: "handled",
        agent: "claude",
        text: "tightened the heading",
        user_needs_to_see_reply: true
      });

      // The second answer is ignored the same way. The count must REPLACE the
      // one standing, not stand beside it.
      await pollPage(
        page,
        () => {
          const info = window.__lahe.rail.toastInfo();
          return info.count === 1 && info.toasts[0].text === "2 replies are waiting.";
        },
        undefined,
        { message: "the count to be replaced rather than joined" }
      );
      expect((await toastState(page)).count, "never two counts side by side").toBe(1);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a client-side navigation does not re-announce what this page already said", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);
      await page.evaluate(() => window.__lahe.rail.collapse(true));

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "question",
        agent: "claude",
        text: "which heading did you mean?"
      });
      const info = await waitForToast(page, "the question to toast");
      expect(info.count).toBe(1);

      // The rail is torn down and rebuilt, which is what a hash navigation does
      // on the SPA Ken reviews. This is where the counts used to multiply: the
      // summary key was the id set, the set had moved, and the rail's dedupe
      // had never seen that key before.
      await page.evaluate(() => {
        window.__lahe.remount();
        window.__lahe.remount();
        window.__lahe.remount();
      });

      const after = await toastState(page);
      expect(after.count, "three navigations, still one message").toBe(1);
      expect(after.toasts[0].text).toBe("which heading did you mean?");
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  test("a reload shows a recent unread answer as itself, with its words", async ({ page }) => {
    const { app, helper, token } = await startBoth();
    try {
      await bootedPage(page, app, helper, token);
      await commentOnSelection(page, "p.lede", "cut this to one sentence");
      const [item] = await waitForProjected(helper, 1);
      await page.evaluate(() => window.__lahe.rail.collapse(true));

      appendReply(helper, {
        item: item.id,
        rev: item.rev,
        status: "handled",
        agent: "claude",
        text: "cut it to one sentence, and moved the number to the front",
        user_needs_to_see_reply: true
      });
      await waitForToast(page, "the answer to toast");

      // The agent rebuilds and the page reloads before he has read it. It is
      // still recent, so he still gets the words rather than a count.
      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again"
      });

      const info = await waitForToast(page, "the answer to toast again after the reload");
      expect(info.count).toBe(1);
      expect(info.toasts[0].text).toContain("moved the number to the front");

      // And the replayed backlog does not add a second one.
      await pollPage(page, (id) => window.__lahe.itemById(id).reply !== null, item.id, {
        message: "the backlog to be applied again"
      });
      expect((await toastState(page)).count).toBe(1);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});
