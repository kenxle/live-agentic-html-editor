// Self-test for the second-origin helper, against a running service.
//
// The shape here is the one plan test #6 needs, and the thing to copy is not the
// helper calls but the assertion style: EVERY refusal is asserted on effect. The
// event log on disk has no new entries. A status code proves nothing, because the
// attacker cannot read it either, and a service that returned 403 while appending
// the row would pass a status assertion and fail the reviewer.
//
// Runs against the stub service for now. When src/service/index.js is real,
// change STUB_SERVICE_ENTRY to SERVICE_ENTRY here and nothing else moves.

const { test, expect } = require("../helpers");
const { startService, STUB_SERVICE_ENTRY, makeStateDir, readEventLog } = require("../helpers");

test.describe("second origin", () => {
  test("a cross-origin page cannot write an item, asserted on the event log", async ({
    page,
    fixtureServer,
    attackerServer
  }) => {
    const stateDir = makeStateDir();
    const service = await startService({
      entry: STUB_SERVICE_ENTRY,
      stateDir: stateDir,
      // Only the fixture origin is registered. Registering an origin is an act
      // the reviewer performs at their terminal, and it is the one thing a
      // hostile page cannot do.
      allowedOrigins: [fixtureServer.origin]
    });

    try {
      expect(readEventLog(stateDir)).toHaveLength(0);

      await page.goto(attackerServer.urlFor("attacker.html"));
      expect(attackerServer.origin).not.toBe(fixtureServer.origin);

      // 1. A simple request. No preflight is sent, so it reaches the handler.
      //    This is the one that matters: CORS hides the response, not the effect.
      await page.evaluate((url) => window.__attack.simplePost(url, { forged: "item" }), service.itemsUrl);

      // 2. sendBeacon, same story, and it outlives the page.
      await page.evaluate((url) => window.__attack.beacon(url, { forged: "beacon" }), service.itemsUrl);

      // 3. A preflighted request with a guessed token.
      await page.evaluate((url) => window.__attack.corsPost(url, { forged: "ack" }), service.itemsUrl);

      // The effect, which is the only thing worth asserting.
      expect(readEventLog(stateDir)).toHaveLength(0);
    } finally {
      await service.kill9();
    }
  });

  test("the registered origin, with the token, does get through", async ({ page, fixtureServer }) => {
    const stateDir = makeStateDir();
    const service = await startService({
      entry: STUB_SERVICE_ENTRY,
      stateDir: stateDir,
      allowedOrigins: [fixtureServer.origin]
    });

    try {
      await page.goto(fixtureServer.urlFor("built-doc.html"));
      const status = await page.evaluate(
        async (args) => {
          const res = await fetch(args.url, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-lahe-token": args.token,
              "x-lahe-request": "1"
            },
            body: JSON.stringify({ kind: "note", text: "the real reviewer" })
          });
          return res.status;
        },
        { url: service.itemsUrl, token: service.token }
      );

      expect(status).toBe(200);
      const log = readEventLog(stateDir);
      expect(log).toHaveLength(1);
      expect(log[0].payload.text).toBe("the real reviewer");
    } finally {
      await service.kill9();
    }
  });
});
