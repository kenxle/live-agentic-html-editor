// The Library's side of stable addresses: which site a review's document is
// served from, what its address is, and how Open binds it.
//
// Architecture: docs/features/20261011.02_stable_addresses/02_architecture_stable_addresses.md,
// "The Library". With the pages switch on, Open no longer restarts a page
// server. It finds or names the review's site in the registry (sites.js),
// stamps the review as re-served unless a newer open review holds the rail,
// and returns the address. The reader asks this module the same questions to
// decide a row's kind and to show its address, and it asks them without
// writing: a list never names a site. Only open() does.
//
// THE SITE IS DECIDED THE WAY `lahe review` DECIDES IT (commands/review.js,
// planSite): a notes page by itself, a Markdown file by its source folder, a
// folder review by the folder, a single page by its own folder. The registry
// keys a site by its root and mode, so the same document gets the same name
// whichever of the two asks first.
//
// Node-only.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var markdown = require("./markdown.js");
var pageRoutes = require("./page_routes.js");
var sitesModule = require("./sites.js");

var MODE = sitesModule.MODE;
// What Lahe serves as a page: the extensions the reader already counts.
var PAGE_EXTENSIONS = [".html", ".htm", ".md", ".markdown"];
// A page-server origin a bound review no longer needs: the same pattern the
// site.bind route removes.
var OLD_PORT_ORIGIN = /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}$/;

function realOrNull(file) {
  try {
    return fs.realpathSync.native(file);
  } catch (err) {
    return null;
  }
}

function statOrNull(file) {
  try {
    return fs.statSync(file);
  } catch (err) {
    return null;
  }
}

function isPageFile(file) {
  return PAGE_EXTENSIONS.indexOf(path.extname(file).toLowerCase()) !== -1;
}

function within(file, root) {
  return file === root || file.indexOf(root + path.sep) === 0;
}

/** A path under `root` as a URL path: each segment encoded, rooted at "/". */
function urlPathUnder(root, file) {
  var rel = path.relative(root, file);
  return "/" + rel.split(path.sep).filter(function (s) { return s.length > 0; }).map(encodeURIComponent).join("/");
}

/**
 * @param {{dir: string, sites: object, reviews: object, port: function(): number|null,
 *          log?: function(string)}} options
 *   `sites` is the helper's registry, `reviews` its review registry (for the
 *   re-served stamp), `port` the pages port once it is bound.
 */
