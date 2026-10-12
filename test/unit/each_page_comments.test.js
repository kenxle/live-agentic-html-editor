// Each page carries its own comments (each_page_its_own_comments.md, Parts 2
// and 3), helper side.
//
// Part 2: every address of a file is one page within its review. The tag
// names the file's other addresses this review holds comments under
// (data-lahe-spellings), records.read returns them, and a top-level load of a
// link address to a file with its own review is redirected to its own address.
// Without both Fetch Metadata headers, or with no address of its own, the page
// is served read-only with no rail.
//
// Part 3: comments already split across reviews come back read-only, under
// `others`, never in `records`: from a review that answers on this site (or a
// linking review, on the file's own site) and holds a committed record on this
// file. Each group names a title and an agent, never a review or session id.
//
// Each test serves from an in-process helper on free ports and a temp state
// folder, closed in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const stateDir = require("../../src/service/state_dir.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const { sitesWorld, writeFile, raw, getPage } = require("../helpers/sites_world.js");

const READ = protocol.route("records.read");
const PAGE = "<!doctype html><html><head><title>Doc</title></head><body><p>words</p></body></html>";
const NAVIGATE = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };

let counter = 0;
function postItem(w, reviewId, fields, state) {
  const item = record.newItem(Object.assign({ kind: record.KIND.COMMENT, state: state || record.STATE.READY, page_title: "Doc", page_seq: 1, note: "a comment" }, fields));
  counter += 1;
  w.helper.log.append(reviewId, [protocol.newEvent({
    event: item.state === record.STATE.DRAFT ? protocol.EVENT.ITEM_CONTENT : protocol.EVENT.ITEM_READY,
    event_id: "ev_each_" + counter, review: reviewId, item: item.id, rev: item.rev,
    page_path: item.page_path, page_title: "Doc", page_seq: 1,
    payload: { draft: item.state === record.STATE.DRAFT, record: item }
  })]);
  return item;
}

function readRecords(w, review, origin, pagePath) {
  return raw(w.helper.port, {
    path: READ.path + "?review=" + encodeURIComponent(review.id) + "&page_path=" + encodeURIComponent(pagePath),
    headers: { host: "127.0.0.1:" + w.helper.port, "x-lahe-client": "layer", "x-lahe-token": review.token, origin }
  });
}

function session(w, name) {
  return agentSessions.createStore({ dir: w.state }).create({ name }).id;
}

/** A hub Markdown page linking to far.md in another folder, reviewed, and viewed once. */
async function linkWorld(t) {
  const w = await sitesWorld(t);
  const notes = path.join(w.home, "ws", "repo", "notes");
  const other = path.join(w.home, "ws", "other");
  const far = writeFile(other, "far.md", "# Far\n\nThe far words.\n");
  const hubFile = writeFile(notes, "hub.md", "# Hub\n\n[far](../../other/far.md)\n");
  const s1 = session(w, "Hub agent");
  const hub = w.helper.reviews.create({ target_path: path.join(w.state, "artifact-hub.html"), source_path: hubFile, agent_session_id: s1, origins: ["null"] });
  const hubSite = w.helper.sites.bind({ root: fs.realpathSync.native(notes), mode: "folder", entry: "hub.md" });
  const hubOrigin = protocol.siteOrigin(hubSite.name, w.helper.pagesPort);
  const page = await getPage(w, hubSite.name, "/hub.md");
  const mount = /href="(\/\.lahe-source\/[a-f0-9]+\/)far\.md"/.exec(page.text)[1];
  return Object.assign(w, { notes, other: fs.realpathSync.native(other), far: fs.realpathSync.native(far), s1, hub, hubSite, hubOrigin, mount });
}

// --- Part 2: one review, every address -----------------------------------------

