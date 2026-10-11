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
var path = require("node:path");

var protocol = require("../shared/protocol.js");
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

function realOrNull(target) {
  try { return fs.realpathSync(target); } catch (err) { return null; }
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
function injectForMatch(dir, match, target, html, aliases) {
  var carried = scriptLine.reviewAlreadyInFile(html);
  if (carried === match.review) return null;
  if (carried) {
    try {
      logModule.createEventLog({ dir: dir }).helperLog(
        "review " + match.review + ": not injecting at serve time into " + target +
          ", it carries review " + carried + " now, so it was re-attached somewhere else on purpose"
      );
    } catch (err) {
      // Diagnostic only; a page that cannot log must still be served.
    }
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
    aliases: Array.isArray(aliases) && aliases.length ? aliases : undefined
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
  var files = targetsOf(meta);
  if (typeof meta.source_path === "string" && markdown.isMarkdown(meta.source_path)) files.push(meta.source_path);
  return files;
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
  if (typeof meta.source_path === "string" && markdown.isMarkdown(meta.source_path)) {
    var dirOfSource = realOrNull(path.dirname(meta.source_path));
    return dirOfSource ? [dirOfSource] : [];
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
 * @returns {{review: string, token: string, notes: boolean}|null}
 */
function pickReview(dir, site, request) {
  var filePaths = request.filePaths || [];
  var realFile = request.realFile || null;
  var linkedIds = realFile && site.linked_files && Array.isArray(site.linked_files[realFile])
    ? site.linked_files[realFile]
    : [];
  var recorded = null;
  var backing = null;
  var linking = null;
  readReviews(dir).forEach(function (entry) {
    var meta = entry.meta;
    var candidate = { review: entry.id, token: meta.token, at: stampOf(meta), notes: meta.notes === true };
    var only = meta.only_recorded_pages === true;
    if (!request.mounted && recordsFile(recordedFiles(meta), filePaths, realFile)) {
      if (newer(candidate, recorded)) recorded = candidate;
      return;
    }
    if (only) return;
    if (!request.mounted && site.mode === "folder" && servedRootsOf(meta).indexOf(site.root) !== -1) {
      if (newer(candidate, backing)) backing = candidate;
      return;
    }
    if (site.mode === "folder" && linkedIds.indexOf(entry.id) !== -1 && newer(candidate, linking)) linking = candidate;
  });
  var best = recorded || backing || linking;
  if (!best) return null;
  return { review: best.review, token: best.token, notes: best.notes };
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
function reviewAnswersOnSite(site, review) {
  if (!site || !review) return false;
  var files = recordedFiles(review);
  var root = site.root;
  var recordedHere = files.some(function (file) {
    var real = realOrNull(file) || path.resolve(file);
    return site.mode === "page-only" ? real === root : within(real, root);
  });
  if (recordedHere) return true;
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

function hasHiddenSegment(relative) {
  return relative.split("/").some(function (s) { return s.charAt(0) === "."; });
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
    if (typeof mountDir !== "string" || hasHiddenSegment(mount[2])) return null;
    return { base: mountDir, prefix: mount[1], relative: mount[2], mounted: true, page: false };
  }
  if (hasHiddenSegment(decoded)) return null;
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
  var entry = activeFor(dir);
  if (!entry) return null;
  var name = protocol.siteNameFromOrigin(origin, entry.pagesPort, typeof entry.laheNames === "function" && entry.laheNames());
  var site = name ? entry.sites.get(name) : null;
  var decoded = site ? decodePath(String(pagePath || "")) : null;
  var where = decoded !== null ? locate(site, decoded, pagePath) : null;
  if (!where) return null;
  if (where.page) return site.root;
  var candidate = candidateOf(where, decoded);
  if (!candidate) return null;
  var real = realOrNull(candidate);
  if (!real) return candidate;
  var realBase = realOrNull(where.base);
  return realBase && within(real, realBase) ? real : null;
}

/**
 * The real file a linked page names, for an item made on it by `reviewId`, or
 * null: a page under one of a site's mounts that this review linked to.
 */
function linkedFileForPage(dir, reviewId, pagePath) {
  var entry = activeFor(dir);
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
  var ports = [];
  oldServerRecords(dir)
    .filter(function (rec) { return rec.root === site.root; })
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
 * <name>.lahe.localhost page that click is same-site, which the Library page
 * accepts as a top-level navigation; 127.0.0.1 would be cross-site and refused.
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

/** R13: the note on a worktree file shown from the main checkout. */
function movedNote(goneFile, shownFile) {
  return "<p class=\"lahe-readonly-note lahe-moved-note\">This file's worktree is gone, so this is the copy in the main checkout, " +
    "read-only: <code>" + escapeHtml(shownFile) + "</code>. It was served from <code>" + escapeHtml(goneFile) +
    "</code>. To comment on it, open it from the Library.</p>";
}

// ---------------------------------------------------------------------------
// The request handler
// ---------------------------------------------------------------------------

/** How many distinct notes one helper logs of a kind before it stops. */
var LOG_NOTE_CAP = 256;

/**
 * Logs a line once per key, for at most LOG_NOTE_CAP keys. Any web page can
 * make the browser ask for random names or send random Host headers, so an
 * unbounded "once per key" set would let a page grow the helper's memory and
 * helper.log without end. Past the cap it logs `fullLine` once and stops.
 *
 * @param {{helperLog: function}|null} log
 * @param {string} fullLine
 * @returns {{say: function(string, string): void}}
 */
function createNoteOnce(log, fullLine) {
  var said = new Set();
  var full = false;
  function write(line) {
    if (!log) return;
    try { log.helperLog(line); } catch (err) { /* diagnostic only */ }
  }
  return {
    say: function (key, line) {
      if (said.has(key) || full) return;
      if (said.size >= LOG_NOTE_CAP) {
        full = true;
        write(fullLine);
        return;
      }
      said.add(key);
      write(line);
    }
  };
}

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

  var notes = createNoteOnce(log, "pages: further notes of this kind are not logged until the helper restarts");

  function sayOnce(key, line) {
    notes.say(key, line);
  }

  function headers(type, length) {
    var out = {
      "cache-control": "no-store",
      "content-type": type,
      "cross-origin-resource-policy": protocol.PAGES.CORP,
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
    fs.createReadStream(file).on("error", function () { res.destroy(); }).pipe(res);
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
      var injected = injectForMatch(dir, match, candidate, html, aliasesFor(dir, ctx.site));
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
      var injected = injectForMatch(dir, match, candidate, html, aliasesFor(dir, site));
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
    if (!site.worktree_root || !site.main_checkout) return null;
    if (fs.existsSync(site.worktree_root)) return null;
    if (!within(candidate, site.worktree_root)) return null;
    var copy = path.join(site.main_checkout, path.relative(site.worktree_root, candidate));
    var mainRoot = path.join(site.main_checkout, path.relative(site.worktree_root, site.root));
    var real = realOrNull(copy);
    var realMain = realOrNull(site.mode === "page-only" ? path.dirname(mainRoot) : mainRoot);
    if (!real || !realMain || !within(real, realMain)) return null;
    try { if (!fs.statSync(real).isFile()) return null; } catch (err) { return null; }
    return real;
  }

  function serveGone(req, res, ctx, candidate) {
    var site = ctx.site;
    var copy = mainCheckoutCopy(site, candidate);
    if (copy && inStateDir(copy)) return notFound(req, res);
    if (copy) {
      sayOnce("moved\u0000" + candidate, "pages: " + candidate + " is gone with its worktree; showing " + copy + " read-only");
      if (markdown.isMarkdown(copy)) {
        var copyBase = path.join(site.main_checkout, path.relative(site.worktree_root, site.root));
        return serveMarkdown(req, res, ctx, copy, copy, urlDirOf("/", site.mode === "page-only" ? path.dirname(copyBase) : copyBase, copy), {
          readOnly: true,
          note: movedNote(candidate, copy)
        });
      }
      if (heal.isStaticPage(copy)) {
        var html;
        try { html = fs.readFileSync(copy, "utf8"); } catch (err) { return notFound(req, res); }
        var stripped = scriptLine.removeScriptLine(html);
        return sendHtml(req, res, 200, tabIcon.ensure(placeNote(stripped ? stripped.html : html, movedNote(candidate, copy))));
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
    // HIDDEN FILES AND DOT SEGMENTS, in every spelling (decodePath, locate).
    if (decoded === null) return notFound(req, res);
    if (servePackaged(req, res, decoded)) return;
    var where = locate(site, decoded, rawPath);
    if (!where) return notFound(req, res);
    var ctx = { name: name, site: site };
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
  aliasMap: aliasMap,
  createPageRoutes: createPageRoutes,
  createNoteOnce: createNoteOnce,
  LOG_NOTE_CAP: LOG_NOTE_CAP
};
