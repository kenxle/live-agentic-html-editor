// CP2: the second stitch-back, as a script.
//
// Ranked test 38, and the plan's own words for it:
//
//   "on 0C's app fixture with the helper running: type a fix while the page
//    morphs on its timer, commit it, reload, confirm the record survived and
//    replay re-applied it, then have the fixture rewrite the source under a
//    different region and confirm nothing else moved."
//
// Everything in it is real. There is no boot file, no stub, and no fixture
// generator anywhere in this walk:
//
//   REAL  the application: 0C's node app, serving its own HTML, running its own
//         poll-and-morph engine on its own timer, in the RAW flavor (no hook of
//         any kind, every node under the target destroyed on every pass)
//   REAL  the arrival: one script tag with protocol.js's three attributes, and
//         src/layer/index.js booting itself off that tag
//   REAL  the helper, and the token: 1A's reviews.create minted it, and the page
//         is handed the one it minted
//   REAL  the records: every one made by the reviewer's own gestures through 2A
//   REAL  the reload: a full navigation, a fresh JavaScript context, a fresh DOM
//         built from the server's HTML, and replay putting the edit back on it
//
// Like CP1 this is a checked-in spec rather than a hand walk, and it re-runs at
// every later checkpoint. A Phase 3 merge that breaks durability across a reload
// fails here rather than in Phase 4.
//
// The three positive controls, because each of these assertions has a way of
// passing for the wrong reason:
//
//   1. The page really morphed under the reviewer while they typed
//      (window.__app.counters.morphPasses), and replay really ran
//      (counters.replayPasses). Text that survived a page that never changed is
//      not protection working.
//   2. The server's own HTML does NOT contain the reviewer's fix. It is fetched
//      and asserted, so "the text is on the page after a reload" cannot pass
//      because the application happened to serve it.
//   3. The source under the other region really changed. "Nothing else moved"
//      after a rewrite that never happened is not a property of anything.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  placeCaret,
  readCounters,
  startService,
  readEventLog,
  SERVICE_ENTRY
} = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "cp2-walk-review";

// The helper's default port is fixed, because a reviewed page has it baked into
// its script tag. Tests run in parallel, so this one asks for an ephemeral port
// and reads the real one back out of service.json.
const EPHEMERAL_PORT = ["--port", "0"];

// The application's own wording, written out rather than read back off the page:
// a test that reads the page for its expectation cannot tell a `before` pinned
// at first touch from one that drifted with the page.
const SOURCE = {
  fix:
    "The two people to reach before lunch are Devon, who has missed two easy runs in a row, and Priya, who asked a real question and got a thumbs up instead of an answer.",
  rest:
    "Everyone else is on program and does not need anything from you today. Leaving them alone is a decision, not neglect.",
  lede:
    "Nine clients checked in this week. Two are drifting off their program, and one just hit a squat number she has been chasing since February."
};

// The reviewer's own words. Straight apostrophes and a comma that must not come
// back as an em dash, asserted byte for byte on both sides of the reload.
const SAID = {
  fix: " Say which one you'll text first, and say it here.",
  rest: " Say that out loud in the app, so nobody wonders.",
  comment: "Nine checked in, four cards below. Pick one number and use it twice."
};

// The regions. Named once, because every step of the walk refers to them and a
// selector typed twice is a selector that goes stale once.
const REGION = {
  fix: "section.focus p:nth-of-type(1)",
  rest: "section.focus p:nth-of-type(2)",
  lede: "p.lede",
  // Inside the morph target: the region whose SOURCE the application rewrites,
  // and the one region in this walk the reviewer never touches.
  other: "#feed-highlight"
};

// --- the reviewer's gestures, all real ---------------------------------------

async function enterEdit(page, selector) {
  await placeCaret(page, { selector: selector, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.isEditing(), undefined, {
    message: "Cmd-Shift-E to put the block under the caret into edit state"
  });
}

async function typeAtEnd(page, selector, text) {
  const length = await page.evaluate((sel) => document.querySelector(sel).textContent.length, selector);
  await placeCaret(page, { selector: selector, offset: length });
  await page.keyboard.type(text, { delay: 20 });
}

async function commitWithEscape(page) {
  await page.keyboard.press("Escape");
  await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
    message: "Esc to commit the edit and give the block back to the page"
  });
}

async function editAndCommit(page, selector, text) {
  await enterEdit(page, selector);
  await typeAtEnd(page, selector, text);
  await commitWithEscape(page);
  return page.evaluate((sel) => window.__lahe.itemForElement(sel), selector);
}

/** A drag over one block, then Cmd-Shift-C, the reviewer's words, Cmd-Enter. */
async function commentOnSelection(page, selector, text) {
  await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("nothing matched " + sel);
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
}

// --- reading the reviewer's work ---------------------------------------------

/** Every record except the named ids, as one string, byte for byte. */
function snapshot(page, exceptIds) {
  return page.evaluate(function (skip) {
    return window.__lahe
      .items()
      .filter(function (item) {
        return skip.indexOf(item.id) === -1;
      })
      .map(function (item) {
        return JSON.stringify(item);
      })
      .join("\n");
  }, exceptIds || []);
}

