// Deterministic Markdown-to-review-HTML rendering. Agents never hand-roll this
// transformation, so list boundaries and block structure do not depend on the
// agent that happened to open the review.

"use strict";

var crypto = require("node:crypto");
var fs = require("node:fs");
var path = require("node:path");

var markedPackage = require("marked");
var marked = markedPackage.marked;
var stateDir = require("./state_dir.js");

var MARKDOWN_EXTENSIONS = [".md", ".markdown"];
var MERMAID_ASSET = ".lahe-mermaid-11.16.1.js";
var MERMAID_SOURCE = require.resolve("@mermaid-js/tiny");

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

function render(source, options) {
  var opts = options || {};
  var resolved = path.resolve(source);
  var markdown = fs.readFileSync(resolved, "utf8").replace(/^[\u200B\u200C\u200D\u200E\u200F\uFEFF]/, "");
  var parts = splitFrontmatter(markdown);
  var prefix = opts.assetPrefix || assetPrefix(resolved);
  var containsMermaid = false;
  var renderer = new markedPackage.Renderer();
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
    "<style>",
    ":root{color-scheme:light dark}body{font:16px/1.65 system-ui,sans-serif;max-width:52rem;margin:3rem auto;padding:0 1.25rem;color:#202124}",
    "@media(prefers-color-scheme:dark){body{color:#e8eaed}}img{max-width:100%;height:auto}pre{overflow:auto;padding:1rem;background:rgba(127,127,127,.1);border-radius:.5rem}",
    "code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}blockquote{margin-left:0;padding-left:1rem;border-left:3px solid #9aa0a6}li+li{margin-top:.35rem}",
    ".mermaid{overflow:visible;padding:1rem 0;background:transparent;text-align:center}.mermaid svg{max-width:100%;height:auto}",
    ".frontmatter{margin-bottom:2rem;color:#5f6368}.frontmatter summary{cursor:pointer}",
    "</style></head><body><main data-container=\"Markdown document\">",
    metadata,
    body,
    "</main>",
    containsMermaid ? "<script src=\"./" + MERMAID_ASSET + "\"></script><script>mermaid.initialize({startOnLoad:true,securityLevel:\"strict\"});</script>" : "",
    "</body></html>"
  ].join("\n");
}

function writeArtifact(dir, sessionId, source) {
  stateDir.ensureReviewArtifactsRoot(dir, sessionId);
  var target = artifactPath(dir, sessionId, source);
  var html = render(source);
  if (html.indexOf("./" + MERMAID_ASSET) !== -1) {
    fs.copyFileSync(MERMAID_SOURCE, path.join(path.dirname(target), MERMAID_ASSET));
  }
  stateDir.writeAtomic(target, html);
  return { target: target, assetPrefix: assetPrefix(source), assetRoot: path.dirname(path.resolve(source)) };
}

module.exports = {
  MARKDOWN_EXTENSIONS: MARKDOWN_EXTENSIONS,
  MERMAID_ASSET: MERMAID_ASSET,
  isMarkdown: isMarkdown,
  splitFrontmatter: splitFrontmatter,
  assetPrefix: assetPrefix,
  rewriteRelativeUrls: rewriteRelativeUrls,
  artifactPath: artifactPath,
  render: render,
  writeArtifact: writeArtifact
};
