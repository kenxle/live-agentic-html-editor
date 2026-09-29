// The rail follows a link onto a linked document.
//
// Spec: docs/features/20260922.02_linked_docs_rail/01_spec_linked_docs_rail.md
//
// A reviewed Markdown page can link to a document in another folder. The
// session's static server mounts that folder under /.lahe-source/<hash>/ so the
// link works. These tests pin what a page under a mount gets:
//
//  - a document with its own review in this session: a redirect to that
//    review's page, never its token carried over (requirement 1)
//  - a document some reviewed page links to: the linking review's rail
//    (requirement 2), and nothing is written to the review store (requirement 3)
//  - never another agent session's review (requirement 4)
//  - no rail for a file no page linked to (requirement 5); a hidden file is
//    served like any other file
//  - the helper, not the page, names the file an item was made on
//    (requirement 6), and the reload stats that file (requirement 7)

"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const staticServers = require("../../src/service/static_servers.js");
const logModule = require("../../src/service/log.js");
const stateDirModule = require("../../src/service/state_dir.js");
const reviewsModule = require("../../src/service/reviews.js");
const scriptLine = require("../../src/shared/script_line.js");
const markdown = require("../../src/service/markdown.js");
const markdownLinks = require("../../src/service/markdown_links.js");
const projection = require("../../src/service/projection.js");
const protocol = require("../../src/shared/protocol.js");
const record = require("../../src/shared/record.js");
const handledCheck = require("../../src/service/handled_check.js");

function tempDir(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function request(meta, pathname) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: meta.host, port: meta.port, path: pathname, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

const PAGE = "<!doctype html>\n<html>\n<body>\n<h1>page</h1>\n</body>\n</html>\n";

function setCreatedAt(state, id, at) {
  const file = stateDirModule.metaPath(state, id);
  const meta = JSON.parse(fs.readFileSync(file, "utf8"));
  meta.created_at = at;
  fs.writeFileSync(file, JSON.stringify(meta, null, 2) + "\n");
}

/** Every review folder on disk, so a test can say nothing new was created. */
function reviewIds(state) {
  const root = stateDirModule.reviewsRoot(state);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).sort();
}

/**
 * A hub page under review, a linked folder mounted on the hub's server, and
 * the hub's review recorded as the page that linked to `doc.md` and
 * `doc.html`. `sibling.html` sits in the same folder and nobody linked to it.
 */
async function fixture(t, options) {
  const opts = options || {};
  const root = tempDir("lahe-linked-rail-root-");
  const linked = tempDir("lahe-linked-rail-linked-");
  const state = path.join(tempDir("lahe-linked-rail-state-"), "state");
  const sessionId = opts.sessionId || "s_linked";
  const hub = path.join(root, "hub.html");
  fs.writeFileSync(hub, PAGE);
  fs.writeFileSync(path.join(linked, "doc.md"), "# Linked doc\n\nThe linked words.\n");
  fs.writeFileSync(path.join(linked, "doc.html"), PAGE.replace("page", "linked html"));
  fs.writeFileSync(path.join(linked, "sibling.html"), PAGE.replace("page", "sibling"));
  fs.writeFileSync(path.join(linked, ".env"), "SECRET=1\n");
  const log = logModule.createEventLog({ dir: state });
  const reviews = reviewsModule.createReviews({ dir: state, log: log });
  const hubReview = reviews.create({
    id: "r_hub",
    origins: ["null"],
    target_path: hub,
    agent_session_id: sessionId,
    only_recorded_pages: !!opts.only
  });
  setCreatedAt(state, "r_hub", "2026-09-01T00:00:00.000Z");
  const server = await staticServers.start({ dir: state, sessionId: sessionId, root: root });
  t.after(async () => {
    await staticServers.stopAll(state, sessionId);
    await staticServers.stopAll(state, "s_other");
  });
  const prefix = markdownLinks.mountPrefix(linked);
  await staticServers.registerMount(state, sessionId, server.meta, prefix, linked);
  if (opts.record !== false) {
    staticServers.recordLinks(state, sessionId, server.meta.id, opts.registrant || "r_hub", [
      path.join(linked, "doc.md"),
      path.join(linked, "doc.html")
    ]);
  }
  return { root, linked, state, sessionId, hub, log, reviews, hubReview, server, prefix };
}