function textOf(page, selector) {
  return page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    return el ? el.textContent : null;
  }, selector);
}

/** The events one item produced on disk, oldest first. */
function eventsForItem(log, itemId) {
  return log.filter((event) => event.item === itemId && event.record);
}

test.describe("CP2: the walk, on a real application, across a reload", () => {
  test("a fix typed through a morph survives a reload, replay puts it back, and a rewrite elsewhere moves nothing", async ({
    page
  }) => {
    // The application, then the helper against ITS origin, then the tag. That
    // order is the real one: a review is registered for the origin it will be
    // reviewed on, and that origin does not exist until the app is listening.
    const appServer = await startAppServer();

    // THE REAL MINT PATH. The helper creates the review and mints its token, and
    // the application is handed the token it minted. Nothing here invents a
    // credential.
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [appServer.origin]
    });
    const token = helper.tokenFor(REVIEW);
    expect(token, "the helper minted a per-review token").toBeTruthy();

    try {
      // The library arrives the way it arrives in a host application: ONE script
      // tag in the application's own layout, carrying the review, the token and
      // the helper's origin, with the built bundle served out of the
      // application's own assets. Nothing about it is injected by the harness.
      appServer.useLayer({ review: REVIEW, token: token, helper: helper.url });

      // The raw flavor, polling four times a second. No cooperative attribute,
      // no pre-morph event, every node under the feed destroyed on every pass.
      const walkUrl = appServer.urlFor("/?morph=raw&poll=250");
      await page.goto(walkUrl);
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot from its script tag"
      });

      // The application is genuinely running its own engine, in the flavor that
      // gives the library nothing.
      expect(await page.evaluate(() => window.__app.morph.flavor)).toBe("raw");
      expect(await page.evaluate(() => window.__app.morph.polling)).toBe(true);

      // --- the reviewer's other work, before the fix -------------------------
      //
      // A comment and a second edit, so "every other record is byte-identical"
      // is a claim about records that exist.

      await commentOnSelection(page, REGION.lede, SAID.comment);
      const other = await editAndCommit(page, REGION.rest, SAID.rest);
      expect(other.before, "before is the application's own wording").toBe(SOURCE.rest);
      expect(other.after).toBe(SOURCE.rest + SAID.rest);

      // --- the fix, typed while the page morphs on its timer -----------------

      const beforeTyping = await page.evaluate(() => ({
        morphPasses: window.__app.counters.morphPasses,
        replayPasses: window.__lahe.counters.replayPasses
      }));

      await enterEdit(page, REGION.fix);
      await typeAtEnd(page, REGION.fix, SAID.fix);

      // The first positive control: the application really did repaint under the
      // reviewer while they typed, and the library really did run passes over it.
      await pollPage(
        page,
        (args) =>
          window.__app.counters.morphPasses >= args[0] + 2 && window.__lahe.counters.replayPasses >= args[1] + 2,
        [beforeTyping.morphPasses, beforeTyping.replayPasses],
        { message: "at least two morph passes and two replay passes under the reviewer's hands" }
      );

      // The reviewer's sentence is on the page, whole, with the page reverting
      // itself the whole time.
      expect(await textOf(page, REGION.fix)).toBe(SOURCE.fix + SAID.fix);

      await commitWithEscape(page);

      const fix = await page.evaluate((sel) => window.__lahe.itemForElement(sel), REGION.fix);
      expect(fix.kind).toBe("edit");
      expect(fix.state, "an edit the reviewer left is ready, not a draft").toBe("ready");
      expect(fix.rev).toBe(1);
      expect(fix.before, "before is pinned to the application's wording at first touch").toBe(SOURCE.fix);
      expect(fix.after).toBe(SOURCE.fix + SAID.fix);

      const idsBefore = await page.evaluate(() => window.__lahe.items().map((i) => i.id));
      expect(idsBefore, "three records: a comment and two edits").toHaveLength(3);

      // The helper has it, on disk, before anything is reloaded.
      const logBeforeReload = await pollUntil(
        () => {
          const lines = readEventLog(helper.stateDir, REVIEW);
          return eventsForItem(lines, fix.id).length > 0 ? lines : null;
        },
        {
          message: "the fix to reach the helper's events.jsonl",
          describe: async () => ({
            eventsOnDisk: readEventLog(helper.stateDir, REVIEW).length,
            status: await page.evaluate(() => window.__lahe.status()),
            failures: await page.evaluate(() => window.__lahe.failures()),
            pending: await page.evaluate(() => window.__lahe.store().pendingEvents(window.__lahe.review).length),
            helperAlive: helper.alive(),
            // The helper's own log, because "the record never arrived" and "the
            // helper refused it and said why" are different bugs and the page
            // cannot tell them apart: a refusal answers without the CORS header,
            // so the browser reports it as a bare failure to fetch.
            helperLog: fs.readFileSync(path.join(helper.stateDir, "helper.log"), "utf8").slice(-1200)
          })
        }
      );
      const landed = eventsForItem(logBeforeReload, fix.id);
      expect(landed[landed.length - 1].record.after).toBe(SOURCE.fix + SAID.fix);

      // --- the reload --------------------------------------------------------
      //
      // A full navigation: a fresh JavaScript context, a fresh boot, and a DOM
      // the application built from its own HTML with none of the reviewer's work
      // in it.

      await page.evaluate(() => {
        window.__cp2WalkStamp = "before the reload";
      });

      await page.reload();
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot again on the reloaded page"
      });
      expect(
        await page.evaluate(() => window.__cp2WalkStamp === undefined),
        "the reload really was a fresh context, not a soft re-render"
      ).toBe(true);

      // The second positive control: the application does not serve the fix. So
      // the fix being on the page after this reload is replay's doing and can be
      // nothing else.
      const served = await page.request.get(walkUrl);
      const servedHtml = await served.text();
      expect(servedHtml).toContain(SOURCE.fix);
      expect(servedHtml, "the application never learned the reviewer's sentence").not.toContain(SAID.fix.trim());

      // The record survived, in the store, byte for byte.
      const survived = await page.evaluate((id) => window.__lahe.itemById(id), fix.id);
      expect(survived, "the record is in browser storage after the reload").toBeTruthy();
      expect(Buffer.compare(Buffer.from(survived.after, "utf8"), Buffer.from(SOURCE.fix + SAID.fix, "utf8"))).toBe(0);
      expect(survived.rev).toBe(1);
      expect(survived.state).toBe("ready");
      expect(await page.evaluate(() => window.__lahe.items().map((i) => i.id))).toEqual(idsBefore);

      // And in the helper's log, exactly once as the reviewer left it.
      const finals = eventsForItem(readEventLog(helper.stateDir, REVIEW), fix.id);
      const readyOnDisk = finals.filter((event) => event.record.after === SOURCE.fix + SAID.fix);
      expect(readyOnDisk.length, "the fix is on disk").toBeGreaterThan(0);
      expect(finals[finals.length - 1].record.state).toBe("ready");

      // Replay re-applied it to the fresh DOM. Both edits: the fix and the one
      // made before it.
      await pollPage(
        page,
        (args) =>
          document.querySelector(args.fixSelector).textContent === args.fixText &&
          document.querySelector(args.restSelector).textContent === args.restText,
        {
          fixSelector: REGION.fix,
          fixText: SOURCE.fix + SAID.fix,
          restSelector: REGION.rest,
          restText: SOURCE.rest + SAID.rest
        },
        { message: "replay to put both committed edits back on the reloaded page" }
      );

      const afterReplay = await readCounters(page);
      expect(afterReplay.regionsWritten, "replay WROTE, rather than finding the page already right").toBeGreaterThanOrEqual(2);
      expect(afterReplay.regionsBlockedChanged, "nothing collided on a page nobody else had touched").toBe(0);
      expect(await page.evaluate(() => window.__lahe.flaggedIds())).toEqual([]);

      // --- the application rewrites the source under ANOTHER region ----------
      //
      // The feed's source is the application's own: every poll advances its
      // cursor and the server hands back different sentences for the same
      // region. That is a source rewrite in the only honest sense, and it lands
      // under a region the reviewer never touched.

      const otherBefore = await textOf(page, REGION.other);
      const recordsBefore = await snapshot(page, []);
      const countersBefore = await readCounters(page);

      await pollPage(
        page,
        (args) => {
          const el = document.querySelector(args[0]);
          return !!el && el.textContent !== args[1];
        },
        [REGION.other, otherBefore],
        { message: "the application to serve different words under the other region" }
      );

      // The third positive control, read back rather than assumed.
      const otherAfter = await textOf(page, REGION.other);
      expect(otherAfter, "the source under the other region really did change").not.toBe(otherBefore);

      // Let the library see it: passes after the rewrite, not before it.
      await pollPage(
        page,
        (from) => window.__lahe.counters.replayPasses >= from + 2,
        countersBefore.replayPasses,
        { message: "two more replay passes after the source moved" }
      );

      // Nothing else moved. Every record byte-identical, state included.
      expect(await snapshot(page, [])).toBe(recordsBefore);

      // No branch four anywhere: a rewrite under a region nobody has a record
      // for is not a collision with anybody's record.
      const countersAfter = await readCounters(page);
      expect(countersAfter.regionsBlockedChanged - countersBefore.regionsBlockedChanged).toBe(0);
      expect(await page.evaluate(() => window.__lahe.flaggedIds())).toEqual([]);
      expect(countersAfter.regionsLost - countersBefore.regionsLost, "no record lost its place").toBe(0);

      // And the reviewer's own regions still hold the reviewer's words.
      expect(await textOf(page, REGION.fix)).toBe(SOURCE.fix + SAID.fix);
      expect(await textOf(page, REGION.rest)).toBe(SOURCE.rest + SAID.rest);
      expect(await textOf(page, REGION.lede), "a commented region is never written to").toBe(SOURCE.lede);
    } finally {
      await appServer.close();
      await helper.kill9();
    }
  });
});
