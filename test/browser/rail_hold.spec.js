// Hold: queue several comments, release them to the agent at once.
//
// docs/features/20260917.01_hold_toggle/01_spec_hold_toggle.md. Requirement 4
// is the reason this is a browser test and not three unit tests: a held item
// has to be invisible to review.json, the wake feed, AND the overdue clock,
// together, against the REAL helper and a REAL agent session. A "legacy"
// review (the ordinary test shortcut, LAHE_REVIEWS with no session) has no
// wake feed at all, so a wake-line assertion against one would pass whether
// or not Hold's gate actually works. reviewSessions (test/helpers/service.js)
// gives this review a real session so the absence is a real proof, not a
// vacuous one; releasing Hold and watching the SAME assertions flip is what
// makes that provable rather than assumed.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  test,
  expect,
  startService,
  pollPage,
  pollUntil,
  SERVICE_ENTRY: serviceEntry
} = require("../helpers");

const { startAppServer } = require("../fixtures/app/server");
const stateDirModule = require("../../src/service/state_dir.js");

const APP_REVIEW = "rail-hold-review";
const SESSION_ID = "s_hold_review";
const SHOT_DIR = process.env.LAHE_SCREENSHOT_DIR || null;
const EPHEMERAL_PORT = ["--port", "0"];

async function bootApp() {
  const app = await startAppServer();
  const helper = await startService({
    entry: serviceEntry,
    args: EPHEMERAL_PORT,
    reviews: [APP_REVIEW],
    reviewSessions: { [APP_REVIEW]: SESSION_ID },
    allowedOrigins: [app.origin]
  });
  app.useLayer({ review: APP_REVIEW, token: helper.tokenFor(APP_REVIEW), helper: helper.url });
  return { app, helper };
}

async function openApp(page, app) {
  await page.setViewportSize({ width: 1180, height: 1320 });
  await page.goto(app.urlFor("/?morph=off"));
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
  await pollPage(page, () => window.__lahe.status() === "stored", undefined, {
    message: "the rail to read stored"
  });
}

async function selectAndOpen(page, selector) {
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
}

/** A real comment, sent with Cmd-Enter. Returns its item. */
async function sendComment(page, selector, text) {
  const before = await page.evaluate(() => window.__lahe.items().map((i) => i.id));
  await selectAndOpen(page, selector);
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
  const find = (known) =>
    window.__lahe.items().filter((i) => i.state === "ready" && known.indexOf(i.id) === -1)[0] || null;
  await pollPage(page, find, before, { message: "the comment to be ready" });
  return page.evaluate(find, before);
}

/** A real draft: typed, never sent. */
async function leaveDraft(page, selector, text) {
  await selectAndOpen(page, selector);
  await page.keyboard.type(text);
  const find = () => window.__lahe.items().filter((i) => i.state === "draft")[0] || null;
  await pollPage(page, find, undefined, { message: "the draft to reach the rail" });
  return page.evaluate(find);
}

/** Fold an agent reply the way the helper's poll loop delivers one. */
function foldHandled(page, item) {
  return page.evaluate((it) => {
    window.__lahe.handle.doneTab().applyReplies([
      {
        event: "reply.folded",
        item: it.id,
        rev: it.rev,
        accepted: true,
        state: "handled",
        ts: new Date().toISOString(),
        reply: { status: "handled", agent: "claude", text: "Done.", files: ["index.html"] }
      }
    ]);
  }, item);
}

function clickHoldButton(page) {
  return page.evaluate(() => {
    const root = window.__lahe.rail.tabBody("active").getRootNode();
    root.querySelector(".holdbtn").click();
  });
}

function readReviewJson(stateDir) {
  const file = path.join(stateDir, "reviews", APP_REVIEW, "review.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null;
  }
}

function itemIdsInReviewJson(stateDir) {
  const parsed = readReviewJson(stateDir);
  if (!parsed) return [];
  const out = [];
  (parsed.pages || []).forEach((page) => (page.items || []).forEach((item) => out.push(item.id)));
  return out;
}

/** N more real poll cycles against the real helper: a condition, not a sleep. */
async function waitForPolls(page, count) {
  const start = await page.evaluate(() => window.__lahe.handle.sync.status().counters.polls);
  await pollPage(
    page,
    (from) => window.__lahe.handle.sync.status().counters.polls >= from,
    start + count,
    { message: count + " more real poll cycles against the helper" }
  );
}

/**
 * The picture set, for Ken: the Active tab (the toggle on, a held card beside
 * a plain ready one and a draft), the Done tab (the handled card), and the
 * collapsed pill in its held state.
 */
