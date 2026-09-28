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
const protocol = require("../../src/shared/protocol.js");
const scriptLine = require("../../src/shared/script_line.js");
const tabIcon = require("../../src/service/tab_icon.js");
const markdown = require("../../src/service/markdown.js");

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function request(meta, pathname, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: meta.host, port: meta.port, path: pathname, method }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("a session-owned static server is reusable, read-only, contained, and stoppable", async (t) => {
  const root = tempDir("lahe-static-root-");
  const state = path.join(tempDir("lahe-static-state-"), "state");
  const outside = path.join(tempDir("lahe-static-outside-"), "secret.txt");
  fs.writeFileSync(path.join(root, "page.html"), "<!doctype html><p>review page</p>");
  fs.writeFileSync(outside, "do not serve");
  fs.symlinkSync(outside, path.join(root, "outside.txt"));

  const first = await staticServers.start({ dir: state, sessionId: "s_static", root });
  t.after(async () => { await staticServers.stopAll(state, "s_static"); });
  assert.equal(first.started, true);
  assert.equal(await staticServers.isExactServer(first.meta), true);

  const page = await request(first.meta, "/page.html");
  assert.equal(page.status, 200);
  assert.equal(page.body, "<!doctype html><p>review page</p>");
  assert.equal(page.headers["cache-control"], "no-store");
  assert.match(page.headers["content-type"], /^text\/html/);

  assert.equal((await request(first.meta, "/outside.txt")).status, 403);
  assert.equal((await request(first.meta, "/page.html", "POST")).status, 405);

  const second = await staticServers.start({ dir: state, sessionId: "s_static", root });
  assert.equal(second.started, false);
  assert.equal(second.meta.instance, first.meta.instance);

  assert.equal(await staticServers.stopOne(state, "s_static", first.meta), true);
  assert.equal(await staticServers.isExactServer(first.meta), false);
  assert.ok(staticServers.list(state, "s_static")[0].stopped_at);
});

test("corrupt static-server metadata fails loud instead of losing process ownership", async () => {
  const state = path.join(tempDir("lahe-static-corrupt-"), "state");
  const root = path.join(state, "agent-sessions", "s_corrupt", "static-servers");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, "ss_broken.json"), "not json");
  assert.throws(
    () => staticServers.list(state, "s_corrupt"),
    /metadata is corrupt/
  );
});

test("two agent sessions in the same project root own independent server leases", async (t) => {
  const root = tempDir("lahe-static-shared-root-");
  const state = path.join(tempDir("lahe-static-shared-state-"), "state");
  fs.writeFileSync(path.join(root, "page.html"), "<!doctype html><p>shared root</p>");
  const alpha = await staticServers.start({ dir: state, sessionId: "s_alpha", root });
  const beta = await staticServers.start({ dir: state, sessionId: "s_beta", root });
  t.after(async () => {
    await staticServers.stopAll(state, "s_alpha");
    await staticServers.stopAll(state, "s_beta");
  });

  assert.notEqual(alpha.meta.instance, beta.meta.instance);
  assert.notEqual(alpha.meta.port, beta.meta.port);
  await staticServers.stopAll(state, "s_alpha");
  assert.equal(await staticServers.isExactServer(alpha.meta), false);
  assert.equal(await staticServers.isExactServer(beta.meta), true);
});

test("one agent session can own static reviews in different project roots", async (t) => {
  const firstRoot = tempDir("lahe-static-first-root-");
  const secondRoot = tempDir("lahe-static-second-root-");
  const state = path.join(tempDir("lahe-static-many-state-"), "state");
  fs.writeFileSync(path.join(firstRoot, "one.html"), "one");
  fs.writeFileSync(path.join(secondRoot, "two.html"), "two");
  const first = await staticServers.start({ dir: state, sessionId: "s_many", root: firstRoot });
  const second = await staticServers.start({ dir: state, sessionId: "s_many", root: secondRoot });
  t.after(async () => { await staticServers.stopAll(state, "s_many"); });

  assert.equal(staticServers.list(state, "s_many").length, 2);
  assert.equal(await staticServers.isExactServer(first.meta), true);
  assert.equal(await staticServers.isExactServer(second.meta), true);
  assert.equal(await staticServers.stopAll(state, "s_many"), 2);
  assert.equal(await staticServers.isExactServer(first.meta), false);
  assert.equal(await staticServers.isExactServer(second.meta), false);
});

