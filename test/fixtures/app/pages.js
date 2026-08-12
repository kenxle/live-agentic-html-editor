// The app fixture's HTML. Server-rendered strings, no template engine, because
// the fixture obeys the repo's zero-dependency rule the same way the tool does.
//
// Plan task 0C. Three pathnames plus the login screen, linked to each other with
// ordinary anchors so a test navigates the way a person does (D3, browse is
// fully native: links navigate and the app's own JavaScript sees every event).

"use strict";

const { CLIENTS, FEED_LINES, REPORTS } = require("./data");

/** The two knobs a test sets on the URL, carried across every in-app link. */
const CARRIED_PARAMS = ["morph", "poll"];

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Rebuild the query string a link should carry. Only the fixture's own knobs
 * travel; anything else a test puts on the URL stays where it was put.
 */
function carriedQuery(searchParams) {
  const out = new URLSearchParams();
  for (const name of CARRIED_PARAMS) {
    if (searchParams.has(name)) out.set(name, searchParams.get(name));
  }
  const text = out.toString();
  return text ? "?" + text : "";
}

function link(href, label, searchParams) {
  return '<a href="' + escapeHtml(href + carriedQuery(searchParams)) + '">' + escapeHtml(label) + "</a>";
}

function nav(current, searchParams) {
  const items = [
    ["/", "Dashboard"],
    ["/clients", "Clients"],
    ["/reports", "Reports"]
  ];
  const rendered = items
    .map(function (pair) {
      const active = pair[0] === current ? ' class="current"' : "";
      return "<li" + active + ">" + link(pair[0], pair[1], searchParams) + "</li>";
    })
    .join("");
  return '<nav class="app-nav"><ul>' + rendered + "</ul></nav>";
}

function layout(options) {
  const searchParams = options.searchParams;
  const scripts = (options.scripts || [])
    .map(function (src) {
      return '<script src="' + escapeHtml(src) + '" defer></script>';
    })
    .join("");
  return (
    "<!doctype html>\n" +
    '<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    "<title>" +
    escapeHtml(options.title) +
    " | Steady Thread coaching</title>\n" +
    '<link rel="stylesheet" href="/assets/app.css">\n' +
    scripts +
    "\n</head>\n<body" +
    (options.bodyAttrs ? " " + options.bodyAttrs : "") +
    ">\n" +
    '<header class="app-header"><span class="wordmark">Steady Thread</span>' +
    (options.sessionEmail
      ? '<span id="signed-in-as">Signed in as ' + escapeHtml(options.sessionEmail) + "</span>"
      : "") +
    "</header>\n" +
    nav(options.current, searchParams) +
    '\n<main class="app-main">\n' +
    options.body +
    "\n</main>\n</body>\n</html>\n"
  );
}

/**
 * The feed's contents: the region the poll-and-morph engine rewrites.
 *
 * `cursor` advances on every poll, so consecutive renders genuinely differ and a
 * test can tell a morph that ran from one that quietly did nothing.
 */
function feedItems(cursor) {
  function pick(list) {
    return list[cursor % list.length];
  }
  return (
    '<article id="feed-latest" class="feed-item"><h3>Latest activity</h3><p>' +
    escapeHtml(pick(FEED_LINES.latest)) +
    " (update " +
    cursor +
    ")</p></article>" +
    '<article id="feed-coach-note" class="feed-item">' +
    escapeHtml(pick(FEED_LINES.coachNote)) +
    "</article>" +
    '<article id="feed-highlight" class="feed-item">' +
    escapeHtml(pick(FEED_LINES.highlight)) +
    "</article>" +
    '<article id="feed-queue" class="feed-item"><h3>Tonight\'s queue</h3><p>' +
    escapeHtml(pick(FEED_LINES.queue)) +
    " (update " +
    cursor +
    ")</p></article>"
  );
}

function feedRegion(cursor) {
  return (
    '<section class="feed-panel"><h2>Live feed</h2>' +
    '<div id="feed" data-morph-target>' +
    feedItems(cursor) +
    "</div></section>"
  );
}

