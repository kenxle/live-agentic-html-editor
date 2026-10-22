"use strict";

// LAHE-holder-tie-same-millisecond: two live reviews that hold one file with
// the same stamp had no defined holder past tier 1. holderOfFile kept the first
// one the folder listing named, and listing order differs by OS. A tie now goes
// to the higher review id at every tier, the rule tier 1 already used.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const logModule = require("../../src/service/log.js");
const pageRoutes = require("../../src/service/page_routes.js");
const { sitesWorld, writeFile } = require("../helpers/sites_world.js");

let counter = 0;
function postItem(state, reviewId, fields) {
  const item = record.newItem(Object.assign({
    kind: record.KIND.COMMENT, state: record.STATE.READY, page_title: "Notes", page_seq: 1, note: "a comment"
  }, fields));
  counter += 1;
  logModule.createEventLog({ dir: state }).append(reviewId, [protocol.newEvent({
    event: protocol.EVENT.ITEM_READY, event_id: "ev_tie_" + counter, review: reviewId, item: item.id, rev: item.rev,
    page_path: item.page_path, page_title: "Notes", page_seq: 1, payload: { draft: false, record: item }
  })]);
}

test("two folder reviews holding one file with the same stamp: the higher id holds it, whatever the listing order", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "docs");
  const file = writeFile(folder, "notes.md", "# Notes\n\nOne paragraph.\n");
  writeFile(folder, "index.md", "# Index\n");
  const site = w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "index.md" });
  const origin = protocol.siteOrigin(site.name, w.helper.pagesPort);
  const a = w.helper.reviews.create({ target_path: folder, agent_session_id: "s_tie_a", origins: ["null"] });
  const b = w.helper.reviews.create({ target_path: folder, agent_session_id: "s_tie_b", origins: ["null"] });
  const same = new Date(Date.now() + 60000).toISOString();
  w.helper.reviews.stampServedByHelper(a.id, same);
  w.helper.reviews.stampServedByHelper(b.id, same);
  postItem(w.state, a.id, { page_origin: origin, page_path: "/notes.md" });
  postItem(w.state, b.id, { page_origin: origin, page_path: "/notes.md" });
  const expected = a.id > b.id ? a.id : b.id;

  const held = pageRoutes.holderOfFile(w.state, fs.realpathSync(file));
  assert.ok(held, "the file has a holder");
  assert.equal(held.tier, 2, "held through the reviews' folder");
  assert.equal(held.review, expected);

  // The same answer with the folder listing in the other order.
  const realReaddir = fs.readdirSync;
  t.mock.method(fs, "readdirSync", function () {
    const out = realReaddir.apply(fs, arguments);
    return Array.isArray(out) ? out.slice().reverse() : out;
  });
  // A fresh state read: the review list is cached by file time, not by order.
  assert.equal(pageRoutes.holderOfFile(w.state, fs.realpathSync(file)).review, expected, "reversed listing");
});
