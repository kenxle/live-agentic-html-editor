// Repaint control: driving the fixture page's own re-render machinery.
//
// This talks to window.__lahe.fixture, which is the FIXTURE's code (the stand-in
// for the reviewed application), not the tool's. It is harness-owned forever and
// does not change when the real review layer lands.
//
// Repaint flavors, and why both exist:
//
//   turbo-frame   the target's children are replaced wholesale. Text nodes die,
//                 and the caret dies with them. This is Steady Thread's polling
//                 Turbo frame, which is the walk that broke the earlier design.
//   react-text    the target's text nodes are written in place by nodeValue.
//                 Node identity survives and the reviewer's text is still wiped.
//                 A caret assertion that only checks node identity passes here,
//                 which is why the behavioral assertion checks the text too.
//
// Protection modes, so a test can watch protection work and watch it fail:
//
//   veto        a target containing a protected element is skipped entirely.
//               Turbo's turbo:before-morph-element veto, the architecture's
//               answer in D3. This is the default.
//   permanent   the protected element is carried into the new subtree by id.
//               data-turbo-permanent on its own, without the veto.
//   off         protection ignored. The pre-fix behavior, used by the negative
//               self-tests to prove the assertions bite.

"use strict";

const { waitForCounterIncrease } = require("./counters");

async function fixtureCall(page, method, arg) {
  return page.evaluate(
    function (args) {
      const fixture = window.__lahe && window.__lahe.fixture;
      if (!fixture) {
        throw new Error(
          "This page has no repaint engine. Only fixtures that load " +
            "/assets/repaint-engine.js can repaint (repainting.html does; built-doc.html does not)."
        );
      }
      return fixture[args.method](args.arg);
    },
    { method: method, arg: arg }
  );
}

/**
 * Set the repaint engine's knobs.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{flavor?: 'turbo-frame'|'react-text', intervalMs?: number,
 *          target?: string, protection?: 'veto'|'permanent'|'off',
 *          resnapshot?: boolean}} patch
 *   `target` is the subtree selector. Changing it does NOT change what the
 *   server believes: every candidate subtree was snapshotted at load, so a test
 *   can point the engine somewhere else without blessing whatever it just
 *   changed there. Pass `resnapshot: true` when you do mean "the server's
 *   content is now what the page shows".
 * @returns {Promise<object>} the engine's state after the change
 */
async function configureFixture(page, patch) {
  return fixtureCall(page, "configure", patch);
}

/**
 * Re-take the "server" snapshot the engine writes back on every repaint.
 * Call this after deliberately changing the page's content when that change is
 * meant to be what the server now believes.
 */
async function resnapshot(page) {
  return fixtureCall(page, "snapshot", undefined);
}

/**
 * Start repainting on an interval.
 * @param {number} [intervalMs] defaults to whatever is configured (200ms)
 */
async function startRepaints(page, intervalMs) {
  return fixtureCall(page, "start", intervalMs);
}

/** Stop the interval. Returns the total repaint count. */
async function stopRepaints(page) {
  return fixtureCall(page, "stop", undefined);
}

/**
 * Force exactly one repaint and wait for it to have landed.
 *
 * This is the no-sleep alternative to "repaint and hope": it reads the repaint
 * counter, triggers, and polls until the counter moved.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{flavor?: 'turbo-frame'|'react-text', target?: string,
 *          protection?: 'veto'|'permanent'|'off'}} [options]
 *   Any knob passed here is applied before the repaint and stays applied.
 * @returns {Promise<{from: number, to: number}>} the repaint counter around it
 */
async function forceRepaint(page, options = {}) {
  const knobs = {};
  if (options.target !== undefined) knobs.target = options.target;
  if (options.protection !== undefined) knobs.protection = options.protection;
  if (Object.keys(knobs).length > 0) await configureFixture(page, knobs);

  const flavor = options.flavor;
  const from = await page.evaluate(function () {
    return window.__lahe.counters.repaints;
  });
  await fixtureCall(page, "repaintOnce", flavor);
  const to = await page.evaluate(function () {
    return window.__lahe.counters.repaints;
  });
  if (to <= from) {
    throw new Error(
      "forceRepaint: the repaint counter did not move (" +
        from +
        " then " +
        to +
        "). The repaint engine ran but recorded nothing, which means it is broken rather than vetoed; " +
        "a vetoed repaint still increments 'repaints' and increments 'repaintsVetoed' alongside it."
    );
  }
  return { from: from, to: to };
}

/**
 * Repaint N times, waiting for each one, and return the counters around it.
 * Useful for "the page repainted five times and nothing was written".
 */
async function forceRepaints(page, times, options = {}) {
  const results = [];
  for (let i = 0; i < times; i += 1) {
    results.push(await forceRepaint(page, options));
  }
  return results;
}

/**
 * Wait for the interval-driven engine to have repainted at least `count` more
 * times than it has now.
 */
async function waitForRepaints(page, count, options = {}) {
  return waitForCounterIncrease(page, "repaints", count, options);
}

/** Read the repaint engine's current state. */
async function fixtureState(page) {
  return fixtureCall(page, "state", undefined);
}

module.exports = {
  configureFixture,
  resnapshot,
  startRepaints,
  stopRepaints,
  forceRepaint,
  forceRepaints,
  waitForRepaints,
  fixtureState
};
