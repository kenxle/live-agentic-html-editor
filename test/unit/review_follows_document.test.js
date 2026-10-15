// A review follows its document out of a removed worktree (spec
// docs/features/20261015.02_review_follows_document/01_spec_review_follows_document.md).
//
// The fixture: a fake main checkout with .git/worktrees/feature, a worktree
// whose .git file points at it, and git's back-link. A Markdown page is served
// from the worktree and commented on, then the worktree is removed the way git
// removes it: the worktree folder and its admin folder are moved aside
// (renamed, never deleted).
//
// The in-process tests run a helper on free ports in a temp state folder and a
// temp home, closed in teardown. The CLI tests run bin/lahe.js the same way
// and stop every helper they started.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const { createFixtures } = require("../../src/shared/record_fixtures.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const logModule = require("../../src/service/log.js");
const pageRoutes = require("../../src/service/page_routes.js");
const handled = require("../../src/service/handled_check.js");
const { sitesWorld, tempRoot, writeFile, raw, getPage } = require("../helpers/sites_world.js");
const { freePort } = require("../helpers/free_port.js");
const { stopTempHelpers } = require("../helpers/temp_helpers.js");

const READ = protocol.route("records.read");
const REVIEW_READ = protocol.route("review.read");
const POLL = protocol.route("replies.poll");
const NAVIGATE = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };
const BIN = path.join(__dirname, "..", "..", "bin", "lahe.js");

const WT_TEXT = "# Progress\n\nThe trainer writes the plan every week.\n\nA second paragraph stays the same.\n";
const MAIN_TEXT = "# Progress\n\nThe trainer writes the plan each week.\n\nA second paragraph stays the same.\n";
const REL = path.join("docs", "features", "x");

let counter = 0;
function append(state, reviewId, event) {
  logModule.createEventLog({ dir: state }).append(reviewId, [protocol.newEvent(event)]);
}

/** A committed (or draft) comment on a page, appended as the helper would. */
function postItem(state, reviewId, fields, draft) {
  const item = record.newItem(Object.assign({
    kind: record.KIND.COMMENT,
    state: draft ? record.STATE.DRAFT : record.STATE.READY,
    page_title: "Progress",
    page_seq: 1,
    note: "a comment"
  }, fields));
  counter += 1;
  append(state, reviewId, {
    event: draft ? protocol.EVENT.ITEM_CONTENT : protocol.EVENT.ITEM_READY,
    event_id: "ev_follow_" + counter, review: reviewId, item: item.id, rev: item.rev,
    page_path: item.page_path, page_title: "Progress", page_seq: 1,
    payload: { draft: !!draft, record: item }
  });
  return item;
}

/** The agent's handled reply, folded: the card moves to Done. */
function markHandled(state, reviewId, item) {
  counter += 1;
  append(state, reviewId, {
    event: protocol.EVENT.REPLY_FOLDED,
    event_id: "ev_follow_" + counter, review: reviewId, item: item.id, rev: item.rev,
    payload: {
      accepted: true,
      state: record.STATE.HANDLED,
      file: "replies-claude.jsonl",
      reply: { status: "handled", agent: "claude", reason: null, text: null, files: [] }
    }
  });
}

/**
 * The main checkout and a worktree of it, git's links both ways, the same
 * Markdown page in each. Nothing is served yet.
 */
function gitPair(home, options) {
  const opts = options || {};
  const main = opts.main || path.join(home, "ws", "repo");
  const admin = path.join(main, ".git", "worktrees", "feature");
  fs.mkdirSync(admin, { recursive: true });
  const wt = opts.worktree || path.join(home, "ws", "repo-wt", "feature");
  writeFile(wt, ".git", "gitdir: " + admin + "\n");
  writeFile(admin, "gitdir", path.join(wt, ".git") + "\n");
  const wtFile = writeFile(path.join(wt, REL), "progress.md", WT_TEXT);
  const mainFile = writeFile(path.join(main, REL), "progress.md", MAIN_TEXT);
  return {
    main, admin, wt, wtFile, mainFile,
    wtFolder: path.join(wt, REL),
    mainFolder: path.join(main, REL),
    /**
     * git worktree remove: the worktree and its admin folder go (moved aside
     * here). Resolves on the next turn of the event loop, the way the next
     * request after a removal arrives: the helper keeps a worktree root's
     * stat for the rest of the request that made it (R14).
     */
    remove() {
      fs.renameSync(wt, wt + "-removed");
      fs.renameSync(admin, admin + "-removed");
      return new Promise((resolve) => setImmediate(resolve));
    }
  };
}

