// The Library with stable addresses on (stable addresses, Task 4.1, rows V39
// to V42).
//
// Every test runs a helper in this process with the pages switch on, on free
// ports and a temp state folder, and talks to the Library the way its page
// does: over HTTP, at library.lahe.localhost, with the Library token. Reviews
// are made straight on the helper's registry. Teardown closes the helper
// through t.after even when a test fails.

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const protocol = require("../../src/shared/protocol.js");
const agentSessions = require("../../src/service/agent_sessions.js");
const catalogRequests = require("../../src/service/catalog_requests.js");
const stateDirModule = require("../../src/service/state_dir.js");
const staticServers = require("../../src/service/static_servers.js");
const markdown = require("../../src/service/markdown.js");
const { writeOldServerRecord } = require("../helpers/old_server_record.js");
const { sitesWorld, raw, writeFile, getPage } = require("../helpers/sites_world.js");

const PAGE_HTML = "<!doctype html><html><head><title>A page</title></head><body><p>words</p></body></html>";

function tokenFromPage(html) {
  const m = new RegExp('<meta name="' + protocol.CATALOG_TOKEN_META + '" content="([^"]*)"').exec(html);
  return m ? m[1] : null;
}

/** A Library client at library.lahe.localhost, like the page. */
async function libraryOf(w) {
  const port = w.helper.pagesPort;
  const host = "library.lahe.localhost:" + port;
  const page = await raw(port, { path: protocol.route("catalog.page").path, headers: { host, "sec-fetch-site": "none" } });
  assert.equal(page.status, 200);
  const token = tokenFromPage(page.text);
  const call = (name, body) => {
    const r = protocol.route(name);
    return raw(port, {
      method: r.method,
      path: r.path,
      headers: {
        host,
        "sec-fetch-site": "same-origin",
        [protocol.HEADER.CLIENT]: protocol.CLIENT_CATALOG,
        [protocol.HEADER.TOKEN]: token,
        "content-type": protocol.JSON_CONTENT_TYPE,
        origin: "http://" + host
      },
      body: r.method === "POST" ? JSON.stringify(body || {}) : undefined
    });
  };
  return {
    list: async () => {
      const res = await call("catalog.list");
      assert.equal(res.status, 200, res.text);
      return res.json;
    },
    row: async (id) => {
      const list = await (async () => (await call("catalog.list")).json)();
      for (const s of list.sessions) for (const r of s.reviews) if (r.id === id) return r;
      return null;
    },
    open: (review, extra) => call("catalog.open", Object.assign({ review, handoff: false, confirmed: false }, extra || {})),
    request: (review, action, extra) => call("catalog.request", Object.assign({ review, action }, extra || {}))
  };
}

function sessions(w) {
  return agentSessions.createStore({ dir: w.state });
}

function openSession(w, id) {
  sessions(w).create({ id, name: "session " + id });
  return id;
}

function makeReview(w, spec) {
  return w.helper.reviews.create(Object.assign({ origins: ["null"] }, spec));
}

/** A folder of docs under the world's fake home, so a name is short and readable. */
function docs(w, rel) {
  return path.join(w.home, "ws", "repo", rel || "docs");
}

function oldServer(w, session, root, mounts) {
  writeOldServerRecord(w.state, session, root, { mounts });
}

/** The rendered copy of a Markdown source, which only the CLI writes into the state folder. */
function renderedCopy(w, session, source) {
  return writeFile(path.dirname(markdown.artifactPath(w.state, session, source)), path.basename(markdown.artifactPath(w.state, session, source)), PAGE_HTML);
}

// --- V41: the kinds ------------------------------------------------------------

test("V41: a page on disk is openable, and its row gets an address once its site is named", async (t) => {
  const w = await sitesWorld(t);
  const folder = docs(w);
  const file = writeFile(folder, "page.html", PAGE_HTML);
  openSession(w, "s_a");
  oldServer(w, "s_a", fs.realpathSync(folder));
  const review = makeReview(w, { agent_session_id: "s_a", target_path: file });
  const lib = await libraryOf(w);

  const before = await lib.row(review.id);
  assert.equal(before.kind, "static");
  assert.equal(before.openable, "yes");
  assert.equal(before.served_url, null, "no name yet, so no address, and a GET names nothing");
  assert.equal(before.address, null);
  assert.equal(w.helper.sites.list().length, 0, "listing minted no name");

  const bound = w.helper.sites.bind({ root: folder, mode: "folder", entry: "page.html" });
  const after = await lib.row(review.id);
  const address = "http://" + bound.name + ".lahe.localhost:" + w.helper.pagesPort + "/page.html";
  assert.equal(after.address, address);
  assert.equal(after.served_url, address);
});

