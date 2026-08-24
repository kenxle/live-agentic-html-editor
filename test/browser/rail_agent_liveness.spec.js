// The rail's one status line: is my work stored, and has anything come back?
//
// This is the surface that exists because a chat can lie. An agent reported
// "monitoring is active" while seven items sat unanswered, and nothing on the
// reviewer's screen could contradict it.
//
// Then the rail grew a second way to lie, which is what this file was rewritten
// for. It had TWO lines: a status line that latched to "Stored · agent reading"
// the moment one reply had ever arrived, and a liveness line underneath it
// reading "No agent watching · oldest item 6m". The reviewer saw both at once,
// while an agent was demonstrably answering him (Ken, live, 2026-08-23). One
// line cannot disagree with itself, so there is one line.
//
// The assertions are on COMPUTED STYLE, not on the attribute. "The state is set"
// was the true-but-useless assertion in every rail defect the design review
// found: a row can carry the right data attribute and be display:none, and the
// reviewer sees nothing either way.
//
// Four properties, and each one is a decision that could be got wrong:
//
//   1. NOTHING WAITING, NOTHING SAID. A review with everything answered and an
//      agent quietly sitting on it is the healthy, ordinary state of a review.
//      A rail that comments on it is crying wolf on nearly every session.
//   2. ONE ROW. There is no second line about agents, and the storage half never
//      makes a claim about one.
//   3. When something HAS been waiting, the words are a reviewer's: how long,
//      never a monitor or a heartbeat or a wake feed. And the reassurance comes
//      with it: the work is stored, and a copy is one click away.
//   4. Two waiting readings, not one. "Nothing back yet" and "nobody has picked
//      this up" are different next moves for the reviewer.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  test,
  expect,
  startStaticServer,
  startService,
  pollPage,
  SERVICE_ENTRY: serviceEntry
} = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const SERVICE_ENTRY = serviceEntry;
const REVIEW = "review-1";
const EPHEMERAL_PORT = ["--port", "0"];

function railUrl(server, helper, token) {
  const query = new URLSearchParams({ review: REVIEW, helper: helper, token: token });
  return server.urlFor("test/fixtures/rail.html") + "?" + query.toString();
}

function agoIso(ms) {
  return new Date(Date.now() - ms).toISOString();
}

