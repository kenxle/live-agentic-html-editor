// Turn capture.json (written by rail_capture.spec.js) into rail_mockup.html.
//
//   node docs/features/20261012.01_rail_cleanup/capture/build_mockup.js
//
// The rail's own stylesheet is wrapped in @scope (.mock-frame), with :host
// read as the frame, so the copy looks like the rail and nothing leaks out.
// The page links no document style on purpose: a page-wide stylesheet would
// reach into the copy, which the real rail's shadow root never lets happen.

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const HERE = path.join(__dirname, "..");
const shots = JSON.parse(fs.readFileSync(path.join(HERE, "capture.json"), "utf8"));

function scopeRule(text) {
  return text
    .replace(/:host\(([^()]*)\)/g, ":scope$1")
    .replace(/:host\b/g, ":scope")
    .replace(/data-lahe-/g, "data-mock-")
    .replace(/\[data-lahe(?=[\]=])/g, "[data-mock");
}

function cleanHtml(html) {
  return html.replace(/\sdata-lahe="[^"]*"/g, "");
}

const first = shots[0];
const scoped = first.css.map(scopeRule).join("\n");
const outside = first.outside.join("\n");

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const sections = shots
  .map(function (shot, i) {
    const scheme = /data-mock-scheme="dark"/.test(shot.hostAttrs) ? "dark" : "light";
    if (shot.legend) {
      return (
        '<section class="mock-section" id="state-' + (i + 1) + '">\n' +
        "<h2>" + esc(shot.label) + "</h2>\n" +
        "<p>" + esc(shot.caption) + "</p>\n" +
        '<div class="mock-stage mock-legend">\n' +
        shot.legend
          .map(function (row) {
            return (
              '<div class="mock-legend__row"><div class="mock-frame" data-mock-scheme="light"><aside class="rail">' +
              cleanHtml(row.html) +
              '</aside></div><span class="mock-legend__label">' + esc(row.label) + "</span></div>"
            );
          })
          .join("\n") +
        "\n</div>\n</section>"
      );
    }
    return (
      '<section class="mock-section" id="state-' + (i + 1) + '">\n' +
      "<h2>" + esc(shot.label) + "</h2>\n" +
      "<p>" + esc(shot.caption) + "</p>\n" +
      '<div class="mock-stage mock-stage--' + scheme + '">\n' +
      '<div class="mock-frame" data-mock-scheme="' + scheme + '">' + cleanHtml(shot.html) + "</div>\n" +
      "</div>\n</section>"
    );
  })
  .join("\n\n");

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Rail mockup</title>
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>%F0%9F%A7%B9</text></svg>">
<style>
${outside}
@scope (.mock-frame) {
${scoped}
}

/* The page around the copies. Class-scoped only, so none of it reaches in. */
html, body { margin: 0; background: #f4f3ef; }
.mock-page { font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #1c1c1a; max-width: 900px; padding: 32px 48px 120px; }
.mock-page h1 { font-size: 28px; margin: 0 0 8px; }
.mock-page .mock-intro p { margin: 0 0 10px; max-width: 640px; }
.mock-section { margin-top: 48px; }
.mock-section > h2 { font-size: 20px; margin: 0 0 4px; }
.mock-section > p { margin: 0 0 14px; color: #55524b; }
.mock-stage { padding: 24px; border-radius: 12px; background: #e9e7e1; display: inline-block; }
.mock-stage--dark { background: #12151a; }
.mock-legend { display: flex; flex-direction: column; gap: 10px; }
.mock-legend__row { display: flex; align-items: center; gap: 18px; }
.mock-legend__label { font-size: 15px; }

/* Unfix the copy: the real rail is pinned to the window; this one sits in the page,
   at its real width, showing every card instead of scrolling. */
.mock-frame { display: block !important; position: relative !important; inset: auto !important; z-index: auto !important; width: 392px !important; height: auto !important; }
.mock-frame .rail { position: relative !important; inset: auto !important; width: 392px !important; height: auto !important; }
.mock-frame .panes { overflow: visible !important; flex: none !important; }
.mock-frame .pane { overflow: visible !important; flex: 1 1 auto !important; min-width: 0 !important; width: 100% !important; }
.mock-frame .grip { display: none !important; }
.mock-frame .pill, .mock-frame .toasts { position: relative !important; inset: auto !important; }
.mock-frame * { user-select: text !important; -webkit-user-select: text !important; }
</style>
</head>
<body>
<main class="mock-page">
<div class="mock-intro">
<h1>Rail mockup</h1>
<p>These are copies of the real review rail, taken from the built library with test data. The real rail can't be commented on, so comment here: select any text on a copy, or a nearby label, and say what should change.</p>
<p>The buttons do nothing. Your own working rail is the one pinned to the right edge of this window.</p>
</div>

${sections}
</main>
</body>
</html>
`;

fs.writeFileSync(path.join(HERE, "rail_mockup.html"), page);
console.log("wrote rail_mockup.html, " + shots.length + " states");