test("V41: a Markdown review opens its source folder, a notes review its one page, a folder review a page in it", async (t) => {
  const w = await sitesWorld(t);
  const md = writeFile(docs(w, "notes"), "plan.md", "# Plan\n");
  const note = writeFile(docs(w, "journal"), "today.md", "# Today\n");
  const site = docs(w, "site");
  writeFile(site, "index.html", PAGE_HTML);
  writeFile(site, "b.html", PAGE_HTML);
  openSession(w, "s_a");
  oldServer(w, "s_a", fs.realpathSync(site));
  const mdReview = makeReview(w, { agent_session_id: "s_a", target_path: renderedCopy(w, "s_a", md), source_path: md });
  const noteReview = makeReview(w, { agent_session_id: "s_a", target_path: renderedCopy(w, "s_a", note), source_path: note, notes: true });
  const folderReview = makeReview(w, { agent_session_id: "s_a", target_path: site });
  const lib = await libraryOf(w);

  for (const r of [mdReview, noteReview, folderReview]) {
    const row = await lib.row(r.id);
    assert.equal(row.kind, "static", r.id);
    assert.equal(row.openable, "yes", r.id);
  }
  const mdOpen = (await lib.open(mdReview.id)).json.url;
  assert.match(mdOpen, /^http:\/\/[a-z0-9.-]+\.lahe\.localhost:\d+\/plan\.md$/);
  const noteOpen = (await lib.open(noteReview.id)).json.url;
  assert.match(noteOpen, /\/today\.md$/);
  assert.equal(w.helper.sites.byRoot(fs.realpathSync(note), "page-only").site.mode, "page-only");
  const folderOpen = (await lib.open(folderReview.id)).json.url;
  assert.match(folderOpen, /\/index\.html$/, "the folder's entry page");
  assert.equal(w.helper.sites.byRoot(fs.realpathSync(site), "folder").site.entry, "index.html");
});

test("V41: a dev-server review and a file Lahe cannot serve are via-agent; a script-line review is legacy", async (t) => {
  const w = await sitesWorld(t);
  const app = docs(w, "app");
  fs.mkdirSync(app, { recursive: true });
  const text = writeFile(docs(w, "misc"), "data.txt", "not a page");
  const page = writeFile(docs(w, "old"), "old.html", PAGE_HTML);
  openSession(w, "s_a");
  const dev = makeReview(w, { agent_session_id: "s_a", target_path: app, origins: ["http://localhost:5173"] });
  const txt = makeReview(w, { agent_session_id: "s_a", target_path: text });
  const legacy = makeReview(w, { target_path: page });
  const lib = await libraryOf(w);

  const devRow = await lib.row(dev.id);
  assert.equal(devRow.kind, "dev-server");
  assert.equal(devRow.openable, "via-agent");
  const txtRow = await lib.row(txt.id);
  assert.equal(txtRow.kind, "static");
  assert.equal(txtRow.openable, "via-agent");
  const legacyRow = await lib.row(legacy.id);
  assert.equal(legacyRow.kind, "legacy");
  assert.equal(legacyRow.openable, "via-agent");
  for (const r of [dev, txt, legacy]) {
    const res = await lib.open(r.id);
    assert.equal(res.status, 409, "Open of a via-agent row with no hand-over asks the agent, it opens nothing: " + res.text);
    assert.equal(res.json.error.code, "PROTO_NOT_OPENABLE");
  }
  assert.equal(w.helper.sites.list().length, 0, "none of them was named");
});

test("V41: a gone file is missing", async (t) => {
  const w = await sitesWorld(t);
  const folder = docs(w);
  const file = path.join(folder, "never.html");
  openSession(w, "s_a");
  const review = makeReview(w, { agent_session_id: "s_a", target_path: file });
  const lib = await libraryOf(w);
  assert.equal((await lib.row(review.id)).openable, "missing");
  assert.equal((await lib.open(review.id)).json.error.code, "PROTO_NOT_OPENABLE");
});

/** A main checkout and a worktree of it, one page in each, and a review bound in the worktree. */
function worktreeWorld(w) {
  const main = path.join(w.home, "ws", "main-repo");
  fs.mkdirSync(path.join(main, ".git", "worktrees", "wt1"), { recursive: true });
  const wt = path.join(w.home, "ws", "wt1");
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(wt, ".git"), "gitdir: " + path.join(main, ".git", "worktrees", "wt1") + "\n");
  // git's back-link, which the registry checks before it trusts the .git file.
  fs.writeFileSync(path.join(main, ".git", "worktrees", "wt1", "gitdir"), path.join(wt, ".git") + "\n");
  const copy = writeFile(main, "docs/page.html", "<!doctype html><title>main copy</title><p>main copy</p>");
  const file = writeFile(wt, "docs/page.html", PAGE_HTML);
  return { main, wt, copy, file, folder: path.join(wt, "docs") };
}

