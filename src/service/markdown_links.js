// Local-link translation for rendered Markdown.
//
// THE DISK IS SOURCE-TRUE. A Markdown source keeps the links its author wrote:
// sibling templates, ../other-skill/SKILL.md, sometimes an absolute path. The
// renderer translates those at render time into mounted URLs; nothing on disk is
// ever rewritten to make a browser page work.
//
// A translated link needs a read-only mount for the target's DIRECTORY on the
// session's static server, so the rules here are the path-safety rules: resolve
// real paths first, stay inside the user's home directory, refuse hidden
// (dotfile) locations the way the rest of the tool refuses unsafe paths, and cap
// how many directories one render may mount. A link that fails any of them is
// not broken and not a 404: it renders inert, naming the path to open on disk.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

// The bound on distinct directories one render may mount. A document that links
// out to more than this many folders is linking to a tree, not to siblings, and
// mounting the tree is not something a review should do silently.
var MOUNT_CAP = 16;

// The home root is the outer boundary for every auto-registered mount.
// LAHE_HOME_DIR moves that boundary, the same seam LAHE_STATE_DIR gives the
// state directory: it exists so tests can build a fixture home under a temp
// directory, and it is read from the user's own environment.
function homeRoot() {
  var configured = process.env.LAHE_HOME_DIR;
  var root = configured && path.isAbsolute(configured) ? configured : os.homedir();
  try { return fs.realpathSync(root); } catch (err) { return path.resolve(root); }
}

function within(candidate, root) {
  return candidate === root || candidate.indexOf(root + path.sep) === 0;
}

function hasHiddenSegment(target, root) {
  var relative = path.relative(root, target);
  if (!relative) return false;
  return relative.split(path.sep).some(function (segment) {
    return segment.charAt(0) === "." && segment !== "." && segment !== "..";
  });
}

function mountPrefix(dir) {
  return "/.lahe-source/" + crypto.createHash("sha256").update(path.resolve(dir)).digest("hex").slice(0, 16) + "/";
}

// One render's view of which directories are mounted and how many more it may
// mount. `mounts` are prefixes already served (free to reuse); `consumed` are
// the prefixes that already counted against the cap.
function createRegistry(options) {
  var opts = options || {};
  var cap = typeof opts.cap === "number" ? opts.cap : MOUNT_CAP;
  var mounts = Object.assign({}, opts.mounts || {});
  var consumed = (opts.consumed || []).slice();
  var added = [];
  var skipped = 0;
  return {
    cap: cap,
    mounts: mounts,
    added: added,
    get skipped() { return skipped; },
    add: function (dir) {
      var prefix = mountPrefix(dir);
      if (mounts[prefix]) return prefix;
      if (consumed.length >= cap) { skipped += 1; return null; }
      mounts[prefix] = dir;
      consumed.push(prefix);
      added.push({ prefix: prefix, dir: dir });
      return prefix;
    }
  };
}

function splitSuffix(value) {
  var match = String(value).match(/^([^?#]*)([\s\S]*)$/);
  return { pathPart: match[1], suffix: match[2] || "" };
}

function decodePath(value) {
  try { return decodeURIComponent(value); } catch (err) { return value; }
}

function isExternal(href) {
  return !href || href.slice(0, 2) === "//" || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(href);
}

// Decide what one href becomes in the rendered output.
//
//   external  leave it alone (scheme, protocol-relative, empty)
//   anchor    leave it alone (#heading, and a bare query)
//   relative  leave it alone; it already resolves under the document's own
//             mount, which the caller prefixes
//   translate rewrite to `url`, after registering `dir` as a mount
//   inert     render as a non-clickable span naming `target`, with `reason`
function classify(href, sourceDir, registry) {
  var raw = String(href == null ? "" : href);
  if (isExternal(raw)) return { kind: "external" };
  if (raw.charAt(0) === "#") return { kind: "anchor" };
  var split = splitSuffix(raw);
  if (!split.pathPart) return { kind: "anchor" };
  var decoded = decodePath(split.pathPart);
  var root = path.resolve(sourceDir);
  var candidate;
  if (path.isAbsolute(decoded)) {
    candidate = path.resolve(decoded);
  } else {
    candidate = path.resolve(root, decoded);
    if (within(candidate, root)) return { kind: "relative" };
  }
  var home = homeRoot();
  var real;
  try { real = fs.realpathSync(candidate); } catch (err) {
    return { kind: "inert", target: candidate, reason: "missing" };
  }
  var stat;
  try { stat = fs.statSync(real); } catch (err) {
    return { kind: "inert", target: candidate, reason: "missing" };
  }
  if (!stat.isFile()) return { kind: "inert", target: candidate, reason: "not-a-file" };
  // The real path is what decides, so a symlink pointing out of the home
  // directory is refused even when the link itself sits inside it.
  if (!within(real, home)) return { kind: "inert", target: candidate, reason: "outside-home" };
  if (hasHiddenSegment(real, home)) return { kind: "inert", target: candidate, reason: "hidden" };
  var dir = path.dirname(real);
  var prefix = registry ? registry.add(dir) : mountPrefix(dir);
  if (!prefix) return { kind: "inert", target: candidate, reason: "cap" };
  return {
    kind: "translate",
    url: prefix + encodeURIComponent(path.basename(real)) + split.suffix,
    dir: dir,
    target: real
  };
}

module.exports = {
  MOUNT_CAP: MOUNT_CAP,
  homeRoot: homeRoot,
  mountPrefix: mountPrefix,
  createRegistry: createRegistry,
  classify: classify
};
