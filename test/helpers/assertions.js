// The two hardest assertions in the project, written once.
//
// These are here rather than inline in a test because if either is subtly wrong,
// every test that leans on it is theatre. Each one has a self-test in
// test/browser/harness_selftest.spec.js, and each self-test has a NEGATIVE half
// that switches the behavior off and asserts the assertion throws. Do not delete
// the negative halves.
//
//   assertCaretSurvivesTyping         ranked test 1, protection layers one and two
//   assertCaretRestoredAcrossRepaints ranked test 1, protection layer THREE
//   assertNoSecondWrite               ranked test 13
//
// WHY THERE ARE TWO CARET ASSERTIONS. 2B ships three protection layers: the
// cooperative-skip attribute, the pre-morph veto, and a selection snapshot with
// a restore. The first two keep the reviewer's text node alive, so node identity
// is the right bar and assertCaretSurvivesTyping is it. The third cannot: it
// restores text after the repaint destroyed the node it lived in, so the caret
// is in a NEW node by construction and the node-identity assertion would fail
// for every correct implementation of it. Running the wrong one there produces a
// failure no correct code can fix, and the likely outcome is that the project's
// best assertion gets quietly weakened for every other test too. So layer three
// gets its own, and the node-identity one is not touched.

"use strict";

const { placeCaret, captureCaret, compareCaret, caretProblems } = require("./caret");
const { readCounters } = require("./counters");
const { waitForCounter } = require("./counters");
const { pollPage } = require("./poll");
const { startRepaints, stopRepaints, forceRepaint } = require("./repaint");
const { observeMutations, formatRecords } = require("./mutations");

/**
 * Type into the middle of a paragraph while the page repaints under it, and
 * assert the paragraph ends up reading exactly as before with the typed
 * characters inserted contiguously at the original offset.
 *
 * The four things it asserts, and why each is load-bearing:
 *
 *   1. The final text is exactly before.slice(0, k) + typed + before.slice(k).
 *      Exactly, not normalized. A repaint that collapsed the reviewer's spacing
 *      is a failure, and normalizing here would hide it.
 *   2. The caret is in the SAME text node, compared by identity. A turbo-frame
 *      repaint builds a fresh node holding the same characters at the same path,
 *      so an id or path comparison passes while the caret is dead.
 *   3. The caret's offset advanced by exactly the number of characters typed.
 *      This catches the react-text repaint, which keeps the node alive and wipes
 *      its contents; node identity alone would pass.
 *   4. The replay pass counter went up by at least `minReplayPasses`. Without
 *      this, an implementation that does nothing at all passes: no replay, no
 *      repaint, no damage, perfect text.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{selector: string, text?: string, caretOffset?: number|null,
 *          keystrokeDelayMs?: number, repaintIntervalMs?: number,
 *          minReplayPasses?: number, timeoutMs?: number}} options
 * @returns {Promise<{expected: string, actual: string, offset: number,
 *                    replayPasses: number, repaints: number}>}
 */
async function assertCaretSurvivesTyping(page, options) {
  const selector = options.selector;
  const text = options.text ?? "0123456789";
  const keystrokeDelayMs = options.keystrokeDelayMs ?? 50;
  const repaintIntervalMs = options.repaintIntervalMs ?? 200;
  const minReplayPasses = options.minReplayPasses ?? 5;
  const timeoutMs = options.timeoutMs ?? 20000;

  const original = await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("assertCaretSurvivesTyping: no element matches " + sel);
    return el.textContent;
  }, selector);

  const offset =
    options.caretOffset === undefined || options.caretOffset === null
      ? Math.floor(original.length / 2)
      : options.caretOffset;
  const expected = original.slice(0, offset) + text + original.slice(offset);

  await placeCaret(page, { selector: selector, offset: offset });
  const caret = await captureCaret(page);
  const before = await readCounters(page);

  await startRepaints(page, repaintIntervalMs);
  try {
    await page.keyboard.type(text, { delay: keystrokeDelayMs });
    await waitForCounter(page, "replayPasses", (before.replayPasses ?? 0) + minReplayPasses, {
      timeoutMs: timeoutMs
    });
  } finally {
    await stopRepaints(page);
  }

  const after = await readCounters(page);
  const actual = await page.evaluate(function (sel) {
    return document.querySelector(sel).textContent;
  }, selector);
  const caretReport = await compareCaret(page, caret, { expectedOffsetDelta: text.length });

  const problems = [];
  if (actual !== expected) {
    problems.push(
      "the paragraph does not read as expected.\n" +
        "      expected: " +
        JSON.stringify(expected) +
        "\n      actual:   " +
        JSON.stringify(actual)
    );
  }
  caretProblems(caretReport).forEach(function (problem) {
    problems.push("caret: " + problem);
  });
  const passes = (after.replayPasses ?? 0) - (before.replayPasses ?? 0);
  if (passes < minReplayPasses) {
    problems.push(
      "the replay pass counter only went up by " +
        passes +
        ", wanted at least " +
        minReplayPasses +
        ". An implementation that never runs replay cannot be allowed to pass this test by doing nothing."
    );
  }

  if (problems.length > 0) {
    throw new Error(
      "assertCaretSurvivesTyping failed:\n  - " +
        problems.join("\n  - ") +
        "\nCounters before: " +
        JSON.stringify(before) +
        "\nCounters after:  " +
        JSON.stringify(after)
    );
  }

  return {
    expected: expected,
    actual: actual,
    offset: offset,
    replayPasses: passes,
    repaints: (after.repaints ?? 0) - (before.repaints ?? 0)
  };
}

