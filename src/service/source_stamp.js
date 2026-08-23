// Is the helper that is running older than the code it is running?
//
// Owner: 1A. The helper is deliberately shared and long-lived: one process
// serves every project, every agent type, and every agent session on the
// machine. That is what makes `lahe review` one command instead of two, and it
// is also how a maintainer ends up with a helper that has been up since before
// they last edited this clone.
//
// WHAT WENT WRONG, TWICE. The predecessor tool had the same shape and the same
// scar (human-review's 8bb9ce4): an upgraded CLI against a stale running helper
// silently serves broken pieces. It happened here on 2026-08-23. A batch of
// work changed the `contract` array in src/shared/review_format.js. The helper
// had been running since 2026-08-21, holding its modules in memory, so it kept
// writing the OLD contract into every review.json. The static servers are
// spawned per review and so were current, which is what made it invisible:
// injection worked, the page looked right, and the only stale thing was the one
// file the AGENT reads. Measured at the time: contract 31 entries before
// restarting the helper, 32 after. Nothing warned.
//
// WHY NOT COMPARE VERSIONS. `/health` already reports `version` (package.json)
// and `service_contract` (a hand-bumped integer in protocol.js). Neither would
// have caught that day: package.json's version did not change, and nobody
// remembered to bump the contract, which is exactly the kind of thing people do
// not remember. A gate on either number is the gate that looks right and does
// nothing. The signal that cannot be forgotten is the filesystem: if a file the
// helper loaded at boot has changed since it booted, the process is running
// code this clone no longer has.
//
// WHAT COUNTS AS THE CODE. Everything the helper `require`s at boot and then
// holds in memory: `src/` and the two vendored Markdown packages under
// `vendor/`. `dist/lahe-layer.js` is deliberately NOT here: the helper re-reads
// the bundle from disk whenever it changes (src/service/index.js), so a rebuilt
// library needs no restart and must not force one mid-review.
//
// WHAT IT COSTS. One readdir per directory and one stat per file, over the 63
// files those two roots hold, and it stops at the first file newer than the
// helper's start instant. Measured on this repo at 0.43ms for the full walk,
// which is the case where nothing changed. It runs only when a helper is
// actually answering, because a command that has no helper to judge does no
// walk at all.
//
// Node-only.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var CLONE_ROOT = path.join(__dirname, "..", "..");

// The roots whose newest mtime decides the question.
var DEFAULT_ROOTS = [path.join(CLONE_ROOT, "src"), path.join(CLONE_ROOT, "vendor")];

// One spelling of the reason, so every command that bounces a helper says the
// same thing to the person whose page just went unreachable.
var REASON = "the helper was older than the code in this clone";

/** REASON as the start of a sentence. */
function reasonSentence(ending) {
  return REASON.charAt(0).toUpperCase() + REASON.slice(1) + ending;
}

/**
 * The directories to scan.
 *
 * LAHE_SOURCE_DIR replaces them with one directory, the same seam
 * LAHE_STATE_DIR and LAHE_HOME_DIR give the state directory and the home root:
 * it exists so a test can age a scratch tree instead of touching the real
 * clone's mtimes, where a bumped mtime would leak into every other test running
 * beside it.
 */
function roots() {
  var configured = process.env.LAHE_SOURCE_DIR;
  if (configured && path.isAbsolute(configured)) return [configured];
  return DEFAULT_ROOTS.slice();
}

/**
 * The newest mtime under these roots, in milliseconds, or null when none of
 * them holds a file.
 *
 * @param {{roots?: string[], stopAboveMs?: number}} [spec] `stopAboveMs` ends
 *   the walk at the first file newer than that instant, because the caller only
 *   ever asks "is anything newer than this".
 * @returns {number|null}
 */
function newestMtimeMs(spec) {
  var options = spec || {};
  var stack = (options.roots || roots()).slice();
  var stopAbove = typeof options.stopAboveMs === "number" ? options.stopAboveMs : null;
  var newest = null;
  while (stack.length > 0) {
    var dir = stack.pop();
    var entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      // A root that is not there is not evidence of anything. The tool runs
      // from a clone, but it must not refuse to work in a layout it did not
      // expect.
      continue;
    }
    for (var i = 0; i < entries.length; i += 1) {
      var entry = entries[i];
      var full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      var mtimeMs;
      try {
        mtimeMs = fs.statSync(full).mtimeMs;
      } catch (err) {
        continue;
      }
      if (newest === null || mtimeMs > newest) newest = mtimeMs;
      if (stopAbove !== null && newest > stopAbove) return newest;
    }
  }
  return newest;
}

/**
 * Does the helper that reported this start instant predate the code on disk?
 *
 * `started_at` comes off `/health`, which is the running process's own answer,
 * so this compares a process to the files it loaded. Anything it cannot read
 * (an unparseable instant, no source on disk) answers "not stale": a check that
 * cannot tell must never bounce a helper other sessions are using.
 *
 * @param {string} startedAt the helper's ISO start instant
 * @param {{roots?: string[]}} [spec]
 * @returns {{stale: boolean, helper_started_ms: number|null, source_mtime_ms: number|null}}
 */
function helperPredatesSource(startedAt, spec) {
  var startedMs = typeof startedAt === "string" ? Date.parse(startedAt) : NaN;
  if (!Number.isFinite(startedMs)) {
    return { stale: false, helper_started_ms: null, source_mtime_ms: null };
  }
  var newest = newestMtimeMs({
    roots: (spec && spec.roots) || roots(),
    stopAboveMs: startedMs
  });
  if (newest === null) return { stale: false, helper_started_ms: startedMs, source_mtime_ms: null };
  return { stale: newest > startedMs, helper_started_ms: startedMs, source_mtime_ms: newest };
}

module.exports = {
  CLONE_ROOT: CLONE_ROOT,
  DEFAULT_ROOTS: DEFAULT_ROOTS,
  REASON: REASON,
  reasonSentence: reasonSentence,
  roots: roots,
  newestMtimeMs: newestMtimeMs,
  helperPredatesSource: helperPredatesSource
};