test("V41, spec 20261015.01 R12: a gone worktree whose site recorded its main checkout is a moved static row; Open gives the main copy its address and the review's rail", async (t) => {
  const w = await sitesWorld(t);
  const tree = worktreeWorld(w);
  openSession(w, "s_a");
  const review = makeReview(w, { agent_session_id: "s_a", target_path: tree.file });
  const bound = w.helper.sites.bind({ root: fs.realpathSync(tree.folder), mode: "folder", entry: "page.html" });
  fs.renameSync(tree.wt, tree.wt + "-moved");
  await new Promise((resolve) => setImmediate(resolve));
  const lib = await libraryOf(w);

  const row = await lib.row(review.id);
  assert.equal(row.kind, "static");
  assert.equal(row.openable, "yes");
  assert.equal(row.moved, true);
  const opened = await lib.open(review.id);
  assert.equal(opened.status, 200, opened.text);
  const url = new URL(opened.json.url);
  assert.notEqual(url.hostname, bound.name + ".lahe.localhost", "the main copy's own address, not the worktree's");
  assert.equal(url.pathname, "/page.html");
  const realCopy = fs.realpathSync(tree.copy);
  assert.equal(w.helper.reviews.get(review.id).target_path, realCopy, "Open records the main path");
  const page = await getPage(w, url.hostname.replace(/\.lahe\.localhost$/, ""), "/page.html");
  assert.equal(page.status, 200);
  assert.match(page.text, /main copy/);
  assert.match(page.text, new RegExp('data-lahe-review="' + review.id + '"'));
  // The old address now sends a page load to the main copy.
  const old = await getPage(w, bound.name, "/page.html", { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" });
  assert.equal(old.status, 302);
  assert.equal(old.headers.location, opened.json.url);
});

test("spec 20261015.01 R12: a moved review and a review made on the main copy in one session show as one row", async (t) => {
  const w = await sitesWorld(t);
  const tree = worktreeWorld(w);
  openSession(w, "s_a");
  const old = makeReview(w, { agent_session_id: "s_a", target_path: tree.file });
  w.helper.sites.bind({ root: fs.realpathSync(tree.folder), mode: "folder", entry: "page.html" });
  fs.renameSync(tree.wt, tree.wt + "-moved");
  await new Promise((resolve) => setImmediate(resolve));
  const fresh = makeReview(w, { agent_session_id: "s_a", target_path: fs.realpathSync(tree.copy) });
  const lib = await libraryOf(w);
  const list = await lib.list();
  // Every row object anywhere in the answer (sections nest them).
  const rowsOf = (l) => {
    const out = [];
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk);
      if (v && typeof v === "object") {
        if (typeof v.id === "string" && Array.isArray(v.folded_from)) out.push(v);
        Object.values(v).forEach(walk);
      }
    };
    walk(l);
    return out;
  };
  const rows = rowsOf(list).filter((r) => r.id === old.id || r.id === fresh.id || r.folded_from.indexOf(old.id) !== -1 || r.folded_from.indexOf(fresh.id) !== -1);
  const ids = new Set(rows.map((r) => r.id));
  assert.equal(ids.size, 1, "one row for the document");
  const row = rows[0];
  assert.deepEqual([row.id].concat(row.folded_from).sort(), [old.id, fresh.id].sort());
});

test("spec 20261015.01 R12: a moved row's launch hand-off is a takeover with no path in it", async (t) => {
  const w = await sitesWorld(t);
  const tree = worktreeWorld(w);
  openSession(w, "s_a");
  const review = makeReview(w, { agent_session_id: "s_a", target_path: tree.file });
  w.helper.sites.bind({ root: fs.realpathSync(tree.folder), mode: "folder", entry: "page.html" });
  fs.renameSync(tree.wt, tree.wt + "-moved");
  await new Promise((resolve) => setImmediate(resolve));
  const described = require("../../src/service/catalog_reader.js").createReader({ dir: w.state }).describeReview(review.id);
  assert.equal(described.kind, "static");
  assert.equal(described.site.moved, true);
  const text = require("../../src/service/catalog_launch.js").handoffFor(w.state, described, { id: "q_test", session: "s_a" }, null);
  assert.ok(text, "a hand-off message");
  assert.match(text, /takeover s_a/);
  assert.equal(text.indexOf(tree.wt), -1, "no worktree path");
  assert.equal(text.indexOf(tree.main), -1, "no main checkout path");
  assert.equal(require("../../src/service/catalog_launch.js").launchRoot(described), path.dirname(fs.realpathSync(tree.copy)));
});

