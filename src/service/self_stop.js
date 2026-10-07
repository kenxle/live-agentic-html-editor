// The helper stops itself once nothing needs it.
//
// WHY. The last `lahe session close` stops the shared helper, unless a review
// page is open or the Library page polled in the last two minutes. Before this
// file, nothing stopped the helper after that: the reason to stay up lapsed and
// the process lived on for good. Test runs close their sessions with a page
// still open, so every run left helpers behind. One Mac had 1,892 of them,
// about 12 GB resident, with swap full and the battery draining.
//
// THE RULES.
//
//  1. Stop when quiet, after a deferred close. The close that left the helper
//     up writes stop-when-quiet.json into the state dir. The helper then stops
//     itself once all of these hold for the whole grace window (two minutes,
//     the same window the close used for the Library):
//       - no agent session is open,
//       - no review window is open (reviews.openWindowReviews),
//       - the Library page has not polled (catalog.seenAt).
//     The grace counts from the latest of: the ask, this helper's start, the
//     last check that saw a window open, the last Library poll, and the last
//     wake from sleep. A check that comes far later than the check interval
//     means the machine slept; an open page has not had its first heartbeat
//     since, so the grace starts again from that check.
//     An open session never lets the helper stop. It also takes the ask back:
//     the session's own close decides again when it comes.
//  2. Stop when the state directory is gone. The helper reads the dir's random
//     token (state-id) at start. It stops when both of these hold:
//       - the token file is missing on two checks in a row (ENOENT only), or
//         holds a different token, and
//       - service.json no longer names this process (its pid and start time).
//     An unreadable file (EACCES, EIO and the like) never counts. A restored
//     backup or a synced copy that still names this helper keeps it running.
//     A removed directory stops the helper even with a session open: nothing
//     it writes reaches anyone. A test that removes its temp dir takes its
//     helper with it. Page servers run the same check against their own record.
//
// A NEW HELPER CLEARS AN OLD ASK. stop-when-quiet.json belongs to the helper
// that was running when the close wrote it. A helper starting up removes any
// it finds, so a hand-started `lahe serve` is never stopped by a close that
// happened before it existed. Without an ask, rule 1 does nothing.
//
// The check timer is unref'd, so it never holds a process open by itself.

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var stateDir = require("./state_dir.js");
var protocol = require("../shared/protocol.js");

var GRACE_MS = protocol.CATALOG.LIBRARY_SEEN_MS;
var SWEEP_MS = 15 * 1000;
// A check this many intervals late means the machine slept in between.
var WAKE_FACTOR = 4;
// Consecutive checks that must find the token file missing.
var MISSES_TO_STOP = 2;

var REASON = {
  QUIET: "quiet",
  STATE_DIR_GONE: "state directory gone"
};

/** {token} when readable, {missing: true} on ENOENT, {unreadable: true} otherwise. */
function readToken(file) {
  try {
    var text = fs.readFileSync(file, "utf8").trim();
    return text ? { token: text } : { unreadable: true };
  } catch (err) {
    return err && err.code === "ENOENT" ? { missing: true } : { unreadable: true };
  }
}

/**
 * The state dir's token: a random string in <dir>/state-id, written once by
 * whichever process gets there first and read by every later one.
 *
 * WHY A FILE, NOT THE INODE. A directory removed and made again can come back
 * with the same inode (Linux does this readily), so device and inode cannot
 * tell the old directory from its replacement. A token cannot be inherited:
 * a fresh directory has no state-id, or a different one.
 *
 * @returns {string|null} the token, or null when it cannot be read or written
 */
function stateToken(dir) {
  var file = stateDir.stateIdPath(dir);
  var existing = readToken(file);
  if (existing.token) return existing.token;
  try {
    stateDir.ensureDir(dir);
    // wx: two processes starting at once must agree, so only one write wins
    // and the loser reads the winner's token.
    fs.writeFileSync(file, crypto.randomBytes(16).toString("hex") + "\n", { flag: "wx", mode: 0o600 });
  } catch (err) {
    if (!err || err.code !== "EEXIST") return null;
  }
  return readToken(file).token || null;
}

/**
 * Does this JSON file still name the given process? "yes", "no" (missing, or
 * names someone else), or "unknown" (unreadable). Used for service.json and
 * for a page server's own record.
 */
function namesProcess(file, matches) {
  var raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    return err && err.code === "ENOENT" ? "no" : "unknown";
  }
  try {
    return matches(JSON.parse(raw)) ? "yes" : "no";
  } catch (err) {
    // Mid-write by somebody else: not evidence either way.
    return "unknown";
  }
}

/**
 * Watch one state dir for being removed or replaced (rule 2).
 *
 * @param {{dir: string, stillOurs: function(): string}} options
 *   `stillOurs` answers whether the dir still names this process ("yes",
 *   "no" or "unknown"), from service.json or a page server's record.
 * @returns {{check: function(): boolean}} check() is true once the dir is gone
 */
