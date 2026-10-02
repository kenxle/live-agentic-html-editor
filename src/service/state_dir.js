// The state directory: where the helper keeps everything, and the rules that
// keep it from being talked into writing somewhere else.
//
// Owner: 1A. Architecture D11 (loopback is not a boundary, so the page proves
// itself) and the Data and state section: the data directory sits OUTSIDE ANY
// CHECKOUT, is owner-only, follows no symlinks inside itself, and projections
// are written beside and renamed.
//
// Outside any checkout is not decoration. A state directory inside a clone means
// a `git add -A` publishes a whole review history to a public repository, and
// that burns a user with no attacker involved. stateDir() refuses a directory
// that sits under a git checkout rather than warning about it.
//
//   $LAHE_STATE_DIR, or $XDG_STATE_HOME/lahe, or ~/.local/state/lahe   (0700)
//     service.json           the readiness file: port, pid, and the per-review
//                            tokens. 0600. Written beside, then renamed
//     helper.log             one line per notable thing, and one line per
//                            REFUSAL NAMING THE CHECK THAT FAILED (D11). 0600
//     windows.json           who holds each review's window session right now,
//                            so a helper restart does not depose an open page
//                            (D5). 0600
//     reviews/<review-id>/                                             (0700)
//       events.jsonl         append-only, one JSON line per event. 0600
//       events.jsonl.compacted-ids
//                            event_ids scripts/compact_draft_history.js took
//                            out of the log, one JSON string per line. The log
//                            reader counts them as already seen, so a browser
//                            re-posting one is answered as a duplicate
//       events.jsonl.pre-compact.gz
//                            that script's copy of the log before it ran
//       review.json          the projection the agent reads (3A writes it)
//       meta.json            the review's token and its registered origins. 0600
//       replies*.jsonl       what agents append (3A reads them)
//     styles/<style-id>/     installed document styles (0700), written only by
//                            `lahe style add` through src/service/styles.js:
//                            style.css, metadata.json, fonts/*.woff2, and the
//                            DESIGN.md and licence files copied for the reader
//
// Review ids are path components, so they are constrained to protocol.js's safe
// character set. There is one spelling of that rule and it lives in protocol.js.
//
// Node-only.

"use strict";

var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var protocol = require("../shared/protocol.js");

var DIR_MODE = 0o700;
var FILE_MODE = 0o600;

// The append-only log grows for the life of a review and is bounded by
// retention, not rotation: finished reviews age out rather than silently losing
// history mid-review (Data and state).
var RETENTION_DAYS = 30;

var FILES = {
  ready: "service.json",
  helperLog: "helper.log",
  events: "events.jsonl",
  compactedIds: "events.jsonl.compacted-ids",
  review: "review.json",
  meta: "meta.json",
  windows: "windows.json",
  // The Library's request queue (LAHE Library). Append-only JSONL, written only
  // by the helper and by `lahe library answer`.
  catalogRequests: "catalog-requests.jsonl",
  // Which agent session the Library hands requests to. Written only by the CLI
  // (`lahe library --session`), so it never shares a writer with catalog.json.
  catalogAttach: "catalog-attach.json",
  // Per session: which Library requests its monitor has already woken it for.
  catalogDelivered: "catalog-delivered.log"
};

var REVIEWS_DIR = "reviews";
var AGENT_SESSIONS_DIR = "agent-sessions";
var STATIC_SERVERS_DIR = "static-servers";
var REVIEW_ARTIFACTS_DIR = "review-artifacts";
// Installed document styles (the style switcher). src/service/styles.js is the
// only code that reads or writes under it.
var STYLES_DIR = "styles";

/**
 * The nearest git checkout at or above a directory, or null.
 *
 * `.git` is a directory in an ordinary clone and a FILE in a worktree, so both
 * shapes count. The walk stops at the filesystem root.
 */
function checkoutAbove(dir) {
  var current = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(current, ".git"))) return current;
    var parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