/** A review of the worktree page with one open and one done card at its address. */
async function movedWorld(t, options) {
  const w = await sitesWorld(t);
  const pair = gitPair(w.home, options);
  const s1 = agentSessions.createStore({ dir: w.state }).create({ name: "Builder" }).id;
  const review = w.helper.reviews.create({
    target_path: path.join(w.state, "artifact-progress.html"),
    source_path: pair.wtFile,
    agent_session_id: s1,
    origins: ["null"]
  });
  const oldSite = w.helper.sites.bind({ root: pair.wtFolder, mode: "folder", entry: "progress.md" });
  const oldOrigin = protocol.siteOrigin(oldSite.name, w.helper.pagesPort);
  const open = postItem(w.state, review.id, { page_origin: oldOrigin, page_path: "/progress.md", note: "an open card" });
  const done = postItem(w.state, review.id, { page_origin: oldOrigin, page_path: "/progress.md", note: "a done card" });
  markHandled(w.state, review.id, done);
  postItem(w.state, review.id, { page_origin: oldOrigin, page_path: "/progress.md", note: "a draft" }, true);
  return Object.assign(w, pair, {
    s1, review, oldSite, oldOrigin, open, done,
    /** What `lahe review <main copy>` binds. */
    bindMain() {
      const site = w.helper.sites.bind({ root: pair.mainFolder, mode: "folder", entry: "progress.md" });
      return Object.assign(site, { origin: protocol.siteOrigin(site.name, w.helper.pagesPort) });
    }
  });
}

function readRecords(w, review, origin, pagePath) {
  return raw(w.helper.port, {
    path: READ.path + "?review=" + encodeURIComponent(review.id) + "&page_path=" + encodeURIComponent(pagePath),
    headers: { host: "127.0.0.1:" + w.helper.port, "x-lahe-client": "layer", "x-lahe-token": review.token, origin }
  });
}

function reviewRead(w, review, origin) {
  return raw(w.helper.port, {
    path: REVIEW_READ.path + "?review=" + encodeURIComponent(review.id),
    headers: { host: "127.0.0.1:" + w.helper.port, "x-lahe-client": "layer", "x-lahe-token": review.token, origin }
  });
}

function tagReview(html) {
  const m = /data-lahe-review="([^"]+)"/.exec(html);
  return m ? m[1] : null;
}

function spellingsOf(html) {
  const m = /data-lahe-spellings="([^"]*)"/.exec(html);
  return m ? JSON.parse(m[1].replace(/&quot;/g, "\"")) : [];
}

// --- R1 to R3: the move function -------------------------------------------------

test("R1, R3: the main copy is named only once the worktree is gone, git agreeing", async (t) => {
  const w = await movedWorld(t);
  assert.equal(pageRoutes.movedCopyOf(w.state, w.wtFile), null, "the worktree is still there");
  await w.remove();
  assert.equal(pageRoutes.movedCopyOf(w.state, w.wtFile), fs.realpathSync.native(w.mainFile));
  // A file in the worktree but outside the served site's own root is not moved.
  assert.equal(pageRoutes.movedCopyOf(w.state, path.join(w.wt, "README.md")), null);
});

test("R1: a worktree moved with git worktree move is not gone", async (t) => {
  const w = await movedWorld(t);
  const moved = w.wt + "-moved";
  fs.renameSync(w.wt, moved);
  fs.writeFileSync(path.join(w.admin, "gitdir"), path.join(moved, ".git") + "\n");
  assert.equal(pageRoutes.movedCopyOf(w.state, w.wtFile), null);
});