// ---------------------------------------------------------------------------
// Serve-time injection.
//
// heal.js only repairs a page something is already polling. If the reviewer's
// tab is closed, or they reload in the gap between an agent overwriting the
// file and the next poll, nothing was ever polling and nothing repairs it.
// This is the second, stronger path: the server that answers the request puts
// the tag in the RESPONSE, so even the very first load after an overwrite
// carries the rail.

const PAGE_WITHOUT_LINE = "<!doctype html>\n<html>\n<body>\n<h1>hello</h1>\n</body>\n</html>\n";

/**
 * A review and a server rooted at `root`.
 *
 * By default the review records `root/page.html`, the single-page shape. With
 * `folderReview: true` it records the FOLDER instead, which is what
 * `lahe review <folder>` writes, and is the only shape that puts its line on
 * pages it never recorded.
 *
 * The session is on the fixture because the server must be started with the
 * same one: a review of another agent session never answers for this server's
 * pages, recorded or not.
 */
function injectFixture(options) {
  const opts = options || {};
  const root = tempDir("lahe-static-inject-root-");
  const state = path.join(tempDir("lahe-static-inject-state-"), "state");
  const page = path.join(root, opts.filename || "page.html");
  fs.writeFileSync(page, opts.html === undefined ? PAGE_WITHOUT_LINE : opts.html);
  const sessionId = opts.sessionId || "s_inject";
  const log = logModule.createEventLog({ dir: state });
  const reviews = reviewsModule.createReviews({ dir: state, log: log });
  const review = reviews.create({
    id: opts.reviewId || "r_inject",
    origins: ["null"],
    target_path: opts.folderReview ? root : page,
    agent_session_id: sessionId,
    only_recorded_pages: !!opts.only
  });
  return {
    root: root,
    state: state,
    page: page,
    review: review,
    reviews: reviews,
    sessionId: sessionId
  };
}

/** The helper log, or "" when nothing has written one. */
function helperLog(state) {
  try {
    return fs.readFileSync(path.join(state, "helper.log"), "utf8");
  } catch (err) {
    return "";
  }
}

/** How many helper.log lines mention `phrase`. */
function logLines(state, phrase) {
  return helperLog(state).split("\n").filter((line) => line.indexOf(phrase) !== -1);
}

/** Another review on the same state directory, with a chosen creation time. */
function addReview(f, spec) {
  const review = f.reviews.create({
    id: spec.id,
    origins: ["null"],
    target_path: spec.targetPath,
    agent_session_id: spec.sessionId
  });
  // `created_at` decides which review a never-recorded page lands in, and two
  // reviews minted in the same millisecond would make that a coin toss. The
  // server reads meta.json off disk, so the test writes the times it means.
  const metaPath = stateDirModule.metaPath(f.state, spec.id);
  const meta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
  meta.created_at = spec.createdAt;
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
  return review;
}

test("a target file whose on-disk tag was stripped is served carrying the tag", async (t) => {
  const f = injectFixture();
  const server = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });

  const res = await request(server.meta, "/page.html");
  assert.equal(res.status, 200);
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), f.review.id, "the served page now carries this review's tag");
  assert.ok(res.body.indexOf(f.review.token) !== -1, "and it is this review's own token");
  assert.equal(
    Number(res.headers["content-length"]),
    Buffer.byteLength(res.body, "utf8"),
    "content-length was recalculated for the injected body"
  );
  assert.match(res.body, /<h1>hello<\/h1>/, "the page's own content survives the injection");
  assert.equal(
    fs.readFileSync(f.page, "utf8").indexOf("data-lahe-review"),
    -1,
    "the static server stayed read-only: the file on disk is untouched"
  );
});