/**
 * Where the helper keeps its data.
 *
 * @param {{dir?: string, allowInsideCheckout?: boolean}} [options]
 *   `dir` is an explicit path (a `--state-dir` the user typed). It is resolved
 *   and run through the SAME in-checkout refusal as the env-derived path, so a
 *   `--state-dir` inside a clone is refused rather than published by a later
 *   `git add -A`. `allowInsideCheckout` waives that refusal and only the repo's
 *   own tooling passes it; nothing in the shipped paths does.
 */
function stateDir(options) {
  var opts = options || {};
  var dir;
  if (opts.dir) {
    dir = path.resolve(opts.dir);
  } else if (process.env.LAHE_STATE_DIR) {
    dir = path.resolve(process.env.LAHE_STATE_DIR);
  } else if (process.env.XDG_STATE_HOME) {
    dir = path.join(path.resolve(process.env.XDG_STATE_HOME), "lahe");
  } else {
    dir = path.join(os.homedir(), ".local", "state", "lahe");
  }
  if (!opts.allowInsideCheckout) {
    var checkout = checkoutAbove(dir);
    if (checkout) {
      throw new Error(
        "the helper's state directory must sit outside any checkout, and " +
          dir +
          " is inside the one at " +
          checkout +
          ". A review history committed by an ordinary `git add -A` is a real " +
          "loss with no attacker involved. Point LAHE_STATE_DIR somewhere else."
      );
    }
  }
  return dir;
}

/**
 * The `--state-dir <path>` a printed command needs, or null when it needs none.
 *
 * Every command this tool prints is meant to be copied and run somewhere else,
 * and a command copied out of a review whose state lives in a custom directory
 * used to resolve the DEFAULT directory when it ran: it reported no work while
 * items sat unanswered a few paths away.
 *
 * The flag is only printed when it CHANGES the answer. With LAHE_STATE_DIR or
 * XDG_STATE_HOME already pointing at the directory in use, the copied command
 * resolves the same place on its own, and spelling the path out again would put
 * a long flag on every command an agent runs for no gain.
 *
 * @param {string|null} dir the directory in use, resolved or not
 * @returns {string|null} the path to print, or null for "the default is right"
 */
function flagFor(dir) {
  if (typeof dir !== "string" || !dir) return null;
  var resolved = path.resolve(dir);
  var byDefault;
  try {
    // allowInsideCheckout, because this is a comparison rather than a use: an
    // env var pointing somewhere refused must not make this throw where the
    // caller only wanted to know whether to print a flag.
    byDefault = stateDir({ allowInsideCheckout: true });
  } catch (err) {
    return resolved;
  }
  return resolved === byDefault ? null : resolved;
}

/** Create a directory owner-only, and make sure it really is owner-only. */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  // recursive mkdir applies the mode only to directories it CREATES, so an
  // existing directory with looser permissions is tightened here rather than
  // trusted.
  fs.chmodSync(dir, DIR_MODE);
  return dir;
}

/**
 * Refuse a path whose final component is a symlink.
 *
 * The helper follows no symlinks inside its data directory (Data and state).
 * A symlinked events.jsonl pointing at ~/.ssh/authorized_keys turns an
 * append-only log into an append-anywhere primitive, and the append itself is
 * the whole attack: nothing has to be read back.
 */
function assertNotSymlink(target) {
  var stat;
  try {
    stat = fs.lstatSync(target);
  } catch (err) {
    if (err.code === "ENOENT") return target;
    throw err;
  }
  if (stat.isSymbolicLink()) {
    throw new Error(
      "refusing to follow a symlink inside the helper's data directory: " + target
    );
  }
  return target;
}

/**
 * Join under a base directory and refuse anything that escapes it, then refuse
 * a symlink at any level between the base and the result.
 *
 * Both halves matter. The containment check alone is defeated by a symlink
 * inside the data directory pointing out of it; the symlink check alone is
 * defeated by a `..` segment.
 */