// ---------------------------------------------------------------------------
// Task 1: a mount remembers which review's page linked to which file.

test("the review whose render linked a file is recorded against that file", async (t) => {
  const f = await fixture(t);
  const meta = staticServers.list(f.state, f.sessionId)[0];
  assert.deepEqual(meta.linked_files[path.join(f.linked, "doc.md")], ["r_hub"]);
  assert.deepEqual(meta.linked_files[path.join(f.linked, "doc.html")], ["r_hub"]);
  assert.equal(meta.linked_files[path.join(f.linked, "sibling.html")], undefined, "a file nobody linked is not recorded");
});

test("a file linked from two reviewed pages keeps both, and the newest review answers", async (t) => {
  const f = await fixture(t);
  f.reviews.create({ id: "r_second", origins: ["null"], target_path: path.join(f.root, "other.html"), agent_session_id: f.sessionId });
  setCreatedAt(f.state, "r_second", "2026-09-02T00:00:00.000Z");
  staticServers.recordLinks(f.state, f.sessionId, f.server.meta.id, "r_second", [path.join(f.linked, "doc.md")]);
  const meta = staticServers.list(f.state, f.sessionId)[0];
  assert.deepEqual(meta.linked_files[path.join(f.linked, "doc.md")], ["r_hub", "r_second"]);

  const res = await request(f.server.meta, f.prefix + "doc.md");
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), "r_second", "the newer linking review wins");
});

test("a later lahe review registering a mount keeps the links a render recorded", async (t) => {
  const f = await fixture(t);
  const other = tempDir("lahe-linked-rail-other-");
  // registerMount is what `lahe review` calls; it is handed its own, older copy
  // of the server's metadata, which never saw linked_files.
  const stale = Object.assign({}, f.server.meta);
  delete stale.linked_files;
  await staticServers.registerMount(f.state, f.sessionId, stale, markdownLinks.mountPrefix(other), other);
  const meta = staticServers.list(f.state, f.sessionId)[0];
  assert.deepEqual(meta.linked_files[path.join(f.linked, "doc.md")], ["r_hub"]);
});

test("a restarted server keeps the links recorded before it stopped", async (t) => {
  const f = await fixture(t);
  await staticServers.stopAll(f.state, f.sessionId);
  await staticServers.restartAll(f.state, f.sessionId);
  const meta = staticServers.list(f.state, f.sessionId)[0];
  assert.deepEqual(meta.linked_files[path.join(f.linked, "doc.md")], ["r_hub"]);
});

test("a render lists the real file behind every local link it translated", () => {
  const home = tempDir("lahe-linked-rail-home-");
  const previousHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  try {
    fs.mkdirSync(path.join(home, "a", "refs"), { recursive: true });
    fs.mkdirSync(path.join(home, "b"));
    const source = path.join(home, "a", "hub.md");
    fs.writeFileSync(source, "# Hub\n\n- [Out](../b/out.md)\n- [Sibling](refs/near.md)\n- [Gone](../b/missing.md)\n");
    fs.writeFileSync(path.join(home, "b", "out.md"), "# Out\n");
    fs.writeFileSync(path.join(home, "a", "refs", "near.md"), "# Near\n");
    const registry = markdownLinks.createRegistry({});
    markdown.render(source, { links: registry });
    assert.deepEqual(registry.linked.slice().sort(), [
      path.join(home, "a", "refs", "near.md"),
      path.join(home, "b", "out.md")
    ]);
  } finally {
    if (previousHome === undefined) delete process.env.LAHE_HOME_DIR;
    else process.env.LAHE_HOME_DIR = previousHome;
  }
});