test("a comment made through a link shows at the file's own address, in the same review", async (t) => {
  const w = await linkWorld(t);
  const viaLink = postItem(w, w.hub.id, { page_origin: w.hubOrigin, page_path: w.mount + "far.md", note: "said through the link" });
  // The file gets its own address, in the hub's review (what Part 1 does).
  w.helper.reviews.recordPaths(w.hub.id, { target_path: w.far });
  const own = w.helper.sites.bind({ root: w.other, mode: "folder", entry: "far.md" });
  const ownOrigin = protocol.siteOrigin(own.name, w.helper.pagesPort);
  const page = await getPage(w, own.name, "/far.md");
  assert.match(page.text, new RegExp('data-lahe-review="' + w.hub.id + '"'));
  const spellings = /data-lahe-spellings="([^"]*)"/.exec(page.text);
  assert.ok(spellings, "the tag names the link address");
  assert.deepEqual(JSON.parse(spellings[1].replace(/&quot;/g, "\"")), [w.hubOrigin + " " + w.mount + "far.md"]);
  const res = await readRecords(w, w.hub, ownOrigin, "/far.md");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.records.map((r) => r.id), [viaLink.id]);
  assert.deepEqual(res.json.others, []);
});

test("a top-level load of a link address to a file with its own review and address is redirected there", async (t) => {
  const w = await linkWorld(t);
  const s2 = session(w, "Far agent");
  w.helper.reviews.create({ target_path: w.far, agent_session_id: s2, origins: ["null"] });
  const own = w.helper.sites.bind({ root: w.other, mode: "folder", entry: "far.md" });
  const res = await getPage(w, w.hubSite.name, w.mount + "far.md", NAVIGATE);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, protocol.siteOrigin(own.name, w.helper.pagesPort) + "/far.md");
  assert.equal(res.headers["cache-control"], "no-store");
});

