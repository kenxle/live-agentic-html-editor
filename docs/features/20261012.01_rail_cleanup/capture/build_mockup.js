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

function section(shot, i) {
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
    const notes = shot.notes
      ? "<ul class=\"mock-notes\">" + shot.notes.map((n) => "<li>" + esc(n) + "</li>").join("") + "</ul>\n"
      : "";
    return (
      '<section class="mock-section" id="state-' + (i + 1) + '">\n' +
      "<h2>" + esc(shot.label) + "</h2>\n" +
      notes +
      "<p>" + esc(shot.caption) + "</p>\n" +
      '<div class="mock-stage mock-stage--' + scheme + '">\n' +
      '<div class="mock-frame" data-mock-scheme="' + scheme + '">' + cleanHtml(shot.html) + "</div>\n" +
      "</div>\n</section>"
    );
}

const topSections = shots.map((shot, i) => (shot.top ? section(shot, i) : "")).join("\n\n");
const sections = shots.map((shot, i) => (shot.top ? "" : section(shot, i))).join("\n\n");

// THE HOVER TEXT, as words to edit. Read from the code, so the page shows what
// ships: the status dot's tip is assembled from these pieces in this order.
const REPO = path.join(__dirname, "..", "..", "..", "..");
const LIVE = require(path.join(REPO, "src", "shared", "protocol.js")).AGENT_LIVENESS;
const OVERLAY = require(path.join(REPO, "src", "layer", "overlay.js"));
const HIGHLIGHT = require(path.join(REPO, "src", "layer", "highlight.js"));

function rows(list) {
  return list
    .map(function (r) {
      return "<tr><td class=\"mock-when\">" + esc(r[0]) + "</td><td>" + esc(r[1]) + "</td></tr>";
    })
    .join("\n");
}

const QUIET = LIVE.QUIET_MS % 60000 === 0 ? LIVE.QUIET_MS / 60000 + " minutes" : LIVE.QUIET_MS / 1000 + " seconds";
const firstLine = [
  ["Your work is stored", OVERLAY.STATUS_SHORT.stored],
  ["Kept in the browser, helper not answering", OVERLAY.STATUS_SHORT.kept_locally],
  ["The page is about to reload onto a new build", OVERLAY.STATUS_SHORT.page_reloading],
  ["Added after \"Stored ·\" when an agent is listening", LIVE.CONNECTION.connected],
  ["Added after \"Stored ·\" when no agent is listening", LIVE.CONNECTION.absent],
  ["Added after \"Stored ·\" while an agent works (after " + QUIET + " waiting)", LIVE.TEXT.working],
  ["Added after \"Stored ·\" when nothing has come back (after " + QUIET + ")", LIVE.TEXT.waiting],
  ["Added after \"Stored ·\" when no agent has picked it up (after " + QUIET + ")", LIVE.TEXT.no_agent]
];
const detail = [
  ["1. The helper is up", LIVE.DETAIL.helper_up],
  ["1. The helper is down", LIVE.DETAIL.helper_down],
  ["2. An agent is listening (only when stored)", LIVE.DETAIL.agent_connected],
  ["2. No agent is listening", LIVE.DETAIL.agent_absent],
  ["2. Listening cannot be checked", LIVE.DETAIL.agent_unknown],
  ["3. The agent has a name", LIVE.DETAIL.agent_named],
  ["4. The agent has replied before", LIVE.DETAIL.replied],
  ["4. The agent has never replied", LIVE.DETAIL.never_replied],
  ["5. Something is waiting", LIVE.DETAIL.waiting],
  ["6. Always", LIVE.DETAIL.stored],
  ["7. When the first line is counting a wait", LIVE.DETAIL.save]
];
const otherTips = [
  ["Any Send button while Hold is on", HIGHLIGHT.SEND_WORDS.HELD_TIP],
  ["The collapsed pill while Hold is on (N is the count)", "N held. Nothing sends to the agent until you release Hold."]
];
const seenTitles = new Set();
shots.forEach(function (shot) {
  const pieces = shot.legend ? shot.legend.map((r) => r.html) : [shot.html];
  pieces.forEach(function (h) {
    const re = /\stitle="([^"]+)"/g;
    let m;
    while ((m = re.exec(h)) !== null) {
      const t = m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
      if (/^\d+\/\d+\/\d+/.test(t) || t.indexOf("The helper is") === 0) continue;
      seenTitles.add(t);
    }
  });
});
const buttonTips = Array.from(seenTitles).sort().map((t) => ["Button or control", t]);

