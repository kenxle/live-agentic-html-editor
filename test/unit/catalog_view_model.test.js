"use strict";

// The Library page's view model: a list response plus the page's own state in,
// sections, cards, rows, button states and every string out. LAHE Library plan,
// Task 2.2, "View model (2.2)" in the Test List and the Page Spec's table of
// strings by state.
//
// Pure: no DOM, no clock. Every build takes `now`, and every time is formatted
// in UTC here so the strings do not depend on the machine's zone.

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const vm = require("../../src/layer/catalog/view_model.js");

const LIST = require(path.join(__dirname, "..", "fixtures", "catalog_list.json"));
const NOW = Date.parse("2026-09-28T16:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const OPTS = { timeZone: "UTC" };

function freshList() {
  return JSON.parse(JSON.stringify(LIST));
}

function build(list, state) {
  return vm.build(list, state || vm.initialState(), NOW, OPTS);
}

function allCards(view) {
  return view.sections.reduce((acc, s) => acc.concat(s.cards), []);
}

function allRows(view) {
  const rows = [];
  allCards(view).forEach((c) => c.rows.forEach((r) => rows.push(r)));
  if (view.missing && view.missing.section) view.missing.section.rows.forEach((r) => rows.push(r));
  return rows;
}

function row(view, id) {
  const found = allRows(view).filter((r) => r.id === id);
  assert.equal(found.length, 1, "row " + id + " appears exactly once in the view");
  return found[0];
}

function card(view, id) {
  const found = allCards(view).filter((c) => c.id === id);
  assert.equal(found.length, 1, "card " + id + " appears exactly once in the view");
  return found[0];
}

function reviewIn(list, id) {
  for (const s of list.sessions) for (const r of s.reviews) if (r.id === id) return r;
  throw new Error("no review " + id);
}

function sessionIn(list, id) {
  return list.sessions.filter((s) => s.id === id)[0];
}

function okState() {
  return vm.withFetch(vm.initialState(), { ok: true });
}

// ---------------------------------------------------------------------------
// Request states on a row
// ---------------------------------------------------------------------------

test("a waiting request says who it waits for, and marks the asked button busy", () => {
  const view = build(freshList(), okState());
  const r = row(view, "r_brief");
  assert.equal(r.note.text, "Waiting for document index.");
  assert.equal(r.note.busy, true);
  assert.equal(r.buttons.pickup.busy, true);
  assert.equal(r.buttons.launch.busy, false);
  assert.equal(r.buttons.pickup.enabled, true, "a second click is allowed so it can say it is already waiting");
});

test("a done request shows the agent's answer", () => {
  const r = row(build(freshList(), okState()), "r_spec");
  assert.equal(r.note.text, "document index: watching Shared Title");
  assert.equal(r.note.busy, false);
  assert.equal(r.buttons.pickup.busy, false);
  assert.equal(r.buttons.pickup.enabled, true);
});

test("a refused launch says why, once, and offers the hand-off message", () => {
  const r = row(build(freshList(), okState()), "r_notes");
  // The answer already ends in a period; the row does not add a second one.
  assert.equal(r.note.text, "document index couldn't take it: I can't open a terminal here.");
  assert.equal(r.note.copyHandoff, true);
  assert.equal(r.buttons.launch.enabled, true);
});

test("a refused pick-up does not offer the hand-off message", () => {
  const list = freshList();
  reviewIn(list, "r_notes").request.action = "pickup";
  const r = row(build(list, okState()), "r_notes");
  assert.equal(r.note.copyHandoff, false);
});

test("an expired request from the list words its reason", () => {
  const list = freshList();
  // The reader's own fixture: this request expired on a dead monitor.
  assert.equal(reviewIn(list, "r_wt_gone").request.reason, "monitor_dead");
  const r = row(build(list, okState()), "r_wt_gone");
  assert.equal(r.note.text, "Not picked up. document index stopped watching before it answered.");
  assert.equal(r.buttons.pickup.busy, false);
});

test("a row with no request has no note", () => {
  const r = row(build(freshList(), okState()), "r_mounted");
  assert.equal(r.note, null);
});

// ---------------------------------------------------------------------------
// The header and the attached agent
// ---------------------------------------------------------------------------

test("the header names the attached agent before any click", () => {
  const view = build(freshList(), okState());
  assert.equal(view.title, "LAHE Library");
  assert.equal(view.agent.attached, true);
  assert.equal(view.agent.text, "Hand-overs go to: document index");
});

test("an attached agent with no name is named by its session id", () => {
  const list = freshList();
  list.attached.name = null;
  assert.equal(build(list, okState()).agent.text, "Hand-overs go to: s_index");
});

test("with no agent attached the header says so", () => {
  const list = freshList();
  list.attached = null;
  const view = build(list, okState());
  assert.equal(view.agent.attached, false);
  assert.equal(view.agent.text, "No agent attached. Open still works; hand-overs give you a message to paste.");
});

test("an attached agent that stopped watching is not offered hand-overs", () => {
  const list = freshList();
  list.attached.watching = false;
  const view = build(list, okState());
  assert.equal(view.agent.attached, false);
  assert.equal(
    view.agent.text,
    "document index is attached but has stopped watching. Open still works; hand-overs give you a message to paste."
  );
});

test("with no agent, Pick this up and Launch show the hand-off panel instead of asking", () => {
  const list = freshList();
  list.attached = null;
  ["pickup", "launch"].forEach((action) => {
    const decision = vm.decide(list, okState(), "r_mounted", action, {});
    assert.equal(decision.kind, "handoff", action);
    const view = build(list, vm.withPanel(okState(), "r_mounted", "no_agent"));
    const r = row(view, "r_mounted");
    assert.equal(
      r.panel.intro,
      "No agent is attached. This is the same hand-off message the rail already copies. Paste it into any agent:"
    );
    assert.equal(r.panel.message, protocol.AGENT_LIVENESS.handoffMessage("s_coach", "coach activity", false));
    assert.equal(r.panel.copyLabel, "Copy");
  });
});

test("the hand-off panel for a legacy review points at the session list", () => {
  const list = freshList();
  list.attached = null;
  const view = build(list, vm.withPanel(okState(), "r_legacy", "no_agent"));
  assert.equal(row(view, "r_legacy").panel.message, protocol.AGENT_LIVENESS.handoffMessage(null, null, false));
});

// ---------------------------------------------------------------------------
// The default view: sections, cards, and a card appearing once
// ---------------------------------------------------------------------------

function sectionIds(view) {
  return view.sections.map((s) => s.id);
}

function cardIds(section) {
  return section.cards.map((c) => c.id);
}

test("the top section holds exactly the cards with a waiting or starred review", () => {
  const list = freshList();
  const view = build(list, okState());
  const top = view.sections.filter((s) => s.id === "top")[0];
  // s_coach: r_brief waits and is starred. s_dev: r_dev waits. s_ops: r_old4
  // and r_old2 wait (r_wt_gone waits too). s_old3: r_stale and r_big wait.
  // legacy: r_legacy waits. s_badsession and s_ssbroken have neither.
  // Spelled out, not worked out from the fixture: a rule copied from the code
  // under test would agree with a wrong rule.
  const expected = ["s_coach", "s_dev", "s_ops", "s_old3", "legacy"];
  assert.deepEqual(cardIds(top), expected);
  assert.equal(top.heading, "Unanswered comments, and starred (5)");
  assert.equal(top.cards.every((c) => c.open), true, "the top section's cards are open");
});

test("a card appears once, in the first section that claims it", () => {
  const view = build(freshList(), okState());
  const ids = allCards(view).map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("this week holds every other card active in the last DEFAULT_VIEW_DAYS, open", () => {
  const list = freshList();
  // Nothing waits or is starred on s_coach any more, so it drops to this week.
  reviewIn(list, "r_brief").waiting = 0;
  reviewIn(list, "r_brief").starred = false;
  const view = build(list, okState());
  const week = view.sections.filter((s) => s.id === "week")[0];
  assert.deepEqual(cardIds(week), ["s_coach", "s_badsession", "s_ssbroken"]);
  assert.equal(week.heading, "This week (3)");
  assert.equal(week.cards.every((c) => c.open), true);
});

test("older cards are collapsed, each opens on its own, and the heading counts their reviews", () => {
  const list = freshList();
  sessionIn(list, "legacy").reviews[0].waiting = 0;
  const view = build(list, okState());
  const older = view.sections.filter((s) => s.id === "older")[0];
  assert.deepEqual(cardIds(older), ["legacy"]);
  assert.equal(older.heading, "Older than a week: 1 review. Search reaches all of them.");
  assert.equal(older.cards[0].open, false);
  const expanded = build(list, vm.withExpanded(okState(), "legacy", true));
  assert.equal(expanded.sections.filter((s) => s.id === "older")[0].cards[0].open, true);
});

test("the week boundary: a session exactly DEFAULT_VIEW_DAYS old is older, one minute newer is this week", () => {
  const list = freshList();
  const days = protocol.CATALOG.DEFAULT_VIEW_DAYS;
  const legacy = sessionIn(list, "legacy");
  legacy.reviews[0].waiting = 0;
  legacy.last = new Date(NOW - days * DAY).toISOString();
  assert.deepEqual(sectionIds(build(list, okState())).indexOf("older") !== -1, true);
  assert.equal(card(build(list, okState()), "legacy").open, false);
  legacy.last = new Date(NOW - days * DAY + 60 * 1000).toISOString();
  assert.equal(card(build(list, okState()), "legacy").open, true);
});

test("a section with no cards is left out", () => {
  const list = freshList();
  list.sessions = list.sessions.filter((s) => s.id === "s_badsession");
  assert.deepEqual(sectionIds(build(list, okState())), ["week"]);
});

// ---------------------------------------------------------------------------
// The session card
// ---------------------------------------------------------------------------

test("a named card shows its name, projects, review count, watcher, waiting and last", () => {
  const c = card(build(freshList(), okState()), "s_coach");
  assert.equal(c.title, "coach activity");
  assert.deepEqual(c.projects, ["alpha", "beta"]);
  // r_deleted is missing, so it is not one of the card's visible reviews.
  assert.equal(c.reviewsText, "4 reviews");
  assert.equal(c.watchText, "watched by its own agent", "its watcher is itself, so its name is not repeated");
  assert.equal(c.waitingText, "3 waiting");
  assert.equal(c.lastText, "last 3:40 PM");
});

test("the card names the Library's own agent when it is the watcher", () => {
  assert.equal(card(build(freshList(), okState()), "s_ops").watchText, "watched by document index, the agent that opened this Library");
});

test("a watcher with no name is named by its session id on the card", () => {
  const list = freshList();
  sessionIn(list, "s_coach").watching = { session: "s_coach", name: null };
  assert.equal(card(build(list, okState()), "s_coach").watchText, "watched by s_coach");
});

test("a card with no watcher and nothing waiting says so and shows no waiting count", () => {
  const c = card(build(freshList(), okState()), "s_badsession");
  assert.equal(c.watchText, "no agent watching");
  assert.equal(c.waitingText, null);
  assert.equal(c.reviewsText, "1 review");
});

test("an unnamed card is named after the review it started on", () => {
  // s_old3's oldest review is r_s3page.
  assert.equal(card(build(freshList(), okState()), "s_old3").title, 'Unnamed session, started on "old-pages / p5.html"');
});

test("the legacy card is not called a session", () => {
  assert.equal(card(build(freshList(), okState()), "legacy").title, "Reviews from before sessions");
});

test("an older last time carries its date", () => {
  assert.equal(card(build(freshList(), okState()), "s_dev").lastText, "last Sun Sep 27, 4:00 PM");
});

// ---------------------------------------------------------------------------
// The review row
// ---------------------------------------------------------------------------

test("a row shows its name, where it lives, when, and its counts", () => {
  const r = row(build(freshList(), okState()), "r_brief");
  assert.equal(r.name, "Feature Brief: Coach Activity");
  assert.equal(r.where, "alpha / docs / brief.html");
  assert.equal(r.lastText, "last 3:40 PM");
  assert.equal(r.counts.waiting, "3 waiting");
  assert.equal(r.counts.comments, "5 comments");
  assert.equal(r.counts.asOf, null);
  assert.equal(r.starred, true);
});

test("counts that are stale say when they are from", () => {
  const r = row(build(freshList(), okState()), "r_big");
  assert.equal(r.counts.asOf, "counts as of Sat Sep 19, 4:00 PM");
});

test("one comment is singular, and no project leaves the project out", () => {
  const r = row(build(freshList(), okState()), "r_shared");
  assert.equal(r.counts.comments, "1 comment");
  assert.equal(r.counts.waiting, null);
  assert.equal(r.where, "", "the title already says loose / shared.html");
});

test("a folded row names its folder and says how many reviews it holds", () => {
  const r = row(build(freshList(), okState()), "r_old2");
  assert.equal(r.where, "", "the title says old-pages and the card says alpha");
  assert.equal(r.folded, "3 reviews of this folder, shown as one");
});

test("badges: review ended and being served now; a row in its own card does not repeat the card's watcher", () => {
  const view = build(freshList(), okState());
  assert.deepEqual(row(view, "r_notes").badges, ["review ended"]);
  assert.deepEqual(row(view, "r_spec").badges, ["being served now"]);
  assert.deepEqual(row(view, "r_badsession").badges, []);
});

test("a watched card names its agent once: on the card, and on none of its rows", () => {
  const c = card(build(freshList(), okState()), "s_coach");
  assert.equal(c.watched, true, "the card carries the watching mark the rows used to");
  assert.equal(card(build(freshList(), okState()), "s_badsession").watched, false);
  assert.ok(c.rows.length > 1, "the card has several rows");
  const texts = [c.watchText].concat(...c.rows.map((r) => r.badges));
  assert.equal(texts.filter((t) => t.startsWith("watched by") || t.startsWith("agent watching")).length, 1);
});

test("a row shown outside its card keeps the watching badge, since no card line names its watcher", () => {
  const view = build(freshList(), vm.withShowMissing(okState(), true));
  assert.deepEqual(row(view, "r_deleted").badges, ["agent watching: coach activity"]);
});

test("a review with several pages lists them; one page lists nothing", () => {
  const list = freshList();
  reviewIn(list, "r_brief").pages = [
    { title: "Brief", path: "/brief.html" },
    { title: "", path: "/appendix.html" }
  ];
  const view = build(list, okState());
  assert.deepEqual(row(view, "r_brief").pages, [
    { title: "Brief", path: "/brief.html" },
    { title: "/appendix.html", path: "/appendix.html" }
  ]);
  assert.deepEqual(row(view, "r_spec").pages, []);
});

test("an unreadable row says so and still lists", () => {
  const r = row(build(freshList(), okState()), "r_badsession");
  assert.deepEqual(r.notices.map((n) => n.text), ["Some of this review's records can't be read."]);
});

// ---------------------------------------------------------------------------
// Missing, via-agent and worktree rows
// ---------------------------------------------------------------------------

test("missing rows are hidden until the toggle, then listed in their own section", () => {
  const list = freshList();
  const hidden = build(list, okState());
  assert.equal(allRows(hidden).some((r) => r.id === "r_deleted"), false);
  assert.equal(hidden.missing.toggleText, "Show 3 missing");
  assert.equal(hidden.missing.shown, false);
  assert.equal(hidden.missing.section, null);

  const shown = build(list, vm.withShowMissing(okState(), true));
  assert.equal(shown.missing.shown, true);
  assert.equal(shown.missing.section.heading, "Missing (3). Neither the file nor a main-repo copy exists.");
  assert.equal(shown.missing.section.hideText, "Hide");
  assert.deepEqual(shown.missing.section.rows.map((r) => r.id), ["r_deleted", "r_wt_vanished", "r_badmeta"]);
  // Still not inside a card: a row appears once.
  assert.equal(allCards(shown).some((c) => c.rows.some((r) => r.id === "r_deleted")), false);
  assert.equal(row(shown, "r_deleted").sessionText, 'session "coach activity"');
});

test("with no missing rows there is no toggle", () => {
  const list = freshList();
  list.sessions.forEach((s) => (s.reviews = s.reviews.filter((r) => r.openable !== "missing")));
  assert.equal(build(list, okState()).missing, null);
});

test("a missing row has Open disabled with its reason, and Star still works", () => {
  const r = row(build(freshList(), vm.withShowMissing(okState(), true)), "r_deleted");
  assert.equal(r.buttons.open.enabled, false);
  assert.equal(r.buttons.pickup.enabled, false);
  assert.equal(r.buttons.launch.enabled, false);
  assert.deepEqual(r.notices.map((n) => n.text), ["File is gone. Open unavailable."]);
  assert.equal(r.star.enabled, true);
});

test("a worktree row says the main repository's copy will open", () => {
  const r = row(build(freshList(), okState()), "r_wt_gone");
  assert.deepEqual(r.notices.map((n) => n.text), [
    "The worktree is gone. An agent will open the main repository's copy, which may differ from what you reviewed."
  ]);
  assert.equal(r.buttons.open.enabled, true);
});

test("a via-agent row with an agent can be opened through the agent", () => {
  const r = row(build(freshList(), okState()), "r_dev");
  assert.equal(r.buttons.open.enabled, true);
  // r_dev is a dev server's: its only notice is why no agent can take it.
  assert.deepEqual(r.notices.map((n) => n.text), [vm.TEXT.DEV_SERVER_NO_HANDOFF]);
});

test("a via-agent row with no agent has Open disabled and offers the hand-off message", () => {
  const list = freshList();
  list.attached = null;
  const r = row(build(list, okState()), "r_dev");
  assert.equal(r.buttons.open.enabled, false);
  assert.deepEqual(r.notices.map((n) => n.text), ["Needs an agent to reopen. No agent is attached.", vm.TEXT.DEV_SERVER_NO_HANDOFF]);
  assert.equal(r.offerHandoff, true);
  assert.equal(vm.decide(list, okState(), "r_dev", "open", {}).kind, "handoff");
});

test("a worktree row with no agent carries both wordings", () => {
  const list = freshList();
  list.attached = null;
  const r = row(build(list, okState()), "r_wt_gone");
  assert.deepEqual(r.notices.map((n) => n.text), [
    "The worktree is gone. An agent will open the main repository's copy, which may differ from what you reviewed.",
    "Needs an agent to reopen. No agent is attached."
  ]);
});

// ---------------------------------------------------------------------------
// Search and the project filter
// ---------------------------------------------------------------------------

function visibleRowIds(view) {
  return allCards(view).reduce((acc, c) => acc.concat(c.rows.map((r) => r.id)), []);
}

test("search matches a title", () => {
  assert.deepEqual(visibleRowIds(build(freshList(), vm.withQuery(okState(), "coach notes"))), ["r_notes"]);
});

test("search matches a file name", () => {
  assert.deepEqual(visibleRowIds(build(freshList(), vm.withQuery(okState(), "untitled.html"))), ["r_notitle"]);
});

test("search matches a folder, across all ages", () => {
  const view = build(freshList(), vm.withQuery(okState(), "old-pages"));
  // s_ops's matching rows only, dated Sep 13 to Sep 20.
  assert.deepEqual(card(view, "s_ops").rows.map((r) => r.id), ["r_old4", "r_old2", "r_oldfolder"]);
  // s_old3 has no name, so its card is titled after "old-pages / p5.html": the
  // card's own title matches, and the whole card shows.
  assert.equal(card(view, "s_old3").rows.length, 6, "all but the missing r_badmeta");
  assert.deepEqual(allCards(view).map((c) => c.id).sort(), ["s_old3", "s_ops"]);
});

test("search matching a session name shows that whole card", () => {
  const view = build(freshList(), vm.withQuery(okState(), "APP DEV"));
  assert.deepEqual(allCards(view).map((c) => c.id), ["s_dev"]);
});

test("a search match inside a collapsed older card shows that card open", () => {
  const view = build(freshList(), vm.withQuery(okState(), "legacy page"));
  const c = card(view, "legacy");
  assert.equal(c.open, true);
  assert.deepEqual(c.rows.map((r) => r.id), ["r_legacy"]);
});

test("search terms must all match, in any field", () => {
  assert.deepEqual(visibleRowIds(build(freshList(), vm.withQuery(okState(), "beta spec"))), ["r_spec"]);
  assert.deepEqual(visibleRowIds(build(freshList(), vm.withQuery(okState(), "beta zebra"))), []);
});

test("a search with no match says so", () => {
  const view = build(freshList(), vm.withQuery(okState(), "zebra"));
  assert.equal(view.noMatches, "Nothing matches that search.");
  assert.equal(build(freshList(), okState()).noMatches, null);
});

test("search reaches missing rows too, once they are shown", () => {
  const view = build(freshList(), vm.withShowMissing(vm.withQuery(okState(), "deleted"), true));
  assert.deepEqual(view.missing.section.rows.map((r) => r.id), ["r_deleted"]);
});

test("the project filter lists every project and keeps only cards with that label", () => {
  const list = freshList();
  const view = build(list, okState());
  assert.deepEqual(view.projects.options.map((o) => o.value), ["", "alpha", "beta"]);
  assert.equal(view.projects.options[0].label, "All projects");
  const beta = build(list, vm.withProject(okState(), "beta"));
  assert.deepEqual(allCards(beta).map((c) => c.id).sort(), ["s_coach", "s_dev"]);
});

// ---------------------------------------------------------------------------
// R4: a week of reviews is findable without search
// ---------------------------------------------------------------------------

test("a 7-day fixture of 120 reviews: every one is in an open card, with no search", () => {
  const sessions = [];
  let n = 0;
  for (let s = 0; s < 12; s += 1) {
    const reviews = [];
    for (let i = 0; i < 10; i += 1) {
      n += 1;
      const at = new Date(NOW - ((n * 83 * 60 * 1000) % (7 * DAY - 60 * 1000))).toISOString();
      reviews.push({
        id: "r_gen" + n, title: "Doc " + n, display_name: "Doc " + n, file: "d" + n + ".html", folder: "f" + s,
        path_hint: "~/p/f" + s, project: "p", last: at, waiting: n % 7 === 0 ? 1 : 0, total: 1,
        counts_as_of: at, ended: false, served_url: null, openable: "yes", kind: "static",
        starred: false, unreadable: false, request: null, pages: [], folded_from: []
      });
    }
    reviews.sort((a, b) => Date.parse(b.last) - Date.parse(a.last));
    sessions.push({ id: "s_gen" + s, name: "gen " + s, projects: ["p"], watching: null, last: reviews[0].last, reviews });
  }
  sessions.sort((a, b) => Date.parse(b.last) - Date.parse(a.last));
  const view = build({ attached: null, notice: null, sessions }, okState());
  const reachable = [];
  allCards(view).forEach((c) => {
    assert.equal(c.open, true, c.id + " is open");
    c.rows.forEach((r) => reachable.push(r.id));
  });
  assert.equal(reachable.length, 120);
  assert.equal(new Set(reachable).size, 120);
});

// ---------------------------------------------------------------------------
// Fetch outcomes and the empty page
// ---------------------------------------------------------------------------

test("a 401 says LAHE restarted and stops polling", () => {
  const state = vm.withFetch(okState(), { ok: false, status: 401 });
  const view = build(freshList(), state);
  assert.equal(view.banner.text, "LAHE restarted, reload this page.");
  assert.equal(view.banner.action, "reload");
  assert.equal(vm.shouldPoll(state), false);
  assert.equal(vm.shouldPoll(okState()), true);
});

test("no answer from the helper gives the not-running banner, and polling goes on", () => {
  const state = vm.withFetch(okState(), { ok: false, unreachable: true });
  const view = build(freshList(), state);
  assert.equal(view.banner.text, "LAHE is not running. Ask an agent to open the lahe library.");
  assert.equal(vm.shouldPoll(state), true);
});

test("a recovered helper clears the not-running banner", () => {
  const state = vm.withFetch(vm.withFetch(okState(), { ok: false, unreachable: true }), { ok: true });
  assert.equal(build(freshList(), state).banner, null);
});

test("an empty list gives the empty state", () => {
  const view = build({ attached: null, notice: null, sessions: [] }, okState());
  assert.equal(view.empty, "No reviews yet. Documents you review in LAHE show up here.");
  assert.deepEqual(view.sections, []);
  assert.equal(build(freshList(), okState()).empty, null);
});

test("before the first answer the page says it is loading, and nothing else", () => {
  const view = build(null, vm.initialState());
  assert.equal(view.loading, "Loading the Library.");
  assert.equal(view.empty, null);
  assert.equal(view.banner, null);
});

test("an unreadable stars file shows a notice", () => {
  const list = freshList();
  list.notice = "PROTO_CATALOG_UNREADABLE";
  assert.equal(
    build(list, okState()).notice,
    "Stars can't change right now: the Library's saved stars file can't be read. LAHE leaves the file as it is."
  );
  assert.equal(build(freshList(), okState()).notice, null);
});

// ---------------------------------------------------------------------------
// Clicks: what Open, Pick this up and Launch do before anything is sent
// ---------------------------------------------------------------------------

test("Open on a servable row opens a tab and asks for a hand-over to the attached agent", () => {
  // s_old3 has no watcher, so nothing needs confirming.
  const d = vm.decide(freshList(), okState(), "r_stale", "open", {});
  assert.equal(d.kind, "open");
  assert.equal(d.tab, true);
  assert.deepEqual(d.body, { review: "r_stale", handoff: true, confirmed: false });
});

test("Open with no agent still opens, and asks for no hand-over", () => {
  const list = freshList();
  list.attached = null;
  const d = vm.decide(list, okState(), "r_mounted", "open", {});
  assert.equal(d.kind, "open");
  assert.deepEqual(d.body, { review: "r_mounted", handoff: false, confirmed: false });
});

test("Open on a via-agent row goes through the agent and opens no tab", () => {
  const d = vm.decide(freshList(), okState(), "r_dev", "open", {});
  assert.equal(d.kind, "open");
  assert.equal(d.tab, false);
  assert.deepEqual(d.body, { review: "r_dev", handoff: true, confirmed: false });
});

test("Open on a missing row does nothing", () => {
  assert.equal(vm.decide(freshList(), okState(), "r_deleted", "open", {}).kind, "none");
  assert.equal(vm.decide(freshList(), okState(), "r_deleted", "pickup", {}).kind, "none");
});

test("Open while a request waits opens to read, and asks no second time", () => {
  const d = vm.decide(freshList(), okState(), "r_brief", "open", {});
  assert.equal(d.kind, "open");
  assert.deepEqual(d.body, { review: "r_brief", handoff: false, confirmed: false });
});

test("Pick this up and Launch queue a request for the attached agent", () => {
  ["pickup", "launch"].forEach((action) => {
    const d = vm.decide(freshList(), okState(), "r_old4", action, {});
    // s_ops is watched by the attached agent itself: nothing to confirm.
    assert.equal(d.kind, "request", action);
    assert.deepEqual(d.body, { review: "r_old4", action: action, confirmed: false });
  });
});

test("a second click while a request waits does nothing and says so", () => {
  const d = vm.decide(freshList(), okState(), "r_brief", "launch", {});
  assert.equal(d.kind, "already");
  const state = vm.withNote(okState(), "r_brief", d.note, NOW);
  assert.equal(row(build(freshList(), state), "r_brief").note.text, "Already waiting for document index.");
});

test("a watched session asks before a hand-over, naming the agent and the other reviews", () => {
  const list = freshList();
  ["open", "pickup", "launch"].forEach((action) => {
    const d = vm.decide(list, okState(), "r_mounted", action, {});
    assert.equal(d.kind, "confirm", action);
  });
  const view = build(list, vm.withDialog(okState(), "r_mounted", "pickup"));
  assert.equal(view.dialog.title, "Another agent is watching this.");
  assert.equal(
    view.dialog.body,
    '"shared / figure.html" belongs to session "coach activity". Handing it to document index moves the whole session and stops the other agent. These reviews move with it:'
  );
  assert.deepEqual(view.dialog.reviews, ["Feature Brief: Coach Activity", "specs / spec.html", "Coach Notes", "Deleted Page"]);
  assert.deepEqual(view.dialog.buttons.map((b) => [b.id, b.label]), [
    ["move", "Move the session"],
    ["read", "Just open it to read"],
    ["cancel", "Cancel"]
  ]);
});

test("the confirm dialog offers no read-only open for a row only an agent can open", () => {
  const list = freshList();
  sessionIn(list, "s_dev").watching = { session: "s_other", name: "other agent" };
  const view = build(list, vm.withDialog(okState(), "r_dev", "open"));
  assert.deepEqual(view.dialog.buttons.map((b) => b.id), ["move", "cancel"]);
  assert.equal(view.dialog.reviews.length, 0);
  assert.equal(
    view.dialog.body,
    '"App Home" belongs to session "app dev". Handing it to document index moves the whole session and stops the other agent.'
  );
});

test("Move the session sends the confirmation; Just open it to read sends no hand-over", () => {
  const list = freshList();
  const moved = vm.decide(list, okState(), "r_mounted", "pickup", { confirmed: true });
  assert.deepEqual(moved.body, { review: "r_mounted", action: "pickup", confirmed: true });
  const openMoved = vm.decide(list, okState(), "r_mounted", "open", { confirmed: true });
  assert.deepEqual(openMoved.body, { review: "r_mounted", handoff: true, confirmed: true });
  const read = vm.decide(list, okState(), "r_mounted", "open", { read: true });
  assert.equal(read.kind, "open");
  assert.deepEqual(read.body, { review: "r_mounted", handoff: false, confirmed: false });
});

// ---------------------------------------------------------------------------
// Open's banner and results
// ---------------------------------------------------------------------------

test("Open, handing over: the banner says so while it is in flight", () => {
  const state = vm.beginOpen(okState(), freshList(), "r_mounted", { handoff: true });
  assert.equal(
    build(freshList(), state).banner.text,
    'Opening "shared / figure.html" in a new tab and handing it to document index.'
  );
});

test("Open to read: the banner says only that it is opening", () => {
  const state = vm.beginOpen(okState(), freshList(), "r_mounted", { handoff: false });
  assert.equal(build(freshList(), state).banner.text, 'Opening "shared / figure.html" in a new tab.');
});

test("after Open, the banner waits for the agent, and says it is watching only once it answers", () => {
  const list = freshList();
  let state = vm.beginOpen(okState(), list, "r_mounted", { handoff: true });
  state = vm.afterOpen(state, list, "r_mounted", { ok: true, body: { url: "http://127.0.0.1:5000/figure.html", request_id: "cq_new", not_asked: null } }, NOW);
  assert.equal(
    build(list, state).banner.text,
    '"shared / figure.html" is open in a new tab. Waiting for document index to start watching it.'
  );
  reviewIn(list, "r_mounted").request = { id: "cq_new", action: "pickup", at: new Date(NOW).toISOString(), state: "done", by_name: "document index", text: "watching", answered_at: new Date(NOW).toISOString() };
  assert.equal(build(list, state).banner.text, '"shared / figure.html" is open in a new tab, and document index is watching it.');
  reviewIn(list, "r_mounted").request.state = "refused";
  assert.equal(build(list, state).banner, null, "a refusal is the row's to say, not a success banner");
});

test("Open on a session the attached agent already watches is done at once", () => {
  const list = freshList();
  let state = vm.beginOpen(okState(), list, "r_old4", { handoff: true });
  state = vm.afterOpen(state, list, "r_old4", { ok: true, body: { url: "http://127.0.0.1:5000/p4.html", request_id: null, not_asked: null } }, NOW);
  assert.equal(build(list, state).banner.text, '"Page Four" is open in a new tab, and document index is watching it.');
});

test("Open to read ends with a plain opened banner", () => {
  const list = freshList();
  let state = vm.beginOpen(okState(), list, "r_mounted", { handoff: false });
  state = vm.afterOpen(state, list, "r_mounted", { ok: true, body: { url: "http://127.0.0.1:5000/figure.html", request_id: null, not_asked: null } }, NOW);
  assert.equal(build(list, state).banner.text, '"shared / figure.html" is open in a new tab.');
});

test("Open with the queue full says no agent was asked", () => {
  const list = freshList();
  let state = vm.beginOpen(okState(), list, "r_mounted", { handoff: true });
  state = vm.afterOpen(state, list, "r_mounted", { ok: true, body: { url: "http://127.0.0.1:5000/f.html", request_id: null, not_asked: "queue_full" } }, NOW);
  const view = build(list, state);
  assert.equal(view.banner, null);
  assert.equal(row(view, "r_mounted").note.text, "Opened. No agent was asked: too many hand-overs are waiting.");
});

test("Open with no agent says nobody is watching it", () => {
  const list = freshList();
  let state = vm.beginOpen(okState(), list, "r_mounted", { handoff: true });
  state = vm.afterOpen(state, list, "r_mounted", { ok: true, body: { url: "http://127.0.0.1:5000/f.html", request_id: null, not_asked: "no_agent" } }, NOW);
  assert.equal(row(build(list, state), "r_mounted").note.text, "Opened. No agent is attached to watch it.");
});

test("Open through an agent says it is waiting on the row", () => {
  const list = freshList();
  let state = vm.beginOpen(okState(), list, "r_dev", { handoff: true, tab: false });
  state = vm.afterOpen(state, list, "r_dev", { ok: true, body: { url: null, request_id: "cq_dev", not_asked: null } }, NOW);
  const view = build(list, state);
  assert.equal(view.banner, null);
  assert.equal(row(view, "r_dev").note.text, "Waiting for document index.");
  assert.equal(row(view, "r_dev").note.busy, true);
});

test("an Open refused for confirmation raises the dialog; for no agent, the hand-off panel", () => {
  const list = freshList();
  const err = (code) => ({ ok: false, status: 409, error: { code: code, message: "m.", remedy: "r." } });
  let state = vm.afterOpen(vm.beginOpen(okState(), list, "r_mounted", { handoff: true }), list, "r_mounted", err("PROTO_CONFIRM_NEEDED"), NOW);
  assert.deepEqual(state.dialog, { review: "r_mounted", action: "open" });
  assert.equal(build(list, state).banner, null);
  state = vm.afterOpen(vm.beginOpen(okState(), list, "r_dev", { handoff: true }), list, "r_dev", err("PROTO_NO_AGENT"), NOW);
  assert.deepEqual(state.panel, { review: "r_dev", reason: "no_agent" });
});

test("an Open refused for another reason shows the helper's message and remedy on the row", () => {
  const list = freshList();
  const state = vm.afterOpen(vm.beginOpen(okState(), list, "r_mounted", { handoff: true }), list, "r_mounted",
    { ok: false, status: 409, error: { code: "PROTO_NOT_OPENABLE", message: "This document cannot be opened.", remedy: "Ask an agent." } }, NOW);
  assert.equal(row(build(list, state), "r_mounted").note.text, "This document cannot be opened. Ask an agent.");
});

test("an Open whose token is refused turns into the restarted banner", () => {
  const list = freshList();
  const state = vm.afterOpen(vm.beginOpen(okState(), list, "r_mounted", { handoff: true }), list, "r_mounted",
    { ok: false, status: 401, error: { code: "PROTO_UNAUTHORIZED", message: "m", remedy: null } }, NOW);
  assert.equal(build(list, state).banner.text, "LAHE restarted, reload this page.");
});

test("an Open that returns a URL the check refuses says so and opens nothing", () => {
  const list = freshList();
  const state = vm.afterOpen(vm.beginOpen(okState(), list, "r_mounted", { handoff: true }), list, "r_mounted",
    { ok: false, urlRefused: true }, NOW);
  const view = build(list, state);
  assert.equal(view.banner, null);
  assert.equal(row(view, "r_mounted").note.text, "LAHE answered with an address that is not on this computer, so the Library did not open it.");
});

test("no answer to an Open says LAHE is not running", () => {
  const list = freshList();
  const state = vm.afterOpen(vm.beginOpen(okState(), list, "r_mounted", { handoff: true }), list, "r_mounted", { ok: false, unreachable: true }, NOW);
  assert.equal(build(list, state).banner.text, "LAHE is not running. Ask an agent to open the lahe library.");
});

// ---------------------------------------------------------------------------
// Pick this up and Launch results
// ---------------------------------------------------------------------------

test("a queued request shows waiting at once, before the next poll", () => {
  const state = vm.afterRequest(okState(), freshList(), "r_old4", "pickup", { ok: true, body: { request_id: "cq_x" } }, NOW);
  const r = row(build(freshList(), state), "r_old4");
  assert.equal(r.note.text, "Waiting for document index.");
  assert.equal(r.buttons.pickup.busy, true);
});

test("a request refused as already pending says so; one refused as queue full says no agent was asked", () => {
  const list = freshList();
  const err = (code) => ({ ok: false, status: 409, error: { code: code, message: "m.", remedy: "r." } });
  let state = vm.afterRequest(okState(), list, "r_old4", "pickup", err("PROTO_REQUEST_PENDING"), NOW);
  assert.equal(row(build(list, state), "r_old4").note.text, "Already waiting for document index.");
  state = vm.afterRequest(okState(), list, "r_old4", "pickup", err("PROTO_QUEUE_FULL"), NOW);
  assert.equal(row(build(list, state), "r_old4").note.text, "No agent was asked: too many hand-overs are waiting.");
  state = vm.afterRequest(okState(), list, "r_old4", "launch", err("PROTO_NO_AGENT"), NOW);
  assert.deepEqual(state.panel, { review: "r_old4", reason: "no_agent" });
});

test("the list's newer answer replaces the page's own waiting note", () => {
  const list = freshList();
  const state = vm.afterRequest(okState(), list, "r_old4", "pickup", { ok: true, body: { request_id: "cq_x" } }, NOW);
  reviewIn(list, "r_old4").request = { id: "cq_x", action: "pickup", at: new Date(NOW).toISOString(), state: "expired", by_name: "document index", text: null, answered_at: null };
  assert.equal(row(build(list, state), "r_old4").note.text, "Not picked up. document index didn't answer.");
});

test("an already-waiting note gives way once the request is answered", () => {
  const list = freshList();
  const d = vm.decide(list, okState(), "r_brief", "pickup", {});
  const state = vm.withNote(okState(), "r_brief", d.note, NOW);
  reviewIn(list, "r_brief").request.state = "done";
  reviewIn(list, "r_brief").request.text = "watching it";
  assert.equal(row(build(list, state), "r_brief").note.text, "document index: watching it");
});

// ---------------------------------------------------------------------------
// Star
// ---------------------------------------------------------------------------

test("a star changes only when the helper answers", () => {
  const list = freshList();
  let state = vm.beginStar(okState(), "r_mounted", true);
  let r = row(build(list, state), "r_mounted");
  assert.equal(r.star.on, false, "not yet: the helper has not answered");
  assert.equal(r.star.pending, true);
  state = vm.afterStar(state, "r_mounted", true, { ok: true, body: { review: "r_mounted", starred: true } }, NOW);
  r = row(build(list, state), "r_mounted");
  assert.equal(r.star.on, true);
  assert.equal(r.star.pending, false);
  // The next list agrees, and the page's own override is dropped.
  reviewIn(list, "r_mounted").starred = true;
  state = vm.afterList(state, list);
  assert.deepEqual(state.starOverride, {});
});

test("a failed star puts the row back and says why", () => {
  const list = freshList();
  let state = vm.beginStar(okState(), "r_brief", false);
  state = vm.afterStar(state, "r_brief", false,
    { ok: false, status: 500, error: { code: "PROTO_CATALOG_UNREADABLE", message: "The stars file cannot be read.", remedy: "Move catalog.json aside and try again." } }, NOW);
  const r = row(build(list, state), "r_brief");
  assert.equal(r.star.on, true, "the star goes back to what the helper has");
  assert.equal(r.star.pending, false);
  assert.equal(r.note.text, "Couldn't save the star: Move catalog.json aside and try again. The star goes back.");
});

test("a failed star with no remedy uses the helper's message", () => {
  const state = vm.afterStar(vm.beginStar(okState(), "r_mounted", true), "r_mounted", true,
    { ok: false, status: 500, error: { code: "X", message: "Something broke.", remedy: null } }, NOW);
  assert.equal(row(build(freshList(), state), "r_mounted").note.text, "Couldn't save the star: Something broke. The star goes back.");
});

test("a star with no answer at all says LAHE is not running", () => {
  const state = vm.afterStar(vm.beginStar(okState(), "r_mounted", true), "r_mounted", true, { ok: false, unreachable: true }, NOW);
  const view = build(freshList(), state);
  assert.equal(row(view, "r_mounted").note.text, "Couldn't save the star: LAHE is not running. The star goes back.");
});

test("a star starred by the page moves its card into the top section", () => {
  const list = freshList();
  let state = vm.afterStar(vm.beginStar(okState(), "r_notitle", true), "r_notitle", true, { ok: true, body: {} }, NOW);
  // s_old3 already waits; use s_badsession, which has nothing.
  state = vm.afterStar(vm.beginStar(state, "r_badsession", true), "r_badsession", true, { ok: true, body: {} }, NOW);
  const top = build(list, state).sections.filter((s) => s.id === "top")[0];
  assert.ok(top.cards.some((c) => c.id === "s_badsession"));
});

// ---------------------------------------------------------------------------
// The Open URL check
// ---------------------------------------------------------------------------

test("the Open URL check accepts loopback http only", () => {
  assert.equal(vm.isLoopbackHttpUrl("http://127.0.0.1:5123/docs/a.html"), true);
  assert.equal(vm.isLoopbackHttpUrl("http://localhost:5123/a.html"), true);
  assert.equal(vm.isLoopbackHttpUrl("http://[::1]:5123/a.html"), true);
});

test("the Open URL check refuses a non-loopback host", () => {
  assert.equal(vm.isLoopbackHttpUrl("http://evil.test:5123/a.html"), false);
  assert.equal(vm.isLoopbackHttpUrl("http://127.0.0.1.evil.test/a.html"), false);
  assert.equal(vm.isLoopbackHttpUrl("http://10.0.0.2:5123/a.html"), false);
});

test("the Open URL check refuses a non-http scheme and a malformed value", () => {
  assert.equal(vm.isLoopbackHttpUrl("https://127.0.0.1:5123/a.html"), false);
  assert.equal(vm.isLoopbackHttpUrl("javascript:alert(1)"), false);
  assert.equal(vm.isLoopbackHttpUrl("file:///etc/passwd"), false);
  assert.equal(vm.isLoopbackHttpUrl("/relative/a.html"), false);
  assert.equal(vm.isLoopbackHttpUrl(null), false);
  assert.equal(vm.isLoopbackHttpUrl("http://user:pw@127.0.0.1:5123/"), false);
});

// ---------------------------------------------------------------------------
// What the page needs beyond the Page Spec's table
// ---------------------------------------------------------------------------

test("a list refused for another reason shows the helper's own words, and polling goes on", () => {
  const state = vm.withFetch(okState(), {
    ok: false, status: 500, error: { code: "PROTO_X", message: "The list could not be built.", remedy: "Check the helper log." }
  });
  const view = build(freshList(), state);
  assert.equal(view.banner.text, "The Library couldn't load the list: The list could not be built. Check the helper log.");
  assert.equal(vm.shouldPoll(state), true);
});

test("a blocked pop-up sends nothing and says how to fix it", () => {
  const state = vm.popupBlocked(okState(), "r_stale", NOW);
  assert.equal(
    row(build(freshList(), state), "r_stale").note.text,
    "The browser blocked the new tab. Allow pop-ups for this page, then press Open again."
  );
});

test("the hand-off panel says whether the copy worked", () => {
  const list = freshList();
  list.attached = null;
  let state = vm.withPanel(okState(), "r_mounted", "no_agent");
  assert.equal(row(build(list, state), "r_mounted").panel.copyStatus, null);
  state = vm.withCopied(state, "r_mounted", true);
  assert.equal(row(build(list, state), "r_mounted").panel.copyStatus, "Copied.");
  state = vm.withCopied(state, "r_mounted", false);
  assert.equal(row(build(list, state), "r_mounted").panel.copyStatus, "Couldn't copy. Select the message and copy it yourself.");
  assert.equal(row(build(list, state), "r_mounted").panel.closeLabel, "Close");
});

test("a row that offers the hand-off message labels its button", () => {
  const view = build(freshList(), okState());
  assert.equal(row(view, "r_notes").handoffLabel, "Copy the hand-off message");
});

// ---------------------------------------------------------------------------
// Open's answers from the real routes (Task 2.1)
// ---------------------------------------------------------------------------

test("Open with a request already waiting opens, and says the agent is already asked", () => {
  const list = freshList();
  let state = vm.beginOpen(okState(), list, "r_stale", { handoff: true });
  state = vm.afterOpen(state, list, "r_stale", { ok: true, body: { url: "http://127.0.0.1:5000/stale.html", request_id: null, not_asked: "request_pending" } }, NOW);
  const view = build(list, state);
  assert.equal(view.banner.text, '"Stale Projection" is open in a new tab.');
  assert.equal(row(view, "r_stale").note.text, "Already waiting for document index.");
});

test("Open on a servable row that no server could restart waits for the agent instead", () => {
  const list = freshList();
  let state = vm.beginOpen(okState(), list, "r_stale", { handoff: true });
  state = vm.afterOpen(state, list, "r_stale", { ok: true, body: { url: null, request_id: "cq_s", not_asked: null } }, NOW);
  const view = build(list, state);
  assert.equal(view.banner, null, "no tab opened, so no banner says one did");
  assert.equal(row(view, "r_stale").note.text, "Waiting for document index.");
  assert.equal(row(view, "r_stale").note.busy, true);
});

// ---------------------------------------------------------------------------
// Expiry wording by reason (phase 7 fix round). `reason` comes from
// src/service/catalog_requests.js EXPIRY_REASON.
// ---------------------------------------------------------------------------

function expiredRow(action, reason) {
  const list = freshList();
  const q = reviewIn(list, "r_wt_gone").request;
  q.action = action;
  if (reason === undefined) delete q.reason;
  else q.reason = reason;
  return row(build(list, okState()), "r_wt_gone");
}

test("a pick-up that expired on a timeout says the agent did not answer", () => {
  const r = expiredRow("pickup", "timeout");
  assert.equal(r.note.text, "Not picked up. document index didn't answer.");
  assert.equal(r.note.copyHandoff, false);
});

test("a pick-up that expired because the agent stopped watching says so", () => {
  const r = expiredRow("pickup", "monitor_dead");
  assert.equal(r.note.text, "Not picked up. document index stopped watching before it answered.");
});

test("a pick-up that expired because another agent was attached says so", () => {
  const r = expiredRow("pickup", "attach_changed");
  assert.equal(r.note.text, "Not picked up. A different agent was attached before document index answered.");
  assert.equal(r.note.copyHandoff, false);
});

test("an expired request with no reason keeps the did-not-answer wording", () => {
  assert.equal(expiredRow("pickup", undefined).note.text, "Not picked up. document index didn't answer.");
});

test("an expired launch says no agent was launched and offers the hand-off message", () => {
  const r = expiredRow("launch", "timeout");
  assert.equal(r.note.text, "No new agent was launched. document index didn't answer.");
  assert.equal(r.note.copyHandoff, true);
});

test("an expired launch after an attach change names both facts", () => {
  const r = expiredRow("launch", "attach_changed");
  assert.equal(r.note.text, "No new agent was launched. A different agent was attached before document index answered.");
  assert.equal(r.note.copyHandoff, true);
});

// ---------------------------------------------------------------------------
// Open in flight (CR1, page side)
// ---------------------------------------------------------------------------

test("Open shows busy while its request is in flight", () => {
  const list = freshList();
  const state = vm.beginOpen(okState(), list, "r_mounted", { handoff: true });
  const r = row(build(list, state), "r_mounted");
  assert.equal(r.buttons.open.busy, true);
});

test("a second click on Open while the first is in flight sends nothing", () => {
  const list = freshList();
  const state = vm.beginOpen(okState(), list, "r_mounted", { handoff: true });
  assert.equal(vm.decide(list, state, "r_mounted", "open", {}).kind, "none");
  assert.equal(vm.decide(list, state, "r_mounted", "open", { read: true }).kind, "none");
  assert.equal(vm.decide(list, state, "r_mounted", "open", { confirmed: true }).kind, "none");
});

test("an Open with no tab (via an agent) is also busy until it answers", () => {
  const list = freshList();
  const state = vm.beginOpen(okState(), list, "r_dev", { handoff: true, tab: false });
  assert.equal(row(build(list, state), "r_dev").buttons.open.busy, true);
  assert.equal(vm.decide(list, state, "r_dev", "open", {}).kind, "none");
});

test("Open on another row is not blocked by one in flight", () => {
  const list = freshList();
  const state = vm.beginOpen(okState(), list, "r_mounted", { handoff: true });
  assert.notEqual(vm.decide(list, state, "r_old4", "open", {}).kind, "none");
});

test("Open is clickable again once its answer arrives, success or failure", () => {
  const list = freshList();
  let state = vm.beginOpen(okState(), list, "r_mounted", { handoff: true });
  state = vm.afterOpen(state, list, "r_mounted", { ok: true, body: { url: "http://127.0.0.1:5000/f.html", request_id: null, not_asked: null } }, NOW);
  assert.equal(row(build(list, state), "r_mounted").buttons.open.busy, false);
  assert.notEqual(vm.decide(list, state, "r_mounted", "open", {}).kind, "none");
  state = vm.beginOpen(state, list, "r_mounted", { handoff: true });
  state = vm.afterOpen(state, list, "r_mounted", { ok: false, unreachable: true }, NOW);
  assert.equal(row(build(list, state), "r_mounted").buttons.open.busy, false);
});

// ---------------------------------------------------------------------------
// Story walk and design review (phase 7, Builder C)
// ---------------------------------------------------------------------------

test("the header says no agent attached when the attached session is closed", () => {
  const list = freshList();
  list.attached = { session: "s_index", name: "document index", watching: false, closed: true };
  const view = build(list, okState());
  assert.equal(view.agent.attached, false);
  assert.equal(view.agent.text, "No agent attached. Open still works; hand-overs give you a message to paste.");
});

test("an attached, open session that stopped watching still says so", () => {
  const list = freshList();
  list.attached = { session: "s_index", name: "document index", watching: false, closed: false };
  assert.equal(
    build(list, okState()).agent.text,
    "document index is attached but has stopped watching. Open still works; hand-overs give you a message to paste."
  );
});

test("each row has one Hand to agent menu, closed until opened, holding Pick this up and Launch", () => {
  const list = freshList();
  let r = row(build(list, okState()), "r_mounted");
  assert.equal(r.buttons.handTo.label, "Hand to agent");
  assert.equal(r.buttons.handTo.hidden, false);
  assert.equal(r.buttons.handTo.enabled, true);
  assert.equal(r.buttons.handTo.expanded, false);
  const state = vm.withMenu(okState(), "r_mounted");
  r = row(build(list, state), "r_mounted");
  assert.equal(r.buttons.handTo.expanded, true);
  assert.equal(row(build(list, state), "r_stale").buttons.handTo.expanded, false, "only the one row's menu opens");
  assert.equal(vm.withMenu(state, null).menu, null);
});

test("the menu is busy while a pick-up or launch waits", () => {
  const r = row(build(freshList(), okState()), "r_brief");
  assert.equal(r.buttons.handTo.busy, true);
  assert.equal(row(build(freshList(), okState()), "r_mounted").buttons.handTo.busy, false);
});

test("Hand to agent is hidden where the attached agent already watches the session", () => {
  // s_ops is watched by s_index, the agent that opened this Library.
  const r = row(build(freshList(), okState()), "r_old4");
  assert.equal(r.buttons.handTo.hidden, true);
  // s_coach is watched by another agent, so the menu stays.
  assert.equal(row(build(freshList(), okState()), "r_mounted").buttons.handTo.hidden, false);
});

test("Hand to agent is disabled with a reason on a dev-server row", () => {
  const r = row(build(freshList(), okState()), "r_dev");
  assert.equal(r.buttons.handTo.enabled, false);
  assert.equal(r.buttons.pickup.enabled, false);
  assert.equal(r.buttons.launch.enabled, false);
  assert.equal(r.buttons.handTo.reason, "An app's dev server serves this page, so no agent can take it from here. Start the dev server and open the page yourself.");
  assert.ok(r.notices.some((n) => n.text === r.buttons.handTo.reason), "the reason is on the row, not only in a tooltip");
});

test("a refusal clears once the agent that refused is no longer the attached, live agent", () => {
  const list = freshList();
  assert.match(row(build(list, okState()), "r_notes").note.text, /couldn't take it/);
  list.attached = { session: "s_new", name: "fresh agent", watching: true };
  assert.equal(row(build(list, okState()), "r_notes").note, null);
  list.attached = null;
  assert.equal(row(build(list, okState()), "r_notes").note, null);
});

test("a card watched by its own agent does not repeat the card's title", () => {
  const list = freshList();
  // s_coach is named "coach activity" and watched by itself.
  assert.equal(card(build(list, okState()), "s_coach").watchText, "watched by its own agent");
  // A launched session, named after its document, reads the same way.
  sessionIn(list, "s_coach").name = "Feature Brief: Coach Activity";
  sessionIn(list, "s_coach").watching = { session: "s_coach", name: "Feature Brief: Coach Activity" };
  assert.equal(card(build(list, okState()), "s_coach").watchText, "watched by its own agent");
  // A watcher whose name differs from the card is still named.
  sessionIn(list, "s_coach").watching = { session: "s_other", name: "other agent" };
  assert.equal(card(build(list, okState()), "s_coach").watchText, "watched by other agent");
});

test("the path line shows only what the title does not already say", () => {
  const view = build(freshList(), okState());
  // Title is "loose / shared.html": nothing to add.
  assert.equal(row(view, "r_shared").where, "");
  // A real title: the path adds where it lives. s_coach spans two projects,
  // so the project stays.
  assert.equal(row(view, "r_brief").where, "alpha / docs / brief.html");
  // s_ops is all "alpha", and the card already says so.
  assert.equal(row(view, "r_old4").where, "old-pages / p4.html");
  // Title "old-pages", project on the card: nothing to add.
  assert.equal(row(view, "r_old2").where, "");
});

test("a row outside its card keeps its project on the path line", () => {
  const state = vm.withShowMissing(okState(), true);
  assert.equal(row(build(freshList(), state), "r_wt_vanished").where, "alpha");
});

test("a pick-up answered with no request id says the agent already has it, not waiting", () => {
  // The helper queues nothing when the attached agent already owns or
  // watches the document, and answers request_id: null.
  const list = freshList();
  const state = vm.afterRequest(okState(), list, "r_mounted", "pickup", { ok: true, body: { request_id: null } }, NOW);
  const r = row(build(list, state), "r_mounted");
  assert.equal(r.note.text, "document index already has it. Nothing was sent.");
  assert.equal(r.note.busy, false);
  assert.equal(r.buttons.handTo.busy, false);
});
