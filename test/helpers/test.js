// Playwright's `test` extended with the harness fixtures.
//
// Import from here instead of from @playwright/test and the fixture server is
// already running:
//
//   const { test, expect } = require("../helpers");
//
//   test("something", async ({ page, fixtureServer }) => {
//     await page.goto(fixtureServer.urlFor("built-doc.html"));
//   });
//
// The plain fixture server and the attacker origin are worker-scoped, so a
// worker starts one of each and reuses them. CSP servers are per-test, because
// the policy is part of what the test is saying.

"use strict";

const base = require("@playwright/test");
const { startFixtureServer, startAttackerServer, startCspServer } = require("./servers");

/**
 * Say the page's goodbye before the driver takes its context away.
 *
 * A REAL tab closing fires pagehide, and the layer hands the review back on it
 * (sync.commitOnUnload: flush the words, then release the claim). A context
 * that Playwright tears down does not reliably fire pagehide, so the page dies
 * still holding the review, and the helper waits out its full staleness clock
 * (30 seconds) before anyone else may have it. The next test in the same file
 * shares that helper and that review, so its brand new window is a genuine
 * second window: refused, read-only, comment and edit handlers unbound, and the
 * hotkey does nothing at all. That is how it read from the outside, and it
 * looked engine-specific only because whether pagehide fires on teardown is a
 * race: multi_page_review.spec.js failed on Firefox and reload_claim.spec.js on
 * WebKit on one machine, and both failed on Chromium on another (2026-09-15).
 *
 * So the harness does for the page what the browser would have: one goodbye,
 * awaited, before the context goes. Nothing about the product changes; a test
 * that means to leave a window holding the review opens its own context and
 * closes it itself.
 */
async function handBackTheReview(page) {
  if (!page || page.isClosed()) return;
  try {
    await page.evaluate(function () {
      var lahe = window.__lahe;
      var sync = lahe && lahe.handle ? lahe.handle.sync : null;
      if (!sync || typeof sync.commitOnUnload !== "function") return null;
      return sync.commitOnUnload();
    });
  } catch (err) {
    // The page was already navigating, closed, or never booted the layer.
    // None of those is a failure of the test that just finished.
  }
}

const test = base.test.extend({
  /**
   * The ordinary page, with the goodbye above added to its teardown. Every
   * spec gets it, because every spec that boots the layer holds a review.
   */
  page: async function ({ page }, use) {
    await use(page);
    await handBackTheReview(page);
  },

  /** Static fixture server, no CSP header. Worker-scoped. */
  fixtureServer: [
    async function ({}, use) {
      const server = await startFixtureServer();
      await use(server);
      await server.close();
    },
    { scope: "worker" }
  ],

  /** A second origin, for the cross-origin assertions. Worker-scoped. */
  attackerServer: [
    async function ({}, use) {
      const server = await startAttackerServer();
      await use(server);
      await server.close();
    },
    { scope: "worker" }
  ],

  /**
   * Start a CSP-serving fixture server inside a test:
   *   const server = await cspServer("block-connect");
   * It is closed when the test ends.
   */
  cspServer: async function ({}, use) {
    const started = [];
    await use(async function (variant) {
      const server = await startCspServer(variant);
      started.push(server);
      return server;
    });
    for (const server of started) await server.close();
  }
});

module.exports = {
  test: test,
  expect: base.expect,
  handBackTheReview: handBackTheReview
};