test("a file that already carries this review's tag is served with exactly one, not two", async (t) => {
  const f = injectFixture();
  const tag = protocol.scriptTag({
    src: "http://" + protocol.DEFAULT_HOST + ":" + protocol.DEFAULT_PORT + protocol.route("library.get").path,
    review: f.review.id,
    token: f.review.token,
    helper: "http://" + protocol.DEFAULT_HOST + ":" + protocol.DEFAULT_PORT
  });
  fs.writeFileSync(f.page, scriptLine.placeScriptLine(PAGE_WITHOUT_LINE, tag).html);
  const onDiskBefore = fs.readFileSync(f.page, "utf8");

  const server = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });

  const res = await request(server.meta, "/page.html");
  assert.equal(res.status, 200);
  const occurrences = (res.body.match(/data-lahe-review="/g) || []).length;
  assert.equal(occurrences, 1, "the tag was not injected a second time");
  assert.equal(
    res.body,
    tabIcon.ensure(onDiskBefore),
    "an already-tagged page is served as it is on disk, with the fallback tab icon as the only difference"
  );
});

test("a served page with no tab icon of its own gets the fallback, and one that has an icon keeps it", async (t) => {
  const f = injectFixture();
  const server = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });

  const plain = await request(server.meta, "/page.html");
  assert.ok(plain.body.includes(tabIcon.LINK), "the blank-tab default is what a reviewer cannot find among six tabs");
  assert.equal(
    Number(plain.headers["content-length"]),
    Buffer.byteLength(plain.body, "utf8"),
    "content-length covers the icon too"
  );
  assert.equal(
    fs.readFileSync(f.page, "utf8").indexOf("rel=\"icon\""),
    -1,
    "the icon went into the response only: the reviewer's file stays out of it"
  );

  const own = "<!doctype html>\n<html>\n<head>\n<link rel=\"icon\" href=\"/mine.svg\">\n</head>\n<body>\n<h1>hello</h1>\n</body>\n</html>\n";
  fs.writeFileSync(f.page, own);
  const authored = await request(server.meta, "/page.html");
  assert.ok(authored.body.includes("/mine.svg"), "the author's icon survives");
  assert.equal(authored.body.indexOf(tabIcon.LINK), -1, "and LAHE's fallback does not pile on top of it");
});

test("injection still matches after restartAll, which re-derives root from meta rather than the original call", async (t) => {
  const f = injectFixture();
  const first = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.root });
  await staticServers.stopAll(f.state, f.sessionId);
  assert.equal(await staticServers.isExactServer(first.meta), false, "stopped before the restart");

  const restarted = await staticServers.restartAll(f.state, f.sessionId);
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  assert.equal(restarted, 1);

  const servers = staticServers.list(f.state, f.sessionId).filter((m) => !m.stopped_at);
  assert.equal(servers.length, 1);
  const res = await request(servers[0], "/page.html");
  assert.equal(res.status, 200);
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), f.review.id, "the restarted server still injects the tag");
});

// THE LIBRARY COMES FROM THIS SERVER NOW.
//
// `add` used to drop a copy of the built bundle beside the reviewed page so the
// script line's onerror had something relative to load with the helper down.
// That folder is usually a git checkout, `git add -A` committed the bundle and
// the tagged page together, and the deployed site then brought the review rail
// up for every visitor. Nothing is written beside the page any more, so this
// route is what keeps the helper-is-down case working: the server that answered
// the request for the page answers for the library too.
test("the static server publishes the built library at its own reserved route", async (t) => {
  const f = injectFixture();
  const server = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });

  const res = await request(server.meta, staticServers.LIBRARY_PATH);
  assert.equal(res.status, 200);
  assert.match(res.headers["content-type"], /^text\/javascript/);
  assert.equal(
    res.body,
    fs.readFileSync(path.join(__dirname, "..", "..", "dist", "lahe-layer.js"), "utf8"),
    "byte for byte the bundle this clone built"
  );
  assert.equal(
    fs.existsSync(path.join(f.root, "lahe-layer.js")),
    false,
    "and no copy of it was written into the reviewed page's own folder"
  );
});

