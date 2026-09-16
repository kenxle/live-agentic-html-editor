// Deterministic Markdown-to-review-HTML rendering. Agents never hand-roll this
// transformation, so list boundaries and block structure do not depend on the
// agent that happened to open the review.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

// Both Markdown packages are vendored under vendor/, not installed: this tool
// runs from a git clone with no install step, so nothing may be resolved out of
// node_modules at runtime. See vendor/marked/README.md and
// vendor/mermaid/README.md for the versions and how to update them.
var markedPackage = require("../../vendor/marked/marked.cjs");
var marked = markedPackage.marked;
var links = require("./markdown_links.js");
var tabIcon = require("./tab_icon.js");
var stateDir = require("./state_dir.js");

var MARKDOWN_EXTENSIONS = [".md", ".markdown"];
var MERMAID_ASSET = ".lahe-mermaid-11.16.1.js";
var MERMAID_SOURCE = path.join(__dirname, "..", "..", "vendor", "mermaid", "mermaid.tiny.js");

// The St. Clair AI document style, vendored under vendor/stclair-doc-style. It
// is the default look for every document LAHE renders, and for HTML pages an
// agent writes for review. See that folder's README for what was copied, from
// where, and the three decisions behind it.
//
// Two ways to reach one copy. A rendered Markdown artifact inlines the whole
// bundle, so a page saved to disk stays self-contained. A page an agent wrote
// links DOC_STYLE_ASSET, and static_servers.js resolves that basename to this
// same bundle from any served directory, the way it already does for the
// Mermaid script.
var DOC_STYLE_ASSET = ".lahe-doc-style.css";
var DOC_STYLE_DIR = path.join(__dirname, "..", "..", "vendor", "stclair-doc-style");
// Order matters: tokens first, then the components that read them, then LAHE's
// layer, which maps marked's bare elements onto those components.
var DOC_STYLE_SOURCES = ["system-tokens.css", "document.css", "lahe-markdown.css"].map(function (name) {
  return path.join(DOC_STYLE_DIR, name);
});

var FONT_ASSET_DIR = ".lahe-fonts";
var FONT_SOURCE_DIR = path.join(DOC_STYLE_DIR, "fonts");
var FONT_ASSETS = [
  "hanken-grotesk-variable.woff2",
  "jetbrains-mono-variable.woff2",
  "schibsted-grotesk-variable.woff2"
];

var styleCache = null;

// document.css opens with an @import of system-tokens.css, which is correct
// when the two are served as separate files and wrong once they are one string:
// an @import has to come before every other rule, and the tokens are already
// above it here. Dropping the line is the only edit made to a vendored file,
// and it happens at read time so the copy on disk stays byte-identical to the
// personal repo's.
function stripTokenImport(css) {
  return String(css).replace(/^\s*@import\s+url\(\s*["']system-tokens\.css["']\s*\)\s*;\s*$/m, "");
}

function styleSheet() {
  if (styleCache === null) {
    styleCache = DOC_STYLE_SOURCES.map(function (file) {
      return stripTokenImport(fs.readFileSync(file, "utf8"));
    }).join("\n");
  }
  return styleCache;
}

function isMarkdown(file) {
  return MARKDOWN_EXTENSIONS.indexOf(path.extname(file).toLowerCase()) !== -1;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function splitFrontmatter(source) {
  var match = String(source).match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { frontmatter: null, body: String(source) };
  return { frontmatter: match[1], body: String(source).slice(match[0].length) };
}

function assetPrefix(source) {
  return "/.lahe-source/" + crypto.createHash("sha256").update(path.dirname(path.resolve(source))).digest("hex").slice(0, 16) + "/";
}

function isRelativeUrl(value) {
  return !!value && value.charAt(0) !== "/" && value.charAt(0) !== "#" && !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) && value.slice(0, 2) !== "//";
}

function rewriteRelativeUrls(html, prefix) {
  return String(html).replace(/\b(href|src)="([^"]*)"/g, function (whole, attr, value) {
    return isRelativeUrl(value) ? attr + "=\"" + prefix + value + "\"" : whole;
  });
}

function realOr(target) {
  try { return fs.realpathSync(target); } catch (err) { return path.resolve(target); }
}

// The document's own directory is already served under its asset prefix, so a
// link that lands back in it reuses that mount instead of registering another.
function keyedMount(prefix, resolved) {
  var dir = path.dirname(realOr(resolved));
  var mounts = {};
  mounts[prefix] = dir;
  mounts[links.mountPrefix(dir)] = dir;
  return mounts;
}

