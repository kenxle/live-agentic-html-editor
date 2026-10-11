// RETIRED in the stable addresses fix round 2 (docs/features/20261011.02_stable_addresses).
// Moved here from test/browser/ with git mv. Nothing runs it: Playwright reads test/browser/,
// and this throwaway spike ran in every suite. Ken approves deleting it at cleanup.
// Why: the Task 1.0 spike answered its question (dotted *.lahe.localhost names load in all
// three lanes with no flag), and the stable addresses specs now load such names every run.

// Task 1.0 spike (throwaway): does each Playwright lane load a page at a
// dotted *.lahe.localhost name with no launch flag? Listens on 127.0.0.1 and
// ::1 so the lane may resolve to either.
const { test, expect } = require("@playwright/test");
const http = require("node:http");

let servers = [];
let port = 0;

test.beforeAll(async function () {
  function handler(req, res) {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>spike</title><p id=h>" + String(req.headers.host).replace(/[<&]/g, "") + "</p>");
  }
  const v4 = http.createServer(handler);
  await new Promise(function (r) { v4.listen(0, "127.0.0.1", r); });
  port = v4.address().port;
  servers.push(v4);
  const v6 = http.createServer(handler);
  await new Promise(function (r) {
    v6.once("error", function () { r(); });
    v6.listen(port, "::1", r);
  });
  servers.push(v6);
});

test.afterAll(async function () {
  for (const s of servers) await new Promise(function (r) { s.close(function () { r(); }); });
});

for (const name of ["one.lahe.localhost", "a.b.c.lahe.localhost", "live-agentic-html-editor.docs.ongoing.lahe.localhost"]) {
  test("loads " + name, async function ({ page }) {
    await page.goto("http://" + name + ":" + port + "/x.html");
    await expect(page.locator("#h")).toHaveText(name + ":" + port);
    const secure = await page.evaluate(function () { return window.isSecureContext; });
    console.log("[spike] " + name + " secure=" + secure);
  });
}
