// Healing a reviewed page whose rebuild stripped the script line out.
//
// Owner: 1A, called from reviews.js's mtime stat (the same seam R36's auto
// reload already rides).
//
// WHY THIS EXISTS. A rebuild regenerates the HTML and the lahe script line goes
// with it, so the reviewer's page comes back dead: no rail, no comments module,
// nothing to review with. The documented loop said the agent re-runs `lahe add`
// after every rebuild, and agents forgot, twice in live use on 2026-08-18. A
// rule an agent has to remember is not a mechanism. The helper is already
// stat-ing the file once a second for the reload trigger, so it is the thing
// that can notice the line is gone and put it back, and the page's own reload
// then lands on the healed file with nobody doing anything.
//
// THE FOUR RULES THAT KEEP IT FROM DOING HARM.
//
//  1. STABLE FIRST. A build writes a file in pieces, and reading it mid-write
//     would see no script line in a half-written document and "heal" a file the
//     build is about to overwrite anyway. So a new mtime is only examined after
//     it has stood still for STABLE_MS, which is one poll interval.
//  2. ATOMIC WRITE. Temp file beside the target, then rename, so a reader never
//     sees a half-written page and a crash mid-heal leaves the original intact.
//  3. SOMEBODY ELSE'S LINE IS NOT OURS TO TOUCH. A file carrying a DIFFERENT
//     review's line was deliberately re-attached elsewhere (`lahe add --new`, or
//     a second review on purpose). It is logged and left alone.
//  4. NO LOOP. The heal's own write bumps the mtime once, which is exactly what
//     makes the reviewer's page reload onto the healed file, so that bump is NOT
//     suppressed. What is suppressed is re-examining it: the post-write mtime is
//     recorded as the new baseline, so the next poll sees a settled file and
//     reads nothing.
//
// Everything here fails soft. This runs underneath a route the reviewer's page
// depends on, and a page that cannot poll is worse than a page missing its rail.
//
// Node-only.

"use strict";

var fs = require("node:fs");
var path = require("node:path");
var crypto = require("node:crypto");

var protocol = require("../shared/protocol.js");
var manifest = require("../shared/manifest.js");
var scriptLine = require("../shared/script_line.js");

var REPO_ROOT = path.join(__dirname, "..", "..");
var BUNDLE = path.join(REPO_ROOT, manifest.BUNDLE_OUTPUT);
var BUNDLE_BASENAME = path.basename(manifest.BUNDLE_OUTPUT);

// One poll interval. The library asks once a second, and the mtime read behind
// this is TTL'd at 500ms, so a mtime seen twice with this much clock between the
// two readings is a build that has finished writing.
var STABLE_MS = 500;

// Only a page `add` would have written the line into. A dev-server review
// records a DIRECTORY (never a regular file, so it never reaches here) and a
// printed-snippet flow records a layout template in the application's own code,
// which `add` refuses to edit and so does this.
var STATIC_EXTENSIONS = [".html", ".htm"];

function isStaticPage(target) {
  return STATIC_EXTENSIONS.indexOf(path.extname(target).toLowerCase()) !== -1;
}

/**
 * One path's mtime as an ISO string, or null.
 *
 * ONLY A REGULAR FILE ANSWERS. A dev-server review records the project
 * DIRECTORY as its target, and a directory's mtime moves on every npm install,
 * git checkout and stray .DS_Store while staying still when the page's own file
 * is edited. So the reload fired constantly on churn and never on the change it
 * exists for.
 */
function fileMtimeIso(target) {
  try {
    var stat = fs.statSync(target);
    if (!stat.isFile()) return null;
    return stat.mtime.toISOString();
  } catch (error) {
    return null;
  }
}

/**
 * The healer for one helper.
 *
 * @param {{log: object, now?: () => number}} options `log` is the event log,
 *   for helperLog. `now` is the injectable clock the stability window is
 *   measured on, so a test does not have to sleep.
 */
