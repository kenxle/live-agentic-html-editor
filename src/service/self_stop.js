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
//     last sweep that saw a window open, and the last Library poll.
//     An open session never lets the helper stop. It also takes the ask back:
//     the session's own close decides again when it comes.
//  2. Stop when the state directory is gone. The helper reads the dir's
//     random token (state-id) at start. If that file is missing, or holds a
//     different token, the directory was removed or replaced, nothing the
//     helper writes reaches anyone, and it stops at once. A file it briefly
//     cannot read does not count. A test that removes its temp dir takes its
//     helper with it.
//
// Without the ask, rule 1 does nothing: a helper started by hand, or by a
// command that has not closed anything yet, keeps running as before.
//
// The sweep timer is unref'd, so it never holds a process open by itself.

"use strict";

var crypto = require("crypto");
var fs = require("fs");
var stateDir = require("./state_dir.js");
var protocol = require("../shared/protocol.js");

var GRACE_MS = protocol.CATALOG.LIBRARY_SEEN_MS;
var SWEEP_MS = 15 * 1000;

var REASON = {
  QUIET: "quiet",
  STATE_DIR_GONE: "state directory gone"
};

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
  return readToken(file).token;
}

/** {token} when readable, {missing: true} when the file or dir is not there. */
function readToken(file) {
  try {
    var text = fs.readFileSync(file, "utf8").trim();
    return text ? { token: text } : { missing: true };
  } catch (err) {
    return err && (err.code === "ENOENT" || err.code === "ENOTDIR") ? { missing: true } : { unreadable: true };
  }
}

/**
 * Is this still the state dir that handed out `token`? False only when the
 * token file is missing or holds a different token. A dir that is briefly
 * unreadable (a permission change, an I/O error) counts as still there.
 */
function sameStateDir(dir, token) {
  if (!token) return true;
  var now = readToken(stateDir.stateIdPath(dir));
  if (now.unreadable) return true;
  return !now.missing && now.token === token;
}

/**
 * @param {{dir: string, agentSessions: {openSessions: function(): Array},
 *          reviews: {openWindowReviews: function(): string[]},
 *          catalog?: {seenAt: function(): (string|null)},
 *          now?: function(): number, graceMs?: number,
 *          onStop: function(string): void, log?: object}} options
 */
function createSelfStop(options) {
  var opts = options || {};
  if (!opts.dir) throw new Error("createSelfStop: dir is required");
  if (typeof opts.onStop !== "function") throw new Error("createSelfStop: onStop is required");
  var dir = opts.dir;
  var clock = typeof opts.now === "function" ? opts.now : Date.now;
  var graceMs = typeof opts.graceMs === "number" && opts.graceMs >= 0 ? opts.graceMs : GRACE_MS;
  var log = opts.log || null;
  var startedAt = clock();
  var token = stateToken(dir);
  var lastWindowAt = -Infinity;
  var stopped = false;
  var timer = null;

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
    if (!sameStateDir(dir, token)) return fire(REASON.STATE_DIR_GONE);

    var asked = askedAt();
    if (asked === null) return null;

    var open;
    try { open = opts.agentSessions.openSessions(); } catch (err) { return null; }
    if (open.length > 0) {
      // A session is back. Its own close decides when the helper goes.
      withdrawAsk();
      return null;
    }

    var at = clock();
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
    var every = typeof intervalMs === "number" && intervalMs > 0 ? intervalMs : SWEEP_MS;
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
  REASON: REASON,
  stateToken: stateToken,
  sameStateDir: sameStateDir,
  createSelfStop: createSelfStop
};
