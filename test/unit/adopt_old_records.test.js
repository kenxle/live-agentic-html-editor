// V31, option A: a review's old comments show at its page's new address.
//
// The rail is filled from browser storage, and storage belongs to one origin,
// so comments made at a page's old 127.0.0.1:<port> address never reached the
// rail at its stable address. The helper holds them in the review's log. Now:
//
//   - records.read hands a page the helper's records for THAT page: this
//     review only, this page only (its own address, its old origins, and for
//     a Markdown review the rendered file's old path), and never a draft.
//   - store.adopt writes the ones this browser does not hold, as already
//     acknowledged, and never into the outbox, so nothing is posted back.
//
// Each helper test serves from an in-process helper on free ports and a temp
// state folder, closed in teardown.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const stateDir = require("../../src/service/state_dir.js");
const storeModule = require("../../src/layer/store.js");
const { sitesWorld, writeFile, raw, getPage } = require("../helpers/sites_world.js");

const OLD_PORT = 51234;
const PAGE = "<!doctype html><html><head><title>Doc</title></head><body><p>the reviewed paragraph</p></body></html>";
const READ = protocol.route("records.read");

let eventCounter = 0;

function oldServerRecord(state, root, port) {
  const session = "s_before";
  const id = "ss_" + require("node:crypto").createHash("sha256").update(root).digest("hex").slice(0, 16);
  stateDir.ensureStaticServersRoot(state, session);
  fs.writeFileSync(stateDir.staticServerPath(state, session, id), JSON.stringify({
    schema: 1, id, session_id: session, instance: "old", root, logical_root: root, host: "127.0.0.1",
    port, ports: [port], pid: 999999, started_at: "2026-09-01T00:00:00.000Z",
    stopped_at: "2026-09-01T01:00:00.000Z", stop_reason: "session closed", mounts: {}, linked_files: {}
  }));
}

/** An item the reviewer made, appended to the review's log as the helper would. */
function postItem(w, reviewId, fields, draft) {
  const item = record.newItem(Object.assign({
    kind: record.KIND.COMMENT,
    state: draft ? record.STATE.DRAFT : record.STATE.READY,
    page_title: "Doc",
    page_seq: 1
  }, fields));
  eventCounter += 1;
  w.helper.log.append(reviewId, [protocol.newEvent({
    event: draft ? protocol.EVENT.ITEM_CONTENT : protocol.EVENT.ITEM_READY,
    event_id: "ev_adopt_" + eventCounter,
    review: reviewId,
    item: item[record.FIELD.ID],
    rev: item[record.FIELD.REV],
    page_path: item[record.FIELD.PAGE_PATH],
    page_title: item[record.FIELD.PAGE_TITLE],
    page_seq: item[record.FIELD.PAGE_SEQ],
    payload: { draft: !!draft, record: item }
  })]);
  return item;
}

function readRecords(w, review, origin, pagePath) {
  return raw(w.helper.port, {
    path: READ.path + "?review=" + encodeURIComponent(review.id) + "&page_path=" + encodeURIComponent(pagePath),
    headers: {
      host: "127.0.0.1:" + w.helper.port,
      "x-lahe-client": "layer",
      "x-lahe-token": review.token,
      origin
    }
  });
}

async function htmlWorld(t) {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "docs");
  const file = writeFile(folder, "page.html", PAGE);
  writeFile(folder, "other.html", PAGE);
  const real = fs.realpathSync.native(folder);
  const review = w.helper.reviews.create({ target_path: file, agent_session_id: "s1", origins: ["null"] });
  const stranger = w.helper.reviews.create({ target_path: file, agent_session_id: "s2", origins: ["null"] });
  oldServerRecord(w.state, real, OLD_PORT);
  const bound = w.helper.sites.bind({ root: real, mode: "folder", entry: "page.html" });
  const origin = protocol.siteOrigin(bound.name, w.helper.pagesPort);
  const old = "http://127.0.0.1:" + OLD_PORT;
  return Object.assign(w, { folder: real, review, stranger, bound, origin, old });
}

// ---------------------------------------------------------------------------
// The helper half: records.read
// ---------------------------------------------------------------------------

test("records.read hands a page this review's committed records for this page, old address included", async (t) => {
  const w = await htmlWorld(t);
  const atOld = postItem(w, w.review.id, { note: "made at the old address", page_origin: w.old, page_path: "/page.html" });
  const atNew = postItem(w, w.review.id, { note: "made here", page_origin: w.origin, page_path: "/page.html" });
  postItem(w, w.review.id, { note: "a draft never committed", page_origin: w.old, page_path: "/page.html" }, true);
  postItem(w, w.review.id, { note: "another page", page_origin: w.old, page_path: "/other.html" });
  postItem(w, w.review.id, { note: "an unrelated port", page_origin: "http://127.0.0.1:1", page_path: "/page.html" });
  postItem(w, w.stranger.id, { note: "another review", page_origin: w.old, page_path: "/page.html" });

  const res = await readRecords(w, w.review, w.origin, "/page.html");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.records.map((r) => r.id).sort(), [atOld.id, atNew.id].sort());
  const got = res.json.records.find((r) => r.id === atOld.id);
  assert.equal(got.note, "made at the old address");
  assert.ok(got.region && typeof got.region === "object", "the anchor fields a card needs come whole");
  assert.equal(typeof res.json.seq, "number");
});