function createHealer(options) {
  var opts = options || {};
  if (!opts.log) throw new Error("createHealer: log is required");
  var log = opts.log;
  var clock = typeof opts.now === "function" ? opts.now : Date.now;

  // path -> { mtimeMs, firstSeenAt, settledMtimeMs }
  //
  // `settledMtimeMs` is the mtime whose CONTENT this healer has already looked
  // at (or just written). While the file still reads that mtime, nothing opens
  // it again: that is both the no-loop rule and the reason a healthy page costs
  // one stat per poll rather than a file read.
  var watched = Object.create(null);
  // review id -> when this healer last put a line back, as an ISO string.
  var healedAt = Object.create(null);

  function forget(target) {
    delete watched[target];
  }

  /**
   * Look at one recorded target path, healing it if a rebuild stripped the line.
   *
   * @param {{path: string, review: string, token: string, helperOrigin: string}} input
   * @returns {string|null} the file's mtime as an ISO string AFTER any heal, or
   *   null when the path is not a regular file (a dev-server target, or a file
   *   the build deleted). Callers use it exactly as they used a plain stat.
   */
  function consider(input) {
    var spec = input || {};
    var target = spec.path;
    var stat;
    try {
      stat = fs.statSync(target);
    } catch (error) {
      forget(target);
      return null;
    }
    if (!stat.isFile()) {
      forget(target);
      return null;
    }
    var iso = stat.mtime.toISOString();
    if (!isStaticPage(target) || !spec.review || !spec.token || !spec.helperOrigin) return iso;

    var state = watched[target];
    if (state && state.settledMtimeMs === stat.mtimeMs) return iso;
    if (!state || state.mtimeMs !== stat.mtimeMs) {
      // First sighting of this version of the file. A build may still be writing
      // it, so nothing is read until the next pass finds the same mtime.
      watched[target] = { mtimeMs: stat.mtimeMs, firstSeenAt: clock(), settledMtimeMs: null };
      return iso;
    }
    if (clock() - state.firstSeenAt < STABLE_MS) return iso;

    var html;
    try {
      html = fs.readFileSync(target, "utf8");
    } catch (error) {
      // Unreadable right now (a rename mid-flight, a permission). Say nothing
      // and let the next poll try; the reload trigger is unaffected.
      return iso;
    }

    var carried = scriptLine.reviewAlreadyInFile(html);
    if (carried === spec.review) {
      state.settledMtimeMs = stat.mtimeMs;
      return iso;
    }
    if (carried) {
      log.helperLog(
        "review " +
          spec.review +
          ": not healing " +
          target +
          ", it carries review " +
          carried +
          " now, so it was re-attached somewhere else on purpose"
      );
      state.settledMtimeMs = stat.mtimeMs;
      return iso;
    }
    return heal(target, spec, html, state, iso);
  }

  /** Put the line back, refresh the sibling fallback copy, and rebaseline. */
  function heal(target, spec, html, state, isoBefore) {
    var tag = protocol.scriptTag({
      src: spec.helperOrigin + protocol.route("library.get").path,
      review: spec.review,
      token: spec.token,
      helper: spec.helperOrigin,
      fallback: BUNDLE_BASENAME
    });
    var placed = scriptLine.placeScriptLine(html, tag);
    try {
      writeAtomic(target, placed.html);
    } catch (error) {
      // Fail loud, once. The baseline moves so this is not retried every second
      // against a file nothing can write.
      log.helperLog(
        "review " + spec.review + ": could not put the script line back into " + target + " (" + error.message + ")"
      );
      state.settledMtimeMs = state.mtimeMs;
      return isoBefore;
    }

    // The fallback half, refreshed exactly as `add` refreshes it: a copy of the
    // built library beside the page, which is what the line's onerror names. A
    // missing bundle is not a reason to leave the page without its rail, so the
    // copy is best effort and the line still points at the helper's own URL.
    try {
      fs.copyFileSync(BUNDLE, path.join(path.dirname(target), BUNDLE_BASENAME));
    } catch (error) {
      log.helperLog(
        "review " + spec.review + ": the script line is back in " + target + " but the fallback copy beside it was not refreshed (" + error.message + ")"
      );
    }

    var after = null;
    try {
      var stat = fs.statSync(target);
      after = { iso: stat.mtime.toISOString(), ms: stat.mtimeMs };
    } catch (error) {
      after = null;
    }
    // The post-write mtime is the new baseline: this ONE bump travels to the
    // page as the reload trigger, and is never examined again.
    watched[target] = {
      mtimeMs: after ? after.ms : state.mtimeMs,
      firstSeenAt: clock(),
      settledMtimeMs: after ? after.ms : state.mtimeMs
    };
    healedAt[spec.review] = new Date().toISOString();
    log.helperLog(
      "review " + spec.review + ": a rebuild stripped the script line out of " + target + ", so it was put back " + placed.where
    );
    return after ? after.iso : isoBefore;
  }

  /** Temp file in the same directory, then rename, so no reader sees a half page. */
  function writeAtomic(target, contents) {
    var temp = path.join(path.dirname(target), "." + path.basename(target) + ".lahe-" + crypto.randomBytes(6).toString("hex"));
    fs.writeFileSync(temp, contents);
    try {
      fs.renameSync(temp, target);
    } catch (error) {
      try {
        fs.unlinkSync(temp);
      } catch (cleanupError) {
        // Nothing more to do: the rename already failed and is what is reported.
      }
      throw error;
    }
  }

  /** When this helper last put a line back for a review, as an ISO string, or null. */
  function lastHealAt(reviewId) {
    return Object.prototype.hasOwnProperty.call(healedAt, reviewId) ? healedAt[reviewId] : null;
  }

  return {
    STABLE_MS: STABLE_MS,
    consider: consider,
    lastHealAt: lastHealAt
  };
}

module.exports = {
  STABLE_MS: STABLE_MS,
  BUNDLE: BUNDLE,
  BUNDLE_BASENAME: BUNDLE_BASENAME,
  fileMtimeIso: fileMtimeIso,
  isStaticPage: isStaticPage,
  createHealer: createHealer
};
