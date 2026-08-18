// AC3, human and agent at the same time, as a script. Ranked test 39, third of
// three.
//
// The criterion, word for word:
//
//   "With the evaluator holding an unfinished edit open in one region, an agent
//    reads review.json, changes the source of a different region, appends a
//    handled line, and the page updates itself. The unfinished edit and its
//    caret survive. The handled item loses its highlight and moves to Done.
//    Every other outstanding item is byte-identical and unchanged in state.
//    Then the agent changes the source of the very region being edited: on
//    commit, that one card is flagged as changed underneath, shows both versions
//    in full, and nothing is overwritten. Fails if: anything is silently
//    overwritten, or the collision is not surfaced."
//
// THE AGENT IS A FILE APPEND. `fs.appendFileSync` on replies-claude.jsonl in the
// review's own folder, which is the entire agent-facing API. There is no
// test-only route, no injected reply, and nothing here calls into the library to
// simulate one: the helper's own reader folds the line and 1B's poll loop brings
// it back to the card.
//
// WHAT "THE AGENT CHANGES THE SOURCE" IS HERE. The reviewed application is 0C's
// node app, and its feed is server-rendered: every poll advances a cursor and
// the server hands back different sentences for the same regions. A region's
// source changing under the reviewer is therefore the application's own
// behavior rather than something the test writes into the DOM, which is the same
// substitution the CP2 walk makes and for the same reason.
//
// DETERMINISM. The application's poll timer is stopped and each morph is driven
// one pass at a time with window.__app.morph.pollNow(), so "the source changed
// while the reviewer was in the region" happens on a known pass rather than on a
// race. Nothing is slept on; every wait is a counter or a condition.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const {
  test,
  expect,
  pollPage,
  pollUntil,
  placeCaret,
  captureCaret,
  compareCaret,
  caretProblems,
  readCounters,
  startService,
  readEventLog,
  SERVICE_ENTRY
} = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "ac3-human-and-agent";
const EPHEMERAL_PORT = ["--port", "0"];

// Region A: the one the reviewer is inside. It lives in the morph target, which
// is the only place on this application whose source moves.
const REGION_A = "#feed-coach-note";

const SAID = {
  // The three the reviewer leaves outstanding, one of which the agent answers.
  handled: "This lede counts nine and names three. Say nine or name nine.",
  otherComment: "Leaving people alone is a decision. Say who you left alone.",
  note: "The whole dashboard reads like a list. Give it one sentence at the top.",
  // The unfinished edit.
  typed: " Say which one you will text first."
};

// --- the agent's whole API ----------------------------------------------------

function replyPath(helper, filename) {
  return path.join(helper.stateDir, "reviews", REVIEW, filename);
}

function appendReply(helper, fields) {
  fs.appendFileSync(replyPath(helper, "replies-claude.jsonl"), JSON.stringify(fields) + "\n");
}

function reviewJson(helper) {
  const file = path.join(helper.stateDir, "reviews", REVIEW, "review.json");
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    return null;
  }
}

function projectedItems(projection) {
  if (!projection) return [];
  return projection.pages.reduce((out, page) => out.concat(page.items), []);
}

// --- the reviewer's gestures, all real ---------------------------------------

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

async function untetheredNote(page, text) {
  await page.evaluate(() => window.__lahe.handle.tab().focusNote());
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
      .sort()
      .join("\n");
  }, exceptIds || []);
}

function cardOf(page, id) {
  return page.evaluate((itemId) => {
    const card = window.__lahe.rail.getCard(itemId);
    if (!card) return null;
    return { state: card.state, pane: card.pane, notice: card.notice, agentMessage: card.agentMessage };
  }, id);
}

function textOf(page, selector) {
  return page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    return el ? el.textContent : null;
  }, selector);
}