test("spec 20261015.01 R12: a hand-over refused for no agent, or held for a confirm, gives the moved document no address and records nothing", async (t) => {
  const w = await sitesWorld(t);
  const tree = worktreeWorld(w);
  const store = sessions(w);
  openSession(w, "s_a");
  const review = makeReview(w, { agent_session_id: "s_a", target_path: tree.file });
  w.helper.sites.bind({ root: fs.realpathSync(tree.folder), mode: "folder", entry: "page.html" });
  fs.renameSync(tree.wt, tree.wt + "-moved");
  await new Promise((resolve) => setImmediate(resolve));
  const lib = await libraryOf(w);
  const sitesBefore = w.helper.sites.list().length;
  const metaBefore = JSON.stringify(w.helper.reviews.get(review.id));

  // No agent attached: refused, nothing named or recorded.
  const noAgent = await lib.request(review.id, "pickup");
  assert.equal(noAgent.json.error && noAgent.json.error.code, "PROTO_NO_AGENT", noAgent.text);
  assert.equal(w.helper.sites.list().length, sitesBefore, "no site named");
  assert.equal(JSON.stringify(w.helper.reviews.get(review.id)), metaBefore, "nothing stamped or recorded");

  // An attached agent, and another agent watching the document's session: the
  // page asks first. Cancelling that confirm leaves everything as it was.
  const now = Date.now();
  store.create({ id: "s_agent", name: "library agent" });
  catalogRequests.writeAttach(w.state, "s_agent", now);
  store.writeMonitor("s_agent", { pid: process.pid, handoff_rev: agentSessions.handoffRev(store.read("s_agent")), at: new Date(now).toISOString(), primary: true });
  store.writeMonitor("s_a", { pid: process.pid, handoff_rev: agentSessions.handoffRev(store.read("s_a")), at: new Date(now).toISOString(), primary: true });
  const held = await lib.request(review.id, "pickup");
  assert.equal(held.json.error && held.json.error.code, "PROTO_CONFIRM_NEEDED", held.text);
  assert.equal(w.helper.sites.list().length, sitesBefore, "no site named");
  assert.equal(JSON.stringify(w.helper.reviews.get(review.id)), metaBefore, "nothing stamped or recorded");

  // Confirmed: the main copy gets its address and the review records it.
  const confirmed = await lib.request(review.id, "pickup", { confirmed: true });
  assert.equal(confirmed.status, 200, confirmed.text);
  assert.equal(w.helper.sites.list().length, sitesBefore + 1, "the main copy's site");
  assert.equal(w.helper.reviews.get(review.id).target_path, fs.realpathSync(tree.copy));
});

test("V41, spec 20261015.01 R13: a forged path outside every registry site is not vouched, though the copy exists", async (t) => {
  const w = await sitesWorld(t);
  const tree = worktreeWorld(w);
  openSession(w, "s_a");
  // A page holding the token can write any path into meta.json: one in the
  // worktree, but under no site the helper served.
  const forged = path.join(tree.wt, "other", "page.html");
  writeFile(tree.main, "other/page.html", PAGE_HTML);
  const review = makeReview(w, { agent_session_id: "s_a", target_path: forged });
  w.helper.sites.bind({ root: fs.realpathSync(tree.folder), mode: "folder", entry: "page.html" });
  fs.renameSync(tree.wt, tree.wt + "-moved");
  await new Promise((resolve) => setImmediate(resolve));
  const lib = await libraryOf(w);
  const row = await lib.row(review.id);
  assert.notEqual(row.moved, true);
  assert.notEqual(row.openable, "yes");
});

test("V41: a gone worktree the registry never saw keeps the old rule: a worktree row that needs an agent, or missing", async (t) => {
  const w = await sitesWorld(t);
  const repo = path.join(w.home, "ws", "repo2");
  writeFile(repo, "docs/page.html", PAGE_HTML);
  const wtRoot = path.join(repo, ".claude", "worktrees", "wt9");
  const gone = path.join(wtRoot, "docs", "page.html");
  openSession(w, "s_a");
  const review = makeReview(w, { agent_session_id: "s_a", target_path: gone });
  const lib = await libraryOf(w);
  assert.equal((await lib.row(review.id)).openable, "missing", "no site and no old server record: nothing vouches for the path");

  // An old page server's record, which a page cannot write, vouches for it.
  const recordDir = stateDirModule.staticServersRoot(w.state, "s_a");
  fs.mkdirSync(recordDir, { recursive: true });
  fs.writeFileSync(path.join(recordDir, "ss_old.json"), JSON.stringify({
    schema: staticServers.SCHEMA, id: "ss_old", session_id: "s_a", root: wtRoot, port: 1, host: "127.0.0.1",
    started_at: "2026-10-01T00:00:00.000Z", stopped_at: "2026-10-02T00:00:00.000Z"
  }));
  const row = await lib.row(review.id);
  assert.equal(row.kind, "worktree");
  assert.equal(row.openable, "via-agent");
  assert.equal((await lib.open(review.id)).json.error.code, "PROTO_NOT_OPENABLE");
});