const hoverSection =
  '<section class="mock-section mock-words" id="hover-text">\n' +
  "<h2>Hover text</h2>\n" +
  "<p>Every hover text on the rail, read from the code. Edit the words in the right column directly. {age}, {name} and {reply} are filled in when shown.</p>\n" +
  "<h3>Status dot: first line</h3>\n" +
  "<p>The tip opens with one short line: the first three rows, then for stored work one of the rows after it, joined with a middle dot.</p>\n" +
  '<table class="mock-table">' + rows(firstLine) + "</table>\n" +
  "<h3>Status dot: the sentences under it</h3>\n" +
  "<p>After a blank line, one sentence from each numbered group, in order.</p>\n" +
  '<table class="mock-table">' + rows(detail) + "</table>\n" +
  "<h3>Other hover text</h3>\n" +
  '<table class="mock-table">' + rows(otherTips.concat(buttonTips)) + "</table>\n" +
  "</section>";

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
.mock-notes { max-width: 680px; margin: 0 0 12px; padding-left: 22px; }
.mock-notes li { margin: 0 0 6px; }
.mock-words h3 { font-size: 16px; margin: 22px 0 4px; }
.mock-table { border-collapse: collapse; width: 100%; max-width: 820px; background: #fff; font-size: 14.5px; }
.mock-table td { border: 1px solid #dedbd3; padding: 7px 10px; vertical-align: top; }
.mock-table td.mock-when { width: 34%; color: #55524b; font-size: 13px; }
.mock-legend__row { display: flex; align-items: center; gap: 18px; position: relative; }
/* Each row is its own copy of the head, so the hovered one has to come forward
   or the rows below paint over its tip. The real rail has one head. */
.mock-legend__row:hover, .mock-stage:hover { z-index: 20; }
.mock-stage { position: relative; }
.mock-legend__label { font-size: 15px; }

/* Unfix the copy: the real rail is pinned to the window; this one sits in the page,
   at its real width, showing every card instead of scrolling. */
.mock-frame { display: block !important; position: relative !important; inset: auto !important; z-index: auto !important; width: 392px !important; height: auto !important; }
.mock-frame .rail { position: relative !important; inset: auto !important; width: 392px !important; height: auto !important; overflow: visible !important; }
.mock-frame .menu, .mock-frame .stylepanel { max-height: none !important; }
.mock-frame .submenu { position: absolute !important; top: -6px !important; right: calc(100% + 4px) !important; }
.mock-section:has(.keyspanel[data-mock-shown="open"]) .mock-stage,
.mock-section:has(.keyspanel[data-shown="open"]) .mock-stage { padding-bottom: 380px; }
.mock-frame .panes { overflow: visible !important; flex: none !important; }
.mock-frame .pane { overflow: visible !important; flex: 1 1 auto !important; min-width: 0 !important; width: 100% !important; }
.mock-frame .grip { display: none !important; }
.mock-frame .pill, .mock-frame .toasts { position: relative !important; inset: auto !important; }
.mock-frame * { user-select: text !important; -webkit-user-select: text !important; }
.mock-frame .holdbtn { cursor: pointer; }
</style>
</head>
<body>
<main class="mock-page">
<div class="mock-intro">
<h1>Rail mockup</h1>
<p>These are copies of the real review rail, taken from the built library with test data. The real rail can't be commented on, so comment here: select any text on a copy, or a nearby label, and say what should change.</p>
<p>The buttons do nothing. Your own working rail is the one pinned to the right edge of this window.</p>
</div>

${topSections}

${sections}

${hoverSection}
</main>
<script>
// The one live control on the copies: Hold sending flips, and the send
// buttons in that copy change with it, as they do in the real rail.
document.addEventListener("click", function (event) {
  var hold = event.target.closest(".mock-frame .holdbtn");
  if (!hold) return;
  event.preventDefault();
  var on = hold.getAttribute("aria-pressed") !== "true";
  hold.setAttribute("aria-pressed", on ? "true" : "false");
  // The count here is made up: the copy has no queue behind it.
  var label = hold.querySelector(".holdbtn__label");
  if (label) label.textContent = on ? "Send 2 held messages" : "Hold sending messages";
  var tip = "Messages are being held until you release them to the agent in a batch.";
  hold.closest(".mock-frame").querySelectorAll("[data-mock-send]").forEach(function (b) {
    if (on) {
      b.setAttribute("data-mock-held", "true");
      b.setAttribute("data-mock-tip", tip);
      b.textContent = "Send to queue";
    } else {
      b.removeAttribute("data-mock-held");
      b.setAttribute("data-mock-tip", "Cmd-Enter");
      b.textContent = b.getAttribute("data-mock-label") || "Send";
    }
  });
});
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(HERE, "rail_mockup.html"), page);
console.log("wrote rail_mockup.html, " + shots.length + " states");
