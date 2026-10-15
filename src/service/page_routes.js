// Pages served by the helper itself, at http://<name>.lahe.localhost:<port>/<path>.
//
// Architecture: docs/features/20261011.02_stable_addresses/02_architecture_stable_addresses.md,
// "Serving a request" and "Which review answers on a page". A SITE (sites.js)
// is what one page server served before: one root folder, or one notes page.
// Paths under a site are the paths that page server used, so every link,
// image and recorded page path keeps working; only the origin changes.
//
// THE SERVING HALF OF static_servers.js LIVES HERE. The pieces both need while
// page servers still exist (the script tag, the MIME table, the library path)
// are defined here and static_servers.js reads them from this file.
//
// A GET NEVER MAKES A NAME AND NEVER CHANGES A REVIEW. The only thing a request
// may write is the site's own mount and linked-file tables, when a rendered
// Markdown page links to a new folder: the same thing a page server wrote to
// its own record before.
//
// Node-only.

"use strict";

var fs = require("node:fs");
var stream = require("node:stream");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var record = require("../shared/record.js");
var scriptLine = require("../shared/script_line.js");
var stateDir = require("./state_dir.js");
var markdown = require("./markdown.js");
var markdownLinks = require("./markdown_links.js");
var styles = require("./styles.js");
var tabIcon = require("./tab_icon.js");
var heal = require("./heal.js");
var logModule = require("./log.js");
var staticServers = require("./static_servers.js");

var MOUNT_ROOT = "/.lahe-source/";
var LIBRARY_PREFIX = "/.lahe-library/";
var LIBRARY_PATH = LIBRARY_PREFIX + heal.BUNDLE_BASENAME;

var MIME = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff2": "font/woff2"
};

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { return null; }
}

// .native, as site.bind and the Library make roots: it returns the case on
// disk, so two spellings of one folder on a case-insensitive disk compare equal.
function realOrNull(target) {
  try { return fs.realpathSync.native(target); } catch (err) { return null; }
}