function resolveWithin(base, segments) {
  var root = path.resolve(base);
  var parts = Array.isArray(segments) ? segments : [segments];
  parts.forEach(function (segment) {
    if (typeof segment !== "string" || segment.length === 0) {
      throw new Error("resolveWithin: every path segment must be a non-empty string");
    }
    if (segment.indexOf("/") !== -1 || segment.indexOf("\\") !== -1 || segment.indexOf("\0") !== -1) {
      throw new Error("resolveWithin: a path segment may not contain a separator: " + JSON.stringify(segment));
    }
  });
  var resolved = path.resolve.apply(path, [root].concat(parts));
  if (resolved !== root && resolved.indexOf(root + path.sep) !== 0) {
    throw new Error("refusing a write outside the helper's data directory: " + resolved);
  }
  var walked = root;
  parts.forEach(function (segment) {
    walked = path.join(walked, segment);
    assertNotSymlink(walked);
  });
  return resolved;
}

/** The safe-id rule, one spelling, in protocol.js. */
function assertSafeReviewId(reviewId) {
  if (!protocol.isSafeId(reviewId)) {
    throw new Error(
      "review ids are path components, so they are limited to " +
        String(protocol.SAFE_ID) +
        ". Got: " +
        JSON.stringify(reviewId)
    );
  }
  return reviewId;
}

function readyPath(dir) {
  return path.join(dir, FILES.ready);
}

function helperLogPath(dir) {
  return path.join(dir, FILES.helperLog);
}

/**
 * The window-session table: which window holds each review, and when it last
 * said so.
 *
 * It sits beside service.json rather than under a review, because the question
 * every reader asks is "does ANY review on this machine have a live page", and
 * a reader that has to walk every review directory to answer it will skip the
 * walk. Owner-only like everything else here: it carries session secrets.
 */
function windowsPath(dir) {
  return path.join(dir, FILES.windows);
}

function reviewsRoot(dir) {
  return path.join(dir, REVIEWS_DIR);
}

function agentSessionsRoot(dir) {
  return path.join(dir, AGENT_SESSIONS_DIR);
}

function agentSessionDir(dir, sessionId) {
  assertSafeReviewId(sessionId);
  return resolveWithin(dir, [AGENT_SESSIONS_DIR, sessionId]);
}

function agentSessionPath(dir, sessionId) {
  return resolveWithin(dir, [AGENT_SESSIONS_DIR, assertSafeReviewId(sessionId), "session.json"]);
}

/**
 * Which ended reviews this session has already been told about.
 *
 * Append-only. A bare review id means the monitor woke on it; "<review>
 * drained" means a drain printed it (see readEndedLedger in
 * src/cli/commands/status.js). It exists because "the reviewer ended
 * this review" is a state and not an event: unlike an unanswered item, which
 * stops being reported the moment the agent answers it, ended_at is permanent.
 * A monitor that woke on it with no memory would wake on it again on every
 * relaunch, forever, and each of those relaunches costs a model turn for
 * nothing. That is the exact no-op wake loop the wake feed was built to end.
 *
 * The monitor and the drain share it. A monitor's mark does not hide the
 * review from the agent's next drain, because an agent that just woke has to
 * be able to find out why; the drain's mark hides it from everyone.
 */
function endedDeliveredPath(dir, sessionId) {
  return resolveWithin(dir, [AGENT_SESSIONS_DIR, assertSafeReviewId(sessionId), "ended-delivered.log"]);
}

/**
 * Which Library requests this session's monitor has already woken it for.
 *
 * One line per delivery, "<request-id> <handoff_rev>", append-only. Keyed by
 * the rev so a takeover delivers a pending request again to the agent that
 * now owns the session. Like ended-delivered.log, only `lahe monitor` writes it.
 */
function catalogDeliveredPath(dir, sessionId) {
  return resolveWithin(dir, [AGENT_SESSIONS_DIR, assertSafeReviewId(sessionId), FILES.catalogDelivered]);
}

/** The Library's request queue, beside service.json. */
function catalogRequestsPath(dir) {
  return resolveWithin(dir, [FILES.catalogRequests]);
}

/** The Library's attach record, beside service.json. */
function catalogAttachPath(dir) {
  return resolveWithin(dir, [FILES.catalogAttach]);
}

/**
 * The session's wake feed: append-only JSONL a host may `tail -f`.
 *
 * Not written through writeAtomic, and that is the point. An atomic replace
 * makes a new inode, and a `tail -f` follows the old one into oblivion without
 * saying so. This file is only ever appended to.
 */
