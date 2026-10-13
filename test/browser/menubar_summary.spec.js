// The menu bar's count against a real review page (menu bar plan, V19 and V5).
//
// The summary is read the way the Mac app reads it: a GET signed with the CLI
// secret, against the helper `lahe review` started. Everything else is real:
// the session, the helper, the page, the rail and the agent's reply file.
//
//   V19  an agent question shows at the summary within 5 s; a routine handled
//        reply never shows; a page left open without its card opened holds the
//        count; opening the card clears it within 10 s
//   V5   opening a card posts one reply.seen per stamp, and a reply read in a
//        second browser context clears "1 new" in the first on its next poll
//
// Both run on a Markdown review and on a multi-page site review. Each world is
// its own temp state folder; its session is closed and its helper stopped by
// its own state folder in teardown, even when a test fails.

"use strict";

const fs = require("node:fs");
const os = require("node:os");
const net = require("node:net");
const http = require("node:http");
const crypto = require("node:crypto");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { test, expect, pollPage, pollUntil } = require("../helpers");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");
const protocol = require("../../src/shared/protocol.js");
const auth = require("../../src/service/auth.js");

const REPO_ROOT = path.join(__dirname, "..", "..");
const CLI = path.join(REPO_ROOT, "bin", "lahe.js");
const SITE_FIXTURE = path.join(REPO_ROOT, "test", "fixtures", "site");

const QUESTION = "Which week is this about?";
const ROUTINE = "Tighten this sentence.";

function freePort() {
  return new Promise(function (resolve, reject) {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", function () {
      const port = server.address().port;
      server.close(function () {
        resolve(port);
      });
    });
  });
}

function labelled(output, label) {
  const match = new RegExp("^\\s*" + label + "\\s+(\\S+)", "m").exec(output);
  return match ? match[1] : null;
}

// The two kinds of review, each with the page the reviewer reads and the two
// passages they comment on: the question's and the routine one's.
const KINDS = [
  {
    name: "a Markdown review",
    make(root) {
      const source = path.join(root, "work", "post.md");
      fs.mkdirSync(path.dirname(source), { recursive: true });
      fs.writeFileSync(source, ["# Coming back", "", "## Intro", "", "Runners come back too fast.", "", "## Premise", "", "All those days are gone.", ""].join("\n"));
      return source;
    },
    routine: { page: null, selector: "main > section:nth-of-type(2) > p" },
    question: { page: null, selector: "main > section:first-of-type > p" }
  },
  {
    name: "a multi-page site review",
    make(root) {
      const site = path.join(root, "site");
      fs.mkdirSync(site, { recursive: true });
      fs.readdirSync(SITE_FIXTURE).forEach((name) => fs.copyFileSync(path.join(SITE_FIXTURE, name), path.join(site, name)));
      return site;
    },
    routine: { page: "/index.html", selector: "main p" },
    question: { page: "/plan.html", selector: "#body" }
  }
];

