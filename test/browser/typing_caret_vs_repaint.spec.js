// The reviewer's caret outlives a repaint that did not touch their block.
//
// The failure this exists to keep out, seen on CI on 2026-09-15 as cp2_walk
// line 248: the reviewer put their caret at the end of a paragraph, typed a
// sentence, and the whole sentence went in at the FRONT instead.
//
//   expected  "The two people to reach ... instead of an answer. Say which one
//              you'll text first, and say it here."
//   received  " Say which one you'll text first, and say it here.The two people
//              to reach ... instead of an answer."
//
// Nothing damaged the block. What happened is that layer three's restore ran
// while the snapshot's caret half was one beat out of date, decided the caret
// was in the wrong place, and moved it back to where the reviewer had been
// standing before.
//
// The two beats are a task and a microtask, which is why this is a race and not
// a bug you can see by reading:
//
//   the reviewer moves the caret          selection is live IMMEDIATELY
//   the browser announces it              selectionchange, a TASK
//   protect refreshes the snapshot        onSelectionMoved, on that task
//   a repaint lands anywhere on the page  MutationObserver, a MICROTASK
//   protect restores every snapshot       on that microtask
//
// A microtask queued after the caret moved runs BEFORE the task that announces
// it. So any mutation at all, anywhere in the document, arriving in that window
// reached the restore with a stale snapshot. On the CP2 walk the page polls and
// morphs four times a second and replay repaints the rail on top of that, so
// the window gets hit.
//
// The rule the fix states: the text is whole and the node survived, so nothing
// was damaged and there is nothing to put back. The caret the reviewer is
// actually using is the truth; the snapshot is what is out of date, and the
// snapshot takes the correction.
//
// INSTRUMENTATION. "The text ended up right" can pass for the wrong reason, so
// both tests read the counters and say which component did what: protect's
// `restores` (layer three putting a caret back) and replay's `regionsWritten`
// and `regionsSkippedProtected` (whether a pass wrote into the block under the
// caret, or correctly refused to). A pass that wrote here would be the other
// suspect for the same symptom, and these assertions tell the two apart.

"use strict";

const { test, expect, pollPage, placeCaret, startService, SERVICE_ENTRY } = require("../helpers");
const { startAppServer } = require("../fixtures/app/server");

const REVIEW = "caret-vs-repaint";

// The block the reviewer edits. It lives OUTSIDE the morph target, which is the
// point: the page's own activity is somewhere else entirely, and it still cost
// the reviewer their caret.
const REGION = "section.focus p:nth-of-type(1)";

const SAID = " Say which one you'll text first, and say it here.";

async function openApp(page, query) {
  const appServer = await startAppServer();
  const helper = await startService({
    entry: SERVICE_ENTRY,
    args: ["--port", "0"],
    reviews: [REVIEW],
    allowedOrigins: [appServer.origin]
  });
  const token = helper.tokenFor(REVIEW);
  appServer.useLayer({ review: REVIEW, token: token, helper: helper.url });
  await page.goto(appServer.urlFor(query));
  await pollPage(page, () => !!(window.__lahe && window.__lahe.booted), undefined, {
    message: "the layer to boot from its script tag"
  });
  return helper;
}

async function enterEdit(page) {
  await placeCaret(page, { selector: REGION, offset: 0 });
  await page.keyboard.press("ControlOrMeta+Shift+KeyE");
  await pollPage(page, () => window.__lahe.isEditing(), undefined, {
    message: "Cmd-Shift-E to put the block under the caret into edit state"
  });
}

/** The counters this spec reasons about, in one read. */
function counters(page) {
  return page.evaluate(() => ({
    restores: window.__lahe.counters.restores,
    restoreFailures: window.__lahe.counters.restoreFailures,
    replayPasses: window.__lahe.counters.replayPasses,
    regionsWritten: window.__lahe.counters.regionsWritten,
    regionsSkippedProtected: window.__lahe.counters.regionsSkippedProtected
  }));
}