function within(candidate, base) {
  return candidate === base || candidate.indexOf(base + path.sep) === 0;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------------------------------------------------------------------------
// The script tag, shared with static_servers.js until page servers retire
// ---------------------------------------------------------------------------

/** The helper's own origin, read fresh off service.json so a custom `--port` is honored. */
function currentHelperOrigin(dir) {
  var ready = readJson(stateDir.readyPath(dir));
  var port = ready && typeof ready.port === "number" ? ready.port : protocol.DEFAULT_PORT;
  return "http://" + protocol.DEFAULT_HOST + ":" + port;
}

/**
 * `html`, with `match`'s script tag put in if it is missing, or `null` when
 * nothing needs to change: the tag is already this review's, or a DIFFERENT
 * review's tag is present and is left alone on purpose, exactly as heal.js does.
 *
 * THE LIBRARY COMES FROM THE PAGE'S OWN SERVER, and the helper is the fallback.
 * A root-absolute path resolves back to whatever served the page, which cannot
 * be down: it just answered. Nothing is written into the reviewer's folder.
 */
// One capped note logger per state folder, for the "not injecting" line.
var notInjecting = new Map();

function notInjectingNotes(dir) {
  var key = dirKey(dir);
  var held = notInjecting.get(key);
  if (held) return held;
  var log;
  try { log = logModule.createEventLog({ dir: dir }); } catch (err) { log = null; }
  held = logModule.createNoteOnce(log, "pages: further not-injecting notes are not logged until the helper restarts");
  notInjecting.set(key, held);
  return held;
}

function injectForMatch(dir, match, target, html, aliases, pathAliases, spellings) {
  var carried = scriptLine.reviewAlreadyInFile(html);
  if (carried === match.review) return null;
  if (carried) {
    // Once per review, file and carried review, and capped: a page's image
    // requests can ask for this file again and again.
    notInjectingNotes(dir).say(match.review + "\u0000" + target + "\u0000" + carried,
      "review " + match.review + ": not injecting at serve time into " + target +
        ", it carries review " + carried + " now, so it was re-attached somewhere else on purpose");
    return null;
  }
  var helperOrigin = currentHelperOrigin(dir);
  var tag = protocol.scriptTag({
    src: LIBRARY_PATH,
    review: match.review,
    token: match.token,
    helper: helperOrigin,
    fallback: helperOrigin + protocol.route("library.get").path,
    // pickReview carries the notes flag from the meta.json it already read.
    notes: typeof match.notes === "boolean" ? match.notes : stateDir.isNotesReview(dir, match.review),
    aliases: Array.isArray(aliases) && aliases.length ? aliases : undefined,
    // Only with an old origin: a path alias alone is never read (samePage).
    pathAliases: Array.isArray(aliases) && aliases.length && Array.isArray(pathAliases) && pathAliases.length ? pathAliases : undefined,
    spellings: Array.isArray(spellings) && spellings.length ? spellings : undefined
  });
  return scriptLine.placeScriptLine(html, tag).html;
}

/** `html` with a visible note placed just inside <body>, or at the top. */
function placeNote(html, note) {
  var text = String(html);
  var body = text.match(/<body\b[^>]*>/i);
  if (!body) return note + text;
  var at = body.index + body[0].length;
  return text.slice(0, at) + note + text.slice(at);
}

// ---------------------------------------------------------------------------
// Which review answers on a page
// ---------------------------------------------------------------------------

/**
 * The folder a review of `target` is served out of: the folder itself for a
 * folder review, the page's own folder for a single page. Null when the target
 * is not on disk any more.
 */
function servedFrom(target) {
  if (typeof target !== "string" || !target) return null;
  try {
    if (fs.statSync(target).isDirectory()) return target;
  } catch (err) {
    return null;
  }
  return path.dirname(target);
}

/** Newer wins; the id breaks a tie, so the same request always picks the same way. */
function newer(candidate, best) {
  if (!best) return true;
  if (candidate.at !== best.at) return candidate.at > best.at;
  return candidate.review > best.review;
}

function targetsOf(meta) {
  var targets = Array.isArray(meta.target_paths) ? meta.target_paths.slice() : [];
  if (typeof meta.target_path === "string" && meta.target_path && targets.indexOf(meta.target_path) === -1) {
    targets.push(meta.target_path);
  }
  return targets;
}

/**
 * The files a review recorded, as its pages: its targets, and the Markdown
 * source of a Markdown review, which is the page a site serves for it.
 */
function recordedFiles(meta) {
  return targetsOf(meta).concat(markdownSourcesOf(meta));
}

/**
 * Every Markdown source a review renders: source_path, and the rest of
 * source_paths (a review can hold more than one, reviews.recordPaths).
 */
function markdownSourcesOf(meta) {
  var out = [];
  var all = [meta && meta.source_path].concat(meta && Array.isArray(meta.source_paths) ? meta.source_paths : []);
  all.forEach(function (one) {
    if (typeof one === "string" && one && markdown.isMarkdown(one) && out.indexOf(one) === -1) out.push(one);
  });
  return out;
}

/** "Newest" is created or re-served most recently (site.bind stamps served_at). */
function stampOf(meta) {
  var created = typeof meta.created_at === "string" ? meta.created_at : "";
  var served = typeof meta.served_at === "string" ? meta.served_at : "";
  return served > created ? served : created;
}

/** Does a recorded file name the same file as one of the request's paths? */
function recordsFile(files, filePaths, realFile) {
  var base = realFile ? path.basename(realFile) : null;
  return files.some(function (file) {
    if (filePaths.indexOf(file) !== -1) return true;
    // A target is recorded with path.resolve, never a realpath, so a symlinked
    // folder (the macOS temp dir) spells it differently. Only same-named files
    // are resolved, so the cost stays one realpath per likely match.
    return !!realFile && path.basename(file) === base && realOrNull(file) === realFile;
  });
}

/** The folder a review's pages are served out of, as a real path, or null. */
function servedRootsOf(meta) {
  var sources = markdownSourcesOf(meta);
  if (sources.length) {
    return sources.map(function (one) { return realOrNull(path.dirname(one)); }).filter(Boolean);
  }
  return targetsOf(meta).map(function (target) {
    var from = servedFrom(target);
    return from ? realOrNull(from) : null;
  }).filter(Boolean);
}

// Parsed meta.json files, per state folder, by review id, with the file's
// time and size when it was read. A page load stats each file and reads only
// one that changed. Not the helper's in-memory reviews: `lahe add` writes
// meta.json from its own process (a reused review gains a page there), so the
// helper's copy can be behind, and the file is the answer.
var metaCache = new Map();

function readReviews(dir) {
  var root;
  try { root = stateDir.reviewsRoot(dir); } catch (err) { return []; }
  var entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (err) { return []; }
  var key = dirKey(dir);
  var before = metaCache.get(key) || new Map();
  var kept = new Map();
  var out = [];
  entries.forEach(function (entry) {
    if (!entry.isDirectory() || !protocol.isSafeId(entry.name)) return;
    var file = stateDir.metaPath(dir, entry.name);
    var stat;
    try { stat = fs.statSync(file); } catch (err) { return; }
    var held = before.get(entry.name);
    var meta;
    if (held && held.mtimeMs === stat.mtimeMs && held.size === stat.size && held.ino === stat.ino) {
      meta = held.meta;
    } else {
      meta = readJson(file);
    }
    kept.set(entry.name, { mtimeMs: stat.mtimeMs, size: stat.size, ino: stat.ino, meta: meta });
    if (!meta || typeof meta.token !== "string") return;
    out.push({ id: entry.name, meta: meta });
  });
  metaCache.set(key, kept);
  return out;
}

/**
 * The review that answers on a page of `site`, or null for read-only.
 *
 * Today's rule, without the session filter:
 *  1. a review that recorded this exact file, newest first;
 *  2. else the newest review whose served root is this site's root and that
 *     is not `--only`;
 *  3. else the newest review that linked to this file, not `--only`.
 *
 * A page under a mount is a linked document: only rule 3 applies to it, as
 * only the linking page's rail ever reached it before. A notes site answers
 * for its one page and nothing else, so only rule 1 applies.
 *
 * @param {string} dir the state folder
 * @param {object} site the registry entry
 * @param {{filePaths: string[], realFile: string|null, mounted: boolean}} request
 * @returns {{review: string, token: string, notes: boolean, source_path: (string|null), targets: string[]}|null}
 */
function pickReview(dir, site, request) {
  var filePaths = request.filePaths || [];
  var realFile = request.realFile || null;
  var linkedIds = realFile && site.linked_files && Array.isArray(site.linked_files[realFile])
    ? site.linked_files[realFile]
    : [];
  var recordedList = [];
  var movedIds = [];
  var backing = null;
  var linking = null;
  // A FILE WHOSE WORKTREE IS GONE (spec 20261015.01 R6): a review that
  // recorded the worktree's file is rule 1 for its main copy. The moves are
  // read only when this file sits under a gone worktree's twin root.
  var registry = null;
  var moves = [];
  if (!request.mounted && realFile) {
    registry = activeFor(dir) || registryEntry(dir);
    moves = movesIn(registry);
    if (!underATwin(moves, realFile)) moves = [];
  }
  readReviews(dir).forEach(function (entry) {
    var meta = entry.meta;
    // A retired review answers on no page.
    if (typeof meta.retired_at === "string") return;
    var candidate = {
      review: entry.id,
      token: meta.token,
      at: stampOf(meta),
      notes: meta.notes === true,
      source_path: typeof meta.source_path === "string" ? meta.source_path : null,
      source_paths: markdownSourcesOf(meta),
      targets: targetsOf(meta),
      meta: meta
    };
    var only = meta.only_recorded_pages === true;
    var moved = moves.length > 0 && recordedThroughMove(meta, realFile, moves, registry.stateDir);
    if (moved) movedIds.push(entry.id);
    if (!request.mounted && (moved || recordsFile(recordedFiles(meta), filePaths, realFile))) {
      recordedList.push(candidate);
      return;
    }
    if (only) return;
    if (!request.mounted && site.mode === "folder" && servedRootsOf(meta).indexOf(site.root) !== -1) {
      if (newer(candidate, backing)) backing = candidate;
      return;
    }
    if (site.mode === "folder" && linkedIds.indexOf(entry.id) !== -1 && newer(candidate, linking)) linking = candidate;
  });
  var recorded = recordedList.length
    ? tierOneWinner(dir, registry || activeFor(dir) || registryEntry(dir), realFile, recordedList, movedIds)
    : null;
  var best = recorded || backing || linking;
  if (!best) return null;
  return { review: best.review, token: best.token, notes: best.notes, source_path: best.source_path, source_paths: best.source_paths, targets: best.targets };
}

/** The newest of `list` by `newer` (served or created time, then id). */
function newestIn(list) {
  var best = null;
  list.forEach(function (one) { if (newer(one, best)) best = one; });
  return best;
}

/**
 * R8: a direct review and a moved review on one file are both tier 1. When a
 * review that reached this file through a move is among them, the newest one
 * that holds committed comments on the file wins, and only with none holding
 * any does the newest win. So re-stamping an empty review never takes the
 * page from one with comments. With no moved candidate, the newest wins as it
 * always has. holderOfFile and pickReview both ask here, so `lahe review`,
 * Library Open and the page agree.
 *
 * @param {{review: string, at: string, meta: object}[]} list
 * @param {string[]} movedIds the candidates that came through a move
 * @returns {object|null} the winning candidate, with `ruled` set when the rule
 *   chose it over the plain newest
 */
function tierOneWinner(dir, entry, file, list, movedIds) {
  var top = newestIn(list);
  if (!movedIds.length || !file) return top;
  var holding = list.filter(function (one) {
    return holdsRecordOn(dir, entry, Object.assign({ id: one.review }, one.meta), file);
  });
  var winner = holding.length ? newestIn(holding) : top;
  if (winner !== top) winner = Object.assign({}, winner, { ruled: true });
  return winner;
}

/**
 * Could the rule above ever pick `review` for a page of `site`? This is the
 * Origin check for a page request: a site's origin is accepted for a review
 * only when that review answers somewhere on that site.
 *
 * @param {object} site the registry entry
 * @param {{target_path?: string, target_paths?: string[], source_path?: string,
 *          only_recorded_pages?: boolean, id: string}} review
 */
function reviewAnswersOnSite(site, review, movesFn) {
  if (!site || !review) return false;
  if (typeof review.retired_at === "string") return false;
  var files = recordedFiles(review);
  var root = site.root;
  function here(real) {
    return site.mode === "page-only" ? real === root : within(real, root);
  }
  var recordedHere = files.some(function (file) {
    return here(realOrNull(file) || path.resolve(file));
  });
  if (recordedHere) return true;
  // A recorded file whose worktree is gone answers at its main copy (spec
  // 20261015.01 R6). Asked only when the direct match fails.
  if (typeof movesFn === "function") {
    var asked = movesFn();
    var moves = asked && Array.isArray(asked.moves) ? asked.moves : [];
    if (moves.length && files.some(function (file) {
      var copy = translated(moves, file, asked.stateDir);
      return !!copy && here(copy);
    })) return true;
  }
  if (site.mode !== "folder" || review.only_recorded_pages === true) return false;
  if (servedRootsOf(review).indexOf(root) !== -1) return true;
  var linked = site.linked_files || {};
  return Object.keys(linked).some(function (file) {
    return Array.isArray(linked[file]) && linked[file].indexOf(review.id) !== -1;
  });
}

// ---------------------------------------------------------------------------
// One path rule: what a request path names under a site
// ---------------------------------------------------------------------------

/**
 * The decoded path a raw request path names, or null when the serving rules
 * refuse it: a raw "." or ".." segment, an encoded slash or backslash, a bad
 * escape, a NUL or a backslash after decoding. Hidden segments are judged by
 * the caller, because Lahe's own reserved files are dot-named.
 */
function decodePath(rawPath) {
  if (typeof rawPath !== "string" || rawPath.charAt(0) !== "/") return null;
  if (/%2f|%5c/i.test(rawPath)) return null;
  if (rawPath.split("/").some(function (s) { return s === "." || s === ".."; })) return null;
  var decoded;
  try { decoded = decodeURIComponent(rawPath); } catch (err) { return null; }
  if (decoded.indexOf("\0") !== -1 || decoded.indexOf("\\") !== -1) return null;
  return decoded;
}

/**
 * Where a decoded path lands under a site: the folder it is read from, the URL
 * prefix that folder is served at, the path under it, and whether it is a
 * mount. Null when the site serves nothing there. A notes site answers only
 * its one page. `rawPath` is the path as the browser sent it, for the one
 * rule that reads it: a mount is served under its literal prefix only.
 *
 * @returns {{base: string, prefix: string, relative: string, mounted: boolean, page: boolean}|null}
 */
function locate(site, decoded, rawPath) {
  if (decoded.indexOf(MOUNT_ROOT) === 0) {
    if (site.mode !== "folder" || String(rawPath).indexOf(MOUNT_ROOT) !== 0) return null;
    var mount = /^(\/\.lahe-source\/[a-f0-9]+\/)(.*)$/.exec(decoded);
    var mountDir = mount && site.mounts ? site.mounts[mount[1]] : null;
    if (typeof mountDir !== "string") return null;
    // A mount whose folder is not under home (by real path) serves nothing,
    // whatever sites.json holds.
    if (!markdownLinks.mountableDir(mountDir)) return null;
    return { base: mountDir, prefix: mount[1], relative: mount[2], mounted: true, page: false };
  }
  if (site.mode === "page-only") {
    if (decoded !== "/" + path.basename(site.root)) return null;
    return { base: path.dirname(site.root), prefix: "/", relative: path.basename(site.root), mounted: false, page: true };
  }
  var relative = decoded.split("/").filter(function (s) { return s.length > 0; }).join("/");
  return { base: site.root, prefix: "/", relative: relative, mounted: false, page: false };
}

/** The file a located path names: a folder, or a trailing slash, is its index. */
function candidateOf(where, decoded) {
  var candidate = path.resolve(where.base, where.relative || "index.html");
  if (!within(candidate, where.base)) return null;
  if (decoded.charAt(decoded.length - 1) === "/" && where.relative) candidate = path.join(candidate, "index.html");
  try { if (fs.statSync(candidate).isDirectory()) candidate = path.join(candidate, "index.html"); } catch (err) { /* not there */ }
  return candidate;
}

// ---------------------------------------------------------------------------
// The registry, for the helper modules that map a page to a file
// ---------------------------------------------------------------------------
//
// HOW THE HELPER MODULES FIND THE REGISTRY. serve() puts its registry here,
// for its own state folder, once the pages port is bound, and takes it out on
// close. The healer, the reload check, rebuild, the handled check and the
// projection ask here by state folder; with no helper running in this process
// they map nothing to a site, and fall back to a review's recorded targets.

var active = Object.create(null);

function dirKey(dir) {
  return realOrNull(dir) || path.resolve(dir);
}

/** @param {{sites: object, pagesPort: number, laheNames?: function(): boolean}} entry */
function activate(dir, entry) {
  if (entry && !entry.stateDir) entry.stateDir = dirKey(dir);
  active[dirKey(dir)] = entry;
}

function deactivate(dir) {
  delete active[dirKey(dir)];
}

/** The registry a helper in this process holds for a state folder, or null. */
function activeFor(dir) {
  if (typeof dir !== "string" || !dir) return null;
  return active[dirKey(dir)] || null;
}

/** The site an existing file is served under, or null. Mounts count. */
function siteForFile(sites, file) {
  var real = realOrNull(file) || path.resolve(file);
  var found = null;
  sites.list().some(function (entry) {
    var site = entry.site;
    var covered = site.mode === "page-only"
      ? real === site.root
      : within(real, site.root) || Object.keys(site.mounts || {}).some(function (prefix) {
        return within(real, site.mounts[prefix]);
      });
    if (covered) found = entry;
    return covered;
  });
  return found;
}

/**
 * Is this file served by a site right now? The healer asks before it writes a
 * script line into a file: a served page gets its line in the response.
 */
function servesFile(dir, file) {
  var entry = activeFor(dir);
  return !!entry && typeof file === "string" && !!siteForFile(entry.sites, file);
}

/**
 * The file a page on a site is, from its origin and path, or null. The same
 * rules the server applies to the request, so the helper names exactly the
 * file the browser was shown. The file may be gone; the caller stats it.
 */
function fileForPage(dir, origin, pagePath) {
  return fileForPageIn(activeFor(dir), origin, pagePath);
}

function fileForPageIn(entry, origin, pagePath) {
  if (!entry) return null;
  var name = protocol.siteNameFromOrigin(origin, entry.pagesPort, typeof entry.laheNames === "function" && entry.laheNames());
  var site = name ? entry.sites.get(name) : null;
  var decoded = site ? decodePath(String(pagePath || "")) : null;
  var where = decoded !== null ? locate(site, decoded, pagePath) : null;
  if (!where) return null;
  var candidate = where.page ? site.root : candidateOf(where, decoded);
  if (!candidate) return null;
  var real = realOrNull(candidate);
  if (!real) {
    // A FILE WHOSE WORKTREE IS GONE names its main-checkout copy (spec
    // 20261015.01 R5): the one seam records, the handled check and the reload
    // check share, so a comment made at the old address is about the copy.
    var copy = where.mounted ? null : movedCopyOnSite(entry, site, candidate);
    return copy || candidate;
  }
  if (where.page) return site.root;
  var realBase = realOrNull(where.base);
  return realBase && within(real, realBase) ? real : null;
}

/**
 * The real file a linked page names, for an item made on it by `reviewId`, or
 * null: a page under one of a site's mounts that this review linked to.
 */
function linkedFileForPage(dir, reviewId, pagePath) {
  return linkedFileIn(activeFor(dir), reviewId, pagePath);
}

function linkedFileIn(entry, reviewId, pagePath) {
  if (!entry || typeof pagePath !== "string" || pagePath.indexOf(MOUNT_ROOT) !== 0) return null;
  var decoded = decodePath(pagePath);
  if (decoded === null) return null;
  var found = null;
  entry.sites.list().some(function (item) {
    var where = locate(item.site, decoded, pagePath);
    if (!where || !where.mounted) return false;
    var candidate = candidateOf(where, decoded);
    var real = candidate ? realOrNull(candidate) : null;
    var base = realOrNull(where.base);
    if (!real || !base || !within(real, base) || !markdownLinks.isPage(real)) return false;
    var ids = item.site.linked_files && item.site.linked_files[real];
    if (!Array.isArray(ids) || ids.indexOf(reviewId) === -1) return false;
    found = real;
    return true;
  });
  return found;
}

// ---------------------------------------------------------------------------
// Which file a record was made on, and which review a file has
// ---------------------------------------------------------------------------
//
// ONE REVIEW PER FILE (docs/features/20261011.02_stable_addresses/parts/
// architecture/each_page_its_own_comments.md). `lahe review` runs in its own
// process, so these work from the registry on disk when no helper in this
// process has activated one.

/** The registry for `dir`: the helper's own, or a read-only one off disk. */
function registryEntry(dir) {
  var entry = activeFor(dir);
  if (entry) return entry;
  var sitesModule = require("./sites.js");
  var sites = sitesModule.createSites({ dir: dir, reader: true });
  sites.load();
  var ready = readJson(stateDir.readyPath(dir));
  var pages = ready && ready.pages ? ready.pages : null;
  return {
    sites: sites,
    stateDir: dirKey(dir),
    pagesPort: pages && Number.isInteger(pages.port) ? pages.port : protocol.PAGES.PORT,
    laheNames: function () { return !!(pages && pages.lahe_names && pages.lahe_names.verified === true); },
    transient: true
  };
}

// ---------------------------------------------------------------------------
// A document whose worktree is gone (spec 20261015.01)
// ---------------------------------------------------------------------------
//
// THE ONE RULE (R1 to R4). When a worktree is removed, a file served from it
// is the same document as the file at the same path in its main checkout. The
// trusted pair is the registry's: a site saves its worktree root, its admin
// folder and its main checkout's real path when it is bound (sites.worktreeOf,
// checked against git's back-link then). At use:
//
//   - gone: the worktree root is not on disk, and git agrees (its admin folder
//     is missing, or names a .git file that is not there). A moved worktree is
//     not gone.
//   - the main checkout's real path is still the saved one, its .git is a
//     folder, it is inside the home folder and outside the state folder;
//   - the twin root (the main checkout plus the site root's path inside the
//     worktree) is inside the main checkout by real path;
//   - the copy is under the twin root by real path, a regular file, and
//     outside the state folder.
//
// Each check that compares paths asks here: fileForPageIn, holderOfFile,
// pickReview, ownReviewOf, reviewAnswersOnSite, the read-only fallback and the
// Library. Nothing here writes, and nothing reads page text except the
// recorded paths it is asked to translate, which never leave a site's root.

// The checks past "the root is not on disk" cost a few stats and a realpath
// each. A gone worktree stays gone, so they are kept a short while per site;
// the root's own stat is made on every ask, so a worktree that comes back is
// seen at once.
var MOVE_KEEP_MS = 10000;
var moveCache = new Map();

function homeReal() {
  var home = markdownLinks.homeRoot();
  return realOrNull(home) || path.resolve(home);
}

/** The worktree's admin folder: saved at bind, or found for a site bound before it was saved. */
function adminFolderOf(site) {
  if (typeof site.worktree_admin === "string" && site.worktree_admin) return site.worktree_admin;
  var base = path.join(site.main_checkout, ".git", "worktrees");
  var wanted = path.join(site.worktree_root, ".git");
  var names = [];
  try { names = fs.readdirSync(base); } catch (err) { names = []; }
  for (var i = 0; i < names.length; i += 1) {
    var text = "";
    try { text = fs.readFileSync(path.join(base, names[i], "gitdir"), "utf8").trim(); } catch (err) { text = ""; }
    if (text && path.resolve(base, names[i], text) === wanted) return path.join(base, names[i]);
  }
  return path.join(base, path.basename(site.worktree_root));
}

/** Does git agree the worktree is gone? Called only once its root is not on disk. */
function gitSaysGone(site) {
  var admin = adminFolderOf(site);
  var text;
  try { text = fs.readFileSync(path.join(admin, "gitdir"), "utf8").trim(); } catch (err) { return true; }
  if (!text) return true;
  return !fs.existsSync(path.resolve(admin, text));
}

/** The checks of R1 and R2 for one site, past its root's stat. {twin} or null. */
function checkMove(stateReal, site) {
  if (!gitSaysGone(site)) return null;
  var main = site.main_checkout;
  var realMain = realOrNull(main);
  if (!realMain || realMain !== main) return null;
  try { if (!fs.statSync(path.join(realMain, ".git")).isDirectory()) return null; } catch (err) { return null; }
  var home = homeReal();
  if (realMain === home || !within(realMain, home)) return null;
  if (within(realMain, stateReal)) return null;
  var rel = path.relative(site.worktree_root, site.root);
  if (rel === ".." || rel.indexOf(".." + path.sep) === 0 || path.isAbsolute(rel)) return null;
  var realTwin = realOrNull(rel ? path.join(realMain, rel) : realMain);
  if (!realTwin || !within(realTwin, realMain) || within(realTwin, stateReal)) return null;
  var stat;
  try { stat = fs.statSync(realTwin); } catch (err) { return null; }
  if (site.mode === "page-only" ? !stat.isFile() : !stat.isDirectory()) return null;
  return { twin: realTwin };
}

/**
 * The move for one site, or null: {site, root, twin}. One stat when the
 * worktree is still there; the rest is kept for MOVE_KEEP_MS.
 */
// ONE ROOT CHECK PER REQUEST (R14). A page load asks about the same worktree
// roots from several places (the review pick, its R8 rule, each record's
// file); the answer is kept until the event loop turns, which is the end of
// the request's synchronous work.
var rootMemo = null;

function rootOnDisk(root) {
  if (!rootMemo) {
    rootMemo = new Map();
    var clear = setImmediate(function () { rootMemo = null; });
    if (clear && typeof clear.unref === "function") clear.unref();
  }
  if (rootMemo.has(root)) return rootMemo.get(root);
  var there = fs.existsSync(root);
  rootMemo.set(root, there);
  return there;
}

function siteMove(stateReal, site) {
  if (!site || typeof site.worktree_root !== "string" || typeof site.main_checkout !== "string") return null;
  if (!site.worktree_root || !site.main_checkout) return null;
  if (rootOnDisk(site.worktree_root)) return null;
  var key = stateReal + "\u0000" + site.root + "\u0000" + site.mode + "\u0000" + site.worktree_root + "\u0000" + site.main_checkout;
  var now = Date.now();
  var held = moveCache.get(key);
  var checked;
  if (held && now - held.at < MOVE_KEEP_MS) {
    checked = held.checked;
  } else {
    checked = checkMove(stateReal, site);
    moveCache.set(key, { at: now, checked: checked });
    if (moveCache.size > 512) moveCache.delete(moveCache.keys().next().value);
  }
  return checked ? { site: site, root: site.root, twin: checked.twin } : null;
}

/** Every site whose worktree is gone, for one request: one root stat per worktree site. */
function movesIn(entry) {
  if (!entry) return [];
  var stateReal = entry.stateDir || null;
  if (!stateReal) return [];
  var out = [];
  entry.sites.list().forEach(function (item) {
    var move = siteMove(stateReal, item.site);
    if (move) out.push(move);
  });
  return out;
}

/** The moves for a state folder: the helper's registry, or one read off disk. */
function movesOf(dir) {
  return movesIn(registryEntry(dir));
}

/** The main copy of `file` through one move, or null (R3). */
function copyThrough(move, file, stateReal) {
  if (typeof file !== "string" || !file) return null;
  var site = move.site;
  var rel;
  if (site.mode === "page-only") {
    if (file !== site.root) return null;
    rel = "";
  } else {
    if (file === site.root || !within(file, site.root)) return null;
    rel = path.relative(site.root, file);
  }
  var real = realOrNull(rel ? path.join(move.twin, rel) : move.twin);
  if (!real || !within(real, move.twin) || (stateReal && within(real, stateReal))) return null;
  try { if (!fs.statSync(real).isFile()) return null; } catch (err) { return null; }
  return real;
}

/** The main copy of a gone worktree file, through any of `moves`, or null. */
function copyAmong(moves, file, stateReal) {
  for (var i = 0; i < moves.length; i += 1) {
    var copy = copyThrough(moves[i], file, stateReal);
    if (copy) return copy;
  }
  return null;
}

/** The main copy of a gone file on this one site, or null. */
function movedCopyOnSite(entry, site, file) {
  var stateReal = entry && entry.stateDir;
  if (!stateReal) return null;
  var move = siteMove(stateReal, site);
  return move ? copyThrough(move, file, stateReal) : null;
}

/** The main copy of a gone worktree file, or null. Exported for the Library and tests. */
function movedCopyOf(dir, file) {
  var entry = registryEntry(dir);
  return copyAmong(movesIn(entry), file, entry.stateDir);
}

/**
 * Where a gone worktree file lives now, for the Library (R13): the copy, the
 * twin root it sits under, and the old site's mode. Null when it has not moved.
 *
 * @returns {{copy: string, twin: string, mode: string}|null}
 */
function movedPlace(dir, file) {
  var entry = registryEntry(dir);
  var moves = movesIn(entry);
  for (var i = 0; i < moves.length; i += 1) {
    var copy = copyThrough(moves[i], typeof file === "string" ? path.resolve(file) : file, entry.stateDir);
    if (copy) return { copy: copy, twin: moves[i].twin, mode: moves[i].site.mode };
  }
  return null;
}

/** Is `file` under any move's twin root? The cheap test before any review is read. */
function underATwin(moves, file) {
  return moves.some(function (move) {
    return move.site.mode === "page-only" ? file === move.twin : within(file, move.twin);
  });
}

/** Is `file` under a gone site's own root? A string test: no disk is read (R14). */
function underAGoneRoot(moves, file) {
  return moves.some(function (move) {
    return move.site.mode === "page-only" ? file === move.root : file !== move.root && within(file, move.root);
  });
}

/**
 * The main copy of a recorded path, or null. Only a path under a gone site's
 * root is looked at on disk, so a pass over every review stats only the files
 * that could have moved (R14).
 */
function translated(moves, one, stateReal) {
  if (typeof one !== "string" || !one) return null;
  var resolved = path.resolve(one);
  if (!underAGoneRoot(moves, resolved) || fs.existsSync(resolved)) return null;
  return copyAmong(moves, resolved, stateReal);
}

/** Did this review record a gone worktree file whose main copy is `target`? */
function recordedThroughMove(meta, target, moves, stateReal) {
  return recordedFiles(meta).some(function (one) {
    return translated(moves, one, stateReal) === target;
  });
}

/** The moves and the state folder they were judged against, for the Origin check. */
function movesFor(dir) {
  var entry = activeFor(dir) || registryEntry(dir);
  return { moves: movesIn(entry), stateDir: entry.stateDir };
}

/** A review's committed records (drafts never count), off the helper's fold or off disk. */
function committedRecords(dir, entry, reviewId) {
  var items = null;
  if (entry && typeof entry.items === "function") {
    try { items = entry.items(reviewId); } catch (err) { items = null; }
  }
  if (!items) {
    var projection = require("./projection.js");
    try { items = projection.itemsFrom(logModule.createEventLog({ dir: dir }).read(reviewId)); } catch (err) { items = []; }
  }
  return (items || []).filter(function (item) { return item && !record.isDraft(item); });
}

/**
 * The real file `item` was made on, for `review`, or null when it cannot be
 * told: at a site address (its own path, or a link address under a mount this
 * review linked), or at an old 127.0.0.1:<port> address (through the helper's
 * own page-server records, and an old Markdown review's rendered path).
 */
function fileOfItem(dir, entry, review, item) {
  var origin = item && item[record.FIELD.PAGE_ORIGIN];
  var pagePath = item && item[record.FIELD.PAGE_PATH];
  if (typeof origin !== "string" || typeof pagePath !== "string" || pagePath.charAt(0) !== "/") return null;
  if (pagePath.indexOf(MOUNT_ROOT) === 0) return linkedFileIn(entry, review.id, pagePath);
  var onSite = fileForPageIn(entry, origin, pagePath);
  if (onSite) return realOrNull(onSite) || onSite;
  if (!protocol.isLoopbackPortOrigin(origin)) return null;
  var sources = markdownSourcesOf(review);
  if (sources.length) {
    var rendered = targetsOf(review).some(function (target) {
      return /\.html?$/i.test(target) && "/" + path.basename(target) === pagePath;
    });
    if (rendered) {
      // The source whose artifact this was, when the session can say; else the first.
      var session = typeof review.agent_session_id === "string" ? review.agent_session_id : null;
      var named = null;
      if (session) {
        sources.some(function (one) {
          var artifact = null;
          try { artifact = markdown.artifactPath(dir, session, one); } catch (err) { artifact = null; }
          if (artifact && "/" + path.basename(artifact) === pagePath) { named = one; return true; }
          return false;
        });
      }
      var chosen = named || sources[0];
      return realOrNull(chosen) || path.resolve(chosen);
    }
  }
  var port = Number(origin.slice(origin.lastIndexOf(":") + 1));
  var decoded = decodePath(pagePath);
  if (decoded === null) return null;
  var relative = decoded.split("/").filter(function (seg) { return seg.length > 0; }).join("/");
  var records = entry && !entry.transient ? oldServerRecords(dir) : readOldServerRecords(dir);
  // Only page servers that served THIS review's own folders: ports were reused
  // across page servers, so another review's old server on the same port is a
  // different file.
  var ownRoots = servedRootsOf(review).concat(targetsOf(review).map(function (target) {
    return realOrNull(path.dirname(target));
  })).filter(Boolean);
  var found = null;
  records.some(function (rec) {
    if (rec.ports.indexOf(port) === -1 || typeof rec.root !== "string") return false;
    if (ownRoots.indexOf(realOrNull(rec.root) || rec.root) === -1) return false;
    var candidate = path.resolve(rec.root, relative || "index.html");
    if (!within(candidate, rec.root)) return false;
    var real = realOrNull(candidate);
    if (!real || !within(real, realOrNull(rec.root) || rec.root)) return false;
    found = real;
    return true;
  });
  return found;
}

/**
 * The link address where `reviewId`'s rail answers for `file`: a site whose
 * link table lists the review for the file and that mounts the file's folder.
 * Null when there is none.
 *
 * @returns {{name: string, path: string}|null}
 */
function linkAddressFor(dir, reviewId, file) {
  var target = realOrNull(file) || path.resolve(file);
  var entry = registryEntry(dir);
  var found = null;
  entry.sites.list().some(function (each) {
    var ids = each.site.linked_files && each.site.linked_files[target];
    if (!Array.isArray(ids) || ids.indexOf(reviewId) === -1) return false;
    var mounts = each.site.mounts || {};
    return Object.keys(mounts).some(function (prefix) {
      if ((realOrNull(mounts[prefix]) || mounts[prefix]) !== path.dirname(target)) return false;
      found = { name: each.name, path: prefix + encodeURIComponent(path.basename(target)) };
      return true;
    });
  });
  return found;
}

/** Does `review` hold a committed record on `file`? */
function holdsRecordOn(dir, entry, review, file) {
  return committedRecords(dir, entry, review.id).some(function (item) {
    return fileOfItem(dir, entry, review, item) === file;
  });
}

/**
 * The file's tier-1 review, or null: one that recorded this file, or (spec
 * 20261015.01) recorded it in a worktree that is gone. R8 picks between them.
 *
 * @returns {{review: string, meta: object, tier: 1, moved: boolean, ruled: boolean}|null}
 *   `moved` when the winner reached the file only through a move, `ruled`
 *   when R8 chose it over the plain newest
 */
function tierOneOf(dir, entry, target, metas) {
  var moves = movesIn(entry);
  if (!underATwin(moves, target)) moves = [];
  var direct = [];
  var movedIds = [];
  var list = [];
  metas.forEach(function (each) {
    var isDirect = recordedFiles(each.meta).some(function (one) {
      return (realOrNull(one) || path.resolve(one)) === target;
    });
    var isMoved = moves.length > 0 && recordedThroughMove(each.meta, target, moves, entry.stateDir);
    if (!isDirect && !isMoved) return;
    if (isDirect) direct.push(each.id);
    if (isMoved) movedIds.push(each.id);
    list.push({ review: each.id, at: stampOf(each.meta), meta: each.meta });
  });
  if (!list.length) return null;
  var winner = tierOneWinner(dir, entry, target, list, movedIds);
  return {
    review: winner.review,
    meta: winner.meta,
    tier: 1,
    moved: direct.indexOf(winner.review) === -1,
    ruled: winner.ruled === true
  };
}

/**
 * The review a file has, or null: the one `lahe review` opens instead of
 * making a second (Part 1). Tiered, newest within a tier, retired reviews
 * never:
 *
 *   1. a review that recorded this file (its target, or a Markdown source);
 *   2. a folder review whose folder holds the file, not --only, that holds a
 *      committed comment on it;
 *   3. a review a site's link table lists for the file, that holds a committed
 *      comment on it.
 *
 * A link alone, or a broad folder review with nothing said about this file,
 * never claims it: the link table is written from page content on page views.
 *
 * @param {string} dir
 * @param {string} file a real path
 * @returns {{review: string, meta: object, tier: number}|null}
 */
function holderOfFile(dir, file) {
  var target = realOrNull(file) || path.resolve(file);
  var entry = registryEntry(dir);
  var metas = readReviews(dir).filter(function (each) { return typeof each.meta.retired_at !== "string"; });
  function newestOf(list, tier) {
    var best = null;
    list.forEach(function (each) {
      var at = stampOf(each.meta);
      if (!best || at > best.at) best = { review: each.id, meta: each.meta, tier: tier, at: at };
    });
    if (best) delete best.at;
    return best;
  }
  var tier1 = tierOneOf(dir, entry, target, metas);
  if (tier1) return tier1;
  function asReview(each) { return Object.assign({ id: each.id }, each.meta); }
  var tier2 = metas.filter(function (each) {
    if (each.meta.only_recorded_pages === true) return false;
    var holds = servedRootsOf(each.meta).some(function (root) { return within(target, root) && target !== root; });
    return holds && holdsRecordOn(dir, entry, asReview(each), target);
  });
  if (tier2.length) return newestOf(tier2, 2);
  var linking = {};
  entry.sites.list().forEach(function (item) {
    var ids = item.site.linked_files && item.site.linked_files[target];
    (Array.isArray(ids) ? ids : []).forEach(function (id) { linking[id] = true; });
  });
  var tier3 = metas.filter(function (each) {
    return linking[each.id] === true && holdsRecordOn(dir, entry, asReview(each), target);
  });
  if (tier3.length) return newestOf(tier3, 3);
  return null;
}

// ---------------------------------------------------------------------------
// The Markdown render, cached by file time
// ---------------------------------------------------------------------------
//
// ONE RENDER PER VERSION OF A SOURCE. The page a site serves, the reload
// check, rebuild and the handled check all read this, so the words an agent is
// judged against are the words the reviewer was shown. The key is the file's
// size and modification time plus everything else the render depends on.

var RENDER_CACHE_MAX = 64;
var renderCache = new Map();

/**
 * @param {string} file the Markdown source
 * @param {{assetPrefix: string, mounts: object, noFollow: boolean, note: string|null}} options
 *   `note` null is the read-only note; "" is none (a page under review)
 * @returns {{html: string, added: object[], linked: string[]}}
 */
function renderMarkdown(file, options) {
  var stat = fs.statSync(file);
  var mounts = options.mounts || {};
  var key = [file, stat.mtimeMs, stat.size, options.assetPrefix, options.noFollow ? 1 : 0,
    options.note === null ? "\u0001readonly" : options.note, JSON.stringify(mounts)].join("\u0000");
  var hit = renderCache.get(key);
  if (hit) {
    renderCache.delete(key);
    renderCache.set(key, hit);
    return hit;
  }
  var registry = markdownLinks.createRegistry({
    mounts: mounts,
    consumed: Object.keys(mounts),
    cap: options.noFollow ? 0 : undefined
  });
  var renderOptions = { assetPrefix: options.assetPrefix, links: registry, noFollow: !!options.noFollow };
  if (options.note === null) renderOptions.readOnlyNote = true;
  else renderOptions.note = options.note;
  var out = { html: markdown.render(file, renderOptions), added: registry.added.slice(), linked: registry.linked.slice() };
  renderCache.set(key, out);
  if (renderCache.size > RENDER_CACHE_MAX) renderCache.delete(renderCache.keys().next().value);
  return out;
}

/** The URL folder a file sits in under `base`, served at `prefix`. */
function urlDirOf(prefix, base, file) {
  var rel = path.relative(base, path.dirname(file));
  var segments = rel ? rel.split(path.sep).map(encodeURIComponent) : [];
  return prefix + segments.map(function (s) { return s + "/"; }).join("");
}

/**
 * Render a Markdown page of a site as it is served under review, and fold the
 * mounts its links need into the site. Shared by the server and by rebuild.
 */
function renderSitePage(sites, name, site, file, base, prefix) {
  var out = renderMarkdown(file, {
    assetPrefix: urlDirOf(prefix, base, file),
    mounts: site.mounts || {},
    noFollow: site.mode === "page-only",
    note: ""
  });
  if (out.added.length) {
    var added = {};
    out.added.forEach(function (entry) { added[entry.prefix] = entry.dir; });
    sites.addMounts(name, added);
  }
  return out;
}

/**
 * The page a Markdown source is shown as on its site, or null when no active
 * site serves it under its root. What rebuild and the handled check read.
 */
function renderForFile(dir, file) {
  var entry = activeFor(dir);
  var found = entry && markdown.isMarkdown(file) ? siteForFile(entry.sites, file) : null;
  if (!found) return null;
  var real = realOrNull(file);
  if (!real) return null;
  var site = found.site;
  var base = site.mode === "page-only" ? path.dirname(site.root) : site.root;
  if (!within(real, base)) return null;
  try {
    return renderSitePage(entry.sites, found.name, site, real, base, "/").html;
  } catch (err) {
    return null;
  }
}

/**
 * Record on its site that `reviewId`'s render of `file` links to `linked`.
 * Rebuild calls this after a re-render, so a link an agent just added carries
 * the rail the moment the reviewer follows it.
 */
function recordLinkedFor(dir, file, reviewId, linked) {
  var entry = activeFor(dir);
  var found = entry && linked && linked.length ? siteForFile(entry.sites, file) : null;
  if (found) entry.sites.addLinked(found.name, reviewId, linked);
}

// ---------------------------------------------------------------------------
// Aliases: the old page-server origins of a site's root
// ---------------------------------------------------------------------------
//
// A review created on a random port has comments whose page origin is
// http://127.0.0.1:<port>. The path is the same under the site, so an old
// origin is all an alias is. Computed by the helper, from its own page-server
// records, never from anything a page sends. At most ALIAS_MAX, newest first.

var ALIAS_MAX = 16;

function validPort(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 65536;
}

/** Every old page-server record in the state folder: [{root, ports, at}]. */
/**
 * The page servers from before stable addresses, as {root, ports, at}. Nothing
 * writes these records any more, so a running helper reads them once, on the
 * first page that asks, and keeps them on its registry entry.
 */
function oldServerRecords(dir) {
  var entry = activeFor(dir);
  if (!entry) return readOldServerRecords(dir);
  if (!entry.oldRecords) entry.oldRecords = readOldServerRecords(dir);
  return entry.oldRecords;
}

function readOldServerRecords(dir) {
  return staticServers.allRecords(dir).map(function (entry) {
    var meta = entry.meta;
    var ports = (Array.isArray(meta.ports) ? meta.ports : []).concat([meta.port]).filter(validPort);
    return { root: realOrNull(meta.root) || meta.root, ports: ports, at: String(meta.started_at || "") };
  });
}

/** The old origins of this site's root, newest port first, at most ALIAS_MAX. */
function aliasesFor(dir, site) {
  if (!site) return [];
  return originsOfRoots(dir, [site.root]);
}

/** The old origins of page servers that served any of `roots`, newest port first, at most ALIAS_MAX. */
function originsOfRoots(dir, roots) {
  var ports = [];
  oldServerRecords(dir)
    .filter(function (rec) { return roots.indexOf(rec.root) !== -1; })
    .sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; })
    .forEach(function (rec) {
      rec.ports.forEach(function (port) {
        var at = ports.indexOf(port);
        if (at !== -1) ports.splice(at, 1);
        ports.push(port);
      });
    });
  var out = [];
  ports.reverse().forEach(function (port) {
    if (out.length + 2 > ALIAS_MAX) return;
    out.push("http://" + protocol.DEFAULT_HOST + ":" + port, "http://localhost:" + port);
  });
  return out;
}

