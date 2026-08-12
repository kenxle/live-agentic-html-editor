// The two hardest assertions in the project, written once.
//
// These are here rather than inline in a test because if either is subtly wrong,
// every test that leans on it is theatre. Each one has a self-test in
// test/browser/harness_selftest.spec.js, and each self-test has a NEGATIVE half
// that switches the behavior off and asserts the assertion throws. Do not delete
// the negative halves.
//
//   assertCaretSurvivesTyping   ranked test #1 in the plan
//   assertNoSecondWrite         ranked test #13 in the plan

"use strict";

const { placeCaret, captureCaret, compareCaret, caretProblems } = require("./caret");
const { readCounters } = require("./counters");
const { waitForCounter } = require("./counters");
const { startRepaints, stopRepaints } = require("./repaint");
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
 * @param {import('@playwright/test').Page} page
 * @param {{selector: string, action: () => Promise<any>,
 *          options?: MutationObserverInit, allow?: (record: object) => boolean,
 *          message?: string}} config
 *   `allow` filters out records a test knowingly expects (a status chip
 *   updating, say). Use it sparingly; every allowed record is a hole.
 * @returns {Promise<{records: object[], result: any, textUnchanged: boolean}>}
 */
async function assertNoSecondWrite(page, config) {
  const selector = config.selector;
  const observer = await observeMutations(page, {
    selector: selector,
    options: config.options
  });

  const textBefore = await page.evaluate(function (sel) {
    return document.querySelector(sel).textContent;
  }, selector);

  const result = await config.action();

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

  return { records: records, result: result, textUnchanged: textUnchanged };
}

module.exports = {
  assertCaretSurvivesTyping,
  assertNoSecondWrite
};
