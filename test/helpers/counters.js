// Counter readers.
//
// The counters are the harness's substitute for waiting. Instead of sleeping
// long enough for "a few replay passes" to have happened, a test reads the
// replay pass counter and polls until it reaches a number. That is also what
// stops a no-op implementation from passing: an implementation that does nothing
// leaves the counter at zero, and the assertion fails for the right reason.
//
// THE CONTRACT (this is the part a builder has to honor):
//
//   window.__lahe.counters.replayPasses    incremented once per replay pass,
//                                          whether or not the pass wrote anything
//   window.__lahe.counters.regionsWritten  incremented once per region replay
//                                          actually wrote to the DOM
//
// The stub layer publishes several more (regionsSkippedIdentical,
// regionsSkippedProtected, regionsSkippedCaret, regionsBlockedChanged, repaints,
// repaintsVetoed). Those are diagnostics, useful in a failure message, and a
// test should not fail on their exact values unless that value is the point.

"use strict";

const { pollPage } = require("./poll");

/**
 * Read every counter the page publishes.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<Record<string, number>>}
 */
async function readCounters(page) {
  return page.evaluate(function () {
    const ns = window.__lahe;
    if (!ns || !ns.counters) {
      throw new Error(
        "readCounters: window.__lahe.counters is missing. Either the review layer did not load " +
          "(check the page's CSP and its script tag) or it does not publish counters yet. " +
          "See test/helpers/README.md, 'What a builder has to change'."
      );
    }
    return Object.assign({}, ns.counters);
  });
}

/**
 * Read one counter.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @returns {Promise<number>}
 */
async function readCounter(page, name) {
  const counters = await readCounters(page);
  if (typeof counters[name] !== "number") {
    throw new Error(
      "readCounter: no counter named '" +
        name +
        "'. Published counters: " +
        Object.keys(counters).join(", ")
    );
  }
  return counters[name];
}

/**
 * Wait until a counter reaches at least `atLeast`.
 * @returns {Promise<number>} the counter's value once the condition holds
 */
async function waitForCounter(page, name, atLeast, options = {}) {
  await pollPage(
    page,
    function (args) {
      const counters = window.__lahe && window.__lahe.counters;
      return !!counters && typeof counters[args[0]] === "number" && counters[args[0]] >= args[1];
    },
    [name, atLeast],
    {
      timeoutMs: options.timeoutMs,
      message: "counter '" + name + "' to reach " + atLeast
    }
  );
  return readCounter(page, name);
}

/**
 * Wait until a counter has gone up by `by` from wherever it is right now.
 * @returns {Promise<{from: number, to: number}>}
 */
async function waitForCounterIncrease(page, name, by = 1, options = {}) {
  const from = await readCounter(page, name);
  const to = await waitForCounter(page, name, from + by, options);
  return { from, to };
}

/**
 * Snapshot every counter, run an action, and return before, after, and the
 * per-counter delta. The delta is usually what an assertion wants.
 *
 * @param {import('@playwright/test').Page} page
 * @param {() => Promise<any>} action
 */
async function countersAround(page, action) {
  const before = await readCounters(page);
  const result = await action();
  const after = await readCounters(page);
  const delta = {};
  Object.keys(after).forEach(function (key) {
    delta[key] = after[key] - (before[key] ?? 0);
  });
  return { before, after, delta, result };
}

module.exports = {
  readCounters,
  readCounter,
  waitForCounter,
  waitForCounterIncrease,
  countersAround
};