test.describe("AC3: a human and an agent at the same time", () => {
  test("an agent answers one item while an unfinished edit is open, then the source under that edit moves and the collision is surfaced", async ({
    page
  }) => {
    const app = await startAppServer();
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [app.origin]
    });
    const token = helper.tokenFor(REVIEW);

    try {
      app.useLayer({ review: REVIEW, token: token, helper: helper.url });
      await page.goto(app.urlFor("/?morph=hooked&poll=250"));
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot from its script tag"
      });

      // The application's own timer off, so every morph in this walk is one
      // driven pass and the collision happens where the test says it does.
      await page.evaluate(() => window.__app.morph.stop());
      expect(await page.evaluate(() => window.__app.morph.polling)).toBe(false);

      // --- the reviewer's outstanding work ----------------------------------

      await commentOnSelection(page, "p.lede", SAID.handled);
      await commentOnSelection(page, "section.focus p:nth-of-type(2)", SAID.otherComment);
      await untetheredNote(page, SAID.note);

      const outstanding = await page.evaluate(() => window.__lahe.items());
      expect(outstanding, "three outstanding items before the edit is opened").toHaveLength(3);
      const handledItem = outstanding.filter((item) => item.note === SAID.handled)[0];
      expect(handledItem, "the item the agent will answer").toBeTruthy();
      expect(
        await page.evaluate(
          (id) => window.__lahe.handle.comments.highlights.paintedIds().indexOf(id) !== -1,
          handledItem.id
        ),
        "the item the agent will answer is painted on the page"
      ).toBe(true);

      // --- the unfinished edit, held open ------------------------------------

      await placeCaret(page, { selector: REGION_A, offset: 0 });
      await page.keyboard.press("ControlOrMeta+Shift+KeyE");
      await pollPage(page, () => window.__lahe.isEditing(), undefined, {
        message: "Cmd-Shift-E to put the feed note into edit state"
      });

      // Read after entering edit, which is after the block is protected: the
      // base cannot drift between the read and the typing.
      const base = await textOf(page, REGION_A);
      await placeCaret(page, { selector: REGION_A, offset: base.length });
      await page.keyboard.type(SAID.typed, { delay: 10 });
      const caret = await captureCaret(page);
      expect(await textOf(page, REGION_A)).toBe(base + SAID.typed);
      expect(await page.evaluate(() => window.__lahe.isEditing()), "the edit is still open").toBe(true);

      const othersBefore = await snapshot(page, [handledItem.id]);

      // --- the agent reads the file and answers one item ---------------------

      const projection = await pollUntil(
        () => {
          const got = reviewJson(helper);
          const item = projectedItems(got).filter((i) => i.id === handledItem.id)[0];
          return item ? item : null;
        },
        {
          message: "the item to reach review.json, which is the file the agent reads",
          describe: () => ({ items: projectedItems(reviewJson(helper)).length })
        }
      );
      expect(projection.note, "the agent reads the reviewer's own words").toBe(SAID.handled);
      expect(projection.state).toBe("ready");

      appendReply(helper, {
        item: handledItem.id,
        rev: projection.rev,
        status: "handled",
        agent: "claude",
        files: ["test/fixtures/app/pages.js"]
      });

      // THE PAGE UPDATES ITSELF: no reload, no navigation, no gesture. The
      // helper's reader folded the line and the poll loop brought it back.
      await pollPage(page, (id) => window.__lahe.itemById(id).state === "handled", handledItem.id, {
        message: "the folded reply to reach the card through the poll loop"
      });

      const handledCard = await cardOf(page, handledItem.id);
      expect(handledCard.state).toBe("handled");
      expect(handledCard.pane, "the handled item moved to Done").toBe("done");
      expect(handledCard.agentMessage.agent).toBe("claude");
      // The other half of this clause, "the handled item loses its highlight",
      // is the second test in this file. It does not hold, and it is scored RED
      // rather than quietly dropped here.

      // THE UNFINISHED EDIT AND ITS CARET SURVIVED.
      expect(await textOf(page, REGION_A), "the unfinished edit is untouched").toBe(base + SAID.typed);
      expect(await page.evaluate(() => window.__lahe.isEditing()), "and it is still open").toBe(true);
      const stillThere = await compareCaret(page, caret);
      expect(caretProblems(stillThere).join("; "), "the caret did not move").toBe("");

      // EVERY OTHER OUTSTANDING ITEM IS BYTE-IDENTICAL AND UNCHANGED IN STATE.
      expect(await snapshot(page, [handledItem.id])).toBe(othersBefore);

      // --- the source under the very region being edited moves ----------------
      //
      // The application re-renders its feed. The region the reviewer is inside
      // is protected, so the morph is told no about that one element and the
      // reviewer's text stays; the server's own wording for it has moved on.

      const skippedBefore = await page.evaluate(() => window.__app.counters.morphsSkipped);
      await page.evaluate(() => window.__app.morph.pollNow());
      await pollPage(page, (from) => window.__app.counters.morphsSkipped > from, skippedBefore, {
        message: "the morph to be told no about the element the reviewer is inside"
      });
      expect(await textOf(page, REGION_A), "the reviewer's text is still there, mid-edit").toBe(
        base + SAID.typed
      );

      // --- the commit ---------------------------------------------------------

      const countersBeforeCommit = await readCounters(page);
      await page.keyboard.press("Escape");
      await pollPage(page, () => window.__lahe.isEditing() === false, undefined, {
        message: "Esc to commit the edit and give the block back to the page"
      });

      const edit = await page.evaluate((sel) => window.__lahe.itemForElement(sel), REGION_A);
      expect(edit.kind).toBe("edit");
      expect(edit.before, "before is pinned to the application's wording at first touch").toBe(base);
      expect(edit.after).toBe(base + SAID.typed);

      // The state of every OTHER item, captured BEFORE the collision, so the
      // "nothing else moved" assertion at the end has something real to fail
      // against. Comparing the post-collision snapshot to a snapshot taken
      // microseconds later cannot fail no matter what the collision did (finding
      // 5). The handled item and the colliding edit are excluded because they DO
      // change; everything else must be byte-identical afterwards.
      const othersBeforeCollision = await snapshot(page, [handledItem.id, edit.id]);

      // Protection is off now, so the application's newer wording for this
      // region lands. Driven one pass at a time until the page really is
      // showing something that is neither version, which is the only state in
      // which branch four means anything.
      const theirs = await pollUntil(
        async () => {
          const live = await textOf(page, REGION_A);
          if (live !== base && live !== base + SAID.typed) return live;
          await page.evaluate(() => window.__app.morph.pollNow());
          return null;
        },
        {
          message: "the application to write its own newer wording into the region",
          describe: async () => ({
            live: await textOf(page, REGION_A),
            base: base,
            mine: base + SAID.typed
          })
        }
      );

      // THE COLLISION IS SURFACED, AND NOTHING IS SILENTLY OVERWRITTEN.
      //
      // WHICH TREATMENT IT GETS, AND WHY. 0C's application changes a feed
      // region's source by replacing the whole sentence: the new wording shares
      // nothing with the old. D9's first rule is that TEXT places a write and
      // nothing else does, so a region whose text is gone entirely does not
      // resolve, and replay reports the record as LOST rather than as changed
      // underneath. The reviewer is told, on the card, with their text intact
      // (AC5's treatment for an unplaceable record), and nothing is written in
      // either direction, which is AC3's fail line.
      //
      // The "flagged as changed underneath, both versions in full" treatment
      // needs the region to still be recognizable, which is a source change that
      // KEEPS the old wording and adds to it. That is exactly what ranked test 2
      // (test/browser/replay_human_and_agent.spec.js, "the page changes region A
      // while the reviewer is in it") and ranked test 34's neighbour
      // (test/browser/replay_branches.spec.js, "branch four: the page changed
      // underneath") drive, and both are green. This application cannot produce
      // that shape of change, so this walk scores the fail line rather than
      // re-scoring branch four badly.
      const badge = await pollUntil(
        async () => {
          const codes = await page.evaluate(
            (id) => (window.__lahe.rail.getCard(id).badges || []).map((b) => b.code),
            edit.id
          );
          return codes.length ? codes : null;
        },
        {
          message: "the card to say, on its face, that the record could not be placed",
          describe: async () => ({
            live: await textOf(page, REGION_A),
            lastPass: await page.evaluate(() => window.__lahe.lastPass()),
            counters: await readCounters(page)
          })
        }
      );
      // REPLAY_NEITHER_MATCHES is D7's collision code, and it is the more
      // truthful surface here: the region still exists (the record is still
      // bound to its element), its content just matches neither side. This
      // spec used to accept ANCHOR_LOST because a failed re-resolve used to
      // short-circuit the pass before the content comparison could run; the
      // still-bound rule (2026-08-18) carries the element through to the real
      // verdict instead.
      expect(badge, "the collision is surfaced on the card rather than swallowed").toContain(
        "REPLAY_NEITHER_MATCHES"
      );

      // NOTHING WAS OVERWRITTEN, IN EITHER DIRECTION.
      const kept = await page.evaluate((id) => window.__lahe.itemById(id), edit.id);
      expect(await textOf(page, REGION_A), "the page keeps its own text").toBe(theirs);
      expect(kept.after, "and the record keeps the reviewer's, in full").toBe(base + SAID.typed);
      expect(kept.state, "and it is still the reviewer's outstanding work").toBe("ready");

      const countersAfter = await readCounters(page);
      expect(
        countersAfter.regionsWritten - countersBeforeCommit.regionsWritten,
        "nothing was written over the application's new wording"
      ).toBe(0);
      // regionsBlockedChanged is the conflict counter (regionsConflicted under
      // its fixture-era name); regionsLost was the old accounting from when a
      // failed re-resolve short-circuited into markLost before the content
      // comparison could run. Same reasoning as the badge assertion above.
      expect(
        countersAfter.regionsBlockedChanged - countersBeforeCommit.regionsBlockedChanged,
        "and the collision was surfaced rather than swallowed"
      ).toBeGreaterThanOrEqual(1);

      // And the agent's answer, and everyone else's records, are where they
      // were. A collision on one card moves nothing else.
      expect((await cardOf(page, handledItem.id)).pane).toBe("done");
      const finalOthers = await snapshot(page, [handledItem.id, edit.id]);
      expect(finalOthers, "the untouched items never moved").toBe(othersBeforeCollision);
      expect(finalOthers.indexOf(SAID.otherComment)).toBeGreaterThan(-1);
      expect(finalOthers.indexOf(SAID.note)).toBeGreaterThan(-1);

      // The helper saw all of it: the reviewer's records and the agent's line.
      const folded = readEventLog(helper.stateDir, REVIEW).filter((e) => e.event === "reply.folded");
      expect(folded, "one reply line, folded once").toHaveLength(1);
      expect(folded[0].accepted).toBe(true);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });

  // ---------------------------------------------------------------------------
  // AC3's second half: the page, not the rail.
  // ---------------------------------------------------------------------------
  //
  // AC3 says "The handled item loses its highlight and moves to Done", and
  // tab_done.js's own header repeats it. It did not: the only call to
  // highlights.clear in the library was in comments.remove, which is the
  // reviewer deleting their own comment, so a handled item stayed painted for
  // the rest of the session and the page accumulated marks on finished
  // passages. This carried a test.fail() marker until 4B fixed it.
  //
  // The fix is a pair, both in 1D's comment surface because the paint is 1D's:
  // comments.unpaint(id) drops it when an item retires, comments.repaint(id)
  // puts it back on a reopen with the anchor resolved against the page as it is
  // NOW (the agent's change is usually what retired the item, so the old live
  // range is stale by construction). tab_done.js says when; it never paints.
  test("the handled item loses its highlight", async ({ page }) => {
    const app = await startAppServer();
    const helper = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW + "-highlight"],
      allowedOrigins: [app.origin]
    });
    const review = REVIEW + "-highlight";
    const token = helper.tokenFor(review);

    try {
      app.useLayer({ review: review, token: token, helper: helper.url });
      await page.goto(app.urlFor("/?morph=off"));
      await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
        message: "the layer to boot from its script tag"
      });

      await commentOnSelection(page, "p.lede", SAID.handled);
      const item = (await page.evaluate(() => window.__lahe.items()))[0];

      // The positive control: it really is painted before the agent answers.
      const painted = await page.evaluate(() => {
        var total = 0;
        CSS.highlights.forEach(function (h) {
          total += h.size;
        });
        return total;
      });
      expect(painted, "the comment is painted on the page to begin with").toBeGreaterThan(0);

      await pollUntil(
        () => {
          const file = path.join(helper.stateDir, "reviews", review, "review.json");
          if (!fs.existsSync(file)) return null;
          const got = JSON.parse(fs.readFileSync(file, "utf8"));
          return projectedItems(got).length ? got : null;
        },
        { message: "the item to reach the file the agent reads" }
      );

      fs.appendFileSync(
        path.join(helper.stateDir, "reviews", review, "replies-claude.jsonl"),
        JSON.stringify({ item: item.id, rev: item.rev, status: "handled", agent: "claude" }) + "\n"
      );

      await pollPage(page, (id) => window.__lahe.itemById(id).state === "handled", item.id, {
        message: "the item to retire into Done"
      });

      expect(
        await page.evaluate(
          (id) => window.__lahe.handle.comments.highlights.paintedIds().indexOf(id),
          item.id
        ),
        "a retired item is no longer painted"
      ).toBe(-1);

      // And the other half of R38: reopening it puts it back in front of the
      // agent AND back on the page. An item the reviewer can act on that carries
      // no mark is the same defect pointed the other way.
      await page.evaluate((id) => window.__lahe.handle.doneTab().reopen(id), item.id);
      await pollPage(page, (id) => window.__lahe.itemById(id).state === "ready", item.id, {
        message: "the item to reopen"
      });
      expect(
        await page.evaluate(
          (id) => window.__lahe.handle.comments.highlights.paintedIds().indexOf(id) !== -1,
          item.id
        ),
        "a reopened item is painted again"
      ).toBe(true);
    } finally {
      await helper.kill9();
      await app.close();
    }
  });
});