function wakeLogPath(dir, sessionId) {
  return resolveWithin(dir, [AGENT_SESSIONS_DIR, assertSafeReviewId(sessionId), protocol.WAKE.FILE]);
}

/** The running monitor's heartbeat: pid, handoff_rev, and when it last looped. */
function monitorPath(dir, sessionId) {
  return resolveWithin(dir, [AGENT_SESSIONS_DIR, assertSafeReviewId(sessionId), protocol.MONITOR.HEARTBEAT_FILE]);
}

/**
 * When this session last ran a lahe command.
 *
 * Its own file, not a field on session.json: takeover rewrites session.json, and
 * a drain landing in the same instant would race that write.
 */
function activityPath(dir, sessionId) {
  return resolveWithin(dir, [AGENT_SESSIONS_DIR, assertSafeReviewId(sessionId), protocol.MONITOR.ACTIVITY_FILE]);
}

function ensureAgentSessionDir(dir, sessionId) {
  ensureDir(dir);
  ensureDir(agentSessionsRoot(dir));
  return ensureDir(agentSessionDir(dir, sessionId));
}

function staticServersRoot(dir, sessionId) {
  return resolveWithin(dir, [AGENT_SESSIONS_DIR, assertSafeReviewId(sessionId), STATIC_SERVERS_DIR]);
}

function staticServerPath(dir, sessionId, serverId) {
  return resolveWithin(dir, [
    AGENT_SESSIONS_DIR,
    assertSafeReviewId(sessionId),
    STATIC_SERVERS_DIR,
    assertSafeReviewId(serverId) + ".json"
  ]);
}

function ensureStaticServersRoot(dir, sessionId) {
  ensureAgentSessionDir(dir, sessionId);
  return ensureDir(staticServersRoot(dir, sessionId));
}

function reviewArtifactsRoot(dir, sessionId) {
  return resolveWithin(dir, [AGENT_SESSIONS_DIR, assertSafeReviewId(sessionId), REVIEW_ARTIFACTS_DIR]);
}

function ensureReviewArtifactsRoot(dir, sessionId) {
  ensureAgentSessionDir(dir, sessionId);
  return ensureDir(reviewArtifactsRoot(dir, sessionId));
}

/** Where installed styles live: `<state dir>/styles`. Never a symlink. */
function stylesRoot(dir) {
  return resolveWithin(dir, [STYLES_DIR]);
}

function ensureStylesRoot(dir) {
  ensureDir(path.resolve(dir));
  return ensureDir(stylesRoot(dir));
}

function reviewDir(dir, reviewId) {
  assertSafeReviewId(reviewId);
  return resolveWithin(dir, [REVIEWS_DIR, reviewId]);
}

function eventsPath(dir, reviewId) {
  return resolveWithin(dir, [REVIEWS_DIR, assertSafeReviewId(reviewId), FILES.events]);
}

/**
 * The event_ids a compaction took out of this review's log (see FILES above).
 * The log reader loads them into its "already seen" set.
 */
function compactedIdsPath(dir, reviewId) {
  return resolveWithin(dir, [REVIEWS_DIR, assertSafeReviewId(reviewId), FILES.compactedIds]);
}

function reviewJsonPath(dir, reviewId) {
  return resolveWithin(dir, [REVIEWS_DIR, assertSafeReviewId(reviewId), FILES.review]);
}

function metaPath(dir, reviewId) {
  return resolveWithin(dir, [REVIEWS_DIR, assertSafeReviewId(reviewId), FILES.meta]);
}

/**
 * Is this review a `lahe write` notes review? Read off its meta.json, which is
 * where the helper records the marker at creation (src/service/reviews.js).
 * The one on-disk reader: the helper answers from its own loaded copy
 * (reviews.isNotes), and every command reads it here.
 */
function isNotesReview(dir, reviewId) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(dir, reviewId), "utf8")).notes === true;
  } catch (err) {
    return false;
  }
}