// ---------------------------------------------------------------------------
// Task 2: what a request under a mount gets.

test("a linked Markdown document with no review of its own carries the linking page's rail", async (t) => {
  const f = await fixture(t);
  const before = reviewIds(f.state);
  const res = await request(f.server.meta, f.prefix + "doc.md");
  assert.equal(res.status, 200);
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), "r_hub");
  assert.ok(res.body.indexOf(f.hubReview.token) !== -1);
  assert.match(res.body, /The linked words\./);
  assert.doesNotMatch(res.body, /This document is not under review/, "the read-only note is gone once it has a rail");
  assert.deepEqual(reviewIds(f.state), before, "no review was created by the click");
});

test("a linked HTML document with no review of its own carries the linking page's rail", async (t) => {
  const f = await fixture(t);
  const res = await request(f.server.meta, f.prefix + "doc.html");
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), "r_hub");
  assert.equal(fs.readFileSync(path.join(f.linked, "doc.html"), "utf8"), PAGE.replace("page", "linked html"), "the file on disk is untouched");
});

test("an HTML file in a mounted folder that no page linked to gets no rail", async (t) => {
  const f = await fixture(t);
  const res = await request(f.server.meta, f.prefix + "sibling.html");
  assert.equal(res.status, 200);
  assert.equal(res.body.indexOf("data-lahe-review"), -1);
});

test("a hidden file under a mount is served like any other, and a path out of it is refused", async (t) => {
  const f = await fixture(t);
  const hidden = await request(f.server.meta, f.prefix + ".env");
  assert.equal(hidden.status, 200);
  assert.equal(hidden.body, "SECRET=1\n");
  assert.equal((await request(f.server.meta, f.prefix + "..%2F..%2Fetc%2Fpasswd")).status, 403);
});

test("a linked document with its own review in this session redirects to that review's page", async (t) => {
  const f = await fixture(t);
  const docHtml = path.join(f.linked, "doc.html");
  f.reviews.create({ id: "r_doc", origins: ["null"], target_path: docHtml, agent_session_id: f.sessionId });
  const own = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.linked });
  const res = await request(f.server.meta, f.prefix + "doc.html");
  assert.equal(res.status, 302);
  assert.equal(res.headers.location, "http://" + own.meta.host + ":" + own.meta.port + "/doc.html");
  assert.equal(res.body.indexOf("r_doc"), -1, "no token and no review id rides the redirect");
});

test("a linked Markdown document with its own review redirects to its rendered page", async (t) => {
  const f = await fixture(t);
  const source = path.join(f.linked, "doc.md");
  const artifact = markdown.writeArtifact(f.state, f.sessionId, source);
  f.reviews.create({
    id: "r_doc_md",
    origins: ["null"],
    target_path: artifact.target,
    source_path: source,
    agent_session_id: f.sessionId
  });
  const own = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: path.dirname(artifact.target) });
  const res = await request(f.server.meta, f.prefix + "doc.md");
  assert.equal(res.status, 302);
  assert.equal(
    res.headers.location,
    "http://" + own.meta.host + ":" + own.meta.port + "/" + encodeURIComponent(path.basename(artifact.target))
  );
});

test("a linked document whose own review's server is down falls back to the linking page's rail", async (t) => {
  const f = await fixture(t);
  f.reviews.create({ id: "r_doc", origins: ["null"], target_path: path.join(f.linked, "doc.html"), agent_session_id: f.sessionId });
  const res = await request(f.server.meta, f.prefix + "doc.html");
  assert.equal(res.status, 200);
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), "r_hub");
});

test("another agent session's review of a linked document is never used", async (t) => {
  const f = await fixture(t);
  f.reviews.create({ id: "r_elsewhere", origins: ["null"], target_path: path.join(f.linked, "doc.html"), agent_session_id: "s_other" });
  await staticServers.start({ dir: f.state, sessionId: "s_other", root: f.linked });
  const res = await request(f.server.meta, f.prefix + "doc.html");
  assert.equal(res.status, 200, "no redirect to another session's page");
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), "r_hub");
  assert.equal(res.body.indexOf(f.reviews.get("r_elsewhere").token), -1);
});

