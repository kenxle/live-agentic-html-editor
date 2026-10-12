// Two more helper.log lines any page could repeat without end: the "not
// injecting" line (a page's image requests can trigger it) and the Host,
// token and origin refusals from auth. Each is now logged once per distinct
// refusal, and at most LOG_NOTE_CAP of a kind, the same way refused Hosts are.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const authModule = require("../../src/service/auth.js");
const logModule = require("../../src/service/log.js");
const pageRoutes = require("../../src/service/page_routes.js");
const protocol = require("../../src/shared/protocol.js");

function fakeLog() {
  const lines = [];
  return { lines, helperLog: (line) => lines.push(line) };
}

const fakeReviews = {
  ensureKnown() {},
  config() { return { reviews: {} }; }
};

function badRequest(pathName) {
  return {
    routeName: "review.read",
    review: "r_nope",
    method: "GET",
    path: pathName,
    requestId: Math.random().toString(16).slice(2),
    headers: { host: "127.0.0.1:7000", "x-lahe-client": "layer", "x-lahe-token": "x", origin: "http://evil.example" }
  };
}

// A refusal repeated exactly is logged a few times, then not again. Once was
// too few: a page's no-cors fetch and its beacon send the same request, and
// the cross-site spec reads one line per attempt as the proof each was
// refused (test/browser/catalog_cross_site.spec.js).
test("auth logs an identical refusal up to REFUSAL_REPEATS times, then not again", () => {
  const log = fakeLog();
  const auth = authModule.createAuth({ log, reviews: fakeReviews });
  for (let i = 0; i < logModule.REFUSAL_REPEATS + 4; i++) {
    assert.equal(auth.check(badRequest("/review?review=r_nope")).ok, false);
  }
  assert.equal(log.lines.length, logModule.REFUSAL_REPEATS);
  assert.ok(logModule.REFUSAL_REPEATS >= 2);
});

test("auth stops logging new refusals at the cap, with one line saying so", () => {
  const log = fakeLog();
  const auth = authModule.createAuth({ log, reviews: fakeReviews });
  for (let i = 0; i < logModule.LOG_NOTE_CAP + 40; i++) auth.check(badRequest("/review?review=r_nope&n=" + i));
  assert.equal(log.lines.filter((l) => /^refused/.test(l)).length, logModule.LOG_NOTE_CAP);
  assert.equal(log.lines.filter((l) => /further refusals are not logged/.test(l)).length, 1);
});

test("the not-injecting line is logged once per review and file", () => {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-inject-once-")), "state");
  fs.mkdirSync(dir);
  const html = '<!doctype html><html><head><script src="/lahe.js" data-lahe-review="r_other" data-lahe-token="t"></script></head><body></body></html>';
  assert.equal(pageRoutes.injectForMatch(dir, { review: "r_mine", token: "t" }, "/tmp/x.html", html), null, "the fixture carries another review");
  for (let i = 0; i < 4; i++) pageRoutes.injectForMatch(dir, { review: "r_mine", token: "t" }, "/tmp/x.html", html);
  const lines = fs.readFileSync(path.join(dir, "helper.log"), "utf8").split("\n").filter((l) => /not injecting/.test(l));
  assert.equal(lines.length, 1);
});

test("two refusals of one check that differ in their headers each get a line", () => {
  const log = fakeLog();
  const auth = authModule.createAuth({ log, reviews: fakeReviews });
  const noToken = badRequest("/review?review=r_nope");
  delete noToken.headers["x-lahe-token"];
  auth.check(badRequest("/review?review=r_nope"));
  auth.check(noToken);
  assert.equal(log.lines.length, 2);
});