function createDirWatch(options) {
  var dir = options.dir;
  var stillOurs = options.stillOurs;
  var token = stateToken(dir);
  var misses = 0;
  function check() {
    if (!token) {
      token = stateToken(dir);
      return false;
    }
    var now = readToken(stateDir.stateIdPath(dir));
    if (now.unreadable) return false;
    if (now.token === token) {
      misses = 0;
      return false;
    }
    if (now.missing) {
      misses += 1;
      if (misses < MISSES_TO_STOP) return false;
    }
    // Missing twice, or a different token: gone, unless the dir still names
    // this process (a restored backup, a synced copy).
    var ours = stillOurs();
    if (ours === "no") return true;
    if (ours === "yes" && now.token) {
      token = now.token;
      misses = 0;
    }
    return false;
  }
  return { check: check };
}

/**
 * @param {{dir: string, agentSessions: {openSessions: function(): Array},
 *          reviews: {openWindowReviews: function(): string[]},
 *          catalog?: {seenAt: function(): (string|null)},
 *          owner?: {pid: number, started_at: string},
 *          now?: function(): number, graceMs?: number, sweepMs?: number,
 *          onStop: function(string): void, log?: object}} options
 *   `owner` is this helper's pid and start time as service.json records them.
 */
function createSelfStop(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createSelfStop: dir is required");
  if (typeof opts.onStop !== "function") throw new Error("createSelfStop: onStop is required");
  var dir = opts.dir;
  var clock = typeof opts.now === "function" ? opts.now : Date.now;
  var graceMs = typeof opts.graceMs === "number" && opts.graceMs >= 0 ? opts.graceMs : GRACE_MS;
  var sweepMs = typeof opts.sweepMs === "number" && opts.sweepMs > 0 ? opts.sweepMs : SWEEP_MS;
  var owner = opts.owner || { pid: process.pid, started_at: null };
  var log = opts.log || null;
  var startedAt = clock();
  var lastWindowAt = -Infinity;
  var lastCheckAt = null;
  var stopped = false;
  var timer = null;

  // An ask left by a close before this helper existed is not about it.
  withdrawAsk();

  var dirWatch = createDirWatch({
    dir: dir,
    stillOurs: function () {
      return namesProcess(stateDir.readyPath(dir), function (ready) {
        return !!ready && ready.pid === owner.pid && (!owner.started_at || ready.started_at === owner.started_at);
      });
    }
  });

  function say(line) {
    if (log && typeof log.helperLog === "function") {
      try { log.helperLog(line); } catch (err) { /* a log that cannot be written is not a reason to stay up */ }
    }
  }

  function askedAt() {
    var raw;
    try { raw = fs.readFileSync(stateDir.stopWhenQuietPath(dir), "utf8"); } catch (err) { return null; }
    try {
      var parsed = JSON.parse(raw);
      var at = parsed && typeof parsed.asked_at === "string" ? Date.parse(parsed.asked_at) : NaN;
      // An ask with no readable time still counts; it just starts the grace now.
      return Number.isNaN(at) ? clock() : at;
    } catch (err) {
      return clock();
    }
  }

  function withdrawAsk() {
    try { fs.unlinkSync(stateDir.stopWhenQuietPath(dir)); } catch (err) { /* already gone */ }
  }

  function fire(reason) {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    opts.onStop(reason);
    return reason;
  }

  /** One look. Returns the reason it stopped, or null. */
  function check() {
    if (stopped) return null;
    if (dirWatch.check()) return fire(REASON.STATE_DIR_GONE);

    var at = clock();
    // Far later than the interval: the machine slept. A page that is still
    // open has not beaten since, so the grace starts again now.
    if (lastCheckAt !== null && at - lastCheckAt > WAKE_FACTOR * sweepMs) lastWindowAt = at;
    lastCheckAt = at;

    var asked = askedAt();
    if (asked === null) return null;

    var open;
    try { open = opts.agentSessions.openSessions(); } catch (err) { return null; }
    if (open.length > 0) {
      // A session is back. Its own close decides when the helper goes.
      withdrawAsk();
      return null;
    }

    if (opts.reviews.openWindowReviews().length > 0) {
      lastWindowAt = at;
      return null;
    }

    var since = Math.max(startedAt, asked, lastWindowAt);
    var seen = opts.catalog && typeof opts.catalog.seenAt === "function" ? Date.parse(opts.catalog.seenAt()) : NaN;
    if (!Number.isNaN(seen) && seen > since) since = seen;
    if (at - since < graceMs) return null;

    withdrawAsk();
    say(
      "stopping: no open agent session, no open review window and no Library poll for " +
        Math.round(graceMs / 1000) + " seconds since the last session close left this helper running"
    );
    return fire(REASON.QUIET);
  }

  function start(intervalMs) {
    if (timer || stopped) return timer;
    var every = typeof intervalMs === "number" && intervalMs > 0 ? intervalMs : sweepMs;
    sweepMs = every;
    timer = setInterval(function () {
      try { check(); } catch (err) { say("self-stop check failed: " + (err && err.message ? err.message : String(err))); }
    }, every);
    if (typeof timer.unref === "function") timer.unref();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { check: check, start: start, stop: stop };
}

module.exports = {
  GRACE_MS: GRACE_MS,
  SWEEP_MS: SWEEP_MS,
  WAKE_FACTOR: WAKE_FACTOR,
  MISSES_TO_STOP: MISSES_TO_STOP,
  REASON: REASON,
  stateToken: stateToken,
  namesProcess: namesProcess,
  createDirWatch: createDirWatch,
  createSelfStop: createSelfStop
};
