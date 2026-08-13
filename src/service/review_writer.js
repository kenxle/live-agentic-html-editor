// The review file writer: the ONE owner of writing review.json, and the one
// owner of the path-safety rules.
//
// Owner: 3A. The projection (src/service/projection.js) calls this every time
// the log moves. Nothing else opens the file for writing. Two writers is how a
// partial file gets read by an agent halfway through a write.
//
// The split with src/shared/review_format.js is deliberate and is the only
// split: review_format builds the projection and renders its bytes, and it is
// pure, so the layer's Copy and Export produce their text with no helper
// running (R10). This module decides WHERE the bytes go and refuses everything
// D11 says to refuse.
//
// The path-safety rules, all of them from architecture D11:
//
//  1. THE REVIEW ROOT IS SERVER-SIDE CONFIGURATION, set at setup or service
//     start, never accepted from a request body. In attached mode the page
//     supplies the target, so a target-derived write destination is
//     attacker-controlled, and a write into an agent's configuration file is
//     not file corruption, it is agent reconfiguration.
//  2. FILE NAMES ARE A HASH OF THE CANONICAL TARGET plus a slug restricted to
//     safe characters and capped in length. Never a path component derived from
//     untrusted text.
//  3. THE DESTINATION IS CHECKED INSIDE THE REVIEW ROOT AFTER SYMLINK
//     RESOLUTION, and refused if it exists and is a symlink.
//  4. WRITES GO THROUGH AN EXCLUSIVELY CREATED TEMP NAME AND A RENAME, so a
//     reader never sees half a file and a crash never leaves a truncated one.
//
// Node-only. Not in the layer bundle.

"use strict";

var fs = require("node:fs");
var path = require("node:path");
var crypto = require("node:crypto");

var normalize = require("../shared/normalize.js");
var reviewFormat = require("../shared/review_format.js");
var failures = require("../shared/failures.js");
var stateDir = require("./state_dir.js");

// A CSPRNG hex source for the temp name below. The fencing delimiter it used to
// serve is gone with the fences (D6, the agent contract is one JSON file).
function randomHex(n) {
  return crypto.randomBytes(Math.ceil(n / 2)).toString("hex").slice(0, n);
}

// Rule 2. The hash is what carries identity; the slug is only there so a human
// scanning a directory can tell which file is which. The slug can never
// introduce a separator, a dot segment, or a length that matters, because
// targetSlug restricts it to [a-z0-9-] and caps it.
function fileBaseFor(canonicalTarget) {
  if (typeof canonicalTarget !== "string" || !canonicalTarget) {
    throw new TypeError("fileBaseFor: canonicalTarget must be a non-empty string");
  }
  var hash = crypto.createHash("sha256").update(canonicalTarget, "utf8").digest("hex").slice(0, 16);
  var slug = normalize.targetSlug(canonicalTarget);
  var base = hash + "-" + slug;
  if (base.indexOf("/") !== -1 || base.indexOf("\\") !== -1 || base === "." || base === "..") {
    throw new Error("fileBaseFor produced an unsafe name: " + base);
  }
  return base;
}

// Rule 3. Returns the resolved absolute destination, or throws.
//
// The check is done on the RESOLVED path of the parent directory, because a
// destination that does not exist yet cannot be realpath'd, and the parent is
// what a planted symlink would be hiding in.
function assertInsideRoot(reviewRoot, filename) {
  if (typeof reviewRoot !== "string" || !path.isAbsolute(reviewRoot)) {
    throw new Error("assertInsideRoot: reviewRoot must be an absolute path set server-side, never from a request");
  }
  if (typeof filename !== "string" || !filename || filename.indexOf("/") !== -1 || filename.indexOf("\\") !== -1) {
    throw new Error("assertInsideRoot: filename must be a single safe path segment, got " + String(filename));
  }
  if (filename === "." || filename === "..") {
    throw new Error("assertInsideRoot: refused a dot segment");
  }

  var realRoot;
  try {
    realRoot = fs.realpathSync(reviewRoot);
  } catch (err) {
    throw new Error("assertInsideRoot: the review root does not exist or is not readable: " + reviewRoot);
  }

  var dest = path.join(realRoot, filename);

  // Refuse an existing symlink at the destination. lstat, not stat: stat
  // follows the link, which is exactly what makes the check useless.
  var st = null;
  try {
    st = fs.lstatSync(dest);
  } catch (err) {
    st = null; // does not exist yet, which is the normal case
  }
  if (st && st.isSymbolicLink()) {
    throw pathRefused("the destination exists and is a symlink: " + dest);
  }
  if (st && !st.isFile()) {
    throw pathRefused("the destination exists and is not a regular file: " + dest);
  }

  // Belt: after all of the above, the joined path must still start with the
  // resolved root plus a separator.
  if (dest !== realRoot && dest.indexOf(realRoot + path.sep) !== 0) {
    throw pathRefused("the destination resolved outside the review root: " + dest);
  }
  return dest;
}

function pathRefused(message) {
  var err = new Error(message);
  err.code = "CLI_PATH_REFUSED";
  err.failure = failures.failure("CLI_PATH_REFUSED", message);
  return err;
}

// Rule 4. Exclusive create plus rename. The temp name carries randomness so two
// concurrent writers cannot collide on it, and wx means an existing temp file
// is an error rather than something to overwrite.
function writeAtomic(destPath, contents) {
  var dir = path.dirname(destPath);
  var tmp = path.join(dir, "." + path.basename(destPath) + "." + randomHex(12) + ".tmp");
  var fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, contents, "utf8");
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, destPath);
  fs.chmodSync(destPath, 0o600);
  return destPath;
}

/**
 * Write `review.json` for one review, atomically.
 *
 * ONE FILE, not a pair. The markdown half belonged to the archived send model;
 * the agent contract is one JSON file now (D6), and the human-readable text is
 * produced by the library's own Copy and Export with no helper running (R10),
 * which is why it is not written here at all.
 *
 * Two ways to name the destination, and both end in the same check:
 *
 *   {dir, review}   the helper's own state directory layout, which is the
 *                   shipped path: <dir>/reviews/<review-id>/review.json
 *   {reviewRoot}    an absolute directory set server-side, which is what the
 *                   path-safety rules were written against and what a test
 *                   points at a temporary folder
 *
 * The review root is never taken from a request in either shape: the caller is
 * the helper, and the helper knows where its own state directory is.
 *
 * @param {Object} projection what src/service/projection.js built
 * @param {{dir?: string, review?: string, reviewRoot?: string}} options
 * @returns {string} the absolute path written
 */
function writeReviewJson(projection, options) {
  var opts = options || {};
  var reviewRoot = opts.reviewRoot;
  if (!reviewRoot) {
    if (!opts.dir || !opts.review) {
      throw new Error("writeReviewJson: pass either {reviewRoot} or {dir, review}, both server-side");
    }
    // Creates the directory if it is not there, owner-only, and refuses a
    // symlink at any level on the way in.
    reviewRoot = stateDir.ensureReviewDir(opts.dir, opts.review);
  }

  var destination = assertInsideRoot(reviewRoot, reviewFormat.FILE_NAMES.json);
  return writeAtomic(destination, reviewFormat.stringifyReview(projection));
}

module.exports = {
  randomHex: randomHex,
  fileBaseFor: fileBaseFor,
  assertInsideRoot: assertInsideRoot,
  writeAtomic: writeAtomic,
  writeReviewJson: writeReviewJson
};