/**
 * A reply file inside one review, by its filename.
 *
 * The agent segment of replies-<agent>.jsonl is a path component too, so it goes
 * through protocol.js's filename pattern before it is ever joined to a path.
 */
function replyFilePath(dir, reviewId, filename) {
  var parsed = protocol.agentFromFilename(filename);
  if (!parsed.ok) {
    throw new Error("refusing a reply file name that is not replies.jsonl or replies-<agent>.jsonl: " + JSON.stringify(filename));
  }
  if (parsed.agent !== null && !protocol.isSafeId(parsed.agent)) {
    throw new Error("refusing an unsafe agent segment in a reply file name: " + JSON.stringify(filename));
  }
  return resolveWithin(dir, [REVIEWS_DIR, assertSafeReviewId(reviewId), filename]);
}

/** Make the whole directory for one review, owner-only. */
function ensureReviewDir(dir, reviewId) {
  ensureDir(dir);
  ensureDir(reviewsRoot(dir));
  return ensureDir(reviewDir(dir, reviewId));
}

/**
 * Write beside, then rename.
 *
 * A rename within one directory is atomic, so a crash leaves either the old
 * whole file or the new whole file and never a half-written review.json (Data
 * and state). The temp name carries the pid so two helpers cannot collide on it.
 */
function writeAtomic(target, contents) {
  assertNotSymlink(target);
  var temp = target + "." + process.pid + "." + Date.now() + ".tmp";
  fs.writeFileSync(temp, contents, { mode: FILE_MODE });
  fs.renameSync(temp, target);
  return target;
}

/** Append one whole line, creating the file owner-only if it is not there. */
function appendLine(target, line) {
  assertNotSymlink(target);
  fs.appendFileSync(target, line, { mode: FILE_MODE });
  return target;
}

module.exports = {
  DIR_MODE: DIR_MODE,
  FILE_MODE: FILE_MODE,
  RETENTION_DAYS: RETENTION_DAYS,
  FILES: FILES,
  REVIEWS_DIR: REVIEWS_DIR,
  AGENT_SESSIONS_DIR: AGENT_SESSIONS_DIR,
  STATIC_SERVERS_DIR: STATIC_SERVERS_DIR,
  REVIEW_ARTIFACTS_DIR: REVIEW_ARTIFACTS_DIR,
  stateDir: stateDir,
  flagFor: flagFor,
  checkoutAbove: checkoutAbove,
  ensureDir: ensureDir,
  ensureReviewDir: ensureReviewDir,
  assertNotSymlink: assertNotSymlink,
  assertSafeReviewId: assertSafeReviewId,
  resolveWithin: resolveWithin,
  readyPath: readyPath,
  helperLogPath: helperLogPath,
  windowsPath: windowsPath,
  reviewsRoot: reviewsRoot,
  agentSessionsRoot: agentSessionsRoot,
  agentSessionDir: agentSessionDir,
  agentSessionPath: agentSessionPath,
  endedDeliveredPath: endedDeliveredPath,
  catalogDeliveredPath: catalogDeliveredPath,
  catalogRequestsPath: catalogRequestsPath,
  catalogAttachPath: catalogAttachPath,
  wakeLogPath: wakeLogPath,
  monitorPath: monitorPath,
  activityPath: activityPath,
  ensureAgentSessionDir: ensureAgentSessionDir,
  staticServersRoot: staticServersRoot,
  staticServerPath: staticServerPath,
  ensureStaticServersRoot: ensureStaticServersRoot,
  reviewArtifactsRoot: reviewArtifactsRoot,
  ensureReviewArtifactsRoot: ensureReviewArtifactsRoot,
  STYLES_DIR: STYLES_DIR,
  stylesRoot: stylesRoot,
  ensureStylesRoot: ensureStylesRoot,
  reviewDir: reviewDir,
  eventsPath: eventsPath,
  compactedIdsPath: compactedIdsPath,
  reviewJsonPath: reviewJsonPath,
  metaPath: metaPath,
  isNotesReview: isNotesReview,
  replyFilePath: replyFilePath,
  writeAtomic: writeAtomic,
  appendLine: appendLine
};