/**
 * Assert an action produced NO write to a subtree, observed through a
 * MutationObserver rather than by comparing the final DOM.
 *
 * This is idempotence stated the only way that catches the bug. Final DOM
 * equality passes when replay rewrites a region with byte-identical text on
 * every pass, and that rewrite destroys the caret every time. The difference
 * between "did nothing" and "did the same thing twice" is a mutation record.
 *
 * The failure message deliberately reports whether the final text was unchanged,
 * because that is the sentence that explains why the weaker assertion would have
 * passed.
 *
 * `minReplayPasses` is REQUIRED, and the assertion throws when it is missing.
 * The absence of a write proves idempotence only if replay actually ran: a
 * paused engine, a replay scheduler that never fired, an action that quietly did
 * nothing, all write nothing and all pass an assertion that only watches the
 * DOM. Until now the counter check lived in one hand-written line in one
 * self-test, which made it a matter of builder discipline. It is the helper's
 * job, so it is here, and there is no default: a default is a number a builder
 * never has to think about, and the right number depends on what the action did.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{selector: string, action: () => Promise<any>, minReplayPasses: number,
 *          options?: MutationObserverInit, allow?: (record: object) => boolean,
 *          message?: string}} config
 *   `allow` filters out records a test knowingly expects (a status chip
 *   updating, say). Use it sparingly; every allowed record is a hole.
 * @returns {Promise<{records: object[], result: any, textUnchanged: boolean,
 *                    replayPasses: number}>}
 */
async function assertNoSecondWrite(page, config) {
  const selector = config.selector;
  const minReplayPasses = config.minReplayPasses;

  if (typeof minReplayPasses !== "number" || !Number.isFinite(minReplayPasses) || minReplayPasses < 1) {
    throw new Error(
      "assertNoSecondWrite: minReplayPasses is required and must be at least 1, got " +
        JSON.stringify(minReplayPasses) +
        ".\nThe absence of a write only proves idempotence if replay ran. A paused replay engine, " +
        "a scheduler that never fired, or an action that did nothing all write nothing and would " +
        "otherwise pass this assertion. Pass the number of passes the action should have caused."
    );
  }

  const observer = await observeMutations(page, {
    selector: selector,
    options: config.options
  });

  const countersBefore = await readCounters(page);
  const textBefore = await page.evaluate(function (sel) {
    return document.querySelector(sel).textContent;
  }, selector);

  const result = await config.action();

  const countersAfter = await readCounters(page);
  const passes = (countersAfter.replayPasses ?? 0) - (countersBefore.replayPasses ?? 0);

  const all = await observer.stop();
  const records = typeof config.allow === "function" ? all.filter(function (record) {
    return !config.allow(record);
  }) : all;

  const textAfter = await page.evaluate(function (sel) {
    return document.querySelector(sel).textContent;
  }, selector);
  const textUnchanged = textBefore === textAfter;

  if (records.length > 0) {
    throw new Error(
      "assertNoSecondWrite failed" +
        (config.message ? " (" + config.message + ")" : "") +
        ": " +
        records.length +
        " mutation record(s) landed on " +
        selector +
        " during an action that should have written nothing.\n" +
        (textUnchanged
          ? "The subtree's final text is UNCHANGED, so an assertion written as final-DOM equality " +
            "would have passed here. It rewrote the same content, which destroys the caret every pass. " +
            "That is the bug this assertion exists to catch.\n"
          : "The subtree's text also changed, so this is a plain unwanted write.\n") +
        formatRecords(records)
    );
  }

  if (passes < minReplayPasses) {
    throw new Error(
      "assertNoSecondWrite failed" +
        (config.message ? " (" + config.message + ")" : "") +
        ": nothing was written to " +
        selector +
        ", but the replay pass counter only went up by " +
        passes +
        " and the test asked for at least " +
        minReplayPasses +
        ".\nAn engine that never ran writes nothing and looks perfectly idempotent. " +
        "This assertion is about replay running and choosing not to write, which is a different " +
        "thing from replay not running.\nCounters before: " +
        JSON.stringify(countersBefore) +
        "\nCounters after:  " +
        JSON.stringify(countersAfter)
    );
  }

  return {
    records: records,
    result: result,
    textUnchanged: textUnchanged,
    replayPasses: passes
  };
}