test("a linking review from another agent session is never used", async (t) => {
  const f = await fixture(t, { registrant: "r_elsewhere" });
  f.reviews.create({ id: "r_elsewhere", origins: ["null"], target_path: f.hub, agent_session_id: "s_other" });
  const res = await request(f.server.meta, f.prefix + "doc.html");
  assert.equal(res.body.indexOf("data-lahe-review"), -1);
  assert.equal(res.body.indexOf(f.reviews.get("r_elsewhere").token), -1);
});

test("an --only linking review keeps its linked documents read-only", async (t) => {
  const f = await fixture(t, { only: true });
  const res = await request(f.server.meta, f.prefix + "doc.md");
  assert.equal(res.status, 200);
  assert.equal(res.body.indexOf("data-lahe-review"), -1);
  assert.match(res.body, /This document is not under review/);
});

test("a linked document whose linking review is missing says so and creates nothing", async (t) => {
  const f = await fixture(t, { registrant: "r_gone" });
  const before = reviewIds(f.state);
  const md = await request(f.server.meta, f.prefix + "doc.md");
  assert.equal(md.status, 200);
  assert.equal(md.body.indexOf("data-lahe-review"), -1);
  assert.match(md.body, /has no review, which should not happen/);
  assert.ok(md.body.indexOf("lahe review '" + path.join(f.linked, "doc.md") + "'") !== -1, "it names the command that opens one");
  const html = await request(f.server.meta, f.prefix + "doc.html");
  assert.equal(html.body.indexOf("data-lahe-review"), -1);
  assert.match(html.body, /has no review, which should not happen/);
  assert.deepEqual(reviewIds(f.state), before, "and nothing was created");
});

test("a linked Markdown page's own links ride the same review, one hop on", async (t) => {
  const f = await fixture(t);
  // A relative link inside the linked folder: the home-folder rule for links
  // out of a folder is markdown_links.js's business and tested there.
  fs.writeFileSync(path.join(f.linked, "doc.md"), "# Linked doc\n\n[Next](next.md)\n");
  fs.writeFileSync(path.join(f.linked, "next.md"), "# Next\n\nOne hop on.\n");
  await request(f.server.meta, f.prefix + "doc.md");
  const meta = staticServers.list(f.state, f.sessionId)[0];
  assert.deepEqual(meta.linked_files[path.join(f.linked, "next.md")], ["r_hub"]);
  const next = await request(f.server.meta, f.prefix + "next.md");
  assert.equal(scriptLine.reviewAlreadyInFile(next.body), "r_hub");
});

// ---------------------------------------------------------------------------
// Task 3: the helper names the file an item on a linked page was made on.

test("a linked page's path maps to the real file through the mount table", async (t) => {
  const f = await fixture(t);
  assert.equal(
    staticServers.linkedFileForPage(f.state, f.sessionId, "r_hub", f.prefix + "doc.md"),
    path.join(f.linked, "doc.md")
  );
  assert.equal(
    staticServers.linkedFileForPage(f.state, f.sessionId, "r_hub", encodeURI(f.prefix + "doc.html")),
    path.join(f.linked, "doc.html")
  );
  // A hidden page is a page like any other.
  const hiddenPage = path.join(fs.realpathSync(f.linked), ".notes.md");
  fs.writeFileSync(hiddenPage, "# Hidden notes\n");
  staticServers.recordLinks(f.state, f.sessionId, f.server.meta.id, "r_hub", [hiddenPage]);
  assert.equal(staticServers.linkedFileForPage(f.state, f.sessionId, "r_hub", f.prefix + ".notes.md"), hiddenPage);
});