test("R3: no main copy, no move", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  fs.renameSync(w.mainFile, w.mainFile + ".aside");
  assert.equal(pageRoutes.movedCopyOf(w.state, w.wtFile), null);
});

test("R1: a site bound before the admin folder was saved still judges gone by git", async (t) => {
  const w = await movedWorld(t);
  const site = w.helper.sites.get(w.oldSite.name);
  assert.equal(site.worktree_admin, w.admin, "bind saves the admin folder");
  assert.equal(site.main_checkout, fs.realpathSync.native(w.main), "bind saves the real main checkout");
  delete site.worktree_admin;
  // Moved, not removed: the admin folder names an existing worktree.
  const moved = w.wt + "-moved";
  fs.renameSync(w.wt, moved);
  fs.writeFileSync(path.join(w.admin, "gitdir"), path.join(moved, ".git") + "\n");
  assert.equal(pageRoutes.movedCopyOf(w.state, w.wtFile), null);
});

test("R1: an old site with no saved admin folder, removed, moves", async (t) => {
  const w = await movedWorld(t);
  delete w.helper.sites.get(w.oldSite.name).worktree_admin;
  await w.remove();
  assert.equal(pageRoutes.movedCopyOf(w.state, w.wtFile), fs.realpathSync.native(w.mainFile));
});

test("R2, R3: a copy reached through a symlink that leaves the twin root is not the document", async (t) => {
  const w = await movedWorld(t);
  writeFile(w.wtFolder, "linked.md", "# In the worktree\n");
  const outside = writeFile(w.main, "secret.md", "# Outside the twin\n");
  fs.symlinkSync(outside, path.join(w.mainFolder, "linked.md"));
  await w.remove();
  assert.equal(pageRoutes.movedCopyOf(w.state, path.join(w.wtFolder, "linked.md")), null);
});

test("R2: a twin root that is a symlink out of the main checkout is refused", async (t) => {
  const w = await movedWorld(t);
  const elsewhere = path.join(w.home, "elsewhere", "x");
  fs.mkdirSync(path.dirname(elsewhere), { recursive: true });
  fs.renameSync(w.mainFolder, elsewhere);
  fs.symlinkSync(elsewhere, w.mainFolder);
  await w.remove();
  assert.equal(pageRoutes.movedCopyOf(w.state, w.wtFile), null);
});

test("R2: a saved main checkout whose path is now a symlink is refused", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  fs.renameSync(w.main, w.main + "-real");
  fs.symlinkSync(w.main + "-real", w.main);
  assert.equal(pageRoutes.movedCopyOf(w.state, w.wtFile), null);
});

test("R2: a main checkout whose .git is not a folder is refused", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  fs.renameSync(path.join(w.main, ".git"), path.join(w.main, ".git-aside"));
  fs.writeFileSync(path.join(w.main, ".git"), "gitdir: /nowhere\n");
  assert.equal(pageRoutes.movedCopyOf(w.state, w.wtFile), null);
});

test("R2: a main checkout outside the home folder is refused", async (t) => {
  const w = await sitesWorld(t);
  const pair = gitPair(w.home, { main: path.join(w.root, "outside-home", "repo") });
  w.helper.sites.bind({ root: pair.wtFolder, mode: "folder", entry: "progress.md" });
  await pair.remove();
  assert.equal(pageRoutes.movedCopyOf(w.state, pair.wtFile), null);
});

test("R2: a main checkout inside the state folder is refused by the site check itself", async (t) => {
  // Through movedCopyOf this cannot be told apart from the copy's own
  // state-folder check (a copy under such a checkout is in the state folder
  // too), so the site's move is asked directly, beside a control outside it.
  const w = await sitesWorld(t);
  const inside = gitPair(w.home, { main: path.join(w.state, "repo"), worktree: path.join(w.home, "ws", "wt-in", "feature") });
  const outside = gitPair(w.home, { main: path.join(w.home, "ws", "repo-out"), worktree: path.join(w.home, "ws", "wt-out", "feature") });
  const inSite = w.helper.sites.bind({ root: inside.wtFolder, mode: "folder", entry: "progress.md" });
  const outSite = w.helper.sites.bind({ root: outside.wtFolder, mode: "folder", entry: "progress.md" });
  await inside.remove();
  await outside.remove();
  assert.equal(pageRoutes.moveOfSite(w.state, inSite.name), null);
  assert.ok(pageRoutes.moveOfSite(w.state, outSite.name), "the control outside the state folder moves");
  assert.equal(pageRoutes.movedCopyOf(w.state, inside.wtFile), null);
});

