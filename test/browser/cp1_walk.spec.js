// CP1: the first stitch-back, as a script.
//
// Ranked test 37. The four Phase 1 branches (1A's helper, 1B's rail and sync,
// 1C's anchor engine, 1D's comment surface) are one library here, on a page
// that loads the built bundle with one script tag, talking to the real helper
// over the real wire with a token the helper minted.
//
// It is a checked-in spec rather than a hand walk on purpose: a one-shot manual
// act does not re-run, and a Phase 2 or Phase 3 merge that breaks this property
// would otherwise go unnoticed until Phase 4. This file runs at every later
// checkpoint.
//
// The walk, exactly as the plan states it:
//
//   the library is added to the built-doc fixture using the REAL mint path
//   (the helper creates the review and mints its token), the helper is started,
//   the reviewer leaves three comments and one untethered note through real
//   gestures, the helper is killed with kill -9, a fourth comment is left, the
//   helper is restarted, and all five are in events.jsonl exactly once with the
//   reviewer's text byte-identical.
//
// Plus the step that moves a seam a whole phase earlier: with a comment placed,
// the live DOM is mutated around the anchored region and resolve still returns
// the unique match; then the region is deleted and the failure is the honest
// one. Until now 1C has only ever been judged against a pure corpus.
//
// Every gesture below is the reviewer's: a selection and Cmd-Shift-C, a hover
// and a click in element-pick mode, a mouse click into the note box at the foot
// of the rail (found by asking the library where it is, because the rail is in
// a CLOSED shadow root that no selector can reach into), and typing. Nothing is
// minted by calling an API that the reviewer's hands would not have reached.

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
  SERVICE_ENTRY
} = require("../helpers");

const REPO_ROOT = path.join(__dirname, "..", "..");
const REVIEW = "cp1-review";
const FIXTURE = "test/fixtures/cp1-doc.html";

// The helper's default port is fixed (7817) because a reviewed page has it
// baked into its script tag. Tests run in parallel, so they ask for an
// ephemeral one and read the real port back out of service.json.
const EPHEMERAL_PORT = ["--port", "0"];

// The reviewer's own words. They carry the punctuation R3 names: a comma that
// must not come back as an em dash, a straight apostrophe, and a pair of
// straight double quotes. Every one of these is asserted byte for byte.
const SAID = {
  intro: 'This promises "short", then spends a paragraph on tradeoffs.',
  outro: "Don't end on an invitation to argue, end on the next step.",
  caption: "The caption says weekly mileage, the chart says something else.",
  note: "The whole brief reads colder than the coach it is written for.",
  afterTheCrash: "This heading is the one thing a skimmer reads, so say the plan."
};

function fixtureUrl(server, helper, token) {
  const query = new URLSearchParams({ review: REVIEW });
  if (helper) query.set("helper", helper);
  if (token) query.set("token", token);
  return server.urlFor(FIXTURE) + "?" + query.toString();
}

// A drag over one block, the way a reviewer selects a passage.
async function selectElementText(page, selector) {
  await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }, selector);
}

// Cmd-Shift-C on a selected passage, then the reviewer's words, then Cmd-Enter.
async function commentOnSelection(page, selector, text) {
  await selectElementText(page, selector);
  await page.keyboard.press("ControlOrMeta+Shift+KeyC");
  await pollPage(page, () => !!window.__laheCp1.focusedBoxQuote(), undefined, {
    message: "the comment box to open already focused on the passage"
  });
  await page.keyboard.type(text);
  await page.keyboard.press("ControlOrMeta+Enter");
}

/** The events one item produced, oldest first. */
function eventsForItem(log, itemId) {
  return log.filter((event) => event.item === itemId);
}

/** Every item id the log carries a record for. */
function itemIdsIn(log) {
  const out = [];
  log.forEach((event) => {
    if (event.record && out.indexOf(event.item) === -1) out.push(event.item);
  });
  return out;
}