test("a page path the mount table cannot vouch for names no file", async (t) => {
  const f = await fixture(t);
  const cases = [
    "/.lahe-source/0000000000000000/doc.md",
    f.prefix + "../" + path.basename(f.root) + "/hub.html",
    f.prefix + "..%2Fx.md",
    f.prefix + "sibling.html",
    f.prefix + ".env",
    f.prefix + "escape.md",
    "/hub.html"
  ];
  // A symlink inside the mount pointing outside it: even with its real path
  // recorded, the file is not inside the mount, so it names nothing.
  const outside = path.join(tempDir("lahe-linked-rail-outside-"), "escape.md");
  fs.writeFileSync(outside, "# Outside\n");
  fs.symlinkSync(outside, path.join(f.linked, "escape.md"));
  staticServers.recordLinks(f.state, f.sessionId, f.server.meta.id, "r_hub", [outside, path.join(f.linked, "escape.md")]);
  cases.forEach((pagePath) => {
    assert.equal(staticServers.linkedFileForPage(f.state, f.sessionId, "r_hub", pagePath), null, pagePath);
  });
  assert.equal(staticServers.linkedFileForPage(f.state, f.sessionId, "r_someone_else", f.prefix + "doc.md"), null);
  assert.equal(staticServers.linkedFileForPage(f.state, "s_other", "r_hub", f.prefix + "doc.md"), null);
});

let eventCounter = 0;
function postItem(log, reviewId, item) {
  eventCounter += 1;
  log.append(reviewId, [
    protocol.newEvent({
      event: protocol.EVENT.ITEM_READY,
      event_id: "evt_linked_" + eventCounter,
      review: reviewId,
      item: item[record.FIELD.ID],
      rev: item[record.FIELD.REV],
      page_path: item[record.FIELD.PAGE_PATH],
      page_title: item[record.FIELD.PAGE_TITLE],
      page_seq: item[record.FIELD.PAGE_SEQ],
      payload: { draft: false, record: item }
    })
  ]);
}

test("review.json names the linked file for an item made on a linked page, never the page's claim", async (t) => {
  const f = await fixture(t);
  const origin = "http://" + f.server.meta.host + ":" + f.server.meta.port;
  postItem(f.log, "r_hub", record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "fix this",
    page_origin: origin,
    page_path: f.prefix + "doc.md",
    page_title: "Linked doc",
    page_seq: 1,
    source_hint: { known: true, path: "/etc/passwd" }
  }));
  postItem(f.log, "r_hub", record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "and this",
    page_origin: origin,
    page_path: f.prefix + "sibling.html",
    page_title: "Sibling",
    page_seq: 2,
    source_hint: { known: true, path: "/etc/passwd" }
  }));
  const projector = projection.createProjector({ dir: f.state, log: f.log });
  const projected = projector.currentProjection("r_hub").projection;
  const linkedPage = projected.pages.find((p) => p.path === f.prefix + "doc.md");
  assert.equal(linkedPage.source_hint.known, true);
  assert.equal(linkedPage.source_hint.path, path.join(f.linked, "doc.md"));
  assert.equal(linkedPage.linked_file, path.join(f.linked, "doc.md"));
  assert.equal(linkedPage.items[0].region.stamp_carriable, false, "a Markdown source cannot carry a stamp");
  const unvouched = projected.pages.find((p) => p.path === f.prefix + "sibling.html");
  assert.equal(unvouched.source_hint.known, false, "a mount path the helper cannot map is unknown, not the page's claim");
  assert.equal(unvouched.linked_file, null);
});

test("the reload for a linked page stats the linked file, not the hub", async (t) => {
  const f = await fixture(t);
  const docMd = path.join(f.linked, "doc.md");
  const past = new Date("2026-01-01T00:00:00.000Z");
  fs.utimesSync(docMd, past, past);
  const at = f.reviews.targetMtime("r_hub", f.prefix + "doc.md");
  assert.equal(at, past.toISOString());
  assert.equal(f.reviews.targetMtime("r_hub", f.prefix + "sibling.html"), null, "an unvouched mount path reloads nothing");
  assert.equal(fs.readFileSync(docMd, "utf8").indexOf("data-lahe-review"), -1, "nothing is healed into a linked file");
});

