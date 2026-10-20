// Local-link translation for rendered Markdown.
//
// THE DISK IS SOURCE-TRUE. A Markdown source keeps the links its author wrote:
// sibling templates, ../other-skill/SKILL.md, sometimes an absolute path. The
// renderer translates those at render time into mounted URLs; nothing on disk is
// ever rewritten to make a browser page work.
//
// A translated link needs a read-only mount for the target's DIRECTORY on the
// page's site, so the rules here are the path-safety rules: resolve
// real paths first, stay inside the user's home directory, keep out of the
// secret folders (isSecretPath), and bound how many files one render may name
// under mounts. A hidden (dot-prefixed) file or folder is treated like any
// other. A link that fails any of them is not broken and not a 404: it renders
// inert, naming the path to open on disk.
//
// A mount only names a folder. What it serves is the list of files the site's
// pages link to (sites.js, mount_files); this module decides which links may
// be made, page_routes.js decides which files a request may read.

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

// The bound on distinct files one render may name under mounts. A mount serves
// only the files the site's pages link to, so the number of folders no longer
// matters; the list those links make does, and a generated page with thousands
// of links would add thousands of paths in one render. The most any page of
// Ken's runbook sites names is 171.
var FILE_LIMIT = 256;

// Real paths under the home folder that no site and no mount ever serves, and
// no link ever points at: the places credentials live by default. A document
// that links one cannot be trusted to have meant it, and a site rooted at home
// would otherwise serve them. Each is a path under the home root, and
// everything inside it is refused with it.
var SECRET_PATHS = [
  ".ssh", ".aws", ".gnupg", ".config/gh", ".config/gcloud", ".netrc",
  ".git-credentials", ".npmrc", ".kube", ".docker", "Library/Keychains"
];