// --- Same file, same address ----------------------------------------------------

test("a file under a registered folder site, opened from the Library, gets that site's address, and no second site is named", async (t) => {
  const w = await sitesWorld(t);
  const outer = docs(w, "outer");
  writeFile(outer, "index.html", PAGE_HTML);
  const file = writeFile(path.join(outer, "sub"), "p.html", PAGE_HTML);
  const bound = w.helper.sites.bind({ root: fs.realpathSync(outer), mode: "folder", entry: "index.html" });
  const address = "http://" + bound.name + ".lahe.localhost:" + w.helper.pagesPort + "/sub/p.html";
  openSession(w, "s_a");
  const review = makeReview(w, { agent_session_id: "s_a", target_path: file });
  const lib = await libraryOf(w);
  assert.equal((await lib.row(review.id)).address, address, "the row already shows the folder site's address");
  const res = await lib.open(review.id);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.url, address);
  assert.equal(w.helper.sites.list().length, 1, "no second site for the same file");
  assert.equal(w.helper.sites.list()[0].site.entry, "index.html", "the folder site's own landing page is unchanged");
  assert.match((await getPage(w, bound.name, "/sub/p.html")).text, new RegExp('data-lahe-review="' + review.id + '"'));
});

test("a file whose own folder already has a site keeps that address after the outer folder is named", async (t) => {
  const w = await sitesWorld(t);
  const outer = docs(w, "outer");
  writeFile(outer, "index.html", PAGE_HTML);
  const file = writeFile(path.join(outer, "sub"), "p.html", PAGE_HTML);
  const inner = w.helper.sites.bind({ root: fs.realpathSync(path.join(outer, "sub")), mode: "folder", entry: "p.html", containing: true });
  w.helper.sites.bind({ root: fs.realpathSync(outer), mode: "folder", entry: "index.html" });
  openSession(w, "s_a");
  const review = makeReview(w, { agent_session_id: "s_a", target_path: file });
  const lib = await libraryOf(w);
  const res = await lib.open(review.id);
  assert.equal(res.json.url, "http://" + inner.name + ".lahe.localhost:" + w.helper.pagesPort + "/p.html");
  assert.equal(w.helper.sites.list().length, 2);
});

test("a folder review is never folded into an outer site: it names its own folder", async (t) => {
  const w = await sitesWorld(t);
  const outer = docs(w, "outer");
  writeFile(outer, "index.html", PAGE_HTML);
  const inner = path.join(outer, "sub");
  writeFile(inner, "index.html", PAGE_HTML);
  w.helper.sites.bind({ root: fs.realpathSync(outer), mode: "folder", entry: "index.html" });
  openSession(w, "s_a");
  const review = makeReview(w, { agent_session_id: "s_a", target_path: inner });
  const lib = await libraryOf(w);
  const res = await lib.open(review.id);
  assert.equal(res.status, 200, res.text);
  assert.equal(w.helper.sites.list().length, 2);
  assert.equal(w.helper.sites.byRoot(fs.realpathSync(inner), "folder").site.entry, "index.html");
});

// --- One review per file ---------------------------------------------------------

test("Open of a file inside an already reviewed folder goes to that folder's address, not a new folder of its own, and makes no review", async (t) => {
  const w = await sitesWorld(t);
  const outer = docs(w, "outer");
  writeFile(outer, "index.html", PAGE_HTML);
  const file = writeFile(path.join(outer, "sub"), "p.html", PAGE_HTML);
  openSession(w, "s_folder");
  openSession(w, "s_file");
  // The folder is reviewed: a review, and the site `lahe review` named for it.
  const folder = makeReview(w, { id: "r-folder", agent_session_id: "s_folder", target_path: outer });
  const site = w.helper.sites.bind({ root: fs.realpathSync(outer), mode: "folder", entry: "index.html" });
  // A later review of one file in it, from another session.
  const own = makeReview(w, { id: "r-file", agent_session_id: "s_file", target_path: file });
  const lib = await libraryOf(w);
  const address = "http://" + site.name + ".lahe.localhost:" + w.helper.pagesPort + "/sub/p.html";
  assert.equal((await lib.row(own.id)).address, address, "the row shows the folder's address");
  const res = await lib.open(own.id);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.json.url, address);
  assert.equal(w.helper.sites.list().length, 1, "no site of the file's own folder");
  assert.deepEqual(w.helper.reviews.list().sort(), [folder.id, own.id].sort(), "Open made no review");
  assert.match((await getPage(w, site.name, "/sub/p.html")).text, new RegExp('data-lahe-review="' + own.id + '"'), "the file's own review answers there");
});

