// A file's comments move with it (spec
// docs/features/20261017.01_comments_follow_moved_file/01_spec_comments_follow_moved_file.md).
//
// The fixture: a page served from one folder and commented on there, then
// moved to another folder, and the new path recorded on the same review, the
// way `lahe review <new path> --review <id>` records it. The helper runs on
// free ports in a temp state folder and a temp home, closed in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const logModule = require("../../src/service/log.js");
const pageRoutes = require("../../src/service/page_routes.js");
const handled = require("../../src/service/handled_check.js");
const sitesModule = require("../../src/service/sites.js");
const { sitesWorld, writeFile, raw, getPage } = require("../helpers/sites_world.js");

const READ = protocol.route("records.read");
const REVIEW_READ = protocol.route("review.read");
const BIND = protocol.route("site.bind");
const NAVIGATE = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };
const OLD_PATH = "/reports/x/brief.html";
const HTML = "<!doctype html><title>Brief</title><p>The brief says what we will study.</p>\n";

let counter = 0;
function append(state, reviewId, event) {
  logModule.createEventLog({ dir: state }).append(reviewId, [protocol.newEvent(event)]);
}

function postItem(state, reviewId, fields) {
  const item = record.newItem(Object.assign({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    page_title: "Brief",
    page_seq: 1,
    note: "a comment"
  }, fields));
  counter += 1;
  append(state, reviewId, {
    event: protocol.EVENT.ITEM_READY,
    event_id: "ev_move_" + counter, review: reviewId, item: item.id, rev: item.rev,
    page_path: item.page_path, page_title: "Brief", page_seq: 1,
    payload: { draft: false, record: item }
  });
  return item;
}

