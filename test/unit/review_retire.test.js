// `lahe review retire <id>` ends a review on purpose (each page its own
// comments, Part 1). Only the owning session may retire its review, and a
// retired review is enforced in four places: the page's review pick, the
// Origin check, events under its token, and "has a review" for `lahe review`
// (that last one is in one_review_per_file.test.js).

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const sitesModule = require("../../src/service/sites.js");
const reviewsModule = require("../../src/service/reviews.js");
const logModule = require("../../src/service/log.js");
const { sitesWorld, writeFile, raw, getPage } = require("../helpers/sites_world.js");

const RETIRE = protocol.route("review.retire");
const PAGE = "<!doctype html><html><head><title>t</title></head><body><p>x</p></body></html>";

function retire(w, body, headers) {
  return raw(w.helper.port, {
    method: "POST",
    path: RETIRE.path,
    headers: Object.assign({
      host: "127.0.0.1:" + w.helper.port,
      "content-type": "application/json",
      "x-lahe-client": "cli",
      "x-lahe-cli-secret": sitesModule.readCliSecret(w.state)
    }, headers || {}),
    body
  });
}

async function world(t) {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  const page = writeFile(folder, "page.html", PAGE);
  const review = w.helper.reviews.create({ target_path: page, agent_session_id: "s_owner", origins: ["null"] });
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(folder), mode: "folder", entry: "page.html" });
  return Object.assign(w, { folder, page, review, bound, origin: protocol.siteOrigin(bound.name, w.helper.pagesPort) });
}

test("retire refuses another session's review, and needs the CLI secret", async (t) => {
  const w = await world(t);
  const foreign = await retire(w, { review: w.review.id, session: "s_other" });
  assert.equal(foreign.status, protocol.statusFor("PROTO_NOT_OWNER"));
  const noSecret = await retire(w, { review: w.review.id, session: "s_owner" }, { "x-lahe-cli-secret": undefined });
  assert.equal(noSecret.status, 401);
  const fromPage = await retire(w, { review: w.review.id, session: "s_owner" }, { origin: w.origin });
  assert.notEqual(fromPage.status, 200, "a page can never retire a review");
  assert.equal(w.helper.reviews.get(w.review.id).retired_at, undefined);
});

test("a retired review no longer answers on its page, fails the Origin check, and takes no events", async (t) => {
  const w = await world(t);
  const before = await getPage(w, w.bound.name, "/page.html");
  assert.match(before.text, new RegExp('data-lahe-review="' + w.review.id + '"'));

  const res = await retire(w, { review: w.review.id, session: "s_owner" });
  assert.equal(res.status, 200, res.text);
  assert.equal(typeof res.json.retired_at, "string");

  const after = await getPage(w, w.bound.name, "/page.html");
  assert.equal(after.status, 200);
  assert.doesNotMatch(after.text, /data-lahe-review=/, "the page is served with no rail");

  const read = await raw(w.helper.port, {
    path: protocol.route("review.read").path + "?review=" + w.review.id,
    headers: { host: "127.0.0.1:" + w.helper.port, "x-lahe-client": "layer", "x-lahe-token": w.review.token, origin: w.origin }
  });
  assert.equal(read.status, 403, "the site's Origin no longer passes for it");

  const item = record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, page_origin: "null", page_path: "/page.html", note: "late" });
  const post = await raw(w.helper.port, {
    method: "POST",
    path: protocol.route("events.append").path,
    headers: {
      host: "127.0.0.1:" + w.helper.port,
      "content-type": "application/json",
      "x-lahe-client": "layer",
      "x-lahe-token": w.review.token,
      origin: "null"
    },
    body: {
      review: w.review.id,
      events: [protocol.newEvent({ event: protocol.EVENT.ITEM_READY, event_id: "ev_late", review: w.review.id, item: item.id, rev: item.rev, page_path: "/page.html", payload: { draft: false, record: item } })]
    }
  });
  assert.equal(post.status, protocol.statusFor("PROTO_REVIEW_RETIRED"));
  assert.equal(w.helper.log.read(w.review.id).filter((e) => e.event_id === "ev_late").length, 0);

  // It stays retired after a restart.
  const again = reviewsModule.createReviews({ dir: w.state, log: logModule.createEventLog({ dir: w.state }) });
  again.loadFromDisk();
  assert.equal(typeof again.get(w.review.id).retired_at, "string");
});