/**
 * Every old spelling of one page, for the review that answers on it (V31):
 * the old origins of its site's root and, for an old Markdown review whose
 * page was the rendered file, that file's old path and the origins of the
 * page server that served the rendered files' folder.
 *
 * @param {string} dir
 * @param {object} site the registry entry
 * @param {string|null} file the real file the page is
 * @param {{source_path?: string|null, targets?: string[]}|null} review
 * @returns {{origins: string[], paths: string[]}}
 */
function oldSpellings(dir, site, file, review) {
  if (!site) return { origins: [], paths: [] };
  var roots = [site.root];
  var paths = [];
  var isSource = !!review && !!file && markdownSourcesOf(review).some(function (one) {
    return (realOrNull(one) || path.resolve(one)) === file;
  });
  if (isSource) {
    (review.targets || []).forEach(function (target) {
      if (typeof target !== "string" || !/\.html?$/i.test(target)) return;
      var old = "/" + path.basename(target);
      if (protocol.isPathAlias(old) && paths.indexOf(old) === -1 && paths.length < protocol.ALIAS_MAX) paths.push(old);
      var folder = realOrNull(path.dirname(target));
      if (folder && roots.indexOf(folder) === -1) roots.push(folder);
    });
  }
  return { origins: originsOfRoots(dir, roots), paths: paths };
}

