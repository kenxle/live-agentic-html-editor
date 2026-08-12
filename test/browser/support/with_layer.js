// Putting the real library on a page the library's own fixtures do not serve.
//
// Owner: 2D (living in the page). Not a harness file: it is support for 2D's
// specs, and it lives under test/browser rather than test/helpers because
// test/helpers is 0B's and frozen to me.
//
// The problem it solves. 0C's app fixture (test/fixtures/app/) is a real node
// application: it serves its own HTML, and nothing in it knows about the tool.
// That is the point of it, so it stays that way. To review it, the library has
// to arrive the way it arrives in a host application: ONE SCRIPT TAG carrying
// protocol.js's three attributes. So this module routes the page's own document
// responses through Playwright and appends that one tag before </body>, and
// serves the built bundle from a path on the same origin (so a page under
// script-src 'self' can load it).
//
// Three rules it keeps, all of them load-bearing for what 2D asserts:
//
//   1. GET document requests only. A POST goes through untouched, so the app
//      fixture's form still does its own 303 and the browser's URL still ends
//      up where the app put it.
//   2. The tag is a REAL tag with REAL attributes, so boot reads its config the
//      way it does in a host app (document.currentScript, then the selector).
//   3. Response headers are preserved. The CSP specs depend on the app's own
//      Content-Security-Policy header surviving the rewrite.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../../src/shared/protocol.js");

const REPO_ROOT = path.join(__dirname, "..", "..", "..");
const BUNDLE_PATH = path.join(REPO_ROOT, "dist", "lahe-layer.js");

// Same-origin by construction, so 'self' covers it under any CSP the app sends.
const BUNDLE_ROUTE = "/__lahe/lahe-layer.js";

function readBundle() {
  if (!fs.existsSync(BUNDLE_PATH)) {
    throw new Error(
      "with_layer: dist/lahe-layer.js is missing. Builders do not COMMIT dist, but they do build it: " +
        "run `npm run build:layer` before the browser specs."
    );
  }
  return fs.readFileSync(BUNDLE_PATH, "utf8");
}

function scriptTagFor(config) {
  const attrs = protocol.SCRIPT_ATTR;
  return (
    '<script src="' +
    BUNDLE_ROUTE +
    '" ' +
    attrs.REVIEW +
    '="' +
    config.review +
    '" ' +
    attrs.TOKEN +
    '="' +
    config.token +
    '" ' +
    attrs.HELPER +
    '="' +
    config.helper +
    '"></script>'
  );
}

/**
 * Add the library to every HTML document this page loads.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{review: string, token: string, helper: string}} config
 */
async function withLayer(page, config) {
  const bundle = readBundle();
  const tag = scriptTagFor(config);

  await page.route("**/*", async function (route, request) {
    if (request.method() !== "GET" || request.resourceType() !== "document") {
      return route.continue();
    }
    const response = await route.fetch();
    const type = String(response.headers()["content-type"] || "");
    if (type.indexOf("text/html") === -1) return route.fulfill({ response });
    const body = await response.text();
    if (body.indexOf("</body>") === -1) {
      throw new Error("with_layer: the document has no </body> to inject before:\n" + body.slice(0, 200));
    }
    return route.fulfill({ response: response, body: body.replace("</body>", tag + "\n</body>") });
  });

  // Registered LAST on purpose: Playwright matches route handlers in reverse
  // registration order, so the catch-all above would otherwise swallow this and
  // send the bundle request on to an app server that has never heard of it.
  await page.route("**" + BUNDLE_ROUTE, function (route) {
    return route.fulfill({
      status: 200,
      headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "no-store" },
      body: bundle
    });
  });
}

module.exports = { withLayer, BUNDLE_ROUTE, BUNDLE_PATH, scriptTagFor };