function createCatalogSites(options) {
  var opts = options || {};
  ["dir", "sites", "reviews", "port"].forEach(function (key) {
    if (!opts[key]) throw new Error("catalog_sites.createCatalogSites: " + key + " is required");
  });
  var dir = opts.dir;
  var sites = opts.sites;
  var reviews = opts.reviews;
  var log = typeof opts.log === "function" ? opts.log : function () {};

  /**
   * The site a review's document would be served from, or null when Lahe
   * cannot serve it. Reads the disk; writes nothing.
   *
   * @param {{sourcePath: string|null, servedPath: string|null, notes: boolean,
   *          landing: function(string): string|null}} input `landing(folder)`
   *   names the page a folder review opens on
   * @returns {{mode: string, root: string, file: string}|null} real paths
   */
  function planOf(input) {
    var source = input.sourcePath ? realOrNull(input.sourcePath) : null;
    var sourceStat = source ? statOrNull(source) : null;
    if (input.notes && sourceStat && sourceStat.isFile()) return { mode: MODE.PAGE_ONLY, root: source, file: source };
    if (sourceStat && sourceStat.isFile() && markdown.isMarkdown(source)) {
      return { mode: MODE.FOLDER, root: path.dirname(source), file: source };
    }
    var served = input.servedPath ? realOrNull(input.servedPath) : null;
    var stat = served ? statOrNull(served) : null;
    if (!stat) return null;
    if (stat.isDirectory()) {
      var landing = input.landing(served);
      var landingReal = landing ? realOrNull(landing) : null;
      if (!landingReal || !within(landingReal, served)) return null;
      return { mode: MODE.FOLDER, root: served, file: landingReal };
    }
    if (stat.isFile() && isPageFile(served)) return { mode: MODE.FOLDER, root: path.dirname(served), file: served };
    return null;
  }

  /** The URL path of a plan's page on its site. */
  function urlPathOf(plan) {
    return plan.mode === MODE.PAGE_ONLY ? "/" + encodeURIComponent(path.basename(plan.root)) : urlPathUnder(plan.root, plan.file);
  }

  /** The site already named for a plan, or null. Never names one. */
  function siteFor(plan) {
    return sites.byRoot(plan.root, plan.mode);
  }

  /** http://<name>.lahe.localhost:<pages port><url path>, or null before the pages port is bound. */
  function addressOf(name, urlPath) {
    var port = opts.port();
    return typeof port === "number" ? protocol.siteOrigin(name, port) + urlPath : null;
  }

  /**
   * A document whose worktree is gone: the site that served it, when that
   * site recorded its main checkout and the checkout still has the page.
   * Open then opens the read-only copy the page server shows (page_routes.js).
   *
   * @returns {{name: string, urlPath: string}|null}
   */
  function worktreeSiteFor(docPath) {
    if (typeof docPath !== "string" || !path.isAbsolute(docPath)) return null;
    var all = sites.list();
    for (var i = 0; i < all.length; i += 1) {
      var site = all[i].site;
      if (!site.worktree_root || !site.main_checkout) continue;
      if (fs.existsSync(site.worktree_root)) continue;
      if (!within(docPath, site.root)) continue;
      var file = docPath === site.root && site.mode === MODE.FOLDER ? path.join(site.root, site.entry || "") : docPath;
      var copy = path.join(site.main_checkout, path.relative(site.worktree_root, file));
      var real = realOrNull(copy);
      var stat = real ? statOrNull(real) : null;
      if (!real || !stat || !stat.isFile() || !isPageFile(real)) continue;
      if (!within(real, realOrNull(site.main_checkout) || site.main_checkout)) continue;
      var urlPath = site.mode === MODE.PAGE_ONLY ? "/" + encodeURIComponent(path.basename(site.root)) : urlPathUnder(site.root, file);
      return { name: all[i].name, urlPath: urlPath };
    }
    return null;
  }

  /**
   * The review whose rail the page currently carries, or null: the same pick
   * the page server makes (page_routes.pickReview).
   */
  function railHolder(site, file) {
    var pick = pageRoutes.pickReview(dir, site, { filePaths: [file], realFile: file, mounted: false });
    return pick ? pick.review : null;
  }

  /**
   * Find or name the site for a plan. An existing site keeps its entry page:
   * the entry is what `lahe review` printed, and Open must not rewrite it.
   *
   * @returns {{name: string, site: object, created: boolean}}
   * @throws when the registry refuses the root
   */
  function bindPlan(plan) {
    var found = siteFor(plan);
    if (found) return { name: found.name, site: found.site, created: false };
    var entry = plan.mode === MODE.PAGE_ONLY ? path.basename(plan.root) : path.relative(plan.root, plan.file).split(path.sep).join("/");
    var bound = sites.bind({ root: plan.root, mode: plan.mode, entry: entry });
    log("Library named site " + bound.name + " for a document it was asked to open");
    return bound;
  }

  /**
   * Stamp a review as re-served, so it is the one that answers on its page,
   * and drop the page-server origins it carried (site.bind does the same).
   */
  function stamp(reviewId, nowMs) {
    reviews.ensureKnown(reviewId);
    var review = reviews.get(reviewId);
    if (!review) return;
    reviews.stampServed(reviewId, new Date(nowMs).toISOString());
    review.origins.filter(function (origin) { return OLD_PORT_ORIGIN.test(origin); }).forEach(function (origin) {
      reviews.removeOrigin(reviewId, origin);
    });
  }

  return {
    planOf: planOf,
    urlPathOf: urlPathOf,
    siteFor: siteFor,
    addressOf: addressOf,
    worktreeSiteFor: worktreeSiteFor,
    railHolder: railHolder,
    bindPlan: bindPlan,
    stamp: stamp
  };
}

module.exports = { PAGE_EXTENSIONS: PAGE_EXTENSIONS, createCatalogSites: createCatalogSites };