test.describe("the rail says whether anything has come back", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "repo" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("one line: stored, then how long, then loud", async ({ page }) => {
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });

    try {
      await page.goto(railUrl(pages, helper.url, helper.tokenFor(REVIEW)));
      await page.evaluate(() => window.__laheRail.startSync());

      // The real wire: replies.poll carries agent_liveness. Nothing is waiting on
      // this review, so the state is `none` and the line says nothing at all
      // about agents. That is the state a healthy review spends its life in.
      await pollPage(
        page,
        () => {
          const liveness = window.__laheRail.sync().agentLiveness;
          return !!liveness && typeof liveness.state === "string";
        },
        undefined,
        { message: "replies.poll to carry an agent_liveness object" }
      );
      const overTheWire = await page.evaluate(() => window.__laheRail.sync().agentLiveness);
      expect(overTheWire.state, "an empty review is not an alarm").toBe("none");
      expect(overTheWire.unanswered).toBe(0);
      expect(Object.keys(overTheWire).sort()).toEqual([
        "activity_at",
        "last_reply_at",
        "listening",
        "monitor_at",
        "oldest_unanswered_at",
        "state",
        "unanswered"
      ]);

      await pollPage(page, () => window.__laheRail.status() === "stored", undefined, {
        message: "the line to read stored"
      });
      const quiet = await page.evaluate(() => window.__laheRail.statusLine());
      expect(quiet.visible).toBe(true);
      expect(quiet.text, "nothing waiting, and nothing known about a watcher").toBe("Stored");
      expect(quiet.loud).toBe(false);
      expect(quiet.save, "and no escape hatch offered on a healthy review").toBeNull();

      // THE QUIET INDICATOR. Two words, answering the only question a reviewer
      // asks at the start and after a break: is the chain intact. It is never
      // loud and never offers an escape hatch, because nothing is wrong.
      const connected = await page.evaluate(
        () =>
          window.__laheRail.setAgentLiveness({
            state: "none",
            unanswered: 0,
            oldest_unanswered_at: null,
            last_reply_at: null,
            listening: true
          }) && window.__laheRail.statusLine()
      );
      expect(connected.text).toBe("Stored · agent listening");
      expect(connected.loud).toBe(false);
      expect(connected.save).toBeNull();
      expect(Number(connected.weight), "a working chain never demands attention").toBeLessThan(600);
      // The hover carries the detail: what the helper is doing, whether an agent
      // has the review open, and where the work is kept.
      expect(connected.title).toContain("helper is answering this page");
      expect(connected.title).toContain("An agent has this review open");
      expect(connected.title).toContain("stored in this browser and in the helper's log on disk");

      const gone = await page.evaluate(
        () =>
          window.__laheRail.setAgentLiveness({
            state: "none",
            unanswered: 0,
            oldest_unanswered_at: null,
            last_reply_at: null,
            listening: false
          }) && window.__laheRail.statusLine()
      );
      expect(gone.text, "what a reviewer comes back from a break to check").toBe("Stored · no agent listening");
      expect(gone.loud, "nothing is waiting, so this is news and not an alarm").toBe(false);
      expect(gone.dotColor, "and it looks different from a connected one").not.toBe(connected.dotColor);

      // Forty-five seconds after the reviewer pressed submit, with nothing back.
      // This is where the line starts speaking: they are sitting there wondering
      // whether it went anywhere.
      const waiting = await page.evaluate(
        (at) =>
          window.__laheRail.setAgentLiveness({
            state: "waiting",
            unanswered: 1,
            oldest_unanswered_at: at,
            last_reply_at: null,
            listening: true
          }) && window.__laheRail.statusLine(),
        agoIso(45000)
      );
      expect(waiting.text).toBe("Stored · nothing back yet, 45s");
      expect(Number(waiting.weight), "45 seconds is information, not an alarm").toBeLessThan(600);
      expect(waiting.save, "the way out arrives with the worry").toBe("Save a copy");
      expect(waiting.title).toContain("stored in this browser and in the helper's log on disk");
      // The reviewer is never told about our plumbing.
      ["monitor", "heartbeat", "wake feed", "watching", "unattended"].forEach((jargon) => {
        expect(waiting.text.toLowerCase(), "the line never says " + jargon).not.toContain(jargon);
        expect(waiting.title.toLowerCase(), "the title never says " + jargon).not.toContain(jargon);
      });

      // The agent is demonstrably mid-task. Same wait, explained, and calm.
      const working = await page.evaluate(
        (at) =>
          window.__laheRail.setAgentLiveness({
            state: "working",
            unanswered: 2,
            oldest_unanswered_at: at.old,
            activity_at: at.ran,
            listening: true
          }) && window.__laheRail.statusLine(),
        { old: agoIso(5 * 60 * 1000), ran: agoIso(20000) }
      );
      expect(working.text).toBe("Stored · agent is working, 5m");
      expect(working.loud, "a busy agent is not shouted about").toBe(false);
      expect(working.dotColor, "working and waiting are different dots").not.toBe(waiting.dotColor);

      // Twelve minutes with nothing happening is loud, EVEN THOUGH something is
      // listening. A tail can be armed over an agent that stopped reading.
      const loud = await page.evaluate(
        (at) =>
          window.__laheRail.setAgentLiveness({
            state: "waiting",
            unanswered: 3,
            oldest_unanswered_at: at,
            last_reply_at: null,
            listening: true
          }) && window.__laheRail.statusLine(),
        agoIso(12 * 60 * 1000)
      );
      expect(loud.text).toBe("Stored · nothing back yet, 12m");
      expect(loud.loud).toBe(true);
      expect(Number(loud.weight), "old work is the one thing worth interrupting for").toBeGreaterThanOrEqual(600);

      // And the materially different case: nothing on the machine holds this
      // session's wake feed open, so waiting longer will not help. Different
      // words, because it is a different next move.
      const nobody = await page.evaluate(
        (at) =>
          window.__laheRail.setAgentLiveness({
            state: "no_agent",
            unanswered: 3,
            oldest_unanswered_at: at,
            last_reply_at: null,
            listening: false
          }) && window.__laheRail.statusLine(),
        agoIso(7 * 60 * 1000)
      );
      expect(nobody.text).toBe("Stored · nobody has picked this up, 7m");
      expect(nobody.text).not.toBe(loud.text);
      expect(nobody.loud).toBe(true);
      expect(nobody.save).toBe("Save a copy");

      // Answered and quiet again: the storage half alone, and no escape hatch.
      const settled = await page.evaluate(
        () =>
          window.__laheRail.setAgentLiveness({
            state: "none",
            unanswered: 0,
            oldest_unanswered_at: null,
            last_reply_at: null,
            listening: null
          }) && window.__laheRail.statusLine()
      );
      expect(settled.text, "an answered review says nothing about agents").toBe("Stored");
      expect(settled.loud).toBe(false);
      expect(settled.save).toBeNull();
    } finally {
      await helper.stop();
    }
  });

  test("a real reply, then a real silence: the line never claims an agent is reading", async ({ page }) => {
    // THE CONTRADICTION, reproduced through the real wire. On the old rail this
    // sequence produced "Stored · agent reading" over "No agent watching ·
    // oldest item 6m": the storage line latched on the first reply of the
    // session and never aged out, whatever happened afterwards. There is one
    // line now, and it reports an elapsed time.
    //
    // REAL the reviewer's comment, REAL the helper, REAL the agent: one line
    // appended to replies-claude.jsonl, which is all an agent ever does.
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });

    try {
      await page.goto(railUrl(pages, helper.url, helper.tokenFor(REVIEW)));
      await page.evaluate(() => window.__laheRail.startSync());
      await pollPage(page, () => window.__laheRail.status() === "stored", undefined, {
        message: "the line to read stored"
      });

      const card = await page.evaluate(() => window.__laheRail.openCard());
      await page.keyboard.type("The heading is still wrong", { delay: 5 });
      const ready = await page.evaluate((id) => window.__laheRail.markReady(id), card.id);

      await pollPage(
        page,
        () => {
          const liveness = window.__laheRail.sync().agentLiveness;
          return !!liveness && liveness.unanswered === 1;
        },
        undefined,
        { message: "the helper to report the waiting item" }
      );

      // The agent answers, the only way an agent ever does.
      fs.appendFileSync(
        path.join(helper.stateDir, "reviews", REVIEW, "replies-claude.jsonl"),
        JSON.stringify({
          item: ready.id,
          rev: ready.rev,
          status: "handled",
          agent: "claude",
          files: ["index.html"]
        }) + "\n"
      );

      await pollPage(
        page,
        () => {
          const liveness = window.__laheRail.sync().agentLiveness;
          return !!liveness && liveness.unanswered === 0 && !!liveness.last_reply_at;
        },
        undefined,
        { message: "the helper to fold the reply and report nothing waiting" }
      );

      const answered = await page.evaluate(() => window.__laheRail.statusLine());
      expect(answered.text, "everything answered, so nothing to say about agents").toBe("Stored");
      expect(answered.loud).toBe(false);
      expect(answered.save, "and nothing to worry about, so no escape hatch").toBeNull();
      expect(await page.evaluate(() => window.__laheRail.replies().length)).toBeGreaterThan(0);

      // And now the agent goes quiet with a new item waiting. On the old rail
      // the sentence above stayed exactly where it was.
      const quiet = await page.evaluate(
        (at) =>
          window.__laheRail.setAgentLiveness({
            state: "waiting",
            unanswered: 1,
            oldest_unanswered_at: at,
            last_reply_at: null,
            listening: false
          }) && window.__laheRail.statusLine(),
        agoIso(6 * 60 * 1000)
      );
      expect(quiet.text).toBe("Stored · nothing back yet, 6m");
      expect(quiet.text.toLowerCase()).not.toContain("reading");

      expect(quiet.save, "and the way to keep a copy is right there").toBe("Save a copy");

      // One row, not two: the whole footer holds a single status line, which is
      // also a single announcement for a screen reader.
      expect(await page.evaluate(() => window.__laheRail.statusRows()), "one line").toBe(1);

      // Pressing it runs the same export the menu runs, from the moment the
      // reviewer starts wondering rather than three clicks into a menu.
      const saved = await page.evaluate(() => window.__laheRail.clickSave());
      expect(saved, "the button is really there and really pressed").toBe(true);
      expect(await page.evaluate(() => window.__laheRail.exports()), "one export ran").toBe(1);
    } finally {
      await helper.stop();
    }
  });
});