async function shootHold(page, scheme) {
  const railBox = await page.evaluate(() => {
    const root = window.__lahe.rail.tabBody("active").getRootNode();
    const box = root.querySelector(".rail").getBoundingClientRect();
    return { x: box.left, y: box.top, width: box.width, height: box.height };
  });
  const clip = { x: railBox.x, y: railBox.y, width: railBox.width, height: Math.min(railBox.height, 1320) };
  const shots = [];
  await page.evaluate(() => window.__lahe.rail.selectTab("active"));
  shots.push({ label: "Active, Hold on", data: (await page.screenshot({ clip })).toString("base64") });
  await page.evaluate(() => window.__lahe.rail.selectTab("done"));
  shots.push({ label: "Done", data: (await page.screenshot({ clip })).toString("base64") });
  await page.evaluate(() => window.__lahe.rail.selectTab("active"));
  await page.evaluate(() => window.__lahe.rail.collapse(true));
  const view = page.viewportSize();
  const strip = { x: view.width - 600, y: 0, width: 600, height: view.height };
  shots.push({
    label: "Collapsed pill, held",
    data: (await page.screenshot({ clip: strip, animations: "disabled" })).toString("base64")
  });
  await page.evaluate(() => window.__lahe.rail.collapse(false));

  const composite = await page.context().newPage();
  const bg = scheme === "dark" ? "#12151a" : "#eef0f4";
  const ink = scheme === "dark" ? "#e9ebf0" : "#15171c";
  await composite.setViewportSize({ width: 100 + clip.width * 2 + 600 + 60, height: Math.max(clip.height, 1320) + 70 });
  await composite.setContent(
    '<body style="margin:0;padding:20px;background:' +
      bg +
      ";color:" +
      ink +
      ';font:13px system-ui;display:flex;align-items:flex-start;gap:30px">' +
      shots
        .map(
          (s) =>
            '<figure style="margin:0"><figcaption style="margin-bottom:8px">' +
            s.label +
            '</figcaption><img src="data:image/png;base64,' +
            s.data +
            '"></figure>'
        )
        .join("") +
      "</body>"
  );
  await composite.screenshot({ path: path.join(SHOT_DIR, "hold_states_" + scheme + ".png"), fullPage: true });
  await composite.close();
}

