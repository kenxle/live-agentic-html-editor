// Local-link translation for rendered Markdown.
//
// THE DISK IS SOURCE-TRUE. A Markdown source keeps the links its author wrote:
// sibling templates, ../other-skill/SKILL.md, sometimes an absolute path. The
// renderer translates those at render time into mounted URLs; nothing on disk is
// ever rewritten to make a browser page work.
//
// A translated link needs a read-only mount for the target's DIRECTORY on the
// page's site, so the rules here are the path-safety rules: resolve
// real paths first, stay inside the user's home directory, and cap how many
// directories one render may mount. A hidden (dot-prefixed) file or folder is
// treated like any other. A link that fails any of them is
// not broken and not a 404: it renders inert, naming the path to open on disk.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var heal = require("./heal.js");

// The Markdown extensions, spelled once. markdown.js reads them from here,
// since it requires this module and not the other way round.
var MARKDOWN_EXTENSIONS = [".md", ".markdown"];

/**
 * Is `file` a page: something the server renders or serves as HTML, and so
 * something the rail can sit on? A linked script or data file is served as
 * bytes and is never a file an agent is told to edit for a comment.
 */
function isPage(file) {
  return MARKDOWN_EXTENSIONS.indexOf(path.extname(file).toLowerCase()) !== -1 || heal.isStaticPage(file);
}

// The bound on distinct directories one render may mount. A document that links
// out to more than this many folders is linking to a tree, not to siblings, and
// mounting the tree is not something a review should do silently. The bound is
// one page's, not the site's, since a site never forgets a folder and any
// site-wide number runs out. It does not limit what a mount exposes: a mount
// serves its whole tree (board row LAHE-linked-folder-scope).
var MOUNT_CAP = 64;

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

/**
 * May Lahe serve the files in `dir` under a mount? Only a folder whose real
 * path is under the home folder. Hidden folders get no special handling: a
 * worktree usually lives in one (repo/.claude/worktrees/<name>/), and a
 * document there links to its neighbours like any other. Checked when a link
 * makes a mount, when the registry takes one, and when a mount is served, so
 * a mount whose folder is now outside home serves nothing.
 *
 * @param {string} dir
 * @returns {boolean}
 */
function mountableDir(dir) {
  if (typeof dir !== "string" || !path.isAbsolute(dir)) return false;
  var real;
  var home;
  try { real = fs.realpathSync.native(dir); } catch (err) { return false; }
  try { home = fs.realpathSync.native(homeRoot()); } catch (err) { home = homeRoot(); }
  return within(real, home);
}

function mountPrefix(dir) {
  return "/.lahe-source/" + crypto.createHash("sha256").update(path.resolve(dir)).digest("hex").slice(0, 16) + "/";
}

// One render's view of which directories are mounted and how many more it may
// mount. `mounts` are prefixes already served; `counted` are the folders this
// render has linked into, which is what the cap bounds.
function createRegistry(options) {
  var opts = options || {};
  var cap = typeof opts.cap === "number" ? opts.cap : MOUNT_CAP;
  var mounts = Object.assign({}, opts.mounts || {});
  var counted = [];
  var added = [];
  // The real path of every file a link in this render now points at, whether
  // the link was translated into another folder's mount or rewritten under the
  // document's own. The static server puts a rail on these files and on no
  // other file in a mounted folder (spec 20260922.02, requirement 5).
  var linked = [];
  var skipped = 0;
  return {
    cap: cap,
    mounts: mounts,
    added: added,
    linked: linked,
    get skipped() { return skipped; },
    note: function (target) {
      if (typeof target !== "string" || !target || !isPage(target)) return;
      if (linked.indexOf(target) === -1) linked.push(target);
    },
    // `from` is the linking page's folder. A served folder the page sits inside
    // is its own (the site root, or the mount it is read through) and is free.
    // Any other folder counts once, served already or not, so a page past the
    // cap stays past it however often it renders.
    add: function (dir, from) {
      var prefix = mountPrefix(dir);
      var key = mounts[prefix] ? prefix : null;
      var url = prefix;
      if (!key) {
        var existing = Object.keys(mounts).sort(function (a, b) {
          return mounts[b].length - mounts[a].length;
        });
        for (var i = 0; i < existing.length && !key; i += 1) {
          var base = path.resolve(mounts[existing[i]]);
          if (!within(path.resolve(dir), base)) continue;
          var relative = path.relative(base, path.resolve(dir));
          key = existing[i];
          url = key + (relative ? relative.split(path.sep).map(encodeURIComponent).join("/") + "/" : "");
        }
      }
      var own = key && typeof from === "string" && within(path.resolve(from), path.resolve(mounts[key]));
      if (!own && counted.indexOf(key || prefix) === -1) {
        if (counted.length >= cap) { skipped += 1; return null; }
        counted.push(key || prefix);
      }
      if (!key) {
        mounts[prefix] = dir;
        added.push({ prefix: prefix, dir: dir });
      }
      return url;
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

// The link types a rendered page may carry. An allow list, not a block list:
// a script-running scheme has many spellings a browser forgives, and a new or
// odd scheme should be refused by default rather than missed.
var ALLOWED_SCHEMES = ["http", "https", "mailto", "tel"];

// The scheme as a browser reads it: leading spaces and control characters are
// dropped, and a tab or line break anywhere is removed, before the scheme is
// matched, case-blind. Checking the raw text would let "java\tscript:" through.
function browserScheme(href) {
  var cleaned = String(href).replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+/, "");
  var match = cleaned.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  return match ? match[1].toLowerCase() : null;
}

function blockedScheme(href) {
  var scheme = browserScheme(href);
  return scheme !== null && ALLOWED_SCHEMES.indexOf(scheme) === -1 ? scheme : null;
}

// A relative link stays under the document's own mount, but it is still a link
// to a real file, so it is noted the same way a translated one is. Only a file
// that exists and stays inside the document's folder by real path: the same
// file the server would agree to hand out.
function noteRelative(candidate, root, registry) {
  if (!registry || typeof registry.note !== "function") return;
  var real;
  try { real = fs.realpathSync(candidate); } catch (err) { return; }
  var realRoot;
  try { realRoot = fs.realpathSync(root); } catch (err) { return; }
  if (!within(real, realRoot)) return;
  try { if (!fs.statSync(real).isFile()) return; } catch (err) { return; }
  registry.note(real);
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
  var refused = blockedScheme(raw);
  if (refused) return { kind: "blocked", scheme: refused };
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
    if (within(candidate, root)) {
      noteRelative(candidate, root, registry);
      return { kind: "relative" };
    }
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
  var dir = path.dirname(real);
  if (!mountableDir(dir)) return { kind: "inert", target: candidate, reason: "outside-home" };
  var prefix = registry ? registry.add(dir, root) : mountPrefix(dir);
  if (!prefix) return { kind: "inert", target: candidate, reason: "cap" };
  if (registry && typeof registry.note === "function") registry.note(real);
  return {
    kind: "translate",
    url: prefix + encodeURIComponent(path.basename(real)) + split.suffix,
    dir: dir,
    target: real
  };
}

module.exports = {
  MOUNT_CAP: MOUNT_CAP,
  MARKDOWN_EXTENSIONS: MARKDOWN_EXTENSIONS,
  isPage: isPage,
  homeRoot: homeRoot,
  mountPrefix: mountPrefix,
  mountableDir: mountableDir,
  createRegistry: createRegistry,
  ALLOWED_SCHEMES: ALLOWED_SCHEMES,
  classify: classify
};