test("the injected tag loads the library from this server and keeps the helper as the fallback", async (t) => {
  const f = injectFixture();
  const server = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });

  const res = await request(server.meta, "/page.html");
  const src = /<script src="([^"]+)"/.exec(res.body);
  assert.ok(src, "the injected tag is there:\n" + res.body);
  assert.equal(
    src[1],
    staticServers.LIBRARY_PATH,
    "a root-absolute path, so it resolves back to this server whatever host name the reviewer typed"
  );

  const fallback = /data-lahe-fallback="([^"]+)"/.exec(res.body);
  assert.ok(fallback, "and it still carries a fallback");
  assert.match(
    fallback[1],
    /^http:\/\/127\.0\.0\.1:\d+\/lahe-layer\.js$/,
    "the helper's own URL, not a relative sibling name nothing writes any more"
  );

  // The relative form is the one that shipped to a deployed site and loaded the
  // rail for every visitor. It must not be what an injected page carries.
  assert.equal(fallback[1].indexOf("http://"), 0, "absolute, so it can only ever mean this machine's helper");
});

// ---------------------------------------------------------------------------
// A FOLDER REVIEW PUTS THE RAIL ON EVERY PAGE OF ITS FOLDER.
//
// This used to be the opposite: a page no review had recorded as a target was
// served plain, so a reviewer walking a folder of wireframes found the rail on
// the one page the agent had enrolled and nothing on the rest. The workaround
// was enrolling every page as its own review; one run on 2026-09-16 made 82 of
// them. Ken's rule (docs/ongoing/STATIC_SITE_FOLDER.md): this is our server,
// made for document review, so everything coming through it is reviewable.
//
// THE RULE IS SCOPED TO THE REVIEW THAT ASKED FOR A FOLDER. A single-page
// review roots its server at the page's own folder, which is very often a
// home or Desktop directory holding unrelated HTML. Handing those pages a live
// review token was never the ask: `lahe review <folder>` is where the reviewer
// said "this whole folder", so a review whose recorded target IS this server's
// root is the only one that answers for pages it never recorded.
//
// Nothing is written to make it happen: no enrollment, no meta.json update, no
// log line for the ordinary case. The item's own event carries the page path,
// which is all the rail and review.json need to group by page.

test("a folder review puts its line on a page nobody recorded, and writes nothing to do it", async (t) => {
  const f = injectFixture({ folderReview: true });
  const otherHtml = "<!doctype html>\n<html>\n<body>\n<p>nobody enrolled this one</p>\n</body>\n</html>\n";
  fs.writeFileSync(path.join(f.root, "other.html"), otherHtml);
  const metaBefore = fs.readFileSync(stateDirModule.metaPath(f.state, f.review.id), "utf8");

  const server = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });

  const res = await request(server.meta, "/other.html");
  assert.equal(res.status, 200);
  assert.equal(scriptLine.reviewAlreadyInFile(res.body), f.review.id, "it carries this folder's review");
  assert.ok(res.body.indexOf(f.review.token) !== -1, "with that review's own token");
  assert.match(res.body, /nobody enrolled this one/, "and the page's own content is untouched");
  assert.equal(
    fs.readFileSync(path.join(f.root, "other.html"), "utf8").indexOf("data-lahe-review"),
    -1,
    "the file on disk is not written into"
  );
  assert.equal(
    fs.readFileSync(stateDirModule.metaPath(f.state, f.review.id), "utf8"),
    metaBefore,
    "and the review store is not written into either: serving enrolls nothing"
  );
});