function markHandled(state, reviewId, item) {
  counter += 1;
  append(state, reviewId, {
    event: protocol.EVENT.REPLY_FOLDED,
    event_id: "ev_move_" + counter, review: reviewId, item: item.id, rev: item.rev,
    payload: {
      accepted: true,
      state: record.STATE.HANDLED,
      file: "replies-claude.jsonl",
      reply: { status: "handled", agent: "claude", reason: null, text: null, files: [] }
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

/** site.bind over the route, as `lahe review` sends it: the CLI secret, no Origin. */
function bindRequest(w, body) {
  return raw(w.helper.port, {
    method: "POST",
    path: BIND.path,
    headers: {
      host: "127.0.0.1:" + w.helper.port,
      "content-type": "application/json",
      "x-lahe-client": "cli",
      "x-lahe-cli-secret": sitesModule.readCliSecret(w.state)
    },
    body: body
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

/**
 * A brief at ws/projects/reports/x/brief.html, served from its folder, with one
 * open and one done card at that address. `move()` moves the folder to
 * ws/docs/reports/x, binds a site there and records the new path on the review.
 */
async function briefWorld(t) {
  const w = await sitesWorld(t);
  const oldFolder = path.join(w.home, "ws", "projects", "reports", "x");
  const newFolder = path.join(w.home, "ws", "docs", "reports", "x");
  const oldFile = writeFile(oldFolder, "brief.html", HTML);
  const s1 = agentSessions.createStore({ dir: w.state }).create({ name: "Researcher" }).id;
  const review = w.helper.reviews.create({ target_path: oldFile, agent_session_id: s1, origins: ["null"] });
  // The old site is rooted above the folder that moves, as Ken's was: a link
  // left at the old folder then points outside the old site's root.
  const oldSite = w.helper.sites.bind({ root: path.join(w.home, "ws", "projects"), mode: "folder", entry: "reports/x/brief.html" });
  const oldOrigin = protocol.siteOrigin(oldSite.name, w.helper.pagesPort);
  const open = postItem(w.state, review.id, { page_origin: oldOrigin, page_path: OLD_PATH, note: "an open card" });
  const done = postItem(w.state, review.id, { page_origin: oldOrigin, page_path: OLD_PATH, note: "a done card" });
  markHandled(w.state, review.id, done);
  return Object.assign(w, {
    s1, review, oldFolder, newFolder, oldFile, oldSite, oldOrigin, open, done,
    newFile: path.join(newFolder, "brief.html"),
    /** mv the folder, then what `lahe review <new path> --review <id>` records. */
    move(options) {
      const opts = options || {};
      fs.mkdirSync(path.dirname(newFolder), { recursive: true });
      fs.renameSync(oldFolder, newFolder);
      if (opts.symlink) fs.symlinkSync(newFolder, oldFolder);
      const file = opts.rename ? path.join(newFolder, opts.rename) : path.join(newFolder, "brief.html");
      if (opts.rename) fs.renameSync(path.join(newFolder, "brief.html"), file);
      if (opts.bind === false) {
        w.helper.reviews.recordPaths(review.id, { target_path: file });
        return { file };
      }
      const site = w.helper.sites.bind({ root: newFolder, mode: "folder", entry: path.basename(file) });
      w.helper.reviews.recordPaths(review.id, { target_path: file });
      return Object.assign(site, { origin: protocol.siteOrigin(site.name, w.helper.pagesPort), file });
    }
  });
}

function itemOf(w, item) {
  const meta = Object.assign({ id: w.review.id }, w.helper.reviews.get(w.review.id));
  return pageRoutes.fileOfItem(w.state, pageRoutes.activeFor(w.state), meta, item);
}

// --- Pairing a gone page with its new file ---------------------------------------

test("a plain move: an item made at the old address names the new file", async (t) => {
  const w = await briefWorld(t);
  assert.equal(itemOf(w, w.open), fs.realpathSync.native(w.oldFile), "before the move, its own file");
  w.move();
  assert.equal(itemOf(w, w.open), fs.realpathSync.native(w.newFile));
});

test("a plain move: the new page carries the review, the old spelling, and the open and done cards", async (t) => {
  const w = await briefWorld(t);
  const site = w.move();
  const page = await getPage(w, site.name, "/brief.html");
  assert.equal(page.status, 200);
  assert.equal(tagReview(page.text), w.review.id);
  assert.deepEqual(spellingsOf(page.text), [w.oldOrigin + " " + OLD_PATH]);
  const res = await readRecords(w, w.review, site.origin, "/brief.html");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.records.map((r) => r.id).sort(), [w.open.id, w.done.id].sort());
});

test("the symlink case: an old folder left as a link to the new one still pairs", async (t) => {
  const w = await briefWorld(t);
  const site = w.move({ symlink: true });
  assert.equal(itemOf(w, w.open), fs.realpathSync.native(w.newFile));
  const res = await readRecords(w, w.review, site.origin, "/brief.html");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.records.map((r) => r.id).sort(), [w.open.id, w.done.id].sort());
});

test("a move with a new name, and no link from the old path, does not pair", async (t) => {
  const w = await briefWorld(t);
  w.move({ rename: "brief_v2.html" });
  assert.notEqual(itemOf(w, w.open), fs.realpathSync.native(path.join(w.newFolder, "brief_v2.html")));
});

test("a renamed file still pairs when the old path links to it", async (t) => {
  const w = await briefWorld(t);
  const site = w.move({ rename: "brief_v2.html" });
  fs.mkdirSync(w.oldFolder, { recursive: true });
  fs.symlinkSync(site.file, w.oldFile);
  assert.equal(itemOf(w, w.open), fs.realpathSync.native(site.file));
});

test("two later pages with the same name: neither pairs", async (t) => {
  const w = await briefWorld(t);
  w.move();
  const later = writeFile(path.join(w.home, "ws", "archive", "x"), "brief.html", HTML);
  w.helper.sites.bind({ root: path.dirname(later), mode: "folder", entry: "brief.html" });
  w.helper.reviews.recordPaths(w.review.id, { target_path: later });
  const named = itemOf(w, w.open);
  assert.notEqual(named, fs.realpathSync.native(w.newFile));
  assert.notEqual(named, fs.realpathSync.native(later));
});

test("a deleted file pairs with no sibling of the same name: not one in another review, not one of two here", async (t) => {
  const w = await briefWorld(t);
  const a = writeFile(path.join(w.home, "ws", "docs", "a"), "brief.html", HTML);
  const b = writeFile(path.join(w.home, "ws", "docs", "b"), "brief.html", HTML);
  w.helper.sites.bind({ root: path.dirname(a), mode: "folder", entry: "brief.html" });
  w.helper.sites.bind({ root: path.dirname(b), mode: "folder", entry: "brief.html" });
  w.helper.reviews.create({ target_path: a, agent_session_id: w.s1, origins: ["null"] });
  fs.renameSync(w.oldFile, w.oldFile + ".aside");
  assert.equal(itemOf(w, w.open), w.oldFile, "a sibling in another review is not this review's page");
  w.helper.reviews.recordPaths(w.review.id, { target_path: a });
  w.helper.reviews.recordPaths(w.review.id, { target_path: b });
  assert.equal(itemOf(w, w.open), w.oldFile, "two qualify, so neither does");
});

test("a later path no site serves, or one in the state folder, does not pair", async (t) => {
  const w = await briefWorld(t);
  w.move({ bind: false });
  assert.equal(itemOf(w, w.open), w.oldFile, "no site serves the new folder");
  // Moved again, into the state folder, and recorded there.
  const inState = path.join(w.state, "x", "brief.html");
  fs.mkdirSync(path.dirname(inState), { recursive: true });
  fs.renameSync(w.newFile, inState);
  w.helper.reviews.recordPaths(w.review.id, { target_path: inState });
  assert.equal(itemOf(w, w.open), w.oldFile, "a file in the state folder never pairs");
  // A site rooted above the state folder holds that file, so only the state
  // folder rule refuses it.
  w.helper.sites.bind({ root: w.root, mode: "folder", entry: "home" });
  // The next request: a pair is kept only for the request that asked.
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(itemOf(w, w.open), w.oldFile, "a file in the state folder never pairs, even under a site's root");
});

test("a file moved twice pairs with the copy that is still there", async (t) => {
  const w = await briefWorld(t);
  w.move();
  const third = path.join(w.home, "ws", "final", "x");
  fs.mkdirSync(path.dirname(third), { recursive: true });
  fs.renameSync(w.newFolder, third);
  w.helper.sites.bind({ root: third, mode: "folder", entry: "brief.html" });
  w.helper.reviews.recordPaths(w.review.id, { target_path: path.join(third, "brief.html") });
  assert.equal(itemOf(w, w.open), fs.realpathSync.native(path.join(third, "brief.html")));
})

test("a page still on disk never pairs, even with a newer page of the same name", async (t) => {
  const w = await briefWorld(t);
  const copy = writeFile(path.join(w.home, "ws", "docs", "copy"), "brief.html", HTML);
  w.helper.sites.bind({ root: path.dirname(copy), mode: "folder", entry: "brief.html" });
  w.helper.reviews.recordPaths(w.review.id, { target_path: copy });
  assert.equal(itemOf(w, w.open), fs.realpathSync.native(w.oldFile));
});

test("another review's comments on a gone page it never recorded do not pair, though it records the new file", async (t) => {
  const w = await briefWorld(t);
  // The other review's comments were made on a same-named page at another
  // site, through its rail, without that review recording the page.
  const otherPage = writeFile(path.join(w.home, "ws", "gone", "x"), "brief.html", HTML);
  const otherSite = w.helper.sites.bind({ root: path.dirname(otherPage), mode: "folder", entry: "brief.html" });
  const otherOrigin = protocol.siteOrigin(otherSite.name, w.helper.pagesPort);
  const site = w.move();
  const other = w.helper.reviews.create({ target_path: w.newFile, agent_session_id: w.s1, origins: ["null"] });
  const said = postItem(w.state, other.id, { page_origin: otherOrigin, page_path: "/brief.html", note: "said on the other page" });
  fs.renameSync(otherPage, otherPage + ".aside");
  const res = await readRecords(w, w.review, site.origin, "/brief.html");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.records.map((r) => r.id).sort(), [w.open.id, w.done.id].sort());
  const shown = res.json.others.reduce((all, group) => all.concat(group.records.map((r) => r.id)), []);
  assert.equal(shown.indexOf(said.id), -1, "the other review's comment is not on this page");
});

// --- Every reader names the new file ---------------------------------------------

test("after a plain move, the handled check reads the new file", async (t) => {
  const w = await briefWorld(t);
  w.move();
  const meta = Object.assign({ id: w.review.id }, w.helper.reviews.get(w.review.id));
  assert.deepEqual(handled.pageFilesFor(meta, w.open, w.state), [fs.realpathSync.native(w.newFile)]);
});

test("in the symlink case too, the handled check reads the new file and only that", async (t) => {
  const w = await briefWorld(t);
  w.move({ symlink: true });
  const meta = Object.assign({ id: w.review.id }, w.helper.reviews.get(w.review.id));
  assert.deepEqual(handled.pageFilesFor(meta, w.open, w.state), [fs.realpathSync.native(w.newFile)]);
});

test("after a plain move, review.json names the new file as the old cards' source", async (t) => {
  const w = await briefWorld(t);
  postItem(w.state, w.review.id, {
    page_origin: w.oldOrigin, page_path: OLD_PATH, note: "hinted",
    source_hint: { known: true, path: w.oldFile }
  });
  const site = w.move();
  const res = await reviewRead(w, w.review, site.origin);
  assert.equal(res.status, 200, res.text);
  const group = res.json.pages.find((p) => p.path === OLD_PATH);
  assert.equal(group.source_hint.path, fs.realpathSync.native(w.newFile));
});

test("in the symlink case, review.json names the new file, not the link", async (t) => {
  const w = await briefWorld(t);
  postItem(w.state, w.review.id, {
    page_origin: w.oldOrigin, page_path: OLD_PATH, note: "hinted",
    source_hint: { known: true, path: w.oldFile }
  });
  const site = w.move({ symlink: true });
  const res = await reviewRead(w, w.review, site.origin);
  assert.equal(res.status, 200, res.text);
  const group = res.json.pages.find((p) => p.path === OLD_PATH);
  assert.equal(group.source_hint.path, fs.realpathSync.native(w.newFile));
});

test("a newer empty review on the new path loses to the carried review with comments", async (t) => {
  const w = await briefWorld(t);
  // The agent first made a new review on the new path, then carried the old one.
  fs.mkdirSync(path.dirname(w.newFolder), { recursive: true });
  fs.renameSync(w.oldFolder, w.newFolder);
  const site = w.helper.sites.bind({ root: w.newFolder, mode: "folder", entry: "brief.html" });
  const newer = w.helper.reviews.create({ target_path: w.newFile, agent_session_id: w.s1, origins: ["null"] });
  w.helper.reviews.recordPaths(w.review.id, { target_path: w.newFile });
  w.helper.reviews.stampServedByHelper(newer.id, new Date(Date.now() + 60000).toISOString());
  assert.equal(pageRoutes.holderOfFile(w.state, w.newFile).review, w.review.id);
  const page = await getPage(w, site.name, "/brief.html");
  assert.equal(tagReview(page.text), w.review.id);
  // A newer review that holds a comment on the file keeps the page.
  const origin = protocol.siteOrigin(site.name, w.helper.pagesPort);
  postItem(w.state, newer.id, { page_origin: origin, page_path: "/brief.html", note: "said at the new address" });
  assert.equal(pageRoutes.holderOfFile(w.state, w.newFile).review, newer.id);
});

test("a moved Markdown source becomes the review's first source, the old path kept in the list", async (t) => {
  const w = await sitesWorld(t);
  const oldFolder = path.join(w.home, "ws", "projects", "reports", "x");
  const newFolder = path.join(w.home, "ws", "docs", "reports", "x");
  const oldMd = writeFile(oldFolder, "brief.md", "# Brief\n\nThe brief says what we will study.\n");
  const s1 = agentSessions.createStore({ dir: w.state }).create({ name: "Researcher" }).id;
  const review = w.helper.reviews.create({
    target_path: path.join(w.state, "artifact-brief.html"), source_path: oldMd, agent_session_id: s1, origins: ["null"]
  });
  w.helper.sites.bind({ root: path.join(w.home, "ws", "projects"), mode: "folder", entry: "reports/x/brief.md" });
  fs.mkdirSync(path.dirname(newFolder), { recursive: true });
  fs.renameSync(oldFolder, newFolder);
  const newMd = path.join(newFolder, "brief.md");
  // `lahe review` records the path before it binds the site: no site holds the
  // new file yet, so the first source stays.
  let after = w.helper.reviews.recordPaths(review.id, { source_path: newMd });
  assert.equal(after.source_path, oldMd);
  assert.deepEqual(after.source_paths, [oldMd, newMd]);
  // Then the bind: the first source is now its pair.
  const res = await bindRequest(w, { review: review.id, root: newFolder, mode: "folder", entry: "brief.md" });
  assert.equal(res.status, 200, res.text);
  after = w.helper.reviews.get(review.id);
  assert.equal(after.source_path, newMd);
  assert.deepEqual(after.source_paths, [oldMd, newMd]);
});

test("a recorded Markdown source on a served site replaces a gone first source at once", async (t) => {
  const w = await sitesWorld(t);
  const oldFolder = path.join(w.home, "ws", "projects", "reports", "x");
  const newFolder = path.join(w.home, "ws", "docs", "reports", "x");
  const oldMd = writeFile(oldFolder, "brief.md", "# Brief\n");
  const s1 = agentSessions.createStore({ dir: w.state }).create({ name: "Researcher" }).id;
  const review = w.helper.reviews.create({
    target_path: path.join(w.state, "artifact-brief.html"), source_path: oldMd, agent_session_id: s1, origins: ["null"]
  });
  fs.mkdirSync(path.dirname(newFolder), { recursive: true });
  fs.renameSync(oldFolder, newFolder);
  const newMd = path.join(newFolder, "brief.md");
  w.helper.sites.bind({ root: newFolder, mode: "folder", entry: "brief.md" });
  const after = w.helper.reviews.recordPaths(review.id, { source_path: newMd });
  assert.equal(after.source_path, newMd);
  assert.deepEqual(after.source_paths, [oldMd, newMd]);
});

// --- The old address ---------------------------------------------------------------

test("a page load of the old address goes to the new file's address", async (t) => {
  const w = await briefWorld(t);
  const site = w.move();
  const res = await getPage(w, w.oldSite.name, OLD_PATH + "?to=http://evil.example/", NAVIGATE);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, site.origin + "/brief.html");
});

test("the old address of a gone file with no pair keeps the gone page", async (t) => {
  const w = await briefWorld(t);
  w.move({ rename: "brief_v2.html" });
  const res = await getPage(w, w.oldSite.name, OLD_PATH, NAVIGATE);
  assert.equal(res.status, 410);
});

test("a request that is not a page load of a paired page's old address keeps the gone page", async (t) => {
  const w = await briefWorld(t);
  w.move();
  const res = await getPage(w, w.oldSite.name, OLD_PATH);
  assert.equal(res.status, 410);
});

test("the symlink case: a page load of the old address goes to the new one; anything else is the 404 it was", async (t) => {
  const w = await briefWorld(t);
  const site = w.move({ symlink: true });
  const res = await getPage(w, w.oldSite.name, OLD_PATH, NAVIGATE);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, site.origin + "/brief.html");
  const plain = await getPage(w, w.oldSite.name, OLD_PATH);
  assert.equal(plain.status, 404);
});

test("no redirect when the new file's page carries another review", async (t) => {
  const w = await briefWorld(t);
  const site = w.move();
  const newer = w.helper.reviews.create({ target_path: w.newFile, agent_session_id: w.s1, origins: ["null"] });
  w.helper.reviews.stampServedByHelper(newer.id, new Date(Date.now() + 60000).toISOString());
  postItem(w.state, newer.id, { page_origin: site.origin, page_path: "/brief.html", note: "said at the new address" });
  const res = await getPage(w, w.oldSite.name, OLD_PATH, NAVIGATE);
  assert.notEqual(res.status, 302);
});