test("a handled check for a linked page reads the linked file", async (t) => {
  const f = await fixture(t);
  const docMd = path.join(f.linked, "doc.md");
  const past = new Date("2026-01-01T00:00:00.000Z");
  fs.utimesSync(docMd, past, past);
  fs.utimesSync(f.hub, past, past);
  const checker = handledCheck.createHandledCheck({ dir: f.state });
  const edit = (after) => record.newItem({
    kind: record.KIND.EDIT,
    state: record.STATE.READY,
    before: "The linked words.",
    after: after,
    page_origin: "http://127.0.0.1:1",
    page_path: f.prefix + "doc.md",
    page_title: "Linked doc",
    page_seq: 1,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z"
  });
  assert.equal(checker.pageShows("r_hub", edit("The linked words.")), true, "the words are in the linked file");
  assert.equal(checker.pageShows("r_hub", edit("Words nobody wrote.")), false);
});

test("the helper's re-render records the links a changed document gained", async (t) => {
  const docs = tempDir("lahe-linked-rail-docs-");
  const state = path.join(tempDir("lahe-linked-rail-rebuild-state-"), "state");
  const sessionId = "s_rebuild";
  const source = path.join(docs, "hub.md");
  fs.writeFileSync(source, "# Hub\n\nNo links yet.\n");
  fs.writeFileSync(path.join(docs, "later.md"), "# Later\n");
  const artifact = markdown.writeArtifact(state, sessionId, source);
  const log = logModule.createEventLog({ dir: state });
  const reviews = reviewsModule.createReviews({ dir: state, log: log });
  reviews.create({ id: "r_md", origins: ["null"], target_path: artifact.target, source_path: source, agent_session_id: sessionId });
  const server = await staticServers.start({ dir: state, sessionId: sessionId, root: path.dirname(artifact.target) });
  t.after(async () => { await staticServers.stopAll(state, sessionId); });

  fs.writeFileSync(source, "# Hub\n\n[Later](later.md)\n");
  const future = new Date(Date.now() + 60000);
  fs.utimesSync(source, future, future);
  const rebuild = require("../../src/service/rebuild.js");
  const result = rebuild.createRebuilder({ dir: state }).refreshById("r_md");
  assert.equal(result.rendered, true);
  const meta = staticServers.list(state, sessionId).find((m) => m.id === server.meta.id);
  assert.deepEqual(meta.linked_files[path.join(docs, "later.md")], ["r_md"]);
});

test("the drain names the linked file for an item made on a linked page", () => {
  const statusCommand = require("../../src/cli/commands/status.js");
  const items = statusCommand.itemsOf({
    pages: [
      { path: "/.lahe-source/abc/doc.md", origin: "http://127.0.0.1:1", title: "Doc", linked_file: "/home/me/doc.md", items: [{ id: "c_1" }] },
      { path: "/hub.html", origin: "http://127.0.0.1:1", title: "Hub", linked_file: null, items: [{ id: "c_2" }] }
    ]
  });
  assert.equal(items[0].page.linked_file, "/home/me/doc.md");
  assert.equal(Object.prototype.hasOwnProperty.call(items[1].page, "linked_file"), false, "an ordinary page's line is unchanged");
});

// ---------------------------------------------------------------------------
// Fix round.

test("a linked file that is not a page is never named as the file to edit", async (t) => {
  const f = await fixture(t);
  const script = path.join(f.linked, "run.sh");
  fs.writeFileSync(script, "#!/bin/sh\necho hi\n");
  staticServers.recordLinks(f.state, f.sessionId, f.server.meta.id, "r_hub", [script]);
  assert.equal(staticServers.linkedFileForPage(f.state, f.sessionId, "r_hub", f.prefix + "run.sh"), null);

  const origin = "http://" + f.server.meta.host + ":" + f.server.meta.port;
  postItem(f.log, "r_hub", record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "about the script",
    page_origin: origin,
    page_path: f.prefix + "run.sh",
    page_title: "run.sh",
    page_seq: 1
  }));
  const projected = projection.createProjector({ dir: f.state, log: f.log }).currentProjection("r_hub").projection;
  const group = projected.pages.find((p) => p.path === f.prefix + "run.sh");
  assert.equal(group.linked_file, null);
  assert.equal(group.source_hint.known, false);
});