test.describe("Hold: queue several comments, release them to the agent at once", () => {
  test("a held item is invisible to review.json, the wake feed, and the overdue clock, all at once; releasing sends everything in one pass", async ({
    page
  }) => {
    const { app, helper } = await bootApp();
    try {
      await openApp(page, app);
      const wakeFile = stateDirModule.wakeLogPath(helper.stateDir, SESSION_ID);

      // Two comments BEFORE Hold. These stay plain cards once Hold goes on:
      // Hold reads each item's OWN outbox state, not "is Hold on at all", so
      // something already delivered is not relabeled retroactively.
      const readyBefore = await sendComment(page, "h1", "Sent before Hold, stays plain ready.");
      const handledBefore = await sendComment(page, "p.lede", "Sent before Hold, then answered.");
      await pollUntil(
        () => {
          const ids = itemIdsInReviewJson(helper.stateDir);
          return ids.indexOf(readyBefore.id) !== -1 && ids.indexOf(handledBefore.id) !== -1;
        },
        { message: "the two comments sent before Hold to reach review.json" }
      );
      await foldHandled(page, handledBefore);
      await pollPage(page, () => !!window.__lahe.handle.sync.status().agentLiveness, undefined, {
        message: "the real wire to carry an agent_liveness object at least once"
      });
      const baseline = await page.evaluate(() => window.__lahe.handle.sync.status().agentLiveness);

      // TURN HOLD ON, through the real control, the way a reviewer does.
      const beforeToggle = await page.evaluate(() => window.__lahe.rail.holdInfo());
      expect(beforeToggle.pressed, "off by default").toBe(false);
      await clickHoldButton(page);
      const onInfo = await page.evaluate(() => window.__lahe.rail.holdInfo());
      expect(onInfo.pressed, "R11: a real pressed state").toBe(true);
      expect(onInfo.countLive, "R11: the count is a live region").toBe("polite");
      expect(onInfo.countText, "R5: zero queued reads a sentence, not a bare 0").toBe(
        "Holding — nothing sends until you release"
      );

      const held = await sendComment(page, "section.focus p:nth-of-type(1)", "Batched while managing turns.");
      const draft = await leaveDraft(page, "section.focus p:nth-of-type(2)", "Half written, not sent yet.");

      const afterOne = await page.evaluate(() => window.__lahe.rail.holdInfo());
      expect(afterOne.countText, "R5: past zero it counts").toBe("Holding, 1 queued");

      // R4, all three together. wakeBefore/afterward compares the SAME file,
      // so "unchanged" is a real diff, not just "empty because nothing was
      // ever wired up".
      const wakeBefore = fs.existsSync(wakeFile) ? fs.readFileSync(wakeFile, "utf8") : "";
      await waitForPolls(page, 3); // real wall-clock time against the real helper
      expect(itemIdsInReviewJson(helper.stateDir).indexOf(held.id), "absent from review.json").toBe(-1);
      expect(fs.existsSync(wakeFile) ? fs.readFileSync(wakeFile, "utf8") : "", "no new wake line").toBe(wakeBefore);
      const liveness = await page.evaluate(() => window.__lahe.handle.sync.status().agentLiveness);
      expect(liveness.unanswered, "the helper's own outstanding count never moved").toBe(baseline.unanswered);
      expect(liveness.oldest_unanswered_at, "and its clock did not restart either").toBe(baseline.oldest_unanswered_at);

      // The card itself: held, distinct from the plain ready card, the draft,
      // and the handled one, and never marked late (R4's client half).
      const ids = { ready: readyBefore.id, handled: handledBefore.id, held: held.id, draft: draft.id };
      const cardStates = await page.evaluate((idMap) => {
        const rail = window.__lahe.rail;
        const out = {};
        Object.keys(idMap).forEach((key) => {
          out[key] = { state: rail.getCard(idMap[key]).state, wait: rail.cardWaitInfo(idMap[key]) };
        });
        return out;
      }, ids);
      expect(cardStates.held.state).toBe("held");
      expect(cardStates.held.wait.late).toBe(false);
      expect(cardStates.ready.state).toBe("ready");
      expect(cardStates.handled.state).toBe("handled");
      expect(cardStates.draft.state).toBe("draft");

      // The collapsed pill carries the same reading, distinct from its amber
      // late state (R10).
      await page.evaluate(() => window.__lahe.rail.collapse(true));
      const pillHeld = await page.evaluate(() => window.__lahe.rail.pillWaitInfo());
      expect(pillHeld.held).toBe(true);
      expect(pillHeld.late, "held and late are drawn distinctly, never both").toBe(false);
      expect(pillHeld.waitText).toBe("1 held");
      await page.evaluate(() => window.__lahe.rail.collapse(false));

      if (SHOT_DIR) await shootHold(page, "light");
      await page.evaluate(() => {
        document.documentElement.style.background = "#12151a";
        document.body.style.background = "#12151a";
        window.__lahe.rail.refreshScheme();
      });
      if (SHOT_DIR) await shootHold(page, "dark");
      await page.evaluate(() => {
        document.documentElement.style.background = "";
        document.body.style.background = "";
        window.__lahe.rail.refreshScheme();
      });

      // RELEASE: one pass, no confirm dialog, everything queued goes at once.
      await clickHoldButton(page);
      const offInfo = await page.evaluate(() => window.__lahe.rail.holdInfo());
      expect(offInfo.pressed).toBe(false);
      expect(offInfo.countText, "nothing left to announce once released").toBe("");

      await pollUntil(() => itemIdsInReviewJson(helper.stateDir).indexOf(held.id) !== -1, {
        message: "the released item to reach review.json in one pass"
      });
      await pollUntil(() => fs.existsSync(wakeFile) && fs.readFileSync(wakeFile, "utf8").indexOf(held.id) !== -1, {
        message: "releasing Hold to fire the wake line that Hold suppressed the whole time it was on"
      });
      const releasedState = await page.evaluate((id) => window.__lahe.rail.getCard(id).state, held.id);
      expect(releasedState, "back to a plain ready card the moment it is no longer held").toBe("ready");
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });

  test("ending a review force-flushes anything still held, no confirm dialog", async ({ page }) => {
    const { app, helper } = await bootApp();
    try {
      await openApp(page, app);
      await clickHoldButton(page);
      const held = await sendComment(page, "h1", "Held when the reviewer reaches for the door.");
      await waitForPolls(page, 1);
      expect(itemIdsInReviewJson(helper.stateDir).indexOf(held.id), "still held").toBe(-1);

      // The door: .endbtn opens the confirm panel, .endpanel__go presses it.
      // Neither is window.confirm (this rail's own rule); R6 needs no new UI,
      // sync.endReview()'s drainOutbox already force-flushes past the gate.
      await page.evaluate(() => {
        const root = window.__lahe.rail.tabBody("active").getRootNode();
        root.querySelector(".endbtn").click();
      });
      await page.evaluate(() => {
        const root = window.__lahe.rail.tabBody("active").getRootNode();
        root.querySelector(".endpanel__go").click();
      });

      await pollUntil(() => itemIdsInReviewJson(helper.stateDir).indexOf(held.id) !== -1, {
        message: "ending the review to flush the held item first, no confirm dialog"
      });
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });

  test("Hold survives a page reload, so a reload mid-burst does not silently flush everything", async ({ page }) => {
    const { app, helper } = await bootApp();
    try {
      await openApp(page, app);
      await clickHoldButton(page);
      const held = await sendComment(page, "h1", "Queued right before a reload.");
      await waitForPolls(page, 1);
      expect(itemIdsInReviewJson(helper.stateDir).indexOf(held.id), "held before the reload").toBe(-1);

      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again after the reload"
      });
      const afterReload = await page.evaluate(() => window.__lahe.rail.holdInfo());
      expect(afterReload.pressed, "Hold's own choice survives the reload").toBe(true);

      await waitForPolls(page, 2);
      expect(
        itemIdsInReviewJson(helper.stateDir).indexOf(held.id),
        "still held after the reload, not silently flushed"
      ).toBe(-1);

      await clickHoldButton(page);
      await pollUntil(() => itemIdsInReviewJson(helper.stateDir).indexOf(held.id) !== -1, {
        message: "releasing Hold after the reload to flush the item that survived it"
      });
    } finally {
      await helper.stop().catch(() => {});
      await app.close();
    }
  });
});