/**
 * PROTECTION LAYER THREE. Type into a region, repaint the page under it
 * repeatedly with nothing cooperating, and assert the snapshot-and-restore layer
 * put the reviewer's work back every time.
 *
 * Four things, and each is here because the obvious three would pass something
 * broken:
 *
 *   1. The region reads EXACTLY the original text with the typed characters
 *      inserted at the caret's offset. Checked after every single repaint, not
 *      only at the end, because "no characters were lost" is a claim about the
 *      whole run: a restore that drops a character and a later keystroke that
 *      happens to put one back leaves a correct-looking final string.
 *   2. The caret is at the same CHARACTER OFFSET inside the region, in whatever
 *      node now holds those characters. Not the same node: layer three restores
 *      after the node died, so a new node is the correct outcome and node
 *      identity is unachievable here by construction.
 *   3. The caret's node is connected and inside the region. A caret restored
 *      into a detached node reads correctly and is dead.
 *   4. The restore counter went up. Without it, a page where nothing ever
 *      damaged the region passes with a perfect score, which is the same
 *      do-nothing hole the replay counter closes on the other assertion.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{selector: string, text?: string, caretOffset?: number|null,
 *          restoreCounter?: string, minRestores?: number,
 *          trailingRepaints?: number, repaintTimeoutMs?: number,
 *          keystrokeDelayMs?: number}} options
 *   One repaint is forced after every keystroke, so the run is deterministic
 *   with no interval and no sleep. `trailingRepaints` adds more after the last
 *   character. `minRestores` defaults to 1: the assertion insists a restore
 *   happened, and a test that knows how many should have happened says so.
 * @returns {Promise<{expected: string, actual: string, offset: number,
 *                    repaints: number, restores: number}>}
 */
