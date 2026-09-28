// The Library page: its HTML template, the fixed asset allowlist, and the
// response headers every catalog route sends.
//
// Owner: Library 1.2 (routes, allowlist, headers). Library 2.2 owns the
// template BODY in renderPage, the page's inline <style> (PAGE_STYLE), and the
// view_model.js script tag. The meta tag, the stylesheet and script tags, and
// the headers are what the route checks rely on.
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

var crypto = require("node:crypto");
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
// ever among them: the Library is same-origin only. CONTENT_SECURITY_POLICY is
// set below PAGE_STYLE, since it carries that style's hash.
var CONTENT_SECURITY_POLICY;

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

// The page's own look, on top of the St. Clair AI document style the helper
// serves. Inline because the asset allowlist is fixed; the policy allows this
// one <style> by its sha256 hash, so no other inline style or script runs.
//
// Colours go through --lib-* names that point at the shared tokens, so the
// shared tokens are never redefined here (system-tokens.css forbids it), and a
// dark palette is the same names pointed elsewhere. The dark values are the
// ones the feature-doc template uses on the same tokens.
//
// House rules: no pills, no gradients, no shadows, no all caps, no single-side
// coloured borders. Motion only where it says something is in flight.
var PAGE_STYLE = [
  ":root{color-scheme:light dark;",
  "--lib-bg:var(--surface);--lib-fg:var(--on-surface);--lib-soft:var(--on-surface-soft);",
  "--lib-faint:var(--on-surface-faint);--lib-rule:var(--border);--lib-accent:var(--cobalt);",
  "--lib-strong:var(--ink);--lib-on-strong:var(--white);--lib-card:var(--white);--lib-raised:var(--paper);",
  "--lib-tint-info:var(--cobalt-tint);--lib-tint-ok:var(--sage-tint);--lib-tint-warn:var(--purple-tint);",
  "--lib-ok:var(--sage);--lib-warn:var(--purple);--lib-live:var(--sage-fill);--lib-focus:var(--link)}",
  "@media (prefers-color-scheme: dark){:root{",
  "--lib-bg:var(--ink);--lib-fg:var(--white);--lib-soft:var(--ink-soft-ondark);--lib-faint:var(--ink-faint-ondark);",
  "--lib-rule:var(--rule-ondark);--lib-accent:color-mix(in srgb,var(--cobalt) 45%,var(--white));",
  "--lib-strong:var(--white);--lib-on-strong:var(--ink);",
  "--lib-card:color-mix(in srgb,var(--white) 4%,var(--ink));--lib-raised:color-mix(in srgb,var(--white) 8%,var(--ink));",
  "--lib-tint-info:color-mix(in srgb,var(--cobalt) 22%,var(--ink));",
  "--lib-tint-ok:color-mix(in srgb,var(--sage) 30%,var(--ink));",
  "--lib-tint-warn:color-mix(in srgb,var(--purple) 45%,var(--ink));",
  "--lib-ok:var(--sage-fill);--lib-warn:color-mix(in srgb,var(--purple) 30%,var(--white));",
  "--lib-focus:var(--sage-fill)}}",
  "body{background:var(--lib-bg);color:var(--lib-fg);font-size:var(--text-small);line-height:1.5}",
  ":focus-visible{outline-color:var(--lib-focus)}",
  "[hidden]{display:none !important}",

  // The masthead: the title and who hand-overs go to.
  ".lib-head{padding-block:var(--s6) var(--s4)}",
  ".lib-head h1{font-size:var(--text-h2);margin:0 0 var(--s2)}",
  ".lib-agent{margin:0;display:flex;align-items:center;gap:var(--s2);color:var(--lib-soft);font-size:var(--text-meta)}",
  ".lib-agent::before{content:'';flex:none;width:8px;height:8px;border-radius:50%;", // px: a status dot
  "border:1.5px solid var(--lib-faint)}",
  ".lib-agent[data-attached='true']::before{background:var(--lib-live);border-color:var(--lib-live)}",

  // The tool bar stays on screen while the list scrolls.
  ".lib-tools{position:sticky;top:0;z-index:2;background:var(--lib-bg);display:flex;gap:var(--s3);",
  "flex-wrap:wrap;align-items:center;padding-block:var(--s3)}",
  // The rule under the bar spans the column's content, not its gutter.
  ".lib-tools::after{content:'';position:absolute;left:var(--gutter);right:var(--gutter);bottom:0;",
  "border-bottom:1px solid var(--lib-rule)}",
  ".lib-tools input,.lib-tools select{font:inherit;font-size:var(--text-small);color:var(--lib-fg);",
  "background:var(--lib-card);border:1px solid var(--lib-rule);border-radius:var(--r);padding:7px 10px}", // px: control padding
  ".lib-tools input{flex:1 1 280px;min-width:0}",
  ".lib-tools select{flex:0 0 auto}",

  // The banner: what an Open is doing, or why the list is stale.
  ".lib-banner{margin-top:var(--s4)}",
  ".lib-banner-box{display:flex;align-items:center;gap:var(--s3);flex-wrap:wrap;padding:var(--s3) var(--s4);",
  "border-radius:var(--r);background:var(--lib-tint-info);animation:lib-arrive .18s ease-out}",
  ".lib-banner-box[data-tone='ok']{background:var(--lib-tint-ok)}",
  ".lib-banner-box[data-tone='error']{background:var(--lib-tint-warn)}",
  ".lib-banner-box p{margin:0;flex:1 1 auto}",
  "@keyframes lib-arrive{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}",

  "main{padding-bottom:var(--s7)}",
  ".lib-quiet{color:var(--lib-faint);margin:var(--s6) 0}",
  ".lib-notice{margin:var(--s4) 0 0;padding:var(--s3) var(--s4);border-radius:var(--r);background:var(--lib-tint-warn)}",

  // Sections under the house's hanging rule.
  ".lib-section{margin-top:var(--s6)}",
  ".lib-section>h2{font-size:var(--text-h4);margin:0 0 var(--s4);padding-top:var(--s3);border-top:var(--divider);",
  "border-top-color:var(--lib-fg)}",

  // The session card.
  ".lib-card{border:1px solid var(--lib-rule);border-radius:var(--r-lg);background:var(--lib-card);margin:0 0 var(--s3)}",
  ".lib-card>summary{list-style:none;cursor:pointer;display:grid;grid-template-columns:auto 1fr;gap:var(--s1) var(--s3);",
  "align-items:baseline;padding:var(--s3) var(--s4);border-radius:var(--r-lg)}",
  ".lib-card>summary::-webkit-details-marker{display:none}",
  ".lib-card>summary::marker{content:''}",
  ".lib-card>summary:hover{background:var(--lib-raised)}",
  ".lib-chev{grid-row:1 / span 2;align-self:center;width:8px;height:8px;margin-right:var(--s1);", // px: a drawn chevron
  "border-right:2px solid var(--lib-faint);border-bottom:2px solid var(--lib-faint);transform:rotate(-45deg);",
  "transition:transform .15s ease}",
  ".lib-card[open]>summary .lib-chev{transform:rotate(45deg)}",
  ".lib-card-title{font-family:var(--font-display);font-weight:var(--w-display);font-size:var(--text-body);line-height:1.3}",
  ".lib-card-meta{display:flex;flex-wrap:wrap;gap:0 var(--s3);color:var(--lib-faint);font-size:var(--text-meta)}",
  ".lib-card-meta>span+span::before{content:'\\00b7';margin-right:var(--s3);color:var(--lib-faint)}",
  ".lib-project{color:var(--lib-soft);font-weight:var(--w-medium)}",
  ".lib-waiting{color:var(--lib-accent);font-weight:var(--w-display)}",

  // Rows.
  ".lib-rows{list-style:none;margin:0;padding:0;border-top:1px solid var(--lib-rule)}",
  ".lib-rows>li{padding:0;margin:0}",
  ".lib-rows>li::before{content:none}",
  ".lib-row{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:var(--s1) var(--s3);", // px: the star's column
  "padding:var(--s3) var(--s4);border-bottom:1px solid var(--lib-rule)}",
  ".lib-rows>li:last-child .lib-row{border-bottom:0}",
  ".lib-row-main{min-width:0}",
  ".lib-name{font-family:var(--font-display);font-weight:var(--w-display);font-size:var(--text-body);line-height:1.35;",
  "margin:0;overflow-wrap:anywhere}",
  ".lib-where{margin:2px 0 0;color:var(--lib-faint);font-size:var(--text-meta);overflow-wrap:anywhere}", // px: hugs the name
  ".lib-facts{margin:var(--s1) 0 0;display:flex;flex-wrap:wrap;gap:var(--s1) var(--s3);font-size:var(--text-meta);color:var(--lib-soft)}",
  ".lib-badge{display:inline-flex;align-items:center;gap:6px}", // px: dot to word
  ".lib-badge::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--lib-faint)}", // px: a dot
  ".lib-badge[data-badge='served']::before{background:var(--lib-live)}",
  ".lib-badge[data-badge='watching']::before{background:var(--lib-accent)}",
  ".lib-line{margin:var(--s2) 0 0;display:flex;gap:var(--s2);align-items:baseline;font-size:var(--text-meta)}",
  ".lib-line[data-tone='warn']{color:var(--lib-warn)}",
  ".lib-line[data-tone='quiet']{color:var(--lib-faint)}",
  ".lib-line[data-tone='info']{color:var(--lib-soft)}",
  // The mark sits beside the first line of the note and never wraps alone.
  ".lib-note{margin:var(--s2) 0 0;display:grid;grid-template-columns:8px minmax(0,1fr);gap:0 var(--s2);", // px: the mark's column
  "align-items:baseline;font-size:var(--text-meta);color:var(--lib-fg)}",
  ".lib-note>.lib-btn{grid-column:2;justify-self:start}",
  ".lib-mark{width:8px;height:8px;border-radius:50%;background:var(--lib-faint);align-self:start;margin-top:.45em}", // px: a status dot
  ".lib-note[data-tone='ok'] .lib-mark{background:var(--lib-ok)}",
  ".lib-note[data-tone='warn'] .lib-mark{background:var(--lib-warn)}",
  ".lib-note[data-tone='info'] .lib-mark{background:var(--lib-accent)}",
  ".lib-note[data-busy='true'] .lib-mark{animation:lib-pulse 1.4s ease-in-out infinite}",
  "@keyframes lib-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.35;transform:scale(.7)}}",
  ".lib-pages{margin:var(--s2) 0 0;padding:0;list-style:none;font-size:var(--text-meta);color:var(--lib-soft)}",
  ".lib-pages>li{margin:0;padding:0 0 0 var(--s3);border-left:1px solid var(--lib-rule)}",
  ".lib-pages>li::before{content:none}",
  ".lib-pages .lib-path{color:var(--lib-faint);margin-left:var(--s2)}",

  // Buttons: one filled primary (Open), outlined secondaries, and a quiet text button.
  ".lib-acts{display:flex;gap:var(--s2);flex-wrap:wrap;justify-content:flex-end;align-items:flex-start}",
  ".lib-btn{font:inherit;font-size:var(--text-meta);font-weight:var(--w-medium);line-height:1.2;white-space:nowrap;",
  "color:var(--lib-fg);background:transparent;border:1px solid var(--lib-rule);border-radius:var(--r);",
  "padding:7px 12px;cursor:pointer}", // px: control padding
  ".lib-btn:hover{border-color:var(--lib-fg)}",
  ".lib-btn[data-primary='true']{background:var(--lib-strong);color:var(--lib-on-strong);border-color:var(--lib-strong)}",
  ".lib-btn[data-primary='true']:hover{background:var(--lib-accent);border-color:var(--lib-accent);color:var(--white)}",
  ".lib-btn[data-quiet='true']{border-color:transparent;padding-inline:var(--s2);color:var(--lib-soft);",
  "text-decoration:underline;text-underline-offset:3px}",
  ".lib-btn[data-quiet='true']:hover{color:var(--lib-fg);border-color:transparent}",
  ".lib-line>.lib-btn[data-quiet='true'],.lib-note>.lib-btn[data-quiet='true']{padding-inline:0}",
  ".lib-btn:disabled{opacity:.4;cursor:not-allowed}",
  ".lib-btn:disabled:hover{border-color:var(--lib-rule)}",
  ".lib-btn[data-primary='true']:disabled:hover{background:var(--lib-strong);border-color:var(--lib-strong);color:var(--lib-on-strong)}",
  ".lib-btn[aria-busy='true']{border-style:dashed}",
  ".lib-star{width:32px;height:32px;padding:0;border:0;background:none;cursor:pointer;font-size:20px;line-height:1;", // px: the star's hit area
  "color:var(--lib-faint);border-radius:var(--r)}",
  ".lib-star:hover{color:var(--lib-fg)}",
  ".lib-star[aria-pressed='true']{color:var(--lib-accent)}",
  ".lib-star[aria-busy='true']{animation:lib-pulse 1s ease-in-out infinite}",

  // The hand-off panel under a row.
  ".lib-panel{grid-column:2 / -1;margin-top:var(--s2);padding:var(--s3) var(--s4);border-radius:var(--r);",
  "background:var(--lib-tint-info)}",
  ".lib-panel p{margin:0 0 var(--s2)}",
  ".lib-panel pre{margin:0 0 var(--s3);white-space:pre-wrap;background:var(--lib-card);color:var(--lib-fg);",
  "font-size:var(--text-meta);max-height:16em;overflow:auto}",
  ".lib-panel-acts{display:flex;gap:var(--s2);align-items:center;flex-wrap:wrap}",
  ".lib-copy-status{color:var(--lib-soft);font-size:var(--text-meta)}",

  // Missing.
  ".lib-missing-toggle{margin-top:var(--s5)}",
  ".lib-missing .lib-rows{border:1px solid var(--lib-rule);border-radius:var(--r-lg);background:var(--lib-card)}",
  ".lib-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:var(--s3);flex-wrap:wrap;",
  "padding-top:var(--s3);border-top:var(--divider);border-top-color:var(--lib-fg);margin:0 0 var(--s4)}",
  ".lib-section-head h2{font-size:var(--text-h4);margin:0}",

  // The confirm dialog.
  // Doubled class: the house column rule is (0,2,0) and would otherwise give
  // the dialog the page column's width and gutter.
  ".lib-dialog.lib-dialog{border:1px solid var(--lib-rule);border-radius:var(--r-lg);background:var(--lib-bg);color:var(--lib-fg);",
  "padding:var(--s5);max-width:min(560px,calc(100vw - 32px));margin:auto}", // px: the dialog's width cap and phone gutter
  ".lib-dialog::backdrop{background:rgba(20,19,16,.45)}",
  ".lib-dialog h2{font-size:var(--text-h4);margin:0 0 var(--s3)}",
  ".lib-dialog p{margin:0 0 var(--s3)}",
  ".lib-dialog ul{margin:0 0 var(--s4)}",
  ".lib-dialog li{font-size:var(--text-small);margin-bottom:var(--s1)}",
  ".lib-dialog-acts{display:flex;gap:var(--s2);flex-wrap:wrap;justify-content:flex-end}",

  "@media (max-width:720px){",
  ".lib-row{grid-template-columns:32px minmax(0,1fr)}",
  ".lib-acts{grid-column:2;justify-content:flex-start}",
  ".lib-panel{grid-column:1 / -1}}",
  "@media (prefers-reduced-motion: reduce){*{animation:none !important;transition:none !important}}"
].join("");