test("a render records only pages among the files it links to", () => {
  const home = tempDir("lahe-linked-rail-home2-");
  const previousHome = process.env.LAHE_HOME_DIR;
  process.env.LAHE_HOME_DIR = home;
  try {
    fs.mkdirSync(path.join(home, "a"));
    fs.mkdirSync(path.join(home, "b"));
    const source = path.join(home, "a", "hub.md");
    fs.writeFileSync(source, "# Hub\n\n- [x](../b/run.sh)\n- [y](../b/page.html)\n- [z](data.json)\n");
    fs.writeFileSync(path.join(home, "b", "run.sh"), "echo\n");
    fs.writeFileSync(path.join(home, "b", "page.html"), "<p>p</p>\n");
    fs.writeFileSync(path.join(home, "a", "data.json"), "{}\n");
    const registry = markdownLinks.createRegistry({});
    markdown.render(source, { links: registry });
    assert.deepEqual(registry.linked, [path.join(home, "b", "page.html")]);
  } finally {
    if (previousHome === undefined) delete process.env.LAHE_HOME_DIR;
    else process.env.LAHE_HOME_DIR = previousHome;
  }
});

test("an encoded spelling of a mount prefix is refused, and gets no linked source", async (t) => {
  const f = await fixture(t);
  const encoded = f.prefix.replace("/.lahe-source/", "/%2Elahe-source/");
  const res = await request(f.server.meta, encoded + "doc.md");
  assert.equal(res.status, 404);
  assert.equal(res.body.indexOf("data-lahe-review"), -1);
  assert.equal(staticServers.linkedFileForPage(f.state, f.sessionId, "r_hub", encoded + "doc.md"), null);

  // The review has a source of its own, which a mount page must never inherit.
  const hubSource = path.join(f.root, "hub.md");
  f.reviews.recordPaths("r_hub", { source_path: hubSource });
  postItem(f.log, "r_hub", record.newItem({
    kind: record.KIND.COMMENT,
    state: record.STATE.READY,
    note: "encoded",
    page_origin: "http://" + f.server.meta.host + ":" + f.server.meta.port,
    page_path: encoded + "doc.md",
    page_title: "doc",
    page_seq: 1
  }));
  f.log.append("r_hub", [protocol.newEvent({
    event: protocol.EVENT.PAGE_VISITED,
    event_id: "evt_linked_hint",
    review: "r_hub",
    page_path: "/hub.html",
    page_seq: 1,
    source_hint: hubSource
  })]);
  const projected = projection.createProjector({ dir: f.state, log: f.log }).currentProjection("r_hub").projection;
  const group = projected.pages.find((p) => p.path === encoded + "doc.md");
  assert.equal(group.linked_file, null);
  assert.notEqual(group.source_hint.path, hubSource, "not the hub's source");
  assert.equal(group.source_hint.known, false);
  assert.equal(f.reviews.targetMtime("r_hub", encoded + "doc.md"), null, "and it reloads nothing");
});

test("the copy-the-command button quotes the path for a POSIX shell", () => {
  const { execFileSync } = require("node:child_process");
  const source = "/home/u/a b;touch x'q.md";
  const note = markdown.missingReviewNote(source, "s_abc123");
  const attr = note.match(/data-command="([^"]*)"/)[1]
    .replace(/&quot;/g, "\"").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const words = execFileSync("/bin/sh", ["-c", "printf '%s\\n' " + attr], { encoding: "utf8" }).split("\n").slice(0, -1);
  assert.deepEqual(words, ["lahe", "review", source, "--session", "s_abc123"]);
});