async function assertCaretRestoredAcrossRepaints(page, options) {
  const selector = options.selector;
  const text = options.text ?? "0123456789";
  const restoreCounter = options.restoreCounter ?? "caretRestores";
  const minRestores = options.minRestores ?? 1;
  const trailingRepaints = options.trailingRepaints ?? 2;
  const repaintTimeoutMs = options.repaintTimeoutMs ?? 4000;
  const keystrokeDelayMs = options.keystrokeDelayMs ?? 20;

  const original = await page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("assertCaretRestoredAcrossRepaints: no element matches " + sel);
    return el.textContent;
  }, selector);

  const offset =
    options.caretOffset === undefined || options.caretOffset === null
      ? Math.floor(original.length / 2)
      : options.caretOffset;

  await placeCaret(page, { selector: selector, offset: offset });
  const before = await readCounters(page);

  const characters = Array.from(text);
  const problems = [];
  const timeline = [];
  let typed = "";
  let repaints = 0;

  async function repaintAndCheck(expected, label) {
    await forceRepaint(page);
    repaints += 1;
    // A condition poll, not a wait: the restore runs from a MutationObserver, so
    // it lands a microtask after the repaint rather than inside it. If it never
    // lands, this is where the failure is caught and named.
    let restored = true;
    try {
      await pollPage(
        page,
        function (args) {
          const el = document.querySelector(args[0]);
          return !!el && el.textContent === args[1];
        },
        [selector, expected],
        { timeoutMs: repaintTimeoutMs, message: "the region to read as it did before the repaint" }
      );
    } catch (err) {
      restored = false;
    }

    const state = await readRegionCaret(page, selector);
    timeline.push({ at: label, restored: restored, text: state.text, caret: state.caretOffset });

    if (!restored) {
      problems.push(
        label +
          ": the region did not come back. Characters were lost and nothing put them back.\n" +
          "      expected: " +
          JSON.stringify(expected) +
          "\n      actual:   " +
          JSON.stringify(state.text)
      );
      return;
    }
    const wantedCaret = offset + typed.length;
    if (state.caretOffset !== wantedCaret) {
      problems.push(
        label +
          ": the caret is " +
          state.caretOffset +
          " characters into the region, expected " +
          wantedCaret +
          ". The text came back and the caret did not come back with it, so the next " +
          "keystroke lands somewhere the reviewer did not choose."
      );
    }
    if (!state.caretInRegion) {
      problems.push(
        label +
          ": the caret is not inside the region at all (" +
          (state.caretConnected ? "it is elsewhere in the document" : "its node is detached") +
          "). A caret restored into a node that is not in the page reads correctly and is dead."
      );
    }
  }

  for (let i = 0; i < characters.length; i += 1) {
    await page.keyboard.type(characters[i], { delay: keystrokeDelayMs });
    typed += characters[i];
    await repaintAndCheck(
      original.slice(0, offset) + typed + original.slice(offset),
      "after keystroke " + (i + 1) + " of " + characters.length
    );
  }

  const expected = original.slice(0, offset) + text + original.slice(offset);
  for (let i = 0; i < trailingRepaints; i += 1) {
    await repaintAndCheck(expected, "after trailing repaint " + (i + 1) + " of " + trailingRepaints);
  }

  const after = await readCounters(page);
  const restores = (after[restoreCounter] ?? 0) - (before[restoreCounter] ?? 0);
  const actual = await page.evaluate(function (sel) {
    return document.querySelector(sel).textContent;
  }, selector);

  if (actual !== expected) {
    problems.push(
      "the region does not read as expected at the end of the run.\n" +
        "      expected: " +
        JSON.stringify(expected) +
        "\n      actual:   " +
        JSON.stringify(actual)
    );
  }
  if (restores < minRestores) {
    problems.push(
      "the '" +
        restoreCounter +
        "' counter went up by " +
        restores +
        ", wanted at least " +
        minRestores +
        ". Text that survived because nothing ever damaged it is not layer three working, and " +
        "this assertion is only meaningful on a page that really did destroy the region."
    );
  }

  if (problems.length > 0) {
    throw new Error(
      "assertCaretRestoredAcrossRepaints failed:\n  - " +
        problems.join("\n  - ") +
        "\nRepaints: " +
        repaints +
        ", restores: " +
        restores +
        "\nTimeline:\n" +
        timeline
          .map(function (entry) {
            return (
              "  " +
              entry.at +
              ": " +
              (entry.restored ? "restored" : "LOST") +
              ", caret " +
              entry.caret +
              ", " +
              JSON.stringify(entry.text)
            );
          })
          .join("\n") +
        "\nCounters before: " +
        JSON.stringify(before) +
        "\nCounters after:  " +
        JSON.stringify(after)
    );
  }

  return {
    expected: expected,
    actual: actual,
    offset: offset,
    repaints: repaints,
    restores: restores
  };
}

/**
 * The caret measured the only way that survives a repaint: as a character offset
 * from the start of the region, rather than as a node and a local offset.
 */
async function readRegionCaret(page, selector) {
  return page.evaluate(function (sel) {
    const el = document.querySelector(sel);
    if (!el) throw new Error("readRegionCaret: no element matches " + sel);
    const selection = document.getSelection();
    const anchor = selection && selection.rangeCount > 0 ? selection.anchorNode : null;

    let caretOffset = null;
    let caretInRegion = false;
    if (anchor && el.contains(anchor)) {
      caretInRegion = true;
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null);
      let total = 0;
      let node = walker.nextNode();
      while (node) {
        if (node === anchor) {
          caretOffset = total + selection.anchorOffset;
          break;
        }
        total += node.nodeValue.length;
        node = walker.nextNode();
      }
      if (caretOffset === null) caretOffset = total;
    }

    return {
      text: el.textContent,
      caretOffset: caretOffset,
      caretInRegion: caretInRegion,
      caretConnected: !!anchor && anchor.isConnected
    };
  }, selector);
}

module.exports = {
  assertCaretSurvivesTyping,
  assertCaretRestoredAcrossRepaints,
  assertNoSecondWrite
};