// THE RAIL FOLLOWS THE REVIEWER, and that includes a single-page review.
//
// Ken, 2026-09-16: "if you can navigate to a page from where you currently are,
// and you currently have the lahe editor, it should follow you across anything
// you click on." A one-page review still serves that page's whole folder, so a
// link to a sibling, or a sibling's name typed into the address bar, is
// somewhere the reviewer can get to, and arriving there without a rail is
// arriving somewhere they cannot say anything.
//
// The isolation case is real too, and it is the next test: an opt-in flag, not
// the default, because the default is the one that matches what a reviewer
// expects a review to do.
test("a single-page review's folder follows the reviewer: a sibling carries the rail too", async (t) => {
  const f = injectFixture();
  fs.writeFileSync(path.join(f.root, "sibling.html"), PAGE_WITHOUT_LINE);

  const server = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });

  const neighbour = await request(server.meta, "/sibling.html");
  assert.equal(neighbour.status, 200);
  assert.equal(
    scriptLine.reviewAlreadyInFile(neighbour.body),
    f.review.id,
    "a page reachable from the reviewed one carries the same review"
  );

  const recorded = await request(server.meta, "/page.html");
  assert.equal(scriptLine.reviewAlreadyInFile(recorded.body), f.review.id, "and the page that was named still does");
});

// THE OPT-OUT, for the folder you did not choose.
//
// `lahe review ~/Downloads/statement.html` roots a server at Downloads, which
// is full of files the reviewer never meant to open to anything. `--only`
// records the review as isolated, and an isolated review is never used as the
// answer for a page it did not record, so those files are served plain.
test("an isolated review is never borrowed for a page it did not record", async (t) => {
  const f = injectFixture({ only: true });
  fs.writeFileSync(path.join(f.root, "statement.html"), PAGE_WITHOUT_LINE);

  const server = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });

  const neighbour = await request(server.meta, "/statement.html");
  assert.equal(neighbour.status, 200);
  assert.equal(neighbour.body.indexOf("data-lahe-review"), -1, "no review id on a file the reviewer never named");
  assert.equal(neighbour.body.indexOf(f.review.token), -1, "and above all no token");

  const recorded = await request(server.meta, "/page.html");
  assert.equal(
    scriptLine.reviewAlreadyInFile(recorded.body),
    f.review.id,
    "the page the review was opened on is unaffected: --only narrows the fallback, not the review"
  );
});