test.describe("the reviewer's caret outlives a repaint of someone else's block", () => {
  test("a mutation arriving before selectionchange does not move the caret", async ({ page }) => {
    // The poll is off. This test makes the race happen on purpose rather than
    // waiting for it, so the only mutation in it is the one it fires itself.
    const helper = await openApp(page, "/?morph=raw&poll=0");

    try {
      await enterEdit(page);
      const before = await counters(page);

      // ONE TASK, in this order, which is the race exactly:
      //   the caret moves to the end of the block
      //   a repaint lands somewhere else in the document
      //   the MutationObserver microtask runs, and with it layer three's restore
      //   only THEN does the browser get around to firing selectionchange
      const seen = await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        const length = el.textContent.length;
        const node = el.firstChild;
        const range = document.createRange();
        range.setStart(node, node.textContent.length);
        range.collapse(true);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);

        // The page's own activity, in a region the reviewer is not in.
        document.getElementById("feed").appendChild(document.createElement("span"));

        return new Promise((resolve) => {
          queueMicrotask(() => {
            const live = window.getSelection().getRangeAt(0);
            resolve({ length: length, offset: live.startOffset });
          });
        });
      }, REGION);

      expect(seen.offset, "the caret is still where the reviewer put it").toBe(seen.length);

      const after = await counters(page);
      // The instrumentation: not "the caret is right by luck", but "layer three
      // looked at an undamaged block and wrote nothing".
      expect(after.restores, "no restore ran: nothing was damaged").toBe(before.restores);
      expect(after.restoreFailures, "and none failed either").toBe(before.restoreFailures);

      // And the sentence goes where they aimed it.
      await page.keyboard.type(SAID, { delay: 5 });
      const text = await page.evaluate((sel) => document.querySelector(sel).textContent, REGION);
      expect(text.endsWith(SAID), "the typed sentence landed at the caret, not at the front").toBe(true);
    } finally {
      await helper.kill9();
    }
  });

  test("typing through a live morph: the sentence lands at the caret and no pass wrote the block", async ({
    page
  }) => {
    // The raw flavor at four morphs a second, which is the walk's own setting.
    const helper = await openApp(page, "/?morph=raw&poll=250");

    try {
      await enterEdit(page);
      const before = await counters(page);

      // The reviewer clicks to the end and types, with the page repainting
      // underneath them the whole time.
      const length = await page.evaluate((sel) => document.querySelector(sel).textContent.length, REGION);
      await placeCaret(page, { selector: REGION, offset: length });
      await page.keyboard.type(SAID, { delay: 20 });

      // The positive control: the page really did repaint and replay really did
      // run while the reviewer's hands were on the keyboard.
      const after = await counters(page);
      expect(await page.evaluate(() => window.__app.counters.morphPasses)).toBeGreaterThan(0);
      expect(after.replayPasses, "replay ran under the reviewer's hands").toBeGreaterThan(before.replayPasses);

      const text = await page.evaluate((sel) => document.querySelector(sel).textContent, REGION);
      expect(text, "the source sentence first, the reviewer's after it").toBe(
        text.slice(0, text.length - SAID.length) + SAID
      );
      expect(text.endsWith(SAID)).toBe(true);
      expect(text.startsWith(SAID), "and not the other way around, which is the flake").toBe(false);

      // Which pass wrote what. Two components could have produced the reversed
      // sentence, and the counters say neither of them touched the block:
      //
      //   replay, by re-applying a record into the block under the caret. It did
      //   not write at all: an open edit is a draft, and a draft is not
      //   outstanding, so every pass passed over it.
      //
      //   protect's layer three, by putting the caret back from the snapshot.
      //   This block is outside the morph target, so nothing damaged it and no
      //   restore should have run. That counter staying still IS the fix: before
      //   it, an undamaged block with a live caret still got restored.
      expect(after.regionsWritten, "no replay pass wrote while the reviewer was typing").toBe(
        before.regionsWritten
      );
      expect(after.restores, "layer three put no caret back: nothing was damaged").toBe(before.restores);
      expect(after.restoreFailures, "and nothing failed trying").toBe(before.restoreFailures);
    } finally {
      await helper.kill9();
    }
  });
});