// --- R5: one seam for records ---------------------------------------------------

test("R5: an item made at the old address names the main copy; a live worktree names its own file", async (t) => {
  const w = await movedWorld(t);
  assert.equal(pageRoutes.fileForPage(w.state, w.oldOrigin, "/progress.md"), fs.realpathSync.native(w.wtFile));
  await w.remove();
  assert.equal(pageRoutes.fileForPage(w.state, w.oldOrigin, "/progress.md"), fs.realpathSync.native(w.mainFile));
});

test("R5: the handled check judges an old edit card against the main copy", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  w.bindMain();
  const edit = createFixtures({
    seed: "follow",
    page: { origin: w.oldOrigin, path: "/progress.md", title: "Progress", seq: 1, source_hint: null }
  }).edit();
  const check = handled.createHandledCheck({ dir: w.state });
  // The main copy still has the words the reviewer changed: held open. A real
  // verdict read off the main copy; the gone worktree file could only ever
  // answer "cannot tell" (null), which lets the reply through.
  fs.writeFileSync(w.mainFile, WT_TEXT);
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(w.mainFile, later, later);
  assert.equal(check.pageShows(w.review.id, edit), false);
  // The agent's edit landed in the main copy: not held open.
  fs.writeFileSync(w.mainFile, MAIN_TEXT);
  const latest = new Date(Date.now() + 10000);
  fs.utimesSync(w.mainFile, latest, latest);
  assert.notEqual(check.pageShows(w.review.id, edit), false);
});

// --- R6, R8, R9: the file's review, the rail, the records ------------------------

test("R6: holderOfFile names the old review for the main copy once the worktree is gone", async (t) => {
  const w = await movedWorld(t);
  assert.equal(pageRoutes.holderOfFile(w.state, w.mainFile), null, "two documents while the worktree is there");
  await w.remove();
  const held = pageRoutes.holderOfFile(w.state, w.mainFile);
  assert.equal(held.review, w.review.id);
  assert.equal(held.tier, 1);
  assert.equal(held.moved, true);
});

test("R6: a retired old review holds nothing", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  w.helper.reviews.retire(w.review.id);
  assert.equal(pageRoutes.holderOfFile(w.state, w.mainFile), null);
});

test("R6, R9: the main copy's page carries the old review and its open and done cards, never a draft", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  const main = w.bindMain();
  const page = await getPage(w, main.name, "/progress.md");
  assert.equal(page.status, 200);
  assert.equal(tagReview(page.text), w.review.id);
  assert.deepEqual(spellingsOf(page.text), [w.oldOrigin + " /progress.md"]);
  const res = await readRecords(w, w.review, main.origin, "/progress.md");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.records.map((r) => r.id).sort(), [w.open.id, w.done.id].sort());
  assert.deepEqual(res.json.others, []);
});

test("R6: the Origin check accepts the main copy's site for the moved review, and not an unrelated site", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  const main = w.bindMain();
  const other = writeFile(path.join(w.home, "ws", "other"), "page.md", "# Other\n");
  const otherSite = w.helper.sites.bind({ root: path.dirname(other), mode: "folder", entry: "page.md" });
  const moves = () => pageRoutes.movesFor(w.state);
  const meta = w.helper.reviews.get(w.review.id);
  assert.equal(pageRoutes.reviewAnswersOnSite(w.helper.sites.get(main.name), meta, moves), true);
  assert.equal(pageRoutes.reviewAnswersOnSite(w.helper.sites.get(otherSite.name), meta, moves), false);
  const refused = await readRecords(w, w.review, protocol.siteOrigin(otherSite.name, w.helper.pagesPort), "/page.md");
  assert.notEqual(refused.status, 200);
});