/**
 * The records the page at `origin` + `pagePath` shows (records.read).
 *
 * `records`: this review's committed records made on the page's file, under
 * any of its addresses: its own, a link address, an old 127.0.0.1 address
 * (fileOfItem, per review: old ports were reused). Never a draft.
 *
 * `others`: comments already split on disk (Part 3), read-only. From another
 * review, not retired, that holds a committed record on this file and either
 * answers on this site (the Origin check's own rule, reviewAnswersOnSite), or,
 * on the file's own site, is listed for the file in a link table. A review
 * that answers only through a link mount never counts on the linking site.
 * Each group carries a title and an agent's name, and a key that means
 * nothing outside this answer: no review id, no session id.
 *
 * An Origin that is not a site address gets nothing.
 *
 * @returns {{records: object[], others: {key: string, title: string, agent: string, records: object[]}[]}}
 */
function pageRecords(dir, review, origin, pagePath, items) {
  var none = { records: [], others: [] };
  var entry = activeFor(dir);
  if (!entry || typeof origin !== "string" || typeof pagePath !== "string" || pagePath.charAt(0) !== "/") return none;
  var name = protocol.siteNameFromOrigin(origin, entry.pagesPort, typeof entry.laheNames === "function" && entry.laheNames());
  var site = name ? entry.sites.get(name) : null;
  if (!site) return none;
  var found = fileForPage(dir, origin, pagePath);
  var file = found ? (realOrNull(found) || found) : null;
  var spellings = oldSpellings(dir, site, file, { source_path: review.source_path, source_paths: review.source_paths, targets: targetsOf(review) });
  var page = record.pageFrom(
    { origin: origin, pathname: pagePath, href: origin + pagePath },
    { seq: 1, aliases: spellings.origins, path_aliases: spellings.paths }
  );
  var mine = (items || []).filter(function (item) {
    if (!item || record.isDraft(item)) return false;
    if (record.samePage(item, page)) return true;
    return !!file && fileOfItem(dir, entry, review, item) === file;
  });
  if (!file) return { records: mine, others: [] };

  var mounted = pagePath.indexOf(MOUNT_ROOT) === 0;
  var linking = Object.create(null);
  if (!mounted) {
    entry.sites.list().forEach(function (each) {
      var ids = each.site.linked_files && each.site.linked_files[file];
      (Array.isArray(ids) ? ids : []).forEach(function (id) { linking[id] = true; });
    });
  }
  var store = null;
  var others = [];
  var movesHeld = null;
  function movesAsked() {
    if (!movesHeld) movesHeld = { moves: movesIn(entry), stateDir: entry.stateDir };
    return movesHeld;
  }
  readReviews(dir).forEach(function (each) {
    if (each.id === review.id || typeof each.meta.retired_at === "string") return;
    var other = Object.assign({ id: each.id }, each.meta);
    if (!reviewAnswersOnSite(site, other, movesAsked) && linking[each.id] !== true) return;
    var held = committedRecords(dir, entry, each.id).filter(function (item) {
      return fileOfItem(dir, entry, other, item) === file;
    });
    if (!held.length) return;
    if (!store) store = require("./agent_sessions.js").createStore({ dir: dir });
    var agent = null;
    try {
      var owner = typeof each.meta.agent_session_id === "string" ? store.read(each.meta.agent_session_id) : null;
      agent = owner && typeof owner.name === "string" && owner.name ? owner.name : null;
    } catch (err) {
      agent = null;
    }
    var title = typeof each.meta.name === "string" && each.meta.name
      ? each.meta.name
      : typeof held[0][record.FIELD.PAGE_TITLE] === "string" && held[0][record.FIELD.PAGE_TITLE]
        ? held[0][record.FIELD.PAGE_TITLE]
        : path.basename(file);
    others.push({ key: "g" + (others.length + 1), title: title, agent: agent || "an agent", records: held });
  });
  return { records: mine, others: others };
}