test("Open of a file whose review is in a closed session, or the row's own session, still goes to that review's page and stamps nothing", async (t) => {
  const w = await sitesWorld(t, AHEAD);
  openSession(w, "s_old");
  openSession(w, "s_new");
  const { older, newer, name } = twoReviews(w, "s_new", "s_old");
  sessions(w).close("s_new");
  const lib = await libraryOf(w);
  const closedHolder = await lib.open(older.id);
  assert.equal(closedHolder.json.held_by.review, newer.id, "a file has one review, whichever session is open");
  assert.equal(w.helper.reviews.get(older.id).served_at || null, null);
  assert.match((await getPage(w, name, "/page.html")).text, new RegExp('data-lahe-review="' + newer.id + '"'));
});

test("Open of a retired review's file: the address opens, no review is stamped or made, and the row says it is retired", async (t) => {
  const w = await sitesWorld(t, AHEAD);
  const file = writeFile(docs(w), "page.html", PAGE_HTML);
  openSession(w, "s_a");
  oldServer(w, "s_a", fs.realpathSync(docs(w)));
  const review = makeReview(w, { agent_session_id: "s_a", target_path: file });
  w.helper.reviews.retire(review.id);
  const lib = await libraryOf(w);
  assert.equal((await lib.row(review.id)).retired, true);
  const res = await lib.open(review.id);
  assert.equal(res.status, 200, res.text);
  const site = w.helper.sites.byRoot(fs.realpathSync(docs(w)), "folder");
  assert.equal(res.json.url, "http://" + site.name + ".lahe.localhost:" + w.helper.pagesPort + "/page.html");
  assert.equal(res.json.retired, true);
  assert.equal(res.json.held_by, null);
  assert.equal(w.helper.reviews.get(review.id).served_at || null, null, "a retired review is never stamped");
  assert.equal(w.helper.reviews.list().length, 1, "no second review");
  assert.doesNotMatch((await getPage(w, site.name, "/page.html")).text, /data-lahe-review/, "the page is read-only: nothing answers");
});

test("a retired review is skipped: it never holds the file, so a live review of the same file opens and answers", async (t) => {
  const w = await sitesWorld(t, AHEAD);
  const file = writeFile(docs(w), "page.html", PAGE_HTML);
  openSession(w, "s_a");
  openSession(w, "s_b");
  oldServer(w, "s_a", fs.realpathSync(docs(w)));
  const gone = makeReview(w, { id: "r-b-retired", agent_session_id: "s_b", target_path: file });
  const live = makeReview(w, { id: "r-a-live", agent_session_id: "s_a", target_path: file });
  w.helper.reviews.retire(gone.id);
  const lib = await libraryOf(w);
  const res = await lib.open(live.id);
  assert.equal(res.json.held_by, null);
  assert.equal(res.json.retired, false);
  const site = w.helper.sites.list()[0];
  assert.match((await getPage(w, site.name, "/page.html")).text, new RegExp('data-lahe-review="' + live.id + '"'));
});

// --- Open serves nothing new ---------------------------------------------------

test("a review of a site the CLI bound is openable with no old server record", async (t) => {
  const w = await sitesWorld(t);
  const folder = docs(w);
  const file = writeFile(folder, "page.html", PAGE_HTML);
  const bound = w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "page.html" });
  openSession(w, "s_a");
  const review = makeReview(w, { agent_session_id: "s_a", target_path: file });
  const lib = await libraryOf(w);
  assert.equal((await lib.row(review.id)).openable, "yes");
  assert.equal((await lib.open(review.id)).json.url, "http://" + bound.name + ".lahe.localhost:" + w.helper.pagesPort + "/page.html");
});

test("Open serves nothing new: a path a page wrote into its review, that nothing ever served, is not openable and names nothing", async (t) => {
  const w = await sitesWorld(t);
  // A folder with a page in it that no CLI, page server or registry ever served.
  const secret = path.join(w.home, ".ssh-like", "keys");
  const page = writeFile(secret, "innocent.html", PAGE_HTML);
  const md = writeFile(path.join(w.home, "private"), "diary.md", "# Diary\n");
  const notes = writeFile(path.join(w.home, "private"), "journal.md", "# Journal\n");
  const folder = path.join(w.home, "private-folder");
  writeFile(folder, "index.html", PAGE_HTML);
  openSession(w, "s_a");
  const reviews = [
    makeReview(w, { agent_session_id: "s_a", target_path: page }),
    makeReview(w, { agent_session_id: "s_a", target_path: writeFile(w.state, "fake/diary.html", PAGE_HTML), source_path: md }),
    makeReview(w, { agent_session_id: "s_a", target_path: writeFile(w.state, "fake/diary2.html", PAGE_HTML), source_path: notes, notes: true }),
    makeReview(w, { agent_session_id: "s_a", target_path: folder })
  ];
  const lib = await libraryOf(w);
  for (const r of reviews) {
    const row = await lib.row(r.id);
    assert.equal(row.openable, "via-agent", r.id);
    assert.equal(row.address, null, r.id);
    const res = await lib.open(r.id);
    assert.equal(res.json.error && res.json.error.code, "PROTO_NOT_OPENABLE", r.id + ": " + res.text);
    assert.equal(w.helper.reviews.get(r.id).served_at || null, null, r.id);
  }
  assert.equal(w.helper.sites.list().length, 0, "no site was named for any of them");
});