test("R8: Ken's state. A newer empty review on the main copy loses to the old review with comments, and a stamp cannot flip it", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  const main = w.bindMain();
  // `lahe review <main copy>` before this change: a second, newer review.
  const newer = w.helper.reviews.create({
    target_path: path.join(w.state, "artifact-progress-main.html"),
    source_path: w.mainFile,
    agent_session_id: w.s1,
    origins: ["null"]
  });
  // Then the old review re-attached by hand with --review: it records the main path too.
  w.helper.reviews.recordPaths(w.review.id, { source_path: w.mainFile });
  w.helper.reviews.stampServedByHelper(newer.id, new Date(Date.now() + 60000).toISOString());
  const held = pageRoutes.holderOfFile(w.state, w.mainFile);
  assert.equal(held.review, w.review.id);
  const page = await getPage(w, main.name, "/progress.md");
  assert.equal(tagReview(page.text), w.review.id);
  const res = await readRecords(w, w.review, main.origin, "/progress.md");
  assert.deepEqual(res.json.records.map((r) => r.id).sort(), [w.open.id, w.done.id].sort());
});

test("R8: a newer review that holds comments keeps the page; the old cards show read-only", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  const main = w.bindMain();
  const newer = w.helper.reviews.create({
    target_path: path.join(w.state, "artifact-progress-main.html"),
    source_path: w.mainFile,
    agent_session_id: w.s1,
    origins: ["null"]
  });
  w.helper.reviews.stampServedByHelper(newer.id, new Date(Date.now() + 60000).toISOString());
  postItem(w.state, newer.id, { page_origin: main.origin, page_path: "/progress.md", note: "said on main" });
  assert.equal(pageRoutes.holderOfFile(w.state, w.mainFile).review, newer.id);
  const page = await getPage(w, main.name, "/progress.md");
  assert.equal(tagReview(page.text), newer.id);
  const res = await readRecords(w, newer, main.origin, "/progress.md");
  assert.equal(res.json.others.length, 1);
  assert.deepEqual(res.json.others[0].records.map((r) => r.id).sort(), [w.open.id, w.done.id].sort());
});

test("R7: recordPaths replaces a first source that is gone, and keeps the old path in the list", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  const after = w.helper.reviews.recordPaths(w.review.id, { source_path: w.mainFile });
  assert.equal(after.source_path, w.mainFile);
  assert.deepEqual(after.source_paths, [w.wtFile, w.mainFile]);
});

test("R7: a gone first source is replaced only by its own moved copy, never by another document", async (t) => {
  const w = await sitesWorld(t);
  const notes = path.join(w.home, "ws", "repo", "notes");
  const hub = writeFile(notes, "hub.md", "# Hub\n");
  const linked = writeFile(notes, "linked.md", "# Linked\n");
  const s1 = agentSessions.createStore({ dir: w.state }).create({ name: "Hub agent" }).id;
  const review = w.helper.reviews.create({ target_path: path.join(w.state, "artifact-hub.html"), source_path: hub, agent_session_id: s1, origins: ["null"] });
  // The hub is deleted (moved aside here); a linked document's source is recorded.
  fs.renameSync(hub, hub + ".aside");
  const after = w.helper.reviews.recordPaths(review.id, { source_path: linked });
  assert.equal(after.source_path, hub, "the hub stays the first source");
  assert.deepEqual(after.source_paths, [hub, linked]);
});

test("R10: review.json names the main copy as the source for the old cards' page", async (t) => {
  const w = await movedWorld(t);
  // The cards carry the worktree file as their source hint, as a page would.
  postItem(w.state, w.review.id, {
    page_origin: w.oldOrigin, page_path: "/progress.md", note: "hinted",
    source_hint: { known: true, path: w.wtFile }
  });
  await w.remove();
  const main = w.bindMain();
  const res = await reviewRead(w, w.review, main.origin);
  assert.equal(res.status, 200, res.text);
  const group = res.json.pages.find((p) => p.path === "/progress.md");
  assert.equal(group.source_hint.path, fs.realpathSync.native(w.mainFile));
});