test("without both Fetch Metadata headers it is not redirected: the page is read-only, with no rail", async (t) => {
  const w = await linkWorld(t);
  const s2 = session(w, "Far agent");
  w.helper.reviews.create({ target_path: w.far, agent_session_id: s2, origins: ["null"] });
  w.helper.sites.bind({ root: w.other, mode: "folder", entry: "far.md" });
  for (const headers of [{}, { "sec-fetch-dest": "iframe", "sec-fetch-mode": "navigate" }, { "sec-fetch-dest": "document" }, { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors" }]) {
    const res = await getPage(w, w.hubSite.name, w.mount + "far.md", headers);
    assert.equal(res.status, 200, JSON.stringify(headers));
    assert.doesNotMatch(res.text, /data-lahe-review=/, JSON.stringify(headers));
    assert.match(res.text, /its own review/, JSON.stringify(headers));
  }
});

test("a file with its own review but no address of its own is read-only at a link address, even on a page load", async (t) => {
  const w = await linkWorld(t);
  const s2 = session(w, "Far agent");
  w.helper.reviews.create({ target_path: w.far, agent_session_id: s2, origins: ["null"] });
  const res = await getPage(w, w.hubSite.name, w.mount + "far.md", NAVIGATE);
  assert.equal(res.status, 200);
  assert.doesNotMatch(res.text, /data-lahe-review=/);
});

test("the redirect target comes from the registry, never from the request", async (t) => {
  const w = await linkWorld(t);
  const s2 = session(w, "Far agent");
  w.helper.reviews.create({ target_path: w.far, agent_session_id: s2, origins: ["null"] });
  const own = w.helper.sites.bind({ root: w.other, mode: "folder", entry: "far.md" });
  // Encoded slashes are refused before anything else.
  assert.equal((await getPage(w, w.hubSite.name, w.mount + "..%2ffar.md", NAVIGATE)).status, 404);
  // A query names nothing.
  const res = await getPage(w, w.hubSite.name, w.mount + "far.md?to=http://evil.example/", NAVIGATE);
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, protocol.siteOrigin(own.name, w.helper.pagesPort) + "/far.md");
});

test("two reviews whose old ports and paths collide each get only their own records", async (t) => {
  const w = await sitesWorld(t);
  const a = path.join(w.home, "ws", "a", "site");
  const b = path.join(w.home, "ws", "b", "site");
  writeFile(a, "index.html", PAGE);
  writeFile(b, "index.html", PAGE);
  const realA = fs.realpathSync.native(a);
  const realB = fs.realpathSync.native(b);
  const ra = w.helper.reviews.create({ target_path: path.join(realA, "index.html"), agent_session_id: session(w, "A"), origins: ["null"] });
  const rb = w.helper.reviews.create({ target_path: path.join(realB, "index.html"), agent_session_id: session(w, "B"), origins: ["null"] });
  let n = 0;
  for (const root of [realA, realB]) {
    n += 1;
    stateDir.ensureStaticServersRoot(w.state, "s_before");
    fs.writeFileSync(stateDir.staticServerPath(w.state, "s_before", "ss_old" + n), JSON.stringify({
      schema: 1, id: "ss_old" + n, session_id: "s_before", instance: "x", root, logical_root: root, host: "127.0.0.1",
      port: 5000, ports: [5000], pid: 999999, started_at: "2026-0" + n + "-01T00:00:00.000Z", stopped_at: "2026-0" + n + "-02T00:00:00.000Z", mounts: {}
    }));
  }
  const itemA = postItem(w, ra.id, { page_origin: "http://127.0.0.1:5000", page_path: "/index.html", note: "on A" });
  const itemB = postItem(w, rb.id, { page_origin: "http://127.0.0.1:5000", page_path: "/index.html", note: "on B" });
  const siteA = w.helper.sites.bind({ root: realA, mode: "folder", entry: "index.html" });
  const siteB = w.helper.sites.bind({ root: realB, mode: "folder", entry: "index.html" });
  const resA = await readRecords(w, ra, protocol.siteOrigin(siteA.name, w.helper.pagesPort), "/index.html");
  const resB = await readRecords(w, rb, protocol.siteOrigin(siteB.name, w.helper.pagesPort), "/index.html");
  assert.deepEqual(resA.json.records.map((r) => r.id), [itemA.id]);
  assert.deepEqual(resB.json.records.map((r) => r.id), [itemB.id]);
  assert.deepEqual(resA.json.others, []);
  assert.deepEqual(resB.json.others, []);
  // Each record maps to its own review's file, though the port and path collide.
  const pageRoutes = require("../../src/service/page_routes.js");
  const entry = pageRoutes.registryEntry(w.state);
  assert.equal(pageRoutes.fileOfItem(w.state, entry, rb, itemB), path.join(realB, "index.html"));
  assert.equal(pageRoutes.fileOfItem(w.state, entry, ra, itemA), path.join(realA, "index.html"));
});

// --- Part 3: old splits, read-only ---------------------------------------------

test("comments on this file in another review that answers here come back read-only, named by title and agent only", async (t) => {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "site", "pages");
  writeFile(folder, "index.html", PAGE);
  const page = writeFile(folder, "two.html", PAGE);
  const real = fs.realpathSync.native(folder);
  const folderReview = w.helper.reviews.create({ target_path: real, agent_session_id: session(w, "Folder agent"), origins: ["null"] });
  const site = w.helper.sites.bind({ root: real, mode: "folder", entry: "index.html" });
  const origin = protocol.siteOrigin(site.name, w.helper.pagesPort);
  const old = postItem(w, folderReview.id, { page_origin: origin, page_path: "/two.html", note: "<b>filed</b> in the folder review" });
  postItem(w, folderReview.id, { page_origin: origin, page_path: "/index.html", note: "another page" });
  postItem(w, folderReview.id, { page_origin: origin, page_path: "/two.html", note: "a draft" }, record.STATE.DRAFT);
  // The page later got its own review (before one review per file).
  const own = w.helper.reviews.create({ target_path: fs.realpathSync.native(page), agent_session_id: session(w, "Page agent"), origins: ["null"] });
  const served = await getPage(w, site.name, "/two.html");
  assert.match(served.text, new RegExp('data-lahe-review="' + own.id + '"'));

  const res = await readRecords(w, own, origin, "/two.html");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.records, []);
  assert.equal(res.json.others.length, 1);
  const group = res.json.others[0];
  assert.equal(group.agent, "Folder agent");
  assert.equal(typeof group.title, "string");
  assert.deepEqual(group.records.map((r) => r.id), [old.id]);
  const text = JSON.stringify(group);
  assert.ok(text.indexOf(folderReview.id) === -1, "no review id");
  assert.ok(text.indexOf(folderReview.agent_session_id) === -1, "no session id");
});