/**
 * This page's other addresses in the review that answers on it (Part 2): the
 * distinct origin and path pairs its committed records on this file were
 * made under, other than this page's own. At most ALIAS_MAX. They go on the
 * script tag (data-lahe-spellings), so the rail reads those records as this
 * page's.
 */
function spellingsFor(dir, siteName, pagePath, file, match) {
  var entry = activeFor(dir);
  if (!entry || !file || !match) return [];
  var review = { id: match.review, source_path: match.source_path, source_paths: match.source_paths || [], target_paths: match.targets || [] };
  var own = record.identityOrigin(protocol.siteOrigin(siteName, entry.pagesPort)) + " " + pagePath;
  var out = [];
  committedRecords(dir, entry, match.review).forEach(function (item) {
    if (out.length >= protocol.ALIAS_MAX) return;
    var origin = item[record.FIELD.PAGE_ORIGIN];
    var itemPath = item[record.FIELD.PAGE_PATH];
    if (!protocol.isSpellingOrigin(origin) || !protocol.isPathAlias(itemPath)) return;
    if (record.identityOrigin(origin) + " " + itemPath === own) return;
    if (fileOfItem(dir, entry, review, item) !== file) return;
    var pair = origin + " " + itemPath;
    if (out.indexOf(pair) === -1) out.push(pair);
  });
  return out;
}