test("a draft the reviewer withdrew stays out", async (t) => {
  const w = await htmlWorld(t);
  const item = postItem(w, w.review.id, { note: "first words", page_origin: w.old, page_path: "/page.html" });
  // The reviewer starts rewording it: the same item, back to draft.
  const withdrawn = Object.assign({}, item, { state: record.STATE.DRAFT, note: "half typed" });
  eventCounter += 1;
  w.helper.log.append(w.review.id, [protocol.newEvent({
    event: protocol.EVENT.ITEM_CONTENT,
    event_id: "ev_adopt_" + eventCounter,
    review: w.review.id,
    item: item.id,
    rev: item.rev,
    page_path: "/page.html",
    page_title: "Doc",
    page_seq: 1,
    payload: { draft: true, record: withdrawn }
  })]);
  const res = await readRecords(w, w.review, w.origin, "/page.html");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.records.map((r) => r.id), []);
});

test("records.read takes the same token and Origin checks as every review route", async (t) => {
  const w = await htmlWorld(t);
  postItem(w, w.review.id, { note: "x", page_origin: w.old, page_path: "/page.html" });
  // Another review's token for this review's id.
  const swapped = await readRecords(w, { id: w.review.id, token: w.stranger.token }, w.origin, "/page.html");
  assert.equal(swapped.status, protocol.statusFor("PROTO_UNAUTHORIZED"));
  // A page of another site, with this review's token.
  const elsewhere = writeFile(path.join(w.home, "ws", "else", "where"), "x.html", PAGE);
  const other = w.helper.sites.bind({ root: fs.realpathSync.native(path.dirname(elsewhere)), mode: "folder", entry: "x.html" });
  const foreign = await readRecords(w, w.review, protocol.siteOrigin(other.name, w.helper.pagesPort), "/page.html");
  assert.equal(foreign.status, 403);
  // An origin no site and no review holds.
  assert.equal((await readRecords(w, w.review, "http://evil.example", "/page.html")).status, 403);
});

test("a page that is not on a stable address gets nothing from an alias", async (t) => {
  const w = await htmlWorld(t);
  postItem(w, w.review.id, { note: "old", page_origin: w.old, page_path: "/page.html" });
  // Even a record made at that very address: the route serves stable addresses only.
  postItem(w, w.review.id, { note: "at the dev server", page_origin: "http://127.0.0.1:4000", page_path: "/page.html" });
  w.helper.reviews.registerOrigin(w.review.id, "http://127.0.0.1:4000");
  const res = await readRecords(w, w.review, "http://127.0.0.1:4000", "/page.html");
  assert.equal(res.status, 200);
  assert.deepEqual(res.json.records, []);
});

// ---------------------------------------------------------------------------
// The path alias: an old Markdown review's rendered page
// ---------------------------------------------------------------------------

async function markdownWorld(t) {
  const w = await sitesWorld(t);
  const folder = path.join(w.home, "ws", "repo", "notes");
  const source = writeFile(folder, "doc.md", "# The doc\n\nThe reviewed paragraph.\n");
  // What an old `lahe review doc.md` left: the rendered artifact, served by a
  // page server rooted at the review-artifacts folder.
  const artifacts = stateDir.ensureReviewArtifactsRoot(w.state, "s_old");
  const artifact = writeFile(artifacts, "doc-0a1b2c3d.html", "<!doctype html><p>rendered</p>");
  const review = w.helper.reviews.create({ target_path: artifact, source_path: source, agent_session_id: "s_old", origins: ["null"] });
  oldServerRecord(w.state, fs.realpathSync.native(artifacts), OLD_PORT + 1);
  const bound = w.helper.sites.bind({ root: fs.realpathSync.native(folder), mode: "folder", entry: "doc.md" });
  return Object.assign(w, {
    review,
    bound,
    origin: protocol.siteOrigin(bound.name, w.helper.pagesPort),
    old: "http://127.0.0.1:" + (OLD_PORT + 1)
  });
}

