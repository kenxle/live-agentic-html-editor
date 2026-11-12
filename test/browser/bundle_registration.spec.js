/*
read-when: Changing how scripts/build-layer.js registers converted modules or builds the Library page's script, or when a converted module is missing from window.LAHE in the browser.
not-for: The build's own rules over a stand-in window; see test/unit/build_layer.test.js.
*/

// The two browser files, as npm run build:layer builds them, in a real browser.
//
// The review layer: a module converted to TypeScript does not register itself,
// so the build registers it on window.LAHE at its old place in the order. The
// elapsed phrase is the first such module. The rail's "someone else has this
// review open" chip reads it through store.js, an old file that takes it off
// window.LAHE as it loads, so the chip's words are the proof it arrived in
// time.
//
// The Library page: one built file holds the protocol, the view model, the copy
// function and the page script. With no token on the page, the page script
// stops and says the token is missing. It would say it could not load its
// scripts if any of the three before it were absent.

"use strict";

const { test, expect } = require("../helpers");
const { layerBundle, libraryBundle } = require("./support/bundles");

const PAGE_URL = "http://bundles.test/";

async function openPage(page, body) {
  await page.route(PAGE_URL, (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: "<!doctype html><html><head><title>Bundles</title></head><body>" + body + "</body></html>"
    })
  );
  await page.goto(PAGE_URL);
}

test("the layer bundle registers the converted elapsed module, and the rail's chip reads it", async ({ page }) => {
  await openPage(page, "<p>A page under review.</p>");
  await page.addScriptTag({ content: await layerBundle() });
  const seen = await page.evaluate(() => {
    const LAHE = window.LAHE;
    const since = new Date(Date.now() - 4 * 60 * 1000).toISOString();
    return {
      version: LAHE.version,
      phrase: LAHE.elapsed.elapsedPhrase(since),
      chip: LAHE.store.createStore().describeHolder({ path: "/docs/report.html", since: since })
    };
  });
  expect(seen.version).toMatch(/^\d+\.\d+\.\d+\+[0-9a-f]{12}$/);
  expect(seen.phrase).toBe("for the last 4 minutes");
  expect(seen.chip).toBe("the window on docs/report.html, open for the last 4 minutes");
});

test("the Library page bundle loads its three modules before the page script, and still not the failure codes", async ({ page }) => {
  await openPage(page, '<p id="lahe-catalog-status"></p>');
  await page.addScriptTag({ content: await libraryBundle() });
  const seen = await page.evaluate(() => {
    const LAHE = window.LAHE;
    return {
      status: document.getElementById("lahe-catalog-status").textContent,
      protocol: typeof LAHE.protocol.route,
      viewModel: typeof LAHE.catalogViewModel.initialState,
      copyText: typeof LAHE.copyText,
      failures: typeof LAHE.failures,
      version: typeof LAHE.version
    };
  });
  expect(seen.status).toBe("The Library token is missing. Reload this page.");
  expect(seen.protocol).toBe("function");
  expect(seen.viewModel).toBe("function");
  expect(seen.copyText).not.toBe("undefined");
  expect(seen.failures).toBe("undefined");
  expect(seen.version).toBe("undefined");
});