// --- R11: the old address --------------------------------------------------------

test("R11: a page load of the old address goes to the main copy's address, built from the registry", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  const main = w.bindMain();
  const res = await getPage(w, w.oldSite.name, "/progress.md?to=http://evil.example/", NAVIGATE);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, main.origin + "/progress.md");
  // Without both Fetch Metadata headers: read-only, no rail.
  const plain = await getPage(w, w.oldSite.name, "/progress.md");
  assert.equal(plain.status, 200);
  assert.equal(tagReview(plain.text), null);
  assert.match(plain.text, /worktree is gone/);
});

test("R11: no site holds the main copy: read-only, with a note that prints no command", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  const res = await getPage(w, w.oldSite.name, "/progress.md", NAVIGATE);
  assert.equal(res.status, 200);
  assert.equal(tagReview(res.text), null);
  const note = /<p class="lahe-readonly-note lahe-moved-note">[\s\S]*?<\/p>/.exec(res.text)[0];
  assert.doesNotMatch(note, /lahe review|lahe session|--session/);
  assert.match(note, /the Library/);
});

test("R11: when the main copy's page carries another review, no redirect; the note names it", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  const main = w.bindMain();
  const newer = w.helper.reviews.create({
    target_path: path.join(w.state, "artifact-progress-main.html"),
    source_path: w.mainFile,
    agent_session_id: w.s1,
    origins: ["null"],
    name: "Main copy review"
  });
  w.helper.reviews.stampServedByHelper(newer.id, new Date(Date.now() + 60000).toISOString());
  postItem(w.state, newer.id, { page_origin: main.origin, page_path: "/progress.md", note: "said on main" });
  const res = await getPage(w, w.oldSite.name, "/progress.md", NAVIGATE);
  assert.equal(res.status, 200);
  assert.equal(tagReview(res.text), null);
  assert.match(res.text, /has its own review now/);
});

test("R11: a path holding shell text is shown escaped, and no command is built from it", async (t) => {
  const w = await sitesWorld(t);
  const pair = gitPair(w.home, { worktree: path.join(w.home, "ws", "wt $(touch x) `id`", "feature") });
  w.helper.sites.bind({ root: pair.wtFolder, mode: "folder", entry: "progress.md" });
  const name = w.helper.sites.list()[0].name;
  await pair.remove();
  const res = await getPage(w, name, "/progress.md", NAVIGATE);
  const note = /<p class="lahe-readonly-note lahe-moved-note">[\s\S]*?<\/p>/.exec(res.text)[0];
  assert.match(note, /\$\(touch x\)/, "the path is shown as text");
  assert.doesNotMatch(note, /lahe review|lahe session/);
});

// --- R14: lookup cost ------------------------------------------------------------

test("R14: one root check per worktree site per page, and no recorded path outside a gone root is looked at", async (t) => {
  const w = await movedWorld(t);
  await w.remove();
  const main = w.bindMain();
  // Many other reviews of files elsewhere.
  const elsewhere = path.join(w.home, "ws", "many");
  for (let i = 0; i < 60; i += 1) {
    const file = writeFile(elsewhere, "p" + i + ".md", "# P" + i + "\n");
    w.helper.reviews.create({ target_path: path.join(w.state, "a" + i + ".html"), source_path: file, agent_session_id: w.s1, origins: ["null"] });
  }
  const roots = w.helper.sites.list().map((e) => e.site.worktree_root).filter(Boolean);
  const seen = [];
  const original = fs.existsSync;
  fs.existsSync = function (p) { seen.push(String(p)); return original.apply(fs, arguments); };
  try {
    pageRoutes.pickReview(w.state, w.helper.sites.get(main.name), {
      filePaths: [fs.realpathSync.native(w.mainFile)], realFile: fs.realpathSync.native(w.mainFile), mounted: false
    });
  } finally {
    fs.existsSync = original;
  }
  for (const root of roots) {
    assert.ok(seen.filter((p) => p === root).length <= 1, "at most one check of " + root);
  }
  assert.equal(seen.filter((p) => p.indexOf(elsewhere) === 0).length, 0, "no stat of a path under no gone root");
});