test("an old Markdown review's rendered path is a path alias of its source's new address", async (t) => {
  const w = await markdownWorld(t);
  const page = await getPage(w, w.bound.name, "/doc.md");
  assert.equal(page.status, 200);
  const pathAliases = /data-lahe-path-aliases="([^"]*)"/.exec(page.text);
  assert.ok(pathAliases, "the tag carries the old path");
  assert.deepEqual(JSON.parse(pathAliases[1].replace(/&quot;/g, "\"")), ["/doc-0a1b2c3d.html"]);
  const aliases = /data-lahe-aliases="([^"]*)"/.exec(page.text);
  assert.ok(aliases && aliases[1].indexOf(String(OLD_PORT + 1)) !== -1, "and the old server's origin");

  const old = postItem(w, w.review.id, { note: "on the rendered page", page_origin: w.old, page_path: "/doc-0a1b2c3d.html" });
  postItem(w, w.review.id, { note: "another rendered page", page_origin: w.old, page_path: "/other-99.html" });
  const res = await readRecords(w, w.review, w.origin, "/doc.md");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.json.records.map((r) => r.id), [old.id]);
});

test("samePage reads an old path alias only together with an old origin", () => {
  const item = record.newItem({ kind: record.KIND.COMMENT, state: record.STATE.READY, page_origin: "http://127.0.0.1:5001", page_path: "/doc-0a1b2c3d.html" });
  const page = record.pageFrom(
    { origin: "http://repo.notes.lahe.localhost:1483", pathname: "/doc.md", href: "http://repo.notes.lahe.localhost:1483/doc.md" },
    { seq: 1, aliases: ["http://127.0.0.1:5001"], path_aliases: ["/doc-0a1b2c3d.html"] }
  );
  assert.equal(record.samePage(item, page), true);
  const noOrigin = record.pageFrom(
    { origin: "http://repo.notes.lahe.localhost:1483", pathname: "/doc.md", href: "x" },
    { seq: 1, aliases: [], path_aliases: ["/doc-0a1b2c3d.html"] }
  );
  assert.equal(record.samePage(item, noOrigin), false);
  const atSite = Object.assign({}, item, { page_origin: "http://repo.notes.lahe.localhost:1483" });
  assert.equal(record.samePage(atSite, page), false, "the site's own address never takes the old path");
});

// ---------------------------------------------------------------------------
// The browser half: store.adopt
// ---------------------------------------------------------------------------

function memoryBacking() {
  const values = Object.create(null);
  return {
    values,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(values, k) ? values[k] : null),
    setItem: (k, v) => { values[k] = String(v); },
    removeItem: (k) => { delete values[k]; },
    key: (i) => Object.keys(values)[i] || null,
    get length() { return Object.keys(values).length; }
  };
}

function aComment(note, overrides) {
  return record.newItem(Object.assign({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note,
    page_origin: "http://127.0.0.1:" + OLD_PORT,
    page_path: "/page.html"
  }, overrides || {}));
}

test("store.adopt writes what this browser does not hold, as acknowledged, and queues nothing", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const REVIEW = "r_adopt";
  const held = aComment("mine, reworded");
  const heldNewer = record.bumpRev(held, { note: "mine, reworded twice" });
  store.write(REVIEW, heldNewer);
  const helperCopyOfHeld = Object.assign({}, held, { note: "the helper's older words" });
  const fresh = aComment("from the old address");
  const answered = Object.assign(aComment("answered at the old address"), { state: record.STATE.HANDLED });
  const draft = aComment("a draft", { state: record.STATE.DRAFT });

  const adopted = store.adopt(REVIEW, [helperCopyOfHeld, fresh, answered, draft]);

  assert.deepEqual(adopted.map((r) => r.id).sort(), [fresh.id, answered.id].sort());
  const byId = Object.fromEntries(store.read(REVIEW).map((r) => [r.id, r]));
  assert.equal(byId[held.id].note, "mine, reworded twice", "the browser's newer revision stands");
  assert.equal(byId[fresh.id].note, "from the old address");
  assert.equal(byId[answered.id].state, record.STATE.HANDLED, "the helper's lifecycle comes with it");
  assert.equal(byId[draft.id], undefined, "a draft never comes in");
  assert.equal(store.acknowledgedRev(REVIEW, fresh.id), fresh.rev);
  assert.equal(store.pendingCount(REVIEW), 0, "nothing is queued to post back");
});

test("store.adopt leaves out an item this browser has a pending event for, and an item from another review's list", () => {
  const store = storeModule.createStore({ backing: memoryBacking() });
  const REVIEW = "r_adopt2";
  const deleting = aComment("being deleted here");
  store.queueEvent(REVIEW, protocol.newEvent({
    event: protocol.EVENT.ITEM_DELETED,
    event_id: "ev_pending_delete",
    review: REVIEW,
    item: deleting.id,
    rev: deleting.rev
  }));
  const adopted = store.adopt(REVIEW, [deleting]);
  assert.deepEqual(adopted, []);
  assert.equal(store.read(REVIEW).length, 0);
  assert.equal(store.pendingCount(REVIEW), 1, "the pending delete is untouched");
  // Adopting twice is the same as once.
  const once = aComment("once");
  store.adopt(REVIEW, [once]);
  assert.deepEqual(store.adopt(REVIEW, [once]), []);
  assert.equal(store.read(REVIEW).length, 1);
});
