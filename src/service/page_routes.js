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
function injectForMatch(dir, match, target, html) {
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
    notes: stateDir.isNotesReview(dir, match.review)
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

function readReviews(dir) {
  var root;
  try { root = stateDir.reviewsRoot(dir); } catch (err) { return []; }
  var entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (err) { return []; }
  var out = [];
  entries.forEach(function (entry) {
    if (!entry.isDirectory() || !protocol.isSafeId(entry.name)) return;
    var meta = readJson(stateDir.metaPath(dir, entry.name));
    if (!meta || typeof meta.token !== "string") return;
    out.push({ id: entry.name, meta: meta });
  });
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
 * @returns {{review: string, token: string, displaced: string|null}|null}
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
    var candidate = { review: entry.id, token: meta.token, at: stampOf(meta) };
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
  return { review: best.review, token: best.token, displaced: recorded && backing ? backing.review : null };
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

function libraryLink(helperOrigin) {
  var href = helperOrigin + protocol.route("catalog.page").path;
  return "<p><a href=\"" + escapeHtml(href) + "\">Open the Library</a> to find the document you meant.</p>";
}

/** R14: a name Lahe does not know. */
function unknownNamePage(name, helperOrigin) {
  return statusPage("No document by that name", [
    "<p class=\"lede\">Lahe has no document at <code>" + escapeHtml(name + "." + protocol.PAGES.SUFFIX) +
      "</code>. The address may be mistyped, or it may come from another computer or another state folder.</p>",
    libraryLink(helperOrigin)
  ]);
}

/** R14: a file that is gone, with no main-checkout copy to show instead. */
function gonePage(file, helperOrigin) {
  return statusPage("This file is gone", [
    "<p class=\"lede\">Lahe served <code>" + escapeHtml(file) +
      "</code> at this address, and it is not on disk any more. It may have been moved, renamed, or deleted.</p>",
    libraryLink(helperOrigin)
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

/**
 * @param {{dir: string, sites: object, log?: object}} options `sites` is the
 *   helper's registry (sites.createSites)
 */
function createPageRoutes(options) {
  var opts = options || {};
  var dir = opts.dir;
  var sites = opts.sites;
  var log = opts.log || null;
  var said = Object.create(null);

  function sayOnce(key, line) {
    if (said[key] || !log) return;
    said[key] = true;
    try { log.helperLog(line); } catch (err) { /* diagnostic only */ }
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
    catch (err) { out = { status: 404, refused: [] }; }
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

  function serveHtmlPage(req, res, site, candidate, real, mounted) {
    var html;
    try { html = fs.readFileSync(candidate, "utf8"); } catch (err) { return notFound(req, res); }
    var match = pickReview(dir, site, { filePaths: filePathsFor(candidate, real), realFile: real, mounted: mounted });
    if (match) {
      var injected = injectForMatch(dir, match, candidate, html);
      if (injected !== null) html = injected;
    }
    sendHtml(req, res, 200, tabIcon.ensure(html));
  }

  /**
   * A Markdown page, rendered from its source on request. Relative links stay
   * under the page's own folder on this site; links out of it become mounts
   * stored on this site, the way a page server stored them on its record.
   */
  function serveMarkdown(req, res, ctx, candidate, real, urlDir, extra) {
    var site = ctx.site;
    var mounted = !!(extra && extra.mounted);
    var match = extra && extra.readOnly
      ? null
      : pickReview(dir, site, { filePaths: filePathsFor(candidate, real), realFile: real, mounted: mounted });
    var pageOnly = site.mode === "page-only";
    var registry = markdownLinks.createRegistry({
      mounts: site.mounts || {},
      consumed: Object.keys(site.mounts || {}),
      cap: pageOnly ? 0 : undefined
    });
    var renderOptions = { assetPrefix: urlDir, links: registry, noFollow: pageOnly };
    if (extra && typeof extra.note === "string") renderOptions.note = extra.note;
    else if (match) renderOptions.note = "";
    else renderOptions.readOnlyNote = true;
    var html;
    try { html = markdown.render(candidate, renderOptions); }
    catch (err) { return sendText(req, res, 500, "could not render " + path.basename(candidate) + "\n"); }
    if (registry.added.length) {
      var added = {};
      registry.added.forEach(function (entry) { added[entry.prefix] = entry.dir; });
      sites.addMounts(ctx.name, added);
    }
    if (match) {
      if (registry.linked.length) sites.addLinked(ctx.name, match.review, registry.linked);
      var injected = injectForMatch(dir, match, candidate, html);
      if (injected !== null) html = injected;
    }
    sendHtml(req, res, 200, html);
  }

  /** The URL folder a file sits in under `base`, served at `prefix`. */
  function urlDirOf(prefix, base, file) {
    var rel = path.relative(base, path.dirname(file));
    var segments = rel ? rel.split(path.sep).map(encodeURIComponent) : [];
    return prefix + segments.map(function (s) { return s + "/"; }).join("");
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
    sendHtml(req, res, 410, gonePage(candidate, currentHelperOrigin(dir)));
  }

  /** A file under `base` (the site root or a mount), by its decoded relative path. */
  function serveUnder(req, res, ctx, base, prefix, relative, mounted) {
    var candidate = path.resolve(base, relative || "index.html");
    if (!within(candidate, base)) return notFound(req, res);
    var stat;
    try {
      stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        candidate = path.join(candidate, "index.html");
        stat = fs.statSync(candidate);
      }
    } catch (err) {
      if (mounted) return notFound(req, res);
      return serveGone(req, res, ctx, candidate);
    }
    var real = realOrNull(candidate);
    var realBase = realOrNull(base);
    if (!real || !realBase || !within(real, realBase) || !stat.isFile()) return notFound(req, res);
    if (markdown.isMarkdown(candidate)) {
      return serveMarkdown(req, res, ctx, candidate, real, urlDirOf(prefix, base, candidate), { mounted: mounted });
    }
    if (heal.isStaticPage(candidate)) return serveHtmlPage(req, res, ctx.site, candidate, real, mounted);
    streamFile(req, res, candidate, stat.size);
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
    if (!site) {
      // Lahe's own fonts and style still answer, so the page that says so
      // looks like every other Lahe page. Nothing else does.
      var asked = null;
      try { asked = decodeURIComponent(String(req.url || "").split("?")[0]); } catch (err) { asked = null; }
      if (asked && asked.indexOf("..") === -1 && servePackaged(req, res, asked)) return;
      sayOnce("unknown\u0000" + name, "pages: no document by the name " + name);
      return sendHtml(req, res, 404, unknownNamePage(name, currentHelperOrigin(dir)));
    }
    if (req.method !== "GET" && req.method !== "HEAD") return sendText(req, res, 405, "method not allowed\n");
    var rawPath = String(req.url || "").split("?")[0].split("#")[0];
    if (rawPath.charAt(0) !== "/") return sendText(req, res, 400, "bad request\n");
    // HIDDEN FILES AND DOT SEGMENTS, in every spelling. A raw "." or ".."
    // segment, an encoded slash or backslash (which would make one after
    // decoding), and after decoding any segment that starts with a dot.
    if (/%2f|%5c/i.test(rawPath)) return notFound(req, res);
    if (rawPath.split("/").some(function (s) { return s === "." || s === ".."; })) return notFound(req, res);
    var decoded;
    try { decoded = decodeURIComponent(rawPath); } catch (err) { return sendText(req, res, 400, "bad request\n"); }
    if (decoded.indexOf("\0") !== -1 || decoded.indexOf("\\") !== -1) return notFound(req, res);
    if (servePackaged(req, res, decoded)) return;
    var ctx = { name: name, site: site };
    if (decoded.indexOf(MOUNT_ROOT) === 0) {
      // ONE SPELLING FOR A MOUNT: the literal prefix, or the helper's own
      // mapping from page path to file could not agree with the browser's.
      if (site.mode !== "folder" || rawPath.indexOf(MOUNT_ROOT) !== 0) return notFound(req, res);
      var mount = /^(\/\.lahe-source\/[a-f0-9]+\/)(.*)$/.exec(decoded);
      var mountDir = mount && site.mounts ? site.mounts[mount[1]] : null;
      if (typeof mountDir !== "string") return notFound(req, res);
      if (mount[2].split("/").some(function (s) { return s.charAt(0) === "."; })) return notFound(req, res);
      return serveUnder(req, res, ctx, mountDir, mount[1], mount[2], true);
    }
    var segments = decoded.split("/").filter(function (s) { return s.length > 0; });
    if (segments.some(function (s) { return s.charAt(0) === "."; })) return notFound(req, res);
    if (site.mode === "page-only") {
      if (decoded !== "/" + path.basename(site.root)) return notFound(req, res);
      if (!fs.existsSync(site.root)) return serveGone(req, res, ctx, site.root);
      var realRoot = realOrNull(site.root);
      if (markdown.isMarkdown(site.root)) return serveMarkdown(req, res, ctx, site.root, realRoot, "/");
      return serveHtmlPage(req, res, site, site.root, realRoot, false);
    }
    serveUnder(req, res, ctx, site.root, "/", segments.join("/"), false);
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
  unknownNamePage: unknownNamePage,
  gonePage: gonePage,
  createPageRoutes: createPageRoutes
};
