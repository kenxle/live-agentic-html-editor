// The state directory layout.
//
// Owner: Task 1A. The paths and the permissions are decided here in Phase 0
// because they are a default that is painful to migrate after students have
// installed the tool, and because getting the location wrong burns a user with
// no attacker involved: a state directory inside the clone means a student's
// `git add -A` publishes their entire review history to a public repository.
//
// Architecture D11: the log and the token live OUTSIDE ANY CHECKOUT, in an
// owner-only directory.
//
//   $LAHE_STATE_DIR, or  ~/.local/state/lahe/          (0700)
//     token                 the per-run token. 0600. Persists across restarts
//     port                  the port the running service bound. 0600
//     lock                  the second-instance guard. 0600
//     origins.json          the origin allowlist, one entry per registered
//                           development origin, with its review root and
//                           source hint. 0600. Written by setup only
//     reviews/<review_id>/
//       log.ndjson          the append-only event log. 0600. Not compacted
//       meta.json           review id, started_at, review root, targets. 0600
//
// The review FILES (review.md and review.json) do not live here. They live at
// the review root, which is where the reviewer's agent can read them, and setup
// offers to add their pattern to the reviewed project's ignore file.
//
// Node-only.

"use strict";

var os = require("node:os");
var path = require("node:path");

var DIR_MODE = 0o700;
var FILE_MODE = 0o600;

var RETENTION_DAYS = 30;

function stateDir() {
  if (process.env.LAHE_STATE_DIR) return path.resolve(process.env.LAHE_STATE_DIR);
  var xdg = process.env.XDG_STATE_HOME;
  if (xdg) return path.join(path.resolve(xdg), "lahe");
  return path.join(os.homedir(), ".local", "state", "lahe");
}

var FILES = {
  token: "token",
  port: "port",
  lock: "lock",
  origins: "origins.json"
};

function tokenPath() {
  return path.join(stateDir(), FILES.token);
}

function portPath() {
  return path.join(stateDir(), FILES.port);
}

function lockPath() {
  return path.join(stateDir(), FILES.lock);
}

function originsPath() {
  return path.join(stateDir(), FILES.origins);
}

function reviewDir(reviewId) {
  if (typeof reviewId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(reviewId)) {
    throw new Error("reviewDir: reviewId must be 1 to 64 characters of [A-Za-z0-9_-], got " + String(reviewId));
  }
  return path.join(stateDir(), "reviews", reviewId);
}

function logPath(reviewId) {
  return path.join(reviewDir(reviewId), "log.ndjson");
}

function metaPath(reviewId) {
  return path.join(reviewDir(reviewId), "meta.json");
}

// D9: the run token PERSISTS across service restarts rather than rotating on
// every start. Rotating it contradicts the promise that a stopped service costs
// nothing: a page open across a restart would hold a dead token, every sync
// would return 401 forever, and the failure would be neither of the two states
// the sync client knows how to report. It is regenerated only when the reviewer
// asks. That is a stated, small weakening bought with the drain promise being
// true.
var TOKEN_POLICY = {
  persists_across_restarts: true,
  rotates_on: "an explicit request from the reviewer only",
  bytes: 32,
  compared: "constant time"
};

// D9: the port is ephemeral by default and recorded with the run token. Pinning
// is available and documented as a weakening: a page attacking the service does
// not need to scan if the port is a documented constant.
var PORT_POLICY = {
  ephemeral_by_default: true,
  pinning: "available via --port, documented as a weakening",
  recorded_in: FILES.port
};

module.exports = {
  DIR_MODE: DIR_MODE,
  FILE_MODE: FILE_MODE,
  RETENTION_DAYS: RETENTION_DAYS,
  FILES: FILES,
  TOKEN_POLICY: TOKEN_POLICY,
  PORT_POLICY: PORT_POLICY,
  stateDir: stateDir,
  tokenPath: tokenPath,
  portPath: portPath,
  lockPath: lockPath,
  originsPath: originsPath,
  reviewDir: reviewDir,
  logPath: logPath,
  metaPath: metaPath
};
