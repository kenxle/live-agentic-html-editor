// With the port-80 forward one page has two origins: <name>.lahe.localhost
// and <name>.lahe.localhost:<pages port>. With .lahe names it has a third,
// <name>.lahe. They did not match, so a comment made at one spelling was
// missing from the rail at the other, and review.json split one page into two
// groups. Every place that compares page identity now treats them as one page.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const record = require("../../src/shared/record.js");
const reviewFormat = require("../../src/shared/review_format.js");

function item(origin, pagePath, seq) {
  return { id: "i" + seq, page_origin: origin, page_path: pagePath, page_seq: seq };
}

const FORMS = ["http://brief.docs.lahe.localhost:1483", "http://brief.docs.lahe.localhost", "http://brief.docs.lahe"];

test("every spelling of one stable address is the same page", () => {
  for (const a of FORMS) {
    for (const b of FORMS) {
      assert.equal(record.samePage(item(a, "/page.html", 1), { origin: b, path: "/page.html" }), true, a + " vs " + b);
    }
  }
});

test("a different name, path or plain loopback port is still a different page", () => {
  const it = item("http://brief.docs.lahe.localhost:1483", "/page.html", 1);
  assert.equal(record.samePage(it, { origin: "http://other.docs.lahe.localhost", path: "/page.html" }), false);
  assert.equal(record.samePage(it, { origin: "http://brief.docs.lahe.localhost", path: "/other.html" }), false);
  assert.equal(record.samePage(item("http://127.0.0.1:5000", "/p.html", 1), { origin: "http://127.0.0.1:5001", path: "/p.html" }), false);
  assert.equal(record.samePage(it, { origin: "http://brief.docs.example.com", path: "/page.html" }), false);
});

test("review.json groups every spelling of one page into one group", () => {
  const items = FORMS.map((origin, i) => item(origin, "/page.html", i + 1));
  const groups = reviewFormat.pageGroups(items, {});
  assert.equal(groups.length, 1);
  assert.equal(groups[0].items.length, 3);
});

test("an old port origin aliased to one spelling joins items made at another", () => {
  const items = [item("http://127.0.0.1:61234", "/page.html", 1), item("http://brief.docs.lahe.localhost", "/page.html", 2)];
  const groups = reviewFormat.pageGroups(items, { "http://127.0.0.1:61234": "http://brief.docs.lahe.localhost:1483" });
  assert.equal(groups.length, 1);
});