// --- R7: the CLI ----------------------------------------------------------------

async function cliWorld(t) {
  const root = tempRoot("lahe-follow-cli-");
  const home = path.join(root, "home");
  fs.mkdirSync(home);
  const w = { root, home, state: path.join(root, "state"), port: await freePort(), sessions: [] };
  w.env = Object.assign({}, process.env, { LAHE_HOME_DIR: home, LAHE_PAGES_PORT: String(await freePort()) });
  t.after(async () => {
    for (const s of w.sessions) run(w, ["session", "close", s]);
    await stopTempHelpers(w.state);
  });
  return w;
}

function run(w, args) {
  const full = [BIN].concat(args, ["--state-dir", w.state, "--port", String(w.port)]);
  try {
    return { code: 0, stdout: execFileSync(process.execPath, full, { env: w.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }), stderr: "" };
  } catch (err) {
    return { code: err.status || 1, stdout: String(err.stdout || ""), stderr: String(err.stderr || "") };
  }
}

function reviewIds(w) {
  const dir = path.join(w.state, "reviews");
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => /^r/.test(n)).sort() : [];
}

function metaOf(w, id) {
  return JSON.parse(fs.readFileSync(path.join(w.state, "reviews", id, "meta.json"), "utf8"));
}

function pagesPort(w) {
  return Number(w.env.LAHE_PAGES_PORT);
}

/** `lahe review` of the worktree page in a new session, one comment at its address, then the worktree removed. */
async function cliMoved(t) {
  const w = await cliWorld(t);
  const pair = gitPair(w.home);
  const first = run(w, ["review", pair.wtFile, "--new-session"]);
  assert.equal(first.code, 0, first.stderr);
  const session = /--session (s_[A-Za-z0-9_-]+)/.exec(first.stdout)[1];
  w.sessions.push(session);
  const review = reviewIds(w)[0];
  const oldUrl = /^\s*open\s+(\S+)/m.exec(first.stdout)[1];
  const oldOrigin = new URL(oldUrl).origin;
  postItem(w.state, review, { page_origin: oldOrigin, page_path: "/progress.md", note: "said in the worktree" });
  await pair.remove();
  return Object.assign(w, pair, { session, review, oldOrigin });
}

test("R7: lahe review of the main copy in the owning session continues the old review", async (t) => {
  const w = await cliMoved(t);
  const out = run(w, ["review", w.mainFile, "--session", w.session]);
  assert.equal(out.code, 0, out.stderr);
  assert.deepEqual(reviewIds(w), [w.review], "no second review");
  const meta = metaOf(w, w.review);
  assert.equal(meta.source_path, w.mainFile, "the gone first source is replaced");
  assert.ok(meta.source_paths.indexOf(w.wtFile) !== -1, "the old path stays in the list");
  const url = new URL(/^\s*open\s+(\S+)/m.exec(out.stdout)[1]);
  const page = await raw(pagesPort(w), { path: url.pathname, headers: { host: url.host } });
  assert.equal(tagReview(page.text), w.review);
  const res = await raw(w.port, {
    path: READ.path + "?review=" + w.review + "&page_path=" + encodeURIComponent(url.pathname),
    headers: { host: "127.0.0.1:" + w.port, "x-lahe-client": "layer", "x-lahe-token": meta.token, origin: url.origin }
  });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.records.length, 1);
});

test("R7: from another session it opens the review, names the owner, and makes nothing; --new is refused", async (t) => {
  const w = await cliMoved(t);
  const store = agentSessions.createStore({ dir: w.state });
  const other = store.create({ name: "Other agent" }).id;
  w.sessions.push(other);
  const out = run(w, ["review", w.mainFile, "--session", other]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, new RegExp("review\\s+" + w.review));
  assert.match(out.stdout, /already has a review/);
  assert.deepEqual(reviewIds(w), [w.review]);
  assert.equal(metaOf(w, w.review).agent_session_id, w.session, "the owner did not change");
  const refused = run(w, ["review", w.mainFile, "--new-session"]);
  assert.notEqual(refused.code, 0);
  assert.match(refused.stderr, /already has a review/);
  assert.deepEqual(reviewIds(w), [w.review]);
});

