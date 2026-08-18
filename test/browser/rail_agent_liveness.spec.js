// The rail's agent line: is anybody actually listening?
//
// This is the surface that exists because a chat can lie. An agent reported
// "monitoring is active" while seven items sat unanswered, and nothing on the
// reviewer's screen could contradict it. The helper now answers that question
// itself, from a monitor heartbeat and a session activity stamp, and this is
// what the reviewer reads.
//
// The assertions are on COMPUTED STYLE, not on the attribute. "The state is
// set" was the true-but-useless assertion in every rail defect the design
// review found: a row can carry the right data attribute and be display:none,
// and the reviewer sees nothing either way.
//
// Three properties, and each one is a decision that could be got wrong:
//
//   1. `none` renders NOTHING. "No agent is watching and nothing is waiting"
//      is not news, and a rail that always has a line about agents is a rail
//      whose lines stop being read.
//   2. watching and working are CALM. They are the healthy readings. A rail
//      that shouts in a healthy state teaches the reviewer to ignore it by the
//      third comment.
//   3. unattended is LOUD and carries the oldest item's age. The age is what
//      makes the reviewer's next move obvious: five minutes is a busy agent,
//      forty is a dead one.

"use strict";

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

test.describe("the rail says whether an agent is listening", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "repo" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("nothing, then calm, then loud with the oldest item's age", async ({ page }) => {
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });

    try {
      await page.goto(railUrl(pages, helper.url, helper.tokenFor(REVIEW)));
      await page.evaluate(() => window.__laheRail.startSync());

      // Before the helper has said anything, and in the `none` state, the line
      // is not on screen at all.
      const beforeAnything = await page.evaluate(() => window.__laheRail.agentLine());
      expect(beforeAnything.visible, "no agent line before the helper has answered").toBe(false);

      // The real wire: replies.poll carries agent_liveness. This review has no
      // agent session, so the honest answer is `none`, and `none` renders
      // nothing rather than a false alarm about nobody.
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
      expect(overTheWire.state, "a review with no agent session is not an alarm").toBe("none");
      expect(overTheWire.unanswered).toBe(0);
      expect(Object.keys(overTheWire).sort()).toEqual([
        "activity_at",
        "monitor_at",
        "oldest_unanswered_at",
        "state",
        "unanswered"
      ]);
      expect(
        (await page.evaluate(() => window.__laheRail.agentLine())).visible,
        "none stays off screen even once it has arrived"
      ).toBe(false);

      // Watching: a monitor heartbeat came in. Calm.
      const watching = await page.evaluate(
        (at) =>
          window.__laheRail.setAgentLiveness({
            state: "watching",
            monitor_at: at,
            activity_at: null,
            unanswered: 2,
            oldest_unanswered_at: at
          }) && window.__laheRail.agentLine(),
        agoIso(5000)
      );
      expect(watching.visible).toBe(true);
      expect(watching.text).toBe("Agent watching");
      expect(watching.title).toContain("monitor checked in");
      expect(Number(watching.weight), "watching is calm, not bold").toBeLessThan(600);

      // Working: no heartbeat, but the session ran a command recently. Also
      // calm: this is the state an agent is in while it does the work, and it
      // is exactly when a false red would be most misleading.
      const working = await page.evaluate(
        (at) =>
          window.__laheRail.setAgentLiveness({
            state: "working",
            monitor_at: null,
            activity_at: at,
            unanswered: 3,
            oldest_unanswered_at: at
          }) && window.__laheRail.agentLine(),
        agoIso(30000)
      );
      expect(working.visible).toBe(true);
      expect(working.text).toBe("Agent working");
      expect(Number(working.weight), "working is calm, not bold").toBeLessThan(600);
      expect(working.dotColor, "working and watching are different dots").not.toBe(watching.dotColor);

      // Unattended: the one loud state, and the only one carrying an age.
      const unattended = await page.evaluate(
        (at) =>
          window.__laheRail.setAgentLiveness({
            state: "unattended",
            monitor_at: null,
            activity_at: null,
            unanswered: 7,
            oldest_unanswered_at: at
          }) && window.__laheRail.agentLine(),
        agoIso(12 * 60 * 1000)
      );
      expect(unattended.visible).toBe(true);
      expect(unattended.text).toContain("No agent watching");
      expect(unattended.text, "the age is what makes the next move obvious").toContain("oldest item 12m");
      expect(Number(unattended.weight), "unattended is the one loud state").toBeGreaterThanOrEqual(600);
      expect(unattended.title).toContain("Your items are waiting");

      // And back to nothing when the work is answered.
      const settled = await page.evaluate(
        () =>
          window.__laheRail.setAgentLiveness({
            state: "none",
            monitor_at: null,
            activity_at: null,
            unanswered: 0,
            oldest_unanswered_at: null
          }) && window.__laheRail.agentLine()
      );
      expect(settled.visible, "an answered review says nothing about agents").toBe(false);
      expect(settled.text).toBe("");
    } finally {
      await helper.stop();
    }
  });
});