test("a root nested inside a folder an old page server served is vouched for", async (t) => {
  const w = await sitesWorld(t);
  const outer = docs(w, "outer");
  const file = writeFile(path.join(outer, "inner"), "page.html", PAGE_HTML);
  openSession(w, "s_a");
  oldServer(w, "s_a", fs.realpathSync(outer));
  const review = makeReview(w, { agent_session_id: "s_a", target_path: file });
  const lib = await libraryOf(w);
  assert.equal((await lib.row(review.id)).openable, "yes");
});

// --- V39: Open binds ------------------------------------------------------------

test("V39: Open on an old row names its site, stamps the review, and returns the stable address", async (t) => {
  const w = await sitesWorld(t);
  const folder = docs(w);
  const file = writeFile(folder, "page.html", PAGE_HTML);
  openSession(w, "s_a");
  oldServer(w, "s_a", fs.realpathSync(folder));
  const review = makeReview(w, {
    agent_session_id: "s_a",
    target_path: file,
    origins: ["null", "http://127.0.0.1:51234", "http://localhost:51234"]
  });
  const lib = await libraryOf(w);

  const res = await lib.open(review.id);
  assert.equal(res.status, 200, res.text);
  const found = w.helper.sites.byRoot(fs.realpathSync(folder), "folder");
  assert.ok(found, "the site exists now");
  const address = "http://" + found.name + ".lahe.localhost:" + w.helper.pagesPort + "/page.html";
  assert.equal(res.json.url, address);
  assert.equal(res.json.held_by, null);
  assert.ok(w.helper.reviews.get(review.id).served_at, "the review is stamped as re-served");
  assert.deepEqual(w.helper.reviews.get(review.id).origins.filter((o) => /127\.0\.0\.1|localhost:/.test(o)), [], "its old page-server origins are gone");

  const page = await getPage(w, found.name, "/page.html");
  assert.equal(page.status, 200);
  assert.match(page.text, new RegExp('data-lahe-review="' + review.id + '"'), "the page loads with this review's rail");

  const again = await lib.open(review.id);
  assert.equal(again.json.url, address, "the same row opens at the same address");
  assert.equal(w.helper.sites.list().length, 1);
});

test("V39: Open keeps the site's entry page when it is opened from another file in the same folder", async (t) => {
  const w = await sitesWorld(t);
  const folder = docs(w);
  writeFile(folder, "index.html", PAGE_HTML);
  const other = writeFile(folder, "other.html", PAGE_HTML);
  w.helper.sites.bind({ root: fs.realpathSync(folder), mode: "folder", entry: "index.html" });
  openSession(w, "s_a");
  const review = makeReview(w, { agent_session_id: "s_a", target_path: other });
  const lib = await libraryOf(w);
  const res = await lib.open(review.id);
  assert.match(res.json.url, /\/other\.html$/);
  assert.equal(w.helper.sites.list()[0].site.entry, "index.html", "Open never rewrites the entry `lahe review` printed");
});

test("V39: a hand-over still goes to the attached agent, after the address is made", async (t) => {
  const w = await sitesWorld(t);
  const file = writeFile(docs(w), "page.html", PAGE_HTML);
  openSession(w, "s_a");
  oldServer(w, "s_a", fs.realpathSync(docs(w)));
  const store = sessions(w);
  store.create({ id: "s_agent", name: "library agent" });
  const review = makeReview(w, { agent_session_id: "s_a", target_path: file });
  const now = Date.now();
  catalogRequests.writeAttach(w.state, "s_agent", now);
  store.writeMonitor("s_agent", {
    pid: process.pid,
    handoff_rev: agentSessions.handoffRev(store.read("s_agent")),
    at: new Date(now).toISOString(),
    primary: true
  });
  const lib = await libraryOf(w);
  const res = await lib.open(review.id, { handoff: true });
  assert.equal(res.status, 200, res.text);
  assert.match(res.json.url, /\.lahe\.localhost:\d+\/page\.html$/);
  assert.ok(res.json.request_id, "a pick-up was queued for the attached agent");
});