test("R7: with the owning session closed, the rail still carries the review, shows no agent, and the command names the takeover", async (t) => {
  const w = await cliMoved(t);
  run(w, ["session", "close", w.session]);
  const out = run(w, ["review", w.mainFile]);
  assert.equal(out.code, 0, out.stderr);
  assert.match(out.stdout, new RegExp("lahe session takeover " + w.session));
  assert.deepEqual(reviewIds(w), [w.review]);
  const url = new URL(/^\s*open\s+(\S+)/m.exec(out.stdout)[1]);
  const page = await raw(pagesPort(w), { path: url.pathname, headers: { host: url.host } });
  assert.equal(tagReview(page.text), w.review);
  const token = metaOf(w, w.review).token;
  const poll = await raw(w.port, {
    path: POLL.path + "?review=" + w.review + "&since=0&page_path=" + encodeURIComponent(url.pathname),
    headers: { host: "127.0.0.1:" + w.port, "x-lahe-client": "layer", "x-lahe-token": token, origin: url.origin }
  });
  assert.equal(poll.status, 200, poll.text);
  const live = poll.json.agent_liveness;
  assert.notEqual(live[protocol.AGENT_LIVENESS.FIELD.LISTENING], true, "no agent watching");
  assert.equal(live[protocol.AGENT_LIVENESS.FIELD.SESSION_ID], w.session, "the takeover names the owner");
});

// --- R14 in the Library: one move list per scan -----------------------------------

test("R14: a Library scan outside the helper reads the registry once and checks each worktree root at most once", async (t) => {
  const w = await sitesWorld(t);
  const pair = gitPair(w.home);
  const s1 = agentSessions.createStore({ dir: w.state }).create({ name: "Builder" }).id;
  // Several reviews of pages in one worktree folder, all moved.
  for (let i = 0; i < 6; i += 1) {
    const wtFile = writeFile(pair.wtFolder, "page" + i + ".md", "# Page " + i + "\n");
    writeFile(pair.mainFolder, "page" + i + ".md", "# Page " + i + "\n");
    w.helper.reviews.create({ target_path: path.join(w.state, "a" + i + ".html"), source_path: wtFile, agent_session_id: s1, origins: ["null"] });
  }
  w.helper.sites.bind({ root: pair.wtFolder, mode: "folder", entry: "progress.md" });
  // The CLI's case (the drain, `lahe library serve`): no helper in this process.
  await w.helper.close();
  await pair.remove();
  const reader = require("../../src/service/catalog_reader.js").createReader({ dir: w.state });
  const sitesJson = path.join(w.state, "sites.json");
  const readyJson = path.join(w.state, "ready.json");
  const reads = [];
  const roots = [];
  const originalRead = fs.readFileSync;
  const originalExists = fs.existsSync;
  fs.readFileSync = function (p) { reads.push(String(p)); return originalRead.apply(fs, arguments); };
  fs.existsSync = function (p) { roots.push(String(p)); return originalExists.apply(fs, arguments); };
  let list;
  try {
    list = await reader.list(Date.now());
  } finally {
    fs.readFileSync = originalRead;
    fs.existsSync = originalExists;
  }
  assert.ok(reads.filter((p) => p === sitesJson).length <= 1, "sites.json read " + reads.filter((p) => p === sitesJson).length + " times");
  assert.equal(reads.filter((p) => p === readyJson).length, 0, "ready.json is not read for the move");
  assert.ok(roots.filter((p) => p === pair.wt).length <= 1, "the worktree root checked " + roots.filter((p) => p === pair.wt).length + " times");
  const moved = JSON.stringify(list).match(/"moved":true/g) || [];
  assert.equal(moved.length > 0, true, "the rows are moved");
});