// Everything defaults to 'none'. Each kind the page uses comes from its own
// origin: its scripts, its list and action calls, the style bundle and its
// fonts. Images also allow data:, which the document style's callout icons
// use. The one inline <style> is allowed by hash, never by 'unsafe-inline'.
CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "connect-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self' 'sha256-" + crypto.createHash("sha256").update(PAGE_STYLE, "utf8").digest("base64") + "'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join("; ");

/**
 * The Library page. The token is hex from the helper, escaped anyway.
 *
 * The head (meta, style, scripts) is Task 1.2's contract with the routes: the
 * token in its meta tag and every script loaded by src. The body is Task 2.2's:
 * fixed landmarks that page.js fills with textContent, and nothing from a
 * review ever written here.
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
    "<style>" + PAGE_STYLE + "</style>",
    '<script src="' + assetUrl("protocol.js") + '" defer></script>',
    '<script src="' + assetUrl("view_model.js") + '" defer></script>',
    '<script src="' + assetUrl("page.js") + '" defer></script>',
    "</head><body>",
    '<header class="lib-head"><h1>LAHE Library</h1><p class="lib-agent" id="lahe-catalog-agent"></p></header>',
    '<div class="lib-tools" role="search">',
    '<input type="search" id="lahe-catalog-search" aria-label="Search the Library" autocomplete="off">',
    '<select id="lahe-catalog-project" aria-label="Filter by project"></select>',
    "</div>",
    '<div class="lib-banner" id="lahe-catalog-banner" role="status" aria-live="polite"></div>',
    '<main id="lahe-catalog-main" data-container="LAHE Library"><p class="lib-quiet" id="lahe-catalog-status">Loading the Library.</p></main>',
    '<dialog class="lib-dialog" id="lahe-catalog-confirm" aria-labelledby="lahe-catalog-confirm-title"></dialog>',
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