test("V39: a refused hand-over (another agent is watching) names no site", async (t) => {
  const w = await sitesWorld(t);
  const file = writeFile(docs(w), "page.html", PAGE_HTML);
  const store = sessions(w);
  openSession(w, "s_a");
  oldServer(w, "s_a", fs.realpathSync(docs(w)));
  store.create({ id: "s_agent", name: "library agent" });
  const review = makeReview(w, { agent_session_id: "s_a", target_path: file });
  const now = Date.now();
  catalogRequests.writeAttach(w.state, "s_agent", now);
  store.writeMonitor("s_agent", { pid: process.pid, handoff_rev: agentSessions.handoffRev(store.read("s_agent")), at: new Date(now).toISOString(), primary: true });
  store.writeMonitor("s_a", { pid: process.pid, handoff_rev: agentSessions.handoffRev(store.read("s_a")), at: new Date(now).toISOString(), primary: true });
  const lib = await libraryOf(w);
  const res = await lib.open(review.id, { handoff: true });
  assert.equal(res.json.error && res.json.error.code, "PROTO_CONFIRM_NEEDED", res.text);
  assert.equal(w.helper.sites.list().length, 0);
  assert.equal(w.helper.reviews.get(review.id).served_at || null, null);
});

// --- V40: a newer open review keeps its rail ------------------------------------

// The newer review is created second, and its id sorts after the older one's, so
// it is the newer on a tie in the same millisecond too (no sleeping to order them).
// The helper's clock runs a minute ahead, so an Open stamps later than both.
const AHEAD = { helper: { now: () => Date.now() + 60 * 1000 } };

function twoReviews(w, newerSession, olderSession) {
  const file = writeFile(docs(w), "page.html", PAGE_HTML);
  const older = makeReview(w, { id: "r-a-older", agent_session_id: olderSession, target_path: file });
  // A review's created_at is the wall clock to the millisecond, and two creates
  // in a row can share one on a fast machine. The holder is then whichever the
  // folder listing names first, so "newer" is only newer once the clock moves.
  const olderAt = older.created_at;
  assert.equal(typeof olderAt, "string", "a review carries its created_at");
  while (new Date().toISOString() <= olderAt) { /* wait one millisecond */ }
  const newer = makeReview(w, { id: "r-b-newer", agent_session_id: newerSession, target_path: file });
  w.helper.sites.bind({ root: fs.realpathSync(docs(w)), mode: "folder", entry: "page.html" });
  return { older, newer, name: w.helper.sites.list()[0].name };
}

test("V40: Open on an older row does not move a rail a newer review in another open session holds, and says which review holds it", async (t) => {
  const w = await sitesWorld(t, AHEAD);
  openSession(w, "s_old");
  openSession(w, "s_new");
  const { older, newer, name } = twoReviews(w, "s_new", "s_old");
  const lib = await libraryOf(w);

  const before = await getPage(w, name, "/page.html");
  assert.match(before.text, new RegExp('data-lahe-review="' + newer.id + '"'));
  const res = await lib.open(older.id);
  assert.equal(res.status, 200, res.text);
  assert.match(res.json.url, /\/page\.html$/, "Open still goes to the address");
  assert.equal(res.json.held_by.review, newer.id);
  assert.equal(typeof res.json.held_by.name, "string");
  assert.equal(w.helper.reviews.get(older.id).served_at || null, null, "the older review was not re-stamped");
  const after = await getPage(w, name, "/page.html");
  assert.match(after.text, new RegExp('data-lahe-review="' + newer.id + '"'), "the rail is still the newer review's");
});

// --- V42: nothing restarts, nothing reopens -------------------------------------

test("V42: Open on a review of a closed session restarts no process and reopens no session", async (t) => {
  const w = await sitesWorld(t);
  const file = writeFile(docs(w), "page.html", PAGE_HTML);
  openSession(w, "s_done");
  oldServer(w, "s_done", fs.realpathSync(docs(w)));
  const review = makeReview(w, { agent_session_id: "s_done", target_path: file });
  sessions(w).close("s_done");
  const lib = await libraryOf(w);
  const res = await lib.open(review.id);
  assert.equal(res.status, 200, res.text);
  assert.ok(sessions(w).read("s_done").closed_at, "the session is still closed");
  const catalogFile = path.join(w.state, "catalog.json");
  const catalog = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, "utf8")) : {};
  assert.deepEqual(catalog.reopened || {}, {}, "no reopened-session record");
  const servers = path.join(w.state, "agent-sessions", "s_done", "static-servers");
  assert.deepEqual(fs.readdirSync(servers), ["ss_docs.json"], "no page server was recorded or started: only the old record is there, untouched");
  assert.ok(JSON.parse(fs.readFileSync(path.join(servers, "ss_docs.json"), "utf8")).stopped_at, "and it is still stopped");
  assert.match(res.json.url, /\.lahe\.localhost:\d+\/page\.html$/);
});