function titleFrom(source, body) {
  var heading = String(body).match(/^#\s+(.+)$/m);
  return heading ? heading[1].replace(/[*_`]/g, "").trim() : path.basename(source);
}

function artifactPath(dir, sessionId, source) {
  var resolved = path.resolve(source);
  var hash = crypto.createHash("sha256").update(resolved).digest("hex").slice(0, 16);
  var base = path.basename(resolved, path.extname(resolved)).replace(/[^A-Za-z0-9_-]+/g, "-") || "document";
  return path.join(stateDir.reviewArtifactsRoot(dir, sessionId), base + "-" + hash + ".html");
}

function sourceNote(sourcePath) {
  return "<p class=\"lahe-readonly-note\">Read-only rendered view of <code>" + escapeHtml(sourcePath) +
    "</code>. This document is not under review.</p>";
}

function render(source, options) {
  var opts = options || {};
  var resolved = path.resolve(source);
  var markdown = fs.readFileSync(resolved, "utf8").replace(/^[\u200B\u200C\u200D\u200E\u200F\uFEFF]/, "");
  var parts = splitFrontmatter(markdown);
  var prefix = opts.assetPrefix || assetPrefix(resolved);
  var registry = opts.links || links.createRegistry({ mounts: keyedMount(prefix, resolved) });
  var sourceDir = path.dirname(realOr(resolved));
  var containsMermaid = false;
  var renderer = new markedPackage.Renderer();
  renderer.link = function (token) {
    var text = this.parser.parseInline(token.tokens);
    var title = token.title ? " title=\"" + escapeHtml(token.title) + "\"" : "";
    var decision = links.classify(token.href, sourceDir, registry);
    if (decision.kind === "translate") {
      return "<a href=\"" + escapeHtml(decision.url) + "\"" + title + ">" + text + "</a>";
    }
    if (decision.kind === "inert") {
      // Not a 404 and not a custom protocol: a plain span that says where the
      // file is, so the reviewer knows the link is local rather than broken.
      return "<span class=\"lahe-local-link\" title=\"local file, open it on disk: " +
        escapeHtml(decision.target) + "\">" + text + "</span>";
    }
    return "<a href=\"" + escapeHtml(token.href) + "\"" + title + ">" + text + "</a>";
  };
  renderer.code = function (token) {
      var language = String(token.lang || "").trim().split(/\s+/)[0].toLowerCase();
      if (language === "mermaid") {
        containsMermaid = true;
        return "<pre class=\"mermaid\">" + escapeHtml(token.text) + "</pre>\n";
      }
      var className = language ? " class=\"language-" + escapeHtml(language) + "\"" : "";
      return "<pre><code" + className + ">" + escapeHtml(token.text) + "</code></pre>\n";
    };
  var body = rewriteRelativeUrls(marked.parse(parts.body, { gfm: true, breaks: false, renderer: renderer }), prefix);
  var metadata = parts.frontmatter === null
    ? ""
    : "<details class=\"frontmatter\"><summary>Document metadata</summary><pre data-block=\"Frontmatter\"><code>" +
      escapeHtml(parts.frontmatter) + "</code></pre></details>";
  var title = titleFrom(resolved, parts.body);
  return [
    "<!doctype html>",
    "<html lang=\"en\"><head><meta charset=\"utf-8\">",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">",
    "<title>" + escapeHtml(title) + "</title>",
    tabIcon.LINK,
    "<style>",
    styleSheet(),
    "</style></head><body><main data-container=\"Markdown document\">",
    opts.readOnlyNote ? sourceNote(resolved) : "",
    metadata,
    body,
    "</main>",
    containsMermaid ? "<script src=\"./" + MERMAID_ASSET + "\"></script><script>mermaid.initialize({startOnLoad:true,securityLevel:\"strict\"});</script>" : "",
    "</body></html>"
  ].join("\n");
}

function copyFonts(dir) {
  var target = path.join(dir, FONT_ASSET_DIR);
  fs.mkdirSync(target, { recursive: true });
  FONT_ASSETS.forEach(function (name) {
    fs.copyFileSync(path.join(FONT_SOURCE_DIR, name), path.join(target, name));
  });
}

function writeArtifact(dir, sessionId, source) {
  stateDir.ensureReviewArtifactsRoot(dir, sessionId);
  var target = artifactPath(dir, sessionId, source);
  var prefix = assetPrefix(source);
  var registry = links.createRegistry({ mounts: keyedMount(prefix, path.resolve(source)) });
  var html = render(source, { assetPrefix: prefix, links: registry });
  if (html.indexOf("./" + MERMAID_ASSET) !== -1) {
    fs.copyFileSync(MERMAID_SOURCE, path.join(path.dirname(target), MERMAID_ASSET));
  }
  // The stylesheet is inlined, so the only thing the artifact still reaches for
  // is the type. Copying the faces beside it is what lets the file be opened
  // from disk, or moved somewhere with no helper running, and still look right.
  copyFonts(path.dirname(target));
  stateDir.writeAtomic(target, html);
  return {
    target: target,
    assetPrefix: prefix,
    assetRoot: path.dirname(path.resolve(source)),
    linkMounts: registry.added.slice(),
    linkMountsSkipped: registry.skipped
  };
}

module.exports = {
  MARKDOWN_EXTENSIONS: MARKDOWN_EXTENSIONS,
  MERMAID_ASSET: MERMAID_ASSET,
  MERMAID_SOURCE: MERMAID_SOURCE,
  DOC_STYLE_ASSET: DOC_STYLE_ASSET,
  DOC_STYLE_SOURCES: DOC_STYLE_SOURCES,
  FONT_ASSET_DIR: FONT_ASSET_DIR,
  FONT_SOURCE_DIR: FONT_SOURCE_DIR,
  FONT_ASSETS: FONT_ASSETS,
  MOUNT_CAP: links.MOUNT_CAP,
  styleSheet: styleSheet,
  copyFonts: copyFonts,
  isMarkdown: isMarkdown,
  splitFrontmatter: splitFrontmatter,
  assetPrefix: assetPrefix,
  rewriteRelativeUrls: rewriteRelativeUrls,
  artifactPath: artifactPath,
  sourceNote: sourceNote,
  render: render,
  writeArtifact: writeArtifact
};
