// A helper restart must be invisible to the page somebody has open.
//
// WHAT HAPPENED, THREE TIMES IN TWO DAYS. The shared helper is replaced
// whenever a command finds the code on disk newer than the running process, and
// on a day when code is landing that is several times an hour. The window
// session table lived in memory, so each new helper started with an empty one:
//
//   - 2026-09-10 02:21Z, review r4915e2d5d632. The open page's heartbeat carried
//     a secret the new helper had never minted, so it was refused as "a second
//     window, holder still alive" for thirty seconds. The page dropped to
//     read-only, which closes every comment box the reviewer has open, and then
//     "took over from a holder whose heartbeat had been quiet", which was itself.
//   - 2026-09-11 03:36Z, review r929a3d60b3cb. Between two restarts a minute
//     apart the page said its address was not registered for the review, which
//     both meta.json and the new helper disagreed with.
//   - The day before that, several reloads and deposes mid-edit, same cause.
//
// So: the table is written to the state directory and read back at startup. The
// other half, a command declining to replace a helper somebody is reviewing on,
// is in test/unit/helper_not_replaced.test.js.
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
const stateDirModule = require("../../src/service/state_dir.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * A registry over a scratch state directory, with a clock a test can move.
 *
 * `at` is a box rather than a value so the returned registry keeps reading the
 * current one.
 */
function registry(dir, at) {
  const log = logModule.createEventLog({ dir: dir });
  return reviewsModule.createReviews({
    dir: dir,
    log: log,
    now: function () {
      return at.ms;
    }
  });
}

function windowsFile(dir) {
  return JSON.parse(fs.readFileSync(stateDirModule.windowsPath(dir), "utf8"));
}

// ---------------------------------------------------------------------------
// The table survives the process
// ---------------------------------------------------------------------------

test("a window holder is written to the state directory and read back by the next helper", (t) => {
  const dir = path.join(tempDir("lahe-windows-"), "state");
  const at = { ms: Date.parse("2026-09-11T03:30:00.000Z") };

  const first = registry(dir, at);
  first.create({ id: "rwindow1", origins: ["null"] });
  const granted = first.claimWindow("rwindow1", { window_id: "win-a" });
  assert.equal(granted.granted, true);
  assert.ok(granted.session_secret, "the holder is handed a secret");

  const table = windowsFile(dir);
  assert.equal(table.sessions.rwindow1.window_id, "win-a", "the holder is on disk");
  assert.equal(
    table.sessions.rwindow1.session_secret,
    granted.session_secret,
    "with the secret, which is the only thing that identifies the holder later"
  );
  assert.equal(
    fs.statSync(stateDirModule.windowsPath(dir)).mode & 0o777,
    0o600,
    "owner-only, like everything else that carries a secret"
  );

  // A NEW HELPER, a few seconds later, the way a replacement really arrives.
  at.ms += 5000;
  const second = registry(dir, at);
  second.create({ id: "rwindow1", origins: ["null"] });
  second.loadSessions();
  const holder = second.holderOf("rwindow1");
  assert.ok(holder, "the new helper knows somebody holds this review");
  assert.equal(holder.window_id, "win-a");
  assert.equal(holder.stale, false, "and that they were heard from seconds ago, not never");
});

test("the page's heartbeat is recognized by a helper that has only ever read the table off disk", (t) => {
  const dir = path.join(tempDir("lahe-windows-beat-"), "state");
  const at = { ms: Date.parse("2026-09-11T03:30:00.000Z") };

  const first = registry(dir, at);
  first.create({ id: "rwindow2", origins: ["null"] });
  const secret = first.claimWindow("rwindow2", { window_id: "win-a" }).session_secret;

  at.ms += 4000;
  const second = registry(dir, at);
  second.create({ id: "rwindow2", origins: ["null"] });
  second.loadSessions();

  // This is the exact request the open page makes ten seconds after a restart.
  const beat = second.claimWindow("rwindow2", { window_id: "win-a", session_secret: secret });
  assert.equal(beat.granted, true, "the page keeps its review across the restart");
  assert.equal(beat.took_over, false, "and it is not told it took the review from itself");
  assert.equal(beat.session_secret, secret, "the secret it already has stays the right one");
});

test("a holder that had already gone quiet is not restored, and the next window simply gets the review", (t) => {
  const dir = path.join(tempDir("lahe-windows-quiet-"), "state");
  const at = { ms: Date.parse("2026-09-11T03:30:00.000Z") };

  const first = registry(dir, at);
  first.create({ id: "rwindow3", origins: ["null"] });
  const secret = first.claimWindow("rwindow3", { window_id: "win-gone" }).session_secret;

  // Longer than the staleness rule. Whoever held this review lost it before the
  // helper stopped, so restoring them would resurrect a session nobody is in.
  at.ms += reviewsModule.STALE_AFTER_MS + 1000;
  const second = registry(dir, at);
  second.create({ id: "rwindow3", origins: ["null"] });
  second.loadSessions();
  assert.equal(second.holderOf("rwindow3"), null, "a holder that went quiet is dropped at load");

  const fresh = second.claimWindow("rwindow3", { window_id: "win-b", session_secret: secret });
  assert.equal(fresh.granted, true, "a window with a secret nobody holds is granted, not refused");
  assert.equal(fresh.took_over, false, "and nothing was taken from anyone, because nobody held it");
  assert.notEqual(fresh.session_secret, secret, "on a fresh grant the secret is minted again");
});

test("an explicit Review-here-instead says so, so the window it deposed acts at once", (t) => {
  const dir = path.join(tempDir("lahe-windows-depose-"), "state");
  const at = { ms: Date.parse("2026-09-11T03:30:00.000Z") };
  const reviews = registry(dir, at);
  reviews.create({ id: "rwindow4", origins: ["null"] });

  const held = reviews.claimWindow("rwindow4", { window_id: "win-a" });
  at.ms += 1000;
  const took = reviews.claimWindow("rwindow4", { window_id: "win-b", takeover: true });
  assert.equal(took.granted, true);
  assert.equal(took.took_over, true);

  at.ms += 1000;
  const refused = reviews.claimWindow("rwindow4", {
    window_id: "win-a",
    session_secret: held.session_secret
  });
  assert.equal(refused.granted, false);
  assert.equal(refused.deposed, true, "the deposed window is told a person did this, not a restart");
  assert.match(refused.reason, /Review here instead/);

  // A window that never held anything gets the ordinary ambiguous refusal, and
  // that one the page waits out rather than acting on.
  const stranger = reviews.claimWindow("rwindow4", { window_id: "win-c" });
  assert.equal(stranger.granted, false);
  assert.equal(stranger.deposed, false);
});

test("readLiveHolders answers off the file, so it works while the helper is not answering at all", (t) => {
  const dir = path.join(tempDir("lahe-windows-live-"), "state");
  const at = { ms: Date.parse("2026-09-11T03:30:00.000Z") };
  const reviews = registry(dir, at);
  reviews.create({ id: "rwindow5", origins: ["null"] });
  reviews.claimWindow("rwindow5", { window_id: "win-a" });

  const live = reviewsModule.readLiveHolders(dir, reviewsModule.LIVE_WINDOW_MS, at.ms + 30000);
  assert.equal(live.length, 1, "a page that spoke thirty seconds ago counts as somebody reviewing");
  assert.equal(live[0].review, "rwindow5");

  const later = reviewsModule.readLiveHolders(
    dir,
    reviewsModule.LIVE_WINDOW_MS,
    at.ms + reviewsModule.LIVE_WINDOW_MS + 1000
  );
  assert.deepEqual(later, [], "past the live window nobody is on it");

  const sentence = reviewsModule.liveReviewerSentence(live);
  assert.match(sentence, /rwindow5/, "the sentence names the review");
  assert.match(sentence, /30s ago/, "and when that page last spoke");
  assert.match(sentence, /lahe serve --restart/, "and what to run when they are done");
});