// The home root is the outer boundary for every auto-registered mount.
// LAHE_HOME_DIR moves that boundary, the same seam LAHE_STATE_DIR gives the
// state directory: it exists so tests can build a fixture home under a temp
// directory, and it is read from the user's own environment.
function homeRoot() {
  var configured = process.env.LAHE_HOME_DIR;
  var root = configured && path.isAbsolute(configured) ? configured : os.homedir();
  try { return fs.realpathSync.native(root); } catch (err) { return path.resolve(root); }
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

/**
 * Is `real` one of the secret paths, or inside one? `real` is a real path
 * (fs.realpathSync.native). Each secret path is resolved against the home root
 * the same way, so a ~/.ssh that is a symlink still names the folder it leads
 * to, and the unresolved spelling is refused too.
 *
 * @param {string} real
 * @returns {boolean}
 */
function isSecretPath(real) {
  if (typeof real !== "string" || !path.isAbsolute(real)) return false;
  var home = homeRoot();
  var resolved = secretRoots(home);
  return SECRET_PATHS.some(function (relative, i) {
    // The unresolved spelling is checked every time, so a folder created
    // after the roots were resolved is refused at once.
    if (within(real, path.join(home, relative))) return true;
    return resolved[i] !== null && within(real, resolved[i]);
  });
}

// The real path of each secret path under one home folder (null for one that
// is not there), kept for a short while: resolving eleven paths for every
// address on every render is the cost this saves. A secret path that appears
// or is turned into a symlink inside the window is still caught by the
// unresolved check in isSecretPath; only where a new symlink leads waits.
var SECRET_ROOTS_TTL_MS = 60 * 1000;
var secretRootsCache = { home: null, at: 0, roots: null };

function secretRoots(home) {
  var now = Date.now();
  if (secretRootsCache.home === home && now - secretRootsCache.at < SECRET_ROOTS_TTL_MS) return secretRootsCache.roots;
  var roots = SECRET_PATHS.map(function (relative) {
    try { return fs.realpathSync.native(path.join(home, relative)); } catch (err) { return null; }
  });
  secretRootsCache = { home: home, at: now, roots: roots };
  return roots;
}

function mountPrefix(dir) {
  return "/.lahe-source/" + crypto.createHash("sha256").update(path.resolve(dir)).digest("hex").slice(0, 16) + "/";
}

// One render's view of which directories are mounted and how many files it has
// named. `mounts` are prefixes already served. `follow: false` is a notes page:
// it follows no link out of the folder it is served from. `inMount: true` is a
// page served through a mount: its own-folder links are addresses under that
// mount too, so they count toward the file limit like a translated link does.
function createRegistry(options) {
  var opts = options || {};
  var follow = opts.follow !== false;
  var inMount = opts.inMount === true;
  var mounts = Object.assign({}, opts.mounts || {});
  var named = [];
  var added = [];
  // The real path of every file a link in this render now points at, whether
  // the link was translated into another folder's mount or rewritten under the
  // document's own. The static server puts a rail on these files and on no
  // other file in a mounted folder (spec 20260922.02, requirement 5).
  var linked = [];
  var past = 0;
  var refused = null;
  return {
    follow: follow,
    mounts: mounts,
    added: added,
    linked: linked,
    get past() { return past; },
    get refused() { return refused; },
    // Count a file this render names under a mount; false when the render has
    // named FILE_LIMIT others. Files named before count, so a page past the
    // limit stays past it however often it renders.
    name: function (target) {
      if (named.indexOf(target) !== -1) return true;
      if (named.length >= FILE_LIMIT) { past += 1; refused = "too-many"; return false; }
      named.push(target);
      return true;
    },
    // A link that stays in the page's own folder. Free unless the page is
    // itself served through a mount, where it names a file under that mount.
    nameOwn: function (target) {
      return inMount ? this.name(target) : true;
    },
    note: function (target) {
      if (typeof target !== "string" || !target || !isPage(target)) return;
      if (linked.indexOf(target) === -1) linked.push(target);
    },
    // `from` is the linking page's folder and `target` the real path of the
    // file linked. A served folder the page sits inside (the site root, or the
    // mount it is read through) is its own. Null when the link is refused, and
    // `refused` says why: a registry that does not follow links refuses every
    // folder that is not its own, and a render that has named FILE_LIMIT files
    // refuses the next. The file count includes files named before, so a page
    // past the limit stays past it however often it renders.
    add: function (dir, from, target) {
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
      if (!follow && !own) { refused = "no-follow"; return null; }
      if (typeof target === "string" && !this.name(target)) return null;
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
  if (!registry || typeof registry.note !== "function") return true;
  var real;
  try { real = fs.realpathSync.native(candidate); } catch (err) { return true; }
  var realRoot;
  try { realRoot = fs.realpathSync.native(root); } catch (err) { return true; }
  if (!within(real, realRoot)) return true;
  try { if (!fs.statSync(real).isFile()) return true; } catch (err) { return true; }
  if (isSecretPath(real)) return true;
  if (typeof registry.nameOwn === "function" && !registry.nameOwn(real)) return false;
  registry.note(real);
  return true;
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
      if (!noteRelative(candidate, root, registry)) return { kind: "inert", target: candidate, reason: "too-many" };
      return { kind: "relative" };
    }
  }
  var home = homeRoot();
  var real;
  try { real = fs.realpathSync.native(candidate); } catch (err) {
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
  if (isSecretPath(real)) return { kind: "inert", target: candidate, reason: "secret" };
  var dir = path.dirname(real);
  if (!mountableDir(dir)) return { kind: "inert", target: candidate, reason: "outside-home" };
  var prefix = registry ? registry.add(dir, root, real) : mountPrefix(dir);
  if (!prefix) return { kind: "inert", target: candidate, reason: registry.refused || "no-follow" };
  if (registry && typeof registry.note === "function") registry.note(real);
  return {
    kind: "translate",
    url: prefix + encodeURIComponent(path.basename(real)) + split.suffix,
    dir: dir,
    target: real
  };
}

module.exports = {
  FILE_LIMIT: FILE_LIMIT,
  SECRET_PATHS: SECRET_PATHS,
  isSecretPath: isSecretPath,
  MARKDOWN_EXTENSIONS: MARKDOWN_EXTENSIONS,
  isPage: isPage,
  homeRoot: homeRoot,
  mountPrefix: mountPrefix,
  mountableDir: mountableDir,
  createRegistry: createRegistry,
  ALLOWED_SCHEMES: ALLOWED_SCHEMES,
  classify: classify
};