test.describe("CP1: the four branches as one library", () => {
  let pages;

  test.beforeAll(async () => {
    pages = await startStaticServer({ root: REPO_ROOT, label: "cp1" });
  });

  test.afterAll(async () => {
    await pages.close();
  });

  test("five records survive a kill -9, byte-identical, each in events.jsonl exactly once", async ({ page }) => {
    // THE REAL MINT PATH. The helper creates the review and mints its token
    // (1A's reviews.create), writes both into service.json after the listener
    // is bound, and the page is handed the token it minted. Nothing here
    // invents a credential.
    const first = await startService({
      entry: SERVICE_ENTRY,
      args: EPHEMERAL_PORT,
      reviews: [REVIEW],
      allowedOrigins: [pages.origin]
    });
    const port = first.port;
    const token = first.tokenFor(REVIEW);
    const stateDir = first.stateDir;
    let second = null;

    expect(token, "the helper minted a per-review token").toBeTruthy();

    try {
      await page.goto(fixtureUrl(pages, first.url, token));
      await page.evaluate(() => window.__laheCp1.startSync());

      // ONE host on the page, and its id is the marker module's. Two hosts
      // would mean two closed roots and a remount that re-creates one of them,
      // which is undiagnosable from outside a closed root.
      expect(await page.evaluate(() => window.__laheCp1.hostCount())).toBe(1);
      expect(await page.evaluate(() => window.__laheCp1.hostId())).toBe("lahe-surface-root");

      // --- three comments ----------------------------------------------------

      await commentOnSelection(page, "#intro", SAID.intro);
      await commentOnSelection(page, "#outro", SAID.outro);

      // The third is an element pick: Cmd-Shift-C with nothing selected, hover
      // to outline, click to comment on the whole thing.
      await page.evaluate(() => window.getSelection().removeAllRanges());
      await page.keyboard.press("ControlOrMeta+Shift+KeyC");
      expect(await page.evaluate(() => window.__laheCp1.pickMode())).toBe(true);
      const caption = await page.locator("#photo-caption").boundingBox();
      await page.mouse.move(caption.x + caption.width / 2, caption.y + caption.height / 2);
      await pollPage(page, () => window.__laheCp1.outlining() === "photo-caption", undefined, {
        message: "the hovered element to be outlined"
      });
      await page.mouse.click(caption.x + caption.width / 2, caption.y + caption.height / 2);
      await page.keyboard.type(SAID.caption);
      await page.keyboard.press("ControlOrMeta+Enter");

      // --- the untethered note, clicked into like a reviewer would ------------

      const noteBox = await page.evaluate(() => window.__laheCp1.noteBoxRect());
      expect(noteBox, "the note box is at the foot of the rail's Active tab").toBeTruthy();
      await page.mouse.click(noteBox.cx, noteBox.cy);
      await page.keyboard.type(SAID.note);
      await page.keyboard.press("ControlOrMeta+Enter");

      const beforeTheCrash = await page.evaluate(() => window.__laheCp1.items());
      expect(beforeTheCrash.map((item) => item.kind).sort()).toEqual(["comment", "comment", "comment", "note"]);
      expect(beforeTheCrash.every((item) => item.state === "ready")).toBe(true);

      await pollPage(page, () => window.__laheCp1.pending() === 0, undefined, {
        message: "the four records to be acknowledged by the helper"
      });

      // --- kill -9 -----------------------------------------------------------

      await first.kill9();

      // The reviewer keeps working against a helper that is gone.
      await commentOnSelection(page, "#heading-plan", SAID.afterTheCrash);

      const whileDown = await page.evaluate(() => ({
        items: window.__laheCp1.items().length,
        pending: window.__laheCp1.pending()
      }));
      expect(whileDown.items, "the fifth record exists with no helper to take it").toBe(5);
      expect(whileDown.pending, "and its backlog is queued in browser storage").toBeGreaterThan(0);

      await pollPage(page, () => window.__laheCp1.status() === "kept_locally", undefined, {
        timeoutMs: 20000,
        message: "the status line to say the typing is kept in this browser"
      });

      // --- the helper comes back on the same port and state directory --------

      second = await startService({
        entry: SERVICE_ENTRY,
        stateDir: stateDir,
        reviews: [REVIEW],
        allowedOrigins: [pages.origin],
        env: { LAHE_PORT: String(port) }
      });
      expect(second.tokenFor(REVIEW), "the token survived the restart").toBe(token);

      await pollPage(page, () => window.__laheCp1.pending() === 0, undefined, {
        timeoutMs: 30000,
        message: "the backlog to drain into the restarted helper"
      });

      // --- all five, exactly once, byte-identical ----------------------------

      const log = await pollUntil(
        () => {
          const lines = readEventLog(stateDir, REVIEW);
          return itemIdsIn(lines).length === 5 ? lines : null;
        },
        { message: "all five records to reach events.jsonl" }
      );

      const eventIds = log.map((event) => event.event_id);
      expect(new Set(eventIds).size, "every event is on disk exactly once").toBe(eventIds.length);

      const seqs = log.map((event) => event.seq);
      expect(seqs, "the helper's own seq is monotonic across the restart").toEqual(
        seqs.slice().sort((a, b) => a - b)
      );

      const itemIds = itemIdsIn(log);
      expect(itemIds, "five records, no more and no fewer").toHaveLength(5);

      const finalNotes = itemIds.map((id) => {
        const events = eventsForItem(log, id);
        return events[events.length - 1].record.note;
      });

      Object.keys(SAID).forEach((which) => {
        const said = SAID[which];
        const matches = finalNotes.filter((note) => note === said);
        expect(matches, "the " + which + " record is in the log exactly once").toHaveLength(1);
        // Byte for byte, not merely equal-looking: R3's named failure is a
        // comma that came back as an em dash.
        expect(Buffer.compare(Buffer.from(matches[0], "utf8"), Buffer.from(said, "utf8"))).toBe(0);
      });

      // Every one of the five reached the helper as ready, which is what makes
      // it actionable (R7).
      itemIds.forEach((id) => {
        const events = eventsForItem(log, id);
        expect(events[events.length - 1].record.state, "record " + id + " is ready on disk").toBe("ready");
      });

      // The fifth was typed while the helper was dead, and it is on disk with
      // the same standing as the four typed while it was up.
      const afterTheCrash = log.filter(
        (event) => event.record && event.record.note === SAID.afterTheCrash
      );
      expect(afterTheCrash.length, "the record made against a dead helper landed").toBeGreaterThan(0);
    } finally {
      if (second) await second.kill9();
      if (first.alive()) await first.kill9();
    }
  });

  // ---------------------------------------------------------------------------
  // The anchor step
  // ---------------------------------------------------------------------------
  //
  // 1C's engine has only ever been judged against a pure corpus and against a
  // static page. This is the first time its real DOM search meets a page that
  // changed after the reference was minted, which is what replay will do to it
  // in 2C. A whitespace or context-widening disagreement found here is an
  // anchor bug; found in 2C it would be diagnosed as a replay bug.

  test("the anchor survives the page changing around it, and fails honestly when the region is gone", async ({
    page
  }) => {
    // No helper: the anchor question is about the page, and a record kept in
    // browser storage is a complete record (R6).
    await page.goto(fixtureUrl(pages));

    await commentOnSelection(page, "#intro", SAID.intro);

    const id = (await page.evaluate(() => window.__laheCp1.items()))[0].id;
    const minted = await page.evaluate((itemId) => window.__laheCp1.resolveRegion(itemId), id);
    expect(minted.bound, "the reference binds the moment it is minted").toBe(true);
    expect(minted.matchesElementId).toBe("intro");

    // The page changes AROUND the region: a paragraph arrives above it, the
    // region gets wrapped in a div it did not have, and a neighbour's
    // whitespace is rewritten. None of that is the region changing.
    await page.evaluate(() => {
      const intro = document.getElementById("intro");

      const arrival = document.createElement("p");
      arrival.id = "late-arrival";
      arrival.textContent = "Added after the reference was minted, above the region.";
      intro.parentNode.insertBefore(arrival, intro);

      const wrapper = document.createElement("div");
      wrapper.id = "late-wrapper";
      intro.parentNode.insertBefore(wrapper, intro);
      wrapper.appendChild(intro);

      const neighbour = document.getElementById("problem-a");
      neighbour.innerHTML = neighbour.innerHTML.replace(/\s+/g, "\n      ");
    });

    const afterMutation = await page.evaluate((itemId) => window.__laheCp1.resolveRegion(itemId), id);
    expect(afterMutation.bound, "the same region is still the unique match").toBe(true);
    expect(afterMutation.matchesElementId, "and it is the SAME node, not a lookalike").toBe("intro");

    // Now the region itself is gone. The honest answer is a named failure and a
    // null element: never a different node, and never a quiet success.
    await page.evaluate(() => {
      const intro = document.getElementById("intro");
      intro.parentNode.removeChild(intro);
    });

    const afterDeletion = await page.evaluate((itemId) => window.__laheCp1.resolveRegion(itemId), id);
    expect(afterDeletion.bound, "a deleted region binds to nothing").toBe(false);
    expect(afterDeletion.matchesElementId, "and it never lands on some other node").toBe(null);
    expect(afterDeletion.failureCode, "the failure is named").toBe("ANCHOR_NO_TEXT_MATCH");

    // The record is untouched by any of this: losing a place never loses the
    // reviewer's words.
    const item = await page.evaluate((itemId) => window.__laheCp1.itemById(itemId), id);
    expect(item.note).toBe(SAID.intro);
  });

  // ---------------------------------------------------------------------------
  // The seam this checkpoint closed
  // ---------------------------------------------------------------------------

  test("the Active tab lives in the rail, and a card holding focus is never re-created", async ({ page }) => {
    await page.goto(fixtureUrl(pages));

    await commentOnSelection(page, "#intro", SAID.intro);
    const id = (await page.evaluate(() => window.__laheCp1.items()))[0].id;

    // The tab's rows are inside the rail's own cards, so the rail has a node to
    // hold and holdsFocus can be true for a tab's contents at all.
    const reword = await page.evaluate((itemId) => window.__laheCp1.rewordButtonRect(itemId), id);
    expect(reword, "the row is inside the card, in the rail's Active tab").toBeTruthy();

    await page.mouse.click(reword.cx, reword.cy);
    await pollPage(page, () => window.__laheCp1.focusedCardId() !== null, undefined, {
      message: "the reworded card to hold focus"
    });
    expect(await page.evaluate((itemId) => window.__laheCp1.holdsFocus(itemId), id)).toBe(true);

    // The card node the reviewer is typing into survives the rail being told
    // about the item over and over, which is what every keystroke does.
    await page.evaluate((itemId) => {
      window.__laheCp1.rememberCardNode(itemId);
    }, id);
    await page.keyboard.type(" And name the week it starts.");

    const after = await page.evaluate(
      (itemId) => ({
        same: window.__laheCp1.cardNodeIsRemembered(itemId),
        holds: window.__laheCp1.holdsFocus(itemId),
        note: window.__laheCp1.itemById(itemId).note
      }),
      id
    );
    expect(after.same, "the card was updated in place, never re-created").toBe(true);
    expect(after.holds, "and it still holds the reviewer's cursor").toBe(true);
    expect(after.note).toBe(SAID.intro + " And name the week it starts.");
  });
});
