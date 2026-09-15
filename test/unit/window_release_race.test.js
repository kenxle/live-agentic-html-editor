// The goodbye, and the requests that were already on the wire when it went out.
//
// WHAT HAPPENED. reload_claim.spec.js's "reloading the page over and over never
// refuses it" failed once on main (commit 3a4ea6b) and again three times in
// twenty on a stress run, always the same way: the window came back read-only
// after a reload with one window open. The wire trace from the failing run,
// recorded in the browser across the reloads, reads:
//
//   t+0ms    claim, no secret            granted, secret A
//   t+160ms  release, secret A           the holder is removed
//   t+506ms  claim, secret A             granted, and a FRESH secret B is minted
//   t+616ms  release, secret A           no-op: the holder's secret is B now
//   t+901ms  claim, no secret            REFUSED, "already open in another window"
//
// The claim at t+506ms is the page that was replacing the one at t+160ms, and
// the answer to it was never read: that document was already unloading by the
// time it came back. So secret B was minted for nobody. It sat in the table
// looking like a live holder, the goodbye that followed could not match it, and
// the next page in the same tab was refused by D5's second-window guard with
// exactly one window open. The reviewer's page goes read-only, which closes
// every comment box they have open.
//
// THE FIX is that a release leaves its secret behind for a moment, and a claim
// carrying that secret is seated again with the SAME secret rather than a new
// one. Nobody but the holder is ever told a secret, so a claim presenting it is
// that session either way, the dying page or the one replacing it in the tab.
//
// Node-only.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const logModule = require("../../src/service/log.js");
const reviewsModule = require("../../src/service/reviews.js");

function registry(at) {
  const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "lahe-release-race-")), "state");
  const log = logModule.createEventLog({ dir: dir });
  return reviewsModule.createReviews({
    dir: dir,
    log: log,
    now: function () {
      return at.ms;
    }
  });
}

test("a claim carrying the secret that just said goodbye keeps that secret, not a new one", () => {
  const at = { ms: Date.parse("2026-09-15T16:40:57.658Z") };
  const reviews = registry(at);
  reviews.create({ id: "rrelease1", origins: ["null"] });

  const first = reviews.claimWindow("rrelease1", { window_id: "win_1" });
  assert.equal(first.granted, true);

  at.ms += 160;
  assert.deepEqual(reviews.releaseWindow("rrelease1", { session_secret: first.session_secret }), {
    released: true
  });

  // The request the outgoing page already had on the wire, or the first claim of
  // the page replacing it: both carry the secret out of the tab's storage.
  at.ms += 346;
  const afterward = reviews.claimWindow("rrelease1", {
    window_id: "win_1",
    session_secret: first.session_secret
  });
  assert.equal(afterward.granted, true);
  assert.equal(
    afterward.session_secret,
    first.session_secret,
    "the session keeps the secret the tab is carrying, so a new page in it is still the holder"
  );
  assert.equal(afterward.took_over, false, "nothing was taken from anybody: the holder had left");
});

test("the page that replaces a reloaded one is not refused as a second window", () => {
  const at = { ms: Date.parse("2026-09-15T16:40:57.658Z") };
  const reviews = registry(at);
  reviews.create({ id: "rrelease2", origins: ["null"] });

  // The whole sequence off the failing run's wire trace, in order.
  const first = reviews.claimWindow("rrelease2", { window_id: "win_1" });
  at.ms += 160;
  reviews.releaseWindow("rrelease2", { session_secret: first.session_secret });
  at.ms += 346;
  reviews.claimWindow("rrelease2", { window_id: "win_1", session_secret: first.session_secret });
  at.ms += 110;
  // The second page's own goodbye, carrying the same inherited secret. It has to
  // land, or the review is left held by a document that no longer exists.
  assert.deepEqual(
    reviews.releaseWindow("rrelease2", { session_secret: first.session_secret }),
    { released: true },
    "the second page's goodbye matches the holder, so the review is free again"
  );

  at.ms += 285;
  const third = reviews.claimWindow("rrelease2", { window_id: "win_1" });
  assert.equal(third.granted, true, "the third page is granted rather than refused with one window open");
  assert.equal(third.reason, null);
});

test("a secret stays claimable only for the moment after the goodbye", () => {
  const at = { ms: Date.parse("2026-09-15T16:40:57.658Z") };
  const reviews = registry(at);
  reviews.create({ id: "rrelease3", origins: ["null"] });

  const first = reviews.claimWindow("rrelease3", { window_id: "win_1" });
  reviews.releaseWindow("rrelease3", { session_secret: first.session_secret });

  // Long after the goodbye this is an ordinary claim from a window nobody is
  // holding anything against: granted, but with a secret of its own.
  at.ms += 60 * 1000;
  const later = reviews.claimWindow("rrelease3", { window_id: "win_2", session_secret: first.session_secret });
  assert.equal(later.granted, true);
  assert.notEqual(later.session_secret, first.session_secret, "a stale secret is not re-seated");
});

test("a live holder is still refused, released secret or not", () => {
  const at = { ms: Date.parse("2026-09-15T16:40:57.658Z") };
  const reviews = registry(at);
  reviews.create({ id: "rrelease4", origins: ["null"] });

  const first = reviews.claimWindow("rrelease4", { window_id: "win_1" });
  at.ms += 100;
  reviews.releaseWindow("rrelease4", { session_secret: first.session_secret });
  at.ms += 100;
  // Another window gets there first and is holding the review.
  const second = reviews.claimWindow("rrelease4", { window_id: "win_2" });
  assert.equal(second.granted, true);

  at.ms += 100;
  const late = reviews.claimWindow("rrelease4", { window_id: "win_1", session_secret: first.session_secret });
  assert.equal(late.granted, false, "the guard still refuses a window while somebody else is holding it");
  assert.equal(late.deposed, false);
});