test("a review that answers only through a link mount contributes nothing on the linking site", async (t) => {
  const w = await linkWorld(t);
  // A second hub, on another site, that links to far.md too and commented on it.
  const notes2 = path.join(w.home, "ws", "else", "notes");
  const hub2File = writeFile(notes2, "hub2.md", "# Hub two\n\n[far](../../other/far.md)\n");
  const hub2 = w.helper.reviews.create({ target_path: path.join(w.state, "artifact-hub2.html"), source_path: hub2File, agent_session_id: session(w, "Hub two agent"), origins: ["null"] });
  const hub2Site = w.helper.sites.bind({ root: fs.realpathSync.native(notes2), mode: "folder", entry: "hub2.md" });
  const hub2Page = await getPage(w, hub2Site.name, "/hub2.md");
  const mount2 = /href="(\/\.lahe-source\/[a-f0-9]+\/)far\.md"/.exec(hub2Page.text)[1];
  postItem(w, hub2.id, { page_origin: protocol.siteOrigin(hub2Site.name, w.helper.pagesPort), page_path: mount2 + "far.md", note: "hub two on far" });
  // far.md's own review, with a comment at far's own address.
  const s2 = session(w, "Far agent");
  const farReview = w.helper.reviews.create({ target_path: w.far, agent_session_id: s2, origins: ["null"] });
  const own = w.helper.sites.bind({ root: w.other, mode: "folder", entry: "far.md" });
  postItem(w, farReview.id, { page_origin: protocol.siteOrigin(own.name, w.helper.pagesPort), page_path: "/far.md", note: "far's own" });
  // Asked from the hub's site, under the hub's token, for the mounted path.
  const res = await readRecords(w, w.hub, w.hubOrigin, w.mount + "far.md");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.others, [], "far's review does not answer on the hub's site");
});

test("on the file's own site, a linking review that holds a comment on it counts", async (t) => {
  const w = await linkWorld(t);
  const viaLink = postItem(w, w.hub.id, { page_origin: w.hubOrigin, page_path: w.mount + "far.md", note: "said through the link" });
  const s2 = session(w, "Far agent");
  const farReview = w.helper.reviews.create({ target_path: w.far, agent_session_id: s2, origins: ["null"] });
  const own = w.helper.sites.bind({ root: w.other, mode: "folder", entry: "far.md" });
  const res = await readRecords(w, farReview, protocol.siteOrigin(own.name, w.helper.pagesPort), "/far.md");
  assert.equal(res.status, 200);
  assert.equal(res.json.others.length, 1);
  assert.equal(res.json.others[0].agent, "Hub agent");
  assert.deepEqual(res.json.others[0].records.map((r) => r.id), [viaLink.id]);
});

test("a retired review's comments are not shown, and an event under one review's token never touches another's log", async (t) => {
  const w = await linkWorld(t);
  postItem(w, w.hub.id, { page_origin: w.hubOrigin, page_path: w.mount + "far.md", note: "x" });
  const s2 = session(w, "Far agent");
  const farReview = w.helper.reviews.create({ target_path: w.far, agent_session_id: s2, origins: ["null"] });
  const own = w.helper.sites.bind({ root: w.other, mode: "folder", entry: "far.md" });
  const hubLogBefore = fs.readFileSync(path.join(w.state, "reviews", w.hub.id, "events.jsonl"), "utf8");
  // An item under far's token reusing a hub item id lands in far's log only.
  const hubItem = w.helper.log.read(w.hub.id).find((e) => e.item).item;
  const copy = record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, note: "copy", page_origin: "null", page_path: "/far.md" });
  copy.id = hubItem;
  const post = await raw(w.helper.port, {
    method: "POST",
    path: protocol.route("events.append").path,
    headers: { host: "127.0.0.1:" + w.helper.port, "content-type": "application/json", "x-lahe-client": "layer", "x-lahe-token": farReview.token, origin: "null" },
    body: { review: farReview.id, events: [protocol.newEvent({ event: protocol.EVENT.ITEM_READY, event_id: "ev_copy", review: farReview.id, item: copy.id, rev: copy.rev, page_path: "/far.md", payload: { draft: false, record: copy } })] }
  });
  assert.equal(post.status, 200);
  assert.equal(fs.readFileSync(path.join(w.state, "reviews", w.hub.id, "events.jsonl"), "utf8"), hubLogBefore);
  w.helper.reviews.retire(w.hub.id);
  const res = await readRecords(w, farReview, protocol.siteOrigin(own.name, w.helper.pagesPort), "/far.md");
  assert.deepEqual(res.json.others, []);
});