/** {old origin: site origin} for every active site, for review.json grouping. */
function aliasMap(dir) {
  var entry = activeFor(dir);
  var out = {};
  if (!entry) return out;
  entry.sites.list().forEach(function (item) {
    // The printed spelling, so a group review.json shows reads like the
    // address the reviewer has. Any spelling is the same page (record.samePage).
    var port = typeof entry.printedPort === "function" ? entry.printedPort() : entry.pagesPort;
    var origin = protocol.siteOrigin(item.name, typeof port === "number" ? port : entry.pagesPort);
    aliasesFor(dir, item.site).forEach(function (alias) {
      if (!Object.prototype.hasOwnProperty.call(out, alias)) out[alias] = origin;
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// The pages Lahe writes itself: an unknown name, a file that is gone
// ---------------------------------------------------------------------------

// The house document style, with a dark ground for a reader whose system asks
// for one. These two pages are Lahe's own, so the override is ours to make.
var STATUS_DARK = "@media (prefers-color-scheme: dark){:root{" +
  "--surface:#1f1e1a;--surface-raised:#2a2924;--on-surface:#f7f7f5;--on-surface-soft:#d9d7d1;" +
  "--on-surface-faint:#b3b0a8;--border:#4a4842;--rule:#4a4842;--link:#c4b5fd;--accent-tint:#2a2924}}";

function statusPage(title, paragraphs) {
  return [
    "<!doctype html>",
    "<html lang=\"en\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<meta name=\"color-scheme\" content=\"light dark\">",
    "<title>" + escapeHtml(title) + "</title>",
    tabIcon.LINK,
    "<style>" + markdown.styleSheet() + STATUS_DARK + "</style>",
    "</head><body><main data-lahe-status=\"page\">",
    "<div class=\"hero\"><h1>" + escapeHtml(title) + "</h1>",
    paragraphs.join("\n"),
    "</div></main></body></html>"
  ].join("\n");
}

/**
 * The Library's address as a document page links to it: library.lahe.localhost
 * at the printed port, or with no port through the port-80 forward. From a
 * <name>.lahe.localhost page that click is a top-level navigation, which the
 * Library page accepts from any site; its Host would need the Library's name,
 * so the address names it.
 *
 * @param {number} printedPort
 */
function libraryAddress(printedPort) {
  return "http://" + protocol.PAGES.LIBRARY_NAME + "." + protocol.PAGES.SUFFIX +
    (printedPort === 80 ? "" : ":" + printedPort) + protocol.route("catalog.page").path;
}

function libraryLink(href) {
  return "<p><a href=\"" + escapeHtml(href) + "\">Open the Library</a> to find the document you meant.</p>";
}

/** R14: a name Lahe does not know. */
function unknownNamePage(name, libraryHref) {
  return statusPage("No document by that name", [
    "<p class=\"lede\">Lahe has no document at <code>" + escapeHtml(name + "." + protocol.PAGES.SUFFIX) +
      "</code>. The address may be mistyped, or it may come from another computer or another state folder.</p>",
    libraryLink(libraryHref)
  ]);
}

/** R14: a file that is gone, with no main-checkout copy to show instead. */
function gonePage(file, libraryHref) {
  return statusPage("This file is gone", [
    "<p class=\"lede\">Lahe served <code>" + escapeHtml(file) +
      "</code> at this address, and it is not on disk any more. It may have been moved, renamed, or deleted.</p>",
    libraryLink(libraryHref)
  ]);
}

/**
 * R13: the note on a worktree file shown from the main checkout. One statement
 * per line: two long paths in one run of prose were hard to read. Shown only
 * when the main copy's own page does not carry this file's review (spec
 * 20261015.01 R11); Library Open gives the copy its address and that rail.
 * `heldBy` names another review that holds the copy, by title.
 */
function movedNote(goneFile, shownFile, libraryHref, heldBy) {
  // No command is printed: a path can hold shell text (spec 20261015.01 R11).
  return "<p class=\"lahe-readonly-note lahe-moved-note\">This file's worktree is gone.<br>" +
    "This is the copy in the main checkout, read-only.<br>" +
    "This copy: <code>" + escapeHtml(shownFile) + "</code><br>" +
    "It was served from: <code>" + escapeHtml(goneFile) + "</code><br>" +
    (heldBy ? "This copy has its own review now: <b>" + escapeHtml(heldBy) + "</b>.<br>" : "") +
    "To keep commenting, open it from <a href=\"" + escapeHtml(libraryHref) + "\">the Library</a>. Its comments come with it.</p>";
}

// ---------------------------------------------------------------------------
// The request handler
// ---------------------------------------------------------------------------

/**
 * @param {{dir: string, sites: object, log?: object}} options `sites` is the
 *   helper's registry (sites.createSites)
 */
function createPageRoutes(options) {
  var opts = options || {};
  var dir = opts.dir;
  var sites = opts.sites;
  var log = opts.log || null;
  // THE STATE FOLDER IS NEVER SERVED. rootProblem refuses a root inside it,
  // but a root above it would reach it: the CLI secret, every review's token
  // in meta.json, every event log. Any file whose path or real path is inside
  // the state folder is a 404, whatever site or link led there.
  var stateDirs = [path.resolve(dir)];
  var realState = realOrNull(dir);
  if (realState && stateDirs.indexOf(realState) === -1) stateDirs.push(realState);
  function inStateDir(file) {
    return stateDirs.some(function (state) { return within(file, state); });
  }

  var printedPort = typeof opts.printedPort === "function" ? opts.printedPort : function () { return null; };

  /** The Library link on the not-found pages; the API port's Library when no pages port is known. */
  function libraryHref() {
    var port = printedPort();
    return typeof port === "number" ? libraryAddress(port) : currentHelperOrigin(dir) + protocol.route("catalog.page").path;
  }

  var notes = logModule.createNoteOnce(log, "pages: further notes of this kind are not logged until the helper restarts");

  function sayOnce(key, line) {
    notes.say(key, line);
  }

  function headers(type, length) {
    var out = {
      "cache-control": "no-store",
      "content-type": type,
      "cross-origin-resource-policy": protocol.PAGES.CORP,
      // Only the page's own site may frame it. A reveal.js speaker-notes
      // window frames the same deck, which is same-origin; any other page
      // framing a reviewed page, and its token, is refused by the browser.
      // Only this one directive, so a page's own policy is untouched.
      "content-security-policy": "frame-ancestors 'self'",
      "x-content-type-options": "nosniff"
    };
    if (typeof length === "number") out["content-length"] = length;
    return out;
  }

  function sendText(req, res, status, text, type) {
    var body = Buffer.from(String(text), "utf8");
    res.writeHead(status, headers(type || "text/plain; charset=utf-8", body.length));
    if (req.method === "HEAD") return res.end();
    res.end(body);
  }

  function sendHtml(req, res, status, html) {
    sendText(req, res, status, html, "text/html; charset=utf-8");
  }

  function notFound(req, res) {
    sendText(req, res, 404, "not found\n");
  }

  function streamFile(req, res, file, size) {
    res.writeHead(200, headers(MIME[path.extname(file).toLowerCase()] || "application/octet-stream", size));
    if (req.method === "HEAD") return res.end();
    // pipeline, not pipe: an aborted transfer closes the file too.
    stream.pipeline(fs.createReadStream(file), res, function () { /* an aborted or failed transfer is already closed */ });
  }

  function streamPackaged(req, res, file) {
    var stat;
    try { stat = fs.statSync(file); } catch (err) { return notFound(req, res); }
    streamFile(req, res, file, stat.size);
  }

  function sendStyle(req, res, rest) {
    var out;
    try { out = styles.answer(dir, rest); }
    catch (err) {
      // A 404 to the page, and one log line per style path and cause, so
      // "my style does not show" can be traced without a line per request.
      var why = styles.clean((err && (err.code || err.message)) || String(err));
      sayOnce("style-error\u0000" + rest.join("/") + "\u0000" + why,
        "pages: could not answer " + styles.SEGMENT + "/" + styles.clean(rest.join("/")) + ": " + why);
      out = { status: 404, refused: [] };
    }
    (out.refused || []).forEach(function (refusal) {
      sayOnce("style\u0000" + refusal.id + "\u0000" + refusal.reason, "pages: refused style " + refusal.id + ": " + refusal.reason);
    });
    if (out.status !== 200) return notFound(req, res);
    res.writeHead(200, headers(out.type, out.body.length));
    if (req.method === "HEAD") return res.end();
    res.end(out.body);
  }

  /**
   * Lahe's own files, answered before anything on disk is looked at, from the
   * clone or the state folder and never from the served folder. True when the
   * request was one of them.
   */
  function servePackaged(req, res, decoded) {
    if (decoded === LIBRARY_PATH) {
      streamPackaged(req, res, heal.BUNDLE);
      return true;
    }
    var styleRest = styles.reservedRest(decoded);
    if (styleRest !== null) {
      sendStyle(req, res, styleRest);
      return true;
    }
    var segments = decoded.split("/");
    var base = segments[segments.length - 1];
    if (base === markdown.DOC_STYLE_ASSET) {
      var css;
      try { css = markdown.styleSheet(); } catch (err) { notFound(req, res); return true; }
      sendText(req, res, 200, css, MIME[".css"]);
      return true;
    }
    if (base === markdown.MERMAID_ASSET) {
      streamPackaged(req, res, markdown.MERMAID_SOURCE);
      return true;
    }
    if (segments[segments.length - 2] === markdown.FONT_ASSET_DIR && markdown.FONT_ASSETS.indexOf(base) !== -1) {
      streamPackaged(req, res, path.join(markdown.FONT_SOURCE_DIR, base));
      return true;
    }
    return false;
  }

  function filePathsFor(candidate, real) {
    return real && real !== candidate ? [candidate, real] : [candidate];
  }

  function serveHtmlPage(req, res, ctx, candidate, real, mounted) {
    var html;
    try { html = fs.readFileSync(candidate, "utf8"); } catch (err) { return notFound(req, res); }
    var match = pickReview(dir, ctx.site, { filePaths: filePathsFor(candidate, real), realFile: real, mounted: mounted });
    if (match) {
      var htmlSpellings = oldSpellings(dir, ctx.site, real, match);
      var injected = injectForMatch(dir, match, candidate, html, htmlSpellings.origins, htmlSpellings.paths,
        spellingsFor(dir, ctx.name, ctx.pagePath, real, match));
      if (injected !== null) html = injected;
    }
    sendHtml(req, res, 200, tabIcon.ensure(html));
  }

  /**
   * A Markdown page, rendered from its source through the shared cache.
   * Relative links stay under the page's own folder on this site; links out of
   * it become mounts stored on this site, the way a page server stored them on
   * its record.
   */
  function serveMarkdown(req, res, ctx, candidate, real, urlDir, extra) {
    var site = ctx.site;
    var mounted = !!(extra && extra.mounted);
    var match = extra && extra.readOnly
      ? null
      : pickReview(dir, site, { filePaths: filePathsFor(candidate, real), realFile: real, mounted: mounted });
    var out;
    try {
      out = renderMarkdown(candidate, {
        assetPrefix: urlDir,
        mounts: site.mounts || {},
        noFollow: site.mode === "page-only",
        note: extra && typeof extra.note === "string" ? extra.note : (match ? "" : null)
      });
    } catch (err) {
      return sendText(req, res, 500, "could not render " + path.basename(candidate) + "\n");
    }
    if (out.added.length) {
      var added = {};
      out.added.forEach(function (entry) { added[entry.prefix] = entry.dir; });
      sites.addMounts(ctx.name, added);
    }
    var html = out.html;
    if (match) {
      if (out.linked.length) sites.addLinked(ctx.name, match.review, out.linked);
      var spellings = oldSpellings(dir, site, real, match);
      var injected = injectForMatch(dir, match, candidate, html, spellings.origins, spellings.paths,
        spellingsFor(dir, ctx.name, ctx.pagePath, real, match));
      if (injected !== null) html = injected;
    }
    sendHtml(req, res, 200, html);
  }

  function isPage(file) {
    return markdown.isMarkdown(file) || heal.isStaticPage(file);
  }

  /**
   * R13: a file under a site whose worktree is gone, from the main checkout,
   * read-only. Null when there is no such copy.
   */
  function mainCheckoutCopy(site, candidate) {
    // The one rule (spec 20261015.01 R4), not a second copy of it.
    return movedCopyOnSite(activeFor(dir) || registryEntry(dir), site, candidate);
  }

  /** Both Fetch Metadata headers of a top-level page load. Absent on .lahe, so never there. */
  function topLevel(req) {
    var dest = req.headers["sec-fetch-dest"];
    var mode = req.headers["sec-fetch-mode"];
    return dest === "document" && mode === "navigate";
  }

  /**
   * A review, not retired, that recorded this exact file: the file's own
   * review. The tier-1 rule holderOfFile uses, so a file whose review followed
   * it out of a worktree counts too (spec 20261015.01 R6).
   */
  function ownReviewOf(real) {
    var metas = readReviews(dir).filter(function (each) { return typeof each.meta.retired_at !== "string"; });
    return !!tierOneOf(dir, activeFor(dir) || registryEntry(dir), real, metas);
  }

  /**
   * The file's own address, from the registry only: the deepest folder site
   * whose root holds the file (or a notes site that is the file), the printed
   * port, and the file's path under that root, re-encoded segment by segment.
   * Null when no site holds it. Never makes a site.
   */
  function ownAddressOf(real) {
    var own = ownSiteOf(real);
    return own ? own.url : null;
  }

  /** The site ownAddressOf names, with its address: {name, site, url}, or null. */
  function ownSiteOf(real) {
    var best = null;
    sites.list().forEach(function (each) {
      var root = each.site.root;
      if (each.site.mode === "page-only") {
        if (root === real && (!best || root.length > best.root.length)) best = { name: each.name, root: path.dirname(root), rel: path.basename(root) };
        return;
      }
      if (!within(real, root) || real === root) return;
      if (!best || root.length > best.root.length) best = { name: each.name, root: root, rel: path.relative(root, real) };
    });
    if (!best) return null;
    var port = printedPort();
    var origin = protocol.siteOrigin(best.name, typeof port === "number" ? port : protocol.PAGES.PORT);
    return { name: best.name, site: sites.get(best.name), url: origin + "/" + best.rel.split(path.sep).map(encodeURIComponent).join("/") };
  }

  /**
   * Does `match` hold the gone file `gone`, served at `ctx`? It recorded the
   * file, or it holds a committed record made at this very address.
   */
  function holdsGoneFile(match, gone, ctx) {
    var meta = null;
    readReviews(dir).some(function (each) {
      if (each.id !== match.review) return false;
      meta = each.meta;
      return true;
    });
    if (!meta) return false;
    if (recordedFiles(meta).some(function (one) { return path.resolve(one) === gone; })) return true;
    var registry = activeFor(dir) || registryEntry(dir);
    return committedRecords(dir, registry, match.review).some(function (item) {
      var origin = item[record.FIELD.PAGE_ORIGIN];
      var name = typeof origin === "string" ? protocol.siteNameFromOrigin(origin, registry.pagesPort, typeof registry.laheNames === "function" && registry.laheNames()) : null;
      return name === ctx.name && item[record.FIELD.PAGE_PATH] === ctx.pagePath;
    });
  }

  /** A review's title for a note: its name, else the file's name. Page text, escaped by the caller. */
  function titleOfReview(reviewId, file) {
    var title = null;
    readReviews(dir).some(function (each) {
      if (each.id !== reviewId) return false;
      title = typeof each.meta.name === "string" && each.meta.name ? each.meta.name : null;
      return true;
    });
    return title || path.basename(file);
  }

  function redirectTo(res, location) {
    res.writeHead(302, {
      location: location,
      "cache-control": "no-store",
      "cross-origin-resource-policy": protocol.PAGES.CORP,
      "content-security-policy": "frame-ancestors 'self'",
      "content-length": 0
    });
    res.end();
  }

  /** A linked page that has its own review, shown here read-only, with where to comment. */
  function serveElsewhere(req, res, ctx, candidate, real, urlDir) {
    var note = "<p class=\"lahe-readonly-note lahe-own-review-note\">This document has its own review.<br>" +
      "Open it at its own address to comment on it: <code>" + escapeHtml(real) + "</code></p>";
    if (markdown.isMarkdown(candidate)) {
      return serveMarkdown(req, res, ctx, candidate, real, urlDir, { readOnly: true, mounted: true, note: note });
    }
    var html;
    try { html = fs.readFileSync(candidate, "utf8"); } catch (err) { return notFound(req, res); }
    var stripped = scriptLine.removeScriptLine(html);
    sendHtml(req, res, 200, tabIcon.ensure(placeNote(stripped ? stripped.html : html, note)));
  }

  function serveGone(req, res, ctx, candidate) {
    var site = ctx.site;
    var copy = mainCheckoutCopy(site, candidate);
    if (copy && inStateDir(copy)) return notFound(req, res);
    if (copy) {
      // THE OLD ADDRESS (spec 20261015.01 R11). When the main copy has an
      // address of its own and its page carries the review that holds this
      // file, a page load goes there. The Location is built by ownAddressOf
      // from the registry, never from the request. Otherwise the copy is
      // shown here read-only, naming the review that holds it, if one does.
      var heldBy = null;
      if (isPage(copy)) {
        var own = ownSiteOf(copy);
        var match = own && own.site ? pickReview(dir, own.site, { filePaths: [copy], realFile: copy, mounted: false }) : null;
        if (match && holdsGoneFile(match, candidate, ctx)) {
          if (topLevel(req)) return redirectTo(res, own.url);
        } else if (match) {
          heldBy = titleOfReview(match.review, copy);
        }
      }
      sayOnce("moved\u0000" + candidate, "pages: " + candidate + " is gone with its worktree; showing " + copy + " read-only");
      var note = movedNote(candidate, copy, libraryHref(), heldBy);
      if (markdown.isMarkdown(copy)) {
        var copyBase = path.join(site.main_checkout, path.relative(site.worktree_root, site.root));
        return serveMarkdown(req, res, ctx, copy, copy, urlDirOf("/", site.mode === "page-only" ? path.dirname(copyBase) : copyBase, copy), {
          readOnly: true,
          note: note
        });
      }
      if (heal.isStaticPage(copy)) {
        var html;
        try { html = fs.readFileSync(copy, "utf8"); } catch (err) { return notFound(req, res); }
        var stripped = scriptLine.removeScriptLine(html);
        return sendHtml(req, res, 200, tabIcon.ensure(placeNote(stripped ? stripped.html : html, note)));
      }
      var stat = fs.statSync(copy);
      return streamFile(req, res, copy, stat.size);
    }
    if (!isPage(candidate)) return notFound(req, res);
    sayOnce("gone\u0000" + candidate, "pages: " + candidate + " is gone; served the file-is-gone page");
    sendHtml(req, res, 410, gonePage(candidate, libraryHref()));
  }

  /**
   * Answer one request whose Host named the site `name`.
   *
   * @param {http.IncomingMessage} req
   * @param {http.ServerResponse} res
   * @param {string} name a name the Host grammar accepted
   */
  function handle(req, res, name) {
    var site = sites.get(name);
    var rawPath = String(req.url || "").split("?")[0].split("#")[0];
    var decoded = decodePath(rawPath);
    if (!site) {
      // Lahe's own fonts and style still answer, so the page that says so
      // looks like every other Lahe page. Nothing else does.
      if (decoded !== null && servePackaged(req, res, decoded)) return;
      sayOnce("unknown\u0000" + name, "pages: no document by the name " + name);
      return sendHtml(req, res, 404, unknownNamePage(name, libraryHref()));
    }
    if (req.method !== "GET" && req.method !== "HEAD") return sendText(req, res, 405, "method not allowed\n");
    if (rawPath.charAt(0) !== "/") return sendText(req, res, 400, "bad request\n");
    // DOT SEGMENTS, ENCODED SLASHES AND NUL, in every spelling (decodePath).
    // Hidden files are served like any other; Lahe's reserved names are
    // answered by servePackaged and locate, never from the folder.
    if (decoded === null) return notFound(req, res);
    if (servePackaged(req, res, decoded)) return;
    var where = locate(site, decoded, rawPath);
    if (!where) return notFound(req, res);
    var ctx = { name: name, site: site, pagePath: rawPath };
    var candidate = where.page ? site.root : candidateOf(where, decoded);
    if (!candidate || inStateDir(candidate)) return notFound(req, res);
    var stat;
    try { stat = fs.statSync(candidate); } catch (err) {
      if (where.mounted) return notFound(req, res);
      return serveGone(req, res, ctx, candidate);
    }
    var real = realOrNull(candidate);
    var realBase = realOrNull(where.base);
    if (!real || !realBase || !within(real, realBase) || !stat.isFile() || inStateDir(real)) return notFound(req, res);
    // A LINK ADDRESS TO A FILE WITH ITS OWN REVIEW (each page carries its own
    // comments, Part 2). A top-level page load goes to the file's own address;
    // anything else gets the page read-only with no rail, so a new comment is
    // never filed in the linking review.
    if (where.mounted && isPage(candidate) && ownReviewOf(real)) {
      var target = topLevel(req) ? ownAddressOf(real) : null;
      if (target) return redirectTo(res, target);
      return serveElsewhere(req, res, ctx, candidate, real, urlDirOf(where.prefix, where.base, candidate));
    }
    if (markdown.isMarkdown(candidate)) {
      return serveMarkdown(req, res, ctx, candidate, real, urlDirOf(where.prefix, where.base, candidate), { mounted: where.mounted });
    }
    if (heal.isStaticPage(candidate)) return serveHtmlPage(req, res, ctx, candidate, real, where.mounted);
    streamFile(req, res, candidate, stat.size);
  }

  return { handle: handle };
}

module.exports = {
  LIBRARY_PATH: LIBRARY_PATH,
  MOUNT_ROOT: MOUNT_ROOT,
  MIME: MIME,
  currentHelperOrigin: currentHelperOrigin,
  injectForMatch: injectForMatch,
  placeNote: placeNote,
  servedFrom: servedFrom,
  newer: newer,
  pickReview: pickReview,
  reviewAnswersOnSite: reviewAnswersOnSite,
  libraryAddress: libraryAddress,
  unknownNamePage: unknownNamePage,
  gonePage: gonePage,
  activate: activate,
  deactivate: deactivate,
  activeFor: activeFor,
  servesFile: servesFile,
  fileForPage: fileForPage,
  linkedFileForPage: linkedFileForPage,
  renderForFile: renderForFile,
  recordLinkedFor: recordLinkedFor,
  aliasesFor: aliasesFor,
  oldSpellings: oldSpellings,
  pageRecords: pageRecords,
  spellingsFor: spellingsFor,
  aliasMap: aliasMap,
  createPageRoutes: createPageRoutes,
  markdownSourcesOf: markdownSourcesOf,
  fileOfItem: fileOfItem,
  holderOfFile: holderOfFile,
  movesOf: movesOf,
  movesFor: movesFor,
  movedCopyOf: movedCopyOf,
  movedPlace: movedPlace,
  linkAddressFor: linkAddressFor,
  registryEntry: registryEntry,
  committedRecords: committedRecords,
  createNoteOnce: logModule.createNoteOnce,
  LOG_NOTE_CAP: logModule.LOG_NOTE_CAP
};
