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
//     reviews/<review-id>/                                             (0700)
//       events.jsonl         append-only, one JSON line per event. 0600
//       review.json          the projection the agent reads (3A writes it)
//       meta.json            the review's token and its registered origins. 0600
//       replies*.jsonl       what agents append (3A reads them)
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
  review: "review.json",
  meta: "meta.json"
};

var REVIEWS_DIR = "reviews";
var AGENT_SESSIONS_DIR = "agent-sessions";
var STATIC_SERVERS_DIR = "static-servers";
var REVIEW_ARTIFACTS_DIR = "review-artifacts";

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

function reviewDir(dir, reviewId) {
  assertSafeReviewId(reviewId);
  return resolveWithin(dir, [REVIEWS_DIR, reviewId]);
}

function eventsPath(dir, reviewId) {
  return resolveWithin(dir, [REVIEWS_DIR, assertSafeReviewId(reviewId), FILES.events]);
}

function reviewJsonPath(dir, reviewId) {
  return resolveWithin(dir, [REVIEWS_DIR, assertSafeReviewId(reviewId), FILES.review]);
}

function metaPath(dir, reviewId) {
  return resolveWithin(dir, [REVIEWS_DIR, assertSafeReviewId(reviewId), FILES.meta]);
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
  checkoutAbove: checkoutAbove,
  ensureDir: ensureDir,
  ensureReviewDir: ensureReviewDir,
  assertNotSymlink: assertNotSymlink,
  assertSafeReviewId: assertSafeReviewId,
  resolveWithin: resolveWithin,
  readyPath: readyPath,
  helperLogPath: helperLogPath,
  reviewsRoot: reviewsRoot,
  agentSessionsRoot: agentSessionsRoot,
  agentSessionDir: agentSessionDir,
  agentSessionPath: agentSessionPath,
  wakeLogPath: wakeLogPath,
  monitorPath: monitorPath,
  activityPath: activityPath,
  ensureAgentSessionDir: ensureAgentSessionDir,
  staticServersRoot: staticServersRoot,
  staticServerPath: staticServerPath,
  ensureStaticServersRoot: ensureStaticServersRoot,
  reviewArtifactsRoot: reviewArtifactsRoot,
  ensureReviewArtifactsRoot: ensureReviewArtifactsRoot,
  reviewDir: reviewDir,
  eventsPath: eventsPath,
  reviewJsonPath: reviewJsonPath,
  metaPath: metaPath,
  replyFilePath: replyFilePath,
  writeAtomic: writeAtomic,
  appendLine: appendLine
};