for (const kind of KINDS) {
  test.describe("the menu bar's count, on " + kind.name, () => {
    test.describe.configure({ mode: "serial" });
    let world = null;

    test.beforeEach(async () => {
      const root = fs.mkdtempSync(path.join(os.tmpdir(), "lahe-menubar-"));
      const stateDir = path.join(root, "state");
      const env = Object.assign({}, process.env, { LAHE_STATE_DIR: stateDir });
      delete env.XDG_STATE_HOME;
      world = { root, stateDir, env, port: await freePort() };
      const output = execFileSync(process.execPath, [CLI, "review", kind.make(root), "--port", String(world.port)], {
        cwd: REPO_ROOT,
        env,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      });
      world.session = labelled(output, "session");
      world.review = labelled(output, "review");
      world.open = labelled(output, "open");
      expect(world.open, "`lahe review` printed the page's address").toBeTruthy();
      world.origin = new URL(world.open).origin;
      world.reviewDir = path.join(stateDir, "reviews", world.review);
    });

    test.afterEach(async () => {
      if (!world) return;
      try {
        execFileSync(process.execPath, [CLI, "session", "close", world.session], {
          cwd: REPO_ROOT,
          env: world.env,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (err) {
        // A session that already went down is not a test failure.
      }
      await stopTempHelpers(world.stateDir);
      world = null;
    });

    // --- the app's half: a signed read of the summary ------------------------

    function summary() {
      const secret = fs.readFileSync(path.join(world.stateDir, "cli-secret"), "utf8").trim();
      const target = protocol.route("summary.read").path + "?v=" + protocol.SUMMARY_VERSION;
      const ts = String(Date.now());
      const nonce = crypto.randomBytes(16).toString("hex");
      const proof = auth.hmacHex(secret, auth.proofSignedString("GET", target, ts, nonce, auth.sha256Hex("")));
      return new Promise((resolve, reject) => {
        const req = http.request(
          {
            host: "127.0.0.1",
            port: world.port,
            path: target,
            agent: false,
            headers: {
              [protocol.HEADER.PROOF_TS]: ts,
              [protocol.HEADER.PROOF_NONCE]: nonce,
              [protocol.HEADER.PROOF]: proof
            }
          },
          (res) => {
            const chunks = [];
            res.on("data", (c) => chunks.push(c));
            res.on("end", () => {
              const text = Buffer.concat(chunks).toString("utf8");
              const signedBack = res.headers[protocol.HEADER.PROOF_REPLY] === auth.replyProof(secret, nonce, res.statusCode, Buffer.from(text, "utf8"));
              if (res.statusCode !== 200 || !signedBack) return reject(new Error("summary.read answered " + res.statusCode + ": " + text));
              resolve(JSON.parse(text));
            });
          }
        );
        req.on("error", reject);
        req.end();
      });
    }

    async function waitingDoc() {
      const answer = await summary();
      return answer.waiting_on_you.documents.find((d) => d.review === world.review) || null;
    }

    // --- the agent's half ----------------------------------------------------

    function agentReplies(fields) {
      fs.appendFileSync(path.join(world.reviewDir, "replies.jsonl"), JSON.stringify(Object.assign({ agent: "claude" }, fields)) + "\n");
    }

    function projectedItem(id) {
      try {
        const parsed = JSON.parse(fs.readFileSync(path.join(world.reviewDir, "review.json"), "utf8"));
        for (const group of parsed.pages || []) {
          const got = (group.items || []).find((item) => item.id === id);
          if (got) return got;
        }
      } catch (err) {
        return null;
      }
      return null;
    }

    function readMarks() {
      return fs
        .readFileSync(path.join(world.reviewDir, "events.jsonl"), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
        .filter((event) => event.event === "reply.seen");
    }

    // --- the reviewer's half -------------------------------------------------

    async function visit(page, where) {
      await page.goto(where ? world.origin + where : world.open);
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot",
        timeoutMs: 20000
      });
      await page.evaluate(() => window.__lahe.interactionBusy(50));
      if (await page.evaluate(() => window.__lahe.handle.sync.status().readOnly)) {
        await page.evaluate(() => window.__lahe.handle.sync.takeover());
        await pollPage(page, () => window.__lahe.handle.sync.status().readOnly === false, undefined, {
          message: "this window to hold the review"
        });
      }
    }

    async function commentOn(page, spot, text) {
      await visit(page, spot.page);
      await page.evaluate((sel) => {
        const range = document.createRange();
        range.selectNodeContents(document.querySelector(sel));
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
      }, spot.selector);
      await page.keyboard.press("ControlOrMeta+Shift+KeyC");
      await pollPage(page, () => !!window.__lahe.focusedBoxQuote(), undefined, { message: "the comment box to open" });
      await page.keyboard.type(text);
      await page.keyboard.press("ControlOrMeta+Enter");
      await pollPage(page, (note) => window.__lahe.items().some((i) => i.note === note && i.state === "ready"), text, {
        message: "the comment to become ready"
      });
      await pollPage(page, () => window.__lahe.handle.sync.status().queued === 0, undefined, {
        message: "the comment to reach the helper"
      });
      await page.evaluate(() => window.__lahe.handle.comments.closeAll());
      return page.evaluate((note) => window.__lahe.items().find((i) => i.note === note), text);
    }

    /** The reviewer is looking at the page, not the rail. */
    function railAway(page) {
      return page.evaluate(() => window.__lahe.rail.collapse(true));
    }

    /** Open the card: the rail out, its tab, the card unfolded. */
    function openCard(page, id) {
      return page.evaluate((itemId) => {
        const rail = window.__lahe.rail;
        rail.collapse(false);
        rail.selectTab("active");
        rail.setCardCollapsed(itemId, false);
      }, id);
    }

    function newOnActive(page) {
      return page.evaluate(() => window.__lahe.rail.tabNewCount("active"));
    }

    test("V19: a question shows within 5 s, a routine reply never does, an open page holds it, and opening the card clears it within 10 s", async ({ page }) => {
      const routine = await commentOn(page, kind.routine, ROUTINE);
      const asked = await commentOn(page, kind.question, QUESTION);
      await railAway(page);
      expect((await summary()).waiting_on_you.count, "nothing waits before any reply").toBe(0);

      agentReplies({ item: routine.id, rev: routine.rev, status: "handled" });
      agentReplies({ item: asked.id, rev: asked.rev, status: "question", text: "The week of the race, or the week after?" });
      const askedAt = Date.now();
      const shown = await pollUntil(waitingDoc, { timeoutMs: 15000, message: "the question to show at the summary" });
      const showMs = Date.now() - askedAt;
      expect(showMs, "it showed within 5 s (took " + showMs + " ms)").toBeLessThanOrEqual(5000);
      expect(shown.questions).toBe(1);
      expect(shown.unread, "the routine handled reply is not counted").toBe(1);
      expect(shown.open, "the page is open").toBe(true);

      // The helper folded the routine reply too, and it still does not count.
      await pollUntil(() => {
        const got = projectedItem(routine.id);
        return got && got.state === "handled";
      }, { message: "the routine reply to fold" });
      expect((await waitingDoc()).unread, "a routine handled reply never shows").toBe(1);
      // The page folds the question and, with the rail away, does not read it.
      await pollPage(page, (id) => !!(window.__lahe.items().find((i) => i.id === id) || {}).reply, asked.id, {
        message: "the page to fold the question"
      });
      expect(await newOnActive(page), "the rail says 1 new").toBe(1);
      const polls = await page.evaluate(() => window.__lahe.handle.sync.status().counters.polls);
      await pollPage(page, (from) => window.__lahe.handle.sync.status().counters.polls >= from + 3, polls, {
        message: "the page to poll three more times"
      });
      const held = await waitingDoc();
      expect(held && held.unread, "a page left open without its card opened holds the count").toBe(1);
      expect(readMarks().length, "and posts no read mark").toBe(0);

      await openCard(page, asked.id);
      const openedAt = Date.now();
      await pollUntil(async () => (await waitingDoc()) === null, { timeoutMs: 20000, message: "the count to clear" });
      const clearMs = Date.now() - openedAt;
      expect(clearMs, "it cleared within 10 s (took " + clearMs + " ms)").toBeLessThanOrEqual(10000);
      expect(await newOnActive(page)).toBe(0);
      const marks = readMarks();
      expect(marks.map((m) => m.item), "one reply.seen, for the question").toEqual([asked.id]);

      // Paints and another visit to the tab post nothing more.
      await page.evaluate(() => {
        window.__lahe.rail.selectTab("done");
        window.__lahe.rail.selectTab("active");
      });
      const polled = await page.evaluate(() => window.__lahe.handle.sync.status().counters.polls);
      await pollPage(page, (from) => window.__lahe.handle.sync.status().counters.polls >= from + 2, polled, {
        message: "two more polls"
      });
      expect(readMarks().length, "one per stamp, not one per paint").toBe(1);
      expect((await summary()).waiting_on_you.count).toBe(0);
    });

    test("V5: a reply read in a second browser context clears 1 new in the first on its next poll", async ({ page, browser }) => {
      const asked = await commentOn(page, kind.question, QUESTION);
      await railAway(page);
      agentReplies({ item: asked.id, rev: asked.rev, status: "question", text: "Which of the two weeks?" });
      await pollPage(page, (id) => !!(window.__lahe.items().find((i) => i.id === id) || {}).reply, asked.id, {
        message: "the first browser to fold the question"
      });
      await pollPage(page, () => window.__lahe.rail.tabNewCount("active") === 1, undefined, {
        message: "the first browser to say 1 new"
      });

      const second = await browser.newContext();
      try {
        const other = await second.newPage();
        await visit(other, kind.question.page);
        await pollPage(other, (id) => !!(window.__lahe.items().find((i) => i.id === id) || {}).reply, asked.id, {
          message: "the second browser to hold the question"
        });
        await openCard(other, asked.id);
        await pollUntil(async () => (await waitingDoc()) === null, { timeoutMs: 20000, message: "the summary to clear" });
        expect(readMarks().map((m) => m.item)).toEqual([asked.id]);

        await page.bringToFront();
        await pollPage(page, () => window.__lahe.rail.tabNewCount("active") === 0, undefined, {
          message: "the first browser's 1 new to clear on its next poll",
          timeoutMs: 40000
        });
        expect(readMarks().length, "the first browser adopted the mark and posted nothing back").toBe(1);
      } finally {
        await second.close();
      }
    });
  });
}
