// Ranked test 7: commit-on-navigation is DELIVERED, not just stored.
//
// An edit is left open, the reviewer navigates, and on the next page load the
// record is in events.jsonl exactly once, including the final keystroke.
//
// It runs on all three browsers because unload delivery is precisely where they
// differ: the transport is fetch with keepalive (never sendBeacon, which cannot
// carry the token header D11 requires), and each engine has its own opinion
// about what it will still send while a document is going away.
//
// Plus the oversize case, and it is written so it cannot pass by accident. A
// body past the keepalive cap is refused at unload, and the second load is
// deliberately given NO credential, so nothing can drain the queue there. Only
// the third load, which has one, delivers. That is the difference between "the
// oversize edit survived" and "the oversize edit went out anyway and nobody
// noticed the cap was never hit".
//
// Delivery here is the LOG, not the library's own report of itself. Every
// assertion reads events.jsonl off the helper's state directory.

"use strict";

const path = require("node:path");
const {
  test,
  expect,
  startStaticServer,
  startService,
  readEventLog,
  pollUntil,
  pollPage,
  placeCaret,
  SERVICE_ENTRY
} = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const FIXTURE = "test/fixtures/editing-doc.html";
const REVIEW = "edit-navigation";
const EPHEMERAL_PORT = ["--port", "0"];

const ORIGINAL_ALPHA = "Runners come back too fast after a layoff.";
// The last two characters are typed with real key events after everything else,
// so "including the final keystroke" is an assertion rather than a hope.
const TYPED = " Say it plainly";
const FINAL_KEYSTROKE = ".";

function urlFor(pages, options) {
  const query = new URLSearchParams({ review: REVIEW });
  if (options.helper) query.set("helper", options.helper);
  if (options.token) query.set("token", options.token);
  if (options.p) query.set("p", String(options.p));
  return pages.urlFor(FIXTURE) + "?" + query.toString();
}

/** Every event the log holds for the one item, oldest first. */
function eventsForItem(log, itemId) {
  return log.filter((event) => event.item === itemId);
}

function itemIdsIn(log) {
  const out = [];
  log.forEach((event) => {
    if (event.record && out.indexOf(event.item) === -1) out.push(event.item);
  });
  return out;
}

