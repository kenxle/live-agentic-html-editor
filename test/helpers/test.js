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

const test = base.test.extend({
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
  expect: base.expect
};