test("a review of another agent session never answers, not even for a page it recorded", async (t) => {
  const f = injectFixture({ sessionId: "s_mine" });

  const server = await staticServers.start({ dir: f.state, sessionId: "s_theirs", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_theirs"); });

  const res = await request(server.meta, "/page.html");
  assert.equal(res.status, 200);
  assert.equal(
    res.body.indexOf("data-lahe-review"),
    -1,
    "one session's server does not hand out another session's review, recorded target or not"
  );
  assert.equal(res.body.indexOf(f.review.token), -1, "and above all not its token");
});

test("the newest review rooted here wins; another session's, a nested one, and another folder's never do", async (t) => {
  const f = injectFixture({ sessionId: "s_newest", reviewId: "r_oldest", folderReview: true });
  addReview(f, {
    id: "r_oldest",
    sessionId: "s_newest",
    targetPath: f.root,
    createdAt: "2026-09-01T00:00:00.000Z"
  });
  addReview(f, {
    id: "r_newest",
    sessionId: "s_newest",
    targetPath: f.root,
    createdAt: "2026-09-16T00:00:00.000Z"
  });
  // A review in ANOTHER agent session, minted later than either of ours. Agent
  // sessions do not see each other's work, and a shared folder is exactly where
  // that would leak.
  addReview(f, {
    id: "r_other_session",
    sessionId: "s_somebody_else",
    targetPath: f.root,
    createdAt: "2026-09-17T00:00:00.000Z"
  });
  // TWO NESTED reviews, both newer than everything else. `lahe review site/`
  // then `lahe review site/sub/`, and separately a page inside that subfolder.
  // Each of those owns its own folder, which is where its own server is rooted;
  // neither reaches up, or the newer and narrower review quietly takes over
  // every page of the parent.
  const nested = path.join(f.root, "sub");
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, "deep.html"), PAGE_WITHOUT_LINE);
  addReview(f, {
    id: "r_nested_folder",
    sessionId: "s_newest",
    targetPath: nested,
    createdAt: "2026-09-19T00:00:00.000Z"
  });
  addReview(f, {
    id: "r_nested_page",
    sessionId: "s_newest",
    targetPath: path.join(nested, "deep.html"),
    createdAt: "2026-09-20T00:00:00.000Z"
  });
  // And a review of this same session whose pages live somewhere else entirely.
  const elsewhere = tempDir("lahe-static-elsewhere-");
  addReview(f, {
    id: "r_other_folder",
    sessionId: "s_newest",
    targetPath: path.join(elsewhere, "far.html"),
    createdAt: "2026-09-18T00:00:00.000Z"
  });
  fs.writeFileSync(path.join(f.root, "unenrolled.html"), PAGE_WITHOUT_LINE);

  const server = await staticServers.start({ dir: f.state, sessionId: "s_newest", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_newest"); });

  const res = await request(server.meta, "/unenrolled.html");
  assert.equal(res.status, 200);
  assert.equal(
    scriptLine.reviewAlreadyInFile(res.body),
    "r_newest",
    "the newest review of this session whose own server root IS this folder"
  );

  // `/sub/deep.html` IS a recorded target of r_nested_page, so that review
  // answers for it: a recorded page always keeps its own review. What must not
  // happen is either nested review answering for the parent's pages, which the
  // line above is the assertion for.
  const deep = await request(server.meta, "/sub/deep.html");
  assert.equal(scriptLine.reviewAlreadyInFile(deep.body), "r_nested_page");
});

test("a page recorded on its own keeps its own review while the folder review takes the rest", async (t) => {
  const f = injectFixture({ sessionId: "s_mixed", reviewId: "r_folder", folderReview: true });
  addReview(f, {
    id: "r_folder",
    sessionId: "s_mixed",
    targetPath: f.root,
    createdAt: "2026-09-16T00:00:00.000Z"
  });
  addReview(f, {
    id: "r_just_this_page",
    sessionId: "s_mixed",
    targetPath: f.page,
    createdAt: "2026-09-01T00:00:00.000Z"
  });
  fs.writeFileSync(path.join(f.root, "rest.html"), PAGE_WITHOUT_LINE);

  const server = await staticServers.start({ dir: f.state, sessionId: "s_mixed", root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, "s_mixed"); });

  const own = await request(server.meta, "/page.html");
  assert.equal(
    scriptLine.reviewAlreadyInFile(own.body),
    "r_just_this_page",
    "the page's own review wins over the folder's, even though the folder's is newer"
  );
  const rest = await request(server.meta, "/rest.html");
  assert.equal(scriptLine.reviewAlreadyInFile(rest.body), "r_folder");

  // Said in the log, because two reviews over one folder is the kind of thing
  // an agent discovers by wondering why a reply landed on the wrong card.
  await request(server.meta, "/page.html");
  const said = logLines(f.state, "keeps its own review");
  assert.equal(said.length, 1, "said once for that page, not once per request:\n" + helperLog(f.state));
  assert.ok(said[0].indexOf("r_just_this_page") !== -1, "naming the review that won: " + said[0]);
});

test("a server no review backs serves its pages plain, and says so once", async (t) => {
  const root = tempDir("lahe-static-unbacked-root-");
  const state = path.join(tempDir("lahe-static-unbacked-state-"), "state");
  fs.writeFileSync(path.join(root, "page.html"), PAGE_WITHOUT_LINE);

  const server = await staticServers.start({ dir: state, sessionId: "s_unbacked", root: root });
  t.after(async () => { await staticServers.stopAll(state, "s_unbacked"); });

  const first = await request(server.meta, "/page.html");
  assert.equal(first.status, 200);
  assert.equal(first.body.indexOf("data-lahe-review"), -1, "there is no review to put on it");
  assert.match(first.body, /<h1>hello<\/h1>/, "and the page is still served");
  await request(server.meta, "/page.html");

  const lines = logLines(state, "no review backs");
  assert.equal(lines.length, 1, "said once, not once per request:\n" + helperLog(state));
});

// THE LATCH BELONGS TO THE ROOT, NOT TO EVERY REQUEST.
//
// A mounted folder holds documents a rendered Markdown page links to, and those
// are served read-only with no review on purpose. Counting one of them as "no
// review backs this server" both says something untrue and burns the once-only
// latch, so the real unbacked case, a page at the root with nothing behind it,
// would never be logged at all.
test("a page under a mount is not mistaken for an unbacked server", async (t) => {
  const f = injectFixture({ folderReview: true });
  const linked = tempDir("lahe-static-mount-");
  fs.writeFileSync(path.join(linked, "linked.html"), PAGE_WITHOUT_LINE);

  const server = await staticServers.start({ dir: f.state, sessionId: f.sessionId, root: f.root });
  t.after(async () => { await staticServers.stopAll(f.state, f.sessionId); });
  const prefix = "/.lahe-source/abc123/";
  await staticServers.registerMount(f.state, f.sessionId, server.meta, prefix, linked);

  const mounted = await request(server.meta, prefix + "linked.html");
  assert.equal(mounted.status, 200);
  assert.equal(
    mounted.body.indexOf("data-lahe-review"),
    -1,
    "a linked document stays read-only: no review, no token"
  );
  assert.deepEqual(
    logLines(f.state, "no review backs"),
    [],
    "and it is not reported as an unbacked server, which would also spend the once-only latch"
  );
});

// ---------------------------------------------------------------------------
// A mount refuses hidden files.
//
// markdown_links.js already refuses a hidden LOCATION when translating a link
// into a mount, but the request handler above served any path under an
// already-mounted folder, hidden or not: a reviewed folder that links out to
// a document sitting beside a .env or a .git/config handed both of those out
// over HTTP. The own root is unaffected on purpose: it already special-cases
// its own hidden files (.lahe-doc-style.css, .lahe-fonts/), and mount requests
// for those same basenames still resolve to the packaged copy, never to a real
// file on disk, so they are exempt here too.

function notFoundBody(status, response) {
  assert.equal(response.status, status);
  if (status === 404) assert.equal(response.body, "not found\n");
}

test("a mount refuses a hidden file at its root", async (t) => {
  const state = path.join(tempDir("lahe-static-hidden-state-"), "state");
  const root = tempDir("lahe-static-hidden-root-");
  const linked = tempDir("lahe-static-hidden-linked-");
  fs.writeFileSync(path.join(root, "page.html"), "root page");
  fs.writeFileSync(path.join(linked, "linked.html"), "linked page");
  fs.writeFileSync(path.join(linked, ".env"), "SECRET=do-not-serve");

  const server = await staticServers.start({ dir: state, sessionId: "s_hidden", root });
  t.after(async () => { await staticServers.stopAll(state, "s_hidden"); });
  const prefix = "/.lahe-source/aaaa01/";
  await staticServers.registerMount(state, "s_hidden", server.meta, prefix, linked);

  notFoundBody(404, await request(server.meta, prefix + ".env"));
});

test("a mount refuses a hidden subfolder", async (t) => {
  const state = path.join(tempDir("lahe-static-hidden-sub-state-"), "state");
  const root = tempDir("lahe-static-hidden-sub-root-");
  const linked = tempDir("lahe-static-hidden-sub-linked-");
  fs.writeFileSync(path.join(root, "page.html"), "root page");
  fs.mkdirSync(path.join(linked, ".git"));
  fs.writeFileSync(path.join(linked, ".git", "config"), "[core]\n");

  const server = await staticServers.start({ dir: state, sessionId: "s_hidden_sub", root });
  t.after(async () => { await staticServers.stopAll(state, "s_hidden_sub"); });
  const prefix = "/.lahe-source/aaaa02/";
  await staticServers.registerMount(state, "s_hidden_sub", server.meta, prefix, linked);

  notFoundBody(404, await request(server.meta, prefix + ".git/config"));
});

test("a mount refuses a normally-named symlink that resolves to a hidden file", async (t) => {
  const state = path.join(tempDir("lahe-static-hidden-sym-state-"), "state");
  const root = tempDir("lahe-static-hidden-sym-root-");
  const linked = tempDir("lahe-static-hidden-sym-linked-");
  fs.writeFileSync(path.join(root, "page.html"), "root page");
  fs.writeFileSync(path.join(linked, ".secret"), "do not serve");
  fs.symlinkSync(path.join(linked, ".secret"), path.join(linked, "innocuous.txt"));

  const server = await staticServers.start({ dir: state, sessionId: "s_hidden_sym", root });
  t.after(async () => { await staticServers.stopAll(state, "s_hidden_sym"); });
  const prefix = "/.lahe-source/aaaa03/";
  await staticServers.registerMount(state, "s_hidden_sym", server.meta, prefix, linked);

  notFoundBody(404, await request(server.meta, prefix + "innocuous.txt"));
});

test("a mount still serves a normal linked file", async (t) => {
  const state = path.join(tempDir("lahe-static-hidden-normal-state-"), "state");
  const root = tempDir("lahe-static-hidden-normal-root-");
  const linked = tempDir("lahe-static-hidden-normal-linked-");
  fs.writeFileSync(path.join(root, "page.html"), "root page");
  fs.writeFileSync(path.join(linked, "linked.html"), "linked page");

  const server = await staticServers.start({ dir: state, sessionId: "s_hidden_normal", root });
  t.after(async () => { await staticServers.stopAll(state, "s_hidden_normal"); });
  const prefix = "/.lahe-source/aaaa04/";
  await staticServers.registerMount(state, "s_hidden_normal", server.meta, prefix, linked);

  const res = await request(server.meta, prefix + "linked.html");
  assert.equal(res.status, 200);
  assert.equal(res.body, "linked page");
});

test("a mount still serves the document stylesheet and its fonts", async (t) => {
  const state = path.join(tempDir("lahe-static-hidden-style-state-"), "state");
  const root = tempDir("lahe-static-hidden-style-root-");
  const linked = tempDir("lahe-static-hidden-style-linked-");
  fs.writeFileSync(path.join(root, "page.html"), "root page");
  fs.writeFileSync(path.join(linked, "linked.md"), "# hello\n");

  const server = await staticServers.start({ dir: state, sessionId: "s_hidden_style", root });
  t.after(async () => { await staticServers.stopAll(state, "s_hidden_style"); });
  const prefix = "/.lahe-source/aaaa05/";
  await staticServers.registerMount(state, "s_hidden_style", server.meta, prefix, linked);

  const style = await request(server.meta, prefix + markdown.DOC_STYLE_ASSET);
  assert.equal(style.status, 200);
  assert.match(style.headers["content-type"], /^text\/css/);

  const font = await request(server.meta, prefix + markdown.FONT_ASSET_DIR + "/" + markdown.FONT_ASSETS[0]);
  assert.equal(font.status, 200);
});