function dashboardPage(state) {
  const body =
    "<h1>Coach dashboard</h1>\n" +
    "<p class=\"lede\">Nine clients checked in this week. Two are drifting off their program, and one just hit a squat number she has been chasing since February.</p>\n" +
    "<section class=\"focus\"><h2>Today's focus</h2>" +
    "<p>The two people to reach before lunch are Devon, who has missed two easy runs in a row, and Priya, who asked a real question and got a thumbs up instead of an answer.</p>" +
    "<p>Everyone else is on program and does not need anything from you today. Leaving them alone is a decision, not neglect.</p>" +
    "</section>\n" +
    '<section class="session-logger"><h2>Log a session</h2>' +
    "<p>Sessions logged in this browser tab: <output id=\"session-count\">0</output></p>" +
    '<button type="button" id="log-session">Log a session</button>' +
    "</section>\n" +
    feedRegion(state.cursor);

  return layout({
    title: "Coach dashboard",
    current: "/",
    body: body,
    searchParams: state.searchParams,
    sessionEmail: state.sessionEmail,
    scripts: ["/assets/app.js", "/assets/morph-engine.js"]
  });
}

function clientsPage(state) {
  const cards = CLIENTS.map(function (client) {
    return (
      '<article class="client-card" id="client-' +
      escapeHtml(client.slug) +
      '"><h3>' +
      escapeHtml(client.name) +
      '</h3><p class="program">' +
      escapeHtml(client.program) +
      ", " +
      escapeHtml(client.status) +
      "</p><p>" +
      escapeHtml(client.summary) +
      "</p></article>"
    );
  }).join("");

  const options = CLIENTS.map(function (client) {
    return '<option value="' + escapeHtml(client.slug) + '">' + escapeHtml(client.name) + "</option>";
  }).join("");

  const notes = state.notes.length
    ? state.notes
        .map(function (note) {
          return (
            '<li class="saved-note"><strong>' +
            escapeHtml(note.clientName) +
            "</strong> <span>" +
            escapeHtml(note.body) +
            "</span></li>"
          );
        })
        .join("")
    : '<li class="saved-note empty">No notes saved yet.</li>';

  const body =
    "<h1>Clients</h1>\n" +
    '<p class="lede">Nine active clients, four of them shown here while the roster page is being rewritten.</p>\n' +
    '<section class="roster">' +
    cards +
    "</section>\n" +
    '<section class="note-form"><h2>Save a note</h2>' +
    '<form method="post" action="' +
    escapeHtml("/clients/notes" + carriedQuery(state.searchParams)) +
    '">' +
    '<label for="note-client">Client</label>' +
    '<select id="note-client" name="client">' +
    options +
    "</select>" +
    '<label for="note-body">Note</label>' +
    '<textarea id="note-body" name="note" rows="3"></textarea>' +
    '<button type="submit">Save note</button>' +
    "</form></section>\n" +
    '<section class="notes"><h2>Saved notes</h2><ul id="saved-notes">' +
    notes +
    "</ul></section>";

  return layout({
    title: "Clients",
    current: "/clients",
    body: body,
    searchParams: state.searchParams,
    sessionEmail: state.sessionEmail
  });
}

function loginPage(state) {
  const error = state.error
    ? '<p id="login-error" class="error">' + escapeHtml(state.error) + "</p>"
    : "";
  const body =
    "<h1>Sign in</h1>\n" +
    '<p class="lede">Reports are for the account holder, so this screen sits in front of them.</p>\n' +
    error +
    '<form method="post" action="' +
    escapeHtml("/login" + carriedQuery(state.searchParams)) +
    '">' +
    '<input type="hidden" name="next" value="' +
    escapeHtml(state.next || "/reports") +
    '">' +
    '<label for="email">Email</label>' +
    '<input id="email" name="email" type="email" autocomplete="username">' +
    '<label for="password">Password</label>' +
    '<input id="password" name="password" type="password" autocomplete="current-password">' +
    '<button type="submit">Sign in</button>' +
    "</form>\n" +
    '<p class="hint">The fixture account is coach@steadythread.test with the password kettlebell.</p>';

  return layout({
    title: "Sign in",
    current: "/login",
    body: body,
    searchParams: state.searchParams
  });
}

function reportsPage(state) {
  const sections = REPORTS.map(function (report) {
    return "<section class=\"report\"><h2>" + escapeHtml(report.title) + "</h2><p>" + escapeHtml(report.body) + "</p></section>";
  }).join("");

  const body =
    "<h1>Reports</h1>\n" +
    '<p class="lede">Everything below counts the last thirty days and refreshes overnight.</p>\n' +
    sections +
    "\n" +
    feedRegion(state.cursor);

  return layout({
    title: "Reports",
    current: "/reports",
    body: body,
    searchParams: state.searchParams,
    sessionEmail: state.sessionEmail,
    scripts: ["/assets/app.js", "/assets/morph-engine.js"]
  });
}

module.exports = {
  escapeHtml,
  carriedQuery,
  feedItems,
  dashboardPage,
  clientsPage,
  loginPage,
  reportsPage
};
