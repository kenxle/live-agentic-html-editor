// The Library page: its HTML template, the fixed asset allowlist, and the
// response headers every catalog route sends.
//
// Owner: Library 1.2 (routes, allowlist, headers). Library 2.2 replaces the
// template BODY in renderPage and nothing else in this file: the meta tag, the
// script and style tags, and the headers are what the route checks rely on.
//
// Architecture: docs/features/20260922.02_lahe_library/02_architecture_lahe_library.md,
// Security & Privacy Notes.
//
// THE TOKEN LIVES IN ONE PLACE: a <meta name="lahe-catalog-token"> tag. The
// policy is script-src 'self', which forbids an inline script, so a meta tag
// is where a script loaded from the helper can read it. It is written into the
// page and nowhere else: not a file, not the helper log, not health.
//
// THE ASSETS ARE A FIXED ALLOWLIST, looked up by exact name. Nothing in a
// request is decoded, joined or resolved into a path: a name is either a key of
// ASSETS or a 404 with no file bytes. So `../`, `%2e%2e%2f` and an absolute path
// cannot reach a file, because no code path turns them into one.
//
// Node-only.

"use strict";

var fs = require("node:fs");
var path = require("node:path");

var protocol = require("../shared/protocol.js");
var markdown = require("./markdown.js");

var SRC = path.join(__dirname, "..");
var JS = "application/javascript; charset=utf-8";

// name after catalog.asset's path -> {file, contentType}. A null `file` is the
// style bundle, which markdown.js builds from the three vendored CSS files.
// The style is served under its usual name so its own relative font URLs
// (./.lahe-fonts/<file>.woff2) resolve to the font entries below.
var ASSETS = {};
ASSETS["protocol.js"] = { file: path.join(SRC, "shared", "protocol.js"), contentType: JS };
ASSETS["page.js"] = { file: path.join(SRC, "layer", "catalog", "page.js"), contentType: JS };
ASSETS["view_model.js"] = { file: path.join(SRC, "layer", "catalog", "view_model.js"), contentType: JS };
ASSETS[markdown.DOC_STYLE_ASSET] = { file: null, contentType: "text/css; charset=utf-8" };
markdown.FONT_ASSETS.forEach(function (font) {
  ASSETS[markdown.FONT_ASSET_DIR + "/" + font] = {
    file: path.join(markdown.FONT_SOURCE_DIR, font),
    contentType: "font/woff2"
  };
});

// Every catalog response carries these, refusals included. No CORS header is
// ever among them: the Library is same-origin only.
var CONTENT_SECURITY_POLICY = [
  "script-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");

function securityHeaders() {
  return {
    "Content-Security-Policy": CONTENT_SECURITY_POLICY,
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  };
}

function assetUrl(name) {
  return protocol.route("catalog.asset").path + name;
}

/**
 * The asset for one name, or null. Exact key match only, own properties only,
 * so "constructor" or "__proto__" is a 404 like any other unknown name.
 *
 * @returns {{contentType: string, bytes: Buffer}|null}
 */
function readAsset(name) {
  if (typeof name !== "string" || !Object.prototype.hasOwnProperty.call(ASSETS, name)) return null;
  var entry = ASSETS[name];
  if (entry.file === null) {
    return { contentType: entry.contentType, bytes: Buffer.from(markdown.styleSheet(), "utf8") };
  }
  try {
    return { contentType: entry.contentType, bytes: fs.readFileSync(entry.file) };
  } catch (err) {
    // An allowlisted file not written yet (view_model.js before Task 2.2).
    return null;
  }
}

function escapeAttribute(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The Library page. The token is hex from the helper, escaped anyway.
 *
 * PLACEHOLDER BODY: Task 2.2 replaces what is inside <body>, and adds
 * view_model.js's script tag. The head (meta, style, scripts) stays.
 */
function renderPage(token) {
  return [
    "<!doctype html>",
    '<html lang="en"><head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="' + protocol.CATALOG_TOKEN_META + '" content="' + escapeAttribute(token) + '">',
    "<title>LAHE Library</title>",
    '<link rel="stylesheet" href="' + assetUrl(markdown.DOC_STYLE_ASSET) + '">',
    '<script src="' + assetUrl("protocol.js") + '" defer></script>',
    '<script src="' + assetUrl("page.js") + '" defer></script>',
    "</head><body>",
    '<main data-container="LAHE Library"><h1>Library</h1><p id="lahe-catalog-status">Loading.</p></main>',
    "</body></html>",
    ""
  ].join("\n");
}

module.exports = {
  ASSETS: ASSETS,
  CONTENT_SECURITY_POLICY: CONTENT_SECURITY_POLICY,
  securityHeaders: securityHeaders,
  assetUrl: assetUrl,
  readAsset: readAsset,
  renderPage: renderPage
};