async function openEditAndType(page, text) {
  await placeCaret(page, { selector: "#alpha", offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__laheEdit.isEditing(), undefined, {
    message: "Cmd-Shift-E to open edit state on #alpha"
  });
  const length = await page.evaluate(() => document.getElementById("alpha").textContent.length);
  await placeCaret(page, { selector: "#alpha", offset: length });
  await page.keyboard.type(text, { delay: 20 });
}

test.describe("2A: an edit open at navigation is delivered (R1)", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "editing-nav" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("navigating with an edit open lands the record, once, with the final keystroke", async ({ page }) => {
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });
    const token = helper.tokenFor(REVIEW);

    try {
      await page.goto(urlFor(pages, { helper: helper.url, token: token, p: 1 }));
      await openEditAndType(page, TYPED);
      await page.keyboard.type(FINAL_KEYSTROKE, { delay: 20 });

      // Still open. Nothing has been committed by a gesture, and nothing may
      // be: this is the case where the reviewer just leaves.
      expect(await page.evaluate(() => window.__laheEdit.isEditing())).toBe(true);
      const itemId = await page.evaluate(() => window.__laheEdit.state().itemId);

      // A real navigation: the same review, the second page.
      await page.goto(urlFor(pages, { helper: helper.url, token: token, p: 2 }));

      const log = await pollUntil(
        () => {
          const lines = readEventLog(helper.stateDir, REVIEW);
          const events = eventsForItem(lines, itemId);
          const last = events[events.length - 1];
          return last && last.record && last.record.state === "ready" ? lines : null;
        },
        { message: "the edit committed at navigation to reach events.jsonl as ready" }
      );

      const eventIds = log.map((event) => event.event_id);
      expect(new Set(eventIds).size, "every event is on disk exactly once").toBe(eventIds.length);
      expect(itemIdsIn(log), "one edit, one record").toEqual([itemId]);

      const events = eventsForItem(log, itemId);
      const committed = events[events.length - 1].record;
      expect(committed.kind).toBe("edit");
      expect(committed.state, "committed on the way out, not left a draft").toBe("ready");
      expect(committed.before, "and its before is still the page's own wording").toBe(ORIGINAL_ALPHA);

      const expected = ORIGINAL_ALPHA + TYPED + FINAL_KEYSTROKE;
      expect(committed.after, "including the final keystroke").toBe(expected);
      expect(
        Buffer.compare(Buffer.from(committed.after, "utf8"), Buffer.from(expected, "utf8")),
        "byte for byte, never truncated and never cleaned up"
      ).toBe(0);

      // Exactly once, in the sense that matters: the committed wording is not
      // on disk twice under two different records or two ready events.
      const readyEvents = events.filter((event) => event.record && event.record.state === "ready");
      expect(readyEvents, "one commit, one ready event").toHaveLength(1);
    } finally {
      if (helper.alive()) await helper.kill9();
    }
  });

  test("an edit past the keepalive cap is absent at unload and present after the next load", async ({
    page
  }) => {
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });
    const token = helper.tokenFor(REVIEW);

    try {
      await page.goto(urlFor(pages, { helper: helper.url, token: token, p: 1 }));
      await openEditAndType(page, TYPED);

      // Past the cap (64KB), inserted through the editing surface so it goes
      // through beforeinput and input the way typing does, then the final
      // keystroke on top of it with real key events.
      const bulk = await page.evaluate(() => {
        const filler = "x".repeat(70000);
        document.execCommand("insertText", false, filler);
        return filler.length;
      });
      expect(bulk).toBe(70000);
      await page.keyboard.type(FINAL_KEYSTROKE, { delay: 20 });

      const itemId = await page.evaluate(() => window.__laheEdit.state().itemId);
      expect(await page.evaluate(() => window.__laheEdit.isEditing())).toBe(true);

      // The second load carries NO token, so it creates no sync client and
      // cannot drain anything. Whatever is on disk after this got there on the
      // unload path.
      await page.goto(urlFor(pages, { p: 2 }));
      await pollPage(page, () => !!window.__laheEdit, undefined, {
        message: "the second page to boot without a credential"
      });

      const afterUnload = eventsForItem(readEventLog(helper.stateDir, REVIEW), itemId);
      expect(
        afterUnload.filter((event) => event.record && event.record.state === "ready"),
        "a body past the keepalive cap does not go out at unload"
      ).toHaveLength(0);

      // The queue is still the reviewer's, in browser storage, on the same
      // origin, whole.
      expect(
        await page.evaluate(() => window.__laheEdit.pending()),
        "and it is queued rather than lost"
      ).toBeGreaterThan(0);

      // The next load with a credential delivers it. Nothing was truncated on
      // the way, including the final keystroke.
      await page.goto(urlFor(pages, { helper: helper.url, token: token, p: 3 }));

      const log = await pollUntil(
        () => {
          const lines = readEventLog(helper.stateDir, REVIEW);
          const events = eventsForItem(lines, itemId);
          const last = events[events.length - 1];
          return last && last.record && last.record.state === "ready" ? lines : null;
        },
        { timeoutMs: 30000, message: "the oversize edit to reach events.jsonl on the next load" }
      );

      const events = eventsForItem(log, itemId);
      const committed = events[events.length - 1].record;
      expect(committed.state).toBe("ready");
      expect(committed.after.length, "the whole oversize body arrived").toBe(
        (ORIGINAL_ALPHA + TYPED).length + 70000 + FINAL_KEYSTROKE.length
      );
      expect(committed.after.endsWith(FINAL_KEYSTROKE), "final keystroke and all").toBe(true);
      expect(committed.before).toBe(ORIGINAL_ALPHA);

      const eventIds = log.map((event) => event.event_id);
      expect(new Set(eventIds).size, "and nothing was delivered twice").toBe(eventIds.length);
    } finally {
      if (helper.alive()) await helper.kill9();
    }
  });

  test("a navigation slower than the flush debounce still cannot post an oversize body", async ({ page }) => {
    // The race the test above can only meet by luck, made deterministic.
    //
    // Committing on navigation deliberately does NOT ask for an immediate
    // flush, because an ordinary fetch racing the teardown is the transport
    // this design refuses to rely on. What it does instead is queue the event
    // on the ordinary 750ms debounce, and that timer keeps running for as long
    // as the old document is alive. A navigation is not instant: beforeunload
    // fires, and only then does the browser go and fetch the next page. On a
    // loaded CI box that took longer than the debounce, the ordinary flush
    // fired, and an ordinary flush has no keepalive cap, so the 70KB body the
    // unload path had just refused went out anyway (seen twice on 2026-09-15).
    //
    // Here beforeunload is dispatched on its own and the document is left
    // standing well past the debounce. No real navigation is involved, so
    // nothing can rescue the assertion by tearing the page down first.
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });
    const token = helper.tokenFor(REVIEW);

    try {
      await page.goto(urlFor(pages, { helper: helper.url, token: token, p: 1 }));
      await openEditAndType(page, TYPED);

      const bulk = await page.evaluate(() => {
        const filler = "x".repeat(70000);
        document.execCommand("insertText", false, filler);
        return filler.length;
      });
      expect(bulk).toBe(70000);
      await page.keyboard.type(FINAL_KEYSTROKE, { delay: 20 });
      const itemId = await page.evaluate(() => window.__laheEdit.state().itemId);

      // Everything the reviewer typed BEFORE this point is draft state, and
      // draft events are small and go out normally. The line this test draws is
      // around the ready event the commit makes, which carries the whole body.
      const readyBefore = readEventLog(helper.stateDir, REVIEW).filter(
        (event) => event.item === itemId && event.record && event.record.state === "ready"
      );
      expect(readyBefore, "nothing is committed yet").toHaveLength(0);

      // The document says it is leaving, and then does not leave.
      await page.evaluate(() => window.dispatchEvent(new Event("beforeunload", { cancelable: true })));
      expect(await page.evaluate(() => window.__laheEdit.isEditing()), "the edit committed").toBe(false);

      // The debounce is not waited out, which would be a sleep dressed as a
      // test. The timer's only door is asked for directly instead: an ordinary
      // flush, the exact call that timer makes when it fires. It is refused,
      // and the reason names the rule.
      //
      // The poll is for one state only, and it is not the answer: a post that
      // was already in flight when beforeunload fired answers "busy" until it
      // settles, which is true and says nothing about the rule. That post
      // carries the DRAFT events queued before the commit, never the ready one,
      // so nothing oversize can leave by it either. Twice in eighty on a loaded
      // CI box, which is why the shape is polled rather than assumed.
      const refused = await pollUntil(
        async () => {
          const result = await page.evaluate(() => window.__laheEdit.flush());
          return result && !result.busy ? result : null;
        },
        { message: "the ordinary flush to answer for itself rather than report one already in flight" }
      );
      expect(refused.unloading, "an ordinary flush is refused while the document is leaving").toBe(true);
      expect(refused.sent, "so nothing went out by it").toBe(0);

      const after = readEventLog(helper.stateDir, REVIEW).filter(
        (event) => event.item === itemId && event.record && event.record.state === "ready"
      );
      expect(after, "a body past the keepalive cap has no ordinary flush to leave by").toHaveLength(0);
      expect(
        await page.evaluate(() => window.__laheEdit.pending()),
        "and it is still queued in browser storage, whole"
      ).toBeGreaterThan(0);

      // THE CONTROL, so "nothing on disk" cannot pass for the wrong reason. The
      // navigation is cancelled, the document is alive again, and the very same
      // body goes out on the very same ordinary flush and lands. The helper was
      // reachable and the post was postable the whole time; the guard is the
      // only thing that had been holding it.
      await page.evaluate(() => window.dispatchEvent(new Event("pageshow")));
      const log = await pollUntil(
        () => {
          const lines = readEventLog(helper.stateDir, REVIEW).filter(
            (event) => event.item === itemId && event.record && event.record.state === "ready"
          );
          return lines.length ? lines : null;
        },
        { timeoutMs: 30000, message: "the same oversize body to land once the page turns out to be alive" }
      );
      expect(log[0].record.after.length, "whole, not truncated").toBe(
        (ORIGINAL_ALPHA + TYPED).length + 70000 + FINAL_KEYSTROKE.length
      );
    } finally {
      if (helper.alive()) await helper.kill9();
    }
  });

  test("clicking a link with an edit open commits it and still follows the link", async ({ page }) => {
    // Browse is native (R13): a click outside the edited block commits the edit
    // AND reaches the page. If the library swallowed the click to commit first,
    // every link on the page would need two clicks while an edit was open.
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });
    const token = helper.tokenFor(REVIEW);

    try {
      await page.goto(urlFor(pages, { helper: helper.url, token: token, p: 1 }));
      await openEditAndType(page, TYPED + FINAL_KEYSTROKE);
      const itemId = await page.evaluate(() => window.__laheEdit.state().itemId);

      await page.click("#next");
      await page.waitForURL(/[?&]p=2/);

      const log = await pollUntil(
        () => {
          const lines = readEventLog(helper.stateDir, REVIEW);
          const events = eventsForItem(lines, itemId);
          const last = events[events.length - 1];
          return last && last.record && last.record.state === "ready" ? lines : null;
        },
        { message: "the edit committed by the link click to reach events.jsonl" }
      );

      const events = eventsForItem(log, itemId);
      expect(events[events.length - 1].record.after).toBe(ORIGINAL_ALPHA + TYPED + FINAL_KEYSTROKE);
      expect(
        events.filter((event) => event.record && event.record.state === "ready"),
        "one commit, however many handlers saw the click"
      ).toHaveLength(1);
    } finally {
      if (helper.alive()) await helper.kill9();
    }
  });
});
